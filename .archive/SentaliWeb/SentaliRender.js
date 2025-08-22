// sentaliweb/SentaliRender.js
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { VRMLoaderPlugin } from '@pixiv/three-vrm';

let scene, camera, renderer, sentali;

init();
loadVRM('Assets/Sentali2.vrm');
connectWS('ws://localhost:8123');

function init() {
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(35, window.innerWidth / window.innerHeight, 0.1, 1000);
  camera.position.set(0, 1.4, 2.5);

  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  document.body.appendChild(renderer.domElement);

  const light = new THREE.DirectionalLight(0xffffff, 1);
  light.position.set(0, 2, 2);
  scene.add(light);

  window.addEventListener('resize', onResize);
  animate();
}

function onResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

function animate() {
  requestAnimationFrame(animate);
  if (sentali?.update) sentali.update(1 / 60); // ~60fps
  renderer.render(scene, camera);
}

function loadVRM(path) {
  const loader = new GLTFLoader();
  loader.register(parser => new VRMLoaderPlugin(parser));
  loader.load(
    path,
    (gltf) => {
      const vrm = gltf.userData.vrm;
      sentali = vrm;
      scene.add(vrm.scene);
      console.log('Sentali loaded.');
    },
    (ev) => console.log(`VRM loading ${(ev.loaded / ev.total * 100).toFixed(1)}%`),
    (err) => console.error('VRM load error', err)
  );
}

function connectWS(url) {
  let ws;
  const connect = () => {
    ws = new WebSocket(url);
    ws.onopen = () => console.log('[WS] connected');
    ws.onclose = () => {
      console.warn('[WS] disconnected, retrying in 1.5s');
      setTimeout(connect, 1500);
    };
    ws.onerror = (e) => console.error('[WS] error', e);
    ws.onmessage = (msg) => {
      try {
        const data = JSON.parse(msg.data);
        if (data.type === 'cue') {
          const name = normalizeExpressionName(data.expression);
          const weight = clamp01(data.intensity ?? 1.0);
          applyExpression(name, weight, data.duration);
          // Optional: play audio in browser that matches the expression
          // playAudio(`Assets/Audio/${data.expression}.wav`);
        }
      } catch (e) {
        console.error('WS parse error', e);
      }
    };
  };
  connect();
}

function clamp01(x) { return Math.max(0, Math.min(1, x)); }

function normalizeExpressionName(raw) {
  if (!raw) return 'Neutral';
  const s = String(raw).trim();
  // Map common lowercase to VRM preset case
  const lut = {
    neutral: 'Neutral',
    angry: 'Angry',
    joy: 'Joy',
    happy: 'Joy',
    fun: 'Fun',
    sorrow: 'Sorrow',
    sad: 'Sorrow',
    blink: 'Blink',
    blink_l: 'Blink_L',
    blink_r: 'Blink_R',
    lookup: 'LookUp',
    lookdown: 'LookDown',
    lookleft: 'LookLeft',
    lookright: 'LookRight',
    a: 'A', i: 'I', u: 'U', e: 'E', o: 'O'
  };
  const key = s.toLowerCase();
  return lut[key] ?? (s.charAt(0).toUpperCase() + s.slice(1));
}

function applyExpression(name, weight = 1.0, durationSec = null) {
  if (!sentali) return;

  // VRM 0.x: blendShapeProxy; VRM 1.x: expressionManager
  const proxy = sentali.blendShapeProxy;
  const exprMgr = sentali.expressionManager;

  // Immediate set
  const setValue = (n, w) => {
    if (exprMgr?.setValue) exprMgr.setValue(n, w);
    else if (proxy?.setValue) proxy.setValue(n, w);
  };

  setValue(name, weight);

  // Optional decay after duration
  if (durationSec && durationSec > 0) {
    setTimeout(() => setValue(name, 0.0), durationSec * 1000);
  }
}

// Optional browser-side audio if desired
let audioCtx;
function playAudio(url) {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  fetch(url)
    .then(res => res.ok ? res.arrayBuffer() : Promise.reject(new Error(res.statusText)))
    .then(buf => audioCtx.decodeAudioData(buf))
    .then(buffer => {
      const src = audioCtx.createBufferSource();
      src.buffer = buffer;
      src.connect(audioCtx.destination);
      src.start(0);
    })
    .catch(err => console.warn('Audio play skipped:', err.message));
}