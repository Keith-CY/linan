// Terrain meshing: a quadtree of square patches whose cell size follows the distance (and view cone)
// of the known cameras, so the whole 130 km world costs ~1-2 M vertices while the ground near every
// shot camera is metre-scale. Neighbouring patches of different size are stitched visually with skirts
// (a vertical curtain around every patch) — no cracks, no T-junction bookkeeping.
// Pure (no three.js): returns typed arrays; src/modules/terrain.js turns them into BufferGeometry.
import { heightAt } from '../world/heightfield.js';

/**
 * Plan the leaves.
 * @param {object[]} cams [{ pos:[x,y,z], target:[x,y,z], fov }]
 * @param {object} o
 * @param {number} o.theta   target angular cell size (rad) inside the view cones
 * @param {number} o.outside multiplier on theta outside every view cone
 * @param {number} o.minCell smallest cell (m)
 * @param {number} o.N       cells per patch side
 * @param {number} o.root    half extent of the world square (m)
 */
export function planLeaves(cams, { theta = 0.008, outside = 3, minCell = 1, N = 32, root = 65536 } = {}) {
  const C = cams.map((c) => {
    const dx = c.target[0] - c.pos[0], dz = c.target[2] - c.pos[2], l = Math.hypot(dx, dz) || 1;
    // horizontal half-angle of the view (16:9 frame) plus a margin
    const hf = Math.atan(Math.tan(((c.fov || 40) * Math.PI) / 360) * 1.8) + 0.25;
    return { x: c.pos[0], y: c.pos[1], z: c.pos[2], fx: dx / l, fz: dz / l, cosH: Math.cos(Math.min(Math.PI, hf)) };
  });
  const leaves = [];
  const want = (x0, z0, size) => {
    // smallest acceptable cell for this node over all cameras
    let best = Infinity;
    const cx = x0 + size / 2, cz = z0 + size / 2;
    for (const c of C) {
      const qx = Math.max(x0 - c.x, 0, c.x - (x0 + size)), qz = Math.max(z0 - c.z, 0, c.z - (z0 + size));
      const dh = Math.hypot(qx, qz);
      const d = Math.hypot(dh, Math.max(0, c.y - 30) * 0.5);
      // inside the view cone? (test the node centre direction, generous for nodes the camera is near/inside)
      const vx = cx - c.x, vz = cz - c.z, vl = Math.hypot(vx, vz) || 1;
      const inCone = dh < size * 0.75 || (vx * c.fx + vz * c.fz) / vl > c.cosH;
      const cell = Math.max(minCell, theta * (inCone ? 1 : outside) * d);
      best = Math.min(best, cell);
    }
    return best;
  };
  const rec = (x0, z0, size) => {
    const cell = size / N;
    if (cell <= minCell * 1.0001 || cell <= want(x0, z0, size)) { leaves.push({ x0, z0, size }); return; }
    const h = size / 2;
    rec(x0, z0, h); rec(x0 + h, z0, h); rec(x0, z0 + h, h); rec(x0 + h, z0 + h, h);
  };
  rec(-root, -root, root * 2);
  return leaves;
}

/**
 * Mesh one leaf: (N+1)² surface vertices + a skirt ring. Normals from central differences of the
 * height grid (one extra ring of samples), so lighting is smooth across patches of the same size.
 * @returns {{ position: Float32Array, normal: Float32Array, index: Uint32Array }}
 */
export function meshLeaf(leaf, N = 32, hAt = heightAt) {
  const { x0, z0, size } = leaf;
  const c = size / N, M = N + 3; // sample grid with a border ring
  const hs = new Float32Array(M * M);
  for (let j = 0; j < M; j++) for (let i = 0; i < M; i++) hs[j * M + i] = hAt(x0 + (i - 1) * c, z0 + (j - 1) * c);
  const nv = (N + 1) * (N + 1), ns = 4 * N;
  const pos = new Float32Array((nv + ns) * 3), nor = new Float32Array((nv + ns) * 3);
  for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) {
    const k = j * (N + 1) + i, g = (j + 1) * M + (i + 1);
    pos[k * 3] = x0 + i * c; pos[k * 3 + 1] = hs[g]; pos[k * 3 + 2] = z0 + j * c;
    const nx = hs[g - 1] - hs[g + 1], nz = hs[g - M] - hs[g + M], ny = 2 * c;
    const l = Math.hypot(nx, ny, nz);
    nor[k * 3] = nx / l; nor[k * 3 + 1] = ny / l; nor[k * 3 + 2] = nz / l;
  }
  // border loop (counter-clockwise): bottom row, right column, top row, left column
  const loop = [];
  for (let i = 0; i < N; i++) loop.push(i);
  for (let j = 0; j < N; j++) loop.push(j * (N + 1) + N);
  for (let i = N; i > 0; i--) loop.push(N * (N + 1) + i);
  for (let j = N; j > 0; j--) loop.push(j * (N + 1));
  const drop = c * 1.5 + 0.5;
  for (let s = 0; s < ns; s++) {
    const k = loop[s], d = nv + s;
    pos[d * 3] = pos[k * 3]; pos[d * 3 + 1] = pos[k * 3 + 1] - drop; pos[d * 3 + 2] = pos[k * 3 + 2];
    nor[d * 3] = nor[k * 3]; nor[d * 3 + 1] = nor[k * 3 + 1]; nor[d * 3 + 2] = nor[k * 3 + 2];
  }
  const idx = new Uint32Array(N * N * 6 + ns * 6);
  let o = 0;
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const a = j * (N + 1) + i, b = a + 1, cc = a + N + 1, d = cc + 1;
    // alternate the diagonal for a less directional look
    if ((i + j) & 1) { idx[o++] = a; idx[o++] = cc; idx[o++] = b; idx[o++] = b; idx[o++] = cc; idx[o++] = d; }
    else { idx[o++] = a; idx[o++] = cc; idx[o++] = d; idx[o++] = a; idx[o++] = d; idx[o++] = b; }
  }
  for (let s = 0; s < ns; s++) {
    const a = loop[s], b = loop[(s + 1) % ns], as = nv + s, bs = nv + ((s + 1) % ns);
    // single-sided curtain facing OUT of the patch: every crack has the outward skirt of one neighbour facing any
    // viewer above it, and nothing faces up or in (a double-sided skirt showed through the planar water reflection)
    idx[o++] = a; idx[o++] = b; idx[o++] = as; idx[o++] = b; idx[o++] = bs; idx[o++] = as;
  }
  return { position: pos, normal: nor, index: idx };
}
