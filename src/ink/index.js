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
  // (the walking painting measures the origins from its moving camera: in 32-bit floats, src/ink/gbuffer.js)
  const gbuf = makeGBuffer(Math.round(engine.width * gs), Math.round(engine.height * gs), { origins32: !!engine.explore });
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
    // ink.anchor: the point the G-buffer measures the objects' origins from (a moving camera's video: fixed per segment)
    if (!gReady) { patchScene(engine); renderGBuffer(engine, gb, { anchor: ink.anchor }); }
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
    // ink.prevVP: the tour video's camera a frame earlier (src/video/player.js; how far the ground travels in a frame)
    painter.paint(gb, engine.camera, style, shot, { focus, shotPos: sp, anchor, org: gReady ? null : ink.anchor, motion: gReady || !!ink.motion, prevVP: gReady ? null : ink.prevVP, boreFront, sunI, sunDir: SUN.dir, axisR, axisF, dbg: dbg && dbg.startsWith('paint') ? Number(dbg.slice(5)) || 0 : 0 }, target);
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
    engine.lighting.update(null, false);   // (one frame, nothing accumulated: the noise offsets stay put)
    const t1 = performance.now();
    renderGBuffer(engine, gbuf, { shadows: true });
    const t2 = performance.now();
    pipe.hdrOverride = gbuf.textures[0];
    pipe.realtime = true;
    ink.painter.cachePaper = true;
    const P0 = ink.painter;
    if (!ink.rawRT || ink.rawRT.width !== P0.w || ink.rawRT.height !== P0.h) {
      ink.rawRT?.dispose(); ink.rawRT = colorRT(P0.w, P0.h);
      for (const r of ink.taaRTs || []) r.dispose();
      ink.taaOut?.dispose(); ink.taaMid?.dispose();
      ink.taaRTs = [taaRT(P0.w, P0.h), taaRT(P0.w, P0.h)]; ink.taaOut = colorRT(P0.w, P0.h); ink.taaMid = taaRT(P0.w, P0.h); ink.taaValid = false;
    }
    paintFrame(ink.rawRT, ++rtFrame, true);
    pipe.hdrOverride = null;
    // the painting's own temporal anti-aliasing (below; ?taa=0 turns it off): the previous paintings, reprojected through
    // the G-buffer's depth to where their strokes now lie, blended in under a clamp to this frame's neighbourhood
    if (P.get('taa') === '0') ink.liveRT = ink.rawRT;
    else ink.liveRT = temporalAA(engine, ink, gbuf);
    ink.rtTimes = { prep: t1 - t0, scene: t2 - t1, paint: performance.now() - t2 };
  };
  /** the next live painting starts the history afresh (a teleport, a new look, the still view left) */
  ink.resetHistory = () => { ink.taaValid = false; };
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
  // the still view's targets (its painter at twice the G-buffer size, its G-buffer, its painting: ~400 MB of GPU
  // memory at 1440 × 900) given back while the walker walks on; stillBegin makes them again
  ink.releaseStill = () => {
    if (!ink.stillPainter || !ink.stillPainter.w) return false;
    for (const k of ['toneRT', 'edgeRT', 'jfa0', 'jfa1', 'ridgeRT', 'half0', 'half1', 'q0', 'e0', 'e1', 'l0', 'l1', 'lq', 'le0', 'le1', 'paperRT', 'smokeRT']) ink.stillPainter[k]?.dispose();
    ink.stillPainter.w = 0;                 // (stillBegin resizes it, which makes its targets again)
    ink.stillG?.dispose(); ink.stillRT?.dispose();
    return true;
  };
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

// ------------------------------------------------------------------ the live painting's temporal anti-aliasing
// One painting a frame from a one-sample G-buffer: its marks over sub-pixel detail (leaf dots, slab joints, the lines of
// the roofs and the trunks) step and shimmer from one frame to the next as the walker moves. Each frame is blended with
// the previous ones, reprojected to where the world put them (every pixel's world point from the G-buffer's depth,
// projected with the previous camera), so the blend follows the strokes on the world, not the screen:
//   * the blend is of the ink alone: the painting divided by the paper (fixed to the sheet, src/ink/painter.js
//     paperRT), and the result laid on this frame's paper again, so the paper's grain stays crisp while the ink moves;
//   * the history is read with a Catmull-Rom filter (bilinear reads would soften it a little every frame), kept at
//     TAA_KEEP and clamped to the range of this frame's 3 × 3 neighbourhood widened by TAA_LOOSE times its own width
//     (the world stands still while walking, so what the reprojected history disagrees on is mostly the painting's own
//     view-dependent marks, which it is there to average; clamped to the bare range it kept almost none of them);
//   * a history pixel whose depth was not this point's (it lay behind something, or off the frame) is not used.
// ?taa=0 turns it off (?taaKeep, ?taaLoose: other settings).
const TAA_KEEP = 0.9, TAA_LOOSE = 3;
const taaQuad = new FullScreenQuad(null);
const taaMat = new THREE.ShaderMaterial({
  glslVersion: THREE.GLSL3,
  uniforms: {
    tCur: { value: null }, tHist: { value: null }, tA: { value: null }, tPaper: { value: null }, uPaperOn: { value: 0 },
    uGRes: { value: new THREE.Vector2(1, 1) }, uRes: { value: new THREE.Vector2(1, 1) },
    uInvProj: { value: new THREE.Matrix4() }, uCamWorld: { value: new THREE.Matrix4() }, uPrevVP: { value: new THREE.Matrix4() }, uKeep: { value: TAA_KEEP }, uLoose: { value: 0 },
  },
  vertexShader: 'out vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
  fragmentShader: /* glsl */`
    precision highp float;
    uniform sampler2D tCur, tHist, tA, tPaper; uniform float uPaperOn, uKeep, uLoose;
    uniform vec2 uGRes, uRes; uniform mat4 uInvProj, uCamWorld, uPrevVP;
    in vec2 vUv;
    out vec4 oHist;
    // the ink of a pixel: the painting over the paper (the paper alone is 1)
    vec3 inkAt(ivec2 p) {
      p = clamp(p, ivec2(0), ivec2(uRes) - 1);
      vec3 c = texelFetch(tCur, p, 0).rgb;
      return uPaperOn > 0.5 ? c / max(texelFetch(tPaper, p, 0).rgb, vec3(0.05)) : c;
    }
    // Catmull-Rom from 9 bilinear reads (after Jimenez / Pettineo)
    vec3 histCR(vec2 uv) {
      vec2 sp = uv * uRes, t1 = floor(sp - 0.5) + 0.5, f = sp - t1;
      vec2 w0 = f * (-0.5 + f * (1.0 - 0.5 * f)), w1 = 1.0 + f * f * (-2.5 + 1.5 * f), w2 = f * (0.5 + f * (2.0 - 1.5 * f)), w3 = f * f * (-0.5 + 0.5 * f);
      vec2 w12 = w1 + w2, t0 = (t1 - 1.0) / uRes, t3 = (t1 + 2.0) / uRes, t12 = (t1 + w2 / w12) / uRes;
      return texture(tHist, vec2(t0.x, t0.y)).rgb * w0.x * w0.y + texture(tHist, vec2(t12.x, t0.y)).rgb * w12.x * w0.y + texture(tHist, vec2(t3.x, t0.y)).rgb * w3.x * w0.y
           + texture(tHist, vec2(t0.x, t12.y)).rgb * w0.x * w12.y + texture(tHist, vec2(t12.x, t12.y)).rgb * w12.x * w12.y + texture(tHist, vec2(t3.x, t12.y)).rgb * w3.x * w12.y
           + texture(tHist, vec2(t0.x, t3.y)).rgb * w0.x * w3.y + texture(tHist, vec2(t12.x, t3.y)).rgb * w12.x * w3.y + texture(tHist, vec2(t3.x, t3.y)).rgb * w3.x * w3.y;
    }
    void main() {
      ivec2 p = ivec2(gl_FragCoord.xy);
      vec3 c = inkAt(p);
      float D = texelFetch(tA, clamp(ivec2(vUv * uGRes), ivec2(0), ivec2(uGRes) - 1), 0).z;
      float keep = 0.0;
      vec3 h = c;
      if (uKeep > 0.0) {
        // this pixel's world point → where it was in the previous frame, and how far from that camera
        vec4 v = uInvProj * vec4(vUv * 2.0 - 1.0, 1.0, 1.0); vec3 r = v.xyz / v.w;
        vec3 Pw = (uCamWorld * vec4(r * (min(D, 40000.0) / -r.z), 1.0)).xyz;
        vec4 q = uPrevVP * vec4(Pw, 1.0);
        vec2 pv = q.xy / q.w * 0.5 + 0.5;
        if (q.w > 0.0 && all(greaterThanEqual(pv, vec2(0.0))) && all(lessThanEqual(pv, vec2(1.0)))) {
          // the history's own depths round there (the four texels the read spans): this surface, or one that stood
          // in front of this point then
          ivec2 hp = ivec2(floor(pv * uRes - 0.5)), hm = ivec2(uRes) - 1;
          float d0 = texelFetch(tHist, clamp(hp, ivec2(0), hm), 0).a, d1 = texelFetch(tHist, clamp(hp + ivec2(1, 0), ivec2(0), hm), 0).a;
          float d2 = texelFetch(tHist, clamp(hp + ivec2(0, 1), ivec2(0), hm), 0).a, d3 = texelFetch(tHist, clamp(hp + ivec2(1, 1), ivec2(0), hm), 0).a;
          float dn = min(min(d0, d1), min(d2, d3)), dx = max(max(d0, d1), max(d2, d3));
          bool same = D >= 40000.0 ? dn >= 40000.0 : q.w >= dn * 0.97 - 0.05 && q.w <= dx * 1.03 + 0.05;
          if (same) {
            vec3 mn = c, mx = c;
            for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
              if (i == 0 && j == 0) continue;
              vec3 n = inkAt(p + ivec2(i, j));
              mn = min(mn, n); mx = max(mx, n);
            }
            vec3 ex = (mx - mn) * uLoose + uLoose * 0.1;
            h = clamp(histCR(pv), mn - ex, mx + ex);
            keep = uKeep;
          }
        }
      }
      oHist = vec4(mix(c, h, keep), min(D, 40000.0));
    }`,
  depthTest: false, depthWrite: false,
});
// this frame's paper under the blended ink → the live painting (8 bits, what ink.present shows). The ink is blurred
// along each pixel's travel on the screen since the last frame (from the G-buffer's depth and the previous camera): a
// tent over the travel of TAA_BLUR frames each way, as a film camera's exposure would (a tent of one frame each way is
// nought at the next frame's place: a line still showed in a single frame). A mark that slides by more than
// its own width between two frames (the slab joints and the shadows under the walker's feet, the roof tiles below a
// flight, the leaves going by) otherwise lies in a pixel in one frame and is gone in the next: every fine mark pops.
// Standing still nothing moves and nothing is blurred. ?mblur=0 turns it off, ?mblur=k sets TAA_BLUR.
const TAA_BLUR = 1.75, TAA_TAPS = 16;
const taaOutMat = new THREE.ShaderMaterial({
  glslVersion: THREE.GLSL3,
  uniforms: {
    tHist: { value: null }, tPaper: { value: null }, uPaperOn: { value: 0 }, tA: { value: null },
    uGRes: { value: new THREE.Vector2(1, 1) }, uRes: { value: new THREE.Vector2(1, 1) },
    uInvProj: { value: new THREE.Matrix4() }, uCamWorld: { value: new THREE.Matrix4() }, uPrevVP: { value: new THREE.Matrix4() }, uBlur: { value: TAA_BLUR }, uPass: { value: 1 },
  },
  vertexShader: 'out vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
  fragmentShader: /* glsl */`
    precision highp float;
    uniform sampler2D tHist, tPaper, tA; uniform float uPaperOn, uBlur, uPass;
    uniform vec2 uGRes, uRes; uniform mat4 uInvProj, uCamWorld, uPrevVP;
    in vec2 vUv; out vec4 o;
    void main() {
      ivec2 p = ivec2(gl_FragCoord.xy);
      vec3 t = texelFetch(tHist, p, 0).rgb;
      if (uBlur > 0.0) {
        float D = texelFetch(tA, clamp(ivec2(vUv * uGRes), ivec2(0), ivec2(uGRes) - 1), 0).z;
        vec4 v = uInvProj * vec4(vUv * 2.0 - 1.0, 1.0, 1.0); vec3 r = v.xyz / v.w;
        vec3 Pw = (uCamWorld * vec4(r * (min(D, 40000.0) / -r.z), 1.0)).xyz;
        vec4 q = uPrevVP * vec4(Pw, 1.0);
        // the travel (px) since the last frame; none known for a point behind the last camera
        vec2 d = q.w > 0.0 ? vUv * uRes - (q.xy / q.w * 0.5 + 0.5) * uRes : vec2(0.0);
        float L = length(d) * uBlur;
        if (L > 0.5 && L < 2000.0) {
          // two passes of n taps (uPass 0: n taps spaced 2L / n, tent-weighted; 1: n taps over one such space): the
          // tent sampled n² times. Taps a few px apart are separate copies of every mark that step along as it moves
          int n = int(clamp(ceil(sqrt(L * 2.0)), 2.0, float(${TAA_TAPS})));
          vec3 c = vec3(0.0); float ws = 0.0;
          for (int i = 0; i < ${TAA_TAPS}; i++) {
            if (i >= n) break;
            float u = (float(i) + 0.5) / float(n);
            float s = uPass < 0.5 ? u * 2.0 - 1.0 : (u - 0.5) * 2.0 / float(n), w = uPass < 0.5 ? 1.0 - abs(s) : 1.0;
            c += texture(tHist, vUv + d * (s * uBlur) / uRes).rgb * w; ws += w;
          }
          t = c / ws;
        }
      }
      if (uPass < 0.5) { o = vec4(t, 1.0); return; }
      o = vec4(clamp(uPaperOn > 0.5 ? t * max(texelFetch(tPaper, p, 0).rgb, vec3(0.05)) : t, 0.0, 1.0), 1.0);
    }`,
  depthTest: false, depthWrite: false,
});
/** the history targets: the blended ink and the depth it was seen at (half floats, filtered for the Catmull-Rom reads) */
function taaRT(w, h) {
  return new THREE.WebGLRenderTarget(w, h, {
    type: THREE.HalfFloatType, format: THREE.RGBAFormat, colorSpace: THREE.LinearSRGBColorSpace,
    minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false, stencilBuffer: false, generateMipmaps: false,
  });
}
const _vp = new THREE.Matrix4();
function temporalAA(engine, ink, gbuf) {
  const cam = engine.camera, U = taaMat.uniforms, r = engine.renderer, P0 = ink.painter;
  const [hist, next] = ink.taaRTs;
  _vp.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
  // a jump (teleport, a new look): no history
  if (ink.taaCam && ink.taaCam.distanceTo(cam.position) > 6) ink.taaValid = false;
  const paper = P0.cachePaper && P0.paperRT ? P0.paperRT.texture : null;
  U.tCur.value = ink.rawRT.texture; U.tHist.value = hist.texture; U.tA.value = gbuf.textures[1];
  U.tPaper.value = paper; U.uPaperOn.value = paper ? 1 : 0;
  U.uGRes.value.set(gbuf.width, gbuf.height); U.uRes.value.set(ink.rawRT.width, ink.rawRT.height);
  U.uInvProj.value.copy(cam.projectionMatrixInverse); U.uCamWorld.value.copy(cam.matrixWorld);
  U.uPrevVP.value.copy(ink.taaValid ? ink.taaVP : _vp); U.uKeep.value = ink.taaValid ? ink.taaKeep ?? TAA_KEEP : 0;
  U.uLoose.value = engine.params.get('taaLoose') ? Number(engine.params.get('taaLoose')) : TAA_LOOSE;
  if (engine.params.get('taaKeep')) U.uKeep.value = ink.taaValid ? Number(engine.params.get('taaKeep')) : 0;
  taaQuad.material = taaMat;
  r.setRenderTarget(next); taaQuad.render(r);
  const O = taaOutMat.uniforms;
  O.tHist.value = next.texture; O.tPaper.value = paper; O.uPaperOn.value = paper ? 1 : 0;
  O.tA.value = U.tA.value; O.uGRes.value.copy(U.uGRes.value); O.uRes.value.copy(U.uRes.value);
  O.uInvProj.value.copy(U.uInvProj.value); O.uCamWorld.value.copy(U.uCamWorld.value); O.uPrevVP.value.copy(U.uPrevVP.value);
  const mb = engine.params.get('mblur');
  O.uBlur.value = mb === '0' ? 0 : Number(mb) || TAA_BLUR;
  taaQuad.material = taaOutMat;
  if (O.uBlur.value > 0) {
    O.uPass.value = 0; r.setRenderTarget(ink.taaMid); taaQuad.render(r);
    O.tHist.value = ink.taaMid.texture;
  }
  O.uPass.value = 1;
  r.setRenderTarget(ink.taaOut); taaQuad.render(r);
  ink.taaRTs = [next, hist];
  (ink.taaVP ||= new THREE.Matrix4()).copy(_vp);
  (ink.taaCam ||= new THREE.Vector3()).copy(cam.position);
  ink.taaValid = true;
  return ink.taaOut;
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
