// Street plan of Lin'an (临安) east of the lake: blocks, lanes and the houses in them (pure data, no three.js).
//
//   planCity({ vMax, density }) → { houses, lanes, courtyards, frame, canalsUV, stats }
//     houses:     [{ x, z, rot (rad, front = local +Z), w, d, kind: 'shop' | 'house' | 'hall', street (on 御街),
//                    canal (backs onto a canal), y }]
//     lanes:      [{ v, w, u0, u1 }] cross lanes (perpendicular to 御街) in the 御街 frame
//     courtyards: [{ x, z, r }] open yards inside the blocks (tree spots for the vegetation module)
//     yardWalls:  [{ a: [x, z], b: [x, z], y }] white courtyard walls (walled plots on the lanes, src/city/yards.js);
//     yardGates:  [{ at, rot, w, y }] their gates
//     frame:      the 御街 frame helpers (toWorld(u, v), toUV(x, z), at(v))
//
// The frame: v = metres along 御街 from its south end (和宁门), u = metres east of its centre line. 御街 runs almost
// straight north-south, so blocks are laid out in (u, v): cross lanes every ~55 m (layout CITY.grid.lane), north-south
// alleys every 45-65 m, the two canals and the walls cut the blocks. Houses line every block edge facing the street,
// lane, alley or canal outside it (deep two-storey shops on 御街), the middle of a block stays a yard (trees) or
// holds a single-storey hall. Hills (吴山, 万松岭), water and the big buildings (鼓楼, pagodas) are kept clear.
// Deterministic: hash01 of integer coordinates only.
import * as L from '../world/layout.js';
import { heightAt } from '../world/heightfield.js';
import { hash01 } from '../core/rng.js';

const H = (...a) => hash01(...a.map((v) => Math.round(v * 10)));

// ------------------------------------------------------------------------------------------------ the 御街 frame
export function yujieFrame() {
  const P = L.CITY.yujie.points;
  const seg = [];
  let acc = 0;
  for (let i = 0; i < P.length - 1; i++) {
    const [ax, az] = P[i], [bx, bz] = P[i + 1];
    const len = Math.hypot(bx - ax, bz - az);
    seg.push({ ax, az, tx: (bx - ax) / len, tz: (bz - az) / len, len, acc });
    acc += len;
  }
  const total = acc;
  /** point and frame at v: tangent t (toward the north end), east normal n */
  const at = (v) => {
    let s = seg[0];
    for (const q of seg) { s = q; if (v <= q.acc + q.len) break; }
    const t = Math.max(-200, v - s.acc);
    const x = s.ax + s.tx * t, z = s.az + s.tz * t;
    return { x, z, tx: s.tx, tz: s.tz, nx: -s.tz, nz: s.tx };
  };
  const toWorld = (u, v) => { const f = at(v); return [f.x + f.nx * u, f.z + f.nz * u]; };
  /** world → (u, v): nearest point on the polyline (the line is nearly straight) */
  const toUV = (x, z) => {
    let best = Infinity, bu = 0, bv = 0;
    for (const q of seg) {
      const dx = x - q.ax, dz = z - q.az;
      const t = Math.max(-500, Math.min(q.len + 500, dx * q.tx + dz * q.tz));
      const px = q.ax + q.tx * t, pz = q.az + q.tz * t;
      const d = Math.hypot(x - px, z - pz);
      if (d < best) { best = d; bv = q.acc + t; bu = (x - px) * -q.tz + (z - pz) * q.tx; }
    }
    return [bu, bv];
  };
  return { at, toWorld, toUV, total, width: L.CITY.yujie.width };
}

/** a polyline in (u, v) sorted by v, and u(v) by linear interpolation */
function lineUV(F, pts) {
  const uv = pts.map(([x, z]) => F.toUV(x, z)).sort((a, b) => a[1] - b[1]);
  return {
    uv,
    uAt(v) {
      if (v < uv[0][1] || v > uv[uv.length - 1][1]) return null;
      for (let i = 0; i < uv.length - 1; i++) if (v <= uv[i + 1][1]) { const t = (v - uv[i][1]) / (uv[i + 1][1] - uv[i][1] || 1); return uv[i][0] + (uv[i + 1][0] - uv[i][0]) * t; }
      return null;
    },
  };
}

/** distance from (x, z) to a polyline */
export function distToLine(x, z, pts) {
  let best = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
    const ex = bx - ax, ez = bz - az, l2 = ex * ex + ez * ez;
    const t = Math.max(0, Math.min(1, ((x - ax) * ex + (z - az) * ez) / l2));
    best = Math.min(best, Math.hypot(x - ax - ex * t, z - az - ez * t));
  }
  return best;
}

/**
 * Big buildings among the houses, art-directed in the 御街 frame (u east of the street, v along it) after ref07: the
 * two-storey 酒樓 on the left, the halls across the canal on the right, temples further out. Built by the city module
 * with the 營造法式 generator (src/yingzao/buildings.js). facing = compass bearing of the front.
 */
export const CITY_LANDMARKS = [
  { id: 'jiulou-1', u: 98, v: 2262, kind: 'louge', facing: 0, r: 15 },     // ref07 left (0.27, 0.42)
  { id: 'hall-w1', u: -166, v: 2250, kind: 'hall', facing: 0, r: 14 },     // ref07 right (0.92, 0.42)
  { id: 'jiulou-2', u: 108, v: 2052, kind: 'louge', facing: 0, r: 13 },    // ref07 (0.36, 0.30)
  { id: 'temple-w', u: -238, v: 2142, kind: 'chongyan', facing: 0, r: 17 },// ref07 right (0.97, 0.38)
  { id: 'hall-e2', u: 285, v: 1812, kind: 'hall', facing: 270, r: 14 },   // ref07 left (0.12, 0.28)
  { id: 'jiulou-3', u: -88, v: 1702, kind: 'louge', facing: 90, r: 13 },
  { id: 'hall-e3', u: 160, v: 1500, kind: 'hall', facing: 0, r: 14 },
  { id: 'temple-e', u: 232, v: 2200, kind: 'chongyan', facing: 0, r: 17 },
  // ink07: more 酒樓 rising over the shop rows close to 御街, behind its first row of shops
  { id: 'jiulou-4', u: 44, v: 2420, kind: 'louge', facing: 270, r: 14 },
  { id: 'jiulou-5', u: 46, v: 2140, kind: 'louge', facing: 270, r: 14 },
  { id: 'jiulou-6', u: 140, v: 2560, kind: 'louge', facing: 0, r: 14 },
  { id: 'jiulou-7', u: 60, v: 1880, kind: 'louge', facing: 270, r: 14 },
];

/** the art-directed east wall of the city (the real Song wall ran along today's 环城东路) */
export const EAST_WALL = [[3470, -2400], [3490, -1200], [3505, 0], [3470, 1200], [3330, 2050]];

/** the plan */
export function planCity({ vMin = 20, vMax = 2860, density = 1 } = {}) {
  const F = yujieFrame();
  const C = L.CITY, G = C.grid;
  const half = F.width / 2;
  const canals = (C.canals || []).map((c) => ({ ...c, line: lineUV(F, c.points) }));
  const westWall = lineUV(F, C.westWall), eastWall = lineUV(F, EAST_WALL);
  const ground = C.ground;
  // things to keep clear: the drum tower, the city pagodas, gate towers
  const keep = [];
  for (const h of L.HALLS) if (h.center && (h.kind === 'gulou' || /men/.test(h.kind)) && h.center[0] > 1300) keep.push({ x: h.center[0], z: h.center[1], r: (h.padRadius || 20) + 8 });
  for (const p of L.PAGODAS) if (p.center[0] > 1300 && p.center[1] < 2500) keep.push({ x: p.center[0], z: p.center[1], r: Math.max(16, p.height * 0.34) });
  for (const lm of C.landmarks || []) keep.push({ x: lm.at[0], z: lm.at[1], r: 30 });
  const landmarks = CITY_LANDMARKS.map((b) => { const [x, z] = F.toWorld(b.u, b.v); return { ...b, x, z, y: heightAt(x, z) }; });
  for (const b of landmarks) keep.push({ x: b.x, z: b.z, r: b.r + 3 });

  // ---- cross lanes (perpendicular to 御街), every ~lane m with a little jitter
  const lanes = [];
  {
    let v = vMax;
    let i = 0;
    while (v > vMin) {
      const w = 3.6 + 2 * H(i, 3.3);
      lanes.push({ v, w, i });
      v -= G.lane * (0.85 + 0.3 * H(i, 1.7));
      i++;
    }
    lanes.reverse();
  }
  const houses = [], courtyards = [], yardWalls = [], yardGates = [];
  const stats = { blocks: 0, dropped: 0 };
  // ---- strips between lanes
  for (let li = 0; li < lanes.length - 1; li++) {
    const A = lanes[li], B = lanes[li + 1];
    const va = A.v + A.w / 2, vb = B.v - B.w / 2;
    if (vb - va < 8) continue;
    const vm = (va + vb) / 2;
    // cuts in u: [u0, u1] open ground that is not building land (street, canals, alleys, beyond the walls)
    const cuts = [[-half, half]];
    for (const c of canals) {
      const uc = c.line.uAt(vm);
      if (uc === null) continue;
      const hw = c.width / 2 + 1.6;
      cuts.push([uc - hw, uc + hw, 'canal']);
    }
    const uw = westWall.uAt(vm), ue = eastWall.uAt(vm);
    const uMin = (uw ?? -1400) + 28, uMax = (ue ?? 1300) - 24;
    // alleys: walk out from the street on both sides
    for (const side of [-1, 1]) {
      let u = half;
      let k = 0;
      while (u < 1800) {
        u += 40 + 22 * H(li, k, side * 5.1);
        const aw = 2.4 + 1.3 * H(li, k, 7.7);
        cuts.push([side > 0 ? u : -u - aw, side > 0 ? u + aw : -u]);
        u += aw;
        k++;
      }
    }
    cuts.sort((a, b) => a[0] - b[0]);
    // merge the cuts and collect the blocks between them, within the walls
    const merged = [];
    for (const c of cuts) {
      const last = merged[merged.length - 1];
      if (last && c[0] <= last[1] + 7) { last[1] = Math.max(last[1], c[1]); last[2] = last[2] || c[2]; last[3] = (last[3] || 0) + 1; }
      else merged.push([c[0], c[1], c[2], 0]);
    }
    for (let k = 0; k < merged.length - 1; k++) {
      const ua = Math.max(merged[k][1], uMin), ub = Math.min(merged[k + 1][0], uMax);
      if (ub - ua < 9) continue;
      stats.blocks++;
      fillBlock({ ua, ub, va, vb, li, k, onStreetW: merged[k][0] <= -half + 0.1 && merged[k][1] >= half - 0.1, onStreetE: merged[k + 1][0] <= -half + 0.1 && merged[k + 1][1] >= half - 0.1,
        canalW: merged[k][2] === 'canal', canalE: merged[k + 1][2] === 'canal' });
    }
  }

  function fillBlock(b) {
    const { ua, ub, va, vb, li, k } = b;
    const bw = ub - ua, bd = vb - va;
    // which u-edges face 御街 (shops, deep), canals or alleys
    const streetW = b.onStreetW, streetE = b.onStreetE;
    const dW = streetW ? 15 + 2.5 * H(li, k, 1) : b.canalW ? 11.5 : 11.5 + 2.5 * H(li, k, 2);
    const dE = streetE ? 15 + 2.5 * H(li, k, 3) : b.canalE ? 11.5 : 11.5 + 2.5 * H(li, k, 4);
    // one block in four keeps a garden in the middle (rows shallower on the lanes, no inner hall): room for trees
    const garden = H(li, k, 8) < 0.27;
    const dS = garden ? 10 : 12.5 + 4 * H(li, k, 5), dN = garden ? 10 : 12.5 + 4 * H(li, k, 6);
    const twoRows = bw > dW + dE + 3;
    // u-edges: full length along v
    rowAlong('W', ua, va, vb, dW, streetW ? 'shop' : 'house', streetW, b.canalW);
    if (twoRows) rowAlong('E', ub, va, vb, dE, streetE ? 'shop' : 'house', streetE, b.canalE);
    // lane edges between the u rows
    const u0 = ua + dW + 0.3, u1 = (twoRows ? ub - dE : ub) - 0.3;
    if (u1 - u0 > 4.5) {
      if (bd > dS + 3) rowAcross('S', va, u0, u1, dS);
      if (bd > dS + dN + 3) rowAcross('N', vb, u0, u1, dN);
    }
    // the yard in the middle: a hall in big blocks, otherwise open (trees)
    const iu0 = u0 + 0.5, iu1 = u1 - 0.5, iv0 = va + dS + 0.5, iv1 = vb - dN - 0.5;
    if (iu1 - iu0 > 7 && iv1 - iv0 > 7) {
      const cu = (iu0 + iu1) / 2, cv = (iv0 + iv1) / 2;
      if (!garden && iu1 - iu0 > 16 && iv1 - iv0 > 11 && H(li, k, 9) < 0.8) {
        // a single-storey 歇山 hall facing south across its yard
        const w = Math.min(19, iu1 - iu0 - 6), d = Math.min(15, (iv1 - iv0) * 0.55);
        const [x, z] = F.toWorld(cu, iv1 - d / 2 - 0.5);
        addHouse(x, z, faceV(-1), w, d, 'hall', false, false);
        const [tx, tz] = F.toWorld(cu + (H(li, k, 10) - 0.5) * (iu1 - iu0) * 0.4, iv0 + (iv1 - iv0 - d) * 0.45);
        courtyards.push({ x: tx, z: tz, r: Math.min((iu1 - iu0) * 0.5, (iv1 - iv0 - d) * 0.5) });
      } else {
        const [x, z] = F.toWorld(cu, cv);
        courtyards.push({ x, z, r: Math.min(iu1 - iu0, iv1 - iv0) * 0.5, garden });
      }
    }
  }

  /** compass-bearing rotation for a house whose front looks along +/-u or +/-v */
  function faceU(sign, v) { const f = F.at(v); return Math.atan2(f.nx * sign, f.nz * sign); }
  function faceV(sign, v = 1000) { const f = F.at(v); return Math.atan2(f.tx * sign, f.tz * sign); }

  /** a row of houses along a u-edge (the block's west 'W' or east 'E' side), fronts facing out */
  function rowAlong(side, uEdge, v0, v1, depth, kind, street, canal) {
    const sgn = side === 'W' ? -1 : 1;           // the front looks toward -u on the west edge
    let v = v0 + 0.2, i = 0;
    while (v < v1 - 3.5) {
      let w = street ? 9 + 7.5 * H(uEdge, v, 11) : 7.5 + 5.5 * H(uEdge, v, 12);
      if (v + w > v1 - 0.2) w = v1 - 0.2 - v;
      if (w < 4.5) break;
      const uc = uEdge - sgn * depth / 2;
      const [x, z] = F.toWorld(uc, v + w / 2);
      addHouse(x, z, faceU(sgn, v), w, depth * (0.9 + 0.1 * H(uEdge, v, 13)), kind, street, canal);
      v += w + (H(uEdge, v, 14) < 0.12 ? 1.2 : 0.05);
      i++;
    }
  }
  /** a row along a lane edge ('S' = the south edge of the block, fronts face south / -v); ink07: one plot in
   *  four is a walled court — a white wall with a gate along the lane, the house set back behind its yard */
  function rowAcross(side, vEdge, u0, u1, depth) {
    const sgn = side === 'S' ? -1 : 1;
    let u = u0;
    while (u < u1 - 3.5) {
      let w = 7.5 + 5.5 * H(u, vEdge, 21);
      const court = depth > 11.5 && H(u, vEdge, 24) < 0.27;
      if (court) w = 11 + 7 * H(u, vEdge, 25);
      if (u + w > u1) w = u1 - u;
      if (w < 3.8) break;
      if (court && w > 9) {
        const dh = Math.max(6.5, depth - 6 - 2 * H(u, vEdge, 26));          // the house at the back of the plot
        const vc = vEdge - sgn * (depth - dh / 2);
        const [x, z] = F.toWorld(u + w / 2, vc);
        const n0 = houses.length;
        addHouse(x, z, faceV(sgn, vc), w - 1.2, dh, 'house', false, false);
        if (houses.length > n0) {
          // the wall: along the lane edge (a gate opening in its middle), and back along both plot sides to the house
          const y = houses[houses.length - 1].y;
          const g = 1.4 + 0.4 * H(u, vEdge, 27), um = u + w / 2 + (H(u, vEdge, 28) - 0.5) * (w - 4);
          const P = (uu, vv) => F.toWorld(uu, vv);
          const vf = vEdge - sgn * 0.3, vb = vEdge - sgn * (depth - dh + 0.2);
          yardWalls.push({ a: P(u + 0.15, vf), b: P(um - g, vf), y }, { a: P(um + g, vf), b: P(u + w - 0.15, vf), y });
          yardWalls.push({ a: P(u + 0.15, vf), b: P(u + 0.15, vb), y }, { a: P(u + w - 0.15, vf), b: P(u + w - 0.15, vb), y });
          yardGates.push({ at: P(um, vf), rot: faceV(sgn, vf), w: 2 * g, y });
          const [cx, cz] = P(u + w / 2, (vf + vb) / 2);
          courtyards.push({ x: cx, z: cz, r: Math.min(w, Math.abs(vb - vf)) * 0.4, court: true });
        }
      } else {
        const vc = vEdge - sgn * depth / 2;
        const [x, z] = F.toWorld(u + w / 2, vc);
        addHouse(x, z, faceV(sgn, vc), w, depth * (0.9 + 0.1 * H(u, vEdge, 22)), 'house', false, false);
      }
      u += w + (H(u, vEdge, 23) < 0.15 ? 1.5 : 0.05);
    }
  }

  function addHouse(x, z, rot, w, d, kind, street, canal) {
    // drop where the ground is not city land: water, hills, canal banks, kept spots
    const c = Math.cos(rot), s = Math.sin(rot);
    const corners = [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2], [0, 0]].map(([lx, lz]) => [x + lx * c + lz * s, z - lx * s + lz * c]);
    let hmin = Infinity, hmax = -Infinity;
    for (const [px, pz] of corners) { const h = heightAt(px, pz); hmin = Math.min(hmin, h); hmax = Math.max(hmax, h); }
    if (hmin < ground - 2.2 || hmax > ground + 4.5 || hmax - hmin > 1.4) { stats.dropped++; return; }
    for (const cn of C.canals || []) for (const [px, pz] of corners) if (distToLine(px, pz, cn.points) < cn.width / 2 + 1.1) { stats.dropped++; return; }
    for (const q of keep) if (Math.hypot(x - q.x, z - q.z) < q.r + Math.max(w, d) / 2) { stats.dropped++; return; }
    if (density < 1 && hash01(Math.round(x), Math.round(z), 91) > density && !street) return;
    houses.push({ x, z, rot, w, d, kind, street, canal, y: hmin - 0.04 });
  }

  // ---- suburbs on the south shore (outside 清波门 / around 长桥): rows facing south, lanes between
  suburbs();
  function suburbs() {
    const poly = [[640, 1120], [900, 1040], [1180, 960], [1380, 1000], [1420, 1180], [1300, 1380], [1000, 1420], [700, 1330]];
    const inside = (x, z) => { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [xi, zi] = poly[i], [xj, zj] = poly[j]; if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c; } return c; };
    for (let z = 960; z < 1440; z += 26) {
      for (const side of [-1, 1]) {
        let x = 620 + 6 * H(z, side);
        while (x < 1440) {
          const w = 5 + 4 * H(x, z, side, 31), d = 9 + 2 * H(x, z, 32);
          const cx = x + w / 2, cz = z + side * (d / 2 + 0.4);
          x += w + (H(x, z, 33) < 0.2 ? 3 : 0.1);
          if (!inside(cx, cz)) continue;
          const h0 = heightAt(cx, cz), h1 = heightAt(cx + w / 2, cz + d / 2), h2 = heightAt(cx - w / 2, cz - d / 2);
          if (Math.min(h0, h1, h2) < 0.9 || Math.max(h0, h1, h2) > 9 || Math.abs(h1 - h2) > 1.2) continue;
          if (keep.some((q) => Math.hypot(cx - q.x, cz - q.z) < q.r + 8)) continue;
          houses.push({ x: cx, z: cz, rot: side < 0 ? 0 : Math.PI, w, d, kind: 'house', street: false, canal: false, y: Math.min(h0, h1, h2) - 0.05, suburb: true });
        }
      }
    }
  }

  // ---- hamlets outside the walls (layout HAMLETS): rows along a shore, fronts to the water
  for (const V of L.HAMLETS || []) hamlet(V);
  function hamlet(V) {
    const P = V.bank;
    let k = 0;
    for (let off = V.from; off <= V.to; off += V.rowGap, k++) {
      for (let i = 0; i < P.length - 1; i++) {
        const [ax, az] = P[i], [bx, bz] = P[i + 1], len = Math.hypot(bx - ax, bz - az);
        const tx = (bx - ax) / len, tz = (bz - az) / len, rx = -tz, rz = tx;     // right of the bank = the water
        const rot = Math.atan2(rx, rz);                                        // front (local +Z) toward the water
        let s = 4 * H(i, k, 51) + k * 3;
        while (s < len - 4) {
          // a village, not a terrace: lots of different widths and depths, gaps (yards, lanes down to the water), the
          // back rows set back unevenly and thinning out
          const w = 5 + 6 * H(s, k, i, 52), d = 7.5 + 4 * H(s, k, 53);
          const gap = H(s, k, 54) < 0.3 + 0.12 * k ? 3 + 9 * H(s, k, 55) : 0.15;
          const o = off + d / 2 + (k ? 5 : 1) * (H(s, k, 56) - 0.5);
          if (k && H(s, k, 58) < 0.25 * k) { s += w + gap; continue; }
          const cx = ax + tx * (s + w / 2) - rx * o, cz = az + tz * (s + w / 2) - rz * o;
          s += w + gap;
          const c = [[w / 2, d / 2], [-w / 2, d / 2], [w / 2, -d / 2], [-w / 2, -d / 2], [0, 0]].map(([pu, pv]) => heightAt(cx + tx * pu - rx * pv, cz + tz * pu - rz * pv));
          const hmin = Math.min(...c), hmax = Math.max(...c);
          if (hmin < 1.0 || hmax > V.maxH || hmax - hmin > 1.6) { stats.dropped++; continue; }
          if (keep.some((q) => Math.hypot(cx - q.x, cz - q.z) < q.r + 8)) continue;
          if ((L.HALLS || []).some((h) => h.center && Math.hypot(cx - h.center[0], cz - h.center[1]) < 18)) continue;
          if ((L.PAGODAS || []).some((p) => Math.hypot(cx - p.center[0], cz - p.center[1]) < 36)) continue;
          if ((L.STAIRS || []).some((st) => distToLine(cx, cz, [st.from, st.to]) < st.width / 2 + Math.max(w, d) / 2 + 1)) continue;
          const kind = k === 0 && H(s, 57) < 0.6 ? 'shop' : 'house';
          // a third of them turn their gable to the water (the plot's long side runs inland)
          const turn = H(s, k, 59) < 0.35;
          houses.push({ x: cx, z: cz, rot: turn ? rot + Math.PI / 2 : rot, w: turn ? d : w, d: turn ? w : d, kind, street: false, canal: false, y: hmin - 0.05, suburb: true, hamlet: V.id });
        }
      }
    }
  }

  return { houses, lanes, courtyards, yardWalls, yardGates, landmarks, frame: F, canals, westWall, eastWall, stats, vMin, vMax };
}
