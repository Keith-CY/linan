// Night lamps of the city seen across the lake (ref05: a string of warm points at the foot of the 吴山 – 凤凰山 ridge,
// the palace and the houses below it). Lit windows of the city houses glow by themselves (the lattice / glow paint);
// these add the lantern clusters on the ridge foot and along the south shore where the houses are hidden by trees.
//
//   build(engine, plan) → { group, count }      visible only in night shots (engine.registry.night)
import * as THREE from 'three';
import { heightAt } from '../world/heightfield.js';
import { MeshBuilder, PAINT } from '../yingzao/geom.js';
import { hallMaterials } from '../yingzao/materials.js';
import { hash01 } from '../core/rng.js';
import { SHOTS } from '../world/shots.js';

export async function build(engine, plan) {
  const s5 = SHOTS.find((s) => s.id === 5);
  if (!s5) return null;
  const pts = [];
  // the far shore in the shot-5 view (bearing ~100-150°): march each ray to the first land, lamps a little inland
  // (houses and the temple below 南屏山 / 夕照山, the 清波門 suburbs) — the ridge foot itself hides behind the foothills
  for (let i = 0; i < 260; i++) {
    const a = ((100 + 50 * hash01(i, 1)) * Math.PI) / 180;
    let d = 250;
    while (d < 3000 && heightAt(s5.pos[0] + Math.sin(a) * d, s5.pos[2] - Math.cos(a) * d) < 0.6) d += 4;
    if (d >= 3000) continue;
    d += 6 + 45 * hash01(i, 2) ** 2;
    const x = s5.pos[0] + Math.sin(a) * d, z = s5.pos[2] - Math.cos(a) * d;
    const h = heightAt(x, z);
    if (h > 16 || hash01(i, 3) > 0.7) continue;
    pts.push([x, h, z, hash01(i, 4)]);
  }
  for (const hs of plan.houses) if (hs.suburb && hash01(Math.round(hs.x), Math.round(hs.z), 5) < 0.08) pts.push([hs.x, hs.y + 3, hs.z, hash01(Math.round(hs.x), 6)]);
  const B = new MeshBuilder();
  B.box(-0.7, 0, -0.7, 0.7, 1.4, 0.7, PAINT.GLOW, 'x');
  for (let i = 0; i < B.count; i++) { B.paint[i * 4 + 2] = 0; }   // h = 0: a lamp, always lit at night
  const geo = B.toGeometry();
  const mat = hallMaterials().glow;
  const im = new THREE.InstancedMesh(geo, mat, pts.length);
  const M = new THREE.Matrix4();
  pts.forEach(([x, y, z, r], i) => { const s = 0.8 + 0.9 * r; M.makeScale(s, s, s).setPosition(x, y + 2.5 + 4 * r, z); im.setMatrixAt(i, M); });
  im.instanceMatrix.needsUpdate = true; im.computeBoundingSphere();
  im.name = 'city:lamps'; im.castShadow = false; im.receiveShadow = false;
  im.userData.castShadow = false; im.userData.receiveShadow = false;
  const group = new THREE.Group(); group.name = 'city:lamps'; group.add(im);
  engine.add(group, { castShadow: false, receiveShadow: false });
  const apply = () => { group.visible = !!engine.registry.night; };
  apply();
  engine.onShot(apply);
  console.log(`[city] night lamps: ${pts.length}`);
  return { group, count: pts.length };
}
