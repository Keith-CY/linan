// Crop helpers for close visual comparison.
//   node tools/crop.mjs <in.png> <x> <y> <w> <h> <out.png> [scale=2]
//   node tools/crop.mjs --cmp <shotId> <x> <y> <w> <h> [out.png]   (same region of the shot's reference and out/shot<id>.png side by side)
// Coordinates are in pixels of a 1664x928 frame (the reference size); renders of other sizes are scaled to it first.
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const a = process.argv.slice(2);
const ff = (args) => execFileSync('ffmpeg', ['-loglevel', 'error', '-y', ...args]);
const { SHOTS } = await import(pathToFileURL(path.join(ROOT, 'src/world/shots.js')).href);

if (a[0] === '--cmp') {
  const [, id, x, y, w, h, outArg] = a;
  const out = outArg || path.join(ROOT, 'out', `crop${id}_${x}_${y}.png`);
  const shot = SHOTS.find((x) => String(x.id) === String(id));
  if (!shot?.ref) throw new Error('shot ' + id + ' has no reference image');
  const ref = path.join(ROOT, shot.ref), ren = path.join(ROOT, 'out', `shot${id}.png`);
  const sc = Math.max(1, Math.round(700 / Math.max(w, h) * 10) / 10);
  const f = `scale=1664:928,crop=${w}:${h}:${x}:${y},scale=iw*${sc}:ih*${sc}:flags=lanczos`;
  ff(['-i', ref, '-i', ren, '-filter_complex', `[0]${f}[a];[1]${f}[b];[a][b]hstack`, out]);
  console.log('wrote', path.relative(ROOT, out));
} else {
  const [inp, x, y, w, h, out, scale = 2] = a;
  ff(['-i', inp, '-vf', `crop=${w}:${h}:${x}:${y},scale=iw*${scale}:ih*${scale}:flags=lanczos`, out]);
  console.log('wrote', out);
}
