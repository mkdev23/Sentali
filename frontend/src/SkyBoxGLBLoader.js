// SkyboxGLBLoader.js
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

/**
 * Load a GLB skybox scene and prepare it for background use.
 *
 * Options:
 *  - desiredRadius: number | 'auto'  → if 'auto', will use controls.maxDistance*0.9 or camera.far*0.25
 *  - controls: OrbitControls         → used when desiredRadius is 'auto'
 *  - setSceneBackground: boolean     → also set scene.background from texture (default true)
 *
 * Returns: Promise<THREE.Object3D> sky object you should keep centered on the camera each frame.
 */
export async function loadGLBSkybox(url, scene, camera, options = {}) {
  const {
    desiredRadius = 'auto',
    controls = null,
    setSceneBackground = true,
  } = options;

  console.group(`🏞️ SkyboxGLBLoader: ${url}`);
  const loader = new GLTFLoader();

  const sky = await new Promise((resolve, reject) => {
    loader.load(
      url,
      (gltf) => {
        console.log('✅ GLB loaded successfully:', gltf);

        let textureFound = false;
        let skyTexture = null;

        // Inspect meshes and coerce to unlit, back-side materials
        gltf.scene.traverse((child) => {
          if (!child.isMesh) return;

          console.log(`🔍 Mesh: "${child.name}"`, child);

          const tex =
            child.material?.map ||
            child.material?.emissiveMap ||
            null;

          if (tex) {
            textureFound = true;
            skyTexture = tex;
            console.log(`🎨 Texture found on "${child.name}":`, tex);

            // Ensure texture displays as an equirectangular background
            tex.mapping = THREE.EquirectangularReflectionMapping;
            // Three r152+: use sRGBColorSpace instead of encoding
            if ('colorSpace' in tex) {
              tex.colorSpace = THREE.SRGBColorSpace;
            } else {
              // fallback for older three
              tex.encoding = THREE.sRGBEncoding;
            }
          } else {
            console.warn(`⚠️ No texture found on "${child.name}".`);
          }

          // Replace material with unlit so it renders without scene lighting
          const mat = new THREE.MeshBasicMaterial({
            map: tex,
            side: THREE.BackSide,
            depthWrite: false,     // prevent z from interfering with foreground
            fog: false,
            toneMapped: false      // keep colors vivid despite renderer tone mapping
          });
          child.material?.dispose();
          child.material = mat;
          child.frustumCulled = false;
        });

        if (!textureFound) {
          console.warn('⚠️ No textures found in any mesh. Check Skybox.ai export; consider HDR/cubemap fallback.');
        } else if (setSceneBackground && skyTexture) {
          scene.background = skyTexture;
          console.log('🌌 Scene background set from skybox texture.');
        }

        // Auto-scale to a sensible radius around the camera
        const targetRadius = (() => {
          if (desiredRadius !== 'auto' && typeof desiredRadius === 'number') return desiredRadius;
          const maxD = controls?.maxDistance ?? 0;
          const far = camera.far ?? 100;
          // Keep sky just inside the dolly limit, or a quarter of far plane
          return (maxD > 0 ? maxD * 0.9 : far * 0.25);
        })();

        const box = new THREE.Box3().setFromObject(gltf.scene);
        const sphere = box.getBoundingSphere(new THREE.Sphere());
        if (sphere.radius > 0) {
          const scale = targetRadius / sphere.radius;
          gltf.scene.scale.setScalar(scale);
          console.log(`📏 Auto-scaled by ${scale.toFixed(3)} to radius ${targetRadius.toFixed(3)}`);
        } else {
          console.warn('⚠️ Bounding sphere radius is 0 — scaling skipped.');
        }

        // Tag and return sky object; caller will keep it centered on camera each frame
        gltf.scene.userData.isSkybox = true;
        console.log('🎯 Skybox prepared (not parented).');
        resolve(gltf.scene);
      },
      (xhr) => {
        const pct = xhr.total ? (xhr.loaded / xhr.total * 100).toFixed(1) : '??';
        console.log(`⏳ Loading progress: ${pct}% (${xhr.loaded} / ${xhr.total || 'unknown'} bytes)`);
      },
      (err) => {
        console.error('❌ Failed to load GLB skybox:', err);
        if (err && err.stack) console.error('Stack trace:', err.stack);
        reject(err);
      }
    );
  });

  console.groupEnd();
  return sky;
}