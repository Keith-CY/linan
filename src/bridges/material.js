// Weathered grey stone of the arch bridges, canal embankments and quays.
//
// Same vertex attributes as the yingzao MeshBuilder (src/yingzao/geom.js): aPaint = (kind, wl, extra, 0) where
// wl = height above the structure's own water level (m, local, so a bridge on the 冷泉 stream weathers like one on
// the lake), aUV = metric surface coordinates per kind (see BK), aAO = (ao, sky-up) baked by yingzao/ao.js.
// Shares the building uniforms (src/materials/common.js YZ): snow (uSnow), age (uWeather), night.
//
// Kinds (BK):
//   ASHLAR  spandrel faces: coursed granite ashlar, aUV = (along, up) m
//   RING    券臉 voussoir ring: aUV = (voussoir index coordinate, radial m) — a joint at every integer
//   VAULT   intrados: aUV = (arc m, across m), courses across the barrel
//   CURB    deck-edge band (金邊 / 仰天石): long stones, aUV = (along, up)
//   DECK    deck slabs (transverse), aUV = (across m, along m)
//   TREAD / RISER  steps on the ramps, aUV = (across, along) / (across, up)
//   RAIL    勾闌 white stone (posts, sill, handrail, supports); PANEL 華版 face, aUV = (u 0..len, v 0..h) m
//   WALL    embankment / quay / abutment walls: rougher ashlar, more algae; COPING  their top stones
//   PAVE    street / quay paving slabs, aUV = world xz
// Weathering: wet dark band and green-black algae at the waterline, a pale tide line above it, lime bloom running
// out of the joints under the arch, rain streaks down from the curb, moss in the shaded joints (north faces),
// lichen on the open tops, polished treads in the middle of the deck, soot / dirt in the occluded corners.
import { proceduralMaterial } from '../core/materials.js';
import { familyOptions, ATTR_F, HOOKS, INIT } from '../materials/common.js';

export const BK = { ASHLAR: 40, RING: 41, VAULT: 42, CURB: 43, DECK: 44, TREAD: 45, RISER: 46, RAIL: 47, PANEL: 48, WALL: 49, COPING: 50, PAVE: 51 };
const K = (n) => BK[n].toFixed(1);

const HEAD = /* glsl */`
${ATTR_F}
vec2 brLocal; // block-local coordinates of the last brCourses call (-0.5 … 0.5), for the pillowed stone faces
// coursed ashlar: rows of height ~size.y (some courses split in two thin ones), block length ~size.x (varied per
// row), returns (joint, blockHash, edge, fw)
vec4 brCourses(vec2 uv, vec2 size, float jw) {
  vec2 q = uv / size;
  float row = floor(q.y);
  float split = step(0.78, cgHash11(row * 1.91 + 0.7));
  float fy = fract(q.y);
  float sub = split * step(0.5, fy);
  if (split > 0.5) { fy = fract(fy * 2.0); row = row * 2.0 + sub + 1000.0; }
  float rl = 0.65 + 0.75 * cgHash11(row * 3.7 + 1.3);
  float qx = q.x / rl + cgHash11(row * 7.1 + 0.3);
  vec2 cell = vec2(floor(qx), row);
  vec2 g = abs(vec2(fract(qx), fy) - 0.5);
  float sy = size.y * (split > 0.5 ? 0.5 : 1.0);
  float fw = max(fwidth(q.x), fwidth(q.y)) * (split > 0.5 ? 2.0 : 1.0);
  float jx = jw / (size.x * rl), jy = jw / sy;
  float joint = max(smoothstep(0.5 - jx - fw, 0.5 - jx * 0.3, g.x), smoothstep(0.5 - jy - fw, 0.5 - jy * 0.3, g.y));
  float detail = 1.0 - smoothstep(0.08, 0.35, fw);
  float h = mix(0.5, cgHash12(cell + 3.1), detail);
  float edge = smoothstep(0.34, 0.48, max(g.x, g.y)) * (1.0 - joint);
  brLocal = vec2(fract(qx), fy) - 0.5;
  return vec4(joint * mix(0.3, 1.0, detail), h, edge, fw);
}
`;

const COLOR = /* glsl */`
  ${INIT}
  brLocal = vec2(0.0);
  float kind = yzKind();
  float wl = vPaint.y;                       // height above the local water (m)
  float ao = clamp(vAO.x, 0.0, 1.0), up = clamp(vAO.y, 0.0, 1.0);
  vec3 N = cgN;
  // the treads and slabs of a deck are open to the sky (their corners touch the next riser: the baked up is low)
  if (yzIs(kind, ${K('DECK')}) || yzIs(kind, ${K('TREAD')}) || yzIs(kind, ${K('PAVE')}) || yzIs(kind, ${K('COPING')})) up = max(up, 0.92);
  if (yzIs(kind, ${K('RAIL')}) && N.y > 0.5) up = max(up, 0.85);
  float n = cgVfbm3(cgP * 0.9, 4), f = cgVnoise3(cgP * 23.0), mm = cgVnoise3(cgP * 3.7 + 5.0);
  bool rail = yzIs(kind, ${K('RAIL')}) || yzIs(kind, ${K('PANEL')});
  bool wall = yzIs(kind, ${K('WALL')}) || yzIs(kind, ${K('COPING')});
  bool deck = yzIs(kind, ${K('DECK')}) || yzIs(kind, ${K('TREAD')}) || yzIs(kind, ${K('PAVE')});
  vec4 b = vec4(0.0, 0.5, 0.0, 0.0);
  if (yzIs(kind, ${K('ASHLAR')})) b = brCourses(vUV2, vec2(1.45, 0.62), 0.016);
  else if (wall) b = brCourses(vUV2, vec2(1.0, 0.42), 0.022);
  else if (yzIs(kind, ${K('CURB')})) b = brCourses(vUV2, vec2(1.9, 10.0), 0.012);
  else if (yzIs(kind, ${K('VAULT')})) b = brCourses(vUV2.yx, vec2(1.1, 0.52), 0.016);
  else if (yzIs(kind, ${K('DECK')}) || yzIs(kind, ${K('PAVE')})) b = brCourses(vUV2, vec2(1.6, 0.62), 0.014);
  else if (yzIs(kind, ${K('TREAD')}) || yzIs(kind, ${K('RISER')})) b = brCourses(vUV2, vec2(1.3, 10.0), 0.01);
  else if (yzIs(kind, ${K('RING')})) {
    // voussoirs: a radial joint at every integer of vUV2.x, the outer edge of the ring
    float q = vUV2.x;
    float fw = fwidth(q);
    float g = abs(fract(q) - 0.5);
    float joint = smoothstep(0.5 - 0.035 - fw, 0.5 - 0.01, g);
    float detail = 1.0 - smoothstep(0.08, 0.35, fw);
    b = vec4(joint * mix(0.3, 1.0, detail), mix(0.5, cgHash11(floor(q) * 5.3 + 2.0), detail), smoothstep(0.36, 0.48, g), fw);
  }
  float joint = b.x, bh = b.y, edge = b.z;
  // ---- base stone: grey granite, slightly green, every block its own tone
  vec3 c = vec3(0.245, 0.243, 0.228) * (0.74 + 0.4 * n + 0.07 * f) * (0.72 + 0.5 * bh);
  // a few blocks of another quarry (warmer, browner) and some darker, iron-rich ones
  float other = step(0.9, cgHash11(bh * 37.0 + 1.0));
  c = mix(c, c * vec3(1.18, 1.05, 0.86), other);
  c *= 1.0 - 0.25 * step(0.93, cgHash11(bh * 71.0 + 5.0));
  c *= vec3(1.0 + 0.07 * (cgHash11(bh * 91.0) - 0.5), 1.0, 1.0 - 0.07 * (cgHash11(bh * 53.0) - 0.5));
  if (yzIs(kind, ${K('RING')})) c *= 1.06;
  bool vault = yzIs(kind, ${K('VAULT')});
  // the soffit: iron-stained, warmer stone (water and lime have run through it for centuries)
  if (vault) c *= vec3(1.12, 0.98, 0.8) * (0.85 + 0.3 * cgVnoise3(cgP * vec3(0.6, 2.5, 0.6)));
  if (rail) {
    // 勾闌 in a finer, paler stone (青白石), dust in the carving
    c = vec3(0.47, 0.465, 0.44) * (0.86 + 0.18 * n + 0.05 * f);
    if (yzIs(kind, ${K('PANEL')})) {
      vec2 pv = vUV2;
      float len = max(vPaint.z, 0.1);
      float dx = min(pv.x, len - pv.x), dy = min(pv.y, 0.42 - pv.y);
      float frame = 1.0 - smoothstep(0.05, 0.075, min(dx, dy));
      float groove = smoothstep(0.055, 0.065, min(dx, dy)) * (1.0 - smoothstep(0.075, 0.09, min(dx, dy)));
      c *= 1.0 - 0.32 * groove;
      c *= 1.0 + 0.05 * frame;
    }
  }
  if (wall) c *= vec3(0.95, 0.97, 0.94);
  if (deck) c *= 1.06;
  // street and quay paving: pale granite, polished by feet and cart wheels
  if (yzIs(kind, ${K('PAVE')})) c *= vec3(1.3, 1.27, 1.22);
  c = mix(c, vec3(0.13, 0.125, 0.115) * (0.8 + 0.4 * f), joint * (rail ? 0.25 : 0.45));
  c *= 1.0 + 0.1 * edge * (f - 0.35);
  float w = uWeather;
  // ---- deck wear: polished, paler path in the middle of the treads, grime at the edges
  if (deck) {
    float mid = 1.0 - smoothstep(0.6, 2.6, abs(vUV2.x));
    c = mix(c, c * 1.18 + vec3(0.02), mid * 0.5 * (1.0 - joint));
    yzRough = mix(0.78, 0.55, mid);
  } else yzRough = rail ? 0.72 : 0.86;
  // ---- water: wet foot, algae band, tide line, below the surface dark and slimy
  float tide = 0.42 + 0.28 * n + 0.1 * mm;
  float wet = 1.0 - smoothstep(tide - 0.05, tide + 0.08, wl);
  float algae = wet * smoothstep(0.35, 0.7, cgVnoise3(cgP * vec3(2.2, 5.0, 2.2)) * 0.7 + joint * 0.35 + n * 0.25);
  c = mix(c, c * 0.5, wet * 0.85);
  c = mix(c, vec3(0.035, 0.05, 0.028) * (0.8 + 0.5 * f), algae * 0.8);
  float tline = smoothstep(tide + 0.02, tide + 0.09, wl) * (1.0 - smoothstep(tide + 0.12, tide + 0.35, wl));
  c = mix(c, c * 1.12 + vec3(0.025, 0.024, 0.02), tline * 0.5 * (1.0 - abs(N.y)));
  yzRough = mix(yzRough, 0.38, wet * 0.8);
  if (wl < 0.0) c = mix(c, vec3(0.03, 0.04, 0.03), smoothstep(0.0, -0.4, wl) * 0.8);
  float vert = 1.0 - abs(N.y);
  // ---- lime bloom out of the joints (under the arch and below the curb), rain streaks down the faces
  float bloomZone = (yzIs(kind, ${K('VAULT')}) ? 1.0 : 0.0) + (yzIs(kind, ${K('RING')}) ? 0.6 : 0.0);
  float bloom = smoothstep(0.55, 0.85, cgVnoise3(vec3(cgP.x * 1.7 + cgP.z * 1.7, cgP.y * 0.35, 4.0))) * bloomZone * w;
  c = mix(c, vec3(0.5, 0.5, 0.47), bloom * 0.35 * (0.5 + 0.5 * joint));
  // rain and soot streaks down the faces (long, from the deck edge), and the face darkens toward the water
  float sk = cgVnoise3(vec3(cgP.x * 3.2 + cgP.z * 3.2, cgP.y * 0.18, 1.0)) * 0.7 + cgVnoise3(vec3(cgP.x * 11.0 + cgP.z * 11.0, cgP.y * 0.5, 4.0)) * 0.3;
  float streak = smoothstep(0.5, 0.8, sk) * vert * w;
  bool face = yzIs(kind, ${K('ASHLAR')}) || wall || yzIs(kind, ${K('RING')});
  c *= 1.0 - 0.42 * streak * (face ? 1.0 : 0.4);
  if (face) c *= mix(0.72, 1.0, smoothstep(0.0, 3.5, wl)) * (0.88 + 0.12 * smoothstep(0.3, 0.7, cgVfbm3(cgP * 0.25, 3)));
  // ---- moss and lichen: moss in the joints of the shaded (north, occluded) faces, lichen on the open tops
  float north = clamp(-N.z, 0.0, 1.0) * 0.4 + (1.0 - ao) * 0.6;
  float moss = smoothstep(0.55, 0.82, cgVnoise3(cgP * 2.6 + 3.0) * 0.6 + joint * 0.45 + north * 0.35 + (1.0 - smoothstep(0.0, 2.5, wl)) * 0.25) * w;
  c = mix(c, vec3(0.05, 0.075, 0.03) * (0.8 + 0.5 * f), moss * (rail ? 0.25 : 0.55));
  float lichen = smoothstep(0.76, 0.86, cgVnoise3(cgP * 7.0 + 9.0) * 0.75 + f * 0.25) * smoothstep(0.3, 0.9, up) * w;
  c = mix(c, vec3(0.44, 0.43, 0.37), lichen * 0.4);
  // ---- dirt where the air is still, dust on sheltered tops
  float grime = 1.0 - smoothstep(0.25, 0.9, ao);
  c = mix(c, c * 0.5, grime * 0.6);
  float topF = smoothstep(0.75, 0.95, N.y);
  c = mix(c, vec3(0.3, 0.28, 0.24), topF * (1.0 - up) * 0.4 * w);
  yzAO = mix(0.55, 1.0, 1.0 - joint) * mix(0.35, 1.0, ao);
  yzBump = (vec3(cgVnoise3(cgP * 14.0), cgVnoise3(cgP * 14.0 + 3.0), cgVnoise3(cgP * 14.0 + 9.0)) - 0.5) * (deck ? 0.05 : 0.09);
  if (!rail && !yzIs(kind, ${K('RING')}) && b.w < 0.25) {
    // pillowed blocks: the face rounds off toward the joints (tangents from the uv derivatives)
    vec3 Tu = yzTangentU(cgP, N, vUV2.x), Tv = yzTangentU(cgP, N, vUV2.y);
    if (yzIs(kind, ${K('VAULT')})) { vec3 t = Tu; Tu = Tv; Tv = t; }
    vec2 e = sign(brLocal) * smoothstep(0.28, 0.5, abs(brLocal));
    yzBump += (Tu * e.x + Tv * e.y) * 0.22 * (1.0 - joint);
  }
  yzApplySnow(c, cgP, N, up);
  // light thrown up from the sunlit water / ice onto the soffit and the lower faces (no GI in the renderer)
  float sunUp = clamp(uSunDir.y * 2.5, 0.0, 1.0) * (1.0 - uNight);
  float bounceZone = vault ? 1.0 : (1.0 - smoothstep(0.0, 2.5, wl)) * 0.4 * smoothstep(0.0, 0.3, -N.y + 0.3);
  yzEmit = c * uSunColor * sunUp * 0.45 * bounceZone * (1.0 - smoothstep(0.5, 6.0, wl) * 0.5);
  diffuseColor.rgb = c;
`;

let cache = null;
/** the shared bridge / quay stone material */
export function bridgeStoneMaterial() {
  if (cache) return cache;
  const o = familyOptions('brStone');
  cache = proceduralMaterial({ ...o, head: HEAD, color: COLOR, roughness: HOOKS.roughness, ao: HOOKS.ao, normal: HOOKS.normal, emissive: HOOKS.emissive });
  return cache;
}

// ------------------------------------------------------------------------------------------------ snow layer
// Fresh snow lying on the deck, the rails and the edges (ref10): bright, faintly blue in shade, a crust of sparkle,
// thinning to wet grey slush at its margins, melted through in patches where the stone shows (discarded).
// aPaint.y = how far from the edge of the layer (0 margin … 1 inside), aUV = world-ish coordinates for the patches.
let snowCache = null;
export function snowMaterial() {
  if (snowCache) return snowCache;
  snowCache = proceduralMaterial({
    name: 'bridgeSnow', params: { color: 0xffffff, roughness: 0.75, metalness: 0 },
    vertexHead: 'attribute vec4 aPaint; varying vec4 vSnowP;', vertexPre: 'vSnowP = aPaint;',
    head: 'varying vec4 vSnowP;',
    color: /* glsl */`
      float n = cgVfbm3(cgP * 0.9, 4) * 0.65 + cgVnoise3(cgP * 4.0) * 0.35;
      float inner = clamp(vSnowP.y, 0.0, 1.0);
      // melted through where the noise is low, more at the margins and on the steep ramps
      float melt = 0.42 - 0.22 * inner + vSnowP.z * 0.18;
      if (n < melt) discard;
      float edge = smoothstep(melt, melt + 0.08, n);
      vec3 snow = vec3(0.84, 0.86, 0.9) * (0.94 + 0.08 * cgVnoise3(cgP * 11.0));
      vec3 slush = vec3(0.36, 0.37, 0.38);
      diffuseColor.rgb = mix(slush, snow, edge);`,
    roughness: 'roughnessFactor = 0.72;',
  });
  return snowCache;
}
