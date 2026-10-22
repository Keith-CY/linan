// The stills' water depth for the explorable world. The offline water (src/modules/water.js) captures its height maps
// (the lake, the city's canals, the river) from the meshed terrain of all ten shots' quadtrees (src/modules/terrain.js
// buildTerrain: one set per shot, planned from its cameras), drawn from above with the highest surface kept where sets
// overlap, so the coarse sets of the far cameras give the shores gentler, shallower water than the analytic
// heightfield. The explorable world streams its terrain and fills the same maps from heightAt in the workers; its
// water was deeper near every shore (2.7 m against 0.4–0.9 m in front of 断桥), so the winter shore ice of shot 10, the
// shore foam and soft edges, and through them the frame's auto levels, differed from the stills.
//
// After the load, in the background: the offline sets' leaves over each map's bounds are meshed in the height workers
// (low priority, in batches; leaves the stream already meshed for a still are reused), drawn from above into a float
// target exactly as src/water/heightmap.js captures them, and each map's data and texture are replaced in place (the
// water, the region switch, the mist and the depth sampler all hold these objects). Texels no leaf covers keep their
// analytic height, as the capture's holes do.
//
//   const done = stillWaterMaps(engine)   → Promise (engine.registry.stillWater); the still view waits for it at a viewpoint
import * as THREE from 'three';
import { SHOTS } from '../world/shots.js';
import { extraCamsOf } from '../world/plancams.js';
import { planLeaves } from '../terrain/mesh.js';
import { getHeightPool } from './heightpool.js';

// src/modules/terrain.js buildTerrain at the stills' quality
const SET = { theta: 0.0065, outside: 3, minCell: 0.75, N: 32 };
const BATCH = 48, ROWS = 128;

const capMat = () => new THREE.ShaderMaterial({
  vertexShader: 'varying float vY; void main(){ vec4 wp = modelMatrix * vec4(position, 1.0); vY = wp.y; gl_Position = projectionMatrix * viewMatrix * wp; }',
  fragmentShader: 'varying float vY; void main(){ gl_FragColor = vec4(vY, 1.0, 0.0, 1.0); }',
  side: THREE.DoubleSide,
});

/** box-filtered mips of a W×H float image, each as half floats (as src/water/heightmap.js builds them) */
function halfMips(data, w, h) {
  const toHalf = THREE.DataUtils.toHalfFloat, out = [];
  let cw = w, ch = h, cur = data;
  for (;;) {
    const hd = new Uint16Array(cur.length);
    for (let i = 0; i < cur.length; i++) hd[i] = toHalf(cur[i]);
    out.push({ data: hd, width: cw, height: ch });
    if (cw <= 1 && ch <= 1) break;
    const nw = Math.max(1, cw >> 1), nh = Math.max(1, ch >> 1), nd = new Float32Array(nw * nh);
    for (let j = 0; j < nh; j++) for (let i = 0; i < nw; i++) {
      const i0 = Math.min(cw - 1, i * 2), i1 = Math.min(cw - 1, i * 2 + 1), j0 = Math.min(ch - 1, j * 2), j1 = Math.min(ch - 1, j * 2 + 1);
      nd[j * nw + i] = 0.25 * (cur[j0 * cw + i0] + cur[j0 * cw + i1] + cur[j1 * cw + i0] + cur[j1 * cw + i1]);
    }
    cw = nw; ch = nh; cur = nd;
  }
  return out;
}

const yieldFrame = () => new Promise((r) => setTimeout(r, 0));

/** one map recaptured from the leaves over its bounds */
async function recapture(engine, map, sets, cache) {
  const [x0, z0, x1, z1] = map.bounds, W = map.W, H = map.H;
  const leaves = new Map();
  for (const S of sets) for (const lf of S) if (lf.x0 < x1 && lf.x0 + lf.size > x0 && lf.z0 < z1 && lf.z0 + lf.size > z0) leaves.set(`${lf.x0},${lf.z0},${lf.size}`, lf);
  const r = engine.renderer;
  const rt = new THREE.WebGLRenderTarget(W, H, { type: THREE.FloatType, format: THREE.RGBAFormat, depthBuffer: true, stencilBuffer: false, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, generateMipmaps: false });
  const cam = new THREE.OrthographicCamera(x0, x1, -z0, -z1, 1, 30000);
  cam.position.set(0, 12000, 0); cam.up.set(0, 0, -1); cam.lookAt(0, 0, 0); cam.updateMatrixWorld(true);
  const mat = capMat();
  const draw = (fn) => {
    const prevRT = r.getRenderTarget(), prevAuto = r.autoClear, prevShadow = r.shadowMap.autoUpdate, prevClear = r.getClearColor(new THREE.Color()), prevAlpha = r.getClearAlpha();
    r.shadowMap.autoUpdate = false; r.autoClear = false;
    r.setRenderTarget(rt);
    try { fn(); } finally { r.setRenderTarget(prevRT); r.setClearColor(prevClear, prevAlpha); r.autoClear = prevAuto; r.shadowMap.autoUpdate = prevShadow; }
  };
  draw(() => { r.setClearColor(0x000000, 0); r.clear(true, true, false); });
  const pool = getHeightPool(), list = [...leaves.values()];
  for (let b = 0; b < list.length; b += BATCH) {
    const part = await Promise.all(list.slice(b, b + BATCH).map((lf) => {
      const hit = cache?.get(`${lf.x0},${lf.z0},${lf.size}/${SET.N}`);
      if (hit) return { geo: hit.mesh.geometry, own: false };
      return pool.leaf(lf, SET.N, true).then((m) => {
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(m.position, 3));
        g.setIndex(new THREE.BufferAttribute(m.index, 1));
        return { geo: g, own: true };
      });
    }));
    const scene = new THREE.Scene();
    for (const p of part) { const m = new THREE.Mesh(p.geo, mat); m.frustumCulled = false; m.matrixAutoUpdate = false; scene.add(m); }
    draw(() => r.render(scene, cam));
    for (const p of part) if (p.own) p.geo.dispose();
    await yieldFrame();
  }
  // read back in strips; row 0 of the target is world z1 (as src/water/heightmap.js stores it: row j ↔ z0 + (j + .5) dz)
  const px = new Float32Array(W * ROWS * 4), data = map.data;
  let set = 0;
  for (let y0 = 0; y0 < H; y0 += ROWS) {
    const n = Math.min(ROWS, H - y0);
    r.readRenderTargetPixels(rt, 0, y0, W, n, px);
    for (let q = 0; q < n; q++) {
      const j = H - 1 - (y0 + q);
      for (let i = 0; i < W; i++) { const k = (q * W + i) * 4; if (px[k + 1] > 0.5) { data[j * W + i] = px[k]; set++; } }
    }
    await yieldFrame();
  }
  rt.dispose(); mat.dispose();
  // the texture in place: same object, new mips
  const mips = halfMips(data, W, H);
  map.tex.image.data = mips[0].data;
  map.tex.mipmaps = mips;
  map.tex.needsUpdate = true;
  return { leaves: list.length, covered: +((set / (W * H)) * 100).toFixed(1) };
}

export function stillWaterMaps(engine) {
  const R = engine.registry, Wt = R.water;
  if (!Wt?.maps?.near?.tex || !Wt.maps.near.data) return Promise.resolve(null);
  const t0 = performance.now();
  const extra = R.terrainCams || [];
  const sets = SHOTS.map((s) => planLeaves([s, ...extraCamsOf(s.id), ...extra], SET));
  const seen = new Set();
  const maps = [['lake', Wt.maps.near], ['city', Wt.regions?.city], ['river', Wt.regions?.river]].filter(([, m]) => m?.tex && m.data && !seen.has(m) && seen.add(m));
  const cache = R.terrain?.stream?.cache;
  const p = (async () => {
    const out = {};
    for (const [name, m] of maps) out[name] = await recapture(engine, m, sets, cache);
    console.log(`[explore] water depth as the stills': ${Object.entries(out).map(([k, v]) => `${k} ${v.leaves} leaves (${v.covered} %)`).join(', ')} in ${Math.round(performance.now() - t0)} ms`);
    return out;
  })().catch((e) => { console.error('[explore] water depth failed', e); return null; });
  R.stillWater = p;
  return p;
}
