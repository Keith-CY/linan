// Live painting quality for the explorable world: two tiers and an adaptive render scale, chosen from the measured
// frame time (src/explore/index.js calls adapt() every live frame).
//
//   high  the painter at the live size with a G-buffer of the same size (src/ink/index.js renderRealtime), FXAA on
//         the way to the canvas (ink.present)
//   low   for weaker GPUs: the painter (every wash, tone, paper and stroke texture) at HALF the live size over a
//         G-buffer at the full live size (gs = 2, the stills' own arrangement): the edges and the jump-flood field of
//         the brush lines stay at full size, and the way to the canvas is a guided upsample — the washes bilinear
//         from the half-size painting, the line cores taken from its darkest texel where the full-size line field
//         says a line passes, so lines keep their full-size width and place. The painter pass costs a quarter.
//
// The ladder (from the best): high at scale 1, 0.9, 0.8, then low 0.9 … 0.55 (scale = the live painting's size as a
// fraction of the window). A mean frame time over ~2 s of walking above 26 ms steps down, below 17.5 ms (6 s after
// the last change) steps up; a step up that is undone within 8 s is not tried again for a minute.
// URL: ?q=low | ?q=high fixes the tier, ?scale=N fixes the scale (both: no adaptation).
import * as THREE from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

const P = new URLSearchParams(location.search);
const SCALES = [1, 0.9, 0.8, 0.7, 0.6, 0.55];
const DOWN_MS = 1000 / 38, UP_MS = 1000 / 57;

function ladder() {
  const q = P.get('q'), fixed = Number(P.get('scale')) || 0;
  if (fixed) return (q === 'low' ? ['low'] : q === 'high' ? ['high'] : ['high', 'low']).map((tier) => ({ tier, scale: fixed }));
  if (q === 'low' || q === 'high') return SCALES.map((scale) => ({ tier: q, scale }));
  // the high tier down to 0.8 (a uniform upscale reads closer to the full painting than half-size washes), then low
  return [...SCALES.filter((k) => k >= 0.8).map((scale) => ({ tier: 'high', scale })), ...SCALES.filter((k) => k <= 0.9).map((scale) => ({ tier: 'low', scale }))];
}

export const LIVE = { steps: ladder(), i: 0, t0: 0, n: 0, sum: 0, last: 0, changed: 0, blocked: new Map(), lastUp: null };
LIVE.i = 0;
export const liveState = () => LIVE.steps[LIVE.i];

/** the live painting's sizes for the current step: painter (w, h, gs) and G-buffer */
export function applyLive(engine) {
  const ink = engine.ink;
  if (!ink) return;
  const { tier, scale } = liveState();
  const W = Math.max(2, Math.round(engine.width * scale)), H = Math.max(2, Math.round(engine.height * scale));
  if (tier === 'low') {
    const pw = Math.ceil(W / 2), ph = Math.ceil(H / 2);
    ink.painter.resize(pw, ph, 2);
    ink.gbuf.setSize(pw * 2, ph * 2);
  } else {
    ink.painter.resize(W, H, 1);
    ink.gbuf.setSize(W, H);
  }
}

/** call every live frame; returns true when the step changed (the caller redraws) */
export function adapt(engine, now, moved) {
  const A = LIVE;
  if (A.steps.length < 2) return false;
  const dt = now - A.last; A.last = now;
  if (!moved || dt > 250) { A.t0 = now; A.n = 0; A.sum = 0; return false; }
  A.n++; A.sum += dt;
  if (now - A.t0 < 2000 || A.n < 20) return false;
  const mean = A.sum / A.n;
  A.t0 = now; A.n = 0; A.sum = 0;
  let j = A.i;
  if (mean > DOWN_MS && A.i < A.steps.length - 1) {
    j = A.i + 1;
    // a step up undone within 8 s: do not try it again for a minute
    if (A.lastUp && now - A.lastUp.t < 8000 && A.lastUp.from === j) A.blocked.set(A.i, now + 60000);
  } else if (mean < UP_MS && A.i > 0 && now - A.changed > 6000 && !((A.blocked.get(A.i - 1) || 0) > now)) {
    j = A.i - 1;
    A.lastUp = { t: now, from: A.i };
  }
  if (j === A.i) return false;
  A.i = j; A.changed = now;
  applyLive(engine);
  const s = liveState();
  console.log(`[explore] live painting ${s.tier} at ${s.scale.toFixed(2)} after ${mean.toFixed(1)} ms frames`);
  return true;
}

// ------------------------------------------------------------------ the way to the canvas
const quad = new FullScreenQuad(null);
const guidedMat = new THREE.ShaderMaterial({
  glslVersion: THREE.GLSL3,
  uniforms: {
    tLive: { value: null }, tStill: { value: null }, tJfa: { value: null }, tEdge: { value: null },
    uMix: { value: 0 }, uTexel: { value: new THREE.Vector2(1, 1) }, uGRes: { value: new THREE.Vector2(1, 1) },
  },
  vertexShader: 'out vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
  fragmentShader: /* glsl */`
    precision highp float;
    uniform sampler2D tLive, tStill, tJfa, tEdge; uniform float uMix; uniform vec2 uTexel, uGRes;
    in vec2 vUv; out vec4 outColor;
    float L(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }
    vec3 guided(vec2 uv) {
      vec3 bil = texture(tLive, uv).rgb;
      // the darkest of the four half-size texels round this pixel (a line's core at half size)
      vec2 p = uv / uTexel - 0.5, i = floor(p);
      vec3 a = texture(tLive, (i + vec2(0.5, 0.5)) * uTexel).rgb, b = texture(tLive, (i + vec2(1.5, 0.5)) * uTexel).rgb;
      vec3 c = texture(tLive, (i + vec2(0.5, 1.5)) * uTexel).rgb, d = texture(tLive, (i + vec2(1.5, 1.5)) * uTexel).rgb;
      vec3 mn = a; float lm = L(a);
      if (L(b) < lm) { mn = b; lm = L(b); }
      if (L(c) < lm) { mn = c; lm = L(c); }
      if (L(d) < lm) { mn = d; lm = L(d); }
      // the full-size line field: distance to the nearest edge seed against the seed's half width (G pixels)
      ivec2 gp = clamp(ivec2(uv * uGRes), ivec2(0), ivec2(uGRes) - 1);
      vec4 J = texelFetch(tJfa, gp, 0);
      float cov = 0.0, str = 0.0;
      if (J.w > 0.5) {
        vec4 E = texelFetch(tEdge, ivec2(J.xy), 0);
        float dd = length(vec2(gp) - J.xy);
        str = smoothstep(0.25, 0.45, E.x);       // contours (界画, rock, the carving); the faint ground / foliage marks stay as painted
        cov = smoothstep(J.z + 0.75, J.z - 0.3, dd) * str;
      }
      // pixels beside a contour keep the wash (the bilinear tap would smear the half-size line over them)
      float side = 0.0;
      if (J.w > 0.5) side = smoothstep(J.z + 0.6, J.z + 2.2, length(vec2(gp) - J.xy)) * (1.0 - cov) * str;
      vec3 mx = max(max(a, b), max(c, d));
      vec3 wash = mix(bil, max(bil, mix(bil, mx, 0.5)), side * smoothstep(0.03, 0.12, L(mx) - lm));
      return mix(wash, mn, cov);
    }
    void main() {
      vec3 live = uMix >= 1.0 ? vec3(0.0) : guided(vUv);
      vec3 still = uMix > 0.0 ? texture(tStill, vUv).rgb : vec3(0.0);
      outColor = vec4(mix(live, still, uMix), 1.0);
    }`,
  depthTest: false, depthWrite: false,
});

/** wrap ink.present (the low tier's guided upsample; the high tier's own FXAA present) and ink.renderRealtime (the
 *  low tier paints its strokes LINE_BOOST× wider at half size, so each line's core fills a half-size texel; the guided
 *  upsample cuts it back to the full-size width of the line field) */
const LINE_BOOST = 2;
export function installPresent(engine) {
  const ink = engine.ink;
  if (!ink || ink.__tierPresent) return;
  ink.__tierPresent = true;
  const rr = ink.renderRealtime;
  ink.renderRealtime = () => {
    if (liveState().tier !== 'low') return rr();
    const l = ink.style.line;
    ink.style.line = l * LINE_BOOST;
    try { rr(); } finally { ink.style.line = l; }
  };
  const own = ink.present;
  ink.present = (mix = 0) => {
    if (liveState().tier !== 'low' || !ink.liveRT) return own(mix);
    const U = guidedMat.uniforms, Pn = ink.painter;
    U.tLive.value = ink.liveRT.texture; U.tStill.value = ink.stillRT?.texture || null;
    U.uMix.value = ink.stillRT ? mix : 0;
    U.uTexel.value.set(1 / ink.liveRT.width, 1 / ink.liveRT.height);
    U.tJfa.value = Pn.paintMat.uniforms.tJfa.value; U.tEdge.value = Pn.edgeRT.texture;
    U.uGRes.value.set(Pn.gw, Pn.gh);
    quad.material = guidedMat;
    engine.renderer.setRenderTarget(null);
    quad.render(engine.renderer);
  };
}
