// BOATS: layout.BOATS (the 畫舫 at the 雷峰 shore, the skiff off 苏堤, the junks below 六和塔) plus the canal traffic
// of the city (烏篷船, cargo boats and skiffs moored along the 市河 and the 盐桥运河, a few under way) and a couple of
// extra small craft in the Qiantang bay (ref09). Generators in src/boats/build.js.
//
// build(engine): boats sit on their waterline at y = 0 (the lake / canal / river datum), bow toward layout `heading`
// (compass). LOD by the distance from the nearest shot camera that sees them. Canal boats are instanced per type and
// LOD. Registry: engine.registry.boats = { placed: [{ id, type, x, z, heading, lod }], canal: count }.
// Wakes are left to the water module (registry entries carry position and heading; `moving` marks boats under way).
//
// test(engine): node tools/render.mjs --test boats --view N --params "b=junk&lod=0"  (b = a type or 'all')
import * as THREE from 'three';
import * as L from '../world/layout.js';
import { heightAt } from '../world/heightfield.js';
import { buildBoat, boatParts, BOAT_TYPES } from '../boats/build.js';
import { boatMaterial } from '../boats/material.js';
import { bakeAO } from '../yingzao/ao.js';
import { hookLooks } from './yingzao.js';
import { setBuildingLook } from '../yingzao/materials.js';
import { viewDist, lodFor } from '../city/lod.js';
import { hash01 } from '../core/rng.js';
import { SHOTS } from '../world/shots.js';

const LOD_T = [180, 700];

/** extra boats not in the layout (ART: life in the Qiantang bay of ref09) */
const EXTRA = [
  { id: 'qiantang-junk-5', type: 'junk', at: [-1270, 4872], heading: 70, length: 13, params: { L: 13, beam: 3.8, depth: 1.5, draft: 0.7, mainH: 11, foreH: 7.5, furled: true }, shot: [9] },
  { id: 'qiantang-fisher-0', type: 'wupeng', at: [-1105, 4720], heading: 40, length: 8, shot: [9] },
  { id: 'qiantang-cargo-0', type: 'cargo', at: [-1300, 4880], heading: 95, length: 12.5, shot: [9] },
];

/** a boat that the layout puts on the shore (or a quay) is pushed out along the slope until it floats clear */
export function afloat(x, z, beam = 2, draft = 0.4) {
  const need = -0.15;  // the first water (the hull may graze the shelving bed under the surface)
  if (heightAt(x, z) < need - 0.2) return [x, z, 0];
  let px = x, pz = z, moved = 0;
  for (let i = 0; i < 120 && heightAt(px, pz) > need; i++) {
    const e = 1.5, gx = heightAt(px + e, pz) - heightAt(px - e, pz), gz = heightAt(px, pz + e) - heightAt(px, pz - e), gl = Math.hypot(gx, gz) || 1;
    px -= (gx / gl) * 0.5; pz -= (gz / gl) * 0.5; moved += 0.5;
  }
  // clear of the quay wall (1.2 m into the water) by half the beam and a fender
  const e = 1.5, gx = heightAt(px + e, pz) - heightAt(px - e, pz), gz = heightAt(px, pz + e) - heightAt(px, pz - e), gl = Math.hypot(gx, gz) || 1;
  const extra = beam / 2 + 1.6;
  px -= (gx / gl) * extra; pz -= (gz / gl) * extra;
  return [px, pz, moved + extra];
}

function placeOne(engine, b) {
  const type = b.type === 'skiff' || b.type === 'wupeng' || b.type === 'cargo' || b.type === 'huafang' || b.type === 'junk' ? b.type : 'skiff';
  const params = { seed: b.id, ...(b.params || {}) };
  // ART (ref09): the river junks read bigger than the layout's 18 m — 沙船 of 20-24 m with tall battened sails
  if (type === 'junk' && b.length && b.length < 20 && !params.L) b = { ...b, length: 22 };
  if (b.length && !params.L) {
    // scale the default hull to the layout length
    const k = b.length / ({ skiff: 5.6, wupeng: 8.2, cargo: 12.5, huafang: 11, junk: 22 }[type]);
    if (Math.abs(k - 1) > 0.05) Object.assign(params, { L: b.length });
  }
  if (type === 'junk' && params.furled === undefined) params.furled = hash01(b.id.length, Math.round(b.at[0]), 3) < 0.35;
  if (type === 'junk' && params.sheet === undefined) {
    // sheet the sails to show their face to the camera that sees the boat (the sun behind them makes them glow)
    const cam = SHOTS.filter((s) => (b.shot || []).includes(s.id))[0];
    if (cam) {
      const dx = cam.pos[0] - b.at[0], dz = cam.pos[2] - b.at[1], l = Math.hypot(dx, dz);
      const th = L.headingToRotY(b.heading ?? 0);
      let phi = Math.atan2(-dz / l, dx / l) - th;
      while (phi > Math.PI / 2) phi -= Math.PI;
      while (phi < -Math.PI / 2) phi += Math.PI;
      phi = Math.max(-1.2, Math.min(1.2, phi)) + (hash01(b.id.length, 9, Math.round(b.at[1])) - 0.5) * 0.3;
      params.sheet = (phi * 180) / Math.PI;
    }
  }
  const d = viewDist(b.at[0], b.at[1], (b.length || 10) / 2);
  const lod = lodFor(d, LOD_T);
  const { group, info } = buildBoat(type, params, { lod, name: b.id });
  const [x, z, moved] = afloat(b.at[0], b.at[1], info.params.beam, info.params.draft);
  if (moved > 0.1) console.log(`[boats] ${b.id}: moved ${moved.toFixed(1)} m off the shore to float`);
  group.position.set(x, L.WATER_LEVEL, z);
  group.rotation.y = L.headingToRotY(b.heading ?? 0);
  // a slight list and trim so they don't sit like models
  group.rotation.z = (hash01(b.id.length, 7, Math.round(b.at[1])) - 0.5) * 0.03;
  group.name = 'boat:' + b.id;
  return { group, info, lod, d, type };
}

/** moored and moving canal boats along the city canals, inside the views */
function canalBoats(engine) {
  const out = [];
  const bridges = engine.registry.city?.streets?.bridges || [];
  for (const C of L.CITY.canals || []) {
    const pts = C.points;
    let acc = 0;
    for (let i = 0; i < pts.length - 1; i++) {
      const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
      const len = Math.hypot(bx - ax, bz - az), tx = (bx - ax) / len, tz = (bz - az) / len, nx = -tz, nz = tx;
      for (const side of [-1, 1]) {
        let s = 4 + 10 * hash01(i, side, C.name.length);
        while (s < len - 6) {
          const k = Math.round(acc + s);
          const r = hash01(k, side, 11);
          const type = r < 0.55 ? 'wupeng' : r < 0.85 ? 'cargo' : 'skiff';
          const Lb = type === 'wupeng' ? 8.2 : type === 'cargo' ? 12.5 : 5.6, beam = type === 'cargo' ? 3.0 : type === 'wupeng' ? 1.55 : 1.3;
          const x = ax + tx * (s + Lb / 2), z = az + tz * (s + Lb / 2);
          const moored = hash01(k, side, 12) < 0.86;
          const off = moored ? C.width / 2 - beam / 2 - 0.45 : (C.width / 2 - beam) * (hash01(k, 13) - 0.5);
          const px = x + nx * off * side, pz = z + nz * off * side;
          const d = viewDist(px, pz, Lb / 2);
          const nearBridge = bridges.some((bb) => Math.hypot(bb.x - px, bb.z - pz) < 11);
          const gap = hash01(k, side, 14) < 0.45 ? 0.6 + 2 * hash01(k, 15) : 6 + 30 * hash01(k, 16);
          if (d < 2200 && !nearBridge && heightAt(px, pz) < -0.3) {
            const fwd = hash01(k, side, 17) < 0.5 ? 1 : -1;
            const heading = (Math.atan2(tx * fwd, -tz * fwd) * 180) / Math.PI;
            out.push({ type, x: px, z: pz, heading, lod: lodFor(d, LOD_T), moving: !moored, seed: k });
          }
          s += Lb + gap;
        }
      }
      acc += len;
    }
  }
  return out;
}

export async function build(engine) {
  hookLooks(engine);
  const t0 = performance.now();
  const reg = (engine.registry.boats = { placed: [], canal: 0 });
  let tris = 0;
  for (const b of [...L.BOATS, ...EXTRA]) {
    try {
      const r = placeOne(engine, b);
      engine.add(r.group);
      reg.placed.push({ id: b.id, type: r.type, x: b.at[0], z: b.at[1], heading: b.heading, lod: r.lod, group: r.group });
      tris += r.info.tris;
      console.log(`[boats] ${b.id} ${r.type} lod ${r.lod} (${Number.isFinite(r.d) ? Math.round(r.d) + ' m' : 'unseen'}): ${(r.info.tris / 1e3).toFixed(1)}k tris, ${r.info.ms} ms`);
    } catch (e) { console.error(`[boats] ${b.id} failed:`, e.stack || e); }
  }
  // canal traffic, instanced per type and LOD
  const list = canalBoats(engine);
  const groups = new Map();
  for (const b of list) { const key = b.type + ':' + b.lod; if (!groups.has(key)) groups.set(key, []); groups.get(key).push(b); }
  const root = new THREE.Group(); root.name = 'boats:canal';
  const M = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
  for (const [key, items] of groups) {
    const [type, lodS] = key.split(':'); const lod = Number(lodS);
    const parts = boatParts(type, { seed: 'canal-' + type, tone: 0.45 }, lod);
    if (lod <= 1) bakeAO({ targets: [{ B: parts.B }], occluders: [{ B: parts.B }], cell: lod === 0 ? 0.06 : 0.12, coarse: 0.25, near: 0.6, far: 3.5, upFar: 8 });
    const geo = parts.B.toGeometry();
    const im = new THREE.InstancedMesh(geo, boatMaterial(), items.length);
    items.forEach((b, i) => {
      e.set(0, L.headingToRotY(b.heading), (hash01(b.seed, 5) - 0.5) * 0.03, 'YXZ');
      q.setFromEuler(e);
      M.compose(new THREE.Vector3(b.x, L.WATER_LEVEL, b.z), q, new THREE.Vector3(1, 1, 1));
      im.setMatrixAt(i, M);
    });
    im.instanceMatrix.needsUpdate = true; im.computeBoundingSphere();
    im.name = 'boats:canal:' + key; im.castShadow = true; im.receiveShadow = true;
    root.add(im);
    tris += (geo.attributes.position.count / 3) * items.length;
  }
  engine.add(root);
  reg.canal = list.length;
  reg.canalBoats = list.map(({ type, x, z, heading, moving }) => ({ type, x, z, heading, moving }));
  console.log(`[boats] ${reg.placed.length} placed + ${list.length} canal boats (${[...groups.entries()].map(([k, v]) => k + '×' + v.length).join(', ')}), ${(tris / 1e3).toFixed(0)}k tris, ${Math.round(performance.now() - t0)} ms`);
}

// ------------------------------------------------------------------------------------------------ test
export async function test(engine) {
  hookLooks(engine);
  const P = engine.params;
  const which = P?.get?.('b') || 'all';
  const lod = Number(P?.get?.('lod') || 0);
  const night = Number(P?.get?.('night') || 0);
  setBuildingLook({ snow: 0, night });
  for (const o of engine.scene.children) if (o.name === 'testGround') o.visible = false;
  const water = new THREE.Mesh(new THREE.PlaneGeometry(600, 600).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x1c2326, roughness: 0.08, metalness: 0.0 }));
  water.name = 'testWater'; water.receiveShadow = true;
  engine.add(water, { castShadow: false });
  const types = which === 'all' ? BOAT_TYPES : [which];
  let x = 0;
  for (const t of types) {
    const { group, info } = buildBoat(t, { seed: 'test-' + t }, { lod, name: t });
    const beam = info.params.beam;
    group.position.set(x + beam / 2, 0, 0);
    engine.add(group);
    x += beam + 4;
    console.log(`[boats] test ${t} lod ${lod}: ${(info.tris / 1e3).toFixed(1)}k tris, ${info.ms} ms`);
  }
  const cx = x / 2;
  const sun = night ? { azimuth: 210, elevation: -10 } : { azimuth: 120, elevation: 30 };
  return { views: [
    { pos: [cx + 18, 9, 26], target: [cx, 1.5, 0], fov: 40, sun, night },
    { pos: [cx - 6, 2.5, 14], target: [cx, 1.2, 0], fov: 45, sun, night },
    { pos: [cx, 34, 30], target: [cx, 0, 0], fov: 40, sun, night },
  ] };
}
