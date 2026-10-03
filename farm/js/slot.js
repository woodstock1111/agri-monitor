// 一个地块位置：有地块时是一块地（小薯巡逻、设备、浇水、告警），没有时是鱼塘 / 野花地之类的空地。
// 地块数据（名字、读数、设备、摆放位置）来自 data.js，这里只管 3D。
import * as THREE from 'three';
import { buildPlotMesh, buildReserved, plotShape, patrolPath, PAD_TOP } from './plotgeo.js';
import { toon, PLOT_BASE } from './terrain.js';
import { mulberry32, lerp, clamp, disposeTree } from './util.js';

export const SOIL_Y = PAD_TOP + 0.08;

export const DEVICE_TYPES = {
  probe: { name: '土壤传感器', prefix: 'SP', height: 1.7 },
  weather: { name: '气象站', prefix: 'WS', height: 3.0 },
  camera: { name: '摄像头', prefix: 'CAM', height: 3.6 },
};

export class Slot {
  constructor(index, site, ctx) {
    this.index = index;
    this.ctx = ctx;
    this.cx = site[0]; this.cz = site[1];
    this.y = PLOT_BASE;
    this.rng = mulberry32(700 + index * 37);
    this.data = null;
    this.devices = [];
    this.wet = 0;
    this.group = null;
    this.setShape(plotShape(index));
  }

  get active() { return !!this.data; }
  get hasAlert() { return !!this.data?.alerts.length; }

  setShape(shape) {
    this.shape = shape;
    this.rot = shape.rot;
    const [[x0, z0], [x1], [, z1]] = shape.poly;
    this.bbox = { x0, x1, z0, z1 };
    // 告警点放在第一块田里
    const b = shape.blocks[0], r = mulberry32(900 + this.index * 7);
    this.alertSpot = [b.x + (r() - 0.5) * b.w * 0.5, b.z + (r() - 0.5) * b.d * 0.5];
  }

  toWorld(lx, lz) {
    const c = Math.cos(this.rot), s = Math.sin(this.rot);
    return [this.cx + lx * c + lz * s, this.cz - lx * s + lz * c];
  }
  toLocal(x, z) {
    const c = Math.cos(this.rot), s = Math.sin(this.rot);
    const dx = x - this.cx, dz = z - this.cz;
    return [dx * c - dz * s, dx * s + dz * c];
  }
  inField(lx, lz, m = 0.4) {
    return this.shape.blocks.some((b) => Math.abs(lx - b.x) < b.w / 2 - m && Math.abs(lz - b.z) < b.d / 2 - m);
  }

  // 换上新的地块数据。只有「有没有地块」或生育期变了才重建模型，其余只同步设备和告警
  setPlot(plot) {
    const wasActive = this.active, stage = plot?.stageKey || null;
    const rebuild = !this.group || wasActive !== !!plot || (plot && stage !== this.stageKey);
    this.data = plot;
    if (rebuild) this.build(stage);
    if (!plot) return;
    this.syncDevices();
    this.refreshAlert();
  }

  build(stage) {
    this.clearDevices();
    if (this.water) this.stopWater();
    this.xiaoshu?.mixer.stopAllAction();
    this.xiaoshu = null;
    if (this.group) { this.ctx.scene.remove(this.group); disposeTree(this.group); }
    this.stageKey = stage;
    this.setShape(plotShape(this.index, stage));
    if (this.data) {
      this.group = buildPlotMesh(this.shape, this.index, [this.cx, this.cz], this.ctx.style);
      const u = this.group.userData;
      this.leaves = u.leaves;
      this.baseLeafColors = this.leaves.instanceColor ? this.leaves.instanceColor.array.slice() : null;
      this.soilMats = [u.soilMesh?.material, u.rowMesh?.material].filter(Boolean);
      this.soilBase = this.soilMats.map((m) => m.color.clone());
      this.buildAlert();
      this.buildXiaoshu();
    } else {
      this.group = buildReserved(this.index, [this.cx, this.cz], this.ctx.style);
      this.leaves = null; this.alertGroup = null; this.pin = null; this.bugs = [];
    }
    // 射线拾取用的隐形盒子
    const { x0, x1, z0, z1 } = this.bbox;
    this.hit = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0 + 1.2, 1.6, z1 - z0 + 1.2).translate((x0 + x1) / 2, 0.6, (z0 + z1) / 2), new THREE.MeshBasicMaterial({ visible: false }));
    this.hit.userData.slot = this;
    this.hit.userData.noOutline = true;
    this.group.add(this.hit);
    this.ctx.scene.add(this.group);
  }

  // ---------- 告警 ----------
  buildAlert() {
    const g = new THREE.Group();
    g.position.set(this.alertSpot[0], SOIL_Y, this.alertSpot[1]);
    const red = new THREE.MeshBasicMaterial({ color: new THREE.Color('#ff4a3a').multiplyScalar(1.6), toneMapped: false });
    const pin = new THREE.Group();
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.42, 14, 10), red);
    head.position.y = 2.6;
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.34, 1.0, 12).rotateX(Math.PI), red);
    tip.position.y = 1.95;
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.8, 6), new THREE.MeshBasicMaterial({ color: '#ff4a3a', transparent: true, opacity: 0.5 }));
    beam.position.y = 0.9;
    pin.add(head, tip, beam);
    pin.traverse((o) => { o.userData.noOutline = true; });
    g.add(pin);
    this.pin = pin;
    this.bugs = [];
    const bugGeo = new THREE.SphereGeometry(0.09, 6, 4), bugMat = new THREE.MeshLambertMaterial({ color: '#2f2a25' });
    for (let i = 0; i < 12; i++) {
      const b = new THREE.Mesh(bugGeo, bugMat);
      b.userData = { a: this.rng() * 6.28, r: this.rng() * 1.2, s: 0.6 + this.rng(), noOutline: true };
      g.add(b); this.bugs.push(b);
    }
    this.group.add(g);
    this.alertGroup = g;
    this.alertKey = undefined;
  }

  refreshAlert() {
    const a = this.data?.alerts[0];
    const key = a ? a.type : '';
    if (key === this.alertKey) return;
    this.alertKey = key;
    if (this.alertGroup) this.alertGroup.visible = !!a;
    for (const b of this.bugs || []) b.visible = a?.type === 'pest';
    // 缺水、病害：告警点周围的叶子变黄、变褐（真实传感器告警不知道是哪种问题，只立告警针）
    if (this.leaves && this.baseLeafColors) {
      const arr = this.leaves.instanceColor.array;
      arr.set(this.baseLeafColors);
      if (a && (a.type === 'dry' || a.type === 'disease')) {
        const tint = new THREE.Color(a.type === 'dry' ? '#c9b55c' : '#8a5a3c');
        const R = a.type === 'dry' ? 5 : 3;
        const r = mulberry32(this.index * 13);
        this.group.userData.leafPts.forEach(([x, z], i) => {
          const d = Math.hypot(x - this.alertSpot[0], z - this.alertSpot[1]);
          const k = clamp(1 - d / R, 0, 1) * (a.type === 'disease' ? (r() < 0.5 ? 1 : 0.2) : 1);
          if (k <= 0) return;
          arr[i * 3] = lerp(arr[i * 3], tint.r, k); arr[i * 3 + 1] = lerp(arr[i * 3 + 1], tint.g, k); arr[i * 3 + 2] = lerp(arr[i * 3 + 2], tint.b, k);
        });
      }
      this.leaves.instanceColor.needsUpdate = true;
    }
    this.buildPatrol();
  }

  // ---------- 小薯 ----------
  buildXiaoshu() {
    const x = this.ctx.makeXiaoshu();
    this.group.add(x.root);
    this.xiaoshu = { ...x, wp: 0, pause: 0, pos: new THREE.Vector2() };
    this.buildPatrol();
    const p = this.patrol[0];
    this.xiaoshu.pos.set(p[0], p[1]);
    x.root.position.set(p[0], SOIL_Y, p[1]);
  }

  buildPatrol() {
    if (!this.xiaoshu) return;
    const path = patrolPath(this.shape).map((p) => [...p]);
    // 穿过田块之间的小路
    if (this.shape.blocks.length > 1) {
      const [a, b] = this.shape.blocks;
      if (Math.abs(a.z - b.z) < 0.1) {
        const mx = (a.x + a.w / 2 + b.x - b.w / 2) / 2, zA = path[0][1], zB = path[2][1];
        path.splice(1, 0, [mx, zA, 'path'], [mx, zB, 'path'], [mx, zA, 'path']);
      }
    }
    if (this.hasAlert) {
      const [sx, sz] = this.alertSpot;
      let bi = 0, bd = Infinity;
      path.forEach((p, i) => { const d = Math.hypot(p[0] - sx, p[1] - sz); if (d < bd) { bd = d; bi = i; } });
      path.splice(bi + 1, 0, [sx, sz + 1.4, 'inspect'], [path[bi][0], path[bi][1]]);
    }
    this.patrol = path;
    this.xiaoshu.wp = Math.min(this.xiaoshu.wp, path.length - 1);
  }

  updateXiaoshu(dt) {
    const X = this.xiaoshu;
    if (!X) return;
    X.mixer.update(dt);
    if (X.pause > 0) { X.pause -= dt; if (X.pause <= 0) X.setMode('walk'); return; }
    const target = this.patrol[X.wp % this.patrol.length];
    const dx = target[0] - X.pos.x, dz = target[1] - X.pos.y, d = Math.hypot(dx, dz);
    if (d < 0.08) {
      X.wp = (X.wp + 1) % this.patrol.length;
      if (target[2] === 'inspect') { X.pause = 3.5; X.setMode('idle'); }
      else if (!target[2] && this.rng() < 0.3) { X.pause = 1.2 + this.rng() * 1.5; X.setMode('idle'); }
      return;
    }
    const step = Math.min(d, 1.6 * dt);
    X.pos.x += (dx / d) * step; X.pos.y += (dz / d) * step;
    X.root.position.x = X.pos.x; X.root.position.z = X.pos.y;
    let diff = Math.atan2(dx, dz) - X.root.rotation.y;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    X.root.rotation.y += diff * Math.min(1, dt * 6);
  }

  // ---------- 设备 ----------
  // 场景里的设备 = 数据里「已摆放」的设备 + 气象站（摆了的话）。按 id 对齐，新出现的插进去，消失的拔掉
  wantedDevices() {
    const p = this.data;
    const list = p.devices.filter((d) => d.placed).map((d) => ({ id: d.id, type: d.type, name: d.name, x: d.placed.x, z: d.placed.z, ref: d }));
    if (p.weatherPlaced) list.push({ id: `weather-${p.id}`, type: 'weather', name: DEVICE_TYPES.weather.name, x: p.weatherPlaced.x, z: p.weatherPlaced.z, ref: null });
    return list;
  }

  syncDevices(animateId = null) {
    const want = this.wantedDevices();
    const ids = new Set(want.map((w) => w.id));
    for (const d of [...this.devices]) if (!ids.has(d.id)) this.removeDevice(d);
    for (const w of want) {
      const cur = this.devices.find((d) => d.id === w.id);
      if (cur) { cur.ref = w.ref; cur.name = w.name; continue; }
      this.addDevice(w, w.id === animateId);
    }
  }

  addDevice({ id, type, name, x, z, ref }, animate) {
    const def = DEVICE_TYPES[type];
    const obj = this.ctx.makeDevice(type);
    obj.position.set(x, SOIL_Y, z);
    obj.rotation.y = type === 'camera' ? Math.atan2(-x, -z) : this.rng() * 6.28;
    const proxy = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, def.height + 0.4, 8), new THREE.MeshBasicMaterial({ visible: false }));
    proxy.position.y = def.height / 2;
    proxy.userData.noOutline = true;
    obj.add(proxy);
    this.group.add(obj);
    const dev = { id, type, name, ref, lx: x, lz: z, obj, proxy, slot: this, anim: animate ? 0 : -1, seed: this.rng() * 100 };
    proxy.userData.device = dev;
    if (animate) obj.position.y = SOIL_Y + 7;
    this.devices.push(dev);
    return dev;
  }

  removeDevice(dev) {
    dev.obj.removeFromParent();
    dev.proxy.geometry.dispose(); dev.proxy.material.dispose();
    if (dev.type === 'probe') disposeTree(dev.obj);
    this.devices = this.devices.filter((d) => d !== dev);
  }

  clearDevices() { for (const d of [...this.devices]) this.removeDevice(d); }

  canPlace(lx, lz) { return this.inField(lx, lz, 0.5) && this.devices.every((d) => Math.hypot(d.lx - lx, d.lz - lz) > 1.4); }

  updateDevices(dt) {
    for (const d of this.devices) {
      if (d.anim < 0) continue;
      d.anim += dt;
      const t = d.anim;
      if (t < 0.45) { const k = t / 0.45; d.obj.position.y = SOIL_Y + 7 * (1 - k * k); }
      else if (t < 0.9) {
        if (!d.dusted) { d.dusted = true; this.ctx.dust(this, d.lx, d.lz); }
        const k = (t - 0.45) / 0.45;
        d.obj.position.y = SOIL_Y - 0.22 * Math.sin(k * Math.PI) * (1 - k) - 0.06 * k;
        d.obj.rotation.z = Math.sin(k * 18) * 0.06 * (1 - k);
      } else { d.obj.position.y = SOIL_Y - 0.06; d.obj.rotation.z = 0; d.anim = -1; }
    }
  }

  // ---------- 浇水 ----------
  startWatering(onDone) {
    if (this.water || !this.active) return false;
    const N = 3600;
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(N * 3).fill(-999);
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const pts = new THREE.Points(geo, new THREE.PointsMaterial({ color: '#cfe8ff', size: 0.32, transparent: true, opacity: 0.9, depthWrite: false }));
    pts.frustumCulled = false;
    pts.userData.noOutline = true;
    this.group.add(pts);
    const heads = [];
    const headGeo = new THREE.CylinderGeometry(0.1, 0.14, 1.4, 8), headMat = toon('#5d6670');
    for (const b of this.shape.blocks) {
      const n = Math.max(1, Math.round(b.w / 9));
      for (let i = 0; i < n; i++) {
        const h = new THREE.Mesh(headGeo, headMat);
        h.position.set(b.x - b.w / 2 + (i + 0.5) * (b.w / n), SOIL_Y - 0.7, b.z);
        this.group.add(h); heads.push(h);
      }
    }
    this.water = { t: 0, dur: 8, pts, pos, vel: new Float32Array(N * 3), N, heads, headGeo, headMat, cursor: 0, onDone };
    return true;
  }

  stopWater() {
    const W = this.water;
    W.pts.removeFromParent(); W.pts.geometry.dispose(); W.pts.material.dispose();
    for (const h of W.heads) h.removeFromParent();
    W.headGeo.dispose(); W.headMat.dispose();
    this.water = null;
  }

  updateWater(dt) {
    const W = this.water;
    if (!W) return;
    W.t += dt;
    const emitting = W.t > 0.6 && W.t < W.dur - 1.2;
    for (const h of W.heads) {
      const up = W.t < 0.6 ? W.t / 0.6 : W.t > W.dur - 0.8 ? Math.max(0, (W.dur - W.t) / 0.8) : 1;
      h.position.y = SOIL_Y - 0.7 + up * 1.2;
    }
    if (emitting) {
      const rate = 600 * dt;
      for (let k = 0; k < rate; k++) {
        const i = W.cursor; W.cursor = (W.cursor + 1) % W.N;
        const hi = (Math.random() * W.heads.length) | 0, h = W.heads[hi];
        const az = W.t * 2.6 + hi * 1.3 + (Math.random() < 0.5 ? 0 : Math.PI) + (Math.random() - 0.5) * 0.35;
        const el = 0.8 + Math.random() * 0.35, sp = 5.2 + Math.random() * 1.6;
        W.pos[i * 3] = h.position.x; W.pos[i * 3 + 1] = h.position.y + 0.7; W.pos[i * 3 + 2] = h.position.z;
        W.vel[i * 3] = Math.cos(az) * Math.cos(el) * sp; W.vel[i * 3 + 1] = Math.sin(el) * sp; W.vel[i * 3 + 2] = Math.sin(az) * Math.cos(el) * sp;
      }
    }
    for (let i = 0; i < W.N; i++) {
      if (W.pos[i * 3 + 1] < -100) continue;
      W.vel[i * 3 + 1] -= 9.8 * dt;
      W.pos[i * 3] += W.vel[i * 3] * dt; W.pos[i * 3 + 1] += W.vel[i * 3 + 1] * dt; W.pos[i * 3 + 2] += W.vel[i * 3 + 2] * dt;
      if (W.pos[i * 3 + 1] < SOIL_Y + 0.25 && W.vel[i * 3 + 1] < 0) W.pos[i * 3 + 1] = -999;
    }
    W.pts.geometry.attributes.position.needsUpdate = true;
    if (emitting) this.wet = Math.min(1, this.wet + dt * 0.22);
    if (W.t >= W.dur) {
      const done = W.onDone;
      this.stopWater();
      // 演示数据：浇完湿度回升、缺水告警解除。真实数据等传感器下次上报
      const p = this.data;
      if (p?.demo) {
        p.moisture = Math.min(32, p.moisture + 9);
        p.alerts = p.alerts.filter((a) => a.type !== 'dry');
        this.refreshAlert();
      }
      done?.();
    }
  }

  update(dt, t) {
    if (!this.active) return;
    this.updateXiaoshu(dt);
    this.updateDevices(dt);
    this.updateWater(dt);
    if (!this.water) this.wet = Math.max(0, this.wet - dt * 0.015);
    this.soilMats.forEach((m, i) => m.color.copy(this.soilBase[i]).multiplyScalar(lerp(1, 0.58, this.wet)));
    if (this.pin && this.alertGroup.visible) {
      this.pin.position.y = Math.sin(t * 2.4) * 0.25;
      this.pin.rotation.y = t * 1.5;
      for (const b of this.bugs) {
        if (!b.visible) continue;
        const u = b.userData; u.a += dt * u.s;
        b.position.set(Math.cos(u.a) * u.r, 0.2 + Math.abs(Math.sin(t * 6 * u.s + u.a)) * 0.3, Math.sin(u.a * 1.3) * u.r);
      }
    }
  }
}

// 土壤传感器（代码建模）
export function buildProbe() {
  const g = new THREE.Group();
  const metal = toon('#9aa3ab');
  const stake = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.7, 8), metal); stake.position.y = 0.35;
  const box = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.42, 0.22), toon('#f4f1ea')); box.position.y = 1.35;
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.36, 0.2), new THREE.MeshBasicMaterial({ color: '#7fe0b4' })); screen.position.set(0, 1.38, 0.115);
  const panel = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.03, 0.36), toon('#2f4a7a')); panel.position.set(0, 1.62, -0.04); panel.rotation.x = -0.45;
  const ant = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.5), metal); ant.position.set(0.2, 1.8, 0);
  const led = new THREE.Mesh(new THREE.SphereGeometry(0.05, 6, 4), new THREE.MeshBasicMaterial({ color: '#58ff9a' })); led.position.set(0.2, 2.06, 0);
  g.add(stake, box, screen, panel, ant, led);
  g.traverse((o) => { o.castShadow = true; });
  g.scale.setScalar(1.3);
  return g;
}
