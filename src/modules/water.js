// WATER: West Lake, the city canals and the Qiantang at y = 0.
//
//   build(engine): captures the meshed terrain height from above (GPU) → water depth / shoreline (one fine "near"
//   map per region: the lake, the city canals, the river at 六和塔 / 凤凰山; the surface samples the map of the region
//   the current camera is in, switched in onShot) plus one coarse map of the whole world, a still flow field (slow
//   wind drift), the FFT ripple tile, the planar reflection and the two-pass water surface (src/water/surface.js).
//   Per shot (onShot): the region map, the season (shore ice in winter), the shot's water preset (REGION_WATER and
//   WATER_SHOTS below, then LOOKS[id].water, then shot.waterTune), the boats' wakes and the lotus pond.
//   Publishes engine.registry.water = { level, maps, regions, ground, depthAt, surface, uniforms, reflection, ocean,
//   heightTexture, heightBounds, setBoats, setPond, region(shot) }.
import * as L from '../world/layout.js';
import { LOOKS } from '../world/looks.js';
import { captureHeightMap } from '../water/heightmap.js';
import { OceanTile } from '../water/ocean.js';
import { PlanarReflection } from '../water/reflection.js';
import { buildStillFlow } from '../water/flow.js';
import { createWaterSurface } from '../water/surface.js';
import { makeGround } from '../water/ground.js';
import { bindMistHeights } from '../water/mistfield.js';
import { buildStreams } from '../water/stream.js';

export const NEAR_BOUNDS = [-1900, -2500, 1900, 1700];           // West Lake
export const REGION_BOUNDS = {
  lake: NEAR_BOUNDS,
  city: [1900, -3000, 3300, 2600],                                  // 市河 / 盐桥运河 (shot 7)
  river: [-4200, 1950, 4200, 7000],                                 // the Qiantang at 六和塔 and below 凤凰山 (shots 6, 9; its bank passes ~100 m from the palace mesa)
};
export const FAR_BOUNDS = [-24000, -24000, 24000, 24000];
const inB = (b, x, z, m = 0) => x > b[0] - m && x < b[2] + m && z > b[1] - m && z < b[3] + m;

// ------------------------------------------------------------------ per-region and per-shot water
// Surface uniforms (src/water/surface.js) by region, then by shot. Arrays set vectors. Read against the references:
//   lake  — slightly turbid jade-grey West Lake, a light air: glassy mirror with soft drifting ripple patches
//   river — the silty grey-brown Qiantang
//   city  — dark green-grey canal water, sheltered
const REGION_WATER = {
  lake: {},
  city: { uScatter: [0.02, 0.03, 0.028], uTurbid: 2.0, uWaveAmp: [0.008, 0.01, 0.01, 0.002], uPatch: [60, 200, 8, 0.25] },
  river: { uMudK: 1, uTurbid: 6.0, uAbsorb: [1.6, 1.4, 1.3], uSkyRefl: [0.9, 0.92, 0.94], uWaveAmp: [0.025, 0.035, 0.03, 0.006],
    uWind: [0.97, -0.24, 0.8, 0.35], uPatch: [260, 700, 30, 0.6] },
};
export const WATER_SHOTS = {
  // 1 panorama, spring dawn: a silver mirror; soft cat's paws and slick streaks; far water veiled by the lying mist
  1: { uWaveAmp: [0.009, 0.013, 0.011, 0.003], uWind: [0.5, 0.866, 0.8, 0.12], uPatch: [230, 650, 20, 0.32] },
  // 2 苏堤 dawn: white-grey, glassy, a few faint ripples
  2: { uWaveAmp: [0.012, 0.016, 0.012, 0.0025], uWind: [0.94, 0.34, 1.0, 0.12], uPatch: [90, 300, 9, 0.25] },
  // 3 lotus pond, summer noon: blue-grey water, crisp reflections of the halls; dark water among the leaves
  3: { uWaveAmp: [0.014, 0.02, 0.016, 0.004], uWind: [0.7, 0.71, 1.0, 0.15], uPatch: [60, 200, 7, 0.3], uScatter: [0.02, 0.034, 0.036] },
  // 4 雷峰夕照: a breeze (rippled water, dark warm brown), a broken gold glitter path under the low sun
  4: { uWaveAmp: [0.06, 0.085, 0.06, 0.01], uWaveScale: [64, 19, 6.2, 1.9], uWind: [-0.62, -0.78, 0.45, 0.55], uPatch: [70, 240, 8, 0.75],
    uGlitter: [0.7, 0.3, 2.5, 0.0006], uSunSpec: [0.55, 0], uReflTaps: [0.7, 0.0, 1.0, 1.0],
    uScatter: [0.03, 0.022, 0.014], uSkyRefl: [0.62, 0.55, 0.46], uReflGain: 1.1 },
  // 5 三潭印月 night: fine ripples; the moon path and long broken streaks under the lanterns
  5: { uWaveAmp: [0.012, 0.03, 0.04, 0.01], uWind: [-0.8, -0.6, 0.5, 0.45], uPatch: [80, 260, 10, 0.75], uGlitter: [1.0, 0.2, 1.8, 0.0006], uSunSpec: [0.45, 0],
    uWaveScale: [24.0, 8.1, 2.6, 0.83], uScatter: [0.008, 0.014, 0.02], uSkyRefl: [1.0, 1.0, 1.0], uReflTaps: [0.75, 0.0002, 1.0, 1.0], uReflAniso: 2.6 },
  // 9 六和塔 · 钱塘潮: silty river under a breeze; the tide module adds the bore
  9: { uWaveAmp: [0.03, 0.045, 0.04, 0.008], uWind: [0.97, -0.24, 0.7, 0.4], uPatch: [260, 700, 30, 0.7] },
  // 10 断桥残雪: still winter water (dark, a crisp mirror of the snow) beyond the shore ice
  10: { uWaveAmp: [0.008, 0.012, 0.01, 0.002], uWind: [0.6, 0.8, 1.0, 0.1], uPatch: [80, 240, 9, 0.2], uScatter: [0.012, 0.02, 0.026], uSkyRefl: [0.8, 0.9, 1.06],
    uIce: [1, 2.05, 0.85, 0.6] },
};
// boat wake parameters by type (layout BOATS carry position, heading, length; the boats themselves are another module's)
const WAKE = { huafang: { beam: 3.6, speed: 0, rings: 0.25 }, skiff: { beam: 1.3, speed: 0.9, rings: 0.4 }, wupeng: { beam: 1.8, speed: 0, rings: 0.3 },
  cargo: { beam: 3.0, speed: 0, rings: 0.25 }, junk: { beam: 5.0, speed: 0, rings: 0.2 } };

export async function build(engine) {
  const t0 = performance.now();
  const q = engine.quality;
  const level = L.WATER_LEVEL;
  // the explorable world (engine.explore) streams its terrain, so nothing is meshed yet: analytic heights from workers
  const cap = async (bounds, res) => {
    if (!engine.explore) return captureHeightMap(engine, { bounds, res });
    const [x0, z0, x1, z1] = bounds, aspect = (x1 - x0) / (z1 - z0);
    const W = aspect >= 1 ? res : Math.round(res * aspect), H = aspect >= 1 ? Math.round(res / aspect) : res;
    const { getHeightPool } = await import('../explore/heightpool.js');
    return captureHeightMap(engine, { bounds, res, grid: await getHeightPool().grid(bounds, W, H) });
  };
  const res = q.detail >= 1 ? 2048 : 1536;
  const [near, city, river, far] = await Promise.all([cap(NEAR_BOUNDS, res), cap(REGION_BOUNDS.city, res), cap(REGION_BOUNDS.river, res), cap(FAR_BOUNDS, 1024)]);
  const maps = { near, far };
  const regions = { lake: near, city, river };
  const ground = makeGround([near, city, river, far]);
  const depthAt = (x, z) => level - ground.H(x, z);
  const flow = buildStillFlow({ bounds: NEAR_BOUNDS, res: 160 });
  // light air (~2 m/s): long, very low ripples — the lake reads as a soft mirror
  const ocean = new OceanTile({ n: 256, size: 24, wind: 2.2, windDir: 0.7, seed: 1103 });
  const reflection = new PlanarReflection(engine, { level, scale: q.name === 'explore' ? 0.35 : q.name === 'preview' ? 0.5 : 0.75 });
  const water = createWaterSurface(engine, { maps, flow, ocean, reflection, level });
  const U = water.uniforms;
  // West Lake: shallow, slightly turbid jade-grey water; the bed vanishes within ~1 m
  U.uAbsorb.value.set(1.1, 0.75, 0.85);
  U.uScatter.value.set(0.032, 0.048, 0.046);
  U.uSkyRefl.value.set(0.95, 0.96, 0.97);
  U.uWaveAmp.value.set(0.012, 0.016, 0.012, 0.0025);
  U.uReflGain.value = 1.3;
  U.uShoreFoam.value = 0.1;
  engine.add(water.group, { castShadow: false, receiveShadow: true });
  bindMistHeights(near, far);
  // the 冷泉溪 at 灵隐 and its pool (ink08) hold water at the stream's own level (src/water/stream.js)
  const stream = buildStreams({ footprints: engine.footprints });
  if (stream) { engine.add(stream, { castShadow: false, receiveShadow: true }); reflection.hidden.push(stream); }

  // wakes: the boats of the layout (moored ones only ripple round the hull)
  const boats = (L.BOATS || []).map((b) => ({ x: b.at[0], z: b.at[1], heading: b.heading, length: b.length || 8, shot: b.shot || [], ...(WAKE[b.type] || WAKE.huafang) }));
  // the lotus pond of 曲院风荷
  const lotus = (L.PLANTS || []).find((p) => p.species === 'lotus' && p.polygon);
  if (lotus) water.setPond(lotus.polygon);

  engine.onUpdate((t) => { ocean.update(t); U.uTime.value = t; });
  const debug0 = U.uDebug.value;
  // build-time values of every tunable uniform (the reflection's own matrices are never reset: the reflection is
  // cached per camera pose, and resetting its matrices on a re-applied shot left the mirror blank)
  const OWN = new Set(Object.keys(reflection.uniforms));
  const SKIP = new Set(['uTime', 'uHNearB', 'uDebug', 'uFrameW', 'uReflPix', 'uBoat', 'uBoatB', 'uBoatN', 'uPondPts', 'uPondN', 'uBore', 'uBoreB', 'uBoreT', 'uSunIrr']);
  const defaults = Object.fromEntries(Object.entries(U).filter(([k, u]) => !OWN.has(k) && !SKIP.has(k) && !k.startsWith('t') && !k.startsWith('uLm') && !u.value?.isTexture)
    .map(([k, u]) => [k, u.value?.clone ? u.value.clone() : u.value]));
  const set = (k, v) => {
    const u = U[k]; if (!u) return;
    if (Array.isArray(v) && u.value?.fromArray) u.value.fromArray(v); else u.value = v;
  };
  const regionOf = (shot) => {
    const [cx, , cz] = shot.pos || [0, 0, 0];
    return Object.entries(REGION_BOUNDS).find(([, b]) => inB(b, cx, cz, -50))?.[0] || 'lake';
  };
  engine.onShot((shot) => {
    U.uDebug.value = shot.waterDebug ?? debug0;
    reflection._key = '';   // re-render the mirror for the new shot (look, season, visibility may have changed)
    // the fine height map of the region the camera is in (depth, shore foam, soft edges)
    const reg = regionOf(shot);
    const m = regions[reg] || near;
    if (m?.tex && U.tHNear) { U.tHNear.value = m.tex; U.uHNearB.value.set(...m.bounds); }
    for (const [k, v] of Object.entries(defaults)) { const u = U[k]; if (u.value?.copy && v?.clone) u.value.copy(v); else u.value = v; }
    if (engine.registry.season === 'winter') set('uIce', [1, 1.4, 0.8, 0.6]);
    const tune = { ...(REGION_WATER[reg] || {}), ...(WATER_SHOTS[shot.id] || {}), ...(LOOKS[shot.id]?.water || {}), ...(shot.waterTune || {}) };
    for (const [k, v] of Object.entries(tune)) set(k, v);
    if (engine.registry.season !== 'winter' && !shot.waterTune?.uIce) U.uIce.value.x = 0;
    water.setBoats(boats.filter((b) => b.shot.includes(shot.id) || dist2(b, shot) < 1500 * 1500));
    const sky = engine.registry.skyEnvScale;
    if (sky) U.uEnvBoost.value = 1 / sky;
  });

  engine.registry.water = {
    level, maps, regions, ground, depthAt, surface: water.surface, uniforms: U, reflection, ocean,
    heightTexture: near.tex, heightBounds: near.bounds, setBoats: water.setBoats, setPond: water.setPond, region: regionOf,
  };
  console.log(`[water] built in ${Math.round(performance.now() - t0)} ms (capture near ${near.W}x${near.H} ${near.ms} ms, ${near.meshes} meshes; far ${far.ms} ms; ${boats.length} boat wakes)`);
}
function dist2(b, shot) { const p = shot.pos || [0, 0, 0]; return (b.x - p[0]) ** 2 + (b.z - p[2]) ** 2; }

// ------------------------------------------------------------------ test
// node tools/render.mjs --test water --view N  (terrain + water only, the shot's look)
//   0: the lake from the 宝石山 height at dawn (mirror, patches, far reflections)   1: low over the water at sunset (glitter)
//   2: night, low (moon path)   3: winter shore ice (断桥)   4: the lotus pond water
export async function test(engine) {
  const terrain = await import('./terrain.js');
  for (const o of engine.scene.children) if (o.name === 'testGround') o.visible = false;
  const views = [
    { id: 1, pos: [276.4, 93, -2246], target: [269.8, 90, -2146.3], fov: 20 },
    { id: 4, pos: [584.7, 2.2, 1189.5], target: [509.2, 12.8, 1254.2], fov: 19.6 },
    { id: 5, pos: [125, 1.6, 720], target: [203.8, 3.1, 781.6], fov: 30 },
    { id: 10, pos: [687.5, 5, -1635.4], target: [615.3, 7.5, -1704.5], fov: 37.3 },
    { id: 3, pos: [-926, 2.0, -953], target: [-859.6, 2.4, -1027.8], fov: 19 },
  ];
  const v = views[Number(engine.params.get('view') || 0)] || views[0];
  engine.registry.season = LOOKS[v.id]?.season || 'spring';
  engine.registry.night = !!LOOKS[v.id]?.night;
  await terrain.buildTerrain(engine, { cams: views });
  const { setTerrainSeason } = await import('../terrain/material.js');
  setTerrainSeason(engine.registry.season);
  await build(engine);
  return { views: views.map((x) => ({ ...x, near: 0.5, far: 60000 })) };
}
