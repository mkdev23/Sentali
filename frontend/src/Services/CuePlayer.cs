using Newtonsoft.Json;
using SentaliApp.Models;

namespace SentaliApp.Server
{
    public class CuePlayer
    {
        private readonly CueDispatcher _dispatcher;

        public CuePlayer(CueDispatcher dispatcher)
        {
            _dispatcher = dispatcher;
        }

        public async Task PlayFromFileAsync(string filePath, CancellationToken ct = default)
        {
            if (!File.Exists(filePath))
            {
                Console.WriteLine($"Cue file not found: {filePath}");
                return;
            }

            var json = await File.ReadAllTextAsync(filePath, ct);
            var cues = JsonConvert.DeserializeObject<List<Cue>>(json) ?? new List<Cue>();

            foreach (var cue in cues)
            {
                await _dispatcher.BroadcastCueAsync(cue, ct);

                if (cue.Duration > 0)
                {
                    await Task.Delay(TimeSpan.FromSeconds(cue.Duration), ct);
                    cue.Weight = 0;
                    await _dispatcher.BroadcastCueAsync(cue, ct);
                }
            }
        }
    }
}