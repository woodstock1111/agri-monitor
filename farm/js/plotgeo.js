// 地块：都是地瓜，长得基本一样；不同的是
//   形状：整块 / 一分为二 / L 形 / 三条带（每块田畦的成熟度可以不同）
//   叶色：按成熟度（小苗嫩黄绿 → 封垄深绿 → 快收时微黄）和品种（紫薯带点紫）微调
//   有的围了竹篱笆，有的没有；边上可能有水沟泵房、工具棚、水塔
// 田面和地面齐平，不凸出来。
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mulberry32 } from './util.js';
import { toon, PLOT_BASE } from './terrain.js';

export const PAD_TOP = 0.08;   // 田面高度（相对地块基准面）

const LAYOUTS = ['single', 'split', 'L', 'strips'];
export const STAGES = ['seedling', 'growing', 'lush', 'ripening'];
export const STAGE_NAMES = { seedling: '缓苗期', growing: '分枝期', lush: '封垄期', ripening: '膨大期' };
// 品种叶色：普通绿叶 / 紫薯（叶带紫）/ 偏蓝绿
export const VARIETY_TINT = [null, '#7d5476', '#4f8a7a', null, '#7d5476', null];

// stage：真实地块按定植日期算出的生育期，整块地用同一个；不给就按序号错开（演示用）
export function plotShape(index, stage = null) {
  const rng = mulberry32(4000 + index * 131);
  const layout = LAYOUTS[(index * 3 + 1) % LAYOUTS.length];
  const st0 = stage || STAGES[(index * 2 + 1) % STAGES.length];
  const st1 = stage || STAGES[(index * 2 + 2) % STAGES.length];
  const W = 24 + rng() * 9, D = 16 + rng() * 6;
  const rot = (rng() - 0.5) * 1.0;
  const dir0 = rng() < 0.5 ? 'x' : 'z';
  const blocks = [];
  const gap = 1.6;
  if (layout === 'single') blocks.push({ x: 0, z: 0, w: W, d: D, stage: st0, dir: dir0 });
  else if (layout === 'split') {
    const k = 0.4 + rng() * 0.2, w1 = (W - gap) * k, w2 = W - gap - w1;
    blocks.push({ x: -W / 2 + w1 / 2, z: 0, w: w1, d: D, stage: st0, dir: 'z' });
    blocks.push({ x: W / 2 - w2 / 2, z: 0, w: w2, d: D, stage: st1, dir: 'x' });
  } else if (layout === 'L') {
    const d2 = D * (0.45 + rng() * 0.1), w2 = W * (0.45 + rng() * 0.1);
    blocks.push({ x: 0, z: -d2 / 2 - gap / 2, w: W, d: D - d2 - gap, stage: st0, dir: dir0 });
    blocks.push({ x: -W / 2 + w2 / 2, z: (D - d2) / 2 + gap / 2, w: w2, d: d2, stage: st1, dir: dir0 === 'x' ? 'z' : 'x' });
  } else {
    const dd = (D - gap * 2) / 3;
    [st0, st1, st0].forEach((s, i) => blocks.push({ x: 0, z: -D / 2 + dd / 2 + i * (dd + gap), w: W, d: dd, stage: s, dir: 'x' }));
  }
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const b of blocks) { x0 = Math.min(x0, b.x - b.w / 2); x1 = Math.max(x1, b.x + b.w / 2); z0 = Math.min(z0, b.z - b.d / 2); z1 = Math.max(z1, b.z + b.d / 2); }
  const poly = [[x0, z0], [x1, z0], [x1, z1], [x0, z1]];
  const extra = ['ditch', null, 'shed', 'tank', null, 'shed'][index % 6];
  const fence = (index * 7 + 3) % 5 < 2;
  return { poly, rot, W, D, blocks, extra, fence, layout, rng, rx: W / 2, rz: D / 2, stage: st0, tint: VARIETY_TINT[index % VARIETY_TINT.length] };
}

const C = (h) => new THREE.Color(h);

export function buildPlotMesh(shape, index, site, style) {
  const { blocks, rot } = shape;
  const rng = mulberry32(9000 + index * 17);
  const g = new THREE.Group();
  g.position.set(site[0], PLOT_BASE, site[1]);
  g.rotation.y = rot;

  const soils = [], ridges = [];
  const leaves = [];
  const green = C(style.field), deep = C(style.ridge), young = C(style.field).lerp(C('#c4d878'), 0.5), ripe = C('#bdb25e');
  const tint = shape.tint ? C(shape.tint) : null;
  const STAGE = { // 间距, 基础大小, 大小浮动, 高度
    seedling: [0.85, 0.36, 0.12, 0.16], growing: [0.7, 0.55, 0.2, 0.2], lush: [0.6, 0.78, 0.45, 0.24], ripening: [0.62, 0.74, 0.4, 0.24],
  };

  for (const b of blocks) {
    soils.push(new THREE.BoxGeometry(b.w, 0.1, b.d).translate(b.x, PAD_TOP - 0.04, b.z));
    const along = b.dir === 'x';
    const len = (along ? b.w : b.d) - 1.0, span = along ? b.d : b.w;
    const n = Math.max(2, Math.floor((span - 1.0) / 1.12));
    const [step, s0, sv, ylift] = STAGE[b.stage];
    for (let i = 0; i < n; i++) {
      const off = -span / 2 + 0.5 + (i + 0.5) * ((span - 1.0) / n);
      const cx = along ? b.x : b.x + off, cz = along ? b.z + off : b.z;
      const geo = new THREE.CapsuleGeometry(0.36, len - 0.72, 3, 8).rotateZ(Math.PI / 2).scale(1, 0.4, 1);
      if (!along) geo.rotateY(Math.PI / 2);
      ridges.push(geo.translate(cx, PAD_TOP, cz));
      for (let t = -len / 2 + 0.35; t < len / 2 - 0.35; t += step * (0.85 + rng() * 0.3)) {
        let c;
        if (b.stage === 'seedling') c = young.clone().lerp(green, rng() * 0.3);
        else if (b.stage === 'growing') c = green.clone().lerp(young, 0.25 + rng() * 0.2);
        else c = green.clone().lerp(deep, rng() * 0.5);
        if (b.stage === 'ripening') c.lerp(ripe, 0.2 + rng() * 0.15);
        if (tint && rng() < 0.55) c.lerp(tint, 0.18 + rng() * 0.15);
        c.multiplyScalar(0.93 + rng() * 0.14);
        leaves.push([(along ? cx + t : cx) + (rng() - 0.5) * 0.25, (along ? cz : cz + t) + (rng() - 0.5) * 0.25, s0 + rng() * sv, ylift, c]);
      }
    }
  }

  const add = (geos, mat) => {
    const m = new THREE.Mesh(mergeGeometries(geos), mat);
    m.castShadow = true; m.receiveShadow = true;
    g.add(m);
    return m;
  };
  const soilMesh = add(soils, toon(style.soil));
  const rowMesh = add(ridges, toon(C(style.soil).multiplyScalar(0.88)));

  const clumpGeo = new THREE.IcosahedronGeometry(0.5, 0).scale(1, 0.55, 1);
  const leafMesh = new THREE.InstancedMesh(clumpGeo, toon('#ffffff', { flatShading: true }), Math.max(1, leaves.length));
  const o = new THREE.Object3D();
  leaves.forEach(([x, z, s, y, c], i) => {
    o.position.set(x, PAD_TOP + y, z); o.rotation.set(0, rng() * 6.28, 0); o.scale.setScalar(s); o.updateMatrix();
    leafMesh.setMatrixAt(i, o.matrix); leafMesh.setColorAt(i, c);
  });
  leafMesh.count = leaves.length;
  leafMesh.castShadow = true; leafMesh.receiveShadow = true;
  g.add(leafMesh);

  if (shape.fence) addFence(g, shape);
  addExtra(g, shape, style);
  g.userData = { shape, leaves: leafMesh, soilMesh, rowMesh, leafPts: leaves };
  return g;
}

// 竹篱笆：沿外框一圈，前面留一个门
function addFence(g, shape) {
  const [[x0, z0], [x1], [, z1]] = shape.poly;
  const m = 1.0, X0 = x0 - m, X1 = x1 + m, Z0 = z0 - m, Z1 = z1 + m;
  const posts = [], rails = [];
  const side = (ax, az, bx, bz, gate) => {
    const L = Math.hypot(bx - ax, bz - az), n = Math.ceil(L / 1.8);
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      if (gate && Math.abs(t - 0.5) < 1.6 / L) continue;
      posts.push(new THREE.CylinderGeometry(0.07, 0.08, 1.2, 5).translate(ax + (bx - ax) * t, 0.6, az + (bz - az) * t));
    }
    const ang = Math.atan2(bz - az, bx - ax);
    const segs = gate ? [[0, 0.5 - 1.8 / L], [0.5 + 1.8 / L, 1]] : [[0, 1]];
    for (const [s, e] of segs) for (const y of [0.45, 0.95]) {
      const l = (e - s) * L, mx = ax + (bx - ax) * (s + e) / 2, mz = az + (bz - az) * (s + e) / 2;
      rails.push(new THREE.BoxGeometry(l, 0.06, 0.06).rotateY(-ang).translate(mx, y, mz));
    }
  };
  side(X0, Z1, X1, Z1, true); side(X1, Z1, X1, Z0); side(X1, Z0, X0, Z0); side(X0, Z0, X0, Z1);
  const mat = toon('#b49a62');
  const a = new THREE.Mesh(mergeGeometries(posts), mat), b = new THREE.Mesh(mergeGeometries(rails), mat);
  a.castShadow = b.castShadow = true;
  g.add(a, b);
}

function addExtra(g, shape, style) {
  const [x0, z0] = shape.poly[0];
  const X1 = shape.poly[1][0], Z1 = shape.poly[2][1];
  const off = shape.fence ? 1.6 : 0;
  if (shape.extra === 'ditch') {
    const water = new THREE.Mesh(new THREE.BoxGeometry(X1 - x0 + 2, 0.06, 1.2).translate((x0 + X1) / 2, 0.02, z0 - 1.6 - off), toon(style.water));
    const pump = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.8, 2).translate(0, 0.9, 0), toon(style.wall));
    const roof = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.2, 2.4).translate(0, 1.9, 0).rotateZ(0.12), toon('#3d6fa0'));
    pump.add(body, roof);
    pump.position.set(X1 + 3 + off, 0, z0 - 1.6 - off);
    for (const m of [water, body, roof]) { m.castShadow = true; m.receiveShadow = true; }
    g.add(water, pump);
  } else if (shape.extra === 'shed') {
    const shed = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(3.2, 2.2, 2.6).translate(0, 1.1, 0), toon(style.wood));
    const roof = new THREE.Mesh(new THREE.BoxGeometry(3.8, 0.18, 3.2).rotateX(0.18).translate(0, 2.35, 0), toon(style.roof));
    shed.add(body, roof);
    for (let i = 0; i < 4; i++) {
      const crate = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.5, 0.6), toon('#b8864f'));
      crate.position.set(2.3 + (i % 2) * 0.9, 0.25 + Math.floor(i / 2) * 0.5, -0.6 + (i % 2) * 0.2);
      const pile = new THREE.Mesh(new THREE.SphereGeometry(0.32, 6, 4).scale(1.3, 0.6, 1), toon('#9a3f66'));
      pile.position.set(crate.position.x, crate.position.y + 0.28, crate.position.z);
      shed.add(crate, pile);
    }
    shed.traverse((m) => { m.castShadow = true; m.receiveShadow = true; });
    shed.position.set(x0 - 4.5 - off, 0, Z1 - 3);
    shed.rotation.y = Math.PI / 2;
    g.add(shed);
  } else if (shape.extra === 'tank') {
    const tank = new THREE.Group();
    const legs = new THREE.Mesh(mergeGeometries([-1, 1].flatMap((sx) => [-1, 1].map((sz) => new THREE.BoxGeometry(0.18, 3, 0.18).translate(sx * 0.9, 1.5, sz * 0.9)))), toon('#7d858c'));
    const body = new THREE.Mesh(new THREE.CylinderGeometry(1.3, 1.3, 2, 14).translate(0, 4, 0), toon('#5d8fb0'));
    const cap = new THREE.Mesh(new THREE.ConeGeometry(1.4, 0.6, 14).translate(0, 5.3, 0), toon('#4c7896'));
    tank.add(legs, body, cap);
    tank.traverse((m) => { m.castShadow = true; m.receiveShadow = true; });
    tank.position.set(X1 + 3.5 + off, 0, Z1 - 2.5);
    g.add(tank);
  }
}

// 没启用的位置：鱼塘 / 撂荒地开着野花 / 草垛场 / 树苗圃，轮着来
export function buildReserved(index, site, style) {
  const shape = plotShape(index);
  const rng = mulberry32(6000 + index * 29);
  const g = new THREE.Group();
  g.position.set(site[0], PLOT_BASE, site[1]);
  g.rotation.y = shape.rot;
  const [[x0, z0], [x1], [, z1]] = shape.poly;
  const W = x1 - x0, D = z1 - z0, cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  const kind = ['pond', 'meadow', 'hay', 'nursery'][index % 4];
  const o = new THREE.Object3D();
  if (kind === 'pond') {
    const pts = [];
    for (let i = 0; i < 24; i++) { const a = (i / 24) * 6.28; const k = 0.85 + rng() * 0.2; pts.push(new THREE.Vector2(Math.cos(a) * W * 0.4 * k, Math.sin(a) * D * 0.4 * k)); }
    const rim = new THREE.Mesh(new THREE.ShapeGeometry(new THREE.Shape(pts.map((p) => p.clone().multiplyScalar(1.12))), 2).rotateX(-Math.PI / 2).translate(cx, 0.03, cz), toon(style.sand));
    const water = new THREE.Mesh(new THREE.ShapeGeometry(new THREE.Shape(pts), 2).rotateX(-Math.PI / 2).translate(cx, 0.06, cz), toon(style.water));
    g.add(rim, water);
    const pads = new THREE.InstancedMesh(new THREE.CircleGeometry(0.6, 10, 0.3, 5.8).rotateX(-Math.PI / 2), toon('#6f9a52'), 14);
    for (let i = 0; i < 14; i++) {
      const a = rng() * 6.28, r = Math.sqrt(rng()) * 0.7;
      o.position.set(cx + Math.cos(a) * W * 0.35 * r, 0.09, cz + Math.sin(a) * D * 0.35 * r); o.rotation.set(0, rng() * 6, 0); o.scale.setScalar(0.7 + rng() * 0.6); o.updateMatrix(); pads.setMatrixAt(i, o.matrix);
    }
    g.add(pads);
  } else {
    const ground = new THREE.Mesh(new THREE.BoxGeometry(W, 0.06, D).translate(cx, 0.02, cz), toon(style.meadow || style.grass));
    ground.receiveShadow = true;
    g.add(ground);
    if (kind === 'meadow') {
      const cols = ['#e9d36a', '#f3efe2', '#d86b7a', '#b8a0d6'];
      const fl = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.22, 0), toon('#ffffff'), 160);
      for (let i = 0; i < 160; i++) {
        o.position.set(cx + (rng() - 0.5) * W * 0.9, 0.2, cz + (rng() - 0.5) * D * 0.9); o.scale.setScalar(0.7 + rng() * 0.6); o.updateMatrix();
        fl.setMatrixAt(i, o.matrix); fl.setColorAt(i, C(cols[(rng() * cols.length) | 0]));
      }
      g.add(fl);
    } else if (kind === 'hay') {
      const hay = toon('#dcc06a');
      for (let i = 0; i < 5; i++) {
        const h = new THREE.Mesh(new THREE.CylinderGeometry(1.0, 1.0, 1.6, 12).rotateZ(Math.PI / 2), hay);
        h.position.set(cx + (rng() - 0.5) * W * 0.6, 1.0, cz + (rng() - 0.5) * D * 0.6); h.rotation.y = rng() * 3;
        h.castShadow = true; g.add(h);
      }
    } else {
      const trunk = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.06, 0.08, 1.0, 5).translate(0, 0.5, 0), toon(style.trunk), 60);
      const crown = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.55, 0).translate(0, 1.3, 0), toon(style.tree, { flatShading: true }), 60);
      let k = 0;
      for (let i = 0; i < 6; i++) for (let j = 0; j < 10; j++) {
        o.position.set(x0 + (j + 0.5) * W / 10, 0, z0 + (i + 0.5) * D / 6); o.scale.setScalar(0.8 + rng() * 0.4); o.updateMatrix();
        trunk.setMatrixAt(k, o.matrix); crown.setMatrixAt(k, o.matrix); k++;
      }
      trunk.castShadow = crown.castShadow = true;
      g.add(trunk, crown);
    }
  }
  g.userData = { shape, kind };
  return g;
}

// 巡逻路线：沿整块地的外框绕一圈
export function patrolPath(shape) {
  const [[x0, z0], [x1], [, z1]] = shape.poly;
  const m = 0.3;
  return [[x0 + m, z0 + m], [x1 - m, z0 + m], [x1 - m, z1 - m], [x0 + m, z1 - m]];
}
