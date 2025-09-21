// Controllers/CveController.cs
using Microsoft.AspNetCore.Mvc;
using System.Net.Http;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.Extensions.Logging;

namespace SentaliApp.Controllers
{
    [ApiController]
    [Route("api/cve-summary")]
    public class CveController : ControllerBase
    {
        private readonly HttpClient _httpClient;
        private readonly ILogger<CveController> _logger;

        public CveController(IHttpClientFactory httpClientFactory, ILogger<CveController> logger)
        {
            _httpClient = httpClientFactory.CreateClient();
            _httpClient.BaseAddress = new Uri("https://services.nvd.nist.gov/rest/json/cves/2.0");
            _logger = logger;
        }

        public class QueryRequest { public required string Query { get; set; } }

        [HttpPost]
        public async Task<IActionResult> GetCveSummary([FromBody] QueryRequest req)
        {
            if (string.IsNullOrWhiteSpace(req.Query))
                return BadRequest(new { error = "Missing query" });

            try
            {
                var queryParams = $"?keywordSearch={Uri.EscapeDataString(req.Query)}";
                var response = await _httpClient.GetAsync(queryParams);

                if (!response.IsSuccessStatusCode)
                {
                    _logger.LogError("[NVD] Error {Status}: {Reason}", response.StatusCode, response.ReasonPhrase);
                    return StatusCode((int)response.StatusCode, new { error = "NVD API error" });
                }

                var json = await response.Content.ReadAsStringAsync();
                var nvdData = JsonSerializer.Deserialize<NvdResponse>(json);

                if (nvdData?.Vulnerabilities == null || nvdData.Vulnerabilities.Count == 0)
                {
                    return Ok(new { summary = "No vulnerabilities found" });
                }

                // Take first match for simplicity
                var vuln = nvdData.Vulnerabilities[0].Cve;
                var metrics = vuln.Metrics?.CvssMetricV31?[0].CvssData ?? vuln.Metrics?.CvssMetricV2?[0].CvssData;

                var severity = metrics?.BaseSeverity ?? (metrics?.BaseScore ?? 0) switch
                {
                    >= 9.0 => "Critical",
                    >= 7.0 => "High",
                    >= 4.0 => "Medium",
                    _ => "Low"
                };

                var affected = vuln.Configurations?[0].Nodes?[0].Cpe?[0].Criteria ?? "Various products";

                // Heuristics-based mitigations (customize as needed)
                var mitigations = new List<string>
                {
                    "Apply latest patches from vendor",
                    "Implement input validation",
                    "Use least privilege principles"
                };
                if (vuln.Descriptions?[0].Value?.Contains("injection") == true)
                    mitigations.Add("Use parameterized queries");
                if (vuln.Descriptions?[0].Value?.Contains("buffer overflow") == true)
                    mitigations.Add("Use safe memory handling functions");

                var summary = $"{vuln.Descriptions?[0].Value}\nAffected: {affected}";

                return Ok(new
                {
                    description = vuln.Descriptions?[0].Value,
                    severity,
                    affectedProducts = affected,
                    mitigations = string.Join("; ", mitigations),
                    summary
                });
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "[CVE] Search error");
                return StatusCode(500, new { error = "CVE search failed", details = ex.Message });
            }
        }

        // NVD DTOs (simplified)
        private class NvdResponse
        {
            [JsonPropertyName("vulnerabilities")]
            public List<Vulnerability>? Vulnerabilities { get; set; }
        }

        private class Vulnerability
        {
            [JsonPropertyName("cve")]
            public Cve? Cve { get; set; }
        }

        private class Cve
        {
            [JsonPropertyName("descriptions")]
            public List<Description>? Descriptions { get; set; }

            [JsonPropertyName("metrics")]
            public Metrics? Metrics { get; set; }

            [JsonPropertyName("configurations")]
            public List<Configuration>? Configurations { get; set; }
        }

        private class Description
        {
            [JsonPropertyName("value")]
            public string? Value { get; set; }
        }

        private class Metrics
        {
            [JsonPropertyName("cvssMetricV31")]
            public List<CvssMetric>? CvssMetricV31 { get; set; }

            [JsonPropertyName("cvssMetricV2")]
            public List<CvssMetric>? CvssMetricV2 { get; set; }
        }

        private class CvssMetric
        {
            [JsonPropertyName("cvssData")]
            public CvssData? CvssData { get; set; }

            [JsonPropertyName("baseSeverity")]
            public string? BaseSeverity { get; set; }

            [JsonPropertyName("impactScore")]
            public double? ImpactScore { get; set; }
        }

        private class CvssData
        {
            [JsonPropertyName("baseScore")]
            public double? BaseScore { get; set; }

            [JsonPropertyName("baseSeverity")]
            public string? BaseSeverity { get; set; }
        }

        private class Configuration
        {
            [JsonPropertyName("nodes")]
            public List<Node>? Nodes { get; set; }
        }

        private class Node
        {
            [JsonPropertyName("cpe")]
            public List<Cpe>? Cpe { get; set; }
        }

        private class Cpe
        {
            [JsonPropertyName("criteria")]
            public string? Criteria { get; set; }
        }
    }
}