// Fetch and decode a compact bake (src/core/bakefmt.js), in a height worker or on the main thread: gzipped files are
// un-gzipped with DecompressionStream (a server that already sent them decompressed is fine too).
import { decodeGeo } from './bakefmt.js';

export async function readBake(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`bake ${url}: ${res.status}`);
  let bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
    const ds = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
    bytes = new Uint8Array(await new Response(ds).arrayBuffer());
  }
  return decodeGeo(bytes);
}
