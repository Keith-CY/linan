// Worker for the explorable world (src/explore/heightpool.js): terrain patches and height grids from the analytic
// heightfield, off the main thread. Pure: imports only the heightfield (no three.js, no import map needed).
import { heightAt } from '../world/heightfield.js';
import { meshLeaf } from '../terrain/mesh.js';
import { coverCandidates } from './cover.js';
import { farmPlan, farmCovers } from './farm.js';

self.onmessage = (ev) => {
  const { id, op } = ev.data;
  try {
    if (op === 'leaf') {
      const { x0, z0, size, N } = ev.data;
      const m = meshLeaf({ x0, z0, size }, N);
      self.postMessage({ id, position: m.position, normal: m.normal, index: m.index }, [m.position.buffer, m.normal.buffer, m.index.buffer]);
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
    } else if (op === 'cover') {
      const out = coverCandidates(ev.data);
      self.postMessage({ id, data: out }, [out.buffer]);
    }
  } catch (e) {
    self.postMessage({ id, error: String(e && (e.stack || e.message) || e) });
  }
};
