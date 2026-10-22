// Variant library: builds the plant variants (geometry for up to 4 LODs each) and registers them with the
// VegSystem. Counts scale with engine.quality.detail. (Structure after Athenaion's src/vegetation/library.js.)
//   buildLibrary(sys, engine, species?) → { willow: [variant], peach, pineH (黄山松), pineM (马尾松), camphor,
//                                          broad, maple, ginkgo }
import { buildTree, buildPine } from './trees.js';
import { buildWillow } from './willow.js';
import { foliageAtlas, cellRect, cellOf, PATCH } from './atlas.js';
import { billboardQuad } from './util.js';
import { foliageMaterial, barkMaterial, blossomMaterial } from './materials.js';

// projected tree height (px, on a 928 px frame) above which LOD0 / LOD1 / LOD2 are used (below: billboard)
export const PX = {
  willow: [520, 90, 22],
  peach: [150, 55, 16],
  pineH: [420, 100, 20],
  pineM: [420, 100, 20],
  camphor: [170, 55, 16],
  broad: [140, 45, 15],
  maple: [130, 45, 15],
  ginkgo: [150, 55, 16],
};
const BB_PATCH = { willow: PATCH.willow, peach: PATCH.blossom, pineH: PATCH.pine, pineM: PATCH.pine, camphor: PATCH.camphor, broad: PATCH.camphor, maple: PATCH.maple, ginkgo: PATCH.ginkgo };
const MAT_SPECIES = { willow: 'willow', peach: 'peach', pineH: 'pine', pineM: 'pine', camphor: 'camphor', broad: 'broad', maple: 'maple', ginkgo: 'ginkgo' };

function materialsFor(kind, atlas) {
  const sp = MAT_SPECIES[kind];
  const m = {
    bark: barkMaterial(kind.startsWith('pine') ? 'pine' : sp),
    card: foliageMaterial(sp, 'card', atlas),
    inner: foliageMaterial(sp, 'inner', atlas),
    blob: foliageMaterial(sp, 'blob', atlas),
    bb: foliageMaterial(sp, 'bb', atlas),
  };
  if (kind === 'willow') m.ribbon = foliageMaterial('willow', 'ribbon', atlas);
  if (kind === 'peach') m.flower = blossomMaterial();
  return m;
}

export function buildLibrary(sys, engine, only = null) {
  const t0 = performance.now();
  const q = engine.quality;
  const atlas = foliageAtlas();
  const hi = q.detail >= 1;
  const counts = { willow: hi ? 5 : 3, peach: hi ? 4 : 3, pineH: hi ? 4 : 3, pineM: hi ? 4 : 3, camphor: hi ? 4 : 3, broad: hi ? 5 : 3, maple: hi ? 3 : 2, ginkgo: hi ? 3 : 2 };
  const lib = {};
  const info = [];
  for (const kind of Object.keys(counts)) {
    lib[kind] = [];
    if (only && !only.includes(kind)) continue;
    const mats = materialsFor(kind, atlas);
    let maxTris = 0;
    for (let i = 0; i < counts[kind]; i++) {
      const seed = 100 + i * 37;
      const t = kind === 'willow' ? buildWillow(seed) : kind === 'pineH' ? buildPine(seed, 'huangshan') : kind === 'pineM' ? buildPine(seed, 'masson') : buildTree(kind, seed);
      const bbR = t.R * (kind === 'willow' ? 1.0 : kind.startsWith('pine') ? 1.0 : 0.95);
      t.lods[3] = { bb: billboardQuad(t.H, bbR, cellRect(cellOf(...BB_PATCH[kind]), 0.1)), tris: 2 };
      maxTris = Math.max(maxTris, t.lods[0].tris);
      lib[kind].push(sys.addVariant({
        name: `${kind}-${i}`, kind, lods: t.lods, H: t.H, R: t.R, px: PX[kind], cullPx: 0.8, shadowLod: 2,
        materials: mats, ctrK: 0.5, radK: kind === 'willow' ? 0.75 : 0.6,
      }));
    }
    const l = lib[kind][0].lods;
    info.push(`${kind}×${counts[kind]} (${l.map((x) => x.tris < 2000 ? x.tris : (x.tris / 1000).toFixed(0) + 'k').join('/')})`);
  }
  console.log(`[vegetation] library ${info.join(' ')} in ${Math.round(performance.now() - t0)} ms`);
  return lib;
}
