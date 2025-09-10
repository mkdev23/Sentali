using System;
using System.Threading.Tasks;
using Azure;
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
            // Try key-based auth first
            var endpoint = config["SENTIMENT_ENDPOINT"];
            var key = config["SENTIMENT_KEY"];

            if (!string.IsNullOrWhiteSpace(endpoint) && !string.IsNullOrWhiteSpace(key))
            {
                Console.WriteLine("[Sentiment] Using key-based auth");
                var cred = new AzureKeyCredential(key);
                _client = new TextAnalyticsClient(new Uri(endpoint), cred);
            }
            else
            {
                // Fallback to Managed Identity
                Console.WriteLine("[Sentiment] Using Managed Identity auth");
                var miEndpoint = config["AZURE_TEXT_ANALYTICS_ENDPOINT"]
                    ?? throw new Exception("Missing AZURE_TEXT_ANALYTICS_ENDPOINT for Managed Identity auth");

                var cred = new DefaultAzureCredential();
                _client = new TextAnalyticsClient(new Uri(miEndpoint), cred);
            }
        }

        public async Task<string> GetSentiment(string input)
        {
            var response = await _client.AnalyzeSentimentAsync(input);
            return response.Value.Sentiment.ToString();
        }
    }
}