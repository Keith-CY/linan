// Lighter rock shading for the walking painting: the 飞来峰 cliff and the stones (src/karst/material.js karstMaterial)
// cost ~9 ms of a 1440×900 frame under the cliff (some forty simplex lookups a pixel: pits, joint networks, lichen
// dots, crusts, six-octave relief), detail the ink painting does not draw while walking. The lite shader keeps what
// the painting reads: the macro tone (cream / grey / warm patches, the tuff palette), the carved surfaces lighter, the
// 斧劈 facet tilts (light on the form), bedding bands, rain streaks, crevices from the baked aRock, moss on ledges,
// the waterline and snow — about a dozen lookups. It shares the original's uniforms (seasons, snow and tint follow),
// its name (the ink class: rock, figure and niche from the carved mask) and its geometry; the still view puts the
// originals back (src/explore/still.js), so a still is unchanged.
//
//   const R = new RockLite(engine)   collect the karst / rocks meshes (after the build)
//   R.live()                         the lite shaders (walking)       R.still()   the originals (still view)
import { proceduralMaterial } from '../core/materials.js';
import { patchInkMaterial, CLS } from '../ink/gbuffer.js';

const LITE_GLSL = /* glsl */ `
vec3 kAlb; float kRgh; float kHgt; float kAO; vec3 kFN;
vec3 kBumpNormal(vec3 p, vec3 n, float h) {
  vec3 dpdx = dFdx(p), dpdy = dFdy(p);
  float dhdx = dFdx(h), dhdy = dFdy(h);
  vec3 r1 = cross(dpdy, n), r2 = cross(n, dpdx);
  float det = dot(dpdx, r1);
  vec3 g = sign(det) * (dhdx * r1 + dhdy * r2);
  return normalize(abs(det) * n - g);
}
// R = aRock (ao, cavity, carved, open); A = (scale, moss, lichen, streaks); B = (strata, wetBelow, bump, carvedSmooth)
// C = (variation, ochre, darkness, snow); D = (tuff, autumn, -, -)   (as src/karst/material.js kShade)
void kShadeLite(vec3 p, vec3 n, float seed, vec4 R, vec4 A, vec4 B, vec4 C, vec4 D) {
  float sc = A.x;
  vec3 q = p * sc;
  kFN = n;
  float fp = max(length(fwidth(p)) * sc, 1e-4);
  float vert = 1.0 - abs(n.y);
  float upw = clamp(n.y, 0.0, 1.0);
  float carved = R.z * B.w;
  float open = R.w;
  float cav = R.y;
  // macro colour (the original's fbm reduced to their first octaves, as the walking K_ONE had them)
  float m1 = (0.5 * cgSnoise(q * 0.043 + seed * 13.1) + 0.25 * cgSnoise(q * 0.089 + seed * 13.1 + vec3(3.71, 1.37, 5.13))) / 0.75;
  float m2 = cgSnoise(q * 0.16 + vec3(11.0, 3.0, 7.0));
  float m3 = cgSnoise(q * 0.55 + 2.0);
  float m4 = cgSnoise(q * 0.09 + vec3(31.0, 7.0, 19.0));
  vec3 cream = vec3(0.46, 0.45, 0.42), grey = vec3(0.355, 0.352, 0.345), warm = vec3(0.44, 0.36, 0.26);
  cream = mix(cream, vec3(0.27, 0.16, 0.11), D.x); grey = mix(grey, vec3(0.19, 0.12, 0.085), D.x); warm = mix(warm, vec3(0.30, 0.15, 0.08), D.x);
  vec3 c = mix(cream, grey, smoothstep(-0.4, 0.5, m1));
  c = mix(c, warm, smoothstep(0.25, 0.75, m2) * C.y * (0.35 + 0.65 * vert));
  c = mix(c, c * 0.6, smoothstep(0.20, 0.75, m4) * 0.38 * (1.0 - carved));
  c = mix(c, mix(vec3(0.50, 0.488, 0.458), vec3(0.33, 0.21, 0.15), D.x), smoothstep(0.35, 0.7, -m4 + 0.4 * m3) * 0.45 * (1.0 - 0.6 * carved));
  c *= 1.0 + 0.08 * m3;
  c *= 1.0 + (seed - 0.5) * C.x;
  // relief: two octaves
  float amp = 0.15 * B.z / sc * (1.0 - 0.75 * carved);
  float h = amp * (0.5 * cgSnoise(q * 0.55) + 0.32 * cgSnoise(q * 1.1385 + vec3(3.71, 1.37, 5.13)) * (1.0 - smoothstep(0.18, 0.5, fp * 1.43))) / 0.82;
  // bedding grooves + banding on steep natural faces
  float yb = q.y * 0.9 + 1.6 * cgSnoise(vec3(q.xz * 0.05, 3.3));
  float bedLine = abs(fract(yb * 0.5) - 0.5) * 2.0;
  float groove = (1.0 - smoothstep(0.0, 0.10, bedLine)) * B.x * vert * (1.0 - smoothstep(0.0, 0.5, fp * 0.5)) * (1.0 - carved);
  h -= groove * 0.05 / sc * (1.0 - smoothstep(0.015, 0.05, fp));
  c *= mix(1.0, 0.88 + 0.22 * smoothstep(-0.6, 0.6, m2 * 0.7 + 0.3 * sin(yb * 0.35)), B.x * vert * (1.0 - carved));
  // fracture facets: one cell (the walking original's K_ONE already searched no neighbours)
  float facW = (1.0 - carved) * (1.0 - smoothstep(0.12, 0.45, fp * 0.55));
  if (facW > 0.0) {
    vec3 fq = q * vec3(0.55, 0.30, 0.55);
    vec3 fpos = floor(fq) + cgHash33(floor(fq));
    vec3 tilt = (cgHash33(fpos * 7.13 + 1.7) - 0.5) * vec3(1.0, 0.5, 1.0);
    kFN = normalize(kFN + (tilt - kFN * dot(tilt, kFN)) * 0.42 * facW);
    c *= 1.0 + (cgHash13(floor(fq)) - 0.5) * 0.22 * facW;
  }
  // carved surfaces: lighter, top surfaces lightest
  c = mix(c, c * mix(vec3(1.45, 1.41, 1.33), vec3(1.7, 1.65, 1.55), upw), carved);
  // rain streaks on steep faces that take the water
  float sk = cgSnoise(vec3(q.x * 0.55, q.y * 0.022, q.z * 0.55));
  float wetFace = smoothstep(0.25, 0.8, vert) * (0.35 + 0.65 * open);
  float streak = smoothstep(0.1, 0.6, sk) * A.w * wetFace;
  c = mix(c, c * mix(vec3(0.5, 0.5, 0.48), vec3(0.34, 0.35, 0.32), carved), streak * 0.8);
  // crevices (baked cavity)
  float cv = clamp(cav, 0.0, 1.0);
  c *= 1.0 - 0.55 * cv * cv - 0.15 * cv;
  c = mix(c, vec3(0.06, 0.055, 0.04), cv * cv * 0.35);
  // lichen colonies and crusts as broad patches
  float lich = cgSnoise(q * 0.35 + 4.0);
  float lichMask = smoothstep(0.05, 0.6, 0.6 * lich + 0.3 * upw) * (0.4 + 0.6 * open);
  float colony = smoothstep(0.3, 0.7, cgSnoise(q * 1.15 + 7.0)) * lichMask;
  c = mix(c, vec3(0.13, 0.14, 0.115), colony * 0.5 * A.z * 0.5 * (1.0 - 0.9 * carved));
  c = mix(c, mix(vec3(0.60, 0.595, 0.565), vec3(0.42, 0.33, 0.28), D.x), smoothstep(0.25, 0.65, -lich) * (1.0 - colony) * A.z * 0.4 * (1.0 - 0.6 * carved));
  // moss on ledges, in crevices and on damp faces
  float mossN = cgSnoise(q * 0.4 + 21.0) * 0.6;
  float moss = smoothstep(0.25, 0.75, upw * 0.95 + cv * 0.55 + 0.45 * mossN - 0.2 * carved) * A.y * (0.55 + 0.45 * open);
  vec3 mossC = mix(vec3(0.07, 0.09, 0.028), vec3(0.17, 0.17, 0.055), smoothstep(-0.3, 0.6, mossN));
  mossC = mix(mossC, vec3(0.20, 0.17, 0.06), D.y * 0.5);
  c = mix(c, mossC, moss * 0.88);
  h += moss * 0.012 / sc;
  // wetness at the waterline
  float wet = 1.0 - smoothstep(B.y - 0.05, B.y + 0.35, p.y + 0.12 * m3);
  c = mix(c, c * vec3(0.42, 0.44, 0.42), wet);
  c = mix(c, vec3(0.05, 0.07, 0.035), wet * smoothstep(B.y - 0.3, B.y + 0.1, p.y) * 0.45);
  // snow on the up-facing surfaces (winter)
  float snow = smoothstep(0.35, 0.7, n.y + 0.25 * 0.5 * cgSnoise(q * 1.7 + 4.0)) * C.w * (0.4 + 0.6 * open);
  c = mix(c, vec3(0.84, 0.86, 0.9), snow);
  h += snow * 0.03 / sc;
  c *= 1.0 - C.z;
  kAlb = max(c, vec3(0.0));
  kRgh = mix(mix(0.86 + 0.08 * m3, 0.3, wet), 0.75, snow) - 0.05 * carved;
  kHgt = h;
  kAO = R.x * R.x * (1.0 - 0.6 * cv) * (1.0 - 0.2 * moss * upw);
}
`;

/** the lite twin of one karst material (same uniforms, name, side and roughness) */
const LITE = new WeakMap();
function liteOf(engine, mat) {
  if (LITE.has(mat)) return LITE.get(mat);
  const U = mat.userData.karst;
  const lite = proceduralMaterial({
    name: mat.name,
    params: { color: 0xffffff, roughness: mat.roughness, metalness: 0, side: mat.side },
    uniforms: { uKTint: U.uKTint, uKA: U.uKA, uKB: U.uKB, uKC: U.uKC, uKD: U.uKD },
    vertexHead: 'attribute vec4 aRock;\nvarying vec4 vKRock;\n',
    vertexPre: 'vKRock = aRock;',
    head: 'uniform vec3 uKTint;\nuniform vec4 uKA, uKB, uKC, uKD;\nvarying vec4 vKRock;\n' + LITE_GLSL,
    color: 'kShadeLite(cgP, cgN, cgSeed, vKRock, uKA, uKB, uKC, uKD);\ndiffuseColor.rgb = kAlb * uKTint * diffuseColor.rgb;\ncgAO = kAO;',
    roughness: 'roughnessFactor = clamp(kRgh * roughnessFactor / 0.88, 0.05, 1.0);',
    normal: 'cgBump = kBumpNormal(cgP, kFN, kHgt) - cgN;',
    ao: '/* cgAO set in the colour hook */',
  });
  lite.userData.karst = U;
  engine.patchMaterial(lite);
  if (engine.ink) patchInkMaterial(lite, CLS.ROCK);
  LITE.set(mat, lite);
  return lite;
}

export class RockLite {
  constructor(engine) {
    this.engine = engine;
    this.pairs = [];        // [mesh, original, lite]
    const roots = [...(engine.moduleRoots?.karst || []), ...(engine.moduleRoots?.rocks || [])];
    const seen = new Set();
    for (const r of roots) r.traverse((o) => {
      if (!o.isMesh || seen.has(o) || Array.isArray(o.material) || !o.material?.userData?.karst) return;
      seen.add(o);
      this.pairs.push([o, o.material, liteOf(engine, o.material)]);
    });
    this.on = false;
    console.log(`[explore] rock lite: ${this.pairs.length} meshes, ${new Set(this.pairs.map((p) => p[1])).size} materials`);
  }
  live() { for (const [o, , l] of this.pairs) o.material = l; this.on = true; }
  still() { for (const [o, m] of this.pairs) o.material = m; this.on = false; }
}
