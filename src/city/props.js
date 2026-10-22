// Street life along 御街 near the shot-7 camera: cloth awnings over the shop fronts (white, indigo, ochre), handcarts,
// stacked goods (baskets, jars, crates, sacks), market parasols. No people (docs/ART_BIBLE.md).
//
//   build(engine, plan) → { group, counts }
// Instanced per prop kind (one draw each in the boat / wood / cloth materials). Placed for houses on 御街 within
// ~600 m of the shot-7 camera (props are 1-3 px beyond that).
import * as THREE from 'three';
import * as L from '../world/layout.js';
import { heightAt } from '../world/heightfield.js';
import { MeshBuilder, PAINT } from '../yingzao/geom.js';
import { hallMaterials } from '../yingzao/materials.js';
import { proceduralMaterial } from '../core/materials.js';
import { boatMaterial, BOAT_K } from '../boats/material.js';
import { hash01 } from '../core/rng.js';
import { SHOTS } from '../world/shots.js';

function qw(B, a, b, c, d, want, pa, uv) {
  const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
  const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
  if (nx * want[0] + ny * want[1] + nz * want[2] >= 0) B.quad(a, b, c, d, pa, pa, pa, pa, uv);
  else B.quad(a, d, c, b, pa, pa, pa, pa, uv ? [uv[0], uv[3], uv[2], uv[1]] : null);
}
function box(B, x0, y0, z0, x1, y1, z1, pa) {
  const c = [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], [x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]];
  const ctr = [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2];
  const f = (i, j, k, l) => { const a = c[i], b = c[j], cc = c[k], d = c[l]; qw(B, a, b, cc, d, [(a[0] + cc[0]) / 2 - ctr[0], (a[1] + cc[1]) / 2 - ctr[1], (a[2] + cc[2]) / 2 - ctr[2]], pa, [[0, 0], [1, 0], [1, 1], [0, 1]]); };
  f(0, 1, 2, 3); f(4, 5, 6, 7); f(0, 1, 5, 4); f(1, 2, 6, 5); f(2, 3, 7, 6); f(3, 0, 4, 7);
}

/** cloth: an off-white canvas with sag folds, dirt toward the edges; tinted per instance (instanceColor) */
let CLOTH = null;
function clothMaterial() {
  if (CLOTH) return CLOTH;
  CLOTH = proceduralMaterial({
    name: 'cityCloth', params: { color: 0xffffff, roughness: 0.92, side: THREE.DoubleSide },
    color: /* glsl */`
      float n = cgVfbm3(cgP * 2.2, 3), f = cgVnoise3(cgP * 18.0);
      float fold = 0.5 + 0.5 * sin(cgO.x * 9.0 + n * 3.0);
      diffuseColor.rgb *= vec3(0.62, 0.58, 0.5) * (0.82 + 0.22 * n + 0.05 * f) * (0.9 + 0.1 * fold);`,
  });
  return CLOTH;
}

/** awning: a sagging canvas sloping out from the front, two poles (local: front at z = 0 → out to +z) */
function awningGeo() {
  const C = new MeshBuilder(), P = new MeshBuilder();
  const w = 1, out = 2.4, y0 = 3.0, y1 = 2.35, n = 6, m = 3;
  for (let i = 0; i < n; i++) for (let j = 0; j < m; j++) {
    const xa = -w / 2 + (w * i) / n, xb = -w / 2 + (w * (i + 1)) / n, ta = j / m, tb = (j + 1) / m;
    const y = (x, t) => y0 + (y1 - y0) * t - 0.12 * Math.sin(Math.PI * t) - 0.05 * Math.sin(Math.PI * ((x + w / 2) / w) * 3) ** 2;
    qw(C, [xa, y(xa, ta), out * ta], [xb, y(xb, ta), out * ta], [xb, y(xb, tb), out * tb], [xa, y(xa, tb), out * tb], [0, 1, 0.2], [0, 0, 1, 0]);
  }
  // valance (a short hanging edge)
  qw(C, [-w / 2, y1 - 0.25, out], [w / 2, y1 - 0.25, out], [w / 2, y1, out], [-w / 2, y1, out], [0, 0, 1], [0, 0, 1, 0]);
  for (const sx of [-0.48, 0.48]) box(P, sx * w - 0.03, 0, out - 0.06, sx * w + 0.03, y1 + 0.05, out, [BOAT_K.WOOD, 0, 0.4, 0]);
  return { cloth: C.toGeometry(), poles: P.toGeometry() };
}
/** a two-wheeled handcart (local: shafts toward +z) */
function cartGeo() {
  const B = new MeshBuilder();
  const pa = (k) => [k, 0, 0.6, 0];
  box(B, -0.55, 0.62, -1.0, 0.55, 0.72, 0.9, pa(BOAT_K.DECK));
  for (const sx of [-1, 1]) {
    box(B, sx * 0.55 - 0.04, 0.72, -1.0, sx * 0.55 + 0.04, 1.0, 0.9, pa(BOAT_K.WOOD));
    box(B, sx * 0.42 - 0.03, 0.66, 0.9, sx * 0.42 + 0.03, 0.74, 2.2, pa(BOAT_K.WOOD));
    // wheel: a ring of 10 boxes
    for (let k = 0; k < 10; k++) {
      const a = (k / 10) * Math.PI * 2, a2 = ((k + 1) / 10) * Math.PI * 2, r = 0.5;
      const z0 = Math.cos(a) * r, y0 = 0.5 + Math.sin(a) * r, z1 = Math.cos(a2) * r, y1 = 0.5 + Math.sin(a2) * r;
      box(B, sx * 0.66 - 0.05, Math.min(y0, y1) - 0.04, Math.min(z0, z1) - 0.04, sx * 0.66 + 0.05, Math.max(y0, y1) + 0.04, Math.max(z0, z1) + 0.04, pa(BOAT_K.WOOD));
    }
    box(B, sx * 0.66 - 0.03, 0.47, -0.45, sx * 0.66 + 0.03, 0.53, 0.45, pa(BOAT_K.WOOD));
  }
  // a load of sacks
  box(B, -0.45, 0.72, -0.85, 0.45, 1.2, 0.5, pa(BOAT_K.CARGO));
  return B.toGeometry();
}
/** a stack of goods: sacks, crates, jars (local footprint ~1.6 x 1.0) */
function goodsGeo(seed) {
  const B = new MeshBuilder();
  let s = seed;
  const r = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  for (let i = 0; i < 6; i++) {
    const x = -0.7 + r() * 1.2, z = -0.4 + r() * 0.6, w = 0.35 + r() * 0.3, h = 0.3 + r() * 0.4;
    const y = i > 3 ? 0.45 : 0;
    const k = r() < 0.5 ? BOAT_K.CARGO : r() < 0.6 ? BOAT_K.WOOD : BOAT_K.MAT;
    box(B, x, y, z, x + w, y + h, z + w * 0.8, [k, 0, 0.3, 0]);
  }
  return B.toGeometry();
}

export async function build(engine, plan) {
  const t0 = performance.now();
  const s7 = SHOTS.find((s) => s.id === 7);
  const group = new THREE.Group(); group.name = 'city:props';
  const aw = [], carts = [], goods = [];
  const F = plan.frame;
  plan.houses.forEach((h, i) => {
    if (!h.street) return;
    const d = Math.hypot(h.x - s7.pos[0], h.z - s7.pos[2]);
    if (d > 650) return;
    const fx = Math.sin(h.rot), fz = Math.cos(h.rot);
    const front = [h.x + fx * h.d / 2, h.z + fz * h.d / 2];
    const y = h.y + 0.04;
    const r = hash01(i, 501);
    if (r < 0.55) aw.push({ x: front[0] + fx * 1.35, y, z: front[1] + fz * 1.35, rot: h.rot, w: h.w * (0.45 + 0.35 * hash01(i, 502)), c: hash01(i, 503) });
    if (hash01(i, 504) < 0.35) goods.push({ x: front[0] + fx * (1.6 + hash01(i, 505)), y, z: front[1] + fz * (1.6 + hash01(i, 505)), rot: h.rot + (hash01(i, 506) - 0.5) * 0.4, v: Math.floor(hash01(i, 507) * 3) });
    if (hash01(i, 508) < 0.12) {
      const off = 3.5 + 3 * hash01(i, 509);
      carts.push({ x: front[0] + fx * off, y: heightAt(front[0] + fx * off, front[1] + fz * off) + 0.06, z: front[1] + fz * off, rot: h.rot + Math.PI / 2 + (hash01(i, 510) - 0.5) * 1.2 });
    }
  });
  // a few carts in the street itself
  for (let k = 0; k < 14; k++) {
    const v = plan.vMax - 120 - k * 38 - 20 * hash01(k, 520), u = (hash01(k, 521) - 0.5) * 16;
    const [x, z] = F.toWorld(u, v);
    carts.push({ x, y: heightAt(x, z) + 0.12, z, rot: (hash01(k, 522) - 0.5) * 0.8 + (hash01(k, 523) < 0.5 ? 0 : Math.PI) + Math.atan2(F.at(v).tx, F.at(v).tz) });
  }
  const M = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
  const inst = (geo, mat, list, scale, name, colors = null) => {
    if (!list.length) return null;
    const im = new THREE.InstancedMesh(geo, mat, list.length);
    list.forEach((p, i) => {
      q.setFromAxisAngle(up, p.rot);
      M.compose(new THREE.Vector3(p.x, p.y, p.z), q, scale(p));
      im.setMatrixAt(i, M);
      if (colors) im.setColorAt(i, colors(p));
    });
    im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true;
    im.computeBoundingSphere();
    im.name = name; im.castShadow = true; im.receiveShadow = true;
    group.add(im);
    return im;
  };
  const A = awningGeo();
  const palette = [new THREE.Color(1, 1, 1), new THREE.Color(0.95, 0.9, 0.8), new THREE.Color(0.35, 0.42, 0.62), new THREE.Color(0.85, 0.62, 0.38), new THREE.Color(0.7, 0.32, 0.25), new THREE.Color(0.92, 0.92, 0.88)];
  inst(A.cloth, clothMaterial(), aw, (p) => new THREE.Vector3(p.w, 1, 1), 'props:awnings', (p) => palette[Math.floor(p.c * palette.length) % palette.length]);
  inst(A.poles, boatMaterial(), aw, (p) => new THREE.Vector3(p.w, 1, 1), 'props:awning-poles');
  inst(cartGeo(), boatMaterial(), carts, () => new THREE.Vector3(1, 1, 1), 'props:carts');
  const G = [goodsGeo(11), goodsGeo(23), goodsGeo(57)];
  for (let v = 0; v < 3; v++) inst(G[v], boatMaterial(), goods.filter((g) => g.v === v), () => new THREE.Vector3(1, 1, 1), 'props:goods' + v);
  engine.add(group);
  void L; void PAINT; void hallMaterials;
  console.log(`[city] props: ${aw.length} awnings, ${carts.length} carts, ${goods.length} goods stacks, ${Math.round(performance.now() - t0)} ms`);
  return { group, counts: { awnings: aw.length, carts: carts.length, goods: goods.length } };
}
