using System;
using System.Collections.Generic;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Logging;
using Microsoft.CognitiveServices.Speech;   // for SpeechConfig, SpeechSynthesisVisemeEventArgs, ResultReason
using Microsoft.CognitiveServices.Speech.Audio;  // for AudioConfig, AudioOutputStream
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
        public async Task<IActionResult> Post([FromBody] string text)
        {
            if (string.IsNullOrWhiteSpace(text))
                return BadRequest(new { error = "No text provided" });

            try
            {
                _logger.LogInformation("[TTS] Input: {Text}", text);

                // 1) Get GPT reply
                var reply = await _gpt.GetResponse(text);
                _logger.LogInformation("[TTS] GPT → {Reply}", reply);

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

                // 3) Synthesize + visemes
                (byte[] audioBytes, List<SpeechSynthesisVisemeEventArgs> visemes) 
                    = await _tts.SynthesizeWithVisemesAsync(reply);

                // 4) Upload audio, get URL
                var audioUrl = await _blob.UploadAndGetSas(audioBytes);

                // 5) Build viseme payload
                var visemePayload = new List<object>();
                foreach (var v in visemes)
                {
                    visemePayload.Add(new
                    {
                        VisemeId = v.VisemeId,
                        TimeMs   = (int)(v.AudioOffset / 10_000)
                    });
                }

                // 6) Default to joy if no visemes emitted
                if (visemePayload.Count == 0)
                {
                    visemePayload.Add(new { VisemeId = 0, TimeMs = 0 });
                    expression = "joy";
                }

                // 7) Broadcast blendshapes + audio
                _ws.Broadcast(new
                {
                    type       = "blendshapes",
                    audioUrl,
                    expression,
                    visemes    = visemePayload
                });

                // 8) Return to caller
                return Ok(new
                {
                    text       = reply,
                    sentiment,
                    expression,
                    audioUrl,
                    visemes    = visemePayload
                });
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "[TTS] Error");
                return StatusCode(500, new { error = ex.Message });
            }
        }
    }
}