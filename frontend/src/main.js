// main.js
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { expressionMap } from './vrmMapping.js';
import { loadVRM } from './vrmUtils.js';
import { WSClient } from './ws.js';
import { BlendfacesController } from './blendfaces.js';
import { loadGLBSkybox } from './SkyBoxGLBLoader.js';

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
const DECAY_VISEME = 10.0;
const SMOOTH = 0.4;

let chestBaseY = 0;
let blinkTimer = 2 + Math.random() * 3;
let gazeTimer = 2 + Math.random() * 2;
let gazeDirection = 0;

// ——— Scene / Renderer / Camera ———
const canvas = document.getElementById('c');
const renderer = new THREE.WebGLRenderer({ antialias: true, canvas });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;

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

// Lighting
scene.add(new THREE.AmbientLight(0xffffff, 0.3));
[
  [0.5, 1, 0.8, 1.2],
  [-0.5, 0.8, -0.8, 0.6],
  [0, 1, -1, 0.8]
].forEach(([x, y, z, intensity]) => {
  const dl = new THREE.DirectionalLight(0xffffff, intensity);
  dl.position.set(x, y, z);
  scene.add(dl);
});

// Groups
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
  activeExpr[mapped] = { weight, decay };
}

function applyExpressions(delta) {
  if (!vrmReady) return;
  const mgr = getMgr();
  if (!mgr) return;

  for (const [m, st] of Object.entries(activeExpr)) {
    st.weight = THREE.MathUtils.lerp(st.weight, 0, st.decay * delta);
    if (st.weight < 0.01) {
      delete activeExpr[m];
      continue;
    }
    const curr = mgr.getValue(m) || 0;
    const blend = THREE.MathUtils.lerp(curr, st.weight, SMOOTH);
    mgr.setValue(m, blend);
  }
  mgr.update();
}

function shouldUseBlendfaces() {
  return !!blendfaces;
}

// ——— Ambient behaviours ———
function handleBlink(delta) {
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
  const head = currentVRM?.humanoid.getNormalizedBoneNode('head')
             || currentVRM?.scene.getObjectByName('Head');
  if (head) head.rotation.y += (gazeDirection - head.rotation.y) * 0.05;
}

function handleBreath(t) {
  const chest = currentVRM?.humanoid.getNormalizedBoneNode('chest')
             || currentVRM?.humanoid.getNormalizedBoneNode('upper_chest')
             || currentVRM?.scene.getObjectByName('Spine1')
             || currentVRM?.scene.getObjectByName('Spine2');
  if (chest) chest.position.y = chestBaseY + Math.sin(t * 0.5) * 0.01;
}

loadVRM('/Assets/Sentali2.vrm', scene, camera, controls, vrm => {
  currentVRM = vrm;
  exprMgr = vrm.expressionManager || vrm.blendShapeProxy;
  vrmReady = !!exprMgr;

  // Cache chest height for any idle/gesture logic
  const chest = vrm.humanoid.getNormalizedBoneNode('chest')
             || vrm.humanoid.getNormalizedBoneNode('upper_chest');
  if (chest) chestBaseY = chest.position.y;

  // Merge available expressions into viseme map
  const available = exprMgr.getExpressionNames?.() ?? [];
  ['aa', 'ee', 'ih', 'oh', 'ou', 'neutral'].forEach(alias => {
    if (available.includes(alias)) expressionMap[alias] = alias;
  });

  // Init lipsync/blink controller
  blendfaces = new BlendfacesController(vrm, {
    expressionMap,
    smooth: 0.3,
    decay: 1.5,
    rest: { blink: 0.0 }
  });
  blendfaces.attachWS(cb => (blendfacesWSHandler = cb));

  // Parent once, keep child local-clean
  vrm.scene.rotation.y = Math.PI;
  vrm.scene.position.set(0, 0, 0);
  vrmGroup.add(vrm.scene);

  // Recenter: measure child, move parent, zero child local
  const box = new THREE.Box3().setFromObject(vrm.scene);
  const center = box.getCenter(new THREE.Vector3());

  // Move parent so the avatar’s center lands at world origin
  vrmGroup.position.sub(center);

  // Lift to eye level (adjust as needed)
  vrmGroup.position.y += 1.0;

  // Disable first-person culling for now
  if (vrm.firstPerson) {
    vrm.firstPerson.autoUpdate = false;
  }

  // Ensure visibility to main camera and align orbit target
  vrmGroup.traverse(o => o.layers?.enable?.(0));
  camera.layers.set(0);
  controls.target.set(0, 1.6, 0);
  controls.update();

  console.log('[VRM] Ready:', vrm.meta?.name, 'Expressions:', available);
});

// ——— Viseme mapping (ID → alias) ———
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

// ——— Mappers: timeline vs manual ———
function mapVisemeForTimeline(v) {
  const key = resolveToVRMKey(v);
  return key ? { t: (v.timeMs || 0) / 1000, values: { [key]: 1 } } : null;
}
function mapVisemeForManual(v) {
  const key = resolveToVRMKey(v);
  return key ? { t: (v.timeMs || 0) / 1000, key } : null;
}

// ——— Manual scheduler ———
function scheduleVisemes(visemes, audio) {
  if (!vrmReady) return;
  const mgr = getMgr();
  if (!mgr) return;

  visemes
    .slice()
    .sort((a, b) => (a.timeMs || 0) - (b.timeMs || 0))
    .map(mapVisemeForManual)
    .filter(Boolean)
    .forEach(({ t, key }) => {
      setTimeout(() => {
        mgr.setValue(key, 1.0);
        mgr.update();
        setTimeout(() => {
          mgr.setValue(key, 0.0);
          mgr.update();
        }, 120);
      }, Math.max(0, t * 1000));
    });

  if (audio) audio.play().catch(() => {});
}

// ——— WebSocket: server‑pushed TTS/visemes/emotions ———
const wsClient = new WSClient({
  url: `wss://${window.location.host}/ws`,
  onOpen: () => console.log('WS connected'),
  onClose: () => console.log('WS disconnected'),
  onMessage: data => {
    const audioUrl = data.audioUrl || data.audio;
    if (data.expression) {
      setExpressionPersistent(data.expression, 1.0, DECAY_EMO);
    }
    if (!audioUrl) return;

    const visemes = Array.isArray(data.visemes) ? data.visemes : [];
    const audio = new Audio(audioUrl);
    audio.crossOrigin = 'anonymous';

    audio.addEventListener('play', () => {
      isSpeaking = true;
      if (shouldUseBlendfaces() && blendfaces) {
        const items = visemes.map(mapVisemeForTimeline).filter(Boolean);
        if (items.length) {
          blendfaces.loadTimeline(items);
          blendfaces.playTimeline(0, audio);
        } else {
          console.warn('[Visemes] No valid timeline items');
        }
      } else {
        scheduleVisemes(visemes, audio);
      }
    }, { once: true });

    audio.addEventListener('ended', () => {
      isSpeaking = false;
      const mgr = getMgr();
      if (mgr) mgr.update();
    });

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
    if (ws) {
      if (!inSpace) { out += ' '; inSpace = true; }
    } else {
      out += c;
      inSpace = false;
    }
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
    const audio = new Audio(body.audioUrl);
    audio.crossOrigin = 'anonymous';

    await new Promise((resolve, reject) => {
      audio.addEventListener('loadedmetadata', resolve, { once: true });
      audio.addEventListener('error', reject, { once: true });
    }).catch(() => {});

    const durationMs = (audio.duration > 0)
      ? audio.duration * 1000
      : Math.max(1500, Math.min(12000, text.split(/\s+/).length * 250));

    const expression = body.expression || 'neutral';
    setExpressionPersistent(expression, 1.0, DECAY_EMO);

    audio.addEventListener('play', () => {
      isSpeaking = true;
      typeOut(agentDiv, 'agent', text, durationMs);

      if (shouldUseBlendfaces() && blendfaces) {
        const items = visemes.map(mapVisemeForTimeline).filter(Boolean);
        if (items.length) {
          blendfaces.loadTimeline(items);
          blendfaces.playTimeline(0, audio);
        } else {
          console.warn('[Visemes] No valid timeline items');
        }
      } else {
        scheduleVisemes(visemes, audio);
      }
    }, { once: true });

    audio.addEventListener('ended', () => {
      isSpeaking = false;
      const mgr = getMgr();
      if (mgr) mgr.update();
    });

    audio.play().catch(err => {
      console.warn('[TTS] Play failed:', err);
      typeOut(agentDiv, 'agent', text, durationMs);
      isSpeaking = false;
    });
  } catch (err) {
    if (err.name !== 'AbortError' && err.message !== 'TTS timeout') {
      console.error('[TTS] Error:', err);
    } else {
      console.warn('[TTS] Timeout after 60s');
    }
    updateChatEntry(agentDiv, 'agent', text);
    isSpeaking = false;
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

// ——— Animation loop ———
function animate() {
  requestAnimationFrame(animate);
  const dt = clock.getDelta();
  const t = clock.getElapsedTime();

  controls.update();

  if (currentVRM) {
    currentVRM.update(dt);

    // Optional idle bias if your model has these shapes
    const mgr = getMgr();
    if (mgr && !isSpeaking && Object.keys(activeExpr).length === 0) {
      if (mgr.getValue('happy') !== undefined) mgr.setValue('happy', 1.0);
      if (mgr.getValue('neutral') !== undefined) mgr.setValue('neutral', 0.0);
    }

    applyExpressions(dt);

    if (shouldUseBlendfaces()) {
      blendfaces.update(dt);
    }

    handleBreath(t);
    handleGaze(dt);
    handleBlink(dt);
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