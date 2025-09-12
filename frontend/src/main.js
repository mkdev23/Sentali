import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { expressionMap } from './vrmMapping.js';
import { loadVRM } from './vrmUtils.js';
import { WSClient } from './ws.js';
import { BlendfacesController } from './blendfaces.js';
import { loadGLBSkybox } from './SkyBoxGLBLoader.js';

// ————— Settings & Globals —————
const backendBase = 'https://sentali-app-6926-e4gwhtajg3dfaphs.eastus2-01.azurewebsites.net';

let currentVRM      = null;
let exprMgr         = null;
let vrmReady        = false;
let blendfaces      = null;
let blendfacesWS    = null;
let isSpeaking      = false;

const activeExpr    = {};
const DECAY_EMO     = 3.0;
const DECAY_VISEME  = 10.0;
const SMOOTH        = 0.4;

const clock         = new THREE.Clock();
let chestBaseY      = 0,
    blinkTimer      = 2 + Math.random()*3,
    gazeTimer       = 2 + Math.random()*2,
    gazeDirection   = 0,
    currentViseme   = null,
    currentWeight   = 0;

// ————— Renderer & Scene —————
const canvas   = document.getElementById('c');
const renderer = new THREE.WebGLRenderer({ antialias:true, canvas });
renderer.setPixelRatio(Math.min(window.devicePixelRatio,2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace    = THREE.SRGBColorSpace;
renderer.toneMapping         = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;

const scene    = new THREE.Scene();
const camera   = new THREE.PerspectiveCamera(25,window.innerWidth/window.innerHeight,0.1,200);
camera.position.set(0,1.6,4.5);

const controls = new OrbitControls(camera,renderer.domElement);
controls.target.set(0,1.6,0);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.minDistance   = 1;
controls.maxDistance   = 6;
controls.update();

scene.add(new THREE.AmbientLight(0xffffff,0.3));
[
  [0.5,1,0.8,1.2],
  [-0.5,0.8,-0.8,0.6],
  [0,1,-1,0.8]
].forEach(([x,y,z,i])=>{
  const dl = new THREE.DirectionalLight(0xffffff,i);
  dl.position.set(x,y,z);
  scene.add(dl);
});

const vrmGroup = new THREE.Group();
const skyGroup = new THREE.Group();
scene.add(vrmGroup, skyGroup);

// ————— Viseme ID → Alias —————
const visemeMap = {
  0:'neutral',1:'aa',2:'aa',3:'ih',4:'ee',
  5:'oh',6:'ou',7:'ou',8:'ee',9:'ih',
 10:'oh',11:'ou',12:'aa',13:'ee',14:'ih',
 15:'oh',16:'ou',17:'aa',18:'ee',19:'ih',
 20:'oh',21:'neutral'
};

// ————— Resolver: alias → exact VRM0 key —————
function resolveToVRMKey(v) {
  const alias = typeof v==='string'
    ? v
    : visemeMap[v.visemeId ?? v.id] ?? null;
  return alias ? expressionMap[alias] ?? null : null;
}

// ————— Blendfaces timeline builder —————
function mapVisemeForBlendfaces(v) {
  const key = resolveToVRMKey(v);
  return key ? { t:(v.timeMs||0)/1000, values:{ [key]:1 } } : null;
}

// ————— Manual scheduler —————
function scheduleVisemes(visemes,audio) {
  if (!vrmReady) return;
  const mgr = exprMgr || currentVRM.expressionManager || currentVRM.blendShapeProxy;
  if (!mgr) return;

  visemes
    .slice().sort((a,b)=> (a.timeMs||0)-(b.timeMs||0))
    .map(v=>{
      const key = resolveToVRMKey(v);
      return key ? { t:(v.timeMs||0)/1000, key } : null;
    })
    .filter(x=>x)
    .forEach(({t,key})=>{
      setTimeout(()=>{
        mgr.setValue(key,1); mgr.update();
        setTimeout(()=>{
          mgr.setValue(key,0); mgr.update();
        },120);
      }, Math.max(0,t*1000));
    });

  audio.play().catch(e=>console.warn('Audio error',e));
}

// ————— Expression management —————
function setExpressionPersistent(name,weight,decay=DECAY_EMO) {
  const m = expressionMap[name] ?? name;
  activeExpr[m] = { weight, decay };
}

function applyExpressions(delta) {
  if (!vrmReady) return;
  const mgr = exprMgr || currentVRM.expressionManager || currentVRM.blendShapeProxy;
  if (!mgr) return;

  for (const [m,s] of Object.entries(activeExpr)) {
    s.weight = THREE.MathUtils.lerp(s.weight,0,s.decay*delta);
    if (s.weight<0.01) { delete activeExpr[m]; continue; }
    const c = mgr.getValue(m)||0;
    const b = THREE.MathUtils.lerp(c,s.weight,SMOOTH);
    mgr.setValue(m,b);
  }
  mgr.update();
}

// ————— Ambient blink/gaze/breath —————
function handleBlink(dt) {
  blinkTimer -= dt;
  if (blinkTimer<=0) {
    const mgr = exprMgr || currentVRM.expressionManager || currentVRM.blendShapeProxy;
    if (blendfaces) {
      blendfaces.set('blink',1,'live',150);
    } else if (mgr) {
      mgr.setValue('blink',1); mgr.update();
      setTimeout(()=>{ mgr.setValue('blink',0); mgr.update(); },150);
    }
    blinkTimer = 2+Math.random()*3;
  }
}

function handleGaze(dt) {
  gazeTimer -= dt;
  if (gazeTimer<=0) {
    gazeDirection = (Math.random()-0.5)*0.2;
    gazeTimer = 2+Math.random()*2;
  }
  const head = currentVRM.humanoid.getNormalizedBoneNode('head')
             || vrmGroup.getObjectByName('Head');
  if (head) head.rotation.y += (gazeDirection-head.rotation.y)*0.05;
}

function handleBreath(t) {
  const chest = currentVRM.humanoid.getNormalizedBoneNode('chest')
             || currentVRM.humanoid.getNormalizedBoneNode('upper_chest');
  if (chest) chest.position.y = chestBaseY + Math.sin(t*0.5)*0.01;
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
      // Mobile fallback: PNG equirectangular (upload to Blob/CDN if needed; direct path here)
      console.log('[Skybox] Using mobile PNG fallback');
      const loader = new THREE.TextureLoader();
      const texture = await loader.loadAsync('/skybox/background1.png');
      texture.mapping = THREE.EquirectangularReflectionMapping;
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.flipY = false;
      scene.background = texture;
      scene.environment = texture; // For PBR if needed
    } else {
      // Desktop: Optimized GLB
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
    // Fallback solid color (black to avoid blue)
    renderer.setClearColor(0x000000, 1);
  }
})();

loadVRM('/Assets/Sentali2.vrm',scene,camera,controls,vrm=>{
  currentVRM = vrm;
  vrmGroup.add(vrm.scene);
  vrm.scene.rotation.y = Math.PI;

  exprMgr  = vrm.expressionManager || vrm.blendShapeProxy;
  vrmReady = !!exprMgr;

  // chest for breathing
  const chest = vrm.humanoid.getNormalizedBoneNode('chest')
             || vrm.humanoid.getNormalizedBoneNode('upper_chest');
  if (chest) chestBaseY = chest.position.y;

  // merge any missing viseme aliases
  const available = exprMgr.getExpressionNames
    ? exprMgr.getExpressionNames()
    : Object.keys(vrm.blendShapeProxy.getBlendShapeGroupMap());
  ['aa','ee','ih','oh','ou','neutral'].forEach(alias=>{
    if (available.includes(alias)) expressionMap[alias] = alias;
  });

  blendfaces = new BlendfacesController(vrm,{
    expressionMap, smooth:0.3, decay:1.5, rest:{ blink:0 }
  });
  blendfaces.attachWS(cb=>blendfacesWS=cb);

  console.log('[VRM] loaded:', vrmReady);
});



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
    smooth: 0.3,
    decay: 1.5,
    // If your model doesn't have a 'neutral' clip, remove it from rest
    rest: { blink: 0.0 } // neutral: 1.0 removed
  });
  blendfaces.attachWS(cb => blendfacesWSHandler = cb);

  console.log('[VRM] Loaded successfully');
  console.log('[VRM] Humanoid bones:', Object.keys(vrm.humanoid.humanBones));

  // Sanity test ONLY after exprMgr is valid
  if (vrmReady) {
    ['aa','ee','ih','oh','ou'].forEach((k, i) => {
      setTimeout(() => {
        exprMgr.setValue(k, 1.0);
        exprMgr.update();
        console.log('Set', k);
        setTimeout(() => { exprMgr.setValue(k, 0.0); exprMgr.update(); }, 300);
      }, i * 600);
    });
  }
});

function testVRM0MouthShapes() {
  const mgr = currentVRM?.expressionManager || currentVRM?.blendShapeProxy;
  if (!mgr) {
    console.warn('No expression manager or blendShapeProxy found');
    return;
  }

  const presets = ['A', 'I', 'U', 'E', 'O'];
  let i = 0;

  function next() {
    presets.forEach(k => mgr.setValue(k, 0.0));
    if (i >= presets.length) {
      console.log('Test complete');
      return;
    }
    const key = presets[i];
    console.log(`Setting ${key} to 1.0`);
    mgr.setValue(key, 1.0);
    mgr.update();
    i++;
    setTimeout(next, 800);
  }

  next();
}


// Call this after VRM is loaded and added to the scene
testVRM0MouthShapes();



function scheduleVisemes(visemes, audio) {
  if (!vrmReady) return;
  const mgr = getMgr();
  if (!mgr) return;

  const keys = visemes
    .slice()
    .sort((a, b) => (a.timeMs || 0) - (b.timeMs || 0))
    .map(mapViseme)
    .filter(Boolean);

  keys.forEach(({ t, key }) => {
    setTimeout(() => {
      mgr.setValue(key, 1.0);
      mgr.update();
      // decay back down shortly after
      setTimeout(() => {
        mgr.setValue(key, 0.0);
        mgr.update();
      }, 120);
    }, Math.max(0, t * 1000));
  });

  if (audio) audio.play().catch(() => {});
}

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
  const available = new Set(Object.values(expressionMap)); // 'A','E','I','O','U', maybe 'neutral'

  for (const c of candidates) {
    if (available.has(c)) {
      const aliasKey = Object.keys(expressionMap).find(k => expressionMap[k] === c);
      return aliasKey || name;
    }
  }
  const fallback = { aa:'A', ee:'E', ih:'I', oh:'O', ou:'U' }[name];
  if (fallback && available.has(fallback)) {
    const aliasKey = Object.keys(expressionMap).find(k => expressionMap[k] === fallback);
    return aliasKey || name;
  }
  if (name === 'neutral' && available.has('neutral')) return 'neutral';
  return null;
}

function resolveToVRMKey(viseme) {
  // 1) raw alias from backend
  const alias = typeof viseme === 'string'
    ? viseme
    : visemeMap[viseme.visemeId ?? viseme.id] || null;
  if (!alias) return null;

  // 2) direct map to your model’s shape key
  const key = expressionMap[alias];
  if (key) return key;

  // 3) single-letter fallback
  return { aa:'A', ee:'E', ih:'I', oh:'O', ou:'U' }[alias] || null;
}

function mapViseme(v) {
  const key = resolveToVRMKey(v);
  if (!key) return null;
  console.log('→ mapped viseme:', key);
  return { t: v.timeMs/1000, key };
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

    // ✅ Always declare visemes here
    const visemes = (body.visemes || []).slice().sort((a, b) => a.timeMs - b.timeMs);
    console.log(`[TTS] Viseme count: ${visemes.length}`, visemes);

    // Log raw objects so we can see actual property names
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

    const expression = body.expression || 'neutral';
    setExpressionPersistent(expression, 1.0, DECAY_EMO);

    audio.addEventListener('play', () => {
      isSpeaking = true;
      typeOut(agentDiv, 'agent', text, durationMs);
      // Decide which viseme driver to use
          if (shouldUseBlendfaces() && blendfaces) {
            // Blendfaces timeline branch
           const items = visemes
             .map(v => {
               const m = mapViseme(v);
               return m ? { t: m.t, values: { [m.key]: 1 } } : null;
              })
             .filter(Boolean);
        
           blendfaces.loadTimeline(items);
           blendfaces.playTimeline(0, audio);
         } else {
           // Manual setValue() path
            scheduleVisemes(visemes, audio);
         }
          }, { once: true });


      const mapViseme = v => {
        const id = v.VisemeId ?? v.visemeId ?? v.id ?? null;
        const src = id != null ? visemeMap[id] : (v.name ?? null);
        console.log(`Raw viseme:`, v, '→ id:', id, '→ src:', src);
        if (!src) return null;

        const name = resolveMouth(src); // alias like 'aa', 'ee', etc.
        console.log(`resolveMouth(${src}) →`, name);
        if (!name) return null;

        const mapped = expressionMap[name] ?? name; // actual VRM key: 'A', 'E', 'I', 'O', 'U'
        currentVisemeName = mapped;
        currentVisemeWeight = 1.0;

        // Use mapped here, not alias
        return { t: v.timeMs / 1000, values: { [mapped]: 1 } };
      };






    audio.addEventListener('ended', () => {
      isSpeaking = false;
      currentVisemeName = null;
      currentVisemeWeight = 0;
      const mgr = currentVRM?.expressionManager || currentVRM?.blendShapeProxy;
      console.log('[VRM] Available expressions:', mgr?.getExpressionNames?.());
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

// ————— Animation loop —————
function animate() {
  requestAnimationFrame(animate);
  const dt = clock.getDelta(), t = clock.getElapsedTime();
  controls.update();
  if (!currentVRM) return;

  currentVRM.update(dt);
  applyExpressions(dt);
  handleBreath(t);
  handleGaze(dt);
  handleBlink(dt);
  if (blendfaces) blendfaces.update(dt);

  renderer.render(scene,camera);
}
animate();


/* === Window resize handler === */
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});