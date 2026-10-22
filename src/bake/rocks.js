// Bake the rock outcrops and 太湖石 of src/modules/rocks.js to generated/rocks-*.bin:
//   node tools/bake.mjs rocks             both qualities (hi / lo), every site
//   ROCKS_ONLY=baoshi,taihu ROCKS_DETAIL=0.5 ROCKS_FORCE=1 node tools/bake.mjs rocks
import fs from 'node:fs';
import os from 'node:os';
import { loadOrBuild } from '../core/cache.js';
import { outcropSites, TAIHU } from '../karst/sites.js';
import { outcropName, taihuName } from '../modules/rocks.js';
import { toGeometry } from '../sculpt/mesher.js';
import { runPool } from './karst.js';

export async function bake() {
  const env = process.env;
  const details = (env.ROCKS_DETAIL || '1,0.5').split(',').map(Number);
  const only = env.ROCKS_ONLY ? env.ROCKS_ONLY.split(',') : null;
  const jobs = [];
  for (const detail of details) {
    for (const S of outcropSites()) if (!only || only.includes(S.name)) jobs.push({ name: outcropName(S.name, detail), kind: 'outcrop', site: S.name, detail });
    for (const T of TAIHU) if (!only || only.includes('taihu')) jobs.push({ name: taihuName(T.seed, detail), kind: 'taihu', seed: T.seed, h: T.h, detail });
  }
  const todo = jobs.filter((j) => env.ROCKS_FORCE || !fs.existsSync(new URL(`../../generated/${j.name}.bin`, import.meta.url)));
  for (const j of jobs) if (!todo.includes(j)) console.log(`[bake] ${j.name}: up to date`);
  const res = await runPool(todo, new URL('./rocks-worker.js', import.meta.url), Math.max(1, Math.min(os.cpus().length - 1, 9)));
  for (const [name, m] of res) await loadOrBuild(name, () => toGeometry(m));
  return {};
}
