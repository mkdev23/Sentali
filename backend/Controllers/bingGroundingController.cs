using Microsoft.AspNetCore.Mvc;
using System.Net.Http.Headers;
using System.Text.Json;

[ApiController]
[Route("api/search/bing-grounding")]
public class BingGroundingController : ControllerBase
{
    private readonly HttpClient _httpClient;
    private readonly string _bingKey;

    public BingGroundingController(IConfiguration config, IHttpClientFactory httpClientFactory)
    {
        _httpClient = httpClientFactory.CreateClient();
        _bingKey = config["BingSearch:Key"];
    }

    [HttpPost]
    public async Task<IActionResult> SearchBingGrounding([FromBody] QueryRequest request)
    {
        if (string.IsNullOrWhiteSpace(request.Query))
            return BadRequest(new { error = "Missing query" });

        try
        {
            var endpoint = $"https://api.bing.microsoft.com/v7.0/search?q={Uri.EscapeDataString(request.Query)}";
            var req = new HttpRequestMessage(HttpMethod.Get, endpoint);
            req.Headers.Add("Ocp-Apim-Subscription-Key", _bingKey);

            var res = await _httpClient.SendAsync(req);
            if (!res.IsSuccessStatusCode)
                return StatusCode((int)res.StatusCode, new { error = "Bing API error" });

            using var stream = await res.Content.ReadAsStreamAsync();
            using var doc = await JsonDocument.ParseAsync(stream);

            var chunks = doc.RootElement
                .GetProperty("webPages").GetProperty("value")
                .EnumerateArray()
                .Take(5)
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