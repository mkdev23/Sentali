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
            const tNorm = elapsed / this.duration;

            // Phase 1: Raise arm (0–0.25)
            if (tNorm < 0.25) {
              const raiseT = tNorm / 0.25;
              upper.rotation.z = THREE.MathUtils.lerp(0, THREE.MathUtils.degToRad(70), raiseT);
              upper.rotation.x = THREE.MathUtils.lerp(0, THREE.MathUtils.degToRad(-20), raiseT);
              lower.rotation.z = THREE.MathUtils.lerp(0, THREE.MathUtils.degToRad(-150), raiseT);
              hand.rotation.set(0, 0, 0);
            }
            // Phase 2: Left–right wave (0.25–0.75)
            else if (tNorm < 0.75) {
              const waveT = (tNorm - 0.25) / 0.5;
              // Keep arm steady
              upper.rotation.z = THREE.MathUtils.degToRad(70);
              upper.rotation.x = THREE.MathUtils.degToRad(-20);
              lower.rotation.z = THREE.MathUtils.degToRad(-150);

              // Palm facing outward
              hand.rotation.x = THREE.MathUtils.degToRad(270);

              // Y‑axis rotation for side‑to‑side wave (2 cycles)
              const waveAngle = Math.sin(waveT * Math.PI * 4) * THREE.MathUtils.degToRad(25);
              hand.rotation.y = waveAngle;
              hand.rotation.z = 0;
            }
            // Phase 3: Lower arm back to rest (0.75–1)
            else {
              const lowerT = (tNorm - 0.75) / 0.25;
              upper.rotation.z = THREE.MathUtils.lerp(THREE.MathUtils.degToRad(70), 0, lowerT);
              upper.rotation.x = THREE.MathUtils.lerp(THREE.MathUtils.degToRad(-20), 0, lowerT);
              lower.rotation.z = THREE.MathUtils.lerp(THREE.MathUtils.degToRad(-150), 0, lowerT);
              hand.rotation.set(0, 0, 0); // fully reset hand
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