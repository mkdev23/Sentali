using System.Net.Http;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using Azure.Identity;
public class GptService
{
    private readonly HttpClient _http;
    private readonly string _agentId;
    private readonly string _projectName;
    private readonly string _endpoint;

    public GptService(IConfiguration config)
    {
        _http = new HttpClient();
        _agentId = config["AZURE_AI_AGENT_ID"] ?? throw new Exception("Missing AZURE_AI_AGENT_ID");
        _projectName = config["AZURE_AI_PROJECT_NAME"] ?? throw new Exception("Missing AZURE_AI_PROJECT_NAME");
        _endpoint = config["AZURE_AI_PROJECT_ENDPOINT"] ?? throw new Exception("Missing AZURE_AI_PROJECT_ENDPOINT");
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
        threadRes.EnsureSuccessStatusCode();
        var threadId = JsonDocument.Parse(await threadRes.Content.ReadAsStringAsync())
                                   .RootElement.GetProperty("id").GetString();

        // Send message
        var messagePayload = JsonSerializer.Serialize(new { role = "user", content = input });
        var msgRes = await _http.PostAsync(
            $"{_endpoint}/api/projects/{_projectName}/threads/{threadId}/messages",
            new StringContent(messagePayload, Encoding.UTF8, "application/json")
        );
        msgRes.EnsureSuccessStatusCode();

        // Run agent
        var runPayload = JsonSerializer.Serialize(new { agentId = _agentId });
        var runRes = await _http.PostAsync(
            $"{_endpoint}/api/projects/{_projectName}/threads/{threadId}/runs",
            new StringContent(runPayload, Encoding.UTF8, "application/json")
        );
        runRes.EnsureSuccessStatusCode();
        var runId = JsonDocument.Parse(await runRes.Content.ReadAsStringAsync())
                                .RootElement.GetProperty("id").GetString();

        // Poll until complete
        while (true)
        {
            var statusRes = await _http.GetAsync(
                $"{_endpoint}/api/projects/{_projectName}/threads/{threadId}/runs/{runId}"
            );
            var statusJson = JsonDocument.Parse(await statusRes.Content.ReadAsStringAsync());
            var status = statusJson.RootElement.GetProperty("status").GetString();
            if (status == "completed") break;
            if (status == "failed") throw new Exception("Agent run failed");
            await Task.Delay(500);
        }

        // Get messages
        var messagesRes = await _http.GetAsync(
            $"{_endpoint}/api/projects/{_projectName}/threads/{threadId}/messages"
        );
        messagesRes.EnsureSuccessStatusCode();
        var messages = JsonDocument.Parse(await messagesRes.Content.ReadAsStringAsync()).RootElement;

        foreach (var msg in messages.EnumerateArray())
        {
            if (msg.GetProperty("role").GetString() == "assistant")
                return msg.GetProperty("content").GetString() ?? "[No response]";
        }

        return "[No assistant message found]";
    }
}
