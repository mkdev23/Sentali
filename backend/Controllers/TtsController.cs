// TtsController.cs
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Logging;
using SentaliApp.Services;

namespace SentaliApp.Controllers
{
    [ApiController]
    [Route("api/[controller]")]
    public class TtsController : ControllerBase
    {
        private readonly ILogger<TtsController> _logger;
        private readonly SentimentService _sentiment;
        private readonly TtsService _tts;
        private readonly BlobStorageService _blob;

        public TtsController(ILogger<TtsController> logger, SentimentService sentiment, TtsService tts, BlobStorageService blob)
        {
            _logger = logger;
            _sentiment = sentiment;
            _tts = tts;
            _blob = blob;
        }

        public class ChatRequest { public string? Text { get; set; } }

        [HttpPost]
        public async Task<IActionResult> Post([FromBody] ChatRequest req)
        {
            if (req == null || string.IsNullOrWhiteSpace(req.Text))
                return BadRequest(new { error = "Missing 'text' property" });

            _logger.LogInformation("[TTS] Text received: {Text}", req.Text);

            try
            {
                // Sentiment → expression (expanded for more variety; maps to vrmMapping.ts)
                var sentiment = await _sentiment.GetSentiment(req.Text);
                var expression = sentiment switch
                {
                    "Positive" => "joy",       // Maps to 'happy'
                    "Negative" => "angry",     // Maps to 'angry'
                    "Mixed" => "surprised",    // Maps to 'surprised' for uncertainty
                    _ => "neutral"             // Maps to 'neutral'
                };
                _logger.LogInformation("[TTS] Sentiment={Sentiment}, Expression={Expression}", sentiment, expression);

                // Synthesis with longer timeout (60s for longer texts)
                using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(60));
                _logger.LogInformation("[TTS] Synthesis start");
                var (audioBytes, visemes) = await _tts.SynthesizeWithVisemesAsync(req.Text, cts.Token);
                _logger.LogInformation("[TTS] Synthesis done, {Len} bytes, {VisemeCount} visemes", audioBytes?.Length ?? 0, visemes.Count);

                if (audioBytes == null || audioBytes.Length == 0)
                {
                    _logger.LogWarning("[TTS] No audio returned");
                    return Problem("TTS produced no audio", statusCode: 500);
                }

                // Upload → SAS URL
                _logger.LogInformation("[TTS] Blob upload start");
                var audioUrl = await _blob.UploadAndGetSas(audioBytes);
                _logger.LogInformation("[TTS] Blob uploaded: {Url}", audioUrl);

                // Viseme payload
                var visemePayload = visemes.Select(v => new
                {
                    VisemeId = v.VisemeId,
                    TimeMs = (ulong)v.AudioOffset / 10000UL // 100ns → ms, use ulong literal for divisor
                }).ToList();

                return Ok(new
                {
                    sentiment,
                    expression,
                    audioUrl,
                    visemes = visemePayload
                });
            }
            catch (OperationCanceledException)
            {
                _logger.LogError("[TTS] Synthesis timed out");
                return StatusCode(504, new { error = "TTS synthesis timed out" });
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "[TTS] Pipeline failed");
                return StatusCode(500, new { error = "TTS pipeline failed", detail = ex.Message });
            }
        }
    }
}