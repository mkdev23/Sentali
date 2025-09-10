// TtsService.cs
using System;
using System.Collections.Generic;
using System.IO;
using System.Threading.Tasks;
using Azure.Core;
using Azure.Identity;
using Microsoft.CognitiveServices.Speech;
using Microsoft.CognitiveServices.Speech.Audio;
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

      _speechConfig.SpeechSynthesisVoiceName = "en-GB-SoniaNeural";
      _speechConfig.SetSpeechSynthesisOutputFormat(SpeechSynthesisOutputFormat.Riff24Khz16BitMonoPcm);

      // Dummy warm-up on startup to reduce first-call delay
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
      // Chunk long text to reduce latency (e.g., >100 words or 500 chars)
      if (text.Length > 500)
      {
        var chunks = ChunkText(text);
        var allAudio = new List<byte>();
        var allVisemes = new List<(uint VisemeId, long AudioOffset)>();
        long offsetTicks = 0; // Use ticks (100ns) for precision

        foreach (var chunk in chunks)
        {
          var (chunkAudio, chunkVisemes) = await SynthesizeChunkAsync(chunk, cancellationToken);
          allAudio.AddRange(chunkAudio);
          foreach (var (visemeId, audioOffset) in chunkVisemes)
          {
            allVisemes.Add((visemeId, audioOffset + offsetTicks));
          }
          offsetTicks += GetDurationTicks(chunkAudio); // Estimate next offset in ticks
        }
        return (allAudio.ToArray(), allVisemes);
      }
      else
      {
        return await SynthesizeChunkAsync(text, cancellationToken);
      }
    }

    private async Task<(byte[] Audio, List<(uint VisemeId, long AudioOffset)> Visemes)>
      SynthesizeChunkAsync(string text, CancellationToken cancellationToken)
    {
      var visemes = new List<(uint VisemeId, long AudioOffset)>();

      using var audioStream = AudioOutputStream.CreatePullStream();
      using var audioConfig = AudioConfig.FromStreamOutput(audioStream);
      using var synthesizer = new SpeechSynthesizer(_speechConfig, audioConfig);

      synthesizer.VisemeReceived += (_, e) => visemes.Add(((uint)e.VisemeId, (long)e.AudioOffset));

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

      await using var ms = new MemoryStream();
      var buffer = new byte[32_000];
      uint bytesRead;
      while ((bytesRead = audioStream.Read(buffer)) > 0)
      {
        ms.Write(buffer, 0, (int)bytesRead);
      }

      var wavBytes = ms.ToArray();
      var mp3Bytes = ConvertWavToMp3(wavBytes);
      return (mp3Bytes, visemes);
    }

    private List<string> ChunkText(string text)
    {
      var chunks = new List<string>();
      var sentences = text.Split(new[] { '.', '!', '?' }, StringSplitOptions.RemoveEmptyEntries);
      var currentChunk = "";
      foreach (var sentence in sentences)
      {
        if (currentChunk.Length + sentence.Length > 500)
        {
          chunks.Add(currentChunk.Trim());
          currentChunk = "";
        }
        currentChunk += sentence + ". ";
      }
      if (!string.IsNullOrEmpty(currentChunk)) chunks.Add(currentChunk.Trim());
      return chunks;
    }

    private long GetDurationTicks(byte[] audioBytes)
    {
      using var ms = new MemoryStream(audioBytes);
      using var reader = new WaveFileReader(ms);
      return (long)(reader.TotalTime.TotalMilliseconds * 10000); // ms to 100ns ticks
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

    public async Task<string> SynthesizeToFileAsync(string text, string tempPath, string finalPath, string baseUrl, WsHub? ws = null)
    {
      using var audioConfig = AudioConfig.FromWavFileOutput(tempPath);
      using var synthesizer = new SpeechSynthesizer(_speechConfig, audioConfig);

      if (ws != null)
      {
        synthesizer.VisemeReceived += (s, e) =>
        {
          var visemeName = MapVisemeIdToBlendshape(e.VisemeId);
          if (visemeName != null)
          {
            ws.Broadcast(new { type = "viseme", name = visemeName, weight = 1.0 });
            Task.Delay(120).ContinueWith(_ =>
              ws.Broadcast(new { type = "viseme", name = visemeName, weight = 0.0 })
            );
          }
        };
      }

      var result = await synthesizer.SpeakTextAsync(text);

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
            return await SynthesizeToFileAsync(text, tempPath, finalPath, baseUrl, ws);
          }

          throw new Exception($"TTS failed: {cancellation.Reason} - {cancellation.ErrorDetails}");
        }

        throw new Exception($"TTS failed: {result.Reason}");
      }

      ConvertToMp3(tempPath, finalPath);
      return $"{baseUrl}/tts/output.mp3?v={DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()}";
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