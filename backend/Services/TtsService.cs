using System;
using System.Collections.Generic;
using System.IO;
using System.Threading;
using System.Threading.Tasks;
using Azure.Core;
using Azure.Identity;
using Microsoft.CognitiveServices.Speech;
using Microsoft.Extensions.Configuration;

namespace SentaliApp.Services
{
    public class TtsService
    {
        private readonly SpeechConfig _speechConfig;

        // Track the current voice (default to female UK)
        private string _currentVoice = "en-GB-SoniaNeural";

        public void SetVoice(string voiceName)
        {
            _currentVoice = voiceName;
            _speechConfig.SpeechSynthesisVoiceName = _currentVoice;
            _speechConfig.SetSpeechSynthesisOutputFormat(SpeechSynthesisOutputFormat.Riff24Khz16BitMonoPcm);
            _speechConfig.SetServiceProperty(
                "speech.synthesis.requestViseme",
                "true",
                ServicePropertyChannel.UriQueryParameter
            );
            Console.WriteLine($"[TTS] Voice changed to {_currentVoice}");
        }

        // No-arg constructor for compatibility
        public TtsService()
        {
            var endpointUrl = Environment.GetEnvironmentVariable("SPEECH_ENDPOINT")?.Trim()
                ?? throw new Exception("Missing SPEECH_ENDPOINT");
            var endpointUri = new Uri(endpointUrl);

            var key = Environment.GetEnvironmentVariable("AZURE_TTS_KEY")?.Trim()
                      ?? Environment.GetEnvironmentVariable("TTS_KEY")?.Trim();
            var region = Environment.GetEnvironmentVariable("AZURE_TTS_REGION")?.Trim()
                         ?? Environment.GetEnvironmentVariable("TTS_REGION")?.Trim();

            if (!string.IsNullOrWhiteSpace(key) && !string.IsNullOrWhiteSpace(region))
            {
                Console.WriteLine($"[TTS] Using key-based auth (region={region})");
                _speechConfig = SpeechConfig.FromSubscription(key, region);
            }
            else
            {
                Console.WriteLine("[TTS] Using Managed Identity auth");
                var cred = new DefaultAzureCredential();
                var token = cred.GetToken(
                    new TokenRequestContext(new[] { "https://cognitiveservices.azure.com/.default" }),
                    default);

                _speechConfig = SpeechConfig.FromAuthorizationToken(token.Token, endpointUri.Host);
            }

            // Initialize with default voice
            SetVoice(_currentVoice);
        }

        // Old method name preserved for compatibility
        public Task<(byte[] Audio, List<(uint VisemeId, long AudioOffset)> Visemes)>
            SynthesizeWithVisemeAndLipsync(string text, CancellationToken cancellationToken = default)
            => SynthesizeWithVisemesAsync(text, cancellationToken);

        public async Task<(byte[] Audio, List<(uint VisemeId, long AudioOffset)> Visemes)>
            SynthesizeWithVisemesAsync(string text, CancellationToken cancellationToken = default)
        {
            Console.WriteLine($"[TTS] Start: len={text.Length}, voice={_speechConfig.SpeechSynthesisVoiceName}");
            return await SynthesizeChunkAsync(text, cancellationToken);
        }

        private async Task<(byte[] Audio, List<(uint VisemeId, long AudioOffset)> Visemes)>
            SynthesizeChunkAsync(string text, CancellationToken cancellationToken)
        {
            var visemes = new List<(uint VisemeId, long AudioOffset)>();

            using var synthesizer = new SpeechSynthesizer(_speechConfig, audioConfig: null);

            synthesizer.VisemeReceived += (_, e) =>
            {
                Console.WriteLine($"[TTS] Viseme {e.VisemeId} at {e.AudioOffset} ticks");
                visemes.Add(((uint)e.VisemeId, (long)e.AudioOffset));
            };

            var result = await synthesizer.SpeakTextAsync(text).WaitAsync(cancellationToken);

            if (result.Reason != ResultReason.SynthesizingAudioCompleted)
            {
                if (result.Reason == ResultReason.Canceled)
                {
                    var cancellation = SpeechSynthesisCancellationDetails.FromResult(result);
                    Console.WriteLine($"[TTS] Canceled: Reason={cancellation.Reason}");
                    Console.WriteLine($"[TTS] ErrorDetails={cancellation.ErrorDetails}");
                    throw new Exception($"TTS failed: {cancellation.Reason} - {cancellation.ErrorDetails}");
                }
                throw new Exception($"TTS failed: {result.Reason}");
            }

            var audioBytes = result.AudioData ?? Array.Empty<byte>();
            Console.WriteLine($"[TTS] Done: audio={audioBytes.Length}B, visemes={visemes.Count}");

            return (audioBytes, visemes);
        }
    }
}