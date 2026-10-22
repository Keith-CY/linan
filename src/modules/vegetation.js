// VEGETATION: every plant of the West Lake world.
//   trees    — 垂柳 willow, 桃 peach (blossom), 松 pine (黄山松 / 马尾松), 樟 camphor, deciduous broadleaf, 红枫 red
//              maple, 银杏 ginkgo: seeded procedural skeletons, bark tubes, canvas-atlas leaf cards with
//              translucency, LOD0-2 geometry + LOD3 impostor billboards (src/vegetation/)
//   placement — src/vegetation/placement.js (causeways, shores, hills, temple grounds, shot hero trees)
//   seasons  — engine.registry.season, the shot's `season`, or ?season= : leaf colour, blossom, bare
//              branches, snow (src/vegetation/materials.js applySeason)
// Deterministic: seeded RNG and per-cell hashes only.
import * as THREE from 'three';
import { VegSystem } from '../vegetation/system.js';
import { buildLibrary } from '../vegetation/library.js';
import { buildLotusLibrary, placeLotus } from '../vegetation/lotus.js';
import { buildGroundLibrary, placeGround, buildVines, vineSites } from '../vegetation/ground.js';
import { depthFor } from '../vegetation/materials.js';
import * as LAYOUT from '../world/layout.js';
import { applySeason, currentSeason, WIND } from '../vegetation/materials.js';
import { RNG, hash01 } from '../core/rng.js';
import { heightAt } from '../world/heightfield.js';
import { lookOf } from '../world/looks.js';

const SEASON_OK = new Set(['spring', 'summer', 'autumn', 'winter']);

/** season for a shot: ?season= (override) > shot.season > engine.registry.season > LOOKS[id].season > spring */
export function seasonFor(engine, shot = engine.shot) {
  const s = engine.params?.get?.('season') || shot?.season || engine.registry.season || (shot ? lookOf(shot.id)?.season : null) || 'spring';
  return SEASON_OK.has(s) ? s : 'spring';
}

/** is the point (x, y, z) hidden from the camera by the terrain? (7 samples along the ray, ignoring the last 8 %) */
function terrainOccluder(cx, cy, cz, x, y, z) {
  const d = Math.hypot(x - cx, z - cz);
  if (d < 25) return false;
  for (let k = 1; k <= 7; k++) {
    const t = (k / 8) * 0.92;
    const px = cx + (x - cx) * t, pz = cz + (z - cz) * t, py = cy + (y - cy) * t;
    if (heightAt(px, pz) > py + 1.5) return true;
  }
  return false;
}

function installHooks(engine, sys) {
  if (!engine.params?.get?.('vegNoOcclusion')) sys.occluded = terrainOccluder;
  engine.onUpdate((t) => { WIND.uWindTime.value = t; });
  engine.onShot((shot) => { applySeason(seasonFor(engine, shot)); sys.resetHistory(); sys.update(engine.camera); engine.ensurePatched(); });
  // src/world/index.js may set registry.season in its shot hook (any order): re-check before every frame
  sys.onFrame = () => { const s = seasonFor(engine); if (s !== currentSeason()) applySeason(s); };
}

/** explore: the shots' cover rules on a world lattice (src/explore/cover.js, candidates from the height workers) */
async function exploreCover(engine, P) {
  const t0 = performance.now();
  const { getHeightPool } = await import('../explore/heightpool.js');
  const { REC } = await import('../explore/cover.js');
  const cell = 15 / Math.max(0.5, Math.sqrt(engine.quality.density ?? 1)) * 0.75;
  const C = await getHeightPool().cover([-7000, -6000, 5500, 8000], cell, { cx: -600, cz: 1200, R: 7200 });
  const tC = performance.now();
  let n = 0;
  const KIND = { pine: 'pineM', willow: 'willow', peach: 'peach', camphor: 'camphor', maple: 'maple', ginkgo: 'ginkgo', broad: 'broad' };
  for (let k = 0; k < C.length; k += REC) {
    const x = C[k], z = C[k + 1], y = C[k + 2], sl = C[k + 3], i = C[k + 4], j = C[k + 5];
    const h = hash01k(i, j, 5);
    let kind;
    if (y > 70 || sl > 0.3) kind = h < 0.55 ? 'pineM' : h < 0.75 ? 'pineH' : 'camphor';
    else if (y > 30) kind = h < 0.25 ? 'pineM' : h < 0.6 ? 'camphor' : 'broad';
    else kind = h < 0.12 ? 'pineM' : h < 0.55 ? 'camphor' : 'broad';
    const zs = P.zoneSpecies(x, z);
    if (zs) kind = zs === 'pine' ? (h < 0.7 ? 'pineM' : 'pineH') : (KIND[zs] || kind);
    if (LAYOUT.LINGYIN && Math.hypot(x - LAYOUT.LINGYIN.temple[0], z - LAYOUT.LINGYIN.temple[1]) < 500) {
      const m = hash01k(i, j, 6);
      if (m < 0.18) kind = 'maple'; else if (m < 0.3) kind = 'ginkgo';
    }
    if (P.put(kind, x, z, hash01k(i, j, 8), { scale: 0.85 + 0.5 * hash01k(i, j, 7), r: cell * 0.32, y })) n++;
  }
  console.log(`[vegetation] explore cover: ${C.length / REC} candidates (${Math.round(tC - t0)} ms in workers), ${n} trees placed, ${Math.round(performance.now() - t0)} ms`);
  return n;
}
const hash01k = (i, j, k) => hash01(i, j, 9, k);

export async function build(engine) {
  const t0 = performance.now();
  const sys = new VegSystem(engine);
  const lib = buildLibrary(sys, engine);
  const groundLib = buildGroundLibrary(sys, engine);
  lib.shrub = groundLib.shrub; // understorey bushes where a tree would block a view
  const { placeWorld } = await import('../vegetation/placement.js');
  const stats = await placeWorld(engine, sys, lib);
  // lotus ponds (layout PLANTS with species 'lotus')
  const lotusZones = (LAYOUT.PLANTS || []).filter((z) => z.species === 'lotus');
  if (lotusZones.length) {
    const lotusLib = buildLotusLibrary(sys, engine);
    stats.counts.lotus = placeLotus(engine, sys, lotusLib, lotusZones);
  }
  // ground layer: grass, ferns, shrubs, reeds, fallen petals / leaves; vines over the 飞来峰 cliff
  Object.assign(stats.counts, placeGround(engine, sys, groundLib, stats.placer));
  const vines = buildVines(engine, vineSites(engine));
  if (vines) {
    const m = new THREE.Mesh(vines.geo, vines.mat);
    m.name = 'veg:vines'; m.customDepthMaterial = depthFor(vines.mat);
    m.castShadow = false; m.userData.castShadow = false; // thin strands on a shaded face: no visible shadow, real cost
    sys.group.add(m);
    stats.counts.vines = vines.strands;
    stats.vineTris = vines.tris;
  }
  // the explorable world: tree cover on every hill and groves on the plain, not only in the shots' view cones. Placed
  // last, so everything a still places is placed the same way; marked (inst.ex) so a still view can leave it out
  if (engine.explore) {
    const n0 = sys.variants.map((v) => v.inst.length);
    stats.counts.exploreCover = await exploreCover(engine, stats.placer);
    sys.variants.forEach((v, k) => { for (let i = n0[k]; i < v.inst.length; i++) v.inst[i].ex = true; });
  }
  sys.finalize();
  engine.add(sys.group);
  installHooks(engine, sys);
  // terrain: forest floor instead of the canopy pattern under the instanced trees round the first shot camera
  const TZ = engine.registry.terrain?.material?.userData?.cgUniforms?.uTreeZone;
  const S0 = (await import('../world/shots.js')).SHOTS[0];
  if (TZ && S0) TZ.value.set(S0.pos[0], S0.pos[2], 900, 0);
  engine.registry.vegetation = { sys, lib, stats };
  console.log(`[vegetation] ${sys.stats.instances} plants placed (${Object.entries(stats.counts || {}).map(([k, v]) => k + ' ' + v).join(', ')}) in ${Math.round(performance.now() - t0)} ms`);
}

// ------------------------------------------------------------------ tests
// node tools/render.mjs --test vegetation --view N   (add --params "vegLod=1" to force a LOD)
const TEST_VIEWS = [
  // 0-3: lineups of every tree, one per season
  { name: 'lineup spring', season: 'spring', setup: 'lineup', pos: [0, 9, 92], target: [0, 6.5, 0], fov: 38, sun: { azimuth: 125, elevation: 32 } },
  { name: 'lineup summer', season: 'summer', setup: 'lineup', pos: [0, 9, 92], target: [0, 6.5, 0], fov: 38, sun: { azimuth: 200, elevation: 50 } },
  { name: 'lineup autumn', season: 'autumn', setup: 'lineup', pos: [0, 9, 92], target: [0, 6.5, 0], fov: 38, sun: { azimuth: 150, elevation: 25 } },
  { name: 'lineup winter', season: 'winter', setup: 'lineup', pos: [0, 9, 92], target: [0, 6.5, 0], fov: 38, sun: { azimuth: 160, elevation: 22 } },
  // 4: willow hero, spring, low camera (苏堤春晓)
  { name: 'willow hero', season: 'spring', setup: 'willowRow', pos: [-3.5, 1.6, 9], target: [2, 4.2, -12], fov: 50, sun: { azimuth: 110, elevation: 20 } },
  // 5: peach hero, spring
  { name: 'peach hero', season: 'spring', setup: 'peachRow', pos: [-2, 1.6, 6.5], target: [1.5, 2.3, -4], fov: 45, sun: { azimuth: 110, elevation: 24 } },
  // 6: pine hero (宝石山 foreground)
  { name: 'pine hero', season: 'spring', setup: 'pines', pos: [0, 7, 22], target: [0, 7.5, 0], fov: 45, sun: { azimuth: 105, elevation: 18 } },
  // 7: autumn maple + ginkgo, backlit (飞来峰)
  { name: 'autumn backlit', season: 'autumn', setup: 'autumn', pos: [0, 2.2, 24], target: [0, 5, 0], fov: 45, sun: { azimuth: 340, elevation: 22 } },
  // 8: winter willows with snow (断桥残雪)
  { name: 'winter willows', season: 'winter', setup: 'willowRow', pos: [-3.5, 1.6, 9], target: [2, 4.2, -12], fov: 50, sun: { azimuth: 160, elevation: 22 } },
  // 9: far forest (hill cover from ~1 km)
  { name: 'far forest', season: 'summer', setup: 'forest', pos: [0, 60, 900], target: [0, 40, 0], fov: 30, sun: { azimuth: 200, elevation: 40 } },
  // 10: summer willow (曲院风荷 shore)
  { name: 'willow summer', season: 'summer', setup: 'willowRow', pos: [-3.5, 1.6, 9], target: [2, 4.2, -12], fov: 50, sun: { azimuth: 200, elevation: 50 } },
  // 11: peach macro (the foreground branch of ref02)
  { name: 'peach macro', season: 'spring', setup: 'peachRow', pos: [0.2, 2.6, -0.4], target: [1.8, 2.9, -3.2], fov: 45, sun: { azimuth: 110, elevation: 24 } },
  // 12: pine macro (the foreground needles of ref01)
  { name: 'pine macro', season: 'spring', setup: 'pines', pos: [-1.5, 8.5, 6], target: [-4, 8, 0], fov: 45, sun: { azimuth: 105, elevation: 18 } },
  // 13: lotus pond, low telephoto like shot 3 (ref03), afternoon sun from the left-back
  { name: 'lotus pond', season: 'summer', setup: 'lotus', pos: [0, 2.0, 40], target: [0, 1.2, 0], fov: 19, sun: { azimuth: 250, elevation: 42 } },
  // 14: lotus close (leaf surface, beads, a flower)
  { name: 'lotus close', season: 'summer', setup: 'lotus', pos: [0.5, 1.6, 31], target: [0, 0.9, 26], fov: 35, sun: { azimuth: 250, elevation: 42 } },
  // 15-16: ground layer (grass, ferns, shrubs, reeds, litter) spring / autumn
  { name: 'ground spring', season: 'spring', setup: 'ground', pos: [0, 1.7, 12], target: [0, 0.6, 0], fov: 45, sun: { azimuth: 120, elevation: 30 } },
  { name: 'ground autumn', season: 'autumn', setup: 'ground', pos: [0, 1.7, 12], target: [0, 0.6, 0], fov: 45, sun: { azimuth: 120, elevation: 30 } },
];

export async function test(engine) {
  for (const o of engine.scene.children) if (o.name === 'testGround') o.visible = true;
  const vi = Number(engine.params.get('view') || 0);
  const V = TEST_VIEWS[vi] || TEST_VIEWS[0];
  const sys = new VegSystem(engine);
  const need = {
    lineup: ['willow', 'peach', 'pineH', 'pineM', 'camphor', 'broad', 'maple', 'ginkgo'],
    willowRow: ['willow', 'peach'], peachRow: ['peach', 'willow'], pines: ['pineH', 'pineM'], autumn: ['maple', 'ginkgo', 'camphor'],
    forest: ['camphor', 'broad', 'pineH', 'pineM', 'maple'],
    lotus: ['willow'],
    ground: ['peach', 'maple', 'pineM'],
  }[V.setup];
  const lib = buildLibrary(sys, engine, need);
  const rng = new RNG('vegtest' + vi);
  const add = (kind, i, x, z, yaw = rng.range(0, 6.28), s = 1, y = 0) => { const v = lib[kind][i % lib[kind].length]; sys.add(v, x, y, z, yaw, s); };
  if (V.setup === 'lineup') {
    need.forEach((k, i) => { add(k, i, (i - 3.5) * 17, 0, 0.6 + i); add(k, i + 1, (i - 3.5) * 17 + 6, -30, i * 2); });
  } else if (V.setup === 'willowRow') {
    // a causeway: willows alternating with peach trees on both edges of a 12 m path
    for (let k = 0; k < 7; k++) {
      add('willow', k, -6.5 + rng.range(-0.5, 0.5), -k * 9, rng.range(-0.6, 0.6) + Math.PI);
      add(k % 2 ? 'willow' : 'peach', k + 2, 6.5 + rng.range(-0.5, 0.5), -k * 9 - 4.5, rng.range(-0.6, 0.6));
    }
  } else if (V.setup === 'peachRow') {
    add('peach', 0, 1.5, -3, 0.3); add('peach', 1, -3, -9, 2); add('peach', 2, 4, -12, 4);
    add('willow', 0, -7, -6, Math.PI); add('willow', 1, 8, -16, 0.5);
  } else if (V.setup === 'pines') {
    add('pineH', 0, -5, 0, 0.4); add('pineM', 0, 6, -4, 2.2); add('pineH', 1, 16, -14, 1.2); add('pineM', 1, -16, -16, 3);
  } else if (V.setup === 'autumn') {
    add('maple', 0, -5, 0, 0.3); add('maple', 1, 4, 4, 1.5); add('ginkgo', 0, 7, -8, 0.2); add('ginkgo', 1, -10, -12, 2); add('camphor', 0, 0, -22, 1);
  } else if (V.setup === 'lotus') {
    // a pond 60 × 50 m in front of the camera (the test ground is a stand-in for the water surface)
    const lotusLib = buildLotusLibrary(sys, engine);
    placeLotus(engine, sys, lotusLib, [{ polygon: [[-30, -15], [30, -15], [30, 36], [-30, 36]], density: 125 }]);
    // stand-in pond water (dark, glossy) for the test only — the world's water is src/modules/water.js
    const water = new THREE.Mesh(new THREE.PlaneGeometry(400, 400).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x0a120e, roughness: 0.08, metalness: 0 }));
    water.position.y = 0.01; water.receiveShadow = true; water.userData.castShadow = false;
    engine.add(water, { castShadow: false });
    add('willow', 0, -12, -22, Math.PI); add('willow', 1, 14, -25, 0.3);
  } else if (V.setup === 'ground') {
    const g = buildGroundLibrary(sys, engine);
    const put = (k, x, z, s = 1) => { const a = g[k]; sys.add(a[Math.floor(rng.random() * a.length)], x, 0, z, rng.range(0, 6.28), s); };
    for (let i = 0; i < 900; i++) { const x = rng.range(-14, 14), z = rng.range(-12, 9); put(x < -6 && z < -2 ? 'fern' : 'grass', x, z, rng.range(0.8, 1.4)); }
    for (let i = 0; i < 18; i++) put('reed', rng.range(6, 14), rng.range(-12, -6), rng.range(0.8, 1.2));
    for (let i = 0; i < 6; i++) put('shrub', rng.range(-12, 12), rng.range(-14, -8), rng.range(0.8, 1.3));
    for (const k of ['litterPetal', 'litterLeaf', 'litterBrown']) for (let i = 0; i < 8; i++) put(k, rng.range(-4, 4), rng.range(-3, 5));
    add('peach', 0, 3, -6, 0.4); add('maple', 1, -7, -9, 1.2); add('pineM', 0, 9, -14, 2);
  } else if (V.setup === 'forest') {
    const kinds = ['camphor', 'broad', 'broad', 'pineH', 'pineM', 'camphor', 'maple'];
    for (let i = 0; i < 9000; i++) {
      const x = rng.range(-700, 700), z = rng.range(-300, 300);
      const h = Math.max(0, 80 * Math.exp(-((x / 500) ** 2 + (z / 260) ** 2)));
      add(kinds[rng.int(0, kinds.length - 1)], i, x, z, rng.range(0, 6.28), rng.range(0.8, 1.25), -0.3);
    }
  }
  sys.finalize();
  engine.add(sys.group);
  installHooks(engine, sys);
  engine.registry.vegetation = { sys, lib };
  window.__vegStats = () => ({ ...sys.stats, hist: sys.lodHistogram() });
  const { name, setup, ...view } = V;
  return { views: TEST_VIEWS.map((v, i) => (i === vi ? view : { pos: v.pos, target: v.target, fov: v.fov, sun: v.sun, season: v.season })) };
}
