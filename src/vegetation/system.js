// Instance manager (derived from Athenaion's src/vegetation/instances.js, MIT): every plant variant has up to
// 4 LOD geometries, each split into parts (bark / inner / blob / card / ribbon / flower / bb), one material each.
// Instances are re-bucketed into LODs from the CURRENT camera (projected height in pixels) and culled per
// instance against the view frustum extended toward the sun (so off-screen trees still cast their shadows
// into view). Re-bucketing runs on every shot change and whenever the camera moved; it costs a few ms.
import * as THREE from 'three';
import { ATMO } from '../core/atmosphere.js';
import { depthFor } from './materials.js';

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _p = new THREE.Vector3();
const _Y = new THREE.Vector3(0, 1, 0), _up = new THREE.Vector3(), _qt = new THREE.Quaternion();
const _pm = new THREE.Matrix4();
const MAX_TRIS = 400000;
const FAR_SECTORS = 8;
const PAGE0 = 128;     // first capacity of a bucket page (it doubles as it fills, up to its LOD's page size)
// the explorable world's far impostors: plants beyond FAR_NEAR m of an anchor, refilled when the camera has travelled
// FAR_MOVE m from it (in slices over several frames, src/explore calls step() every frame), at once after a teleport
// (farInvalidate) or a jump of FAR_JUMP m
const FAR_NEAR = 750, FAR_MOVE = 90, FAR_JUMP = 3000;
const OCC_BUDGET = 1500;   // terrain-occlusion tests per re-bucket while walking (_occCached)
const instAttr = (n, k) => { const a = new THREE.InstancedBufferAttribute(new Float32Array(n * k), k); a.setUsage(THREE.DynamicDrawUsage); return a; };
const PARTS = ['bark', 'inner', 'blob', 'card', 'ribbon', 'flower', 'bb'];
const partsOf = (lod) => [...PARTS.filter((p) => lod[p]), ...Object.keys(lod).filter((k) => !PARTS.includes(k) && k !== 'tris' && lod[k]?.isBufferGeometry)];
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
/** render layer of the shadow-only proxies (enabled on the CSM shadow cameras, never on the main camera) */
export const SHADOW_LAYER = 7;

/** instances grouped into 160 m cells: { x, y, z, r (bounding sphere incl. crowns), idx: Int32Array } */
function buildCells(ctr, n, size = 160) {
  const map = new Map();
  for (let i = 0; i < n; i++) {
    const k = Math.floor(ctr[i * 4] / size) * 100003 + Math.floor(ctr[i * 4 + 2] / size);
    let a = map.get(k); if (!a) map.set(k, (a = [])); a.push(i);
  }
  const cells = [];
  for (const a of map.values()) {
    let x = 0, y = 0, z = 0;
    for (const i of a) { x += ctr[i * 4]; y += ctr[i * 4 + 1]; z += ctr[i * 4 + 2]; }
    x /= a.length; y /= a.length; z /= a.length;
    let r = 0;
    for (const i of a) r = Math.max(r, Math.hypot(ctr[i * 4] - x, ctr[i * 4 + 1] - y, ctr[i * 4 + 2] - z) + ctr[i * 4 + 3] * 0.8 + 1);
    cells.push({ x, y, z, r, idx: Int32Array.from(a) });
  }
  return cells;
}

export class VegSystem {
  constructor(engine) {
    this.engine = engine;
    this.group = new THREE.Group();
    this.group.name = 'vegetation';
    this.variants = [];
    this.lastCam = null;
    this.stats = { instances: 0 };
    this.detail = engine.quality.detail ?? 1;
  }

  /**
   * def: { name, lods:[{bark, blob, card, ...geometries, tris}], materials:{part: material}, H (nominal height m),
   *        px: [lod0, lod1, lod2] pixel-height thresholds, cullPx, shadowLod (max LOD casting shadows), group }
   */
  addVariant(def) {
    const v = { ...def, inst: [], meshes: [] };
    this.variants.push(v);
    return v;
  }

  /**
   * add an instance: position, yaw (rad, about the plant's own axis), scale (uniform), opts:
   *   width (crown width multiplier), hs (height multiplier), tint [r,g,b],
   *   up [x,y,z] (world growth direction; default +Y)
   */
  add(v, x, y, z, yaw, scale, opts = {}) {
    v.inst.push({ x, y, z, yaw, s: scale, w: opts.width || 1, hs: opts.hs || 1, up: opts.up || null, tint: opts.tint || [1, 1, 1], h: v.H * scale * (opts.hs || 1) });
  }

  finalize() {
    for (const v of this.variants) {
      // after this the instances live in the typed arrays below (v.n of them); the per-plant objects are let go
      const n = (v.n = v.inst.length);
      if (!n) { v.inst = []; continue; }
      v.mat = new Float32Array(n * 16);
      v.col = new Float32Array(n * 3);
      v.ctr = new Float32Array(n * 4);
      v.lastLod = new Int8Array(n).fill(-1);
      if (v.inst.some((it) => it.ex)) v.exMask = Uint8Array.from(v.inst, (it) => (it.ex ? 1 : 0));
      for (let i = 0; i < n; i++) {
        const it = v.inst[i];
        _q.setFromAxisAngle(_Y, it.yaw);
        if (it.up) { _up.set(it.up[0], it.up[1], it.up[2]).normalize(); _qt.setFromUnitVectors(_Y, _up); _q.premultiply(_qt); }
        _s.set(it.s * it.w, it.s * it.hs, it.s * it.w);
        _p.set(it.x, it.y, it.z);
        _m.compose(_p, _q, _s);
        _m.toArray(v.mat, i * 16);
        v.col.set(it.tint, i * 3);
        v.ctr[i * 4] = it.x; v.ctr[i * 4 + 1] = it.y + it.h * (v.ctrK ?? 0.5); v.ctr[i * 4 + 2] = it.z; v.ctr[i * 4 + 3] = it.h;
      }
      v.inst = [];
      v.cells = buildCells(v.ctr, n);
      v.lodMeshes = v.lods.map((lod, l) => ({ l, lod, pages: [], page: clamp(Math.floor(MAX_TRIS / Math.max(1, lod.tris || 1)), 16, 8192) }));
      // LOD1 beyond the shadow distance: same geometry, pages that cast no shadow (far cascades are too coarse to show them)
      if (v.lods[1]) { v.farL1 = v.lodMeshes.length; v.lodMeshes.push({ l: 1, lod: v.lods[1], pages: [], page: v.lodMeshes[1].page, noShadow: true }); }
      // the explorable world: plants beyond FAR_NEAR m live in their own impostor pages, filled all round the camera and
      // refreshed only when the camera has travelled FAR_MOVE m (a full re-bucket of 130 k plants is ~30 ms)
      // eight sectors of azimuth round the anchor, shown only when they face the camera (farVisibility)
      // two sets of them: the one drawn (farL3) and the one being refilled (farL3b), swapped when the refill is done
      if (this.engine.explore) {
        const ll = v.lods.length - 1;
        v.farL3 = []; v.farL3b = [];
        for (const set of [v.farL3, v.farL3b]) for (let sct = 0; sct < FAR_SECTORS; sct++) { set.push(v.lodMeshes.length); v.lodMeshes.push({ l: ll, lod: v.lods[ll], pages: [], page: v.lodMeshes[ll].page, noShadow: true, far: true, sector: sct }); }
      }
      this.stats.instances += n;
    }
    for (const v of this.variants) for (const k in v.materials) {
      const m = v.materials[k];
      this.engine.patchMaterial?.(m);
      this.engine.patchMaterial?.(depthFor(m));
    }
    // the vegetation shadow casters render into all cascades but the farthest (1-2.4 km: tree shadows are sub-texel)
    const lights = this.engine.lighting?.csm?.lights || [];
    lights.forEach((l, i) => { if (i < Math.max(1, lights.length - 1)) l.shadow.camera.layers.enable(SHADOW_LAYER); });
    // sentinel: re-bucket when the camera moves (onBeforeRender of the main pass)
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, 0, 0, 0, 0], 3));
    const sentinel = new THREE.Mesh(sg, new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false }));
    sentinel.frustumCulled = false; sentinel.castShadow = false; sentinel.receiveShadow = false;
    sentinel.userData.castShadow = false; sentinel.userData.noPatch = true;
    sentinel.onBeforeRender = (renderer, scene, camera) => { if (camera === this.engine.camera) { this.onFrame?.(); this.maybeUpdate(camera); } };
    this.group.add(sentinel);
  }

  /** the page of slot k of a LOD's buckets: pages hold up to L.page instances each but start small and double as
   *  they fill (a page sized for its whole capacity up front held ~4 slots for every plant drawn) */
  _pageFor(v, L, pi, s) {
    const pg = L.pages[pi] || this._newPage(v, L, Math.min(L.page, PAGE0));
    if (s >= pg.cap) {
      let cap = pg.cap;
      while (cap <= s) cap *= 2;
      cap = Math.min(cap, L.page);
      const im = instAttr(cap, 16), ic = instAttr(cap, 3);
      im.array.set(pg.im.array); ic.array.set(pg.ic.array);
      // the old buffers off the GPU (three.js drops an instanced mesh's instance buffers on its dispose event)
      for (const m of pg.parts) m.dispose();
      for (const m of pg.parts) { m.instanceMatrix = im; m.instanceColor = ic; }
      pg.im = im; pg.ic = ic; pg.cap = cap;
    }
    return pg;
  }

  _newPage(v, L, cap = L.page) {
    const im = instAttr(cap, 16), ic = instAttr(cap, 3);
    const parts = [];
    const P = this.engine.params;
    for (const part of partsOf(L.lod)) {
      const geo = L.lod[part];
      if (!geo) continue;
      const mat = v.materials[part];
      if (!mat) continue;
      if (P?.get?.('vegNoCards') && part === 'card') continue;
      const mesh = new THREE.InstancedMesh(geo, mat, 0);
      mesh.instanceMatrix = im;
      mesh.instanceColor = ic;
      mesh.count = 0;
      mesh.visible = false;
      mesh.frustumCulled = false;
      mesh.name = `veg:${v.name}:L${L.l}:${part}:p${L.pages.length}`;
      // main-pass meshes never cast: every caster is a proxy on SHADOW_LAYER (below)
      mesh.castShadow = false; mesh.receiveShadow = true;
      mesh.userData.castShadow = false; mesh.userData.receiveShadow = true;
      this.group.add(mesh);
      parts.push(mesh);
    }
    // shadow casters, seen by the near shadow cascades only (finalize enables SHADOW_LAYER on them). LOD0 casts through
    // the LOD1 geometry (a fraction of the triangles); LOD1 through its bark, bodies and strands; leaf cards only from
    // LOD0's proxy; never petals or impostors; far LOD1 pages and LOD2+ not at all.
    const castLod = Math.min(v.shadowLod ?? 1, 1);
    if (!L.noShadow && L.l <= castLod && !P?.get?.('vegNoShadow')) {
      const src = L.l === 0 && v.lods[1] ? v.lods[1] : L.lod;
      const castParts = L.l === 0 ? ['bark', 'blob', 'inner', 'card', 'ribbon', 'leaf', 'stalk', 'petal'] : ['bark', 'blob', 'inner', 'ribbon', 'leaf'];
      for (const part of castParts) {
        const geo = src[part], mat = v.materials[part];
        if (!geo || !mat || part === 'petal' || part === 'flower') continue;
        const proxy = new THREE.InstancedMesh(geo, mat, 0);
        proxy.instanceMatrix = im; proxy.instanceColor = ic;
        proxy.count = 0; proxy.visible = false; proxy.frustumCulled = false;
        proxy.layers.set(SHADOW_LAYER);
        proxy.castShadow = true; proxy.receiveShadow = false;
        proxy.userData.castShadow = true; proxy.userData.receiveShadow = false;
        proxy.customDepthMaterial = depthFor(mat);
        proxy.name = `veg:${v.name}:L${L.l}:shadow-${part}:p${L.pages.length}`;
        this.group.add(proxy);
        parts.push(proxy);
      }
    }
    const pg = { im, ic, parts, cap };
    L.pages.push(pg);
    return pg;
  }

  /** forget LOD history (a camera cut): stills are then independent of previously rendered shots */
  resetHistory() { this.lastCam = null; for (const v of this.variants) if (v.lastLod) v.lastLod.fill(-1); }
  // (the explorable world's far impostors stay: they depend only on where they were filled, see _farCheck)

  maybeUpdate(camera = this.engine.camera) {
    const c = camera;
    const key = [c.position.x, c.position.y, c.position.z, c.quaternion.x, c.quaternion.y, c.quaternion.z, c.quaternion.w, c.fov];
    if (this.lastCam) {
      const dp = Math.hypot(key[0] - this.lastCam[0], key[1] - this.lastCam[1], key[2] - this.lastCam[2]);
      const dq = Math.abs(key[3] - this.lastCam[3]) + Math.abs(key[4] - this.lastCam[4]) + Math.abs(key[5] - this.lastCam[5]) + Math.abs(key[6] - this.lastCam[6]);
      // the explorable world culls against a wider frustum (src/explore), so small turns and steps keep the buckets
      const ex = this.engine.explore;
      // still mode (src/explore/still.js) re-buckets explicitly: the sentinel leaves it alone
      if (this.still) return false;
      if (dp < (ex ? 2.0 : 0.75) && dq < (ex ? 0.05 : 0.004) && key[7] === this.lastCam[7]) return false;
    }
    this.update(camera);
    return true;
  }

  /**
   * re-bucket every instance into LODs for this camera, under a triangle budget (URL param vegTris): when a
   * view would exceed it, the LOD distances shrink (≤ 3 retries).
   */
  update(camera = this.engine.camera) {
    this._token = (this._token || 0) + 1;     // a re-bucket in slices (updateSliced) still running gives up
    this._occBudget = OCC_BUDGET;
    this.occPending = false;                  // (set when tests were left for later: src/explore re-buckets again)
    const t0 = performance.now();
    const resK = clamp((this.engine.height || 928) / 928, 1, 2.4);
    // still mode: the stills' own (high quality) budget
    const qn = this.still ? 'high' : this.engine.quality.name;
    const budget = Number(this.engine.params?.get?.('vegTris')) || (qn === 'ultra' ? 11e6 : qn === 'high' ? 8.5e6 : qn === 'explore' ? 3e6 : 6e6) * resK;
    let k = 1, st = this._update(camera, 1, false);
    for (let i = 0; i < 3 && this.forceLod === undefined && st.budgetTris > budget; i++) {
      k = Math.max(0.35, k * Math.sqrt(budget / st.budgetTris) * 0.94);
      st = this._update(camera, k, true);
    }
    st.lodScale = +k.toFixed(3);
    st.updateMs = +(performance.now() - t0).toFixed(1);
    this.engine.stats.veg = { ...st };
    if (typeof window !== 'undefined') {
      // per-kind LOD counts and triangles (main pass)
      const by = {};
      for (const v of this.variants) {
        if (!v.lodMeshes) continue;
        const b = by[v.kind || v.name] ||= { n: [0, 0, 0, 0], kt: 0 };
        v.lodMeshes.forEach((L) => { b.n[L.l] += L.count || 0; b.kt += ((L.count || 0) * (L.lod.tris || 0)) / 1000; });
      }
      const kinds = Object.fromEntries(Object.entries(by).map(([k, b]) => [k, `${b.n.join('/')} ${Math.round(b.kt)}k`]));
      window.__STATS = { ...(window.__STATS || {}), veg: { plants: st.instances, drawn: st.drawn, mTris: +(st.tris / 1e6).toFixed(2), lodScale: st.lodScale, updateMs: st.updateMs, kinds } };
    }
    return st;
  }

  _update(camera, kScale, noHyst) {
    const g = this._bucket(camera, kScale, noHyst, null);
    let r = g.next();
    while (!r.done) r = g.next();
    return r.value;
  }

  /**
   * the same re-bucket in slices of about budgetMs, a frame apart (src/explore/still.js: a still's plants are all of
   * the world's in its frustum, a few hundred ms of work, while the page stays responsive). Resolves to the stats,
   * or null when update() ran meanwhile (it wins).
   */
  async updateSliced(camera = this.engine.camera, budgetMs = 6) {
    const token = (this._token = (this._token || 0) + 1);
    const J = { deadline: 0 };
    const pass = async (k, noHyst) => {
      const g = this._bucket(camera, k, noHyst, J);
      for (;;) {
        J.deadline = performance.now() + budgetMs;
        const r = g.next();
        if (r.done) return r.value;
        await new Promise((res) => requestAnimationFrame(() => res()));
        if (token !== this._token) return null;
      }
    };
    const resK = clamp((this.engine.height || 928) / 928, 1, 2.4);
    const qn = this.still ? 'high' : this.engine.quality.name;
    const budget = Number(this.engine.params?.get?.('vegTris')) || (qn === 'ultra' ? 11e6 : qn === 'high' ? 8.5e6 : qn === 'explore' ? 3e6 : 6e6) * resK;
    let k = 1, st = await pass(1, false);
    for (let i = 0; st && i < 3 && this.forceLod === undefined && st.budgetTris > budget; i++) {
      k = Math.max(0.35, k * Math.sqrt(budget / st.budgetTris) * 0.94);
      st = await pass(k, true);
    }
    if (!st) return null;
    st.lodScale = +k.toFixed(3);
    this.engine.stats.veg = { ...st };
    return st;
  }

  *_bucket(camera, kScale, noHyst, J) {
    // (its own frustum: a sliced re-bucket must not see another one's)
    const _frustum = new THREE.Frustum(), _sph = new THREE.Sphere();
    let nSlice = 0;
    const c = camera;
    c.updateMatrixWorld(true);
    this.lastCam = [c.position.x, c.position.y, c.position.z, c.quaternion.x, c.quaternion.y, c.quaternion.z, c.quaternion.w, c.fov];
    const cam2 = c.clone();
    // still mode (this.still, src/explore/still.js): the explorable world buckets its plants exactly like a still
    const exw = this.engine.explore && !this.still;
    const wide = exw ? 1.45 : 1.12;
    cam2.fov = Math.min(170, c.fov * wide);
    cam2.aspect = c.aspect * (exw ? 1.3 : 1.04);
    cam2.near = 0.05; cam2.far = 60000;
    cam2.updateProjectionMatrix();
    cam2.updateMatrixWorld(true);
    _pm.multiplyMatrices(cam2.projectionMatrix, cam2.matrixWorldInverse);
    _frustum.setFromProjectionMatrix(_pm);
    const focalPx = (this.engine.height * 0.5) / Math.tan((c.fov * Math.PI) / 360);
    const sun = ATMO.uSunDir.value;
    const sy = Math.max(0.12, sun.y);
    const cx = c.position.x, cy = c.position.y, cz = c.position.z;
    let drawn = 0, tris = 0, farTris = 0;
    const qn = this.still ? 'high' : this.engine.quality.name;
    const lodK = (qn === 'ultra' ? 1.35 : this.detail >= 1 ? 1 : 0.7) * kScale;
    const shadowDist = qn === 'preview' || qn === 'explore' ? 250 : 380;
    const ex = !!this.engine.explore && !this.still;
    // still mode at a viewpoint: the explorable world's own cover (marked v.exMask) stays out, as in the stills
    const noEx = !!this.still?.noCover;
    if (ex) this._farCheck(cx, cy, cz, focalPx, lodK / kScale);
    else if (this.engine.explore && this._sectorKey !== null) {
      // a still (src/explore/still.js) has no far impostors: hidden, kept for its end (farVisibility shows them again)
      for (const v of this.variants) if (v.farL3) for (const li of [...v.farL3, ...v.farL3b]) for (const pg of v.lodMeshes[li].pages) for (const m of pg.parts) m.visible = false;
      this._sectorKey = null;
    }
    const forced = this.engine.params?.get?.('vegLod');
    const force = this.forceLod !== undefined ? this.forceLod : forced !== null && forced !== undefined && forced !== '' ? Number(forced) : undefined;
    for (const v of this.variants) {
      if (!v.n) continue;
      const n = v.n;
      const counts = v.lodMeshes.map(() => 0);
      const px = v.px;
      const hidden = v.hidden?.();
      // spatial cells first: a cell wholly outside the (shadow-extended) frustum skips all of its plants
      const cells = hidden ? [] : ex ? v.nearCells : v.cells;
      for (let ci = 0; ci < cells.length; ci++) {
        const C = cells[ci];
        _sph.center.set(C.x, C.y, C.z); _sph.radius = C.r + (v.shadowLod >= 0 ? 230 : 0);
        if (!_frustum.intersectsSphere(_sph)) continue;
        const idx = C.idx;
      for (let ii = 0; ii < idx.length; ii++) {
        const i = idx[ii];
        if (J && (++nSlice & 511) === 0 && performance.now() > J.deadline) yield;
        if (noEx && v.exMask?.[i]) continue;
        const x = v.ctr[i * 4], y = v.ctr[i * 4 + 1], z = v.ctr[i * 4 + 2], h = v.ctr[i * 4 + 3];
        const r = h * (v.radK ?? 0.6) + 1.0;
        _sph.center.set(x, y, z); _sph.radius = r;
        let vis = _frustum.intersectsSphere(_sph);
        if (!vis && v.shadowLod >= 0) {
          const L = Math.min(220, (h * 0.6) / sy);
          _sph.center.set(x - sun.x * L * 0.5, y - sun.y * L * 0.5, z - sun.z * L * 0.5);
          _sph.radius = r + L * 0.5;
          vis = _frustum.intersectsSphere(_sph);
          if (vis && (x - cx) ** 2 + (y - cy) ** 2 + (z - cz) ** 2 > 1440000) vis = false;
        }
        if (!vis) continue;
        const ddx = x - cx, ddy = y - cy, ddz = z - cz;
        const d = Math.max(0.1, Math.sqrt(ddx * ddx + ddy * ddy + ddz * ddz) - h * 0.25);
        const p = (h * focalPx) / d * lodK;
        if (p < (v.cullPx ?? 0.6)) continue;
        const pk = p / Math.sqrt(kScale); // LOD0 coarsens more slowly than the far LODs under the budget
        let l = force !== undefined ? force : pk > px[0] ? 0 : p > px[1] ? 1 : p > px[2] ? 2 : 3;
        const prev = v.lastLod[i];
        if (prev >= 0 && prev !== l && force === undefined && !noHyst) {
          const th = px[Math.min(prev, l)];
          if (p > th * 0.88 && p < th * 1.12) l = prev;
        }
        // terrain occlusion for the expensive LODs: a few height samples along the ray to the crown top
        if (l <= 2 && this.occluded && (ex ? this._occCached(v, i, cx, cy, cz, x, y + h * 0.5, z) : this.occluded(cx, cy, cz, x, y + h * 0.5, z))) {
          if (l <= 1) l = 3; // hidden behind a ridge: the impostor is plenty (and usually hidden by depth)
        }
        v.lastLod[i] = l;
        let li = Math.min(l, v.lods.length - 1);
        if (li === 1 && v.farL1 !== undefined && d > shadowDist) li = v.farL1;
        const L = v.lodMeshes[li];
        const k = counts[li]++;
        const pi = Math.floor(k / L.page), s = k - pi * L.page;
        const pg = L.pages[pi] && s < L.pages[pi].cap ? L.pages[pi] : this._pageFor(v, L, pi, s);
        const dst = pg.im.array, src = v.mat, o = s * 16, q = i * 16;
        for (let t = 0; t < 16; t++) dst[o + t] = src[q + t];
        pg.ic.array[s * 3] = v.col[i * 3]; pg.ic.array[s * 3 + 1] = v.col[i * 3 + 1]; pg.ic.array[s * 3 + 2] = v.col[i * 3 + 2];
      }
      }
      for (let l = 0; l < v.lodMeshes.length; l++) {
        const L = v.lodMeshes[l];
        if (L.far) { if (ex) { drawn += L.count || 0; tris += (L.count || 0) * (L.lod.tris || 0); farTris += (L.count || 0) * (L.lod.tris || 0); } continue; }
        L.count = counts[l];
        for (let pi = 0; pi < L.pages.length; pi++) {
          const pg = L.pages[pi];
          const cnt = clamp(counts[l] - pi * L.page, 0, L.page);
          pg.cnt = cnt;
          for (const m of pg.parts) { m.count = cnt; m.visible = cnt > 0; }
          pg.im.clearUpdateRanges(); pg.ic.clearUpdateRanges();
          if (cnt) {
            pg.im.addUpdateRange(0, cnt * 16); pg.ic.addUpdateRange(0, cnt * 3);
            pg.im.needsUpdate = true; pg.ic.needsUpdate = true;
          }
        }
        drawn += counts[l];
        tris += counts[l] * (L.lod.tris || 0);
        if (L.far) farTris += counts[l] * (L.lod.tris || 0);
      }
    }
    this.stats.drawn = drawn;
    this.stats.tris = tris;
    // the explorable world's far impostor sectors (a few triangles each, all round the walker) stay out of the budget:
    // counted in, they forced every near tree down to its impostor
    this.stats.budgetTris = tris - farTris;
    return { ...this.stats };
  }

  /** explore: start a refill of the far impostors round (cx, cy, cz) when the camera has travelled FAR_MOVE m from
   *  the drawn set's anchor; refill at once when there is none or the camera jumped FAR_JUMP m */
  _farCheck(cx, cy, cz, focalPx, lodK) {
    const A = this.farAnchor;
    const d = A ? Math.hypot(cx - A.x, cz - A.z) : Infinity, dy = A ? Math.abs(cy - A.y) : Infinity;
    if (d > FAR_JUMP || dy > 300) {
      this._farCancel();
      const J = this._farJob(cx, cy, cz, focalPx, lodK);
      J.deadline = Infinity;
      while (!J.gen.next().done);
      this._farSwap(J);
    } else if (!this.farJob && (d > FAR_MOVE || dy > 60)) this.farJob = this._farJob(cx, cy, cz, focalPx, lodK);
  }

  /** explore: the camera jumps (a teleport): the far impostors are refilled at once on the next re-bucket */
  farInvalidate() { this._farCancel(); this.farAnchor = null; }

  _farJob(x, y, z, focalPx, lodK) {
    const J = { x, y, z, focalPx, lodK, near: [], far: [], counts: [], hidden: [], shown: [], dirty: new Set(), deadline: 0 };
    J.gen = this._farFill(J);
    return J;
  }

  _farCancel() {
    const J = this.farJob;
    if (!J) return;
    for (const pg of J.shown) for (const m of pg.parts) m.visible = false;
    this.farJob = null;
  }

  /**
   * explore: the far refill's next slice (call every frame; about budgetMs of work). Every plant beyond FAR_NEAR m of
   * the new anchor, in every direction, impostors only, culled by projected size, into the set that is not drawn; the
   * slices' instance data are uploaded as they are written (the pages shown for one frame with no instances), and
   * the two sets swap once all are in. Returns true on the frame the new set is drawn.
   */
  step(budgetMs = 3) {
    const J = this.farJob;
    if (!J || this.still) return false;
    for (const pg of J.shown) for (const m of pg.parts) m.visible = false;
    J.shown.length = 0;
    // (a camera already far past the anchor, flying: bigger slices so the refill keeps up)
    const c = this.engine.camera.position, A = this.farAnchor;
    const behind = A ? Math.hypot(c.x - A.x, c.z - A.z) : 0;
    J.deadline = performance.now() + budgetMs * (behind > 300 ? 2.5 : 1);
    const t0 = performance.now();
    if (!J.gen.next().done) { this._stepMax(performance.now() - t0, 'slice'); return false; }
    this.farJob = null;
    this._farSwap(J);
    const t1 = performance.now();
    // the near buckets for the new near cells
    this.lastCam = null;
    this.update(this.engine.camera);
    this._stepMax(t1 - t0, 'last slice + swap'); this._stepMax(performance.now() - t1, 'near after swap');
    return true;
  }

  _stepMax(ms, k) { const S = (this.stepStats ||= {}); if (!(S[k] >= ms)) S[k] = +ms.toFixed(1); }

  *_farFill(J) {
    const cx = J.x, cy = J.y, cz = J.z, focalPx = J.focalPx, lodK = J.lodK;
    let n = 0;
    for (let vi = 0; vi < this.variants.length; vi++) {
      const v = this.variants[vi];
      if (!v.n || !v.farL3) continue;
      const near = [], far = [];
      for (const C of v.cells) (Math.hypot(C.x - cx, C.z - cz) - C.r < FAR_NEAR ? near : far).push(C);
      J.near[vi] = near; J.far[vi] = far;
      const counts = (J.counts[vi] = new Int32Array(FAR_SECTORS));
      const hidden = (J.hidden[vi] = !!v.hidden?.());
      if (hidden) continue;
      const cull = v.cullPx ?? 0.6;
      for (const C of far) {
        const idx = C.idx;
        for (let ii = 0; ii < idx.length; ii++) {
          const i = idx[ii];
          const x = v.ctr[i * 4], y = v.ctr[i * 4 + 1], z = v.ctr[i * 4 + 2], h = v.ctr[i * 4 + 3];
          const ddx = x - cx, ddy = y - cy, ddz = z - cz;
          const d = Math.max(0.1, Math.sqrt(ddx * ddx + ddy * ddy + ddz * ddz) - h * 0.25);
          if ((h * focalPx) / d * lodK < cull) continue;
          let sct = Math.floor(((Math.atan2(ddx, ddz) + Math.PI) / (2 * Math.PI)) * FAR_SECTORS);
          if (sct >= FAR_SECTORS) sct = FAR_SECTORS - 1;
          const L = v.lodMeshes[v.farL3b[sct]];
          const k = counts[sct]++;
          const pi = Math.floor(k / L.page), s = k - pi * L.page;
          const pg = L.pages[pi] && s < L.pages[pi].cap ? L.pages[pi] : this._pageFor(v, L, pi, s);
          const dst = pg.im.array, src = v.mat, o = s * 16, q = i * 16;
          for (let t = 0; t < 16; t++) dst[o + t] = src[q + t];
          pg.ic.array[s * 3] = v.col[i * 3]; pg.ic.array[s * 3 + 1] = v.col[i * 3 + 1]; pg.ic.array[s * 3 + 2] = v.col[i * 3 + 2];
          if (!J.dirty.has(pg)) { J.dirty.add(pg); pg.lo = s; }
          pg.hi = s + 1;
          if ((++n & 1023) === 0 && performance.now() > J.deadline) { this._farFlush(J); yield; }
        }
      }
    }
    this._farFlush(J);
  }

  /** the far pages written in this slice: their new ranges to the GPU with the next frame (shown, drawing nothing) */
  _farFlush(J) {
    for (const pg of J.dirty) {
      pg.im.addUpdateRange(pg.lo * 16, (pg.hi - pg.lo) * 16); pg.ic.addUpdateRange(pg.lo * 3, (pg.hi - pg.lo) * 3);
      pg.im.needsUpdate = true; pg.ic.needsUpdate = true;
      for (const m of pg.parts) { m.count = 0; m.visible = true; }
      J.shown.push(pg);
    }
    J.dirty.clear();
  }

  /** the refilled far set drawn, the old one hidden (refilled next time) */
  _farSwap(J) {
    for (let vi = 0; vi < this.variants.length; vi++) {
      const v = this.variants[vi];
      if (!v.farL3 || !J.near[vi]) continue;
      v.nearCells = J.near[vi]; v.farCells = J.far[vi];
      const old = v.farL3;
      v.farL3 = v.farL3b; v.farL3b = old;
      for (const li of old) { const L = v.lodMeshes[li]; L.count = 0; for (const pg of L.pages) { pg.cnt = 0; for (const m of pg.parts) { m.count = 0; m.visible = false; } } }
      for (let sct = 0; sct < FAR_SECTORS; sct++) {
        const L = v.lodMeshes[v.farL3[sct]], c = J.hidden[vi] ? 0 : J.counts[vi][sct];
        L.count = c;
        for (let pi = 0; pi < L.pages.length; pi++) {
          const pg = L.pages[pi], cnt = clamp(c - pi * L.page, 0, L.page);
          pg.cnt = cnt;
          for (const m of pg.parts) { m.count = cnt; m.visible = false; }
        }
      }
    }
    for (const pg of J.shown) for (const m of pg.parts) m.visible = (m.count || 0) > 0;
    J.shown.length = 0;
    this.farAnchor = { x: J.x, y: J.y, z: J.z };
    this._sectorKey = null;
    if (this.engine.camera) this.farVisibility(this.engine.camera);
  }

  /**
   * explore: the terrain occlusion of one plant (7 height samples), re-tested once the camera is 25 m from where it was
   * last tested, at most OCC_BUDGET tests per re-bucket (every plant tested at once, as before, was a 20-70 ms frame in
   * the forests every 25 m); a plant not yet tested counts as visible, one waiting for its re-test keeps its last answer
   * (occPending: the explorable world re-buckets on the following frames until every test is in)
   */
  _occCached(v, i, cx, cy, cz, x, y, z) {
    if (!v.occV) { v.occV = new Uint8Array(v.n); v.occP = new Float32Array(v.n * 3); }
    const st = v.occV[i], P = v.occP;
    if (st) {
      const dx = cx - P[i * 3], dz = cz - P[i * 3 + 2];
      if (dx * dx + dz * dz < 625 && Math.abs(cy - P[i * 3 + 1]) < 10) return st === 2;
      if (this._occBudget <= 0) { this.occPending = true; return st === 2; }
    } else if (this._occBudget <= 0) { this.occPending = true; return false; }
    this._occBudget--;
    const occ = this.occluded(cx, cy, cz, x, y, z);
    v.occV[i] = occ ? 2 : 1; P[i * 3] = cx; P[i * 3 + 1] = cy; P[i * 3 + 2] = cz;
    return occ;
  }

  /** explore: show the far sectors that face the camera (cheap; call every frame) */
  farVisibility(camera) {
    if (!this.farAnchor) return;
    const e = camera.matrixWorld.elements;
    const fx = -e[8], fz = -e[10], fl = Math.hypot(fx, fz);
    const on = new Array(FAR_SECTORS).fill(true);
    if (fl > 0.25) {
      const yaw = Math.atan2(fx, fz);
      const half = Math.atan(Math.tan(((camera.fov * Math.PI) / 360)) * camera.aspect) + Math.PI / FAR_SECTORS + 0.2;
      for (let sct = 0; sct < FAR_SECTORS; sct++) {
        const a = -Math.PI + ((sct + 0.5) / FAR_SECTORS) * 2 * Math.PI;
        let d = Math.abs(a - yaw); if (d > Math.PI) d = 2 * Math.PI - d;
        on[sct] = d < half;
      }
    }
    const key = on.join('');
    if (key === this._sectorKey) return;
    this._sectorKey = key; this._sectorOn = on;
    for (const v of this.variants) {
      if (!v.farL3) continue;
      for (const li of v.farL3) {
        const L = v.lodMeshes[li];
        for (const pg of L.pages) for (const m of pg.parts) m.visible = (pg.cnt || 0) > 0 && on[L.sector];
      }
    }
  }

  lodHistogram() {
    return this.variants.filter((v) => v.lodMeshes).map((v) => `${v.name}:${v.lodMeshes.map((l) => l.count).join('/')}`).join(' ');
  }
}
