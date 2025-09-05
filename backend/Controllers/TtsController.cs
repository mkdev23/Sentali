using Microsoft.AspNetCore.Mvc;
using SentaliApp.Services;

namespace SentaliApp.Controllers;

[ApiController]
[Route("api/[controller]")]
public class TtsController : ControllerBase
{
    private readonly GptService _gpt;
    private readonly SentimentService _sentiment;
    private readonly TtsService _tts;
    private readonly BlobStorageService _blob;

    public TtsController(GptService gpt, SentimentService sentiment, TtsService tts, BlobStorageService blob)
    {
        _gpt = gpt;
        _sentiment = sentiment;
        _tts = tts;
        _blob = blob;
    }

    [HttpPost]
    public async Task<IActionResult> Post([FromBody] string userInput)
    {
        var gptResponse = await _gpt.GetResponse(userInput);
        var sentiment = await _sentiment.GetSentiment(userInput);
        var expression = sentiment switch
        {
            "Positive" => "smile",
            "Negative" => "frown",
            _ => "neutral"
        };

        var audioBytes = await _tts.Synthesize(gptResponse);
        var sasUrl = await _blob.UploadAndGetSas(audioBytes);

        return Ok(new { text = gptResponse, sentiment, expression, audioUrl = sasUrl });
    }
}