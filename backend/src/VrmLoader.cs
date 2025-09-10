using SharpGLTF.Schema2;
using System.Text.Json;

public class VrmLoader
{
    public ModelRoot? Model { get; private set; }

    public Dictionary<string, List<int>> LoadBlendshapeMap(string relativePath)
    {
        // 1) Try to resolve relative to deployed web root (Azure)
        var vrmPath = Path.Combine(Directory.GetCurrentDirectory(), "wwwroot", relativePath);

        // 2) If not found, fall back to project root (local dev)
        if (!File.Exists(vrmPath))
        {
            vrmPath = Path.Combine(
                AppContext.BaseDirectory, // e.g., bin\Debug\net9.0
                "..", "..", "..",         // back to project root
                relativePath
            );
            vrmPath = Path.GetFullPath(vrmPath);
        }

        if (!File.Exists(vrmPath))
            throw new FileNotFoundException($"VRM file not found in either wwwroot or project root: {vrmPath}");

        // Load the model into SharpGLTF so you can still use it later if needed
        Model = ModelRoot.Load(vrmPath);

        // Extract JSON chunk from GLB
        byte[] jsonChunk = ExtractJsonChunk(vrmPath);

        using var doc = JsonDocument.Parse(jsonChunk);
        var root = doc.RootElement;

        if (!root.TryGetProperty("extensions", out var extensions) ||
            !extensions.TryGetProperty("VRM", out var vrmJson))
        {
            throw new Exception("VRM extension not found in model.");
        }

        var blendshapeMap = new Dictionary<string, List<int>>();
        var blendShapeGroups = vrmJson
            .GetProperty("blendShapeMaster")
            .GetProperty("blendShapeGroups");

        foreach (var group in blendShapeGroups.EnumerateArray())
        {
            string name = group.GetProperty("name").GetString() ?? "unknown";
            if (!blendshapeMap.ContainsKey(name))
                blendshapeMap[name] = new List<int>();

            foreach (var bind in group.GetProperty("binds").EnumerateArray())
            {
                int index = bind.GetProperty("index").GetInt32();
                blendshapeMap[name].Add(index);
            }
        }

        return blendshapeMap;
    }

    private byte[] ExtractJsonChunk(string path)
    {
        using var fs = File.OpenRead(path);
        using var br = new BinaryReader(fs);

        // GLB header
        uint magic = br.ReadUInt32(); // should be 0x46546C67 ("glTF")
        if (magic != 0x46546C67) throw new Exception("Not a valid GLB file.");

        br.ReadUInt32(); // version
        br.ReadUInt32(); // length

        // First chunk: JSON
        uint chunkLength = br.ReadUInt32();
        uint chunkType = br.ReadUInt32(); // should be 0x4E4F534A ("JSON")
        if (chunkType != 0x4E4F534A) throw new Exception("First GLB chunk is not JSON.");

        return br.ReadBytes((int)chunkLength);
    }
}
