// Streamed terrain for the explorable world (?mode=explore): one camera-centred quadtree of square patches
// (src/terrain/mesh.js planLeaves / meshLeaf), re-planned as the camera moves and meshed in workers
// (src/explore/heightpool.js). The cell size follows the distance from the camera in every direction (turning never
// needs new patches); patches are cached (LRU) so walking back and forth costs nothing.
//
// Swapping is atomic: the patches on screen stay until every patch of the next plan is ready, then the set flips in
// one frame (no holes while meshing). A new plan starts only when the previous one is complete.
import * as THREE from 'three';
import { planLeaves } from '../terrain/mesh.js';
import { getHeightPool } from './heightpool.js';

const key = (lf, N) => `${lf.x0},${lf.z0},${lf.size}` + (N ? '/' + N : '');

export class StreamTerrain {
  /**
   * @param {object} o
   * @param {THREE.Material} o.material  terrain material (src/terrain/material.js)
   * @param {number} o.theta   angular cell size (rad)
   * @param {number} o.minCell smallest cell (m)
   * @param {number} o.N       cells per patch side
   */
  constructor({ material, theta = 0.01, minCell = 1.0, N = 64, cacheSize = 1400 }) {
    this.material = material;
    this.theta = theta; this.minCell = minCell; this.N = N;
    this.cacheSize = cacheSize;
    this.root = new THREE.Group();
    this.root.name = 'terrain';
    this.cache = new Map();      // key → { lf, mesh, used }
    this.pending = new Map();    // key → Promise
    this.shown = new Set();      // keys on screen
    this.plan = null;            // { keys, leaves, at }
    this.pool = getHeightPool();
    this.frame = 0;
    this.stats = { leaves: 0, tris: 0, swaps: 0, meshed: 0, lastSwapMs: 0 };
    this.onSwap = null;
  }

  _plan(pos) {
    const c = [{ pos: [pos.x, pos.y, pos.z], target: [pos.x + 1, pos.y, pos.z], fov: 60 }];
    return planLeaves(c, { theta: this.theta, outside: 1, minCell: this.minCell, N: this.N });
  }

  _request(lf, N = 0) {
    const k = key(lf, N);
    if (this.cache.has(k) || this.pending.has(k)) return this.pending.get(k);
    const p = this.pool.leaf(lf, N || this.N).then((m) => {
      this.pending.delete(k);
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(m.position, 3));
      g.setAttribute('normal', new THREE.BufferAttribute(m.normal, 3));
      g.setIndex(new THREE.BufferAttribute(m.index, 1));
      g.computeBoundingBox(); g.computeBoundingSphere();
      const mesh = new THREE.Mesh(g, this.material);
      mesh.name = 'terrain:' + k;
      mesh.castShadow = true; mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false; mesh.updateMatrix();
      mesh.visible = false;
      this.root.add(mesh);
      this.cache.set(k, { lf, mesh, used: this.frame });
      this.stats.meshed++;
    }).catch(() => { this.pending.delete(k); });
    this.pending.set(k, p);
    return p;
  }

  /** plan for this camera position and wait until every patch is meshed, then show it (load time) */
  async init(pos) {
    const leaves = this._plan(pos);
    leaves.forEach((lf) => this._request(lf));
    await Promise.all([...this.pending.values()]);
    this.plan = { leaves, keys: new Set(leaves.map((lf) => key(lf))), at: pos.clone() };
    this._swap();
  }

  /** call every frame with the camera position; returns true when the visible set changed */
  update(pos) {
    this.frame++;
    if (this.held) return false;
    if (this.plan && !this.plan.done) {
      // waiting on the current plan: swap once all of its patches are meshed
      let ready = true;
      for (const k of this.plan.keys) if (!this.cache.has(k)) { ready = false; break; }
      if (ready) { this._swap(); return true; }
      return false;
    }
    // re-plan when the camera has moved a fraction of the smallest patch (or rose / sank a lot)
    const minLeaf = this.minCell * this.N;
    const at = this.plan?.at;
    if (at && Math.hypot(pos.x - at.x, pos.z - at.z) < minLeaf * 0.25 && Math.abs(pos.y - at.y) < Math.max(8, Math.abs(pos.y - 30) * 0.2)) return false;
    const leaves = this._plan(pos);
    const keys = new Set(leaves.map((lf) => key(lf)));
    let same = keys.size === this.shown.size;
    if (same) for (const k of keys) if (!this.shown.has(k)) { same = false; break; }
    if (same) { this.plan = { leaves, keys, at: pos.clone(), done: true }; return false; }
    // the nearest patches first
    leaves.sort((a, b) => (Math.hypot(a.x0 + a.size / 2 - pos.x, a.z0 + a.size / 2 - pos.z) - a.size) - (Math.hypot(b.x0 + b.size / 2 - pos.x, b.z0 + b.size / 2 - pos.z) - b.size));
    leaves.forEach((lf) => this._request(lf));
    this.plan = { leaves, keys, at: pos.clone(), t0: performance.now() };
    return false;
  }

  _swap() {
    const P = this.plan;
    for (const k of this.shown) if (!P.keys.has(k)) { const c = this.cache.get(k); if (c) c.mesh.visible = false; }
    let tris = 0;
    for (const k of P.keys) {
      const c = this.cache.get(k);
      if (!c) continue;
      c.mesh.visible = true; c.used = this.frame;
      tris += c.mesh.geometry.index.count / 3;
    }
    this.shown = new Set(P.keys);
    P.done = true;
    this.stats.leaves = P.keys.size; this.stats.tris = tris; this.stats.swaps++;
    if (P.t0) this.stats.lastSwapMs = Math.round(performance.now() - P.t0);
    this._evict();
    this.onSwap?.();
  }

  /**
   * a still (src/explore/still.js): show exactly these leaves (meshed with N cells a side, as the stills' terrain is),
   * once all are meshed; the walking plan is held until resume(). Resolves false when resumed before it was ready.
   */
  async showSet(leaves, N) {
    this.held = true;
    const token = (this._setToken = (this._setToken || 0) + 1);
    const keys = leaves.map((lf) => key(lf, N));
    await Promise.all(leaves.map((lf) => this._request(lf, N)));
    if (this._setToken !== token || !this.held) return false;
    for (const k of this.shown) { const c = this.cache.get(k); if (c) c.mesh.visible = false; }
    for (const k of keys) { const c = this.cache.get(k); if (c) { c.mesh.visible = true; c.used = this.frame; } }
    this.stillShown = keys;
    return true;
  }

  /** back to the walking plan after showSet */
  resume() {
    this._setToken = (this._setToken || 0) + 1;
    this.held = false;
    if (this.stillShown) {
      for (const k of this.stillShown) { const c = this.cache.get(k); if (c) c.mesh.visible = false; }
      for (const k of this.shown) { const c = this.cache.get(k); if (c) c.mesh.visible = true; }
      this.stillShown = null;
    }
  }

  _evict() {
    if (this.cache.size <= this.cacheSize) return;
    const still = new Set(this.stillShown || []);
    const old = [...this.cache.entries()].filter(([k]) => !this.shown.has(k) && !still.has(k)).sort((a, b) => a[1].used - b[1].used);
    for (let i = 0; i < old.length && this.cache.size > this.cacheSize; i++) {
      const [k, c] = old[i];
      this.root.remove(c.mesh);
      c.mesh.geometry.dispose();
      this.cache.delete(k);
    }
  }
}
