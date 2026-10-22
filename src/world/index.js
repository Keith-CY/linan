// Builds the full world by running each module's build(engine) in dependency order.
// A failing module is logged and skipped so one broken piece never blanks the whole world; a module file that does
// not exist yet is skipped quietly (the list names the planned modules too).
// Order matters: terrain → water (captures the terrain height) → architecture → the rest → mist.
//
// Before any module builds, engine.registry.season ('spring'|'summer'|'autumn'|'winter') and engine.registry.night
// (boolean) are set from the look of the start shot (?shot=N, default 1; src/world/looks.js), and they are updated on
// every engine.applyShot() BEFORE the modules' own onShot hooks run. Modules that build season-specific content
// either build every variant and switch in onShot, or read the start values (renders build per shot).
import * as THREE from 'three';
import { LOOKS } from './looks.js';
import { heightAt } from './heightfield.js';
import { SHOTS } from './shots.js';
import { setPlanCams } from './plancams.js';

export const MODULE_ORDER = [
  'terrain',      // lake bed, shores, plain, hills, hill country, river, distant ranges
  'water',        // West Lake, the canals and the Qiantang: calm mirror, planar reflection
  'yingzao',      // timber buildings from layout.HALLS by the 营造法式 generator
  'pagodas',      // layout.PAGODAS: 雷峰, 六和, 保俶, 三潭 lanterns, city and hill pagodas
  'karst',        // 飞来峰 limestone cliff and the 布袋弥勒 carving
  'rocks',        // tuff, banks, shore stones, 太湖石 across the world
  'bridges',      // layout.BRIDGES
  'city',         // Lin'an blocks, walls, canal banks
  'boats',        // layout.BOATS and canal traffic
  'tide',         // the 钱塘潮 bore on the Qiantang, shown in shot 9
  'vegetation',   // trees, lotus, willows and peach on the causeways, hero trees
  'mist',         // mist lying on the lake
];

/** season / night of a shot id from its look */
export function seasonOf(id) {
  const L = LOOKS[id] || LOOKS[Number(id)] || {};
  return { season: L.season || 'spring', night: !!L.night };
}

export async function buildWorld(engine) {
  const skip = (engine.params.get('skip') || '').split(',').filter(Boolean);
  const only = (engine.params.get('only') || '').split(',').filter(Boolean);
  const start = seasonOf(engine.params.get('shot') || 1);
  engine.registry.season = engine.params.get('season') || start.season;
  engine.registry.night = engine.params.get('night') ? engine.params.get('night') === '1' : start.night;
  // the ink look plans the world for the ink cameras too (terrain leaves, house levels, vegetation cover and clearings)
  if (engine.params.get('look') === 'ink' && engine.params.get('inkCam') !== '0') {
    const { INK_CAMS, INK_VIEW_RULES, INK_HEROES } = await import('../ink/styles.js');
    setPlanCams(Object.entries(INK_CAMS).map(([id, c]) => ({ ...SHOTS.find((s) => s.id === Number(id)), ...c, id: Number(id), ink: true, viewRule: INK_VIEW_RULES?.[id], heroes: INK_HEROES?.[id] })));
  }
  engine.onShot((shot) => {
    const s = seasonOf(shot.id);
    engine.registry.season = shot.season || s.season;
    engine.registry.night = shot.night ?? s.night;
  });
  // progress for a loading screen (engine.onProgress(fraction, moduleName)), weighted by each module's usual build time;
  // the event loop gets a frame between modules so the page can paint it
  const WEIGHT = { terrain: 4, water: 2, yingzao: 14, pagodas: 3, karst: 2, rocks: 3, bridges: 2, city: 8, boats: 2, tide: 1, vegetation: 8, mist: 0.5 };
  const todo = MODULE_ORDER.filter((n) => !(skip.includes(n) || (only.length && !only.includes(n))));
  const total = todo.reduce((s, n) => s + (WEIGHT[n] || 1), 0);
  let done = 0;
  const tick = async (name) => {
    engine.onProgress?.(done / total, name);
    if (engine.onProgress) await new Promise((r) => (typeof requestAnimationFrame === 'function' ? requestAnimationFrame(() => setTimeout(r, 0)) : setTimeout(r, 0)));
  };
  for (const name of MODULE_ORDER) {
    if (skip.includes(name) || (only.length && !only.includes(name))) continue;
    await tick(name);
    done += WEIGHT[name] || 1;
    let mod;
    try {
      mod = await import(`../modules/${name}.js`);
    } catch (e) {
      const msg = String(e);
      if (msg.includes('Failed to fetch') || msg.includes('404') || msg.includes('Cannot find module')) { console.log(`[world] module ${name}: not present`); continue; }
      console.error(`[world] module ${name} failed to load:`, e.stack || e);
      continue;
    }
    if (typeof mod.build !== 'function') continue;
    const t0 = performance.now();
    const before = new Set(engine.scene.children);
    try {
      await mod.build(engine);
      (engine.moduleRoots ||= {})[name] = engine.scene.children.filter((c) => !before.has(c));
      console.log(`[world] ${name} built in ${Math.round(performance.now() - t0)} ms`);
    } catch (e) {
      console.error(`[world] module ${name} threw during build:`, e.stack || e);
    }
  }
  engine.onProgress?.(1, 'done');
  // per-shot terrain occlusion assumes the fixed shot cameras: not in the explorable world
  if (engine.params.get('occlusion') !== '0' && !engine.explore) terrainOcclusion(engine);
}

/**
 * Terrain occlusion: per shot, every building, pagoda, bridge, boat and city block whose sample
 * points (top corners, top centre, middle) are all hidden from the camera by the heightfield is moved off the camera's
 * layer, so it costs nothing in the main pass or the shadow cascades (shot 8 in the 灵隐 valley drew the palace, the city
 * and the lake halls 4–6 km behind the hills). Cached per shot id; ?occlusion=0 turns it off.
 */
function terrainOcclusion(engine) {
  const OFF = 1 << 7;
  const cache = new Map();
  let hidden = [];
  const roots = () => ['yingzao', 'pagodas', 'bridges', 'boats', 'city', 'rocks'].flatMap((n) => engine.moduleRoots?.[n] || []);
  const box = new THREE.Box3();
  const blocked = (C, P) => {
    const dx = P[0] - C[0], dy = P[1] - C[1], dz = P[2] - C[2], d = Math.hypot(dx, dz);
    const n = Math.min(120, Math.max(8, Math.ceil(d / 15)));
    for (let i = 1; i < n; i++) {
      const t = i / n;
      if (d * t < 30 || d * (1 - t) < 20) continue;      // near the camera / the object: its own ground
      if (heightAt(C[0] + dx * t, C[2] + dz * t) > C[1] + dy * t + 1.0) return true;
    }
    return false;
  };
  const occluded = (C, o) => {
    box.setFromObject(o);
    if (box.isEmpty()) return false;
    const { min, max } = box;
    const cx = (min.x + max.x) / 2, cz = (min.z + max.z) / 2;
    if (Math.hypot(cx - C[0], cz - C[2]) - Math.hypot(max.x - min.x, max.z - min.z) / 2 < 250) return false;
    const pts = [];
    const big = Math.max(max.x - min.x, max.z - min.z) > 300;
    const g = big ? 7 : 2;
    for (let i = 0; i < g; i++) for (let j = 0; j < g; j++) pts.push([min.x + ((max.x - min.x) * i) / (g - 1), max.y, min.z + ((max.z - min.z) * j) / (g - 1)]);
    pts.push([cx, max.y, cz], [cx, (min.y + max.y) / 2, cz]);
    return pts.every((P) => blocked(C, P));
  };
  const setOff = (o, off) => o.traverse((m) => {
    if (off) { if (m.userData._occMask === undefined) m.userData._occMask = m.layers.mask; m.layers.mask = OFF; }
    else if (m.userData._occMask !== undefined) { m.layers.mask = m.userData._occMask; delete m.userData._occMask; }
  });
  engine.onShot((shot) => {
    for (const o of hidden) setOff(o, false);
    const key = String(shot.id) + '|' + shot.pos.join(',');
    let list = cache.get(key);
    if (!list) {
      const t0 = performance.now();
      list = roots().filter((o) => occluded(shot.pos, o));
      cache.set(key, list);
      console.log(`[world] terrain occlusion for shot ${shot.id}: ${list.length} objects hidden (${Math.round(performance.now() - t0)} ms)`);
    }
    for (const o of list) setOff(o, true);
    hidden = list;
  });
}
