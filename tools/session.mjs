// Persistent render session: builds the world ONCE, then renders any number of camera / look
// variants quickly (no rebuild per image). Ideal for camera direction and grading.
//
//   node tools/session.mjs --port 9400 [--quality preview] [--w 1664 --h 928] [--params "skip=mist"]
//     (keep it running in the background; it holds one GPU-lock slot; exits after 15 min idle)
//   node tools/snap.mjs --port 9400 --shot 1 --out out/me/s1.png                     render shot 1 as defined
//   node tools/snap.mjs --port 9400 --shot 1 --set '{"fov":38,"pos":[-300,40,420]}' --out out/me/s1b.png
//   node tools/snap.mjs --port 9400 --reload        reload the page with the latest code (rebuilds the world)
//   node tools/snap.mjs --port 9400 --quit
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { startServer } from './serve.mjs';
import { launchChrome, sweepStaleProfiles } from './chrome.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'out');
const args = {};
for (let i = 2; i < process.argv.length; i++) {
  const k = process.argv[i]; if (!k.startsWith('--')) continue;
  const n = process.argv[i + 1]; if (n === undefined || n.startsWith('--')) args[k.slice(2)] = true; else { args[k.slice(2)] = n; i++; }
}
const PORT = Number(args.port || 9400);
const quality = args.quality || 'preview';
const W = Number(args.w || 1664), H = Number(args.h || 928);
const IDLE_MS = Number(args.idle || 15) * 60 * 1000;
const SLOTS = Number(process.env.GPU_SLOTS || 4);
const { SHOTS } = await import(pathToFileURL(path.join(ROOT, 'src/world/shots.js')).href);
const refFor = (id) => { const s = SHOTS.find((x) => String(x.id) === String(id)); return s?.ref ? path.join(ROOT, s.ref) : null; };

let lockPath = null;
async function acquire() {
  for (;;) {
    for (let s = 0; s < SLOTS; s++) {
      const p = path.join(OUT, '.gpu.lock.' + s);
      try {
        const fd = fs.openSync(p, 'wx'); fs.writeSync(fd, JSON.stringify({ pid: process.pid, time: Date.now(), args: 'session ' + PORT })); fs.closeSync(fd);
        lockPath = p; return;
      } catch (e) {
        if (e.code !== 'EEXIST') throw e;
        try { const info = JSON.parse(fs.readFileSync(p, 'utf8')); process.kill(info.pid, 0); } catch { try { fs.rmSync(p, { force: true }); } catch {} }
      }
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
}
function release() { try { if (lockPath) { const i = JSON.parse(fs.readFileSync(lockPath, 'utf8')); if (i.pid === process.pid) fs.rmSync(lockPath, { force: true }); } } catch {} }
process.on('exit', release);
let browser = null;
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, async () => { release(); if (browser) await browser.cleanup(); process.exit(0); });

const server = await startServer(0);
await acquire();
sweepStaleProfiles();
browser = await launchChrome({ width: W, height: H, protocolTimeout: 3600 * 1000 });
const logs = [];
let page = null;
// a fresh page (also after the renderer died, e.g. under GPU contention: /reload then starts over on a new page)
async function openPage() {
  if (page) { try { await page.close(); } catch {} }
  // the whole browser can go too: launch a new one
  if (!browser.connected) { try { await browser.cleanup(); } catch {} browser = await launchChrome({ width: W, height: H, protocolTimeout: 3600 * 1000 }); }
  page = await browser.newPage();
  page.on('console', (m) => { const t = `[page:${m.type()}] ${m.text()}`; logs.push(t); if (logs.length > 400) logs.shift(); if ((m.type() === 'error' || m.type() === 'warning') && !t.includes('Failed to load resource')) console.log(t); });
  page.on('pageerror', (e) => { const t = '[page:error] ' + e.message; logs.push(t); console.log(t); });
}
await openPage();

async function load() {
  await openPage();
  const qs = new URLSearchParams(args.params || '');
  qs.set('quality', quality); qs.set('w', String(W)); qs.set('h', String(H)); qs.set('mode', 'still'); qs.set('shot', '1');
  const t0 = Date.now();
  await page.goto(`http://127.0.0.1:${server.port}/index.html?${qs}`, { waitUntil: 'load', timeout: 3600 * 1000 });
  await page.waitForFunction('window.__READY === true || !!window.__RENDER_ERROR', { timeout: 3600 * 1000, polling: 500 });
  const err = await page.evaluate(() => window.__RENDER_ERROR || null);
  if (err) throw new Error(err);
  console.log(`[session] world ready in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
}
// the renderer can die while the world builds (GPU contention): start over on a fresh page, up to 12 times
async function loadRetry() {
  for (let k = 1; ; k++) {
    try { return await load(); }
    catch (e) { if (k >= 12) throw e; console.log(`[session] load failed (${String(e.message || e).slice(0, 80)}), retry ${k}`); }
  }
}
process.on('unhandledRejection', (e) => console.log('[session] unhandled: ' + String(e?.message || e).slice(0, 120)));
await loadRetry();

let last = Date.now();
setInterval(() => { if (Date.now() - last > IDLE_MS) { console.log('[session] idle timeout'); shutdown(); } }, 10000);
async function shutdown() { try { await browser.cleanup(); } catch {} await server.close(); release(); process.exit(0); }

const api = http.createServer(async (req, res) => {
  last = Date.now();
  let body = '';
  for await (const c of req) body += c;
  const send = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
  try {
    const cmd = body ? JSON.parse(body) : {};
    if (req.url === '/quit') { send(200, { ok: true }); setTimeout(shutdown, 100); return; }
    if (req.url === '/reload') { await loadRetry(); send(200, { ok: true }); return; }
    if (req.url === '/eval') { const v = await page.evaluate(`(async () => (${cmd.expr}))()`); send(200, { value: v }); return; }
    if (req.url === '/logs') { send(200, { logs }); return; }
    if (req.url === '/shots') { send(200, { shots: await page.evaluate(() => window.__SHOTS) }); return; }
    if (req.url === '/render') {
      const t0 = Date.now();
      const shots = await page.evaluate(() => window.__SHOTS);
      let shot = cmd.shot !== undefined ? shots.find((s) => String(s.id) === String(cmd.shot)) : null;
      shot = { ...(shot || { id: 'custom' }), ...(cmd.set || {}) };
      const dataUrl = await page.evaluate(async (s, spp) => await window.__renderShotObj(s, spp), shot, cmd.spp ?? null);
      const out = path.resolve(ROOT, cmd.out || `out/session_${shot.id}.png`);
      fs.mkdirSync(path.dirname(out), { recursive: true });
      fs.writeFileSync(out, Buffer.from(dataUrl.split(',')[1], 'base64'));
      let cmp = null;
      const ref = refFor(shot.id);
      if (cmd.compare !== false && ref && fs.existsSync(ref)) {
        cmp = out.replace(/\.png$/i, '_cmp.png');
        execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-i', ref, '-i', out, '-filter_complex', '[0]scale=-2:540[a];[1]scale=-2:540[b];[a][b]hstack', cmp]);
      }
      const stats = await page.evaluate(() => window.__STATS);
      send(200, { out, cmp, ms: Date.now() - t0, stats });
      return;
    }
    send(404, { error: 'unknown endpoint' });
  } catch (e) { send(500, { error: String(e.stack || e) }); }
});
api.listen(PORT, '127.0.0.1', () => console.log(`[session] listening on http://127.0.0.1:${PORT}`));
