// Storey body: 階基 + 踏道, 柱礎, 梭柱 (生起, 側腳), 闌額 (七朱八白), 普拍方, continuous 柱頭方 / 羅漢方 / 橑檐方,
// 栱眼壁, walls, 格子門 / 版門 / 破子櫺窗 / 坐凳, the dark interior or a 平棊 ceiling. Metres, storey-local frame
// (floor at y 0, see plan.js). Works on rect and polygon plans (plan.facades).
import * as THREE from 'three';
import { MeshBuilder, PAINT } from './geom.js';
import * as F from './fashi.js';

/** box between two points along a horizontal-ish axis: top-centre line p0→p1, width w (horizontal), height h down */
export function beam(B, p0, p1, w, h, kind = PAINT.MEMBER, { normalizeU = false, faces = 0b111111, along0 = 0 } = {}) {
  const dx = p1[0] - p0[0], dz = p1[2] - p0[2];
  const L = Math.hypot(dx, dz) || 1;
  const ux = dx / L, uz = dz / L, nx = -uz, nz = ux; // horizontal normal (left)
  const c = (p, side, down) => [p[0] + nx * side * w / 2, p[1] - down, p[2] + nz * side * w / 2];
  const P = (s, v) => [kind, v, h, normalizeU ? s / L : along0 + s];
  const A0 = c(p0, -1, h), A1 = c(p1, -1, h), A2 = c(p1, -1, 0), A3 = c(p0, -1, 0);
  const B0 = c(p0, 1, h), B1 = c(p1, 1, h), B2 = c(p1, 1, 0), B3 = c(p0, 1, 0);
  const uv = (s0, v0, s1, v1) => [[s0, v0], [s1, v0], [s1, v1], [s0, v1]];
  if (faces & 1) B.quad(A1, A0, A3, A2, P(L, 0), P(0, 0), P(0, h), P(L, h), uv(L, 0, 0, h));
  if (faces & 2) B.quad(B0, B1, B2, B3, P(0, 0), P(L, 0), P(L, h), P(0, h), uv(0, 0, L, h));
  if (faces & 4) B.quad(A3, B3, B2, A2, P(0, h), P(0, h), P(L, h), P(L, h), uv(0, 0, L, w));            // top
  if (faces & 8) B.quad(A0, A1, B1, B0, P(0, 0), P(L, 0), P(L, 0), P(0, 0), uv(0, 0, L, w));            // bottom
  if (faces & 16) B.quad(A0, B0, B3, A3, P(0, 0), P(0, 0), P(0, h), P(0, h));                           // end 0
  if (faces & 32) B.quad(B1, A1, A2, B2, P(L, 0), P(L, 0), P(L, h), P(L, h));                           // end 1
}

/** a vertical wall slab along p0→p1 (both at the wall's foot), height h, thickness t, faces subdivided ~cell
 *  (AO / damp / grime gradients need vertices). kind PLASTER / BRICK / STONE / WHITEWASH … */
export function wallSlab(B, p0, p1, h, t, kind, { cell = 0.5, top = true, ends = true, y0 = 0, sides = [1, -1] } = {}) {
  const dx = p1[0] - p0[0], dz = p1[2] - p0[2], L = Math.hypot(dx, dz) || 1;
  const ux = dx / L, uz = dz / L, nx = -uz, nz = ux;
  const nu = Math.max(1, Math.ceil(L / cell)), nv = Math.max(1, Math.ceil(h / cell));
  const at = (s, side, y) => [p0[0] + ux * s + nx * side * t / 2, y0 + y, p0[2] + uz * s + nz * side * t / 2];
  const pa = (s, y) => [kind, y, h, s];
  for (const side of sides) {
    const A = at(0, side, 0), Bp = at(L, side, 0), C = at(L, side, h), D = at(0, side, h);
    const uvAt = (u, v) => [u * L, v * h];
    const paintAt = (u, v) => pa(u * L, v * h);
    if (side > 0) B.quadGrid(A, Bp, C, D, nu, nv, paintAt, uvAt);
    else B.quadGrid(Bp, A, D, C, nu, nv, (u, v) => pa((1 - u) * L, v * h), (u, v) => [(1 - u) * L, v * h]);
  }
  if (top) B.quad(at(0, -1, h), at(0, 1, h), at(L, 1, h), at(L, -1, h), pa(0, h), pa(0, h), pa(L, h), pa(L, h), [[0, 0], [0, t], [L, t], [L, 0]]);
  if (ends) {
    B.quad(at(0, -1, 0), at(0, 1, 0), at(0, 1, h), at(0, -1, h), pa(0, 0), pa(0, 0), pa(0, h), pa(0, h), [[0, 0], [t, 0], [t, h], [0, h]]);
    B.quad(at(L, 1, 0), at(L, -1, 0), at(L, -1, h), at(L, 1, h), pa(L, 0), pa(L, 0), pa(L, h), pa(L, h), [[0, 0], [t, 0], [t, h], [0, h]]);
  }
}

/** horizontal convex polygon (verts CCW seen from above = counter-clockwise in x, -z), facing up or down */
export function polyCap(B, verts, y, kind, up = true) {
  const c = verts.reduce((a, v) => [a[0] + v[0] / verts.length, a[1] + v[1] / verts.length], [0, 0]);
  for (let i = 0; i < verts.length; i++) {
    const a = verts[i], b = verts[(i + 1) % verts.length];
    const A = [c[0], y, c[1]], P1 = [a[0], y, a[1]], P2 = [b[0], y, b[1]];
    const pa = [kind, 0, 1, 0];
    const cr = (P1[0] - A[0]) * (P2[2] - A[2]) - (P1[2] - A[2]) * (P2[0] - A[0]);
    // y-up normal needs (P1-A) × (P2-A) with positive y: cross_y = dz1*dx2 - dx1*dz2 = -cr
    if ((-cr > 0) === up) B.tri(A, P1, P2, pa, pa, pa, [c[0], c[1]], [a[0], a[1]], [b[0], b[1]]);
    else B.tri(A, P2, P1, pa, pa, pa, [c[0], c[1]], [b[0], b[1]], [a[0], a[1]]);
  }
}

// ---------------------------------------------------------------------------------------------- platform
/**
 * 階基 with 壓闌石 kerb, corner stones and 踏道 (卷三 石作 · 踏道; 卷十五 · 壘階基). Rect or polygon (follows the plan).
 * o: h (m, default 立基 rule), out (m beyond the column line, default 階頭), bury (m below), steps: list of façade
 * indices that get a 踏道 (default front + back / every other side), kind (STONE | MARBLE | BRICK).
 * Returns { verts (top outline), h, edges: [[p0, p1], ...] (top edge segments, for 勾闌) }.
 */
export function buildPlatform(plan, S, o = {}) {
  const { m } = plan;
  const H = o.h ?? plan.platformH, out = o.out ?? plan.platformOut, bury = o.bury ?? 0.6;
  const kind = o.kind ?? PAINT.STONE;
  const fs = plan.facades;
  // top outline: each façade line pushed out by `out`, intersected with its neighbours
  const verts = [];
  for (let k = 0; k < fs.length; k++) {
    const f = fs[k], g = fs[(k + 1) % fs.length];
    const pf = m(f.off) + out, pg = m(g.off) + out;
    // solve p·n_f = pf, p·n_g = pg
    const det = f.n[0] * g.n[1] - f.n[1] * g.n[0];
    verts.push([(pf * g.n[1] - pg * f.n[1]) / det, (f.n[0] * pg - g.n[0] * pf) / det]);
  }
  // sides (subdivided), kerb band, top paving
  const edges = [];
  for (let k = 0; k < verts.length; k++) {
    const a = verts[(k - 1 + verts.length) % verts.length], b = verts[k];
    // façade k runs from vert k-1 to vert k
    wallSlab(S, [a[0], 0, a[1]], [b[0], 0, b[1]], H + bury, 0.001, kind, { cell: 0.7, top: false, ends: false, y0: -H - bury, sides: [1] });
    edges.push([[a[0], 0, a[1]], [b[0], 0, b[1]]]);
  }
  polyCap(S, verts, 0.0, kind, true);
  // 壓闌石: a slightly proud kerb ring
  const kerb = verts.map(([x, z]) => { const r = Math.hypot(x, z); return [x * (1 + 0.012 / r), z * (1 + 0.012 / r)]; });
  for (let k = 0; k < kerb.length; k++) {
    const a = kerb[(k - 1 + kerb.length) % kerb.length], b = kerb[k];
    wallSlab(S, [a[0], 0, a[1]], [b[0], 0, b[1]], 0.18, 0.02, kind, { cell: 1.2, top: true, ends: false, y0: -0.165 });
  }
  // 踏道: 長隨間之廣; 每踏厚五寸廣一尺; 兩邊副子各廣一尺八寸
  const stepFaces = o.steps ?? (plan.poly ? fs.map((_, i) => i).filter((i) => i % 2 === 0) : [0, 2]);
  const n = Math.max(2, Math.round(H / (F.STEP.riseCun * F.CUN)));
  const rise = H / n, tread = F.STEP.treadCun * F.CUN, fuzi = F.STEP.fuziCun * F.CUN;
  const run = (n - 1) * tread;
  for (const k of stepFaces) {
    const f = fs[k];
    const bw = Math.min(m(f.bays[Math.floor(f.bays.length / 2)]), m(f.len));
    const base = m(f.off) + out;
    const toW = (s, o2, y) => [f.along[0] * s + f.n[0] * (base + o2), y, f.along[1] * s + f.n[1] * (base + o2)];
    for (let i = 1; i < n; i++) {
      // step i: run (i-1)…i, top at -i·rise: built as a closed box in the façade frame
      stepBox(S, toW, -bw / 2, bw / 2, (i - 1) * tread, i * tread, -H - bury, -i * rise, kind);
    }
    for (const sx of [-1, 1]) {
      const s0 = sx * bw / 2, s1 = sx * (bw / 2 + fuzi);
      const sa = Math.min(s0, s1), sb = Math.max(s0, s1);
      const st = [kind, 0, 1, 0];
      const T0 = toW(sa, 0, 0.01), T1 = toW(sb, 0, 0.01), T2 = toW(sb, run, -H + 0.12), T3 = toW(sa, run, -H + 0.12);
      const B0 = toW(sa, 0, -H - bury), B1 = toW(sb, 0, -H - bury), B2 = toW(sb, run, -H - bury), B3 = toW(sa, run, -H - bury);
      S.quad(T0, T3, T2, T1, st, st, st, st, [[sa, 0], [sa, run], [sb, run], [sb, 0]]);
      S.quad(B0, B3, T3, T0, st, st, st, st, [[0, -H], [run, -H], [run, 0], [0, 0]]);
      S.quad(B2, B1, T1, T2, st, st, st, st, [[run, -H], [0, -H], [0, 0], [run, 0]]);
      S.quad(B3, B2, T2, T3, st, st, st, st, [[sa, -H], [sb, -H], [sb, 0], [sa, 0]]);
    }
  }
  return { verts, h: H, edges, steps: stepFaces, stepRun: run };
}
/** quad a-b-c-d turned so that its normal points away from `ctr` */
export function quadOut(B, a, b, c, d, ctr, pa, uv = null) {
  const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
  const n = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
  const m = [(a[0] + c[0]) / 2 - ctr[0], (a[1] + c[1]) / 2 - ctr[1], (a[2] + c[2]) / 2 - ctr[2]];
  if (n[0] * m[0] + n[1] * m[1] + n[2] * m[2] >= 0) B.quad(a, b, c, d, pa, pa, pa, pa, uv);
  else B.quad(a, d, c, b, pa, pa, pa, pa, uv ? [uv[0], uv[3], uv[2], uv[1]] : null);
}
/** a closed box in a façade frame toW(s, o, y) */
function stepBox(S, toW, s0, s1, o0, o1, y0, y1, kind) {
  const c = [toW(s0, o0, y0), toW(s1, o0, y0), toW(s1, o1, y0), toW(s0, o1, y0), toW(s0, o0, y1), toW(s1, o0, y1), toW(s1, o1, y1), toW(s0, o1, y1)];
  const ctr = toW((s0 + s1) / 2, (o0 + o1) / 2, (y0 + y1) / 2);
  const st = [kind, 0, 1, 0];
  const q = (a, b, cc, d, uv) => quadOut(S, c[a], c[b], c[cc], c[d], ctr, st, uv);
  q(4, 5, 6, 7, [[s0, o0], [s1, o0], [s1, o1], [s0, o1]]);
  q(2, 6, 5, 1, [[o1, y0], [o1, y1], [o0, y1], [o0, y0]]);
  q(0, 4, 7, 3, [[o0, y0], [o0, y1], [o1, y1], [o1, y0]]);
  q(3, 7, 6, 2, [[s0, y0], [s0, y1], [s1, y1], [s1, y0]]);
}

// ---------------------------------------------------------------------------------------------- columns
/** 梭柱 profile (m): lower two thirds straight, upper third 卷殺 down to the 櫨枓 bottom + 4 分 all round, then the
 *  覆盆-like 緊殺 over the top 4 分 (卷五 · 柱). plain = straight post (houses, 永定柱). */
function columnProfile(plan, h, plain = false) {
  const { m, colD } = plan;
  const r0 = m(colD) / 2;
  if (plain) return [[r0, 0], [r0 * 0.94, h]];
  const luBottom = F.DOU.lu.l - 2 * F.DOU.lu.sha;      // 24 分
  const rTop = Math.min(r0, m(luBottom + 8) / 2);       // 上徑比櫨枓底四周各出四分
  const rNeck = Math.min(r0, m(luBottom) / 2);
  const P = [[r0, 0], [r0, (h * 2) / 3]];
  const segs = 6;
  for (let i = 1; i <= segs; i++) {
    const t = i / segs;
    P.push([r0 - (r0 - rTop) * (1 - Math.cos((t * Math.PI) / 2)), (h * 2) / 3 + (h / 3 - m(4)) * t]);
  }
  for (let i = 1; i <= 3; i++) { const t = i / 3; P.push([rTop - (rTop - rNeck) * Math.sin((t * Math.PI) / 2), h - m(4) + m(4) * t]); }
  return P;
}

export function buildColumns(plan, Wd, S, { bases = true, plain = !plan.bracketed && !plan.batou, segs = 20 } = {}) {
  const { m, columns, colD } = plan;
  const D = m(colD);
  for (const c of columns) {
    const h = m(c.h);
    const g = new MeshBuilder();
    g.lathe(columnProfile(plan, h, plain), segs, { kind: PAINT.COLUMN, capTop: true });
    // 側腳 ("柱首微收向內，柱腳微出向外"): the head stays on the grid, the foot moves out by the lean; a shear keeps
    // every section level
    const fx = m(c.x) - m(c.leanX), fz = m(c.z) - m(c.leanZ);
    const M = new THREE.Matrix4().set(1, m(c.leanX) / h, 0, fx, 0, 1, 0, 0, 0, m(c.leanZ) / h, 1, fz, 0, 0, 0, 1);
    Wd.append(g, M);
    if (!bases) continue;
    // 柱礎: square plinth (方倍柱之徑) flush with the floor + 覆盆 (每方一尺覆盆高一寸)
    S.box(fx - D, -0.2, fz - D, fx + D, 0.012, fz + D, PAINT.STONE, 'x');
    const fp = 2 * D * 0.1;
    const b = new MeshBuilder();
    b.lathe([[D * 0.92, 0.0], [D * 0.86, fp * 0.45], [D * 0.72, fp * 0.85], [D * 0.6, fp], [D * 0.56, fp * 1.15]], 20, { kind: PAINT.STONE, capTop: true });
    S.append(b, new THREE.Matrix4().makeTranslation(fx, 0.012, fz));
  }
}

// ---------------------------------------------------------------------------------------------- façade beams
/** world (分) point on a façade: s along, o outward offset from the column line, y */
export function facadePoint(f, s, o, y) {
  return [f.along[0] * s + f.n[0] * (f.off + o), y, f.along[1] * s + f.n[1] * (f.off + o)];
}

export function buildFacadeBeams(plan, Wd, P, { lod = 0 } = {}) {
  const { m, N, tierY, seatY, pupaiH } = plan;
  const crossBottom = (j) => seatY(j) + 6;
  for (const f of plan.facades) {
    const s0 = f.cols[0].s, s1 = f.cols[f.cols.length - 1].s;
    const mit = Math.tan(f.turn / 2);           // extension per unit offset to reach the neighbour's line
    const rect = !plan.poly;
    const pts = (o, yOf, ext) => {
      const ss = [s0 - ext, ...f.cols.map((c) => c.s), s1 + ext];
      return ss.map((s) => facadePoint(f, s, o, yOf(Math.min(s1, Math.max(s0, s)))));
    };
    const run = (o, yOf, w, h, kind, ext) => {
      const p = pts(o, yOf, ext);
      let acc = 0;
      for (let i = 0; i < p.length - 1; i++) {
        const a = p[i].map((v) => m(v)), b = p[i + 1].map((v) => m(v));
        if (Math.hypot(b[0] - a[0], b[2] - a[2]) < 1e-4) continue;
        beam(Wd, a, b, m(w), m(h), kind, { along0: acc });
        acc += Math.hypot(b[0] - a[0], b[2] - a[2]);
      }
    };
    // 闌額 per bay (七朱八白), top flush with the column heads
    for (let i = 0; i < f.cols.length - 1; i++) {
      const a = facadePoint(f, f.cols[i].s, 0, f.cols[i].h).map((v) => m(v)), b = facadePoint(f, f.cols[i + 1].s, 0, f.cols[i + 1].h).map((v) => m(v));
      beam(Wd, a, b, m(F.LANE.w), m(F.LANE.h), plan.bracketed ? PAINT.LANE : PAINT.MEMBER, { normalizeU: true });
    }
    if (!plan.bracketed && !plan.batou) {
      // no bracket sets: a 檐方 on the column heads carries the rafters
      run(0, (s) => f.top(s) + F.LIAOYAN.h, F.LIAOYAN.w * 1.4, F.LIAOYAN.h, PAINT.MEMBER, rect ? 6 : 6 * mit);
      continue;
    }
    // 普拍方 over 闌額 and column heads, running a little past the corners (出頭) on a rectangle, mitred on a polygon
    run(0, (s) => f.top(s) + F.PUPAI.h, F.PUPAI.w, F.PUPAI.h, PAINT.MEMBER, rect ? F.PUPAI.w * 0.75 : (F.PUPAI.w / 2) * mit);
    const base = (s) => f.top(s) + pupaiH; // 櫨枓 bottom
    if (plan.batou) {
      run(0, (s) => base(s) + plan.liaoyanBottom + F.LIAOYAN.h, F.LIAOYAN.w, F.LIAOYAN.h, PAINT.MEMBER, rect ? 8 : (F.LIAOYAN.w / 2) * mit);
      continue;
    }
    // 柱頭方 on the wall line, tiers 2 … N+1
    for (let t = 2; t <= N + 1; t++) run(0, (s) => base(s) + tierY(t) + F.CAI, F.CAI_HOU, F.CAI, PAINT.MEMBER, rect ? 8 : (F.CAI_HOU / 2) * mit);
    // 羅漢方 on the inner 跳頭 (above the 慢栱), meeting the neighbour façade's at the corner bisector
    for (let j = 1; j < N; j++) run(F.TIAO * j, (s) => base(s) + crossBottom(j) + 2 * F.ZUCAI + F.CAI, F.CAI_HOU, F.CAI, PAINT.MEMBER, F.TIAO * j * mit + 5);
    // 橑檐方 on the 令栱 of the outermost 跳
    run(F.TIAO * N, (s) => base(s) + crossBottom(N) + F.ZUCAI + F.LIAOYAN.h, F.LIAOYAN.w, F.LIAOYAN.h, PAINT.MEMBER, F.TIAO * N * mit + F.LIAOYAN.w / 2);
    // 栱眼壁: white plaster behind the brackets on the wall line, from the 普拍方 up to the top 柱頭方
    if (lod <= 1) {
      const p = pts(-F.CAI_HOU / 2 - 1, (s) => base(s) + tierY(N + 1) + F.CAI, 0);
      for (let i = 0; i < p.length - 1; i++) {
        const a = p[i].map((v) => m(v)), b = p[i + 1].map((v) => m(v));
        if (Math.hypot(b[0] - a[0], b[2] - a[2]) < 1e-4) continue;
        beam(P, a, b, m(3), m(tierY(N + 1) + F.CAI), PAINT.PLASTER, { faces: 0b000011 });
      }
    }
  }
}

// ---------------------------------------------------------------------------------------------- walls, doors, windows
/**
 * Bay kinds: 'door' 格子門 · 'banmen' 版門 · 'window' 破子櫺窗 on a low wall · 'lattice' full-height 格子 (all leaves)
 * · 'wall' plaster · 'open' · 'bench' 坐凳 (low rail between columns) · 'gate' (an open passage with 版門 leaves).
 * Schemes (plan.params.walls): 'hall' · 'open' · 'bench' · 'pagoda' · 'louge' · 'lattice' · 'gate' · or
 * { [façadeName | index]: kind | kind[] , default: kind }.
 */
export function wallKind(plan, fi, bi) {
  const f = plan.facades[fi], nb = f.cols.length - 1, mid = (nb - 1) / 2;
  const scheme = plan.params.walls;
  const front = f.name === 'front' || (plan.poly && fi === 0);
  const back = f.name === 'back';
  if (scheme && typeof scheme === 'object') {
    const v = scheme[f.name] ?? scheme[fi] ?? scheme.default ?? 'wall';
    return Array.isArray(v) ? v[bi] ?? v[v.length - 1] : v;
  }
  switch (scheme) {
    case 'open': return 'open';
    case 'bench': return front && Math.abs(bi - mid) < 0.6 ? 'open' : 'bench';
    case 'lattice': return 'lattice';
    case 'pagoda': return Math.abs(bi - mid) < 0.6 ? (fi % 2 === 0 ? 'banmen-s' : 'window-s') : nb >= 3 ? 'window-s' : 'wall';
    case 'pagoda-open': return Math.abs(bi - mid) < 0.6 ? 'door-s' : 'window-s';
    case 'louge-s': return Math.abs(bi - mid) < 0.6 && (front || back) ? 'door' : 'window-s';
    case 'louge-g': return Math.abs(bi - mid) < 0.6 ? (front ? 'door' : back ? 'door-s' : 'window-s') : front ? 'window' : 'window-s';
    case 'louge': return front || back ? (Math.abs(bi - mid) < 0.6 ? 'door' : 'window') : 'window';
    case 'gate': return (front || back) && Math.abs(bi - mid) < 0.6 ? 'gate' : 'wall';
    default: {
      // 'hall': doors in the middle front bays, windows in the others, plaster elsewhere
      if (!front) return 'wall';
      const doorBays = plan.params.doors === 'auto' ? (nb >= 5 ? [mid - 1, mid, mid + 1] : [mid]) : plan.params.doors;
      return doorBays.includes(bi) ? 'door' : 'window';
    }
  }
}

export function buildWalls(plan, Wd, Pl, Dk, Gl, { lod = 0 } = {}) {
  const { m, colD } = plan;
  const D = m(colD);
  let closed = false;
  plan.facades.forEach((f, fi) => {
    for (let i = 0; i < f.cols.length - 1; i++) {
      const kind = wallKind(plan, fi, i);
      const sa = f.cols[i].s, sb = f.cols[i + 1].s;
      const top = Math.min(m(f.cols[i].h - F.LANE.h), m(f.cols[i + 1].h - F.LANE.h)); // under the 闌額
      const xa = m(sa) + D * 0.5, xb = m(sb) - D * 0.5;    // clear opening between the column shafts
      const P0 = (s, o, y) => [f.along[0] * s + f.n[0] * (m(f.off) + o), y, f.along[1] * s + f.n[1] * (m(f.off) + o)];
      if (kind !== 'open' && kind !== 'bench') closed = true;
      if (kind === 'door' || kind === 'lattice') doorBay(Wd, Gl, Pl, P0, xa, xb, top, D, { lod, waist: kind === 'door' ? 0.36 : 0.22 });
      else if (kind === 'banmen' || kind === 'gate') banmenBay(Wd, Gl, Pl, P0, xa, xb, top, D, { open: kind === 'gate' });
      else if (kind === 'window') windowBay(Wd, Gl, Pl, P0, xa, xb, top, D, { lod });
      else if (kind === 'banmen-s' || kind === 'window-s' || kind === 'door-s') smallOpeningBay(Wd, Gl, Pl, P0, xa - D * 0.5, xb + D * 0.5, top, D, kind, { lod });
      else if (kind === 'bench') benchBay(Wd, P0, xa, xb, D);
      else if (kind === 'wall') wallSlab(Pl, P0(m(sa), 0, 0), P0(m(sb), 0, 0), top, D * 0.85, PAINT.PLASTER, { cell: 0.55, ends: false });
    }
  });
  // interior: dark box seen through doors / windows, or a 平棊 ceiling over an open storey
  const yTop = m(plan.H0 + plan.pupaiH + (plan.bracketed ? plan.tierY(plan.N + 1) : plan.bracketH * 0.5));
  const ring = plan.facades.map((f) => { const s = f.len / 2; return [m(f.along[0] * s + f.n[0] * f.off), m(f.along[1] * s + f.n[1] * f.off)]; });
  const inset = (k) => ring.map(([x, z]) => { const r = Math.hypot(x, z) || 1; return [x * (1 - k / r), z * (1 - k / r)]; });
  if (closed) {
    const inner = inset(D * 0.6);
    for (let k = 0; k < inner.length; k++) {
      const a = inner[(k - 1 + inner.length) % inner.length], b = inner[k];
      Dk.quad([a[0], 0.01, a[1]], [a[0], yTop, a[1]], [b[0], yTop, b[1]], [b[0], 0.01, b[1]], [PAINT.DARK, 0, 1, 0]);
    }
    polyCap(Dk, inner, yTop, PAINT.DARK, false);
  } else if (lod <= 1) {
    // 平棊: a panelled ceiling at the top of the 柱頭方, painted (CEILING), seen from below
    polyCap(Wd, inset(D * 0.2), yTop, PAINT.CEILING, false);
  }
}

function frameBar(B, P0, sa, sb, ya, yb, o, w, d, kind = PAINT.WOOD) {
  // a straight bar in a façade plane between (sa,ya) and (sb,yb), w wide (in the plane), d deep (outward)
  const vertical = Math.abs(sa - sb) < 1e-6;
  if (vertical) beam(B, P0(sa - w / 2, o + d / 2, yb), P0(sa + w / 2, o + d / 2, yb), d, yb - ya, kind);
  else beam(B, P0(Math.min(sa, sb), o + d / 2, ya + w / 2), P0(Math.max(sa, sb), o + d / 2, ya + w / 2), d, w, kind);
}

/** 格子門: four leaves (卷七: 每間分作四扇), 格眼 above, 腰華版 and 障水版 below, 門額 above. At lod ≥ 1 the leaves
 *  are one LATTICE-painted panel (the shader draws the 格眼). */
function doorBay(Wd, Gl, Pl, P0, xa, xb, top, D, { lod = 0, waist = 0.36 } = {}) {
  const o = D * 0.12; // door plane slightly outside the column line
  const post = 0.09, lintel = 0.12;
  frameBar(Wd, P0, xa + post / 2, xa + post / 2, 0, top, o, post, 0.1);
  frameBar(Wd, P0, xb - post / 2, xb - post / 2, 0, top, o, post, 0.1);
  const hDoor = top - lintel - 0.02;
  frameBar(Wd, P0, xa, xb, hDoor, hDoor, o, lintel, 0.12);  // 門額
  frameBar(Wd, P0, xa, xb, 0, 0, o, 0.08, 0.14);            // 地栿
  // backing: the room behind the lattice (GLOW: dark by day, lamplit at night)
  beam(Gl, P0(xa, o - 0.04, hDoor), P0(xb, o - 0.04, hDoor), 0.02, hDoor, PAINT.GLOW, { faces: 0b000011 });
  beam(Pl, P0(xa, o - 0.02, top), P0(xb, o - 0.02, top), 0.06, top - hDoor - lintel / 2, PAINT.PLASTER, { faces: 0b000011 });
  const L = (xb - xa - 2 * post) / 4;
  if (lod >= 1) {
    beam(Wd, P0(xa + post, o, hDoor - lintel / 2), P0(xb - post, o, hDoor - lintel / 2), 0.04, hDoor - lintel / 2 - 0.08, PAINT.LATTICE, { faces: 0b000011 });
    return;
  }
  for (let k = 0; k < 4; k++) {
    const l0 = xa + post + k * L, l1 = l0 + L;
    const st = 0.055; // 程 width
    const y0 = 0.08, y1 = hDoor - lintel / 2;
    frameBar(Wd, P0, l0 + st / 2, l0 + st / 2, y0, y1, o, st, 0.06);
    frameBar(Wd, P0, l1 - st / 2, l1 - st / 2, y0, y1, o, st, 0.06);
    frameBar(Wd, P0, l0, l1, y1 - st, y1 - st, o, st, 0.06);
    const yWaist = y0 + (y1 - y0) * waist;
    frameBar(Wd, P0, l0, l1, yWaist, yWaist, o, st * 1.4, 0.06);
    frameBar(Wd, P0, l0, l1, yWaist + 0.16, yWaist + 0.16, o, st, 0.06);
    // 障水版 (solid) and 腰華版
    beam(Wd, P0(l0, o, yWaist), P0(l1, o, yWaist), 0.03, yWaist - y0, PAINT.WOOD, { faces: 0b000011 });
    beam(Wd, P0(l0, o, yWaist + 0.16), P0(l1, o, yWaist + 0.16), 0.03, 0.16 - st * 0.7, PAINT.WOOD, { faces: 0b000011 });
    // 方格眼 lattice
    const g0 = yWaist + 0.16 + st, g1 = y1 - st;
    const cell = 0.11, bw = 0.018;
    const nx = Math.max(2, Math.round((L - 2 * st) / cell)), ny = Math.max(3, Math.round((g1 - g0) / cell));
    for (let a = 1; a < nx; a++) { const x = l0 + st + ((L - 2 * st) * a) / nx; frameBar(Wd, P0, x, x, g0, g1, o - 0.005, bw, 0.035); }
    for (let b = 1; b < ny; b++) { const y = g0 + ((g1 - g0) * b) / ny; frameBar(Wd, P0, l0 + st, l1 - st, y - bw / 2, y - bw / 2, o - 0.005, bw, 0.035); }
  }
}

/** 版門 (卷六): two plank leaves with rows of 門釘; `open` leaves them swung back (a passage) */
function banmenBay(Wd, Gl, Pl, P0, xa, xb, top, D, { open = false } = {}) {
  const o = 0;
  const post = 0.12, lintel = 0.16;
  frameBar(Wd, P0, xa + post / 2, xa + post / 2, 0, top, o, post, 0.14);
  frameBar(Wd, P0, xb - post / 2, xb - post / 2, 0, top, o, post, 0.14);
  const hDoor = Math.min(top - lintel - 0.02, Math.max(2.2, top * 0.82));
  frameBar(Wd, P0, xa, xb, hDoor, hDoor, o, lintel, 0.16);
  if (top - hDoor - lintel > 0.05) beam(Pl, P0(xa, o - 0.02, top), P0(xb, o - 0.02, top), 0.06, top - hDoor - lintel / 2, PAINT.PLASTER, { faces: 0b000011 });
  beam(Gl, P0(xa, o - (open ? 1.5 : 0.08), hDoor), P0(xb, o - (open ? 1.5 : 0.08), hDoor), 0.02, hDoor, PAINT.GLOW, { faces: 0b000011 });
  const lw = (xb - xa - 2 * post) / 2;
  for (const side of [0, 1]) {
    const l0 = xa + post + side * lw, l1 = l0 + lw;
    if (open) {
      // swung inward against the jamb: a leaf perpendicular to the wall
      const hinge = side === 0 ? xa + post : xb - post;
      beam(Wd, P0(hinge, o - 0.05, hDoor - 0.02), P0(hinge, o - 0.05 - lw * 0.95, hDoor - 0.02), 0.06, hDoor - 0.05, PAINT.ZHU);
    } else {
      beam(Wd, P0(l0, o - 0.03, hDoor - 0.02), P0(l1, o - 0.03, hDoor - 0.02), 0.06, hDoor - 0.04, PAINT.ZHU, { faces: 0b000111 });
      // 門釘: rows of round studs
      const rows = 5, cols = 3;
      for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
        const s = l0 + lw * (c + 0.5) / cols, y = hDoor * (0.2 + 0.6 * r / (rows - 1));
        const p = P0(s, o + 0.005, y);
        Wd.box(p[0] - 0.025, y - 0.025, p[2] - 0.025, p[0] + 0.025, y + 0.025, p[2] + 0.025, PAINT.DAN, 'x');
      }
    }
  }
}

/** 破子櫺窗 over a low plaster wall (卷六: 每間廣一丈用十七櫺) */
function windowBay(Wd, Gl, Pl, P0, xa, xb, top, D, { lod = 0 } = {}) {
  const o = D * 0.05;
  const sill = Math.min(top * 0.36, 1.0);
  const t = D * 0.85;
  wallSlab(Pl, P0(xa - D * 0.5, 0, 0), P0(xb + D * 0.5, 0, 0), sill, t, PAINT.PLASTER, { cell: 0.5, ends: false });
  const hTop = top - 0.12;
  frameBar(Wd, P0, xa, xb, sill, sill, o, 0.1, 0.12);
  frameBar(Wd, P0, xa, xb, hTop, hTop, o, 0.12, 0.12);
  frameBar(Wd, P0, xa + 0.05, xa + 0.05, sill, hTop + 0.12, o, 0.1, 0.12);
  frameBar(Wd, P0, xb - 0.05, xb - 0.05, sill, hTop + 0.12, o, 0.1, 0.12);
  beam(Pl, P0(xa, o - 0.03, top), P0(xb, o - 0.03, top), 0.06, top - hTop - 0.06, PAINT.PLASTER, { faces: 0b000011 });
  beam(Gl, P0(xa, o - 0.08, hTop), P0(xb, o - 0.08, hTop), 0.02, hTop - sill, PAINT.GLOW, { faces: 0b000011 });
  const n = F.windowBars(xb - xa);
  const bw = 0.045;
  const step = lod >= 1 ? 2 : 1;
  for (let k = 1; k <= n; k += step) {
    const x = xa + 0.1 + ((xb - xa - 0.2) * k) / (n + 1);
    const c = P0(x, o, 0);
    const g = new MeshBuilder();
    g.box(-bw / 2, sill + 0.05, -bw / 2, bw / 2, hTop - 0.06, bw / 2, PAINT.WOOD, 'z');
    Wd.append(g, new THREE.Matrix4().makeRotationY(Math.PI / 4).premultiply(new THREE.Matrix4().makeTranslation(c[0], 0, c[2])));
  }
}

/** a plaster wall with one opening in the middle: a narrow 版門 (banmen-s), a 格子門 pair (door-s) or a small
 *  破子櫺窗 (window-s) — pagoda storeys, upper floors */
function smallOpeningBay(Wd, Gl, Pl, P0, xa, xb, top, D, kind, { lod = 0 } = {}) {
  const mid = (xa + xb) / 2, span = xb - xa;
  const door = kind !== 'window-s';
  const w = Math.min(span * 0.5, door ? 1.5 : 1.3);
  const y0 = door ? 0 : Math.min(1.0, top * 0.38), y1 = door ? Math.min(top - 0.3, 2.5) : Math.min(top - 0.35, y0 + 1.15);
  const t = D * 0.8;
  wallSlab(Pl, P0(xa, 0, 0), P0(mid - w / 2, 0, 0), top, t, PAINT.PLASTER, { cell: 0.5, ends: false });
  wallSlab(Pl, P0(mid + w / 2, 0, 0), P0(xb, 0, 0), top, t, PAINT.PLASTER, { cell: 0.5, ends: false });
  wallSlab(Pl, P0(mid - w / 2, 0, 0), P0(mid + w / 2, 0, 0), top - y1, t, PAINT.PLASTER, { cell: 0.5, ends: false, y0: y1 });
  if (y0 > 0) wallSlab(Pl, P0(mid - w / 2, 0, 0), P0(mid + w / 2, 0, 0), y0, t, PAINT.PLASTER, { cell: 0.5, ends: false });
  // reveals (the wall thickness inside the opening)
  for (const s of [mid - w / 2, mid + w / 2]) beam(Pl, P0(s, 0, y1), P0(s + 0.001, 0, y1), t, y1 - y0, PAINT.PLASTER, { faces: 0b110000 });
  const o = t / 2 - 0.03;
  // frame
  frameBar(Wd, P0, mid - w / 2, mid + w / 2, y1 - 0.1, y1 - 0.1, o, 0.1, 0.1);
  if (y0 > 0) frameBar(Wd, P0, mid - w / 2, mid + w / 2, y0, y0, o, 0.08, 0.1);
  frameBar(Wd, P0, mid - w / 2 + 0.05, mid - w / 2 + 0.05, y0, y1, o, 0.1, 0.1);
  frameBar(Wd, P0, mid + w / 2 - 0.05, mid + w / 2 - 0.05, y0, y1, o, 0.1, 0.1);
  beam(Gl, P0(mid - w / 2, -t / 2 + 0.02, y1), P0(mid + w / 2, -t / 2 + 0.02, y1), 0.02, y1 - y0, PAINT.GLOW, { faces: 0b000011 });
  if (kind === 'banmen-s') {
    for (const side of [0, 1]) {
      const l0 = mid - w / 2 + 0.1 + side * (w / 2 - 0.1), l1 = l0 + w / 2 - 0.1;
      beam(Wd, P0(l0, o - 0.06, y1 - 0.12), P0(l1, o - 0.06, y1 - 0.12), 0.05, y1 - 0.14, PAINT.ZHU, { faces: 0b000111 });
      for (let r = 0; r < 4; r++) for (let c = 0; c < 2; c++) {
        const s = l0 + (l1 - l0) * (c + 0.5) / 2, y = y1 * (0.22 + 0.52 * r / 3);
        const p = P0(s, o - 0.03, y);
        Wd.box(p[0] - 0.022, y - 0.022, p[2] - 0.022, p[0] + 0.022, y + 0.022, p[2] + 0.022, PAINT.DAN, 'x');
      }
    }
  } else if (kind === 'door-s') {
    beam(Wd, P0(mid - w / 2 + 0.1, o - 0.03, y1 - 0.12), P0(mid + w / 2 - 0.1, o - 0.03, y1 - 0.12), 0.03, y1 - 0.14, PAINT.LATTICE, { faces: 0b000011 });
  } else {
    const n = Math.max(5, Math.round(w / 0.1)) | 1;
    for (let k = 1; k < n; k++) {
      const x = mid - w / 2 + 0.1 + ((w - 0.2) * k) / n;
      const c = P0(x, o - 0.02, 0);
      const g = new MeshBuilder();
      g.box(-0.02, y0 + 0.04, -0.02, 0.02, y1 - 0.14, 0.02, PAINT.WOOD, 'z');
      Wd.append(g, new THREE.Matrix4().makeRotationY(Math.PI / 4).premultiply(new THREE.Matrix4().makeTranslation(c[0], 0, c[2])));
    }
  }
}

/** 坐凳 between columns: a low plank seat on short posts with a 鵝頸 back hint (open pavilions, 廊) */
function benchBay(Wd, P0, xa, xb, D) {
  const h = 0.45, o = 0;
  beam(Wd, P0(xa, o, h), P0(xb, o, h), 0.34, 0.06, PAINT.WOOD);                      // seat plank
  beam(Wd, P0(xa, o + 0.12, h - 0.06), P0(xb, o + 0.12, h - 0.06), 0.06, 0.12, PAINT.WOOD); // apron
  const n = Math.max(2, Math.round((xb - xa) / 0.9));
  for (let i = 0; i <= n; i++) {
    const s = xa + 0.05 + ((xb - xa - 0.1) * i) / n;
    const p = P0(s, o, 0);
    Wd.box(p[0] - 0.035, 0, p[2] - 0.035, p[0] + 0.035, h - 0.06, p[2] + 0.035, PAINT.WOOD, 'x');
  }
}
