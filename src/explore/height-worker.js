// Worker for the explorable world (src/explore/heightpool.js): terrain patches and height grids from the analytic
// heightfield, off the main thread; also the vertex welding of built meshes (src/core/weld.js).
// Pure: no three.js, so no import map is needed.
import { heightAt, lakeSDF, slopeAt } from '../world/heightfield.js';
import { meshLeaf } from '../terrain/mesh.js';
import { coverCandidates } from './cover.js';
import { farmPlan, farmCovers } from './farm.js';
import { weld } from '../core/weld.js';
import { readBake } from '../core/bakeread.js';

self.onmessage = async (ev) => {
  const { id, op } = ev.data;
  try {
    if (op === 'bake') {
      // a compact bake (src/core/bakefmt.js): fetched, un-gzipped and decoded here
      const r = await readBake(ev.data.url);
      self.postMessage({ id, ...r }, [r.position.buffer, ...(r.normal ? [r.normal.buffer] : []), ...r.extra.map((x) => x.array.buffer), r.index.buffer]);
      return;
    }
    if (op === 'leaf') {
      const { x0, z0, size, N } = ev.data;
      const m = meshLeaf({ x0, z0, size }, N);
      // a patch has (N + 1)² + 4N vertices: 16-bit indices up to N = 250 (the same triangles, half the bytes)
      const index = m.position.length / 3 < 65536 ? Uint16Array.from(m.index) : m.index;
      self.postMessage({ id, position: m.position, normal: m.normal, index }, [m.position.buffer, m.normal.buffer, index.buffer]);
    } else if (op === 'grid') {
      // rows j0..j1-1 of a W-wide grid: cell centres x0 + (i + 0.5) dx, z0 + (j + 0.5) dz
      const { x0, z0, dx, dz, W, j0, j1 } = ev.data;
      const out = new Float32Array(W * (j1 - j0));
      for (let j = j0; j < j1; j++) {
        const z = z0 + (j + 0.5) * dz, o = (j - j0) * W;
        for (let i = 0; i < W; i++) out[o + i] = heightAt(x0 + (i + 0.5) * dx, z);
      }
      self.postMessage({ id, data: out }, [out.buffer]);
    } else if (op === 'farm') {
      const r = farmPlan(ev.data);
      self.postMessage({ id, ...r }, [r.plots.buffer, r.rims.buffer, r.channels.buffer, r.trees.buffer, r.tea.buffer, r.drape.buffer]);
    } else if (op === 'farmCovers') {
      const out = farmCovers(ev.data);
      self.postMessage({ id, data: out }, [out.buffer]);
    } else if (op === 'ground') {
      // the vegetation cover's candidates (src/vegetation/placement.js coverGround): height, lake distance, slope
      const { x, z } = ev.data, n = x.length, y = new Float64Array(n), lake = new Float64Array(n), slope = new Float64Array(n);
      for (let k = 0; k < n; k++) { y[k] = heightAt(x[k], z[k]); lake[k] = lakeSDF(x[k], z[k]); slope[k] = slopeAt(x[k], z[k], 3); }
      self.postMessage({ id, y, lake, slope }, [y.buffer, lake.buffer, slope.buffer]);
    } else if (op === 'weld') {
      const { n, arrays, sizes } = ev.data;
      const r = weld(n, arrays.map((a, i) => [a, sizes[i]]));
      self.postMessage({ id, m: r.m, arrays: r.arrays, index: r.index }, [...r.arrays.map((a) => a.buffer), r.index.buffer]);
    } else if (op === 'cover') {
      const out = coverCandidates(ev.data);
      self.postMessage({ id, data: out }, [out.buffer]);
    }
  } catch (e) {
    self.postMessage({ id, error: String(e && (e.stack || e.message) || e) });
  }
};
