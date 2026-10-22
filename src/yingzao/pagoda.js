// Pagodas and stone lanterns. The 法式 has no pagoda chapter (see fashi.js · 塔): the timber-eaved towers reuse the
// hall rules storey by storey through composeLouge (polygon plans, 鋪作, 腰檐, 平坐 + 勾闌, 攢尖) and take their
// proportions from surviving southern towers (approx., noted per kind). Solid brick and stone pieces are lathed /
// built directly.
//
//   leifeng   雷峰塔: octagonal, five storeys + 副階, brick body plastered between timber columns, timber 腰檐 and
//             平坐 with 勾闌 at every storey, bronze 塔刹 (ref04; far away in ref01)
//   liuhe     六和塔: octagonal, seven storeys, each with 平坐 + 勾闌 and an upturned 腰檐 (ref09)
//   baochu    保俶塔: a slender solid brick spire with corbelled (疊澀) brick eaves on 寶石山 (ref03)
//   santan    三潭 stone lantern: round body with five round openings, 寶蓋 and a gourd top; openings glow at night
//   stupa     a small octagonal stone pagoda (after the Northern-Song stone pagodas of 靈隱寺; ref08)
//   jingchuang 經幢: an octagonal stone pillar on a lotus base with a canopy
//   tower     a generic timber-eaved 樓閣式 pagoda (city and hill pagodas): storeys, sides
// Every builder returns { group, info } like the buildings (origin = floor / water level for santan).
import * as THREE from 'three';
import { MeshBuilder, PAINT } from './geom.js';
import { asm, done, composeLouge } from './buildings.js';
import * as F from './fashi.js';
import * as O from './ornaments.js';

/** storey list of a timber-eaved octagonal tower: side and column height shrink storey by storey (收分) */
function towerStoreys({ n, grade, side, H, sideTaper, hTaper, puzuo, walls = 'pagoda', sideBuJian = 2, sides = 8, sideBays = 1, extra = {} }) {
  const fen = F.fenOf(grade);
  const out = [];
  for (let i = 0; i < n; i++) {
    const sb = typeof sideBays === 'function' ? sideBays(i) : sideBays;
    const sw = side * (1 - sideTaper * i);
    out.push({ shape: 'poly', sides, sideBays: sb, sideBuJian: sb > 1 ? 1 : sideBuJian, sideW: sw / sb / fen, H0: (H * (1 - hTaper * i)) / fen, puzuo: typeof puzuo === 'function' ? puzuo(i) : puzuo, walls: typeof walls === 'function' ? walls(i) : walls, type: 'diange', ...extra });
  }
  return out;
}

function addTasha(A, apexY, H, rings) {
  const M = new MeshBuilder();
  O.tasha(M, [0, apexY - 0.35, 0], H, { rings });
  A.put({ metal: M });
  A.anchors.top = Math.max(A.anchors.top, apexY + H);
}

// ------------------------------------------------------------------------------------------------ 雷峰塔
/** params: storeys (5), side (m, first storey column ring side, 5.8), H (m, 3.9), grade (3), fujie (true),
 *  tashaH (m). Approx.: proportions after the excavated octagonal base and the 吳越 brick-and-timber type. */
export function leifeng(p = {}, o = {}) {
  const grade = p.grade ?? 3, fen = F.fenOf(grade);
  const A = asm(o, 'leifeng');
  // ref04's tower — broad eaves on every storey (1.5 × the 檐出) curling up at the corners
  const storeys = towerStoreys({ n: p.storeys ?? 5, grade, side: p.side ?? 5.8, H: p.H ?? 3.9, sideTaper: p.sideTaper ?? 0.06, hTaper: 0.06, puzuo: (i) => (i === 0 ? 6 : 5),
    extra: { eaveScale: p.eaveScale ?? 3.0, curl: { lift: 90, thrust: 2.4, zone: 0.7, hipTip: 30, ...(p.curl || {}) }, yaoyanCurl: { lift: 100 } } });
  const r = composeLouge(A, { storeys, roof: 'cuanjian', apex: null, grade, fujie: p.fujie === false ? null : { depth: (p.fujieDepth ?? 3.2) / fen, puzuo: 4, H0: 3.6 / fen }, platform: { h: 1.4, out: 1.4, ...(p.platform || {}) } });
  addTasha(A, r.apexY, p.tashaH ?? 7.5, 7);
  return done(A, { baseH: r.baseH });
}

// ------------------------------------------------------------------------------------------------ 六和塔
/** params: storeys (7), side (8.4), H (3.4), grade (3). ref09 look (red columns, white walls, a balcony at every
 *  storey) on Song structure (the 1165 rebuild had seven storeys outside, approx.). */
export function liuhe(p = {}, o = {}) {
  const grade = p.grade ?? 3, fen = F.fenOf(grade);
  const A = asm(o, 'liuhe');
  // stocky like ref09: a wide body (the surviving 六和塔 is ~25 m across its base), three bays a side with doors and
  // windows, balconies everywhere. Corners lifted more than the 法式 base (southern practice, e.g. 蘇州玄妙觀三清殿
  // 1179; approx. 1.9 × the 32 分 we derive in fashi.js), 生出 ×1.5.
  // after ref09: few tall storeys with broad eaves that curl up hard at every corner, red
  // balconies on every storey, a heavy crown roof; the storey count follows the layout (ref09 shows four)
  const n = p.storeys ?? 4;
  const storeys = towerStoreys({ n, grade, side: p.side ?? 8.4, H: p.H ?? 3.9, sideTaper: p.sideTaper ?? 0.03, hTaper: p.hTaper ?? 0.03, puzuo: 5, walls: p.walls ?? 'pagoda-open', sideBays: (i) => (i < n - 2 ? 3 : 1),
    extra: { shengchuScale: 1.5, eaveScale: p.eaveScale ?? 1.7, curl: { lift: 95, thrust: 2.2, zone: 0.7, hipTip: 30, thick: 1.6, ...(p.curl || {}) }, yaoyanCurl: { lift: 110 } } });
  const top = storeys[n - 1];
  top.eaveScale = p.crownEave ?? 1.9; top.cuanRise = p.crownRise ?? 0.62;
  const r = composeLouge(A, { storeys, roof: 'cuanjian', apex: null, grade, fujie: p.fujie ? { depth: 3.0 / fen, puzuo: 4, H0: 3.8 / fen } : null, platform: { h: p.platformH ?? 3.2, out: 2.2, ...(p.platform || {}) } });
  addTasha(A, r.apexY, p.tashaH ?? 6.5, 5);
  return done(A, { baseH: r.baseH });
}

// ------------------------------------------------------------------------------------------------ generic tower
/** a timber-eaved 樓閣式 pagoda for the city and the hills: storeys (7), sides (8), side (m), H (m), fujie */
export function tower(p = {}, o = {}) {
  const grade = p.grade ?? 4, fen = F.fenOf(grade);
  const A = asm(o, 'tower');
  const sides = p.sides ?? 8;
  const side = p.side ?? (sides === 6 ? 5.0 : 4.2);
  const storeys = towerStoreys({ n: p.storeys ?? 7, grade, side, H: p.H ?? 3.3, sideTaper: 0.06, hTaper: 0.04, puzuo: 5, sides, sideBuJian: side > 4.5 ? 2 : 1 });
  const r = composeLouge(A, { storeys, roof: 'cuanjian', apex: null, grade, fujie: p.fujie ? { depth: 2.6 / fen, puzuo: 4, H0: 3.0 / fen } : null, platform: { h: 1.2, out: 1.2, ...(p.platform || {}) } });
  addTasha(A, r.apexY, p.tashaH ?? 5.5, 5);
  return done(A, { baseH: r.baseH });
}

// ------------------------------------------------------------------------------------------------ 保俶塔
/** a slender solid brick spire: octagonal 須彌座, `levels` brick storeys with 疊澀 corbelled eaves and blind
 *  壸門 niches, a small 塔刹. params: H (m, shaft, 38), r (m, base apothem, 2.7), levels (7). Approx. */
export function baochu(p = {}, o = {}) {
  const A = asm(o, 'baochu');
  const S = new MeshBuilder(), Dk = new MeshBuilder();
  const H = p.H ?? 38, r0 = p.r ?? 2.7, n = p.levels ?? 7, ns = p.sides ?? 8;
  const oct = (r) => r / Math.cos(Math.PI / ns);        // apothem → vertex radius for an ns-segment lathe
  const lathe = (prof, y0) => O.latheAt(S, prof.map(([r, y]) => [oct(r), y]), ns, { o: [0, y0, 0], kind: PAINT.BRICK, phase: Math.PI / ns, capTop: true });
  // 須彌座
  const baseH = 1.6;
  lathe([[r0 * 1.45, -0.6], [r0 * 1.45, 0.25], [r0 * 1.3, 0.4], [r0 * 1.2, 0.55], [r0 * 1.2, 1.05], [r0 * 1.3, 1.2], [r0 * 1.38, 1.35], [r0 * 1.38, baseH]], 0);
  let y = baseH;
  const hs = []; let tot = 0;
  for (let i = 0; i < n; i++) { const h = (i === 0 ? 1.45 : 1) * (1 - 0.035 * i); hs.push(h); tot += h; }
  for (let i = 0; i < n; i++) {
    const h = (hs[i] / tot) * H;
    const rb = r0 * (1 - 0.42 * (i / n)), rt = r0 * (1 - 0.42 * ((i + 0.85) / n));
    // body with a slight entasis, then 疊澀: five courses stepping out, three stepping back
    const prof = [[rb, 0], [rb * 1.005, h * 0.4], [rt, h * 0.82]];
    let rr = rt, yy = h * 0.82;
    const c = 0.085;
    for (let k = 0; k < 5; k++) { prof.push([rr + 0.06 * k + 0.06, yy]); yy += c; prof.push([rr + 0.06 * k + 0.06, yy]); }
    const rTop = rr + 0.3;
    for (let k = 0; k < 3; k++) { prof.push([rTop - 0.09 * (k + 1), yy]); yy += c * 0.9; prof.push([rTop - 0.09 * (k + 1), yy]); }
    lathe(prof, y);
    // blind 壸門 niches on alternate faces (dark recesses)
    for (let f = 0; f < ns; f += 2) {
      const a = ((f + i % 2) * 2 * Math.PI) / ns;
      const nx = Math.sin(a), nz = Math.cos(a), ex = Math.cos(a), ez = -Math.sin(a);
      const rn = (rb + rt) / 2 + 0.005, w = rn * 0.34, hh = h * 0.45, y0 = y + h * 0.2;
      Dk.quad([nx * rn - ex * w, y0, nz * rn - ez * w], [nx * rn + ex * w, y0, nz * rn + ez * w], [nx * rn + ex * w * 0.7, y0 + hh, nz * rn + ez * w * 0.7], [nx * rn - ex * w * 0.7, y0 + hh, nz * rn - ez * w * 0.7], [PAINT.DARK, 0, 1, 0]);
    }
    y += Math.max(h, yy);
  }
  A.put({ stone: S, dark: Dk });
  addTasha(A, y + 0.3, p.tashaH ?? 4.5, 5);
  return done(A, { baseH: 0 });
}

// ------------------------------------------------------------------------------------------------ 三潭 stone lantern
/** params: H (m above water, 2.4), r (sphere radius, 0.62), holes (5), depth (water, 2). Origin = water level. */
export function santan(p = {}, o = {}) {
  const A = asm(o, 'santan');
  const S = new MeshBuilder(), G = new MeshBuilder();
  const R = p.r ?? 0.62, depth = p.depth ?? 2;
  const kind = PAINT.ROCK;
  const lathe = (prof, y0, segs = 24, k = kind, B = S) => O.latheAt(B, prof, segs, { o: [0, y0, 0], kind: k, capTop: true });
  // plinth in the water (a wide round base stone), waisted stem, base disc (proportions after ref05, approx.)
  lathe([[1.0, -depth], [1.0, 0.1], [0.94, 0.17], [0.86, 0.2], [0.42, 0.24]], 0, 18);
  lathe([[0.4, 0], [0.32, 0.1], [0.3, 0.26], [0.36, 0.34], [0.66, 0.4], [0.7, 0.47], [0.52, 0.5]], 0.24);
  // the round body (sphere), centre at yc
  const yc = 0.74 + R * 0.96;
  const sph = [];
  for (let i = 0; i <= 16; i++) { const a = -Math.PI / 2 + (i / 16) * Math.PI; sph.push([Math.max(0.001, Math.cos(a) * R), Math.sin(a) * R]); }
  lathe(sph, yc, 28);
  // five round openings around the waist: a stone rim standing proud of the ball and the lamplit paper (GLOW)
  // filling it, flush with the surface (the ball is solid geometry, so the opening is drawn on it)
  const nh = p.holes ?? 5, rh = R * 0.26;
  for (let k = 0; k < nh; k++) {
    const a = (k / nh) * Math.PI * 2 + 0.3;
    const dir = [Math.sin(a), 0.0, Math.cos(a)];
    const c = [dir[0] * R * 0.97, yc, dir[2] * R * 0.97];
    O.latheAt(S, [[rh * 1.28, 0.0], [rh * 1.2, 0.05], [rh * 1.02, 0.06], [rh, 0.035]], 18, { o: c, axis: dir, kind, capTop: false });
    O.latheAt(G, [[rh * 1.01, 0.0], [rh * 0.6, 0.02], [0.0, 0.026]], 18, { o: c, axis: dir, kind: PAINT.GLOW, capTop: true });
  }
  // 寶蓋 (a wide flat disc), then the stacked gourd top and a pearl
  const yt = yc + R * 0.94;
  lathe([[0.2, 0], [0.7, 0.05], [0.86, 0.1], [0.84, 0.15], [0.55, 0.19], [0.18, 0.22]], yt);
  lathe([[0.18, 0], [0.26, 0.06], [0.29, 0.18], [0.2, 0.3], [0.12, 0.34], [0.2, 0.42], [0.23, 0.5], [0.15, 0.6], [0.08, 0.64], [0.13, 0.7], [0.12, 0.78], [0.05, 0.84], [0.0, 0.92]], yt + 0.21);
  A.put({ stone: S, glow: G });
  return done(A, { baseH: 0, onWater: true });
}

// ------------------------------------------------------------------------------------------------ stone pagoda / 經幢
/** small octagonal stone pagoda: 須彌座, `levels` (9) short bodies with niches and thin stone eaves, stone finial.
 *  params: H (m, 11), r (base apothem, 0.9). After the 960 stone pagodas in front of 靈隱寺大殿 (approx.). */
export function stupa(p = {}, o = {}) {
  const A = asm(o, 'stupa');
  const S = new MeshBuilder(), Dk = new MeshBuilder();
  const H = p.H ?? 11, r0 = p.r ?? 0.9, n = p.levels ?? 9;
  const oct = (r) => r / Math.cos(Math.PI / 8);
  const lathe = (prof, y0) => O.latheAt(S, prof.map(([r, y]) => [oct(r), y]), 8, { o: [0, y0, 0], kind: PAINT.STONE, phase: Math.PI / 8, capTop: true });
  let y = 0;
  lathe([[r0 * 2.0, -0.3], [r0 * 2.0, 0.25], [r0 * 1.7, 0.35], [r0 * 1.55, 0.5], [r0 * 1.55, 0.95], [r0 * 1.75, 1.05], [r0 * 1.8, 1.2]], 0);
  y = 1.2;
  const h0 = (H - 1.2 - 1.6) / n;
  for (let i = 0; i < n; i++) {
    const r = r0 * (1 - 0.35 * (i / n)), h = h0 * (1 - 0.03 * i);
    // body, then a thin eave slab with lifted rim, then a short 平坐 band
    lathe([[r, 0], [r, h * 0.62], [r * 1.65, h * 0.68], [r * 1.72, h * 0.76], [r * 1.5, h * 0.8], [r * 0.95, h * 0.9], [r * 0.92, h]], y);
    for (let f = 0; f < 8; f += 2) {
      const a = ((f + (i % 2)) * Math.PI) / 4 + Math.PI / 8 - Math.PI / 8;
      const nx = Math.sin(a), nz = Math.cos(a), ex = Math.cos(a), ez = -Math.sin(a);
      const rn = r + 0.004, w = r * 0.28, y0 = y + h * 0.12, hh = h * 0.42;
      Dk.quad([nx * rn - ex * w, y0, nz * rn - ez * w], [nx * rn + ex * w, y0, nz * rn + ez * w], [nx * rn + ex * w, y0 + hh, nz * rn + ez * w], [nx * rn - ex * w, y0 + hh, nz * rn - ez * w], [PAINT.DARK, 0, 1, 0]);
    }
    y += h;
  }
  // finial: 覆鉢, 相輪 and a pearl, in stone
  O.latheAt(S, [[0.35, 0], [0.42, 0.12], [0.3, 0.3], [0.1, 0.34], [0.1, 0.5], [0.22, 0.54], [0.1, 0.58], [0.1, 0.78], [0.2, 0.82], [0.1, 0.86], [0.1, 1.1], [0.18, 1.25], [0.12, 1.42], [0, 1.6]], 12, { o: [0, y, 0], kind: PAINT.STONE });
  A.put({ stone: S, dark: Dk });
  return done(A, { baseH: 0 });
}

export function jingchuang(p = {}, o = {}) {
  const A = asm(o, 'jingchuang');
  const S = new MeshBuilder();
  const H = p.H ?? 5.2, r = p.r ?? 0.32;
  const oct = (x) => x / Math.cos(Math.PI / 8);
  const lathe = (prof, y0, segs = 8) => O.latheAt(S, prof.map(([a, b]) => [segs === 8 ? oct(a) : a, b]), segs, { o: [0, y0, 0], kind: PAINT.STONE, phase: Math.PI / 8, capTop: true });
  lathe([[r * 3.2, -0.2], [r * 3.2, 0.25], [r * 2.6, 0.35], [r * 2.4, 0.6], [r * 2.7, 0.7], [r * 2.2, 0.85]], 0);
  lathe([[r * 2.0, 0], [r * 2.4, 0.15], [r * 1.6, 0.3], [r * 1.2, 0.35]], 0.85, 16);   // lotus seat
  lathe([[r, 0], [r, H * 0.45]], 1.2);                                                  // the pillar with the sutra
  const yc = 1.2 + H * 0.45;
  lathe([[r * 2.4, 0], [r * 2.8, 0.12], [r * 2.4, 0.22], [r * 0.9, 0.3], [r * 0.9, 0.55], [r * 1.8, 0.62], [r * 2.0, 0.72], [r * 1.0, 0.8], [r * 0.6, 1.3], [r * 0.9, 1.45], [r * 0.4, 1.7], [0, 1.85]], yc);
  A.put({ stone: S });
  return done(A, { baseH: 0 });
}

export const PAGODAS = { leifeng, liuhe, tower, baochu, santan, stupa, jingchuang };
export function buildPagoda(kind, params = {}, opts = {}) {
  const fn = PAGODAS[kind];
  if (!fn) throw new Error('unknown pagoda kind ' + kind);
  return fn(params, { name: kind, ...opts });
}
