// Ink mode G-buffer (?look=ink): every material in the scene gets three extra fragment outputs (MRT), written only
// when the ink G-buffer target is bound (on single-target passes the extra outputs have no attachment and are dropped,
// so the photoreal accumulation is unchanged).
//
//   gInkA = (view normal x, view normal y, linear view depth (m), class id)
//   gInkB = (sun irradiance on the surface (N·L × shadow × sun), sky irradiance (× AO), albedo luminance, emissive)
//   gInkC = (object / instance origin − camera position (xyz, m), 1)   → tree masses: one origin per tree
//
// The class ids (CLS) come from the material name, the mesh name and the module that built the mesh
// (engine.moduleRoots). A mesh whose class differs from its material's (the 布袋 figure shares the cliff material)
// draws the G-buffer pass with its own clone of the material for that class (a uniform set in onBeforeRender is not
// re-uploaded between consecutive draws of one material, so the whole cliff took one class).
import * as THREE from 'three';

export const CLS = {
  SKY: 0, GROUND: 1, ROCK: 2, WATER: 3, ROOF: 4, WOOD: 5, WALL: 6, STONE: 7, PINE: 8, WILLOW: 9, BROAD: 10,
  BARK: 11, FIGURE: 12, GLOW: 13, BOAT: 14, SMALL: 15, BLOSSOM: 16, WAVE: 17, MAPLE: 18, CITYFAR: 19, SNOW: 20,
  DARK: 21, METAL: 22, GINKGO: 23, LOTUS: 24, NICHE: 25,
  IVY: 26, PAVE: 27,    // vines hanging on rock (drawn, not faint marks); paved paths and streets (pale strips)
  BLOOM: 28,             // lotus flowers (white-pink petals drawn with a fine line, ink03)
};

/** class of a mesh + material (null = keep out of the G-buffer) */
export function classify(mesh, mat, module) {
  const n = mat.name || '', on = mesh.name || '';
  if (mesh.userData.isWater) return on === 'waterSurface' || n === 'waterSurface' ? CLS.WATER : null;
  if (n === 'lakeMist' || n === 'citySmoke' || n === 'boreSpray' || n === 'cityShadowOnly') return null;
  if (mat.colorWrite === false) return null;
  if (n === 'boreWall' || module === 'tide') return CLS.WAVE;
  if (n.startsWith('veg-')) {
    const s = n.slice(4);
    if (s.startsWith('bark')) return CLS.BARK;
    if (s.startsWith('pine')) return CLS.PINE;
    if (s.startsWith('willow')) return CLS.WILLOW;
    if (s.startsWith('maple')) return CLS.MAPLE;
    if (s.startsWith('ginkgo')) return CLS.GINKGO;
    if (s.startsWith('lotus-leaf')) return CLS.LOTUS;
    // (the peach's young leaves too: ink02 paints a peach tree as dark twigs and dots of pale pink)
    if (s.startsWith('lotus-petal') || s.startsWith('lotus-heart')) return CLS.BLOOM;
    if (s.startsWith('blossom') || s.startsWith('peach') || s.startsWith('litterPetal')) return CLS.BLOSSOM;
    if (s.startsWith('camphor') || s.startsWith('broad') || s.startsWith('shrub')) return CLS.BROAD;
    if (s.startsWith('ivy')) return CLS.IVY;     // vines over the cliff (ink08: hanging strands with leaves)
    return CLS.SMALL; // grass, reed, fern, litter, lotus leaves and stalks
  }
  if (n === 'terrain' || module === 'terrain') return CLS.GROUND;
  // the carving (figure / niche / rock) is told apart per fragment from the baked carved mask (vKRock.z), see fragTail
  if (n.startsWith('karst')) return CLS.ROCK;
  if (n.startsWith('rocks')) return CLS.ROCK;
  if (n === 'yzTile') return CLS.ROOF;
  if (n === 'yzWood') return CLS.WOOD;
  if (n === 'yzPlaster') return CLS.WALL;
  if (on === 'yujie-paving') return CLS.PAVE;
  if (n === 'yzStone' || n === 'brStone') return CLS.STONE;
  if (n === 'yzGlow') return CLS.GLOW;
  if (n === 'yzDark') return CLS.DARK;
  if (n === 'yzMetal') return CLS.METAL;
  if (n === 'bridgeSnow') return CLS.SNOW;
  if (n === 'boat' || n === 'cityCloth' || module === 'boats') return CLS.BOAT;
  if (n === 'cityFar') return CLS.CITYFAR;
  if (mesh.userData.isSky || module === 'sky') return CLS.SKY;
  if (module === 'karst' || module === 'rocks') return CLS.ROCK;
  if (module === 'yingzao' || module === 'pagodas' || module === 'city' || module === 'bridges') return CLS.STONE;
  if (module === 'vegetation') return CLS.SMALL;
  return CLS.GROUND;
}

const OUT_DECL = /* glsl */`
layout(location = 1) out highp vec4 gInkA;
layout(location = 2) out highp vec4 gInkB;
layout(location = 3) out highp vec4 gInkC;
uniform float uInkClass;
#ifdef INK_ORG
varying vec3 vInkOrg;
#endif
`;

function fragTail(std) {
  return /* glsl */`
  {
    vec3 inkN = vec3(0.0);
    float inkSun = -1.0, inkSky = -1.0, inkAlb = -1.0, inkEm = 0.0;
    ${std ? `
    inkN = normalize(nonPerturbedNormal);
    float inkA = max(dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722)), 1e-3);
    inkSun = dot(reflectedLight.directDiffuse, vec3(0.2126, 0.7152, 0.0722)) * 3.14159265 / inkA;
    inkSky = dot(reflectedLight.indirectDiffuse, vec3(0.2126, 0.7152, 0.0722)) * 3.14159265 / inkA;
    inkAlb = inkA;
    inkEm = dot(totalEmissiveRadiance, vec3(0.2126, 0.7152, 0.0722));` : ''}
    float inkD = uInkClass < 0.5 ? 50000.0 : 1.0 / gl_FragCoord.w;
    float inkCls = uInkClass;
    #ifdef INK_PAVE
    // the terrain's slab paths (src/terrain/material.js inkPave): a paved strip, not ground
    if (abs(inkCls - ${CLS.GROUND}.0) < 0.5 && inkPave > 0.5) inkCls = ${CLS.PAVE}.0;
    #endif
    #ifdef INK_KROCK
    // karst: the baked carved mask is 1 on the figures, ~0.75 on the niche walls, 0 on natural rock
    if (abs(inkCls - ${CLS.ROCK}.0) < 0.5) inkCls = vKRock.z > 0.86 ? ${CLS.FIGURE}.0 : vKRock.z > 0.4 ? ${CLS.NICHE}.0 : inkCls;
    #endif
    gInkA = vec4(inkN.xy, inkD, inkCls);
    gInkB = vec4(inkSun, inkSky, inkAlb, inkEm);
    #ifdef INK_ORG
    gInkC = vec4(vInkOrg - cameraPosition, 1.0);
    #else
    gInkC = vec4(0.0, 0.0, 0.0, 0.0);
    #endif
  }
`;
}

const VERT_ORG = /* glsl */`
#if defined( USE_BATCHING )
  vInkOrg = ( modelMatrix * batchingMatrix * vec4( 0.0, 0.0, 0.0, 1.0 ) ).xyz;
#elif defined( USE_INSTANCING )
  vInkOrg = ( modelMatrix * instanceMatrix * vec4( 0.0, 0.0, 0.0, 1.0 ) ).xyz;
#else
  vInkOrg = ( modelMatrix * vec4( 0.0, 0.0, 0.0, 1.0 ) ).xyz;
#endif
`;

/** add the ink outputs to one material (idempotent). cls: the material's default class */
export function patchInkMaterial(mat, cls) {
  if (mat.userData.__inkPatched) return;
  mat.userData.__inkPatched = true;
  const U = { value: cls };
  mat.userData.inkClassU = U;
  const std = !!(mat.isMeshStandardMaterial);
  const prev = mat.onBeforeCompile;
  mat.userData.inkPrevCompile = prev;
  mat.onBeforeCompile = function (shader, renderer) {
    if (prev) prev.call(this, shader, renderer);
    shader.uniforms.uInkClass = U;
    let vs = shader.vertexShader, fs = shader.fragmentShader;
    const org = vs.includes('#include <project_vertex>');
    if (org) {
      vs = '#define INK_ORG\nvarying vec3 vInkOrg;\n' + vs.replace('#include <project_vertex>', '#include <project_vertex>\n' + VERT_ORG);
    }
    // GLSL3 materials that declare their own unlocated output cannot take located ones: leave them alone
    if (/\bout\s+(highp\s+|mediump\s+|lowp\s+)?vec4\s+\w+\s*;/.test(fs) && !fs.includes('layout(')) return;
    fs = (org ? '#define INK_ORG\n' : '') + (/varying\s+vec4\s+vKRock\s*;/.test(fs) ? '#define INK_KROCK\n' : '') + (/\bfloat\s+inkPave\s*;/.test(fs) ? '#define INK_PAVE\n' : '') + OUT_DECL + fs;
    const end = fs.lastIndexOf('}');
    fs = fs.slice(0, end) + fragTail(std && fs.includes('#include <lights_fragment_end>')) + fs.slice(end);
    shader.vertexShader = vs; shader.fragmentShader = fs;
  };
  const key = mat.customProgramCacheKey;
  if (key && key !== THREE.Material.prototype.customProgramCacheKey) mat.userData.inkBaseKey = key;
  const base = key && key !== THREE.Material.prototype.customProgramCacheKey ? key.bind(mat) : () => (prev ? prev.toString() : '');
  mat.customProgramCacheKey = () => base() + '|ink';
  mat.needsUpdate = true;
}

/** classify and patch every material in the scene (run after the world build and again for late meshes) */
export function patchScene(engine) {
  const mod = new Map();
  for (const [name, roots] of Object.entries(engine.moduleRoots || {})) for (const r of roots) r.traverse((o) => mod.set(o, name));
  if (engine.sky) engine.sky.traverse((o) => { mod.set(o, 'sky'); o.userData.isSky = true; });
  let n = 0;
  engine.scene.traverse((o) => {
    if (!o.material || o.userData.__inkSeen) return;
    o.userData.__inkSeen = true;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    const m0 = mats[0];
    const cls = classify(o, m0, mod.get(o));
    if (cls === null) { o.userData.inkHide = true; return; }
    for (const m of mats) {
      if (!m.userData.__inkPatched) { patchInkMaterial(m, cls); n++; }
    }
    if (!Array.isArray(o.material) && m0.userData.inkClassU && m0.userData.inkClassU.value !== cls) {
      // the mesh's class differs from its (shared) material's: the G-buffer pass draws it with a clone for its class
      const byCls = (m0.userData.inkClones ||= {});
      if (!byCls[cls]) {
        const c = m0.clone();
        c.userData = {};
        c.onBeforeCompile = m0.userData.inkPrevCompile || (() => {});
        const key = m0.userData.inkBaseKey;
        if (key) c.customProgramCacheKey = key;
        patchInkMaterial(c, cls);
        byCls[cls] = c;
      }
      o.userData.inkMaterial = byCls[cls];
    }
    if (m0.transparent && cls !== CLS.WATER) o.userData.inkHide = true;
  });
  if (n) console.log(`[ink] patched ${n} materials`);
}

/** the G-buffer target: 4 attachments (colour is unused), half float, own depth */
export function makeGBuffer(w, h) {
  const rt = new THREE.WebGLRenderTarget(w, h, {
    count: 4, type: THREE.HalfFloatType, format: THREE.RGBAFormat, colorSpace: THREE.LinearSRGBColorSpace,
    minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: true, stencilBuffer: false, generateMipmaps: false,
  });
  return rt;
}

const WATER_LAYER = 29;
/** the water surface and its absorption (src/water/surface.js), visible ones */
function waterMeshes(scene) {
  const out = [];
  scene.traverse((o) => { if (o.userData.isWater && (o.name === 'waterSurface' || o.name === 'waterAbsorb') && o.visible) out.push(o); });
  return out.length ? out : null;
}

/** render the G-buffer with the current (unjittered) camera; transparent veils stay out */
export function renderGBuffer(engine, rt, { shadows = false } = {}) {
  const r = engine.renderer, scene = engine.scene, cam = engine.camera;
  const hidden = [], blended = [];
  const swapped = [];
  const water = shadows ? waterMeshes(scene) : null;
  scene.traverse((o) => {
    if (o.userData.inkHide && o.visible) { o.visible = false; hidden.push(o); return; }
    if (o.userData.inkMaterial) { swapped.push([o, o.material]); o.material = o.userData.inkMaterial; }
    // the water surface blends in the photo pass; in the G-buffer it must overwrite (alpha carries the class)
    const m = o.material;
    if (m && !Array.isArray(m) && m.transparent && m.blending !== THREE.NoBlending) { blended.push([m, m.blending]); m.blending = THREE.NoBlending; }
  });
  // stills: the shadow maps of the accumulated sample are reused; realtime (explore): this IS the frame, shadows update
  const sm = r.shadowMap.autoUpdate;
  if (!shadows) { r.shadowMap.autoUpdate = false; r.shadowMap.needsUpdate = false; }
  const cc = new THREE.Color(); r.getClearColor(cc); const ca = r.getClearAlpha();
  r.setRenderTarget(rt);
  r.setClearColor(0x000000, 0);
  r.clear(true, true, false);
  // clear the class / depth attachments to "sky, far"
  const gl = r.getContext();
  gl.clearBufferfv(gl.COLOR, 1, [0, 0, 50000, 0]);
  gl.clearBufferfv(gl.COLOR, 2, [-1, -1, -1, 0]);
  gl.clearBufferfv(gl.COLOR, 3, [0, 0, 0, 0]);
  if (shadows) { r.info.autoReset = false; r.info.reset(); }
  // realtime: the colour attachment is the frame's photographic tone, so the water must blend into it as it does in
  // the photograph (its shallows show the bank, the absorption darkens what lies under it) while the class / depth
  // attachments take the water whole: the water is drawn after the rest, once into attachments 1-3 (opaque), once
  // into attachment 0 (its own blending)
  if (water) for (const o of water) { o.userData._wv = true; o.visible = false; }
  r.render(scene, cam);
  if (water) {
    const NONE = gl.NONE, C = (i) => gl.COLOR_ATTACHMENT0 + i;
    const mask = cam.layers.mask;
    const smA = r.shadowMap.autoUpdate; r.shadowMap.autoUpdate = false;
    cam.layers.set(WATER_LAYER);
    const surf = water.filter((o) => o.name === 'waterSurface');
    for (const o of water) { o.layers.enable(WATER_LAYER); o.visible = false; }
    for (const o of surf) o.visible = o.userData._wv;
    gl.drawBuffers([NONE, C(1), C(2), C(3)]);
    r.render(scene, cam);
    for (const [m, b] of blended) if (surf.some((o) => o.material === m)) m.blending = b;
    for (const o of water) o.visible = o.userData._wv;
    gl.drawBuffers([C(0), NONE, NONE, NONE]);
    r.render(scene, cam);
    gl.drawBuffers([C(0), C(1), C(2), C(3)]);
    for (const o of water) { o.layers.disable(WATER_LAYER); o.visible = !o.userData.inkHide; }
    cam.layers.mask = mask;
    r.shadowMap.autoUpdate = smA;
  }
  if (shadows) engine.pipeline.sceneInfo = { calls: r.info.render.calls, triangles: r.info.render.triangles };
  r.setClearColor(cc, ca);
  r.shadowMap.autoUpdate = sm;
  for (const o of hidden) o.visible = true;
  for (const [o, m] of swapped) o.material = m;
  for (const [m, b] of blended) m.blending = b;
}
