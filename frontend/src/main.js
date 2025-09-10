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
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(25, window.innerWidth / window.innerHeight, 0.1, 200);
camera.position.set(0, 1.6, 4.5);
camera.updateProjectionMatrix();

const renderer = new THREE.WebGLRenderer({
  antialias: true,
  canvas: document.getElementById('c')
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;

/* OrbitControls */
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 1.6, 0);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.minDistance = 1.0;
controls.maxDistance = 6.0;
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
scene.add(vrmGroup);
scene.add(skyGroup);

let currentVRM;
let blendfaces;
let blendfacesWSHandler = null;
const clock = new THREE.Clock();

/* Load skybox */
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
          const tex = child.material.map || child.material.emissiveMap || null;
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

/* Expression helpers */
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
  for (const [m, st] of Object.entries(activeExpr)) {
    st.weight = THREE.MathUtils.lerp(st.weight, 0, st.decay * delta);
    if (st.weight < 0.01) {
      delete activeExpr[m];
      continue;
    }
    const mgr = currentVRM.expressionManager || currentVRM.blendShapeProxy;
    const curr = mgr.getValue(m) || 0;
    const blend = THREE.MathUtils.lerp(curr, st.weight, SMOOTH);
    mgr.setValue(m, blend);
  }
  const mgr = currentVRM.expressionManager || currentVRM.blendShapeProxy;
  mgr.update();
}

function shouldUseBlendfaces() {
  return !!blendfaces && (!blendfacesToggle || blendfacesToggle.checked);
}

/* WebSocket for visemes and blendshapes
   Payload example:
   { type: "blendshapes", audioUrl, expression, visemes: [{ VisemeId, TimeMs }, ...] }
*/
const wsClient = new WSClient({
  url: `wss://${window.location.host}/ws`,
  onOpen: () => console.log('WS connected'),
  onMessage: data => {
    // Audio from WS if present
    const audioUrl = data.audioUrl || data.audio;
    if (audioUrl) {
      new Audio(audioUrl).play().catch(e => console.warn('WS audio error', e));
    }

    // Expression cue
    if (data.expression) {
      setExpressionPersistent(data.expression, 1.0, DECAY_EMO);
    }

    // Visemes batch to Blendfaces bridge
    if (Array.isArray(data.visemes) && blendfacesWSHandler) {
      const values = {};
      for (const v of data.visemes) values[`viseme_${v.VisemeId}`] = 1;
      blendfacesWSHandler({ type: 'blendshapes', values });
    }

    // Legacy values bag
    if (data.type === 'blendshapes' && data.values) {
      for (const [n, w] of Object.entries(data.values)) {
        setExpressionPersistent(n, Number(w), DECAY_EMO);
      }
    }

    // Single viseme
    if (data.type === 'viseme' && data.name) {
      setExpressionPersistent(data.name, data.weight ?? 1, DECAY_VISEME);
    }
  },
  onClose: () => console.log('WS disconnected')
});
wsClient.connect();

function sanitizeForTTS(s) {
  if (!s) return '';

  // 1) Remove the exact marker "[No response]" without regex
  let t = s.split('[No response]').join('').trim();

  // 2) Remove supplementary-plane code points (most emoji/pictographs), no regex
  let noEmoji = '';
  for (const ch of t) {
    const cp = ch.codePointAt(0);
    if (cp !== undefined && cp <= 0xFFFF) {
      noEmoji += ch;
    }
  }

  // 3) Collapse whitespace (space, tab, CR, LF, FF, VT) without regex
  let out = '';
  let inSpace = false;
  for (let i = 0; i < noEmoji.length; i++) {
    const c = noEmoji[i];
    const isWS = c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '\f' || c === '\v';
    if (isWS) {
      if (!inSpace) {
        out += ' ';
        inSpace = true;
      }
    } else {
      out += c;
      inSpace = false;
    }
  }

  // Trim ends
  return out.trim();
}




/* === Load VRM and Blendfaces === */
function initAvatar(vrm) {
  const chest = vrm?.humanoid?.getNormalizedBoneNode?.('Chest');
  if (chest) chestBaseY = chest.position.y;
  nextBlink = clock.getElapsedTime() + 3 + Math.random() * 2;
}

loadVRM('/Assets/Sentali2.vrm', scene, camera, controls, (vrm) => {
  currentVRM = vrm;
  vrmGroup.add(vrm.scene);
  vrm.scene.rotation.y = Math.PI;

  controls.target.set(0, 1.6, 0);
  controls.update();

  initAvatar(vrm); // <-- ensure ambient baselines are set

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

async function speakAndType(text, agentDiv) {
  if (ttsInflight) {
    console.warn('[TTS] Request in-flight; skipping new request');
    updateChatEntry(agentDiv, 'agent', text);
    return;
  }
  ttsInflight = true;
  try {
    const clean = sanitizeForTTS(text);
    const res = await fetch(`${backendBase}/api/tts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: clean })
    });

    if (!res.ok) {
      console.error(`[TTS Error] HTTP ${res.status}`);
      updateChatEntry(agentDiv, 'agent', text);
      return;
    }

    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
      console.error('[TTS Error] Expected JSON but got', contentType);
      updateChatEntry(agentDiv, 'agent', text);
      return;
    }

    const body = await res.json().catch(err => {
      console.error('[TTS Error] Failed to parse JSON:', err);
      return null;
    });
    if (!body?.audioUrl) {
      console.warn('[TTS] No audioUrl in response', body);
      updateChatEntry(agentDiv, 'agent', text);
      return;
    }

    const audio = new Audio(body.audioUrl);
    audio.crossOrigin = 'anonymous';

    await new Promise(resolve => {
      const done = () => resolve();
      audio.addEventListener('loadedmetadata', done, { once: true });
      audio.addEventListener('error', done, { once: true });
    });

    const duration =
      Number.isFinite(audio.duration) && audio.duration > 0
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
    const count = Math.max(0, Math.floor(total * t));
    span.textContent = text.slice(0, count);
    if (count < total) requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}
async function speakAndType(text, agentDiv) {
  try {
    const clean = sanitizeForTTS(text);
    const res = await fetch(`${backendBase}/api/tts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: clean })
    });

    if (!res.ok) {
      console.error(`[TTS Error] HTTP ${res.status}`);
      updateChatEntry(agentDiv, 'agent', text);
      return;
    }

    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
      console.error('[TTS Error] Expected JSON but got', contentType);
      updateChatEntry(agentDiv, 'agent', text);
      return;
    }

    const body = await res.json().catch(err => {
      console.error('[TTS Error] Failed to parse JSON:', err);
      return null;
    });
    if (!body?.audioUrl) {
      console.warn('[TTS] No audioUrl in response', body);
      updateChatEntry(agentDiv, 'agent', text);
      return;
    }

    const audio = new Audio(body.audioUrl);
    audio.crossOrigin = 'anonymous';

    await new Promise(resolve => {
      const done = () => resolve();
      audio.addEventListener('loadedmetadata', done, { once: true });
      audio.addEventListener('error', done, { once: true });
    });

    const duration =
      Number.isFinite(audio.duration) && audio.duration > 0
        ? audio.duration * 1000
        : Math.max(1500, Math.min(12000, text.split(/\s+/).length / 2.5 * 1000));

    audio.addEventListener('play', () => {
      typeOut(agentDiv, 'agent', text, duration);
    }, { once: true });

    audio.play().catch(err => {
      console.warn('[TTS] Audio play failed:', err);
      updateChatEntry(agentDiv, 'agent', text);
    });
  } catch (err) {
    console.error('[TTS Error]', err);
    updateChatEntry(agentDiv, 'agent', text);
  }
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

    const isJson = (chatRes.headers.get('content-type') || '').includes('application/json');
    const chatBody = isJson ? await chatRes.json().catch(() => null)
                            : await chatRes.text().catch(() => '');
    if (!chatRes.ok) {
      console.error('[Chat Error]', chatRes.status, chatBody || '(no body)');
      addChatEntry('agent', '[Error contacting Agent]');
      return;
    }

    const replyRaw = (chatBody && (chatBody.text ?? chatBody.reply ?? chatBody.message)) || '';
    const reply = replyRaw.toString().trim();
    if (!reply) {
      addChatEntry('agent', '[No response]');
      return;
    }

    const agentDiv = addChatEntry('agent', ''); // placeholder
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
      const t = e.results[0][0].transcript;
      document.getElementById('agentInput').value = t;
      sendToAgent();
    };

    recog.onerror = e => {
      addChatEntry('agent', `[Mic error: ${e.error}]`);
    };

    recog.start();
  });
}

/* === UI wiring === */
function initUI() {
  document.getElementById('agentSendBtn')
    .addEventListener('click', sendToAgent);
  initMicButton();
}
initUI();

/* === Ambient state === */
let chestBaseY = 0;
let nextBlink = 0;                      // still set in initAvatar
let blinkTimer = 2 + Math.random() * 3;
let gazeTimer = 2 + Math.random() * 2;
let gazeDirection = 0;

/* === Ambient behaviours === */
function handleBlink(delta) {
  blinkTimer -= delta;
  if (blinkTimer <= 0) {
    const mgr = currentVRM.expressionManager || currentVRM.blendShapeProxy;
    mgr.setValue('Blink', 1.0);
    setTimeout(() => {
      mgr.setValue('Blink', 0.0);
    }, 150);
    blinkTimer = 2 + Math.random() * 3;
  }
}

function handleGaze(delta) {
  gazeTimer -= delta;
  if (gazeTimer <= 0) {
    gazeDirection = (Math.random() - 0.5) * 0.2;  // small head turn
    gazeTimer = 2 + Math.random() * 2;
  }
  const head = currentVRM.humanoid.getNormalizedBoneNode('Head');
  if (head) {
    head.rotation.y += (gazeDirection - head.rotation.y) * 0.05;
  }
}

function handleBreath(t) {
  const chest = currentVRM.humanoid.getNormalizedBoneNode('Chest');
  if (chest) {
    chest.position.y = chestBaseY + Math.sin(t * 0.5) * 0.002;
  }
}

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

    // Idle sway (spine)
    const spine = currentVRM.humanoid.getNormalizedBoneNode('Spine');
    if (spine) {
      spine.rotation.y = Math.sin(t * 0.5 * Math.PI * 2) * 0.02;
    }

    // 1) Apply any queued blendshape expressions / visemes
    applyExpressions(dt);
    if (shouldUseBlendfaces()) {
      blendfaces.update(dt);
    }

    // 2) Run ambient breathing, gaze, then blink
    handleBreath(t);
    handleGaze(dt);
    handleBlink(dt);
  }

  controls.update();
  renderer.render(scene, camera);
}

// Start the loop
animate();

/* === Resize === */
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});