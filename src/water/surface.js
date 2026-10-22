// Water surface at y = level: West Lake, the city canals and the Qiantang.
//
// Two draws of one huge plane, both in the transparent pass (after the terrain):
//  1. "absorb" pass (multiplicative blend): the terrain already drawn under the water is the real lake bed; it is
//     multiplied by the per-channel transmittance of the water column (Beer–Lambert, view + sun path) → the bed
//     vanishes within a metre of turbid jade water, and the shoreline is seamless.
//  2. "surface" pass (premultiplied blend, lit MeshPhysicalMaterial with CSM shadows):
//     - wind: glassy mirror zones broken by drifting ripple patches (cat's paws) and long slick streaks along the wind;
//       the FFT ripple tile (LEAN-filtered) carries the slopes, sheltered near the shore and in the lotus pond
//     - the mirror: the planar reflection traced with several taps over the sub-pixel slope distribution (reflected
//       lights stretch into long broken vertical streaks, the way a lake does it), with the haze of the reflected
//       path computed over the whole unfolded path camera → water → object, and the lake mist (src/water/mistfield.js)
//       the reflected ray crosses
//     - the sun / moon: the material's GGX specular (shadowed) spread by the slope variance into a glitter path,
//       broken into twinkling glints where the ripples are partly resolved
//     - body: single scattering of a turbid jade-grey (or silty river) water column, caustics in the sunny shallows
//     - boat wakes (layout BOATS): a Kelvin V behind a moving boat, rings round moored hulls, a calm strip astern
//     - winter: shore ice sheets, broken plates and slush at the ice edge, snow on the ice near the banks, dark open
//       water further out
//     - the 钱塘潮 bore (src/modules/tide.js sets uBore*): calm muddy water ahead of the front, a white apron and
//       turbulent, choppy, foam-streaked water behind it
//     - its own atmosphere over the premultiplied colour
// Forked from Athenaion's water/surface.js (MIT, see NOTICE): the two-pass structure, the FFT octave sampling, the
// LEAN roughness, the foam texture and the premultiplied fog are theirs; the lake features above are ours.
import * as THREE from 'three';
import { proceduralMaterial } from '../core/materials.js';
import { ATMO_GLSL, atmoUniforms } from '../core/atmosphere.js';
import { NOISE_GLSL } from '../core/glsl.js';
import { hashString } from '../core/rng.js';
import { SKY } from '../core/sky.js';
import { VMAX } from './flow.js';
import { LAKE_MIST, LAKE_MIST_GLSL } from './mistfield.js';

export const MAX_BOATS = 8;
export const MAX_POND = 8;

// ------------------------------------------------------------------ shared GLSL
export const WATER_COMMON_GLSL = /* glsl */`
uniform sampler2D tHNear; uniform vec4 uHNearB;
uniform sampler2D tHFar; uniform vec4 uHFarB;
uniform float uLevel;
uniform vec3 uAbsorb;
uniform float uTurbid;          // optical-depth multiplier of the water column (silt, algae)
uniform sampler2D tFlow; uniform vec4 uFlowB;
uniform vec4 uBore; uniform vec4 uBoreB; uniform float uBoreT;   // tidal bore front (see SURF_HEAD)
float wInBounds(vec2 uv){ vec2 e = min(uv, 1.0 - uv); return smoothstep(0.0, 0.004, min(e.x, e.y)); }
vec4 wFlow(vec2 xz, out float inF){
  vec2 fuv = (xz - uFlowB.xy) / (uFlowB.zw - uFlowB.xy);
  inF = wInBounds(fuv);
  return texture(tFlow, fuv);
}
// terrain height under the water (captured mesh), bias = texture LOD bias (blur)
float wTerrainH(vec2 xz, float bias){
  vec2 un = (xz - uHNearB.xy) / (uHNearB.zw - uHNearB.xy);
  vec2 uf = (xz - uHFarB.xy) / (uHFarB.zw - uHFarB.xy);
  float hn = texture(tHNear, un, bias).r;
  float hf = texture(tHFar, uf, bias).r;
  float h = mix(-40.0, hf, wInBounds(uf));
  return mix(h, hn, wInBounds(un));
}
// signed distance (m) behind the bore front (> 0 = downstream of it, where the flood tide has arrived)
float wBoreSD(vec2 xz){
  if (uBoreB.w < 0.5) return -1e5;
  vec2 d = xz - uBore.xy;
  vec2 n = uBore.zw, t = vec2(n.y, -n.x);
  float al = dot(d, t);
  // the front's plan shape: keep in sync with bow() in src/modules/tide.js (the wall mesh)
  float bow = 1.1e-5 * al * al + 5.0 * sin(al / 170.0 + 1.3) + 1.8 * sin(al / 37.0 + 0.4);
  return dot(d, n) + uBoreB.x * uBoreT + bow;
}
float wTurbidAt(vec2 xz){
  float sd = wBoreSD(xz);
  // the bore stirs the silt up: opaque brown behind the front, muddy ahead of it
  return uTurbid * (1.0 + 2.5 * smoothstep(-5.0, 10.0, sd) * uBoreB.w);
}
vec3 wBedTransmittance(float depth, float cv, float ls){
  float ct = sqrt(max(0.0, 1.0 - (1.0 - cv * cv) / 1.777));
  float cs = sqrt(max(0.0, 1.0 - (1.0 - ls * ls) / 1.777));
  vec3 T = exp(-uAbsorb * depth * (1.0 / max(ct, 0.05) + 1.0 / max(cs, 0.2)));
  // wet + silt/algae film on the bed: darker, olive-green (fades in over the first ~30 cm)
  vec3 wet = mix(vec3(1.0), vec3(0.42, 0.47, 0.40), smoothstep(0.0, 0.3, depth));
  return T * wet;
}
`;

const SURF_HEAD = /* glsl */`
${ATMO_GLSL}
${WATER_COMMON_GLSL}
${LAKE_MIST_GLSL}
uniform float uTime;
uniform sampler2D tWaves;
uniform vec4 uWaveScale; uniform vec4 uWaveAmp; uniform vec4 uWaveAng;
uniform sampler2D tRefl; uniform sampler2D tReflDepth;
uniform mat4 uReflMatrix; uniform mat4 uReflInvVP; uniform float uReflOn; uniform float uReflPix; uniform vec2 uReflSize;
uniform vec3 uScatter;
uniform vec3 uFoamCol;
uniform float uDebug;
uniform float uEnvBoost;
uniform vec3 uSkyRefl;
uniform float uFrameW;
uniform float uReflGain;
uniform float uReflLod;
uniform float uShoreFoam;   // shoreline lapping foam amount (calm lakes: low)
uniform vec4 uWind;         // xy: wind direction (unit, blowing toward), z: patch contrast (0 = uniform ripples), w: glassy floor
uniform vec4 uPatch;        // x: cat's-paw size (m), y: slick streak length (m), z: streak width (m), w: rippled share 0..1
uniform float uReflAniso;   // stretch of the slope blur toward the eye (1 = physical)
uniform vec4 uReflTaps;     // x: slope-blur gain (1 = physical), y: extra slope variance, z: far haze over the unfolded path (0/1), w: mist veil gain
uniform vec2 uSunSpec;      // x: gain of the (unshadowed) sun / moon glint, y: share of three's shadowed direct specular kept
uniform vec4 uGlitter;      // x: twinkle strength 0..1, y: glint cell (m), z: twinkle rate (1/s), w: extra slope variance (path width)
uniform vec4 uBoat[${MAX_BOATS}]; uniform vec4 uBoatB[${MAX_BOATS}]; uniform int uBoatN;  // x, z, heading dir x, z ; length, beam, speed (m/s), moored rings
uniform vec4 uIce;          // x: amount, y: depth (m) the shore ice reaches out to, z: snow on the ice, w: slush
uniform vec3 uIceCol;       // frosted ice albedo
uniform vec2 uPondPts[${MAX_POND}]; uniform int uPondN;
uniform vec4 uPond;         // x: edge feather (m), y: ripple amplitude in the pond, z: body darkening, w: ripple scale
uniform float uPondRefl;    // the leaf canopy hides most of the sky from the pond water (reflection gain under the leaves)
uniform vec3 uMud;          // silty river body colour (the Qiantang)
uniform float uMudK;        // 0..1 share of the silty river body (the river regions)
uniform vec4 uBoreC;        // x: chop gain behind the front, y: foam apron width (m), z: turbulent zone length (m), w: calm ahead (amp mult)

// values shared between the hooks of this material
vec4 wPre0; vec3 wDbgL; vec3 wGlintE; vec3 wSkyT; float wFrost; vec3 wN; float wVar; float wFoam; vec3 wRefl; float wReflW; vec3 wTbed; float wRough; float wSpark; float wIceK;

vec3 wOct(vec2 p, float scale, float ang, float amp){
  float c = cos(ang), s = sin(ang);
  vec2 q = vec2(c * p.x - s * p.y, s * p.x + c * p.y) / scale;
  vec4 w = texture(tWaves, q);
  vec2 g = vec2(c * w.x + s * w.y, -s * w.x + c * w.y) * amp;
  float v = max(0.0, 0.5 * (w.z + w.w - w.x * w.x - w.y * w.y)) * amp * amp;
  return vec3(g, v);
}
// 4 octaves of the FFT tile; amp4 = per-octave slope amplitude; sc = scale multiplier (smaller ripples in the pond)
vec3 wWaves(vec2 p, vec4 amp4, float sc){
  // large octave: domain-warped so the tile never reads as a grid from the air
  vec2 wq = p * 0.0125;
  vec2 warp = vec2(cgVnoise2(wq), cgVnoise2(wq + 5.3)) * 28.0;
  vec3 r = wOct(p + warp, uWaveScale.x * sc, uWaveAng.x, amp4.x);
  r += wOct(p + vec2(13.7, 5.1), uWaveScale.y * sc, uWaveAng.y, amp4.y);
  r += wOct(p + vec2(3.3, 17.9), uWaveScale.z * sc, uWaveAng.z, amp4.z);
  r += wOct(p + vec2(7.9, 1.3), uWaveScale.w * sc, uWaveAng.w, amp4.w);
  return r;
}
// clumpy foam: blotches of value noise riddled with round bubble holes (streaky when p is stretched)
// fw = pixel footprint in p units: octaves finer than ~2 px fade to their mean (no moiré at grazing angles)
float wFoamTex(vec2 p, float fw){
  float a1 = 1.0 - smoothstep(0.25, 0.6, fw * 2.13), a2 = 1.0 - smoothstep(0.25, 0.6, fw * 4.7), a3 = 1.0 - smoothstep(0.2, 0.5, fw * 3.3);
  float n = cgVnoise2(p) * 0.5 + mix(0.5, cgVnoise2(p * 2.13 + 1.7), a1) * 0.3 + mix(0.5, cgVnoise2(p * 4.7 + 3.3), a2) * 0.2;
  float bub = 0.62;
  if (a3 > 0.0) { vec3 v = cgVoronoi2(p * 3.3 + 5.1); bub = mix(0.62, smoothstep(0.06, 0.42, v.x), a3); }
  return clamp(n * (0.5 + 0.5 * bub) + 0.12 * bub, 0.0, 1.0);
}
// signed distance to the lotus-pond polygon (negative inside)
float wPondSD(vec2 p){
  if (uPondN < 3) return 1e5;
  float d = 1e10, s = 1.0;
  for (int i = 0; i < ${MAX_POND}; i++) {
    if (i >= uPondN) break;
    int j = i == 0 ? uPondN - 1 : i - 1;
    vec2 a = uPondPts[i], b = uPondPts[j];
    vec2 e = b - a, w = p - a;
    vec2 q = w - e * clamp(dot(w, e) / dot(e, e), 0.0, 1.0);
    d = min(d, dot(q, q));
    bvec3 c = bvec3(p.y >= a.y, p.y < b.y, e.x * w.y > e.y * w.x);
    if (all(c) || all(not(c))) s = -s;
  }
  return s * sqrt(d);
}
// haze between the water point P and the reflected object O, with the art-directed far term taken over the
// whole unfolded path camera → P → O (dCam = |camera - P|): the far haze grows with the square of the distance, so
// splitting the path in two would halve it and leave the mirrored far hills crisper than the hills themselves
vec3 wAtmoRefl(vec3 col, vec3 P, vec3 O, float dCam){
  if (uAtmoEnabled < 0.5) return col;
  vec3 Vr = O - P; float dist = length(Vr); vec3 dir = Vr / max(dist, 1e-4);
  float tH = atmoOD(P.y, dir.y, dist, uHaze.x, uHaze.y, uHaze.z) + atmoOD(P.y, dir.y, dist, uHazeLow.x, uHazeLow.y, 0.0);
  float f0 = dCam / uHazeFar.y, f1 = (dCam + dist) / uHazeFar.y, fs = dist / uHazeFar.y;
  float far = mix(fs * fs, f1 * f1 - f0 * f0, uReflTaps.z);
  tH += uHazeFar.x * max(far, 0.0) * exp(-max(P.y + dir.y * dist * 0.5, 0.0) / 2500.0);
  float tM = atmoOD(P.y, dir.y, dist, uMist.x, uMist.y, uMist.z);
  vec3 TH = exp(-tH * uExtinction);
  float TM = exp(-tM);
  col = col * TH + atmoHazeInscatter(dir) * (1.0 - TH);
  col = col * TM + atmoMistInscatter(dir) * (1.0 - TM);
  return col;
}
// Kelvin wake + hull rings of the boats: height field (m) and a calm-strip factor (1 = calm) at xz
vec2 wWakeH(vec2 xz){
  float h = 0.0, calm = 0.0;
  for (int i = 0; i < ${MAX_BOATS}; i++) {
    if (i >= uBoatN) break;
    vec4 b = uBoat[i], bb = uBoatB[i];
    vec2 d = xz - b.xy;
    float L = bb.x, B = bb.y, U = bb.z;
    float r = length(d);
    if (r > L * 14.0 + 40.0) continue;
    float u = dot(d, b.zw), v = dot(d, vec2(-b.w, b.z));   // u forward, v to the side
    float hull = length(vec2(u / (L * 0.5), v / (B * 0.5)));
    // rings round the hull (bobbing at the mooring / paddle strokes): decaying circular ripples
    float rr = max(hull - 1.0, 0.0) * L * 0.5;
    h += bb.w * 0.012 * sin(rr * 5.5 - uTime * 3.1 + float(i) * 1.7) * exp(-rr / 6.0) * smoothstep(0.0, 0.6, rr);
    if (U > 0.05) {
      // behind the stern: two diverging arms at the Kelvin angle (19.5°) with short transverse waves between them
      float s = -u - L * 0.5;                               // distance astern
      if (s > 0.0) {
        float arm = abs(v) - s * 0.354;
        float w = 0.35 + s * 0.035;
        float k = 9.81 / max(U * U, 0.04);                  // transverse wavenumber (deep water, boat speed)
        float decay = exp(-s / (L * 9.0 + 25.0));
        float armH = exp(-arm * arm / (w * w)) * sin(s * k * 0.62 + abs(v) * k * 0.4 - uTime * 2.0);
        float inner = (1.0 - smoothstep(-w, w, arm)) * sin(s * k - uTime * U * k) * 0.35;
        h += 0.022 * U * decay * (armH + inner);
        // the hull's turbulent wake flattens the ripples in a strip astern (a glassy trail on a rippled lake)
        calm = max(calm, decay * (1.0 - smoothstep(B * 0.4, B * 0.9 + s * 0.06, abs(v))) * smoothstep(0.0, L * 0.5, s));
      }
    }
  }
  return vec2(h, calm);
}
`;

const SURF_COLOR = /* glsl */`
  vec3 P = vec3(cgP.x, uLevel, cgP.z);
  vec3 V = cgV;
  wSkyT = uSkyRefl;
  float dCam = distance(cameraPosition, P);
  float hT = wTerrainH(P.xz, 0.0);
  float depth = max(0.0, uLevel - hT);
  float depthSoft = max(0.0, uLevel - wTerrainH(P.xz, 2.5));
  float pxw = sqrt(max(length(dFdx(P.xz)), length(dFdy(P.xz))) * min(length(dFdx(P.xz)), length(dFdy(P.xz))));   // metres per pixel
  // ---- drift flow (advects the ripple tile in the video)
  float inF;
  vec4 fl = wFlow(P.xz, inF);
  vec2 flow = (fl.xy - 0.5) * ${(2 * VMAX).toFixed(1)} * inF;
  // ---- wind: drifting cat's paws (rippled patches) and long slick streaks along the wind; glassy water between
  vec2 wd = uWind.xy, wnr = vec2(-wd.y, wd.x);
  vec2 qw = vec2(dot(P.xz, wd), dot(P.xz, wnr));
  vec2 qg = qw - vec2(uTime * 1.6, 0.0);                     // the gusts run downwind
  float paws = cgVfbm2(vec2(qg.x / (uPatch.x * 1.3), qg.y / uPatch.x) + 3.1, 4);
  float streak = cgVnoise2(vec2(qw.x / uPatch.y, qw.y / uPatch.z) + 7.7) * 0.7 + cgVnoise2(vec2(qw.x / (uPatch.y * 0.4), qw.y / (uPatch.z * 0.5)) + 1.3) * 0.3;
  float ripK = smoothstep(1.0 - uPatch.w - 0.14, 1.0 - uPatch.w + 0.14, paws * 0.78 + streak * 0.32 - 0.05);
  float windK = mix(1.0, mix(uWind.w, 1.25, ripK), uWind.z);
  // shelter: the banks and their trees calm the water within a few metres of the shore
  float shelter = mix(0.4, 1.0, smoothstep(0.0, 2.2, depth));
  // lotus pond: calm, small ripples between the leaves
  float pondSD = wPondSD(P.xz);
  float pond = 1.0 - smoothstep(-uPond.x, uPond.x, pondSD);
  wSkyT *= mix(1.0, uPondRefl, pond);
  // ---- the bore
  float boreSD = wBoreSD(P.xz);
  float behind = uBoreB.w * smoothstep(-3.0, 8.0, boreSD) * exp(-max(boreSD, 0.0) / max(uBoreC.z, 1.0));
  float ahead = uBoreB.w * (1.0 - smoothstep(-6.0, 0.0, boreSD));
  vec4 amp = uWaveAmp * windK * shelter;
  amp *= mix(1.0, uPond.y, pond);
  amp *= mix(1.0, uBoreC.w, ahead);
  amp *= 1.0 + uBoreC.x * behind * vec4(0.6, 1.0, 1.3, 1.5);
  // ---- winter ice: sheets reaching out from the shore over the shallows, broken into plates at the edge
  float ice = 0.0, slush = 0.0, iceSnow = 0.0, rim = 0.0; wFrost = 0.0;
  float depthIce = depthSoft;
  if (uIce.x > 0.0) {
    // a smooth water depth for the ice (4 rotated taps at a fine mip: the coarse mip's bilinear iso-lines drew the
    // ice edge as straight-sided polygons)
    vec2 o1 = vec2(2.3, 0.9), o2 = vec2(-0.9, 2.3);
    depthIce = max(0.0, uLevel - 0.25 * (wTerrainH(P.xz + o1, 1.0) + wTerrainH(P.xz - o1, 1.0) + wTerrainH(P.xz + o2, 1.0) + wTerrainH(P.xz - o2, 1.0)));
    depthIce += 0.35 * (cgVnoise2(P.xz / 7.0 + 3.3) - 0.5);
    float nE = cgVfbm2(P.xz / 110.0 + 1.3, 4) * 0.7 + cgVnoise2(P.xz / 24.0) * 0.3;
    float reach = uIce.y * (0.45 + 0.85 * nE);
    float iceZ = 1.0 - smoothstep(reach - 0.18, reach + 0.18, depthIce);
    // plates ~3 m with wobbly, broken edges (domain-warped cells: plain Voronoi cells read as straight-sided polygons)
    vec2 wq = P.xz / 3.2 + 0.7 * vec2(cgVnoise2(P.xz / 1.9), cgVnoise2(P.xz / 1.9 + 5.0)) + 0.25 * vec2(cgVnoise2(P.xz / 0.6 + 2.0), cgVnoise2(P.xz / 0.6 + 7.0));
    vec3 vc = cgVoronoi2(wq + 2.7);
    float cellR = cgHash11(vc.z * 91.7);
    float edgeZ = smoothstep(0.0, 0.35, iceZ) * (1.0 - smoothstep(0.55, 0.95, iceZ));
    // plates near the edge: whole cells drop out (open leads), the rest keep a dark crack between them
    float plate = step(0.35 * edgeZ, cellR * (0.4 + 0.6 * iceZ));
    rim = 1.0 - smoothstep(0.03, 0.14, vc.y - vc.x);
    ice = uIce.x * iceZ * plate * (1.0 - rim * edgeZ * 0.85);
    slush = uIce.x * uIce.w * edgeZ * (1.0 - plate * 0.6) * smoothstep(0.3, 0.7, cgVnoise2(P.xz / 3.0));
    // snow: on the ice near the banks, along the plate rims, in drifts
    float drift = smoothstep(0.35, 0.75, cgVfbm2(P.xz / 7.0 + 9.1, 3));
    iceSnow = uIce.z * ice * clamp(smoothstep(0.55, 0.05, depthIce) * (0.6 + 0.6 * drift) + rim * edgeZ * 0.7 + drift * 0.25 * smoothstep(0.2, 0.9, iceZ), 0.0, 1.0);
    amp *= 1.0 - max(ice, slush * 0.8);
  }
  wIceK = ice;
  // ---- ripples (flow-advected, two phases)
  const float TP = 3.0;
  float ph0 = fract(uTime / TP), ph1 = fract(uTime / TP + 0.5);
  float b0 = 1.0 - abs(2.0 * ph0 - 1.0), b1 = 1.0 - b0;
  vec2 o0 = flow * (ph0 - 0.5) * TP, o1 = flow * (ph1 - 0.5) * TP;
  float sc = mix(1.0, uPond.w, pond);
  vec3 w0 = wWaves(P.xz - o0, amp, sc);
  vec3 w1 = wWaves(P.xz - o1 + vec2(37.3, 11.9), amp, sc);
  float bn = inversesqrt(b0 * b0 + b1 * b1);
  vec2 slope = (w0.xy * b0 + w1.xy * b1) * bn;
  wVar = (w0.z * b0 + w1.z * b1);
  // ---- boat wakes (finite differences of the wake height field; skipped when no boat is near)
  if (uBoatN > 0) {
    float e = max(0.06, pxw * 0.5);
    vec2 h0 = wWakeH(P.xz);
    float hx = wWakeH(P.xz + vec2(e, 0.0)).x, hz = wWakeH(P.xz + vec2(0.0, e)).x;
    slope *= 1.0 - 0.75 * h0.y; wVar *= 1.0 - 0.85 * h0.y;
    slope += vec2(hx - h0.x, hz - h0.x) / e * (1.0 - ice);
  }
  // ---- ice surface: nearly flat, gently uneven (wobbly, blurred mirror)
  if (ice > 0.0) {
    vec2 g = vec2(cgVnoise2(P.xz * 0.9 + 3.0), cgVnoise2(P.xz * 0.9 + 8.0)) - 0.5;
    slope = mix(slope, g * 0.018, ice);
    wVar = mix(wVar, 0.0006, ice);
  }
  wN = normalize(vec3(-slope.x, 1.0, -slope.y));
  // ---- foam: shore lapping, the bore's white apron and the streaks behind it
  vec2 fdir = length(flow) > 1e-4 ? normalize(flow) : wd;
  vec2 q0 = P.xz - o0, q1 = P.xz - o1 + vec2(19.1, 7.7);
  vec2 fsc = vec2(0.42);
  float fwF = pxw * 0.714;
  vec2 sOff = fdir * 0.6 * 0.714;
  float ft0 = wFoamTex(q0 * fsc * 1.7, fwF) * 0.6 + wFoamTex(q0 * fsc * 1.7 - sOff, fwF) * 0.4;
  float ft1 = wFoamTex(q1 * fsc * 1.7 + 3.7, fwF) * 0.6 + wFoamTex(q1 * fsc * 1.7 + 3.7 - sOff, fwF) * 0.4;
  float ft = ft0 * b0 + ft1 * b1;
  float fine = mix(0.5, cgVnoise2(P.xz * 3.1), 1.0 - smoothstep(0.25, 0.6, pxw * 3.1)) * 0.5
             + mix(0.5, cgVnoise2(P.xz * 7.3 - o0 * 2.0), 1.0 - smoothstep(0.25, 0.6, pxw * 7.3)) * 0.5;
  float lap = 0.18 * sin(uTime * 1.15 + cgVnoise2(P.xz * 0.12) * 9.0) + 0.1 * cgVnoise2(P.xz * 0.6);
  float shore = (1.0 - smoothstep(0.0, 0.32 + 0.25 * cgVnoise2(P.xz * 0.2), depth + lap)) * step(0.0005, depth);
  float amount = shore * 0.85 * uShoreFoam * (1.0 - ice);
  // the bore: a solid white apron right behind the breaking front, then broken streaks across the river
  float apron = uBoreB.w * smoothstep(-2.0, 1.0, boreSD) * (1.0 - smoothstep(uBoreC.y * 0.4, uBoreC.y, boreSD));
  vec2 bt = vec2(-uBore.w, uBore.z);
  float bStreak = smoothstep(0.35, 0.8, cgVnoise2(vec2(dot(P.xz, bt) / 6.0, boreSD / 45.0 - uTime * 0.05)) * 0.7 + 0.3 * ft);
  amount = max(amount, apron);
  // the streaks come in irregular drifts, not an even field of dashes (ref09: churned grey water with a few foam lanes)
  float drift = smoothstep(0.25, 0.75, cgVnoise2(P.xz / 110.0 + 4.1) * 0.7 + cgVnoise2(P.xz / 37.0 + 9.3) * 0.3);
  amount = max(amount, behind * (0.16 + 0.55 * bStreak * drift));
  vec2 lq0 = q0 * fsc * 0.3, lq1 = q1 * fsc * 0.3 + 1.3;
  float ftLow = (cgVnoise2(lq0) * 0.7 + cgVnoise2(lq0 * 2.1 + 3.3) * 0.3) * b0 + (cgVnoise2(lq1) * 0.7 + cgVnoise2(lq1 * 2.1 + 3.3) * 0.3) * b1;
  float mask = smoothstep(1.0 - amount * 1.25 - 0.1, 1.0 - amount * 1.25 + 0.25, ftLow);
  float lace = smoothstep(0.5 - 0.42 * amount, 0.6 - 0.36 * amount, ft * 0.8 + fine * 0.3);
  wFoam = clamp(mask * lace * min(1.0, amount * 2.4) + smoothstep(0.7, 1.0, apron) * 0.75, 0.0, 1.0);
  // aerated, silt-laden water between the foam behind the bore (milky brown, opaque)
  float aerW = clamp(behind * 0.8 + apron * 0.6, 0.0, 1.0) * (1.0 - wFoam);
  // ---- water body (single scatter, saturating with the optical depth along the view)
  float cv = max(dot(wN, V), 0.02);
  float ls = max(uSunDir.y, 0.03);
  float turbid = wTurbidAt(P.xz);
  vec3 Tv = exp(-uAbsorb * depth * turbid / max(sqrt(max(0.0, 1.0 - (1.0 - cv * cv) / 1.777)), 0.05));
  wTbed = wBedTransmittance(depth * turbid, max(V.y, 0.02), ls);
  vec3 body = uScatter * (1.0 - Tv);
  body *= mix(1.0, uPond.z, pond);
  // the Qiantang carries silt everywhere (grey-brown), more of it churned up behind the bore
  body = mix(body, uMud * (0.85 + 0.3 * fine) * (1.0 + 0.35 * behind), max(uMudK, uBoreB.w));
  // caustics on the bed (as extra diffuse: only where the sun reaches)
  vec2 cp = P.xz * 0.55 + slope * 3.0;
  vec3 cvn = cgVoronoi2(cp + vec2(uTime * 0.12, uTime * 0.07));
  float caus = pow(1.0 - smoothstep(0.0, 0.35, cvn.y - cvn.x), 3.0);
  body += vec3(0.32, 0.36, 0.3) * caus * 0.35 * wTbed * smoothstep(0.08, 0.6, depth) * (1.0 - smoothstep(2.0, 6.0, depth)) * (1.0 - ice);
  // foam lit as a rough white diffuse layer
  vec3 foamAlb = uFoamCol * (0.82 + 0.18 * fine);
  float F = 0.02 + 0.98 * pow(1.0 - cv, 5.0);
  vec3 alb = mix(body, foamAlb, wFoam);
  float alpha = 1.0 - (1.0 - F) * (1.0 - wFoam) * (1.0 - aerW * 0.75);
  // ice: frosted grey-blue sheets over dark water (clear black ice shows the dark water), slush, snow
  if (uIce.x > 0.0) {
    // frosted (white-grey, bubbly) and clear (black: the dark water shows through) patches, broad and soft
    float frost = smoothstep(0.3, 0.75, cgVfbm2(P.xz / 9.0 + 4.0, 4) * 0.75 + cgVnoise2(P.xz / 1.9) * 0.25);
    frost = max(frost, smoothstep(0.9, 0.2, depthIce) * 0.8);        // thicker, whiter ice along the banks
    // clear ice is dark (the black water under it shows, the sky mirrors on it); frosted ice is milky blue-grey
    vec3 iceAlb = uIceCol * mix(0.28, 0.85, frost) * (0.92 + 0.16 * fine);   // even clear ice is frosted a little (ref10: blue, never black)
    wFrost = frost;
    // a few broken white cracks in the clear ice (iso-lines of a large noise), only where resolved
    float cn = cgVnoise2(P.xz / 14.0 + 7.0) * 0.7 + cgVnoise2(P.xz / 3.1) * 0.3;
    float crack = (1.0 - smoothstep(0.0, 0.004 + pxw * 0.003, abs(cn - 0.5))) * (1.0 - smoothstep(0.08, 0.4, pxw))
                * smoothstep(0.45, 0.65, cgVnoise2(P.xz / 5.0 + 2.0)) * (1.0 - frost);
    iceAlb = mix(iceAlb, uIceCol * 0.9, crack * 0.6);
    vec3 slushAlb = vec3(0.30, 0.33, 0.36) * (0.8 + 0.4 * fine);
    vec3 snowAlb = vec3(0.86, 0.88, 0.92) * (0.92 + 0.08 * fine);
    alb = mix(alb, slushAlb, slush);
    alpha = mix(alpha, 0.85, slush);
    alb = mix(alb, iceAlb, ice);
    alpha = mix(alpha, mix(0.45, 0.92, frost), ice);
    alb = mix(alb, snowAlb, iceSnow);
    alpha = mix(alpha, 1.0, iceSnow);
    wFoam = max(wFoam, iceSnow);
  }
  diffuseColor.rgb = alb;
  diffuseColor.a = alpha;
  // ---- planar reflection: taps over the sub-pixel slope distribution, haze over the unfolded path, mist veil
  {
    vec3 R = reflect(-V, wN); R.y = max(R.y, 0.004); R = normalize(R);
    vec4 c0 = uReflMatrix * vec4(P, 1.0); vec2 uv0 = c0.xy / c0.w;
    // distance to the reflected object: 5 taps averaged in 1/D (a single nearest tap makes the perturbed lookup jump
    // in blocks wherever D switches between a near object and the sky)
    float iD = 0.0, nObj = 0.0;
    vec2 tx = 3.0 / uReflSize;
    for (int k = 0; k < 5; k++) {
      vec2 o2 = k == 0 ? vec2(0.0) : k == 1 ? vec2(tx.x, 0.0) : k == 2 ? vec2(-tx.x, 0.0) : k == 3 ? vec2(0.0, tx.y) : vec2(0.0, -tx.y);
      float dk = textureLod(tReflDepth, uv0 + o2, 0.0).r;
      if (dk < 0.99999) { vec4 o = uReflInvVP * vec4((uv0 + o2) * 2.0 - 1.0, dk * 2.0 - 1.0, 1.0); iD += 1.0 / max(distance(o.xyz / o.w, P), 1.0); nObj += 1.0; }
    }
    iD *= 0.2;
    float D = iD > 1e-5 ? 1.0 / iD : 1e6;
    // sub-pixel slope spread (LEAN variance + the ice's unevenness) → isotropic normal tilts; at grazing angles a
    // tilt toward / away from the eye moves the reflected ray up / down twice as much as a sideways tilt moves it
    // across, so reflected lights stretch into long vertical streaks by themselves
    float sig = sqrt(max(wVar, 0.0) + uReflTaps.y) * uReflTaps.x;
    float jt = cgHash12(gl_FragCoord.xy + vec2(uFrameW * 7.13, uFrameW * 3.71));
    float ja = cgHash12(gl_FragCoord.yx * 1.37 + vec2(uFrameW * 5.31, 2.9)) * 6.2831853;
    mat2 rot = mat2(cos(ja), sin(ja), -sin(ja), cos(ja));
    vec3 rc = vec3(0.0); float rw = 0.0, sky = 0.0;
    // each tap stands for ~1/6 of the spread: blur it over its share (energy of small bright lights spreads into the
    // streak instead of landing on a few pixels)
    float lod = clamp(log2(max(1.0, sig * 2.0 / (6.0 * max(uReflPix, 1e-5)))), 0.0, 2.5) * uReflLod;
    for (int k = 0; k < 6; k++) {
      // stratified gaussian: radius from the inverse CDF of a ring, angle on a golden spiral, rotated per pixel
      float u = (float(k) + jt) / 6.0;
      float rad = sqrt(-2.0 * log(max(1.0 - u * 0.96, 1e-3)));
      float an = float(k) * 2.39996;
      vec2 o = rot * vec2(cos(an), sin(an)) * rad * sig;
      // extra stretch of the tilts toward / away from the eye (art: long lantern and moon streaks, ref05)
      vec2 vh = normalize(V.xz + vec2(1e-5));
      o += vh * dot(o, vh) * (uReflAniso - 1.0);
      vec3 Nk = normalize(wN + vec3(-o.x, 0.0, -o.y));
      vec3 Rk = reflect(-V, Nk); Rk.y = max(Rk.y, 0.004); Rk = normalize(Rk);
      vec4 ck = D > 3e4 ? uReflMatrix * vec4(Rk, 0.0) : uReflMatrix * vec4(P + Rk * D, 1.0);
      vec2 uvk = ck.xy / ck.w;
      vec2 e = min(uvk, 1.0 - uvk);
      float wk = smoothstep(0.0, 0.04, min(e.x, e.y)) * step(0.0, ck.w);
      vec3 ckol = textureLod(tRefl, uvk, lod).rgb;
      float dk = textureLod(tReflDepth, uvk, 0.0).r;
      float isSky = step(0.99999, dk);
      // reflected SKY is deepened toward the bluer sky the ripples mostly mirror; objects keep their colour
      ckol *= mix(vec3(1.0), wSkyT, isSky);
      rc += ckol * wk; rw += wk; sky += isSky * wk;
    }
    rc /= max(rw, 1e-4);
    sky /= max(rw, 1e-4);
    rc *= mix(1.0, uPondRefl, pond * sky);
    // haze of the object part (the sky part already is the sky)
    if (sky < 0.999) {
      vec3 O = P + R * min(D, 6e4);
      vec3 hz = wAtmoRefl(rc, P + vec3(0.0, 0.05, 0.0), O, dCam);
      rc = mix(hz, rc, sky);
    }
    // the lake mist the reflected ray crosses on its way up (the sheets veil the camera side in the direct view)
    float col = lmColumn(P.xz) * uReflTaps.w;
    if (col > 0.0) {
      float Tm = exp(-col / max(R.y, 0.02));
      vec3 mistL = uLmColor * (uHazeColor * 0.55 + uSunColor * length(uSunIrr) * 0.045 * (0.35 + 1.6 * pow(max(dot(R, uSunDir), 0.0), 6.0)));
      rc = rc * Tm + mistL * (1.0 - Tm);
    }
    wReflW = uReflOn * clamp(rw / 6.0, 0.0, 1.0);
    wRefl = rc;
    if (uDebug > 6.5 && uDebug < 7.5) wRefl = textureLod(tRefl, uv0, 0.0).rgb;
    if (uDebug > 7.5 && uDebug < 8.5) wRefl = vec3(fract(D / 100.0), fract(D / 1000.0), nObj / 5.0);
    if (uDebug > 8.5 && uDebug < 9.5) wRefl = vec3(uv0, 0.0);
  }
  // ---- sun / moon glint: GGX spread by the sub-pixel slope variance (+ art-directed path width); where the ripples
  // are partly resolved the glitter twinkles (sparse bright facets, mean preserved)
  float a2 = pow(0.05, 4.0) + wVar + uGlitter.w * (1.0 - ice);
  wRough = mix(pow(a2, 0.25), 0.75, wFoam);
  wRough = mix(wRough, mix(0.06, 0.32, wFrost), ice * (1.0 - iceSnow));
  {
    float cell = uGlitter.y;
    vec2 gc = P.xz / cell;
    vec2 gi = floor(gc), gf = fract(gc) - 0.5;
    float tt = uTime * uGlitter.z + cgHash12(gi + 17.0) * 7.0;
    float env = sin(3.14159 * fract(tt));
    float gr = cgHash12(gi + floor(tt) * 13.17);
    float dens = 0.18;
    float on = step(1.0 - dens, gr) * smoothstep(0.5, 0.15, length(gf)) * env;
    // twinkle only where the glint cells are a few pixels to a fraction of a pixel (closer, the resolved ripples
    // glint by themselves; farther, the path is a smooth sheen)
    float resolved = smoothstep(0.03, 0.12, pxw / cell) * (1.0 - smoothstep(0.4, 1.0, pxw / cell));
    wSpark = mix(1.0, on / (dens * 0.22), uGlitter.x * resolved * (1.0 - ice));
  }
  // the sun / moon glint itself (GGX with the surface's slope spread), NOT shadowed: low suns sit just above the
  // shore trees in refs 4 and 5 and the glitter path still runs to the shore, so it would be wrong to cut it off
  // with the shore's long shadows; three's own (shadowed) direct specular is replaced by this one (uSunSpec.y = 0)
  {
    vec3 Ls = normalize(uSunDir);
    vec3 H = normalize(Ls + V);
    float NoH = max(dot(wN, H), 0.0), NoL = max(dot(wN, Ls), 0.0), NoV = max(dot(wN, V), 1e-3), VoH = max(dot(V, H), 0.0);
    float ag = max(wRough * wRough, 0.002), ag2 = ag * ag;
    float dd = NoH * NoH * (ag2 - 1.0) + 1.0;
    float Dg = ag2 / (3.14159265 * dd * dd);
    float kk = ag * 0.5;
    float Vis = 0.25 / max((NoL * (1.0 - kk) + kk) * (NoV * (1.0 - kk) + kk), 1e-4);
    float Fh = 0.02 + 0.98 * pow(1.0 - VoH, 5.0);
    float above = smoothstep(-0.01, 0.02, Ls.y);
    wGlintE = uSunIrr * Fh * Dg * Vis * NoL * above * wSpark * uSunSpec.x * (1.0 - wFoam) * (1.0 - 0.8 * ice);
  }
`;

const SURF_ROUGH = /* glsl */`roughnessFactor = wRough;`;
const SURF_NORMAL = /* glsl */`cgBump = wN - cgN;`;
const INJECT_REFL = /* glsl */`
#if defined( RE_IndirectSpecular )
  // the IBL is the sky at SKY.uEnvScale of its visible radiance: a mirror needs the visible sky
  radiance = mix(radiance * mix(uEnvBoost * wSkyT, vec3(1.0), wFoam), wRefl, wReflW * (1.0 - wFoam));
  radiance *= mix(uReflGain, 1.0, wFoam);
  if (uDebug > 13.5 && uDebug < 14.5) radiance = vec3(10.0, 0.0, 0.0);
  if (uDebug > 14.5) { wPre0 = vec4(material.dfg, material.roughness, dot(geometryNormal, geometryViewDir)); }
#endif
`;
const FOG_PREMUL = /* glsl */`
vec4 wPre = gl_FragColor;
#ifdef USE_FOG
{
  vec3 cgA = atmoApply(vec3(0.0), vAtmoWorldPos);
  vec3 cgB = atmoApply(vec3(1.0), vAtmoWorldPos) - cgA;
  float a = gl_FragColor.a;
  gl_FragColor.rgb = gl_FragColor.rgb * cgB + cgA * a + (1.0 - a) * cgA * (1.0 - wTbed);
}
#endif
if (uDebug > 0.5) {
  if (uDebug < 1.5 || (uDebug > 6.5 && uDebug < 10.5)) gl_FragColor = vec4(wRefl, 1.0);
  else if (uDebug < 2.5) gl_FragColor = vec4(vec3(wReflW), 1.0);
  else if (uDebug < 3.5) gl_FragColor = vec4(wN * 0.5 + 0.5, 1.0);
  else if (uDebug < 4.5) gl_FragColor = vec4(vec3(wFoam), 1.0);
  else if (uDebug < 5.5) gl_FragColor = vec4(wTbed, 1.0);
  else if (uDebug < 6.5) gl_FragColor = vec4(vec3(sqrt(wVar) * 10.0), 1.0);
  else if (uDebug > 10.5 && uDebug < 11.5) gl_FragColor = vec4(wPre.rgb, 1.0);
  else if (uDebug > 11.5 && uDebug < 12.5) gl_FragColor = vec4(vec3(wPre.a), 1.0);
  else if (uDebug > 12.5 && uDebug < 13.5) gl_FragColor = vec4(vec3(wRough), 1.0);
  else if (uDebug > 13.5 && uDebug < 14.5) gl_FragColor = vec4(wPre.rgb, 1.0);
  else if (uDebug > 14.5 && uDebug < 15.5) gl_FragColor = vec4(wPre0.rgb, 1.0);
  else if (uDebug > 15.5) gl_FragColor = vec4(wDbgL, 1.0);
}
`;
// after the lights: the glitter modulation of the direct (sun / moon) specular; debug 16..19: direct diffuse /
// direct specular / indirect diffuse / indirect specular
const DBG_LIGHT = /* glsl */`
  reflectedLight.directSpecular *= wSpark * uSunSpec.y;
  if (uDebug > 16.5 && uDebug < 17.5) reflectedLight.directSpecular += wGlintE;
  wDbgL = uDebug < 16.5 ? reflectedLight.directDiffuse : uDebug < 17.5 ? reflectedLight.directSpecular : uDebug < 18.5 ? reflectedLight.indirectDiffuse : reflectedLight.indirectSpecular;
`;

// ------------------------------------------------------------------ absorb pass
const ABSORB_VERT = /* glsl */`
varying vec3 vW;
void main(){ vec4 wp = modelMatrix * vec4(position, 1.0); vW = wp.xyz; gl_Position = projectionMatrix * viewMatrix * wp; }
`;
const ABSORB_FRAG = /* glsl */`
varying vec3 vW;
uniform vec3 uSunDir;
${NOISE_GLSL}
${WATER_COMMON_GLSL}
void main(){
  float depth = max(0.0, uLevel - wTerrainH(vW.xz, 0.0));
  vec3 V = normalize(cameraPosition - vW);
  vec3 T = wBedTransmittance(depth * wTurbidAt(vW.xz), max(V.y, 0.02), max(uSunDir.y, 0.03));
  gl_FragColor = vec4(T, 1.0);
}
`;
export { ABSORB_FRAG };

/** the lake defaults of every surface uniform (missing entries are added to an existing uniforms object) */
export function lakeUniforms() {
  const boats = [], boatsB = [], pond = [];
  for (let i = 0; i < MAX_BOATS; i++) { boats.push(new THREE.Vector4(0, 0, 0, 1)); boatsB.push(new THREE.Vector4(1, 1, 0, 0)); }
  for (let i = 0; i < MAX_POND; i++) pond.push(new THREE.Vector2());
  return {
    uWind: { value: new THREE.Vector4(0.8, 0.6, 1.0, 0.12) },
    uPatch: { value: new THREE.Vector4(160, 420, 14, 0.35) },
    uReflTaps: { value: new THREE.Vector4(1.0, 0.0, 1.0, 1.0) }, uReflAniso: { value: 1.0 },
    uGlitter: { value: new THREE.Vector4(0.6, 0.45, 1.6, 0.0) },
    uSunSpec: { value: new THREE.Vector2(1.0, 0.0) },
    uBoat: { value: boats }, uBoatB: { value: boatsB }, uBoatN: { value: 0 },
    uIce: { value: new THREE.Vector4(0, 1.4, 0.8, 0.6) },
    uIceCol: { value: new THREE.Vector3(0.31, 0.39, 0.52) },
    uPondPts: { value: pond }, uPondN: { value: 0 },
    uPond: { value: new THREE.Vector4(6, 0.35, 0.55, 0.45) }, uPondRefl: { value: 0.4 },
    uMud: { value: new THREE.Vector3(0.105, 0.088, 0.066) }, uMudK: { value: 0 },
    uBoreC: { value: new THREE.Vector4(2.2, 140, 320, 0.6) },
  };
}

/** the lit surface material over a uniforms object (exported for look-dev hot-swaps) */
export function makeSurfaceMaterial(uniforms) {
  for (const [k, v] of Object.entries(lakeUniforms())) if (!uniforms[k]) uniforms[k] = v;
  for (const [k, v] of Object.entries(LAKE_MIST)) if (!uniforms[k]) uniforms[k] = v;
  if (!uniforms.uSunIrr) uniforms.uSunIrr = SKY.uSunIrr;
  const mat = proceduralMaterial({
    name: 'waterSurface',
    type: 'physical',
    params: {
      color: 0xffffff, roughness: 0.08, metalness: 0, ior: 1.333, specularIntensity: 1,
      transparent: true, depthWrite: true,
      blending: THREE.CustomBlending, blendEquation: THREE.AddEquation,
      blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
      blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor,
    },
    uniforms,
    head: NOISE_GLSL + 'uniform vec3 uSunIrr;\n' + SURF_HEAD,
    color: SURF_COLOR,
    roughness: SURF_ROUGH,
    normal: SURF_NORMAL,
    emissive: 'totalEmissiveRadiance += wGlintE;',
  });
  // extra injections: planar reflection into the IBL radiance, glitter on the direct specular, premultiplied atmosphere
  const baseCompile = mat.onBeforeCompile;
  mat.onBeforeCompile = (shader, r) => {
    baseCompile(shader, r);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <lights_fragment_maps>', `#include <lights_fragment_maps>\n${INJECT_REFL}`)
      .replace('#include <aomap_fragment>', `#include <aomap_fragment>\n${DBG_LIGHT}`)
      .replace('#include <fog_fragment>', FOG_PREMUL);
  };
  mat.userData.shaderKey += ':w' + hashString(INJECT_REFL + FOG_PREMUL + DBG_LIGHT).toString(36);
  return mat;
}

/**
 * @returns {{ group, surface, absorb, material, uniforms, setBoats(list), setPond(poly) }}
 */
export function createWaterSurface(engine, { maps, flow, ocean, reflection, size = 90000, level = 0 }) {
  const near = maps.near, far = maps.far;
  const common = {
    tHNear: { value: near.tex }, uHNearB: { value: new THREE.Vector4(...near.bounds) },
    tHFar: { value: far.tex }, uHFarB: { value: new THREE.Vector4(...far.bounds) },
    uLevel: { value: level },
    uAbsorb: { value: new THREE.Vector3(0.55, 0.2, 0.12) },
    uTurbid: { value: 1.0 },
    tFlow: { value: flow.tex }, uFlowB: { value: new THREE.Vector4(...flow.bounds) },
    uBore: { value: new THREE.Vector4(0, 0, 1, 0) }, uBoreB: { value: new THREE.Vector4(0, 0, 0, 0) }, uBoreT: { value: 0 },
  };
  const uniforms = {
    ...common,
    uTime: { value: 0 },
    tWaves: { value: ocean.texture },
    uWaveScale: { value: new THREE.Vector4(37.0, 11.3, 3.7, 1.17) },
    uWaveAmp: { value: new THREE.Vector4(0.05, 0.06, 0.035, 0.004) },
    uWaveAng: { value: new THREE.Vector4(0.0, 1.9, 4.1, 2.7) },
    uEnvBoost: { value: 1 / 0.34 },
    uFrameW: SKY.uFrame,
    uReflGain: { value: 1.0 },
    uReflLod: { value: 1.0 },
    uShoreFoam: { value: 1.0 },
    uSkyRefl: { value: new THREE.Vector3(0.22, 0.36, 0.42) },
    uDebug: { value: Number(engine.params?.get?.('waterDebug') || 0) },
    ...reflection.uniforms,
    uReflPix: { value: 0.001 },
    uScatter: { value: new THREE.Vector3(0.004, 0.042, 0.058) },
    uFoamCol: { value: new THREE.Vector3(0.80, 0.83, 0.84) },
    ...lakeUniforms(),
  };
  const mat = makeSurfaceMaterial(uniforms);

  const geo = new THREE.PlaneGeometry(size, size, 48, 48).rotateX(-Math.PI / 2);
  geo.translate(0, level, 0);
  const surface = new THREE.Mesh(geo, mat);
  surface.name = 'waterSurface';
  surface.renderOrder = -20;
  surface.frustumCulled = false;
  surface.castShadow = false; surface.receiveShadow = true;
  surface.userData.castShadow = false; surface.userData.receiveShadow = true;
  surface.userData.isWater = true;

  const absorbMat = new THREE.ShaderMaterial({
    name: 'waterAbsorb',
    uniforms: { ...common, ...atmoUniforms() },
    vertexShader: ABSORB_VERT,
    fragmentShader: ABSORB_FRAG,
    transparent: true, depthWrite: false, depthTest: true,
    blending: THREE.CustomBlending, blendEquation: THREE.AddEquation,
    blendSrc: THREE.ZeroFactor, blendDst: THREE.SrcColorFactor,
    blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor,
    fog: false,
  });
  const absorb = new THREE.Mesh(geo, absorbMat);
  absorb.name = 'waterAbsorb';
  absorb.renderOrder = -21;
  absorb.frustumCulled = false;
  absorb.castShadow = false; absorb.receiveShadow = false;
  absorb.userData.castShadow = false; absorb.userData.receiveShadow = false;
  absorb.userData.noPatch = true; absorb.userData.isWater = true;

  reflection.hidden.push(surface, absorb);
  surface.onBeforeRender = (renderer, scene, camera) => {
    reflection.update(renderer, scene, camera);
    const fovR = (camera.fov * Math.PI) / 180;
    uniforms.uReflPix.value = (2 * Math.tan(fovR / 2)) / reflection.rt.height;
  };

  const group = new THREE.Group();
  group.name = 'water';
  group.add(absorb, surface);

  /** boats for the wakes: [{ x, z, heading (compass deg), length, beam, speed (m/s), rings (0..1) }] */
  function setBoats(list) {
    let n = 0;
    for (const b of list || []) {
      if (n >= MAX_BOATS) break;
      const a = (b.heading * Math.PI) / 180;
      uniforms.uBoat.value[n].set(b.x, b.z, Math.sin(a), -Math.cos(a));
      uniforms.uBoatB.value[n].set(b.length, b.beam ?? b.length * 0.25, b.speed ?? 0, b.rings ?? 0.5);
      n++;
    }
    uniforms.uBoatN.value = n;
    return n;
  }
  /** the lotus pond outline ([[x, z], ...], up to MAX_POND points; null = none) */
  function setPond(poly) {
    const pts = (poly || []).slice(0, MAX_POND);
    pts.forEach((p, i) => uniforms.uPondPts.value[i].set(p[0], p[1]));
    uniforms.uPondN.value = pts.length >= 3 ? pts.length : 0;
  }
  return { group, surface, absorb, material: mat, absorbMaterial: absorbMat, uniforms, setBoats, setPond };
}
