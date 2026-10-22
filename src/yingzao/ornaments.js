// Sculpted ornaments for the roofs and towers: 鴟尾, 獸頭 / 蹲獸 / 嬪伽, 套獸, 勾頭 (華頭甋瓦) and 滴水 (重脣瓪瓦),
// 寶頂, 塔刹, lanterns. All are real 3D meshes:
//   inflate(): a 2D silhouette blown up into a rounded solid (signed distance → thickness), with relief, so the
//              ornament reads from every side instead of as a flat cut-out;
//   lathe pieces for everything round.
// Sizes come from the callers (fashi.js: 鴟尾 / 獸 heights by 卷十三); shapes are drawn after Song examples (approx.).
import * as THREE from 'three';
import { MeshBuilder, PAINT } from './geom.js';

// ------------------------------------------------------------------------------------------------ 2D helpers
export function chaikin(pts, iters = 2) {
  let P = pts;
  for (let k = 0; k < iters; k++) {
    const Q = [];
    for (let i = 0; i < P.length; i++) {
      const a = P[i], b = P[(i + 1) % P.length];
      Q.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25], [a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]);
    }
    P = Q;
  }
  return P;
}
function segDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2));
  return Math.hypot(px - ax - dx * t, py - ay - dy * t);
}
function signedDist(poly, x, y) {
  let inside = false, d = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    d = Math.min(d, segDist(x, y, xi, yi, xj, yj));
  }
  return inside ? d : -d;
}

/**
 * Inflate a closed 2D outline (normalised units, s along `dir`, y up) into a rounded solid.
 * @param {MeshBuilder} B
 * @param {number[][]} outline
 * @param {object} o  origin [x,y,z], dir [dx,dz] (horizontal), size (m per unit), thick (m, max), kind,
 *                    res (grid cells across), rim (fraction of thickness kept at the edge), power (profile),
 *                    relief(s, y, sd) → extra half-thickness in units of thick (grooves, fins, eyes), taper(y)
 */
export function inflate(B, outline, { origin = [0, 0, 0], dir = [1, 0], size = 1, thick = 0.2, kind = PAINT.CERAMIC, res = 36, rim = 0.22, power = 0.55, relief = null, taper = null, smoothIters = 2 } = {}) {
  const poly = chaikin(outline, smoothIters);
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const [x, y] of poly) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  const span = Math.max(x1 - x0, y1 - y0), h = span / res;
  x0 -= h; y0 -= h;
  const nx = Math.ceil((x1 - x0) / h) + 2, ny = Math.ceil((y1 - y0) / h) + 2;
  const sd = new Float32Array(nx * ny);
  let maxSd = 1e-6;
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) { const v = signedDist(poly, x0 + i * h, y0 + j * h); sd[i + j * nx] = v; if (v > maxSd) maxSd = v; }
  // 2D vertices: grid corners inside + edge crossings; key them so the sheets can be smoothed
  const verts = [], keyOf = new Map();
  const addV = (key, x, y, d) => { let id = keyOf.get(key); if (id === undefined) { id = verts.length; verts.push([x, y, Math.max(0, d)]); keyOf.set(key, id); } return id; };
  const corner = (i, j) => addV('c' + i + ',' + j, x0 + i * h, y0 + j * h, sd[i + j * nx]);
  const cross = (i0, j0, i1, j1) => {
    const a = sd[i0 + j0 * nx], b = sd[i1 + j1 * nx], t = a / (a - b);
    const key = i0 < i1 || j0 < j1 ? `e${i0},${j0},${i1},${j1}` : `e${i1},${j1},${i0},${j0}`;
    return addV(key, x0 + (i0 + (i1 - i0) * t) * h, y0 + (j0 + (j1 - j0) * t) * h, 0);
  };
  const tris = [], edges = [];
  for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
    const c = [[i, j], [i + 1, j], [i + 1, j + 1], [i, j + 1]];
    const ins = c.map(([a, b]) => sd[a + b * nx] > 0);
    if (!ins.some(Boolean)) continue;
    const ring = [], bnd = [];
    for (let q = 0; q < 4; q++) {
      const [a, b] = c[q], [a2, b2] = c[(q + 1) % 4];
      if (ins[q]) ring.push(corner(a, b));
      if (ins[q] !== ins[(q + 1) % 4]) { const v = cross(a, b, a2, b2); ring.push(v); bnd.push(v); }
    }
    for (let q = 1; q < ring.length - 1; q++) tris.push([ring[0], ring[q], ring[q + 1]]);
    if (bnd.length === 2) edges.push(ins[0] || ins[1] ? [bnd[0], bnd[1]] : [bnd[0], bnd[1]]);
    else if (bnd.length === 4) { edges.push([bnd[0], bnd[1]]); edges.push([bnd[2], bnd[3]]); }
  }
  // half thickness per vertex
  const ht = verts.map(([x, y, d]) => {
    let t = rim + (1 - rim) * Math.pow(Math.min(1, d / maxSd), power);
    if (relief) t += relief(x, y, d / maxSd);
    if (taper) t *= taper(y);
    return Math.max(0.02, t) * thick * 0.5;
  });
  // 3D: s along dir, y up, w across (normal of dir)
  const dx = dir[0], dz = dir[1], wx = -dz, wz = dx;
  const P3 = (id, side) => { const [x, y] = verts[id]; const w = ht[id] * side; return [origin[0] + dx * x * size + wx * w, origin[1] + y * size, origin[2] + dz * x * size + wz * w]; };
  // smooth normals from the sheet gradient
  const nrm = verts.map(() => [0, 0, 0]);
  for (const [a, b, c] of tris) {
    const A = P3(a, 1), Bp = P3(b, 1), C = P3(c, 1);
    const ux = Bp[0] - A[0], uy = Bp[1] - A[1], uz = Bp[2] - A[2], vx = C[0] - A[0], vy = C[1] - A[1], vz = C[2] - A[2];
    const n = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
    for (const id of [a, b, c]) { nrm[id][0] += n[0]; nrm[id][1] += n[1]; nrm[id][2] += n[2]; }
  }
  // which way the sheet's (s, y) winding faces: make side +1 point along +w
  const probe = tris.length ? (() => { const [a, b, c] = tris[0]; const A = verts[a], Bv = verts[b], C = verts[c]; return (Bv[0] - A[0]) * (C[1] - A[1]) - (Bv[1] - A[1]) * (C[0] - A[0]); })() : 1;
  const flip = probe < 0;
  const N3 = (id, side) => {
    const n = nrm[id]; const l = Math.hypot(n[0], n[1], n[2]) || 1;
    // reflect across the mid plane for the back sheet
    let v = [n[0] / l, n[1] / l, n[2] / l];
    const dw = v[0] * wx + v[2] * wz;
    if (dw < 0) v = v.map((q) => -q);
    if (side < 0) { const k = 2 * (v[0] * wx + v[2] * wz); v = [v[0] - k * wx, v[1], v[2] - k * wz]; }
    return v;
  };
  const pa = (id) => [kind, verts[id][1] * size, 1, verts[id][0] * size];
  const emit = (ids, side) => {
    for (const id of ids) { const p = P3(id, side), n = N3(id, side); B.v(p[0], p[1], p[2], n[0], n[1], n[2], pa(id), verts[id][0] * size, verts[id][1] * size); }
  };
  for (const [a, b, c] of tris) {
    // front sheet (+w): counter-clockwise seen from +w
    if (!flip) { emit([a, b, c], 1); emit([a, c, b], -1); } else { emit([a, c, b], 1); emit([a, b, c], -1); }
  }
  // rim wall
  for (const [a, b] of edges) {
    const A1 = P3(a, 1), B1 = P3(b, 1), A0 = P3(a, -1), B0 = P3(b, -1);
    const ex = (verts[b][0] - verts[a][0]), ey = (verts[b][1] - verts[a][1]);
    // outward in 2D: perpendicular; choose the side away from the interior using sd gradient (cheap: sample)
    const mx = (verts[a][0] + verts[b][0]) / 2, my = (verts[a][1] + verts[b][1]) / 2;
    let ox = ey, oy = -ex; const ol = Math.hypot(ox, oy) || 1; ox /= ol; oy /= ol;
    if (signedDist(poly, mx + ox * h * 0.3, my + oy * h * 0.3) > 0) { ox = -ox; oy = -oy; }
    const n3 = [dx * ox, oy, dz * ox];
    const quadOut = (p, q, r, s) => {
      // orient so the face normal follows n3
      const ux = q[0] - p[0], uy = q[1] - p[1], uz = q[2] - p[2], vx = r[0] - p[0], vy = r[1] - p[1], vz = r[2] - p[2];
      const n = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
      const P_ = [kind, my * size, 1, mx * size];
      if (n[0] * n3[0] + n[1] * n3[1] + n[2] * n3[2] >= 0) B.quad(p, q, r, s, P_); else B.quad(p, s, r, q, P_);
    };
    quadOut(A0, B0, B1, A1);
  }
  return B;
}

// ------------------------------------------------------------------------------------------------ outlines
/** 鴟尾 (side view; s outward along the ridge, y up, base on the ridge). Song form after the 法式 plates and
 *  Tang–Song survivals (approx.): a tall body swelling a little at mid height, a row of fine fin teeth (鰭) down the
 *  outer edge, the crown turning inward into a tail that hooks back down over the ridge. */
export const CHIWEI = (() => {
  const pts = [[-0.44, 0], [0.18, 0]];
  // outer edge with saw-teeth: a smooth spine x(y) plus a tooth every 0.075
  const spine = (y) => 0.18 + 0.07 * Math.sin(Math.min(1, y / 0.62) * Math.PI * 0.75) - 0.28 * Math.max(0, (y - 0.55) / 0.4) ** 1.6;
  for (let y = 0.06; y < 0.86; y += 0.025) {
    const ph = ((y - 0.06) / 0.075) % 1;
    const tooth = ph < 0.65 ? (ph / 0.65) * 0.045 : (1 - (ph - 0.65) / 0.35) * 0.045;
    pts.push([spine(y) + tooth, y]);
  }
  pts.push([0.0, 0.92], [-0.1, 0.98], [-0.22, 1.0], [-0.35, 0.97], [-0.46, 0.89], [-0.53, 0.78], [-0.54, 0.68], [-0.5, 0.61],
    [-0.45, 0.6], [-0.44, 0.66], [-0.4, 0.72], [-0.35, 0.7], [-0.33, 0.6], [-0.35, 0.46], [-0.4, 0.3], [-0.43, 0.14], [-0.44, 0.05]);
  return pts;
})();
/** 獸頭 (side view, facing +s): open-mouthed head with horn and mane */
export const BEAST = [
  [-0.4, 0], [0.34, 0], [0.46, 0.08], [0.5, 0.18], [0.36, 0.22], [0.5, 0.3], [0.48, 0.42], [0.34, 0.5], [0.22, 0.56],
  [0.18, 0.7], [0.04, 0.68], [-0.02, 0.9], [-0.12, 0.98], [-0.16, 0.8], [-0.28, 0.72], [-0.36, 0.56], [-0.44, 0.34],
];
/** 蹲獸 (a seated beast, facing +s) */
export const SQUAT = [
  [-0.38, 0], [0.34, 0], [0.36, 0.12], [0.26, 0.2], [0.3, 0.42], [0.42, 0.5], [0.44, 0.66], [0.34, 0.82], [0.16, 0.86],
  [0.06, 0.74], [-0.06, 0.6], [-0.22, 0.56], [-0.34, 0.4], [-0.3, 0.2],
];
/** 嬪伽 (a winged figure at the hip tip, facing +s) */
export const PINJIA = [
  [-0.3, 0], [0.3, 0], [0.26, 0.2], [0.18, 0.36], [0.34, 0.5], [0.24, 0.56], [0.14, 0.52], [0.12, 0.7], [0.18, 0.82],
  [0.1, 0.96], [-0.04, 0.96], [-0.1, 0.84], [-0.06, 0.7], [-0.12, 0.56], [-0.36, 0.66], [-0.46, 0.5], [-0.24, 0.36], [-0.2, 0.2],
];

/** relief for the 鴟尾: fin ridges along the outer edge, scale bands on the body, a mouth line at the base */
function chiweiRelief(s, y, k) {
  // fin ribs running in from the teeth, a groove parting the fin band from the body, a raised rim round the tail
  const outer = Math.max(0, Math.min(1, (s - 0.02) / 0.16));
  const ribs = Math.pow(Math.max(0, Math.sin(((y - 0.06) / 0.075) * Math.PI * 2 - 1.2)), 3) * 0.1 * outer * (y > 0.06 && y < 0.86 ? 1 : 0);
  const groove = -0.12 * Math.exp(-((s - 0.04) ** 2) / 0.0012) * (y > 0.08 && y < 0.82 ? 1 : 0);
  const rim = 0.08 * Math.exp(-((k - 0.12) ** 2) / 0.004) * (s < -0.25 ? 1 : 0);
  return ribs + groove + rim;
}
function beastRelief(s, y, k) {
  const eye = -0.25 * Math.exp(-(((s - 0.28) ** 2) + ((y - 0.44) ** 2)) / 0.003);
  const mane = Math.sin(y * 30 + s * 8) * 0.06 * (1 - Math.min(1, k * 2.5)) * (s < 0.1 ? 1 : 0);
  return eye + mane;
}

export function chiwei(B, { origin, outward, H, thick, res = 44 }) {
  // outward: unit [dx, dz] pointing away from the ridge centre (the tail curls back toward the centre)
  inflate(B, CHIWEI, { origin, dir: outward, size: H, thick, kind: PAINT.CERAMIC, res, rim: 0.3, power: 0.6, relief: chiweiRelief, taper: (y) => 1 - 0.45 * Math.min(1, Math.max(0, y)) });
}
export function beast(B, outline, { origin, facing, H, thick, res = 26 }) {
  inflate(B, outline, { origin, dir: facing, size: H, thick: Math.max(thick, H * 0.42), kind: PAINT.CERAMIC, res, rim: 0.4, power: 0.5, relief: outline === BEAST ? beastRelief : null });
}

// ------------------------------------------------------------------------------------------------ lathe pieces
/** lathe a profile [[r, y], ...] and place it with a basis (x = side, y = axis, z = side2) at o */
export function latheAt(B, profile, segs, { o = [0, 0, 0], axis = null, kind = PAINT.CERAMIC, capTop = true, capBottom = false, phase = 0 } = {}) {
  const g = new MeshBuilder();
  g.lathe(profile, segs, { kind, capTop, capBottom, phase });
  if (!axis) { B.append(g, new THREE.Matrix4().makeTranslation(o[0], o[1], o[2])); return; }
  const y = new THREE.Vector3(...axis).normalize();
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), y);
  B.append(g, new THREE.Matrix4().compose(new THREE.Vector3(...o), q, new THREE.Vector3(1, 1, 1)));
}

/** 勾頭 (華頭甋瓦 end, 瓦當): a round face with a rim and a central boss, facing `out` (unit 3D) at `c` */
export function goutou(B, c, out, r) {
  const prof = [[r * 0.98, -r * 0.18], [r, -r * 0.02], [r * 0.7, -r * 0.02], [0.0, r * 0.12]];
  latheAt(B, prof, 8, { o: c, axis: out, kind: PAINT.EAVE_TILE, capTop: true });
}

/** 滴水 (重脣瓪瓦 lip): a concave strip spanning the channel at the eave, with a thick lip hanging down.
 *  frame: c (centre of the channel at the tile tip), side (unit, along the eave), down (unit, down the slope / out),
 *  up (surface normal); w channel width; r 甋瓦 radius */
export function dishui(B, c, side, out, up, w, r) {
  const P = (s, u, o) => [c[0] + side[0] * s + up[0] * u + out[0] * o, c[1] + side[1] * s + up[1] * u + out[1] * o, c[2] + side[2] * s + up[2] * u + out[2] * o];
  const n = 4, drop = r * 0.95, th = r * 0.22;
  const pa = [PAINT.EAVE_TILE, 0, 1, 0];
  for (let i = 0; i < n; i++) {
    const s0 = -w / 2 + (w * i) / n, s1 = -w / 2 + (w * (i + 1)) / n;
    const sag = (s) => -r * 0.35 * (1 - (2 * s / w) ** 2);   // concave channel
    const wave = (s) => drop * (0.85 + 0.15 * Math.cos((s / w) * Math.PI * 6)); // 重脣: a wavy lower edge
    // lip front face (facing out)
    B.quad(P(s0, sag(s0) - wave(s0), 0.01), P(s1, sag(s1) - wave(s1), 0.01), P(s1, sag(s1) + th * 0.3, 0.01), P(s0, sag(s0) + th * 0.3, 0.01), pa);
    // lip bottom
    B.quad(P(s0, sag(s0) - wave(s0), -th), P(s1, sag(s1) - wave(s1), -th), P(s1, sag(s1) - wave(s1), 0.01), P(s0, sag(s0) - wave(s0), 0.01), pa);
    // top of the tile (continuing up the slope a little)
    B.quad(P(s0, sag(s0) + th * 0.3, 0.01), P(s1, sag(s1) + th * 0.3, 0.01), P(s1, sag(s1) + th * 0.3, -r * 1.6), P(s0, sag(s0) + th * 0.3, -r * 1.6), pa);
  }
}

/** 套獸: the ceramic cap on the 子角梁 head — a small beast mask (lathe + snout) facing `out` */
/** 套獸: the ceramic beast mask capping the 子角梁 head, open jaws facing out along `out` (3D unit) */
export const TAOSHOU = [[-0.5, 0.05], [0.1, -0.02], [0.42, 0.08], [0.5, 0.22], [0.3, 0.3], [0.48, 0.42], [0.46, 0.62], [0.3, 0.74],
  [0.16, 0.95], [0.02, 0.78], [-0.14, 0.92], [-0.24, 0.72], [-0.5, 0.66]];
export function taoshou(B, c, out, r) {
  const h = Math.hypot(out[0], out[2]) || 1;
  inflate(B, TAOSHOU, { origin: [c[0] - (out[0] / h) * r * 0.4, c[1] - r * 0.7, c[2] - (out[2] / h) * r * 0.4], dir: [out[0] / h, out[2] / h], size: r * 1.7, thick: r * 1.5, kind: PAINT.CERAMIC, res: 16, rim: 0.45, power: 0.5, relief: beastRelief });
}

/** 寶頂 of a 攢尖: a 須彌 seat, a 覆鉢 and a pearl (heights relative to H) */
export function baoding(B, top, H, kind = PAINT.CERAMIC) {
  const r = H * 0.28;
  const prof = [[r * 1.1, 0], [r * 1.1, H * 0.08], [r * 0.8, H * 0.12], [r * 0.85, H * 0.2], [r * 1.0, H * 0.24], [r * 0.95, H * 0.3],
    [r * 0.7, H * 0.36], [r * 0.95, H * 0.48], [r * 0.9, H * 0.6], [r * 0.45, H * 0.7], [r * 0.25, H * 0.72], [r * 0.5, H * 0.8], [r * 0.48, H * 0.9], [r * 0.25, H * 0.98], [0, H]];
  latheAt(B, prof, 16, { o: top, kind });
}

/** 塔刹: 刹座 (lotus seat), 覆鉢, 相輪 rings on the 刹桿, 寶蓋, 圓光, 寶珠 / 葫蘆. Bronze; returns the top point */
export function tasha(B, base, H, { rings = 7 } = {}) {
  const r = H * 0.09;
  const ks = PAINT.BRONZE;
  let y = 0;
  let ks2 = ks;
  const seg = (prof, segs = 18) => { latheAt(B, prof.map(([a, b]) => [a, b + y]), segs, { o: base, kind: ks2 }); y = prof[prof.length - 1][1] + y; };
  // 刹座 (須彌 / lotus): a stepped drum
  seg([[r * 2.2, 0], [r * 2.2, H * 0.03], [r * 1.7, H * 0.045], [r * 1.8, H * 0.07], [r * 2.0, H * 0.08], [r * 1.5, H * 0.09]]);
  // 覆鉢
  seg([[r * 1.5, 0], [r * 1.9, H * 0.025], [r * 1.85, H * 0.06], [r * 1.4, H * 0.09], [r * 0.6, H * 0.105]]);
  // 刹桿 + 相輪
  const pole = r * 0.32, ringGap = (H * 0.42) / rings;
  for (let i = 0; i < rings; i++) {
    const rr = r * (1.45 - 0.55 * (i / rings));
    seg([[pole, 0], [pole, ringGap * 0.3], [rr, ringGap * 0.42], [rr, ringGap * 0.62], [pole, ringGap * 0.74], [pole, ringGap]], 16);
  }
  // 寶蓋 (canopy with a turned-up rim)
  seg([[pole, 0], [r * 1.9, H * 0.03], [r * 2.1, H * 0.045], [r * 1.9, H * 0.05], [pole, H * 0.06]], 16);
  // 圓光 / 仰月 then 寶珠 and a 葫蘆 (gilt)
  ks2 = PAINT.GILT;
  seg([[pole, 0], [pole, H * 0.05], [r * 0.9, H * 0.07], [r * 0.95, H * 0.1], [r * 0.6, H * 0.125], [pole, H * 0.135]], 14);
  seg([[pole * 0.8, 0], [r * 0.85, H * 0.04], [r * 0.85, H * 0.07], [r * 0.4, H * 0.1], [r * 0.55, H * 0.125], [r * 0.5, H * 0.15], [r * 0.15, H * 0.175], [0, H * 0.19]], 14);
  return [base[0], base[1] + y, base[2]];
}

/** a round paper lantern hanging from `top` (cord length `cord`), radius r: wooden caps + ribbed paper body (PAPER) */
export function lantern(wood, paper, top, r, cord = 0.25) {
  const cx = top[0], cz = top[2];
  const y0 = top[1] - cord;
  // cord
  wood.box(cx - 0.006, y0, cz - 0.006, cx + 0.006, top[1], cz + 0.006, PAINT.DARK, 'x');
  // caps
  latheAt(wood, [[r * 0.45, -r * 0.12], [r * 0.5, 0], [0, 0.02 * r]], 10, { o: [cx, y0, cz], kind: PAINT.ZHU });
  const body = [];
  for (let i = 0; i <= 10; i++) { const a = -Math.PI / 2 + (i / 10) * Math.PI; body.push([Math.cos(a) * r, Math.sin(a) * r * 1.15]); }
  body[0][0] = r * 0.42; body[body.length - 1][0] = r * 0.42;
  latheAt(paper, body.map(([a, b]) => [a, b - r * 1.15 - r * 0.12]), 16, { o: [cx, y0, cz], kind: PAINT.PAPER, capTop: false });
  latheAt(wood, [[0, -r * 2.6], [r * 0.5, -r * 2.55], [r * 0.45, -r * 2.42]], 10, { o: [cx, y0, cz], kind: PAINT.ZHU });
  // tassel
  wood.box(cx - 0.012, y0 - r * 3.2, cz - 0.012, cx + 0.012, y0 - r * 2.6, cz + 0.012, PAINT.ZHU, 'x');
}
