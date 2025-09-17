// gestures.js
import * as THREE from 'three';

  
export class GestureController {
  constructor(vrm) {
    this.vrm = vrm;
    this.active = null;
    this.startTime = 0;
    this.duration = 0;
  }

  play(name) {
    if (!this.vrm) return;

    this.active = name;
    this.startTime = performance.now();

    // Set durations per gesture
    switch (name) {
      case 'wave': this.duration = 2000; break;
      case 'nod': this.duration = 1200; break;
      case 'point': this.duration = 1500; break;
      case 'stop': this.duration = 1500; break;
      case 'listen': this.duration = 3000; break;
      default: this.duration = 1000;
    }
  }

  update() {
    if (!this.active) return;

    const elapsed = performance.now() - this.startTime;
    if (elapsed > this.duration) {
      this.reset();
      return;
    }
  

    const t = elapsed / this.duration;
    const { humanoid } = this.vrm;
    
    switch (this.active) {
      case 'wave': {
        const upper = humanoid.getNormalizedBoneNode('rightUpperArm');
        const lower = humanoid.getNormalizedBoneNode('rightLowerArm');
        const hand = humanoid.getNormalizedBoneNode('rightHand');

  if (upper && lower && hand) {
    // Keep arm lifted parallel to floor
    upper.rotation.z = THREE.MathUtils.degToRad(70); // ~shoulder height
    upper.rotation.x = THREE.MathUtils.degToRad(-20);  // no forward/back tilt

    // Bend elbow so hand is near head
     lower.rotation.z = THREE.MathUtils.degToRad(-150);  // moderate bend

    // Add gentle wrist wave motion
    const waveAngle = Math.sin(t * Math.PI * 2) * THREE.MathUtils.degToRad(20); // slower, 1 cycle/sec
    hand.rotation.z = waveAngle;

    // Palm facing outward
    hand.rotation.x = THREE.MathUtils.degToRad(270);
    hand.rotation.y = THREE.MathUtils.degToRad(0);

        // --- Phase 3: Return to rest (0.75–1) ---
    if (tNorm >= 0.75) {
      const returnT = (tNorm - 0.75) / 0.25;
      upper.rotation.z = THREE.MathUtils.degToRad(70 * (1 - returnT));
      upper.rotation.x = THREE.MathUtils.degToRad(-20 * (1 - returnT));
      lower.rotation.z = THREE.MathUtils.degToRad(60 * (1 - returnT));
      hand.rotation.z = 0;
    }
  }
  break;
}
      case 'nod': {
        const head = humanoid.getNormalizedBoneNode('head');
        if (head) head.rotation.x = Math.sin(t * Math.PI * 2) * 0.2;
        break;
      }
      case 'point': {
        const upper = humanoid.getNormalizedBoneNode('rightUpperArm');
        const lower = humanoid.getNormalizedBoneNode('rightLowerArm');
        if (upper && lower) {
          upper.rotation.z = THREE.MathUtils.degToRad(-45);
          lower.rotation.z = THREE.MathUtils.degToRad(-10);
        }
        break;
      }
      case 'stop': {
        const upper = humanoid.getNormalizedBoneNode('rightUpperArm');
        const lower = humanoid.getNormalizedBoneNode('rightLowerArm');
        const hand = humanoid.getNormalizedBoneNode('rightHand');
        if (upper && lower && hand) {
          upper.rotation.z = THREE.MathUtils.degToRad(-20);
          lower.rotation.z = THREE.MathUtils.degToRad(-10);
          hand.rotation.x = THREE.MathUtils.degToRad(90);
        }
        break;
      }
      case 'listen': {
        const head = humanoid.getNormalizedBoneNode('head');
        if (head) head.rotation.y = Math.sin(t * Math.PI * 2) * 0.15;
        break;
      }
    }
  }

  reset() {
    this.active = null;
  }
}
