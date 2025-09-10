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

            var key = config["AZURE_TTS_KEY"];
            var region = config["AZURE_TTS_REGION"];

            if (!string.IsNullOrWhiteSpace(key) && !string.IsNullOrWhiteSpace(region))
            {
                Console.WriteLine("[TTS] Using key-based auth");
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

            // ✅ Set Sonia as the default voice
            _speechConfig.SpeechSynthesisVoiceName = "en-GB-SoniaNeural";
            _speechConfig.SetSpeechSynthesisOutputFormat(
                SpeechSynthesisOutputFormat.Riff24Khz16BitMonoPcm);
        }

        /// <summary>
        /// Synthesizes speech for the given text, capturing viseme events.
        /// Returns raw audio bytes plus a list of SpeechSynthesisVisemeEventArgs.
        /// </summary>
        public async Task<(byte[] Audio, List<SpeechSynthesisVisemeEventArgs> Visemes)>
            SynthesizeWithVisemesAsync(string text)
        {
            var visemes = new List<SpeechSynthesisVisemeEventArgs>();

            using var audioStream = AudioOutputStream.CreatePullStream();
            using var audioConfig = AudioConfig.FromStreamOutput(audioStream);
            using var synthesizer = new SpeechSynthesizer(_speechConfig, audioConfig);

            synthesizer.VisemeReceived += (_, e) =>
            {
                visemes.Add(e);
            };

            // ✅ Build SSML for conversational style
            string ssml = $@"
<speak version='1.0' xml:lang='en-GB'>
  <voice name='en-GB-SoniaNeural'>
    <mstts:express-as style='chat' styledegree='2'>
      {System.Security.SecurityElement.Escape(text)}
    </mstts:express-as>
  </voice>
</speak>";

            // ✅ Use SpeakSsmlAsync instead of SpeakTextAsync
            var result = await synthesizer.SpeakSsmlAsync(ssml);
            if (result.Reason != ResultReason.SynthesizingAudioCompleted)
                throw new Exception($"TTS failed: {result.Reason}");

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