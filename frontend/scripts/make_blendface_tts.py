import os
import requests
import json

# Azure creds
subscription_key = os.getenv("AZURE_TTS_KEY")
region           = os.getenv("AZURE_TTS_REGION", "eastus")
if not subscription_key or not region:
    raise EnvironmentError("Set AZURE_TTS_KEY and AZURE_TTS_REGION as environment variables")

# SSML per emotion (using NZ-flavoured RyanNeural)
ssml_map = {
    "joy": "It's a beautiful day to build something amazing.",
    "sorrow": "I'm sorry… things didn’t go as planned.",
    "angry": "That’s not going to work for me.",
    "fun": "This is going to be so much fun!",
    "neutral": "Alright, let's get started.",
    "phonemes": "A… I… U… E… O…",
    "look_test": "Checking my view."
}

url = f"https://{region}.tts.speech.microsoft.com/cognitiveservices/v1"
headers = {
    "Ocp-Apim-Subscription-Key": subscription_key,
    "Content-Type": "application/ssml+xml",
    "X-Microsoft-OutputFormat": "riff-24khz-16bit-mono-pcm"
}

for expr, text in ssml_map.items():
    ssml = f"""
<speak version='1.0' xml:lang='en-GB'>
  <voice name='en-GB-RyanNeural'>{text}</voice>
</speak>
"""
    try:
        resp = requests.post(url, headers=headers, data=ssml.encode('utf-8'))
        resp.raise_for_status()
    except requests.exceptions.HTTPError as e:
        print(f"⚠️ Failed on {expr}: {e}")
        continue

    wav_filename = f"{expr}.wav"
    with open(wav_filename, "wb") as f:
        f.write(resp.content)
    print(f"💿 Saved {wav_filename}")

    # Create simple cue sheet
    cue = {
        "expression": expr,         # matches your VRM preset in VSeeFace
        "start_time": 0.0,           # seconds from audio start
        "duration": None,            # None = hold until audio end
        "intensity": 1.0              # 1.0 = full strength
    }
    with open(f"{expr}.json", "w", encoding="utf-8") as f:
        json.dump(cue, f, indent=2)
    print(f"📝 Cue sheet saved: {expr}.json")

print("✅ Audio + cues ready for lip sync + expression triggers.")