using System;
using System.Collections.Generic;

public class BlendshapeController
{
    private Dictionary<string, int> blendshapeMap = new();

    public BlendshapeController(Dictionary<string, int> map)
    {
        blendshapeMap = map;
    }

    public BlendshapeController() { } // default constructor for testing

    public int GetBlendshapeIndex(string expression)
    {
        return blendshapeMap.TryGetValue(expression, out int index) ? index : -1;
    }
}



