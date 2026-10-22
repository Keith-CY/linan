// Rock outcrop sites (data for src/karst/outcrop.js), derived from src/world/layout.js. Shared by the rocks module and
// the bake (node). Each: { name, shot, material: 'tuff' | 'limestone' | 'pale', spec for makeOutcrop }.
import * as L from '../world/layout.js';

const T = (id) => L.TERRACES.find((t) => t.id === id) || (L.CHENGTAI || []).find((t) => t.id === id);

export function outcropSites() {
  const out = [];
  // shot 1 (ink01): the tuff cliff the 宝石山 樓閣 stands on (宝石流霞): buttresses along the south-west wall of the
  // ravine (layout CLEFTS baoshi-cleft) from its floor up to the crest, the ones under the terrace up to its level
  {
    const C = L.CLEFTS.find((c) => c.id === 'baoshi-cleft');
    const t = T('baoshi-spur');
    const P = C.points, lobes = [];
    let k = 0;
    const tot = P.slice(1).reduce((s, p, i) => s + Math.hypot(p[0] - P[i][0], p[1] - P[i][1]), 0);
    let acc = 0;
    for (let i = 0; i < P.length - 1; i++) {
      const [x0, z0] = P[i], [x1, z1] = P[i + 1], len = Math.hypot(x1 - x0, z1 - z0);
      const ux = (x1 - x0) / len, uz = (z1 - z0) / len, rx = -uz, rz = ux;   // right of the way down = the cliff side (south-west)
      const n = Math.max(1, Math.round(len / 7));
      for (let j = 0; j < n; j++, k++) {
        const h = (q) => { const x = Math.sin((k + 1) * 12.9898 + q * 78.233) * 43758.5453; return x - Math.floor(x); };
        const f = (j + 0.5) / n, s = acc + f * len, tt = s / tot;
        if (tt > 0.6) continue;                                                // the lower ravine opens out: no cliff
        const floor = C.floor[0] + (C.floor[1] - C.floor[0]) * tt;
        const off = C.width / 2 + 2.5 + 3 * h(1);
        const cx = x0 + ux * f * len + rx * off, cz = z0 + uz * f * len + rz * off;
        // under the terrace the cliff rises to its level, elsewhere to the crest beside it
        const dT = Math.hypot(cx - t.center[0], cz - t.center[1]);
        const crest = dT < 34 ? t.level - 0.3 - 1.2 * h(2) : Math.min(78, floor + 26) - 2 * h(2);
        lobes.push({ c: [cx, cz], r: [5 + 3 * h(3), 3.2 + 1.6 * h(4)], rot: (Math.atan2(uz, ux) * 180) / Math.PI + (h(5) - 0.5) * 30, base: floor - 3, crest });
      }
      acc += len;
    }
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    for (const l of lobes) { x0 = Math.min(x0, l.c[0] - 12); z0 = Math.min(z0, l.c[1] - 12); x1 = Math.max(x1, l.c[0] + 12); z1 = Math.max(z1, l.c[1] + 12); }
    out.push({ name: 'baoshi2', shot: 1, material: 'tuff', spec: { name: 'baoshi2', seed: 3, block: 3.0, recess: 0.22, tilt: 0.32, joint: 0.14, cell: 0.24, rect: [x0, z0, x1, z1], lobes } });
  }
  // shot 9: the rocky bank where the 六和塔 platform drops away to the east and south, toward the river
  {
    const t = T('liuhe-base');
    const [cx, cz] = t.center, hw = t.size[0] / 2, hd = t.size[1] / 2;
    out.push({ name: 'liuhe2', shot: 9, material: 'limestone', spec: { name: 'liuhe2', seed: 5, block: 1.5, cell: 0.2, rect: [cx - hw - 6, cz - hd - 6, cx + hw + 22, cz + hd + 18], lobes: [
      { c: [cx + hw + 13, cz - 8], r: [5, 10], rot: 0, crest: 27.5 }, { c: [cx + hw + 11, cz + 12], r: [5, 8], rot: 10, crest: 27.0 }, // (the terrace's half sizes)
      { c: [cx - 4, cz + hd + 9], r: [11, 5], rot: 0, crest: 27.5 }, { c: [cx - 12, cz + hd + 8], r: [8, 4.5], rot: -10, crest: 26.5 }, // clear of the flight down (STAIRS liuhe-s1)
    ] } });
  }
  // shot 6 (ink06): limestone buttresses on the cliffs of the palace mesa (layout PALACE.mound), under the walled
  // terraces: lobes a few metres out on the face along each cliff edge, crests a metre under the plateau edge
  {
    const M = L.PALACE.mound, O = M.outline;
    const G = (a, b) => M.top + M.ka * a + M.kb * b;
    const edges = (from, to) => O.slice(from, to + 1);
    const site = (name, seed, pts) => {
      const lobes = [];
      let k = 0;
      for (let i = 0; i < pts.length - 1; i++) {
        const [a0, b0] = pts[i], [a1, b1] = pts[i + 1], len = Math.hypot(a1 - a0, b1 - b0);
        const ta = (a1 - a0) / len, tb = (b1 - b0) / len, na = tb, nb = -ta;   // outward (the outline runs counter-clockwise in a, b)
        const e0 = L.palaceAt(a0, b0), e1 = L.palaceAt(a1, b1), rot = (Math.atan2(e1[1] - e0[1], e1[0] - e0[0]) * 180) / Math.PI;
        // two rows: big buttresses from the foot to the cliff top, lower spurs standing out in front of them
        for (const row of [0, 1]) {
          const n = Math.max(1, Math.round(len / (row ? 15 : 9)));
          for (let j = 0; j < n; j++, k++) {
            const h = (q) => { const x = Math.sin((k + 1) * 12.9898 + q * 78.233 + row * 7.1) * 43758.5453; return x - Math.floor(x); };
            const t = (j + 0.5) / n + (h(1) - 0.5) * 0.4 / n;
            const a = a0 + (a1 - a0) * t, b = b0 + (b1 - b0) * t;
            const out = row ? 9 + 4 * h(2) : 2.5 + 2.5 * h(2);
            const c = L.palaceAt(a + na * out, b + nb * out);
            const top = G(a, b);
            lobes.push({ c, r: row ? [5 + 3 * h(3), 4 + 1.5 * h(4)] : [7 + 4 * h(3), 4.5 + 2 * h(4)], rot: rot + (h(6) - 0.5) * 20,
              base: M.foot - 3, crest: row ? M.foot + (top - M.foot) * (0.45 + 0.25 * h(5)) : top - 0.4 - 1.6 * h(5) });
          }
        }
      }
      let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
      for (const l of lobes) { x0 = Math.min(x0, l.c[0] - 14); z0 = Math.min(z0, l.c[1] - 14); x1 = Math.max(x1, l.c[0] + 14); z1 = Math.max(z1, l.c[1] + 14); }
      out.push({ name, shot: 6, material: 'limestone', spec: { name, seed, block: 2.8, recess: 0.55, tilt: 0.5, cell: 0.3, rect: [x0, z0, x1, z1], lobes } });
    };
    site('palace3l', 7, edges(1, 4));     // the cliff toward the river (east)
    site('palace3f', 8, edges(4, 7));     // the front cliff under the courts (north)
  }
  return out;
}

/** 太湖石 garden rocks: two in the 灵隐 court beside the path to the 天王殿 (shot 8), one on the palace terrace (shot 6) */
export const TAIHU = [
  { at: [-3893, 421], h: 2.6, seed: 5, facing: 170 },
  { at: [-3874, 419], h: 2.2, seed: 2, facing: 190 },
  { at: L.palaceAt(-36, 27), h: 2.8, seed: 6, facing: 20 },
];
