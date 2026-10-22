// Shore works: stone quays where a reference shows a built shore — the 雷峰 temple shore (ref04: a low stone wall
// with a 勾闌 balustrade and steps, a retaining wall up to the temple court) and the Qiantang bank below 六和塔 (ref09:
// an embankment with a road on top, river-front houses behind it).
//
//   build(engine, plan) → { group, quays: [{ id, pts }] }
//   QUAYS: { id, from, to, search: [dx, dz] (direction toward the water), top (walkway level m), rail, retain }
// The shoreline is found on the terrain (heightAt crossing 0) between `from` and `to`; the wall stands ~1.2 m into
// the water from it, so the lake / river water laps against stone, not against the terrain.
import * as THREE from 'three';
import { heightAt } from '../world/heightfield.js';
import { MeshBuilder } from '../yingzao/geom.js';
import { bakeAO } from '../yingzao/ao.js';
import { bridgeStoneMaterial, BK } from '../bridges/material.js';
import { viewDist } from './lod.js';

/** stone platforms in the water around halls the layout puts on piles (ref05: the 水榭 south of 小瀛洲 stands on a
 *  stone platform with a white 勾闌, docs/ART_BIBLE.md §8). margin = m beyond the hall's deck, top = m above water */
export const PLATFORMS = [
  // (the lake hall south of 小瀛洲 and its platform are gone from the world, ink05)
];

export const QUAYS = [
  // ref04: the shore below 雷峰塔院, 100-250 m from the camera (y 0.76-0.85 in the reference)
  { id: 'leifeng-quay', from: [372, 1288], to: [664, 1232], search: [0, -1], top: 1.5, rail: true, retain: 6.2, steps: [505, 560] },
  // ref09: the bank of the bay east of 六和塔 with the junks
  // ink09: from the foot of the 六和塔 slope, the harbour quay (HAMLETS liuhe-harbour) with landing steps
  { id: 'qiantang-quay', from: [-1640, 5090], to: [-900, 4660], search: [0.45, 1], top: 2.2, rail: false, retain: 0, steps: [-1500, -1420, -1200] },
];

function qw(B, a, b, c, d, want, pa, uv) {
  const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
  const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
  const P = typeof pa === 'function' ? [pa(a), pa(b), pa(c), pa(d)] : [pa, pa, pa, pa];
  if (nx * want[0] + ny * want[1] + nz * want[2] >= 0) B.quad(a, b, c, d, P[0], P[1], P[2], P[3], uv);
  else B.quad(a, d, c, b, P[0], P[3], P[2], P[1], uv ? [uv[0], uv[3], uv[2], uv[1]] : null);
}
function hexa(B, c, kind) {
  const ctr = c.reduce((a, v) => [a[0] + v[0] / 8, a[1] + v[1] / 8, a[2] + v[2] / 8], [0, 0, 0]);
  const f = (i, j, k, l) => {
    const a = c[i], b = c[j], cc = c[k], d = c[l];
    const lab = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]), lad = Math.hypot(d[0] - a[0], d[1] - a[1], d[2] - a[2]);
    qw(B, a, b, cc, d, [(a[0] + cc[0]) / 2 - ctr[0], (a[1] + cc[1]) / 2 - ctr[1], (a[2] + cc[2]) / 2 - ctr[2]], (v) => [kind, v[1], 0, 0], [[0, 0], [lab, 0], [lab, lad], [0, lad]]);
  };
  f(0, 1, 2, 3); f(4, 5, 6, 7); f(0, 1, 5, 4); f(1, 2, 6, 5); f(2, 3, 7, 6); f(3, 0, 4, 7);
}

/** the shoreline between from and to: for each sample, march along `search` to the first point below water */
export function shoreline(q, step = 3) {
  const [ax, az] = q.from, [bx, bz] = q.to;
  const len = Math.hypot(bx - ax, bz - az), n = Math.ceil(len / step);
  const sl = Math.hypot(q.search[0], q.search[1]), sx = q.search[0] / sl, sz = q.search[1] / sl;
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n, px = ax + (bx - ax) * t, pz = az + (bz - az) * t;
    // start on land (back off if needed), walk to the water
    let k = -60;
    while (k < 0 && heightAt(px + sx * k, pz + sz * k) < 0.2) k += 1;
    let found = null;
    for (let s = k; s < 160; s += 0.5) { if (heightAt(px + sx * s, pz + sz * s) < -0.1) { found = s; break; } }
    if (found === null) continue;
    pts.push([px + sx * found, pz + sz * found]);
  }
  // smooth twice
  for (let it = 0; it < 3; it++) for (let i = 1; i < pts.length - 1; i++) pts[i] = [(pts[i - 1][0] + 2 * pts[i][0] + pts[i + 1][0]) / 4, (pts[i - 1][1] + 2 * pts[i][1] + pts[i + 1][1]) / 4];
  return { pts, dir: [sx, sz] };
}

export async function build(engine) {
  const t0 = performance.now();
  const group = new THREE.Group(); group.name = 'city:shores';
  const quays = [];
  for (const q of QUAYS) {
    const { pts, dir } = shoreline(q);
    if (pts.length < 3) continue;
    const d = viewDist(pts[Math.floor(pts.length / 2)][0], pts[Math.floor(pts.length / 2)][1], 150);
    const lod = d < 400 ? 0 : 1;
    const B = new MeshBuilder();
    const out = 1.2, top = q.top, bot = -1.4, walk = 3.2;
    let acc = 0;
    const railPosts = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
      const len = Math.hypot(bx - ax, bz - az);
      // the face looks toward the water (dir)
      const tx = (bx - ax) / len, tz = (bz - az) / len;
      let nx = -tz, nz = tx;
      if (nx * dir[0] + nz * dir[1] < 0) { nx = -nx; nz = -nz; }
      const A = [ax + nx * out, az + nz * out], Bp = [bx + nx * out, bz + nz * out];
      const want = [nx, 0, nz];
      qw(B, [A[0], bot, A[1]], [Bp[0], bot, Bp[1]], [Bp[0], top - 0.25, Bp[1]], [A[0], top - 0.25, A[1]], want, (v) => [BK.WALL, v[1], 0, 0], [[acc, bot], [acc + len, bot], [acc + len, top - 0.25], [acc, top - 0.25]]);
      // coping, proud of the face
      const C0 = [A[0] + nx * 0.1, A[1] + nz * 0.1], C1 = [Bp[0] + nx * 0.1, Bp[1] + nz * 0.1];
      qw(B, [C0[0], top - 0.25, C0[1]], [C1[0], top - 0.25, C1[1]], [C1[0], top, C1[1]], [C0[0], top, C0[1]], want, (v) => [BK.COPING, v[1], 0, 0], [[acc, 0], [acc + len, 0], [acc + len, 0.25], [acc, 0.25]]);
      // the walkway, back to the terrain (and a retaining wall up to the higher ground where asked)
      const W0 = [A[0] - nx * walk, A[1] - nz * walk], W1 = [Bp[0] - nx * walk, Bp[1] - nz * walk];
      qw(B, [C0[0], top, C0[1]], [C1[0], top, C1[1]], [W1[0], top, W1[1]], [W0[0], top, W0[1]], [0, 1, 0], (v) => [BK.PAVE, v[1], 0, 0], [[0, acc], [0, acc + len], [walk, acc + len], [walk, acc]]);
      if (q.retain) {
        const h0 = Math.max(top + 0.2, Math.min(q.retain, heightAt(W0[0] - nx * 3, W0[1] - nz * 3) + 0.3)), h1 = Math.max(top + 0.2, Math.min(q.retain, heightAt(W1[0] - nx * 3, W1[1] - nz * 3) + 0.3));
        qw(B, [W0[0], top - 0.1, W0[1]], [W1[0], top - 0.1, W1[1]], [W1[0], h1, W1[1]], [W0[0], h0, W0[1]], want, (v) => [BK.WALL, v[1] + 2, 0, 0], [[acc, top], [acc + len, top], [acc + len, h1], [acc, h0]]);
        const R0 = [W0[0] - nx * 0.6, W0[1] - nz * 0.6], R1 = [W1[0] - nx * 0.6, W1[1] - nz * 0.6];
        qw(B, [W0[0], h0, W0[1]], [W1[0], h1, W1[1]], [R1[0], h1, R1[1]], [R0[0], h0, R0[1]], [0, 1, 0], (v) => [BK.COPING, v[1] + 2, 0, 0], null);
      } else {
        // the walkway slopes down into the ground behind it
        const G0 = [W0[0] - nx * 2, W0[1] - nz * 2], G1 = [W1[0] - nx * 2, W1[1] - nz * 2];
        qw(B, [W0[0], top, W0[1]], [W1[0], top, W1[1]], [G1[0], Math.min(top, heightAt(G1[0], G1[1])) - 0.3, G1[1]], [G0[0], Math.min(top, heightAt(G0[0], G0[1])) - 0.3, G0[1]], [0, 1, 0], (v) => [BK.PAVE, v[1], 0, 0], null);
      }
      // balustrade posts along the water edge
      if (q.rail) { const nP = Math.max(1, Math.round(len / 1.9)); for (let k = 0; k < nP; k++) railPosts.push({ p: [A[0] + (Bp[0] - A[0]) * (k / nP) - nx * 0.25, A[1] + (Bp[1] - A[1]) * (k / nP) - nz * 0.25], t: [tx, tz] }); }
      // landing steps down to the water
      for (const sx of q.steps || []) {
        const key = Math.abs(dir[0]) > Math.abs(dir[1]) ? az : ax;
        if (Math.abs(key - sx) < len / 2 + 0.01 && !(B._stepsAt || []).includes(sx)) {
          (B._stepsAt ||= []).push(sx);
          const n = Math.ceil(top / 0.17), run = 0.32, wS = 2.6;
          for (let k = 0; k < n; k++) {
            const y1 = top - k * (top / n);
            const P = (s, w, y) => [ax + nx * (out + s) + tx * w, y, az + nz * (out + s) + tz * w];
            hexa(B, [P(k * run, 0, -0.8), P((k + 1) * run, 0, -0.8), P((k + 1) * run, wS, -0.8), P(k * run, wS, -0.8), P(k * run, 0, y1), P((k + 1) * run, 0, y1), P((k + 1) * run, wS, y1), P(k * run, wS, y1)], k === 0 ? BK.COPING : BK.TREAD);
          }
        }
      }
      acc += len;
    }
    // 勾闌 balustrade: posts, a solid lower panel and a handrail between them
    for (let i = 0; i < railPosts.length; i++) {
      const { p, t } = railPosts[i];
      const ps = 0.22, h = 1.05;
      const nrm = [-t[1], t[0]];
      const C = (u, w, y) => [p[0] + t[0] * u + nrm[0] * w, y, p[1] + t[1] * u + nrm[1] * w];
      hexa(B, [C(-ps / 2, -ps / 2, top), C(ps / 2, -ps / 2, top), C(ps / 2, ps / 2, top), C(-ps / 2, ps / 2, top), C(-ps / 2, -ps / 2, top + h), C(ps / 2, -ps / 2, top + h), C(ps / 2, ps / 2, top + h), C(-ps / 2, ps / 2, top + h)], BK.RAIL);
      const nx2 = railPosts[i + 1];
      if (!nx2) break;
      const q2 = nx2.p, span = Math.hypot(q2[0] - p[0], q2[1] - p[1]);
      if (span > 3.2) continue;
      const D = (pt, w, y) => [pt[0] + nrm[0] * w, y, pt[1] + nrm[1] * w];
      const a = [p[0] + t[0] * ps / 2, p[1] + t[1] * ps / 2], b = [q2[0] - t[0] * ps / 2, q2[1] - t[1] * ps / 2];
      hexa(B, [D(a, -0.07, top), D(b, -0.07, top), D(b, 0.07, top), D(a, 0.07, top), D(a, -0.07, top + 0.48), D(b, -0.07, top + 0.48), D(b, 0.07, top + 0.48), D(a, 0.07, top + 0.48)], BK.PANEL);
      hexa(B, [D(a, -0.08, top + 0.74), D(b, -0.08, top + 0.74), D(b, 0.08, top + 0.74), D(a, 0.08, top + 0.74), D(a, -0.08, top + 0.86), D(b, -0.08, top + 0.86), D(b, 0.08, top + 0.86), D(a, 0.08, top + 0.86)], BK.RAIL);
      for (const f of [0.3, 0.7]) { const m = [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f]; hexa(B, [D([m[0] - t[0] * 0.06, m[1] - t[1] * 0.06], -0.05, top + 0.48), D([m[0] + t[0] * 0.06, m[1] + t[1] * 0.06], -0.05, top + 0.48), D([m[0] + t[0] * 0.06, m[1] + t[1] * 0.06], 0.05, top + 0.48), D([m[0] - t[0] * 0.06, m[1] - t[1] * 0.06], 0.05, top + 0.48), D([m[0] - t[0] * 0.06, m[1] - t[1] * 0.06], -0.05, top + 0.74), D([m[0] + t[0] * 0.06, m[1] + t[1] * 0.06], -0.05, top + 0.74), D([m[0] + t[0] * 0.06, m[1] + t[1] * 0.06], 0.05, top + 0.74), D([m[0] - t[0] * 0.06, m[1] - t[1] * 0.06], 0.05, top + 0.74)], BK.RAIL); }
    }
    if (lod === 0) bakeAO({ targets: [{ B }], occluders: [{ B }], cell: 0.1, coarse: 0.35, near: 0.7, far: 4, upFar: 8 });
    const mesh = new THREE.Mesh(B.toGeometry(), bridgeStoneMaterial());
    mesh.name = 'shore:' + q.id; mesh.castShadow = true; mesh.receiveShadow = true;
    group.add(mesh);
    quays.push({ id: q.id, pts, dir, top });
    for (const p of pts) engine.footprints?.addCircle?.(p[0] - dir[0] * 2, p[1] - dir[1] * 2, 2.5, 'quay');
    console.log(`[city] ${q.id}: ${pts.length} shore points, ${(B.count / 3 / 1e3).toFixed(1)}k tris, lod ${lod}`);
  }
  for (const pf of PLATFORMS) {
    try { const m = platform(engine, pf); if (m) group.add(m); } catch (e) { console.error('[city] platform ' + pf.id + ' failed:', e.stack || e); }
  }
  engine.add(group);
  console.log(`[city] shores in ${Math.round(performance.now() - t0)} ms`);
  return { group, quays };
}

/** the deck rectangle of a built hall (local frame: floor at y 0, front +Z), from its meshes near floor level */
function deckRect(group) {
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  const v = new THREE.Vector3();
  group.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(group.matrixWorld).invert();
  group.traverse((o) => {
    if (!o.isMesh || !o.geometry?.attributes?.position) return;
    const P = o.geometry.attributes.position, M = new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld);
    for (let i = 0; i < P.count; i++) {
      v.fromBufferAttribute(P, i).applyMatrix4(M);
      if (Math.abs(v.y) > 0.12) continue;
      x0 = Math.min(x0, v.x); x1 = Math.max(x1, v.x); z0 = Math.min(z0, v.z); z1 = Math.max(z1, v.z);
    }
  });
  return isFinite(x0) ? [x0, x1, z0, z1] : null;
}

function platform(engine, pf) {
  const b = (engine.registry.buildings || []).find((x) => x.id === pf.hall);
  if (!b) return null;
  const r = deckRect(b.group);
  if (!r) return null;
  const m = pf.margin, [x0, x1, z0, z1] = [r[0] - m, r[1] + m, r[2] - m, r[3] + m];
  const top = pf.top, bot = -1.6;
  const B = new MeshBuilder();
  const box = (a0, a1, b0, b1, y0, y1, kind) => hexa(B, [[a0, y0, b0], [a1, y0, b0], [a1, y0, b1], [a0, y0, b1], [a0, y1, b0], [a1, y1, b0], [a1, y1, b1], [a0, y1, b1]], kind);
  // the walls (faces outward), coping, paving over the piles up to the deck
  const sides = [[[x0, z1], [x1, z1], [0, 0, 1]], [[x1, z1], [x1, z0], [1, 0, 0]], [[x1, z0], [x0, z0], [0, 0, -1]], [[x0, z0], [x0, z1], [-1, 0, 0]]];
  for (const [a, c, n] of sides) {
    const len = Math.hypot(c[0] - a[0], c[1] - a[1]);
    qw(B, [a[0], bot, a[1]], [c[0], bot, c[1]], [c[0], top - 0.22, c[1]], [a[0], top - 0.22, a[1]], n, (v) => [BK.WALL, v[1], 0, 0], [[0, bot], [len, bot], [len, top - 0.22], [0, top - 0.22]]);
    const o = 0.08;
    const A2 = [a[0] + n[0] * o, a[1] + n[2] * o], C2 = [c[0] + n[0] * o, c[1] + n[2] * o];
    qw(B, [A2[0], top - 0.22, A2[1]], [C2[0], top - 0.22, C2[1]], [C2[0], top, C2[1]], [A2[0], top, A2[1]], n, (v) => [BK.COPING, v[1], 0, 0], [[0, 0], [len, 0], [len, 0.22], [0, 0.22]]);
  }
  for (const [a0, a1, b0, b1] of [[x0, x1, r[3], z1], [x0, x1, z0, r[2]], [x0, r[0], r[2], r[3]], [r[1], x1, r[2], r[3]]]) {
    qw(B, [a0, top, b0], [a1, top, b0], [a1, top, b1], [a0, top, b1], [0, 1, 0], (v) => [BK.PAVE, v[1], 0, 0], [[a0, b0], [a1, b0], [a1, b1], [a0, b1]]);
  }
  // 勾闌: posts, panels, handrail along the edge (open in the middle of the front)
  if (pf.rail) {
    const inset = 0.28, ps = 0.2, h = 1.0;
    const edges = [[[x0 + inset, z1 - inset], [x1 - inset, z1 - inset]], [[x1 - inset, z1 - inset], [x1 - inset, z0 + inset]], [[x1 - inset, z0 + inset], [x0 + inset, z0 + inset]], [[x0 + inset, z0 + inset], [x0 + inset, z1 - inset]]];
    edges.forEach(([a, c], ei) => {
      const len = Math.hypot(c[0] - a[0], c[1] - a[1]), tx = (c[0] - a[0]) / len, tz = (c[1] - a[1]) / len;
      const n = Math.max(2, Math.round(len / 1.9));
      for (let k = 0; k <= n; k++) {
        const s0 = (len * k) / n;
        if (pf.gap === 'front' && ei === 0 && Math.abs(s0 - len / 2) < 1.0) continue;
        const px = a[0] + tx * s0, pz = a[1] + tz * s0;
        box(px - ps / 2, px + ps / 2, pz - ps / 2, pz + ps / 2, top, top + h, BK.RAIL);
        box(px - ps * 0.32, px + ps * 0.32, pz - ps * 0.32, pz + ps * 0.32, top + h, top + h + 0.14, BK.RAIL);
        if (k === n) break;
        const s1 = (len * (k + 1)) / n;
        if (pf.gap === 'front' && ei === 0 && Math.abs((s0 + s1) / 2 - len / 2) < 1.3) continue;
        const ax = px + tx * ps / 2, az = pz + tz * ps / 2, bx = a[0] + tx * (s1 - ps / 2), bz = a[1] + tz * (s1 - ps / 2);
        const nx = -tz * 0.07, nz = tx * 0.07;
        hexa(B, [[ax - nx, top, az - nz], [bx - nx, top, bz - nz], [bx + nx, top, bz + nz], [ax + nx, top, az + nz], [ax - nx, top + 0.45, az - nz], [bx - nx, top + 0.45, bz - nz], [bx + nx, top + 0.45, bz + nz], [ax + nx, top + 0.45, az + nz]], BK.PANEL);
        const hx = -tz * 0.08, hz = tx * 0.08;
        hexa(B, [[ax - hx, top + 0.74, az - hz], [bx - hx, top + 0.74, bz - hz], [bx + hx, top + 0.74, bz + hz], [ax + hx, top + 0.74, az + hz], [ax - hx, top + 0.86, az - hz], [bx - hx, top + 0.86, bz - hz], [bx + hx, top + 0.86, bz + hz], [ax + hx, top + 0.86, az + hz]], BK.RAIL);
        for (const f of [0.3, 0.7]) { const mx = ax + (bx - ax) * f, mz = az + (bz - az) * f; box(mx - 0.05, mx + 0.05, mz - 0.05, mz + 0.05, top + 0.45, top + 0.74, BK.RAIL); }
      }
    });
  }
  bakeAO({ targets: [{ B }], occluders: [{ B }], cell: 0.08, coarse: 0.3, near: 0.6, far: 3, upFar: 6 });
  const mesh = new THREE.Mesh(B.toGeometry(), bridgeStoneMaterial());
  mesh.name = 'shore:' + pf.id; mesh.castShadow = true; mesh.receiveShadow = true;
  // in the hall's frame, on the water
  mesh.position.set(b.group.position.x, 0, b.group.position.z);
  mesh.rotation.y = b.group.rotation.y;
  console.log(`[city] ${pf.id}: platform ${(x1 - x0).toFixed(1)} x ${(z1 - z0).toFixed(1)} m round ${pf.hall}, ${(B.count / 3 / 1e3).toFixed(1)}k tris`);
  return mesh;
}
