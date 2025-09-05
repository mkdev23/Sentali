using Microsoft.AspNetCore.Mvc;
using SentaliApp.Services;

namespace SentaliApp.Controllers
{
    [ApiController]
    public class TtsController : ControllerBase
    {
        private readonly GptService _gpt;
        private readonly TtsService _tts;
        private readonly SentimentService _sentiment;
        private readonly IWebHostEnvironment _env;
        private readonly WsHub _ws;

        public TtsController(
            GptService gpt,
            TtsService tts,
            SentimentService sentiment,
            IWebHostEnvironment env,
            WsHub ws)
        {
            _gpt = gpt;
            _tts = tts;
            _sentiment = sentiment;
            _env = env;
            _ws = ws;
        }

        [HttpPost("api/tts")]
        public async Task<IActionResult> Tts([FromBody] string text)
        {
            if (string.IsNullOrWhiteSpace(text))
                return BadRequest(new { error = "No text provided" });

            try
            {
                Console.WriteLine($"[TTS] Incoming text: {text}");

                // 1. Get Agent reply
                var reply = await _gpt.GetResponse(text);
                Console.WriteLine($"[TTS] Agent reply: {reply}");

                // 2. Determine sentiment → expression
                var sentiment = await _sentiment.GetSentiment(reply);
                Console.WriteLine($"[TTS] Sentiment: {sentiment}");
                var expression = sentiment switch
                {
                    "Positive" => "joy",
                    "Negative" => "angry",
                    "Neutral"  => "neutral",
                    _          => "neutral"
                };

                // 3. Generate audio
                var audioBytes = await _tts.Synthesize(reply);
                Console.WriteLine($"[TTS] Audio bytes generated: {audioBytes.Length}");

                // 4. Save to wwwroot/tts/output.mp3
                var ttsDir = Path.Combine(_env.WebRootPath ?? "wwwroot", "tts");
                Directory.CreateDirectory(ttsDir);
                var outputPath = Path.Combine(ttsDir, "output.mp3");
                await System.IO.File.WriteAllBytesAsync(outputPath, audioBytes);
                Console.WriteLine($"[TTS] Audio saved to: {outputPath}");

                // 5. Broadcast to WS clients
                var publicUrl = $"/tts/output.mp3?v={DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()}";
                _ws.Broadcast(new
                {
                    type = "blendshapes",
                    values = new Dictionary<string, double> { { expression, 1.0 } },
                    audio = publicUrl
                });
                Console.WriteLine($"[TTS] Broadcast sent: {expression}, {publicUrl}");

                // 6. Return JSON to frontend
                return Ok(new { text = reply, audio = publicUrl, expression, sentiment });
            }
            catch (Exception ex)
            {
                Console.WriteLine($"[TTS ERROR] {ex}");
                return StatusCode(500, new { error = ex.Message, stack = ex.StackTrace });
            }
        }
    }
}
