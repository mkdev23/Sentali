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
        _agentEndpoint = config["SentaliAgent:Endpoint"]; // e.g. https://<region>.api.cognitive.microsoft.com/agents/<project>/<agent>/invoke
        _agentKey = config["SentaliAgent:Key"];           // AI Foundry project API key
    }

    [HttpPost]
    public async Task<IActionResult> SearchBingGrounding([FromBody] QueryRequest request)
    {
        if (string.IsNullOrWhiteSpace(request.Query))
            return BadRequest(new { error = "Missing query" });

        try
        {
            var payload = new
            {
                input = request.Query
            };

            var req = new HttpRequestMessage(HttpMethod.Post, _agentEndpoint);
            req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", _agentKey);
            req.Content = new StringContent(JsonSerializer.Serialize(payload));
            req.Content.Headers.ContentType = new MediaTypeHeaderValue("application/json");

            var res = await _httpClient.SendAsync(req);
            if (!res.IsSuccessStatusCode)
            {
                var errBody = await res.Content.ReadAsStringAsync();
                Console.Error.WriteLine($"[Agent Grounding] Error {res.StatusCode}: {errBody}");
                return StatusCode((int)res.StatusCode, new { error = "Agent API error", details = errBody });
            }

            using var stream = await res.Content.ReadAsStreamAsync();
            using var doc = await JsonDocument.ParseAsync(stream);

            // Adjust parsing based on your agent's JSON output
            var chunks = doc.RootElement
                .GetProperty("groundingResults") // or whatever property your agent uses
                .EnumerateArray()
                .Select(item => new {
                    text = item.GetProperty("snippet").GetString(),
                    source = item.GetProperty("url").GetString()
                })
                .ToList();

            return Ok(new { chunks });
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"[bing-grounding] Error: {ex}");
            return StatusCode(500, new { error = "Bing grounding failed" });
        }
    }

    public class QueryRequest
    {
        public string Query { get; set; }
    }
}