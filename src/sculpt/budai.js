// 布袋弥勒 (the laughing Maitreya of 飞来峰, Southern Song) as a signed distance field, carved out of the cliff rock.
//
// Local frame (metres, before the placement scale): origin on the seat ledge under the belly, +Y up, +Z toward the
// viewer (the figure's front), +X to the viewer's right (the figure's left). Proportions are read off ref08 / ink08:
// crown 4.0 m above the seat; (ink08) seated cross-legged, calm and heavy: both knees low and wide under
// the robe (the right one, on the viewer's left, a little higher), the hands resting on them, the shins folded in front
// under the robe so that only the two bare feet show at the front edge of the ledge, toes to the viewer, a sash knotted
// under the belly with its ends hanging between the feet; the bare chest and belly, the robe over the shoulders, arms
// and legs, and the cloth bag under the robe on the right.
//
//   import { budaiSDF, BUDAI_BOX, budaiHeadBox } from '../sculpt/budai.js';
//   budaiSDF(x, y, z)  → distance (m, local), weathering included
//   budaiFigure(x, y, z) → the clean figure (no weathering) for masks
//
// The face is modelled in HEAD UNITS (chin -0.5, crown +0.5, face along +z) and scaled by HS. Technique (smooth
// unions of ellipsoids / tapered capsules, carved features, tube folds) after Athenaion's sculpt/face.js and
// sculpt/figure.js (MIT, NOTICE); the anatomy and the Budai are ours.
import { Simplex } from '../core/noise.js';
import { sqrt, abs, min, max, clamp, sstep, smin, smax, ell, sph, tcap, segT, hash1, rotX, rotZ, mmul } from './sdf.js';

const NA = new Simplex(6801), NB = new Simplex(6802), NC = new Simplex(6803);

// ------------------------------------------------------------------ head (head units)
export const HS = 1.68;                       // metres per head unit (chin → crown 1.84 m: the big laughing head of ref08)
export const HEAD_C = [-0.05, 3.18, 0.42];    // head centre in the figure frame (m)
const HEAD_ROT = mmul(rotX(0.10), rotZ(0.05)); // world→head: tilted slightly down (toward the viewer below) and to its right
const TAU = Math.PI * 2;

function E(x, y, z, cx, cy, cz, rx, ry, rz) { return ell(x - cx, y - cy, z - cz, rx, ry, rz); }
/** quadratic-bezier tube (approximate, sampled into n capsules) */
function btube(x, y, z, a, b, c, ra, rb, n = 6) {
  let d = 1e9, px = a[0], py = a[1], pz = a[2], pr = ra;
  for (let i = 1; i <= n; i++) {
    const t = i / n, u = 1 - t;
    const qx = u * u * a[0] + 2 * u * t * b[0] + t * t * c[0], qy = u * u * a[1] + 2 * u * t * b[1] + t * t * c[1], qz = u * u * a[2] + 2 * u * t * b[2] + t * t * c[2];
    const qr = ra + (rb - ra) * t;
    d = min(d, tcap(x, y, z, px, py, pz, qx, qy, qz, pr, qr));
    px = qx; py = qy; pz = qz; pr = qr;
  }
  return d;
}

/** the face surface depth (front z) of the face masses at (x, y): used to lay features on the skin */
function faceZ(x, y) {
  const a = 1 - (x / 0.47) ** 2 - ((y + 0.03) / 0.31) ** 2;
  return 0.10 + 0.39 * sqrt(max(0.02, a));
}

// landmarks (head units, read off ref08): eyes y 0.12, nose tip -0.02, mouth opening centre -0.17, chin -0.40,
// double chin -0.5, crown +0.5; mouth half width 0.2, eye corners at |x| 0.07 / 0.29
function headSDF(x, y, z) {
  const ax = abs(x);
  // ---- masses: big round bald skull, full face, fat smiling cheeks, round chin, double chin
  let d = E(x, y, z, 0, 0.12, -0.05, 0.44, 0.385, 0.45);                          // cranium
  d = smin(d, E(x, y, z, 0, 0.13, 0.12, 0.39, 0.26, 0.33), 0.08);                 // brow / forehead
  d = smin(d, E(x, y, z, 0, -0.03, 0.10, 0.48, 0.27, 0.385), 0.08);               // cheekbone level
  d = smin(d, E(x, y, z, 0, -0.2, 0.08, 0.49, 0.22, 0.37), 0.1);                   // jowls
  d = smin(d, sph(ax - 0.222, y + 0.05, z - 0.318, 0.2), 0.1);                    // smiling cheeks (apples, pushed up)
  d = smin(d, E(x, y, z, 0, -0.175, 0.39, 0.21, 0.12, 0.11), 0.06);               // muzzle (the mouth stands forward)
  d = smin(d, E(x, y, z, 0, -0.34, 0.25, 0.24, 0.115, 0.15), 0.09);              // chin (round)
  d = smin(d, E(x, y, z, 0, -0.455, 0.08, 0.35, 0.12, 0.3), 0.1);                 // double chin roll
  // chin crease between the chin and the second roll
  if (y < -0.3 && y > -0.52 && z > 0.05) d = smax(d, -btube(x, y, z, [-0.25, -0.385, 0.25], [0, -0.43, 0.39], [0.25, -0.385, 0.25], 0.016, 0.016, 8), 0.035);
  if (z < -0.3 && y > 0.3) return d;
  // ---- brows: soft raised arcs
  if (y > 0.1 && y < 0.36 && z > 0.2) {
    const br = btube(ax, y, z, [0.05, 0.24, 0.40], [0.17, 0.31, 0.415], [0.325, 0.215, 0.31], 0.042, 0.032, 7);
    d = smin(d, br, 0.05);
  }
  // ---- eyes: closed laughing crescents (∩) under fat upper lids, the cheeks pushing up from below, crow's feet
  if (y > 0.03 && y < 0.24 && z > 0.22 && ax > 0.03 && ax < 0.38) {
    d = smin(d, E(ax, y, z, 0.172, 0.15, faceZ(0.172, 0.15) - 0.022, 0.12, 0.06, 0.05), 0.035);           // upper lid mound (fat lids)
    d = smin(d, E(ax, y, z, 0.178, 0.055, faceZ(0.178, 0.055) - 0.02, 0.1, 0.036, 0.045), 0.03);        // under-eye puff (the cheek pushes up)
    const sl = btube(ax, y, z, [0.078, 0.098, 0.446], [0.168, 0.19, 0.47], [0.276, 0.084, 0.4], 0.016, 0.019, 10);
    d = smax(d, -sl, 0.011);                                                                             // the slit
    d = smax(d, -btube(ax, y, z, [0.088, 0.15, 0.442], [0.17, 0.252, 0.458], [0.268, 0.14, 0.394], 0.005, 0.004, 8), 0.008); // lid crease
    d = smax(d, -btube(ax, y, z, [0.105, 0.072, 0.442], [0.174, 0.122, 0.462], [0.258, 0.064, 0.402], 0.005, 0.004, 8), 0.008);  // lower lid line
    for (let k = 0; k < 2; k++) {                                                                          // crow's feet
      const a0 = -0.35 + k * 0.4;
      const ox = 0.3 + 0.065 * Math.cos(a0), oy = 0.1 + 0.065 * Math.sin(a0);
      d = smax(d, -tcap(ax, y, z, 0.295, 0.1, faceZ(0.295, 0.1) - 0.006, ox, oy, faceZ(ox, oy) - 0.01, 0.004, 0.002), 0.012);
    }
  }
  // ---- nose: broad, fleshy, round tip
  if (ax < 0.18 && y > -0.12 && y < 0.22 && z > 0.3) {
    let n = tcap(x, y, z, 0, 0.16, 0.42, 0, -0.01, 0.515, 0.05, 0.07);
    n = smin(n, sph(x, y + 0.035, z - 0.538, 0.07), 0.05);
    n = smin(n, sph(ax - 0.1, y + 0.062, z - 0.478, 0.066), 0.045);
    d = smin(d, n, 0.04);
    d = smax(d, -E(ax, y, z, 0.05, -0.09, 0.535, 0.028, 0.015, 0.028), 0.01);                            // nostrils
    d = smax(d, -btube(ax, y, z, [0.13, 0.0, 0.475], [0.162, -0.055, 0.475], [0.115, -0.1, 0.495], 0.008, 0.007, 5), 0.01);
  }
  // ---- mouth: wide open laugh, upper teeth, thick lips, deep corners, nasolabial folds
  if (ax < 0.38 && y > -0.34 && y < 0.0 && z > 0.18) {
    const zc = 0.48 - 1.25 * x * x;                       // dental arch
    const mz = z - zc;
    const w = 0.18;
    const q = clamp(1 - (x / w) ** 2, 0, 1);
    const yu = -0.122 - 0.022 * q;                        // lower edge of the upper lip (corners pulled up)
    const yl = -0.122 - 0.078 * Math.pow(q, 0.8);         // upper edge of the lower lip (a broad laugh, not a gape)
    const ul = btube(ax, y, z, [0.0, -0.118, 0.502], [0.11, -0.124, 0.488], [0.192, -0.106, 0.43], 0.037, 0.02, 8);
    const ll = btube(ax, y, z, [0.0, -0.248, 0.486], [0.13, -0.236, 0.47], [0.19, -0.118, 0.425], 0.043, 0.022, 8);
    d = smin(d, smin(ul, ll, 0.02), 0.025);
    const open = max(max(ax - w, y - yu), max(yl - y, -(mz + 0.16)));
    d = smax(d, -open, 0.012);
    const tz = mz + 0.035;                                // upper teeth, set back in the opening
    const teeth = max(max(ax - 0.13, (yu - 0.034) - y), max(y - (yu + 0.02), max(tz, -(mz + 0.13))));
    let tt = teeth;
    if (teeth < 0.02) tt = teeth + 0.004 * (1 - abs(Math.cos(x * Math.PI / 0.045)) ** 6);
    d = smin(d, tt + 0.035, 0.006);                       // the teeth sit deep in the shadow of the lips
    d = smax(d, -sph(ax - 0.196, y + 0.113, z - 0.44, 0.026), 0.03);                                    // corner dimples
    d = smax(d, -btube(ax, y, z, [0.13, -0.04, 0.515], [0.262, -0.1, 0.49], [0.262, -0.27, 0.41], 0.034, 0.03, 8), 0.035); // nasolabial (wide, shallow)
    d = smax(d, -tcap(x, y, z, 0, -0.085, 0.535, 0, -0.112, 0.515, 0.01, 0.008), 0.008);               // philtrum
  }
  // ---- forehead wrinkles (two soft lines)
  if (y > 0.3 && y < 0.46 && z > 0.2 && ax < 0.3) {
    for (const yy of [0.345, 0.405]) d = smax(d, -btube(ax, y, z, [0, yy, faceZ(0, 0.2) - 0.02 - (yy - 0.3) * 0.6], [0.13, yy + 0.008, faceZ(0.13, 0.2) - 0.03 - (yy - 0.3) * 0.6], [0.25, yy - 0.012, faceZ(0.25, 0.2) - 0.06 - (yy - 0.3) * 0.6], 0.007, 0.005, 6), 0.012);
  }
  // ---- ears: big, standing off the head, the lobes hanging to the jaw
  if (ax > 0.33 && ax < 0.64 && y > -0.4 && y < 0.36 && z > -0.25 && z < 0.24) {
    let er = E(ax, y, z, 0.465, 0.05, -0.04, 0.055, 0.18, 0.11);
    er = smin(er, E(ax, y, z, 0.475, -0.19, 0.0, 0.07, 0.11, 0.08), 0.05);          // lobe
    er = smax(er, -E(ax, y, z, 0.515, 0.06, -0.02, 0.035, 0.11, 0.065), 0.02);     // concha
    er = smax(er, -E(ax, y, z, 0.51, -0.18, 0.0, 0.028, 0.05, 0.036), 0.02);       // lobe hollow
    d = smin(d, er, 0.04);
  }
  return d;
}

// ------------------------------------------------------------------ fold field (after Athenaion's foldTubes)
const foldCache = new Map();
function foldCells(n, seed) {
  const key = n + '|' + seed;
  let F = foldCache.get(key);
  if (F) return F;
  const w = [];
  let tot = 0;
  for (let i = 0; i < n; i++) { const r = hash1(i * 3.7 + seed * 11.1); const wi = 0.5 + 1.15 * r * r + 0.3 * hash1(i * 9.1 + seed * 0.37); w.push(wi); tot += wi; }
  const avg = tot / n, a = [], sk = [];
  for (let i = 0; i < n; i++) { a.push((0.3 + 0.7 * hash1(i * 5.3 + seed * 2.1)) * (0.65 + 0.35 * Math.min(1.6, w[i] / avg))); sk.push((hash1(i * 1.3 + seed) - 0.5) * 0.6); }
  const b = [0];
  for (let i = 0; i < n; i++) b.push(b[i] + (w[i] / tot) * TAU);
  F = { b, a, sk };
  foldCache.set(key, F);
  return F;
}
/** irregular tube folds around an axis: 0..1 (ridge 1, crevice 0) */
function folds(theta, s, n, seed, sway = 1) {
  const F = foldCells(n, seed);
  const tw = theta + sway * (0.1 * Math.sin(2 * theta + s * 1.9 + seed) + 0.065 * Math.sin(3 * theta - s * 2.6 + seed * 1.7) + 0.04 * Math.sin(5 * theta + s * 3.7 + seed * 2.3));
  const t = (((tw + Math.PI) % TAU) + TAU) % TAU;
  let lo = 0, hi = n;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (F.b[m] <= t) lo = m; else hi = m; }
  const u = ((t - F.b[lo]) / (F.b[lo + 1] - F.b[lo])) * 2 - 1;
  const uu = u - F.sk[lo] * (1 - u * u);
  return F.a[lo] * Math.pow(max(0, 1 - uu * uu), 0.7);
}
/** a draped limb a→b: tapered capsule with folds around its axis (amp m, n folds) */
function drapedLimb(x, y, z, a, b, ra, rb, amp, n, seed, sway = 1) {
  const bx = b[0] - a[0], by = b[1] - a[1], bz = b[2] - a[2];
  const L = sqrt(bx * bx + by * by + bz * bz);
  const t = segT(x, y, z, a[0], a[1], a[2], b[0], b[1], b[2]);
  const cx = a[0] + bx * t, cy = a[1] + by * t, cz = a[2] + bz * t;
  const qx = x - cx, qy = y - cy, qz = z - cz;
  const r = sqrt(qx * qx + qy * qy + qz * qz);
  let d = r - (ra + (rb - ra) * t);
  if (d > amp * 3 + 0.05) return d;
  // frame around the axis: e1 ⟂ axis (prefer world up), e2 = axis × e1
  const ix = bx / L, iy = by / L, iz = bz / L;
  let e1x = -iy * ix, e1y = 1 - iy * iy, e1z = -iy * iz; const l1 = sqrt(e1x * e1x + e1y * e1y + e1z * e1z) || 1; e1x /= l1; e1y /= l1; e1z /= l1;
  const e2x = iy * e1z - iz * e1y, e2y = iz * e1x - ix * e1z, e2z = ix * e1y - iy * e1x;
  const th = Math.atan2(qx * e2x + qy * e2y + qz * e2z, qx * e1x + qy * e1y + qz * e1z);
  // the folds die out over the round end caps (they met in a star on a kneecap)
  const tr = ((x - a[0]) * bx + (y - a[1]) * by + (z - a[2]) * bz) / (L * L);
  const cap = sstep(-0.35 * rb / L - 0.02, 0.0, tr) * sstep(1 + 0.35 * rb / L + 0.02, 1.0, tr);
  return d - amp * cap * (folds(th, t * L * 1.4, n, seed, sway) - 0.45);
}

// ------------------------------------------------------------------ the figure (metres, local)
// skeleton landmarks (ref08, crown at 4.0 m)
const SH_R = [-1.5, 2.28, -0.3], SH_L = [1.48, 2.3, -0.32];       // shoulders (R = the figure's right = viewer's left)
const EL_R = [-2.05, 1.42, 0.22], EL_L = [1.98, 1.26, 0.2];         // elbows
// ink08: cross-legged — the knees low and wide (the old raised right knee and long shin read as a squatting
// frog), the hands resting on the knee tops, the shins folded in front under the robe, the feet at the ledge's edge
const HA_R = [-2.02, 1.38, 1.22], HA_L = [1.84, 1.24, 1.3];          // hands (on the knees)
const HIP_R = [-0.78, 0.42, 0.25], HIP_L = [0.8, 0.4, 0.25];
const KN_R = [-2.22, 0.7, 1.16], KN_L = [2.1, 0.58, 1.2];            // knees (the right a little higher)
const AN_R = [-1.42, 0.26, 1.88], AN_L = [-0.12, 0.24, 1.92];        // ankles (in front, under the robe's hem)
const TO_R = [-1.86, 0.12, 2.24], TO_L = [-0.56, 0.12, 2.28];        // toe bases: both feet point toward the viewer, a little left (ink08)
export const BUDAI_BOX = { min: [-3.5, -0.2, -1.6], max: [3.0, 4.25, 2.5] };

function headLocal(x, y, z) {
  const dx = (x - HEAD_C[0]) / HS, dy = (y - HEAD_C[1]) / HS, dz = (z - HEAD_C[2]) / HS;
  const m = HEAD_ROT;
  return headSDF(m[0] * dx + m[1] * dy + m[2] * dz, m[3] * dx + m[4] * dy + m[5] * dz, m[6] * dx + m[7] * dy + m[8] * dz) * HS;
}
export function budaiHeadBox(pad = 0.05) {
  return { min: [HEAD_C[0] - 0.62 * HS - pad, HEAD_C[1] - 0.58 * HS - pad, HEAD_C[2] - 0.5 * HS - pad], max: [HEAD_C[0] + 0.62 * HS + pad, HEAD_C[1] + 0.56 * HS + pad, HEAD_C[2] + 0.62 * HS + pad] };
}

function fingers(x, y, z, palm, dirOut, dirDown, side, len, r) {
  // four fingers curling over the knee: from the palm edge outward (dirOut) then down (dirDown)
  let d = 1e9;
  for (let i = 0; i < 4; i++) {
    const o = (i - 1.5) * r * 2.05;
    const bx = palm[0] + side[0] * o, by = palm[1] + side[1] * o, bz = palm[2] + side[2] * o;
    const L = len * (i === 0 || i === 3 ? 0.85 : 1);
    const mx = bx + dirOut[0] * L * 0.5, my = by + dirOut[1] * L * 0.5, mz = bz + dirOut[2] * L * 0.5;
    const tx = mx + dirDown[0] * L * 0.55, ty = my + dirDown[1] * L * 0.55, tz = mz + dirDown[2] * L * 0.55;
    d = min(d, tcap(x, y, z, bx, by, bz, mx, my, mz, r, r * 0.95));
    d = min(d, tcap(x, y, z, mx, my, mz, tx, ty, tz, r * 0.95, r * 0.8));
  }
  return d;
}
function toes(x, y, z, tip, side, fwd, r) {
  let d = 1e9;
  for (let i = 0; i < 5; i++) {
    const o = (i - 2) * r * 2.0, rr = r * (i === 0 ? 1.35 : 1 - i * 0.06);
    const cx = tip[0] + side[0] * o - fwd[0] * Math.abs(i - 0.6) * r * 0.5, cy = tip[1] + side[1] * o - fwd[1] * Math.abs(i - 0.6) * r * 0.5, cz = tip[2] + side[2] * o - fwd[2] * Math.abs(i - 0.6) * r * 0.5;
    d = min(d, tcap(x, y, z, cx - fwd[0] * r * 1.6, cy - fwd[1] * r * 1.6, cz - fwd[2] * r * 1.6, cx, cy, cz, rr, rr * 0.9));
  }
  return d;
}

/** a bare foot lying on the ledge from the ankle `an` to the toe base `to`; side = -1 the right foot, 1 the left (the
 *  big toe on the inner side) */
function foot(x, y, z, an, to, side) {
  const fx = to[0] - an[0], fz = to[2] - an[2], fl = Math.hypot(fx, fz) || 1;
  const ux = fx / fl, uz = fz / fl;
  // inner side (toward the other foot) for a foot pointing (ux, uz): the right foot's is to its left of travel
  const ix = side < 0 ? uz : -uz, iz = side < 0 ? -ux : ux;
  // heel and instep: a flattened capsule from the heel (behind the ankle) to the ball of the foot
  const hx = an[0] - ux * 0.12, hz = an[2] - uz * 0.12;
  let f = tcap(x, y, z, hx, 0.12, hz, to[0], to[1] + 0.02, to[2], 0.15, 0.12);
  f = smin(f, tcap(x, y, z, an[0], an[1], an[2], hx + ux * 0.25, 0.16, hz + uz * 0.25, 0.14, 0.13), 0.06);   // ankle into the instep
  f = smin(f, toes(x, y, z, [to[0] + ux * 0.13, 0.08, to[2] + uz * 0.13], [-ix, 0, -iz], [ux, 0, uz], 0.05), 0.03);
  return f;
}

/** the clean carved figure */
export function budaiFigure(x, y, z) {
  if (x < BUDAI_BOX.min[0] - 0.3 || x > BUDAI_BOX.max[0] + 0.3 || y < BUDAI_BOX.min[1] - 0.3 || y > BUDAI_BOX.max[1] + 0.3 || z < BUDAI_BOX.min[2] - 0.3 || z > BUDAI_BOX.max[2] + 0.3) {
    const qx = max(BUDAI_BOX.min[0] - x, 0, x - BUDAI_BOX.max[0]), qy = max(BUDAI_BOX.min[1] - y, 0, y - BUDAI_BOX.max[1]), qz = max(BUDAI_BOX.min[2] - z, 0, z - BUDAI_BOX.max[2]);
    return sqrt(qx * qx + qy * qy + qz * qz) + 0.2;
  }
  // ---- torso: pelvis, belly, chest, pectorals
  let d = E(x, y, z, -0.05, 0.5, -0.25, 1.35, 0.6, 0.95);                            // seat mass / pelvis
  const belly = E(x, y, z, -0.05, 1.3, 0.48, 1.36, 1.0, 1.12);
  d = smin(d, belly, 0.25);
  d = smin(d, E(x, y, z, -0.05, 2.05, -0.05, 1.42, 0.66, 0.82), 0.3);                  // chest
  for (const s of [-1, 1]) d = smin(d, E(x, y, z, -0.05 + s * 0.6, 1.98, 0.56, 0.5, 0.36, 0.32), 0.2); // pectorals (sagging)
  d = smin(d, E(x, y, z, -0.05, 2.5, -0.15, 0.95, 0.35, 0.55), 0.25);                  // trapezius: the head sits low on the shoulders
  d = smin(d, E(x, y, z, -0.05, 2.5, 0.35, 0.78, 0.36, 0.6), 0.3);                     // the chin rolls straight into the chest (no neck)
  // navel + the fold under the belly
  d = smax(d, -E(x, y, z, -0.05, 1.22, 1.58, 0.07, 0.09, 0.08), 0.05);
  if (y < 0.75 && z > 0.6) d = smax(d, -btube(x, y, z, [-1.05, 0.5, 1.1], [-0.05, 0.3, 1.62], [0.95, 0.5, 1.15], 0.05, 0.05, 8), 0.08);
  // chest crease under the pectorals
  if (y > 1.6 && y < 2.0 && z > 0.4) for (const s of [-1, 1]) d = smax(d, -btube(x, y, z, [-0.05 + s * 0.22, 1.7, 0.84], [-0.05 + s * 0.6, 1.64, 0.9], [-0.05 + s * 1.02, 1.76, 0.66], 0.025, 0.02, 6), 0.04);
  // ---- head
  const hd = headLocal(x, y, z);
  d = smin(d, hd, 0.12);
  // ---- robe: over the back and shoulders, open in front of the chest and belly
  let robe = E(x, y, z, -0.05, 2.0, -0.55, 1.85, 0.95, 0.75);
  robe = smin(robe, E(x, y, z, -0.05, 1.0, -0.6, 1.8, 1.15, 0.78), 0.3);
  for (const SH of [SH_R, SH_L]) robe = smin(robe, sph(x - SH[0], y - SH[1], z - SH[2], 0.52), 0.35);
  robe = smin(robe, E(x, y, z, -0.05, 2.62, -0.6, 0.95, 0.4, 0.42), 0.25);         // collar behind the neck
  // sleeves with folds (wide, drooping under the forearms)
  robe = smin(robe, drapedLimb(x, y, z, SH_R, EL_R, 0.38, 0.35, 0.05, 9, 3), 0.18);
  robe = smin(robe, drapedLimb(x, y, z, EL_R, [HA_R[0] + 0.1, HA_R[1] - 0.08, HA_R[2] - 0.25], 0.34, 0.27, 0.045, 9, 4), 0.14);
  robe = smin(robe, drapedLimb(x, y, z, SH_L, EL_L, 0.38, 0.36, 0.05, 9, 5), 0.18);
  robe = smin(robe, drapedLimb(x, y, z, EL_L, [HA_L[0] + 0.22, HA_L[1] - 0.05, HA_L[2] - 0.25], 0.35, 0.27, 0.045, 9, 6), 0.14);
  // sleeve hanging below the right forearm
  robe = smin(robe, drapedLimb(x, y, z, [-1.85, 1.3, 0.3], [-1.95, 0.75, 0.6], 0.26, 0.18, 0.04, 7, 7, 1.4), 0.22);
  // legs under the robe (folds): heavy thighs out to the knees, the shins folded in front, short and low
  // (deep, broad folds: the carving's folds must read at ~20 m, as ink08 draws them)
  robe = smin(robe, drapedLimb(x, y, z, HIP_R, KN_R, 0.72, 0.66, 0.12, 8, 11, 1.4), 0.35);
  robe = smin(robe, drapedLimb(x, y, z, KN_R, AN_R, 0.56, 0.36, 0.1, 7, 12, 1.4), 0.3);
  robe = smin(robe, drapedLimb(x, y, z, HIP_L, KN_L, 0.7, 0.64, 0.12, 8, 13, 1.4), 0.35);
  robe = smin(robe, drapedLimb(x, y, z, KN_L, AN_L, 0.54, 0.35, 0.1, 7, 14, 1.4), 0.3);
  // the robe falling from each knee to the ledge (the knee a mass, not a tube in the air)
  for (const K of [KN_R, KN_L]) robe = smin(robe, drapedLimb(x, y, z, [K[0] * 0.97, K[1] - 0.1, K[2] - 0.05], [K[0] * 1.04, 0.12, K[2] + 0.05], 0.5, 0.62, 0.1, 7, 35 + K[0], 1.4), 0.35);
  // the robe filling the lap from knee to knee (one heavy base, not two tubes), falling over the ledge in folds
  {
    const lap = E(x, y, z, -0.1, 0.4, 1.22, 2.05, 0.44, 0.72);
    robe = smin(robe, lap - 0.09 * (folds(Math.atan2(y - 0.4, x + 0.1), z * 1.6, 10, 31, 1.2) - 0.4), 0.3);
  }
  // a sash under the belly, knotted left of centre, its ends hanging between the feet (ink08)
  robe = smin(robe, btube(x, y, z, [-1.3, 0.66, 1.0], [-0.1, 0.42, 1.74], [1.25, 0.64, 1.02], 0.085, 0.085, 10), 0.08);
  robe = smin(robe, E(x, y, z, -0.86, 0.52, 1.74, 0.17, 0.13, 0.13), 0.05);
  robe = smin(robe, drapedLimb(x, y, z, [-0.88, 0.5, 1.78], [-1.0, 0.08, 2.1], 0.15, 0.24, 0.04, 7, 33, 1.5), 0.08);
  robe = smin(robe, drapedLimb(x, y, z, [-0.8, 0.5, 1.8], [-0.66, 0.1, 2.06], 0.12, 0.18, 0.035, 6, 34, 1.5), 0.08);
  // the bag (布袋) under the robe on the figure's left, the robe falling over it in heavy folds
  const bag = E(x, y, z, 2.15, 1.05, -0.35, 0.92, 1.12, 0.85);
  const bagF = bag - 0.06 * (folds(Math.atan2(z + 0.35, x - 2.15), y * 1.2, 11, 21, 1.2) - 0.4);
  robe = smin(robe, bagF, 0.3);
  robe = smin(robe, drapedLimb(x, y, z, [2.0, 2.3, -0.1], [2.45, 0.15, 0.25], 0.42, 0.62, 0.09, 8, 22, 1.5), 0.3);
  // the robe's front edges: rolled hems from behind the neck over the shoulders down the flanks of the belly
  for (const sg of [-1, 1]) {
    const hem = btube(x, y, z, [-0.05 + sg * 0.62, 2.7, 0.18], [-0.05 + sg * 1.18, 2.15, 0.7], [-0.05 + sg * 1.32, 1.05, 0.98], 0.09, 0.11, 10);
    robe = smin(robe, hem, 0.06);
  }
  d = smin(d, robe, 0.05);
  // ---- hands (on the knees), feet
  {
    // right hand on the raised right knee, fingers curled over the kneecap toward the viewer
    const palm = [HA_R[0] + 0.05, HA_R[1] + 0.02, HA_R[2] - 0.05];
    let h = E(x, y, z, palm[0], palm[1], palm[2], 0.27, 0.12, 0.22);
    h = smin(h, fingers(x, y, z, [palm[0] + 0.02, palm[1] - 0.02, palm[2] + 0.12], [0.1, 0.0, 1], [0, -1, 0.35], [1, 0, -0.1], 0.3, 0.058), 0.03);
    h = smin(h, tcap(x, y, z, palm[0] + 0.22, palm[1] - 0.02, palm[2] - 0.02, palm[0] + 0.3, palm[1] - 0.12, palm[2] + 0.15, 0.06, 0.05), 0.03); // thumb
    d = smin(d, h, 0.04);
    // left hand on the left knee, drooping over it
    const pl = [HA_L[0] + 0.05, HA_L[1] + 0.0, HA_L[2] - 0.05];
    let g = E(x, y, z, pl[0], pl[1], pl[2], 0.26, 0.12, 0.22);
    g = smin(g, fingers(x, y, z, [pl[0] - 0.02, pl[1] - 0.02, pl[2] + 0.12], [-0.15, 0, 1], [0, -1, 0.3], [1, 0, 0.1], 0.3, 0.056), 0.03);
    g = smin(g, tcap(x, y, z, pl[0] - 0.22, pl[1] - 0.02, pl[2] - 0.02, pl[0] - 0.3, pl[1] - 0.1, pl[2] + 0.14, 0.06, 0.05), 0.03);
    d = smin(d, g, 0.04);
    // the two bare feet at the front edge of the ledge, soles down, toes toward the viewer (a little to the left)
    d = smin(d, foot(x, y, z, AN_R, TO_R, -1), 0.06);
    d = smin(d, foot(x, y, z, AN_L, TO_L, 1), 0.06);
  }
  return d;
}

/** weathered figure: softened, pitted, a few chips; in metres (local) */
export function budaiSDF(x, y, z) {
  let d = budaiFigure(x, y, z);
  if (d > 0.2) return d;
  // sugary erosion + pitting (stronger on the upper surfaces that take the rain, softer on the face)
  const inHead = (x - HEAD_C[0]) ** 2 + (y - HEAD_C[1]) ** 2 + (z - HEAD_C[2]) ** 2 < (0.6 * HS) ** 2;
  const k = inHead ? 0.45 : 1;
  d += k * (0.008 * NA.noise3(x * 1.7, y * 1.7, z * 1.7) + 0.003 * NB.noise3(x * 7, y * 7, z * 7) + 0.0012 * NC.noise3(x * 23, y * 23, z * 23));
  return d;
}
