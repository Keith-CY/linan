// Settled explore views against the offline ink stills: for each viewpoint, teleport in a running explore session
// (tools/explore-session.mjs, ideally --w 1664 --h 928: the stills' size), wait for the still view, save the canvas,
// and write a side-by-side with a difference image plus the mean difference.
//
//   node tools/explore-match.mjs [--port 9481] [--shots 1,2,…] [--ref out/ink/mo] [--out out/explore/match]
// → out/explore/match/shotN_live.png, shotN_pair.png (still | settled live | ×4 difference), contact.png, match.json
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = {};
for (let i = 2; i < process.argv.length; i++) { const k = process.argv[i]; if (k.startsWith('--')) { args[k.slice(2)] = process.argv[i + 1]; i++; } }
const PORT = Number(args.port || 9481);
const shots = String(args.shots || '1,2,3,4,5,6,7,8,9,10').split(',').map(Number);
const REF = path.resolve(ROOT, args.ref || 'out/ink/mo');
const OUT = path.resolve(ROOT, args.out || 'out/explore/match');
fs.mkdirSync(OUT, { recursive: true });

const call = async (ep, body) => {
  const r = await fetch(`http://127.0.0.1:${PORT}/${ep}`, { method: 'POST', body: JSON.stringify(body || {}) });
  const j = await r.json();
  if (j.error) throw new Error(j.error);
  return j;
};
const ev = async (expr) => (await call('eval', { expr })).value;

/** mean absolute difference (0..255) and the share of pixels off by more than 16 / 48; writes a ×4 difference image */
function diff(aPath, bPath, outPath) {
  const A = PNG.sync.read(fs.readFileSync(aPath)), B = PNG.sync.read(fs.readFileSync(bPath));
  if (A.width !== B.width || A.height !== B.height) throw new Error(`size ${A.width}x${A.height} vs ${B.width}x${B.height}`);
  const D = new PNG({ width: A.width, height: A.height });
  let sum = 0, n16 = 0, n48 = 0;
  const N = A.width * A.height;
  for (let i = 0; i < N; i++) {
    const o = i * 4;
    const d = (Math.abs(A.data[o] - B.data[o]) + Math.abs(A.data[o + 1] - B.data[o + 1]) + Math.abs(A.data[o + 2] - B.data[o + 2])) / 3;
    sum += d; if (d > 16) n16++; if (d > 48) n48++;
    const v = Math.max(0, 255 - Math.min(255, d * 4));
    D.data[o] = 255; D.data[o + 1] = v; D.data[o + 2] = v; D.data[o + 3] = 255;
  }
  fs.writeFileSync(outPath, PNG.sync.write(D));
  return { mean: +(sum / N).toFixed(2), over16: +((n16 / N) * 100).toFixed(2), over48: +((n48 / N) * 100).toFixed(2) };
}

// image composition in Python / PIL (this ffmpeg has no drawtext)
const PY = `
import sys, json
from PIL import Image, ImageDraw, ImageFont
a = json.loads(sys.argv[1])
def font(n):
  for f in ['/System/Library/Fonts/Supplemental/Arial.ttf', '/System/Library/Fonts/Helvetica.ttc']:
    try: return ImageFont.truetype(f, n)
    except Exception: pass
  return ImageFont.load_default()
if a['op'] == 'pair':
  ims = [Image.open(p).convert('RGB') for p in a['in']]
  w = 832; ims = [im.resize((w, round(im.height * w / im.width)), Image.LANCZOS) for im in ims]
  h = max(im.height for im in ims); out = Image.new('RGB', (w * len(ims), h), (255, 255, 255))
  d = ImageDraw.Draw(out); f = font(22)
  for i, (im, t) in enumerate(zip(ims, a['labels'])):
    out.paste(im, (i * w, 0)); bb = d.textbbox((i * w + 12, 10), t, font=f)
    d.rectangle((bb[0] - 6, bb[1] - 4, bb[2] + 6, bb[3] + 4), fill=(242, 238, 228)); d.text((i * w + 12, 10), t, font=f, fill=(138, 28, 28))
  out.save(a['out'])
else:
  ims = [Image.open(p).convert('RGB') for p in a['in']]
  w = 1248; ims = [im.resize((w, round(im.height * w / im.width)), Image.LANCZOS) for im in ims]
  out = Image.new('RGB', (w, sum(im.height for im in ims)), (255, 255, 255)); y = 0
  for im in ims: out.paste(im, (0, y)); y += im.height
  out.save(a['out'])
`;
const py = (o) => execFileSync('python3', ['-I', '-c', PY, JSON.stringify(o)]);
const pairImage = (inputs, labels, out) => py({ op: 'pair', in: inputs, labels, out });
const stack = (inputs, out) => py({ op: 'stack', in: inputs, out });

const rows = [];
for (const id of shots) {
  await ev(`window.__explore.teleport(${id})`);
  const st = await ev('window.__explore.still(90)');
  const url = await ev('window.__explore.canvas()');
  const live = path.join(OUT, `shot${id}_live.png`);
  fs.writeFileSync(live, Buffer.from(url.split(',')[1], 'base64'));
  const ref = path.join(REF, `shot${id}.png`);
  const dpath = path.join(OUT, `shot${id}_diff.png`);
  const d = diff(ref, live, dpath);
  const pair = path.join(OUT, `shot${id}_pair.png`);
  pairImage([ref, live, dpath], [`still ${id}`, `explore, settled ${id}`, `difference x4 · mean ${d.mean}/255`], pair);
  rows.push({ shot: id, ...d, still: st });
  console.log(`shot ${id}: mean ${d.mean}/255, >16: ${d.over16} %, >48: ${d.over48} %  (${JSON.stringify(st)})`);
}
fs.writeFileSync(path.join(OUT, 'match.json'), JSON.stringify(rows, null, 1));
const pairs = rows.map((r) => path.join(OUT, `shot${r.shot}_pair.png`));
stack(pairs, path.join(OUT, 'contact.png'));
console.log('contact', path.relative(ROOT, path.join(OUT, 'contact.png')));
