var builder = WebApplication.CreateBuilder(args);

// ... your service setup

var app = builder.Build();

// Allow WebSocket connections
app.UseWebSockets();

app.Map("/ws", async context =>
{
    if (context.WebSockets.IsWebSocketRequest)
    {
        var ws = await context.WebSockets.AcceptWebSocketAsync();
        // handle WS messages here
    }
    else
    {
        context.Response.StatusCode = 400;
    }
});

// Listen on all interfaces, port 8123
app.Run("http://0.0.0.0:8123");

