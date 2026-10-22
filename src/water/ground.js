// Height sampler over captured terrain maps (src/water/heightmap.js), falling back to the analytic
// heightAt() outside them. Extracted from Athenaion's water/trace.js (makeGround).
import { heightAt } from '../world/heightfield.js';

/** Height sampler: the captured (meshed) terrain where a map covers the point, analytic heightAt elsewhere. */
export function makeGround(maps = [], { analytic = false } = {}) {
  const H = (x, z) => {
    for (const m of maps) {
      if (!m) continue;
      const v = m.sample(x, z);
      if (v !== null) return analytic ? Math.max(v, heightAt(x, z)) : v;
    }
    return heightAt(x, z);
  };
  const N = (x, z, e = 0.8) => {
    const hx = H(x + e, z) - H(x - e, z), hz = H(x, z + e) - H(x, z - e);
    const nx = -hx, ny = 2 * e, nz = -hz, l = Math.hypot(nx, ny, nz);
    return [nx / l, ny / l, nz / l];
  };
  return { H, N };
}
