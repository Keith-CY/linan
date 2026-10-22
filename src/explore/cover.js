// Tree cover for the explorable world: the shots' cover (src/vegetation/placement.js cover()) only fills each shot's
// view cone, so hills no shot looked at stood bare. This fills the rest of the hills (and groves on the plain) on a
// world lattice, with the same rules as the shots' cover. Pure (no three.js): runs in the height workers. The farmland
// (src/explore/farm.js: paddies, terraces, tea, mulberry) stays clear of it.
//
// coverCandidates({ x0, z0, x1, z1, cell, cx, cz, R }) → Float32Array of records [x, z, y, slope, i, j] (REC floats)
import { hash01 } from '../core/rng.js';
import { heightAt, slopeAt, lakeSDF } from '../world/heightfield.js';
import { GROVE, farmZone } from './farm.js';

export const REC = 6;

export function coverCandidates({ x0, z0, x1, z1, cell, cx = 0, cz = 0, R = 1e9 }) {
  const out = [];
  const i0 = Math.ceil(x0 / cell), i1 = Math.floor(x1 / cell), j0 = Math.ceil(z0 / cell), j1 = Math.ceil(z1 / cell);   // slabs split by cell index
  for (let j = j0; j < j1; j++) for (let i = i0; i <= i1; i++) {
    const x = (i + 0.15 + 0.7 * hash01(i, j, 9, 1)) * cell, z = (j + 0.15 + 0.7 * hash01(i, j, 9, 2)) * cell;
    if (Math.hypot(x - cx, z - cz) > R) continue;
    if (hash01(i, j, 9, 3) > 0.8) continue;
    const y = heightAt(x, z);
    if (y < 2.0) continue;
    // (inside the city bounds the footprints of houses, streets and canals keep trees off; the empty ground gets groves)
    if (lakeSDF(x, z) < 8) continue;
    const sl = slopeAt(x, z, 3);
    if (sl > (Math.hypot(x + 3700, z - 345) < 260 ? 1.1 : 0.6)) continue;
    const hillish = y > 9 || sl > 0.06;
    // groves on the plain (clumps ~150-400 m across), fields and open ground between them
    if (!hillish) {
      const g = GROVE.fbm2(x / 420, z / 420, 3) + (hash01(i, j, 9, 4) - 0.5) * 0.25;
      if (g < 0.28) continue;
    }
    if (farmZone(x, z, y)) continue;
    out.push(x, z, y, sl, i, j);
  }
  return Float32Array.from(out);
}
