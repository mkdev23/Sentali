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
// Track load promises
let skyboxLoaded, avatarLoaded;


// Mobile detection
function isMobile() {
  return /Mobi|Android/i.test(navigator.userAgent);
}

// Load skybox with timeout/retry and mobile fallback to PNG
async function loadSkyboxWithRetry(url, retries = 3, timeoutMs = 10000) {
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
    function loadSkyboxAsync() {
  return new Promise(async (resolve) => {
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
        const skyboxUrl = 'https://sentaliskybox-azure-fpb4b0hxcff2f3f4.z03.azurefd.net/skyboxes/sentali_skybox.glb?...';
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
    resolve();
  });
}


// Expression management
const activeExpr = {};
const DECAY_EMO = 3.0;
const DECAY_VISEME = 10.0;
const SMOOTH = 0.4;

function setExpressionPersistent(name, weight, decay = DECAY_EMO) {
  const mapped = expressionMap[name] ?? name;
  activeExpr[mapped] = { weight, decay };
}

function applyExpressions(delta) {
  if (!currentVRM) return;
  const mgr = currentVRM.expressionManager || currentVRM.blendShapeProxy;
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

/* WebSocket for visemes and blendshapes */
const wsClient = new WSClient({
  url: `wss://${window.location.host}/ws`,
  onOpen: () => console.log('WS connected'),
  onMessage: data => {
    // Play any audio URL
    const audioUrl = data.audioUrl || data.audio;
    if (audioUrl) new Audio(audioUrl).play().catch(e => console.warn('WS audio error', e));

    // Expression cue
    if (data.expression) {
      setExpressionPersistent(data.expression, 1.0, DECAY_EMO);
    }

    // Legacy blendshape payload
    if (data.type === 'blendshapes' && data.values) {
      for (const [n, w] of Object.entries(data.values)) {
        setExpressionPersistent(n, Number(w), DECAY_EMO);
      }
    }

    // Single viseme event
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
  // 1) Remove “[No response]”
  let t = s.split('[No response]').join('').trim();
  // 2) Strip high-plane code points (emoji)
  let noEmoji = '';
  for (const ch of t) {
    const cp = ch.codePointAt(0);
    if (cp !== undefined && cp <= 0xFFFF) noEmoji += ch;
  }
  // 3) Collapse whitespace
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
  blinkTimer -= delta;
  if (blinkTimer <= 0) {
    const mgr = currentVRM.expressionManager || currentVRM.blendShapeProxy;
    if (shouldUseBlendfaces()) {
      blendfaces.set('blink', 1.0, 'live', 150);
    } else {
      mgr.setValue('blink', 1.0);
      mgr.update();
      setTimeout(() => {
        mgr.setValue('blink', 0.0);
        mgr.update();
      }, 150);
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
  let head = currentVRM.humanoid.getNormalizedBoneNode('head');
  if (!head) {
    head = vrm.scene.getObjectByName('Head');
  }
  if (head) {
    head.rotation.y += (gazeDirection - head.rotation.y) * 0.05;
  }
}

function handleBreath(t) {
  let chest = currentVRM.humanoid.getNormalizedBoneNode('chest');
  if (!chest) {
    chest = currentVRM.humanoid.getNormalizedBoneNode('upper_chest');
  }
  if (!chest) {
    chest = vrm.scene.getObjectByName('Spine1') || vrm.scene.getObjectByName('Spine2');
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

// Wrap VRM load in a Promise
function loadAvatarAsync() {
  return new Promise((resolve) => {
    loadVRM('/Assets/Sentali2.vrm', scene, camera, controls, vrm => {
      currentVRM = vrm;
      vrmGroup.add(vrm.scene);
      vrm.scene.rotation.y = Math.PI;
      controls.target.set(0, 1.6, 0);
      controls.update();
      initAvatar(vrm);
      resolve();
    });
  });
}
// Start both loads
Promise.all([loadSkyboxAsync(), loadAvatarAsync()]).then(() => {
  const overlay = document.getElementById('loading-overlay');
  overlay.style.transition = 'opacity 0.5s ease';
  overlay.style.opacity = '0';
  setTimeout(() => overlay.remove(), 500);
});



  blendfaces = new BlendfacesController(vrm, {
    expressionMap,
    smooth: 0.3,
    decay: 1.5,
    rest: { blink: 0.0, neutral: 1.0 }
  });
  blendfaces.attachWS(cb => blendfacesWSHandler = cb);
  console.log('[VRM] Loaded successfully');
  console.log('[VRM] Humanoid bones:', Object.keys(vrm.humanoid.humanBones));
  const mgr = vrm.expressionManager || vrm.blendShapeProxy;
  if (mgr?.getExpressionNames) {
    console.log('[VRM] Expressions available in manager:', mgr.getExpressionNames());
  }
});

console.log('[Viseme raw IDs]', visemes.map(v => v.VisemeId));

/* Viseme ID map from backend */
// Backend → VRM viseme aliasing
const visemeMap = {
  1: 'aa', 2: 'aa', 3: 'ih', 4: 'ee', 5: 'oh',
  6: 'ou', 7: 'ou', 8: 'ee', 9: 'ih', 10: 'oh',
  11: 'ou', 12: 'aa', 13: 'ee', 14: 'ih', 15: 'oh',
  16: 'ou', 17: 'aa', 18: 'ee', 19: 'ih', 20: 'oh'
};

// Aliases for common VRM/VRM0 vowel presets
const vowelAliases = {
  aa: ['aa', 'A', 'vrc.v_aa', 'vowel_A'],
  ee: ['ee', 'E', 'vrc.v_ee', 'vowel_E'],
  ih: ['ih', 'I', 'vrc.v_ih', 'vowel_I'],
  oh: ['oh', 'O', 'vrc.v_oh', 'vowel_O'],
  ou: ['ou', 'U', 'vrc.v_ou', 'vowel_U']
};

// Resolve to a mouth expression that actually exists in your VRM/expressionMap
function resolveMouth(name) {
  const candidates = vowelAliases[name] || [name];
  const available = new Set(Object.keys(expressionMap || {}));
  for (const c of candidates) {
    if (available.has(c)) return c;
  }
  // Last‑chance fallbacks if your map doesn’t list vowels explicitly
  const fallback = { aa: 'A', ee: 'E', ih: 'I', oh: 'O', ou: 'U' }[name];
  if (fallback && available.has(fallback)) return fallback;
  // If still nothing, return null so we don’t spam set calls that do nothing
  console.warn('[Viseme] No matching expression for', name, 'in expressionMap keys:', [...available]);
  return null;
}

/* 🔹 Mouth alias list and set */
const mouthAliasList = [
  ...vowelAliases.aa, ...vowelAliases.ee, ...vowelAliases.ih, ...vowelAliases.oh, ...vowelAliases.ou,
  'aa', 'ee', 'ih', 'oh', 'ou', 'A', 'E', 'I', 'O', 'U'
];
const mouthSet = new Set(mouthAliasList);

/* 🔹 Mouth masking helpers: ensure expressions never override viseme mouth while speaking */
function maskMouthShapesWhileSpeaking(mgr) {
  if (!isSpeaking) return;
  for (const key of Object.keys(expressionMap || {})) {
    if (mouthSet.has(key)) {
      const mapped = expressionMap[key] ?? key; // map to VRM expression
      mgr.setValue(mapped, 0.0);
    }
  }
}

/* Prevent overlapping TTS calls with abort */
let ttsInflight = false;
let isSpeaking = false;
let ttsAbortController = null;

// Track last viseme (mapped to VRM expression name)
let currentVisemeName = null;
let currentVisemeWeight = 0;

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

    const visemes = (body.visemes || []).slice().sort((a, b) => a.TimeMs - b.TimeMs);
    console.log(`[TTS] Viseme count: ${visemes.length}`, visemes);

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

    // Keep expression (eyes/brows/etc.), mouth will be masked while speaking
    const expression = body.expression || 'neutral';
    setExpressionPersistent(expression, 1.0, DECAY_EMO);

    audio.addEventListener('play', () => {
      isSpeaking = true;
      typeOut(agentDiv, 'agent', text, durationMs);

      if (shouldUseBlendfaces() && blendfaces) {
        const keys = visemes
          .map(v => {
            const src = visemeMap[v.VisemeId];
            console.log(`VisemeId ${v.VisemeId} → src:`, src);
            if (!src) return null;
            const name = resolveMouth(src);
            console.log(`resolveMouth(${src}) →`, name);
            if (!name) return null;
            // Map to actual VRM expression name for re-apply in animate()
            const mapped = expressionMap[name] ?? name;
            currentVisemeName = mapped;
            currentVisemeWeight = 1.0;
            console.log(`[Viseme] ID ${v.VisemeId} → ${name} → ${mapped} at ${v.TimeMs}ms`);
            return { t: v.TimeMs / 1000, values: { [name]: 1 } }; // blendfaces consumes alias keys
          })
          .filter(Boolean);
        if (keys.length) {
          blendfaces.loadTimeline(keys);
          blendfaces.playTimeline(0, audio);
        } else {
          console.warn('[Viseme] No keys generated for timeline');
        }
      } else {
        visemes.forEach(v => {
          const src = visemeMap[v.VisemeId];
          if (!src) return;
          const name = resolveMouth(src);
          if (!name) return;
          // Map to actual VRM expression name for re-apply in animate()
          const mapped = expressionMap[name] ?? name;
          currentVisemeName = mapped;
          currentVisemeWeight = 1.0;
          console.log(`[Viseme] ID ${v.VisemeId} → ${name} → ${mapped} at ${v.TimeMs}ms`);
          setTimeout(() => setExpressionPersistent(name, 1, DECAY_VISEME), v.TimeMs);
        });
      }
    }, { once: true });

    audio.addEventListener('ended', () => {
      isSpeaking = false;
      currentVisemeName = null;
      currentVisemeWeight = 0;
      // Optional: clear any residual mouth weights the frame speech ends
      const mgr = currentVRM?.expressionManager || currentVRM?.blendShapeProxy;
      console.log('[VRM] Available expressions:', mgr.getExpressionNames?.());
      if (mgr) {
        for (const key of mouthSet) {
          const mapped = expressionMap[key] ?? key;
          if ((expressionMap || {})[key] !== undefined) mgr.setValue(mapped, 0.0);
        }
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

/* === Chat + TTS (type as speaking) === */
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

let sendingNow = false; // debounce so we don’t double-send

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

/* === Mic button === */
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
    recog.maxAlternatives= 1;

    recog.onresult = e => {
      const input = document.getElementById('agentInput');
      if (input) input.value = e.results[0][0].transcript;
      sendToAgent();
    };
    recog.onerror = e => addChatEntry('agent', `[Mic error: ${e.error}]`);
    recog.start();
  });
}

/* === UI wiring === */
function initUI() {
  const sendBtn = document.getElementById('agentSendBtn');
  const inputEl = document.getElementById('agentInput');

  if (!sendBtn) console.warn('[UI] #agentSendBtn not found');
  if (!inputEl) console.warn('[UI] #agentInput not found');

  // Click to send
  if (sendBtn) {
    sendBtn.addEventListener('click', () => {
      sendToAgent();
    });
  }

  // Press Enter to send (Shift+Enter for newline if using a textarea)
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

// Ensure DOM is ready before wiring
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initUI, { once: true });
} else {
  initUI();
}

/* === Animation loop === */
function animate() {
  requestAnimationFrame(animate);
  const dt = clock.getDelta();
  const t = clock.getElapsedTime();

  if (currentVRM) {
    currentVRM.update(dt);

    const mgr = currentVRM.expressionManager || currentVRM.blendShapeProxy;

    // default neutral "happy" expression (ambient idle)
    if (!isSpeaking && Object.keys(activeExpr).length === 0) {
      mgr.setValue('happy', 1.0);
      mgr.setValue('neutral', 0.0);
    }

    // spine sway
    const spine = currentVRM.humanoid.getNormalizedBoneNode('spine');
    if (spine) {
      spine.rotation.y = Math.sin(t * 0.5 * Math.PI * 2) * 0.02;
    } else {
      let fallbackSpine = vrm.scene.getObjectByName('Spine');
      if (fallbackSpine) {
        fallbackSpine.rotation.y = Math.sin(t * 0.5 * Math.PI * 2) * 0.02;
        console.log('[Sway] Fell back to raw Spine bone');
      } else {
        console.warn('[Ambient] No spine bone found (normalized or raw)');
      }
    }

    // 1) expressions/visemes
    applyExpressions(dt);

    // 🔹 Ensure mouth is not overridden by expressions while speaking
    if (isSpeaking && mgr) {
      maskMouthShapesWhileSpeaking(mgr);
      // 🔹 Re‑apply the most recent viseme so it persists between events
      if (currentVisemeName) {
        mgr.setValue(currentVisemeName, currentVisemeWeight);
      }
    }

    if (shouldUseBlendfaces()) blendfaces.update(dt);

    // 2) ambient: breathe → gaze → blink
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

/* === Window resize handler === */
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});