// Grey clay roof tiles (卷十三 瓦作): the 仰瓪瓦 field (concave channels, overlapping courses), the 甋瓦 rows (ring
// joints), 壘脊 ridges (瓪瓦 courses with lime mortar), 鴟尾 / 獸 / 勾頭 / 滴水 ceramic.
// Field coordinates: vUV2.x counts 甋瓦 rows (rows sit at n + 0.5, channels at n), vUV2.y is the slope length from
// the eave (m). vPaint.y = 1 on a field asks the shader to paint the rows itself (low-detail roofs, no row geometry).
// Variation per tile, lichen on the tops, moss in the channels (north slopes and the lower courses), soot streaks
// down the slope, snow lying in the channels first.
import { proceduralMaterial } from '../core/materials.js';
import { familyOptions, ATTR_F, HOOKS, INIT, K } from './common.js';

const TILE_COLOR = /* glsl */`
  ${INIT}
  float kind = yzKind();
  float ao = clamp(vAO.x, 0.0, 1.0), up = clamp(vAO.y, 0.0, 1.0);
  vec3 N = cgN;
  float n = cgVfbm3(cgP * 1.3, 4), f = cgVnoise3(cgP * 22.0), mm = cgVnoise3(cgP * 0.9 + 4.0);
  vec3 grey = vec3(0.052, 0.056, 0.062);
  vec3 c = grey * (0.8 + 0.4 * n + 0.08 * f);
  yzRough = 0.62;
  float w = uWeather;
  float north = clamp(-N.z, 0.0, 1.0);
  float chan = 0.0;
  bool field = yzIs(kind, ${K('TILE')}) && vPaint.z < 0.5;
  if (field) {
    float across = fract(vUV2.x);
    float dr = abs(across - 0.5);                  // 0 on a row, 0.5 at a channel centre
    float sgn = sign(across - 0.5);
    float along = vUV2.y / uTileCourse;
    float lip = fract(along);
    vec3 Tx = yzTangentU(cgP, N, vUV2.x);
    float tfw = max(fwidth(along), fwidth(vUV2.x));
    float tdet = 1.0 - smoothstep(0.1, 0.45, tfw);
    float tileId = mix(0.62, cgHash12(vec2(floor(along), floor(vUV2.x + 0.5))), tdet);
    c *= 0.7 + 0.6 * tileId * tileId;
    c = mix(c, vec3(0.1, 0.085, 0.07), step(0.93, tileId) * 0.6);         // a few warmer, newer replacements
    c *= vec3(1.0 + 0.06 * (cgHash12(vec2(floor(along) + 3.0, floor(vUV2.x))) - 0.5), 1.0, 1.0 + 0.05 * (tileId - 0.5));
    chan = smoothstep(0.2, 0.42, dr);
    // shadow under every course lip, a sliver of light on the lip itself
    float lipShade = mix(0.62, 1.0, smoothstep(0.0, 0.16, lip)) * mix(1.0, 1.08, smoothstep(0.9, 1.0, lip));
    yzAO = mix(0.5, 1.0, smoothstep(0.12, 0.34, dr)) * lipShade;
    c *= lipShade;
    // concave 瓪瓦: the normal leans toward the channel centre
    yzBump = Tx * sgn * 0.35 * smoothstep(0.18, 0.5, dr) * (1.0 - smoothstep(0.45, 0.5, dr));
    if (vPaint.y > 0.5) {
      // painted 甋瓦 rows (no geometry): a convex band with ring joints
      float row = 1.0 - smoothstep(0.24, 0.3, dr);
      float ring = fract(vUV2.y / uTongLen);
      vec3 rc = grey * (0.95 + 0.25 * cgHash12(vec2(floor(vUV2.y / uTongLen), floor(vUV2.x)))) * mix(0.7, 1.0, smoothstep(0.0, 0.08, ring));
      c = mix(c, rc, row);
      yzBump = mix(yzBump, -Tx * sgn * 0.6 * (dr / 0.27), row);
      yzAO = mix(yzAO, 1.0, row * 0.8);
      chan *= 1.0 - row;
    }
    // moss / dirt in the channels: more on north slopes and near the eaves (water lingers)
    float low = 1.0 - smoothstep(0.0, 4.0, vUV2.y);
    float moss = smoothstep(0.48, 0.78, cgVnoise3(cgP * 3.0) * 0.6 + mm * 0.4 + north * 0.25 + low * 0.2) * chan * w;
    c = mix(c, vec3(0.045, 0.06, 0.03) * (0.8 + 0.5 * f), moss * 0.75);
    yzRough = mix(yzRough, 0.85, moss);
  } else if (yzIs(kind, ${K('TILE')})) {
    // 甋瓦 rows: ring joints every tile, mortar at the joints
    float s = vPaint.w / uTongLen;
    float j = fract(s);
    float tid = cgHash11(floor(s) * 7.3 + floor(cgP.x * 3.0 + cgP.z * 3.0));
    yzAO = mix(0.55, 1.0, smoothstep(0.0, 0.07, j));
    c *= 0.72 + 0.56 * tid * tid;
    c = mix(c, vec3(0.1, 0.085, 0.07), step(0.94, tid) * 0.6);
    c = mix(c, vec3(0.3, 0.29, 0.27), (1.0 - smoothstep(0.0, 0.025, j)) * 0.35 * w);
    yzRough = 0.55;
  } else if (yzIs(kind, ${K('RIDGE')})) {
    // 壘脊: courses of 瓪瓦 with lime mortar lines
    float lay = fract(vPaint.y / 0.0187);
    c *= mix(0.7, 1.0, smoothstep(0.0, 0.25, lay));
    c = mix(c, vec3(0.30, 0.29, 0.26), (1.0 - smoothstep(0.0, 0.12, lay)) * 0.4);
  } else if (yzIs(kind, ${K('CERAMIC')}) || yzIs(kind, ${K('EAVE_TILE')})) {
    c = vec3(0.045, 0.047, 0.051) * (0.75 + 0.45 * n + 0.1 * f);
    yzRough = 0.62;
    yzAO = mix(0.5, 1.0, ao);
  }
  // lichen on the open tops, soot streaks down the slope
  float lichen = smoothstep(0.74, 0.84, cgVnoise3(cgP * vec3(4.0, 2.0, 4.0) + 7.0) * 0.7 + f * 0.3) * smoothstep(0.4, 0.9, up) * w * (1.0 - chan * 0.6);
  c = mix(c, vec3(0.2, 0.2, 0.15), lichen * 0.45);
  float streak = smoothstep(0.62, 0.9, cgVnoise3(cgP * vec3(2.0, 0.5, 2.0) + 4.0));
  c = mix(c, vec3(0.13, 0.13, 0.12), streak * 0.25 * w);
  c *= mix(0.6, 1.0, ao);
  yzAO *= mix(0.5, 1.0, ao);
  yzApplySnow(c, cgP, N, up);
  diffuseColor.rgb = c;
`;

export function tileMaterial() {
  const o = familyOptions('yzTile');
  return proceduralMaterial({ ...o, head: ATTR_F, color: TILE_COLOR, roughness: HOOKS.roughness, ao: HOOKS.ao, normal: HOOKS.normal });
}
