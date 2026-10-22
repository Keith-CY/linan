// Ink-wash mode (水墨): the same world and cameras rendered as a Chinese painting.
//   ?look=ink&inkStyle=qj      (mo 纯水墨 · qj 浅绛 (default) · ql 青绿)
//   node tools/render.mjs --shot 1 --params "look=ink&inkStyle=mo"
// Optional: inkGs=1|2 (G-buffer scale; default 2 up to 2K output, 1 above), inkDebug=tone|class|edges|depth|sun
//
// How it hooks in (the photoreal path is untouched when look≠ink):
//   * every scene material gets three extra MRT outputs (gbuffer.js), patched after engine.prepareScene();
//   * the accumulation runs as usual; pipeline.resolve() first grades the photoreal frame into an offscreen target
//     (the "tone" of the painting), renders one unjittered G-buffer pass, then paints (painter.js) to the canvas.
import * as THREE from 'three';
import { patchScene, makeGBuffer, renderGBuffer } from './gbuffer.js';
import { InkPainter } from './painter.js';
import * as STY from './styles.js';
import { applyStage, restoreStage } from './stage.js';
import { SHOTS } from '../world/shots.js';
import { SUN } from '../core/lighting.js';
import { GRADE } from '../core/pipeline.js';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

/** an 8-bit colour target for a finished painting (live or still view) */
function colorRT(w, h) {
  return new THREE.WebGLRenderTarget(w, h, {
    type: THREE.UnsignedByteType, format: THREE.RGBAFormat, colorSpace: THREE.LinearSRGBColorSpace,
    minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false, stencilBuffer: false, generateMipmaps: false,
  });
}

// the explorable world's last pass: FXAA on the live painting (its brush lines are drawn from a 1× G-buffer, so
// their edges step), upscaled to the canvas, and the still view faded in over it
const presentQuad = new FullScreenQuad(null);
const presentMat = new THREE.ShaderMaterial({
  uniforms: { tLive: { value: null }, tStill: { value: null }, uMix: { value: 0 }, uTexel: { value: new THREE.Vector2(1, 1) }, uFxaa: { value: 1 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
  fragmentShader: /* glsl */`
    uniform sampler2D tLive, tStill; uniform float uMix, uFxaa; uniform vec2 uTexel; varying vec2 vUv;
    float L(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }
    // FXAA 3.11 (console variant, after Lottes): one edge-direction blur, clamped to the local contrast
    vec3 fxaa(vec2 uv) {
      vec3 cM = texture2D(tLive, uv).rgb;
      vec3 cNW = texture2D(tLive, uv + vec2(-0.5, 0.5) * uTexel).rgb, cNE = texture2D(tLive, uv + vec2(0.5, 0.5) * uTexel).rgb;
      vec3 cSW = texture2D(tLive, uv + vec2(-0.5, -0.5) * uTexel).rgb, cSE = texture2D(tLive, uv + vec2(0.5, -0.5) * uTexel).rgb;
      float lM = L(cM), lNW = L(cNW), lNE = L(cNE), lSW = L(cSW), lSE = L(cSE);
      float lMin = min(lM, min(min(lNW, lNE), min(lSW, lSE))), lMax = max(lM, max(max(lNW, lNE), max(lSW, lSE)));
      if (lMax - lMin < max(0.08, lMax * 0.16)) return cM;   // the paper's grain and the washes stay untouched
      vec2 dir = vec2(-((lNW + lNE) - (lSW + lSE)), (lNW + lSW) - (lNE + lSE));
      float red = max((lNW + lNE + lSW + lSE) * 0.03125, 1.0 / 128.0);
      float rcp = 1.0 / (min(abs(dir.x), abs(dir.y)) + red);
      dir = clamp(dir * rcp, -1.25, 1.25) * uTexel;    // short spans: the steps of a brush line, not its texture
      vec3 a = 0.5 * (texture2D(tLive, uv - dir / 6.0).rgb + texture2D(tLive, uv + dir / 6.0).rgb);
      vec3 b = 0.5 * a + 0.25 * (texture2D(tLive, uv - dir * 0.5).rgb + texture2D(tLive, uv + dir * 0.5).rgb);
      float lb = L(b);
      return (lb < lMin || lb > lMax) ? a : b;
    }
    void main() {
      vec3 live = uMix >= 1.0 ? vec3(0.0) : (uFxaa > 0.5 ? fxaa(vUv) : texture2D(tLive, vUv).rgb);
      vec3 still = uMix > 0.0 ? texture2D(tStill, vUv).rgb : vec3(0.0);
      gl_FragColor = vec4(mix(live, still, uMix), 1.0);
    }`,
  depthTest: false, depthWrite: false,
});

export function installInk(engine) {
  const P = engine.params;
  // styles / painter are live bindings that a dev session can swap (window.__inkHot) without rebuilding the world
  let S = STY;
  const styleName = S.STYLES[P.get('inkStyle')] ? P.get('inkStyle') : 'qj';
  const style = { ...S.STYLES[styleName] };
  const gs = Number(P.get('inkGs')) || (engine.width > 2000 ? 1 : 2);
  const pipe = engine.pipeline;
  const painter = new InkPainter(engine.renderer, engine.width, engine.height, gs);
  const gbuf = makeGBuffer(Math.round(engine.width * gs), Math.round(engine.height * gs));
  const ink = { style, styleName, painter, gbuf, gs, stats: {} };
  void painter;
  engine.ink = ink;
  window.__ink = { engine, THREE };   // session tools: picking world points for foci and cameras
  // session hook: switch the style without rebuilding the world
  window.__inkStyle = (name) => { if (!S.STYLES[name]) return false; Object.assign(style, S.STYLES[name]); ink.styleName = name; return true; };
  // dev: re-import painter.js and styles.js (glsl.js / gbuffer.js changes still need a reload)
  window.__inkHot = async () => {
    const v = Date.now();
    S = await import(`./styles.js?v=${v}`);
    const { InkPainter: IP } = await import(`./painter.js?v=${v}`);
    const old = ink.painter;
    ink.painter = new IP(engine.renderer, engine.width, engine.height, gs);
    for (const k in old) if (old[k]?.isWebGLRenderTarget || old[k]?.isShaderMaterial) old[k].dispose();
    Object.assign(style, S.STYLES[ink.styleName]);
    return true;
  };
  console.log(`[ink] style ${styleName}, G-buffer ${gbuf.width}x${gbuf.height}`);

  // ink cameras: the same places recomposed as paintings. Applied when a shot arrives with its photoreal camera
  // unchanged (a session --set with its own pos / target / fov is taken as given); ?inkCam=0 keeps the photo cameras
  const applyShot = engine.applyShot.bind(engine);
  const same = (a, b) => a && b && a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) < 1e-6);
  engine.applyShot = (s) => {
    const base = SHOTS.find((x) => x.id === s.id);
    const ic = S.INK_CAMS[s.id];
    const inkCam = ic && base && P.get('inkCam') !== '0' && same(s.pos, base.pos) && same(s.target, base.target) && s.fov === base.fov;
    if (inkCam) s = { ...s, ...ic };
    // no depth of field in a painting: every form is drawn sharp
    const r = applyShot(s.dof ? { ...s, dof: null } : s);
    // the shot's ink stage (src/ink/stage.js): offline stills only (the explorable world stages its still view itself);
    // a session render with its own camera asks for it with { stage: true }
    if (!engine.explore) { if (inkCam || s.stage) applyStage(engine, s.id, S.INK_STAGE); else restoreStage(); }
    return r;
  };
  // the smoke plumes stay out of the photographic tone in the match look: the painter lays them as wisps of paper from
  // their own density (painter.renderSmoke); in the tone they were a grey veil that the washes turned into dark blots
  const sample = engine.renderSample.bind(engine);
  engine.renderSample = (...a) => {
    findSmoke();
    const sm = ink.smokeMeshes || [];
    const m = { ...S.inkShot(engine.shot?.id), ...(engine.shot?.ink || {}) }.match;
    const hid = m ? sm.filter((o) => o.visible) : [];
    for (const o of hid) o.visible = false;
    try { return sample(...a); } finally { for (const o of hid) o.visible = true; }
  };
  const prep = engine.prepareScene.bind(engine);
  engine.prepareScene = () => { prep(); patchScene(engine); };
  const ens = engine.ensurePatched.bind(engine);
  engine.ensurePatched = () => { ens(); patchScene(engine); };

  const findSmoke = () => {
    if (ink.smokeMeshes && ink.smokeN === engine.scene.children.length) return;
    ink.smokeMeshes = []; ink.smokeN = engine.scene.children.length;
    engine.scene.traverse((o) => { if (o.isMesh && o.material?.name === 'citySmoke') ink.smokeMeshes.push(o); });
  };
  ink.findSmoke = findSmoke;
  const resolve = pipe.resolve.bind(pipe);
  const timing = P.get('inkTime') === '1';
  const gl = engine.renderer.getContext();
  // gReady: the G-buffer was rendered already this frame (realtime path, renderRealtime below)
  // o.painter / o.gbuf: another painter and G-buffer (the explorable world's still view, renderStill below);
  // o.offline: the shot's own ink settings even in the explorable world (a still at one of the ten viewpoints)
  const paintFrame = (target = null, frame = 0, gReady = false, o = {}) => {
    if (timing) gl.finish();
    const t0 = performance.now();
    const painter = o.painter || ink.painter, gb = o.gbuf || gbuf;
    // the photographic frame, graded, without grain or vignette: the painting's tone
    const grain = GRADE.uGrain.value, vig = GRADE.uVignette.value.clone?.() ?? GRADE.uVignette.value;
    GRADE.uGrain.value = 0;
    if (GRADE.uVignette.value.set) GRADE.uVignette.value.set(0, 1);
    resolve(painter.toneRT, frame);
    GRADE.uGrain.value = grain;
    if (GRADE.uVignette.value.copy && vig.isVector2) GRADE.uVignette.value.copy(vig);
    if (!gReady) { patchScene(engine); renderGBuffer(engine, gb); }
    const id = engine.shot?.id;
    const ex = o.offline ? null : ink.explore;   // the explorable world: ink settings, mist distances and lattice axes from the walking camera
    const shot = ex ? ex.shot(id) : { ...S.inkShot(id), ...(engine.shot?.ink || {}) };
    const sunI = SUN.color.r * 0.2126 * SUN.intensity + SUN.color.g * 0.7152 * SUN.intensity + SUN.color.b * 0.0722 * SUN.intensity;
    const dbg = P.get('inkDebug');
    if (dbg && !dbg.startsWith('paint')) { debugView(engine, { ...ink, painter, gbuf: gb }, dbg, target); return; }
    // the shot's own horizontal axes (not the moving camera's): lattices on hills and water stay put in video
    const sp = ex ? engine.camera.position.toArray() : engine.shot?.pos || [0, 0, 0], st = ex ? [sp[0] + ex.axis[0], sp[1], sp[2] + ex.axis[1]] : engine.shot?.target || [0, 0, -1];
    const axisF = new THREE.Vector3(st[0] - sp[0], 0, st[2] - sp[2]).normalize();
    const axisR = new THREE.Vector3(-axisF.z, 0, axisF.x);
    // the foci (world points) projected into this frame
    let focus = (shot.focus || []).map(([x, y, z, r, lo]) => {
      const v = new THREE.Vector3(x, y, z).project(engine.camera);
      return [v.x * 0.5 + 0.5, v.y * 0.5 + 0.5, v.z < 1 ? r : 0, lo ?? 0.25];
    });
    // the walking camera with no focus in front: the floor of ink everywhere (not the full density of a focus)
    if (ex && !focus.some((f) => f[2] > 0)) focus = [[0.5, 0.5, 1e-4, ex.floor ?? 0.45]];
    // smoke plumes: their density, for the painter's wisps (the G-buffer leaves the veils out)
    findSmoke();
    painter.renderSmoke(shot.match ? ink.smokeMeshes : null, engine.camera);
    // the lattices' anchor: the shot's camera (a still), or the camera the walking world last applied its look at (fixed
    // while walking: engine.shot.pos), so the ripple rows and ground strokes do not slide with the walker
    const anchor = engine.shot?.pos || sp;
    const boreFront = shot.match ? engine.registry.tide?.inkFront?.() : null;
    painter.paint(gb, engine.camera, style, shot, { focus, shotPos: sp, anchor, boreFront, sunI, sunDir: SUN.dir, axisR, axisF, dbg: dbg && dbg.startsWith('paint') ? Number(dbg.slice(5)) || 0 : 0 }, target);
    if (timing) gl.finish();
    ink.stats.inkMs = Math.round(performance.now() - t0);
    window.__STATS = { ...(window.__STATS || {}), inkMs: ink.stats.inkMs };
  };
  pipe.resolve = (target = null, frame = 0) => paintFrame(target, frame, false);
  // realtime frame (src/explore): ONE scene pass into the G-buffer whose colour attachment is the photographic frame
  // (unjittered, no MSAA: the painting blurs its tone anyway), shadows updated in that pass, then grade + paint
  let rtFrame = 0;
  ink.renderRealtime = () => {
    const t0 = performance.now();
    patchScene(engine);
    engine.lighting.update(null);
    const t1 = performance.now();
    renderGBuffer(engine, gbuf, { shadows: true });
    const t2 = performance.now();
    pipe.hdrOverride = gbuf.textures[0];
    pipe.realtime = true;
    ink.painter.cachePaper = true;
    const P0 = ink.painter;
    if (!ink.liveRT || ink.liveRT.width !== P0.w || ink.liveRT.height !== P0.h) { ink.liveRT?.dispose(); ink.liveRT = colorRT(P0.w, P0.h); }
    paintFrame(ink.liveRT, ++rtFrame, true);
    pipe.hdrOverride = null;
    ink.rtTimes = { prep: t1 - t0, scene: t2 - t1, paint: performance.now() - t2 };
  };
  // the explorable world's still view: exactly the offline still (src/core/engine.js renderStill at one sample, which
  // the stills use: the accumulation and MSAA change < 0.5 / 255) — the photographic frame graded with every effect,
  // the G-buffer at twice the resolution, every painter pass at full strength. Painted into ink.stillRT.
  // Accumulated like the stills (12 jittered samples with the sun-disk soft shadows, quality 'high'), one or more
  // samples per call so the page stays responsive: stillBegin(), stillStep(n) until it returns true, stillPaint().
  const STILL_SPP = Number(P.get('stillSpp')) || 12;
  ink.stillBegin = () => {
    const W = engine.width, H = engine.height;
    if (!ink.stillPainter) ink.stillPainter = new InkPainter(engine.renderer, W, H, 2);
    else if (ink.stillPainter.w !== W || ink.stillPainter.h !== H) ink.stillPainter.resize(W, H, 2);
    if (!ink.stillG) ink.stillG = makeGBuffer(W * 2, H * 2);
    else if (ink.stillG.width !== W * 2 || ink.stillG.height !== H * 2) ink.stillG.setSize(W * 2, H * 2);
    if (!ink.stillRT || ink.stillRT.width !== W || ink.stillRT.height !== H) { ink.stillRT?.dispose(); ink.stillRT = colorRT(W, H); }
    patchScene(engine);
    engine.ensurePatched();
    pipe.begin();
    ink.stillI = 0; ink.stillT = 0;
  };
  /** n more samples; true when all are in */
  ink.stillStep = (n = 1) => {
    const t0 = performance.now();
    const lights = engine.lighting.csm.lights, rad = lights.map((l) => l.shadow.radius);
    lights.forEach((l) => { l.shadow.radius = STILL_SPP > 1 ? 0 : rad[0]; });
    pipe.hdrOverride = null;
    for (let k = 0; k < n && ink.stillI < STILL_SPP; k++, ink.stillI++) engine.renderSample(ink.stillI, { jitter: STILL_SPP > 1, softShadows: STILL_SPP > 1 });
    lights.forEach((l, i) => { l.shadow.radius = rad[i]; });
    ink.stillT += performance.now() - t0;
    return ink.stillI >= STILL_SPP;
  };
  ink.stillPaint = ({ offline = false } = {}) => {
    const t0 = performance.now();
    pipe.hdrOverride = null;
    pipe.realtime = false;
    const q = pipe.quality;
    pipe.quality = { ...q, bloom: true };
    paintFrame(ink.stillRT, 0, false, { painter: ink.stillPainter, gbuf: ink.stillG, offline });
    pipe.quality = q;
    pipe.realtime = true;
    ink.stillMs = Math.round(ink.stillT + performance.now() - t0);
    return ink.stillRT;
  };
  ink.renderStill = (o = {}) => { ink.stillBegin(); while (!ink.stillStep(STILL_SPP)); return ink.stillPaint(o); };
  // to the canvas: the live painting (FXAA, upscaled from the adaptive render scale), the still view over it (mix)
  ink.present = (mix = 0) => {
    const U = presentMat.uniforms;
    U.tLive.value = ink.liveRT?.texture || null; U.tStill.value = ink.stillRT?.texture || null;
    U.uMix.value = ink.liveRT ? (ink.stillRT ? mix : 0) : 1;
    if (ink.liveRT) U.uTexel.value.set(1 / ink.liveRT.width, 1 / ink.liveRT.height);
    U.uFxaa.value = P.get('fxaa') === '0' ? 0 : 1;
    presentQuad.material = presentMat;
    engine.renderer.setRenderTarget(null);
    presentQuad.render(engine.renderer);
  };
  ink.resize = (w, h) => {
    ink.painter.resize(w, h, gs);
    gbuf.setSize(Math.round(w * gs), Math.round(h * gs));
  };
  return ink;
}

// ------------------------------------------------------------------ debug views (?inkDebug=…)
let dbgMat = null;
function debugView(engine, ink, mode, target) {
  const { FullScreenQuad } = ink.painter.quad.constructor ? { FullScreenQuad: ink.painter.quad.constructor } : {};
  dbgMat ||= new THREE.ShaderMaterial({
    uniforms: { tA: { value: null }, tB: { value: null }, tTone: { value: null }, tEdge: { value: null }, uMode: { value: 0 } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: /* glsl */`
      uniform sampler2D tA, tB, tTone, tEdge; uniform float uMode; varying vec2 vUv;
      vec3 pal(float c) { return 0.5 + 0.5 * cos(6.2831 * (c * 0.137 + vec3(0.0, 0.33, 0.67))); }
      void main() {
        vec4 a = texture2D(tA, vUv), b = texture2D(tB, vUv);
        vec3 c;
        if (uMode < 0.5) c = texture2D(tTone, vUv).rgb;
        else if (uMode < 1.5) c = a.w < 0.5 ? vec3(1.0) : pal(a.w);
        else if (uMode < 2.5) c = vec3(1.0 - texture2D(tEdge, vUv).x);
        else if (uMode < 3.5) c = vec3(log2(a.z) / 16.0);
        else c = vec3(b.x / 10.0, b.y / 3.0, b.z);
        gl_FragColor = vec4(c, 1.0);
      }`,
    depthTest: false, depthWrite: false,
  });
  const p = ink.painter;
  // edges need the edge pass
  p.edgeMat.uniforms.tA.value = ink.gbuf.textures[1]; p.edgeMat.uniforms.tB.value = ink.gbuf.textures[2];
  const fovR = (engine.camera.fov * Math.PI) / 180;
  const U = p.edgeMat.uniforms;
  U.uRes.value.set(p.w, p.h); U.uGRes.value.set(p.gw, p.gh); U.uGs.value = p.gs; U.uK.value = p.w / 1664; U.uPxA.value = (2 * Math.tan(fovR / 2)) / p.h;
  const shot = STY.inkShot(engine.shot?.id);
  U.uLine.value.set(shot.near, shot.far, 1, 0);
  p._pass(p.edgeMat, p.edgeRT);
  dbgMat.uniforms.tA.value = ink.gbuf.textures[1];
  dbgMat.uniforms.tB.value = ink.gbuf.textures[2];
  dbgMat.uniforms.tTone.value = p.toneRT.texture;
  dbgMat.uniforms.tEdge.value = p.edgeRT.texture;
  dbgMat.uniforms.uMode.value = { tone: 0, class: 1, edges: 2, depth: 3, sun: 4 }[mode] ?? 0;
  p._pass(dbgMat, target);
  void FullScreenQuad;
}
