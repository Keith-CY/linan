// Geometry baking cache. Heavy procedural geometry (hi-res statues, sculpted rocks…) can be
// generated once by node and stored in /generated, then loaded instantly at runtime.
//
//   // in a module (works in browser AND node):
//   import { loadOrBuild } from '../core/cache.js';
//   const geo = await loadOrBuild('athena-A-v3', () => buildAthenaGeometry({ cell: 0.04 }));
//
//   // bake from the command line (runs the same build functions in node and writes generated/*.bin):
//   node tools/bake.mjs statues        → imports src/bake/statues.js and runs its bake()
//
// Bump the name/version string whenever the generator changes, otherwise a stale bake is used.
// If the file is missing, loadOrBuild just builds at runtime (slower, still correct).
//
// Two formats: generated/<name>.bin (float positions and normals, as built: what the offline stills read) and the
// compact generated/<name>.geo (src/core/bakefmt.js: quantised and gzipped, ~1/4.5 of the size: what the explorable
// page downloads), listed in generated/manifest.json (tools/bake.mjs writes all three). The explorable world asks for
// the compact one first (useCompactBakes()) and may load it lazily (lazyBake: a placeholder with the bake's bounds
// now, the geometry when load() is called; src/explore/lazy.js decides when).
import * as THREE from 'three';

const isNode = typeof window === 'undefined';
const GEN = isNode ? null : new URL('../../generated/', import.meta.url);
let compactFirst = false;
let manifestP = null;

/** the explorable world: compact bakes first */
export function useCompactBakes(on = true) { compactFirst = on; }

/** generated/manifest.json (null when there is none) */
export function bakeManifest() {
  if (isNode) return Promise.resolve(null);
  return (manifestP ||= fetch(new URL('manifest.json', GEN)).then((r) => (r.ok ? r.json() : null)).catch(() => null));
}

/** a compact bake decoded in the height workers into geo (a new geometry when none is given), or null */
async function loadCompact(name, geo = null) {
  const M = await bakeManifest();
  const e = M?.bakes?.[name];
  if (!e) return null;
  const { getHeightPool } = await import('../explore/heightpool.js');
  const r = await getHeightPool().bake(new URL(e.file, GEN).href);
  const g = geo || new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(r.position, 3));
  if (r.normal) g.setAttribute('normal', new THREE.BufferAttribute(r.normal, 3));
  for (const x of r.extra) g.setAttribute(x.name, new THREE.BufferAttribute(x.array, x.itemSize, x.normalized));
  g.setIndex(new THREE.BufferAttribute(r.index, 1));
  g.setDrawRange(0, Infinity);
  g.computeBoundingBox(); g.computeBoundingSphere();
  return g;
}

/**
 * explore: the bake as a placeholder now (no vertices; its bounds from the manifest, so culling and the shadow range
 * work) and { load() } that fills that same geometry in (once); without a compact bake, the geometry itself
 * (loadOrBuild) and lazy null.
 */
export async function lazyBake(name, build) {
  const M = await bakeManifest();
  const e = M?.bakes?.[name];
  if (!e) return { geo: await loadOrBuild(name, build), lazy: null };
  const geo = new THREE.BufferGeometry();
  geo.name = name;
  const b = e.box;
  geo.boundingBox = new THREE.Box3(new THREE.Vector3(b[0], b[1], b[2]), new THREE.Vector3(b[3], b[4], b[5]));
  geo.boundingSphere = geo.boundingBox.getBoundingSphere(new THREE.Sphere());
  let p = null;
  const lazy = {
    name, geo, bytes: e.bytes, ready: false, onReady: null,
    load: () => (p ||= loadCompact(name, geo).then(() => { lazy.ready = true; lazy.onReady?.(geo); return geo; })),
  };
  geo.userData.lazy = lazy;
  return { geo, lazy };
}

export function serializeGeometry(geo) {
  const attrs = Object.entries(geo.attributes);
  const header = { attrs: [], index: null };
  const chunks = [];
  let offset = 0;
  const push = (arr) => { const pad = (4 - (offset % 4)) % 4; if (pad) { chunks.push(new Uint8Array(pad)); offset += pad; } const o = offset; chunks.push(new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength)); offset += arr.byteLength; return o; };
  for (const [name, a] of attrs) {
    header.attrs.push({ name, itemSize: a.itemSize, normalized: a.normalized, type: a.array.constructor.name, count: a.array.length, offset: push(a.array) });
  }
  if (geo.index) header.index = { type: geo.index.array.constructor.name, count: geo.index.array.length, offset: push(geo.index.array) };
  const hjson = new TextEncoder().encode(JSON.stringify(header));
  const out = new Uint8Array(8 + hjson.length + offset + 8);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, 0x47454f31); dv.setUint32(4, hjson.length);
  out.set(hjson, 8);
  let base = 8 + hjson.length; base += (4 - (base % 4)) % 4;
  let o = base;
  for (const c of chunks) { out.set(c, o); o += c.byteLength; }
  dv.setUint32(4, hjson.length);
  return out.slice(0, o).buffer;
}

export function deserializeGeometry(buf) {
  const dv = new DataView(buf);
  if (dv.getUint32(0) !== 0x47454f31) throw new Error('bad geometry blob');
  const hlen = dv.getUint32(4);
  const header = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 8, hlen)));
  let base = 8 + hlen; base += (4 - (base % 4)) % 4;
  const T = { Float32Array, Uint32Array, Uint16Array, Int16Array, Int8Array, Uint8Array, Int32Array };
  const geo = new THREE.BufferGeometry();
  for (const a of header.attrs) {
    const C = T[a.type];
    const arr = new C(buf.slice(base + a.offset, base + a.offset + a.count * C.BYTES_PER_ELEMENT));
    geo.setAttribute(a.name, new THREE.BufferAttribute(arr, a.itemSize, a.normalized));
  }
  if (header.index) {
    const C = T[header.index.type];
    geo.setIndex(new THREE.BufferAttribute(new C(buf.slice(base + header.index.offset, base + header.index.offset + header.index.count * C.BYTES_PER_ELEMENT)), 1));
  }
  geo.computeBoundingBox(); geo.computeBoundingSphere();
  return geo;
}

/** geometries built while baking (node only): name → BufferGeometry */
export const bakeRegistry = new Map();

export async function loadOrBuild(name, build) {
  if (isNode) { const g = await build(); bakeRegistry.set(name, g); return g; }
  if (compactFirst) { const g = await loadCompact(name); if (g) return g; }
  try {
    const res = await fetch(new URL(`${name}.bin`, GEN));
    if (res.ok) return deserializeGeometry(await res.arrayBuffer());
  } catch { /* fall through */ }
  if (!compactFirst) { const g = await loadCompact(name).catch(() => null); if (g) return g; }
  console.log(`[cache] ${name} not baked, building at runtime`);
  return build();
}
