// The lake mist field ("薄雾贴着水面"), shared by the mist sheets (src/modules/mist.js) and the water surface
// (src/water/surface.js), so the mirror image is veiled by exactly the mist the sheets draw in the direct view.
//
// Density (extinction per metre) at a point p:
//   sigma(p) = uLmSigma * bank(p.xz) * profile(p.y - ground) * detail(p)
//   bank    — large drifting banks (hundreds of metres) with clear gaps, kept over the lake (elliptical field) and over
//             low ground (valley floors a few metres above the water, from the captured terrain height maps)
//   profile — dense at the water, thinning upward with scale height uLmTop * 0.35, gone above uLmTop
//   detail  — 3D billows (correlated in height, so a stack of sheets integrates as one volume, not as stripes)
// The vertical integral of sigma at a point is lmColumn(xz): the water shader attenuates the reflected ray by
// exp(-column / R.y) (a ray leaving the water at elevation sin = R.y crosses the layer over column / R.y).
import * as THREE from 'three';

export const LAKE_MIST = {
  uLmAmount: { value: 0.0 },          // 0 = no mist (looks / water presets turn it on per shot)
  uLmTop: { value: 18.0 },            // m above the ground: the layer is gone above this
  uLmSigma: { value: 0.0045 },        // extinction (1/m) at the water under a full bank
  uLmScale: { value: new THREE.Vector3(620, 150, 0.55) }, // bank size (m), billow size (m), coverage (0..1)
  uLmColor: { value: new THREE.Color(0.92, 0.94, 0.97) },
  uLmCenter: { value: new THREE.Vector4(-100, 0, 2300, 2600) }, // lake centre xz, radius x / z of the lake field
  uLmValley: { value: new THREE.Vector4(6.0, 0.0, 0.6, 30.0) },  // x: valley floors up to this height (m) above the
  //   water carry mist, y: valley mist strength (0 = only the lake), z: bank coverage of the valleys, w: (unused)
  uLmWind: { value: new THREE.Vector2(0.55, 0.2) },              // drift (m/s)
  uLmTime: { value: 0 },
  tLmH: { value: null }, uLmHB: { value: new THREE.Vector4(0, 0, 1, 1) },      // fine terrain height (lake)
  tLmHF: { value: null }, uLmHFB: { value: new THREE.Vector4(0, 0, 1, 1) },    // coarse terrain height (whole world)
};

export const LAKE_MIST_GLSL = /* glsl */`
#ifndef LAKE_MIST_INCLUDED
#define LAKE_MIST_INCLUDED
uniform float uLmAmount; uniform float uLmTop; uniform float uLmSigma;
uniform vec3 uLmScale; uniform vec3 uLmColor; uniform vec4 uLmCenter; uniform vec4 uLmValley;
uniform vec2 uLmWind; uniform float uLmTime;
uniform sampler2D tLmH; uniform vec4 uLmHB; uniform sampler2D tLmHF; uniform vec4 uLmHFB;
float lmIn(vec2 uv){ vec2 e = min(uv, 1.0 - uv); return smoothstep(0.0, 0.01, min(e.x, e.y)); }
/** ground height under xz (captured terrain; fine map over the lake, coarse elsewhere) */
float lmGround(vec2 xz){
  vec2 uf = (xz - uLmHFB.xy) / (uLmHFB.zw - uLmHFB.xy);
  vec2 un = (xz - uLmHB.xy) / (uLmHB.zw - uLmHB.xy);
  float hf = texture(tLmHF, clamp(uf, 0.0, 1.0), 1.0).r;
  float hn = texture(tLmH, clamp(un, 0.0, 1.0), 1.0).r;
  return mix(mix(40.0, hf, lmIn(uf)), hn, lmIn(un));
}
/** large-scale bank coverage 0..1 at xz (the water surface and the mist sheets share it) */
float lmBank(vec2 xz){
  vec2 p = xz - uLmWind * uLmTime;
  p = mat2(0.8, -0.6, 0.6, 0.8) * p;
  float big = cgVfbm2(p / uLmScale.x + 3.7, 4);
  float mid = cgVnoise2(p / (uLmScale.x * 0.33) + 11.0);
  float b = big * 0.8 + mid * 0.3;
  float cov = uLmScale.z;
  float lake = 1.0 - smoothstep(0.78, 1.0, length((xz - uLmCenter.xy) / uLmCenter.zw));
  float g = lmGround(xz);
  // valley floors: low ground (a few metres above the water) away from the lake carries mist banks too
  float valley = uLmValley.y * (1.0 - smoothstep(uLmValley.x * 0.4, uLmValley.x, g));
  float c = max(lake, valley);
  float covE = mix(uLmValley.z, cov, lake);
  return c * smoothstep(1.0 - covE - 0.18, 1.0 - covE + 0.22, b);
}
/** vertical profile of the layer at height y above the ground (integral ≈ uLmTop * 0.35) */
float lmProfile(float y){ return exp(-max(y, 0.0) / (uLmTop * 0.35)) * (1.0 - smoothstep(uLmTop * 0.7, uLmTop, y)); }
/** 3D billows (correlated in height): mean ≈ 1 */
float lmDetail(vec3 p){
  vec3 q = vec3(p.x - uLmWind.x * uLmTime * 1.3, p.y, p.z - uLmWind.y * uLmTime * 1.3);
  q.xz = mat2(0.8, -0.6, 0.6, 0.8) * q.xz;
  float n = cgVfbm3(vec3(q.x / uLmScale.y, q.y / (uLmScale.y * 0.08), q.z / uLmScale.y) + 7.3, 3);
  return clamp(0.25 + 1.6 * (n - 0.35), 0.0, 2.0);
}
/** extinction (1/m) at p */
float lmSigma(vec3 p, float ground){
  return uLmAmount * uLmSigma * lmBank(p.xz) * lmProfile(p.y - max(ground, 0.0)) * lmDetail(p);
}
/** vertical optical depth of the layer over the water at xz (bank only: the billows average out along a slant ray) */
float lmColumn(vec2 xz){ return uLmAmount * uLmSigma * lmBank(xz) * uLmTop * 0.35; }
#endif
`;

/** bind the captured terrain height maps of the water module ({ tex, bounds } each) */
export function bindMistHeights(near, far) {
  if (near?.tex) { LAKE_MIST.tLmH.value = near.tex; LAKE_MIST.uLmHB.value.set(...near.bounds); }
  if (far?.tex) { LAKE_MIST.tLmHF.value = far.tex; LAKE_MIST.uLmHFB.value.set(...far.bounds); }
  if (!LAKE_MIST.tLmH.value) LAKE_MIST.tLmH.value = LAKE_MIST.tLmHF.value;
  if (!LAKE_MIST.tLmHF.value) LAKE_MIST.tLmHF.value = LAKE_MIST.tLmH.value;
}
