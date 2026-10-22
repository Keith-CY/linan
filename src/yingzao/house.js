// Shop houses and dwellings of Lin'an (two storeys, 悬山 or 歇山 roofs), for the city by the thousand.
// Commoners' buildings sit outside the 法式's 殿閣 rules: no bracket sets (卷五 · 柱: 餘屋 columns 一材一栔至兩材),
// 瓪瓦 roofs (卷十三: 廊屋 / 餘屋 用瓪瓦) on the 瓪瓦廊屋 舉 (D/4 + 3 %, 卷五 · 舉折), timber frame with lime-washed
// infill, plank shutters (排門) on the shop front, an upper floor with a lattice window band or a small balcony,
// cloth 幌子 signs. Proportions after the street of the 清明上河圖 (approx.).
//
//   buildHouse({ width, depth, storeys, roof, front, pent, seed }, { lod })  → { group, info }   (one house)
//   houseKit({ lod, variants, seed, overrides })                          → kit (shared geometry per variant);
//                                       overrides: one object for every variant, or (i) => object / an array per variant
//   instanceHouses(kit, [{ x, y?, z, rot, variant, sx?, sz?, sy? }], { name, castShadow }) → THREE.Group of InstancedMeshes
// Roofs: 'xuanshan' 悬山 (two slopes, gables overhanging) or 'xieshan' 歇山 (hipped skirt all round, small 山花
// gables set back under a short upper roof, hip ridges, slightly lifted corners). pent: a 腰檐 lean-to roof over the
// ground-floor shop front of a two-storey house (清明上河圖 / ref07).
// LODs: 0 ≈ 3–6k triangles (frame, shutters, lattice, eave tiles painted, ridge), 1 ≈ 400–700, 2 ≈ 60–90.
// Origin at the ground in the middle of the plan, the shop front toward +Z. Night: openings glow (GLOW); snow and
// weathering come from the shared building materials.
import * as THREE from 'three';
import { MeshBuilder, PAINT } from './geom.js';
import { wallSlab, beam, polyCap, quadOut } from './body.js';
import { hallMaterials } from './materials.js';
import { bakeAO } from './ao.js';
import { RNG } from '../core/rng.js';
import * as O from './ornaments.js';

const FAMILIES = ['wood', 'plaster', 'stone', 'tile', 'glow', 'dark'];

/** resolve the parameters of one house (seeded variation) */
export function houseParams(o = {}) {
  const r = new RNG(String(o.seed ?? 'house'));
  const storeys = o.storeys ?? (r.chance(0.82) ? 2 : 1);
  const P = {
    width: o.width ?? r.range(4.6, 8.2),
    depth: o.depth ?? r.range(7.5, 11),
    storeys,
    h1: o.h1 ?? r.range(3.0, 3.5),
    h2: o.h2 ?? r.range(2.4, 2.8),
    roof: o.roof ?? (r.chance(0.12) ? 'xieshan' : 'xuanshan'),
    pitch: o.pitch ?? r.range(0.5, 0.62),            // rise / half span (瓪瓦廊屋 舉 ≈ 0.26 D → 0.52)
    eave: o.eave ?? r.range(0.75, 1.05),
  };
  P.front = o.front ?? r.pick(['shop', 'shop', 'shop', 'open', 'house']);
  P.upper = o.upper ?? r.pick(['lattice', 'lattice', 'balcony', 'wall']);
  P.jetty = o.jetty ?? (r.chance(0.35) ? 0.55 : 0);    // the upper floor projecting over the street
  P.banner = o.banner ?? r.chance(0.45);
  P.seed = o.seed ?? 'house';
  P.ridge = o.ridge ?? null;                          // 'width' keeps a 歇山 ridge along the front even on a deep plot
  // 腰檐 over the shop front (two storeys, not with a jettied upper floor)
  P.pent = o.pent ?? (storeys > 1 && P.front !== 'house' && r.chance(0.7));
  if (P.pent && o.jetty === undefined) P.jetty = 0;
  if (P.pent && P.upper === 'balcony' && o.upper === undefined) P.upper = 'lattice';
  return P;
}

/** build the parts (family → MeshBuilder) of one house at a LOD */
export function houseParts(P, lod = 1) {
  const B = Object.fromEntries(FAMILIES.map((k) => [k, new MeshBuilder()]));
  const { width: w, depth: d, storeys, h1, h2, pitch, eave, jetty } = P;
  const hx = w / 2, hz = d / 2;
  const plinth = lod >= 2 ? 0 : 0.22;
  const H = plinth + h1 + (storeys > 1 ? h2 : 0);       // eave line (top of the walls)
  const post = 0.2, wallT = lod >= 2 ? 0.001 : 0.16;
  const r = new RNG(String(P.seed) + ':parts');
  // ---- plinth
  if (lod <= 1) B.stone.box(-hx - 0.12, -0.3, -hz - 0.12, hx + 0.12, plinth, hz + 0.12, PAINT.STONE, 'x');
  // ---- walls: whitewash with a timber frame; the front is built separately
  const yW = plinth;
  const wall = (a, b, h, y0 = yW) => wallSlab(B.plaster, a, b, h, wallT, PAINT.WHITEWASH, { cell: lod ? 2.5 : 0.8, y0, sides: lod >= 2 ? [1] : [1, -1], ends: false, top: false });
  wall([hx, 0, hz], [hx, 0, -hz], H - yW);       // right side (wall direction → outward normal +x)
  wall([-hx, 0, -hz], [-hx, 0, hz], H - yW);     // left side
  wall([hx, 0, -hz], [-hx, 0, -hz], H - yW);     // back
  if (lod >= 2) {
    // a flat front painted by the shaders: plank shutters below (LATTICE reads as a panelled front), plaster above
    B.wood.quadGrid([-hx, yW, hz], [hx, yW, hz], [hx, yW + h1, hz], [-hx, yW + h1, hz], 1, 1, () => [PAINT.LATTICE, 0, h1, 0], (u, v) => [u * w, v * h1]);
    if (storeys > 1) B.plaster.quadGrid([-hx, yW + h1, hz], [hx, yW + h1, hz], [hx, H, hz], [-hx, H, hz], 1, 1, () => [PAINT.WHITEWASH, 0, h2, 0]);
  } else {
    // corner and front posts, girts at the floor line
    const posts = [-hx, hx];
    const nBays = Math.max(1, Math.round(w / 3.2));
    for (let i = 1; i < nBays; i++) posts.push(-hx + (w * i) / nBays);
    for (const x of posts) B.wood.box(x - post / 2, yW, hz - post / 2, x + post / 2, H, hz + post / 2, PAINT.WOOD, 'x');
    for (const [x, z] of [[hx, -hz], [-hx, -hz]]) B.wood.box(x - post / 2, yW, z - post / 2, x + post / 2, H, z + post / 2, PAINT.PLANK, 'x');
    if (lod === 0) for (const x of [hx, -hx]) for (let k = 1; k < Math.round(d / 2.6); k++) { const z = -hz + (d * k) / Math.round(d / 2.6); B.wood.box(x - 0.07, yW, z - 0.07, x + 0.07, H, z + 0.07, PAINT.PLANK, 'z'); }
    for (const x of [hx + 0.05, -hx - 0.05]) B.wood.box(x - 0.06, yW + h1 - 0.12, -hz, x + 0.06, yW + h1 + 0.1, hz, PAINT.PLANK, 'z');
    B.wood.box(-hx, yW + h1 - 0.15, hz - 0.12, hx, yW + h1 + 0.12, hz + 0.12, PAINT.WOOD, 'x'); // floor beam over the shop front
    // ---- shop front bays
    for (let i = 0; i < posts.length - 1; i++) {
      const xs = [...posts].sort((a, b) => a - b);
      const xa = xs[i] + post / 2, xb = xs[i + 1] - post / 2;
      const y0 = yW, y1 = yW + h1 - 0.15;
      const kind = P.front === 'house' ? 'door' : P.front === 'open' || (P.front === 'shop' && i === Math.floor((xs.length - 2) / 2)) ? 'open' : 'shutter';
      if (kind === 'open') {
        // an open shop bay: the lamplit room behind, a counter, the shutter boards stacked at the side
        B.glow.quad([xa, y0, hz - 1.2], [xb, y0, hz - 1.2], [xb, y1, hz - 1.2], [xa, y1, hz - 1.2], [PAINT.GLOW, 1, h1, 0]);
        B.dark.quad([xa, y1, hz - 1.2], [xb, y1, hz - 1.2], [xb, y1, hz], [xa, y1, hz], [PAINT.DARK, 0, 1, 0]);
        B.wood.box(xa + 0.1, y0, hz - 0.55, xb - 0.1, y0 + 0.95, hz - 0.15, PAINT.PLANK, 'x');
        for (const sx of [xa, xb - 0.12]) B.dark.quad([sx, y0, hz - 0.01], [sx + 0.12, y0, hz - 0.01], [sx + 0.12, y1, hz - 0.01], [sx, y1, hz - 0.01], [PAINT.DARK, 0, 1, 0]);
      } else if (kind === 'shutter') {
        // 排門: vertical boards in a track
        B.glow.quad([xa, y0, hz - 0.12], [xb, y0, hz - 0.12], [xb, y1, hz - 0.12], [xa, y1, hz - 0.12], [PAINT.GLOW, 1, h1, 0]);
        const n = lod === 0 ? Math.max(3, Math.round((xb - xa) / 0.38)) : 1;
        for (let k = 0; k < n; k++) {
          if (lod === 0 && r.chance(0.12)) continue; // a board or two taken down
          const a = xa + ((xb - xa) * k) / n + 0.006, b = xa + ((xb - xa) * (k + 1)) / n - 0.006;
          B.wood.box(a, y0 + 0.05, hz - 0.08, b, y1, hz - 0.03, lod === 0 ? PAINT.PLANK : PAINT.LATTICE, 'x');
        }
      } else {
        wall([xa, 0, hz], [xb, 0, hz], h1 - 0.15);
        const dw = Math.min(1.4, xb - xa - 0.4), mx = (xa + xb) / 2;
        B.glow.quad([mx - dw / 2, y0, hz + 0.09], [mx + dw / 2, y0, hz + 0.09], [mx + dw / 2, y0 + 2.1, hz + 0.09], [mx - dw / 2, y0 + 2.1, hz + 0.09], [PAINT.GLOW, 1, 2.1, 0]);
        B.wood.box(mx - dw / 2, y0, hz + 0.1, mx - dw / 2 + dw * 0.46, y0 + 2.05, hz + 0.14, PAINT.PLANK, 'x');
      }
    }
    // ---- upper floor front (jettied out over the street when jetty > 0)
    if (storeys > 1) {
      const zf = hz + jetty, ya = yW + h1, yb = H;
      if (jetty > 0) {
        for (const x of [-hx + 0.3, hx - 0.3, 0]) B.wood.box(x - 0.07, ya - 0.18, hz - 0.3, x + 0.07, ya, zf + 0.1, PAINT.PLANK, 'z');  // joists
        B.wood.box(-hx, ya - 0.05, hz, hx, ya + 0.05, zf, PAINT.PLANK, 'x');
        for (const x of [-hx, hx]) B.plaster.quad(...(x > 0 ? [[x, ya, zf], [x, ya, hz], [x, yb, hz], [x, yb, zf]] : [[x, ya, hz], [x, ya, zf], [x, yb, zf], [x, yb, hz]]), [PAINT.WHITEWASH, 0, h2, 0]);
      }
      if (P.upper === 'wall') {
        wall([-hx, 0, zf], [hx, 0, zf], h2, ya);
        const ww = Math.min(1.4, w * 0.3);
        B.glow.quad([-ww / 2, ya + 0.9, zf + 0.09], [ww / 2, ya + 0.9, zf + 0.09], [ww / 2, ya + 1.8, zf + 0.09], [-ww / 2, ya + 1.8, zf + 0.09], [PAINT.GLOW, 1, 0.9, 0]);
        B.wood.box(-ww / 2 - 0.05, ya + 0.85, zf + 0.08, ww / 2 + 0.05, ya + 0.9, zf + 0.14, PAINT.WOOD, 'x');
      } else {
        // a band of lattice windows (or doors onto a balcony) between the posts, plaster below
        const sill = P.upper === 'balcony' ? 0.05 : 0.8;
        if (sill > 0.1) wall([-hx, 0, zf], [hx, 0, zf], sill, ya);
        B.glow.quad([-hx + 0.1, ya + sill, zf - 0.06], [hx - 0.1, ya + sill, zf - 0.06], [hx - 0.1, yb - 0.25, zf - 0.06], [-hx + 0.1, ya + sill, zf - 0.06].map((v, i) => (i === 1 ? yb - 0.25 : v)), [PAINT.GLOW, 1, h2, 0]);
        const nW = Math.max(2, Math.round(w / 0.9));
        for (let k = 0; k < nW; k++) {
          const a = -hx + 0.1 + ((w - 0.2) * k) / nW + 0.02, b = -hx + 0.1 + ((w - 0.2) * (k + 1)) / nW - 0.02;
          if (r.chance(0.3) && lod === 0) continue; // a leaf swung open
          B.wood.box(a, ya + sill, zf - 0.04, b, yb - 0.25, zf - 0.01, PAINT.LATTICE, 'x');
        }
        wall([-hx, 0, zf], [hx, 0, zf], 0.25, yb - 0.25);
        if (P.upper === 'balcony') {
          const zb = zf + 0.7;
          B.wood.box(-hx, ya - 0.08, zf, hx, ya, zb, PAINT.PLANK, 'x');
          for (let k = 0; k <= Math.round(w / 0.9); k++) { const x = -hx + (w * k) / Math.round(w / 0.9); B.wood.box(x - 0.03, ya, zb - 0.06, x + 0.03, ya + 0.95, zb, PAINT.WOOD, 'x'); }
          B.wood.box(-hx, ya + 0.9, zb - 0.07, hx, ya + 0.98, zb + 0.01, PAINT.WOOD, 'x');
          if (lod === 0) for (let k = 0; k < Math.round(w / 0.18); k++) { const x = -hx + (w * (k + 0.5)) / Math.round(w / 0.18); B.wood.box(x - 0.012, ya + 0.1, zb - 0.04, x + 0.012, ya + 0.85, zb - 0.02, PAINT.WOOD, 'x'); }
        }
      }
    }
    // ---- cloth sign (幌子) on a pole at the front corner
    if (P.banner && lod <= 1) {
      const x = (r.chance(0.5) ? 1 : -1) * (hx - 0.3), y0 = yW + h1 * 0.95;
      B.wood.box(x - 0.03, y0, hz, x + 0.03, y0 + 0.06, hz + 1.1, PAINT.PLANK, 'z');
      const bw = 0.55, bh = r.range(1.4, 2.2);
      B.glow.quad([x - 0.012, y0 - bh, hz + 0.95 - bw], [x - 0.012, y0 - bh, hz + 0.95], [x - 0.012, y0, hz + 0.95], [x - 0.012, y0, hz + 0.95 - bw], [PAINT.PAPER, 0, 1, 0]);
      B.glow.quad([x + 0.012, y0 - bh, hz + 0.95], [x + 0.012, y0 - bh, hz + 0.95 - bw], [x + 0.012, y0, hz + 0.95 - bw], [x + 0.012, y0, hz + 0.95], [PAINT.PAPER, 0, 1, 0]);
    }
  }
  if (P.pent && storeys > 1 && lod <= 1) pentRoof(B, P, lod);
  roof(B, P, H, lod);
  return B;
}

/** quad with its normal turned toward `want` */
function qw(Bf, a, b, c, d, want, pa, uv) {
  const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
  const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
  const P = Array.isArray(pa[0]) ? pa : [pa, pa, pa, pa];
  if (nx * want[0] + ny * want[1] + nz * want[2] >= 0) Bf.quad(a, b, c, d, P[0], P[1], P[2], P[3], uv);
  else Bf.quad(a, d, c, b, P[0], P[3], P[2], P[1], uv ? [uv[0], uv[3], uv[2], uv[1]] : null);
}

/** 腰檐: a lean-to tiled roof over the ground-floor shop front, at the floor line */
function pentRoof(B, P, lod) {
  const { width: w, depth: d, h1 } = P;
  const hx = w / 2, hz = d / 2;
  const plinth = lod >= 2 ? 0 : 0.22;
  const y0 = plinth + h1;
  const out = 1.3, yTop = y0 + 0.4, yLow = y0 - 0.22, X = hx + 0.14;
  const run = Math.hypot(out, yTop - yLow);
  const rows = Math.max(2, Math.round((2 * X) / 0.24));
  const T = (sv) => [PAINT.TILE, 1, 0, sv];
  const A = [-X, yLow, hz + out], Bp = [X, yLow, hz + out], C = [X, yTop, hz + 0.02], D = [-X, yTop, hz + 0.02];
  qw(B.tile, A, Bp, C, D, [0, 1, 1], [T(0), T(0), T(run), T(run)], [[0, 0], [rows, 0], [rows, run], [0, run]]);
  const dn = 0.12;
  qw(B.wood, [A[0], A[1] - dn, A[2]], [Bp[0], Bp[1] - dn, Bp[2]], [C[0], C[1] - dn, C[2]], [D[0], D[1] - dn, D[2]], [0, -1, -0.3], [PAINT.PLANK, 0, 1, 0]);
  // fascia and the two end boards
  qw(B.wood, [-X, yLow - 0.16, hz + out], [X, yLow - 0.16, hz + out], [X, yLow, hz + out], [-X, yLow, hz + out], [0, 0, 1], [PAINT.PLANK, 0, 0.16, 0]);
  for (const sx of [-1, 1]) qw(B.wood, [sx * X, yLow - 0.16, hz + out], [sx * X, yTop - dn, hz], [sx * X, yTop, hz], [sx * X, yLow, hz + out], [sx, 0, 0], [PAINT.PLANK, 0, 0.2, 0]);
  if (lod === 0) {
    // brackets (挑木) under the pent roof at the posts
    for (const x of [-hx + 0.1, 0, hx - 0.1]) B.wood.box(x - 0.05, y0 - 0.32, hz, x + 0.05, y0 - 0.2, hz + out * 0.85, PAINT.PLANK, 'z');
    const n = Math.round((2 * X) / 0.24);
    for (let i = 0; i < n; i++) { const x = -X + (2 * X * (i + 0.5)) / n; B.tile.box(x - 0.09, yLow - 0.05, hz + out - 0.02, x + 0.09, yLow + 0.03, hz + out + 0.03, PAINT.EAVE_TILE, 'x'); }
  }
}

/** 悬山 or 歇山 (P.roof) */
function roof(B, P, H, lod) {
  if (P.roof === 'xieshan' && P.width > 3.2) {
    // a deep plot: the ridge runs front to back and the 山花 faces the street (ref07)
    if (P.depth > P.width * 1.15 && P.ridge !== 'width') {
      const T = Object.fromEntries(FAMILIES.map((k) => [k, new MeshBuilder()]));
      roofXieshan(T, { ...P, width: P.depth, depth: P.width }, H, lod);
      const m = new THREE.Matrix4().makeRotationY(Math.PI / 2);
      for (const k of FAMILIES) if (T[k].count) B[k].append(T[k], m);
      return;
    }
    return roofXieshan(B, P, H, lod);
  }
  return roofXuanshan(B, P, H, lod);
}

/**
 * 歇山: a hipped skirt all round (front, back and both ends, corners lifted a little), above it a short gable roof whose
 * 山花 stand set back over the ends, 博脊 at the gable feet, 戧脊 hip ridges, the main ridge with lifted ends.
 * Rows painted by the tile shader (vPaint.y 1); aUV = (row count across, slope length from the eave).
 */
function roofXieshan(B, P, H, lod) {
  const { width: w, depth: d, pitch, eave } = P;
  const hx = w / 2, hz = d / 2;
  const Ze = hz + eave, Xe = hx + eave;
  const ye = H - eave * pitch * 0.8;
  const yR = H + pitch * hz + 0.18;
  const k = (yR - ye) / Ze;
  const zG = Ze * 0.46, run = Ze - zG, yG = ye + k * run;
  const Xg = Math.max(hx * 0.32, Xe - run);
  const gO = lod >= 2 ? 0.2 : 0.38;
  const lift = 0.4; // the refs' corners lift more (every LOD, for the silhouette)
  const sl = Math.sqrt(1 + k * k);
  const T = (sv) => (lod >= 2 ? [PAINT.CERAMIC, 0, 1, 0] : [PAINT.TILE, 1, 0, sv]);
  const nAcross = lod === 0 ? 6 : 3, nUp = lod === 0 ? 3 : 1;
  const liftX = (x) => lift * Math.max(0, 1 - (Xe - Math.abs(x)) / 2.4) ** 2;
  const liftZ = (z) => lift * Math.max(0, 1 - (Ze - Math.abs(z)) / 2.4) ** 2;
  const dn = 0.14;
  for (const sz of [-1, 1]) {
    // lower band: trapezoid from the eave to the gable foot
    const pt = (u, t) => { const X = Xe - (Xe - Xg) * t; const x = u * X; return [x, ye + k * run * t + liftX(x) * (1 - t), sz * (Ze - run * t)]; };
    for (let j = 0; j < nUp; j++) for (let i = 0; i < nAcross; i++) {
      const u0 = -1 + (2 * i) / nAcross, u1 = -1 + (2 * (i + 1)) / nAcross, t0 = j / nUp, t1 = (j + 1) / nUp;
      const A = pt(u0, t0), Bp = pt(u1, t0), C = pt(u1, t1), D = pt(u0, t1);
      const uv = (q, t) => [(q[0] + Xe) / 0.24, run * t * sl];
      qw(B.tile, A, Bp, C, D, [0, 1, sz], [T(run * t0 * sl), T(run * t0 * sl), T(run * t1 * sl), T(run * t1 * sl)], [uv(A, t0), uv(Bp, t0), uv(C, t1), uv(D, t1)]);
      if (lod <= 1) qw(B.wood, [A[0], A[1] - dn, A[2]], [Bp[0], Bp[1] - dn, Bp[2]], [C[0], C[1] - dn, C[2]], [D[0], D[1] - dn, D[2]], [0, -1, -sz], [PAINT.PLANK, 0, 1, 0]);
    }
    // upper band: the short gable roof between the 山花
    const Xu = Xg + gO;
    const nU = lod === 0 ? 2 : 1;
    for (let i = 0; i < nAcross; i++) for (let j = 0; j < nU; j++) {
      const x0 = -Xu + (2 * Xu * i) / nAcross, x1 = -Xu + (2 * Xu * (i + 1)) / nAcross;
      const za = zG * (1 - j / nU), zb = zG * (1 - (j + 1) / nU);
      const ya = yG + k * (zG - za), yb = yG + k * (zG - zb);
      const sa = (run + zG - za) * sl, sb = (run + zG - zb) * sl;
      qw(B.tile, [x0, ya, sz * za], [x1, ya, sz * za], [x1, yb, sz * zb], [x0, yb, sz * zb], [0, 1, sz], [T(sa), T(sa), T(sb), T(sb)], [[(x0 + Xe) / 0.24, sa], [(x1 + Xe) / 0.24, sa], [(x1 + Xe) / 0.24, sb], [(x0 + Xe) / 0.24, sb]]);
      if (lod <= 1) qw(B.wood, [x0, ya - dn, sz * za], [x1, ya - dn, sz * za], [x1, yb - dn, sz * zb], [x0, yb - dn, sz * zb], [0, -1, -sz], [PAINT.PLANK, 0, 1, 0]);
    }
    // fascia along the front / back eave
    if (lod <= 1) {
      const E = (u) => pt(u, 0);
      for (let i = 0; i < nAcross; i++) {
        const a = E(-1 + (2 * i) / nAcross), b = E(-1 + (2 * (i + 1)) / nAcross);
        qw(B.wood, [a[0], a[1] - 0.16, a[2]], [b[0], b[1] - 0.16, b[2]], b, a, [0, 0, sz], [PAINT.PLANK, 0, 0.16, 0]);
      }
    }
    if (lod === 0) {
      const n = Math.round((2 * Xe) / 0.24);
      for (let i = 0; i < n; i++) { const x = -Xe + (2 * Xe * (i + 0.5)) / n, y = ye + liftX(x); B.tile.box(x - 0.09, y - 0.05, sz * Ze - 0.03, x + 0.09, y + 0.03, sz * Ze + 0.03, PAINT.EAVE_TILE, 'x'); }
    }
  }
  for (const sx of [-1, 1]) {
    // hip skirt at the end
    const pt = (u, t) => { const Z = Ze - (Ze - zG) * t; const z = u * Z; return [sx * (Xe - (Xe - Xg) * t), ye + k * run * t + liftZ(z) * (1 - t), z]; };
    const nA = Math.max(1, Math.round(nAcross * 0.7));
    for (let j = 0; j < nUp; j++) for (let i = 0; i < nA; i++) {
      const u0 = -1 + (2 * i) / nA, u1 = -1 + (2 * (i + 1)) / nA, t0 = j / nUp, t1 = (j + 1) / nUp;
      const A = pt(u0, t0), Bp = pt(u1, t0), C = pt(u1, t1), D = pt(u0, t1);
      const runX = Xe - Xg, slX = Math.hypot(runX, k * run) / Math.max(runX, 1e-3);
      const uv = (q, t) => [(q[2] + Ze) / 0.24, runX * t * slX];
      qw(B.tile, A, Bp, C, D, [sx, 1, 0], [T(runX * t0 * slX), T(runX * t0 * slX), T(runX * t1 * slX), T(runX * t1 * slX)], [uv(A, t0), uv(Bp, t0), uv(C, t1), uv(D, t1)]);
      if (lod <= 1) qw(B.wood, [A[0], A[1] - dn, A[2]], [Bp[0], Bp[1] - dn, Bp[2]], [C[0], C[1] - dn, C[2]], [D[0], D[1] - dn, D[2]], [-sx, -1, 0], [PAINT.PLANK, 0, 1, 0]);
    }
    if (lod <= 1) {
      for (let i = 0; i < nA; i++) {
        const a = pt(-1 + (2 * i) / nA, 0), b = pt(-1 + (2 * (i + 1)) / nA, 0);
        qw(B.wood, [a[0], a[1] - 0.16, a[2]], [b[0], b[1] - 0.16, b[2]], b, a, [sx, 0, 0], [PAINT.PLANK, 0, 0.16, 0]);
      }
    }
    // 山花: the gable triangle set back over the end, plastered, with its 搏風版 boards
    const x = sx * Xg;
    quadOut(B.plaster, [x, yG, zG], [x, yG, -zG], [x, yR - 0.12, 0], [x, yR - 0.12, 0], [0, yG, 0], [PAINT.WHITEWASH, 0, 2, 0]);
    if (lod <= 1) {
      const xs = sx * (Xg + gO + 0.012);
      for (const sz of [-1, 1]) quadOut(B.wood, [xs, yG - 0.24, sz * zG], [xs, yR - 0.22, 0], [xs, yR + 0.04, 0], [xs, yG + 0.02, sz * zG], [0, yG, 0], [PAINT.PLANK, 0, 0.26, 0]);
      // 博脊 along the foot of the 山花
      B.tile.box(Math.min(x, x + sx * 0.25), yG - 0.02, -zG, Math.max(x, x + sx * 0.25), yG + 0.2, zG, PAINT.RIDGE, 'z');
      // 戧脊 hip ridges from the lifted corners up to the gable feet
      for (const sz of [-1, 1]) beam(B.tile, [sx * Xe, ye + lift + 0.17, sz * Ze], [sx * Xg, yG + 0.17, sz * zG], 0.2, 0.22, PAINT.RIDGE);
    }
  }
  // main ridge with lifted ends
  const rh = lod >= 2 ? 0.32 : 0.46, rw = 0.36, Xr = Xg + gO + 0.05;
  B.tile.box(-Xr, yR - 0.12, -rw / 2 - 0.06, Xr, yR + 0.1, rw / 2 + 0.06, PAINT.RIDGE, 'x');
  B.tile.box(-Xr + 0.05, yR + 0.1, -rw / 2, Xr - 0.05, yR + rh, rw / 2, PAINT.RIDGE, 'x');
  if (lod <= 1) for (const sx of [-1, 1]) {
    const x0 = sx * Xr;
    B.tile.box(Math.min(x0, x0 + sx * 0.42), yR + rh - 0.06, -rw * 0.42, Math.max(x0, x0 + sx * 0.42), yR + rh + 0.34, rw * 0.42, PAINT.RIDGE, 'x');
    B.tile.box(Math.min(x0 + sx * 0.3, x0 + sx * 0.55), yR + rh + 0.2, -rw * 0.3, Math.max(x0 + sx * 0.3, x0 + sx * 0.55), yR + rh + 0.5, rw * 0.3, PAINT.RIDGE, 'x');
  }
}

/** 悬山 (two slopes, the gables overhanging); 瓪瓦 field painted with rows (tile shader, vPaint.y 1) */
function roofXuanshan(B, P, H, lod) {
  const { width: w, depth: d, pitch, eave } = P;
  const hx = w / 2, hz = d / 2;
  const over = lod >= 2 ? 0.35 : 0.5;                  // gable overhang (出際)
  const rise = pitch * hz;
  const ridgeY = H + rise + 0.18;
  const X = hx + over;
  const sag = (t) => -0.12 * Math.sin(Math.PI * t);     // the slight concave sweep of a 舉折 line
  const nd = lod >= 2 ? 1 : lod === 1 ? 3 : 6;
  // the refs' houses have a gentle southern curl — the eave and the ridge rise toward the gable ends
  // (every LOD, so the far roofs keep the silhouette); curl(x, t) is the lift (m) at along-x and up-slope t
  const cEave = P.curl ?? 0.32, cRidge = cEave * 0.7;
  const curl = (x, t) => { const u = Math.min(1, Math.abs(x) / X); return (cEave * (1 - t) + cRidge * t) * u * u * u; };
  const nx = lod >= 2 ? 4 : 8;
  const slope = (sz) => {
    // from the eave (z = sz·(hz + eave)) up to the ridge (z = 0)
    const pts = [];
    for (let i = 0; i <= nd; i++) {
      const t = i / nd;
      const z = sz * (hz + eave) * (1 - t), y = H - eave * pitch * 0.8 + (ridgeY - (H - eave * pitch * 0.8)) * t + sag(t) * (lod >= 2 ? 0 : 1);
      pts.push([z, y]);
    }
    const rows = Math.max(2, Math.round((2 * X) / 0.24));
    for (let i = 0; i < nd; i++) {
      const [z0, y0] = pts[i], [z1, y1] = pts[i + 1];
      const s0 = Math.hypot(z0 - pts[0][0], y0 - pts[0][1]), s1 = Math.hypot(z1 - pts[0][0], y1 - pts[0][1]);
      const t0 = i / nd, t1 = (i + 1) / nd;
      const pa = (s) => (lod >= 2 ? [PAINT.CERAMIC, 0, 1, 0] : [PAINT.TILE, 1, 0, s]);
      const dn = 0.14;
      for (let j = 0; j < nx; j++) {
        const xa = -X + (2 * X * j) / nx, xb = -X + (2 * X * (j + 1)) / nx;
        const A = [xa, y0 + curl(xa, t0), z0], Bp = [xb, y0 + curl(xb, t0), z0], C = [xb, y1 + curl(xb, t1), z1], D = [xa, y1 + curl(xa, t1), z1];
        const ua = (rows * j) / nx, ub = (rows * (j + 1)) / nx;
        const uv = [[ua, s0], [ub, s0], [ub, s1], [ua, s1]];
        if (sz > 0) B.tile.quad(A, Bp, C, D, pa(s0), pa(s0), pa(s1), pa(s1), uv);
        else B.tile.quad(Bp, A, D, C, pa(s0), pa(s0), pa(s1), pa(s1), [uv[1], uv[0], uv[3], uv[2]]);
        // underside (望板 / rafters seen from the street)
        const A2 = [A[0], A[1] - dn, A[2]], B2 = [Bp[0], Bp[1] - dn, Bp[2]], C2 = [C[0], C[1] - dn, C[2]], D2 = [D[0], D[1] - dn, D[2]];
        if (sz > 0) B.wood.quad(A2, D2, C2, B2, [PAINT.PLANK, 0, 1, 0]); else B.wood.quad(B2, C2, D2, A2, [PAINT.PLANK, 0, 1, 0]);
      }
    }
    // fascia (連檐), following the curl
    const [ze, ye] = pts[0];
    for (let j = 0; j < nx; j++) {
      const xa = -X + (2 * X * j) / nx, xb = -X + (2 * X * (j + 1)) / nx, ya = ye + curl(xa, 0), yb = ye + curl(xb, 0);
      B.wood.quad(...(sz > 0 ? [[xa, ya - 0.16, ze], [xb, yb - 0.16, ze], [xb, yb, ze], [xa, ya, ze]] : [[xb, yb - 0.16, ze], [xa, ya - 0.16, ze], [xa, ya, ze], [xb, yb, ze]]), [PAINT.PLANK, 0, 0.16, 0]);
    }
    return pts;
  };
  const front = slope(1), back = slope(-1);
  // gables: whitewashed triangles over the side walls, 搏風版 along the overhang
  for (const sx of [-1, 1]) {
    const x = sx * hx;
    const tri = [[x, H, hz], [x, H, -hz], [x, ridgeY - 0.15, 0]];
    quadOut(B.plaster, tri[0], tri[1], tri[2], tri[2], [0, H, 0], [PAINT.WHITEWASH, 0, 2, 0]);
    if (lod <= 1) {
      // the gable frame shows through the lime: a tie beam, a king post and two struts (穿斗 frame)
      const xo = x + sx * 0.03, yT = H + (ridgeY - 0.15 - H) * 0.42;
      B.wood.box(Math.min(xo, x), H - 0.1, -hz, Math.max(xo, x) + 0.0, H + 0.12, hz, PAINT.PLANK, 'z');
      B.wood.box(Math.min(xo, x), yT - 0.08, -hz * 0.58, Math.max(xo, x), yT + 0.08, hz * 0.58, PAINT.PLANK, 'z');
      B.wood.box(Math.min(xo, x), H, -0.08, Math.max(xo, x), ridgeY - 0.2, 0.08, PAINT.PLANK, 'y');
      for (const sz of [-1, 1]) B.wood.box(Math.min(xo, x), H, sz * hz * 0.5 - 0.07, Math.max(xo, x), yT, sz * hz * 0.5 + 0.07, PAINT.PLANK, 'y');
    }
    if (lod <= 1) for (const pts of [front, back]) {
      const xs = sx * (X + 0.015);
      for (let i = 0; i < pts.length - 1; i++) {
        const [z0, y0] = pts[i], [z1, y1] = pts[i + 1];
        const c0 = curl(X, i / (pts.length - 1)), c1 = curl(X, (i + 1) / (pts.length - 1));
        quadOut(B.wood, [xs, y0 - 0.22 + c0, z0], [xs, y1 - 0.22 + c1, z1], [xs, y1 + 0.02 + c1, z1], [xs, y0 + 0.02 + c0, z0], [0, y0, 0], [PAINT.PLANK, 0, 0.24, 0]);
      }
    }
  }
  // ridge (壘脊 of 瓪瓦) with lifted ends
  const rh = lod >= 2 ? 0.3 : 0.42, rw = 0.34;
  // the ridge follows the curl in a few straight pieces; 蠍尾 ends turned up (every LOD: they carry the silhouette)
  const nr = lod >= 2 ? 2 : 4;
  for (let j = 0; j < 2 * nr; j++) {
    const xa = -X + (X * j) / nr, xb = -X + (X * (j + 1)) / nr, xm = (xa + xb) / 2, c = curl(xm, 1);
    B.tile.box(xa - (j === 0 ? 0.05 : 0), ridgeY - 0.12 + c, -rw / 2 - 0.05, xb + (j === 2 * nr - 1 ? 0.05 : 0), ridgeY + 0.08 + c, rw / 2 + 0.05, PAINT.RIDGE, 'x');
    B.tile.box(xa, ridgeY + 0.08 + c, -rw / 2, xb, ridgeY + rh + c, rw / 2, PAINT.RIDGE, 'x');
  }
  for (const sx of [-1, 1]) {
    const x0 = sx * (X + 0.05), c = curl(X, 1);
    B.tile.box(Math.min(x0 - sx * 0.1, x0 + sx * 0.38), ridgeY + rh - 0.05 + c, -rw * 0.4, Math.max(x0 - sx * 0.1, x0 + sx * 0.38), ridgeY + rh + 0.3 + c, rw * 0.4, PAINT.RIDGE, 'x');
    if (lod <= 1) B.tile.box(Math.min(x0 + sx * 0.22, x0 + sx * 0.5), ridgeY + rh + 0.22 + c, -rw * 0.3, Math.max(x0 + sx * 0.22, x0 + sx * 0.5), ridgeY + rh + 0.48 + c, rw * 0.3, PAINT.RIDGE, 'x');
  }
  if (lod === 0) {
    // 勾頭 / 滴水 are absent on 瓪瓦 roofs: the eave shows the 瓪瓦 lips — a row of small lips along both eaves
    for (const pts of [front, back]) {
      const [ze, ye] = pts[0];
      const n = Math.round((2 * X) / 0.24);
      for (let i = 0; i < n; i++) {
        const x = -X + (2 * X * (i + 0.5)) / n;
        const cx = curl(x, 0); B.tile.box(x - 0.09, ye - 0.05 + cx, ze - 0.02 * Math.sign(ze), x + 0.09, ye + 0.03 + cx, ze + 0.03 * Math.sign(ze), PAINT.EAVE_TILE, 'x');
      }
    }
  }
}

function toGroup(B, name, { ao = true } = {}) {
  const mats = hallMaterials();
  if (ao) {
    const occl = FAMILIES.filter((k) => B[k].count && k !== 'glow').map((k) => ({ B: B[k] }));
    bakeAO({ targets: FAMILIES.filter((k) => B[k].count).map((k) => ({ B: B[k] })), occluders: occl, cell: 0.1, coarse: 0.3, near: 0.8, far: 4, upFar: 8 });
  }
  const g = new THREE.Group(); g.name = name;
  let tris = 0;
  for (const k of FAMILIES) {
    if (!B[k].count) continue;
    const m = new THREE.Mesh(B[k].toGeometry(), mats[k]);
    m.name = `${name}:${k}`; m.castShadow = k !== 'glow' && k !== 'dark'; m.receiveShadow = true;
    g.add(m); tris += B[k].count / 3;
  }
  return { group: g, tris };
}

/** one house (params as houseParams), { lod, ao } */
export function buildHouse(o = {}, { lod = 1, ao = true, name = 'house' } = {}) {
  const t0 = performance.now();
  const P = houseParams(o);
  const B = houseParts(P, lod);
  const { group, tris } = toGroup(B, name, { ao: ao && lod <= 1 });
  const box = new THREE.Box3().setFromObject(group);
  const info = { ms: Math.round(performance.now() - t0), tris: Math.round(tris), params: P, size: box.getSize(new THREE.Vector3()).toArray().map((v) => +v.toFixed(2)), top: +box.max.y.toFixed(2), baseH: 0 };
  return { group, info };
}

/**
 * Shared geometry for instancing: `variants` houses (seeded), each a set of BufferGeometries per material family.
 * kit.variants[i] = { params, geos: { family: BufferGeometry }, size: [w, d] }
 */
export function houseKit({ lod = 1, variants = 10, seed = 'linan', ao = true, overrides = {} } = {}) {
  const mats = hallMaterials();
  const vs = [];
  for (let i = 0; i < variants; i++) {
    const ov = typeof overrides === 'function' ? overrides(i) : Array.isArray(overrides) ? overrides[i % overrides.length] : overrides;
    const P = houseParams({ seed: `${seed}:${i}`, ...(ov || {}) });
    const B = houseParts(P, lod);
    // ao: true bakes lod 0 / 1; 'all' also the lod 2 massing
    if (ao && (lod <= 1 || ao === 'all')) bakeAO({ targets: FAMILIES.filter((k) => B[k].count).map((k) => ({ B: B[k] })), occluders: FAMILIES.filter((k) => B[k].count && k !== 'glow').map((k) => ({ B: B[k] })), cell: lod >= 2 ? 0.2 : 0.12, coarse: 0.3, near: 0.8, far: 4, upFar: 8 });
    const geos = {};
    for (const k of FAMILIES) if (B[k].count) geos[k] = B[k].toGeometry();
    vs.push({ params: P, geos, size: [P.width, P.depth], tris: FAMILIES.reduce((s, k) => s + B[k].count / 3, 0) });
  }
  return { lod, variants: vs, materials: mats };
}

/**
 * Instance a kit: placements [{ x, y?, z, rot (rad about Y), variant, sx? (width scale, 0.85–1.15), sz? (depth), sy? }].
 * One InstancedMesh per (variant, family): draw calls = variants used × ~5. castShadow: false for shadow-free sets.
 */
export function instanceHouses(kit, placements, { name = 'houses', castShadow = true } = {}) {
  const g = new THREE.Group(); g.name = name;
  const byV = new Map();
  for (const p of placements) { const v = p.variant % kit.variants.length; if (!byV.has(v)) byV.set(v, []); byV.get(v).push(p); }
  const M = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
  let tris = 0;
  for (const [v, list] of byV) {
    const V = kit.variants[v];
    for (const [k, geo] of Object.entries(V.geos)) {
      const im = new THREE.InstancedMesh(geo, kit.materials[k], list.length);
      list.forEach((p, i) => { q.setFromAxisAngle(up, p.rot || 0); M.compose(new THREE.Vector3(p.x, p.y ?? 0, p.z), q, new THREE.Vector3(p.sx ?? 1, p.sy ?? 1, p.sz ?? 1)); im.setMatrixAt(i, M); });
      im.instanceMatrix.needsUpdate = true; im.computeBoundingSphere(); im.computeBoundingBox?.();
      im.name = `${name}:v${v}:${k}`; im.castShadow = castShadow && k !== 'glow' && k !== 'dark'; im.receiveShadow = true;
      im.userData.castShadow = im.castShadow;
      g.add(im);
    }
    tris += V.tris * list.length;
  }
  g.userData.tris = tris;
  return g;
}
