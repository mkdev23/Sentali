using DotNetEnv;
using Microsoft.AspNetCore.StaticFiles;
using Microsoft.Extensions.FileProviders;
using Azure.Identity;
using Azure.AI.OpenAI;
using OpenAI.Chat; // <-- Needed for ChatClient
using SentaliApp.Services;
using SentaliApp.SystemMessages;
using Microsoft.AspNetCore.Mvc;



Env.Load();

var builder = WebApplication.CreateBuilder(args);

// CORS for local frontend
builder.Services.AddCors(options =>
{
    options.AddPolicy("AllowFrontendDev", policy =>
    {
        policy.WithOrigins("http://localhost:5173")
              .AllowAnyHeader()
              .AllowAnyMethod();
    });
});

// WebSocket hub
var wsHub = new WsHub("ws://0.0.0.0:8124");
builder.Services.AddSingleton(wsHub);

// Existing speech service
builder.Services.AddSingleton<AzureSpeechService>();

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
builder.Services.AddSingleton<TtsService>();
builder.Services.AddSingleton<BlobStorageService>();

var app = builder.Build();

app.UseCors("AllowFrontendDev");

// Static file provider for mp3
var provider = new FileExtensionContentTypeProvider();
provider.Mappings[".mp3"] = "audio/mpeg";

// Serve default wwwroot
app.UseDefaultFiles();
app.UseStaticFiles();

// Serve /tts with CORS
app.UseStaticFiles(new StaticFileOptions
{
    FileProvider = new PhysicalFileProvider(
        Path.Combine(Directory.GetCurrentDirectory(), "wwwroot", "tts")),
    RequestPath = "/tts",
    ContentTypeProvider = provider,
    OnPrepareResponse = ctx =>
    {
        ctx.Context.Response.Headers["Access-Control-Allow-Origin"] = "http://localhost:5173";
        ctx.Context.Response.Headers["Vary"] = "Origin";
    }
});

// Existing viseme endpoint
app.MapGet("/speak", async (AzureSpeechService tts, string text, string expression) =>
{
    await tts.SpeakWithVisemesAsync(text, expression);
    return Results.Ok(new { status = "queued", text, expression });
});

// New secure GPT→Sentiment→TTS→Blob endpoint
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

app.Run("http://0.0.0.0:8123");