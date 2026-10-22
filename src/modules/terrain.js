// TERRAIN: the ground of the whole world (lake bed, shores, plain, city ground, hills, distant ranges)
// meshed from heightfield.heightAt() with a camera-driven quadtree (src/terrain/mesh.js).
//   build(engine): meshes for every shot camera in src/world/shots.js (+ any extra cameras in
//   engine.registry.terrainCams), grouped into chunks (frustum culling, shadow casting).
import * as THREE from 'three';
import { planLeaves, meshLeaf } from '../terrain/mesh.js';
import { terrainMaterial, setTerrainSeason } from '../terrain/material.js';
import { LOOKS } from '../world/looks.js';
import { SHOTS } from '../world/shots.js';
import { extraCamsOf, planCams } from '../world/plancams.js';

const N = 32;

function chunkGeometry(parts) {
  let nv = 0, ni = 0;
  for (const p of parts) { nv += p.position.length / 3; ni += p.index.length; }
  const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3), idx = new Uint32Array(ni);
  let ov = 0, oi = 0;
  for (const p of parts) {
    pos.set(p.position, ov * 3); nor.set(p.normal, ov * 3);
    for (let k = 0; k < p.index.length; k++) idx[oi + k] = p.index[k] + ov;
    ov += p.position.length / 3; oi += p.index.length;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.computeBoundingBox(); g.computeBoundingSphere();
  return g;
}

export async function buildTerrain(engine, { cams = null, theta = null, perShot = null } = {}) {
  const t0 = performance.now();
  const q = engine.quality;
  const extra = engine.registry.terrainCams || [];
  const th = theta ?? (q.name === 'preview' ? 0.012 : 0.0065);
  const minCell = q.name === 'preview' ? 1.5 : 0.75;
  // one quadtree PER SHOT (only the current shot's set is shown, onShot). A single tree refined for
  // all ten cameras drew the fine ground near every other camera in each frame (12 M tris at high, main pass plus the
  // shadow cascades); a shot's own tree is 1.8–2.3 M. Leaves shared by several trees are meshed once.
  const split = perShot ?? !cams;
  const sets = split
    ? SHOTS.map((s) => ({ id: s.id, pos: s.pos, cams: [s, ...extraCamsOf(s.id), ...extra] }))
    : [{ id: null, pos: null, cams: cams || [...planCams(), ...extra] }];
  const mat = terrainMaterial();
  const root = new THREE.Group();
  root.name = 'terrain';
  const leafCache = new Map();
  let verts = 0, tris = 0, nLeaves = 0, planMs = 0;
  for (const S of sets) {
    const tp = performance.now();
    const leaves = planLeaves(S.cams, { theta: th, outside: 3, minCell, N });
    planMs += performance.now() - tp;
    nLeaves += leaves.length;
    // group leaves into chunks: small leaves by 1 km tiles, big leaves by 8 km tiles
    const groups = new Map();
    for (const lf of leaves) {
      const tile = lf.size <= 512 ? 1024 : lf.size <= 4096 ? 8192 : 65536;
      const key = `${tile}:${Math.floor(lf.x0 / tile)}:${Math.floor(lf.z0 / tile)}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(lf);
    }
    const set = new THREE.Group();
    set.name = S.id == null ? 'terrain:all' : 'terrain:shot' + S.id;
    set.userData.shotId = S.id; set.userData.pos = S.pos;
    for (const [key, lfs] of groups) {
      const parts = lfs.map((lf) => {
        const k = `${lf.x0},${lf.z0},${lf.size}`;
        let m = leafCache.get(k);
        if (!m) { m = meshLeaf(lf, N); leafCache.set(k, m); }
        return m;
      });
      const g = chunkGeometry(parts);
      verts += g.attributes.position.count; tris += g.index.count / 3;
      const m = new THREE.Mesh(g, mat);
      m.name = 'terrain:' + (S.id ?? 'all') + ':' + key;
      set.add(m);
    }
    root.add(set);
  }
  engine.add(root, { castShadow: true, receiveShadow: true });
  if (split) {
    // show the current shot's set (a custom camera gets the set of the nearest shot camera)
    const show = (shot) => {
      let best = null, bd = Infinity;
      for (const set of root.children) {
        if (shot && set.userData.shotId === shot.id) { best = set; break; }
        const p = set.userData.pos, c = shot?.pos;
        const d = p && c ? Math.hypot(p[0] - c[0], p[1] - c[1], p[2] - c[2]) : Infinity;
        if (d < bd) { bd = d; best = set; }
      }
      for (const set of root.children) set.visible = set === (best || root.children[0]);
    };
    show(SHOTS[0]);
    engine.onShot(show);
  }
  engine.registry.terrain = { root, material: mat, leaves: nLeaves };
  console.log(`[terrain] ${sets.length} set(s), ${nLeaves} patches (${leafCache.size} meshed), ${(verts / 1e6).toFixed(2)} M verts, ${(tris / 1e6).toFixed(2)} M tris; plan ${Math.round(planMs)} ms, total ${Math.round(performance.now() - t0)} ms`);
  return root;
}

/** ground per season: grass tone, snow (winter) — the season comes from engine.registry (world/index.js) */
function seasonHook(engine) {
  setTerrainSeason(engine.registry.season || 'spring');
  engine.onShot((shot) => setTerrainSeason(engine.registry.season || LOOKS[shot.id]?.season || 'spring', shot.snow));
}

/** the explorable world (?mode=explore): one streamed, camera-centred terrain (src/explore/terrain.js) instead of the
 *  per-shot sets; the start camera's patches are meshed in workers before the build goes on */
async function buildStreamed(engine) {
  const t0 = performance.now();
  const { StreamTerrain } = await import('../explore/terrain.js');
  const mat = terrainMaterial();
  const st = new StreamTerrain({ material: mat, theta: Number(engine.params.get('terrTheta')) || 0.014, minCell: 1.0, N: 64 });
  await st.init(engine.camera.position);
  engine.add(st.root, { castShadow: true, receiveShadow: true });
  engine.registry.terrain = { root: st.root, material: mat, leaves: st.stats.leaves, stream: st };
  console.log(`[terrain] streamed: ${st.stats.leaves} patches, ${(st.stats.tris / 1e6).toFixed(2)} M tris, ${st.pool.size} workers, ${Math.round(performance.now() - t0)} ms`);
}

export async function build(engine) {
  if (engine.explore) await buildStreamed(engine);
  else await buildTerrain(engine);
  seasonHook(engine);
  // framing check only: grey massing for layout.js entries (?proxies=1 for all, or ?proxies=bridges,boats)
  const px = engine.params?.get?.('proxies');
  if (px) { const { buildProxies } = await import('../terrain/proxies.js'); buildProxies(engine, px); }
}

// node tools/render.mjs --test terrain --view N   (terrain + water only; the look of the shot named by id)
//   0: overview from 宝石山   1: map view   2: 苏堤 path (shot 2)   3: 六和塔 slope (shot 9)   4: 断桥 snow (shot 10)
//   5: the palace slopes (shot 6)   6: 苏堤 path close, low sun   7: 宝石山 foreground (shot 1)
export async function test(engine) {
  for (const o of engine.scene.children) if (o.name === 'testGround') o.visible = false;
  const views = [
    { pos: [470, 150, -2150], target: [100, 0, 600], fov: 40, sun: { azimuth: 105, elevation: 14 } },
    { pos: [0, 9000, 6000], target: [0, 0, 0], fov: 50, sun: { azimuth: 105, elevation: 30 } },
    { id: 2, pos: [-413.2, 2.5, 307.6], target: [-435.2, 23.3, 212.3], fov: 46 },
    { id: 9, pos: [-1648, 55.6, 4838], target: [-1551.7, 55.9, 4864.8], fov: 42.3 },
    { id: 10, pos: [687.5, 5, -1635.4], target: [615.3, 7.5, -1704.5], fov: 37.3 },
    { id: 6, pos: [1690, 70, 2140], target: [1707.4, 68.3, 2238.5], fov: 38 },
    { id: 2, pos: [-416, 2.6, 300], target: [-419, 0.6, 288], fov: 50, sun: { azimuth: 250, elevation: 8 } },
    { id: 1, pos: [276.4, 93, -2246], target: [262, 70, -2160], fov: 30 },
  ];
  const v = views[Number(engine.params.get('view') || 0)] || views[0];
  engine.registry.season = engine.params.get('season') || LOOKS[v.id]?.season || 'spring';
  await buildTerrain(engine, { cams: views });
  setTerrainSeason(engine.registry.season);
  const W = await import('./water.js');
  await W.build(engine);
  return { views: views.map((x) => ({ ...x, near: 0.3, far: 60000 })) };
}
