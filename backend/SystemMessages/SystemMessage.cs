using OpenAI.Chat; // <-- Needed for ChatClient & message types

namespace SentaliApp.SystemMessages;

public class SystemMessage
{
    private readonly ChatClient _chatClient;

    public SystemMessage(ChatClient chatClient)
    {
        _chatClient = chatClient;
    }

    public async Task<string> GetResponse(string input)
    {
        var response = await _chatClient.CompleteChatAsync(
            new ChatMessage[]
            {
                new SystemChatMessage("You are a helpful assistant."),
                new UserChatMessage(input)
            }
        );

        return response.Value.Content[0].Text;
    }
}