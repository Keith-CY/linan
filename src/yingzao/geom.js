// Geometry toolkit for the 营造法式 generator.
//
// MeshBuilder collects triangles with, per vertex: position, normal, aPaint (vec4) and aUV (vec2).
//   aPaint = (kind, v, h, u): paint scheme id (see PAINT), height of the vertex above the member's bottom
//   edge (m), the member's height (m), and the distance along the member (m). The painted-wood shader uses
//   them for the 丹粉刷飾 white lower-edge lines, 黃丹 undersides and the 闌額 七朱八白 blocks.
//   aUV = free 2D coordinates in metres (tile courses, stone joints, plaster).
//   aAO = (ambient occlusion, sky-up visibility), baked by ao.js (1, 1 until then). The materials darken and
//   dirty the occluded parts with it, and snow lies only where the sky above is open.
// Builders work in any unit; call scale() once at the end (the bracket sets are modelled in 分).
import * as THREE from 'three';

export const PAINT = {
  ZHU: 0,      // 土朱 red ochre, plain
  MEMBER: 1,   // 栱 / 昂 / 方: 土朱 + white 緣道 on the lower edge + 黃丹 underside
  DOU: 2,      // 枓: 土朱, 黃丹 underside
  LANE: 3,     // 闌額: 七朱八白
  PLASTER: 4,  // white lime plaster
  STONE: 5,
  TILE: 6,
  COLUMN: 7,   // 柱身 土朱, 柱頭 / 柱腳 丹
  DARK: 8,     // interior darkness
  RAFTER: 9,   // 椽 / 飛子: 土朱, ends (u ≈ 0) light
  DAN: 10,     // 黃丹 (orange lead)
  WOOD: 11,    // doors / windows: 土朱, slightly browner
  RIDGE: 12,   // ridge courses
  CERAMIC: 13, // 鴟尾 / 獸頭 grey ceramic
  BRICK: 14,   // grey brick (塔身, 墩台, 階基 facing)
  MARBLE: 15,  // white stone (palace 階基, 勾闌)
  BRONZE: 16,  // 塔刹 bronze, gilt at the top
  PAPER: 17,   // lantern paper (emissive at night)
  LATTICE: 18, // flat panel painted as 格眼 lattice (low detail doors / windows, shop fronts)
  PLANK: 19,   // unpainted, weathered timber (houses, piles, boards)
  GLOW: 20,    // lit opening / lamp flame (emissive at night, dark by day)
  CEILING: 21, // 平棊 ceiling panels
  EAVE_TILE: 22, // 勾頭 / 滴水 eave tiles (ceramic, slightly lighter)
  WHITEWASH: 23, // lime-washed house walls (rougher, dirtier than palace plaster)
  ROCK: 24,    // rough stone (piles, lantern bases)
  GILT: 25,    // gilt bronze (top of the 塔刹)
};

const _v = new THREE.Vector3(), _n = new THREE.Vector3();

export class MeshBuilder {
  // growable typed arrays (pos 3, nor 3, paint 4, uv 2, ao 2 per vertex); `n` vertices in use
  constructor() { this.n = 0; this.cap = 0; this._alloc(0); }
  _alloc(cap) {
    const o = this.cap ? { pos: this.pos, nor: this.nor, paint: this.paint, uv: this.uv, ao: this.ao } : null;
    this.pos = new Float32Array(cap * 3); this.nor = new Float32Array(cap * 3); this.paint = new Float32Array(cap * 4);
    this.uv = new Float32Array(cap * 2); this.ao = new Float32Array(cap * 2);
    if (o) { this.pos.set(o.pos.subarray(0, this.n * 3)); this.nor.set(o.nor.subarray(0, this.n * 3)); this.paint.set(o.paint.subarray(0, this.n * 4)); this.uv.set(o.uv.subarray(0, this.n * 2)); this.ao.set(o.ao.subarray(0, this.n * 2)); }
    this.cap = cap;
  }
  // (growing 4× while small: most of the copying went into the doublings of the big family builders)
  reserve(k) { if (this.n + k > this.cap) this._alloc(Math.max(this.cap * (this.cap < 1 << 20 ? 4 : 2), this.n + k, 768)); }
  get count() { return this.n; }

  /** one vertex */
  v(x, y, z, nx, ny, nz, p = [0, 0, 1, 0], u = 0, w = 0) {
    if (this.n >= this.cap) this.reserve(1);
    const i = this.n++;
    const P = this.pos, N = this.nor, Q = this.paint, U = this.uv, A = this.ao;
    P[i * 3] = x; P[i * 3 + 1] = y; P[i * 3 + 2] = z;
    N[i * 3] = nx; N[i * 3 + 1] = ny; N[i * 3 + 2] = nz;
    Q[i * 4] = p[0]; Q[i * 4 + 1] = p[1]; Q[i * 4 + 2] = p[2]; Q[i * 4 + 3] = p[3];
    U[i * 2] = u; U[i * 2 + 1] = w;
    A[i * 2] = 1; A[i * 2 + 1] = 1;
  }

  /** flat triangle (normal from winding, counter-clockwise = front) */
  tri(a, b, c, pa, pb = pa, pc = pa, uva = [0, 0], uvb = [0, 0], uvc = [0, 0]) {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
    this.v(a[0], a[1], a[2], nx, ny, nz, pa, uva[0], uva[1]);
    this.v(b[0], b[1], b[2], nx, ny, nz, pb, uvb[0], uvb[1]);
    this.v(c[0], c[1], c[2], nx, ny, nz, pc, uvc[0], uvc[1]);
  }
  /** flat quad a-b-c-d (counter-clockwise) */
  quad(a, b, c, d, pa, pb = pa, pc = pa, pd = pa, uv = null) {
    const U = uv || [[0, 0], [0, 0], [0, 0], [0, 0]];
    this.tri(a, b, c, pa, pb, pc, U[0], U[1], U[2]);
    this.tri(a, c, d, pa, pc, pd, U[0], U[2], U[3]);
  }

  /**
   * Axis-aligned box from min/max corners. paint(kind) gets v = height above the box bottom, h = box height,
   * u = distance along `along` ('x' | 'z').
   */
  box(x0, y0, z0, x1, y1, z1, kind = PAINT.ZHU, along = 'x', faces = 0b111111) {
    const h = y1 - y0;
    const P = (x, y, z) => [kind, y - y0, h, along === 'x' ? x - x0 : z - z0];
    const UV = (a, b) => [a, b];
    const c = [[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]];
    const F = (i0, i1, i2, i3, uvf) => this.quad(c[i0], c[i1], c[i2], c[i3], P(...c[i0]), P(...c[i1]), P(...c[i2]), P(...c[i3]), uvf);
    if (faces & 1) F(4, 5, 6, 7, [UV(x0, y0), UV(x1, y0), UV(x1, y1), UV(x0, y1)]); // +z
    if (faces & 2) F(1, 0, 3, 2, [UV(x1, y0), UV(x0, y0), UV(x0, y1), UV(x1, y1)]); // -z
    if (faces & 4) F(5, 1, 2, 6, [UV(z1, y0), UV(z0, y0), UV(z0, y1), UV(z1, y1)]); // +x
    if (faces & 8) F(0, 4, 7, 3, [UV(z0, y0), UV(z1, y0), UV(z1, y1), UV(z0, y1)]); // -x
    if (faces & 16) F(3, 7, 6, 2, [UV(x0, z0), UV(x0, z1), UV(x1, z1), UV(x1, z0)]); // +y
    if (faces & 32) F(0, 1, 5, 4, [UV(x0, z0), UV(x1, z0), UV(x1, z1), UV(x0, z1)]); // -y
  }

  /**
   * Extrude a simple polygon drawn in a vertical plane. The profile is [[s, y], ...] (counter-clockwise seen
   * from +n), s along `dir` (unit [dx, dz] in the horizontal plane); extruded symmetrically by `thick` along
   * the horizontal normal of dir. Origin (ox, oy, oz). Side faces flat-shaded. Caps triangulated as a fan
   * from the polygon centroid (fine for the near-convex member outlines used here).
   */
  extrudeProfile(profile, thick, { ox = 0, oy = 0, oz = 0, dir = [1, 0], kind = PAINT.MEMBER, h = null, y0 = null, caps = true } = {}) {
    const dx = dir[0], dz = dir[1];
    const nx = -dz, nz = dx; // horizontal normal (left of dir)
    const ys = profile.map((p) => p[1]);
    const base = y0 ?? Math.min(...ys), hh = h ?? (Math.max(...ys) - base);
    const W = (s, y, side) => [ox + dx * s + nx * side * thick * 0.5, oy + y, oz + dz * s + nz * side * thick * 0.5];
    const P = (s, y) => [kind, y - base, hh, s];
    const n = profile.length;
    // sides
    for (let i = 0; i < n; i++) {
      const [s0, y0_] = profile[i], [s1, y1_] = profile[(i + 1) % n];
      this.quad(W(s0, y0_, -1), W(s1, y1_, -1), W(s1, y1_, 1), W(s0, y0_, 1), P(s0, y0_), P(s1, y1_), P(s1, y1_), P(s0, y0_),
        [[s0, y0_], [s1, y1_], [s1, y1_], [s0, y0_]]);
    }
    if (!caps) return;
    let cs = 0, cy = 0; for (const [s, y] of profile) { cs += s; cy += y; } cs /= n; cy /= n;
    for (let i = 0; i < n; i++) {
      const [s0, y0_] = profile[i], [s1, y1_] = profile[(i + 1) % n];
      this.tri(W(cs, cy, 1), W(s0, y0_, 1), W(s1, y1_, 1), P(cs, cy), P(s0, y0_), P(s1, y1_), [cs, cy], [s0, y0_], [s1, y1_]);
      this.tri(W(cs, cy, -1), W(s1, y1_, -1), W(s0, y0_, -1), P(cs, cy), P(s1, y1_), P(s0, y0_), [cs, cy], [s1, y1_], [s0, y0_]);
    }
  }

  /** lathe around +Y: profile [[r, y], ...] bottom to top; smooth normals. */
  lathe(profile, segs, { ox = 0, oy = 0, oz = 0, kind = PAINT.COLUMN, capTop = true, capBottom = false, phase = 0 } = {}) {
    const y0 = profile[0][1], H = profile[profile.length - 1][1] - y0;
    const ring = (r, a) => [Math.cos(a) * r, Math.sin(a) * r];
    for (let i = 0; i < profile.length - 1; i++) {
      const [r0, ya] = profile[i], [r1, yb] = profile[i + 1];
      const dr = r1 - r0, dy = yb - ya, l = Math.hypot(dr, dy) || 1;
      const nr = dy / l, ny = -dr / l; // outward normal in (r, y)
      for (let k = 0; k < segs; k++) {
        const a0 = phase + (k / segs) * Math.PI * 2, a1 = phase + ((k + 1) / segs) * Math.PI * 2;
        const [c0, s0] = ring(1, a0), [c1, s1] = ring(1, a1);
        const p = (r, y, c, s) => [ox + c * r, oy + y, oz + s * r];
        const pa = (y, a) => [kind, y - y0, H, a];
        const A = p(r0, ya, c0, s0), B = p(r0, ya, c1, s1), C = p(r1, yb, c1, s1), D = p(r1, yb, c0, s0);
        // smooth normals per vertex column
        this.v(...A, c0 * nr, ny, s0 * nr, pa(ya, a0), a0 * r0, ya); this.v(...C, c1 * nr, ny, s1 * nr, pa(yb, a1), a1 * r1, yb); this.v(...B, c1 * nr, ny, s1 * nr, pa(ya, a1), a1 * r0, ya);
        this.v(...A, c0 * nr, ny, s0 * nr, pa(ya, a0), a0 * r0, ya); this.v(...D, c0 * nr, ny, s0 * nr, pa(yb, a0), a0 * r1, yb); this.v(...C, c1 * nr, ny, s1 * nr, pa(yb, a1), a1 * r1, yb);
      }
    }
    const cap = (r, y, up) => {
      for (let k = 0; k < segs; k++) {
        const a0 = phase + (k / segs) * Math.PI * 2, a1 = phase + ((k + 1) / segs) * Math.PI * 2;
        const A = [ox, oy + y, oz], B = [ox + Math.cos(a0) * r, oy + y, oz + Math.sin(a0) * r], C = [ox + Math.cos(a1) * r, oy + y, oz + Math.sin(a1) * r];
        const pp = [kind, y - y0, H, 0];
        if (up) this.tri(A, C, B, pp); else this.tri(A, B, C, pp);
      }
    };
    if (capTop) cap(profile[profile.length - 1][0], profile[profile.length - 1][1], true);
    if (capBottom) cap(profile[0][0], profile[0][1], false);
  }

  /**
   * Sweep a closed cross-section along a path (tube). path: [{p:[x,y,z], t:[tx,ty,tz] (tangent), up:[...]}].
   * section: [[a, b], ...] in the plane (side, up) — counter-clockwise. Smooth normals across the section.
   */
  sweep(path, section, { kind = PAINT.TILE, closed = true, along0 = 0 } = {}) {
    const n = section.length;
    // section normals (averaged)
    const sn = section.map((p, i) => {
      const a = section[(i - 1 + n) % n], b = section[(i + 1) % n];
      const ta = b[0] - a[0], tb = b[1] - a[1]; const l = Math.hypot(ta, tb) || 1;
      return [tb / l, -ta / l];
    });
    let acc = along0;
    const frames = path.map((f, i) => {
      if (i > 0) acc += Math.hypot(f.p[0] - path[i - 1].p[0], f.p[1] - path[i - 1].p[1], f.p[2] - path[i - 1].p[2]);
      const t = new THREE.Vector3(...f.t).normalize();
      const up = new THREE.Vector3(...f.up);
      const side = new THREE.Vector3().crossVectors(t, up).normalize();
      up.crossVectors(side, t).normalize();
      return { p: f.p, side, up, s: acc };
    });
    const segs = closed ? n : n - 1;
    for (let i = 0; i < frames.length - 1; i++) {
      const F0 = frames[i], F1 = frames[i + 1];
      for (let k = 0; k < segs; k++) {
        const k1 = (k + 1) % n;
        const P = (F, j) => [F.p[0] + F.side.x * section[j][0] + F.up.x * section[j][1], F.p[1] + F.side.y * section[j][0] + F.up.y * section[j][1], F.p[2] + F.side.z * section[j][0] + F.up.z * section[j][1]];
        const N = (F, j) => { _n.copy(F.side).multiplyScalar(sn[j][0]).addScaledVector(F.up, sn[j][1]).normalize(); return [_n.x, _n.y, _n.z]; };
        const pa = (F, j) => [kind, section[j][1], 1, F.s];
        const a = P(F0, k), b = P(F0, k1), c = P(F1, k1), d = P(F1, k);
        const na = N(F0, k), nb = N(F0, k1), nc = N(F1, k1), nd = N(F1, k);
        // (winding a-c-b: front faces outward for a counter-clockwise section)
        this.v(...a, ...na, pa(F0, k), F0.s, section[k][0]); this.v(...c, ...nc, pa(F1, k1), F1.s, section[k1][0]); this.v(...b, ...nb, pa(F0, k1), F0.s, section[k1][0]);
        this.v(...a, ...na, pa(F0, k), F0.s, section[k][0]); this.v(...d, ...nd, pa(F1, k), F1.s, section[k][0]); this.v(...c, ...nc, pa(F1, k1), F1.s, section[k1][0]);
      }
    }
  }

  /** append another builder, optionally transformed by a Matrix4 */
  append(other, m = null) {
    const n = other.n;
    if (!n) return this;
    this.reserve(n);
    const base = this.n;
    const P = this.pos, N = this.nor, op = other.pos, on = other.nor;
    if (!m) { P.set(op.subarray(0, n * 3), base * 3); N.set(on.subarray(0, n * 3), base * 3); }
    else {
      const e = m.elements;
      const pureT = e[0] === 1 && e[5] === 1 && e[10] === 1 && e[1] === 0 && e[2] === 0 && e[4] === 0 && e[6] === 0 && e[8] === 0 && e[9] === 0;
      if (pureT) {
        const tx = e[12], ty = e[13], tz = e[14];
        for (let i = 0; i < n; i++) { const a = (base + i) * 3, b = i * 3; P[a] = op[b] + tx; P[a + 1] = op[b + 1] + ty; P[a + 2] = op[b + 2] + tz; }
        N.set(on.subarray(0, n * 3), base * 3);
      } else {
        const nm = new THREE.Matrix3().getNormalMatrix(m).elements;
        for (let i = 0; i < n; i++) {
          const a = (base + i) * 3, b = i * 3;
          const x = op[b], y = op[b + 1], z = op[b + 2];
          P[a] = e[0] * x + e[4] * y + e[8] * z + e[12]; P[a + 1] = e[1] * x + e[5] * y + e[9] * z + e[13]; P[a + 2] = e[2] * x + e[6] * y + e[10] * z + e[14];
          const u = on[b], v = on[b + 1], w = on[b + 2];
          const nx = nm[0] * u + nm[3] * v + nm[6] * w, ny = nm[1] * u + nm[4] * v + nm[7] * w, nz = nm[2] * u + nm[5] * v + nm[8] * w;
          const l = Math.hypot(nx, ny, nz) || 1;
          N[a] = nx / l; N[a + 1] = ny / l; N[a + 2] = nz / l;
        }
      }
    }
    this.paint.set(other.paint.subarray(0, n * 4), base * 4);
    this.uv.set(other.uv.subarray(0, n * 2), base * 2);
    this.ao.set(other.ao.subarray(0, n * 2), base * 2);
    this.n += n;
    return this;
  }

  /** planar quad a-b-c-d (counter-clockwise) subdivided nu × nv (so baked AO / dirt gradients have vertices) */
  quadGrid(a, b, c, d, nu, nv, paintAt, uvAt = null) {
    const L = (p, q, t) => [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t, p[2] + (q[2] - p[2]) * t];
    const P = (u, v) => L(L(a, b, u), L(d, c, u), v);
    for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
      const u0 = i / nu, u1 = (i + 1) / nu, v0 = j / nv, v1 = (j + 1) / nv;
      const A = P(u0, v0), B = P(u1, v0), C = P(u1, v1), D = P(u0, v1);
      const U = uvAt ? [uvAt(u0, v0), uvAt(u1, v0), uvAt(u1, v1), uvAt(u0, v1)] : null;
      this.quad(A, B, C, D, paintAt(u0, v0, A), paintAt(u1, v0, B), paintAt(u1, v1, C), paintAt(u0, v1, D), U);
    }
  }

  /** copy with only the triangles whose first vertex passes keep(x, y, z) */
  filterTris(keep) {
    const out = new MeshBuilder();
    for (let t = 0; t < this.n / 3; t++) {
      const i = t * 3;
      if (!keep(this.pos[i * 3], this.pos[i * 3 + 1], this.pos[i * 3 + 2])) continue;
      for (let k = i; k < i + 3; k++) {
        out.v(this.pos[k * 3], this.pos[k * 3 + 1], this.pos[k * 3 + 2], this.nor[k * 3], this.nor[k * 3 + 1], this.nor[k * 3 + 2],
          [this.paint[k * 4], this.paint[k * 4 + 1], this.paint[k * 4 + 2], this.paint[k * 4 + 3]], this.uv[k * 2], this.uv[k * 2 + 1]);
        out.ao[(out.n - 1) * 2] = this.ao[k * 2]; out.ao[(out.n - 1) * 2 + 1] = this.ao[k * 2 + 1];
      }
    }
    return out;
  }

  /** transform in place by a Matrix4 */
  applyMatrix(m) {
    const nm = new THREE.Matrix3().getNormalMatrix(m);
    for (let i = 0; i < this.n; i++) {
      _v.set(this.pos[i * 3], this.pos[i * 3 + 1], this.pos[i * 3 + 2]).applyMatrix4(m);
      _n.set(this.nor[i * 3], this.nor[i * 3 + 1], this.nor[i * 3 + 2]).applyMatrix3(nm).normalize();
      this.pos[i * 3] = _v.x; this.pos[i * 3 + 1] = _v.y; this.pos[i * 3 + 2] = _v.z;
      this.nor[i * 3] = _n.x; this.nor[i * 3 + 1] = _n.y; this.nor[i * 3 + 2] = _n.z;
    }
    return this;
  }

  /** uniform scale of positions and of the metric paint / uv channels (分 → metres) */
  scale(k) {
    for (let i = 0; i < this.n * 3; i++) this.pos[i] *= k;
    for (let i = 0; i < this.n; i++) { this.paint[i * 4 + 1] *= k; this.paint[i * 4 + 2] *= k; this.paint[i * 4 + 3] *= k; }
    for (let i = 0; i < this.n * 2; i++) this.uv[i] *= k;
    return this;
  }

  toGeometry() {
    const g = new THREE.BufferGeometry();
    const n = this.n;
    g.setAttribute('position', new THREE.BufferAttribute(this.pos.slice(0, n * 3), 3));
    g.setAttribute('normal', new THREE.BufferAttribute(this.nor.slice(0, n * 3), 3));
    g.setAttribute('aPaint', new THREE.BufferAttribute(this.paint.slice(0, n * 4), 4));
    g.setAttribute('aUV', new THREE.BufferAttribute(this.uv.slice(0, n * 2), 2));
    g.setAttribute('aAO', new THREE.BufferAttribute(this.ao.slice(0, n * 2), 2));
    g.computeBoundingBox(); g.computeBoundingSphere();
    return g;
  }
}

/** smooth ramp 0→1 */
export const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
export const lerp = (a, b, t) => a + (b - a) * t;
