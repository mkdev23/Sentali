using System;
using System.Collections.Generic;
using System.IO;
using System.Threading;
using System.Threading.Tasks;
using Azure.Core;
using Azure.Identity;
using Microsoft.CognitiveServices.Speech;
using Microsoft.Extensions.Configuration;
using NAudio.Wave;
using NAudio.Lame;

namespace SentaliApp.Services
{
    public class TtsService
    {
        private readonly SpeechConfig _speechConfig;

        public TtsService(IConfiguration config)
        {
            var endpointUrl = config["SPEECH_ENDPOINT"]?.Trim()
                ?? throw new Exception("Missing SPEECH_ENDPOINT");
            var endpointUri = new Uri(endpointUrl);

            var key = config["AZURE_TTS_KEY"]?.Trim() ?? config["TTS_KEY"]?.Trim();
            var region = config["AZURE_TTS_REGION"]?.Trim() ?? config["TTS_REGION"]?.Trim();

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

            // Force known-good viseme-capable voice for debug
            _speechConfig.SpeechSynthesisVoiceName = "en-US-JennyNeural";
            _speechConfig.SetSpeechSynthesisOutputFormat(SpeechSynthesisOutputFormat.Riff24Khz16BitMonoPcm);

            // Explicitly request viseme events
            _speechConfig.SetServiceProperty(
                "speech.synthesis.requestViseme",
                "true",
                ServicePropertyChannel.UriQueryParameter
);


            WarmUpAsync().GetAwaiter().GetResult();
        }

        private async Task WarmUpAsync()
        {
            try
            {
                Console.WriteLine("[TTS] Warming up with dummy synthesis");
                await SynthesizeWithVisemesAsync("Warm-up test", new CancellationTokenSource(TimeSpan.FromSeconds(10)).Token);
                Console.WriteLine("[TTS] Warm-up complete");
            }
            catch (Exception ex)
            {
                Console.WriteLine("[TTS] Warm-up failed: " + ex.Message);
            }
        }

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

                    if (cancellation.ErrorDetails?.Contains("Voice", StringComparison.OrdinalIgnoreCase) == true)
                    {
                        Console.WriteLine("[TTS] Falling back to en-US-JennyNeural");
                        _speechConfig.SpeechSynthesisVoiceName = "en-US-JennyNeural";
                        return await SynthesizeChunkAsync(text, cancellationToken);
                    }

                    throw new Exception($"TTS failed: {cancellation.Reason} - {cancellation.ErrorDetails}");
                }

                throw new Exception($"TTS failed: {result.Reason}");
            }

            var wavBytes = result.AudioData;
            if (wavBytes == null || wavBytes.Length == 0)
            {
                Console.WriteLine("[TTS] WARNING: Synth returned 0 bytes — retrying once...");
                return await SynthesizeChunkAsync(text, cancellationToken);
            }

            var mp3Bytes = ConvertWavToMp3(wavBytes);
            Console.WriteLine($"[TTS] Done: audio={mp3Bytes.Length}B, visemes={visemes.Count}");
            return (mp3Bytes, visemes);
        }

        private byte[] ConvertWavToMp3(byte[] wavBytes)
        {
            using var inputMs = new MemoryStream(wavBytes);
            using var reader = new WaveFileReader(inputMs);
            using var outputMs = new MemoryStream();
            using var writer = new LameMP3FileWriter(outputMs, reader.WaveFormat, LAMEPreset.ABR_128);
            reader.CopyTo(writer);
            return outputMs.ToArray();
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