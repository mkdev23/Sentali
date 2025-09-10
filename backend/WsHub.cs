using System.Net.WebSockets;
using System.Text;
using System.Text.Json;

namespace SentaliApp.Services
{
    public class WsHub
    {
        private readonly List<WebSocket> _clients = new();
        private readonly object _lock = new();

        private static readonly string[] BlendshapeNames = {
            "aa", "ih", "ou", "ee", "oh",
            "happy", "angry", "sad", "relaxed", "neutral", "blink", "joy"
        };

        public async Task HandleClientAsync(WebSocket socket)
{
    lock (_lock) _clients.Add(socket);
    Console.WriteLine("[WS] client connected");

    // Send hello directly to this socket
    await Send(socket, new { type = "hello", msg = "connected" });

    // Immediately broadcast joy to all clients (including this one)
    Broadcast(new { type = "blendshape", name = "joy", weight = 1.0 });

    var buffer = new byte[1024 * 4];
    try
    {
        while (socket.State == WebSocketState.Open)
        {
            var result = await socket.ReceiveAsync(new ArraySegment<byte>(buffer), CancellationToken.None);
            if (result.MessageType == WebSocketMessageType.Close) break;

            var message = Encoding.UTF8.GetString(buffer, 0, result.Count);
            Console.WriteLine("[WS] Received: " + message);

            await Send(socket, new { type = "echo", msg = message });
        }
    }
    catch (Exception ex)
    {
        Console.WriteLine("[WS] error: " + ex.Message);
    }

    lock (_lock) _clients.Remove(socket);
    await socket.CloseAsync(WebSocketCloseStatus.NormalClosure, "Closing", CancellationToken.None);
    Console.WriteLine("[WS] client disconnected");
}

        private async Task Send(WebSocket socket, object payload)
        {
            var json = JsonSerializer.Serialize(payload, new JsonSerializerOptions
            {
                PropertyNamingPolicy = JsonNamingPolicy.CamelCase
            });

            var bytes = Encoding.UTF8.GetBytes(json);
            try
            {
                await socket.SendAsync(new ArraySegment<byte>(bytes), WebSocketMessageType.Text, true, CancellationToken.None);
            }
            catch (Exception ex)
            {
                Console.WriteLine($"[WS] send error: {ex.Message}");
                lock (_lock) _clients.Remove(socket);
            }
        }

        public void Broadcast(object payload)
        {
            var json = JsonSerializer.Serialize(payload, new JsonSerializerOptions
            {
                PropertyNamingPolicy = JsonNamingPolicy.CamelCase
            });

            var bytes = Encoding.UTF8.GetBytes(json);
            List<WebSocket> snapshot;
            lock (_lock) snapshot = _clients.ToList();

            foreach (var socket in snapshot)
            {
                if (socket.State == WebSocketState.Open)
                {
                    _ = socket.SendAsync(new ArraySegment<byte>(bytes), WebSocketMessageType.Text, true, CancellationToken.None)
                        .ContinueWith(t =>
                        {
                            if (t.IsFaulted)
                            {
                                Console.WriteLine($"[WS] send error: {t.Exception?.GetBaseException().Message}");
                                lock (_lock) _clients.Remove(socket);
                            }
                        });
                }
                else
                {
                    lock (_lock) _clients.Remove(socket);
                }
            }
        }

        public void SendBlendshape(string name, double weight) =>
            Broadcast(new { type = "blendshape", name, weight });

        public void SendBlendshape(int index, double value)
        {
            if (index < 0 || index >= BlendshapeNames.Length) return;
            SendBlendshape(BlendshapeNames[index], value);
        }

        public void SendBlendshapes(Dictionary<string, double> values) =>
            Broadcast(new { type = "blendshapes", values });

        public void BroadcastCue(string expression, double intensity, double? duration, double atSeconds) =>
            Broadcast(new { type = "cue", expression, intensity, duration, timestamp = atSeconds });
    }
}
