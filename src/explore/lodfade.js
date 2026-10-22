// Crossfade between the two levels of a building or pagoda in the explorable world (engine.registry.lodSwitch, from
// src/modules/yingzao.js exploreLod: full detail near, massing far, switched at s.d metres). Instead of a hard swap,
// both levels are drawn across a band of ±BAND·d round the switch distance and dissolve into each other through a
// pattern fixed to the world: soft blotches ~2 m across (two octaves of value noise on the world position) that turn
// from the near level to the far one as the walker crosses the band. The two levels test the same value against the
// same threshold from opposite sides, so every pixel shows exactly one of them. Under the ink painting the swap reads
// as washes and contours being repainted patch by patch rather than a pop; the pattern stays on the building while
// the camera moves (nothing crawls across the screen).
//
// The dissolve lives in clones of the building materials (one pair per building in the band, sharing the originals'
// uniforms, shader chain and G-buffer outputs, plus one discard at the top of main), so the originals — and every
// building outside a band, and every still — keep their programs untouched. The clones' programs are compiled before
// the first frame (precompile).
//
// A middle level: a building the stills build at full detail (lod 0: every 枓栱, tile rows, rafters) is walked past at
// lod 0 only within NEAR_D metres; beyond that, up to its massing distance, it shows lod 1 (block brackets, no tile
// rows: a third of the triangles, made to read right from 50 m). The lod-1 groups are built from the builder that
// src/modules/yingzao.js keeps in the lodSwitch entry, one per call of build(), while the walker stands still (a build
// takes 0.1–0.6 s, never during a walk; until it exists the building keeps lod 0 out to its massing distance).
//
//   const F = new LodFade(engine)    after the build
//   await F.precompile()             the clones' programs, before the frame loop
//   F.update(cameraPosition)         each moved frame (cheap: a distance per building)
//   F.buildNext(cameraPosition)      while standing still: the nearest missing middle level (true when one was built)
//   F.reset()                        originals back, middle levels hidden (src/explore/still.js sets its own levels)
import * as THREE from 'three';

export const BAND = 0.22;          // half width of the band as a fraction of the switch distance
export const NEAR_D = 160, NEAR_BAND = 0.14;   // lod 0 → lod 1 (the middle level): both drawn over 138–182 m
const KEY = '|lodfade';

const VERT_DECL = 'varying vec3 vLodW;\n';
const VERT_CODE = /* glsl */`
{
  vec4 lodW = vec4(transformed, 1.0);
  #ifdef USE_BATCHING
    lodW = batchingMatrix * lodW;
  #endif
  #ifdef USE_INSTANCING
    lodW = instanceMatrix * lodW;
  #endif
  vLodW = (modelMatrix * lodW).xyz;
}
`;
const FRAG_DECL = /* glsl */`
uniform vec2 uLodFade;     // x: progress across the band (0 near only … 1 far only), y: 0 the near level, 1 the far one
varying vec3 vLodW;
float lfHash(vec3 p) { p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
float lfNoise(vec3 p) {
  vec3 i = floor(p), f = fract(p), u = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(lfHash(i), lfHash(i + vec3(1, 0, 0)), u.x), mix(lfHash(i + vec3(0, 1, 0)), lfHash(i + vec3(1, 1, 0)), u.x), u.y),
             mix(mix(lfHash(i + vec3(0, 0, 1)), lfHash(i + vec3(1, 0, 1)), u.x), mix(lfHash(i + vec3(0, 1, 1)), lfHash(i + vec3(1, 1, 1)), u.x), u.y), u.z);
}
`;
const FRAG_TEST = /* glsl */`
  {
    // blotches ~2 m across with a finer edge; stretched from its bell shape to cover 0..1 about evenly
    float lfH = 0.68 * lfNoise(vLodW * 0.5) + 0.32 * lfNoise(vLodW * 1.7 + 7.31);
    lfH = clamp((lfH - 0.5) * 2.6 + 0.5, 0.0, 1.0);
    if (uLodFade.y < 0.5 ? lfH < uLodFade.x : lfH >= uLodFade.x) discard;
  }
`;

function inject(shader) {
  if (!shader.vertexShader.includes('#include <project_vertex>') || !shader.fragmentShader.includes('void main() {')) return false;
  shader.vertexShader = VERT_DECL + shader.vertexShader.replace('#include <project_vertex>', '#include <project_vertex>\n' + VERT_CODE);
  shader.fragmentShader = FRAG_DECL + shader.fragmentShader.replace('void main() {', 'void main() {\n' + FRAG_TEST);
  return true;
}

/** a clone of `m` that dissolves by the uniform U ({ value: Vector2 }) */
function fadeClone(m, U) {
  const c = m.clone();
  c.userData = m.userData;                    // the originals' patch flags and uniforms (no second patch)
  const prev = m.onBeforeCompile, key = m.customProgramCacheKey;
  c.onBeforeCompile = function (shader, renderer) {
    prev.call(this, shader, renderer);
    if (inject(shader)) shader.uniforms.uLodFade = U;
  };
  c.customProgramCacheKey = () => key.call(m) + KEY;
  return c;
}

export class LodFade {
  constructor(engine, { band = BAND } = {}) {
    this.engine = engine;
    this.band = band;
    this.list = (engine.registry.lodSwitch || []).map((s) => ({
      s, levels: [this._level(s.near), null, this._level(s.far)],
      // a middle level only where the near one is the stills' full detail
      wantMid: typeof s.build === 'function' && (s.lod ?? 0) <= 0,
    }));
    this.inBand = 0;
    this.built = 0;
  }

  _level(group) {
    const meshes = [];
    group.traverse((o) => { if (o.isMesh && o.material && !Array.isArray(o.material)) meshes.push(o); });
    return { group, meshes, U: { value: new THREE.Vector2(0, 0) }, clones: null, fading: false };
  }

  _clones(L) {
    if (L.clones) return L.clones;
    const C = new Map();
    const get = (m) => { if (!C.has(m)) C.set(m, fadeClone(m, L.U)); return C.get(m); };
    L.clones = L.meshes.map((o) => ({ o, mat: o.material, ink: o.userData.inkMaterial || null, cm: get(o.material), ci: o.userData.inkMaterial ? get(o.userData.inkMaterial) : null }));
    return L.clones;
  }

  /** a level shown whole (fade null), dissolving ([t, role]) or hidden */
  _set(L, vis, fade) {
    if (!L) return;
    L.group.visible = vis;
    if (vis && fade) {
      if (!L.fading) { for (const c of this._clones(L)) { c.o.material = c.cm; if (c.ci) c.o.userData.inkMaterial = c.ci; } L.fading = true; }
      L.U.value.set(fade[0], fade[1]);
    } else if (L.fading) {
      for (const c of L.clones) { c.o.material = c.mat; if (c.ci) c.o.userData.inkMaterial = c.ink; }
      L.fading = false;
    }
  }

  /** the levels (and dissolves) of every building for a camera at pos */
  update(pos) {
    let n = 0;
    const tOf = (D, d, b) => (D - d * (1 - b)) / (2 * d * b);
    const inB = (t) => t > 0 && t < 1;
    for (const e of this.list) {
      const s = e.s, D = Math.hypot(pos.x - s.x, pos.z - s.z);
      const [L0, L1, L2] = e.levels;
      const t2 = tOf(D, s.d, this.band);
      if (!L1) {
        this._set(L0, t2 < 1, inB(t2) ? [t2, 0] : null);
        this._set(L2, t2 > 0, inB(t2) ? [t2, 1] : null);
        if (inB(t2)) n++;
        continue;
      }
      const t1 = tOf(D, NEAR_D, NEAR_BAND);
      this._set(L0, t1 < 1, inB(t1) ? [t1, 0] : null);
      this._set(L1, t1 > 0 && t2 < 1, inB(t1) ? [t1, 1] : inB(t2) ? [t2, 0] : null);
      this._set(L2, t2 > 0, inB(t2) ? [t2, 1] : null);
      if (inB(t1) || inB(t2)) n++;
    }
    this.inBand = n;
  }

  /** originals back on every building, middle levels hidden (the near / far levels are left to the caller) */
  reset() {
    for (const e of this.list) for (const L of e.levels) if (L) { this._set(L, L.group.visible, null); if (L === e.levels[1]) L.group.visible = false; }
  }

  /** build the middle level of the nearest building that wants one (within its massing distance + 300 m) */
  buildNext(pos) {
    let best = null, bd = Infinity;
    for (const e of this.list) {
      if (!e.wantMid || e.levels[1]) continue;
      const D = Math.hypot(pos.x - e.s.x, pos.z - e.s.z);
      if (D < e.s.d + 300 && D < bd) { bd = D; best = e; }
    }
    if (!best) return false;
    const s = best.s, t0 = performance.now();
    best.wantMid = false;
    try {
      const r = s.build(1);
      const g = r.group;
      g.name = s.near.name.replace(/:near$/, '') + ':mid';
      g.position.copy(s.near.position); g.quaternion.copy(s.near.quaternion); g.scale.copy(s.near.scale);
      g.traverse((o) => {
        if (!(o.isMesh || o.isInstancedMesh || o.isBatchedMesh)) return;
        if (o.userData.castShadow === undefined) o.castShadow = true;
        if (o.userData.receiveShadow === undefined) o.receiveShadow = true;
      });
      g.visible = false;
      s.near.parent.add(g);
      g.updateMatrixWorld(true);
      this.engine.ensurePatched();          // atmosphere / shadows and the ink G-buffer outputs (shared materials: no new programs)
      best.levels[1] = this._level(g);
      s.mid = g;
      this.built++;
      console.log(`[explore] lod fade: middle level of ${g.name} (${Math.round((r.info?.tris || 0) / 1000)}k tris) in ${Math.round(performance.now() - t0)} ms`);
    } catch (err) { console.error('[explore] lod fade: middle level failed', err); }
    return true;
  }

  /** compile the clones' programs (one per material, against the scene's lights) before they are needed */
  async precompile() {
    const e0 = this.engine, seen = new Map();
    for (const e of this.list) for (const L of e.levels) if (L) for (const o of L.meshes) for (const m of [o.material, o.userData.inkMaterial]) {
      if (!m || seen.has(m)) continue;
      seen.set(m, new THREE.Mesh(o.geometry, fadeClone(m, { value: new THREE.Vector2(0.5, 0) })));
    }
    const g = new THREE.Group();
    for (const p of seen.values()) g.add(p);
    const t0 = performance.now();
    await e0.renderer.compileAsync(g, e0.camera, e0.scene);
    console.log(`[explore] lod fade: ${this.list.length} buildings (${this.list.filter((e) => e.wantMid).length} with a middle level to build), ${seen.size} materials compiled in ${Math.round(performance.now() - t0)} ms`);
  }
}
