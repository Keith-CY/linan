// Foliage + bark material family for every plant (derived from Athenaion's src/materials/foliage.js and
// src/flora/foliage.js, MIT; seasons, snow, ribbons and the per-species tables are ours).
//
//   foliageMaterial(species, kind)   kind: 'card' (alpha-tested leaf sprays), 'blob' (opaque crown body),
//                                    'inner' (crown core: hidden on bare deciduous trees), 'ribbon' (view-facing
//                                    strands: willow), 'bb' (far impostor quad, procedural silhouette)
//   barkMaterial(species)            procedural bark (plates / fissures / lenticels, lichen, moss, snow)
//   depthFor(material)               shadow-map depth material reproducing wind, ribbons and season UV shifts
//   applySeason(name)                switch every registered material (leaf colour, blossom, bare, snow)
//   WIND                             { uWindTime, uWindAmp } (the module drives uWindTime from engine time)
//
// Geometry contract: src/vegetation/util.js (aFol, aAux, aRib).
// Leaves are thin: direct sun arriving from BEHIND a leaf is transmitted (RE_Direct wrap below), shadowed
// correctly because CSM shadowing is already folded into directLight.color; a forward-scatter boost when
// looking toward the sun gives the golden "light through leaves" of the backlit refs (04 sunset, 08 autumn).
import * as THREE from 'three';
import { proceduralMaterial } from '../core/materials.js';
import { hashString } from '../core/rng.js';
import { GRID, cellOf, T, PATCH, SEASONS } from './atlas.js';

export const WIND = { uWindTime: { value: 0 }, uWindAmp: { value: 1 } };
/** global season uniforms (shared by reference by every vegetation material) */
export const SEASON_U = {
  uSnow: { value: 0 },          // 0..1 snow lying on upward faces of leaves, branches and ground plants
  uSnowColor: { value: new THREE.Color(0.86, 0.88, 0.92) },
};

const lin = (hex) => { const c = new THREE.Color(hex); return [c.r, c.g, c.b]; };
const ONE = [1, 1, 1];

// ---------------------------------------------------------------- species tables
// card: the atlas column of the leaf sprays (seasonal rows) · seasonal: cards change rows with the season
// patch: [type, row] of the opaque patch for blobs / billboards · tint[s]: blob / billboard albedo multiplier
// per season (cards carry their own colours) · deciduous: bare in winter · transl: leaf transmission
export const SPECIES = {
  willow: { card: T.willow, seasonal: true, patch: PATCH.willow, deciduous: true, transl: [0.3, 0.34, 0.12], gain: 1.0, amb: 1.0, up: 0.45, rough: 0.6, tipAmt: 0.35,
    tint: [[1.35, 1.25, 0.95], [0.85, 0.95, 0.85], [1.25, 1.05, 0.65], ONE] },
  peach: { card: T.peach, seasonal: true, patch: PATCH.blossom, deciduous: true, transl: [0.5, 0.3, 0.32], gain: 1.0, amb: 1.05, up: 0.35, rough: 0.6, tipAmt: 0.2,
    tint: [ONE, ONE, ONE, ONE], mono: [null, [0.05, 0.085, 0.03], [0.11, 0.095, 0.03], null] },
  pine: { card: T.pineBurst, seasonal: false, patch: PATCH.pine, deciduous: false, transl: [0.16, 0.2, 0.05], gain: 1.0, amb: 1.0, up: 0.3, rough: 0.72, tipAmt: 0.45,
    tint: [ONE, ONE, [0.95, 0.95, 0.9], [0.85, 0.9, 0.9]] },
  pineSpray: { card: T.pineSpray, seasonal: false, patch: PATCH.pine, deciduous: false, transl: [0.16, 0.2, 0.05], gain: 1.0, amb: 1.0, up: 0.3, rough: 0.72, tipAmt: 0.45,
    tint: [ONE, ONE, [0.95, 0.95, 0.9], [0.85, 0.9, 0.9]] },
  camphor: { card: T.camphor, seasonal: true, patch: PATCH.camphor, deciduous: false, transl: [0.26, 0.32, 0.08], gain: 1.0, amb: 1.05, up: 0.3, rough: 0.48, tipAmt: 0.55,
    tint: [[1.12, 1.08, 0.95], ONE, ONE, [0.88, 0.9, 0.9]] },
  broad: { card: T.broad, seasonal: true, patch: PATCH.camphor, deciduous: true, transl: [0.3, 0.36, 0.08], gain: 1.0, amb: 1.05, up: 0.3, rough: 0.6, tipAmt: 0.55,
    tint: [[1.5, 1.45, 1.0], [1.05, 1.1, 1.0], ONE, ONE], mono: [null, null, [0.2, 0.11, 0.03], null] },
  maple: { card: T.maple, seasonal: true, patch: PATCH.maple, deciduous: true, transl: [0.26, 0.04, 0.02], gain: 1.0, amb: 1.0, up: 0.35, rough: 0.6, tipAmt: 0.3,
    tint: [[1.3, 1.1, 0.8], ONE, ONE, ONE], mono: [null, null, [0.3, 0.022, 0.014], null] },
  ginkgo: { card: T.ginkgo, seasonal: true, patch: PATCH.ginkgo, deciduous: true, transl: [0.6, 0.5, 0.1], gain: 1.0, amb: 1.0, up: 0.35, rough: 0.6, tipAmt: 0.3,
    tint: [[1.3, 1.2, 0.85], ONE, ONE, ONE], mono: [null, null, [0.46, 0.28, 0.025], null] },
  shrub: { card: T.shrub, seasonal: false, patch: PATCH.shrub, deciduous: false, transl: [0.2, 0.26, 0.06], gain: 1.0, amb: 1.0, up: 0.3, rough: 0.55, tipAmt: 0.4,
    tint: [ONE, ONE, [1.05, 1.0, 0.9], [0.85, 0.88, 0.88]] },
  // ---- ground layer (src/vegetation/ground.js). show[s] = visible in season s; snowK = how much snow they hold
  grass: { ground: true, card: T.grass, seasonal: true, patch: PATCH.shrub, deciduous: false, transl: [0.3, 0.36, 0.08], gain: 1.0, amb: 1.0, up: 0.5, rough: 0.7, tipAmt: 0.3, tint: [ONE, ONE, ONE, ONE] },
  fern: { ground: true, card: T.fern, seasonal: false, patch: PATCH.shrub, deciduous: false, transl: [0.3, 0.36, 0.08], gain: 1.0, amb: 0.95, up: 0.3, rough: 0.6, tipAmt: 0.3,
    tint: [[1.1, 1.08, 0.9], ONE, [1.25, 1.0, 0.6], [0.8, 0.82, 0.75]] },
  ivy: { card: T.ivy, seasonal: false, patch: PATCH.shrub, deciduous: false, transl: [0.22, 0.28, 0.06], gain: 0.85, amb: 1.0, up: 0.2, rough: 0.45, tipAmt: 0.3,
    tint: [[1.05, 1.05, 0.92], ONE, [1.12, 1.0, 0.8], [0.8, 0.82, 0.75]] },
  reed: { ground: true, card: T.shrub, seasonal: false, patch: PATCH.shrub, deciduous: false, transl: [0.3, 0.32, 0.12], gain: 1.0, amb: 1.0, up: 0.5, rough: 0.65, tipAmt: 0.2,
    tint: [[1.0, 1.05, 0.85], ONE, [1.6, 1.3, 0.75], [1.9, 1.6, 1.15]] },
  litterPetal: { card: T.litter, seasonal: false, patch: PATCH.shrub, transl: [0.3, 0.2, 0.2], gain: 1, amb: 1, up: 0.8, rough: 0.6, tipAmt: 0, tint: [ONE, ONE, ONE, ONE], show: [1, 0, 0, 0] },
  litterLeaf: { card: T.litter, seasonal: false, patch: PATCH.shrub, transl: [0.3, 0.1, 0.05], gain: 1, amb: 1, up: 0.8, rough: 0.6, tipAmt: 0, tint: [ONE, ONE, ONE, ONE], show: [0, 0, 1, 0] },
  litterBrown: { card: T.litter, seasonal: false, patch: PATCH.shrub, transl: [0.1, 0.08, 0.04], gain: 1, amb: 1, up: 0.8, rough: 0.7, tipAmt: 0, tint: [ONE, ONE, ONE, ONE], show: [0, 0, 1, 1] },
  litterNeedle: { card: T.litter, seasonal: false, patch: PATCH.shrub, transl: [0.05, 0.04, 0.02], gain: 1, amb: 1, up: 0.8, rough: 0.7, tipAmt: 0, tint: [ONE, ONE, ONE, ONE], show: [1, 1, 1, 1] },
};

// ---------------------------------------------------------------- shader chunks
const VERT_HEAD = /* glsl */ `
attribute vec4 aFol;
attribute vec2 aAux;
varying vec4 vFol;
varying vec2 vAux;
uniform float uWindTime;
uniform float uWindAmp;
uniform vec2 uUvShift;
uniform float uCollapse;
`;
const RIB_HEAD = /* glsl */ `
attribute vec4 aRib;
`;

// runs after <begin_vertex> (object space, before instancing). vMapUv exists when the material has a map.
const VERT_WIND = /* glsl */ `
vFol = aFol; vAux = aAux;
#ifdef USE_MAP
  vMapUv += uUvShift;
#endif
vec3 vgIP = vec3(0.0);
#ifdef USE_INSTANCING
  vgIP = instanceMatrix[3].xyz;
#endif
float vgPh = dot(vgIP, vec3(0.071, 0.013, 0.053));
float vgW = aFol.w * aFol.w * uWindAmp;
vec2 vgS = vec2(sin(uWindTime * 0.83 + vgPh) + 0.35 * sin(uWindTime * 2.3 + vgPh * 1.7),
                0.6 * cos(uWindTime * 0.61 + vgPh * 1.3));
transformed.xz += vgS * vgW * 0.08;
float vgF = sin(uWindTime * 5.7 + vgPh * 3.0 + dot(position, vec3(2.1, 1.7, 2.9)));
transformed += normal * (vgF * 0.012 * aFol.y * uWindAmp);
transformed *= 1.0 - uCollapse;
`;

// view-facing ribbon: widen the strand perpendicular to its tangent and the view direction (object space)
const VERT_RIBBON = /* glsl */ `
{
#ifdef USE_INSTANCING
  mat4 rgM = modelMatrix * instanceMatrix;
#else
  mat4 rgM = modelMatrix;
#endif
  vec3 rgCam = (inverse(rgM) * vec4(cameraPosition, 1.0)).xyz;
  vec3 rgV = normalize(rgCam - transformed);
  vec3 rgT = normalize(aRib.xyz + vec3(0.0, 1e-5, 0.0));
  vec3 rgS = cross(rgT, rgV);
  float rgL = length(rgS);
  rgS = rgL > 1e-4 ? rgS / rgL : normalize(cross(rgT, vec3(0.0, 0.0, 1.0)));
  // strands swing as a whole (pendulum): more toward the tip (aAux.y = 0 root .. 1 tip of this tile chain)
  float rgSw = aFol.w * uWindAmp;
  transformed.xz += vec2(sin(uWindTime * 0.9 + vgPh * 2.0 + transformed.y * 0.3), cos(uWindTime * 0.7 + vgPh)) * rgSw * 0.12;
  transformed += rgS * aRib.w;
}
`;

const FRAG_HEAD = /* glsl */ `
varying vec4 vFol;
varying vec2 vAux;
uniform vec3 uTint;
uniform vec3 uTipTint;
uniform float uTipAmt;
uniform float uDeep;
uniform float uVar;
uniform float uRelief;
uniform float uAmb;
uniform float uUpBias;
uniform float uGain;
uniform vec3 uTransl;
uniform float uSnow;
uniform vec3 uSnowColor;
uniform float uSnowK;
uniform vec4 uMono;
uniform float uLeafJit;
vec3 cgLeafTrans = vec3(0.0);
float cgLeafSpec = 1.0;
float vgRelief(vec3 o, float r){ return cgVnoise3(o * 3.2 + r * 7.0) * 0.62 + cgVnoise3(o * 8.5 + 3.0) * 0.38; }
`;

// foliage colour: atlas × tint, interior darkening, sunlit young tips, per-instance + per-clump variation,
// slow world-space stand variation, snow on upward faces
const FOL_COLOR = /* glsl */ `
float vgAO = clamp(vFol.x, 0.0, 1.0);
float vgTip = clamp(vFol.y, 0.0, 1.0);
vec3 c = diffuseColor.rgb * uTint;
// seasonal recolour keyed on the texture's luminance (keeps the leaf detail; mean foliage luma ≈ 0.055)
c = mix(c, uMono.rgb * (cgLuma(diffuseColor.rgb) / 0.055), uMono.a);
c *= mix(uDeep, 1.0, vgAO);
c = mix(c, c * uTipTint, vgTip * uTipAmt);
c *= 1.0 + uVar * (vFol.z - 0.5) * 0.5;
float vgWv = cgVnoise2(cgP.xz * 0.013 + vec2(cgSeed * 3.7, 0.0));
c *= mix(0.9, 1.1, vgWv);
c *= (0.88 + 0.24 * cgSeed) * uGain;
if (uRelief > 0.0) c *= mix(1.0, 0.55 + 0.75 * vgRelief(cgO + cgSeed * 13.7, vFol.z), uRelief);
if (uSnow > 0.0) {
  float up = normalize(vCgWorldNormal).y;
  float sn = smoothstep(0.15, 0.7, up + 0.35 * (cgVnoise3(cgP * 2.3) - 0.5)) * uSnow * uSnowK * smoothstep(0.25, 0.6, vgAO);
  c = mix(c, uSnowColor, sn);
}
diffuseColor.rgb = c;
cgLeafTrans = uTransl * mix(vec3(1.0), c / max(cgLuma(c), 0.004), 0.5) * smoothstep(0.0, 0.6, vgAO);
`;

const FOL_NORMAL = /* glsl */ `
// bent normals, biased upward: foliage facing down still sees sky through the gaps of the crown
normal = normalize( normalize( vNormal ) * (gl_FrontFacing ? 1.0 : 1.0) + ( viewMatrix * vec4( 0.0, uUpBias, 0.0, 0.0 ) ).xyz );
if (uRelief > 0.0) {
  float h = vgRelief(cgO + cgSeed * 13.7, vFol.z);
  vec3 dpx = dFdx(cgP), dpy = dFdy(cgP);
  vec3 N = normalize(vCgWorldNormal);
  vec3 r1 = cross(dpy, N), r2 = cross(N, dpx);
  float det = dot(dpx, r1);
  vec3 grad = sign(det) * (dFdx(h) * r1 + dFdy(h) * r2);
  vec3 nb = normalize(abs(det) * N - grad * (0.22 * uRelief));
  cgBump = (nb - N) * step(1e-10, abs(det));
}
#ifdef USE_MAP
// every leaf-sized patch of a card gets its own tilt: the shading and highlights break up like real leaves
if (uLeafJit > 0.0) {
  vec2 q = vMapUv * 85.0;
  vec3 j = vec3(cgVnoise2(q), cgVnoise2(q + 7.1), cgVnoise2(q + 3.7)) - 0.5;
  cgBump += j * 2.0 * uLeafJit;
}
#endif
`;

const FOL_ROUGH = /* glsl */ `
roughnessFactor = clamp(roughnessFactor - 0.12 * vFol.y, 0.3, 1.0);
cgLeafSpec = 0.38;
`;

const FOL_AO = /* glsl */ `
cgAO = mix(0.42, 1.0, clamp(vFol.x, 0.0, 1.0)) * uAmb;
reflectedLight.indirectSpecular *= 0.35 * cgAO;
`;

// warm bounce light from the sunlit ground onto the underside of crowns (the sky-only IBL has none)
const FOL_EMISSIVE = /* glsl */ `
{
  float vgDown = clamp(0.5 - 0.5 * normalize(vCgWorldNormal).y, 0.0, 1.0);
  totalEmissiveRadiance += diffuseColor.rgb * vec3(0.16, 0.14, 0.09) * (0.35 + 0.65 * vgDown) * mix(0.5, 1.0, clamp(vFol.x, 0.0, 1.0));
}
`;

// translucent thin-leaf direct lighting (wraps three's physical RE_Direct; Athenaion flora/foliage.js)
const TRANSLUCENT_GLSL = /* glsl */ `
void RE_Direct_CgLeaf( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight ) {
  RE_Direct_Physical( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
  float back = saturate( -dot( geometryNormal, directLight.direction ) );
  float fwd = pow( saturate( dot( -geometryViewDir, directLight.direction ) ), 6.0 );
  float wrap = saturate( dot( geometryNormal, directLight.direction ) * 0.5 + 0.5 );
  reflectedLight.directDiffuse += directLight.color * cgLeafTrans * ( back * ( 0.5 + 1.5 * fwd ) + 0.08 * wrap + 0.35 * fwd ) * RECIPROCAL_PI;
}
#undef RE_Direct
#define RE_Direct RE_Direct_CgLeaf
`;
const SPEC_GLSL = /* glsl */ `
material.specularF90 *= cgLeafSpec;
material.specularColor *= cgLeafSpec;
material.specularColorBlended = mix( material.specularColor, diffuseColor.rgb, metalnessFactor );
`;

// ---------------------------------------------------------------- far LOD impostors
// Camera-facing (cylindrical) quads with a procedural silhouette (Athenaion technique): 2 triangles per far
// tree. Shapes: 0 dome (camphor / broadleaf), 1 pine (flat tiers on a bare trunk), 2 willow (dome + hanging
// curtain), 3 small round (peach / maple), 4 conical-ish (ginkgo)
const BB_VERT = /* glsl */ `
#ifdef USE_INSTANCING
  mat4 vgM = modelMatrix * instanceMatrix;
#else
  mat4 vgM = modelMatrix;
#endif
vec3 vgCam = (inverse(vgM) * vec4(cameraPosition, 1.0)).xyz;
vec2 vgD = vgCam.xz; float vgL = length(vgD); vgD = vgL > 1e-4 ? vgD / vgL : vec2(0.0, 1.0);
vec3 vgRight = vec3(vgD.y, 0.0, -vgD.x);
transformed = vec3(0.0, position.y, 0.0) + vgRight * position.x;
float vgU = aAux.x, vgV = aAux.y;
vec3 vgN = normalize(vgRight * vgU * 0.85 + vec3(0.0, 0.25 + 1.1 * (vgV - 0.62), 0.0) + vec3(vgD.x, 0.0, vgD.y) * 0.55);
objectNormal = vgN;
transformedNormal = vgN;
#ifdef USE_INSTANCING
{
  mat3 vgIm = mat3(instanceMatrix);
  transformedNormal /= vec3(dot(vgIm[0], vgIm[0]), dot(vgIm[1], vgIm[1]), dot(vgIm[2], vgIm[2]));
  transformedNormal = vgIm * transformedNormal;
}
#endif
transformedNormal = normalMatrix * transformedNormal;
vNormal = normalize(transformedNormal);
vFol = vec4(0.4 + 0.55 * smoothstep(0.0, 0.9, vgV), 0.5 * vgV * vgV, 0.5, 0.0);
vAux = aAux;
#ifdef USE_MAP
  vMapUv += uUvShift;
#endif
transformed *= 1.0 - uCollapse;
`;

const BB_SHAPE = /* glsl */ `
{
  float u = vAux.x, v = vAux.y;
  float n = cgVnoise2(vec2(u * 3.1, v * 3.4) + cgSeed * 37.0);
  float n2 = cgVnoise2(vec2(u * 9.0, v * 9.0) + cgSeed * 11.0);
  float a, dark = 0.0;
  if (uBBShape < 0.5) {            // dome on a short trunk
    float d = length(vec2(u, (v - 0.6) / 0.42));
    float e = 0.9 + 0.3 * (n - 0.5) + 0.12 * (n2 - 0.5);
    a = max(step(d, e), step(abs(u), 0.06) * step(v, 0.3));
    dark = smoothstep(e - 0.25, e, d);
  } else if (uBBShape < 1.5) {     // pine: two or three flat tiers on a leaning trunk
    float lean = (cgSeed - 0.5) * 0.3 * v;
    float t1 = length(vec2((u - lean) / 1.0, (v - 0.86) / 0.12));
    float t2 = length(vec2((u - lean - 0.25 * (cgSeed - 0.5)) / 0.8, (v - 0.66) / 0.1));
    float t3 = length(vec2((u - lean + 0.3 * (cgSeed - 0.4)) / 0.55, (v - 0.5) / 0.08));
    float e = 0.92 + 0.35 * (n - 0.5) + 0.15 * (n2 - 0.5);
    float d = min(t1, min(t2, t3));
    a = max(step(d, e), step(abs(u - lean), 0.045) * step(v, 0.8));
    dark = smoothstep(e - 0.3, e, d);
  } else if (uBBShape < 2.5) {     // willow: rounded head, curtain hanging nearly to the ground, ragged hem
    float d = length(vec2(u, (v - 0.68) / 0.36));
    float hem = 0.12 + 0.18 * cgVnoise2(vec2(u * 7.0 + cgSeed * 9.0, 0.0)) + 0.08 * (1.0 - abs(u));
    float curtain = step(abs(u), 0.88 + 0.1 * (n - 0.5)) * step(hem, v) * step(v, 0.8);
    float e = 0.92 + 0.25 * (n - 0.5);
    a = max(max(step(d, e), curtain * step(0.32, n2 + 0.2)), step(abs(u), 0.07) * step(v, 0.4));
    dark = smoothstep(0.6, 0.15, v) * 0.6;
  } else if (uBBShape < 3.5) {     // small round head (peach, maple), low fork
    float d = length(vec2(u, (v - 0.58) / 0.45));
    float e = 0.88 + 0.35 * (n - 0.5) + 0.2 * (n2 - 0.5);
    a = max(step(d, e), step(abs(u), 0.05) * step(v, 0.25));
    dark = smoothstep(e - 0.25, e, d);
  } else {                          // ovoid, taller than wide (ginkgo)
    float d = length(vec2(u / 0.78, (v - 0.56) / 0.46));
    float e = 0.9 + 0.3 * (n - 0.5) + 0.2 * (n2 - 0.5);
    a = max(step(d, e), step(abs(u), 0.05) * step(v, 0.2));
    dark = smoothstep(e - 0.25, e, d);
  }
  diffuseColor.rgb *= 1.0 - 0.55 * dark;
  diffuseColor.a = min(diffuseColor.a, a);
}
`;

// ---------------------------------------------------------------- registry / season switching
const REG = new Set();
const _cache = new Map();
let CURRENT = 'spring';

function folUniforms(sp) {
  return {
    ...WIND, ...SEASON_U,
    uTint: { value: new THREE.Vector3(1, 1, 1) },
    uTipTint: { value: new THREE.Vector3(1.25, 1.2, 0.8) },
    uTipAmt: { value: sp.tipAmt ?? 0.5 }, uDeep: { value: 0.38 },
    uVar: { value: 0.8 }, uRelief: { value: 0 }, uAmb: { value: sp.amb ?? 1.0 }, uUpBias: { value: sp.up ?? 0.3 }, uGain: { value: sp.gain ?? 1.0 },
    uTransl: { value: new THREE.Vector3(...sp.transl) },
    uUvShift: { value: new THREE.Vector2(0, 0) }, uCollapse: { value: 0 }, uSnowK: { value: 1 },
    uMono: { value: new THREE.Vector4(0, 0, 0, 0) }, uLeafJit: { value: 0 },
  };
}

function finishLeaf(mat) {
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = function (shader, renderer) {
    prev.call(this, shader, renderer);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <lights_physical_pars_fragment>', `#include <lights_physical_pars_fragment>\n${TRANSLUCENT_GLSL}`)
      .replace('#include <lights_physical_fragment>', `#include <lights_physical_fragment>\n${SPEC_GLSL}`);
  };
  mat.userData.shaderKey += ':leafT' + hashString(TRANSLUCENT_GLSL + SPEC_GLSL).toString(36);
  const k = mat.userData.shaderKey;
  mat.customProgramCacheKey = () => k;
  return mat;
}

/**
 * @param {string} species key of SPECIES
 * @param {'card'|'blob'|'inner'|'ribbon'|'bb'} kind
 * @param {THREE.Texture} map the foliage atlas
 */
export function foliageMaterial(species, kind, map) {
  const key = `fol:${species}:${kind}`;
  if (_cache.has(key)) return _cache.get(key);
  const sp = SPECIES[species];
  const u = folUniforms(sp);
  const alpha = kind === 'card' || kind === 'ribbon' || kind === 'bb';
  if (kind === 'blob' || kind === 'inner') u.uRelief.value = 0.6;
  if (kind === 'card') u.uLeafJit.value = 0.5;
  if (kind === 'ribbon') u.uLeafJit.value = 0.3;
  if (kind === 'bb') u.uBBShape = { value: { willow: 2, pine: 1, pineSpray: 1, peach: 3, maple: 3, ginkgo: 4 }[species] ?? 0 };
  let vertexPre = VERT_WIND, vertexHead = VERT_HEAD, color = FOL_COLOR, head = FRAG_HEAD;
  if (kind === 'ribbon') { vertexHead += RIB_HEAD; vertexPre = VERT_WIND + VERT_RIBBON; }
  if (kind === 'bb') { vertexHead += 'uniform float uBBShape;\n'; vertexPre = BB_VERT; head += 'uniform float uBBShape;\n'; color = BB_SHAPE + FOL_COLOR; }
  const m = proceduralMaterial({
    name: `veg-${species}-${kind}`,
    params: {
      color: 0xffffff, roughness: sp.rough ?? 0.6, metalness: 0, map,
      side: alpha ? THREE.DoubleSide : THREE.FrontSide,
      alphaTest: alpha ? 0.5 : 0,
    },
    uniforms: u,
    vertexHead, vertexPre, head, color,
    normal: FOL_NORMAL, roughness: FOL_ROUGH, ao: FOL_AO, emissive: FOL_EMISSIVE,
  });
  if (alpha) { m.alphaToCoverage = true; m.shadowSide = THREE.DoubleSide; }
  finishLeaf(m);
  m.userData.veg = { species, kind, sp };
  m.userData.isFoliage = true;
  REG.add(m);
  _cache.set(key, m);
  setSeasonOn(m, CURRENT);
  return m;
}

// ---------------------------------------------------------------- bark
const BARK = {
  // a: lit plates, b: secondary, c: fissure colour; scale = voronoi plate frequency (around, along) per metre;
  // plates 0 = stringy fissures .. 1 = plated; lent = horizontal lenticels (cherry-family bark)
  willow: { a: '#5a544a', b: '#3e3a34', c: '#181614', lichen: '#7e8270', scale: [8.0, 1.4], plates: 0.3, rough: 0.92, lent: 0 },
  peach: { a: '#3e2a28', b: '#2a1c1c', c: '#140e0e', lichen: '#6a6a5c', scale: [5.0, 4.0], plates: 0.1, rough: 0.6, lent: 1 },
  pine: { a: '#5e4e42', b: '#4a3c32', c: '#241c16', lichen: '#86826e', scale: [5.5, 1.8], plates: 1.0, rough: 0.88, lent: 0, upper: '#6e4a36' },
  camphor: { a: '#5e564a', b: '#463e34', c: '#1d1915', lichen: '#9c9a84', scale: [9.0, 2.2], plates: 0.55, rough: 0.9, lent: 0 },
  broad: { a: '#5b5248', b: '#463d34', c: '#1d1915', lichen: '#9c9a84', scale: [9.0, 3.0], plates: 0.6, rough: 0.9, lent: 0 },
  maple: { a: '#5a5048', b: '#4a4038', c: '#2a2420', lichen: '#8a8a7a', scale: [12.0, 6.0], plates: 0.05, rough: 0.7, lent: 0.4 },
  ginkgo: { a: '#6a6258', b: '#4e463c', c: '#221e1a', lichen: '#9a9884', scale: [6.0, 1.4], plates: 0.4, rough: 0.9, lent: 0 },
  shrub: { a: '#5a4f42', b: '#433a30', c: '#1e1a15', lichen: '#8a8670', scale: [10.0, 3.0], plates: 0.3, rough: 0.9, lent: 0 },
};

const BARK_HEAD = /* glsl */ `
varying vec4 vFol;
varying vec2 vAux;
uniform vec3 uBarkA;
uniform vec3 uBarkB;
uniform vec3 uBarkC;
uniform vec3 uLichen;
uniform vec3 uBarkUpper;
uniform vec2 uBarkScale;
uniform float uPlates;
uniform float uLent;
uniform float uSnow;
uniform vec3 uSnowColor;
float vgBarkH(vec2 b){
  vec3 v = cgVoronoi2(vec2(b.x * uBarkScale.x, b.y * uBarkScale.y));
  float crack = smoothstep(0.02, 0.22, v.y - v.x);
  float fib = cgVnoise2(vec2(b.x * 38.0, b.y * 4.0));
  float stri = cgVnoise2(vec2(b.x * 14.0 + cgVnoise2(b * 3.0) * 2.0, b.y * 0.9));
  float h = mix(stri, crack, uPlates) * 0.75 + fib * 0.25;
  // horizontal lenticels (peach / cherry bark)
  h -= uLent * smoothstep(0.86, 0.97, cgVnoise2(vec2(b.x * 9.0, b.y * 55.0))) * smoothstep(0.3, 0.7, cgVnoise2(b * 3.0)) * 0.3;
  return h;
}
`;

const BARK_COLOR = /* glsl */ `
vec2 b = vAux;
float h = vgBarkH(b);
vec3 v = cgVoronoi2(vec2(b.x * uBarkScale.x, b.y * uBarkScale.y));
vec3 c = mix(uBarkB, uBarkA, smoothstep(0.25, 0.85, h + 0.25 * (v.z - 0.5)));
c = mix(uBarkC, c, smoothstep(0.06, 0.3, h));
// pine: thin orange-red bark on the upper trunk and limbs (马尾松)
c = mix(c, uBarkUpper * (0.8 + 0.3 * h), smoothstep(0.3, 0.55, vFol.w) * vFol.z * step(0.001, dot(uBarkUpper, vec3(1.0))) * smoothstep(0.2, 0.6, h));
float li = cgVnoise2(b * vec2(6.0, 4.0) + 11.0) * 0.65 + cgVnoise2(b * 23.0) * 0.35;
c = mix(c, uLichen, smoothstep(0.62, 0.78, li) * 0.5);
// moss / damp near the root and on the shaded side
float base = 1.0 - smoothstep(0.0, 0.16, vFol.w);
c = mix(c, c * vec3(0.55, 0.65, 0.4), base * 0.6 * smoothstep(0.3, 0.7, cgVnoise2(b * 5.0)));
c *= 0.9 + 0.2 * cgSeed;
c *= mix(0.55, 1.0, clamp(vFol.x, 0.0, 1.0));
if (uSnow > 0.0) {
  float up = normalize(vCgWorldNormal).y;
  float sn = smoothstep(0.22, 0.5, up + 0.3 * (cgVnoise3(cgP * 6.0) - 0.5)) * uSnow;
  c = mix(c, uSnowColor, sn);
}
diffuseColor.rgb = c;
`;

const BARK_NORMAL = /* glsl */ `
{
  float h = vgBarkH(vAux);
  vec3 dpx = dFdx(cgP), dpy = dFdy(cgP);
  float dhx = dFdx(h), dhy = dFdy(h);
  vec3 N = cgN;
  vec3 r1 = cross(dpy, N), r2 = cross(N, dpx);
  float det = dot(dpx, r1);
  vec3 grad = sign(det) * (dhx * r1 + dhy * r2);
  vec3 nb = normalize(abs(det) * N - grad * 0.035);
  cgBump = (nb - N) * step(1e-9, abs(det));
}
`;

const BARK_AO = /* glsl */ `
cgAO = mix(0.4, 1.0, smoothstep(0.05, 0.5, vgBarkH(vAux))) * mix(0.5, 1.0, clamp(vFol.x, 0.0, 1.0));
`;

const srgbVec = (hex) => { const c = new THREE.Color(hex); return new THREE.Vector3(c.r, c.g, c.b); };

export function barkMaterial(species) {
  const key = 'bark:' + species;
  if (_cache.has(key)) return _cache.get(key);
  const b = BARK[species] || BARK.broad;
  const m = proceduralMaterial({
    name: `veg-bark-${species}`,
    params: { color: 0xffffff, roughness: b.rough, metalness: 0 },
    uniforms: {
      ...WIND, ...SEASON_U,
      uUvShift: { value: new THREE.Vector2(0, 0) }, uCollapse: { value: 0 },
      uBarkA: { value: srgbVec(b.a) }, uBarkB: { value: srgbVec(b.b) }, uBarkC: { value: srgbVec(b.c) },
      uLichen: { value: srgbVec(b.lichen) }, uBarkUpper: { value: b.upper ? srgbVec(b.upper) : new THREE.Vector3(0, 0, 0) },
      uBarkScale: { value: new THREE.Vector2(...b.scale) }, uPlates: { value: b.plates }, uLent: { value: b.lent },
    },
    vertexHead: VERT_HEAD,
    vertexPre: VERT_WIND,
    head: BARK_HEAD,
    color: BARK_COLOR,
    normal: BARK_NORMAL,
    ao: BARK_AO,
  });
  m.userData.veg = { species, kind: 'bark' };
  REG.add(m);
  _cache.set(key, m);
  return m;
}

// ---------------------------------------------------------------- peach blossom geometry
/** petals: uv.y 0 at the eye → 1 at the petal tip, uv.x 0/1 at the notches. Shown in spring only. */
export function blossomMaterial() {
  const key = 'blossom';
  if (_cache.has(key)) return _cache.get(key);
  const u = folUniforms({ transl: [0.55, 0.32, 0.36], tipAmt: 0, amb: 1.1, up: 0.2, gain: 1 });
  const m = proceduralMaterial({
    name: 'veg-blossom',
    params: { color: 0xffffff, roughness: 0.55, metalness: 0, side: THREE.DoubleSide },
    uniforms: u,
    vertexHead: VERT_HEAD, vertexPre: VERT_WIND, head: FRAG_HEAD,
    color: /* glsl */`
      // radial gradient: deep rose eye → pink → near-white petal tips, per-flower variation
      vec3 eye = vec3(0.6, 0.12, 0.22), mid = vec3(0.86, 0.38, 0.5), tip = vec3(0.93, 0.66, 0.74);
      float g = clamp(vMapUvCg.y, 0.0, 1.0);
      vec3 c = mix(eye, mid, smoothstep(0.0, 0.4, g));
      c = mix(c, tip, smoothstep(0.5, 1.0, g) * (0.45 + 0.55 * vFol.z));
      // a few anther dots in the eye
      c = mix(c, vec3(0.8, 0.6, 0.18), step(g, 0.18) * step(0.6, fract(vMapUvCg.x * 15.0)) * 0.6);
      c *= 0.85 + 0.3 * vFol.z;
      diffuseColor.rgb = c * mix(0.6, 1.0, clamp(vFol.x, 0.0, 1.0)) * uTint;
      cgLeafTrans = uTransl * c / max(cgLuma(c), 0.01) * 0.6;
    `,
    normal: FOL_NORMAL, ao: FOL_AO,
  });
  // the petal parameter travels in uv (no map on this material): pass it through a varying
  const prev = m.onBeforeCompile;
  m.onBeforeCompile = function (shader, r) {
    prev.call(this, shader, r);
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying vec2 vMapUvCg;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvMapUvCg = uv;');
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec2 vMapUvCg;');
  };
  finishLeaf(m);
  m.userData.shaderKey += ':bl1';
  const k = m.userData.shaderKey; m.customProgramCacheKey = () => k;
  m.userData.veg = { species: 'peach', kind: 'blossom', sp: SPECIES.peach };
  REG.add(m);
  _cache.set(key, m);
  setSeasonOn(m, CURRENT);
  return m;
}

// ---------------------------------------------------------------- shadow depth
/** depth material reproducing the vertex animation / ribbon expansion / UV shift of `mat` (shares uniforms) */
export function depthFor(mat) {
  if (mat.userData.depth) return mat.userData.depth;
  const kind = mat.userData.veg?.kind || 'blob';
  const U = mat.userData.cgUniforms;
  const m = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  let head = VERT_HEAD, pre = VERT_WIND;
  if (kind === 'ribbon') { head += RIB_HEAD; pre = VERT_WIND + VERT_RIBBON; }
  const key = 'vg-depth:' + kind + ':' + hashString(head + pre).toString(36);
  m.onBeforeCompile = (shader) => {
    for (const k of ['uWindTime', 'uWindAmp', 'uUvShift', 'uCollapse']) shader.uniforms[k] = U[k];
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${head}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n{\n${pre}\n}`);
  };
  m.customProgramCacheKey = () => key + ':' + mat.uuid;
  m.userData.shaderKey = key;
  if (mat.alphaTest > 0) { m.alphaTest = 0.5; m.map = mat.map; }
  mat.userData.depth = m;
  return m;
}

// ---------------------------------------------------------------- seasons
const SIDX = { spring: 0, summer: 1, autumn: 2, winter: 3 };
function patchDelta(sp, to) {
  const a = cellOf(sp.patch[0], sp.patch[1]), b = cellOf(to[0], to[1]);
  return [((b % GRID) - (a % GRID)) / GRID, (Math.floor(b / GRID) - Math.floor(a / GRID)) / GRID];
}
function setSeasonOn(m, season) {
  const v = m.userData.veg;
  if (v?.custom) {
    const s = SIDX[season] ?? 0, U = m.userData.cgUniforms;
    if (U.uCollapse) U.uCollapse.value = v.seasons && !v.seasons[s] ? 1 : 0;
    if (U.uTint && v.tint) U.uTint.value.set(...v.tint[s]);
    if (U.uSeasonIdx) U.uSeasonIdx.value = s;
    return;
  }
  if (!v || v.kind === 'bark' || !v.sp) return;
  const s = SIDX[season] ?? 0, sp = v.sp, U = m.userData.cgUniforms;
  const bare = sp.deciduous && s === 3;
  U.uCollapse.value = 0;
  U.uUvShift.value.set(0, 0);
  U.uTint.value.set(1, 1, 1);
  U.uSnowK.value = 1;
  if (U.uMono) U.uMono.value.set(0, 0, 0, 0);
  if (U.uTransl) { if (!v.transl0) v.transl0 = U.uTransl.value.clone(); U.uTransl.value.copy(v.transl0); if (bare) U.uTransl.value.set(0, 0, 0); }
  if (v.kind === 'blossom') { U.uCollapse.value = s === 0 ? 0 : 1; return; }
  if (sp.show) U.uCollapse.value = sp.show[s] ? 0 : 1;
  if (v.kind === 'card' || v.kind === 'ribbon') {
    if (sp.seasonal) U.uUvShift.value.set(0, s / GRID);
    if (!sp.seasonal && sp.tint) U.uTint.value.set(...sp.tint[s]);
    // hanging twigs hold no snow; bare twig cards a little; evergreen sprays catch it on top; ground plants only a
    // dusting (the ground's own snow is the terrain's)
    if (bare) U.uSnowK.value = v.kind === 'ribbon' ? 0 : 0.25;
    if (sp.ground) U.uSnowK.value = 0.2;
  } else if (v.kind === 'inner') {
    if (bare || (sp === SPECIES.peach && s === 0)) U.uCollapse.value = bare ? 1 : 0;
    U.uTint.value.set(...sp.tint[s]);
    U.uSnowK.value = 0.12; // the crown core is under the leaves: it holds almost no snow
  } else { // blob, bb
    U.uTint.value.set(...sp.tint[s]);
    const mc = sp.mono?.[s];
    U.uMono.value.set(mc ? mc[0] : 0, mc ? mc[1] : 0, mc ? mc[2] : 0, mc ? 1 : 0);
    if (bare) {
      const d = patchDelta(sp, PATCH.bare); U.uUvShift.value.set(d[0], d[1]); U.uTint.value.set(1, 1, 1); U.uMono.value.w = 0;
      // an opaque clump cannot show bare twigs: the mid-LOD bodies of leafless trees disappear (bark + twig cards remain)
      if (v.kind === 'blob') U.uCollapse.value = 1;
      if (v.kind === 'bb') U.uSnowK.value = 0.25;
    }
    if (v.kind === 'bb' && !bare) U.uSnowK.value = 0.3;
    if (v.kind === 'blob' && !bare) U.uSnowK.value = 0.32;
  }
  if (v.kind === 'inner' && U.uMono) { const mc = sp.mono?.[s]; U.uMono.value.set(mc ? mc[0] * 0.5 : 0, mc ? mc[1] * 0.5 : 0, mc ? mc[2] * 0.5 : 0, mc ? 1 : 0); }
}

/** register a material built elsewhere (lotus, ground plants) with the season switch.
 *  veg = { kind: 'lotus' | 'ground' | ..., seasons: [shown in spring, summer, autumn, winter] (0/1), tint: [4 × rgb] } */
export function registerSeasonal(m, veg) {
  m.userData.veg = { ...veg, custom: true };
  REG.add(m);
  setSeasonOn(m, CURRENT);
  return m;
}
export const SHADER = { VERT_HEAD, VERT_WIND, FRAG_HEAD, FOL_NORMAL, FOL_AO, TRANSLUCENT_GLSL, SPEC_GLSL, finishLeaf: (m) => finishLeaf(m), folUniforms: (sp) => folUniforms(sp) };

/** switch every vegetation material to a season ('spring' | 'summer' | 'autumn' | 'winter') */
export function applySeason(season) {
  if (!(season in SIDX)) season = 'spring';
  CURRENT = season;
  SEASON_U.uSnow.value = season === 'winter' ? 1 : 0;
  for (const m of REG) setSeasonOn(m, season);
  return season;
}
export const currentSeason = () => CURRENT;
export { SEASONS };
