// The same building built twice (the same kind, parameters, level of detail and AO: the generator has no randomness
// of its own) is built once: later calls get a clone of the first (new objects sharing its geometry and materials,
// the meshes renamed). The city's seven 酒樓, the palace's paired pavilions and corridors, the city pagodas.
//   memoBuild(kind, params, opts, build) → { group, info } (build(params, opts) on a miss)
// Parameters holding functions are not memoised.
import { weldPending } from '../core/compact.js';

const CACHE = new Map();
let hits = 0;

function keyOf(kind, params, opts) {
  let fn = false;
  const { name, ...rest } = opts || {};
  const s = JSON.stringify([kind, params, rest], (k, v) => { if (typeof v === 'function') fn = true; return v; });
  return fn ? null : s;
}

const OFF = typeof location !== 'undefined' && new URLSearchParams(location.search).get('memo') === '0';   // ?memo=0: every build fresh

export function memoBuild(kind, params, opts, build) {
  if (OFF) return build();
  const key = keyOf(kind, params, opts);
  const name = opts?.name || kind;
  const hit = key && CACHE.get(key);
  if (!hit) {
    const r = build();
    if (key) CACHE.set(key, { r, name: r.group.name });
    return r;
  }
  let info;
  try { info = structuredClone(hit.r.info); } catch { return build(); }
  hits++;
  const t0 = performance.now();
  const group = hit.r.group.clone(true);
  // as a fresh build hands it over: at the origin, unturned, unscaled, shown, named (the first one's caller has placed,
  // turned and renamed it since; setting only rotation.y on a copied turn left x and z at π and flipped the copy)
  group.position.set(0, 0, 0); group.quaternion.identity(); group.scale.set(1, 1, 1); group.visible = true;
  group.updateMatrix();
  const from = hit.name;
  group.name = name;
  group.traverse((o) => {
    if (o !== group && o.name?.startsWith(from)) o.name = name + o.name.slice(from.length);
    if (o.geometry) weldPending(o);
  });
  info.ms = Math.round(performance.now() - t0);
  info.memo = true;
  return { group, info };
}

export const memoStats = () => ({ entries: CACHE.size, hits });
