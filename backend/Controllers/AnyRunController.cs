using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Logging;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;

namespace SentaliApp.Controllers
{
    [ApiController]
    [Route("api/[controller]")]
    public class AnyRunController : ControllerBase
    {
        private readonly ILogger<AnyRunController> _logger;
        private readonly HttpClient _httpClient;
        private readonly string _apiKey;

        public AnyRunController(ILogger<AnyRunController> logger, IHttpClientFactory httpClientFactory, IConfiguration config)
        {
            _logger = logger;
            _httpClient = httpClientFactory.CreateClient();
            _apiKey = config["ANYRUN_API_KEY"] ?? Environment.GetEnvironmentVariable("ANYRUN_API_KEY")
                      ?? throw new Exception("ANYRUN_API_KEY not configured");

            _httpClient.BaseAddress = new Uri("https://api.any.run/v1/");
            _httpClient.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("API-Key", _apiKey);
        }

        // DTOs
        public record UrlRequest(string Url);
        public record IpRequest(string Ip);
        public record HashRequest(string Sha256);

        /// <summary>
        /// Submit a URL for sandbox analysis
        /// </summary>
        [HttpPost("url")]
        public async Task<IActionResult> AnalyzeUrl([FromBody] UrlRequest req)
        {
            if (string.IsNullOrWhiteSpace(req.Url))
                return BadRequest(new { error = "Missing URL" });

            var payload = new
            {
                task = new { type = "url", url = req.Url }
            };

            return await SubmitAnalysis(payload);
        }

        /// <summary>
        /// Submit an IP address for sandbox analysis
        /// </summary>
        [HttpPost("ip")]
        public async Task<IActionResult> AnalyzeIp([FromBody] IpRequest req)
        {
            if (string.IsNullOrWhiteSpace(req.Ip))
                return BadRequest(new { error = "Missing IP" });

            var payload = new
            {
                task = new { type = "ip", ip = req.Ip }
            };

            return await SubmitAnalysis(payload);
        }

        /// <summary>
        /// Submit a SHA256 hash for sandbox analysis
        /// </summary>
        [HttpPost("hash")]
        public async Task<IActionResult> AnalyzeHash([FromBody] HashRequest req)
        {
            if (string.IsNullOrWhiteSpace(req.Sha256))
                return BadRequest(new { error = "Missing SHA256" });

            var payload = new
            {
                task = new { type = "hash", hash = req.Sha256 }
            };

            return await SubmitAnalysis(payload);
        }

        /// <summary>
        /// Upload a malware sample file for sandbox analysis
        /// </summary>
        [HttpPost("file")]
        [RequestSizeLimit(50_000_000)] // 50 MB limit
        public async Task<IActionResult> AnalyzeFile(IFormFile file)
        {
            if (file == null || file.Length == 0)
                return BadRequest(new { error = "No file uploaded" });

            using var content = new MultipartFormDataContent();
            var fileContent = new StreamContent(file.OpenReadStream());
            fileContent.Headers.ContentType = new MediaTypeHeaderValue("application/octet-stream");
            content.Add(fileContent, "file", file.FileName);

            var response = await _httpClient.PostAsync("analysis/", content);
            return await FormatResponse(response);
        }

        /// <summary>
        /// Check the status of an analysis task
        /// </summary>
        [HttpGet("status/{taskUuid}")]
        public async Task<IActionResult> GetStatus(string taskUuid)
        {
            var response = await _httpClient.GetAsync($"analysis/status/{taskUuid}");
            return await FormatResponse(response);
        }

        /// <summary>
        /// Get full IOC JSON report
        /// </summary>
        [HttpGet("report/{taskUuid}")]
        public async Task<IActionResult> GetReport(string taskUuid)
        {
            var response = await _httpClient.GetAsync($"report/{taskUuid}/ioc/json");
            return await FormatResponse(response);
        }

        // --- Helpers ---
        private async Task<IActionResult> SubmitAnalysis(object payload)
        {
            var json = JsonSerializer.Serialize(payload);
            var content = new StringContent(json, Encoding.UTF8, "application/json");

            var response = await _httpClient.PostAsync("analysis/", content);
            return await FormatResponse(response);
        }

        private async Task<IActionResult> FormatResponse(HttpResponseMessage response)
        {
            var text = await response.Content.ReadAsStringAsync();

            if (!response.IsSuccessStatusCode)
            {
                _logger.LogWarning("[ANY.RUN] Error {Status}: {Body}", response.StatusCode, text);
                return StatusCode((int)response.StatusCode, new { error = text });
            }

            try
            {
                var json = JsonSerializer.Deserialize<object>(text);
                return Ok(json);
            }
            catch
            {
                return Ok(new { raw = text });
            }
        }
    }
}