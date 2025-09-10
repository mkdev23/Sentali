using System;
using System.Threading.Tasks;
using Azure.AI.TextAnalytics;
using Azure.Identity;
using Microsoft.Extensions.Configuration;

namespace SentaliApp.Services
{
    public class SentimentService
    {
        private readonly TextAnalyticsClient _client;

        public SentimentService(IConfiguration config)
        {
            var cred = new DefaultAzureCredential();
            _client = new TextAnalyticsClient(
                new Uri(config["AZURE_TEXT_ANALYTICS_ENDPOINT"]!),
                cred);
        }

        public async Task<string> GetSentiment(string input)
        {
            var response = await _client.AnalyzeSentimentAsync(input);
            return response.Value.Sentiment.ToString();
        }
    }
}