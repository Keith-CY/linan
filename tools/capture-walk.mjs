// Capture the walk video (media/walk.mp4): the explorable world itself (the default page, ink 纯水墨, its interface
// and watermark) in headless Chrome, driven by real key presses, one screenshot per frame, then encoded at 30 fps.
//
//   node tools/capture-walk.mjs [--w 1440 --h 900] [--out out/walk] [--name walk.mp4] [--crf 29] [--params "…"]
//                               [--encode-only]
//
// The clock: the page's frame loop, performance.now() and its CSS animations run on a virtual clock that advances
// 1/30 s per captured frame, so walking and flying speeds, the still view's fade and the place titles play at their real
// pace however slowly the frames are captured. Where the page waits on real work — the still view preparing (terrain
// meshed in the workers) and accumulating its samples — the clock follows the wall clock instead and the frame is held
// (--honest 0 turns that off). The live painting is held at its best step (q=high, scale=1: the adaptive ladder
// would read the virtual frame times).
//
// The script (TIMELINE below): the 苏堤 viewpoint, a walk down the slab path to the 月洞 arch (望山桥), standing still
// (the still view paints itself), key 3 to 曲院风荷 and T to its sunset, key 7 and a flight over the roofs of the
// imperial way, key 5 to 三潭印月 by moonlight. Frames: <out>/fNNNNN.jpg.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { startServer } from './serve.mjs';
import { launchChrome, sweepStaleProfiles } from './chrome.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = {};
for (let i = 2; i < process.argv.length; i++) {
  const k = process.argv[i]; if (!k.startsWith('--')) continue;
  const n = process.argv[i + 1]; if (n === undefined || n.startsWith('--')) args[k.slice(2)] = true; else { args[k.slice(2)] = n; i++; }
}
const W = Number(args.w || 1440), H = Number(args.h || 900);
const FPS = 30, FRAME_MS = 1000 / FPS;
const OUT = path.resolve(ROOT, args.out || 'out/walk');
const NAME = args.name || 'walk.mp4';
const CRF = Number(args.crf ?? 29);   // the paper's grain and the flight are costly: 29 keeps a 20 s capture near 7 MB
const HONEST = String(args.honest ?? '1') !== '0';

// [action, value]: press a key; hold keys for seconds (with an optional turn in degrees per second); wait seconds;
// wait until the still view shows, then seconds more
const TIMELINE = [
  ['preroll', 'Digit2'],                       // 苏堤春晓: the viewpoint's still and its title (captured from the still on)
  ['wait', 1.0],
  // down the slab path under the willows toward the 月洞 arch (望山桥, 64 m ahead): walking, a run, walking again,
  // stopping before its face
  ['hold', { keys: ['KeyW'], s: 2.0 }], ['hold', { keys: ['KeyW', 'ShiftLeft'], s: 2.2 }], ['hold', { keys: ['KeyW'], s: 0.5 }],
  ['still', 0.8],                              // stand: the still view paints itself
  ['press', 'Digit3'], ['still', 0.6],         // key 3: 曲院风荷 in summer
  ['press', 'KeyT'], ['still', 1.0],           // T: the next time of day, sunset over the lotus
  ['press', 'Digit7'], ['still', 0.3],         // key 7: 临安御街 from above (a viewpoint in the air starts in flight)
  ['fly'],                                     // (F, unless already flying)
  // on over the roofs down the imperial way, climbing, then gliding on
  ['hold', { keys: ['Space', 'KeyW'], s: 1.5 }], ['hold', { keys: ['KeyW'], s: 1.8 }],
  ['press', 'Digit5'], ['still', 1.6],         // key 5: 三潭印月 by moonlight
];

// ------------------------------------------------------------------ GPU lock (as tools/render-video.mjs)
const LOCKDIR = path.join(ROOT, 'out');
const SLOTS = Number(process.env.GPU_SLOTS || 4);
let lockPath = null;
async function acquire() {
  for (;;) {
    for (let s = 0; s < SLOTS; s++) {
      const p = path.join(LOCKDIR, '.gpu.lock.' + s);
      try { const fd = fs.openSync(p, 'wx'); fs.writeSync(fd, JSON.stringify({ pid: process.pid, time: Date.now(), args: 'capture-walk' })); fs.closeSync(fd); lockPath = p; return; }
      catch (e) { if (e.code !== 'EEXIST') throw e; try { const info = JSON.parse(fs.readFileSync(p, 'utf8')); process.kill(info.pid, 0); } catch { try { fs.rmSync(p, { force: true }); } catch {} } }
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
}
const release = () => { try { if (lockPath) { const i = JSON.parse(fs.readFileSync(lockPath, 'utf8')); if (i.pid === process.pid) fs.rmSync(lockPath, { force: true }); } } catch {} };
process.on('exit', release);

// the virtual clock, installed in the page once the world is ready
const CLOCK = `(async () => {
  const realRAF = window.requestAnimationFrame.bind(window);
  const realNow = performance.now.bind(performance);
  const vc = (window.__vc = { t: 0, q: [], anims: new Map() });
  window.requestAnimationFrame = (cb) => { vc.q.push(cb); return vc.q.length; };
  // the frame already scheduled runs once more on the real clock, then queues itself on the virtual one
  await new Promise((r) => realRAF(() => realRAF(r)));
  vc.t = realNow();
  performance.now = () => vc.t;
  for (const a of document.getAnimations()) { try { a.finish(); } catch {} vc.anims.set(a, null); }
  window.__vstep = async (ms, n = 1) => {
    for (let k = 0; k < n; k++) {
      vc.t += ms;
      for (const a of document.getAnimations()) {
        let s = vc.anims.get(a);
        if (s === null) continue;
        if (!s) { s = { t0: vc.t - ms }; vc.anims.set(a, s); a.pause(); }
        a.currentTime = vc.t - s.t0;
      }
      const q = vc.q; vc.q = [];
      for (const cb of q) cb(vc.t);
    }
    await new Promise((r) => realRAF(() => r()));
    return true;
  };
  return true;
})()`;

async function capture() {
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });
  const server = await startServer(0);
  await acquire();
  sweepStaleProfiles();
  const browser = await launchChrome({ width: W, height: H, protocolTimeout: 3600 * 1000 });
  const t0 = Date.now();
  const log = [];
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: W, height: H });
    page.on('console', (m) => { const t = m.text(); if ((m.type() === 'error' || m.type() === 'warning') && !t.includes('Failed to load resource')) console.log(`[page:${m.type()}] ${t}`); });
    page.on('pageerror', (e) => console.log('[page:error]', e.message));
    const qs = new URLSearchParams({ q: 'high', scale: '1', ...Object.fromEntries(new URLSearchParams(args.params || '')) });
    await page.goto(`http://127.0.0.1:${server.port}/index.html?${qs}`, { waitUntil: 'load', timeout: 3600 * 1000 });
    await page.waitForFunction('window.__READY === true || !!window.__RENDER_ERROR', { timeout: 3600 * 1000, polling: 500 });
    const err = await page.evaluate(() => window.__RENDER_ERROR || null);
    if (err) throw new Error(err);
    console.log(`[walk] world ready in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
    const ev = (expr) => page.evaluate(expr);
    // settle on the real clock: the stills' water, the countryside, the start viewpoint's still view
    await ev(`(async () => { await window.engine.registry.stillWater; const t0 = performance.now(); while (!(window.__explore.country()?.ready) && performance.now() - t0 < 60000) await new Promise((r) => setTimeout(r, 200)); return window.__explore.still(120); })()`);
    await ev(CLOCK);
    let frame = 0, lastReal = Date.now();
    const shoot = async (n) => {
      const buf = await page.screenshot({ type: 'jpeg', quality: 95, optimizeForSpeed: true });
      for (let k = 0; k < n; k++) fs.writeFileSync(path.join(OUT, `f${String(frame++).padStart(5, '0')}.jpg`), buf);
    };
    // one frame of page time (more while the page waits on real work, held), then the screenshot
    const tick = async ({ turn = null, record = true } = {}) => {
      if (turn) await ev(`window.__explore.look(${turn[0] / FPS}, ${turn[1] / FPS})`);
      const phase = await ev('window.__explore.phase()');
      const ts = Date.now();
      let n = 1;
      if (HONEST && phase === 'prep') n = Math.max(1, Math.round((ts - lastReal) / FRAME_MS));
      await page.evaluate((ms, k) => window.__vstep(ms, k), FRAME_MS, n);
      if (HONEST && phase === 'accum') {
        // the samples of a still view take real GPU time: hold the frame for as long as they took
        const k = Math.max(1, Math.round((Date.now() - ts) / FRAME_MS));
        if (k > 1) { await page.evaluate((ms, k) => window.__vstep(ms, k), FRAME_MS, k - 1); n += k - 1; }
      }
      lastReal = Date.now();
      if (record) await shoot(n);
      return { phase, n };
    };
    const seconds = async (s, o) => { const end = frame + Math.round(s * FPS); while (frame < end) await tick(o); };
    for (const [act, v] of TIMELINE) {
      const f0 = frame, r0 = Date.now();
      if (act === 'preroll') {
        await page.keyboard.press(v);
        let k = 0;
        while ((await ev('window.__explore.phase()')) !== 'shown' && k++ < 3000) await tick({ record: false });
      } else if (act === 'wait') await seconds(v);
      else if (act === 'press') { await page.keyboard.press(v); await tick(); }
      else if (act === 'fly') { if ((await ev('window.__explore.stats().mode')) !== 'fly') { await page.keyboard.press('KeyF'); await tick(); } }
      else if (act === 'hold') {
        for (const k of v.keys) await page.keyboard.down(k);
        await seconds(v.s, { turn: v.turn });
        for (const k of v.keys) await page.keyboard.up(k);
      } else if (act === 'still') {
        // until the still view shows (or 20 s of page time), then v seconds more
        const lim = frame + 20 * FPS;
        while (frame < lim && (await tick()).phase !== 'shown');
        await seconds(v);
      }
      const st = await ev('window.__explore.stats()');
      const line = `${act} ${JSON.stringify(v ?? '')}: frames ${f0}–${frame} (${((frame - f0) / FPS).toFixed(2)} s of video, ${((Date.now() - r0) / 1000).toFixed(0)} s to capture)  place ${st.place} look ${st.look} ${st.mode} pos ${st.pos.map((x) => x.toFixed(0)).join(' ')}`;
      console.log('[walk]', line); log.push(line);
    }
    fs.writeFileSync(path.join(OUT, 'capture.log'), log.join('\n') + '\n');
    console.log(`[walk] ${frame} frames (${(frame / FPS).toFixed(1)} s) in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  } finally {
    await browser.cleanup();
    await server.close();
    release();
  }
}

function encode() {
  const out = path.resolve(ROOT, args.dest || path.join(OUT, NAME));
  fs.mkdirSync(path.dirname(out), { recursive: true });
  execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-framerate', String(FPS), '-i', path.join(OUT, 'f%05d.jpg'),
    // the screenshots are full-range JPEG: to the video range, yuv420p (players treat yuvj420p unevenly)
    '-vf', 'scale=in_range=pc:out_range=tv,format=yuv420p',
    '-c:v', 'libx264', '-preset', 'slow', '-crf', String(CRF), '-profile:v', 'high', '-pix_fmt', 'yuv420p',
    '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709', '-movflags', '+faststart', out], { stdio: 'inherit' });
  console.log(`[walk] wrote ${path.relative(ROOT, out)}`);
}

if (!args['encode-only']) {
  // a renderer lost on a loaded machine (the page crashes while it builds the world): start again, up to 4 times
  for (let attempt = 1; ; attempt++) {
    try { await capture(); break; } catch (e) {
      console.log(`[walk] attempt ${attempt} failed: ${e.message}`);
      if (attempt >= 4) throw e;
      await new Promise((r) => setTimeout(r, 20000));
    }
  }
}
encode();
