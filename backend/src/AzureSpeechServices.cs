using System.Net.WebSockets;
using System.Text;
using System.Text.Json;
using Microsoft.CognitiveServices.Speech;
using Microsoft.CognitiveServices.Speech.Audio;
using NAudio.Wave;
using NAudio.Lame;

namespace SentaliApp.Services
{
    public class AzureSpeechService
    {
        private readonly WsHub _ws;

        public AzureSpeechService(WsHub ws) => _ws = ws;

        public async Task SpeakWithVisemesAsync(string text, string expression)
        {
            var key = Environment.GetEnvironmentVariable("AZURE_TTS_KEY");
            var region = Environment.GetEnvironmentVariable("AZURE_TTS_REGION");

            if (string.IsNullOrWhiteSpace(key) || string.IsNullOrWhiteSpace(region))
            {
                Console.WriteLine("[AzureSpeechService] Missing Azure TTS credentials. Aborting.");
                return;
            }

            var speechConfig = SpeechConfig.FromSubscription(key, region);
            speechConfig.SpeechSynthesisVoiceName = "en-US-JennyNeural";
            speechConfig.SetSpeechSynthesisOutputFormat(SpeechSynthesisOutputFormat.Riff24Khz16BitMonoPcm);

            var tempPath = Path.Combine("wwwroot", "tts", "azure_raw.wav");
            var finalPath = Path.Combine("wwwroot", "tts", "output.mp3");
            Directory.CreateDirectory(Path.GetDirectoryName(tempPath)!);

            try
            {
                using var audioConfig = AudioConfig.FromWavFileOutput(tempPath);
                using var synthesizer = new SpeechSynthesizer(speechConfig, audioConfig);

                synthesizer.VisemeReceived += (s, e) =>
                {
                    var visemeName = MapVisemeIdToBlendshape(e.VisemeId);
                    if (visemeName != null)
                    {
                        _ws.Broadcast(new { type = "viseme", name = visemeName, weight = 1.0 });
                        Task.Delay(120).ContinueWith(_ =>
                            _ws.Broadcast(new { type = "viseme", name = visemeName, weight = 0.0 })
                        );
                    }
                };

                var result = await synthesizer.SpeakTextAsync(text);
                if (result.Reason != ResultReason.SynthesizingAudioCompleted)
                {
                    Console.WriteLine($"[ERROR] Speech synthesis failed: {result.Reason}");
                    return;
                }
            }
            catch (Exception ex)
            {
                Console.WriteLine($"[ERROR] TTS synthesis exception: {ex.Message}");
                return;
            }

            try
            {
                ConvertToMp3(tempPath, finalPath);
            }
            catch (Exception ex)
            {
                Console.WriteLine($"[ERROR] MP3 conversion failed: {ex.Message}");
                return;
            }

            var baseUrl = Environment.GetEnvironmentVariable("BASE_URL") 
              ?? $"https://{Environment.GetEnvironmentVariable("WEBSITE_HOSTNAME")}";

            var publicUrl = $"{baseUrl}/tts/output.mp3?v={DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()}";

            _ws.Broadcast(new
            {
                type = "blendshapes",
                values = new Dictionary<string, double> { { expression, 1.0 } },
                audio = publicUrl
            });
        }

        private void ConvertToMp3(string inputPath, string outputPath)
        {
            using var reader = new WaveFileReader(inputPath);
            var newFormat = new WaveFormat(16000, 16, 1);
            using var pcmStream = new WaveFormatConversionStream(newFormat, reader);
            using var writer = new LameMP3FileWriter(outputPath, newFormat, LAMEPreset.ABR_128);
            pcmStream.CopyTo(writer);
        }

        private string? MapVisemeIdToBlendshape(uint id) => id switch
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
