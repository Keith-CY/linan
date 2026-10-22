// Walking screenshots of the explorable world in a running explore session (tools/explore-session.mjs): at each place
// the walker is set down (a viewpoint by its number, or a pose by name from PLACES below), walks forward a moment so
// the frame is the live walking painting (not the still view), and the canvas is saved; then a labelled contact sheet.
//
//   node tools/explore-walk.mjs [--port 9481] [--places 2,10,7,8,liuhe,palace,paddy,tea] [--walk 1.2] [--look N]
//                               [--out out/explore/walk] [--sheet out/explore/walk_sheet.png]
// → <out>/<place>.png and the sheet (2 columns, 720 px wide frames)
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = {};
for (let i = 2; i < process.argv.length; i++) { const k = process.argv[i]; if (k.startsWith('--')) { args[k.slice(2)] = process.argv[i + 1]; i++; } }
const PORT = Number(args.port || 9481);
const WALK = Number(args.walk ?? 1.2);
const OUT = path.resolve(ROOT, args.out || 'out/explore/walk');
const SHEET = path.resolve(ROOT, args.sheet || 'out/explore/walk_sheet.png');
fs.mkdirSync(OUT, { recursive: true });

// viewpoints by number (teleport, then walk); named poses: [x, z] on the ground, [x, z] to look at, the look (time and
// season, src/world/looks.js) to show it in
const NAMES = { 1: '宝石山', 2: '苏堤', 3: '曲院风荷', 4: '雷峰', 5: '三潭', 6: '皇城', 7: '御街', 8: '飞来峰', 9: '六和塔', 10: '断桥' };
const PLACES = {
  liuhe: { name: '六和塔 · from the harbour', at: [-1418, 4968], to: [-1558, 4880], look: 9, walk: 0.4 },
  palace: { name: '皇城 · the palace terraces', at: [1640, 2205], to: [1690, 2250], look: 6, walk: 0.3 },
  paddy: { name: '水田 · paddies by a hamlet', at: [-140, -3118], to: [-104, -3228], look: 2, walk: 0.3 },
  tea: { name: '龍井 · tea terraces', at: [-2450.07, 2450.23], to: [-2470, 2490], look: 2, walk: 0.05 },
};
const places = String(args.places || '2,10,7,8,liuhe,palace,paddy,tea').split(',').map((p) => (/^\d+$/.test(p) ? Number(p) : p));

const call = async (ep, body) => {
  const r = await fetch(`http://127.0.0.1:${PORT}/${ep}`, { method: 'POST', body: JSON.stringify(body || {}) });
  const j = await r.json();
  if (j.error) throw new Error(j.error);
  return j;
};
const ev = async (expr) => (await call('eval', { expr })).value;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const settleTerrain = `(async () => { const st = window.engine.registry.terrain?.stream; const t0 = performance.now(); while (st && !(st.plan?.done) && performance.now() - t0 < 20000) await new Promise((r) => setTimeout(r, 50)); return true; })()`;

const shots = [];
await ev('window.__explore.noStill(true)');
for (const id of places) {
  let label, walk = WALK;
  if (typeof id === 'number') {
    label = `${id} · ${NAMES[id]}`;
    await ev(`(window.__explore.teleport(${id}), window.__explore.mode('walk'), true)`);
  } else {
    const P = PLACES[id];
    label = P.name; walk = P.walk ?? WALK;
    const [x, z] = P.at, [tx, tz] = P.to;
    const yaw = (Math.atan2(-(tx - x), -(tz - z)) * 180) / Math.PI;
    const look = Number(args.look) || P.look;
    if (look) await ev(`window.__explore.setLook(${look})`);
    await ev(`(window.__explore.mode('walk'), window.__explore.setPose([${x}, 0, ${z}], ${yaw}, -2))`);
  }
  if (args.look && typeof id === 'number') await ev(`window.__explore.setLook(${Number(args.look)})`);
  await ev(settleTerrain);
  await wait(600);
  // walk a moment (the live painting, the walking field of view), then let the streamed parts catch up
  await ev(`window.__explore.hold(['KeyW'], ${walk})`);
  await ev(settleTerrain);
  await wait(1500);
  await ev('window.__explore.settle()');
  const url = await ev('window.__explore.canvas()');
  const file = path.join(OUT, `${id}.png`);
  fs.writeFileSync(file, Buffer.from(url.split(',')[1], 'base64'));
  const st = await ev('window.__explore.stats()');
  console.log(`${String(id).padEnd(7)} ${label}  pos ${st.pos.join(' ')}  yaw ${st.yaw}`);
  shots.push([file, label]);
}
await ev('window.__explore.noStill(false)');

const PY = `
import sys, json
from PIL import Image, ImageDraw, ImageFont
a = json.loads(sys.argv[1])
def font(n):
  for f in ['/System/Library/Fonts/STHeiti Medium.ttc', '/System/Library/Fonts/Supplemental/Songti.ttc', '/System/Library/Fonts/Helvetica.ttc']:
    try: return ImageFont.truetype(f, n)
    except Exception: pass
  return ImageFont.load_default()
W = 720; cols = 2; ims = []
for p, t in a['in']:
  im = Image.open(p).convert('RGB'); im = im.resize((W, round(im.height * W / im.width)), Image.LANCZOS); ims.append((im, t))
h = ims[0][0].height; rows = (len(ims) + cols - 1) // cols
out = Image.new('RGB', (W * cols + 8 * (cols - 1), h * rows + 8 * (rows - 1)), (255, 255, 255))
d = ImageDraw.Draw(out); f = font(20)
for i, (im, t) in enumerate(ims):
  x = (i % cols) * (W + 8); y = (i // cols) * (h + 8); out.paste(im, (x, y))
  bb = d.textbbox((x + 12, y + 10), t, font=f); d.rectangle((bb[0] - 6, bb[1] - 4, bb[2] + 6, bb[3] + 4), fill=(242, 238, 228)); d.text((x + 12, y + 10), t, font=f, fill=(138, 28, 28))
out.save(a['out'])
`;
fs.mkdirSync(path.dirname(SHEET), { recursive: true });
execFileSync('python3', ['-I', '-c', PY, JSON.stringify({ in: shots, out: SHEET })]);
console.log('sheet', path.relative(ROOT, SHEET));
