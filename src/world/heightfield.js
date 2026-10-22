// Terrain height h(x, z) of the West Lake world, composed from the master plan (layout.js).
// Pure + deterministic: every placement call uses heightAt() to sit things on the ground. No three.js
// import (works in node, workers and the browser).
//
// Composition (all metres, y = 0 is the lake surface):
//   lowland   — plain around the lake: ~1 m at the shore rising to ~4 m inland; the city ground on the east
//   hills     — layout.HILLS: anisotropic domed hills with warped outlines and ridged gullies
//   ranges    — layout.RANGES: long ridges with a noisy crest (the layered distant mountains)
//   valleys   — layout.VALLEYS: streams cut into the ground (冷泉溪 at 灵隐)
//   cliff     — layout.LINGYIN.cliff: a steep placeholder face of 飞来峰 (the karst module builds the real rock)
//   canals    — layout.CITY.canals: walled channels in the city ground down to the water datum
//   lake      — layout.LAKE: shallow basin (bed shelving from the shore), carved after the land
//   islands   — 孤山, 小瀛洲 ring, 湖心亭, and the 苏堤 / 白堤 embankments (cut at every bridge), inside the lake
//   river     — the Qiantang south-east of the hills (widening downstream)
//   palace    — layout.PALACE.mound: the mesa of the 凤凰山 east spur (a tilted plateau, cliffs on its east and north)
//   terraces  — layout.TERRACES: flat platforms at fixed levels (temple courts, the 樓閣 spur, the 六和塔 base);
//               layout.CHENGTAI: walled terraces (palace), the ground dropping sheer at their edges (walls built there)
//   stairs    — layout.STAIRS: ramps under the stone flights (walkable), applied last
//   pads      — flat building platforms (layout.HALLS with padRadius) blended into whatever is underneath
//
// The 2D distance helpers (sdPolygon, distPolyline, prepLine/polyDist, sdEllipse) come from Athenaion.
import { Simplex, smoothstep, clamp, lerp, smin, smax } from '../core/noise.js';
import * as L from './layout.js';

// ------------------------------------------------------------ 2D distance helpers (from Athenaion)
export function sdPolygon(px, pz, poly) {
  let d = Infinity, s = 1;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i, i++) {
    const ax = poly[i][0], az = poly[i][1], bx = poly[j][0], bz = poly[j][1];
    const ex = bx - ax, ez = bz - az, wx = px - ax, wz = pz - az;
    const t = clamp((wx * ex + wz * ez) / (ex * ex + ez * ez), 0, 1);
    const dx = wx - ex * t, dz = wz - ez * t;
    const dd = dx * dx + dz * dz;
    if (dd < d) d = dd;
    const c1 = pz >= az, c2 = pz < bz, c3 = ex * wz > ez * wx;
    if ((c1 && c2 && c3) || (!c1 && !c2 && !c3)) s = -s;
  }
  return s * Math.sqrt(d);
}

/** distance to a polyline; returns { d, t } where t∈[0,1] is the arc-length parameter */
export function distPolyline(px, pz, pts) {
  let best = Infinity, bestT = 0, total = 0;
  const lens = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const l = Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
    lens.push(l); total += l;
  }
  let acc = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
    const ex = bx - ax, ez = bz - az;
    const t = clamp(((px - ax) * ex + (pz - az) * ez) / (ex * ex + ez * ez), 0, 1);
    const dx = px - ax - ex * t, dz = pz - az - ez * t;
    const d = dx * dx + dz * dz;
    if (d < best) { best = d; bestT = (acc + t * lens[i]) / total; }
    acc += lens[i];
  }
  return { d: Math.sqrt(best), t: bestT };
}

export function sdEllipse(px, pz, cx, cz, rx, rz) {
  const qx = (px - cx) / rx, qz = (pz - cz) / rz;
  return (Math.hypot(qx, qz) - 1) * Math.min(rx, rz);
}

/** point on a polyline at arc parameter t ∈ [0,1] → { x, z, tx, tz } (tangent) */
export function pointOnPolyline(pts, t) {
  const lens = []; let total = 0;
  for (let i = 0; i < pts.length - 1; i++) { const l = Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]); lens.push(l); total += l; }
  let s = clamp(t, 0, 1) * total;
  for (let i = 0; i < lens.length; i++) {
    if (s <= lens[i] || i === lens.length - 1) {
      const u = lens[i] > 0 ? Math.min(1, s / lens[i]) : 0;
      const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
      return { x: ax + (bx - ax) * u, z: az + (bz - az) * u, tx: (bx - ax) / lens[i], tz: (bz - az) / lens[i] };
    }
    s -= lens[i];
  }
  const p = pts[pts.length - 1];
  return { x: p[0], z: p[1], tx: 0, tz: 1 };
}

// fast polyline (precomputed segments, no allocation). Writes the arc parameter to _polyT.
let _polyT = 0;
function prepLine(pts) {
  const segs = [];
  let total = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const ax = pts[i][0], az = pts[i][1], ex = pts[i + 1][0] - ax, ez = pts[i + 1][1] - az;
    const len = Math.hypot(ex, ez);
    segs.push({ ax, az, ex, ez, inv: 1 / (ex * ex + ez * ez), len, acc: total });
    total += len;
  }
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const [x, z] of pts) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z); }
  return { segs, total, minX, maxX, minZ, maxZ };
}
function polyDist(px, pz, P) {
  let best = Infinity, bt = 0;
  const S = P.segs;
  for (let i = 0; i < S.length; i++) {
    const s = S[i];
    let t = ((px - s.ax) * s.ex + (pz - s.az) * s.ez) * s.inv;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const dx = px - s.ax - s.ex * t, dz = pz - s.az - s.ez * t;
    const d = dx * dx + dz * dz;
    if (d < best) { best = d; bt = s.acc + t * s.len; }
  }
  _polyT = bt / P.total;
  return Math.sqrt(best);
}
/** lower bound of the distance from (x,z) to a polyline's bounding box */
function boxDist(px, pz, P) {
  const dx = Math.max(P.minX - px, 0, px - P.maxX), dz = Math.max(P.minZ - pz, 0, pz - P.maxZ);
  return Math.hypot(dx, dz);
}

// ------------------------------------------------------------ noise fields
const nWarp = new Simplex(1103), nHill = new Simplex(2718), nRidge = new Simplex(3141), nLow = new Simplex(4242), nShore = new Simplex(5150);

// ------------------------------------------------------------ hills
const HILLS = L.HILLS.map((h, i) => {
  const a = ((h.rot || 0) * Math.PI) / 180;
  return { ...h, cos: Math.cos(a), sin: Math.sin(a), reach: Math.max(h.r[0], h.r[1]) * 1.6, seed: i * 37.1 };
});

/** height of one hill at (x, z): warped dome + ridged gullies on the flanks */
function hillAt(H, x, z) {
  const dx = x - H.c[0], dz = z - H.c[1];
  if (Math.abs(dx) > H.reach || Math.abs(dz) > H.reach) return 0;
  // local frame (rotation), domain warp so the outline is never an ellipse
  const wx = nWarp.noise2(x / 700 + H.seed, z / 700) * 0.22, wz = nWarp.noise2(x / 700 - H.seed, z / 700 + 9.1) * 0.22;
  const lx = (dx * H.cos + dz * H.sin) / H.r[0] + wx, lz = (-dx * H.sin + dz * H.cos) / H.r[1] + wz;
  const d2 = lx * lx + lz * lz;
  if (d2 >= 2.2) return 0;
  // dome with a long foot (sum of a compact core and a soft skirt)
  const core = d2 < 1 ? (1 - d2) * (1 - d2) : 0;
  const skirt = Math.exp(-d2 * 2.2) * smoothstep(2.2, 1.2, d2);
  let h = H.h * (0.82 * core + 0.18 * skirt);
  if (h <= 0.01) return 0;
  // ridges and gullies running down the flanks (ridged noise, stronger mid-slope)
  const s = Math.max(H.r[0], H.r[1]) * 0.45;
  const rn = nRidge.ridged2(x / s + H.seed, z / s, 4, 2.1, 0.5) - 0.45;
  const mid = core * (1 - core) * 4;
  h *= 1 + H.rough * (rn * 0.5 * (0.35 + mid) + 0.18 * nHill.noise2(x / (s * 0.5), z / (s * 0.5)));
  return Math.max(0, h);
}

// ------------------------------------------------------------ ranges
const RANGES = L.RANGES.map((R) => ({ ...R, line: prepLine(R.points), noise: new Simplex(900 + R.seed) }));
function rangeAt(R, x, z) {
  if (boxDist(x, z, R.line) > R.w * 1.3) return 0;
  const warp = R.noise.noise2(x / (R.w * 2.2), z / (R.w * 2.2)) * R.w * 0.35;
  const d = polyDist(x, z, R.line) + warp;
  const s = d / R.w;
  if (s >= 1.25) return 0;
  const t = _polyT * R.line.total;
  // crest: several summits along the ridge
  // crest: several summits along the ridge, with sharper secondary peaks (a mountain silhouette, not a dome)
  const crest = R.h * (0.56 + 0.26 * R.noise.noise2(t / (R.w * 1.1), 3.7) + 0.12 * R.noise.noise2(t / (R.w * 0.37), 8.1) + 0.07 * (R.noise.ridged2(t / (R.w * 0.3), 5.3, 2, 2.0, 0.5) - 0.5));
  const prof = s < 1 ? Math.pow(1 - s * s, 1.6) : 0;
  const foot = Math.exp(-s * s * 3.0) * 0.12;
  const rr = R.noise.ridged2(x / (R.w * 0.55), z / (R.w * 0.55), 4, 2.05, 0.5);
  return Math.max(0, crest * (prof * (0.74 + 0.36 * rr) + foot));
}

// ------------------------------------------------------------ hill country (layout.MASSIF)
const MAS = L.MASSIF ? { ...L.MASSIF, noise: new Simplex(700 + L.MASSIF.seed) } : null;
const MAS_BOX = MAS ? MAS.polygon.reduce((b, [x, z]) => [Math.min(b[0], x), Math.min(b[1], z), Math.max(b[2], x), Math.max(b[3], z)], [Infinity, Infinity, -Infinity, -Infinity]) : null;
function massifAt(x, z) {
  if (!MAS) return 0;
  if (x < MAS_BOX[0] - MAS.fade || x > MAS_BOX[2] + MAS.fade || z < MAS_BOX[1] - MAS.fade || z > MAS_BOX[3] + MAS.fade) return 0;
  const warp = 260 * nWarp.noise2(x / 1700 + 3.1, z / 1700) ;
  const inside = -sdPolygon(x, z, MAS.polygon) + warp;            // > 0 inside
  if (inside < -MAS.fade * 0.5) return 0;
  const m = smoothstep(-MAS.fade * 0.5, MAS.fade, inside);
  const crest = lerp(MAS.edge, MAS.inland, smoothstep(0, 4000, inside));
  const s = MAS.scale;
  const rn = MAS.noise.ridged2(x / s, z / s, 5, 2.07, 0.5);      // ridges ~1, valleys ~0
  const lo = MAS.noise.noise2(x / (s * 2.6) + 7, z / (s * 2.6)) * 0.5 + 0.5;
  return Math.max(0, m * crest * (0.18 + 0.62 * rn + 0.35 * lo));
}

// ------------------------------------------------------------ lake, islands, causeways
const LAKE = L.LAKE.outline;
const SU = prepLine(L.SU_CAUSEWAY.points), BAI = prepLine(L.BAI_CAUSEWAY.points);
const RIVER = prepLine(L.QIANTANG.points);
const VALLEYS = L.VALLEYS.map((V) => ({ ...V, line: prepLine(V.points) }));
const CANALS = (L.CITY.canals || []).map((C) => ({ ...C, line: prepLine(C.points) }));

/** signed distance to the lake shore (negative = inside the lake), with a slightly ragged shoreline */
export function lakeSDF(x, z) {
  return sdPolygon(x, z, LAKE) + 5 * nShore.noise2(x / 60, z / 60) + 8 * nShore.noise2(x / 260 + 4, z / 260);
}

/** causeway embankment height (or -Infinity off the causeway, and in the water gap under each bridge) */
function causewayAt(P, C, x, z) {
  if (boxDist(x, z, P) > C.width) return -Infinity;
  const d = polyDist(x, z, P);
  const hw = C.width * 0.5;
  if (d > hw + 9) return -Infinity;
  // the water passes under the arch bridges: the bank is cut over `gap` m with stone abutments (steep ends)
  const s = _polyT * P.total;
  let cut = 0;
  for (const [i, b] of C.bridges.entries()) {
    if (C.dryBridges?.includes(i)) continue;   // a bridge standing across a dry causeway (望山桥, ink02)
    const ds = Math.abs(s - b * P.total) - (C.gap || 14) * 0.5;
    cut = Math.max(cut, 1 - smoothstep(-0.5, 1.5, ds));
  }
  // flat top, stone-revetted edge dropping to the bed
  const top = C.top - smoothstep(hw - 2, hw + 6, d) * (C.top + L.LAKE.depth + 0.5);
  return lerp(top, -L.LAKE.depth - 0.3, cut);
}

function islandsAt(x, z) {
  let h = -Infinity;
  // 孤山: long hump with a low shore apron
  const G = L.GUSHAN, ga = (G.rot * Math.PI) / 180;
  {
    const dx = x - G.center[0], dz = z - G.center[1];
    const lx = (dx * Math.cos(ga) + dz * Math.sin(ga)) / G.radii[0], lz = (-dx * Math.sin(ga) + dz * Math.cos(ga)) / G.radii[1];
    const w = nWarp.noise2(x / 150, z / 150) * 0.12;
    const d2 = lx * lx + lz * lz + w;
    if (d2 < 1.6) {
      // summit toward the east-centre (the 孤山 top), long gentle west end
      const sk = 1 - 0.35 * smoothstep(-1, 1, -lx);
      const core = d2 < 1 ? Math.pow(1 - d2, 1.3) : 0;
      const g = G.top * core * sk + 1.8 - smoothstep(0.82, 1.3, d2) * (1.8 + L.LAKE.depth + 0.4);
      h = Math.max(h, g + 3 * nHill.noise2(x / 50, z / 50) * core);
    }
  }
  // 小瀛洲: ring of land with inner ponds
  const X = L.XIAOYINGZHOU;
  {
    const r = Math.hypot(x - X.center[0], z - X.center[1]) + 10 * nShore.noise2(x / 50, z / 50);
    const dr = Math.abs(r - X.radius) - X.ring * 0.5;
    if (dr < 14) h = Math.max(h, X.top - smoothstep(-3, 9, dr) * (X.top + L.LAKE.depth + 0.4));
    // cross dykes (the island is 田-shaped)
    const ax = Math.abs(x - X.center[0]), az = Math.abs(z - X.center[1]);
    if (r < X.radius) {
      const dd = Math.min(ax, az) - 8;
      if (dd < 12) h = Math.max(h, X.top - smoothstep(-2, 8, dd) * (X.top + L.LAKE.depth + 0.4));
    }
  }
  // 湖心亭
  const Ht = L.HUXINTING;
  {
    const d = Math.hypot(x - Ht.center[0], z - Ht.center[1]) - Ht.radius + 4 * nShore.noise2(x / 20, z / 20);
    if (d < 12) h = Math.max(h, Ht.top - smoothstep(-2, 9, d) * (Ht.top + L.LAKE.depth + 0.4));
  }
  for (const I of L.ISLETS || []) {
    const d = Math.hypot(x - I.center[0], z - I.center[1]) - I.radius + 2 * nShore.noise2(x / 9, z / 9);
    if (d < 8) h = Math.max(h, I.top - smoothstep(-1.5, 6, d) * (I.top + L.LAKE.depth + 0.4));
  }
  h = Math.max(h, causewayAt(SU, L.SU_CAUSEWAY, x, z), causewayAt(BAI, L.BAI_CAUSEWAY, x, z));
  return h;
}

// ------------------------------------------------------------ 飞来峰 cliff placeholder (karst module replaces it)
const CLIFF = (() => {
  const C = L.LINGYIN?.cliff;
  if (!C) return null;
  const line = prepLine(C.face);
  const a = (C.normal * Math.PI) / 180;
  return { ...C, line, nx: Math.sin(a), nz: -Math.cos(a) };
})();
function cliffAt(x, z, base) {
  const C = CLIFF;
  if (!C || boxDist(x, z, C.line) > 120) return -Infinity;
  const d = polyDist(x, z, C.line);
  const t = _polyT;
  if (d > 110) return -Infinity;
  // which side: behind the face (opposite the normal) is rock
  const p = pointOnPolyline(C.face, t);
  const behind = -((x - p.x) * C.nx + (z - p.z) * C.nz);
  if (behind < -3) return -Infinity;
  const ends = smoothstep(0, 0.08, t) * smoothstep(1, 0.92, t);
  const ledge = 3 * nRidge.noise2(x / 9, z / 9) + 2 * nHill.noise2(x / 4, z / 4);
  return base + (C.height + ledge) * smoothstep(-1, 5, behind) * ends;
}

// ------------------------------------------------------------ rock ravines (layout.CLEFTS)
const CLF = (L.CLEFTS || []).map((C) => ({ ...C, line: prepLine(C.points) }));
/** the ravine surface at (x, z), or Infinity outside its reach: a floor descending from the head to the mouth, walls
 *  rising on each side at their own steepness, the head closing in a rounded end */
function cleftAt(C, x, z) {
  if (boxDist(x, z, C.line) > 90) return Infinity;
  const d = polyDist(x, z, C.line), t = _polyT;
  if (d > 90) return Infinity;
  const P = C.line.segs;
  // side: the sign of the cross product with the nearest segment (left of the axis walking down it = +)
  let side = 1, best = Infinity;
  for (const g of P) {
    let u = ((x - g.ax) * g.ex + (z - g.az) * g.ez) * g.inv; u = u < 0 ? 0 : u > 1 ? 1 : u;
    const dx = x - g.ax - g.ex * u, dz = z - g.az - g.ez * u, dd = dx * dx + dz * dz;
    if (dd < best) { best = dd; side = g.ex * dz - g.ez * dx < 0 ? 1 : -1; }
  }
  const run = side > 0 ? C.walls[0] : C.walls[1];
  const floor = lerp(C.floor[0], C.floor[1], t) + 0.8 * nHill.noise2(x / 9, z / 9);
  // the head (t ≈ 0) closes: the floor rises steeply back to the crest over the first ~12 m
  const head = Math.max(0, 12 - t * C.line.total) * 2.2;
  const w = Math.max(0, d - C.width / 2 + 1.5 * nRidge.noise2(x / 11, z / 11));
  return floor + head + w / run + 2.5 * (nRidge.ridged2(x / 5, z / 5, 2, 2.0, 0.5) - 0.45) * Math.min(1, w / 6);
}

// ------------------------------------------------------------ the palace mesa (layout.PALACE.mound)
const PM = (() => {
  const P = L.PALACE, M = P?.mound;
  if (!M) return null;
  const A = ((P.facing + 90) * Math.PI) / 180, B = (P.facing * Math.PI) / 180;
  let r = 0;
  for (const [a, b] of M.outline) r = Math.max(r, Math.hypot(a, b));
  return { ...M, cx: P.center[0], cz: P.center[1], ax: Math.sin(A), az: -Math.cos(A), bx: Math.sin(B), bz: -Math.cos(B), reach: r + Math.max(M.blend, M.run) + 60 };
})();
/** the mesa: plateau inside the outline, cliffs on the edges marked `cliff`, a slope into the hill elsewhere */
const _pd = new Float64Array(32);
function palaceMound(x, z, h) {
  const M = PM;
  const dx = x - M.cx, dz = z - M.cz;
  if (Math.abs(dx) > M.reach || Math.abs(dz) > M.reach) return h;
  const a = dx * M.ax + dz * M.az, b = dx * M.bx + dz * M.bz;
  // signed distance to the outline (ragged), and the cliff weight of the nearby edges (soft-min blend over ~12 m, so
  // a cliff edge fades into a hill edge round a corner)
  const O = M.outline, n = O.length;
  let best = Infinity, inside = false;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const [ax, az] = O[j], [bx, bz] = O[i];
    const ex = bx - ax, ez = bz - az, wx = a - ax, wz = b - az;
    const t = clamp((wx * ex + wz * ez) / (ex * ex + ez * ez), 0, 1);
    const d = Math.hypot(wx - ex * t, wz - ez * t);
    _pd[j] = d;
    if (d < best) best = d;
    if ((az > b) !== (bz > b) && a < (ex * (b - az)) / ez + ax) inside = !inside;
  }
  let ws = 0, cw = 0;
  for (let j = 0; j < n; j++) { const w = Math.exp(-(_pd[j] - best) / 12); ws += w; cw += w * (M.cliff[j] ?? 0); }
  cw /= ws;
  const sd = (inside ? -best : best) + 4 * nShore.noise2(x / 45, z / 45) + 1.5 * nHill.noise2(x / 12, z / 12);
  const G = M.top + M.ka * a + M.kb * b + 0.6 * nHill.noise2(x / 30, z / 30);
  if (sd <= 0) return G;
  const Ge = G - 0.12 * Math.min(sd, 20);
  // a slope into the natural ground
  const soft = lerp(Ge, h, smoothstep(0, M.blend, sd));
  // a cliff: sheer over `run` m with ledges, down to the natural ground (or `foot` above a low plain), then talus
  const run = M.run * (0.75 + 0.5 * (0.5 + 0.5 * nRidge.noise2(x / 25, z / 25)));
  const k = sd / run, F = Math.min(Ge, Math.max(M.foot, h));
  let c;
  if (k < 1) c = Math.min(Ge, lerp(Ge, F, Math.pow(smoothstep(0, 1, k), 0.6)) + 2.2 * (nRidge.ridged2(x / 6, z / 6, 2, 2.0, 0.5) - 0.4) * Math.sin(Math.PI * k));
  else c = lerp(F, h, smoothstep(1, 7, k));
  return lerp(soft, c, cw);
}

// ------------------------------------------------------------ flat platforms
const TERR = (L.TERRACES || []).map((T) => {
  const a = ((T.rot || 0) * Math.PI) / 180;
  return { ...T, cos: Math.cos(a), sin: Math.sin(a), reach: Math.hypot(T.size[0], T.size[1]) * 0.5 + (T.skirt || 20) };
});
// walled terraces: the same frame as TERR, a sheer edge (skirt ~0.3 m). The ground drops CHENGTAI_IN m inside the edge,
// so the terrain mesh's step (one cell wide) stays inside the battered wall body whose face stands at the edge
// (src/yingzao/chengtai.js); the coping and the paving cover the strip, the parapet keeps the walker off it
export const CHENGTAI_IN = 1.0;
const CHT = (L.CHENGTAI || []).map((T) => {
  const a = ((T.rot || 0) * Math.PI) / 180;
  return { ...T, skirt: T.skirt ?? 0.3, inset: T.wall ? CHENGTAI_IN : 0, cos: Math.cos(a), sin: Math.sin(a), reach: Math.hypot(T.size[0], T.size[1]) * 0.5 + 2 };
});
// stair ramps: a rectangle from `from` to `to` (width), the tread level interpolated along it. On an open (railed) side
// the ramp stops 1.1 m inside the cheek, so the terrain's step down stays inside the stone mass (the walker is kept off
// that strip by the flight's footprints)
export const STAIR_INSET = 1.1;
const STR = (L.STAIRS || []).map((S) => {
  const dx = S.to[0] - S.from[0], dz = S.to[1] - S.from[1], len = Math.hypot(dx, dz);
  const hw = S.width / 2, open = (k) => S.rail === 'both' || S.rail === k;
  // w > 0 = right of the way up
  return { ...S, ux: dx / len, uz: dz / len, len, cx: (S.from[0] + S.to[0]) / 2, cz: (S.from[1] + S.to[1]) / 2, reach: len / 2 + S.width + 3,
    flat: Math.abs(S.y[1] - S.y[0]) < 0.3,
    // a closed side (against a terrace wall) reaches 1.4 m further, over the strip inside the wall (CHENGTAI_IN), so the
    // top of a flight meets the terrace without a gap
    w0: -hw + (open('left') ? STAIR_INSET : -1.4), w1: hw - (open('right') ? STAIR_INSET : -1.4) };
});
const PADS = L.HALLS.filter((h) => h.center && h.padRadius > 0 && !h.onWater && !h.terrace)
  .map((h) => ({ x: h.center[0], z: h.center[1], r: h.padRadius, y: h.level ?? null }));

// ------------------------------------------------------------ composition
let _noPools = false;   // streamWaterAt: the stream's own bed, without its pools
/** land height without the lake (lowland + hills + ranges + streams + canals) */
function landAt(x, z) {
  // lowland plain: gentle rise inland, broad undulation
  let h = 3.2 + 1.6 * nLow.noise2(x / 1800, z / 1800) + 0.6 * nLow.noise2(x / 300, z / 300);
  // city ground on the east: flat and a little raised
  const cb = L.CITY.bounds;
  const inCity = smoothstep(cb[0] - 150, cb[0] + 100, x) * smoothstep(cb[2] + 300, cb[2], x) * smoothstep(cb[1] - 300, cb[1], z) * smoothstep(cb[3] + 300, cb[3], z);
  h = lerp(h, L.CITY.ground + 0.4 * nLow.noise2(x / 400, z / 400), inCity);
  let hills = massifAt(x, z);
  for (const H of HILLS) { if (H.afterValley) continue; const v = hillAt(H, x, z); if (v > 0) hills = hills > 0 ? smax(hills, v, 18) : v; }
  for (const R of RANGES) { const v = rangeAt(R, x, z); if (v > 0) hills = hills > 0 ? smax(hills, v, 60) : v; }
  // the city flattens the low hill feet (吴山 / 万松岭 keep their tops)
  if (hills > 0) h = smax(h, h + hills * (1 - 0.6 * inCity * (1 - smoothstep(10, 40, hills))), 6);
  // rock ravines (shot 1)
  for (const C of CLF) { const c = cleftAt(C, x, z); if (c < h) h = smin(h, c, 1.5); }
  // streams: a flat valley floor (level interpolated along the stream), walls rising beyond it, the stream bed cut in
  for (const V of VALLEYS) {
    const F = V.floor;
    const reach = F ? F.halfWidth + 400 : V.width * 4;
    if (boxDist(x, z, V.line) > reach) continue;
    const d = polyDist(x, z, V.line);
    if (F && d < reach) {
      // U-shaped trough: the floor level inside halfWidth, walls rising at F.wall beyond; hills are cut down to it,
      // low ground inside the floor is raised to it
      const fl = lerp(F.level[0], F.level[F.level.length - 1], _polyT) + 1.2 * nLow.noise2(x / 120, z / 120);
      const target = fl + Math.max(0, d - F.halfWidth) * F.wall;
      const w = 1 - smoothstep(F.halfWidth, F.halfWidth + 220, d);
      h = lerp(smin(h, target, 20), target, w);
    }
    if (d < V.width * 4) {
      const bed = h - V.depth - 0.6 * smoothstep(V.width * 0.5, 0, d);
      h = lerp(bed, h, smoothstep(V.width * 0.45, V.width * 1.6, d));
    }
    // pools: an ellipse lowered to the stream's bed (minus its own depth), banks shelving over ~3 m
    for (const P of _noPools ? [] : V.pools || []) {
      const dx = x - P.c[0], dz = z - P.c[1];
      if (Math.abs(dx) > P.r[0] + 6 || Math.abs(dz) > P.r[0] + 6) continue;
      const a = ((P.rot || 0) * Math.PI) / 180, lx = dx * Math.cos(a) + dz * Math.sin(a), lz = -dx * Math.sin(a) + dz * Math.cos(a);
      const e = (Math.hypot(lx / P.r[0], lz / P.r[1]) - 1) * Math.min(P.r[0], P.r[1]) + 1.2 * nShore.noise2(x / 6, z / 6);
      if (e > 4) continue;
      polyDist(x, z, V.line);
      const bedP = lerp(F.level[0], F.level[F.level.length - 1], _polyT) - V.depth - 0.6 - P.depth;
      h = lerp(Math.min(h, bedP), h, smoothstep(-1, 4, e));
    }
  }
  // art-directed hills that rise out of a valley floor (layout HILLS afterValley)
  for (const H of HILLS) { if (!H.afterValley) continue; const v = hillAt(H, x, z); if (v > 0) h += v; }
  // 飞来峰 face rises from the stream bank
  if (CLIFF) { const c = cliffAt(x, z, h); if (c > h) h = c; }
  // city canals: walled channels down to the water (stone embankments built by the city module)
  for (const C of CANALS) {
    if (boxDist(x, z, C.line) > C.width) continue;
    const d = polyDist(x, z, C.line);
    const hw = C.width * 0.5;
    if (d < hw + 2) h = lerp(-C.depth, h, smoothstep(hw - 0.6, hw + 0.4, d));
  }
  return h;
}

export function rawHeightAt(x, z) {
  let h = landAt(x, z);
  // lake basin: shore ~0.8 m above the water, bed shelving to the full depth
  const sd = lakeSDF(x, z);
  if (sd < 160) {
    const shoreH = 0.8 + 0.4 * nShore.noise2(x / 40, z / 40);
    const outside = smoothstep(0, 140, sd); // 0 at the shore, 1 inland
    const land = lerp(Math.min(h, shoreH + sd * 0.06), h, outside);
    const bed = -L.LAKE.depth * smoothstep(0, L.LAKE.shoreWidth, -sd) - 0.25 + 0.3 * nLow.noise2(x / 90, z / 90) * smoothstep(0, 60, -sd);
    h = sd > 0 ? Math.max(land, shoreH * smoothstep(0, 10, sd)) : bed;
    if (sd < 30) h = Math.max(h, islandsAt(x, z));
  }
  // Qiantang river: a broad channel, ~100 m of tidal flat / embankment at the banks
  if (boxDist(x, z, RIVER) < 9000) {
    const d = polyDist(x, z, RIVER) + 60 * nShore.noise2(x / 900, z / 900);
    const hw = L.QIANTANG.width * 0.5 * L.riverWiden(x);
    if (d < hw + 600) {
      const bank = Math.min(h, 2.2 + 0.015 * Math.max(0, d - hw));
      const bed = -5 - 2 * smoothstep(hw, hw * 0.3, d);
      const land = lerp(bank, h, smoothstep(hw + 40, hw + 240, d));
      h = lerp(bed, land, smoothstep(hw - 40, hw + 25, d));
    }
  }
  // the palace mesa on the 凤凰山 east spur (shot 6), after the river: its cliffs fall to the river's low bank
  if (PM) h = palaceMound(x, z, h);
  return h;
}

// pads are resolved lazily (their level is the raw height at the pad centre, kept above the water)
function padLevel(P) { if (P.y === null) P.y = Math.max(1.2, rawHeightAt(P.x, P.z)); return P.y; }

export function heightAt(x, z) {
  let h = rawHeightAt(x, z);
  for (const T of TERR) {
    const dx = x - T.center[0], dz = z - T.center[1];
    if (Math.abs(dx) > T.reach || Math.abs(dz) > T.reach) continue;
    // local frame: u along the long side (rot = compass bearing of the long side), v across
    const u = dx * T.sin - dz * T.cos, v = dx * T.cos + dz * T.sin;
    const e = Math.max(Math.abs(u) - T.size[0] * 0.5, Math.abs(v) - T.size[1] * 0.5);
    if (e < (T.skirt || 20)) h = lerp(T.level, h, smoothstep(0, T.skirt || 20, e));
  }
  for (const T of CHT) {
    const dx = x - T.center[0], dz = z - T.center[1];
    if (Math.abs(dx) > T.reach || Math.abs(dz) > T.reach) continue;
    const u = dx * T.sin - dz * T.cos, v = dx * T.cos + dz * T.sin;
    const e = Math.max(Math.abs(u) - T.size[0] * 0.5, Math.abs(v) - T.size[1] * 0.5) + T.inset;
    if (e < T.skirt) h = lerp(T.level, h, smoothstep(0, T.skirt, e));
  }
  for (const S of STR) {
    const dx = x - S.cx, dz = z - S.cz;
    if (Math.abs(dx) > S.reach || Math.abs(dz) > S.reach) continue;
    const t = dx * S.ux + dz * S.uz, w = -dx * S.uz + dz * S.ux;
    // the top end runs on 2.6 m at its level, over the strip inside a terrace wall (CHENGTAI_IN) onto the terrace (not a
    // flat landing's: it meets its flights end to end, and its run-on stood 1.75 m above the top of the flight it met)
    if (t >= -S.len / 2 - 0.05 && t <= S.len / 2 + (S.flat ? 0.05 : 2.6) && w >= S.w0 && w <= S.w1) h = lerp(S.y[0], S.y[1], clamp(t / S.len + 0.5, 0, 1));
  }
  for (const P of PADS) {
    const d = Math.hypot(x - P.x, z - P.z);
    if (d < P.r * 2.2) h = lerp(padLevel(P), h, smoothstep(P.r, P.r * 2.2, d));
  }
  return h;
}

/**
 * Water surface of a stream (layout VALLEYS with `water`) at (x, z), or -Infinity where there is none: the level of the
 * stream's floor at the nearest point of its line, less its depth, plus `water`; only where the ground is below it.
 * For the water module (the 冷泉溪 at 灵隐 runs ~25 m above the lake datum).
 */
export function streamWaterAt(x, z) {
  for (const V of VALLEYS) {
    if (V.water === undefined || !V.floor) continue;
    if (boxDist(x, z, V.line) > V.width * 2 + 20) continue;
    polyDist(x, z, V.line);
    const p = pointOnPolyline(V.points, _polyT);
    _noPools = true;
    const bed = landAt(p.x, p.z);
    _noPools = false;
    const lev = bed + V.water;
    if (heightAt(x, z) < lev) return lev;
  }
  return -Infinity;
}

/** flat ground level of a building pad / any point (alias for placement code) */
export function groundAt(x, z) { return heightAt(x, z); }

export function normalAt(x, z, e = 1) {
  const hx = heightAt(x + e, z) - heightAt(x - e, z);
  const hz = heightAt(x, z + e) - heightAt(x, z - e);
  const nx = -hx, ny = 2 * e, nz = -hz;
  const l = Math.hypot(nx, ny, nz);
  return [nx / l, ny / l, nz / l];
}
export function slopeAt(x, z, e = 1) { return 1 - normalAt(x, z, e)[1]; }
export function isWater(x, z) { return heightAt(x, z) < L.WATER_LEVEL - 0.05; }
/** signed distance to open water (negative inside); cheap approximation from the lake outline */
export function waterSDF(x, z) { return lakeSDF(x, z); }
