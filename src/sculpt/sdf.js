// Small CPU SDF toolkit for sculpting stone (the 布袋弥勒, the small niche figures, karst rock). Plain numbers in,
// plain numbers out: works in node (baking) and in the browser (runtime fallback). Allocation-free where it matters.
// Derived from Athenaion (MIT, NOTICE): sculpt/sdf.js and ruins/sdf.js (primitives, smooth operators, value noise,
// the bounded Group). Rotations are 3x3 row-major arrays [m00,m01,m02, m10,…].
export const sqrt = Math.sqrt, abs = Math.abs, min = Math.min, max = Math.max;
export const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
export const lerp = (a, b, t) => a + (b - a) * t;
export const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
/** polynomial smooth min / max with blend radius k (k <= 0: hard) */
export function smin(a, b, k) { if (k <= 0) return a < b ? a : b; const h = max(k - abs(a - b), 0) / k; return min(a, b) - h * h * k * 0.25; }
export function smax(a, b, k) { if (k <= 0) return a > b ? a : b; const h = max(k - abs(a - b), 0) / k; return max(a, b) + h * h * k * 0.25; }
export const hash1 = (n) => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453123; return s - Math.floor(s); };

// ------------------------------------------------------------------ primitives
export function sph(x, y, z, r) { return sqrt(x * x + y * y + z * z) - r; }
export function box(x, y, z, bx, by, bz) {
  const qx = abs(x) - bx, qy = abs(y) - by, qz = abs(z) - bz;
  const ox = max(qx, 0), oy = max(qy, 0), oz = max(qz, 0);
  return sqrt(ox * ox + oy * oy + oz * oz) + min(max(qx, qy, qz), 0);
}
export function rbox(x, y, z, bx, by, bz, r) { return box(x, y, z, bx - r, by - r, bz - r) - r; }
/** ellipsoid (approximate distance, good near the surface) */
export function ell(x, y, z, rx, ry, rz) {
  const ax = x / rx, ay = y / ry, az = z / rz;
  const k0 = sqrt(ax * ax + ay * ay + az * az);
  const bx = ax / rx, by = ay / ry, bz = az / rz;
  const k1 = sqrt(bx * bx + by * by + bz * bz);
  return k1 < 1e-9 ? -min(rx, ry, rz) : (k0 * (k0 - 1)) / k1;
}
/** 2D ellipse (approximate) */
export function ell2(x, y, rx, ry) {
  const k0 = sqrt((x / rx) ** 2 + (y / ry) ** 2), k1 = sqrt((x / (rx * rx)) ** 2 + (y / (ry * ry)) ** 2);
  return k1 < 1e-9 ? -min(rx, ry) : (k0 * (k0 - 1)) / k1;
}
/** capsule a→b radius r */
export function cap(x, y, z, ax, ay, az, bx, by, bz, r) {
  const pax = x - ax, pay = y - ay, paz = z - az, bax = bx - ax, bay = by - ay, baz = bz - az;
  const h = clamp((pax * bax + pay * bay + paz * baz) / (bax * bax + bay * bay + baz * baz), 0, 1);
  const dx = pax - bax * h, dy = pay - bay * h, dz = paz - baz * h;
  return sqrt(dx * dx + dy * dy + dz * dz) - r;
}
/** tapered capsule a (ra) → b (rb), linear radius (cheap, good for limbs) */
export function tcap(x, y, z, ax, ay, az, bx, by, bz, ra, rb) {
  const pax = x - ax, pay = y - ay, paz = z - az, bax = bx - ax, bay = by - ay, baz = bz - az;
  const h = clamp((pax * bax + pay * bay + paz * baz) / (bax * bax + bay * bay + baz * baz), 0, 1);
  const dx = pax - bax * h, dy = pay - bay * h, dz = paz - baz * h;
  return sqrt(dx * dx + dy * dy + dz * dz) - (ra + (rb - ra) * h);
}
/** parameter of the closest point on segment a→b */
export function segT(x, y, z, ax, ay, az, bx, by, bz) {
  const bax = bx - ax, bay = by - ay, baz = bz - az;
  return clamp(((x - ax) * bax + (y - ay) * bay + (z - az) * baz) / (bax * bax + bay * bay + baz * baz), 0, 1);
}
/** torus around Y */
export function torus(x, y, z, R, r) { const q = sqrt(x * x + z * z) - R; return sqrt(q * q + y * y) - r; }
/** vertical (y) cylinder, half height h */
export function cyl(x, y, z, r, h) {
  const dx = sqrt(x * x + z * z) - r, dy = abs(y) - h;
  return min(max(dx, dy), 0) + sqrt(max(dx, 0) ** 2 + max(dy, 0) ** 2);
}
/** tube along a polyline of points [[x,y,z,r], …] (radius per point), smooth-unioned with blend k */
export function tube(x, y, z, pts, k = 0) {
  let d = 1e9;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    const di = tcap(x, y, z, a[0], a[1], a[2], b[0], b[1], b[2], a[3], b[3]);
    d = k > 0 ? smin(d, di, k) : min(d, di);
  }
  return d;
}

// ------------------------------------------------------------------ rotations (row-major 3x3)
export function rotX(a) { const c = Math.cos(a), s = Math.sin(a); return [1, 0, 0, 0, c, -s, 0, s, c]; }
export function rotY(a) { const c = Math.cos(a), s = Math.sin(a); return [c, 0, s, 0, 1, 0, -s, 0, c]; }
export function rotZ(a) { const c = Math.cos(a), s = Math.sin(a); return [c, -s, 0, s, c, 0, 0, 0, 1]; }
export function mmul(a, b) {
  const r = new Array(9);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) r[i * 3 + j] = a[i * 3] * b[j] + a[i * 3 + 1] * b[3 + j] + a[i * 3 + 2] * b[6 + j];
  return r;
}
export function mT(a) { return [a[0], a[3], a[6], a[1], a[4], a[7], a[2], a[5], a[8]]; }
/** ellipsoid in a rotated frame: m = world→local rotation, c = centre */
export function ellR(x, y, z, c, m, rx, ry, rz) {
  const dx = x - c[0], dy = y - c[1], dz = z - c[2];
  return ell(m[0] * dx + m[1] * dy + m[2] * dz, m[3] * dx + m[4] * dy + m[5] * dz, m[6] * dx + m[7] * dy + m[8] * dz, rx, ry, rz);
}

// ------------------------------------------------------------------ bounded smooth union of parts
/**
 * Smooth union of parts with bounding-sphere culling.
 * part = { f(x,y,z) → d, c:[x,y,z], r: bound radius, k?: blend radius, sub?: true (smooth subtraction) }
 */
export class Group {
  constructor(k = 0) { this.parts = []; this.k = k; this.c = [0, 0, 0]; this.r = 0; }
  add(p) { this.parts.push(p); this._bound(); return this; }
  _bound() {
    const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
    for (const p of this.parts) for (let i = 0; i < 3; i++) { mn[i] = min(mn[i], p.c[i] - p.r); mx[i] = max(mx[i], p.c[i] + p.r); }
    this.c = [(mn[0] + mx[0]) / 2, (mn[1] + mx[1]) / 2, (mn[2] + mx[2]) / 2];
    this.r = Math.hypot(mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]) / 2;
  }
  eval(x, y, z) {
    let d = 1e9;
    const P = this.parts;
    for (let i = 0; i < P.length; i++) {
      const p = P[i], k = p.k ?? this.k;
      const dx = x - p.c[0], dy = y - p.c[1], dz = z - p.c[2];
      const dd = dx * dx + dy * dy + dz * dz;
      if (p.sub) { const t = p.r + k; if (dd > t * t) continue; d = smax(d, -p.f(x, y, z), k); continue; }
      const t = d + k + p.r;
      if (d < 1e8 && dd > t * t) continue;
      d = smin(d, p.f(x, y, z), k);
    }
    return d;
  }
  bound(x, y, z) { return Math.hypot(x - this.c[0], y - this.c[1], z - this.c[2]) - this.r; }
}
// part constructors
export const E = (cx, cy, cz, rx, ry, rz, k, extra = {}) => ({ f: (x, y, z) => ell(x - cx, y - cy, z - cz, rx, ry, rz), c: [cx, cy, cz], r: max(rx, ry, rz), k, ...extra });
export const ER = (c, m, rx, ry, rz, k, extra = {}) => ({ f: (x, y, z) => ellR(x, y, z, c, m, rx, ry, rz), c, r: max(rx, ry, rz), k, ...extra });
export const C = (a, b, ra, rb, k, extra = {}) => ({
  f: (x, y, z) => tcap(x, y, z, a[0], a[1], a[2], b[0], b[1], b[2], ra, rb),
  c: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2], r: Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) / 2 + max(ra, rb), k, ...extra,
});
export const S = (cx, cy, cz, r, k, extra = {}) => ({ f: (x, y, z) => sph(x - cx, y - cy, z - cz, r), c: [cx, cy, cz], r, k, ...extra });

// ------------------------------------------------------------------ deterministic value noise (cheap)
function h3(i, j, k) {
  let n = (i * 73856093) ^ (j * 19349663) ^ (k * 83492791);
  n = Math.imul(n ^ (n >>> 13), 0x5bd1e995); n ^= n >>> 15;
  return (n >>> 0) / 4294967296;
}
export function vnoise3(x, y, z) {
  const i = Math.floor(x), j = Math.floor(y), k = Math.floor(z);
  const fx = x - i, fy = y - j, fz = z - k;
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy), uz = fz * fz * (3 - 2 * fz);
  const a = lerp(h3(i, j, k), h3(i + 1, j, k), ux), b = lerp(h3(i, j + 1, k), h3(i + 1, j + 1, k), ux);
  const c = lerp(h3(i, j, k + 1), h3(i + 1, j, k + 1), ux), d = lerp(h3(i, j + 1, k + 1), h3(i + 1, j + 1, k + 1), ux);
  return lerp(lerp(a, b, uy), lerp(c, d, uy), uz) * 2 - 1;
}
export function fbm3(x, y, z, oct = 3) {
  let s = 0, a = 0.5, n = 0;
  for (let o = 0; o < oct; o++) { s += a * vnoise3(x, y, z); n += a; x = x * 2.03 + 17.1; y = y * 2.03 + 3.7; z = z * 2.03 + 9.2; a *= 0.5; }
  return s / n;
}
/** 3D cellular noise (value-hash feature points): writes F1, F2, the nearest cell's hash and (out[3..5]) the offset
 *  from the nearest feature point to (x, y, z) into out (cell space) */
export function cell3(x, y, z, seed, out) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  let d1 = 9, d2 = 9, id = 0, ox = 0, oy = 0, oz = 0;
  for (let k = -1; k <= 1; k++) for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
    const cx = xi + i, cy = yi + j, cz = zi + k;
    const px = cx + h3(cx + seed, cy, cz) - x, py = cy + h3(cx, cy + seed, cz) - y, pz = cz + h3(cx, cy, cz + seed) - z;
    const d = px * px + py * py + pz * pz;
    if (d < d1) { d2 = d1; d1 = d; id = h3(cx * 3 + seed, cy * 7, cz * 11); ox = -px; oy = -py; oz = -pz; } else if (d < d2) d2 = d;
  }
  out[0] = sqrt(d1); out[1] = sqrt(d2); out[2] = id; out[3] = ox; out[4] = oy; out[5] = oz;
  return out;
}
