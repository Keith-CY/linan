// In-page video frame renderer (driven by tools/render-video.mjs):
//   window.__videoInfo()                                   → { fps, xfade, segments: [{ shot, frames }] }
//   window.__renderVideoFrame(seg, frame, spp, ts, { wm, timeScale, paints, shutter })  → PNG data URL of that frame
// Each frame accumulates `spp` jittered samples (AA, soft shadows) like an offline still (src/core/engine.js
// renderStill), spread over the shutter interval (camera and animation time: motion blur; SHUTTER, INK_SHUTTER in
// src/video/sequence.js, or { shutter } in frames): a box for the photographic look, a tent for the ink look.
// Ink look (?look=ink): the accumulated frame is the painting's tone, then the painter (src/ink/index.js) paints it like a
// still, `paints` times, each painting at its own instant of the shutter interval and its own sub-pixel offset of the
// camera (its G-buffer, the edges, classes and depth the strokes are drawn from, rendered there); the frame is their mean.
// One painting is crisp as a still, but its strokes over sub-pixel detail flip on and off from frame to frame as the
// camera moves, and over a fast foreground every crisp mark jumps a whole frame's travel at once (a strobe); the mean
// over the shutter holds them steady and blurs them along their motion as a film camera would. Each painting is blurred
// over its own share of the shutter (SLICE_FRAG below), so the mean is one continuous exposure, not n separate copies.
// The camera moves are relative to the viewpoint's camera as applyShot leaves it (in the ink look the ink camera). The
// painter keeps its lattices and foci anchored to that viewpoint (engine.shot); the G-buffer measures the objects'
// origins from it (src/ink/gbuffer.js: measured from the moving camera in half floats they jittered by centimetres a
// frame, and whole trees changed their tone and their marks); its marks fade in and out with their density instead of
// switching (ink.motion); and the grade's measured terms (the exposure meter, the auto levels) are measured once per
// segment, at the viewpoint (the still's own), and held: re-solved every frame they moved the washes' layer edges.
// { wm: true } stamps the watermark (src/explore/watermark.js) into the frame; { timeScale } scales the engine time's
// advance within a segment (0 = a frozen moment: no wind in the trees, no waves).
import * as THREE from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { FPS, XFADE, SHUTTER, INK_SHUTTER, SEQUENCE, cameraAt } from './sequence.js';

// sub-pixel offsets (output pixels) of the paintings: one centred, a rotated grid of four, else Halton points
const halton = (i, b) => { let f = 1, r = 0; for (; i > 0; i = Math.floor(i / b)) { f /= b; r += f * (i % b); } return r; };
function paintOffsets(n) {
  if (n <= 1) return [[0, 0]];
  if (n === 4) return [[0.125, 0.375], [-0.375, 0.125], [-0.125, -0.375], [0.375, -0.125]];
  const o = Array.from({ length: n }, (_, i) => [halton(i + 1, 2) - 0.5, halton(i + 1, 3) - 0.5]);
  const mx = o.reduce((a, p) => a + p[0], 0) / n, my = o.reduce((a, p) => a + p[1], 0) / n;
  return o.map(([x, y]) => [x - mx, y - my]);
}
const gcd = (a, b) => (b ? gcd(b, a % b) : a);
/** an instant (frames, about the frame's own) for u in (0, 1): spread evenly over a box of width `shutter`, or as a
 *  tent of support `shutter` (tent: denser at the frame's own instant, overlapping its neighbours') */
const spread = (u, shutter, tent) => (tent ? (u < 0.5 ? Math.sqrt(2 * u) - 1 : 1 - Math.sqrt(2 - 2 * u)) * 0.5 : u - 0.5) * shutter;
/** the k-th of n strata of the shutter, visited in a scrambled order so that a painting's instant and its sub-pixel
 *  offset are not tied together: [start, instant, end] (frames, about the frame's own; the instant is the stratum's
 *  middle, the painting is blurred over the rest, see SLICE_FRAG) */
function stratum(k, n, shutter, tent) {
  if (n <= 1 || !(shutter > 0)) return [0, 0, 0];
  let s = Math.max(1, Math.round(n * 0.38));
  while (gcd(s, n) !== 1) s++;
  const j = (k * s) % n;
  return [spread(j / n, shutter, tent), spread((j + 0.5) / n, shutter, tent), spread((j + 1) / n, shutter, tent)];
}
// Each painting stands for its stratum of the shutter: it is blurred along the path every pixel's world point takes
// over that stratum (from the G-buffer's depth, projected with the cameras at the stratum's start and end). The mean of
// the paintings is then a continuous exposure. Without it a mark that travels farther than its own width between two
// paintings' instants is laid down as separate copies, a different set every frame: in a fast shot (the lotus field,
// the near ground) every fine line and edge pops.
const SLICE_TAPS = 12;
const SLICE_FRAG = /* glsl */`
  precision highp float;
  uniform sampler2D tSrc, tA; uniform vec2 uRes, uGRes; uniform mat4 uInvProj, uCamWorld, uVP0, uVP1;
  in vec2 vUv; out vec4 o;
  vec2 toPx(mat4 m, vec3 P) { vec4 q = m * vec4(P, 1.0); return (q.xy / max(q.w, 1e-4) * 0.5 + 0.5) * uRes; }
  void main() {
    float D = texelFetch(tA, clamp(ivec2(vUv * uGRes), ivec2(0), ivec2(uGRes) - 1), 0).z;
    vec4 v = uInvProj * vec4(vUv * 2.0 - 1.0, 1.0, 1.0); vec3 r = v.xyz / v.w;
    vec3 Pw = (uCamWorld * vec4(r * (min(D, 40000.0) / -r.z), 1.0)).xyz;
    vec2 p = vUv * uRes, a = toPx(uVP0, Pw) - p, b = toPx(uVP1, Pw) - p;
    // (a, b: where this pixel's point lies at the stratum's ends, about where it lies now; what the pixel saw over the
    // stratum is what now lies the opposite way)
    float len = length(b - a);
    if (!(len > 0.25) || len > 200.0) { o = texture(tSrc, vUv); return; }
    int n = int(clamp(ceil(len * 1.5), 2.0, float(${SLICE_TAPS})));
    vec4 c = vec4(0.0);
    for (int i = 0; i < ${SLICE_TAPS}; i++) {
      if (i >= n) break;
      vec2 d = mix(a, b, (float(i) + 0.5) / float(n));
      c += texture(tSrc, (p - d) / uRes);
    }
    o = c / float(n);
  }`;

export function setupVideo(engine, SHOTS) {
  const shotById = (id) => SHOTS.find((s) => String(s.id) === String(id));
  const segs = SEQUENCE.map((g, i) => {
    const last = i === SEQUENCE.length - 1;
    // every segment except the last carries the cross-dissolve tail (already included in dur)
    return { ...g, frames: Math.round(g.dur * FPS), last };
  });
  let current = -1, base = null, measured = -1;

  window.__videoInfo = () => ({ fps: FPS, xfade: XFADE, ink: !!engine.ink, segments: segs.map((s) => ({ shot: s.shot, frames: s.frames, dur: s.dur })) });

  const cam = engine.camera;
  const gl = engine.renderer.getContext();
  /** the camera and the engine time at t seconds into the segment */
  const pose = (seg, t, timeScale, timeShift) => {
    const c = cameraAt(base, seg, t / seg.dur);
    cam.fov = c.fov; cam.position.set(...c.pos); cam.up.set(0, 1, 0); cam.lookAt(c.target[0], c.target[1], c.target[2]);
    if (base.roll) cam.rotateZ((base.roll * Math.PI) / 180);
    cam.updateProjectionMatrix(); cam.updateMatrixWorld(true);
    if (c.dof) engine.shot.dof = c.dof;
    engine.setTime(seg.time + t * timeScale + timeShift); // timeShift: retry knob for a frame that hung the GPU
    engine.lighting.refreshCSM();
  };
  // the camera at t seconds into the segment (view-projection, with a sub-pixel offset ox, oy in px) into m
  const vpCam = new THREE.PerspectiveCamera();
  const vpAt = (seg, t, m, ox = 0, oy = 0) => {
    const c = cameraAt(base, seg, t / seg.dur);
    vpCam.fov = c.fov; vpCam.aspect = cam.aspect; vpCam.near = cam.near; vpCam.far = cam.far;
    vpCam.position.set(...c.pos); vpCam.up.set(0, 1, 0); vpCam.lookAt(c.target[0], c.target[1], c.target[2]);
    if (base.roll) vpCam.rotateZ((base.roll * Math.PI) / 180);
    vpCam.updateProjectionMatrix(); vpCam.updateMatrixWorld(true);
    const P = vpCam.projectionMatrix.elements;
    P[8] += (2 * ox) / engine.width; P[9] += (2 * oy) / engine.height;
    return m.multiplyMatrices(vpCam.projectionMatrix, vpCam.matrixWorldInverse);
  };
  // the camera a frame before t: the painter measures how far a point travels on the sheet in a frame (painter.js prevPx)
  const prevVP = (seg, t) => vpAt(seg, t - 1 / FPS, (engine.ink.prevVP ||= new THREE.Matrix4()));
  const fence = async () => {
    const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    gl.flush();
    if (sync) {
      for (let k = 0; k < 20000 && gl.clientWaitSync(sync, 0, 0) === gl.TIMEOUT_EXPIRED; k++) await new Promise((r) => setTimeout(r, 2));
      gl.deleteSync(sync);
    }
  };
  /** accumulate spp jittered samples about t seconds into the segment, each at its own instant of the shutter (frames) */
  const accumulate = async (seg, t, spp, shutter, timeScale, timeShift) => {
    engine.ensurePatched();
    engine.pipeline.begin();
    let last = null;
    for (let i = 0; i < spp; i++) {
      const ti = t + spread((i + 0.5) / spp, shutter, !!engine.ink) / FPS;
      if (ti !== last) { pose(seg, ti, timeScale, timeShift); last = ti; }
      engine.lighting.updateLens?.();
      engine.renderSample(i, { jitter: spp > 1 });
      await fence();
    }
  };

  window.__renderVideoFrame = async (si, frame, spp = 8, timeShift = 0, { wm = false, timeScale = 1, paints = 1, shutter } = {}) => {
    const seg = segs[si];
    const shot = shotById(seg.shot);
    const ink = engine.ink;
    if (current !== si) {
      engine.applyShot(shot);
      const s = engine.shot;
      base = { pos: s.pos.slice(), target: s.target.slice(), fov: s.fov, dof: s.dof, roll: s.roll };
      current = si; measured = -1;
    }
    const sh = shutter ?? (ink ? INK_SHUTTER : SHUTTER);
    try {
      if (ink) {
        // a moving camera's painting: origins from the viewpoint, marks that fade rather than switch
        ink.anchor = base.pos.slice(); ink.motion = true;
        if (measured !== si) {
          // the grade's meter and levels, measured at the viewpoint itself, then held for the segment
          engine.pipeline.gradeHeld = false;
          await accumulate(seg, (seg.at ?? 0.5) * seg.dur, spp, 0, timeScale, 0);
          measureRT ||= new THREE.WebGLRenderTarget(16, 16, { depthBuffer: false });
          engine.pipeline.resolve(measureRT, 0);
          measured = si;
        }
        engine.pipeline.gradeHeld = true;
      }
      await accumulate(seg, frame / FPS, spp, sh, timeScale, timeShift);
      // a painting has no grain, and its grade is the segment's: the same frame always paints the same, whatever was
      // rendered before it
      if (ink) return await paintMean(seg, frame, paints, sh, timeScale, timeShift, wm);
      engine.pipeline.resolve(null, si * 1000 + frame);
      // guard: a lost / broken GL context silently yields blank frames → fail loudly so the harness restarts
      if (gl.isContextLost()) throw new Error('webgl context lost');
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      const W = engine.canvas.width, H = engine.canvas.height, px = new Uint8Array(4);
      let lit = 0;
      for (const [fx, fy] of [[0.25, 0.3], [0.5, 0.5], [0.75, 0.7], [0.3, 0.8], [0.7, 0.2]]) {
        gl.readPixels(Math.floor(W * fx), Math.floor(H * fy), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
        if (px[3] > 0 && px[0] + px[1] + px[2] > 6) lit++;
      }
      if (lit < 2) throw new Error('blank frame (render produced no image)');
      const url = engine.canvas.toDataURL('image/png');
      if (!wm) return url;
      const m = await import('../explore/watermark.js');
      return await m.stampDataURL(url, { night: !!engine.registry.night });
    } finally {
      if (ink) { ink.anchor = null; ink.motion = false; ink.prevVP = null; engine.pipeline.gradeHeld = false; }
    }
  };

  // the mean of n paintings, each at its own instant of the shutter and its own sub-pixel offset → PNG data URL
  let rt = null, rt2 = null, sum = null, buf = null, cv = null, measureRT = null;
  const sliceOn = new URLSearchParams(location.search).get('slice') !== '0';   // ?slice=0: no blur over the strata
  const sliceMat = new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    uniforms: { tSrc: { value: null }, tA: { value: null }, uRes: { value: new THREE.Vector2() }, uGRes: { value: new THREE.Vector2() },
      uInvProj: { value: new THREE.Matrix4() }, uCamWorld: { value: new THREE.Matrix4() }, uVP0: { value: new THREE.Matrix4() }, uVP1: { value: new THREE.Matrix4() } },
    vertexShader: 'out vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: SLICE_FRAG, depthTest: false, depthWrite: false,
  });
  const sliceQuad = new FullScreenQuad(sliceMat);
  async function paintMean(seg, frame, n, shutter, timeScale, timeShift, wm) {
    const W = engine.width, H = engine.height, r = engine.renderer;
    if (!rt || rt.width !== W || rt.height !== H) {
      rt?.dispose(); rt2?.dispose();
      const o = { type: THREE.UnsignedByteType, format: THREE.RGBAFormat, colorSpace: THREE.LinearSRGBColorSpace,
        minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false, stencilBuffer: false, generateMipmaps: false };
      rt = new THREE.WebGLRenderTarget(W, H, o); rt2 = new THREE.WebGLRenderTarget(W, H, o);
      sum = new Uint16Array(W * H * 4); buf = new Uint8Array(W * H * 4);
    }
    sum.fill(0);
    const offs = paintOffsets(n);
    for (let k = 0; k < n; k++) {
      const [ox, oy] = offs[k];
      const [t0, tm, t1] = stratum(k, n, shutter, true);
      const ti = (frame + tm) / FPS;
      pose(seg, ti, timeScale, timeShift);
      prevVP(seg, ti);
      const P = cam.projectionMatrix.elements;
      P[8] += (2 * ox) / W; P[9] += (2 * oy) / H;
      cam.projectionMatrixInverse.copy(cam.projectionMatrix).invert();
      engine.pipeline.resolve(rt, 0);
      let out = rt;
      if (t1 > t0 && sliceOn) {
        const U = sliceMat.uniforms, gb = engine.ink.gbuf;
        U.tSrc.value = rt.texture; U.tA.value = gb.textures[1];
        U.uRes.value.set(W, H); U.uGRes.value.set(gb.width, gb.height);
        U.uInvProj.value.copy(cam.projectionMatrixInverse); U.uCamWorld.value.copy(cam.matrixWorld);
        vpAt(seg, (frame + t0) / FPS, U.uVP0.value, ox, oy); vpAt(seg, (frame + t1) / FPS, U.uVP1.value, ox, oy);
        r.setRenderTarget(rt2); sliceQuad.render(r); r.setRenderTarget(null);
        out = rt2;
      }
      r.readRenderTargetPixels(out, 0, 0, W, H, buf);
      for (let i = 0; i < buf.length; i++) sum[i] += buf[i];
    }
    pose(seg, frame / FPS, timeScale, timeShift);
    if (r.getContext().isContextLost()) throw new Error('webgl context lost');
    // rows bottom-up (GL) → top-down, the mean rounded
    cv ||= document.createElement('canvas');
    cv.width = W; cv.height = H;
    const ctx = cv.getContext('2d', { colorSpace: 'srgb' });
    const img = ctx.createImageData(W, H), d = img.data, h = n >> 1;
    let lit = 0;
    for (let y = 0; y < H; y++) {
      const src = (H - 1 - y) * W * 4, dst = y * W * 4;
      for (let x = 0; x < W * 4; x += 4) {
        d[dst + x] = (sum[src + x] + h) / n; d[dst + x + 1] = (sum[src + x + 1] + h) / n; d[dst + x + 2] = (sum[src + x + 2] + h) / n; d[dst + x + 3] = 255;
      }
    }
    for (const [fx, fy] of [[0.25, 0.3], [0.5, 0.5], [0.75, 0.7], [0.3, 0.8], [0.7, 0.2]]) {
      const i = (Math.floor(H * fy) * W + Math.floor(W * fx)) * 4;
      if (d[i] + d[i + 1] + d[i + 2] > 6) lit++;
    }
    if (lit < 2) throw new Error('blank frame (render produced no image)');
    ctx.putImageData(img, 0, 0);
    if (wm) { const m = await import('../explore/watermark.js'); await m.drawWatermark(ctx, W, H, { night: !!engine.registry.night }); }
    return cv.toDataURL('image/png');
  }
}
