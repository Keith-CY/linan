// Ink painter: turns the G-buffer (gbuffer.js) and the photographic tone of the same frame into a painting.
//
//   1. edges   (G res)  brush outlines from depth (inverse-depth Laplacian: planes give none), normal creases and
//                       class boundaries; weight by class and distance; the near side of a silhouette owns the line
//   2. JFA     (G res)  nearest line seed for every pixel (additively weighted by the seed's half width)
//   3. ridge   (½ res)  distance below the ridge of the range each pixel belongs to (far hills fade into mist)
//   4. tone    (½, ⅛)   blurred photographic luminance → layered washes
//   5. paint   (output) paper / silk, 染 washes with wet edges and granulation, 皴 strokes, leaf marks by species,
//                       米点, ripple lines, the brush lines (pressure taper, 飞白, wobble, 洇), colour, mineral colour
// Every mark is placed from world positions (lattices in world space, per-tree frames, LOD-blended noise), so it
// sticks to the world in video; the paper's own fibres are fixed to the sheet.
import * as THREE from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { INK_COMMON } from './glsl.js';
import { PIGMENT } from './styles.js';

const VERT = /* glsl */`
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

function rt(w, h, type, filter = THREE.LinearFilter) {
  return new THREE.WebGLRenderTarget(w, h, {
    type, format: THREE.RGBAFormat, colorSpace: THREE.LinearSRGBColorSpace,
    minFilter: filter, magFilter: filter, depthBuffer: false, stencilBuffer: false, generateMipmaps: false,
  });
}

const commonUniforms = () => ({
  uRes: { value: new THREE.Vector2() }, uGRes: { value: new THREE.Vector2() }, uGs: { value: 2 }, uK: { value: 1 },
  uInvProj: { value: new THREE.Matrix4() }, uCamWorld: { value: new THREE.Matrix4() }, uCamPos: { value: new THREE.Vector3() },
  uPxA: { value: 0.001 }, uAxisR: { value: new THREE.Vector3(1, 0, 0) }, uAxisF: { value: new THREE.Vector3(0, 0, -1) },
});

// ------------------------------------------------------------------ 1. edges
const EDGE_FRAG = INK_COMMON + /* glsl */`
uniform sampler2D tA, tB;
uniform vec4 uLine;   // near, far, width, ink-match look
varying vec2 vUv;
vec4 gA(ivec2 p) { return texelFetch(tA, clamp(p, ivec2(0), ivec2(uGRes) - 1), 0); }
// per-class: silhouette weight, crease weight, crease threshold (1 - cos), base half width (px), line type
// type 0 brush, 1 ruler (界画), 2 foliage (soft, broken)
void classLine(int c, out float wSil, out float wCr, out float tCr, out float wid, out float typ) {
  // contours belong to architecture (界画) and a few key forms; trees, hills, grass and water are described by
  // wash, 皴 and dots, so their outlines are faint and broken, and only rock keeps a broken silhouette
  wSil = 1.0; wCr = 0.0; tCr = 0.3; wid = 1.2; typ = 0.0;
  if (isArch(c)) { wSil = 0.8; wCr = 0.6; tCr = 0.22; wid = 0.5; typ = 1.0; }
  if (c == C_ROOF) { wCr = 0.35; tCr = 0.6; }   // hips and ridges only; the tile rows are left to the wash
  if (c == C_CITYFAR) { wSil = 0.45; wCr = 0.08; wid = 0.45; }
  // lighter outlines on everything but the architecture (the targets describe land and trees by wash)
  if (c == C_GROUND) { wSil = 0.12; wCr = 0.0; wid = 1.0; typ = 2.0; }
  if (c == C_ROCK) { wSil = 0.55; wCr = 0.15; tCr = 0.75; wid = 1.2; typ = 3.0; }
  // the carving: a clean, fine drawn line (白描) on the silhouette and every fold; the niche rim like the rock
  if (c == C_FIGURE) { wSil = 0.9; wCr = 0.6; tCr = 0.12; wid = 0.42; typ = 4.0; }
  if (c == C_NICHE) { wSil = 0.8; wCr = 0.3; tCr = 0.5; wid = 1.1; typ = 3.0; }
  if (c == C_BARK) { wSil = 0.8; wCr = 0.1; tCr = 0.6; wid = 1.1; }
  if (isTree(c)) { wSil = 0.06; wid = 0.6; typ = 2.0; }
  if (c == C_BLOSSOM) { wSil = 0.05; }
  if (c == C_SMALL) { wSil = 0.04; wid = 0.45; typ = 2.0; }
  if (c == C_IVY) { wSil = 0.3; wid = 0.45; typ = 2.0; }
  if (c == C_BLOOM) { wSil = 0.75; wCr = 0.5; tCr = 0.2; wid = 0.4; typ = 1.0; }
  if (c == C_PAVE) { wSil = 0.25; wCr = 0.0; wid = 0.6; typ = 1.0; }
  if (c == C_LOTUS) { wSil = 0.16; wid = 0.55; typ = 2.0; }
  // the bore: broken lines (the painted bore of the ink-match look, uLine.w: hardly any, its foam melts into the paper)
  if (c == C_WAVE) { wSil = uLine.w > 0.5 ? 0.22 : 0.55; wCr = 0.0; wid = uLine.w > 0.5 ? 0.5 : 0.8; typ = 2.0; }   // (the painted bore's foam and spray hardly outlined)
}
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  vec4 a = gA(p);
  int c = int(a.w + 0.5);
  float D = a.z;
  if (c == C_SKY || c == C_WATER) { gl_FragColor = vec4(0.0); return; }
  float wSil, wCr, tCr, wid, typ;
  classLine(c, wSil, wCr, tCr, wid, typ);
  bool nOK = dot(a.xy, a.xy) > 1e-8;
  vec3 n = vec3(a.xy, sqrt(max(0.0, 1.0 - dot(a.xy, a.xy))));
  float s = 0.0; vec2 grad = vec2(0.0);
  float fol = isFol(c) ? 1.0 : 0.0;
  // inner detail (creases) gives way to the outline with distance; roof tile rows go first
  float crK = 1.0 - smoothstep(uLine.x * 1.2, uLine.y * (c == C_ROOF ? 0.12 : 0.3), D) * 0.8;
  wCr *= crK;
  // roofs: tile rows only as a suggestion along the eaves (a band just above where the roof ends below)
  float eave = 1.0;
  if (c == C_ROOF) {
    eave = 0.0;
    for (int k = 1; k <= 5; k++) {
      vec4 b = gA(p - ivec2(0, int(float(k) * 4.0 * uGs * uK)));
      if (int(b.w + 0.5) != C_ROOF) { eave = 1.0 - float(k - 1) / 5.0; break; }
    }
    wCr *= mix(0.0, 1.0, eave);
  }
  for (int k = 0; k < 8; k++) {
    ivec2 o = k == 0 ? ivec2(1, 0) : k == 1 ? ivec2(-1, 0) : k == 2 ? ivec2(0, 1) : k == 3 ? ivec2(0, -1) :
              k == 4 ? ivec2(1, 1) : k == 5 ? ivec2(-1, -1) : k == 6 ? ivec2(1, -1) : ivec2(-1, 1);
    vec4 b = gA(p + o), b2 = gA(p - o);
    int cb = int(b.w + 0.5);
    // silhouette: inverse depth is affine across a plane, so its Laplacian only fires at depth breaks
    float lap = (2.0 / D - 1.0 / b.z - 1.0 / b2.z) * D;
    float tS = fol > 0.5 ? (isFol(cb) ? 0.35 : 0.12) : 0.035;
    // tile rolls: only big breaks inside a roof draw (the hips, the eaves over the wall); rows are left to the wash
    if (c == C_ROOF && cb == C_ROOF) tS = mix(0.6, 0.06, eave);
    if (c == C_CITYFAR && cb == C_CITYFAR) tS = 0.2;
    if (c == C_WAVE && cb == C_WAVE) tS = 99.0;   // the bore's broken face draws no inner lines (the curls / the foam are painted)
    float sil = smoothstep(tS, tS * 2.5, lap) * step(D * 1.01, b.z);
    // class boundary (the nearer side draws it); water edges belong to the land
    float cl = 0.0;
    if (cb != c) {
      cl = (b.z >= D * 0.995 || cb == C_WATER) ? 1.0 : 0.0;
      if (isFol(c) && isFol(cb)) cl *= 0.0;
      if (isFol(c) && !isFol(cb)) cl *= 0.6;
      if (cb == C_WATER) cl *= 0.55;
      if ((c == C_GROUND && cb == C_SMALL) || (c == C_SMALL && cb == C_GROUND)) cl *= 0.15;
      if (c == C_GROUND && isTree(cb)) cl *= 0.4;
      if (isArch(c) && isArch(cb)) cl *= 0.8;
      if (cb == C_SKY) cl = (isFol(c) || c == C_GROUND) ? 0.35 : c == C_ROCK ? 0.7 : 1.0;
    }
    // crease
    float cr = 0.0;
    if (nOK && cb == c && abs(b.z - D) < D * 0.03) {
      vec3 nb = vec3(b.xy, sqrt(max(0.0, 1.0 - dot(b.xy, b.xy))));
      cr = smoothstep(tCr, tCr * 1.8, 1.0 - dot(n, nb)) * wCr;
    }
    float e = max(max(sil * wSil, cl * wSil), cr);
    if (k >= 4) e *= 0.85;
    s = max(s, e);
    grad += vec2(o) * e;
  }
  // crevices: the sky light drops into folds and cracks (rock, the carving, bark)
  if (isLand(c) || c == C_BARK) {
    float sk = texelFetch(tB, p, 0).y;
    if (sk > 0.0) {
      float avg = 0.0, nn = 0.0;
      for (int k = 0; k < 8; k++) {
        ivec2 o = (k == 0 ? ivec2(3, 0) : k == 1 ? ivec2(-3, 0) : k == 2 ? ivec2(0, 3) : k == 3 ? ivec2(0, -3) :
                   k == 4 ? ivec2(2, 2) : k == 5 ? ivec2(-2, -2) : k == 6 ? ivec2(2, -2) : ivec2(-2, 2));
        vec4 bb = texelFetch(tB, clamp(p + o, ivec2(0), ivec2(uGRes) - 1), 0);
        vec4 aa = gA(p + o);
        if (bb.y > 0.0 && abs(aa.z - D) < D * 0.05) { avg += bb.y; nn += 1.0; }
      }
      if (nn > 3.0) { avg /= nn; s = max(s, smoothstep(c == C_FIGURE ? 0.25 : 0.45, c == C_FIGURE ? 0.55 : 0.75, (avg - sk) / max(avg, 1e-4)) * (c == C_GROUND || c == C_PAVE ? 0.0 : c == C_FIGURE ? 0.6 : c == C_ROCK ? 0.35 : 0.5)); }
    }
  }
  // distance: full weight at near, none at far (log scale)
  float f = clamp(1.0 - log2(max(D, 1.0) / uLine.x) / log2(uLine.y / uLine.x), 0.0, 1.0);
  float hw = wid * uLine.z * mix(0.45, 1.25, f) * uK;
  s *= smoothstep(0.0, 0.3, f);
  float ang = atan(grad.y, grad.x + 1e-6);
  gl_FragColor = vec4(s, hw, ang, typ);
}
`;

// ------------------------------------------------------------------ 2. jump flooding
const JFA_INIT = INK_COMMON + /* glsl */`
uniform sampler2D tEdge;
void main() {
  vec4 e = texelFetch(tEdge, ivec2(gl_FragCoord.xy), 0);
  gl_FragColor = e.x > 0.12 ? vec4(floor(gl_FragCoord.xy), e.y * uGs, 1.0) : vec4(-1.0, -1.0, 0.0, 0.0);
}
`;
const JFA_STEP = INK_COMMON + /* glsl */`
uniform sampler2D tSrc; uniform float uStep;
void main() {
  vec2 p = floor(gl_FragCoord.xy);
  vec4 best = vec4(-1.0, -1.0, 0.0, 0.0); float bd = 1e9;
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    ivec2 q = ivec2(p + vec2(i, j) * uStep);
    if (q.x < 0 || q.y < 0 || q.x >= int(uGRes.x) || q.y >= int(uGRes.y)) continue;
    vec4 s = texelFetch(tSrc, q, 0);
    if (s.w < 0.5) continue;
    float d = length(s.xy - p) - s.z;
    if (d < bd) { bd = d; best = s; }
  }
  gl_FragColor = best;
}
`;

// ------------------------------------------------------------------ 3. ridge distance
const RIDGE_FRAG = INK_COMMON + /* glsl */`
uniform sampler2D tA;
uniform float uWaterSteps;
varying vec2 vUv;
//   r = px (sheet) below the ridge of the range this pixel belongs to (999: none in reach)
//   g = px (sheet) above the base of the mass (where a nearer form, water or the frame edge cuts it)
//   b = water only: px (sheet) to the nearest shore / object above or below on screen
//   a = px (sheet) above the layer below (water or a much nearer form; 999 at the frame edge / none in reach)
void main() {
  vec2 fc = vUv * uRes;
  ivec2 gp = ivec2(fc * uGs);
  vec4 a = texelFetch(tA, gp, 0);
  int c = int(a.w + 0.5);
  if (c == C_SKY) { gl_FragColor = vec4(999.0); return; }
  float D = a.z;
  float stepPx = 3.0 * uK;
  if (c == C_WATER) {
    float sh = 999.0;
    for (int i = 1; i <= 80; i++) {
      if (float(i) > uWaterSteps) break;   // (the walking painting looks 120 px, a still 240: far lanterns' reflections)
      float dy = float(i) * stepPx;
      if (fc.y + dy < uRes.y) { vec4 b = texelFetch(tA, ivec2(vec2(fc.x, fc.y + dy) * uGs), 0); int cb = int(b.w + 0.5); if (cb != C_WATER && cb != C_SKY) { sh = dy; break; } }
      if (fc.y - dy > 0.0) { vec4 b = texelFetch(tA, ivec2(vec2(fc.x, fc.y - dy) * uGs), 0); int cb = int(b.w + 0.5); if (cb != C_WATER && cb != C_SKY) { sh = dy; break; } }
    }
    gl_FragColor = vec4(999.0, 999.0, sh / uK, 999.0); return;
  }
  float dist = 999.0;
  for (int i = 1; i <= 80; i++) {
    float y = fc.y + float(i) * stepPx;
    if (y >= uRes.y) { dist = 999.0; break; }
    vec4 b = texelFetch(tA, ivec2(vec2(fc.x, y) * uGs), 0);
    int cb = int(b.w + 0.5);
    // (the bore: its own crest, wherever the wave class ends above; its face is too broken for a depth test)
    if (c == C_WAVE ? cb != C_WAVE : (cb == C_SKY || b.z > D * 1.08 + 8.0)) {
      // refine to the pixel so ridge bands do not step
      float lo = float(i - 1) * stepPx, hi = float(i) * stepPx;
      for (int k = 0; k < 3; k++) {
        float mid = 0.5 * (lo + hi);
        vec4 m = texelFetch(tA, ivec2(vec2(fc.x, fc.y + mid) * uGs), 0);
        int cm = int(m.w + 0.5);
        if (c == C_WAVE ? cm != C_WAVE : (cm == C_SKY || m.z > D * 1.08 + 8.0)) hi = mid; else lo = mid;
      }
      dist = hi / uK; break;
    }
  }
  float base = 999.0, layer = 999.0;
  for (int i = 1; i <= 60; i++) {
    float y = fc.y - float(i) * stepPx;
    if (y <= 0.0) { if (base > 998.0) base = float(i) * stepPx / uK; break; }
    vec4 b = texelFetch(tA, ivec2(vec2(fc.x, y) * uGs), 0);
    int cb = int(b.w + 0.5);
    if (base > 998.0 && (cb == C_WATER || b.z < D * 0.9 - 4.0)) base = float(i) * stepPx / uK;
    // the layer below: water, or a form much nearer (a gap between two layers of the view, where mist can lie);
    // the frame's edge is not one (the nearest masses run on out of the picture)
    // (only land, trees or water make a layer: a pagoda or a hall standing in front of a hillside is no gap for mist)
    if (cb == C_WATER || (b.z < D * 0.6 - 6.0 && (isLand(cb) || isFol(cb)))) {
      // refine to the pixel (a mist band measured in whole steps draws as horizontal stripes)
      float lo = float(i - 1) * stepPx, hi = float(i) * stepPx;
      for (int k = 0; k < 3; k++) {
        float mid = 0.5 * (lo + hi);
        vec4 m = texelFetch(tA, ivec2(vec2(fc.x, fc.y - mid) * uGs), 0);
        int cm = int(m.w + 0.5);
        if (cm == C_WATER || (m.z < D * 0.6 - 6.0 && (isLand(cm) || isFol(cm)))) hi = mid; else lo = mid;
      }
      layer = hi / uK; break;
    }
  }
  gl_FragColor = vec4(dist, base, 999.0, layer);
}
`;

// ------------------------------------------------------------------ 3b. light (sun on the form, ½ res, blurred after)
const LIGHT_FRAG = INK_COMMON + /* glsl */`
uniform sampler2D tA, tB; uniform float uSunI;
varying vec2 vUv;
//   r = sun on the surface (0..1.5), g = the painter's light: a conventional light from the upper left, toward the
//   viewer (lit tops and left faces, dark right and under faces), the way 斧劈 planes are laid
void main() {
  vec4 b = texelFetch(tB, ivec2(vUv * uGRes), 0);
  vec4 a = texelFetch(tA, ivec2(vUv * uGRes), 0);
  float s = b.x >= 0.0 ? clamp(b.x / max(uSunI, 1e-4), 0.0, 1.5) : 0.6;
  vec3 n = vec3(a.xy, sqrt(max(0.0, 1.0 - dot(a.xy, a.xy))));
  float pl = dot(a.xy, a.xy) > 1e-8 ? clamp(0.55 + 1.3 * (dot(n, normalize(vec3(-0.55, 0.75, 0.35))) - 0.35), 0.0, 1.0) : 0.6;
  gl_FragColor = vec4(s, pl, 0.0, 1.0);
}
`;

// ------------------------------------------------------------------ 4. tone blur
const DOWN_FRAG = /* glsl */`
uniform sampler2D tSrc; uniform vec2 uTexel; varying vec2 vUv;
void main() {
  vec3 c = texture2D(tSrc, vUv + uTexel * vec2(-0.5, -0.5)).rgb + texture2D(tSrc, vUv + uTexel * vec2(0.5, -0.5)).rgb
         + texture2D(tSrc, vUv + uTexel * vec2(-0.5, 0.5)).rgb + texture2D(tSrc, vUv + uTexel * vec2(0.5, 0.5)).rgb;
  gl_FragColor = vec4(c * 0.25, 1.0);
}`;
const BLUR_FRAG = /* glsl */`
uniform sampler2D tSrc; uniform vec2 uDir; varying vec2 vUv;
void main() {
  vec3 c = texture2D(tSrc, vUv).rgb * 0.2270270270;
  c += (texture2D(tSrc, vUv + uDir * 1.3846153846).rgb + texture2D(tSrc, vUv - uDir * 1.3846153846).rgb) * 0.3162162162;
  c += (texture2D(tSrc, vUv + uDir * 3.2307692308).rgb + texture2D(tSrc, vUv - uDir * 3.2307692308).rgb) * 0.0702702703;
  gl_FragColor = vec4(c, 1.0);
}`;

// ------------------------------------------------------------------ 5. paint
const PAINT_FRAG = INK_COMMON + /* glsl */`
uniform sampler2D tA, tB, tC, tTone, tBlur, tBroad, tEdge, tJfa, tRidge, tLight, tLightB;
// style
uniform vec3 uPaperCol; uniform float uPaper, uAge, uInkGain, uWashGamma, uWashLo, uLayers, uPool, uGran;
uniform float uLine, uWobble, uDry, uCun, uCunKind, uDots, uMoss, uWaves, uColor, uMineral;
// shot
uniform float uNear, uFar, uCunFar, uMi, uRidge, uRidgeFrom, uSkyInk, uWater, uWaveAmt, uWaveMode, uWarm, uNight;
uniform vec2 uTone;
uniform float uPaperLift;
uniform float uDbg;
uniform vec4 uMistBand;   // y0 (fully mist), y1 (clear), from distance, amount
uniform float uSunI;
uniform vec3 uSunW;     // direction to the sun (world)
uniform float uFrame;
// where the painter puts the ink. Two foci (screen uv, radius as a fraction of the height, floor of the falloff)
uniform vec4 uFocus0, uFocus1;
uniform float uGrazeFix, uGrazeW;
uniform vec3 uShotPos;              // the shot's own camera position (mist bands are measured from it: world-fixed)
uniform vec3 uAnchor;               // the lattices' foreshortening anchor: the shot's camera; walking, the look's camera (fixed)
uniform vec4 uBand0, uBand1, uBand2; // mist bands: distance (m), half width (m), amount, ceiling height (m)
uniform float uGroundY;             // height of the ground the bands lie on
// ink-match look: (dark detail drawn from the photograph's fine tone, crown ink gain, roof ink gain, accent colour in
// 纯水墨: blossom / maple / ginkgo and the sky's own colour)
uniform vec4 uLook;
uniform vec4 uLook2;                // (rock ink gain, near-ground ink gain, clouds drawn from the photograph's sky, haze: all
                                    //   ink fades beyond this distance (m), 0 = off)
uniform vec4 uLook3;                // (a base wash on open water by day (the sun's path on it left paper), the ink-match look
                                    //   (1 = on, the walking painting too), mist at the feet: width (sheet px), amount)
uniform vec4 uBoreInk;              // the painted bore's front (x0, z0, x1, z1; 0 = none): churned water behind it
uniform vec4 uBoreInk2;             // (its crest height over the far part of the front, at its near end (m), crest length (m), -)
// the painted bore's crests, exactly as src/modules/tide.js builds them (hash1, inkCurl, inkHeight: keep in sync)
float boreHash(int n) {
  uint x = uint(n) * 2654435761u ^ 0x5bd1e995u;
  x = (x ^ (x >> 15u)) * 2246822519u; x = (x ^ (x >> 13u)) * 3266489917u;
  return float(x ^ (x >> 16u)) / 4294967296.0;
}
/** the curl of the crest at al m along the front: 0 where it spills .. 1 a full curl */
float boreCurl(float al) {
  float P = max(uBoreInk2.z, 1.0), fi = floor(al / P); int i = int(fi);
  float u = al / P - fi, peak = 0.35 + 0.3 * boreHash(i * 7 + 3);
  return pow(max(0.0, 1.0 - abs(u - peak) / (u < peak ? peak : 1.0 - peak)), 1.4) * (0.55 + 0.45 * boreHash(i * 13 + 5));
}
/** the painted bore's own frame at P (src/modules/tide.js INK_BORE): (m along the front from its first end, m ahead of
 *  the crest line (toward the shot's camera; - = behind it, the churned side), the local crest height (m), the curl) */
vec4 boreFrame(vec3 P) {
  vec2 a = uBoreInk.xy, b = uBoreInk.zw; float len = max(length(b - a), 1.0);
  vec2 t2 = (b - a) / len, n2 = vec2(-t2.y, t2.x);
  if (dot(uShotPos.xz - a, n2) < 0.0) n2 = -n2;
  float al = dot(P.xz - a, t2), c = boreCurl(al);
  float H = mix(uBoreInk2.x, uBoreInk2.y, smoothstep(0.3, 1.0, al / len)) * (0.78 + 0.22 * c) * (0.94 + 0.06 * sin(al / 53.0 + 0.7));
  return vec4(al, dot(P.xz - a, n2), H, c);
}
uniform vec4 uLook4;               // (foreground ink floor, its height (fraction of the sheet), -, -)
uniform vec4 uLook6;                // woods veiled upward: (height where the veil starts, where it is full (m), amount,
                                    //   soft cloud bands above the low sun (ink04): amount)
uniform vec4 uLook5;                // (sun glow: a low sun's warm halo in the sky, the forms in front of it veiled, the
                                    //   sun's path on calm water warm and broken (ink04); leaf-mark gain; stone walls as washes
                                    //   with sparse course hints (ink06); a paler ground with light grass strokes (ink02))
uniform vec3 uInkTint;              // multiplies the ink's absorbance (1 = neutral carbon ink; a night painting bluer)
uniform vec4 uSkyTint;              // the sky's colour (absorbance) and amount, deeper toward the zenith, clouds left paper
uniform float uLampMirror;          // night: the lit openings' reflections from the G-buffer (1) or the photograph (0)
uniform vec4 uMoonCol;              // night: (the moon's one broken column on the water, half width at the horizon (rad),
                                    //   widening per radian below it, lantern glints)
// pigments
uniform vec3 pInk, pZhe, pHua, pTeng, pZhu, bShiqing, bShilv, bZhusha;
varying vec2 vUv;

// ---- paper / silk (fixed to the sheet)
float fibres(vec2 q) {
  float f = 0.0;
  for (int L = 0; L < 2; L++) {
    float S = L == 0 ? 26.0 : 11.0;
    vec2 g = q / S; vec2 gi = floor(g);
    for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
      ivec3 cid = ivec3(gi + vec2(i, j), 40 + L);
      vec4 h = h43(cid);
      vec2 c = (gi + vec2(i, j) + h.xy) * S;
      float a = h.z * 6.2831;
      vec2 d = vec2(cos(a), sin(a));
      vec2 v = q - c;
      float t = dot(v, d);
      float len = S * (0.9 + 1.2 * h.w);
      if (abs(t) > len) continue;
      // a gently curved fibre
      float off = dot(v, vec2(-d.y, d.x)) - sin(t / len * 2.4 + h.w * 6.0) * S * 0.08;
      float w = L == 0 ? 0.55 : 0.4;
      float cov = smoothstep(w + 0.6, w - 0.3, abs(off)) * (1.0 - abs(t) / len);
      f += cov * (h.w > 0.5 ? 1.0 : -0.6) * (L == 0 ? 1.0 : 0.6);
    }
  }
  return f;
}
vec3 paperColor(vec2 fc, out float grain) {
  vec2 q = fc / uK;                       // sheet units (1664 across)
  vec2 uv = fc / uRes;
  vec3 col = uPaperCol;
  // ageing: broad stains, darker toward the edges
  float st = vnoise2(q / 260.0) * 0.6 + vnoise2(q / 90.0 + 3.1) * 0.4;
  float edge = smoothstep(0.45, 0.85, length((uv - 0.5) * vec2(1.0, 0.82)));
  float age = uAge * (0.35 * st + 0.65 * edge);
  col *= mix(vec3(1.0), vec3(0.90, 0.82, 0.66), age);
  // a few foxing spots
  float fox = smoothstep(0.78, 0.86, vnoise2(q / 34.0 + 11.0)) * smoothstep(0.55, 0.8, vnoise2(q / 400.0 + 5.0));
  col *= 1.0 - fox * 0.06 * uAge * vec3(0.6, 0.9, 1.4);
  float g = vnoise2(q * 0.55) * 0.4 + vnoise2(q * 0.21 + 7.0) * 0.6;
  if (uPaper < 0.5) {
    float fb = fibres(q);
    col *= 1.0 + 0.01 * fb + (g - 0.5) * 0.02;
    grain = clamp(0.5 + 0.6 * (g - 0.5) + 0.1 * fb, 0.0, 1.0);
  } else {
    // 絹: plain weave, threads ~2.4 sheet px, slubs along the threads
    float warp = 0.5 + 0.5 * cos(6.2831 * q.x / 2.4 + vnoise2(vec2(q.x * 0.4, q.y * 0.01)) * 2.0);
    float weft = 0.5 + 0.5 * cos(6.2831 * q.y / 2.2 + vnoise2(vec2(q.x * 0.01, q.y * 0.4)) * 2.0);
    float over = mod(floor(q.x / 2.4) + floor(q.y / 2.2), 2.0);
    float w = mix(warp, weft, over);
    float slub = vnoise2(vec2(q.x * 0.03, floor(q.y / 2.2))) * 0.5 + vnoise2(vec2(floor(q.x / 2.4), q.y * 0.03)) * 0.5;
    col *= 0.965 + 0.05 * w + 0.03 * (slub - 0.5);
    // silk darkens and cracks a little with age
    col *= 1.0 - 0.05 * uAge * smoothstep(0.6, 0.9, vnoise2(q / 60.0 + 2.0));
    grain = clamp(0.35 + 0.5 * w + 0.3 * (g - 0.5), 0.0, 1.0);
  }
  return col;
}

// ---- 皴: hemp-fibre (披麻) or axe-cut (斧劈) strokes on a world lattice, oriented down the slope
float cunLevel(vec2 q, vec2 dsl, float S, float pxu, float dens, float kind, float lev) {
  float cov = 0.0;
  vec2 g = q / S; vec2 gi = floor(g);
  for (int j = -2; j <= 2; j++) for (int i = -2; i <= 2; i++) {
    ivec3 cid = ivec3(gi + vec2(i, j), int(lev) * 31 + 7);
    vec4 h = h43(cid);
    if (h.x > dens) continue;
    vec2 c = (gi + vec2(i, j) + h.yz) * S;
    float ink = 0.55 + 0.45 * h.w;
    if (kind < 0.5) {
      // 披麻: long, thin, gently bowed, tapering both ends
      vec2 d = rot2(dsl, (h.w - 0.5) * 0.45);
      float L = S * (0.9 + 0.7 * h.y);
      vec2 nrm = vec2(-d.y, d.x);
      vec2 a = c - d * L * 0.5, m = c + nrm * L * 0.07 * (h.z - 0.5) * 2.0, b = c + d * L * 0.5;
      float w = pxu * (0.55 + 0.5 * h.z);
      float cv = max(segCov(q, a, m, w * 0.25, w, pxu * 0.7), segCov(q, m, b, w, w * 0.15, pxu * 0.7));
      cov = max(cov, cv * ink);
    } else {
      // 斧劈: short broad wedges cut diagonally, heavy at the head, dry at the tail
      vec2 d = rot2(dsl, (h.w > 0.5 ? 0.55 : -0.55) + (h.y - 0.5) * 0.4);
      float L = S * (0.55 + 0.45 * h.y);
      vec2 a = c - d * L * 0.5, b = c + d * L * 0.5;
      float w = pxu * (0.9 + 1.1 * h.z);
      float cv = segCov(q, a, b, w, w * 0.1, pxu * 0.7);
      // dry tail: streaks along the stroke
      vec2 v = q - a; float t = clamp(dot(v, d) / L, 0.0, 1.0); float acr = dot(v, vec2(-d.y, d.x)) / max(w, 1e-4);
      float br = vnoise2(vec2(acr * 3.5 + h.x * 40.0, t * 2.0));
      cv *= 1.0 - smoothstep(0.35, 0.95, t) * smoothstep(0.42, 0.6, br);
      cov = max(cov, cv * ink * (1.0 - 0.45 * t));
    }
  }
  return cov;
}
// dry side-brush texture: world-anchored noise stretched along the stroke direction, thresholded by density;
// clusters come and go with a low-frequency mask so the 皴 gathers in groups like brushwork
float streakLevel(vec2 q, vec2 dsl, float S, float dens, float kind, float lev) {
  vec2 d = dsl;
  vec2 dp = vec2(-d.y, d.x);
  float ratio = kind < 0.5 ? 7.0 : 5.5;
  vec2 u = vec2(dot(q, d) / S, dot(q, dp) / (S / ratio));
  float n = vnoise2(u + lev * 17.0) * 0.62 + vnoise2(u * vec2(2.1, 1.7) + 5.3 + lev * 17.0) * 0.38;
  float cl = vnoise2(q / (S * 2.6) + lev * 3.1);
  float t = 1.0 - dens * (0.45 + 0.8 * cl);
  float c = smoothstep(t, t + 0.06, n);
  // the brush runs dry along its length (披麻: broken hairs; 斧劈: a broad side brush, dry only toward the tail)
  if (kind < 0.5) c *= 0.55 + 0.45 * smoothstep(0.3, 0.6, vnoise2(u * vec2(0.6, 4.0) + 9.0 + lev));
  else c *= 0.7 + 0.3 * smoothstep(0.2, 0.7, vnoise2(u * vec2(0.5, 1.5) + 9.0 + lev));
  return c;
}
float cunStrokes(vec3 P, vec3 Nw, float fp, float dens, float kind) {
  vec3 an = abs(Nw);
  vec2 q, dsl;
  if (true) {
    // the vertical plane facing the shot; strokes run down the slope as the painter sees it
    q = vec2(dot(P, uAxisR), P.y);
    vec3 dS = vec3(0.0, -1.0, 0.0) + Nw * Nw.y;
    vec2 d2 = vec2(dot(dS, uAxisR), dS.y);
    dsl = dot(d2, d2) > 1e-4 ? normalize(d2) : vec2(0.0, -1.0);
  }
  else if (an.y > 0.55) { q = P.xz; dsl = normalize(Nw.xz + vec2(1e-4)); }
  else if (an.x > an.z) { q = vec2(P.z, P.y); dsl = vec2(-Nw.y * sign(Nw.x) * 0.0, -1.0); }
  else { q = vec2(P.x, P.y); dsl = vec2(0.0, -1.0); }
  float cellPx = kind < 0.5 ? 30.0 : 70.0;
  float l = log2(fp * cellPx * uK); float l0 = floor(l); float t = smoothstep(0.0, 1.0, l - l0);
  float pxu = fp;     // world metres per output px (per sheet px × uK)
  // the streak texture runs in a fixed direction per plane side: q is in world metres (thousands), so a frame turned by
  // each pixel's own normal would jump across the noise between neighbours (it showed as stipple)
  float side = dot(Nw, uAxisR) >= 0.0 ? 1.0 : -1.0;
  vec2 dst = normalize(vec2((kind < 0.5 ? 0.12 : 0.42) * side, -1.0));
  float a = max(streakLevel(q, dst, exp2(l0), dens, kind, l0), 0.8 * cunLevel(q, dsl, exp2(l0), pxu * uK, dens * 0.35, kind, l0));
  float b = max(streakLevel(q, dst, exp2(l0 + 1.0), dens, kind, l0 + 1.0), 0.8 * cunLevel(q, dsl, exp2(l0 + 1.0), pxu * uK, dens * 0.35, kind, l0 + 1.0));
  return mix(a, b, t);
}

// ---- leaf marks in a per-tree frame (u along the camera's right, v up, metres, centred on the tree)
float pineFans(vec2 p, float S, float pxu, float dens, float seed) {
  float cov = 0.0;
  vec2 g = p / S; vec2 gi = floor(g);
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    vec4 h = h43(ivec3(gi + vec2(i, j), int(seed)));
    if (h.x > dens) continue;
    vec2 c = (gi + vec2(i, j) + 0.15 + 0.7 * h.yz) * S;
    vec2 v = p - c; float r = length(v);
    float L = S * (0.62 + 0.3 * h.w);
    if (r > L) continue;
    // half wheel of needles opening upward (松針), slightly tilted
    float th0 = 1.5708 + (h.w - 0.5) * 0.9;
    float phi = atan(v.y, v.x) - th0;
    phi = mod(phi + 3.14159, 6.28318) - 3.14159;
    float span = 1.25;
    if (abs(phi) > span + 0.1) continue;
    float stepA = span * 2.0 / 8.0;
    float k = clamp(floor((phi + span) / stepA + 0.5), 0.0, 8.0);
    float dA = phi - (k * stepA - span);
    float dist = r * abs(sin(dA));
    float w = pxu * 0.45;
    float cv = smoothstep(w + pxu * 0.6, w - pxu * 0.2, dist) * smoothstep(L, L * 0.75, r) * smoothstep(0.0, L * 0.12, r);
    cov = max(cov, cv * (0.65 + 0.35 * h.w));
    // the dark knot where the needles meet
    cov = max(cov, smoothstep(pxu * 1.6, pxu * 0.8, r) * 0.9);
  }
  return cov;
}
float willowStrands(vec2 p, float S, float pxu, float dens, float seed) {
  float cov = 0.0;
  vec2 g = p / vec2(S * 0.5, S); vec2 gi = floor(g);
  for (int j = 0; j <= 3; j++) for (int i = -1; i <= 1; i++) {
    vec4 h = h43(ivec3(gi + vec2(i, j), int(seed) + 3));
    if (h.x > dens) continue;
    vec2 top = (gi + vec2(i, j) + vec2(h.y, 0.5 + 0.5 * h.z)) * vec2(S * 0.5, S);
    float L = S * (3.5 + 3.0 * h.w);
    float t = (top.y - p.y) / L;
    if (t < 0.0 || t > 1.0) continue;
    float x = top.x + sin(t * 2.2 + h.w * 6.0) * S * 0.12 + t * t * S * 0.25 * (h.z - 0.5);
    float w = pxu * 0.38 * (1.0 - 0.7 * t);
    float cv = smoothstep(w + pxu * 0.6, w - pxu * 0.2, abs(p.x - x));
    // the strand fades out toward its tip and breaks where the brush lifts
    cv *= smoothstep(0.3, 0.5, vnoise2(vec2(h.y * 50.0, t * 5.0)));
    cov = max(cov, cv * (0.55 + 0.45 * h.w) * (1.0 - 0.75 * t));
  }
  return cov;
}
/** 点叶 dots (ring = 1 draws 夹叶 outlines instead) */
float leafDots(vec2 p, float S, float pxu, float dens, float seed, float ring, float elong) {
  float cov = 0.0;
  // leaves gather in clumps with paper between them
  dens *= smoothstep(0.25, 0.6, vnoise2(p / (S * 3.2) + seed * 0.37));
  vec2 g = p / S; vec2 gi = floor(g);
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    for (int k = 0; k < 2; k++) {
      vec4 h = h43(ivec3(gi + vec2(i, j), int(seed) * 2 + k + 11));
      if (h.x > dens) continue;
      vec2 c = (gi + vec2(i, j) + h.yz) * S;
      float r = S * (0.22 + 0.16 * h.w);
      float a = (h.w - 0.5) * 1.6 + (k == 0 ? 0.3 : -0.5);
      vec2 v = rot2(p - c, a); v.x /= elong;
      float d = length(v) / r;
      float aa = pxu / r;
      float cv;
      if (ring > 0.5) cv = smoothstep(0.16 + aa, 0.16 - aa, abs(d - 0.85)) * 0.9;
      else cv = smoothstep(1.0 + aa, 1.0 - aa, d) * (0.72 + 0.28 * smoothstep(0.5, 1.0, d)); // wet rim
      cov = max(cov, cv * (0.55 + 0.45 * h.x / max(dens, 1e-3)));
    }
  }
  return cov;
}
/** maple / ginkgo: solid five-lobed marks (双勾 rings read as bubbles at this size), clumped, two per cell */
float lobedLeaves(vec2 p, float S, float pxu, float dens, float seed, float lobes) {
  float cov = 0.0;
  dens *= smoothstep(0.2, 0.55, vnoise2(p / (S * 3.0) + seed * 0.41));
  vec2 g = p / S; vec2 gi = floor(g);
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    for (int k = 0; k < 2; k++) {
      vec4 h = h43(ivec3(gi + vec2(i, j), int(seed) * 2 + k + 61));
      if (h.x > dens) continue;
      vec2 c = (gi + vec2(i, j) + h.yz) * S;
      float r = S * (0.26 + 0.16 * h.w);
      vec2 v = rot2(p - c, h.w * 6.28);
      float a = atan(v.y, v.x);
      float rr = r * (0.55 + 0.45 * pow(abs(cos(a * lobes * 0.5)), 0.7));
      float aa = pxu * 0.8;
      cov = max(cov, smoothstep(rr + aa, rr - aa, length(v)) * (0.6 + 0.4 * h.x / max(dens, 1e-3)));
    }
  }
  return cov;
}
/** 米点: soft horizontal blobs (far woods) */
float miDots(vec2 p, float S, float dens, float seed) {
  float cov = 0.0;
  vec2 g = p / vec2(S * 1.3, S * 0.7); vec2 gi = floor(g);
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    vec4 h = h43(ivec3(gi + vec2(i, j), int(seed) + 23));
    if (h.x > dens) continue;
    vec2 c = (gi + vec2(i, j) + h.yz) * vec2(S * 1.3, S * 0.7);
    vec2 v = (p - c) / (S * vec2(0.62, 0.3) * (0.8 + 0.4 * h.w));
    float d = length(v);
    cov += smoothstep(1.0, 0.45, d) * (0.35 + 0.4 * h.w);
  }
  return min(cov, 1.0);
}

// ---- ripple lines on the water plane (world XZ, rows spread so they keep a screen spacing)
// sinW: the world-anchored foreshortening (src: anchorSin) that sets the lattice; the eye's own would slide the rows
float ripples(vec3 P, float fp, float dens, float mode, vec3 R, vec3 F, float sinG, float sinW) {
  vec2 xz = P.xz;
  vec2 r2 = normalize(R.xz), f2 = normalize(F.xz);
  float cellPx = mode > 0.5 ? 22.0 : 46.0;
  float l = log2(fp * cellPx * uK); float l0 = floor(l); float t = smoothstep(0.0, 1.0, l - l0);
  float cov = 0.0;
  for (int L = 0; L < 2; L++) {
    float lev = l0 + float(L);
    float S = exp2(lev);
    float Sv = S / max(sinW, 0.02) * (mode > 0.5 ? 0.45 : 0.35);
    vec2 q = vec2(dot(xz, r2), dot(xz, f2));
    vec2 g = q / vec2(S, Sv); vec2 gi = floor(g);
    float c0 = 0.0;
    float pxu = fp * uK;
    for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
      vec4 h = h43(ivec3(gi + vec2(i, j), int(lev) * 5 + 3));
      if (mode < 0.5 && h.x > dens) continue;
      vec2 c = (gi + vec2(i, j) + vec2(mode > 0.5 ? 0.5 * mod(gi.y + float(j), 2.0) : h.y, 0.5)) * vec2(S, Sv);
      vec2 v = q - c;
      float cv;
      if (mode > 0.5) {
        // 水纹: rows of shallow arcs (fish-scale)
        float u = v.x / (S * 0.5);
        if (abs(u) > 1.0) continue;
        float arc = -(1.0 - u * u) * Sv * 0.35;
        float w = pxu * 0.5 * (0.6 + 0.8 * h.z) * (1.0 - u * u * 0.7);
        cv = smoothstep(w + pxu * 0.5, w - pxu * 0.3, abs(v.y - arc) * sinG / max(sinG, 0.02) );
        cv *= step(h.x, dens * 1.4);
      } else {
        float L2 = S * (0.35 + 0.4 * h.z);
        float u = v.x / L2;
        if (abs(u) > 1.0) continue;
        float bow = (1.0 - u * u) * Sv * 0.12 * (h.w - 0.5);
        float w = pxu * 0.5 * (1.0 - u * u);
        cv = smoothstep(w + pxu * 0.5, w - pxu * 0.3, abs(v.y - bow) * sinG / max(sinG, 0.02));
      }
      c0 = max(c0, cv * (0.5 + 0.5 * h.w));
    }
    cov += c0 * (L == 0 ? 1.0 - t : t);
  }
  return cov;
}

// ---- 水纹: rows of drawn wave lines over the whole water (马远《水图》, the net of 千里江山), rows kept ~rowPx apart
float waveRows(vec3 P, float fp, float sinG, float sinW, vec3 R, vec3 F, float dens, float amp, float rowPx) {
  vec2 r2 = normalize(R.xz), f2 = normalize(F.xz);
  vec2 q = vec2(dot(P.xz, r2), dot(P.xz, f2));
  float pxPerV = sinG / max(fp, 1e-5);              // screen px per metre along the view on the water
  float l = log2(rowPx * uK / pxPerV); float l0 = floor(l); float t = smoothstep(0.0, 1.0, l - l0);
  float cov = 0.0;
  for (int L = 0; L < 2; L++) {
    float lev = l0 + float(L);
    float Sv = exp2(lev);
    float Su = Sv * 4.5 * max(sinW, 0.03);            // horizontal wavelength ≈ 4.5 row spacings on screen (anchored)
    float ph = vnoise2(vec2(q.x / (Su * 5.0), q.y / (Sv * 4.0)) + lev) * 2.0;
    float g = q.y / Sv + amp * abs(sin(3.14159 * (q.x / Su + ph)));
    float k = floor(g + 0.5);
    float dpx = abs(g - k) * Sv * pxPerV;
    float w = 0.45 * uK;
    float c = smoothstep(w + 0.6 * uK, w - 0.3 * uK, dpx);
    // rows break into strokes
    c *= smoothstep(1.0 - dens, 1.0 - dens + 0.15, vnoise2(vec2(q.x / (Su * 1.7), k * 1.37 + lev * 3.0)));
    cov += c * (L == 0 ? 1.0 - t : t);
  }
  return cov;
}


// ---- 斧劈 / 卷云 facets: a Voronoi partition of the face plane (cells taller than wide, sheared down the slope), so
// the rock reads as crisp planes of layered tone; x = cell value, y = metres to the cell border
vec2 facetCell(vec2 q, float S, float shear, float seed) {
  q.x += shear * q.y;
  vec2 g = q / vec2(S, S * 1.6); vec2 gi = floor(g), gf = g - gi;
  float d1 = 9.0, d2 = 9.0; vec2 id = gi;
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    vec2 o = vec2(i, j);
    vec4 h = h43(ivec3(gi + o, int(seed)));
    vec2 v = (o + 0.1 + 0.8 * h.xy - gf) * vec2(1.0, 1.6);
    float d = length(v);
    if (d < d1) { d2 = d1; d1 = d; id = gi + o; } else if (d < d2) d2 = d;
  }
  return vec2(h13(ivec3(id, int(seed) + 5)), (d2 - d1) * 0.5 * S);
}
/** two facet scales (big planes ~bigPx, small ~bigPx/3 on screen), LOD-blended so they stay put in video;
 *  x = summed plane value (-0.5..0.5), y = border line coverage */
vec2 facets(vec3 P, vec3 Nw, float fp, float bigPx) {
  vec2 q = vec2(dot(P, uAxisR), P.y);
  float side = dot(Nw, uAxisR) >= 0.0 ? 1.0 : -1.0;
  float l = log2(fp * bigPx * uK); float l0 = floor(l); float t = smoothstep(0.0, 1.0, l - l0);
  vec2 r = vec2(0.0);
  for (int L = 0; L < 2; L++) {
    float S = exp2(l0 + float(L));
    vec2 a = facetCell(q, S, 0.35 * side, 401.0 + (l0 + float(L)) * 3.0);
    vec2 b = facetCell(q + 7.3, S * 0.36, -0.25 * side, 433.0 + (l0 + float(L)) * 3.0);
    float px = fp * uK;
    // only some plane edges are drawn (a cut, a fold): the rest are left to the change of tone
    float line = smoothstep(px * 1.3, px * 0.4, a.y) * step(0.62, a.x) * smoothstep(0.35, 0.6, vnoise2(q / (S * 0.7) + 3.0));
    vec2 v = vec2((a.x - 0.5) * 0.65 + (b.x - 0.5) * 0.35, line);
    r += v * (L == 0 ? 1.0 - t : t);
  }
  return r;
}

// ---- the vertical fissures of a limestone face (ink08): long wandering cracks down the face plane, a column of
// rock between two of them; world-anchored on the face, two LOD levels of ~50 px columns. x = the crack's ink, y = the
// shade of the step beside it (one side of each crack, as the 斧劈 plane steps back)
vec2 fissures(vec3 P, float fp) {
  vec2 q = vec2(dot(P, uAxisR), P.y);
  float px = max(fp * uK, 1e-4);
  float l = log2(px * 38.0); float l0 = floor(l); float t = smoothstep(0.0, 1.0, l - l0);
  vec2 r = vec2(0.0);
  for (int L = 0; L < 2; L++) {
    float lev = l0 + float(L);
    float S = exp2(lev);
    float ci = floor(q.x / S);
    float on = 0.0, side = 0.0;
    for (int i = -1; i <= 1; i++) {
      float c = ci + float(i);
      vec4 h = h43(ivec3(int(c), int(lev) + 64, 913));
      float x = (c + 0.2 + 0.6 * h.x) * S + S * 0.3 * (vnoise2(vec2(c * 7.1, q.y / (S * 1.7))) - 0.5) + S * 0.07 * (vnoise2(vec2(c * 3.3, q.y / (S * 0.35))) - 0.5);
      float seg = smoothstep(0.3, 0.5, vnoise2(vec2(c * 5.7 + 2.0, q.y / (S * 3.0) + h.y * 9.0)));
      float d = (q.x - x) / px;
      seg *= step(0.3, h.z);                       // some columns run unbroken (no crack)
      float w = (0.25 + 0.9 * h.y * h.y) * seg;
      on = max(on, smoothstep(w + 0.8, w - 0.3, abs(d)) * seg * (0.55 + 0.45 * h.z));
      side = max(side, step(0.0, d) * exp(-d / (5.0 + 16.0 * h.w)) * seg);
    }
    r += vec2(on, side) * (L == 0 ? 1.0 - t : t);
  }
  return r;
}

// ---- painted far ranges (远山) in the sky: ranges stepping back behind the real horizon, each a wash dark at the
// ridge and fading into mist below. Directions only (as far as the sky), so they stay put as the camera moves.
//   uRanges = (base elevation (rad), step between ranges (rad), ridge amplitude (rad), count)
uniform vec4 uRanges;
uniform vec2 uPatch;     // (size of the low mist patches between blocks (m), amount): 0 = off
uniform vec4 uRangesB;   // (azimuth centre (rad), azimuth half width (rad, 0 = all round), ink, mist fade (rad))
float ridgeLine(vec2 d2, float k) {
  // fbm on the unit circle of azimuth (no seam): rounded summits, and long stretches where the range sinks into mist
  vec2 c = d2 * (16.0 + 5.0 * k);
  float n = vnoise2(c + k * 11.3) * 0.55 + vnoise2(c * 2.3 + 3.1 + k * 5.0) * 0.3 + vnoise2(c * 5.3 + 9.7 + k) * 0.15;
  float big = vnoise2(d2 * (4.0 + k) + 40.0 + k * 3.7);
  return n * 1.25 - 0.35 + (big - 0.5) * 1.1;
}
/** → (wash, ridge proximity (0..1, 1 at the ridge), index of the range (0 = farthest) + 1, 0 if none) */
vec3 paintedRanges(vec3 dirW) {
  if (uRanges.w < 0.5) return vec3(0.0);
  float el = asin(clamp(dirW.y, -1.0, 1.0));
  vec2 d2 = normalize(dirW.xz + 1e-6);
  float az = atan(d2.x, d2.y);
  float win = 1.0;
  if (uRangesB.y > 0.0) { float da = abs(mod(az - uRangesB.x + 3.14159, 6.28318) - 3.14159); win = uLook3.y > 0.0 ? 1.0 - smoothstep(uRangesB.y * 0.3, uRangesB.y * 1.4, da) : 1.0 - smoothstep(uRangesB.y * 0.6, uRangesB.y, da); }
  vec3 res = vec3(0.0);
  int n = int(uRanges.w);
  for (int k = 0; k < 6; k++) {
    if (k >= n) break;
    float fk = float(k);
    // farthest first: higher base, smaller, paler; nearer ranges lower and darker
    float kk = float(n - 1) - fk;                               // 0 = nearest
    float base = uRanges.x + kk * uRanges.y;
    float amp = uRanges.z * (0.55 + 0.45 * kk / max(float(n - 1), 1.0)) * win;
    float ridge = base + amp * ridgeLine(d2, fk) - (1.0 - win) * (uLook3.y > 0.0 ? 0.16 : 0.05);   // (match: out of its window a range sinks away)
    if (el < ridge) {
      float below = ridge - el;
      // (match: the fade length changes slowly along the range; a fast change drew the foot of a range as vertical streaks)
      float fade = uRangesB.w * (uLook3.y > 0.0 ? 0.85 + 0.3 * vnoise2(d2 * 4.0 + fk) : 0.7 + 0.5 * vnoise2(d2 * 14.0 + fk));
      float ink = uRangesB.z * mix(0.28, 1.0, fk / max(float(n - 1), 1.0));
      // the ridge: dark at the top, the body a pale wash with vertical 披麻 texture, the foot lost in mist
      // woods along the ridge as soft horizontal 米点 clumps, the slopes a wash that pales downward
      vec2 tq = uLook3.y > 0.0 ? vec2(az * 60.0, el * 90.0) : vec2(az * 320.0, el * 700.0);
      float tex = smoothstep(0.35, 0.75, vnoise2(tq + fk * 7.0) * 0.6 + vnoise2(tq * vec2(2.3, 1.9) + 3.0) * 0.4);
      if (uLook3.y > 0.0) tex = 0.5 + 0.5 * (tex - 0.5);
      // ink-match (uLook.x > 0): a softer ridge and a fuller body (the targets' far hills are masses in mist, not strips)
      float crisp = uLook3.y > 0.0 ? 0.08 : 0.3;
      float w = ink * (crisp * exp(-below / (fade * 0.12)) + (1.0 - crisp) * exp(-below / fade) * (0.6 + 0.6 * tex * exp(-below / (fade * 0.6))));
      if (uLook3.y > 0.0 && uPaperLift > 0.5) {
        // a snowy range (ink10): left as paper, drawn by its ridge line, a few crevices running down from it
        // and a pale grey on the shaded side of each spur; the farther range a pale grey wash lost in mist
        vec2 qp = vec2(az, el) / (uPxA * uK);
        float line = smoothstep(1.8, 0.4, below / (uPxA * uK)) * (0.55 + 0.45 * smoothstep(0.3, 0.6, vnoise2(qp / 30.0 + fk)));
        float g = smoothstep(0.4, 0.6, vnoise2(qp / 70.0 + fk * 5.0));
        float c1 = smoothstep(0.74, 0.86, vnoise2(vec2((qp.x + 0.7 * qp.y) / 3.0, qp.y / 45.0) + fk * 13.0));
        float c2 = smoothstep(0.74, 0.86, vnoise2(vec2((qp.x - 0.7 * qp.y) / 3.0, qp.y / 45.0) + fk * 17.0));
        float crev = mix(c1, c2, g) * smoothstep(0.3, 0.6, vnoise2(qp / 35.0 + 3.0 + fk));
        // the shaded side of each spur: a pale grey plane, darker toward the ridge (斧劈 in snow)
        float sp0 = vnoise2(vec2((qp.x + 0.8 * qp.y) / 38.0, qp.y / 200.0) + fk * 7.0);
        float spur = smoothstep(0.5, 0.62, sp0) * (0.6 + 0.4 * vnoise2(qp / 12.0));
        float dn = exp(-below / (fade * 0.9));
        float mot = vnoise2(d2 * 9.0 + fk * 4.1);
        w = kk < 0.5 ? ink * (0.9 * line + 0.6 * crev * exp(-below / (fade * 0.45)) + 0.28 * spur * dn) : ink * 0.22 * exp(-below / fade) * (0.4 + 0.9 * mot) * smoothstep(0.0, uPxA * 3.0 * uK, below);
      } else if (uLook3.y > 0.0) {
        // a range is not one even strip: long stretches of it darker or lost in mist, and a soft top edge
        float mot = vnoise2(d2 * (7.0 + 2.0 * fk) + fk * 4.1) * 0.65 + vnoise2(d2 * 23.0 + fk * 1.7) * 0.35;
        w *= (0.35 + 0.95 * smoothstep(0.25, 0.75, mot)) * smoothstep(0.0, uPxA * 2.5 * uK, below);
      }
      res = vec3(w, exp(-below / fade), fk + 1.0 - 0.5 * kk / max(float(n - 1), 1.0) * 0.0);
    }
  }
  return res;
}

float focusOf(vec4 F, vec2 uv) {
  if (F.z <= 0.0) return 0.0;
  vec2 d = (uv - F.xy) * vec2(uRes.x / uRes.y, 1.0);
  return exp(-dot(d, d) / (F.z * F.z));
}
float bandOf(vec4 Bd, vec3 P, float n) {
  if (Bd.z <= 0.0) return 0.0;
  float dS = length(P.xz - uShotPos.xz);
  float along = 1.0 - smoothstep(Bd.y * 0.35, Bd.y, abs(dS - Bd.x) + (n - 0.5) * Bd.y * 0.7);
  float low = 1.0 - smoothstep(Bd.w * 0.45, Bd.w, P.y - uGroundY + (n - 0.5) * Bd.w * 0.8);
  return along * low * Bd.z;
}

uniform sampler2D tPaper; uniform float uPaperTex;
uniform sampler2D tSmoke; uniform float uSmokeOn;   // smoke plumes (InkPainter.renderSmoke): r = density, g = density × depth
uniform vec2 uWaterRefl;   // ink08: the shore's reflection on day water: (gain, fade from the shore (sheet px), 0 = none)
/** albedo × (sun + sky) of a G-buffer texel (-1: no surface) */
/** albedo of a G-buffer texel, unlit (-1: no surface): slab joints without the cast shadows */
float gAlb(ivec2 p) {
  p = clamp(p, ivec2(0), ivec2(uGRes) - 1);
  vec4 b = texelFetch(tB, p, 0);
  return b.z < 0.0 ? -1.0 : b.z;
}
float gShade(ivec2 p) {
  p = clamp(p, ivec2(0), ivec2(uGRes) - 1);
  vec4 b = texelFetch(tB, p, 0);
  if (b.z < 0.0) return -1.0;
  return b.z * (0.6 * max(b.x, 0.0) + max(b.y, 0.0));
}
void main() {
  vec2 fc = gl_FragCoord.xy;
#ifdef PAPER_ONLY
  // the sheet alone (fixed to the screen): cached in a texture by InkPainter, refreshed on resize / style change
  { float g0; vec3 c0 = paperColor(fc, g0); gl_FragColor = vec4(c0, g0); return; }
#endif
  vec2 uv = fc / uRes;
  ivec2 gp = ivec2(fc * uGs);
  vec4 A = texelFetch(tA, gp, 0), B = texelFetch(tB, gp, 0), Cc = texelFetch(tC, gp, 0);
  int cls = int(A.w + 0.5);
  float D = A.z;
  vec3 P = worldPosOf(uv, D);
  vec3 dirW = worldDirOf(uv);
  bool hasN = dot(A.xy, A.xy) > 1e-8;
  vec3 Nv = vec3(A.xy, sqrt(max(0.0, 1.0 - dot(A.xy, A.xy))));
  vec3 Nw = normalize(mat3(uCamWorld) * Nv);
  float fp = D * uPxA;                 // metres per output px
  vec3 camR = uAxisR, camU = vec3(0.0, 1.0, 0.0), camF = uAxisF;
  vec4 RG = texture2D(tRidge, uv);
  float rdist = RG.r;
  // the far washes grade from a smoothed ridge (trees along a ridge make the distance jump from column to
  // column, which drew the graded wash as vertical streaks): the mean over a few px to either side
  if (uLook3.y > 0.0 && rdist < 998.0) {
    float sum = min(rdist, 400.0), nn = 1.0;
    for (int i = -3; i <= 3; i++) {
      if (i == 0) continue;
      float r2 = texture2D(tRidge, uv + vec2(float(i) * 4.0 * uK / uRes.x, 0.0)).r;
      if (r2 < 998.0) { sum += min(r2, 400.0); nn += 1.0; }
    }
    rdist = sum / nn;
  }
  // ink density: full at the foci and at the base of each mass, thinning toward blank paper elsewhere
  float fA = focusOf(uFocus0, uv), fB = focusOf(uFocus1, uv);
  float fK = max(fA, fB);
  float flo = uFocus0.z > 0.0 ? uFocus0.w : 1.0;
  float baseK = 1.0 - smoothstep(10.0, 150.0, RG.g);
  float idk = clamp(mix(flo, 1.0, fK) * (0.8 + 0.35 * baseK), 0.0, 1.1);
  // the foreground (the bottom of the sheet) keeps its full ink: the targets frame their focus with dark near
  // masses and let the ink thin out toward the far edges and the sky
  idk = max(idk, uLook4.x * (1.0 - smoothstep(uLook4.y * 0.4, uLook4.y, uv.y)));

  float grain;
  vec3 paper;
  if (uPaperTex > 0.5) { vec4 pp = texelFetch(tPaper, ivec2(fc), 0); paper = pp.rgb; grain = pp.a; }
  else paper = paperColor(fc, grain);
  // snow scenes: a paler ground (the silk of a snow scene is chosen light; on paper it only cools a touch)
  paper = mix(paper, vec3(0.955, 0.95, 0.93) * (0.97 + 0.03 * grain), uPaperLift * (uPaper > 0.5 ? 0.75 : 0.3));

  // ---------------- tone → wash
  float tF = lum(texture2D(tBlur, uv).rgb), tB = lum(texture2D(tBroad, uv).rgb), tS = lum(texture2D(tTone, uv).rgb);
  float tF0 = tF;   // the ½-res tone before any blending (dark detail = what the full-res tone has darker than it)
  // the light on the form, blurred (≈6 px) so shadow edges read as wash edges, not cel shading
  vec2 LL = texture2D(tLight, uv).rg;
  float sunF = LL.x;
  // rock and hills: the painter's light leads, the sun adds to it (a cliff wholly in shade still has planes); the
  // broad (⅛-res) light gives the big 斧劈 planes, the fine one a little modelling inside them
  float plB = texture2D(tLightB, uv).g;
  float plit = isLand(cls) ? mix(mix(plB, LL.y, 0.3), smoothstep(0.05, 0.65, sunF), 0.3) : smoothstep(0.05, 0.65, sunF);
  // ink02: a pale ground: the ground, the grass and the paving take the painter's light only, not the trees'
  // dappled cast shadows (the photograph's), which the washes and the detail turned into dark blotches
  bool gLift = uLook5.w > 0.0 && (cls == C_GROUND || cls == C_SMALL || cls == C_PAVE) && uNight < 0.5;
  if (gLift) plit = mix(plit, mix(plB, LL.y, 0.4), uLook5.w);
  float shade = 1.0 - plit;
  // big simple value shapes: only architecture keeps the fine tone; land, trees and water take the broad one
  // far land: the fine tone from the full-resolution frame (the ½-res blur steps along the far silhouettes)
  // (far land no longer takes the full-resolution tone: its fine texture drew the far woods as stipple; the far
  // masses are graded washes from the geometry below)
  float farS = smoothstep(uRidgeFrom * 0.5, uRidgeFrom, D) * ((isLand(cls) || isFol(cls) || cls == C_CITYFAR) ? 1.0 : 0.0);
  tF = mix(tF, tB, farS * 0.5);
  float tone = cls == C_ROOF ? mix(tF, tB, 0.7) : isArch(cls) ? mix(tF, tB, 0.3) : (isTree(cls) || cls == C_WATER || cls == C_SMALL) ? mix(tB, tF, 0.2) : cls == C_LOTUS ? mix(tB, tF, 0.6) : mix(tB, tF, 0.35);
  tone = pow(clamp(tone * uTone.x, 0.0, 1.0), uTone.y);
  // rock and ground: the value follows the light on the form, not the material's blotches
  if (isLand(cls) && B.x >= 0.0 && uNight < 0.5) {
    // clean planes: the value steps with the light on the form (the layered wash below gives the plane edges)
    float litT = (cls == C_ROCK ? 0.0 : 0.15) + 0.82 * smoothstep(0.3, 0.85, plit);
    if (cls == C_FIGURE) litT = 0.62 + 0.36 * smoothstep(0.1, 0.9, plit);   // the carving: lighter, smoother stone
    tone = mix(tone, mix(pow(clamp(tB * uTone.x, 0.0, 1.0), uTone.y), litT, gLift ? mix(0.8, 1.0, uLook5.w) : 0.8), 1.0 - smoothstep(uRidgeFrom * 0.4, uRidgeFrom, D));
  }
  float dark = 1.0 - tone;
  float w0 = pow(clamp((dark - uWashLo) / (1.0 - uWashLo), 0.0, 1.0), uWashGamma);
  // a crown is one soft mass: a light wash over it, deeper on the shaded underside (not blank paper in a grey rim)
  float clumpB = 0.0, clumpBody = 1.0, crownW = -1.0;
  if (isTree(cls) && Cc.w > 0.5 && uNight < 0.5) {
    float under = smoothstep(0.0, 1.0, (Cc.y + uCamPos.y + 9.0 - P.y) / 9.0);   // lower part of the tree
    w0 = max(w0, (0.22 + 0.38 * max(shade, under * 0.75)) * (cls == C_WILLOW ? 0.5 : 1.0) * uLook.y);
    // a crown as the targets paint it: clumps of foliage (a slow noise in the tree's own frame, flat pads
    // for pines, hanging masses for willows), each deeper on its underside and paler on top, paper showing between
    // them, the whole tree its own depth of ink (墨分五色), deeper in shade and toward its foot
    // peach blossom (ink02) a breath of wash under dots of pale pink (the dots below, tinted)
    if (uLook3.y > 0.0 && cls == C_BLOSSOM) { crownW = 0.05 + 0.08 * shade; w0 = crownW; }
    if (uLook3.y > 0.0 && cls != C_BLOSSOM) {
      vec3 O = Cc.xyz + uCamPos;
      float fpo = length(Cc.xyz) * uPxA * uK;
      float hs = h13(ivec3(floor(O * 1.7)) + 91);
      vec2 lp = vec2(dot(P - O, uAxisR), P.y - O.y);
      float S = max(cls == C_WILLOW ? 1.6 : 2.6, fpo * 16.0);
      vec2 sq = cls == C_PINE ? vec2(0.8, 2.0) : cls == C_WILLOW ? vec2(1.7, 0.55) : vec2(1.0, 1.3);
      vec2 g = lp * sq / S + hs * 37.0;
      vec2 gU = g + vec2(0.0, 0.3);
      float n0 = vnoise2(g) * 0.7 + vnoise2(g * 2.3 + 5.0) * 0.3;
      float nU = vnoise2(gU) * 0.7 + vnoise2(gU * 2.3 + 5.0) * 0.3;
      clumpBody = smoothstep(0.28, 0.52, n0);
      clumpB = clamp((nU - n0) * 6.0, 0.0, 1.0) * clumpBody;
      // groves: the wood gathers into darker and paler groups (a slow world noise over the trees' origins), not an even
      // carpet of crowns
      float grove = smoothstep(0.28, 0.72, vnoise2(O.xz / 55.0 + 3.3) * 0.7 + vnoise2(O.xz / 21.0 + 8.1) * 0.3);
      float t5 = (0.6 + 0.8 * hs * hs) * mix(0.4, 1.35, grove);
      crownW = (0.16 + 0.55 * shade + 0.2 * under + 0.3 * clumpB) * mix(0.35, 1.0, clumpBody) * t5;
      if (cls == C_PINE) crownW = crownW * 1.6 + 0.08;   // pines: the darkest trees of every target (墨松)
      if (cls == C_WILLOW) crownW *= 0.42;   // ink02: willows airy, a veil of strands
      if (cls == C_MAPLE || cls == C_GINKGO) crownW *= 0.75;
      // (the photograph's broad tone still darkens a crown it shows dark: a backlit wood glows through its leaves
      // in the photograph's sun term but is a dark mass in its tone)
      crownW = max(crownW, w0 * 0.7 * mix(0.4, 1.0, clumpBody) * mix(1.0, 0.75, 1.0 - shade));
      w0 = crownW;
    }
  }
  // vines on the cliff (ink08): hanging strands and leaf mats drawn in a dark wash (their leaves tinted below)
  if (cls == C_IVY && uNight < 0.5) w0 = 0.42 + 0.25 * shade;
  // a paved path or street (the 苏堤 slabs, 御街): a pale strip, its joints drawn from the G-buffer below
  if (cls == C_PAVE && uNight < 0.5) w0 = 0.05 + 0.05 * shade;
  // a lotus flower (ink03): white petals, a breath of grey where they turn from the light (tinted pink below)
  if (cls == C_BLOOM && uNight < 0.5) w0 = 0.01 + 0.06 * shade;
  // 墨荷: each leaf one flat wet wash (its own depth set per plant below), a little deeper where it turns from the light
  if (cls == C_LOTUS && uNight < 0.5) w0 = 0.5 + 0.3 * shade + 0.15 * smoothstep(0.4, 0.95, 1.0 - abs(Nw.y));
  // roofs: each plane one flat wash (界画), set by the painter's light, not by the cast shadows of the photograph
  if ((cls == C_ROOF || cls == C_CITYFAR) && uNight < 0.5) w0 = mix(0.6, 0.32, smoothstep(0.2, 0.85, LL.y));
  // 墨分五色 over a city: each building's roof its own depth of ink (some nearly black, some left almost paper)
  if (cls == C_ROOF && Cc.w > 0.5 && uNight < 0.5 && uPatch.y > 0.0) {
    float bh = h13(ivec3(floor((Cc.xyz + uCamPos) * 0.5)) + 313);
    w0 *= mix(1.0, bh < 0.22 ? 1.9 : bh < 0.6 ? 1.0 : 0.4, uPatch.y);
  }
  // rock: crisp 斧劈 planes in layered tones (the painter's light, a value per facet, the photograph's own darks), the ink
  // gathering at the foot of the mass; the niche a darker hollow; the carving pale stone modelled only at its turning edges
  float facetLine = 0.0, facetV = 0.0;
  float nearR = 1.0 - smoothstep(uRidgeFrom * 0.3, uRidgeFrom * 0.8, D);
  if ((cls == C_ROCK || cls == C_NICHE) && uNight < 0.5 && hasN) {
    vec2 fc2 = facets(P, Nw, fp, 150.0);
    facetV = fc2.x;
    float pv = smoothstep(0.15, 0.85, mix(plB, smoothstep(0.05, 0.65, sunF), 0.3));
    float v = (pv * 0.9 + fc2.x * 0.9 + (tB - 0.4) * 0.6 - 0.04) * 3.0;
    float lv = clamp(floor(v) + smoothstep(0.42, 0.58, fract(v)), 0.0, 3.0);
    float rw = mix(0.62, 0.1, lv / 3.0) + 0.18 * baseK;
    if (cls == C_NICHE) rw = mix(0.62, 0.36, smoothstep(0.15, 0.6, tF)) + 0.1 * (1.0 - pv);
    facetLine = fc2.y * nearR * (0.4 + 0.6 * shade) * (cls == C_NICHE ? 0.3 : 0.8) * uLook2.x;
    if (uLook3.y > 0.0) {
      // the limestone of ink08: graded grey washes laid in wet, mottled patches (no stipple), deeper in
      // shade and toward the foot, cut by vertical fissures with the shade of the stepped plane beside each; the niche a
      // mid-grey hollow, deeper under its overhang, never black
      vec2 fis = fissures(P, fp);
      float mot = lodNoise(P * vec3(1.0, 0.45, 1.0) + 17.0, fp * 70.0 * uK);
      float mot2 = lodNoise(P * vec3(1.0, 0.3, 1.0) + 3.0, fp * 22.0 * uK);
      pv = smoothstep(0.15, 0.85, mix(plB, smoothstep(0.05, 0.65, sunF), 0.1));
      rw = 0.17 + 0.24 * (1.0 - pv) + 0.2 * (mot - 0.5) + 0.08 * (mot2 - 0.5) + 0.14 * baseK + 0.3 * fis.y + 0.1 * fc2.x;
      if (cls == C_NICHE) rw = 0.3 + 0.12 * (1.0 - pv) + 0.1 * (mot - 0.5) + 0.12 * smoothstep(0.35, 0.05, tF);
      facetLine = max(fc2.y * 0.3, fis.x * 1.0) * nearR * (0.6 + 0.4 * shade) * (cls == C_NICHE ? 0.35 : 1.0) * uLook2.x;
      // the face's own 皴: dry vertical streaks of the side brush, gathered in groups, deeper in shade (world-anchored)
      vec2 rq = vec2(dot(P, uAxisR), P.y);
      float rl = log2(fp * 26.0 * uK); float rl0 = floor(rl);
      float rs = mix(streakLevel(rq, vec2(0.0, -1.0), exp2(rl0), 0.35 + 0.35 * shade, 1.0, rl0 + 40.0), streakLevel(rq, vec2(0.0, -1.0), exp2(rl0 + 1.0), 0.35 + 0.35 * shade, 1.0, rl0 + 41.0), smoothstep(0.0, 1.0, rl - rl0));
      facetLine = max(facetLine, rs * 0.32 * nearR * (cls == C_NICHE ? 0.4 : 1.0));
    }
    w0 = mix(w0, rw, nearR);
  }
  if (cls == C_FIGURE && uNight < 0.5) {
    float rimV = pow(1.0 - clamp(Nv.z, 0.0, 1.0), 1.5);          // the form turning away from the eye
    float pv = smoothstep(0.1, 0.9, LL.y);
    w0 = mix(w0, 0.015 + 0.2 * rimV + 0.06 * (1.0 - pv) + 0.08 * smoothstep(0.4, 0.1, tF), nearR);
  }
  // far ranges: pale washes keyed to their (small) contrast against the haze, not to the absolute tone
  float farW = smoothstep(uRidgeFrom * 0.5, uRidgeFrom, D) * ((isLand(cls) || isFol(cls) || cls == C_CITYFAR) ? 1.0 : 0.0);
  float wFar = pow(clamp((dark - 0.03) * 1.9, 0.0, 1.0), 1.1) * 0.6;
  w0 = mix(w0, max(w0, wFar), farW);
  // far masses as the targets paint them: one graded wash per range, deepest under its ridge and paling
  // downward into the mist at its foot, each range behind paler; from the geometry (distance, ridge, the painter's
  // light), a little of the broad photograph's shading, and a slow world-anchored mottling (no texture of single px)
  float wGeo = 0.0;
  if (farW > 0.0 && uLook3.y > 0.0) {
    float dk = 1.0 - 0.8 * smoothstep(uRidgeFrom, uRidgeFrom * 7.0, D);
    float rgd = exp(-rdist / max(uRidge * 1.7, 1.0));
    float mot = lodNoise(P * vec3(1.0, 0.6, 1.0) + 5.0, fp * 110.0 * uK);
    float wPh = pow(clamp((1.0 - pow(clamp(tB * uTone.x, 0.0, 1.0), uTone.y) - 0.03) * 1.9, 0.0, 1.0), 1.1) * 0.5;
    wGeo = 0.34 * dk * (0.3 + 0.7 * rgd) * (0.8 + 0.4 * shade) * (0.8 + 0.4 * mot) * (isFol(cls) ? 1.2 : 1.0);
    wGeo = mix(wGeo, max(wGeo, wPh * dk), 0.35) * uInkGain;
    wGeo *= 1.0 - 0.75 * uPaperLift;   // a snow scene: the far hills white with snow
  }
  float mul = 1.0;
  vec3 RNG = cls == C_SKY && uNight < 0.5 ? paintedRanges(dirW) : vec3(0.0);
  if (cls == C_SKY) mul = uNight > 0.5 ? uSkyInk * 1.6 : 0.1;
  else if (cls == C_WATER) mul = uWater * mix(0.35, 1.0, exp(-RG.b / 40.0));
  else if (crownW >= 0.0) mul = 1.0;
  else if (cls == C_PINE) mul = mix(0.5, 0.5, farW);
  else if (cls == C_WILLOW) mul = mix(0.16, 0.4, farW);
  else if (cls == C_MAPLE) mul = mix(0.5, 0.5, farW) * (1.0 - 0.45 * uColor);
  else if (cls == C_GINKGO) mul = mix(0.3, 0.5, farW);
  else if (isTree(cls)) mul = mix(0.34, 0.5, farW);
  // near flat ground is the paper itself; slopes and banks take the wash
  else if (cls == C_GROUND) mul = mix(mix(0.18 * uLook2.y, 1.0, smoothstep(0.12, 0.5, 1.0 - Nw.y)), 1.0, farW);
  else if (cls == C_SMALL) mul = 0.08;
  else if (cls == C_IVY || cls == C_PAVE || cls == C_BLOOM) mul = 1.0;
  // 墨荷: every leaf one wash of its own depth, wet at the rim, paper between the leaves
  else if (cls == C_LOTUS) {
    // 墨分五色: some leaves nearly black, some a breath of ink; the near ones heaviest
    float lh = mix(Cc.w > 0.5 ? h13(ivec3(floor((Cc.xyz + uCamPos) * 3.1)) + 57) : 0.5, smoothstep(0.2, 0.8, lodNoise(vec3(P.x, 0.0, P.z) + 9.0, 1.6)), 0.55);
    mul = (0.12 + 1.0 * lh * lh) * mix(1.15, 0.45, smoothstep(uNear * 0.5, uNear * 3.0, D)) * mix(0.35, 1.0, idk);
  }
  else if (cls == C_WALL || cls == C_SNOW) mul = 0.5;
  else if (cls == C_ROOF || cls == C_CITYFAR) mul = 0.55;
  else if (cls == C_DARK) mul = 0.65;
  else if (isArch(cls)) mul = 0.62;
  float wn = cls == C_SKY ? vnoise3(dirW * vec3(9.0, 30.0, 9.0)) : lodNoise(P, fp * 45.0 * uK);
  if (isTree(cls)) mul *= uLook.y;
  if (cls == C_ROCK || cls == C_NICHE) mul *= uLook2.x;
  if (cls == C_ROOF || cls == C_CITYFAR) mul *= uLook.z;
  // aerial perspective: everything pales with distance (the paper shows through)
  if (cls != C_SKY) mul *= mix(1.0, 0.5, smoothstep(uNear * 2.0, uFar * 1.2, D));
  if (cls != C_SKY && cls != C_WATER && cls != C_FIGURE) mul *= isArch(cls) ? mix(uLook3.y > 0.0 ? 0.5 : 0.6, 1.0, idk) : mix(uLook3.y > 0.0 ? 0.35 : 0.55, 1.0, idk);
  // range behind range: each farther one paler, the farthest only a breath of ink
  if (isLand(cls) || isFol(cls)) mul *= mix(1.0, 0.4, smoothstep(uRidgeFrom * 1.5, uRidgeFrom * 10.0, D));
  float w1 = w0 * mul * uInkGain;
  if (wGeo > 0.0) w1 = mix(w1, wGeo, farW);
  // the ground is not blank paper: broad patches of pale wash and dry horizontal 擦 strokes, deeper toward the focus
  // and at the foot of what stands on it (world-anchored: the ground plane's own axes)
  if ((cls == C_GROUND || cls == C_SMALL) && uNight < 0.5 && uPaperLift < 0.5) {
    vec2 gq = vec2(dot(P.xz, normalize(uAxisR.xz)), dot(P.xz, normalize(uAxisF.xz)));
    // foreshortening from the shot's own camera (world-fixed, so the patches do not swim as the camera moves)
    // (the level of detail from the eye, blended between levels; the foreshortening of the lattice from the anchor)
    float Ds = length(P - uCamPos);
    // a walking camera (explore) keeps one fixed foreshortening: a per-pixel one from the moving eye would swim
    float sinG = mix(clamp((uAnchor.y - P.y) / max(length(P - uAnchor), 1.0), 0.03, 1.0), uGrazeFix, uGrazeW);
    float fps = Ds * uPxA;
    float patchN = lodNoise(vec3(gq.x, 0.0, gq.y * sinG * 1.5) + 31.0, fps * 260.0 * uK);
    float patches = smoothstep(0.3, 0.8, patchN);
    float l = log2(fps * 40.0 * uK); float l0 = floor(l);
    vec2 sq = vec2(gq.x, gq.y * sinG * 1.5);
    float st = mix(streakLevel(sq, vec2(1.0, 0.0), exp2(l0), 0.16, 1.0, l0), streakLevel(sq, vec2(1.0, 0.0), exp2(l0 + 1.0), 0.16, 1.0, l0 + 1.0), smoothstep(0.0, 1.0, l - l0));
    float near = 1.0 - smoothstep(uFar * 0.25, uFar * 0.7, Ds);
    float p2 = smoothstep(0.35, 0.75, lodNoise(vec3(gq.x, 0.0, gq.y * sinG * 2.5) + 57.0, fps * 90.0 * uK));
    float gw = (0.03 + 0.1 * patches + 0.06 * p2 + 0.03 * st * patches + 0.1 * baseK) * mix(0.45, 1.0, idk) * near * min(uLook2.y, 2.5);
    w1 = max(w1, gw * uInkGain);
  }
  // snow scenes: the water and the bark are inked so the snow can be left as paper (烘托). The water a grey wash, deeper
  // under the banks (their reflection) and laid in long horizontal strokes; the branches dark below, paper on top
  if (uPaperLift > 0.5 && uNight < 0.5) {
    if (cls == C_WATER) {
      vec3 ws = vec3(dot(P, uAxisR) * 0.12, 0.0, dot(P, uAxisF));
      float sweep = lodNoise(ws + 7.7, fp * 30.0 * uK);
      float refl = exp(-RG.b / 40.0);
      float nearW = smoothstep(uNear * 2.0, uNear * 12.0, D);          // paler toward the viewer
      w1 = (0.03 + 0.05 * nearW + 0.24 * refl + 0.05 * (sweep - 0.5)) * uInkGain;
      // ink10: a calm pale wash, the banks' reflections soft grey under them
      if (uLook3.y > 0.0) w1 = (0.025 + 0.02 * nearW + 0.2 * exp(-RG.b / 28.0) + 0.03 * (sweep - 0.5)) * uInkGain;
    }
    if (cls == C_BARK) w1 = mix(0.75, 0.0, smoothstep(0.05, 0.45, Nw.y)) * uInkGain;
    // the banks: dark ink where the snow meets the water (stones under the snow), paper above
    if (cls == C_GROUND) w1 = max(w1, 0.45 * exp(-RG.g / 9.0) * smoothstep(0.6, 0.2, Nw.y + 0.3 * lodNoise(P + 2.0, fp * 20.0 * uK)) * uInkGain);
    // willows in winter: the hanging twigs a grey mass
    if (cls == C_WILLOW) w1 = max(w1, (0.2 + 0.15 * shade) * mix(0.6, 1.0, idk) * uInkGain);
    // crowns and hedges: snow on the tops, the ink gathered underneath
    if (isFol(cls) && cls != C_WILLOW) w1 *= mix(1.3, 0.25, smoothstep(-0.1, 0.5, Nw.y));
  }
  if (cls == C_SKY && RNG.z > 0.0) w1 = max(w1, RNG.x * uInkGain);
  // open water by day (ink-match): a pale wash laid in long strokes, the bright sun path and glints left paper
  float sunPath = 0.0;
  if (cls == C_WATER && uNight < 0.5 && uPaperLift < 0.5 && uLook3.x > 0.0) {
    // the sun's path drawn from the sun's direction (one broken column of paper below it, as the moon's at night),
    // not from the photograph's glitter (which differs with the water's detail around the camera)
    float path = 0.0;
    if (uMoonCol.x > 0.0) {
      vec2 mz = normalize(uSunW.xz + 1e-6), dz = normalize(dirW.xz + 1e-6);
      float dAz = abs(atan(mz.x * dz.y - mz.y * dz.x, dot(mz, dz)));
      float below = max(-dirW.y, 0.0);
      float wob = lodNoise(vec3(dot(P, uAxisF) * 1.7, 0.0, 3.0), fp * 6.0 * uK) - 0.5;
      float core = 1.0 - smoothstep(uLook3.y > 0.0 ? 0.0 : 0.35, 1.0, dAz / (uMoonCol.y + uMoonCol.z * below) + 0.5 * wob);
      float rows = lodNoise(vec3(dot(P, uAxisR) * 0.3, 0.0, dot(P, uAxisF) * 3.2) + 9.0, fp * 5.0 * uK);
      path = core * smoothstep(0.56 - 0.2 * core, 0.64 - 0.16 * core, rows) * uMoonCol.x;
      // a soft glow on the water under the low sun (ink04), its dashes only a breath of texture
      if (uLook3.y > 0.0) path = core * core * mix(0.55, 1.0, smoothstep(0.4, 0.7, rows)) * uMoonCol.x;
      // ink04: the sun's path broken into horizontal dashes of paper, nearly whole under the sun by the far shore,
      // sparser toward the viewer (as the moon's at night)
      if (uLook5.x > 0.0) { float nearSun = 1.0 - smoothstep(0.0, 0.05, below); path = core * mix(smoothstep(0.5 - 0.15 * core, 0.6 - 0.12 * core, rows), 1.0, 0.25 + 0.6 * nearSun * core) * uMoonCol.x; }
      sunPath = path;
    }
    w1 = uLook3.x * (0.75 + 0.5 * wn) * (1.0 - min(path * (1.0 + 0.4 * uLook5.x), 1.0)) * uInkGain;
    // the shore's reflection: the broad tone of what stands above the shore line, mirrored about it, laid as a
    // soft wash in horizontal strokes that fades away from the shore (the dark woods of ink04 hang in the water)
    if (uLook3.y > 0.0 && RG.b < 998.0) {
      vec2 muv = uv + vec2(0.0, 2.0 * RG.b * uK / uRes.y);
      float rl = min(lum(texture2D(tBroad, muv).rgb), min(lum(texture2D(tBroad, muv + vec2(0.0, 14.0 * uK / uRes.y)).rgb), lum(texture2D(tBroad, muv + vec2(0.0, 30.0 * uK / uRes.y)).rgb)));
      float rt = pow(clamp(rl * uTone.x, 0.0, 1.0), uTone.y);
      float rk = exp(-RG.b / (70.0 + 50.0 * uLook5.x)) * (1.0 - smoothstep(150.0, 235.0, RG.b) * step(0.001, uLook5.x)) * (0.75 + 0.5 * lodNoise(vec3(dot(P, uAxisR) * 0.08, 0.0, dot(P, uAxisF)) + 5.5, fp * 30.0 * uK));
      rk *= uWaterRefl.x * (uWaterRefl.y > 0.0 ? exp(-RG.b / uWaterRefl.y) : 1.0);   // (a near pool: paler, held under the bank)
      w1 = max(w1, smoothstep(0.25, 0.75, 1.0 - rt) * 0.75 * rk * (1.0 - 0.7 * path) * uInkGain);
    }
  }
  // clouds (ink-match): the shaded undersides of the photograph's clouds as soft grey washes, their lit tops paper
  // (from the ½-res tone against the ⅛-res one, not the full-res frame: soft cloud masses, not the photograph's
  // fine detail; a soft wash, wetter at its edge)
  // a low sun's halo (ink04): the sky round the sun left paper; the forms right in front of it veiled (below)
  float sunAng = acos(clamp(dot(dirW, uSunW), -1.0, 1.0));
  float glowW = uLook5.x * exp(-sunAng / 0.075), glowS = uLook5.x * exp(-sunAng / 0.035);
  if (cls == C_SKY && uNight < 0.5 && uLook2.z > 0.0) w1 = max(w1, uLook2.z * (uLook3.y > 0.0 ? smoothstep(0.0, 0.12, tB - tF + 0.015) * (0.7 + 0.3 * wn) : smoothstep(0.005, 0.09, tB - tS + 0.01) * (0.6 + 0.4 * wn)));
  if (cls == C_SKY && uNight < 0.5) w1 *= (1.0 - 0.9 * clamp(glowW, 0.0, 1.0)) * (uLook5.x > 0.0 ? 0.5 : 1.0);   // (an evening sky: pale paper)
  // ink04: long soft bands of cloud low over the evening sky, grey washes wetter at their lower edge, paling
  // into the glow round the sun (directions only: they hold still in the sky)
  if (cls == C_SKY && uNight < 0.5 && uLook6.w > 0.0) {
    float sEl = asin(clamp(uSunW.y, -1.0, 1.0)), el = asin(clamp(dirW.y, -1.0, 1.0));
    vec2 d2 = normalize(dirW.xz + 1e-6); float az = atan(d2.x, d2.y);
    vec2 cq = vec2(az * 14.0, (el - sEl) * 95.0);
    float cn = vnoise2(cq) * 0.55 + vnoise2(cq * vec2(2.6, 1.8) + 4.0) * 0.3 + vnoise2(cq * vec2(7.0, 3.0) + 9.0) * 0.15;
    float sAz = atan(normalize(uSunW.xz + 1e-6).x, normalize(uSunW.xz + 1e-6).y);
    float dAz = -(mod(az - sAz + 3.14159, 6.28318) - 3.14159);   // + = right of the sun (seen facing it)
    float win = smoothstep(-0.01, 0.006, el - sEl) * (1.0 - smoothstep(0.035, 0.07, el - sEl)) * smoothstep(0.02, 0.07, dAz) * (1.0 - smoothstep(0.3, 0.45, dAz));
    float band = smoothstep(0.5, 0.68, cn) * win;
    float under = smoothstep(0.62, 0.5, vnoise2(cq + vec2(0.0, 0.35)) * 0.55 + vnoise2((cq + vec2(0.0, 0.35)) * vec2(2.6, 1.8) + 4.0) * 0.3 + 0.15 * 0.5);
    w1 = max(w1, uLook6.w * band * (0.1 + 0.12 * under) * (1.0 - 0.85 * clamp(glowW * 1.4, 0.0, 1.0)));
  }
  if (isArch(cls)) w1 = min(w1, cls == C_ROOF ? (uPatch.y > 0.0 ? 0.55 : 0.3) * uLook.z : 0.34);
  // a far building (a pagoda across the lake) a dark silhouette in the haze, as the targets draw it
  if (uLook3.y > 0.0 && isArch(cls) && uNight < 0.5) w1 = max(w1, 0.36 * smoothstep(uRidgeFrom * 0.8, uRidgeFrom * 1.6, D) * uInkGain);
  // night: an ink night, dark and flat. The sky one even wash (barely a sweep), the moon a clean disc of paper in a
  // soft lighter halo; the lake a wash a little lighter than the sky with the moon's path as broken horizontal strokes of
  // paper; the far shore a dark band; the hall a 界画 drawing over flat washes; the lanterns' openings left glowing
  if (cls == C_SKY && uNight > 0.5) {
    float sweep = vnoise3(dirW * vec3(2.0, 14.0, 2.0));
    float moon = smoothstep(0.42, 0.55, tS);
    float halo = smoothstep(0.12, 0.4, tB);
    w1 = (0.52 + 0.22 * smoothstep(0.0, 0.45, dirW.y) + 0.035 * (sweep - 0.5)) * uSkyInk * (1.0 - moon) * (1.0 - 0.35 * halo);
  }
  if (cls == C_WATER && uNight > 0.5) {
    vec3 ws = vec3(dot(P, uAxisR) * 0.08, 0.0, dot(P, uAxisF));
    float sweep = lodNoise(ws + 4.1, fp * 40.0 * uK);
    // the moon's path: a column under the moon (from the broad tone) broken into horizontal strokes
    float col = smoothstep(0.18, 0.45, tB);
    float strokes = smoothstep(0.55, 0.68, lodNoise(vec3(dot(P, uAxisR) * 0.25, 0.0, dot(P, uAxisF) * 2.5) + 9.0, fp * 9.0 * uK));
    float path = col * mix(strokes, 1.0, smoothstep(0.45, 0.7, tB));
    float glint = 0.0;
    if (uMoonCol.x > 0.0) {
      // ONE reflection of the moon, as a photograph shows it: a single column straight below the moon, stretched down
      // the water toward the viewer (narrow at the horizon, widening as it comes near) and broken into horizontal
      // dashes of paper by the ripples; bright and nearly whole near the horizon, sparser near the viewer
      vec2 mz = normalize(uSunW.xz + 1e-6), dz = normalize(dirW.xz + 1e-6);
      float dAz = abs(atan(mz.x * dz.y - mz.y * dz.x, dot(mz, dz)));
      float below = max(-dirW.y, 0.0);
      float hw = uMoonCol.y + uMoonCol.z * below;
      float wob = lodNoise(vec3(dot(P, uAxisF) * 1.7, 0.0, 3.0), fp * 6.0 * uK) - 0.5;   // the edge frays row by row
      float core = 1.0 - smoothstep(0.35, 1.0, dAz / hw + 0.5 * wob);
      float rows = lodNoise(vec3(dot(P, uAxisR) * 0.3, 0.0, dot(P, uAxisF) * 3.2) + 9.0, fp * 5.0 * uK);
      float dash = smoothstep(0.56 - 0.2 * core, 0.64 - 0.16 * core, rows);
      float nearMoon = 1.0 - smoothstep(0.0, 0.12, below);
      path = core * mix(dash, 1.0, 0.4 * nearMoon * core) * uMoonCol.x;
      // the lanterns' lit openings: a few small glints below them (from the photograph's brightest water), no columns
      float g2 = smoothstep(0.5, 0.62, lodNoise(vec3(dot(P, uAxisR) * 0.9, 0.0, dot(P, uAxisF) * 4.0) + 3.0, fp * 3.0 * uK));
      glint = smoothstep(0.42, 0.7, tS) * (1.0 - core) * g2 * uMoonCol.w;
      // the lanterns' reflections from the G-buffer (not the photograph's glitter): this water pixel mirrored
      // about the waterline above it (the shore / object base, RG.b px up) lands on a lit opening → a small glint,
      // stretched down the water and broken by the ripples into two or three dashes. Made for 三潭's lantern holes
      // (uLampMirror 1, the look's viewpoint); a lit window elsewhere is a whole bay, and its mirror image was a square
      // block of dashes: away from the viewpoint (uLampMirror 0, src/explore/index.js) the lit windows' reflections
      // are the photograph's columns of glitter below them, broken into horizontal strokes as the moon's path is
      if (uLook3.y > 0.0) {
        float mirror = 0.0, cols = 0.0;
        if (uLampMirror > 0.0 && RG.b < 240.0) {
          float wob = (lodNoise(vec3(dot(P, uAxisR) * 0.6, 0.0, dot(P, uAxisF) * 5.0) + 2.0, fp * 4.0 * uK) - 0.5) * 3.0 * uK;
          float hit = 0.0;
          for (int k = -2; k <= 2; k++) {
            vec2 mp = fc + vec2(wob, 2.0 * RG.b * uK + float(k) * 2.0 * uK);
            int mc = int(texelFetch(tA, clamp(ivec2(mp * uGs), ivec2(0), ivec2(uGRes) - 1), 0).w + 0.5);
            if (mc == C_GLOW) hit = max(hit, 1.0 - abs(float(k)) * 0.2);
          }
          float dash = smoothstep(0.4, 0.55, lodNoise(vec3(dot(P, uAxisR) * 0.3, 0.0, dot(P, uAxisF) * 2.2) + 7.0, fp * 6.0 * uK));
          mirror = hit * mix(dash, 1.0, 0.35) * uMoonCol.w;
        }
        if (uLampMirror < 1.0) {
          float rowsL = lodNoise(vec3(dot(P, uAxisR) * 0.12, 0.0, dot(P, uAxisF) * 1.4) + 5.0, fp * 3.0 * uK);
          cols = smoothstep(0.1, 0.22, tB) * (1.0 - core) * smoothstep(0.58, 0.68, rowsL) * uMoonCol.w;
        }
        glint = mix(cols, mirror, uLampMirror);
      }
    }
    float nearW = 1.0 - smoothstep(30.0, 600.0, D);
    w1 = (0.36 + 0.1 * nearW + 0.05 * (sweep - 0.5)) * uSkyInk * (1.0 - 0.95 * max(path, glint));
  }
  if (uNight > 0.5) {
    // the far shore and its woods: one dark band, a little lighter at the foot (mist on the water)
    if (isLand(cls) || isFol(cls) || cls == C_CITYFAR) w1 = (0.62 - 0.22 * exp(-RG.g / 14.0)) * uSkyInk * mix(1.0, 0.75, smoothstep(uFar * 0.2, uFar, D));
    // the hall: flat washes per part (roof deepest, timber, walls lighter), the stone pale in the moonlight
    if (cls == C_ROOF) w1 = 0.5 * uSkyInk;
    if (cls == C_WOOD || cls == C_DARK) w1 = 0.42 * uSkyInk;
    if (cls == C_WALL) w1 = 0.26 * uSkyInk;
    if (cls == C_STONE || cls == C_METAL) w1 = uMoonCol.x > 0.0 ? (0.5 + 0.14 * shade - 0.18 * smoothstep(0.2, 0.6, tF)) * uSkyInk : 0.05 + 0.1 * shade;
    // ink05: the lantern stones dark, the moon catching their rounded tops and the rims of their tiers
    if ((cls == C_STONE || cls == C_METAL) && uMoonCol.x > 0.0 && uLook3.y > 0.0) {
      // modelled by the painter's light (upper left): the lit flank and the tops a mid grey, the far flank and the
      // undersides near black, the stone mottled (world-anchored), the openings' glow left to the class GLOW
      float top = smoothstep(0.2, 0.8, Nw.y);
      float under = smoothstep(-0.2, -0.7, Nw.y);
      float pl = smoothstep(0.25, 0.85, LL.y);
      float mot = lodNoise(P * vec3(1.0, 2.0, 1.0) + 3.3, max(fp * 18.0 * uK, 0.02));
      w1 = (0.98 - 0.42 * pl - 0.18 * top + 0.15 * under + 0.16 * (mot - 0.5)) * uSkyInk;
    }
    if (cls == C_GLOW) w1 = 0.0;
  }
  // the wash edge feathers into the paper's fibres (洇)
  float q = w1 * uLayers + (wn - 0.5) * 0.6 + (grain - 0.5) * 0.08;   // (more grain here dithers the layer edges into dots)
  float fl = floor(q), fr = q - fl;
  float layered = (fl + smoothstep(0.38, 0.62, fr)) / uLayers;
  float rim = smoothstep(0.45, 0.6, fr) * (1.0 - smoothstep(0.6, 0.95, fr)) * step(0.0, fl) * step(0.02, w1);
  float wash = max(mix(w1, layered, isArch(cls) ? 0.25 : isFol(cls) ? 0.2 : 0.5), 0.0) + rim * uPool / uLayers * (cls == C_ROCK || cls == C_FIGURE ? 0.3 : isFol(cls) && cls != C_LOTUS ? 0.0 : 1.0);
  if (cls == C_SKY || cls == C_LOTUS || cls == C_GLOW || (uNight > 0.5 && (isArch(cls) || isLand(cls) || isFol(cls))) || (cls == C_WATER && (uNight > 0.5 || uPaperLift > 0.5 || uLook5.x > 0.0 || uWaterRefl.y > 0.0)) || cls == C_ROOF || cls == C_CITYFAR || ((cls == C_ROCK || cls == C_NICHE) && nearR > 0.5)) wash = w1;   // a sky wash (and a roof plane) is laid flat, in one go

  // far ranges: dark at the ridge, fading downward into mist (留白)
  float farK = smoothstep(uRidgeFrom * 0.7, uRidgeFrom * 1.4, D) * (uRidge > 0.0 && cls != C_SKY && cls != C_WATER ? 1.0 : 0.0);
  float ridgeFade = exp(-rdist / max(uRidge, 1.0) * (0.8 + 0.4 * wn));
  if (uLook3.y > 0.0) wash = mix(wash, wash * (0.25 + 0.75 * ridgeFade) + 0.04 * exp(-rdist / max(uRidge * 0.35, 1.0)) * smoothstep(0.02, 0.2, w0), farK * 0.6);
  else wash = mix(wash, wash * (0.08 + 0.92 * ridgeFade) + 0.12 * exp(-rdist / max(uRidge * 0.18, 1.0)) * smoothstep(0.02, 0.2, w0), farK);
  // 留白: a band of mist lying low between the near ground and the far ranges
  float mist = 0.0;
  if (uMistBand.w > 0.0 && cls != C_SKY && cls != C_WATER) {
    float mn = lodNoise(P * vec3(1.0, 4.0, 1.0) + 11.0, max(fp * 120.0 * uK, 2.0));
    mist = (1.0 - smoothstep(uMistBand.x, uMistBand.y, P.y + (mn - 0.5) * (uMistBand.y - uMistBand.x) * 1.2))
         * smoothstep(uMistBand.z, uMistBand.z * 1.6, D) * uMistBand.w;
    mist = clamp(mist, 0.0, 1.0);
  }
  if (cls != C_SKY) {
    float bn = lodNoise(P * vec3(1.0, 3.0, 1.0) + 23.0, max(fp * 90.0 * uK, 4.0));
    // (the ink-match look: a pagoda or a far town reads through the haze, the land round it is lost in it)
    float bandK = uLook3.y > 0.0 && (isArch(cls) || cls == C_CITYFAR) ? 0.45 : 1.0;
    mist = max(mist, bandK * max(bandOf(uBand0, P, bn), max(bandOf(uBand1, P, bn), bandOf(uBand2, P, bn))));
    // low mist lying in patches among the blocks (world-anchored), so the city is not a regular grid
    if (uPatch.x > 0.0) {
      float pn = vnoise2(P.xz / uPatch.x + 3.7) * 0.7 + vnoise2(P.xz / (uPatch.x * 0.37) + 9.1) * 0.3;
      float low = 1.0 - smoothstep(12.0, 30.0, P.y - uGroundY + (bn - 0.5) * 8.0);
      mist = max(mist, smoothstep(0.54, 0.68, pn) * low * uPatch.y * smoothstep(uNear, uNear * 3.0, D));
    }
    mist = clamp(mist, 0.0, 1.0);
  }
  // mist eats the feet of every mass. Where the water or a much nearer form cuts a mass off below (a gap
  // between two layers of the view), its wash fades into the paper over a band above that line, with a ragged
  // world-anchored edge; the nearest masses (cut only by the frame) run on out of the picture
  if (cls != C_SKY && cls != C_WATER && cls != C_WAVE && uLook3.w > 0.0 && uNight < 0.5) {
    float fn = lodNoise(P * vec3(1.0, 1.5, 1.0) + 41.0, max(fp * 80.0 * uK, 1.0));
    float fw = uLook3.z * (0.45 + 1.1 * fn) * mix(0.5, 1.0, smoothstep(uNear, uFar * 0.25, D));
    float foot = (1.0 - smoothstep(0.0, fw, RG.a)) * smoothstep(uNear * 1.2, uNear * 4.0, D) * uLook3.w;
    mist = max(mist, foot * (isArch(cls) ? 0.45 : 1.0));
  }
  // ink04: the woods dark at the shore and paling upward into the evening haze (world height, so it holds still)
  if (uLook6.z > 0.0 && (isFol(cls) || isLand(cls))) {
    float vn = lodNoise(P * vec3(1.0, 2.0, 1.0) + 61.0, max(fp * 60.0 * uK, 1.0));
    mist = max(mist, uLook6.z * smoothstep(uLook6.x, uLook6.y, P.y + (vn - 0.5) * (uLook6.y - uLook6.x) * 0.8) * (1.0 - smoothstep(700.0, 1200.0, D)));
  }
  wash *= 1.0 - mist;
  // the wash is laid with a broad brush: horizontal sweeps, a little uneven
  // (on water the sweeps run along the shot's horizontal: long strokes, not blots that read as ripples)
  float sweepW = cls == C_SKY ? 0.5 : cls == C_WATER ? lodNoise(vec3(dot(P, uAxisR) * 0.1, 0.0, dot(P, uAxisF)) + 2.3, fp * 38.0 * uK) : lodNoise(P * vec3(1.0, 5.0, 1.0) + 2.3, fp * 38.0 * uK);
  wash *= (cls == C_ROOF || cls == C_CITYFAR || cls == C_WATER) ? 0.94 + 0.12 * sweepW : 0.82 + 0.36 * sweepW;
  // granulation: pigment settles into the paper texture
  wash *= 1.0 - uGran * 0.5 + uGran * grain;

  // ---------------- 皴 on hills and rock (in shade)
  float cunInk = 0.0;
  if (isLand(cls) && hasN && D < uCunFar) {
    float slope = 1.0 - Nw.y;
    float dens = uCun * clamp((cls == C_GROUND ? 0.05 : 0.3) + 0.5 * shade + 0.35 * w0, 0.0, 0.95) * idk;
    if (cls == C_GROUND) dens *= smoothstep(0.15, 0.45, slope);
    if (cls == C_ROCK) dens = min(dens * 1.7, 0.95);
    dens *= 1.0 - smoothstep(0.86, 0.97, tone);
    dens *= 1.0 - smoothstep(uCunFar * 0.45, uCunFar, D);
    float kind = (cls == C_ROCK || cls == C_FIGURE || uCunKind > 0.5) ? 1.0 : 0.0;
    if (dens > 0.01 && cls != C_FIGURE) cunInk = cunStrokes(P, Nw, fp, dens, kind) * 0.85;
    if (uDbg > 2.5) cunInk = dens;
    cunInk *= uLook3.y > 0.0 ? 1.0 - farW : mix(1.0, 0.25, farK);
    if (cls == C_ROCK || cls == C_NICHE) cunInk *= uLook2.x * (uLook3.y > 0.0 ? 0.15 : 1.0);
  }

  // ---------------- leaf marks by species, 米点 far away
  float leaf = 0.0, treeTone = 1.0;
  float th = 0.5;
  if (isTree(cls) && Cc.w > 0.5) {
    vec3 O = Cc.xyz + uCamPos;
    float Do = length(Cc.xyz);
    th = h13(ivec3(floor(O * 1.7)) + 91);
    treeTone = 0.7 + 0.6 * th;                       // 墨分五色: each tree its own tone
    float fpo = Do * uPxA * uK;
    vec2 lp = vec2(dot(P - O, camR), dot(P - O, camU));
    float dens = uDots * clamp(0.12 + 0.6 * shade + 0.45 * w0, 0.0, 0.95) * idk * idk;
    // the leaf marks gather on the clumps' shaded undersides (not an even stipple over the crown)
    if (crownW >= 0.0) dens = uDots * clamp(0.12 + 0.3 * shade + 0.6 * clumpB, 0.0, 0.9) * mix(0.4, 1.0, clumpBody) * idk;
    float mi = smoothstep(uMi * 0.8, uMi * 1.3, Do);
    float near = 0.0;
    float seed = floor(th * 997.0);
    if (mi < 0.999) {
      if (cls == C_PINE) near = pineFans(lp, fpo * 21.0, fpo, clamp(0.1 + 0.8 * shade + 0.4 * w0, 0.0, 0.95) * uDots * idk, seed) * (crownW >= 0.0 ? 0.7 + 0.5 * clumpBody : 1.0);
      else if (cls == C_WILLOW) near = willowStrands(lp, fpo * 16.0, fpo, uPaperLift > 0.5 ? 0.85 : dens * 0.55, seed);
      else if (cls == C_MAPLE || cls == C_GINKGO) near = lobedLeaves(lp, fpo * 10.0, fpo, clamp(dens * 1.3 + 0.15, 0.0, 0.95), seed, cls == C_MAPLE ? 5.0 : 3.0);
      else if (cls == C_BLOSSOM) near = uLook3.y > 0.0 ? 0.3 * leafDots(lp, fpo * 5.0, fpo, 0.7, seed, 0.0, 1.0) : 0.6 * leafDots(lp, fpo * 7.0, fpo, 0.6, seed, 1.0, 1.0);
      else near = leafDots(lp, fpo * (crownW >= 0.0 ? 5.5 : 10.0), fpo, dens, seed, 0.0, 1.5) * (crownW >= 0.0 ? 0.55 + 0.45 * clumpB : 1.0);
    }
    float far = mi > 0.001 ? miDots(lp, fpo * 9.0, 0.85 * clamp(idk, 0.3, 1.0), seed) : 0.0;
    leaf = mix(near, far * 0.6, mi) * (1.0 - smoothstep(uCunFar * 0.7, uCunFar * 1.4, Do)) * uLook5.y;
  }

  // ---------------- lotus veins: 勾筋 radiating from the leaf centre (above the stalk's foot), near leaves only
  // ---------------- tile rows (ink07): lines running down each roof plane, a row every ~0.3 m across the slope,
  // doubled in spacing as they get small on screen (never closer than ~3 px: no moiré), broken along their length
  float tiles = 0.0;
  if (cls == C_ROOF && uLook3.y > 0.0 && hasN && uNight < 0.5) {
    vec3 tA = cross(Nw, vec3(0.0, 1.0, 0.0));
    if (dot(tA, tA) > 0.02) {
      tA = normalize(tA);
      float u = dot(P, tA);
      float px = max(fp * uK, 1e-4);
      float l = log2(max(3.2 * px / 0.3, 1.0)); float l0 = ceil(l);
      float S = 0.3 * exp2(l0);
      float dl = abs(fract(u / S) - 0.5) * S / px;
      float w = 0.35;
      float along = dot(P, normalize(cross(tA, Nw)));
      float brk = smoothstep(0.3, 0.55, vnoise2(vec2(floor(u / S) * 3.7, along / max(px * 25.0, 0.2))));
      tiles = smoothstep(w + 0.7, w - 0.2, abs(dl - S / px * 0.5)) * brk * (0.55 + 0.45 * shade) * (1.0 - smoothstep(uFar * 0.15, uFar * 0.5, D));
    }
  }
  float vein = 0.0;
  if (cls == C_LOTUS && Cc.w > 0.5) {
    vec3 O = Cc.xyz + uCamPos;
    vec2 v = P.xz - O.xz;
    float r = length(v);
    float a = atan(v.y, v.x) + h13(ivec3(floor(O * 3.1)) + 5) * 6.28;
    float dA = abs(fract(a / 6.2831 * 13.0 + 0.5) - 0.5) / 13.0 * 6.2831;
    float px = fp * uK;
    vein = smoothstep(px * 1.1, px * 0.3, r * sin(dA)) * smoothstep(px * 4.0, px * 10.0, r) * (1.0 - smoothstep(uNear * 0.8, uNear * 2.5, D));
    vein *= 0.55 * smoothstep(0.3, 0.55, lodNoise(P + 4.4, fp * 25.0 * uK));
  }

  // ---------------- water: blank paper with sparse ripple lines
  float wave = 0.0;
  if (cls == C_WATER) {
    float sinG = clamp((uCamPos.y - P.y) / max(D, 1.0), 0.004, 1.0);
    // the rows' lattice from the anchor (the shot's camera, or the walking world's fixed one), not the moving eye: the
    // ripple rows hold to the water as the walker moves (only their level of detail follows the eye, blended)
    float sinW = mix(clamp((uAnchor.y - P.y) / max(length(P - uAnchor), 1.0), 0.004, 1.0), uGrazeFix, uGrazeW);
    float dens = uWaveAmt * uWaves;
    wave = (uWaveMode > 0.5 || uMineral > 0.0) ? waveRows(P, fp, sinG, sinW, camR, camF, clamp(dens, 0.0, 1.0), 0.45, uWaveMode > 0.5 ? 9.0 : 7.0) * (uWaveMode > 0.5 ? 0.8 : 0.4)
                           : ripples(P, fp, clamp(dens, 0.0, 1.0), 0.0, camR, camF, sinG, sinW);
    wave *= 1.0 - smoothstep(uFar * 0.35, uFar * 1.1, D);
    // ink09: about the painted bore the river churns: a grey wash broken by rows of white crests (paper) with
    // dark troughs under them, calming with distance from the front
    // on both sides (ink09: the churned rows spread far behind the wall and the spent foam runs on ahead of its
    // foot toward the bank), in the front's own frame (boreFrame), scaled by the local height of the wall
    if (uBoreInk.x != 0.0 && uLook3.y > 0.0) {
      vec4 BF = boreFrame(P);
      float kk = max(BF.z / 14.0, 0.5);
      float al = BF.x, sd = -BF.y;                                   // sd: + = behind the front (away from the camera)
      float bl = length(uBoreInk.zw - uBoreInk.xy);
      float inside = smoothstep(-20.0, 10.0, al) * (1.0 - smoothstep(bl - 10.0, bl + 30.0, al));
      float churnB = smoothstep(-4.0, 6.0, sd) * (0.35 + 0.65 * exp(-max(sd, 0.0) / (60.0 * kk))) * (1.0 - smoothstep(200.0 * kk, 420.0 * kk, sd));
      float churnA = step(sd, 0.0) * (1.0 - smoothstep(40.0 * kk, 150.0 * kk, -sd)) * 0.8;
      float churn = max(churnB, churnA) * inside;
      if (churn > 0.001) {
        vec2 q = vec2(al, sd);
        float sinW2 = clamp((uAnchor.y - P.y) / max(length(P - uAnchor), 1.0), 0.004, 1.0);
        float pxPerV = sinG / max(fp, 1e-5);
        float l = log2(16.0 * uK / pxPerV); float l0 = floor(l); float tt = smoothstep(0.0, 1.0, l - l0);
        float crest = 0.0, trough = 0.0;
        for (int L = 0; L < 2; L++) {
          // one breaking crest per cell of a staggered world lattice: an arc of random width and offset, white on its
          // top edge, a dark trough in its lee (toward the viewer), the rest of the cell the churned grey
          float lev = l0 + float(L);
          float Sv = exp2(lev), Su = Sv * 3.6 * max(sinW2, 0.03);   // a crest ≈ 3.5 row spacings wide on screen
          vec2 g = vec2(q.x / Su, q.y / Sv); vec2 gi = floor(g);
          float c0 = 0.0, t0 = 0.0;
          for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
            vec2 cid = gi + vec2(float(i), float(j));
            vec4 h = h43(ivec3(ivec2(cid), int(lev) * 7 + 811));
            if (h.w < 0.2) continue;
            vec2 cc = (cid + vec2(0.5 * mod(cid.y, 2.0) + h.x * 0.6, 0.3 + 0.4 * h.y)) * vec2(Su, Sv);
            vec2 v = (q - cc) / vec2(Su * (0.35 + 0.4 * h.z), Sv);
            if (abs(v.x) > 1.0) continue;
            float arc = 0.35 * (1.0 - v.x * v.x);
            float dy = v.y - arc;                                   // + behind (far side), - toward the viewer
            float taper = 1.0 - v.x * v.x;
            c0 = max(c0, smoothstep(0.2 * taper, 0.0, abs(dy + 0.05)) * taper);
            t0 = max(t0, smoothstep(-0.05, -0.18, dy) * (1.0 - smoothstep(-0.35, -0.6, dy)) * taper);
          }
          crest += c0 * (L == 0 ? 1.0 - tt : tt); trough += t0 * (L == 0 ? 1.0 - tt : tt);
        }
        // the spent foam ahead: long streaks of white along the front on a paler grey, fewer dark troughs
        float ahead = step(sd, 0.0);
        float streak = smoothstep(0.55, 0.8, lodNoise(vec3(al * 0.06, 0.0, sd * 0.6) + 3.1, max(fp * 6.0 * uK / max(sinW2, 0.05), 0.4))) * ahead;
        float g0 = mix(0.24 + 0.3 * trough, 0.2 + 0.12 * trough, ahead) * (0.75 + 0.35 * exp(-abs(sd) / (50.0 * kk)));
        wash = mix(wash, g0 * (1.0 - 0.85 * max(crest, streak * 0.8)) * uInkGain * (1.0 - mist), churn);
        wave *= 1.0 - churn;
      }
      // white water at the foot of the face (under its apron): the wash lifts to paper
      float foam = (1.0 - smoothstep(0.0, 22.0 * kk, -sd)) * step(sd, 0.0) * inside;
      wash *= 1.0 - 0.8 * foam; wave *= 1.0 - foam;
    }
    if (uWaveMode < 0.5) wave *= exp(-RG.b / 28.0);
    else wave *= max(smoothstep(0.15, 0.8, fK), exp(-RG.b / 10.0));   // 水纹 gather about the focus and the shores
  }
  if (cls == C_WAVE && uLook3.y > 0.0) {
    // ink09, after 李嵩《钱塘观潮图》 / 马远《水图》: the painted bore as a breaking wall (src/modules/tide.js
    // buildInkBore), painted in the front's own frame (boreFrame: m along it, m ahead of the crest, the local height):
    // the foam left as paper; the face a grey wash deepening up into the hollow under each curling lip, cut by streaks of
    // foam pouring down it and crossed by fine lines running along the wall (水纹); the curl's underside a dark hook;
    // dry streaks of spray rising up and back off the crest; the white water spread at the foot; the raised churned
    // water behind the crest a light grey. World-anchored (the front's frame), no photograph detail.
    vec4 BF = boreFrame(P);
    float H = max(BF.z, 1.0), kk = H / 16.0;
    float yr = P.y / H;                                   // height on the wall (1 = the crest)
    float fw = BF.y / kk;                                 // ahead of the crest line in profile units (the face 3–10)
    vec2 a2 = uBoreInk.xy, t2 = normalize(uBoreInk.zw - a2), n2 = vec2(-t2.y, t2.x);
    if (dot(uShotPos.xz - a2, n2) < 0.0) n2 = -n2;
    float toV = dot(Nw.xz, n2);                           // the surface turned toward the viewer's side (the face)
    // (the painter's light leads: the foam stays paper in a hill's cast shadow)
    float lt = mix(mix(plB, LL.y, 0.4), smoothstep(0.05, 0.65, sunF), 0.15);
    float shK = 1.0 - smoothstep(0.3, 0.85, lt);
    float under = smoothstep(-0.05, -0.5, Nw.y);          // the curl's underside
    float apron = (1.0 - smoothstep(0.07, 0.17, yr)) * smoothstep(8.0, 11.0, fw);
    float faceK = smoothstep(0.1, 0.45, toV) * (1.0 - apron) * (1.0 - smoothstep(0.86, 0.97, yr));
    float back = smoothstep(2.5, -3.0, fw) * smoothstep(-0.2, 0.3, Nw.y);
    float spray = smoothstep(0.98, 1.12, yr);
    vec2 fq = vec2(BF.x, P.y);                            // the front's plane: m along it, m up
    float px = max(fp * uK, 1e-4);
    float l = log2(px * 30.0); float l0 = floor(l); float lt2 = smoothstep(0.0, 1.0, l - l0);
    float pd = clamp(0.4 + 0.35 * (1.0 - yr), 0.0, 0.9);
    float pour = mix(streakLevel(fq, vec2(0.0, -1.0), exp2(l0), pd, 1.0, l0 + 60.0), streakLevel(fq, vec2(0.0, -1.0), exp2(l0 + 1.0), pd, 1.0, l0 + 61.0), lt2);
    // the face: under a full curl the hollow under the lip is the darkest grey, the face below it grey cut by white
    // streaks of foam pouring down; where the crest spills the whole face is white foam streaked with grey; the trough
    // at its foot a grey band where it rises from the water
    float ck = BF.w;
    float hollow = smoothstep(0.42, 0.74, yr) * (1.0 - smoothstep(0.84, 0.93, yr));
    float trough = 1.0 - smoothstep(0.02, 0.22, yr);
    float curlW = (mix(0.16, 0.48, hollow) * (1.0 - 0.8 * pour) + 0.1 * trough) * (0.85 + 0.25 * shK);
    float spillW = 0.04 + 0.2 * pour * (1.0 - trough) + 0.16 * trough + 0.06 * shK;
    float w = mix(spillW, curlW, smoothstep(0.25, 0.75, ck)) * faceK;
    w = max(w, (0.3 + 0.25 * shK) * (0.4 + 0.6 * ck) * under * (1.0 - spray));
    float top = (1.0 - faceK) * (1.0 - under) * (1.0 - apron) * (1.0 - back);
    // (the foam's folds: a soft grey where a lump turns from the light, world-anchored mottling, no outlines)
    float fold = lodNoise(P * vec3(1.0, 1.4, 1.0) + 13.0, max(px * 25.0, 0.3));
    w = max(w, top * (0.02 + 0.2 * shK * shK + 0.06 * smoothstep(0.5, 0.8, fold)));
    w = max(w, back * (1.0 - spray) * (0.13 + 0.08 * shK) * (1.0 - 0.7 * pour));
    float apS = smoothstep(0.5, 0.8, lodNoise(vec3(BF.x * 0.08, 0.0, BF.y * 0.5) + 5.0, max(px * 8.0, 0.3)));
    w = mix(w, 0.04 + 0.12 * apS, apron);
    wash = w * uInkGain;
    // lines along the face: rows of constant height on the wall, waving gently along it, broken where the brush lifts
    float gL = yr * 3.5 + 0.45 * sin(BF.x / (H * 0.8) + 1.3) + 0.25 * sin(BF.x / (H * 0.33));
    float dL = abs(gL - floor(gL + 0.5)) * (H / 3.5) / px;
    float lineF = smoothstep(0.9, 0.3, dL) * smoothstep(0.5, 0.68, lodNoise(vec3(BF.x * 0.3, P.y * 2.0, 0.0) + 7.0, max(px * 30.0, 0.5))) * step(0.15, yr) * step(yr, 0.82);
    // spray: dry streaks rising up and back off the crest, thinning into the sky
    float sl = log2(px * 22.0); float sl0 = floor(sl);
    float sdens = clamp(0.15 + 0.35 * shK, 0.0, 0.7) * max(top, spray * 0.8) * (1.0 - smoothstep(1.15, 1.4, yr));
    vec2 sd2 = normalize(vec2(0.55, 1.0));
    float sst = mix(streakLevel(fq, sd2, exp2(sl0), sdens, 1.0, sl0 + 70.0), streakLevel(fq, sd2, exp2(sl0 + 1.0), sdens, 1.0, sl0 + 71.0), smoothstep(0.0, 1.0, sl - sl0));
    // the spray's torn top edge: the streaks and the grey thin out into paper toward it (no hard rim)
    float rimT = smoothstep(0.0, 7.0, RG.r);
    wash *= mix(1.0, rimT, spray);
    wave = lineF * faceK * 0.6 + sst * 0.4 * mix(1.0, rimT, spray);
  }
  else if (cls == C_WAVE) {
    // 钱塘潮 as 马远《水图》 draws a breaking wave: along the crest a row of curling hooks (卷浪), each a spiral that
    // turns over and back into itself, foam left as paper under them with a few spray dots, then two or three broken
    // lines running along the face, and the ink deepening into the trough. Measured in sheet px from the shot's own
    // camera (world-anchored along the crest) and px below the crest (the ridge pass).
    float Ds = length(P - uShotPos);
    float fps = max(Ds * uPxA * uK, 1e-4);
    float t = RG.r;
    // along the crest by direction, not by position: the far depth is only half-float precise (metres of jitter)
    float uu = -atan(dirW.x, dirW.z) / (uPxA * uK);   // + to the right on screen
    float per = 58.0;
    float k = floor(uu / per);
    float h = h13(ivec3(int(k), 7, 77));
    float R = 6.5 + 7.0 * h * h;
    float cx = (k + 0.6 + 0.45 * (h - 0.5)) * per;
    vec2 d = vec2(uu - cx, t - R);
    float r = length(d);
    // the hook: from the top of the crest it turns forward (+u) and down, then back under itself (0.85 of a turn),
    // the radius closing a little as it curls
    float th = mod(atan(d.x, -d.y), 6.2831);
    float rs = R * (1.0 - th / 6.2831 * 0.45);
    float wid = 0.9 + 0.8 * (1.0 - th / 5.3);
    float curl = smoothstep(wid + 0.6, wid - 0.2, abs(r - rs)) * step(th, 5.3) * step(t, R * 2.2);
    // the crest line running back from the hook to the previous one, rising toward it
    float back = clamp((cx - uu) / per, 0.0, 1.0);
    float crestY = 0.6 + R * 0.5 * pow(back, 2.0) * 0.0 + 1.2 * back;
    curl = max(curl, smoothstep(1.4, 0.4, abs(t - crestY)) * step(uu, cx) * 0.9);
    // lines along the face, wavy, broken where the brush lifts
    float rows = 0.0;
    for (int i = 0; i < 3; i++) {
      float y0 = R * 2.4 + 5.0 + float(i) * (5.0 + 1.5 * float(i));
      float yy = y0 + 1.6 * sin(uu / per * 6.2831 + float(i) * 1.7 + h * 3.0);
      float on = smoothstep(0.35, 0.55, vnoise2(vec2(uu / (per * 1.3), float(i) * 3.1 + k * 0.0)));
      rows = max(rows, smoothstep(1.1, 0.35, abs(t - yy)) * on * (0.8 - 0.15 * float(i)));
    }
    float spray = step(0.94, h13(ivec3(floor(vec2(uu, t) / 2.0), 91))) * step(t, R * 2.3) * step(R * 2.0, t) * 0.5;
    wave = max(max(curl, rows), spray) * 1.1;
    // foam under the curls left as paper; the trough of the face a deepening wash
    // ink-match: the foam a white wall (ink09), the face under it a pale grey that deepens a little toward the trough
    wash = (0.04 + (uLook3.y > 0.0 ? 0.16 : 0.42) * smoothstep(R * 2.5, R * 2.5 + (uLook3.y > 0.0 ? 60.0 : 26.0), t)) * uInkGain;
    if (uLook3.y > 0.0) wave *= 0.7;
  }

  // ---------------- brush lines
  float lineInk = 0.0, bleed = 0.0;
  vec4 J = texelFetch(tJfa, gp, 0);
  if (J.w > 0.5) {
    ivec2 sp = ivec2(J.xy);
    vec4 E = texelFetch(tEdge, sp, 0);
    vec4 SA = texelFetch(tA, sp, 0);
    vec2 sOut = (J.xy + 0.5) / uGs;
    vec2 v = fc - sOut;
    vec3 Ps = worldPosOf(sOut / uRes, SA.z);
    float fps = SA.z * uPxA * uK;
    vec2 nrm = vec2(cos(E.z), sin(E.z)), tng = vec2(-nrm.y, nrm.x);
    float typ = E.w;
    float n1 = lodNoise(Ps, fps * 30.0);
    float n2 = lodNoise(Ps + 17.3, fps * 70.0);
    float pressure = typ > 0.5 && typ < 1.5 ? 0.85 + 0.25 * n1 : smoothstep(0.2, 0.6, n1) * (0.55 + 0.75 * n1);
    if (typ > 1.5 && typ < 2.5) pressure *= smoothstep(0.3, 0.55, lodNoise(Ps + 5.1, fps * 18.0)); // foliage / ground: broken
    // rock: long tapered strokes with gaps between them (the brush lifts), heavier toward the focus
    if (typ > 2.5 && typ < 3.5) pressure *= smoothstep(0.32, 0.62, lodNoise(Ps + 8.3, fps * 55.0)) * (0.55 + 0.6 * lodNoise(Ps + 2.2, fps * 25.0));
    // the carving: an even, unbroken fine line (白描), a little heavier where it turns into shadow
    if (typ > 3.5) pressure = 0.75 + 0.35 * n1;
    bool fine = typ > 0.5 && typ < 1.5 || typ > 3.5;
    float w = E.y * pressure * uLine;
    float off = (n2 - 0.5) * 2.0 * uWobble * uK * (fine ? 0.12 : 1.0);
    float sd = dot(v, nrm) >= 0.0 ? 1.0 : -1.0;
    float d = max(length(v) - off * sd, 0.0);
    vec2 vv = v;
    float cov = smoothstep(w + 0.7 * uK, w - 0.5 * uK, d) * E.x;
    // 飞白: dry streaks along the stroke where the brush runs out
    float across = d * sd / max(w, 0.5);
    float br = vnoise3(vec3(across * 2.6 + 31.0, 0.0, 0.0) + Ps / max(fps * 14.0, 1e-4));
    float dry = fine ? uDry * 0.3 : mix(uDry, 1.0, pow(1.0 - clamp(pressure, 0.0, 1.0), 2.0));
    cov *= 1.0 - dry * smoothstep(0.4, 0.62, br);
    // lines lighten with distance (淡墨 for the middle ground)
    // brush lines on land and trees lighter than the 界画 of the buildings, fading out on the far masses
    int sc0 = int(SA.w + 0.5);
    float lk = (uLook3.y > 0.0 && !isArch(sc0) && sc0 != C_FIGURE) ? 0.7 * (1.0 - 0.7 * smoothstep(uRidgeFrom * 0.4, uRidgeFrom, SA.z)) : 1.0;
    lineInk = lk * cov * (0.75 + 0.35 * n2) * mix(1.0, uLook3.y > 0.0 ? 0.3 : 0.5, smoothstep(uNear * 1.5, uFar * 0.5, SA.z)) * (fine ? mix(0.75, 1.0, fK) : mix(0.45, 1.0, idk));
    // 洇: the ink creeps a little into the fibres beside the line
    if (d > w) bleed = lk * exp(-(d - w) / (1.3 * uK)) * 0.22 * E.x * pressure * (0.4 + grain);
  }

  // ---------------- 苔点: moss dots on the ridge tops of near hills and rocks (where the land meets farther land or sky)
  float moss = 0.0;
  if (uMoss > 0.0 && J.w > 0.5) {
    ivec2 sp = ivec2(J.xy);
    vec4 SA = texelFetch(tA, sp, 0);
    int sc = int(SA.w + 0.5);
    vec4 up = texelFetch(tA, clamp(sp + ivec2(0, int(4.0 * uGs)), ivec2(0), ivec2(uGRes) - 1), 0);
    bool ridgeTop = int(up.w + 0.5) == C_SKY || up.z > SA.z * 1.15;
    if (isLand(sc) && ridgeTop && SA.z < uCunFar * 0.5) {
      vec3 Ps = worldPosOf((J.xy + 0.5) / uGs / uRes, SA.z);
      float fps = SA.z * uPxA * uK;
      vec2 qq = vec2(dot(Ps, camR), dot(Ps, camU)) + vec2(0.0, (fc.y - (J.xy.y + 0.5) / uGs) * fps);
      float dd = length(fc - (J.xy + 0.5) / uGs);
      moss = leafDots(qq, fps * 12.0, fps, 0.45 * uMoss, 77.0, 0.0, 1.35) * smoothstep(7.0 * uK, 3.0 * uK, dd);
      moss *= smoothstep(0.45, 0.6, lodNoise(Ps, fps * 60.0)) * idk;
    }
  }

  // ---------------- colour
  float lit = clamp(sunF, 0.0, 1.0);
  leaf *= 1.0 - (uLook3.y > 0.0 ? (uPaperLift > 0.5 ? 0.35 : 0.8) * farW : 0.75 * farK);
  float ink = wash + cunInk * 0.9 + (leaf + moss) * treeTone * 0.95 + wave * 0.6 + lineInk * 1.5 + bleed + facetLine * 0.7 + vein + tiles * 0.3;
  if (isTree(cls)) wash *= treeTone;
  float zhe = 0.0, hua = 0.0, teng = 0.0, zhu = 0.0;
  float distK = 1.0 - smoothstep(uRidgeFrom * 0.6, uRidgeFrom * 2.5, D);
  if (isLand(cls)) { zhe += 0.25 * lit * distK + 0.08; hua += 0.35 * shade * distK + 0.45 * (1.0 - distK) * smoothstep(0.02, 0.3, w0); }
  if (cls == C_WOOD) { zhe += 0.5; zhu += 0.3; }
  if (cls == C_BARK || cls == C_BOAT) zhe += 0.35;
  if (cls == C_ROOF) hua += 0.12;
  if (cls == C_PINE) { hua += 0.25; teng += 0.08; }
  if (cls == C_BROAD) { hua += 0.3; teng += 0.25; }
  if (cls == C_WILLOW) { hua += 0.18; teng += 0.45; }
  if (cls == C_SMALL) { hua += 0.1; teng += 0.18; }
  if (cls == C_LOTUS) { hua += 0.35; teng += 0.2; }
  if (cls == C_MAPLE) { zhu += 0.7; zhe += 0.25; }
  if (cls == C_GINKGO) { teng += 0.7; zhe += 0.2; }
  if (cls == C_BLOSSOM) zhu += 0.3;
  if (cls == C_GLOW) { teng += 0.8; zhu += 0.15; }
  if (cls == C_WATER) hua += (0.1 * (1.0 - smoothstep(0.0, uFar, D)) + 0.25 * uNight) * (1.0 - uMineral);
  if (cls == C_SKY) {
    float hz = 1.0 - smoothstep(0.0, 0.35, dirW.y);
    float toSun = pow(max(dot(dirW, uSunW), 0.0), 6.0);
    zhe += uWarm * hz * (0.35 + 0.65 * toSun) * 0.7;
    teng += uWarm * toSun * hz * 0.35;
    hua += uNight * (0.5 + 1.2 * uMineral) * w1 + 0.04;
    // painted ranges: 花青 in the far washes (浅绛)
    if (RNG.z > 0.0) { hua += 0.9 * RNG.x; zhe += 0.15 * RNG.x * (1.0 - RNG.y); }
  }
  // snow and bright mist keep the bare paper: no colour on them
  float snowK = (uPaperLift > 0.0 && (isLand(cls) || isArch(cls) || isFol(cls))) ? smoothstep(0.68, 0.8, max(tone, tB)) : 0.0;
  vec3 absP = (pZhe * zhe + pHua * hua + pTeng * teng + pZhu * zhu) * uColor * 0.55 * (1.0 - 0.5 * smoothstep(0.85, 1.0, tone)) * (1.0 - 0.85 * snowK);

  // 纯水墨 with a touch of colour (the ink targets): pink blossom and lotus, red maple, gold ginkgo, the sky's own tint
  if (uLook.w > 0.0) {
    vec3 acc = vec3(0.0);
    if (cls == C_BLOSSOM) acc = (pZhu * 0.42 + pZhe * 0.04) * (uLook3.y > 0.0 ? 0.12 + 1.7 * leaf : 1.0);
    else if (cls == C_MAPLE) acc = pZhu * (1.0 + 0.4 * lit) + pZhe * 0.3;
    else if (cls == C_GINKGO) acc = pTeng * 0.9 + pZhe * 0.35;
    else if (cls == C_IVY) acc = (pTeng * 0.6 + pZhe * 0.5) * 0.45;
    else if (cls == C_BLOOM) {
      // pink toward the petal tips: the photograph's own colour at low pass (its petals run white to pink)
      vec3 bc = texture2D(tBlur, uv).rgb;
      float pk = clamp((bc.r - bc.g) / max(bc.r, 0.05) * 1.6, 0.0, 1.0);
      acc = pZhu * (0.03 + 0.34 * pk * pk);
    }
    else if (cls == C_SKY && uNight < 0.5) {
      float hz = 1.0 - smoothstep(0.0, 0.35, dirW.y);
      float toSun = pow(max(dot(dirW, uSunW), 0.0), 6.0);
      acc = (pZhe * 0.3 * (0.3 + 0.7 * toSun) + pTeng * 0.25 * toSun) * uWarm * hz;
    }
    absP += acc * uLook.w * (1.0 - snowK);
  }
  // the sun's glow: pale gold round the sun (whiter at its core), gold on its path on the water, the edges of the
  // forms against the sun catching its colour
  if (uLook5.x > 0.0 && uNight < 0.5) {
    if (cls == C_SKY) absP += (pTeng * 0.17 + pZhe * 0.17) * glowW * (1.0 - 0.8 * exp(-sunAng / 0.012)) + (pZhe * 0.05 + pInk * 0.03) * (1.0 - clamp(glowW * 1.5, 0.0, 1.0));
    else if (cls == C_WATER) absP += (pTeng * 0.1 + pZhe * 0.05) * sunPath * uLook5.x;
    else absP += (pTeng * 0.1 + pZhe * 0.05) * glowS;
  }
  if (cls == C_SKY && uSkyTint.w > 0.0) {
    // a blue (or warm) sky, deeper toward the zenith; the photograph's clouds stay paper
    float up = smoothstep(0.0, 0.45, dirW.y);
    float cloud = smoothstep(0.01, 0.05, tS - tB);   // the photograph's clouds are brighter than the sky round them
    absP += uSkyTint.rgb * uSkyTint.w * (0.25 + 0.75 * up) * (uNight > 0.5 ? 1.0 - smoothstep(0.42, 0.55, tS) : (1.0 - cloud) * (1.0 - 0.6 * RNG.x));
  }
  if (uNight > 0.5 && uSkyTint.w > 0.0 && cls != C_GLOW) absP += uSkyTint.rgb * uSkyTint.w * 0.35 * (1.0 - smoothstep(0.42, 0.55, tS));
  vec3 col = paper * exp(-absP * (1.0 - mist));
  // 青绿: opaque mineral colours laid over the drawing
  if (uMineral > 0.0) {
    float op = 0.0; vec3 body = vec3(0.0);
    if (isLand(cls) || (isTree(cls) && D > uRidgeFrom)) {
      float top = exp(-rdist / max(uRidge * 0.9, 1.0));
      body = mix(bShilv, bShiqing, smoothstep(0.25, 0.75, top));
      op = 0.85 * smoothstep(0.0, 0.25, w0 + 0.1) * (0.55 + 0.45 * top);
      if (cls == C_GROUND && Nw.y > 0.85 && D < uRidgeFrom) { body = vec3(0.70, 0.58, 0.40); op = 0.35 * smoothstep(0.0, 0.2, w1); }
      // 赭石 at the foot of every mass, the mineral blue-green above it (千里江山: ochre underlayer showing at the base)
      float foot = baseK * (1.0 - top);
      body = mix(body, vec3(0.70, 0.55, 0.34), clamp(foot * 0.85, 0.0, 1.0));
      // near rock: an ochre body, the mineral blue-green only on the faces turned up to the sky and along the ridges
      float nearK = 1.0 - smoothstep(uRidgeFrom * 0.35, uRidgeFrom * 0.8, D);
      if (nearK > 0.0 && (cls == C_ROCK || cls == C_FIGURE || (cls == C_GROUND && Nw.y < 0.85))) {
        float up = max(smoothstep(0.3, 0.75, Nw.y), shade * 0.75 * smoothstep(0.45, 0.6, lodNoise(P + 3.7, fp * 120.0 * uK))) * (0.6 + 0.4 * lodNoise(P, fp * 40.0 * uK));
        // whole 斧劈 planes of the cliff laid in 石绿 / 石青 (some facets), the rest the ochre stone
        if (cls == C_ROCK) up = max(up, smoothstep(0.12, 0.2, facetV) * 0.85);
        vec3 ochre = vec3(0.76, 0.64, 0.46);
        vec3 nb = mix(ochre, mix(bShilv, bShiqing, 0.4 + 0.3 * th), max(up, top * 0.8));
        float nop = mix(0.35, 0.8, max(up, top * 0.8)) * (cls == C_FIGURE ? 0.4 : 1.0);
        body = mix(body, nb, nearK); op = mix(op, nop, nearK);
      }
    }
    if (cls == C_SKY && uNight > 0.5) {
      float moonM = smoothstep(0.42, 0.55, tS);
      body = vec3(0.13, 0.16, 0.24); op = 0.6 * (1.0 - moonM);
    }
    if (cls == C_WATER && uNight > 0.5) { body = vec3(0.17, 0.21, 0.28); op = 0.5 * (1.0 - smoothstep(0.3, 0.55, tF)); }
    if (isTree(cls) && D <= uRidgeFrom) {
      // each tree its own green: malachite toward azurite for pines, toward ochre / gamboge for the broadleaves
      vec3 g = mix(bShilv, cls == C_PINE ? bShiqing : vec3(0.62, 0.6, 0.3), cls == C_PINE ? 0.35 + 0.3 * th : 0.15 + 0.45 * th);
      body = cls == C_MAPLE ? bZhusha : cls == C_GINKGO ? vec3(0.8, 0.62, 0.2) : cls == C_BLOSSOM ? vec3(0.88, 0.66, 0.58) : cls == C_WILLOW ? mix(bShilv, vec3(0.7, 0.72, 0.45), 0.5) : g;
      op = cls == C_MAPLE || cls == C_GINKGO ? 0.75 : 0.55;
      // winter: the bare trees go pale ochre
      body = mix(body, vec3(0.74, 0.66, 0.48), 0.75 * uPaperLift);
    }
    if (cls == C_SMALL) { body = mix(bShilv, vec3(0.66, 0.6, 0.38), 0.45); op = 0.3; }
    if (cls == C_LOTUS) { body = mix(bShilv, bShiqing, 0.25); op = 0.6; }
    if (cls == C_WOOD) { body = bZhusha; op = 0.8; }
    if (cls == C_ROOF) { body = mix(bShiqing, vec3(0.3), 0.55); op = 0.45; }
    if (cls == C_WATER && uNight < 0.5) { body = mix(mix(mix(bShilv, bShiqing, 0.3 * (1.0 - uPaperLift)), vec3(0.5, 0.52, 0.45), 0.3 + 0.3 * uPaperLift), paper, 0.42); op = 0.55 * (1.0 - 0.4 * smoothstep(0.0, uFar * 1.5, D)) * (1.0 - 0.6 * uNight); }
    // snow and mist stay the bare silk (the colour is laid around them, 烘染)
    if (uPaperLift > 0.0 && cls != C_SKY && cls != C_WATER && cls != C_GLOW) op *= 1.0 - smoothstep(0.68, 0.8, max(tone, tB));
    // the body colour granulates and leaves the silk showing at its edges
    op *= uMineral * (0.82 + 0.25 * grain) * (1.0 - mist) * (0.85 + 0.3 * sweepW);
    // 青绿 sky: a gold wash, deeper upward, with pale gold cloud bands drawn round with a fine ochre line (勾云)
    if (cls == C_SKY && uNight < 0.5) {
      float az = atan(dirW.x, dirW.z), el = dirW.y;
      // a few long, thin cloud wisps (勾云) low in the sky, pale gold on the gold ground
      vec2 cq = vec2(az * 9.0, el * 110.0);
      float n = vnoise2(cq) * 0.6 + vnoise2(cq * vec2(2.3, 1.6) + 4.0) * 0.28 + vnoise2(cq * vec2(6.0, 3.0) + 9.0) * 0.12;
      float band = smoothstep(0.02, 0.06, el) * (1.0 - smoothstep(0.14, 0.26, el)) * smoothstep(0.45, 0.7, vnoise2(vec2(az * 2.1, 2.0)));
      float t = 0.68;
      float cloud = smoothstep(t, t + 0.05, n) * band;
      float rim = (1.0 - smoothstep(0.0, 0.01, abs(n - t))) * band;
      vec3 gold = vec3(0.86, 0.71, 0.45);
      vec3 sky = mix(paper, gold, uMineral * (0.3 + 0.32 * smoothstep(0.0, 0.5, el)));
      sky = mix(sky, mix(paper, vec3(0.97, 0.9, 0.7), 0.55), cloud * 0.75);
      sky *= 1.0 - rim * 0.12 * vec3(0.6, 0.8, 1.0);
      // mist low over the horizon: back to the silk
      sky = mix(sky, paper, (1.0 - smoothstep(0.0, 0.05, el)) * 0.6);
      // painted ranges: 石青 at the ridges over 石绿 bodies, fading into the mist (the ink still draws the ridge)
      if (RNG.z > 0.0) {
        // 千里江山: 石青 on the peaks, 石绿 bodies, the 赭石 ground showing at the foot before the mist; farther ranges
        // paler and bluer
        float y = RNG.y;
        float far = 1.0 - (RNG.z - 1.0) / max(uRanges.w - 1.0, 1.0);
        vec3 rb = mix(vec3(0.72, 0.57, 0.36), bShilv, smoothstep(0.12, 0.4, y));
        rb = mix(rb, bShiqing, smoothstep(0.55, 0.9, y));
        rb = mix(rb, mix(bShiqing, paper, 0.45), far * 0.6);
        float op = smoothstep(0.04, 0.22, y) * (0.92 - 0.35 * far);
        sky = mix(sky, rb * (0.95 + 0.1 * grain), uMineral * op);
      }
      col = sky; op = 0.0;
    }
    col = mix(col, body * (0.75 + 0.3 * min(lum(paper) / lum(uPaperCol), 1.15)) * (1.0 - 0.35 * shade * float(isLand(cls))), clamp(op, 0.0, 1.0));
    ink = wash * 0.55 + cunInk * 0.8 + (leaf + moss) * treeTone * 0.8 + wave * 0.8 + lineInk * 1.5 + bleed + facetLine * 0.6 + vein * 0.8;
  }
  float detK = 0.0;
  // dark detail: what the full-resolution photograph has darker than its ½-res blur (tile rows, lattices, joints,
  // bark, the leaf clusters), drawn as fine ink: the painters' 細筆 inside the washes
  // (the walking painting skips it, uLook.x = 0, except on paved strips: their joints are all they have)
  if ((uLook.x > 0.0 || cls == C_PAVE) && cls != C_SKY && cls != C_WATER && cls != C_WAVE && cls != C_BLOOM && uNight < 0.5) {
    // built things and the ground (slab joints) take the fine detail; trees, lotus and rock the clusters a few px
    // across (the dark cores of the leaf masses, the hollows of the rock), never a halftone of single pixels
    // from the G-buffer (one deterministic pass: the accumulated photograph's sampling noise must not turn into ink,
    // or the explorable world's still view would differ from the offline still): the pixel's albedo × light against
    // the mean of a ring of neighbours (relative darkness)
    bool fineK = isArch(cls) || cls == C_GROUND || cls == C_SMALL || cls == C_PAVE;
    float rr = (fineK ? 2.5 : 4.0) * uK * uGs;
    float c0 = gLift ? gAlb(gp) : gShade(gp), sm = 0.0, sn = 0.0;
    for (int i = 0; i < 6; i++) {
      float a = float(i) * 1.0472 + 0.3;
      float v = gLift ? gAlb(gp + ivec2(round(vec2(cos(a), sin(a)) * rr))) : gShade(gp + ivec2(round(vec2(cos(a), sin(a)) * rr)));
      if (v >= 0.0) { sm += v; sn += 1.0; }
    }
    float hp = (sn > 0.0 && c0 >= 0.0) ? (sm / sn - c0) / (sm / sn + 0.04) * 0.25 : 0.0;
    float k = cls == C_PAVE ? 0.35 : (cls == C_ROOF || cls == C_CITYFAR) ? (uLook3.y > 0.0 ? 0.15 : 0.75) : isArch(cls) ? 1.0 : isTree(cls) ? (uLook3.y > 0.0 ? 0.12 : 0.8) : cls == C_LOTUS ? 0.7 : (cls == C_ROCK || cls == C_NICHE) ? (uLook3.y > 0.0 ? 0.12 : 0.5) * uLook2.x : cls == C_FIGURE ? (uLook3.y > 0.0 ? 0.2 : 0.4) : cls == C_GROUND ? 1.1 : 0.4;
    // a gentle ramp (not a threshold): the detail must not amplify the photograph's sampling noise (the explorable
    // world's still view is the offline still only if a few 1/255 of tone stay a few 1/255 of ink)
    float lo = cls == C_GROUND ? 0.03 : cls == C_PAVE ? 0.06 : fineK ? 0.005 : 0.015;   // the ground: only strong joints (slabs), not the litter
    float det = 1.25 * clamp((hp - lo) / (fineK ? 0.16 : 0.2), 0.0, 0.8) * k * (cls == C_PAVE ? 1.0 : uLook.x) * mix(0.55, 1.0, idk) * mix(1.0, 0.3, smoothstep(uFar * 0.3, uFar, D));
    det *= 1.0 - farW;   // the far masses are washes (their G-buffer detail drew the far woods as stipple)
    if (gLift && cls != C_PAVE) det *= 1.0 - 0.85 * uLook5.w;   // open ground: no rings round the fallen petals
    // ink06: a stone wall face is a wash, not a grid of courses (its few course lines are drawn below)
    if (uLook5.z > 0.0 && cls == C_STONE && hasN && abs(Nw.y) < 0.6) det *= 1.0 - 0.9 * uLook5.z;
    ink += det * (1.0 - snowK * 0.7);
    detK = det;
  }
  // ink06: the battered stone walls of the terraces as the target paints them: a pale wash, deeper toward the
  // foot and in a few damp vertical streaks, the courses only hinted (a few broken lines in patches), world-anchored
  if (uLook5.z > 0.0 && cls == C_STONE && hasN && abs(Nw.y) < 0.6 && uNight < 0.5) {
    vec3 tW = normalize(cross(Nw, vec3(0.0, 1.0, 0.0)) + 1e-5);
    float along = dot(P, tW), px = max(fp * uK, 1e-4);
    float cs = 0.85 * exp2(max(0.0, ceil(log2(4.0 * px / 0.85))));   // course height, doubled as it gets small (no moire)
    float dl = abs(fract(P.y / cs + 0.5) - 0.5) * cs / px;
    float patchC = smoothstep(0.58, 0.74, lodNoise(vec3(along, P.y * 1.6, 0.0) + 7.0, max(cs * 9.0, px * 40.0)));
    float brk = smoothstep(0.35, 0.6, vnoise2(vec2(along / max(cs * 3.0, px * 12.0), floor(P.y / cs) * 1.7)));
    float course = smoothstep(1.0, 0.25, dl) * patchC * brk;
    float streak = smoothstep(0.55, 0.8, lodNoise(vec3(along * 1.0, P.y * 0.12, 3.0) + 19.0, max(px * 30.0, 1.5)));
    float foot = 1.0 - smoothstep(0.0, 140.0, RG.g);
    ink += uLook5.z * ((0.05 + 0.08 * shade) * (0.5 + 0.8 * foot) + 0.06 * streak + 0.22 * course) * mix(0.6, 1.0, idk);
  }
  // haze (ink-match): beyond the haze distance everything fades toward the paper (a sunset or a hazy plain)
  if (uLook2.w > 0.0 && cls != C_SKY) { float hz = smoothstep(uLook2.w, uLook2.w * 2.5, D); ink *= 1.0 - 0.8 * hz; }
  // ink over everything (the mist band veils it)
  ink *= 1.0 - mist;
  // smoke from the roofs (ink07): soft wisps of paper over the roofs, their edges a breath of grey ink, hidden
  // behind what stands in front of the plume (density-weighted plume depth against the G-buffer's)
  if (uSmokeOn > 0.5 && uNight < 0.5) {
    vec4 SM = texture2D(tSmoke, uv);
    float sa = SM.r;
    float sd = SM.g / max(sa, 1e-4);
    float vis = (cls == C_SKY || D > sd * 0.97) ? 1.0 : 0.0;
    float sk = smoothstep(0.02, 0.45, sa) * vis;
    float rimS = smoothstep(0.015, 0.08, sa) * (1.0 - smoothstep(0.1, 0.3, sa)) * vis;
    float swn = lodNoise(vec3(uv * uRes / uK / 9.0, 0.0), 1.0);
    // a pale grey veil: it lightens the roofs it drifts over and shows as a soft grey wisp against the mist and paper
    ink = mix(ink, 0.07 + 0.06 * swn, sk * 0.85) + (0.03 + 0.03 * swn) * rimS * smoothstep(0.0, 0.3, sa * 6.0);
  }
  if (cls != C_SKY && cls != C_WATER) ink *= 1.0 - 0.6 * clamp(glowS, 0.0, 1.0);   // backlit forms veiled by the glow
  col *= exp(-pInk * uInkTint * ink * 2.4);
  // a lantern or the moon stays paper: lift glowing pixels back toward the paper
  // land against the sky: the share of sky in this pixel's G-buffer samples blends toward the sky (the far ranges
  // carry no outline to hide a stepped silhouette)
  if ((isLand(cls) || isFol(cls) || cls == C_CITYFAR) && lineInk < 0.1 && uGs > 1.5 && uNight < 0.5) {
    ivec2 b0 = ivec2((fc - 0.5) * uGs);
    float sk = 0.0;
    for (int j = 0; j < 2; j++) for (int i = 0; i < 2; i++) sk += int(texelFetch(tA, b0 + ivec2(i, j), 0).w + 0.5) == C_SKY ? 0.25 : 0.0;
    if (sk > 0.0) {
      vec3 skyC = uMineral > 0.0 ? mix(paper, vec3(0.84, 0.64, 0.30), uMineral * 0.45) : paper;
      vec3 R2 = paintedRanges(dirW);
      if (R2.z > 0.0) skyC *= exp(-pInk * R2.x * uInkGain * 2.4 * (uMineral > 0.0 ? 0.55 : 1.0));
      col = mix(col, skyC, sk);
    }
  }
  // the low sun itself, the brightest thing in the painting (whiter than the sheet), where the sky shows it
  if (uLook5.x > 0.0 && uNight < 0.5) col = mix(col, vec3(1.0, 0.985, 0.94), uLook5.x * exp(-sunAng / 0.012) * (cls == C_SKY ? 0.9 : 0.35));
  gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
  if (uDbg > 0.5) gl_FragColor = vec4(wash, snowK, length(absP), 1.0);
  if (uDbg > 1.5) gl_FragColor = vec4(tone, tB, cunInk, 1.0);
  if (uDbg > 2.5) gl_FragColor = vec4(idk, fK, cunInk, 1.0);
  if (uDbg > 3.5) gl_FragColor = vec4(mist, fK, exp(-RG.b / 35.0), 1.0);
  if (uDbg > 4.5) gl_FragColor = vec4(Cc.w, fract((Cc.xyz + uCamPos) * 0.05).xy, 1.0);
  if (uDbg > 5.5) gl_FragColor = vec4(clamp(RG.r / 40.0, 0.0, 1.0), wave, cls == C_WAVE ? 1.0 : 0.0, 1.0);
  if (uDbg > 6.5) gl_FragColor = vec4(lineInk + bleed, leaf, cunInk, 1.0);
  if (uDbg > 7.5) gl_FragColor = vec4(wash, detK, mist, 1.0);
}
`;

export class InkPainter {
  constructor(renderer, w, h, gs) {
    this.r = renderer;
    this.quad = new FullScreenQuad(null);
    this.resize(w, h, gs);
    const mk = (frag, uniforms) => new THREE.ShaderMaterial({ uniforms: { ...commonUniforms(), ...uniforms }, vertexShader: VERT, fragmentShader: frag, depthTest: false, depthWrite: false });
    this.edgeMat = mk(EDGE_FRAG, { tA: { value: null }, tB: { value: null }, uLine: { value: new THREE.Vector4(40, 2600, 1, 0) } });
    this.jfaInit = mk(JFA_INIT, { tEdge: { value: null } });
    this.jfaStep = mk(JFA_STEP, { tSrc: { value: null }, uStep: { value: 1 } });
    this.ridgeMat = mk(RIDGE_FRAG, { tA: { value: null }, uWaterSteps: { value: 40 } });
    this.lightMat = mk(LIGHT_FRAG, { tA: { value: null }, tB: { value: null }, uSunI: { value: 1 } });
    this.downMat = new THREE.ShaderMaterial({ uniforms: { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() } }, vertexShader: VERT, fragmentShader: DOWN_FRAG, depthTest: false, depthWrite: false });
    this.blurMat = new THREE.ShaderMaterial({ uniforms: { tSrc: { value: null }, uDir: { value: new THREE.Vector2() } }, vertexShader: VERT, fragmentShader: BLUR_FRAG, depthTest: false, depthWrite: false });
    const f = (v) => ({ value: v });
    const v3 = (a) => ({ value: new THREE.Vector3(...a) });
    this.paintMat = mk(PAINT_FRAG, {
      tA: f(null), tB: f(null), tC: f(null), tTone: f(null), tBlur: f(null), tBroad: f(null), tEdge: f(null), tJfa: f(null), tRidge: f(null), tLight: f(null), tLightB: f(null),
      uPaperCol: v3([0.92, 0.89, 0.82]), uPaper: f(0), uAge: f(0.3), uInkGain: f(1), uWashGamma: f(1.5), uWashLo: f(0.1), uLayers: f(4), uPool: f(0.3), uGran: f(0.2),
      uLine: f(1), uWobble: f(1), uDry: f(0.2), uCun: f(1), uCunKind: f(0), uDots: f(1), uMoss: f(1), uWaves: f(1), uColor: f(0), uMineral: f(0),
      uNear: f(40), uFar: f(2600), uCunFar: f(3000), uMi: f(800), uRidge: f(70), uRidgeFrom: f(900), uSkyInk: f(0), uWater: f(0.1), uWaveAmt: f(0.3),
      uWaveMode: f(0), uWarm: f(0), uNight: f(0), uPaperLift: f(0), uDbg: f(0), uMistBand: { value: new THREE.Vector4(0, 0, 0, 0) }, uTone: { value: new THREE.Vector2(1, 1) }, uSunI: f(1), uSunW: v3([0, 1, 0]), uFrame: f(0),
      uFocus0: { value: new THREE.Vector4() }, uFocus1: { value: new THREE.Vector4() }, uShotPos: v3([0, 0, 0]), uAnchor: v3([0, 0, 0]), uGroundY: f(0),
      uRanges: { value: new THREE.Vector4() }, uPatch: { value: new THREE.Vector2() }, uRangesB: { value: new THREE.Vector4() },
      uBand0: { value: new THREE.Vector4() }, uBand1: { value: new THREE.Vector4() }, uBand2: { value: new THREE.Vector4() },
      pInk: v3(PIGMENT.ink), pZhe: v3(PIGMENT.zheshi), pHua: v3(PIGMENT.huaqing), pTeng: v3(PIGMENT.tenghuang), pZhu: v3(PIGMENT.zhusha),
      bShiqing: v3(PIGMENT.shiqing), bShilv: v3(PIGMENT.shilv), bZhusha: v3(PIGMENT.zhushaBody),
      tPaper: f(null), uPaperTex: f(0), uGrazeFix: f(0), uGrazeW: f(0), tSmoke: f(null), uSmokeOn: f(0),
      uLook: { value: new THREE.Vector4(0, 1, 1, 0) }, uLook2: { value: new THREE.Vector4(1, 1, 0, 0) }, uLook3: { value: new THREE.Vector4() }, uLook4: { value: new THREE.Vector4() }, uLook5: { value: new THREE.Vector4(0, 1, 0, 0) }, uLook6: { value: new THREE.Vector4() }, uBoreInk: { value: new THREE.Vector4() }, uBoreInk2: { value: new THREE.Vector4() }, uInkTint: v3([1, 1, 1]), uSkyTint: { value: new THREE.Vector4() }, uMoonCol: { value: new THREE.Vector4() }, uLampMirror: { value: 1 },
    });
    // the paper is fixed to the sheet: realtime painting (cachePaper = true) renders it once per size / style
    this.paintMat.uniforms.uWaterRefl = { value: new THREE.Vector2(1, 0) };   // shot.waterRefl
    this.paperMat = new THREE.ShaderMaterial({ uniforms: this.paintMat.uniforms, vertexShader: VERT, fragmentShader: '#define PAPER_ONLY\n' + PAINT_FRAG, depthTest: false, depthWrite: false });
    this.cachePaper = false;
    this.mats = [this.edgeMat, this.jfaInit, this.jfaStep, this.ridgeMat, this.lightMat, this.paintMat];
  }

  resize(w, h, gs) {
    this.w = w; this.h = h; this.gs = gs;
    const gw = Math.round(w * gs), gh = Math.round(h * gs);
    this.gw = gw; this.gh = gh;
    for (const k of ['toneRT', 'edgeRT', 'jfa0', 'jfa1', 'ridgeRT', 'half0', 'half1', 'q0', 'q1', 'e0', 'e1', 'l0', 'l1', 'lq', 'le0', 'le1', 'paperRT', 'smokeRT']) this[k]?.dispose();
    this.smokeRT = null;
    this.paperRT = null; this._paperKey = '';
    this.lq = rt(Math.ceil(w / 4), Math.ceil(h / 4), THREE.HalfFloatType);
    this.le0 = rt(Math.ceil(w / 8), Math.ceil(h / 8), THREE.HalfFloatType);
    this.le1 = rt(Math.ceil(w / 8), Math.ceil(h / 8), THREE.HalfFloatType);
    this.l0 = rt(Math.ceil(w / 2), Math.ceil(h / 2), THREE.HalfFloatType);
    this.l1 = rt(Math.ceil(w / 2), Math.ceil(h / 2), THREE.HalfFloatType);
    this.toneRT = rt(w, h, THREE.UnsignedByteType);
    this.edgeRT = rt(gw, gh, THREE.HalfFloatType, THREE.NearestFilter);
    this.jfa0 = rt(gw, gh, THREE.FloatType, THREE.NearestFilter);
    this.jfa1 = rt(gw, gh, THREE.FloatType, THREE.NearestFilter);
    this.ridgeRT = rt(w, h, THREE.HalfFloatType, THREE.NearestFilter);   // full res: ridge bands follow the silhouette to the pixel
    this.half0 = rt(Math.ceil(w / 2), Math.ceil(h / 2), THREE.HalfFloatType);
    this.half1 = rt(Math.ceil(w / 2), Math.ceil(h / 2), THREE.HalfFloatType);
    this.q0 = rt(Math.ceil(w / 4), Math.ceil(h / 4), THREE.HalfFloatType);
    this.e0 = rt(Math.ceil(w / 8), Math.ceil(h / 8), THREE.HalfFloatType);
    this.e1 = rt(Math.ceil(w / 8), Math.ceil(h / 8), THREE.HalfFloatType);
  }

  _pass(mat, target) { this.quad.material = mat; this.r.setRenderTarget(target); this.quad.render(this.r); }

  /** smoke plumes (src/city/smoke.js 'citySmoke' meshes) into a ½-res density target, drawn with a density-only clone
   *  of their own material (same cards, same turbulence): r = density, g = density × view depth (m) */
  renderSmoke(meshes, camera) {
    const U = this.paintMat.uniforms;
    U.uSmokeOn.value = 0;
    if (!meshes || !meshes.length) return;
    const r = this.r;
    if (!this.smokeRT || this.smokeRT.width !== Math.ceil(this.w / 2) || this.smokeRT.height !== Math.ceil(this.h / 2)) {
      this.smokeRT?.dispose();
      this.smokeRT = rt(Math.ceil(this.w / 2), Math.ceil(this.h / 2), THREE.HalfFloatType);
    }
    const cc = new THREE.Color(); r.getClearColor(cc); const ca = r.getClearAlpha();
    r.setRenderTarget(this.smokeRT); r.setClearColor(0x000000, 0); r.clear(true, true, false);
    let n = 0;
    for (const m of meshes) {
      if (!m.visible || !m.parent?.visible) continue;
      const src = m.material;
      if (!src.isShaderMaterial) continue;
      let dm = src.userData.inkDensity;
      if (!dm) {
        const fs = src.fragmentShader.replace(/gl_FragColor\s*=\s*vec4\(\s*col\s*\*\s*a\s*,\s*a\s*\)\s*;/, 'gl_FragColor = vec4(a, a * -(viewMatrix * vec4(vW, 1.0)).z, 0.0, 1.0);');
        if (fs === src.fragmentShader) continue;
        dm = src.userData.inkDensity = new THREE.ShaderMaterial({ uniforms: src.uniforms, vertexShader: src.vertexShader, fragmentShader: fs,
          transparent: true, depthTest: false, depthWrite: false, blending: THREE.CustomBlending, blendEquation: THREE.AddEquation,
          blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor, side: THREE.DoubleSide });
      }
      m.material = dm;
      r.render(m, camera);
      m.material = src;
      n++;
    }
    r.setClearColor(cc, ca);
    if (n) { U.tSmoke.value = this.smokeRT.texture; U.uSmokeOn.value = 1; }
  }

  _down(src, sw, sh, dst) { this.downMat.uniforms.tSrc.value = src; this.downMat.uniforms.uTexel.value.set(1 / sw, 1 / sh); this._pass(this.downMat, dst); }
  _blur(a, b, k = 1) {
    const B = this.blurMat.uniforms;
    B.tSrc.value = a.texture; B.uDir.value.set(k / a.width, 0); this._pass(this.blurMat, b);
    B.tSrc.value = b.texture; B.uDir.value.set(0, k / a.height); this._pass(this.blurMat, a);
  }

  /** gbuf: the G-buffer target (textures[1..3]); camera: the unjittered camera; style / shot: ink settings */
  paint(gbuf, camera, style, shot, extra, target) {
    const r = this.r;
    // shared camera uniforms
    const fovR = (camera.fov * Math.PI) / 180;
    for (const m of this.mats) {
      const U = m.uniforms;
      U.uRes.value.set(this.w, this.h); U.uGRes.value.set(this.gw, this.gh); U.uGs.value = this.gs; U.uK.value = this.w / 1664;
      U.uInvProj.value.copy(camera.projectionMatrixInverse); U.uCamWorld.value.copy(camera.matrixWorld);
      U.uCamPos.value.setFromMatrixPosition(camera.matrixWorld);
      U.uPxA.value = (2 * Math.tan(fovR / 2)) / this.h;
      U.uAxisR.value.copy(extra.axisR); U.uAxisF.value.copy(extra.axisF);
    }
    const tA = gbuf.textures[1], tB = gbuf.textures[2], tC = gbuf.textures[3];
    // tone blurs: ½ res (≈3 px) and ⅛ res (≈16 px)
    this._down(this.toneRT.texture, this.w, this.h, this.half0);
    this._blur(this.half0, this.half1, 1.0);
    this._down(this.half0.texture, this.half0.width, this.half0.height, this.q0);
    this._down(this.q0.texture, this.q0.width, this.q0.height, this.e0);
    this._blur(this.e0, this.e1, 1.0);
    this._blur(this.e0, this.e1, 1.5);
    // edges
    this.edgeMat.uniforms.tA.value = tA; this.edgeMat.uniforms.tB.value = tB;
    this.edgeMat.uniforms.uLine.value.set(shot.near, shot.far, style.lineW, shot.match ?? 0);
    this._pass(this.edgeMat, this.edgeRT);
    // jump flooding
    this.jfaInit.uniforms.tEdge.value = this.edgeRT.texture;
    this._pass(this.jfaInit, this.jfa0);
    let src = this.jfa0, dst = this.jfa1;
    // realtime (cachePaper set by the explorable world): 5 jumps (reach 31 px) instead of 7
    for (const s of this.cachePaper ? [16, 8, 4, 2, 1] : [32, 16, 8, 4, 2, 1, 1]) {
      this.jfaStep.uniforms.tSrc.value = src.texture; this.jfaStep.uniforms.uStep.value = s;
      this._pass(this.jfaStep, dst);
      [src, dst] = [dst, src];
    }
    // ridge distance
    this.ridgeMat.uniforms.tA.value = tA;
    this.ridgeMat.uniforms.uWaterSteps.value = this.cachePaper ? 40 : 80;
    this._pass(this.ridgeMat, this.ridgeRT);
    // light on the form
    this.lightMat.uniforms.tA.value = tA; this.lightMat.uniforms.tB.value = tB; this.lightMat.uniforms.uSunI.value = extra.sunI;
    this._pass(this.lightMat, this.l0);
    this._blur(this.l0, this.l1, this.cachePaper ? 1.9 : 1.0);
    if (!this.cachePaper) this._blur(this.l0, this.l1, 1.6);
    this._down(this.l0.texture, this.l0.width, this.l0.height, this.lq);
    this._down(this.lq.texture, this.lq.width, this.lq.height, this.le0);
    this._blur(this.le0, this.le1, this.cachePaper ? 1.8 : 1.0);
    if (!this.cachePaper) this._blur(this.le0, this.le1, 1.5);
    this.paintMat.uniforms.tLightB.value = this.le0.texture;
    // paint
    const U = this.paintMat.uniforms;
    U.tLight.value = this.l0.texture;
    U.tA.value = tA; U.tB.value = tB; U.tC.value = tC; U.tTone.value = this.toneRT.texture; U.tBlur.value = this.half0.texture;
    U.tBroad.value = this.e0.texture; U.tEdge.value = this.edgeRT.texture; U.tJfa.value = src.texture; U.tRidge.value = this.ridgeRT.texture;
    U.uPaperCol.value.set(...style.paperCol);
    const set = (k, v) => { U[k].value = v; };
    set('uPaper', style.paper); set('uAge', style.age); set('uInkGain', style.inkGain); set('uWashGamma', style.washGamma); set('uWashLo', style.washLo);
    set('uLayers', style.layers); set('uPool', style.pool); set('uGran', style.gran); set('uLine', style.line); set('uWobble', style.wobble); set('uDry', style.dry);
    set('uCun', style.cun); set('uCunKind', style.cunKind); set('uDots', style.dots); set('uMoss', style.moss); set('uWaves', style.waves);
    set('uColor', style.color); set('uMineral', style.mineral);
    set('uNear', shot.near); set('uFar', shot.far); set('uCunFar', shot.cunFar); set('uMi', shot.mi); set('uRidge', shot.ridge); set('uRidgeFrom', shot.ridgeFrom);
    set('uSkyInk', shot.sky); set('uWater', shot.water); set('uWaveAmt', shot.waves); set('uWaveMode', shot.waveMode); set('uWarm', shot.warm); set('uNight', shot.night); set('uPaperLift', shot.paperLift || 0); set('uDbg', extra.dbg || 0); U.uMistBand.value.set(...(shot.mist || [0, 0, 0, 0]));
    U.uTone.value.set(shot.tone[0], shot.tone[1]);
    U.uSunI.value = extra.sunI; U.uSunW.value.copy(extra.sunDir);
    const F = extra.focus || [];
    U.uFocus0.value.set(...(F[0] || [0, 0, 0, 1])); U.uFocus1.value.set(...(F[1] || [0, 0, 0, 1]));
    U.uShotPos.value.set(...(extra.shotPos || [0, 0, 0])); U.uGroundY.value = shot.groundY ?? 0;
    U.uAnchor.value.set(...(extra.anchor || extra.shotPos || [0, 0, 0]));
    U.uGrazeFix.value = shot.grazeFix ?? 0; U.uGrazeW.value = shot.grazeW ?? (shot.grazeFix ? 1 : 0);
    const bands = shot.bands || [];
    for (let i = 0; i < 3; i++) U['uBand' + i].value.set(...(bands[i] || [0, 0, 0, 0]));
    // painted far ranges: [base elevation, step, amplitude (deg), count, azimuth centre, half width (deg), ink, fade (deg)]
    U.uPatch.value.set(...(shot.patch || [0, 0]));
    const R = shot.ranges, d = Math.PI / 180;
    U.uRanges.value.set(R ? R[0] * d : 0, R ? R[1] * d : 0, R ? R[2] * d : 0, R ? R[3] : 0);
    U.uRangesB.value.set(R ? (R[4] ?? 0) * d : 0, R ? (R[5] ?? 0) * d : 0, R ? R[6] ?? 0.5 : 0, R ? (R[7] ?? 1.5) * d : 0);
    // the live (walking) painting skips the G-buffer detail (7 fetches a pixel); the still view draws it
    U.uLook.value.set(this.cachePaper ? 0 : shot.detail ?? 0, shot.trees ?? 1, shot.roofs ?? 1, shot.accent ?? 0);
    U.uLook2.value.set(shot.rock ?? 1, shot.ground ?? 1, shot.clouds ?? 0, shot.haze ?? 0);
    const foot = shot.foot || [0, 0];
    U.uLook3.value.set(shot.waterBase ?? 0, shot.match ?? 0, foot[0], foot[1]);
    U.pInk.value.set(...(style.inkAbs || PIGMENT.ink));
    U.uLook4.value.set(...(shot.fg || [0, 0]), 0, 0);
    U.uLook5.value.set(shot.glow ?? 0, shot.leaf ?? 1, shot.walls ?? 0, shot.groundLift ?? 0);
    U.uLook6.value.set(...(shot.veil || [0, 0, 0]), shot.cloudBands ?? 0);
    U.uBoreInk.value.set(...(extra.boreFront || [0, 0, 0, 0]));
    U.uBoreInk2.value.set(...(extra.boreFront?.length >= 8 ? extra.boreFront.slice(4, 8) : [0, 0, 0, 0]));
    U.uInkTint.value.set(...(shot.tint || [1, 1, 1]));
    U.uSkyTint.value.set(...(shot.skyTint || [0, 0, 0, 0]));
    U.uMoonCol.value.set(...(shot.moonCol || [0, 0, 0, 0]));
    U.uLampMirror.value = shot.lampMirror ?? 1;
    U.uWaterRefl.value.set(...(shot.waterRefl || [1, 0]));
    U.uPaperTex.value = 0;
    if (this.cachePaper) {
      const key = [this.w, this.h, style.paper, style.age, ...style.paperCol].join(',');
      if (!this.paperRT) this.paperRT = rt(this.w, this.h, THREE.HalfFloatType, THREE.NearestFilter);
      if (key !== this._paperKey) { this._pass(this.paperMat, this.paperRT); this._paperKey = key; }
      U.tPaper.value = this.paperRT.texture; U.uPaperTex.value = 1;
    }
    this._pass(this.paintMat, target);
  }
}
