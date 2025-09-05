using Azure.AI.OpenAI;
using Azure.Identity;
using OpenAI.Chat; // <-- This is where ChatClient & message types live

namespace SentaliApp.Services;

public class GptService
{
    private readonly ChatClient _chatClient;

    public GptService(IConfiguration config, DefaultAzureCredential cred)
    {
        var endpoint = new Uri(config["OPENAI_ENDPOINT"]!);
        var aoaiClient = new AzureOpenAIClient(endpoint, cred);
        _chatClient = aoaiClient.GetChatClient(config["OPENAI_DEPLOYMENT"]!);
    }

    public async Task<string> GetResponse(string input)
    {
        var response = await _chatClient.CompleteChatAsync(
            new ChatMessage[]
            {
                new UserChatMessage(input)
            }
        );

        return response.Value.Content[0].Text;
    }
}