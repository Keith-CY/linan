// A small pool of module workers (src/explore/height-worker.js) for the explorable world: terrain patches meshed
// off the main thread while the visitor walks, and height grids (the water's depth maps) at load.
//   const pool = getHeightPool();
//   const m = await pool.leaf({ x0, z0, size }, 32[, low])   → { position, normal, index } (typed arrays; low: after the rest)
//   const h = await pool.grid([x0, z0, x1, z1], W, H)        → Float32Array W*H (row j ↔ z = z0 + (j + .5) dz)
//   const f = await pool.farm([x0, z0, x1, z1], opts)         → the countryside's plots (src/explore/farm.js farmPlan), in
//                                                               slabs at low priority (terrain patches go first)
//   const c = await pool.farmCovers(plan, pts)                → Uint8Array: which of the points [x, z, …] stand on the fields
//   const w = await pool.weld(n, arrays, sizes)               → src/core/weld.js weld() of n vertices (the arrays are
//                                                               transferred: detached here until the result comes back)
// Falls back to the main thread when module workers are unavailable.
import { heightAt } from '../world/heightfield.js';
import { meshLeaf } from '../terrain/mesh.js';
import { coverCandidates } from './cover.js';
import { farmPlan, farmCovers } from './farm.js';
import { weld } from '../core/weld.js';

let POOL = null;

class HeightPool {
  constructor(n) {
    this.workers = [];
    this.queue = [];
    this.jobs = new Map();
    this.seq = 0;
    try {
      for (let i = 0; i < n; i++) {
        const w = new Worker(new URL('./height-worker.js', import.meta.url), { type: 'module' });
        w.busy = 0;
        w.onmessage = (ev) => this._done(w, ev.data);
        w.onerror = (e) => { console.warn('[heightpool] worker error', e.message); };
        this.workers.push(w);
      }
    } catch (e) {
      console.warn('[heightpool] no module workers, meshing on the main thread', e);
      this.workers = [];
    }
  }
  get size() { return this.workers.length; }
  get pending() { return this.jobs.size + this.queue.length; }

  _run(msg, transfer = []) {
    if (!this.workers.length) return Promise.resolve(this._local(msg));
    return new Promise((resolve, reject) => {
      const id = ++this.seq;
      this.queue.push({ id, msg: { ...msg, id }, transfer, resolve, reject });
      this._pump();
    });
  }
  _pump() {
    while (this.queue.length) {
      const w = this.workers.reduce((a, b) => (b.busy < a.busy ? b : a));
      if (w.busy >= 2) return;                       // two in flight per worker keeps them fed
      // low-priority jobs (the countryside plan) only when nothing else waits, and never on every worker at once
      let k = this.queue.findIndex((j) => !j.msg.low);
      if (k < 0) {
        const lowBusy = [...this.jobs.values()].filter((j) => j.msg.low).length;
        if (lowBusy >= Math.max(1, this.workers.length - 2) || w.busy > 0) return;
        k = 0;
      }
      const job = this.queue.splice(k, 1)[0];
      w.busy++;
      this.jobs.set(job.id, job);
      w.postMessage(job.msg, job.transfer);
    }
  }
  _done(w, data) {
    w.busy--;
    const job = this.jobs.get(data.id);
    this.jobs.delete(data.id);
    if (job) { if (data.error) job.reject(new Error(data.error)); else job.resolve(data); }
    this._pump();
  }
  _local(msg) {
    if (msg.op === 'leaf') return meshLeaf(msg, msg.N);
    if (msg.op === 'cover') return { data: coverCandidates(msg) };
    if (msg.op === 'farm') return farmPlan(msg);
    if (msg.op === 'farmCovers') return { data: farmCovers(msg) };
    if (msg.op === 'weld') return weld(msg.n, msg.arrays.map((a, i) => [a, msg.sizes[i]]));
    const { x0, z0, dx, dz, W, j0, j1 } = msg;
    const data = new Float32Array(W * (j1 - j0));
    for (let j = j0; j < j1; j++) for (let i = 0; i < W; i++) data[(j - j0) * W + i] = heightAt(x0 + (i + 0.5) * dx, z0 + (j + 0.5) * dz);
    return { data };
  }

  /** drop queued (not yet started) leaf jobs that are no longer wanted */
  cancel(pred) {
    this.queue = this.queue.filter((j) => { if (j.msg.op === 'leaf' && pred(j.msg)) { j.reject(new Error('cancelled')); return false; } return true; });
  }

  /** tree-cover candidates over a rectangle (src/explore/cover.js), split over the workers: Float32Array of records */
  async cover(bounds, cell, opts = {}) {
    const [x0, z0, x1, z1] = bounds;
    const n = Math.max(1, this.size * 4), dz = (z1 - z0) / n;
    const parts = await Promise.all(Array.from({ length: n }, (_, k) => this._run({ op: 'cover', x0, z0: z0 + k * dz, x1, z1: z0 + (k + 1) * dz, cell, ...opts })));
    const len = parts.reduce((s, p) => s + p.data.length, 0);
    const out = new Float32Array(len);
    let o = 0;
    for (const p of parts) { out.set(p.data, o); o += p.data.length; }
    return out;
  }

  /** the countryside plan (src/explore/farm.js) over a rectangle, in slabs of district rows at low priority */
  async farm(bounds, opts = {}) {
    const [x0, z0, x1, z1] = bounds;
    const SL = 760, parts = [];
    for (let z = z0; z < z1; z += SL) parts.push(this._run({ op: 'farm', low: true, x0, z0: z, x1, z1: Math.min(z1, z + SL), ...opts }));
    const res = await Promise.all(parts);
    const cat = (k) => { const n = res.reduce((s, r) => s + r[k].length, 0), out = new Float32Array(n); let o = 0; for (const r of res) { out.set(r[k], o); o += r[k].length; } return out; };
    return { plots: cat('plots'), rims: cat('rims'), channels: cat('channels'), trees: cat('trees'), tea: cat('tea'), drape: cat('drape') };
  }

  /** which of the points [x, z, …] stand on the planned fields (src/explore/farm.js farmCovers), at low priority */
  async farmCovers(plan, pts) {
    const r = await this._run({ op: 'farmCovers', low: true, plots: plan.plots, tea: plan.tea, trees: plan.trees, pts }, [pts.buffer]);
    return r.data;
  }

  weld(n, arrays, sizes) {
    const own = arrays.map((a) => (a.byteOffset === 0 && a.byteLength === a.buffer.byteLength ? a : a.slice()));
    return this._run({ op: 'weld', n, arrays: own, sizes }, own.map((a) => a.buffer));
  }

  leaf(lf, N = 32, low = false) { return this._run({ op: 'leaf', x0: lf.x0, z0: lf.z0, size: lf.size, N, low }); }

  async grid(bounds, W, H) {
    const [x0, z0, x1, z1] = bounds;
    const dx = (x1 - x0) / W, dz = (z1 - z0) / H;
    const out = new Float32Array(W * H);
    const parts = Math.max(1, this.size * 3);
    const rows = Math.ceil(H / parts);
    const jobs = [];
    for (let j0 = 0; j0 < H; j0 += rows) {
      const j1 = Math.min(H, j0 + rows);
      jobs.push(this._run({ op: 'grid', x0, z0, dx, dz, W, j0, j1 }).then((r) => out.set(r.data, j0 * W)));
    }
    await Promise.all(jobs);
    return out;
  }
}

export function getHeightPool() {
  if (!POOL) {
    const hc = (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || 4;
    POOL = new HeightPool(Math.max(2, Math.min(8, hc - 2)));
  }
  return POOL;
}
