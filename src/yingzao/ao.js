// Baked ambient occlusion for the generated buildings. Writes MeshBuilder.ao = per vertex
// (ao, up): ao = hemisphere openness (near crevices × far shelter), up = how much of the sky straight above is
// open (snow, rain-washed tops, dust). No GPU work: the occluders are voxelised into two bit grids (fine for the
// bracket crevices, coarse for the eaves and storeys above) and short rays are marched through them.
//
//   bakeAO({ targets: [{ B, M }], occluders: [{ B, M }], cell, coarse })
//   B: MeshBuilder (metres), M: optional THREE.Matrix4 placing it in the common frame.
// Deterministic (fixed ray set), ~0.3–1.5 s for a large hall in the browser.
import * as THREE from 'three';

class BitGrid {
  constructor(min, max, cell, maxCells) {
    let c = cell;
    const size = [max[0] - min[0], max[1] - min[1], max[2] - min[2]];
    const cells = (k) => size.reduce((a, s) => a * (Math.ceil(s / k) + 3), 1);
    while (cells(c) > maxCells) c *= 1.15;
    this.cell = c; this.inv = 1 / c;
    this.o = [min[0] - c, min[1] - c, min[2] - c];
    this.n = size.map((s) => Math.ceil(s / c) + 3);
    this.sxy = this.n[0] * this.n[1];
    this.bits = new Uint32Array(Math.ceil((this.sxy * this.n[2]) / 32));
  }
  index(x, y, z) {
    const i = Math.floor((x - this.o[0]) * this.inv), j = Math.floor((y - this.o[1]) * this.inv), k = Math.floor((z - this.o[2]) * this.inv);
    if (i < 0 || j < 0 || k < 0 || i >= this.n[0] || j >= this.n[1] || k >= this.n[2]) return -1;
    return i + j * this.n[0] + k * this.sxy;
  }
  set(x, y, z) { const q = this.index(x, y, z); if (q >= 0) this.bits[q >>> 5] |= 1 << (q & 31); }
  get(x, y, z) { const q = this.index(x, y, z); return q >= 0 && (this.bits[q >>> 5] & (1 << (q & 31))) !== 0; }
}

function forEachVertex(B, M, fn) {
  const v = new THREE.Vector3(), n = new THREE.Vector3();
  const nm = M ? new THREE.Matrix3().getNormalMatrix(M) : null;
  for (let i = 0; i < B.count; i++) {
    v.set(B.pos[i * 3], B.pos[i * 3 + 1], B.pos[i * 3 + 2]);
    n.set(B.nor[i * 3], B.nor[i * 3 + 1], B.nor[i * 3 + 2]);
    if (M) { v.applyMatrix4(M); n.applyMatrix3(nm).normalize(); }
    fn(i, v, n);
  }
}

function rasterise(grids, B, M) {
  const P = new Float32Array(B.count * 3);
  forEachVertex(B, M, (i, v) => { P[i * 3] = v.x; P[i * 3 + 1] = v.y; P[i * 3 + 2] = v.z; });
  for (const g of grids) {
    const step = g.cell * 0.7;
    for (let t = 0; t < B.count; t += 3) {
      const a = t * 3, b = a + 3, c = a + 6;
      const ax = P[a], ay = P[a + 1], az = P[a + 2];
      const ux = P[b] - ax, uy = P[b + 1] - ay, uz = P[b + 2] - az;
      const vx = P[c] - ax, vy = P[c + 1] - ay, vz = P[c + 2] - az;
      const L = Math.max(Math.hypot(ux, uy, uz), Math.hypot(vx, vy, vz), Math.hypot(ux - vx, uy - vy, uz - vz));
      const n = Math.max(1, Math.ceil(L / step));
      for (let i = 0; i <= n; i++) for (let j = 0; j <= n - i; j++) {
        const s = i / n, r = j / n;
        g.set(ax + ux * s + vx * r, ay + uy * s + vy * r, az + uz * s + vz * r);
      }
    }
  }
}

// fixed hemisphere ray set around +Z (cosine weighted, Fibonacci spiral), rotated onto each normal
function hemisphere(n) {
  const out = [];
  const ga = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    const r = Math.sqrt((i + 0.5) / n), a = i * ga;
    out.push([Math.cos(a) * r, Math.sin(a) * r, Math.sqrt(Math.max(0, 1 - r * r))]);
  }
  return out;
}
const HEMI = hemisphere(14), HEMI_FAR = hemisphere(10);
const UPRAYS = [[0, 1, 0], [0.26, 0.96, 0], [-0.26, 0.96, 0], [0, 0.96, 0.26], [0, 0.96, -0.26]];

/** octahedral normal bin (6 × 6) for memoising per (cell, normal) */
function nbin(n) {
  const s = Math.abs(n.x) + Math.abs(n.y) + Math.abs(n.z);
  let u = n.x / s, v = n.z / s;
  if (n.y < 0) { const pu = u; u = (1 - Math.abs(v)) * Math.sign(pu || 1); v = (1 - Math.abs(pu)) * Math.sign(v || 1); }
  return Math.min(5, Math.floor((u * 0.5 + 0.5) * 6)) * 6 + Math.min(5, Math.floor((v * 0.5 + 0.5) * 6));
}

/**
 * @param {object} o
 * @param {{B, M?}[]} o.targets     builders that receive ao
 * @param {{B, M?}[]} o.occluders   everything that casts occlusion (include the targets)
 * @param {number} [o.cell]   fine grid cell (m)      @param {number} [o.near] fine ray length (m)
 * @param {number} [o.coarse] coarse grid cell (m)    @param {number} [o.far]  coarse ray length (m)
 */
export function bakeAO({ targets, occluders, cell = 0.06, coarse = 0.22, near = 1.1, far = 9, upFar = 18 }) {
  const t0 = performance.now();
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (const { B, M } of occluders) forEachVertex(B, M, (i, v) => {
    if (v.x < min[0]) min[0] = v.x; if (v.y < min[1]) min[1] = v.y; if (v.z < min[2]) min[2] = v.z;
    if (v.x > max[0]) max[0] = v.x; if (v.y > max[1]) max[1] = v.y; if (v.z > max[2]) max[2] = v.z;
  });
  if (!isFinite(min[0])) return { ms: 0 };
  const fine = new BitGrid(min, max, cell, 1.6e8), crs = new BitGrid(min, max, coarse, 2e7);
  for (const { B, M } of occluders) rasterise([fine, crs], B, M);
  const t1 = performance.now();

  const memo = new Map();
  const tA = new THREE.Vector3(), tB = new THREE.Vector3();
  let queries = 0;
  const sample = (p, n) => {
    const key = fine.index(p.x + n.x * fine.cell * 1.3, p.y + n.y * fine.cell * 1.3, p.z + n.z * fine.cell * 1.3);
    const k = key * 36 + nbin(n);
    const hit = memo.get(k);
    if (hit) return hit;
    queries++;
    // tangent frame
    if (Math.abs(n.y) < 0.9) tA.set(0, 1, 0).cross(n).normalize(); else tA.set(1, 0, 0).cross(n).normalize();
    tB.copy(n).cross(tA);
    const dir = (h) => [tA.x * h[0] + tB.x * h[1] + n.x * h[2], tA.y * h[0] + tB.y * h[1] + n.y * h[2], tA.z * h[0] + tB.z * h[1] + n.z * h[2]];
    // near: fine grid
    const s0 = fine.cell * 1.3, ox = p.x + n.x * s0, oy = p.y + n.y * s0, oz = p.z + n.z * s0;
    let occ = 0;
    for (const h of HEMI) {
      const d = dir(h);
      for (let t = fine.cell * 0.5; t < near; t += fine.cell * 0.8) {
        if (fine.get(ox + d[0] * t, oy + d[1] * t, oz + d[2] * t)) { occ += 1 - 0.6 * (t / near); break; }
      }
    }
    const aoNear = 1 - occ / HEMI.length;
    // far: coarse grid (eaves, storeys, neighbours)
    const s1 = crs.cell * 1.6, px = p.x + n.x * s1, py = p.y + n.y * s1, pz = p.z + n.z * s1;
    let occF = 0;
    for (const h of HEMI_FAR) {
      const d = dir(h);
      for (let t = crs.cell; t < far; t += Math.max(crs.cell * 0.85, t * 0.12)) {
        if (crs.get(px + d[0] * t, py + d[1] * t, pz + d[2] * t)) { occF += 1 - 0.5 * (t / far); break; }
      }
    }
    const aoFar = 1 - occF / HEMI_FAR.length;
    let up = 0;
    for (const d of UPRAYS) {
      let open = 1;
      for (let t = crs.cell; t < upFar; t += Math.max(crs.cell * 0.9, t * 0.12)) if (crs.get(px + d[0] * t, py + d[1] * t, pz + d[2] * t)) { open = 0; break; }
      up += open;
    }
    const res = [aoNear * (0.4 + 0.6 * aoFar), up / UPRAYS.length];
    memo.set(k, res);
    return res;
  };
  for (const { B, M } of targets) {
    forEachVertex(B, M, (i, v, n) => {
      const r = sample(v, n);
      B.ao[i * 2] = r[0]; B.ao[i * 2 + 1] = r[1];
    });
  }
  return { ms: Math.round(performance.now() - t0), rasterMs: Math.round(t1 - t0), queries, cells: [fine.cell, crs.cell] };
}
