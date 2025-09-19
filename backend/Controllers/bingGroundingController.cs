using Microsoft.AspNetCore.Mvc;
using System.Net.Http.Headers;
using System.Text.Json;

namespace SentaliApp.Controllers;

[ApiController]
[Route("api/search/bing-grounding")]
public class BingGroundingController : ControllerBase
{
    private readonly HttpClient _httpClient;
    private readonly string _agentEndpoint;
    private readonly string _agentKey;

    public BingGroundingController(IConfiguration config, IHttpClientFactory httpClientFactory)
    {
        _httpClient = httpClientFactory.CreateClient();

        var projectEndpoint = config["AZURE_AI_PROJECT_ENDPOINT"];
        var agentId = config["AZURE_AI_AGENT_ID"];
        _agentKey = config["AZURE_AI_API_KEY"];

        if (string.IsNullOrWhiteSpace(projectEndpoint) || string.IsNullOrWhiteSpace(agentId) || string.IsNullOrWhiteSpace(_agentKey))
            throw new InvalidOperationException("AI Foundry project endpoint, agent ID, or API key is not configured.");

        _agentEndpoint = $"{projectEndpoint}/agents/{agentId}/invoke";
    }

    [HttpPost]
    public async Task<IActionResult> SearchBingGrounding([FromBody] QueryRequest request)
    {
        if (string.IsNullOrWhiteSpace(request.Query))
            return BadRequest(new { error = "Missing query" });

        try
        {
            var payload = new { input = request.Query };

            var req = new HttpRequestMessage(HttpMethod.Post, _agentEndpoint);
            req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", _agentKey);
            req.Content = new StringContent(JsonSerializer.Serialize(payload));
            req.Content.Headers.ContentType = new MediaTypeHeaderValue("application/json");

            var res = await _httpClient.SendAsync(req);
            var raw = await res.Content.ReadAsStringAsync();

            if (!res.IsSuccessStatusCode)
            {
                Console.Error.WriteLine($"[Agent Grounding] Error {res.StatusCode}: {raw}");
                return StatusCode((int)res.StatusCode, new { error = "Agent API error", details = raw });
            }

            Console.WriteLine($"[Agent Grounding] Raw response: {raw}");

            using var doc = JsonDocument.Parse(raw);

            // Adjust this path to match your agent's actual JSON output
            var chunks = doc.RootElement
                .GetProperty("output") // or whatever top-level property your agent uses
                .EnumerateArray()
                .Select(item => new
                {
                    text = item.GetProperty("snippet").GetString(),
                    source = item.GetProperty("url").GetString()
                })
                .ToList();

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