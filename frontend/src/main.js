import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { expressionMap } from './vrmMapping.js';
import { loadVRM } from './vrmUtils.js';
import { loadHDRSkybox } from './SkyboxLoader.js';
import { WSClient } from './ws.js';
import { BlendfacesController } from './blendfaces.js';

const blendfacesToggle = document.getElementById('blendfacesToggle');
const backendBase = '';

/* === Scene setup === */
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(30, window.innerWidth / window.innerHeight, 0.1, 20);
camera.position.set(0, 1.4, 1.5);

const renderer = new THREE.WebGLRenderer({ antialias: true, canvas: document.getElementById('c') });
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setSize(window.innerWidth, window.innerHeight);

loadHDRSkybox(renderer, scene, camera, '/skybox/background1.hdr');

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 1.4, 0);
controls.update();

scene.add(new THREE.AmbientLight(0xffffff, 0.3));
scene.add(new THREE.GridHelper(10, 10));

const directionalLights = [
  new THREE.DirectionalLight(0xffffff, 1.2),
  new THREE.DirectionalLight(0xffffff, 0.6),
  new THREE.DirectionalLight(0xffffff, 0.8)
];
directionalLights[0].position.set(0.5, 1, 0.8);
directionalLights[1].position.set(-0.5, 0.8, -0.8);
directionalLights[2].position.set(0, 1, -1);
directionalLights.forEach(light => scene.add(light));

let currentVRM;
let blendfaces;
let blendfacesWSHandler = null;
const clock = new THREE.Clock();

/* === Load VRM === */
loadVRM('/Assets/Sentali2.vrm', scene, camera, controls, (vrm) => {
  currentVRM = vrm;
  vrm.scene.rotation.y = Math.PI;
  controls.target.set(0, 1.4, 0);
  controls.update();

  blendfaces = new BlendfacesController(vrm, {
    expressionMap,
    smooth: 0.3,
    decay: 1.5,
    rest: { blink: 0.0, neutral: 1.0 }
  });

  blendfaces.attachWS((cb) => {
    blendfacesWSHandler = cb;
  });
});

/* === Expression handling === */
const activeExpressions = {};
const DECAY_RATE_EMOTION = 3.0;
const DECAY_RATE_VISEME = 10.0;
const SMOOTHING = 0.4;

function setExpressionPersistent(name, weight, decayRate = DECAY_RATE_EMOTION) {
  const mapped = expressionMap[name] ?? name;
  activeExpressions[mapped] = { weight, decayRate };
}

function applyExpressions(delta) {
  if (!currentVRM) return;

  for (const [mapped, state] of Object.entries(activeExpressions)) {
    state.weight = THREE.MathUtils.lerp(state.weight, 0, state.decayRate * delta);
    if (state.weight < 0.01) {
      delete activeExpressions[mapped];
      continue;
    }
    if (currentVRM.expressionManager) {
      const current = currentVRM.expressionManager.getValue(mapped) || 0;
      const blended = THREE.MathUtils.lerp(current, state.weight, SMOOTHING);
      currentVRM.expressionManager.setValue(mapped, blended);
    } else if (currentVRM.blendShapeProxy) {
      const current = currentVRM.blendShapeProxy.getValue(mapped) || 0;
      const blended = THREE.MathUtils.lerp(current, state.weight, SMOOTHING);
      currentVRM.blendShapeProxy.setValue(mapped, blended);
    }
  }

  if (currentVRM.expressionManager) currentVRM.expressionManager.update();
  else if (currentVRM.blendShapeProxy) currentVRM.blendShapeProxy.update();
}

function shouldUseBlendfaces() {
  return !!blendfaces && (!!blendfacesToggle ? blendfacesToggle.checked : true);
}

/* === WebSocket client === */
const wsClient = new WSClient({
  url: `wss://${window.location.host}/ws`,
  onOpen: () => console.log('✅ WS connected — waiting for cues...'),
  onMessage: async (data) => {
    console.log("[WS RAW]", JSON.stringify(data));

    if (data?.type === 'blendshape') {
      setExpressionPersistent(data.name, typeof data.weight === 'number' ? data.weight : 1.0, DECAY_RATE_EMOTION);
    }
    if (data?.type === 'blendshapes') {
      for (const [name, weight] of Object.entries(data.values)) {
        setExpressionPersistent(name, Number(weight), DECAY_RATE_EMOTION);
      }
    }
    if (data?.type === 'viseme') {
      const mapped = expressionMap[data.name] ?? data.name;
      if (currentVRM?.expressionManager) {
        currentVRM.expressionManager.setValue(mapped, data.weight ?? 1.0);
        currentVRM.expressionManager.update();
      } else if (currentVRM?.blendShapeProxy) {
        currentVRM.blendShapeProxy.setValue(mapped, data.weight ?? 1.0);
        currentVRM.blendShapeProxy.update();
      }
    }
    if (data?.audio) {
      try {
        const audioUrl = data.audio.startsWith('/') ? `${backendBase}${data.audio}` : data.audio;
        const audio = new Audio(audioUrl);
        audio.crossOrigin = 'anonymous';
        await audio.play();
      } catch (err) {
        console.warn("[AUDIO] Failed to play:", data.audio, err);
      }
    }
  },
  onClose: () => console.log('❌ WS disconnected')
});
wsClient.connect();

/* === Ambient behaviours === */
let blinkTimer = 2 + Math.random() * 3;
let gazeTimer = 2 + Math.random() * 2;
let gazeDirection = 0;

function handleBlink(delta) {
  blinkTimer -= delta;
  if (blinkTimer <= 0) {
    setExpressionPersistent('blink', 1.0, DECAY_RATE_EMOTION);
    blinkTimer = 2 + Math.random() * 3;
  }
}

function handleGaze(delta) {
  gazeTimer -= delta;
  if (gazeTimer <= 0) {
    gazeDirection = (Math.random() - 0.5) * 0.4;
    gazeTimer = 2 + Math.random() * 2;
  }
  const head = currentVRM?.humanoid?.getNormalizedBoneNode('head');
  if (head) {
    head.rotation.y = THREE.MathUtils.lerp(head.rotation.y, gazeDirection, 0.05);
  }
}

function handleBreath() {
  const chest = currentVRM?.humanoid?.getNormalizedBoneNode('chest');
  if (chest) {
    chest.position.y = Math.sin(clock.elapsedTime * 1.5) * 0.005;
  }
}

/* === Chat + Agent integration === */
async function sendToAgent() {
  const inputEl = document.getElementById("agentInput");
  const input = inputEl.value.trim();
  if (!input) return;

  addChatEntry("user", input);
  inputEl.value = "";

  try {
    const res = await fetch(`${backendBase}/api/tts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input)
    });
    const json = await res.json();
    addChatEntry("agent", json.text || "[No response]");
  } catch (err) {
    console.error("[Agent Error]", err);
    addChatEntry("agent", "[Error contacting Agent]");
  }
}

function addChatEntry(role, text) {
  const log = document.getElementById("chat-log");
  const div = document.createElement("div");
  div.className = "chat-entry";
  div.innerHTML = `<span class="chat-${role}">${role}:</span> ${text}`;
  log.appendChild(div);
  log.scrollTop = log.scrollHeight;
}

/* === Mic button speech-to-text === */
function initMicButton() {
  const micBtn = document.getElementById("micBtn");
  if (!('webkitSpeechRecognition' in window)) {
    micBtn.disabled = true;
    micBtn.title = "Speech recognition not supported in this browser.";
    return;
  }
  micBtn.addEventListener("click", () => {
    const recognition = new webkitSpeechRecognition();
    recognition.lang = "en-US";
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;

    recognition.onresult = (event) => {
      const transcript = event.results[0][0].transcript;
      document.getElementById("agentInput").value = transcript;
      sendToAgent();
    };

    recognition.onerror = (err) => {
      console.error("[Mic Error]", err);
      addChatEntry("agent", "[Mic error: " + err.error + "]");
    };

    recognition.onstart = () => {
      console.log("[Mic] Listening...");
    };

    recognition.onend = () => {
      console.log("[Mic] Stopped listening");
    };

    recognition.start();
  });
}

/* === Wire up UI events === */
function initUIBindings() {
  document.getElementById("agentSendBtn")
    .addEventListener("click", sendToAgent);

  initMicButton();
}

// Call this once after DOM is ready
initUIBindings();

/* ---------- Animation loop ---------- */
function animate() {
  requestAnimationFrame(animate);
  const delta = clock.getDelta();

  if (currentVRM) {
    currentVRM.update(delta);
    applyExpressions(delta);
    handleBlink(delta);
    handleGaze(delta);
    handleBreath();
    if (shouldUseBlendfaces()) blendfaces.update(delta);
  }

  controls.update();
  renderer.render(scene, camera);
}
animate();

/* ---------- Resize ---------- */
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});
