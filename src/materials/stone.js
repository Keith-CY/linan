// Stone and brick: 階基 ashlar (STONE), white stone of the palace terraces and 勾闌 (MARBLE), grey brick of pagoda
// bodies, 墩台 and 階基 facings (BRICK, 卷十五 條磚 長一尺三寸 廣六寸五分 厚二寸五分), rough stone (ROCK).
// Dust on the tops, moss and lichen low and in the joints, wet dark foot, edge-worn blocks, soot in the crevices.
import { proceduralMaterial } from '../core/materials.js';
import { familyOptions, ATTR_F, HOOKS, INIT, K } from './common.js';

const STONE_COLOR = /* glsl */`
  ${INIT}
  float kind = yzKind();
  float ao = clamp(vAO.x, 0.0, 1.0), up = clamp(vAO.y, 0.0, 1.0);
  vec3 N = cgN;
  float n = cgVfbm3(cgP * 1.6, 4), f = cgVnoise3(cgP * 25.0), mm = cgVnoise3(cgP * 4.0 + 5.0);
  vec2 q; vec2 cellSize; float rowOff = 0.5;
  bool brick = yzIs(kind, ${K('BRICK')});
  bool marble = yzIs(kind, ${K('MARBLE')});
  bool rock = yzIs(kind, ${K('ROCK')});
  // blocks / bricks in the metric surface coordinates (on horizontal faces use the plan position)
  vec2 uv = abs(N.y) > 0.7 ? cgP.xz : vUV2;
  if (brick) cellSize = vec2(0.405, 0.078 + 0.012); // 條磚 1.3 尺 long, 2.5 寸 courses + joint
  else if (marble) cellSize = vec2(1.6, 0.55);
  else cellSize = vec2(1.35, 0.46);
  q = uv / cellSize;
  float row = floor(q.y);
  // irregular ashlar: every course has its own block length and stagger
  if (!brick) { float rl = 0.7 + 0.6 * cgHash11(row * 3.7 + 1.3); q.x = q.x / rl + cgHash11(row * 7.1); }
  else q.x += rowOff * mod(row, 2.0);
  vec2 cell = floor(q);
  vec2 g = abs(fract(q) - 0.5);
  float fw = max(fwidth(q.x), fwidth(q.y));
  float jw = brick ? 0.075 : 0.012;
  float jx = jw * (brick ? 0.2 : 1.0);
  float joint = max(smoothstep(0.5 - jx - fw, 0.5 - jx * 0.4, g.x), smoothstep(0.5 - jw - fw, 0.5 - jw * 0.4, g.y));
  if (rock) joint = 0.0;
  // per-block variation fades out once the blocks get smaller than a few pixels (no shimmering camouflage at range)
  float detail = 1.0 - smoothstep(0.08, 0.35, fw);
  float bh = mix(0.5, cgHash12(cell + 3.1), detail);
  joint *= mix(0.35, 1.0, detail);
  vec3 c;
  if (brick) {
    c = vec3(0.17, 0.17, 0.165) * (0.84 + 0.3 * bh) * (0.82 + 0.3 * n + 0.06 * f);
    c = mix(c, vec3(0.12, 0.11, 0.1), step(0.9, bh) * 0.45 * detail);         // over-fired dark bricks
    c = mix(c, vec3(0.42, 0.41, 0.38) * (0.8 + 0.3 * f), joint * 0.85);       // lime mortar
  } else if (marble) {
    c = vec3(0.62, 0.6, 0.56) * (0.9 + 0.12 * n + 0.05 * f) * (0.95 + 0.06 * bh);
    float vein = 1.0 - smoothstep(0.0, 0.03, abs(cgVfbm3(cgP * vec3(0.8, 2.2, 0.8) + bh * 9.0, 3) - 0.5));
    c = mix(c, c * 0.75, vein * 0.35);
    c = mix(c, vec3(0.22, 0.21, 0.19), joint * 0.55);
  } else if (rock) {
    c = vec3(0.28, 0.27, 0.25) * (0.7 + 0.5 * n + 0.1 * f);
  } else {
    c = vec3(0.24, 0.235, 0.22) * (0.72 + 0.45 * n + 0.08 * f) * (0.78 + 0.4 * bh);
    c *= vec3(1.0 + 0.08 * (cgHash12(cell + 9.0) - 0.5), 1.0, 1.0 - 0.06 * (cgHash12(cell + 5.0) - 0.5));
    // dark stains from water running down the face
    c *= 1.0 - 0.3 * smoothstep(0.55, 0.85, cgVnoise3(vec3(cgP.x * 2.5 + cgP.z * 2.5, cgP.y * 0.3, 2.0))) * (1.0 - smoothstep(0.7, 0.95, N.y));
    c = mix(c, vec3(0.1, 0.1, 0.09), joint * 0.65);
  }
  // edge wear: block edges lighter (chipped) on stone
  float edge = smoothstep(0.38, 0.48, max(g.x, g.y)) * (1.0 - joint) * (brick || rock ? 0.0 : 1.0);
  c *= 1.0 + 0.12 * edge * (f - 0.3);
  float w = uWeather;
  // dust on the tops (sheltered tops keep more), wet dark foot
  float topF = smoothstep(0.7, 0.95, N.y);
  c = mix(c, vec3(0.42, 0.39, 0.34), topF * (0.25 + 0.35 * (1.0 - up)) * w * (0.6 + 0.4 * n));
  // moss and lichen: low, in joints, on the shaded and occluded parts
  float mossMask = smoothstep(0.55, 0.8, cgVnoise3(cgP * 3.0 + 1.0) + joint * 0.3 + (1.0 - ao) * 0.3) * w;
  c = mix(c, vec3(0.08, 0.1, 0.05) * (0.8 + 0.4 * f), mossMask * (0.35 + 0.35 * (1.0 - topF)) * (marble ? 0.5 : 1.0));
  float lichen = smoothstep(0.78, 0.86, cgVnoise3(cgP * 9.0 + 4.0)) * up * w;
  c = mix(c, vec3(0.42, 0.42, 0.36), lichen * 0.35);
  // soot / grime in the occluded corners
  float grime = 1.0 - smoothstep(0.3, 0.9, ao);
  c = mix(c, c * 0.55, grime * 0.6);
  yzRough = brick ? 0.92 : marble ? 0.72 : 0.88;
  yzAO = mix(0.6, 1.0, 1.0 - joint) * mix(0.45, 1.0, ao);
  yzBump = (vec3(cgVnoise3(cgP * 12.0), 0.0, cgVnoise3(cgP * 12.0 + 9.0)) - 0.5) * (rock ? 0.3 : 0.06);
  yzApplySnow(c, cgP, N, up);
  diffuseColor.rgb = c;
`;

export function stoneMaterial() {
  const o = familyOptions('yzStone');
  return proceduralMaterial({ ...o, head: ATTR_F, color: STONE_COLOR, roughness: HOOKS.roughness, ao: HOOKS.ao, normal: HOOKS.normal });
}
