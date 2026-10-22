// Boat materials: oiled / tarred plank hulls with a waterline stain and weed below it, deck planks, black 烏篷 bamboo
// mats, brown battened lug sails, plain weathered timber, faded red lacquer (畫舫 cabin), paper lattice windows (lit
// at night), rope. Same attribute conventions as the yingzao MeshBuilder: aPaint = (kind, wl, extra, 0) with wl the
// height above the boat's waterline (m, local), aUV per kind (see BOAT_K), aAO = (ao, up).
import { proceduralMaterial } from '../core/materials.js';
import { familyOptions, ATTR_F, HOOKS, INIT } from '../materials/common.js';

export const BOAT_K = { HULL: 60, DECK: 61, MAT: 62, SAIL: 63, WOOD: 64, LACQUER: 65, ROPE: 66, LATTICE: 67, TILE: 68, CLOTH: 69, CARGO: 70 };
const K = (n) => BOAT_K[n].toFixed(1);

const COLOR = /* glsl */`
  ${INIT}
  float kind = yzKind();
  float wl = vPaint.y;
  float ao = clamp(vAO.x, 0.0, 1.0), up = clamp(vAO.y, 0.0, 1.0);
  vec3 N = cgN;
  float n = cgVfbm3(cgP * 1.3 + cgSeed * 13.0, 4), f = cgVnoise3(cgP * 19.0), mm = cgVnoise3(cgP * 4.0 + 3.0);
  float tone = fract(vPaint.z + cgSeed * 0.61);  // per-boat tone (0..1), varied per instance
  vec3 c = vec3(0.2);
  yzRough = 0.8;
  if (yzIs(kind, ${K('HULL')}) || yzIs(kind, ${K('DECK')}) || yzIs(kind, ${K('WOOD')})) {
    // planks: strakes along the hull (vUV2.y = girth or across, vUV2.x = along)
    float pw = yzIs(kind, ${K('WOOD')}) ? 0.12 : 0.22;
    float q = vUV2.y / pw;
    float plank = floor(q);
    float fw = fwidth(q);
    float seam = 1.0 - smoothstep(0.0, 0.06 + fw, min(fract(q), 1.0 - fract(q)));
    // butt joints every few metres along each strake
    float bl = 2.6 + 2.0 * cgHash11(plank * 3.1);
    float qb = vUV2.x / bl + cgHash11(plank * 7.7);
    float butt = 1.0 - smoothstep(0.0, 0.012 / bl + fwidth(qb), min(fract(qb), 1.0 - fract(qb)));
    float ph = cgHash12(vec2(plank, floor(qb)));
    float grain = 0.5 + 0.5 * sin(vUV2.x * 9.0 + cgVnoise3(cgP * vec3(0.5, 6.0, 0.5)) * 6.0);
    // oiled timber: warm dark brown, tarred darker on the hull, greyer where sun-bleached
    vec3 oiled = vec3(0.105, 0.07, 0.045) * (0.75 + 0.5 * ph) * (0.85 + 0.25 * grain);
    vec3 tar = vec3(0.03, 0.027, 0.024) * (0.85 + 0.3 * ph);
    vec3 grey = vec3(0.17, 0.155, 0.135) * (0.8 + 0.4 * ph) * (0.85 + 0.2 * grain);
    float bleach = smoothstep(0.35, 0.95, up) * (0.4 + 0.4 * n);
    c = mix(oiled, grey, bleach * (yzIs(kind, ${K('DECK')}) ? 0.8 : 0.5));
    if (yzIs(kind, ${K('HULL')})) c = mix(c, tar, smoothstep(0.35, 0.65, tone) * (1.0 - smoothstep(0.3, 0.8, wl)) * 0.8 + 0.25 * tone);
    c *= 1.0 - 0.55 * seam - 0.4 * butt;
    yzRough = mix(0.55, 0.85, bleach);
    // water: a dark wet band and green-brown weed up to the waterline, a scum line just above it
    float wetLine = 0.08 + 0.06 * n;
    float below = 1.0 - smoothstep(wetLine - 0.04, wetLine + 0.03, wl);
    c = mix(c, vec3(0.03, 0.04, 0.025) * (0.8 + 0.5 * f), below * 0.85);
    float scum = smoothstep(wetLine, wetLine + 0.03, wl) * (1.0 - smoothstep(wetLine + 0.05, wetLine + 0.2 + 0.1 * mm, wl));
    c = mix(c, vec3(0.16, 0.15, 0.12), scum * 0.45 * (yzIs(kind, ${K('HULL')}) ? 1.0 : 0.0));
    // drips and stains running down the sides
    float streak = smoothstep(0.6, 0.9, cgVnoise3(vec3(vUV2.x * 3.0, wl * 0.6, 2.0))) * (1.0 - abs(N.y));
    c *= 1.0 - 0.25 * streak;
  } else if (yzIs(kind, ${K('MAT')})) {
    // 烏篷: woven bamboo mats, blackened with soot-oil; the weave diagonal
    vec2 w = vUV2 / 0.05;
    float a = step(0.5, fract((floor(w.x) + floor(w.y)) * 0.5));
    float strip = mix(0.6, 1.0, a) * (0.8 + 0.25 * cgVnoise2(w * 0.5));
    float detail = 1.0 - smoothstep(0.3, 1.0, fwidth(w.x));
    c = vec3(0.028, 0.026, 0.022) * mix(0.85, strip, detail) * (0.85 + 0.35 * n);
    c = mix(c, vec3(0.09, 0.08, 0.065), smoothstep(0.5, 0.9, up) * 0.35 * n);   // sun-faded tops
    yzRough = 0.7;
  } else if (yzIs(kind, ${K('SAIL')})) {
    // battened lug sail of matting / cloth: tan brown, patched, darker toward the foot
    // cotton canvas, weathered cream (ref09), a few boats with tanned brown sails; patches and seams
    float pat = step(0.8, cgHash12(floor(vUV2 / vec2(1.4, 0.9))));
    vec3 cream = vec3(0.6, 0.55, 0.45), tan = vec3(0.3, 0.19, 0.11);
    c = mix(cream, tan, step(0.72, tone)) * (0.8 + 0.3 * n) * (0.92 + 0.12 * f);
    c = mix(c, c * vec3(0.85, 0.8, 0.72), pat * 0.6);
    float seamS = smoothstep(0.0, 0.025 + fwidth(vUV2.x / 0.55), abs(fract(vUV2.x / 0.55) - 0.5) - 0.47);
    c *= 1.0 - 0.12 * seamS;
    // canvas is thin: with the sun behind it, the sail glows through (the renderer has no transmission)
    float back = max(-dot(cgN, uSunDir), 0.0) * (1.0 - uNight);
    // + light scattered through the weave from the bright sky and the river (canvas never reads black by day, ref09)
    yzEmit = c * uSunColor * (back * 1.1 + 0.6 * (1.0 - uNight));
    c *= 0.85 + 0.15 * smoothstep(0.0, 6.0, vUV2.y);
    yzRough = 0.9;
  } else if (yzIs(kind, ${K('LACQUER')})) {
    c = uZhu * 1.6 * (0.8 + 0.35 * n);
    c = mix(c, vec3(0.12, 0.09, 0.07), smoothstep(0.55, 0.85, mm) * 0.4);
    yzRough = 0.55;
  } else if (yzIs(kind, ${K('LATTICE')})) {
    // paper behind a lattice of thin bars; lamplit at night
    vec2 g = vUV2 / 0.13;
    vec2 fr = abs(fract(g) - 0.5);
    float bar = step(0.4, max(fr.x, fr.y));
    vec3 paper = vec3(0.55, 0.5, 0.4) * (0.8 + 0.2 * n);
    c = mix(paper, uZhu * 1.2, bar);
    yzEmit = (1.0 - bar) * uGlowColor * uGlow * 0.5 * uNight;
    yzRough = 0.8;
  } else if (yzIs(kind, ${K('TILE')})) {
    c = vec3(0.05, 0.052, 0.056) * (0.8 + 0.4 * n);
    float row = abs(fract(vUV2.x / 0.2) - 0.5);
    c *= 0.8 + 0.3 * smoothstep(0.1, 0.3, row);
    yzRough = 0.65;
  } else if (yzIs(kind, ${K('ROPE')})) {
    c = vec3(0.12, 0.1, 0.07) * (0.8 + 0.4 * n);
  } else if (yzIs(kind, ${K('CLOTH')})) {
    c = vec3(0.5, 0.47, 0.4) * (0.75 + 0.3 * n);
    yzRough = 0.95;
  } else if (yzIs(kind, ${K('CARGO')})) {
    // sacks of rice and salt, jars: hessian beige, some dark
    float h = cgHash13(floor(cgP * 1.6));
    c = mix(vec3(0.32, 0.27, 0.19), vec3(0.06, 0.05, 0.045), step(0.72, h)) * (0.8 + 0.35 * n);
    yzRough = 0.9;
  }
  float grime = 1.0 - smoothstep(0.2, 0.9, ao);
  c = mix(c, c * 0.45, grime * 0.7);
  yzAO = mix(0.35, 1.0, ao);
  yzBump = (vec3(cgVnoise3(cgP * 15.0), cgVnoise3(cgP * 15.0 + 3.0), cgVnoise3(cgP * 15.0 + 7.0)) - 0.5) * 0.06;
  yzApplySnow(c, cgP, N, up);
  diffuseColor.rgb = c;
`;

let cache = null;
export function boatMaterial() {
  if (cache) return cache;
  const o = familyOptions('boat');
  cache = proceduralMaterial({ ...o, head: ATTR_F, color: COLOR, roughness: HOOKS.roughness, ao: HOOKS.ao, normal: HOOKS.normal, emissive: HOOKS.emissive });
  return cache;
}
