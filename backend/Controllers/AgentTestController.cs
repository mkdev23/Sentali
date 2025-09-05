using Microsoft.AspNetCore.Mvc;

namespace SentaliApp.Controllers
{
    [ApiController]
    public class AgentTestController : ControllerBase
    {
        private readonly GptService _gpt;

        public AgentTestController(GptService gpt)
        {
            _gpt = gpt;
        }

        [HttpGet("api/agent-test")]
        public async Task<IActionResult> Test()
        {
            try
            {
                var reply = await _gpt.GetResponse("Hello from C#");
                return Ok(new { reply });
            }
            catch (Exception ex)
            {
                return StatusCode(500, new { error = ex.Message, stack = ex.StackTrace });
            }
        }
    }
}