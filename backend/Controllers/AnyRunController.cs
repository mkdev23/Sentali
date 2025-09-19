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

        private static readonly string DefaultUserAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36";
        private static readonly string DefaultTags = "sentali,analysis,url";

        /// <summary>
        /// Submit a URL for sandbox analysis
        /// </summary>
        [HttpPost("url")]
        public async Task<IActionResult> AnalyzeUrl([FromBody] UrlRequest req)
        {
            if (string.IsNullOrWhiteSpace(req.Url))
                return BadRequest(new { error = "Missing URL" });

            using var formContent = new MultipartFormDataContent();
            
            // Required parameters
            formContent.Add(new StringContent("url"), "obj_type");
            formContent.Add(new StringContent(req.Url), "obj_url");
            
            // Environment settings
            formContent.Add(new StringContent("windows"), "env_os");
            formContent.Add(new StringContent("64"), "env_bitness");
            formContent.Add(new StringContent("10"), "env_version");
            formContent.Add(new StringContent("complete"), "env_type");
            formContent.Add(new StringContent("en-US"), "env_locale");
            
            // Network options
            formContent.Add(new StringContent("true"), "opt_network_connect");
            formContent.Add(new StringContent("false"), "opt_network_fakenet");
            formContent.Add(new StringContent("false"), "opt_network_tor");
            formContent.Add(new StringContent("fastest"), "opt_network_geo");
            formContent.Add(new StringContent("false"), "opt_network_mitm");
            formContent.Add(new StringContent("false"), "opt_network_residential_proxy");
            formContent.Add(new StringContent("fastest"), "opt_network_residential_proxy_geo");
            
            // Privacy and timeout
            formContent.Add(new StringContent("bylink"), "opt_privacy_type");
            formContent.Add(new StringContent("60"), "opt_timeout");
            
            // Automation
            formContent.Add(new StringContent("true"), "opt_automated_interactivity");
            
            // Browser settings for URL analysis
            formContent.Add(new StringContent("Microsoft Edge"), "obj_ext_browser");
            
            // Boolean flags
            formContent.Add(new StringContent("false"), "obj_force_elevation");
            formContent.Add(new StringContent("true"), "auto_confirm_uac");
            formContent.Add(new StringContent("true"), "obj_ext_extension");
            formContent.Add(new StringContent("false"), "opt_privacy_hidesource");

            // Required parameters that cannot be empty
            formContent.Add(new StringContent("echo."), "obj_ext_cmd");
            formContent.Add(new StringContent(DefaultUserAgent), "obj_ext_useragent");
            
            // Required non-empty tags
            formContent.Add(new StringContent(DefaultTags), "user_tags");

            try
            {
                _logger.LogInformation("Submitting URL analysis for: {Url}", req.Url);
                var response = await _httpClient.PostAsync("analysis/", formContent);
                
                _logger.LogInformation("ANY.RUN response: {StatusCode}", response.StatusCode);
                
                return await FormatResponse(response);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error submitting URL analysis for: {Url}", req.Url);
                return StatusCode(500, new { error = "Failed to submit analysis", details = ex.Message });
            }
        }

        /// <summary>
        /// Check the status of an analysis task
        /// </summary>
        [HttpGet("status/{taskUuid}")]
        public async Task<IActionResult> GetStatus(string taskUuid)
        {
            try
            {
                _logger.LogInformation("Checking status for task: {TaskUuid}", taskUuid);
                var response = await _httpClient.GetAsync($"analysis/status/{taskUuid}");
                
                return await FormatResponse(response);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error checking status for task: {TaskUuid}", taskUuid);
                return StatusCode(500, new { error = "Failed to check status", details = ex.Message });
            }
        }

        /// <summary>
        /// Get full IOC JSON report with summary
        /// </summary>
        [HttpGet("report/{taskUuid}")]
        public async Task<IActionResult> GetReport(string taskUuid)
        {
            try
            {
                _logger.LogInformation("Fetching report for task: {TaskUuid}", taskUuid);
                var response = await _httpClient.GetAsync($"report/{taskUuid}/ioc/json");
                
                var result = await FormatResponseWithSummary(response);
                return result;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error fetching report for task: {TaskUuid}", taskUuid);
                return StatusCode(500, new { error = "Failed to fetch report", details = ex.Message });
            }
        }

        /// <summary>
        /// Get user's task history
        /// </summary>
        [HttpGet("history")]
        public async Task<IActionResult> GetHistory([FromQuery] int limit = 25, [FromQuery] int skip = 0)
        {
            try
            {
                var query = $"?limit={limit}&skip={skip}";
                var response = await _httpClient.GetAsync($"analysis/{query}");
                return await FormatResponse(response);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error fetching history");
                return StatusCode(500, new { error = "Failed to fetch history", details = ex.Message });
            }
        }

        // --- Helpers ---
        private async Task<IActionResult> FormatResponse(HttpResponseMessage response)
        {
            var text = await response.Content.ReadAsStringAsync();

            _logger.LogDebug("[ANY.RUN] Response {StatusCode}: {Content}", response.StatusCode, text);

            if (!response.IsSuccessStatusCode)
            {
                _logger.LogError("[ANY.RUN] Error {Status}: {Body}", response.StatusCode, text);

                try
                {
                    var errorObj = JsonSerializer.Deserialize<JsonElement>(text);
                    if (errorObj.TryGetProperty("message", out var messageProp))
                    {
                        var message = messageProp.GetString() ?? text;
                        return StatusCode((int)response.StatusCode, new { error = message });
                    }
                    return StatusCode((int)response.StatusCode, new { error = text });
                }
                catch
                {
                    return StatusCode((int)response.StatusCode, new { error = text });
                }
            }

            try
            {
                // Parse the successful response to extract task ID
                var json = JsonSerializer.Deserialize<JsonElement>(text);
                if (json.TryGetProperty("error", out var errorProp) && errorProp.GetBoolean() == false)
                {
                    if (json.TryGetProperty("data", out var dataProp) && 
                        dataProp.TryGetProperty("taskid", out var taskIdProp))
                    {
                        var taskId = taskIdProp.GetString();
                        _logger.LogInformation("Task created successfully: {TaskId}", taskId);
                        return Ok(new { success = true, taskId, data = json });
                    }
                }
                return Ok(json);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Failed to parse ANY.RUN response: {Text}", text);
                return Ok(new { raw = text, parseError = ex.Message });
            }
        }

        /// <summary>
        /// Format response with IOC summary for Sentali
        /// </summary>
        private async Task<IActionResult> FormatResponseWithSummary(HttpResponseMessage response)
        {
            var text = await response.Content.ReadAsStringAsync();
            var iocs = new List<object>();

            _logger.LogDebug("[ANY.RUN] Report response {StatusCode}: {Content}", response.StatusCode, text);

            if (!response.IsSuccessStatusCode)
            {
                _logger.LogError("[ANY.RUN] Report error {Status}: {Body}", response.StatusCode, text);
                return StatusCode((int)response.StatusCode, new { error = text });
            }

            try
            {
                var jsonArray = JsonSerializer.Deserialize<JsonElement[]>(text);
                
                // Extract key IOCs and build summary
                var summary = new
                {
                    totalIocs = jsonArray.Length,
                    categories = new Dictionary<string, int>(),
                    topIocs = new List<object>(),
                    threatIndicators = new List<string>()
                };

                foreach (var ioc in jsonArray)
                {
                    if (ioc.TryGetProperty("category", out var category) &&
                        ioc.TryGetProperty("type", out var type) &&
                        ioc.TryGetProperty("ioc", out var iocValue) &&
                        ioc.TryGetProperty("reputation", out var reputation))
                    {
                        var iocObj = new
                        {
                            category = category.GetString(),
                            type = type.GetString(),
                            ioc = iocValue.GetString(),
                            reputation = reputation.GetInt32(),
                            name = ioc.TryGetProperty("name", out var name) ? name.GetString() : null
                        };

                        iocs.Add(iocObj);

                        // Count categories
                        var cat = category.GetString() ?? "Unknown";
                        if (!summary.categories.ContainsKey(cat))
                            summary.categories[cat] = 0;
                        summary.categories[cat]++;

                        // Add to top IOCs (limit to 10)
                        if (summary.topIocs.Count < 10)
                        {
                            summary.topIocs.Add(iocObj);
                        }

                        // Add threat indicators
                        var rep = reputation.GetInt32();
                        if (rep > 0) // Malicious reputation
                        {
                            var indicator = $"{type.GetString().ToUpper()}: {iocValue.GetString()}";
                            if (!summary.threatIndicators.Contains(indicator))
                                summary.threatIndicators.Add(indicator);
                        }
                    }
                }

                // Build Sentali-friendly summary
                var sentaliSummary = new
                {
                    success = true,
                    taskUuid = "N/A", // Would need to pass this in
                    summary = new
                    {
                        message = BuildSentaliSummary(summary),
                        verdict = GetVerdictFromIocs(iocs),
                        totalIocs = summary.totalIocs,
                        maliciousIocs = summary.threatIndicators.Count,
                        categories = summary.categories,
                        topIocs = summary.topIocs,
                        threatIndicators = summary.threatIndicators,
                        fullReport = iocs
                    },
                    raw = jsonArray
                };

                return Ok(sentaliSummary);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Failed to parse ANY.RUN IOC report: {Text}", text);
                return Ok(new { raw = text, parseError = ex.Message, iocs = iocs });
            }
        }

        /// <summary>
        /// Build a human-readable summary for Sentali
        /// </summary>
        private static string BuildSentaliSummary(dynamic summary)
        {
            var sb = new StringBuilder();
            sb.AppendLine("🔍 **ANY.RUN Analysis Summary**");
            sb.AppendLine();

            // Verdict
            var verdict = GetVerdictFromIocs((IEnumerable<object>)summary.topIocs);
            sb.AppendLine($"**Verdict:** {verdict}");
            sb.AppendLine();

            // IOC counts
            sb.AppendLine($"**Total IOCs Found:** {summary.totalIocs}");
            sb.AppendLine($"**Malicious Indicators:** {summary.maliciousIocs}");
            sb.AppendLine();

            // Categories
            if (summary.categories != null)
            {
                sb.AppendLine("**IOC Categories:**");
                foreach (var kvp in ((IDictionary<string, object>)summary.categories))
                {
                    sb.AppendLine($"  • {kvp.Key}: {kvp.Value}");
                }
                sb.AppendLine();
            }

            // Top threats
            if (summary.threatIndicators != null && ((ICollection<object>)summary.threatIndicators).Count > 0)
            {
                sb.AppendLine("**🚨 High-Risk Indicators:**");
                var threats = ((ICollection<object>)summary.threatIndicators).Take(5);
                foreach (string threat in threats)
                {
                    sb.AppendLine($"  • {threat}");
                }
                if (((ICollection<object>)summary.threatIndicators).Count > 5)
                {
                    sb.AppendLine($"  ... and {((ICollection<object>)summary.threatIndicators).Count - 5} more");
                }
                sb.AppendLine();
            }

            // Top IOCs
            if (summary.topIocs != null && ((ICollection<object>)summary.topIocs).Count > 0)
            {
                sb.AppendLine("**📋 Sample IOCs:**");
                foreach (var ioc in ((ICollection<object>)summary.topIocs).Take(3))
                {
                    dynamic iocObj = ioc;
                    var iocType = iocObj.type ?? "unknown";
                    var iocValue = iocObj.ioc ?? "N/A";
                    var iocName = iocObj.name ?? "";
                    var displayName = !string.IsNullOrEmpty(iocName) ? $"{iocName} ({iocType})" : iocType.ToUpper();
                    sb.AppendLine($"  • {displayName}: `{iocValue}`");
                }
                sb.AppendLine();
            }

            sb.AppendLine("**Full report available via API**");
            return sb.ToString();
        }

        /// <summary>
        /// Determine overall verdict from IOCs
        /// </summary>
        private static string GetVerdictFromIocs(IEnumerable<object> iocs)
        {
            var maliciousCount = 0;
            var totalCount = 0;

            foreach (var iocObj in iocs)
            {
                totalCount++;
                try
                {
                    dynamic ioc = iocObj;
                    if (ioc.reputation != null && (int)ioc.reputation > 0)
                    {
                        maliciousCount++;
                    }
                }
                catch
                {
                    // Ignore parsing errors
                }
            }

            if (totalCount == 0) return "No IOCs Found";
            if (maliciousCount == 0) return "Clean";
            if (maliciousCount >= totalCount * 0.5) return "MALICIOUS";
            if (maliciousCount > 0) return "SUSPICIOUS";
            
            return "Unknown";
        }
    }
}