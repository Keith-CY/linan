// The hamlets' own pieces (planned by src/explore/villages.js): thatched cottages, threshing floors with their straw
// stacks, the earth-god shrines. Instanced over every hamlet (a few thousand pieces, ~60 k triangles), in the
// countryside's materials (src/explore/fields.js farmMaterial) with the ink classes of the buildings they stand for:
// earth walls (wall), thatch and tile (roof), doors (dark), the shrine's plinth (stone), the floor (ground).
//
//   const g = buildHamlets(engine, hamlets)   → { group, mats, counts }
import * as THREE from 'three';
import { farmMaterial } from './fields.js';
import { CLS } from '../ink/gbuffer.js';

const WALL_H = 2.3;

/** box from x0..x1, y0..y1, z0..z1 (non-indexed triangles, outward faces), optional faces mask (no bottom) */
function box(pos, x0, x1, y0, y1, z0, z1) {
  const q = (a, b, c, d) => pos.push(...a, ...b, ...c, ...a, ...c, ...d);
  q([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]);   // +z
  q([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]);   // -z
  q([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]);   // +x
  q([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]);   // -x
  q([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]);   // top
}
function geoOf(pos) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}
/** a hipped roof over a unit plan (x ±0.5, z ±0.5) from y = 0 to 1, ridge along x (`ridge` of the length), with an eave
 *  band `band` deep (the thatch's thick edge) */
function hipRoof(ridge = 0.45, band = 0.12) {
  const pos = [];
  const tri = (a, b, c) => pos.push(...a, ...b, ...c);
  const r0 = [-ridge / 2, 1, 0], r1 = [ridge / 2, 1, 0];
  const A = [-0.5, band, -0.5], B = [0.5, band, -0.5], C = [0.5, band, 0.5], D = [-0.5, band, 0.5];
  tri(D, C, r1); tri(D, r1, r0);            // front slope
  tri(B, A, r0); tri(B, r0, r1);            // back slope
  tri(C, B, r1); tri(A, D, r0);             // hips
  // the eave band (the thatch's thick edge)
  const a = [-0.5, 0, -0.5], b = [0.5, 0, -0.5], c = [0.5, 0, 0.5], d = [-0.5, 0, 0.5];
  const q = (p, s, t, u) => { tri(p, s, t); tri(p, t, u); };
  q(d, c, C, D); q(b, a, A, B); q(c, b, B, C); q(a, d, D, A);
  return geoOf(pos);
}
/** a gable (悬山) roof: two slopes along x, gables at ±x, overhanging */
function gableRoof() {
  const pos = [];
  const tri = (a, b, c) => pos.push(...a, ...b, ...c);
  const r0 = [-0.5, 1, 0], r1 = [0.5, 1, 0];
  const A = [-0.5, 0, -0.5], B = [0.5, 0, -0.5], C = [0.5, 0, 0.5], D = [-0.5, 0, 0.5];
  tri(D, C, r1); tri(D, r1, r0); tri(B, A, r0); tri(B, r0, r1);
  // the underside, so the overhang reads from below
  tri(C, D, r0); tri(C, r0, r1); tri(A, B, r1); tri(A, r1, r0);
  return geoOf(pos);
}
function stackGeo() {
  // a straw stack: a short drum and a cone (radius 1, drum to 0.55, cone tip at 1)
  const g1 = new THREE.CylinderGeometry(1, 1.05, 0.55, 9, 1, true); g1.translate(0, 0.275, 0);
  const g2 = new THREE.ConeGeometry(1.12, 0.5, 9, 1, true); g2.translate(0, 0.8, 0);
  const pos = [];
  for (const g of [g1, g2]) pos.push(...g.toNonIndexed().attributes.position.array);
  return geoOf(pos);
}

/** a matrix (column-major) for three's rotation.y = ry, at (x, y, z), scaled */
function put(mesh, i, x, y, z, ry, sx, sy, sz) {
  const a = mesh.instanceMatrix.array, o = i * 16, c = Math.cos(ry), s = Math.sin(ry);
  a[o] = c * sx; a[o + 1] = 0; a[o + 2] = -s * sx; a[o + 3] = 0;
  a[o + 4] = 0; a[o + 5] = sy; a[o + 6] = 0; a[o + 7] = 0;
  a[o + 8] = s * sz; a[o + 9] = 0; a[o + 10] = c * sz; a[o + 11] = 0;
  a[o + 12] = x; a[o + 13] = y; a[o + 14] = z; a[o + 15] = 1;
}

export function buildHamlets(engine, hamlets) {
  const group = new THREE.Group();
  group.name = 'explore:hamlets';
  const mats = {
    earth: farmMaterial(engine, 'hamlet-earth-wall', CLS.WALL, { col: [0.6, 0.55, 0.46] }),
    thatch: farmMaterial(engine, 'hamlet-thatch', CLS.ROOF, { col: [0.36, 0.3, 0.19], col2: [0.22, 0.18, 0.12], rows: [0.3, 0.28, 0, 0.35] }),
    door: farmMaterial(engine, 'hamlet-door', CLS.DARK, { col: [0.035, 0.03, 0.025] }),
    floor: farmMaterial(engine, 'hamlet-floor', CLS.GROUND, { col: [0.62, 0.57, 0.46], lift: 0.0002 }),
    straw: farmMaterial(engine, 'hamlet-straw', CLS.ROOF, { col: [0.55, 0.46, 0.27], col2: [0.4, 0.33, 0.19], rows: [0.22, 0.25, 0, 0.3] }),
    plaster: farmMaterial(engine, 'hamlet-shrine-wall', CLS.WALL, { col: [0.72, 0.7, 0.66] }),
    tile: farmMaterial(engine, 'hamlet-shrine-tile', CLS.ROOF, { col: [0.075, 0.075, 0.08] }),
    stone: farmMaterial(engine, 'hamlet-shrine-stone', CLS.STONE, { col: [0.42, 0.41, 0.38] }),
  };
  const C = hamlets.flatMap((h) => h.cottages || []);
  const F = hamlets.map((h) => h.floor).filter(Boolean);
  const S = hamlets.flatMap((h) => h.stacks || []);
  const Sh = hamlets.map((h) => h.shrine).filter(Boolean);
  const mk = (geo, mat, n, name) => { const m = new THREE.InstancedMesh(geo, mat, Math.max(1, n)); m.count = n; m.name = 'hamlets:' + name; m.frustumCulled = false; group.add(m); return m; };
  // cottages: earth walls, a deep hipped thatch roof (eaves 0.6 m over), a dark door in the middle of the front
  const unitBox = (() => { const p = []; box(p, -0.5, 0.5, 0, 1, -0.5, 0.5); return geoOf(p); })();
  const walls = mk(unitBox, mats.earth, C.length, 'cottage-walls');
  const roofs = mk(hipRoof(0.42, 0.14), mats.thatch, C.length, 'cottage-roofs');
  const doors = mk(unitBox, mats.door, C.length, 'cottage-doors');
  C.forEach((c, i) => {
    const base = c.y, wh = WALL_H + (c.top - c.y) * 0.5;
    put(walls, i, c.x, base, c.z, c.rot, c.w, wh + 0.05, c.d);
    put(roofs, i, c.x, base + wh - 0.15, c.z, c.rot, c.w + 1.2, 2.0 + 0.12 * c.w, c.d + 1.2);
    const fx = Math.sin(c.rot), fz = Math.cos(c.rot);   // the front (+Z local) in the world
    put(doors, i, c.x + fx * (c.d / 2 + 0.02), base, c.z + fz * (c.d / 2 + 0.02), c.rot, 1.0, 1.85 + (c.top - c.y), 0.08);
  });
  // threshing floors: a packed-earth slab, its edge down into the lowest ground under it
  const floors = mk(unitBox, mats.floor, F.length, 'threshing-floors');
  F.forEach((f, i) => put(floors, i, f.x, f.yMin - 0.25, f.z, -f.rot, f.w, f.y - f.yMin + 0.25, f.d));
  const stacks = mk(stackGeo(), mats.straw, S.length, 'straw-stacks');
  S.forEach((s, i) => put(stacks, i, s.x, s.y, s.z, s.x * 0.37, s.r, s.h, s.r));
  // shrines: a stone plinth, whitewashed walls, a tiled gable roof, a dark opening
  const plinth = mk(unitBox, mats.stone, Sh.length, 'shrine-plinths');
  const swall = mk(unitBox, mats.plaster, Sh.length, 'shrine-walls');
  const sroof = mk(gableRoof(), mats.tile, Sh.length, 'shrine-roofs');
  const sdoor = mk(unitBox, mats.door, Sh.length, 'shrine-doors');
  Sh.forEach((s, i) => {
    put(plinth, i, s.x, s.y, s.z, s.rot, 2.0, 0.55, 1.7);
    put(swall, i, s.x, s.y + 0.5, s.z, s.rot, 1.5, 1.45, 1.25);
    put(sroof, i, s.x, s.y + 1.9, s.z, s.rot, 2.2, 0.8, 1.9);
    const fx = Math.sin(s.rot), fz = Math.cos(s.rot);
    put(sdoor, i, s.x + fx * 0.64, s.y + 0.6, s.z + fz * 0.64, s.rot, 0.6, 0.85, 0.04);
  });
  for (const m of group.children) m.instanceMatrix.needsUpdate = true;
  // only the walls, roofs and stacks cast shadows (doors, floors and the shrines' small parts would add draws to every
  // cascade for shadows a few pixels wide)
  for (const m of group.children) m.castShadow = m.userData.castShadow = [walls, roofs, stacks].includes(m);
  return { group, mats, counts: { cottages: C.length, floors: F.length, stacks: S.length, shrines: Sh.length } };
}
