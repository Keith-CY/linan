// The compact bake format (generated/*.geo): what the explorable page downloads. Pure (no three.js): the bake tools
// encode in node, the height workers decode in the page (src/explore/heightpool.js bake()).
//
//   encodeGeo({ position, normal, extra: [{ name, array, itemSize, normalized }], index }) → Uint8Array (not yet gzipped)
//   decodeGeo(bytes) → { n, box, position: Float32Array, normal: Float32Array, extra: [...], index }
//
// Vertices are renumbered in the order the triangles first use them (the triangles keep their order and corners), so
//   positions   16 bits a component in the mesh's box (a step of box / 65535: 0.03–3.6 mm on the baked rocks, ~1 % of
//               their edges), stored as differences from the previous vertex
//   normals     octahedral, 16 bits a component, as differences
//   extra       8-bit attributes (aRock) exactly, as differences
//   indices     the distance below the next new vertex (0 = a new vertex), LEB128 varints
// and every 16-bit stream is split into a low-byte and a high-byte plane, which gzip packs 3–4× better than floats.
// The file is gzipped as a whole (tools/bake.mjs); a 4-byte magic 'GEO2' and a JSON header lead the payload.

const MAGIC = 0x47454f32;
const zig = (v) => ((v << 1) ^ (v >> 31)) >>> 0;      // int → uint (small magnitudes stay small)
const unzig = (u) => (u >>> 1) ^ -(u & 1);

function octEncode(x, y, z) {
  const l = Math.abs(x) + Math.abs(y) + Math.abs(z) || 1;
  let u = x / l, v = y / l;
  if (z < 0) { const ou = u; u = (1 - Math.abs(v)) * (ou >= 0 ? 1 : -1); v = (1 - Math.abs(ou)) * (v >= 0 ? 1 : -1); }
  return [Math.round(Math.max(-1, Math.min(1, u)) * 32767), Math.round(Math.max(-1, Math.min(1, v)) * 32767)];
}
function octDecode(qu, qv, out, o) {
  let u = qu / 32767, v = qv / 32767;
  const z = 1 - Math.abs(u) - Math.abs(v);
  if (z < 0) { const ou = u; u = (1 - Math.abs(v)) * (ou >= 0 ? 1 : -1); v = (1 - Math.abs(ou)) * (v >= 0 ? 1 : -1); }
  const l = Math.hypot(u, v, z) || 1;
  out[o] = u / l; out[o + 1] = v / l; out[o + 2] = z / l;
}

/** the vertices in the order of first use: order[newIndex] = oldIndex, and the index array renumbered */
function firstUse(n, index) {
  const map = new Int32Array(n).fill(-1), order = new Uint32Array(n);
  const idx = new Uint32Array(index.length);
  let m = 0;
  for (let k = 0; k < index.length; k++) {
    const v = index[k];
    if (map[v] < 0) { map[v] = m; order[m++] = v; }
    idx[k] = map[v];
  }
  // vertices no triangle uses go last (kept: the counts stay those of the source)
  for (let v = 0; v < n; v++) if (map[v] < 0) { map[v] = m; order[m++] = v; }
  return { order, idx };
}

class Writer {
  constructor(cap = 1 << 20) { this.buf = new Uint8Array(cap); this.n = 0; }
  need(k) { if (this.n + k > this.buf.length) { let c = this.buf.length * 2; while (c < this.n + k) c *= 2; const b = new Uint8Array(c); b.set(this.buf.subarray(0, this.n)); this.buf = b; } }
  bytes(a) { this.need(a.length); this.buf.set(a, this.n); this.n += a.length; }
  u32(v) { this.need(4); new DataView(this.buf.buffer).setUint32(this.n, v); this.n += 4; }
  varint(v) { this.need(5); while (v >= 0x80) { this.buf[this.n++] = (v & 0x7f) | 0x80; v >>>= 7; } this.buf[this.n++] = v; }
  /** 16-bit values as a low-byte plane and a high-byte plane */
  planes16(u) { const n = u.length; this.need(2 * n); const lo = this.buf.subarray(this.n, this.n + n), hi = this.buf.subarray(this.n + n, this.n + 2 * n); for (let i = 0; i < n; i++) { lo[i] = u[i] & 255; hi[i] = u[i] >>> 8; } this.n += 2 * n; }
  out() { return this.buf.slice(0, this.n); }
}

export function encodeGeo({ position, normal, extra = [], index }) {
  const n = position.length / 3;
  const { order, idx } = firstUse(n, index);
  const box = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
  for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) { const p = position[i * 3 + k]; if (p < box[k]) box[k] = p; if (p > box[k + 3]) box[k + 3] = p; }
  const ext = [0, 1, 2].map((k) => box[k + 3] - box[k] || 1);
  const header = { n, ni: index.length, box, normal: !!normal, extra: extra.map((e) => ({ name: e.name, itemSize: e.itemSize, normalized: !!e.normalized })) };
  const W = new Writer(n * 16 + index.length * 2 + 1024);
  const hj = new TextEncoder().encode(JSON.stringify(header));
  W.u32(MAGIC); W.u32(hj.length); W.bytes(hj);
  // positions: per component, the quantised value's difference from the previous vertex (mod 2^16), zig-zagged
  for (let k = 0; k < 3; k++) {
    const u = new Uint16Array(n);
    let prev = 0;
    for (let j = 0; j < n; j++) {
      const q = Math.round(((position[order[j] * 3 + k] - box[k]) / ext[k]) * 65535);
      let d = (q - prev) | 0; prev = q;
      if (d > 32767) d -= 65536; else if (d < -32768) d += 65536;
      u[j] = zig(d) & 0xffff;
    }
    W.planes16(u);
  }
  if (normal) {
    const qn = new Int16Array(n * 2);
    for (let j = 0; j < n; j++) { const o = order[j] * 3; const [a, b] = octEncode(normal[o], normal[o + 1], normal[o + 2]); qn[j * 2] = a; qn[j * 2 + 1] = b; }
    for (let k = 0; k < 2; k++) {
      const u = new Uint16Array(n);
      let prev = 0;
      for (let j = 0; j < n; j++) { const q = qn[j * 2 + k]; let d = q - prev; prev = q; if (d > 32767) d -= 65536; else if (d < -32768) d += 65536; u[j] = zig(d) & 0xffff; }
      W.planes16(u);
    }
  }
  for (const e of extra) {
    const s = e.itemSize, plane = new Uint8Array(n);
    for (let k = 0; k < s; k++) {
      let prev = 0;
      for (let j = 0; j < n; j++) { const v = e.array[order[j] * s + k]; plane[j] = (v - prev) & 255; prev = v; }
      W.bytes(plane);
    }
  }
  let hwm = 0;
  for (let k = 0; k < idx.length; k++) { const v = idx[k]; W.varint(hwm - v); if (v === hwm) hwm++; }
  return W.out();
}

export function decodeGeo(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (dv.getUint32(0) !== MAGIC) throw new Error('not a GEO2 bake');
  const hl = dv.getUint32(4);
  const H = JSON.parse(new TextDecoder().decode(bytes.subarray(8, 8 + hl)));
  let o = 8 + hl;
  const n = H.n, box = H.box;
  const position = new Float32Array(n * 3);
  for (let k = 0; k < 3; k++) {
    const lo = bytes.subarray(o, o + n), hi = bytes.subarray(o + n, o + 2 * n); o += 2 * n;
    const s = (box[k + 3] - box[k] || 1) / 65535;
    let q = 0;
    for (let j = 0; j < n; j++) { q = (q + unzig(lo[j] | (hi[j] << 8))) & 0xffff; position[j * 3 + k] = box[k] + q * s; }
  }
  let normal = null;
  if (H.normal) {
    const qn = new Int16Array(n * 2);
    for (let k = 0; k < 2; k++) {
      const lo = bytes.subarray(o, o + n), hi = bytes.subarray(o + n, o + 2 * n); o += 2 * n;
      let q = 0;
      for (let j = 0; j < n; j++) { q = (q + unzig(lo[j] | (hi[j] << 8))) << 16 >> 16; qn[j * 2 + k] = q; }
    }
    normal = new Float32Array(n * 3);
    for (let j = 0; j < n; j++) octDecode(qn[j * 2], qn[j * 2 + 1], normal, j * 3);
  }
  const extra = H.extra.map((e) => {
    const s = e.itemSize, arr = new Uint8Array(n * s);
    for (let k = 0; k < s; k++) {
      let v = 0;
      for (let j = 0; j < n; j++) { v = (v + bytes[o + j]) & 255; arr[j * s + k] = v; }
      o += n;
    }
    return { ...e, array: arr };
  });
  const index = n < 65536 ? new Uint16Array(H.ni) : new Uint32Array(H.ni);
  let hwm = 0;
  for (let k = 0; k < H.ni; k++) {
    let v = 0, shift = 0, b;
    do { b = bytes[o++]; v |= (b & 0x7f) << shift; shift += 7; } while (b & 0x80);
    const i = hwm - (v >>> 0);
    index[k] = i;
    if (i === hwm) hwm++;
  }
  return { n, box, position, normal, extra, index };
}
