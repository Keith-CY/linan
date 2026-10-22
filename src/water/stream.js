// Stream water: the surface of a stream that runs above the lake datum (layout VALLEYS with `water`,
// heightfield.js streamWaterAt), so the 冷泉溪 at 灵隐 and its pool in front of the 布袋 cliff (ink08: open water in the
// lower left of the shot-8 view) hold water. The lake's surface (surface.js) is one mirror at the lake level; a stream
// 25 m up the valley gets its own flat sheets instead: a grid over the stretch, kept only where the ground lies below the
// stream's level (plus one cell of margin, so the banks cut the shoreline), each vertex at the level of its nearest
// point on the stream. Classed as water in the ink G-buffer (mesh name 'waterSurface', userData.isWater).
//
//   import { buildStreams } from '../water/stream.js';
//   const mesh = buildStreams({ footprints: engine.footprints });   // a THREE.Mesh (or null when no stream has water)
// With `footprints`, the wet ground is registered (tag 'water': circles ~3 m apart) so plants keep out of the water.
import * as THREE from 'three';
import * as L from '../world/layout.js';
import { heightAt, streamWaterAt, distPolyline, pointOnPolyline } from '../world/heightfield.js';

/** the stretches that get water: [x0, z0, x1, z1] boxes (the 灵隐 valley: shot 8 and the walk along 冷泉溪) */
export const STREAM_BOXES = [[-4260, 340, -3440, 500]];

export function buildStreams({ step = 1.5, band = 18, boxes = STREAM_BOXES, footprints = null } = {}) {
  const t0 = performance.now();
  const pos = [], idx = [];
  let wet = 0;
  for (const V of L.VALLEYS || []) {
    if (V.water === undefined || !V.floor) continue;
    // the stream's level along its line (streamWaterAt at the line's own point, which lies on the bed), per metre of arc
    let total = 0;
    for (let i = 0; i < V.points.length - 1; i++) total += Math.hypot(V.points[i + 1][0] - V.points[i][0], V.points[i + 1][1] - V.points[i][1]);
    const levC = new Map();
    const levelAt = (t) => {
      const k = Math.round(t * total);
      if (!levC.has(k)) { const p = pointOnPolyline(V.points, k / total); levC.set(k, streamWaterAt(p.x, p.z)); }
      return levC.get(k);
    };
    for (const [x0, z0, x1, z1] of boxes) {
      const nx = Math.ceil((x1 - x0) / step) + 1, nz = Math.ceil((z1 - z0) / step) + 1;
      const lev = new Float32Array(nx * nz).fill(NaN);
      const near = new Uint8Array(nx * nz);
      // only near the stream's line or its pools
      const pools = V.pools || [];
      for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
        const x = x0 + i * step, z = z0 + j * step;
        const dp = distPolyline(x, z, V.points);
        let ok = dp.d < band;
        for (const P of pools) if (!ok && Math.hypot((x - P.c[0]) / (P.r[0] + 8), (z - P.c[1]) / (P.r[1] + 8)) < 1) ok = true;
        if (!ok) continue;
        near[j * nx + i] = 1;
        const w = levelAt(dp.t);
        if (w > -1e9 && heightAt(x, z) < w) lev[j * nx + i] = w;
      }
      // dry vertices next to wet ones take their neighbours' level (the bank cuts the sheet at the shoreline)
      const L2 = lev.slice();
      for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
        const k = j * nx + i;
        if (!Number.isNaN(lev[k]) || !near[k]) continue;
        let s = 0, n = 0;
        for (let b = -1; b <= 1; b++) for (let a = -1; a <= 1; a++) {
          const ii = i + a, jj = j + b;
          if (ii < 0 || jj < 0 || ii >= nx || jj >= nz) continue;
          const v = lev[jj * nx + ii];
          if (!Number.isNaN(v)) { s += v; n++; }
        }
        if (n) L2[k] = s / n;
      }
      // the water keeps plants out (every other vertex: circles 3 m apart over the wet ground)
      if (footprints) for (let j = 0; j < nz; j += 2) for (let i = 0; i < nx; i += 2) if (!Number.isNaN(lev[j * nx + i])) { footprints.addCircle(x0 + i * step, z0 + j * step, step * 1.3, 'water'); wet++; }
      const vid = new Int32Array(nx * nz).fill(-1);
      const vert = (i, j) => {
        const k = j * nx + i;
        if (vid[k] < 0) { vid[k] = pos.length / 3; pos.push(x0 + i * step, L2[k], z0 + j * step); }
        return vid[k];
      };
      for (let j = 0; j < nz - 1; j++) for (let i = 0; i < nx - 1; i++) {
        const k00 = j * nx + i, k10 = k00 + 1, k01 = k00 + nx, k11 = k01 + 1;
        // a cell with water at one of its corners at least, and a level at every corner
        if (Number.isNaN(lev[k00]) && Number.isNaN(lev[k10]) && Number.isNaN(lev[k01]) && Number.isNaN(lev[k11])) continue;
        if (Number.isNaN(L2[k00]) || Number.isNaN(L2[k10]) || Number.isNaN(L2[k01]) || Number.isNaN(L2[k11])) continue;
        const a = vert(i, j), b = vert(i + 1, j), c = vert(i, j + 1), d = vert(i + 1, j + 1);
        idx.push(a, c, b, b, c, d);
      }
    }
  }
  if (!idx.length) return null;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  // a dark, still stream that mirrors the sky (the IBL) and the light; the ink painter washes it from its own class
  const mat = new THREE.MeshStandardMaterial({ name: 'streamWater', color: 0x1d2522, roughness: 0.14, metalness: 0.0 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'waterSurface';
  mesh.userData.isWater = true;
  mesh.userData.isStream = true;
  mesh.userData.noHeightCapture = true;
  mesh.castShadow = false; mesh.receiveShadow = true;
  console.log(`[water] streams: ${idx.length / 3} triangles, ${wet} footprints in ${Math.round(performance.now() - t0)} ms`);
  return mesh;
}
