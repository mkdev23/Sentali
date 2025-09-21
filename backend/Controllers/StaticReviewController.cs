// Controllers/StaticReviewController.cs
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Logging;
using System.Diagnostics;
using System.IO;
using System.Text.Json;

namespace SentaliApp.Controllers
{
    [ApiController]
    [Route("api/static-review")]
    public class StaticReviewController : ControllerBase
    {
        private readonly ILogger<StaticReviewController> _logger;

        public StaticReviewController(ILogger<StaticReviewController> logger)
        {
            _logger = logger;
        }

        public class ReviewRequest
        {
            public string? Code { get; set; }
            public string? Language { get; set; } = "python"; // Default to Python
        }

        [HttpPost]
        public async Task<IActionResult> RunStaticReview([FromBody] ReviewRequest req)
        {
            if (string.IsNullOrWhiteSpace(req.Code) || string.IsNullOrWhiteSpace(req.Language))
                return BadRequest(new { error = "Missing code or language" });

            try
            {
                // Create temp dir/file
                var tempDir = Path.Combine(Path.GetTempPath(), Guid.NewGuid().ToString());
                Directory.CreateDirectory(tempDir);
                var extension = req.Language.ToLower() switch
                {
                    "python" => ".py",
                    "javascript" => ".js",
                    _ => ".txt" // Fallback
                };
                var filePath = Path.Combine(tempDir, "code" + extension);
                await System.IO.File.WriteAllTextAsync(filePath, req.Code);

                var findings = new List<object>();

                // Run tools based on language
                if (req.Language.ToLower() == "python")
                {
                    // Bandit
                    findings.AddRange(await RunTool("bandit", $"-r {filePath} -f json"));
                    // Semgrep (Python rules)
                    findings.AddRange(await RunTool("semgrep", $"--config=auto {filePath} --json"));
                }
                else if (req.Language.ToLower() == "javascript")
                {
                    // ESLint
                    findings.AddRange(await RunTool("eslint", $"{filePath} -f json"));
                    // Semgrep (JS rules)
                    findings.AddRange(await RunTool("semgrep", $"--config=auto {filePath} --json"));
                }

                // Cleanup
                Directory.Delete(tempDir, true);

                return Ok(new { findings });
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "[Static Review] Error");
                return StatusCode(500, new { error = "Static review failed", details = ex.Message });
            }
        }

        private async Task<List<object>> RunTool(string tool, string args)
        {
            var process = new Process
            {
                StartInfo = new ProcessStartInfo
                {
                    FileName = tool,
                    Arguments = args,
                    RedirectStandardOutput = true,
                    RedirectStandardError = true,
                    UseShellExecute = false,
                    CreateNoWindow = true
                }
            };

            process.Start();
            var output = await process.StandardOutput.ReadToEndAsync();
            var error = await process.StandardError.ReadToEndAsync();
            await process.WaitForExitAsync();

            if (process.ExitCode != 0)
            {
                _logger.LogWarning("[{Tool}] Exit {Code}: {Error}", tool, process.ExitCode, error);
                return new List<object>();
            }

            try
            {
                return JsonSerializer.Deserialize<List<object>>(output) ?? new List<object>();
            }
            catch
            {
                return new List<object> { new { rawOutput = output } };
            }
        }
    }
}