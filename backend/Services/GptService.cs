using System;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using System.Threading.Tasks;
using Azure.Core;
using Azure.Identity;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;

namespace SentaliApp.Services
{
    public class GptService
    {
        private readonly string _agentId;
        private readonly string _projectEndpoint;
        private readonly string? _projectApiKey;
        private readonly string _apiVersion;
        private readonly HttpClient _http;
        private readonly ILogger<GptService> _logger;

        public GptService(IConfiguration config, ILogger<GptService> logger)
        {
            _logger = logger;
            _agentId = config["AZURE_AI_AGENT_ID"]?.Trim()
                ?? throw new Exception("Missing AZURE_AI_AGENT_ID");
            _projectEndpoint = (config["AZURE_AI_PROJECT_ENDPOINT"]?.TrimEnd('/')
                ?? throw new Exception("Missing AZURE_AI_PROJECT_ENDPOINT"));
            _projectApiKey = config["AZURE_AI_PROJECT_KEY"]?.Trim();
            _apiVersion = config["AZURE_AI_PROJECT_API_VERSION"]?.Trim() ?? "2025-05-01";
            _http = new HttpClient();
        }

        private async Task<HttpResponseMessage> SendWithLogging(
            Func<Task<HttpResponseMessage>> send,
            string step,
            string urlForLog)
        {
            var res = await send();
            if (!res.IsSuccessStatusCode)
            {
                var body = await res.Content.ReadAsStringAsync();
                _logger.LogError(
                    "[Assistants REST] {Step} failed ({StatusCode}): {Url}\n{Body}",
                    step,
                    (int)res.StatusCode,
                    urlForLog,
                    body);
                throw new HttpRequestException(
                    $"{step} failed: {(int)res.StatusCode} {res.StatusCode} → {body}");
            }
            _logger.LogInformation(
                "[Assistants REST] {Step} succeeded ({StatusCode}): {Url}",
                step,
                (int)res.StatusCode,
                urlForLog);
            return res;
        }

        public async Task<string> GetResponse(string input, string? context = null)
        {
            try
            {
                // Build prompt with context if provided
                var fullPrompt = context != null && !string.IsNullOrWhiteSpace(context)
                    ? $"{context}\n\nUser: {input}"
                    : input;

                _logger.LogInformation("[Assistants REST] Endpoint: {Endpoint}", _projectEndpoint);
                _logger.LogInformation("[Assistants REST] AssistantId: {AssistantId}", _agentId);
                _logger.LogInformation("[Assistants REST] API version: {ApiVersion}", _apiVersion);

                // --- AUTH: try Managed Identity first, then fall back to API key ---
                _http.DefaultRequestHeaders.Clear();
                bool usedMi = false;

                try
                {
                    var cred = new DefaultAzureCredential();
                    var token = await cred.GetTokenAsync(
                        new TokenRequestContext(new[] { "https://ai.azure.com/.default" }));
                    _http.DefaultRequestHeaders.Authorization =
                        new AuthenticationHeaderValue("Bearer", token.Token);
                    _logger.LogInformation("[Auth] Using Managed Identity");
                    usedMi = true;
                }
                catch (Exception ex)
                {
                    _logger.LogWarning(ex, "[Auth] Managed Identity failed, falling back to API key");
                }

                if (!usedMi)
                {
                    if (string.IsNullOrEmpty(_projectApiKey))
                    {
                        throw new InvalidOperationException(
                            "Managed Identity unavailable and no AZURE_AI_PROJECT_KEY configured.");
                    }
                    _http.DefaultRequestHeaders.Add("api-key", _projectApiKey);
                    _logger.LogInformation("[Auth] Using API Key fallback");
                }

                // 1) Create a thread
                var threadUrl = $"{_projectEndpoint}/threads?api-version={_apiVersion}";
                var threadRes = await SendWithLogging(
                    () => _http.PostAsync(
                        threadUrl,
                        new StringContent("{}", Encoding.UTF8, "application/json")),
                    "CreateThread",
                    threadUrl);

                var threadJson = await threadRes.Content.ReadAsStringAsync();
                _logger.LogInformation("[Assistants REST] CreateThread → {Json}", threadJson);
                var threadId = JsonDocument.Parse(threadJson).RootElement.GetProperty("id").GetString()!;

                // 2) Post the user message
                var msgUrl = $"{_projectEndpoint}/threads/{threadId}/messages?api-version={_apiVersion}";
                var msgPayload = JsonSerializer.Serialize(new { role = "user", content = fullPrompt });
                var msgRes = await SendWithLogging(
                    () => _http.PostAsync(
                        msgUrl,
                        new StringContent(msgPayload, Encoding.UTF8, "application/json")),
                    "PostMessage",
                    msgUrl);

                _logger.LogInformation("[Assistants REST] PostMessage → {Json}", await msgRes.Content.ReadAsStringAsync());

                // 3) Create a run
                var runUrl = $"{_projectEndpoint}/threads/{threadId}/runs?api-version={_apiVersion}";
                var runPayload = JsonSerializer.Serialize(new { assistant_id = _agentId });
                var runRes = await SendWithLogging(
                    () => _http.PostAsync(
                        runUrl,
                        new StringContent(runPayload, Encoding.UTF8, "application/json")),
                    "CreateRun",
                    runUrl);

                var runJson = await runRes.Content.ReadAsStringAsync();
                _logger.LogInformation("[Assistants REST] CreateRun → {Json}", runJson);
                var runId = JsonDocument.Parse(runJson).RootElement.GetProperty("id").GetString()!;

                // 4) Poll until complete
                string status;
                do
                {
                    await Task.Delay(500);
                    var statusUrl = $"{_projectEndpoint}/threads/{threadId}/runs/{runId}?api-version={_apiVersion}";
                    var statusRes = await SendWithLogging(
                        () => _http.GetAsync(statusUrl),
                        "GetRunStatus",
                        statusUrl);

                    var statusJson = await statusRes.Content.ReadAsStringAsync();
                    status = JsonDocument.Parse(statusJson).RootElement.GetProperty("status").GetString()!;
                    _logger.LogInformation("[Assistants REST] Run status: {Status}", status);

                    if (status == "failed")
                    {
                        var errMessage = JsonDocument.Parse(statusJson)
                            .RootElement.GetProperty("last_error")
                            .GetProperty("message")
                            .GetString();
                        throw new Exception($"Assistant run failed: {errMessage}");
                    }
                }
                while (status is "queued" or "in_progress");

                // 5) Fetch messages
                var messagesUrl = $"{_projectEndpoint}/threads/{threadId}/messages?order=asc&api-version={_apiVersion}";
                var messagesRes = await SendWithLogging(
                    () => _http.GetAsync(messagesUrl),
                    "GetMessages",
                    messagesUrl);

                var messagesJson = await messagesRes.Content.ReadAsStringAsync();
                _logger.LogInformation("[Assistants REST] Messages → {Json}", messagesJson);

                using var doc = JsonDocument.Parse(messagesJson);
                foreach (var msgItem in doc.RootElement.GetProperty("data").EnumerateArray())
                {
                    if (msgItem.GetProperty("role").GetString() == "assistant")
                    {
                        foreach (var part in msgItem.GetProperty("content").EnumerateArray())
                        {
                            if (part.GetProperty("type").GetString() == "text")
                            {
                                return part.GetProperty("text").GetProperty("value").GetString()!;
                            }
                        }
                    }
                }

                return "[No assistant message found]";
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "[Assistants REST] Unhandled exception in GetResponse");
                throw;
            }
        }
    }
}