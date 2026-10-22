// Stone arch bridges (單孔石拱橋): the causeway bridges of West Lake (断桥, 锦带桥, the six 苏堤 bridges, 西泠, 长桥),
// the hump bridges over the city canals and the small 春淙桥 at 灵隐.
//
//   buildArchBridge(params, { lod, ao, name })  → { group, info }
//   archBridgeParts(params, lod)                → { B: MeshBuilder (stone), P: resolved params, deckY(z), lines }
// Frame: origin on the bridge's own water level at the middle of the span, the deck runs along local Z (place it with
// rotation.y = headingToRotY(axis)), width along X. y = 0 is the water.
//
// params (metres):
//   span      clear span of the arch at the water (default 9)
//   archH     height of the intrados crown above the water (default span / 2: a semicircle; the reflection closes
//             the circle). shape: superellipse exponent of the intrados (2 = ellipse / semicircle, < 2 pointed, 1.75
//             for the tall 'egg' arch of ref10)
//   rise      top of the deck at the crown above the water (layout BRIDGES.rise)
//   width     deck width over the parapets; length: total length with the ramps; bank: deck level at both ends
//   crown     roundness of the hump (0.15 sharp … 0.5 round); steps: true → stepped ramps (踏步) where steep
//   ringT     depth of the voussoir ring (券臉石); curbH: deck-edge band height
//   rail      'goulan' (望柱 + 華版 + 尋杖 勾闌) | 'parapet' (a solid low wall) | 'none'; railH (to the 尋杖)
//   foot      how deep the masonry goes below the water (m)
//   banks     { gapHalf, width, top } → stone abutment walls across a causeway cut at z = ±gapHalf (faces the gap)
// LOD: 0 = hero (stepped ramps, carved 勾闌 with capped posts, fine faces, baked AO), 1 = smooth deck, simple
// rail, 2 = massing (body, parapet slab).
import * as THREE from 'three';
import { MeshBuilder } from '../yingzao/geom.js';
import { bakeAO } from '../yingzao/ao.js';
import { bridgeStoneMaterial, snowMaterial, BK } from './material.js';

export function bridgeParams(p = {}) {
  const span = p.span ?? 9;
  const P = {
    span, archH: p.archH ?? span / 2, shape: p.shape ?? 2,
    rise: p.rise ?? span / 2 + 2, width: p.width ?? 7, length: p.length ?? span * 4, bank: p.bank ?? 1.3,
    crown: p.crown ?? 0.24, steps: p.steps ?? true, ringT: p.ringT ?? Math.max(0.35, Math.min(0.62, span * 0.055)),
    curbH: p.curbH ?? 0.3, rail: p.rail ?? 'goulan', railH: p.railH ?? 0.86, postH: p.postH ?? 1.08,
    panel: p.panel ?? 1.9, foot: p.foot ?? 1.4, banks: p.banks ?? null, riser: p.riser ?? 0.15,
  };
  // the deck must clear the arch ring
  P.rise = Math.max(P.rise, P.archH + P.ringT + P.curbH + 0.25);
  return P;
}

// ------------------------------------------------------------------------------------------------ helpers
/** quad with its normal turned toward `want` (any vector) */
function quadW(B, a, b, c, d, want, pa, uv) {
  const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
  const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
  const P = (v) => (typeof pa === 'function' ? pa(v) : pa);
  if (nx * want[0] + ny * want[1] + nz * want[2] >= 0) B.quad(a, b, c, d, P(a), P(b), P(c), P(d), uv);
  else B.quad(a, d, c, b, P(a), P(d), P(c), P(b), uv ? [uv[0], uv[3], uv[2], uv[1]] : null);
}
const paint = (kind, extra = 0) => (v) => [kind, v[1], extra, 0];

/** closed box from 8 corners (bottom 4 then top 4, CCW seen from above), facing out of its centre */
function hexa(B, c, kind, uvScale = 1, extra = 0) {
  const ctr = c.reduce((a, v) => [a[0] + v[0] / 8, a[1] + v[1] / 8, a[2] + v[2] / 8], [0, 0, 0]);
  const pa = paint(kind, extra);
  const face = (i, j, k, l) => {
    const a = c[i], b = c[j], cc = c[k], d = c[l];
    const m = [(a[0] + cc[0]) / 2 - ctr[0], (a[1] + cc[1]) / 2 - ctr[1], (a[2] + cc[2]) / 2 - ctr[2]];
    // metric uv on the face: along the a→b edge and the a→d edge
    const lab = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) * uvScale, lad = Math.hypot(d[0] - a[0], d[1] - a[1], d[2] - a[2]) * uvScale;
    quadW(B, a, b, cc, d, m, pa, [[0, 0], [lab, 0], [lab, lad], [0, lad]]);
  };
  face(0, 1, 2, 3); face(4, 5, 6, 7);
  face(0, 1, 5, 4); face(1, 2, 6, 5); face(2, 3, 7, 6); face(3, 0, 4, 7);
}
/** axis-aligned-in-x box spanning z0..z1 with bottoms yb0, yb1 and tops yt0, yt1 (sloped along z), x0..x1 */
function slopedBox(B, x0, x1, z0, z1, yb0, yb1, yt0, yt1, kind, extra = 0) {
  hexa(B, [[x0, yb0, z0], [x1, yb0, z0], [x1, yb1, z1], [x0, yb1, z1], [x0, yt0, z0], [x1, yt0, z0], [x1, yt1, z1], [x0, yt1, z1]], kind, 1, extra);
}

// ------------------------------------------------------------------------------------------------ the bridge
export function archBridgeParts(p = {}, lod = 0) {
  const P = bridgeParams(p);
  const B = new MeshBuilder();
  const { span, archH, shape, rise, width, length, bank, crown, ringT, curbH, foot } = P;
  const hs = span / 2, hw = width / 2, Lh = length / 2;
  // ---- deck line: a hump with straight-ish ramps (hyperbola: linear far from the crown, round over it)
  const wC = crown;
  const gN = Math.sqrt(wC * wC + 1) - wC;
  const deckY = (z) => { const s = Math.min(1, Math.abs(z) / Lh); return rise - (rise - bank) * (Math.sqrt(wC * wC + s * s) - wC) / gN; };
  const slopeAt = (z) => (deckY(Math.abs(z) + 0.05) - deckY(Math.abs(z) - 0.05)) / 0.1;
  // ---- arch intrados: superellipse |z/hs|^p + |y/archH|^p = 1, sampled by angle
  const nA = lod === 0 ? 48 : lod === 1 ? 24 : 12;
  const arch = [];
  for (let i = 0; i <= nA; i++) {
    const th = (i / nA) * Math.PI;
    const c = Math.cos(th), s = Math.sin(th);
    const z = -hs * Math.sign(c) * Math.pow(Math.abs(c), 2 / shape), y = archH * Math.pow(s, 2 / shape);
    arch.push([z, y]);
  }
  arch[0] = [-hs, 0]; arch[nA] = [hs, 0];
  const archY = (z) => {
    if (Math.abs(z) >= hs) return 0;
    const u = Math.abs(z) / hs;
    return archH * Math.pow(Math.max(0, 1 - Math.pow(u, shape)), 1 / shape);
  };
  // arc length along the intrados and outward normals (away from the opening)
  const acc = [0];
  for (let i = 1; i <= nA; i++) acc.push(acc[i - 1] + Math.hypot(arch[i][0] - arch[i - 1][0], arch[i][1] - arch[i - 1][1]));
  const arcLen = acc[nA];
  const nrm = arch.map((q, i) => {
    const a = arch[Math.max(0, i - 1)], b = arch[Math.min(nA, i + 1)];
    let tz = b[0] - a[0], ty = b[1] - a[1]; const l = Math.hypot(tz, ty) || 1; tz /= l; ty /= l;
    // the curve runs from z = -hs to +hs over the top: outward (up, away) = rotate the tangent by +90° in (z, y)
    return [-ty, tz];
  });
  let nV = Math.max(5, Math.round(arcLen / 0.52)); if (nV % 2 === 0) nV++;
  // ---- z samples for the faces (denser where the arch curves)
  const zsSet = new Set();
  const dz = lod === 0 ? 0.45 : lod === 1 ? 1.2 : 3;
  for (let z = -Lh; z <= Lh + 1e-6; z += dz) zsSet.add(+z.toFixed(4));
  zsSet.add(Lh); zsSet.add(-Lh);
  for (const [z] of arch) zsSet.add(+z.toFixed(4));
  zsSet.add(-hs - 0.002); zsSet.add(hs + 0.002);
  const zs = [...zsSet].sort((a, b) => a - b);
  const yBot = -foot;
  const bottom = (z) => (Math.abs(z) <= hs + 2e-4 ? archY(z) : yBot);
  const faceTop = (z) => deckY(z) - curbH;
  // ---- spandrel faces (both sides), coursed ashlar
  const rowsMax = Math.max(2, Math.ceil((rise + foot) / (lod === 0 ? 0.5 : lod === 1 ? 1.1 : 3)));
  for (const sx of [-1, 1]) {
    const x = sx * hw;
    for (let i = 0; i < zs.length - 1; i++) {
      const za = zs[i], zb = zs[i + 1];
      const ba = bottom(za), bb = bottom(zb), ta = faceTop(za), tb = faceTop(zb);
      for (let k = 0; k < rowsMax; k++) {
        const v0 = k / rowsMax, v1 = (k + 1) / rowsMax;
        const A = [x, ba + (ta - ba) * v0, za], Bv = [x, bb + (tb - bb) * v0, zb], C = [x, bb + (tb - bb) * v1, zb], D = [x, ba + (ta - ba) * v1, za];
        const U = (q) => [sx * q[2] + 50, q[1] + 10];
        quadW(B, A, Bv, C, D, [sx, 0, 0], paint(BK.ASHLAR), [U(A), U(Bv), U(C), U(D)]);
      }
    }
  }
  // ---- intrados (barrel vault) and the piers below the springing
  const nX = Math.max(1, Math.round(width / (lod === 0 ? 0.6 : lod === 1 ? 1.5 : 4)));
  for (let i = 0; i < nA; i++) {
    const [za, ya] = arch[i], [zb, yb] = arch[i + 1];
    const wa = [0, -nrm[i][1], -nrm[i][0]];
    for (let k = 0; k < nX; k++) {
      const xa = -hw + (width * k) / nX, xb = -hw + (width * (k + 1)) / nX;
      const A = [xa, ya, za], Bv = [xb, ya, za], C = [xb, yb, zb], D = [xa, yb, zb];
      const mid = (i + 0.5);
      const want = [0, -(nrm[Math.floor(mid)][1] + nrm[Math.ceil(mid)][1]), -(nrm[Math.floor(mid)][0] + nrm[Math.ceil(mid)][0])];
      void wa;
      quadW(B, A, Bv, C, D, want, paint(BK.VAULT), [[acc[i], xa], [acc[i], xb], [acc[i + 1], xb], [acc[i + 1], xa]]);
    }
  }
  for (const sz of [-1, 1]) {
    // pier faces of the opening under the springing, down to the foot
    const z = sz * hs;
    for (let k = 0; k < nX; k++) {
      const xa = -hw + (width * k) / nX, xb = -hw + (width * (k + 1)) / nX;
      quadW(B, [xa, yBot, z], [xb, yBot, z], [xb, 0.001, z], [xa, 0.001, z], [0, 0, -sz], paint(BK.VAULT), [[0, xa], [0, xb], [1.4, xb], [1.4, xa]]);
    }
  }
  // ---- voussoir ring (券臉), standing 4 cm proud of the face, with its lips
  const proud = lod >= 2 ? 0 : 0.045;
  if (lod <= 1) for (const sx of [-1, 1]) {
    const x0 = sx * hw, x1 = sx * (hw + proud);
    for (let i = 0; i < nA; i++) {
      const [za, ya] = arch[i], [zb, yb] = arch[i + 1];
      const na = nrm[i], nb = nrm[i + 1];
      const qa = (acc[i] / arcLen) * nV, qb = (acc[i + 1] / arcLen) * nV;
      const Ai = [x1, ya, za], Bi = [x1, yb, zb], Ao = [x1, ya + na[1] * ringT, za + na[0] * ringT], Bo = [x1, yb + nb[1] * ringT, zb + nb[0] * ringT];
      quadW(B, Ai, Bi, Bo, Ao, [sx, 0, 0], paint(BK.RING), [[qa, 0], [qb, 0], [qb, ringT], [qa, ringT]]);
      // inner lip (on the soffit edge) and the outer step back to the spandrel
      quadW(B, [x0, ya, za], [x0, yb, zb], Bi, Ai, [0, -(na[1] + nb[1]), -(na[0] + nb[0])], paint(BK.RING), [[qa, 0], [qb, 0], [qb, proud], [qa, proud]]);
      quadW(B, [x0, Ao[1], Ao[2]], [x0, Bo[1], Bo[2]], Bo, Ao, [0, na[1] + nb[1], na[0] + nb[0]], paint(BK.RING), [[qa, ringT], [qb, ringT], [qb, ringT], [qa, ringT]]);
    }
  }
  // ---- deck-edge band (金邊石) along both sides
  const curbOut = lod >= 2 ? 0.02 : 0.07;
  const railT = P.rail === 'none' ? 0 : lod >= 2 ? 0.32 : 0.3;
  for (const sx of [-1, 1]) {
    const xo = sx * (hw + curbOut), xi = sx * hw;
    for (let i = 0; i < zs.length - 1; i++) {
      const za = zs[i], zb = zs[i + 1];
      const ya = deckY(za), yb = deckY(zb);
      const U = (z, y) => [sx * z + 30, y];
      quadW(B, [xo, ya - curbH, za], [xo, yb - curbH, zb], [xo, yb + 0.03, zb], [xo, ya + 0.03, za], [sx, 0, 0], paint(BK.CURB), [U(za, 0), U(zb, 0), U(zb, curbH), U(za, curbH)]);
      quadW(B, [xi, ya - curbH, za], [xi, yb - curbH, zb], [xo, yb - curbH, zb], [xo, ya - curbH, za], [0, -1, 0], paint(BK.CURB), null);
      // the top of the band: the strip proud of the face always, inside it only where no rail sill covers it
      const xIn = railT === 0 || lod >= 2 ? sx * (hw - railT) : xi;
      quadW(B, [xo, ya + 0.03, za], [xo, yb + 0.03, zb], [xIn, yb + 0.03, zb], [xIn, ya + 0.03, za], [0, 1, 0], paint(BK.CURB), [[sx * za + 30, 0], [sx * zb + 30, 0], [sx * zb + 30, 0.3], [sx * za + 30, 0.3]]);
    }
    // band end faces
    for (const sz of [-1, 1]) {
      const z = sz * Lh, y = deckY(z);
      quadW(B, [xi, y - curbH, z], [xo, y - curbH, z], [xo, y + 0.03, z], [xi, y + 0.03, z], [0, 0, sz], paint(BK.CURB), null);
    }
  }
  // ---- deck: slabs over the crown, stepped ramps (lod 0) where steeper than ~1:7
  const xi0 = -hw + railT, xi1 = hw - railT;
  const deckStrip = (za, zb, ya, yb, kind) => {
    const nx = Math.max(1, Math.round((xi1 - xi0) / (lod === 0 ? 1.2 : 3)));
    for (let k = 0; k < nx; k++) {
      const xa = xi0 + ((xi1 - xi0) * k) / nx, xb = xi0 + ((xi1 - xi0) * (k + 1)) / nx;
      quadW(B, [xa, ya, za], [xb, ya, za], [xb, yb, zb], [xa, yb, zb], [0, 1, 0], paint(kind), [[xa, za], [xb, za], [xb, zb], [xa, zb]]);
    }
  };
  let flatHalf = Lh;
  if (P.steps && lod === 0) {
    // walk from each end up toward the crown: risers of ~P.riser, treads by the local slope
    const steps = [];
    let z = Lh, yT = bank;
    for (let guard = 0; guard < 400; guard++) {
      const sl = Math.abs(slopeAt(z - 0.2));
      if (sl < 0.13 || z < 0.4) break;
      const run = Math.min(0.7, Math.max(0.3, P.riser / sl));
      const z2 = z - run;
      steps.push([z2, z, yT]);
      yT = deckY(z2 + run * 0.5) + P.riser * 0.5;
      z = z2;
    }
    flatHalf = z;
    // treads and risers, mirrored for both ramps
    for (const sz of [-1, 1]) {
      for (let i = 0; i < steps.length; i++) {
        const [za, zb, y0] = steps[i];
        const yTread = deckY((za + zb) / 2);
        const yPrev = i === 0 ? bank : deckY((steps[i - 1][0] + steps[i - 1][1]) / 2);
        // tread
        const A = [xi0, yTread, sz * za], Bv = [xi1, yTread, sz * za], C = [xi1, yTread, sz * zb], D = [xi0, yTread, sz * zb];
        quadW(B, A, Bv, C, D, [0, 1, 0], paint(BK.TREAD), [[xi0, za], [xi1, za], [xi1, zb], [xi0, zb]]);
        // riser at the outer edge of the tread (zb), down to the previous tread
        const R0 = [xi0, yPrev, sz * zb], R1 = [xi1, yPrev, sz * zb], R2 = [xi1, yTread, sz * zb], R3 = [xi0, yTread, sz * zb];
        if (yTread - yPrev > 0.01) quadW(B, R0, R1, R2, R3, [0, 0, sz], paint(BK.RISER), [[xi0, 0], [xi1, 0], [xi1, yTread - yPrev], [xi0, yTread - yPrev]]);
        void y0;
      }
      // the step up from the last tread onto the crown slabs
      const last = steps[steps.length - 1];
      if (last) {
        const yL = deckY((last[0] + last[1]) / 2), yC = deckY(flatHalf);
        if (yC - yL > 0.005) quadW(B, [xi0, yL, sz * flatHalf], [xi1, yL, sz * flatHalf], [xi1, yC, sz * flatHalf], [xi0, yC, sz * flatHalf], [0, 0, sz], paint(BK.RISER), [[xi0, 0], [xi1, 0], [xi1, yC - yL], [xi0, yC - yL]]);
      }
    }
  }
  {
    const zc = zs.filter((z) => Math.abs(z) < flatHalf - 1e-4);
    const list = [-flatHalf, ...zc, flatHalf];
    for (let i = 0; i < list.length - 1; i++) deckStrip(list[i], list[i + 1], deckY(list[i]), deckY(list[i + 1]), BK.DECK);
  }
  // ---- 勾闌 (or a parapet) on both edges
  const lines = { posts: [], rails: [] };
  if (P.rail !== 'none') buildRails(B, P, deckY, zs, hw, railT, lod, lines);
  // ---- end faces of the body (buried in the causeway / bank, but closed for the AO and the shadows)
  for (const sz of [-1, 1]) {
    const z = sz * Lh, y = deckY(z) - curbH;
    quadW(B, [-hw, yBot, z], [hw, yBot, z], [hw, y, z], [-hw, y, z], [0, 0, sz], paint(BK.ASHLAR), [[-hw, yBot], [hw, yBot], [hw, y], [-hw, y]]);
  }
  // ---- abutment walls across a causeway cut (facing the gap)
  if (P.banks) {
    const { gapHalf, width: cw, top } = P.banks;
    const t = top ?? bank;
    for (const sz of [-1, 1]) {
      const z = sz * gapHalf;
      const nxw = Math.max(2, Math.round(cw / (lod === 0 ? 0.8 : 3))), nyw = Math.max(1, Math.round((t + foot) / (lod === 0 ? 0.5 : 2)));
      for (let i = 0; i < nxw; i++) for (let k = 0; k < nyw; k++) {
        const xa = -cw / 2 + (cw * i) / nxw, xb = -cw / 2 + (cw * (i + 1)) / nxw;
        if (xb > -hw + 0.05 && xa < hw - 0.05) continue; // inside the bridge body
        if (P.banks.mask && !P.banks.mask((xa + xb) / 2, sz)) continue; // no causeway behind it here
        const ya = yBot + ((t + foot) * k) / nyw, yb = yBot + ((t + foot) * (k + 1)) / nyw;
        quadW(B, [xa, ya, z], [xb, ya, z], [xb, yb, z], [xa, yb, z], [0, 0, -sz], paint(BK.WALL), [[xa * sz, ya + 3], [xb * sz, ya + 3], [xb * sz, yb + 3], [xa * sz, yb + 3]]);
      }
      // coping stones on top
      for (const [xa, xb] of [[-cw / 2, -hw], [hw, cw / 2]]) {
        // coping in pieces, where the wall stands
        const n = Math.max(1, Math.round((xb - xa) / 1.6));
        for (let i = 0; i < n; i++) {
          const x0 = xa + ((xb - xa) * i) / n, x1 = xa + ((xb - xa) * (i + 1)) / n;
          if (P.banks.mask && !P.banks.mask((x0 + x1) / 2, sz)) continue;
          slopedBox(B, x0, x1, z - sz * 0.08, z + sz * 0.6, t, t, t + 0.18, t + 0.18, BK.COPING);
        }
      }
    }
  }
  return { B, P, deckY, archY, lines, arch, nV };
}

/** 勾闌: 望柱 posts with caps, 地栿 sill, 華版 panels, 蜀柱 supports and the 尋杖 handrail, following the deck */
function buildRails(B, P, deckY, zs, hw, railT, lod, lines) {
  const Lh = P.length / 2;
  // arc length along the deck line (for even post spacing)
  const N = 400, S = [0];
  const zAt = (i) => -Lh + (2 * Lh * i) / N;
  for (let i = 1; i <= N; i++) S.push(S[i - 1] + Math.hypot(zAt(i) - zAt(i - 1), deckY(zAt(i)) - deckY(zAt(i - 1))));
  const total = S[N];
  const zOfS = (s) => { let i = 1; while (i < N && S[i] < s) i++; const t = (s - S[i - 1]) / (S[i] - S[i - 1] || 1); return zAt(i - 1) + (zAt(i) - zAt(i - 1)) * t; };
  const nPan = Math.max(2, Math.round(total / P.panel));
  const postZ = [];
  for (let i = 0; i <= nPan; i++) postZ.push(zOfS((total * i) / nPan));
  const sillH = lod >= 2 ? 0 : 0.17, ps = lod === 0 ? 0.25 : 0.25;
  for (const sx of [-1, 1]) {
    const xc = sx * (hw - railT / 2);
    const x0 = xc - railT / 2, x1 = xc + railT / 2;
    if (P.rail === 'parapet' || lod >= 2) {
      // a solid parapet wall following the deck
      const h = lod >= 2 ? P.railH : P.railH * 0.9;
      for (let i = 0; i < zs.length - 1; i++) {
        const za = zs[i], zb = zs[i + 1];
        slopedBox(B, x0, x1, za, zb, deckY(za), deckY(zb), deckY(za) + h, deckY(zb) + h, BK.RAIL);
      }
      continue;
    }
    // sill (地栿)
    for (let i = 0; i < zs.length - 1; i++) {
      const za = zs[i], zb = zs[i + 1];
      slopedBox(B, x0, x1, za, zb, deckY(za) - 0.02, deckY(zb) - 0.02, deckY(za) + sillH, deckY(zb) + sillH, BK.RAIL);
    }
    const pt = lod === 0 ? 0.15 : 0.16; // panel thickness
    for (let i = 0; i < postZ.length; i++) {
      const z = postZ[i], y = deckY(z) + sillH;
      // post (望柱) with a cap
      const h = P.postH - sillH;
      const c = [[xc - ps / 2, y, z - ps / 2], [xc + ps / 2, y, z - ps / 2], [xc + ps / 2, y, z + ps / 2], [xc - ps / 2, y, z + ps / 2]];
      hexa(B, [...c, ...c.map((q) => [q[0], q[1] + h, q[2]])], BK.RAIL);
      lines.posts.push([xc, y + h, z]);
      if (lod === 0) {
        // 蓮瓣 cap: a neck, a round bud and a small point
        B.lathe([[ps * 0.42, 0], [ps * 0.36, 0.05], [ps * 0.55, 0.09], [ps * 0.62, 0.16], [ps * 0.55, 0.24], [ps * 0.3, 0.3], [0.001, 0.34]], 10, { ox: xc, oy: y + h, oz: z, kind: BK.RAIL, capTop: false });
        // fix the lathe paint (wl) for the shader
        const n0 = B.count - 10 * 6 * 6;
        for (let k = Math.max(0, n0); k < B.count; k++) { B.paint[k * 4 + 1] = B.pos[k * 3 + 1]; B.paint[k * 4 + 2] = 0; B.paint[k * 4 + 3] = 0; }
      } else {
        hexa(B, [[xc - ps * 0.38, y + h, z - ps * 0.38], [xc + ps * 0.38, y + h, z - ps * 0.38], [xc + ps * 0.38, y + h, z + ps * 0.38], [xc - ps * 0.38, y + h, z + ps * 0.38],
          [xc - 0.01, y + h + 0.16, z - 0.01], [xc + 0.01, y + h + 0.16, z - 0.01], [xc + 0.01, y + h + 0.16, z + 0.01], [xc - 0.01, y + h + 0.16, z + 0.01]], BK.RAIL);
      }
      if (i === postZ.length - 1) break;
      // panel, supports and handrail between this post and the next
      const za = z + ps / 2, zb = postZ[i + 1] - ps / 2;
      if (zb - za < 0.15) continue;
      const ya = deckY(za) + sillH, yb = deckY(zb) + sillH;
      const pan = lod === 0 ? 0.44 : 0.5;
      slopedBox(B, xc - pt / 2, xc + pt / 2, za, zb, ya, yb, ya + pan, yb + pan, BK.PANEL, Math.hypot(zb - za, yb - ya));
      // PANEL uv: (along 0..len, up 0..pan) on the two big faces — rewrite the uv of the slab's side faces
      const len = Math.hypot(zb - za, yb - ya);
      const nFix = 36;
      for (let k = B.count - nFix; k < B.count; k++) {
        const vz = B.pos[k * 3 + 2], vy = B.pos[k * 3 + 1];
        const u = ((vz - za) / (zb - za)) * len;
        const yLine = ya + (yb - ya) * ((vz - za) / (zb - za));
        B.uv[k * 2] = u; B.uv[k * 2 + 1] = vy - yLine;
      }
      const rTop = P.railH - sillH, rh = lod === 0 ? 0.13 : 0.14;
      if (lod === 0) {
        // two 蜀柱 / 撮項 supports per panel
        for (const t of [0.25, 0.75]) {
          const zz = za + (zb - za) * t, yy = ya + (yb - ya) * t;
          const s2 = 0.07;
          const cc = [[xc - s2, yy + pan, zz - s2 * 1.4], [xc + s2, yy + pan, zz - s2 * 1.4], [xc + s2, yy + pan, zz + s2 * 1.4], [xc - s2, yy + pan, zz + s2 * 1.4]];
          hexa(B, [...cc, ...cc.map((q) => [q[0], yy + rTop - rh + 0.01, q[2]])], BK.RAIL);
        }
      } else {
        // lod 1: the supports as one slotted slab
        slopedBox(B, xc - 0.04, xc + 0.04, za, zb, ya + pan, yb + pan, ya + rTop - rh, yb + rTop - rh, BK.RAIL);
      }
      // 尋杖 handrail
      slopedBox(B, xc - 0.08, xc + 0.08, za - 0.02, zb + 0.02, ya + rTop - rh, yb + rTop - rh, ya + rTop, yb + rTop, BK.RAIL);
      lines.rails.push([[xc, ya + rTop, za], [xc, yb + rTop, zb]]);
    }
    // end stones (抱鼓-like wedges) leaning against the outer posts
    for (const sz of [-1, 1]) {
      const z = sz * (Lh - 0.05), y = deckY(z);
      const zIn = z - sz * 0.05, zOut = z + sz * 0.9;
      slopedBox(B, xc - pt / 2, xc + pt / 2, zIn, zOut, y - 0.05, y - 0.05, y + 0.85, y + 0.12, BK.RAIL);
    }
  }
}

/**
 * Snow lying on a bridge (winter): a blanket on the deck between the rails, caps on the handrails, the posts and the
 * deck-edge band. aPaint = (0, inner 0..1, steepness, 0) for snowMaterial(). Returns a MeshBuilder.
 */
export function archBridgeSnow(parts) {
  const { P, deckY, lines } = parts;
  const S = new MeshBuilder();
  const hw = P.width / 2, Lh = P.length / 2, railT = P.rail === 'none' ? 0 : 0.3;
  const x0 = -hw + railT, x1 = hw - railT;
  const nz = Math.max(8, Math.round(P.length / 0.5)), nx = 6;
  const slope = (z) => Math.min(1, Math.abs((deckY(z + 0.1) - deckY(z - 0.1)) / 0.2) / 0.5);
  for (let i = 0; i < nz; i++) {
    const za = -Lh + (2 * Lh * i) / nz, zb = -Lh + (2 * Lh * (i + 1)) / nz;
    for (let k = 0; k < nx; k++) {
      const xa = x0 + ((x1 - x0) * k) / nx, xb = x0 + ((x1 - x0) * (k + 1)) / nx;
      const inn = (x) => Math.min(1, Math.min(x - x0, x1 - x) / 1.2);
      const pv = (x, z) => [0, inn(x), slope(z), 0];
      const y = (x, z) => deckY(z) + 0.11 + 0.05 * inn(x);
      quadW(S, [xa, y(xa, za), za], [xb, y(xb, za), za], [xb, y(xb, zb), zb], [xa, y(xa, zb), zb], [0, 1, 0], (v) => pv(v[0], v[2]), null);
    }
  }
  // caps: handrails, posts, the band outside the rails
  const cap = (a, b, w, h) => {
    const dz = b[2] - a[2], len = Math.hypot(dz, b[1] - a[1]);
    if (len < 0.05) return;
    const pa = [0, 0.7, 0.3, 0];
    const A = [a[0] - w, a[1] + 0.005, a[2]], Bq = [a[0] + w, a[1] + 0.005, a[2]], C = [b[0] + w, b[1] + 0.005, b[2]], D = [b[0] - w, b[1] + 0.005, b[2]];
    const T0 = [a[0], a[1] + h, a[2]], T1 = [b[0], b[1] + h, b[2]];
    quadW(S, A, D, T1, T0, [-1, 1, 0], pa, null); quadW(S, Bq, T0, T1, C, [1, 1, 0], pa, null);
  };
  for (const [a, b] of lines.rails || []) cap(a, b, 0.1, 0.07);
  for (const sx of [-1, 1]) {
    const x = sx * (hw + 0.03);
    for (let i = 0; i < nz; i++) {
      const za = -Lh + (2 * Lh * i) / nz, zb = -Lh + (2 * Lh * (i + 1)) / nz;
      cap([x, deckY(za) + 0.03, za], [x, deckY(zb) + 0.03, zb], 0.06, 0.05);
    }
  }
  return S;
}

/** one bridge as a Mesh in a Group (origin on the water at mid-span, deck along +Z) */
export function buildArchBridge(p = {}, { lod = 0, ao = true, name = 'bridge', snow = null } = {}) {
  const t0 = performance.now();
  const parts = archBridgeParts(p, lod);
  const { B } = parts;
  let aoMs = 0;
  if (ao && lod <= 1) {
    const r = bakeAO({ targets: [{ B }], occluders: [{ B }], cell: lod === 0 ? 0.07 : 0.15, coarse: 0.3, near: 0.7, far: 5, upFar: 14 });
    aoMs = r.ms;
  }
  const g = new THREE.Group(); g.name = name;
  const mesh = new THREE.Mesh(B.toGeometry(), bridgeStoneMaterial());
  mesh.name = name + ':stone'; mesh.castShadow = true; mesh.receiveShadow = true;
  g.add(mesh);
  if (lod <= 1 && snow !== false) {
    const S = archBridgeSnow(parts);
    const sm = new THREE.Mesh(S.toGeometry(), snowMaterial());
    sm.name = name + ':snow'; sm.castShadow = false; sm.receiveShadow = true; sm.userData.castShadow = false;
    sm.userData.isSnow = true; sm.visible = snow === true;
    g.add(sm);
  }
  const info = { ms: Math.round(performance.now() - t0), aoMs, tris: Math.round(B.count / 3), params: parts.P, crown: parts.deckY(0), anchors: parts.lines, deckY: parts.deckY };
  return { group: g, info, parts };
}
