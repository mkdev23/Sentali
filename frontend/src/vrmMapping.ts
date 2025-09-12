// vrmMapping.ts
import { VRMExpressionPresetName } from '@pixiv/three-vrm';

// Centralised mapping for WS → VRM shapekey names from your Blender export
export const expressionMap = {
  // Emotions (map presets/sentiment to your model's exact names)
  joy: 'joy',
  angry: 'angry',
  sorrow: 'sorrow',
  neutral: 'neutral',
  fun: 'fun',
  surprised: 'surprised',

  // Visemes (Azure phoneme → VRM shapekey; match model’s names)
  aa: 'aa',
  ee: 'ee',
  ih: 'ih',
  oh: 'oh',
  ou: 'ou',

  // Blinks (direct)
  blink: 'blink',
  blinkleft: 'blinkleft',
  blinkright: 'blinkright',

  // Look directions (for gaze expansion if needed; currently bone-based)
  lookdown: 'lookdown',
  lookleft: 'lookleft',
  lookright: 'lookright',
  lookup: 'lookup',

  // Other model-specific
  infinity: 'infinity',
  irisbake: 'irisbake'
};