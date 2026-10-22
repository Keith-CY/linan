// Courtyard walls of Lin'an (after ink07: white walls among the roofs): the walled plots on the lanes
// (src/city/plan.js rowAcross) — a lime-washed wall with a small tiled coping along the lane, back along the plot sides
// to the house set behind its yard, and a gate with a little roof in the lane wall.
//
//   build(engine, plan) → { group, walls, gates }
// One merged mesh per material family for the whole city (~4k segments, ~60k triangles); footprints: the walls block
// the walker ('wall'), the gates stay open.
import * as THREE from 'three';
import { MeshBuilder, PAINT } from '../yingzao/geom.js';
import { hallMaterials } from '../yingzao/materials.js';

const H = 2.7, T = 0.34;                 // wall height above its foot, thickness
const CO = 0.32, CR = 0.3;               // coping overhang each side, coping ridge rise

function quad(B, a, b, c, d, kind, v0 = 0, h = 1) { B.quad(a, b, c, d, [kind, v0, h, 0], [kind, v0, h, 0], [kind, v0 + h, h, 0], [kind, v0 + h, h, 0]); }

function wall(Pl, Tl, a, b, y) {
  const dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz);
  if (L < 0.5) return 0;
  const ux = dx / L, uz = dz / L, nx = -uz, nz = ux;
  const y0 = y - 0.4, y1 = y + H;
  const P = (s, o, yy) => [a[0] + ux * s + nx * o, yy, a[1] + uz * s + nz * o];
  const t = T / 2;
  // two faces, two ends (the faces toward +n and −n)
  quad(Pl, P(0, t, y0), P(L, t, y0), P(L, t, y1), P(0, t, y1), PAINT.WHITEWASH, 0, H);
  quad(Pl, P(L, -t, y0), P(0, -t, y0), P(0, -t, y1), P(L, -t, y1), PAINT.WHITEWASH, 0, H);
  quad(Pl, P(0, -t, y0), P(0, t, y0), P(0, t, y1), P(0, -t, y1), PAINT.WHITEWASH, 0, H);
  quad(Pl, P(L, t, y0), P(L, -t, y0), P(L, -t, y1), P(L, t, y1), PAINT.WHITEWASH, 0, H);
  // the coping: two tiled slopes and their gable ends
  const e = t + CO, yr = y1 + CR, yE = y1 - 0.06;
  quad(Tl, P(-0.1, e, yE), P(L + 0.1, e, yE), P(L + 0.1, 0, yr), P(-0.1, 0, yr), PAINT.TILE, 0, 1);
  quad(Tl, P(L + 0.1, -e, yE), P(-0.1, -e, yE), P(-0.1, 0, yr), P(L + 0.1, 0, yr), PAINT.TILE, 0, 1);
  Tl.tri(P(-0.1, -e, yE), P(-0.1, e, yE), P(-0.1, 0, yr), [PAINT.TILE, 0, 1, 0]);
  Tl.tri(P(L + 0.1, e, yE), P(L + 0.1, -e, yE), P(L + 0.1, 0, yr), [PAINT.TILE, 0, 1, 0]);
  return 14;
}

function gate(Wd, Tl, G) {
  // two posts and a lintel in the gap, a little two-slope roof over them (a 門頭)
  const c = Math.cos(G.rot), s = Math.sin(G.rot);            // local x along the wall, local z = out of the yard
  const P = (x, yy, z) => [G.at[0] + x * c + z * s, yy, G.at[1] - x * s + z * c];
  const hw = G.w / 2, y = G.y, h = H + 0.5;
  for (const sx of [-1, 1]) {
    const x0 = sx * hw - 0.13, x1 = sx * hw + 0.13;
    quad(Wd, P(x0, y, 0.13), P(x1, y, 0.13), P(x1, y + h, 0.13), P(x0, y + h, 0.13), PAINT.WOOD, 0, h);
    quad(Wd, P(x1, y, -0.13), P(x0, y, -0.13), P(x0, y + h, -0.13), P(x1, y + h, -0.13), PAINT.WOOD, 0, h);
  }
  quad(Wd, P(-hw - 0.15, y + h - 0.3, 0.15), P(hw + 0.15, y + h - 0.3, 0.15), P(hw + 0.15, y + h, 0.15), P(-hw - 0.15, y + h, 0.15), PAINT.WOOD, 0, 0.3);
  const X = hw + 0.7, yE = y + h - 0.05, yr = y + h + 0.75, Z = 1.1;
  quad(Tl, P(-X, yE, Z), P(X, yE, Z), P(X, yr, 0), P(-X, yr, 0), PAINT.TILE, 0, 1);
  quad(Tl, P(X, yE, -Z), P(-X, yE, -Z), P(-X, yr, 0), P(X, yr, 0), PAINT.TILE, 0, 1);
}

export async function build(engine, plan) {
  const t0 = performance.now();
  const walls = plan.yardWalls || [], gates = plan.yardGates || [];
  if (!walls.length) return null;
  const Pl = new MeshBuilder(), Tl = new MeshBuilder(), Wd = new MeshBuilder();
  for (const w of walls) wall(Pl, Tl, w.a, w.b, w.y);
  for (const g of gates) gate(Wd, Tl, g);
  const mats = hallMaterials();
  const group = new THREE.Group(); group.name = 'city:yards';
  for (const [B, k] of [[Pl, 'plaster'], [Tl, 'tile'], [Wd, 'wood']]) {
    if (!B.count) continue;
    const m = new THREE.Mesh(B.toGeometry(), mats[k]);
    m.name = 'city:yards:' + k; m.castShadow = true; m.receiveShadow = true;
    group.add(m);
  }
  engine.add(group);
  const fp = engine.footprints;
  if (fp) for (const w of walls) fp.addPath([w.a, w.b], T / 2 + 0.15, 'wall');
  const tris = (Pl.count + Tl.count + Wd.count) / 3;
  console.log(`[city] yards: ${walls.length} wall runs, ${gates.length} gates, ${(tris / 1e3).toFixed(0)}k tris, ${Math.round(performance.now() - t0)} ms`);
  return { group, walls: walls.length, gates: gates.length };
}
