// 地形：中间是湖，西边河流入湖、湖水往北流进海；北边远处是沙滩和海，东西两侧远处是山。
// 远处地面往下弯，像站在星球上看地平线。
import * as THREE from 'three';
import { fbm, vnoise, smoothstep, lerp, mulberry32 } from './util.js';

export const WATER_Y = -0.6;
export const PLOT_BASE = 0.25;
let SITES = null;
const sites = () => (SITES ??= plotSites(20));
export const LAKE = { x: 0, z: -40, r: 46 };
export const ISLAND = { x: 10, z: -46, r: 9 };
export const RIVERS = [
  [[-235, -215], [-200, -130], [-140, -70], [-90, -44], [-44, -38]],
  [[235, -215], [195, -120], [140, -75], [90, -64], [42, -52]],
  [[4, 4], [20, 60], [6, 122], [-8, 175], [-12, 240]],
];
export const CAUSEWAY = [[-30, -2], [-18, -86]];

// 岛：椭圆 + 噪声边缘。返回到海岸的大致距离（米，岛内为正）
const ISLE = { cz: -35, a: 300, bn: 245, bs: 215 };
export function shoreDist(x, z) {
  const u = x / ISLE.a, dzz = z - ISLE.cz, v = dzz / (dzz < 0 ? ISLE.bn : ISLE.bs);
  const r = Math.hypot(u, v);
  const ang = Math.atan2(v, u);
  const R = 1 + 0.2 * (fbm(Math.cos(ang) * 2.2 + 7, Math.sin(ang) * 2.2 - 3, 4) - 0.5);
  return (R - r) * 240;
}

function distSeg(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / (dx * dx + dz * dz)));
  return Math.hypot(px - ax - dx * t, pz - az - dz * t);
}
export function distRiver(x, z) {
  let d = Infinity;
  for (const r of RIVERS) for (let i = 0; i < r.length - 1; i++) d = Math.min(d, distSeg(x, z, ...r[i], ...r[i + 1]));
  return d;
}

export function lakeR(x, z) {
  const a = Math.atan2(z - LAKE.z, x - LAKE.x);
  return LAKE.r * (0.82 + 0.32 * fbm(Math.cos(a) * 1.7 + 4, Math.sin(a) * 1.7, 3));
}

export function mountainFactor(x, z) {
  const inland = smoothstep(6, 40, shoreDist(x, z));
  return Math.max(smoothstep(-140, -215, z), smoothstep(185, 250, Math.abs(x)) * smoothstep(60, -40, z)) * inland;
}

// 不含弧度的真实高度。out 可选：顺带带回山的系数 m 和到海岸的距离 sd（建地形时不用再算一遍）
export function rawHeight(x, z, out) {
  let h = 0.25 + (fbm(x * 0.02, z * 0.02, 3) - 0.5) * 0.7;
  const sd = shoreDist(x, z);
  // 山
  const m = Math.max(smoothstep(-140, -215, z), smoothstep(185, 250, Math.abs(x)) * smoothstep(60, -40, z)) * smoothstep(6, 40, sd);
  if (m > 0) {
    const r = 1 - Math.abs(2 * fbm(x * 0.012 + 9, z * 0.012, 5) - 1);
    h += m * (10 + 95 * r * r * fbm(x * 0.004, z * 0.004 + 2, 2));
  }
  // 地块底下压平
  for (const [sx, sz] of sites()) {
    const d = Math.hypot(x - sx, z - sz);
    if (d < 27) h = lerp(h, PLOT_BASE - 0.03, smoothstep(27, 21, d));
  }
  // 湖
  const lr = Math.hypot(x - LAKE.x, z - LAKE.z) / lakeR(x, z);
  h = lerp(h, -3.2, smoothstep(1.12, 0.86, lr));
  // 湖心岛
  const di = Math.hypot(x - ISLAND.x, z - ISLAND.z);
  h = lerp(h, 0.6, smoothstep(ISLAND.r + 2, ISLAND.r - 1, di));
  // 河
  const dr = distRiver(x, z);
  h = lerp(h, -2.6, smoothstep(7.5 + m * 6, 4 + m * 3, dr));
  // 海岸：沙滩缓坡入海
  if (sd < 18) {
    const beach = 0.5 + sd * 0.07;
    h = Math.min(h, lerp(beach, h, smoothstep(10, 18, sd)));
    if (sd < 0) h = Math.min(h, beach - smoothstep(0, -60, sd) * 9);
  }
  if (out) { out.m = m; out.sd = sd; }
  return h;
}

export const CURVE_R0 = 300;
export function drop(x, z) {
  const r = Math.hypot(x, z + 30) - CURVE_R0;
  return r > 0 ? (r * r) / 1600 : 0;
}
export function heightAt(x, z) {
  return rawHeight(x, z) - drop(x, z);
}

export function toonGradient() {
  const data = new Uint8Array([120, 120, 120, 255, 190, 190, 190, 255, 255, 255, 255, 255]);
  const t = new THREE.DataTexture(data, 3, 1);
  t.minFilter = t.magFilter = THREE.NearestFilter;
  t.needsUpdate = true;
  return t;
}
let GRAD;
export function toon(color, extra = {}) {
  GRAD ??= toonGradient();
  return new THREE.MeshToonMaterial({ color, gradientMap: GRAD, ...extra });
}

const TER = { size: 1300, seg: 430 };
// 建地形时算出的原始高度，水面直接拿来做深度贴图（同一张网格，不再整片重算）
let heightGrid = null;

export function buildTerrain(style) {
  const geo = new THREE.PlaneGeometry(TER.size, TER.size, TER.seg, TER.seg).rotateX(-Math.PI / 2);
  geo.translate(0, 0, -60);
  const pos = geo.attributes.position;
  const col = new Float32Array(pos.count * 3);
  const C = (k) => new THREE.Color(style[k]);
  const P = { land: C('land'), land2: C('land2'), slope: C('slope'), mountain: C('mountain'), peak: C('peak'), sand: C('sand'), bank: C('bank') };
  const c = new THREE.Color();
  const parts = { m: 0, sd: 0 };
  heightGrid = new Float32Array(pos.count);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const h = rawHeight(x, z, parts);
    heightGrid[i] = h;
    pos.setY(i, h - drop(x, z));
    const m = parts.m;
    c.copy(P.land).lerp(P.land2, smoothstep(0.35, 0.65, fbm(x * 0.03, z * 0.03, 2)));
    if (h < 0.0) c.copy(P.bank);
    if (parts.sd < 12 && m < 0.5) c.copy(P.sand);
    if (m > 0.05) {
      const k = smoothstep(4, 40, h);
      c.lerp(P.slope, smoothstep(0.05, 0.4, m));
      c.lerp(P.mountain, k);
      c.lerp(P.peak, smoothstep(55, 95, h));
    }
    c.multiplyScalar(0.97 + vnoise(x * 0.5, z * 0.5) * 0.06);
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.computeVertexNormals();
  const mat = toon('#ffffff', { vertexColors: true });
  if (style.grid > 0) addGrid(mat, style);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  mesh.name = 'terrain';
  return mesh;
}

// 地面淡金网格线
function addGrid(mat, style) {
  const gc = new THREE.Color(style.accent);
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uGridColor = { value: gc };
    sh.uniforms.uGrid = { value: style.grid };
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWP;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWP = (modelMatrix*vec4(transformed,1.)).xyz;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vWP; uniform vec3 uGridColor; uniform float uGrid;')
      .replace('#include <dithering_fragment>', `
        vec2 g = abs(fract(vWP.xz/12.0 + 0.5) - 0.5) / fwidth(vWP.xz/12.0);
        float line = 1.0 - min(min(g.x, g.y), 1.0);
        float fade = 1.0 - smoothstep(120.0, 320.0, length(vWP.xz - vec2(0.0, -30.0)));
        gl_FragColor.rgb = mix(gl_FragColor.rgb, uGridColor, line * uGrid * 0.45 * fade);
        #include <dithering_fragment>`);
  };
}

// 和地形同一张网格：第 j 行 = z 方向，第 i 列 = x 方向（PlaneGeometry 转平后的顶点顺序）
function heightTexture() {
  const N = TER.seg + 1, data = new Uint8Array(N * N * 4);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const h = heightGrid ? heightGrid[j * N + i] : rawHeight(-TER.size / 2 + (i / (N - 1)) * TER.size, -60 - TER.size / 2 + (j / (N - 1)) * TER.size);
    const v = Math.round(Math.min(1, Math.max(0, (h + 12) / 24)) * 255);
    const k = (j * N + i) * 4;
    data[k] = data[k + 1] = data[k + 2] = v; data[k + 3] = 255;
  }
  const t = new THREE.DataTexture(data, N, N);
  t.magFilter = t.minFilter = THREE.LinearFilter;
  t.needsUpdate = true;
  return t;
}

export function buildWater(style) {
  const geo = new THREE.PlaneGeometry(4200, 4200, 240, 240).rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) pos.setY(i, WATER_Y - drop(pos.getX(i), pos.getZ(i)));
  const lin = (h) => new THREE.Color(h);
  const uniforms = {
    uTime: { value: 0 }, uHeight: { value: heightTexture() },
    uBounds: { value: new THREE.Vector4(-TER.size / 2, -60 - TER.size / 2, TER.size, TER.size) },
    uWater: { value: lin(style.water) }, uDeep: { value: lin(style.waterDeep) }, uLine: { value: lin(style.waterLine) }, uFoam: { value: lin(style.foam) },
    uFogColor: { value: lin(style.fog) }, uFogNear: { value: style.fogNear }, uFogFar: { value: style.fogFar },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: /* glsl */`
      varying vec3 vW; varying float vDist;
      void main(){ vec4 w = modelMatrix*vec4(position,1.); vW = w.xyz; vec4 mv = viewMatrix*w; vDist = -mv.z; gl_Position = projectionMatrix*mv; }`,
    fragmentShader: /* glsl */`
      uniform float uTime; uniform sampler2D uHeight; uniform vec4 uBounds;
      uniform vec3 uWater, uDeep, uLine, uFoam, uFogColor; uniform float uFogNear, uFogFar;
      varying vec3 vW; varying float vDist;
      float hash21(vec2 p){ p = fract(p*vec2(123.34, 456.21)); p += dot(p, p+45.32); return fract(p.x*p.y); }
      float vnoise(vec2 p){ vec2 i=floor(p), f=fract(p); vec2 u=f*f*(3.-2.*f);
        return mix(mix(hash21(i),hash21(i+vec2(1,0)),u.x), mix(hash21(i+vec2(0,1)),hash21(i+vec2(1,1)),u.x), u.y); }
      void main(){
        vec2 p = vW.xz;
        vec2 uv = (p - uBounds.xy)/uBounds.zw;
        float h = -12.;
        if (uv.x>0. && uv.x<1. && uv.y>0. && uv.y<1.) h = texture2D(uHeight, uv).r*24. - 12.;
        float depth = max(${WATER_Y.toFixed(2)} - h, 0.);
        vec3 c = mix(uWater, uDeep, smoothstep(1.0, 8.0, depth));
        // 水波纹线（像视频里的细波浪线）
        float wv = p.y*0.42 + sin(p.x*0.16 + uTime*0.5)*1.1 + vnoise(p*0.05)*2.0;
        float band = abs(fract(wv) - 0.5);
        float aa = fwidth(wv);
        float line = 1.0 - smoothstep(0.035, 0.035 + aa*1.5, band);
        float far = smoothstep(500.0, 160.0, vDist);
        c = mix(c, uLine, line * 0.55 * far * (0.6 + 0.4*vnoise(p*0.03 + uTime*0.05)));
        // 一道道往岸边推的浪
        float shore = 1.0 - smoothstep(0.0, 7.0, depth);
        float w = fract(depth*0.22 + uTime*0.18);
        float crest = smoothstep(0.84, 0.95, w) * (1.0 - smoothstep(0.95, 1.0, w));
        float edge = 1.0 - smoothstep(0.0, 0.35, depth);
        float foam = max(crest * shore * (0.5 + 0.5*vnoise(p*0.15 + uTime*0.3)), edge);
        c = mix(c, uFoam, clamp(foam, 0., 1.) * 0.9);
        float f = smoothstep(uFogNear, uFogFar, vDist);
        gl_FragColor = vec4(mix(c, uFogColor, f), 1.0);
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'water';
  mesh.receiveShadow = false;
  return mesh;
}

export function buildSky(style) {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { uTop: { value: new THREE.Color(style.sky[0]) }, uBot: { value: new THREE.Color(style.sky[1]) }, uFog: { value: new THREE.Color(style.fog) } },
    vertexShader: 'varying vec3 vD; void main(){ vD = normalize(position); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }',
    fragmentShader: `uniform vec3 uTop, uBot, uFog; varying vec3 vD;
      void main(){ float y = vD.y; vec3 c = mix(uBot, uTop, smoothstep(0.0, 0.6, y)); c = mix(uFog, c, smoothstep(-0.05, 0.12, y));
        gl_FragColor = vec4(c, 1.);
        #include <colorspace_fragment>
      }`,
  });
  const m = new THREE.Mesh(new THREE.SphereGeometry(3000, 32, 16), mat);
  m.name = 'sky';
  m.userData.noOutline = true;
  m.frustumCulled = false;
  return m;
}

// 地块位置：避开湖、河、海岸，彼此留出距离
export function plotSites(n = 20) {
  const rng = mulberry32(77);
  const out = [];
  const pts = [];
  for (let gz = -190; gz <= 160; gz += 46) {
    for (let gx = -200; gx <= 200; gx += 54) {
      const x = gx + (Math.round(gz / 46) % 2 ? 27 : 0) + (rng() - 0.5) * 14;
      const z = gz + (rng() - 0.5) * 12;
      pts.push([x, z]);
    }
  }
  const ok = ([x, z]) => {
    if (Math.hypot(x - LAKE.x, z - LAKE.z) < lakeR(x, z) + 26) return false;
    if (distRiver(x, z) < 25) return false;
    if (shoreDist(x, z) < 42) return false;
    if (mountainFactor(x, z) > 0.02) return false;
    return true;
  };
  const good = pts.filter(ok).sort((a, b) => Math.hypot(a[0], a[1] + 40) - Math.hypot(b[0], b[1] + 40));
  for (const p of good) {
    if (out.every((q) => Math.hypot(q[0] - p[0], q[1] - p[1]) > 47)) out.push(p);
    if (out.length >= n) break;
  }
  return out;
}
