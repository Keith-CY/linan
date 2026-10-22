// Terrain material: one procedural MeshStandardMaterial for the whole ground (world-space GLSL, no textures).
//
// Ground classes, blended by height above the lake, slope, distance to the camera and noise masks at several scales
// (rotated value-noise domains: nothing tiles or lines up with the world axes at any distance):
//   lake bed (silt, stones in the shallows) · dark wet stones and wet banks at the waterline · stone revetments on the
//   causeway edges · the worn 青石 slab path along the 苏堤 and 白堤 crowns with an earth margin · meadow grass (seasonal
//   tone, tussocks, blades near the camera) with bare-earth and moss patches, packed earth in the city · forest floor
//   under the instanced trees near the camera (leaf / needle litter, moss, rocks, sparse grass) · the canopy crown
//   pattern on the hills far away, where the instanced trees thin out · grey rock on steep faces (red-brown tuff on
//   宝石山) · snow in winter (holds on flat ground, slides off steep slopes, melts first on south-facing slopes, near
//   the water and on the paths; dusts the far crowns).
// A bump height (tussocks, blades, stones, slab joints, revetment joints) gives a normal response to the low sun;
// detail octaves fade to their mean where they are smaller than ~1.5 pixels (no shimmer).
// Albedos are linear and realistic (grass 0.04-0.14, earth 0.1-0.2, stone 0.2-0.3, snow 0.85): the grade is in post.
import * as THREE from 'three';
import { proceduralMaterial } from '../core/materials.js';
import * as L from '../world/layout.js';

const pts = (a, n = 8) => { const out = []; for (let i = 0; i < n; i++) { const p = a[Math.min(i, a.length - 1)]; out.push(new THREE.Vector2(p[0], p[1])); } return out; };

export const TERRAIN_UNIFORMS = {
  uForestLine: { value: new THREE.Vector2(5.0, 22.0) },     // height (m) where the woods take over from the plain
  uCanopy: { value: new THREE.Vector4(5.5, 0.55, 0.45, 0.55) }, // crown size (m), bump, AO, deciduous share
  uBlossom: { value: 0.012 },                                 // fraction of blossoming (pink/white) crowns near the lake
  uCity: { value: new THREE.Vector4(1350, -2600, 4200, 3200) },
  uRockTint: { value: new THREE.Vector3(0.24, 0.23, 0.21) },
  uTreeZone: { value: new THREE.Vector4(0, 0, -1, 0) },     // camera x, z, radius where instanced trees replace the canopy
  uCanopyNear: { value: new THREE.Vector2(750, 2300) },     // crown pattern fades in between these distances from the camera
  uSnow: { value: new THREE.Vector4(0, 0.72, 0.6, 0.55) },   // amount, normal.y where snow holds, melt (sun / water / paths), patchiness
  uSeasonW: { value: new THREE.Vector4(1, 0, 0, 0) },        // weights spring, summer, autumn, winter
  uSuPts: { value: pts(L.SU_CAUSEWAY.points) }, uSuN: { value: Math.min(8, L.SU_CAUSEWAY.points.length) },
  uBaiPts: { value: pts(L.BAI_CAUSEWAY.points) }, uBaiN: { value: Math.min(8, L.BAI_CAUSEWAY.points.length) },
  uPath: { value: new THREE.Vector4(1.6, 1.5, 1.15, 0.55) }, // slab path half width 苏堤, 白堤, slab length (m), wear
  uCauseW: { value: new THREE.Vector2(L.SU_CAUSEWAY.width * 0.5, L.BAI_CAUSEWAY.width * 0.5) },
  uBaoshi: { value: new THREE.Vector4(250, -2160, 260, 1.0) }, // 宝石山 red tuff: centre x, z, radius, amount
  ...terraceUniforms(),
};
/** layout.TERRACES (up to 8): flat courts at fixed levels with earth banks round them (palace, temple courts) */
function terraceUniforms() {
  const A = [], B = [];
  const T = (L.TERRACES || []).slice(0, 8);
  for (let i = 0; i < 8; i++) {
    const t = T[i];
    if (!t) { A.push(new THREE.Vector4(1e6, 1e6, 1, 0)); B.push(new THREE.Vector4(0, 0, 0, 1)); continue; }
    const a = ((t.rot || 0) * Math.PI) / 180;
    A.push(new THREE.Vector4(t.center[0], t.center[1], Math.cos(a), Math.sin(a)));
    B.push(new THREE.Vector4(t.size[0] * 0.5, t.size[1] * 0.5, t.level, t.skirt || 20));
  }
  return { uTerrA: { value: A }, uTerrB: { value: B }, uTerrN: { value: T.length } };
}

const HEAD = /* glsl */`
float inkPave;   // the ink look's G-buffer (src/ink/gbuffer.js): 1 on the slab paths (class PAVE)
uniform vec2 uForestLine;
uniform vec4 uCanopy;
uniform float uBlossom;
uniform vec4 uCity;
uniform vec3 uRockTint;
uniform vec4 uTreeZone;
uniform vec2 uCanopyNear;
uniform vec4 uSnow;
uniform vec4 uSeasonW;
uniform vec2 uSuPts[8]; uniform int uSuN;
uniform vec2 uBaiPts[8]; uniform int uBaiN;
uniform vec4 uPath;
uniform vec2 uCauseW;
uniform vec4 uBaoshi;
uniform vec4 uTerrA[8]; uniform vec4 uTerrB[8]; uniform int uTerrN;
// terraces: x = signed distance to the nearest court rectangle (m, < 0 inside), y = its skirt width, zw = local u, v
vec4 tTerrace(vec2 p){
  float best = 1e6, sk = 1.0; vec2 uv = vec2(0.0);
  for (int i = 0; i < 8; i++) {
    if (i >= uTerrN) break;
    vec4 a = uTerrA[i], b = uTerrB[i];
    vec2 d = p - a.xy;
    float u = d.x * a.w - d.y * a.z, v = d.x * a.z + d.y * a.w;   // same frame as heightfield.js
    float e = max(abs(u) - b.x, abs(v) - b.y);
    if (e < best) { best = e; sk = b.w; uv = vec2(u, v) + a.xy * 0.37; }
  }
  return vec4(best, sk, uv);
}
float tCrownH(vec2 p){ vec3 v = cgVoronoi2(p); return 1.0 - clamp(v.x * v.x * 1.6, 0.0, 1.0); }
// causeway polyline: x distance, y arc length (m), z signed distance (left +), w unused
vec4 tLine(vec2 p, int which){
  float best = 1e10, s = 0.0, acc = 0.0, sd = 0.0;
  int n = which == 0 ? uSuN : uBaiN;
  for (int i = 0; i < 7; i++) {
    if (i >= n - 1) break;
    vec2 a = which == 0 ? uSuPts[i] : uBaiPts[i], b = which == 0 ? uSuPts[i + 1] : uBaiPts[i + 1];
    vec2 e = b - a; float len = length(e);
    vec2 w = p - a;
    float t = clamp(dot(w, e) / (len * len), 0.0, 1.0);
    float d = length(w - e * t);
    if (d < best) { best = d; s = acc + t * len; sd = sign(e.x * w.y - e.y * w.x) * d; }
    acc += len;
  }
  return vec4(best, s, sd, 0.0);
}
// shared between hooks
vec3 tAlb; float tRough; vec3 tBump; float tAO;
`;

const COLOR = /* glsl */`
  vec3 P = cgP;
  float h = P.y;
  float slope = 1.0 - clamp(cgN.y, 0.0, 1.0);
  float fwX = length(dFdx(P.xz)), fwY = length(dFdy(P.xz));
  float fw = max(fwX, fwY);                                      // metres per pixel (long axis)
  // detail fades on the geometric mean of the two pixel axes: at grazing angles the long axis would blur the ground
  // across as well (the accumulation supersamples the long axis)
  float fwg = sqrt(fw * min(fwX, fwY));
  float camD = distance(cameraPosition.xz, P.xz);
  // detail octave weights: a feature of size s fades to its mean below ~1.5 px
  float k50 = 1.0 - smoothstep(0.3, 0.75, fwg / 0.5);
  float k12 = 1.0 - smoothstep(0.3, 0.75, fwg / 0.12);
  float k03 = 1.0 - smoothstep(0.3, 0.75, fwg / 0.03);
  float sp = uSeasonW.x, su = uSeasonW.y, au = uSeasonW.z, wi = uSeasonW.w;
  // ---- masks
  float city = smoothstep(uCity.x - 120.0, uCity.x + 60.0, P.x) * smoothstep(uCity.y - 200.0, uCity.y, P.z) * smoothstep(uCity.w + 200.0, uCity.w, P.z);
  vec2 R = mat2(0.8, -0.6, 0.6, 0.8) * P.xz;                    // rotated domains: value-noise blocks never align with the world axes
  vec2 R2 = mat2(0.96, 0.28, -0.28, 0.96) * P.xz + 31.7;
  float big = cgFbm3(vec3(R * 0.0021, 0.5), 4) * 0.5 + 0.5;       // 500 m patches
  float mid = cgFbm3(vec3(R * 0.013 + 7.0, 1.5), 3) * 0.5 + 0.5;  // 80 m patches
  float n11 = cgVnoise2(R2 * 0.09 + 3.1);                          // 11 m
  float n2 = cgVnoise2(R * 0.55 + 7.7);                            // 1.8 m
  float n05 = mix(0.5, cgVnoise2(R2 * 2.1 + 1.3), k50);            // 0.5 m
  float n01 = mix(0.5, cgVnoise2(R * 9.0 + 5.9), k12);             // 0.11 m
  // clumps: tussocks of grass / low herbs / litter heaps ~0.45 m across, lit tops and dark gaps between them (the
  // texture real ground cover has at 10-150 m; fades to its mean when smaller than ~1.5 px)
  vec3 cvC = cgVoronoi2(R2 * 2.2 + 3.0);
  float cdome = 1.0 - clamp(cvC.x * cvC.x * 1.8, 0.0, 1.0);
  float clump = mix(0.86, mix(0.48, 1.12, cdome) * (0.85 + 0.3 * cgHash11(cvC.z * 37.0)), k50);
  float groves = smoothstep(0.52, 0.62, mid * 0.7 + big * 0.5);  // tree groves on the plain
  float forest = max(smoothstep(uForestLine.x, uForestLine.y, h + (big - 0.5) * 14.0), groves * smoothstep(1.4, 3.0, h) * 0.9);
  forest *= 1.0 - city * 0.9;
  float rock = smoothstep(0.46, 0.7, slope + (mid - 0.5) * 0.25) * smoothstep(3.0, 12.0, h);
  float bed = 1.0 - smoothstep(-0.25, 0.05, h);
  // ---- causeways: the slab path on the crown, the stone revetment on the edges
  vec4 cs = tLine(P.xz, 0), cb = tLine(P.xz, 1);
  bool onSu = cs.x - uCauseW.x < cb.x - uCauseW.y;
  vec4 cl = onSu ? cs : cb;
  float hwC = onSu ? uCauseW.x : uCauseW.y;
  float pathHW = onSu ? uPath.x : uPath.y;
  float causeK = (1.0 - smoothstep(-1.0, 4.0, cl.x - hwC)) * (1.0 - city);
  float pathEdge = cl.x - pathHW + 0.12 * (cgVnoise2(vec2(cl.y * 0.7, 3.0)) - 0.5);
  float path = causeK * (1.0 - smoothstep(-0.03, 0.03, pathEdge)) * step(0.9, h);
  inkPave = path;
  float margin = causeK * (1.0 - smoothstep(0.0, 0.5 + 0.9 * cgVnoise2(vec2(cl.y * 0.21, 1.0)), pathEdge)) * (1.0 - path) * step(0.9, h);
  float revet = causeK * smoothstep(0.18, 0.4, slope) * (1.0 - smoothstep(1.3, 1.9, h)) * step(-1.2, h);
  // ---- meadow: grass (seasonal tone, tussocks, blades), bare earth, moss
  vec3 gFresh = mix(vec3(0.085, 0.115, 0.038), vec3(0.12, 0.135, 0.05), n11);
  vec3 gDeep = mix(vec3(0.055, 0.085, 0.032), vec3(0.08, 0.10, 0.04), n11);
  vec3 gTawny = mix(vec3(0.13, 0.11, 0.055), vec3(0.17, 0.13, 0.065), n11);
  vec3 gDorm = mix(vec3(0.12, 0.105, 0.075), vec3(0.15, 0.125, 0.085), n11);
  vec3 grass = gFresh * sp + gDeep * su + gTawny * au + gDorm * wi;
  // macro tone: drier / greener stretches, then tussocks and blades near the camera
  grass *= 0.8 + 0.4 * big;
  grass = mix(grass, grass * vec3(1.18, 1.05, 0.85), smoothstep(0.55, 0.8, mid) * 0.6);
  // clumps and tussocks: strong light / dark mottling at 2 m, 0.5 m and 10 cm (a real sward is never one tone)
  grass *= 0.5 + 1.0 * (n2 * 0.5 + n05 * 0.32 + n01 * 0.18);
  grass = mix(grass, grass * vec3(1.25, 1.1, 0.7), smoothstep(0.6, 0.85, n05 * 0.6 + n11 * 0.4) * 0.5);   // dry tips
  // blades: fine streaky speckle (lit tips, dark gaps between them) right in front of the camera
  if (k03 > 0.0) {
    vec2 bq = mat2(0.6, 0.8, -0.8, 0.6) * P.xz;
    float blade = cgVnoise2(vec2(bq.x * 38.0, bq.y * 14.0)) * 0.6 + cgVnoise2(vec2(bq.y * 41.0, bq.x * 17.0) + 3.0) * 0.4;
    grass *= mix(1.0, 0.6 + 0.8 * blade, k03 * 0.8);
  }
  vec3 earthDry = vec3(0.175, 0.145, 0.11), earthDamp = vec3(0.105, 0.085, 0.062);
  vec3 earth = mix(earthDamp, earthDry, smoothstep(0.3, 0.8, n11 * 0.6 + n2 * 0.4)) * (0.85 + 0.3 * n05) * (0.9 + 0.2 * n01);
  vec3 moss = mix(vec3(0.045, 0.065, 0.028), vec3(0.07, 0.085, 0.035), n2) * (0.85 + 0.3 * n01);
  // bare earth: worn patches, steeper banks, the paths' margins
  float bare = smoothstep(0.62, 0.86, n11 * 0.45 + n2 * 0.35 + n05 * 0.2 + slope * 0.9 + (mid - 0.5) * 0.2);
  bare = max(bare, margin * (0.55 + 0.45 * n05));
  float mossK = smoothstep(0.55, 0.8, n2 * 0.6 + n11 * 0.4) * (1.0 - smoothstep(1.5, 6.0, h)) * 0.6 + 0.25 * smoothstep(0.65, 0.9, n05);
  vec3 meadow = mix(grass, moss, mossK * (1.0 - bare));
  meadow *= mix(clump, 1.0, bare * 0.6);
  meadow = mix(meadow, earth * mix(1.0, clump, 0.4), bare);
  // the causeway crown beside the path: trodden earth with dry, flattened grass in tufts (ref02)
  float trod = causeK * step(0.9, h) * (1.0 - smoothstep(0.5, 6.0 + 3.0 * n11, pathEdge)) * (1.0 - path);
  vec3 dryGrass = mix(vec3(0.16, 0.14, 0.085), vec3(0.2, 0.17, 0.1), n05) * (0.75 + 0.5 * n01);
  vec3 trodC = mix(earthDry * (0.95 + 0.15 * n05), dryGrass, smoothstep(0.15, 0.85, n2 * 0.4 + n05 * 0.25 + n11 * 0.35));
  trodC = mix(trodC, grass, smoothstep(0.55, 0.9, n11 * 0.7 + n2 * 0.3) * 0.55);
  // grain: grit, blades and tiny pebbles right in front of the camera
  if (k03 > 0.0) {
    float gr = cgVnoise2(R2 * 31.0) * 0.6 + cgVnoise2(R * 67.0 + 1.7) * 0.4;
    trodC *= mix(1.0, 0.7 + 0.6 * gr, k03);
  }
  meadow = mix(meadow, trodC, trod);
  // fields on the far plain (paddies / tea, rectangular plots), seen from the vantage shots
  vec3 field = mix(vec3(0.11, 0.13, 0.055), vec3(0.15, 0.125, 0.08), step(0.5, cgHash12(floor(R / vec2(42.0, 23.0)))));
  vec3 plain = mix(meadow, field, smoothstep(0.45, 0.7, big) * (1.0 - smoothstep(4.0, 9.0, h)) * 0.55 * smoothstep(250.0, 700.0, camD));
  // city: packed earth and grit
  vec3 packed = vec3(0.19, 0.165, 0.135) * (0.82 + 0.3 * n2) * (0.9 + 0.2 * n01);
  plain = mix(plain, packed, city * 0.85);
  // spring: fallen peach petals on the causeways (sparse pink specks)
  float petals = 0.0; vec3 petalC = vec3(0.62, 0.42, 0.45);
  if (sp * causeK > 0.0 && fwg < 0.03) {
    // one petal per 9 cm cell at most: a small oval at a random spot and angle, pink to white, some browned
    vec2 pc = P.xz / 0.09, pi = floor(pc), pf = fract(pc);
    vec2 hp = cgHash22(pi);
    float an = cgHash12(pi + 7.1) * 6.2832;
    vec2 d = pf - (0.25 + 0.5 * hp);
    d = mat2(cos(an), sin(an), -sin(an), cos(an)) * d;
    float ov = length(d / vec2(0.26, 0.15));
    float dens = smoothstep(0.35, 0.8, n2 * 0.6 + n11 * 0.4) * 0.75;
    petals = sp * causeK * step(0.9, h) * (1.0 - smoothstep(0.008, 0.025, fwg)) * step(1.0 - dens, cgHash12(pi + 3.3)) * (1.0 - smoothstep(0.8, 1.0, ov));
    float pt = cgHash12(pi + 9.9);
    petalC = mix(vec3(0.68, 0.46, 0.5), vec3(0.75, 0.68, 0.66), pt);
    petalC = mix(petalC, vec3(0.32, 0.22, 0.16), step(0.85, pt));
  }
  // ---- the slab path (青石板): courses of irregular worn grey-green flagstones (two or three across, each column with
  // its own lengths), thin dirt-filled joints, rounded chipped edges, a polished centre, grime and moss at the sides
  vec3 slabC = vec3(0.0); float joint = 0.0, slabH = 0.0;
  if (path > 0.0) {
    // courses laid across the path, 0.5-0.95 m long (jittered edges), each split into 1-3 slabs at random places
    float x = clamp(cl.z + pathHW, 0.0, 2.0 * pathHW);            // 0..2hw across the path
    float rl = 0.72;
    float i0 = floor(cl.y / rl);
    float e0 = (i0 + 0.36 * (cgHash11(i0 * 1.73 + 0.1) - 0.5)) * rl;
    float e1 = (i0 + 1.0 + 0.36 * (cgHash11((i0 + 1.0) * 1.73 + 0.1) - 0.5)) * rl;
    float row = i0;
    if (cl.y < e0) { row = i0 - 1.0; e1 = e0; e0 = (i0 - 1.0 + 0.36 * (cgHash11((i0 - 1.0) * 1.73 + 0.1) - 0.5)) * rl; }
    else if (cl.y > e1) { row = i0 + 1.0; e0 = e1; e1 = (i0 + 2.0 + 0.36 * (cgHash11((i0 + 2.0) * 1.73 + 0.1) - 0.5)) * rl; }
    float dAlong = min(cl.y - e0, e1 - cl.y);
    float nA = 1.0 + floor(cgHash11(row * 3.1 + 0.7) * 2.99);
    float j1 = (1.0 / nA + 0.16 * (cgHash11(row * 5.3) - 0.5)) * 2.0 * pathHW;
    float j2 = (2.0 / nA + 0.12 * (cgHash11(row * 6.1) - 0.5)) * 2.0 * pathHW;
    float dAcross = min(x, 2.0 * pathHW - x) + 0.3;                // the outer edges are the path's own edge
    if (nA > 1.5) dAcross = min(dAcross, abs(x - j1));
    if (nA > 2.5) dAcross = min(dAcross, abs(x - j2));
    float colI = (nA > 1.5 && x > j1 ? 1.0 : 0.0) + (nA > 2.5 && x > j2 ? 1.0 : 0.0);
    float id = cgHash12(vec2(row, colI) + 0.37);
    // distance to the slab border (m), the border wobbles a little (hand-cut stones)
    float wob = 0.012 * (cgVnoise2(P.xz * 9.0) - 0.5);
    float ed = min(dAlong + wob, dAcross - wob);
    float jw = 0.006 + 0.01 * cgHash11(id * 7.0);
    joint = (1.0 - smoothstep(jw, jw + 0.01, ed)) * k12;
    float bevel = smoothstep(jw, jw + 0.035, ed);
    vec3 stone = mix(vec3(0.17, 0.18, 0.17), vec3(0.25, 0.25, 0.235), id) * mix(vec3(1.0), vec3(1.04, 1.0, 0.93), cgHash11(id * 3.3));
    // pitting, mottling, dark damp spots
    stone *= 0.86 + 0.22 * n05 + 0.14 * (n01 - 0.5);
    vec2 pq = mat2(0.7, 0.71, -0.71, 0.7) * P.xz;
    stone *= mix(1.0, 0.82 + 0.36 * (cgVnoise2(pq * 17.0 + id * 9.0) * 0.6 + cgVnoise2(pq.yx * 41.0 + 3.0) * 0.4), k03);
    stone = mix(stone, stone * 0.65, smoothstep(0.62, 0.8, cgVnoise2(P.xz * 3.7 + id * 4.0)) * 0.6);
    // worn centre: smoother, lighter; grime, lichen and moss toward the edges and along the joints
    float centre = 1.0 - smoothstep(0.15, 0.95, cl.x / pathHW);
    stone *= 1.0 + 0.12 * centre * uPath.w;
    stone = mix(stone, vec3(0.08, 0.09, 0.06), smoothstep(0.55, 0.95, n2 * 0.6 + (1.0 - centre) * 0.45) * 0.45);
    stone = mix(stone, vec3(0.06, 0.08, 0.035), (1.0 - smoothstep(jw, jw + 0.06, ed)) * 0.5 * (1.0 - centre * 0.6));
    stone *= mix(0.82, 1.0, bevel);
    vec3 dirt = mix(vec3(0.07, 0.065, 0.05), vec3(0.06, 0.08, 0.035), step(0.5, cgHash11(id * 13.0)));
    slabC = mix(stone, dirt, joint);
    slabH = bevel * 0.012 + (id - 0.5) * 0.004;
  }
  // ---- forest floor (under the instanced trees near the camera): litter, needles, moss, rocks, a little grass
  float needleK = smoothstep(0.45, 0.65, big) * smoothstep(20.0, 70.0, h);
  vec3 litterBrown = mix(vec3(0.095, 0.072, 0.05), vec3(0.15, 0.11, 0.072), n2) * (0.8 + 0.4 * n01);
  vec3 litterAu = mix(vec3(0.2, 0.11, 0.05), vec3(0.26, 0.18, 0.06), n05);
  vec3 litter = mix(litterBrown, litterAu, au * 0.6 * smoothstep(0.4, 0.7, n2));
  vec3 needles = mix(vec3(0.085, 0.066, 0.05), vec3(0.125, 0.092, 0.064), n05) * (0.85 + 0.3 * n01);
  vec3 floorC = mix(litter, needles, needleK);
  // humus, moss, grass in the light gaps, bare earth on the steeper ground, scattered grey stones
  float fA = cgVnoise2(R2 * 0.045 + 5.0), fB = cgVnoise2(R * 0.19 + 2.0);
  floorC *= 0.7 + 0.5 * fA;
  floorC = mix(floorC, moss, smoothstep(0.5, 0.8, fB * 0.6 + n05 * 0.4) * 0.5);
  // grass takes the open, sunny slopes (the grassy hillsides under 六和塔), litter stays in the hollows
  float open = smoothstep(0.22, 0.6, fA * 0.5 + big * 0.3 + n2 * 0.2) * (1.0 - needleK * 0.5) * (1.0 - wi * 0.3);
  floorC = mix(floorC, grass * 0.95, open * 0.85);
  floorC = mix(floorC, earth * 0.85, smoothstep(0.55, 0.8, slope + n05 * 0.3) * 0.5);
  floorC = mix(floorC, earth * (0.8 + 0.3 * n01), smoothstep(0.7, 0.86, fB * 0.45 + n2 * 0.35 + n05 * 0.2) * 0.7);   // bare patches
  vec3 fv = cgVoronoi2(R * 1.3 + 4.0);
  floorC *= clump;
  float fStone = step(0.94, fv.z) * smoothstep(0.45, 0.2, fv.x) * smoothstep(0.5, 0.8, fB);
  floorC = mix(floorC, uRockTint * (0.35 + 0.25 * cgHash11(fv.z * 31.0)), fStone);
  // ---- canopy (crowns), far away where the instanced trees thin out
  vec2 cp = P.xz / uCanopy.x;
  vec3 vc = cgVoronoi2(cp);
  float crownId = vc.z;
  float dome = 1.0 - clamp(vc.x * vc.x * 1.6, 0.0, 1.0);
  float resolved = 1.0 - smoothstep(uCanopy.x * 0.15, uCanopy.x * 0.45, fw);
  float stand = cgVnoise2(P.xz * 0.008 + 3.0) * 0.6 + cgVnoise2(P.xz * 0.03) * 0.4;
  float decidK = step(1.0 - uCanopy.w * (0.5 + stand), crownId);
  vec3 ever = mix(vec3(0.028, 0.045, 0.026), vec3(0.04, 0.058, 0.03), cgHash11(crownId * 71.0));
  vec3 springC = mix(vec3(0.075, 0.105, 0.035), vec3(0.11, 0.13, 0.045), cgHash11(crownId * 13.0));
  vec3 summerC = mix(vec3(0.045, 0.075, 0.03), vec3(0.065, 0.09, 0.035), cgHash11(crownId * 13.0));
  vec3 autumnC = mix(vec3(0.16, 0.07, 0.03), vec3(0.22, 0.15, 0.04), cgHash11(crownId * 5.0));
  vec3 bareC = vec3(0.075, 0.065, 0.055) * (0.8 + 0.4 * cgHash11(crownId * 9.0));
  vec3 decid = springC * sp + summerC * su + autumnC * au + bareC * wi;
  vec3 leaf = mix(ever, decid, decidK);
  float bl = sp * step(1.0 - uBlossom * (1.0 - smoothstep(20.0, 60.0, h)), cgHash11(crownId * 5.3 + 0.7));
  leaf = mix(leaf, mix(vec3(0.55, 0.36, 0.40), vec3(0.62, 0.58, 0.55), cgHash11(crownId * 3.1)), bl);
  float gap = smoothstep(0.25, 0.0, dome);
  vec3 canopyNear = leaf * (0.75 + 0.45 * dome) * mix(1.0, 0.35, gap);
  vec3 canopyFar = leaf * 0.85;
  vec3 canopy = mix(canopyFar, canopyNear, resolved);
  // near the camera the instanced trees stand on forest floor (the crown pattern only far away)
  float far = smoothstep(uCanopyNear.x, uCanopyNear.y, camD);
  float zone = uTreeZone.z > 0.0 ? 1.0 - smoothstep(uTreeZone.z * 0.55, uTreeZone.z, distance(P.xz, uTreeZone.xy)) : 0.0;
  far *= 1.0 - zone;
  vec3 woods = mix(floorC, canopy, far);
  // terraces: a packed-earth / gravel court on top, earth banks with grass and stones on the skirts (no canopy)
  vec4 tt = tTerrace(P.xz);
  float court = 1.0 - smoothstep(-1.5, 0.5, tt.x);
  float bank = smoothstep(-0.5, 1.5, tt.x) * (1.0 - smoothstep(tt.y * 0.8, tt.y * 1.3, tt.x));
  // the court: old stone paving (0.8 m slabs in running bond), grass and moss in the joints, sunken and missing
  // slabs showing earth, a gravel margin at the edge
  vec3 gravel = mix(vec3(0.14, 0.13, 0.11), vec3(0.18, 0.165, 0.14), n2) * (0.85 + 0.3 * n01);
  float pave = 0.0; vec3 paveC = gravel; float paveJ = 0.0;
  if (court > 0.0) {
    vec2 pq = tt.zw / vec2(0.82, 0.62);
    pq.x += 0.5 * mod(floor(pq.y), 2.0);
    vec2 pf = fract(pq), pi = floor(pq);
    float pid = cgHash12(pi + 0.71);
    float pe = min(min(pf.x, 1.0 - pf.x) * 0.82, min(pf.y, 1.0 - pf.y) * 0.62);
    paveJ = (1.0 - smoothstep(0.008, 0.025, pe)) * k12;
    vec3 slab = mix(vec3(0.2, 0.2, 0.185), vec3(0.3, 0.29, 0.26), pid) * (0.85 + 0.25 * n05 + 0.12 * (n01 - 0.5));
    slab = mix(slab, vec3(0.1, 0.11, 0.08), smoothstep(0.6, 0.9, n2 * 0.6 + n11 * 0.4) * 0.45);           // grime
    vec3 jointC = mix(vec3(0.05, 0.065, 0.03), grass, 0.5);
    paveC = mix(slab, jointC, paveJ);
    float missing = step(0.93, cgHash12(pi + 9.3)) * smoothstep(0.5, 0.8, n11);
    paveC = mix(paveC, earth * 0.8, missing);
    pave = smoothstep(-0.6, -1.4, tt.x);
  }
  gravel = mix(gravel, grass * 0.9, smoothstep(0.55, 0.85, n11 * 0.6 + n05 * 0.4) * 0.5);   // weeds in the margin
  gravel = mix(gravel, paveC, pave);
  // banks: planted grass and scrub with earth showing where it is steep or worn
  vec3 bankC = mix(grass * 0.8, earth * 0.85, smoothstep(0.55, 0.85, n11 * 0.4 + n05 * 0.3 + slope * 0.6));
  bankC = mix(bankC, moss, smoothstep(0.6, 0.85, fB) * 0.4);
  bankC = mix(bankC, uRockTint * 0.7, fStone);
  float terr = max(court, bank);
  woods = mix(woods, mix(bankC, gravel, court), terr);
  // ---- rock (grey; red-brown tuff on 宝石山, 宝石流霞)
  vec3 rockC = uRockTint * (0.75 + 0.4 * cgVnoise2(P.xz * 0.11 + P.y * 0.07)) * mix(vec3(1.0), vec3(0.9, 0.95, 0.85), cgVnoise2(P.xz * 0.02));
  rockC *= 0.85 + 0.3 * n05;
  float tuff = uBaoshi.w * (1.0 - smoothstep(uBaoshi.z * 0.6, uBaoshi.z, distance(P.xz, uBaoshi.xy)));
  rockC = mix(rockC, vec3(0.19, 0.11, 0.075) * (0.8 + 0.4 * n2), tuff);
  // ---- shore: wet banks and dark wet stones at the waterline; the bed below
  float wet = (1.0 - smoothstep(0.05, 0.45 + 0.35 * n2, h)) * (1.0 - bed);
  float stoneBand = (1.0 - smoothstep(0.15, 0.55, abs(h - 0.08) + 0.15 * (n2 - 0.5))) * smoothstep(0.35, 0.6, n11 * 0.6 + n2 * 0.4 + causeK * 0.4);
  vec3 sv = cgVoronoi2(R2 * 3.2);                 // ~30 cm stones
  float stoneDome = smoothstep(0.62, 0.15, sv.x) * k50;
  float isStone = stoneBand * step(0.25, sv.z) * smoothstep(0.1, 0.4, stoneDome + 0.3 * (1.0 - k50));
  vec3 stoneC = mix(vec3(0.12, 0.12, 0.11), vec3(0.2, 0.19, 0.17), cgHash11(sv.z * 17.0)) * (0.85 + 0.3 * n01);
  vec3 mud = vec3(0.13, 0.115, 0.09) * (0.8 + 0.3 * n2);
  vec3 bedC = mix(vec3(0.09, 0.09, 0.07), vec3(0.12, 0.115, 0.09), n11) * (0.85 + 0.3 * n05);
  bedC = mix(bedC, stoneC * 0.8, smoothstep(-0.9, -0.2, h) * step(0.55, sv.z) * stoneDome);
  // revetment blocks on the causeway edges (irregular ashlar, an algae band at the water)
  vec3 revC = vec3(0.0); float revJ = 0.0;
  if (revet > 0.0) {
    vec2 rq = vec2(cl.y / 0.9, P.y / 0.45);
    rq.x += 0.5 * floor(rq.y);
    vec2 rf = fract(rq);
    float rid = cgHash12(floor(rq));
    revJ = (1.0 - smoothstep(0.03, 0.06, min(rf.x, 1.0 - rf.x) * 0.9)) + (1.0 - smoothstep(0.03, 0.06, min(rf.y, 1.0 - rf.y) * 0.45));
    revJ = clamp(revJ, 0.0, 1.0) * k12;
    revC = mix(vec3(0.16, 0.165, 0.15), vec3(0.24, 0.235, 0.21), rid) * (0.85 + 0.3 * n05);
    revC = mix(revC, vec3(0.05, 0.06, 0.04), revJ * 0.8);
    revC = mix(revC, vec3(0.06, 0.08, 0.04), smoothstep(0.6, 0.0, h) * 0.5);
  }
  // ---- compose
  vec3 c = mix(plain, woods, forest);
  c = mix(c, mix(bankC, gravel, court), terr * (1.0 - forest));
  c = mix(c, rockC, rock * (1.0 - 0.6 * forest * (1.0 - smoothstep(0.55, 0.8, slope))));
  c = mix(c, mud, (1.0 - smoothstep(0.15, 0.7 + 0.4 * mid, h)) * (1.0 - city) * (1.0 - causeK) * 0.6);
  c = mix(c, revC, revet);
  c = mix(c, slabC, path);
  c = mix(c, petalC, petals * (1.0 - joint));
  c = mix(c, stoneC, isStone * (1.0 - bed));
  c *= mix(1.0, 0.55, wet * (1.0 - isStone * 0.3));
  c = mix(c, bedC, bed);
  // ---- snow (winter): holds on flat ground, slides off steep faces, melts on south-facing slopes, near the water
  // and on the trodden path first; under the trees only in patches; dusts the far crowns
  float snowK = 0.0;
  if (uSnow.x > 0.0) {
    float hold = smoothstep(uSnow.y - 0.12, uSnow.y + 0.08, cgN.y);
    float south = clamp(cgN.z * 2.5, 0.0, 1.0);                                   // +z = south-facing
    float melt = uSnow.z * (0.5 * south + 0.6 * (1.0 - smoothstep(0.3, 1.6, h)) + 0.45 * path);
    float patches = cgVfbm2(R2 * 0.18 + 7.0, 4) * 0.6 + n2 * 0.25 + n05 * 0.15;
    snowK = hold * smoothstep(melt * 0.8 + uSnow.w * 0.35, melt * 0.8 + uSnow.w * 0.35 + 0.18, patches + 0.35);
    snowK *= mix(1.0, 0.55 + 0.45 * dome, forest * far);                         // crowns hold snow on their tops
    snowK *= mix(1.0, 0.35 + 0.5 * smoothstep(0.35, 0.7, fA), forest * (1.0 - far));   // under the trees: patchy
    snowK *= 1.0 - bed;
    snowK = clamp(snowK * uSnow.x, 0.0, 1.0);
    vec3 snowC = vec3(0.84, 0.86, 0.9) * (0.94 + 0.06 * n01);
    // trodden / wet snow on the paths and at the water: greyer
    snowC = mix(snowC, vec3(0.55, 0.57, 0.6), path * 0.5 + wet * 0.4);
    c = mix(c, snowC, snowK);
  }
  tAlb = c;
  // ---- roughness / normal / AO
  tRough = mix(mix(0.92, 0.85, forest), 0.88, rock);
  tRough = mix(tRough, 0.7, path * (0.4 + 0.3 * uPath.w));
  tRough = mix(tRough, 0.35, wet);
  tRough = mix(tRough, 0.45, isStone * wet);
  tRough = mix(tRough, 0.75, snowK);
  // bump: tussocks and blades in the meadow / floor (finite differences of the value noise), within ~250 m
  tBump = vec3(0.0);
  float nearK = 1.0 - smoothstep(60.0, 260.0, camD);
  if (nearK > 0.01 && k50 > 0.01) {
    float e = max(fw * 0.8, 0.02);
    float gk = (1.0 - path) * (1.0 - bed) * (1.0 - snowK * 0.7) * mix(1.0, 0.5, forest);
    float hb0 = cgVnoise2(R2 * 2.1 + 1.3) * 0.05 * k50 + cgVnoise2(R * 9.0 + 5.9) * 0.015 * k12;
    float hbx = cgVnoise2((R2 + vec2(e, 0.0)) * 2.1 + 1.3) * 0.05 * k50 + cgVnoise2((R + vec2(e, 0.0)) * 9.0 + 5.9) * 0.015 * k12;
    float hbz = cgVnoise2((R2 + vec2(0.0, e)) * 2.1 + 1.3) * 0.05 * k50 + cgVnoise2((R + vec2(0.0, e)) * 9.0 + 5.9) * 0.015 * k12;
    vec2 g = vec2(hbx - hb0, hbz - hb0) / e * gk;
    tBump = vec3(-g.x, 0.0, -g.y) * nearK;
  }
  // slab joints, stone domes, revetment joints: screen-space derivatives of a height (cheap and sharp)
  float hS = slabH * path + stoneDome * 0.05 * isStone - revJ * 0.02 * revet - paveJ * 0.012 * pave * court
           + cdome * 0.04 * k50 * (1.0 - path) * (1.0 - bed) * (1.0 - court) * (1.0 - snowK * 0.6) * (1.0 - trod * 0.85);
  vec3 dpx = dFdx(P), dpy = dFdy(P);
  float dhx = dFdx(hS), dhy = dFdy(hS);
  vec3 r1 = cross(dpy, cgN), r2 = cross(cgN, dpx);
  float det = dot(dpx, r1);
  if (abs(det) > 1e-10) tBump += -(dhx * r1 + dhy * r2) / det * 0.6 * nearK;
  float bumpK = forest * resolved * far * uCanopy.y * (1.0 - rock);
  if (bumpK > 0.01) {
    float e = 0.18;
    float hx = tCrownH(cp + vec2(e, 0.0)) - tCrownH(cp - vec2(e, 0.0));
    float hz = tCrownH(cp + vec2(0.0, e)) - tCrownH(cp - vec2(0.0, e));
    tBump += vec3(-hx, 0.0, -hz) * 1.6 * bumpK * (1.0 - snowK * 0.5);
  }
  tAO = mix(1.0, mix(1.0, 0.45, gap), forest * resolved * far * uCanopy.z) * mix(1.0, 0.8, forest * far * (1.0 - resolved));
  tAO *= 1.0 - 0.5 * (joint * path + revJ * revet);
  tAO *= mix(1.0, 0.75 + 0.25 * n05, (1.0 - path) * k50 * (1.0 - snowK));
  diffuseColor.rgb = tAlb;
`;

export function terrainMaterial() {
  const mat = proceduralMaterial({
    name: 'terrain',
    params: { color: 0xffffff, roughness: 0.9, metalness: 0 },
    uniforms: TERRAIN_UNIFORMS,
    head: HEAD,
    color: COLOR,
    roughness: 'roughnessFactor = tRough;',
    normal: 'cgBump = tBump;',
    ao: 'cgAO = tAO;',
  });
  return mat;
}

/** set the season look of the ground ('spring' | 'summer' | 'autumn' | 'winter'), snow amount 0..1 */
export function setTerrainSeason(season, snow = season === 'winter' ? 1 : 0) {
  const w = { spring: [1, 0, 0, 0], summer: [0, 1, 0, 0], autumn: [0, 0, 1, 0], winter: [0, 0, 0, 1] }[season] || [1, 0, 0, 0];
  TERRAIN_UNIFORMS.uSeasonW.value.set(...w);
  TERRAIN_UNIFORMS.uSnow.value.x = snow;
}
