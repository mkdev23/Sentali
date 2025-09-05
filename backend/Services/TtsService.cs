using Microsoft.AspNetCore.Mvc;
using SentaliApp.Services;

namespace SentaliApp.Controllers
{
    [ApiController]
    public class TtsController : ControllerBase
    {
        private readonly GptService _gpt;
        private readonly TtsService _tts;
        private readonly IWebHostEnvironment _env;
        private readonly WsHub _ws;

        public TtsController(GptService gpt, TtsService tts, IWebHostEnvironment env, WsHub ws)
        {
            _gpt = gpt;
            _tts = tts;
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
                // 1. Get Agent/GPT reply
                var reply = await _gpt.GetResponse(text);

                // 2. Generate audio bytes
                var audioBytes = await _tts.Synthesize(reply);

                // 3. Save to wwwroot/tts/output.mp3
                var ttsDir = Path.Combine(_env.WebRootPath ?? "wwwroot", "tts");
                Directory.CreateDirectory(ttsDir);
                var outputPath = Path.Combine(ttsDir, "output.mp3");
                await System.IO.File.WriteAllBytesAsync(outputPath, audioBytes);

                // 4. Broadcast to WS clients (optional viseme cue)
                var publicUrl = $"/tts/output.mp3?v={DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()}";
                _ws.Broadcast(new
                {
                    type = "blendshapes",
                    values = new Dictionary<string, double> { { "joy", 1.0 } },
                    audio = publicUrl
                });

                // 5. Return JSON to frontend
                return Ok(new { text = reply, audio = publicUrl });
            }
            catch (Exception ex)
            {
                Console.WriteLine($"[TTS ERROR] {ex}");
                return StatusCode(500, new { error = ex.Message });
            }
        }
    }
}
