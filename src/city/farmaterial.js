// One material for the distant houses (LOD 2 / 3): roof, walls and front in a single draw, every house its own tone.
// Reads the yingzao paint kinds (src/yingzao/geom.js PAINT) so the LOD 2 kit geometry works unchanged; a per-house
// seed comes from the batching (or instancing) matrix. Roofs: grey clay, some darker / newer, some warmer, a few
// mossy; walls: lime wash going grey with age, darker toward the foot; fronts: dark timber, lamplit at night.
// Shares the building uniforms (snow, night, glow) of src/materials/common.js.
import { proceduralMaterial } from '../core/materials.js';
import { familyOptions, ATTR_F, ATTR_V, ATTR_PRE, HOOKS, INIT, K } from '../materials/common.js';

const SEED_V = /* glsl */`
${ATTR_V}
varying float vFarSeed;
`;
const SEED_PRE = /* glsl */`
${ATTR_PRE}
#ifdef USE_BATCHING
  vFarSeed = fract(sin(dot(batchingMatrix[3].xyz, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
#elif defined(USE_INSTANCING)
  vFarSeed = fract(sin(dot(instanceMatrix[3].xyz, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
#else
  vFarSeed = 0.5;
#endif
`;
const HEAD = /* glsl */`
${ATTR_F}
varying float vFarSeed;
`;
const COLOR = /* glsl */`
  ${INIT}
  float kind = yzKind();
  float s = vFarSeed, s2 = fract(s * 7.31 + 0.17), s3 = fract(s * 13.7 + 0.53);
  float ao = clamp(vAO.x, 0.0, 1.0), up = clamp(vAO.y, 0.0, 1.0);
  float n = cgVfbm3(cgP * 0.7, 3), f = cgVnoise3(cgP * 6.0);
  vec3 c;
  bool roof = yzIs(kind, ${K('CERAMIC')}) || yzIs(kind, ${K('RIDGE')}) || yzIs(kind, ${K('TILE')}) || yzIs(kind, ${K('EAVE_TILE')});
  bool wall = yzIs(kind, ${K('WHITEWASH')}) || yzIs(kind, ${K('PLASTER')});
  if (roof) {
    c = vec3(0.055, 0.056, 0.059) * (0.62 + 0.8 * s) * (0.85 + 0.25 * n + 0.06 * f);
    // warmer, older clay on nearly half the roofs, in three tones (ref07's roof field is brown-grey, not one grey)
    c = mix(c, vec3(0.082, 0.068, 0.056) * (0.75 + 0.5 * s2), step(0.55, s2));
    c = mix(c, vec3(0.1, 0.085, 0.07), step(0.93, s3) * 0.7);
    c = mix(c, vec3(0.048, 0.06, 0.036), step(0.86, s3) * 0.6 * (0.6 + 0.4 * n));  // moss on a few roofs
    // faint courses (a tone ripple, never a sharp pattern at this range)
    c *= 0.94 + 0.06 * sin(dot(cgP.xz, vec2(7.3, 5.1)));
    yzRough = 0.66;
    if (yzIs(kind, ${K('RIDGE')})) c *= 0.8;
  } else if (wall) {
    c = vec3(0.56, 0.53, 0.47) * (0.72 + 0.3 * s2) * (0.9 + 0.12 * n);
    c *= mix(0.7, 1.0, smoothstep(0.0, 2.2, vPaint.y));                              // damp, splashed foot
    c = mix(c, c * vec3(0.78, 0.77, 0.75), smoothstep(0.55, 0.85, s3) * 0.6);        // grey old wash
    yzRough = 0.92;
  } else if (yzIs(kind, ${K('LATTICE')}) || yzIs(kind, ${K('GLOW')})) {
    c = vec3(0.045, 0.035, 0.028) * (0.8 + 0.4 * s);
    float lit = step(0.35, s2) * uNight;
    yzEmit = uGlowColor * uGlow * 0.45 * lit * (0.6 + 0.6 * s3) * smoothstep(0.3, 2.0, vPaint.y);
    yzRough = 0.8;
  } else if (yzIs(kind, ${K('STONE')})) {
    c = vec3(0.22, 0.21, 0.19) * (0.8 + 0.3 * n);
  } else {
    c = vec3(0.09, 0.065, 0.045) * (0.75 + 0.4 * s) * (0.85 + 0.2 * n);            // timber
    yzRough = 0.82;
  }
  c *= mix(0.55, 1.0, ao);
  yzAO = mix(0.4, 1.0, ao);
  yzApplySnow(c, cgP, cgN, up);
  diffuseColor.rgb = c;
`;

let cache = null;
export function farHouseMaterial() {
  if (cache) return cache;
  const o = familyOptions('cityFar');
  cache = proceduralMaterial({ ...o, vertexHead: SEED_V, vertexPre: SEED_PRE, head: HEAD, color: COLOR, roughness: HOOKS.roughness, ao: HOOKS.ao, emissive: HOOKS.emissive });
  return cache;
}
