// Streets and water of the city: the 御街 stone paving with its gutters, the canal embankments (stone walls,
// coping, a paved quay strip, landing steps down to the water) and the hump bridges over the canals at the cross lanes.
//
//   build(engine, plan) → { group, bridges: [{ x, z, axis, lod }], tris }
// Everything in the shared bridge stone material (src/bridges/material.js); one mesh per kind of work and LOD.
import * as THREE from 'three';
import * as L from '../world/layout.js';
import { heightAt } from '../world/heightfield.js';
import { MeshBuilder } from '../yingzao/geom.js';
import { bakeAO } from '../yingzao/ao.js';
import { bridgeStoneMaterial, BK } from '../bridges/material.js';
import { archBridgeParts } from '../bridges/arch.js';
import { hash01 } from '../core/rng.js';
import { viewDist, lodFor } from './lod.js';

/** quad with its normal turned toward `want` */
function qw(B, a, b, c, d, want, pa, uv) {
  const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
  const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
  const P = typeof pa === 'function' ? [pa(a), pa(b), pa(c), pa(d)] : [pa, pa, pa, pa];
  if (nx * want[0] + ny * want[1] + nz * want[2] >= 0) B.quad(a, b, c, d, P[0], P[1], P[2], P[3], uv);
  else B.quad(a, d, c, b, P[0], P[3], P[2], P[1], uv ? [uv[0], uv[3], uv[2], uv[1]] : null);
}
/** box from its 8 corners (bottom CCW then top), faces out of the centre, metric uv per face */
function hexa(B, c, kind, wlBase = 0) {
  const ctr = c.reduce((a, v) => [a[0] + v[0] / 8, a[1] + v[1] / 8, a[2] + v[2] / 8], [0, 0, 0]);
  const pa = (v) => [kind, v[1] - wlBase, 0, 0];
  const f = (i, j, k, l) => {
    const a = c[i], b = c[j], cc = c[k], d = c[l];
    const lab = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]), lad = Math.hypot(d[0] - a[0], d[1] - a[1], d[2] - a[2]);
    qw(B, a, b, cc, d, [(a[0] + cc[0]) / 2 - ctr[0], (a[1] + cc[1]) / 2 - ctr[1], (a[2] + cc[2]) / 2 - ctr[2]], pa, [[a[0] + a[2], 0], [a[0] + a[2] + lab, 0], [a[0] + a[2] + lab, lad], [a[0] + a[2], lad]]);
  };
  f(0, 1, 2, 3); f(4, 5, 6, 7); f(0, 1, 5, 4); f(1, 2, 6, 5); f(2, 3, 7, 6); f(3, 0, 4, 7);
}

/** a polyline resampled every `step` m with unit tangents and left normals */
function resample(pts, step) {
  const out = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
    const len = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.ceil(len / step));
    for (let k = 0; k < n; k++) out.push([ax + ((bx - ax) * k) / n, az + ((bz - az) * k) / n]);
  }
  out.push(pts[pts.length - 1]);
  return out.map((p, i) => {
    const a = out[Math.max(0, i - 1)], b = out[Math.min(out.length - 1, i + 1)];
    const tx = b[0] - a[0], tz = b[1] - a[1], l = Math.hypot(tx, tz) || 1;
    return { x: p[0], z: p[1], tx: tx / l, tz: tz / l, nx: -tz / l, nz: tx / l };
  });
}

export async function build(engine, plan) {
  const t0 = performance.now();
  const group = new THREE.Group(); group.name = 'city:streets';
  const mat = bridgeStoneMaterial();
  const F = plan.frame;
  const meshes = [];
  const add = (B, name, { ao = false, shadow = true } = {}) => {
    if (!B.count) return;
    if (ao) bakeAO({ targets: [{ B }], occluders: [{ B }], cell: 0.15, coarse: 0.4, near: 0.7, far: 4, upFar: 8 });
    const m = new THREE.Mesh(B.toGeometry(), mat);
    m.name = name; m.castShadow = shadow; m.receiveShadow = true;
    m.userData.castShadow = shadow;
    group.add(m); meshes.push(m);
  };
  // ---------------------------------------------------------------- 御街 paving (slabs across the street, gutters)
  {
    const B = new MeshBuilder();
    const half = L.CITY.yujie.width / 2;
    const v0 = plan.vMin - 40, v1 = plan.vMax + 80;
    const us = [-half, -half + 0.45, -half + 0.6, -half / 2, 0, half / 2, half - 0.6, half - 0.45, half];
    const dropAt = (u) => (Math.abs(u) > half - 0.6 && Math.abs(u) < half - 0.45 ? 0.12 : 0);
    const crown = (u) => 0.06 * (1 - (u / half) ** 2);
    const P = (u, v) => { const [x, z] = F.toWorld(u, v); return [x, heightAt(x, z) + 0.06 + crown(u) - dropAt(u), z]; };
    for (let v = v0; v < v1; v += 3) {
      for (let i = 0; i < us.length - 1; i++) {
        const ua = us[i], ub = us[i + 1];
        const kind = Math.abs(ua + ub) / 2 > half - 0.62 ? BK.CURB : BK.PAVE;
        const A = P(ua, v), Bv = P(ub, v), C = P(ub, v + 3), D = P(ua, v + 3);
        qw(B, A, Bv, C, D, [0, 1, 0], [kind, 5, 0, 0], [[ua, v], [ub, v], [ub, v + 3], [ua, v + 3]]);
      }
      // curb faces down to the ground at both edges
      for (const s of [-1, 1]) {
        const a = P(s * half, v), b = P(s * half, v + 3);
        qw(B, [a[0], a[1] - 0.25, a[2]], [b[0], b[1] - 0.25, b[2]], b, a, [s * F.at(v).nx, 0, s * F.at(v).nz], [BK.CURB, 5, 0, 0], [[v, 0], [v + 3, 0], [v + 3, 0.25], [v, 0.25]]);
      }
    }
    add(B, 'yujie-paving', { shadow: false });
  }
  // ---------------------------------------------------------------- canals: walls, coping, quay strip, landing steps
  const bridges = [];
  {
    const B = new MeshBuilder();
    const zMin = F.toWorld(0, plan.vMax + 60)[1], zMax = 2050;
    let steps = 0;
    for (const C of L.CITY.canals || []) {
      const S = resample(C.points, 4).filter((p) => p.z > zMin - 40 && p.z < zMax);
      const hw = C.width / 2;
      for (const side of [-1, 1]) {
        let acc = 0;
        for (let i = 0; i < S.length - 1; i++) {
          const a = S[i], b = S[i + 1];
          if (Math.hypot(b.x - a.x, b.z - a.z) > 8) continue;
          const pa = [a.x + a.nx * hw * side, a.z + a.nz * hw * side], pb = [b.x + b.nx * hw * side, b.z + b.nz * hw * side];
          const qa = [a.x + a.nx * (hw + 3) * side, a.z + a.nz * (hw + 3) * side], qb = [b.x + b.nx * (hw + 3) * side, b.z + b.nz * (hw + 3) * side];
          const ya = Math.max(1.0, heightAt(qa[0], qa[1])), yb = Math.max(1.0, heightAt(qb[0], qb[1]));
          const len = Math.hypot(pb[0] - pa[0], pb[1] - pa[1]);
          const want = [-a.nx * side, 0, -a.nz * side];
          const bot = -1.4;
          // the wall face (toward the water), courses in metric uv
          qw(B, [pa[0], bot, pa[1]], [pb[0], bot, pb[1]], [pb[0], yb - 0.2, pb[1]], [pa[0], ya - 0.2, pa[1]], want, (v) => [BK.WALL, v[1], 0, 0], [[acc, bot], [acc + len, bot], [acc + len, yb - 0.2], [acc, ya - 0.2]]);
          // coping stones, proud of the face
          const o = 0.12, cw = 0.55;
          const ca = [pa[0] - a.nx * side * o, pa[1] - a.nz * side * o], cb = [pb[0] - b.nx * side * o, pb[1] - b.nz * side * o];
          const ia = [pa[0] + a.nx * side * cw, pa[1] + a.nz * side * cw], ib = [pb[0] + b.nx * side * cw, pb[1] + b.nz * side * cw];
          qw(B, [ca[0], ya - 0.2, ca[1]], [cb[0], yb - 0.2, cb[1]], [cb[0], yb + 0.06, cb[1]], [ca[0], ya + 0.06, ca[1]], want, (v) => [BK.COPING, v[1], 0, 0], [[acc, 0], [acc + len, 0], [acc + len, 0.26], [acc, 0.26]]);
          qw(B, [ca[0], ya + 0.06, ca[1]], [cb[0], yb + 0.06, cb[1]], [ib[0], yb + 0.06, ib[1]], [ia[0], ya + 0.06, ia[1]], [0, 1, 0], (v) => [BK.COPING, v[1], 0, 0], [[acc, 0], [acc + len, 0], [acc + len, cw], [acc, cw]]);
          // quay strip (paving) behind the coping, sloping gently up to the ground
          const ra = [pa[0] + a.nx * side * 2.4, pa[1] + a.nz * side * 2.4], rb = [pb[0] + b.nx * side * 2.4, pb[1] + b.nz * side * 2.4];
          qw(B, [ia[0], ya + 0.06, ia[1]], [ib[0], yb + 0.06, ib[1]], [rb[0], heightAt(rb[0], rb[1]) + 0.05, rb[1]], [ra[0], heightAt(ra[0], ra[1]) + 0.05, ra[1]], [0, 1, 0], (v) => [BK.PAVE, v[1], 0, 0], [[0, acc], [0, acc + len], [1.9, acc + len], [1.9, acc]]);
          // landing steps (河埠頭): a flight down along the wall every 70-120 m
          const key = Math.round(acc / 4);
          if (hash01(key, side * 7, C.name.length, 3) < 0.035 && i > 2 && i < S.length - 6) {
            steps++;
            const top = ya + 0.02, n = Math.ceil(top / 0.2), run = 0.3, wS = 1.5;
            for (let k = 0; k < n; k++) {
              const y1 = top - k * (top / n), y0 = -0.8;
              const s0 = k * run, s1 = (k + 1) * run;
              const P = (s, w, y) => [pa[0] + a.tx * s - a.nx * side * w, y, pa[1] + a.tz * s - a.nz * side * w];
              hexa(B, [P(s0, 0, y0), P(s1, 0, y0), P(s1, wS, y0), P(s0, wS, y0), P(s0, 0, y1), P(s1, 0, y1), P(s1, wS, y1), P(s0, wS, y1)], k === 0 ? BK.COPING : BK.TREAD);
            }
          }
          acc += len;
        }
      }
    }
    add(B, 'canal-walls', { shadow: true });
    console.log(`[city] canal embankments: ${(B.count / 3 / 1e3).toFixed(1)}k tris, ${steps} landing steps`);
  }
  // ---------------------------------------------------------------- canal bridges at the cross lanes
  {
    const byLod = [new MeshBuilder(), new MeshBuilder(), new MeshBuilder()];
    const crossings = [];
    // ART (ref07): the three bridges seen down the 市河, near (v ≈ 2437), middle (2283) and far (1905); others at random lanes
    const forced = { '市河': [2437, 2283, 1905] };
    for (const C of plan.canals) {
      const want = (forced[C.name] || []).map((v) => plan.lanes.reduce((b, ln) => (Math.abs(ln.v - v) < Math.abs(b.v - v) ? ln : b), plan.lanes[0]));
      plan.lanes.forEach((ln, i) => {
        const uc = C.line.uAt(ln.v);
        if (uc === null) return;
        const [x, z] = F.toWorld(uc, ln.v);
        if (z > 2000) return;
        const near = plan.lanes[i - 1] && crossings.some((c) => c.C === C && Math.abs(c.v - ln.v) < 70);
        if (!want.includes(ln) && (hash01(i, C.name.length, 17) > 0.42 || near)) return;
        crossings.push({ C, x, z, i, v: ln.v });
      });
    }
    for (const cr of crossings) {
      const { C, x, z } = cr;
      // the canal direction here → the bridge runs across it
      const S = resample(C.points, 6);
      let best = S[0], bd = Infinity;
      for (const p of S) { const d = Math.hypot(p.x - x, p.z - z); if (d < bd) { bd = d; best = p; } }
      const axisDeg = (Math.atan2(best.nx, -best.nz) * 180) / Math.PI;
      const bank = Math.max(2.5, (heightAt(x + best.nx * (C.width / 2 + 4), z + best.nz * (C.width / 2 + 4)) + heightAt(x - best.nx * (C.width / 2 + 4), z - best.nz * (C.width / 2 + 4))) / 2);
      const span = Math.min(10, C.width - 4.5);
      const spec = { span, archH: span / 2, shape: 2, rise: bank + 1.7, width: 5.4, length: C.width + 17, bank, crown: 0.32, foot: 1.5, ringT: 0.5, riser: 0.15 };
      const d = viewDist(x, z, 20);
      const lod = lodFor(d, [330, 1000]);
      spec.rail = lod === 0 ? 'goulan' : 'parapet';
      const parts = archBridgeParts(spec, lod);
      if (lod <= 1) bakeAO({ targets: [{ B: parts.B }], occluders: [{ B: parts.B }], cell: lod === 0 ? 0.08 : 0.16, coarse: 0.32, near: 0.7, far: 5, upFar: 12 });
      const m = new THREE.Matrix4().compose(new THREE.Vector3(x, 0, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), L.headingToRotY(axisDeg)), new THREE.Vector3(1, 1, 1));
      byLod[lod].append(parts.B, m);
      bridges.push({ x, z, axis: axisDeg, lod, canal: C.name, crown: parts.deckY(0), deckY: parts.deckY, width: spec.width, length: spec.length });
      engine.footprints?.addCircle?.(x, z, spec.length / 2, 'bridge');
    }
    byLod.forEach((B, lod) => add(B, 'canal-bridges-lod' + lod, { shadow: true }));
    console.log(`[city] canal bridges: ${bridges.length} (lod ${[0, 1, 2].map((l) => bridges.filter((b) => b.lod === l).length).join('/')}), ${(byLod.reduce((s, B) => s + B.count, 0) / 3 / 1e3).toFixed(1)}k tris`);
  }
  engine.add(group);
  const tris = meshes.reduce((s, m) => s + m.geometry.attributes.position.count / 3, 0);
  console.log(`[city] streets: ${(tris / 1e3).toFixed(0)}k tris in ${Math.round(performance.now() - t0)} ms`);
  return { group, bridges, tris };
}
