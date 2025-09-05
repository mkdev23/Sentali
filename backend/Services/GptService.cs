using System.Net.Http;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using Azure.Identity;

namespace SentaliApp.Services;

public class GptService
{
    private readonly HttpClient _http;
    private readonly string _agentId;
    private readonly string _projectName;
    private readonly string _endpoint;

    public GptService(IConfiguration config)
    {
        _http = new HttpClient();
        _agentId = config["AZURE_AI_AGENT_ID"]!;
        _projectName = config["AZURE_AI_PROJECT_NAME"]!;
        _endpoint = config["AZURE_AI_PROJECT_ENDPOINT"]!;
    }

    public async Task<string> GetResponse(string input)
    {
        var credential = new DefaultAzureCredential();
        var token = await credential.GetTokenAsync(
            new Azure.Core.TokenRequestContext(new[] { "https://cognitiveservices.azure.com/.default" })
        );

        _http.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token.Token);

        // Create thread
        var threadRes = await _http.PostAsync(
            $"{_endpoint}/api/projects/{_projectName}/threads",
            new StringContent("{}", Encoding.UTF8, "application/json")
        );
        var threadId = JsonDocument.Parse(await threadRes.Content.ReadAsStringAsync())
                                   .RootElement.GetProperty("id").GetString();

        // Send message
        var messagePayload = JsonSerializer.Serialize(new { role = "user", content = input });
        await _http.PostAsync(
            $"{_endpoint}/api/projects/{_projectName}/threads/{threadId}/messages",
            new StringContent(messagePayload, Encoding.UTF8, "application/json")
        );

        // Run agent
        var runPayload = JsonSerializer.Serialize(new { agentId = _agentId });
        var runRes = await _http.PostAsync(
            $"{_endpoint}/api/projects/{_projectName}/threads/{threadId}/runs",
            new StringContent(runPayload, Encoding.UTF8, "application/json")
        );
        var runId = JsonDocument.Parse(await runRes.Content.ReadAsStringAsync())
                                .RootElement.GetProperty("id").GetString();

        // Poll for completion
        while (true)
        {
            var statusJson = await (await _http.GetAsync(
                $"{_endpoint}/api/projects/{_projectName}/threads/{threadId}/runs/{runId}"
            )).Content.ReadAsStringAsync();

            var status = JsonDocument.Parse(statusJson).RootElement.GetProperty("status").GetString();
            if (status == "completed") break;
            if (status == "failed") return "[Agent Error]";
            await Task.Delay(500);
        }

        // Get messages
        var messagesJson = await (await _http.GetAsync(
            $"{_endpoint}/api/projects/{_projectName}/threads/{threadId}/messages"
        )).Content.ReadAsStringAsync();

        foreach (var msg in JsonDocument.Parse(messagesJson).RootElement.EnumerateArray())
        {
            if (msg.GetProperty("role").GetString() == "assistant")
                return msg.GetProperty("content").GetString() ?? "[No response]";
        }

        return "[No assistant message found]";
    }
}
