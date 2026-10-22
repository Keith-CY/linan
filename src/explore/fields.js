// The countryside of the explorable world, drawn: paddy and terraced fields with their bunds, irrigation channels,
// mulberry plots, tea (src/explore/farm.js plans them in the height workers after the load; the meshes appear when the
// plan is in, a few seconds into the walk). Instanced and cheap:
//   plots     one instanced quad each (all ~120 k, ~0.25 M triangles), level, a little lifted with distance so the
//             coarse far terrain never swallows them
//   bunds     instanced low walls (10 triangles), those within RIM_R of the walker (refilled every REFILL m)
//   channels  one instanced quad each; mulberry: trunk + crown (within TREE_R)
//   tea       a drape over the tea zone (one mesh, ~0.1 M triangles) painted with the rows from its height, and within
//             TEA_R the rows themselves (TeaRows: each a continuous clipped hedge swept along its contour, one mesh per
//             TEA_TILE tile, built one tile a frame)
// Seasons (engine.registry.season): spring and summer the paddies hold water, young rice rows in spring, taller in
// summer; autumn stubble (ground, straw with darker rows); winter snow on fields, bunds and tea, the mulberries bare.
// Nothing but the hamlets casts a shadow. Ink classes (src/ink/gbuffer.js CLS): the paddies and channels water (left
// as paper), the bunds pave (a pale strip, a light ruled line where it meets the water), the drape and the mulberry
// ground ground, tea and mulberry crowns broad, trunks bark — patched here and kept out of the G-buffer's own
// classification (userData.__inkSeen). The shots' cover plants standing on a field are hidden while the countryside
// shows (_plantsOnFields).
//
//   const C = new Countryside(engine); C.start()   (after the build: the plan runs in the workers, low priority)
//   C.update(cameraPosition)                       each moved frame (cheap until the walker has gone REFILL m)
//   C.step()                                       each frame: one tile of near tea rows, when one is waiting
//   C.setVisible(bool)                             the still view at a viewpoint hides it (no still has it)
import * as THREE from 'three';
import { getHeightPool } from './heightpool.js';
import { PLOT, RIM, CHAN, TREE, TEA, DRAPE, TEA_DH, TEA_CELL, packBlocks } from './farm.js';
import { CITY } from '../world/layout.js';
import { patchInkMaterial, CLS } from '../ink/gbuffer.js';
import { buildHamlets } from './hamlets.js';
import { hash01 } from '../core/rng.js';
import { heightAt } from '../world/heightfield.js';

const RIM_R = 650, TEA_R = 300, TREE_R = 600, REFILL = 80, CHUNK = 400;   // a bund is under half a pixel beyond RIM_R
const DRAPE_LIFT = 0.12, DRAPE_FADE = [180, 215];   // the tea drape over the terrain; its rows give way to the hedges
const BOUNDS = [-7000, -7000, 7000, 8000];

// ------------------------------------------------------------------ geometry
function quadGeo() {
  const g = new THREE.PlaneGeometry(1, 1);
  g.rotateX(-Math.PI / 2);
  return g;
}
/** a bund: a low wall with sloping sides, x ∈ [-.5, .5] (length), z ∈ [-.5, .5] (width), y ∈ [0, 1] */
function rimGeo() {
  const t = 0.32;                              // half width at the top
  const P = [
    [-0.5, 0, -0.5], [0.5, 0, -0.5], [0.5, 1, -t], [-0.5, 1, -t],
    [-0.5, 1, t], [0.5, 1, t], [0.5, 0, 0.5], [-0.5, 0, 0.5],
  ];
  const F = [[0, 1, 2], [0, 2, 3], [3, 2, 5], [3, 5, 4], [4, 5, 6], [4, 6, 7], [1, 6, 5], [1, 5, 2], [0, 3, 4], [0, 4, 7]];
  const pos = [];
  for (const f of F) for (const k of f) pos.push(...P[k]);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}
function trunkGeo() {
  const g = new THREE.CylinderGeometry(0.09, 0.15, 1.6, 5, 1, true);
  g.translate(0, 0.8, 0);
  // two stubby pollard arms
  const a = new THREE.CylinderGeometry(0.05, 0.08, 0.7, 4, 1, true); a.rotateZ(0.7); a.translate(0.25, 1.75, 0);
  const b = new THREE.CylinderGeometry(0.05, 0.08, 0.6, 4, 1, true); b.rotateZ(-0.6); b.rotateY(2.1); b.translate(-0.12, 1.7, 0.2);
  const m = mergeGeos([g, a, b]);
  m.computeVertexNormals();
  return m;
}
/** a mulberry's crown: a lumpy, flattened ball of leafy shoots (an icosphere with its corners shared, pushed in and
 *  out by a fixed hash: smooth, not faceted), centred 2.25 m up */
function crownGeo() {
  const src = new THREE.IcosahedronGeometry(1, 1).attributes.position.array;
  const pos = [], idx = [], map = new Map();
  for (let k = 0; k < src.length; k += 3) {
    const x = src[k], y = src[k + 1], z = src[k + 2], key = `${x.toFixed(3)},${y.toFixed(3)},${z.toFixed(3)}`;
    let i = map.get(key);
    if (i === undefined) {
      i = pos.length / 3; map.set(key, i);
      const r = 0.82 + 0.36 * hash01(Math.round(x * 97), Math.round(y * 97), Math.round(z * 97), 5);
      pos.push(x * r * 1.2, y * r * 0.78 + 2.25 + (y < -0.5 ? 0.15 : 0), z * r * 1.2);
    }
    idx.push(i);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}
function mergeGeos(list) {
  const pos = [];
  for (const g of list) { const n = g.index ? g.toNonIndexed() : g; pos.push(...n.attributes.position.array); }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  return out;
}

// ------------------------------------------------------------------ materials
// colour hooks: vFarm = the plot's own metres (u, v) (world x, z on a mesh that is not instanced), vFarmUp = the world
// normal's y, vFarmH = the world height. Uniforms per material: uCol (base), uCol2 (rows), uRows (row period m, row
// share, height offset, amount), uSnow, uLift (m per m of distance), uFade (the drape's rows: fade in from x to y m).
// FARM_CONTOUR (the tea drape): rows along the contours, one every uRows.x m of height (vFarmH - uRows.z).
const VERT_DECL = 'varying vec2 vFarm;\nvarying float vFarmUp, vFarmH;\nuniform float uLift;\n';
const VERT_CODE = /* glsl */`
{
  #ifdef USE_INSTANCING
    vFarm = vec2(position.x * length(instanceMatrix[0].xyz), position.z * length(instanceMatrix[2].xyz));
    vFarmUp = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * normal).y;
    vec4 fW = modelMatrix * instanceMatrix * vec4(transformed, 1.0);
  #else
    vFarm = (modelMatrix * vec4(position, 1.0)).xz; vFarmUp = normalize(mat3(modelMatrix) * normal).y;
    vec4 fW = modelMatrix * vec4(transformed, 1.0);
  #endif
  vFarmH = fW.y;
  // lifted toward the sky with distance: the far terrain is coarser than the heightfield
  fW.y += uLift * distance(fW.xyz, cameraPosition);
  gl_Position = projectionMatrix * viewMatrix * fW;
}
`;
const FRAG_DECL = `varying vec2 vFarm;
varying float vFarmUp, vFarmH;
uniform vec3 uCol, uCol2;
uniform vec4 uRows;
uniform vec2 uFade;
uniform float uSnow;
float farmHash(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float farmNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(farmHash(i), farmHash(i + vec2(1.0, 0.0)), f.x), mix(farmHash(i + vec2(0.0, 1.0)), farmHash(i + vec2(1.0, 1.0)), f.x), f.y);
}
`;
const FRAG_COLOR = /* glsl */`
{
  vec3 c = uCol;
#ifdef FARM_CONTOUR
  // tea on the drape: a hedge across uRows.y of each period of height, broken every few metres, darker on its downhill
  // half; where rows crowd under a pixel, their average. Near the walker the hedges themselves stand on these rows
  // (src/explore/farm.js teaPlan) and the drape keeps only the paths between them
  float t = (vFarmH - uRows.z) / uRows.x;
  float fw = fwidth(t);
  float d = t - floor(t + 0.5);
  float hw = uRows.y * 0.5;
  float row = 1.0 - smoothstep(hw - fw, hw + fw, abs(d));
  row *= smoothstep(0.1, 0.22, farmNoise(vFarm * 0.33));
  row *= smoothstep(uFade.x, uFade.y, distance(vec3(vFarm.x, vFarmH, vFarm.y), cameraPosition));
  float shade = mix(0.65, 1.0, smoothstep(-hw, hw, d));
  float k = smoothstep(0.2, 0.55, fw);
  c = mix(mix(uCol, uCol2 * shade, row), mix(uCol, uCol2 * 0.85, uRows.y * 0.85), k);
  c = mix(c, vec3(0.84, 0.86, 0.9), uSnow * (1.0 - 0.75 * row * (1.0 - smoothstep(-hw, hw * 0.3, d))));
#else
  if (uRows.w > 0.0) {
    // rows across the plot's depth (rice, stubble): fade to their average where a row is under a pixel
    float t = vFarm.y / uRows.x;
    float fw = fwidth(t);
    float row = smoothstep(0.5 - uRows.y * 0.5 - fw, 0.5 - uRows.y * 0.5 + fw, abs(fract(t) - 0.5) * -1.0 + 0.5);
    row = mix(row, uRows.y, smoothstep(0.25, 0.6, fw));
    c = mix(c, uCol2, row * uRows.w);
  }
  c = mix(c, vec3(0.84, 0.86, 0.9), uSnow * smoothstep(0.25, 0.75, vFarmUp));
#endif
  diffuseColor.rgb = c;
}
`;

export function farmMaterial(engine, name, cls, { col, col2 = col, rows = [1, 0, 0, 0], rough = 0.9, lift = 0.0004, contour = false, fade = [0, 0] } = {}) {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: rough, metalness: 0 });
  m.name = name;
  m.polygonOffset = true; m.polygonOffsetFactor = -1; m.polygonOffsetUnits = -2;
  if (contour) m.defines = { FARM_CONTOUR: 1 };
  const U = {
    uCol: { value: new THREE.Color(...col) }, uCol2: { value: new THREE.Color(...col2) },
    uRows: { value: new THREE.Vector4(...rows) }, uSnow: { value: 0 }, uLift: { value: lift }, uFade: { value: new THREE.Vector2(...fade) },
  };
  m.userData.farm = U;
  m.userData.shaderKey = 'farm-v2';
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, U);
    shader.vertexShader = VERT_DECL + shader.vertexShader.replace('#include <project_vertex>', '#include <project_vertex>\n' + VERT_CODE);
    shader.fragmentShader = FRAG_DECL + shader.fragmentShader.replace('#include <color_fragment>', '#include <color_fragment>\n' + FRAG_COLOR);
  };
  engine.patchMaterial(m);                         // atmosphere and the shadow cascades
  if (engine.ink) patchInkMaterial(m, cls);         // the ink G-buffer outputs with this class
  return m;
}

// season looks: [plot material, plot colours / rows] …
const LOOK = {
  spring: { wet: true, water: [0.6, 0.64, 0.66], rice: [0.22, 0.3, 0.14], rows: [0.32, 0.18, 0, 0.35], rim: [0.26, 0.3, 0.16], till: [0.48, 0.43, 0.32], mul: [0.09, 0.15, 0.05], mulOn: true, snow: 0 },
  summer: { wet: true, water: [0.55, 0.6, 0.6], rice: [0.12, 0.2, 0.07], rows: [0.32, 0.45, 0, 0.75], rim: [0.2, 0.26, 0.12], till: [0.46, 0.42, 0.31], mul: [0.06, 0.11, 0.04], mulOn: true, snow: 0 },
  autumn: { wet: false, dry: [0.5, 0.4, 0.24], stub: [0.3, 0.24, 0.14], rows: [0.3, 0.3, 0, 0.6], rim: [0.36, 0.32, 0.2], till: [0.5, 0.42, 0.28], mul: [0.3, 0.26, 0.08], mulOn: true, snow: 0 },
  winter: { wet: false, dry: [0.84, 0.85, 0.88], stub: [0.62, 0.6, 0.56], rows: [0.3, 0.2, 0, 0.25], rim: [0.4, 0.37, 0.3], till: [0.82, 0.83, 0.86], mul: [0.1, 0.1, 0.1], mulOn: false, snow: 1 },
};

// ------------------------------------------------------------------ the countryside
export class Countryside {
  constructor(engine) {
    this.engine = engine;
    this.group = new THREE.Group();
    this.group.name = 'explore:countryside';
    this.group.visible = false;
    this.ready = false;
    this.last = null;
    this.season = null;
    this.stats = {};
  }

  /** plan in the workers, then build; resolves when the meshes are in the scene */
  async start() {
    const e = this.engine, R = e.registry, t0 = performance.now();
    // the hamlets' cottages, threshing floors and shrines need no plan: in at once
    if (R.hamlets?.length) {
      this.hamlets = buildHamlets(e, R.hamlets);
      e.add(this.hamlets.group, { castShadow: true, receiveShadow: true });
      this.hamlets.group.traverse((o) => { if (o.isMesh) o.userData.__inkSeen = true; });
      this.hamlets.group.visible = this.visible !== false;
      this._season(R.season);
      e.onShot(() => this._season(e.registry.season));
      console.log(`[explore] hamlets: ${JSON.stringify(this.hamlets.counts)}`);
    }
    // the city's houses keep the fields off (their 200 m cells)
    const cityCells = [];
    const seen = new Set();
    for (const h of R.city?.plan?.houses || []) {
      if (h.village !== undefined) continue;
      const k = Math.floor(h.x / 200) * 100003 + Math.floor(h.z / 200);
      if (!seen.has(k)) { seen.add(k); cityCells.push(k); }
    }
    // the engine's footprints outside the walled city (temples, pagodas, quays, bridges, rocks, the hamlets' houses …),
    // and each hamlet's lane, threshing floor and shrine (src/explore/villages.js): the fields come up to the houses
    const CB = CITY.bounds, M = 200;
    const items = (e.footprints?.items || []).filter((it) => it.x < CB[0] - M || it.x > CB[2] + M || it.z < CB[1] - M || it.z > CB[3] + M);
    for (const h of R.hamlets || []) {
      const L = Math.max(0, h.r - 22);
      for (let t = -L - 6; t <= L + 6; t += 7) items.push({ type: 'c', x: h.x + h.ux * t, z: h.z + h.uz * t, r: 6.5, br: 6.5 });
      if (h.floor) items.push({ type: 'c', x: h.floor.x, z: h.floor.z, r: Math.hypot(h.floor.w, h.floor.d) / 2 + 2, br: Math.hypot(h.floor.w, h.floor.d) / 2 + 2 });
      if (h.shrine) items.push({ type: 'c', x: h.shrine.x, z: h.shrine.z, r: 5, br: 5 });
    }
    const blocks = packBlocks(items);
    const hamlets = (R.hamlets || []).map((h) => [h.x, h.z, h.r]);
    const plan = await getHeightPool().farm(BOUNDS, { hamlets, cityKeys: cityCells, blocks });
    this.plan = plan;
    const tPlan = performance.now();
    this._build(plan);
    e.add(this.group, { castShadow: false, receiveShadow: true });
    this.group.traverse((o) => { if (o.isMesh) { o.userData.__inkSeen = true; o.castShadow = false; o.userData._cs = false; } });
    this.applySeason(R.season);
    e.onShot(() => this.applySeason(e.registry.season));
    this.ready = true;
    this.group.visible = this.visible !== false;
    this.update(e.camera.position, true);
    await e.renderer.compileAsync(this.group, e.camera, e.scene);
    const tOff = performance.now();
    const off = await this._plantsOnFields();
    this.stats = { plots: plan.plots.length / PLOT, rims: plan.rims.length / RIM, channels: plan.channels.length / CHAN, mulberry: plan.trees.length / TREE, tea: plan.tea.length / TEA, plantsOff: off, planMs: Math.round(tPlan - t0), buildMs: Math.round(tOff - tPlan), offMs: Math.round(performance.now() - tOff) };
    console.log(`[explore] countryside: ${this.stats.plots} plots, ${this.stats.rims} bunds, ${this.stats.channels} channels, ${this.stats.mulberry} mulberries, ${this.stats.tea} tea rows, ${off} plants off the fields; plan ${this.stats.planMs} ms in workers, build ${this.stats.buildMs} ms, plants ${this.stats.offMs} ms`);
    return true;
  }

  _build(plan) {
    const e = this.engine;
    // materials (colours set per season)
    this.mats = {
      wet: farmMaterial(e, 'farm-paddy', CLS.WATER, { col: [0.6, 0.64, 0.66], rough: 0.15 }),
      dry: farmMaterial(e, 'farm-field', CLS.GROUND, { col: [0.5, 0.4, 0.24] }),
      mulGround: farmMaterial(e, 'farm-mulberry-ground', CLS.GROUND, { col: [0.3, 0.3, 0.18] }),
      chan: farmMaterial(e, 'farm-channel', CLS.WATER, { col: [0.5, 0.55, 0.58], rough: 0.15 }),
      rim: farmMaterial(e, 'farm-bund', CLS.PAVE, { col: [0.26, 0.3, 0.16], lift: 0.0003 }),
      tea: farmMaterial(e, 'farm-tea', CLS.BROAD, { col: [0.05, 0.085, 0.04], rough: 0.8, lift: 0.0002 }),
      drape: farmMaterial(e, 'farm-tea-drape', CLS.GROUND, { col: [0.6, 0.54, 0.42], col2: [0.03, 0.055, 0.025], rows: [TEA_DH, 0.5, DRAPE_LIFT, 1], contour: true, fade: DRAPE_FADE, lift: 0.0003 }),
      bark: farmMaterial(e, 'farm-mulberry-bark', CLS.BARK, { col: [0.22, 0.19, 0.15], lift: 0.0002 }),
      crown: farmMaterial(e, 'farm-mulberry', CLS.BROAD, { col: [0.08, 0.13, 0.05], rough: 0.8, lift: 0.0002 }),
    };
    const M = this.mats;
    // plots: paddies and terraces in one mesh, the mulberry ground in another (all of them, composed once)
    const P = plan.plots, nP = P.length / PLOT;
    let nW = 0, nM = 0;
    for (let k = 0; k < nP; k++) { if (P[k * PLOT + 6] === 2) nM++; else nW++; }
    this.plots = new THREE.InstancedMesh(quadGeo(), M.wet, Math.max(1, nW));
    this.mulGround = new THREE.InstancedMesh(quadGeo(), M.mulGround, Math.max(1, nM));
    let iw = 0, im = 0;
    for (let k = 0; k < nP; k++) {
      const o = k * PLOT, mul = P[o + 6] === 2;
      const tgt = mul ? this.mulGround : this.plots, i = mul ? im++ : iw++;
      compose(tgt.instanceMatrix.array, i * 16, P[o], P[o + 2], P[o + 1], P[o + 3], P[o + 4], 1, P[o + 5]);
    }
    this.plots.count = nW; this.mulGround.count = nM;
    for (const m of [this.plots, this.mulGround]) { m.instanceMatrix.needsUpdate = true; m.frustumCulled = false; m.name = 'countryside:' + m.material.name; this.group.add(m); }
    // channels
    const C = plan.channels, nC = C.length / CHAN;
    this.chans = new THREE.InstancedMesh(quadGeo(), M.chan, Math.max(1, nC));
    for (let k = 0; k < nC; k++) { const o = k * CHAN; compose(this.chans.instanceMatrix.array, k * 16, C[o], C[o + 2], C[o + 1], C[o + 3], C[o + 4], 1, C[o + 5]); }
    this.chans.count = nC; this.chans.instanceMatrix.needsUpdate = true; this.chans.frustumCulled = false; this.chans.name = 'countryside:channels';
    this.group.add(this.chans);
    // the tea drape: one mesh (≈ 80 k triangles, one draw), the cells' corners shared, normals from the cells' slopes
    const D = plan.drape, vmap = new Map(), dpos = [], dnrm = [], didx = [];
    const vtx = (x, z, h) => {
      const k = Math.round(x / TEA_CELL) * 100003 + Math.round(z / TEA_CELL);
      let i = vmap.get(k);
      if (i === undefined) { i = dpos.length / 3; vmap.set(k, i); dpos.push(x, h + DRAPE_LIFT, z); dnrm.push(0, 0, 0); }
      return i;
    };
    for (let o = 0; o < D.length; o += DRAPE) {
      const x = D[o], z = D[o + 1], c = TEA_CELL;
      const gx = (D[o + 3] + D[o + 5] - D[o + 2] - D[o + 4]) / (2 * c), gz = (D[o + 4] + D[o + 5] - D[o + 2] - D[o + 3]) / (2 * c);
      const a = vtx(x, z, D[o + 2]), b = vtx(x + c, z, D[o + 3]), cc = vtx(x, z + c, D[o + 4]), d = vtx(x + c, z + c, D[o + 5]);
      for (const i of [a, b, cc, d]) { dnrm[i * 3] -= gx; dnrm[i * 3 + 1] += 1; dnrm[i * 3 + 2] -= gz; }
      didx.push(a, cc, b, b, cc, d);
    }
    for (let i = 0; i < dnrm.length; i += 3) { const l = Math.hypot(dnrm[i], dnrm[i + 1], dnrm[i + 2]) || 1; dnrm[i] /= l; dnrm[i + 1] /= l; dnrm[i + 2] /= l; }
    const dg = new THREE.BufferGeometry();
    dg.setAttribute('position', new THREE.Float32BufferAttribute(dpos, 3));
    dg.setAttribute('normal', new THREE.Float32BufferAttribute(dnrm, 3));
    dg.setIndex(didx);
    dg.computeBoundingSphere();
    this.drape = new THREE.Mesh(dg, M.drape);
    this.drape.name = 'countryside:tea-drape';
    this.drape.receiveShadow = true;
    this.drape.frustumCulled = false;
    this.group.add(this.drape);
    // the near tea rows (built tile by tile round the walker)
    this.teaRows = new TeaRows(this.group, M.tea, plan.tea);
    // chunked sets, refilled round the walker
    this.sets = [
      this._set('bunds', plan.rims, RIM, RIM_R, rimGeo(), M.rim, (a, i, R, o) => compose(a, i * 16, R[o], R[o + 3], R[o + 1], R[o + 4], R[o + 5], R[o + 2] - R[o + 3], R[o + 6])),
      this._set('mulberry-trunks', plan.trees, TREE, TREE_R, trunkGeo(), M.bark, (a, i, R, o) => compose(a, i * 16, R[o], R[o + 2], R[o + 1], R[o + 3], R[o + 4], R[o + 4], R[o + 4])),
      this._set('mulberry-crowns', plan.trees, TREE, TREE_R, crownGeo(), M.crown, (a, i, R, o) => compose(a, i * 16, R[o], R[o + 2], R[o + 1], R[o + 3], R[o + 4], R[o + 4], R[o + 4])),
    ];
  }

  /** a chunked instance set: records grouped by CHUNK-metre cells, those within `radius` copied into one mesh */
  _set(name, R, stride, radius, geo, mat, put) {
    const n = R.length / stride, cells = new Map();
    for (let k = 0; k < n; k++) {
      const key = Math.floor(R[k * stride] / CHUNK) * 100003 + Math.floor(R[k * stride + 1] / CHUNK);
      let c = cells.get(key);
      if (!c) cells.set(key, (c = []));
      c.push(k);
    }
    for (const [k, v] of cells) cells.set(k, Int32Array.from(v));
    // capacity: the most a disc of this radius can hold (densest cells), grown on demand
    const mesh = new THREE.InstancedMesh(geo, mat, 1024);
    mesh.count = 0; mesh.frustumCulled = false; mesh.name = 'countryside:' + name;
    this.group.add(mesh);
    return { name, R, stride, radius, cells, mesh, put, n };
  }

  _fill(S, pos) {
    const r = S.radius, ci0 = Math.floor((pos.x - r) / CHUNK), ci1 = Math.floor((pos.x + r) / CHUNK), cj0 = Math.floor((pos.z - r) / CHUNK), cj1 = Math.floor((pos.z + r) / CHUNK);
    const want = [];
    let total = 0;
    for (let j = cj0; j <= cj1; j++) for (let i = ci0; i <= ci1; i++) {
      // the chunk's nearest point within the radius
      const nx = Math.max(i * CHUNK, Math.min(pos.x, (i + 1) * CHUNK)), nz = Math.max(j * CHUNK, Math.min(pos.z, (j + 1) * CHUNK));
      if (Math.hypot(nx - pos.x, nz - pos.z) > r) continue;
      const c = S.cells.get(i * 100003 + j);
      if (c) { want.push(c); total += c.length; }
    }
    let m = S.mesh;
    if (total > m.instanceMatrix.count) {
      const cap = Math.ceil(total * 1.3);
      const nm = new THREE.InstancedMesh(m.geometry, m.material, cap);
      nm.frustumCulled = false; nm.name = m.name; nm.userData = m.userData; nm.castShadow = false; nm.receiveShadow = true;
      nm.visible = m.visible;
      this.group.remove(m); m.dispose();
      this.group.add(nm);
      S.mesh = m = nm;
    }
    const a = m.instanceMatrix.array;
    let i = 0;
    for (const c of want) for (const k of c) S.put(a, i++, S.R, k * S.stride);
    m.count = i;
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceMatrix.updateRanges) { m.instanceMatrix.clearUpdateRanges(); m.instanceMatrix.addUpdateRange(0, i * 16); }
  }

  update(pos, force = false) {
    if (!this.ready) return;
    if (!force && this.last && Math.hypot(pos.x - this.last.x, pos.z - this.last.z) < REFILL) return;
    this.last = pos.clone();
    for (const S of this.sets) this._fill(S, pos);
    this.teaRows.want(pos);
  }

  /** each frame: build one queued tile of tea rows (true when one was built) */
  step() { return this.ready && this.visible !== false ? this.teaRows.step() : false; }

  /**
   * The trees and ground plants that stand on the fields (the shots' cover fills each shot's view cone, hills and plain
   * alike, before the fields exist) are hidden while the countryside shows: their entry in the vegetation's bucket
   * table (src/vegetation/system.js v.ctr, the crown height) set below zero, so every bucket (near and far) culls them.
   * A still at a viewpoint (no countryside) puts them back. Found in the workers (src/explore/farm.js farmCovers).
   */
  async _plantsOnFields() {
    const veg = this.engine.registry.vegetation?.sys;
    if (!veg) return;
    const vs = veg.variants.filter((v) => v.inst.length && v.ctr);
    const n = vs.reduce((a, v) => a + v.inst.length, 0);
    const pts = new Float32Array(n * 2);
    let k = 0;
    for (const v of vs) for (let i = 0; i < v.inst.length; i++) { pts[k++] = v.ctr[i * 4]; pts[k++] = v.ctr[i * 4 + 2]; }
    const cov = await getHeightPool().farmCovers(this.plan, pts);
    this.offPlants = [];
    let o = 0, total = 0;
    for (const v of vs) {
      const idx = [];
      for (let i = 0; i < v.inst.length; i++) if (cov[o + i]) idx.push(i);
      o += v.inst.length;
      if (!idx.length) continue;
      const I = Int32Array.from(idx), H = new Float32Array(I.length);
      for (let q = 0; q < I.length; q++) H[q] = v.ctr[I[q] * 4 + 3];
      this.offPlants.push({ v, I, H });
      total += I.length;
    }
    this._plants(this.visible === false);
    return total;
  }
  /** the plants on the fields shown (on) or hidden */
  _plants(on) {
    const veg = this.engine.registry.vegetation?.sys;
    if (!veg || !this.offPlants || this.plantsOn === on) return;
    this.plantsOn = on;
    for (const { v, I, H } of this.offPlants) for (let q = 0; q < I.length; q++) v.ctr[I[q] * 4 + 3] = on ? H[q] : -1;
    veg.resetHistory();
  }

  /** test hook: the nearest plot of a kind ('paddy' | 'terrace' | 'mulberry' | 'tea') to (x, z) */
  nearest(kind, x, z) {
    if (!this.plan) return null;
    const tea = kind === 'tea', R = tea ? this.plan.tea : this.plan.plots, st = tea ? TEA : PLOT;
    const want = { paddy: 0, terrace: 1, mulberry: 2 }[kind];
    let best = null, bd = Infinity;
    for (let o = 0; o < R.length; o += st) {
      if (!tea && R[o + 6] !== want) continue;
      const d = Math.hypot(R[o] - x, R[o + 1] - z);
      if (d < bd) { bd = d; best = o; }
    }
    if (best === null) return null;
    if (tea) return { x: (R[best] + R[best + 2]) / 2, z: (R[best + 1] + R[best + 3]) / 2, y: R[best + 4], rot: Math.atan2(R[best + 3] - R[best + 1], R[best + 2] - R[best]), d: Math.round(bd) };
    return { x: R[best], z: R[best + 1], y: R[best + 2], rot: R[best + 3], d: Math.round(bd) };
  }

  /** test hook: a plan map of [x0, z0, x1, z1] as a PNG data URL (ground shaded by height, water blue, the city's houses
   *  grey, paddies pale blue, terraces cyan, mulberry olive, tea green, bunds-paths brown, hamlets red) */
  map(bounds = BOUNDS, size = 1400) {
    const [x0, z0, x1, z1] = bounds, k = size / Math.max(x1 - x0, z1 - z0);
    const W = Math.round((x1 - x0) * k), H = Math.round((z1 - z0) * k);
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const g = cv.getContext('2d'), img = g.createImageData(W, H);
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
      const x = x0 + (i + 0.5) / k, z = z0 + (j + 0.5) / k, y = heightAt(x, z), o = (j * W + i) * 4;
      const c = y < 0.05 ? [150, 180, 210] : [235 - Math.min(150, y * 0.9), 230 - Math.min(150, y * 0.9), 215 - Math.min(150, y * 0.9)];
      img.data[o] = c[0]; img.data[o + 1] = c[1]; img.data[o + 2] = c[2]; img.data[o + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    const X = (x) => (x - x0) * k, Z = (z) => (z - z0) * k;
    const rect = (x, z, rot, w, d, col) => { g.save(); g.translate(X(x), Z(z)); g.rotate(rot); g.fillStyle = col; g.fillRect((-w / 2) * k, (-d / 2) * k, Math.max(0.6, w * k), Math.max(0.6, d * k)); g.restore(); };
    for (const h of this.engine.registry.city?.plan?.houses || []) rect(h.x, h.z, -h.rot, h.w, h.d, h.village !== undefined ? '#c22' : '#666');
    const P = this.plan?.plots || [];
    for (let o = 0; o < P.length; o += PLOT) rect(P[o], P[o + 1], P[o + 3], P[o + 4], P[o + 5], ['#8fb3d9', '#4fb0b0', '#8a8a30'][P[o + 6]]);
    const T = this.plan?.tea || [];
    g.strokeStyle = '#1d7a2a'; g.lineWidth = Math.max(0.6, 0.9 * k); g.beginPath();
    for (let o = 0; o < T.length; o += TEA) { g.moveTo(X(T[o]), Z(T[o + 1])); g.lineTo(X(T[o + 2]), Z(T[o + 3])); }
    g.stroke();
    for (const h of this.engine.registry.hamlets || []) {
      for (const c of h.cottages) rect(c.x, c.z, -c.rot, c.w, c.d, '#e44');
      if (h.floor) rect(h.floor.x, h.floor.z, h.floor.rot, h.floor.w, h.floor.d, '#d9a');
    }
    return cv.toDataURL('image/png');
  }

  /** test hook: instances drawn per set */
  drawn() { return { ...Object.fromEntries((this.sets || []).map((s) => [s.name, s.mesh.count])), teaTiles: this.teaRows?.meshes.size, teaTris: this.teaRows?.tris() }; }

  setVisible(on) { this.visible = on; if (this.ready) this.group.visible = on; if (this.hamlets) this.hamlets.group.visible = on; this._plants(!on); }

  /** the hamlets' snow (their straw and thatch white on top in winter) */
  _season(season) {
    const snow = season === 'winter' ? 1 : 0, M = this.hamlets?.mats;
    if (!M) return;
    for (const k of ['thatch', 'straw', 'tile', 'floor', 'stone']) M[k].userData.farm.uSnow.value = snow;
  }

  applySeason(season = 'spring') {
    if (!this.ready && !this.mats) return;
    const L = LOOK[season] || LOOK.spring, M = this.mats;
    this.season = season;
    if (L.wet) {
      this.plots.material = M.wet;
      M.wet.userData.farm.uCol.value.setRGB(...L.water); M.wet.userData.farm.uCol2.value.setRGB(...L.rice); M.wet.userData.farm.uRows.value.set(...L.rows);
    } else {
      this.plots.material = M.dry;
      M.dry.userData.farm.uCol.value.setRGB(...L.dry); M.dry.userData.farm.uCol2.value.setRGB(...L.stub); M.dry.userData.farm.uRows.value.set(...L.rows);
    }
    M.rim.userData.farm.uCol.value.setRGB(...L.rim);
    M.mulGround.userData.farm.uCol.value.setRGB(...(L.snow ? [0.82, 0.83, 0.86] : L.till));
    M.crown.userData.farm.uCol.value.setRGB(...L.mul);
    for (const k of ['rim', 'tea', 'drape', 'crown', 'bark', 'mulGround']) M[k].userData.farm.uSnow.value = L.snow * (k === 'bark' ? 0.4 : 1);
    const crowns = this.sets?.find((s) => s.name === 'mulberry-crowns');
    if (crowns) crowns.mesh.visible = L.mulOn;
  }
}

// ------------------------------------------------------------------ tea rows near the walker
/** a smooth 1-D value noise in 0..1 (hash01 at the integers, smoothstepped between) */
function noise1(t, seed) {
  const i = Math.floor(t), f = t - i, u = f * f * (3 - 2 * f);
  return hash01(i, seed, 63) * (1 - u) + hash01(i + 1, seed, 63) * u;
}
const TEA_TILE = 200, TEA_STEP = 1.6;
// the hedge's cross-section: half width, height (a clipped, flat-domed bush; its foot sunk below the slope)
const TEA_PROF = [[0.5, -0.4], [0.5, 0.25], [0.44, 0.56], [0.3, 0.76], [0.1, 0.84], [-0.1, 0.84], [-0.3, 0.76], [-0.44, 0.56], [-0.5, 0.25], [-0.5, -0.4]];

/**
 * The near tea: each row one continuous clipped hedge swept along its contour (the plan's pieces, src/explore/farm.js
 * teaPlan, chained end to end: neighbouring cells compute their shared crossing from the same corner heights, so the
 * points match exactly), its width and height varying a little from bush to bush, rounded at the row's ends. One mesh per
 * TEA_TILE tile, built when the walker comes within TEA_R (one tile a frame), dropped beyond 1.6 TEA_R.
 */
class TeaRows {
  constructor(group, mat, R) {
    this.group = group; this.mat = mat; this.R = R;
    this.byTile = new Map();
    for (let o = 0; o < R.length; o += TEA) {
      const i = Math.floor((R[o] + R[o + 2]) / 2 / TEA_TILE), j = Math.floor((R[o + 1] + R[o + 3]) / 2 / TEA_TILE), key = i * 100003 + j;
      let t = this.byTile.get(key);
      if (!t) this.byTile.set(key, (t = { i, j, list: [] }));
      t.list.push(o);
    }
    this.meshes = new Map();
    this.queue = [];
  }
  tris() { let n = 0; for (const m of this.meshes.values()) n += m.geometry.index.count / 3; return n; }
  /** the tiles round pos: queue the missing ones (nearest first), drop the far ones */
  want(pos) {
    const r = TEA_R, out = [];
    for (let i = Math.floor((pos.x - r) / TEA_TILE); i <= Math.floor((pos.x + r) / TEA_TILE); i++) for (let j = Math.floor((pos.z - r) / TEA_TILE); j <= Math.floor((pos.z + r) / TEA_TILE); j++) {
      const key = i * 100003 + j;
      if (!this.byTile.has(key) || this.meshes.has(key)) continue;
      const nx = Math.max(i * TEA_TILE, Math.min(pos.x, (i + 1) * TEA_TILE)), nz = Math.max(j * TEA_TILE, Math.min(pos.z, (j + 1) * TEA_TILE));
      const d = Math.hypot(nx - pos.x, nz - pos.z);
      if (d <= r) out.push([d, key]);
    }
    this.queue = out.sort((a, b) => a[0] - b[0]).map((q) => q[1]);
    for (const [key, m] of this.meshes) {
      const { i, j } = this.byTile.get(key);
      const cx = (i + 0.5) * TEA_TILE, cz = (j + 0.5) * TEA_TILE;
      if (Math.hypot(cx - pos.x, cz - pos.z) > TEA_R * 1.6 + TEA_TILE) { this.group.remove(m); m.geometry.dispose(); this.meshes.delete(key); }
    }
  }
  step() {
    const key = this.queue.shift();
    if (key === undefined) return false;
    // the mesh's origin at the tile's centre, below its lowest row: the ink painter shades a crown in its own frame
    // (clumps of foliage round the origin, src/ink/painter.js), and a row is no tree's dark underside
    const { i, j, list } = this.byTile.get(key);
    let ymin = Infinity;
    for (const o of list) ymin = Math.min(ymin, this.R[o + 4]);
    const org = new THREE.Vector3((i + 0.5) * TEA_TILE, ymin - 9, (j + 0.5) * TEA_TILE);
    const m = new THREE.Mesh(this._geometry(list, org), this.mat);
    m.position.copy(org);
    m.name = 'countryside:tea-rows'; m.receiveShadow = true; m.castShadow = false;
    m.userData.__inkSeen = true;
    this.group.add(m);
    this.meshes.set(key, m);
    return true;
  }
  _geometry(list, org) {
    const R = this.R, N = list.length, used = new Uint8Array(N), A = new Array(N), B = new Array(N), ends = new Map();
    const pk = (x, z) => Math.round(x * 512) + ',' + Math.round(z * 512);
    for (let n = 0; n < N; n++) {
      const o = list[n];
      A[n] = pk(R[o], R[o + 1]); B[n] = pk(R[o + 2], R[o + 3]);
      for (const k of [A[n], B[n]]) { const e = ends.get(k); if (e) e.push(n); else ends.set(k, [n]); }
    }
    const nextAt = (n, k) => { for (const m of ends.get(k)) if (m !== n && !used[m]) return m; return -1; };
    // from piece n across its end k: the chain's points beyond it
    const walk = (n, k, out) => {
      for (let cur = n; ;) {
        const m = nextAt(cur, k);
        if (m < 0) return;
        used[m] = 1;
        const o = list[m], fromA = A[m] === k;
        out.push(fromA ? [R[o + 2], R[o + 3]] : [R[o], R[o + 1]]);
        k = fromA ? B[m] : A[m];
        cur = m;
      }
    };
    const pos = [], idx = [];
    for (let n0 = 0; n0 < N; n0++) {
      if (used[n0]) continue;
      used[n0] = 1;
      const o = list[n0], fwd = [], back = [];
      walk(n0, B[n0], fwd);
      walk(n0, A[n0], back);
      this._sweep([...back.reverse(), [R[o], R[o + 1]], [R[o + 2], R[o + 3]], ...fwd], R[o + 4], R[o + 5], pos, idx, org);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    g.computeBoundingSphere();
    return g;
  }
  /** one hedge along pts (all at height y): resampled to ≤ TEA_STEP m, tapered over the first and last 0.5 m */
  _sweep(pts, y, sc, pos, idx, org) {
    const P = [pts[0]];
    for (let i = 1; i < pts.length; i++) {
      const [ax, az] = pts[i - 1], [bx, bz] = pts[i], l = Math.hypot(bx - ax, bz - az), n = Math.ceil(l / TEA_STEP);
      for (let q = 1; q <= n; q++) P.push([ax + ((bx - ax) * q) / n, az + ((bz - az) * q) / n]);
    }
    let total = 0;
    const S = [0];
    for (let i = 1; i < P.length; i++) { total += Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]); S.push(total); }
    if (total < 0.6) return;
    const base = pos.length / 3, nP = TEA_PROF.length, seed = Math.round(pts[0][0] * 7 + pts[0][1] * 13) & 0xffff;
    for (let i = 0; i < P.length; i++) {
      const [x, z] = P[i];
      const [px, pz] = P[Math.max(0, i - 1)], [qx, qz] = P[Math.min(P.length - 1, i + 1)];
      let tx = qx - px, tz = qz - pz;
      const tl = Math.hypot(tx, tz) || 1; tx /= tl; tz /= tl;
      const end = Math.min(S[i], total - S[i]);
      const taper = end < 0.5 ? 0.35 + 0.65 * Math.sqrt(end / 0.5) : 1;
      // a clipped row (龙井's tea is kept as neat round-topped hedges): its height and width swell a little along it (a
      // smooth noise of the distance, ~2 m a bush)
      const nh = noise1(S[i] / 2.1, seed), nw = noise1(S[i] / 2.1 + 17.3, seed);
      const w = sc * (0.94 + 0.12 * nw) * taper, hh = sc * (0.9 + 0.2 * nh) * taper;
      for (const [u, v] of TEA_PROF) pos.push(x - tz * u * w * 1.1 - org.x, y + (v < 0 ? v : v * hh * 1.1) - org.y, z + tx * u * w * 1.1 - org.z);
    }
    for (let i = 0; i < P.length - 1; i++) for (let k = 0; k < nP - 1; k++) {
      const a = base + i * nP + k, b = a + nP;
      idx.push(a, a + 1, b + 1, a, b + 1, b);
    }
    // the ends closed (fans)
    const last = base + (P.length - 1) * nP;
    for (let k = 1; k < nP - 1; k++) { idx.push(base, base + k + 1, base + k); idx.push(last, last + k, last + k + 1); }
  }
}

/** a world matrix (column-major) for a record: at (x, y, z), turned so local +x runs along (cos r, sin r) in xz, scaled */
function compose(a, o, x, y, z, r, sx, sy, sz) {
  const c = Math.cos(r), s = Math.sin(r);
  a[o] = c * sx; a[o + 1] = 0; a[o + 2] = s * sx; a[o + 3] = 0;
  a[o + 4] = 0; a[o + 5] = sy; a[o + 6] = 0; a[o + 7] = 0;
  a[o + 8] = -s * sz; a[o + 9] = 0; a[o + 10] = c * sz; a[o + 11] = 0;
  a[o + 12] = x; a[o + 13] = y; a[o + 14] = z; a[o + 15] = 1;
}
