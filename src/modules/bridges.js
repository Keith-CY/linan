// BRIDGES: the stone arch bridges of layout.BRIDGES (断桥 and 锦带桥 on 白堤, the six 苏堤 bridges, 西泠, 长桥, the
// 春淙桥 at 灵隐). The city canal bridges are built by src/modules/city.js with the same generator
// (src/bridges/arch.js).
//
// build(engine): one bridge per entry, on its own water level (the lake datum, or the stream under it), deck along
// layout `axis`, LOD by the distance from the nearest shot camera that sees it (src/city/lod.js). Causeway bridges get
// stone abutment walls across the causeway cut (heightfield.js cuts `gap` m of water at every bridge).
// Registry: engine.registry.bridges = [{ id, group, info }]. Snow (shot 10) comes from the shared building uniforms.
//
// ART (per reference; layout.rise / span lose where they fight the picture):
//   断桥 (ref10): a tall egg-shaped arch (superellipse 1.8) much higher than the real bridge, long stepped ramps
//   苏堤 bridges (ref02): a semicircular arch springing at the water (the reflection closes the circle)
//   锦带桥 (ref01): semicircle, lower deck
//
// test(engine): node tools/render.mjs --test bridges --view N --params "b=bai-0&lod=0&snow=1"
//   b = a BRIDGES id or 'canal'; views 0 three-quarter from the water, 1 the rail and deck close up, 2 elevation,
//   3 high oblique.
import * as THREE from 'three';
import * as L from '../world/layout.js';
import { heightAt } from '../world/heightfield.js';
import { buildArchBridge } from '../bridges/arch.js';
import { hookLooks } from './yingzao.js';
import { setBuildingLook } from '../yingzao/materials.js';
import { viewDist, lodFor } from '../city/lod.js';

/** generator parameters for a layout entry (ART overrides per reference) */
export function bridgeSpec(b) {
  const base = { span: b.span, rise: b.rise, width: b.width, length: b.length, archH: (b.span || 8) / 2, shape: 2 };
  if (b.id === 'bai-0') return { ...base, span: 10.8, archH: 6.8, shape: 1.8, rise: 8.5, width: 7.4, length: 50, crown: 0.2, ringT: 0.52, curbH: 0.28, bank: L.BAI_CAUSEWAY.top, riser: 0.16 };
  if (b.id === 'bai-1') return { ...base, span: 8.2, archH: 4.3, rise: 6.3, width: 6.4, length: 36, bank: L.BAI_CAUSEWAY.top, crown: 0.3 };
  // 望山桥 (ink02): a tall round 月洞 opening (7.4 m wide, 6.8 m clear over the dry causeway path, round shoulders),
  // steep stepped ramps
  if (b.moon) return { ...base, span: 7.4, archH: 8.2, shape: 2.35, rise: 9.5, width: 6.4, length: 33, bank: L.SU_CAUSEWAY.top, crown: 0.34, ringT: 0.6, foot: 1.8 };
  if (/^su-/.test(b.id)) return { ...base, span: 8.6, archH: 4.5, rise: 6.9, width: 6.6, length: 40, bank: L.SU_CAUSEWAY.top, crown: 0.28 };
  if (b.id === 'xiling') return { ...base, archH: 4.0, rise: 5.6, bank: 1.2, crown: 0.3 };
  if (b.id === 'changqiao') return { ...base, archH: 3.6, rise: 5.0, bank: 1.2, crown: 0.32 };
  if (b.id === 'lingyin-bridge') return { ...base, span: 4.2, archH: 1.7, shape: 2, rise: 2.7, width: 3.0, length: 12, crown: 0.5, ringT: 0.32, curbH: 0.22, panel: 1.5, riser: 0.14 }; // ref08: low, almost flat, side-on at the lower left
  return base;
}

/** causeway the bridge belongs to (for the abutment walls) */
function causewayOf(b) {
  if (/^su-/.test(b.id)) return L.SU_CAUSEWAY;
  if (/^bai-/.test(b.id)) return L.BAI_CAUSEWAY;
  return null;
}

/** place one bridge: { group, info, lod } */
export function placeBridge(engine, b, { lod = null } = {}) {
  const spec = bridgeSpec(b);
  const C = b.moon ? null : causewayOf(b);
  if (C) {
    // abutment walls across the cut, only where the causeway really stands behind them
    const a0 = (b.axis * Math.PI) / 180, fx = Math.sin(a0), fz = -Math.cos(a0), rx = -Math.cos(a0), rz = -Math.sin(a0);
    const gapHalf = (C.gap || 14) / 2 - 0.3;
    spec.banks = { gapHalf, width: C.width + 8, top: C.top, mask: (xl, sz) => heightAt(b.center[0] + rx * xl + fx * sz * (gapHalf + 2.2), b.center[1] + rz * xl + fz * sz * (gapHalf + 2.2)) > -0.4 };
  }
  // the water under it: the lake datum, or a stream / ditch (灵隐) on higher ground
  let level = L.WATER_LEVEL;
  const a = (b.axis * Math.PI) / 180, ax = Math.sin(a), az = -Math.cos(a);
  const gc = heightAt(b.center[0], b.center[1]);
  if (gc > 1.5) {
    let bed = Infinity;
    for (let s = -spec.span / 2; s <= spec.span / 2; s += 0.5) bed = Math.min(bed, heightAt(b.center[0] + ax * s, b.center[1] + az * s));
    level = bed + 0.35;
    const e0 = heightAt(b.center[0] + ax * spec.length / 2, b.center[1] + az * spec.length / 2), e1 = heightAt(b.center[0] - ax * spec.length / 2, b.center[1] - az * spec.length / 2);
    spec.bank = Math.max(0.6, (e0 + e1) / 2 - level);
    spec.rise = Math.max(spec.rise, spec.bank + 1.2);
    spec.foot = Math.max(1.0, level - bed + 0.8);
  }
  const d = viewDist(b.center[0], b.center[1], spec.length / 2);
  const L0 = lod ?? Number(engine?.params?.get?.('lod') ?? NaN);
  const lv = Number.isFinite(L0) ? L0 : lodFor(d, [260, 1100]);
  const { group, info } = buildArchBridge(spec, { lod: lv, name: b.id });
  group.position.set(b.center[0], level, b.center[1]);
  group.rotation.y = L.headingToRotY(b.axis);
  group.name = 'bridge:' + b.id;
  return { group, info, lod: lv, level, dist: d, deckY: info.deckY };
}

export async function build(engine) {
  hookLooks(engine);
  const t0 = performance.now();
  const out = (engine.registry.bridges ||= []);
  let tris = 0;
  for (const b0 of L.BRIDGES) {
    // the explorable world turns the art-directed bridges (望山桥, 断桥) back along their causeway so walkers can cross
    const b = engine.explore && b0.causewayAxis !== undefined ? { ...b0, axis: b0.causewayAxis } : b0;
    try {
      const r = placeBridge(engine, b);
      engine.add(r.group);
      const a = (b.axis * Math.PI) / 180;
      engine.footprints?.addRect?.(b.center[0], b.center[1], r.info.params.width / 2 + 0.5, r.info.params.length / 2, Math.atan2(Math.sin(a), -Math.cos(a)), 'bridge');
      // deck profile for walking (src/explore): local +Z along the deck, deckY(z) above `level`. A 月洞 bridge over a dry
      // path (望山桥) has no deck over its opening: the walker passes through on the ground (its piers and ramps stand
      // far above the path, so the walker's step limit stops it at their faces)
      let deckY = r.deckY;
      if (b.moon) { const open = r.info.params.span / 2 - 0.35, dy = r.deckY; deckY = (z) => (Math.abs(z) < open ? -Infinity : dy(z)); }
      out.push({ id: b.id, group: r.group, info: r.info, level: r.level, deckY, width: r.info.params.width, length: r.info.params.length });
      // a still view (src/explore/still.js) turns the bridge back to the shots' axis
      if (b !== b0) out[out.length - 1].stillRotY = L.headingToRotY(b0.axis);
      tris += r.info.tris;
      console.log(`[bridges] ${b.id} ${b.name} lod ${r.lod} (seen at ${Number.isFinite(r.dist) ? Math.round(r.dist) + ' m' : 'no shot'}): ${(r.info.tris / 1e3).toFixed(1)}k tris, crown ${r.info.crown.toFixed(1)} m, ${r.info.ms} ms (AO ${r.info.aoMs} ms)`);
    } catch (e) { console.error(`[bridges] ${b.id} failed:`, e.stack || e); }
  }
  // snow lies on the bridges in winter shots only
  const snowy = [];
  for (const b of out) b.group.traverse((o) => { if (o.userData.isSnow) snowy.push(o); });
  const applySnow = () => { const on = engine.registry.season === 'winter'; for (const o of snowy) o.visible = on; };
  applySnow();
  engine.onShot(applySnow);
  console.log(`[bridges] ${L.BRIDGES.length} bridges, ${(tris / 1e3).toFixed(0)}k tris, ${Math.round(performance.now() - t0)} ms`);
}

// ------------------------------------------------------------------------------------------------ test
export async function test(engine) {
  hookLooks(engine);
  const P = engine.params;
  const id = P?.get?.('b') || 'bai-0';
  const lod = Number(P?.get?.('lod') || 0);
  const snow = Number(P?.get?.('snow') || 0);
  setBuildingLook({ snow, night: 0 });
  for (const o of engine.scene.children) if (o.name === 'testGround') o.visible = false;
  let spec;
  if (id === 'canal') spec = { span: 9, archH: 4.6, rise: 7.3, width: 5.2, length: 30, bank: 4.4, crown: 0.3, foot: 1.6 };
  else {
    const b = L.BRIDGES.find((x) => x.id === id) || L.BRIDGES[0];
    spec = bridgeSpec(b);
    const C = causewayOf(b);
    if (C) spec.banks = { gapHalf: (C.gap || 14) / 2 - 0.3, width: C.width + 8, top: C.top };
  }
  const { group, info } = buildArchBridge(spec, { lod, name: id, snow: snow > 0 });
  engine.add(group);
  // still water (a dark mirror) and the two banks
  const water = new THREE.Mesh(new THREE.PlaneGeometry(600, 600).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x1c2326, roughness: 0.06, metalness: 0.0 }));
  water.name = 'testWater'; water.receiveShadow = true;
  engine.add(water, { castShadow: false });
  const bankMat = new THREE.MeshStandardMaterial({ color: 0x6d6658, roughness: 0.95 });
  const hb = (info.params.banks?.gapHalf ?? info.params.span / 2 + 1.2);
  for (const s of [-1, 1]) {
    const len = 60;
    const bank = new THREE.Mesh(new THREE.BoxGeometry(info.params.banks?.width ?? 26, info.params.bank + 3, len), bankMat);
    bank.position.set(0, info.params.bank / 2 - 1.5 - 0.02, s * (hb + 0.6 + len / 2));
    engine.add(bank);
  }
  console.log(`[bridges] test ${id} lod ${lod}: ${(info.tris / 1e3).toFixed(1)}k tris, crown ${info.crown.toFixed(2)} m, build ${info.ms} ms (AO ${info.aoMs} ms) ${JSON.stringify(info.params)}`);
  const Lh = info.params.length / 2, cr = info.crown;
  const sun = { azimuth: 200, elevation: 32 };
  const look = { snow, night: 0 };
  return { views: [
    { pos: [Lh * 1.15, 3.2, Lh * 0.55], target: [0, cr * 0.5, 0], fov: 42, sun, ...look },
    { pos: [info.params.width * 0.2, cr + 1.6, Lh * 0.42], target: [-info.params.width * 0.5, cr + 0.4, 0], fov: 50, sun, ...look },
    { pos: [Lh * 2.4, cr * 0.45, 0], target: [0, cr * 0.45, 0], fov: 36, sun: { azimuth: 140, elevation: 30 }, ...look },
    { pos: [Lh * 1.2, cr + Lh * 1.0, Lh * 1.1], target: [0, cr * 0.4, 0], fov: 40, sun, ...look },
  ] };
}
