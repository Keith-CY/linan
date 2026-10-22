// Bake the 飞来峰 cliff and the 布袋弥勒 (src/modules/karst.js) to generated/karst-feilai-*.bin:
//   node tools/bake.mjs karst                       both qualities (hi = high/ultra, lo = preview), all regions
//   KARST_DETAIL=1 KARST_ONLY=niche,head node tools/bake.mjs karst   a subset while iterating
//   KARST_FORCE=1 …                                 rebuild even when the file exists
// Regions are meshed in parallel worker threads (src/bake/karst-worker.js).
import fs from 'node:fs';
import os from 'node:os';
import { Worker } from 'node:worker_threads';
import { loadOrBuild } from '../core/cache.js';
import { makeFeilai } from '../karst/feilai.js';
import { feilaiName } from '../modules/karst.js';
import { toGeometry } from '../sculpt/mesher.js';

export async function runPool(jobs, workerUrl, threads) {
  const out = new Map();
  let next = 0;
  const one = () => new Promise((resolve, reject) => {
    if (next >= jobs.length) return resolve();
    const job = jobs[next++];
    const t0 = Date.now();
    const w = new Worker(workerUrl, { workerData: job });
    w.on('message', (m) => { out.set(job.name, m); console.log(`[bake] ${job.name}: ${(m.index.length / 3 / 1e3).toFixed(0)} k tris in ${((Date.now() - t0) / 1000).toFixed(1)} s`); });
    w.on('error', reject);
    w.on('exit', () => one().then(resolve, reject));
  });
  await Promise.all(Array.from({ length: Math.min(threads, jobs.length) }, one));
  return out;
}

export async function bake() {
  const env = process.env;
  const details = (env.KARST_DETAIL || '1,0.5').split(',').map(Number);
  const only = env.KARST_ONLY ? env.KARST_ONLY.split(',') : null;
  const F = makeFeilai();
  const jobs = [];
  for (const detail of details) {
    for (const R of F.regions(detail)) {
      if (only && !only.some((o) => R.name.startsWith(o))) continue;
      const name = feilaiName(R.name, detail);
      if (!env.KARST_FORCE && fs.existsSync(new URL(`../../generated/${name}.bin`, import.meta.url))) { console.log(`[bake] ${name}: up to date`); continue; }
      jobs.push({ name, region: R.name, detail });
    }
  }
  const threads = Math.max(1, Math.min(Number(env.KARST_THREADS || 0) || os.cpus().length - 1, 9));
  const res = await runPool(jobs, new URL('./karst-worker.js', import.meta.url), threads);
  for (const [name, m] of res) await loadOrBuild(name, () => toGeometry(m));
  return {};
}
