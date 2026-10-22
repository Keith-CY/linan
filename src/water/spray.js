// Spray and mist puffs: instanced soft billboards on a looping life cycle driven by engine time (one draw call).
// Used by the tidal bore (src/modules/tide.js): dense spray boiling off the breaking crest, droplet streaks flung up at
// the lip, white water heaving on the roller, a mist plume drifting away behind the front.
//
// Four particle kinds (iL.y):
//   1 rising mist   — wispy, eroded cloud rising and drifting with the wind (low opacity, big)
//   2 churn spray   — dense granular puffs boiling up from the crest (short life)
//   3 droplet streaks — thin motion-blurred jets thrown up and out of the lip (ballistic)
//   4 boil          — torn domes of white water standing on the roller
// Density comes from a world-space value-noise field scaled by the puff size, so overlapping puffs merge into one
// churning mass; it erodes with age. Lit with sky ambient + sun × a Henyey-Greenstein phase, premultiplied output with
// the shared aerial perspective. The whole system moves with uOffset (the bore front travelling across the river).
// Derived from Athenaion's water/mist.js (MIT, see NOTICE): the particle kinds, the life cycle and the shading are
// theirs; the moving frame, the bore's sky / sun coupling and the soft water contact are ours.
import * as THREE from 'three';
import { ATMO_GLSL, atmoUniforms } from '../core/atmosphere.js';
import { NOISE_GLSL } from '../core/glsl.js';
import { SKY } from '../core/sky.js';

const VERT = /* glsl */`
attribute vec3 iPos;      // base centre (at time 0, before uOffset)
attribute vec4 iP;        // size (m), seed, life (s), phase
attribute vec4 iM;        // initial velocity xyz (m/s), growth
attribute vec4 iL;        // density, kind, gravity (m/s^2, down), stretch
uniform float uTime;
uniform vec3 uOffset;
uniform vec3 uWind;
uniform float uLevel;
varying vec2 vUv; varying vec3 vW; varying float vA; varying float vSeed; varying float vAge;
varying float vKind; varying float vSize; varying vec2 vSun2;
uniform vec3 uSunDir;
void main(){
  float life = max(iP.z, 0.1);
  float age = fract(uTime / life + iP.w);
  float t = age * life;
  float kind = iL.y;
  float g = iL.z;
  vec3 c = iPos + uOffset + iM.xyz * t + vec3(0.0, -0.5 * g * t * t, 0.0) + uWind * t * (kind < 1.5 ? 1.0 : 0.3);
  float size = iP.x * (0.55 + iM.w * age);
  if (kind > 3.5) c.y = min(c.y, uLevel + size * iL.w * 0.7);
  vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  vec2 q = position.xy;
  vec3 wp;
  if (kind > 3.5) {
    // boil: upright quad standing on the water (world-vertical: the mirrored reflection camera's 'up' points down)
    wp = c + right * q.x * size + vec3(0.0, 1.0, 0.0) * q.y * size * iL.w;
  } else if (kind > 2.5) {
    // droplet streak: thin quad along the screen-projected velocity (motion blur)
    vec3 vel = iM.xyz + vec3(0.0, -g * t, 0.0);
    vec3 vv = (viewMatrix * vec4(vel, 0.0)).xyz;
    vec2 ax = normalize(vv.xy + vec2(1e-4, 0.0));
    vec3 A = right * ax.x + up * ax.y, S = right * -ax.y + up * ax.x;
    float len = iP.x * (0.35 + 0.65 * clamp(length(vel) / 8.0, 0.0, 1.0));
    wp = c + A * q.y * len * iL.w + S * q.x * iP.x * 0.07;
  } else {
    float ang = iP.y * 6.2831 + age * (iP.y - 0.5) * 1.6;
    float ca = cos(ang), sa = sin(ang);
    vec2 rq = vec2(ca * q.x - sa * q.y, sa * q.x + ca * q.y);
    wp = c + right * rq.x * size + up * rq.y * size * iL.w;
  }
  vW = wp; vUv = position.xy * 2.0; vSeed = iP.y; vAge = age; vKind = kind; vSize = size;
  float fin = kind > 1.5 ? smoothstep(0.0, 0.16, age) : smoothstep(0.0, 0.22, age);
  float fout = kind > 1.5 ? 1.0 - smoothstep(0.45, 1.0, age) : 1.0 - smoothstep(0.4, 1.0, age);
  vA = iL.x * fin * fout;
  vec3 sv = (viewMatrix * vec4(normalize(uSunDir), 0.0)).xyz;
  vSun2 = sv.xy;
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}
`;

const FRAG = /* glsl */`
${ATMO_GLSL}
${NOISE_GLSL}
uniform float uTime;
uniform float uLevel;
uniform vec3 uSunIrr;
uniform vec4 uMistK;      // x: global opacity, y: sun gain, z: ambient gain, w: erosion
uniform vec3 uTint;       // silt in the spray (the Qiantang's is cream-brown)
varying vec2 vUv; varying vec3 vW; varying float vA; varying float vSeed; varying float vAge;
varying float vKind; varying float vSize; varying vec2 vSun2;
void main(){
  float r2 = dot(vUv, vUv);
  if (vKind < 3.5 && r2 > 1.0) discard;
  float a, lit, n = 0.5;
  if (vKind > 3.5) {
    float f = 3.0 / max(vSize, 0.5);
    vec3 np = vW * f * vec3(1.0, 0.6, 1.0) + vec3(vSeed * 17.3, -uTime * 0.9, vSeed * 5.1);
    n = cgVfbm3(np, 4);
    float yy = vUv.y * 0.5 + 0.5;
    float n2 = cgVnoise3(np * 3.4 + vec3(0.0, -uTime * 1.6, 0.0));
    float dd = length(vec2(vUv.x, yy * 1.1)) + (n - 0.5) * 0.65 + (n2 - 0.5) * 0.3 + vAge * 0.1;
    float dome = 1.0 - smoothstep(0.38, 0.9, dd);
    a = dome * (0.5 + 0.5 * smoothstep(0.3, 0.7, n)) * (0.6 + 0.4 * smoothstep(0.2, 0.65, n2 + 0.25 * (1.0 - yy))) * vA * (1.0 - smoothstep(0.8, 1.0, abs(vUv.x))) * (1.0 - smoothstep(0.75, 1.0, vUv.y));
    lit = clamp(0.62 + 0.8 * (n - 0.5) + 0.25 * (n2 - 0.5) + 0.3 * yy, 0.2, 1.0);
  } else if (vKind > 2.5) {
    float across = vUv.x, along = vUv.y;
    float core = exp(-across * across * 9.0) * (1.0 - along * along);
    float beads = 0.55 + 0.45 * cgVnoise2(vec2(vSeed * 37.0, along * 3.0 + vSeed * 11.0));
    a = core * beads * vA;
    lit = 1.0;
  } else {
    float f = (vKind > 1.5 ? 2.4 : 1.5) / max(vSize, 0.5);
    vec3 np = vW * f + vec3(vSeed * 17.3, -uTime * 0.12 - vAge * 0.9, vSeed * 5.1);
    n = cgVfbm3(np, 4);
    float n2 = cgVnoise3(np * 3.1 + vec3(0.0, uTime * 0.3, 0.0));
    float billow = n * 0.75 + n2 * 0.25;
    float ero = uMistK.w * 0.15 + vAge * (vKind > 1.5 ? 0.22 : 0.3);
    float dn = billow - r2 * (vKind > 1.5 ? 0.75 : 0.55) - ero - (vKind > 1.5 ? 0.1 : 0.16);
    float body = smoothstep(1.0, 0.78, r2);
    float wisp = vKind > 1.5 ? smoothstep(-0.08, 0.36, dn) * (0.6 + 0.4 * smoothstep(0.3, 0.72, n2)) * (1.0 - 0.5 * smoothstep(0.3, 1.0, r2)) : smoothstep(-0.14, 0.42, dn);
    a = body * wisp * vA;
    if (vKind > 0.5 && vKind < 1.5) {
      float soft = smoothstep(7.0, 16.0, vSize);
      a = mix(a, exp(-3.2 * r2) * clamp(0.35 + 1.1 * (billow - 0.35), 0.0, 1.0) * vA, soft);
    }
    float sl = length(vSun2);
    float side = dot(vUv, vSun2 / max(sl, 1e-3)) * min(sl * 1.4, 1.0);
    lit = clamp(0.62 + 0.38 * side + 0.5 * (billow - 0.55) + 0.18 * vUv.y, 0.12, 1.0);
    if (vKind > 0.5 && vKind < 1.5) lit = 0.72 + 0.28 * lit;
  }
  // soft contact with the water, the camera
  a *= smoothstep(uLevel - 0.3, uLevel + (vKind > 3.5 ? 0.12 : 0.9), vW.y);
  float dc = distance(cameraPosition, vW);
  a *= smoothstep(1.0, 6.0, dc) * smoothstep(0.4, 1.6, dc / max(vSize, 0.5));
  a *= uMistK.x;
  if (a < 0.002) discard;
  vec3 V = normalize(cameraPosition - vW);
  float mu = dot(-V, uSunDir);
  float g = 0.6;
  float hg = (1.0 - g * g) / pow(max(1.0 + g * g - 2.0 * g * mu, 1e-3), 1.5) / 12.566;
  vec3 sunC = uSunIrr * 0.35;
  vec3 col = uHazeColor * uMistK.z * (0.95 + 0.35 * lit)
           + sunC * uMistK.y * ((0.04 + 0.2 * lit) + min(2.4 * hg, 1.6));
  col *= uTint;
  vec3 A = atmoApply(vec3(0.0), vW);
  vec3 B = atmoApply(vec3(1.0), vW) - A;
  gl_FragColor = vec4(col * a * B + A * a, a);
}
`;

export class SpraySystem {
  constructor(engine, { level = 0 } = {}) {
    this.engine = engine;
    this.level = level;
    this.items = [];
  }
  /** add a puff: { pos [x,y,z], size m, life s, vel [vx,vy,vz], growth, density, kind 1..4, gravity m/s², stretch, seed?, phase? } */
  add(p) { this.items.push(p); }

  build(rng) {
    const n = this.items.length;
    if (!n) return null;
    const quad = new THREE.PlaneGeometry(1, 1);
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = quad.index;
    geo.setAttribute('position', quad.getAttribute('position'));
    const iPos = new Float32Array(n * 3), iP = new Float32Array(n * 4), iM = new Float32Array(n * 4), iL = new Float32Array(n * 4);
    // draw the thin mist first (it sits behind and around the dense spray), then the boil, spray, streaks last
    const order = (it) => (it.kind === 1 ? 0 : it.kind === 4 ? 1 : it.kind === 2 ? 2 : 3);
    this.items.sort((a, b) => order(a) - order(b) || a.pos[1] - b.pos[1]);
    this.items.forEach((it, i) => {
      iPos.set(it.pos, i * 3);
      iP.set([it.size, it.seed ?? rng.random(), it.life ?? 10, it.phase ?? rng.random()], i * 4);
      iM.set([...(it.vel || [0, 0.4, 0]), it.growth ?? 0.8], i * 4);
      iL.set([it.density ?? 0.1, it.kind ?? 1, it.gravity ?? 0, it.stretch ?? 1], i * 4);
    });
    geo.setAttribute('iPos', new THREE.InstancedBufferAttribute(iPos, 3));
    geo.setAttribute('iP', new THREE.InstancedBufferAttribute(iP, 4));
    geo.setAttribute('iM', new THREE.InstancedBufferAttribute(iM, 4));
    geo.setAttribute('iL', new THREE.InstancedBufferAttribute(iL, 4));
    geo.instanceCount = n;
    this.uniforms = {
      ...atmoUniforms(),
      uTime: { value: 0 },
      uOffset: { value: new THREE.Vector3() },
      uLevel: { value: this.level },
      uWind: { value: new THREE.Vector3(-1.2, 0.0, -0.6) },
      uSunIrr: SKY.uSunIrr,
      uMistK: { value: new THREE.Vector4(1.0, 1.0, 0.9, 0.0) },
      uTint: { value: new THREE.Color(1.0, 0.97, 0.92) },
    };
    const mat = new THREE.ShaderMaterial({
      name: 'boreSpray',
      uniforms: this.uniforms,
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true, depthWrite: false, depthTest: true,
      blending: THREE.CustomBlending, blendEquation: THREE.AddEquation,
      blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
      blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor,
      fog: false,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = 'boreSpray';
    mesh.frustumCulled = false;
    mesh.renderOrder = 10;
    mesh.castShadow = false; mesh.receiveShadow = false;
    mesh.userData.castShadow = false; mesh.userData.receiveShadow = false;
    mesh.userData.noPatch = true; mesh.userData.noHeightCapture = true;
    this.mesh = mesh;
    this.count = n;
    return mesh;
  }
}
