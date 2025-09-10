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
            // Your Speech endpoint, e.g. "https://<your-resource>.tts.speech.azure.com"
            var endpointUrl = config["SPEECH_ENDPOINT"]
                ?? throw new Exception("Missing SPEECH_ENDPOINT");
            var endpointUri = new Uri(endpointUrl);

            // Acquire a token using Managed Identity
            var cred = new DefaultAzureCredential();
            var token = cred.GetToken(
                new TokenRequestContext(new[] { "https://cognitiveservices.azure.com/.default" }),
                default);

            Console.WriteLine("[TTS] Acquired Managed Identity token");

            // Build SpeechConfig from the token
            _speechConfig = SpeechConfig.FromAuthorizationToken(
                token.Token,
                endpointUri.Host);
            _speechConfig.SpeechSynthesisVoiceName = "en-US-JennyNeural";
            _speechConfig.SetSpeechSynthesisOutputFormat(
                SpeechSynthesisOutputFormat.Riff24Khz16BitMonoPcm);
        }

        /// <summary>
        /// Synthesizes speech for the given text, capturing viseme events.
        /// Returns the raw audio bytes plus a list of VisemeEventArgs.
        /// </summary>
        public async Task<(byte[] Audio, List<VisemeEventArgs> Visemes)> SynthesizeWithVisemesAsync(string text)
        {
            var visemeList = new List<VisemeEventArgs>();

            using var audioStream = AudioOutputStream.CreatePullStream();
            using var audioConfig = AudioConfig.FromStreamOutput(audioStream);
            using var synthesizer = new SpeechSynthesizer(_speechConfig, audioConfig);

            synthesizer.VisemeReceived += (_, e) =>
            {
                visemeList.Add(e);
            };

            var result = await synthesizer.SpeakTextAsync(text);
            if (result.Reason != ResultReason.SynthesizingAudioCompleted)
                throw new Exception($"TTS failed: {result.Reason}");

            // Read out the audio bytes
            await using var ms = new MemoryStream();
            var buffer = new byte[32_000];
            uint bytesRead;
            while ((bytesRead = audioStream.Read(buffer)) > 0)
            {
                ms.Write(buffer, 0, (int)bytesRead);
            }

            return (ms.ToArray(), visemeList);
        }
    }
}