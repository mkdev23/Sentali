using System;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using System.Threading.Tasks;
using Azure.Core;
using Azure.Identity;
using Microsoft.Extensions.Configuration;

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
        Console.WriteLine($"[Assistants REST] Endpoint: {_projectEndpoint}");
        Console.WriteLine($"[Assistants REST] AssistantId: {_agentId}");

        // 1) Auth: API key (if provided) OR Managed Identity
        _http.DefaultRequestHeaders.Clear();
        if (!string.IsNullOrEmpty(_projectApiKey))
        {
            Console.WriteLine("[Assistants REST] Using API key authentication");
            _http.DefaultRequestHeaders.Add("api-key", _projectApiKey);
        }
        else
        {
            Console.WriteLine("[Assistants REST] Using Managed Identity authentication");
            var credential = new DefaultAzureCredential();
            var token = await credential.GetTokenAsync(
                new TokenRequestContext(new[] { "https://ai.azure.com/.default" })
            );
            _http.DefaultRequestHeaders.Authorization =
                new AuthenticationHeaderValue("Bearer", token.Token);
        }

        // 2) Create a new thread
        var threadUrl = $"{_projectEndpoint}/threads?api-version=2025-05-01";
        var threadRes = await _http.PostAsync(
            threadUrl,
            new StringContent("{}", Encoding.UTF8, "application/json")
        );
        threadRes.EnsureSuccessStatusCode();
        var threadJson = await threadRes.Content.ReadAsStringAsync();
        Console.WriteLine($"[Assistants REST] CreateThread response: {threadJson}");
        using var threadDoc = JsonDocument.Parse(threadJson);
        var threadId = threadDoc.RootElement.GetProperty("id").GetString()
            ?? throw new Exception("Missing thread id");

        // 3) Post the user message to the thread
        var msgUrl = $"{_projectEndpoint}/threads/{threadId}/messages?api-version=2025-05-01";
        var msgPayload = JsonSerializer.Serialize(new { role = "user", content = input });
        var msgRes = await _http.PostAsync(
            msgUrl,
            new StringContent(msgPayload, Encoding.UTF8, "application/json")
        );
        msgRes.EnsureSuccessStatusCode();
        var msgJson = await msgRes.Content.ReadAsStringAsync();
        Console.WriteLine($"[Assistants REST] PostMessage response: {msgJson}");

        // 4) Create a run on that thread with the assistant
        var runUrl = $"{_projectEndpoint}/threads/{threadId}/runs?api-version=2025-05-01";
        var runPayload = JsonSerializer.Serialize(new { assistant_id = _agentId });
        var runRes = await _http.PostAsync(
            runUrl,
            new StringContent(runPayload, Encoding.UTF8, "application/json")
        );
        runRes.EnsureSuccessStatusCode();
        var runJson = await runRes.Content.ReadAsStringAsync();
        Console.WriteLine($"[Assistants REST] CreateRun response: {runJson}");
        using var runDoc = JsonDocument.Parse(runJson);
        var runId = runDoc.RootElement.GetProperty("id").GetString()
            ?? throw new Exception("Missing run id");

        // 5) Poll the run status
        string status;
        do
        {
            await Task.Delay(1000);
            var statusUrl = $"{_projectEndpoint}/threads/{threadId}/runs/{runId}?api-version=2025-05-01";
            var statusRes = await _http.GetAsync(statusUrl);
            statusRes.EnsureSuccessStatusCode();
            var statusJson = await statusRes.Content.ReadAsStringAsync();
            using var statusDoc = JsonDocument.Parse(statusJson);
            status = statusDoc.RootElement.GetProperty("status").GetString()!;
            Console.WriteLine($"[Assistants REST] Run status: {status}");

            if (status == "failed")
            {
                var err = statusDoc.RootElement
                    .GetProperty("last_error")
                    .GetProperty("message")
                    .GetString() ?? "Unknown";
                throw new Exception($"Assistant run failed: {err}");
            }
        }
        while (status == "queued" || status == "in_progress");

        // 6) Retrieve all messages
        var messagesUrl = $"{_projectEndpoint}/threads/{threadId}/messages?order=asc&api-version=2025-05-01";
        var messagesRes = await _http.GetAsync(messagesUrl);
        messagesRes.EnsureSuccessStatusCode();
        var messagesJson = await messagesRes.Content.ReadAsStringAsync();
        Console.WriteLine($"[Assistants REST] Messages response: {messagesJson}");

        // Extract the first assistant reply
        var root = JsonDocument.Parse(messagesJson).RootElement;
        foreach (var msg in root.GetProperty("data").EnumerateArray())
        {
            if (msg.GetProperty("role").GetString() == "assistant")
            {
                foreach (var contentItem in msg.GetProperty("content").EnumerateArray())
                {
                    if (contentItem.GetProperty("type").GetString() == "text")
                    {
                        return contentItem
                            .GetProperty("text")
                            .GetProperty("value")
                            .GetString() ?? "[No response text]";
                    }
                }
            }
        }

        return "[No assistant message found]";
    }
}