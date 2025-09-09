using DotNetEnv;
using Microsoft.AspNetCore.StaticFiles;
using Microsoft.Extensions.FileProviders;
using Azure.Identity;
using Azure.AI.OpenAI;
using OpenAI.Chat;
using SentaliApp.Services;
using SentaliApp.SystemMessages;
using SentaliApp.Models;            // for ChatRequest/ChatResponse
using Microsoft.AspNetCore.Mvc;

Env.Load();

var builder = WebApplication.CreateBuilder(args);

// 1) Bind to Azure’s assigned PORT before Build()
var port = Environment.GetEnvironmentVariable("PORT") ?? "8080";
builder.WebHost.UseUrls($"http://*:{port}");

// 2) CORS for local frontend dev
builder.Services.AddCors(opts =>
{
    opts.AddPolicy("AllowFrontendDev", p =>
        p.WithOrigins("http://localhost:5173")
         .AllowAnyHeader()
         .AllowAnyMethod()
         .AllowCredentials());
});

// 3) WebSocket hub
builder.Services.AddSingleton<WsHub>();

// 4) Azure & pipeline services
builder.Services.AddSingleton<DefaultAzureCredential>();
builder.Services.AddSingleton<GptService>();

// 5) SystemMessage backed by AzureOpenAIClient
builder.Services.AddSingleton(sp =>
{
    var cfg = sp.GetRequiredService<IConfiguration>();
    var cred = sp.GetRequiredService<DefaultAzureCredential>();
    var client = new AzureOpenAIClient(new Uri(cfg["OPENAI_ENDPOINT"]!), cred);
    return new SystemMessage(client.GetChatClient(cfg["OPENAI_DEPLOYMENT"]!));
});

builder.Services.AddSingleton<SentimentService>();
builder.Services.AddSingleton<BlobStorageService>();
builder.Services.AddSingleton<AzureSpeechService>();
builder.Services.AddSingleton<TtsService>();

// 6) MVC Controllers (if you have any)
builder.Services.AddControllers();

var app = builder.Build();

// 7) Use CORS in dev only
if (app.Environment.IsDevelopment())
    app.UseCors("AllowFrontendDev");

// 8) Static file MIME mapping
var provider = new FileExtensionContentTypeProvider();
provider.Mappings[".mp3"] = "audio/mpeg";
provider.Mappings[".vrm"] = "application/octet-stream";
provider.Mappings[".hdr"] = "image/vnd.radiance";

// 9) Serve wwwroot
app.UseDefaultFiles();
app.UseStaticFiles(new StaticFileOptions { ContentTypeProvider = provider });

// 10) Serve /tts folder with CORS for dev
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
            ctx.Context.Response.Headers["Vary"] = "Origin";
        }
    }
});

// 11) Map Controllers (if you added ChatController/TTSController)
app.MapControllers();

// 12) Fallback minimal‐API for /api/chat
app.MapPost("/api/chat", async (
    GptService gpt,
    [FromBody] ChatRequest req) =>
{
    if (string.IsNullOrWhiteSpace(req.Text))
        return Results.BadRequest("Missing 'text' in request body.");

    var reply = await gpt.GetResponse(req.Text);
    return Results.Ok(new ChatResponse { Text = reply });
});

// 13) Existing viseme endpoint
app.MapGet("/speak", async (AzureSpeechService tts, string text, string expression) =>
{
    await tts.SpeakWithVisemesAsync(text, expression);
    return Results.Ok(new { status = "queued", text, expression });
});

// 14) Secure GPT→Sentiment→TTS→Blob endpoint
app.MapPost("/api/tts", async (
    GptService gpt,
    SentimentService sentiment,
    TtsService tts,
    BlobStorageService blob,
    [FromBody] string userInput) =>
{
    var gptResponse = await gpt.GetResponse(userInput);
    var sent = await sentiment.GetSentiment(userInput);
    var expression = sent switch
    {
        "Positive" => "smile",
        "Negative" => "frown",
        _ => "neutral"
    };

    var audioBytes = await tts.Synthesize(gptResponse);
    var sasUrl = await blob.UploadAndGetSas(audioBytes);

    return Results.Ok(new { text = gptResponse, sentiment = sent, expression, audioUrl = sasUrl });
});

// 15) Health check
app.MapGet("/health", () => Results.Ok("App is running"));

// 16) WebSocket endpoint at /ws
app.Map("/ws", wsApp =>
{
    wsApp.UseWebSockets();
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