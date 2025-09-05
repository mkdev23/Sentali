using System.Net.Http;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using Azure.Core;
using Azure.Identity;

public class GptService
{
    private readonly string _agentId;
    private readonly string _projectEndpoint;
    private readonly HttpClient _http;

    public GptService(IConfiguration config)
    {
        _agentId = config["AZURE_AI_AGENT_ID"] 
            ?? throw new Exception("Missing AZURE_AI_AGENT_ID");
        _projectEndpoint = config["AZURE_AI_PROJECT_ENDPOINT"] 
            ?? throw new Exception("Missing AZURE_AI_PROJECT_ENDPOINT");
        _http = new HttpClient();
    }

    public async Task<string> GetResponse(string input)
    {
        // 1. Acquire token with Managed Identity
        var credential = new DefaultAzureCredential();
        var token = await credential.GetTokenAsync(
            new TokenRequestContext(new[] { "https://cognitiveservices.azure.com/.default" })
        );
        _http.DefaultRequestHeaders.Authorization = 
            new AuthenticationHeaderValue("Bearer", token.Token);

        Console.WriteLine($"[Agent REST] Endpoint: {_projectEndpoint}");
        Console.WriteLine($"[Agent REST] AgentId: {_agentId}");

        // 2. Get Agent (optional, just to confirm connectivity)
        var agentRes = await _http.GetAsync(
            $"{_projectEndpoint}/agents/{_agentId}?api-version=2024-10-01-preview");
        var agentJson = await agentRes.Content.ReadAsStringAsync();
        agentRes.EnsureSuccessStatusCode();
        Console.WriteLine($"[Agent REST] Agent: {agentJson}");

        // 3. Create Thread
        var threadRes = await _http.PostAsync(
            $"{_projectEndpoint}/agents/threads?api-version=2024-10-01-preview",
            new StringContent("{}", Encoding.UTF8, "application/json"));
        var threadJson = await threadRes.Content.ReadAsStringAsync();
        threadRes.EnsureSuccessStatusCode();
        var threadId = JsonDocument.Parse(threadJson).RootElement.GetProperty("id").GetString();
        Console.WriteLine($"[Agent REST] ThreadId: {threadId}");

        // 4. Create Message
        var msgPayload = JsonSerializer.Serialize(new
        {
            role = "user",
            content = input
        });
        var msgRes = await _http.PostAsync(
            $"{_projectEndpoint}/agents/threads/{threadId}/messages?api-version=2024-10-01-preview",
            new StringContent(msgPayload, Encoding.UTF8, "application/json"));
        msgRes.EnsureSuccessStatusCode();
        Console.WriteLine($"[Agent REST] Sent message: {input}");

        // 5. Create Run
        var runPayload = JsonSerializer.Serialize(new { assistant_id = _agentId });
        var runRes = await _http.PostAsync(
            $"{_projectEndpoint}/agents/threads/{threadId}/runs?api-version=2024-10-01-preview",
            new StringContent(runPayload, Encoding.UTF8, "application/json"));
        var runJson = await runRes.Content.ReadAsStringAsync();
        runRes.EnsureSuccessStatusCode();
        var runId = JsonDocument.Parse(runJson).RootElement.GetProperty("id").GetString();
        Console.WriteLine($"[Agent REST] RunId: {runId}");

        // 6. Poll until complete
        string status;
        do
        {
            await Task.Delay(1000);
            var statusRes = await _http.GetAsync(
                $"{_projectEndpoint}/agents/threads/{threadId}/runs/{runId}?api-version=2024-10-01-preview");
            var statusJson = await statusRes.Content.ReadAsStringAsync();
            status = JsonDocument.Parse(statusJson).RootElement.GetProperty("status").GetString();
            Console.WriteLine($"[Agent REST] Run status: {status}");
            if (status == "failed")
            {
                var err = JsonDocument.Parse(statusJson).RootElement
                    .GetProperty("last_error").GetProperty("message").GetString();
                throw new Exception($"Agent run failed: {err}");
            }
        }
        while (status == "queued" || status == "in_progress");

        // 7. Get Messages
        var messagesRes = await _http.GetAsync(
            $"{_projectEndpoint}/agents/threads/{threadId}/messages?order=asc&api-version=2024-10-01-preview");
        var messagesJson = await messagesRes.Content.ReadAsStringAsync();
        messagesRes.EnsureSuccessStatusCode();

        foreach (var msg in JsonDocument.Parse(messagesJson).RootElement.EnumerateArray())
        {
            if (msg.GetProperty("role").GetString() == "assistant")
            {
                var contentArray = msg.GetProperty("content").EnumerateArray();
                foreach (var contentItem in contentArray)
                {
                    if (contentItem.GetProperty("type").GetString() == "text")
                    {
                        var text = contentItem.GetProperty("text").GetProperty("value").GetString();
                        Console.WriteLine($"[Agent REST] Assistant reply: {text}");
                        return text ?? "[No response text]";
                    }
                }
            }
        }

        return "[No assistant message found]";
    }
}