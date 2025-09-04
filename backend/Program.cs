using DotNetEnv;
using Microsoft.AspNetCore.StaticFiles;
using Microsoft.Extensions.FileProviders;

Env.Load();

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddCors(options =>
{
    options.AddPolicy("AllowFrontendDev", policy =>
    {
        policy.WithOrigins("http://localhost:5173")
              .AllowAnyHeader()
              .AllowAnyMethod();
    });
});

var wsHub = new WsHub("ws://0.0.0.0:8124");
builder.Services.AddSingleton(wsHub);
builder.Services.AddSingleton<AzureSpeechService>();

var app = builder.Build();

app.UseCors("AllowFrontendDev");

var provider = new FileExtensionContentTypeProvider();
provider.Mappings[".mp3"] = "audio/mpeg";

app.UseDefaultFiles();
app.UseStaticFiles(); // serve all of wwwroot normally

// Explicit /tts mapping with CORS
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

app.MapGet("/speak", async (AzureSpeechService tts, string text, string expression) =>
{
    await tts.SpeakWithVisemesAsync(text, expression);
    return Results.Ok(new { status = "queued", text, expression });
});

app.Run("http://0.0.0.0:8123");