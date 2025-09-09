using System;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using System.Threading.Tasks;
using Azure.Core;
using Azure.Identity;
using Microsoft.Extensions.Configuration;


namespace SentaliApp.Services
{


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

            // 1) Auth: API key or MI with AI Foundry audience
            _http.DefaultRequestHeaders.Clear();
            if (!string.IsNullOrEmpty(_projectApiKey))
            {
                Console.WriteLine("[Assistants REST] Using API Key");
                _http.DefaultRequestHeaders.Add("api-key", _projectApiKey);
            }
            else
            {
                Console.WriteLine("[Assistants REST] Using Managed Identity");
                var cred = new DefaultAzureCredential();
                var token = await cred.GetTokenAsync(
                    new TokenRequestContext(new[] { "https://ai.azure.com/.default" }));
                _http.DefaultRequestHeaders.Authorization =
                    new AuthenticationHeaderValue("Bearer", token.Token);
            }

            // 2) Create a thread
            var threadUrl = $"{_projectEndpoint}/threads?api-version=2025-05-01";
            var threadRes = await _http.PostAsync(
                threadUrl,
                new StringContent("{}", Encoding.UTF8, "application/json"));
            threadRes.EnsureSuccessStatusCode();
            var threadJson = await threadRes.Content.ReadAsStringAsync();
            Console.WriteLine($"[Assistants REST] CreateThread → {threadJson}");
            var threadId = JsonDocument.Parse(threadJson)
                .RootElement.GetProperty("id").GetString()!;

            // 3) Post the user message
            var msgUrl = $"{_projectEndpoint}/threads/{threadId}/messages?api-version=2025-05-01";
            var msgPayload = JsonSerializer.Serialize(new { role = "user", content = input });
            var msgRes = await _http.PostAsync(
                msgUrl,
                new StringContent(msgPayload, Encoding.UTF8, "application/json"));
            msgRes.EnsureSuccessStatusCode();
            Console.WriteLine($"[Assistants REST] PostMessage → {await msgRes.Content.ReadAsStringAsync()}");

            // 4) Create a run with your assistant
            var runUrl = $"{_projectEndpoint}/threads/{threadId}/runs?api-version=2025-05-01";
            var runPayload = JsonSerializer.Serialize(new { assistant_id = _agentId });
            var runRes = await _http.PostAsync(
                runUrl,
                new StringContent(runPayload, Encoding.UTF8, "application/json"));
            runRes.EnsureSuccessStatusCode();
            var runJson = await runRes.Content.ReadAsStringAsync();
            Console.WriteLine($"[Assistants REST] CreateRun → {runJson}");
            var runId = JsonDocument.Parse(runJson)
                .RootElement.GetProperty("id").GetString()!;

            // 5) Poll until the run completes
            string status;
            do
            {
                await Task.Delay(500);
                var statusUrl = $"{_projectEndpoint}/threads/{threadId}/runs/{runId}?api-version=2025-05-01";
                var statusRes = await _http.GetAsync(statusUrl);
                statusRes.EnsureSuccessStatusCode();
                var statusJson = await statusRes.Content.ReadAsStringAsync();
                status = JsonDocument.Parse(statusJson)
                    .RootElement.GetProperty("status").GetString()!;
                Console.WriteLine($"[Assistants REST] Run status: {status}");
                if (status == "failed")
                {
                    var err = JsonDocument.Parse(statusJson)
                        .RootElement
                        .GetProperty("last_error")
                        .GetProperty("message")
                        .GetString();
                    throw new Exception($"Assistant run failed: {err}");
                }
            }
            while (status is "queued" or "in_progress");

            // 6) Fetch all messages and return the assistant’s reply
            var messagesUrl = $"{_projectEndpoint}/threads/{threadId}/messages?order=asc&api-version=2025-05-01";
            var messagesRes = await _http.GetAsync(messagesUrl);
            messagesRes.EnsureSuccessStatusCode();
            var messagesJson = await messagesRes.Content.ReadAsStringAsync();
            Console.WriteLine($"[Assistants REST] Messages → {messagesJson}");

            using var doc = JsonDocument.Parse(messagesJson);
            foreach (var msg in doc.RootElement.GetProperty("data").EnumerateArray())
            {
                if (msg.GetProperty("role").GetString() == "assistant")
                {
                    foreach (var part in msg.GetProperty("content").EnumerateArray())
                    {
                        if (part.GetProperty("type").GetString() == "text")
                        {
                            return part
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
}