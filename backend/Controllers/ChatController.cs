using Microsoft.AspNetCore.Mvc;
using SentaliApp.Models;
using SentaliApp.Services;

namespace SentaliApp.Controllers
{
    [ApiController]
    [Route("api/[controller]")]   // this makes POST /api/chat
    public class ChatController : ControllerBase
    {
        private readonly GptService _gpt;

        public ChatController(GptService gpt)
        {
            _gpt = gpt;
        }

        [HttpPost]
        public async Task<IActionResult> Post([FromBody] ChatRequest request)
        {
            if (string.IsNullOrWhiteSpace(request.Text))
                return BadRequest("Missing 'text' in request body.");

            var reply = await _gpt.GetResponse(request.Text);
            return Ok(new ChatResponse { Text = reply });
        }
    }
}