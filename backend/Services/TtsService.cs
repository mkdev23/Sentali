using Microsoft.CognitiveServices.Speech;
using Microsoft.CognitiveServices.Speech.Audio;
using Azure.Identity;

namespace SentaliApp.Services;

public class TtsService
{
    private readonly SpeechConfig _config;

    public TtsService(IConfiguration config)
    {
        _config = SpeechConfig.FromEndpoint(
            new Uri(config["SPEECH_ENDPOINT"]!),
            new DefaultAzureCredential());
        _config.SpeechSynthesisVoiceName = "en-US-JennyNeural";
    }

    public async Task<byte[]> Synthesize(string text)
    {
        using var stream = AudioOutputStream.CreatePullStream();
        using var audioConfig = AudioConfig.FromStreamOutput(stream);
        using var synthesizer = new SpeechSynthesizer(_config, audioConfig);
        await synthesizer.SpeakTextAsync(text);

        using var ms = new MemoryStream();
        var buffer = new byte[32000];
        uint bytesRead;
        while ((bytesRead = stream.Read(buffer)) > 0)
            ms.Write(buffer, 0, (int)bytesRead);

        return ms.ToArray();
    }
}
