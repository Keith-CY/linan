// Canvas-drawn foliage atlas (no external assets): one 4096² texture, 8×8 cells of 512².
// The coverage-preserving mip chain (buildTexture) is derived from Athenaion's src/vegetation/atlas.js (MIT);
// every drawing here (willow strands, peach blossom, pine needle bursts, camphor / maple / ginkgo twigs,
// ferns, ivy, litter…) is ours.
//
// Layout: a card TYPE is a column; within the top half (rows 0-3) or the bottom half (rows 4-7) the four rows
// are the four SEASONS (spring, summer, autumn, winter). A material switches season by shifting its v
// coordinate by whole rows (uniform uSeasonRow), so one geometry serves every season.
//   column  top half (types 0-7)                bottom half (types 8-15)
//   0       willow strand (one hanging twig)    ginkgo twig
//   1       willow curtain (5-7 strands)        dense patches A (camphor, pine, willow, blossom)  [no season]
//   2       peach twig (blossom/leaves/…/bare)  dense patches B (maple, ginkgo, bare twigs, shrub) [no season]
//   3       pine needle burst (4 variants)      grass card (green / green / straw / dead)
//   4       pine side spray (4 variants)        fern fronds (3 variants + moss)
//   5       camphor twig                        ivy / vine (ivy mat, vine strand, creeper red, ivy dark)
//   6       broadleaf (deciduous) twig          litter (petals, red/gold leaves, brown leaves, needles)
//   7       red maple twig                      shrub twigs (azalea, osmanthus, tea, reed plume)
import * as THREE from 'three';
import { RNG } from '../core/rng.js';

export const ATLAS_SIZE = 4096;
export const GRID = 8;
const CELL = ATLAS_SIZE / GRID;
export const SEASONS = ['spring', 'summer', 'autumn', 'winter'];

/** cell index of card type T in season s (0..3) */
export const cellOf = (type, s = 0) => (type < 8 ? s * GRID + type : (4 + s) * GRID + (type - 8));
export const T = {
  willow: 0, willowCurtain: 1, peach: 2, pineBurst: 3, pineSpray: 4, camphor: 5, broad: 6, maple: 7,
  ginkgo: 8, patchA: 9, patchB: 10, grass: 11, fern: 12, ivy: 13, litter: 14, shrub: 15,
};
// rows of the "no season" columns
export const PATCH = { camphor: [T.patchA, 0], pine: [T.patchA, 1], willow: [T.patchA, 2], blossom: [T.patchA, 3], maple: [T.patchB, 0], ginkgo: [T.patchB, 1], bare: [T.patchB, 2], shrub: [T.patchB, 3] };

function makeCanvas(w, h) {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  const c = document.createElement('canvas'); c.width = w; c.height = h; return c;
}
const cellXY = (i) => [(i % GRID) * CELL, Math.floor(i / GRID) * CELL];

/** atlas cell → uv rect [u0, v0, u1, v1] (v0 = top of the cell; the texture is not flipped) */
export function cellRect(cell, inset = 0.0) {
  const cx = cell % GRID, cy = Math.floor(cell / GRID), s = 1 / GRID;
  return [cx * s + inset * s, cy * s + inset * s, (cx + 1) * s - inset * s, (cy + 1) * s - inset * s];
}

function hexToRgb(h) { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
function mixHex(a, b, t, j = 0) {
  const A = hexToRgb(a), B = hexToRgb(b);
  const c = A.map((v, i) => Math.max(0, Math.min(255, Math.round((v + (B[i] - v) * t) * (1 + j)))));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}
const rgba = (hex, a) => { const c = hexToRgb(hex); return `rgba(${c[0]},${c[1]},${c[2]},${a})`; };

// ===================================================================== leaf shapes
function leafPath(ctx, L, W, shape, rng) {
  ctx.beginPath();
  if (shape === 'lance') {             // willow / peach: long, narrow, acuminate
    ctx.moveTo(0, 0);
    ctx.bezierCurveTo(W * 0.9, -L * 0.18, W * 0.85, -L * 0.6, 0, -L);
    ctx.bezierCurveTo(-W * 0.85, -L * 0.6, -W * 0.9, -L * 0.18, 0, 0);
  } else if (shape === 'ovate') {      // camphor: elliptic with a drip tip
    ctx.moveTo(0, 0);
    ctx.bezierCurveTo(W * 1.15, -L * 0.1, W * 1.2, -L * 0.62, W * 0.12, -L * 0.92);
    ctx.lineTo(0, -L);
    ctx.lineTo(-W * 0.12, -L * 0.92);
    ctx.bezierCurveTo(-W * 1.2, -L * 0.62, -W * 1.15, -L * 0.1, 0, 0);
  } else if (shape === 'broad') {      // generic deciduous: ovate, finely toothed
    const n = 14;
    ctx.moveTo(0, 0);
    for (let s = -1; s <= 1; s += 2) {
      const pts = [];
      for (let i = 1; i <= n; i++) {
        const t = i / n;
        const w = W * 1.15 * Math.sin(Math.PI * Math.pow(t, 0.8)) * (1 - 0.25 * t);
        pts.push([s * w * (i % 2 ? 1 : 0.93), -L * t]);
      }
      if (s < 0) { for (const p of pts) ctx.lineTo(p[0], p[1]); }
      else { for (let i = pts.length - 2; i >= 0; i--) ctx.lineTo(pts[i][0], pts[i][1]); ctx.lineTo(0, 0); }
    }
  } else if (shape === 'palmate') {    // Acer palmatum: 7 lanceolate, serrated lobes radiating from the petiole
    const offs = [-1.42, -0.95, -0.47, 0, 0.47, 0.95, 1.42], lens = [0.42, 0.72, 0.92, 1.0, 0.92, 0.72, 0.42];
    const cy = -L * 0.22;
    for (let k = 0; k < 7; k++) {
      const a = offs[k], len = L * lens[k] * 0.8, w = len * 0.17;
      const ca = Math.cos(a), sa = Math.sin(a);
      const P = (x, y) => [x * ca - y * sa, cy + x * sa + y * ca];
      const pts = [];
      const teeth = 9;
      for (let i = 0; i <= teeth; i++) { const t = i / teeth; const ww = w * Math.sin(Math.PI * Math.min(1, t * 1.05 + 0.08)) * (1 - 0.35 * t) * (i % 2 ? 1 : 0.8); pts.push([ww, -len * t]); }
      const first = P(0, 0); ctx.moveTo(first[0], first[1]);
      for (const q of pts) { const r = P(q[0], q[1]); ctx.lineTo(r[0], r[1]); }
      const tip = P(0, -len * 1.06); ctx.lineTo(tip[0], tip[1]);
      for (let i = pts.length - 1; i >= 0; i--) { const r = P(-pts[i][0], pts[i][1]); ctx.lineTo(r[0], r[1]); }
      ctx.closePath();
    }
    ctx.moveTo(0, 0); ctx.arc(0, cy, L * 0.12, 0, Math.PI * 2);
  } else if (shape === 'fan') {        // ginkgo: fan with a central notch, long petiole drawn separately
    const R = L, a0 = -Math.PI * 0.5 - 0.95, a1 = -Math.PI * 0.5 + 0.95;
    ctx.moveTo(0, 0);
    ctx.lineTo(Math.cos(a0) * R * 0.92, Math.sin(a0) * R * 0.92);
    const n = 16;
    for (let i = 0; i <= n; i++) {
      const t = i / n, a = a0 + (a1 - a0) * t;
      let r = R * (0.92 + 0.08 * Math.sin(Math.PI * t)) * (1 + 0.035 * Math.sin(t * 40 + (rng ? rng.random() : 0)));
      if (Math.abs(t - 0.5) < 0.05) r *= 0.78; // the notch
      ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    ctx.lineTo(0, 0);
  } else if (shape === 'ivy') {        // Hedera: 3-5 shallow lobes
    const pts = [[0, 0], [0.55, 0.1], [0.62, -0.25], [0.95, -0.42], [0.5, -0.55], [0.38, -0.9], [0, -1.0]];
    ctx.moveTo(0, 0);
    for (const s of [1, -1]) {
      const seq = s > 0 ? pts : pts.slice().reverse();
      for (const p of seq) ctx.lineTo(p[0] * W * s, p[1] * L);
    }
  } else { // needle
    ctx.moveTo(-W * 0.5, 0); ctx.lineTo(0, -L); ctx.lineTo(W * 0.5, 0);
  }
  ctx.closePath();
}

/** one leaf: gradient fill, midrib, veins, an edge shade that reads as a fold */
function drawLeaf(ctx, x, y, ang, L, W, shape, cols, rng, o = {}) {
  ctx.save();
  ctx.translate(x, y);
  if (o.sy) ctx.scale(1, o.sy);
  ctx.rotate(ang);
  leafPath(ctx, L, W, shape, rng);
  const j = (rng.random() - 0.5) * (o.jit ?? 0.4);
  const g = ctx.createLinearGradient(0, 0, 0, -L);
  g.addColorStop(0, mixHex(cols[0], cols[1], 0.0, j - 0.05));
  g.addColorStop(0.6, mixHex(cols[0], cols[1], 0.6, j));
  g.addColorStop(1, mixHex(cols[0], cols[1], 1.0, j + 0.05));
  ctx.fillStyle = g; ctx.fill();
  if (o.spot) { // blotches (autumn spotting, sun scorch)
    ctx.save(); ctx.clip();
    for (let i = 0; i < 3; i++) {
      ctx.fillStyle = rgba(o.spot, 0.25 + rng.random() * 0.3);
      ctx.beginPath(); ctx.ellipse((rng.random() - 0.5) * W, -L * rng.random(), W * (0.3 + rng.random() * 0.5), L * 0.15, rng.random() * 3, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }
  // one half a touch darker: the leaf is folded along the midrib
  ctx.save(); ctx.clip();
  ctx.fillStyle = `rgba(0,0,0,${o.fold ?? 0.13})`;
  ctx.fillRect(shape === 'fan' || shape === 'palmate' ? -L : -W * 1.5, -L * 1.1, shape === 'fan' || shape === 'palmate' ? L : W * 1.5, L * 1.2);
  // veins
  ctx.strokeStyle = o.vein || 'rgba(235,240,200,0.28)';
  ctx.lineWidth = Math.max(0.7, W * 0.08);
  if (shape === 'palmate') {
    const offs = [-1.42, -0.95, -0.47, 0, 0.47, 0.95, 1.42], lens = [0.42, 0.72, 0.92, 1.0, 0.92, 0.72, 0.42];
    for (let k = 0; k < 7; k++) { const a = offs[k]; ctx.beginPath(); ctx.moveTo(0, -L * 0.22); ctx.lineTo(Math.sin(a) * L * lens[k] * 0.75, -L * 0.22 - Math.cos(a) * L * lens[k] * 0.75); ctx.stroke(); }
  } else if (shape === 'fan') {
    ctx.lineWidth = 0.6; ctx.strokeStyle = 'rgba(255,240,160,0.18)';
    for (let k = 0; k < 14; k++) { const a = -Math.PI * 0.5 + (k / 13 - 0.5) * 1.8; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(Math.cos(a) * L, Math.sin(a) * L); ctx.stroke(); }
  } else if (shape !== 'needle') {
    ctx.beginPath(); ctx.moveTo(0, -L * 0.02); ctx.lineTo(0, -L * 0.92); ctx.stroke();
    if (o.lateral !== false && L > 14) {
      ctx.lineWidth = Math.max(0.5, W * 0.04);
      for (let i = 1; i < 6; i++) {
        const t = i / 6.5;
        for (const s of [-1, 1]) { ctx.beginPath(); ctx.moveTo(0, -L * t); ctx.quadraticCurveTo(s * W * 0.4, -L * (t + 0.06), s * W * 0.8, -L * (t + 0.14)); ctx.stroke(); }
      }
    }
  }
  ctx.restore();
  // glossy highlight band (camphor, ivy: waxy cuticle)
  if (o.gloss) {
    ctx.save(); leafPath(ctx, L, W, shape, rng); ctx.clip();
    const hg = ctx.createLinearGradient(-W, 0, W, 0);
    hg.addColorStop(0, 'rgba(255,255,240,0)'); hg.addColorStop(0.55, `rgba(255,255,240,${o.gloss})`); hg.addColorStop(0.8, 'rgba(255,255,240,0)');
    ctx.fillStyle = hg; ctx.fillRect(-W * 1.5, -L, W * 3, L);
    ctx.restore();
  }
  ctx.restore();
}

// ===================================================================== twigs with leaves
/**
 * Generic leafy twig filling a cell (base at the bottom centre).
 * P: { L:[min,max] leaf length px, W: width/length, shape, cols:[[a,b],...] (leaf colour pairs, picked at random),
 *      wood, gap:[a,b] px, ang:[a,b] rad, depth, pairs, petiole px, kids, spread, len, bare (no leaves), jit, gloss,
 *      spot, tipCols (young growth colour pair) }
 */
function drawTwig(ctx, cell, rng, P) {
  const [ox, oy] = cellXY(cell);
  ctx.save(); ctx.beginPath(); ctx.rect(ox, oy, CELL, CELL); ctx.clip();
  const twigs = [];
  const grow = (x, y, ang, len, th, depth) => {
    const steps = Math.max(2, Math.ceil(len / 10));
    const pts = [[x, y]]; let a = ang;
    for (let i = 0; i < steps; i++) {
      a += (rng.random() - 0.5) * (P.wiggle ?? 0.22); a *= 0.985;
      x += Math.sin(a) * len / steps; y -= Math.cos(a) * len / steps;
      x = Math.max(ox + 24, Math.min(ox + CELL - 24, x)); y = Math.max(oy + 26, y);
      pts.push([x, y]);
    }
    twigs.push({ pts, th, depth, a });
    if (depth >= P.depth) return;
    const nk = depth === 0 ? (P.kids?.[0] ?? 5) + rng.int(0, 2) : (P.kids?.[1] ?? 2) + rng.int(0, 2);
    for (let k = 0; k < nk; k++) {
      const t = 0.16 + 0.78 * (k + rng.random() * 0.5) / nk;
      const idx = Math.floor(t * (pts.length - 1));
      const side = k % 2 ? 1 : -1;
      grow(pts[idx][0], pts[idx][1], a + side * ((P.spread ?? 0.5) + rng.random() * 0.45), len * (0.55 - 0.25 * t) * (0.8 + rng.random() * 0.4), th * 0.6, depth + 1);
    }
  };
  grow(ox + CELL * (0.45 + rng.random() * 0.1), oy + CELL - 4, (rng.random() - 0.5) * 0.3, CELL * (P.len ?? 0.82), P.th ?? 6, 0);
  ctx.lineCap = 'round';
  for (const t of twigs) {
    ctx.strokeStyle = mixHex(P.wood, P.wood2 || '#8a7d6c', t.depth * 0.16, 0); ctx.lineWidth = Math.max(1, t.th);
    ctx.beginPath(); ctx.moveTo(t.pts[0][0], t.pts[0][1]);
    for (const p of t.pts) ctx.lineTo(p[0], p[1]);
    ctx.stroke();
  }
  if (P.bare) {
    // winter: buds at the twig nodes and tips
    ctx.fillStyle = P.bud || '#4a3528';
    for (const t of twigs) {
      for (let i = 2; i < t.pts.length; i += 2) { const p = t.pts[i]; ctx.beginPath(); ctx.ellipse(p[0], p[1], 1.6, 2.6, t.a, 0, Math.PI * 2); ctx.fill(); }
      const e = t.pts[t.pts.length - 1]; ctx.beginPath(); ctx.ellipse(e[0], e[1], 2, 3.4, t.a, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
    return twigs;
  }
  const leaves = [];
  for (const t of twigs) {
    let acc = 0;
    for (let i = 1; i < t.pts.length; i++) {
      const [x0, y0] = t.pts[i - 1], [x1, y1] = t.pts[i];
      const sl = Math.hypot(x1 - x0, y1 - y0); const a = Math.atan2(x1 - x0, -(y1 - y0));
      acc += sl;
      const gap = P.gap[0] + rng.random() * (P.gap[1] - P.gap[0]);
      if (t.depth === 0 && i < t.pts.length * 0.3) continue;
      while (acc > gap) {
        acc -= gap;
        const f = 1 - acc / sl; const x = x0 + (x1 - x0) * f, y = y0 + (y1 - y0) * f;
        const young = i / t.pts.length > 0.75 && t.depth >= 1;
        const L = (P.L[0] + rng.random() * (P.L[1] - P.L[0])) * (0.75 + 0.25 * Math.min(1, t.depth / 2)) * (young ? 0.8 : 1);
        const sides = P.pairs ? [-1, 1] : [rng.random() < 0.5 ? -1 : 1];
        for (const s of sides) {
          const la = a + s * (P.ang[0] + rng.random() * (P.ang[1] - P.ang[0]));
          const pet = P.petiole || 0;
          leaves.push({ x: x + Math.sin(la) * pet, y: y - Math.cos(la) * pet, px: x, py: y, a: la, L, W: L * P.W * (0.85 + rng.random() * 0.3), z: rng.random(), young });
        }
      }
    }
    const e = t.pts[t.pts.length - 1];
    leaves.push({ x: e[0], y: e[1], px: e[0], py: e[1], a: t.a + (rng.random() - 0.5) * 0.3, L: P.L[1] * 0.8, W: P.L[1] * 0.8 * P.W, z: 1, young: true });
  }
  leaves.sort((a, b) => a.z - b.z);
  for (const l of leaves) {
    if (P.petiole) { ctx.strokeStyle = P.petCol || P.wood; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(l.px, l.py); ctx.lineTo(l.x, l.y); ctx.stroke(); }
    const cols = l.young && P.tipCols && rng.random() < 0.4 ? P.tipCols : P.cols[Math.floor(rng.random() * P.cols.length)];
    // back leaves darker (depth in the spray)
    drawLeaf(ctx, l.x, l.y, l.a, l.L, l.W, P.shape, cols, rng, { gloss: P.gloss, spot: P.spot && rng.chance(0.4) ? P.spot : null, jit: (P.jit ?? 0.35) + (l.z - 0.5) * 0.3, vein: P.vein, fold: P.fold });
  }
  ctx.restore();
  return twigs;
}

// ===================================================================== willow strands
/**
 * Willow strand texture for a view-facing ribbon: twig(s) run down the cell, v = 0 at the root end, and the
 * texture TILES vertically (a strand is a chain of tiles). The cell spans Wmm across the ribbon and Hmm
 * along it, so leaves are drawn in an isotropic millimetre frame and squashed by sy = pxV / pxH.
 * season 0 spring: small yellow-green young leaves + catkins, 1 summer: long green leaves, 2 autumn: yellowing,
 * 3 winter: bare twig with buds.
 */
function drawWillowStrand(ctx, cell, rng, season, nStrands = 1) {
  const [ox, oy] = cellXY(cell);
  ctx.save(); ctx.beginPath(); ctx.rect(ox, oy, CELL, CELL); ctx.clip();
  const Wmm = nStrands === 1 ? 200 : 700, Hmm = nStrands === 1 ? 600 : 1400;
  const pxH = CELL / Wmm, pxV = CELL / Hmm, sy = pxV / pxH;
  const pal = [
    { cols: [['#6e7e48', '#9cab7c'], ['#7a884e', '#a8b486'], ['#64743e', '#909e70']], L: [34, 64], W: 0.17, gap: [7, 13], twig: '#5e5a36' },
    { cols: [['#4c6626', '#7e963e'], ['#5a7230', '#8ba446'], ['#44601f', '#6f8a36']], L: [75, 125], W: 0.13, gap: [10, 16], twig: '#56522e' },
    { cols: [['#9a8c38', '#cdb860'], ['#8a8a3a', '#bcb258'], ['#a89040', '#dcc070']], L: [65, 115], W: 0.13, gap: [12, 20], twig: '#6a5a36' },
    { cols: [], L: [0, 0], W: 0, gap: [0, 0], twig: '#857660' },
  ][season];
  // winter: a bunch of bare twigs per strand card (a real willow carries thousands; the card must read as a haze)
  const nT = season === 3 ? (nStrands === 1 ? 3 : 26) : nStrands;
  for (let s = 0; s < nT; s++) {
    const cx = ox + CELL * (nT === 1 ? 0.5 : nStrands === 1 ? 0.5 + (s - 1) * 0.24 + (rng.random() - 0.5) * 0.06 : (s + 0.5) / nT + (rng.random() - 0.5) * 0.6 / nT);
    const ph = rng.random() * 6.28;
    const xAt = (yy) => cx + Math.sin(((yy - oy) / CELL) * Math.PI * 2 + ph) * (nStrands === 1 ? 1.5 : 4);
    ctx.strokeStyle = pal.twig; ctx.lineCap = 'round';
    ctx.lineWidth = (season === 3 ? (nStrands > 1 ? 7.5 : 6.5) : 2.0) * pxH;
    ctx.beginPath(); for (let i = 0; i <= 32; i++) { const yy = oy + (CELL * i) / 32; i ? ctx.lineTo(xAt(yy), yy) : ctx.moveTo(xAt(yy), yy); } ctx.stroke();
    if (season === 3) {
      // buds and a few short side twiglets on the bare strand
      for (let k = 0; k < (nStrands > 1 ? 4 : 7); k++) {
        const yy = oy + CELL * (k + rng.random() * 0.6) / (nStrands > 1 ? 4 : 7), sd = k % 2 ? 1 : -1, x = xAt(yy);
        ctx.lineWidth = 2.4 * pxH;
        if (rng.random() < 0.6) { ctx.beginPath(); ctx.moveTo(x, yy); ctx.quadraticCurveTo(x + sd * 14 * pxH, yy + 25 * pxV, x + sd * (18 + rng.random() * 26) * pxH, yy + (70 + rng.random() * 60) * pxV); ctx.stroke(); }
        ctx.fillStyle = '#6a5838'; ctx.beginPath(); ctx.ellipse(x + sd * 1.5 * pxH, yy + 2, 1.6 * pxH, 4 * pxV, 0, 0, Math.PI * 2); ctx.fill();
      }
      continue;
    }
    const leaves = [];
    let yy = oy + rng.random() * 10;
    while (yy < oy + CELL) {
      const sd = rng.random() < 0.5 ? -1 : 1;
      const Lmm = pal.L[0] + rng.random() * (pal.L[1] - pal.L[0]);
      const a = Math.PI + sd * (0.2 + rng.random() * 0.5); // hanging down and a little out from the twig
      leaves.push({ x: xAt(yy), y: yy, a, L: Lmm * pxH, z: rng.random() });
      yy += (pal.gap[0] + rng.random() * (pal.gap[1] - pal.gap[0])) * pxV * (nStrands > 1 ? 0.8 : 1);
    }
    leaves.sort((p, q) => p.z - q.z);
    for (const l of leaves) {
      const cols = pal.cols[Math.floor(rng.random() * pal.cols.length)];
      for (const dy of [-CELL, 0, CELL]) { // wrap: the tile repeats along the strand
        if (l.y + dy < oy - CELL * 0.3 || l.y + dy > oy + CELL * 1.3) continue;
        drawLeaf(ctx, l.x, l.y + dy, l.a, l.L, l.L * pal.W, 'lance', cols, rng, { sy, lateral: false, jit: 0.3 + (l.z - 0.5) * 0.35, vein: 'rgba(240,245,200,0.22)' });
      }
    }
    if (season === 0) {
      // spring catkins: pale yellow-green fuzzy spikes among the young leaves
      for (let k = 0; k < 3; k++) {
        const y0 = oy + CELL * rng.random(), sd = rng.random() < 0.5 ? -1 : 1, x = xAt(y0);
        for (const dy of [-CELL, 0, CELL]) {
          ctx.save(); ctx.translate(x, y0 + dy); ctx.scale(1, sy); ctx.rotate(Math.PI + sd * 0.35);
          ctx.fillStyle = mixHex('#c8c068', '#e8e090', rng.random());
          ctx.beginPath(); ctx.ellipse(0, -20 * pxH, 3.2 * pxH, 20 * pxH, 0, 0, Math.PI * 2); ctx.fill();
          ctx.restore();
        }
      }
    }
  }
  ctx.restore();
}

// ===================================================================== peach blossom
function drawFlower(ctx, x, y, r, rng, o) {
  const rot = rng.random() * 6.28;
  const tilt = 0.55 + rng.random() * 0.45; // seen at an angle → ellipse
  ctx.save(); ctx.translate(x, y); ctx.rotate(rng.random() * 6.28); ctx.scale(1, tilt); ctx.rotate(rot);
  for (let k = 0; k < 5; k++) {
    const a = (k / 5) * Math.PI * 2;
    ctx.save(); ctx.rotate(a);
    const g = ctx.createRadialGradient(0, 0, r * 0.1, 0, -r * 0.55, r * 0.8);
    g.addColorStop(0, o.base); g.addColorStop(0.55, o.mid); g.addColorStop(1, o.edge);
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.moveTo(0, 0);
    ctx.bezierCurveTo(r * 0.62, -r * 0.25, r * 0.6, -r * 0.95, 0, -r * 1.0);
    ctx.bezierCurveTo(-r * 0.6, -r * 0.95, -r * 0.62, -r * 0.25, 0, 0);
    ctx.fill();
    ctx.strokeStyle = 'rgba(160,60,90,0.12)'; ctx.lineWidth = 0.6;
    ctx.beginPath(); ctx.moveTo(0, -r * 0.15); ctx.lineTo(0, -r * 0.85); ctx.stroke();
    ctx.restore();
  }
  // deep pink centre + stamens with yellow anthers
  ctx.fillStyle = o.eye; ctx.beginPath(); ctx.arc(0, 0, r * 0.22, 0, Math.PI * 2); ctx.fill();
  for (let k = 0; k < 14; k++) {
    const a = rng.random() * 6.28, l = r * (0.3 + rng.random() * 0.25);
    ctx.strokeStyle = 'rgba(200,90,120,0.8)'; ctx.lineWidth = 0.7;
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(Math.cos(a) * l, Math.sin(a) * l); ctx.stroke();
    ctx.fillStyle = '#e8c860'; ctx.beginPath(); ctx.arc(Math.cos(a) * l, Math.sin(a) * l, 1.1, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
}

function drawBlossomTwig(ctx, cell, rng) {
  const twigs = drawTwig(ctx, cell, rng, { bare: true, depth: 2, wood: '#4a2e2a', wood2: '#6a4038', th: 7, len: 0.86, kids: [4, 2], spread: 0.45, bud: '#7a3a40', wiggle: 0.3 });
  const [ox, oy] = cellXY(cell);
  ctx.save(); ctx.beginPath(); ctx.rect(ox, oy, CELL, CELL); ctx.clip();
  const fl = [];
  for (const t of twigs) {
    for (let i = 1; i < t.pts.length; i++) {
      if (t.depth === 0 && i < t.pts.length * 0.35) continue;
      if (rng.random() < 0.22) continue;
      const p = t.pts[i];
      const n = 1 + rng.int(0, 2);
      for (let k = 0; k < n; k++) fl.push({ x: p[0] + (rng.random() - 0.5) * 16, y: p[1] + (rng.random() - 0.5) * 16, z: rng.random(), bud: rng.random() < 0.18, leaf: rng.random() < 0.12, a: t.a });
    }
  }
  fl.sort((a, b) => a.z - b.z);
  for (const f of fl) {
    if (f.leaf) { drawLeaf(ctx, f.x, f.y, f.a + (rng.random() - 0.5) * 1.6, 26, 26 * 0.22, 'lance', ['#6a8a2a', '#a4bc58'], rng, { lateral: false }); continue; }
    if (f.bud) {
      ctx.fillStyle = mixHex('#c04870', '#e88aa8', rng.random());
      ctx.beginPath(); ctx.ellipse(f.x, f.y, 5, 7, f.a, 0, Math.PI * 2); ctx.fill();
      continue;
    }
    const deep = rng.random();
    drawFlower(ctx, f.x, f.y, 15 + rng.random() * 7, rng, {
      base: mixHex('#c84a78', '#e07898', deep), mid: mixHex('#ec9ab4', '#f6c4d2', rng.random()), edge: mixHex('#f8d8e0', '#fbe6ec', rng.random()), eye: '#a8285a',
    });
  }
  ctx.restore();
}

// ===================================================================== pine needles
/** needle brush (a pine shoot with its needles, seen from any side): the shoot rises from the bottom centre,
 *  needles spring from its upper part fanning up and out (黑松 / 马尾松 tufts); variant 2 carries a pale
 *  spring "candle" (the new shoot) */
function drawPineBurst(ctx, cell, rng, variant) {
  const [ox, oy] = cellXY(cell);
  ctx.save(); ctx.beginPath(); ctx.rect(ox, oy, CELL, CELL); ctx.clip();
  ctx.lineCap = 'round';
  const bx = ox + CELL * 0.5, by = oy + CELL * 0.985;
  const lean = (rng.random() - 0.5) * 0.25;
  const sh = CELL * (0.42 + rng.random() * 0.1);
  const P = (t) => [bx + Math.sin(lean) * sh * t + Math.sin(t * 3) * 4, by - sh * t];
  // needles in 3D around the shoot axis (cone angle from the axis, random azimuth), projected onto the card:
  // needles pointing toward / away from the viewer come out short, so the tuft reads as a round brush, not a fan
  const needles = [];
  const n = 230 + rng.int(0, 60);
  for (let i = 0; i < n; i++) {
    const t = 0.3 + 0.7 * Math.pow(rng.random(), 0.65);
    const [sx, sy] = P(t);
    const cone = (0.25 + (1 - t) * 1.05) * (0.5 + 0.5 * rng.random()) + 0.12;
    const az = rng.random() * Math.PI * 2;
    const dx = Math.sin(cone) * Math.cos(az), dy = Math.cos(cone), dz = Math.sin(cone) * Math.sin(az);
    const L3 = CELL * (0.24 + rng.random() * 0.2);
    const na = lean + Math.atan2(dx, dy);
    const L = L3 * Math.hypot(dx, dy);
    needles.push({ sx, sy, na, L, z: 0.5 + 0.5 * dz, t });
  }
  // shoot (drawn first: needles cover most of it)
  ctx.strokeStyle = '#4a3324'; ctx.lineWidth = 8;
  ctx.beginPath(); for (let i = 0; i <= 12; i++) { const [x, y] = P(i / 12); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); } ctx.stroke();
  needles.sort((p, q) => p.z - q.z);
  const dark = variant === 1 ? '#121c0c' : '#16220f', light = variant === 1 ? '#3c4e26' : '#4a5c2c';
  for (const nd of needles) {
    const lv = Math.min(1, nd.z * 0.75 + nd.t * 0.35);
    ctx.strokeStyle = mixHex(dark, light, lv, (rng.random() - 0.5) * 0.16);
    ctx.lineWidth = 1.2 + rng.random() * 0.7;
    const ex = nd.sx + Math.sin(nd.na) * nd.L, ey = nd.sy - Math.cos(nd.na) * nd.L;
    const bend = Math.sign(nd.na - lean) * nd.L * 0.06;
    ctx.beginPath(); ctx.moveTo(nd.sx, nd.sy);
    ctx.quadraticCurveTo((nd.sx + ex) / 2 + bend, (nd.sy + ey) / 2 + Math.abs(bend) * 0.5, ex, ey);
    ctx.stroke();
  }
  if (variant === 2) {
    // spring candle: a pale buff new shoot standing out of the brush
    const [tx, ty] = P(1);
    const g = ctx.createLinearGradient(0, ty, 0, ty - CELL * 0.22);
    g.addColorStop(0, '#8a8a58'); g.addColorStop(1, '#c8c090');
    ctx.strokeStyle = g; ctx.lineWidth = 11;
    ctx.beginPath(); ctx.moveTo(tx, ty + 10); ctx.lineTo(tx + 3, ty - CELL * 0.22); ctx.stroke();
  }
  ctx.restore();
}

/** side spray: a flat fan of needle tufts along a horizontal twig (the "plates" of 黄山松 seen from the side) */
function drawPineSpray(ctx, cell, rng, variant) {
  const [ox, oy] = cellXY(cell);
  ctx.save(); ctx.beginPath(); ctx.rect(ox, oy, CELL, CELL); ctx.clip();
  ctx.lineCap = 'round';
  const y0 = oy + CELL * (0.62 + rng.random() * 0.1);
  const pts = [];
  for (let i = 0; i <= 12; i++) { const t = i / 12; pts.push([ox + CELL * (0.04 + 0.92 * t), y0 + Math.sin(t * 3 + variant) * 12 - t * 20]); }
  ctx.strokeStyle = '#4a3222'; ctx.lineWidth = 8;
  ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]); for (const p of pts) ctx.lineTo(p[0], p[1]); ctx.stroke();
  const tufts = [];
  for (let i = 2; i <= 12; i++) {
    if (rng.random() < 0.15) continue;
    const p = pts[i];
    tufts.push({ x: p[0] + (rng.random() - 0.5) * 20, y: p[1] - rng.random() * 8, r: CELL * (0.1 + rng.random() * 0.07), z: rng.random() });
  }
  tufts.sort((a, b) => a.z - b.z);
  const dark = variant === 1 ? '#1f2c16' : '#25351a', light = variant === 1 ? '#53653a' : '#677a3c';
  for (const t of tufts) {
    // a short upturned shoot with needles fanning up and out (upper hemisphere dense, lower sparse)
    ctx.strokeStyle = '#4a3222'; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.moveTo(t.x, t.y + 6); ctx.lineTo(t.x + 4, t.y - t.r * 0.25); ctx.stroke();
    const n = 90 + rng.int(0, 40);
    for (let i = 0; i < n; i++) {
      const up = rng.random() < 0.8;
      const na = up ? (rng.random() - 0.5) * 2.6 : Math.PI + (rng.random() - 0.5) * 2.0;
      const L = t.r * (0.7 + rng.random() * 0.6) * (up ? 1 : 0.6);
      const sx = t.x + (rng.random() - 0.5) * 8, sy = t.y - t.r * 0.2 * rng.random();
      ctx.strokeStyle = mixHex(dark, light, Math.min(1, (up ? 0.45 : 0.05) + rng.random() * 0.55 * t.z + 0.2), (rng.random() - 0.5) * 0.15);
      ctx.lineWidth = 1.6 + rng.random() * 0.8;
      ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(sx + Math.sin(na) * L, sy - Math.cos(na) * L); ctx.stroke();
    }
  }
  ctx.restore();
}

// ===================================================================== dense patches (opaque, crown interiors / blobs)
function stampPatch(ctx, src, cell, sprayCells, rng, o) {
  const [ox, oy] = cellXY(cell);
  ctx.save();
  ctx.beginPath(); ctx.rect(ox, oy, CELL, CELL); ctx.clip();
  if (o.bg) { ctx.fillStyle = o.bg; ctx.fillRect(ox, oy, CELL, CELL); }
  const n = o.count || 70;
  for (let i = 0; i < n; i++) {
    const t = i / n; // later = front = lighter
    const sc = (o.scale || 0.42) * (0.75 + rng.random() * 0.5);
    const x = ox + rng.random() * CELL, y = oy + rng.random() * CELL * 1.1;
    const s = sprayCells[Math.floor(rng.random() * sprayCells.length)];
    const [sx, sy] = cellXY(s);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate((rng.random() - 0.5) * (o.rot || 0.7));
    ctx.filter = `brightness(${(o.lo ?? 0.45) + (o.hi ?? 0.75) * t * (0.7 + rng.random() * 0.4)})`;
    ctx.drawImage(src, sx, sy, CELL, CELL, -CELL * sc / 2, -CELL * sc * 0.75, CELL * sc, CELL * sc);
    ctx.restore();
  }
  ctx.filter = 'none';
  ctx.restore();
}

// ===================================================================== ground plants
function drawGrassCard(ctx, cell, rng, season) {
  const [ox, oy] = cellXY(cell);
  ctx.save(); ctx.beginPath(); ctx.rect(ox, oy, CELL, CELL); ctx.clip();
  const pal = [['#3e5a1c', '#93ad4a'], ['#34501a', '#7c9a3c'], ['#7a6e3c', '#c8b47a'], ['#6a5c40', '#a8987a']][season];
  const n = 160;
  const blades = [];
  for (let i = 0; i < n; i++) blades.push({ x: ox + CELL * (0.06 + 0.88 * rng.random()), h: CELL * (0.35 + 0.62 * Math.pow(rng.random(), 0.7)), lean: (rng.random() - 0.5) * 0.9, w: 3 + rng.random() * 4, z: rng.random(), dry: rng.random() < (season >= 2 ? 0.7 : 0.12) });
  blades.sort((a, b) => a.z - b.z);
  for (const b of blades) {
    const base = oy + CELL;
    const tipx = b.x + Math.sin(b.lean) * b.h, tipy = base - Math.cos(b.lean) * b.h;
    const c = b.dry ? ['#7e7044', '#c8b880'] : pal;
    const g = ctx.createLinearGradient(0, base, 0, tipy);
    g.addColorStop(0, mixHex(c[0], c[0], 0, -0.3)); g.addColorStop(1, mixHex(c[0], c[1], 0.4 + 0.6 * b.z));
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.moveTo(b.x - b.w, base);
    ctx.quadraticCurveTo(b.x - b.w * 0.5 + Math.sin(b.lean) * b.h * 0.4, base - b.h * 0.55, tipx, tipy);
    ctx.quadraticCurveTo(b.x + b.w * 0.5 + Math.sin(b.lean) * b.h * 0.4, base - b.h * 0.55, b.x + b.w, base);
    ctx.fill();
  }
  ctx.restore();
}

function drawFern(ctx, cell, rng, variant) {
  const [ox, oy] = cellXY(cell);
  ctx.save(); ctx.beginPath(); ctx.rect(ox, oy, CELL, CELL); ctx.clip();
  if (variant === 3) {
    // moss / selaginella mat: dense tiny fronds (opaque-ish carpet with ragged top)
    for (let i = 0; i < 1400; i++) {
      const x = ox + rng.random() * CELL, y = oy + CELL * (0.15 + 0.85 * Math.pow(rng.random(), 0.6));
      ctx.strokeStyle = mixHex('#2c3e14', '#86a038', rng.random() * (1 - (y - oy) / CELL * 0.6), 0);
      ctx.lineWidth = 2 + rng.random() * 2;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + (rng.random() - 0.5) * 10, y - 8 - rng.random() * 12); ctx.stroke();
    }
    ctx.restore(); return;
  }
  const pal = [['#2e4a18', '#7a9c3a'], ['#34521c', '#8aa844'], ['#6a5a28', '#b89a50']][variant];
  // pinnate frond: rachis curving up then over, pinnae alternating, each pinna with pinnules
  const L = CELL * 0.92;
  const pts = [];
  let x = ox + CELL * 0.5, y = oy + CELL - 2, a = (rng.random() - 0.5) * 0.3;
  for (let i = 0; i <= 30; i++) { pts.push([x, y, a]); a += 0.018 + (rng.random() - 0.5) * 0.02; x += Math.sin(a) * L / 30; y -= Math.cos(a) * L / 30; }
  ctx.strokeStyle = mixHex(pal[0], '#5a4a28', 0.4); ctx.lineWidth = 4; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]); for (const p of pts) ctx.lineTo(p[0], p[1]); ctx.stroke();
  for (let i = 4; i < pts.length; i += 2) {
    const t = i / pts.length;
    const pl = CELL * 0.3 * Math.sin(Math.PI * Math.min(1, (t - 0.1) * 1.15)) + 6;
    for (const s of [-1, 1]) {
      const [px, py, pa] = pts[i];
      const ang = pa + s * (1.15 - t * 0.3);
      const ex = px + Math.sin(ang) * pl, ey = py - Math.cos(ang) * pl;
      ctx.strokeStyle = mixHex(pal[0], pal[1], 0.3); ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(ex, ey); ctx.stroke();
      const np = Math.max(3, Math.round(pl / 12));
      for (let k = 1; k < np; k++) {
        const u = k / np;
        const qx = px + (ex - px) * u, qy = py + (ey - py) * u;
        const ll = (pl * 0.16 + 4) * (1 - u * 0.6);
        for (const s2 of [-1, 1]) drawLeaf(ctx, qx, qy, ang + s2 * 1.1, ll, ll * 0.45, 'lance', [pal[0], pal[1]], rng, { lateral: false, fold: 0.08, jit: 0.25 });
      }
    }
  }
  ctx.restore();
}

function drawIvy(ctx, cell, rng, variant) {
  const [ox, oy] = cellXY(cell);
  ctx.save(); ctx.beginPath(); ctx.rect(ox, oy, CELL, CELL); ctx.clip();
  if (variant === 1) {
    // a hanging vine strand (for ribbons): thin stem down the middle, small heart leaves alternating
    const cx = ox + CELL * 0.5;
    ctx.strokeStyle = '#4a3a24'; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(cx, oy); ctx.lineTo(cx + 4, oy + CELL); ctx.stroke();
    for (let y = oy + 10; y < oy + CELL - 10; y += 26 + rng.random() * 18) {
      const sd = rng.random() < 0.5 ? -1 : 1;
      drawLeaf(ctx, cx + sd * 4, y, Math.PI + sd * (0.6 + rng.random() * 0.6), 60 + rng.random() * 30, 40, 'ivy', rng.random() < 0.3 ? ['#5a6a24', '#9aa848'] : ['#2a4018', '#4c6a28'], rng, { sy: 0.45, gloss: 0.12 });
    }
    ctx.restore(); return;
  }
  const pal = variant === 2 ? [['#7a1a14', '#c8402a'], ['#9a2a18', '#e0602c'], ['#6a2414', '#b84a28']] : variant === 3 ? [['#1c2e12', '#3a5222']] : [['#22361a', '#4a6a2c'], ['#2c4220', '#58763a'], ['#3a5224', '#7a9440']];
  const n = 26;
  const ls = [];
  for (let i = 0; i < n; i++) ls.push({ x: ox + CELL * (0.12 + 0.76 * rng.random()), y: oy + CELL * (0.14 + 0.8 * rng.random()), a: (rng.random() - 0.5) * 2.4 + Math.PI, L: CELL * (0.16 + rng.random() * 0.1), z: rng.random() });
  ls.sort((a, b) => a.z - b.z);
  // stems
  ctx.strokeStyle = '#4a3a24'; ctx.lineWidth = 3;
  for (const l of ls) { ctx.beginPath(); ctx.moveTo(ox + CELL * 0.5, oy); ctx.quadraticCurveTo(ox + CELL * 0.5, l.y - 20, l.x, l.y); ctx.stroke(); }
  for (const l of ls) drawLeaf(ctx, l.x, l.y, l.a, l.L, l.L * 0.62, 'ivy', pal[Math.floor(rng.random() * pal.length)], rng, { gloss: variant === 2 ? 0.05 : 0.14 });
  ctx.restore();
}

function drawLitter(ctx, cell, rng, variant) {
  const [ox, oy] = cellXY(cell);
  ctx.save(); ctx.beginPath(); ctx.rect(ox, oy, CELL, CELL); ctx.clip();
  if (variant === 0) { // fallen peach petals
    for (let i = 0; i < 190; i++) {
      const x = ox + rng.random() * CELL, y = oy + rng.random() * CELL, r = 9 + rng.random() * 8;
      ctx.save(); ctx.translate(x, y); ctx.rotate(rng.random() * 6.28); ctx.scale(1, 0.6 + rng.random() * 0.4);
      ctx.fillStyle = mixHex('#e890a8', '#f8dce4', rng.random());
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.bezierCurveTo(r * 0.7, -r * 0.2, r * 0.6, -r, 0, -r * 1.1); ctx.bezierCurveTo(-r * 0.6, -r, -r * 0.7, -r * 0.2, 0, 0); ctx.fill();
      ctx.restore();
    }
  } else if (variant === 3) { // pine needle litter
    for (let i = 0; i < 700; i++) {
      const x = ox + rng.random() * CELL, y = oy + rng.random() * CELL, a = rng.random() * 6.28, L = 20 + rng.random() * 30;
      ctx.strokeStyle = mixHex('#5a3e22', '#a8784a', rng.random()); ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(a) * L, y + Math.sin(a) * L); ctx.stroke();
    }
  } else {
    const n = variant === 1 ? 46 : 60;
    for (let i = 0; i < n; i++) {
      const x = ox + CELL * (0.08 + 0.84 * rng.random()), y = oy + CELL * (0.1 + 0.84 * rng.random());
      if (variant === 1) {
        const k = rng.random();
        if (k < 0.5) drawLeaf(ctx, x, y, rng.random() * 6.28, 34 + rng.random() * 14, 34, 'palmate', [['#8a1a12', '#d8402a'], ['#a82814', '#e86a2a'], ['#7a2010', '#c85030']][rng.int(0, 2)], rng, {});
        else drawLeaf(ctx, x, y, rng.random() * 6.28, 30 + rng.random() * 10, 30, 'fan', ['#c89a20', '#f0d050'], rng, {});
      } else {
        drawLeaf(ctx, x, y, rng.random() * 6.28, 34 + rng.random() * 18, 14, 'broad', [['#5a3a1c', '#8a6a3a'], ['#6a4a24', '#a07a44'], ['#4a3420', '#7a5a34']][rng.int(0, 2)], rng, { spot: '#2a1a10' });
      }
    }
  }
  ctx.restore();
}

function drawReedPlume(ctx, cell, rng) {
  const [ox, oy] = cellXY(cell);
  ctx.save(); ctx.beginPath(); ctx.rect(ox, oy, CELL, CELL); ctx.clip();
  // reed leaves: long blades leaning out from a stem + a feathery plume
  const cx = ox + CELL * 0.5;
  ctx.strokeStyle = '#8a8a5a'; ctx.lineWidth = 5; ctx.beginPath(); ctx.moveTo(cx, oy + CELL); ctx.lineTo(cx + 6, oy + CELL * 0.25); ctx.stroke();
  for (let i = 0; i < 9; i++) {
    const y = oy + CELL * (0.35 + 0.6 * i / 9), sd = i % 2 ? 1 : -1;
    drawLeaf(ctx, cx + 2, y, sd * (0.5 + rng.random() * 0.5), CELL * 0.4, CELL * 0.4 * 0.08, 'lance', ['#5a6a2a', '#a0a85a'], rng, { lateral: false });
  }
  for (let i = 0; i < 260; i++) {
    const t = rng.random();
    const x = cx + 6 + (rng.random() - 0.5) * 50 * Math.sin(Math.PI * t), y = oy + CELL * (0.02 + 0.25 * t);
    ctx.strokeStyle = mixHex('#8a7a62', '#d8ccb0', rng.random()); ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.moveTo(cx + 6, y + 10); ctx.lineTo(x, y); ctx.stroke();
  }
  ctx.restore();
}

// ===================================================================== mips + texture
/** colour-dilate transparent texels and build a coverage-preserving mip chain (Athenaion technique) */
function buildTexture(canvas, alphaRef = 0.5, opaqueCells = []) {
  const S = canvas.width;
  const ctx = canvas.getContext('2d');
  const img = ctx.getImageData(0, 0, S, S);
  const d = new Uint8Array(img.data.buffer.slice(0));
  const covTarget = new Float32Array(GRID * GRID);
  const mean = [];
  for (let c = 0; c < GRID * GRID; c++) {
    const [ox, oy] = cellXY(c);
    let r = 0, g = 0, b = 0, n = 0, cov = 0;
    for (let y = oy; y < oy + CELL; y += 2) for (let x = ox; x < ox + CELL; x += 2) {
      const i = (y * S + x) * 4;
      if (d[i + 3] > 128) { r += d[i]; g += d[i + 1]; b += d[i + 2]; n++; }
    }
    if (n) { r /= n; g /= n; b /= n; }
    const toL = (v) => { const x = v / 255; return x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); };
    mean.push([toL(r), toL(g), toL(b), n / ((CELL / 2) * (CELL / 2))]);
    const opaque = opaqueCells.includes(c);
    const aRef = alphaRef * 255;
    for (let y = oy; y < oy + CELL; y++) {
      let i = (y * S + ox) * 4;
      for (let x = 0; x < CELL; x++, i += 4) {
        if (opaque) { d[i + 3] = 255; cov++; continue; }
        const a = d[i + 3];
        if (a < 250) {
          const k = a / 255, k1 = 1 - k;
          d[i] = d[i] * k + r * k1; d[i + 1] = d[i + 1] * k + g * k1; d[i + 2] = d[i + 2] * k + b * k1;
        }
        if (a > aRef) cov++;
      }
    }
    covTarget[c] = cov / (CELL * CELL);
  }
  const mips = [{ data: d, width: S, height: S }];
  const toLin = new Float32Array(256);
  for (let i = 0; i < 256; i++) { const c = i / 255; toLin[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
  const LN = 4096, toS = new Uint8Array(LN + 1);
  for (let i = 0; i <= LN; i++) { const l = i / LN; const c = l <= 0.0031308 ? l * 12.92 : 1.055 * Math.pow(l, 1 / 2.4) - 0.055; toS[i] = Math.max(0, Math.min(255, Math.round(c * 255))); }
  const hist = new Uint32Array(256);
  let prev = d, ps = S;
  while (ps > 1) {
    const ns = ps >> 1;
    const out = new Uint8Array(ns * ns * 4);
    const alpha = new Uint8Array(ns * ns);
    for (let y = 0; y < ns; y++) {
      let i0 = (y * 2 * ps) * 4, i1 = ((y * 2 + 1) * ps) * 4, o = y * ns * 4;
      for (let x = 0; x < ns; x++, i0 += 8, i1 += 8, o += 4) {
        out[o] = toS[((toLin[prev[i0]] + toLin[prev[i0 + 4]] + toLin[prev[i1]] + toLin[prev[i1 + 4]]) * 0.25 * LN) | 0];
        out[o + 1] = toS[((toLin[prev[i0 + 1]] + toLin[prev[i0 + 5]] + toLin[prev[i1 + 1]] + toLin[prev[i1 + 5]]) * 0.25 * LN) | 0];
        out[o + 2] = toS[((toLin[prev[i0 + 2]] + toLin[prev[i0 + 6]] + toLin[prev[i1 + 2]] + toLin[prev[i1 + 6]]) * 0.25 * LN) | 0];
        alpha[y * ns + x] = (prev[i0 + 3] + prev[i0 + 7] + prev[i1 + 3] + prev[i1 + 7] + 2) >> 2;
      }
    }
    const cs = ns / GRID;
    for (let c = 0; c < GRID * GRID; c++) {
      const cx = (c % GRID) * cs, cy = Math.floor(c / GRID) * cs;
      const x0 = Math.floor(cx), y0 = Math.floor(cy), x1 = Math.max(x0 + 1, Math.floor(cx + cs)), y1 = Math.max(y0 + 1, Math.floor(cy + cs));
      const target = covTarget[c];
      let scale = 1;
      if (cs >= 2 && target > 0.001 && target < 0.999) {
        hist.fill(0);
        for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) hist[alpha[y * ns + x]]++;
        const total = (x1 - x0) * (y1 - y0), want = target * total;
        let acc = 0, th = 255;
        for (let v = 255; v >= 1; v--) { acc += hist[v]; if (acc >= want) { th = v; break; } }
        scale = (alphaRef * 255) / Math.max(1, th - 0.5);
      }
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
        const v = alpha[y * ns + x] * scale;
        out[(y * ns + x) * 4 + 3] = v > 255 ? 255 : v;
      }
    }
    mips.push({ data: out, width: ns, height: ns });
    prev = out; ps = ns;
  }
  const tex = new THREE.DataTexture(mips[0].data, S, S, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.mipmaps = mips;
  tex.generateMipmaps = false;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.anisotropy = 8;
  tex.flipY = false;
  tex.needsUpdate = true;
  tex.userData.mean = mean;
  return tex;
}

let _atlas = null, _canvas = null;

export function foliageAtlas() {
  if (_atlas) return _atlas;
  const t0 = performance.now();
  const cv = makeCanvas(ATLAS_SIZE, ATLAS_SIZE);
  const ctx = cv.getContext('2d');
  const rng = new RNG('hz-foliage-atlas-v1');
  // ---- willow
  for (let s = 0; s < 4; s++) { drawWillowStrand(ctx, cellOf(T.willow, s), rng, s, 1); drawWillowStrand(ctx, cellOf(T.willowCurtain, s), rng, s, 10); }
  // ---- peach: blossom (spring), leaves (summer), yellowing (autumn), bare (winter)
  drawBlossomTwig(ctx, cellOf(T.peach, 0), rng);
  const peachLeaf = { L: [46, 70], W: 0.2, shape: 'lance', wood: '#4a2e2a', wood2: '#6a4038', gap: [8, 13], ang: [0.5, 0.95], depth: 2, kids: [4, 2], spread: 0.45, th: 6, len: 0.84, lateral: false };
  drawTwig(ctx, cellOf(T.peach, 1), rng, { ...peachLeaf, cols: [['#3e5a1c', '#6e8e32'], ['#486622', '#7c9a3a']] });
  drawTwig(ctx, cellOf(T.peach, 2), rng, { ...peachLeaf, cols: [['#8a7a2a', '#c8b050'], ['#7a6a28', '#b89a44'], ['#5a6a24', '#8a9a3a']], spot: '#6a3a18' });
  drawTwig(ctx, cellOf(T.peach, 3), rng, { ...peachLeaf, bare: true, bud: '#5a2a2a' });
  // ---- pine (no season: four variants)
  for (let s = 0; s < 4; s++) { drawPineBurst(ctx, cellOf(T.pineBurst, s), rng, s); drawPineSpray(ctx, cellOf(T.pineSpray, s), rng, s); }
  // ---- camphor (evergreen; spring has the red-bronze new flush)
  const camph = { L: [38, 56], W: 0.3, shape: 'ovate', wood: '#3a3424', gap: [8, 12], ang: [0.5, 1.05], depth: 3, kids: [5, 2], petiole: 7, gloss: 0.16, th: 5 };
  drawTwig(ctx, cellOf(T.camphor, 0), rng, { ...camph, cols: [['#38521e', '#62803a'], ['#43601f', '#749040'], ['#4a6822', '#80a048']], tipCols: ['#7a6a30', '#b0a058'] });
  drawTwig(ctx, cellOf(T.camphor, 1), rng, { ...camph, cols: [['#2e4818', '#557434'], ['#38521e', '#628038'], ['#2a4016', '#4c6a2c']] });
  drawTwig(ctx, cellOf(T.camphor, 2), rng, { ...camph, cols: [['#2e4818', '#557434'], ['#38521e', '#628038'], ['#6a5a24', '#a08a3a']] });
  drawTwig(ctx, cellOf(T.camphor, 3), rng, { ...camph, cols: [['#283e16', '#4a6630'], ['#2e4618', '#527034']] });
  // ---- generic deciduous broadleaf
  const broad = { L: [34, 52], W: 0.36, shape: 'broad', wood: '#4a3d30', gap: [8, 12], ang: [0.45, 1.0], depth: 3, kids: [5, 2], petiole: 5, th: 5 };
  drawTwig(ctx, cellOf(T.broad, 0), rng, { ...broad, cols: [['#5a7a24', '#9ab84a'], ['#6a8a2c', '#acc458']] });
  drawTwig(ctx, cellOf(T.broad, 1), rng, { ...broad, cols: [['#2f4a1c', '#5a7a2e'], ['#38521e', '#668a36']] });
  drawTwig(ctx, cellOf(T.broad, 2), rng, { ...broad, cols: [['#8a6a1c', '#c8a040'], ['#9a4a1a', '#d07a34'], ['#6a5a24', '#a8903c']], spot: '#4a2a14' });
  drawTwig(ctx, cellOf(T.broad, 3), rng, { ...broad, bare: true });
  // ---- red maple (鸡爪槭)
  const maple = { L: [40, 58], W: 1.0, shape: 'palmate', wood: '#5a2a24', wood2: '#8a4a3a', gap: [12, 18], ang: [0.4, 1.2], depth: 3, kids: [5, 2], petiole: 14, petCol: '#9a3a2a', th: 4, pairs: true, fold: 0.08, vein: 'rgba(255,220,180,0.25)' };
  drawTwig(ctx, cellOf(T.maple, 0), rng, { ...maple, cols: [['#4a6420', '#86a03a'], ['#5a6a22', '#94a440']] });
  drawTwig(ctx, cellOf(T.maple, 1), rng, { ...maple, cols: [['#38561c', '#6a8a32'], ['#40601e', '#78983a']] });
  drawTwig(ctx, cellOf(T.maple, 2), rng, { ...maple, cols: [['#760c0a', '#c4221a'], ['#8a120e', '#d42c1e'], ['#9c1a10', '#de4422'], ['#5a0a0a', '#a41814']] });
  drawTwig(ctx, cellOf(T.maple, 3), rng, { ...maple, bare: true, bud: '#6a2a24' });
  // ---- ginkgo
  const gink = { L: [34, 46], W: 1.0, shape: 'fan', wood: '#5a4a3a', wood2: '#8a7a64', gap: [14, 20], ang: [0.3, 1.1], depth: 2, kids: [5, 3], petiole: 22, petCol: '#8a7a3a', th: 6, fold: 0.06 };
  drawTwig(ctx, cellOf(T.ginkgo, 0), rng, { ...gink, cols: [['#7a9a30', '#b8d060']] });
  drawTwig(ctx, cellOf(T.ginkgo, 1), rng, { ...gink, cols: [['#3e6a20', '#6a9a38'], ['#4a7424', '#78a440']] });
  drawTwig(ctx, cellOf(T.ginkgo, 2), rng, { ...gink, cols: [['#c8941a', '#f2cc3c'], ['#d8a820', '#f8dc58'], ['#b8881c', '#e8bc34']] });
  drawTwig(ctx, cellOf(T.ginkgo, 3), rng, { ...gink, bare: true, bud: '#5a4a3a' });
  // ---- ground
  for (let s = 0; s < 4; s++) { drawGrassCard(ctx, cellOf(T.grass, s), rng, s); drawFern(ctx, cellOf(T.fern, s), rng, s); drawIvy(ctx, cellOf(T.ivy, s), rng, s); drawLitter(ctx, cellOf(T.litter, s), rng, s); }
  drawTwig(ctx, cellOf(T.shrub, 0), rng, { L: [22, 32], W: 0.42, shape: 'ovate', wood: '#3a3024', gap: [5, 8], ang: [0.5, 1.1], depth: 3, kids: [6, 3], th: 4, gloss: 0.1, cols: [['#2a4018', '#4c6a2a'], ['#304a1c', '#587634']] });
  drawTwig(ctx, cellOf(T.shrub, 1), rng, { L: [36, 50], W: 0.3, shape: 'ovate', wood: '#3a3424', gap: [7, 10], ang: [0.5, 1.0], depth: 3, kids: [5, 2], th: 4, pairs: true, gloss: 0.14, cols: [['#24381a', '#46602c'], ['#2c421c', '#506a32']] });
  drawTwig(ctx, cellOf(T.shrub, 2), rng, { L: [26, 36], W: 0.42, shape: 'broad', wood: '#3a3024', gap: [5, 8], ang: [0.5, 1.0], depth: 3, kids: [6, 3], th: 4, gloss: 0.18, cols: [['#2a4618', '#4e7a2c'], ['#345420', '#5e8a34']] });
  drawReedPlume(ctx, cellOf(T.shrub, 3), rng);
  // ---- dense patches stamped from the sprays (opaque crown interiors for blobs / billboards)
  const src = makeCanvas(ATLAS_SIZE, ATLAS_SIZE);
  src.getContext('2d').drawImage(cv, 0, 0);
  const st = (k, type, s, o) => stampPatch(ctx, src, cellOf(type, s), k, rng, o);
  st([cellOf(T.camphor, 1), cellOf(T.camphor, 3)], T.patchA, 0, { bg: '#16240c', count: 80, scale: 0.5, rot: 2.5 });
  st([cellOf(T.pineBurst, 0), cellOf(T.pineBurst, 1), cellOf(T.pineSpray, 0)], T.patchA, 1, { bg: '#121c0c', count: 70, scale: 0.55, rot: 1.6 });
  st([cellOf(T.willow, 1), cellOf(T.willowCurtain, 1)], T.patchA, 2, { bg: '#2a3a14', count: 60, scale: 0.6, rot: 0.3 });
  st([cellOf(T.peach, 0)], T.patchA, 3, { bg: '#c88a9c', count: 70, scale: 0.55, rot: 2.5, lo: 0.7, hi: 0.45 });
  st([cellOf(T.maple, 1)], T.patchB, 0, { bg: '#1a2a10', count: 70, scale: 0.5, rot: 2.5 });
  st([cellOf(T.ginkgo, 1)], T.patchB, 1, { bg: '#1c3010', count: 70, scale: 0.5, rot: 2.5 });
  st([cellOf(T.broad, 3), cellOf(T.maple, 3), cellOf(T.ginkgo, 3)], T.patchB, 2, { count: 40, scale: 0.6, rot: 2.5, lo: 0.8, hi: 0.3 });
  st([cellOf(T.shrub, 0), cellOf(T.shrub, 2)], T.patchB, 3, { bg: '#142010', count: 80, scale: 0.45, rot: 2.5 });
  const opaque = [cellOf(T.patchA, 0), cellOf(T.patchA, 1), cellOf(T.patchA, 2), cellOf(T.patchA, 3), cellOf(T.patchB, 0), cellOf(T.patchB, 1), cellOf(T.patchB, 3)];
  const t1 = performance.now();
  _canvas = cv;
  _atlas = buildTexture(cv, 0.5, opaque);
  _atlas.name = 'foliageAtlas';
  console.log(`[vegetation] foliage atlas ${Math.round(performance.now() - t0)} ms (draw ${Math.round(t1 - t0)}, mips ${Math.round(performance.now() - t1)})`);
  return _atlas;
}

/** mean linear colour + coverage of a cell (computed while building the mips) */
export function cellMean(cell) { return foliageAtlas().userData.mean[cell]; }

/** debug: the atlas as a canvas (for dumping to PNG during development) */
export function debugAtlasCanvas() {
  const tex = foliageAtlas();
  const S = ATLAS_SIZE, cv = makeCanvas(S, S), ctx = cv.getContext('2d');
  const id = ctx.createImageData(S, S); id.data.set(tex.mipmaps[0].data); ctx.putImageData(id, 0, 0);
  return cv;
}
