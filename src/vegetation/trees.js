// Branching trees (the recursive skeleton → LODs scheme is derived from Athenaion's src/vegetation/trees.js,
// MIT; species specs, the pine plates, peach blossom geometry and the hill-forest variants are ours).
//   camphor (樟)   broad evergreen dome on a short trunk forking into massive limbs
//   broad          deciduous hill tree (枫香 / 朴 / 榉 like): rounded crown, finer twigs
//   maple (红枫)   Acer palmatum: low multi-stemmed, layered spreading branches, delicate tiers
//   ginkgo (银杏)  tall ovoid crown with a central leader and ascending limbs
//   peach (桃)     small open vase, dark twigs, blossom geometry along the one-year shoots at LOD0
//   pine (松)      黄山松 / 马尾松: twisted leaning trunk, near-horizontal limbs fanning out into flat needle
//                  plates (needle-burst cards over a dark flattened core), orange upper bark
//
//   buildTree(species, seed, opts) → { H, R, lods: [{bark, inner, blob, card, flower, tris}, ... 3] }
//   buildPine(seed, style, opts)   → same shape
// LOD0 hero: every branch a tube + leaf cards per cluster (+ dark inner clumps), LOD1: limbs + big cards +
// clumps, LOD2: trunk + clumps + a few cards, LOD3: camera-facing billboard (built by the library).
import { GeoBuilder, v3, perp, rotAxis, clamp, lerp, smoothstep, addBlob, addCard, addTube, clusterBlobs } from './util.js';
import { cellRect, cellOf, T, PATCH } from './atlas.js';
import { Simplex } from '../core/noise.js';
import { RNG, hashString } from '../core/rng.js';

const SPEC = {
  camphor: {
    trunkH: [2.4, 3.6], trunkR: [0.34, 0.5], stems: [1, 1], gnarl: 0.45, twist: 0.25, flare: 0.35,
    limbs: [4, 6], limbAng: [0.45, 0.95], limbLen: [3.8, 6.0], depth: 3, kids: [3, 5], kidLen: 0.62,
    tropism: 0.2, wander: 0.35, crownW: [12.0, 17.0], crownH: [8.5, 12.0], cy: 0.55,
    clusterR: [0.85, 1.25], cards: 4, card: T.camphor, inner: 0.95, flat: 0.92, lobes: 0.22, extra: 70, leader: true,
  },
  broad: {
    trunkH: [2.2, 4.0], trunkR: [0.24, 0.36], stems: [1, 1], gnarl: 0.3, twist: 0.3, flare: 0.25,
    limbs: [4, 6], limbAng: [0.45, 0.85], limbLen: [2.8, 4.2], depth: 3, kids: [3, 5], kidLen: 0.62,
    tropism: 0.25, wander: 0.35, crownW: [8.0, 12.0], crownH: [7.0, 10.0], cy: 0.55,
    clusterR: [0.7, 1.0], cards: 4, card: T.broad, inner: 0.85, flat: 0.92, lobes: 0.26, extra: 60, leader: true,
  },
  maple: {
    trunkH: [1.0, 1.8], trunkR: [0.13, 0.22], stems: [1, 3], gnarl: 0.35, twist: 0.3, flare: 0.2,
    limbs: [4, 6], limbAng: [0.6, 1.05], limbLen: [2.2, 3.6], depth: 3, kids: [3, 5], kidLen: 0.66,
    tropism: 0.12, wander: 0.4, crownW: [6.5, 9.5], crownH: [5.0, 7.0], cy: 0.52,
    clusterR: [0.42, 0.6], cards: 5, card: T.maple, inner: 0.1, flat: 0.75, lobes: 0.3, extra: 85,
  },
  ginkgo: {
    trunkH: [3.0, 4.5], trunkR: [0.28, 0.42], stems: [1, 1], gnarl: 0.2, twist: 0.1, flare: 0.25,
    limbs: [5, 8], limbAng: [0.45, 0.8], limbLen: [3.0, 4.8], depth: 3, kids: [3, 4], kidLen: 0.6,
    tropism: 0.35, wander: 0.25, crownW: [7.0, 10.0], crownH: [10.0, 14.0], cy: 0.5,
    clusterR: [0.6, 0.9], cards: 4, card: T.ginkgo, inner: 0.12, flat: 0.9, lobes: 0.2, extra: 60, leader: true, whorls: true,
  },
  // low evergreen shrub (茶 / 杜鹃 / 桂-like understorey): many thin stems from the ground, a dense mound
  shrub: {
    trunkH: [0.05, 0.15], trunkR: [0.025, 0.04], stems: [4, 7], gnarl: 0.3, twist: 0.3, flare: 0,
    limbs: [0, 0], limbAng: [0.3, 0.7], limbLen: [0.8, 1.2], depth: 2, kids: [2, 3], kidLen: 0.6,
    tropism: 0.3, wander: 0.4, crownW: [1.4, 2.4], crownH: [0.9, 1.5], cy: 0.5,
    clusterR: [0.28, 0.4], cards: 4, card: T.shrub, inner: 0.7, flat: 0.85, lobes: 0.3, extra: 30, shrubby: true,
  },
  peach: {
    trunkH: [0.7, 1.2], trunkR: [0.1, 0.15], stems: [1, 1], gnarl: 0.55, twist: 0.4, flare: 0.15,
    limbs: [4, 5], limbAng: [0.55, 1.0], limbLen: [1.8, 2.8], depth: 5, kids: [3, 4], kidLen: 0.66,
    tropism: 0.35, wander: 0.45, crownW: [4.5, 6.5], crownH: [3.2, 4.4], cy: 0.55,
    clusterR: [0.3, 0.42], cards: 2, card: T.peach, inner: 0, flat: 0.85, lobes: 0.3, extra: 0, flowers: true, minR: 0.0025, noBlob: true,
  },
};

/** shared crown helpers built from a spec + random draws */
function crownFrame(S, rng, nz, scale) {
  const trunkH = rng.range(...S.trunkH) * scale;
  const crownW = rng.range(...S.crownW) * scale;
  const crownH = rng.range(...S.crownH) * scale;
  const lean = [rng.range(-1, 1) * 0.1, rng.range(-1, 1) * 0.1];
  const cc = [lean[0] * (trunkH + crownH * 0.5), trunkH + crownH * S.cy, lean[1] * (trunkH + crownH * 0.5)];
  const envR = (d) => 1 + S.lobes * nz.noise3(d[0] * 1.7, d[1] * 1.7, d[2] * 1.7) + 0.1 * nz.noise3(d[0] * 4 + 5, d[1] * 4, d[2] * 4);
  const insideEnv = (p, k = 1) => {
    const d = [(p[0] - cc[0]) / (crownW * 0.5), (p[1] - cc[1]) / (crownH * 0.5), (p[2] - cc[2]) / (crownW * 0.5)];
    const l = v3.len(d);
    return l / envR(v3.norm(d)) < k;
  };
  return { trunkH, crownW, crownH, lean, cc, envR, insideEnv };
}

export function buildTree(species, seed, opts = {}) {
  const S = { ...SPEC[species], ...(opts.spec || {}) };
  const rng = new RNG(`hz-tree:${species}:${seed}`);
  const nz = new Simplex(hashString(`hz-treeN:${species}:${seed}`));
  const scale = opts.scale || 1;
  const F = crownFrame(S, rng, nz, scale);
  const { trunkH, crownW, crownH, lean, cc, envR, insideEnv } = F;

  // ------------------------------------------------------------------ skeleton
  const branches = [];
  const clusters = []; // {p, r, rnd, d (growth dir at the tip)}
  const grow = (start, dir, len, r0, depth, parentTaper = 0.55) => {
    const n = clamp(Math.round(len / 0.2), 3, 16);
    const pts = [start], rad = [r0];
    let d = dir, p = start;
    const seedK = rng.random() * 100;
    for (let i = 1; i <= n; i++) {
      const t = i / n;
      const w = [nz.noise3(p[0] * 0.9 + seedK, p[1] * 0.9, p[2] * 0.9), nz.noise3(p[0] * 0.9, p[1] * 0.9 + seedK, p[2] * 0.9) * 0.6, nz.noise3(p[0] * 0.9, p[1] * 0.9, p[2] * 0.9 + seedK)];
      const out = v3.norm([p[0] - cc[0] + 1e-3, 0, p[2] - cc[2]]);
      d = v3.norm(v3.add(v3.add(d, v3.mul(w, S.wander * (depth === 0 ? S.gnarl * 1.2 : 1) * 0.35)), [out[0] * 0.05, S.tropism * 0.25, out[2] * 0.05]));
      if (S.tiers && depth >= 1) d = v3.norm([d[0], d[1] * 0.6 + 0.01, d[2]]); // maple: layered, near-horizontal shoots
      p = v3.mad(p, d, len / n);
      pts.push(p);
      rad.push(r0 * (1 - (1 - parentTaper) * t));
      if (depth > 0 && !insideEnv(p, 1.08) && i > 1) break;
    }
    const isLast = depth >= S.depth;
    {
      const m = pts.length, endK = isLast || depth >= S.depth - 1 ? 0.16 : Math.min(parentTaper, 0.32);
      for (let k = 0; k < m; k++) rad[k] = r0 * (1 - (1 - endK) * Math.pow(k / (m - 1), 0.85));
    }
    const b = { pts, rad, depth };
    branches.push(b);
    if (isLast || rad[rad.length - 1] < (S.minR ?? 0.012)) {
      const e = pts[pts.length - 1];
      const dd = v3.norm(v3.sub(e, pts[Math.max(0, pts.length - 3)]));
      clusters.push({ p: e, r: rng.range(...S.clusterR) * Math.sqrt(scale), rnd: rng.random(), d: dd });
      if (pts.length > 3) clusters.push({ p: pts[Math.floor(pts.length * 0.55)], r: rng.range(...S.clusterR) * 0.8 * Math.sqrt(scale), rnd: rng.random(), d: dd });
      return;
    }
    const nk = rng.int(...S.kids);
    for (let k = 0; k < nk; k++) {
      const t = lerp(depth === 0 ? 0.55 : 0.32, 0.95, (k + rng.random() * 0.7) / nk);
      const idx = clamp(Math.round(t * (pts.length - 1)), 1, pts.length - 1);
      const base = pts[idx];
      const pd = v3.norm(v3.sub(pts[idx], pts[idx - 1]));
      const ang = rng.range(0.4, 0.9) * (depth === 0 ? 1 : 0.9);
      const around = rng.random() * Math.PI * 2;
      let cd = rotAxis(pd, rotAxis(perp(pd), pd, around), ang);
      const toOut = v3.norm(v3.sub(v3.add(cc, v3.mul(v3.norm(v3.sub(base, cc)), crownW * 0.5)), base));
      cd = v3.norm(v3.add(cd, v3.mul(toOut, 0.35)));
      grow(base, cd, len * S.kidLen * rng.range(0.8, 1.15), rad[idx] * rng.range(0.5, 0.66), depth + 1);
    }
  };

  const stems = rng.int(...S.stems);
  const trunkTops = [];
  if (S.shrubby) {
    for (let s = 0; s < stems; s++) {
      const a0 = (s / stems) * Math.PI * 2 + rng.random();
      const base = [Math.cos(a0) * 0.08 * scale, -0.1, Math.sin(a0) * 0.08 * scale];
      const dir = v3.norm([Math.cos(a0) * 0.55, 1, Math.sin(a0) * 0.55]);
      grow(base, dir, crownH * rng.range(0.7, 1.0), rng.range(...S.trunkR) * scale, 1, 0.35);
    }
  }
  for (let s = 0; s < (S.shrubby ? 0 : stems); s++) {
    const a0 = (s / stems) * Math.PI * 2 + rng.random();
    const off = stems > 1 ? rng.range(0.06, 0.18) * scale : 0;
    const r0 = rng.range(...S.trunkR) * scale / Math.sqrt(stems);
    const n = 14;
    const pts = [], rad = [];
    const splay = stems > 1 ? 0.35 : 0;
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const y = -0.4 + (trunkH + 0.4) * t;
      const helix = stems > 1 ? a0 + t * S.twist * 1.5 : 0;
      const rr = off + splay * Math.max(0, y) * 0.3;
      const wob = S.gnarl * 0.25 * scale;
      pts.push([
        Math.cos(helix) * rr + lean[0] * y + wob * nz.noise2(t * 2.2, s * 3.1 + 1),
        y,
        Math.sin(helix) * rr + lean[1] * y + wob * nz.noise2(t * 2.2, s * 3.1 + 7),
      ]);
      rad.push(r0 * (1.3 - 0.3 * Math.pow(t, 0.5)) * (i === 0 ? 1.2 : 1) * (1 + 0.15 * S.gnarl * nz.noise2(t * 5, s)));
    }
    branches.push({ pts, rad, depth: 0, trunk: true });
    trunkTops.push({ p: pts[n], d: v3.norm(v3.sub(pts[n], pts[n - 2])), r: rad[n] });
  }
  const nl = S.shrubby ? 0 : rng.int(...S.limbs);
  for (let l = 0; l < nl; l++) {
    const tt = trunkTops[l % trunkTops.length];
    const around = (l / nl) * Math.PI * 2 + rng.range(-0.4, 0.4);
    const ang = rng.range(...S.limbAng);
    const dir = v3.norm([Math.cos(around) * Math.sin(ang), Math.cos(ang), Math.sin(around) * Math.sin(ang)]);
    const d = v3.norm(v3.add(dir, v3.mul(tt.d, 0.3)));
    let base = tt.p, r = tt.r * rng.range(0.6, 0.78), len = rng.range(...S.limbLen) * scale;
    if (S.whorls) {
      // ginkgo: limbs in whorls along a tall leader instead of all from the trunk top
      const hy = trunkH + crownH * (0.08 + 0.7 * (l / nl));
      base = [lean[0] * hy, hy, lean[1] * hy];
      r = tt.r * (0.55 - 0.3 * (l / nl));
      len *= 1.15 - 0.55 * (l / nl);
    }
    grow(base, d, len, r, 1);
  }
  if (S.leader && trunkTops.length) {
    const lh = S.whorls ? crownH * 0.95 : crownH * 0.6;
    grow(trunkTops[0].p, v3.norm([lean[0], 1, lean[1]]), lh, trunkTops[0].r * (S.whorls ? 0.85 : 0.7), S.whorls ? 0 : 1, S.whorls ? 0.25 : 0.55);
  }
  // fill the envelope: extra clusters on the outer shell so the crown reads as a full, lumpy mass
  const extra = Math.round(S.extra * (S.inner + 0.3));
  if (!S.extra) { /* no shell clusters (peach: airy crown) */ }
  for (let i = 0; i < extra; i++) {
    const d = v3.norm(rng.sphere());
    if (d[1] < (S.shrubby ? -0.3 : -0.5)) continue;
    const k = rng.range(0.55, 0.95) * envR(d);
    const p = [cc[0] + d[0] * crownW * 0.5 * k, cc[1] + d[1] * crownH * 0.5 * k, cc[2] + d[2] * crownW * 0.5 * k];
    clusters.push({ p, r: rng.range(...S.clusterR) * Math.sqrt(scale) * 1.1, rnd: rng.random(), d });
  }
  if (S.tiers) {
    // maple: pull clusters into a few horizontal layers (the delicate tiered look)
    const nT = S.tiers;
    for (const c of clusters) {
      const t = clamp((c.p[1] - (cc[1] - crownH * 0.5)) / crownH, 0, 1);
      const ti = Math.round(t * (nT - 1));
      const ty = cc[1] - crownH * 0.4 + (ti / Math.max(1, nT - 1)) * crownH * 0.8;
      c.p = [c.p[0], lerp(c.p[1], ty, 0.55), c.p[2]];
    }
  }

  const H = Math.max(cc[1] + crownH * 0.5, ...clusters.map((c) => c.p[1] + c.r));
  const R = crownW * 0.5;
  const bentAt = (p) => v3.norm([(p[0] - cc[0]) / (crownW * 0.5), (p[1] - cc[1]) / (crownH * 0.5) + 0.15, (p[2] - cc[2]) / (crownW * 0.5)]);
  const depthAO = (p) => {
    const d = [(p[0] - cc[0]) / (crownW * 0.5), (p[1] - cc[1]) / (crownH * 0.5), (p[2] - cc[2]) / (crownW * 0.5)];
    const l = v3.len(d);
    return clamp(0.25 + 0.75 * smoothstep(0.2, 1.0, l) * (0.7 + 0.3 * smoothstep(-1, 0.6, d[1])), 0.12, 1);
  };
  const sway = (p) => clamp(Math.hypot(p[0], p[2]) / (crownW * 0.5) * 0.6 + p[1] / H * 0.5, 0, 1);
  const patchKey = { peach: 'blossom', broad: 'camphor' }[species] || species;
  const patch = cellRect(cellOf(...(PATCH[patchKey] || PATCH.camphor)), 0.08);
  const barkRect = [0, 0, 1, 1];

  function emitWood(gb, maxDepth, radials, minR) {
    for (const b of branches) {
      if (b.depth > maxDepth) continue;
      if (b.rad[0] < minR) continue;
      const radial = radials[Math.min(radials.length - 1, b.depth)];
      const step = radials[0] <= 5 ? 2 : 1;
      const pts = [], rad = [];
      for (let i = 0; i < b.pts.length; i += step) { pts.push(b.pts[i]); rad.push(b.rad[i]); }
      if (pts[pts.length - 1] !== b.pts[b.pts.length - 1]) { pts.push(b.pts[b.pts.length - 1]); rad.push(b.rad[b.rad.length - 1]); }
      addTube(gb, pts, rad, {
        radial, rect: barkRect, noise: nz, gnarl: b.depth === 0 ? S.gnarl * 0.45 : S.gnarl * 0.15, twist: S.twist, seed: b.pts.length,
        cap: b.depth > 0, flare: b.trunk ? S.flare : 0, flareLobes: 2.5,
        fol: (t, p) => [clamp(0.45 + 0.55 * (b.depth === 0 ? 1 - smoothstep(trunkH * 0.7, trunkH + 1, p[1]) * 0.4 : depthAO(p)), 0.2, 1), 0, 0.5, b.trunk ? clamp(p[1] / (trunkH * 3), 0, 0.3) : sway(p)],
      });
    }
  }
  function emitCards(gb, rngC, perCluster, sizeK = 1, keep = 1, mid = false) {
    for (const c of clusters) {
      if (keep < 1 && !rngC.chance(keep)) continue;
      const n = perCluster + (rngC.chance(0.4) ? 1 : 0);
      const bn = bentAt(c.p);
      for (let i = 0; i < n; i++) {
        let up = v3.norm(v3.add(v3.mul(bn, 0.7), [rngC.range(-0.6, 0.6), rngC.range(0.2, 0.9), rngC.range(-0.6, 0.6)]));
        if (S.tiers) up = v3.norm([up[0], up[1] * 0.4, up[2]]);
        const side = rotAxis(perp(up), up, rngC.random() * Math.PI * 2);
        const sz = c.r * rngC.range(1.35, 1.85) * sizeK;
        const o = v3.mad(v3.mad(c.p, up, -sz * 0.45), [rngC.range(-1, 1), rngC.range(-0.5, 0.5), rngC.range(-1, 1)], c.r * 0.25);
        const rect = cellRect(cellOf(S.card, 0), 0.0);
        if (mid) up = v3.norm(v3.add(up, v3.mul(rotAxis(perp(bn), bn, (i / n) * Math.PI * 2 + rngC.random()), 0.6)));
        const ao0 = depthAO(c.p);
        const lumpN = (p) => v3.norm(v3.add(v3.sub(p, c.p), v3.mul(bn, c.r * 0.35)));
        addCard(gb, o, up, side, sz * 0.92, sz, rect,
          (p) => v3.norm(v3.add(v3.add(v3.mul(bentAt(p), 0.6), v3.mul(lumpN(p), 0.65)), v3.mul(up, 0.1))),
          (p, t) => { const ln = lumpN(p); const lo = smoothstep(-0.7, 0.6, ln[1] * 0.8 + v3.dot(ln, bn) * 0.4); return [clamp(ao0 * (0.5 + 0.55 * lo) * (0.8 + 0.25 * t), 0.06, 1), t * smoothstep(0.3, 0.9, ao0) * lo, c.rnd, sway(p)]; },
          rngC.range(0.0, 0.18), rngC.chance(0.5));
      }
    }
  }
  function emitBlobs(gb, blobs, seg, inflate, bright = 1) {
    for (const b of blobs) {
      const bn = bentAt(b.p);
      const ax = v3.norm([bn[0] * 0.3, 1, bn[2] * 0.3]);
      const b1 = perp(ax), b2 = v3.cross(ax, b1);
      const ao0 = depthAO(b.p);
      addBlob(gb, b.p, ax, b1, b2, b.r * inflate * S.flat, b.r * inflate, b.r * inflate * 0.95, {
        lon: seg[0], lat: seg[1], rect: patch, lump: 0.34, noise: nz, seed: b.rnd * 7,
        normalFn: (p, nl) => v3.norm(v3.add(v3.mul(nl, 0.68), v3.mul(bentAt(p), 0.55))),
        fol: (p, nl, ph) => {
          const out = v3.dot(nl, bentAt(p));
          return [clamp(bright * ao0 * (0.45 + 0.55 * smoothstep(-0.6, 0.8, out)) * (0.7 + 0.3 * ph), 0.08, 1), bright * smoothstep(0.5, 1, ph) * smoothstep(0, 0.9, out) * ao0, b.rnd, sway(p)];
        },
      });
    }
  }
  /** peach blossom geometry (碧桃, the double ornamental peach of West Lake): two rings of 5 rounded, cupped
   *  petals around a rose eye, clustered 1-3 per node along the finest shoots. uv.y 0 eye → 1 petal rim */
  function emitFlowers(gb, rngF, density) {
    let n = 0;
    const flower = (c, out, r, f) => {
      const s1 = perp(out), s2 = v3.cross(out, s1);
      const ci = gb.v(c[0], c[1], c[2], out[0], out[1], out[2], 0.5, 0.0, f[0], f[1], f[2], f[3], 0, 0);
      const open = rngF.range(0.7, 1.0);
      for (let layer = 0; layer < 2; layer++) {
        const rot = rngF.random() * 6.28 + layer * 0.63;
        const R = r * (layer ? 0.72 : 1);
        const lift = layer ? r * 0.12 : 0;
        const N = layer ? 15 : 20, ring = [];
        for (let q = 0; q < N; q++) {
          const a = rot + (q / N) * Math.PI * 2;
          const lobe = Math.pow(Math.abs(Math.sin(2.5 * (a - rot) + Math.PI / 2)), 0.45);
          const rr = R * (0.4 + 0.6 * lobe);
          const cup = R * (0.15 + 0.45 * (1 - open) + layer * 0.25) * (rr / R) * (rr / R) + lift;
          const p = v3.add(v3.add(v3.mad(c, s1, Math.cos(a) * rr), v3.mul(s2, Math.sin(a) * rr)), v3.mul(out, cup));
          const nn = v3.norm(v3.add(out, v3.mul(v3.norm(v3.sub(p, c)), -0.3 - layer * 0.2)));
          ring.push(gb.v(p[0], p[1], p[2], nn[0], nn[1], nn[2], q / N, (rr / R) * (layer ? 0.85 : 1), f[0], f[1], f[2], f[3], 0, 0));
        }
        for (let q = 0; q < N; q++) gb.tri(ci, ring[q], ring[(q + 1) % N]);
      }
      n++;
    };
    for (const b of branches) {
      if (b.depth < 2) continue;
      const fine = b.depth >= S.depth - 2;
      let acc = rngF.random() * 0.03;
      for (let i = 1; i < b.pts.length; i++) {
        const seg = v3.sub(b.pts[i], b.pts[i - 1]), sl = v3.len(seg);
        const td = v3.norm(seg);
        acc += sl;
        const gap = (fine ? 1 : 1.8) / density;
        while (acc > gap) {
          acc -= gap * rngF.range(0.6, 1.4);
          const p0 = v3.mad(b.pts[i - 1], seg, rngF.random());
          const k = rngF.chance(0.35) ? 2 : rngF.chance(0.2) ? 3 : 1;
          for (let j = 0; j < k; j++) {
            const out = v3.norm(v3.add(v3.add(rotAxis(perp(td), td, rngF.random() * 6.28), v3.mul(bentAt(p0), 0.45)), v3.mul(td, 0.25)));
            const r = rngF.range(0.016, 0.022);
            const c = v3.mad(p0, out, 0.008 + j * 0.01);
            flower(c, out, r, [depthAO(c), 1, rngF.random(), sway(c)]);
          }
        }
      }
    }
    return n;
  }

  const lods = [];
  // LOD0
  {
    const bark = new GeoBuilder(), inner = new GeoBuilder(), card = new GeoBuilder(), flower = new GeoBuilder();
    emitWood(bark, 9, [12, 8, 5, 4, 3], 0.0025);
    if (S.cards > 0) emitCards(card, new RNG('cards' + seed + species), S.cards);
    if (S.inner > 0.05) emitBlobs(inner, clusterBlobs(clusters, Math.max(4, Math.round(clusters.length * 0.18)), new RNG('km0' + seed), S.clusterR[1] * scale), [8, 5], 0.38 * S.inner + 0.1, 0.5);
    if (S.flowers) emitFlowers(flower, new RNG('fl' + seed), opts.flowerDensity ?? 52);
    lods.push({ bark: bark.build(), inner: inner.count ? inner.build() : null, card: card.count ? card.build() : null, flower: flower.count ? flower.build() : null, tris: bark.triangles + inner.triangles + card.triangles + flower.triangles });
  }
  // LOD1 (≈ 45-170 px): limbs + two cards per cluster over a small dark core (cards make the silhouette)
  {
    const bark = new GeoBuilder(), blob = new GeoBuilder(), card = new GeoBuilder();
    emitWood(bark, S.noBlob ? 2 : 1, [7, 5, 3], S.noBlob ? 0.01 : 0.03);
    if (!S.noBlob) emitBlobs(blob, clusterBlobs(clusters, 24, new RNG('km1' + seed), S.clusterR[1] * scale), [6, 4], 0.5, 0.6);
    emitCards(card, new RNG('cards1' + seed + species), 2, S.noBlob ? 1.1 : 1.3, 1.0, true);
    lods.push({ bark: bark.count ? bark.build() : null, blob: blob.count ? blob.build() : null, card: card.build(), tris: bark.triangles + blob.triangles + card.triangles });
  }
  // LOD2 (≈ 12-45 px): trunk + a dark core + one big card on most clusters
  {
    const bark = new GeoBuilder(), blob = new GeoBuilder(), card = new GeoBuilder();
    emitWood(bark, S.noBlob ? 1 : 0, [3, 3], 0.04);
    if (!S.noBlob) emitBlobs(blob, clusterBlobs(clusters, 6, new RNG('km2' + seed), S.clusterR[1] * scale * 1.3), [5, 3], 0.8, 0.75);
    emitCards(card, new RNG('cards2' + seed + species), 1, S.noBlob ? 1.8 : 2.3, S.noBlob ? 0.4 : 0.22, true);
    lods.push({ bark: bark.count ? bark.build() : null, blob: blob.count ? blob.build() : null, card: card.count ? card.build() : null, tris: bark.triangles + blob.triangles + card.triangles });
  }
  return { H, R, lods, clusters: clusters.length, branches: branches.length, trunkH, crownW, crownH };
}

// ======================================================================== pine
const PINE = {
  // 黄山松: flat, wide, tiered crown on a twisted leaning trunk (palace slopes, cliff edges)
  huangshan: { H: [8, 12], trunkR: [0.22, 0.34], lean: 0.32, bend: 0.5, crownStart: 0.42, tiers: [4, 6], limbLen: [3.4, 5.6], topFlat: 0.8, droop: 0.12, tuftR: [0.26, 0.38] },
  // 马尾松: taller, irregular clumped crown, orange upper bark (the 宝石山 foreground)
  masson: { H: [11, 16], trunkR: [0.24, 0.36], lean: 0.16, bend: 0.3, crownStart: 0.5, tiers: [5, 8], limbLen: [2.4, 4.2], topFlat: 0.25, droop: 0.06, tuftR: [0.24, 0.36] },
};

export function buildPine(seed, style = 'huangshan', opts = {}) {
  const P = PINE[style];
  const rng = new RNG(`hz-pine:${style}:${seed}`);
  const nz = new Simplex(hashString(`hz-pineN:${style}:${seed}`));
  const H0 = rng.range(...P.H) * (opts.scale || 1);
  const branches = [];
  // ---- trunk: leaning, with two or three bends (the twisted 黄山松 trunk)
  const leanA = rng.random() * Math.PI * 2, leanK = rng.range(0.4, 1) * P.lean;
  const tp = [], tr = [];
  const n = 22;
  const r0 = rng.range(...P.trunkR);
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const y = -0.4 + (H0 + 0.4) * t;
    const kink = P.bend * (nz.noise2(t * 2.6, 3.3) * 1.2 + 0.4 * nz.noise2(t * 6, 9.1)) * t;
    const x = Math.cos(leanA) * leanK * y + Math.cos(leanA + 1.6) * kink * 1.2;
    const z = Math.sin(leanA) * leanK * y + Math.sin(leanA + 1.6) * kink * 1.2;
    tp.push([x, y, z]);
    tr.push(r0 * (1.25 - 0.95 * Math.pow(t, 0.8)) * (i === 0 ? 1.25 : 1) * (1 + 0.08 * nz.noise2(t * 8, 1)));
  }
  branches.push({ pts: tp, rad: tr, depth: 0, trunk: true });
  const at = (t) => { const f = t * n, i = Math.min(n - 1, Math.floor(f)), u = f - i; return [v3.lerp(tp[i], tp[i + 1], u), lerp(tr[i], tr[i + 1], u)]; };
  // ---- limbs in tiers: near-horizontal, drooping a little, tips turning up; sub-branches fan out sideways.
  // Needles grow as brush-like tufts on the outer parts of the finer shoots (黑松 / 马尾松 "candles").
  const tufts = []; // {p, d (upturned shoot axis), r, rnd}
  const nT = rng.int(...P.tiers);
  const growLimb = (base, dir, len, rad, depth) => {
    const pts = [base], rr = [rad];
    let d = dir, p = base;
    const segs = clamp(Math.round(len / 0.25), 4, 18);
    for (let i = 1; i <= segs; i++) {
      const t = i / segs;
      d = v3.norm([d[0] + nz.noise3(p[0], p[1], p[2] + depth) * 0.14, d[1] - P.droop * (1 - t) + 0.25 * t * t, d[2] + nz.noise3(p[2], p[0], p[1] + depth) * 0.14]);
      p = v3.mad(p, d, len / segs);
      pts.push(p); rr.push(rad * (1 - 0.65 * t));
    }
    branches.push({ pts, rad: rr, depth });
    // tufts along the outer part of the shoot and a bigger one at its tip
    if (depth >= 2) {
      const every = depth >= 3 ? 0.13 : 0.17;
      let acc = 0;
      for (let i = 1; i < pts.length; i++) {
        acc += v3.len(v3.sub(pts[i], pts[i - 1]));
        if (i / pts.length < 0.3) continue;
        while (acc > every) {
          acc -= every;
          const q = v3.lerp(pts[i - 1], pts[i], rng.random());
          const sd = v3.norm(v3.add(v3.add(rotAxis(perp(d), d, rng.random() * 6.28), [0, 1.2, 0]), v3.mul(d, 0.4)));
          tufts.push({ p: q, d: sd, r: rng.range(...P.tuftR) * 0.8, rnd: rng.random() });
        }
      }
    }
    if (depth >= 3) {
      tufts.push({ p: pts[pts.length - 1], d: v3.norm(v3.add(d, [0, 0.9, 0])), r: rng.range(...P.tuftR), rnd: rng.random() });
      return;
    }
    const side = v3.norm(v3.cross(d, [0, 1, 0]));
    const nk = depth === 1 ? rng.int(4, 6) : rng.int(3, 4);
    for (let k = 0; k < nk; k++) {
      const t = lerp(0.25, 0.95, (k + rng.random() * 0.6) / nk);
      const idx = clamp(Math.round(t * (pts.length - 1)), 1, pts.length - 1);
      const sg = k % 2 ? 1 : -1;
      const cd = v3.norm(v3.add(v3.add(v3.mul(d, 0.6), v3.mul(side, sg * rng.range(0.5, 0.95))), [0, rng.range(0.0, 0.25), 0]));
      growLimb(pts[idx], cd, len * rng.range(0.4, 0.58), rr[idx] * 0.6, depth + 1);
    }
    tufts.push({ p: pts[pts.length - 1], d: v3.norm(v3.add(d, [0, 0.8, 0])), r: rng.range(...P.tuftR) * 1.15, rnd: rng.random() });
  };
  for (let k = 0; k < nT; k++) {
    const t = P.crownStart + (1 - P.crownStart) * (k / nT) * 0.92 + rng.range(0, 0.04);
    const [base, rad] = at(t);
    const nb = k === nT - 1 ? rng.int(2, 3) : rng.int(1, 3);
    for (let j = 0; j < nb; j++) {
      const a = rng.random() * Math.PI * 2 + j * 2.4;
      const top = t > 0.88;
      const len = rng.range(...P.limbLen) * (top ? lerp(0.55, 1.0, P.topFlat) : 1 - 0.35 * (t - P.crownStart)) * (opts.scale || 1);
      const dir = v3.norm([Math.cos(a), top ? 0.35 : rng.range(-0.05, 0.25), Math.sin(a)]);
      growLimb(base, dir, len, rad * rng.range(0.45, 0.65), 1);
    }
  }
  // the leader's own tufts
  for (let k = 0; k < 5; k++) tufts.push({ p: v3.add(tp[n], [rng.range(-0.3, 0.3), rng.range(-0.4, 0.1), rng.range(-0.3, 0.3)]), d: v3.norm([rng.range(-0.4, 0.4), 1, rng.range(-0.4, 0.4)]), r: P.tuftR[1], rnd: rng.random() });
  const plates = tufts;
  // crown frame for lighting
  const mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
  for (const p of plates) for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], p.p[k] - p.r); mx[k] = Math.max(mx[k], p.p[k] + p.r); }
  const cc = v3.mul(v3.add(mn, mx), 0.5), ext = v3.mul(v3.sub(mx, mn), 0.5);
  const H = mx[1] + 0.3, R = Math.max(Math.abs(mn[0]), Math.abs(mx[0]), Math.abs(mn[2]), Math.abs(mx[2]));
  const bentAt = (p) => v3.norm([(p[0] - cc[0]) / Math.max(1, ext[0]), (p[1] - cc[1]) / Math.max(1, ext[1]) + 0.3, (p[2] - cc[2]) / Math.max(1, ext[2])]);
  const plateAO = (p) => clamp(0.3 + 0.7 * smoothstep(-0.8, 0.9, (p[1] - cc[1]) / Math.max(1, ext[1])) * (0.6 + 0.4 * smoothstep(0, 1, Math.hypot(p[0] - cc[0], p[2] - cc[2]) / Math.max(1, Math.max(ext[0], ext[2])))), 0.15, 1);
  const sway = (p) => clamp(p[1] / H * 0.6 + Math.hypot(p[0] - tp[n][0], p[2] - tp[n][2]) / 6 * 0.4, 0, 1);
  const patch = cellRect(cellOf(...PATCH.pine), 0.08);

  function emitWood(gb, maxDepth, radials, minR, stepK = 1) {
    for (const b of branches) {
      if (b.depth > maxDepth || b.rad[0] < minR) continue;
      const radial = radials[Math.min(radials.length - 1, b.depth)];
      // fine shoots: every other point is enough (they are thin and mostly hidden in the tufts)
      let pts = b.pts, rad = b.rad;
      const step = Math.max(b.depth >= 2 ? 2 : 1, stepK);
      if (step > 1 && pts.length > 4) {
        pts = []; rad = [];
        for (let i = 0; i < b.pts.length; i += step) { pts.push(b.pts[i]); rad.push(b.rad[i]); }
        if (pts[pts.length - 1] !== b.pts[b.pts.length - 1]) { pts.push(b.pts[b.pts.length - 1]); rad.push(b.rad[b.rad.length - 1]); }
      }
      addTube(gb, pts, rad, {
        radial, noise: nz, gnarl: b.depth === 0 ? 0.25 : 0.08, twist: 0.4, seed: b.pts.length, cap: b.depth > 0, flare: b.trunk ? 0.3 : 0, flareLobes: 2.5,
        fol: (t, p) => [b.depth === 0 ? 0.85 : clamp(plateAO(p) + 0.2, 0.2, 1), 0, b.depth <= 1 ? 1 - 0.5 * b.depth : 0, b.trunk ? clamp(p[1] / H, 0, 1) * 0.4 + 0.2 : clamp(0.4 + p[1] / H * 0.6, 0, 1)],
      });
    }
  }
  /** needle tufts: 2-3 burst cards crossed around the (upturned) shoot axis — a brush from every side */
  function emitTufts(gb, rngC, perTuft, sizeK = 1, keep = 1) {
    for (const c of tufts) {
      if (keep < 1 && !rngC.chance(keep)) continue;
      const ao0 = plateAO(c.p);
      const ax = c.d;
      const s0 = perp(ax);
      const rot0 = rngC.random() * Math.PI;
      const sz = c.r * rngC.range(1.6, 2.1) * sizeK;
      for (let i = 0; i < perTuft; i++) {
        const side = rotAxis(s0, ax, rot0 + (i / perTuft) * Math.PI);
        const o = v3.mad(c.p, ax, -sz * 0.28);
        const rect = cellRect(cellOf(T.pineBurst, (i + Math.floor(c.rnd * 4)) % 4));
        addCard(gb, o, ax, side, sz * 1.15, sz, rect,
          (p) => v3.norm(v3.add(v3.mul(bentAt(p), 0.5), v3.add(v3.mul(v3.norm(v3.sub(p, c.p)), 0.45), [0, 0.5, 0]))),
          (p, t) => [clamp(ao0 * (0.55 + 0.5 * t), 0.08, 1), t * ao0, c.rnd, sway(p)],
          rngC.range(0, 0.1), rngC.chance(0.5));
      }
    }
  }
  /** dark flattened cores (mid / far LODs): keep a plate solid once single tufts are too small to read */
  function emitCores(gb, plist, seg, inflate) {
    for (const c of plist) {
      const ao0 = plateAO(c.p);
      addBlob(gb, v3.add(c.p, [0, -c.r * 0.1, 0]), [0, 1, 0], [1, 0, 0], [0, 0, 1], c.r * inflate * 0.45, c.r * inflate, c.r * inflate * 0.95, {
        lon: seg[0], lat: seg[1], rect: patch, lump: 0.35, noise: nz, seed: c.rnd * 7,
        normalFn: (p, nl) => v3.norm(v3.add(v3.mul(nl, 0.6), v3.mul(bentAt(p), 0.5))),
        fol: (p, nl, ph) => [clamp(ao0 * (0.35 + 0.65 * ph), 0.08, 1), smoothstep(0.6, 1, ph) * ao0, c.rnd, sway(p)],
      });
    }
  }
  const lods = [];
  {
    const bark = new GeoBuilder(), card = new GeoBuilder();
    emitWood(bark, 9, [10, 6, 4, 3], 0.005);
    emitTufts(card, new RNG('pc' + seed), 3);
    lods.push({ bark: bark.build(), card: card.build(), tris: bark.triangles + card.triangles });
  }
  {
    const bark = new GeoBuilder(), blob = new GeoBuilder(), card = new GeoBuilder();
    emitWood(bark, 1, [6, 4], 0.05, 2);
    emitCores(blob, clusterBlobs(tufts, Math.max(10, Math.round(tufts.length * 0.06)), new RNG('pk1' + seed), 0.6), [6, 3], 0.9);
    emitTufts(card, new RNG('pc1' + seed), 2, 1.9, 0.19);
    lods.push({ bark: bark.build(), blob: blob.build(), card: card.build(), tris: bark.triangles + blob.triangles + card.triangles });
  }
  {
    const bark = new GeoBuilder(), blob = new GeoBuilder(), card = new GeoBuilder();
    emitWood(bark, 1, [3, 3], 0.11, 3);
    emitCores(blob, clusterBlobs(tufts, 6, new RNG('pk2' + seed), 1.1), [5, 3], 1.05);
    emitTufts(card, new RNG('pc2' + seed), 1, 2.8, 0.06);
    lods.push({ bark: bark.build(), blob: blob.build(), card: card.count ? card.build() : null, tris: bark.triangles + blob.triangles + card.triangles });
  }
  return { H, R, lods, tufts: tufts.length, branches: branches.length };
}
