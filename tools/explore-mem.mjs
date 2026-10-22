// Memory of the explorable world over a long walk, measured in a running explore session
// (tools/explore-session.mjs --glmem: the WebGL allocations are counted from the page's start).
// Right after the load, then along a scripted route of walks, runs, flights and still views through every viewpoint
// and the countryside, for --minutes of wall time: the V8 heap (Runtime.getHeapUsage: JS objects and ArrayBuffer
// backing stores; performance.memory.usedJSHeapSize is their sum) after a full GC, the WebGL buffer / texture /
// renderbuffer bytes and three.js's renderer.info.memory.
//
//   node tools/explore-mem.mjs [--port 9611] [--minutes 10] [--out out/explore/mem.json] [--label before]
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = {};
for (let i = 2; i < process.argv.length; i++) {
  const k = process.argv[i]; if (!k.startsWith('--')) continue;
  const n = process.argv[i + 1]; if (n === undefined || n.startsWith('--')) args[k.slice(2)] = true; else { args[k.slice(2)] = n; i++; }
}
const PORT = Number(args.port || 9611);
const MINUTES = Number(args.minutes ?? 10);

const call = async (ep, body) => {
  const r = await fetch(`http://127.0.0.1:${PORT}/${ep}`, { method: 'POST', body: JSON.stringify(body || {}) });
  const j = await r.json();
  if (j.error) throw new Error(j.error);
  return j;
};
const ev = async (expr) => (await call('eval', { expr })).value;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const load = () => os.loadavg().map((v) => +v.toFixed(1));

async function measure(tag) {
  const h = await call('heap', { gc: true });
  const page = await ev(`({ gl: window.__glmem?.() ?? null, info: { ...engine.renderer.info.memory, programs: engine.renderer.info.programs?.length },
    pm: +(performance.memory?.usedJSHeapSize / 1048576).toFixed(1), pos: engine.camera.position.toArray().map((v) => Math.round(v)),
    terrain: engine.registry.terrain?.stream?.cache?.size })`);
  const row = { tag, t: Math.round((Date.now() - T0) / 1000), heapMB: +(h.usedMB + (h.backingMB || 0)).toFixed(1), v8MB: h.usedMB, backingMB: h.backingMB, ...page, load: load() };
  console.log(`${String(row.t).padStart(5)} s  ${tag.padEnd(22)} heap ${row.heapMB} MB (V8 ${row.v8MB}, buffers ${row.backingMB})  gl ${JSON.stringify(row.gl)}  geometries ${row.info.geometries} textures ${row.info.textures}  terrain leaves ${row.terrain}  load ${row.load.join(' ')}`);
  rows.push(row);
  return row;
}

// the route: every viewpoint (its still view, a walk, a run, a flight), then the countryside and a long walk down 御街
const VIEWS = [2, 10, 1, 3, 4, 5, 8, 9, 6, 7];
const settle = `(async () => { const st = window.engine.registry.terrain?.stream; const t0 = performance.now(); while (st && !(st.plan?.done) && performance.now() - t0 < 20000) await new Promise((r) => setTimeout(r, 50)); return true; })()`;
async function leg(i) {
  const id = VIEWS[i % VIEWS.length];
  await ev(`window.__explore.teleport(${id})`);
  await ev('window.__explore.still(60)');                                    // the still view (the offline still at a viewpoint)
  await ev(`(window.__explore.mode('walk'), true)`);
  await ev(`window.__explore.look(${(i * 47) % 360 - 180}, 0)`);
  await ev(`window.__explore.hold(['KeyW'], 6)`);                            // walk
  await ev(`window.__explore.hold(['KeyW', 'ShiftLeft'], 5)`);               // run
  await wait(1500);                                                          // stand: the still view off the viewpoints
  await ev(`window.__explore.still(30)`);
  await ev(`(window.__explore.mode('fly'), window.__explore.look(${(i * 83) % 360 - 180}, -8), true)`);
  await ev(`window.__explore.hold(['KeyW', 'ShiftLeft', 'KeyE'], 4)`);       // fly up and away (~900 m)
  await ev(`window.__explore.hold(['KeyW', 'KeyQ'], 3)`);
  await ev(settle);
  await ev(`window.__explore.still(30)`);
}
async function country(i) {
  const poses = [[[-870, 5, -3900], 0], [[-2385, 90, 2590], -150], [[-140, 0, -3118], 160], [[2416, 6, -1400], 180]];
  const [p, yaw] = poses[i % poses.length];
  await ev(`(window.__explore.mode('walk'), window.__explore.setPose(${JSON.stringify(p)}, ${yaw}, 0), true)`);
  await ev(settle);
  await ev(`window.__explore.hold(['KeyW', 'ShiftLeft'], 8)`);
  await ev(`window.__explore.still(30)`);
}

const rows = [];
const T0 = Date.now();
await ev('window.__explore.noStill(false)');
await measure('after load');
let i = 0;
while ((Date.now() - T0) / 60000 < MINUTES) {
  await leg(i);
  if (i % 3 === 2) await country(i / 3 | 0);
  i++;
  if (i % 3 === 0) await measure(`leg ${i}`);
}
const end = await measure(`end (${i} legs)`);
const peak = Math.max(...rows.map((r) => r.heapMB));
console.log(`after load ${rows[0].heapMB} MB, after ${Math.round(end.t / 60)} min ${end.heapMB} MB (peak ${peak} MB); gl ${JSON.stringify(rows[0].gl)} → ${JSON.stringify(end.gl)}`);
if (args.out) {
  const out = path.resolve(ROOT, args.out);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  let prev = {};
  try { prev = JSON.parse(fs.readFileSync(out, 'utf8')); } catch {}
  prev[args.label || 'run'] = rows;
  fs.writeFileSync(out, JSON.stringify(prev, null, 1));
  console.log('wrote', path.relative(ROOT, out));
}
