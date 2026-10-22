// Roofs over any convex plan: 歇山 (廈兩頭, 九脊), 廡殿 (四阿), 悬山 (two slopes, gables), 攢尖 (鬬尖, polygon) and
// 腰檐 (a pent ring around a storey or 副階). 舉折 profile, 檐出 + 飛子, 翼角 生出 / 起翹, tiles with 勾頭 / 滴水 at the
// eave, ridges, 鴟尾 / 獸, 搏風版 + 垂魚 / 惹草, 山花, soffit, 檐椽 / 飛子 / 角梁 + 套獸. Metres, building-local frame.
//
// Faces: one per side of the 橑檐方 polygon, { n (outward unit, plan), e (= (n.z, -n.x), along the eave), L (distance
// of the 橑檐方 line from the centre), role 'main' | 'end' }. On face k a point is (t, d): t along e, d = depth in from
// the 橑檐方 line (d = 0 at the 橑檐方, d = T at the column line, d < 0 under the eave). Two faces meet (hip) where
// their depths are equal, so one height function y(d) makes the whole roof watertight; lifts and plan growth near
// the corners are functions of (own depth, neighbour depth), equal on both sides of a hip.
import * as THREE from 'three';
import { MeshBuilder, PAINT, smooth } from './geom.js';
import * as F from './fashi.js';
import * as O from './ornaments.js';

// deterministic 2D value noise for geometry (no Math.random)
function h2(i, j) { let h = (i * 374761393 + j * 668265263) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }
export function vnoise2(x, y) {
  const i = Math.floor(x), j = Math.floor(y), fx = x - i, fy = y - j;
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
  const a = h2(i, j), b = h2(i + 1, j), c = h2(i, j + 1), d = h2(i + 1, j + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

// ============================================================================================ spec from a plan
/**
 * @param {object} plan  makePlan() result
 * @param {object} [o]   y0: floor height of the storey (m); yaoyan: { dTop (m from the 橑檐方 line), slope? } for a
 *                       pent ring; kind: force 'hip' | 'xieshan' | 'gable'
 */
// ============================================================================================ curl (the references' silhouette)
// The reference images win on silhouette, curl and
// ornament; the 法式 still sets proportions and member sizes. The refs show the southern (江南) roof: the whole eave
// line sags and sweeps up into strongly lifted, thrust-out corners (翼角起翹 + 出衝), ridges that rise toward their ends,
// a heavy edge, big ridge courses and ridge-end ornaments. Every number below can be set per building
// (plan params `curl: { … }`; a 腰檐 takes `yaoyanCurl`).
//   lift      corner lift of the eave tip (分) above the plain 舉折 line (the 法式-derived 起翹 is 32 分)
//   thrust    × the 法式 生出 (卷五 · 檐) pushing the corner out in plan
//   zone      how far along the eave the sweep reaches: 1 = from the middle of the shorter side, 0.3 = outer bays only
//   pow       shape of the sweep (1 straight ramp, 2–3 a long sag curling up hard at the corner)
//   depthIn   the lift fades out this many 架 inside the column line
//   ridge     lift of the 正脊 ends (分); ridgeZone: fraction of the ridge half length that rises
//   hipTip    extra upturn of the last stretch of every hip ridge (分): the 戧 end turned up like the refs'
//   thick     × the roof thickness at the edge (連檐 + tile bed): the refs' roofs read heavy
//   fei       飛子 slope as a fraction of the 檐椽 slope (0 = the flying rafters level out, the eave edge turns up)
//   ridgeScale, chiwei, beast: × the 正脊 / 垂脊 section, the 鴟尾 and the 獸 sizes
export const CURL_SOUTH = { lift: 78, thrust: 1.8, zone: 0.85, pow: 2.2, depthIn: 0.6, ridge: 26, ridgeZone: 0.32, hipTip: 22, thick: 1.4, fei: 0.15, ridgeScale: 1.35, chiwei: 1.3, beast: 1.3 };
/** the curl a plan asks for (CURL_SOUTH + params.curl), for a roof or (yaoyan) a pent ring */
export function curlOf(params, yaoyan = false) {
  const c = { ...CURL_SOUTH, ...(params.qiqiao != null ? { lift: params.qiqiao } : {}), ...(params.curl || {}) };
  if (yaoyan) Object.assign(c, { lift: c.lift * 0.85, ridge: 0, ridgeScale: c.ridgeScale * 0.9 }, params.yaoyanCurl || {});
  return c;
}

export function roofSpec(plan, { y0 = 0, yaoyan = null, kind = null } = {}) {
  const { m, params, poly } = plan;
  const cu = curlOf(params, !!yaoyan);
  const T = m(plan.T), a = m(plan.archD);
  kind = kind || (yaoyan || poly ? 'hip' : params.roof === 'xieshan' ? 'xieshan' : params.roof === 'xuanshan' ? 'gable' : 'hip');
  let faces = plan.facades.map((f, i) => ({ name: f.name, n: f.n, e: f.along, L: m(f.off + plan.T), role: poly ? 'main' : i % 2 === 0 ? 'main' : 'end' }));
  if (kind === 'gable') faces = [faces[0], faces[2]];
  const sLast = plan.sLast;
  const nodes = yaoyan
    ? [{ d: 0, y: 0 }, { d: yaoyan.dTop, y: yaoyan.dTop * (yaoyan.slope ?? sLast) }]
    : plan.nodes.map((q) => ({ d: m(q.d), y: m(q.y) }));
  const ridgeD = yaoyan ? yaoyan.dTop : m(plan.Z_l);
  const wuExtra = yaoyan ? 0 : m(plan.wuExtra);
  if (wuExtra > 0) {
    // 廡殿 "兩頭增出脊槫各三尺": the end slopes steepen above the column line (推山-like), linear in d
    const k = wuExtra / (ridgeD - T);
    for (const f of faces) if (f.role === 'end') {
      f.unwarp = (d) => (d > T ? d - k * (d - T) : d);
      f.warp = (r) => (r > T ? (r - k * T) / (1 - k) : r);
    }
  }
  const tile = plan.tile;
  return {
    kind, faces, fen: plan.fen, poly, yaoyan: !!yaoyan,
    yL: y0 + m(plan.yLiao), thick: m(plan.roofThick) * cu.thick, T, a,
    nodes, E: m(plan.E), Ef: m(plan.Ef), sFei: plan.sLast * cu.fei, curl: cu,
    ridgeD, top: ridgeD,
    xie: kind === 'xieshan' ? { dG: m(plan.dGable), Xg: m(plan.X_g), Xp: m(plan.X_p) } : null,
    Xp: kind === 'gable' ? m(plan.X_p) : 0,
    Wh: m(plan.W) / 2,
    lift: {
      shengqi: m(plan.shengqi),
      riseZone: T + (poly ? m(plan.W) * 0.25 : Math.min(m(plan.W) - m(plan.bayW[Math.floor((plan.bayW.length - 1) / 2)] || 0), m(plan.Dp)) / 2),
      shengtou: poly || kind === 'gable' ? 0 : m(F.CAI), endBay: m(plan.endBay),
      qiqiao: m(cu.lift) * (kind === 'gable' ? 0.45 : 1),
      shengchu: kind === 'gable' ? 0 : m(plan.shengchu) * cu.thrust, c0: m(plan.sweepStart),
      zone: cu.zone, pow: cu.pow, dIn: T + cu.depthIn * a, ridge: yaoyan || poly ? 0 : m(cu.ridge), ridgeZone: cu.ridgeZone,
      hipTip: m(cu.hipTip) * (yaoyan ? 0.8 : 1),
    },
    tile: { r: (tile.tong.w * F.CUN) / 2, spacing: tile.ban.w * F.CUN, tongLen: tile.tong.l * F.CUN * 0.85, courseLen: tile.ban.l * F.CUN * 0.4 },
    rafter: { d: m(plan.rafterD), spacing: plan.rafterSpacing },
    ridge: { w: plan.ridgeW * (yaoyan ? 0.55 : 1) * cu.ridgeScale, h: plan.ridgeH * (yaoyan ? 0.45 : 1) * cu.ridgeScale },
    chiweiH: plan.chiweiH * cu.chiwei, beastH: plan.beastH * cu.beast,
    ridgeEnd: params.ridgeEnd || F.ridgeEndKind(params.type, params.storeys || 1),
    bays: poly ? 3 : params.bays,
  };
}

// ============================================================================================ the surface
export function makeRoof(S) {
  const faces = S.faces, nF = faces.length, closed = S.kind !== 'gable';
  for (const f of faces) f.e = f.e || [f.n[1], -f.n[0]];
  const nodes = S.nodes;
  const sLast = (nodes[1].y - nodes[0].y) / (nodes[1].d - nodes[0].d);
  const E = S.E, Ef = S.Ef, sFei = S.sFei ?? sLast * 0.4;
  const dTip = -(E + Ef);
  const top = S.top;
  const T = S.T, a = S.a;
  /** 舉折 line above the 橑檐方背 (m) at depth d (m), with 檐出 and the flatter 飛子 beyond */
  function P(d) {
    if (d <= 0) {
      const de = Math.max(d, -E);
      let y = de * sLast;
      if (d < -E) y += (d + E) * sFei;
      return y;
    }
    for (let i = 0; i < nodes.length - 1; i++) if (d <= nodes[i + 1].d) { const t = (d - nodes[i].d) / (nodes[i + 1].d - nodes[i].d); return nodes[i].y + t * (nodes[i + 1].y - nodes[i].y); }
    const l = nodes[nodes.length - 1], q = nodes[nodes.length - 2];
    return l.y + (d - l.d) * ((l.y - q.y) / (l.d - q.d));
  }
  const unwarp = (k, d) => (faces[k].unwarp ? faces[k].unwarp(d) : d);
  const warp = (k, r) => (faces[k].warp ? faces[k].warp(r) : r);
  const depth = (k, x, z) => warp(k, faces[k].L - (x * faces[k].n[0] + z * faces[k].n[1]));
  const nbr = (k, s) => (k + s + nF) % nF;
  /** along-position on face k at depth d where the neighbour on side s (+1 next, -1 previous) has depth c */
  function tAt(k, d, c, s) {
    const f = faces[k], g = faces[nbr(k, s)];
    const r = unwarp(k, d), cr = unwarp(nbr(k, s), c);
    const nn = f.n[0] * g.n[0] + f.n[1] * g.n[1], ne = g.n[0] * f.e[0] + g.n[1] * f.e[1];
    return (g.L - (f.L - r) * nn - cr) / ne;
  }
  function extent(k, d) {
    if (S.kind === 'gable') return [-S.Xp, S.Xp];
    if (S.kind === 'xieshan' && faces[k].role === 'main' && d >= S.xie.dG - 1e-9) return [-S.xie.Xp, S.xie.Xp];
    return [tAt(k, d, d, -1), tAt(k, d, d, +1)];
  }
  function planPt(k, t, d) { const f = faces[k]; const r = unwarp(k, d); return [f.n[0] * (f.L - r) + f.e[0] * t, f.n[1] * (f.L - r) + f.e[1] * t]; }
  const L = S.lift;
  const closed0 = S.kind !== 'gable';
  // the sweep runs along the eave from cz (depth of the neighbour face, as seen from a point of this face) out to the
  // corner; cMid = that depth at the middle of the shortest side's eave (a square 亭 sweeps all along its eave)
  let cMid = Infinity;
  if (closed0) {
    for (let k = 0; k < nF; k++) {
      const f = faces[k], g = faces[(k + 1) % nF];
      const r = (f.unwarp ? f.unwarp(dTip) : dTip);
      const x = f.n[0] * (f.L - r), z = f.n[1] * (f.L - r);
      const cr = g.L - (x * g.n[0] + z * g.n[1]);
      cMid = Math.min(cMid, g.warp ? g.warp(cr) : cr);
    }
  } else cMid = dTip + S.Xp;
  const cz = dTip + (L.zone ?? 0.3) * (cMid - dTip);
  const sweep = (c, p) => { const u = Math.min(1, Math.max(0, (cz - c) / Math.max(1e-6, cz - dTip))); return Math.pow(u, p); };
  const dIn = L.dIn ?? T;
  // the 正脊 ends: c at the ridge end and at the ridge middle (depth of the end face)
  let cEndR = top, cMidR = top;
  if (L.ridge && !S.poly) {
    if (S.kind === 'gable') { cEndR = dTip; cMidR = dTip + S.Xp; }
    else {
      const g = faces[1], xr = S.kind === 'xieshan' ? S.xie.Xp : 0;
      cMidR = g.warp ? g.warp(g.L) : g.L;
      cEndR = S.kind === 'xieshan' ? g.L - xr : top;
    }
  }
  const cR = cEndR + (L.ridgeZone ?? 0.3) * (cMidR - cEndR);
  function lift(c, d) {
    if (!isFinite(c)) return 0;
    const eave = 1 - smooth(T, T + 2 * a, d);                // 生起 lives in the eave structure
    const L1 = L.shengqi * smooth(L.riseZone, T, c) * eave;
    const L2 = closed0 ? L.shengtou * smooth(T + L.endBay, T, c) : 0;  // 生頭木 on every 梢間 槫 (ridge ends rise too)
    // 起翹: the eave sags along its length and sweeps up into the corner (the refs' southern curl)
    const L3 = L.qiqiao * sweep(c, L.pow ?? 2) * smooth(dIn, dTip, d);
    // the 正脊 rising toward its ends
    let L4 = 0;
    if (L.ridge && cR > cEndR + 1e-6) { const u = Math.min(1, Math.max(0, (cR - c) / (cR - cEndR))); L4 = L.ridge * u * u * smooth(top - 2.5 * a, top, d); }
    return L1 + L2 + L3 + L4;
  }
  const grow = (c, d) => L.shengchu * sweep(c, Math.max(1, (L.pow ?? 2) * 0.75)) * smooth(dIn, dTip, d);
  const near = (k) => (nF <= 4 ? [...Array(nF).keys()] : [nbr(k, -1), k, nbr(k, 1)]);
  // an old roof is never true: the tile bed sags a little between purlins and undulates (a few cm), a function of
  // the plan position only, so both slopes agree at a hip; nothing at the eave tip and the ridge
  const sagAmp = S.sag ?? 0.03;
  const uneven = (x, z, d) => sagAmp * (vnoise2(x * 0.45 + 3.1, z * 0.45 - 1.7) - 0.5 + 0.6 * (vnoise2(x * 1.3, z * 1.3 + 9.0) - 0.5)) * smooth(dTip, dTip + 0.6, d) * (1 - smooth(top - 0.8, top, d));
  /** point on face k at (t, d), `off` above the finished surface (m) */
  function point(k, t, d, off = 0) {
    const [x, z] = planPt(k, t, d);
    let gx = 0, gz = 0, c = closed ? Infinity : dTip + S.Xp - Math.abs(t);
    if (closed) {
      const ks = near(k);
      const ds = ks.map((j) => (j === k ? d : depth(j, x, z)));
      for (let i = 0; i < ks.length; i++) {
        let cj = Infinity;
        for (let q = 0; q < ks.length; q++) if (q !== i && ds[q] < cj) cj = ds[q];
        const g = grow(cj, ds[i]);
        if (g) { gx += faces[ks[i]].n[0] * g; gz += faces[ks[i]].n[1] * g; }
        if (ks[i] !== k && ds[i] < c) c = ds[i];
      }
    }
    return [x + gx, S.yL + P(d) + S.thick + lift(c, d) + uneven(x, z, d) + off, z + gz];
  }
  function normal(k, t, d) {
    const e = 0.05;
    const p0 = point(k, t - e, d), p1 = point(k, t + e, d), q0 = point(k, t, d - e), q1 = point(k, t, d + e);
    const ta = new THREE.Vector3(p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]);
    const td = new THREE.Vector3(q0[0] - q1[0], q0[1] - q1[1], q0[2] - q1[2]);
    const n = new THREE.Vector3().crossVectors(ta, td).normalize();
    if (n.y < 0) n.negate();
    return n;
  }
  /** depth where the hip on the side of t crosses along-position t (rows end there); dHi if it never does */
  function hipDepth(k, t, dHi = top) {
    const s = t >= 0 ? 1 : -1;
    const f = (d) => Math.abs(tAt(k, d, d, s)) - Math.abs(t);
    if (f(dHi) >= 0) return dHi;
    let lo = dTip, hi = dHi;
    if (f(lo) < 0) return lo;
    for (let i = 0; i < 40; i++) { const mid = (lo + hi) / 2; if (f(mid) >= 0) lo = mid; else hi = mid; }
    return lo;
  }
  // slope length from the eave tip (tile courses)
  const sTable = []; { let s = 0, prev = P(dTip); for (let i = 0; i <= 400; i++) { const d = dTip + ((top - dTip) * i) / 400; const y = P(d); if (i) s += Math.hypot((top - dTip) / 400, y - prev); prev = y; sTable.push(s); } }
  const slopeLen = (d) => { const f = ((d - dTip) / (top - dTip)) * 400; const i = Math.max(0, Math.min(399, Math.floor(f))); return sTable[i] + (sTable[i + 1] - sTable[i]) * (f - i); };
  return { S, faces, nF, closed, kind: S.kind, T, a, E, Ef, dTip, top, ridgeD: S.ridgeD, thick: S.thick, yL: S.yL, P, sLast, tAt, extent, planPt, point, normal, lift, hipDepth, slopeLen, depth, nbr };
}

// ============================================================================================ build
/**
 * @returns {{ tile: MeshBuilder, wood: MeshBuilder, plaster: MeshBuilder }}
 * opts: lod (0 full, 1 no tile rows / rafters, 2 shell only), ornaments (true), apex (攢尖: 'baoding' | null)
 */
export function buildRoof(R, { lod = 0, ornaments = true, apex = 'baoding', gableFrames = true } = {}) {
  const tile = new MeshBuilder(), wood = new MeshBuilder(), plaster = new MeshBuilder();
  const S = R.S;
  const soffitIn = Math.min(R.top - 0.02, R.T + 0.6 * R.a);
  const step = lod >= 2 ? 0.9 : 0.22, across = lod >= 2 ? 1.2 : 0.3;
  for (let k = 0; k < R.nF; k++) {
    const f = R.faces[k];
    const paintY = lod >= 1 ? 1 : 0; // vPaint.y = 1 asks the tile shader to paint the 甋瓦 rows itself (no geometry)
    // field u counts rows (rows at n + 0.5) so the shader's channels line up with the 甋瓦 rows
    const [e0, e1] = R.extent(k, R.dTip);
    const rsp = (e1 - e0) / (Math.floor((e1 - e0) / S.tile.spacing) + 1);
    const uOf = (t) => (t - e0) / rsp;
    const field = (d0, d1, ext) => faceGrid(R, tile, k, d0, d1, ext, { step, across, paintY, uOf });
    if (R.kind === 'xieshan' && f.role === 'main') {
      field(R.dTip, S.xie.dG, (d) => [R.tAt(k, d, d, -1), R.tAt(k, d, d, 1)]);
      field(S.xie.dG, R.ridgeD, () => [-S.xie.Xp, S.xie.Xp]);
      // underside of the gable overhang (beyond the 山花)
      for (const sg of [-1, 1]) faceGrid(R, wood, k, S.xie.dG, R.ridgeD - 0.05, () => (sg > 0 ? [S.xie.Xg - 0.05, S.xie.Xp] : [-S.xie.Xp, -S.xie.Xg + 0.05]), { off: -R.thick, kind: PAINT.RAFTER, down: true, step, across });
    } else if (R.kind === 'xieshan') field(R.dTip, S.xie.dG, (d) => R.extent(k, d));
    else if (R.kind === 'gable') {
      field(R.dTip, R.ridgeD, () => [-S.Xp, S.Xp]);
      for (const sg of [-1, 1]) faceGrid(R, wood, k, R.T + 0.3 * R.a, R.ridgeD - 0.05, () => (sg > 0 ? [S.Wh - 0.05, S.Xp] : [-S.Xp, -S.Wh + 0.05]), { off: -R.thick, kind: PAINT.RAFTER, down: true, step, across });
    } else field(R.dTip, R.top, (d) => R.extent(k, d));
    faceGrid(R, wood, k, R.dTip, soffitIn, (d) => R.extent(k, d), { off: -R.thick, kind: PAINT.RAFTER, down: true, step, across });
    fascia(R, wood, k);
  }
  const st = (globalThis.__yzRoofStats ||= {});
  const c0 = tile.count;
  if (lod <= 1) tileEnds(R, tile, lod);
  const c1 = tile.count;
  if (lod === 0) tileRows(R, tile);
  const c2 = tile.count;
  ridges(R, tile, wood, plaster, { lod, ornaments, apex, gableFrames });
  st.field = (st.field || 0) + c0 / 3; st.ends = (st.ends || 0) + (c1 - c0) / 3; st.rows = (st.rows || 0) + (c2 - c1) / 3; st.ridges = (st.ridges || 0) + (tile.count - c2) / 3;
  if (lod === 0) rafters(R, wood, tile);
  else cornerBeams(R, wood, tile);
  return { tile, wood, plaster };
}

function faceGrid(R, B, k, d0, d1, ext, { off = 0, kind = PAINT.TILE, down = false, step = 0.22, across = 0.3, paintY = 0, uOf = (t) => t } = {}) {
  if (d1 - d0 < 1e-4) return;
  const nd = Math.max(2, Math.ceil((d1 - d0) / step));
  for (let i = 0; i < nd; i++) {
    const da = d0 + ((d1 - d0) * i) / nd, db = d0 + ((d1 - d0) * (i + 1)) / nd;
    const ea = ext(da), eb = ext(db);
    const span = Math.max(ea[1] - ea[0], eb[1] - eb[0]);
    if (span <= 1e-5) continue;
    const na = Math.max(1, Math.ceil(span / across));
    for (let q = 0; q < na; q++) {
      const t0 = q / na, t1 = (q + 1) / na;
      const a0 = ea[0] + (ea[1] - ea[0]) * t0, a1 = ea[0] + (ea[1] - ea[0]) * t1;
      const b0 = eb[0] + (eb[1] - eb[0]) * t0, b1 = eb[0] + (eb[1] - eb[0]) * t1;
      const p00 = R.point(k, a0, da, off), p01 = R.point(k, a1, da, off), p11 = R.point(k, b1, db, off), p10 = R.point(k, b0, db, off);
      const sa = R.slopeLen(da), sb = R.slopeLen(db);
      const pa = (s) => [kind, paintY, 0, s];
      const uv = [[uOf(a0), sa], [uOf(a1), sa], [uOf(b1), sb], [uOf(b0), sb]];
      if (!down) B.quad(p00, p01, p11, p10, pa(sa), pa(sa), pa(sb), pa(sb), uv);
      else {
        // an underside faces down whatever the face's own frame: check the winding (some end faces came out inverted
        // and their soffit was culled: the sky showed between the rafters)
        const ux = p10[0] - p00[0], uy = p10[1] - p00[1], uz = p10[2] - p00[2], vx = p11[0] - p00[0], vz = p11[2] - p00[2];
        const ny = uz * vx - ux * vz;
        if (ny <= 0) B.quad(p00, p10, p11, p01, pa(sa), pa(sb), pa(sb), pa(sa), [uv[0], uv[3], uv[2], uv[1]]);
        else B.quad(p00, p01, p11, p10, pa(sa), pa(sa), pa(sb), pa(sb), uv);
        void uy;
      }
    }
  }
}

function fascia(R, B, k) {
  const e = R.extent(k, R.dTip);
  const n = Math.max(2, Math.ceil((e[1] - e[0]) / 0.3));
  const pa = [PAINT.ZHU, 0, R.thick, 0];
  for (let q = 0; q < n; q++) {
    const a0 = e[0] + ((e[1] - e[0]) * q) / n, a1 = e[0] + ((e[1] - e[0]) * (q + 1)) / n;
    const t0 = R.point(k, a0, R.dTip, 0), t1 = R.point(k, a1, R.dTip, 0);
    const b0 = R.point(k, a0, R.dTip, -R.thick), b1 = R.point(k, a1, R.dTip, -R.thick);
    B.quad(b1, b0, t0, t1, pa);
  }
}

// ============================================================================================ tiles
/** open half-round section of a 甋瓦 row (the underside is never seen), from the right foot over the top */
function tileSection(r, n) {
  const sec = [[r, -0.035]];
  for (let i = 0; i <= n; i++) { const a = (i / n) * Math.PI; sec.push([Math.cos(a) * r, Math.sin(a) * r * 0.95]); }
  sec.push([-r, -0.035]);
  return sec;
}
/** the along-positions of the 甋瓦 rows on face k (evenly spread over the eave line) */
function rowPositions(R, k) {
  const { spacing } = R.S.tile;
  const [e0, e1] = R.extent(k, R.dTip);
  const n = Math.floor((e1 - e0) / spacing);
  const out = [];
  for (let i = 0; i <= n; i++) out.push(e0 + ((e1 - e0) * (i + 0.5)) / (n + 1) + (h2(i, k * 31 + 7) - 0.5) * 0.02);
  return out;
}
/** [d0, d1] runs of the row at along t on face k */
function rowRuns(R, k, t) {
  const S = R.S, r = S.tile.r;
  const stop = R.top - (S.yaoyan ? 0.06 : 0.12);
  const at = Math.abs(t);
  if (R.kind === 'gable') return [[R.dTip, stop]];
  if (R.kind === 'xieshan' && R.faces[k].role === 'main') {
    if (at <= S.xie.Xg) return [[R.dTip, stop]];
    const runs = [[R.dTip, Math.min(R.hipDepth(k, t, S.xie.dG) - 0.06, S.xie.dG)]];
    if (at <= S.xie.Xp - r) runs.push([S.xie.dG + 0.05, stop]);
    return runs;
  }
  const dTop = R.kind === 'xieshan' ? S.xie.dG - 0.05 : stop;
  return [[R.dTip, Math.min(R.hipDepth(k, t, dTop + 0.06) - 0.06, dTop)]];
}
function tileRows(R, B) {
  const { r } = R.S.tile;
  const sec = tileSection(r, 5);
  const lift = r * 0.25;
  for (let k = 0; k < R.nF; k++) for (const t of rowPositions(R, k)) for (const [d0, d1] of rowRuns(R, k, t)) {
    if (d1 - d0 < 0.15) continue;
    // finer near the eave where the 飛子 / 起翹 bend the row, coarser up the slope
    const ds = [];
    for (let d = d0; d < d1 - 1e-6;) { ds.push(d); d += d < R.T * 0.5 ? 0.28 : 0.6; }
    ds.push(d1);
    const n = ds.length - 1;
    const path = [];
    for (let i = 0; i <= n; i++) {
      const d = ds[i];
      const p = R.point(k, t, d, lift);
      const nn = R.normal(k, t, d);
      const q = R.point(k, t, Math.min(d1, d + 0.02), lift), q0 = R.point(k, t, Math.max(d0, d - 0.02), lift);
      path.push({ p, t: [q[0] - q0[0], q[1] - q0[1], q[2] - q0[2]], up: [nn.x, nn.y, nn.z] });
    }
    B.sweep(path, sec, { kind: PAINT.TILE, along0: R.slopeLen(d0), closed: false });
  }
}
/** 勾頭 at the eave end of every row and 滴水 in every channel between them (卷十三: 華頭甋瓦, 重脣瓪瓦) */
function tileEnds(R, B, lod) {
  const { r, spacing } = R.S.tile;
  const lift = r * 0.25;
  for (let k = 0; k < R.nF; k++) {
    const ts = rowPositions(R, k);
    const f = R.faces[k];
    for (let i = 0; i < ts.length; i++) {
      const t = ts[i];
      const d0 = R.dTip;
      const p = R.point(k, t, d0, lift), q = R.point(k, t, d0 + 0.05, lift);
      const tan = new THREE.Vector3(p[0] - q[0], p[1] - q[1], p[2] - q[2]).normalize(); // down the slope
      const out = new THREE.Vector3(tan.x * 0.55 + f.n[0] * 0.45, tan.y * 0.55, tan.z * 0.55 + f.n[1] * 0.45).normalize();
      // each 勾頭 sits a little differently (set by hand in mortar)
      const jx = (h2(i, k * 13 + 1) - 0.5) * 0.012, jy = (h2(i, k * 13 + 2) - 0.5) * 0.01;
      if (lod === 0) O.goutou(B, [p[0] + out.x * 0.005 + jx, p[1] + out.y * 0.005 + jy, p[2] + out.z * 0.005 - jx], [out.x + jx * 2, out.y + jy * 3, out.z], r * 1.02);
      if (i < ts.length - 1) {
        const tm = (t + ts[i + 1]) / 2;
        const c = R.point(k, tm, d0, 0.0);
        const nn = R.normal(k, tm, d0);
        const c2 = R.point(k, tm, d0 + 0.05, 0);
        const dn = new THREE.Vector3(c[0] - c2[0], c[1] - c2[1], c[2] - c2[2]).normalize();
        const sideV = new THREE.Vector3().crossVectors(nn, dn).normalize();
        O.dishui(B, c, sideV.toArray(), dn.toArray(), nn.toArray(), Math.max(0.05, spacing - 2 * r * 0.55), r);
      }
    }
  }
}

// ============================================================================================ ridges & ornaments
function ridgeSection(w, h, cap = 0.6) {
  const s = [[w / 2, -0.12], [w / 2, h * 0.25], [w * 0.42, h]];
  const r = w * 0.3;
  for (let i = 1; i < 6; i++) { const a = (i / 6) * Math.PI; s.push([Math.cos(a) * r, h + Math.sin(a) * r * cap]); }
  s.push([-w * 0.42, h], [-w / 2, h * 0.25], [-w / 2, -0.12]);
  return s;
}
export function sweepLine(B, pts, upFn, section, kind) {
  const path = pts.map((p, i) => {
    const q = pts[Math.min(pts.length - 1, i + 1)], q0 = pts[Math.max(0, i - 1)];
    return { p, t: [q[0] - q0[0], q[1] - q0[1], q[2] - q0[2]], up: upFn(p, i) };
  });
  B.sweep(path, section, { kind });
  for (const [i, sgn] of [[0, -1], [pts.length - 1, 1]]) {
    const f = path[i];
    const t = new THREE.Vector3(...f.t).normalize(), up = new THREE.Vector3(...f.up), side = new THREE.Vector3().crossVectors(t, up).normalize();
    up.crossVectors(side, t).normalize();
    const P = (q) => [f.p[0] + side.x * q[0] + up.x * q[1], f.p[1] + side.y * q[0] + up.y * q[1], f.p[2] + side.z * q[0] + up.z * q[1]];
    const ctr = P([0, section.reduce((s, q) => s + q[1], 0) / section.length]);
    for (let k = 0; k < section.length; k++) {
      const a = P(section[k]), b = P(section[(k + 1) % section.length]);
      if (sgn > 0) B.tri(ctr, a, b, [kind, 0, 1, 0]); else B.tri(ctr, b, a, [kind, 0, 1, 0]);
    }
  }
}
const UP = () => [0, 1, 0];

function ridges(R, tile, wood, plaster, { lod, ornaments, apex, gableFrames }) {
  const S = R.S;
  const w = S.ridge.w, h = S.ridge.h;
  const wv = Math.max(0.12, w - 2 * F.CUN), hv = Math.max(0.1, h - 2 * F.RIDGE_COURSE_CUN * F.CUN);
  const beastH = S.beastH * 0.8 * (S.yaoyan ? 0.6 : 1); // 垂脊獸 降正脊獸一等
  const orn = ornaments && lod <= 1;
  const ornRidge = ornaments && lod <= 2;   // the ridge-end ornaments stay on the skyline at every LOD
  // ---- 正脊 (rect roofs) along face 0 at the ridge
  if (!S.yaoyan && !S.poly) {
    const xEnd = R.kind === 'hip' ? R.tAt(0, R.ridgeD, R.ridgeD, 1) + 0.05 : R.kind === 'xieshan' ? S.xie.Xp + 0.02 : S.Xp + 0.02;
    const pts = [];
    const nR = Math.max(8, Math.ceil((2 * xEnd) / 0.4));
    for (let i = 0; i <= nR; i++) { const t = -xEnd + (2 * xEnd * i) / nR; const p = R.point(0, t, R.ridgeD, 0); pts.push([p[0], p[1] - 0.04, p[2]]); }
    sweepLine(tile, pts, UP, ridgeSection(w, h), PAINT.RIDGE);
    // 鴟尾 at both ends on 殿 / 樓閣 (卷十三 · 用鴟尾); a 正脊獸 on 廳堂 (卷十三 · 用獸頭等)
    if (ornRidge && S.ridgeEnd !== 'plain') for (const sx of [-1, 1]) {
      const p = pts[sx > 0 ? pts.length - 1 : 0];
      const e0 = R.faces[0].e, out = [e0[0] * sx, e0[1] * sx];
      if (S.ridgeEnd === 'chiwei') {
        const H = R.kind === 'gable' ? Math.min(S.chiweiH, 0.9) : S.chiweiH;
        O.chiwei(tile, { origin: [p[0] - out[0] * 0.05 * H, p[1] + h * 0.35, p[2] - out[1] * 0.05 * H], outward: out, H, thick: w * 1.15, res: lod >= 2 ? 14 : lod === 1 ? 26 : 44 });
      } else {
        const H = Math.max(0.45, S.beastH * 0.75);
        O.beast(tile, O.BEAST, { origin: [p[0] - out[0] * 0.12 * H, p[1] + h * 0.5, p[2] - out[1] * 0.12 * H], facing: [-out[0], -out[1]], H, thick: w * 0.9 });
      }
    }
  }
  // ---- 攢尖 apex
  if (S.poly && !S.yaoyan && apex === 'baoding') {
    const p = R.point(0, 0, R.ridgeD - 0.01, 0);
    O.baoding(tile, [p[0], p[1] - 0.15, p[2]], Math.max(0.6, S.chiweiH * 0.45));
  }
  // ---- 歇山: 垂脊 along the gables, 博脊 at the 山花 foot, gables
  if (R.kind === 'xieshan') {
    const xie = S.xie;
    for (const sx of [-1, 1]) for (const k of [0, 2]) {
      const pts = [];
      const n = 14;
      const tg = (k === 0 ? sx : -sx) * (xie.Xp - wv * 0.35);
      for (let i = 0; i <= n; i++) { const d = R.ridgeD - 0.05 - ((R.ridgeD - 0.05 - (xie.dG - 0.15)) * i) / n; pts.push(R.point(k, tg, d, -0.02)); }
      sweepLine(tile, pts, (p, i) => { const nn = R.normal(k, tg, R.ridgeD - 0.05 - ((R.ridgeD - xie.dG + 0.1) * i) / n); return [nn.x * 0.3, 1, nn.z * 0.3]; }, ridgeSection(wv, hv), PAINT.RIDGE);
      const e = pts[pts.length - 1];
      if (orn) O.beast(tile, O.BEAST, { origin: [e[0], e[1] + hv * 0.4, e[2]], facing: R.faces[k].n, H: beastH, thick: wv * 0.85 });
    }
    for (const k of [1, 3]) {
      const zz = R.tAt(k, xie.dG, xie.dG, 1);
      const pts = [];
      for (let i = 0; i <= 10; i++) { const t = -zz + (2 * zz * i) / 10; const p = R.point(k, t, xie.dG - 0.02, 0); pts.push([p[0] - R.faces[k].n[0] * 0.03, p[1] - 0.05, p[2] - R.faces[k].n[1] * 0.03]); }
      sweepLine(tile, pts, UP, ridgeSection(wv * 0.75, hv * 0.55), PAINT.RIDGE);
    }
    if (lod <= 1) gables(R, wood, plaster, gableFrames);
  }
  // ---- 悬山: 垂脊 along both gable edges, 搏風版
  if (R.kind === 'gable') {
    for (const sx of [-1, 1]) for (let k = 0; k < 2; k++) {
      const tg = (k === 0 ? sx : -sx) * (S.Xp - wv * 0.3);
      const pts = [];
      const n = 12;
      for (let i = 0; i <= n; i++) { const d = R.ridgeD - 0.05 - ((R.ridgeD - 0.05 - (R.dTip + 0.08)) * i) / n; pts.push(R.point(k, tg, d, -0.02)); }
      sweepLine(tile, pts, UP, ridgeSection(wv * 0.8, hv * 0.7), PAINT.RIDGE);
    }
    if (lod <= 1) bargeBoards(R, wood, plaster, gableFrames);
  }
  // ---- hips: 角脊 / 戗脊 / 垂脊 from the top down to the corner, 獸 + 蹲獸 + 嬪伽
  if (R.closed) {
    const hipTop = R.kind === 'xieshan' ? S.xie.dG : R.top;
    for (let k = 0; k < R.nF; k++) {
      const pts = [];
      const n = 24;
      const tipUp = S.lift.hipTip || 0;
      for (let i = 0; i <= n; i++) {
        const d = hipTop - 0.05 - ((hipTop - 0.05 - (R.dTip + 0.06)) * i) / n;
        const p = R.point(k, R.tAt(k, d, d, 1), d, -0.02);
        // the 戧 end turns up over the last stretch (the refs' upswept hip ends)
        const u = Math.max(0, (i / n - 0.72) / 0.28);
        p[1] += tipUp * u * u;
        pts.push(p);
      }
      sweepLine(tile, pts, UP, ridgeSection(wv * 0.92 * (S.yaoyan ? 0.8 : 1), hv * 0.9), PAINT.RIDGE);
      if (!orn) continue;
      const at = (frac) => pts[Math.min(n, Math.round(frac * n))];
      const g = R.faces[R.nbr(k, 1)];
      const f = R.faces[k];
      const outward = [f.n[0] + g.n[0], f.n[1] + g.n[1]]; const ol = Math.hypot(...outward); outward[0] /= ol; outward[1] /= ol;
      const hipLen = Math.hypot(pts[0][0] - pts[n][0], pts[0][2] - pts[n][2]);
      if (!S.yaoyan && !S.poly) { const b = at(0.62); O.beast(tile, O.BEAST, { origin: [b[0], b[1] + hv * 0.5, b[2]], facing: outward, H: beastH * 0.85, thick: wv * 0.75 }); }
      // 蹲獸 every few tiles behind the 嬪伽 ("每隔三瓦或五瓦安獸一枚")
      const nd = S.yaoyan ? 1 : Math.min(F.dunshouCount(S.bays), 4);
      const gap = (3 * S.tile.tongLen) / Math.max(1, hipLen);
      for (let q = 0; q < nd; q++) { const p = at(0.9 - gap * (q + 1)); O.beast(tile, O.SQUAT, { origin: [p[0], p[1] + hv * 0.45, p[2]], facing: outward, H: beastH * 0.42, thick: wv * 0.5, res: 18 }); }
      const tip = at(0.94);
      O.beast(tile, O.PINJIA, { origin: [tip[0], tip[1] + hv * 0.4, tip[2]], facing: outward, H: beastH * 0.55, thick: wv * 0.5, res: 18 });
    }
  }
  // ---- 腰檐: 博脊 against the wall along every face top
  if (S.yaoyan) for (let k = 0; k < R.nF; k++) {
    const [t0, t1] = R.extent(k, R.top - 0.02);
    const pts = [];
    for (let i = 0; i <= 8; i++) { const t = t0 + ((t1 - t0) * i) / 8; const p = R.point(k, t, R.top - 0.02, 0); pts.push([p[0], p[1] - 0.04, p[2]]); }
    sweepLine(tile, pts, UP, ridgeSection(w * 0.8, h * 0.7), PAINT.RIDGE);
  }
}

function gables(R, wood, plaster, frames) {
  const S = R.S, xie = S.xie, fen = S.fen;
  const bh = F.BOFENG.h * fen, bt = Math.max(0.025, F.BOFENG.w * fen);
  for (const sx of [-1, 1]) {
    const kEnd = sx > 0 ? 1 : 3;
    const x = sx * (xie.Xp + bt / 2 + 0.01);
    for (const k of [0, 2]) {
      const pts = [];
      const n = 16;
      const tg = (k === 0 ? sx : -sx) * xie.Xp;
      for (let i = 0; i <= n; i++) {
        const d = R.ridgeD - ((R.ridgeD - (xie.dG - 0.25)) * i) / n;
        const p = R.point(k, tg, d, -R.thick * 0.45);
        pts.push([x, p[1], p[2]]);
      }
      const sec = [[bt / 2, -bh], [bt / 2, 0], [-bt / 2, 0], [-bt / 2, -bh]];
      sweepLine(wood, pts, UP, sec, PAINT.ZHU);
    }
    // 垂魚 at the apex (卷七: 垂魚長三尺至一丈; 每長一尺則廣六寸)
    const apex = R.point(0, sx * xie.Xp, R.ridgeD, -R.thick * 0.45);
    const len = Math.min(2.2, Math.max(1.1, (R.P(R.ridgeD) - R.P(xie.dG)) * 0.55));
    const wd = len * 0.6;
    const fish = [[0, 0.02], [0.12, -0.05], [0.1, -0.3], [0.32, -0.55], [0.5, -0.62], [0.42, -0.8], [0.22, -0.78], [0.12, -1.0], [0, -0.9],
      [-0.12, -1.0], [-0.22, -0.78], [-0.42, -0.8], [-0.5, -0.62], [-0.32, -0.55], [-0.1, -0.3], [-0.12, -0.05]];
    O.inflate(wood, fish.map(([s, y]) => [s * wd / len, y]), { origin: [x + sx * (bt / 2 + 0.03), apex[1] - bh * 0.55, 0], dir: [0, 1], size: len, thick: 0.07, kind: PAINT.ZHU, res: 24, rim: 0.6, power: 1 });
    // 惹草 under the 搏風版 at the 槫 ends (每長一尺則廣七寸)
    for (const k of [0, 2]) {
      const sz = k === 0 ? 1 : -1;
      for (let s = 1; s < 3; s++) {
        const d = R.ridgeD - s * R.a;
        if (d < xie.dG + 0.2) break;
        const p = R.point(k, (k === 0 ? sx : -sx) * xie.Xp, d, -R.thick * 0.45);
        const L2 = len * 0.45;
        const cloud = [[0, 0], [0.3, -0.06], [0.42, -0.26], [0.3, -0.42], [0.36, -0.62], [0.18, -0.8], [0.0, -0.66], [-0.06, -0.36]];
        O.inflate(wood, cloud.map(([q, y]) => [q * sz, y]), { origin: [x + sx * 0.02, p[1] - bh * 0.6, p[2]], dir: [0, 1], size: L2, thick: 0.05, kind: PAINT.ZHU, res: 16, rim: 0.6, power: 1 });
      }
    }
    // 山花: plaster gable face at X_g with the gable frame (平梁, 蜀柱, 叉手) in front
    const zz = R.tAt(kEnd, xie.dG, xie.dG, 1);
    const n = 12;
    const yBot = R.point(kEnd, 0, xie.dG, 0)[1] - 0.05;
    const topAt = (z) => R.point(0, sx * xie.Xg, R.ridgeD - Math.abs(z), -R.thick - 0.03)[1];
    const xg = sx * (xie.Xg + 0.04);
    for (let i = 0; i < n; i++) {
      const z0 = -zz + (2 * zz * i) / n, z1 = -zz + (2 * zz * (i + 1)) / n;
      const A = [xg, yBot, z0], B = [xg, yBot, z1], C = [xg, topAt(z1), z1], D = [xg, topAt(z0), z0];
      const pa = [PAINT.PLASTER, 0, 3, 0];
      if (sx < 0) plaster.quad(A, B, C, D, pa, pa, pa, pa, [[z0, yBot], [z1, yBot], [z1, C[1]], [z0, D[1]]]);
      else plaster.quad(A, D, C, B, pa, pa, pa, pa, [[z0, yBot], [z0, D[1]], [z1, C[1]], [z1, yBot]]);
    }
    if (frames) gableFrame(wood, sx * (xie.Xg + 0.08), yBot, topAt(0), Math.max(0.3, zz * 0.55));
  }
}

/** 平梁 + 蜀柱 + 叉手 in a gable plane at x */
function gableFrame(wood, xf, yBot, yTop, zb) {
  const yBeam = yBot + (yTop - yBot) * 0.45;
  const box = (z0, y0, z1, y1) => wood.box(xf - 0.05, y0, z0, xf + 0.05, y1, z1, PAINT.MEMBER, 'z');
  box(-zb, yBeam - 0.22, zb, yBeam);
  box(-0.09, yBeam, 0.09, yTop - 0.05);
  for (const sgn of [-1, 1]) barBetween(wood, [xf, yBeam, sgn * zb * 0.95], [xf, yTop - 0.12, 0], 0.14, 0.1, PAINT.MEMBER, [1, 0, 0]);
}

/** 悬山 gables: 搏風版 along both slopes beyond the end walls, and the plastered gable triangle with its frame */
function bargeBoards(R, wood, plaster, frames) {
  const S = R.S, fen = S.fen;
  const bh = Math.max(0.12, F.BOFENG.h * fen * 0.8), bt = 0.03;
  for (const sx of [-1, 1]) {
    const x = sx * (S.Xp + bt / 2);
    for (let k = 0; k < 2; k++) {
      const tg = (k === 0 ? sx : -sx) * S.Xp;
      const pts = [];
      const n = 14;
      for (let i = 0; i <= n; i++) { const d = R.ridgeD - ((R.ridgeD - R.dTip) * i) / n; const p = R.point(k, tg, d, -R.thick * 0.35); pts.push([x, p[1], p[2]]); }
      sweepLine(wood, pts, UP, [[bt / 2, -bh], [bt / 2, 0], [-bt / 2, 0], [-bt / 2, -bh]], PAINT.ZHU);
    }
    // gable triangle over the end wall (x = ±W/2), from the 橑檐方 line up to the roof underside
    const xg = sx * (S.Wh + 0.02);
    const zz = R.faces[0].L - R.T;
    const yBot = R.yL - 0.02;
    const topAt = (z) => R.point(0, sx * S.Wh, R.faces[0].L - Math.abs(z), -R.thick - 0.02)[1];
    const n = 10;
    for (let i = 0; i < n; i++) {
      const z0 = -zz + (2 * zz * i) / n, z1 = -zz + (2 * zz * (i + 1)) / n;
      const yt0 = topAt(z0), yt1 = topAt(z1);
      const A = [xg, yBot, z0], B = [xg, yBot, z1], C = [xg, yt1, z1], D = [xg, yt0, z0];
      const pa = [PAINT.PLASTER, 0, 3, 0];
      if (sx < 0) plaster.quad(A, B, C, D, pa, pa, pa, pa, [[z0, yBot], [z1, yBot], [z1, yt1], [z0, yt0]]);
      else plaster.quad(A, D, C, B, pa, pa, pa, pa, [[z0, yBot], [z0, yt0], [z1, yt1], [z1, yBot]]);
    }
    if (frames) gableFrame(wood, sx * (S.Wh + 0.07), yBot, topAt(0), Math.max(0.3, zz * 0.5));
  }
}

/** box of width w × height h hanging below the p0→p1 line on the `up` side */
export function barBetween(B, p0, p1, w, h, kind, up) {
  const g = new MeshBuilder();
  const L = Math.hypot(p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]);
  g.box(-w / 2, -h, 0, w / 2, 0, L, kind, 'z');
  const zA = new THREE.Vector3(p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]).normalize();
  const xA = new THREE.Vector3().crossVectors(new THREE.Vector3(...up), zA).normalize();
  const yA = new THREE.Vector3().crossVectors(zA, xA).normalize();
  B.append(g, new THREE.Matrix4().makeBasis(xA, yA, zA).setPosition(p0[0], p0[1], p0[2]));
}

// ============================================================================================ rafters & corner beams
function rafters(R, B, Tl) {
  const S = R.S;
  const rd = S.rafter.d, sp = S.rafter.spacing;
  const fei = { w: rd * F.FEIZI_SECTION.w, h: rd * F.FEIZI_SECTION.h };
  const dIn = Math.min(R.top - 0.05, R.T + 0.55 * R.a);   // rafter tails hidden above the bracket sets
  const dEnd = -R.E;                                       // 檐椽 end
  const dFeiTail = -R.E * 0.45;
  const cyl = (p0, p1, r, kind) => {
    const g = new MeshBuilder();
    const L = Math.hypot(p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]);
    g.lathe([[r, 0], [r, L]], 8, { kind, capTop: true, capBottom: false, phase: Math.PI / 8 });
    const dir = new THREE.Vector3(p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]).normalize();
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    B.append(g, new THREE.Matrix4().compose(new THREE.Vector3(...p0), q, new THREE.Vector3(1, 1, 1)));
  };
  const under = (k, t, d, off) => R.point(k, t, d, -R.thick - off);
  for (let k = 0; k < R.nF; k++) {
    // straight rafters between the two corner zones (or the whole length on a 悬山)
    let lo, hi;
    if (!R.closed) { lo = -S.Xp + sp * 0.5; hi = S.Xp - sp * 0.5; }
    else { lo = R.tAt(k, dEnd, S.lift.c0, -1); hi = R.tAt(k, dEnd, S.lift.c0, 1); }
    if (hi > lo) {
      const n = Math.max(1, Math.floor((hi - lo) / sp));
      for (let i = 0; i <= n; i++) {
        const u = lo + ((hi - lo) * i) / n;
        cyl(under(k, u, dIn, rd / 2 + 0.004), under(k, u, dEnd, rd / 2 + 0.004), rd / 2, PAINT.RAFTER);
        const nn = R.normal(k, u, dEnd);
        barBetween(B, under(k, u, dFeiTail, 0.004), under(k, u, R.dTip + 0.01, 0.004), fei.w, fei.h, PAINT.RAFTER, [nn.x, nn.y, nn.z]);
      }
    }
    if (!R.closed) continue;
    // 翼角椽: fanning toward the corner — outer ends spaced along the eave, tails gathered toward the 角梁
    for (const s of [-1, 1]) {
      const a0 = s > 0 ? Math.max(hi, 0) : Math.min(lo, 0);
      const tipT = R.tAt(k, dEnd, dEnd, s);
      const tailT = R.tAt(k, dIn, dIn, s);
      const span = Math.abs(tipT - a0);
      const kk = Math.max(1, Math.floor(span / sp));
      for (let j = 1; j < kk; j++) {
        const u = a0 + (tipT - a0) * (j / kk);
        const tailFrac = Math.pow(j / kk, 0.8);
        const uTail = a0 + (tailT - a0) * tailFrac;
        cyl(under(k, uTail, dIn, rd / 2 + 0.004), under(k, u, dEnd, rd / 2 + 0.004), rd / 2, PAINT.RAFTER);
        const uF = a0 + (R.tAt(k, R.dTip, R.dTip, s) - a0) * (j / kk);
        const nn = R.normal(k, u, dEnd);
        barBetween(B, under(k, u, dFeiTail, 0.004), under(k, uF, R.dTip + 0.01, 0.004), fei.w, fei.h, PAINT.RAFTER, [nn.x, nn.y, nn.z]);
      }
    }
  }
  cornerBeams(R, B, Tl);
}

/** 大角梁 under the hip from inside to the 檐椽 end, 子角梁 above it out to the corner tip (head turned up), 套獸 */
function cornerBeams(R, B, Tl) {
  if (!R.closed) return;
  const S = R.S, fen = S.fen;
  const da = { w: F.JIAOLIANG.da.w * fen, h: F.JIAOLIANG.da.h * fen }, zi = { w: F.JIAOLIANG.zi.w * fen, h: F.JIAOLIANG.zi.h * fen };
  for (let k = 0; k < R.nF; k++) {
    const hip = (d, off) => R.point(k, R.tAt(k, d, d, 1), d, -R.thick - off);
    const dIn = Math.min(R.top - 0.05, R.T + 0.4 * R.a);
    barBetween(B, hip(dIn, 0.01), hip(-R.E * 0.92, 0.01), da.w, da.h, PAINT.MEMBER, [0, 1, 0]);
    const tip = hip(R.dTip - 0.05, -0.02);
    const head = [tip[0], tip[1] + 7 * fen, tip[2]];
    barBetween(B, hip(Math.min(dIn, R.T * 0.3), -0.02), head, zi.w, zi.h, PAINT.MEMBER, [0, 1, 0]);
    // 套獸 on the 子角梁 head
    const g = R.faces[R.nbr(k, 1)], f = R.faces[k];
    const out = new THREE.Vector3(f.n[0] + g.n[0], -0.25, f.n[1] + g.n[1]).normalize();
    O.taoshou(Tl, [head[0] + out.x * 0.02, head[1] - zi.h * 0.5, head[2] + out.z * 0.02], out.toArray(), zi.h * 0.48);
  }
}
