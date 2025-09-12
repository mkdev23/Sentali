// vrmMapping.ts
import { VRMExpressionPresetName } from '@pixiv/three-vrm';

// vrmMapping.ts
// Centralised mapping for WS → VRM shapekey names from your Blender export
// Expanded to cover all your model's blendshapes; backend outputs remapped here

export const expressionMap = {
  // Emotions (map presets/sentiment to your model's exact names)
  joy: 'happy',        // Positive → happy
  angry: 'angry',      // Negative → angry
  sorrow: 'sad',       // Mild negative → sad
  neutral: 'neutral',  // Default/neutral
  fun: 'relaxed',      // Mild positive → relaxed (or 'happy')
  surprised: 'surprised', // Mixed/uncertain → surprised

  // Visemes (Azure phoneme → VRM shapekey; direct matches)
  aa: 'A',
  ee: 'E',
  ih: 'I',
  oh: 'O',
  ou: 'U',

  // Blinks (direct)
  blink: 'blink',
  blinkleft: 'blinkLeft',
  blinkright: 'blinkRight',

  // Look directions (for gaze expansion if needed; currently bone-based)
  lookdown: 'lookDown',
  lookleft: 'lookLeft',
  lookright: 'lookRight',
  lookup: 'lookUp',

  // Other model-specific (if backend/WS sends these)
  infinity: 'infinity',  // Unused, but available
  irisbake: 'irisBake'   // Unused, perhaps eye-related
};