// Shared pieces of the building materials (src/materials/*): the per-vertex attributes written by the yingzao
// MeshBuilder, one uniform set for every building in the world, and GLSL helpers for weathering, snow and night.
//
// Attributes: aPaint = (kind, v, h, u) — paint scheme id (yingzao/geom.js PAINT), height above the member's bottom
// edge, member height, distance along the member (m); aUV = metric surface coordinates; aAO = (ambient occlusion,
// sky-up visibility) baked by yingzao/ao.js.
//
// World-wide switches (set them per shot, see setBuildingLook()):
//   YZ.uSnow  0..1  snow lying on surfaces open to the sky (ref10), slushy wet margins
//   YZ.uNight 0..1  lit openings and lanterns (warm 2200 K lamplight, ref05); YZ.uGlow sets their brightness
//   YZ.uWeather 0..1  age of paint and plaster
import * as THREE from 'three';
import { PAINT } from '../yingzao/geom.js';

/** linear RGB of a black body at ~2200 K (oil lamps, candles behind paper) */
export const LAMP_2200K = new THREE.Color(1.0, 0.33, 0.045);

export const YZ = {
  // the refs' timber reads red and warm in daylight: 土朱 brought up to the ART_BIBLE's red-lacquer
  // albedo (0.22–0.34, 0.05–0.08, 0.03–0.05), 丹 brighter; 青 / 綠 accents (解綠 edges on the bracket arms, 石青 on the
  // 枓) for the coloured band under the eaves the refs show
  uZhu: { value: new THREE.Color(0.21, 0.047, 0.029) },     // 土朱 red lacquer (sRGB ≈ #7f3d2f)
  uDan: { value: new THREE.Color(0.36, 0.075, 0.03) },      // 丹 (vermilion lead)
  uHuangdan: { value: new THREE.Color(0.3, 0.13, 0.05) },   // 黃丹 (minium orange)
  uLu: { value: new THREE.Color(0.045, 0.13, 0.095) },      // 綠 (石綠, malachite green, aged)
  uQing: { value: new THREE.Color(0.04, 0.085, 0.13) },     // 青 (石青, azurite blue, aged)
  uWhite: { value: new THREE.Color(0.58, 0.55, 0.48) },     // 白粉 / lime
  uWhiteLine: { value: 0.025 },                             // 緣道 width (m)
  uWeather: { value: 0.6 },                                 // 0 new … 1 old
  uLaneBand: { value: new THREE.Vector2(0.24, 0.76) },      // 七朱八白: white band (fraction of the 闌額 height)
  uTileCourse: { value: 0.16 },                             // exposed length of a 瓪瓦 course (m)
  uTongLen: { value: 0.38 },                                // exposed length of a 甋瓦 (m)
  uSnow: { value: 0 },
  uNight: { value: 0 },
  uGlow: { value: 9.0 },                                    // lamplit opening radiance at full night
  uGlowColor: { value: LAMP_2200K.clone() },
};

/** per-shot look: { snow, night, weather } (numbers 0..1); call from a shot hook */
export function setBuildingLook({ snow = 0, night = 0, weather = null, glow = null } = {}) {
  YZ.uSnow.value = snow; YZ.uNight.value = night;
  if (weather !== null) YZ.uWeather.value = weather;
  if (glow !== null) YZ.uGlow.value = glow;
}

export const K = (n) => `${PAINT[n].toFixed(1)}`;

export const ATTR_V = /* glsl */`
attribute vec4 aPaint;
attribute vec2 aUV;
attribute vec2 aAO;
varying vec4 vPaint;
varying vec2 vUV2;
varying vec2 vAO;
`;
export const ATTR_PRE = /* glsl */`vPaint = aPaint; vUV2 = aUV; vAO = aAO;`;

export const UNIFORMS_GLSL = /* glsl */`
uniform vec3 uZhu; uniform vec3 uDan; uniform vec3 uHuangdan; uniform vec3 uWhite; uniform vec3 uLu; uniform vec3 uQing;
uniform float uWhiteLine; uniform float uWeather; uniform vec2 uLaneBand;
uniform float uTileCourse; uniform float uTongLen;
uniform float uSnow; uniform float uNight; uniform float uGlow; uniform vec3 uGlowColor;
`;

/** fragment head: varyings, uniforms, helpers. Globals carry values between hooks (color → roughness / normal). */
export const ATTR_F = /* glsl */`
varying vec4 vPaint;
varying vec2 vUV2;
varying vec2 vAO;
${UNIFORMS_GLSL}
float yzRough;
float yzMetal;
float yzAO;
vec3 yzBump;
vec3 yzEmit;
float yzKind() { return floor(vPaint.x + 0.5); }
bool yzIs(float k, float id) { return abs(k - id) < 0.5; }
// tangent of the paint coordinate u (along the member) in world space, from screen derivatives
vec3 yzTangentU(vec3 P, vec3 N, float u) {
  vec3 dpx = dFdx(P), dpy = dFdy(P);
  float dux = dFdx(u), duy = dFdy(u);
  vec3 t = cross(dpy, N) * dux + cross(N, dpx) * duy;
  float l = length(t);
  vec3 r = l > 1e-10 ? t / l : vec3(1.0, 0.0, 0.0);
  if (any(isnan(r)) || any(isinf(r))) r = vec3(1.0, 0.0, 0.0);
  return r;
}
// snow cover: faces open to the sky and tilted up; patchy, thinning at the margins. returns (cover, slush band)
vec2 yzSnow(vec3 P, vec3 N, float up) {
  if (uSnow <= 0.0) return vec2(0.0);
  float n = cgVfbm3(P * 0.35, 3) * 0.6 + cgVnoise3(P * 2.7) * 0.4;
  float tilt = smoothstep(0.32, 0.78, N.y + (n - 0.5) * 0.35);
  float open = smoothstep(0.25, 0.75, up);
  float s = tilt * open * uSnow;
  float cover = smoothstep(0.32, 0.5, s + (n - 0.5) * 0.25);
  float band = smoothstep(0.12, 0.3, s) * (1.0 - cover);
  return vec2(cover, band);
}
// apply snow to an albedo / roughness pair (call last in the colour hook)
void yzApplySnow(inout vec3 c, vec3 P, vec3 N, float up) {
  vec2 sn = yzSnow(P, N, up);
  if (sn.x + sn.y <= 0.0) return;
  c = mix(c, c * 0.62, sn.y);                       // wet, dark margin of melting snow (slush)
  yzRough = mix(yzRough, 0.35, sn.y * 0.7);
  vec3 snow = vec3(0.80, 0.83, 0.88) * (0.94 + 0.08 * cgVnoise3(P * 9.0));
  c = mix(c, snow, sn.x);
  yzRough = mix(yzRough, 0.72, sn.x);
  yzMetal = mix(yzMetal, 0.0, sn.x);
}
`;

/** standard material options shared by the families */
export function familyOptions(name, extra = {}) {
  return {
    name,
    params: { color: 0xffffff, roughness: 0.8, metalness: 0, ...(extra.params || {}) },
    uniforms: YZ,
    vertexHead: ATTR_V,
    vertexPre: ATTR_PRE,
  };
}

/** hooks that read the globals set by a colour hook */
export const HOOKS = {
  roughness: 'roughnessFactor = yzRough;',
  metalness: 'metalnessFactor = yzMetal;',
  ao: 'cgAO = yzAO;',
  normal: 'cgBump = yzBump;',
  emissive: 'totalEmissiveRadiance = yzEmit;',
};
export const INIT = 'yzRough = 0.8; yzMetal = 0.0; yzAO = 1.0; yzBump = vec3(0.0); yzEmit = vec3(0.0);';
