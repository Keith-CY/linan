// 飞来峰 north face over 冷泉溪 (shot 8): a grey limestone karst cliff with the Southern-Song 布袋弥勒 niche, a standing
// figure in its own niche, a panel of small seated Buddhas above, two 罗汉 niches, solution cavities and fissures.
// Everything is one signed distance field in WORLD metres, meshed in nested resolution regions (src/sculpt/mesher.js)
// and baked to generated/ (src/bake/karst.js).
//
// Plan (x east, z south; see docs/COMPOSITION.md shot 8): the camera stands on the south bank of the stream looking
// east along the foot of the cliff. The face follows layout LINGYIN.cliff (2–3 m in front of its foot line) with its
// height from LINGYIN.cliff.profile; at the 布袋 a lower rock step juts out toward the stream so that the niche faces
// the camera (ref08: the figure frontal at x ≈ 0.69, the standing figure straight ahead at x ≈ 0.5, the step's
// corner the left edge of the rock at x ≈ 0.43, the temple and the pavilion visible beyond it).
//
// The heightfield keeps a steep placeholder of the face (src/world/heightfield.js): the rock here always encloses the
// terrain (a terrain envelope is unioned in), so nothing of the placeholder shows wherever the terrain is.
//
//   const F = makeFeilai();            // ~1 s (terrain grid)
//   F.sdf(x, y, z)                     // world metres
//   F.carved(x, y, z)                  // 0..1 carved-surface mask (niches, figures)
//   F.regions(detail)                  // nested meshing boxes [{ name, min, max, cell, parent }]
//   F.budai                            // { origin:[x,y,z], facing, scale } (the figure frame)
//   F.ivy / F.ledges                   // anchor points for the vegetation (vines over the rim, plants on ledges)
import * as L from '../world/layout.js';
import { Simplex } from '../core/noise.js';
import { HFGrid } from './hfgrid.js';
import { sqrt, abs, min, max, clamp, lerp, sstep, smin, smax, ell, box, cell3 } from '../sculpt/sdf.js';
import { budaiSDF, budaiFigure, BUDAI_BOX, budaiHeadBox } from '../sculpt/budai.js';
import { seatedFigure, standingFigure } from '../sculpt/figures.js';

const NA = new Simplex(8101), NB = new Simplex(8102), NC = new Simplex(8103), ND = new Simplex(8104);
const D2R = Math.PI / 180;

// ------------------------------------------------------------------ plan geometry
/** open polyline with pseudo-normals: signed plan distance (+ in front of the face, − inside the rock) */
class Line {
  constructor(pts) {
    this.p = pts; this.seg = [];
    let acc = 0;
    for (let i = 0; i < pts.length - 1; i++) {
      const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
      const ex = bx - ax, ez = bz - az, l = Math.hypot(ex, ez);
      // front = left of the travel direction in (x, z) with z south: n = (ez, -ex) / l
      this.seg.push({ ax, az, ex, ez, l, inv: 1 / (l * l), nx: ez / l, nz: -ex / l, acc });
      acc += l;
    }
    this.len = acc;
    this.vn = pts.map((_, i) => {
      const a = this.seg[Math.max(0, i - 1)], b = this.seg[Math.min(this.seg.length - 1, i)];
      const nx = a.nx + b.nx, nz = a.nz + b.nz, l = Math.hypot(nx, nz) || 1;
      return [nx / l, nz / l];
    });
  }
  /** → signed distance; o.s = arc length, o.nx/o.nz = outward normal at the closest point */
  eval(x, z, o) {
    let best = Infinity, bi = 0, bt = 0;
    const S = this.seg;
    for (let i = 0; i < S.length; i++) {
      const s = S[i];
      let t = ((x - s.ax) * s.ex + (z - s.az) * s.ez) * s.inv;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const dx = x - s.ax - s.ex * t, dz = z - s.az - s.ez * t, d = dx * dx + dz * dz;
      if (d < best) { best = d; bi = i; bt = t; }
    }
    const s = S[bi];
    let nx = s.nx, nz = s.nz;
    if (bt <= 0 && bi > 0) [nx, nz] = this.vn[bi];
    else if (bt >= 1 && bi < S.length - 1) [nx, nz] = this.vn[bi + 1];
    const cx = s.ax + s.ex * bt, cz = s.az + s.ez * bt;
    const sg = (x - cx) * nx + (z - cz) * nz >= 0 ? 1 : -1;
    o.s = s.acc + bt * s.l; o.nx = s.nx; o.nz = s.nz;
    return sg * sqrt(best);
  }
}

/** piecewise-linear lookup [[x, v], …] */
function pw(tab, x) {
  if (x <= tab[0][0]) return tab[0][1];
  for (let i = 0; i < tab.length - 1; i++) if (x <= tab[i + 1][0]) return tab[i][1] + (tab[i + 1][1] - tab[i][1]) * (x - tab[i][0]) / (tab[i + 1][0] - tab[i][0]);
  return tab[tab.length - 1][1];
}

// ------------------------------------------------------------------ the design (world metres)
const CL = L.LINGYIN.cliff;
/** cliff height above the stream bank along x (layout LINGYIN.cliff.profile, fallback = the layout height) */
const PROFILE = CL.profile || [[-5000, CL.height || 28], [5000, CL.height || 28]];
// face foot: 1.5–2.5 m in front of the layout foot line (CL.face), extended past both ends
const MAIN = new Line([[-4095, 451.4], [-4060, 449.9], [-4000, 447.0], [-3975, 445.0], [-3966, 444.1], [-3958, 443.6], [-3940, 441.7],
  [-3910, 438.9], [-3880, 436.6], [-3850, 435.1], [-3820, 433.8], [-3790, 433.2], [-3750, 433.6]]);
// the Budai: seat-centre origin, facing toward the camera (ref08 frontal), uniform scale matched to the reference
const BUDAI_FACING = 290;
const FWD = [Math.sin(BUDAI_FACING * D2R), -Math.cos(BUDAI_FACING * D2R)];         // local +Z in plan
const RIGHT = [FWD[1], -FWD[0]];                                                    // local +X (the viewer's right) in plan
// ink08: the figure 1.54× bigger (seated 6.2 m), central and calm in a tall, deep niche, its seat 1.6 m over
// the bank on a rock pedestal (ink08: the head top at y 0.27, the feet at 0.66 of the frame)
const B_SCALE = 1.4;
const B_ORIGIN = [-3962.75, 0, 444.18];   // y = the stream bank + SEAT
const SEAT = 1.6;
const FACE_L = 1.264;                      // the face plane in front of the seat centre (local units, × B_SCALE in metres)
const NICHE = { hw: 3.35, cy: 1.75, ry: 4.25, dep: 3.0 };   // niche half width, centre height, half height, depth (local)
// the rock step that carries the niche: plan polygon (clockwise from the south-west, inside MAIN at both ends)
const FACEPT = [B_ORIGIN[0] + FWD[0] * FACE_L * B_SCALE, B_ORIGIN[2] + FWD[1] * FACE_L * B_SCALE];   // face plane point in front of the figure
const ALONG = [-RIGHT[0], -RIGHT[1]];                                               // along the face toward the tip (NNE)
const at = (s, o = 0) => [FACEPT[0] + ALONG[0] * s + FWD[0] * o, FACEPT[1] + ALONG[1] * s + FWD[1] * o];
// (the niche side widened with the bigger figure; the tip ~2 m beyond the niche's left jamb, as ink08)
// (its front stands 1.4–1.6 m proud of the face plane under the figure: the pedestal block of ink08, the knees no
// longer overhanging the bank; above the seat the niche's arch is cut through it)
const STEP = [at(-7.4, -2.6), at(-5.6, 1.1), at(-1.9, 1.6), at(2.9, 1.5), at(5.6, 0.7), at(6.6, -0.9), [-3957.2, 436.4], [-3952.3, 437.9],
  [-3949.7, 441.2], [-3953.5, 446.5], [-3963, 450.5]];
function sdPoly(x, z, P) {
  let d = Infinity, s = 1;
  for (let i = 0, j = P.length - 1; i < P.length; j = i, i++) {
    const ax = P[i][0], az = P[i][1], bx = P[j][0], bz = P[j][1];
    const ex = bx - ax, ez = bz - az, wx = x - ax, wz = z - az;
    const t = clamp((wx * ex + wz * ez) / (ex * ex + ez * ez), 0, 1);
    const dx = wx - ex * t, dz = wz - ez * t;
    d = min(d, dx * dx + dz * dz);
    const c1 = z >= az, c2 = z < bz, c3 = ex * wz > ez * wx;
    if ((c1 && c2 && c3) || (!c1 && !c2 && !c3)) s = -s;
  }
  return s * sqrt(d);
}
const TIP = at(6.6, -0.9);
const CAM8 = [-3978, 28.2, 439];   // the shot-8 camera (src/world/shots.js): the apron stays out of its near field
const BRIDGE_X = (L.BRIDGES.find((b) => b.id === 'lingyin-bridge') || { center: [-3948] }).center[0];
const PAVH = L.HALLS.find((h) => h.id === 'feilai-ge');
const PAV = PAVH ? [PAVH.center[0], PAVH.center[1], (PAVH.level ?? 72) - 0.4] : [1e9, 1e9, 1e9];

// ------------------------------------------------------------------ factory
export function makeFeilai() {
  const t0 = Date.now();
  const G = new HFGrid([-4100, 400, -3740, 500], 0.5);
  const tmp = { s: 0, nx: 0, nz: 0 };
  // ground in front of the face (the stream bank), smoothed along the face
  const floorAt = (x) => pw(FLOOR, x);
  const FLOOR = [];
  for (let x = -4100; x <= -3740; x += 4) {
    // sample 5 m in front of the foot line
    let s = 0, n = 0;
    const z0 = footZ(x);
    for (let k = -2; k <= 2; k++) { s += G.at(x + k * 1.5, z0 - 5); n++; }
    FLOOR.push([x, s / n]);
  }
  function footZ(x) { // z of MAIN at x (plan)
    const P = MAIN.p;
    for (let i = 0; i < P.length - 1; i++) if (x <= P[i + 1][0]) return P[i][1] + (P[i + 1][1] - P[i][1]) * (x - P[i][0]) / (P[i + 1][0] - P[i][0]);
    return P[P.length - 1][1];
  }
  const groundB = floorAt(B_ORIGIN[0]);
  const origin = [B_ORIGIN[0], groundB + SEAT, B_ORIGIN[2]];
  // layout foot line (the placeholder): behind distance for the envelope
  const LAY = new Line(CL.face.map((p, i, a) => i === 0 ? [p[0] - 40, p[1] + 1.6] : i === a.length - 1 ? [p[0] + 40, p[1] - 0.6] : p));

  // ---------------- local frames
  const toLocal = (x, y, z, o, fwd, sc) => {   // world → figure local (x right, y up, z front), unscaled
    const dx = x - o[0], dy = y - o[1], dz = z - o[2];
    const rx = fwd[1], rz = -fwd[0];
    return [(dx * rx + dz * rz) / sc, dy / sc, (dx * fwd[0] + dz * fwd[1]) / sc];
  };
  // ---------------- karst relief: jointed limestone. Each joint-bounded block (3D Voronoi cell, taller than wide)
  // is recessed behind the design face by its own depth and tilted, so neighbouring blocks step out and in (ledges,
  // small overhangs, sharp arrises); the joints between blocks open as dark grooves; bedding and weathering on top.
  // Returned as an offset ADDED to the design field (≥ 0: the design face is the outermost limit), except the foot.
  const cc = [0, 0, 0, 0, 0, 0], cb = [0, 0, 0, 0, 0, 0];
  function relief(x, y, z, fy, nearCarve) {
    const SX = 0.72, SY = 0.3;                                       // blocks ~2.3 × taller than wide (vertical jointing)
    const bx = x * SX + 3.1, by = y * SY + 0.7, bz = z * SX;
    cell3(bx, by, bz, 17, cc);
    const id = cc[2];
    const h1 = hashf(id * 91.7), h2 = hashf(id * 37.3 + 1.1), h3 = hashf(id * 13.9 + 2.7), h4 = hashf(id * 57.1 + 4.2);
    let r = 1.1 * h1 * h1;                                           // the block's own recess
    // the block face is tilted about the block's centre (feature point): offset in metres × a random slope
    r += ((h2 - 0.5) * cc[3] / SX + (h3 - 0.5) * 0.7 * cc[4] / SY + (h4 - 0.5) * cc[5] / SX) * 0.4;
    // joints between the blocks: narrow dark grooves
    r += 0.45 * (1 - sstep(0.0, 0.1, cc[1] - cc[0]));
    // small blocks (≈ 0.8 × 1.2 m) fractured off the faces of the medium ones
    cell3(x * 1.25 + 7.3, y * 0.85, z * 1.25, 41, cb);
    r += 0.16 * hashf(cb[2] * 71.3) + 0.1 * (1 - sstep(0.0, 0.1, cb[1] - cb[0]));
    r += ((hashf(cb[2] * 17.1) - 0.5) * cb[3] / 1.25 + (hashf(cb[2] * 29.3) - 0.5) * cb[5] / 1.25) * 0.3;
    // big masses (≈ 5 × 14 m): whole buttresses stand out as vertical planes, the gullies between them recede deep
    cell3(x * 0.19 + 9.7, y * 0.07, z * 0.19, 29, cb);
    r += 1.1 * hashf(cb[2] * 3.7) + 0.9 * (1 - sstep(0.0, 0.06, cb[1] - cb[0]));
    // bedding: beds recede by their own amount (ledges on top of the standing ones, lips over the receding)
    const byd = y * 0.4 + 0.7 * NB.noise3(x * 0.035, 0.3, z * 0.035);
    const bi = Math.floor(byd), bf = byd - bi;
    r += 0.35 * hashf(bi * 13.7 + 2.1) * sstep(0.0, 0.08, bf) * (1 - sstep(0.9, 1.0, bf));
    // weathering: lumps and small sharp crests
    const c2 = 1 - abs(NC.noise3(x * 2.1, y * 1.6, z * 2.1));
    r += 0.2 * (NC.noise3(x * 0.5, y * 0.5, z * 0.5) * 0.5 + 0.5) - 0.06 * c2 * c2 + 0.025 * NA.noise3(x * 6, y * 6, z * 6);
    r = Math.max(0, r);
    // a rounded foot (talus, the base bulging out)
    r -= 0.8 * sstep(2.2, 0.0, fy) * (0.6 + 0.4 * ND.noise3(x * 0.3, 0.0, z * 0.3));
    // near the carving: a worked, smoother face flush with the design
    if (nearCarve > 0) r = r * (1 - nearCarve) + nearCarve * (0.03 * NA.noise3(x * 1.5, y * 1.5, z * 1.5));
    return r;
  }

  // ---------------- base masses
  function design(x, y, z) {
    // main face
    const dm = MAIN.eval(x, z, tmp);
    const fl = floorAt(x);
    const fy = y - fl;
    const H = pw(PROFILE, x) + 1.0 + 1.6 * NA.noise3(x * 0.05, 7.7, z * 0.05);
    // overhang: the upper face leans out where the noise says so
    const lean = 1.4 * sstep(5, 15, fy) * sstep(-0.2, 0.6, NB.noise3(x * 0.03, 1.3, 0));
    let dFace = dm - lean;
    let d = smax(dFace, fy - H, 1.6);
    // the rock step with the niche: its top rises from the tip (6.5 m) toward the main face
    const ds = sdPoly(x, z, STEP);
    const tipD = Math.hypot(x - TIP[0], z - TIP[1]);
    const Hs = 9.5 + 1.1 * max(0, tipD - 1.5) + 0.6 * NC.noise3(x * 0.2, 0, z * 0.2);
    d = smin(d, smax(ds, fy - min(Hs, 19), 0.9), 1.2);
    return { d, fy, fl, dm };
  }
  // a rocky apron at the foot (fallen blocks and a rock shelf toward the stream), open at the bridge landing and in
  // the camera's near field; its own, milder relief (applied after the face relief)
  function apron(x, y, z, D) {
    if (x < -3976 || x > -3925) return 1e9;
    const gap = 1 - sstep(4.5, 6.5, abs(x - BRIDGE_X));
    const camGap = 1 - sstep(7, 11, Math.hypot(x - CAM8[0], z - CAM8[2]));
    const W = 3.0 + 1.8 * NA.noise3(x * 0.11, 0.5, 2.2) - 4.5 * gap - 3 * camGap - 3 * sstep(-3970, -3976, x);
    if (W < 0.3) return 1e9;
    // height above the local ground (the bank rises toward the face), lower toward the outer edge
    const Ha = 1.9 + 0.9 * NB.noise3(x * 0.2, z * 0.2, 1.1) - 0.9 * sstep(0, 1, (W + D.dm) / 4);
    const da = smax(D.dm - W, (y - G.at(x, z)) - Ha, 0.8);
    if (da > 3) return da;
    return (da + 0.35 * relief(x, y, z, D.fy, 0)) * 0.75;
  }

  // small figures (unit height): { origin, facing, h, kind }
  const SMALL = [];
  // a small figure is set into the rock: march from in front along -fwd to the rock surface (design + relief) at
  // its mid height, then sink the figure's origin `inset` × its height behind that surface (the niche cuts round it)
  const surfaceT = (px, pz, ym, f) => {
    let t = 5;
    for (; t > -6; t -= 0.05) {
      const qx = px + f[0] * t, qz = pz + f[1] * t;
      const D = design(qx, ym, qz);
      if (D.d + relief(qx, ym, qz, D.fy, 0) < 0) break;
    }
    return t;
  };
  const placeW = (px, pz, yAbove, h, kind, facing, inset = 0.2, tFix = null) => {
    const f = [Math.sin(facing * D2R), -Math.cos(facing * D2R)];
    const y = floorAt(px) + yAbove;
    const t = tFix ?? surfaceT(px, pz, y + h * 0.5, f);
    SMALL.push({ origin: [px + f[0] * (t - inset * h), y, pz + f[1] * (t - inset * h)], fwd: f, h, kind });
  };
  const place = (s, o, yAbove, h, kind, facing = BUDAI_FACING) => { const [px, pz] = at(s, o); placeW(px, pz, yAbove, h, kind, facing); };
  // ink08: no standing figure and no panel above the niche; a small seated figure in its own niche right of the
  // 布袋 at the height of its head (ink08 x 0.88, y 0.42), a 罗汉 lower down
  placeW(-3970.6, 444.6, 5.0, 1.3, 'arhat', 318);
  placeW(-3973.4, 444.9, 1.5, 1.05, 'arhat', 322);

  // ---------------- niches (carved volumes, local frames)
  const nicheB = (x, y, z) => {
    // the 布袋 niche: an arched opening (half width 3.25, springing 1.7, apex 4.7 m local), an apse-like back
    const [lx, ly, lz] = toLocal(x, y, z, origin, FWD, B_SCALE);
    // ink08: a cave, not a shell — an arched mouth (the arch extruded from 2.9 in front of the face plane to 0.7
    // behind it) opening into a wider, taller chamber, so the inner side walls hide behind the jambs and the chamber
    // reads as shade round the figure
    const q = max(0, FACE_L - lz);                                    // depth behind the face plane
    const ax = lx + 0.1, ay = ly - NICHE.cy;
    const arch = ell(ax, ay, 0, NICHE.hw, NICHE.ry, 1);
    const mouth = max(arch, max(lz - FACE_L - 2.9, FACE_L - 0.7 - lz));
    const chamber = max(ell(ax, ay + 0.15, q, NICHE.hw * 1.14, NICHE.ry * 1.05, NICHE.dep), lz - (FACE_L - 0.55));
    // floor = the seat ledge
    return max(min(mouth, chamber), -ly - 0.02) * B_SCALE;
  };
  const nicheSmall = (x, y, z, F) => {
    const [lx, ly, lz] = toLocal(x, y, z, F.origin, F.fwd, F.h);
    const st = F.kind === 'standing';
    const hw = st ? 0.36 : 0.62, top = st ? 1.12 : 1.12, dep = st ? 0.42 : 0.55;
    const q = max(0, 0.18 - lz);
    const e = ell(lx, ly - top * 0.45, q, hw, top * 0.6, dep);
    return max(max(e, -ly + 0.02), lz - 0.18 - 0.9) * F.h;
  };
  // zone near the carving: the karst relief fades (worked stone)
  const carveZone = (x, y, z) => {
    const dn = nicheB(x, y, z);
    let dz = dn;
    for (const F of SMALL) { const dd = Math.hypot(x - F.origin[0], z - F.origin[2], (y - F.origin[1] - F.h * 0.5) * 0.7) - F.h * 0.9; dz = min(dz, dd); }
    return 0.85 * sstep(2.6, 0.2, dz);
  };

  // ---------------- cavities and fissures (seeded, kept off the carving and out of the terrain)
  const rng = mulberry(0xfe1a1);
  const CAV = [];
  for (let k = 0; k < 60 && CAV.length < 12; k++) {
    const x = lerp(-3990, -3840, rng()), fl = floorAt(x), fz = footZ(x);
    const fy = lerp(2.5, pw(PROFILE, x) - 2, rng());
    const r = lerp(0.5, 1.6, rng() ** 1.6);
    const c = [x + lerp(-0.5, 0.5, rng()), fl + fy, fz + 0.25 * r];
    if (carveZone(c[0], c[1], c[2]) > 0.05) continue;
    if (Math.hypot(c[0] - origin[0], c[2] - origin[2]) < 7.5) continue;
    // keep the hollow above / in front of the terrain
    let ok = true;
    for (let a = 0; a < 8 && ok; a++) { const px = c[0] + r * Math.cos(a * 0.785), pz = c[2] + r * 0.9 + 0.3, py = c[1] - r * Math.sin(a * 0.785) * 0.7; if (G.at(px, pz) > py - 0.3) ok = false; }
    if (!ok) continue;
    CAV.push({ c, r, ry: r * lerp(0.5, 0.9, rng()), ph: rng() * 10 });
  }
  // ink08: long vertical fissures from the foot to near the rim, some wide open (dark slots between planes)
  const FIS = [];
  for (let k = 0; k < 26; k++) {
    const x = lerp(-3992, -3850, rng());
    if (abs(x - origin[0]) < 6.5 * B_SCALE / 0.91) continue;
    const fl = floorAt(x), H = max(pw(PROFILE, x), x > -3972 && x < -3948 ? 16 : 0);
    const y0 = fl + lerp(-0.5, H * 0.25, rng()), y1 = y0 + lerp(H * 0.45, H * 1.05, rng());
    const a = lerp(-0.35, 0.35, rng());
    FIS.push({ x, z: footZ(x), y0, y1, nx: Math.cos(a), nz: Math.sin(a), w: lerp(0.08, 0.3, rng() ** 1.5), ph: rng() * 20 });
  }

  // ---------------- the full field
  const ENV_M = 0.45;
  function sdf(x, y, z) {
    const D = design(x, y, z);
    let d = D.d;
    // terrain envelope: the rock always encloses the heightfield's placeholder face (behind the layout foot line)
    let env = 1e9;
    const lb = -LAY.eval(x, z, tmp);           // + behind the layout foot line
    if (lb > -1.2 && Math.hypot(x - PAV[0], z - PAV[1]) > 10) {
      const hg = G.at(x, z);
      if (hg > D.fl + 0.8) { const sl = G.slope(x, z); env = max((y - (hg + ENV_M)) / sqrt(1 + sl * sl), -1.2 - lb); }
    }
    // cheap exit far from the surface (the relief recedes by ≤ 2.6 m, the foot bulges ≤ 0.8 m)
    if (d > 4 && env > 3) return (min(d - 1, env - 0.5)) * 0.75;
    const cz = carveZone(x, y, z);
    d = (d + relief(x, y, z, D.fy, cz)) * 0.75;   // the relief is stepped: keep the field a safe bound
    if (env < 3) {
      const lump = 0.35 * (NC.noise3(x * 0.6, y * 0.6, z * 0.6) * 0.5 + 0.5) + 0.12 * (1 - abs(NA.noise3(x * 1.7, y * 1.1, z * 1.7)));
      d = smin(d, (env - lump) * 0.9, 0.4);
    }
    d = smin(d, apron(x, y, z, D), 0.5);
    // cavities (solution pockets) and fissures
    for (let i = 0; i < CAV.length; i++) {
      const C = CAV[i];
      const dx = x - C.c[0], dy = y - C.c[1], dz = z - C.c[2];
      if (dx * dx + dy * dy + dz * dz > (C.r * 1.6) ** 2) continue;
      const e = ell(dx, dy, dz, C.r, C.ry, C.r * 0.9) + 0.12 * C.r * NB.noise3(x * 1.3 + C.ph, y * 1.3, z * 1.3);
      d = smax(d, -e, 0.35);
    }
    for (let i = 0; i < FIS.length; i++) {
      const F = FIS[i];
      if (abs(x - F.x) > 3 || y < F.y0 - 1 || y > F.y1 + 1) continue;
      const pl = (x - F.x) * F.nx + (z - F.z) * F.nz + 0.2 * NA.noise3(x * 0.3 + F.ph, y * 0.15, z * 0.3);
      const w = F.w * sstep(F.y0, F.y0 + 1.0, y) * sstep(F.y1, F.y1 - 2.0, y) * (0.7 + 0.5 * NC.noise3(y * 0.25 + F.ph, x, z));
      if (w <= 0.005) continue;
      const slot = max(abs(pl) - w, -(d + 3.0));
      d = smax(d, -slot, 0.03);
    }
    // niches
    if (Math.hypot(x - origin[0], z - origin[2]) < 6.5 * B_SCALE && y > origin[1] - 1.5 && y < origin[1] + (NICHE.cy + NICHE.ry + 1) * B_SCALE) {
      const n = nicheB(x, y, z);
      d = smax(d, -(n + 0.015 * NA.noise3(x * 3, y * 3, z * 3)), 0.22);
    }
    for (const F of SMALL) {
      if (abs(x - F.origin[0]) > F.h * 2 || abs(z - F.origin[2]) > F.h * 2 || y < F.origin[1] - 1 || y > F.origin[1] + F.h * 1.5) continue;
      d = smax(d, -nicheSmall(x, y, z, F), 0.06 * F.h);
    }
    // keep the rock under the pavilion on the cliff top (layout feilai-ge) below its floor
    if (abs(x - PAV[0]) < 13 && abs(z - PAV[1]) < 13) { const w = sstep(13, 9, Math.hypot(x - PAV[0], z - PAV[1])); if (w > 0) d = max(d, (y - PAV[2]) * 0.8 - (1 - w) * 50); }
    // a rock pillar on the right of the 布袋 niche (the bag and the robe lean against it; ref08)
    if (Math.hypot(x - origin[0], z - origin[2]) < 7.2 * B_SCALE && y > origin[1] - 2 && y < origin[1] + 4.9 * B_SCALE) {
      const [lx, ly, lz] = toLocal(x, y, z, origin, FWD, B_SCALE);
      const pil = box(lx - 3.1, ly - 1.3, lz - 1.6, 0.62, 2.0, 1.5) * B_SCALE - 0.06 * NA.noise3(x * 2, y * 2, z * 2);
      d = smin(d, pil, 0.25);
    }
    // the figures, carved from the same rock (fused to the niche back and the ledge)
    if (Math.hypot(x - origin[0], z - origin[2]) < 7.2 * B_SCALE && y > origin[1] - 0.6 * B_SCALE && y < origin[1] + 4.9 * B_SCALE) {
      const [lx, ly, lz] = toLocal(x, y, z, origin, FWD, B_SCALE);
      const f = budaiSDF(lx, ly, lz) * B_SCALE;
      d = smin(d, f, 0.07);
    }
    for (const F of SMALL) {
      if (abs(x - F.origin[0]) > F.h || abs(z - F.origin[2]) > F.h || y < F.origin[1] - 0.3 || y > F.origin[1] + F.h * 1.15) continue;
      const [lx, ly, lz] = toLocal(x, y, z, F.origin, F.fwd, F.h);
      const f = (F.kind === 'standing' ? standingFigure(lx, ly, lz) : seatedFigure(lx, ly, lz, { arhat: F.kind === 'arhat' })) * F.h;
      d = smin(d, f, 0.03 * F.h);
    }
    return d;
  }

  /** carved-surface mask: 1 on the figures, ~0.75 on the niche walls, 0 on natural rock */
  function carved(x, y, z) {
    let m = 0;
    if (Math.hypot(x - origin[0], z - origin[2]) < 7.2 * B_SCALE && y > origin[1] - 0.6 * B_SCALE && y < origin[1] + (NICHE.cy + NICHE.ry + 0.5) * B_SCALE) {
      const [lx, ly, lz] = toLocal(x, y, z, origin, FWD, B_SCALE);
      const f = budaiFigure(lx, ly, lz) * B_SCALE;
      m = max(m, sstep(0.12, 0.0, f));
      m = max(m, 0.75 * sstep(0.25, -0.05, nicheB(x, y, z)));
    }
    for (const F of SMALL) {
      if (abs(x - F.origin[0]) > F.h * 1.5 || abs(z - F.origin[2]) > F.h * 1.5 || y < F.origin[1] - 0.5 || y > F.origin[1] + F.h * 1.4) continue;
      const [lx, ly, lz] = toLocal(x, y, z, F.origin, F.fwd, F.h);
      const f = (F.kind === 'standing' ? standingFigure(lx, ly, lz) : seatedFigure(lx, ly, lz, { arhat: F.kind === 'arhat' })) * F.h;
      m = max(m, sstep(0.05, 0.0, f), 0.7 * sstep(0.12, -0.02, nicheSmall(x, y, z, F)));
    }
    return m;
  }

  // ---------------- meshing regions (nested: each finer box inside its parent)
  const bOx = origin[0], bOz = origin[2], bOy = origin[1];
  // the face: the front of the head only (the back of the head and the ears' backs are in the niche region)
  const HB = budaiHeadBox(0.03);
  const hb = { min: [HB.min[0], HB.min[1] + 0.06, (HB.min[2] + HB.max[2]) * 0.5 - 0.12], max: [HB.max[0], HB.max[1], HB.max[2]] };
  const headW = toWorldBox(hb, origin, FWD, B_SCALE);
  function regions(detail = 1) {
    const k = detail >= 1 ? 1 : 1.6;
    // the far and near regions keep only a band behind the face (the top of the rock is never seen from below)
    const tmp2 = { s: 0, nx: 0, nz: 0 };
    const band = (depth) => (x, y, z) => -MAIN.eval(x, z, tmp2) - depth;
    const R = [
      { name: 'far', min: [-3982, groundB - 6, 427], max: [-3752, groundB + 52, 459], cell: 0.38 * k, cut: band(14), smooth: 0, project: 2 },
      { name: 'near', min: [-3981, groundB - 4, 431], max: [-3940, groundB + 19, 453], cell: 0.1 * k, parent: 'far', cut: band(7), smooth: 0, project: 2 },
      { name: 'niche', ...toWorldBox({ min: [-4.15, -0.75, -2.0], max: [3.95, NICHE.cy + NICHE.ry + 0.45, 2.8] }, origin, FWD, B_SCALE), cell: 0.034 * k, parent: 'near', ao: 1.0 },
      { name: 'head', min: headW.min, max: headW.max, cell: 0.011 * k, parent: 'niche', ao: 0.5, cav: 0.03 },
    ];
    for (const F of SMALL) {
      const lb = F.kind === 'standing' ? { min: [-0.3, -0.08, -0.22], max: [0.3, 1.08, 0.3] } : { min: [-0.5, -0.12, -0.25], max: [0.5, 1.1, 0.5] };
      const wb = toWorldBox(lb, F.origin, F.fwd, F.h);
      R.push({ name: 'fig-' + R.length, ...wb, cell: (F.kind === 'standing' ? F.h * 0.015 : Math.max(0.016, F.h * 0.02)) * k, parent: 'near', ao: 0.6 });
    }
    return R;
  }

  // ---------------- anchors for the vegetation (vines over the rim, plants on ledges)
  const ivy = [], ledges = [];
  for (let x = -3990; x <= -3860; x += 3.5) {
    if (abs(x - origin[0]) < 3.5) continue;
    const H = pw(PROFILE, x), fl = floorAt(x), z = footZ(x);
    ivy.push({ pos: [x, fl + H * 0.92, z + 0.5], facing: L.LINGYIN.cliff.normal, size: 3.2, drop: H * (0.35 + 0.4 * hashf(x)), tag: 'karst-rim' });
  }
  // over the 布袋 niche: a few strands hanging across its top corners (ref08)
  for (const s of [-4.2, 3.7, 4.5]) { const [px, pz] = at(s, -0.3); ivy.push({ pos: [px, bOy + (NICHE.cy + NICHE.ry + 1.2) * B_SCALE, pz], facing: BUDAI_FACING, size: 1.8, drop: 6, tag: 'karst-niche' }); }
  for (let k = 0; k < 40; k++) {
    const x = lerp(-3988, -3870, hashf(k * 7.3)), fl = floorAt(x), z = footZ(x), H = pw(PROFILE, x);
    ledges.push({ pos: [x, fl + lerp(1.5, H - 1, hashf(k * 3.1)), z], facing: L.LINGYIN.cliff.normal, size: lerp(0.6, 1.6, hashf(k * 5.9)), tag: 'karst-ledge' });
  }

  console.log(`[karst] 飞来峰 field ready in ${Date.now() - t0} ms (${CAV.length} cavities, ${FIS.length} fissures, ${SMALL.length} small figures)`);
  return {
    sdf, carved, regions, grid: G,
    budai: { origin, facing: BUDAI_FACING, scale: B_SCALE, fwd: FWD, head: headW },
    small: SMALL, ivy, ledges, floorAt, footZ,
  };
}

function toWorldBox(b, o, fwd, sc) {
  const rx = fwd[1], rz = -fwd[0];
  const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  for (const X of [b.min[0], b.max[0]]) for (const Y of [b.min[1], b.max[1]]) for (const Z of [b.min[2], b.max[2]]) {
    const w = [o[0] + (X * rx + Z * fwd[0]) * sc, o[1] + Y * sc, o[2] + (X * rz + Z * fwd[1]) * sc];
    for (let i = 0; i < 3; i++) { mn[i] = min(mn[i], w[i]); mx[i] = max(mx[i], w[i]); }
  }
  return { min: mn, max: mx };
}
function hashf(n) { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453123; return s - Math.floor(s); }
function mulberry(a) { return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
