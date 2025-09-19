//binigroundingController.cs
using Microsoft.AspNetCore.Mvc;
using System.Net.Http.Headers;
using System.Text.Json;
using Azure.Core;
using Azure.Identity;

namespace SentaliApp.Controllers;

[ApiController]
[Route("api/search/bing-grounding")]
public class BingGroundingController : ControllerBase
{
    private readonly HttpClient _httpClient;
    private readonly string _agentEndpoint;
    private readonly TokenCredential _credential;

    public BingGroundingController(IConfiguration config, IHttpClientFactory httpClientFactory)
    {
        _httpClient = httpClientFactory.CreateClient();

        var projectEndpoint = config["AZURE_AI_PROJECT_ENDPOINT"];
        var agentId = config["AZURE_AI_AGENT_ID"];
        var apiVersion = "2025-10-01-preview"; // Required for Agent Service calls

        if (string.IsNullOrWhiteSpace(projectEndpoint) || string.IsNullOrWhiteSpace(agentId))
            throw new InvalidOperationException("AI Foundry project endpoint or agent ID is not configured.");

        // Append api-version query param
        _agentEndpoint = $"{projectEndpoint}/agents/{agentId}/invoke?api-version={apiVersion}";

        // Works locally (Azure CLI login) and in App Service (managed identity)
        _credential = new DefaultAzureCredential();
    }

    [HttpPost]
    public async Task<IActionResult> SearchBingGrounding([FromBody] QueryRequest request)
    {
        if (string.IsNullOrWhiteSpace(request.Query))
            return BadRequest(new { error = "Missing query" });

        try
        {
            // Get Azure AD token for AI Foundry Agent Service
            var token = await _credential.GetTokenAsync(
                new TokenRequestContext(new[] { "https://ai.azure.com/.default" }),
                HttpContext.RequestAborted
            );

            var payload = new { input = request.Query };

            var req = new HttpRequestMessage(HttpMethod.Post, _agentEndpoint);
            req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token.Token);
            req.Content = new StringContent(JsonSerializer.Serialize(payload));
            req.Content.Headers.ContentType = new MediaTypeHeaderValue("application/json");

            var res = await _httpClient.SendAsync(req, HttpContext.RequestAborted);
            var raw = await res.Content.ReadAsStringAsync();

            if (!res.IsSuccessStatusCode)
            {
                Console.Error.WriteLine($"[Agent Grounding] Error {res.StatusCode}: {raw}");
                return StatusCode((int)res.StatusCode, new { error = "Agent API error", details = raw });
            }

            Console.WriteLine($"[Agent Grounding] Raw response: {raw}");

            using var doc = JsonDocument.Parse(raw);

            // Safe parse: handle both "output" and "groundingResults"
            var chunks = new List<object>();

            if (doc.RootElement.TryGetProperty("output", out var output) && output.ValueKind == JsonValueKind.Array)
            {
                chunks.AddRange(output.EnumerateArray().Select(item => new
                {
                    text = item.TryGetProperty("snippet", out var sn) ? sn.GetString() : null,
                    source = item.TryGetProperty("url", out var url) ? url.GetString() : null
                }).Where(c => !string.IsNullOrWhiteSpace(c.text) && !string.IsNullOrWhiteSpace(c.source)));
            }
            else if (doc.RootElement.TryGetProperty("groundingResults", out var grounding) && grounding.ValueKind == JsonValueKind.Array)
            {
                chunks.AddRange(grounding.EnumerateArray().Select(item => new
                {
                    text = item.TryGetProperty("snippet", out var sn) ? sn.GetString() : null,
                    source = item.TryGetProperty("url", out var url) ? url.GetString() : null
                }).Where(c => !string.IsNullOrWhiteSpace(c.text) && !string.IsNullOrWhiteSpace(c.source)));
            }

            return Ok(new { chunks });
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"[bing-grounding] Error: {ex}");
            return StatusCode(500, new { error = "Bing grounding failed", details = ex.Message });
        }
    }

    public class QueryRequest
    {
        public string Query { get; set; }
    }
}