// The walls of Lin'an: the west wall along the lake shore (layout CITY.westWall, gates CITY.gates), the art-directed
// east wall (plan.js EAST_WALL) and the palace's north gate 和寧門 at the south end of 御街.
//
//   build(engine, plan) → { group, gates: [{ name, x, z, facing }], tris }
// The wall: rammed earth faced with grey brick (卷十五 條磚), battered faces (1:8), a brick-paved walkway, an outer
// parapet with merlons (垛口) and a low inner parapet (女牆), 馬面 bastions every ~150 m. Gates: 門樓 (a 墩台 with a
// gate passage and a hall on top) by the yingzao generator at a low LOD, the wall cut for them.
import * as THREE from 'three';
import * as L from '../world/layout.js';
import { heightAt } from '../world/heightfield.js';
import { MeshBuilder, PAINT } from '../yingzao/geom.js';
import { hallMaterials } from '../yingzao/materials.js';
import { buildBuilding } from '../yingzao/buildings.js';
import { EAST_WALL } from './plan.js';
import { viewDist, lodFor } from './lod.js';

const TOP = L.CITY.ground + L.CITY.wallHeight;   // the wall top (absolute m)

function qw(B, a, b, c, d, want, pa, uv) {
  const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
  const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
  if (nx * want[0] + ny * want[1] + nz * want[2] >= 0) B.quad(a, b, c, d, pa, pa, pa, pa, uv);
  else B.quad(a, d, c, b, pa, pa, pa, pa, uv ? [uv[0], uv[3], uv[2], uv[1]] : null);
}
/** a block between a centre line segment, from offsets o0..o1 (across, + = outward), heights y0..y1 */
function block(B, p, q, n, o0, o1, y0, y1, u0, kind = PAINT.BRICK) {
  const P = (pt, o, y) => [pt[0] + n[0] * o, y, pt[1] + n[1] * o];
  const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
  const pa = [kind, 0, y1 - y0, 0];
  const t = [(q[0] - p[0]) / len, (q[1] - p[1]) / len];
  qw(B, P(p, o1, y0), P(q, o1, y0), P(q, o1, y1), P(p, o1, y1), [n[0], 0, n[1]], pa, [[u0, y0], [u0 + len, y0], [u0 + len, y1], [u0, y1]]);
  qw(B, P(p, o0, y0), P(q, o0, y0), P(q, o0, y1), P(p, o0, y1), [-n[0], 0, -n[1]], pa, [[u0, y0], [u0 + len, y0], [u0 + len, y1], [u0, y1]]);
  qw(B, P(p, o0, y1), P(q, o0, y1), P(q, o1, y1), P(p, o1, y1), [0, 1, 0], pa, null);
  qw(B, P(p, o0, y0), P(p, o1, y0), P(p, o1, y1), P(p, o0, y1), [-t[0], 0, -t[1]], pa, [[o0, y0], [o1, y0], [o1, y1], [o0, y1]]);
  qw(B, P(q, o0, y0), P(q, o1, y0), P(q, o1, y1), P(q, o0, y1), [t[0], 0, t[1]], pa, [[o0, y0], [o1, y0], [o1, y1], [o0, y1]]);
}

/** one wall along a polyline; outward = the side away from the city (sign) */
function wallAlong(getB, pts, { outSign, gaps = [], zMin = -Infinity, zMax = Infinity, step = 6 }) {
  const topHalf = 4.6, batter = 0.125;
  let u = 0;
  let bastionAt = 70;
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
    const len = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.ceil(len / step));
    const tx = (bx - ax) / len, tz = (bz - az) / len;
    const nrm = [-tz * outSign, tx * outSign];
    for (let k = 0; k < n; k++) {
      const p = [ax + ((bx - ax) * k) / n, az + ((bz - az) * k) / n], q = [ax + ((bx - ax) * (k + 1)) / n, az + ((bz - az) * (k + 1)) / n];
      const seg = len / n;
      const mid = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
      u += seg;
      const B = getB(u);
      if (mid[1] < zMin || mid[1] > zMax) continue;
      if (gaps.some((g) => Math.hypot(mid[0] - g[0], mid[1] - g[1]) < g[2])) continue;
      // foot: the lower of the ground on both sides (the lake side is low), a little buried
      const yo = Math.min(heightAt(mid[0] + nrm[0] * 9, mid[1] + nrm[1] * 9), heightAt(mid[0] - nrm[0] * 9, mid[1] - nrm[1] * 9));
      const yb = Math.max(-0.6, Math.min(yo, L.CITY.ground) - 0.8);
      const H = TOP - yb;
      const P = (pt, o, y) => [pt[0] + nrm[0] * o, y, pt[1] + nrm[1] * o];
      const pa = (h) => [PAINT.BRICK, 0, h, 0];
      // battered faces
      for (const side of [1, -1]) {
        const oB = side * (topHalf + batter * H), oT = side * topHalf;
        qw(B, P(p, oB, yb), P(q, oB, yb), P(q, oT, TOP), P(p, oT, TOP), [nrm[0] * side, 0.12, nrm[1] * side], pa(H), [[u - seg, yb], [u, yb], [u, TOP], [u - seg, TOP]]);
      }
      // walkway
      qw(B, P(p, -topHalf, TOP), P(q, -topHalf, TOP), P(q, topHalf, TOP), P(p, topHalf, TOP), [0, 1, 0], pa(0.1), null);
      // parapets: the outer one with merlons, the inner low one
      block(B, p, q, nrm, topHalf - 0.62, topHalf, TOP, TOP + 1.0, u - seg);
      block(B, p, q, nrm, -topHalf, -topHalf + 0.5, TOP, TOP + 0.85, u - seg);
      const nm = Math.max(1, Math.round(seg / 2.3));
      for (let m = 0; m < nm; m++) {
        const t0 = (m + 0.18) / nm, t1 = (m + 0.82) / nm;
        const a = [p[0] + (q[0] - p[0]) * t0, p[1] + (q[1] - p[1]) * t0], b = [p[0] + (q[0] - p[0]) * t1, p[1] + (q[1] - p[1]) * t1];
        block(B, a, b, nrm, topHalf - 0.62, topHalf, TOP + 1.0, TOP + 1.85, u);
      }
      // 馬面 bastion
      if (u > bastionAt) {
        bastionAt = u + 140 + 30 * Math.sin(u);
        const w = 9, dep = 7;
        const c0 = [mid[0] - tx * w / 2, mid[1] - tz * w / 2], c1 = [mid[0] + tx * w / 2, mid[1] + tz * w / 2];
        block(B, c0, c1, nrm, topHalf + batter * H * 0.5, topHalf + dep, yb, TOP, u);
        block(B, c0, c1, nrm, topHalf + dep - 0.6, topHalf + dep, TOP, TOP + 1.7, u);
      }
    }
  }
}

export async function build(engine, plan) {
  const t0 = performance.now();
  const mats = hallMaterials();
  const group = new THREE.Group(); group.name = 'city:walls';
  // the walls in ~300 m pieces (each culled on its own in the camera, the reflection and the shadow cascades)
  const chunks = [];
  const chunker = () => { let cur = null, u0 = -Infinity; return (u) => { if (u - u0 > 300) { cur = new MeshBuilder(); chunks.push(cur); u0 = u; } return cur; }; };
  const gates = [];
  // outward = away from the middle of the city
  const outOf = (line) => {
    const [ax, az] = line[0], [bx, bz] = line[1];
    const n = [-(bz - az), bx - ax], m = [(ax + bx) / 2 - 2450, (az + bz) / 2 - 0];
    return n[0] * m[0] + n[1] * m[1] > 0 ? 1 : -1;
  };
  const W = L.CITY.westWall;
  const outW = outOf(W);
  const zMin = plan.frame.toWorld(0, plan.vMax + 250)[1];
  const westGates = (L.CITY.gates || []).filter((g) => g.at[1] > zMin - 50);
  wallAlong(chunker(), W, { outSign: outW, zMin, gaps: westGates.map((g) => [g.at[0], g.at[1], 14]) });
  // east wall: outward = east (+x)
  const eastGates = [[3497, -600, '崇新門'], [3488, 600, '新門']];
  wallAlong(chunker(), EAST_WALL, { outSign: outOf(EAST_WALL), zMin, gaps: eastGates.map((g) => [g[0], g[1], 14]) });
  let wallTris = 0;
  chunks.forEach((B, i) => {
    if (!B.count) return;
    const mesh = new THREE.Mesh(B.toGeometry(), mats.stone);
    mesh.name = 'city:walls:brick' + i; mesh.castShadow = true; mesh.receiveShadow = true;
    group.add(mesh); wallTris += B.count / 3;
  });
  // gate towers
  const gateList = [
    ...westGates.map((g) => ({ name: g.name, x: g.at[0], z: g.at[1], facing: null, side: outW, line: W })),
    ...eastGates.map((g) => ({ name: g[2], x: g[0], z: g[1], facing: 90, line: EAST_WALL })),
    { name: '和寧門', x: L.CITY.yujie.points[0][0], z: L.CITY.yujie.points[0][1] + 6, facing: 0, palace: true },
  ];
  for (const g of gateList) {
    if (g.facing === null) {
      // the wall direction at the gate → face across it, toward the lake
      let best = null, bd = Infinity;
      for (let i = 0; i < g.line.length - 1; i++) {
        const [px, pz] = g.line[i], [qx, qz] = g.line[i + 1];
        const ex = qx - px, ez = qz - pz, l2 = ex * ex + ez * ez;
        const t = Math.max(0, Math.min(1, ((g.x - px) * ex + (g.z - pz) * ez) / l2));
        const d = Math.hypot(g.x - px - ex * t, g.z - pz - ez * t);
        if (d < bd) { bd = d; best = [ex, ez]; }
      }
      const l = Math.hypot(best[0], best[1]);
      const nx = (-best[1] / l) * g.side, nz = (best[0] / l) * g.side;
      g.facing = (Math.atan2(nx, -nz) * 180) / Math.PI;
    }
    const d = viewDist(g.x, g.z, 20);
    const lod = Math.max(1, lodFor(d, [200, 700]));
    let y0 = Infinity;
    for (const [ox, oz] of [[0, 0], [12, 8], [-12, 8], [12, -8], [-12, -8]]) y0 = Math.min(y0, heightAt(g.x + ox, g.z + oz));
    y0 = Math.max(-0.3, y0 - 0.4);
    const dunH = (g.palace ? TOP + 2 : TOP + 0.6) - y0;
    try {
      const { group: bg } = buildBuilding('menlou', {
        dun: { w: g.palace ? 34 : 26, d: g.palace ? 20 : 17, h: dunH, gate: { w: 5.4, h: Math.min(7, dunH * 0.55) } },
        top: { bays: g.palace ? 7 : 5, rafters: 6, grade: g.palace ? 3 : 4, puzuo: g.palace ? 6 : 5, roof: g.palace ? 'wudian' : 'xieshan', type: 'diange', jiaShen: 135, columnRatio: 0.8, walls: 'louge' },
      }, { lod, name: g.name, ao: lod <= 1 });
      bg.position.set(g.x, y0, g.z);
      bg.rotation.y = L.headingToRotY(g.facing);
      bg.name = 'city:gate:' + g.name;
      group.add(bg);
      gates.push({ name: g.name, x: g.x, z: g.z, facing: g.facing, lod });
      engine.footprints?.addCircle?.(g.x, g.z, 18, 'gate');
    } catch (e) { console.error('[city] gate ' + g.name + ' failed:', e.stack || e); }
  }
  engine.add(group);
  const tris = wallTris;
  console.log(`[city] walls: ${(tris / 1e3).toFixed(0)}k tris in ${chunks.length} pieces, gates ${gates.map((g) => `${g.name} (lod ${g.lod})`).join(', ')}, ${Math.round(performance.now() - t0)} ms`);
  return { group, gates, tris };
}
