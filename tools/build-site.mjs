// The static site: dist/ holds everything the page needs and nothing else, for any static host (Cloudflare Pages:
// every file under its 25 MiB limit; _headers sets the caching and the bakes' content type).
//
//   node tools/build-site.mjs [--out dist]
//
//   index.html                  the import map pointed inside dist (three/r<version>/…), every path relative
//   src/                        the page's modules (src/bake, node-only bake scripts, left out)
//   three/r<version>/           three.module.js, three.core.js and only the addons the page imports (and theirs)
//   generated/                  manifest.json and the compact bakes it lists (node tools/bake.mjs compact first)
//   _headers                    long cache for three and the bakes (their names carry versions), short for the rest
//
// Serve it with any static server (node tools/serve.mjs 8090 dist, or python3 -m http.server -d dist).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = {};
for (let i = 2; i < process.argv.length; i++) { const k = process.argv[i]; if (k.startsWith('--')) { args[k.slice(2)] = process.argv[i + 1]; i++; } }
const OUT = path.resolve(ROOT, args.out || 'dist');
const LIMIT = 20 * 1048576;
if (OUT === ROOT || !OUT.startsWith(ROOT + path.sep)) throw new Error('--out must be a folder inside the repository');

const three = JSON.parse(fs.readFileSync(path.join(ROOT, 'node_modules/three/package.json'), 'utf8'));
const TV = 'r' + three.version.split('.')[1];
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
const sizes = [];
const copy = (src, dst) => { fs.mkdirSync(path.dirname(dst), { recursive: true }); fs.copyFileSync(src, dst); sizes.push([path.relative(OUT, dst), fs.statSync(dst).size]); };

// ------------------------------------------------------------------ the page's modules
const SKIP = new Set(['bake']);
const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? (SKIP.has(d.name) && dir === path.join(ROOT, 'src') ? [] : walk(path.join(dir, d.name))) : [path.join(dir, d.name)]));
const srcFiles = walk(path.join(ROOT, 'src')).filter((f) => f.endsWith('.js'));
for (const f of srcFiles) copy(f, path.join(OUT, path.relative(ROOT, f)));

// ------------------------------------------------------------------ three.js: the build and the addons in use
const specs = new Set();
const IMPORT = /(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)|import\s*['"]([^'"]+)['"]/g;
for (const f of srcFiles) for (const m of fs.readFileSync(f, 'utf8').matchAll(IMPORT)) { const s = m[1] || m[2] || m[3]; if (s.startsWith('three/addons/')) specs.add(s); }
const JSM = path.join(ROOT, 'node_modules/three/examples/jsm');
const addons = new Set();
const follow = (file) => {
  if (addons.has(file)) return;
  addons.add(file);
  for (const m of fs.readFileSync(file, 'utf8').matchAll(IMPORT)) {
    const s = m[1] || m[2] || m[3];
    if (s.startsWith('.')) follow(path.resolve(path.dirname(file), s));
    else if (s.startsWith('three/addons/')) follow(path.join(JSM, s.slice('three/addons/'.length)));
  }
};
for (const s of specs) follow(path.join(JSM, s.slice('three/addons/'.length)));
const TDIR = path.join(OUT, 'three', TV);
for (const f of ['three.module.js', 'three.core.js']) copy(path.join(ROOT, 'node_modules/three/build', f), path.join(TDIR, f));
for (const f of addons) copy(f, path.join(TDIR, 'addons', path.relative(JSM, f)));
fs.copyFileSync(path.join(ROOT, 'node_modules/three/LICENSE'), path.join(TDIR, 'LICENSE'));

// ------------------------------------------------------------------ index.html with the import map inside dist
let html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const swap = (a, b) => { if (!html.includes(a)) throw new Error('index.html: no ' + a); html = html.replace(a, b); };
swap('"three": "/node_modules/three/build/three.module.js"', `"three": "./three/${TV}/three.module.js"`);
swap('"three/addons/": "/node_modules/three/examples/jsm/"', `"three/addons/": "./three/${TV}/addons/"`);
swap('<script type="module" src="/src/main.js"></script>', '<script type="module" src="./src/main.js"></script>');
if (/(src|href)="\/(?!\/)/.test(html)) throw new Error('index.html still has a root-absolute path');
fs.writeFileSync(path.join(OUT, 'index.html'), html);
sizes.push(['index.html', html.length]);

// ------------------------------------------------------------------ the compact bakes
const GEN = path.join(ROOT, 'generated');
const manifestFile = path.join(GEN, 'manifest.json');
if (!fs.existsSync(manifestFile)) throw new Error('generated/manifest.json is missing: node tools/bake.mjs karst && node tools/bake.mjs rocks (or compact)');
const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
for (const [name, b] of Object.entries(manifest.bakes)) {
  const f = path.join(GEN, b.file);
  if (!fs.existsSync(f)) throw new Error(`bake ${name}: ${b.file} is missing`);
  if (fs.statSync(f).size !== b.bytes) throw new Error(`bake ${name}: ${b.file} does not match the manifest (node tools/bake.mjs compact)`);
  copy(f, path.join(OUT, 'generated', b.file));
}
copy(manifestFile, path.join(OUT, 'generated', 'manifest.json'));

// ------------------------------------------------------------------ headers (Cloudflare Pages / Netlify syntax)
fs.writeFileSync(path.join(OUT, '_headers'), `# the bakes' and three.js's paths carry their versions: cached for a year
/generated/*
  Cache-Control: public, max-age=31536000, immutable
  Content-Type: application/octet-stream
  X-Content-Type-Options: nosniff
/generated/manifest.json
  ! Cache-Control
  ! Content-Type
  Cache-Control: public, max-age=0, must-revalidate
  Content-Type: application/json; charset=utf-8
/three/*
  Cache-Control: public, max-age=31536000, immutable
  Content-Type: text/javascript; charset=utf-8
/three/*/LICENSE
  ! Content-Type
  Content-Type: text/plain; charset=utf-8
# the page and its modules: revalidated on every load (an update shows at once)
/
  Cache-Control: public, max-age=0, must-revalidate
/index.html
  Cache-Control: public, max-age=0, must-revalidate
/src/*
  Cache-Control: public, max-age=0, must-revalidate
  Content-Type: text/javascript; charset=utf-8
`);

// ------------------------------------------------------------------ report
const over = sizes.filter(([, s]) => s > LIMIT);
if (over.length) throw new Error('over 20 MiB: ' + over.map(([f, s]) => `${f} ${(s / 1048576).toFixed(1)} MiB`).join(', '));
const sum = (pred) => sizes.filter(([f]) => pred(f)).reduce((a, [, s]) => a + s, 0) / 1048576;
const biggest = [...sizes].sort((a, b) => b[1] - a[1])[0];
console.log(`[site] ${path.relative(ROOT, OUT)}/: ${sizes.length} files, ${sum(() => true).toFixed(1)} MiB (page and modules ${sum((f) => !f.startsWith('generated')).toFixed(1)} MiB, bakes ${sum((f) => f.startsWith('generated')).toFixed(1)} MiB); largest ${biggest[0]} ${(biggest[1] / 1048576).toFixed(1)} MiB`);
console.log(`[site] three ${three.version} (${addons.size} addons: ${[...addons].map((f) => path.relative(JSM, f)).join(', ')})`);
