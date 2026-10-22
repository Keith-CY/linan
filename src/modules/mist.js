// MIST: morning mist lying on West Lake and in the low valleys ("薄雾贴着水面").
//
// The density is one 3D field (src/water/mistfield.js): drifting banks with clear gaps over the lake and over low
// ground, dense at the water and thinning upward, with billows that are continuous in height. It is drawn as a stack
// of horizontal sheets (0.25 … uLmTop m), each the integral of the field over its own slab: opacity
// 1 - exp(-sigma · slab / |V.y|) (the slant path through the slab, capped at grazing angles). Because neighbouring
// sheets sample the same continuous field and every accumulated sample shifts the stack by a fraction of a slab
// (sub-frame jitter), the sheets add up to a volume instead of stacking into stripes (the old independent sheets
// banded). Lit like the haze: sky ambient + sun with forward scattering, then the shared aerial perspective.
// The water surface reads the same field to veil the mirror image (the reflected ray crosses the layer too).
import * as THREE from 'three';
import { ATMO_GLSL, atmoUniforms } from '../core/atmosphere.js';
import { NOISE_GLSL } from '../core/glsl.js';
import { SKY } from '../core/sky.js';
import * as L from '../world/layout.js';
import { LOOKS } from '../world/looks.js';
import { LAKE_MIST, LAKE_MIST_GLSL, bindMistHeights } from '../water/mistfield.js';

/** mist per shot (LAKE_MIST uniforms); LOOKS[id].mist and shot.mist override. Shots not listed: no sheets. */
export const MIST_SHOTS = {
  // ref01: banks on the lake veiling the far water and the island bases, mist at the feet of every hill layer
  1: { uLmAmount: 1.0, uLmSigma: 0.0095, uLmTop: 28, uLmScale: [800, 170, 0.66], uLmValley: [9.0, 1.0, 0.6, 0], uLmCenter: [-100, 0, 2400, 2800] },
  // ref02: the far water dissolves within 1–2 km; the near causeway clear
  2: { uLmAmount: 1.0, uLmSigma: 0.0045, uLmTop: 14, uLmScale: [520, 140, 0.6], uLmValley: [5.0, 0.6, 0.45, 0] },
  // ref05: a faint veil over the night lake
  5: { uLmAmount: 0.35, uLmSigma: 0.003, uLmTop: 10, uLmScale: [500, 140, 0.5], uLmValley: [5.0, 0.3, 0.4, 0] },
};
/** (kept for older imports) the shared mist uniforms */
export const MIST = LAKE_MIST;

const VERT = /* glsl */`
uniform float uLayer; uniform float uSlab; uniform float uFrameM;
varying vec3 vW;
void main(){
  vec4 wp = modelMatrix * vec4(position, 1.0);
  // sub-frame jitter of the sheet height inside its slab: the accumulation integrates the slab continuously
  wp.y += (fract(uFrameM * 0.6180339 + uLayer * 7.31) - 0.5) * uSlab;
  vW = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;
const FRAG = /* glsl */`
varying vec3 vW;
uniform float uLayer;      // 0 bottom … 1 top
uniform float uSlab;       // slab thickness (m) this sheet stands for
uniform vec3 uSunIrr;
${ATMO_GLSL}
${NOISE_GLSL}
${LAKE_MIST_GLSL}
void main(){
  float g = lmGround(vW.xz);
  if (vW.y < g - 0.5) discard;
  float s = lmSigma(vW, g);
  // soft contact with the ground the mist lies on (no hard line where a sheet meets a bank)
  s *= smoothstep(-0.5, 2.5, vW.y - g);
  vec3 V = normalize(vW - cameraPosition);
  // slant path through this sheet's slab; grazing rays capped (a slab is a few hundred metres of mist at most)
  float path = uSlab / max(abs(V.y), uSlab / 420.0);
  float a = 1.0 - exp(-s * path);
  // no sheet structure right in front of the camera
  float cd = distance(cameraPosition, vW);
  a *= smoothstep(25.0, 140.0, cd);
  if (a < 0.0015) discard;
  float mu = dot(V, uSunDir);
  float ph = 0.35 + 1.6 * pow(max(mu, 0.0), 6.0) + 0.25 * pow(max(mu, 0.0), 1.5);
  vec3 sunL = uSunColor * length(uSunIrr) * 0.045 * ph;
  vec3 amb = uHazeColor * 0.55;
  vec3 col = uLmColor * (amb + sunL);
  // premultiplied, with the aerial perspective between the camera and the sheet
  vec3 A = atmoApply(vec3(0.0), vW);
  vec3 B = atmoApply(vec3(1.0), vW) - A;
  gl_FragColor = vec4(col * a * B + A * a, a);
}
`;

export async function build(engine) {
  const t0 = performance.now();
  const W = engine.registry.water;
  if (W?.maps) bindMistHeights(W.maps.near, W.maps.far);
  const n = engine.quality.name === 'preview' ? 10 : 16;   // explore: as the stills (shown only in a still view)
  const group = new THREE.Group();
  group.name = 'mist';
  const size = 26000;
  const geo = new THREE.PlaneGeometry(size, size, 1, 1).rotateX(-Math.PI / 2);
  const shared = { ...atmoUniforms(), ...LAKE_MIST, uSunIrr: SKY.uSunIrr, uFrameM: SKY.uFrame };
  for (let i = 0; i < n; i++) {
    const mat = new THREE.ShaderMaterial({
      name: 'lakeMist',
      uniforms: { ...shared, uLayer: { value: 0 }, uSlab: { value: 1 } },
      vertexShader: VERT, fragmentShader: FRAG,
      transparent: true, depthWrite: false, depthTest: true,
      blending: THREE.CustomBlending, blendEquation: THREE.AddEquation,
      blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
      blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor,
      side: THREE.DoubleSide, fog: false,
    });
    const m = new THREE.Mesh(geo, mat);
    m.frustumCulled = false;
    m.userData.noPatch = true; m.userData.noHeightCapture = true;
    m.castShadow = false; m.receiveShadow = false;
    m.userData.castShadow = false; m.userData.receiveShadow = false;
    group.add(m);
  }
  /** place the sheets for a layer thickness: denser near the water, where the mist is */
  const layout = (top) => {
    const ys = [];
    for (let i = 0; i <= n; i++) ys.push(0.25 + (top - 0.25) * Math.pow(i / n, 1.7));
    group.children.forEach((m, i) => {
      m.position.set(-100, L.WATER_LEVEL + 0.5 * (ys[i] + ys[i + 1]), 0);
      m.material.uniforms.uLayer.value = i / Math.max(1, n - 1);
      m.material.uniforms.uSlab.value = ys[i + 1] - ys[i];
    });
  };
  layout(LAKE_MIST.uLmTop.value);
  engine.add(group, { castShadow: false, receiveShadow: false });
  // the planar water reflection must not see the sheets (the water veils its mirror image with the same field)
  W?.reflection?.hidden.push(...group.children);
  engine.onUpdate((tm) => { LAKE_MIST.uLmTime.value = tm; });
  const defaults = Object.fromEntries(Object.entries(LAKE_MIST).filter(([k, u]) => !k.startsWith('t') && !k.endsWith('HB') && !k.endsWith('HFB') && k !== 'uLmTime' && !u.value?.isTexture)
    .map(([k, u]) => [k, u.value?.clone ? u.value.clone() : u.value]));
  engine.onShot((shot) => {
    for (const [k, v] of Object.entries(defaults)) { const u = LAKE_MIST[k]; if (u.value?.copy) u.value.copy(v); else u.value = v; }
    const look = { ...(LOOKS[shot.id]?.mist || {}) };
    const preset = MIST_SHOTS[shot.id] || (look.uLmAmount ? MIST_SHOTS[1] : null);
    const set = { ...(preset || {}), ...look, ...(shot.mist || {}) };
    // the looks' { uLmAmount } scales the preset (1 = as tuned here)
    if (preset && look.uLmAmount !== undefined) set.uLmAmount = (preset.uLmAmount ?? 1) * look.uLmAmount;
    if (shot.mist?.uLmAmount !== undefined) set.uLmAmount = shot.mist.uLmAmount;
    for (const [k, v] of Object.entries(set)) {
      const u = LAKE_MIST[k]; if (!u) continue;
      if (Array.isArray(v) && u.value?.isColor) u.value.setRGB(...v); else if (Array.isArray(v) && u.value?.fromArray) u.value.fromArray(v); else u.value = v;
    }
    layout(LAKE_MIST.uLmTop.value);
    // a pixel looks either up or down through the stack: draw the sheets farthest from the eye's height first
    const cy = (shot.pos || [0, 50, 0])[1];
    group.children.forEach((m) => { m.renderOrder = 500 + Math.round(100 - Math.abs(m.position.y - cy)); });
    group.visible = LAKE_MIST.uLmAmount.value > 0;
  });
  engine.registry.mist = { group, uniforms: LAKE_MIST };
  console.log(`[mist] ${n} sheets in ${Math.round(performance.now() - t0)} ms`);
}

// node tools/render.mjs --test mist --view N: terrain + water + mist with the shot's look (0: shot 1, 1: shot 2, 2: shot 5)
export async function test(engine) {
  const terrain = await import('./terrain.js');
  const water = await import('./water.js');
  for (const o of engine.scene.children) if (o.name === 'testGround') o.visible = false;
  const views = [
    { id: 1, pos: [276.4, 93, -2246], target: [269.8, 90, -2146.3], fov: 20 },
    { id: 2, pos: [-413.2, 2.5, 307.6], target: [-435.2, 23.3, 212.3], fov: 46 },
    { id: 5, pos: [125, 1.6, 720], target: [203.8, 3.1, 781.6], fov: 30 },
  ];
  await terrain.buildTerrain(engine, { cams: views });
  await water.build(engine);
  await build(engine);
  return { views: views.map((x) => ({ ...x, near: 0.5, far: 60000 })) };
}
