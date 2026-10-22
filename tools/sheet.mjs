// Contact sheet: node tools/sheet.mjs --out out/ink/contact-qj.png [--cols 2] [--w 832] [--gap 8] img1.png img2.png …
// Tiles the images row by row, each scaled to --w px wide, on a light grey ground (ffmpeg xstack).
import { execFileSync } from 'node:child_process';

const argv = process.argv.slice(2);
const opt = { cols: 2, w: 832, gap: 8, out: 'out/sheet.png' };
const files = [];
for (let i = 0; i < argv.length; i++) {
  if (argv[i].startsWith('--')) opt[argv[i].slice(2)] = argv[++i];
  else files.push(argv[i]);
}
if (!files.length) { console.error('no images'); process.exit(1); }
const cols = Number(opt.cols), w = Number(opt.w), gap = Number(opt.gap);
const h = Math.round((w * 928) / 1664 / 2) * 2;
const inputs = files.flatMap((f) => ['-i', f]);
let fc = files.map((_, i) => `[${i}]scale=${w}:${h},pad=${w + gap}:${h + gap}:${gap / 2}:${gap / 2}:color=0xe8e6e1[v${i}]`).join(';');
const layout = files.map((_, i) => `${(i % cols) * (w + gap)}_${Math.floor(i / cols) * (h + gap)}`).join('|');
fc += ';' + files.map((_, i) => `[v${i}]`).join('') + (files.length > 1 ? `xstack=inputs=${files.length}:layout=${layout}:fill=0xe8e6e1` : 'null');
execFileSync('ffmpeg', ['-loglevel', 'error', '-y', ...inputs, '-filter_complex', fc, opt.out]);
console.log('wrote', opt.out);
