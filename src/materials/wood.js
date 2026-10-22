// Painted timber of the Song buildings (丹粉刷飾, 卷十四): 土朱 faces, white 緣道 on the lower edge of 栱 / 昂 / 方
// (材廣 / 8, 0.5–1 寸), 黃丹 undersides (昂栱下面及耍頭正面), 柱頭 / 柱腳 刷丹, 闌額 七朱八白; plus plain weathered
// timber (PLANK), lattice panels (LATTICE) and the 平棊 ceiling (CEILING).
//
// Weathering, all procedural: sun- and rain-faded lacquer on the exposed faces (pinkish grey), richer red kept
// under the eaves, flaking that bares grey wood (worst at the column feet and on the 椽 ends), grain through the
// worn paint, checks (cracks) along the columns, soot and dust in the occluded crevices (baked AO), splash grime
// at the column feet, rain streaks down vertical faces.
import { proceduralMaterial } from '../core/materials.js';
import { familyOptions, ATTR_F, HOOKS, INIT, K } from './common.js';

const WOOD_COLOR = /* glsl */`
  ${INIT}
  float kind = yzKind();
  float v = vPaint.y, hh = vPaint.z, u = vPaint.w;
  vec3 N = cgN;
  float ao = clamp(vAO.x, 0.0, 1.0), up = clamp(vAO.y, 0.0, 1.0);
  float nWide = cgVfbm3(cgP * 0.9 + cgSeed * 17.0, 3);
  float nMid = cgVnoise3(cgP * 3.1 + 11.0);
  float nFine = cgVnoise3(cgP * vec3(9.0, 2.5, 9.0) + cgSeed * 5.0);
  // grain: lines across the member, wavy along it (u runs along the member)
  vec3 T = yzTangentU(cgP, N, u);
  vec3 Bc = cross(N, T);
  float Bl = length(Bc);
  vec3 Bt = Bl > 1e-3 ? Bc / Bl : vec3(0.0);
  float across = dot(cgP, Bt);
  float gw = cgVnoise3(cgP * 0.6) * 5.0;
  float grain = 0.5 + 0.5 * sin(across * 70.0 + gw + cgVnoise3(cgP * vec3(0.4, 0.4, 0.4) + u * 0.8) * 9.0);
  grain = pow(grain, 3.0);
  // member-to-member variation (repainted at different times): a hash of the coarse position
  float mem = cgHash13(floor(cgP * 0.9 + 0.5) + cgSeed * 13.0);
  vec3 base = uZhu * (0.72 + 0.5 * nWide) * vec3(1.0 + 0.12 * (mem - 0.5), 0.92 + 0.16 * nMid, 0.9 + 0.12 * mem);
  float white = 0.0, dan = 0.0, huang = 0.0, plank = 0.0, lattice = 0.0, ceiling = 0.0, lu = 0.0, qing = 0.0;
  float band = 0.0; // the bracket band (members, 枓): less soot, more light — the refs' band reads lit and coloured
  if (yzIs(kind, ${K('MEMBER')})) {
    float side = 1.0 - step(0.55, abs(N.y));
    white = side * (1.0 - smoothstep(uWhiteLine * 0.85, uWhiteLine * 1.15, v));
    // 解綠: a green band along the upper edge of the side faces, alternating with blue member by member
    float edgeT = side * step(hh - hh * 0.28, v) * step(0.04, hh);
    float alt = step(0.5, cgHash13(floor(cgP * 1.7) + 3.0));
    lu = edgeT * (1.0 - alt); qing = edgeT * alt;
    huang = step(N.y, -0.55);
    band = 1.0;
  } else if (yzIs(kind, ${K('DOU')})) {
    // 枓: 石青 / 石綠 bodies (the refs' blue-green dots in the band), 黃丹 underneath
    float side = 1.0 - step(0.55, abs(N.y));
    float alt = step(0.5, cgHash13(floor(cgP * 2.3) + 9.0));
    qing = side * alt; lu = side * (1.0 - alt);
    huang = step(N.y, -0.55);
    band = 1.0;
  } else if (yzIs(kind, ${K('LANE')})) {
    // 七朱八白: eight white blocks in a band along the face, red between them and at both ends
    float vn = v / max(hh, 1e-3);
    float t = u * 8.0;
    float cell = fract(t);
    float inBand = step(uLaneBand.x, vn) * step(vn, uLaneBand.y) * step(0.12, cell) * step(cell, 0.88) * step(0.0, t) * step(t, 8.0);
    white = inBand * (1.0 - step(0.55, abs(N.y)));
    huang = step(N.y, -0.55);
  } else if (yzIs(kind, ${K('COLUMN')})) {
    dan = max(step(hh - hh * 0.07, v), 1.0 - step(hh * 0.035, v)); // 柱頭刷丹（柱腳同）
  } else if (yzIs(kind, ${K('DAN')})) {
    huang = 1.0;
  } else if (yzIs(kind, ${K('WOOD')})) {
    base = uZhu * vec3(0.8, 0.84, 0.88) * (0.88 + 0.22 * nWide);
  } else if (yzIs(kind, ${K('RAFTER')})) {
    base = uZhu * (0.82 + 0.28 * nWide);
  } else if (yzIs(kind, ${K('PLANK')})) {
    plank = 1.0;
  } else if (yzIs(kind, ${K('LATTICE')})) {
    lattice = 1.0;
  } else if (yzIs(kind, ${K('CEILING')})) {
    ceiling = 1.0;
  }
  vec3 c = base;
  c = mix(c, uDan * (0.9 + 0.18 * nWide), dan);
  c = mix(c, uHuangdan * (0.82 + 0.24 * nWide), huang);
  c = mix(c, uWhite * (0.86 + 0.12 * nFine), white);
  c = mix(c, uLu * (0.85 + 0.3 * nWide), lu);
  c = mix(c, uQing * (0.85 + 0.3 * nWide), qing);
  // ---- exposure: open to the sky and the weather vs. sheltered under the eaves
  float exposed = clamp(smoothstep(0.35, 0.95, up) * 0.7 + smoothstep(0.55, 0.95, ao) * 0.3, 0.0, 1.0);
  float w = uWeather;
  // sun / rain fading: the ochre turns a dull brown with a grey bloom; white lines turn ivory-grey
  float fade = clamp((0.2 + 0.8 * exposed) * smoothstep(0.2, 0.85, nWide + 0.3 * nFine), 0.0, 1.0) * w;
  float lum = dot(c, vec3(0.3, 0.59, 0.11));
  vec3 faded = mix(c, vec3(lum) * vec3(1.35, 1.0, 0.85) + vec3(0.01, 0.008, 0.007), 0.55);
  c = mix(c, faded, fade * 0.45);
  // flaking: patches of lacquer gone, bare silver-brown wood with grain
  float footZone = yzIs(kind, ${K('COLUMN')}) ? (1.0 - smoothstep(0.0, 0.9, v)) : 0.0;
  float endZone = yzIs(kind, ${K('RAFTER')}) ? 0.3 : 0.0;
  float fl = cgVnoise3(cgP * 5.0 + 3.0) * 0.6 + cgVnoise3(cgP * 17.0) * 0.25 + nFine * 0.15;
  float flake = smoothstep(0.78 - 0.25 * (exposed * 0.5 + footZone + endZone) * w, 0.84 - 0.25 * (exposed * 0.5 + footZone + endZone) * w, fl) * w;
  vec3 bare = vec3(0.11, 0.095, 0.08) * (0.7 + 0.55 * grain) * (0.8 + 0.4 * nMid);
  c = mix(c, bare, flake * 0.85);
  // older grey-green repaint showing in worn patches (a common sight on old timber halls)
  float under = smoothstep(0.7, 0.76, cgVnoise3(cgP * 2.2 + 31.0) * 0.8 + nFine * 0.2) * w * (1.0 - flake);
  c = mix(c, vec3(0.07, 0.075, 0.065) * (0.8 + 0.4 * nMid), under * 0.35);
  // grain showing through worn paint
  c *= 0.93 + 0.1 * grain * (0.4 + 0.6 * fade);
  // worn arrises: along the top and bottom edges of beams, bracket arms and boards the paint is rubbed thin and
  // the edge catches light (the eye reads this as 'real timber' long before any texture)
  if (hh > 0.02 && !yzIs(kind, ${K('COLUMN')}) && abs(N.y) < 0.55) {
    float ed = min(v, hh - v);
    float wornE = (1.0 - smoothstep(0.003, 0.018, ed)) * (0.5 + 0.5 * cgVnoise3(cgP * 11.0)) * w;
    c = mix(c, c * 1.35 + vec3(0.025, 0.02, 0.016), wornE * 0.6);
  }
  // checks (long cracks) on the columns
  float crack = 0.0;
  if (yzIs(kind, ${K('COLUMN')})) {
    float ang = atan(cgO.z, cgO.x);
    float cr = abs(fract(u * 2.7 + cgVnoise3(vec3(u * 3.0, v * 0.6, 0.0)) * 0.6) - 0.5);
    crack = (1.0 - smoothstep(0.004, 0.014, cr)) * smoothstep(0.35, 0.65, cgVnoise3(vec3(u * 9.0, v * 0.25, 7.0)));
    c *= 1.0 - 0.55 * crack;
    // vertical bands where the lacquer has worn thin (rain, hands), lighter and greyer
    float band = smoothstep(0.55, 0.8, cgVnoise3(vec3(u * 1.6, v * 0.08, 3.0))) * w;
    c = mix(c, c * vec3(1.3, 1.1, 1.0) + vec3(0.012, 0.01, 0.009), band * 0.45);
    // splash grime and damp at the foot
    c = mix(c, c * vec3(0.55, 0.55, 0.52) + vec3(0.012, 0.012, 0.01), footZone * (0.5 + 0.4 * nMid) * w);
  }
  // rain streaks down vertical faces of exposed members
  float vert = 1.0 - abs(N.y);
  float streak = smoothstep(0.55, 0.9, cgVnoise3(vec3(cgP.x * 7.0 + cgP.z * 7.0, cgP.y * 0.35, 0.0))) * vert * exposed * w;
  c *= 1.0 - 0.18 * streak;
  // soot / dust in the crevices (bracket clusters, under the eaves)
  float grime = (1.0 - smoothstep(0.12, 0.8, ao)) * (1.0 - 0.45 * band);
  c = mix(c, c * vec3(0.5, 0.47, 0.45), grime * 0.8);
  c = mix(c, vec3(0.05, 0.045, 0.04), grime * 0.15 * (0.5 + nMid));
  // dust settles on upward faces of sheltered members
  float dust = smoothstep(0.6, 0.95, N.y) * (1.0 - exposed) * w;
  c = mix(c, vec3(0.2, 0.18, 0.15), dust * 0.45);
  yzRough = mix(0.62, 0.9, clamp(fade + flake * 0.8 + dust, 0.0, 1.0));
  yzRough = mix(yzRough, 0.82, white);
  if (plank > 0.5) {
    // unpainted timber: silver-grey where weathered, brown where sheltered
    vec3 brown = vec3(0.16, 0.11, 0.07) * (0.8 + 0.4 * grain) * (0.85 + 0.3 * nWide);
    vec3 silver = vec3(0.2, 0.19, 0.17) * (0.75 + 0.45 * grain) * (0.85 + 0.3 * nWide);
    c = mix(brown, silver, exposed * w);
    c = mix(c, c * 0.55, grime * 0.7);
    c *= 1.0 - 0.4 * (1.0 - smoothstep(0.0, 0.03, abs(fract(u * 0.35 + nMid * 0.1) - 0.5) - 0.47));
    yzRough = 0.88;
  }
  if (lattice > 0.5) {
    // a 格眼 panel seen from afar: thin 土朱 bars over the dark room behind (lamplit at night)
    vec2 g = vec2(u, v) / 0.11;
    vec2 f = abs(fract(g) - 0.5);
    float bar = 1.0 - smoothstep(0.32, 0.4, min(f.x, f.y) < 0.12 ? 0.0 : 0.5);
    float lower = 1.0 - step(hh * 0.36, v);
    float solid = max(lower, step(hh * 0.36, v) * (1.0 - step(hh * 0.36 + 0.16, v)));
    vec3 room = vec3(0.012, 0.01, 0.009);
    float lit = step(0.3, cgHash12(floor(cgP.xz * 0.3) + 7.0)) * uNight;
    vec3 barC = uZhu * vec3(0.8, 0.84, 0.88) * (0.9 + 0.2 * nWide);
    float isBar = max(solid, step(min(f.x, f.y), 0.09));
    c = mix(room, barC, isBar);
    yzEmit = (1.0 - isBar) * uGlowColor * uGlow * 0.6 * lit;
    yzRough = 0.75;
  }
  if (ceiling > 0.5) {
    // 平棊: square panels in dark-green / red frames
    vec2 g = vUV2 / 0.45;
    vec2 f = abs(fract(g) - 0.5);
    float frame = step(0.42, max(f.x, f.y));
    c = mix(vec3(0.05, 0.075, 0.06) * (0.8 + 0.4 * nWide), uZhu * 0.8, frame);
    c *= 0.7 + 0.3 * ao;
    yzRough = 0.8;
  }
  yzAO = mix(0.12 + 0.2 * band, 1.0, pow(ao, 0.8));
  // bump: grain ridges (on bare / faded wood) and cracks
  float gb = (pow(0.5 + 0.5 * sin((across + 0.004) * 70.0 + gw), 3.0) - grain) * (0.25 + 0.75 * flake + fade * 0.3);
  yzBump = Bt * (gb * 0.08 - crack * 0.2);
  if (any(isnan(yzBump)) || any(isinf(yzBump))) yzBump = vec3(0.0);
  yzApplySnow(c, cgP, N, up);
  diffuseColor.rgb = c;
`;

export function woodMaterial() {
  const o = familyOptions('yzWood');
  return proceduralMaterial({ ...o, head: ATTR_F, color: WOOD_COLOR, roughness: HOOKS.roughness, ao: HOOKS.ao, normal: HOOKS.normal, emissive: HOOKS.emissive });
}
