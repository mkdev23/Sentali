using Azure.AI.TextAnalytics;
using Azure.Identity;

namespace SentaliApp.Services;

public class SentimentService
{
    private readonly TextAnalyticsClient? _client;

    public SentimentService(IConfiguration config)
    {
        var textAnalyticsEndpoint = config["TEXT_ANALYTICS_ENDPOINT"];
        var cred = new DefaultAzureCredential();
        
        if (!string.IsNullOrEmpty(textAnalyticsEndpoint))
        {
            Console.WriteLine("[Sentiment] Using dedicated Text Analytics endpoint");
            _client = new TextAnalyticsClient(new Uri(textAnalyticsEndpoint), cred);
        }
        else
        {
            // Fallback to a simple sentiment analysis or disable the service
            Console.WriteLine("[Sentiment] Warning: TEXT_ANALYTICS_ENDPOINT not configured. Sentiment analysis will return 'Neutral'");
            _client = null;
        }
    }

    public async Task<string> GetSentiment(string input)
    {
        if (_client == null)
        {
            Console.WriteLine("[Sentiment] Client not configured, returning 'Neutral'");
            return "Neutral";
        }
        
        try
        {
            var result = await _client.AnalyzeSentimentAsync(input);
            return result.Value.Sentiment.ToString();
        }
        catch (Exception ex)
        {
            Console.WriteLine($"[Sentiment] Error analyzing sentiment: {ex.Message}");
            return "Neutral";
        }
    }
}
