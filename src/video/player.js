// In-page video frame renderer (driven by tools/render-video.mjs):
//   window.__videoInfo()                                   → { fps, xfade, segments: [{ shot, frames }] }
//   window.__renderVideoFrame(seg, frame, spp, ts, { wm, timeScale, paints, shutter })  → PNG data URL of that frame
// Each frame accumulates `spp` jittered samples (AA, soft shadows) like an offline still (src/core/engine.js
// renderStill), spread over the shutter interval (camera and animation time: motion blur; SHUTTER, INK_SHUTTER in
// src/video/sequence.js, or { shutter } in frames).
// Ink look (?look=ink): the accumulated frame is the painting's tone, then the painter (src/ink/index.js) paints it like a
// still, `paints` times, each painting at its own instant of the shutter interval and its own sub-pixel offset of the
// camera (its G-buffer, the edges, classes and depth the strokes are drawn from, rendered there); the frame is their mean.
// One painting is crisp as a still, but its strokes over sub-pixel detail flip on and off from frame to frame as the
// camera moves, and over a fast foreground every crisp mark jumps a whole frame's travel at once (a strobe); the mean
// over the shutter holds them steady and blurs them along their motion as a film camera would.
// The camera moves are relative to the viewpoint's camera as applyShot leaves it (in the ink look the ink camera). The
// painter keeps its lattices and foci anchored to that viewpoint (engine.shot); the G-buffer measures the objects'
// origins from it (src/ink/gbuffer.js: measured from the moving camera in half floats they jittered by centimetres a
// frame, and whole trees changed their tone and their marks); its marks fade in and out with their density instead of
// switching (ink.motion); and the grade's measured terms (the exposure meter, the auto levels) are measured once per
// segment, at the viewpoint (the still's own), and held: re-solved every frame they moved the washes' layer edges.
// { wm: true } stamps the watermark (src/explore/watermark.js) into the frame; { timeScale } scales the engine time's
// advance within a segment (0 = a frozen moment: no wind in the trees, no waves).
import * as THREE from 'three';
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
/** the k-th of n instants (in frames, about the frame's own) stratified over the shutter interval, visited in a
 *  scrambled order so that a painting's instant and its sub-pixel offset are not tied together */
function instant(k, n, shutter) {
  if (n <= 1 || !(shutter > 0)) return 0;
  let s = Math.max(1, Math.round(n * 0.38));
  while (gcd(s, n) !== 1) s++;
  return ((((k * s) % n) + 0.5) / n - 0.5) * shutter;
}

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
      const ti = t + (shutter * ((i + 0.5) / spp - 0.5)) / FPS;
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
      if (ink) { ink.anchor = null; ink.motion = false; engine.pipeline.gradeHeld = false; }
    }
  };

  // the mean of n paintings, each at its own instant of the shutter and its own sub-pixel offset → PNG data URL
  let rt = null, sum = null, buf = null, cv = null, measureRT = null;
  async function paintMean(seg, frame, n, shutter, timeScale, timeShift, wm) {
    const W = engine.width, H = engine.height, r = engine.renderer;
    if (!rt || rt.width !== W || rt.height !== H) {
      rt?.dispose();
      rt = new THREE.WebGLRenderTarget(W, H, { type: THREE.UnsignedByteType, format: THREE.RGBAFormat, colorSpace: THREE.LinearSRGBColorSpace,
        minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false, stencilBuffer: false, generateMipmaps: false });
      sum = new Uint16Array(W * H * 4); buf = new Uint8Array(W * H * 4);
    }
    sum.fill(0);
    const offs = paintOffsets(n);
    for (let k = 0; k < n; k++) {
      const [ox, oy] = offs[k];
      pose(seg, (frame + instant(k, n, shutter)) / FPS, timeScale, timeShift);
      const P = cam.projectionMatrix.elements;
      P[8] += (2 * ox) / W; P[9] += (2 * oy) / H;
      cam.projectionMatrixInverse.copy(cam.projectionMatrix).invert();
      engine.pipeline.resolve(rt, 0);
      r.readRenderTargetPixels(rt, 0, 0, W, H, buf);
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
