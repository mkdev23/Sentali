using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Logging;
using SentaliApp.Services;
using System.Text.Json;

namespace SentaliApp.Controllers
{
    [ApiController]
    [Route("api/threat-model")]
    public class ThreatModelController : ControllerBase
    {
        private readonly GptService _gpt;
        private readonly ILogger<ThreatModelController> _logger;

        public ThreatModelController(GptService gpt, ILogger<ThreatModelController> logger)
        {
            _gpt = gpt;
            _logger = logger;
        }

        public class ModelRequest 
        { 
            public string? Description { get; set; }
            public string? Context { get; set; }
        }

        [HttpPost]
        public async Task<IActionResult> ModelThreats([FromBody] ModelRequest req)
        {
            if (string.IsNullOrWhiteSpace(req.Description))
                return BadRequest(new { error = "Missing description" });

            try
            {
                // Structured prompt for LLM with JSON schema
                var prompt = $@"
Analyze the following system for threats using STRIDE model.
System: {req.Description}

Context: {req.Context ?? ""}

Output strictly in JSON with schema:
{{
  ""risks"": {{
    ""riskMatrix"": ""STRIDE categorized risks as bullet points"",
    ""controls"": ""Mitigations as bullet points""
  }}
}}

Ensure output is valid JSON only.";

                var response = await _gpt.GetResponse(prompt);

                // Parse JSON response
                var risks = JsonSerializer.Deserialize<Dictionary<string, object>>(response);

                return Ok(new { risks });
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "[Threat Model] Error");
                return StatusCode(500, new { error = "Threat modeling failed", details = ex.Message });
            }
        }
    }
}