using Newtonsoft.Json;

namespace SentaliApp.Models
{
    public class Cue
    {
        [JsonProperty("type")]
        public string Type { get; set; } = "blendshape";

        [JsonProperty("name")]
        public string Name { get; set; } = "";

        [JsonProperty("weight")]
        public float Weight { get; set; } = 0f;

        [JsonProperty("duration")]
        public float Duration { get; set; } = 0f;

        [JsonProperty("start_time")]
        public float StartTime { get; set; } = 0f;
    }
}

