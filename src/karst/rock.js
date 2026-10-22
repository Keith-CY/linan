// Shared rock generator: boulders, blocks, slabs, pillars and rock masses (shore stones, revetments, banks, the tuff
// under the 宝石山 樓閣) and 太湖石 garden rocks. Geometry carries the aRock attribute of src/karst/material.js.
// Derived from Athenaion (MIT, NOTICE): materials/stone.js createRock (rounded fracture-plane hull on an icosphere,
// joint grooves, bedding, cavity from the umbrella Laplacian). Ours: aRock output, burial flattening, the 太湖石 SDF.
//
//   const g = rockGeometry(seed, { shape: 'boulder' | 'block' | 'slab' | 'pillar' | 'mass' | 'pebble', size: [x, y, z],
//                                  detail: 2..6, roughness, cracks, strata, flatBottom })   // centred, base ≈ -size.y/2
//   const t = taihuGeometry(seed, { height, cell })                                          // base at y = 0
import * as THREE from 'three';
import { meshSDF, bakeRock, toGeometry } from '../sculpt/mesher.js';
import { Simplex } from '../core/noise.js';
import { sqrt, abs, min, max, smin, smax, ell, sstep, cap } from '../sculpt/sdf.js';

// ------------------------------------------------------------------ small value noise / cellular (CPU)
function hash3(x, y, z, s) {
  let h = (x * 374761393 + y * 668265263 + z * 2147483647 + s * 1274126177) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
function vnoise3(x, y, z, s) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const xf = x - xi, yf = y - yi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf), w = zf * zf * (3 - 2 * zf);
  const l = (a, b, t) => a + (b - a) * t;
  return l(l(l(hash3(xi, yi, zi, s), hash3(xi + 1, yi, zi, s), u), l(hash3(xi, yi + 1, zi, s), hash3(xi + 1, yi + 1, zi, s), u), v),
    l(l(hash3(xi, yi, zi + 1, s), hash3(xi + 1, yi, zi + 1, s), u), l(hash3(xi, yi + 1, zi + 1, s), hash3(xi + 1, yi + 1, zi + 1, s), u), v), w) * 2 - 1;
}
function fbm3(x, y, z, s, oct) { let a = 0.5, f = 1, t = 0, n = 0; for (let i = 0; i < oct; i++) { t += a * vnoise3(x * f, y * f, z * f, s + i * 17); n += a; a *= 0.5; f *= 2.03; } return t / n; }
function cell3(x, y, z, s) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  let d1 = 9, d2 = 9;
  for (let k = -1; k <= 1; k++) for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
    const cx = xi + i, cy = yi + j, cz = zi + k;
    const px = cx + hash3(cx, cy, cz, s) - x, py = cy + hash3(cx, cy, cz, s + 1) - y, pz = cz + hash3(cx, cy, cz, s + 2) - z;
    const d = px * px + py * py + pz * pz;
    if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) d2 = d;
  }
  return [sqrt(d1), sqrt(d2)];
}
const _ico = new Map();
function icosphere(level) {
  if (_ico.has(level)) return _ico.get(level);
  const t = (1 + Math.sqrt(5)) / 2;
  let verts = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]]
    .map((v) => { const l = Math.hypot(...v); return [v[0] / l, v[1] / l, v[2] / l]; });
  let faces = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
    [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];
  for (let l = 0; l < level; l++) {
    const cache = new Map();
    const mid = (a, b) => {
      const key = a < b ? a * 1e6 + b : b * 1e6 + a;
      let m = cache.get(key);
      if (m === undefined) { const va = verts[a], vb = verts[b]; const x = va[0] + vb[0], y = va[1] + vb[1], z = va[2] + vb[2], len = Math.hypot(x, y, z); m = verts.length; verts.push([x / len, y / len, z / len]); cache.set(key, m); }
      return m;
    };
    const nf = [];
    for (const [a, b, c] of faces) { const ab = mid(a, b), bc = mid(b, c), ca = mid(c, a); nf.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]); }
    faces = nf;
  }
  const res = { verts, faces };
  _ico.set(level, res);
  return res;
}
function mulberry(a) { return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

/**
 * A rock: rounded convex hull of fracture planes, displaced by joint grooves, bedding and roughness (see header).
 * @returns THREE.BufferGeometry (position, normal, aRock), centred on the origin
 */
export function rockGeometry(seed, opts = {}) {
  const R = mulberry((typeof seed === 'number' ? seed : [...String(seed)].reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 16777619), 2166136261)) >>> 0);
  const shape = opts.shape || 'boulder';
  const size = Array.isArray(opts.size) ? opts.size : [opts.size ?? 1, (opts.size ?? 1) * (shape === 'slab' ? 0.35 : shape === 'pillar' ? 2.2 : 0.75), opts.size ?? 1];
  const detail = Math.max(1, Math.min(6, Math.round(opts.detail ?? 4)));
  const rough = opts.roughness ?? 1, cracks = opts.cracks ?? 1, strata = opts.strata ?? 0.5, flatBottom = opts.flatBottom ?? 0.15;
  const s0 = Math.floor(R() * 1e6);
  const planes = [];
  const addPlane = (nx, ny, nz, d) => { const l = Math.hypot(nx, ny, nz); planes.push([nx / l, ny / l, nz / l, d]); };
  if (shape === 'block' || shape === 'slab' || shape === 'pillar' || shape === 'mass') {
    const j = shape === 'mass' ? 0.25 : 0.12;
    for (const ax of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) addPlane(ax[0] + (R() - 0.5) * j, ax[1] + (R() - 0.5) * j, ax[2] + (R() - 0.5) * j, 0.82 + R() * 0.12);
    const chips = shape === 'mass' ? 8 : 5;
    for (let i = 0; i < chips; i++) { const u = R() * 2 - 1, a = R() * Math.PI * 2, r = Math.sqrt(1 - u * u); addPlane(r * Math.cos(a), u, r * Math.sin(a), 0.86 + R() * 0.25); }
  } else {
    const n = shape === 'pebble' ? 6 : 9 + Math.floor(R() * 6);
    for (let i = 0; i < n; i++) { const u = R() * 2 - 1, a = R() * Math.PI * 2, r = Math.sqrt(1 - u * u); addPlane(r * Math.cos(a), u * 0.9, r * Math.sin(a), 0.62 + R() * 0.36); }
    addPlane(0, -1, 0, 0.7 + R() * 0.2);
  }
  if (shape !== 'pebble') {
    const nChip = shape === 'boulder' ? 7 : 5;
    for (let i = 0; i < nChip; i++) { const u = R() * 2 - 1, a = R() * Math.PI * 2, r = Math.sqrt(1 - u * u); addPlane(r * Math.cos(a), u * 0.8, r * Math.sin(a), (shape === 'boulder' ? 0.72 : 0.84) + R() * 0.22); }
  }
  const kSoft = shape === 'pebble' ? 0.16 : shape === 'boulder' ? (opts.soft ?? 0.04) : 0.03;
  const v = new Float64Array(planes.length);
  const hull = (x, y, z) => {
    let m = -1e9;
    for (let i = 0; i < planes.length; i++) { const p = planes[i]; v[i] = x * p[0] + y * p[1] + z * p[2] - p[3]; if (v[i] > m) m = v[i]; }
    let s = 0;
    for (let i = 0; i < v.length; i++) s += Math.exp((v[i] - m) / kSoft);
    return Math.max(m + kSoft * Math.log(s), Math.hypot(x, y, z) - 1.12);
  };
  const ox = R() * 100, oy = R() * 100, oz = R() * 100;
  const cellScale = 1.4 + R() * 0.8;
  const det = (x, y, z) => {
    let d = 0;
    if (cracks > 0) {
      const [f1, f2] = cell3(x * cellScale + ox, y * cellScale * 0.8 + oy, z * cellScale + oz, s0);
      const open = Math.min(1, Math.max(0, (vnoise3(x * 1.4 + oz, y * 1.4 + ox, z * 1.4 + oy, s0 + 5) + 0.2) / 0.3));
      d += cracks * open * 0.06 * Math.max(0, 1 - (f2 - f1) / 0.18);
    }
    if (strata > 0) {
      const yb = y * 3.2 + 0.8 * vnoise3(x * 2 + ox, 0.5, z * 2 + oz, s0 + 3);
      const f = yb - Math.floor(yb), g = Math.abs(yb - Math.round(yb));
      d += strata * (shape === 'boulder' ? 0.45 : 1) * (0.018 * Math.max(0, 1 - g / 0.2) + 0.02 * Math.max(0, (f - 0.72) / 0.28));
    }
    d += rough * (0.035 * fbm3(x * 2.6 + ox, y * 2.6 + oy, z * 2.6 + oz, s0 + 7, 4) + 0.016 * fbm3(x * 9 + oy, y * 9 + oz, z * 9 + ox, s0 + 9, 3));
    return d;
  };
  const { verts, faces } = icosphere(detail);
  const nV = verts.length;
  const pos = new Float32Array(nV * 3);
  for (let i = 0; i < nV; i++) {
    const [dx, dy, dz] = verts[i];
    let lo = 0.05, hi = 1.6;
    for (let it = 0; it < 18; it++) { const m = (lo + hi) * 0.5; if (hull(dx * m, dy * m, dz * m) < 0) lo = m; else hi = m; }
    const rh = (lo + hi) * 0.5;
    const r = Math.max(0.05, rh - det(dx * rh, dy * rh, dz * rh));
    pos[i * 3] = dx * r * size[0] * 0.5; pos[i * 3 + 1] = dy * r * size[1] * 0.5; pos[i * 3 + 2] = dz * r * size[2] * 0.5;
  }
  if (flatBottom > 0) {
    let minY = Infinity;
    for (let i = 0; i < nV; i++) minY = Math.min(minY, pos[i * 3 + 1]);
    const cut = minY + size[1] * flatBottom;
    for (let i = 0; i < nV; i++) if (pos[i * 3 + 1] < cut) pos[i * 3 + 1] = cut - (cut - pos[i * 3 + 1]) * 0.08;
  }
  const index = new (nV > 65535 ? Uint32Array : Uint16Array)(faces.length * 3);
  for (let f = 0; f < faces.length; f++) { index[f * 3] = faces[f][0]; index[f * 3 + 1] = faces[f][1]; index[f * 3 + 2] = faces[f][2]; }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setIndex(new THREE.BufferAttribute(index, 1));
  geo.computeVertexNormals();
  // cavity (umbrella Laplacian, smoothed) → aRock: AO, cavity, carved 0, openness from the normal
  const nrm = geo.attributes.normal.array;
  const nb = new Float32Array(nV * 3), cnt = new Float32Array(nV), cav = new Float32Array(nV);
  for (let f = 0; f < faces.length; f++) {
    const [a, b, c] = faces[f];
    for (const [u, w] of [[a, b], [b, c], [c, a]]) {
      nb[u * 3] += pos[w * 3]; nb[u * 3 + 1] += pos[w * 3 + 1]; nb[u * 3 + 2] += pos[w * 3 + 2]; cnt[u]++;
      nb[w * 3] += pos[u * 3]; nb[w * 3 + 1] += pos[u * 3 + 1]; nb[w * 3 + 2] += pos[u * 3 + 2]; cnt[w]++;
    }
  }
  const sAvg = (size[0] + size[1] + size[2]) / 3;
  for (let i = 0; i < nV; i++) {
    const ax = nb[i * 3] / cnt[i] - pos[i * 3], ay = nb[i * 3 + 1] / cnt[i] - pos[i * 3 + 1], az = nb[i * 3 + 2] / cnt[i] - pos[i * 3 + 2];
    cav[i] = Math.max(0, Math.min(1, (ax * nrm[i * 3] + ay * nrm[i * 3 + 1] + az * nrm[i * 3 + 2]) / (0.006 * sAvg * (32 / (1 << detail)))));
  }
  for (let pass = 0; pass < 2; pass++) {
    const acc = new Float32Array(nV), cn = new Float32Array(nV);
    for (let f = 0; f < faces.length; f++) { const [a, b, c] = faces[f]; acc[a] += cav[b] + cav[c]; cn[a] += 2; acc[b] += cav[a] + cav[c]; cn[b] += 2; acc[c] += cav[a] + cav[b]; cn[c] += 2; }
    for (let i = 0; i < nV; i++) cav[i] = Math.min(1, (0.4 * cav[i] + 0.6 * acc[i] / Math.max(1, cn[i])) * 1.25);
  }
  const rock = new Uint8Array(nV * 4);
  let minY = Infinity, maxY = -Infinity;
  for (let i = 0; i < nV; i++) { minY = Math.min(minY, pos[i * 3 + 1]); maxY = Math.max(maxY, pos[i * 3 + 1]); }
  for (let i = 0; i < nV; i++) {
    const h = (pos[i * 3 + 1] - minY) / Math.max(1e-3, maxY - minY);
    const ao = Math.max(0.15, 1 - 0.55 * cav[i]) * (0.72 + 0.28 * h);    // the base is in contact with the ground
    rock[i * 4] = ao * 255; rock[i * 4 + 1] = cav[i] * 255; rock[i * 4 + 2] = 0; rock[i * 4 + 3] = Math.max(0, Math.min(1, 0.4 + 0.6 * nrm[i * 3 + 1])) * 255;
  }
  geo.setAttribute('aRock', new THREE.BufferAttribute(rock, 4, true));
  geo.computeBoundingBox(); geo.computeBoundingSphere();
  return geo;
}

// ------------------------------------------------------------------ 太湖石 (Taihu garden rock)
/** SDF of a 太湖石: tall and lean (瘦), water-worn and flowing (皱), pierced by holes (透) and hollowed by pockets (漏) */
export function taihuSDF(seed, height = 2.6) {
  const H = height;
  const N = new Simplex(9100 + seed), M = new Simplex(9200 + seed);
  const R = mulberry(9300 + seed);
  // spine: a sinuous vertical chain of lobes, swelling toward the top (the classic top-heavy silhouette)
  const lobes = [];
  const nL = 7;
  let px = 0, pz = 0;
  for (let i = 0; i < nL; i++) {
    const t = i / (nL - 1);
    px += (R() - 0.5) * 0.16 * H; pz += (R() - 0.5) * 0.1 * H;
    const w = H * (0.13 + 0.07 * Math.sin(t * Math.PI * 0.9 + 0.3) + 0.06 * t + 0.03 * R());
    lobes.push([px, H * (0.06 + 0.86 * t), pz, w * (1.0 + 0.3 * R()), H * (0.1 + 0.03 * R()), w * (0.6 + 0.2 * R())]);
  }
  const holes = [], pockets = [];
  for (let i = 0; i < 11; i++) {
    const L = lobes[1 + Math.floor(R() * (nL - 2))];
    const a = (R() - 0.5) * 1.2, r = H * (0.035 + 0.06 * R());
    const dx = Math.sin(a), dz = Math.cos(a), dy = (R() - 0.5) * 0.5;
    const oy = L[1] + (R() - 0.5) * L[4] * 1.2, ox = L[0] + (R() - 0.5) * L[3] * 1.1;
    holes.push([ox - dx * L[5] * 2, oy - dy * L[5], L[2] - dz * L[5] * 2, ox + dx * L[5] * 2, oy + dy * L[5], L[2] + dz * L[5] * 2, r]);
  }
  for (let i = 0; i < 12; i++) {
    const L = lobes[Math.floor(R() * nL)];
    const a = R() * Math.PI * 2, r = H * (0.04 + 0.05 * R());
    pockets.push([L[0] + Math.cos(a) * L[3] * 0.95, L[1] + (R() - 0.5) * L[4], L[2] + Math.sin(a) * L[5] * 0.95, r]);
  }
  return (x, y, z) => {
    let d = 1e9;
    for (const L of lobes) d = smin(d, ell(x - L[0], y - L[1], z - L[2], L[3], L[4], L[5]), H * 0.07);
    d = max(d, -y);
    // flowing, water-worn surface: low-frequency undulation with soft grooves
    const g = N.noise3(x * 2.2 / H, y * 1.4 / H, z * 2.2 / H);
    d += H * (0.035 * g + 0.012 * (1 - abs(M.noise3(x * 4.5 / H, y * 3 / H, z * 4.5 / H))) + 0.003 * M.noise3(x * 14 / H, y * 14 / H, z * 14 / H));
    for (const P of pockets) d = smax(d, -(Math.hypot(x - P[0], y - P[1], z - P[2]) - P[3]), H * 0.015);
    for (const Q of holes) d = smax(d, -(cap(x, y, z, Q[0], Q[1], Q[2], Q[3], Q[4], Q[5], Q[6]) + Q[6] * 0.3 * M.noise3(x * 3 / Q[6] * 0.1, y * 3 / Q[6] * 0.1, z * 3 / Q[6] * 0.1)), H * 0.012);
    return d;
  };
}
/** meshed 太湖石 (base at y = 0) */
export function taihuGeometry(seed, { height = 2.6, cell = 0.03 } = {}) {
  const f = taihuSDF(seed, height);
  const m = meshSDF(f, { min: [-height * 0.7, -0.05, -height * 0.6], max: [height * 0.7, height * 1.1, height * 0.6], cell, origin: [0, 0, 0], smooth: 1, project: 1, bandScale: 1.8 });
  bakeRock(m, f, { aoSteps: [0.02, 0.05, 0.12, 0.25, 0.5], cavDist: 0.04, upDist: 2 });
  return toGeometry(m);
}
