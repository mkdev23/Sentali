using DotNetEnv;
using Microsoft.AspNetCore.StaticFiles;
using Microsoft.Extensions.FileProviders;
using Azure.Identity;
using Azure.AI.OpenAI;
using OpenAI.Chat;
using SentaliApp.Services;
using SentaliApp.SystemMessages;
using Microsoft.AspNetCore.Mvc;

Env.Load();

var builder = WebApplication.CreateBuilder(args);

// CORS for local frontend dev
builder.Services.AddCors(options =>
{
    options.AddPolicy("AllowFrontendDev", policy =>
    {
        policy.WithOrigins("http://localhost:5173")
              .AllowAnyHeader()
              .AllowAnyMethod()
              .AllowCredentials();
    });
});

// WebSocket hub
var wsHub = new WsHub();
builder.Services.AddSingleton(wsHub);

// Azure + pipeline services
builder.Services.AddSingleton(new DefaultAzureCredential());
builder.Services.AddSingleton<GptService>();

// Register SystemMessage with a ChatClient from AzureOpenAIClient
builder.Services.AddSingleton(sp =>
{
    var config = sp.GetRequiredService<IConfiguration>();
    var cred = new DefaultAzureCredential();
    var aoaiClient = new AzureOpenAIClient(new Uri(config["OPENAI_ENDPOINT"]!), cred);
    return new SystemMessage(aoaiClient.GetChatClient(config["OPENAI_DEPLOYMENT"]!));
});

builder.Services.AddSingleton<SentimentService>();
builder.Services.AddSingleton<BlobStorageService>();
builder.Services.AddSingleton<AzureSpeechService>();
builder.Services.AddSingleton<GptService>();
builder.Services.AddSingleton<TtsService>();
builder.Services.AddSingleton<WsHub>();
builder.Services.AddControllers();


var app = builder.Build();
app.MapControllers();
// Use CORS in dev only
if (app.Environment.IsDevelopment())
{
    app.UseCors("AllowFrontendDev");
}

// Static file provider with VRM + HDR MIME mapping
var provider = new FileExtensionContentTypeProvider();
provider.Mappings[".mp3"] = "audio/mpeg";
provider.Mappings[".vrm"] = "application/octet-stream";
provider.Mappings[".hdr"] = "image/vnd.radiance";

// Serve frontend from wwwroot
app.UseDefaultFiles();
app.UseStaticFiles(new StaticFileOptions
{
    ContentTypeProvider = provider
});

// Serve /tts folder with CORS for dev
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

// Map WebSocket endpoint at /ws
app.Map("/ws", wsApp =>
{
    wsApp.UseWebSockets();
    wsApp.Run(async context =>
    {
        if (context.WebSockets.IsWebSocketRequest)
        {
            var socket = await context.WebSockets.AcceptWebSocketAsync();
            await wsHub.HandleClientAsync(socket);
        }
        else
        {
            context.Response.StatusCode = 400;
        }
    });
});

// Existing viseme endpoint
app.MapGet("/speak", async (AzureSpeechService tts, string text, string expression) =>
{
    await tts.SpeakWithVisemesAsync(text, expression);
    return Results.Ok(new { status = "queued", text, expression });
});

// Secure GPT→Sentiment→TTS→Blob endpoint
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
app.MapGet("/health", () => Results.Ok("App is running"));
// Bind to Azure's assigned port in production
var port = Environment.GetEnvironmentVariable("PORT") ?? "8080";
builder.WebHost.UseUrls($"http://*:{port}");
app.Run();