// main.js
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { expressionMap } from './vrmMapping.js';
import { loadVRM } from './vrmUtils.js';
import { WSClient } from './ws.js';
import { BlendfacesController } from './blendfaces.js';
import { loadGLBSkybox } from './SkyBoxGLBLoader.js';
import { GestureController } from './gestures.js';

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
  if (nowMs > sentimentLayer.until) return;
  const mgr = getMgr();
  const key = expressionMap[sentimentLayer.name] ?? sentimentLayer.name;
  if (key && key !== 'neutral') mgr.setValue(key, sentimentLayer.weight);
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

// --- Sentiment hold over the entire utterance ---
function setSentimentHold(expression, audio, weight = 0.6, durationMs) {
  if (!expression || expression === 'neutral') return;
  const mgr = getMgr();
  if (!mgr) return;

  const key = expressionMap[expression] ?? expression;
  if (!key || key === 'neutral') return;

  // Set sentimentLayer so animate() can detect active sentiment
  const holdMs = durationMs ?? (audio?.duration ? audio.duration * 1000 : 2000);
  sentimentLayer = {
    name: expression,
    weight,
    until: performance.now() + holdMs
  };

  // Apply immediately
  const apply = () => { mgr.setValue(key, weight); mgr.update(); };
  const clear = () => { mgr.setValue(key, 0.0); mgr.update(); };

  // If audio is provided, keep reapplying during playback
  if (audio) {
    const onTime = () => apply();
    const onEnd = () => {
      audio.removeEventListener('timeupdate', onTime);
      audio.removeEventListener('ended', onEnd);
      clear();
    };
    audio.addEventListener('timeupdate', onTime);
    audio.addEventListener('ended', onEnd);
  } else {
    // No audio — just apply once
    apply();
  }


  apply();
  audio.addEventListener('timeupdate', onTime);
  audio.addEventListener('ended', onEnd, { once: true });
}

// ——— WebSocket: server‑pushed TTS/visemes/emotions ———
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

async function speakAndType(text, agentDiv) {
  if (ttsInflight) {
    console.warn('[TTS] In-flight; aborting previous');
    ttsAbortController?.abort();
    updateChatEntry(agentDiv, 'agent', text);
  }
  ttsInflight = true;
  ttsAbortController = new AbortController();

  try {
    const clean = sanitizeForTTS(text);
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
      updateChatEntry(agentDiv, 'agent', text);
      return;
    }

    const body = await res.json().catch(() => null);
    if (!body?.audioUrl) {
      console.warn('[TTS] No audioUrl', body);
      updateChatEntry(agentDiv, 'agent', text);
      return;
    }

    const visemes = (body.visemes || []).slice().sort((a, b) => (a.timeMs || 0) - (b.timeMs || 0));
    const lastVisemeMs = visemes.length ? visemes[visemes.length - 1].timeMs : 0;

    const audio = new Audio(body.audioUrl);
    audio.crossOrigin = 'anonymous';

    // Try to get duration; don't block if slow
    await new Promise((resolve) => {
      let done = false;
      const finish = () => { if (!done) { done = true; resolve(); } };
      audio.addEventListener('loadedmetadata', finish, { once: true });
      audio.addEventListener('error', finish, { once: true });
      setTimeout(finish, 350);
    });

    // Drive typing to match audio/viseme duration (keeps pace with the text box)
    const durationMs = Math.max(
      (audio.duration > 0 ? audio.duration * 1000 : 0),
      lastVisemeMs + 250,
      Math.min(12000, text.split(/\s+/).length * 250)
    );

    const expression = body.expression || body.sentiment || 'neutral';

    // Build timeline now and mark active before trying to play
    const items = buildVisemeTimeline(visemes);
    const safetyMs = lastVisemeMs + 600;

    visemeActive = true;
    isSpeaking = true;

    // Sentiment overlay across the whole utterance
    setSentimentHold(expression, audio, 0.6);

    // Start typing synced to duration
    typeOut(agentDiv, 'agent', text, durationMs);

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

    // Try to play audio; if it fails, typing and visemes still run
    audio.play().catch(err => {
      console.warn('[TTS] Play failed:', err);
      // We already started timeline/scheduler; keep going
    });
  } catch (err) {
    if (err.name !== 'AbortError' && err.message !== 'TTS timeout') {
      console.error('[TTS] Error:', err);
    } else {
      console.warn('[TTS] Timeout after 60s');
    }
    updateChatEntry(agentDiv, 'agent', text);
    isSpeaking = false;
    visemeActive = false;
  } finally {
    ttsInflight = false;
    ttsAbortController = null;
  }
}

// ——— Chat UI helpers ———
function addChatEntry(role, text) {
  const log = document.getElementById('chat-log');
  if (!log) {
    console.warn('[UI] #chat-log not found');
    return null;
    }
  const div = document.createElement('div');
  div.className = 'chat-entry';
  div.innerHTML = `<span class="chat-${role}">${role}:</span> ${text || ''}`;
  log.appendChild(div);
  log.scrollTop = log.scrollHeight;
  return div;
}
function updateChatEntry(div, role, text) {
  if (!div) return;
  div.innerHTML = `<span class="chat-${role}">${role}:</span> ${text}`;
}
function typeOut(el, role, text, durationMs) {
  if (!el) return;
  const start = performance.now();
  const total = text.length;
  const label = `<span class="chat-${role}">${role}:</span> `;
  const spanId = `typing-${Math.random().toString(36).slice(2)}`;
  el.innerHTML = `${label}<span id="${spanId}"></span>`;
  const span = el.querySelector(`#${spanId}`);
  function frame(now) {
    const elapsed = now - start;
    const t = Math.min(1, durationMs > 0 ? elapsed / durationMs : 1);
    const count = Math.floor(total * t);
    if (span) span.textContent = text.slice(0, count);
    if (count < total) requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

// ——— Chat send ———
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
    addChatEntry('agent', '[Please enter a message]');
    sendingNow = false;
    return;
  }

  addChatEntry('user', msg);
  inputEl.value = '';

  try {
    const chatRes = await fetch(`${backendBase}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: msg })
    });
    const isJson = chatRes.headers.get('content-type')?.includes('application/json');
    const body = isJson ? await chatRes.json().catch(() => null) : await chatRes.text().catch(() => '');
    if (!chatRes.ok) {
      console.error('[Chat Error]', chatRes.status, body);
      addChatEntry('agent', '[Error contacting Agent]');
      return;
    }

    const reply = (body?.text ?? body?.reply ?? body?.message ?? '').toString().trim();
    if (!reply) {
      addChatEntry('agent', '[No response]');
      return;
    }

    const agentDiv = addChatEntry('agent', '');
    await speakAndType(reply, agentDiv);
  } catch (err) {
    console.error('[Agent Error]', err);
    addChatEntry('agent', '[Error contacting Agent]');
  } finally {
    sendingNow = false;
  }
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
    recog.onerror = e => addChatEntry('agent', `[Mic error: ${e.error}]`);
    recog.start();
  });
}

// ——— UI wiring ———
function initUI() {
  const sendBtn = document.getElementById('agentSendBtn');
  const inputEl = document.getElementById('agentInput');

  if (sendBtn) sendBtn.addEventListener('click', sendToAgent);
  if (inputEl) {
    inputEl.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendToAgent();
      }
    });
  }
  initMicButton();
}
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initUI, { once: true });
} else {
  initUI();
}



// Optional: clear sentiment instantly (e.g., in stopSpeaking())
function clearSentiment() {
  sentimentLayer = {};
}

// --- Main Animation Loop ---
function animate() {
  requestAnimationFrame(animate);
  const dt = clock.getDelta();
  const t = clock.getElapsedTime();

  controls.update();

  if (currentVRM) {
    currentVRM.update(dt);

    const mgr = getMgr();
    const noActiveExpr = Object.keys(activeExpr).length === 0;
    const sentimentActive = sentimentLayer?.name && performance.now() <= sentimentLayer.until;

    // Idle bias only if no visemes, no sentiment, and not speaking
    if (mgr && !isSpeaking && !visemeActive && noActiveExpr && !sentimentActive) {
      if (mgr.getValue('happy') !== undefined) mgr.setValue('happy', 1.0);
      if (mgr.getValue('neutral') !== undefined) mgr.setValue('neutral', 0.0);
    }

    // Apply persistent expressions
    applyExpressions(dt);

    // Apply sentiment overlay if active
    if (sentimentActive) {
      const key = expressionMap[sentimentLayer.name] ?? sentimentLayer.name;
      if (key && key !== 'neutral') {
        mgr.setValue(key, sentimentLayer.weight ?? 0.6);
      }
    }

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
    mgr?.update();
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
