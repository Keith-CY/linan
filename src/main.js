// Entry point.
//   Explore:      http://localhost:8080/   (default; = ?mode=explore) walk / fly through the world in real time, ink painting
//                 by default (look=ink&inkStyle=mo), ?look=photo for the photographic render. src/explore/
//   Interactive:  http://localhost:8080/?shot=1&quality=preview      (orbit with mouse; keys 1-9 jump to shots 1-9, 0 to shot 10; P prints camera)
//   Offline:      driven by tools/render.mjs (mode=still) which calls window.__renderShot(id)
//   Module test:  ?test=yingzao&view=0   renders src/modules/yingzao.js test() in a neutral scene
import * as THREE from 'three';
import { createEngine } from './core/engine.js';
import { getQuality } from './core/quality.js';
import { SHOTS } from './world/shots.js';

const P = new URLSearchParams(location.search);

async function boot() {
  // no mode, shot or test on the URL: the explorable world
  const mode = P.get('mode') || (P.get('shot') || P.get('test') ? 'interactive' : 'explore');
  const explore = mode === 'explore';
  if (explore) {
    // ink 纯水墨 by default; ?look=photo keeps the photographic render
    if (!P.has('look')) P.set('look', 'ink');
    if (!P.has('inkStyle')) P.set('inkStyle', 'mo');
    if (!P.has('inkGs')) P.set('inkGs', '1');
  }
  const quality = getQuality(P.get('quality') || (explore ? 'explore' : 'preview'));
  if (P.get('spp')) quality.spp = Number(P.get('spp'));
  // world density / geometric detail overrides (?density=1&detail=1: the stills' world in the explorable one)
  for (const k of ['density', 'detail', 'cascades', 'shadowMapSize', 'shadowMaxFar', 'msaa']) if (P.get(k)) quality[k] = Number(P.get(k));
  const live = mode === 'interactive' || explore;
  const scale = Number(P.get('scale')) || 1;
  const W = Number(P.get('w')) || (live ? Math.round(innerWidth * Math.min(devicePixelRatio, 1) * scale) : 1664);
  const H = Number(P.get('h')) || (live ? Math.round(innerHeight * Math.min(devicePixelRatio, 1) * scale) : 928);
  if (live) document.body.classList.add('interactive');
  if (explore) document.body.classList.add('explore');

  const engine = await createEngine({ width: W, height: H, quality, params: P });
  window.engine = engine;
  let ex = null;
  if (explore) {
    // the start viewpoint and look before anything builds (the streamed terrain plans around this camera)
    ex = await import('./explore/index.js');
    ex.prepareExplore(engine);
  }
  // ink-wash mode (水墨): ?look=ink&inkStyle=mo|qj|ql (src/ink/index.js); the photoreal path is untouched otherwise
  if (P.get('look') === 'ink') { const { installInk } = await import('./ink/index.js'); installInk(engine); }
  const t0 = performance.now();

  let testInfo = null;
  if (P.get('test')) {
    const { buildTestScene } = await import('./test/testScene.js');
    testInfo = await buildTestScene(engine, P.get('test'), Number(P.get('view') || 0));
  } else {
    const { buildWorld } = await import('./world/index.js');
    await buildWorld(engine);
  }
  if (ex) await ex.afterBuild(engine);
  engine.prepareScene();
  const buildMs = Math.round(performance.now() - t0);
  window.__STATS = { buildMs };
  console.log(`[main] world built in ${buildMs} ms`);
  if (!explore) document.getElementById('loading')?.remove();

  const shotById = (id) => SHOTS.find((s) => String(s.id) === String(id));

  window.__renderShot = async (id) => {
    const s = shotById(id);
    if (!s) throw new Error('unknown shot ' + id);
    engine.applyShot(s);
    return await engine.renderStill(quality.spp);
  };
  // used by tools/session.mjs (persistent render session for camera direction / look-dev)
  window.__SHOTS = SHOTS;
  window.__renderShotObj = async (s, spp) => {
    engine.applyShot(s);
    return await engine.renderStill(spp ?? quality.spp);
  };
  // GPU profiler: time per sample with each module hidden in turn (tools/session.mjs + snap --eval)
  window.__profile = async (shotId, spp = 2) => {
    engine.applyShot(shotById(shotId));
    const time = async () => { await engine.renderStill(spp); return engine.stats.renderMs / spp; };
    await time(); // warm-up (lazy shader compiles)
    const base = await time();
    const rows = [];
    const tris = (objs) => { let t = 0; for (const o of objs) o.traverse((m) => { if (!m.isMesh || !m.geometry) return; const g = m.geometry; const n = (g.index ? g.index.count : g.attributes.position?.count || 0) / 3; t += n * (m.isInstancedMesh ? m.count : 1); }); return t; };
    for (const [name, roots] of Object.entries(engine.moduleRoots || {})) {
      const vis = roots.map((r) => r.visible);
      roots.forEach((r) => (r.visible = false));
      const ms = await time();
      roots.forEach((r, i) => (r.visible = vis[i]));
      rows.push({ module: name, msSaved: Math.round(base - ms), mTris: +(tris(roots) / 1e6).toFixed(2), objects: roots.length });
    }
    rows.sort((a, b) => b.msSaved - a.msSaved);
    return { shot: shotId, msPerSample: Math.round(base), calls: engine.stats.calls, mTrisDrawn: +((engine.stats.triangles || 0) / 1e6).toFixed(1), rows };
  };
  // video frame renderer (tools/render-video.mjs)
  if (!P.get('test')) { const { setupVideo } = await import('./video/player.js'); setupVideo(engine, SHOTS); }
  window.__renderTest = async () => {
    engine.applyShot(testInfo.shot);
    return await engine.renderStill(quality.spp);
  };
  // compile everything up front so the first sample isn't a hitch
  if (explore) ex.applyStart(engine);
  else if (!P.get('test')) engine.applyShot(shotById(P.get('shot') || 1) || SHOTS[0]);
  else engine.applyShot(testInfo.shot);
  const tc = performance.now();
  engine.onProgress?.(1, 'shaders');
  await engine.renderer.compileAsync(engine.scene, engine.camera);
  console.log(`[main] shaders compiled in ${Math.round(performance.now() - tc)} ms`);
  window.__STATS.loadMs = Math.round(performance.now());   // since navigation start

  if (explore) await ex.startExplore(engine, { buildMs });
  window.__READY = true;
  if (mode === 'interactive') startInteractive(engine, shotById);
}

async function startInteractive(engine, shotById) {
  const { OrbitControls } = await import('three/addons/controls/OrbitControls.js');
  const cam = engine.camera;
  const controls = new OrbitControls(cam, engine.canvas);
  const syncTarget = () => {
    const s = engine.shot;
    if (s) controls.target.set(...s.target);
    controls.update();
  };
  syncTarget();
  let moving = true;
  controls.addEventListener('change', () => { moving = true; });
  const hud = document.createElement('div'); hud.id = 'hud'; document.body.appendChild(hud);
  addEventListener('keydown', (e) => {
    if (e.key >= '0' && e.key <= '9') { const s = shotById(e.key === '0' ? '10' : e.key); if (s) { engine.applyShot(s); syncTarget(); moving = true; } }
    if (e.key === 'p' || e.key === 'P') {
      const p = cam.position, t = controls.target;
      const txt = JSON.stringify({ pos: [p.x, p.y, p.z].map((v) => +v.toFixed(1)), target: [t.x, t.y, t.z].map((v) => +v.toFixed(1)), fov: cam.fov });
      console.log(txt); navigator.clipboard?.writeText(txt).catch(() => {});
    }
  });
  const clock = new THREE.Clock();
  let animate = P.get('animate') === '1';
  const loop = () => {
    requestAnimationFrame(loop);
    if (animate) { engine.setTime(engine.time + clock.getDelta()); moving = true; }
    if (moving) engine.lighting.refreshCSM();
    engine.renderInteractive(moving);
    moving = false;
    const p = cam.position;
    hud.textContent = `shot ${engine.shot?.id ?? '-'}  quality ${engine.quality.name}  samples ${engine._accFrames}\n` +
      `cam ${p.x.toFixed(0)} ${p.y.toFixed(0)} ${p.z.toFixed(0)}  fov ${cam.fov}\n` +
      `calls ${engine.renderer.info.render.calls}  tris ${(engine.renderer.info.render.triangles / 1e6).toFixed(2)}M\n` +
      `keys: 1-9, 0 = 10 shots · P copy camera · ?animate=1 for motion`;
  };
  loop();
}

boot().catch((e) => {
  console.error(e);
  window.__RENDER_ERROR = (e && (e.stack || e.message)) || String(e);
});
