// Villages for the explorable world: the shots never looked at the plain north of the city, the strip between the
// lake and the west wall or the river flats, which stood empty. Hamlets along a lane, on dry, flat ground away from the
// lake, the city and the buildings, set among the fields (src/explore/farm.js keeps the plots off them):
//   houses     the city's dwelling kit (src/city/houses.js VARIANTS 8-13), and in the bigger hamlets one hall-sized
//              house (a landlord's or the clan's hall, VARIANTS 14-17)
//   cottages   about a third of the dwellings thatched (茅屋: low earth walls, a deep thatch roof), drawn by
//              src/explore/hamlets.js
//   a threshing floor (晒谷场) beside the lane with straw stacks, and a small earth-god shrine (土地庙) at one end
// Pure and deterministic: planVillages(engine, cityHouses) → the kit houses [{ x, z, y, rot, w, d, kind, village }];
// the rest goes to engine.registry.hamlets = [{ x, z, y, r, ux, uz, cottages, floor, stacks, shrine }].
import { hash01 } from '../core/rng.js';
import { heightAt, lakeSDF } from '../world/heightfield.js';

const CELL = 380;
const REGION = { x0: -6500, x1: 5200, z0: -6000, z1: 7400, cx: -600, cz: 1200, R: 7000 };

export function planVillages(engine, cityHouses = []) {
  const t0 = performance.now();
  // existing houses on a coarse grid (keep hamlets out of the city and its suburbs)
  const G = 200, occ = new Set();
  for (const h of cityHouses) occ.add(Math.floor(h.x / G) * 100003 + Math.floor(h.z / G));
  const nearCity = (x, z) => { const i = Math.floor(x / G), j = Math.floor(z / G); for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) if (occ.has((i + a) * 100003 + j + b)) return true; return false; };
  const fp = engine.footprints;
  const out = [];
  const hamlets = [];
  let villages = 0, nCottages = 0;
  // ground under a w × d rectangle turned by rot round (x, z): [min, max] of its corners
  const span = (x, z, w, d, rot) => {
    const c = [[w / 2, d / 2], [-w / 2, d / 2], [w / 2, -d / 2], [-w / 2, -d / 2]].map(([px, pz]) => heightAt(x + px * Math.cos(rot) + pz * Math.sin(rot), z - px * Math.sin(rot) + pz * Math.cos(rot)));
    return [Math.min(...c), Math.max(...c)];
  };
  for (let j = Math.floor(REGION.z0 / CELL); j <= Math.ceil(REGION.z1 / CELL); j++) for (let i = Math.floor(REGION.x0 / CELL); i <= Math.ceil(REGION.x1 / CELL); i++) {
    if (hash01(i, j, 601) > 0.5) continue;
    const cx = (i + 0.2 + 0.6 * hash01(i, j, 602)) * CELL, cz = (j + 0.2 + 0.6 * hash01(i, j, 603)) * CELL;
    if (Math.hypot(cx - REGION.cx, cz - REGION.cz) > REGION.R) continue;
    const y0 = heightAt(cx, cz);
    if (y0 < 1.4 || y0 > 28) continue;
    if (lakeSDF(cx, cz) < 70) continue;
    if (nearCity(cx, cz)) continue;
    // flat enough over the hamlet (±40 m)
    let lo = y0, hi = y0;
    for (const [dx, dz] of [[40, 0], [-40, 0], [0, 40], [0, -40], [28, 28], [-28, -28], [28, -28], [-28, 28]]) { const y = heightAt(cx + dx, cz + dz); lo = Math.min(lo, y); hi = Math.max(hi, y); }
    if (hi - lo > 4 || lo < 1.0) continue;
    if (fp && !fp.isFree(cx, cz, 45)) continue;
    // a lane through the hamlet, houses facing it on both sides
    const a = hash01(i, j, 604) * Math.PI, ux = Math.cos(a), uz = Math.sin(a);
    const n = 4 + Math.floor(hash01(i, j, 605) * 9);
    const placed = [], cottages = [];
    const hallAt = n >= 6 ? Math.floor(hash01(i, j, 606) * n) : -1;   // one hall-sized house in the bigger hamlets
    const hallSide = hash01(i, j, 607) < 0.5 ? -1 : 1;
    const gaps = [];                                                      // open plots along the lane: [s, side, width]
    const near = (list, x, z, w, d) => list.some((p) => Math.hypot(p.x - x, p.z - z) < (Math.max(w, d) + Math.max(p.w, p.d)) / 2);
    const clash = (x, z, w, d) => near(placed, x, z, w, d) || near(cottages, x, z, w, d);
    let sMin = 0, sMax = 0;
    for (const side of [-1, 1]) {
      let s = -n * 5;
      for (let k = 0; k < n; k++) {
        const hall = k === hallAt && side === hallSide;
        // dwellings 7–12.5 m wide; the hall 15–18 m; a thatched cottage 6–9 m
        const thatch = !hall && hash01(i, j, k, side + 21) < 0.34;
        const w = hall ? 15 + 3 * hash01(i, j, k, side + 7) : thatch ? 6 + 3 * hash01(i, j, k, side + 7) : 7 + 5.5 * hash01(i, j, k, side + 7);
        const d = hall ? 12.5 + 2 * hash01(i, j, k, side + 9) : thatch ? 5 + 2 * hash01(i, j, k, side + 9) : 10 + 2.5 * hash01(i, j, k, side + 9);
        s += w / 2 + 1.5 + 6 * hash01(i, j, k, side + 11);
        if (!hall && hash01(i, j, k, side + 13) < 0.22) { gaps.push([s, side, w]); s += w / 2; continue; }   // gaps: gardens, threshing floors
        const off = side * (4.5 + d / 2 + 1.5 * hash01(i, j, k, side + 15));
        const x = cx + ux * s - uz * off, z = cz + uz * s + ux * off;
        s += w / 2;
        // the house faces the lane (its local +Z toward the lane)
        const rot = Math.atan2(-side * -uz, -side * ux);
        const [cmin, cmax] = span(x, z, w, d, rot);
        if (cmin < 0.9 || cmax - cmin > 1.6) continue;
        if (fp && !fp.isFree(x, z, Math.max(w, d) / 2 + 1)) continue;
        if (clash(x, z, w, d)) continue;
        sMin = Math.min(sMin, s - w); sMax = Math.max(sMax, s);
        if (thatch) { cottages.push({ x, z, y: cmin - 0.04, rot, w, d, top: cmax }); continue; }
        placed.push({ x, z, y: cmin - 0.04, rot, w, d, kind: hall ? 'hall' : 'house', village: villages });
      }
    }
    if (placed.length + cottages.length < 3) continue;
    // the threshing floor: in the widest gap beside the lane (or past its end), packed earth 12–16 × 9–12 m
    const fw = 12 + 4 * hash01(i, j, 611), fd = 9 + 3 * hash01(i, j, 612);
    const g = gaps.sort((p, q) => q[2] - p[2])[0];
    const fs = g ? g[0] : sMax + fw / 2 + 4, fside = g ? g[1] : (hash01(i, j, 613) < 0.5 ? -1 : 1);
    const foff = fside * (4.5 + fd / 2 + 1);
    const fx = cx + ux * fs - uz * foff, fz = cz + uz * fs + ux * foff, frot = Math.atan2(uz, ux);
    let floor = null;
    const stacks = [];
    {
      const [fmin, fmax] = span(fx, fz, fw, fd, -frot);
      if (fmax - fmin < 1.2 && fmin > 0.9 && !clash(fx, fz, fw * 0.8, fd * 0.8) && (!fp || fp.isFree(fx, fz, Math.max(fw, fd) / 2))) {
        floor = { x: fx, z: fz, y: fmax + 0.06, yMin: fmin, rot: frot, w: fw, d: fd };
        // straw stacks past the floor's far edge (round, conical tops), 2–4
        const ns = 2 + Math.floor(3 * hash01(i, j, 614));
        for (let k = 0; k < ns; k++) {
          const t = (k + 0.5) / ns - 0.5, r = 1.3 + 0.6 * hash01(i, j, k, 615);
          const sx = fx + ux * t * fw * 0.8 - uz * fside * (fd / 2 + r + 0.8), sz = fz + uz * t * fw * 0.8 + ux * fside * (fd / 2 + r + 0.8);
          if (clash(sx, sz, r * 2, r * 2)) continue;
          stacks.push({ x: sx, z: sz, y: heightAt(sx, sz) - 0.1, r, h: 2.6 + 1.2 * hash01(i, j, k, 616) });
        }
      }
    }
    // the earth-god shrine: past one end of the lane, facing back along it into the hamlet
    const end = hash01(i, j, 617) < 0.5 ? -1 : 1;
    const ss = end > 0 ? sMax + 6 : sMin - 6, soff = (hash01(i, j, 618) < 0.5 ? -1 : 1) * 5.5;
    const shx = cx + ux * ss - uz * soff, shz = cz + uz * ss + ux * soff;
    let shrine = null;
    if (!clash(shx, shz, 3, 3) && (!fp || fp.isFree(shx, shz, 2))) shrine = { x: shx, z: shz, y: span(shx, shz, 2.2, 2, 0)[0] - 0.05, rot: Math.atan2(-end * ux, -end * uz) };
    // footprints: the cottages and the shrine block the walker and the trees; the stacks too
    for (const c of cottages) fp?.addRect?.(c.x, c.z, c.w / 2 + 0.3, c.d / 2 + 0.3, c.rot, 'house');
    if (shrine) fp?.addCircle?.(shrine.x, shrine.z, 1.6, 'house');
    for (const st of stacks) fp?.addCircle?.(st.x, st.z, st.r, 'rock');
    const half = Math.max(Math.abs(sMin), Math.abs(sMax)) + 22;
    hamlets.push({ x: cx, z: cz, y: y0, r: half, ux, uz, cottages, floor, stacks, shrine, village: villages });
    out.push(...placed);
    nCottages += cottages.length;
    villages++;
  }
  (engine.registry.hamlets ||= []).push(...hamlets);
  console.log(`[explore] villages: ${villages} hamlets, ${out.length} kit houses, ${nCottages} thatched cottages, ${hamlets.filter((h) => h.floor).length} threshing floors, ${hamlets.filter((h) => h.shrine).length} shrines, ${Math.round(performance.now() - t0)} ms`);
  return out;
}
