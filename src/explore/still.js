// The still view of the explorable world: when the camera stands still, the world is put into the state an offline
// still renders (tools/render.mjs --quality high) and painted with the full still pipeline (src/ink/index.js
// renderStill), then faded in over the live painting. At one of the ten viewpoints (keys 1–0, not moved since) it is
// the still itself: the shot's terrain set, the shot cameras' building / house levels, the still's plants (the
// explorable world's own cover left out) and the shot's ink settings.
//
//   const sv = new StillView(engine)
//   await sv.enter(shotId | null)   → true when the world is ready to paint (false: cancelled by exit())
//   sv.exit()                       back to the walking state
//
// What changes (and why it is not in the live frame): the terrain leaves (the stills' finer quadtree, meshed in the
// height workers), the vegetation buckets (the stills' LODs, budget and frustum, no far impostor sectors), the
// buildings' and houses' levels of detail, the planar mirror on the water (a second scene pass), the lake mist veils,
// the 飞来峰 rock's full noise, the sky's cloud steps and the forest-floor zone of the terrain; at a viewpoint also the
// stills' shadows (the cascades out to 2400 m on 4096² maps, every caster in that range: the walking world keeps 500 m
// on 2048²; the stills' far crowns and hills take their depth of ink from those shadows) and the stills' water depth
// (src/explore/watermap.js).
import { SHOTS } from '../world/shots.js';
import { extraCamsOf } from '../world/plancams.js';
import { applyStage, restoreStage } from '../ink/stage.js';
import { INK_STAGE } from '../ink/styles.js';
import { planLeaves } from '../terrain/mesh.js';
import { SKY } from '../core/sky.js';
import { getQuality } from '../core/quality.js';

// src/modules/terrain.js at the stills' quality: angular cell, smallest cell, cells per leaf side
const TERRAIN = { theta: 0.0065, outside: 3, minCell: 0.75, N: 32 };
const HIGH = getQuality('high');

/** the sun's cascades out to `far` m on size² maps (the maps re-made when the size changes) */
function setShadows(engine, far, size) {
  const csm = engine.lighting?.csm;
  if (!csm) return;
  csm.maxFar = far;
  for (const l of csm.lights) {
    if (l.shadow.mapSize.x === size) continue;
    l.shadow.mapSize.set(size, size);
    if (l.shadow.map) { l.shadow.map.dispose(); l.shadow.map = null; }
    l.shadow.needsUpdate = true;
  }
  engine.lighting.refreshCSM();
}

export class StillView {
  constructor(engine, { rockLite = null, lodFade = null, country = null } = {}) {
    this.engine = engine;
    this.country = country;       // src/explore/fields.js: the countryside (no still has it: off at a viewpoint)
    this.lodFade = lodFade;       // src/explore/lodfade.js: the walking dissolve between building levels
    this.rockLite = rockLite;     // src/explore/rocklite.js: the walking rock shaders, the originals in a still
    this.on = false;
    this.token = 0;
    this.saved = null;
  }

  async enter(shotId = null) {
    const e = this.engine, R = e.registry, cam = e.camera;
    const token = ++this.token;
    const shot = shotId ? SHOTS.find((s) => s.id === shotId) : null;
    // the terrain first (asynchronous): the leaves a still of this camera meshes
    const d = cam.getWorldDirection(cam.position.clone());
    const cams = shot
      ? [shot, ...extraCamsOf(shot.id), ...(R.terrainCams || [])]
      : [{ pos: cam.position.toArray(), target: cam.position.clone().addScaledVector(d, 100).toArray(), fov: cam.fov }];
    const stream = R.terrain?.stream;
    // the baked rocks and cliff this view (and its shadows) reach, at the stills' detail (src/explore/lazy.js)
    const bakes = R.lazy?.forStill(cam);
    if (stream) {
      const leaves = planLeaves(cams, TERRAIN);
      const ok = await stream.showSet(leaves, TERRAIN.N);
      if (!ok || token !== this.token) return false;
    }
    if (bakes) { await bakes; if (token !== this.token) return false; }
    if (token !== this.token) return false;
    // a viewpoint: the stills' water depth first (src/explore/watermap.js, computed once after the load)
    if (shot && R.stillWater) { await R.stillWater; if (token !== this.token) return false; }
    const K = await import('../karst/material.js');
    if (token !== this.token) return false;
    this.on = true;
    const sv = (this.saved = {});
    // water: the planar mirror at the stills' resolution
    const refl = R.water?.reflection;
    if (refl) {
      sv.refl = { enabled: refl.enabled, on: refl.uniforms.uReflOn.value, scale: refl.scale };
      refl.enabled = true; refl.uniforms.uReflOn.value = 1; refl.setScale?.(0.75);
    }
    // the lake mist veils (they shade the photographic tone of the still)
    const mist = R.mist?.group;
    if (mist) { sv.mist = mist.visible; mist.visible = true; }
    sv.kOne = K.K_ONE.value; K.K_ONE.value = 1;
    this.rockLite?.still();
    sv.cloud = SKY.uCloudSteps.value; SKY.uCloudSteps.value = HIGH.cloudSteps;
    // parts kept at a lower detail for walking (the 飞来峰 cliff): the stills' own
    for (const w of R.stillSwap || []) { if (w.mesh) w.mesh.geometry = w.still; else { w.live.visible = false; w.still.visible = true; } }
    // buildings and pagodas: the level a still builds (the walking dissolve's clones off)
    this.lodFade?.reset();
    for (const s of R.lodSwitch || []) { const n = (s.lod ?? 0) <= 1; s.near.visible = n; s.far.visible = !n; }
    R.city?.houseStill?.(cam.position, !!shot);
    if (shot) this.country?.setVisible(false);
    // the stills' shadows: their range and map size, and every caster within it (src/core/engine.js _cullShadowCasters
    // reads the range from the quality)
    if (shot) {
      const csm = e.lighting.csm;
      sv.csm = { far: csm.maxFar, size: csm.lights[0].shadow.mapSize.x, q: e.quality.shadowMaxFar };
      setShadows(e, HIGH.shadowMaxFar, HIGH.shadowMapSize);
      e.quality.shadowMaxFar = HIGH.shadowMaxFar;
      e._cullShadowCasters();
      e.quality.shadowMaxFar = sv.csm.q;
    }
    // the art-directed bridges (望山桥, 断桥) at the shots' axes (the walkable world turns them along their causeway)
    if (shot) for (const b of R.bridges || []) if (b.stillRotY !== undefined) { b.walkRotY = b.group.rotation.y; b.group.rotation.y = b.stillRotY; b.group.updateMatrixWorld(true); }
    // the shot's ink stage (src/ink/stage.js): what its offline ink still enlarges, turns or leaves out (after the
    // bridges' own still axes: a stage turn is relative to them)
    if (shot && e.params.get('look') === 'ink') applyStage(e, shot.id, INK_STAGE);
    // the forest floor under the instanced trees: a still keeps it round the first shot camera
    const TZ = R.terrain?.material?.userData?.cgUniforms?.uTreeZone;
    if (TZ && shot) { sv.tz = TZ.value.clone(); TZ.value.set(SHOTS[0].pos[0], SHOTS[0].pos[2], 900, 0); }
    // plants: the stills' buckets for this camera (every plant in the frustum: a few hundred ms of work, in slices
    // a frame apart so the page keeps answering; moving again cancels it)
    const veg = R.vegetation?.sys;
    if (veg) {
      veg.still = { noCover: !!shot }; veg.resetHistory();
      const st = await veg.updateSliced(cam);
      if (token !== this.token) return false;
      if (!st) veg.update(cam);     // (another re-bucket ran meanwhile: this one at once)
    }
    e.ensurePatched();
    return true;
  }

  exit() {
    this.token++;
    const e = this.engine, R = e.registry, cam = e.camera;
    R.terrain?.stream?.resume();
    if (!this.on) return;
    this.on = false;
    const sv = this.saved || {};
    const refl = R.water?.reflection;
    // the mirror keeps the stills' size (the walking painting has it off): resizing its depth-textured target a second
    // time leaves the framebuffer incomplete (three r186), and every later still lost its reflection
    if (refl && sv.refl) { refl.enabled = sv.refl.enabled; refl.uniforms.uReflOn.value = sv.refl.on; }
    if (R.mist?.group && sv.mist !== undefined) R.mist.group.visible = sv.mist;
    import('../karst/material.js').then((K) => { if (!this.on) K.K_ONE.value = sv.kOne; });
    this.rockLite?.live();
    SKY.uCloudSteps.value = sv.cloud;
    const TZ = R.terrain?.material?.userData?.cgUniforms?.uTreeZone;
    if (TZ && sv.tz) TZ.value.copy(sv.tz);
    R.city?.houseLive?.(cam.position);
    this.country?.setVisible(true);
    if (sv.csm) { setShadows(e, sv.csm.far, sv.csm.size); e._cullShadowCasters(); }
    restoreStage();
    for (const w of R.stillSwap || []) { if (w.mesh) w.mesh.geometry = w.live; else { w.live.visible = true; w.still.visible = false; } }
    for (const b of R.bridges || []) if (b.walkRotY !== undefined) { b.group.rotation.y = b.walkRotY; b.walkRotY = undefined; b.group.updateMatrixWorld(true); }
    const veg = R.vegetation?.sys;
    if (veg) { veg.still = null; veg.resetHistory(); veg.update(cam); veg.farVisibility(cam); }
    this.saved = null;
  }
}
