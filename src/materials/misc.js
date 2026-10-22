// Small material families: the dark interior, lit openings (GLOW: dark by day, lamplit at night), lantern paper
// (PAPER), bronze / gilt (塔刹, BRONZE).
import * as THREE from 'three';
import { proceduralMaterial } from '../core/materials.js';
import { familyOptions, ATTR_F, HOOKS, INIT, K } from './common.js';

export function darkMaterial() {
  return proceduralMaterial({ name: 'yzDark', params: { color: new THREE.Color(0.016, 0.014, 0.012), roughness: 0.95, metalness: 0 } });
}

const GLOW_COLOR = /* glsl */`
  ${INIT}
  float kind = yzKind();
  float n = cgVnoise3(cgP * 1.7), f = cgVnoise3(cgP * 9.0);
  vec3 c = vec3(0.014, 0.012, 0.011);
  if (yzIs(kind, ${K('PAPER')})) {
    // oiled paper on a lantern: warm red by day, glowing at night
    c = vec3(0.32, 0.06, 0.035) * (0.85 + 0.3 * n);
    float rib = 1.0 - smoothstep(0.0, 0.06, abs(fract(atan(cgO.z, cgO.x) * 2.546) - 0.5) - 0.44);
    c *= 1.0 - 0.3 * rib;
    yzEmit = uGlowColor * vec3(1.0, 0.55, 0.45) * uGlow * 1.6 * uNight * (0.8 + 0.4 * n) * (1.0 - 0.6 * rib);
    yzRough = 0.7;
  } else {
    // a lamplit room seen through an opening: about two in three are lit, unevenly
    vec2 id = floor(cgP.xz * 0.4 + cgP.y * 0.13);
    float lit = step(0.33, cgHash12(id + 1.7));
    float grad = 0.55 + 0.45 * smoothstep(0.0, 2.2, vPaint.y);
    vec3 gc = uGlowColor * (0.6 + 0.6 * cgHash12(id + 9.1)) * grad;
    // lamps (stone lanterns): always lit, a flame seen almost directly through the paper: ~4x a lit room, and a
    // yellower core (2200 K flame, ref05's lantern holes read pale yellow with an orange glow round them)
    if (vPaint.z < 0.05) { lit = 1.0; gc = vec3(1.0, 0.5, 0.13) * 4.0; }
    yzEmit = gc * uGlow * uNight * lit * (0.85 + 0.3 * n);
    yzRough = 0.95;
  }
  f = f;
  diffuseColor.rgb = c;
`;
export function glowMaterial() {
  const o = familyOptions('yzGlow');
  return proceduralMaterial({ ...o, head: ATTR_F, color: GLOW_COLOR, roughness: HOOKS.roughness, emissive: HOOKS.emissive });
}

const METAL_COLOR = /* glsl */`
  ${INIT}
  float n = cgVfbm3(cgP * 3.0, 3), f = cgVnoise3(cgP * 30.0);
  // bronze with a dark patina, green verdigris in the hollows, gilt toward the top
  vec3 bronze = vec3(0.42, 0.27, 0.12) * (0.8 + 0.3 * f);
  vec3 patina = vec3(0.06, 0.07, 0.05);
  vec3 verd = vec3(0.12, 0.22, 0.17);
  float pat = smoothstep(0.3, 0.7, n);
  vec3 c = mix(bronze, patina, pat * 0.75);
  c = mix(c, verd, smoothstep(0.62, 0.8, n) * (1.0 - vAO.x) * 0.6 + smoothstep(0.75, 0.9, n) * 0.3);
  float gilt = yzIs(yzKind(), ${K('GILT')}) ? 1.0 : 0.0;
  c = mix(c, vec3(0.62, 0.44, 0.16) * (0.85 + 0.2 * f), gilt * 0.85);
  yzMetal = mix(0.55, 0.95, max(gilt, 1.0 - pat));
  yzRough = mix(0.55, 0.32, gilt);
  yzAO = mix(0.5, 1.0, vAO.x);
  yzApplySnow(c, cgP, cgN, vAO.y);
  diffuseColor.rgb = c;
`;
export function metalMaterial() {
  const o = familyOptions('yzMetal', { params: { metalness: 0.8, roughness: 0.4 } });
  return proceduralMaterial({ ...o, head: ATTR_F, color: METAL_COLOR, roughness: HOOKS.roughness, metalness: HOOKS.metalness, ao: HOOKS.ao });
}
