// Meshing of SDF rock in nested resolution regions (each finer box inside its parent), shared by the 飞来峰 cliff and
// the hero rocks. Seams: a child mesh extends 2 parent cells past its box on the exact surface (overlapping the
// parent there); the parent sinks just under the child inside the child box and drops its faces more than one cell
// deep in it, so the two always overlap and never crack. Both use the true field for normals, AO and masks, so the
// shading is continuous across the seam.
//
//   const parts = meshRegions(sdf, regions, { carved, origin, ao })   // [{ name, m }] (m: mesher result + rock attrs)
//   const geo = toGeometry(parts[i].m)                                  // positions relative to origin
import { meshSDF, bakeRock } from '../sculpt/mesher.js';
import { sstep } from '../sculpt/sdf.js';

/** signed distance to an axis-aligned box {min, max} (+ outside) */
export function boxDist(x, y, z, b) {
  const qx = Math.max(b.min[0] - x, x - b.max[0]), qy = Math.max(b.min[1] - y, y - b.max[1]), qz = Math.max(b.min[2] - z, z - b.max[2]);
  const ox = Math.max(qx, 0), oy = Math.max(qy, 0), oz = Math.max(qz, 0);
  return Math.sqrt(ox * ox + oy * oy + oz * oz) + Math.min(Math.max(qx, qy, qz), 0);
}

/**
 * Mesh one region of a nested set.
 * @param {(x,y,z)=>number} sdf  full field (world metres)
 * @param {object[]} regions [{ name, min, max, cell, parent?, ao? }]
 * @param {string} name      region to mesh
 * @param {object} o         { origin, carved(x,y,z), aoDist, cavDist }
 */
export function meshRegion(sdf, regions, name, o = {}) {
  const R = regions.find((r) => r.name === name);
  const P = R.parent ? regions.find((r) => r.name === R.parent) : null;
  const kids = regions.filter((r) => r.parent === name);
  const ext = P ? 2 * P.cell : 2 * R.cell;
  const sinkKid = 0.5 * R.cell;
  const cut = R.cut;
  const field = (x, y, z) => {
    let d = sdf(x, y, z);
    if (cut) d = Math.max(d, cut(x, y, z));
    for (let i = 0; i < kids.length; i++) { const dk = boxDist(x, y, z, kids[i]); if (dk < 0) d += sinkKid * sstep(0, -R.cell, dk); }
    return d;
  };
  const keep = (x, y, z) => {
    if (boxDist(x, y, z, R) > ext) return false;
    for (let i = 0; i < kids.length; i++) if (boxDist(x, y, z, kids[i]) < -R.cell) return false;
    return true;
  };
  const m = meshSDF(field, {
    min: R.min.map((v) => v - ext - R.cell), max: R.max.map((v) => v + ext + R.cell), cell: R.cell,
    origin: o.origin, keep, bandScale: o.bandScale ?? 2.2, smooth: R.smooth ?? 1, smoothFactor: 0.45, project: R.project ?? 1, normalSdf: sdf,
  });
  bakeRock(m, sdf, { aoSteps: o.aoSteps, cavDist: o.cavDist ?? 0.04, upDist: o.upDist ?? 6, carved: o.carved });
  return m;
}

/** compact transferable form of a mesh result (for workers / caching) */
export function packMesh(m) { return { world: m.world, normals: m.normals, index: m.index, rock: m.rock, origin: m.origin, cell: m.cell }; }
