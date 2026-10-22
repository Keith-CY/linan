// Building types, each composed from 《营造法式》 parts by building.js. Every builder takes (params, { lod, ao, name })
// and returns { group, info }: group origin at the floor of the ground storey (platform top), front toward +Z;
// info.baseH = height of that floor above the ground it stands on (the module lifts the group by it), info.tris,
// info.calls, info.ms, info.size, info.top, info.anchors (lantern points, roof apexes).
//
//   hall       殿 / 廳堂, one storey: 歇山 | 廡殿 | 悬山 (params as plan.js)
//   chongyan   重檐: 副階周匝 around a 殿身 (palace main hall ref06, temple main halls ref04 / ref08)
//   louge      樓閣: 2+ storeys with 腰檐 and 平坐 + 勾闌 (hero building ref01)
//   ting       亭: square / hexagonal / octagonal 攢尖, or a rect 歇山 亭 (ref02, ref05, ref10)
//   shuixie    水榭 on 永定柱 piles over water, deck + 勾闌 (ref03)
//   qiao       曲橋 / 棧橋: a zig-zag plank bridge on piles with railings (ref03, ref05)
//   lang       廊: covered walkway, 悬山, benches (ref03, ref06)
//   menwu      門屋: a gate hall with the middle bay open
//   menlou     門樓: a hall on a 墩台 with a gate passage; que 闕樓 (ref06); gulou 鼓樓 (ref07)
//   presets: palace-main, duodian, jingci, lingyin-tianwang, lingyin-daxiong, temple-side
// Options in params of every kind: lanterns (true: paper lanterns at the eave corners and doors, lit at night).
import * as THREE from 'three';
import { Assembly, ringVerts } from './building.js';
import { makePlan } from './plan.js';
import { PAINT } from './geom.js';
import * as F from './fashi.js';

export function done(A, extra = {}) {
  const { group, info } = A.finish();
  Object.assign(info, extra);
  return { group, info };
}
export function asm(o, name) { return new Assembly({ lod: o.lod ?? 0, ao: o.ao ?? true, name: o.name || name, seed: o.name || name }); }
function maybeLanterns(A, p, extra = []) {
  if (!p.lanterns) return;
  const r = p.lanternR ?? 0.2;
  A.lanterns([...A.anchors.lanterns, ...extra], r);
}

// ============================================================================================ 殿 / 廳堂
export function hall(p = {}, o = {}) {
  const params = { bays: 5, rafters: 8, grade: 3, puzuo: 6, roof: 'xieshan', type: 'diange', jiaShen: 135, ...p };
  const A = asm(o, 'hall');
  const plan = A.plan(params);
  const baseH = podium(A, plan, params.platform || {});
  A.storey(plan, 0);
  A.roof(plan, 0);
  maybeLanterns(A, params, doorLanterns(plan, 0));
  return done(A, { baseH, fen: plan.fen });
}

/**
 * 階基 under a plan, optionally in tiers (palace podiums): platform { h, tiers, kind, rail, out, steps }. The upper
 * tier is the building's own 階基; each lower tier steps out by `tierOut` (m). Returns the total height.
 */
export function podium(A, plan, pf = {}) {
  if (pf.piles) {
    // in the water on 永定柱: piles, a plank deck beyond the columns, a 勾闌 round it
    const out = pf.deckOut ?? 1.6, deckY = pf.h ?? 1.0;
    const verts = ringVerts(plan.facades, (f) => plan.m(f.off) + out);
    A.piles(verts, { yTop: -0.14, yBottom: -(deckY + (pf.depth ?? 2.6)) });
    A.deck(verts, 0);
    const rv = ringVerts(plan.facades, (f) => plan.m(f.off) + out - 0.1);
    A.railing([...rv.map(([x, z]) => [x, 0, z]), [rv[0][0], 0, rv[0][1]]]);
    return deckY;
  }
  const tiers = pf.tiers ?? 1;
  if (tiers <= 1) return A.platform(plan, pf).h;
  const H = pf.h ?? plan.platformH, th = H / tiers, out0 = pf.out ?? plan.platformOut, step = pf.tierOut ?? 3.0;
  for (let t = 0; t < tiers; t++) {
    A.platform(plan, { ...pf, h: th, out: out0 + t * step, y0: -t * th, bury: t === tiers - 1 ? 0.6 : 0.05 });
  }
  return H;
}

/** lantern points hung from the 闌額 in front of the middle front bays */
function doorLanterns(plan, y0) {
  const f = plan.facades[0], m = plan.m, out = [];
  for (let i = 0; i < f.cols.length - 1; i++) {
    const s = (f.cols[i].s + f.cols[i + 1].s) / 2;
    if (Math.abs(i - (f.cols.length - 2) / 2) > 1.01) continue;
    const y = y0 + m(Math.min(f.cols[i].h, f.cols[i + 1].h) - F.LANE.h) - 0.05;
    out.push([m(f.along[0] * s + f.n[0] * (f.off + 25)), y, m(f.along[1] * s + f.n[1] * (f.off + 25))]);
  }
  return out;
}

// ============================================================================================ 重檐: 副階周匝 + 殿身
/**
 * params: the 殿身 (bays, rafters, grade, puzuo, roof 'wudian' | 'xieshan', …) + fujie { depth (分, default ≈ the
 * 梢間), puzuo (default 殿身 − 2, ≥ 4), H0 (分) } + platform { h, kind, rail }.
 * 副階 column height (卷五 · 柱): "副階廊舍下檐柱雖長不越間之廣" → H0 ≤ the 副階 depth. The 殿身 columns rise until
 * their 闌額 clears the 副階 roof's 博脊 by ~0.6 m (approx.).
 */
export function chongyan(p = {}, o = {}) {
  const params = { bays: 5, rafters: 8, grade: 2, puzuo: 7, roof: 'wudian', type: 'diange', jiaShen: 140, walls: 'hall', ...p };
  const fj = { puzuo: Math.max(4, params.puzuo - 2), ...(p.fujie || {}) };
  const A = asm(o, 'chongyan');
  const body0 = makePlan(params);
  const d = fj.depth ?? Math.round(Math.min(body0.bayW[0], 260));
  const PF = A.plan({ ...params, puzuo: fj.puzuo, bayWidths: [d, ...body0.bayW, d], depthWidths: [d, ...body0.sideBayW, d], rafters: params.rafters + 2, H0: fj.H0 ?? Math.min(d, body0.H0 * 0.8), walls: 'open', roof: 'wudian' });
  const baseH = podium(A, PF, params.platform || {});
  A.storey(PF, 0, { walls: false });
  const yy = A.yaoyan(PF, 0, body0);
  const minH0 = (yy.top + (fj.clear ?? 0.6)) / body0.fen + F.LANE.h;
  const PB = A.plan({ ...params, H0: Math.max(body0.H0, minH0), fujie: true });
  A.storey(PB, 0, { wallTop: yy.wallY - 0.08 });
  A.roof(PB, 0);
  maybeLanterns(A, params, doorLanterns(PF, 0));
  return done(A, { baseH, fen: PB.fen });
}

// ============================================================================================ 樓閣
/**
 * params: common (grade, type, shape, sides…), storeys: [ {bays|bayWidths, H0|columnRatio, puzuo, walls, …}, … ]
 * (bottom first), roof ('xieshan' | 'wudian' | 'cuanjian'), fujie (副階 around the ground storey, as chongyan),
 * platform, base: 'platform' | 'none', pingzuoRail (true).
 * Between storeys: the lower storey's 腰檐, then a 平坐 (卷四: 鋪作減上屋一跳) carrying the upper floor and 勾闌.
 */
export function louge(p = {}, o = {}) {
  const A = asm(o, 'louge');
  const r = composeLouge(A, p);
  maybeLanterns(A, p);
  return done(A, r);
}

/** the 樓閣 storey sequence into an Assembly (also used by the pagodas). Returns { baseH, fen, floors, plans } */
export function composeLouge(A, p) {
  const common = { grade: 4, type: 'diange', rafters: 6, jiaShen: 140, ang: true, ...(p.common || {}) };
  for (const k of ['grade', 'type', 'shape', 'sides', 'rafters', 'jiaShen', 'ju', 'curl', 'yaoyanCurl']) if (p[k] !== undefined) common[k] = p[k];
  const storeys = p.storeys || [
    { bays: 3, bayWidths: [300, 360, 300], columnRatio: 0.85, puzuo: 5, walls: 'louge' },
    { bays: 3, bayWidths: [285, 345, 285], columnRatio: 0.72, puzuo: 6, walls: 'louge' },
  ];
  const n = storeys.length;
  const S = storeys.map((s, i) => ({ ...common, ...s, roof: i === n - 1 ? (p.roof || 'xieshan') : 'wudian', storeys: n }));
  let P = A.plan(S[0]);
  let baseH = 0;
  let y = 0;
  const plans = [];
  if (p.fujie) {
    const d = p.fujie.depth ?? 220;
    const PF = A.plan({ ...S[0], puzuo: p.fujie.puzuo ?? Math.max(4, S[0].puzuo - 1), bayWidths: P.poly ? undefined : [d, ...P.bayW, d], depthWidths: P.poly ? undefined : [d, ...P.sideBayW, d], sideW: P.poly ? (S[0].sideW * (P.R0 + d)) / P.R0 : undefined, sideBays: S[0].sideBays, walls: 'open', rafters: (S[0].rafters || 6) + 2, H0: p.fujie.H0 ?? Math.min(d, P.H0 * 0.8), walls: 'open' });
    if (p.base !== 'none') baseH = A.platform(PF, p.platform || {}).h;
    A.storey(PF, 0, { walls: false });
    const yy = A.yaoyan(PF, 0, P);
    P = A.plan({ ...S[0], H0: Math.max(P.H0, (yy.top + 0.5) / P.fen + F.LANE.h) });
    A.storey(P, 0, { wallTop: yy.wallY - 0.08 });
  } else {
    if (p.base !== 'none') baseH = A.platform(P, p.platform || {}).h;
    A.storey(P, 0);
  }
  plans.push({ plan: P, y });
  for (let i = 1; i < n; i++) {
    const Pn = makePlan(S[i]);
    const yy = A.yaoyan(P, y, Pn);
    const yBase = y + P.m(P.H0 + P.pupaiH + (P.bracketed ? P.tierY(P.N + 1) + F.CAI : P.bracketH));
    const pz = A.pingzuo(S[i], Math.min(yBase, yy.top - 0.2), yy.top + 0.06, { rail: p.pingzuoRail !== false });
    y = pz.floorY;
    P = A.plan(S[i]);
    A.storey(P, y, { bases: false });
    plans.push({ plan: P, y });
  }
  const R = A.roof(P, y, { apex: p.apex === undefined ? 'baoding' : p.apex });
  return { baseH, fen: P.fen, floors: y, plans, apexY: A.anchors.roofs[A.anchors.roofs.length - 1].apexY, R };
}

// ============================================================================================ 亭
/**
 * params: sides (4 square | 6 | 8) for a 攢尖 亭, or roof: 'xieshan' for a rect 歇山 亭 (bays 1 | 3);
 * side (m, column to column), H (m, column height), grade (default 6: 卷四 "亭榭或小廳堂皆用之"), puzuo (5),
 * walls ('bench' 坐凳 | 'open' | 'lattice'), platform { h, out }.
 */
export function ting(p = {}, o = {}) {
  const grade = p.grade ?? 6;
  const fen = F.fenOf(grade);
  const A = asm(o, 'ting');
  let params;
  if (p.roof === 'xieshan' || p.shape === 'rect') {
    const w = (p.side ?? 5.2) / fen, dd = (p.depth ?? p.side ?? 5.2) / fen;
    const bays = p.bays ?? 1;
    const bayWidths = bays === 1 ? [w] : [w * 0.3, w * 0.4, w * 0.3];
    const db = p.depthBays ?? (bays === 1 ? 1 : 2);
    const depthWidths = db === 1 ? [dd] : db === 3 ? [dd * 0.3, dd * 0.4, dd * 0.3] : [dd * 0.5, dd * 0.5];
    // 亭榭 歇山: 轉過一椽 (卷五 · 陽馬); the 舉 of a 亭 is steeper than a 廳堂's — the 法式 gives D/2 for 鬬尖 亭榭 and
    // nothing for a 歇山 亭, so we take the 殿閣 rule (D/3), approx.
    params = { shape: 'rect', grade, type: 'tingtang', puzuo: p.puzuo ?? 4, roof: 'xieshan', bayWidths, depthWidths, rafters: db === 1 ? 4 : 6, zhuanChuan: 1, H0: (p.H ?? 3.9) / fen, duoJu: 110, walls: p.walls ?? 'bench', ju: p.ju ?? 'diange', columnD: F.TING_COLUMN_FEN, tileClass: 'ting', ...p.extra };
  } else {
    const sides = p.sides ?? 4;
    const side = p.side ?? (sides === 4 ? 4.6 : sides === 6 ? 2.9 : 2.3);
    params = { shape: 'poly', sides, grade, type: 'tingtang', puzuo: p.puzuo ?? 5, roof: 'cuanjian', sideW: side / fen, sideBays: 1, sideBuJian: side > 3.2 ? 1 : 0, H0: (p.H ?? (sides === 4 ? 3.5 : 3.2)) / fen, walls: p.walls ?? 'bench', columnD: F.TING_COLUMN_FEN, tileClass: 'ting', ...p.extra };
  }
  if (p.curl) params.curl = p.curl;
  if (p.eaveScale) params.eaveScale = p.eaveScale;
  if (p.ridgeEnd) params.ridgeEnd = p.ridgeEnd;
  if (p.zhuanChuan) params.zhuanChuan = p.zhuanChuan;
  if (p.yaoyanCurl) params.yaoyanCurl = p.yaoyanCurl;
  let plan = A.plan(params);
  let base;
  if ((p.eaves ?? 1) >= 2) {
    // 重檐亭: a 副階 ring of shorter columns carries the lower eave; the inner columns rise through it
    const d = (p.fujieDepth ?? 1.3) / fen;
    const PF = A.plan(plan.poly
      ? { ...params, sideW: (params.sideW * (plan.R0 + d)) / plan.R0, H0: params.H0 * 0.78, puzuo: Math.max(4, params.puzuo - 1), walls: 'bench' }
      : { ...params, bayWidths: [d, ...plan.bayW, d], depthWidths: [d, ...plan.sideBayW, d], rafters: 6, H0: params.H0 * 0.78, puzuo: Math.max(4, params.puzuo - 1), walls: 'bench' });
    base = A.platform(PF, { h: 0.45, out: 0.55, steps: [0], ...(p.platform || {}) });
    A.storey(PF, 0);
    const yy = A.yaoyan(PF, 0, plan);
    plan = A.plan({ ...params, H0: Math.max(params.H0, (yy.top + 0.45) / fen + F.LANE.h), walls: 'open' });
    A.storey(plan, 0, { walls: false });
  } else {
    base = A.platform(plan, { h: 0.45, out: 0.55, steps: [0], ...(p.platform || {}) });
    A.storey(plan, 0);
  }
  A.roof(plan, 0, { apex: 'baoding' });
  maybeLanterns(A, p);
  return done(A, { baseH: base.h, fen });
}

// ============================================================================================ 水榭 + 曲橋
/**
 * params: the hall (bays 3, rafters 6, grade 5, 歇山, walls 'lattice' = 格子門 all round), deckY (m above the water,
 * 1.0), deckOut (m of deck beyond the columns, 1.8), depth (water depth for the piles, 2.6), rail (true).
 * info.baseH = deckY; place it with y = water level + deckY (layout: params.onWater = true does that).
 */
export function shuixie(p = {}, o = {}) {
  const params = { bays: 3, rafters: 6, grade: 5, puzuo: 5, roof: 'xieshan', type: 'tingtang', jiaShen: 130, columnRatio: 0.82, walls: p.walls ?? 'bench', ...p };
  const deckY = p.deckY ?? 1.0, out = p.deckOut ?? 1.8, depth = p.depth ?? 2.6;
  const A = asm(o, 'shuixie');
  const plan = A.plan(params);
  const verts = ringVerts(plan.facades, (f) => plan.m(f.off) + out);
  A.piles(verts, { yTop: -0.14, yBottom: -(deckY + depth) });
  A.deck(verts, 0);
  if (p.rail !== false) {
    // railing round the deck, open in the middle of the front (landing of the bridge)
    const rv = ringVerts(plan.facades, (f) => plan.m(f.off) + out - 0.1);
    const gap = p.gap ?? 1.4;
    const a = rv[3], b = rv[0];             // front edge runs from vert 3 to vert 0
    const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    A.railing([[mid[0] + gap / 2, 0, mid[1]], [b[0], 0, b[1]], [rv[1][0], 0, rv[1][1]], [rv[2][0], 0, rv[2][1]], [a[0], 0, a[1]], [mid[0] - gap / 2, 0, mid[1]]]);
  }
  A.storey(plan, 0, { bases: false });
  A.roof(plan, 0);
  maybeLanterns(A, p);
  return done(A, { baseH: deckY, onWater: true, fen: plan.fen });
}

/**
 * 曲橋: params.points [[x, z], …] (m, building-local), width (1.8), deckY (0.6 above water), depth (2.4), rail.
 * Origin = water level + deckY (deck top). A zig-zag on piles with 勾闌 on both sides.
 */
export function qiao(p = {}, o = {}) {
  const pts = p.points || [[0, 0], [0, 8], [6, 12], [6, 20], [0, 26]];
  const w = p.width ?? 1.8, deckY = p.deckY ?? 0.6, depth = p.depth ?? 2.4;
  const A = asm(o, 'qiao');
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]), ux = (b[0] - a[0]) / L, uz = (b[1] - a[1]) / L, nx = -uz, nz = ux;
    const e = w / 2;
    // extend each segment by half a width so the corners close
    const a2 = [a[0] - ux * e * (i ? 1 : 0), a[1] - uz * e * (i ? 1 : 0)], b2 = [b[0] + ux * e * (i < pts.length - 2 ? 1 : 0), b[1] + uz * e * (i < pts.length - 2 ? 1 : 0)];
    const verts = [[a2[0] + nx * e, a2[1] + nz * e], [b2[0] + nx * e, b2[1] + nz * e], [b2[0] - nx * e, b2[1] - nz * e], [a2[0] - nx * e, a2[1] - nz * e]];
    A.piles(verts, { yTop: -0.1, yBottom: -(deckY + depth), spacing: 2.6, r: 0.1 });
    A.deck(verts, 0, { th: 0.1, fascia: 0.18 });
    if (p.rail !== false) {
      for (const sgn of [1, -1]) {
        const o2 = e - 0.06;
        A.railing([[a2[0] + nx * o2 * sgn, 0, a2[1] + nz * o2 * sgn], [b2[0] + nx * o2 * sgn, 0, b2[1] + nz * o2 * sgn]], { height: 0.85 });
      }
    }
  }
  return done(A, { baseH: deckY, onWater: true });
}

// ============================================================================================ 廊
/** params: bays (any count), bayW (m, 3.0), depth (m, 2.6), H (m, 2.9), grade (6), puzuo (0 | 2), benches (true),
 *  walls override, roof 'xuanshan' (or 'xieshan') */
export function lang(p = {}, o = {}) {
  const grade = p.grade ?? 6, fen = F.fenOf(grade);
  const n = p.bays ?? 7;
  const params = { shape: 'rect', grade, type: 'yuwu', puzuo: p.puzuo ?? 2, roof: p.roof ?? 'xuanshan', ju: 'lang', bayWidths: new Array(n).fill((p.bayW ?? 3.0) / fen), depthWidths: [(p.depth ?? 2.6) / fen], rafters: 2, H0: (p.H ?? 2.9) / fen, shengqi: false,
    walls: p.walls ?? (p.benches === false ? 'open' : { front: 'bench', back: p.backWall ? 'wall' : 'bench', left: 'open', right: 'open' }) };
  const A = asm(o, 'lang');
  const plan = A.plan(params);
  let base;
  if (p.onWater) {
    const verts = ringVerts(plan.facades, (f) => plan.m(f.off) + 0.45);
    A.piles(verts, { yTop: -0.12, yBottom: -((p.deckY ?? 1) + (p.depth ?? 2.6)), spacing: 2.6, r: 0.11 });
    A.deck(verts, 0, { th: 0.1, fascia: 0.2 });
    base = { h: p.deckY ?? 1 };
  } else base = A.platform(plan, { h: p.platformH ?? 0.3, out: 0.35, steps: [], ...(p.platform || {}) });
  A.storey(plan, 0, { bases: !p.onWater });
  A.roof(plan, 0, { gableFrames: true });
  maybeLanterns(A, p);
  return done(A, { baseH: base.h, fen });
}

// ============================================================================================ gates
/** 門屋: a gate hall, the middle bay an open passage with 版門 leaves swung back */
export function menwu(p = {}, o = {}) {
  return hall({ bays: 3, rafters: 4, grade: 5, puzuo: 5, roof: 'xieshan', type: 'tingtang', jiaShen: 140, columnRatio: 0.9, walls: 'gate', ...p }, { ...o, name: o.name || 'menwu' });
}

/**
 * 門樓: a 墩台 (brick, battered, with a 過梁式 passage — Song gates are timber-lintelled, not arched) carrying a hall.
 * params: dun { w, d, h, gate: { w, h } | null }, top: hall params (or chongyan: true), louge: storeys (for a 鼓樓).
 * Origin = ground (y 0); the hall floor is at dun.h.
 */
export function menlou(p = {}, o = {}) {
  const dun = { w: 26, d: 14, h: 7.5, gate: { w: 4.6, h: 5.2 }, ...(p.dun || {}) };
  const A = asm(o, p.kindName || 'menlou');
  A.dun({ ...dun, y0: dun.h });
  const top = { bays: 5, rafters: 6, grade: 4, puzuo: 5, roof: 'xieshan', type: 'diange', jiaShen: 140, columnRatio: 0.82, walls: 'louge', ...(p.top || {}) };
  let y = dun.h;
  const P = A.plan(top);
  A.platform(P, { y0: y, h: 0.35, out: 0.6, steps: [], bury: 0.1 });
  if (p.storeys) {
    // multi-storey 樓 (鼓樓): 腰檐 + 平坐 between storeys
    const S = p.storeys.map((s, i) => ({ ...top, ...s, roof: i === p.storeys.length - 1 ? top.roof : 'wudian', storeys: p.storeys.length }));
    let Pc = A.plan(S[0]);
    A.storey(Pc, y);
    for (let i = 1; i < S.length; i++) {
      const Pn = makePlan(S[i]);
      const yy = A.yaoyan(Pc, y, Pn);
      const yBase = y + Pc.m(Pc.H0 + Pc.pupaiH + (Pc.bracketed ? Pc.tierY(Pc.N + 1) + F.CAI : Pc.bracketH));
      const pz = A.pingzuo(S[i], Math.min(yBase, yy.top - 0.2), yy.top + 0.06);
      y = pz.floorY;
      Pc = A.plan(S[i]);
      A.storey(Pc, y, { bases: false });
    }
    A.roof(Pc, y);
  } else {
    A.storey(P, y);
    A.roof(P, y);
  }
  maybeLanterns(A, p);
  return done(A, { baseH: 0 });
}

/** 闕樓 (ref06): a tall 墩台 with a small 廡殿 pavilion and 勾闌 on top */
export function que(p = {}, o = {}) {
  return menlou({ dun: { w: 13, d: 10, h: 10, gate: null, ...(p.dun || {}) }, top: { bays: 3, rafters: 4, grade: 4, puzuo: 6, roof: 'wudian', columnRatio: 0.8, walls: 'louge', ...(p.top || {}) }, lanterns: p.lanterns, kindName: 'que' }, { ...o, name: o.name || 'que' });
}

/** 鼓樓 (ref07): a wide 墩台 with a gate passage and a two-storey 樓 */
export function gulou(p = {}, o = {}) {
  return menlou({
    dun: { w: 30, d: 17, h: 8, gate: { w: 5, h: 5.6 }, ...(p.dun || {}) },
    top: { bays: 5, rafters: 6, grade: 4, puzuo: 5, roof: 'xieshan', columnRatio: 0.78, walls: 'louge', ...(p.top || {}) },
    storeys: p.storeys || [{ columnRatio: 0.78, puzuo: 5 }, { columnRatio: 0.62, puzuo: 6, bayWidths: [230, 255, 290, 255, 230] }],
    lanterns: p.lanterns, kindName: 'gulou',
  }, { ...o, name: o.name || 'gulou' });
}

// ============================================================================================ presets
export const PRESETS = {
  // 南宋皇城 大殿 (ref06): 重檐廡殿, 第一等材 (卷四: 殿身九間至十一間則用之), 八鋪作, on a white stone terrace with 勾闌
  'palace-main': ['chongyan', { bays: 9, rafters: 10, grade: 1, puzuo: 8, roof: 'wudian', jiaShen: 150, platform: { h: 2.6, kind: PAINT.MARBLE, rail: true, out: 2.4 } }],
  // 朵殿 flanking the main hall
  duodian: ['hall', { bays: 5, rafters: 6, grade: 3, puzuo: 6, roof: 'xieshan', jiaShen: 135, platform: { h: 1.6, kind: PAINT.MARBLE, rail: true } }],
  // 廊廡 of a palace court: a closed back wall, open front
  langwu: ['lang', { bays: 9, bayW: 3.6, depth: 4.2, H: 3.6, grade: 5, puzuo: 4, roof: 'xuanshan', backWall: true }],
  // 淨慈寺 大殿 (ref04): 重檐歇山, seven bays
  jingci: ['chongyan', { bays: 7, rafters: 8, grade: 2, puzuo: 7, roof: 'xieshan', jiaShen: 140 }],
  // 靈隱寺 天王殿 / 大雄寶殿 (ref08)
  'lingyin-tianwang': ['hall', { bays: 5, rafters: 8, grade: 3, puzuo: 6, roof: 'xieshan', jiaShen: 135, walls: 'gate' }],
  'lingyin-daxiong': ['chongyan', { bays: 7, rafters: 10, grade: 2, puzuo: 7, roof: 'xieshan', jiaShen: 140 }],
  'temple-side': ['hall', { bays: 3, rafters: 6, grade: 5, puzuo: 5, roof: 'xieshan', type: 'tingtang', jiaShen: 135 }],
  // 樓閣 on a rock (ref01 hero): two storeys, 腰檐 + 平坐, 歇山
  // a near-square plan, three bays each way, white walls with small windows (ref01)
  // the ref's 樓閣 shows its 山花 to the camera (layout turns it), a broad ground storey under a deep,
  // heavy 腰檐, the upper storey set in behind its balcony under a big 歇山 with strong curl
  'louge-hero': ['louge', { grade: 4, ju: 0.3, platform: { h: 1.0, bury: 4 }, curl: { lift: 70, ridge: 34 }, storeys: [
    { bays: 3, bayWidths: [330, 380, 330], depthWidths: [380, 430, 380], rafters: 6, columnRatio: 0.72, puzuo: 5, walls: { default: ['window', 'door', 'window'] }, eaveScale: 1.6 },
    { bays: 3, bayWidths: [290, 340, 290], depthWidths: [280, 320, 280], rafters: 6, columnRatio: 0.68, puzuo: 6, walls: { default: ['window', 'door', 'window'] }, eaveScale: 1.15 },
  ] }],
  'ting-hex': ['ting', { sides: 6 }],
  'ting-oct': ['ting', { sides: 8 }],
  'ting-xieshan': ['ting', { roof: 'xieshan', side: 5.6, depth: 5.0, bays: 1 }],
};

export const BUILDERS = { hall, chongyan, louge, ting, shuixie, qiao, lang, menwu, menlou, que, gulou };

/** build any kind (or preset) by name */
export function buildBuilding(kind, params = {}, opts = {}) {
  if (PRESETS[kind]) {
    const [k, base] = PRESETS[kind];
    return BUILDERS[k](deepMerge(base, params), { name: kind, ...opts });
  }
  const fn = BUILDERS[kind];
  if (!fn) throw new Error('unknown building kind ' + kind);
  return fn(params, { name: kind, ...opts });
}
function deepMerge(a, b) {
  const out = { ...a };
  for (const [k, v] of Object.entries(b || {})) out[k] = v && typeof v === 'object' && !Array.isArray(v) && a[k] && typeof a[k] === 'object' ? deepMerge(a[k], v) : v;
  return out;
}
