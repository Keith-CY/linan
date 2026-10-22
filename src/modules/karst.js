// KARST: the 飞来峰 limestone cliff over 冷泉溪 with the 布袋弥勒 carving and its small niches (shot 8).
//
// build(engine): the cliff field of src/karst/feilai.js meshed in nested regions (far 38 cm → near 9.5 cm → niche
//   3 cm → the face 1.1 cm, the small figures 1.4–2.1 cm; preview 1.6× coarser), baked to generated/karst-feilai-*.bin
//   (node tools/bake.mjs karst; without the bake the regions are meshed at load, ~1 min).
//   Publishes engine.registry.karst = { feilai: { sdf, budai, small, group }, materials } and anchor points for the
//   vegetation: engine.slots.ivy (vines over the rim and across the 布袋 niche, { pos, facing, size, drop, tag }) and
//   engine.slots.planter (soil ledges on the face, tag 'karst-ledge'). registry.karst.feilai.sdf(x, y, z) is the rock
//   surface (world metres, < 0 inside): vines should hang against it rather than the heightfield placeholder.
// test(engine): node tools/render.mjs --test karst --view N [--params "cam=x,y,z,tx,ty,tz,fov&kparts=niche,head"]
//   0 the shot-8 camera · 1 the 布袋 niche · 2 the face close up · 3 the step and the standing figure · 4 the cliff
//   from above the stream · 5 = cam (the terrain is built for the views; season autumn; the sun of view 0–4 is az 265,
//   el 28 from the camera side, which is what ref08's lit carving needs — the shot-8 look keeps its own sun)
import * as THREE from 'three';
import { makeFeilai } from '../karst/feilai.js';
import { meshRegion } from '../karst/build.js';
import { toGeometry } from '../sculpt/mesher.js';
import { loadOrBuild, lazyBake } from '../core/cache.js';
import { karstMaterial, setKarstSeason } from '../karst/material.js';

export const KARST_VERSION = 'v4';   // v4: the 布袋 seated cross-legged (ink08); v3: the bigger 布袋 and its niche, vertical jointing
const q = (detail) => (detail >= 1 ? 'hi' : 'lo');
export const feilaiName = (region, detail) => `karst-feilai-${region}-${q(detail)}-${KARST_VERSION}`;

/** the cliff geometries (baked when available) → { F, origin, parts: [{ name, geo, lazy }] }; lazy: placeholders
 *  filled when their bake is loaded (src/core/cache.js lazyBake; the explorable world, src/explore/lazy.js) */
export async function feilaiGeometries(detail = 1, F = makeFeilai(), lazy = false) {
  const regions = F.regions(detail);
  const origin = F.budai.origin.map((v) => Math.round(v));
  const parts = [];
  for (const R of regions) {
    const build = () => toGeometry(meshRegion(F.sdf, regions, R.name, { origin, carved: F.carved }));
    const name = feilaiName(R.name, detail);
    if (lazy) { const r = await lazyBake(name, build); parts.push({ name: R.name, geo: r.geo, lazy: r.lazy }); }
    else parts.push({ name: R.name, geo: await loadOrBuild(name, build) });
  }
  return { F, origin, parts, regions };
}

function feilaiMaterial() {
  // grey-green limestone with moss (ref08); fewer black lichen colonies and streaks than the generic rock
  return karstMaterial({ name: 'karst-feilai', moss: 0.75, lichen: 0.3, streaks: 0.45, strata: 0.4, ochre: 0.1, variation: 0.08, tint: 0xbcc2b6 });
}

export async function build(engine) {
  const t0 = performance.now();
  const detail = engine.quality.detail ?? 1;
  // the explorable world loads the baked cliff when the walker comes near (src/explore/lazy.js; ?lazyBakes=0: at load)
  const lazy = engine.explore && engine.params?.get?.('lazyBakes') !== '0';
  const liveSet = engine.explore && detail > 0.5 && engine.params?.get?.('karstLive') !== 'full';
  const { F, origin, parts } = await feilaiGeometries(detail, undefined, lazy);
  const lazyList = (engine.registry.lazyBakes ||= []);
  const mat = feilaiMaterial();
  const group = new THREE.Group();
  group.name = 'karst:feilai';
  let tris = 0;
  const only = engine.params?.get?.('kparts');                       // debug: ?kparts=niche,head
  for (const p of parts) {
    if (only && !only.split(',').some((o) => p.name.startsWith(o))) continue;
    const m = new THREE.Mesh(p.geo, mat);
    m.name = 'karst:feilai:' + p.name;
    m.position.set(...origin);
    if (p.name.startsWith('far')) m.userData.castShadow = false;   // the outer cliff casts nothing into the shot-8 view worth 4 cascades
    group.add(m);
    tris += p.geo.index ? p.geo.index.count / 3 : 0;
    if (p.lazy) lazyList.push({ lazy: p.lazy, mesh: m, level: liveSet ? 'still' : 'live' });
  }
  engine.add(group, { castShadow: true, receiveShadow: true });
  // the explorable world walks with the cliff at half detail (a quarter of the triangles); the still view
  // (src/explore/still.js) shows the stills' full-detail cliff
  if (liveSet) {
    const L = await feilaiGeometries(0.5, F, lazy);
    const live = new THREE.Group(); live.name = 'karst:feilai:live';
    for (const p of L.parts) {
      const m = new THREE.Mesh(p.geo, mat);
      m.name = 'karst:feilai:live:' + p.name;
      m.position.set(...L.origin);
      if (p.name.startsWith('far')) m.userData.castShadow = false;
      live.add(m);
      if (p.lazy) lazyList.push({ lazy: p.lazy, mesh: m, level: 'live' });
    }
    engine.add(live, { castShadow: true, receiveShadow: true });
    group.visible = false;
    (engine.registry.stillSwap ||= []).push({ live, still: group });
  }
  const season = () => setKarstSeason([mat], engine.registry.season);
  season();
  engine.onShot(season);
  // the rock step and the face foot are occupied (no trees inside the rock)
  engine.footprints?.addCircle(F.budai.origin[0], F.budai.origin[2], 5.5, 'karst');
  for (let x = -3990; x <= -3860; x += 6) engine.footprints?.addCircle(x, F.footZ(x) + 2.5, 3.5, 'karst');
  for (const s of F.ivy) engine.slots.ivy.push(s);
  for (const s of F.ledges) engine.slots.planter.push(s);
  engine.registry.karst = { ...(engine.registry.karst || {}), feilai: { sdf: F.sdf, budai: F.budai, small: F.small, group, ivy: F.ivy, ledges: F.ledges }, materials: [...(engine.registry.karst?.materials || []), mat] };
  console.log(`[karst] 飞来峰 cliff: ${parts.length} regions, ${(tris / 1e6).toFixed(2)} M tris, ${Math.round(performance.now() - t0)} ms`);
}

export async function test(engine) {
  for (const o of engine.scene.children) if (o.name === 'testGround') o.visible = false;
  engine.registry.season = 'autumn';
  await build(engine);
  const K = engine.registry.karst.feilai;
  const o = K.budai.origin, f = K.budai.fwd, s = K.budai.scale;
  const right = [f[1], -f[0]];
  const P = (along, up, out) => [o[0] + right[0] * along + f[0] * out, o[1] + up, o[2] + right[1] * along + f[1] * out];
  const head = [o[0] + right[0] * -0.05 * s + f[0] * 0.5 * s, o[1] + 3.17 * s, o[2] + right[1] * -0.05 * s + f[1] * 0.5 * s];
  const sun = { azimuth: 265, elevation: 28 };
  const views = [
    { pos: [-3978, 28.2, 439], target: [-3880.2, 49.0, 441.4], fov: 45, sun },
    { pos: P(-1.2, 0.6, 10.5), target: P(-0.3, 2.0, 0), fov: 34, sun },
    { pos: [head[0] + f[0] * 3.2 - right[0] * 0.5, head[1] - 0.25, head[2] + f[1] * 3.2 - right[1] * 0.5], target: head, fov: 30, sun },
    { pos: P(6.5, -0.4, 9.5), target: P(4.2, 0.8, 0), fov: 40, sun },
    { pos: [-3990, 42, 410], target: [-3940, 36, 445], fov: 50, sun },
  ];
  // cam=x,y,z,tx,ty,tz[,fov]: an extra custom view at the end of the list (index views.length)
  const cam = engine.params?.get?.('cam');
  if (cam) { const v = cam.split(',').map(Number); views.push({ pos: v.slice(0, 3), target: v.slice(3, 6), fov: v[6] || 40, sun }); }
  const { buildTerrain } = await import('./terrain.js');
  await buildTerrain(engine, { cams: views });
  return { views: views.map((v) => ({ ...v, season: 'autumn' })) };
}
