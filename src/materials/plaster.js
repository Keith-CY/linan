// Lime plaster (白灰牆, 栱眼壁, 山花) and lime-washed house walls (WHITEWASH).
// Warm off-white with tonal drift, a damp band at the foot (rising damp: greenish grey with a wavy tide line and a
// pale salt bloom above it), rain stains running down from the beams, dust and soot in the occluded corners,
// patches where the lime skin has fallen and the grey-brown earth plaster shows.
import { proceduralMaterial } from '../core/materials.js';
import { familyOptions, ATTR_F, HOOKS, INIT, K } from './common.js';

const PLASTER_COLOR = /* glsl */`
  ${INIT}
  float kind = yzKind();
  float v = vPaint.y, hh = vPaint.z;
  float ao = clamp(vAO.x, 0.0, 1.0), up = clamp(vAO.y, 0.0, 1.0);
  float wash = yzIs(kind, ${K('WHITEWASH')}) ? 1.0 : 0.0;
  float w = uWeather * (1.0 + 0.4 * wash);
  float n = cgVfbm3(cgP * 0.8, 4), f = cgVnoise3(cgP * 14.0), m = cgVnoise3(cgP * 3.3 + 2.0);
  vec3 c = uWhite * (0.93 + 0.09 * n + 0.03 * f) * vec3(1.0, 0.99, 0.965 - 0.03 * n);
  // rising damp: the band at the foot, wavy top edge, salt bloom just above
  float tide = 0.35 + 0.45 * n + 0.12 * m;
  float damp = (1.0 - smoothstep(tide - 0.08, tide + 0.04, v)) * w;
  float salt = smoothstep(tide - 0.02, tide + 0.02, v) * (1.0 - smoothstep(tide + 0.03, tide + 0.12, v)) * w;
  c = mix(c, vec3(0.30, 0.31, 0.27) * (0.85 + 0.3 * f), damp * 0.55);
  c = mix(c, c * 1.06 + 0.02, salt * 0.6);
  // algae / moss specks low on the wall
  c = mix(c, vec3(0.16, 0.19, 0.12), damp * smoothstep(0.55, 0.8, cgVnoise3(cgP * 6.0)) * 0.5);
  // rain stains running down from the top (beams drip onto the wall)
  float topZone = smoothstep(hh * 0.45, hh, v);
  float streak = smoothstep(0.5, 0.85, cgVnoise3(vec3(cgP.x * 4.3 + cgP.z * 4.3, cgP.y * 0.22, 1.0))) * (0.3 + 0.7 * topZone);
  c *= 1.0 - 0.16 * streak * w;
  // fallen lime skin: grey-brown earth plaster under it, with a crisp edge
  float pt = cgVfbm3(cgP * 1.4 + 7.0, 3) + 0.08 * f;
  // patches are rare and low on the wall (splash, knocks); whitewash is renewed and shows old coats as faint clouds
  float low = 1.0 - smoothstep(0.0, hh * 0.45, v);
  float patchy = smoothstep(0.72, 0.74, pt) * w * (0.25 + 0.75 * low);
  c = mix(c, vec3(0.36, 0.31, 0.25) * (0.85 + 0.3 * f), patchy * (0.7 - 0.3 * wash));
  c *= 1.0 - 0.06 * wash * smoothstep(0.45, 0.7, cgVfbm3(cgP * 0.6 + 2.0, 3));
  // soot and dust where the air is still
  float grime = 1.0 - smoothstep(0.3, 0.9, ao);
  c = mix(c, c * vec3(0.8, 0.78, 0.74), grime * 0.6);
  // smoke-darkened band right under the beams (lamps, incense), soft
  c = mix(c, c * vec3(0.8, 0.78, 0.74), smoothstep(hh * 0.75, hh, v) * 0.5 * w);
  c *= mix(0.97, 1.0, smoothstep(0.0, 1.0, up));
  if (wash > 0.5) c *= vec3(0.96, 0.95, 0.92);
  yzRough = 0.93;
  yzAO = mix(0.42, 1.0, ao);
  // trowel undulation
  yzBump = vec3(cgVnoise3(cgP * 5.0) - 0.5, 0.0, cgVnoise3(cgP * 5.0 + 3.0) - 0.5) * 0.03 + vec3(0.0, 0.0, 0.0);
  yzApplySnow(c, cgP, cgN, up);
  diffuseColor.rgb = c;
`;

export function plasterMaterial() {
  const o = familyOptions('yzPlaster');
  return proceduralMaterial({ ...o, head: ATTR_F, color: PLASTER_COLOR, roughness: HOOKS.roughness, ao: HOOKS.ao, normal: HOOKS.normal });
}
