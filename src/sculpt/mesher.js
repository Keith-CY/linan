// SDF → triangle mesh with naive surface nets and block-sparse narrow-band sampling, so carved stone (the 布袋弥勒, the
// 飞来峰 cliff, sculpted rocks) can be modelled as signed distance functions and meshed at any resolution.
// Derived from Athenaion (MIT, NOTICE): sculpt/mesher.js (surface nets, narrow band, Newton projection, gradient
// normals) and sculpt/bakeutil.js (SDF ambient occlusion / cavity). Ours: per-block vertex tables (no giant maps),
// clipping for nested resolution regions, an origin offset (float32 precision at world coordinates), index-based
// smoothing and the rock attribute bake (aRock = AO, cavity, carved mask, sky openness).
//
//   const m = meshSDF(sdf, { min, max, cell, origin, keep, smooth: 1, project: 1 });
//   bakeRock(m, sdf, { aoDist, carved })   → adds m.rock (Uint8 RGBA per vertex)
//   toGeometry(m)                          → THREE.BufferGeometry (position, normal, aRock)
import * as THREE from 'three';

/**
 * @param {(x,y,z)=>number} sdf  signed distance (metres, world space); negative inside
 * @param {object} o
 * @param {number[]} o.min, o.max   box to mesh (world)
 * @param {number} o.cell           voxel size (m)
 * @param {number[]} [o.origin]     subtracted from every output position (default: o.min)
 * @param {(x,y,z)=>boolean} [o.keep] faces are emitted only where keep(edge midpoint) is true
 * @param {number} [o.bandScale=1.5] narrow band multiplier (raise for fields with Lipschitz > 1)
 * @param {number} [o.smooth=1] laplacian passes; [o.smoothFactor=0.5]
 * @param {number} [o.project=1] Newton projection steps back onto the zero set
 * @returns {{ positions: Float32Array, normals: Float32Array, index: Uint32Array, origin: number[], cell: number }}
 */
export function meshSDF(sdf, o) {
  const min = o.min, max = o.max, h = o.cell;
  const origin = o.origin || min;
  const B = 8, S = B + 1;
  const band = o.bandScale ?? 1.5;
  const nx = Math.ceil((max[0] - min[0]) / h), ny = Math.ceil((max[1] - min[1]) / h), nz = Math.ceil((max[2] - min[2]) / h);
  const bx = Math.ceil(nx / B), by = Math.ceil(ny / B), bz = Math.ceil(nz / B);
  const bdiag = Math.sqrt(3) * B * h;
  const blocks = new Map();
  const bidx = (i, j, k) => (i * by + j) * bz + k;
  // 1) coarse classification at block centres, 2) fine samples in near-surface blocks
  for (let i = 0; i < bx; i++) for (let j = 0; j < by; j++) for (let k = 0; k < bz; k++) {
    const cx = min[0] + (i + 0.5) * B * h, cy = min[1] + (j + 0.5) * B * h, cz = min[2] + (k + 0.5) * B * h;
    const d = sdf(cx, cy, cz);
    if (Math.abs(d) > bdiag * 0.5 * band + h) continue;
    const arr = new Float32Array(S * S * S);
    let neg = false, pos = false;
    for (let a = 0; a < S; a++) for (let b = 0; b < S; b++) for (let c = 0; c < S; c++) {
      const v = sdf(min[0] + (i * B + a) * h, min[1] + (j * B + b) * h, min[2] + (k * B + c) * h);
      arr[(a * S + b) * S + c] = v;
      if (v < 0) neg = true; else pos = true;
    }
    // keep fully-inside / fully-outside blocks too (their shared faces feed the neighbours' edges)
    blocks.set(bidx(i, j, k), { s: arr, v: (neg && pos) ? new Int32Array(B * B * B).fill(-1) : null, i, j, k });
  }
  // sample accessor (grid point → value or NaN)
  const sample = (gi, gj, gk) => {
    if (gi < 0 || gj < 0 || gk < 0) return NaN;
    const i0 = Math.floor(gi / B), j0 = Math.floor(gj / B), k0 = Math.floor(gk / B);
    for (let di = 0; di <= (gi % B === 0 && i0 > 0 ? 1 : 0); di++) for (let dj = 0; dj <= (gj % B === 0 && j0 > 0 ? 1 : 0); dj++) for (let dk = 0; dk <= (gk % B === 0 && k0 > 0 ? 1 : 0); dk++) {
      const i = i0 - di, j = j0 - dj, k = k0 - dk;
      if (i >= bx || j >= by || k >= bz) continue;
      const blk = blocks.get(bidx(i, j, k));
      if (blk) return blk.s[((gi - i * B) * S + (gj - j * B)) * S + (gk - k * B)];
    }
    return NaN;
  };
  // 3) one vertex per cell with a sign change
  const verts = [];
  const corners = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0], [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1]];
  const edges = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
  const vals = new Float32Array(8);
  for (const blk of blocks.values()) {
    if (!blk.v) continue;
    const s = blk.s;
    for (let a = 0; a < B; a++) for (let b = 0; b < B; b++) for (let c = 0; c < B; c++) {
      let mask = 0;
      for (let q = 0; q < 8; q++) {
        const v = s[((a + corners[q][0]) * S + (b + corners[q][1])) * S + (c + corners[q][2])];
        vals[q] = v; if (v < 0) mask |= 1 << q;
      }
      if (mask === 0 || mask === 255) continue;
      let sx = 0, sy = 0, sz = 0, n = 0;
      for (let e = 0; e < 12; e++) {
        const e0 = edges[e][0], e1 = edges[e][1];
        const v0 = vals[e0], v1 = vals[e1];
        if ((v0 < 0) === (v1 < 0)) continue;
        const t = v0 / (v0 - v1);
        sx += corners[e0][0] + (corners[e1][0] - corners[e0][0]) * t;
        sy += corners[e0][1] + (corners[e1][1] - corners[e0][1]) * t;
        sz += corners[e0][2] + (corners[e1][2] - corners[e0][2]) * t;
        n++;
      }
      blk.v[(a * B + b) * B + c] = verts.length / 3;
      verts.push(min[0] + (blk.i * B + a + sx / n) * h, min[1] + (blk.j * B + b + sy / n) * h, min[2] + (blk.k * B + c + sz / n) * h);
    }
  }
  const vAt = (gi, gj, gk) => {
    if (gi < 0 || gj < 0 || gk < 0) return -1;
    const i = Math.floor(gi / B), j = Math.floor(gj / B), k = Math.floor(gk / B);
    if (i >= bx || j >= by || k >= bz) return -1;
    const blk = blocks.get(bidx(i, j, k));
    if (!blk || !blk.v) return -1;
    return blk.v[((gi - i * B) * B + (gj - j * B)) * B + (gk - k * B)];
  };
  // 4) faces: every grid edge with a sign change joins the 4 cells around it
  const index = [];
  const keep = o.keep;
  const quad = (a, b, c, d, flip, ex, ey, ez) => {
    if (a < 0 || b < 0 || c < 0 || d < 0) return;
    if (keep && !keep(ex, ey, ez)) return;
    if (flip) index.push(a, c, b, b, c, d); else index.push(a, b, c, b, d, c);
  };
  for (const blk of blocks.values()) {
    if (!blk.v) continue;
    for (let a = 0; a < B; a++) for (let b = 0; b < B; b++) for (let c = 0; c < B; c++) {
      if (blk.v[(a * B + b) * B + c] < 0) continue;
      const i = blk.i * B + a, j = blk.j * B + b, k = blk.k * B + c;
      const vx = sample(i + 1, j + 1, k + 1);
      if (Number.isNaN(vx)) continue;
      const X = min[0] + (i + 1) * h, Y = min[1] + (j + 1) * h, Z = min[2] + (k + 1) * h;
      const ax = sample(i, j + 1, k + 1), ay = sample(i + 1, j, k + 1), az = sample(i + 1, j + 1, k);
      if (!Number.isNaN(ax) && (vx < 0) !== (ax < 0)) quad(vAt(i, j, k), vAt(i, j + 1, k), vAt(i, j, k + 1), vAt(i, j + 1, k + 1), vx < 0, X - h / 2, Y, Z);
      if (!Number.isNaN(ay) && (vx < 0) !== (ay < 0)) quad(vAt(i, j, k), vAt(i, j, k + 1), vAt(i + 1, j, k), vAt(i + 1, j, k + 1), vx < 0, X, Y - h / 2, Z);
      if (!Number.isNaN(az) && (vx < 0) !== (az < 0)) quad(vAt(i, j, k), vAt(i + 1, j, k), vAt(i, j + 1, k), vAt(i + 1, j + 1, k), vx < 0, X, Y, Z - h / 2);
    }
  }
  blocks.clear();
  // drop unreferenced vertices (clipped regions) and compact
  let P = new Float64Array(verts);
  let I = new Uint32Array(index);
  ({ P, I } = compact(P, I));
  // 5) laplacian smoothing (index based), 6) projection back onto the zero set
  if ((o.smooth ?? 1) > 0) smoothPositions(P, I, o.smooth ?? 1, o.smoothFactor ?? 0.5);
  const proj = o.project ?? 1;
  const ep = h * 0.5;
  for (let it = 0; it < proj; it++) {
    for (let v = 0; v < P.length; v += 3) {
      const x = P[v], y = P[v + 1], z = P[v + 2];
      const d = sdf(x, y, z);
      const gx = sdf(x + ep, y, z) - sdf(x - ep, y, z), gy = sdf(x, y + ep, z) - sdf(x, y - ep, z), gz = sdf(x, y, z + ep) - sdf(x, y, z - ep);
      const g2 = (gx * gx + gy * gy + gz * gz) / (4 * ep * ep);
      if (g2 < 1e-8) continue;
      let kk = d / g2 / (2 * ep);
      const step = Math.abs(kk) * Math.sqrt(gx * gx + gy * gy + gz * gz);
      if (step > h * 0.5) kk *= (h * 0.5) / step;
      P[v] = x - gx * kk; P[v + 1] = y - gy * kk; P[v + 2] = z - gz * kk;
    }
  }
  // 7) normals from the SDF gradient (tetrahedral differences); o.normalSdf = the true field when sdf is a modified one
  const N = new Float32Array(P.length);
  const e = h * 0.5;
  const ns = o.normalSdf || sdf;
  for (let v = 0; v < P.length; v += 3) {
    const x = P[v], y = P[v + 1], z = P[v + 2];
    const a = ns(x + e, y - e, z - e), b = ns(x - e, y - e, z + e), c = ns(x - e, y + e, z - e), d = ns(x + e, y + e, z + e);
    let gx = a - b - c + d, gy = -a - b + c + d, gz = -a + b - c + d;
    const l = Math.hypot(gx, gy, gz) || 1;
    N[v] = gx / l; N[v + 1] = gy / l; N[v + 2] = gz / l;
  }
  return { world: P, normals: N, index: I, origin, cell: h };
}

function compact(P, I) {
  const n = P.length / 3;
  const map = new Int32Array(n).fill(-1);
  let m = 0;
  for (let t = 0; t < I.length; t++) { const v = I[t]; if (map[v] < 0) map[v] = m++; }
  if (m === n) return { P, I };
  const P2 = new Float64Array(m * 3);
  for (let v = 0; v < n; v++) { const w = map[v]; if (w >= 0) { P2[w * 3] = P[v * 3]; P2[w * 3 + 1] = P[v * 3 + 1]; P2[w * 3 + 2] = P[v * 3 + 2]; } }
  for (let t = 0; t < I.length; t++) I[t] = map[I[t]];
  return { P: P2, I };
}

function smoothPositions(P, I, passes, f) {
  const n = P.length / 3;
  const acc = new Float64Array(n * 3), cnt = new Float32Array(n);
  for (let p = 0; p < passes; p++) {
    acc.fill(0); cnt.fill(0);
    for (let t = 0; t < I.length; t += 3) {
      const a = I[t], b = I[t + 1], c = I[t + 2];
      for (const [u, w] of [[a, b], [b, c], [c, a]]) {
        acc[u * 3] += P[w * 3]; acc[u * 3 + 1] += P[w * 3 + 1]; acc[u * 3 + 2] += P[w * 3 + 2]; cnt[u]++;
        acc[w * 3] += P[u * 3]; acc[w * 3 + 1] += P[u * 3 + 1]; acc[w * 3 + 2] += P[u * 3 + 2]; cnt[w]++;
      }
    }
    for (let v = 0; v < n; v++) {
      if (!cnt[v]) continue;
      for (let q = 0; q < 3; q++) P[v * 3 + q] += (acc[v * 3 + q] / cnt[v] - P[v * 3 + q]) * f;
    }
  }
}

/**
 * Bake per-vertex stone attributes into m.rock (Uint8 RGBA):
 *   R = ambient occlusion from the SDF (1 open), G = cavity (1 deep crevice), B = carved mask (0..1, from o.carved),
 *   A = sky openness straight up (1 = rain reaches it; 0 = sheltered under an overhang / the niche roof)
 * @param {object} m   result of meshSDF
 * @param {(x,y,z)=>number} sdf  the FULL field (all regions)
 * @param {object} o  { aoDist (m), cavDist (m), upDist (m), carved: (x,y,z)=>0..1 }
 */
export function bakeRock(m, sdf, o = {}) {
  const P = m.world, N = m.normals;
  const n = P.length / 3;
  const out = new Uint8Array(n * 4);
  // AO probes at fixed absolute distances (the same for every region of an object: no seams in the shading)
  const cavD = o.cavDist ?? 0.04, upD = o.upDist ?? 6;
  const steps = o.aoSteps || [0.025, 0.06, 0.14, 0.32, 0.7, 1.5];
  const aoD = steps[steps.length - 1];
  for (let i = 0; i < n; i++) {
    const x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2];
    const nx = N[i * 3], ny = N[i * 3 + 1], nz = N[i * 3 + 2];
    let occ = 0, ws = 0;
    for (let s = 0; s < steps.length; s++) {
      const hh = steps[s];
      const d = sdf(x + nx * hh, y + ny * hh, z + nz * hh);
      const w = 1 / (1 + s * 0.35);
      occ += w * Math.max(0, Math.min(1, (hh - d) / hh)); ws += w;
    }
    occ /= ws;
    // tilted probes toward the sky (catches overhangs and the niche walls)
    let side = 0;
    const tx = Math.abs(ny) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    let ax = ny * tx[2] - nz * tx[1], ay = nz * tx[0] - nx * tx[2], az = nx * tx[1] - ny * tx[0];
    const al = Math.hypot(ax, ay, az) || 1; ax /= al; ay /= al; az /= al;
    const bx2 = ny * az - nz * ay, by2 = nz * ax - nx * az, bz2 = nx * ay - ny * ax;
    const dirs = [[ax, ay, az], [-ax, -ay, -az], [bx2, by2, bz2], [-bx2, -by2, -bz2]];
    for (const [dx, dy, dz] of dirs) {
      const hh = aoD * 0.5;
      const vx = nx * 0.7 + dx * 0.7, vy = ny * 0.7 + dy * 0.7 + 0.2, vz = nz * 0.7 + dz * 0.7;
      const d = sdf(x + vx * hh, y + vy * hh, z + vz * hh);
      side += Math.max(0, Math.min(1, (hh * 0.75 - d) / (hh * 0.75)));
    }
    side /= 4;
    const ao = Math.max(0.04, 1 - Math.min(1, occ * 1.2 + side * 0.5));
    const dc = sdf(x + nx * cavD, y + ny * cavD, z + nz * cavD);
    const cav = Math.max(0, Math.min(1, 1 - dc / cavD));
    // openness straight up: march a ray up from just off the surface
    let open = 1, t = 0.15;
    const ox = x + nx * 0.06, oy = y + ny * 0.06, oz = z + nz * 0.06;
    for (let k = 0; k < 24 && t < upD; k++) {
      const d = sdf(ox, oy + t, oz);
      if (d < 0.01) { open = 0; break; }
      open = Math.min(open, (4 * d) / t);
      t += Math.max(d * 0.9, 0.08);
    }
    const carved = o.carved ? o.carved(x, y, z) : 0;
    out[i * 4] = Math.round(ao * 255);
    out[i * 4 + 1] = Math.round(cav * 255);
    out[i * 4 + 2] = Math.round(Math.max(0, Math.min(1, carved)) * 255);
    out[i * 4 + 3] = Math.round(Math.max(0, Math.min(1, open)) * 255);
  }
  m.rock = out;
  return m;
}

/** mesh result → BufferGeometry (positions relative to m.origin; place the mesh at m.origin) */
export function toGeometry(m) {
  const P = m.world, n = P.length / 3;
  const pos = new Float32Array(n * 3);
  for (let v = 0; v < n; v++) { pos[v * 3] = P[v * 3] - m.origin[0]; pos[v * 3 + 1] = P[v * 3 + 1] - m.origin[1]; pos[v * 3 + 2] = P[v * 3 + 2] - m.origin[2]; }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(m.normals, 3));
  const rock = m.rock || defaultRock(n);
  g.setAttribute('aRock', new THREE.BufferAttribute(rock, 4, true));
  g.setIndex(new THREE.BufferAttribute(n > 65535 ? m.index : new Uint16Array(m.index), 1));
  g.computeBoundingBox(); g.computeBoundingSphere();
  g.userData.origin = [...m.origin];
  return g;
}
export function defaultRock(n, ao = 1, cav = 0, carved = 0, open = 1) {
  const r = new Uint8Array(n * 4);
  for (let i = 0; i < n; i++) { r[i * 4] = ao * 255; r[i * 4 + 1] = cav * 255; r[i * 4 + 2] = carved * 255; r[i * 4 + 3] = open * 255; }
  return r;
}

/** merge geometries that share position/normal/aRock (indexed) */
export function mergeGeometries(list) {
  const geos = list.filter(Boolean);
  let nv = 0, ni = 0;
  for (const g of geos) { nv += g.attributes.position.count; ni += g.index.count; }
  const out = new THREE.BufferGeometry();
  for (const k of ['position', 'normal', 'aRock']) {
    const a0 = geos[0].attributes[k];
    const arr = new a0.array.constructor(nv * a0.itemSize);
    let o = 0;
    for (const g of geos) { arr.set(g.attributes[k].array, o); o += g.attributes[k].array.length; }
    out.setAttribute(k, new THREE.BufferAttribute(arr, a0.itemSize, a0.normalized));
  }
  const idx = nv > 65535 ? new Uint32Array(ni) : new Uint16Array(ni);
  let o = 0, base = 0;
  for (const g of geos) { const ia = g.index.array; for (let i = 0; i < ia.length; i++) idx[o++] = ia[i] + base; base += g.attributes.position.count; }
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  out.computeBoundingBox(); out.computeBoundingSphere();
  return out;
}
