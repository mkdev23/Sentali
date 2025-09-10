using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Logging;
using Microsoft.CognitiveServices.Speech;      // for SpeechSynthesisVisemeEventArgs
using Microsoft.CognitiveServices.Speech.Audio;
using SentaliApp.Models;                      // for ChatRequest, VisemePayload
using SentaliApp.Services;

namespace SentaliApp.Controllers
{
    [ApiController]
    [Route("api/tts")]
    public class TtsController : ControllerBase
    {
        private readonly TtsService _tts;
        private readonly SentimentService _sentiment;
        private readonly BlobStorageService _blob;
        private readonly WsHub _ws;
        private readonly ILogger<TtsController> _logger;

        public TtsController(
            TtsService tts,
            SentimentService sentiment,
            BlobStorageService blob,
            WsHub ws,
            ILogger<TtsController> logger)
        {
            _tts = tts;
            _sentiment = sentiment;
            _blob = blob;
            _ws = ws;
            _logger = logger;
        }

        [HttpPost]
        public async Task<IActionResult> Post([FromBody] ChatRequest req)
        {
            if (req == null || string.IsNullOrWhiteSpace(req.Text))
                return BadRequest(new { error = "Missing 'text' property" });

            _logger.LogInformation("[TTS] Speaking provided text: {Text}", req.Text);

            try
            {
                // 1) Sentiment → expression
                var sentiment = await _sentiment.GetSentiment(req.Text);
                var expression = sentiment switch
                {
                    "Positive" => "joy",
                    "Negative" => "angry",
                    _ => "neutral"
                };
                _logger.LogInformation("[TTS] Sentiment: {Sentiment}, Expression: {Expression}", sentiment, expression);

                // 2) Synthesize + collect visemes with timeout
                using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(15));
                _logger.LogInformation("[TTS] Starting synthesis...");
                var (audioBytes, visemes) = await _tts.SynthesizeWithVisemesAsync(req.Text, cts.Token);
                _logger.LogInformation("[TTS] Synthesis complete, {Length} bytes", audioBytes?.Length ?? 0);

                if (audioBytes == null || audioBytes.Length == 0)
                {
                    _logger.LogWarning("[TTS] No audio returned from synthesis");
                    return Problem("TTS produced no audio", statusCode: 500);
                }

                // 3) Upload audio → SAS URL
                _logger.LogInformation("[TTS] Uploading to blob...");
                var audioUrl = await _blob.UploadAndGetSas(audioBytes);
                _logger.LogInformation("[TTS] Blob uploaded: {Url}", audioUrl);

                // 4) Build viseme payload
                var visemePayload = visemes
                    .Select(v => new VisemePayload
                    {
                        VisemeId = (uint)v.VisemeId,
                        TimeMs = (ulong)(v.AudioOffset / 10_000)
                    })
                    .ToList();

                if (visemePayload.Count == 0)
                {
                    visemePayload.Add(new VisemePayload { VisemeId = 0U, TimeMs = 0UL });
                    expression = "joy";
                }

                // 5) Broadcast to WS clients
                _ws.Broadcast(new
                {
                    type = "blendshapes",
                    audioUrl,
                    expression,
                    visemes = visemePayload
                });
                _logger.LogInformation("[TTS] Broadcast complete");

                // 6) Return structured JSON
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
                return Problem("TTS synthesis timed out", statusCode: 504);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "[TTS] Pipeline failed");
                return Problem("TTS pipeline failed", ex.Message, 500);
            }
        }
    }
}