using System;
using System.IO;
using DotNetEnv;
using Microsoft.AspNetCore.StaticFiles;
using Microsoft.Extensions.FileProviders;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Logging;

using Azure.Identity;
using Azure.AI.OpenAI;

using SentaliApp.Services;
using SentaliApp.SystemMessages;
using SentaliApp.Models;

Env.Load();

var builder = WebApplication.CreateBuilder(args);

// 1) Logging providers (visible in Azure Log Stream)
builder.Logging.AddAzureWebAppDiagnostics();
builder.Logging.AddConsole();
builder.Logging.AddDebug();

// 2) Bind to Azure’s assigned PORT before Build()
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

// OPTIONAL: register SystemMessage if used elsewhere
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

// 6) Core services
builder.Services.AddSingleton<SentimentService>();
builder.Services.AddSingleton<BlobStorageService>();

// Remove AzureSpeechService registration
// builder.Services.AddSingleton<AzureSpeechService>();

// Register the new TtsService with viseme support
builder.Services.AddSingleton<TtsService>();

// 7) MVC Controllers (if you have any)
builder.Services.AddControllers();

var app = builder.Build();

// 8) Dev exception page and CORS
if (app.Environment.IsDevelopment())
{
    app.UseDeveloperExceptionPage();
    app.UseCors("AllowFrontendDev");
}

// 9) Static file MIME mapping
var provider = new FileExtensionContentTypeProvider();
provider.Mappings[".mp3"] = "audio/mpeg";
provider.Mappings[".vrm"] = "application/octet-stream";
provider.Mappings[".hdr"] = "image/vnd.radiance";

// 10) Serve wwwroot
app.UseDefaultFiles();
app.UseStaticFiles(new StaticFileOptions { ContentTypeProvider = provider });

// 11) Serve /tts folder with CORS for dev
app.UseStaticFiles(new StaticFileOptions
{
    FileProvider = new PhysicalFileProvider(
        Path.Combine(Directory.GetCurrentDirectory(), "wwwroot", "tts")),
    RequestPath = "/tts",
    ContentTypeProvider = provider,
    OnPrepareResponse = ctx =>
    {
        if (app.Environment.IsDevelopment())
        {
            ctx.Context.Response.Headers["Access-Control-Allow-Origin"] = "http://localhost:5173";
            ctx.Context.Response.Headers["Vary"]                        = "Origin";
        }
    }
});

// 12) Map Controllers
app.MapControllers();

// 13) Minimal API for /api/chat with surfaced errors
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

// 14) Updated /speak endpoint using TtsService
app.MapGet("/speak", async (
    TtsService tts,
    string text,
    string expression) =>
{
    var (audioBytes, visemes) = await tts.SynthesizeWithVisemesAsync(text);
    return Results.Ok(new
    {
        status      = "queued",
        text,
        expression,
        visemeCount = visemes.Count
    });
});

// 15) Secure GPT → Sentiment → TTS → Blob endpoint (with viseme & joy fallback)
app.MapPost("/api/tts", async (
    GptService gpt,
    SentimentService sentiment,
    TtsService tts,
    BlobStorageService blob,
    [FromBody] string userInput,
    ILoggerFactory loggerFactory) =>
{
    var logger = loggerFactory.CreateLogger("TtsEndpoint");
    try
    {
        // 1) GPT reply
        var reply = await gpt.GetResponse(userInput);

        // 2) Sentiment → expression
        var sent       = await sentiment.GetSentiment(reply);
        var expression = sent switch
        {
            "Positive" => "smile",
            "Negative" => "frown",
            _          => "neutral"
        };

        // 3) Synthesize with visemes
        var (audioBytes, visemes) = await tts.SynthesizeWithVisemesAsync(reply);

        // 4) Upload audio
        var sasUrl = await blob.UploadAndGetSas(audioBytes);

        // 5) Build viseme payload using the concrete VisemePayload type
        var visemePayload = visemes
            .Select(v => new VisemePayload
            {
                VisemeId = v.VisemeId,
                TimeMs   = v.AudioOffset / 10_000UL
            })
            .ToList();

        // 6) If no visemes emitted, inject a joy cue at t=0
        if (visemePayload.Count == 0)
        {
            visemePayload.Add(new VisemePayload
            {
                VisemeId = 0,
                TimeMs   = 0
            });
            expression = "joy";
        }

        // 7) Broadcast over WebSocket
        var hub = app.Services.GetRequiredService<WsHub>();
        hub.Broadcast(new
        {
            type       = "blendshapes",
            audioUrl   = sasUrl,
            expression,
            visemes    = visemePayload
        });

        // 8) Return payload
        return Results.Ok(new
        {
            text       = reply,
            sentiment  = sent,
            expression,
            audioUrl   = sasUrl,
            visemes    = visemePayload
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


// 16) Health check
app.MapGet("/health", () => Results.Ok("App is running"));

// 17) WebSocket endpoint at /ws
app.Map("/ws", wsApp =>
{
    wsApp.UseWebSockets();
    wsApp.Run(async context =>
    {
        if (context.WebSockets.IsWebSocketRequest)
        {
            var socket = await context.WebSockets.AcceptWebSocketAsync();
            var hub    = context.RequestServices.GetRequiredService<WsHub>();
            await hub.HandleClientAsync(socket);
        }
        else
        {
            context.Response.StatusCode = 400;
        }
    });
});

app.Run();