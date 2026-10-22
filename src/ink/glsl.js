// GLSL shared by the ink passes: classes, hashes and world-anchored noise, camera reconstruction, stroke shapes.
import { CLS } from './gbuffer.js';

export const INK_COMMON = /* glsl */`
precision highp float;
precision highp int;
${Object.entries(CLS).map(([k, v]) => `#define C_${k} ${v}`).join('\n')}

uniform vec2 uRes;        // output px
uniform vec2 uGRes;       // G-buffer px
uniform float uGs;        // G px per output px
uniform float uK;         // output width / 1664 (px quantities are authored at 1664)
uniform mat4 uInvProj;
uniform mat4 uCamWorld;
uniform vec3 uCamPos;
uniform float uPxA;       // view angle per output px (rad)
uniform vec3 uAxisR;      // the shot's horizontal right / forward axes (fixed per shot: world-anchored lattices)
uniform vec3 uAxisF;

float lum(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

bool isFol(int c) { return c == C_LOTUS || c == C_PINE || c == C_WILLOW || c == C_BROAD || c == C_MAPLE || c == C_GINKGO || c == C_BLOSSOM || c == C_SMALL || c == C_IVY; }
bool isTree(int c) { return c == C_PINE || c == C_WILLOW || c == C_BROAD || c == C_MAPLE || c == C_GINKGO || c == C_BLOSSOM; }
bool isArch(int c) { return c == C_ROOF || c == C_WOOD || c == C_WALL || c == C_STONE || c == C_GLOW || c == C_BOAT || c == C_CITYFAR || c == C_SNOW || c == C_DARK || c == C_METAL; }
bool isLand(int c) { return c == C_GROUND || c == C_ROCK || c == C_FIGURE || c == C_NICHE; }

// pcg3d (Jarzynski & Olano 2020)
uvec3 pcg3(uvec3 v) {
  v = v * 1664525u + 1013904223u;
  v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
  v ^= v >> 16u;
  v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
  return v;
}
vec3 h33(ivec3 p) { return vec3(pcg3(uvec3(p)) & uvec3(0xffffffu)) / 16777215.0; }
vec4 h43(ivec3 p) { uvec3 a = pcg3(uvec3(p)); uvec3 b = pcg3(a ^ uvec3(0x9e3779b9u)); return vec4(vec3(a & uvec3(0xffffffu)), float(b.x & 0xffffffu)) / 16777215.0; }
float h13(ivec3 p) { return h33(p).x; }

float vnoise3(vec3 p) {
  vec3 fi = floor(p); ivec3 i = ivec3(fi); vec3 f = p - fi; f = f * f * (3.0 - 2.0 * f);
  float a = h13(i), b = h13(i + ivec3(1, 0, 0)), c = h13(i + ivec3(0, 1, 0)), d = h13(i + ivec3(1, 1, 0));
  float e = h13(i + ivec3(0, 0, 1)), g = h13(i + ivec3(1, 0, 1)), h = h13(i + ivec3(0, 1, 1)), k = h13(i + ivec3(1, 1, 1));
  return mix(mix(mix(a, b, f.x), mix(c, d, f.x), f.y), mix(mix(e, g, f.x), mix(h, k, f.x), f.y), f.z);
}
float vnoise2(vec2 p) { return vnoise3(vec3(p, 0.5)); }
/** world-anchored noise with features ~size metres; size spans octaves smoothly (two power-of-2 levels blended) */
float lodNoise(vec3 P, float size) {
  float l = log2(max(size, 1e-3)); float l0 = floor(l); float t = l - l0;
  float a = vnoise3(P / exp2(l0) + l0 * 7.31);
  float b = vnoise3(P / exp2(l0 + 1.0) + (l0 + 1.0) * 7.31);
  return mix(a, b, smoothstep(0.0, 1.0, t));
}

vec3 viewRay(vec2 uv) { vec4 v = uInvProj * vec4(uv * 2.0 - 1.0, 1.0, 1.0); return v.xyz / v.w; }
vec3 viewPosOf(vec2 uv, float D) { vec3 r = viewRay(uv); return r * (D / -r.z); }
vec3 worldPosOf(vec2 uv, float D) { return (uCamWorld * vec4(viewPosOf(uv, D), 1.0)).xyz; }
vec3 worldDirOf(vec2 uv) { return normalize(mat3(uCamWorld) * viewRay(uv)); }

/** coverage of a tapered segment a→b (widths w0 → w1), aa = soft edge, all in the same units */
float segCov(vec2 p, vec2 a, vec2 b, float w0, float w1, float aa) {
  vec2 pa = p - a, ba = b - a;
  float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-9), 0.0, 1.0);
  float d = length(pa - ba * h);
  float w = mix(w0, w1, h);
  return smoothstep(w + aa, w - aa, d);
}
vec2 rot2(vec2 v, float a) { float c = cos(a), s = sin(a); return vec2(c * v.x - s * v.y, s * v.x + c * v.y); }
`;
