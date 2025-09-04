using Fleck;
using System.Text.Json;

public class WsHub
{
    private readonly List<IWebSocketConnection> _clients = new();
    private readonly object _lock = new();

    // Map indices to expression names for VRM
    private static readonly string[] BlendshapeNames = {
        "aa", "ih", "ou", "ee", "oh",
        "happy", "angry", "sad", "relaxed", "neutral", "blink", "joy"
    };

    public WsHub(string url = "ws://0.0.0.0:8123")
    {
        var server = new WebSocketServer(url);
        server.Start(socket =>
        {
            socket.OnOpen = () =>
            {
                lock (_lock) _clients.Add(socket);
                socket.Send(JsonSerializer.Serialize(new { type = "hello", msg = "connected" }));
                Console.WriteLine("[WS] client connected");

                // Local test cue – remove when Azure pipeline is wired
                Broadcast(new { type = "blendshape", name = "joy", weight = 1.0 });
                Console.WriteLine("[WS] Sent test blendshape cue: joy=1.0");
            };

            socket.OnClose = () =>
            {
                lock (_lock) _clients.Remove(socket);
                Console.WriteLine("[WS] client disconnected");
            };

            socket.OnError = (ex) =>
            {
                Console.WriteLine($"[WS] error: {ex?.Message}");
            };
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

    // Send cue with expression name + weight
    public void SendBlendshape(string name, double weight)
    {
        Broadcast(new
        {
            type = "blendshape",
            name,
            weight
        });
    }

    // Send cue with index + value (auto-maps to name)
    public void SendBlendshape(int index, double value)
    {
        if (index < 0 || index >= BlendshapeNames.Length) return;
        SendBlendshape(BlendshapeNames[index], value);
    }

    // Send multiple blendshapes at once
    public void SendBlendshapes(Dictionary<string, double> values)
    {
        Broadcast(new
        {
            type = "blendshapes",
            values
        });
    }

    // Optional: cue with timing metadata
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
}