// The countryside of the explorable world (Southern Song 临安's farmland): what grows where, and the plots. Pure (no
// three.js): runs in the height workers (src/explore/height-worker.js op 'farm') and in src/explore/cover.js, which
// keeps the walking world's tree cover off the farmland.
//
//   farmZone(x, z, y?, slope?)  → ZONE.NONE | PADDY | TERRACE | TEA | MULBERRY
//   farmPlan({ x0, z0, x1, z1, hamlets, cityKeys, blocks })  → { plots, rims, channels, trees, tea, drape }
//                                (Float32Arrays, records of PLOT / RIM / CHAN / TREE / TEA / DRAPE floats)
//   farmCovers({ plots, tea, trees, pts })  → Uint8Array: which plants stand on the fields
//
// Slopes here are 1 − the normal's y (src/world/heightfield.js slopeAt): 0.03 ≈ 14°, 0.07 ≈ 21°, 0.5 = 60°.
// Zones: on the flat plain (slope < 0.03, below 45 m) paddy fields between the groves (the cover's grove noise below
// 0.2; the groves stay trees), some districts mulberry plots (桑园); on the gentle feet of the hills (slope 0.03–0.18,
// below 90 m) terraced paddies in patches; in the tea country west of the lake (龙井, 狮峰, 翁家山: TEA_REGION) tea on
// the slopes (0.07–0.5) in rows along the contours (teaPlan). Nothing within 30 m of the lake or the river, in the
// walled city, round the temples or on the engine's footprints.
//
// Plots: the land is cut into districts on a jittered 380 m lattice (each takes the plots nearest its centre), each
// with its own grid direction and plot size: paddies 20–42 × 11–22 m, terraces 14–26 m along the contour by a depth
// that keeps each step's riser near a metre. A plot is level (its surface at the highest of five terrain samples) and
// framed by four rims (bunds, 0.25 m each side of the shared edge, standing 0.22 m over the water, reaching 0.3 m into
// the lowest ground under the plot: on a slope they are the terrace's retaining wall). Every few columns an irrigation
// channel runs between the plots, every few rows the bund is a raised footpath.
import { hash01 } from '../core/rng.js';
import { heightAt, slopeAt, lakeSDF } from '../world/heightfield.js';
import { Simplex } from '../core/noise.js';
import * as L from '../world/layout.js';

export const ZONE = { NONE: 0, PADDY: 1, TERRACE: 2, TEA: 3, MULBERRY: 4 };
// record sizes (floats)
export const PLOT = 8;    // x, z, y, rot, w, d, kind (0 paddy, 1 terrace, 2 mulberry ground), yMin
export const RIM = 8;     // x, z, yTop, yBottom, rot, length, width, path (1: a raised footpath)
export const CHAN = 6;    // x, z, y, rot, length, width
export const TREE = 5;    // x, z, y, rot, scale
export const TEA = 6;     // ax, az, bx, bz (a piece of a row: where it crosses a drape cell), y (its contour), scale

export const GROVE = new Simplex(9071);              // the cover's groves on the plain (src/explore/cover.js)
const TEA_N = new Simplex(5113), MUL_N = new Simplex(6271), TER_N = new Simplex(7349), DIR_N = new Simplex(8123);

/** the tea country west of the lake: 龙井 at about (-2400, 2660), 狮峰 north of it, 翁家山 south */
// the tea gardens take the slopes where a slow noise is above TEA_FBM (about four in five; woods keep the rest)
const TEA_FBM = -0.3;
export const TEA_REGION = [[-3500, 1150], [-2300, 950], [-1550, 1350], [-1350, 2450], [-1650, 3500], [-2600, 3950], [-3500, 3600], [-3950, 2500]];
// round the temples and the halls outside the city: no fields (their own grounds and woods)
const KEEP = [
  ...(L.LINGYIN?.temple ? [[L.LINGYIN.temple[0], L.LINGYIN.temple[1], 520]] : []),
  [-3950, 440, 380],                                                  // 飞来峰 and the stream in front of it
  ...(L.HALLS || []).filter((h) => h.center).map((h) => [h.center[0], h.center[1], 220]),
  ...(L.PAGODAS || []).filter((p) => p.center).map((p) => [p.center[0], p.center[1], 220]),
];
const CB = L.CITY.bounds;   // x0, z0, x1, z1

function inPoly(x, z, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i], [xj, zj] = poly[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

/** water within r metres (the lake, the river, the canals): four probes and the lake's distance */
function nearWater(x, z, r) {
  if (lakeSDF(x, z) < r) return true;
  return heightAt(x + r, z) < 0.3 || heightAt(x - r, z) < 0.3 || heightAt(x, z + r) < 0.3 || heightAt(x, z - r) < 0.3;
}

export function farmZone(x, z, y = heightAt(x, z), sl = slopeAt(x, z, 6)) {
  if (y < 1.2) return ZONE.NONE;
  if (x > CB[0] - 150 && x < CB[2] + 150 && z > CB[1] - 150 && z < CB[3] + 150) return ZONE.NONE;
  for (const [kx, kz, kr] of KEEP) if ((x - kx) * (x - kx) + (z - kz) * (z - kz) < kr * kr) return ZONE.NONE;
  if (inPoly(x, z, TEA_REGION)) {
    if (sl > 0.07 && sl < 0.5 && y > 12 && y < 240 && TEA_N.fbm2(x / 380, z / 380, 2) > TEA_FBM) return nearWater(x, z, 30) ? ZONE.NONE : ZONE.TEA;
    if (sl > 0.07) return ZONE.NONE;
  }
  if (y > 90) return ZONE.NONE;
  if (sl >= 0.03 && sl < 0.18) {
    if (TER_N.fbm2(x / 520, z / 520, 2) > -0.15) return nearWater(x, z, 30) ? ZONE.NONE : ZONE.TERRACE;
    return ZONE.NONE;
  }
  if (sl < 0.03 && y < 45) {
    // the cover's groves stay trees (src/explore/cover.js plants them above 0.28 ± 0.125): the fields reach their edges
    if (GROVE.fbm2(x / 420, z / 420, 3) > 0.2) return ZONE.NONE;
    if (nearWater(x, z, 30)) return ZONE.NONE;
    return MUL_N.fbm2(x / 260, z / 260, 2) > 0.48 ? ZONE.MULBERRY : ZONE.PADDY;
  }
  return ZONE.NONE;
}

// ------------------------------------------------------------------ plots
const DIST = 380;
const district = (i, j) => [(i + 0.5 + 0.7 * (hash01(i, j, 701) - 0.5)) * DIST, (j + 0.5 + 0.7 * (hash01(i, j, 702) - 0.5)) * DIST];

// ------------------------------------------------------------------ footprints in the workers
// The engine's footprints (src/core/footprints.js: buildings, quays, bridges, rocks, stairs …) as flat records for the
// workers: [type (0 circle, 1 rect), x, z, r | hw, hd, cos, sin, bounding r]
export const BLOCK = 8;
export function packBlocks(items) {
  const out = new Float32Array(items.length * BLOCK);
  items.forEach((it, k) => out.set(it.type === 'c' ? [0, it.x, it.z, it.r, 0, 1, 0, it.br] : [1, it.x, it.z, it.hw, it.hd, it.cos, it.sin, it.br], k * BLOCK));
  return out;
}
/** a lookup over packed blocks: hit(x, z, r) → true where a circle of radius r touches one (as Footprints.isFree) */
function blockGrid(B) {
  const C = 48, grid = new Map();
  for (let o = 0; o < (B?.length || 0); o += BLOCK) {
    const x = B[o + 1], z = B[o + 2], r = B[o + 7];
    for (let i = Math.floor((x - r) / C); i <= Math.floor((x + r) / C); i++) for (let j = Math.floor((z - r) / C); j <= Math.floor((z + r) / C); j++) {
      const k = i * 100003 + j;
      let c = grid.get(k);
      if (!c) grid.set(k, (c = []));
      c.push(o);
    }
  }
  return (x, z, r) => {
    for (let i = Math.floor((x - r) / C); i <= Math.floor((x + r) / C); i++) for (let j = Math.floor((z - r) / C); j <= Math.floor((z + r) / C); j++) {
      const c = grid.get(i * 100003 + j);
      if (c) for (const o of c) {
        const dx = x - B[o + 1], dz = z - B[o + 2];
        if (B[o] === 0) { if (dx * dx + dz * dz < (B[o + 3] + r) ** 2) return true; continue; }
        const lx = dx * B[o + 5] - dz * B[o + 6], lz = dx * B[o + 6] + dz * B[o + 5];
        const qx = Math.max(Math.abs(lx) - B[o + 3], 0), qz = Math.max(Math.abs(lz) - B[o + 4], 0);
        if (qx * qx + qz * qz < r * r) return true;
      }
    }
    return false;
  };
}

/**
 * plots for the districts whose centres lie in [x0, x1) × [z0, z1). blocks: the engine's footprints outside the city
 * and the hamlets' lanes, threshing floors and shrines (packBlocks), which no plot, bund or tea row touches (the fields
 * come up to the backs of the houses); hamlets: [[x, z, r], …] (their mulberry patches round them); cityKeys: the 200 m
 * cells holding the city's houses (keys i * 100003 + j).
 */
export function farmPlan({ x0, z0, x1, z1, hamlets = [], cityKeys = null, blocks = null }) {
  const cityCells = cityKeys ? new Set(cityKeys) : null;
  const plots = [], rims = [], chans = [], trees = [], tea = [], drape = [];
  const hit = blockGrid(blocks);
  const free = (x, z, r = 3) => {
    if (cityCells && cityCells.has(Math.floor(x / 200) * 100003 + Math.floor(z / 200))) return false;
    return !hit(x, z, r);
  };
  const i0 = Math.floor(x0 / DIST), i1 = Math.ceil(x1 / DIST), j0 = Math.floor(z0 / DIST), j1 = Math.ceil(z1 / DIST);
  for (let j = j0; j < j1; j++) for (let i = i0; i < i1; i++) {
    const [cx, cz] = district(i, j);
    if (cx < x0 || cx >= x1 || cz < z0 || cz >= z1) continue;
    // the district's land: the commonest zone on a 5 × 5 probe round its centre
    const counts = [0, 0, 0, 0, 0];
    for (let b = -2; b <= 2; b++) for (let a = -2; a <= 2; a++) counts[farmZone(cx + a * 70, cz + b * 70)]++;
    // terraces where the hill feet take a fifth of it, else the flat fields (paddy and mulberry together: each plot takes
    // its own); the tea country is planted cell by cell below (teaPlan)
    const flat = counts[ZONE.PADDY] + counts[ZONE.MULBERRY];
    const zone = counts[ZONE.TERRACE] >= 5 && counts[ZONE.TERRACE] >= flat * 0.5 ? ZONE.TERRACE : flat >= 4 ? ZONE.PADDY : counts[ZONE.TERRACE] >= 4 ? ZONE.TERRACE : 0;
    if (!zone) continue;
    const nb = [];
    for (let b = -1; b <= 1; b++) for (let a = -1; a <= 1; a++) if (a || b) nb.push(district(i + a, j + b));
    const mine = (x, z) => { const d0 = (x - cx) ** 2 + (z - cz) ** 2; for (const [nx, nz] of nb) if ((x - nx) ** 2 + (z - nz) ** 2 < d0) return false; return true; };
    // grid direction and plot size
    let rot, pw, pd;
    const h = (k) => hash01(i, j, 710 + k);
    if (zone === ZONE.TERRACE) {
      // along the contour at the centre (the gradient's normal), a little wander from district to district
      const e = 12, gx = heightAt(cx + e, cz) - heightAt(cx - e, cz), gz = heightAt(cx, cz + e) - heightAt(cx, cz - e);
      rot = Math.atan2(gx, gz) + Math.PI / 2;
      const sl = Math.max(0.02, Math.hypot(gx, gz) / (2 * e));
      pw = 14 + 12 * h(1); pd = Math.min(14, Math.max(4.5, 1.1 / sl));
    } else {
      rot = (DIR_N.fbm2(cx / 2600, cz / 2600, 2) * 0.9 + (h(2) - 0.5) * 0.5) * Math.PI;
      pw = 20 + 22 * h(1); pd = 11 + 11 * h(3);
    }
    const ux = Math.cos(rot), uz = Math.sin(rot), vx = -uz, vz = ux;   // u along the plot's width, v across
    const chanEvery = zone === ZONE.TERRACE ? 0 : 3 + Math.floor(3 * h(4));
    const pathEvery = 3 + Math.floor(4 * h(5));
    const span = DIST * 0.95;
    const na = Math.ceil(span / pw), nbv = Math.ceil(span / pd);
    for (let b = -nbv; b < nbv; b++) for (let a = -na; a < na; a++) {
      const ou = (a + 0.5) * pw, ov = (b + 0.5) * pd;
      const x = cx + ux * ou + vx * ov, z = cz + uz * ou + vz * ov;
      if (!mine(x, z) || !free(x, z)) continue;
      // the four corners and the centre must be this district's land
      const hw = pw / 2, hd = pd / 2;
      const P = [[x, z], [x + ux * hw + vx * hd, z + uz * hw + vz * hd], [x - ux * hw + vx * hd, z - uz * hw + vz * hd], [x + ux * hw - vx * hd, z + uz * hw - vz * hd], [x - ux * hw - vx * hd, z - uz * hw - vz * hd]];
      let ok = true, ymax = -1e9, ymin = 1e9;
      for (const [px, pz] of P) {
        const y = heightAt(px, pz);
        const zz = farmZone(px, pz, y);
        // flat plots stay on the flat; a terrace may run onto the flat at its foot
        if (zz !== zone && !(zone === ZONE.PADDY && zz === ZONE.MULBERRY) && !(zone === ZONE.TERRACE && (zz === ZONE.PADDY || zz === ZONE.MULBERRY))) { ok = false; break; }
        ymax = Math.max(ymax, y); ymin = Math.min(ymin, y);
      }
      if (!ok || !free(P[1][0], P[1][1]) || !free(P[4][0], P[4][1]) || !free(P[2][0], P[2][1]) || !free(P[3][0], P[3][1]) || !free(x, z, Math.min(hw, hd) + 2)) continue;
      if (ymax - ymin > (zone === ZONE.TERRACE ? 2.4 : 1.3)) continue;
      // a channel along the +u edge every few columns; the plot narrows to make room
      const chan = chanEvery && ((a % chanEvery) + chanEvery) % chanEvery === chanEvery - 1;
      const path = ((b % pathEvery) + pathEvery) % pathEvery === pathEvery - 1;
      const y = ymax + 0.08;
      // mulberry where the zone says so, and in patches round the hamlets (their silkworms)
      let kind = zone === ZONE.TERRACE ? 1 : 0;
      if (zone === ZONE.PADDY) {
        if (farmZone(x, z) === ZONE.MULBERRY) kind = 2;
        else for (const [kx, kz, kr] of hamlets) { const d = Math.hypot(x - kx, z - kz); if (d < kr + 60 && hash01(i, j, a, b, 77) < 0.22) { kind = 2; break; } }
      }
      const cw = chan ? 1.0 : 0;                  // channel width taken from the plot
      const pxc = x - ux * cw / 2, pzc = z - uz * cw / 2, pwi = pw - cw;
      plots.push(pxc, pzc, y, rot, pwi, pd, kind, ymin);
      // rims: inside each edge (a neighbour's rim completes the bund); the footpath edge wider and higher
      const yb = ymin - 0.3;
      const rim = (ex, ez, len, r, wid, top, isPath) => rims.push(ex, ez, top, yb, r, len, wid, isPath ? 1 : 0);
      const rw = 0.25, pw2 = path ? 0.7 : rw;
      rim(pxc + ux * (pwi / 2 - rw / 2), pzc + uz * (pwi / 2 - rw / 2), pd, rot + Math.PI / 2, rw, y + 0.22, false);
      rim(pxc - ux * (pwi / 2 - rw / 2), pzc - uz * (pwi / 2 - rw / 2), pd, rot + Math.PI / 2, rw, y + 0.22, false);
      rim(pxc + vx * (pd / 2 - pw2 / 2), pzc + vz * (pd / 2 - pw2 / 2), pwi, rot, pw2, y + (path ? 0.34 : 0.22), path);
      rim(pxc - vx * (pd / 2 - rw / 2), pzc - vz * (pd / 2 - rw / 2), pwi, rot, rw, y + 0.22, false);
      if (chan) chans.push(x + ux * (pw / 2 - cw / 2), z + uz * (pw / 2 - cw / 2), y - 0.25, rot + Math.PI / 2, pd, cw * 0.8);
      // mulberry: rows of pollarded trees ~4 m apart
      if (kind === 2) {
        const SP = 4.2, nu = Math.max(1, Math.floor((pwi - 2) / SP)), nv = Math.max(1, Math.floor((pd - 2) / SP));
        for (let q = 0; q < nv; q++) for (let p = 0; p < nu; p++) {
          const su = (p - (nu - 1) / 2) * SP, sv = (q - (nv - 1) / 2) * SP;
          const tx = pxc + ux * su + vx * sv, tz = pzc + uz * su + vz * sv;
          const r = hash01(i, j, a * 131 + p, b * 137 + q);
          trees.push(tx, tz, y - 0.02, r * Math.PI * 2, 0.8 + 0.45 * hash01(i, j, a * 31 + p, b * 37 + q, 3));
        }
      }
    }
  }
  teaPlan(x0, z0, x1, z1, free, drape, tea);
  return { plots: Float32Array.from(plots), rims: Float32Array.from(rims), channels: Float32Array.from(chans), trees: Float32Array.from(trees), tea: Float32Array.from(tea), drape: Float32Array.from(drape) };
}

// ------------------------------------------------------------------ tea
// Rows follow the contours: one every TEA_DH m of height (1.1–2.3 m apart on the ground on these 23–42° slopes). The
// zone is cut into TEA_CELL grid cells on a world lattice; each cell is a quad of the drape (its corner heights: the far
// rows are painted on it from the height, src/explore/fields.js) and gives a hedge piece for every contour crossing
// it (marching squares on the same corner heights, so the near hedges stand on the drape's rows).
export const TEA_DH = 1.0, TEA_CELL = 5;
export const DRAPE = 6;   // x0, z0 (the cell's corner), h00, h10, h01, h11 (heights at x0|x1 × z0|z1)
const TEA_BOX = TEA_REGION.reduce((b, [x, z]) => [Math.min(b[0], x), Math.min(b[1], z), Math.max(b[2], x), Math.max(b[3], z)], [1e9, 1e9, -1e9, -1e9]);

/** the tea cells and hedges over [x0, x1) × [z0, z1) (cells by their corner), into drape (DRAPE) and out (TEA) */
function teaPlan(x0, z0, x1, z1, free, drape, out) {
  const C = TEA_CELL;
  const i0 = Math.ceil(Math.max(x0, TEA_BOX[0]) / C), i1 = Math.ceil(Math.min(x1, TEA_BOX[2]) / C);
  const j0 = Math.ceil(Math.max(z0, TEA_BOX[1]) / C), j1 = Math.ceil(Math.min(z1, TEA_BOX[3]) / C);
  if (i1 <= i0 || j1 <= j0) return;
  // corner heights with a one-cell margin (the slope at a cell from its neighbours' corners too)
  const W = i1 - i0 + 3, Hh = j1 - j0 + 3, hg = new Float32Array(W * Hh);
  const inside = new Uint8Array(W * Hh);
  for (let b = 0; b < Hh; b++) for (let a = 0; a < W; a++) {
    const x = (i0 - 1 + a) * C, z = (j0 - 1 + b) * C;
    inside[b * W + a] = inPoly(x, z, TEA_REGION) ? 1 : 0;
  }
  for (let b = 0; b < Hh; b++) for (let a = 0; a < W; a++) {
    // heights only round the tea country's polygon
    let near = 0;
    for (let q = Math.max(0, b - 1); q <= Math.min(Hh - 1, b + 1) && !near; q++) for (let p = Math.max(0, a - 1); p <= Math.min(W - 1, a + 1); p++) if (inside[q * W + p]) { near = 1; break; }
    hg[b * W + a] = near ? heightAt((i0 - 1 + a) * C, (j0 - 1 + b) * C) : -1e4;
  }
  const H = (a, b) => hg[(b + 1) * W + a + 1];   // corner (i0 + a, j0 + b)
  const nw = (x, z) => { if (lakeSDF(x, z) < 30) return true; const r = 30; return heightAt(x + r, z) < 0.3 || heightAt(x - r, z) < 0.3 || heightAt(x, z + r) < 0.3 || heightAt(x, z - r) < 0.3; };
  const keep = (x, z) => { for (const [kx, kz, kr] of KEEP) if ((x - kx) * (x - kx) + (z - kz) * (z - kz) < kr * kr) return false; return true; };
  const ex = [[0, 0, 1, 0], [1, 0, 1, 1], [0, 1, 1, 1], [0, 0, 0, 1]];   // the four edges: corner a → corner b ([da, db] each)
  for (let b = 0; b < j1 - j0; b++) for (let a = 0; a < i1 - i0; a++) {
    const h00 = H(a, b), h10 = H(a + 1, b), h01 = H(a, b + 1), h11 = H(a + 1, b + 1);
    if (h00 < -1e3 || h10 < -1e3 || h01 < -1e3 || h11 < -1e3) continue;
    const x = (i0 + a) * C, z = (j0 + b) * C, xc = x + C / 2, zc = z + C / 2;
    if (!inPoly(xc, zc, TEA_REGION)) continue;
    // the zone's rules (farmZone), the slope over the cell and its neighbours (≈ slopeAt at 6 m)
    const y = (h00 + h10 + h01 + h11) / 4;
    if (y <= 12 || y >= 240) continue;
    const gx = (H(a + 2, b) + H(a + 2, b + 1) - H(a - 1, b) - H(a - 1, b + 1)) / (6 * C), gz = (H(a, b + 2) + H(a + 1, b + 2) - H(a, b - 1) - H(a + 1, b - 1)) / (6 * C);
    if (!(Math.abs(gx) < 50 && Math.abs(gz) < 50)) continue;   // a margin corner off the polygon
    const sl = 1 - 1 / Math.sqrt(1 + gx * gx + gz * gz);
    if (sl <= 0.07 || sl >= 0.5) continue;
    if (TEA_N.fbm2(xc / 380, zc / 380, 2) <= TEA_FBM) continue;
    if (!keep(xc, zc) || !free(xc, zc, 2) || nw(xc, zc)) continue;
    drape.push(x, z, h00, h10, h01, h11);
    // hedges: each level crossing the cell
    const v = [h00, h10, h01, h11], P = [[0, 0], [1, 0], [0, 1], [1, 1]], idx = (da, db) => db * 2 + da;
    const lo = Math.min(...v), hi = Math.max(...v);
    for (let k = Math.ceil(lo / TEA_DH); k * TEA_DH <= hi; k++) {
      const L = k * TEA_DH, pts = [];
      for (const [pa, pb, qa, qb] of ex) {
        const va = v[idx(pa, pb)], vb = v[idx(qa, qb)];
        if ((va - L) * (vb - L) >= 0) continue;
        const t = (L - va) / (vb - va);
        pts.push([x + (pa + (qa - pa) * t) * C, z + (pb + (qb - pb) * t) * C]);
      }
      // a saddle (four crossings) pairs by the centre's side; otherwise the one segment
      const segs = pts.length === 2 ? [[pts[0], pts[1]]] : pts.length === 4 ? ((y > L) === (h00 > L) ? [[pts[0], pts[1]], [pts[2], pts[3]]] : [[pts[0], pts[3]], [pts[1], pts[2]]]) : [];
      for (const [[ax, az], [bx, bz]] of segs) {
        const len = Math.hypot(bx - ax, bz - az);
        if (len < 0.05) continue;
        if (hash01(i0 + a, j0 + b, k, 3) < 0.05) continue;          // a gap in the row
        out.push(ax, az, bx, bz, L, 0.85 + 0.3 * hash01(i0 + a, j0 + b, k, 4));
      }
    }
  }
}

/**
 * which plants stand on the fields: pts [x, z, …] → Uint8Array (1: on a plot (1.5 m round it), a tea row (within
 * 1.4 m of it) or a mulberry (within 2 m)). The walking world hides those (src/explore/fields.js).
 */
export function farmCovers({ plots, tea, trees, pts }) {
  const C = 40, grid = new Map();
  const put = (x, z, r, tag) => {
    for (let i = Math.floor((x - r) / C); i <= Math.floor((x + r) / C); i++) for (let j = Math.floor((z - r) / C); j <= Math.floor((z + r) / C); j++) {
      const k = i * 100003 + j;
      let c = grid.get(k);
      if (!c) grid.set(k, (c = []));
      c.push(tag);
    }
  };
  // tags: plot record offsets as is, tea offsets + 1e8, mulberry offsets + 2e8
  for (let o = 0; o < plots.length; o += PLOT) put(plots[o], plots[o + 1], Math.hypot(plots[o + 4], plots[o + 5]) / 2 + 1.5, o);
  for (let o = 0; o < tea.length; o += TEA) put((tea[o] + tea[o + 2]) / 2, (tea[o + 1] + tea[o + 3]) / 2, Math.hypot(tea[o + 2] - tea[o], tea[o + 3] - tea[o + 1]) / 2 + 1.4, 1e8 + o);
  for (let o = 0; o < trees.length; o += TREE) put(trees[o], trees[o + 1], 2, 2e8 + o);
  const out = new Uint8Array(pts.length / 2);
  for (let k = 0; k < out.length; k++) {
    const x = pts[k * 2], z = pts[k * 2 + 1];
    const c = grid.get(Math.floor(x / C) * 100003 + Math.floor(z / C));
    if (!c) continue;
    for (const t of c) {
      if (t < 1e8) {
        const dx = x - plots[t], dz = z - plots[t + 1], cr = Math.cos(plots[t + 3]), sr = Math.sin(plots[t + 3]);
        if (Math.abs(dx * cr + dz * sr) < plots[t + 4] / 2 + 1.5 && Math.abs(-dx * sr + dz * cr) < plots[t + 5] / 2 + 1.5) { out[k] = 1; break; }
      } else if (t < 2e8) {
        // within 1.4 m of the piece
        const o = t - 1e8, ux = tea[o + 2] - tea[o], uz = tea[o + 3] - tea[o + 1], l2 = ux * ux + uz * uz;
        const q = l2 > 0 ? Math.max(0, Math.min(1, ((x - tea[o]) * ux + (z - tea[o + 1]) * uz) / l2)) : 0;
        if ((x - tea[o] - ux * q) ** 2 + (z - tea[o + 1] - uz * q) ** 2 < 1.96) { out[k] = 1; break; }
      } else {
        const o = t - 2e8;
        if ((x - trees[o]) ** 2 + (z - trees[o + 1]) ** 2 < 4) { out[k] = 1; break; }
      }
    }
  }
  return out;
}
