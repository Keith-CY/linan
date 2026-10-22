// Headless GPU render harness.
//
// Examples:

//
// Options:
//   --shot <ids>      comma list of shot ids (see src/world/shots.js), or "all"
//   --test <module>   render a module in isolation (src/modules/<module>.js) inside the neutral test scene
//   --view <n>        which test view (index into the views returned by the module's test())
//   --quality <q>     preview | high | ultra   (default: preview)
//   --spp <n>         accumulated samples per pixel (default from quality)
//   --w --h           output size (default 1664x928 = reference size)
//   --out <file>      output png path (single shot/test only)
//   --outdir <dir>    output folder for shots (shot<N>.png); e.g. --shot all --params look=ink --outdir out/ink/qj
//   --params <qs>     extra URL query params passed to the page
//   --nocompare       skip writing the side-by-side comparison image
//   --timeout <sec>   page timeout (default 900)
//   --wm 0|1          the watermark (src/explore/watermark.js) stamped into the image: on for shots, off for module
//                     tests by default
//
// A GPU lock (out/.gpu.lock) serialises renders across concurrent processes/agents.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { startServer } from './serve.mjs';
import { launchChrome, sweepStaleProfiles } from './chrome.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'out');
fs.mkdirSync(OUT, { recursive: true });

function parseArgs(argv) {
  const a = {};
  for (let i = 2; i < argv.length; i++) {
    const k = argv[i];
    if (!k.startsWith('--')) continue;
    const key = k.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) a[key] = true;
    else { a[key] = next; i++; }
  }
  return a;
}
const args = parseArgs(process.argv);
const quality = args.quality || 'preview';
const W = Number(args.w || 1664), H = Number(args.h || 928);
const timeoutMs = Number(args.timeout || 900) * 1000;
const WM = args.wm === undefined ? !args.test : String(args.wm) !== '0';

// shot list (pure data module, importable in node) → reference image per shot for the compare
const { SHOTS } = await import(pathToFileURL(path.join(ROOT, 'src/world/shots.js')).href);
const refFor = (id) => { const s = SHOTS.find((x) => String(x.id) === String(id)); return s?.ref ? path.join(ROOT, s.ref) : null; };

// ---------------------------------------------------------------- GPU lock
const LOCK_SLOTS = Number(process.env.GPU_SLOTS || 4);
let LOCK = path.join(OUT, '.gpu.lock.0');
const LOCK_STALE_MS = 20 * 60 * 1000;
async function acquireLock() {
  const t0 = Date.now();
  let warned = false;
  for (;;) {
    let gotIt = false;
    for (let s = 0; s < LOCK_SLOTS && !gotIt; s++) {
      const p = path.join(OUT, '.gpu.lock.' + s);
      try {
        const fd = fs.openSync(p, 'wx');
        fs.writeSync(fd, JSON.stringify({ pid: process.pid, time: Date.now(), args: process.argv.slice(2).join(' ') }));
        fs.closeSync(fd);
        LOCK = p; gotIt = true;
      } catch (e) {
        if (e.code !== 'EEXIST') throw e;
        try {
          const st = fs.statSync(p);
          let pidAlive = true;
          try { const info = JSON.parse(fs.readFileSync(p, 'utf8')); process.kill(info.pid, 0); } catch { pidAlive = false; }
          if (!pidAlive || Date.now() - st.mtimeMs > LOCK_STALE_MS) fs.rmSync(p, { force: true });
        } catch { /* raced */ }
      }
    }
    if (gotIt) return;
    {
      if (!warned) { console.log('[render] waiting for GPU lock...'); warned = true; }
      if (Date.now() - t0 > 60 * 60 * 1000) throw new Error('GPU lock wait timeout');
      await new Promise((r) => setTimeout(r, 1500));
    }
  }
}
function releaseLock() {
  try {
    const info = JSON.parse(fs.readFileSync(LOCK, 'utf8'));
    if (info.pid === process.pid) fs.rmSync(LOCK, { force: true });
  } catch { /* ignore */ }
}
let activeBrowser = null;
process.on('exit', releaseLock);
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, async () => { releaseLock(); if (activeBrowser) await activeBrowser.cleanup(); process.exit(130); });

// ---------------------------------------------------------------- compare image
function writeCompare(refPng, renderPng, outPng) {
  if (!fs.existsSync(refPng)) return;
  try {
    execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-i', refPng, '-i', renderPng, '-filter_complex',
      '[0]scale=-2:540[a];[1]scale=-2:540[b];[a][b]hstack', outPng]);
  } catch (e) { console.log('[render] compare failed', e.message); }
}

// ---------------------------------------------------------------- main
async function main() {
  const server = await startServer(0);
  await acquireLock();
  sweepStaleProfiles();
  const browser = await launchChrome({ width: W, height: H, protocolTimeout: timeoutMs });
  activeBrowser = browser;
  const t0 = Date.now();
  try {
    const page = await browser.newPage();
    page.on('console', (m) => {
      const t = m.text();
      if (t.includes('[vite]')) return;
      console.log(`[page:${m.type()}] ${t}`);
    });
    page.on('pageerror', (e) => console.log('[page:error]', e.message, e.stack || ''));
    page.on('requestfailed', (r) => console.log('[page:reqfail]', r.url(), r.failure()?.errorText));

    const qs = new URLSearchParams(args.params || '');
    qs.set('quality', quality);
    qs.set('w', String(W)); qs.set('h', String(H));
    qs.set('mode', 'still');
    if (args.spp) qs.set('spp', String(args.spp));

    let jobs = [];
    if (args.test) {
      qs.set('test', args.test);
      if (args.view !== undefined) qs.set('view', String(args.view));
      const out = args.out ? path.resolve(args.out) : path.join(OUT, `test_${args.test}${args.view !== undefined ? '_v' + args.view : ''}.png`);
      jobs.push({ kind: 'test', out });
    } else {
      let ids = String(args.shot || '1');
      if (ids === 'all') ids = SHOTS.map((s) => s.id).join(',');
      for (const id of ids.split(',')) {
        const out = args.out && !ids.includes(',') ? path.resolve(args.out) : args.outdir ? path.resolve(args.outdir, `shot${id}.png`) : path.join(OUT, `shot${id}.png`);
        jobs.push({ kind: 'shot', id, out });
      }
      qs.set('shot', jobs[0].id);
    }

    const url = `http://127.0.0.1:${server.port}/index.html?${qs.toString()}`;
    console.log('[render] loading', url);
    await page.goto(url, { waitUntil: 'load', timeout: timeoutMs });
    await page.waitForFunction('window.__READY === true || !!window.__RENDER_ERROR', { timeout: timeoutMs, polling: 250 });
    const err0 = await page.evaluate(() => window.__RENDER_ERROR || null);
    if (err0) throw new Error('page error: ' + err0);
    const gpu = await page.evaluate(() => window.__GPU_INFO || '?');
    console.log('[render] GPU:', gpu, `| build ${((Date.now() - t0) / 1000).toFixed(1)}s`);

    for (const job of jobs) {
      const t1 = Date.now();
      const dataUrl = await page.evaluate(async (job, wm) => {
        const url = job.kind === 'shot' ? await window.__renderShot(job.id) : await window.__renderTest();
        if (!wm || !url) return url;
        const m = await import('/src/explore/watermark.js');
        return await m.stampDataURL(url, { night: !!window.engine?.registry?.night });
      }, job, WM);
      if (!dataUrl || !dataUrl.startsWith('data:image/png')) throw new Error('no image returned for ' + JSON.stringify(job));
      fs.mkdirSync(path.dirname(job.out), { recursive: true });
      fs.writeFileSync(job.out, Buffer.from(dataUrl.split(',')[1], 'base64'));
      console.log(`[render] wrote ${path.relative(ROOT, job.out)} in ${((Date.now() - t1) / 1000).toFixed(1)}s`);
      if (job.kind === 'shot' && !args.nocompare) {
        const cmp = job.out.replace(/\.png$/i, '_cmp.png');
        const ref = refFor(job.id);
        if (ref) writeCompare(ref, job.out, cmp);
        if (fs.existsSync(cmp)) console.log(`[render] compare ${path.relative(ROOT, cmp)}`);
      }
    }
    const stats = await page.evaluate(() => window.__STATS || null);
    if (stats) console.log('[render] stats', JSON.stringify(stats));
  } finally {
    const tc = Date.now();
    await browser.cleanup();
    activeBrowser = null;
    console.log('[render] browser closed in', ((Date.now() - tc) / 1000).toFixed(1) + 's');
    await server.close();
    releaseLock();
    console.log(`[render] total ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  }
}

main().catch((e) => { console.error('[render] FAILED:', e.message); releaseLock(); process.exit(1); });
