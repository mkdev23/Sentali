// vrmMapping.ts
import { VRMExpressionPresetName } from '@pixiv/three-vrm';

// vrmMapping.ts
// Centralised mapping for WS → VRM shapekey names from your Blender export

export const expressionMap = {
  // Emotions (map presets to your model's exact names)
  joy: 'happy',
  angry: 'angry',
  sorrow: 'sad',
  neutral: 'neutral',
  fun: 'relaxed', // Or 'surprised' if better fit

  // Visemes (Azure phoneme → VRM shapekey)
  aa: 'aa',
  ee: 'ee',
  ih: 'ih',
  oh: 'oh',
  ou: 'ou',

  // Blinks
  blink: 'blink',
  blinkleft: 'blinkLeft',
  blinkright: 'blinkRight',

  // Optional: Look directions (if expanding gaze to blends)
  lookdown: 'lookDown',
  lookleft: 'lookLeft',
  lookright: 'lookRight',
  lookup: 'lookUp'
};