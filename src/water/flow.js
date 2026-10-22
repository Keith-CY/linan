// Flow field for the water shader (src/water/surface.js), RGBA8:
//   R,G : horizontal velocity (m/s), encoded v / (2*VMAX) + 0.5
//   B   : turbulence (white water) 0..1
//   A   : "current" mask 0..1 (1 = running river, 0 = still lake)
// West Lake is still water: the default map is a calm field with a very slow, spatially varying drift
// (wind drift ~1-3 cm/s) so the ripple tile advects a little in the video instead of standing frozen.
// A river / tide module can replace it later (registry.water.setFlow).
import * as THREE from 'three';
import { Simplex } from '../core/noise.js';

export const VMAX = 4.0;

/**
 * @param {object} o
 * @param {number[]} o.bounds [x0, z0, x1, z1] world metres
 * @param {number} [o.res] texels on the long side
 * @param {number} [o.drift] typical drift speed (m/s)
 * @param {number[]} [o.dir] mean drift direction [dx, dz]
 */
export function buildStillFlow({ bounds, res = 128, drift = 0.02, dir = [0.8, 0.6], seed = 11 } = {}) {
  const t0 = performance.now();
  const [x0, z0, x1, z1] = bounds;
  const asp = (x1 - x0) / (z1 - z0);
  const W = asp >= 1 ? res : Math.round(res * asp), H = asp >= 1 ? Math.round(res / asp) : res;
  const n = new Simplex(seed);
  const data = new Uint8Array(W * H * 4);
  const dl = Math.hypot(dir[0], dir[1]) || 1;
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const x = x0 + ((i + 0.5) / W) * (x1 - x0), z = z0 + ((j + 0.5) / H) * (z1 - z0);
    const a = n.noise2(x / 900, z / 900) * 1.2;
    const s = drift * (0.6 + 0.4 * n.noise2(x / 600 + 7, z / 600));
    const c = Math.cos(a), sn = Math.sin(a);
    const vx = (dir[0] / dl * c - dir[1] / dl * sn) * s, vz = (dir[0] / dl * sn + dir[1] / dl * c) * s;
    const k = (j * W + i) * 4;
    data[k] = Math.round((vx / (2 * VMAX) + 0.5) * 255);
    data[k + 1] = Math.round((vz / (2 * VMAX) + 0.5) * 255);
    data[k + 2] = 0;
    data[k + 3] = 0;
  }
  const tex = new THREE.DataTexture(data, W, H, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.minFilter = THREE.LinearFilter; tex.magFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.colorSpace = THREE.NoColorSpace;
  tex.needsUpdate = true;
  return { tex, bounds, W, H, ms: Math.round(performance.now() - t0) };
}
