using System.Collections.Generic;

namespace SentaliApp.Config
{
    public static class ExpressionMaps
    {
        public static readonly Dictionary<char, string> PhonemeMap = new()
        {
            { 'a', "aa" }, { 'e', "ih" }, { 'i', "ih" },
            { 'o', "ou" }, { 'u', "ou" },
            { 'm', "mm" }, { 'p', "pp" }, { 'b', "pp" },
            { 'f', "ff" }, { 'v', "ff" }
        };

        public static readonly Dictionary<string, string> EmotionMap = new()
        {
            { "happy", "joy" },
            { "glad", "joy" },
            { "sad", "sorrow" },
            { "angry", "angry" },
            { "fun", "fun" }
        };
    }
}