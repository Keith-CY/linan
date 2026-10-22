// PAGODAS: 雷峰塔, 六和塔, 保俶塔, the 三潭 stone lanterns and 靈隱's stone pagodas (generators in src/yingzao/pagoda.js).
//
// build(engine): every entry of layout.PAGODAS, plus layout.BUILDINGS entries whose kind is a pagoda kind:
//   { id, kind: 'leifeng' | 'liuhe' | 'baochu' | 'santan' | 'stupa' | 'jingchuang', center: [x, z], facing?, y?, params? }
// When the layout has no entry for a pagoda yet, PLACEHOLDERS below are used (marked placeholder: the
// layout should replace them): 雷峰塔 on layout.LEIFENG, the three lanterns at layout.THREE_POOLS, 保俶塔 on 寶石山,
// 六和塔 on the north bank of the 錢塘江, two stone pagodas at 靈隱.
//
// test(engine): node tools/render.mjs --test pagodas --view N --params "b=leifeng&snow=0&night=0"
import * as L from '../world/layout.js';
import { heightAt } from '../world/heightfield.js';
import { buildPagoda } from '../yingzao/pagoda.js';
import { setBuildingLook } from '../yingzao/materials.js';
import { hookLooks, viewsFor, PAGODA_KINDS, autoLod, aoOpt, exploreLod, maskMaterials } from './yingzao.js';

/** placeholder spots, used only for kinds the layout does not place (marked placeholder in the log) */
function placeholders() {
  const out = [];
  if (L.LEIFENG) out.push({ id: 'leifeng', kind: 'leifeng', center: L.LEIFENG.center, facing: 0, placeholder: true, shot: [4] });
  (L.THREE_POOLS || []).forEach((c, i) => out.push({ id: 'santan-' + (i + 1), kind: 'santan', center: c, y: L.WATER_LEVEL ?? 0, facing: 0, placeholder: true, shot: [5] }));
  // the twin Northern-Song stone pagodas stand in front of 靈隱's 大雄寶殿
  const dx = (L.HALLS || []).find((h) => h.id === 'lingyin-daxiong');
  if (dx) {
    const a = ((dx.facing ?? 180) * Math.PI) / 180, fx = Math.sin(a), fz = -Math.cos(a), sx = Math.cos(a), sz = Math.sin(a);
    for (const s of [-1, 1]) out.push({ id: 'lingyin-stupa-' + (s < 0 ? 'w' : 'e'), kind: 'stupa', center: [dx.center[0] + fx * 26 + sx * 11 * s, dx.center[1] + fz * 26 + sz * 11 * s], level: dx.level, facing: dx.facing, placeholder: true, shot: [8] });
  }
  return out;
}

const TYPE = { leifeng: 'leifeng', liuhe: 'liuhe', baochu: 'baochu', santan: 'santan', louge: 'tower', stone: 'stupa', stupa: 'stupa', jingchuang: 'jingchuang', tower: 'tower' };

export async function build(engine) {
  hookLooks(engine);
  const placed = [
    ...(L.PAGODAS || []).map((e) => ({ ...e, kind: TYPE[e.type || e.kind] || e.type || e.kind })),
    ...(L.BUILDINGS || []).filter((e) => e.kind && PAGODA_KINDS.test(e.kind)),
  ];
  const have = new Set(placed.map((e) => e.kind));
  const list = [...placed, ...placeholders().filter((e) => !have.has(e.kind))];
  const ids = (engine.params?.get?.('ids') || '').split(',').filter(Boolean);
  for (const e of list) {
    if (ids.length && !ids.includes(e.id)) continue;
    try {
      const params = { ...(e.params || {}) };
      if (e.storeys && params.storeys === undefined && e.kind !== 'baochu') params.storeys = e.storeys;
      if (e.storeys && e.kind === 'baochu') params.levels = e.storeys;
      if (e.sides && e.sides > 2) params.sides = e.sides;
      const lod = autoLod(engine, e, e.height || 30);
      const { group, info } = engine.explore
        ? exploreLod(engine, (l) => buildPagoda(e.kind, params, { lod: l, name: e.id || e.kind, ao: aoOpt(engine) }), lod, e.center)
        : buildPagoda(e.kind, params, { lod, name: e.id || e.kind, ao: aoOpt(engine) });
      // fit to the layout's height (to the finial tip) with a uniform scale (the 材 scales with it; noted)
      if (e.height && info.top > 0) { const k = e.height / (info.top + (info.baseH ?? 0)); if (Math.abs(k - 1) > 0.03) { group.scale.setScalar(k); info.scale = k; info.baseH = (info.baseH ?? 0) * k; } }
      const ground = e.level ?? (e.kind === 'santan' ? (L.WATER_LEVEL ?? 0) : heightAt(e.center[0], e.center[1]));
      const y = e.y ?? ground + (info.baseH ?? 0);
      group.position.set(e.center[0], y, e.center[1]);
      group.rotation.y = L.headingToRotY(e.facing ?? 180);
      group.name = 'pagoda:' + (e.id || e.kind);
      if (e.hidden) group.visible = false;
      maskMaterials(engine, group);
      engine.add(group);
      (engine.registry.pagodas ||= []).push({ id: e.id, kind: e.kind, group, info, placeholder: !!e.placeholder });
      console.log(`[pagodas] ${e.id || e.kind}${e.placeholder ? ' (placeholder spot)' : ''} lod ${lod}: ${(info.tris / 1e3).toFixed(0)}k tris, top ${(info.top * (info.scale || 1)).toFixed(1)} m, ${info.ms} ms`);
    } catch (err) { console.error(`[pagodas] ${e.id || e.kind} failed:`, err.stack || err); }
  }
}

export async function test(engine) {
  hookLooks(engine);
  const P = engine.params;
  const kind = P?.get?.('b') || 'leifeng';
  let params = {};
  try { const q = P?.get?.('p'); if (q) params = JSON.parse(q); } catch (e) { console.warn('[pagodas] bad p param', e.message); }
  const lod = Number(P?.get?.('lod') || 0);
  const look = { snow: Number(P?.get?.('snow') || 0), night: Number(P?.get?.('night') || 0) };
  setBuildingLook(look);
  const { group, info } = buildPagoda(kind, params, { lod, name: kind });
  group.position.y = info.baseH ?? 0;
  engine.add(group);
  console.log(`[pagodas] test ${kind}: ${(info.tris / 1e3).toFixed(0)}k tris, ${info.calls} calls, size ${info.size.join(' × ')} m, top ${info.top} m, build ${info.ms} ms`);
  const views = viewsFor(group, info, look);
  const cam = P?.get?.('cam');
  if (cam) { const v = cam.split(',').map(Number); views.push({ pos: v.slice(0, 3), target: v.slice(3, 6), fov: v[6] || 40, sun: { azimuth: v[7] ?? 205, elevation: v[8] ?? 30 }, ...look }); }
  return { views };
}
