// main.js
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { expressionMap } from './vrmMapping.js';
import { loadVRM } from './vrmUtils.js';
import { WSClient } from './ws.js';
import { BlendfacesController } from './blendfaces.js';
import { loadGLBSkybox } from './SkyBoxGLBLoader.js';
import { GestureController } from './components/gestures.js';
import React from 'react';
import ReactDOM from 'react-dom/client';
import ChatBlock from './components/ChatBlock.jsx';
import ChatMessage from './components/ChatMessage.jsx';

// ——— Config & Globals ———
const backendBase = 'https://sentali-app-6926-e4gwhtajg3dfaphs.eastus2-01.azurewebsites.net';

let currentVRM = null;
let exprMgr = null;        // VRM1: expressionManager; VRM0: blendShapeProxy
let vrmReady = false;

let blendfaces = null;
let blendfacesWSHandler = null;

let isSpeaking = false;
let ttsInflight = false;
let ttsAbortController = null;

const clock = new THREE.Clock();
const activeExpr = {};
const DECAY_EMO = 3.0;
const SMOOTH = 0.4;

let chestBaseY = 0;
let blinkTimer = 2 + Math.random() * 3;
let gazeTimer = 2 + Math.random() * 2;
let gazeDirection = 0;
let visemeActive = false; // true while a viseme timeline/schedule is active

// ——— Chat UI State (moved up to avoid undefined errors) ———
let chatMessages = [];
let chatRoot = null;

// ——— Scene / Renderer / Camera ———
const canvas = document.getElementById('c');
const renderer = new THREE.WebGLRenderer({ antialias: true, canvas });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.9; // avoids facial washout

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(25, window.innerWidth / window.innerHeight, 0.1, 200);
camera.position.set(0, 1.6, 4.5);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 1.6, 0);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.minDistance = 1.0;
controls.maxDistance = 6.0;
controls.update();

// ——— Lighting (balanced three‑point) ———
// Softer ambient
scene.add(new THREE.AmbientLight(0xffffff, 0.5));

// Warm key light (front-right)
const key = new THREE.DirectionalLight(0xfff1e0, 1.5);
key.position.set(0.8, 1.2, 1.0);
scene.add(key);

// Cool fill light (front-left)
const fill = new THREE.DirectionalLight(0xe0f0ff, 0.9);
fill.position.set(-0.8, 1.0, 0.8);
scene.add(fill);

// Neutral rim/back light
const rim = new THREE.DirectionalLight(0xffffff, 0.8);
rim.position.set(0, 1.0, -1.0);
scene.add(rim);

// ——— Groups ———
const vrmGroup = new THREE.Group();
const skyGroup = new THREE.Group();
scene.add(vrmGroup, skyGroup);

// ——— Helpers ———
function getMgr() {
  return exprMgr || currentVRM?.expressionManager || currentVRM?.blendShapeProxy || null;
}

function isMobile() {
  return /Mobi|Android/i.test(navigator.userAgent);
}

// Head world position
function getHeadWorld(vrm) {
  const head =
    vrm?.humanoid?.getNormalizedBoneNode?.('head') ||
    vrm?.scene?.getObjectByName?.('Head');
  const p = new THREE.Vector3(0, 1.6, 0);
  if (!head) return p;
  head.getWorldPosition(p);
  return p;
}

// Put camera in front of face at a given distance
function frameFace(vrm, distance = 4.5, eyeY = 1.6) {
  const headPos = getHeadWorld(vrm);
  controls.target.copy(headPos);
  const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(vrm.scene.getWorldQuaternion(new THREE.Quaternion()));
  forward.y = 0; forward.normalize();
  const camPos = headPos.clone().add(forward.clone().multiplyScalar(-distance));
  camera.position.set(camPos.x, eyeY, camPos.z);
  controls.update();
}

// Yaw-align avatar so face looks at camera target
function faceCamera(vrm) {
  const headPos = getHeadWorld(vrm);
  const toCam = new THREE.Vector3().subVectors(controls.target, headPos);
  toCam.y = 0;
  if (toCam.lengthSq() < 1e-6) return;
  const desiredYaw = Math.atan2(-toCam.x, -toCam.z);
  const fwdWorld = new THREE.Vector3(0, 0, 1)
    .applyQuaternion(vrm.scene.getWorldQuaternion(new THREE.Quaternion()));
  const currentYaw = Math.atan2(fwdWorld.x, fwdWorld.z);
  vrm.scene.rotation.y += (desiredYaw - currentYaw);
}

// ——— Skybox loader with fallback ———
async function loadSkyboxWithRetry(url, retries = 3, timeoutMs = 30000) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await Promise.race([
        loadGLBSkybox(url, scene, camera, { desiredRadius: camera.far * 0.9, setSceneBackground: true }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), timeoutMs))
      ]);
    } catch (err) {
      console.warn(`[Skybox] Attempt ${attempt} failed:`, err);
      if (attempt === retries) throw err;
      await new Promise(r => setTimeout(r, 2000));
    }
  }
}

(async () => {
  try {
    if (isMobile()) {
      const loader = new THREE.TextureLoader();
      const texture = await loader.loadAsync('/skybox/background1.png');
      texture.mapping = THREE.EquirectangularReflectionMapping;
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.flipY = false;
      scene.background = texture;
      scene.environment = texture;
    } else {
      const skyboxUrl = 'https://sentaliskybox-azure-fpb4b0hxcff2f3f4.z03.azurefd.net/skyboxes/sentali_skybox.glb?sp=r&st=2025-09-10T04:07:34Z&se=2027-09-11T12:22:34Z&spr=https&sv=2024-11-04&sr=b&sig=VvlNDwJ5iSJGDkIcLcdCsQULT7iLPJbnrIzHVgf4wAg%3D';
      const sb = await loadSkyboxWithRetry(skyboxUrl);
      if (sb) {
        const maxAniso = renderer.capabilities.getMaxAnisotropy() || 8;
        sb.traverse(child => {
          if (child.isMesh) {
            const tex = child.material.map || child.material.emissiveMap;
            if (tex) {
              tex.mapping = THREE.EquirectangularReflectionMapping;
              tex.colorSpace = THREE.SRGBColorSpace;
              tex.flipY = false;
              tex.generateMipmaps = true;
              tex.minFilter = THREE.LinearMipmapLinearFilter;
              tex.magFilter = THREE.LinearFilter;
              tex.anisotropy = maxAniso;
              scene.background = tex;
            }
            child.material = new THREE.MeshBasicMaterial({
              map: child.material.map || child.material.emissiveMap,
              side: THREE.BackSide,
              toneMapped: false
            });
          }
        });
        sb.rotation.y = Math.PI;
        sb.scale.setScalar(camera.far * 0.9);
        skyGroup.add(sb);
      }
    }
  } catch (err) {
    console.error('Skybox load failed:', err);
    renderer.setClearColor(0x000000, 1);
  }
})();

// ——— Expression management ———
function setExpressionPersistent(name, weight, decay = DECAY_EMO) {
  const mapped = expressionMap[name] ?? name;
  if (!mapped || mapped === 'neutral') return; // never push neutral
  activeExpr[mapped] = { weight, decay };
}

function applyExpressions(delta) {
  if (!vrmReady) return;
  const mgr = getMgr();
  if (!mgr) return;

  for (const [m, st] of Object.entries(activeExpr)) {
    st.weight = THREE.MathUtils.lerp(st.weight, 0, st.decay * delta);
    if (st.weight < 0.01) { delete activeExpr[m]; continue; }
    const curr = mgr.getValue(m) || 0;
    const blend = THREE.MathUtils.lerp(curr, st.weight, SMOOTH);
    mgr.setValue(m, blend);
  }
  // sentiment layer will be applied just before render/update in tick()
}

// ——— Ambient behaviours ———
function handleBlink(delta) {
  blinkTimer -= delta;
  if (blinkTimer <= 0) {
    if (blendfaces) blendfaces.set('blink', 1.0, 'live', 120);
    blinkTimer = 2 + Math.random() * 3;
  }
}

function handleGaze(delta) {
  gazeTimer -= delta;
  if (gazeTimer <= 0) { gazeDirection = (Math.random() - 0.5) * 0.2; gazeTimer = 2 + Math.random() * 2; }
  const head = currentVRM?.humanoid.getNormalizedBoneNode('head') || currentVRM?.scene.getObjectByName('Head');
  if (head) head.rotation.y += (gazeDirection - head.rotation.y) * 0.05;
}

function handleBreath(t) {
  const chest = currentVRM?.humanoid.getNormalizedBoneNode('chest')
             || currentVRM?.humanoid.getNormalizedBoneNode('upper_chest')
             || currentVRM?.scene.getObjectByName('Spine1')
             || currentVRM?.scene.getObjectByName('Spine2');
  if (chest) chest.position.y = chestBaseY + Math.sin(t * 0.5) * 0.01;
}

// ——— Sentiment layer (held over entire utterance) ———
let sentimentLayer = { name: null, weight: 0, until: 0 };

function applySentimentLayer(nowMs) {
  if (!vrmReady || !sentimentLayer.name) return;
  
  const mgr = getMgr();
  if (!mgr) return;
  
  const key = expressionMap[sentimentLayer.name] ?? sentimentLayer.name;
  
  if (key && key !== 'neutral') {
    // Apply the sentiment weight
    mgr.setValue(key, sentimentLayer.weight);
  }
}

function clearSentimentLayer() {
  if (!vrmReady || !sentimentLayer.name) return;
  
  const mgr = getMgr();
  if (!mgr) return;
  
  const key = expressionMap[sentimentLayer.name] ?? sentimentLayer.name;
  
  if (key && key !== 'neutral') {
    // Explicitly set sentiment to 0
    mgr.setValue(key, 0);
    console.log(`[Sentiment] Cleared ${sentimentLayer.name} expression`);
  }
  
  // Reset the layer
  sentimentLayer = { name: null, weight: 0, until: 0 };
}

function setSentimentHold(expression, audio, weight = 0.6, durationMs) {
  if (!expression || expression === 'neutral') return;

  const holdMs = durationMs ?? (audio?.duration ? audio.duration * 1000 : 2000);
  const endTime = performance.now() + holdMs;
  
  sentimentLayer = {
    name: expression,
    weight,
    until: endTime
  };

  console.log(`[Sentiment] Setting ${expression} for ${holdMs}ms (until ${endTime})`);

  // Apply immediately for instant feedback
  const mgr = getMgr();
  if (mgr) {
    const key = expressionMap[expression] ?? expression;
    if (key && key !== 'neutral') {
      mgr.setValue(key, weight);
      mgr.update();
    }
  }
  
  // Schedule cleanup if not already scheduled
  if (!window.sentimentCleanup) {
    window.sentimentCleanup = setInterval(() => {
      const now = performance.now();
      if (sentimentLayer.until && now > sentimentLayer.until) {
        console.log('[Sentiment] Time expired - clearing layer');
        clearSentimentLayer();
      }
    }, 100); // Check every 100ms
  }
}

// ——— Viseme scheduling (fast, non‑neutral, synced to audio or timestamps) ———
const MOUTH_KEYS = ['aa','ee','ih','oh','ou'];
const visemeIdToAlias = {
  1:'aa',2:'aa',3:'ih',4:'ee',5:'oh',6:'ou',7:'ou',8:'ee',9:'ih',10:'oh',
  11:'ou',12:'aa',13:'ee',14:'ih',15:'oh',16:'ou',17:'aa',18:'ee',19:'ih',20:'oh'
  // 0 and 21 are neutral → we treat as release, not an expression
};

class VisemeScheduler {
  constructor() {
    this.audio = null;
    this.events = [];
    this.idx = 0;
    this.startMs = 0;
    this.raf = 0;
    this.active = false;
  }
  stop() {
    this.active = false;
    cancelAnimationFrame(this.raf);
    if (this.audio) { this.audio.pause(); this.audio = null; }
    // quick release of mouth shapes
    if (blendfaces) for (const k of MOUTH_KEYS) blendfaces.set(k, 0.0, 'viseme', 80);
  }
  start({ audioUrl, visemes = [], sentiment, expression }) {
    this.stop();

    // Build events: convert viseme IDs to aliases, insert release points on neutral
    const raw = Array.isArray(visemes) ? visemes.slice().sort((a,b)=>a.timeMs-b.timeMs) : [];
    const events = [];
    for (let i=0;i<raw.length;i++) {
      const { visemeId, timeMs } = raw[i];
      const alias = visemeIdToAlias[visemeId];
      if (!alias) {
        // neutral/release: schedule zeroing all mouth keys
        events.push({ type:'release', t: timeMs });
      } else {
        events.push({ type:'viseme', key: alias, t: timeMs });
      }
    }
    // If nothing ends with release, add a tail release
    const tailMs = (raw.length ? raw[raw.length-1].timeMs : 0) + 200;
    if (!events.length || events[events.length-1].type !== 'release') {
      events.push({ type:'release', t: tailMs });
    }
    this.events = events;
    this.idx = 0;

    // Sentiment hold (overlays visemes, never neutral)
    const holdMs = (raw.length ? raw[raw.length-1].timeMs : 0) + 500;
    if (expression && expression !== 'neutral') {
      sentimentLayer = { name: expression, weight: 0.6, until: performance.now() + holdMs };
    }

    // Start audio (optional but recommended for sync). If missing, fall back to perf timer.
    if (audioUrl) {
      this.audio = new Audio(audioUrl);
      this.audio.addEventListener('play', () => {
        this.startMs = performance.now();
        this.active = true;
        this.tick();
      });
      this.audio.play().catch(e => {
        // Fallback if autoplay blocked
        this.startMs = performance.now();
        this.active = true;
        this.tick();
      });
    } else {
      this.startMs = performance.now();
      this.active = true;
      this.tick();
    }
  }
  tick = () => {
    if (!this.active) return;
    const now = performance.now();
    const elapsed = now - this.startMs;

    // Apply queued events
    while (this.idx < this.events.length && elapsed >= this.events[this.idx].t) {
      const ev = this.events[this.idx++];
      if (ev.type === 'release') {
        // fast crossfade to rest (no 'neutral' push)
        if (blendfaces) for (const k of MOUTH_KEYS) blendfaces.set(k, 0.0, 'viseme', 50);
      } else if (ev.type === 'viseme') {
        // fast crossfade: damp previous visemes a bit
        if (blendfaces) {
          for (const k of MOUTH_KEYS) if (k !== ev.key) blendfaces.set(k, 0.15, 'viseme', 40);
          // punch in the new viseme at scaled weight
          const baseScale = {
            aa: 0.5,
            ee: 0.4,
            ih: 0.4,
            oh: 0.35, // tightened OH
            ou: 0.3  // tightened OU
          }[ev.key] ?? 0.5;
          blendfaces.set(ev.key, baseScale, 'viseme', 80);
        }
      }
    }

    // sentiment overlay each frame during its hold window
    applySentimentLayer(now);

    // finalize update
    const mgr = getMgr();
    if (mgr) mgr.update();

    if (this.idx >= this.events.length) {
      this.active = false;
      return;
    }
    this.raf = requestAnimationFrame(this.tick);
  }
}

const visemeScheduler = new VisemeScheduler();
function shouldUseBlendfaces() {
  return !!blendfaces;
}

let gestures;

// ——— VRM Load ———
loadVRM('/Assets/Sentali2.vrm', scene, camera, controls, vrm => {
  currentVRM = vrm;
  exprMgr = vrm.expressionManager || vrm.blendShapeProxy;
  vrmReady = !!exprMgr;

  // Gesture controller
  gestures = new GestureController(vrm);

  // Add to group
  vrmGroup.add(vrm.scene);

  // --- Scale avatar to ~1.75m tall ---
  const box = new THREE.Box3().setFromObject(vrm.scene);
  const size = new THREE.Vector3();
  box.getSize(size);
  if (size.y > 0) {
    const targetHeight = 1.75;
    const scaleFactor = targetHeight / size.y;
    vrm.scene.scale.setScalar(scaleFactor);
  }

  // --- Small arm rotation to prevent clipping into body ---
  const lArm = vrm.humanoid.getNormalizedBoneNode('leftUpperArm');
  const rArm = vrm.humanoid.getNormalizedBoneNode('rightUpperArm');
  if (lArm && rArm) {
    lArm.rotation.z += THREE.MathUtils.degToRad(6);
    rArm.rotation.z -= THREE.MathUtils.degToRad(6);
  }

  // --- Place feet at y=0 ---
  box.setFromObject(vrm.scene);
  const yOffset = box.min.y;
  vrm.scene.position.y -= yOffset;

  // --- Rotate camera to face avatar ---
  vrm.scene.rotation.y += Math.PI;
  const head = vrm.humanoid.getNormalizedBoneNode('head') || vrm.scene.getObjectByName('Head');
  if (head) {
    const headPos = new THREE.Vector3();
    head.getWorldPosition(headPos);
    controls.target.copy(headPos);
    camera.position.set(headPos.x, headPos.y, headPos.z - 1.2);
  }
  controls.update();

  // Cache chest height for breathing
  const chest = vrm.humanoid.getNormalizedBoneNode('chest')
             || vrm.humanoid.getNormalizedBoneNode('upper_chest');
  if (chest) chestBaseY = chest.position.y;

  // Merge available expressions into viseme map WITHOUT overwriting Unity mappings
  const available = exprMgr.getExpressionNames?.() ?? [];
  ['aa', 'ee', 'ih', 'oh', 'ou', 'neutral'].forEach(alias => {
    if (!expressionMap[alias] && available.includes(alias)) {
      expressionMap[alias] = alias;
    }
  });

  // Init lipsync/blink controller
  blendfaces = new BlendfacesController(vrm, {
    expressionMap,
    smooth: 0.2,
    decay: 3.0,
    rest: { blink: 0.0 },
    scale: { aa: 0.55, ee: 0.48, ih: 0.42, oh: 0.40, ou: 0.34 }
  });
  blendfaces.attachWS(cb => (blendfacesWSHandler = cb));

  if (vrm.firstPerson) vrm.firstPerson.autoUpdate = false;

  console.log('[VRM] Loaded successfully:', vrm.meta?.name);
});

// ——— Viseme ID → alias (keep as-is if your backend sends IDs) ———
const visemeMap = {
  0: 'neutral',
  1: 'aa', 2: 'aa', 3: 'ih', 4: 'ee', 5: 'oh',
  6: 'ou', 7: 'ou', 8: 'ee', 9: 'ih', 10: 'oh',
  11: 'ou', 12: 'aa', 13: 'ee', 14: 'ih', 15: 'oh',
  16: 'ou', 17: 'aa', 18: 'ee', 19: 'ih', 20: 'oh',
  21: 'neutral'
};

// ——— Resolver: alias → exact VRM key (no AEIOU fallbacks) ———
function resolveToVRMKey(v) {
  const alias = typeof v === 'string'
    ? v
    : visemeMap[v.VisemeId ?? v.visemeId ?? v.id] ?? v.name ?? null;
  return alias ? expressionMap[alias] ?? null : null;
}

const VISEME_SCALE = {
  aa: 0.45,
  ee: 0.4,
  ih: 0.35,
  oh: 0.3,
  ou: 0.25
};

const VISEME_HOLD_MS = 80;        // short hold for snappy syllables
const VISEME_RELEASE_MS = 50;     // quick release so it keeps pace with text
const VISEME_CROSSFADE_FLOOR = 0.12; // slight residual to avoid popping

// ——— Timeline builder for BlendfacesController ———
// Produces frames that both punch in the target viseme and schedule a release shortly after.
// Neutral (0/21) creates a release frame (zeros all mouth keys).
function buildVisemeTimeline(visemes) {
  const frames = [];
  const appendFrame = (t, values) => frames.push({ t: t / 1000, values });

  const neutralRelease = () => {
    const values = {};
    for (const k of MOUTH_KEYS) values[k] = 0.0;
    return values;
  };

  const scaledViseme = (key) => {
    const values = {};
    for (const k of MOUTH_KEYS) values[k] = (k === key) ? (VISEME_SCALE[key] ?? 0.5) : VISEME_CROSSFADE_FLOOR;
    return values;
  };

  const sorted = (Array.isArray(visemes) ? visemes : [])
    .slice()
    .sort((a, b) => (a.timeMs || 0) - (b.timeMs || 0));

  for (let i = 0; i < sorted.length; i++) {
    const { visemeId, timeMs = 0 } = sorted[i];
    const alias = visemeMap[visemeId];

    if (!alias || alias === 'neutral') {
      appendFrame(timeMs, neutralRelease());
      continue;
    }

    // Punch-in frame
    appendFrame(timeMs, scaledViseme(alias));

    // Release frame shortly after (unless next event is very close, then clamp)
    const nextT = sorted[i + 1]?.timeMs ?? (timeMs + VISEME_HOLD_MS);
    const releaseT = Math.min(timeMs + VISEME_HOLD_MS, nextT - 10);
    if (releaseT > timeMs) appendFrame(releaseT, neutralRelease());
  }

  // Ensure final release at tail
  if (sorted.length) {
    const lastT = sorted[sorted.length - 1].timeMs;
    appendFrame(lastT + VISEME_HOLD_MS + VISEME_RELEASE_MS, neutralRelease());
  }

  return frames;
}

// ——— Manual mappers (fallback path) ———
function mapVisemeForManual(v) {
  const key = resolveToVRMKey(v);
  return key ? { t: (v.timeMs || 0), key } : null; // keep ms for clarity
}

// ——— Manual scheduler (fallback if Blendfaces timeline not used) ———
function scheduleVisemes(visemes, audio) {
  if (!vrmReady) return;
  const mgr = getMgr();
  if (!mgr) return;

  const sorted = (Array.isArray(visemes) ? visemes : [])
    .slice()
    .sort((a, b) => (a.timeMs || 0) - (b.timeMs || 0));

  const scheduleAt = (ms, fn) => setTimeout(fn, Math.max(0, ms));

  for (let i = 0; i < sorted.length; i++) {
    const { visemeId, timeMs = 0 } = sorted[i];
    const alias = visemeMap[visemeId];

    if (!alias || alias === 'neutral') {
      // Neutral: zero all mouth keys
      scheduleAt(timeMs, () => {
        for (const k of MOUTH_KEYS) mgr.setValue(k, 0.0);
        mgr.update();
      });
      continue;
    }

    const holdEnd = timeMs + VISEME_HOLD_MS;

    // Punch in target; crossfade others to floor
    scheduleAt(timeMs, () => {
      for (const k of MOUTH_KEYS) {
        const w = (k === alias) ? (VISEME_SCALE[alias] ?? 0.5) : VISEME_CROSSFADE_FLOOR;
        mgr.setValue(k, w);
      }
      mgr.update();
    });

    // Release shortly after
    scheduleAt(holdEnd, () => {
      for (const k of MOUTH_KEYS) mgr.setValue(k, 0.0);
      mgr.update();
    });
  }

  if (audio) audio.play().catch(() => {});
}

let conversationHistory = [];

function addToHistory(role, text) {
  conversationHistory.push({ role, text });
  if (conversationHistory.length > 30) { // Increased from 20 to 30 exchanges
    conversationHistory = conversationHistory.slice(-30);
  }
}

function getRecentContext() {
  return conversationHistory
    .map(turn => `${turn.role}: ${turn.text}`)
    .join('\n');
}

// ——— WebSocket: server‑pushed TTS/visemes/emotions ———
const wsClient = new WSClient({
  url: `wss://${window.location.host}/ws`,
  onOpen: () => console.log('WS connected'),
  onClose: () => console.log('WS disconnected'),
  onMessage: data => {
    const audioUrl = data.audioUrl || data.audio;
    const visemes = Array.isArray(data.visemes) ? data.visemes : [];
    const expression = data.expression || data.sentiment || 'neutral';

    if (!audioUrl) return;

    const audio = new Audio(audioUrl);
    audio.crossOrigin = 'anonymous';

    // Build timeline now and mark active before trying to play
    const items = buildVisemeTimeline(visemes);
    const lastMs = visemes.length ? visemes[visemes.length - 1].timeMs : 0;
    const safetyMs = lastMs + 600;

    // Ensure lipsync can't be stomped by idle bias even if autoplay blocks
    visemeActive = true;
    isSpeaking = true;

    // Sentiment overlay for entire utterance
    setSentimentHold(expression, audio, 0.6);

    // Kick Blendfaces or manual scheduler immediately
    if (shouldUseBlendfaces() && blendfaces?.loadTimeline) {
      if (items.length) {
        blendfaces.loadTimeline(items);
        blendfaces.playTimeline(0, audio);
      } else {
        console.warn('[Visemes] No valid timeline items');
      }
    } else {
      scheduleVisemes(visemes, audio);
    }

    // Clear flags on end and via safety timeout
    const clearFlags = () => {
      visemeActive = false;
      isSpeaking = false;
      const mgr = getMgr();
      if (mgr) mgr.update();
    };
    audio.addEventListener('ended', clearFlags, { once: true });
    setTimeout(clearFlags, safetyMs);

    // Try to play audio; if it fails, timeline still ran
    audio.play().catch(e => console.warn('WS audio error', e));
  }
});
wsClient.connect();

// ——— TTS (client-initiated) ———
function sanitizeForTTS(s) {
  if (!s) return '';
  let t = s.split('[No response]').join('').trim();
  let noEmoji = '';
  for (const ch of t) {
    const cp = ch.codePointAt(0);
    if (cp !== undefined && cp <= 0xFFFF) noEmoji += ch;
  }
  let out = '';
  let inSpace = false;
  for (const c of noEmoji) {
    const ws = c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '\f' || c === '\v';
    if (ws) { if (!inSpace) { out += ' '; inSpace = true; } }
    else { out += c; inSpace = false; }
  }
  return out.trim();
}

// --- Shared helper to safely fetch JSON or fallback ---
async function safeJsonFetch(url, options) {
  const res = await fetch(url, options);
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { error: 'Invalid JSON from backend', raw: text };
  }
  return { res, data };
}

// --- Enhanced TI query summary ---
function buildTiQuerySummary(query, data) {
  if (!data || !data.matches || data.matches.length === 0) {
    return `✅ No threats found for ${query.type} \`${query.value}\` in ANY.RUN TI feeds\n` +
           `📊 Feed status: ${data.totalIocs || 0} total IOCs (last updated: ${data.lastUpdated ? new Date(data.lastUpdated).toLocaleString() : 'N/A'})`;
  }

  let summary = `🛡 ANY.RUN TI Lookup Results for ${query.type.toUpperCase()}: \`${query.value}\`\n`;
  summary += `📅 Last feed update: ${data.lastUpdated ? new Date(data.lastUpdated).toLocaleString() : 'N/A'}\n`;
  summary += `📊 Total IOCs in feed: ${data.totalIocs || 0}\n\n`;
  summary += `**🚨 Matches Found: ${data.matches.length}**\n\n`;

  data.matches.forEach((match, index) => {
    summary += `### Match ${index + 1}\n`;
    summary += `**Type:** ${match.type?.toUpperCase() || 'Unknown'}\n`;
    summary += `**IOC ID:** \`${match.iocId || 'N/A'}\`\n`;
    summary += `**Confidence:** ${match.confidence || 'Unknown'}\n`;
    summary += `**Platforms:** ${match.platforms || 'N/A'}\n`;
    summary += `**Created:** ${match.created ? new Date(match.created).toLocaleDateString() : 'N/A'}\n`;
    summary += `**Details:** ${match.details || 'No additional details'}\n\n`;
  });

  summary += `**Full TI feed contains ${data.totalIocs || 0} IOCs - this is just the matching subset.**`;
  return summary;
}

// --- Enhanced ANY.RUN Report Summary with correct verdict parsing ---
function buildAnyRunSummary(report) {
  if (!report) {
    return '⚠️ No report data available';
  }

  let summary = `📋 **ANY.RUN Sandbox Report Summary**\n\n`;

  // Handle different ANY.RUN response structures
  let analysisData = report;
  
  // If wrapped in "data" object, extract it
  if (report.data && typeof report.data === 'object') {
    analysisData = report.data;
  }

  // Extract the main analysis data
  let mainAnalysis = analysisData.analysis || analysisData;

  // Status - ANY.RUN uses "state" or "status" in different locations
  let status = mainAnalysis.state || mainAnalysis.status || 'Completed';
  if (typeof status === 'object') {
    status = status.name || status.value || 'Completed';
  }
  summary += `**Status:** ${status}\n`;

  // File info - check multiple possible paths
  let fileName = mainAnalysis.content?.mainObject?.url || 
                 mainAnalysis.file?.name || 
                 mainAnalysis.target?.file?.name || 
                 mainAnalysis.metadata?.file_name || 
                 'URL Analysis';
  if (fileName) summary += `**File:** ${fileName}\n`;

  let fileType = mainAnalysis.content?.mainObject?.type || 
                 mainAnalysis.file?.type || 
                 mainAnalysis.target?.file?.type || 
                 mainAnalysis.metadata?.file_type || 
                 'URL';
  if (fileType) summary += `**Type:** ${fileType}\n`;

  // Threat assessment - Extract from scores.verdict (your actual structure)
  let verdict = mainAnalysis.scores?.verdict || mainAnalysis.verdict || mainAnalysis.malware?.verdict || 'Unknown';
  
  if (verdict && typeof verdict === 'object') {
    // Found the scores.verdict structure: {score: 37, threatLevel: 0, threatLevelText: "No threats detected"}
    const verdictScore = verdict.score || 0;
    const threatLevel = verdict.threatLevel || 0;
    const threatText = verdict.threatLevelText || 'Unknown';
    
    summary += `**Verdict:** Score ${verdictScore}, Threat Level ${threatLevel}, ${threatText}\n`;
  } else if (verdict) {
    summary += `**Verdict:** ${verdict}\n`;
  }

  // Malware score (from verdict.score if available)
  let malScore = verdict?.score || mainAnalysis.mal_score || mainAnalysis.malware?.score || mainAnalysis.analysis?.mal_score || mainAnalysis.risk?.score;
  if (malScore !== undefined && malScore !== null) {
    summary += `**Malware Score:** ${(malScore * 100).toFixed(1)}%\n`;
  }

  // Network activity
  let networkConnections = mainAnalysis.network?.connections?.length || 
                          mainAnalysis.network?.dnsRequests?.length || 
                          mainAnalysis.network?.length || 
                          mainAnalysis.connections?.length || 0;
  if (networkConnections > 0) {
    summary += `**Network Activity:** ${networkConnections} connections detected\n`;
  }

  // Behavior analysis
  let behaviors = mainAnalysis.behavior || 
                  mainAnalysis.malware?.behaviors || 
                  mainAnalysis.analysis?.behaviors || 
                  mainAnalysis.incidents || [];
  if (Array.isArray(behaviors) && behaviors.length > 0) {
    summary += `**Suspicious Behaviors:** ${behaviors.length} detected\n`;
  }

  // MITRE ATT&CK techniques
  let mitreTechniques = mainAnalysis.mitre || [];
  if (Array.isArray(mitreTechniques) && mitreTechniques.length > 0) {
    const techniqueNames = mitreTechniques.map(t => t.name || t.id).join(', ');
    summary += `**MITRE ATT&CK:** ${techniqueNames.substring(0, 100)}${techniqueNames.length > 100 ? '...' : ''}\n`;
  }

  // IOCs - check multiple paths
  let iocs = mainAnalysis.iocs || 
             mainAnalysis.indicators || 
             mainAnalysis.network?.iocs || 
             mainAnalysis.malware?.iocs || [];
  if (Array.isArray(iocs) && iocs.length > 0) {
    summary += `**Indicators of Compromise:** ${iocs.length} found\n`;
  }

  // Add key findings if available
  if (mainAnalysis.content?.mainObject?.url) {
    summary += `\n**Target URL:** ${mainAnalysis.content.mainObject.url}\n`;
  }

  if (mainAnalysis.scores?.verdict?.threatLevelText) {
    const threatText = mainAnalysis.scores.verdict.threatLevelText;
    summary += `\n**Threat Assessment:** ${threatText}\n`;
  }

  // Duration info
  if (mainAnalysis.duration) {
    summary += `**Analysis Duration:** ${mainAnalysis.duration} seconds\n`;
  }

  return summary;
}

// --- URL scan (sandbox analysis) with progress ---
async function analyzeWithAnyRun(url) {
  // Add user message first
  addChatEntry('user', `🔍 Scanning URL: ${url}`);
  
  // Store clean task ID for later use
  let taskId = null;
  
  // Add waiting message immediately
  const waitIndex = addChatEntry('sentali', `⏳ Please wait while I run the sandbox analysis for ${url}...`);
  
  try {
    const { res, data } = await safeJsonFetch(`${backendBase}/api/anyrun/url`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url })
    });

    if (!res.ok) {
      // Update waiting message with error
      updateChatEntry(waitIndex, 'sentali', `❌ [ANY.RUN Sandbox error] ${data?.error || res.status}`);
      return;
    }

    taskId = data?.taskId || data?.data?.taskid;
    if (!taskId) {
      // Update waiting message with error
      updateChatEntry(waitIndex, 'sentali', '❌ [ANY.RUN] No task ID returned from sandbox submission');
      return;
    }

    // Update waiting message with task ID (clean, no concatenation)
    updateChatEntry(waitIndex, 'sentali', 
      `✅ URL sandbox analysis submitted!\n` +
      `Task ID: \`${taskId}\`\n\n` +
      `🔄 Starting sandbox analysis...\n` +
      `⏳ This usually takes 1-3 minutes`
    );
    
    // Start polling with the clean taskId
    pollSandboxStatus(taskId, waitIndex);

  } catch (err) {
    // Update waiting message with error
    updateChatEntry(waitIndex, 'sentali', `❌ [ANY.RUN Sandbox request error] ${err.message}`);
  }
}

// --- IP TI lookup with progress ---
async function analyzeIpWithAnyRun(ip) {
  // Add user message first
  addChatEntry('user', `🌐 Scanning IP: ${ip}`);
  
  // Add waiting message immediately
  const waitIndex = addChatEntry('sentali', `🔍 Please wait while I check ${ip} against threat intelligence feeds...`);
  
  try {
    // Simulate a brief delay for better UX (optional)
    await new Promise(resolve => setTimeout(resolve, 500));
    
    const { res, data } = await safeJsonFetch(`${backendBase}/api/anyrun/ti/ip`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ip })
    });

    if (!res.ok) {
      // Update waiting message with error
      updateChatEntry(waitIndex, 'sentali', `❌ [ANY.RUN TI error] ${data?.error || res.status}\n\n💡 Please check the IP format and try again.`);
      return;
    }

    // Replace waiting message with results
    const summary = buildTiQuerySummary({ type: 'IP', value: ip }, data);
    updateChatEntry(waitIndex, 'sentali', summary);

  } catch (err) {
    // Update waiting message with error
    updateChatEntry(waitIndex, 'sentali', `❌ [ANY.RUN TI request error] ${err.message}\n\n💡 Network issue detected. Please try again.`);
  }
}

// --- Hash TI lookup with progress ---
async function analyzeHashWithAnyRun(sha256) {
  // Add user message first
  addChatEntry('user', `🔐 Scanning Hash: ${sha256}`);
  
  // Add waiting message immediately
  const waitIndex = addChatEntry('sentali', `🔍 Please wait while I check this SHA256 hash against threat intelligence databases...`);
  
  try {
    // Simulate a brief delay for better UX (optional)
    await new Promise(resolve => setTimeout(resolve, 500));
    
    const { res, data } = await safeJsonFetch(`${backendBase}/api/anyrun/ti/hash`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sha256 })
    });

    if (!res.ok) {
      // Update waiting message with error
      updateChatEntry(waitIndex, 'sentali', `❌ [ANY.RUN TI error] ${data?.error || res.status}\n\n💡 Please verify the hash format (64 hex characters) and try again.`);
      return;
    }

    // Replace waiting message with results
    const summary = buildTiQuerySummary({ type: 'SHA256', value: sha256 }, data);
    updateChatEntry(waitIndex, 'sentali', summary);

  } catch (err) {
    // Update waiting message with error
    updateChatEntry(waitIndex, 'sentali', `❌ [ANY.RUN TI request error] ${err.message}\n\n💡 Network issue detected. Please try again.`);
  }
}

// --- Enhanced sandbox status polling with 404 handling and no concatenation ---
async function pollSandboxStatus(taskId, waitIndex) {
  const start = Date.now();
  const maxDuration = 180000; // 3 minutes
  let consecutive404s = 0;
  const max404s = 3; // Stop after 3 consecutive 404s
  let lastProgressUpdate = 0; // Track last update time to prevent spam
  
  // Store the original task ID to avoid concatenation
  const originalTaskId = taskId;
  
  // Update with initial polling message (clean, no concatenation)
  updateChatEntry(waitIndex, 'sentali', 
    `🔄 Sandbox analysis started (Task: ${originalTaskId}). Monitoring progress...\n\n` +
    `⏳ This usually takes 1-3 minutes for thorough analysis.\n` +
    `💡 I'll update you when it's ready!`
  );
  
  const poll = setInterval(async () => {
    try {
      const now = Date.now();
      const elapsed = now - start;
      
      // Check for timeout first
      if (elapsed > maxDuration) {
        clearInterval(poll);
        updateChatEntry(waitIndex, 'sentali', 
          `⏰ [ANY.RUN Sandbox] Analysis timed out after 3 minutes\n\n` +
          `Task ID: \`${originalTaskId}\`\n\n` +
          `💡 **What this means:**\n` +
          `• The sandbox is still processing (complex sites take longer)\n` +
          `• Or there might be a temporary service issue\n\n` +
          `🔄 **Next steps:**\n` +
          `• Wait 2-3 more minutes, then type: \`report ${originalTaskId}\`\n` +
          `• Check the ANY.RUN dashboard directly\n` +
          `• Try scanning again with a simpler URL`
        );
        return;
      }
      
      const { data: status, res } = await safeJsonFetch(`${backendBase}/api/anyrun/status/${originalTaskId}`);
      
      // Handle 404 specifically
      if (res.status === 404) {
        consecutive404s++;
        console.warn(`[ANY.RUN] Status endpoint 404 (${consecutive404s}/${max404s}) for task ${originalTaskId}`);
        
        if (consecutive404s >= max404s) {
          clearInterval(poll);
          updateChatEntry(waitIndex, 'sentali', 
            `⚠️ [ANY.RUN Status] Unable to track real-time progress for task ${originalTaskId}\n\n` +
            `✅ **Good news:** Analysis was submitted successfully!\n` +
            `Task ID: \`${originalTaskId}\`\n\n` +
            `⏰ **Estimated completion:** 2-4 minutes\n\n` +
            `💡 **What to do:**\n` +
            `• Wait a few minutes, then type: \`report ${originalTaskId}\` to get results\n` +
            `• Or check the ANY.RUN dashboard directly\n\n` +
            `🔄 I'll keep checking in the background...`
          );
          
          // Start background polling after a delay
          setTimeout(() => {
            backgroundPollForCompletion(originalTaskId, waitIndex, start);
          }, 60000); // Wait 1 minute before background polling
          
          return;
        }
        
        // Show brief status for first few 404s (only update once)
        if (consecutive404s === 1 && now - lastProgressUpdate > 30000) {
          updateChatEntry(waitIndex, 'sentali', 
            `🔄 Sandbox analysis in progress (Task: ${originalTaskId})\n\n` +
            `⏳ Initializing sandbox environment...\n` +
            `⏰ This can take 30-60 seconds to start\n\n` +
            `💡 **Status:** Task submitted, waiting for sandbox to begin analysis...`
          );
          lastProgressUpdate = now;
        }
        return;
      }
      
      // Reset 404 counter on successful response
      consecutive404s = 0;
      
      const isRunning = status?.status === 'running' || status?.state === 'running' || status?.remaining > 0;
      const isDone = status?.status === 'finished' || status?.status === 'done' || status?.completed === true;
      const isFailed = status?.status === 'failed' || status?.error || status?.status === 'error';

      if (isDone || isFailed) {
        clearInterval(poll);

        if (isFailed) {
          updateChatEntry(waitIndex, 'sentali', 
            `❌ [ANY.RUN Sandbox] Analysis failed\n\n` +
            `Task ID: \`${originalTaskId}\`\n` +
            `Error: ${status?.error || status?.message || 'Unknown error'}\n\n` +
            `💡 **Troubleshooting:**\n` +
            `• The URL might be blocked or invalid\n` +
            `• Try a different URL format (http:// or https://)\n` +
            `• Check ANY.RUN dashboard for details\n\n` +
            `🔄 Ready for your next command!`
          );
        } else if (isDone) {
          // Update to show report generation (clean message)
          updateChatEntry(waitIndex, 'sentali', 
            `🎉 [ANY.RUN Sandbox] Analysis completed successfully!\n\n` +
            `Task ID: \`${originalTaskId}\`\n` +
            `📊 Generating your detailed threat report...\n` +
            `⏳ This takes just a moment...`
          );
          
          try {
            // Wait a bit for the report to be ready
            await new Promise(resolve => setTimeout(resolve, 2000));
            
            const { data: report, res: reportRes } = await safeJsonFetch(`${backendBase}/api/anyrun/report/${originalTaskId}`);
            
            if (reportRes.status === 404) {
              updateChatEntry(waitIndex, 'sentali', 
                `✅ [ANY.RUN] Analysis complete but report not ready yet\n\n` +
                `Task ID: \`${originalTaskId}\`\n` +
                `💡 Try "report ${originalTaskId}" in 30 seconds to get the full analysis\n\n` +
                `🔄 Analysis finished - I'll remind you to check back!`
              );
            } else if (reportRes.ok) {
              const summary = buildAnyRunSummary(report);
              updateChatEntry(waitIndex, 'sentali', summary);
            } else {
              updateChatEntry(waitIndex, 'sentali', 
                `✅ [ANY.RUN] Analysis complete but report fetch failed\n\n` +
                `Task ID: \`${originalTaskId}\`\n` +
                `Error: ${report?.error || reportRes.status}\n\n` +
                `💡 Try "report ${originalTaskId}" to fetch manually`
              );
            }
          } catch (reportErr) {
            updateChatEntry(waitIndex, 'sentali', 
              `✅ [ANY.RUN Sandbox] Analysis completed but report generation failed\n\n` +
              `Task ID: \`${originalTaskId}\`\n` +
              `Error: ${reportErr.message}\n\n` +
              `💡 **Next steps:**\n` +
              `• Try "report ${originalTaskId}" to fetch manually\n` +
              `• Check ANY.RUN dashboard directly\n` +
              `• The analysis ran but formatting failed`
            );
          }
        }
      } else if (isRunning && now - lastProgressUpdate > 30000) { // Update every 30s
        lastProgressUpdate = now;
        const remaining = status?.remaining || Math.max(0, Math.ceil((maxDuration - elapsed) / 1000));
        const progress = Math.max(0, Math.min(100, (elapsed / maxDuration) * 100));
        
        let statusMsg = `🔄 Sandbox analysis in progress\n`;
        statusMsg += `Task ID: \`${originalTaskId}\`\n`;
        statusMsg += `⏱️ ${remaining}s remaining (~${progress.toFixed(0)}% complete)\n\n`;
        
        // Add specific status if available
        if (status?.progress) {
          statusMsg += `📊 Current phase: ${status.progress}\n`;
        }
        
        statusMsg += `⏳ Please wait, thorough analysis takes time...\n\n`;
        statusMsg += `💡 **Pro tip:** Complex sites take 2-3 minutes for full analysis`;
        
        updateChatEntry(waitIndex, 'sentali', statusMsg);
      }
      
    } catch (err) {
      // Handle other errors (network, etc.)
      console.error('[Sandbox Poll Error]:', err);
      const elapsed = Date.now() - start;
      if (elapsed < maxDuration / 2) { // Only show error once early on
        updateChatEntry(waitIndex, 'sentali', 
          `⚠️ [Network Issue] Having trouble checking status\n\n` +
          `Task ID: \`${originalTaskId}\`\n` +
          `⏳ Analysis is still running - I'll keep trying...\n\n` +
          `💡 The sandbox continues even if status checks fail`
        );
      }
    }
  }, 10000); // Poll every 10 seconds

  // Background polling function for when status endpoint is unavailable
  async function backgroundPollForCompletion(taskId, waitIndex, startTime) {
    let backgroundAttempts = 0;
    const maxBackgroundAttempts = 6; // Check every 30s for 3 minutes

    const bgPoll = setInterval(async () => {
      backgroundAttempts++;
      
      try {
        const { res: reportRes } = await safeJsonFetch(`${backendBase}/api/anyrun/report/${taskId}`);
        
        if (reportRes.ok) {
          clearInterval(bgPoll);
          // Update the original message with report
          const { data: report } = await safeJsonFetch(`${backendBase}/api/anyrun/report/${taskId}`);
          const summary = buildAnyRunSummary(report);
          updateChatEntry(waitIndex, 'sentali', 
            `🎉 **Background Check: Report Ready!**\n\n` + 
            `Task ID: \`${taskId}\`\n\n` +
            summary
          );
          console.log('[Background Poll] Report retrieved successfully');
        } else if (reportRes.status === 404) {
          console.log(`[Background Poll ${backgroundAttempts}/${maxBackgroundAttempts}]: Report not ready yet...`);
        }
      } catch (bgErr) {
        console.log(`[Background Poll ${backgroundAttempts}/${maxBackgroundAttempts}]: Error - ${bgErr.message}`);
      }
      
      if (backgroundAttempts >= maxBackgroundAttempts) {
        clearInterval(bgPoll);
        console.log('[Background Poll] Max attempts reached, stopping');
        // Add a final reminder message
        updateChatEntry(-1, 'sentali',  // Add new message
          `💡 **Friendly Reminder:** Your sandbox analysis (Task: ${taskId}) should be ready soon!\n\n` +
          `Try typing: \`report ${taskId}\` to check for results\n\n` +
          `⏰ It's been ${Math.round((Date.now() - startTime) / 60000)} minutes since submission`
        );
      }
    }, 30000); // Check every 30 seconds
  }
}

// --- Check TI feed status with brief wait ---
async function checkTiStatus() {
  // Add user message first
  addChatEntry('user', `Checking TI status...`);
  
  // Add waiting message immediately
  const waitIndex = addChatEntry('sentali', `📊 Checking threat intelligence feed status...`);
  
  try {
    // Brief delay for UX
    await new Promise(resolve => setTimeout(resolve, 300));
    
    const { data } = await safeJsonFetch(`${backendBase}/api/anyrun/ti/status`);
    
    if (data.isAvailable) {
      // Update with success message
      updateChatEntry(waitIndex, 'sentali', `📊 **TI Feed Status: Ready**\n✅ ${data.totalIocs} threat indicators available\n📅 Last updated: ${new Date(data.lastUpdated).toLocaleString()}\n\n💡 Ready for IP, hash, and URL scans!`);
    } else {
      // Update with status message
      updateChatEntry(waitIndex, 'sentali', `⚠️ **TI Feed Status: Initializing**\n⏳ Feed is being populated with threat data...\n\n💡 This usually takes a few minutes on first startup. Try again soon!`);
    }
    return data;
  } catch (err) {
    console.error('TI status check failed:', err);
    // Update with error message
    updateChatEntry(waitIndex, 'sentali', `❌ **TI Status Check Failed**\n${err.message}\n\n💡 Please try again or contact support if this persists.`);
  }
}

// --- Manual report fetch command ---
async function fetchReport(taskId) {
  const waitIndex = addChatEntry('sentali', `📊 Fetching report for task: ${taskId}...`);
  
  try {
    const { res, data: report } = await safeJsonFetch(`${backendBase}/api/anyrun/report/${taskId}`);
    
    if (!res.ok) {
      if (res.status === 404) {
        const errorMessage = `❌ Report not found for task ${taskId}\n\n` +
          `💡 **Possible reasons:**\n` +
          `• Task ID is incorrect\n` +
          `• Analysis still in progress\n` +
          `• Report expired (try again soon)\n\n` +
          `🔄 Ready for your next command!`;
        updateChatEntry(waitIndex, 'sentali', errorMessage);
      } else {
        updateChatEntry(waitIndex, 'sentali', `❌ Report fetch failed: ${report?.error || res.status}`);
      }
    } else {
      const summary = buildAnyRunSummary(report);
      
      // Update the chat entry with the full summary text (with Markdown)
      updateChatEntry(waitIndex, 'sentali', summary);
      
      // Clean the summary for TTS (remove Markdown formatting)
      const cleanTtsText = cleanForTTS(summary);
      
      // Speak the clean version aloud
      await speakAndType(cleanTtsText, waitIndex);
    }
  } catch (err) {
    updateChatEntry(waitIndex, 'sentali', `❌ Report fetch error: ${err.message}`);
  }
}
    


// --- CVE Summarizer Integration ---
async function analyzeCve(query) {
  const waitIndex = addChatEntry('sentali', `🛡️ Summarizing vulnerability: ${query}`);
  try {
    const { res, data } = await safeJsonFetch(`${backendBase}/api/cve-summary`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query })
    });
    if (!res.ok) {
      updateChatEntry(waitIndex, 'sentali', `❌ Error: ${data?.error || res.status}`);
      return;
    }
    const summary = data.summary || `${data.description}\nSeverity: ${data.severity}\nMitigations: ${data.mitigations}`;
    updateChatEntry(waitIndex, 'sentali', summary);
    const clean = stripMarkdown(summary);
    speakAndType(clean, waitIndex, summary);
  } catch (err) {
    updateChatEntry(waitIndex, 'sentali', `❌ Error: ${err.message}`);
  }
}

// --- Static Analysis Integration ---
async function runStaticReview(code, language) {
  const waitIndex = addChatEntry('sentali', `🔍 Running static analysis on ${language} code...`);
  try {
    const { res, data } = await safeJsonFetch(`${backendBase}/api/static-review`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, language })
    });
    if (!res.ok) {
      updateChatEntry(waitIndex, 'sentali', `❌ Error: ${data?.error || res.status}`);
      return;
    }
    const findings = data.findings;
    // Post-process findings
    updateChatEntry(waitIndex, 'sentali', `✅ Static analysis complete. Explaining and suggesting fixes...`);
    const explainRes = await fetch(`${backendBase}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        text: "Explain and fix these issues",
        context: JSON.stringify(findings) + '\n' + getRecentContext()
      })
    });
    const explainBody = await explainRes.json();
    const remediation = explainBody.text || explainBody.reply;
    updateChatEntry(waitIndex, 'sentali', remediation);
    const clean = stripMarkdown(remediation);
    speakAndType(clean, waitIndex, remediation);
  } catch (err) {
    updateChatEntry(waitIndex, 'sentali', `❌ Error: ${err.message}`);
  }
}

// --- Threat Modeling Integration ---
async function modelThreats(description) {
  const waitIndex = addChatEntry('sentali', `🧩 Modeling threats for: ${description.substring(0, 50)}...`);
  try {
    const { res, data } = await safeJsonFetch(`${backendBase}/api/threat-model`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ description })
    });
    if (!res.ok) {
      updateChatEntry(waitIndex, 'sentali', `❌ Error: ${data?.error || res.status}`);
      return;
    }
    const risks = data.risks;
    const summary = `**STRIDE Risks:**\n${risks.riskMatrix}\n\n**Mitigations:**\n${risks.controls}`;
    updateChatEntry(waitIndex, 'sentali', summary);
    const clean = stripMarkdown(summary);
    speakAndType(clean, waitIndex, summary);
  } catch (err) {
    updateChatEntry(waitIndex, 'sentali', `❌ Error: ${err.message}`);
  }
}

// --- Validation helpers ---
function isValidIp(ip) {
  const ipRegex = /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;
  return ipRegex.test(ip);
}

function isValidSha256(hash) {
  return /^[a-fA-F0-9]{64}$/.test(hash);
}

async function getSecurityKbChunks(query) {
  const res = await fetch(`${backendBase}/api/search/security-kb`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query })
  });
  if (!res.ok) {
    console.error('[KB] HTTP', res.status);
    return [];
  }
  const data = await res.json().catch(() => null);
  return Array.isArray(data?.chunks) ? data.chunks : [];
}

async function getBingGroundingChunks(query) {
  const res = await fetch(`${backendBase}/api/search/bing-grounding`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query })
  });
  if (!res.ok) {
    console.error('[Bing Grounding] HTTP', res.status);
    return [];
  }
  const data = await res.json().catch(() => null);
  return Array.isArray(data?.chunks) ? data.chunks : [];
}

// --- Helper: strip Markdown for speech ---
function stripMarkdown(text) {
  return text
    .replace(/```[\s\S]*?```/g, '') // remove code blocks
    .replace(/`([^`]+)`/g, '$1')    // inline code
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // links
    .replace(/[*_~#>-]/g, '')       // misc markdown chars
    .replace(/\n{2,}/g, '\n')       // collapse extra newlines
    .trim();
}

// --- Unified sendToAgent function ---
let sendingNow = false;

async function sendToAgent() {
  if (sendingNow) return;
  sendingNow = true;

  const inputEl = document.getElementById('agentInput');
  if (!inputEl) {
    console.warn('[UI] #agentInput not found');
    sendingNow = false;
    return;
  }

  const msg = inputEl.value.trim();
  if (!msg) {
    addChatEntry('sentali', '[Please enter a message]');
    sendingNow = false;
    return;
  }

  // ✅ Always add user message to history first
  addToHistory('user', msg);

  // Special-case: ANY.RUN scan trigger
  if (msg.startsWith('scan ')) {
    analyzeWithAnyRun(msg.slice(5).trim());
    sendingNow = false;
    return;
  }

  // CVE summary trigger
  const cveMatch = msg.match(/summarize\s*(CVE-\d{4}-\d+)/i) || msg.match(/(CVE-\d{4}-\d+)/i);
  if (cveMatch) {
    addChatEntry('user', msg);
    inputEl.value = '';
    analyzeCve(cveMatch[1]);
    sendingNow = false;
    return;
  }

  // Static analysis trigger
  const staticMatch = msg.match(/```(\w*)\n([\s\S]*?)\n```/);
  if (staticMatch || msg.toLowerCase().includes('run static') || msg.toLowerCase().includes('analyze code')) {
    if (staticMatch) {
      const language = staticMatch[1] || 'python';
      const code = staticMatch[2];
      addChatEntry('user', msg);
      inputEl.value = '';
      runStaticReview(code, language);
      sendingNow = false;
      return;
    }
  }

  // Threat modeling trigger
  if (msg.toLowerCase().includes('model threats') || msg.toLowerCase().includes('analyze system risks')) {
    addChatEntry('user', msg);
    inputEl.value = '';
    modelThreats(msg);
    sendingNow = false;
    return;
  }

  // Greeting triggers (if any)
  handleGreetingTrigger(msg);

  // Add user message to UI
  addChatEntry('user', msg);
  inputEl.value = '';

  try {
    // 🔍 Retrieve KB chunks
    const kbChunks = await getSecurityKbChunks(msg);
    const kbContext = kbChunks
      .map((c, i) => `[KB${i + 1}] ${c.text} (source: ${c.source})`)
      .join('\n\n');

    // 🌐 Retrieve Bing grounding chunks if KB empty or query is time‑sensitive
    let bingContext = '';
    if (!kbChunks.length || /\b(latest|today|recent|new|current)\b/i.test(msg)) {
      const bingChunks = await getBingGroundingChunks(msg);
      bingContext = bingChunks
        .map((c, i) => `[B${i + 1}] ${c.text} (source: ${c.source})`)
        .join('\n\n');
    }

    // 🧠 Build combined context from *existing* history
    const combinedContext = `
      Recent conversation (last 10 exchanges):
      ${getRecentContext()}

      Security KB context:
      ${kbContext}

      Live web context:
      ${bingContext}
    `;

    // 💬 Send to backend
    const chatRes = await fetch(`${backendBase}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: msg, context: combinedContext })
    });

    const body = await chatRes.json().catch(() => null);
    if (!chatRes.ok) {
      addChatEntry('sentali', '[Error contacting Agent]');
      return;
    }

    const reply = (body?.text ?? body?.reply ?? body?.message ?? '').toString().trim();
    if (!reply) {
      addChatEntry('sentali', '[No response]');
      return;
    }

    // ✅ Add agent reply to history *before* rendering so history + UI stay in sync
    addToHistory('sentali', reply);

    // Create placeholder in UI for typing effect
    const agentIndex = addChatEntry('sentali', '');

    // 🗣 Strip Markdown for speech, but keep full Markdown in UI
    const speechText = stripMarkdown(reply);

    // Typing effect into the placeholder (UI shows Markdown)
    await speakAndType(speechText, agentIndex, reply);

  } catch (err) {
    console.error('[Agent Error]', err);
    addChatEntry('sentali', '[Error contacting Agent]');
  } finally {
    sendingNow = false;
  }
}





// --- Greeting trigger helper (SINGLE DEFINITION) ---
function handleGreetingTrigger(message) {
  if (!message || typeof message !== 'string') return;
  if (typeof gestures?.play !== 'function' || typeof setSentimentHold !== 'function') return;

  const msg = message.trim().toLowerCase();
  if (msg === 'hi' || msg === 'hello' || msg.startsWith('hi ') || msg.startsWith('hello ')) {
    gestures.play('wave');
    setSentimentHold('happy', null, 0.8, 1500);
  }
}

// Reusable typewriter helper — index-based
async function typeOut(index, role, text, totalDurationMs) {
  if (index < 0 || !chatMessages[index]) {
    console.warn('[UI] Invalid index for typeOut:', index);
    return;
  }

  const codeMatch = text.match(/```(\w+)?\n([\s\S]*?)\n```/);
  const isLikelyCode = /import|function|const|let|class|=>/.test(text);

  try {
    if (codeMatch || isLikelyCode) {
      const codeContent = codeMatch ? codeMatch[2] : text;
      const lines = codeContent.split('\n').filter(line => line.trim());
      const delay = totalDurationMs / Math.max(lines.length, 1);
      let current = '';
      
      for (let i = 0; i < lines.length; i++) {
        current += (i > 0 ? '\n' : '') + lines[i];
        updateChatEntry(index, role, current);
        await new Promise(r => setTimeout(r, delay));
      }
    } else {
      const chars = [...text];
      const delay = totalDurationMs / Math.max(chars.length, 1);
      let current = '';
      
      for (let i = 0; i < chars.length; i++) {
        current += chars[i];
        updateChatEntry(index, role, current);
        if (i % 10 === 0) { // Batch updates for performance
          await new Promise(r => setTimeout(r, delay));
        }
      }
    }
    
    console.log('[UI] Typeout animation completed');
  } catch (error) {
    console.error('[UI] Typeout error:', error);
    updateChatEntry(index, role, text); // Fallback to full text
  }
}

// Accepts both speechText (clean) and displayText (full Markdown)
async function speakAndType(speechText, index, displayText = null) {
  const uiText = displayText ?? speechText;

  if (ttsInflight) {
    console.warn('[TTS] In-flight; aborting previous');
    ttsAbortController?.abort();
    updateChatEntry(index, 'sentali', uiText);
  }
  ttsInflight = true;
  ttsAbortController = new AbortController();

  try {
    const clean = sanitizeForTTS(speechText);
    const fetchPromise = fetch(`${backendBase}/api/tts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: clean }),
      signal: ttsAbortController.signal
    });

    const res = await Promise.race([
      fetchPromise,
      new Promise((_, reject) => setTimeout(() => reject(new Error('TTS timeout')), 60000))
    ]);
    if (!res.ok) {
      console.error('[TTS] HTTP', res.status);
      updateChatEntry(index, 'sentali', uiText);
      return;
    }

    const body = await res.json().catch(() => null);
    if (!body?.audioUrl) {
      console.warn('[TTS] No audioUrl', body);
      updateChatEntry(index, 'sentali', uiText);
      return;
    }

    const visemes = (body.visemes || []).slice().sort((a, b) => (a.timeMs || 0) - (b.timeMs || 0));
    const lastVisemeMs = visemes.length ? visemes[visemes.length - 1].timeMs : 0;

    const audio = new Audio(body.audioUrl);
    audio.crossOrigin = 'anonymous';

    await new Promise((resolve) => {
      let done = false;
      const finish = () => { if (!done) { done = true; resolve(); } };
      audio.addEventListener('loadedmetadata', finish, { once: true });
      audio.addEventListener('error', finish, { once: true });
      setTimeout(finish, 350);
    });

    const durationMs = Math.max(
      (audio.duration > 0 ? audio.duration * 1000 : 0),
      lastVisemeMs + 250,
      Math.min(12000, uiText.split(/\s+/).length * 250)
    );

    const expression = body.expression || body.sentiment || 'neutral';
    const items = buildVisemeTimeline(visemes);
    const safetyMs = lastVisemeMs + 600;

    visemeActive = true;
    isSpeaking = true;

    setSentimentHold(expression, audio, 0.6, durationMs + 500);

    const typingPromise = typeOut(index, 'sentali', uiText, durationMs);

    if (shouldUseBlendfaces() && blendfaces?.loadTimeline) {
      if (items.length) {
        blendfaces.loadTimeline(items);
        blendfaces.playTimeline(0, audio);
      } else {
        console.warn('[Visemes] No valid timeline items');
      }
    } else {
      scheduleVisemes(visemes, audio);
    }

    const clearFlags = () => {
      visemeActive = false;
      isSpeaking = false;
      if (performance.now() > sentimentLayer.until) {
        clearSentimentLayer();
      }
      getMgr()?.update();
    };

    audio.addEventListener('ended', clearFlags, { once: true });
    setTimeout(clearFlags, safetyMs);

    audio.play().catch(err => {
      console.warn('[TTS] Play failed:', err);
      clearFlags();
    });

    await typingPromise;

  } catch (err) {
    if (err.name !== 'AbortError' && err.message !== 'TTS timeout') {
      console.error('[TTS] Error:', err);
    } else {
      console.warn('[TTS] Timeout after 60s');
    }
    updateChatEntry(index, 'sentali', displayText ?? speechText);
    isSpeaking = false;
    visemeActive = false;
    clearSentimentLayer();
  } finally {
    ttsInflight = false;
    ttsAbortController = null;
  }
}


// ——— Chat UI helpers ———
function initChatLog() {
  const log = document.getElementById('chat-log');
  if (!log) {
    console.warn('[UI] #chat-log not found');
    return;
  }
  
  // Clear any existing content
  log.innerHTML = '';
  
  chatRoot = ReactDOM.createRoot(log);
  renderChat();
  console.log('[UI] Chat log initialized');
}

function renderChat() {
  if (!chatRoot) return;
  
  chatRoot.render(
    <ChatBlock 
      messages={chatMessages} 
      onRunCode={onRunCode} 
    />
  );
  
  // Auto-scroll to bottom when expanded
  const log = document.getElementById('chat-log');
  if (log && chatMessages.length > 0) {
    const messagesDiv = log.querySelector('[style*="overflow-y"]');
    if (messagesDiv) {
      messagesDiv.scrollTop = messagesDiv.scrollHeight;
    }
  }
}

function addChatEntry(role, text) {
  if (!text || typeof text !== 'string') {
    console.warn('[UI] Invalid chat entry:', { role, text });
    return null;
  }
  
  chatMessages.push({ role, text, timestamp: Date.now() });
  renderChat();
  console.log('[UI] Added chat entry:', role, text.substring(0, 50) + '...');
  return chatMessages.length - 1;
}

function updateChatEntry(index, role, text) {
  if (index >= 0 && index < chatMessages.length && typeof text === 'string') {
    chatMessages[index] = { ...chatMessages[index], role, text };
    renderChat();
    console.log('[UI] Updated chat entry:', index);
  } else {
    console.warn('[UI] Invalid update:', { index, role, text: typeof text });
  }
}

// Placeholder for code execution
function onRunCode(code) {
  console.log('[UI] Code execution requested:', code?.substring(0, 50));
  addChatEntry('system', '[Code execution not yet implemented]');
}

// ——— Mic button ———
function initMicButton() {
  const micBtn = document.getElementById('micBtn');
  if (!micBtn) return;
  if (!('webkitSpeechRecognition' in window)) {
    micBtn.disabled = true;
    micBtn.title = 'Speech recognition not supported';
    return;
  }
  micBtn.addEventListener('click', () => {
    const recog = new webkitSpeechRecognition();
    recog.lang = 'en-US';
    recog.interimResults = false;
    recog.maxAlternatives = 1;
    recog.onresult = e => {
      const input = document.getElementById('agentInput');
      if (input) input.value = e.results[0][0].transcript;
      sendToAgent();
    };
    recog.onerror = e => addChatEntry('sentali', `[Mic error: ${e.error}]`);
    recog.start();
  });
}

// ——— UI wiring ———
function initUI() {
  initChatLog();

  const sendBtn = document.getElementById('agentSendBtn');
  const inputEl = document.getElementById('agentInput');
  const voiceSelect = document.getElementById('voiceSelect');

  if (sendBtn) {
    sendBtn.addEventListener('click', sendToAgent);
  }

  if (inputEl) {
    inputEl.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendToAgent();
      }
    });
  }

  initMicButton();

  // 🎙 Voice selector with persistence
  if (voiceSelect) {
    // Load saved voice from localStorage
    const savedVoice = localStorage.getItem('sentaliVoice');
    if (savedVoice) {
      voiceSelect.value = savedVoice;
      // Send to backend immediately so TTS starts with correct voice
      fetch('/api/tts/set-voice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ voice: savedVoice })
      })
      .then(() => {
        console.log(`[UI] Restored Sentali voice: ${savedVoice}`);
      })
      .catch(err => console.error(err));
    }

    // Listen for changes and save to localStorage
    voiceSelect.addEventListener('change', (e) => {
      const selectedVoice = e.target.value;
      localStorage.setItem('sentaliVoice', selectedVoice);

      fetch('/api/tts/set-voice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ voice: selectedVoice })
      })
      .then(res => {
        if (!res.ok) throw new Error("Failed to set voice");
        console.log(`[UI] Sentali voice changed to: ${selectedVoice}`);
      })
      .catch(err => console.error(err));
    });
  }

  console.log('[UI] UI initialization complete');
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initUI, { once: true });
} else {
  initUI();
}

// --- Main Animation Loop ---
let lastSentimentActive = false;
let idleHappyTimer = 0; // Timer for idle happy state

function animate() {
  requestAnimationFrame(animate);
  const dt = clock.getDelta();
  const t = clock.getElapsedTime();
  const nowMs = performance.now();

  controls.update();

  if (currentVRM) {
    currentVRM.update(dt);

    const mgr = getMgr();
    if (!mgr) {
      renderer.render(scene, camera);
      return;
    }

    const noActiveExpr = Object.keys(activeExpr).length === 0;
    const sentimentActive = sentimentLayer?.name && nowMs <= sentimentLayer.until;
    
    // Clear expired sentiment layers
    if (!sentimentActive && lastSentimentActive) {
      clearSentimentLayer();
    }
    
    lastSentimentActive = sentimentActive;

    // Apply sentiment overlay if active
    if (sentimentActive) {
      applySentimentLayer(nowMs);
    }

    // Idle happy bias - only when truly idle
    const isTrulyIdle = !isSpeaking && !visemeActive && noActiveExpr && !sentimentActive;
    
    if (isTrulyIdle) {
      idleHappyTimer += dt;
      
      // Gradually increase happy expression over time when idle
      if (idleHappyTimer > 0.5) { // Start after 0.5s of idle
        const happyKey = expressionMap['happy'] ?? 'happy';
        if (mgr.getValue(happyKey) !== undefined) {
          const currentHappy = mgr.getValue(happyKey) || 0;
          const targetHappy = 0.3 + Math.sin(t * 0.5) * 0.1; // Gentle breathing happy
          mgr.setValue(happyKey, THREE.MathUtils.lerp(currentHappy, targetHappy, 0.02));
        }
        
        // Ensure neutral is low
        const neutralKey = expressionMap['neutral'] ?? 'neutral';
        if (mgr.getValue(neutralKey) !== undefined) {
          mgr.setValue(neutralKey, 0.0);
        }
      }
    } else {
      // Reset idle timer when not idle
      idleHappyTimer = 0;
    }

    // Apply persistent expressions (non-sentiment)
    applyExpressions(dt);

    // Always update Blendfaces if present
    if (blendfaces) {
      blendfaces.update(dt);
    }

    // Update gestures if present
    if (gestures) {
      gestures.update();
    }

    // Ambient behaviours
    handleBreath(t);
    handleGaze(dt);
    handleBlink(dt);

    // Finalize all expression changes
    mgr.update();
  }

  renderer.render(scene, camera);
}
animate();

// ——— Resize ———
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});