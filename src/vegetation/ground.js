// Ground layer: grass tufts, ferns, reeds, shrubs, ivy / vines on rock, fallen petals and leaves.
// All from the canvas atlas (src/vegetation/atlas.js) on small card geometries, instanced through the VegSystem
// (LOD0 full, LOD1 fewer cards, then culled: the terrain shader carries the colour beyond).
//   buildGroundLibrary(sys, engine) → { grass, fern, reed, shrub, litterPetal, litterLeaf, litterBrown, litterNeedle, vine, ivyMat }
//   placeGround(engine, sys, lib, placer) — near the shot cameras, on the causeways, shores, the 灵隐 valley and
//   cliff, under the trees that drop petals / leaves (season-gated by their materials)
import { GeoBuilder, v3, clamp, addCard, addTiledRibbon } from './util.js';
import { cellRect, cellOf, T, foliageAtlas } from './atlas.js';
import { foliageMaterial, barkMaterial } from './materials.js';
import { buildTree } from './trees.js';
import { billboardQuad } from './util.js';
import { RNG, hash01 } from '../core/rng.js';
import { heightAt, slopeAt } from '../world/heightfield.js';
import * as L from '../world/layout.js';
import { SHOTS } from '../world/shots.js';
import { planCams } from '../world/plancams.js';

const TAU = Math.PI * 2;
const UP = [0, 1, 0];

// ---------------------------------------------------------------- geometries
/** tuft of crossed, outward-leaning, slightly bent cards (grass, reeds, ferns) */
function tuft(rng, { cards, h, w, lean, bend, cell, rows = [0], spread = 0.08, ao = 0.6 }) {
  const gb = new GeoBuilder();
  for (let i = 0; i < cards; i++) {
    const a = (i / cards) * Math.PI + rng.range(-0.3, 0.3);
    const side = [Math.cos(a), 0, Math.sin(a)];
    const out = v3.cross(side, UP);
    const sg = rng.chance(0.5) ? 1 : -1;
    const up = v3.norm(v3.add(UP, v3.mul(out, sg * lean * rng.range(0.5, 1.2))));
    const o = [rng.range(-spread, spread), -0.07, rng.range(-spread, spread)];
    const hh = h * rng.range(0.75, 1.15);
    const rect = cellRect(cellOf(cell, rows[Math.floor(rng.random() * rows.length)]));
    addCard(gb, o, up, side, w * rng.range(0.8, 1.2), hh, rect,
      (p) => v3.norm(v3.add(v3.mul(UP, 0.8), v3.mul(v3.norm([p[0], 0.001, p[2]]), 0.5))),
      (p, t) => [clamp(ao + (1 - ao) * t, 0.1, 1), t, rng.random(), t * 0.8],
      bend * rng.range(0.6, 1.3), rng.chance(0.5));
  }
  return gb;
}

/** fern: fronds radiating from a crown, arching outward (bent cards lying at 30-60° from vertical) */
function fern(rng, { fronds, len }) {
  const gb = new GeoBuilder();
  for (let i = 0; i < fronds; i++) {
    const a = (i / fronds) * TAU + rng.range(-0.25, 0.25);
    const out = [Math.cos(a), 0, Math.sin(a)];
    const tilt = rng.range(0.45, 1.0);
    const up = v3.norm(v3.add(v3.mul(UP, Math.cos(tilt)), v3.mul(out, Math.sin(tilt))));
    const side = v3.norm(v3.cross(up, out));
    const l = len * rng.range(0.75, 1.15);
    const rect = cellRect(cellOf(T.fern, rng.int(0, 1)));
    addCard(gb, [0, 0, 0], up, side, l * 0.62, l, rect,
      (p) => v3.norm(v3.add(UP, v3.mul(out, 0.3))),
      (p, t) => [0.5 + 0.5 * t, t, rng.random(), t * 0.6], 0.25, rng.chance(0.5));
  }
  return gb;
}

/** flat litter: a handful of cards lying on the ground in a ~r m patch (petals / leaves / needles) */
function litter(rng, { n, r, size, row }) {
  const gb = new GeoBuilder();
  for (let i = 0; i < n; i++) {
    const [dx, dz] = rng.disk();
    const o = [dx * r, 0.015 + i * 0.002, dz * r];
    const a = rng.random() * TAU;
    const up = [Math.cos(a), 0.02, Math.sin(a)];
    const side = v3.norm(v3.cross(UP, up));
    const sz = size * rng.range(0.7, 1.2);
    addCard(gb, v3.mad(o, up, -sz * 0.5), v3.norm(up), side, sz, sz, cellRect(cellOf(T.litter, row)),
      () => UP, () => [0.8, 0, rng.random(), 0], 0, rng.chance(0.5));
  }
  return gb;
}

/** hanging vine strand ribbon (ivy column, row 1: a stem with alternate leaves) following a path; the texture
 *  repeats every 0.7 m. out = the direction the rock face looks toward (the lighting normal leans out) */
function vineStrand(gb, pts, width, out, rnd) {
  addTiledRibbon(gb, pts, 0.7, (g) => width * (1 - 0.35 * g), cellRect(cellOf(T.ivy, 1)),
    () => v3.norm([out[0] * 0.8, 0.55, out[2] * 0.8]), (p, g) => [0.65 + 0.35 * (1 - g), 0.3, rnd, 0.15 + 0.85 * g]);
}
/** ivy mat card pressed against a rock face at p (normal n) */
function ivyMat(gb, p, n, size, rng) {
  const side = v3.norm(v3.cross([0, 1, 0], n));
  const up = v3.norm(v3.cross(n, side));
  const o = v3.mad(v3.mad(p, n, 0.06), up, -size * 0.5);
  addCard(gb, o, up, side, size * rng.range(0.8, 1.2), size, cellRect(cellOf(T.ivy, rng.chance(0.75) ? 0 : 3)),
    () => v3.norm(v3.add(n, [0, 0.5, 0])), (q, t) => [0.6 + 0.4 * t, 0.2, rng.random(), 0.1], 0.15, rng.chance(0.5));
}

// ---------------------------------------------------------------- library
export function buildGroundLibrary(sys, engine) {
  const t0 = performance.now();
  const atlas = foliageAtlas();
  const M = (sp, kind = 'card') => foliageMaterial(sp, kind, atlas);
  const lib = {};
  const reg = (name, kind, lods, H, px, mats, extra = {}) => {
    const v = sys.addVariant({ name, kind, lods, H, px, cullPx: extra.cullPx ?? 3, shadowLod: extra.shadowLod ?? 0, materials: mats, ctrK: 0.5, radK: 1.0, ...extra });
    (lib[kind] ||= []).push(v);
    return v;
  };
  const build = (gb) => ({ card: gb.build(), tris: gb.triangles });
  // grass: 3 variants (short lawn tuft, tall verge tuft, wild clump)
  [[5, 0.32, 0.45, 0.35, 0.15], [6, 0.55, 0.55, 0.4, 0.2], [8, 0.75, 0.7, 0.5, 0.25]].forEach(([cards, h, w, lean, bend], i) => {
    const r = new RNG('grass' + i);
    const l0 = build(tuft(r, { cards, h, w, lean, bend, cell: T.grass, rows: [0] }));
    const l1 = build(tuft(r, { cards: Math.ceil(cards / 2), h, w: w * 1.3, lean, bend, cell: T.grass, rows: [0] }));
    reg('grass-' + i, 'grass', [l0, l1], h, [30, 6, 0], { card: M('grass') }, { cullPx: 3, shadowLod: -1 });
  });
  // reeds (芦苇): tall clumps of reed cards (row 3 of the shrub column = reed plume)
  [0, 1, 2].forEach((i) => {
    const r = new RNG('reed' + i);
    const h = 1.7 + i * 0.25;
    const l0 = build(tuft(r, { cards: 7 + i * 2, h, w: 0.75, lean: 0.25, bend: 0.12, cell: T.shrub, rows: [3], spread: 0.35, ao: 0.45 }));
    const l1 = build(tuft(r, { cards: 3, h, w: 1.1, lean: 0.25, bend: 0.12, cell: T.shrub, rows: [3], spread: 0.35, ao: 0.45 }));
    reg('reed-' + i, 'reed', [l0, l1], h, [60, 8, 0], { card: M('reed') }, { cullPx: 3, shadowLod: 0 });
  });
  // ferns
  [0, 1].forEach((i) => {
    const r = new RNG('fern' + i);
    const len = 0.7 + i * 0.3;
    const l0 = build(fern(r, { fronds: 9 + i * 3, len }));
    const l1 = build(fern(r, { fronds: 5, len: len * 1.1 }));
    reg('fern-' + i, 'fern', [l0, l1], len, [40, 8, 0], { card: M('fern') }, { cullPx: 3, shadowLod: -1 });
  });
  // shrubs (understorey, hedges): the tree generator with the shrub spec
  const shM = { bark: barkMaterial('shrub'), card: M('shrub'), inner: M('shrub', 'inner'), blob: M('shrub', 'blob'), bb: M('shrub', 'bb') };
  [0, 1, 2].forEach((i) => {
    const t = buildTree('shrub', 500 + i * 13);
    t.lods[3] = { bb: billboardQuad(t.H, t.R, cellRect(cellOf(T.patchB, 3), 0.1)), tris: 2 };
    reg('shrub-' + i, 'shrub', t.lods, t.H, [90, 30, 10], shM, { cullPx: 1.5, shadowLod: 1, radK: 0.8 });
  });
  // litter patches (petals / autumn leaves / brown leaves / pine needles), material per row (season-gated)
  [['litterPetal', 0, 0.065], ['litterLeaf', 1, 0.09], ['litterBrown', 2, 0.08], ['litterNeedle', 3, 0.12]].forEach(([sp, row, size]) => {
    [0, 1].forEach((i) => {
      const r = new RNG(sp + i);
      const l0 = build(litter(r, { n: 26, r: 1.6, size: size * 9, row }));
      reg(`${sp}-${i}`, sp, [l0], 0.3, [4, 0, 0], { card: M(sp) }, { cullPx: 2.0, shadowLod: -1 });
    });
  });
  console.log(`[vegetation] ground library ${Object.entries(lib).map(([k, v]) => k + '×' + v.length).join(' ')} in ${Math.round(performance.now() - t0)} ms`);
  return lib;
}

// ---------------------------------------------------------------- vines on rock (built per site: not instanced)
/**
 * Vines hanging over a rock face: strands start on the upper face and climb down along the terrain surface, kept
 * a few cm off it. sites: [{ a:[x,z], b:[x,z], out: bearing the face looks toward (deg), top (y), drop (m) }]
 * Also consumes engine.slots.ivy ({ pos:[x,y,z], facing (deg), size (m) }) from other modules.
 */
export function buildVines(engine, sites) {
  const atlas = foliageAtlas();
  const gb = new GeoBuilder({ ribbon: true });
  const rng = new RNG('vines');
  let n = 0;
  for (const S of sites) {
    const ob = (S.out * Math.PI) / 180, out = [Math.sin(ob), 0, -Math.cos(ob)];
    const len = Math.hypot(S.b[0] - S.a[0], S.b[1] - S.a[1]);
    const count = Math.round(len * (S.density ?? 3));
    for (let k = 0; k < count; k++) {
      const t = (k + rng.random()) / count;
      // clumps and gaps along the edge
      if (Math.sin(t * len * 0.6 + 1.3) * Math.sin(t * len * 0.23) < -0.35) continue;
      let x = S.a[0] + (S.b[0] - S.a[0]) * t, z = S.a[1] + (S.b[1] - S.a[1]) * t;
      let y;
      // a site on a sculpted face (the 飞来峰 karst: S.sdf, world metres, > 0 outside the rock) starts at its anchor height
      // and hangs against the real rock, not against the heightfield's placeholder slope (the strands were buried in it)
      const sdf = S.sdf;
      if (S.pos) { x = S.pos[0]; y = S.pos[1]; z = S.pos[2]; }
      else if (sdf && S.top !== undefined) {
        y = S.top - rng.range(0, 0.8);
        for (let k2 = 0; k2 < 80 && sdf(x, y, z) < 0.08; k2++) { x += out[0] * 0.1; z += out[2] * 0.1; }
      }
      else {
        // from the foot line, walk back into the hill to the rim (where the ground reaches ~80 % of the face height)
        const foot = heightAt(x, z), rimY = foot + (S.height ?? 20) * rng.range(0.55, 0.95);
        for (let k2 = 0; k2 < 40 && heightAt(x, z) < rimY; k2++) { x -= out[0] * 0.5; z -= out[2] * 0.5; }
        y = Math.min(heightAt(x, z), rimY) + 0.1;
      }
      const drop = (S.drop ?? 8) * (rng.chance(0.3) ? rng.range(0.8, 1.15) : rng.range(0.3, 0.8));
      const side = [-out[2], 0, out[0]];
      const pts = [[x, y, z]];
      let p = pts[0], lat = 0;
      for (let d = 0.25; d < drop; d += 0.25) {
        lat += rng.range(-0.04, 0.04);
        const q = [p[0] + side[0] * lat * 0.25, p[1] - 0.25, p[2] + side[2] * lat * 0.25];
        // hang against the face: step outward until the point is in the open, a few cm off the rock
        if (sdf) {
          for (let k2 = 0; k2 < 60 && sdf(q[0], q[1], q[2]) < 0.06; k2++) { q[0] += out[0] * 0.1; q[2] += out[2] * 0.1; }
          for (let k2 = 0; k2 < 20 && sdf(q[0], q[1], q[2]) > 0.35; k2++) { q[0] -= out[0] * 0.1; q[2] -= out[2] * 0.1; }
        } else for (let k2 = 0; k2 < 60 && heightAt(q[0], q[2]) > q[1] - 0.06; k2++) { q[0] += out[0] * 0.1; q[2] += out[2] * 0.1; }
        pts.push(q); p = q;
      }
      if (pts.length < 3) continue;
      vineStrand(gb, pts, rng.range(0.28, 0.4), out, rng.random());
      // leafy mats on the face along the upper part of the strand
      // (on the karst: small leaves all down the hanging strand, ink08, not mats at its head)
      for (let m = 0; m < (sdf ? 22 : 7); m++) {
        const q = pts[Math.min(pts.length - 1, 1 + Math.floor(Math.pow(rng.random(), sdf ? 1.3 : 1.8) * (pts.length - 1)))];
        if (rng.chance(0.55)) ivyMat(gb, q, out, sdf ? rng.range(0.2, 0.5) : rng.range(0.3, 0.6), rng);
      }
      n++;
    }
  }
  if (!n) return null;
  const mat = foliageMaterial('ivy', 'ribbon', atlas);
  return { geo: gb.build(), mat, strands: n, tris: gb.triangles };
}

// ---------------------------------------------------------------- placement
export function placeGround(engine, sys, lib, P) {
  const counts = {};
  const pick = (kind, h) => { const a = lib[kind]; return a[Math.floor(h * a.length) % a.length]; };
  const add = (kind, x, y, z, h, s = 1, opts = {}) => { sys.add(pick(kind, h), x, y, z, h * TAU * 13.1, s, opts); counts[kind] = (counts[kind] || 0) + 1; };
  const terr = (x, z) => heightAt(x, z);
  const free = (x, z, r) => engine.footprints.isFree(x, z, r);

  // ---- near every shot camera: grass, ferns and shrubs in the view cone (0-110 m), density falling with distance
  for (const S of planCams()) {
    const dx = S.target[0] - S.pos[0], dz = S.target[2] - S.pos[2], l = Math.hypot(dx, dz);
    const fx = dx / l, fz = dz / l;
    const tanH = Math.tan(((S.fov || 40) * Math.PI) / 360) * (1664 / 928);
    const R = 110, cell = 1.6;
    const i0 = Math.floor((S.pos[0] - R) / cell), i1 = Math.ceil((S.pos[0] + R) / cell);
    const j0 = Math.floor((S.pos[2] - R) / cell), j1 = Math.ceil((S.pos[2] + R) / cell);
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
      const x = (i + hash01(i, j, 201)) * cell, z = (j + hash01(i, j, 202)) * cell;
      const vx = x - S.pos[0], vz = z - S.pos[2], d = Math.hypot(vx, vz);
      if (d > R || d < 1.5) continue;
      const fwd = vx * fx + vz * fz;
      if (fwd < 0.5 || Math.abs(vx * fz - vz * fx) / fwd > tanH * 1.15) continue;
      const keep = d < 25 ? 0.9 : 0.9 * (1 - (d - 25) / (R - 25)) ** 1.2;
      if (hash01(i, j, 203) > keep) continue;
      const y = terr(x, z);
      if (y < 0.35) continue;                       // dry land only (causeways and islands lie inside the lake outline)
      const sl = slopeAt(x, z, 1);
      if (sl > 0.7) continue;
      if (!free(x, z, 0.4)) continue;
      if (P && P.onTerrace(x, z, 0)) continue;
      if (slopeAt(x, z, 0.4) > 0.6 || slopeAt(x, z, 3) > 0.55) continue; // cliffs and steep banks: no floating tufts
      // keep paths clear: the causeway centre line (6 m)
      if (onCausewayPath(x, z)) continue;
      const h = hash01(i, j, 204);
      const nearTree = P && P.taken(x, z, 4);
      if (nearTree && h < 0.3) add('fern', x, y, z, hash01(i, j, 205), 0.8 + 0.5 * hash01(i, j, 206));
      else if (sl > 0.2 && h < 0.12) add('shrub', x, y - 0.05, z, hash01(i, j, 207), 0.8 + 0.5 * hash01(i, j, 208));
      else add('grass', x, y, z, hash01(i, j, 209), 0.8 + 0.6 * hash01(i, j, 210));
    }
  }
  // ---- causeway verges: denser grass along both edges and between the trees
  for (const C of [L.SU_CAUSEWAY, L.BAI_CAUSEWAY]) {
    const len = L.polyLength(C.points);
    for (let s = 0; s < len; s += 0.55) {
      const p = L.polyPoint(C.points, s / len);
      if (!nearAnyCamera(p.x, p.z, 260)) continue;
      for (const side of [-1, 1]) {
        const k = Math.round(s * 10) * 2 + (side > 0 ? 1 : 0);
        const off = side * (4 + (C.width / 2 - 5) * hash01(k, 301));
        const x = p.x - p.tz * off, z = p.z + p.tx * off;
        const y = terr(x, z);
        if (y < 0.35 || slopeAt(x, z, 0.5) > 0.4) continue;
        add('grass', x, y, z, hash01(k, 302), 0.9 + 0.6 * hash01(k, 303));
      }
    }
  }
  // ---- shores: reed beds in patches where the shore is low, within 700 m of a camera
  {
    const pts = L.LAKE.outline;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      const seg = Math.hypot(b[0] - a[0], b[1] - a[1]);
      for (let s = 0; s < seg; s += 1.4) {
        const k = i * 100000 + Math.round(s * 10);
        const px = a[0] + (b[0] - a[0]) * s / seg, pz = a[1] + (b[1] - a[1]) * s / seg;
        if (!nearAnyCamera(px, pz, 700)) continue;
        // patches: a slow noise along the shore
        const patch = Math.sin(px * 0.013 + pz * 0.007) * Math.sin(px * 0.004 - pz * 0.011);
        if (patch < 0.25) continue;
        const nx = -(b[1] - a[1]) / seg, nz = (b[0] - a[0]) / seg;
        const o = (hash01(k, 401) - 0.6) * 7;
        const x = px + nx * o, z = pz + nz * o;
        const y = terr(x, z);
        if (y > 0.9 || y < -0.9) continue;
        if (!free(x, z, 0.6) || blocksAnyShot(x, z, 2.2)) continue;
        add('reed', x, Math.max(y, -0.4), z, hash01(k, 402), 0.8 + 0.4 * hash01(k, 403));
      }
    }
  }
  // ---- litter under trees near cameras: petals under peach, leaves under maple / ginkgo / broad, needles under pine
  if (P) {
    const near = (v) => sys.variants.filter((x) => x.kind === v);
    const drop = (kinds, sp, per, rad) => {
      for (const v of kinds.flatMap(near)) for (const [n, it] of v.inst.entries()) {
        if (!nearAnyCamera(it.x, it.z, 140)) continue;
        for (let k = 0; k < per; k++) {
          const a = hash01(n, k, 501) * TAU, r = rad * Math.sqrt(hash01(n, k, 502)) * it.s;
          const x = it.x + Math.cos(a) * r, z = it.z + Math.sin(a) * r;
          const y = terr(x, z);
          if (y < 0.3 || slopeAt(x, z, 0.5) > 0.4) continue;
          add(sp, x, y, z, hash01(n, k, 503), 0.8 + 0.4 * hash01(n, k, 504));
        }
      }
    };
    drop(['peach'], 'litterPetal', 7, 3.2);
    drop(['maple', 'ginkgo'], 'litterLeaf', 5, 3.5);
    drop(['broad'], 'litterBrown', 2, 3.5);
    drop(['pineH', 'pineM'], 'litterNeedle', 2, 3.0);
  }
  return counts;
}

/** vine sites: the 飞来峰 cliff (layout LINGYIN.cliff) + engine.slots.ivy */
export function vineSites(engine) {
  const sites = [];
  const C = L.LINGYIN?.cliff;
  // (with the sculpted karst in the world its own rim anchors carry the vines: the placeholder face's strands lay on
  // the floor in front of the real rock)
  const kSdf = engine.registry?.karst?.feilai?.sdf || null;
  if (C && !kSdf) {
    for (let i = 0; i < C.face.length - 1; i++) {
      const a = C.face[i], b = C.face[i + 1];
      sites.push({ a, b, out: C.normal, height: C.height || 20, drop: (C.height || 20) * 0.8, density: 7 });
    }
  }
  for (const s of engine.slots?.ivy || []) {
    const fb = ((s.facing || 0) * Math.PI) / 180, side = [Math.cos(fb), Math.sin(fb)];
    const w = s.size || 3;
    sites.push({ a: [s.pos[0] - side[0] * w / 2, s.pos[2] - side[1] * w / 2], b: [s.pos[0] + side[0] * w / 2, s.pos[2] + side[1] * w / 2], out: s.facing || 0, top: s.pos[1], drop: s.drop || 3, density: 6,
      sdf: String(s.tag || '').startsWith('karst') ? kSdf : null });
  }
  return sites;
}

// ---------------------------------------------------------------- helpers
function onCausewayPath(x, z) {
  for (const C of [L.SU_CAUSEWAY, L.BAI_CAUSEWAY]) {
    const pts = C.points;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      const ex = b[0] - a[0], ez = b[1] - a[1];
      const t = clamp(((x - a[0]) * ex + (z - a[1]) * ez) / (ex * ex + ez * ez), 0, 1);
      if (Math.hypot(x - a[0] - ex * t, z - a[1] - ez * t) < 3.2) return true;
    }
  }
  return false;
}
function nearAnyCamera(x, z, r) { return planCams().some((S) => Math.hypot(x - S.pos[0], z - S.pos[2]) < r); }
/** low cameras over water (3, 4, 5, 10): keep their near water edge open */
function blocksAnyShot(x, z, h) {
  for (const S of SHOTS) {
    if (S.pos[1] > 6) continue;
    const dx = S.target[0] - S.pos[0], dz = S.target[2] - S.pos[2], l = Math.hypot(dx, dz);
    const vx = x - S.pos[0], vz = z - S.pos[2];
    const fwd = (vx * dx + vz * dz) / l;
    if (fwd < 0 || fwd > 80) continue;
    const tanH = Math.tan(((S.fov || 40) * Math.PI) / 360) * (1664 / 928);
    if (Math.abs(vx * dz - vz * dx) / l / fwd < tanH * 0.7) return true;
  }
  return false;
}
