using System;
using System.Collections.Generic;
using System.IO;
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
            var endpointUrl = config["SPEECH_ENDPOINT"]
                ?? throw new Exception("Missing SPEECH_ENDPOINT");
            var endpointUri = new Uri(endpointUrl);

            // Prefer AZURE_TTS_KEY / AZURE_TTS_REGION, but fall back to TTS_KEY / TTS_REGION
            var key = config["AZURE_TTS_KEY"] ?? config["TTS_KEY"];
            var region = config["AZURE_TTS_REGION"] ?? config["TTS_REGION"];

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

                _speechConfig = SpeechConfig.FromAuthorizationToken(
                    token.Token,
                    endpointUri.Host);
            }

            // Default voice
            _speechConfig.SpeechSynthesisVoiceName = "en-GB-SoniaNeural";
            _speechConfig.SetSpeechSynthesisOutputFormat(
                SpeechSynthesisOutputFormat.Riff24Khz16BitMonoPcm);
        }

        public async Task<(byte[] Audio, List<SpeechSynthesisVisemeEventArgs> Visemes)>
            SynthesizeWithVisemesAsync(string text)
        {
            var visemes = new List<SpeechSynthesisVisemeEventArgs>();

            using var audioStream = AudioOutputStream.CreatePullStream();
            using var audioConfig = AudioConfig.FromStreamOutput(audioStream);
            using var synthesizer = new SpeechSynthesizer(_speechConfig, audioConfig);

            synthesizer.VisemeReceived += (_, e) => visemes.Add(e);

            string ssml = $@"
<speak version='1.0' xml:lang='en-GB'
       xmlns:mstts='https://www.w3.org/2001/mstts'>
  <voice name='{_speechConfig.SpeechSynthesisVoiceName}'>
    <mstts:express-as style='chat' styledegree='2'>
      {System.Security.SecurityElement.Escape(text)}
    </mstts:express-as>
  </voice>
</speak>";

            var result = await synthesizer.SpeakSsmlAsync(ssml);

            if (result.Reason != ResultReason.SynthesizingAudioCompleted)
            {
                if (result.Reason == ResultReason.Canceled)
                {
                    var cancellation = SpeechSynthesisCancellationDetails.FromResult(result);
                    Console.WriteLine($"[TTS] Canceled: Reason={cancellation.Reason}");
                    Console.WriteLine($"[TTS] ErrorDetails={cancellation.ErrorDetails}");
                    Console.WriteLine("[TTS] Did you set the speech resource key and region correctly?");

                    // Optional: fallback to a known-good voice if voice not found
                    if (cancellation.ErrorDetails != null &&
                        cancellation.ErrorDetails.Contains("Voice", StringComparison.OrdinalIgnoreCase))
                    {
                        Console.WriteLine("[TTS] Falling back to en-US-JennyNeural");
                        _speechConfig.SpeechSynthesisVoiceName = "en-US-JennyNeural";
                        return await SynthesizeWithVisemesAsync(text);
                    }

                    throw new Exception($"TTS failed: {cancellation.Reason} - {cancellation.ErrorDetails}");
                }

                throw new Exception($"TTS failed: {result.Reason}");
            }

            await using var ms = new MemoryStream();
            var buffer = new byte[32_000];
            uint bytesRead;
            while ((bytesRead = audioStream.Read(buffer)) > 0)
            {
                ms.Write(buffer, 0, (int)bytesRead);
            }

            return (ms.ToArray(), visemes);
        }
    }
}