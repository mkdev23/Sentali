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
    private readonly string? _projectApiKey;
    private readonly HttpClient _http;

    public GptService(IConfiguration config)
    {
        _agentId = config["AZURE_AI_AGENT_ID"] 
            ?? throw new Exception("Missing AZURE_AI_AGENT_ID");
        _projectEndpoint = config["AZURE_AI_PROJECT_ENDPOINT"] 
            ?? throw new Exception("Missing AZURE_AI_PROJECT_ENDPOINT");
        _projectApiKey = config["AZURE_AI_PROJECT_KEY"]; // optional
        _http = new HttpClient();
    }

    public async Task<string> GetResponse(string input)
    {
        Console.WriteLine($"[Agent REST] Endpoint: {_projectEndpoint}");
        Console.WriteLine($"[Agent REST] AgentId: {_agentId}");

        // 1. Auth — use API key if present, else Managed Identity
        if (!string.IsNullOrEmpty(_projectApiKey))
        {
            Console.WriteLine("[Agent REST] Using API key authentication");
            _http.DefaultRequestHeaders.Remove("api-key");
            _http.DefaultRequestHeaders.Add("api-key", _projectApiKey);
        }
        else
        {
            Console.WriteLine("[Agent REST] Using Managed Identity authentication");
            var credential = new DefaultAzureCredential();
            var token = await credential.GetTokenAsync(
                new TokenRequestContext(new[] { "https://ai.azure.com/.default" })
            );
            _http.DefaultRequestHeaders.Authorization = 
                new AuthenticationHeaderValue("Bearer", token.Token);
        }

        // 2. Create thread + run in one step
        var runUrl = $"{_projectEndpoint}/agents/{_agentId}/threads/runs?api-version=2024-10-01-preview";
        var payload = JsonSerializer.Serialize(new
        {
            thread = new
            {
                messages = new[]
                {
                    new { role = "user", content = input }
                }
            }
        });

        var runRes = await _http.PostAsync(runUrl, 
            new StringContent(payload, Encoding.UTF8, "application/json"));
        var runJson = await runRes.Content.ReadAsStringAsync();
        runRes.EnsureSuccessStatusCode();

        var runDoc = JsonDocument.Parse(runJson);
        var threadId = runDoc.RootElement.GetProperty("thread_id").GetString();
        var runId = runDoc.RootElement.GetProperty("id").GetString();
        Console.WriteLine($"[Agent REST] ThreadId: {threadId}, RunId: {runId}");

        // 3. Poll until complete
        string status;
        do
        {
            await Task.Delay(1000);
            var statusUrl = $"{_projectEndpoint}/threads/{threadId}/runs/{runId}?api-version=2024-10-01-preview";
            var statusRes = await _http.GetAsync(statusUrl);
            var statusJson = await statusRes.Content.ReadAsStringAsync();
            var statusDoc = JsonDocument.Parse(statusJson);
            status = statusDoc.RootElement.GetProperty("status").GetString();
            Console.WriteLine($"[Agent REST] Run status: {status}");
            if (status == "failed")
            {
                var err = statusDoc.RootElement
                    .GetProperty("last_error").GetProperty("message").GetString();
                throw new Exception($"Agent run failed: {err}");
            }
        }
        while (status == "queued" || status == "in_progress");

        // 4. Get messages
        var messagesUrl = $"{_projectEndpoint}/threads/{threadId}/messages?order=asc&api-version=2024-10-01-preview";
        var messagesRes = await _http.GetAsync(messagesUrl);
        var messagesJson = await messagesRes.Content.ReadAsStringAsync();
        messagesRes.EnsureSuccessStatusCode();

        foreach (var msg in JsonDocument.Parse(messagesJson).RootElement.EnumerateArray())
        {
            if (msg.GetProperty("role").GetString() == "assistant")
            {
                foreach (var contentItem in msg.GetProperty("content").EnumerateArray())
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