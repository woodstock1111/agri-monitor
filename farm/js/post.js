// 描线后期：法线 + 深度找边，画成墨线（带一点抖动），叠纸纹
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

const LineShader = {
  uniforms: {
    tDiffuse: { value: null }, tNormal: { value: null }, tDepth: { value: null },
    uRes: { value: new THREE.Vector2(1, 1) }, uNear: { value: 1 }, uFar: { value: 1000 },
    uLine: { value: new THREE.Color() }, uStrength: { value: 1 }, uWidth: { value: 1 }, uWobble: { value: 0 }, uPaper: { value: 0 },
  },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }',
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse, tNormal, tDepth;
    uniform vec2 uRes; uniform float uNear, uFar, uStrength, uWidth, uWobble, uPaper;
    uniform vec3 uLine;
    varying vec2 vUv;
    float hash21(vec2 p){ p = fract(p*vec2(123.34, 456.21)); p += dot(p, p+45.32); return fract(p.x*p.y); }
    float vnoise(vec2 p){ vec2 i=floor(p), f=fract(p); vec2 u=f*f*(3.-2.*f);
      return mix(mix(hash21(i),hash21(i+vec2(1,0)),u.x), mix(hash21(i+vec2(0,1)),hash21(i+vec2(1,1)),u.x), u.y); }
    float linZ(float d){ float z = d*2.-1.; return (2.*uNear*uFar)/(uFar+uNear - z*(uFar-uNear)); }
    void main(){
      vec2 px = 1.0/uRes;
      vec2 fc = vUv*uRes;
      // 墨线轻微抖动
      vec2 wob = (vec2(vnoise(fc*0.05), vnoise(fc*0.05+31.7)) - 0.5) * 2.0 * uWobble;
      vec2 uv = vUv + wob*px;
      float w = uWidth;
      vec3 n0 = texture2D(tNormal, uv).rgb;
      vec3 n1 = texture2D(tNormal, uv + vec2( w, 0)*px).rgb;
      vec3 n2 = texture2D(tNormal, uv + vec2(-w, 0)*px).rgb;
      vec3 n3 = texture2D(tNormal, uv + vec2(0,  w)*px).rgb;
      vec3 n4 = texture2D(tNormal, uv + vec2(0, -w)*px).rgb;
      float dn = length(n1-n2) + length(n3-n4);
      float d0 = texture2D(tDepth, uv).r;
      float z0 = linZ(d0);
      float z1 = linZ(texture2D(tDepth, uv + vec2( w, 0)*px).r);
      float z2 = linZ(texture2D(tDepth, uv + vec2(-w, 0)*px).r);
      float z3 = linZ(texture2D(tDepth, uv + vec2(0,  w)*px).r);
      float z4 = linZ(texture2D(tDepth, uv + vec2(0, -w)*px).r);
      float dz = (abs(z1 + z2 - 2.*z0) + abs(z3 + z4 - 2.*z0)) / max(z0, 1.0);
      float eN = smoothstep(0.45, 0.9, dn);
      float eD = smoothstep(0.012, 0.04, dz);
      float edge = max(eN, eD);
      // 远处线条变淡
      edge *= 1.0 - smoothstep(280.0, 700.0, z0);
      // 干笔效果
      edge *= mix(1.0, 0.55 + 0.45*vnoise(fc*vec2(0.08, 0.3)), uWobble*0.6);
      edge *= uStrength;
      vec3 col = texture2D(tDiffuse, vUv).rgb;
      col = mix(col, uLine, edge);
      // 纸纹
      if (uPaper > 0.0) {
        float fib = vnoise(fc*vec2(0.9, 0.12)) * 0.5 + vnoise(fc*0.35)*0.5;
        float grain = hash21(floor(fc)) - 0.5;
        col *= 1.0 - uPaper*(0.05*fib + 0.03*grain);
        vec2 q = vUv - 0.5;
        col *= 1.0 - dot(q,q)*0.25*uPaper;
      }
      gl_FragColor = vec4(col, 1.0);
    }`,
};

export class LineComposer {
  constructor(renderer, scene, camera, style) {
    this.renderer = renderer; this.scene = scene; this.camera = camera;
    this.normalMat = new THREE.MeshNormalMaterial();
    this.rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType });
    this.rt.depthTexture = new THREE.DepthTexture(1, 1);
    this.composer = new EffectComposer(renderer);
    this.composer.addPass(new RenderPass(scene, camera));
    this.line = new ShaderPass(LineShader);
    const u = this.line.uniforms;
    u.tNormal.value = this.rt.texture; u.tDepth.value = this.rt.depthTexture;
    u.uLine.value.set(style.line); u.uStrength.value = style.lineStrength; u.uWidth.value = style.lineWidth;
    u.uWobble.value = style.wobble; u.uPaper.value = style.paper;
    this.composer.addPass(this.line);
    this.composer.addPass(new OutputPass());
    this.enabled = true; // 低画质时关掉描线，直接画
    this._hidden = [];
    this._cc = new THREE.Color();
  }

  setSize(w, h, pr) {
    this.composer.setPixelRatio(pr);
    this.composer.setSize(w, h);
    this.rt.setSize(w * pr, h * pr);
    this.line.uniforms.uRes.value.set(w * pr, h * pr);
  }

  render() {
    const { renderer, scene, camera } = this;
    if (!this.enabled) { renderer.render(scene, camera); return; }
    const hidden = this._hidden;
    hidden.length = 0;
    scene.traverse((o) => { if (o.userData.noOutline && o.visible) { o.visible = false; hidden.push(o); } });
    const bg = scene.background, fog = scene.fog;
    scene.background = null; scene.fog = null;
    scene.overrideMaterial = this.normalMat;
    const cc = renderer.getClearColor(this._cc), ca = renderer.getClearAlpha();
    renderer.setClearColor(0x000000, 1);
    renderer.setRenderTarget(this.rt);
    renderer.render(scene, camera);
    renderer.setRenderTarget(null);
    renderer.setClearColor(cc, ca);
    scene.overrideMaterial = null; scene.background = bg; scene.fog = fog;
    for (const o of hidden) o.visible = true;
    const u = this.line.uniforms;
    u.uNear.value = camera.near; u.uFar.value = camera.far;
    this.composer.render();
  }
}
