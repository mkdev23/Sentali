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

            // Use MP3 directly from Azure Speech
            /* _speechConfig.SpeechSynthesisVoiceName = "en-US-JennyNeural";
             _speechConfig.SetSpeechSynthesisOutputFormat(SpeechSynthesisOutputFormat.Audio16Khz32KBitRateMonoMp3);

             // Enable viseme events
             _speechConfig.SetServiceProperty(
                 "speech.synthesis.requestViseme",
                 "true",
                 ServicePropertyChannel.UriQueryParameter
             ); */
            _speechConfig.SpeechSynthesisVoiceName = "en-US-JennyNeural";
            // For debug, PCM is more reliable for viseme events
            _speechConfig.SetSpeechSynthesisOutputFormat(SpeechSynthesisOutputFormat.Riff24Khz16BitMonoPcm);

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

            // Create a pull stream to capture audio and trigger events
            using var stream = AudioOutputStream.CreatePullStream();
            using var audioConfig = AudioConfig.FromStreamOutput(stream);
            using var synthesizer = new SpeechSynthesizer(_speechConfig, audioConfig);

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

            // Read audio bytes from the pull stream
            using var ms = new MemoryStream();
            var buffer = new byte[32000];
            uint bytesRead;
            while ((bytesRead = stream.Read(buffer)) > 0)
            {
                ms.Write(buffer, 0, (int)bytesRead);
            }

            var audioBytes = ms.ToArray();
            Console.WriteLine($"[TTS] Done: audio={audioBytes.Length}B, visemes={visemes.Count}");

            return (audioBytes, visemes);
        }

    }
}