// main.js
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { expressionMap } from './vrmMapping.js';
import { loadVRM } from './vrmUtils.js';
import { WSClient } from './ws.js';
import { BlendfacesController } from './blendfaces.js';
import { loadGLBSkybox } from './SkyBoxGLBLoader.js';

const blendfacesToggle = document.getElementById('blendfacesToggle');
// Deployed Azure App Service base URL
const backendBase = 'https://sentali-app-6926-e4gwhtajg3dfaphs.eastus2-01.azurewebsites.net';

/* Scene setup */
const scene    = new THREE.Scene();
const camera   = new THREE.PerspectiveCamera(25, window.innerWidth / window.innerHeight, 0.1, 200);
const renderer = new THREE.WebGLRenderer({ antialias: true, canvas: document.getElementById('c') });

camera.position.set(0, 1.6, 4.5);
camera.updateProjectionMatrix();

renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace    = THREE.SRGBColorSpace;
renderer.toneMapping         = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;

/* OrbitControls */
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 1.6, 0);
controls.enableDamping  = true;
controls.dampingFactor  = 0.08;
controls.minDistance    = 1.0;
controls.maxDistance    = 6.0;
controls.update();

/* Lighting */
scene.add(new THREE.AmbientLight(0xffffff, 0.3));
const lights = [
  new THREE.DirectionalLight(0xffffff, 1.2),
  new THREE.DirectionalLight(0xffffff, 0.6),
  new THREE.DirectionalLight(0xffffff, 0.8)
];
lights[0].position.set(0.5, 1, 0.8);
lights[1].position.set(-0.5, 0.8, -0.8);
lights[2].position.set(0, 1, -1);
lights.forEach(l => scene.add(l));

/* Groups */
const vrmGroup = new THREE.Group();
const skyGroup = new THREE.Group();
scene.add(vrmGroup, skyGroup);

let currentVRM;
let blendfaces;
let blendfacesWSHandler = null;
const clock = new THREE.Clock();

/* Load skybox (unchanged) */
(async () => {
  // … your existing skybox loader …
})();

/* Expression helpers (unchanged) */
const activeExpr   = {};
const DECAY_EMO    = 3.0;
const DECAY_VISEME = 10.0;
const SMOOTH       = 0.4;
// … setExpressionPersistent, applyExpressions, shouldUseBlendfaces …

/* WebSocket for visemes/blendshapes (unchanged) */
const wsClient = new WSClient({
  url: `wss://${window.location.host}/ws`,
  onOpen:  () => console.log('WS connected'),
  onMessage: data => {
    // … your existing onMessage logic …
  },
  onClose: () => console.log('WS disconnected')
});
wsClient.connect();

/* sanitizeForTTS (unchanged) */
function sanitizeForTTS(s) {
  if (!s) return '';
  // … your existing sanitizer logic …
  return s.trim();
}

/* === Ambient state & behaviours (countdown style) === */
let chestBaseY    = 0;
let blinkTimer    = 2 + Math.random() * 3;
let gazeTimer     = 2 + Math.random() * 2;
let gazeDirection = 0;

function handleBlink(delta) {
  blinkTimer -= delta;
  if (blinkTimer <= 0) {
    const mgr = currentVRM.expressionManager || currentVRM.blendShapeProxy;
    mgr.setValue('Blink', 1.0);
    setTimeout(() => mgr.setValue('Blink', 0.0), 150);
    blinkTimer = 2 + Math.random() * 3;
  }
}

function handleGaze(delta) {
  gazeTimer -= delta;
  if (gazeTimer <= 0) {
    gazeDirection = (Math.random() - 0.5) * 0.2;
    gazeTimer = 2 + Math.random() * 2;
  }
  const head = currentVRM.humanoid.getNormalizedBoneNode('Head');
  if (head) head.rotation.y += (gazeDirection - head.rotation.y) * 0.05;
}

function handleBreath(t) {
  const chest = currentVRM.humanoid.getNormalizedBoneNode('Chest');
  if (chest) chest.position.y = chestBaseY + Math.sin(t * 0.5) * 0.002;
}

/* === Load VRM + initialize ambient timers (only once) === */
function initAvatar(vrm) {
  const chest = vrm.humanoid.getNormalizedBoneNode('Chest');
  if (chest) chestBaseY = chest.position.y;
  // reset countdowns
  blinkTimer    = 2 + Math.random() * 3;
  gazeTimer     = 2 + Math.random() * 2;
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
});

/* === Prevent overlapping TTS calls === */
let ttsInflight = false;

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
    const t       = Math.min(1, durationMs > 0 ? elapsed / durationMs : 1);
    const count   = Math.floor(total * t);
    span.textContent = text.slice(0, count);
    if (count < total) requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

async function speakAndType(text, agentDiv) {
  if (ttsInflight) {
    console.warn('[TTS] Request in-flight; skipping new request');
    updateChatEntry(agentDiv, 'agent', text);
    return;
  }
  ttsInflight = true;
  try {
    const clean = sanitizeForTTS(text);
    const res   = await fetch(`${backendBase}/api/tts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: clean })
    });

    if (!res.ok) {
      console.error(`[TTS Error] HTTP ${res.status}`);
      updateChatEntry(agentDiv, 'agent', text);
      return;
    }

    const body = await res.json().catch(() => null);
    if (!body?.audioUrl) {
      console.warn('[TTS] No audioUrl in response', body);
      updateChatEntry(agentDiv, 'agent', text);
      return;
    }

    const audio = new Audio(body.audioUrl);
    audio.crossOrigin = 'anonymous';
    await new Promise(r => {
      audio.addEventListener('loadedmetadata', r, { once: true });
      audio.addEventListener('error', r, { once: true });
    });

    const duration = (audio.duration > 0)
      ? audio.duration * 1000
      : Math.max(1500, Math.min(12000, text.split(/\s+/).length / 2.5 * 1000));

    audio.addEventListener('play', () => {
      typeOut(agentDiv, 'agent', text, duration);
    }, { once: true });

    audio.play().catch(err => {
      console.warn('[TTS] Audio play failed:', err);
      updateChatEntry(agentDiv, 'agent', text);
    });
  } finally {
    ttsInflight = false;
  }
}

async function sendToAgent() {
  const inputEl = document.getElementById('agentInput');
  const msg     = inputEl.value.trim();
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
    const isJson   = chatRes.headers.get('content-type')?.includes('application/json');
    const chatBody = isJson
      ? await chatRes.json().catch(() => null)
      : await chatRes.text().catch(() => '');

    if (!chatRes.ok) {
      console.error('[Chat Error]', chatRes.status, chatBody);
      addChatEntry('agent', '[Error contacting Agent]');
      return;
    }

    const reply = (chatBody?.text ?? chatBody?.reply ?? chatBody?.message ?? '')
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
  }
}

/* === Mic button & UI wiring === */
function initMicButton() {
  const micBtn = document.getElementById('micBtn');
  if (!('webkitSpeechRecognition' in window)) {
    micBtn.disabled = true;
    micBtn.title    = 'Speech recognition not supported';
    return;
  }
  micBtn.addEventListener('click', () => {
    const recog = new webkitSpeechRecognition();
    recog.lang           = 'en-US';
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

function initUI() {
  document.getElementById('agentSendBtn').addEventListener('click', sendToAgent);
  initMicButton();
}
initUI();

/* === Animation loop === */
function animate() {
  requestAnimationFrame(animate);

  const dt = clock.getDelta();
  const t  = clock.getElapsedTime();

  if (currentVRM) {
    currentVRM.update(dt);

    // Default Joy if no active expression
    if (Object.keys(activeExpr).length === 0) {
      const mgr = currentVRM.expressionManager || currentVRM.blendShapeProxy;
      mgr.setValue('Joy', 1.0);
      mgr.setValue('Neutral', 0.0);
    }

    // Spine sway
    const spine = currentVRM.humanoid.getNormalizedBoneNode('Spine');
    if (spine) spine.rotation.y = Math.sin(t * 0.5 * Math.PI * 2) * 0.02;

    // 1) Expressions / visemes
    applyExpressions(dt);
    if (shouldUseBlendfaces()) blendfaces.update(dt);

    // 2) Ambient: breath → gaze → blink
    handleBreath(t);
    handleGaze(dt);
    handleBlink(dt);
  }

  controls.update();
  renderer.render(scene, camera);
}
animate();

/* === Resize === */
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});
