// main.js
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { expressionMap } from './vrmMapping.js';
import { loadVRM } from './vrmUtils.js';
import { WSClient } from './ws.js';
import { BlendfacesController } from './blendfaces.js';
import { loadGLBSkybox } from './SkyBoxGLBLoader.js';

const blendfacesToggle = document.getElementById('blendfacesToggle');

// Set to your deployed Azure App Service base URL
const backendBase = 'https://sentali-app-6926-e4gwhtajg3dfaphs.eastus2-01.azurewebsites.net';

/* === Scene setup === */
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

/* === OrbitControls === */
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 1.6, 0);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.minDistance = 1.0;
controls.maxDistance = 6.0;
controls.update();

/* === Lighting === */
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

/* === Separate groups for VRM and background === */
const vrmGroup = new THREE.Group();
const skyGroup = new THREE.Group();
scene.add(vrmGroup);
scene.add(skyGroup);

let currentVRM, blendfaces, blendfacesWSHandler;
const clock = new THREE.Clock();

/* === Load Skybox === */
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

/* === Load VRM and Blendfaces === */
loadVRM('/Assets/Sentali2.vrm', scene, camera, controls, (vrm) => {
  currentVRM = vrm;
  vrmGroup.add(vrm.scene);
  vrm.scene.rotation.y = Math.PI;

  controls.target.set(0, 1.6, 0);
  controls.update();

  blendfaces = new BlendfacesController(vrm, {
    expressionMap,
    smooth: 0.3,
    decay: 1.5,
    rest: { blink: 0.0, neutral: 1.0 }
  });
  blendfaces.attachWS(cb => blendfacesWSHandler = cb);
});

/* === Expressions Helpers === */
const activeExpr = {};
const DECAY_EMO = 3.0, DECAY_VISEME = 10.0, SMOOTH = 0.4;

function setExpressionPersistent(name, weight, decay = DECAY_EMO) {
  const mapped = expressionMap[name] ?? name;
  activeExpr[mapped] = { weight, decay };
}
function applyExpressions(delta) {
  if (!currentVRM) return;
  for (const [m, st] of Object.entries(activeExpr)) {
    st.weight = THREE.MathUtils.lerp(st.weight, 0, st.decay * delta);
    if (st.weight < 0.01) { delete activeExpr[m]; continue; }
    const mgr = currentVRM.expressionManager || currentVRM.blendShapeProxy;
    const curr = mgr.getValue(m) || 0;
    const blend = THREE.MathUtils.lerp(curr, st.weight, SMOOTH);
    mgr.setValue(m, blend);
  }
  const mgr = currentVRM.expressionManager || currentVRM.blendShapeProxy;
  mgr.update();
}
function shouldUseBlendfaces() {
  return blendfaces && (!blendfacesToggle || blendfacesToggle.checked);
}

/* === WebSocket for visemes & blendshapes ===
   Backend WS payload shape (from your controller):
   { type: "blendshapes", audioUrl, expression, visemes: [{ VisemeId, TimeMs }, ...] }
   Fix: handle audioUrl (previously code expected data.audio) and map visemes to values.
*/
const wsClient = new WSClient({
  url: `wss://${window.location.host}/ws`,
  onOpen: () => console.log('✅ WS connected'),
  onMessage: data => {
    // 1) Real-time audio from WS, if sent
    const audioUrl = data.audioUrl || data.audio; // support either
    if (audioUrl) {
      new Audio(audioUrl).play().catch(e => console.warn(e));
    }

    // 2) Expression mapping, if present
    if (data.expression) {
      setExpressionPersistent(data.expression, 1.0, DECAY_EMO);
    }

    // 3) Visemes support: if visemes array present, map into values for Blendfaces
    if (Array.isArray(data.visemes) && blendfacesWSHandler) {
      const values = {};
      // Simple immediate pulse for each viseme id (fallback).
      // If you want scheduled timing, we can add a scheduler later.
      for (const v of data.visemes) {
        values[`viseme_${v.VisemeId}`] = 1;
      }
      blendfacesWSHandler({ type: 'blendshapes', values });
    }

    // 4) Legacy support: if a values bag arrives, apply it directly
    if (data.type === 'blendshapes' && data.values) {
      for (const [n, w] of Object.entries(data.values)) {
        setExpressionPersistent(n, Number(w), DECAY_EMO);
      }
    }

    // 5) Single viseme
    if (data.type === 'viseme' && data.name) {
      setExpressionPersistent(data.name, data.weight ?? 1, DECAY_VISEME);
    }
  },
  onClose: () => console.log('❌ WS disconnected')
});
wsClient.connect();

function sanitizeForTTS(s) {
  if (!s) return '';
  // Drop our placeholder and trim
  let t = s.replace(/\[No response\]/g, '').trim();
  // Strip most emoji/pictographs (Azure Speech sometimes hates them; backend may reject)
  t = t.replace(/\p{Extended_Pictographic}/gu, '');
  // Collapse excessive whitespace
  t = t.replace(/\s+/g, ' ').trim();
  return t;
}

/* === Chat + TTS integration ===
   Split flow:
   - /api/chat -> reply text
   - /api/tts  -> audio + visemes for that reply
*/

async function speak(text) {
  const cleaned = sanitizeForTTS(text);
  if (!cleaned) {
    console.warn('[TTS] Skipping empty/unspeakable text');
    return;
  }

  try {
    const res = await fetch(`${backendBase}/api/tts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: cleaned })
    });

    // Always read the body so we can see the backend error message
    const contentType = res.headers.get('content-type') || '';
    const body = contentType.includes('application/json') ? await res.json().catch(() => null)
                                                          : await res.text().catch(() => '');

    if (!res.ok) {
      console.error('[TTS Error]', res.status, body || '(no body)');
      throw new Error(`TTS failed ${res.status}`);
    }

    if (body && body.audioUrl) {
      const audio = new Audio(body.audioUrl);
      audio.crossOrigin = 'anonymous';
      await audio.play();
      // HTTP viseme fallback if WS missed it
      if (Array.isArray(body.visemes) && blendfacesWSHandler) {
        const values = {};
        for (const v of body.visemes) values[`viseme_${v.VisemeId}`] = 1;
        blendfacesWSHandler({ type: 'blendshapes', values });
      }
    } else {
      console.warn('No audioUrl in TTS response', body);
    }
  } catch (err) {
    console.error('[TTS Error]', err);
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
    // 1) Get GPT reply
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
    const reply = replyRaw.toString();
    if (!reply.trim()) {
      addChatEntry('agent', '[No response]');
      return;
    }

    addChatEntry('agent', reply);

    // 2) Speak reply
    await speak(reply);

  } catch (err) {
    console.error('[Agent Error]', err);
    addChatEntry('agent', '[Error contacting Agent]');
  }
}

function addChatEntry(role, text) {
  const log = document.getElementById('chat-log');
  const div = document.createElement('div');
  div.className = 'chat-entry';
  div.innerHTML = `<span class="chat-${role}">${role}:</span> ${text}`;
  log.appendChild(div);
  log.scrollTop = log.scrollHeight;
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

// Store base chest Y position after VRM loads
let chestBaseY = 0;
let hasActiveExpression = false;
let nextBlink = 0;

function initAvatar(vrm) {
  const chest = vrm.humanoid.getNormalizedBoneNode('Chest');
  if (chest) chestBaseY = chest.position.y;
  nextBlink = clock.getElapsedTime() + 3 + Math.random() * 2;
}

// Blink updater
function updateBlink() {
  if (!currentVRM) return;
  const now = clock.getElapsedTime();
  if (now > nextBlink) {
    currentVRM.expressionManager.setValue('Blink', 1.0);
    setTimeout(() => currentVRM.expressionManager.setValue('Blink', 0.0), 150);
    nextBlink = now + 3 + Math.random() * 2;
  }
}

// === Animation loop ===
function animate() {
  requestAnimationFrame(animate);

  const dt = clock.getDelta();           // delta time for VRM update
  const t  = clock.getElapsedTime();     // elapsed time for idle motions

  if (currentVRM) {
    // ✅ Advance VRM's internal animation system (prevents T‑pose)
    currentVRM.update(dt);

    // Default Joy if no active expression
    if (!hasActiveExpression) {
      currentVRM.expressionManager.setValue('Joy', 1.0);
      currentVRM.expressionManager.setValue('Neutral', 0.0);
    }

    // Idle sway (spine)
    const spine = currentVRM.humanoid.getNormalizedBoneNode('Spine');
    if (spine) spine.rotation.y = Math.sin(t * 0.5 * Math.PI * 2) * 0.02;

    // Breathing (chest)
    const chest = currentVRM.humanoid.getNormalizedBoneNode('Chest');
    if (chest) chest.position.y = chestBaseY + Math.sin(t * 0.5) * 0.002;

    // Head/gaze idle motion
    const head = currentVRM.humanoid.getNormalizedBoneNode('Head');
    if (head) {
      head.rotation.y = Math.sin(t * 0.3) * 0.05;
      head.rotation.x = Math.sin(t * 0.5) * 0.02;
    }

    // Blinking
    updateBlink();

    // Apply any queued expressions
    applyExpressions(dt);

    // Update Blendfaces if enabled
    if (shouldUseBlendfaces()) {
      blendfaces.update(dt);
    }
  }

  controls.update();
  renderer.render(scene, camera);
}

// === Handle resize ===
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

animate();