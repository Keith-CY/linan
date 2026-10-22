// YINGZAO: the buildings of the world, built by the 《营造法式》 generator (src/yingzao/).
//
// build(engine): every entry of layout.BUILDINGS (and the older layout.HALLS) on its spot:
//   { id, kind, center: [x, z], facing: compass deg, y?: absolute floor height (default: terrain + base height),
//     params: {...kind parameters}, lod?: 0 | 1 | 2 }
//   kinds: see BUILDERS in src/yingzao/buildings.js (hall, chongyan, louge, ting, shuixie, qiao, lang, menwu,
//   menlou, que, gulou, temple presets …). Pagoda kinds are left to modules/pagodas.js.
//   layout.HALLS uses the layout's schema (kind 'dian' / 'tingtang' / 'louge' / 'ting' / 'xie' / 'lang' / 'men' /
//   'que' with eaves, storeys, span, podium, base, path, onWater, level); fromHall() maps it.
// Shot looks: a shot (or its look) may carry `snow: 0..1` and `night: 0..1`; the building materials follow.
//
// test(engine):  node tools/render.mjs --test yingzao --view N --params "b=<kind>&p=<json params>&lod=0&snow=0&night=0"
//   views per building: 0 front three-quarter, 1 under the eaves (brackets), 2 side / gable, 3 high oblique.
//   b=gallery&kinds=a,b,c lays several kinds out in a row.
import * as L from '../world/layout.js';
import { heightAt } from '../world/heightfield.js';
import * as THREE from 'three';
import { buildBuilding } from '../yingzao/buildings.js';
import { buildChengtai, buildStair } from '../yingzao/chengtai.js';
import { buildHouse, houseKit, instanceHouses } from '../yingzao/house.js';
import { setBuildingLook } from '../yingzao/materials.js';
import { PAINT } from '../yingzao/geom.js';
import { SHOTS } from '../world/shots.js';

/**
 * Level of detail for a placed building: an explicit `lod` wins; otherwise from the nearest camera among the shots
 * the entry is listed in (layout `shot: [...]`): < 160 m full detail, < 600 m lod 1 (no tile rows, block brackets),
 * farther (or no shot) lod 2 (massing). `?lod=N` on the page forces one level everywhere.
 */
export function autoLod(engine, e, size = 20) {
  const force = engine?.params?.get?.('lod');
  if (force !== null && force !== undefined && force !== '') return Number(force);
  if (e.lod !== undefined && e.lod !== null) return e.lod;
  const shots = (e.shot || []).map((id) => SHOTS.find((s) => s.id === id)).filter(Boolean);
  if (!shots.length || !e.center) return 2;
  const d = Math.min(...shots.map((s) => Math.hypot(s.pos[0] - e.center[0], s.pos[2] - e.center[1])));
  const k = d / Math.max(10, size);
  return d < 160 || k < 8 ? 0 : d < 600 ? 1 : 2;
}

/** baked AO of the buildings: on for stills; the explorable world skips it (80 % of the build time) unless ?yzAo=1
 *  (or a cell size in metres, ?yzAo=0.16) */
export function aoOpt(engine) {
  const p = engine?.params?.get?.('yzAo');
  if (p !== null && p !== undefined && p !== '') return p === '1' ? true : p === '0' ? false : Number(p);
  return engine?.explore ? false : undefined;
}

/**
 * The explorable world: a building is built at lod ≤ 1 (any place can be walked up to) plus its lod-2 massing, both
 * in one group; engine.registry.lodSwitch lists them and src/explore swaps them by the distance from the camera.
 * build(l) → { group, info }. Returns { group, info } of the near level (info.size, baseH for placement).
 */
export function exploreLod(engine, build, lod, center, { far = 2 } = {}) {
  const l0 = Math.min(lod, 1);
  const near = build(l0);
  if (l0 >= far) return near;
  const farB = build(far);
  const g = new THREE.Group();
  near.group.name += ':near'; farB.group.name += ':far';
  g.add(near.group, farB.group);
  farB.group.visible = false;
  const size = Math.max(...(near.info.size || [20, 20, 20]));
  // lod: the level a still builds (src/explore/still.js shows the far massing where a still has lod 2)
  // build: the builder itself (src/explore/lodfade.js builds a lod-1 middle level from it while the walker stands still)
  (engine.registry.lodSwitch ||= []).push({ near: near.group, far: farB.group, x: center[0], z: center[1], d: Math.max(380, size * 9), lod, build });
  return { group: g, info: near.info };
}

export const PAGODA_KINDS = /^(leifeng|liuhe|baochu|santan|jingchuang|stupa|pagoda|tower)$/;

/** snow from a winter look, lamplight from a night look (engine.registry, set by world/index.js before this hook
 *  runs); explicit shot.snow / shot.night win */
export function hookLooks(engine) {
  if (engine.__yzLook) return;
  engine.__yzLook = true;
  const apply = (shot = {}) => setBuildingLook({
    snow: shot.snow ?? (engine.registry.season === 'winter' ? 0.85 : 0),
    night: shot.night === true ? 1 : shot.night === false ? 0 : shot.night ?? (engine.registry.night ? 1 : 0),
  });
  apply();
  engine.onShot(apply);
}

/**
 * Map one layout.HALLS entry to a builder kind + params + placement. kind is a builder or preset of
 * src/yingzao/buildings.js; the older generic names (dian, tingtang, xie, men) are mapped too. Entry fields used:
 * eaves (2 → 重檐), storeys, span, podium, base (墩台 for men / gulou), path (廊), onWater, level, y, params.
 * Returns { kind, params, center, facing, y (absolute floor height or null), ground (level or null) }.
 */
export function fromHall(e) {
  const p = { ...(e.params || {}) };
  const W = L.WATER_LEVEL ?? 0;
  const eaves = e.eaves || 1;
  const water = !!e.onWater;
  let kind = { dian: 'hall', tingtang: 'hall', xie: 'shuixie', men: e.base ? 'menlou' : 'menwu' }[e.kind] || e.kind || 'hall';
  let params = p, center = e.center, facing = e.facing ?? 180;
  const floorY = e.y ?? (water ? e.level ?? 1 : null);
  if (kind === 'hall' && eaves >= 2) kind = 'chongyan';
  // a preset 亭 fixes its own plan and roof: keep only the 材 and 鋪作 from the generic params
  if (/^ting-/.test(kind)) params = { ...(p.grade ? { grade: p.grade } : {}), ...(p.puzuo ? { puzuo: p.puzuo } : {}) };
  if ((kind === 'ting' || /^ting-/.test(kind)) && eaves >= 2) params.eaves = 2;
  if (/^ting-(hex|oct)$/.test(kind) && (e.storeys || 1) >= 2) {
    // a two-storey polygonal 亭閣 (樓閣式): 腰檐 + 平坐 between the storeys, 攢尖 on top
    const sides = kind === 'ting-hex' ? 6 : 8, grade = p.grade ?? 5;
    const fen = 0.312 * ([0, 9, 8.25, 7.5, 7.2, 6.6, 6, 5.25, 4.5][grade] / 10) / 15;
    const side = (e.span?.[0] ?? (sides === 6 ? 3.2 : 2.6));
    kind = 'louge';
    params = { grade, roof: 'cuanjian', storeys: [
      { shape: 'poly', sides, sideW: side / fen, sideBuJian: 1, H0: 3.3 / fen, puzuo: p.puzuo ?? 5, walls: 'louge-s', type: 'tingtang' },
      { shape: 'poly', sides, sideW: (side * 0.92) / fen, sideBuJian: 1, H0: 2.7 / fen, puzuo: p.puzuo ?? 5, walls: 'louge-s', type: 'tingtang' },
    ] };
  }
  if (kind === 'ting' && e.span && params.side === undefined) {
    const cuan = /^(zanjian|cuanjian)$/.test(e.roof || p.roof || '');
    params = cuan ? { sides: e.sides || 4, side: e.span[0], eaves: params.eaves } : { roof: 'xieshan', side: e.span[0], depth: e.span[1] ?? e.span[0], bays: p.bays >= 3 ? 3 : 1, eaves: params.eaves };
  }
  if (kind === 'louge' && !params.storeys) {
    const n = e.storeys || 2, storeys = [];
    for (let i = 0; i < n; i++) storeys.push({ ...p, columnRatio: (p.columnRatio || 0.9) * (i ? 0.8 : 1), puzuo: Math.min(8, (p.puzuo || 5) + (i === n - 1 && n > 1 ? 1 : 0)), walls: i ? 'louge-s' : 'louge' });
    params = { grade: p.grade, type: p.type, storeys, roof: e.roof || p.roof || 'xieshan' };
  }
  if (kind === 'shuixie') params = { ...params, deckY: (floorY ?? 1) - W };
  if (kind === 'lang') {
    const span = e.span || [3.2, 3.2];
    const base = { grade: p.grade && p.grade >= 5 ? p.grade : 6, onWater: water, deckY: (floorY ?? 1) - W, depth: span[1] ?? span[0] };
    if (e.path && e.path.length >= 2) {
      const a = e.path[0], b = e.path[e.path.length - 1];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.max(1, Math.round(len / span[0]));
      center = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      // the corridor runs along its local x; its front (+z) faces across the path
      facing = ((Math.atan2(b[0] - a[0], -(b[1] - a[1])) * 180) / Math.PI + 90 + 360) % 360;
      params = { ...base, bays: n, bayW: len / n };
    } else params = { ...base, bays: p.bays ?? 5, bayW: span[0] };
  }
  if ((kind === 'menlou' || kind === 'gulou') && e.base) {
    const dun = { h: e.base.height ?? 8, d: e.base.depth ?? 16, ...(e.base.width ? { w: e.base.width } : {}), gate: { w: 5, h: Math.min(6, (e.base.height ?? 8) * 0.65) } };
    params = kind === 'gulou' ? { dun, top: { ...p, walls: 'louge' } } : { dun, top: p, ...(e.storeys >= 2 ? { storeys: [{ columnRatio: 0.78 }, { columnRatio: 0.62 }] } : {}) };
  }
  if (kind === 'menwu') params = { ...params, walls: 'gate' };
  if (kind === 'que' && !p.top) params = { top: { ...p, walls: 'louge' } };
  if (e.podium) params.platform = { ...(params.platform || {}), h: e.podium.height, tiers: e.podium.tiers || 1, kind: PAINT.MARBLE, rail: true, out: 2.2, ...(e.podium.stairs === 'front' ? { steps: [0] } : e.podium.stairs === 'none' ? { steps: [] } : {}) };
  if (water && kind !== 'shuixie' && kind !== 'lang' && kind !== 'qiao') params.platform = { ...(params.platform || {}), piles: !e.stonePlatform, h: Math.max(0.6, (floorY ?? 1) - W), bury: 3.2, steps: [] };
  return { kind, params, center, facing, y: floorY, ground: e.level ?? null, onWater: water };
}

export async function build(engine) {
  hookLooks(engine);
  const list = [
    ...(L.HALLS || []).map((h) => ({ ...fromHall(h), id: h.id, lod: h.lod, shot: h.shot, scale: h.scale })),
    ...(L.BUILDINGS || []).filter((e) => !(e.kind && PAGODA_KINDS.test(e.kind))).map((e) => ({ ...e, ground: e.level ?? null })),
  ];
  // ?ids=a,b: build only these entries (silhouette checks: tools/arch-overlay.mjs)
  const ids = (engine.params?.get?.('ids') || '').split(',').filter(Boolean);
  for (const e of list) {
    if (!e.center) continue;
    if (ids.length && !ids.includes(e.id)) continue;
    try {
      const lod = autoLod(engine, e);
      const { group, info } = engine.explore
        ? exploreLod(engine, (l) => buildBuilding(e.kind || 'hall', e.params || {}, { lod: l, name: e.id || e.kind, ao: aoOpt(engine) }), lod, e.center)
        : buildBuilding(e.kind || 'hall', e.params || {}, { lod, name: e.id || e.kind, ao: aoOpt(engine) });
      const ground = e.ground ?? heightAt(e.center[0], e.center[1]);
      const y = e.y ?? ground + (info.baseH ?? 0);
      group.position.set(e.center[0], y, e.center[1]);
      group.rotation.y = L.headingToRotY(e.facing ?? 180);
      // layout `scale`: the whole building bigger than its 材 grade gives (a hero 樓閣 the reference draws large)
      const k = e.scale || 1;
      if (k !== 1) { group.scale.setScalar(k); group.position.y = e.y ?? ground + (info.baseH ?? 0) * k; }
      group.name = 'yingzao:' + (e.id || e.kind);
      maskMaterials(engine, group);
      engine.add(group);
      engine.footprints?.addRect?.(e.center[0], e.center[1], (info.size[0] / 2) * k, (info.size[2] / 2) * k, group.rotation.y, 'building');
      (engine.registry.buildings ||= []).push({ id: e.id, kind: e.kind, group, info });
      console.log(`[yingzao] ${e.id || e.kind} (${e.kind}, lod ${lod}): ${(info.tris / 1e3).toFixed(0)}k tris, ${info.calls} calls, ${info.ms} ms`);
    } catch (err) { console.error(`[yingzao] ${e.id || e.kind} failed:`, err.stack || err); }
  }
  buildTerraces(engine, ids);
}

/**
 * The walled terraces (layout.CHENGTAI) and the stone flights (layout.STAIRS): src/yingzao/chengtai.js. Their parapets,
 * wall feet and open flight sides go to the footprints as 'wall' (the walker stops there); the courts and flights as
 * 'terrace' (no trees grow on them; the walker ignores the tag).
 */
function buildTerraces(engine, ids = []) {
  const fp = engine.footprints;
  const one = (kind, e, fn) => {
    if (ids.length && !ids.includes(e.id)) return;
    try {
      const center = e.center || [(e.from[0] + e.to[0]) / 2, (e.from[1] + e.to[1]) / 2];
      const size = e.size ? Math.max(...e.size) : Math.hypot(e.to[0] - e.from[0], e.to[1] - e.from[1]);
      const lod = autoLod(engine, { ...e, center }, size);
      let blocks = [];
      const make = (l) => { const r = fn(e, { lod: l, name: e.id }); if (l === Math.min(lod, 1) || !engine.explore) blocks = r.blocks; return r; };
      const { group, info } = engine.explore ? exploreLod(engine, make, lod, center, { far: 2 }) : make(lod);
      if (engine.explore) { const g = group.children; for (const c of g) c.position.set(0, 0, 0); group.position.set(center[0], 0, center[1]); }
      group.name = kind + ':' + e.id;
      maskMaterials(engine, group);
      engine.add(group);
      for (const [a, b, hw] of blocks) fp?.addPath?.([a, b], hw, 'wall');
      if (e.size) {
        const a = ((e.rot || 0) * Math.PI) / 180;
        // footprints rect: hd runs along (sin θ, cos θ) = the terrace's long side (sin rot, −cos rot)
        fp?.addRect?.(e.center[0], e.center[1], e.size[1] / 2 + 0.5, e.size[0] / 2 + 0.5, Math.atan2(Math.sin(a), -Math.cos(a)), 'terrace');
      } else {
        fp?.addPath?.([e.from, e.to], e.width / 2 + 0.3, 'terrace');
      }
      console.log(`[yingzao] ${kind} ${e.id} (lod ${lod}): ${(info.tris / 1e3).toFixed(0)}k tris, ${info.ms} ms`);
    } catch (err) { console.error(`[yingzao] ${kind} ${e.id} failed:`, err.stack || err); }
  };
  for (const T of L.CHENGTAI || []) one('chengtai', T, buildChengtai);
  for (const S of L.STAIRS || []) one('stair', S, buildStair);
}

/** ?bldMask=1 (silhouette checks, tools/arch-overlay.mjs): every building drawn flat magenta */
let _maskMat = null;
export function maskMaterials(engine, group) {
  if (engine?.params?.get?.('bldMask') !== '1') return;
  _maskMat ||= new THREE.MeshBasicMaterial({ color: 0xff00ff, toneMapped: false, fog: false });
  group.traverse((o) => { if (o.isMesh) o.material = _maskMat; });
}

export async function test(engine) {
  hookLooks(engine);
  const P = engine.params;
  const kind = P?.get?.('b') || 'hall';
  let params = {};
  try { const q = P?.get?.('p'); if (q) params = JSON.parse(q); } catch (e) { console.warn('[yingzao] bad p param', e.message); }
  const lod = Number(P?.get?.('lod') || 0);
  const look = { snow: Number(P?.get?.('snow') || 0), night: Number(P?.get?.('night') || 0) };
  setBuildingLook(look);
  if (kind === 'gallery') return gallery(engine, lod, look);
  if (kind === 'houses') return street(engine, look);
  const { group, info } = buildBuilding(kind, params, { lod, name: kind });
  group.position.y = info.baseH ?? 0;
  engine.add(group);
  console.log(`[yingzao] test ${kind}: ${JSON.stringify(params)}`);
  console.log(`[yingzao] ${(info.tris / 1e3).toFixed(0)}k tris, ${info.calls} calls, ${info.units} 鋪作, size ${info.size.join(' × ')} m, top ${info.top} m, build ${info.ms} ms` + (info.ao ? `, AO ${info.ao.ms} ms` : ''));
  const views = viewsFor(group, info, look);
  // cam=x,y,z,tx,ty,tz[,fov][,sunAz,sunEl]: an extra custom view at the end of the list (index views.length)
  const cam = P?.get?.('cam');
  if (cam) {
    const v = cam.split(',').map(Number);
    views.push({ pos: v.slice(0, 3), target: v.slice(3, 6), fov: v[6] || 40, sun: { azimuth: v[7] ?? 205, elevation: v[8] ?? 30 }, snow: look.snow, night: look.night });
  }
  return { views };
}

export function viewsFor(group, info, look = {}) {
  const box = new THREE.Box3().setFromObject(group);
  const c = box.getCenter(new THREE.Vector3()), s = box.getSize(new THREE.Vector3());
  const R = Math.max(s.x, s.z) / 2, H = box.max.y, Hb = Math.max(0.1, box.max.y - Math.max(0, box.min.y));
  const base = info.baseH ?? 0;
  const eaveY = (info.anchors?.lanterns?.[0]?.[1] ?? H * 0.5 - base) + base;
  // frame the whole object: distance from the larger of the half width and the half height
  const fit = (fov) => (Math.max(R * 1.15, Hb * 0.62) / Math.tan(((fov / 2) * Math.PI) / 180));
  const d0 = fit(38), ym = Math.max(0, box.min.y) + Hb * 0.5;
  const sun = look.night ? { azimuth: 210, elevation: -10 } : { azimuth: 205, elevation: 30 };
  const extra = { snow: look.snow || 0, night: look.night || 0 };
  const dir = (az, el) => [Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)];
  const at = (az, el, d, ty = ym) => { const v = dir(az, el); return [c.x + v[0] * d, ty + v[1] * d, c.z + v[2] * d]; };
  return [
    { pos: at(-0.5, 0.08, d0), target: [c.x, ym, c.z], fov: 38, sun, ...extra },
    { pos: [c.x - R * 0.3, base + 1.7, c.z + R * 0.95], target: [c.x - R * 0.72, eaveY * 0.98, c.z + R * 0.5], fov: 52, sun: { azimuth: 200, elevation: 34 }, ...extra },
    { pos: at(1.35, 0.1, d0 * 0.95), target: [c.x, ym, c.z], fov: 38, sun: { azimuth: 120, elevation: 30 }, ...extra },
    { pos: at(-0.6, 0.55, d0 * 1.1), target: [c.x, ym * 0.8, c.z], fov: 38, sun, ...extra },
  ];
}

/** test: a street of shop houses — LOD 0 near, the instanced LOD 1 kit beyond, LOD 2 farthest */
function street(engine, look) {
  const near = [];
  let x = -14;
  for (let i = 0; i < 4; i++) {
    const { group, info } = buildHouse({ seed: 'near' + i }, { lod: 0, name: 'house' + i });
    const w = info.params.width;
    group.position.set(x + w / 2, 0, 0); engine.add(group); near.push(info); x += w + 0.1;
  }
  const kit1 = houseKit({ lod: 1, variants: 8 }), kit2 = houseKit({ lod: 2, variants: 8 });
  const pl1 = [], pl2 = [];
  for (let side = -1; side <= 1; side += 2) for (let i = 0; i < 40; i++) {
    const v = (i * 5 + (side > 0 ? 3 : 0)) % 8, w = kit1.variants[v].size[0];
    const p = { x: -14 + i * 7.2, z: side > 0 ? -22 : 0, rot: side > 0 ? Math.PI : 0, variant: v };
    if (i < 4 && side < 0) continue;
    (i < 22 ? pl1 : pl2).push(p);
    void w;
  }
  engine.add(instanceHouses(kit1, pl1, { name: 'street-lod1' }));
  engine.add(instanceHouses(kit2, pl2, { name: 'street-lod2' }));
  console.log(`[yingzao] street: ${near.map((n) => n.tris).join('/')} tris near (lod 0), kit lod1 ${kit1.variants.map((v) => Math.round(v.tris)).join(' ')}, lod2 ${kit2.variants.map((v) => Math.round(v.tris)).join(' ')}`);
  const sun = look.night ? { azimuth: 210, elevation: -10 } : { azimuth: 120, elevation: 28 };
  return { views: [
    { pos: [-22, 3.5, 13], target: [0, 4, -8], fov: 50, sun, ...look },
    { pos: [-30, 40, 30], target: [60, 0, -11], fov: 45, sun, ...look },
  ] };
}

function gallery(engine, lod, look) {
  const kinds = (engine.params?.get?.('kinds') || 'ting,ting-hex,ting-oct,lang,menwu,shuixie').split(',');
  let x = 0, top = 0;
  for (const k of kinds) {
    const { group, info } = buildBuilding(k, {}, { lod, name: k });
    const w = info.size[0];
    group.position.set(x + w / 2, info.baseH ?? 0, 0);
    engine.add(group);
    x += w + 4; top = Math.max(top, info.top + (info.baseH ?? 0));
    console.log(`[yingzao] ${k}: ${(info.tris / 1e3).toFixed(0)}k tris, ${info.ms} ms`);
  }
  const cx = x / 2;
  const dist = (x / 2) / Math.tan((40 * Math.PI) / 180 * 0.5 * 1.79) * 1.05;
  return { views: [{ pos: [cx - x * 0.12, top * 0.9 + dist * 0.18, dist], target: [cx, top * 0.35, 0], fov: 40, sun: look.night ? { azimuth: 210, elevation: -10 } : { azimuth: 210, elevation: 32 }, snow: look.snow || 0, night: look.night || 0 }] };
}
