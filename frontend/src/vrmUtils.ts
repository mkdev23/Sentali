import {
  Scene,
  PerspectiveCamera,
  Vector3,
  Box3,
  MathUtils,
  Object3D,
  Camera,
  Quaternion

} from 'three';

import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRMUtils, VRM } from '@pixiv/three-vrm';

/**
 * Sets the VRM's LookAt target to the given camera if supported.
 */
export function applyLookAtPose(vrm: VRM, camera: Camera) {
  const lk: any = (vrm as any).lookAt;
  if (lk && 'target' in lk) {
    lk.target = camera;
  }
}

function alignArmToPencil(bone: Object3D | null | undefined, inwardOffset = 0) {
  if (!bone) return;

  let child: Object3D | null = null;
  bone.traverse((obj) => {
    if (
      obj !== bone &&
      (obj.name.toLowerCase().includes('lowerarm') ||
       obj.name.toLowerCase().includes('elbow') ||
       obj.name.toLowerCase().includes('hand'))
    ) {
      child = obj;
    }
  });
  if (!child) return;

  const startPos = new Vector3().setFromMatrixPosition(bone.matrixWorld);
  const endPos = new Vector3().setFromMatrixPosition(child.matrixWorld);

  const boneVec = endPos.clone().sub(startPos).normalize();
  const targetVec = new Vector3(0, -1, 0); // straight down

  const rotationQuat = new Quaternion().setFromUnitVectors(boneVec, targetVec);
  bone.quaternion.premultiply(rotationQuat);

  if (inwardOffset !== 0) {
    bone.rotateY(inwardOffset);
  }
}

export function applyRelaxedArms(vrm: VRM) {
  const humanoid: any = (vrm as any).humanoid;
  if (!humanoid) return;

  const bone = (name: string) =>
    humanoid.getNormalizedBoneNode?.(name) ||
    humanoid.getRawBoneNode?.(name) ||
    humanoid.getBoneNode?.(name);

  // Upper arms: hang straight with slight inward offset
  alignArmToPencil(bone('leftUpperArm'), -0.05);
  alignArmToPencil(bone('rightUpperArm'), 0.05);

    // Subtle elbow bend
    const lLower = bone('leftLowerArm');
    const rLower = bone('rightLowerArm');
    if (lLower) lLower.rotation.x += 0.12;
    if (rLower) rLower.rotation.x += 0.12;

  // Hands: your preferred .5 rotation for palms inward/fingers down
  const leftHand = bone('leftHand');
  const rightHand = bone('rightHand');
  if (leftHand) leftHand.rotation.set(Math.PI / 0.5, 0, Math.PI / 0.5);
  if (rightHand) rightHand.rotation.set(Math.PI / 0.5, 0, -Math.PI / 0.5);

  // Optional: tiny outward wrist roll for looseness
  if (leftHand) leftHand.rotation.y += 0.05;
  if (rightHand) rightHand.rotation.y -= 0.05;




    // Slight shoulder/clavicle relax
    const lShoulder = bone('leftShoulder') || bone('LeftShoulder');
    const rShoulder = bone('rightShoulder') || bone('RightShoulder');
    if (lShoulder) lShoulder.rotation.z -= 0.06;
    if (rShoulder) rShoulder.rotation.z += 0.06;


// Optional micro-idle helper you can call per-frame:
(vrm as any).__restIdle = (t: number) => {
  const head = bone('head');
  const chest = bone('chest');
  if (head) head.rotation.y += Math.sin(t * 0.25) * 0.0015;
  if (chest) chest.position.y += Math.sin(t * 1.2) * 0.003;
};


}



/**
 * Loads a VRM model, applies relaxed arms and look-at, adds to scene, and frames it.
 */
export async function loadVRM(
  url: string,
  scene: Scene,
  camera: PerspectiveCamera,
  controls: OrbitControls,
  onLoaded?: (vrm: VRM) => void
) {
  const loader = new GLTFLoader();
  loader.register((parser) => new VRMLoaderPlugin(parser));

  loader.load(
    url,
    (gltf) => {
      // Deprecation-safe skeleton optimization
      if (VRMUtils.combineSkeletons) {
        VRMUtils.combineSkeletons(gltf.scene);
      } else {
        VRMUtils.removeUnnecessaryJoints(gltf.scene);
      }

      const vrm = gltf.userData.vrm as VRM;

      applyRelaxedArms(vrm);
      applyLookAtPose(vrm, camera);

      scene.add(vrm.scene as unknown as Object3D);
      frameToHeadOrBounds(vrm, camera, controls);

      onLoaded?.(vrm);
    },
    undefined,
    (err) => console.error('Failed to load VRM', err)
  );
}

/**
 * Frames the camera on the VRM's head if possible, otherwise fits the whole model.
 */
function frameToHeadOrBounds(
  vrm: VRM,
  camera: PerspectiveCamera,
  controls: OrbitControls
) {
  const target = new Vector3();

  // Prefer framing on humanoid head
  const head =
    vrm.humanoid?.getNormalizedBoneNode?.('head') ||
    vrm.humanoid?.getRawBoneNode?.('head') ||
    vrm.humanoid?.getBoneNode?.('head');

  if (head) {
    head.getWorldPosition(target);

    // Place camera slightly above and forward of head
    const distance = 1.2;
    camera.position.copy(target).add(new Vector3(0.0, 0.1, distance));

    controls.target.copy(target);
    camera.updateProjectionMatrix();
    controls.update();
    return;
  }

  // Fallback: frame the whole model via bounding box
  const box = new Box3().setFromObject(vrm.scene);
  if (!isFinite(box.min.length()) || !isFinite(box.max.length())) {
    controls.target.set(0, 1.4, 0);
    camera.position.set(0, 1.4, 2.0);
    camera.updateProjectionMatrix();
    controls.update();
    return;
  }

  box.getCenter(target);
  const size = new Vector3();
  box.getSize(size);
  const maxSize = Math.max(size.x, size.y, size.z) || 1;
  const fitDistance =
    maxSize / (2 * Math.tan(MathUtils.degToRad(camera.fov / 2)));

  camera.position.set(
    target.x,
    target.y + maxSize * 0.1,
    target.z + fitDistance * 1.2
  );

  controls.target.copy(target);
  camera.updateProjectionMatrix();
  controls.update();
}