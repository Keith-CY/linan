// The explorable world's lazily loaded bakes (src/core/cache.js lazyBake): the rock outcrops, the 太湖石 and the 飞来峰
// cliff are compact bakes (src/core/bakefmt.js) fetched and decoded in the height workers when they are needed, so the
// page starts on the few near the start instead of downloading every one.
//
//   walking level ('live')  those within START_R m of the start before the first frame; the rest in the background
//                           once the walker is within NEAR_R m of them, nearest first, two at a time
//   still level ('still')   the stills' full detail: before a still view paints, every one whose bounds (with the
//                           shadows' reach) meet its view (the still waits for them); in the background those within
//                           STILL_R m of the walker, after the walking level
// A filled geometry is uploaded and its CPU copy dropped (src/core/compact.js).
//
//   const L = new LazyBakes(engine)   after the build (engine.registry.lazyBakes: { lazy, mesh, level })
//   await L.atStart(cameraPosition)   L.tick(cameraPosition) every frame   await L.forStill(camera)
import * as THREE from 'three';
import { releaseOnUpload, uploadNow } from '../core/compact.js';

const START_R = 2500, NEAR_R = 3000, STILL_R = 1200, SHADOW_REACH = 250, PARALLEL = 2;

export class LazyBakes {
  constructor(engine) {
    this.engine = engine;
    this.items = (engine.registry.lazyBakes || []).map((it) => ({ ...it, sphere: null, p: null }));
    this.busy = 0;
    this.loaded = 0; this.bytes = 0;
    this.changed = false;
    const keep = engine.params.get('keepArrays') === '1';
    for (const it of this.items) {
      const prev = it.lazy.onReady;
      it.lazy.onReady = (geo) => {
        prev?.(geo);
        if (!keep && !geo.userData.released) { releaseOnUpload({ traverse: (f) => f({ geometry: geo }) }); uploadNow(engine, [], [geo]); }
        this.loaded++; this.bytes += it.lazy.bytes || 0; this.changed = true;
      };
    }
  }

  get stats() { return { items: this.items.length, loaded: this.items.filter((it) => it.lazy.ready).length, MB: +(this.bytes / 1048576).toFixed(1) }; }

  _sphere(it) {
    if (!it.sphere) { it.mesh.updateWorldMatrix(true, false); it.sphere = it.lazy.geo.boundingSphere.clone().applyMatrix4(it.mesh.matrixWorld); }
    return it.sphere;
  }
  _dist(it, p) { const s = this._sphere(it); return Math.max(0, s.center.distanceTo(p) - s.radius); }
  _load(it) {
    if (it.p) return it.p;
    this.busy++;
    it.p = it.lazy.load().catch((e) => console.error('[explore] bake failed', it.lazy.name, e)).finally(() => { this.busy--; });
    return it.p;
  }

  /** the walking level of every bake within START_R m (before the first frame) */
  async atStart(pos) {
    const t0 = performance.now();
    const near = this.items.filter((it) => it.level === 'live' && this._dist(it, pos) < START_R);
    await Promise.all(near.map((it) => this._load(it)));
    if (this.items.length) console.log(`[explore] bakes: ${near.length} of ${this.items.length} loaded at the start (${this.stats.MB} MB) in ${Math.round(performance.now() - t0)} ms; the rest as the walker comes near`);
  }

  /** every frame: start the next background load (the walking level near by, nearest first; then the still level) */
  tick(pos) {
    if (this.busy >= PARALLEL) return;
    let best = null, bd = Infinity;
    for (const it of this.items) {
      if (it.p) continue;
      const d = this._dist(it, pos);
      const k = it.level === 'live' ? (d < NEAR_R ? d : Infinity) : d < STILL_R ? 1e6 + d : Infinity;
      if (k < bd) { bd = k; best = it; }
    }
    if (best && bd < Infinity) this._load(best);
  }

  /** a still view at this camera: every bake its view (and its shadows) can reach, loaded */
  forStill(camera) {
    const cam = camera.clone();
    cam.fov = Math.min(170, camera.fov * 1.12); cam.far = 60000;
    cam.updateProjectionMatrix(); cam.updateMatrixWorld(true);
    const F = new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse));
    const s = new THREE.Sphere();
    const need = this.items.filter((it) => { s.copy(this._sphere(it)); s.radius += SHADOW_REACH; return F.intersectsSphere(s); });
    const todo = need.filter((it) => !it.lazy.ready);
    return todo.length ? Promise.all(todo.map((it) => this._load(it))).then(() => todo.length) : null;
  }
}
