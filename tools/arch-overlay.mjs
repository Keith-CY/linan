// Silhouette check of buildings against a reference: renders the shot's camera with only the given buildings /
// pagodas (?only=yingzao,pagodas&ids=…), once lit and once flat magenta (?bldMask=1) for the mask, and draws the mask's outline on the reference, plus a crop triple (ref | ref + outline | our render).
//
//   node tools/arch-overlay.mjs --shot 2 --ids su-ting [--render out/arch/photo/shot2.png] [--box x,y,w,h]
//        [--out out/arch/shot2_overlay.png] [--params "season=winter"]
//
// The outline is red; the crop box defaults to the mask's bounding box plus a margin.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { PNG } from 'pngjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = {};
for (let i = 2; i < process.argv.length; i++) {
  const k = process.argv[i]; if (!k.startsWith('--')) continue;
  const n = process.argv[i + 1]; if (n === undefined || n.startsWith('--')) args[k.slice(2)] = true; else { args[k.slice(2)] = n; i++; }
}
const shot = String(args.shot || 1);
const ids = String(args.ids || '');
const { SHOTS } = await import(pathToFileURL(path.join(ROOT, 'src/world/shots.js')).href);
const S = SHOTS.find((x) => String(x.id) === shot);
const ref = path.join(ROOT, S.ref);
const tmp = path.join(ROOT, 'out/arch/tmp');
fs.mkdirSync(tmp, { recursive: true });
const out = path.resolve(ROOT, args.out || `out/arch/shot${shot}_overlay.png`);
const extra = args.params ? '&' + args.params : '';

function render(params, file) {
  execFileSync('node', [path.join(ROOT, 'tools/render.mjs'), '--shot', shot, '--params', params, '--out', file, '--nocompare'], { cwd: ROOT, stdio: ['ignore', 'ignore', 'inherit'] });
}
const A = path.join(tmp, `s${shot}_bld.png`), M = path.join(tmp, `s${shot}_mask.png`);
if (!args.reuse) {
  render(`only=yingzao,pagodas&ids=${ids}&yzAo=0${extra}`, A);
  render(`only=yingzao,pagodas&ids=${ids}&yzAo=0&bldMask=1${extra}`, M);
}
const a = PNG.sync.read(fs.readFileSync(M));
const r = PNG.sync.read(/\.png$/i.test(ref) ? fs.readFileSync(ref) : execFileSync('ffmpeg', ['-loglevel', 'error', '-i', ref, '-f', 'image2pipe', '-vcodec', 'png', '-'], { maxBuffer: 1 << 28 }));   // the references are JPEG
const W = a.width, H = a.height;
const mask = new Uint8Array(W * H);
for (let i = 0; i < W * H; i++) {
  const R = a.data[i * 4], G = a.data[i * 4 + 1], B = a.data[i * 4 + 2];
  mask[i] = R > 18 && B > 18 && R > 1.5 * G + 4 && B > 1.5 * G + 4 ? 1 : 0;   // flat magenta (?bldMask=1), dimmed by the exposure
}
// drop specks: keep pixels with >= 3 mask neighbours in a 3x3
const m2 = new Uint8Array(W * H);
let x0 = W, y0 = H, x1 = 0, y1 = 0;
for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
  const i = y * W + x; if (!mask[i]) continue;
  let n = 0; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) n += mask[i + dy * W + dx];
  if (n >= 4) { m2[i] = 1; x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
}
const over = new PNG({ width: W, height: H });
r.data.copy(over.data);
for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
  const i = y * W + x; if (!m2[i]) continue;
  if (m2[i - 1] && m2[i + 1] && m2[i - W] && m2[i + W]) continue;
  for (let dy = 0; dy <= 1; dy++) for (let dx = 0; dx <= 1; dx++) { const j = (i + dy * W + dx) * 4; over.data[j] = 255; over.data[j + 1] = 30; over.data[j + 2] = 30; }
}
const ovFile = path.join(tmp, `s${shot}_over.png`);
fs.writeFileSync(ovFile, PNG.sync.write(over));
let box;
if (args.box) box = String(args.box).split(',').map(Number);
else {
  const mx = Math.round((x1 - x0) * 0.12 + 10), my = Math.round((y1 - y0) * 0.12 + 10);
  box = [Math.max(0, x0 - mx), Math.max(0, y0 - my), 0, 0];
  box[2] = Math.min(W, x1 + mx) - box[0]; box[3] = Math.min(H, y1 + my) - box[1];
}
const rend = args.render ? path.resolve(ROOT, args.render) : A;
const [bx, by, bw, bh] = box.map((v) => Math.round(v / 2) * 2);
const ch = 460, cw = Math.round((bw * ch) / bh / 2) * 2;
const crop = `crop=${bw}:${bh}:${bx}:${by},scale=${cw}:${ch}`;
const fullW = Math.max(3 * cw + 16, 1200);
execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-i', ovFile, '-i', ref, '-i', rend,
  '-filter_complex',
  `[0]split[o1][o2];[o1]scale=${fullW}:-2[top];[1]${crop},pad=${cw + 8}:${ch}:0:0:white[c1];[o2]${crop},pad=${cw + 8}:${ch}:0:0:white[c2];[2]${crop}[c3];` +
  `[c1][c2][c3]hstack=3,pad=${fullW}:${ch + 8}:0:8:white[bot];[top][bot]vstack`, out]);
console.log(`wrote ${path.relative(ROOT, out)}  mask bbox ${x0},${y0}–${x1},${y1}  crop ${box.join(',')}`);
