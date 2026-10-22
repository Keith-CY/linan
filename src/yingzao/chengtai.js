// 城台 and 踏道: the walled terraces of the palace (layout.CHENGTAI) and the stone flights (layout.STAIRS).
//
//   buildChengtai(T, { lod, name }) → { group, info, blocks }
//   buildStair(S, { lod, name })     → { group, info, blocks }
// Both are built in world coordinates relative to their centre (group.position = [cx, 0, cz], no rotation; y is the
// world height). `blocks` are segments [[x0, z0], [x1, z1], halfWidth] the walker may not cross (parapets, wall feet,
// the open side of a flight), for engine.footprints.addPath(…, 'wall').
//
// A terrace (TERRACES schema: center, size [along rot, across], rot, level) has four sides: front (−v), right (+u),
// back (+v), left (−u), where u runs along `rot` and v along rot + 90 (the heightfield's frame). On the palace terraces
// (rot = facing + 90) front is the hall's front, right the hall's right. Along each side the ground just outside is
// sampled (heightfield.js: the next terrace, a stair ramp, the mesa or its cliff):
//   lower outside → a battered retaining wall (batter = run per m of height) from the coping down past the ground,
//                   a stone coping and a stone 勾闌 on top (railing gaps where a flight arrives)
//   higher outside (a hill) → a battered wall facing in, holding the hill back (none where another terrace stands)
// wall.gates [{ side, at, w, h }]: a bastion standing out of the wall with a round-arched gate, a short passage and
//   closed doors (the heightfield keeps the terrace solid behind them); at = metres from the side's middle toward +u
//   (front / back) or +v (left / right).
// wall.panels [{ side, at, w, h }]: a framed stone panel (a carved stele) set on the wall face.
// wall.pave: a paved top (stone courses in plan).
// A flight (STAIRS: from, to, y [bottom, top], width, rail 'left' | 'right' | 'both' seen walking up) is a stepped
// stone mass with sloping 副子 cheeks on its open sides, a 勾闌 rising along them, standing on the ground (or against a
// wall on its closed side).
import * as THREE from 'three';
import { Assembly } from './building.js';
import { MeshBuilder, PAINT } from './geom.js';
import { heightAt, CHENGTAI_IN } from '../world/heightfield.js';
import * as L from '../world/layout.js';

const STEP = 1.6;         // wall stations along a side (m)

/** a quad whose normal is turned toward `want` */
function face(B, a, b, c, d, want, kind, uv) {
  const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = d[0] - a[0], vy = d[1] - a[1], vz = d[2] - a[2];
  const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
  const P = (v) => [kind, v[1], 1, 0];
  if (nx * want[0] + ny * want[1] + nz * want[2] >= 0) B.quad(a, b, c, d, P(a), P(b), P(c), P(d), uv);
  else B.quad(a, d, c, b, P(a), P(d), P(c), P(b), uv ? [uv[0], uv[3], uv[2], uv[1]] : null);
}

/** the frame of a TERRACES-schema rectangle */
export function rectFrame(T) {
  const r = ((T.rot || 0) * Math.PI) / 180;
  const X = [Math.sin(r), -Math.cos(r)], Z = [Math.cos(r), Math.sin(r)];
  const hw = T.size[0] / 2, hd = T.size[1] / 2, C = T.center;
  const world = (u, v) => [C[0] + u * X[0] + v * Z[0], C[1] + u * X[1] + v * Z[1]];
  const local = (x, z) => { const dx = x - C[0], dz = z - C[1]; return [dx * X[0] + dz * X[1], dx * Z[0] + dz * Z[1]]; };
  // sides: start corner, end corner (u, v), outward normal (u, v); s runs from the start corner
  const sides = {
    front: { a: [-hw, -hd], b: [hw, -hd], n: [0, -1], len: 2 * hw, mid: (at) => at + hw },
    right: { a: [hw, -hd], b: [hw, hd], n: [1, 0], len: 2 * hd, mid: (at) => at + hd },
    back: { a: [hw, hd], b: [-hw, hd], n: [0, 1], len: 2 * hw, mid: (at) => hw - at },
    left: { a: [-hw, hd], b: [-hw, -hd], n: [-1, 0], len: 2 * hd, mid: (at) => hd - at },
  };
  return { X, Z, hw, hd, C, world, local, sides, inside: (x, z, m = 0) => { const [u, v] = local(x, z); return Math.abs(u) < hw + m && Math.abs(v) < hd + m; } };
}

/** the ground just outside a side (lowest of a few samples), ignoring nothing: terraces, ramps, the mesa */
function groundOut(world, u, v, n) {
  let g = Infinity;
  for (const d of [0.7, 1.6, 3.0, 4.5]) { const [x, z] = world(u + n[0] * d, v + n[1] * d); g = Math.min(g, heightAt(x, z)); }
  return g;
}

/** the tread level of a flight (STAIRS entry) at (x, z) on it (its width + 0.5 m, and the 2.6 m its top runs on at its
 *  level in the heightfield, none for a flat landing), or -Infinity off it */
function flightLevel(f, x, z) {
  const dx = f.to[0] - f.from[0], dz = f.to[1] - f.from[1], len = Math.hypot(dx, dz);
  const px = x - f.from[0], pz = z - f.from[1];
  const t = (px * dx + pz * dz) / len, w = (-px * dz + pz * dx) / len;
  const runOn = Math.abs(f.y[1] - f.y[0]) < 0.3 ? 0.05 : 2.6;
  if (t < 0 || t > len + runOn || Math.abs(w) > f.width / 2 + 0.5) return -Infinity;
  return f.y[0] + ((f.y[1] - f.y[0]) * Math.min(t, len)) / len;
}

/** railing gaps on a side: where a flight ends at this level next to it (its last metres) */
function gapsFor(T, F, side, stairs) {
  const S = F.sides[side], out = [];
  for (const st of stairs) {
    if (Math.abs(st.y[1] - T.level) > 0.4) continue;
    const top = F.local(st.to[0], st.to[1]), bot = F.local(st.from[0], st.from[1]);
    // the flight must lie just outside this side
    const off = (p) => (S.n[0] ? (p[0] - S.a[0]) * S.n[0] : (p[1] - S.a[1]) * S.n[1]);
    if (off(top) < -0.5 || off(top) > st.width + 1.5) continue;
    const along = (p) => (S.n[0] ? (p[1] - S.a[1]) * Math.sign(S.b[1] - S.a[1]) : (p[0] - S.a[0]) * Math.sign(S.b[0] - S.a[0]));
    const s1 = along(top), s0 = along(bot), dir = Math.sign(s1 - s0) || 1;
    const flat = Math.abs(st.y[1] - st.y[0]) < 0.3;
    // a flight square to the side opens over its width; a flat landing over its whole length; a flight along the side
    // over its top 2.6 m
    const across = Math.abs(s1 - s0) < 0.35 * Math.hypot(st.to[0] - st.from[0], st.to[1] - st.from[1]);
    out.push(across ? [s1 - st.width / 2 - 0.2, s1 + st.width / 2 + 0.2]
      : flat ? [Math.min(s0, s1) - 0.2, Math.max(s0, s1) + 0.2] : [Math.min(s1, s1 - dir * 2.6) - 0.2, Math.max(s1, s1 - dir * 2.6) + 0.2]);
  }
  return out;
}

/** split [0, len] by gaps → runs */
function runs(len, gaps) {
  let segs = [[0, len]];
  for (const [g0, g1] of gaps) segs = segs.flatMap(([a, b]) => (g1 <= a || g0 >= b ? [[a, b]] : [[a, Math.max(a, g0)], [Math.min(b, g1), b]].filter(([p, q]) => q - p > 0.6)));
  return segs;
}

/**
 * One walled terrace. T: a CHENGTAI entry. Returns { group, info, blocks }.
 */
export function buildChengtai(T, { lod = 0, name = T.id } = {}) {
  const t0 = performance.now();
  const A = new Assembly({ lod, ao: false, name, seed: name });
  const S = new MeshBuilder(), Dk = new MeshBuilder(), Wd = new MeshBuilder();
  const F = rectFrame(T);
  const Wl = T.wall || {};
  const bat = Wl.batter ?? 0.16, lev = T.level;
  const [cx, cz] = T.center;
  const P = (x, y, z) => [x - cx, y, z - cz];                 // world → group-local
  const others = (L.CHENGTAI || []).filter((o) => o !== T).map(rectFrame);
  const stairs = L.STAIRS || [];
  const blocks = [];
  let wallTris = 0;
  for (const [sideName, Sd] of Object.entries(F.sides)) {
    const n = Sd.n, len = Sd.len;
    const tx = (Sd.b[0] - Sd.a[0]) / len, tv = (Sd.b[1] - Sd.a[1]) / len;   // along the side, (u, v)
    const at = (s, e) => F.world(Sd.a[0] + tx * s + n[0] * e, Sd.a[1] + tv * s + n[1] * e);
    const outN = (() => { const [x0, z0] = F.world(0, 0), [x1, z1] = F.world(n[0], n[1]); return [x1 - x0, 0, z1 - z0]; })();
    const along = (() => { const [x0, z0] = F.world(0, 0), [x1, z1] = F.world(tx, tv); return [x1 - x0, z1 - z0]; })();
    const gates = (Wl.gates || []).filter((g) => g.side === sideName).map((g) => ({ ...g, s: Sd.mid(g.at) }));
    const panels = (Wl.panels || []).filter((g) => g.side === sideName).map((g) => ({ ...g, s: Sd.mid(g.at) }));
    // stations: the ground outside, then the lowest of each station and its neighbours (a wall on a ragged cliff top
    // reaches down to where the rock falls away, no foot hanging over a dip between two stations)
    const N = Math.max(2, Math.ceil(len / STEP));
    const st = [];
    for (let i = 0; i <= N; i++) {
      const s = (len * i) / N;
      const [u, v] = [Sd.a[0] + tx * s, Sd.a[1] + tv * s];
      const g = groundOut(F.world, u, v, n);
      const [ox, oz] = F.world(u + n[0] * 1.2, v + n[1] * 1.2);
      const neighbour = others.some((o) => o.inside(ox, oz, -0.05));
      st.push({ s, g0: g, neighbour });
    }
    for (let i = 0; i <= N; i++) {
      let g = st[i].g0;
      if (g < lev - 0.3) for (let j = Math.max(0, i - 1); j <= Math.min(N, i + 1); j++) g = Math.min(g, st[j].g0);
      st[i].g = Math.max(g, lev - 34);
      st[i].dh = lev - st[i].g;
    }
    // ---- outward walls (the ground outside lower): battered face from the coping down past the ground
    const faceOut = (i) => st[i].dh > -0.3;
    for (let i = 0; i < N; i++) {
      const a = st[i], b = st[i + 1];
      if (!faceOut(i) || !faceOut(i + 1)) continue;
      if (gates.some((g) => Math.max(a.s, b.s) > g.s - g.w / 2 - 1.6 && Math.min(a.s, b.s) < g.s + g.w / 2 + 1.6)) continue; // the bastion
      const bury = (q) => 1.4 + 0.12 * Math.max(0, q.dh);
      const yb = (q) => q.g - bury(q);
      const eb = (q) => bat * (lev - yb(q));
      // the corners: the face reaches round to meet the next side's face
      const ext = (q, end) => (end ? (q.s <= 0.01 ? -eb(q) : q.s >= len - 0.01 ? eb(q) : 0) : 0);
      const a0 = at(a.s + ext(a, true) * 1, eb(a)), b0 = at(b.s + ext(b, true), eb(b));
      const a1 = at(a.s, 0), b1 = at(b.s, 0);
      const pa0 = P(a0[0], yb(a), a0[1]), pb0 = P(b0[0], yb(b), b0[1]), pb1 = P(b1[0], lev - 0.38, b1[1]), pa1 = P(a1[0], lev - 0.38, a1[1]);
      // subdivide the face vertically every ~2.5 m (the material's grime / damp gradients and the ink's shading)
      const nv = Math.max(1, Math.ceil((lev - Math.min(yb(a), yb(b))) / 2.5));
      for (let j = 0; j < nv; j++) {
        const f0 = j / nv, f1 = (j + 1) / nv;
        const L0 = (p, q, f) => [p[0] + (q[0] - p[0]) * f, p[1] + (q[1] - p[1]) * f, p[2] + (q[2] - p[2]) * f];
        const q0 = L0(pa0, pa1, f0), q1 = L0(pb0, pb1, f0), q2 = L0(pb0, pb1, f1), q3 = L0(pa0, pa1, f1);
        face(S, q0, q1, q2, q3, [outN[0], bat, outN[2]], PAINT.MARBLE, [[a.s, q0[1]], [b.s, q1[1]], [b.s, q2[1]], [a.s, q3[1]]]);
        wallTris += 2;
      }
      // the coping: a stone band standing out a little at the top of the face
      if (Math.max(a.dh, b.dh) > 0.5) {
        const c0 = at(a.s, 0.14), c1 = at(b.s, 0.14), i0 = at(a.s, -0.7), i1 = at(b.s, -0.7);
        face(S, P(c0[0], lev - 0.42, c0[1]), P(c1[0], lev - 0.42, c1[1]), P(c1[0], lev + 0.06, c1[1]), P(c0[0], lev + 0.06, c0[1]), outN, PAINT.MARBLE, [[a.s, 0], [b.s, 0], [b.s, 0.48], [a.s, 0.48]]);
        face(S, P(c0[0], lev + 0.06, c0[1]), P(c1[0], lev + 0.06, c1[1]), P(i1[0], lev + 0.06, i1[1]), P(i0[0], lev + 0.06, i0[1]), [0, 1, 0], PAINT.MARBLE);
        face(S, P(c0[0], lev - 0.42, c0[1]), P(c1[0], lev - 0.42, c1[1]), P(b1[0], lev - 0.42, b1[1]), P(a1[0], lev - 0.42, a1[1]), [0, -1, 0], PAINT.MARBLE);
      }
      // the wall's foot: the walker below cannot walk into the batter (not where a flight or a landing arrives at this
      // terrace's level against the wall: there the walker crosses from the flight onto the terrace)
      if (Math.max(a.dh, b.dh) > 1.0) {
        const m0 = at(a.s, bat * Math.max(0, a.dh) * 0.5), m1 = at(b.s, bat * Math.max(0, b.dh) * 0.5);
        const mid = at((a.s + b.s) / 2, 1.0);
        if (!stairs.some((f) => flightLevel(f, mid[0], mid[1]) > lev - 1.2)) blocks.push([m0, m1, Math.max(0.3, bat * Math.max(a.dh, b.dh) * 0.5)]);
      }
    }
    // ---- inward walls (a hill higher outside, no terrace there): the face looks into the court
    for (let i = 0; i < N; i++) {
      const a = st[i], b = st[i + 1];
      if (a.dh > -0.6 || b.dh > -0.6 || a.neighbour || b.neighbour) continue;
      const ya = lev - a.dh + 0.25, yb2 = lev - b.dh + 0.25;   // the ground outside, a little above
      const a0 = at(a.s, 0), b0 = at(b.s, 0), a1 = at(a.s, bat * (ya - lev)), b1 = at(b.s, bat * (yb2 - lev));
      face(S, P(a0[0], lev - 0.6, a0[1]), P(b0[0], lev - 0.6, b0[1]), P(b1[0], yb2, b1[1]), P(a1[0], ya, a1[1]), [-outN[0], bat, -outN[2]], PAINT.MARBLE, [[a.s, lev], [b.s, lev], [b.s, yb2], [a.s, ya]]);
      const a2 = at(a.s, bat * (ya - lev) + 0.6), b2 = at(b.s, bat * (yb2 - lev) + 0.6);
      face(S, P(a1[0], ya, a1[1]), P(b1[0], yb2, b1[1]), P(b2[0], yb2, b2[1]), P(a2[0], ya, a2[1]), [0, 1, 0], PAINT.MARBLE);
      wallTris += 4;
    }
    // ---- the 勾闌 along the top where the drop is more than a step, open where a flight arrives
    const gaps = gapsFor(T, F, sideName, stairs);
    let r0 = null;
    const flush = (i) => {
      if (r0 === null) return;
      const s0 = st[r0].s, s1 = st[i].s;
      r0 = null;
      for (const [p, q] of runs(s1 - s0, gaps.map(([g0, g1]) => [g0 - s0, g1 - s0]))) {
        const pa = at(s0 + p, -0.32), pb = at(s0 + q, -0.32);
        if (lod >= 2) {
          // massing: a low stone parapet
          const pa2 = at(s0 + p, -0.12), pb2 = at(s0 + q, -0.12);
          face(S, P(pa2[0], lev, pa2[1]), P(pb2[0], lev, pb2[1]), P(pb2[0], lev + 1.0, pb2[1]), P(pa2[0], lev + 1.0, pa2[1]), outN, PAINT.MARBLE);
          face(S, P(pa[0], lev, pa[1]), P(pb[0], lev, pb[1]), P(pb[0], lev + 1.0, pb[1]), P(pa[0], lev + 1.0, pa[1]), [-outN[0], 0, -outN[2]], PAINT.MARBLE);
        } else A.railing([P(pa[0], lev + 0.06, pa[1]), P(pb[0], lev + 0.06, pb[1])], { stone: true });
        // the walker stops short of the strip where the ground steps down inside the wall (heightfield CHENGTAI_IN)
        blocks.push([at(s0 + p, -CHENGTAI_IN - 0.25), at(s0 + q, -CHENGTAI_IN - 0.25), 0.3]);
      }
    };
    for (let i = 0; i <= N; i++) {
      const on = i < N && st[i].dh > 1.4 && st[i + 1].dh > 1.4;
      if (on && r0 === null) r0 = i;
      if (!on) flush(i);
    }
    // ---- gates: a bastion with a round-arched passage and closed doors
    for (const g of gates) {
      const gi = st.reduce((b, q) => (Math.abs(q.s - g.s) < Math.abs(b.s - g.s) ? q : b), st[0]);
      const gy = gi.g, hh = lev - gy, pro = 1.4;                       // bastion stands 1.4 m out at the top
      const half = g.w / 2 + 1.6, ybot = gy - 1.6;
      const e = (y) => pro + bat * (lev - y);                          // face offset at height y
      const arch = (s, y) => { const ds = s - g.s, r = g.w / 2, ys = gy + g.h - r; return Math.abs(ds) < r && (y < ys || Math.hypot(ds, y - ys) < r); };
      // the bastion's face (cells skipped inside the arch) and its two sides
      const ns = Math.ceil((2 * half) / 0.4), ny = Math.ceil((lev - ybot) / 0.4);
      for (let i = 0; i < ns; i++) for (let j = 0; j < ny; j++) {
        const s0 = g.s - half + (2 * half * i) / ns, s1 = g.s - half + (2 * half * (i + 1)) / ns;
        const y0 = ybot + ((lev - ybot) * j) / ny, y1 = ybot + ((lev - ybot) * (j + 1)) / ny;
        if (arch((s0 + s1) / 2, (y0 + y1) / 2)) continue;
        const p00 = at(s0, e(y0)), p10 = at(s1, e(y0)), p11 = at(s1, e(y1)), p01 = at(s0, e(y1));
        face(S, P(p00[0], y0, p00[1]), P(p10[0], y0, p10[1]), P(p11[0], y1, p11[1]), P(p01[0], y1, p01[1]), [outN[0], bat, outN[2]], PAINT.MARBLE, [[s0, y0], [s1, y0], [s1, y1], [s0, y1]]);
      }
      for (const sg of [-1, 1]) {
        const s = g.s + sg * half;
        const q0 = at(s, 0), q1 = at(s, e(ybot)), q2 = at(s, e(lev));
        face(S, P(q0[0], ybot, q0[1]), P(q1[0], ybot, q1[1]), P(q2[0], lev, q2[1]), P(q0[0], lev, q0[1]), [along[0] * sg, 0, along[1] * sg], PAINT.MARBLE);
      }
      // bastion top (paved) and its coping
      {
        const q0 = at(g.s - half, 0), q1 = at(g.s + half, 0), q2 = at(g.s + half, pro + 0.1), q3 = at(g.s - half, pro + 0.1);
        face(S, P(q0[0], lev + 0.06, q0[1]), P(q1[0], lev + 0.06, q1[1]), P(q2[0], lev + 0.06, q2[1]), P(q3[0], lev + 0.06, q3[1]), [0, 1, 0], PAINT.MARBLE);
      }
      // the passage: sides, the barrel vault, closed doors at the terrace edge, darkness behind their crack
      const r = g.w / 2, ys = gy + g.h - r, segs = lod >= 1 ? 6 : 12;
      const ef = (y) => e(y) + 0.02;
      for (const sg of [-1, 1]) {
        const s = g.s + sg * r;
        const q0 = at(s, 0.12), q1 = at(s, ef(gy - 0.2)), q2 = at(s, ef(ys)), q3 = at(s, 0.12);
        face(S, P(q0[0], gy - 0.2, q0[1]), P(q1[0], gy - 0.2, q1[1]), P(q2[0], ys, q2[1]), P(q3[0], ys, q3[1]), [-along[0] * sg, 0, -along[1] * sg], PAINT.MARBLE);
      }
      for (let k = 0; k < segs; k++) {
        const t0a = Math.PI * (k / segs), t1a = Math.PI * ((k + 1) / segs);
        const sA = g.s + r * Math.cos(t0a), yA = ys + r * Math.sin(t0a), sB = g.s + r * Math.cos(t1a), yB = ys + r * Math.sin(t1a);
        const qa = at(sA, 0.12), qb = at(sB, 0.12), qc = at(sB, ef(yB)), qd = at(sA, ef(yA));
        const cm = (Math.cos(t0a) + Math.cos(t1a)) / 2, sm = (Math.sin(t0a) + Math.sin(t1a)) / 2;
        face(S, P(qa[0], yA, qa[1]), P(qb[0], yB, qb[1]), P(qc[0], yB, qc[1]), P(qd[0], yA, qd[1]), [-along[0] * cm, -sm, -along[1] * cm], PAINT.MARBLE);
      }
      // doors (two leaves of studded boards) and the dark crack between them
      {
        const nd = 10;
        for (const sg of [-1, 1]) {
          for (let k = 0; k < nd; k++) {
            const t0a = Math.PI * (k / nd) / 2, t1a = Math.PI * ((k + 1) / nd) / 2;
            // each leaf: from the middle (s = g.s ± 0.03) out to the jamb, up to the arch line
            const sA = g.s + sg * (0.03 + (r - 0.03) * (k / nd)), sB = g.s + sg * (0.03 + (r - 0.03) * ((k + 1) / nd));
            const top = (s) => ys + Math.sqrt(Math.max(0, r * r - (s - g.s) ** 2));
            const qa = at(sA, 0.16), qb = at(sB, 0.16);
            face(Wd, P(qa[0], gy - 0.1, qa[1]), P(qb[0], gy - 0.1, qb[1]), P(qb[0], top(sB), qb[1]), P(qa[0], top(sA), qa[1]), outN, PAINT.PLANK, [[sA, gy], [sB, gy], [sB, top(sB)], [sA, top(sA)]]);
            void t0a; void t1a;
          }
        }
        const qa = at(g.s - 0.05, 0.1), qb = at(g.s + 0.05, 0.1);
        face(Dk, P(qa[0], gy - 0.1, qa[1]), P(qb[0], gy - 0.1, qb[1]), P(qb[0], gy + g.h, qb[1]), P(qa[0], gy + g.h, qa[1]), outN, PAINT.DARK);
      }
      // the walker stops at the doors; the bastion's corners block
      blocks.push([at(g.s - r, 0.4), at(g.s + r, 0.4), 0.3]);
      blocks.push([at(g.s - half, 0.2), at(g.s - r - 0.1, 0.2), e(gy) * 0.6 + 0.3]);
      blocks.push([at(g.s + r + 0.1, 0.2), at(g.s + half, 0.2), e(gy) * 0.6 + 0.3]);
      if (lod < 2) A.railing([P(...[at(g.s - half, -0.32)].map((p) => [p[0], lev + 0.06, p[1]])[0]), P(...[at(g.s + half, -0.32)].map((p) => [p[0], lev + 0.06, p[1]])[0])], { stone: true });
      void hh;
    }
    // ---- panels: a framed stone tablet on the face
    for (const pn of panels) {
      const gi = st.reduce((b, q) => (Math.abs(q.s - pn.s) < Math.abs(b.s - pn.s) ? q : b), st[0]);
      const y0 = Math.max(gi.g + 1.0, lev - 1.2 - pn.h), y1 = y0 + pn.h;
      const e = (y) => bat * (lev - y) + 0.22;
      for (const [s0, s1, ya, yb, d] of [[pn.s - pn.w / 2, pn.s + pn.w / 2, y0, y1, 0], [pn.s - pn.w / 2 - 0.35, pn.s + pn.w / 2 + 0.35, y0 - 0.35, y0, 0.1], [pn.s - pn.w / 2 - 0.35, pn.s + pn.w / 2 + 0.35, y1, y1 + 0.45, 0.12]]) {
        const p00 = at(s0, e(ya) + d), p10 = at(s1, e(ya) + d), p11 = at(s1, e(yb) + d), p01 = at(s0, e(yb) + d);
        face(S, P(p00[0], ya, p00[1]), P(p10[0], ya, p10[1]), P(p11[0], yb, p11[1]), P(p01[0], yb, p01[1]), [outN[0], bat, outN[2]], PAINT.MARBLE, [[s0, ya], [s1, ya], [s1, yb], [s0, yb]]);
        for (const [sa, sb] of [[s0, s0], [s1, s1]]) {
          const q0 = at(sa, e(ya) - 0.25), q1 = at(sb, e(ya) + d), q2 = at(sb, e(yb) + d), q3 = at(sa, e(yb) - 0.25);
          face(S, P(q0[0], ya, q0[1]), P(q1[0], ya, q1[1]), P(q2[0], yb, q2[1]), P(q3[0], yb, q3[1]), [along[0] * (sa === s0 ? -1 : 1), 0, along[1] * (sa === s0 ? -1 : 1)], PAINT.MARBLE);
        }
        const t0 = at(s0, e(yb) + d), t1 = at(s1, e(yb) + d), t2 = at(s1, e(yb) - 0.25), t3 = at(s0, e(yb) - 0.25);
        face(S, P(t0[0], yb, t0[1]), P(t1[0], yb, t1[1]), P(t2[0], yb, t2[1]), P(t3[0], yb, t3[1]), [0, 1, 0], PAINT.MARBLE);
      }
      // the inscription: a darker inset field with incised lines (a still reads it as written columns)
      const yi0 = y0 + 0.35, yi1 = y1 - 0.35;
      for (let k = 0; k < 3; k++) {
        const sc = pn.s + (k - 1) * pn.w * 0.26;
        const q0 = at(sc - 0.08, e(yi0) + 0.015), q1 = at(sc + 0.08, e(yi0) + 0.015), q2 = at(sc + 0.08, e(yi1) + 0.015), q3 = at(sc - 0.08, e(yi1) + 0.015);
        face(Dk, P(q0[0], yi0, q0[1]), P(q1[0], yi0, q1[1]), P(q2[0], yi1, q2[1]), P(q3[0], yi1, q3[1]), [outN[0], bat, outN[2]], PAINT.DARK);
      }
    }
  }
  // ---- the paved top (plan courses), a little proud of the ground
  if (Wl.pave !== false) {
    const nu = Math.max(1, Math.ceil((2 * F.hw) / 6)), nv = Math.max(1, Math.ceil((2 * F.hd) / 6));
    const c00 = F.world(-F.hw, -F.hd), c10 = F.world(F.hw, -F.hd), c11 = F.world(F.hw, F.hd), c01 = F.world(-F.hw, F.hd);
    const y = lev + 0.04;
    const corners = [P(c00[0], y, c00[1]), P(c10[0], y, c10[1]), P(c11[0], y, c11[1]), P(c01[0], y, c01[1])];
    // quadGrid winds by its corner order: make it face up
    const cr = (corners[1][0] - corners[0][0]) * (corners[3][2] - corners[0][2]) - (corners[1][2] - corners[0][2]) * (corners[3][0] - corners[0][0]);
    const [q0, q1, q2, q3] = cr < 0 ? corners : [corners[0], corners[3], corners[2], corners[1]];
    S.quadGrid(q0, q1, q2, q3, cr < 0 ? nu : nv, cr < 0 ? nv : nu, () => [PAINT.STONE, 0, 1, 0]);
  }
  A.put({ stone: S, dark: Dk, wood: Wd });
  const { group, info } = A.finish();
  group.position.set(cx, 0, cz);
  info.ms = Math.round(performance.now() - t0);
  info.wallQuads = wallTris / 2;
  return { group, info, blocks };
}

/**
 * One stone flight (STAIRS entry): steps on a solid mass, 副子 cheeks and a 勾闌 on the open side(s).
 */
export function buildStair(Sx, { lod = 0, name = Sx.id } = {}) {
  const t0 = performance.now();
  const A = new Assembly({ lod, ao: false, name, seed: name });
  const S = new MeshBuilder();
  const [x0, z0] = Sx.from, [x1, z1] = Sx.to;
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  const P = (x, y, z) => [x - cx, y, z - cz];
  const len = Math.hypot(x1 - x0, z1 - z0), dx = (x1 - x0) / len, dz = (z1 - z0) / len;
  const rx = -dz, rz = dx;                                     // right of the way up
  const hw = Sx.width / 2;
  const [y0, y1] = Sx.y, rise = y1 - y0;
  const flat = Math.abs(rise) < 0.3;
  const at = (s, w) => [x0 + dx * s + rx * w, z0 + dz * s + rz * w];
  const gUnder = (s, w) => { const [x, z] = at(s, w); return heightAt(x + rx * Math.sign(w) * 0.8, z + rz * Math.sign(w) * 0.8); };
  const blocks = [];
  const n = flat ? 1 : Math.max(2, Math.round(Math.abs(rise) / 0.16));
  const tread = len / n, riser = rise / n;
  const base = Math.min(y0, y1) - 2.2;
  // treads and risers (step k: s ∈ [k·tread, (k+1)·tread], top at y0 + (k + 0.5)·riser, the ramp within ±riser / 2)
  const sides = Sx.rail === 'both' ? [-1, 1] : Sx.rail === 'left' ? [-1] : Sx.rail === 'right' ? [1] : [];
  const inset = 0.42;                                           // the 副子 cheek width on an open side
  const wl = sides.includes(-1) ? -hw + inset : -hw, wr = sides.includes(1) ? hw - inset : hw;
  for (let k = 0; k < n; k++) {
    const sa = k * tread, sb = (k + 1) * tread;
    const top = flat ? y0 : y0 + (k + 0.5) * riser, prev = flat ? y0 : y0 + (k - 0.5) * riser;
    const a = at(sa, wl), b = at(sa, wr), c = at(sb, wr), d = at(sb, wl);
    face(S, P(a[0], top, a[1]), P(b[0], top, b[1]), P(c[0], top, c[1]), P(d[0], top, d[1]), [0, 1, 0], PAINT.STONE, [[sa, wl], [sa, wr], [sb, wr], [sb, wl]]);
    // the riser at the step's lower edge (facing down the flight)
    if (!flat) face(S, P(a[0], k ? prev : base, a[1]), P(b[0], k ? prev : base, b[1]), P(b[0], top, b[1]), P(a[0], top, a[1]), [-dx * Math.sign(riser), 0, -dz * Math.sign(riser)], PAINT.STONE, [[wl, prev], [wr, prev], [wr, top], [wl, top]]);
  }
  // the end face at the top (a landing's edge) and the bottom
  {
    const topY = flat ? y0 : y1 - 0.5 * riser;
    const a = at(len, -hw), b = at(len, hw);
    face(S, P(a[0], base, a[1]), P(b[0], base, b[1]), P(b[0], topY, b[1]), P(a[0], topY, a[1]), [dx, 0, dz], PAINT.STONE);
    if (flat) { const c = at(0, -hw), d = at(0, hw); face(S, P(c[0], base, c[1]), P(d[0], base, d[1]), P(d[0], y0, d[1]), P(c[0], y0, c[1]), [-dx, 0, -dz], PAINT.STONE); }
  }
  // cheeks: on each side the outer face of the mass from the ground to the 副子 slope; the 副子 itself on an open side
  const segs = Math.max(2, Math.ceil(len / 2));
  for (const sg of [-1, 1]) {
    const open = sides.includes(sg);
    for (let k = 0; k < segs; k++) {
      const sa = (len * k) / segs, sb = (len * (k + 1)) / segs;
      const ya = y0 + (rise * sa) / len + (open ? 0.18 : 0), yb = y0 + (rise * sb) / len + (open ? 0.18 : 0);
      const ga = Math.min(ya, gUnder(sa, sg * hw)) - 1.4, gb = Math.min(yb, gUnder(sb, sg * hw)) - 1.4;
      const a = at(sa, sg * hw), b = at(sb, sg * hw);
      face(S, P(a[0], ga, a[1]), P(b[0], gb, b[1]), P(b[0], yb, b[1]), P(a[0], ya, a[1]), [rx * sg, 0, rz * sg], PAINT.STONE, [[sa, ga], [sb, gb], [sb, yb], [sa, ya]]);
      if (open) {
        const ia = at(sa, sg * (hw - inset)), ib = at(sb, sg * (hw - inset));
        face(S, P(a[0], ya, a[1]), P(b[0], yb, b[1]), P(ib[0], yb, ib[1]), P(ia[0], ya, ia[1]), [0, 1, 0], PAINT.STONE);
        // the 副子's inner face down to the treads
        const tA = flat ? y0 : y0 + (rise * sa) / len - Math.abs(riser) * 0.6, tB = flat ? y0 : y0 + (rise * sb) / len - Math.abs(riser) * 0.6;
        face(S, P(ia[0], tA, ia[1]), P(ib[0], tB, ib[1]), P(ib[0], yb, ib[1]), P(ia[0], ya, ia[1]), [-rx * sg, 0, -rz * sg], PAINT.STONE);
      }
    }
    if (open) {
      // the 勾闌 rising along the cheek, in 段 of ~2.6 m
      const ns = Math.max(1, Math.round(len / 2.6));
      const pts = [];
      for (let k = 0; k <= ns; k++) { const s = (len * k) / ns, p = at(s, sg * (hw - inset * 0.5)); pts.push(P(p[0], y0 + (rise * s) / len + 0.18, p[1])); }
      if (lod < 2) A.railing(pts, { stone: true });
      // the walker stays on the ramp (heightfield.js stops it STAIR_INSET inside an open side)
      blocks.push([at(0, sg * (hw - 0.8)), at(len, sg * (hw - 0.8)), 0.3]);
    }
  }
  A.put({ stone: S });
  const { group, info } = A.finish();
  group.position.set(cx, 0, cz);
  info.ms = Math.round(performance.now() - t0);
  return { group, info, blocks };
}
