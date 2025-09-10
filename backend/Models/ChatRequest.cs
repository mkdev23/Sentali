using System.Text.Json.Serialization;

namespace SentaliApp.Models
{
    public class ChatRequest
    {
        // Explicitly map the JSON property "text" to this C# property
        [JsonPropertyName("text")]
        public string Text { get; set; } = default!;
    }
}

