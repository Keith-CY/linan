// Small carved figures for the niches around the 布袋弥勒 (飞来峰): a seated Buddha, a seated 罗汉 (arhat) and a
// standing bodhisattva / disciple. Signed distance fields in UNIT HEIGHT (base 0 → top 1), face along +Z, the
// caller scales them. Weathering (erosion lumps) is included; the niche itself is carved by the caller.
import { Simplex } from '../core/noise.js';
import { sqrt, abs, min, max, smin, smax, ell, sph, tcap, sstep } from './sdf.js';

const N1 = new Simplex(7101), N2 = new Simplex(7102);
const E = (x, y, z, cx, cy, cz, rx, ry, rz) => ell(x - cx, y - cy, z - cz, rx, ry, rz);

function weather(d, x, y, z, s) {
  return d + s * (0.004 * N1.noise3(x * 7, y * 7, z * 7) + 0.0015 * N2.noise3(x * 23, y * 23, z * 23));
}

/** seated Buddha in meditation on a lotus base with a mandorla behind (unit height); arhat = bald, no ushnisha */
export function seatedFigure(x, y, z, o = {}) {
  const ax = abs(x);
  if (ax > 0.5 || y < -0.15 || y > 1.08 || z < -0.3 || z > 0.45) return Math.max(ax - 0.5, -0.15 - y, y - 1.08, -0.3 - z, z - 0.45, 0) + 0.02;
  // lotus base: a drum with petal bumps
  let d = max(sqrt(x * x + (z - 0.02) * (z - 0.02)) - 0.38 - 0.02 * abs(Math.cos(Math.atan2(z, x) * 7)), abs(y + 0.04) - 0.065);
  // crossed legs
  d = smin(d, E(x, y, z, 0, 0.1, 0.05, 0.36, 0.105, 0.21), 0.04);
  for (const s of [-1, 1]) d = smin(d, tcap(x, y, z, s * 0.25, 0.1, 0.12, -s * 0.05, 0.11, 0.2, 0.075, 0.06), 0.03);
  // torso, shoulders, arms
  d = smin(d, E(x, y, z, 0, 0.38, -0.02, 0.19, 0.22, 0.135), 0.06);
  d = smin(d, E(x, y, z, 0, 0.53, -0.03, 0.22, 0.075, 0.12), 0.06);
  for (const s of [-1, 1]) {
    d = smin(d, tcap(x, y, z, s * 0.2, 0.52, -0.03, s * 0.24, 0.3, 0.04, 0.06, 0.055), 0.04);
    d = smin(d, tcap(x, y, z, s * 0.24, 0.3, 0.04, s * 0.08, 0.22, 0.15, 0.055, 0.05), 0.04);
  }
  // hands in the lap (dhyana) / on the knee (arhat)
  d = smin(d, E(x, y, z, 0, 0.215, 0.165, 0.12, 0.045, 0.07), 0.03);
  // robe hem over the shins, a few folds
  if (y < 0.24 && z > 0) d = smax(d, -max(abs(y - 0.13 - 0.06 * sstep(0, 0.3, ax)) - 0.008, 0.25 - z - 0.0), 0.01);
  for (let k = 0; k < 3; k++) { const yy = 0.32 + k * 0.07; d = smax(d, -tcap(x, y, z, -0.15, yy + 0.03, 0.11, 0.15, yy - 0.02, 0.11, 0.009, 0.009), 0.012); }
  // head, ears, ushnisha
  d = smin(d, E(x, y, z, 0, 0.615, 0.0, 0.07, 0.06, 0.07), 0.04);   // neck
  d = smin(d, E(x, y, z, 0, 0.72, 0.015, 0.1, 0.12, 0.105), 0.03);
  d = smin(d, E(ax, y, z, 0.095, 0.7, 0.0, 0.025, 0.07, 0.035), 0.02);
  if (!o.arhat) d = smin(d, sph(x, y - 0.855, z, 0.058), 0.03);
  // face hints: brow shadow, nose
  if (z > 0.06 && y > 0.66 && y < 0.78) d = smax(d, -E(ax, y, z, 0.04, 0.74, 0.12, 0.035, 0.012, 0.02), 0.01);
  d = smin(d, tcap(x, y, z, 0, 0.74, 0.11, 0, 0.69, 0.125, 0.012, 0.018), 0.012);
  // halo behind the head (Buddha only; a flat relief ring on the back wall)
  if (!o.arhat) d = smin(d, max(abs(sqrt(x * x + (y - 0.74) * (y - 0.74)) - 0.17) - 0.025, abs(z + 0.2) - 0.03), 0.02);
  return weather(d, x, y, z, 1);
}

/** standing figure (bodhisattva / disciple), hands joined at the chest, halo behind the head (unit height) */
export function standingFigure(x, y, z) {
  const ax = abs(x);
  if (ax > 0.3 || y < -0.06 || y > 1.05 || z < -0.2 || z > 0.26) return Math.max(ax - 0.3, -0.06 - y, y - 1.05, -0.2 - z, z - 0.26, 0) + 0.02;
  // robe: shoulders → straight fall → a hem flaring over the feet; long vertical folds below the hands
  const w = 0.125 + 0.03 * sstep(0.35, 0.05, y) + 0.012 * sstep(0.6, 0.72, y);
  let d = ell(x / w, (y - 0.4) / 0.36, (z - 0.01) / (w * 0.72), 1, 1, 1) * w;
  d = max(d, abs(y - 0.4) - 0.36);
  d = min(d, E(x, y, z, 0, 0.72, -0.005, 0.165, 0.07, 0.1));                           // shoulders
  d = smin(d, E(x, y, z, 0, 0.6, 0.0, 0.14, 0.14, 0.095), 0.05);                         // chest
  const th = Math.atan2(x, z);
  d -= 0.008 * abs(Math.sin(th * 6 + y * 2.5)) * sstep(0.55, 0.15, y);
  // sleeves falling from the elbows to the knees, the joined hands at the chest
  for (const s of [-1, 1]) {
    d = smin(d, tcap(x, y, z, s * 0.15, 0.7, 0.0, s * 0.16, 0.55, 0.05, 0.045, 0.045), 0.03);
    d = smin(d, tcap(x, y, z, s * 0.16, 0.55, 0.05, s * 0.03, 0.6, 0.12, 0.04, 0.03), 0.03);
    d = smin(d, E(x, y, z, s * 0.155, 0.4, 0.04, 0.05, 0.16, 0.06), 0.04);
  }
  d = smin(d, E(x, y, z, 0, 0.625, 0.13, 0.035, 0.065, 0.035), 0.02);
  // head, topknot, ears
  d = smin(d, E(x, y, z, 0, 0.8, 0.0, 0.045, 0.04, 0.045), 0.03);
  d = smin(d, E(x, y, z, 0, 0.875, 0.012, 0.062, 0.075, 0.066), 0.02);
  d = smin(d, sph(x, y - 0.96, z + 0.005, 0.034), 0.02);
  d = smin(d, E(ax, y, z, 0.06, 0.865, 0.0, 0.014, 0.04, 0.02), 0.01);
  if (z > 0.05 && y > 0.85 && y < 0.92) d = smax(d, -E(ax, y, z, 0.024, 0.885, 0.072, 0.02, 0.008, 0.012), 0.006);
  // feet and the lotus base
  for (const s of [-1, 1]) d = smin(d, E(x, y, z, s * 0.05, 0.03, 0.11, 0.035, 0.022, 0.055), 0.02);
  d = smin(d, max(sqrt(x * x + (z - 0.02) * (z - 0.02)) - 0.19 - 0.012 * abs(Math.cos(Math.atan2(z, x) * 8)), abs(y + 0.025) - 0.035), 0.02);
  // halo behind the head
  d = smin(d, max(sqrt(x * x + (y - 0.87) * (y - 0.87)) - 0.15, abs(z + 0.11) - 0.018), 0.015);
  return weather(d, x, y, z, 0.8);
}
