// The explorable world (?mode=explore, the default page): walk or fly through the whole world in real time.
//
//   prepareExplore(engine)   before the build: start viewpoint, loading screen progress, engine.explore = true
//   afterBuild(engine)       walk surfaces (bridge decks, pagodas), realtime settings
//   applyStart(engine)       the start viewpoint and its look
//   startExplore(engine)     input, interface and the frame loop
//
// Rendering: the ink painting (纯水墨, src/ink) by default — one scene pass into the G-buffer per frame (its colour
// attachment is the photographic tone), then the painter; ?look=photo renders the photographic frame (one sample).
// When the camera has stood still for STILL_AFTER s the still view takes over (src/explore/still.js): the world in a
// still's state, painted with the full still pipeline (src/ink/index.js renderStill) and faded in; at one of the ten
// viewpoints, not moved since the teleport, it is the offline still itself. Moving again fades back to the live frame.
// Live frames go through FXAA and are upscaled from the adaptive render scale (src/ink/index.js present). Streaming: the terrain is re-planned
// around the camera (src/explore/terrain.js), the vegetation re-buckets its LODs from the moving camera (VegSystem; its
// far impostors are refilled a slice a frame),
// the shadow cascades follow the camera, the casters and the water region are refreshed as the camera travels.
//
// Test hooks: window.__explore = { teleport(n), setLook(id), setPose([x,y,z], yawDeg, pitchDeg), mode(m), stats(),
//   fps(seconds, { path }) } — see tools/explore-session.mjs.
import * as THREE from 'three';
import { SHOTS } from '../world/shots.js';
import { heightAt } from '../world/heightfield.js';
import { Walker } from './walker.js';
import { ExploreUI, PLACES, TIMES, loadingProgress, hideLoading } from './ui.js';
import { StillView } from './still.js';
import { LIVE, liveState, applyLive, adapt, installPresent } from './tier.js';

const P = new URLSearchParams(location.search);
let S = null;           // explore state

export function prepareExplore(engine) {
  engine.explore = true;
  const at = Number(P.get('at')) || 2;
  S = { engine, place: at, look: Number(P.get('time')) || at, frame: 0 };
  engine.onProgress = (f, name) => loadingProgress(0.04 + f * 0.9, name);
  loadingProgress(0.03, 'start');
  // the camera stands at the start viewpoint while the world builds (the streamed terrain is planned around it)
  const v = viewpoint(engine, at);
  engine.camera.position.set(...v.pos);
  engine.camera.lookAt(...v.target);
  engine.camera.updateMatrixWorld(true);
}

/** a viewpoint: the ink camera of the shot when painting in ink (src/ink/styles.js INK_CAMS), else the shot camera */
function viewpoint(engine, id) {
  const s = SHOTS.find((x) => x.id === id) || SHOTS[1];
  const ic = engine.params.get('look') === 'ink' ? INK_CAMS?.[id] : null;
  return { ...s, ...(ic || {}) };
}
let INK_CAMS = null;

export async function afterBuild(engine) {
  INK_CAMS = (await import('../ink/styles.js')).INK_CAMS;
  const ink = engine.params.get('look') === 'ink';
  // the lake mist sheets are photographic veils: the painting leaves its own mist (留白), so they cost nothing
  if (ink && engine.registry.mist?.group) { engine.registry.mist.group.visible = false; engine.registry.mist.group.userData.exploreOff = true; }
  // the 飞来峰 rock shader: fewer noise octaves and one crack cell (invisible under the ink, ~25 % of a frame there)
  if (ink && P.get('karstFull') !== '1') { const K = await import('../karst/material.js'); K.K_ONE.value = 0.6; }
  S.walker = new Walker(engine);
  S.walker.collect();
  engine.pipeline.realtime = true;
  engine.pipeline.levelsEvery = 24;
  // the painting leaves the water as paper with ripple lines: the planar mirror (a second scene pass, ~11 ms) is off
  const refl = engine.registry.water?.reflection;
  if (ink && refl && P.get('refl') !== '1') { refl.enabled = false; refl.uniforms.uReflOn.value = 0; }
}

/** apply a look (time of day / season, src/world/looks.js) at the current camera */
function setLook(id) {
  const e = S.engine, cam = e.camera;
  // out of a still view first (its plants, levels and shadows are a still's: re-bucketed for the walk, not for a still)
  S.leaveStill?.();
  const d = new THREE.Vector3(); cam.getWorldDirection(d);
  const p = cam.position;
  const yaw = S.walker?.yaw, pitch = S.walker?.pitch, fov = cam.fov;
  e.applyShot({ id, pos: [p.x, p.y, p.z], target: [p.x + d.x * 100, p.y + d.y * 100, p.z + d.z * 100], fov, shadowRange: 550, near: 0.4 });
  if (S.walker && yaw !== undefined) { S.walker.yaw = yaw; S.walker.pitch = pitch; S.walker._apply(); }
  afterLook(id);
}
function afterLook(id) {
  const e = S.engine, p = e.camera.position;
  if (e.registry.mist?.group?.userData.exploreOff) e.registry.mist.group.visible = false;
  S.look = id;
  S.lastApply = p.clone();
  S.region = e.registry.water?.region?.({ pos: [p.x, p.y, p.z] });
  e.pipeline._lv = null;           // a new look: solve the levels afresh
  S.dirty = 3;
  S.ui?.setState({ place: S.place, look: S.look, mode: S.walker?.mode });
}

/** the vertical field of view that shows a still's whole width (its frame is 1664 × 928) at this aspect */
const STILL_ASPECT = 1664 / 928;
function stillFov(fov, aspect) {
  if (aspect >= STILL_ASPECT) return fov;
  return (2 * Math.atan(Math.tan((fov * Math.PI) / 360) * (STILL_ASPECT / aspect)) * 180) / Math.PI;
}

/** go to one of the ten viewpoints with its own look: the still's own camera (src/ink/styles.js INK_CAMS), its
 *  width kept on narrower screens; the walker holds that pose until it is moved */
function teleport(id, { look = true } = {}) {
  const e = S.engine;
  S.leaveStill?.();
  e.registry.vegetation?.sys?.farInvalidate?.();
  const v = viewpoint(e, id);
  const cam = e.camera;
  S.place = id;
  if (look) {
    // exactly what a still applies (the ink cameras through src/ink/index.js, the look of the shot)
    e.applyShot(SHOTS.find((x) => x.id === id) || v);
    afterLook(id);
  } else {
    cam.position.set(...v.pos);
    cam.lookAt(...v.target);
    S.dirty = 3;
  }
  cam.fov = stillFov(v.fov ?? 40, cam.aspect);
  cam.updateProjectionMatrix();
  cam.updateMatrixWorld(true);
  e.lighting.refreshCSM();
  S.country?.update(cam.position, true);
  S.atShot = id;
  S.fovGoal = null;
  if (S.walker) {
    S.walker.fromCamera();
    // a viewpoint high above the ground (宝石山, over 御街, …) starts in flight
    const g = S.walker.groundAt(v.pos[0], v.pos[2]);
    S.walker.mode = v.pos[1] - g > 4 ? 'fly' : 'walk';
    S.walker.pinned = true;
    S.walker.eyeY = null;
    S.walker._apply();
  }
  S.ui?.announce(PLACES.find((p) => p.id === id));
}

export function applyStart(engine) {
  // the stills are rendered after the page applied shot 1, and engine.applyShot restores the sky / air uniforms to
  // the values of the first shot it applied (the sun's tint in the haze and the sky among them): do the same, so a
  // still view at any viewpoint is the still
  engine.applyShot(SHOTS[0]);
  if (S.look === S.place) { teleport(S.place); return; }
  teleport(S.place, { look: false });
  setLook(S.look);
}

/** ink settings for the walking camera (src/ink/index.js reads ink.explore). At a viewpoint they are the still's own
 *  (src/ink/styles.js inkShot of the look); walking away from the look's ink camera they blend (over 20–250 m, so
 *  nothing jumps) into settings for a camera at eye height: line weights and mist distances scaled with the height
 *  above the ground, mist bands round the walker, one fixed foreshortening for the ground's 擦 strokes (a per-pixel one
 *  from the moving eye would swim). The lattices keep the look's own axes (world-fixed); the foci keep their world
 *  points with a floor of ink that rises toward an even density away from them. */
function inkFor(engine) {
  let styles = null;
  import('../ink/styles.js').then((m) => { styles = m; });
  const lerp = (a, b, t) => a + (b - a) * t;
  const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  const cam = (id) => viewpoint(engine, id);
  return {
    get axis() {
      const v = cam(S.look);
      const dx = v.target[0] - v.pos[0], dz = v.target[2] - v.pos[2], l = Math.hypot(dx, dz) || 1;
      return [dx / l, dz / l];
    },
    floor: 0.45,
    shot(id) {
      const base = styles ? { ...styles.inkShot(id), ...(engine.shot?.ink || {}) } : {};
      const p = engine.camera.position;
      const g = Math.max(0, heightAt(p.x, p.z));
      const agl = Math.max(0, p.y - g);
      const k = 1 + agl / 20, q = Math.sqrt(k);
      const walk = {
        near: 8 * k, far: Math.min(6000, 1400 * q), cunFar: Math.min(6000, 2000 * q), mi: Math.min(1200, 300 * q),
        ridge: base.ridge === 0 ? 0 : 50, ridgeFrom: 700 * q, groundY: g - 2,
        bands: base.night ? [] : [[280 * q, 120 * q, 0.7, 12 + agl * 0.5], [1500 * q, 800 * q, 0.85, 90 + agl]],
      };
      const v = cam(id);
      const w = smooth(20, 250, Math.hypot(p.x - v.pos[0], p.y - v.pos[1], p.z - v.pos[2]));
      const out = { ...base };
      for (const key of ['near', 'far', 'cunFar', 'mi', 'ridge', 'ridgeFrom']) out[key] = lerp(base[key] ?? walk[key], walk[key], w);
      out.groundY = lerp(base.groundY ?? 0, walk.groundY, w);
      // the still's bands fade out as the walker's fade in
      const bb = base.bands || [];
      out.bands = w < 0.5 ? bb.map((b) => [b[0], b[1], b[2] * (1 - 2 * w), b[3]]) : walk.bands.map((b) => [b[0], b[1], b[2] * (2 * w - 1), b[3]]);
      out.grazeFix = 0.3; out.grazeW = w;
      out.focus = (base.focus || []).map(([x, y, z, r, lo]) => [x, y, z, r, lerp(lo ?? 0.25, this.floor, w)]);
      if (w > 0.999) out.patch = null;
      return out;
    },
  };
}

export async function startExplore(engine, { buildMs }) {
  const ink = engine.ink;
  if (ink) ink.explore = inkFor(engine);
  await import('../ink/styles.js');
  const W = S.walker;
  S.ui = new ExploreUI({
    onPlace: (id) => teleport(id),
    onTime: (look) => setLook(look),
    onMode: (m) => { W.setMode(m); S.ui.setState({ place: S.place, look: S.look, mode: W.mode }); },
  });
  W.bind(engine.canvas, S.ui);
  S.ui.setState({ place: S.place, look: S.look, mode: W.mode });
  // the frame-rate line is for development: ?debug=1 (or ?fps=1)
  if (P.get('debug') === '1' || P.get('fps') === '1') S.ui.fpsEl.hidden = false;
  addEventListener('keydown', (e) => {
    if (e.repeat) return;
    if (/^Digit[0-9]$/.test(e.code)) { const n = Number(e.code.slice(5)); teleport(n === 0 ? 10 : n); }
    else if (e.code === 'KeyF') { W.setMode(W.mode === 'fly' ? 'walk' : 'fly'); S.ui.setState({ place: S.place, look: S.look, mode: W.mode }); }
    else if (e.code === 'KeyT') { const i = TIMES.findIndex((t) => t.look === S.look); setLook(TIMES[(i + 1) % TIMES.length].look); }
    else if (e.code === 'KeyM' || e.code === 'Tab') { e.preventDefault(); S.ui.toggle(); }
    else if (e.code === 'KeyP') {
      const p = engine.camera.position;
      const txt = JSON.stringify({ pos: [p.x, p.y, p.z].map((v) => +v.toFixed(1)), yaw: +(W.yaw * 180 / Math.PI).toFixed(1), pitch: +(W.pitch * 180 / Math.PI).toFixed(1) });
      console.log(txt); navigator.clipboard?.writeText(txt).catch(() => {});
    }
  });
  W.ui = S.ui;
  // window size changes: resize the canvas and every frame-sized target
  addEventListener('resize', () => {
    const [w, h] = fullSize();
    if (ink) { if (w !== engine.width || h !== engine.height) resize(engine, w, h); return; }
    const k = Number(P.get('scale')) || AR.scale;
    const wk = Math.round(w * k), hk = Math.round(h * k);
    if (wk === engine.width && hk === engine.height) return;
    resize(engine, wk, hk);
  });
  // the ink painting: the canvas, the camera and the photographic pipeline at the window's size; only the live
  // painting follows the quality ladder (src/explore/tier.js: high / low tier, adaptive scale; ?q=low|high, ?scale=N)
  if (ink) {
    installPresent(engine);
    const [w, h] = fullSize();
    if (w !== engine.width || h !== engine.height) resize(engine, w, h);
    else { applyLive(engine); S.dirty = 3; }
  }

  // the rocks and the 飞来峰 cliff in a lighter shader while walking (src/explore/rocklite.js; ?rockLite=0 keeps the
  // originals); compiled before the first frame
  if (ink && P.get('rockLite') !== '0') {
    const { RockLite } = await import('./rocklite.js');
    S.rockLite = new RockLite(engine);
    S.rockLite.live();
    await engine.renderer.compileAsync(engine.scene, engine.camera);
  }
  // buildings and pagodas dissolve between their two levels across a band round the switch distance
  // (src/explore/lodfade.js; ?lodFade=0 swaps them hard)
  if (P.get('lodFade') !== '0' && engine.registry.lodSwitch?.length) {
    const { LodFade } = await import('./lodfade.js');
    S.lodFade = new LodFade(engine);
    await S.lodFade.precompile();
  }
  // the static geometry is uploaded now and its CPU copies dropped (src/core/compact.js; ?keepArrays=1 keeps them)
  if (P.get('keepArrays') !== '1') {
    const t0 = performance.now();
    const C = await import('../core/compact.js');
    const roots = ['yingzao', 'pagodas', 'city', 'karst', 'rocks', 'bridges', 'boats', 'tide', 'vegetation'].flatMap((n) => engine.moduleRoots?.[n] || []);
    const vegGeos = (engine.registry.vegetation?.sys?.variants || []).flatMap((v) => v.lods.flatMap((l) => Object.values(l).filter((g) => g?.isBufferGeometry)));
    let n = 0;
    for (const r of roots) n += C.releaseOnUpload(r);
    for (const g of vegGeos) n += C.releaseOnUpload({ traverse: (f) => f({ geometry: g }) });
    const up = C.uploadNow(engine, roots, vegGeos);
    console.log(`[explore] ${n} static geometries uploaded (${up}) and their CPU copies dropped in ${Math.round(performance.now() - t0)} ms`);
  }
  // the countryside (src/explore/fields.js): hamlets' pieces at once, the fields when the workers have planned them
  // (low priority, a few seconds into the walk); ?farm=0 leaves it out
  if (P.get('farm') !== '0') {
    const { Countryside } = await import('./fields.js');
    S.country = new Countryside(engine);
    S.country.start().then(() => { S.dirty = Math.max(S.dirty, 2); }).catch((e) => console.error('[explore] countryside failed', e));
  }
  // the water's depth as the stills' (src/explore/watermap.js), in the background; a viewpoint's still waits for it
  if (P.get('stillWater') !== '0') engine.registry.stillWater = import('./watermap.js').then((m) => m.stillWaterMaps(engine));
  const terrain = engine.registry.terrain?.stream;
  const TZ = engine.registry.terrain?.material?.userData?.cgUniforms?.uTreeZone;
  const times = [];
  let last = performance.now();
  S.dirty = 3;
  // the still view: off with ?still=0
  const SV = ink && P.get('still') !== '0' ? new StillView(engine, { rockLite: S.rockLite, lodFade: S.lodFade, country: S.country }) : null;
  S.sv = SV;
  const ST = (S.still = { phase: 'idle', idle: 0, mix: 0, t0: 0, out: 0, n: 0 });
  const leaveStill = () => {
    if (ST.phase === 'idle') return;
    if (ST.phase === 'fade' || ST.phase === 'shown') ST.out = ST.mix;
    ST.phase = 'idle'; ST.mix = 0;
    SV.exit();
    S.lastLod = null; S.lastCull = null;
    // the walking levels at once (the still set its own; the next update would wait for the walker to move)
    S.lodFade?.update(engine.camera.position);
  };
  S.leaveStill = () => { if (SV) leaveStill(); };
  const enterStill = () => {
    ST.phase = 'prep';
    farShadowsOn(engine);
    const n = ++ST.n;
    // at a viewpoint not moved since the teleport (and in its own look): the offline still itself
    const vp = S.atShot && S.look === S.atShot ? S.atShot : null;
    SV.enter(vp).then((ok) => {
      if (!ok || ST.phase !== 'prep' || ST.n !== n) return;
      ink.stillBegin();
      ST.phase = 'accum'; ST.vp = vp;
    }).catch((e) => { console.error('[explore] still view failed', e); ST.phase = 'idle'; });
  };
  const frame = (now) => {
    requestAnimationFrame(frame);
    const frameMs = now - last, dt = Math.min(0.1, frameMs / 1000); last = now;
    W.lift = S.ui.lift;
    const tA = performance.now();
    let moved = W.update(dt);
    if (W.pinned === false && S.atShot) { S.atShot = null; S.fovGoal = fovFor(engine.camera.aspect); }
    // after a teleport the still's narrow field of view widens back to the walking one once the walker moves
    if (S.fovGoal) {
      const cam = engine.camera;
      cam.fov += (S.fovGoal - cam.fov) * (1 - Math.exp(-dt * 2.5));
      if (Math.abs(cam.fov - S.fovGoal) < 0.05) { cam.fov = S.fovGoal; S.fovGoal = null; }
      cam.updateProjectionMatrix(); engine.lighting.refreshCSM();
      moved = true;
    }
    const p = engine.camera.position;
    const tB = performance.now();
    if (ST.phase === 'idle' && terrain && terrain.update(p)) S.dirty = Math.max(S.dirty, 1);
    // the vegetation re-buckets its LODs from the moving camera (its own sentinel is hidden from the ink G-buffer pass)
    const veg = engine.registry.vegetation?.sys;
    let vegMs = 0;
    // the far impostors' refill, a slice a frame (src/vegetation/system.js step)
    let vegStep = 0;
    if (veg) { const tv = performance.now(); if (veg.step(3)) S.dirty = Math.max(S.dirty, 1); vegStep = performance.now() - tv; }
    if (veg && moved) { const tv = performance.now(); if (veg.maybeUpdate(engine.camera)) vegMs += performance.now() - tv; veg.farVisibility(engine.camera); }
    const tC = performance.now();
    // things that follow the traveller: casters in the shadow range, the water region's height map, boats near by
    const pt = S.prof ? {} : null, lap = (k, t) => { if (pt) pt[k] = performance.now() - t; return performance.now(); };
    if (moved) {
      let t = performance.now();
      engine.registry.city?.houseLod?.(p);
      t = lap('houses', t);
      // buildings and pagodas: full detail near, massing far (src/modules/yingzao.js exploreLod), dissolving into
      // each other across a band (src/explore/lodfade.js)
      S.country?.update(p);
      t = lap('country', t);
      if (S.lodFade) S.lodFade.update(p);
      else if (!S.lastLod || S.lastLod.distanceTo(p) > 10) {
        S.lastLod = p.clone();
        for (const s of engine.registry.lodSwitch || []) { const n = Math.hypot(p.x - s.x, p.z - s.z) < s.d; s.near.visible = n; s.far.visible = !n; }
      }
      t = lap('lod', t);
      if (!S.lastCull || S.lastCull.distanceTo(p) > 120) { engine._cullShadowCasters(); S.lastCull = p.clone(); }
      t = lap('cull', t);
      if (TZ) TZ.value.set(p.x, p.z, 900, 0);
      const reg = engine.registry.water?.region?.({ pos: [p.x, p.y, p.z] });
      if ((reg && reg !== S.region) || (S.lastApply && S.lastApply.distanceTo(p) > 1500)) setLook(S.look);
      lap('look', t);
    }
    // the countryside's near tea rows, one tile a frame (src/explore/fields.js), not while a still view is up
    if (ST.phase === 'idle' && S.country?.step()) S.dirty = Math.max(S.dirty, 1);
    if (!moved && S.dirty <= 0) {
      // standing still: the still view after STILL_AFTER s, faded in; once it shows (or with no still view), the
      // buildings' middle levels are built one at a time (src/explore/lodfade.js, 0.1–0.6 s each)
      ST.idle += dt;
      if (S.lodFade && ST.idle > 0.8 && (!SV || S.noStill || ST.phase === 'shown') && now - (S.lastMid || 0) > 400) {
        if (S.lodFade.buildNext(p)) S.lastMid = performance.now();
      }
      if (!SV || S.noStill) return;
      if (ST.phase === 'idle' && ST.idle >= STILL_AFTER) enterStill();
      // the still's samples, a few per frame (≈ 40 ms of GPU work), then its painting
      if (ST.phase === 'accum') {
        if (ink.stillStep(2)) { ink.stillPaint({ offline: !!ST.vp }); ST.phase = 'fade'; ST.t0 = performance.now(); }
      }
      if (ST.phase === 'fade') {
        const t = Math.min(1, (performance.now() - ST.t0) / STILL_FADE_MS);
        ST.mix = t * t * (3 - 2 * t);
        ink.present(ST.mix);
        if (t >= 1) ST.phase = 'shown';
      }
      return;
    }
    ST.idle = 0;
    if (SV) leaveStill();
    const t0 = performance.now();
    if (ink) {
      farShadows(engine);
      ink.renderRealtime();
      // a still view that was showing fades out over the first live frames
      ink.present(ST.out);
      ST.out = Math.max(0, ST.out - dt / 0.18);
    } else { engine.lighting.refreshCSM(); engine.renderInteractive(true); }
    S.dirty = moved ? 1 : S.dirty - 1;
    S.frame++;
    if (ink) { if (adapt(engine, now, moved)) S.dirty = 3; } else adaptResolution(engine, now, moved);
    if (S.prof) { const tE = performance.now(); S.prof.push({ cpu: tE - tA, walk: tB - tA, terrain: tC - tB, place: t0 - tC, render: tE - t0, ...(engine.ink?.rtTimes || {}), vegMs, vegStep, ...pt, dt: frameMs }); if (S.prof.length > 600) S.prof.shift(); }
    times.push(now);
    while (times.length && now - times[0] > 1000) times.shift();
    if (!S.ui.fpsEl.hidden) {
      const i = engine.pipeline.sceneInfo || {};
      S.ui.fpsEl.textContent = `${times.length} fps  cpu ${(performance.now() - t0).toFixed(1)} ms  calls ${i.calls}  tris ${((i.triangles || 0) / 1e6).toFixed(1)}M  ${ink ? liveState().tier + ' ' + liveState().scale.toFixed(2) : 'scale ' + AR.scale.toFixed(2)}\n` +
        `${W.mode}  ${p.x.toFixed(0)} ${p.y.toFixed(1)} ${p.z.toFixed(0)}  terrain ${terrain?.stats.leaves ?? '-'}`;
    }
  };
  requestAnimationFrame(frame);
  hideLoading();
  if (S.place) S.ui.announce(PLACES.find((x) => x.id === S.place));
  installTestHooks(engine, buildMs);
  console.log(`[explore] ready: ${engine.width}x${engine.height}, look ${S.look}, place ${S.place}, ${ink ? 'ink ' + ink.styleName : 'photo'}`);
}

/**
 * The far shadow cascade (100–500 m) is redrawn only when the camera has moved 1 m or turned 1° since its last
 * redraw (and at least every fourth frame, for the boats and the tide): between redraws its map and matrix stay
 * together (three.js skips a light whose shadow does not need an update and keeps its old shadow matrix), so the
 * far shadows are a few frames old, never misplaced. ?farShadow=1 redraws it every frame. The still view's samples
 * redraw every cascade (src/explore/still.js restores autoUpdate).
 */
const FS = { pos: null, q: null, n: 0 };
function farShadows(engine) {
  const L = engine.lighting.csm?.lights;
  if (!L || L.length < 2 || P.get('farShadow') === '1') return;
  const sh = L[L.length - 1].shadow, cam = engine.camera;
  sh.autoUpdate = false;
  const far = !FS.pos || FS.pos.distanceTo(cam.position) > 1 || FS.q.angleTo(cam.quaternion) > 0.0175 || ++FS.n >= 4 || S.dirty > 1;
  sh.needsUpdate = far;
  if (far) { FS.pos = (FS.pos || cam.position.clone()).copy(cam.position); FS.q = (FS.q || cam.quaternion.clone()).copy(cam.quaternion); FS.n = 0; }
}
function farShadowsOn(engine) { const L = engine.lighting.csm?.lights; if (L?.length) L[L.length - 1].shadow.autoUpdate = true; FS.pos = null; }

/**
 * Adaptive resolution of the photographic look (?look=photo): while the camera moves, the mean frame time over ~2 s
 * sets the render scale (0.55 … 1 of the window's CSS pixels; the canvas is stretched to the window). Off with
 * ?scale=N (a fixed scale). The ink painting has its own ladder (src/explore/tier.js).
 */
const AR = { t0: 0, n: 0, sum: 0, last: 0, scale: 1, changed: 0 };
const STILL_AFTER = 0.3, STILL_FADE_MS = 450;
function adaptResolution(engine, now, moved) {
  if (P.get('scale')) return;
  const dt = now - AR.last; AR.last = now;
  if (!moved || dt > 250) { AR.t0 = now; AR.n = 0; AR.sum = 0; return; }
  AR.n++; AR.sum += dt;
  if (now - AR.t0 < 2000 || AR.n < 20) return;
  const mean = AR.sum / AR.n;
  AR.t0 = now; AR.n = 0; AR.sum = 0;
  let k = AR.scale;
  if (mean > 1000 / 27 && k > 0.56) k = Math.max(0.55, k - (mean > 60 ? 0.2 : 0.1));
  else if (mean < 1000 / 50 && k < 1 && now - AR.changed > 6000) k = Math.min(1, k + 0.1);
  if (k === AR.scale) return;
  AR.scale = k; AR.changed = now;
  const [fw, fh] = fullSize();
  resize(engine, Math.round(fw * k), Math.round(fh * k));
  console.log(`[explore] render scale ${k.toFixed(2)} after ${mean.toFixed(1)} ms frames`);
}

/** the window in device pixels (capped at 1 per CSS pixel), or ?w / ?h */
function fullSize() {
  const w = Number(P.get('w')) || Math.round(innerWidth * Math.min(devicePixelRatio, 1));
  const h = Number(P.get('h')) || Math.round(innerHeight * Math.min(devicePixelRatio, 1));
  return [w, h];
}

/** vertical field of view: 55° on a landscape screen, wider on a portrait phone (keeps ~45° across) */
function fovFor(aspect) { return aspect >= 1 ? 55 : Math.min(80, (2 * Math.atan(Math.tan((45 * Math.PI) / 360) / aspect) * 180) / Math.PI); }

function resize(engine, w, h) {
  engine.width = w; engine.height = h;
  engine.renderer.setSize(w, h, false);
  engine.canvas.width = w; engine.canvas.height = h;
  const cam = engine.camera;
  cam.aspect = w / h;
  // a viewpoint keeps the still's framing; elsewhere the walking field of view
  const v = S.atShot ? viewpoint(engine, S.atShot) : null;
  cam.fov = v ? stillFov(v.fov ?? 40, cam.aspect) : fovFor(cam.aspect);
  cam.updateProjectionMatrix();
  engine.pipeline.setSize(w, h);
  if (engine.ink) applyLive(engine);
  engine.lighting.refreshCSM();
  S.dirty = 3;
}

function installTestHooks(engine, buildMs) {
  const W = S.walker;
  window.__explore = {
    teleport: (n) => { teleport(n); return true; },
    setLook: (id) => { setLook(id); return true; },
    mode: (m) => { W.setMode(m); return W.mode; },
    setPose: (pos, yawDeg = 0, pitchDeg = 0) => {
      engine.registry.vegetation?.sys?.farInvalidate?.();
      W.setPose(new THREE.Vector3(...pos), (yawDeg * Math.PI) / 180, (pitchDeg * Math.PI) / 180);
      if (W.mode === 'walk') {
        const f = W.nearestFree(pos[0], pos[2]) || pos;
        const g = W.groundAt(f[0], f[f.length - 1]);
        engine.camera.position.set(f[0], g + 1.6, f[f.length - 1]); W._apply();
      }
      S.dirty = 3; return true;
    },
    /** the live painting's quality step: tier('low' | 'high', scale) → { tier, scale } (no argument: the current one) */
    tier: (t, k) => {
      if (t) { const i = LIVE.steps.findIndex((s) => s.tier === t && (k === undefined || Math.abs(s.scale - k) < 1e-6)); if (i >= 0) { LIVE.i = i; LIVE.changed = performance.now(); applyLive(engine); S.dirty = 3; } }
      return { ...liveState(), steps: LIVE.steps.length };
    },
    /** build the buildings' middle levels round the camera now (src/explore/lodfade.js; normally while standing still) */
    mids: (n = 99) => { let k = 0; while (k < n && S.lodFade?.buildNext(engine.camera.position)) k++; S.lodFade?.update(engine.camera.position); S.dirty = 3; return k; },
    /** A/B: the walking rock shaders on / off (src/explore/rocklite.js) */
    rockLite: (on = true) => { if (on) S.rockLite?.live(); else S.rockLite?.still(); S.dirty = 3; return !!S.rockLite?.on; },
    /** which rock meshes wear the walking shader now: { on, lite, n } */
    rockState: () => (S.rockLite ? { on: S.rockLite.on, lite: S.rockLite.pairs.filter(([o, , l]) => o.material === l).length, n: S.rockLite.pairs.length } : null),
    /** turn the view by (dx, dy) degrees, as a mouse drag does (tools/capture-walk.mjs) */
    look: (dxDeg, dyDeg = 0) => { W.look((dxDeg * Math.PI) / 180, (dyDeg * Math.PI) / 180); return true; },
    /** the still view's phase: 'idle' (the live painting), 'prep', 'accum', 'fade', 'shown' */
    phase: () => S.still?.phase ?? null,
    /** keep the live painting (no still view) while measuring: noStill(true) … noStill(false) */
    noStill: (on = true) => { S.noStill = on; if (on) { S.leaveStill?.(); S.dirty = 3; } return on; },
    ground: (x, z) => ({ terrain: heightAt(x, z), deck: W.deckAt(x, z), free: W.free(x, z) }),
    /** the countryside (src/explore/fields.js): its counts, or the nearest plot of a kind ('paddy' | 'terrace' |
     *  'mulberry' | 'tea') to (x, z) → { x, z, y, rot, d } */
    country: (kind, x = 0, z = 0) => (kind ? S.country?.nearest(kind, x, z) : { ready: !!S.country?.ready, ...S.country?.stats, drawn: S.country?.drawn?.() }),
    /** the countryside's plan map over [x0, z0, x1, z1] (PNG data URL) */
    countryMap: (bounds, size) => S.country?.map(bounds, size),
    stats: () => ({
      buildMs, loadMs: window.__STATS?.loadMs, frame: S.frame, renderScale: engine.ink ? liveState().scale : AR.scale, tier: engine.ink ? liveState().tier : null, size: [engine.width, engine.height], look: S.look, place: S.place, mode: W.mode,
      pos: engine.camera.position.toArray().map((v) => +v.toFixed(2)), yaw: +((W.yaw * 180) / Math.PI).toFixed(1),
      terrain: engine.registry.terrain?.stream?.stats, scene: engine.pipeline.sceneInfo, veg: window.__STATS?.veg,
    }),
    /** hold keys for `seconds` (real frames), e.g. walk(['KeyW'], 2) */
    hold: async (codes, seconds) => { for (const c of codes) W.keys.add(c); await new Promise((r) => setTimeout(r, seconds * 1000)); for (const c of codes) W.keys.delete(c); return engine.camera.position.toArray(); },
    /** frame times over `seconds` while walking forward and turning slowly (forced redraw every frame) */
    fps: async (seconds = 4, { walk = true, turn = 0.25, run = false } = {}) => {
      const ft = [];
      let prev = performance.now(), on = true;
      const tick = (t) => { if (!on) return; ft.push(t - prev); prev = t; W.look(turn * (1 / 60), 0); S.dirty = 1; requestAnimationFrame(tick); };
      if (walk) W.keys.add('KeyW');
      W.run = run;
      requestAnimationFrame(tick);
      await new Promise((r) => setTimeout(r, seconds * 1000));
      on = false; W.keys.delete('KeyW'); W.run = false;
      ft.shift();
      const sorted = [...ft].sort((a, b) => a - b);
      const mean = ft.reduce((a, b) => a + b, 0) / ft.length;
      return { frames: ft.length, fps: +(1000 / mean).toFixed(1), meanMs: +mean.toFixed(1), p95Ms: +sorted[Math.floor(sorted.length * 0.95)].toFixed(1), maxMs: +sorted[sorted.length - 1].toFixed(1) };
    },
    /** CPU time per part of the frame (ms, mean and max) over `seconds` of walking */
    profile: async (seconds = 3, opts = {}) => {
      S.prof = [];
      const f = await window.__explore.fps(seconds, opts);
      const rows = S.prof; S.prof = null;
      const agg = {};
      for (const k of ['cpu', 'walk', 'terrain', 'place', 'render', 'vegMs', 'vegStep']) { const v = rows.map((r) => r[k] || 0); agg[k] = [+(v.reduce((a, b) => a + b, 0) / v.length).toFixed(1), +Math.max(...v).toFixed(1)]; }
      // the slowest frame intervals, each with the CPU parts of the frame that ran in it (the row before: dt is the
      // time since the previous frame began)
      const fix = (r) => r && Object.fromEntries(Object.entries(r).map(([k, v]) => [k, +(+v).toFixed(1)]));
      const slow = rows.map((r, i) => [r.dt, i]).sort((a, b) => b[0] - a[0]).slice(0, 5).map(([d, i]) => ({ dt: +d.toFixed(1), frame: fix(rows[i - 1]) }));
      return { ...f, cpu: agg, slow };
    },
    /** GPU cost of one live frame at the current pose (ms; frames rendered back to back, then a 1-pixel read of the
     *  last target waits for the GPU): { frame, scene (G-buffer + tone), paint } — the least of five runs (other work on
     *  a shared GPU only ever adds time) */
    cost: (n = 8) => {
      const ink = engine.ink, r = engine.renderer, px = new Uint8Array(4);
      if (!ink) return null;
      const time = (fn, rt) => { fn(); r.readRenderTargetPixels(rt(), 0, 0, 1, 1, px); const t0 = performance.now(); for (let i = 0; i < n; i++) fn(); r.readRenderTargetPixels(rt(), 0, 0, 1, 1, px); return (performance.now() - t0) / n; };
      const med = (fn, rt) => Math.min(time(fn, rt), time(fn, rt), time(fn, rt), time(fn, rt), time(fn, rt));
      const P0 = ink.painter, pp = P0.paint;
      const frame = med(() => ink.renderRealtime(), () => ink.liveRT);
      const scene = med(() => { P0.paint = () => {}; try { ink.renderRealtime(); } finally { P0.paint = pp; } }, () => ink.painter.toneRT);
      S.dirty = 3;
      return { frame: +frame.toFixed(1), scene: +scene.toFixed(1), paint: +(frame - scene).toFixed(1), calls: engine.pipeline.sceneInfo?.calls, mTris: +((engine.pipeline.sceneInfo?.triangles || 0) / 1e6).toFixed(2) };
    },
    /** wait until the still view is showing (after the camera stood still); { phase, ms (paint time), vp } */
    still: async (timeoutS = 60) => {
      const t0 = performance.now();
      // a teleport or a look just set: let its first frames run (they leave the previous still view)
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      if (!S.sv) {
        // no still view (?still=0): the live frame once the streamed terrain round the camera is in
        const st = engine.registry.terrain?.stream;
        while (st && !(st.plan?.done) && performance.now() - t0 < timeoutS * 1000) await new Promise((r) => setTimeout(r, 50));
        S.dirty = 3;
        await new Promise((r) => setTimeout(r, 300));
        return { phase: 'live' };
      }
      while (S.still?.phase !== 'shown' || S.dirty > 0) {
        if (performance.now() - t0 > timeoutS * 1000) return { phase: S.still?.phase };
        await new Promise((r) => setTimeout(r, 50));
      }
      return { phase: 'shown', ms: engine.ink.stillMs, vp: S.still.vp };
    },
    /** the canvas as a PNG data URL (the painting without the interface) */
    canvas: () => engine.canvas.toDataURL('image/png'),
    /** render now and wait for the GPU (for screenshots) */
    settle: async () => { S.dirty = 3; await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(r)))); return true; },
  };
}
