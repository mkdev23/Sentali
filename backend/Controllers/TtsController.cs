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
            if (req == null || string.IsNullOrEmpty(req.Text))
               return BadRequest(new { error = "Missing 'text' property" });

            _logger.LogInformation("[TTS] Speaking provided text: {Text}", req.Text);

            // 1) Sentiment → expression
            var sentiment = await _sentiment.GetSentiment(req.Text);
            var expression = sentiment switch
            {
                "Positive" => "joy",
                "Negative" => "angry",
                _ => "neutral"
            };
            _logger.LogInformation(
                "[TTS] Sentiment: {Sentiment}, Expression: {Expression}",
                sentiment, expression);

            // 2) Synthesize + collect visemes
            (byte[] audioBytes, List<SpeechSynthesisVisemeEventArgs> visemes)
                = await _tts.SynthesizeWithVisemesAsync(req.Text);

            // 3) Upload audio → SAS URL
            var audioUrl = await _blob.UploadAndGetSas(audioBytes);

            // 4) Build viseme payload
            var visemePayload = visemes
                .Select(v => new VisemePayload
                {
                    VisemeId = (uint)v.VisemeId,
                    TimeMs = (ulong)(v.AudioOffset / 10_000)
                })
                .ToList();

            // 5) Default to joy if no visemes emitted
            if (visemePayload.Count == 0)
            {
                visemePayload.Add(new VisemePayload
                {
                    VisemeId = 0U,
                    TimeMs = 0UL
                });
                expression = "joy";
            }

            // 6) Broadcast to WS clients
            _ws.Broadcast(new
            {
                type = "blendshapes",
                audioUrl,
                expression,
                visemes = visemePayload
            });

            // 7) Return structured JSON
            return Ok(new
            {
                sentiment,
                expression,
                audioUrl,
                visemes = visemePayload
            });
        }
    }
}