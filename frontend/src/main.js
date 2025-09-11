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

// Load skybox
(async () => {
  try {
    const sb = await loadGLBSkybox(
      'https://sentaliskybox-azure-fpb4b0hxcff2f3f4.z03.azurefd.net/skyboxes/sentali_skybox.glb?sp=r&st=2025-09-10T04:07:34Z&se=2027-09-11T12:22:34Z&spr=https&sv=2024-11-04&sr=b&sig=VvlNDwJ5iSJGDkIcLcdCsQULT7iLPJbnrIzHVgf4wAg%3D',
      scene,
      camera,
      { desiredRadius: camera.far * 0.9, setSceneBackground: true }
    );
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
  } catch (err) {
    console.error('Skybox load failed:', err);
  }
})();

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
  return !!blendfaces; // Use Blendfaces by default since toggle removed
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
  console.log('[Ambient] Handling blink');
  blinkTimer -= delta;
  if (blinkTimer <= 0) {
    const mgr = currentVRM.expressionManager || currentVRM.blendShapeProxy;
    if (shouldUseBlendfaces()) {
      blendfaces.set('blink', 1.0, 'live', 150);
    } else {
      mgr.setValue('blink', 1.0);
      mgr.update();
      console.log('[Blink] Set to 1.0, value now:', mgr.getValue('blink'));
      setTimeout(() => {
        mgr.setValue('blink', 0.0);
        mgr.update();
        console.log('[Blink] Set to 0.0, value now:', mgr.getValue('blink'));
      }, 150);
    }
    blinkTimer = 2 + Math.random() * 3;
  }
}

function handleGaze(delta) {
  console.log('[Ambient] Handling gaze');
  gazeTimer -= delta;
  if (gazeTimer <= 0) {
    gazeDirection = (Math.random() - 0.5) * 0.2;
    gazeTimer = 2 + Math.random() * 2;
  }
  let head = currentVRM.humanoid.getNormalizedBoneNode('head');
  if (!head) {
    head = vrm.scene.getObjectByName('Head');
    if (head) console.log('[Gaze] Fell back to raw Head bone');
  }
  if (head) {
    head.rotation.y += (gazeDirection - head.rotation.y) * 0.05;
  } else {
    console.warn('[Ambient] No head bone found (normalized or raw)');
  }
}

function handleBreath(t) {
  console.log('[Ambient] Handling breath');
  let chest = currentVRM.humanoid.getNormalizedBoneNode('chest');
  if (!chest) {
    chest = currentVRM.humanoid.getNormalizedBoneNode('upper_chest');
    if (chest) console.log('[Breath] Fell back to upper_chest');
  }
  if (!chest) {
    chest = vrm.scene.getObjectByName('Spine1') || vrm.scene.getObjectByName('Spine2');
    if (chest) console.log('[Breath] Fell back to raw Spine1/2 bone');
  }
  if (chest) {
    chest.position.y = chestBaseY + Math.sin(t * 0.5) * 0.01; // Amped for visibility
  } else {
    console.warn('[Ambient] No chest/upper_chest bone found (normalized or raw)');
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
  vrmGroup.add(vrm.scene);
  vrm.scene.rotation.y = Math.PI;

  controls.target.set(0, 1.6, 0);
  controls.update();

  initAvatar(vrm);

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
  if (mgr) console.log('[VRM] Expressions:', mgr.getExpressionNames());
});

/* Viseme ID map from backend */
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
  // Last-chance fallbacks if your map doesn’t list vowels explicitly
  const fallback = { aa: 'A', ee: 'E', ih: 'I', oh: 'O', ou: 'U' }[name];
  if (fallback && available.has(fallback)) return fallback;
  // If still nothing, return a default to avoid skipping (e.g., neutral as fallback)
  console.warn('[Viseme] No exact match for', name, 'using neutral as fallback, available:', [...available]);
  return 'neutral'; // Default to neutral if no match, ensuring some movement
}

/* Prevent overlapping TTS calls with abort */
let ttsInflight = false;
let isSpeaking = false;
let ttsAbortController = null;
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

    const expression = body.expression || 'neutral';
    setExpressionPersistent(expression, 1.0, DECAY_EMO);

    audio.addEventListener('play', () => {
      isSpeaking = true;
      typeOut(agentDiv, 'agent', text, durationMs);

      if (shouldUseBlendfaces() && blendfaces) {
        const keys = visemes
          .map(v => {
            const src = visemeMap[v.VisemeId];
            if (!src) return null;
            const name = resolveMouth(src);
            if (!name) return null;
            console.log(`[Viseme] ID ${v.VisemeId} → ${name} at ${v.TimeMs}ms`);
            return { t: v.TimeMs / 1000, values: { [name]: 1 } };
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
          console.log(`[Viseme] ID ${v.VisemeId} → ${name} at ${v.TimeMs}ms`);
          setTimeout(() => {
            setExpressionPersistent(name, 1, DECAY_VISEME);
            currentVisemeName = name; // Track last viseme
            currentVisemeWeight = 1;  // Track last weight
          }, v.TimeMs);
        });
      }
    }, { once: true });

    audio.addEventListener('ended', () => {
      isSpeaking = false;
      currentVisemeName = null; // Reset on end
      currentVisemeWeight = 0;
    });

    audio.play().catch(err => {
      console.warn('[TTS] Audio play failed:', err);
      typeOut(agentDiv, 'agent', text, durationMs);
      isSpeaking = false;
      currentVisemeName = null;
      currentVisemeWeight = 0;
    });

  } catch (err) {
    if (err.name !== 'AbortError' && err.message !== 'TTS request timeout') {
      console.error('[TTS] Error:', err);
    } else if (err.message === 'TTS request timeout') {
      console.warn('[TTS] Timeout after 60s');
    }
    updateChatEntry(agentDiv, 'agent', text);
    isSpeaking = false;
    currentVisemeName = null;
    currentVisemeWeight = 0;
  } finally {
    ttsInflight = false;
    ttsAbortController = null;
  }
}

/* === Chat + TTS (type as speaking) === */
function addChatEntry(role, text) {
  const log = document.getElementById('chat-log');
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
    span.textContent = text.slice(0, count);
    if (count < total) requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

async function sendToAgent() {
  const inputEl = document.getElementById('agentInput');
  const msg = inputEl.value.trim();
  if (!msg) {
    addChatEntry('agent', '[Please enter a message]');
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
      .toString().trim();
    if (!reply) {
      addChatEntry('agent', '[No response]');
      return;
    }

    const agentDiv = addChatEntry('agent', '');
    await speakAndType(reply, agentDiv);
  } catch (err) {
    console.error('[Agent Error]', err);
    addChatEntry('agent', '[Error contacting Agent]');
  }
}

/* === Mic button === */
function initMicButton() {
  const micBtn = document.getElementById('micBtn');
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
      document.getElementById('agentInput').value = e.results[0][0].transcript;
      sendToAgent();
    };
    recog.onerror = e => addChatEntry('agent', `[Mic error: ${e.error}]`);
    recog.start();
  });
}

/* === UI wiring === */
function initUI() {
  document.getElementById('agentSendBtn').addEventListener('click', sendToAgent);
  initMicButton();
}
initUI();

/* === Animation loop === */
function animate() {
  requestAnimationFrame(animate);
  const dt = clock.getDelta();
  const t = clock.getElapsedTime();

  if (currentVRM) {
    currentVRM.update(dt);

    const mgr = currentVRM.expressionManager || currentVRM.blendShapeProxy;

    // Default neutral "happy" expression (ambient idle)
    if (!isSpeaking && Object.keys(activeExpr).length === 0) {
      mgr.setValue('happy', 1.0);
      mgr.setValue('neutral', 0.0);
    }

    // Spine sway
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

    // Expressions/visemes
    applyExpressions(dt);
    if (shouldUseBlendfaces()) blendfaces.update(dt);

    // Ambient: breathe → gaze → blink
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