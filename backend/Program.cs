using System;
using System.IO;
using DotNetEnv;
using Microsoft.AspNetCore.StaticFiles;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Hosting;

using Azure.Identity;
using Azure.AI.OpenAI;
using Azure.Storage.Blobs;

using SentaliApp.Services;
using SentaliApp.SystemMessages;
using SentaliApp.Models;
using SentaliApp.Controllers; // Add this for AnyRunController

Env.Load();

var builder = WebApplication.CreateBuilder(args);

// 1) Logging providers (visible in Azure Log Stream)
builder.Logging.AddAzureWebAppDiagnostics();
builder.Logging.AddConsole();
builder.Logging.AddDebug();

// 2) Bind to Azure's assigned PORT before Build()
var port = Environment.GetEnvironmentVariable("PORT") ?? "8080";
builder.WebHost.UseUrls($"http://*:{port}");

// 3) CORS for local frontend dev
builder.Services.AddCors(opts =>
{
    opts.AddPolicy("AllowFrontendDev", p =>
        p.WithOrigins("http://localhost:5173")
         .AllowAnyHeader()
         .AllowAnyMethod()
         .AllowCredentials());
});

// 4) WebSocket hub
builder.Services.AddSingleton<WsHub>();

// 5) Azure & pipeline services
builder.Services.AddSingleton<DefaultAzureCredential>();
builder.Services.AddSingleton<GptService>();

// 6) Azure Blob Storage with SAS URL (for TI feeds)
builder.Services.AddSingleton<BlobServiceClient?>(sp =>
{
    var config = sp.GetRequiredService<IConfiguration>();
    var sasUrl = config["ThreatIntelSasUrl"] ?? Environment.GetEnvironmentVariable("THREAT_INTEL_SAS_URL");
    
    if (string.IsNullOrEmpty(sasUrl))
    {
        return null; // Will use null in controller (fallback to API)
    }

    try
    {
        var uri = new Uri(sasUrl);
        return new BlobServiceClient(uri);
    }
    catch (UriFormatException)
    {
        // Log error but don't throw - will fallback to API calls
        var logger = sp.GetRequiredService<ILogger<Program>>();
        logger.LogWarning("Invalid ThreatIntelSasUrl format, falling back to API calls");
        return null;
    }
});

// 7) TI Feed Background Service
builder.Services.AddHostedService<TiFeedBackgroundService>();

// 8) OPTIONAL: register SystemMessage if used elsewhere
var cfg = builder.Configuration;
var openAiEndpoint   = cfg["AZURE_OPENAI_ENDPOINT"]   ?? cfg["OPENAI_ENDPOINT"];
var openAiDeployment = cfg["AZURE_OPENAI_DEPLOYMENT"] ?? cfg["OPENAI_DEPLOYMENT"];
if (!string.IsNullOrWhiteSpace(openAiEndpoint) &&
    !string.IsNullOrWhiteSpace(openAiDeployment))
{
    builder.Services.AddSingleton(sp =>
    {
        var cred   = sp.GetRequiredService<DefaultAzureCredential>();
        var client = new AzureOpenAIClient(new Uri(openAiEndpoint!), cred);
        return new SystemMessage(client.GetChatClient(openAiDeployment!));
    });
}

// 9) Core services
builder.Services.AddSingleton<SentimentService>();
builder.Services.AddSingleton<BlobStorageService>();
builder.Services.AddSingleton<TtsService>();

// 10) HttpClient for API calls
builder.Services.AddHttpClient();

// 11) MVC Controllers + Swagger
builder.Services.AddControllers();
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen();
builder.Services.AddSingleton(new BlobServiceClient(
    new Uri("https://sentalistorage23075.blob.core.windows.net"), // ✅ account endpoint only
    new DefaultAzureCredential()
));



var app = builder.Build();

// Enable WebSockets early in the pipeline
app.UseWebSockets();

// 12) Dev exception page and CORS
if (app.Environment.IsDevelopment())
{
    app.UseDeveloperExceptionPage();
    app.UseSwagger();
    app.UseSwaggerUI();
}

app.UseCors("AllowFrontendDev");

// 13) Static file MIME mapping
var provider = new FileExtensionContentTypeProvider();
provider.Mappings[".mp3"] = "audio/mpeg";
provider.Mappings[".vrm"] = "model/gltf-binary";
provider.Mappings[".hdr"] = "image/vnd.radiance";

// 14) Serve wwwroot
app.UseDefaultFiles();
app.UseStaticFiles(new StaticFileOptions { ContentTypeProvider = provider });

// 15) Serve /tts folder with CORS for dev
app.UseStaticFiles(new StaticFileOptions
{
    FileProvider = new Microsoft.Extensions.FileProviders.PhysicalFileProvider(
        Path.Combine(Directory.GetCurrentDirectory(), "wwwroot", "tts")),
    RequestPath = "/tts",
    ContentTypeProvider = provider,
    OnPrepareResponse = ctx =>
    {
        if (app.Environment.IsDevelopment())
        {
            ctx.Context.Response.Headers["Access-Control-Allow-Origin"] = "http://localhost:5173";
            ctx.Context.Response.Headers["Vary"] = "Origin";
        }
    }
});

// 16) Map Controllers
app.MapControllers();

// 17) Minimal API for /api/chat with surfaced errors
app.MapPost("/api/chat", async (
    GptService gpt,
    [FromBody] ChatRequest req,
    ILoggerFactory loggerFactory) =>
{
    var logger = loggerFactory.CreateLogger("ChatEndpoint");

    if (req is null || string.IsNullOrWhiteSpace(req.Text))
        return Results.BadRequest("Missing 'text' in request body.");

    try
    {
        var reply = await gpt.GetResponse(req.Text);
        return Results.Ok(new ChatResponse { Text = reply });
    }
    catch (HttpRequestException httpEx)
    {
        logger.LogError(httpEx, "Chat service HTTP failure");
        return Results.Problem(
            title: "Chat failed",
            detail: httpEx.Message,
            statusCode: 502);
    }
    catch (Exception ex)
    {
        logger.LogError(ex, "Chat service unhandled exception");
        return Results.Problem(
            title: "Chat failed",
            detail: app.Environment.IsDevelopment()
                ? ex.ToString()
                : ex.Message,
            statusCode: 500);
    }
});

// 18) Updated /speak endpoint using TtsService
app.MapGet("/speak", async (
    TtsService tts,
    string text,
    string expression) =>
{
    var (audioBytes, visemes) = await tts.SynthesizeWithVisemesAsync(text);
    return Results.Ok(new
    {
        status = "queued",
        text,
        expression,
        visemeCount = visemes.Count
    });
});

// 19) Pure TTS endpoint — speaks provided text (e.g., GPT reply from /api/chat)
app.MapPost("/api/tts", async (
    SentimentService sentiment,
    TtsService tts,
    BlobStorageService blob,
    [FromBody] ChatRequest req,
    ILoggerFactory loggerFactory) =>
{
    var logger = loggerFactory.CreateLogger("TtsEndpoint");

    if (req is null || string.IsNullOrWhiteSpace(req.Text))
        return Results.BadRequest("Missing 'text' in request body.");

    try
    {
        var sent = await sentiment.GetSentiment(req.Text);
        var expression = sent switch
        {
            "Positive" => "happy",
            "Negative" => "angry",
            "Mixed" => "surprised",
            _ => "neutral"
        };

        var (audioBytes, visemes) = await tts.SynthesizeWithVisemesAsync(req.Text);

        var sasUrl = await blob.UploadAndGetSas(audioBytes);

        var visemePayload = visemes
            .Select(v => new VisemePayload
            {
                VisemeId = v.VisemeId,
                TimeMs = (ulong)(v.AudioOffset / 10000L)
            })
            .ToList();

        logger.LogInformation("[TTS] Returning {Count} visemes to client", visemePayload.Count);

        return Results.Ok(new
        {
            sentiment = sent,
            expression,
            audioUrl = sasUrl,
            visemes = visemePayload
        });
    }
    catch (Exception ex)
    {
        logger.LogError(ex, "TTS pipeline failed");
        return Results.Problem(
            title: "TTS pipeline failed",
            detail: ex.Message,
            statusCode: 500);
    }
});

// 20) Health check
app.MapGet("/health", () => Results.Ok("App is running"));

// 21) WebSocket endpoint at /ws
app.Map("/ws", wsApp =>
{
    wsApp.Run(async context =>
    {
        if (context.WebSockets.IsWebSocketRequest)
        {
            var socket = await context.WebSockets.AcceptWebSocketAsync();
            var hub = context.RequestServices.GetRequiredService<WsHub>();
            await hub.HandleClientAsync(socket);
        }
        else
        {
            context.Response.StatusCode = 400;
        }
    });
});

app.Run();