
// main.js
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { expressionMap } from './vrmMapping.js';
import { loadVRM } from './vrmUtils.js';
import { WSClient } from './ws.js';
import { BlendfacesController } from './blendfaces.js';
import { loadGLBSkybox } from './SkyBoxGLBLoader.js';

// UI toggles and endpoints
const backendBase = 'https://sentali-app-6926-e4gwhtajg3dfaphs.eastus2-01.azurewebsites.net';

// Scene, camera, renderer
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(25, window.innerWidth / window.innerHeight, 0.1, 200);
const renderer = new THREE.WebGLRenderer({ antialias: true, canvas: document.getElementById('c') });

camera.position.set(0, 1.6, 4.5);
camera.updateProjectionMatrix();

renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;

// Controls
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 1.6, 0);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.minDistance = 1.0;
controls.maxDistance = 6.0;
controls.update();

// Lighting
scene.add(new THREE.AmbientLight(0xffffff, 0.3));
[
  new THREE.DirectionalLight(0xffffff, 1.2),
  new THREE.DirectionalLight(0xffffff, 0.6),
  new THREE.DirectionalLight(0xffffff, 0.8)
].forEach((light, i) => {
  const pos = [[0.5,1,0.8],[-0.5,0.8,-0.8],[0,1,-1]][i];
  light.position.set(...pos);
  scene.add(light);
});

// Groups
const vrmGroup = new THREE.Group();
const skyGroup = new THREE.Group();
scene.add(vrmGroup, skyGroup);

let currentVRM;
let blendfaces;
let blendfacesWSHandler = null;
const clock = new THREE.Clock();

let exprMgr = null; // VRM 0.x: blendShapeProxy; VRM 1.x: expressionManager
let vrmReady = false;

function isVRM0() {
  return !!(currentVRM && currentVRM.blendShapeProxy && !currentVRM.expressionManager);
}

function getMgr() {
  return exprMgr || (currentVRM?.expressionManager || currentVRM?.blendShapeProxy) || null;
}

// Mobile detection
function isMobile() {
  return /Mobi|Android/i.test(navigator.userAgent);
}

// Load skybox with timeout/retry and mobile fallback to PNG
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
      await new Promise(resolve => setTimeout(resolve, 2000)); // Backoff
    }
  }
}

(async () => {
  try {
    if (isMobile()) {
      console.log('[Skybox] Using mobile PNG fallback');
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
              map: tex,
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

// Expression management
const activeExpr = {};
const DECAY_EMO = 3.0;
const DECAY_VISEME = 10.0;
const SMOOTH = 0.4;

function setExpressionPersistent(name, weight, decay = DECAY_EMO) {
  const mapped = expressionMap[name] ?? name;
  const mgr = getMgr();
  if (mgr && mgr.getValue(mapped) === undefined) {
    console.warn(`[setExpressionPersistent] Expression ${mapped} not found on VRM model`);
  }
  activeExpr[mapped] = { weight, decay };
}

function applyExpressions(delta) {
  if (!vrmReady) return;
  const mgr = getMgr();
  if (!mgr) return;

  for (const [m, st] of Object.entries(activeExpr)) {
    if (isSpeaking && ['aa', 'ee', 'ih', 'oh', 'ou', 'neutral', 'joy', 'happy', 'angry', 'sorrow', 'fun', 'surprised'].includes(m)) continue;
    st.weight = THREE.MathUtils.lerp(st.weight, 0, st.decay * delta);
    if (st.weight < 0.01) {
      delete activeExpr[m];
      continue;
    }
    const curr = mgr.getValue(m) || 0;
    const blend = THREE.MathUtils.lerp(curr, st.weight, SMOOTH);
    if (mgr.getValue(m) === undefined) {
      console.warn(`[applyExpressions] Expression ${m} not found on VRM model`);
    } else {
      mgr.setValue(m, blend);
    }
  }
  mgr.update();
}

function shouldUseBlendfaces() {
  return false; // Keep disabled until scheduleVisemes is verified
}

/* WebSocket for visemes and blendshapes */
const wsClient = new WSClient({
  url: `wss://${window.location.host}/ws`,
  onOpen: () => console.log('WS connected'),
  onMessage: data => {
    const audioUrl = data.audioUrl || data.audio;
    if (audioUrl) new Audio(audioUrl).play().catch(e => console.warn('WS audio error', e));

    if (data.expression && !isSpeaking) {
      setExpressionPersistent(data.expression, 1.0, DECAY_EMO);
    }

    if (data.type === 'blendshapes' && data.values) {
      for (const [n, w] of Object.entries(data.values)) {
        if (!isSpeaking) setExpressionPersistent(n, Number(w), DECAY_EMO);
      }
    }

    if (data.type === 'viseme' && data.name) {
      setExpressionPersistent(data.name, data.weight ?? 1, DECAY_VISEME);
    }
  },
  onClose: () => console.log('WS disconnected')
});
wsClient.connect();

/* Sanitizer for TTS input */
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
    if (ws) {
      if (!inSpace) { out += ' '; inSpace = true; }
    } else {
      out += c;
      inSpace = false;
    }
  }
  return out.trim();
}

/* Ambient state & behaviours (countdown) */
let chestBaseY = 0;
let blinkTimer = 2 + Math.random() * 3;
let gazeTimer = 2 + Math.random() * 2;
let gazeDirection = 0;

function handleBlink(delta) {
  if (isSpeaking) return; // Skip blinking during speaking
  blinkTimer -= delta;
  if (blinkTimer <= 0) {
    if (shouldUseBlendfaces()) {
      blendfaces.set('blink', 1.0, 'live', 150);
    } else {
      const mgr = getMgr();
      if (mgr) {
        mgr.setValue('blink', 1.0);
        mgr.update();
        setTimeout(() => {
          mgr.setValue('blink', 0.0);
          mgr.update();
        }, 150);
      }
    }
    blinkTimer = 2 + Math.random() * 3;
  }
}

function handleGaze(delta) {
  gazeTimer -= delta;
  if (gazeTimer <= 0) {
    gazeDirection = (Math.random() - 0.5) * 0.2;
    gazeTimer = 2 + Math.random() * 2;
  }
  let head = currentVRM?.humanoid.getNormalizedBoneNode('head');
  if (!head) {
    head = currentVRM?.scene.getObjectByName('Head');
  }
  if (head) {
    head.rotation.y += (gazeDirection - head.rotation.y) * 0.05;
  }
}

function handleBreath(t) {
  let chest = currentVRM?.humanoid.getNormalizedBoneNode('chest');
  if (!chest) {
    chest = currentVRM?.humanoid.getNormalizedBoneNode('upper_chest');
  }
  if (!chest) {
    chest = currentVRM?.scene.getObjectByName('Spine1') || currentVRM?.scene.getObjectByName('Spine2');
  }
  if (chest) {
    chest.position.y = chestBaseY + Math.sin(t * 0.5) * 0.01;
  }
}

/* Load VRM + initialize ambient timers */
function initAvatar(vrm) {
  let chest = vrm.humanoid.getNormalizedBoneNode('chest');
  if (!chest) chest = vrm.humanoid.getNormalizedBoneNode('upper_chest');
  if (!chest) chest = vrm.scene.getObjectByName('Spine1') || vrm.scene.getObjectByName('Spine2');
  if (chest) chestBaseY = chest.position.y;
  blinkTimer = 2 + Math.random() * 3;
  gazeTimer = 2 + Math.random() * 2;
  gazeDirection = 0;
}

loadVRM('/Assets/Sentali2.vrm', scene, camera, controls, vrm => {
  currentVRM = vrm;
  exprMgr = vrm.expressionManager || vrm.blendShapeProxy;
  vrmReady = !!exprMgr;

  vrmGroup.add(vrm.scene);
  vrm.scene.rotation.y = Math.PI;

  controls.target.set(0, 1.6, 0);
  controls.update();

  initAvatar(vrm);

  blendfaces = new BlendfacesController(vrm, {
    expressionMap,
    smooth: 0.9,
    decay: 0,
    rest: { blink: 0.0 }
  });
  blendfaces.attachWS(cb => blendfacesWSHandler = cb);

  console.log('[VRM] Loaded successfully');
  console.log('[VRM] Humanoid bones:', Object.keys(vrm.humanoid.humanBones));
  console.log('[VRM] Available expressions:', exprMgr?.getExpressionNames?.() || Object.keys(expressionMap));

  // Extended sanity test for mouth shapes
  if (vrmReady) {
    const allBlendShapes = ['joy', 'angry', 'sorrow', 'neutral', 'fun', 'surprised', 'aa', 'ee', 'ih', 'oh', 'ou', 'blink', 'blinkleft', 'blinkright', 'lookdown', 'lookleft', 'lookright', 'lookup', 'infinity', 'irisbake'];
    ['aa', 'ee', 'ih', 'oh', 'ou'].forEach((k, i) => {
      setTimeout(() => {
        allBlendShapes.forEach(vk => {
          if (exprMgr.getValue(vk) !== undefined) {
            exprMgr.setValue(vk, 0.0);
          }
        });
        exprMgr.setValue(k, 2.0); // Increased weight
        exprMgr.update();
        console.log(`[Sanity Test] Set ${k} to 2.0 (exists: ${exprMgr.getValue(k) !== undefined}, actual: ${exprMgr.getValue(k)})`);
        allBlendShapes.forEach(vk => {
          const value = exprMgr.getValue(vk);
          console.log(`[Sanity Test State] ${vk} = ${value}`);
        });
        setTimeout(() => {
          exprMgr.setValue(k, 0.0);
          exprMgr.update();
        }, 1000); // Extended to 1000ms
      }, i * 1200); // Staggered by 1200ms
    });
  }
});

function testVRM0MouthShapes() {
  const mgr = currentVRM?.expressionManager || currentVRM?.blendShapeProxy;
  if (!mgr) {
    console.warn('No expression manager or blendShapeProxy found');
    return;
  }

  const presets = ['aa', 'ee', 'ih', 'oh', 'ou'];
  let i = 0;

  function next() {
    presets.forEach(k => mgr.setValue(k, 0.0));
    if (i >= presets.length) {
      console.log('Test complete');
      return;
    }
    const key = presets[i];
    console.log(`[Test] Setting ${key} to 2.0 (exists: ${mgr.getValue(key) !== undefined})`);
    mgr.setValue(key, 2.0); // Increased weight
    mgr.update();
    i++;
    setTimeout(next, 1000); // Extended to 1000ms
  }

  next();
}

testVRM0MouthShapes();

function scheduleVisemes(visemes, audio) {
  if (!vrmReady) return;
  const mgr = getMgr();
  if (!mgr) return;

  // Filter out neutral visemes
  const keys = visemes
    .slice()
    .sort((a, b) => (a.timeMs || 0) - (b.timeMs || 0))
    .map(mapViseme)
    .filter(k => k && k.key !== 'neutral');

  const visemeKeys = ['aa', 'ee', 'ih', 'oh', 'ou'];
  const allBlendShapes = ['joy', 'angry', 'sorrow', 'neutral', 'fun', 'surprised', 'aa', 'ee', 'ih', 'oh', 'ou', 'blink', 'blinkleft', 'blinkright', 'lookdown', 'lookleft', 'lookright', 'lookup', 'infinity', 'irisbake'];

  // Wait for audio to start playing with a slight delay
  audio.addEventListener('play', () => {
    console.log('[TTS] Audio started at:', performance.now());
    keys.forEach(({ t, key }, index) => {
      const nextT = index < keys.length - 1 ? keys[index + 1].t * 1000 : t * 1000 + 500;
      const duration = Math.max(300, Math.min(nextT - t * 1000, 1000)); // Minimum 300ms
      setTimeout(() => {
        // Reset all blend-shapes to 0
        allBlendShapes.forEach(vk => {
          if (mgr.getValue(vk) !== undefined) {
            mgr.setValue(vk, 0.0);
          }
        });
        mgr.setValue(key, 2.0); // Increased weight
        mgr.update();
        console.log(`[Viseme] Scheduled: ${key} at ${t * 1000}ms (value: ${mgr.getValue(key)}, duration: ${duration}ms)`);
        allBlendShapes.forEach(vk => {
          const value = mgr.getValue(vk);
          console.log(`[BlendShape State] ${vk} = ${value}`);
        });
        setTimeout(() => {
          mgr.setValue(key, 0.0);
          mgr.update();
        }, duration);
      }, Math.max(0, t * 1000) + 100); // 100ms delay for audio sync
    });

    // After the last viseme, reset all to 0
    if (keys.length > 0) {
      const lastT = keys[keys.length - 1].t * 1000 + 500 + 100; // Account for delay
      setTimeout(() => {
        allBlendShapes.forEach(vk => {
          if (mgr.getValue(vk) !== undefined) {
            mgr.setValue(vk, 0.0);
          }
        });
        mgr.update();
        console.log('[Viseme] Reset all blend-shapes after sequence');
      }, lastT);
    }
  }, { once: true });

  if (audio) audio.play().catch(() => {});
}

/* Viseme ID map from backend */
const visemeMap = {
  0: 'neutral',
  1: 'aa', 2: 'aa', 3: 'ih', 4: 'ee', 5: 'oh',
  6: 'ou', 7: 'ou', 8: 'ee', 9: 'ih', 10: 'oh',
  11: 'ou', 12: 'aa', 13: 'ee', 14: 'ih', 15: 'oh',
  16: 'ou', 17: 'aa', 18: 'ee', 19: 'ih', 20: 'oh',
  21: 'neutral'
};

/* Aliases for common VRM/VRM0 vowel presets */
const vowelAliases = {
  aa: ['aa', 'A', 'vrc.v_aa', 'vowel_A'],
  ee: ['ee', 'E', 'vrc.v_ee', 'vowel_E'],
  ih: ['ih', 'I', 'vrc.v_ih', 'vowel_I'],
  oh: ['oh', 'O', 'vrc.v_oh', 'vowel_O'],
  ou: ['ou', 'U', 'vrc.v_ou', 'vowel_U']
};

function resolveToVRMKey(viseme) {
  const alias = typeof viseme === 'string'
    ? viseme
    : visemeMap[viseme.visemeId ?? viseme.id] || null;
  if (!alias) {
    console.warn(`[resolveToVRMKey] No alias for viseme:`, viseme);
    return null;
  }
  const mgr = getMgr();
  if (mgr && mgr.getValue(alias) !== undefined) {
    return alias;
  }
  const key = expressionMap[alias];
  if (key && mgr && mgr.getValue(key) !== undefined) {
    return key;
  }
  const fallback = { aa: 'aa', ee: 'ee', ih: 'ih', oh: 'oh', ou: 'ou' }[alias];
  if (fallback && mgr && mgr.getValue(fallback) !== undefined) {
    return fallback;
  }
  console.warn(`[resolveToVRMKey] No valid VRM key for alias: ${alias}`);
  return null;
}

function resolveMouth(name) {
  const candidates = vowelAliases[name] || [name];
  const mgr = getMgr();
  for (const c of candidates) {
    if (mgr && mgr.getValue(c) !== undefined) {
      return c;
    }
  }
  const fallback = { aa: 'aa', ee: 'ee', ih: 'ih', oh: 'oh', ou: 'ou' }[name];
  if (fallback && mgr && mgr.getValue(fallback) !== undefined) {
    return fallback;
  }
  if (name === 'neutral' && mgr && mgr.getValue('neutral') !== undefined) {
    return 'neutral';
  }
  console.warn(`[resolveMouth] No valid VRM key for: ${name}`);
  return null;
}

function mapViseme(v) {
  const key = resolveToVRMKey(v);
  if (!key) {
    console.warn(`[mapViseme] Failed to map viseme:`, v);
    return null;
  }
  console.log('→ mapped viseme:', key);
  return { t: (v.timeMs ?? 0) / 1000, key };
}

/* Mouth alias list and set */
const mouthAliasList = [
  ...vowelAliases.aa, ...vowelAliases.ee, ...vowelAliases.ih, ...vowelAliases.oh, ...vowelAliases.ou,
  'aa', 'ee', 'ih', 'oh', 'ou', 'A', 'E', 'I', 'O', 'U'
];
const mouthSet = new Set(mouthAliasList);

function maskMouthShapesWhileSpeaking(mgr) {
  if (!isSpeaking) return;
  for (const key of Object.keys(expressionMap || {})) {
    if (mouthSet.has(key) && !['aa', 'ee', 'ih', 'oh', 'ou'].includes(key)) {
      const mapped = expressionMap[key] ?? key;
      if (mgr.getValue(mapped) !== undefined) {
        mgr.setValue(mapped, 0.0);
      }
    }
  }
}

/* Prevent overlapping TTS calls with abort */
let ttsInflight = false;
let isSpeaking = false;
let ttsAbortController = null;

async function speakAndType(text, agentDiv) {
  if (ttsInflight) {
    console.warn('[TTS] Request in-flight; aborting previous and starting new');
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
      new Promise((_, reject) => setTimeout(() => reject(new Error('TTS request timeout')), 60000))
    ]);

    if (!res.ok) {
      console.error(`[TTS Error] HTTP ${res.status}`);
      updateChatEntry(agentDiv, 'agent', text);
      return;
    }

    const body = await res.json().catch(() => null);
    console.log('[TTS] Response body:', body);
    if (!body?.audioUrl) {
      console.warn('[TTS] No audioUrl in response', body);
      updateChatEntry(agentDiv, 'agent', text);
      return;
    }

    const visemes = (body.visemes || []).slice().sort((a, b) => a.timeMs - b.timeMs);
    console.log(`[TTS] Viseme count: ${visemes.length}`, visemes);
    console.log('[Viseme objects]', visemes);

    const audio = new Audio(body.audioUrl);
    audio.crossOrigin = 'anonymous';
    audio.addEventListener('error', err => console.error('[TTS] Audio error:', err), { once: true });
    audio.addEventListener('canplaythrough', () => console.log('[TTS] Ready to play'), { once: true });

    await new Promise((resolve, reject) => {
      audio.addEventListener('loadedmetadata', resolve, { once: true });
      audio.addEventListener('error', reject, { once: true });
    }).catch(err => console.warn('[TTS] Metadata load failed:', err));

    const durationMs = (audio.duration > 0)
      ? audio.duration * 1000
      : Math.max(1500, Math.min(12000, text.split(/\s+/).length / 2.5 * 1000));

    audio.addEventListener('play', () => {
      isSpeaking = true;
      typeOut(agentDiv, 'agent', text, durationMs);
      if (shouldUseBlendfaces() && blendfaces) {
        const items = visemes
          .map(v => {
            const m = mapViseme(v);
            return m && m.key !== 'neutral' ? { t: m.t, values: { [m.key]: 2.0 } } : null; // Increased weight
          })
          .filter(Boolean);
        console.log('[Blendfaces] Timeline items:', items);
        blendfaces.loadTimeline(items);
        blendfaces.playTimeline(0, audio);
      } else {
        scheduleVisemes(visemes, audio);
      }
    }, { once: true });

    audio.addEventListener('ended', () => {
      isSpeaking = false;
      const mgr = getMgr();
      console.log('[VRM] Available expressions:', mgr?.getExpressionNames?.() || Object.keys(expressionMap));
      if (mgr) {
        for (const key of mouthSet) {
          const mapped = expressionMap[key] ?? key;
          if (mgr.getValue(mapped) !== undefined) {
            mgr.setValue(mapped, 0.0);
          }
        }
        mgr.update();
      }
    });

    audio.play().catch(err => {
      console.warn('[TTS] Audio play failed:', err);
      typeOut(agentDiv, 'agent', text, durationMs);
      isSpeaking = false;
    });

  } catch (err) {
    if (err.name !== 'AbortError' && err.message !== 'TTS request timeout') {
      console.error('[TTS] Error:', err);
    } else if (err.message === 'TTS request timeout') {
      console.warn('[TTS] Timeout after 60s');
    }
    updateChatEntry(agentDiv, 'agent', text);
    isSpeaking = false;
  } finally {
    ttsInflight = false;
    ttsAbortController = null;
  }
}

/* Chat + TTS (type as speaking) */
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
    const body = isJson
      ? await chatRes.json().catch(() => null)
      : await chatRes.text().catch(() => '');

    if (!chatRes.ok) {
      console.error('[Chat Error]', chatRes.status, body);
      addChatEntry('agent', '[Error contacting Agent]');
      return;
    }

    const reply = (body?.text ?? body?.reply ?? body?.message ?? '')
      .toString()
      .trim();

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

/* Mic button */
function initMicButton() {
  const micBtn = document.getElementById('micBtn');
  if (!micBtn) {
    console.warn('[UI] #micBtn not found');
    return;
  }
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

/* UI wiring */
function initUI() {
  const sendBtn = document.getElementById('agentSendBtn');
  const inputEl = document.getElementById('agentInput');

  if (!sendBtn) console.warn('[UI] #agentSendBtn not found');
  if (!inputEl) console.warn('[UI] #agentInput not found');

  if (sendBtn) {
    sendBtn.addEventListener('click', () => {
      sendToAgent();
    });
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
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initUI, { once: true });
} else {
  initUI();
}

/* Animation loop */
function animate() {
  requestAnimationFrame(animate);
  const dt = clock.getDelta();
  const t = clock.getElapsedTime();

  if (currentVRM) {
    currentVRM.update(dt);

    const mgr = getMgr();

    if (!isSpeaking && Object.keys(activeExpr).length === 0) {
      if (mgr.getValue('joy') !== undefined) {
        mgr.setValue('joy', 1.0);
      }
      if (mgr.getValue('neutral') !== undefined) {
        mgr.setValue('neutral', 0.0);
      }
    }

    const spine = currentVRM.humanoid.getNormalizedBoneNode('spine');
    if (spine) {
      spine.rotation.y = Math.sin(t * 0.5 * Math.PI * 2) * 0.02;
    } else {
      let fallbackSpine = currentVRM.scene.getObjectByName('Spine');
      if (fallbackSpine) {
        fallbackSpine.rotation.y = Math.sin(t * 0.5 * Math.PI * 2) * 0.02;
        console.log('[Sway] Fell back to raw Spine bone');
      } else {
        console.warn('[Ambient] No spine bone found (normalized or raw)');
      }
    }

    applyExpressions(dt);

    if (isSpeaking && mgr) {
      maskMouthShapesWhileSpeaking(mgr);
      const allBlendShapes = ['joy', 'angry', 'sorrow', 'neutral', 'fun', 'surprised', 'aa', 'ee', 'ih', 'oh', 'ou', 'blink', 'blinkleft', 'blinkright', 'lookdown', 'lookleft', 'lookright', 'lookup', 'infinity', 'irisbake'];
      allBlendShapes.forEach(key => {
        const value = mgr.getValue(key);
        if (value !== undefined && value > 0) {
          console.log(`[BlendShape Debug] ${key} = ${value}`);
        }
      });
    }

    if (shouldUseBlendfaces()) {
      blendfaces.update(dt);
      const visemeKeys = ['aa', 'ee', 'ih', 'oh', 'ou'];
      visemeKeys.forEach(key => {
        const value = mgr.getValue(key);
        if (value !== undefined && value > 0) {
          console.log(`[Blendfaces Debug] ${key} = ${value}`);
        }
      });
    }

    handleBreath(t);
    handleGaze(dt);
    handleBlink(dt);
  } else {
    console.warn('[Animate] No currentVRM');
  }

  controls.update();
  renderer.render(scene, camera);
}
animate();

/* Window resize handler */
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});