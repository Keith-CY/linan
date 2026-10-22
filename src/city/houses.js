// The houses of Lin'an by the ten thousand: shared kits per level of detail (src/yingzao/house.js), instanced.
//
//   placeHouses(engine, houses, { thresholds }) → { group, counts, tris, reflectHidden: [meshes] }
//
// LOD by the distance from the nearest shot camera that sees the house (src/city/lod.js):
//   < t0 (under the aerial camera, out of frame)  lod 1 (shadows / reflections only)
//   t0 … t1   lod 0  full kit (frames, shutters, lattice, eave tiles), 14 variants
//   t1 … t2   lod 1  ~0.5k triangles
//   t2 … t3   lod 2  massing with painted fronts, casts shadows
//   > t3      lod 3  a box with a gable roof (~20 triangles), no shadows, kept out of the water reflection
// Shadows of lod 0 / 1 come from invisible lod-2 stand-ins (depth only, sunk 0.25 m and shrunk 3 %, so they never
// shade the real roof): ~80 instead of ~5000 triangles per house in each shadow cascade.
import * as THREE from 'three';
import { houseKit } from '../yingzao/house.js';
import { farHouseMaterial } from './farmaterial.js';
import { hallMaterials } from '../yingzao/materials.js';
import { MeshBuilder, PAINT } from '../yingzao/geom.js';
import { hash01 } from '../core/rng.js';
import { viewDist } from './lod.js';

/** the variant table (same index = the same house at every LOD). Deep 歇山 plots turn their 山花 to the street. */
export const VARIANTS = [
  // 0-7: shops on 御街 (two storeys, 腰檐 over the shop front, banners)
  { storeys: 2, front: 'shop', pent: true, roof: 'xieshan', banner: true, width: 11.59, depth: 15.68, eave: 1.4, h1: 3.6, h2: 3.0 },
  { storeys: 2, front: 'open', pent: true, roof: 'xuanshan', banner: true, width: 9.15, depth: 14.56, eave: 1.15, h1: 3.6, h2: 3.0 },
  { storeys: 2, front: 'shop', pent: false, jetty: 0.55, roof: 'xuanshan', upper: 'balcony', banner: false, width: 12.81, depth: 15.12, eave: 1.3, h1: 3.6, h2: 3.0 },
  { storeys: 2, front: 'shop', pent: true, roof: 'xuanshan', upper: 'wall', banner: true, width: 14.64, depth: 15.68, eave: 1.35, h1: 3.6, h2: 3.0 },
  { storeys: 2, front: 'open', pent: true, roof: 'xieshan', ridge: 'width', upper: 'lattice', banner: false, width: 15.86, depth: 15.12, eave: 1.45, h1: 3.6, h2: 3.0 },
  { storeys: 2, front: 'shop', pent: false, roof: 'xieshan', upper: 'lattice', jetty: 0, banner: true, width: 10.37, depth: 14.56, eave: 1.15, h1: 3.6, h2: 3.0 },
  { storeys: 1, front: 'open', roof: 'xieshan', ridge: 'width', width: 13.42, depth: 13.44, h1: 4.2, pitch: 0.6, eave: 1.45, banner: true },
  { storeys: 2, front: 'shop', pent: true, roof: 'xuanshan', upper: 'lattice', banner: true, width: 7.93, depth: 13.44, eave: 1.15, h1: 3.6, h2: 3.0 },
  // 8-13: dwellings and workshops in the lanes
  { storeys: 1, front: 'house', roof: 'xuanshan', width: 7.93, depth: 11.2, eave: 1.15, h1: 3.6, h2: 3.0 },
  { storeys: 2, front: 'house', pent: false, roof: 'xuanshan', upper: 'wall', width: 9.15, depth: 11.76, eave: 1.15, h1: 3.6, h2: 3.0 },
  { storeys: 1, front: 'shop', roof: 'xieshan', width: 10.37, depth: 12.32, eave: 1.15, h1: 3.6, h2: 3.0 },
  { storeys: 2, front: 'house', pent: false, roof: 'xieshan', ridge: 'width', upper: 'lattice', width: 11.59, depth: 12.32, eave: 1.3, h1: 3.6, h2: 3.0 },
  { storeys: 1, front: 'house', roof: 'xuanshan', width: 10.98, depth: 10.64, eave: 1.2, h1: 3.6, h2: 3.0 },
  { storeys: 2, front: 'open', pent: true, roof: 'xuanshan', width: 9.76, depth: 12.32, eave: 1.15, h1: 3.6, h2: 3.0 },
  // 14-17: halls and big houses in the middle of the blocks
  { storeys: 1, front: 'open', roof: 'xieshan', ridge: 'width', width: 18.3, depth: 13.44, h1: 4.3, pitch: 0.62, eave: 1.6 },
  { storeys: 2, front: 'house', pent: false, roof: 'xieshan', ridge: 'width', upper: 'lattice', width: 15.86, depth: 13.44, eave: 1.5, h1: 3.6, h2: 3.0 },
  { storeys: 1, front: 'house', roof: 'xieshan', width: 14.64, depth: 15.68, h1: 4.2, pitch: 0.6, eave: 1.5 },
  { storeys: 2, front: 'shop', pent: true, roof: 'xieshan', ridge: 'width', upper: 'lattice', width: 15.25, depth: 15.12, eave: 1.4, h1: 3.6, h2: 3.0 },
  // ink07 (break up the grid): 18-21 tall shop-towers on 御街 (high floors, deep eaves, banners), 22-25
  // white-walled houses (a plastered upper storey, no shop front), 26-27 low sheds and workshops, 28-29 big lane houses
  { storeys: 2, front: 'shop', pent: true, roof: 'xieshan', ridge: 'width', upper: 'balcony', banner: true, width: 12.2, depth: 15.7, eave: 1.6, h1: 4.4, h2: 3.8, pitch: 0.66 },
  { storeys: 2, front: 'open', pent: true, roof: 'xuanshan', upper: 'lattice', banner: true, width: 10.4, depth: 15.1, eave: 1.5, h1: 4.2, h2: 3.6, pitch: 0.64 },
  { storeys: 2, front: 'shop', pent: false, jetty: 0.7, roof: 'xieshan', upper: 'lattice', banner: true, width: 14.0, depth: 15.7, eave: 1.5, h1: 4.0, h2: 3.4 },
  { storeys: 2, front: 'shop', pent: true, roof: 'xuanshan', upper: 'wall', banner: true, width: 8.5, depth: 14.6, eave: 1.2, h1: 4.0, h2: 3.2, pitch: 0.6 },
  { storeys: 2, front: 'house', pent: false, roof: 'xuanshan', upper: 'wall', width: 8.5, depth: 11.2, eave: 0.95, h1: 3.4, h2: 3.0, pitch: 0.56 },
  { storeys: 2, front: 'house', pent: false, roof: 'xieshan', upper: 'wall', width: 12.2, depth: 12.3, eave: 1.2, h1: 3.6, h2: 3.2 },
  { storeys: 1, front: 'house', roof: 'xuanshan', width: 9.8, depth: 9.5, eave: 0.9, h1: 3.2, pitch: 0.5 },
  { storeys: 2, front: 'house', pent: true, roof: 'xuanshan', upper: 'wall', width: 11.0, depth: 12.9, eave: 1.1, h1: 3.4, h2: 2.8, pitch: 0.58 },
  { storeys: 1, front: 'open', roof: 'xuanshan', width: 7.3, depth: 8.4, eave: 0.8, h1: 2.8, pitch: 0.46 },
  { storeys: 1, front: 'shop', roof: 'xuanshan', width: 12.8, depth: 9.0, eave: 1.0, h1: 3.0, pitch: 0.48, banner: true },
  { storeys: 2, front: 'house', pent: false, roof: 'xieshan', ridge: 'width', upper: 'balcony', width: 14.6, depth: 13.4, eave: 1.4, h1: 3.8, h2: 3.2 },
  { storeys: 2, front: 'open', pent: true, roof: 'xuanshan', upper: 'lattice', width: 13.4, depth: 12.3, eave: 1.3, h1: 3.6, h2: 3.0, banner: true },
];
const SHOPS = [0, 1, 2, 3, 4, 5, 6, 7, 18, 19, 20, 21, 18, 21], DWELL = [8, 9, 10, 11, 12, 13, 8, 9, 1, 5, 7, 22, 23, 24, 25, 26, 27, 28, 29, 22, 25], HALLS = [14, 15, 16, 17];
/** per-house height variation: most houses ±8 %, one in six a storey-and-a-half taller or a shed lower (the roofline of
 *  ink07 steps up and down instead of running level) */
export function houseHeight(h) {
  const a = hash01(Math.round(h.x * 7), Math.round(h.z * 7), 44), b = hash01(Math.round(h.x * 3), Math.round(h.z * 3), 45);
  return (0.92 + 0.16 * a) * (b < 0.12 ? 1.28 : b > 0.9 ? 0.86 : 1);
}

/** pick a variant for a house slot (by kind, then the closest width) */
export function pickVariant(h, i) {
  const pool = h.kind === 'shop' ? SHOPS : h.kind === 'hall' ? HALLS : DWELL;
  const r = hash01(Math.round(h.x * 3), Math.round(h.z * 3), 41);
  let best = pool[0], bd = Infinity;
  for (const v of pool) {
    const d = Math.abs(VARIANTS[v].width - h.w) + 1.6 * hash01(v, Math.round(h.x), Math.round(h.z), 43) + (r < 0.3 ? 0.6 * hash01(v, i) : 0);
    if (d < bd) { bd = d; best = v; }
  }
  return best;
}

/** lod 3: a whitewashed box with a gable roof and a dark front (lamplit at night) */
function farKit() {
  const W = 7, D = 10, Hh = 5.6, eave = 0.7, rise = 2.6;
  const mats = hallMaterials();
  const plaster = new MeshBuilder(), tile = new MeshBuilder(), wood = new MeshBuilder();
  const hx = W / 2, hz = D / 2;
  const pw = [PAINT.WHITEWASH, 0, Hh, 0];
  plaster.quad([hx, 0, hz], [hx, 0, -hz], [hx, Hh, -hz], [hx, Hh, hz], pw);
  plaster.quad([-hx, 0, -hz], [-hx, 0, hz], [-hx, Hh, hz], [-hx, Hh, -hz], pw);
  plaster.quad([hx, 0, -hz], [-hx, 0, -hz], [-hx, Hh, -hz], [hx, Hh, -hz], pw);
  plaster.quad([-hx, Hh * 0.55, hz], [hx, Hh * 0.55, hz], [hx, Hh, hz], [-hx, Hh, hz], pw);
  wood.quad([-hx, 0, hz], [hx, 0, hz], [hx, Hh * 0.55, hz], [-hx, Hh * 0.55, hz], [PAINT.LATTICE, 0, Hh * 0.55, 0], [PAINT.LATTICE, 0, Hh * 0.55, W], [PAINT.LATTICE, Hh * 0.55, Hh * 0.55, W], [PAINT.LATTICE, Hh * 0.55, Hh * 0.55, 0]);
  for (const sx of [-1, 1]) plaster.tri(...(sx > 0 ? [[hx, Hh, hz], [hx, Hh, -hz], [hx, Hh + rise, 0]] : [[-hx, Hh, -hz], [-hx, Hh, hz], [-hx, Hh + rise, 0]]), pw);
  const X = hx + 0.3, ye = Hh - 0.35, Ze = hz + eave, yr = Hh + rise + 0.15;
  const s = Math.hypot(Ze, yr - ye), rows = Math.round((2 * X) / 0.24);
  const T = () => [PAINT.CERAMIC, 0, 1, 0];
  tile.quad([-X, ye, Ze], [X, ye, Ze], [X, yr, 0], [-X, yr, 0], T(0), T(0), T(s), T(s), [[0, 0], [rows, 0], [rows, s], [0, s]]);
  tile.quad([X, ye, -Ze], [-X, ye, -Ze], [-X, yr, 0], [X, yr, 0], T(0), T(0), T(s), T(s), [[0, 0], [rows, 0], [rows, s], [0, s]]);
  // ridge: a low prism (two faces)
  tile.quad([-X, yr - 0.02, 0.18], [X, yr - 0.02, 0.18], [X, yr + 0.25, 0], [-X, yr + 0.25, 0], [PAINT.RIDGE, 0.1, 0.3, 0]);
  tile.quad([X, yr - 0.02, -0.18], [-X, yr - 0.02, -0.18], [-X, yr + 0.25, 0], [X, yr + 0.25, 0], [PAINT.RIDGE, 0.1, 0.3, 0]);
  return { lod: 3, materials: mats, variants: [{ params: { width: W, depth: D, height: Hh }, geos: { plaster: plaster.toGeometry(), tile: tile.toGeometry(), wood: wood.toGeometry() }, size: [W, D], tris: (plaster.count + tile.count + wood.count) / 3 }] };
}

let SHADOW_MAT = null;
/** depth-only stand-in material: draws nothing in the colour passes, casts in the shadow pass */
function shadowOnly() {
  if (!SHADOW_MAT) { SHADOW_MAT = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false }); SHADOW_MAT.userData.noPatch = true; SHADOW_MAT.name = 'cityShadowOnly'; }
  return SHADOW_MAT;
}

/** concatenate the family geometries of a kit variant into one (same attributes, non-indexed) */
function mergeFamilies(geos) {
  const list = Object.values(geos);
  const out = new THREE.BufferGeometry();
  for (const [name, size] of [['position', 3], ['normal', 3], ['aPaint', 4], ['aUV', 2], ['aAO', 2]]) {
    const n = list.reduce((s, g) => s + g.attributes[name].count, 0);
    const arr = new Float32Array(n * size);
    let o = 0;
    for (const g of list) { arr.set(g.attributes[name].array, o); o += g.attributes[name].array.length; }
    out.setAttribute(name, new THREE.BufferAttribute(arr, size));
  }
  out.computeBoundingBox(); out.computeBoundingSphere();
  return out;
}

/**
 * Batch a kit: one BatchedMesh per material family holding every variant (one draw call per family for all the
 * houses, culled per house in the camera and in every shadow cascade). variants: [{ geos: { family: geometry } }].
 */
export function batchHouses(variants, placements, materialFor, { name = 'houses', castShadow = true } = {}) {
  const g = new THREE.Group(); g.name = name;
  const fams = new Set();
  variants.forEach((v) => Object.keys(v.geos).forEach((k) => fams.add(k)));
  const M = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), pos = new THREE.Vector3(), scl = new THREE.Vector3();
  let tris = 0;
  for (const k of fams) {
    const used = new Map();
    for (const p of placements) { const v = p.variant % variants.length; if (variants[v].geos[k]) used.set(v, (used.get(v) || 0) + 1); }
    if (!used.size) continue;
    let nV = 0, nI = 0;
    for (const [v, c] of used) { nV += variants[v].geos[k].attributes.position.count; nI += c; }
    const bm = new THREE.BatchedMesh(nI, nV, 0, materialFor(k));
    const ids = new Map();
    for (const v of used.keys()) ids.set(v, bm.addGeometry(variants[v].geos[k]));
    const pid = new Int32Array(placements.length).fill(-1);   // placement index → instance id (explore LOD switching)
    bm.userData.ids = pid;
    for (let pi = 0; pi < placements.length; pi++) {
      const p = placements[pi];
      const v = p.variant % variants.length, gid = ids.get(v);
      if (gid === undefined) continue;
      const id = bm.addInstance(gid);
      pid[pi] = id;
      q.setFromAxisAngle(up, p.rot || 0);
      M.compose(pos.set(p.x, p.y ?? 0, p.z), q, scl.set(p.sx ?? 1, p.sy ?? 1, p.sz ?? 1));
      bm.setMatrixAt(id, M);
      tris += variants[v].geos[k].attributes.position.count / 3;
    }
    bm.computeBoundingBox(); bm.computeBoundingSphere();
    bm.sortObjects = false;                       // opaque: no per-frame depth sort of thousands of houses
    bm.name = `${name}:${k}`;
    bm.castShadow = castShadow && k !== 'glow' && k !== 'dark'; bm.receiveShadow = true;
    bm.userData.castShadow = bm.castShadow;
    g.add(bm);
  }
  g.userData.tris = tris;
  return g;
}

export function placeHouses(engine, houses, { thresholds = [90, 230, 680, 1400], seed = 'linan', nearKits = true } = {}) {
  const t0 = performance.now();
  const [t0d, t1d, t2d, t3d] = thresholds;
  const lists = [[], [], [], []];
  houses.forEach((h, i) => {
    const d = viewDist(h.x, h.z, Math.max(h.w, h.d) / 2);
    let lod = d < t0d ? 1 : d < t1d ? 0 : d < t2d ? 1 : d < t3d ? 2 : 3;
    if (!nearKits && lod < 2) lod = 2;
    const v = pickVariant(h, i);
    const V = VARIANTS[v];
    const sy = houseHeight(h);
    const p = { x: h.x, y: h.y, z: h.z, rot: h.rot, variant: v, sx: Math.min(1.35, Math.max(0.75, h.w / V.width)), sz: Math.min(1.3, Math.max(0.75, h.d / V.depth)), sy, d };
    h.lod = lod; h.variant = v;
    lists[lod].push(p);
  });
  const group = new THREE.Group(); group.name = 'city:houses';
  const counts = lists.map((l) => l.length);
  const kitMs = {};
  const tk = (lod) => { const t = performance.now(); const k = houseKit({ lod, variants: VARIANTS.length, seed, overrides: VARIANTS, ao: lod <= 1 ? true : 'all' }); kitMs[lod] = Math.round(performance.now() - t); return k; };
  let tris = 0;
  const kits = {};
  for (const lod of [0, 1, 2]) {
    if (!lists[lod].length && !(lod === 2 && (lists[0].length || lists[1].length))) continue;
    kits[lod] = tk(lod);
  }
  const reflectHidden = [];
  const far = farKit();
  const farMat = farHouseMaterial();
  // near: the full kits in the shared building materials, shadows from depth-only lod-2 stand-ins
  for (const lod of [0, 1]) {
    if (!lists[lod].length) continue;
    const g = batchHouses(kits[lod].variants, lists[lod], (k) => kits[lod].materials[k], { name: 'houses-lod' + lod, castShadow: false });
    group.add(g); tris += g.userData.tris;
  }
  const near = [...lists[0], ...lists[1]].map((p) => ({ ...p, y: p.y - 0.25, sx: p.sx * 0.97, sz: p.sz * 0.97 }));
  if (near.length && kits[2]) {
    const g = batchHouses(kits[2].variants.map((v) => ({ geos: { all: mergeFamilies(v.geos) } })), near, () => shadowOnly(), { name: 'houses-shadow', castShadow: true });
    g.traverse((o) => { if (o.isBatchedMesh) { o.userData.noPatch = true; o.renderOrder = -1; reflectHidden.push(o); } });
    group.add(g);
  }
  // far: one material for roof, walls and front (a tone per house), one draw per LOD
  const farPl = (list) => list.map((p) => {
    const V = VARIANTS[p.variant];
    const Hh = 0.22 + (V.h1 ?? 3.2) + ((V.storeys ?? 2) > 1 ? (V.h2 ?? 2.6) : 0);
    return { x: p.x, y: p.y, z: p.z, rot: p.rot, variant: 0, sx: (V.width * p.sx) / 7, sz: (V.depth * p.sz) / 10, sy: (Hh * (p.sy ?? 1)) / 5.6 };
  });
  const farGeo = [{ geos: { far: mergeFamilies(far.variants[0].geos) } }];
  if (lists[2].length) {
    const g = batchHouses(kits[2].variants.map((v) => ({ geos: { far: mergeFamilies(v.geos) } })), lists[2], () => farMat, { name: 'houses-lod2', castShadow: false });
    g.traverse((o) => { if (o.isBatchedMesh) reflectHidden.push(o); });
    group.add(g); tris += g.userData.tris;
    const sp = farPl(lists[2]).map((p) => ({ ...p, y: p.y - 0.3, sx: p.sx * 0.95, sz: p.sz * 0.95 }));
    const gs = batchHouses(farGeo, sp, () => shadowOnly(), { name: 'houses-lod2-shadow', castShadow: true });
    gs.traverse((o) => { if (o.isBatchedMesh) { o.userData.noPatch = true; o.renderOrder = -1; reflectHidden.push(o); } });
    group.add(gs);
  }
  if (lists[3].length) {
    const g = batchHouses(farGeo, farPl(lists[3]), () => farMat, { name: 'houses-lod3', castShadow: false });
    g.traverse((o) => { if (o.isBatchedMesh) reflectHidden.push(o); });
    group.add(g); tris += g.userData.tris;
  }
  const kitTris = Object.fromEntries(Object.entries(kits).map(([l, k]) => [l, k.variants.map((v) => Math.round(v.tris))]));
  console.log(`[city] houses: ${houses.length} (lod0 ${counts[0]}, lod1 ${counts[1]}, lod2 ${counts[2]}, lod3 ${counts[3]}), ${(tris / 1e6).toFixed(2)} M tris, kits ${JSON.stringify(kitMs)} ms, ${Math.round(performance.now() - t0)} ms; kit tris ${JSON.stringify(kitTris)}`);
  return { group, counts, tris, reflectHidden, kits };
}

/**
 * The explorable world (?mode=explore): the level of detail of every house follows the walking camera.
 *   < near   lod 0 (full kit) · < mid1 lod 1 · < mid2 lod 2 massing (casts) · beyond: lod 3 boxes
 * lod 2 and lod 3 are one batch each over all the houses (per-house visibility); lod 0 / 1 are small batches of the
 * houses round an anchor, rebuilt when the camera has moved `rebuild` m. update(pos) is cheap when nothing changes.
 */
export function placeHousesExplore(engine, houses, { near = 110, mid1 = 330, mid2 = 1100, rebuild = 140, seed = 'linan', nCity = houses.length } = {}) {
  const t0 = performance.now();
  const pl = houses.map((h, i) => {
    const v = pickVariant(h, i);
    const V = VARIANTS[v];
    const sy = houseHeight(h);
    h.variant = v;
    return { x: h.x, y: h.y, z: h.z, rot: h.rot, variant: v, sx: Math.min(1.35, Math.max(0.75, h.w / V.width)), sz: Math.min(1.3, Math.max(0.75, h.d / V.depth)), sy };
  });
  const group = new THREE.Group(); group.name = 'city:houses';
  const kit = (lod) => houseKit({ lod, variants: VARIANTS.length, seed, overrides: VARIANTS, ao: lod <= 1 ? true : 'all' });
  const kits = { 0: kit(0), 1: kit(1), 2: kit(2) };
  const far = farKit(), farMat = farHouseMaterial();
  const farPl = pl.map((p) => {
    const V = VARIANTS[p.variant];
    const Hh = 0.22 + (V.h1 ?? 3.2) + ((V.storeys ?? 2) > 1 ? (V.h2 ?? 2.6) : 0);
    return { x: p.x, y: p.y, z: p.z, rot: p.rot, variant: 0, sx: (V.width * p.sx) / 7, sz: (V.depth * p.sz) / 10, sy: (Hh * (p.sy ?? 1)) / 5.6 };
  });
  const reflectHidden = [];
  // lod 3 boxes and lod 2 massing over every house; the lod-2 depth-only stand-ins cast the shadows of lod 0-2
  // lod 3 (most of the houses, one box geometry): an instanced mesh refilled when the bands change (a BatchedMesh of
  // every house cost ~9 ms a frame in multi-draw sub-draws)
  const g3 = new THREE.Group(); g3.name = 'houses-lod3';
  const im3 = new THREE.InstancedMesh(mergeFamilies(far.variants[0].geos), farMat, farPl.length);
  im3.name = 'houses-lod3:far'; im3.count = 0; im3.frustumCulled = false;
  im3.castShadow = false; im3.receiveShadow = true; im3.userData.castShadow = false;
  g3.add(im3);
  const mat3 = new Float32Array(farPl.length * 16);
  {
    const M = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), pos = new THREE.Vector3(), scl = new THREE.Vector3();
    farPl.forEach((p, i) => { q.setFromAxisAngle(up, p.rot || 0); M.compose(pos.set(p.x, p.y ?? 0, p.z), q, scl.set(p.sx, p.sy, p.sz)); M.toArray(mat3, i * 16); });
  }
  let dirty3 = true;
  const fill3 = () => {
    if (!dirty3) return;
    dirty3 = false;
    let n = 0;
    const a = im3.instanceMatrix.array;
    for (let i = 0; i < pl.length; i++) if (band[i] === 3) { a.set(mat3.subarray(i * 16, i * 16 + 16), n * 16); n++; }
    im3.count = n;
    im3.instanceMatrix.needsUpdate = true;
  };
  const g2 = batchHouses(kits[2].variants.map((v) => ({ geos: { far: mergeFamilies(v.geos) } })), pl, () => farMat, { name: 'houses-lod2', castShadow: false });
  const gs = batchHouses(kits[2].variants.map((v) => ({ geos: { all: mergeFamilies(v.geos) } })), pl.map((p) => ({ ...p, y: p.y - 0.25, sx: p.sx * 0.97, sz: p.sz * 0.97 })), () => shadowOnly(), { name: 'houses-shadow', castShadow: true });
  gs.traverse((o) => { if (o.isBatchedMesh) { o.userData.noPatch = true; o.renderOrder = -1; } });
  for (const g of [g3, g2, gs]) { group.add(g); g.traverse((o) => { if (o.isBatchedMesh || o.isInstancedMesh) reflectHidden.push(o); }); }
  const bms = (g) => { const a = []; g.traverse((o) => { if (o.isBatchedMesh) a.push(o); }); return a; };
  const B2 = bms(g2), BS = bms(gs);
  const band = new Int8Array(pl.length).fill(-1);
  const setVis = (list, i, on) => { for (const bm of list) { const id = bm.userData.ids[i]; if (id >= 0) bm.setVisibleAt(id, on); } };
  // near batches (lod 0 / 1) of a set of houses (those round the anchor, or a still's lod 0 / 1 houses)
  let nearG = null, nearIdx = [], anchor = null, last = null, nearKey = '';
  const buildNear = (idx) => {
    if (nearG) { group.remove(nearG); nearG.traverse((o) => { if (o.isBatchedMesh) o.dispose(); }); }
    nearIdx = idx;
    nearKey = idx.join(',');
    nearG = new THREE.Group(); nearG.name = 'houses-near';
    const sub = nearIdx.map((i) => pl[i]);
    for (const lod of [0, 1]) {
      const g = batchHouses(kits[lod].variants, sub, (k) => kits[lod].materials[k], { name: 'houses-lod' + lod, castShadow: false });
      g.userData.lod = lod;
      nearG.add(g);
    }
    group.add(nearG);
    engine.ensurePatched?.();
    band.fill(-1);          // re-apply every house's band
  };
  const nearAround = (pos) => {
    anchor = pos.clone();
    const R = mid1 + rebuild + 20, idx = [];
    for (let i = 0; i < pl.length; i++) if (Math.hypot(pl[i].x - pos.x, pl[i].z - pos.z) < R) idx.push(i);
    buildNear(idx);
  };
  /** show each house at a band (0-3, -1 hidden) */
  const applyBands = (bandOf) => {
    const nearSlot = new Map(nearIdx.map((i, k) => [i, k]));
    const NB = nearG.children.map((g) => ({ lod: g.userData.lod, list: bms(g) }));
    for (let i = 0; i < pl.length; i++) {
      let b = bandOf(i);
      if (b >= 0 && b <= 1 && !nearSlot.has(i)) b = 2;
      if (band[i] === b) continue;
      if (band[i] === 3 || b === 3) dirty3 = true;
      band[i] = b;
      setVis(B2, i, b === 2);
      setVis(BS, i, b >= 0 && b <= 2);
      const k = nearSlot.get(i);
      if (k !== undefined) for (const N of NB) setVis(N.list, k, N.lod === b);
    }
    fill3();
  };
  const update = (pos, force = false) => {
    if (!force && last && Math.hypot(pos.x - last.x, pos.z - last.z) < 12) return false;
    last = pos.clone();
    if (!anchor || Math.hypot(pos.x - anchor.x, pos.z - anchor.z) > rebuild) nearAround(pos);
    applyBands((i) => { const d = Math.hypot(pl[i].x - pos.x, pl[i].z - pos.z); return d < near ? 0 : d < mid1 ? 1 : d < mid2 ? 2 : 3; });
    return true;
  };
  // a still (src/explore/still.js): the stills' own bands (placeHouses): from the shot cameras at a viewpoint (the
  // hamlets, which no still has, hidden), else from this camera; live() goes back to the walking bands
  const T = [90, 230, 680, 1400];
  const lodAt = (d) => (d < T[0] ? 1 : d < T[1] ? 0 : d < T[2] ? 1 : d < T[3] ? 2 : 3);
  let offLod = null;
  const still = (pos, viewpoint) => {
    if (viewpoint) offLod ||= houses.map((h, i) => (i < nCity ? lodAt(viewDist(h.x, h.z, Math.max(h.w, h.d) / 2)) : -1));
    const bandOf = viewpoint ? (i) => offLod[i] : (i) => lodAt(Math.hypot(pl[i].x - pos.x, pl[i].z - pos.z));
    const idx = [];
    for (let i = 0; i < pl.length; i++) { const b = bandOf(i); if (b === 0 || b === 1) idx.push(i); }
    if (idx.join(',') !== nearKey) buildNear(idx);
    anchor = null;
    applyBands(bandOf);
  };
  const live = (pos) => { anchor = null; last = null; band.fill(-1); update(pos, true); };
  update(engine.camera.position, true);
  console.log(`[city] houses (explore, camera LOD): ${houses.length} houses, near batches of ${nearIdx.length}, ${Math.round(performance.now() - t0)} ms`);
  return { group, reflectHidden, update, still, live, counts: [0, 0, 0, 0], tris: 0 };
}
