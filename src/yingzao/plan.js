// Storey plan: turns the parameters of one storey (殿 / 廳堂 / 亭 / 塔 storey / 廊 / house frame) into every dimension
// the builders need. Pure (no three.js). Two plan shapes:
//   rect: 面闊 bays × 進深 (two 架 per depth bay unless depthWidths says otherwise)      (halls, 廊, 樓閣, 門樓)
//   poly: a regular N-gon of columns (亭, 塔 storeys); sideBays bays per side
// Local frame: origin at the plan centre on the floor (y 0), +X to the right seen from the front, +Z toward the
// FRONT, +Y up. Lengths in 分 unless noted (m(x) converts); numbers follow fashi.js (each cites 卷 / section).
//
// facades: one per side, { name, n:[nx,nz] outward, along:[ax,az] (= (n.z, -n.x)), off (column line distance from
// the centre), len, cols:[{s,h}], units:[{s,kind}] } — a façade point is along·s + n·(off + o).
// Face k+1 follows face k at its s = +len/2 end (front → right → back → left for rect).
import * as F from './fashi.js';

export const DEFAULTS = {
  type: 'diange',       // 'diange' 殿閣 | 'tingtang' 廳堂 | 'yuwu' 餘屋 (柱徑, 椽徑, 布椽)
  shape: 'rect',        // 'rect' | 'poly'
  bays: 5,              // 面闊間數 (odd), rect
  rafters: 8,           // 椽數 = 進深架數 (even): 八架椽屋, rect
  grade: 3,             // 材等 1..8 (卷四: 殿身三間至殿五間 → 第三等)
  puzuo: 6,             // 鋪作 4..8; 2 = 把頭絞項作 (no 跳); 0 = no bracket sets (beam on the column head)
  ang: true,            // 下昂 (false = all 華栱 / 卷頭)
  roof: 'xieshan',      // 'xieshan' 歇山 | 'wudian' 廡殿 | 'cuanjian' 攢尖 | 'xuanshan' 悬山 (two slopes)
  ju: F.JU_DEFAULT,     // 舉折 rule: 'diange' | 'tingtang' | 'tingtang-ban' | 'lang' | 'wu' | number (舉高 / 前後橑檐方)
  buJian: [2, 1],       // 補間鋪作 朵數: 當心間, 其餘間 (卷四: 當心間須用補間鋪作兩朵，次間及梢間各用一朵)
  duoJu: 125,           // 朵距 between 鋪作 centres (分), approx. (the text only asks "令遠近皆勻"; Song halls ≈ 100–150)
  jiaShen: 150,         // 架深 = horizontal rafter span (分) (卷五: 每架平不過六尺, 殿閣或加五寸至一尺五寸)
  columnRatio: 0.92,    // 平柱高 / 當心間廣, approx. (卷五: 副階廊舍下檐柱雖長不越間之廣; Song halls ≈ 0.8–1.0)
  H0: null,             // explicit 平柱 height (分), overrides columnRatio
  zhuanChuan: 2,        // 廈兩頭: 角梁轉過兩椽 (卷五 · 陽馬; 亭榭 1)
  bayWidths: null,      // explicit 面闊 bay widths (分), rect
  depthWidths: null,    // explicit 進深 bay widths (分), rect (default: two 架 each)
  sides: 8,             // poly: number of sides
  sideW: 260,           // poly: bay width (分) along a side
  sideBays: 1,          // poly: bays per side
  sideBuJian: 1,        // poly: 補間 per bay
  doors: 'auto',        // rect front bays with 格子門 (others get 破子櫺窗)
  walls: 'hall',        // wall scheme, see body.js wallKind()
  shengqi: true,        // 生起 of the corner columns
  columnD: null,        // explicit column diameter (分)
  tileClass: null,      // 'ting' | 'sanwu': the smaller tiles of 卷十三 · 用瓦
  qiqiao: null,         // 起翹 at the corner (分), default fashi QIQIAO_FEN (32); southern towers take more (approx.)
  shengchuScale: 1,     // × the 生出 of 卷五 · 檐
  eaveScale: 1,         // × the 檐出 (and with it the 飛子): matching a reference's overhang 
  seed: 1103,
};

export function makePlan(input = {}) {
  const p = { ...DEFAULTS, ...input };
  const fen = F.fenOf(p.grade);
  const m = (x) => x * fen; // 分 → m
  const poly = p.shape === 'poly';
  const colD = p.columnD ?? F.columnDiameter(p.type);   // 分

  // ---------------- bracket stack (分 above the 櫨枓 bottom)
  const bracketed = p.puzuo >= 4;
  const batou = p.puzuo === 2 || p.puzuo === 3;
  const N = bracketed ? p.puzuo - 3 : 0;                  // 跳 count
  const tiers = bracketed ? F.puzuoTiers(p.puzuo, { ang: p.ang }) : [];
  const tierY = (t) => 12 + 21 * t; // tier bottom: 櫨枓 耳 8 → 12, then 材 15 + 栔 6 per tier
  const seatY = (j) => tierY(j - 1) + F.CAI - (j >= 3 && p.ang ? F.ANG.dropAbove5 : 0);
  const liaoyanBottom = bracketed ? tierY(N + 1) - (N >= 3 && p.ang ? F.ANG.dropAbove5 : 0) : batou ? tierY(1) : 0;
  const pupaiH = p.puzuo > 0 ? F.PUPAI.h : 0;
  const bracketH = liaoyanBottom + F.LIAOYAN.h;           // 櫨枓 bottom (or column head) → 橑檐方背
  const T = N * F.TIAO;                                   // 出跳 total (分)

  // ---------------- plan
  let facades, columns, corners, W, Dp, bayW, colX, colZ, depthBays, sideBayW, H0, shengqi, R0 = 0;
  const a = p.jiaShen;
  if (!poly) {
    if (p.bayWidths) p.bays = p.bayWidths.length;
    else if (p.bays % 2 !== 1) throw new Error('bays must be odd');
    if (p.rafters % 2 !== 0) throw new Error('rafters must be even');
    const k = Math.floor((p.bays - 1) / 2);
    bayW = p.bayWidths ? [...p.bayWidths] : [];
    if (!p.bayWidths) for (let i = -k; i <= k; i++) bayW.push(((i === 0 ? p.buJian[0] : p.buJian[1]) + 1) * p.duoJu);
    W = bayW.reduce((s, b) => s + b, 0);
    colX = [-W / 2]; for (const w of bayW) colX.push(colX[colX.length - 1] + w);
    sideBayW = p.depthWidths ? [...p.depthWidths] : new Array(p.rafters / 2).fill(2 * a);
    Dp = sideBayW.reduce((s, b) => s + b, 0);
    depthBays = sideBayW.length;
    colZ = [-Dp / 2]; for (const w of sideBayW) colZ.push(colZ[colZ.length - 1] + w);
    H0 = p.H0 ?? p.columnRatio * bayW[k];
    shengqi = p.shengqi ? (F.shengqiCun(p.bays) * F.CUN) / fen : 0;
    // rise grows bay by bay from the 平柱 toward the corner ("自平柱疊進向角漸次生起，令勢圜和")
    const riseX = (i) => { const n = Math.abs(i - p.bays / 2); const steps = Math.max(0, Math.ceil(n) - 1); return k ? Math.min(1, steps / k) * shengqi : 0; };
    const riseZ = (j) => { const half = depthBays / 2; const n = Math.abs(j - half); return half ? (n / half) * shengqi : 0; };
    columns = [];
    for (let i = 0; i <= p.bays; i++) for (let j = 0; j <= depthBays; j++) {
      const onFront = j === 0 || j === depthBays, onSide = i === 0 || i === p.bays;
      if (!onFront && !onSide) continue; // perimeter (檐柱) only
      const rise = Math.max(onFront ? riseX(i) : 0, onSide ? riseZ(j) : 0, onFront && onSide ? shengqi : 0);
      const h = H0 + rise;
      // 側腳: front/back columns lean along X toward the middle (1/100), side columns along Z (8/1000); corners both
      const cx = colX[i], cz = colZ[j];
      const leanX = onFront ? -Math.sign(cx) * F.CEJIAO_FRONT * h : 0;
      const leanZ = onSide ? -Math.sign(cz) * F.CEJIAO_SIDE * h : 0;
      columns.push({ i, j, x: cx, z: cz, h, rise, corner: onFront && onSide, front: onFront, side: onSide, leanX, leanZ });
    }
    const colH = (x, z) => columns.find((c) => Math.abs(c.x - x) < 1e-6 && Math.abs(c.z - z) < 1e-6).h;
    const units = (cols, bays, counts) => {
      const out = [];
      for (let b = 0; b < bays.length; b++) {
        const x0 = cols[b], n = counts[b];
        out.push({ s: x0, kind: b === 0 ? 'corner' : 'column' });
        for (let q = 1; q <= n; q++) out.push({ s: x0 + (bays[b] * q) / (n + 1), kind: 'bujian' });
      }
      out.push({ s: cols[cols.length - 1], kind: 'corner' });
      return out;
    };
    const frontCounts = bayW.map((w, b) => (p.bayWidths ? Math.max(0, Math.round(w / p.duoJu) - 1) : b === k ? p.buJian[0] : p.buJian[1]));
    const sideCounts = sideBayW.map((w) => Math.max(0, Math.round(w / p.duoJu) - 1));
    const fu = units(colX, bayW, frontCounts), su = units(colZ, sideBayW, sideCounts);
    facades = [
      { name: 'front', n: [0, 1], along: [1, 0], off: Dp / 2, len: W, bays: bayW, cols: colX.map((x) => ({ s: x, h: colH(x, Dp / 2) })), units: fu },
      { name: 'right', n: [1, 0], along: [0, -1], off: W / 2, len: Dp, bays: [...sideBayW].reverse(), cols: colZ.map((z) => ({ s: -z, h: colH(W / 2, z) })).reverse(), units: su.map((u) => ({ ...u, s: -u.s })).reverse() },
      { name: 'back', n: [0, -1], along: [-1, 0], off: Dp / 2, len: W, bays: [...bayW].reverse(), cols: colX.map((x) => ({ s: -x, h: colH(x, -Dp / 2) })).reverse(), units: fu.map((u) => ({ ...u, s: -u.s })).reverse() },
      { name: 'left', n: [-1, 0], along: [0, 1], off: W / 2, len: Dp, bays: sideBayW, cols: colZ.map((z) => ({ s: z, h: colH(-W / 2, z) })), units: su },
    ];
    corners = [[1, 1], [1, -1], [-1, -1], [-1, 1]].map(([sx, sz]) => ({ x: sx * W / 2, z: sz * Dp / 2, h: colH(sx * W / 2, sz * Dp / 2), bis: [sx * Math.SQRT1_2, sz * Math.SQRT1_2], theta: Math.PI / 2 }));
  } else {
    const n = p.sides, beta = (2 * Math.PI) / n;
    sideBayW = new Array(p.sideBays).fill(p.sideW);
    const len = p.sideW * p.sideBays;
    R0 = len / (2 * Math.tan(beta / 2));                 // apothem of the column ring
    H0 = p.H0 ?? p.columnRatio * p.sideW;
    shengqi = p.shengqi ? (F.shengqiCun(Math.max(3, p.sideBays)) * F.CUN) / fen : 0; // approx.: a 三間 rise at the corners
    W = Dp = 2 * R0;
    bayW = sideBayW; depthBays = p.sideBays;
    facades = []; columns = []; corners = [];
    for (let kf = 0; kf < n; kf++) {
      const al = kf * beta;
      const nn = [Math.sin(al), Math.cos(al)], along = [nn[1], -nn[0]];
      const cols = [], us = [];
      for (let b = 0; b <= p.sideBays; b++) {
        const s = -len / 2 + b * p.sideW;
        const corner = b === 0 || b === p.sideBays;
        cols.push({ s, h: H0 + (corner ? shengqi : 0) });
        us.push({ s, kind: corner ? 'corner' : 'column' });
        if (b < p.sideBays) for (let q = 1; q <= p.sideBuJian; q++) us.push({ s: s + (p.sideW * q) / (p.sideBuJian + 1), kind: 'bujian' });
      }
      facades.push({ name: 'side' + kf, n: nn, along, off: R0, len, bays: sideBayW, cols, units: us });
      // columns: the start corner of this side + its intermediate columns (each corner once)
      for (let b = 0; b < p.sideBays; b++) {
        const s = -len / 2 + b * p.sideW;
        const x = along[0] * s + nn[0] * R0, z = along[1] * s + nn[1] * R0;
        const corner = b === 0;
        const h = H0 + (corner ? shengqi : 0);
        const r = Math.hypot(x, z) || 1;
        columns.push({ x, z, h, rise: corner ? shengqi : 0, corner, front: true, side: false, leanX: -(x / r) * F.CEJIAO_FRONT * h, leanZ: -(z / r) * F.CEJIAO_FRONT * h });
      }
      // corner unit at the end of this side (shared with the next)
      const x = along[0] * (len / 2) + nn[0] * R0, z = along[1] * (len / 2) + nn[1] * R0, r = Math.hypot(x, z);
      corners.push({ x, z, h: H0 + shengqi, bis: [x / r, z / r], theta: beta });
    }
  }
  for (const f of facades) {
    const cs = f.cols;
    // a corner unit stands on the corner column; the façade keeps only its inner units
    f.inner = f.units.filter((u) => u.kind !== 'corner');
    f.top = (s) => {
      if (s <= cs[0].s) return cs[0].h;
      for (let i = 0; i < cs.length - 1; i++) if (s <= cs[i + 1].s) { const t = (s - cs[i].s) / (cs[i + 1].s - cs[i].s); return cs[i].h + t * (cs[i + 1].h - cs[i].h); }
      return cs[cs.length - 1].h;
    };
    // turning angle between this façade's normal and the next one's: 90° rect, 360/N poly
    f.turn = poly ? (2 * Math.PI) / p.sides : Math.PI / 2;
  }

  // ---------------- roof (舉折), measured from the 橑檐方 line inward: d = 0 at the 橑檐方, d = T at the column line
  const rafterD = F.rafterDiameter(p.type);               // 分
  let nodes, juH, D, X_l, Z_l, dGable = 0, X_g = 0, X_p = 0, chuji = 0, wuExtra = 0, zc = 0, archD = a;
  if (!poly) {
    const halfSeams = p.rafters / 2;
    X_l = W / 2 + T; Z_l = Dp / 2 + T;
    D = 2 * Z_l;                                          // 前後橑檐方心相去
    juH = F.juHeight(D, p.ju);
    archD = Dp / p.rafters;                               // 架 depth actually used (= jiaShen unless depthWidths)
    // nodes from the ridge outward: ridge, 上平槫 … 下平槫 (one per 架 inside the column line), 橑檐方
    const xs = [];
    for (let s = 0; s < halfSeams; s++) xs.push(s * archD);
    xs.push(halfSeams * archD + T);
    const ys = F.zheWu(xs, juH);
    nodes = xs.map((x, i) => ({ d: Z_l - x, y: ys[i] })).reverse(); // d ascending: 橑檐方 (0) … ridge (Z_l)
    zc = p.roof === 'xieshan' ? p.zhuanChuan : halfSeams;
    dGable = T + zc * archD;                              // end slopes reach this far in (轉過 zc 椽)
    X_g = W / 2 - zc * archD;                             // 山花 plane
    chuji = p.type === 'diange' ? archD : (F.chujiChi(p.rafters) * F.CHI) / fen; // 出際 (殿閣轉角造即出際長隨架)
    X_p = p.roof === 'xuanshan' ? W / 2 + (F.chujiChi(p.rafters) * F.CHI) / fen : Math.min(X_g + chuji, X_l);
    // 廡殿: "兩頭增出脊槫各三尺" (8 椽 5 間 to 10 椽 7 間)
    wuExtra = p.roof === 'wudian' && p.bays >= 5 && p.rafters >= 8 ? (3 * F.CHI) / fen : 0;
  } else {
    X_l = Z_l = R0 + T;
    D = 2 * Z_l;
    nodes = F.cuanjianNodes(Z_l).map((q) => ({ d: q.d, y: q.y * (p.cuanRise ?? 1) })); // cuanRise: a reference's flatter or steeper crown 
    juH = nodes[nodes.length - 1].y;
  }
  const sLast = (nodes[1].y - nodes[0].y) / (nodes[1].d - nodes[0].d); // 檐椽 slope (last 舉折 segment)
  const E = (F.eaveOut(m(rafterD)) / fen) * (p.eaveScale ?? 1); // 檐出 (分); eaveScale: the refs' pavilions overhang less 
  const Ef = F.FEIZI_RATIO * E;                           // 飛子
  const sFei = sLast * 0.4;                               // 飛子 flatter than the 檐椽, approx.
  const dTip = -(E + Ef);
  const roofThick = rafterD + 14;                         // 椽 + 望板 + 苫背 / tile bed, approx. 24 分 in all

  // corner sweep
  const nb = poly ? p.sideBays : p.bays;
  const shengchu = (F.shengchuCun(nb) * F.CUN) / fen;    // 生出 (分)
  const endBay = poly ? sideBayW[0] * p.sideBays : Math.min(bayW[0], 2 * a);
  const sweepStart = T + endBay / 2;                      // from the 次角柱補間鋪作心 (卷五 · 檐)

  // ---------------- platform (階基)
  const platformH = F.platformHeightCun(p.grade) * F.CUN;  // m (立基 其高與材五倍)
  const platformOut = F.PLATFORM_OUT_CHI * F.CHI;          // m beyond the column centres (階頭)

  // ---------------- tiles, ridges, beasts
  const courses = F.ridgeCourses(p.type, poly ? 3 : p.bays, poly ? 4 : p.rafters);

  return {
    params: p, fen, m, poly,
    bayW, W, colX, Dp, a, archD, colZ, depthBays, sideBayW, R0,
    colD, H0, shengqi, columns, corners, facades,
    N, tiers, tierY, seatY, liaoyanBottom, bracketH, T, pupaiH, bracketed, batou,
    rafterD, X_l, Z_l, D, juH, nodes, sLast, E, Ef, sFei, dTip, roofThick,
    dGable, X_g, X_p, chuji, wuExtra, shengchu: shengchu * p.shengchuScale, qiqiao: p.qiqiao ?? F.QIQIAO_FEN, sweepStart, zc, endBay,
    platformH, platformOut, tile: F.tileSizeCun(poly ? 3 : p.bays, p.tileClass), courses,
    rafterSpacing: F.rafterSpacingCun(p.type) * F.CUN,     // m
    ridgeH: courses * F.RIDGE_COURSE_CUN * F.CUN,          // m
    ridgeW: F.ridgeWidthChi(courses) * F.CHI,              // m
    chiweiH: F.chiweiChi(poly ? 1 : p.bays, { rafters: p.rafters, storeys: p.storeys || 1, fujie: !!p.fujie }) * F.CHI, // m
    beastH: F.beastChi(courses) * F.CHI,                   // m (垂脊獸 降正脊獸一等, applied by the builder)
    /** 橑檐方背 above the floor at the 平柱 (分) */
    yLiao: H0 + pupaiH + bracketH,
  };
}
