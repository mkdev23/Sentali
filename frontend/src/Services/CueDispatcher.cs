using System.Collections.Concurrent;
using System.Net.WebSockets;
using System.Text;
using Newtonsoft.Json;
using SentaliApp.Models;

namespace SentaliApp.Server
{
    public class CueDispatcher
    {
        private readonly ConcurrentDictionary<Guid, WebSocket> _clients = new();

        public async Task HandleClientAsync(WebSocket socket, CancellationToken ct = default)
        {
            var id = Guid.NewGuid();
            _clients[id] = socket;

            var buffer = new byte[8192];
            try
            {
                while (socket.State == WebSocketState.Open && !ct.IsCancellationRequested)
                {
                    var result = await socket.ReceiveAsync(new ArraySegment<byte>(buffer), ct);
                    if (result.MessageType == WebSocketMessageType.Close) break;

                    var msg = Encoding.UTF8.GetString(buffer, 0, result.Count);
                    await HandleIncomingAsync(socket, msg, ct);
                }
            }
            finally
            {
                _clients.TryRemove(id, out _);
                if (socket.State == WebSocketState.Open)
                {
                    await socket.CloseAsync(WebSocketCloseStatus.NormalClosure, "Bye", ct);
                }
            }
        }

        private async Task HandleIncomingAsync(WebSocket socket, string msg, CancellationToken ct)
        {
            // Local test trigger: "localtest:aa" or "localtest:happy"
            const string Prefix = "localtest:";
            if (msg.StartsWith(Prefix, StringComparison.OrdinalIgnoreCase))
            {
                var name = msg.Substring(Prefix.Length).Trim();
                var on = new Cue { Type = "blendshape", Name = name, Weight = 1.0f, Duration = 0.5f, StartTime = 0f };
                await SendCueAsync(socket, on, ct);
                await Task.Delay(TimeSpan.FromSeconds(on.Duration), ct);
                await SendCueAsync(socket, new Cue { Type = "blendshape", Name = name, Weight = 0f, Duration = 0f, StartTime = 0f }, ct);
            }
        }

        public async Task SendCueAsync(WebSocket socket, Cue cue, CancellationToken ct = default)
        {
            var json = JsonConvert.SerializeObject(cue);
            var bytes = Encoding.UTF8.GetBytes(json);
            await socket.SendAsync(new ArraySegment<byte>(bytes), WebSocketMessageType.Text, true, ct);
        }

        public async Task BroadcastCueAsync(Cue cue, CancellationToken ct = default)
        {
            var json = JsonConvert.SerializeObject(cue);
            var bytes = new ArraySegment<byte>(Encoding.UTF8.GetBytes(json));

            var dead = new List<Guid>();
            foreach (var kv in _clients)
            {
                var ws = kv.Value;
                if (ws.State != WebSocketState.Open) { dead.Add(kv.Key); continue; }
                try
                {
                    await ws.SendAsync(bytes, WebSocketMessageType.Text, true, ct);
                }
                catch { dead.Add(kv.Key); }
            }
            foreach (var id in dead) _clients.TryRemove(id, out _);
        }

        public Task PlayCuesAsync(IEnumerable<Cue> cues, CancellationToken ct = default)
        {
            // Schedule by start_time; turn off after duration
            return Task.Run(async () =>
            {
                var list = cues?.OrderBy(c => c.StartTime).ToList() ?? new List<Cue>();
                var start = DateTime.UtcNow;

                foreach (var cue in list)
                {
                    var delay = TimeSpan.FromSeconds(Math.Max(0, cue.StartTime)) - (DateTime.UtcNow - start);
                    if (delay > TimeSpan.Zero) await Task.Delay(delay, ct);

                    await BroadcastCueAsync(cue, ct);

                    if (cue.Duration > 0)
                    {
                        _ = Task.Run(async () =>
                        {
                            try
                            {
                                await Task.Delay(TimeSpan.FromSeconds(cue.Duration), ct);
                                await BroadcastCueAsync(new Cue
                                {
                                    Type = cue.Type,
                                    Name = cue.Name,
                                    Weight = 0f,
                                    Duration = 0f,
                                    StartTime = 0f
                                }, ct);
                            }
                            catch { /* ignored */ }
                        }, ct);
                    }
                }
            }, ct);
        }
    }
}