// CITY: Lin'an east of the lake (shot 7 above 御街, the far shore of shot 1, the city lamps of shot 5).
//
// build(engine):
//   plan       src/city/plan.js — blocks between cross lanes and alleys off 御街, cut by the 市河 / 盐桥运河 and the walls;
//              houses on every block edge, yards inside; suburbs on the south shore
//   houses     src/city/houses.js — the shop-house kit (src/yingzao/house.js) instanced at four LODs by the distance from
//              the shot cameras, depth-only shadow stand-ins for the near ones
//   streets    src/city/streets.js — the 御街 paving, canal embankments with landing steps, the hump bridges over the
//              canals at the cross lanes (src/bridges/arch.js)
//   walls      src/city/walls.js — the west wall along the lake with its gates, the art-directed east wall
//   props      src/city/props.js — awnings, handcarts, stacked goods along 御街 near the shot-7 camera
//   smoke      src/city/smoke.js — kitchen smoke rising from the roofs (shot 7, morning)
// Footprints: every house, the street, the lanes and the canals are registered (vegetation keeps off them); the yards
// are published for trees: engine.registry.city = { treeSpots: [{ x, z, r }], plan, houses, smoke, … }.
//
// test(engine): node tools/render.mjs --test city --view N [--params "lod=0"]  (a street of the kit: views 0 street
//   level, 1 from above like shot 7, 2 the variants in a row)
import * as THREE from 'three';
import * as L from '../world/layout.js';
import { planCity } from '../city/plan.js';
import { placeHouses, VARIANTS } from '../city/houses.js';
import { hookLooks } from './yingzao.js';
import { setBuildingLook } from '../yingzao/materials.js';
import { houseKit, instanceHouses } from '../yingzao/house.js';
import { buildBuilding } from '../yingzao/buildings.js';
import { viewDist, lodFor } from '../city/lod.js';

/** 營造法式 parameters of the big city buildings (plan.js CITY_LANDMARKS kinds) */
const LANDMARK_PARAMS = {
  // a two-storey 酒樓: 平坐 balcony with 勾闌, 歇山 roof, five bays
  // ink07 (bigger 酒樓 over the roofs): three storeys with 平坐 balconies, grade 3, 歇山 with strong curl
  louge: { grade: 3, type: 'tingtang', roof: 'xieshan', curl: { lift: 75 }, storeys: [
    { bays: 5, bayWidths: [250, 300, 340, 300, 250], depthWidths: [260, 300, 260], rafters: 6, columnRatio: 0.88, puzuo: 4, walls: 'louge-g' },
    { bays: 5, bayWidths: [240, 290, 330, 290, 240], depthWidths: [250, 290, 250], rafters: 6, columnRatio: 0.74, puzuo: 5, walls: 'louge-s' },
    { bays: 5, bayWidths: [230, 280, 320, 280, 230], depthWidths: [240, 280, 240], rafters: 6, columnRatio: 0.7, puzuo: 5, walls: 'louge-s' },
  ] },
  hall: { bays: 5, rafters: 6, grade: 5, puzuo: 4, roof: 'xieshan', type: 'tingtang', jiaShen: 128 },
  chongyan: { bays: 5, rafters: 6, grade: 3, puzuo: 5, roof: 'xieshan', jiaShen: 132 },
};

const optional = async (path) => { try { return await import(path); } catch (e) { console.error('[city] ' + path + ' failed to load:', e.stack || e); return null; } };

export async function build(engine) {
  hookLooks(engine);
  const t0 = performance.now();
  const q = engine.quality;
  const plan = planCity({ density: 1 });
  const tPlan = performance.now();
  const reg = (engine.registry.city = { plan, treeSpots: plan.courtyards, houses: plan.houses.length });
  // the explorable world: every house's level of detail follows the walking camera (explore calls reg.houseLod)
  let H;
  if (engine.explore) {
    // hamlets on the plain the shots never looked at (src/explore/villages.js), with the city's dwelling kit
    const { planVillages } = await import('../explore/villages.js');
    const nCity = plan.houses.length;
    plan.houses.push(...planVillages(engine, plan.houses));
    const { placeHousesExplore } = await import('../city/houses.js');
    H = placeHousesExplore(engine, plan.houses, { nCity });
    reg.houseLod = H.update;
    reg.houseStill = H.still; reg.houseLive = H.live;
  } else H = placeHouses(engine, plan.houses, {});
  engine.add(H.group);
  reg.housesGroup = H.group;
  // the big buildings among the houses
  for (const b of plan.landmarks || []) {
    try {
      const d = viewDist(b.x, b.z, b.r);
      const lod = Math.max(1, lodFor(d, [160, 300]));
      const { group, info } = buildBuilding(b.kind, LANDMARK_PARAMS[b.kind] || {}, { lod, name: b.id, ao: lod <= 1 });
      group.position.set(b.x, b.y + (info.baseH ?? 0), b.z);
      group.rotation.y = L.headingToRotY(b.facing);
      group.name = 'city:' + b.id;
      engine.add(group);
      engine.footprints?.addCircle?.(b.x, b.z, b.r, 'building');
      console.log(`[city] ${b.id} (${b.kind}, lod ${lod}, ${Math.round(d)} m): ${(info.tris / 1e3).toFixed(0)}k tris, ${info.ms} ms`);
    } catch (e) { console.error('[city] landmark ' + b.id + ' failed:', e.stack || e); }
  }
  const W = engine.registry.water;
  if (W?.reflection?.hidden) W.reflection.hidden.push(...H.reflectHidden);
  // footprints: houses, 御街, lanes, canals (the vegetation keeps off them; the yards stay free for trees)
  const fp = engine.footprints;
  if (fp) {
    for (const h of plan.houses) fp.addRect(h.x, h.z, h.w / 2 + 0.3, h.d / 2 + 0.3, h.rot, 'house');
    const F = plan.frame;
    const yj = [];
    for (let v = 0; v <= plan.vMax + 60; v += 40) yj.push(F.toWorld(0, v));
    fp.addPath(yj, L.CITY.yujie.width / 2 + 0.5, 'street');
    for (const ln of plan.lanes) {
      const a = F.toWorld(-1300, ln.v), b = F.toWorld(1300, ln.v);
      fp.addPath([a, b], ln.w / 2, 'street');
    }
    for (const c of L.CITY.canals || []) fp.addPath(c.points, c.width / 2 + 1.5, 'canal');
  }
  const parts = { plan: Math.round(tPlan - t0), houses: 0 };
  for (const [name, path] of [['streets', '../city/streets.js'], ['walls', '../city/walls.js'], ['yards', '../city/yards.js'], ['shores', '../city/shores.js'], ['props', '../city/props.js'], ['smoke', '../city/smoke.js'], ['lamps', '../city/lamps.js']]) {
    const t = performance.now();
    const m = await optional(path);
    if (!m?.build) continue;
    try { reg[name] = await m.build(engine, plan); } catch (e) { console.error(`[city] ${name} failed:`, e.stack || e); }
    parts[name] = Math.round(performance.now() - t);
  }
  console.log(`[city] built in ${Math.round(performance.now() - t0)} ms ${JSON.stringify(parts)}; ${plan.houses.length} houses, ${plan.courtyards.length} yards, quality ${q.name}`);
}

// ------------------------------------------------------------------------------------------------ test
export async function test(engine) {
  hookLooks(engine);
  const P = engine.params;
  const lod = Number(P?.get?.('lod') ?? 0);
  const snow = Number(P?.get?.('snow') || 0), night = Number(P?.get?.('night') || 0);
  setBuildingLook({ snow, night });
  // a street like 御街: two rows of shops facing each other across 22 m, lanes behind
  const kit = houseKit({ lod, variants: VARIANTS.length, seed: 'linan', overrides: VARIANTS, ao: lod <= 1 });
  const pl = [];
  for (const side of [-1, 1]) {
    let z = -60;
    let i = 0;
    while (z < 60) {
      const v = side < 0 ? i % 6 : (i * 5 + 3) % VARIANTS.length;
      const V = VARIANTS[v];
      pl.push({ x: side * (11 + V.depth / 2), y: 0, z: z + V.width / 2, rot: side < 0 ? Math.PI / 2 : -Math.PI / 2, variant: v });
      z += V.width + 0.1; i++;
    }
    // a second row behind, facing the lane at x = ±(11 + 14 + 4)
    z = -60; i = 0;
    while (z < 60) {
      const v = 6 + (i % 8);
      const V = VARIANTS[v];
      pl.push({ x: side * (29.5 + V.depth / 2), y: 0, z: z + V.width / 2, rot: side < 0 ? -Math.PI / 2 : Math.PI / 2, variant: v });
      z += V.width + 0.1; i++;
    }
  }
  engine.add(instanceHouses(kit, pl, { name: 'test-street' }));
  console.log(`[city] test: lod ${lod}, kit tris ${kit.variants.map((v) => Math.round(v.tris)).join(' ')}`);
  const sun = night ? { azimuth: 210, elevation: -10 } : { azimuth: 111, elevation: 18 };
  const look = { snow, night };
  return { views: [
    { pos: [-3, 2.2, -50], target: [2, 5, 0], fov: 50, sun, ...look },
    { pos: [4, 70, -150], target: [0, 0, 10], fov: 37.6, sun, ...look },
    { pos: [40, 22, -10], target: [10, 4, 10], fov: 45, sun, ...look },
  ] };
}
