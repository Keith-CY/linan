// Persistent headless session for the explorable world (?mode=explore): loads the page once in headless Chrome
// (GPU, throwaway profile via tools/chrome.mjs), then answers small HTTP calls while it stays open.
//
//   node tools/explore-session.mjs --port 9480 [--w 1440 --h 900] [--params "quality=explore&look=ink"] [--mobile]
//   curl -s localhost:9480/eval -d '{"expr":"window.__explore.stats()"}'
//   curl -s localhost:9480/shot -d '{"out":"out/explore/a.png"}'          screenshot of the page (canvas + UI)
//   curl -s localhost:9480/reload            reload with the latest code       curl -s localhost:9480/quit
// --mobile: a 390 x 844 touch viewport at device scale 3 (phone layout check).
// --novsync: frames are not held to the display's 60 Hz (true frame times for A/B cost checks; fps can exceed 60).
// Holds one GPU-lock slot (out/.gpu.lock.N) like tools/session.mjs; exits after 20 min idle.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from './serve.mjs';
import { launchChrome, sweepStaleProfiles } from './chrome.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'out');
const args = {};
for (let i = 2; i < process.argv.length; i++) {
  const k = process.argv[i]; if (!k.startsWith('--')) continue;
  const n = process.argv[i + 1]; if (n === undefined || n.startsWith('--')) args[k.slice(2)] = true; else { args[k.slice(2)] = n; i++; }
}
const PORT = Number(args.port || 9480);
const mobile = !!args.mobile;
const W = Number(args.w || (mobile ? 390 : 1440)), H = Number(args.h || (mobile ? 844 : 900));
const IDLE_MS = Number(args.idle || 20) * 60 * 1000;
const SLOTS = Number(process.env.GPU_SLOTS || 4);

let lockPath = null;
async function acquire() {
  for (;;) {
    for (let s = 0; s < SLOTS; s++) {
      const p = path.join(OUT, '.gpu.lock.' + s);
      try {
        const fd = fs.openSync(p, 'wx'); fs.writeSync(fd, JSON.stringify({ pid: process.pid, time: Date.now(), args: 'explore-session ' + PORT })); fs.closeSync(fd);
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

fs.mkdirSync(OUT, { recursive: true });
const server = await startServer(0);
await acquire();
sweepStaleProfiles();
const extraArgs = args.novsync ? ['--disable-gpu-vsync', '--disable-frame-rate-limit'] : [];
browser = await launchChrome({ width: Math.max(W, 800), height: Math.max(H, 600), protocolTimeout: 3600 * 1000, extraArgs });
const logs = [];
let page = null;
async function openPage() {
  if (page) { try { await page.close(); } catch {} }
  page = await browser.newPage();
  await page.setViewport(mobile ? { width: W, height: H, deviceScaleFactor: 3, isMobile: true, hasTouch: true } : { width: W, height: H });
  page.on('console', (m) => { const t = `[page:${m.type()}] ${m.text()}`; logs.push(t); if (logs.length > 600) logs.shift(); if ((m.type() === 'error' || m.type() === 'warning') && !t.includes('Failed to load resource')) console.log(t); });
  page.on('pageerror', (e) => { const t = '[page:error] ' + e.message; logs.push(t); console.log(t); });
}
async function load() {
  await openPage();
  const qs = new URLSearchParams(args.params || '');
  const t0 = Date.now();
  await page.goto(`http://127.0.0.1:${server.port}/index.html?${qs}`, { waitUntil: 'load', timeout: 3600 * 1000 });
  await page.waitForFunction('window.__READY === true || !!window.__RENDER_ERROR', { timeout: 3600 * 1000, polling: 250 });
  const err = await page.evaluate(() => window.__RENDER_ERROR || null);
  if (err) throw new Error(err);
  console.log(`[explore-session] ready in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  return (Date.now() - t0) / 1000;
}
let loadS = await load();
console.log(`[explore-session] page http://127.0.0.1:${server.port}/index.html?${new URLSearchParams(args.params || '')}`);

let last = Date.now();
setInterval(() => { if (Date.now() - last > IDLE_MS) { console.log('[explore-session] idle timeout'); shutdown(); } }, 10000);
async function shutdown() { try { await browser.cleanup(); } catch {} await server.close(); release(); process.exit(0); }

http.createServer(async (req, res) => {
  last = Date.now();
  let body = '';
  for await (const c of req) body += c;
  const send = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
  try {
    const cmd = body ? JSON.parse(body) : {};
    if (req.url === '/quit') { send(200, { ok: true }); setTimeout(shutdown, 100); return; }
    if (req.url === '/reload') { if (cmd.params !== undefined) args.params = cmd.params; loadS = await load(); send(200, { ok: true, loadS }); return; }
    if (req.url === '/eval') { const v = await page.evaluate(`(async () => (${cmd.expr}))()`); send(200, { value: v }); return; }
    if (req.url === '/logs') { send(200, { logs: logs.slice(-(cmd.n || 200)) }); return; }
    if (req.url === '/key') { await page.keyboard[cmd.type || 'press'](cmd.key); send(200, { ok: true }); return; }
    if (req.url === '/click') { await page.mouse.click(cmd.x, cmd.y); send(200, { ok: true }); return; }
    if (req.url === '/shot') {
      const out = path.resolve(ROOT, cmd.out || 'out/explore/shot.png');
      fs.mkdirSync(path.dirname(out), { recursive: true });
      await page.screenshot({ path: out, type: 'png' });
      send(200, { out });
      return;
    }
    send(404, { error: 'unknown endpoint' });
  } catch (e) { send(500, { error: String(e.stack || e) }); }
}).listen(PORT, '127.0.0.1', () => console.log(`[explore-session] listening on http://127.0.0.1:${PORT} (load ${loadS.toFixed(1)} s)`));
