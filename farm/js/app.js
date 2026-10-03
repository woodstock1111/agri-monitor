// 小薯农场 · 海岛监测（青绿 × 金线）
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { STYLES } from './styles.js';
import { buildTerrain, buildWater, buildSky, plotSites, heightAt, PLOT_BASE, toon } from './terrain.js';
import { buildProps, updateProps } from './props.js';
import { Slot, SOIL_Y, DEVICE_TYPES, buildProbe } from './slot.js';
import { LineComposer } from './post.js';
import { clamp, lerp, easeInOutCubic } from './util.js';

const style = STYLES.H2;
const MAX_PLOTS = 20;
document.body.classList.add(`theme-${style.banner}`);

// ---------- 基础 ----------
const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
let pixelRatio = Math.min(devicePixelRatio || 1, 1.5);
renderer.setPixelRatio(pixelRatio);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.NoToneMapping;

const scene = new THREE.Scene();
scene.background = new THREE.Color(style.fog);
scene.fog = new THREE.Fog(style.fog, style.fogNear, style.fogFar);
const camera = new THREE.PerspectiveCamera(40, 1, 1, 4000);

const hemi = new THREE.HemisphereLight('#ffffff', new THREE.Color(style.land).multiplyScalar(0.8), style.ambient);
const sun = new THREE.DirectionalLight('#ffffff', style.light * 1.6);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.intensity = style.shadow;
sun.shadow.bias = -0.0008;
sun.shadow.camera.near = 10; sun.shadow.camera.far = 900;
const SUN_DIR = new THREE.Vector3(-120, 200, 80).normalize();
scene.add(hemi, sun, sun.target);

const post = new LineComposer(renderer, scene, camera, style);

// ---------- 加载 ----------
const loader = new GLTFLoader();
loader.setMeshoptDecoder(MeshoptDecoder);
const loadingEl = document.getElementById('loading');
const loadingBar = loadingEl.querySelector('.bar i');

function normalize(obj, height) {
  const box = new THREE.Box3().setFromObject(obj);
  obj.scale.multiplyScalar(height / (box.max.y - box.min.y));
  obj.updateMatrixWorld(true);
  box.setFromObject(obj);
  const c = box.getCenter(new THREE.Vector3());
  obj.position.x -= c.x; obj.position.z -= c.z; obj.position.y -= box.min.y;
  const g = new THREE.Group();
  g.add(obj);
  g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return g;
}

let T;
async function loadAll() {
  const files = [['camera', 'camera-pole', 3.6], ['weather', 'weather-station', 3.0]];
  const total = files.length + 2;
  let done = 0;
  const tick = () => { done++; loadingBar.style.width = `${(done / total) * 100}%`; };
  const out = {};
  await Promise.all(files.map(async ([k, f, h]) => { const g = await loader.loadAsync(`assets/models/${f}.glb`); out[k] = normalize(g.scene, h); tick(); }));
  const [walk, idle] = await Promise.all(['xiaoshu-walk', 'xiaoshu-idle'].map(async (f) => { const g = await loader.loadAsync(`assets/models/${f}.glb`); tick(); return g; }));
  walk.scene.traverse((o) => { if (/Closed/.test(o.name)) o.visible = false; });
  out.xiaoshu = normalize(walk.scene, 2.4);
  out.walkClip = walk.animations[0];
  out.idleClip = idle.animations[0];
  return out;
}

function makeXiaoshu() {
  const root = T.xiaoshu.clone(true);
  const mixer = new THREE.AnimationMixer(root);
  const walk = mixer.clipAction(T.walkClip), idle = mixer.clipAction(T.idleClip);
  walk.play();
  let mode = 'walk';
  const setMode = (m) => {
    if (m === mode) return;
    const from = m === 'walk' ? idle : walk, to = m === 'walk' ? walk : idle;
    to.reset().play(); from.crossFadeTo(to, 0.3, false); mode = m;
  };
  mixer.update(Math.random() * 4);
  return { root, mixer, setMode };
}
function makeDevice(type) {
  if (type === 'probe') return buildProbe();
  return (type === 'camera' ? T.camera : T.weather).clone();
}

// 插进土里时扬起的土
const dust = (() => {
  const N = 240;
  const pos = new Float32Array(N * 3).fill(-999), vel = new Float32Array(N * 3), life = new Float32Array(N);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const pts = new THREE.Points(geo, new THREE.PointsMaterial({ color: '#b48d68', size: 0.35, transparent: true, opacity: 0.85, depthWrite: false }));
  pts.frustumCulled = false; pts.userData.noOutline = true;
  scene.add(pts);
  let cur = 0;
  const v = new THREE.Vector3();
  return {
    emit(slot, lx, lz) {
      slot.group.localToWorld(v.set(lx, SOIL_Y, lz));
      for (let k = 0; k < 40; k++) {
        const i = cur; cur = (cur + 1) % N;
        const a = Math.random() * 6.28, s = 1.5 + Math.random() * 2.5;
        pos.set([v.x, v.y + 0.1, v.z], i * 3);
        vel.set([Math.cos(a) * s, 1.5 + Math.random() * 2, Math.sin(a) * s], i * 3);
        life[i] = 0.5 + Math.random() * 0.4;
      }
    },
    update(dt) {
      for (let i = 0; i < N; i++) {
        if (life[i] <= 0) continue;
        life[i] -= dt; vel[i * 3 + 1] -= 6 * dt;
        for (let k = 0; k < 3; k++) { vel[i * 3 + k] *= 0.94; pos[i * 3 + k] += vel[i * 3 + k] * dt; }
        if (life[i] <= 0) pos[i * 3 + 1] = -999;
      }
      geo.attributes.position.needsUpdate = true;
    },
  };
})();

// ---------- 场景 ----------
let terrain, water, props;
const slots = [];
function buildWorld() {
  terrain = buildTerrain(style);
  water = buildWater(style);
  scene.add(terrain, water, buildSky(style));
  const sites = plotSites(MAX_PLOTS);
  props = buildProps(style, sites);
  scene.add(props);
  const ctx = { scene, style, makeXiaoshu, makeDevice, dust: (s, x, z) => dust.emit(s, x, z) };
  sites.forEach((s, i) => slots.push(new Slot(i, s, ctx)));
}

// ---------- 镜头 ----------
// 总览：可以平移、缩放；进地块：固定一个较平的视角，可旋转、小幅缩放
const HOME = { target: new THREE.Vector3(0, 0, -10), dist: 470, yaw: 0, pitch: 0.8 };
const view = { target: new THREE.Vector3(0, 0, 160), dist: 900, yaw: 0, pitch: 0.45 };
const goal = { target: HOME.target.clone(), dist: HOME.dist, yaw: 0, pitch: HOME.pitch };
let mode = 'intro', fly = null, saved = null, current = null, panelW = 0;
const pose = (v) => ({ target: v.target.clone(), dist: v.dist, yaw: v.yaw, pitch: v.pitch });

function startFly(to, dur, onEnd, arc = 0) { fly = { from: pose(view), to, t: 0, dur, onEnd, arc }; }

function plotPose(s) {
  const r = Math.max(s.shape.W, s.shape.D) / 2 + 3;
  return { target: new THREE.Vector3(s.cx, PLOT_BASE, s.cz), dist: clamp(r * 2.6, 40, 75), yaw: s.rot + 0.3, pitch: 0.62 };
}

function enterPlot(s) {
  if (!s.active || mode === 'flying') return;
  if (mode === 'overview') saved = pose(goal);
  setHover(null);
  current = s;
  mode = 'flying';
  document.body.classList.add('in-plot');
  renderPanel();
  const to = plotPose(s);
  startFly(to, 1.8, () => { mode = 'plot'; Object.assign(goal, pose(to)); }, 60);
}

function backToMap() {
  if (mode !== 'plot') return;
  hideFeed(true); hideTip();
  mode = 'flying';
  const to = saved || pose(HOME);
  document.body.classList.remove('in-plot');
  current = null;
  renderPanel();
  startFly(to, 1.7, () => { mode = 'overview'; Object.assign(goal, pose(to)); }, 60);
}

function shortAngle(a, b) { return a + Math.atan2(Math.sin(b - a), Math.cos(b - a)); }

function updateCamera(dt) {
  if (fly) {
    fly.t += dt;
    const k = easeInOutCubic(clamp(fly.t / fly.dur, 0, 1));
    view.target.lerpVectors(fly.from.target, fly.to.target, k);
    view.dist = lerp(fly.from.dist, fly.to.dist, k) + Math.sin(Math.PI * k) * fly.arc;
    view.yaw = lerp(fly.from.yaw, shortAngle(fly.from.yaw, fly.to.yaw), k);
    view.pitch = lerp(fly.from.pitch, fly.to.pitch, k);
    if (fly.t >= fly.dur) { const f = fly; fly = null; f.onEnd?.(); }
  } else if (mode === 'overview' || mode === 'plot') {
    const a = 1 - Math.exp(-dt * 7);
    view.target.lerp(goal.target, a);
    view.dist = lerp(view.dist, goal.dist, a);
    view.yaw = lerp(view.yaw, goal.yaw, a);
    view.pitch = lerp(view.pitch, goal.pitch, a);
  }
  const cp = Math.cos(view.pitch);
  camera.position.set(view.target.x + view.dist * cp * Math.sin(view.yaw), view.target.y + view.dist * Math.sin(view.pitch), view.target.z + view.dist * cp * Math.cos(view.yaw));
  camera.lookAt(view.target);
  const S = clamp(view.dist * 0.75, 40, 340);
  const sc = sun.shadow.camera;
  if (Math.abs(sc.right - S) > 2) { sc.left = -S; sc.right = S; sc.top = S; sc.bottom = -S; sc.updateProjectionMatrix(); }
  sun.target.position.copy(view.target);
  sun.position.copy(view.target).addScaledVector(SUN_DIR, 400);
}

function clampGoal() {
  if (mode === 'plot') {
    goal.dist = clamp(goal.dist, 22, 80);
    goal.pitch = clamp(goal.pitch, 0.35, 1.2);
    return;
  }
  goal.target.x = clamp(goal.target.x, -260, 260);
  goal.target.z = clamp(goal.target.z, -260, 220);
  goal.dist = clamp(goal.dist, 110, 600);
}

function resize() {
  const W = innerWidth, H = innerHeight;
  panelW = W > 900 ? document.getElementById('panel').offsetWidth + 24 : 0;
  renderer.setPixelRatio(pixelRatio);
  renderer.setSize(W, H, false);
  camera.aspect = (W + panelW) / H;
  if (panelW) camera.setViewOffset(W + panelW, H, panelW, 0, W, H); else camera.clearViewOffset();
  camera.updateProjectionMatrix();
  post.setSize(W, H, pixelRatio);
}
addEventListener('resize', resize);

// ---------- 交互 ----------
const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();
let pointer = { x: 0, y: 0, down: false, button: 0, moved: 0 };
let hovered = null, hoveredDevice = null;

function setNdc(e) { ndc.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1); raycaster.setFromCamera(ndc, camera); }
function pickSlot(e) {
  setNdc(e);
  const hit = raycaster.intersectObjects(slots.filter((s) => s.active && s.hit).map((s) => s.hit), false)[0];
  return hit ? hit.object.userData.slot : null;
}
function pickDevice(e) {
  if (!current) return null;
  setNdc(e);
  const hit = raycaster.intersectObjects(current.devices.map((d) => d.proxy), false)[0];
  return hit ? hit.object.userData.device : null;
}
function setHover(s) {
  if (hovered === s) return;
  hovered = s;
  canvas.style.cursor = s ? 'pointer' : '';
  document.querySelectorAll('.plot-row').forEach((r) => r.classList.toggle('hl', s && +r.dataset.i === s.index));
  for (const l of labels.values()) l.el.classList.toggle('hl', l.slot === s);
}

canvas.addEventListener('contextmenu', (e) => e.preventDefault());
canvas.addEventListener('pointerdown', (e) => {
  pointer = { x: e.clientX, y: e.clientY, down: true, button: e.button, moved: 0 };
  if (e.button === 1) e.preventDefault();
  canvas.setPointerCapture(e.pointerId);
});
canvas.addEventListener('pointermove', (e) => {
  const dx = e.clientX - pointer.x, dy = e.clientY - pointer.y;
  pointer.x = e.clientX; pointer.y = e.clientY;
  if (pointer.down) {
    pointer.moved += Math.abs(dx) + Math.abs(dy);
    if (mode === 'overview') {
      const k = (0.73 * view.dist) / innerHeight;
      const r = new THREE.Vector3(Math.cos(view.yaw), 0, -Math.sin(view.yaw)), f = new THREE.Vector3(-Math.sin(view.yaw), 0, -Math.cos(view.yaw));
      if (pointer.button === 0) goal.target.addScaledVector(r, -dx * k).addScaledVector(f, (dy * k) / Math.sin(view.pitch));
      else goal.yaw = clamp(goal.yaw - dx * 0.003, -0.5, 0.5);
      clampGoal();
      if (pointer.moved > 5) setHover(null);
    } else if (mode === 'plot' && (pointer.button === 1 || pointer.button === 2 || pointer.button === 0) && !dragging) {
      // 进了地块：中键 / 右键 / 左键拖动 旋转
      goal.yaw -= dx * 0.006;
      goal.pitch += dy * 0.004;
      clampGoal();
      if (pointer.moved > 5) { hideTip(); }
    }
    return;
  }
  if (mode === 'overview') setHover(pickSlot(e));
  else if (mode === 'plot' && !dragging) handleDeviceHover(e);
});
canvas.addEventListener('pointerup', (e) => {
  pointer.down = false;
  if (pointer.moved < 6 && e.button === 0) {
    if (mode === 'overview') { const s = pickSlot(e); if (s) enterPlot(s); }
    else if (mode === 'plot') { const d = pickDevice(e); if (d?.type === 'camera') showFeed(d); }
  }
});
canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  if (mode !== 'overview' && mode !== 'plot') return;
  goal.dist *= Math.exp(e.deltaY * 0.0011);
  clampGoal();
}, { passive: false });

const keys = new Set();
addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT') return;
  keys.add(e.key.toLowerCase());
  if (e.key === 'Escape') { if (feed.max) setFeedMax(false); else if (!modal.hidden) closeModal(); else backToMap(); }
});
addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
function keyPan(dt) {
  if (mode !== 'overview') return;
  let mx = 0, mz = 0;
  if (keys.has('a') || keys.has('arrowleft')) mx -= 1;
  if (keys.has('d') || keys.has('arrowright')) mx += 1;
  if (keys.has('w') || keys.has('arrowup')) mz += 1;
  if (keys.has('s') || keys.has('arrowdown')) mz -= 1;
  if (!mx && !mz) return;
  const sp = view.dist * 0.8 * dt;
  goal.target.x += (Math.cos(view.yaw) * mx - Math.sin(view.yaw) * mz) * sp;
  goal.target.z += (-Math.sin(view.yaw) * mx - Math.cos(view.yaw) * mz) * sp;
  clampGoal();
}

// ---------- 竖排标牌 ----------
const labelLayer = document.getElementById('labels');
const labels = new Map();
function moistureOf(s) { return s.data.moisture + s.wet * 12; }

function syncLabels() {
  for (const s of slots) {
    const has = labels.has(s.index);
    if (s.active && !has) {
      const el = document.createElement('div');
      el.className = 'banner';
      el.innerHTML = '<div class="flag"><span class="nm"></span><span class="al"></span></div><div class="data"></div><div class="pole"></div>';
      el.addEventListener('click', () => enterPlot(s));
      el.addEventListener('pointerenter', () => setHover(s));
      el.addEventListener('pointerleave', () => setHover(null));
      labelLayer.appendChild(el);
      labels.set(s.index, { el, slot: s });
    } else if (!s.active && has) { labels.get(s.index).el.remove(); labels.delete(s.index); }
  }
  for (const { el, slot } of labels.values()) {
    el.querySelector('.nm').textContent = slot.data.name;
    const a = slot.data.alerts[0];
    const al = el.querySelector('.al');
    al.textContent = a ? a.short : '';
    al.style.display = a ? '' : 'none';
    el.querySelector('.data').textContent = `湿度 ${moistureOf(slot).toFixed(0)}%`;
    el.classList.toggle('alert', !!a);
  }
}

const _v = new THREE.Vector3();
function toScreen(v) { _v.copy(v).project(camera); return { x: (_v.x * 0.5 + 0.5) * innerWidth, y: (-_v.y * 0.5 + 0.5) * innerHeight, behind: _v.z > 1 }; }

let labelFade = 0;
function updateLabels(dt) {
  const want = mode === 'overview' || (mode === 'intro' && fly && fly.t > fly.dur * 0.6) ? 1 : 0;
  labelFade = lerp(labelFade, want, 1 - Math.exp(-dt * 6));
  for (const { el, slot } of labels.values()) {
    const p = toScreen(_v.set(slot.cx, PLOT_BASE + 6, slot.cz));
    const d = camera.position.distanceTo(_v.set(slot.cx, PLOT_BASE, slot.cz));
    el.style.opacity = labelFade.toFixed(3);
    el.style.pointerEvents = labelFade > 0.5 ? 'auto' : 'none';
    el.style.transform = `translate(${p.x}px, ${p.y}px) translate(-50%, -100%) scale(${clamp(300 / d, 0.5, 1.15).toFixed(3)})`;
    el.style.zIndex = String(10000 - Math.round(d));
    el.style.display = p.behind || labelFade < 0.01 ? 'none' : '';
  }
}

// ---------- 传感器悬停 ----------
const tip = document.getElementById('tip');
let tipDevice = null;
function readings(dev) {
  const s = dev.slot.data, t = performance.now() / 1000, w = dev.slot.wet;
  const j = (amp, f = 1) => Math.sin(t * 0.35 * f + dev.seed) * amp + Math.sin(t * 1.3 * f + dev.seed * 2) * amp * 0.3;
  if (dev.type === 'probe') {
    const m = s.moisture + w * 12 + j(0.4);
    return [
      ['土壤湿度', `${m.toFixed(1)}%`, m < 18 ? 'bad' : 'ok'], ['土壤温度', `${(24.6 + j(0.3)).toFixed(1)}°C`],
      ['电导率 EC', `${(1.12 + j(0.04)).toFixed(2)} mS/cm`], ['pH', (6.3 + j(0.05)).toFixed(2)],
      ['氮 N', `${Math.round(86 + j(3))} mg/kg`], ['磷 P', `${Math.round(23 + j(1))} mg/kg`], ['钾 K', `${Math.round(142 + j(4))} mg/kg`], ['电量', `${Math.round(87 + j(1))}%`],
    ];
  }
  return [
    ['气温', `${(28.4 + j(0.4)).toFixed(1)}°C`], ['空气湿度', `${Math.round(71 + j(2))}%`], ['光照', `${(46.2 + j(3)).toFixed(1)} klx`],
    ['风速', `${(2.3 + j(0.6)).toFixed(1)} m/s 东南`], ['降雨', `${(w > 0.5 ? 0.4 : 0).toFixed(1)} mm`], ['气压', `${Math.round(1006 + j(1))} hPa`],
  ];
}
function renderTip() {
  if (!tipDevice) return;
  const d = tipDevice;
  tip.innerHTML = `<div class="tip-h"><b>${d.name}</b><span>${d.id}</span><i class="live"></i></div>
    <table>${readings(d).map(([k, v, c]) => `<tr><td>${k}</td><td class="${c || ''}">${v}</td></tr>`).join('')}</table>
    <div class="tip-f">${d.slot.data.name} · 每 2 秒刷新（演示数据）</div>`;
}
function showTip(dev) { if (tipDevice !== dev) { tipDevice = dev; renderTip(); } tip.hidden = false; }
function hideTip() { tip.hidden = true; tipDevice = null; }
setInterval(renderTip, 2000);

function anchorTo(el, dev, dx = 26) {
  const top = dev.obj.localToWorld(new THREE.Vector3(0, DEVICE_TYPES[dev.type].height, 0));
  const p = toScreen(top);
  const w = el.offsetWidth, h = el.offsetHeight;
  let x = p.x + dx;
  if (x + w > innerWidth - panelW - 8) x = p.x - dx - w;
  el.style.transform = `translate(${x}px, ${clamp(p.y - h / 2, 8, innerHeight - h - 8)}px)`;
}

function handleDeviceHover(e) {
  const d = pickDevice(e);
  hoveredDevice = d;
  canvas.style.cursor = d ? 'pointer' : '';
  if (d && d.anim < 0) {
    if (d.type === 'camera') { hideTip(); showFeed(d); } else { showTip(d); feedLeaveSoon(); }
  } else { hideTip(); feedLeaveSoon(); }
}

// ---------- 摄像头监控 ----------
const feedEl = document.getElementById('feed');
const feedView = feedEl.querySelector('.feed-view');
const feedCam = new THREE.PerspectiveCamera(58, 16 / 10, 0.1, 1500);
const feed = { dev: null, max: false, over: false, timer: 0 };
function showFeed(dev) {
  clearTimeout(feed.timer);
  if (feed.dev !== dev) { feed.dev = dev; feedEl.querySelector('.feed-id').textContent = `${dev.id} · ${dev.slot.data.name}`; }
  feedEl.hidden = false;
}
function hideFeed(force) { if (feed.max && !force) return; feedEl.hidden = true; feed.dev = null; setFeedMax(false); }
function feedLeaveSoon() {
  if (!feed.dev || feed.max) return;
  clearTimeout(feed.timer);
  feed.timer = setTimeout(() => { if (!feed.over && hoveredDevice !== feed.dev) hideFeed(); }, 380);
}
function setFeedMax(on) { feed.max = on; feedEl.classList.toggle('max', on); if (!on) feedEl.style.transform = ''; }
feedEl.addEventListener('pointerenter', () => { feed.over = true; clearTimeout(feed.timer); });
feedEl.addEventListener('pointerleave', () => { feed.over = false; feedLeaveSoon(); });
feedEl.querySelector('.btn-max').addEventListener('click', () => setFeedMax(!feed.max));
feedEl.querySelector('.btn-close').addEventListener('click', () => hideFeed(true));

function renderFeed() {
  if (feedEl.hidden || !feed.dev) return;
  const d = feed.dev;
  if (!d.slot.devices.includes(d)) { hideFeed(true); return; }
  if (!feed.max) anchorTo(feedEl, d, 30);
  const r = feedView.getBoundingClientRect();
  if (r.width < 4) return;
  feedCam.position.copy(d.obj.localToWorld(new THREE.Vector3(0, DEVICE_TYPES.camera.height * 0.93, 0.25)));
  feedCam.lookAt(d.slot.cx, PLOT_BASE + 0.3, d.slot.cz);
  feedCam.aspect = r.width / r.height;
  feedCam.updateProjectionMatrix();
  const H = innerHeight;
  renderer.setScissorTest(true);
  renderer.setViewport(r.left, H - r.bottom, r.width, r.height);
  renderer.setScissor(r.left, H - r.bottom, r.width, r.height);
  renderer.render(scene, feedCam);
  renderer.setScissorTest(false);
  renderer.setViewport(0, 0, innerWidth, H);
  feedEl.querySelector('.feed-time').textContent = new Date().toLocaleString('zh-CN', { hour12: false });
}

// ---------- 拖设备进地里 ----------
let dragging = null;
const dragChip = document.getElementById('drag-chip');
const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -(PLOT_BASE + SOIL_Y));
function makeGhost(type) {
  const g = makeDevice(type);
  g.traverse((o) => { if (o.isMesh) { o.material = o.material.clone(); o.material.transparent = true; o.material.opacity = 0.55; o.material.depthWrite = false; o.castShadow = false; } });
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.75, 1.0, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#4fd18b', transparent: true, opacity: 0.9, depthWrite: false }));
  ring.position.y = 0.1;
  g.add(ring);
  g.userData.ring = ring;
  g.traverse((o) => { o.userData.noOutline = true; });
  return g;
}
function startDrag(type, e) {
  if (mode !== 'plot' || !current) return;
  e.preventDefault();
  hideTip(); hideFeed(true);
  dragging = { type, ghost: makeGhost(type), valid: false, lx: 0, lz: 0 };
  dragging.ghost.visible = false;
  current.group.add(dragging.ghost);
  dragChip.textContent = DEVICE_TYPES[type].name;
  dragChip.hidden = false;
  document.body.classList.add('dragging');
  moveDrag(e);
}
function moveDrag(e) {
  if (!dragging) return;
  dragChip.style.transform = `translate(${e.clientX + 14}px, ${e.clientY + 14}px)`;
  setNdc(e);
  const p = new THREE.Vector3();
  if (document.elementFromPoint(e.clientX, e.clientY) !== canvas || !raycaster.ray.intersectPlane(groundPlane, p)) { dragging.ghost.visible = false; dragging.valid = false; return; }
  const [lx, lz] = current.toLocal(p.x, p.z);
  dragging.lx = lx; dragging.lz = lz;
  dragging.valid = current.canPlace(lx, lz);
  const g = dragging.ghost;
  g.visible = true;
  g.position.set(lx, SOIL_Y + (dragging.valid ? 0.6 : 0.3), lz);
  if (dragging.type === 'camera') g.rotation.y = Math.atan2(-lx, -lz);
  g.userData.ring.material.color.set(dragging.valid ? '#4fd18b' : '#e0503f');
  dragChip.classList.toggle('bad', !dragging.valid);
}
function endDrag() {
  if (!dragging) return;
  const d = dragging;
  dragging = null;
  d.ghost.removeFromParent();
  dragChip.hidden = true;
  document.body.classList.remove('dragging');
  if (d.valid) { const dev = current.addDevice(d.type, d.lx, d.lz, true); toast(`${dev.name} ${dev.id} 已插入${current.data.name}`); renderPanel(); }
  else if (d.ghost.visible) toast('要插在田里面才行（也别离其他设备太近）', 'bad');
}
addEventListener('pointermove', moveDrag);
addEventListener('pointerup', endDrag);
document.querySelectorAll('.dock-item[data-type]').forEach((el) => el.addEventListener('pointerdown', (e) => startDrag(el.dataset.type, e)));

// ---------- 浇水 ----------
const modal = document.getElementById('modal');
let modalOk = null;
function confirmBox(title, text, okText, cb) {
  modal.querySelector('h3').textContent = title; modal.querySelector('p').textContent = text; modal.querySelector('.ok').textContent = okText;
  modalOk = cb; modal.hidden = false;
}
function closeModal() { modal.hidden = true; modalOk = null; }
modal.querySelector('.ok').addEventListener('click', () => { const cb = modalOk; closeModal(); cb?.(); });
modal.querySelector('.cancel').addEventListener('click', closeModal);
modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });
function askWater(s = current) {
  if (!s) return;
  if (s.water) { toast(`${s.data.name}正在浇水`); return; }
  confirmBox(`给「${s.data.name}」浇水？`, `将打开 ${s.data.name} 的喷灌阀门，预计 20 分钟，用水约 ${(s.data.areaMu * 0.4).toFixed(1)} m³。（演示：不会真的开阀）`, '确认浇水', () => {
    s.startWatering(() => { toast(`${s.data.name}浇水完成，土壤湿度回升`); renderPanel(); syncLabels(); });
    toast('阀门已打开，开始喷灌…');
    renderPanel();
  });
}
document.getElementById('dock-water').addEventListener('click', () => askWater());
document.getElementById('dock-back').addEventListener('click', backToMap);
document.getElementById('back-btn').addEventListener('click', backToMap);

const toastEl = document.getElementById('toast');
let toastTimer = 0;
function toast(msg, kind = '') {
  toastEl.textContent = msg; toastEl.className = `show ${kind}`;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { toastEl.className = ''; }, 2600);
}

// ---------- 右侧面板 ----------
const panel = document.getElementById('panel');
const ICON = {
  probe: '<svg viewBox="0 0 24 24"><rect x="7" y="3" width="10" height="8" rx="1.5"/><path d="M12 11v10M10 21h4"/></svg>',
  weather: '<svg viewBox="0 0 24 24"><path d="M12 22V9M7 9h10M9 4a3 3 0 0 1 6 0"/><circle cx="18" cy="13" r="2"/></svg>',
  camera: '<svg viewBox="0 0 24 24"><rect x="3" y="6" width="13" height="8" rx="2"/><path d="m16 9 5-2v6l-5-2M8 14v7"/></svg>',
};
function renderPanel() {
  const act = slots.filter((s) => s.active);
  if (!current) {
    const alerts = act.reduce((n, s) => n + s.data.alerts.length, 0), devs = act.reduce((n, s) => n + s.devices.length, 0);
    panel.innerHTML = `
      <header class="p-head"><img src="../assets/agent-sweet-potato.png" alt=""><div><h1>小薯农场</h1><p>海岛种植区 · 地块监测</p></div></header>
      <div class="stats">
        <div><b>${act.length}<small>/20</small></b><span>启用地块</span></div>
        <div class="${alerts ? 'warn' : ''}"><b>${alerts}</b><span>告警</span></div>
        <div><b>${devs}</b><span>在线设备</span></div>
        <div><b>${act.length}</b><span>小薯巡逻</span></div>
      </div>
      <div class="weather">☀ 晴转多云 28°C · 东南风 2 级 · 湿度 71%</div>
      <h3>地块 <small>点击进入</small></h3>
      <ul class="plot-list">${act.map((s) => {
        const a = s.data.alerts[0], m = moistureOf(s);
        return `<li class="plot-row ${a ? 'alert' : ''}" data-i="${s.index}">
          <div class="pr-main"><b>${s.data.name}</b><span>${s.data.variety} · ${s.data.stage}</span></div>
          <div class="pr-moist"><i style="width:${clamp(m / 35, 0, 1) * 100}%"></i><em>${m.toFixed(0)}%</em></div>
          ${a ? `<span class="chip bad">${a.short}</span>` : s.water ? '<span class="chip water">浇水中</span>' : '<span class="chip ok">正常</span>'}
        </li>`;
      }).join('')}</ul>
      <div class="demo"><label>演示 · 启用地块数 <b id="pc-val">${act.length}</b></label><input id="pc" type="range" min="1" max="20" value="${act.length}"></div>`;
    panel.querySelectorAll('.plot-row').forEach((r) => {
      const s = slots[+r.dataset.i];
      r.addEventListener('click', () => enterPlot(s));
      r.addEventListener('pointerenter', () => mode === 'overview' && setHover(s));
      r.addEventListener('pointerleave', () => setHover(null));
    });
    const pc = panel.querySelector('#pc');
    pc.addEventListener('input', () => { panel.querySelector('#pc-val').textContent = pc.value; });
    pc.addEventListener('change', () => setPlotCount(+pc.value));
    return;
  }
  const s = current, d = s.data, m = moistureOf(s);
  panel.innerHTML = `
    <button class="back" id="panel-back">← 返回全岛</button>
    <h2>${d.name}</h2>
    <p class="sub">${d.variety} · ${d.stage} · ${d.areaMu} 亩${s.shape.fence ? ' · 有围栏' : ''}</p>
    ${d.alerts.length ? d.alerts.map((a) => `<div class="alert-card"><b>⚠ ${a.title}</b><p>${a.detail}</p><small>${a.advice}</small></div>`).join('') : '<div class="ok-card">✓ 地块一切正常</div>'}
    <div class="metrics">
      <div><span>土壤湿度</span><b class="${m < 18 ? 'bad' : ''}">${m.toFixed(1)}%</b></div>
      <div><span>设备</span><b>${s.devices.length} 台</b></div>
      <div><span>小薯</span><b>${d.alerts.length ? '巡查告警点' : '巡逻中'}</b></div>
      <div><span>灌溉</span><b>${s.water ? '喷灌中' : s.wet > 0.2 ? '刚浇过' : '待命'}</b></div>
    </div>
    <h3>设备 <small>悬停看数据</small></h3>
    <ul class="dev-list">${s.devices.map((v, i) => `<li><i class="ico">${ICON[v.type]}</i><b>${v.id}</b><span>${v.name}</span><button data-i="${i}" title="移除">✕</button></li>`).join('') || '<li class="empty">还没有设备</li>'}</ul>
    <button class="water-btn" id="panel-water" ${s.water ? 'disabled' : ''}>💧 ${s.water ? '浇水中…' : '浇水'}</button>
    <p class="hint">从下方把传感器、摄像头拖进田里；鼠标放在摄像头上看监控。按住中键（或右键）拖动旋转，滚轮拉近。</p>`;
  panel.querySelector('#panel-back').addEventListener('click', backToMap);
  panel.querySelector('#panel-water').addEventListener('click', () => askWater());
  panel.querySelectorAll('.dev-list button').forEach((b) => b.addEventListener('click', () => {
    const dev = s.devices[+b.dataset.i];
    if (feed.dev === dev) hideFeed(true);
    if (tipDevice === dev) hideTip();
    s.removeDevice(dev); toast(`已移除 ${dev.id}`); renderPanel();
  }));
}
setInterval(() => { if (!document.querySelector('#panel input:active')) { renderPanel(); syncLabels(); } }, 3000);

function setPlotCount(n) {
  n = clamp(Math.round(n), 1, MAX_PLOTS);
  slots.forEach((s, i) => s.setActive(i < n));
  if (current && !current.active) { current = null; mode = 'overview'; document.body.classList.remove('in-plot'); }
  syncLabels(); renderPanel();
  const u = new URL(location.href); u.searchParams.set('plots', n); history.replaceState(null, '', u);
}

// ---------- 主循环 ----------
const clock = new THREE.Clock();
let frames = 0, acc = 0, t = 0;
function loop() {
  const dt = Math.min(clock.getDelta(), 0.05);
  t += dt;
  keyPan(dt);
  updateCamera(dt);
  for (const s of slots) s.update(dt, t);
  dust.update(dt);
  updateProps(props, t);
  water.material.uniforms.uTime.value = t;
  if (terrain.material.userData.uTime) terrain.material.userData.uTime.value = t;
  updateLabels(dt);
  if (tipDevice && !tip.hidden) anchorTo(tip, tipDevice);
  post.render(t);
  renderFeed();
  frames++; acc += dt;
  if (acc > 2) {
    if (frames / acc < 30 && pixelRatio > 0.75) { pixelRatio = Math.max(0.75, pixelRatio - 0.25); resize(); }
    frames = 0; acc = 0;
  }
  requestAnimationFrame(loop);
}

(async () => {
  try { T = await loadAll(); } catch (err) { loadingEl.querySelector('p').textContent = '模型加载失败：请用本地服务器打开'; console.error(err); return; }
  buildWorld();
  resize();
  const q = new URLSearchParams(location.search);
  setPlotCount(+(q.get('plots') || 12));
  loadingEl.classList.add('done');
  setTimeout(() => loadingEl.remove(), 1200);
  if (q.has('skip')) { Object.assign(view, pose(HOME)); mode = 'overview'; labelFade = 1; }
  else startFly(pose(HOME), 3.6, () => { mode = 'overview'; });
  clock.getDelta();
  loop();
  // 调试：?skip&enter=1&cam&water
  if (q.has('enter')) setTimeout(() => {
    const s = slots[+q.get('enter')];
    enterPlot(s); fly.dur = 0.01;
    setTimeout(() => {
      if (q.has('cam')) { showFeed(s.addDevice('camera', s.bbox.x0 + 2.5, 0.5, false)); if (q.has('max')) setFeedMax(true); }
      if (q.has('water')) { s.startWatering(); for (let i = 0; i < 90; i++) s.update(1 / 30, i / 30); }
      if (q.has('tip')) showTip(s.devices[0]);
    }, 300);
  }, 300);
  window.__farm = { slots, enterPlot, backToMap, setPlotCount, view };
})();
