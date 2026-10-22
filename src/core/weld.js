// Exact vertex welding (pure: no three.js, so the height workers can run it; src/explore/height-worker.js).
//
//   weld(n, [[Float32Array, itemSize], ...]) → { m, arrays: [Float32Array, ...], index: Uint16Array | Uint32Array }
//
// The builders emit triangle soup (every corner its own vertex). Vertices whose every attribute is bit-identical become
// one vertex shared through an index; the triangles keep their order and every corner keeps its values, so a welded
// mesh draws exactly what the soup drew (no vertex moves, no value is rounded). The first attribute must be the
// position (3 floats): it is hashed, and equal positions are told apart by comparing every attribute.
export function weld(n, attrs) {
  let cap = 16;
  while (cap < n * 1.6) cap <<= 1;
  const mask = cap - 1;
  const table = new Int32Array(cap).fill(-1);
  const P = new Uint32Array(attrs[0][0].buffer, attrs[0][0].byteOffset, n * 3);
  const rest = attrs.slice(1).map(([a, k]) => [new Uint32Array(a.buffer, a.byteOffset, n * k), k]);
  const first = new Uint32Array(n);
  const remap = new Uint32Array(n);
  let m = 0;
  for (let i = 0; i < n; i++) {
    const x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2];
    let h = Math.imul(x, 0x9e3779b1) ^ Math.imul(y ^ (y >>> 16), 0x85ebca6b) ^ Math.imul(z ^ (z >>> 13), 0xc2b2ae35);
    h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d); h ^= h >>> 12;
    let s = h & mask;
    for (;;) {
      const e = table[s];
      if (e < 0) { table[s] = m; first[m] = i; remap[i] = m++; break; }
      const c = first[e];
      if (P[c * 3] === x && P[c * 3 + 1] === y && P[c * 3 + 2] === z) {
        let same = true;
        for (let r = 0; r < rest.length && same; r++) {
          const w = rest[r][0], k = rest[r][1];
          for (let j = 0; j < k; j++) if (w[c * k + j] !== w[i * k + j]) { same = false; break; }
        }
        if (same) { remap[i] = e; break; }
      }
      s = (s + 1) & mask;
    }
  }
  const arrays = attrs.map(([a, k]) => {
    const out = new Float32Array(m * k);
    if (k === 3) for (let u = 0; u < m; u++) { const i = first[u] * 3, o = u * 3; out[o] = a[i]; out[o + 1] = a[i + 1]; out[o + 2] = a[i + 2]; }
    else if (k === 2) for (let u = 0; u < m; u++) { const i = first[u] * 2, o = u * 2; out[o] = a[i]; out[o + 1] = a[i + 1]; }
    else for (let u = 0; u < m; u++) { const i = first[u] * k; for (let j = 0; j < k; j++) out[u * k + j] = a[i + j]; }
    return out;
  });
  const index = m < 65536 ? Uint16Array.from(remap) : remap;
  return { m, arrays, index };
}
