// Bake heavy procedural geometry to generated/ (see src/core/cache.js).
//   node tools/bake.mjs <name>   → imports src/bake/<name>.js, calls its bake(), writes every geometry
//                                  that went through loadOrBuild() during that call, as <key>.bin (floats, as built:
//                                  the offline stills) and <key>.geo (compact, gzipped: the explorable page), then
//                                  rewrites generated/manifest.json
//   node tools/bake.mjs compact  → <key>.geo for every current bake (src/bake/*.js bakeNames()) from its .bin, and the
//                                  manifest (no meshing: after a format change, or for bakes made before .geo existed)
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const GEN = path.join(ROOT, 'generated');
const BAKES = ['karst', 'rocks'];          // the bake modules whose names the manifest lists
const name = process.argv[2];
if (!name) { console.log('usage: node tools/bake.mjs <name> | compact'); process.exit(1); }
const { serializeGeometry, deserializeGeometry, bakeRegistry } = await import(pathToFileURL(path.join(ROOT, 'src/core/cache.js')).href);
const { encodeGeo } = await import(pathToFileURL(path.join(ROOT, 'src/core/bakefmt.js')).href);
fs.mkdirSync(GEN, { recursive: true });

/** the compact, gzipped form of a geometry (position, normal, 8-bit extra attributes, index) */
function compact(geo) {
  const A = geo.attributes;
  const extra = Object.entries(A).filter(([k]) => k !== 'position' && k !== 'normal').map(([k, a]) => {
    if (!(a.array instanceof Uint8Array)) throw new Error(`compact bakes keep 8-bit extra attributes only (${k}: ${a.array.constructor.name})`);
    return { name: k, array: a.array, itemSize: a.itemSize, normalized: a.normalized };
  });
  const raw = encodeGeo({ position: A.position.array, normal: A.normal?.array || null, extra, index: geo.index.array });
  return zlib.gzipSync(raw, { level: 9 });
}
function writeGeo(key, geo) {
  const gz = compact(geo);
  fs.writeFileSync(path.join(GEN, `${key}.geo`), gz);
  return gz.length;
}

async function writeManifest() {
  const bakes = {};
  for (const b of BAKES) {
    const mod = await import(pathToFileURL(path.join(ROOT, 'src/bake', `${b}.js`)).href);
    for (const key of mod.bakeNames()) {
      const file = path.join(GEN, `${key}.geo`);
      if (!fs.existsSync(file)) { console.log(`[bake] manifest: ${key} has no .geo (node tools/bake.mjs ${b}, or compact)`); continue; }
      const bin = path.join(GEN, `${key}.bin`);
      let box = null, n = 0, tris = 0;
      if (fs.existsSync(bin)) {
        const b8 = fs.readFileSync(bin);
        const g = deserializeGeometry(b8.buffer.slice(b8.byteOffset, b8.byteOffset + b8.byteLength));
        const bb = g.boundingBox; box = [bb.min.x, bb.min.y, bb.min.z, bb.max.x, bb.max.y, bb.max.z].map((v) => +v.toFixed(4));
        n = g.attributes.position.count; tris = g.index.count / 3;
      } else {
        const { decodeGeo } = await import(pathToFileURL(path.join(ROOT, 'src/core/bakefmt.js')).href);
        const d = decodeGeo(new Uint8Array(zlib.gunzipSync(fs.readFileSync(file))));
        box = d.box.map((v) => +v.toFixed(4)); n = d.n; tris = d.index.length / 3;
      }
      bakes[key] = { file: `${key}.geo`, bytes: fs.statSync(file).size, n, tris, box };
    }
  }
  fs.writeFileSync(path.join(GEN, 'manifest.json'), JSON.stringify({ format: 2, bakes }, null, 1));
  const tot = Object.values(bakes).reduce((s, b) => s + b.bytes, 0);
  console.log(`[bake] manifest: ${Object.keys(bakes).length} bakes, ${(tot / 1048576).toFixed(1)} MiB compact`);
}

const t0 = Date.now();
if (name === 'compact') {
  for (const b of BAKES) {
    const mod = await import(pathToFileURL(path.join(ROOT, 'src/bake', `${b}.js`)).href);
    for (const key of mod.bakeNames()) {
      const bin = path.join(GEN, `${key}.bin`), geoF = path.join(GEN, `${key}.geo`);
      if (!fs.existsSync(bin)) { console.log(`[bake] ${key}: no .bin (node tools/bake.mjs ${b})`); continue; }
      if (fs.existsSync(geoF) && fs.statSync(geoF).mtimeMs >= fs.statSync(bin).mtimeMs && !process.env.FORCE) continue;
      const b8 = fs.readFileSync(bin);
      const bytes = writeGeo(key, deserializeGeometry(b8.buffer.slice(b8.byteOffset, b8.byteOffset + b8.byteLength)));
      console.log(`[bake] ${key}.geo: ${(b8.length / 1048576).toFixed(1)} → ${(bytes / 1048576).toFixed(2)} MiB`);
    }
  }
} else {
  const mod = await import(pathToFileURL(path.join(ROOT, 'src/bake', `${name}.js`)).href);
  const results = await mod.bake();
  // bake() may return { name: geometry } or rely on loadOrBuild registrations
  const entries = results && typeof results === 'object' ? Object.entries(results) : [];
  for (const [key, geo] of bakeRegistry) {
    if (!entries.find(([k]) => k === key)) entries.push([key, geo]);
  }
  for (const [key, geo] of entries) {
    const buf = Buffer.from(serializeGeometry(geo));
    fs.writeFileSync(path.join(GEN, `${key}.bin`), buf);
    const gz = writeGeo(key, geo);
    console.log(`[bake] ${key}: ${(buf.length / 1e6).toFixed(1)} MB (.geo ${(gz / 1e6).toFixed(1)} MB), ${geo.attributes.position.count} verts`);
  }
}
await writeManifest();
console.log(`[bake] done in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
