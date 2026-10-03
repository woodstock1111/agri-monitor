// 海南风格的摆设：椰子树、槟榔、香蕉、芒果、凤凰木、三角梅、雨林大树；
// 黎族船形屋、骑楼小镇、灯塔、木栈桥和渔船、海边大石、海上风机、湖心岛的智慧农业中心
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mulberry32, fbm } from './util.js';
import {
  heightAt, rawHeight, toon, shoreDist, distRiver, LAKE, ISLAND, lakeR, mountainFactor, WATER_Y, drop,
} from './terrain.js';

const v3 = (x, y, z) => new THREE.Vector3(x, y, z);
const UP = v3(0, 1, 0);

// ---------- 几何工具 ----------
// 按高度刷明暗，和 instanceColor 相乘
function shade(geo, lo = 0.72, hi = 1.12, fn) {
  const p = geo.attributes.position;
  let y0 = Infinity, y1 = -Infinity;
  for (let i = 0; i < p.count; i++) { y0 = Math.min(y0, p.getY(i)); y1 = Math.max(y1, p.getY(i)); }
  const c = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    let k = lo + (hi - lo) * ((p.getY(i) - y0) / (y1 - y0 || 1));
    if (fn) k *= fn(p.getX(i), p.getY(i), p.getZ(i));
    c[i * 3] = c[i * 3 + 1] = c[i * 3 + 2] = k;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(c, 3));
  return geo;
}
const strip = (g) => {
  g = g.index ? g.toNonIndexed() : g;
  for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv', 'color'].includes(k)) g.deleteAttribute(k);
  if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
  if (!g.attributes.normal) g.computeVertexNormals();
  if (!g.attributes.color) shade(g, 1, 1);
  return g;
};
const merge = (list) => mergeGeometries(list.map(strip));

// 沿两点放一段圆柱
function limb(a, b, r0, r1, seg = 6) {
  const g = new THREE.CylinderGeometry(r1, r0, a.distanceTo(b), seg);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(UP, b.clone().sub(a).normalize()));
  const m = a.clone().add(b).multiplyScalar(0.5);
  return g.translate(m.x, m.y, m.z);
}

// 弯曲的树干，一节一节带环纹
function ringedTrunk(H, bend, r0, r1, N, bendDir = 0) {
  const at = (t) => v3(Math.sin(t * 1.3) * bend * Math.cos(bendDir), t * H, Math.sin(t * 1.3) * bend * Math.sin(bendDir));
  const segs = [];
  for (let i = 0; i < N; i++) {
    const r = r0 + (r1 - r0) * (i / N);
    segs.push(shade(limb(at(i / N), at((i + 1) / N), r * 1.05, r * 0.9, 7), i % 2 ? 0.84 : 0.98, i % 2 ? 0.9 : 1.05));
  }
  return { segs, top: at(1) };
}

// 羽状叶（椰子、槟榔）：平躺，向下弯
function featherFrond(L, W, droop) {
  const s = new THREE.Shape();
  s.moveTo(0, 0);
  const n = 14, up = [], dn = [];
  for (let i = 1; i <= n; i++) {
    const t = i / n, x = t * L, w = (Math.sin(Math.PI * Math.min(1, t * 1.12)) * 0.95 + 0.05) * W;
    up.push([x - L * 0.04, w], [x, w * 0.3]);
    dn.push([x - L * 0.04, -w], [x, -w * 0.3]);
  }
  for (const [x, y] of up) s.lineTo(x, y);
  s.lineTo(L * 1.04, 0);
  for (const [x, y] of dn.reverse()) s.lineTo(x, y);
  s.lineTo(0, 0);
  const g = new THREE.ShapeGeometry(s);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i); p.setZ(i, -droop * x * x + 0.3 * x - Math.abs(y) * 0.3); }
  return g.rotateX(-Math.PI / 2);
}

// ---------- 树种：每种返回 [{ geo, color }] ----------
const SPECIES = {
  coconut(seed, st) {
    const rng = mulberry32(seed);
    const H = 7 + rng() * 4, bend = 0.8 + rng() * 2.2;
    const { segs, top } = ringedTrunk(H, bend, 0.36, 0.22, 14, rng() * 6.28);
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * 6.28;
      segs.push(shade(new THREE.SphereGeometry(0.3, 7, 5).translate(top.x + Math.cos(a) * 0.36, top.y - 0.35, top.z + Math.sin(a) * 0.36), 0.5, 0.65));
    }
    const fronds = [];
    const F = 9 + Math.floor(rng() * 4);
    for (let k = 0; k < F; k++) fronds.push(featherFrond(3.8 + rng() * 1.8, 0.9, 0.07 + rng() * 0.06).rotateY((k / F) * 6.28 + rng() * 0.4).translate(top.x, top.y + 0.1, top.z));
    return [{ geo: merge(segs), color: st.trunk }, { geo: shade(merge(fronds), 0.68, 1.12), color: st.palm }];
  },
  betel(seed, st) { // 槟榔：又细又直，冠小
    const rng = mulberry32(seed);
    const H = 9 + rng() * 3;
    const { segs, top } = ringedTrunk(H, 0.15, 0.17, 0.12, 16, rng() * 6.28);
    segs.push(shade(new THREE.CylinderGeometry(0.17, 0.2, 1.3, 7).translate(top.x, top.y + 0.6, top.z), 0.9, 1.1));
    const fronds = [];
    for (let k = 0; k < 7; k++) fronds.push(featherFrond(2.4 + rng() * 0.6, 0.6, 0.12).rotateY((k / 7) * 6.28 + rng() * 0.3).translate(top.x, top.y + 1.2, top.z));
    return [{ geo: merge(segs), color: '#8d8a72' }, { geo: shade(merge(fronds), 0.7, 1.12), color: st.palm }];
  },
  banana(seed) { // 香蕉：几根假茎 + 大桨叶
    const rng = mulberry32(seed);
    const stems = [], leaves = [];
    const n = 2 + Math.floor(rng() * 3);
    for (let s = 0; s < n; s++) {
      const ox = (rng() - 0.5) * 1.4, oz = (rng() - 0.5) * 1.4, h = 2.2 + rng() * 1.4;
      stems.push(limb(v3(ox, 0, oz), v3(ox, h, oz), 0.22, 0.16, 7));
      for (let k = 0; k < 6; k++) {
        const L = 2.4 + rng() * 0.8;
        const sh = new THREE.Shape();
        sh.moveTo(0, 0); sh.bezierCurveTo(L * 0.3, 0.55, L * 0.8, 0.5, L, 0.05); sh.bezierCurveTo(L * 0.8, -0.5, L * 0.3, -0.55, 0, 0);
        const g = new THREE.ShapeGeometry(sh, 5);
        const p = g.attributes.position;
        const up = 0.9 + rng() * 0.5;
        for (let i = 0; i < p.count; i++) { const x = p.getX(i); p.setZ(i, up * x - 0.38 * x * x); }
        leaves.push(g.rotateX(-Math.PI / 2).rotateY((k / 6) * 6.28 + rng()).translate(ox, h, oz));
      }
    }
    return [{ geo: shade(merge(stems), 0.85, 1.05), color: '#8f9a5a' }, { geo: shade(merge(leaves), 0.75, 1.15), color: '#7fb14e' }];
  },
  mango(seed, st) { // 芒果：矮干、浓密的大圆冠
    const rng = mulberry32(seed);
    const trunk = [limb(v3(0, 0, 0), v3(0, 2, 0), 0.38, 0.28, 7)];
    for (let i = 0; i < 4; i++) { const a = i * 1.57 + rng(); trunk.push(limb(v3(0, 1.8, 0), v3(Math.cos(a) * 1.4, 3.2, Math.sin(a) * 1.4), 0.18, 0.1, 5)); }
    const blobs = [];
    for (let i = 0; i < 11; i++) {
      const a = rng() * 6.28, r = rng() * 2.2;
      blobs.push(new THREE.IcosahedronGeometry(1.2 + rng() * 0.6, 1).translate(Math.cos(a) * r, 3.6 + rng() * 1.6, Math.sin(a) * r));
    }
    return [{ geo: shade(merge(trunk), 0.8, 1), color: st.trunk }, { geo: shade(merge(blobs), 0.58, 1.12), color: st.tree }];
  },
  flame(seed, st, red = true) { // 凤凰木：伞状的宽平冠
    const rng = mulberry32(seed);
    const trunk = [limb(v3(0, 0, 0), v3(0, 2.6, 0), 0.32, 0.24, 7)];
    const ends = [];
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * 6.28 + rng() * 0.5, e = v3(Math.cos(a) * 3.2, 4.2 + rng() * 0.6, Math.sin(a) * 3.2);
      trunk.push(limb(v3(0, 2.4, 0), e, 0.16, 0.08, 5)); ends.push(e);
    }
    const blobs = [];
    for (const e of ends) for (let k = 0; k < 3; k++) blobs.push(new THREE.IcosahedronGeometry(1.1 + rng() * 0.5, 1).scale(1.3, 0.55, 1.3).translate(e.x + (rng() - 0.5) * 1.6, e.y + 0.3 + rng() * 0.4, e.z + (rng() - 0.5) * 1.6));
    blobs.push(new THREE.IcosahedronGeometry(1.8, 1).scale(1.4, 0.5, 1.4).translate(0, 4.9, 0));
    return [{ geo: shade(merge(trunk), 0.8, 1), color: st.trunk }, { geo: shade(merge(blobs), 0.62, 1.12), color: red ? '#e0573c' : st.tree }];
  },
  bougainvillea(seed) { // 三角梅：一团矮灌木
    const rng = mulberry32(seed);
    const blobs = [];
    for (let i = 0; i < 9; i++) {
      const a = rng() * 6.28, r = rng() * 1.3;
      blobs.push(new THREE.IcosahedronGeometry(0.6 + rng() * 0.4, 1).translate(Math.cos(a) * r, 0.5 + rng() * 0.9, Math.sin(a) * r));
    }
    return [{ geo: shade(merge(blobs), 0.65, 1.15), color: '#d6457e' }];
  },
  jungle(seed, st) { // 山上的雨林大树：高干，冠分两三层
    const rng = mulberry32(seed);
    const H = 5 + rng() * 4;
    const trunk = [limb(v3(0, 0, 0), v3((rng() - 0.5), H, (rng() - 0.5)), 0.32, 0.18, 6)];
    const blobs = [];
    const tiers = 2 + Math.floor(rng() * 2);
    for (let t = 0; t < tiers; t++) {
      const y = H * (0.6 + t * 0.25), r = 2.4 - t * 0.6;
      for (let k = 0; k < 4; k++) { const a = rng() * 6.28; blobs.push(new THREE.IcosahedronGeometry(r * (0.6 + rng() * 0.3), 1).scale(1, 0.6, 1).translate(Math.cos(a) * r * 0.6, y + rng() * 0.6, Math.sin(a) * r * 0.6)); }
    }
    return [{ geo: shade(merge(trunk), 0.8, 1), color: st.trunk }, { geo: shade(merge(blobs), 0.55, 1.1), color: st.pine || st.tree }];
  },
};

// 每个树种做几个变体，按位置分配，用实例化绘制
function forest(style, plan) {
  const g = new THREE.Group();
  const rng = mulberry32(99);
  const col = new THREE.Color();
  for (const [name, seeds, list, extra] of plan) {
    if (!list.length) continue;
    seeds.forEach((sd, vi) => {
      const mine = list.filter((_, k) => k % seeds.length === vi);
      if (!mine.length) return;
      for (const part of SPECIES[name](sd, style, extra)) {
        const m = new THREE.InstancedMesh(part.geo, toon('#ffffff', { vertexColors: true, flatShading: true, side: THREE.DoubleSide }), mine.length);
        const o = new THREE.Object3D();
        mine.forEach(([p, ry, s, tilt], i) => {
          o.position.copy(p); o.rotation.set(tilt || 0, ry, (tilt || 0) * 0.6); o.scale.setScalar(s); o.updateMatrix();
          m.setMatrixAt(i, o.matrix);
          m.setColorAt(i, col.set(part.color).offsetHSL((rng() - 0.5) * 0.04, (rng() - 0.5) * 0.08, (rng() - 0.5) * 0.06));
        });
        m.castShadow = true; m.receiveShadow = true;
        g.add(m);
      }
    });
  }
  return g;
}

function instanced(geo, mat, list, colors) {
  const m = new THREE.InstancedMesh(geo, mat, Math.max(1, list.length));
  const o = new THREE.Object3D(), c = new THREE.Color();
  list.forEach(([p, ry, s], i) => {
    o.position.copy(p); o.rotation.set(0, ry, 0);
    if (typeof s === 'number') o.scale.setScalar(s); else o.scale.copy(s);
    o.updateMatrix(); m.setMatrixAt(i, o.matrix);
    if (colors) m.setColorAt(i, c.set(colors[i % colors.length]));
  });
  m.count = list.length;
  m.castShadow = true; m.receiveShadow = true;
  return m;
}

// ---------- 主函数 ----------
export function buildProps(style, plots) {
  const rng = mulberry32(2024);
  const group = new THREE.Group();
  const nearPlot = (x, z, r) => plots.some((p) => Math.hypot(p[0] - x, p[1] - z) < r);
  const onLand = (x, z) => rawHeight(x, z) > 0.1;
  const free = (x, z, r = 30) => onLand(x, z) && !nearPlot(x, z, r) && distRiver(x, z) > 7 && Math.hypot(x - LAKE.x, z - LAKE.z) > lakeR(x, z) + 3;
  const item = (x, z, s, tilt = 0) => [v3(x, heightAt(x, z) - 0.15, z), rng() * 6.28, s, tilt];

  const T = { coconut: [], betel: [], banana: [], mango: [], flame: [], green: [], bougain: [], jungle: [] };
  // 海边一圈椰子树（有的歪着长）
  for (let i = 0; i < 9000 && T.coconut.length < 260; i++) {
    const x = (rng() - 0.5) * 640, z = -300 + rng() * 560;
    const sd = shoreDist(x, z);
    if (sd > 2 && sd < 18 && mountainFactor(x, z) < 0.5 && onLand(x, z)) T.coconut.push(item(x, z, 0.8 + rng() * 0.45, (rng() - 0.5) * 0.25));
  }
  // 河边、湖边也有椰子
  for (let i = 0; i < 3000 && T.coconut.length < 340; i++) {
    const x = (rng() - 0.5) * 500, z = -240 + rng() * 420;
    const d = distRiver(x, z);
    if (d > 8 && d < 13 && free(x, z, 28)) T.coconut.push(item(x, z, 0.75 + rng() * 0.4, (rng() - 0.5) * 0.15));
  }
  // 槟榔园：成行种
  const groves = [[-150, -10], [150, 40], [-60, 150], [110, -150], [-190, 110]];
  for (const [gx, gz] of groves) {
    const a = rng() * 3;
    for (let r = -3; r <= 3; r++) for (let c = -4; c <= 4; c++) {
      const x = gx + Math.cos(a) * c * 4.2 - Math.sin(a) * r * 4.2 + (rng() - 0.5) * 0.8;
      const z = gz + Math.sin(a) * c * 4.2 + Math.cos(a) * r * 4.2 + (rng() - 0.5) * 0.8;
      if (free(x, z, 28) && mountainFactor(x, z) < 0.2) T.betel.push(item(x, z, 0.8 + rng() * 0.3));
    }
  }
  // 平原上散着的树，山上是雨林
  for (let i = 0; i < 9000; i++) {
    const x = (rng() - 0.5) * 600, z = -280 + rng() * 520;
    if (!free(x, z) || shoreDist(x, z) < 18) continue;
    const m = mountainFactor(x, z);
    if (m > 0.15) { if (rng() < 0.55 && T.jungle.length < 520) T.jungle.push(item(x, z, 0.8 + rng() * 0.6, (rng() - 0.5) * 0.1)); continue; }
    if (fbm(x * 0.02 + 5, z * 0.02, 2) < 0.48) continue;
    const r = rng();
    if (r < 0.25 && T.banana.length < 120) T.banana.push(item(x, z, 0.8 + rng() * 0.4));
    else if (r < 0.5 && T.mango.length < 140) T.mango.push(item(x, z, 0.7 + rng() * 0.5));
    else if (r < 0.62 && T.flame.length < 50) T.flame.push(item(x, z, 0.8 + rng() * 0.4));
    else if (r < 0.75 && T.green.length < 60) T.green.push(item(x, z, 0.8 + rng() * 0.5));
    else if (r < 0.9 && T.bougain.length < 90) T.bougain.push(item(x, z, 0.7 + rng() * 0.6));
  }

  // 村子：黎族船形屋
  const boatHouses = [], qilou = [];
  const villages = [[-80, 30], [-120, -110], [100, -105], [190, -20], [-185, 50]];
  for (const [vx, vz] of villages) {
    const a0 = rng() * 3;
    let n = 0;
    for (let k = 0; k < 40 && n < 9; k++) {
      const x = vx + (rng() - 0.5) * 30, z = vz + (rng() - 0.5) * 24;
      if (!free(x, z, 28)) continue;
      if (boatHouses.some((h) => Math.hypot(h[0].x - x, h[0].z - z) < 6)) continue;
      boatHouses.push([v3(x, heightAt(x, z) - 0.1, z), a0 + (rng() - 0.5) * 0.4, 0.9 + rng() * 0.3]);
      n++;
      if (rng() < 0.5) T.bougain.push(item(x + 3, z + 2, 0.6 + rng() * 0.3));
    }
  }
  // 骑楼：南边海岸附近的一条街
  const street = [[-40, 150], [40, 140]];
  const streetYaw = Math.atan2(street[1][0] - street[0][0], street[1][1] - street[0][1]);
  for (let i = 0; i <= 12; i++) {
    const t = i / 12, x = street[0][0] + (street[1][0] - street[0][0]) * t, z = street[0][1] + (street[1][1] - street[0][1]) * t;
    for (const side of [-1, 1]) {
      const px = x + side * 0.6, pz = z + side * 7;
      if (!onLand(px, pz) || nearPlot(px, pz, 26) || distRiver(px, pz) < 6) continue;
      qilou.push([v3(px, heightAt(px, pz) - 0.1, pz), streetYaw + (side > 0 ? Math.PI / 2 : -Math.PI / 2), 1]);
    }
  }

  group.add(forest(style, [
    ['coconut', [1, 2, 3, 4], T.coconut],
    ['betel', [5, 6], T.betel],
    ['banana', [7, 8, 9], T.banana],
    ['mango', [10, 11], T.mango],
    ['flame', [12, 13], T.flame, true],
    ['flame', [14], T.green, false],
    ['bougainvillea', [15, 16, 17], T.bougain],
    ['jungle', [18, 19, 20], T.jungle],
  ]));

  // 船形屋：矮墙 + 半圆茅草顶，像倒扣的船
  const wallG = new THREE.BoxGeometry(3.0, 1.0, 7.0).translate(0, 0.5, 0);
  const roofG = new THREE.CylinderGeometry(1.9, 1.9, 8.0, 12, 1, false, 0, Math.PI).rotateZ(Math.PI / 2).rotateY(Math.PI / 2).scale(1, 1.15, 1).translate(0, 0.85, 0);
  group.add(instanced(wallG, toon('#a88a66'), boatHouses));
  group.add(instanced(roofG, toon('#c9a865', { flatShading: true, side: THREE.DoubleSide }), boatHouses));
  // 骑楼：两层、彩色外墙、底层是廊
  const qlBody = merge([
    new THREE.BoxGeometry(5.6, 3.2, 6).translate(0, 4.6, 0),
    new THREE.BoxGeometry(5.6, 3.0, 4.2).translate(0, 1.5, -0.9),
    new THREE.BoxGeometry(6.0, 0.8, 6.2).translate(0, 6.6, 0),
    ...[-2.4, 0, 2.4].map((x) => new THREE.BoxGeometry(0.45, 3.0, 0.45).translate(x, 1.5, 2.75)),
  ]);
  const qlColors = ['#f1d9b5', '#e9b7a8', '#b9d4d6', '#f3e3a1', '#d8c7e3', '#f6f0e4'];
  group.add(instanced(shade(qlBody, 0.9, 1.05), toon('#ffffff', { vertexColors: true }), qilou, qlColors));
  if (style.windows) {
    const lit = new THREE.MeshBasicMaterial({ color: new THREE.Color(style.windows).multiplyScalar(2.2), toneMapped: false });
    const winG = new THREE.BoxGeometry(0.7, 0.6, 0.05);
    group.add(instanced(winG, lit, [
      ...qilou.map(([p, r]) => [p.clone().add(v3(Math.sin(r) * 3.05, 4.6, Math.cos(r) * 3.05)), r, 1]),
      ...boatHouses.filter(() => rng() < 0.6).map(([p, r]) => [p.clone().add(v3(Math.sin(r) * 3.55, 0.6, Math.cos(r) * 3.55)), r, 1]),
    ]));
  }

  // 湖心岛：智慧农业中心
  group.add(agriCenter(style, ISLAND.x, ISLAND.z));
  // 灯塔、栈桥、大石、风机
  const coast = coastPoints();
  group.add(lighthouse(style, ...coast.lighthouse));
  group.add(pier(style, ...coast.pier));
  group.add(rocks(coast.rocks, rng));
  const turbines = windFarm();
  group.add(turbines);
  group.userData.turbines = turbines;

  // 船：湖上的小船，海上的渔船
  const boats = new THREE.Group();
  for (let i = 0; i < 3; i++) { const b = boat(style, '#7a5a42'); b.userData = { lake: true, a: i * 2.1, r: 22 + i * 4, s: 0.05 + i * 0.012 }; boats.add(b); }
  for (let i = 0; i < 6; i++) {
    const b = boat(style, ['#3d6fa0', '#c8473a', '#2f8a80'][i % 3]); b.scale.setScalar(1.8);
    b.userData = { lake: false, a: i * 1.05 + 0.3, r: 330 + (i % 3) * 25, s: 0.004 + (i % 2) * 0.002 };
    boats.add(b);
  }
  group.add(boats);
  group.userData.boats = boats;

  // 飞鸟
  const birds = new THREE.Group();
  const bm = new THREE.MeshBasicMaterial({ color: style.roof, side: THREE.DoubleSide });
  const wingG = new THREE.BufferGeometry().setFromPoints([v3(0, 0, 0), v3(1.2, 0.1, -0.3), v3(0, 0, -0.5)]);
  for (let i = 0; i < 14; i++) {
    const g = new THREE.Group();
    const l = new THREE.Mesh(wingG, bm), r = new THREE.Mesh(wingG, bm);
    r.scale.x = -1;
    g.add(l, r);
    g.userData = { l, r, flock: i < 8 ? 0 : 1, off: v3((rng() - 0.5) * 10, (rng() - 0.5) * 3, (rng() - 0.5) * 10), ph: rng() * 6, noOutline: true };
    birds.add(g);
  }
  group.add(birds);
  group.userData.birds = birds;
  return group;
}

function surface(x, z) { return WATER_Y - drop(x, z); }

export function updateProps(group, t) {
  for (const b of group.userData.boats.children) {
    const u = b.userData, a = u.a + t * u.s;
    const x = (u.lake ? ISLAND.x : 0) + Math.cos(a) * u.r, z = (u.lake ? ISLAND.z : -35) + Math.sin(a) * u.r * (u.lake ? 0.8 : 0.85);
    b.position.set(x, surface(x, z) + 0.05 + Math.sin(t * 1.4 + u.a) * 0.08, z);
    b.rotation.y = -a;
  }
  for (const g of group.userData.birds.children) {
    const u = g.userData, a = t * 0.05 + u.flock * 3;
    const cx = u.flock ? 60 : -40, cz = u.flock ? -60 : -10;
    g.position.set(cx + Math.cos(a) * 90 + u.off.x, 38 + u.flock * 8 + u.off.y + Math.sin(t + u.ph) * 0.5, cz + Math.sin(a) * 60 + u.off.z);
    g.rotation.y = -a + (u.flock ? Math.PI : 0);
    const f = Math.sin(t * 7 + u.ph) * 0.6;
    u.l.rotation.z = f; u.r.rotation.z = -f;
  }
  for (const r of group.userData.turbines.userData.rotors) r.rotation.z = t * 0.9 + r.userData.ph;
}

// ---------- 地标 ----------
function coastPoints() {
  // 从岛中心往外找海岸：东南灯塔、南边栈桥、西南和东边几堆大石
  const findShore = (ang) => {
    for (let r = 340; r > 40; r -= 2) {
      const x = Math.cos(ang) * r, z = -35 + Math.sin(ang) * r;
      if (shoreDist(x, z) > 3 && mountainFactor(x, z) < 0.3) return [x, z, ang];
    }
    return [0, 150, ang];
  };
  return { lighthouse: findShore(0.55), pier: findShore(1.75), rocks: [findShore(2.35), findShore(2.5), findShore(1.2)] };
}

function lighthouse(style, x, z) {
  const g = new THREE.Group();
  const white = toon(style.wall), red = toon('#c8473a');
  const body = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 2.0, 14, 12), white); body.position.y = 7;
  const b1 = new THREE.Mesh(new THREE.CylinderGeometry(1.62, 1.75, 2, 12), red); b1.position.y = 5;
  const b2 = new THREE.Mesh(new THREE.CylinderGeometry(1.48, 1.56, 2, 12), red); b2.position.y = 10;
  const gallery = new THREE.Mesh(new THREE.CylinderGeometry(2.1, 2.1, 0.4, 12), toon(style.roof)); gallery.position.y = 14.2;
  const lamp = new THREE.Mesh(new THREE.CylinderGeometry(1.0, 1.0, 1.6, 10), new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffe9a8').multiplyScalar(1.6), toneMapped: false })); lamp.position.y = 15.2;
  const cap = new THREE.Mesh(new THREE.ConeGeometry(1.3, 1.4, 10), red); cap.position.y = 16.7;
  g.add(body, b1, b2, gallery, lamp, cap);
  g.traverse((o) => { o.castShadow = true; });
  g.position.set(x, heightAt(x, z) - 0.2, z);
  return g;
}

function pier(style, x, z, ang) {
  const g = new THREE.Group();
  const wood = toon(style.wood);
  const L = 34;
  const deck = new THREE.Mesh(new THREE.BoxGeometry(3, 0.35, L).translate(0, 0, L / 2), wood);
  deck.position.y = 1.0;
  g.add(deck);
  for (let i = 0; i <= 8; i++) for (const s of [-1, 1]) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 4), wood);
    post.position.set(s * 1.4, -0.8, (i / 8) * L); g.add(post);
  }
  g.traverse((o) => { o.castShadow = true; o.receiveShadow = true; });
  g.position.set(x, surface(x, z) + 0.2, z);
  g.rotation.y = Math.PI / 2 - ang; // 朝外海
  return g;
}

function rocks(spots, rng) {
  const g = new THREE.Group();
  const mat = toon('#b8aea0', { flatShading: true });
  for (const [x, z] of spots) {
    for (let k = 0; k < 4; k++) {
      const s = 2 + rng() * 3.5;
      const r = new THREE.Mesh(new THREE.DodecahedronGeometry(1, 1).scale(s, s * (0.8 + rng() * 0.6), s * 0.9), mat);
      const px = x + (rng() - 0.5) * 14, pz = z + (rng() - 0.5) * 14;
      r.position.set(px, Math.max(heightAt(px, pz), surface(px, pz)) + s * 0.3, pz);
      r.rotation.set(rng(), rng() * 6, rng());
      r.castShadow = true; r.receiveShadow = true;
      g.add(r);
    }
  }
  return g;
}

function windFarm() {
  const g = new THREE.Group();
  const white = toon('#f2f2ee');
  const rotors = [];
  const spots = [-2.55, -2.35, -2.15, -1.0, -0.8, -0.6].map((ang) => {
    for (let r = 360; r > 60; r -= 2) {
      const x = Math.cos(ang) * r, z = -35 + Math.sin(ang) * r;
      if (shoreDist(x, z) > 6) return [x, z];
    }
    return [0, -250];
  });
  for (const [x, z] of spots) {
    const t = new THREE.Group();
    const tower = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.9, 28, 10).translate(0, 14, 0), white);
    const nac = new THREE.Mesh(new THREE.BoxGeometry(1.4, 1.4, 3.2), white); nac.position.set(0, 28.5, 0);
    const rotor = new THREE.Group(); rotor.position.set(0, 28.5, 1.8);
    for (let k = 0; k < 3; k++) {
      const blade = new THREE.Mesh(new THREE.BoxGeometry(0.6, 13, 0.18).translate(0, 6.5, 0), white);
      blade.rotation.z = (k / 3) * Math.PI * 2;
      rotor.add(blade);
    }
    rotor.userData.ph = Math.random() * 6;
    rotors.push(rotor);
    t.add(tower, nac, rotor);
    t.traverse((o) => { o.castShadow = true; });
    t.position.set(x, heightAt(x, z) - 0.3, z);
    t.rotation.y = Math.atan2(x, z + 35);
    g.add(t);
  }
  g.userData.rotors = rotors;
  return g;
}

function agriCenter(style, x, z) {
  const g = new THREE.Group();
  const glass = toon('#cfe9ec', { transparent: true, opacity: 0.85 });
  const frame = toon(style.wall);
  const plat = new THREE.Mesh(new THREE.CylinderGeometry(7, 7.5, 0.8, 24), frame); plat.position.y = 0.4;
  const dome = new THREE.Mesh(new THREE.SphereGeometry(4.6, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), glass); dome.position.set(-1.5, 0.8, 0);
  const ribs = new THREE.Mesh(new THREE.SphereGeometry(4.65, 8, 5, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshBasicMaterial({ color: style.wall, wireframe: true }));
  ribs.position.copy(dome.position);
  ribs.userData.noOutline = true;
  const hall = new THREE.Mesh(new THREE.BoxGeometry(4, 3, 4), frame); hall.position.set(3.6, 2.3, 1.5);
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.28, 9, 6), toon('#9aa3ab')); mast.position.set(3.6, 8.3, 1.5);
  const dish = new THREE.Mesh(new THREE.SphereGeometry(1.4, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2.4), toon('#f2f2ee', { side: THREE.DoubleSide }));
  dish.rotation.x = Math.PI / 2.4; dish.position.set(3.6, 12.6, 1.5);
  g.add(plat, dome, ribs, hall, mast, dish);
  g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  g.position.set(x, heightAt(x, z) - 0.1, z);
  return g;
}

function boat(style, hullColor) {
  const g = new THREE.Group();
  const hull = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.5, 4.2, 6, 1, false, 0, Math.PI).rotateZ(Math.PI / 2).rotateX(Math.PI), toon(hullColor));
  hull.scale.set(1, 0.6, 1);
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.8, 1.0), toon(style.wall));
  cabin.position.set(-0.4, 0.45, 0);
  g.add(hull, cabin);
  return g;
}
