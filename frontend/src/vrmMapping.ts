import { VRMExpressionPresetName } from '@pixiv/three-vrm';

// vrmMapping.ts
// Centralised mapping for WS → VRM shapekey names from your Blender export

export const expressionMap = {
  // Emotions
  joy: 'BlendShape.joy',
  angry: 'BlendShape.angry',
  sorrow: 'BlendShape.sorrow',
  neutral: 'BlendShape.Neutral',
  fun: 'BlendShape.fun',

  // Visemes (Azure phoneme → VRM shapekey)
  aa: 'BlendShape.A', // mouth open (A)
  ee: 'BlendShape.E', // E
  ih: 'BlendShape.I', // I
  oh: 'BlendShape.O', // O
  ou: 'BlendShape.U', // U

  // Blinks
  blink: 'BlendShape.blink',
  blinkleft: 'BlendShape.blink_l',
  blinkright: 'BlendShape.blink_R'
};
