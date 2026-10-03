// 小薯农场 · 海岛监测（青绿 × 金线）
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { STYLE as style } from './styles.js';
import { buildTerrain, buildWater, buildSky, plotSites, PLOT_BASE } from './terrain.js';
import { buildProps, updateProps } from './props.js';
import { Slot, SOIL_Y, DEVICE_TYPES, buildProbe } from './slot.js';
import { LineComposer } from './post.js';
import { createDataSource, FarmActions, MAX_PLOTS } from './data.js';
import { clamp, lerp, easeInOutCubic, esc } from './util.js';

const source = createDataSource();
const REAL = source.mode === 'real';
const query = new URLSearchParams(location.search);
const DEBUG = query.has('debug');
document.body.classList.toggle('real-data', REAL);
// 在网页的全屏窗口里：右上角是网页的关闭按钮，面板往下让一点
document.body.classList.toggle('embedded', window.parent !== window);
// iPad 等触屏：没有悬停和滚轮，提示换成手势
const TOUCH = matchMedia('(pointer: coarse)').matches;
if (TOUCH) document.getElementById('hint').textContent = '单指拖动平移 · 双指缩放 · 点地块进入';

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

// 克隆出来的模型和模板共用几何体、材质，标成 shared，拆地块时不释放
function makeXiaoshu() {
  const root = T.xiaoshu.clone(true);
  root.userData.shared = true;
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
  const g = (type === 'camera' ? T.camera : T.weather).clone();
  g.userData.shared = true;
  return g;
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
  let cur = 0, alive = 0;
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
      alive = 1;
    },
    update(dt) {
      if (!alive) return;
      alive = 0;
      for (let i = 0; i < N; i++) {
        if (life[i] <= 0) continue;
        alive = 1;
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
let demoCount = clamp(Math.round(+query.get('plots') || 12), 1, MAX_PLOTS);
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

// 把数据层给的 20 个位置套到地块上
function applyPlots() {
  const plots = source.plots(demoCount);
  slots.forEach((s, i) => s.setPlot(plots[i] || null));
  if (current && !current.active) { current = null; mode = 'overview'; document.body.classList.remove('in-plot'); hideFeed(true); hideTip(); }
  syncLabels(); renderPanel();
}

// ---------- 镜头 ----------
// 总览：可以平移、缩放；进地块：固定一个较平的视角，可旋转、小幅缩放
const HOME = { target: new THREE.Vector3(0, 0, -10), dist: 470, yaw: 0, pitch: 0.8 };
let farScale = 1; // 画面比 16:10 窄（iPad 竖屏）时镜头拉远，整座岛 / 整块地放得下
const view = { target: new THREE.Vector3(0, 0, 160), dist: 900, yaw: 0, pitch: 0.45 };
const goal = { target: HOME.target.clone(), dist: HOME.dist, yaw: 0, pitch: HOME.pitch };
let mode = 'intro', fly = null, saved = null, current = null, panelW = 0;
const pose = (v) => ({ target: v.target.clone(), dist: v.dist, yaw: v.yaw, pitch: v.pitch });

function startFly(to, dur, onEnd, arc = 0) { fly = { from: pose(view), to, t: 0, dur, onEnd, arc }; }

function plotPose(s) {
  const r = Math.max(s.shape.W, s.shape.D) / 2 + 3;
  return { target: new THREE.Vector3(s.cx, PLOT_BASE, s.cz), dist: clamp(r * 2.6, 40, 75) * farScale, yaw: s.rot + 0.3, pitch: 0.62 };
}

function enterPlot(s) {
  if (!s.active || mode === 'flying') return;
  if (mode === 'overview') saved = pose(goal);
  setHover(null);
  current = s;
  mode = 'flying';
  document.body.classList.add('in-plot');
  renderPanel(); renderDock();
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
    goal.dist = clamp(goal.dist, 22, 80 * farScale);
    goal.pitch = clamp(goal.pitch, 0.35, 1.2);
    return;
  }
  goal.target.x = clamp(goal.target.x, -260, 260);
  goal.target.z = clamp(goal.target.z, -260, 220);
  goal.dist = clamp(goal.dist, 110, 600 * farScale);
}

// 面板挡住的那块不算画面：宽屏面板在右边，画面中心左移；窄屏（iPad 竖屏）面板在底部（38vh，见 app.css），中心上移
function resize() {
  const W = innerWidth, H = innerHeight;
  panelW = W > 900 ? document.getElementById('panel').offsetWidth + 24 : 0;
  const panelH = W > 900 ? 0 : Math.round(H * 0.38) + 10;
  farScale = clamp(1.6 / (W / (H - panelH)), 1, 2);
  HOME.dist = 470 * farScale;
  renderer.setPixelRatio(pixelRatio);
  renderer.setSize(W, H, false);
  camera.aspect = (W + panelW) / (H + panelH);
  if (panelW || panelH) camera.setViewOffset(W + panelW, H + panelH, panelW, panelH, W, H); else camera.clearViewOffset();
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
  document.querySelectorAll('.plot-row').forEach((r) => r.classList.toggle('hl', !!s && +r.dataset.i === s.index));
  for (const l of labels.values()) l.el.classList.toggle('hl', l.slot === s);
}

canvas.addEventListener('contextmenu', (e) => e.preventDefault());
// 鼠标和触屏共用：一根手指 / 左键拖动 = 平移（进地块后是旋转），两根手指捏合 = 缩放；
// 触屏没有悬停，点一下设备看数据，点空地收起
const touches = new Map();
let pinch = 0;
const pinchDist = () => { const [a, b] = [...touches.values()]; return Math.hypot(a.x - b.x, a.y - b.y); };
canvas.addEventListener('pointerdown', (e) => {
  touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
  canvas.setPointerCapture(e.pointerId);
  if (touches.size === 2) { pinch = pinchDist(); pointer.moved = 99; return; } // 双指开始：不算点击
  pointer = { x: e.clientX, y: e.clientY, down: true, button: e.button, moved: 0 };
  if (e.button === 1) e.preventDefault();
});
canvas.addEventListener('pointermove', (e) => {
  if (touches.has(e.pointerId)) touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (touches.size >= 2) {
    const d = pinchDist();
    if (pinch && d && (mode === 'overview' || mode === 'plot')) { goal.dist *= pinch / d; clampGoal(); }
    pinch = d;
    return;
  }
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
    } else if (mode === 'plot' && !dragging) {
      // 进了地块：左 / 中 / 右键（或单指）拖动都是旋转
      goal.yaw -= dx * 0.006;
      goal.pitch += dy * 0.004;
      clampGoal();
      if (pointer.moved > 5) hideTip();
    }
    return;
  }
  if (e.pointerType !== 'mouse') return;
  if (mode === 'overview') setHover(pickSlot(e));
  else if (mode === 'plot' && !dragging) handleDeviceHover(e);
});
function endTouch(e) {
  touches.delete(e.pointerId);
  if (touches.size < 2) pinch = 0;
  if (touches.size === 1) { const [t] = touches.values(); pointer = { ...pointer, x: t.x, y: t.y }; return; } // 双指松开一根：剩下那根接着拖，不跳
  if (touches.size) return;
  const tap = pointer.down && pointer.moved < 6 && e.button === 0 && e.type === 'pointerup';
  pointer.down = false;
  if (!tap) return;
  if (mode === 'overview') { const s = pickSlot(e); if (s) enterPlot(s); }
  else if (mode === 'plot') {
    const d = pickDevice(e);
    if (d?.type === 'camera') { hideTip(); showFeed(d); }
    else if (d && e.pointerType !== 'mouse') { hideFeed(); showTip(d); }
    else if (!d && e.pointerType !== 'mouse') { hideTip(); hideFeed(); }
  }
}
canvas.addEventListener('pointerup', endTouch);
canvas.addEventListener('pointercancel', endTouch);
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
addEventListener('blur', () => keys.clear());
function keyPan(dt) {
  if (mode !== 'overview' || !keys.size) return;
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
// 演示数据浇水后湿度跟着涨；真实数据只显示传感器读数
function moistureOf(s) {
  const m = s.data.moisture;
  return m == null ? null : m + (s.data.demo ? s.wet * 12 : 0);
}
const pct = (m) => (m == null ? '—' : `${m.toFixed(0)}%`);

// 毛笔字体只裁了这几个字；名字里有别的字就整串用系统楷体，免得一个名字里两种字体
const BRUSH_CHARS = new Set('小薯农场一二三四五六七八九十号地块0123456789');
const brushable = (name) => [...name].every((c) => BRUSH_CHARS.has(c));

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
      labels.set(s.index, { el, slot: s, nm: el.querySelector('.nm'), al: el.querySelector('.al'), data: el.querySelector('.data') });
    } else if (!s.active && has) { labels.get(s.index).el.remove(); labels.delete(s.index); }
  }
  for (const l of labels.values()) {
    const d = l.slot.data, a = d.alerts[0], m = moistureOf(l.slot);
    // 竖排标牌太长会戳出画面：超过 6 个字截断，全名在面板里
    const chars = [...d.name];
    l.nm.textContent = chars.length > 6 ? `${chars.slice(0, 5).join('')}…` : d.name;
    l.el.title = d.name;
    l.nm.classList.toggle('brush', brushable(d.name));
    l.al.textContent = a ? a.short : '';
    l.al.style.display = a ? '' : 'none';
    l.data.textContent = m == null ? '无墒情数据' : `湿度 ${pct(m)}`;
    l.el.classList.toggle('alert', !!a);
  }
}

const _v = new THREE.Vector3();
function toScreen(v) { _v.copy(v).project(camera); return { x: (_v.x * 0.5 + 0.5) * innerWidth, y: (-_v.y * 0.5 + 0.5) * innerHeight, behind: _v.z > 1 }; }

let labelFade = 0;
function updateLabels(dt) {
  const want = mode === 'overview' || (mode === 'intro' && fly && fly.t > fly.dur * 0.6) ? 1 : 0;
  labelFade = lerp(labelFade, want, 1 - Math.exp(-dt * 6));
  const hidden = labelFade < 0.01;
  for (const { el, slot } of labels.values()) {
    if (hidden) { if (el.style.display !== 'none') el.style.display = 'none'; continue; }
    const p = toScreen(_v.set(slot.cx, PLOT_BASE + 6, slot.cz));
    const d = camera.position.distanceTo(_v.set(slot.cx, PLOT_BASE, slot.cz));
    el.style.opacity = labelFade.toFixed(3);
    el.style.pointerEvents = labelFade > 0.5 ? 'auto' : 'none';
    el.style.transform = `translate(${p.x}px, ${p.y}px) translate(-50%, -100%) scale(${clamp(300 / d, 0.5, 1.15).toFixed(3)})`;
    el.style.zIndex = String(10000 - Math.round(d));
    el.style.display = p.behind ? 'none' : '';
  }
}

// ---------- 设备悬停：读数 ----------
const tip = document.getElementById('tip');
let tipDevice = null;
const fmtTime = (t) => (t ? new Date(t).toLocaleString('zh-CN', { hour12: false, month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');

// 返回 { rows: [[名称, 值, 'bad'|'ok'|'']], foot }
function readings(dev) {
  const plot = dev.slot.data;
  if (dev.type === 'weather') return weatherReadings(plot);
  if (!plot.demo) {
    const r = dev.ref;
    if (!r) return { rows: [], foot: '' };
    const rows = r.items.map((it) => [it.registerName, `${it.value ?? '—'}${it.unit || ''}`, (Number(it.alarmLevel) || 0) >= 1 ? 'bad' : '']);
    if (!r.online) rows.unshift(['状态', '离线', 'bad']);
    if (!rows.length) rows.push(['状态', '还没有读数', '']);
    return { rows, foot: `${esc(plot.name)}${r.updatedAt ? ` · 更新于 ${fmtTime(r.updatedAt)}` : ''}` };
  }
  // 演示：围绕一个基准值轻轻抖动
  const t = performance.now() / 1000, w = dev.slot.wet;
  const j = (amp, f = 1) => Math.sin(t * 0.35 * f + dev.seed) * amp + Math.sin(t * 1.3 * f + dev.seed * 2) * amp * 0.3;
  const m = plot.moisture + w * 12 + j(0.4);
  return {
    rows: [
      ['土壤湿度', `${m.toFixed(1)}%`, m < 18 ? 'bad' : 'ok'], ['土壤温度', `${(24.6 + j(0.3)).toFixed(1)}°C`],
      ['电导率 EC', `${(1.12 + j(0.04)).toFixed(2)} mS/cm`], ['pH', (6.3 + j(0.05)).toFixed(2)],
      ['氮 N', `${Math.round(86 + j(3))} mg/kg`], ['磷 P', `${Math.round(23 + j(1))} mg/kg`], ['钾 K', `${Math.round(142 + j(4))} mg/kg`], ['电量', `${Math.round(87 + j(1))}%`],
    ],
    foot: `${esc(plot.name)} · 每 2 秒刷新（演示数据）`,
  };
}

// 气象站 = 地块当地的实时天气
function weatherReadings(plot) {
  if (plot.demo) {
    const t = performance.now() / 1000;
    const j = (amp) => Math.sin(t * 0.35 + plot.slot) * amp;
    return {
      rows: [['天气', '晴转多云'], ['气温', `${(28.4 + j(0.4)).toFixed(1)}°C`], ['空气湿度', `${Math.round(71 + j(2))}%`], ['风', '东南风 2 级'], ['降雨', '0.0 mm']],
      foot: `${esc(plot.name)} · 演示数据`,
    };
  }
  if (!plot.coords) return { rows: [['位置', '未填写', 'bad']], foot: '去「地块管理」给这块地填上经纬度' };
  const w = source.weather(plot);
  if (w.error) return { rows: [['天气', '暂时取不到', 'bad']], foot: esc(w.error) };
  if (!w.value) { w.promise.then(() => tipDevice && renderTip()); return { rows: [['天气', '获取中…']], foot: '' }; }
  const v = w.value;
  return {
    rows: [['天气', v.condition || '—'], ['气温', `${v.temp}°C`], ['空气湿度', `${v.humidity}%`], ['风', `${v.windDirection || ''}风 ${v.windPower || '—'} 级`]],
    foot: `高德实时天气（地块所在区县）· ${fmtTime(v.fetchedAt)}`,
  };
}

function renderTip() {
  if (!tipDevice) return;
  const d = tipDevice, r = readings(d);
  tip.innerHTML = `<div class="tip-h"><b>${esc(d.name)}</b><span>${esc(d.type === 'weather' ? '' : d.id)}</span><i class="live"></i></div>
    <table>${r.rows.map(([k, v, c]) => `<tr><td>${esc(k)}</td><td class="${c || ''}">${esc(v)}</td></tr>`).join('')}</table>
    <div class="tip-f">${r.foot}</div>`;
}
function showTip(dev) { if (tipDevice !== dev) { tipDevice = dev; renderTip(); } tip.hidden = false; }
function hideTip() { tip.hidden = true; tipDevice = null; }
setInterval(() => { if (tipDevice && !tip.hidden && tipDevice.slot.data?.demo) renderTip(); }, 2000);

function anchorTo(el, dev, dx = 26) {
  const top = dev.obj.localToWorld(_v.set(0, DEVICE_TYPES[dev.type].height, 0));
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
// 演示数据：用场景里的机位渲染一个画面（角标写明演示）。真实摄像头：视频流还没接，显示设备状态，不拿假画面冒充
const feedEl = document.getElementById('feed');
const feedView = feedEl.querySelector('.feed-view');
const feedMsg = feedEl.querySelector('.feed-msg');
const feedCam = new THREE.PerspectiveCamera(58, 16 / 10, 0.1, 1500);
const feed = { dev: null, max: false, over: false, timer: 0 };
function showFeed(dev) {
  clearTimeout(feed.timer);
  if (feed.dev !== dev) {
    feed.dev = dev;
    feedEl.querySelector('.feed-id').textContent = `${dev.id} · ${dev.slot.data.name}`;
    const real = !dev.slot.data.demo, r = dev.ref;
    feedEl.classList.toggle('placeholder', real);
    feedMsg.textContent = !real ? '' : !r?.online ? '设备离线' : r.streamUrl ? '视频流待接入' : '还没有配置视频流地址';
    feedEl.querySelector('.feed-tag').textContent = real ? '' : 'LIVE · 演示画面';
  }
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

const feedTime = feedEl.querySelector('.feed-time');
function renderFeed() {
  if (feedEl.hidden || !feed.dev) return;
  const d = feed.dev;
  if (!d.slot.devices.includes(d)) { hideFeed(true); return; }
  if (!feed.max) anchorTo(feedEl, d, 30);
  feedTime.textContent = new Date().toLocaleString('zh-CN', { hour12: false });
  if (!d.slot.data.demo) return;
  const r = feedView.getBoundingClientRect();
  if (r.width < 4) return;
  feedCam.position.copy(d.obj.localToWorld(_v.set(0, DEVICE_TYPES.camera.height * 0.93, 0.25)));
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
}

// ---------- 拖设备进地里 ----------
// 演示：拖一个就新添一台（不保存）。真实：拖的是这块地在「设备管理」里还没摆放的设备，位置存回设备上；
// 气象站不是设备，是地块当地天气的展示，每块地一个，位置存在地块上。
let dragging = null;
let demoSeq = 100;
const dragChip = document.getElementById('drag-chip');
const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -(PLOT_BASE + SOIL_Y));

function unplaced(plot, type) { return plot.devices.filter((d) => d.type === type && !d.placed); }
function dragBlocked(plot, type) {
  if (type === 'weather') return plot.weatherPlaced ? '这块地已经有气象站了' : '';
  if (plot.demo) return '';
  if (unplaced(plot, type).length) return '';
  return `这块地没有还没摆放的${DEVICE_TYPES[type].name}，先到「设备管理」添加并选这块地`;
}

function makeGhost(type) {
  const g = makeDevice(type);
  g.userData.shared = false;
  g.userData.ghostMats = [];
  g.traverse((o) => {
    if (!o.isMesh) return;
    o.material = o.material.clone(); g.userData.ghostMats.push(o.material);
    o.material.transparent = true; o.material.opacity = 0.55; o.material.depthWrite = false; o.castShadow = false;
  });
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.75, 1.0, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#4fd18b', transparent: true, opacity: 0.9, depthWrite: false }));
  ring.position.y = 0.1;
  g.add(ring);
  g.userData.ring = ring;
  g.traverse((o) => { o.userData.noOutline = true; });
  return g;
}
function disposeGhost(g) {
  g.removeFromParent();
  g.userData.ghostMats.forEach((m) => m.dispose());
  g.userData.ring.geometry.dispose(); g.userData.ring.material.dispose();
  if (g.userData.probe) g.traverse((o) => o.geometry?.dispose());
}
function startDrag(type, e) {
  if (mode !== 'plot' || !current) return;
  e.preventDefault();
  const why = dragBlocked(current.data, type);
  if (why) { toast(why, 'bad'); return; }
  hideTip(); hideFeed(true);
  const ghost = makeGhost(type);
  ghost.userData.probe = type === 'probe';
  dragging = { type, ghost, valid: false, lx: 0, lz: 0 };
  ghost.visible = false;
  current.group.add(ghost);
  dragChip.textContent = DEVICE_TYPES[type].name;
  dragChip.hidden = false;
  document.body.classList.add('dragging');
  moveDrag(e);
}
const _p = new THREE.Vector3();
function moveDrag(e) {
  if (!dragging) return;
  dragChip.style.transform = `translate(${e.clientX + 14}px, ${e.clientY + 14}px)`;
  setNdc(e);
  if (document.elementFromPoint(e.clientX, e.clientY) !== canvas || !raycaster.ray.intersectPlane(groundPlane, _p)) { dragging.ghost.visible = false; dragging.valid = false; return; }
  const [lx, lz] = current.toLocal(_p.x, _p.z);
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
  disposeGhost(d.ghost);
  dragChip.hidden = true;
  document.body.classList.remove('dragging');
  if (d.valid) placeOn(current, d.type, d.lx, d.lz);
  else if (d.ghost.visible) toast('要插在田里面才行（也别离其他设备太近）', 'bad');
}
function placeOn(s, type, x, z) {
  const plot = s.data;
  let id, name;
  if (type === 'weather') {
    plot.weatherPlaced = { x, z };
    source.placeWeather(plot, x, z);
    id = `weather-${plot.id}`; name = '气象站';
  } else if (plot.demo) {
    const def = DEVICE_TYPES[type];
    id = `${def.prefix}-${demoSeq++}`; name = def.name;
    plot.devices.push({ id, type, name, online: true, placed: { x, z } });
  } else {
    const dev = unplaced(plot, type)[0];
    dev.placed = { x, z };
    source.placeDevice(plot, dev.id, x, z);
    id = dev.id; name = dev.name;
  }
  s.syncDevices(id);
  toast(`${name} 已插入${plot.name}`);
  renderPanel(); renderDock();
}
// 从田里收回：真实设备只是不在图上摆了，设备本身不删
function takeBack(s, id) {
  const plot = s.data;
  const dev = s.devices.find((d) => d.id === id);
  if (feed.dev === dev) hideFeed(true);
  if (tipDevice === dev) hideTip();
  if (id === `weather-${plot.id}`) { plot.weatherPlaced = null; source.unplaceWeather(plot); }
  else if (plot.demo) plot.devices = plot.devices.filter((d) => d.id !== id);
  else { const r = plot.devices.find((d) => d.id === id); if (r) r.placed = null; source.unplaceDevice(plot, id); }
  s.syncDevices();
  toast(plot.demo ? `已移除 ${dev?.name || id}` : `已收回 ${dev?.name || id}（设备还在，可以再拖进来）`);
  renderPanel(); renderDock();
}
addEventListener('pointermove', moveDrag);
addEventListener('pointerup', endDrag);
document.querySelectorAll('.dock-item[data-type]').forEach((el) => el.addEventListener('pointerdown', (e) => startDrag(el.dataset.type, e)));

// 设备栏：真实数据时显示每种还剩几台没摆，没得拖就灰掉
function renderDock() {
  if (!current) return;
  document.querySelectorAll('.dock-item[data-type]').forEach((el) => {
    const type = el.dataset.type, plot = current.data;
    const n = type === 'weather' ? (plot.weatherPlaced ? 0 : 1) : plot.demo ? null : unplaced(plot, type).length;
    el.querySelector('.cnt').textContent = n == null || type === 'weather' ? '' : `×${n}`;
    el.classList.toggle('empty', !!dragBlocked(plot, type));
    el.title = dragBlocked(plot, type) || '拖进地里';
  });
}

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
// 还没有灌溉控制器：按钮一直能点，只播动画。接控制器见 data.js 的 FarmActions.water
function askWater(s = current) {
  if (!s) return;
  const d = s.data;
  if (s.water) { toast(`${d.name}正在浇水`); return; }
  const use = d.areaMu ? `，用水约 ${(d.areaMu * 0.4).toFixed(1)} m³` : '';
  confirmBox(`给「${d.name}」浇水？`, `将打开 ${d.name} 的喷灌阀门，预计 20 分钟${use}。（还没有接灌溉控制器：只播放动画，不会真的开阀）`, '确认浇水', async () => {
    try { await FarmActions.water({ plot: d }); } catch (err) { toast(`开阀失败：${err.message}`, 'bad'); return; }
    s.startWatering(() => { toast(`${d.name}浇水完成${d.demo ? '，土壤湿度回升' : ''}`); renderPanel(); syncLabels(); });
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
const ICON = Object.fromEntries([...document.querySelectorAll('.dock-item[data-type]')].map((el) => [el.dataset.type, el.querySelector('svg').outerHTML]));

function weatherLine(plot) {
  if (!plot) return '';
  if (plot.demo) return '☀ 晴转多云 28°C · 东南风 2 级 · 湿度 71%（演示）';
  if (!plot.coords) return `${esc(plot.name)}没有填位置，显示不了天气`;
  const w = source.weather(plot);
  if (w.error) return `${esc(plot.name)} · 天气暂时取不到`;
  if (!w.value) { w.promise.then(() => renderPanel()); return `${esc(plot.name)} · 天气获取中…`; }
  const v = w.value;
  return `${esc(plot.name)} · ${esc(v.condition)} ${esc(v.temp)}°C · ${esc(v.windDirection)}风 ${esc(v.windPower)} 级 · 湿度 ${esc(v.humidity)}%`;
}

function statusChip(s) {
  const a = s.data.alerts[0];
  return a ? `<span class="chip bad">${esc(a.short)}</span>` : s.water ? '<span class="chip water">浇水中</span>' : '<span class="chip ok">正常</span>';
}
const irrigationText = (s) => (s.water ? '喷灌中' : s.wet > 0.2 ? '刚浇过' : '待命');

function renderPanel() {
  const act = slots.filter((s) => s.active);
  if (!current) {
    const alerts = act.reduce((n, s) => n + s.data.alerts.length, 0);
    const devs = act.flatMap((s) => s.data.devices);
    const online = devs.filter((d) => d.online).length;
    const weatherPlot = REAL ? act.map((s) => s.data).find((p) => p.coords) || act[0]?.data : act[0]?.data;
    panel.innerHTML = `
      <header class="p-head"><img src="../assets/agent-sweet-potato.png" alt=""><div><h1>小薯农场</h1><p>海岛种植区 · 地块监测 <span class="mode ${REAL ? 'real' : ''}">${REAL ? '实时数据' : '演示数据'}</span></p></div></header>
      <div class="stats">
        <div><b>${act.length}<small>/${MAX_PLOTS}</small></b><span>地块</span></div>
        <div class="${alerts ? 'warn' : ''}"><b>${alerts}</b><span>告警</span></div>
        <div><b>${online}<small>/${devs.length}</small></b><span>在线设备</span></div>
        <div><b>${act.length}</b><span>小薯巡逻</span></div>
      </div>
      ${weatherPlot ? `<div class="weather">${weatherLine(weatherPlot)}</div>` : ''}
      ${source.extra ? `<p class="hint">另有 ${source.extra} 块地超出 ${MAX_PLOTS} 块的上限，没有显示在岛上。</p>` : ''}
      <h3>地块 <small>${act.length ? '点击进入' : ''}</small></h3>
      ${act.length ? '' : '<p class="hint">还没有地块。到「地块管理」添加后，这里会自动出现。</p>'}
      <ul class="plot-list">${act.map((s) => {
        const d = s.data, m = moistureOf(s);
        return `<li class="plot-row ${d.alerts.length ? 'alert' : ''}" data-i="${s.index}">
          <div class="pr-main"><b>${esc(d.name)}</b><span>${esc(d.variety)} · ${esc(d.stage)}</span></div>
          <div class="pr-moist"><i style="width:${m == null ? 0 : clamp(m / 35, 0, 1) * 100}%"></i><em>${pct(m)}</em></div>
          <span class="pr-chip">${statusChip(s)}</span>
        </li>`;
      }).join('')}</ul>
      ${REAL ? '' : `<div class="demo"><label>演示 · 地块数 <b id="pc-val">${act.length}</b></label><input id="pc" type="range" min="1" max="${MAX_PLOTS}" value="${act.length}"></div>`}`;
    panel.querySelectorAll('.plot-row').forEach((r) => {
      const s = slots[+r.dataset.i];
      r.addEventListener('click', () => enterPlot(s));
      r.addEventListener('pointerenter', () => mode === 'overview' && setHover(s));
      r.addEventListener('pointerleave', () => setHover(null));
    });
    const pc = panel.querySelector('#pc');
    if (pc) {
      pc.addEventListener('input', () => { panel.querySelector('#pc-val').textContent = pc.value; });
      pc.addEventListener('change', () => setDemoCount(+pc.value));
    }
    return;
  }
  const s = current, d = s.data, m = moistureOf(s);
  // 设备列表：田里的（可收回）+ 真实数据里还没摆放的（从下面拖进来）
  const inField = s.devices.map((v) => ({ id: v.id, type: v.type, name: v.name, state: v.ref && !v.ref.online ? '离线' : '', placed: true }));
  const waiting = d.demo ? [] : d.devices.filter((v) => !v.placed).map((v) => ({ id: v.id, type: v.type, name: v.name, state: '未摆放', placed: false }));
  const rows = [...inField, ...waiting];
  panel.innerHTML = `
    <button class="back" id="panel-back">← 返回全岛</button>
    <h2 class="${brushable(d.name) ? 'brush' : ''}">${esc(d.name)}</h2>
    <p class="sub">${esc(d.variety)} · ${esc(d.stage)}${d.areaMu ? ` · ${esc(d.areaMu)} 亩` : ''}${s.shape.fence ? ' · 有围栏' : ''}</p>
    ${d.alerts.length ? d.alerts.map((a) => `<div class="alert-card"><b>⚠ ${esc(a.title)}</b><p>${esc(a.detail)}</p><small>${esc(a.advice)}</small></div>`).join('') : '<div class="ok-card">✓ 地块一切正常</div>'}
    <div class="weather">${weatherLine(d)}</div>
    <div class="metrics">
      <div><span>土壤湿度</span><b data-k="moist" class="${m != null && m < 18 ? 'bad' : ''}">${m == null ? '无数据' : `${m.toFixed(1)}%`}</b></div>
      <div><span>设备</span><b>${s.devices.length}${waiting.length ? `<small> / ${rows.length}</small>` : ''} 台</b></div>
      <div><span>小薯</span><b>${d.alerts.length ? '巡查告警点' : '巡逻中'}</b></div>
      <div><span>灌溉</span><b data-k="irr">${irrigationText(s)}</b></div>
    </div>
    <h3>设备 <small>${TOUCH ? '点设备看数据' : '悬停看数据'}</small></h3>
    <ul class="dev-list">${rows.map((v) => `<li class="${v.placed ? '' : 'waiting'}"><i class="ico">${ICON[v.type]}</i><b title="${esc(v.id)}">${esc(v.type === 'weather' ? '天气' : v.id)}</b><span>${esc(v.name)}${v.state ? ` · ${esc(v.state)}` : ''}</span>${v.placed ? `<button data-id="${esc(v.id)}" title="${d.demo ? '移除' : '从田里收回（不会删除设备）'}">✕</button>` : '<i></i>'}</li>`).join('') || `<li class="empty">${d.demo ? '还没有设备' : '这块地还没有绑定设备，到「设备管理」添加时选这块地'}</li>`}</ul>
    <button class="water-btn" id="panel-water" ${s.water ? 'disabled' : ''}>💧 ${s.water ? '浇水中…' : '浇水'}</button>
    <p class="hint">${d.demo ? '从下方把传感器、摄像头拖进田里' : '从下方把这块地的传感器、摄像头拖进田里，位置会保存'}；${TOUCH ? '点一下设备看数据，气象站显示地块当地天气。单指拖动旋转，双指缩放。' : '鼠标放在设备上看数据，气象站显示地块当地天气。按住鼠标拖动旋转，滚轮拉近。'}</p>`;
  panel.querySelector('#panel-back').addEventListener('click', backToMap);
  panel.querySelector('#panel-water').addEventListener('click', () => askWater());
  panel.querySelectorAll('.dev-list button').forEach((b) => b.addEventListener('click', () => takeBack(s, b.dataset.id)));
}

// 只更新会自己变的数字（浇水时的湿度、灌溉状态），不整块重建，免得打断悬停和点击
function updatePanelLive() {
  if (!current) {
    panel.querySelectorAll('.plot-row').forEach((r) => {
      const s = slots[+r.dataset.i];
      if (!s.active) return;
      const m = moistureOf(s);
      r.querySelector('.pr-moist i').style.width = `${m == null ? 0 : clamp(m / 35, 0, 1) * 100}%`;
      r.querySelector('.pr-moist em').textContent = pct(m);
      r.querySelector('.pr-chip').innerHTML = statusChip(s);
    });
    return;
  }
  const m = moistureOf(current), mEl = panel.querySelector('[data-k=moist]'), iEl = panel.querySelector('[data-k=irr]');
  if (mEl) { mEl.textContent = m == null ? '无数据' : `${m.toFixed(1)}%`; mEl.classList.toggle('bad', m != null && m < 18); }
  if (iEl) iEl.textContent = irrigationText(current);
}
setInterval(() => { syncLabels(); updatePanelLive(); }, 3000);

function setDemoCount(n) {
  demoCount = clamp(Math.round(n), 1, MAX_PLOTS);
  applyPlots();
  const u = new URL(location.href); u.searchParams.set('plots', demoCount); history.replaceState(null, '', u);
}

// 真实数据：每分钟重新读一遍传感器读数（服务器缓存）
async function refreshReal() {
  if (dragging) return;
  try { await source.refresh(slots.map((s) => s.data)); } catch (err) { console.warn('[farm] refresh', err); return; }
  applyPlots();
  if (current) renderDock();
  if (tipDevice) renderTip();
}

// ---------- 画质 ----------
// 帧率低于 30 就逐级降：分辨率 → 关阴影 → 关描线
function lowerQuality() {
  if (pixelRatio > 0.75) { pixelRatio = Math.max(0.75, pixelRatio - 0.25); resize(); return true; }
  if (sun.castShadow) { sun.castShadow = false; renderer.shadowMap.enabled = false; return true; }
  if (post.enabled) { post.enabled = false; return true; }
  return false;
}

// ---------- 主循环 ----------
const clock = new THREE.Clock();
let frames = 0, acc = 0, t = 0, canLower = true, running = true;
function loop() {
  if (!running) return;
  const dt = Math.min(clock.getDelta(), 0.05);
  t += dt;
  keyPan(dt);
  updateCamera(dt);
  for (const s of slots) s.update(dt, t);
  dust.update(dt);
  updateProps(props, t);
  water.material.uniforms.uTime.value = t;
  updateLabels(dt);
  if (tipDevice && !tip.hidden) anchorTo(tip, tipDevice);
  post.render();
  renderFeed();
  frames++; acc += dt;
  if (acc > 2) {
    if (canLower && frames / acc < 30) canLower = lowerQuality();
    frames = 0; acc = 0;
  }
  requestAnimationFrame(loop);
}

(async () => {
  try { T = await loadAll(); } catch (err) { loadingEl.querySelector('p').textContent = '模型加载失败，请刷新重试'; console.error(err); return; }
  buildWorld();
  resize();
  applyPlots();
  loadingEl.classList.add('done');
  setTimeout(() => loadingEl.remove(), 1200);
  Object.assign(goal, pose(HOME)); // resize 已按屏幕比例定好总览距离
  if (query.has('skip')) { Object.assign(view, pose(HOME)); mode = 'overview'; labelFade = 1; }
  else startFly(pose(HOME), 3.6, () => { mode = 'overview'; });
  clock.getDelta();
  loop();
  if (REAL) setInterval(refreshReal, 60 * 1000);
  // 网页关闭农场窗口前调用：停掉渲染、交还 WebGL 上下文，不等 iframe 回收
  window.farmDispose = () => { running = false; renderer.dispose(); renderer.forceContextLoss(); };
  if (DEBUG) window.__farm = { slots, source, enterPlot, backToMap, placeOn, takeBack, view, goal, renderer };
})();
