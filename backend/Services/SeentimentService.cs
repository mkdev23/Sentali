using Azure.AI.TextAnalytics;
using Azure.Identity;

namespace SentaliApp.Services;

public class SentimentService
{
    private readonly TextAnalyticsClient _client;

    public SentimentService(IConfiguration config, DefaultAzureCredential cred)
    {
        _client = new TextAnalyticsClient(new Uri(config["TEXT_ANALYTICS_ENDPOINT"]!), cred);
    }

    public async Task<string> GetSentiment(string input)
    {
        var result = await _client.AnalyzeSentimentAsync(input);
        return result.Value.Sentiment.ToString();
    }
}