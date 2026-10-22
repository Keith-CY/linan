// Geometry helpers shared by every plant generator (derived from Athenaion's src/vegetation/util.js, MIT).
// Every generated geometry carries the same attribute layout, so one material family can draw any part:
//   position (vec3), normal (vec3), uv (vec2: atlas coords), aFol (vec4), aAux (vec2), aRib (vec4, ribbons only)
//   aFol.x = ambient occlusion / interior darkness (0 deep inside .. 1 outer surface)
//   aFol.y = "tip" factor (young sunlit growth at the outside of clumps, 0..1)
//   aFol.z = per-clump random (colour variation)
//   aFol.w = wind sway weight (0 at the root .. 1 at the branch tips)
//   aAux   = bark coordinates in metres (x around the branch, y along) for bark shading
//   aRib   = view-facing ribbon (willow strands, reeds): xyz = strand tangent, w = signed half width (m)
//            (the vertex shader turns the ribbon's width toward the camera, so a strand is never seen edge-on)
import * as THREE from 'three';

export class GeoBuilder {
  constructor({ ribbon = false } = {}) {
    this.p = []; this.n = []; this.uv = []; this.f = []; this.a = []; this.r = ribbon ? [] : null; this.idx = [];
    this.count = 0;
  }
  v(px, py, pz, nx, ny, nz, u, vv, f0, f1, f2, f3, a0 = 0, a1 = 0) {
    this.p.push(px, py, pz); this.n.push(nx, ny, nz); this.uv.push(u, vv);
    this.f.push(f0, f1, f2, f3); this.a.push(a0, a1);
    if (this.r) this.r.push(0, 1, 0, 0);
    return this.count++;
  }
  /** set the ribbon attribute of the last vertex */
  rib(tx, ty, tz, w) { const i = (this.count - 1) * 4; this.r[i] = tx; this.r[i + 1] = ty; this.r[i + 2] = tz; this.r[i + 3] = w; }
  tri(a, b, c) { this.idx.push(a, b, c); }
  quad(a, b, c, d) { this.idx.push(a, b, c, a, c, d); }
  get triangles() { return this.idx.length / 3; }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('aFol', new THREE.Float32BufferAttribute(this.f, 4));
    g.setAttribute('aAux', new THREE.Float32BufferAttribute(this.a, 2));
    if (this.r) g.setAttribute('aRib', new THREE.Float32BufferAttribute(this.r, 4));
    const I = this.count > 65535 ? Uint32Array : Uint16Array;
    g.setIndex(new THREE.BufferAttribute(new I(this.idx), 1));
    g.computeBoundingBox(); g.computeBoundingSphere();
    // ribbons: the bounds must include the expanded width
    if (this.r) { g.boundingSphere.radius += 0.3; g.boundingBox.expandByScalar(0.3); }
    return g;
  }
}

// ---------------------------------------------------------------- tiny vec3 helpers (arrays)
export const v3 = {
  add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
  sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
  mul: (a, s) => [a[0] * s, a[1] * s, a[2] * s],
  mad: (a, b, s) => [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s],
  dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
  len: (a) => Math.hypot(a[0], a[1], a[2]),
  norm: (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; },
  lerp: (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t],
};

/** any unit vector perpendicular to n */
export function perp(n) {
  const a = Math.abs(n[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  return v3.norm(v3.cross(n, a));
}

/** rotate vector v around unit axis k by angle a (Rodrigues) */
export function rotAxis(v, k, a) {
  const c = Math.cos(a), s = Math.sin(a), d = v3.dot(k, v) * (1 - c);
  const cr = v3.cross(k, v);
  return [v[0] * c + cr[0] * s + k[0] * d, v[1] * c + cr[1] * s + k[1] * d, v[2] * c + cr[2] * s + k[2] * d];
}

export const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

/**
 * Lumpy closed blob (deformed UV sphere): a foliage clump.
 * c centre, axes: ax (main/up axis, unit), b1, b2 (unit, orthogonal), radii [ra, r1, r2]
 * opts: lon, lat, rect (atlas uv rect for the dense foliage patch), fol(p, nLocal, phi01) → [f0..f3],
 *       normalFn(p, nLocal) → n, lump (noise amount), noise (Simplex), seed
 */
export function addBlob(gb, c, ax, b1, b2, ra, r1, r2, opts) {
  const lon = opts.lon || 6, lat = opts.lat || 5;
  const rect = opts.rect, lump = opts.lump || 0, nz = opts.noise;
  const seed = opts.seed || 0;
  const rows = [];
  for (let j = 0; j <= lat; j++) {
    const phi = (j / lat) * Math.PI; // 0 bottom .. PI top
    const row = [];
    if (j === 0 || j === lat) {
      const s = j === 0 ? -1 : 1;
      const p = v3.mad(c, ax, s * ra);
      row.push(emit(p, v3.mul(ax, s), phi, 0));
      rows.push(row); continue;
    }
    const sphi = Math.sin(phi), cphi = -Math.cos(phi);
    for (let i = 0; i < lon; i++) {
      const lam = (i / lon) * Math.PI * 2 + (j % 2) * (Math.PI / lon) * 0.5;
      const cl = Math.cos(lam), sl = Math.sin(lam);
      let k = 1;
      if (lump && nz) k += lump * (0.6 * nz.noise3(c[0] * 0.7 + cl * 1.3 + seed, c[1] * 0.7 + cphi * 1.3, c[2] * 0.7 + sl * 1.3) + 0.4 * nz.noise3(c[0] + cl * 3.1 + seed, c[1] + cphi * 3.1, c[2] + sl * 3.1));
      const rx = r1 * sphi * k, ry = r2 * sphi * k;
      const p = [
        c[0] + ax[0] * cphi * ra + b1[0] * cl * rx + b2[0] * sl * ry,
        c[1] + ax[1] * cphi * ra + b1[1] * cl * rx + b2[1] * sl * ry,
        c[2] + ax[2] * cphi * ra + b1[2] * cl * rx + b2[2] * sl * ry,
      ];
      const g = v3.norm([
        ax[0] * cphi / ra + b1[0] * cl * sphi / r1 + b2[0] * sl * sphi / r2,
        ax[1] * cphi / ra + b1[1] * cl * sphi / r1 + b2[1] * sl * sphi / r2,
        ax[2] * cphi / ra + b1[2] * cl * sphi / r1 + b2[2] * sl * sphi / r2,
      ]);
      row.push(emit(p, g, phi, lam));
    }
    rows.push(row);
  }
  function emit(p, nl, phi, lam) {
    const n = opts.normalFn ? opts.normalFn(p, nl) : nl;
    const f = opts.fol ? opts.fol(p, nl, phi / Math.PI) : [1, 0, 0, 0];
    const uu = rect ? lerp(rect[0], rect[2], 0.5 + 0.45 * Math.cos(lam) * Math.sin(phi)) : 0;
    const vv = rect ? lerp(rect[1], rect[3], 0.5 - 0.45 * Math.cos(phi)) : 0;
    return gb.v(p[0], p[1], p[2], n[0], n[1], n[2], uu, vv, f[0], f[1], f[2], f[3]);
  }
  for (let i = 0; i < lon; i++) gb.tri(rows[0][0], rows[1][(i + 1) % lon], rows[1][i]);
  for (let j = 1; j < lat - 1; j++) {
    for (let i = 0; i < lon; i++) {
      const a = rows[j][i], b = rows[j][(i + 1) % lon], c2 = rows[j + 1][(i + 1) % lon], d = rows[j + 1][i];
      gb.tri(a, b, c2); gb.tri(a, c2, d);
    }
  }
  const top = rows[lat][0];
  for (let i = 0; i < lon; i++) gb.tri(rows[lat - 1][i], rows[lat - 1][(i + 1) % lon], top);
}

/**
 * Alpha-tested card (quad, optionally bent) with its base at `o`, growing along `up`, width along `side`.
 * Normals from normalFn(p, faceNormal) (bent "crown" normals), aFol from folFn(p, t).
 * rect = [u0, v0, u1, v1] atlas rect (v0 = top of the cell). bend curls the upper part along the face normal.
 */
export function addCard(gb, o, up, side, w, h, rect, normalFn, folFn, bend = 0, flip = false) {
  const rows = bend ? 3 : 2;
  const nrm = v3.norm(v3.cross(side, up));
  const ids = [];
  for (let j = 0; j < rows; j++) {
    const t = j / (rows - 1);
    const bo = bend * t * t * h;
    for (let i = 0; i < 2; i++) {
      const s = i === 0 ? -0.5 : 0.5;
      const p = [
        o[0] + up[0] * h * t + side[0] * w * s + nrm[0] * bo,
        o[1] + up[1] * h * t + side[1] * w * s + nrm[1] * bo,
        o[2] + up[2] * h * t + side[2] * w * s + nrm[2] * bo,
      ];
      const n = normalFn(p, nrm);
      const f = folFn(p, t);
      const u = flip ? (i === 0 ? rect[2] : rect[0]) : (i === 0 ? rect[0] : rect[2]);
      const v = lerp(rect[3], rect[1], t); // base of the sprite = bottom of the cell
      ids.push(gb.v(p[0], p[1], p[2], n[0], n[1], n[2], u, v, f[0], f[1], f[2], f[3]));
    }
  }
  for (let j = 0; j < rows - 1; j++) gb.quad(ids[j * 2], ids[j * 2 + 1], ids[j * 2 + 3], ids[j * 2 + 2]);
}

/**
 * Card centred at c (not at its base): a leafy spray seen face-on, quad in the plane (side, up).
 */
export function addCardC(gb, c, up, side, w, h, rect, normalFn, folFn, bend = 0, flip = false) {
  addCard(gb, v3.mad(c, up, -h * 0.5), up, side, w, h, rect, normalFn, folFn, bend, flip);
}

/**
 * Tube along a polyline with per-point radius. pts: [[x,y,z]...], rad: [r...].
 * opts: radial segments, rect (uv), fol(t, p) → [f0..f3], noise (Simplex) + gnarl amount for fluted / twisted
 * bark, twist, cap (close the end), barkOffset (metres along, continuous bark coords), flare (root buttresses)
 */
export function addTube(gb, pts, rad, opts = {}) {
  const segs = opts.radial || 6, n = pts.length;
  if (n < 2) return 0;
  const rect = opts.rect || [0, 0, 1, 1];
  const gn = opts.gnarl || 0, nz = opts.noise, seed = opts.seed || 0, twist = opts.twist || 0;
  let T = v3.norm(v3.sub(pts[1], pts[0]));
  let N = opts.N0 ? v3.norm(opts.N0) : perp(T);
  let along = opts.barkOffset || 0;
  const ringIds = [];
  for (let k = 0; k < n; k++) {
    if (k > 0) {
      const Tn = v3.norm(v3.sub(pts[Math.min(n - 1, k + 1)], pts[k - 1]));
      const ax = v3.cross(T, Tn), sa = v3.len(ax);
      if (sa > 1e-6) N = rotAxis(N, v3.mul(ax, 1 / sa), Math.asin(Math.min(1, sa)));
      T = Tn;
      along += v3.len(v3.sub(pts[k], pts[k - 1]));
    }
    N = v3.norm(v3.sub(N, v3.mul(T, v3.dot(N, T))));
    const B = v3.cross(T, N);
    const r = rad[k];
    const t = k / (n - 1);
    const f = opts.fol ? opts.fol(t, pts[k]) : [0.7, 0, 0, t];
    const ring = [];
    const circ = 2 * Math.PI * r;
    for (let i = 0; i <= segs; i++) {
      const a = (i / segs) * Math.PI * 2;
      let rr = r;
      if (gn && nz) {
        const tw = a + along * twist;
        rr *= 1 + gn * (0.12 * Math.sin(tw * 3 + seed) + 0.55 * nz.noise3(Math.cos(a) * 1.4 + seed, Math.sin(a) * 1.4, along * 0.7) + 0.25 * nz.noise3(Math.cos(a) * 3.1, Math.sin(a) * 3.1 + seed, along * 2.2));
      }
      if (opts.flare && k <= 2) {
        // root flare: buttress lobes at the base
        const fl = opts.flare * (1 - k / 2.5) * Math.pow(Math.max(0, Math.cos((a + seed) * opts.flareLobes || 0)), 2);
        rr *= 1 + fl;
      }
      const ca = Math.cos(a), sa2 = Math.sin(a);
      const dir = [N[0] * ca + B[0] * sa2, N[1] * ca + B[1] * sa2, N[2] * ca + B[2] * sa2];
      const p = v3.mad(pts[k], dir, rr);
      const u = lerp(rect[0], rect[2], i / segs);
      const v = lerp(rect[3], rect[1], t);
      ring.push(gb.v(p[0], p[1], p[2], dir[0], dir[1], dir[2], u, v, f[0], f[1], f[2], f[3], (i / segs) * circ, along));
    }
    ringIds.push(ring);
  }
  for (let k = 0; k < n - 1; k++) {
    for (let i = 0; i < segs; i++) {
      gb.quad(ringIds[k][i], ringIds[k][i + 1], ringIds[k + 1][i + 1], ringIds[k + 1][i]);
    }
  }
  if (opts.cap) {
    const c = pts[n - 1], f = opts.fol ? opts.fol(1, c) : [0.7, 0, 0, 1];
    const ci = gb.v(c[0], c[1], c[2], T[0], T[1], T[2], rect[0], rect[1], f[0], f[1], f[2], f[3], 0, along);
    for (let i = 0; i < segs; i++) gb.tri(ringIds[n - 1][i], ringIds[n - 1][i + 1], ci);
  }
  return along;
}

/**
 * View-facing ribbon along a polyline (willow strands, reed blades seen from afar): centreline vertices
 * duplicated left/right, aRib carries the tangent and the signed half width; the material expands it.
 * pts [[x,y,z]], width(t) → full width (m), rect atlas rect (u across, v along: v0 at the root),
 * normalFn(p, t) → lighting normal, folFn(p, t) → aFol
 */
export function addRibbon(gb, pts, width, rect, normalFn, folFn) {
  const n = pts.length;
  if (n < 2) return;
  let len = 0;
  const L = [0];
  for (let k = 1; k < n; k++) { len += v3.len(v3.sub(pts[k], pts[k - 1])); L.push(len); }
  const ids = [];
  for (let k = 0; k < n; k++) {
    const t = L[k] / len;
    const T = v3.norm(v3.sub(pts[Math.min(n - 1, k + 1)], pts[Math.max(0, k - 1)]));
    const w = width(t) * 0.5;
    const nn = normalFn(pts[k], t);
    const f = folFn(pts[k], t);
    const v = lerp(rect[1], rect[3], t);
    for (let s = -1; s <= 1; s += 2) {
      ids.push(gb.v(pts[k][0], pts[k][1], pts[k][2], nn[0], nn[1], nn[2], s < 0 ? rect[0] : rect[2], v, f[0], f[1], f[2], f[3], s, t));
      gb.rib(T[0], T[1], T[2], s * w);
    }
  }
  for (let k = 0; k < n - 1; k++) gb.quad(ids[k * 2], ids[k * 2 + 1], ids[k * 2 + 3], ids[k * 2 + 2]);
}

/**
 * A ribbon along a long polyline, split into tiles of `tile` metres (each tile maps the whole atlas cell along v,
 * so the texture repeats along the strand instead of stretching). width(g) / normalFn(p, g) / folFn(p, g) get the
 * global parameter g ∈ [0, 1] along the whole strand.
 */
export function addTiledRibbon(gb, pts, tile, width, rect, normalFn, folFn) {
  // cumulative arc length
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + v3.len(v3.sub(pts[i], pts[i - 1])));
  const total = cum[cum.length - 1];
  if (total <= 0) return;
  const at = (L) => { // point at arc length L
    let i = 1; while (i < cum.length - 1 && cum[i] < L) i++;
    const f = (L - cum[i - 1]) / Math.max(1e-9, cum[i] - cum[i - 1]);
    return v3.lerp(pts[i - 1], pts[i], Math.min(1, Math.max(0, f)));
  };
  for (let L0 = 0; L0 < total - 1e-4; L0 += tile) {
    const L1 = Math.min(total, L0 + tile);
    const seg = [at(L0)];
    for (let i = 1; i < pts.length - 1; i++) if (cum[i] > L0 + 1e-4 && cum[i] < L1 - 1e-4) seg.push(pts[i]);
    seg.push(at(L1));
    if (seg.length < 2) continue;
    // tile-local parameter t ↦ global g (partial last tile: v covers only part of the cell)
    const SL = L1 - L0, r = [rect[0], rect[1], rect[2], rect[1] + (rect[3] - rect[1]) * (SL / tile)];
    addRibbon(gb, seg, (t) => width((L0 + t * SL) / total), r, (p, t) => normalFn(p, (L0 + t * SL) / total), (p, t) => folFn(p, (L0 + t * SL) / total));
  }
}

/** far-LOD impostor quad: position (±R, 0..H, 0) (the shader turns it toward the camera), aAux = (±1, 0..1) */
export function billboardQuad(H, R, rect, y0 = 0) {
  const gb = new GeoBuilder();
  const ids = [];
  for (const [sx, sy] of [[-1, 0], [1, 0], [1, 1], [-1, 1]]) {
    ids.push(gb.v(sx * R, y0 + sy * (H - y0), 0, 0, 0, 1, sx < 0 ? rect[0] : rect[2], sy ? rect[1] : rect[3], 0.6, 0, 0.5, 0, sx, sy));
  }
  gb.quad(ids[0], ids[1], ids[2], ids[3]);
  return gb.build();
}

/** merge GeoBuilders' contents (same layout) into one */
export function mergeInto(dst, src) {
  const o = dst.count;
  dst.p.push(...src.p); dst.n.push(...src.n); dst.uv.push(...src.uv); dst.f.push(...src.f); dst.a.push(...src.a);
  if (dst.r) dst.r.push(...(src.r || new Array(src.count * 4).fill(0)));
  for (const i of src.idx) dst.idx.push(i + o);
  dst.count += src.count;
}

/** k-means merge of foliage clusters ({p, r, rnd}) into `count` blobs (mid / far LOD bodies) */
export function clusterBlobs(clusters, count, rng, minR = 0.5) {
  const pts = clusters.map((c) => c.p);
  if (pts.length <= count) return clusters.map((c) => ({ p: c.p, r: c.r * 1.25, rnd: c.rnd }));
  let cent = [];
  for (let i = 0; i < count; i++) cent.push(pts[Math.floor(rng.random() * pts.length)].slice());
  const assign = new Int32Array(pts.length);
  for (let it = 0; it < 6; it++) {
    for (let i = 0; i < pts.length; i++) {
      let best = 1e9, bi = 0;
      for (let k = 0; k < count; k++) { const d = v3.len(v3.sub(pts[i], cent[k])); if (d < best) { best = d; bi = k; } }
      assign[i] = bi;
    }
    const acc = cent.map(() => [0, 0, 0, 0]);
    for (let i = 0; i < pts.length; i++) { const a = acc[assign[i]]; a[0] += pts[i][0]; a[1] += pts[i][1]; a[2] += pts[i][2]; a[3]++; }
    cent = acc.map((a, k) => (a[3] ? [a[0] / a[3], a[1] / a[3], a[2] / a[3]] : cent[k]));
  }
  const out = [];
  for (let k = 0; k < count; k++) {
    let rmax = 0, n = 0;
    for (let i = 0; i < pts.length; i++) if (assign[i] === k) { rmax = Math.max(rmax, v3.len(v3.sub(pts[i], cent[k])) + clusters[i].r * 0.8); n++; }
    if (!n) continue;
    out.push({ p: cent[k], r: Math.max(rmax * 0.85, minR), rnd: rng.random(), n });
  }
  return out;
}
