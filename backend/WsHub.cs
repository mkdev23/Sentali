using Fleck;
using System.Text.Json;

public class WsHub
{
    private readonly List<IWebSocketConnection> _clients = new();
    private readonly object _lock = new();

    public WsHub(string url = "ws://0.0.0.0:8123")
    {
        var server = new WebSocketServer(url);
        server.Start(socket =>
        {
            socket.OnOpen = () =>
            {
                lock (_lock) _clients.Add(socket);
                socket.Send(JsonSerializer.Serialize(new { type = "hello", msg = "connected" }));
            };
            socket.OnClose = () =>
            {
                lock (_lock) _clients.Remove(socket);
            };
            socket.OnError = _ => { /* ignore for now, could log */ };
        });

        Console.WriteLine($"[WS] Listening on {url}");
    }

    public void Broadcast(object payload)
    {
        string json = JsonSerializer.Serialize(payload, new JsonSerializerOptions
        {
            PropertyNamingPolicy = JsonNamingPolicy.CamelCase
        });

        List<IWebSocketConnection> snapshot;
        lock (_lock) snapshot = _clients.ToList();
        foreach (var c in snapshot) c.Send(json);
    }

    // Convenience for cues
    public void BroadcastCue(string expression, double intensity, double? duration, double atSeconds)
    {
        Broadcast(new
        {
            type = "cue",
            expression,
            intensity,
            duration,
            timestamp = atSeconds
        });
    }

    // Convenience for sending a blendshape update
    public void SendBlendshape(int index, double value)
    {
        Broadcast(new
        {
            type = "blendshape",
            index,
            value
        });
    }
}