// Walking and flying through the world (src/explore/index.js drives it).
//
//   walk  eye height on the ground: the terrain (heightfield) or a bridge deck, whichever is higher. The lake, the
//         river and the canals stop the walker at the water's edge; bridges and the causeways are walkable. Buildings,
//         houses, pagodas, gates, rocks and the 飞来峰 cliff block (engine.footprints + pagoda bounds).
//   fly   a free camera that stays above the ground and the water.
// Input: WASD / arrows, mouse-look (pointer lock, or drag when it is unavailable), shift to run; touch: a stick on the
// left half of the screen, drag to look on the right half, two buttons up / down while flying.
import * as THREE from 'three';
import { heightAt } from '../world/heightfield.js';

const EYE = 1.6;
const BLOCK_TAGS = new Set(['building', 'house', 'gate', 'taihu', 'rock', 'karst', 'pagoda', 'wall']);
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);

export class Walker {
  constructor(engine) {
    this.engine = engine;
    this.cam = engine.camera;
    this.mode = 'walk';
    this.yaw = 0; this.pitch = 0;
    this.vel = new THREE.Vector3();
    this.keys = new Set();
    this.stick = { x: 0, y: 0 };      // touch stick (-1..1), y forward
    this.lift = 0;                    // touch up / down while flying
    this.run = false;
    this.speed = { walk: 5, run: 16, fly: 40, flyRun: 220 };
    this.decks = [];                  // bridges: { m (world→local), w, l, level, deckY }
    this.blockers = [];               // extra circles: { x, z, r }
    this.eyeY = null;
    this.changed = true;
  }

  /** collect bridge decks and pagoda bounds after the world is built */
  collect() {
    const R = this.engine.registry;
    const decks = [];
    for (const b of R.bridges || []) {
      if (!b.deckY || !b.group) continue;
      b.group.updateMatrixWorld(true);
      decks.push({ inv: b.group.matrixWorld.clone().invert(), hw: b.width / 2, hl: b.length / 2, base: 0, deckY: b.deckY });
    }
    for (const b of R.city?.streets?.bridges || []) {
      if (!b.deckY) continue;
      const rot = new THREE.Matrix4().makeRotationY(Math.PI - (b.axis * Math.PI) / 180);
      const m = new THREE.Matrix4().makeTranslation(b.x, 0, b.z).multiply(rot);
      decks.push({ inv: m.invert(), hw: b.width / 2, hl: b.length / 2, base: 0, deckY: b.deckY });
    }
    for (const d of decks) {
      // a world-space bounding circle for a quick reject
      const c = new THREE.Vector3(0, 0, 0).applyMatrix4(d.inv.clone().invert());
      d.cx = c.x; d.cz = c.z; d.r = Math.hypot(d.hw, d.hl) + 1;
    }
    this.decks = decks;
    const box = new THREE.Box3();
    for (const p of R.pagodas || []) {
      if (!p.group) continue;
      box.setFromObject(p.group);
      if (box.isEmpty()) continue;
      const r = Math.min(box.max.x - box.min.x, box.max.z - box.min.z) * 0.42;
      this.blockers.push({ x: (box.min.x + box.max.x) / 2, z: (box.min.z + box.max.z) / 2, r });
    }
    console.log(`[explore] walk surfaces: ${decks.length} bridge decks, ${this.blockers.length} pagodas`);
  }

  /** deck height at (x, z) or -Infinity; also reports whether the point is on a deck but outside its rails */
  deckAt(x, z) {
    let best = -Infinity;
    const v = new THREE.Vector3();
    for (const d of this.decks) {
      if (Math.abs(x - d.cx) > d.r || Math.abs(z - d.cz) > d.r) continue;
      v.set(x, 0, z).applyMatrix4(d.inv);
      if (Math.abs(v.z) > d.hl || Math.abs(v.x) > d.hw - 0.45) continue;
      best = Math.max(best, d.deckY(v.z) + d.base);
    }
    return best;
  }

  groundAt(x, z) { return Math.max(heightAt(x, z), this.deckAt(x, z)); }

  /** can a walker stand at (x, z)? (dry ground or a deck, nothing built there) */
  free(x, z, fromG) {
    const t = heightAt(x, z), d = this.deckAt(x, z);
    const g = Math.max(t, d);
    if (d === -Infinity && t < 0.3) return false;                 // water (lake, river, canals): stop at the edge
    if (fromG !== undefined && g - fromG > 1.2) return false;      // a wall of rock or a terrace face
    const fp = this.engine.footprints;
    if (d === -Infinity && fp) for (const it of fp.query(x, z, 0.35)) if (BLOCK_TAGS.has(it.tag)) return false;
    for (const b of this.blockers) if (Math.hypot(x - b.x, z - b.z) < b.r) return false;
    return true;
  }

  setPose(pos, yaw, pitch) {
    this.cam.position.copy(pos);
    this.yaw = yaw; this.pitch = pitch;
    this.eyeY = null;
    this._apply();
  }
  /** yaw / pitch from where the camera looks */
  fromCamera() {
    const d = new THREE.Vector3(); this.cam.getWorldDirection(d);
    this.yaw = Math.atan2(-d.x, -d.z); this.pitch = Math.asin(clamp(d.y, -1, 1));
  }
  look(dx, dy) {
    this.unpin();
    this.yaw -= dx; this.pitch = clamp(this.pitch - dy, -1.45, 1.45);
    this.changed = true;
  }
  _apply() {
    const c = this.cam;
    c.rotation.order = 'YXZ';
    c.rotation.set(this.pitch, this.yaw, 0);
    c.updateMatrixWorld(true);
    this.changed = true;
  }

  /** a pinned pose (a teleport to a viewpoint) is held exactly, off the ground rules, until the walker moves or looks */
  unpin() {
    if (!this.pinned) return;
    this.pinned = false;
    const p = this.cam.position;
    this.eyeY = p.y;     // from the viewpoint's own height, eased to the ground's
    if (this.mode === 'walk' && !this.free(p.x, p.z)) {
      const f = this.nearestFree(p.x, p.z);
      if (f) { p.x = f[0]; p.z = f[1]; }
    }
  }

  /** advance by dt seconds; returns true when the camera moved */
  update(dt) {
    dt = Math.min(dt, 0.1);
    const k = this.keys;
    let fx = 0, fz = 0, fy = 0;
    if (k.has('KeyW') || k.has('ArrowUp')) fz += 1;
    if (k.has('KeyS') || k.has('ArrowDown')) fz -= 1;
    if (k.has('KeyD') || k.has('ArrowRight')) fx += 1;
    if (k.has('KeyA') || k.has('ArrowLeft')) fx -= 1;
    if (k.has('Space') || k.has('KeyE')) fy += 1;
    if (k.has('KeyQ') || k.has('KeyC')) fy -= 1;
    fx += this.stick.x; fz += this.stick.y; fy += this.lift;
    if (this.pinned) {
      if (!fx && !fz && !fy) { const ch = this.changed; if (ch) this._apply(); this.changed = false; return ch; }
      this.unpin();
    }
    const run = this.run || k.has('ShiftLeft') || k.has('ShiftRight') || Math.hypot(this.stick.x, this.stick.y) > 0.97;
    const fly = this.mode === 'fly';
    const sp = fly ? (run ? this.speed.flyRun : this.speed.fly) : (run ? this.speed.run : this.speed.walk);
    const len = Math.hypot(fx, fz);
    if (len > 1) { fx /= len; fz /= len; }
    // desired velocity in world space: walking moves on the ground plane, flying along the view
    const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
    const want = new THREE.Vector3();
    if (fly) {
      const cp = Math.cos(this.pitch), spi = Math.sin(this.pitch);
      want.set(-sy * cp * fz + cy * fx, spi * fz + fy, -cy * cp * fz - sy * fx).multiplyScalar(sp);
    } else want.set(-sy * fz + cy * fx, 0, -cy * fz - sy * fx).multiplyScalar(sp);
    // smooth acceleration (no instant starts and stops)
    const a = 1 - Math.exp(-dt * (fly ? 4 : 9));
    this.vel.lerp(want, a);
    if (this.vel.lengthSq() < 1e-4 && want.lengthSq() === 0) this.vel.set(0, 0, 0);
    const p = this.cam.position;
    const before = p.clone();
    if (fly) {
      p.addScaledVector(this.vel, dt);
      const g = Math.max(this.groundAt(p.x, p.z), 0);
      if (p.y < g + 1.5) p.y = g + 1.5;
      // a painting seen from too high dissolves into mist: flights stay below ~700 m over the ground
      if (p.y > g + 700) p.y = g + 700;
      this.eyeY = null;
    } else {
      const g0 = this.groundAt(p.x, p.z);
      const nx = p.x + this.vel.x * dt, nz = p.z + this.vel.z * dt;
      // slide along whatever blocks: full step, then each axis alone
      if (this.free(nx, nz, g0)) { p.x = nx; p.z = nz; }
      else if (this.free(nx, p.z, g0)) { p.x = nx; this.vel.z = 0; }
      else if (this.free(p.x, nz, g0)) { p.z = nz; this.vel.x = 0; }
      else this.vel.set(0, 0, 0);
      const g = this.groundAt(p.x, p.z) + EYE;
      // follow the ground smoothly (steps, deck slabs) but never sink into it
      this.eyeY = this.eyeY === null ? g : this.eyeY + (g - this.eyeY) * (1 - Math.exp(-dt * 12));
      if (this.eyeY < g - 0.25) this.eyeY = g - 0.25;
      p.y = this.eyeY;
    }
    const moved = p.distanceToSquared(before) > 1e-8 || this.changed;
    if (moved) this._apply();
    this.changed = false;
    return moved;
  }

  setMode(m) {
    if (m === this.mode) return;
    this.mode = m;
    if (m === 'walk') {
      // land where we are (or the nearest dry spot below)
      const p = this.cam.position;
      if (!this.free(p.x, p.z)) {
        const s = this.nearestFree(p.x, p.z);
        if (s) { p.x = s[0]; p.z = s[1]; }
      }
      this.eyeY = null;
    }
    this.changed = true;
  }

  /** the nearest standable point (spiral search up to 400 m) */
  nearestFree(x, z) {
    if (this.free(x, z)) return [x, z];
    for (let r = 2; r <= 400; r *= 1.25) {
      const n = Math.ceil((r * 2 * Math.PI) / 3);
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2, qx = x + Math.cos(a) * r, qz = z + Math.sin(a) * r;
        if (this.free(qx, qz)) return [qx, qz];
      }
    }
    return null;
  }

  // ---------------------------------------------------------------- input
  bind(el, ui) {
    const lockable = !!el.requestPointerLock && !matchMedia('(pointer: coarse)').matches;
    this.locked = false;
    el.addEventListener('click', () => { if (lockable && !this.locked && !ui.menuOpen()) el.requestPointerLock?.(); });
    document.addEventListener('pointerlockchange', () => { this.locked = document.pointerLockElement === el; ui.setLocked(this.locked); });
    let drag = null;
    el.addEventListener('mousedown', (e) => { if (!this.locked) drag = { x: e.clientX, y: e.clientY }; });
    addEventListener('mouseup', () => { drag = null; });
    addEventListener('mousemove', (e) => {
      if (this.locked) this.look(e.movementX * 0.0022, e.movementY * 0.0022);
      else if (drag) { this.look((e.clientX - drag.x) * 0.004, (e.clientY - drag.y) * 0.004); drag.x = e.clientX; drag.y = e.clientY; }
    });
    addEventListener('keydown', (e) => {
      if (e.target && /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
      if (e.code.startsWith('Arrow') || e.code === 'Space') e.preventDefault();
      this.keys.add(e.code);
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());
    // touch: the left half steers (a stick that appears under the thumb), the right half looks
    const touches = new Map();
    const stickEl = ui.stickEl, knob = ui.knobEl;
    el.addEventListener('touchstart', (e) => {
      e.preventDefault();
      for (const t of e.changedTouches) {
        const left = t.clientX < innerWidth * 0.45 && !touches.has('stick');
        touches.set(t.identifier, { kind: left ? 'stick' : 'look', x0: t.clientX, y0: t.clientY, x: t.clientX, y: t.clientY });
        if (left) { touches.set('stick', t.identifier); stickEl.style.left = t.clientX + 'px'; stickEl.style.top = t.clientY + 'px'; stickEl.classList.add('on'); }
      }
    }, { passive: false });
    el.addEventListener('touchmove', (e) => {
      e.preventDefault();
      for (const t of e.changedTouches) {
        const s = touches.get(t.identifier); if (!s) continue;
        if (s.kind === 'look') { this.look((t.clientX - s.x) * 0.006, (t.clientY - s.y) * 0.006); s.x = t.clientX; s.y = t.clientY; }
        else {
          const R = 56, dx = t.clientX - s.x0, dy = t.clientY - s.y0, l = Math.hypot(dx, dy), k = l > R ? R / l : 1;
          this.stick.x = (dx * k) / R; this.stick.y = (-dy * k) / R;
          knob.style.transform = `translate(${dx * k}px, ${dy * k}px)`;
        }
      }
    }, { passive: false });
    const end = (e) => {
      for (const t of e.changedTouches) {
        const s = touches.get(t.identifier); touches.delete(t.identifier);
        if (s?.kind === 'stick') { touches.delete('stick'); this.stick.x = this.stick.y = 0; knob.style.transform = ''; stickEl.classList.remove('on'); }
      }
    };
    el.addEventListener('touchend', end); el.addEventListener('touchcancel', end);
  }
}
