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

        public TtsController(
            ILogger<TtsController> logger,
            SentimentService sentiment,
            TtsService tts,
            BlobStorageService blob)
        {
            _logger = logger;
            _sentiment = sentiment;
            _tts = tts;
            _blob = blob;
        }

        public class ChatRequest { public string? Text { get; set; } }

        // ✅ NEW: Voice change request DTO
        public class VoiceChangeRequest { public string? Voice { get; set; } }

        // ✅ NEW: Endpoint to change the TTS voice
        [HttpPost("set-voice")]
        public IActionResult SetVoice([FromBody] VoiceChangeRequest req)
        {
            if (req == null || string.IsNullOrWhiteSpace(req.Voice))
                return BadRequest(new { error = "Missing 'voice' property" });

            _tts.SetVoice(req.Voice);
            _logger.LogInformation("[TTS] Voice changed to {Voice}", req.Voice);

            return Ok(new { message = $"Voice changed to {req.Voice}" });
        }

        // Existing synthesis endpoint — unchanged
        [HttpPost]
        public async Task<IActionResult> Post([FromBody] ChatRequest req)
        {
            if (req == null || string.IsNullOrWhiteSpace(req.Text))
                return BadRequest(new { error = "Missing 'text' property" });

            _logger.LogInformation("[TTS] Text received: {Text}", req.Text);

            try
            {
                // Sentiment → expression
                var sentiment = await _sentiment.GetSentiment(req.Text);
                var expression = sentiment switch
                {
                    "Positive" => "joy",
                    "Negative" => "angry",
                    "Mixed" => "surprised",
                    _ => "neutral"
                };
                _logger.LogInformation("[TTS] Sentiment={Sentiment}, Expression={Expression}", sentiment, expression);

                // Synthesis with longer timeout
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
                    TimeMs = (ulong)v.AudioOffset / 10000UL
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