import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { VRMExpressionPresetName } from '@pixiv/three-vrm';

import { loadVRM } from './vrmUtils.js';
import { expressionMap } from './vrmMapping.js';
import { loadHDRSkybox } from './SkyboxLoader.js';
import { WSClient } from './ws.js';
import { BlendfacesController } from './blendfaces.js';

const overlay = document.getElementById('overlay');
const testBtn = document.getElementById('test');
const blendfacesToggle = document.getElementById('blendfacesToggle');

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(30, window.innerWidth / window.innerHeight, 0.1, 20);
camera.position.set(0, 1.4, 1.5);

const renderer = new THREE.WebGLRenderer({ antialias: true, canvas: document.getElementById('c') });
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setSize(window.innerWidth, window.innerHeight);

loadHDRSkybox(renderer, scene, camera, '/skybox/background1.hdr');

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 1.4, 0);
controls.update();

scene.add(new THREE.AmbientLight(0xffffff, 0.3));
scene.add(new THREE.GridHelper(10, 10));

const directionalLights = [
  new THREE.DirectionalLight(0xffffff, 1.2),
  new THREE.DirectionalLight(0xffffff, 0.6),
  new THREE.DirectionalLight(0xffffff, 0.8)
];
directionalLights[0].position.set(0.5, 1, 0.8);
directionalLights[1].position.set(-0.5, 0.8, -0.8);
directionalLights[2].position.set(0, 1, -1);
directionalLights.forEach(light => scene.add(light));

let currentVRM;
let blendfaces;
const clock = new THREE.Clock();

loadVRM('/Assets/Sentali2.vrm', scene, camera, controls, (vrm) => {
  currentVRM = vrm;
  vrm.scene.rotation.y = Math.PI;
  controls.target.set(0, 1.4, 0);
  controls.update();
  overlay && (overlay.textContent = '✅ VRM loaded — waiting for WS data...');

  blendfaces = new BlendfacesController(vrm, {
    expressionMap,
    smooth: 0.3,
    decay: 1.5,
    rest: { blink: 0.0, neutral: 1.0 }
  });
});

function setExpression(rawName, weight) {
  if (!currentVRM) return;
  const key = rawName.toLowerCase();
  const mapped = expressionMap[key] ?? VRMExpressionPresetName[key] ?? rawName;

  if (currentVRM.expressionManager) {
    currentVRM.expressionManager.setValue(mapped, weight);
    currentVRM.expressionManager.update();
  } else if (currentVRM.blendShapeProxy) {
    currentVRM.blendShapeProxy.setValue(mapped, weight);
    currentVRM.blendShapeProxy.update();
  }
}

function shouldUseBlendfaces() {
  return blendfacesToggle?.checked && blendfaces;
}

const wsClient = new WSClient({
  url: 'ws://localhost:8123/ws',
  onOpen: () => overlay && (overlay.textContent = '✅ WS connected — waiting for cues...'),
  onMessage: (data) => {
    if (shouldUseBlendfaces()) {
      blendfaces.attachWS((cb) => cb(data));
    } else {
      if (data.type === 'blendshape') setExpression(data.name, data.weight);
      else if (data.type === 'blendshapes') Object.entries(data.values).forEach(([k, v]) => setExpression(k, v));
      else if (data.type === 'viseme') setExpression(data.name, data.weight);
    }
  },
  onClose: () => overlay && (overlay.textContent = '❌ WS disconnected')
});
wsClient.connect();

if (testBtn) {
  testBtn.onclick = () => {
    if (shouldUseBlendfaces()) {
      blendfaces.set('aa', 1.0, 'live');
      overlay && (overlay.textContent = 'Local Test: Aa (1.0)');
      setTimeout(() => blendfaces.set('aa', 0.0, 'live'), 500);
    } else {
      setExpression(VRMExpressionPresetName.Aa, 1.0);
      overlay && (overlay.textContent = 'Local Test: Aa (1.0)');
      setTimeout(() => setExpression(VRMExpressionPresetName.Aa, 0), 500);
    }
  };
}

let blinkTimer = 2 + Math.random() * 3;
let gazeTimer = 2 + Math.random() * 2;
let gazeDirection = 0;

function handleBlink(delta) {
  blinkTimer -= delta;
  if (blinkTimer <= 0) {
    if (shouldUseBlendfaces()) {
      blendfaces.set('blink', 1.0, 'live');
      setTimeout(() => blendfaces.set('blink', 0.0, 'live'), 150);
    } else {
      setExpression(VRMExpressionPresetName.Blink, 1.0);
      setTimeout(() => setExpression(VRMExpressionPresetName.Blink, 0), 150);
    }
    blinkTimer = 2 + Math.random() * 3;
  }
}

function handleGaze(delta) {
  gazeTimer -= delta;
  if (gazeTimer <= 0) {
    gazeDirection = (Math.random() - 0.5) * 0.4;
    gazeTimer = 2 + Math.random() * 2;
  }
  const head = currentVRM?.humanoid?.getNormalizedBoneNode('head');
  if (head) head.rotation.y = THREE.MathUtils.lerp(head.rotation.y, gazeDirection, 0.05);
}

function handleBreath() {
  const chest = currentVRM?.humanoid?.getNormalizedBoneNode('chest');
  if (chest) chest.position.y = Math.sin(clock.elapsedTime * 1.5) * 0.005;
}

function animate() {
  requestAnimationFrame(animate);
  const delta = clock.getDelta();

  if (currentVRM) {
    currentVRM.update(delta);
    handleBlink(delta);
    handleGaze(delta);
    handleBreath();
    if (shouldUseBlendfaces()) blendfaces.update(delta);
  }

  controls.update();
  renderer.render(scene, camera);
}
animate();

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});