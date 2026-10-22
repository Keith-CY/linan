// Rock outcrops: jointed rock masses rising out of the terrain (the tuff under the 宝石山 樓閣, the bank under 六和塔,
// the limestone skirts under the palace terraces). A signed distance field in world metres: an outline in plan
// (ellipses blended with a smooth union), a crest height per lobe, the terrain under it (the rock grows out of the
// ground), and the same jointed-block relief as the 飞来峰 cliff (blocks recessed and tilted on their own, open
// joints, bedding, sharp small crests). Meshed in one region by src/karst/build.js and baked (src/bake/rocks.js).
//
//   const O = makeOutcrop({ name, lobes: [{ c:[x,z], r:[rx,rz], rot (deg), top (m above ground), lean (m) }], seed,
//                           block (m, joint spacing), cell (m), rect:[x0,z0,x1,z1], cut?(x,y,z) })
//   O.sdf(x, y, z), O.region (for meshRegion), O.origin
import { Simplex } from '../core/noise.js';
import { HFGrid } from './hfgrid.js';
import { sqrt, abs, min, max, smin, smax, sstep, ell2, cell3 } from '../sculpt/sdf.js';

function hashf(n) { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453123; return s - Math.floor(s); }

export function makeOutcrop(o) {
  const seed = o.seed ?? 1;
  const NA = new Simplex(7400 + seed), NB = new Simplex(7500 + seed), NC = new Simplex(7600 + seed);
  const [x0, z0, x1, z1] = o.rect;
  const G = new HFGrid([x0 - 2, z0 - 2, x1 + 2, z1 + 2], 0.5);
  // each lobe: base = the ground at its centre (or L.base); top = L.top m above it, or the absolute L.crest
  const lobes = o.lobes.map((L) => {
    const a = ((L.rot || 0) * Math.PI) / 180, base = L.base ?? G.at(L.c[0], L.c[1]);
    return { ...L, cos: Math.cos(a), sin: Math.sin(a), base, top: L.crest !== undefined ? L.crest - base : L.top };
  });
  const B = o.block ?? 1.4;
  // relief style: jointed (limestone: deep recesses, open joints) or massive (tuff: big rounded faces, tight joints)
  const REC = o.recess ?? 0.6, TILT = o.tilt ?? 0.4, JNT = o.joint ?? 0.3;
  const SX = 1 / B, SY = 1 / (B * 1.5);
  const cc = [0, 0, 0, 0, 0, 0], cb = [0, 0, 0, 0, 0, 0];
  const relief = (x, y, z) => {
    cell3(x * SX + 3.1 * seed, y * SY, z * SX, 17 + seed, cc);
    const id = cc[2];
    const h1 = hashf(id * 91.7), h2 = hashf(id * 37.3 + 1.1), h3 = hashf(id * 13.9 + 2.7), h4 = hashf(id * 57.1 + 4.2);
    let r = REC * B * h1 * h1;
    r += ((h2 - 0.5) * cc[3] / SX + (h3 - 0.5) * 0.7 * cc[4] / SY + (h4 - 0.5) * cc[5] / SX) * TILT;
    r += JNT * B * (1 - sstep(0.0, 0.1, cc[1] - cc[0]));
    cell3(x * SX * 2.2 + 7.3, y * SY * 2.2, z * SX * 2.2, 41 + seed, cb);
    r += 0.12 * B * hashf(cb[2] * 71.3) + 0.08 * B * (1 - sstep(0.0, 0.1, cb[1] - cb[0]));
    const byd = y / (B * 0.9) + 0.7 * NB.noise3(x * 0.05, 0.3, z * 0.05);
    const bi = Math.floor(byd), bf = byd - bi;
    r += 0.22 * B * hashf(bi * 13.7 + seed) * sstep(0.0, 0.08, bf) * (1 - sstep(0.9, 1.0, bf));
    const c2 = 1 - abs(NC.noise3(x * 1.6 / B, y * 1.2 / B, z * 1.6 / B));
    r += 0.12 * B * (NC.noise3(x * 0.4 / B, y * 0.4 / B, z * 0.4 / B) * 0.5 + 0.5) - 0.04 * B * c2 * c2 + 0.018 * B * NA.noise3(x * 4 / B, y * 4 / B, z * 4 / B);
    return max(0, r);
  };
  // design: the union of the lobes, each a rounded column of its outline up to its crest (leaning out by `lean`)
  const design = (x, y, z) => {
    let d = 1e9;
    for (const L of lobes) {
      const top = L.base + L.top;
      const k = sstep(L.base - 2, top, y);                       // 0 at the foot, 1 at the crest
      const dx = x - L.c[0] - (L.leanDir ? L.leanDir[0] * L.lean * k : 0), dz = z - L.c[1] - (L.leanDir ? L.leanDir[1] * L.lean * k : 0);
      const lx = dx * L.cos + dz * L.sin, lz = -dx * L.sin + dz * L.cos;
      const taper = 1 - 0.28 * k * k;                            // narrower toward the crest
      const dp = ell2(lx, lz, L.r[0] * taper, L.r[1] * taper) + 0.5 * B * NA.noise3(x * 0.25 / B, y * 0.2 / B, z * 0.25 / B);
      const dt = y - top - 0.4 * B * NB.noise3(x * 0.3 / B, 1.7, z * 0.3 / B);
      d = smin(d, smax(dp, dt, 0.6 * B), 0.9 * B);
    }
    return d;
  };
  const sdf = (x, y, z) => {
    let d = design(x, y, z);
    if (d > 3 * B) return (d - 1.2 * B) * 0.75;
    d = (d + relief(x, y, z)) * 0.75;
    // the lobes are open columns downward (they always run into the ground); end them 1.2 m under the terrain
    d = max(d, G.at(x, z) - 1.2 - y);
    if (o.cut) d = max(d, o.cut(x, y, z));
    return d;
  };
  // meshing region: the bounding box of the lobes (with the relief margin)
  let mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  for (const L of lobes) {
    const R = Math.max(L.r[0], L.r[1]) + (L.lean || 0) + B;
    mn = [min(mn[0], L.c[0] - R), min(mn[1], L.base - 3), min(mn[2], L.c[1] - R)];
    mx = [max(mx[0], L.c[0] + R), max(mx[1], L.base + L.top + B), max(mx[2], L.c[1] + R)];
  }
  const origin = [Math.round((mn[0] + mx[0]) / 2), Math.round(mn[1]), Math.round((mn[2] + mx[2]) / 2)];
  const region = { name: o.name, min: mn, max: mx, cell: o.cell ?? 0.12 };
  return { sdf, region, origin, ground: G };
}
