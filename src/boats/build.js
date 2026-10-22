// Boats of Lin'an, West Lake and the Qiantang, built in code.
//
//   buildBoat(type, params, { lod, ao, name }) → { group, info }      one boat (group origin on the waterline at
//                                                                     mid-length, bow toward +Z)
//   boatParts(type, params, lod) → { B: MeshBuilder (boat material), W: MeshBuilder (yingzao wood) | null, P }
//   types: 'skiff' 小船 · 'wupeng' 烏篷船 · 'cargo' 貨船 · 'huafang' 畫舫 · 'junk' 帆船 (battened lug sails)
//
// Hull: a flat-bottomed Chinese hull lofted from stations (stern s = 0 → bow s = 1): beam tapering toward the ends
// (square transoms for the junk, the cargo boat and the 畫舫, pointed ends for the 烏篷船 and the skiff), sheer rising
// to bow and stern, the bottom sweeping up (rocker), a rounded bilge; planks painted along the girth by the shader,
// gunwale rails, an inner skin and floorboards in open boats, decks in decked ones. y = 0 is the waterline.
// LOD 0 hero, 1 mid (fewer stations, simple fittings), 2 far (hull + main masses).
import * as THREE from 'three';
import { MeshBuilder, PAINT } from '../yingzao/geom.js';
import { bakeAO } from '../yingzao/ao.js';
import { hallMaterials } from '../yingzao/materials.js';
import { boatMaterial, BOAT_K as K } from './material.js';
import { RNG } from '../core/rng.js';

export const BOAT_TYPES = ['skiff', 'wupeng', 'cargo', 'huafang', 'junk'];

const DEF = {
  skiff: { L: 5.6, beam: 1.3, depth: 0.55, draft: 0.14, bow: 'pointed', stern: 'transom', bowRise: 0.28, sternRise: 0.12, rocker: 0.9, open: true },
  wupeng: { L: 8.2, beam: 1.55, depth: 0.62, draft: 0.2, bow: 'pointed', stern: 'pointed', bowRise: 0.35, sternRise: 0.25, rocker: 0.9, open: true },
  cargo: { L: 12.5, beam: 3.0, depth: 1.15, draft: 0.5, bow: 'square', stern: 'transom', bowRise: 0.45, sternRise: 0.5, rocker: 0.7, open: false },
  huafang: { L: 11, beam: 3.2, depth: 0.95, draft: 0.35, bow: 'square', stern: 'transom', bowRise: 0.3, sternRise: 0.35, rocker: 0.6, open: false },
  junk: { L: 22, beam: 5.6, depth: 2.1, draft: 1.0, bow: 'square', stern: 'transom', bowRise: 1.2, sternRise: 2.0, rocker: 0.6, open: false, mainH: 20, foreH: 14 },
};

// ------------------------------------------------------------------------------------------------ helpers
function qw(B, a, b, c, d, want, pa, uv) {
  const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
  const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
  const P = typeof pa === 'function' ? [pa(a), pa(b), pa(c), pa(d)] : [pa, pa, pa, pa];
  if (nx * want[0] + ny * want[1] + nz * want[2] >= 0) B.quad(a, b, c, d, P[0], P[1], P[2], P[3], uv);
  else B.quad(a, d, c, b, P[0], P[3], P[2], P[1], uv ? [uv[0], uv[3], uv[2], uv[1]] : null);
}
function hexa(B, c, kind, tone = 0.5) {
  const ctr = c.reduce((a, v) => [a[0] + v[0] / 8, a[1] + v[1] / 8, a[2] + v[2] / 8], [0, 0, 0]);
  const pa = (v) => [kind, v[1], tone, 0];
  const f = (i, j, k, l) => {
    const a = c[i], b = c[j], cc = c[k], d = c[l];
    const lab = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]), lad = Math.hypot(d[0] - a[0], d[1] - a[1], d[2] - a[2]);
    qw(B, a, b, cc, d, [(a[0] + cc[0]) / 2 - ctr[0], (a[1] + cc[1]) / 2 - ctr[1], (a[2] + cc[2]) / 2 - ctr[2]], pa, [[0, 0], [lab, 0], [lab, lad], [0, lad]]);
  };
  f(0, 1, 2, 3); f(4, 5, 6, 7); f(0, 1, 5, 4); f(1, 2, 6, 5); f(2, 3, 7, 6); f(3, 0, 4, 7);
}
function box(B, x0, y0, z0, x1, y1, z1, kind, tone) {
  hexa(B, [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], [x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]], kind, tone);
}
/** a round pole from p0 to p1 (radius r0 → r1) */
function pole(B, p0, p1, r0, r1, kind, segs = 6, tone = 0.5) {
  const d = new THREE.Vector3(p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]);
  const len = d.length();
  const T = new MeshBuilder();
  T.lathe([[r0, 0], [r1, len]], segs, { kind, capTop: true });
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
  const m = new THREE.Matrix4().compose(new THREE.Vector3(...p0), q, new THREE.Vector3(1, 1, 1));
  T.applyMatrix(m);
  for (let i = 0; i < T.count; i++) { T.paint[i * 4 + 1] = T.pos[i * 3 + 1]; T.paint[i * 4 + 2] = tone; T.paint[i * 4 + 3] = 0; }
  B.append(T);
}

// ------------------------------------------------------------------------------------------------ hull
export function hullShape(P) {
  const { L, beam, depth, draft, bow, stern, bowRise, sternRise, rocker } = P;
  const tb = bow === 'square' ? 0.3 : 0.38, ts = stern === 'transom' ? 0.22 : 0.36;
  const eB = bow === 'square' ? 0.5 : 0.05, eS = stern === 'transom' ? 0.58 : 0.06;
  const halfB = (s) => {
    let w = 1;
    if (s > 1 - tb) { const u = (1 - s) / tb; w = eB + (1 - eB) * Math.pow(Math.sin((u * Math.PI) / 2), 0.75); }
    else if (s < ts) { const u = s / ts; w = eS + (1 - eS) * Math.pow(Math.sin((u * Math.PI) / 2), 0.75); }
    return (beam / 2) * w;
  };
  const sm = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  const sheer = (s) => depth - draft + bowRise * sm(1 - tb * 1.2, 1, s) ** 1.5 + sternRise * sm(ts * 1.3, 0, s) ** 1.5;
  const bottom = (s) => -draft + rocker * (draft + 0.12) * (sm(0.68, 1.02, s) ** 2 * (bow === 'square' ? 0.75 : 1.05) + sm(0.3, -0.02, s) ** 2 * (stern === 'transom' ? 0.6 : 1.0));
  /** section point at girth t (0 keel … 1 gunwale), x ≥ 0 */
  const section = (s, t) => {
    const hb = halfB(s), bW = hb * 0.74, yb = bottom(s), ys = sheer(s);
    if (t <= 0.38) { const u = t / 0.38; return [bW * u, yb + 0.04 * u]; }
    const u = (t - 0.38) / 0.62;
    const P0 = [bW, yb + 0.04], P1 = [hb * 1.04, yb + 0.04 + 0.18 * (ys - yb)], P2 = [hb, ys];
    const a = (1 - u) * (1 - u), b = 2 * u * (1 - u), c = u * u;
    return [a * P0[0] + b * P1[0] + c * P2[0], a * P0[1] + b * P1[1] + c * P2[1]];
  };
  const zOf = (s) => (s - 0.5) * L;
  return { halfB, sheer, bottom, section, zOf, L };
}

function hull(B, P, lod, tone) {
  const H = hullShape(P);
  const ns = lod === 0 ? 30 : lod === 1 ? 14 : 7, nt = lod === 0 ? 9 : lod === 1 ? 5 : 3;
  const pa = (v) => [K.HULL, v[1], tone, 0];
  const grid = [];
  for (let i = 0; i <= ns; i++) {
    const s = i / ns, row = [];
    let acc = 0, prev = null;
    for (let j = 0; j <= nt; j++) {
      const [x, y] = H.section(s, j / nt);
      if (prev) acc += Math.hypot(x - prev[0], y - prev[1]);
      row.push([x, y, H.zOf(s), acc]);
      prev = [x, y];
    }
    grid.push(row);
  }
  for (const sx of [-1, 1]) {
    for (let i = 0; i < ns; i++) for (let j = 0; j < nt; j++) {
      const A = grid[i][j], Bq = grid[i + 1][j], C = grid[i + 1][j + 1], D = grid[i][j + 1];
      const v = (q) => [sx * q[0], q[1], q[2]];
      const want = j / nt < 0.38 ? [sx * 0.2, -1, 0] : [sx, -0.25, 0];
      qw(B, v(A), v(Bq), v(C), v(D), want, pa, [[A[2], A[3]], [Bq[2], Bq[3]], [C[2], C[3]], [D[2], D[3]]]);
    }
  }
  // transoms / stems
  for (const end of [0, 1]) {
    const i = end === 0 ? 0 : ns, s = end, row = grid[i];
    const want = [0, 0, end === 0 ? -1 : 1];
    const sq = end === 1 ? P.bow === 'square' : P.stern === 'transom';
    if (sq) {
      // the flat end: strips from the keel line up to the sheer, both halves
      for (let j = 0; j < nt; j++) {
        const a = row[j], b = row[j + 1];
        qw(B, [-a[0], a[1], a[2]], [a[0], a[1], a[2]], [b[0], b[1], b[2]], [-b[0], b[1], b[2]], want, pa, [[-a[0], a[1]], [a[0], a[1]], [b[0], b[1]], [-b[0], b[1]]]);
      }
    } else {
      // a stem post closing the narrow end
      const top = row[nt], bot = row[0];
      box(B, -0.07, bot[1] - 0.02, top[2] - (end ? 0.12 : -0.0), 0.07, top[1] + 0.12, top[2] + (end ? 0.06 : 0.12) * (end ? 1 : -1), K.WOOD, tone);
    }
    void s;
  }
  // gunwale rails
  for (const sx of [-1, 1]) for (let i = 0; i < ns; i++) {
    const a = grid[i][nt], b = grid[i + 1][nt];
    const ox = 0.05, h = 0.11;
    const A0 = [sx * (a[0] + ox), a[1] + 0.03, a[2]], B0 = [sx * (b[0] + ox), b[1] + 0.03, b[2]];
    qw(B, [A0[0], A0[1] - h, A0[2]], [B0[0], B0[1] - h, B0[2]], B0, A0, [sx, 0, 0], [K.WOOD, a[1], tone, 0], [[a[2], 0], [b[2], 0], [b[2], h], [a[2], h]]);
    qw(B, [sx * (a[0] - 0.04), A0[1], a[2]], [sx * (b[0] - 0.04), B0[1], b[2]], B0, A0, [0, 1, 0], [K.WOOD, a[1], tone, 0], [[a[2], 0], [b[2], 0], [b[2], 0.09], [a[2], 0.09]]);
    qw(B, [A0[0], A0[1] - h, A0[2]], [B0[0], B0[1] - h, B0[2]], [sx * b[0], B0[1] - h, b[2]], [sx * a[0], A0[1] - h, a[2]], [0, -1, 0], [K.WOOD, a[1], tone, 0], null);
  }
  if (P.open) {
    // inner skin (open boats) and floorboards
    const inset = 0.035;
    for (const sx of [-1, 1]) for (let i = 0; i < ns; i++) for (let j = Math.floor(nt * 0.4); j < nt; j++) {
      const f = (q) => [sx * Math.max(0, q[0] - inset), q[1] + (j === nt ? 0 : inset * 0.5), q[2]];
      const A = grid[i][j], Bq = grid[i + 1][j], C = grid[i + 1][j + 1], D = grid[i][j + 1];
      qw(B, f(A), f(Bq), f(C), f(D), [-sx, 0.3, 0], pa, [[A[2], A[3]], [Bq[2], Bq[3]], [C[2], C[3]], [D[2], D[3]]]);
    }
    for (let i = 0; i < ns; i++) {
      const s0 = i / ns, s1 = (i + 1) / ns;
      const y0 = H.bottom(s0) + 0.2, y1 = H.bottom(s1) + 0.2;
      const w0 = H.halfB(s0) * 0.8, w1 = H.halfB(s1) * 0.8;
      qw(B, [-w0, y0, H.zOf(s0)], [w0, y0, H.zOf(s0)], [w1, y1, H.zOf(s1)], [-w1, y1, H.zOf(s1)], [0, 1, 0], (v) => [K.DECK, v[1], tone, 0], [[-w0, H.zOf(s0)], [w0, H.zOf(s0)], [w1, H.zOf(s1)], [-w1, H.zOf(s1)]]);
    }
  }
  return H;
}

/** a deck between stations s0..s1 at `drop` below the sheer */
function deck(B, H, s0, s1, drop, lod, tone) {
  const n = Math.max(2, Math.round((s1 - s0) * (lod === 0 ? 24 : 8)));
  for (let i = 0; i < n; i++) {
    const a = s0 + ((s1 - s0) * i) / n, b = s0 + ((s1 - s0) * (i + 1)) / n;
    const ya = H.sheer(a) - drop, yb = H.sheer(b) - drop, wa = H.halfB(a) * 0.98, wb = H.halfB(b) * 0.98;
    qw(B, [-wa, ya, H.zOf(a)], [wa, ya, H.zOf(a)], [wb, yb, H.zOf(b)], [-wb, yb, H.zOf(b)], [0, 1, 0], (v) => [K.DECK, v[1], tone, 0], [[-wa, H.zOf(a)], [wa, H.zOf(a)], [wb, H.zOf(b)], [-wb, H.zOf(b)]]);
  }
}

/** an arched mat cover (篷) over stations s0..s1, the arch springing from the gunwales */
function matCover(B, H, s0, s1, rise, lod, kind = K.MAT, tone = 0.5) {
  const n = lod === 0 ? 10 : 6, m = lod === 0 ? 4 : 2;
  for (let j = 0; j < m; j++) {
    const a = s0 + ((s1 - s0) * j) / m, b = s0 + ((s1 - s0) * (j + 1)) / m;
    for (let i = 0; i < n; i++) {
      const t0 = (i / n) * Math.PI, t1 = ((i + 1) / n) * Math.PI;
      const P = (s, t) => { const w = H.halfB(s) * 1.02, y = H.sheer(s) + 0.02; return [-Math.cos(t) * w, y + Math.sin(t) * rise, H.zOf(s)]; };
      const A = P(a, t0), Bq = P(a, t1), C = P(b, t1), D = P(b, t0);
      const want = [-Math.cos((t0 + t1) / 2), Math.sin((t0 + t1) / 2), 0];
      qw(B, A, Bq, C, D, want, (v) => [kind, v[1], tone, 0], [[t0 * 1.0, H.zOf(a)], [t1 * 1.0, H.zOf(a)], [t1 * 1.0, H.zOf(b)], [t0 * 1.0, H.zOf(b)]].map(([t, z]) => [t * H.halfB((a + b) / 2), z]));
      // underside (seen from the ends)
      qw(B, A, Bq, C, D, [-want[0], -want[1], 0], (v) => [K.WOOD, v[1], tone, 0], null);
    }
  }
}

/** a battened lug sail: luff at the mast, the yard slanting up aft, battens across; returns nothing */
function lugSail(B, mastX, mastZ, foot, head, wFoot, wHead, aftShift, camber, nBat, lod, tone) {
  // the sail lies in the x = mastX plane, extends aft (−z) from the mast with an overhang forward
  const nu = lod === 0 ? 8 : 4, nv = lod === 0 ? nBat * 2 : nBat;
  const P = (u, v) => {
    const y = foot + (head - foot) * v;
    const w = wFoot + (wHead - wFoot) * v;
    const z0 = mastZ + w * 0.22 - aftShift * v;            // the luff (forward edge) a little ahead of the mast
    const z = z0 - w * u;
    const bulge = camber * Math.sin(Math.PI * u) * Math.sin(Math.PI * Math.min(1, v * 1.1 + 0.05));
    return [mastX + bulge, y, z];
  };
  for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
    const u0 = i / nu, u1 = (i + 1) / nu, v0 = j / nv, v1 = (j + 1) / nv;
    const A = P(u0, v0), Bq = P(u1, v0), C = P(u1, v1), D = P(u0, v1);
    const uv = (q, u, v) => [u * (wFoot + (wHead - wFoot) * v), q[1]];
    qw(B, A, Bq, C, D, [1, 0, 0], (q) => [K.SAIL, q[1], tone, 0], [uv(A, u0, v0), uv(Bq, u1, v0), uv(C, u1, v1), uv(D, u0, v1)]);
    qw(B, A, Bq, C, D, [-1, 0, 0], (q) => [K.SAIL, q[1], tone, 0], [uv(A, u0, v0), uv(Bq, u1, v0), uv(C, u1, v1), uv(D, u0, v1)]);
  }
  // battens (and the yard / boom at the edges)
  for (let k = 0; k <= nBat; k++) {
    const v = k / nBat;
    const segs = lod === 0 ? 4 : 2;
    for (let i = 0; i < segs; i++) {
      const a = P(i / segs, v), b = P((i + 1) / segs, v);
      const r = k === 0 || k === nBat ? 0.06 : 0.035;
      box(B, Math.min(a[0], b[0]) - r - 0.02, a[1] - r, Math.min(a[2], b[2]), Math.max(a[0], b[0]) + r + 0.02, a[1] + r, Math.max(a[2], b[2]), K.WOOD, tone);
    }
  }
}

// ------------------------------------------------------------------------------------------------ the types
export function boatParts(type, params = {}, lod = 0) {
  const P = { ...DEF[type], ...params };
  const r = new RNG(String(params.seed ?? type));
  const tone = params.tone ?? r.random();
  const B = new MeshBuilder();
  let W = null;      // lacquered / tiled parts in the yingzao materials (畫舫)
  const H = hull(B, P, lod, tone);
  const L = P.L;
  const at = (s) => H.zOf(s);
  if (type === 'skiff') {
    for (const s of [0.32, 0.6]) { const y = H.sheer(s) - 0.12, w = H.halfB(s) * 0.92; box(B, -w, y - 0.05, at(s) - 0.12, w, y, at(s) + 0.12, K.WOOD, tone); }
    // sculling oar (櫓) at the stern, trailing in the water
    pole(B, [0.1, H.sheer(0.05) + 0.15, at(0.05)], [0.5, -0.4, at(0.05) - 3.0], 0.035, 0.03, K.WOOD, 5, tone);
    if (params.sail) {
      // a small fishing sail: a mast forward and a battened lug sail (ref01's little sail boats on the lake)
      const mz = at(0.68), mh = params.mastH ?? 5.2;
      pole(B, [0, H.bottom(0.68) + 0.2, mz], [0, H.sheer(0.68) + mh, mz], 0.05, 0.035, K.WOOD, 5, tone);
      const T = new MeshBuilder();
      lugSail(T, 0.06, mz, H.sheer(0.68) + 0.6, H.sheer(0.68) + mh - 0.2, 2.6, 2.1, 0.5, 0.12, 4, lod, 0.2);
      T.applyMatrix(new THREE.Matrix4().makeTranslation(0, 0, mz).multiply(new THREE.Matrix4().makeRotationY(((params.sheet ?? 25) * Math.PI) / 180)).multiply(new THREE.Matrix4().makeTranslation(0, 0, -mz)));
      B.append(T);
    }
  } else if (type === 'wupeng') {
    matCover(B, H, 0.36, 0.5, 0.78, lod, K.MAT, tone);
    matCover(B, H, 0.52, 0.66, 0.72, lod, K.MAT, tone);
    if (r.chance(0.6)) matCover(B, H, 0.22, 0.34, 0.66, lod, K.MAT, tone);
    for (const s of [0.18, 0.75]) { const y = H.sheer(s) - 0.1, w = H.halfB(s) * 0.9; box(B, -w, y - 0.05, at(s) - 0.1, w, y, at(s) + 0.1, K.WOOD, tone); }
    pole(B, [0.15, H.sheer(0.04) + 0.25, at(0.04)], [0.7, -0.5, at(0.04) - 3.6], 0.04, 0.035, K.WOOD, 5, tone);
  } else if (type === 'cargo') {
    deck(B, H, 0, 0.3, 0.14, lod, tone);
    deck(B, H, 0.78, 1, 0.14, lod, tone);
    // the hold: cargo (sacks, jars) under a low arched mat roof
    deck(B, H, 0.3, 0.78, 0.75, lod, tone);
    const nC = lod === 0 ? 14 : 5;
    for (let i = 0; i < nC; i++) {
      const s = 0.33 + 0.42 * r.random(), w = H.halfB(s) * 0.7;
      const x = r.range(-w, w), y = H.sheer(s) - 0.75, sz = r.range(0.35, 0.6);
      box(B, x - sz * 0.6, y, at(s) - sz * 0.4, x + sz * 0.6, y + sz * 0.7, at(s) + sz * 0.4, K.CARGO, tone);
    }
    matCover(B, H, 0.4, 0.72, 1.0, lod, K.MAT, (tone + 0.4) % 1);
    // a short mast (lowered sail bundled) and the steering oar
    pole(B, [0, H.sheer(0.78) - 0.2, at(0.78)], [0, H.sheer(0.78) + 4.5, at(0.78)], 0.09, 0.06, K.WOOD, 6, tone);
    box(B, -0.15, H.sheer(0.78) + 1.0, at(0.78) - 2.2, 0.15, H.sheer(0.78) + 1.25, at(0.78) - 0.1, K.SAIL, tone);
    pole(B, [0.2, H.sheer(0.03) + 0.4, at(0.03)], [0.9, -0.6, at(0.03) - 4.0], 0.05, 0.045, K.WOOD, 5, tone);
  } else if (type === 'huafang') {
    // 畫舫: a long cabin with lacquered posts, paper lattice windows and a dark tiled 卷棚 roof, an open front deck
    deck(B, H, 0, 1, 0.08, lod, tone);
    W = new MeshBuilder();
    const s0 = 0.16, s1 = 0.8;
    const z0 = at(s0), z1 = at(s1);
    const yF = H.sheer(0.5) - 0.08, hC = 2.05, hw = H.halfB(0.5) * 0.86;
    const nb = lod === 0 ? 7 : 4;
    for (let i = 0; i <= nb; i++) {
      const z = z0 + ((z1 - z0) * i) / nb;
      for (const sx of [-1, 1]) {
        if (lod <= 1) box(W, sx * hw - 0.07, yF, z - 0.07, sx * hw + 0.07, yF + hC, z + 0.07, PAINT.ZHU, tone);
      }
    }
    // the window band (lattice), the dado below, a frieze above
    for (const sx of [-1, 1]) {
      const x = sx * hw;
      qw(B, [x, yF + 0.75, z0], [x, yF + 0.75, z1], [x, yF + hC - 0.3, z1], [x, yF + hC - 0.3, z0], [sx, 0, 0], (v) => [K.LATTICE, v[1], tone, 0], [[0, 0], [z1 - z0, 0], [z1 - z0, hC - 1.05], [0, hC - 1.05]]);
      qw(B, [x, yF, z0], [x, yF, z1], [x, yF + 0.75, z1], [x, yF + 0.75, z0], [sx, 0, 0], (v) => [K.LACQUER, v[1], tone, 0], [[0, 0], [z1 - z0, 0], [z1 - z0, 0.75], [0, 0.75]]);
      qw(B, [x, yF + hC - 0.3, z0], [x, yF + hC - 0.3, z1], [x, yF + hC, z1], [x, yF + hC, z0], [sx, 0, 0], (v) => [K.LACQUER, v[1], tone, 0], null);
    }
    for (const [z, sz] of [[z0, -1], [z1, 1]]) {
      qw(B, [-hw, yF, z], [hw, yF, z], [hw, yF + hC, z], [-hw, yF + hC, z], [0, 0, sz], (v) => [K.LATTICE, v[1], tone, 0], [[-hw, 0], [hw, 0], [hw, hC], [-hw, hC]]);
    }
    // roof: a gentle 卷棚 (rounded ridge) with eaves overhanging 0.45 m
    const ro = 0.45, nR = lod === 0 ? 8 : 4, yR = yF + hC, rr = 0.9;
    for (let i = 0; i < nR; i++) {
      const t0 = i / nR, t1 = (i + 1) / nR;
      const R = (t) => { const x = -(hw + ro) + 2 * (hw + ro) * t; const y = yR + rr * (1 - ((2 * t - 1) ** 2)) ** 0.8 - 0.1; return [x, y]; };
      const [xa, ya] = R(t0), [xb, yb] = R(t1);
      qw(B, [xa, ya, z0 - ro], [xb, yb, z0 - ro], [xb, yb, z1 + ro], [xa, ya, z1 + ro], [0, 1, 0], (v) => [K.TILE, v[1], tone, 0], [[(xa + hw) / 0.2 * 0.2, z0], [(xb + hw) / 0.2 * 0.2, z0], [(xb + hw), z1], [(xa + hw), z1]]);
      qw(B, [xa, ya - 0.08, z0 - ro], [xb, yb - 0.08, z0 - ro], [xb, yb - 0.08, z1 + ro], [xa, ya - 0.08, z1 + ro], [0, -1, 0], (v) => [K.WOOD, v[1], tone, 0], null);
    }
    for (const z of [z0 - ro, z1 + ro]) {
      const pts = [];
      for (let i = 0; i <= nR; i++) { const t = i / nR; const x = -(hw + ro) + 2 * (hw + ro) * t; pts.push([x, yR + rr * (1 - ((2 * t - 1) ** 2)) ** 0.8 - 0.1]); }
      for (let i = 0; i < nR; i++) qw(B, [pts[i][0], pts[i][1] - 0.12, z], [pts[i + 1][0], pts[i + 1][1] - 0.12, z], [pts[i + 1][0], pts[i + 1][1], z], [pts[i][0], pts[i][1], z], [0, 0, z > 0 ? 1 : -1], (v) => [K.LACQUER, v[1], tone, 0], null);
    }
    // railings on the front deck
    if (lod <= 1) for (const sx of [-1, 1]) {
      const x = sx * H.halfB(0.9) * 0.9;
      box(B, x - 0.03, yF + 0.5, z1 + 0.2, x + 0.03, yF + 0.58, at(0.96), K.LACQUER, tone);
      for (let k = 0; k < 4; k++) { const z = z1 + 0.25 + ((at(0.95) - z1) * k) / 3; box(B, x - 0.03, yF, z - 0.03, x + 0.03, yF + 0.58, z + 0.03, K.LACQUER, tone); }
    }
  } else if (type === 'junk') {
    // 沙船-type river junk: decks, a stern house, two masts with battened lug sails, a big rudder
    deck(B, H, 0, 1, 0.16, lod, tone);
    const sh = 0.12, yD = (s) => H.sheer(s) - 0.16;
    // stern house
    const zs0 = at(0.03), zs1 = at(0.24), hw = H.halfB(0.14) * 0.8;
    box(B, -hw, yD(0.14), zs0, hw, yD(0.14) + 1.9, zs1, K.WOOD, tone);
    box(B, -hw - 0.25, yD(0.14) + 1.9, zs0 - 0.3, hw + 0.25, yD(0.14) + 2.05, zs1 + 0.3, K.MAT, tone);
    // hatch covers amidships
    for (const s of [0.38, 0.5, 0.62]) { const w = H.halfB(s) * 0.55; box(B, -w, yD(s), at(s) - 1.3, w, yD(s) + 0.45, at(s) + 1.3, K.WOOD, tone); }
    // masts and sails
    const mainZ = at(0.56), foreZ = at(0.84);
    const mainH = P.mainH ?? 15, foreH = P.foreH ?? 10.5;
    pole(B, [0, yD(0.56) - 0.5, mainZ], [0, yD(0.56) + mainH, mainZ], 0.17, 0.09, K.WOOD, lod === 0 ? 8 : 5, tone);
    pole(B, [0, yD(0.84) - 0.4, foreZ], [0, yD(0.84) + foreH, foreZ - 0.4], 0.13, 0.07, K.WOOD, lod === 0 ? 8 : 5, tone);
    const furled = params.furled ?? false;
    if (!furled) {
      // the sails sheeted out to one side (rotated about the masts), as when reaching up the river
      const sheet = ((params.sheet ?? 32) * Math.PI) / 180;
      const sail = (mz, build) => {
        const T = new MeshBuilder();
        build(T);
        const m = new THREE.Matrix4().makeTranslation(0, 0, mz).multiply(new THREE.Matrix4().makeRotationY(sheet)).multiply(new THREE.Matrix4().makeTranslation(0, 0, -mz));
        T.applyMatrix(m);
        B.append(T);
      };
      const sw = P.L / 18;
      sail(mainZ, (T) => lugSail(T, 0.25, mainZ, yD(0.56) + 1.6, yD(0.56) + mainH - 0.6, 7.6 * sw, 6.2 * sw, 1.6 * sw, 0.35, 7, lod, tone));
      sail(foreZ, (T) => lugSail(T, 0.2, foreZ, yD(0.84) + 1.2, yD(0.84) + foreH - 0.5, 4.8 * sw, 3.9 * sw, 1.0 * sw, 0.25, 5, lod, (tone + 0.3) % 1));
    } else {
      box(B, -0.25, yD(0.56) + 1.6, mainZ - 6.5, 0.25, yD(0.56) + 2.2, mainZ + 0.8, K.SAIL, tone);
    }
    // rudder below the transom
    box(B, -0.08, -1.4, zs0 - 1.0, 0.08, H.sheer(0) - 0.3, zs0 - 0.1, K.WOOD, tone);
    pole(B, [0, H.sheer(0) + 0.3, zs0 - 0.3], [0, H.sheer(0) + 0.6, zs0 + 2.0], 0.06, 0.05, K.WOOD, 5, tone);
    void sh;
  }
  return { B, W, P, H, tone };
}

export function buildBoat(type, params = {}, { lod = 0, ao = true, name = type } = {}) {
  const t0 = performance.now();
  const { B, W, P } = boatParts(type, params, lod);
  if (ao && lod <= 1) {
    const occ = [{ B }, ...(W && W.count ? [{ B: W }] : [])];
    bakeAO({ targets: occ, occluders: occ, cell: lod === 0 ? 0.06 : 0.12, coarse: 0.25, near: 0.6, far: 3.5, upFar: 8 });
  }
  const g = new THREE.Group(); g.name = name;
  const m = new THREE.Mesh(B.toGeometry(), boatMaterial());
  m.name = name + ':boat'; m.castShadow = true; m.receiveShadow = true;
  g.add(m);
  if (W && W.count) { const w = new THREE.Mesh(W.toGeometry(), hallMaterials().wood); w.name = name + ':lacquer'; w.castShadow = true; w.receiveShadow = true; g.add(w); }
  const tris = (B.count + (W?.count || 0)) / 3;
  return { group: g, info: { ms: Math.round(performance.now() - t0), tris: Math.round(tris), params: P } };
}
