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
        private readonly GptService _gpt;
        private readonly TtsService _tts;
        private readonly SentimentService _sentiment;
        private readonly BlobStorageService _blob;
        private readonly WsHub _ws;
        private readonly ILogger<TtsController> _logger;

        public TtsController(
            GptService gpt,
            TtsService tts,
            SentimentService sentiment,
            BlobStorageService blob,
            WsHub ws,
            ILogger<TtsController> logger)
        {
            _gpt       = gpt;
            _tts       = tts;
            _sentiment = sentiment;
            _blob      = blob;
            _ws        = ws;
            _logger    = logger;
        }

        [HttpPost]
        public async Task<IActionResult> Post([FromBody] ChatRequest req)
        {
            if (req == null || string.IsNullOrWhiteSpace(req.Text))
                return BadRequest(new { error = "Missing 'text' property" });

            _logger.LogInformation("[TTS] Input: {Text}", req.Text);

            // 1) GPT reply
            var reply = await _gpt.GetResponse(req.Text);

            // 2) Sentiment → expression
            var sentiment  = await _sentiment.GetSentiment(reply);
            var expression = sentiment switch
            {
                "Positive" => "joy",
                "Negative" => "angry",
                _          => "neutral"
            };
            _logger.LogInformation(
                "[TTS] Sentiment: {Sentiment}, Expression: {Expression}",
                sentiment, expression);

            // 3) Synthesize + collect visemes
            (byte[] audioBytes, List<SpeechSynthesisVisemeEventArgs> visemes) 
                = await _tts.SynthesizeWithVisemesAsync(reply);

            // 4) Upload audio → SAS URL
            var audioUrl = await _blob.UploadAndGetSas(audioBytes);

            // 5) Build a List<VisemePayload> with correct types
            var visemePayload = visemes
                .Select(v => new VisemePayload
                {
                    VisemeId = (uint)v.VisemeId,
                    TimeMs   = (ulong)(v.AudioOffset / 10_000)
                })
                .ToList();

            // 6) Default to joy if no visemes emitted
            if (visemePayload.Count == 0)
            {
                visemePayload.Add(new VisemePayload
                {
                    VisemeId = 0U,
                    TimeMs   = 0UL
                });
                expression = "joy";
            }

            // 7) Broadcast blendshapes + audio to WebSocket clients
            _ws.Broadcast(new
            {
                type       = "blendshapes",
                audioUrl,
                expression,
                visemes    = visemePayload
            });

            // 8) Return structured JSON
            return Ok(new
            {
                text       = reply,
                sentiment,
                expression,
                audioUrl,
                visemes    = visemePayload
            });
        }
    }
}