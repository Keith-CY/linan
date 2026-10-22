// 垂柳 Weeping willow (Salix babylonica), the signature tree of West Lake.
//   A short, thick, often leaning trunk forks into 3-6 scaffold limbs that rise and ARCH outward; their finer
//   branches arch over further, and from the outer, upper parts of every branch hang the pendulous
//   branchlets: each leaves its branch a little upward, turns over and falls almost straight down, 1.5-4 m.
//   Strands are view-facing ribbons (src/vegetation/util.js addRibbon) that tile the strand texture every
//   0.6 m (atlas column 0: spring young leaves + catkins / summer / autumn / bare winter twigs), so they never
//   read as cards seen edge-on and keep crisp leaves along their whole length.
//
//   buildWillow(seed, opts) → { H, R, lods: [{bark, ribbon, inner?, blob?, tris}, ...] }
//   LOD0: every branch a tube + ~700-1200 single strands. LOD1: limbs + ~170 "curtain" ribbons (6 strands per
//   texture tile). LOD2: trunk + a few blobs + 50 curtain ribbons. LOD3: billboard (library).
import { GeoBuilder, v3, perp, rotAxis, clamp, lerp, smoothstep, addBlob, addTube, addRibbon, clusterBlobs } from './util.js';
import { cellRect, cellOf, T, PATCH } from './atlas.js';
import { Simplex } from '../core/noise.js';
import { RNG, hashString } from '../core/rng.js';

export function buildWillow(seed, opts = {}) {
  const rng = new RNG(`hz-willow:${seed}`);
  const nz = new Simplex(hashString(`hz-willowN:${seed}`));
  const S = opts.scale || 1;
  const trunkH = rng.range(1.6, 2.8) * S;
  const trunkR = rng.range(0.24, 0.38) * S;
  // lean toward +x (the library rotates instances; placement turns the lean toward the water)
  const leanK = (opts.lean ?? rng.range(0.08, 0.3));
  const crownW = rng.range(9, 13) * S, crownH = rng.range(6.5, 9) * S;
  const cc = [leanK * trunkH * 1.6, trunkH + crownH * 0.45, 0];
  const branches = [];
  const anchors = []; // strand attachment points {p, d (branch dir), w (weight)}

  // ---- trunk (gnarled, leaning, with a swollen base)
  {
    const pts = [], rad = [];
    const n = 12;
    for (let i = 0; i <= n; i++) {
      const t = i / n, y = -0.4 + (trunkH + 0.4) * t;
      pts.push([leanK * y * (0.6 + 0.6 * t) + 0.12 * S * nz.noise2(t * 2, 1), y, 0.12 * S * nz.noise2(t * 2, 5)]);
      rad.push(trunkR * (1.25 - 0.3 * Math.sqrt(t)) * (i === 0 ? 1.25 : 1) * (1 + 0.12 * nz.noise2(t * 6, 2)));
    }
    branches.push({ pts, rad, depth: 0, trunk: true });
  }
  const top = branches[0].pts[branches[0].pts.length - 1];
  const topR = branches[0].rad[branches[0].rad.length - 1];

  // ---- arching limbs: the upward component decays along the branch (gravity), tips turn over
  const arch = (start, dir, len, r0, depth, archK) => {
    const n = clamp(Math.round(len / 0.25), 4, 18);
    const pts = [start], rad = [r0];
    let d = dir, p = start;
    const sk = rng.random() * 50;
    for (let i = 1; i <= n; i++) {
      const t = i / n;
      const w = [nz.noise3(p[0] * 0.7 + sk, p[1] * 0.7, p[2] * 0.7), 0, nz.noise3(p[0] * 0.7, p[1] * 0.7, p[2] * 0.7 + sk)];
      d = v3.norm(v3.add(v3.add(d, v3.mul(w, 0.14)), [0, -archK * t * t * 0.45, 0]));
      p = v3.mad(p, d, len / n);
      pts.push(p);
      rad.push(r0 * (1 - 0.6 * t));
    }
    branches.push({ pts, rad, depth });
    // strand anchors along the branch (denser on the finer branches, none low on the scaffold limbs)
    const every = (depth >= 3 ? 0.07 : depth === 2 ? 0.09 : 0.22) / (opts.density ?? 1);
    let acc = 0;
    for (let i = 1; i < pts.length; i++) {
      const sl = v3.len(v3.sub(pts[i], pts[i - 1]));
      acc += sl;
      if (i / pts.length < (depth >= 2 ? 0.1 : 0.5)) continue;
      while (acc > every) { acc -= every; anchors.push({ p: v3.lerp(pts[i - 1], pts[i], rng.random()), d: v3.norm(v3.sub(pts[i], pts[i - 1])), depth }); }
    }
    if (depth >= 3) return;
    const nk = depth === 1 ? rng.int(4, 6) : rng.int(3, 4);
    for (let k = 0; k < nk; k++) {
      const t = lerp(0.25, 0.92, (k + rng.random() * 0.6) / nk);
      const idx = clamp(Math.round(t * (pts.length - 1)), 1, pts.length - 1);
      const pd = v3.norm(v3.sub(pts[idx], pts[idx - 1]));
      let cd = rotAxis(pd, rotAxis(perp(pd), pd, rng.random() * 6.28), rng.range(0.35, 0.75));
      cd = v3.norm([cd[0], Math.abs(cd[1]) * 0.7 + 0.35, cd[2]]);
      arch(pts[idx], cd, len * rng.range(0.5, 0.66), rad[idx] * 0.6, depth + 1, archK * 1.8 + 0.2);
    }
  };
  // scaffold limbs rise in a vase (15-45° from vertical) and spread; only their outer branches arch over
  const nl = rng.int(4, 6);
  for (let l = 0; l < nl; l++) {
    const a = (l / nl) * Math.PI * 2 + rng.range(-0.4, 0.4);
    const ang = rng.range(0.25, 0.75);
    const dir = v3.norm([Math.cos(a) * Math.sin(ang) + leanK * 0.6, Math.cos(ang), Math.sin(a) * Math.sin(ang)]);
    arch(top, dir, rng.range(4.2, 6.0) * S, topR * rng.range(0.42, 0.58), 1, rng.range(0.08, 0.22));
  }

  // ---- strands: grown under gravity from each anchor
  const strands = [];
  const groundY = opts.groundY ?? 0.25; // lowest a strand may hang (over water they may touch it)
  for (const a of anchors) {
    if (opts.strandKeep && !rng.chance(opts.strandKeep)) continue;
    const out = v3.norm([a.p[0] - cc[0], 0, a.p[2] - cc[2]]);
    // initial direction: along the branch, up and out
    let d = v3.norm(v3.add(v3.add(v3.mul(a.d, 0.5), v3.mul(out, 0.45)), [0, rng.range(0.0, 0.45), 0]));
    const hk = clamp((a.p[1] - trunkH) / Math.max(1, crownH), 0, 1);
    const maxL = rng.range(1.2, 2.4) * S * (1 + 1.3 * hk) * (rng.chance(0.15) ? 1.4 : 1);
    const pts = [a.p];
    let p = a.p, L = 0;
    const step = 0.14;
    const wob = rng.random() * 10;
    while (L < maxL) {
      d = v3.norm(v3.add(d, [0, -0.32, 0]));              // gravity: quickly hangs vertically
      d = v3.norm(v3.add(d, v3.mul(out, 0.01)));
      const q = v3.mad(p, d, step);
      q[0] += 0.006 * Math.sin(L * 2.2 + wob); q[2] += 0.006 * Math.cos(L * 1.7 + wob);
      if (q[1] < groundY) break;
      pts.push(q); p = q; L += step;
    }
    if (pts.length < 4) continue;
    strands.push({ pts, len: L, rnd: rng.random(), out });
  }

  const H = Math.max(...branches.flatMap((b) => b.pts.map((p) => p[1]))) + 0.3;
  let R = 0;
  for (const s of strands) for (const p of s.pts) R = Math.max(R, Math.hypot(p[0], p[2]));
  const bentAt = (p) => v3.norm([(p[0] - cc[0]) / (crownW * 0.5), (p[1] - cc[1]) / (crownH * 0.5) + 0.25, (p[2] - cc[2]) / (crownW * 0.5)]);
  const radialAO = (p) => {
    const d = Math.hypot((p[0] - cc[0]) / (crownW * 0.5), (p[2] - cc[2]) / (crownW * 0.5));
    return clamp(0.35 + 0.65 * smoothstep(0.15, 0.9, d) * (0.75 + 0.25 * smoothstep(0, H, p[1])), 0.2, 1);
  };

  /** emit strands as tiled ribbons. curtain: use the multi-strand cell and wider ribbons */
  function emitStrands(gb, list, curtain, widthK = 1) {
    const type = curtain ? T.willowCurtain : T.willow;
    const rect = cellRect(cellOf(type, 0));
    const tile = curtain ? 1.4 : 0.6;
    const w0 = (curtain ? 0.7 : 0.2) * widthK;
    for (const s of list) {
      // split into tiles of `tile` metres (each tile maps the whole cell along v)
      const ao = radialAO(s.pts[Math.min(s.pts.length - 1, 3)]);
      let seg = [s.pts[0]], segL = 0, startL = 0, tot = 0;
      const flush = () => {
        if (seg.length < 2) return;
        const L0 = startL;
        addRibbon(gb, seg, (t) => w0 * (1 - 0.45 * smoothstep(0.55, 1, (L0 + t * segL) / s.len)), rect,
          (p) => v3.norm(v3.add(v3.mul(bentAt(p), 0.75), v3.mul(s.out, 0.35))),
          (p, t) => { const g = (L0 + t * segL) / s.len; return [clamp(ao * (0.75 + 0.25 * (1 - g)), 0.1, 1), 0.3 + 0.5 * (1 - g), s.rnd, clamp(0.25 + g * 0.75, 0, 1)]; });
      };
      for (let i = 1; i < s.pts.length; i++) {
        const sl = v3.len(v3.sub(s.pts[i], s.pts[i - 1]));
        if (segL + sl > tile && seg.length >= 2) {
          // split exactly at the tile boundary
          const f = (tile - segL) / sl;
          const q = v3.lerp(s.pts[i - 1], s.pts[i], f);
          seg.push(q); segL = tile; flush();
          startL += tile; tot += tile;
          seg = [q, s.pts[i]]; segL = sl * (1 - f);
        } else { seg.push(s.pts[i]); segL += sl; }
      }
      flush();
    }
  }
  function emitWood(gb, maxDepth, radials, minR) {
    for (const b of branches) {
      if (b.depth > maxDepth || b.rad[0] < minR) continue;
      addTube(gb, b.pts, b.rad, {
        radial: radials[Math.min(radials.length - 1, b.depth)], noise: nz, gnarl: b.depth === 0 ? 0.55 : 0.15, twist: 0.3, seed: b.pts.length,
        cap: b.depth > 0, flare: b.trunk ? 0.4 : 0, flareLobes: 2.5,
        fol: (t, p) => [b.depth === 0 ? 0.9 : clamp(radialAO(p) + 0.15, 0.3, 1), 0, 0.5, b.trunk ? 0.05 : clamp(0.15 + 0.35 * p[1] / H, 0, 0.5)],
      });
    }
  }
  /** curtain clusters for the mid / far LODs: group strands by position, one wide ribbon per group */
  function curtainStrands(count) {
    const cl = clusterBlobs(strands.map((s) => ({ p: s.pts[0], r: 0.3, rnd: s.rnd })), count, new RNG('wc' + seed + count), 0.3);
    const out = [];
    for (const c of cl) {
      // representative strand: the one closest to the cluster centre, lengthened to the cluster's typical length
      let best = null, bd = 1e9;
      for (const s of strands) { const d = v3.len(v3.sub(s.pts[0], c.p)); if (d < bd) { bd = d; best = s; } }
      if (best) out.push(best);
    }
    return out;
  }
  const patch = cellRect(cellOf(...PATCH.willow), 0.08);
  function emitBlobs(gb, n, inflate) {
    const tops = clusterBlobs(anchors.map((a) => ({ p: a.p, r: 0.6, rnd: rng.random() })), n, new RNG('wb' + seed + n), 0.8);
    for (const b of tops) {
      const ao0 = radialAO(b.p);
      addBlob(gb, v3.add(b.p, [0, -0.6, 0]), [0, 1, 0], [1, 0, 0], [0, 0, 1], b.r * inflate * 1.2, b.r * inflate, b.r * inflate, {
        lon: 6, lat: 4, rect: patch, lump: 0.3, noise: nz, seed: b.rnd * 5,
        normalFn: (p, nl) => v3.norm(v3.add(v3.mul(nl, 0.6), v3.mul(bentAt(p), 0.6))),
        fol: (p, nl, ph) => [clamp(ao0 * (0.5 + 0.5 * ph), 0.1, 1), 0.3 * ph, b.rnd, 0.3],
      });
    }
  }

  const lods = [];
  {
    const bark = new GeoBuilder(), rib = new GeoBuilder({ ribbon: true });
    emitWood(bark, 9, [12, 7, 5, 4], 0.006);
    emitStrands(rib, strands, false);
    lods.push({ bark: bark.build(), ribbon: rib.build(), tris: bark.triangles + rib.triangles });
  }
  {
    const bark = new GeoBuilder(), rib = new GeoBuilder({ ribbon: true });
    emitWood(bark, 2, [7, 5, 3], 0.025);
    emitStrands(rib, curtainStrands(Math.min(320, Math.round(strands.length / 3))), true, 1.15);
    lods.push({ bark: bark.build(), ribbon: rib.build(), tris: bark.triangles + rib.triangles });
  }
  {
    const bark = new GeoBuilder(), rib = new GeoBuilder({ ribbon: true }), blob = new GeoBuilder();
    emitWood(bark, 1, [5, 3], 0.05);
    emitStrands(rib, curtainStrands(55), true, 2.2);
    emitBlobs(blob, 7, 1.15);
    lods.push({ bark: bark.build(), ribbon: rib.build(), blob: blob.build(), tris: bark.triangles + rib.triangles + blob.triangles });
  }
  return { H, R: Math.max(R, crownW * 0.5), lods, strands: strands.length, anchors: anchors.length };
}
