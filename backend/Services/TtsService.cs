using Microsoft.CognitiveServices.Speech;
using Microsoft.CognitiveServices.Speech.Audio;
using Azure.Identity;

namespace SentaliApp.Services;

public class TtsService
{
    private readonly SpeechConfig _config;

    public TtsService(IConfiguration config)
    {
        var ttsKey = config["AZURE_TTS_KEY"];
        var ttsRegion = config["AZURE_TTS_REGION"];

        if (!string.IsNullOrEmpty(ttsKey) && !string.IsNullOrEmpty(ttsRegion))
        {
            Console.WriteLine("[TTS] Using Azure TTS Key authentication");
            _config = SpeechConfig.FromSubscription(ttsKey, ttsRegion);
        }
        else
        {
            var endpoint = new Uri(config["SPEECH_ENDPOINT"] 
                ?? throw new Exception("Missing SPEECH_ENDPOINT or AZURE_TTS_KEY/AZURE_TTS_REGION"));

            // Acquire token using Managed Identity
            var credential = new DefaultAzureCredential();
            var tokenRequestContext = new Azure.Core.TokenRequestContext(
                new[] { "https://cognitiveservices.azure.com/.default" });
            var accessToken = credential.GetToken(tokenRequestContext, default);

            Console.WriteLine("[TTS] Got Speech token from Managed Identity");

            // Use FromAuthorizationToken for MI
            _config = SpeechConfig.FromAuthorizationToken(accessToken.Token, endpoint.Host);
        }
        
        _config.SpeechSynthesisVoiceName = "en-US-JennyNeural";
    }

    public async Task<byte[]> Synthesize(string text)
    {
        using var stream = AudioOutputStream.CreatePullStream();
        using var audioConfig = AudioConfig.FromStreamOutput(stream);
        using var synthesizer = new SpeechSynthesizer(_config, audioConfig);

        Console.WriteLine($"[TTS] Synthesizing: {text}");
        await synthesizer.SpeakTextAsync(text);

        using var ms = new MemoryStream();
        var buffer = new byte[32000];
        uint bytesRead;
        while ((bytesRead = stream.Read(buffer)) > 0)
            ms.Write(buffer, 0, (int)bytesRead);

        Console.WriteLine($"[TTS] Audio bytes: {ms.Length}");
        return ms.ToArray();
    }
}