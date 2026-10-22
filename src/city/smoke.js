// Kitchen smoke rising from the roofs of the morning city (ref07): thin plumes, bending away with a light wind,
// spreading and fading as they rise, lit like the haze (sky ambient + forward-scattered sun), aerial perspective
// applied. Cheap: one camera-facing card per plume (cards face the shot-7 camera), one draw for all of them.
//
//   build(engine, plan) → { group, uniforms, sources }
// Visible in the shots whose look asks for it: LOOKS[id].city.smoke (0..1) wins, default 1 in shot 7, 0 elsewhere.
// Uniforms (engine.registry.city.smoke.uniforms): uSmokeAmount, uSmokeWind (x, z m/s, rise m/s), uSmokeColor.
import * as THREE from 'three';
import { ATMO_GLSL, atmoUniforms } from '../core/atmosphere.js';
import { NOISE_GLSL } from '../core/glsl.js';
import { SKY } from '../core/sky.js';
import { SHOTS } from '../world/shots.js';
import { planCams } from '../world/plancams.js';
import { LOOKS } from '../world/looks.js';
import { hash01 } from '../core/rng.js';

export const SMOKE = {
  uSmokeAmount: { value: 1.0 },
  uSmokeWind: { value: new THREE.Vector3(-0.35, 0.15, 1.3) },  // drift x, z (m/s) and rise speed (m/s)
  uSmokeColor: { value: new THREE.Color(0.86, 0.87, 0.9) },
};

const VERT = /* glsl */`
attribute vec2 aCorner;     // x: -1..1 across, y: 0..1 up
attribute vec4 aPlume;      // source x, y, z, seed
attribute vec2 aSize;       // width at the top, height
varying vec2 vC;
varying float vSeed;
varying vec3 vW;
uniform vec3 uSmokeWind;
uniform vec3 uCamFwd;
void main(){
  vec3 src = aPlume.xyz;
  float h = aSize.y * aCorner.y;
  // the plume bends downwind as it rises (the lean grows with height)
  vec2 lean = uSmokeWind.xy / max(uSmokeWind.z, 0.1) * h * aCorner.y;
  vec3 c = src + vec3(lean.x, h, lean.y);
  // face the camera around the vertical axis
  vec3 side = normalize(cross(vec3(0.0, 1.0, 0.0), uCamFwd));
  float w = mix(3.5, aSize.x, pow(aCorner.y, 0.6));
  vec3 p = c + side * aCorner.x * w * 0.5;
  vec4 wp = modelMatrix * vec4(p, 1.0);
  vW = wp.xyz; vC = aCorner; vSeed = aPlume.w;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;
const FRAG = /* glsl */`
varying vec2 vC;
varying float vSeed;
varying vec3 vW;
uniform float uTime;
uniform float uSmokeAmount;
uniform vec3 uSmokeWind;
uniform vec3 uSmokeColor;
uniform vec3 uSunIrr;
${ATMO_GLSL}
${NOISE_GLSL}
void main(){
  float y = vC.y;
  // turbulent density advected upward
  vec3 q = vec3(vC.x * 1.6, y * 4.0 - uTime * uSmokeWind.z * 0.08, vSeed * 17.0);
  float n = cgFbm3(q * vec3(1.0, 1.0, 1.0), 4) * 0.5 + 0.5;
  float m = cgFbm3(q * 2.7 + 5.0, 3) * 0.5 + 0.5;
  // a soft column near the roof that opens into a drifting veil higher up
  float spread = mix(0.18, 0.95, smoothstep(0.0, 0.7, y));
  float core = 1.0 - smoothstep(spread * 0.25, spread, abs(vC.x + (n - 0.5) * 0.9 * y));
  float d = core * smoothstep(0.2, 0.75, n * 0.7 + m * 0.4 + 0.1 * (1.0 - y));
  d *= smoothstep(0.0, 0.05, y) * pow(1.0 - y, 1.2) * mix(1.0, 0.45, y);
  float a = clamp(d * uSmokeAmount * 0.75, 0.0, 0.7);
  if (a < 0.003) discard;
  vec3 V = normalize(vW - cameraPosition);
  float mu = dot(V, uSunDir);
  float ph = 0.45 + 1.4 * pow(max(mu, 0.0), 5.0) + 0.3 * pow(max(mu, 0.0), 1.5);
  vec3 sunL = uSunColor * length(uSunIrr) * 0.05 * ph;
  vec3 amb = uHazeColor * 0.5;
  vec3 col = uSmokeColor * (amb + sunL) * (0.8 + 0.3 * m);
  col = atmoApply(col, vW);
  gl_FragColor = vec4(col * a, a);
}
`;

export async function build(engine, plan) {
  const s7 = SHOTS.find((s) => s.id === 7);
  if (!s7) return null;
  const fx = s7.target[0] - s7.pos[0], fz = s7.target[2] - s7.pos[2], fl = Math.hypot(fx, fz);
  // sources: houses in the view of the shot-7 cameras (the photographic one and, in the ink look, the ink one) between
  // 140 m and 1.6 km, spread over the frame. ink07 (smoke rising all over the city): ~40 thin plumes
  const cams = planCams().filter((c) => c.id === 7).map((c) => { const ax = c.target[0] - c.pos[0], az = c.target[2] - c.pos[2], l = Math.hypot(ax, az); return { p: c.pos, fx: ax / l, fz: az / l }; });
  const cand = [];
  plan.houses.forEach((h, i) => {
    if (h.hamlet || h.village || h.suburb) return;
    let best = null;
    for (const c of cams) {
      const dx = h.x - c.p[0], dz = h.z - c.p[2], d = Math.hypot(dx, dz);
      if (d < 150 || d > 1600) continue;
      if (Math.acos((dx * c.fx + dz * c.fz) / d) > 0.55) continue;
      if (!best || d < best) best = d;
    }
    if (best === null) return;
    const r = hash01(i, 77);
    if (r > 0.02 * (1 + best / 500)) return;
    cand.push({ h, d: best, r: hash01(i, 78) });
  });
  // pick spread out: no two plumes within 45 m
  cand.sort((a, b) => a.r - b.r);
  const sources = [];
  for (const c of cand) {
    if (sources.length >= 40) break;
    if (sources.some((q) => Math.hypot(q.h.x - c.h.x, q.h.z - c.h.z) < 45)) continue;
    sources.push(c);
  }
  const n = sources.length;
  const corners = [[-1, 0], [1, 0], [1, 1], [-1, 1]];
  const pos = new Float32Array(n * 4 * 3), corner = new Float32Array(n * 4 * 2), plume = new Float32Array(n * 4 * 4), size = new Float32Array(n * 4 * 2);
  const idx = [];
  sources.forEach(({ h, d }, i) => {
    const seed = hash01(i, 3, 9);
    const top = h.y + 9 + 3 * hash01(i, 5);
    const H = 22 + 24 * hash01(i, 7) * (0.6 + d / 2000), W = 16 + 16 * hash01(i, 11) * (0.7 + d / 1500);
    corners.forEach(([cx, cy], k) => {
      const j = i * 4 + k;
      pos.set([h.x, top, h.z], j * 3);
      corner.set([cx, cy], j * 2);
      plume.set([h.x, top, h.z, seed], j * 4);
      size.set([W, H], j * 2);
    });
    const b = i * 4;
    idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aCorner', new THREE.BufferAttribute(corner, 2));
  g.setAttribute('aPlume', new THREE.BufferAttribute(plume, 4));
  g.setAttribute('aSize', new THREE.BufferAttribute(size, 2));
  g.setIndex(idx);
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(s7.pos[0] + fx / fl * 800, 30, s7.pos[2] + fz / fl * 800), 1200);
  const camFwd = { value: new THREE.Vector3(fx / fl, 0, fz / fl) };
  const uniforms = { uTime: { value: 0 }, ...SMOKE, ...atmoUniforms(), uSunIrr: SKY.uSunIrr, uCamFwd: camFwd };
  const mat = new THREE.ShaderMaterial({
    uniforms, vertexShader: VERT, fragmentShader: FRAG,
    transparent: true, depthWrite: false, depthTest: true,
    blending: THREE.CustomBlending, blendEquation: THREE.AddEquation,
    blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor, blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor,
    side: THREE.DoubleSide, fog: false,
  });
  mat.name = 'citySmoke';
  const mesh = new THREE.Mesh(g, mat);
  mesh.name = 'city:smoke'; mesh.renderOrder = 450; mesh.frustumCulled = false;
  mesh.userData.noPatch = true; mesh.userData.noHeightCapture = true;
  mesh.castShadow = false; mesh.receiveShadow = false; mesh.userData.castShadow = false; mesh.userData.receiveShadow = false;
  const group = new THREE.Group(); group.name = 'city:smoke'; group.add(mesh);
  engine.add(group, { castShadow: false, receiveShadow: false });
  engine.registry.water?.reflection?.hidden?.push(mesh);
  engine.onUpdate((t) => { uniforms.uTime.value = t; });
  engine.onShot((shot) => {
    const amt = shot.citySmoke ?? LOOKS[shot.id]?.city?.smoke ?? (shot.id === 7 ? 1 : 0);
    SMOKE.uSmokeAmount.value = amt;
    group.visible = amt > 0;
    // cards face this shot's camera when it has one
    if (shot.pos && shot.target) { const dx = shot.target[0] - shot.pos[0], dz = shot.target[2] - shot.pos[2], l = Math.hypot(dx, dz) || 1; camFwd.value.set(dx / l, 0, dz / l); }
  });
  console.log(`[city] smoke: ${n} plumes`);
  return { group, uniforms: SMOKE, sources: sources.map(({ h }) => [h.x, h.z]) };
}
