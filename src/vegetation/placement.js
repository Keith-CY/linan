// Where every plant grows. Reads the master plan (src/world/layout.js: PLANTS zones, HERO_TREES, causeways, lake,
// islands, terraces, city) and the terrain (src/world/heightfield.js), respects engine.footprints (no tree through a
// building), and spends detail where the ten cameras look (src/world/shots.js).
//   placeWorld(engine, sys, lib) → { counts, ... }
// Order (earlier claims win the ground): hero trees → PLANTS zones → causeway rows → islands → shore willows →
// city trees → hill-forest cover in the view cone of every shot (dense near, thinning out to the canopy shader).
// Deterministic: per-cell integer hashes only.
import { hash01 } from '../core/rng.js';
import { heightAt, slopeAt, normalAt, lakeSDF, sdPolygon } from '../world/heightfield.js';
import * as L from '../world/layout.js';
import { SHOTS } from '../world/shots.js';
import { planCams } from '../world/plancams.js';
import { INK_ROWS, INK_CLIFF_PINES } from '../ink/styles.js';

const TAU = Math.PI * 2;

// How each camera keeps its view clear of trees (from docs/COMPOSITION.md; ask vegetation to change):
//   vista    — trees within `range` m must keep their tops below `low` (fraction of the half frame height below the
//              centre; 0 = the horizon line through the frame centre), except at the side edges |x| > side (NDC)
//   corridor — trees closer than `range` m are kept out of the central `side` (NDC half width)
export const VIEW_RULES = {
  1: { mode: 'vista', low: 0.72, side: 0.5, range: 400, near: 25 }, // pines frame the bottom-left / right; the lake and 白堤 stay open
  4: { mode: 'vista', low: 0.0, side: 0.45, range: 450 },   // the trees in front of 'leifeng-dian' stay below y 0.5
  6: { mode: 'vista', low: 0.25, side: 0.8, range: 300, near: 70 },
  7: { mode: 'vista', low: 0.35, side: 0.8, range: 300 },
  9: { mode: 'vista', low: 0.66, side: 0.85, range: 320, near: 0 }, // trees below (y 0.83-1.0) and right (x 0.85-1.0): the pagoda's base, the boats and the shore stay clear
  8: { mode: 'corridor', range: 150, side: 0.42 },
  10: { mode: 'corridor', range: 60, side: 0.5 },          // the bridge and the pavilion stay clear
  3: { mode: 'corridor', range: 120, side: 0.6 },           // no trees in the lotus pond in front of the halls
  5: { mode: 'corridor', range: 40, side: 0.3 },
};

// Framing trees per shot (chosen here, inside the frames of COMPOSITION.md), placed
// relative to the camera: fwd / right in metres, facing = the lean direction (deg relative to the camera heading:
// 0 = away from the camera, 90 = to the right). layout.HERO_TREES entries for a shot replace this list.
export const SHOT_HEROES = {
  // ref01: pines framing the bottom left / centre on the slope 20-60 m below the camera
  1: [
    { kind: 'pineH', fwd: 26, right: -16.5, facing: -40, scale: 0.62 },   // lower, so the far-left shore stays open
    { kind: 'pineH', fwd: 40, right: -4, facing: 20, scale: 0.75 },
    { kind: 'pineM', fwd: 46, right: -19, facing: -70, scale: 0.9 },
  ],
  // ref02: willow strands into the top-left corner, a peach branch into the right third, more along the causeway
  2: [
    { kind: 'willow', fwd: 5.0, right: -9.5, facing: 95, scale: 1.05 },
    { kind: 'peach', fwd: 2.6, right: 3.3, facing: -95, scale: 1.2 },
    { kind: 'willow', fwd: 13, right: 8.5, facing: -80, scale: 1.0 },
    { kind: 'peach', fwd: 16, right: -6.5, facing: 40, scale: 0.95 },
    { kind: 'willow', fwd: 24, right: -9.5, facing: 70, scale: 1.0 },
  ],
  // ref04: tall dark camphors on the 夕照山 shore fill the right third up to the top of the frame
  4: [
    { kind: 'camphor', fwd: 178, right: 30, facing: -60, scale: 2.0 },
    { kind: 'camphor', fwd: 192, right: 46, facing: -40, scale: 2.2 },
    { kind: 'broad', fwd: 200, right: 62, facing: -80, scale: 2.0 },
  ],
  // ref05: a willow on the islet beside the pavilion (ISLETS 'santan-islet')
  5: [{ kind: 'willow', at: [190, 776], facing: 200, scale: 0.9 }],
  // ref08: a red maple filling the left third close to the camera, ginkgo gold over the cliff top right
  8: [
    { kind: 'maple', fwd: 25, right: -16.5, facing: 60, scale: 1.05 },
    { kind: 'maple', fwd: 33, right: -12.5, facing: 30, scale: 0.75 },
    { kind: 'ginkgo', fwd: 42, right: 11, facing: -20, scale: 1.45 },
    { kind: 'ginkgo', fwd: 60, right: 13, facing: 0, scale: 1.35 },
    { kind: 'ginkgo', fwd: 78, right: 10, facing: 10, scale: 1.3 },
  ],
  // ref09: trees below and right on the 月轮山 slope
  9: [
    { kind: 'camphor', fwd: 26, right: 17, facing: 0, scale: 1.0 },
    { kind: 'pineM', fwd: 40, right: 24, facing: 30, scale: 1.0 },
  ],
  // ref10: a bare willow on the shore left of the bridge
  10: [
    { kind: 'willow', fwd: 32, right: -16, facing: 60, scale: 1.1 },
    { kind: 'willow', fwd: 55, right: -26, facing: 40, scale: 1.0 },
  ],
};

const KIND_OF = { willow: 'willow', peach: 'peach', pine: 'pine', camphor: 'camphor', maple: 'maple', ginkgo: 'ginkgo', broad: 'broad', osmanthus: 'broad', tea: 'broad', bamboo: 'broad' };

const occKey = (i, j) => (i + 32768) * 65536 + (j + 32768);

class Placer {
  constructor(engine, sys, lib) {
    this.engine = engine; this.sys = sys; this.lib = lib;
    this.q = engine.quality;
    this.counts = {};
    this.occ = new Map(); // 3 m grid: trunk occupancy (no two trunks within ~2.5 m)
    this.terraces = (L.TERRACES || []).map((t) => ({ ...t, a: ((t.rot || 0) * Math.PI) / 180 }));
  }
  // the 3 m cell (i, j) as one number (cells within ±32768 of the origin: ±98 km); each cell holds x, z, r triples
  _key(x, z) { return occKey(Math.floor(x / 3), Math.floor(z / 3)); }
  taken(x, z, r = 2.5) {
    const n = Math.ceil(r / 3), ci = Math.floor(x / 3), cj = Math.floor(z / 3);
    for (let i = -n; i <= n; i++) for (let j = -n; j <= n; j++) {
      const v = this.occ.get(occKey(ci + i, cj + j));
      if (!v) continue;
      for (let k = 0; k < v.length; k += 3) if (Math.hypot(v[k] - x, v[k + 1] - z) < Math.max(r, v[k + 2])) return true;
    }
    return false;
  }
  claim(x, z, r) { const k = this._key(x, z); let a = this.occ.get(k); if (!a) this.occ.set(k, (a = [])); a.push(x, z, r); }
  onTerrace(x, z, m = 4) {
    for (const t of this.terraces) {
      const dx = x - t.center[0], dz = z - t.center[1];
      const lx = dx * Math.cos(t.a) + dz * Math.sin(t.a), lz = -dx * Math.sin(t.a) + dz * Math.cos(t.a);
      if (Math.abs(lx) < t.size[0] / 2 + m && Math.abs(lz) < t.size[1] / 2 + m) return true;
    }
    return false;
  }
  free(x, z, r) { return this.engine.footprints.isFree(x, z, r); }
  /** the tallest tree (m above the ground y) that keeps every shot's view (VIEW_RULES): Infinity = no limit, 0 = none */
  viewLimit(x, z, y, R = 0) {
    if (!this.cams) {
      this.cams = planCams().map((S) => {
        const dx = S.target[0] - S.pos[0], dz = S.target[2] - S.pos[2], dy = S.target[1] - S.pos[1], l = Math.hypot(dx, dz);
        const tanV = Math.tan(((S.fov || 40) * Math.PI) / 360);
        // an ink camera (the ink look) keeps its own view rule (src/ink/styles.js INK_VIEW_RULES)
        const rule = S.ink ? S.viewRule || { mode: 'none' } : VIEW_RULES[S.id] || { mode: 'none' };
        return { S, rule, fx: dx / l, fz: dz / l, pitch: dy / Math.hypot(dx, dy, dz), tanV, tanH: tanV * (1664 / 928) };
      }).filter((c) => c.rule.mode !== 'none');
    }
    let lim = Infinity;
    for (const C of this.cams) {
      const vx = x - C.S.pos[0], vz = z - C.S.pos[2];
      let fwd = vx * C.fx + vz * C.fz;
      if (fwd + R <= 0.5 || fwd > (C.rule.range ?? 300)) continue;
      fwd = Math.max(fwd, 1.0);
      // the crown's nearest edge decides whether it enters the frame (a trunk just outside still sweeps its crown in)
      const ndcX = Math.max(0, Math.abs(vx * C.fz - vz * C.fx) - R * 0.8) / fwd / C.tanH;
      if (ndcX > 1.1) continue;                                 // outside the frame
      if (C.rule.mode === 'vista') {
        const near = Math.hypot(vx, vz) < (C.rule.near ?? 0);
        if (!near && ndcX > (C.rule.side ?? 0.8)) continue;     // framing trees at the side edges are welcome
        lim = Math.min(lim, Math.max(0, C.S.pos[1] + fwd * (C.pitch - C.tanV * C.rule.low) - y));
      } else if (C.rule.mode === 'corridor') {
        if (ndcX < C.rule.side) return 0;
      }
    }
    return lim;
  }
  /** compatibility: does a tree of height `top` block a shot? */
  blocksView(x, z, y, top) { return top > this.viewLimit(x, z, y); }
  /** pick a variant of `kind` from a hash */
  variant(kind, h) { const a = this.lib[kind]; return a && a.length ? a[Math.floor(h * a.length) % a.length] : null; }
  /** place one plant. opts: yaw, scale, lean [dx, dz] (tilt of the growth axis), tint, force (skip checks), r (trunk clearance) */
  put(kind, x, z, h, o = {}) {
    const v = this.variant(kind, h);
    if (!v) return false;
    const y = o.y ?? heightAt(x, z);
    let s = o.scale ?? 1;
    const crownR = (v.R || 3) * s;
    if (!o.force) {
      if (y < (o.minY ?? 0.35)) return false;
      // no camera inside or right next to a crown
      const H0 = (v.H || 10) * s;
      for (const S of planCams()) {
        const dc = Math.hypot(x - S.pos[0], z - S.pos[2]);
        if (dc < crownR + 2.5 && S.pos[1] > y - 1 && S.pos[1] < y + H0 + 1) return false;
      }
      if (o.view !== false) {
        const lim = this.viewLimit(x, z, y, crownR);
        const H = (v.H || 10) * s;
        if (H > lim) {
          if (lim < H * 0.55 || lim < 2.5) return false;
          o = { ...o, scale: (s * lim) / H };
        }
      }
      if (this.taken(x, z, o.r ?? Math.max(2.2, crownR * 0.35))) return false;
      if (!this.free(x, z, o.fp ?? Math.max(1.5, crownR * 0.55))) return false;
      if (!o.terraceOk && this.onTerrace(x, z)) return false;
    }
    s = o.scale ?? s;
    const up = o.lean ? [o.lean[0], 1, o.lean[1]] : undefined;
    this.sys.add(v, x, y - (o.sink ?? 0.25), z, o.yaw ?? h * TAU * 7.3, s, { up, tint: o.tint, width: o.width, hs: o.hs });
    this.claim(x, z, o.r ?? Math.max(2.2, crownR * 0.35));
    this.counts[kind] = (this.counts[kind] || 0) + 1;
    return true;
  }

  // ---------------------------------------------------------------- HERO_TREES (layout, exact)
  heroes() {
    for (const [i, t] of (L.HERO_TREES || []).entries()) {
      const kind = this.heroKind(t.species);
      const v = this.variant(kind, hash01(i, 71));
      if (!v) continue;
      const s = t.height ? t.height / v.H : 1;
      const lean = t.lean ? [Math.sin(((t.facing || 0) * Math.PI) / 180) * Math.tan((t.lean * Math.PI) / 180), -Math.cos(((t.facing || 0) * Math.PI) / 180) * Math.tan((t.lean * Math.PI) / 180)] : null;
      // the generators lean / face toward object +x: turn +x to the compass bearing `facing`
      const fb = ((t.facing || 0) * Math.PI) / 180;
      const yaw = t.facing !== undefined ? Math.atan2(Math.cos(fb), Math.sin(fb)) : hash01(i, 72) * TAU;
      this.put(kind, t.at[0], t.at[1], hash01(i, 71), { scale: s, lean, yaw, force: true, y: t.y });
    }
  }
  zoneSpecies(x, z) {
    for (const Z of L.PLANTS || []) {
      if (!Z.center || Z.species === 'lotus' || Z.species === 'willow+peach') continue;
      if (Math.hypot(x - Z.center[0], z - Z.center[1]) < (Z.radius || 50) * 1.8) return Z.species;
    }
    return null;
  }
  shotHeroes() {
    const has = new Set((L.HERO_TREES || []).flatMap((t) => [].concat(t.shot ?? [])));
    const lists = Object.entries(SHOT_HEROES).map(([id, list]) => [id, list, SHOTS.find((s) => String(s.id) === String(id)), false]);
    // the ink look: the ink cameras' own framing trees (src/ink/styles.js INK_HEROES), relative to the ink camera
    for (const c of planCams()) if (c.ink && c.heroes) lists.push([String(c.id), c.heroes, c, true]);
    for (const [id, list, S, ink] of lists) {
      // the layout's HERO_TREES for a shot replace both the photographic and the ink framing trees
      if (!S || has.has(Number(id))) continue;
      const dx = S.target[0] - S.pos[0], dz = S.target[2] - S.pos[2], l = Math.hypot(dx, dz);
      const fx = dx / l, fz = dz / l, rx = -fz, rz = fx;
      const head = Math.atan2(fx, -fz); // compass bearing of the view (rad)
      list.forEach((t, i) => {
        let x = t.at ? t.at[0] : S.pos[0] + fx * t.fwd + rx * t.right, z = t.at ? t.at[1] : S.pos[2] + fz * t.fwd + rz * t.right;
        // keep it on dry land: the nearest point of ground ≥ 0.5 m within 25 m (spiral search)
        if (heightAt(x, z) < 0.5) {
          let best = null;
          for (let r = 1; r <= 25 && !best; r += 1) for (let a = 0; a < 16; a++) {
            const qx = x + Math.cos((a / 16) * TAU) * r, qz = z + Math.sin((a / 16) * TAU) * r;
            if (heightAt(qx, qz) >= 0.5) { best = [qx, qz]; break; }
          }
          if (best) [x, z] = best;
        }
        const fb = head + ((t.facing || 0) * Math.PI) / 180;
        const yaw = Math.atan2(Math.cos(fb), Math.sin(fb));
        // the ink look: an ink camera with its own view rule keeps it clear (the hero is placed only where it leaves it)
        const inkRule = !ink && planCams().some((c) => c.ink && c.id === Number(id) && c.viewRule);
        this.put(t.kind, x, z, hash01(Number(id), i, ink ? 93 : 91), { yaw, scale: t.scale || 1, force: !inkRule });
        this.claim(x, z, 4);
      });
    }
  }
  heroKind(sp) {
    if (sp === 'pine') return 'pineM';
    if (sp === 'pineH' || sp === 'huangshan') return 'pineH';
    return KIND_OF[sp] || sp;
  }

  // ---------------------------------------------------------------- ink rows (the ink look): 一株杨柳一株桃 lining the path
  // ink02 lines the 苏堤 slab path with drooping willows and peach trees close to its edges, from the camera to the
  // arch; the causeway's own rows (causeways()) stand far out on its 30 m crown. Planted along the causeway centre
  // line (the path) within reach of an ink camera standing on it, both sides, alternating, leaning a little over the path
  inkRows() {
    // (the layout's own HERO_TREES for a shot, when the world plan has them, replace these rows)
    const has = new Set((L.HERO_TREES || []).flatMap((t) => [].concat(t.shot ?? [])));
    for (const c of planCams()) {
      const R = c.ink && !has.has(c.id) ? c.rows || INK_ROWS[c.id] : null;
      if (!R) continue;
      const C = R.causeway === 'bai' ? L.BAI_CAUSEWAY : L.SU_CAUSEWAY;
      const len = L.polyLength(C.points);
      // the camera's place along the line, and the way it looks
      let best = 0, bd = 1e9;
      for (let s = 0; s <= len; s += 1) { const p = L.polyPoint(C.points, s / len); const d = Math.hypot(p.x - c.pos[0], p.z - c.pos[2]); if (d < bd) { bd = d; best = s; } }
      const p0 = L.polyPoint(C.points, best / len);
      const dir = Math.sign((c.target[0] - c.pos[0]) * p0.tx + (c.target[2] - c.pos[2]) * p0.tz) || 1;
      const bridges = C.bridges.map((t) => t * len);
      let k = 0;
      for (let d = R.from ?? -6; d <= (R.to ?? 120); d += R.step ?? 6.5, k++) {
        const s = best + dir * d;
        if (s < 0 || s > len || bridges.some((b) => Math.abs(b - s) < (R.gap ?? 16))) continue;
        const p = L.polyPoint(C.points, s / len);
        for (const side of [-1, 1]) {
          const willow = (k + (side > 0 ? 1 : 0)) % 2 === 0;
          const h = hash01(k, side, 611);
          const off = side * (willow ? R.willow ?? 4.4 : R.peach ?? 3.1) + side * (h - 0.5) * 0.8;
          const along = (hash01(k, side, 612) - 0.5) * 1.6;
          const x = p.x - p.tz * off + p.tx * along, z = p.z + p.tx * off + p.tz * along;
          // lean toward the path (the trees of ink02 bow over it)
          const lk = willow ? 0.1 : 0.16;
          const lean = [p.tz * side * lk, -p.tx * side * lk];
          const kind = willow ? 'willow' : 'peach';
          const sc = (willow ? 0.72 + 0.22 * hash01(k, side, 613) : 0.6 + 0.3 * hash01(k, side, 614)) * (R.scale ?? 1);
          this.put(kind, x, z, hash01(k, side, 615), { scale: sc, lean, view: false, minY: 0.2, r: 1.6, fp: 0.8, yaw: Math.atan2(p.tx * side, p.tz * side) + (h - 0.5) * 0.6 });
        }
      }
    }
  }

  // ---------------------------------------------------------------- cliff pines (the ink look)
  // ink01 and ink06 hang pines on their cliffs: on the rock faces, ledges and rims in an ink camera's view (the
  // heightfield's steep ground, whatever shape it has: the 宝石山 tuff cliff, the palace mesa under its walled terraces),
  // a few to a cell, leaning out over the drop, bigger and denser near the rim. Rules in src/ink/styles.js
  // INK_CLIFF_PINES; the trees keep the camera's view rule (the hall and the terraces stay open)
  inkCliffPines() {
    for (const c of planCams()) {
      const R = c.ink ? INK_CLIFF_PINES?.[c.id] : null;
      if (!R) continue;
      const dx = c.target[0] - c.pos[0], dz = c.target[2] - c.pos[2], l = Math.hypot(dx, dz);
      const fx = dx / l, fz = dz / l;
      const tanH = Math.tan(((c.fov || 40) * Math.PI) / 360) * (1664 / 928);
      const cell = R.cell ?? 7;
      const [r0, r1] = R.range ?? [20, 300];
      let n = 0;
      for (let i = Math.floor((c.pos[0] - r1) / cell); i <= Math.ceil((c.pos[0] + r1) / cell); i++) for (let j = Math.floor((c.pos[2] - r1) / cell); j <= Math.ceil((c.pos[2] + r1) / cell); j++) {
        const x = (i + 0.15 + 0.7 * hash01(i, j, c.id, 701)) * cell, z = (j + 0.15 + 0.7 * hash01(i, j, c.id, 702)) * cell;
        const vx = x - c.pos[0], vz = z - c.pos[2], d = Math.hypot(vx, vz);
        if (d < r0 || d > r1) continue;
        const fwd = vx * fx + vz * fz;
        if (fwd < 1 || Math.abs(vx * fz - vz * fx) / fwd > tanH * (R.side ?? 1.1)) continue;
        if (R.box && (x < R.box[0] || x > R.box[2] || z < R.box[1] || z > R.box[3])) continue;
        const y = heightAt(x, z);
        if (y < (R.minY ?? 2)) continue;
        const sNear = slopeAt(x, z, 1.5), sWide = slopeAt(x, z, 6);
        // on the face (steep here) or on the rim (flat here, the drop within a few metres)
        const face = sNear > (R.slope ?? 0.45), rim = !face && sWide > (R.slope ?? 0.45) * 0.8 && sNear < 0.3;
        if (!face && !rim) continue;
        if (hash01(i, j, c.id, 703) > (rim ? R.rim ?? 0.7 : R.face ?? 0.45)) continue;
        // lean out over the drop (downhill)
        const nrm = normalAt(x, z, 4);
        const lk = (rim ? 0.25 : 0.4) * (0.6 + 0.8 * hash01(i, j, c.id, 704));
        const hl = Math.hypot(nrm[0], nrm[2]) || 1;
        const lean = [nrm[0] / hl * lk, nrm[2] / hl * lk];
        const kind = hash01(i, j, c.id, 705) < (R.huangshan ?? 0.6) ? 'pineH' : 'pineM';
        const sc = (R.scale ?? 0.7) * (0.75 + 0.5 * hash01(i, j, c.id, 706)) * (rim ? 1.1 : 0.85);
        if (this.put(kind, x, z, hash01(i, j, c.id, 707), { scale: sc, lean, r: 3, fp: 1.0, sink: face ? 0.8 : 0.3, yaw: Math.atan2(nrm[2], nrm[0]) })) n++;
        else (this.cliffMiss ||= {})[c.id] = ((this.cliffMiss || {})[c.id] || 0) + 1;
      }
      this.counts.cliffPines = (this.counts.cliffPines || 0) + n;
      console.log(`[vegetation] cliff pines for ink camera ${c.id}: ${n} placed, ${this.cliffMiss?.[c.id] || 0} refused (view, terraces, footprints)`);
    }
  }

  // ---------------------------------------------------------------- PLANTS zones (layout)
  zones() {
    const zones = [...(L.PLANTS || []).entries()].sort((a, b) => (a[1].species === 'pine' ? 0 : 1) - (b[1].species === 'pine' ? 0 : 1));
    for (const [zi, Z] of zones) {
      if (Z.species === 'lotus' || Z.species === 'willow+peach') continue; // lotus.js / causeway rows
      const kindFor = (h) => {
        if (Z.species === 'pine') return h < 0.6 ? 'pineM' : 'pineH';
        return KIND_OF[Z.species] || 'broad';
      };
      // bounding box + inside test
      let inside, x0, x1, z0, z1;
      if (Z.polygon) {
        x0 = Math.min(...Z.polygon.map((p) => p[0])); x1 = Math.max(...Z.polygon.map((p) => p[0]));
        z0 = Math.min(...Z.polygon.map((p) => p[1])); z1 = Math.max(...Z.polygon.map((p) => p[1]));
        inside = (x, z) => sdPolygon(x, z, Z.polygon) < 0;
      } else if (Z.center) {
        const r = Z.radius || 50;
        x0 = Z.center[0] - r; x1 = Z.center[0] + r; z0 = Z.center[1] - r; z1 = Z.center[1] + r;
        inside = (x, z) => Math.hypot(x - Z.center[0], z - Z.center[1]) < r * (0.85 + 0.15 * hash01(Math.round(x), Math.round(z), 5));
      } else continue;
      const dens = (Z.density || 1) / 100; // per m²
      const cell = Math.max(2.5, Math.sqrt(1 / dens));
      for (let i = Math.floor(x0 / cell); i <= Math.ceil(x1 / cell); i++) for (let j = Math.floor(z0 / cell); j <= Math.ceil(z1 / cell); j++) {
        const x = (i + 0.1 + 0.8 * hash01(i, j, zi, 11)) * cell, z = (j + 0.1 + 0.8 * hash01(i, j, zi, 12)) * cell;
        if (!inside(x, z)) continue;
        const h = hash01(i, j, zi, 13);
        const kind = kindFor(h);
        if (slopeAt(x, z, 2) > 0.75) continue;
        this.put(kind, x, z, hash01(i, j, zi, 14), { scale: 0.8 + 0.45 * hash01(i, j, zi, 15) });
      }
    }
  }

  // ---------------------------------------------------------------- causeways: 一株杨柳一株桃
  causeways() {
    for (const [ci, C] of [[0, L.SU_CAUSEWAY], [1, L.BAI_CAUSEWAY]]) {
      const len = L.polyLength(C.points);
      const bridgesAt = C.bridges.map((t) => t * len);
      const step = 6.5;
      const n = Math.floor(len / step);
      for (let k = 0; k < n; k++) {
        const s = (k + 0.5) * step;
        if (bridgesAt.some((b) => Math.abs(b - s) < 26)) continue;
        const p = L.polyPoint(C.points, s / len);
        for (const side of [-1, 1]) {
          // two staggered rows each side: willows on the outer (water) row leaning out, peach on the inner row
          for (const row of [0, 1]) {
            if ((k + row) % 2) continue;
            const h = hash01(k, side, row, ci, 21);
            const off = side * (row ? C.width / 2 - 3.2 + 1.2 * h : C.width / 2 - 8.5 + 1.5 * h);
            const along = (hash01(k, side, row, ci, 22) - 0.5) * 2.4;
            const x = p.x - p.tz * off + p.tx * along, z = p.z + p.tx * off + p.tz * along;
            const outN = [-p.tz * side, p.tx * side];
            const willow = row === 1 ? hash01(k, side, ci, 23) < 0.82 : hash01(k, side, ci, 24) < 0.25;
            if (willow) {
              const yaw = Math.atan2(-outN[1], outN[0]) + (hash01(k, side, ci, 25) - 0.5) * 0.8;
              this.put('willow', x, z, hash01(k, side, row, ci, 26), { yaw, scale: 0.85 + 0.35 * hash01(k, side, ci, 27), minY: 0.2, r: 3.5 });
            } else {
              this.put('peach', x, z, hash01(k, side, row, ci, 28), { scale: 0.8 + 0.4 * hash01(k, side, ci, 29), minY: 0.2, r: 2.5 });
            }
          }
        }
      }
    }
  }

  // ---------------------------------------------------------------- islands: 孤山 woods, 小瀛洲 / 湖心亭 willows
  islands() {
    // 小瀛洲 ring: willows on the water edge of the ring, a few peach and camphor inside
    const X = L.XIAOYINGZHOU;
    const n = Math.floor((TAU * X.radius) / 7);
    for (let k = 0; k < n; k++) {
      const a = (k / n) * TAU;
      for (const edge of [-1, 1]) {
        const h = hash01(k, edge, 31);
        const rr = X.radius + edge * (X.ring * 0.5 - 4 - 3 * h);
        const x = X.center[0] + Math.cos(a) * rr, z = X.center[1] + Math.sin(a) * rr;
        const out = [Math.cos(a) * edge, Math.sin(a) * edge];
        const kind = h < 0.7 ? 'willow' : h < 0.85 ? 'peach' : 'camphor';
        this.put(kind, x, z, hash01(k, edge, 32), { yaw: kind === 'willow' ? Math.atan2(-out[1], out[0]) : undefined, scale: 0.85 + 0.35 * hash01(k, edge, 33), minY: 0.2 });
      }
    }
    const H = L.HUXINTING;
    for (let k = 0; k < 9; k++) {
      const a = (k / 9) * TAU, rr = H.radius - 6;
      this.put(k % 3 ? 'willow' : 'camphor', H.center[0] + Math.cos(a) * rr, H.center[1] + Math.sin(a) * rr, hash01(k, 41), { yaw: Math.atan2(-Math.sin(a), Math.cos(a)), minY: 0.2 });
    }
    // 孤山: dense mixed wood (camphor, pine, broadleaf), willows along its shore
    const G = L.GUSHAN, ga = ((G.rot || 0) * Math.PI) / 180;
    const cell = 7;
    for (let i = -70; i <= 70; i++) for (let j = -25; j <= 25; j++) {
      const lx = (i + hash01(i, j, 51)) * cell, lz = (j + hash01(i, j, 52)) * cell;
      if ((lx / G.radii[0]) ** 2 + (lz / G.radii[1]) ** 2 > 1.05) continue;
      const x = G.center[0] + lx * Math.cos(ga) - lz * Math.sin(ga), z = G.center[1] + lx * Math.sin(ga) + lz * Math.cos(ga);
      const y = heightAt(x, z);
      const sd = lakeSDF(x, z);
      const h = hash01(i, j, 53);
      if (y < 0.5) continue;
      let kind = y > 12 ? (h < 0.35 ? 'pineM' : h < 0.75 ? 'camphor' : 'broad') : (h < 0.5 ? 'camphor' : h < 0.8 ? 'broad' : 'peach');
      if (y < 4 && hash01(i, j, 54) < 0.5) kind = 'willow';
      if (hash01(i, j, 55) > 0.8) continue;
      this.put(kind, x, z, hash01(i, j, 56), { scale: 0.85 + 0.4 * hash01(i, j, 57) });
    }
  }

  // ---------------------------------------------------------------- shores: willows (and some peach) all round the lake
  shores() {
    const pts = L.LAKE.outline;
    let acc = 0;
    const cb = L.CITY.bounds;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      const seg = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const tx = (b[0] - a[0]) / seg, tz = (b[1] - a[1]) / seg;
      for (let s = 0; s < seg; s += 9) {
        const k = Math.round(acc + s);
        const h = hash01(k, 61);
        // the outline is clockwise: inland is to the left of the direction of travel? test with lakeSDF
        let nx = -tz, nz = tx;
        const px = a[0] + tx * s, pz = a[1] + tz * s;
        if (lakeSDF(px + nx * 10, pz + nz * 10) < lakeSDF(px, pz)) { nx = -nx; nz = -nz; }
        // walk inland until on dry ground a few metres from the water
        let x = px, z = pz, ok = false;
        for (let d = 2; d < 26; d += 2) { x = px + nx * d; z = pz + nz * d; if (lakeSDF(x, z) > 3 + 6 * h && heightAt(x, z) > 0.45) { ok = true; break; } }
        if (!ok) continue;
        // the city shore under the west wall stays open (gates, quays); a few willows only
        if (x > cb[0] - 150 && hash01(k, 62) < 0.6) continue;
        const kind = h < 0.78 ? 'willow' : h < 0.92 ? 'peach' : 'camphor';
        this.put(kind, x, z, hash01(k, 63), { yaw: kind === 'willow' ? Math.atan2(nz, -nx) + (hash01(k, 64) - 0.5) * 0.7 : undefined, scale: 0.85 + 0.4 * hash01(k, 65), minY: 0.3, r: 3 });
      }
      acc += seg;
    }
  }

  // ---------------------------------------------------------------- city trees (sparse crowns among the roofs, ref07)
  city() {
    const s7 = SHOTS.find((s) => s.id === 7);
    if (!s7) return;
    const cell = 26, R = 1800;
    const yj = L.CITY.yujie, canals = L.CITY.canals || [];
    // courtyard and garden trees from the city plan (registry.city.treeSpots): the green crowns among the roofs of ref07
    const spots = this.engine.registry.city?.treeSpots || [];
    spots.forEach((p, k) => {
      const d = Math.hypot(p.x - s7.pos[0], p.z - s7.pos[2]);
      if (d > 2600) return;
      const h = hash01(k, 91, 7);
      if (h > (p.garden ? 0.95 : 0.7)) return;
      const n = p.garden && p.r > 8 ? 2 : 1;
      for (let t = 0; t < n; t++) {
        const a = hash01(k, t, 92) * TAU, rr = n > 1 ? p.r * 0.45 : 0;
        const kind = h < 0.35 ? 'camphor' : h < 0.6 ? 'broad' : h < 0.75 ? 'willow' : 'ginkgo';
        this.put(kind, p.x + Math.cos(a) * rr, p.z + Math.sin(a) * rr, hash01(k, t, 93), { scale: Math.min(1.1, 0.55 + p.r / 18) * (0.85 + 0.3 * hash01(k, t, 94)), r: 3, fp: 1.2 });
      }
    });
    for (let i = Math.floor((s7.pos[0] - R) / cell); i <= Math.ceil((s7.pos[0] + R) / cell); i++) for (let j = Math.floor((s7.pos[2] - 400) / cell); j <= Math.ceil((s7.pos[2] + 2 * R) / cell); j++) {
      const h = hash01(i, j, 81);
      if (h > 0.16) continue;
      const x = (i + hash01(i, j, 82)) * cell, z = (j + hash01(i, j, 83)) * cell;
      const cb = L.CITY.bounds;
      if (x < cb[0] || x > cb[2] || z < cb[1] || z > cb[3]) continue;
      if (Math.abs(x - yj.points[0][0]) < yj.width) continue;
      if (canals.some((c) => c.points.some((p, k) => k && distSeg(x, z, c.points[k - 1], p) < c.width))) continue;
      this.put(h < 0.07 ? 'camphor' : h < 0.12 ? 'broad' : 'ginkgo', x, z, hash01(i, j, 84), { scale: 0.8 + 0.4 * hash01(i, j, 85), r: 6 });
    }
  }

  // ---------------------------------------------------------------- hill-forest cover in every shot's view cone
  /** pre: the candidates (coverPlan) and their ground (coverGround) computed ahead (the explorable world asks the
   *  height workers for the ground while the buildings build: src/modules/vegetation.js prefetch) */
  cover(pre = null) {
    const cb = L.CITY.bounds;
    const C = pre?.plan || coverPlan(this.q.density ?? 1);
    const G = pre?.ground || coverGround(C.x, C.z);
    for (let k = 0; k < C.n; k++) {
      const x = C.x[k], z = C.z[k], d = C.d[k], i = C.i[k], j = C.j[k], bi = C.bi[k], cell = BANDS[bi][2];
      const y = G.y[k];
      if (y < 2.0) continue;
      if (x > cb[0] && x < cb[2] && z > cb[1] && z < cb[3] && y < L.CITY.ground + 9) continue; // the city (city() handles it); its hills (吴山) keep their wood
      if (G.lake[k] < 8) continue;
      const sl = G.slope[k];
      // the steep wooded hill behind 灵隐 (ref08) keeps its trees
      if (sl > (Math.hypot(x + 3700, z - 345) < 260 ? 1.1 : 0.6)) continue;
      // only on wooded ground: hills, or the plain away from the shores and fields
      const hillish = y > 9 || sl > 0.06;
      if (!hillish && hash01(i, j, bi, 4) > 0.25) continue;
      const h = hash01(i, j, bi, 5);
      let kind;
      if (y > 70 || sl > 0.3) kind = h < 0.55 ? 'pineM' : h < 0.75 ? 'pineH' : 'camphor';
      else if (y > 30) kind = h < 0.25 ? 'pineM' : h < 0.6 ? 'camphor' : 'broad';
      else kind = h < 0.12 ? 'pineM' : h < 0.55 ? 'camphor' : 'broad';
      // inside (or near) a PLANTS tree zone the cover takes the zone's species (e.g. the 宝石山 pines of shot 1)
      const zs = this.zoneSpecies(x, z);
      if (zs) kind = zs === 'pine' ? (h < 0.7 ? 'pineM' : 'pineH') : (KIND_OF[zs] || kind);
      // 灵隐 valley: maples and ginkgo among the broadleaf (autumn colour, ref08)
      if (L.LINGYIN && Math.hypot(x - L.LINGYIN.temple[0], z - L.LINGYIN.temple[1]) < 500) {
        const m = hash01(i, j, bi, 6);
        if (m < 0.18) kind = 'maple'; else if (m < 0.3) kind = 'ginkgo';
      }
      const sc = (0.85 + 0.45 * hash01(i, j, bi, 7)) * (bi === 2 ? 1.2 : bi === 1 ? 1.08 : 1);
      if (!this.put(kind, x, z, hash01(i, j, bi, 8), { scale: sc, r: cell * 0.3 }) && d < 200 && this.lib.shrub?.length) {
        const lim = this.viewLimit(x, z, y, 1);
        if (lim > 1.1 && lim < 8) this.put('shrub', x, z, hash01(i, j, bi, 9), { scale: Math.min(1.6, lim / 1.4) * (0.75 + 0.25 * hash01(i, j, bi, 10)), r: 1.2 });
      }
    }
  }
}

// the cover's distance bands round each camera: [from, to, cell] m
const BANDS = [[0, 450, 7.5], [450, 1300, 10.5], [1300, 3600, 14]];

/**
 * the hill-forest cover's candidates, in the order the placement visits them (every plan camera's view cone, three
 * bands, each grid cell once), with the tests that need no ground applied: { n, x, z, d, i, j, bi } (typed arrays;
 * d = the distance from the camera that claimed the cell)
 */
export function coverPlan(qd = 1) {
  const done = new Set();
  let n = 0, cap = 1 << 16;
  let x = new Float64Array(cap), z = new Float64Array(cap), d = new Float64Array(cap), I = new Int32Array(cap), J = new Int32Array(cap), B = new Int32Array(cap);
  const grow = () => {
    cap *= 2;
    const g = (a, C) => { const b = new C(cap); b.set(a); return b; };
    x = g(x, Float64Array); z = g(z, Float64Array); d = g(d, Float64Array); I = g(I, Int32Array); J = g(J, Int32Array); B = g(B, Int32Array);
  };
  for (const S of planCams()) {
    const dx = S.target[0] - S.pos[0], dz = S.target[2] - S.pos[2], l = Math.hypot(dx, dz);
    const fx = dx / l, fz = dz / l;
    const aspect = 1664 / 928;
    const tanV = Math.tan(((S.fov || 40) * Math.PI) / 360), tanH = tanV * aspect;
    const half = Math.atan(tanH) + 0.15;
    for (const [bi, [r0, r1, cell]] of BANDS.entries()) {
      const i0 = Math.floor((S.pos[0] - r1) / cell), i1 = Math.ceil((S.pos[0] + r1) / cell);
      const j0 = Math.floor((S.pos[2] - r1) / cell), j1 = Math.ceil((S.pos[2] + r1) / cell);
      for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
        const key = bi * 1e8 + i * 1e4 + j;
        if (done.has(key)) continue;
        const cx = (i + 0.15 + 0.7 * hash01(i, j, bi, 1)) * cell, cz = (j + 0.15 + 0.7 * hash01(i, j, bi, 2)) * cell;
        const vx = cx - S.pos[0], vz = cz - S.pos[2], dd = Math.hypot(vx, vz);
        if (dd < r0 || dd > r1 || dd < 25) continue;
        const cosA = (vx * fx + vz * fz) / dd;
        if (cosA < Math.cos(half) && dd > 40) continue;
        done.add(key);
        // thinning toward the far edge of the last band (the terrain canopy shader takes over)
        let keep = bi === 2 ? 0.9 * (1 - ((dd - r0) / (r1 - r0)) ** 2 * 0.6) : 0.88;
        keep *= qd ** 0.35;
        if (hash01(i, j, bi, 3) > keep) continue;
        if (n === cap) grow();
        x[n] = cx; z[n] = cz; d[n] = dd; I[n] = i; J[n] = j; B[n] = bi; n++;
      }
    }
  }
  return { n, x: x.subarray(0, n), z: z.subarray(0, n), d: d.subarray(0, n), i: I.subarray(0, n), j: J.subarray(0, n), bi: B.subarray(0, n) };
}

/** the ground at the cover's candidates: { y, lake, slope } (Float64Array each; pure: the height workers can do it) */
export function coverGround(x, z) {
  const n = x.length, y = new Float64Array(n), lake = new Float64Array(n), slope = new Float64Array(n);
  for (let k = 0; k < n; k++) { y[k] = heightAt(x[k], z[k]); lake[k] = lakeSDF(x[k], z[k]); slope[k] = slopeAt(x[k], z[k], 3); }
  return { y, lake, slope };
}

function distSeg(x, z, a, b) {
  const ex = b[0] - a[0], ez = b[1] - a[1];
  const t = Math.max(0, Math.min(1, ((x - a[0]) * ex + (z - a[1]) * ez) / (ex * ex + ez * ez)));
  return Math.hypot(x - a[0] - ex * t, z - a[1] - ez * t);
}

export async function placeWorld(engine, sys, lib, { coverPre = null } = {}) {
  const t0 = performance.now();
  const P = new Placer(engine, sys, lib);
  const timing = {};
  const step = (name, fn) => { const t = performance.now(); fn(); timing[name] = Math.round(performance.now() - t); };
  step('heroes', () => { P.heroes(); P.shotHeroes(); P.inkRows(); P.inkCliffPines(); });
  step('zones', () => P.zones());
  step('causeways', () => P.causeways());
  step('islands', () => P.islands());
  step('shores', () => P.shores());
  step('city', () => P.city());
  const pre = coverPre ? await coverPre : null;
  step('cover', () => P.cover(pre));
  console.log(`[vegetation] placement ${Math.round(performance.now() - t0)} ms ${JSON.stringify(timing)}`);
  return { counts: P.counts, placer: P };
}
