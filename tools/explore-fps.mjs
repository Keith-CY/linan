// Walking frame rate at the ten places of the explorable world, measured in a running explore session
// (tools/explore-session.mjs, ideally --w 1440 --h 900 --params "scale=1": a fixed full-resolution live painting).
// For each place: teleport, let the streamed terrain settle, then walk forward while turning slowly (window.__explore.fps)
// and report the mean frame rate, the 95th-percentile frame time and the CPU split (window.__explore.profile).
//
// --mode walk (default) lands the walker on the ground at the place (the viewpoints of 宝石山, 御街 … are in the air);
// --mode view keeps the viewpoint's own mode (flying where it is high).
//
// --cost: no walking; the GPU cost of one live frame (window.__explore.cost: frame, scene, paint in ms) at a fixed
// ground pose per place (POSES), for A/B checks that the streaming and the vsync do not blur.
// Places are the viewpoints 1–10 and the countryside's EXTRA places by name (paddy, tea): there the walker stands at a
// fixed pose on the ground and walks from it.
//
//   node tools/explore-fps.mjs [--port 9571] [--places 1,2,…,paddy,tea] [--seconds 4] [--mode walk|view] [--cost] [--out out/explore/fps.json] [--label before]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = {};
for (let i = 2; i < process.argv.length; i++) {
  const k = process.argv[i]; if (!k.startsWith('--')) continue;
  const n = process.argv[i + 1]; if (n === undefined || n.startsWith('--')) args[k.slice(2)] = true; else { args[k.slice(2)] = n; i++; }
}
const PORT = Number(args.port || 9571);
const places = String(args.places || '1,2,3,4,5,6,7,8,9,10').split(',').map((p) => (/^\d+$/.test(p) ? Number(p) : p));
const SECONDS = Number(args.seconds || 4);
const MODE = args.mode || 'walk';
const COST = 'cost' in args;
// fixed walking poses on the ground at each place ([x, y, z], yaw°), as the walker lands there from the viewpoint
const POSES = {
  1: [[331.78, 59.54, -2235.4], 160], 2: [[-444.83, 3, 160.88], -169.2], 3: [[-1115.9, 2.82, -981.99], -41.8], 4: [[829.54, 2.3, 1185.4], 131.4],
  5: [[113.96, 1.93, 695.23], -118], 6: [[1641.08, 47.1, 2111.73], -148.1], 7: [[2416.04, 6.31, -933.28], -178.7], 8: [[-3978.44, 27.47, 437.73], -98.5],
  9: [[-1719.4, 20.72, 4989.92], -82.6], 10: [[627, 2.78, -1615.53], 23.2],
};
const NAMES = { 1: '宝石山 (west lake)', 2: '苏堤', 3: '曲院风荷', 4: '雷峰', 5: '三潭', 6: '皇城', 7: '御街', 8: '飞来峰', 9: '六和塔', 10: '断桥', paddy: 'paddy (north plain)', tea: 'tea (龙井)' };
// the countryside (src/explore/fields.js): a paddy field on the plain north of 宝石山, the 龙井 tea slopes ([x, y, z], yaw°)
const EXTRA = { paddy: [[-870, 5, -3900], 0], tea: [[-2385, 90, 2590], -150] };
for (const [k, v] of Object.entries(EXTRA)) POSES[k] = v;
// go to a place: a viewpoint (teleport) or an EXTRA pose (on the ground, walking)
const goto = (id, land) => (typeof id === 'number' ? `window.__explore.teleport(${id})${land}` : `(window.__explore.mode('walk'), window.__explore.setPose(${JSON.stringify(EXTRA[id][0])}, ${EXTRA[id][1]}, 0))`);

const call = async (ep, body) => {
  const r = await fetch(`http://127.0.0.1:${PORT}/${ep}`, { method: 'POST', body: JSON.stringify(body || {}) });
  const j = await r.json();
  if (j.error) throw new Error(j.error);
  return j;
};
const ev = async (expr) => (await call('eval', { expr })).value;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const rows = [];
if (COST) {
  await ev('window.__explore.noStill(true)');
  for (const id of places) {
    // the walking field of view: leave the viewpoint, then stand at the fixed pose
    await ev(`(${goto(id, '')}, window.__explore.mode('walk'), await window.__explore.hold(['KeyW'], 0.3), true)`);
    await wait(1800);
    const [pos, yaw] = POSES[id];
    await ev(`window.__explore.setPose(${JSON.stringify(pos)}, ${yaw}, 0)`);
    await ev(`(async () => { const st = window.engine.registry.terrain?.stream; const t0 = performance.now(); while (st && !(st.plan?.done) && performance.now() - t0 < 20000) await new Promise((r) => setTimeout(r, 50)); return true; })()`);
    await wait(1000);
    await ev('window.__explore.cost(4)');
    const c = await ev('window.__explore.cost(8)');
    rows.push({ place: id, name: NAMES[id], ...c });
    console.log(`${String(id).padStart(2)} ${NAMES[id].padEnd(18)} frame ${String(c.frame).padStart(5)} ms (${(1000 / c.frame).toFixed(0)} fps)  scene ${c.scene}  paint ${c.paint}  calls ${c.calls}  ${c.mTris} M tris`);
  }
  await ev('window.__explore.noStill(false)');
}
for (const id of COST ? [] : places) {
  await ev(goto(id, ''));
  // the streamed terrain and the vegetation buckets round the new camera
  await ev(`(async () => { const st = window.engine.registry.terrain?.stream; const t0 = performance.now(); while (st && !(st.plan?.done) && performance.now() - t0 < 20000) await new Promise((r) => setTimeout(r, 50)); return true; })()`);
  await wait(800);
  const land = MODE === 'walk' ? `, window.__explore.mode('walk')` : '';
  await ev(goto(id, land));
  await ev(`window.__explore.fps(1.5)`);            // warm-up: shaders, buckets, the first re-plans
  await ev(goto(id, land));
  await wait(1200);
  const f = await ev(`window.__explore.profile(${SECONDS})`);
  const st = await ev('window.__explore.stats()');
  const row = { place: id, name: NAMES[id], fps: f.fps, meanMs: f.meanMs, p95Ms: f.p95Ms, maxMs: f.maxMs, cpu: f.cpu, scale: st.renderScale, calls: st.scene?.calls, mTris: +((st.scene?.triangles || 0) / 1e6).toFixed(2), mode: st.mode };
  rows.push(row);
  console.log(`${String(id).padStart(5)} ${NAMES[id].padEnd(18)} ${String(f.fps).padStart(5)} fps  mean ${f.meanMs} ms  p95 ${f.p95Ms} ms  max ${f.maxMs} ms  calls ${row.calls}  ${row.mTris} M tris  scale ${st.renderScale}  ${st.mode}  cpu render ${f.cpu.render[0]} ms`);
}
if (args.out) {
  const out = path.resolve(ROOT, args.out);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  let prev = {};
  try { prev = JSON.parse(fs.readFileSync(out, 'utf8')); } catch {}
  prev[args.label || 'run'] = rows;
  fs.writeFileSync(out, JSON.stringify(prev, null, 1));
  console.log('wrote', path.relative(ROOT, out));
}
