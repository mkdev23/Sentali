using System;
using System.Collections.Generic;
using System.IO;
using System.Threading;
using System.Threading.Tasks;
using Azure.Core;
using Azure.Identity;
using Microsoft.CognitiveServices.Speech;
using Microsoft.CognitiveServices.Speech.Audio;
using Microsoft.Extensions.Configuration;

namespace SentaliApp.Services
{
    public class TtsService
    {
        private readonly SpeechConfig _speechConfig;

        // Old no-arg constructor preserved
        public TtsService()
        {
            // If you want to load config here, you can pull from environment variables
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

            _speechConfig.SpeechSynthesisVoiceName = "en-US-JennyNeural";
            _speechConfig.SetSpeechSynthesisOutputFormat(SpeechSynthesisOutputFormat.Riff24Khz16BitMonoPcm);
            _speechConfig.SetServiceProperty(
                "speech.synthesis.requestViseme",
                "true",
                ServicePropertyChannel.UriQueryParameter
            );
        }

        // Old method name preserved
        public Task<(byte[] Audio, List<(uint VisemeId, long AudioOffset)> Visemes)>
            SynthesizeWithVisemeAndLipsync(string text, CancellationToken cancellationToken = default)
            => SynthesizeWithVisemesAsync(text, cancellationToken);

        // New internal method with Option 2 streaming
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

            using var stream = AudioOutputStream.CreatePullStream();
            using var audioConfig = AudioConfig.FromStreamOutput(stream);
            using var synthesizer = new SpeechSynthesizer(_speechConfig, audioConfig);

            synthesizer.VisemeReceived += (_, e) =>
            {
                Console.WriteLine($"[TTS] Viseme {e.VisemeId} at {e.AudioOffset} ticks");
                visemes.Add(((uint)e.VisemeId, (long)e.AudioOffset));
            };

            using var ms = new MemoryStream();

            // Start draining audio immediately
            var readTask = Task.Run(() =>
            {
                var buffer = new byte[32000];
                uint bytesRead;
                while ((bytesRead = stream.Read(buffer)) > 0)
                {
                    ms.Write(buffer, 0, (int)bytesRead);
                }
            });

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

            await readTask; // ensure all audio is read

            var audioBytes = ms.ToArray();
            Console.WriteLine($"[TTS] Done: audio={audioBytes.Length}B, visemes={visemes.Count}");

            return (audioBytes, visemes);
        }

        public string? MapVisemeIdToBlendshape(uint id) => id switch
        {
            0u => null,
            1u => "aa",
            2u => "aa",
            3u => "ih",
            4u => "ee",
            5u => "oh",
            6u => "ou",
            7u => "ou",
            8u => "ee",
            9u => "ih",
            10u => "oh",
            11u => "ou",
            12u => "aa",
            13u => "ee",
            14u => "ih",
            15u => "oh",
            16u => "ou",
            17u => "aa",
            18u => "ee",
            19u => "ih",
            20u => "oh",
            _ => null
        };
    }
}