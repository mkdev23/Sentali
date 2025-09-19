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

  // Store rest pose once at gesture start
  if (!this._waveRestPose && upper && lower && hand) {
    this._waveRestPose = {
      upperZ: upper.rotation.z,
      upperX: upper.rotation.x,
      lowerZ: lower.rotation.z,
      handX: hand.rotation.x,
      handY: hand.rotation.y,
      handZ: hand.rotation.z
    };
  }

  if (upper && lower && hand) {
    const tNorm = elapsed / this.duration;

    if (tNorm < 0.25) {
      // Raise arm
      const raiseT = tNorm / 0.25;
      upper.rotation.z = THREE.MathUtils.lerp(this._waveRestPose.upperZ, THREE.MathUtils.degToRad(70), raiseT);
      upper.rotation.x = THREE.MathUtils.lerp(this._waveRestPose.upperX, THREE.MathUtils.degToRad(-20), raiseT);
      lower.rotation.z = THREE.MathUtils.lerp(this._waveRestPose.lowerZ, THREE.MathUtils.degToRad(-150), raiseT);
    }
    else if (tNorm < 0.75) {
      // Hold arm, wave hand side-to-side
      upper.rotation.z = THREE.MathUtils.degToRad(70);
      upper.rotation.x = THREE.MathUtils.degToRad(-20);
      lower.rotation.z = THREE.MathUtils.degToRad(-150);

      hand.rotation.x = THREE.MathUtils.degToRad(270);
      hand.rotation.y = Math.sin((tNorm - 0.25) / 0.5 * Math.PI * 4) * THREE.MathUtils.degToRad(25);
      hand.rotation.z = 0;
    }
    else {
      // Lower arm back to rest pose
      const lowerT = (tNorm - 0.75) / 0.25;
      upper.rotation.z = THREE.MathUtils.lerp(THREE.MathUtils.degToRad(70), this._waveRestPose.upperZ, lowerT);
      upper.rotation.x = THREE.MathUtils.lerp(THREE.MathUtils.degToRad(-20), this._waveRestPose.upperX, lowerT);
      lower.rotation.z = THREE.MathUtils.lerp(THREE.MathUtils.degToRad(-150), this._waveRestPose.lowerZ, lowerT);
      hand.rotation.x = THREE.MathUtils.lerp(THREE.MathUtils.degToRad(270), this._waveRestPose.handX, lowerT);
      hand.rotation.y = THREE.MathUtils.lerp(0, this._waveRestPose.handY, lowerT);
      hand.rotation.z = THREE.MathUtils.lerp(0, this._waveRestPose.handZ, lowerT);
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