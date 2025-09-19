using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Logging;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using Azure.Storage.Blobs;
using Azure.Storage.Blobs.Models;
using System.Collections.Generic;
using System.IO;

namespace SentaliApp.Controllers
{
    // PUBLIC TI MODELS - Accessible from background service
    public class TiFeedData
    {
        public long? lastUpdated { get; set; }
        public List<TiIoc> iocs { get; set; } = new();
        public int totalCount { get; set; }
    }

    public class TiIoc
    {
        public string id { get; set; } = string.Empty;
        public string type { get; set; } = string.Empty;
        public string? pattern { get; set; }
        public string? created { get; set; }
        public string confidence { get; set; } = "Unknown";
        public List<TiIocIndicator> indicators { get; set; } = new();
    }

    public class TiIocIndicator
    {
        public string type { get; set; } = string.Empty;
        public string value { get; set; } = string.Empty;
    }

    [ApiController]
    [Route("api/[controller]")]
    public class AnyRunController : ControllerBase
    {
        private readonly ILogger<AnyRunController> _logger;
        private readonly HttpClient _httpClient;
        private readonly string _apiKey;
        private readonly BlobServiceClient? _blobServiceClient;
        private readonly string _containerName = "threat-intel";
        private readonly TimeSpan _cacheDuration = TimeSpan.FromHours(48);

        public AnyRunController(
            ILogger<AnyRunController> logger,
            IHttpClientFactory httpClientFactory,
            IConfiguration config,
            BlobServiceClient? blobServiceClient = null)
        {
            _logger = logger;
            _httpClient = httpClientFactory.CreateClient();
            _blobServiceClient = blobServiceClient;

            _apiKey = config["ANYRUN_API_KEY"] ?? Environment.GetEnvironmentVariable("ANYRUN_API_KEY")
                      ?? throw new InvalidOperationException("ANYRUN_API_KEY not configured");

            // Try to initialize BlobServiceClient with SAS URL if not injected
            if (_blobServiceClient == null)
            {
                var sasUrl = config["ThreatIntelSasUrl"] ?? Environment.GetEnvironmentVariable("THREAT_INTEL_SAS_URL");
                if (!string.IsNullOrEmpty(sasUrl) && new Uri(sasUrl) != null)
                {
                    if (new UriBuilder(sasUrl).Uri != null) // Basic URL validation
                    {
                        _blobServiceClient = new BlobServiceClient(new Uri(sasUrl));
                    }
                }
            }

            _httpClient.BaseAddress = new Uri("https://api.any.run/v1/");
            _httpClient.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("API-Key", _apiKey);
        }

        // DTOs
        public record UrlRequest(string Url);
        public record IpRequest(string Ip);
        public record HashRequest(string Sha256);

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
                return await FormatResponse(response);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error submitting URL analysis for: {Url}", req.Url);
                return StatusCode(500, new { error = "Failed to submit analysis", details = ex.Message });
            }
        }

        /// <summary>
        /// Query IP against cached TI feeds
        /// </summary>
        [HttpPost("ti/ip")]
        public async Task<IActionResult> QueryTiIp([FromBody] IpRequest req)
        {
            if (string.IsNullOrWhiteSpace(req.Ip))
                return BadRequest(new { error = "Missing IP address" });

            try
            {
                var feedData = await GetCachedTiFeed();
                if (feedData == null)
                {
                    return StatusCode(503, new { error = "TI feeds not available. Please wait for cache initialization." });
                }

                var matches = SearchTiFeed(feedData, req.Ip, "ip");
                var lastUpdatedStr = feedData.lastUpdated.HasValue
                    ? DateTimeOffset.FromUnixTimeMilliseconds(feedData.lastUpdated.Value).ToString("O")
                    : "N/A";

                var response = new
                {
                    ip = req.Ip,
                    matches = matches,
                    lastUpdated = lastUpdatedStr,
                    totalIocs = feedData.totalCount,
                    searchType = "IP"
                };

                _logger.LogInformation("TI IP query for {Ip}: {MatchCount} matches found", req.Ip, matches.Count);
                return Ok(response);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error querying TI feed for IP: {Ip}", req.Ip);
                return StatusCode(500, new { error = "Failed to query TI feed", details = ex.Message });
            }
        }

        /// <summary>
        /// Query SHA256 hash against cached TI feeds
        /// </summary>
        [HttpPost("ti/hash")]
        public async Task<IActionResult> QueryTiHash([FromBody] HashRequest req)
        {
            if (string.IsNullOrWhiteSpace(req.Sha256))
                return BadRequest(new { error = "Missing SHA256 hash" });

            try
            {
                var feedData = await GetCachedTiFeed();
                if (feedData == null)
                {
                    return StatusCode(503, new { error = "TI feeds not available. Please wait for cache initialization." });
                }

                var matches = SearchTiFeed(feedData, req.Sha256, "hash");
                var lastUpdatedStr = feedData.lastUpdated.HasValue
                    ? DateTimeOffset.FromUnixTimeMilliseconds(feedData.lastUpdated.Value).ToString("O")
                    : "N/A";

                var response = new
                {
                    sha256 = req.Sha256,
                    matches = matches,
                    lastUpdated = lastUpdatedStr,
                    totalIocs = feedData.totalCount,
                    searchType = "Hash"
                };

                _logger.LogInformation("TI Hash query for {Hash}: {MatchCount} matches found", req.Sha256, matches.Count);
                return Ok(response);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error querying TI feed for hash: {Hash}", req.Sha256);
                return StatusCode(500, new { error = "Failed to query TI feed", details = ex.Message });
            }
        }

        /// <summary>
        /// Get TI feed status
        /// </summary>
        [HttpGet("ti/status")]
        public async Task<IActionResult> GetTiStatus()
        {
            try
            {
                var feedData = await GetCachedTiFeed();
                var lastUpdatedStr = feedData?.lastUpdated.HasValue == true
                    ? DateTimeOffset.FromUnixTimeMilliseconds(feedData.lastUpdated.Value).ToString("O")
                    : "Never";

                var nextUpdate = feedData?.lastUpdated.HasValue == true
                    ? DateTimeOffset.FromUnixTimeMilliseconds(feedData.lastUpdated.Value).Add(_cacheDuration).ToString("O")
                    : (string?)null;

                var status = new
                {
                    isAvailable = feedData != null,
                    lastUpdated = lastUpdatedStr,
                    totalIocs = feedData?.totalCount ?? 0,
                    nextUpdate
                };
                return Ok(status);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error getting TI status");
                return StatusCode(500, new { error = "Failed to get TI status", details = ex.Message });
            }
        }

        /// <summary>
        /// Manually trigger TI feed refresh (admin only)
        /// </summary>
        [HttpPost("ti/refresh")]
        public async Task<IActionResult> RefreshTiFeed()
        {
            try
            {
                var freshData = await FetchTiFeedFromApi();
                if (freshData != null)
                {
                    await SaveTiFeedToCache(freshData);
                    return Ok(new { success = true, message = $"TI feed updated successfully: {freshData.totalCount} IOCs" });
                }
                return StatusCode(503, new { error = "Failed to fetch fresh TI feed" });
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error refreshing TI feed cache");
                return StatusCode(500, new { error = "Failed to refresh TI feed", details = ex.Message });
            }
        }

        /// <summary>
        /// Get analysis status for a task
        /// </summary>
        [HttpGet("status/{taskId}")]
        public async Task<IActionResult> GetAnalysisStatus(string taskId)
        {
            if (string.IsNullOrWhiteSpace(taskId))
                return BadRequest(new { error = "Missing task ID" });

            try
            {
                _logger.LogInformation("Fetching status for task: {TaskId}", taskId);
                var response = await _httpClient.GetAsync($"analysis/{taskId}/status");
                return await FormatResponse(response);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error fetching status for task: {TaskId}", taskId);
                return StatusCode(500, new { error = "Failed to fetch status", details = ex.Message });
            }
        }

        /// <summary>
        /// Get analysis report for a task
        /// </summary>
        [HttpGet("report/{taskId}")]
        public async Task<IActionResult> GetAnalysisReport(string taskId)
        {
            if (string.IsNullOrWhiteSpace(taskId))
                return BadRequest(new { error = "Missing task ID" });

            try
            {
                _logger.LogInformation("Fetching report for task: {TaskId}", taskId);
                var response = await _httpClient.GetAsync($"analysis/{taskId}");
                return await FormatResponse(response);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error fetching report for task: {TaskId}", taskId);
                return StatusCode(500, new { error = "Failed to fetch report", details = ex.Message });
            }
        }

        // --- TI Feed Management ---
        private async Task<TiFeedData?> GetCachedTiFeed()
        {
            if (_blobServiceClient == null)
            {
                _logger.LogWarning("Azure Blob storage not configured, falling back to API calls");
                return await FetchTiFeedFromApi();
            }

            try
            {
                var containerClient = _blobServiceClient.GetBlobContainerClient(_containerName);
                var blobClient = containerClient.GetBlobClient("anyrun-ti-feed.json");

                // Check if blob exists
                if (!await blobClient.ExistsAsync())
                {
                    _logger.LogInformation("TI feed blob doesn't exist, fetching fresh data");
                    var freshData = await FetchTiFeedFromApi();
                    if (freshData != null)
                    {
                        await SaveTiFeedToCache(freshData);
                    }
                    return freshData;
                }

                // Get blob properties to check metadata
                var properties = await blobClient.GetPropertiesAsync();

                // Check if cache is expired based on last updated metadata
                if (properties.Value.Metadata != null &&
                    properties.Value.Metadata.TryGetValue("lastUpdated", out var lastUpdatedStr) &&
                    DateTimeOffset.TryParse(lastUpdatedStr, out var lastUpdated))
                {
                    if (DateTimeOffset.UtcNow - lastUpdated < _cacheDuration)
                    {
                        _logger.LogDebug("Using cached TI feed (last updated: {LastUpdated})", lastUpdated);
                        var download = await blobClient.DownloadStreamingAsync();
                        using var stream = download.Value.Content;
                        using var reader = new StreamReader(stream);
                        var json = await reader.ReadToEndAsync();
                        var data = JsonSerializer.Deserialize<TiFeedData>(json);
                        return data;
                    }
                }

                // Cache expired or no valid metadata, refresh
                _logger.LogInformation("TI feed cache expired or invalid, refreshing...");
                var freshData2 = await FetchTiFeedFromApi();
                if (freshData2 != null)
                {
                    await SaveTiFeedToCache(freshData2);
                }
                return freshData2;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error getting cached TI feed, falling back to API");
                return await FetchTiFeedFromApi();
            }
        }

        private async Task<TiFeedData?> FetchTiFeedFromApi()
        {
            try
            {
                _logger.LogInformation("Fetching fresh TI feed from ANY.RUN API");

                // Fetch STIX feed
                var stixResponse = await _httpClient.GetAsync("feeds/stix.json?IP=true&Domain=true&URL=true");
                if (!stixResponse.IsSuccessStatusCode)
                {
                    _logger.LogWarning("Failed to fetch STIX feed: {Status}", stixResponse.StatusCode);
                    return null;
                }

                var stixContent = await stixResponse.Content.ReadAsStringAsync();
                var stixData = JsonSerializer.Deserialize<JsonElement>(stixContent);

                // Parse and structure the data
                var feedData = new TiFeedData
                {
                    lastUpdated = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
                    iocs = new List<TiIoc>(),
                    totalCount = 0
                };

                // Parse STIX objects (simplified parsing for demo)
                if (stixData.TryGetProperty("objects", out var objects))
                {
                    foreach (var obj in objects.EnumerateArray())
                    {
                        try
                        {
                            if (obj.TryGetProperty("type", out var type) &&
                                obj.TryGetProperty("id", out var id))
                            {
                                var ioc = new TiIoc
                                {
                                    id = id.GetString() ?? "",
                                    type = type.GetString() ?? "",
                                    created = obj.TryGetProperty("created", out var created) ? created.GetString() : null,
                                    confidence = obj.TryGetProperty("x_confidence", out var confidence) ? confidence.GetString() : "Unknown"
                                };

                                // Extract indicators from pattern
                                if (obj.TryGetProperty("pattern", out var pattern))
                                {
                                    ioc.pattern = pattern.GetString();
                                    ioc.indicators = ParseStixPattern(ioc.pattern ?? "");
                                }

                                feedData.iocs.Add(ioc);
                            }
                        }
                        catch (Exception ex)
                        {
                            _logger.LogWarning(ex, "Error parsing STIX object");
                        }
                    }
                }

                feedData.totalCount = feedData.iocs.Count;
                _logger.LogInformation("Fetched {Count} IOCs from ANY.RUN TI feed", feedData.totalCount);
                return feedData;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error fetching TI feed from API");
                return null;
            }
        }

        private async Task SaveTiFeedToCache(TiFeedData feedData)
        {
            if (_blobServiceClient == null) return;

            try
            {
                var containerClient = _blobServiceClient.GetBlobContainerClient(_containerName);
                var blobClient = containerClient.GetBlobClient("anyrun-ti-feed.json");

                var json = JsonSerializer.Serialize(feedData, new JsonSerializerOptions
                {
                    WriteIndented = true,
                    PropertyNamingPolicy = JsonNamingPolicy.CamelCase
                });

                using var stream = new MemoryStream(Encoding.UTF8.GetBytes(json));

                // Use BlobUploadOptions for metadata (correct API)
                var options = new BlobUploadOptions
                {
                    HttpHeaders = new BlobHttpHeaders
                    {
                        ContentType = "application/json"
                    },
                    Metadata = new Dictionary<string, string>
                    {
                        ["lastUpdated"] = DateTimeOffset.UtcNow.ToString("O"),
                        ["recordCount"] = feedData.totalCount.ToString(),
                        ["feedType"] = "stix"
                    }
                };

                await blobClient.UploadAsync(stream, options);
                _logger.LogInformation("Saved TI feed to Azure Blob Storage: {Count} IOCs", feedData.totalCount);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error saving TI feed to cache");
            }
        }

        private List<TiIocIndicator> ParseStixPattern(string pattern)
        {
            var indicators = new List<TiIocIndicator>();

            // Simple pattern parsing
            var parts = pattern.Split("AND", StringSplitOptions.RemoveEmptyEntries);
            foreach (var part in parts)
            {
                var trimmed = part.Trim();

                // IP pattern
                if (trimmed.Contains("[ipv4-addr:value = '"))
                {
                    var ipMatch = System.Text.RegularExpressions.Regex.Match(trimmed, @"'([^']+)'");
                    if (ipMatch.Success)
                    {
                        indicators.Add(new TiIocIndicator { type = "ip", value = ipMatch.Groups[1].Value });
                    }
                }
                // Domain pattern
                else if (trimmed.Contains("[domain-name:value = '"))
                {
                    var domainMatch = System.Text.RegularExpressions.Regex.Match(trimmed, @"'([^']+)'");
                    if (domainMatch.Success)
                    {
                        indicators.Add(new TiIocIndicator { type = "domain", value = domainMatch.Groups[1].Value });
                    }
                }
                // Hash pattern
                else if (trimmed.Contains("[sha-256:value = '"))
                {
                    var hashMatch = System.Text.RegularExpressions.Regex.Match(trimmed, @"'([^']+)'");
                    if (hashMatch.Success)
                    {
                        indicators.Add(new TiIocIndicator { type = "hash", value = hashMatch.Groups[1].Value });
                    }
                }
            }

            return indicators;
        }

        private List<object> SearchTiFeed(TiFeedData? feed, string query, string queryType)
        {
            if (feed == null || feed.iocs == null)
                return new List<object>();

            var matches = new List<object>();

            foreach (var ioc in feed.iocs)
            {
                foreach (var indicator in ioc.indicators ?? new List<TiIocIndicator>())
                {
                    if (string.Equals(indicator.type, queryType, StringComparison.OrdinalIgnoreCase) &&
                        string.Equals(indicator.value, query, StringComparison.OrdinalIgnoreCase))
                    {
                        matches.Add(new
                        {
                            iocId = ioc.id,
                            type = indicator.type,
                            value = indicator.value,
                            iocType = ioc.type,
                            confidence = ioc.confidence,
                            created = ioc.created,
                            details = $"IOC from {ioc.type} with confidence: {ioc.confidence}"
                        });
                    }
                }
            }

            return matches;
        }

        // --- FormatResponse method ---
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
    }

}