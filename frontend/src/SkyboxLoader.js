import * as THREE from 'three';
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';

/**
 * Loads an HDRI for both high-res visuals and PBR lighting.
 * @param {THREE.WebGLRenderer} renderer
 * @param {THREE.Scene}          scene
 * @param {THREE.Camera}         camera
 * @param {string}               hdrPath       e.g. '/skybox/background1.hdr'
 * @param {number}               sphereRadius  radius of the inside sphere (default 50)
 */
export function loadHDRSkybox(renderer, scene, camera, hdrPath, sphereRadius = 50) {
  if (!(renderer instanceof THREE.WebGLRenderer)
   || !(scene    instanceof THREE.Scene)
   || !(camera   instanceof THREE.Camera)) {
    console.warn('SkyboxLoader: invalid renderer/scene/camera');
    return;
  }
  if (typeof hdrPath !== 'string' || !hdrPath.endsWith('.hdr')) {
    console.warn('SkyboxLoader: invalid HDR path');
    return;
  }

  const pmrem = new THREE.PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();

  new RGBELoader()
    // Remove UnsignedByteType (1009). Use HalfFloatType or FloatType instead:
    .setDataType(THREE.HalfFloatType)
    .load(
      hdrPath,
      (hdrTexture) => {
        // tell three this is an equirectangular environment
        hdrTexture.mapping = THREE.EquirectangularReflectionMapping;

        // 1) PBR lighting
        const envMap = pmrem.fromEquirectangular(hdrTexture).texture;
        scene.environment = envMap;

        // 2) Visual sphere
        const sphereGeo = new THREE.SphereGeometry(sphereRadius, 128, 128);
        sphereGeo.scale(-1, 1, 1); // invert so we see inside
        const sphereMat = new THREE.MeshBasicMaterial({ map: hdrTexture });
        const sphere    = new THREE.Mesh(sphereGeo, sphereMat);

        camera.add(sphere);
        scene.add(camera);

        pmrem.dispose();
      },
      undefined,
      (err) => {
        console.error('SkyboxLoader: failed to load HDR', err);
      }
    );
}