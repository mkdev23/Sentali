using Azure;
using Azure.Search.Documents;
using Azure.Search.Documents.Models;
using Microsoft.AspNetCore.Mvc;

[ApiController]
[Route("api/search/security-kb")]
public class SecurityKbController : ControllerBase
{
    private readonly SearchClient _searchClient;

    public SecurityKbController(IConfiguration config)
    {
        var endpoint = config["AZURE_SEARCH_ENDPOINT"];
        var key = config["AZURE_SEARCH_KEY"];

        if (string.IsNullOrWhiteSpace(endpoint) || string.IsNullOrWhiteSpace(key))
            throw new InvalidOperationException("Azure Search endpoint or key is not configured.");

        _searchClient = new SearchClient(
            new Uri(endpoint),
            "security-kb", // index name
            new AzureKeyCredential(key)
        );
    }

    [HttpPost]
    public async Task<IActionResult> SearchSecurityKb([FromBody] QueryRequest request)
    {
        if (string.IsNullOrWhiteSpace(request.Query))
            return BadRequest(new { error = "Missing query" });

        try
        {
            var options = new SearchOptions
            {
                Size = 5,
                QueryType = SearchQueryType.Semantic,
                SemanticSearch = new SemanticSearchOptions
                {
                    SemanticConfigurationName = "sec-sem"
                },
                Select = { "content", "source" }
            };

            var results = await _searchClient.SearchAsync<SearchDocument>(request.Query, options);

            var chunks = results.Value.GetResults()
                .Select(r => new
                {
                    text = r.Document["content"]?.ToString(),
                    source = r.Document["source"]?.ToString()
                })
                .ToList();

            return Ok(new { chunks });
        }
        catch (RequestFailedException rex)
        {
            Console.Error.WriteLine($"[security-kb] Azure Search error: {rex.Status} {rex.Message}");
            return StatusCode(rex.Status, new { error = rex.Message });
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"[security-kb] Search error: {ex}");
            return StatusCode(500, new { error = "Search failed", details = ex.Message });
        }
    }

    public class QueryRequest
    {
        public string Query { get; set; }
    }
}