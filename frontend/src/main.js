import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { expressionMap } from './vrmMapping.js';
import { loadVRM } from './vrmUtils.js';
import { loadHDRSkybox } from './SkyboxLoader.js';
import { WSClient } from './ws.js';
import { BlendfacesController } from './blendfaces.js';

const blendfacesToggle = document.getElementById('blendfacesToggle');
const backendBase = '';    // e.g. '' or '/.auth/me' if you proxy auth

/* === Scene setup === */
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(30, window.innerWidth/window.innerHeight, 0.1, 20);
camera.position.set(0, 1.4, 1.5);

const renderer = new THREE.WebGLRenderer({
  antialias: true,
  canvas: document.getElementById('c')
});
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setSize(window.innerWidth, window.innerHeight);

loadHDRSkybox(renderer, scene, camera, '/skybox/background1.hdr');

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 1.4, 0);
controls.update();

scene.add(new THREE.AmbientLight(0xffffff, 0.3));
scene.add(new THREE.GridHelper(10, 10));

const lights = [
  new THREE.DirectionalLight(0xffffff, 1.2),
  new THREE.DirectionalLight(0xffffff, 0.6),
  new THREE.DirectionalLight(0xffffff, 0.8)
];
lights[0].position.set( 0.5, 1, 0.8 );
lights[1].position.set(-0.5, 0.8,-0.8 );
lights[2].position.set( 0,   1,-1    );
lights.forEach(l=> scene.add(l));

let currentVRM, blendfaces, blendfacesWSHandler;
const clock = new THREE.Clock();

/* === Load VRM and Blendfaces === */
loadVRM('/Assets/Sentali2.vrm', scene, camera, controls, (vrm) => {
  currentVRM = vrm;
  vrm.scene.rotation.y = Math.PI;
  controls.target.set(0,1.4,0);
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

function setExpressionPersistent(name, weight, decay=DECAY_EMO) {
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

/* === WebSocket for visemes & blendshapes === */
const wsClient = new WSClient({
  url: `wss://${window.location.host}/ws`,
  onOpen: ()=> console.log('✅ WS connected'),
  onMessage: data => {
    if (data.type === 'blendshape') {
      setExpressionPersistent(data.name, data.weight ?? 1, DECAY_EMO);
    }
    if (data.type === 'blendshapes') {
      for (const [n,w] of Object.entries(data.values)) {
        setExpressionPersistent(n, Number(w), DECAY_EMO);
      }
    }
    if (data.type === 'viseme') {
      setExpressionPersistent(data.name, data.weight ?? 1, DECAY_VISEME);
    }
    if (data.audio) {
      // optional: if your server pushes an audio URL to play
      const url = data.audio.startsWith('/') ? `${backendBase}${data.audio}` : data.audio;
      new Audio(url).play().catch(e=>console.warn(e));
    }
  },
  onClose: ()=> console.log('❌ WS disconnected')
});
wsClient.connect();

/* === Chat + TTS integration === */
async function speak(text) {
  try {
    const res = await fetch(`${backendBase}/api/tts`, {
      method:'POST',
      headers:{ 'Content-Type':'application/json' },
      body: JSON.stringify({ text })
    });
    if (!res.ok) throw new Error(`TTS failed ${res.status}`);
    const blob = await res.blob();
    const url  = URL.createObjectURL(blob);
    const audio = new Audio(url);
    audio.crossOrigin = 'anonymous';
    await audio.play();
  }
  catch(err) {
    console.error('[TTS Error]', err);
  }
}

async function sendToAgent() {
  const inputEl = document.getElementById('agentInput');
  const msg = inputEl.value.trim();
  if (!msg) return;
  addChatEntry('user', msg);
  inputEl.value = '';

  try {
    // 1) Chat call → JSON { text }
    const chatRes = await fetch(`${backendBase}/api/chat`, {
      method:'POST',
      headers:{ 'Content-Type':'application/json' },
      body: JSON.stringify({ text: msg })
    });
    if (!chatRes.ok) throw new Error(`Chat failed ${chatRes.status}`);
    const chatJson = await chatRes.json();
    const reply = chatJson.text || '[No response]';
    addChatEntry('agent', reply);

    // 2) TTS playback (lip-sync via WS visemes)
    await speak(reply);
  }
  catch(err) {
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
  micBtn.addEventListener('click', ()=>{
    const recog = new webkitSpeechRecognition();
    recog.lang = 'en-US';
    recog.interimResults = false;
    recog.maxAlternatives = 1;

    recog.onresult = e => {
      const t = e.results[0][0].transcript;
      document.getElementById('agentInput').value = t;
      sendToAgent();
    };
    recog.onerror = e => addChatEntry('agent', `[Mic error: ${e.error}]`);
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

/* === Animation loop === */
function animate() {
  requestAnimationFrame(animate);
  const dt = clock.getDelta();
  if (currentVRM) {
    currentVRM.update(dt);
    applyExpressions(dt);
    if (shouldUseBlendfaces()) blendfaces.update(dt);
  }
  controls.update();
  renderer.render(scene, camera);
}
animate();

/* === Handle resize === */
window.addEventListener('resize', ()=>{
  camera.aspect = window.innerWidth/window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});