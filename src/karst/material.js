// Karst / rock material: grey-white 飞来峰 limestone, the carved surfaces of the 布袋弥勒 and its niches, garden and
// shore stones, and the red-brown tuff of 宝石山 — one world-space procedural shader (no textures).
// Derived from Athenaion (MIT, NOTICE): materials/stone.js (STONE_GLSL: band-limited fbm, cellular facets and crack
// network, surface-gradient bump, crust, pitting, lichen colonies, moss, wetness). Ours: the baked aRock attribute
// (AO, cavity, carved mask, sky openness), carved-surface finish, rain streaks below rims and niches, autumn moss,
// snow, the waterline band and the tuff palette.
//
//   import { karstMaterial } from '../karst/material.js';
//   const m = karstMaterial({ moss: 0.6, lichen: 0.8, streaks: 0.7 });
//   m.userData.karst.uKC.value.w = 0.8;   // snow on the up-facing surfaces (winter)
//
// Options: tint (hex), scale, moss, lichen, streaks, strata, wetBelow (world y), bump, carvedSmooth, variation, ochre,
// darkness, snow, tuff, autumn, roughness. Geometry must carry aRock (vec4, Uint8 normalized): x = AO (1 open),
// y = cavity (1 deep), z = carved (1 = worked stone), w = sky openness from above (1 = takes the rain).
import * as THREE from 'three';
import { proceduralMaterial } from '../core/materials.js';

export const K_ONE = { value: 1 };

export const KARST_GLSL = /* glsl */ `
#ifndef K_STONE_INCLUDED
#define K_STONE_INCLUDED
vec3 kAlb; float kRgh; float kHgt; float kAO; vec3 kFN;
uniform float uKOne;
float kFbm(vec3 p, int oct, float fp, float gain) {
  float s = 0.0, a = 0.5, n = 0.0, f = 1.0;
  int no = int(float(oct) * uKOne);
  for (int i = 0; i < no; i++) {
    float w = 1.0 - smoothstep(0.18, 0.5, fp * f);
    s += a * w * cgSnoise(p * f);
    n += a; f *= 2.07; a *= gain; p += vec3(3.71, 1.37, 5.13);
  }
  return s / n;
}
vec3 kCell(vec3 p, out vec3 fpos) {
  vec3 i = floor(p), f = fract(p);
  float d1 = 8.0, d2 = 8.0, id = 0.0; fpos = vec3(0.0);
  int L1 = int(uKOne);
  for (int z = -L1; z <= L1; z++) for (int y = -L1; y <= L1; y++) for (int x = -L1; x <= L1; x++) {
    vec3 g = vec3(float(x), float(y), float(z));
    vec3 o = cgHash33(i + g);
    vec3 r = g + o - f;
    float d = dot(r, r);
    if (d < d1) { d2 = d1; d1 = d; id = cgHash13(i + g); fpos = i + g + o; }
    else if (d < d2) d2 = d;
  }
  return vec3(sqrt(d1), sqrt(d2), id);
}
vec3 kBumpNormal(vec3 p, vec3 n, float h) {
  vec3 dpdx = dFdx(p), dpdy = dFdy(p);
  float dhdx = dFdx(h), dhdy = dFdy(h);
  vec3 r1 = cross(dpdy, n), r2 = cross(n, dpdx);
  float det = dot(dpdx, r1);
  vec3 g = sign(det) * (dhdx * r1 + dhdy * r2);
  return normalize(abs(det) * n - g);
}
// R = aRock (ao, cavity, carved, open); A = (scale, moss, lichen, streaks); B = (strata, wetBelow, bump, carvedSmooth)
// C = (variation, ochre, darkness, snow); D = (tuff, autumn, -, -)
void kShade(vec3 p, vec3 n, float seed, vec4 R, vec4 A, vec4 B, vec4 C, vec4 D) {
  float sc = A.x;
  vec3 q = p * sc;
  kFN = n;
  float fp = max(length(fwidth(p)) * sc, 1e-4);
  float vert = 1.0 - abs(n.y);
  float upw = clamp(n.y, 0.0, 1.0);
  float carved = R.z * B.w;
  float open = R.w;
  float cav = R.y;
  // ---------------- macro colour
  float m1 = kFbm(q * 0.043 + seed * 13.1, 3, 0.0, 0.5);
  float m2 = kFbm(q * 0.16 + vec3(11.0, 3.0, 7.0), 3, 0.0, 0.5);
  float m3 = cgSnoise(q * 0.55 + 2.0);
  vec3 cream = vec3(0.46, 0.45, 0.42), grey = vec3(0.355, 0.352, 0.345), warm = vec3(0.44, 0.36, 0.26);
  // tuff (宝石山): red-brown, darker
  cream = mix(cream, vec3(0.27, 0.16, 0.11), D.x); grey = mix(grey, vec3(0.19, 0.12, 0.085), D.x); warm = mix(warm, vec3(0.30, 0.15, 0.08), D.x);
  vec3 c = mix(cream, grey, smoothstep(-0.4, 0.5, m1));
  c = mix(c, warm, smoothstep(0.25, 0.75, m2) * C.y * (0.35 + 0.65 * vert));
  float m4 = kFbm(q * 0.09 + vec3(31.0, 7.0, 19.0), 3, 0.0, 0.5);
  c = mix(c, c * 0.6, smoothstep(0.20, 0.75, m4) * 0.38 * (1.0 - carved));
  c = mix(c, mix(vec3(0.50, 0.488, 0.458), vec3(0.33, 0.21, 0.15), D.x), smoothstep(0.35, 0.7, -m4 + 0.4 * m3) * 0.45 * (1.0 - 0.6 * carved));
  c *= 1.0 + 0.08 * m3;
  c *= 1.0 + (seed - 0.5) * C.x;
  float motW = 1.0 - smoothstep(0.03, 0.12, fp);
  if (motW > 0.0) c *= 1.0 + 0.4 * kFbm(q * 7.0 + 3.3, 3, fp * 7.0, 0.65) * motW * (1.0 - 0.4 * carved);
  // ---------------- relief (m)
  float amp = 0.15 * B.z / sc * (1.0 - 0.75 * carved);
  float h = amp * kFbm(q * 0.55, 6, fp * 0.55 * 2.6, 0.64);
  float crW = (1.0 - 0.5 * carved) * (1.0 - smoothstep(0.008, 0.025, fp));
  if (crW > 0.0) {
    float r1 = abs(cgSnoise(q * 7.0 + 1.1) + 0.5 * cgSnoise(q * 13.0 + 7.3));
    float r2 = abs(cgSnoise(q * 23.0 + 4.4));
    h += (0.009 * r1 + 0.0035 * r2 * (1.0 - smoothstep(0.003, 0.009, fp))) * crW / sc;
    c *= 1.0 + 0.22 * (smoothstep(0.0, 0.5, r1) - 0.6) * crW;
  }
  float ptc = cgSnoise(q * 1.25 + 8.8) + 0.45 * cgSnoise(q * 3.1 + 2.2) + 0.2 * cgSnoise(q * 7.7 + 5.5);
  float ptW = 1.0 - smoothstep(0.04, 0.16, fp);
  c = mix(c, c * vec3(1.28, 1.26, 1.22), smoothstep(0.0, 0.35, ptc) * 0.8 * ptW);
  c = mix(c, c * vec3(0.72, 0.73, 0.75), smoothstep(-0.2, -0.6, ptc) * 0.8 * ptW);
  // bedding grooves + banding on steep natural faces
  float yb = q.y * 0.9 + 1.6 * cgSnoise(vec3(q.xz * 0.05, 3.3)) + 0.4 * cgSnoise(q * 0.3);
  float bedLine = abs(fract(yb * 0.5) - 0.5) * 2.0;
  float groove = (1.0 - smoothstep(0.0, 0.10, bedLine)) * B.x * vert * (1.0 - smoothstep(0.0, 0.5, fp * 0.5)) * (1.0 - carved);
  h -= groove * 0.05 / sc * (1.0 - smoothstep(0.015, 0.05, fp));
  float bandN = cgSnoise(vec3(q.x * 0.015, yb * 0.35, q.z * 0.015));
  c *= mix(1.0, 0.88 + 0.22 * smoothstep(-0.6, 0.6, bandN), B.x * vert * (1.0 - carved));
  // solution pits / honeycomb
  float pitW = 1.0 - smoothstep(0.02, 0.07, fp);
  float pit = 0.0;
  if (pitW > 0.0) {
    vec3 wq = q + 0.18 * vec3(cgSnoise(q * 3.1), cgSnoise(q * 3.1 + 7.7), cgSnoise(q * 3.1 + 3.3));
    vec3 pfp; vec3 vr = kCell(wq * 3.2, pfp);
    float pz = smoothstep(-0.45, 0.35, cgSnoise(q * 0.7 + 5.0)) * (1.0 - 0.5 * carved);
    float p1 = (1.0 - smoothstep(0.08, 0.30 + 0.12 * vr.z, vr.x)) * step(0.30, vr.z) * pz;
    float p2 = 0.0;
    if (fp < 0.012) {
      vec3 vr2 = kCell(wq * 9.0 + 2.0, pfp);
      p2 = (1.0 - smoothstep(0.05, 0.24, vr2.x)) * step(0.40, vr2.z) * (0.5 + 0.5 * pz);
    }
    pit = clamp(p1 + 0.7 * p2, 0.0, 1.0) * pitW;
    h -= (p1 * 0.035 * (1.0 - smoothstep(0.008, 0.025, fp)) + p2 * 0.012 * (1.0 - smoothstep(0.003, 0.009, fp))) * pitW / sc;
  }
  // fracture facets + open joints (natural rock only)
  float facW = (1.0 - carved) * (1.0 - smoothstep(0.12, 0.45, fp * 0.55));
  if (facW > 0.0) {
    vec3 fq = q * vec3(0.55, 0.30, 0.55);
    vec3 fpos; vec3 cc = kCell(fq, fpos);
    vec3 tilt = (cgHash33(fpos * 7.13 + 1.7) - 0.5) * vec3(1.0, 0.5, 1.0);
    kFN = normalize(kFN + (tilt - kFN * dot(tilt, kFN)) * 0.42 * facW);
    float cw = 0.03 + fp * 0.55 * 1.6;
    float crkZ = smoothstep(-0.1, 0.4, cgSnoise(q * 0.21 + 6.6));
    float crk = (1.0 - smoothstep(0.0, cw, cc.y - cc.x)) * step(0.55, cgHash13(fpos * 3.1 + 0.7)) * crkZ;
    c *= 1.0 - 0.55 * crk * facW;
    c *= 1.0 + (cc.z - 0.5) * 0.22 * facW;
    cav = max(cav, crk * 0.6 * facW);
    // a second, finer joint network (0.4–0.8 m): thin dark cracks over the whole natural face (where resolved)
    if (fp < 0.1) {
      vec3 fpos3; vec3 c3 = kCell(q * vec3(1.6, 1.1, 1.6) + 5.5, fpos3);
      float cw3 = 0.025 + fp * 1.2;
      float crk3 = (1.0 - smoothstep(0.0, cw3, c3.y - c3.x + 0.012 * cgSnoise(q * 9.0))) * step(0.62, cgHash13(fpos3 * 2.3 + 0.1)) * (1.0 - smoothstep(0.03, 0.1, fp));
      crk3 *= smoothstep(-0.2, 0.3, cgSnoise(q * 0.9 + 3.0));
      c *= 1.0 - 0.32 * crk3 * facW;
      cav = max(cav, crk3 * 0.45 * facW);
      c *= 1.0 + (c3.z - 0.5) * 0.18 * facW;
    }
    float chW = facW * (1.0 - smoothstep(0.02, 0.06, fp));
    if (chW > 0.0) {
      vec3 fpos2; vec3 cc2 = kCell(q * vec3(4.0, 3.0, 4.0) + 9.0, fpos2);
      vec3 t2 = (cgHash33(fpos2 * 5.31 + 0.3) - 0.5);
      kFN = normalize(kFN + (t2 - kFN * dot(t2, kFN)) * 0.22 * chW);
      c *= 1.0 + (cc2.z - 0.5) * 0.12 * chW;
    }
  }
  // ---------------- carved surfaces: lighter, smoother, top surfaces lightest (dust / sun-bleached)
  c = mix(c, c * mix(vec3(1.45, 1.41, 1.33), vec3(1.7, 1.65, 1.55), upw), carved);
  // ---------------- weathering layers
  // rain streaks: dark vertical runs on steep faces that take the water, strongest under rims (open→sheltered edge)
  float sk = cgSnoise(vec3(q.x * 0.55, q.y * 0.022, q.z * 0.55)) * 0.6 + cgSnoise(vec3(q.x * 1.7, q.y * 0.06, q.z * 1.7)) * 0.4;
  float sk2 = cgSnoise(vec3(q.x * 3.5 + 1.0, q.y * 0.15, q.z * 3.5));
  float wetFace = smoothstep(0.25, 0.8, vert) * (0.35 + 0.65 * open);
  float streak = smoothstep(0.1, 0.6, sk + 0.25 * sk2) * A.w * wetFace;
  streak = max(streak, smoothstep(0.35, 0.8, sk2) * A.w * carved * smoothstep(0.3, 0.9, vert) * 0.8);
  c = mix(c, c * mix(vec3(0.5, 0.5, 0.48), vec3(0.34, 0.35, 0.32), carved), streak * 0.8);
  // crevices: darker, green-brown
  float cv = clamp(cav, 0.0, 1.0);
  c *= 1.0 - 0.55 * cv * cv - 0.15 * cv;
  c = mix(c, vec3(0.06, 0.055, 0.04), cv * cv * 0.35);
  c = mix(c, c * vec3(0.38, 0.35, 0.31), pit);
  // lichen: black colonies, pale grey crusts, yellow-grey patches (less on the sheltered and the carved)
  float lichMask = smoothstep(0.05, 0.6, kFbm(q * 0.35 + 4.0, 3, 0.0, 0.5) + 0.3 * upw) * (0.4 + 0.6 * open);
  float spkW = 1.0 - smoothstep(0.03, 0.10, fp);
  float lichDark = smoothstep(0.35, 0.75, cgSnoise(q * 9.0)) * lichMask * A.z * spkW;
  float colony = smoothstep(0.3, 0.7, cgSnoise(q * 1.15 + 7.0) + 0.5 * cgSnoise(q * 3.1 + 1.0) * spkW) * lichMask;
  float dotW = 1.0 - smoothstep(0.012, 0.04, fp);
  float dots = smoothstep(0.15, 0.5, cgSnoise(q * 17.0 + 3.0)) * dotW;
  lichDark = max(lichDark, colony * mix(0.55, dots, dotW) * A.z) * (1.0 - 0.9 * carved);
  c = mix(c, vec3(0.13, 0.14, 0.115), clamp(lichDark, 0.0, 1.0) * 0.5);   // dark grey-green colonies (not black: ref08)
  float crust = smoothstep(0.25, 0.65, kFbm(q * 0.75 + 14.0, 3, fp * 0.75, 0.55)) * (1.0 - colony) * A.z;
  c = mix(c, mix(vec3(0.60, 0.595, 0.565), vec3(0.42, 0.33, 0.28), D.x), crust * 0.4 * (1.0 - 0.6 * carved));
  c *= 1.0 - 0.18 * lichMask * A.z * (1.0 - spkW);
  float lichY = smoothstep(0.55, 0.8, cgSnoise(q * 2.3 + 9.0)) * lichMask * A.z;
  c = mix(c, vec3(0.52, 0.47, 0.30), lichY * 0.35);
  // moss: on ledges (up-facing), in crevices and on damp shaded faces; brighter yellow-green where it is thick
  float mossN = kFbm(q * 0.4 + 21.0, 3, 0.0, 0.5);
  float moss = smoothstep(0.25, 0.75, upw * 0.95 + cv * 0.55 + 0.45 * mossN - 0.2 * carved) * A.y * (0.55 + 0.45 * open);
  vec3 mossC = mix(vec3(0.07, 0.09, 0.028), vec3(0.17, 0.17, 0.055), smoothstep(-0.3, 0.6, mossN));
  mossC = mix(mossC, vec3(0.20, 0.17, 0.06), D.y * 0.5);
  c = mix(c, mossC, moss * 0.88);
  h += moss * 0.012 / sc;
  // ---------------- wetness at the waterline
  float wet = 1.0 - smoothstep(B.y - 0.05, B.y + 0.35, p.y + 0.12 * cgSnoise(q * 1.5));
  c = mix(c, c * vec3(0.42, 0.44, 0.42), wet);
  c = mix(c, vec3(0.05, 0.07, 0.035), wet * smoothstep(B.y - 0.3, B.y + 0.1, p.y) * 0.45);
  // ---------------- snow on the up-facing surfaces (winter)
  float snowN = cgSnoise(q * 1.7 + 4.0) * 0.5 + cgSnoise(q * 6.0) * 0.2;
  float snow = smoothstep(0.35, 0.7, n.y + 0.25 * snowN) * C.w * (0.4 + 0.6 * open);
  c = mix(c, vec3(0.84, 0.86, 0.9), snow);
  h += snow * 0.03 / sc;
  c *= 1.0 - C.z;
  kAlb = max(c, vec3(0.0));
  kRgh = mix(mix(0.86 + 0.08 * m3, 0.3, wet), 0.75, snow) - 0.05 * carved;
  kHgt = h;
  kAO = R.x * R.x * (1.0 - 0.6 * cv) * (1.0 - 0.2 * moss * upw);
}
#endif
`;

const VERT_HEAD = /* glsl */ `
attribute vec4 aRock;
varying vec4 vKRock;
`;
const FRAG_HEAD = /* glsl */ `
uniform vec3 uKTint;
uniform vec4 uKA, uKB, uKC, uKD;
varying vec4 vKRock;
${KARST_GLSL}
`;
const COLOR = /* glsl */ `
kShade(cgP, cgN, cgSeed, vKRock, uKA, uKB, uKC, uKD);
diffuseColor.rgb = kAlb * uKTint * diffuseColor.rgb;
cgAO = kAO;
`;

const DEF = { tint: 0xffffff, scale: 1, moss: 0.45, lichen: 0.75, streaks: 0.6, strata: 0.5, wetBelow: -1e4, bump: 1, carvedSmooth: 1, variation: 0.18, ochre: 0.35, darkness: 0, snow: 0, tuff: 0, autumn: 0, roughness: 0.88 };

/** karst / rock material (see the header for the options) */
export function karstMaterial(opts = {}) {
  const o = { ...DEF, ...opts };
  const uniforms = {
    uKTint: { value: new THREE.Color(o.tint) },
    uKA: { value: new THREE.Vector4(o.scale, o.moss, o.lichen, o.streaks) },
    uKB: { value: new THREE.Vector4(o.strata, o.wetBelow, o.bump, o.carvedSmooth) },
    uKC: { value: new THREE.Vector4(o.variation, o.ochre, o.darkness, o.snow) },
    uKD: { value: new THREE.Vector4(o.tuff, o.autumn, 0, 0) },
    uKOne: K_ONE,
  };
  const mat = proceduralMaterial({
    name: o.name || 'karst',
    params: { color: 0xffffff, roughness: o.roughness, metalness: 0, side: o.side ?? THREE.FrontSide },
    uniforms,
    vertexHead: VERT_HEAD,
    vertexPre: 'vKRock = aRock;',
    head: FRAG_HEAD,
    color: COLOR,
    roughness: 'roughnessFactor = clamp(kRgh * roughnessFactor / 0.88, 0.05, 1.0);',
    normal: 'cgBump = kBumpNormal(cgP, kFN, kHgt) - cgN;',
    ao: '/* cgAO set in the colour hook */',
  });
  mat.userData.karst = uniforms;
  return mat;
}

/** set the season look on every karst material in a list: snow (winter), autumn moss */
export function setKarstSeason(mats, season) {
  for (const m of mats) {
    const U = m.userData.karst;
    if (!U) continue;
    U.uKC.value.w = season === 'winter' ? (m.userData.snowAmount ?? 0.85) : 0;
    U.uKD.value.y = season === 'autumn' ? 1 : 0;
  }
}
