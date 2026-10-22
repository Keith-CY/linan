// Compact geometry: what the builders hand to the GPU, held once.
//
//   weldMesh(mesh)              the mesh's triangle soup welded into an indexed geometry (src/core/weld.js: exact, the
//                               mesh draws the same pixels); inside beginWelds() … await endWelds() the welding runs in
//                               the height workers while the build goes on, otherwise at once
//   releaseOnUpload(root)       explorable world: the CPU copies of the static geometry under root are dropped once the
//                               renderer has uploaded them (three.js keeps every attribute array otherwise: the JS heap
//                               held the world's geometry a second time, ~3 GB)
//   uploadNow(engine, roots)    upload the geometry under roots now (hidden levels of detail included), one draw each
//                               into a 1×1 target, so their CPU copies go at load rather than on first sight
import * as THREE from 'three';
import { weld } from './weld.js';

let batch = null;
let poolP = null;
const pool = () => (poolP ||= import('../explore/heightpool.js').then((m) => m.getHeightPool()));

/** welds from here on go to the height workers (world build) */
export function beginWelds() { batch ||= { jobs: [], verts: 0, kept: 0, t0: performance.now() }; }

/** wait for the welds since beginWelds(); later welds run at once */
export async function endWelds() {
  const b = batch;
  batch = null;
  if (!b) return null;
  await Promise.all(b.jobs);
  const info = { meshes: b.jobs.length, verts: b.verts, kept: b.kept, ms: Math.round(performance.now() - b.t0) };
  if (b.jobs.length) console.log(`[compact] welded ${info.meshes} meshes: ${(b.verts / 1e6).toFixed(2)} M vertices → ${(b.kept / 1e6).toFixed(2)} M (${Math.round((100 * b.kept) / Math.max(1, b.verts))} %)`);
  return info;
}

/** replace mesh.geometry (non-indexed, float attributes, position first) by its welded, indexed copy */
export function weldMesh(mesh) {
  const g = mesh.geometry;
  if (!g || g.index || !g.attributes.position || g.morphAttributes?.position) return;
  const names = ['position', ...Object.keys(g.attributes).filter((k) => k !== 'position')];
  const attrs = names.map((k) => g.attributes[k]);
  if (attrs.some((a) => a.isInterleavedBufferAttribute || !(a.array instanceof Float32Array))) return;
  const n = attrs[0].count;
  if (n < 6) return;
  if (!g.boundingBox) g.computeBoundingBox();
  if (!g.boundingSphere) g.computeBoundingSphere();
  const sizes = attrs.map((a) => a.itemSize), normalized = attrs.map((a) => a.normalized);
  const apply = (r) => {
    const w = new THREE.BufferGeometry();
    names.forEach((k, i) => w.setAttribute(k, new THREE.BufferAttribute(r.arrays[i], sizes[i], normalized[i])));
    w.setIndex(new THREE.BufferAttribute(r.index, 1));
    w.boundingBox = g.boundingBox; w.boundingSphere = g.boundingSphere;
    w.name = g.name; w.userData = g.userData;
    for (const gr of g.groups) w.addGroup(gr.start, gr.count, gr.materialIndex);
    mesh.geometry = w;
    if (batch) { batch.verts += n; batch.kept += r.m; }
  };
  const arrays = attrs.map((a) => a.array);
  if (batch) {
    batch.jobs.push(pool().then((p) => (p.size ? p.weld(n, arrays, sizes) : weld(n, arrays.map((a, i) => [a, sizes[i]])))).then(apply));
  } else apply(weld(n, arrays.map((a, i) => [a, sizes[i]])));
}

const EMPTY = new Float32Array(0);
function dropArray() { this.array = this.array.constructor === Float32Array ? EMPTY : new this.array.constructor(0); }

/** drop the CPU copies of the geometry under root once uploaded (static geometry only: never set needsUpdate on it
 *  again). Bounding volumes are computed first (culling and shadow ranges read them). Instance matrices, batched
 *  meshes and geometry marked userData.keepArrays are left alone. */
export function releaseOnUpload(root) {
  let n = 0;
  root.traverse((o) => {
    const g = o.geometry;
    if (!g || o.isBatchedMesh || g.userData.keepArrays || g.userData.released) return;
    if (!g.attributes.position || g.attributes.position.array.length === 0) return;
    if (!g.boundingBox) g.computeBoundingBox();
    if (!g.boundingSphere) g.computeBoundingSphere();
    if (o.isInstancedMesh && !o.boundingSphere) o.computeBoundingSphere();
    for (const k in g.attributes) { const a = g.attributes[k]; if (!a.isInterleavedBufferAttribute && a.usage === THREE.StaticDrawUsage) a.onUpload(dropArray); }
    if (g.index) g.index.onUpload(dropArray);
    g.userData.released = true;
    n++;
  });
  return n;
}

let upMat = null, upRT = null;
/** draw every mesh geometry under roots (visible or not) and the extra geometries once into a 1×1 target: uploads
 *  their buffers now */
export function uploadNow(engine, roots, extra = []) {
  const r = engine.renderer;
  upMat ||= new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false, depthTest: false });
  upRT ||= new THREE.WebGLRenderTarget(1, 1, { depthBuffer: false });
  const scene = new THREE.Scene();
  const seen = new Set();
  const add = (g) => {
    if (!g?.isBufferGeometry || seen.has(g) || !g.attributes.position?.count || g.attributes.position.array.length === 0) return;
    seen.add(g);
    const m = new THREE.Mesh(g, upMat);
    m.frustumCulled = false; m.matrixAutoUpdate = false;
    scene.add(m);
  };
  for (const root of roots) root.traverse((o) => { if ((o.isMesh || o.isInstancedMesh) && !o.isBatchedMesh) add(o.geometry); });
  for (const g of extra) add(g);
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const prev = r.getRenderTarget(), auto = r.shadowMap.autoUpdate;
  r.shadowMap.autoUpdate = false;
  r.setRenderTarget(upRT);
  r.render(scene, cam);
  r.setRenderTarget(prev);
  r.shadowMap.autoUpdate = auto;
  scene.clear();
  return seen.size;
}
