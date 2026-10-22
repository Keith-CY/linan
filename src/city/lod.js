// View-dependent level of detail for things placed by the thousand (houses, boats, bridges, props).
//
//   viewDist(x, z, r = 0, { margin }) → distance (m, horizontal) from the nearest shot camera whose horizontal view
//                                       cone contains the point (± its radius), or Infinity when no camera sees it
//   lodFor(d, [d0, d1, …])             → index of the first threshold d is below (thresholds.length when farther)
// The cameras are the fixed shot cameras of src/world/shots.js (plus engine.registry.extraCams if a module adds any).
import { planCams, planVersion } from '../world/plancams.js';

const ASPECT = 1664 / 928;
let CAMS = null, CAMS_V = -1;
function cams(extra = []) {
  if (CAMS && !extra.length && CAMS_V === planVersion()) return CAMS;
  const list = [...planCams(), ...extra].map((s) => {
    const dx = s.target[0] - s.pos[0], dz = s.target[2] - s.pos[2], l = Math.hypot(dx, dz) || 1;
    const tanV = Math.tan(((s.fov || 40) * Math.PI) / 360);
    const half = Math.atan(tanV * ASPECT);
    // pitch: how far below the horizon the camera looks (aerial cameras see the ground right under them)
    const pitch = Math.atan2(s.target[1] - s.pos[1], l);
    return { id: s.id, x: s.pos[0], y: s.pos[1], z: s.pos[2], fx: dx / l, fz: dz / l, half, cosHalf: Math.cos(half), pitch, vhalf: Math.atan(tanV) };
  });
  if (!extra.length) { CAMS = list; CAMS_V = planVersion(); }
  return list;
}

/** horizontal distance to the nearest camera that can see (x, z); Infinity if none */
export function viewDist(x, z, r = 0, { margin = 0.12, extra = [] } = {}) {
  let best = Infinity;
  for (const c of cams(extra)) {
    const dx = x - c.x, dz = z - c.z, d = Math.hypot(dx, dz);
    if (d < r + 5) { best = Math.min(best, d); continue; }
    const ang = Math.acos(Math.max(-1, Math.min(1, (dx * c.fx + dz * c.fz) / d)));
    if (ang - Math.atan2(r, d) > c.half + margin) continue;
    // below the bottom edge of the frame (too close under an aerial camera) still counts: shadows, the near frame
    best = Math.min(best, d);
  }
  return best;
}

export function lodFor(d, thresholds) {
  for (let i = 0; i < thresholds.length; i++) if (d < thresholds[i]) return i;
  return thresholds.length;
}

/** the shot cameras as plain records (for modules that need them) */
export function shotCams() { return cams(); }
