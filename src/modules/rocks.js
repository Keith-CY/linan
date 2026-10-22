// ROCKS: rocks across the world, from one shared generator and one material family (src/karst/).
//
// build(engine):
//   SDF outcrops (src/karst/outcrop.js, sites in src/karst/sites.js, baked to generated/rocks-outcrop-*.bin):
//     baoshi2  shot 1   the red-brown tuff cliff under the 宝石山 樓閣 (宝石流霞), the wall of layout CLEFTS baoshi-cleft
//     liuhe2   shot 9   the bank where the 六和塔 terrace drops toward the river (east and south)
//     palace3l / palace3f   shot 6   limestone buttresses on the cliffs of the palace mesa (east, north)
//   instanced rocks (src/karst/rock.js rockGeometry, variants normalised to a unit box, scaled per instance):
//     baoshi (tuff among the pines) · liuhe (the 月轮山 slope) · palace (other skirts) · su (苏堤 shore stones near the
//     pavilion, two flat rocks) · duanqiao (白堤 shore at 断桥, in clusters) · santan (the lake pavilion's islet) ·
//     feilai (talus at the 飞来峰 foot and boulders in 冷泉溪, off the shot-8 camera's near field)
//   太湖石 (src/karst/rock.js taihuSDF, baked): two in the 灵隐 court (shot 8), one on the palace terrace (shot 6)
// Materials: karstMaterial — limestone (wet at the waterline), tuff, a shaded limestone, 太湖石; snow and autumn moss
// follow registry.season (onShot). Registers footprints for the big rocks; registry.karst.rocks = { group, count }.
// test(engine): node tools/render.mjs --test rocks --view 0 (the generator gallery) | --view 1 (太湖石,
//   --params "seeds=3,4,5,6" for others). The sites are checked in the full world (shots 1, 2, 5, 6, 8, 9, 10).
import * as THREE from 'three';
import * as L from '../world/layout.js';
import { heightAt, normalAt } from '../world/heightfield.js';
import { rockGeometry, taihuGeometry, taihuSDF } from '../karst/rock.js';
import { karstMaterial, setKarstSeason } from '../karst/material.js';
import { makeOutcrop } from '../karst/outcrop.js';
import { outcropSites, TAIHU } from '../karst/sites.js';
import { meshRegion } from '../karst/build.js';
import { meshSDF, bakeRock, toGeometry } from '../sculpt/mesher.js';
import { loadOrBuild } from '../core/cache.js';

export const ROCKS_VERSION = 'v1';
const q = (detail) => (detail >= 1 ? 'hi' : 'lo');
export const outcropName = (site, detail) => `rocks-outcrop-${site}-${q(detail)}-${ROCKS_VERSION}`;
export const taihuName = (seed, detail) => `rocks-taihu-${seed}-${q(detail)}-${ROCKS_VERSION}`;

/** mesh one outcrop site (node bake or runtime fallback) → mesher result with aRock */
export function buildOutcropMesh(name, detail = 1) {
  const S = outcropSites().find((x) => x.name === name);
  const O = makeOutcrop(S.spec);
  const R = { ...O.region, cell: O.region.cell * (detail >= 1 ? 1 : 1.7) };
  return meshRegion(O.sdf, [R], R.name, { origin: O.origin, aoSteps: [0.05, 0.12, 0.28, 0.6, 1.3, 2.6] });
}
/** mesh one 太湖石 (base at y = 0, local) */
export function buildTaihuMesh(seed, h, detail = 1) {
  const f = taihuSDF(seed, h);
  const cell = detail >= 1 ? 0.028 : 0.045;
  const m = meshSDF(f, { min: [-h * 0.7, -0.05, -h * 0.6], max: [h * 0.7, h * 1.1, h * 0.6], cell, origin: [0, 0, 0], smooth: 1, project: 1, bandScale: 1.8 });
  return bakeRock(m, f, { aoSteps: [0.02, 0.05, 0.12, 0.25, 0.5], cavDist: 0.04, upDist: 2 });
}

/** a library of rock variants per kind (geometry shared by the instances) */
/** variants per kind; `shift` lowers the icosphere level (far sites: -1 → a quarter of the triangles) */
function library(detail, shift = 0) {
  const det = (d) => Math.max(2, Math.round(d + shift + (detail >= 1 ? 0 : -1)));
  const lib = {};
  lib.boulder = [0, 1, 2, 3, 4, 5].map((i) => rockGeometry('boulder' + i, { shape: 'boulder', size: [1, 0.72, 1], detail: det(4), strata: 0.3 }));
  lib.block = [0, 1, 2, 3, 4, 5].map((i) => rockGeometry('block' + i, { shape: i % 2 ? 'mass' : 'block', size: [1, 0.7, 0.85], detail: det(4), strata: 0.7, cracks: 1.2 }));
  lib.slab = [0, 1, 2, 3].map((i) => rockGeometry('slab' + i, { shape: 'slab', size: [1, 0.3, 0.8], detail: det(4), strata: 0.6 }));
  lib.big = [0, 1, 2].map((i) => rockGeometry('big' + i, { shape: 'mass', size: [1, 0.75, 0.9], detail: det(4), strata: 0.8, cracks: 1.4 }));
  lib.tuff = [0, 1, 2, 3].map((i) => rockGeometry('tuff' + i, { shape: 'mass', size: [1, 0.7, 0.85], detail: det(4), strata: 0.15, cracks: 1.8, roughness: 1.2 }));
  lib.pebble = [0, 1, 2].map((i) => rockGeometry('pebble' + i, { shape: 'boulder', size: [1, 0.55, 0.8], detail: det(3), strata: 0.1 }));
  // normalise every variant to a unit box (centred in x/z, base at y = -0.5): instances scale by their size [x, y, z]
  for (const k in lib) for (const g of lib[k]) {
    g.computeBoundingBox();
    const b = g.boundingBox, w = b.max.x - b.min.x, h = b.max.y - b.min.y, d = b.max.z - b.min.z;
    g.translate(-(b.min.x + b.max.x) / 2, -(b.min.y + b.max.y) / 2, -(b.min.z + b.max.z) / 2);
    g.scale(1 / w, 1 / h, 1 / d);
    g.computeBoundingBox(); g.computeBoundingSphere();
  }
  return lib;
}

// ------------------------------------------------------------------ placement helpers
function hash(n) { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453123; return s - Math.floor(s); }
/** instance record: kind, variant, position, rotation (yaw + tilt to the ground), scale [x, y, z], burial (0..1) */
function put(list, kind, v, x, z, size, o = {}) {
  const sy = size[1];
  const g = o.y ?? heightAt(x, z);
  list.push({ kind, v, x, z, y: g - sy * (o.burial ?? 0.3) + sy * 0.5, size, yaw: o.yaw ?? hash(x * 3.1 + z * 7.7) * Math.PI * 2, tilt: o.tilt ?? 0.6, site: o.site });
}
/** points along the waterline of a causeway near a camera: walks out from the centre line until the ground drops to the water */
function causewayShore(C, cam, range, side, step) {
  const out = [];
  const pts = C.points;
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
    const len = Math.hypot(bx - ax, bz - az), tx = (bx - ax) / len, tz = (bz - az) / len, nx = -tz * side, nz = tx * side;
    for (let s = 0; s < len; s += step) {
      const cx = ax + tx * s, cz = az + tz * s;
      if (Math.hypot(cx - cam[0], cz - cam[2]) > range) continue;
      let d = C.width * 0.3;
      while (d < C.width && heightAt(cx + nx * d, cz + nz * d) > 0.15) d += 0.25;
      if (heightAt(cx + nx * d, cz + nz * d) > 0.4) continue; // a bridge gap or the shore: skip
      out.push({ x: cx + nx * d, z: cz + nz * d, nx, nz });
    }
  }
  return out;
}

// ------------------------------------------------------------------ sites
function sites(engine) {
  const R = [];
  const rng = engine.rng('rocks');
  // ---- shot 1: the bare tuff slope of the ravine (CLEFTS baoshi-cleft) on the vantage side, boulders on it and its
  //      floor (宝石流霞); the cliff under the 樓閣 is an SDF site
  {
    const C = L.CLEFTS.find((c) => c.id === 'baoshi-cleft');
    const P = C.points;
    for (let k = 0, n = 0; k < 400 && n < 46; k++) {
      const i = Math.floor(rng.random() * 3), f = rng.random();
      const [x0, z0] = P[i], [x1, z1] = P[i + 1], len = Math.hypot(x1 - x0, z1 - z0);
      const ux = (x1 - x0) / len, uz = (z1 - z0) / len;
      const off = -(rng.random() ** 0.7) * 44;                              // left of the way down = the vantage side
      const x = x0 + ux * f * len - uz * off, z = z0 + uz * f * len + ux * off;
      const s = 0.7 + 2.6 * rng.random() ** 2;
      put(R, 'tuff', k % 4, x, z, [s, s * 0.6, s * 0.8], { burial: 0.45, site: 'baoshi' });
      n++;
    }
  }
  // ---- shot 9: scattered rock on the 月轮山 slope round the 六和塔 platform (the bank itself is an SDF site)
  {
    const t = (L.CHENGTAI || []).find((x) => x.id === 'liuhe-base');
    const [cx, cz] = t.center, hw = t.size[0] / 2, hd = t.size[1] / 2;
    for (let k = 0; k < 50; k++) {
      const x = cx - hw - 50 + rng.random() * 110, z = cz - hd - 40 + rng.random() * 100;
      if (Math.abs(x - cx) < hw + 3 && Math.abs(z - cz) < hd + 3) continue;
      if (heightAt(x, z) < 3) continue;
      if ((L.STAIRS || []).some((st) => st.id.startsWith('liuhe') && Math.abs(x - st.from[0]) < st.width && z > Math.min(st.from[1], st.to[1]) - 2 && z < Math.max(st.from[1], st.to[1]) + 2)) continue;
      if (L.HAMLETS?.length && z > 4955 + (x + 1558) * -0.73) continue;   // the harbour village below
      const s = 0.8 + 2.4 * rng.random() ** 2;
      put(R, k % 2 ? 'block' : 'boulder', k % 6, x, z, [s, s * 0.65, s * 0.85], { burial: 0.35, site: 'liuhe' });
    }
  }
  // ---- shot 6: blocks and boulders on the palace mesa's cliffs and talus (the buttresses are SDF sites)
  {
    const M = L.PALACE.mound, O = M.outline;
    let n = 0;
    for (let k = 0; k < 1400 && n < 70; k++) {
      const i = Math.floor(rng.random() * (O.length - 1));
      if ((M.cliff[i] ?? 0) < 0.5) continue;
      const [a0, b0] = O[i], [a1, b1] = O[i + 1], len = Math.hypot(a1 - a0, b1 - b0), t = rng.random();
      const out = 3 + 30 * rng.random() ** 1.5;
      const a = a0 + (a1 - a0) * t + ((b1 - b0) / len) * out, b = b0 + (b1 - b0) * t - ((a1 - a0) / len) * out;
      const [x, z] = L.palaceAt(a, b);
      if ((L.CHENGTAI || []).some((T) => { const r = ((T.rot || 0) * Math.PI) / 180, dx = x - T.center[0], dz = z - T.center[1]; return Math.abs(dx * Math.sin(r) - dz * Math.cos(r)) < T.size[0] / 2 + 4 && Math.abs(dx * Math.cos(r) + dz * Math.sin(r)) < T.size[1] / 2 + 4; })) continue;
      if (normalAt(x, z, 2)[1] > (out < 14 ? 0.9 : 0.8)) continue;
      const s = 1.2 + 3.2 * rng.random() ** 1.5;
      put(R, n % 4 === 0 ? 'big' : 'block', n % 4 === 0 ? n % 3 : n % 6, x, z, [s, s * 0.6, s * 0.8], { burial: 0.4, tilt: 0.9, site: 'palace' });
      n++;
    }
  }
  // ---- shot 2: shore stones of the 苏堤 near the pavilion, the two flat rocks on the east shore
  {
    const cam = L.forShot ? [-413.2, 2.5, 307.6] : [0, 0, 0];
    for (const side of [-1, 1]) for (const p of causewayShore(L.SU_CAUSEWAY, cam, 140, side, 2.2)) {
      const h = hash(p.x * 1.7 + p.z);
      const s = 0.5 + 1.1 * h * h;
      put(R, h > 0.6 ? 'slab' : 'boulder', Math.floor(h * 4), p.x + p.nx * (hash(p.z) - 0.3), p.z + p.nz * (hash(p.x) - 0.3), [s, s * 0.6, s * 0.8], { burial: 0.35, y: 0.02, site: 'su' });
    }
    put(R, 'slab', 1, -397.0, 262, [3.2, 0.9, 2.2], { burial: 0.2, y: 0.25, yaw: 0.3, tilt: 0.1, site: 'su' });
    put(R, 'slab', 2, -396.4, 255.5, [2.6, 0.8, 1.9], { burial: 0.25, y: 0.2, yaw: 1.4, tilt: 0.1, site: 'su' });
  }
  // ---- shot 10: boulders along the 白堤 shore at 断桥 (both sides of the causeway end)
  {
    const cam = [687.5, 5, -1635.4];
    for (const side of [-1, 1]) for (const p of causewayShore(L.BAI_CAUSEWAY, cam, 110, side, 1.3)) {
      // clusters with gaps: the revetment shows only where the bank has slumped
      if (Math.sin(p.x * 0.21 + p.z * 0.13) + 0.6 * Math.sin(p.x * 0.53 - p.z * 0.31) < 0.35) continue;
      const h = hash(p.x * 2.3 + p.z * 0.7);
      const s = 0.6 + 1.6 * h * h;
      put(R, h > 0.6 ? 'block' : 'boulder', Math.floor(h * 6), p.x - p.nx * 0.4 * h, p.z - p.nz * 0.4 * h, [s, s * 0.55, s * 0.85], { burial: 0.45, y: 0.1, site: 'duanqiao' });
    }
  }
  // ---- shot 5: stones round the islet of the lake pavilion
  {
    for (const I of L.ISLETS || []) for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2 + hash(k) * 0.3, r = I.radius + 0.6 + hash(k * 3) * 1.2;
      const s = 0.5 + 0.9 * hash(k * 7);
      put(R, 'boulder', k % 6, I.center[0] + Math.cos(a) * r, I.center[1] + Math.sin(a) * r, [s, s * 0.6, s * 0.8], { burial: 0.35, y: 0.0, site: 'santan' });
    }
  }
  // ---- shot 8: talus at the foot of the 飞来峰 cliff and boulders in 冷泉溪
  {
    const K = engine.registry.karst?.feilai;
    const footZ = (x) => { const P = [[-4000, 447.0], [-3975, 445.0], [-3966, 444.1], [-3958, 443.6], [-3940, 441.7], [-3910, 438.9], [-3880, 436.6]]; for (let i = 0; i < P.length - 1; i++) if (x <= P[i + 1][0]) return P[i][1] + (P[i + 1][1] - P[i][1]) * (x - P[i][0]) / (P[i + 1][0] - P[i][0]); return 436; };
    for (let k = 0; k < 40; k++) {
      const x = -3970 + rng.random() * 84, z = footZ(x) - 3 - rng.random() * 3.5;
      if (Math.hypot(x + 3978, z - 439) < 10 || Math.abs(x - -3948) < 6) continue;   // the camera, the bridge landing
      if (K && K.sdf(x, heightAt(x, z) + 0.5, z) < 0) continue;     // inside the cliff
      const s = 0.6 + 1.8 * rng.random() ** 2;
      put(R, k % 3 ? 'boulder' : 'block', k % 6, x, z, [s, s * 0.6, s * 0.85], { burial: 0.3, site: 'feilai' });
    }
    // big mossy blocks at the cliff foot in front of the camera (ref08 bottom centre: rock reaches the frame's edge)
    // (the biggest one moved from right in front of the 布袋's pedestal, where it hid the crossed legs from
    // both shot-8 cameras, to the foot of the step by the stream on the left, as ink08 has rocks there)
    for (const [x, z, s, v] of [[-3964.6, 438.6, 2.6, 0], [-3964, 441.0, 1.9, 1], [-3970.5, 440.6, 1.5, 2], [-3961, 443.8, 2.2, 3], [-3966, 437.8, 1.1, 4]]) {
      put(R, 'block', v, x, z, [s, s * 0.7, s * 0.9], { burial: 0.25, site: 'feilai' });
    }
    // boulders along the stream (ref08 bottom left), kept off the camera's near field
    for (let k = 0; k < 16; k++) {
      const x = -3966 + rng.random() * 26, z = 427 + rng.random() * 6;
      if (Math.hypot(x + 3978, z - 439) < 12) continue;
      const s = 0.7 + 1.5 * rng.random();
      put(R, 'boulder', k % 6, x, z, [s, s * 0.55, s * 0.8], { burial: 0.35, site: 'feilai' });
    }
  }
  return R;
}

export async function build(engine) {
  const t0 = performance.now();
  const detail = engine.quality.detail ?? 1;
  // near sites keep the full variants; the rest are seen from 50 m and more
  const NEAR_SITES = new Set(['feilai', 'su']);
  const libs = { near: library(detail), far: library(detail, -1) };
  const limestone = karstMaterial({ name: 'rocks-limestone', moss: 0.5, lichen: 0.7, streaks: 0.35, strata: 0.3, wetBelow: 0.06, ochre: 0.3 });
  const tuff = karstMaterial({ name: 'rocks-tuff', tuff: 1, moss: 0.35, lichen: 0.55, streaks: 0.25, strata: 0.0, ochre: 0.6 });
  const taihuM = karstMaterial({ name: 'rocks-taihu', moss: 0.25, lichen: 0.45, streaks: 0.4, strata: 0.0, ochre: 0.15, tint: 0xf2efe8 });
  const pale = karstMaterial({ name: 'rocks-pale', moss: 0.4, lichen: 0.6, streaks: 0.5, strata: 0.35, ochre: 0.25, tint: 0xf4f0e6 });
  const shaded = karstMaterial({ name: 'rocks-shaded', moss: 0.6, lichen: 0.75, streaks: 0.7, strata: 0.35, ochre: 0.25, darkness: 0.35 });
  const mossy = karstMaterial({ name: 'rocks-mossy', moss: 0.85, lichen: 0.8, streaks: 0.5, strata: 0.3, wetBelow: 23.5, ochre: 0.2, darkness: 0.3 });
  const outMat = { tuff, limestone, pale, shaded };
  const siteMat = (site, kind) => (kind === 'tuff' ? tuff : site === 'feilai' ? mossy : limestone);
  const group = new THREE.Group();
  group.name = 'rocks';
  // the explorable world walks with lighter rocks (half-detail meshes, the far boulder variants); the still view
  // (src/explore/still.js) puts the stills' own back: { mesh, live, still } geometry pairs
  const lite = engine.explore && detail > 0.5 && engine.params?.get?.('rocksLive') !== 'full';
  const swaps = [];
  // SDF outcrops (baked)
  let tris = 0;
  for (const S of outcropSites()) {
    const geo = await loadOrBuild(outcropName(S.name, detail), () => toGeometry(buildOutcropMesh(S.name, detail)));
    const m = new THREE.Mesh(geo, outMat[S.material]);
    m.position.set(...geo.userData.origin ?? makeOutcrop(S.spec).origin);
    m.name = 'rocks:outcrop-' + S.name;
    if (lite) swaps.push({ mesh: m, still: geo, live: await loadOrBuild(outcropName(S.name, 0.5), () => toGeometry(buildOutcropMesh(S.name, 0.5))) });
    group.add(m);
    tris += geo.index.count / 3;
  }
  // instances grouped by (site, kind, variant): each InstancedMesh has a local bounding sphere, so a shot only draws
  // (and shadows) the sites in its view
  const list = sites(engine);
  const byKey = new Map();
  for (const r of list) { const k = r.site + ':' + r.kind + ':' + r.v; if (!byKey.has(k)) byKey.set(k, []); byKey.get(k).push(r); }
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), qt = new THREE.Quaternion(), e = new THREE.Euler(), s3 = new THREE.Vector3(), p3 = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  for (const [k, rs] of byKey) {
    const [site, kind, v] = k.split(':');
    const lib = libs[NEAR_SITES.has(site) ? 'near' : 'far'];
    const geo = lib[kind][Number(v) % lib[kind].length];
    const mesh = new THREE.InstancedMesh(geo, siteMat(site, kind), rs.length);
    mesh.name = 'rocks:' + k;
    rs.forEach((r, i) => {
      const n = normalAt(r.x, r.z, Math.max(1, r.size[0] * 0.5));
      const nv = new THREE.Vector3(n[0] * r.tilt, 1, n[2] * r.tilt).normalize();
      qt.setFromUnitVectors(up, nv);
      q.setFromEuler(e.set(0, r.yaw, 0));
      q.premultiply(qt);
      m4.compose(p3.set(r.x, r.y, r.z), q, s3.set(r.size[0], r.size[1], r.size[2]));
      mesh.setMatrixAt(i, m4);
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    if (lite && NEAR_SITES.has(site)) swaps.push({ mesh, still: geo, live: libs.far[kind][Number(v) % libs.far[kind].length] });
    group.add(mesh);
    tris += (geo.index.count / 3) * rs.length;
  }
  // 太湖石 (meshed SDF, baked)
  for (const T of TAIHU) {
    const geo = await loadOrBuild(taihuName(T.seed, detail), () => toGeometry(buildTaihuMesh(T.seed, T.h, detail)));
    const m = new THREE.Mesh(geo, taihuM);
    m.position.set(T.at[0], heightAt(T.at[0], T.at[1]) - 0.05, T.at[1]);
    m.rotation.y = L.headingToRotY(T.facing);
    m.name = 'rocks:taihu-' + T.seed;
    if (lite) swaps.push({ mesh: m, still: geo, live: await loadOrBuild(taihuName(T.seed, 0.5), () => toGeometry(buildTaihuMesh(T.seed, T.h, 0.5))) });
    group.add(m);
    tris += geo.index.count / 3;
    engine.footprints?.addCircle(T.at[0], T.at[1], T.h * 0.4, 'taihu');
  }
  engine.add(group, { castShadow: true, receiveShadow: true });
  for (const w of swaps) w.mesh.geometry = w.live;
  if (swaps.length) (engine.registry.stillSwap ||= []).push(...swaps);
  const mats = [limestone, tuff, taihuM, pale, shaded, mossy];
  const season = () => setKarstSeason(mats, engine.registry.season);
  season();
  engine.onShot(season);
  for (const r of list) if (r.size[0] > 1.5) engine.footprints?.addCircle(r.x, r.z, r.size[0] * 0.45, 'rock');
  // the ravines (layout CLEFTS) and their bare rocky flank on the vantage side keep no trees ('clear': the walker
  // ignores it, the vegetation's footprint test does not); the hero pines on the cliff are planted regardless
  for (const C of L.CLEFTS || []) {
    const P = C.points.slice(0, 4);
    const side = P.map(([x, z], i) => { const [ax, az] = P[Math.max(0, i - 1)], [bx, bz] = P[Math.min(P.length - 1, i + 1)], l = Math.hypot(bx - ax, bz - az); return [x + ((bz - az) / l) * 24, z - ((bx - ax) / l) * 24]; });
    engine.footprints?.addPath(side, 30, 'clear');
  }
  engine.registry.karst = { ...(engine.registry.karst || {}), rocks: { group, count: list.length }, materials: [...(engine.registry.karst?.materials || []), ...mats] };
  console.log(`[rocks] ${outcropSites().length} outcrops, ${list.length} rocks in ${byKey.size} instanced meshes, ${TAIHU.length} 太湖石: ${(tris / 1e6).toFixed(2)} M tris, ${Math.round(performance.now() - t0)} ms`);
}

export async function test(engine) {
  const P = engine.params;
  const which = P?.get?.('site');
  const sun = { azimuth: 210, elevation: 30 };
  if (!which) {
    // gallery: every kind and the 太湖石 on the test ground
    const lib = library(1);
    const mat = karstMaterial({ moss: 0.5, lichen: 0.7, streaks: 0.35, strata: 0.3, wetBelow: 0.06 });
    const tuff = karstMaterial({ tuff: 1, moss: 0.35, lichen: 0.55, streaks: 0.25, strata: 0, ochre: 0.6 });
    const taihuM = karstMaterial({ moss: 0.25, lichen: 0.45, streaks: 0.4, strata: 0, ochre: 0.15, tint: 0xf2efe8 });
    let x = -9;
    for (const kind of ['boulder', 'block', 'slab', 'big', 'tuff', 'pebble']) {
      lib[kind].forEach((g, i) => {
        const s = kind === 'big' ? 3 : kind === 'pebble' ? 0.6 : 1.6;
        const m = new THREE.Mesh(g, kind === 'tuff' ? tuff : mat);
        const sy = s * (kind === 'slab' ? 0.3 : 0.65);
        m.scale.set(s, sy, s * 0.8);
        m.position.set(x + i * (s + 0.6), 0.45 * sy, ['boulder', 'block', 'slab', 'big', 'tuff', 'pebble'].indexOf(kind) * 4 - 10);
        engine.add(m);
      });
    }
    const seeds = (P?.get?.('seeds') || '1,2').split(',').map(Number);
    seeds.forEach((sd, i) => { const m = new THREE.Mesh(taihuGeometry(sd, { height: 2.6, cell: 0.03 }), taihuM); m.position.set(14 + i * 3.5 - (seeds.length - 2) * 1.75, 0, -2); engine.add(m); });
    return { views: [
      { pos: [2, 9, 16], target: [2, 0.5, -3], fov: 50, sun },
      { pos: [15.8, 1.6, 7.5], target: [15.8, 1.3, -2], fov: 40, sun },
    ] };
  }
  await build(engine);
  return { views: [] };
}
