// Master plan of Southern-Song Lin'an (临安) and West Lake (西湖). Every module reads positions from here.
// Pure data + tiny helpers: importable in the browser, in workers and in node (no three.js import).
// Other modules READ this file; positions change here, never inside a module.
//
// Units: metres. Axes: +X east, -Z north (compass bearing 0 = -Z, 90 = +X), +Y up.
// Datum: y = 0 is the West Lake surface (the lake is ~7 m above sea level). The Qiantang and the city canals use the
// same datum (a simplification: no shot sees two water bodies at different levels at once).
// Origin: ORIGIN (lat, lon), roughly the middle of the lake. geo(lat, lon) converts WGS-84 degrees to [x, z].
//
// Geography: real landmarks (modern map positions; the Song shoreline and landmarks differ in detail) converted with
// geo(). Where a reference image needs something the real place cannot give, the change is marked "ART:" with the
// reason (docs/COMPOSITION.md has the camera-by-camera story).
//
// What lives where (summary, details at each export):
//   LAKE, SU_CAUSEWAY, BAI_CAUSEWAY, GUSHAN, XIAOYINGZHOU, HUXINTING, THREE_POOLS    the lake and its islands
//   HILLS, RANGES, QIANTANG, VALLEYS                                                    terrain inputs (heightfield.js)
//   CITY (walls, gates, 御街, canals, blocks, landmarks), PALACE (凤凰山)              Lin'an
//   LINGYIN (temple, 冷泉 stream, 飞来峰 cliff placeholder), LIUHE (六和塔 and the bank)
//   HALLS          every timber building (殿 / 廳堂 / 樓閣 / 亭 / 榭 / 廊 / 門 / 闕), built by src/modules/yingzao.js
//   PAGODAS        every pagoda (雷峰, 六和, 保俶, 三潭 stone lanterns, city and hill pagodas), src/modules/pagodas.js
//   BRIDGES        arch / flat / zigzag bridges (causeways, 断桥, city canals, 灵隐)      src/modules/bridges.js
//   BOATS          moored boats per shot                                                  src/modules/boats.js
//   PLANTS         plant zones (lotus, maple, ginkgo, pine, camphor, willow / peach rows) src/modules/vegetation.js
//   HERO_TREES     single framing trees placed for one camera                            src/modules/vegetation.js
//   TERRACES       flat platforms at fixed levels (palace terraces, temple courts)        heightfield.js

export const WATER_LEVEL = 0;
export const SEA_LEVEL = WATER_LEVEL; // alias used by the forked water code

// ------------------------------------------------------------------ coordinates
export const ORIGIN = { lat: 30.244, lon: 120.1452 };
const KX = 96170, KZ = 110860; // metres per degree of longitude / latitude at 30.24° N
/** WGS-84 degrees → world [x, z] (metres, rounded) */
export function geo(lat, lon) { return [Math.round((lon - ORIGIN.lon) * KX), Math.round(-(lat - ORIGIN.lat) * KZ)]; }
/** world [x, z] → [lat, lon] (for notes / checks) */
export function toGeo(x, z) { return [+(ORIGIN.lat - z / KZ).toFixed(5), +(ORIGIN.lon + x / KX).toFixed(5)]; }

/** point on a polyline at arc parameter t ∈ [0,1] → { x, z, tx, tz } (unit tangent) */
export function polyPoint(pts, t) {
  const lens = []; let total = 0;
  for (let i = 0; i < pts.length - 1; i++) { const l = Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]); lens.push(l); total += l; }
  let s = Math.min(1, Math.max(0, t)) * total;
  for (let i = 0; i < lens.length; i++) {
    if (s <= lens[i] || i === lens.length - 1) {
      const u = lens[i] > 0 ? Math.min(1, s / lens[i]) : 0;
      const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
      return { x: ax + (bx - ax) * u, z: az + (bz - az) * u, tx: (bx - ax) / lens[i], tz: (bz - az) / lens[i] };
    }
    s -= lens[i];
  }
  const p = pts[pts.length - 1];
  return { x: p[0], z: p[1], tx: 0, tz: 1 };
}
/** length of a polyline (m) */
export function polyLength(pts) { let l = 0; for (let i = 0; i < pts.length - 1; i++) l += Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]); return l; }
/** compass bearing (deg) of a direction (dx, dz) */
export function bearingOf(dx, dz) { return ((Math.atan2(dx, -dz) * 180) / Math.PI + 360) % 360; }

// ------------------------------------------------------------------ the lake
/** West Lake outline (x, z), clockwise from 断桥 (north-east). Shore = this polygon; 孤山, 白堤, 苏堤, 小瀛洲 and 湖心亭
 *  are added inside it by heightfield.js. Points from the modern shore (湖滨 / 南山路 / 杨公堤 / 北山路). */
export const LAKE = {
  outline: [
    geo(30.2592, 120.1522), geo(30.2586, 120.1546), geo(30.2573, 120.1580), geo(30.2546, 120.1598), geo(30.2510, 120.1608),
    geo(30.2468, 120.1618), geo(30.2430, 120.1620), geo(30.2395, 120.1612), geo(30.2370, 120.1598), geo(30.2348, 120.1575),
    geo(30.2336, 120.1545), [600, 1255], [430, 1275], [300, 1290], geo(30.2322, 120.1458), // ART: shore north of 夕照山 ~50 m further south (shot 4 needs ~130 m of water to the 雷峰 shore)
    geo(30.2316, 120.1440),
    geo(30.2309, 120.1424), geo(30.2316, 120.1396), geo(30.2337, 120.1360), geo(30.2370, 120.1330), geo(30.2410, 120.1306),
    geo(30.2460, 120.1298), geo(30.2500, 120.1313), geo(30.2526, 120.1334), geo(30.2546, 120.1352), geo(30.2561, 120.1367),
    geo(30.2573, 120.1382), geo(30.2583, 120.1402), geo(30.2589, 120.1430), geo(30.2593, 120.1460), geo(30.2596, 120.1490),
    geo(30.2595, 120.1510),
  ],
  depth: 2.4,          // typical depth (m): West Lake averages 2.3 m
  shoreWidth: 60,      // distance over which the bed shelves from the shore to full depth
};

/** 苏堤 Su causeway (built 1090 by 苏轼): north end at 跨虹桥 near 岳湖, south end at 映波桥 near 花港. */
export const SU_CAUSEWAY = {
  points: [geo(30.2566, 120.1369), geo(30.2520, 120.1381), geo(30.2470, 120.1394), geo(30.2420, 120.1407), geo(30.2370, 120.1420), geo(30.2314, 120.1434)],
  width: 30, top: 1.4,
  // six bridges, arc parameter from the NORTH end: 跨虹, 东浦, 压堤, 望山, 锁澜, 映波
  bridges: [0.04, 0.22, 0.4, 0.58, 0.76, 0.95],
  bridgeNames: ['跨虹桥', '东浦桥', '压堤桥', '望山桥', '锁澜桥', '映波桥'],
  gap: 16,             // water gap (m) cut through the embankment at each bridge (the arch spans it)
  // ART (ink02): 望山桥 (index 3) stands ACROSS the causeway as a tall round 月洞 arch; the slab path runs
  // straight through it on dry ground (no water gap there); its ramps fall to the causeway's two shores
  dryBridges: [3],
};

/** 白堤 Bai causeway: 断桥 (east) to 孤山 (平湖秋月). 断桥 is a single-arch bridge at the east end, 锦带桥 mid-way. */
export const BAI_CAUSEWAY = {
  // ART: the east end bends so 断桥 runs NNE-SSW onto the 北山 shore (ref10 sees it from the lake at ~35° to its face)
  // the first leg turned 5° (bearing 202 at 断桥, the ink10 still's axis)
  points: [[657, -1700], [636, -1648], [602, -1598], [540, -1568], geo(30.2571, 120.1480), geo(30.2561, 120.1460), geo(30.2551, 120.1443)],
  width: 24, top: 1.3,
  bridges: [0.035, 0.58],
  bridgeNames: ['断桥', '锦带桥'],
  gap: 14,
};

/** 孤山 Solitary Hill: a long island (summit 38 m) north of the main lake; 西泠桥 ties its west end to the north shore. */
export const GUSHAN = { center: geo(30.2563, 120.1418), radii: [420, 140], top: 38, rot: -14, summit: geo(30.2562, 120.1425) };

/** 小瀛洲 (三潭印月 island): a ring of land enclosing inner ponds ("湖中有湖"), cross dykes inside (田-shape). */
export const XIAOYINGZHOU = { center: geo(30.2393, 120.1462), radius: 150, ring: 40, top: 1.3, southTip: geo(30.2379, 120.1464) };
/** 三潭 three stone lantern-pagodas in the water south of 小瀛洲, ~62 m apart (三塔鼎立). Built by pagodas.js. */
export const THREE_POOLS = [[136, 725], [165, 727.5], [146, 744]]; // fit to ref05 / ink05: A (near), B (left, moved as the ink still had it), C (right); ART: ~20 m apart (real ~62 m)
/** 湖心亭 islet */
export const HUXINTING = { center: geo(30.2462, 120.1487), radius: 34, top: 1.3 };
/** small islets: { id, center, radius, top } (heightfield raises them; ref05's mid-ground pavilion and willow) */
export const ISLETS = [
  { id: 'santan-islet', center: [198, 771], radius: 13, top: 0.8 },
];

// ------------------------------------------------------------------ hills
/**
 * Hills: { name, c:[x,z], r:[rx,rz], h, rot (deg), rough } — anisotropic domes with warped outlines and gullies,
 * combined with a smooth max in heightfield.js. Heights are the real summits (m above the lake, ~7 m less than a.s.l.).
 * `cliff` marks a face the karst module replaces with real rock (heightfield keeps a steep placeholder).
 */
export const HILLS = [
  // north shore: 宝石山 (保俶塔), 葛岭, 栖霞岭
  { name: '宝石山', c: geo(30.2635, 120.1474), r: [470, 220], h: 76, rot: -12, rough: 0.3 },
  { name: '葛岭', c: geo(30.2627, 120.1414), r: [380, 250], h: 118, rot: -5, rough: 0.35 },
  { name: '栖霞岭', c: geo(30.2622, 120.1350), r: [520, 300], h: 135, rot: 5, rough: 0.4 },
  { name: '北山 back', c: geo(30.2680, 120.1380), r: [1100, 380], h: 160, rot: -8, rough: 0.45 },
  // west: 北高峰 / 灵隐 / 飞来峰, 南高峰, 三台山, 天竺
  { name: '北高峰', c: geo(30.2500, 120.0962), r: [1300, 700], h: 307, rot: 20, rough: 0.5 },
  { name: '飞来峰', c: geo(30.2384, 120.1040), r: [420, 230], h: 150, rot: 5, rough: 0.6, cliff: true },
  // ART (ref08): a wooded hill behind 灵隐 with the pagoda high in the frame; applied after the valley floor
  { name: '灵隐 knoll', c: [-3700, 345], r: [200, 100], h: 110, rot: 0, rough: 0.3, afterValley: true },
  { name: '南高峰', c: geo(30.2338, 120.1172), r: [950, 700], h: 250, rot: -25, rough: 0.5 },
  { name: '三台山', c: geo(30.2372, 120.1258), r: [450, 750], h: 110, rot: 10, rough: 0.4 },
  { name: '天竺', c: geo(30.2300, 120.0800), r: [2200, 1500], h: 400, rot: 30, rough: 0.55 },
  // south shore: 夕照山 (雷峰塔), 南屏山, 九曜山
  { name: '夕照山', c: geo(30.2306, 120.1487), r: [230, 150], h: 44, rot: 10, rough: 0.2 },
  { name: '南屏山', c: geo(30.2268, 120.1497), r: [620, 300], h: 95, rot: 8, rough: 0.4 },
  { name: '九曜山', c: geo(30.2262, 120.1400), r: [620, 450], h: 175, rot: 0, rough: 0.45 },
  // between the lake and the river: 玉皇山, 凤凰山, 将台山, 万松岭; the city hill 吴山
  { name: '玉皇山', c: geo(30.2150, 120.1500), r: [720, 560], h: 230, rot: -20, rough: 0.45 },
  { name: '将台山', c: geo(30.2172, 120.1552), r: [420, 380], h: 195, rot: 0, rough: 0.45 },
  { name: '凤凰山', c: geo(30.2203, 120.1578), r: [560, 420], h: 171, rot: 30, rough: 0.45 },
  // the east spur under the palace: a low foothill; the palace mesa (PALACE.mound) stands on it
  { name: '凤凰山 east spur', c: geo(30.2238, 120.1628), r: [420, 280], h: 30, rot: 35, rough: 0.3 },
  { name: '万松岭', c: geo(30.2298, 120.1608), r: [480, 190], h: 85, rot: 40, rough: 0.35 },
  { name: '吴山', c: geo(30.2405, 120.1662), r: [460, 230], h: 88, rot: -20, rough: 0.35 },
  // the river bank: 月轮山 (六和塔), 白鹤峰 / 大慈山 ridge upstream (之江)
  { name: '月轮山', c: [-1790, 4730], r: [380, 260], h: 85, rot: 30, rough: 0.4 },
  { name: '之江 ridge', c: geo(30.1960, 120.1100), r: [1300, 520], h: 190, rot: 25, rough: 0.5 },
  { name: '五云山', c: geo(30.2080, 120.1050), r: [1500, 1000], h: 335, rot: -30, rough: 0.5 },
];

/**
 * MASSIF: the hill country that closes the lake on three sides ("三面云山一面城"): west (北高峰 · 天竺 · 南高峰), south-west
 * (五云山 · 九曜山) and south (南屏 · 玉皇 · 凤凰山) down to the Qiantang. A ridged fractal fills the polygon (heights rising
 * inland from `edge` to `inland`), the named HILLS sit on it as recognisable summits, VALLEYS cut through it.
 */
export const MASSIF = {
  polygon: [[-1300, -2700], [-1350, -1650], [-1500, -800], [-1560, 100], [-1350, 950], [-850, 1500], [-150, 1750], [250, 1900],
    [800, 1800], [1250, 1750], [1500, 2050], [2050, 2600], [2300, 3150], [1700, 3450], [400, 3850], [-800, 4250], [-1550, 4560], [-2400, 5300],
    [-4200, 6100], [-7000, 7000], [-13000, 6500], [-13000, -4500], [-7000, -5200], [-3000, -3600]],
  fade: 520,          // metres over which the massif rises from the plain at the polygon edge
  edge: 55,           // typical crest height near the edge (m)
  inland: 330,        // typical crest height 4 km inside
  scale: 1300,        // ridge spacing (m)
  seed: 8,
};

/**
 * Distant ranges (layered "远山" in the haze): long ridges with a noisy crest. { name, points, h (crest m), w (half
 * width m), seed }. ART: the references show bigger, more layered far mountains than the real Hangzhou hills; the
 * far ranges are art-directed per camera (docs/COMPOSITION.md). Keep the ESE (萧绍 plain, shot 9) and the NE flat.
 */
export const RANGES = [
  { name: '西山 inner', points: [[-5200, -4200], [-6200, -1500], [-5800, 1500], [-4600, 3600], [-2600, 5200]], h: 380, w: 1500, seed: 1 },
  { name: '西山 outer', points: [[-10500, -6500], [-11500, -1500], [-10500, 3500], [-8000, 6800], [-5000, 9000]], h: 620, w: 2600, seed: 2 },
  // south of the Qiantang, in the shot-1 view (bearing 166-201 from 宝石山); ART: the far ones much taller than real
  { name: '萧山 hills', points: [[-7000, 9800], [-3500, 9200], [-500, 10200], [2500, 11600]], h: 420, w: 1600, seed: 3 },
  { name: '远岭 south 1', points: [[-16000, 7000], [-11000, 13000], [-5000, 16500], [2000, 18500], [7000, 21000]], h: 1250, w: 4200, seed: 4 },
  { name: '远岭 south 2', points: [[-30000, -4000], [-25000, 10000], [-16000, 24000], [-2000, 29000], [12000, 33000]], h: 2200, w: 6500, seed: 5 },
  { name: '远岭 south 3', points: [[-26000, 36000], [-8000, 40000], [8000, 41000], [24000, 38000]], h: 3100, w: 7000, seed: 8 },
  { name: '北山 far', points: [[-16000, -8000], [-10000, -11500], [-3000, -13500]], h: 520, w: 3000, seed: 6 },
  { name: '天目 far NW', points: [[-34000, -16000], [-26000, -22000], [-16000, -26000]], h: 1400, w: 7000, seed: 7 },
  // ART (ref10): a snowy range on the far left of the 断桥 view, high enough to show over 葛岭 and 栖霞岭
  { name: '雪岭 W (shot 10)', points: [[-15000, -4000], [-13500, -8500], [-11000, -12500]], h: 2400, w: 8000, seed: 9 },
];

/** 钱塘江 Qiantang river. northBank follows the real north bank (六和塔 → 闸口 白塔 → 复兴 → 江干 → east); the centre line
 *  is the bank offset by the local half width toward the south bank (computed below). Width ~1.3 km at 六和塔,
 *  widening downstream into the estuary. */
export const QIANTANG = {
  // ART: a bay in the north bank east of 六和塔 (~130 m north of the straight line): shot 9 needs the shore and the moored
  // junks 250-600 m from the camera, as in ref09 (the river is called 之江 for its bends)
  // ART (shot 6, ink06): the Song bank. The tide came up to the city's south-east gate (候潮门, ~[3150, 1550]) and ran
  // along the foot of 凤凰山 below the palace (江干); the bank has since moved 1–1.5 km south. Here it runs north-north-east
  // along the foot of 凤凰山 and passes ~100 m from the foot of the palace mesa's south-east cliff before turning east, so
  // the river lies right under the palace on the left of the ink06 view, flowing toward the viewer (ART: closer than
  // the Song bank is known to have been)
  northBank: [[-5000, 6500], [-3000, 5800], [-1558, 5030], [-1380, 4900], [-1150, 4760], [-850, 4640], [-400, 4500], [0, 4300], [600, 3980], [1150, 3640], [1450, 3250], [1650, 2930], [1760, 2650], [1810, 2480], [1832, 2390], [1890, 2310], [2050, 2240], [2400, 2175], [2900, 2115], [3500, 2065], [4400, 2000], [5300, 1880], [6700, -110], [9100, -1770], [14000, -3000], [22000, -4000]],
  width: 1300,
  widen: [[-5000, 1.0], [-1300, 1.0], [500, 1.0], [1250, 0.42], [2300, 0.42], [3300, 0.8], [4300, 1.23], [6000, 1.4], [7300, 1.7], [9500, 2.3], [14000, 3.4], [22000, 4.3]],
  points: null, // centre line, derived
};
/** river width multiplier at x */
export function riverWiden(x) {
  const W = QIANTANG.widen;
  if (x <= W[0][0]) return W[0][1];
  for (let i = 0; i < W.length - 1; i++) if (x <= W[i + 1][0]) return W[i][1] + (W[i + 1][1] - W[i][1]) * (x - W[i][0]) / (W[i + 1][0] - W[i][0]);
  return W[W.length - 1][1];
}
{
  const B = QIANTANG.northBank;
  QIANTANG.points = B.map((p, i) => {
    const a = B[Math.max(0, i - 1)], b = B[Math.min(B.length - 1, i + 1)];
    const dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz);
    const hw = QIANTANG.width * 0.5 * riverWiden(p[0]);
    // right of the downstream direction (flow toward +x) = toward the south bank
    return [Math.round(p[0] - (dz / l) * hw), Math.round(p[1] + (dx / l) * hw)];
  });
}

/**
 * CLEFTS: rock ravines cut into a hill (heightfield.js cleftAt): { id, points (axis, from the head down), floor: [y at the
 * head, y at the mouth] (m), width (floor, m), walls: [run per m of height on the left, on the right] (left = left of
 * the axis seen walking down it; 0.3 ≈ a 73° cliff), shot }. The rock faces are dressed by the rocks module.
 */
export const CLEFTS = [
  // shot 1 (ink01): the 樓閣 on its rock across a ravine from the 宝石山 crest. The cleft runs from the crest south-east
  // down toward 北山路; its south-west wall is the sheer tuff face under the 樓閣 (宝石流霞), the north-east one (the
  // vantage the shot looks from) a steep rocky slope. ART: 宝石山's crest is boulder-strewn tuff, not cleft like this.
  { id: 'baoshi-cleft', points: [[212, -2238], [246, -2200], [274, -2172], [304, -2140], [344, -2096], [394, -2042]], floor: [66, 16], width: 8, walls: [1.8, 0.3], shot: [1, 10] },
];

/** valleys / streams carved into the terrain: { name, points, width (stream m), depth (m below the floor),
 *  floor: { halfWidth (m), level: [at the first point, at the last point], wall (rise per m beyond the floor) } } */
export const VALLEYS = [
  // 冷泉溪 between 灵隐寺 (north bank) and 飞来峰 (south bank), flowing east; the 灵隐 valley floor ~ 30 m above the lake
  { name: '冷泉溪', points: [geo(30.2414, 120.0960), geo(30.2412, 120.0985), [-4220, 372], [-4110, 405], [-4030, 428], [-3978, 431], [-3900, 431], [-3830, 427], [-3751, 424], [-3481, 466], geo(30.2392, 120.1130), geo(30.2420, 120.1190), geo(30.2462, 120.1240), geo(30.2505, 120.1300)], // fit: shot 8 runs along it
    width: 9, depth: 2.2, floor: { halfWidth: 110, level: [34, 2], wall: 0.5 },
    // water: the surface stands this far above the bed (heightfield.js streamWaterAt, for the water module); pools: wider,
    // deeper reaches (ink08: the pool in front of the 布袋 cliff, open water in the lower left of the shot-8 view)
    water: 0.7, pools: [{ c: [-3974, 428.5], r: [15, 6.5], rot: 8, depth: 1.2 }] },
];

// ------------------------------------------------------------------ the city of Lin'an (east of the lake)
/**
 * Lin'an: the west wall follows the east shore of the lake (gates 钱塘门 · 丰豫门(涌金门) · 清波门 · 钱湖门); the palace
 * (大内) sits on the east foot of 凤凰山 at the south end; 御街 runs north from the palace's north gate 和宁门 past 朝天门
 * (the drum tower); the 市河 runs just west of 御街 and the 盐桥运河 (中河) east of it.
 */
export const CITY = {
  westWall: [geo(30.2620, 120.1600), geo(30.2575, 120.1588), geo(30.2510, 120.1616), geo(30.2440, 120.1628), geo(30.2375, 120.1612), geo(30.2335, 120.1600)],
  wallHeight: 9, wallWidth: 10,
  gates: [
    { name: '钱塘门', at: geo(30.2578, 120.1590) },
    { name: '丰豫门', at: geo(30.2468, 120.1626) },
    { name: '清波门', at: geo(30.2378, 120.1612) },
    { name: '钱湖门', at: geo(30.2338, 120.1600) },
  ],
  bounds: [1500, -4000, 4300, 2400], // x0, z0, x1, z1 (rough extent of the walled city, for masks)
  ground: 4.5,
  // 御街 (today 中山路): from 和宁门 north. x is constant-ish; the shot-7 camera hovers above it.
  yujie: { points: [geo(30.2290, 120.1693), geo(30.2408, 120.1707), geo(30.2520, 120.1704), geo(30.2640, 120.1700), geo(30.2760, 120.1690)], width: 22 },
  // canals (water at y 0, carved channels with stone embankments): 市河 west of 御街, 盐桥运河 (中河) east of it
  canals: [
    // ART: 市河 runs ~45 m west of 御街 (one row of shops between them) north of 朝天门, as in ref07
    { name: '市河', points: [geo(30.2330, 120.1672), geo(30.2400, 120.1688), [2398, 150], [2382, -500], [2378, -1200], [2372, -1900], geo(30.2640, 120.1693), geo(30.2760, 120.1680)], width: 16, depth: 2.0 },
    { name: '盐桥运河', points: [geo(30.2290, 120.1728), geo(30.2420, 120.1736), geo(30.2560, 120.1734), geo(30.2700, 120.1726), geo(30.2800, 120.1716)], width: 20, depth: 2.2 },
  ],
  // street grid for the blocks (src/city/): lanes run E-W every `lane` m off 御街; blocks of shops (2 storeys)
  grid: { lane: 55, alley: 18, shopDepth: 14, storeys: [1, 2] },
  landmarks: [
    { name: '朝天门 (鼓楼)', at: geo(30.2408, 120.1707), kind: 'gate-tower' },
    { name: '和宁门', at: geo(30.2290, 120.1693), kind: 'gate-tower' },
  ],
};

// ------------------------------------------------------------------ 凤凰山 palace (大内)
/**
 * The palace on the east spur of 凤凰山 (shot 6, ink06): walled terraces (城台) stepping down a mesa whose east and north
 * faces drop as cliffs to the plain, the Qiantang ~700 m below on the south-east (the Song bank, QIANTANG). Everything
 * is laid out in the main hall's frame: a = metres toward the hall's right (bearing facing + 90, ESE: the left of a
 * view from the north-north-east), b = metres toward its front (bearing `facing`, NNE). palaceAt(a, b) → world [x, z].
 *   mound   the mesa: plateau G(a, b) = top + ka·a + kb·b inside `outline` (a, b polygon); outside an edge with cliff > 0
 *           the ground falls over `run` m to `foot` (then the natural terrain), elsewhere it blends into the hill over
 *           `blend` m (heightfield.js palaceMound)
 * CHENGTAI (walled terraces) and STAIRS below carry the levels; HALLS place the buildings on them.
 */
export const PALACE = {
  center: [1687, 2245],
  facing: 20,
  mainHall: 'palace-main',
  mound: {
    top: 54, ka: -0.04, kb: -0.18,
    // the cliff top runs a few metres outside the outer terrace walls (walls over the cliff, ink06)
    outline: [[-140, -90], [40, -90], [80, -55], [81, 40], [80, 82], [16, 84], [12, 62], [-90, 62], [-140, 50]],
    // per edge (from vertex i to i + 1): 1 = cliff, 0 = blend into the hill
    cliff: [0, 1, 1, 1, 1, 1, 0.85, 0, 0],
    run: 11, foot: 12, blend: 140,
  },
};
const PAL_A = ((PALACE.facing + 90) * Math.PI) / 180, PAL_B = (PALACE.facing * Math.PI) / 180;
/** palace frame (a toward the hall's right, b toward its front, metres) → world [x, z] */
export function palaceAt(a, b) {
  return [+(PALACE.center[0] + a * Math.sin(PAL_A) + b * Math.sin(PAL_B)).toFixed(2), +(PALACE.center[1] - a * Math.cos(PAL_A) - b * Math.cos(PAL_B)).toFixed(2)];
}
/** world → palace frame [a, b] */
export function palaceFrame(x, z) {
  const dx = x - PALACE.center[0], dz = z - PALACE.center[1];
  return [dx * Math.sin(PAL_A) - dz * Math.cos(PAL_A), dx * Math.sin(PAL_B) - dz * Math.cos(PAL_B)];
}
/** a palace-frame rectangle a0..a1 × b0..b1 → { center, size, rot } in the TERRACES schema (size[0] along a) */
function palRect(a0, a1, b0, b1) { return { center: palaceAt((a0 + a1) / 2, (b0 + b1) / 2), size: [a1 - a0, b1 - b0], rot: PALACE.facing + 90 }; }

/**
 * CHENGTAI: walled terraces (城台), flat at `level`, their edges retained by battered stone walls wherever the ground
 * outside is lower (src/yingzao/chengtai.js builds them; heightfield.js drops the ground at the edge). Same schema as
 * TERRACES (size[0] along rot) plus wall: { batter (run per m of height), rail (勾闌 on the coping), pave (paved top),
 * gates: [{ side (0 +a end … see chengtai.js), at (m along the side from its middle), w, h }], panels: [...] }.
 */
const W = { batter: 0.16, rail: true, pave: true };
export const CHENGTAI = [
  // the top terrace: the main hall, the 朵殿 at its right end, a 闕 at each back corner, the 重檐 pavilion at the front-left
  { id: 'palace-t3', ...palRect(-80, 46, -42, 34), level: 63, shot: [6], wall: { ...W,
    // the big front wall over the court below (ink06): a gate near its left end, a carved panel right of the gate
    // (at: metres from the side's middle, a = −17, toward +a): the gate at a = 39, the panel at a = 29
    gates: [{ side: 'front', at: 56, w: 4.2, h: 5.6 }], panels: [{ side: 'front', at: 46, w: 2.6, h: 8 }] } },
  // left of the top terrace (toward the river): a side court with a hall facing out over the cliff
  { id: 'palace-t4', ...palRect(46, 74, -36, 34), level: 56, shot: [6], wall: W },
  // the front court across the whole width under the big wall, the 馬道 up to the top terrace at its far (west) end
  { id: 'palace-t2', ...palRect(-80, 74, 34, 58), level: 50, shot: [6], wall: W },
  // the lowest court at the front-left, over the cliff (a small hall)
  { id: 'palace-t1', ...palRect(18, 76, 58, 78), level: 42, shot: [6], wall: W },
  // the stone court of the temple at the foot of 夕照山 (shot 4, ink04): walled toward the lake with a balustrade, a broad
  // flight down to the shore quay (STAIRS leifeng-stair)
  { id: 'leifeng-court', center: [462, 1302], size: [80, 40], rot: 100, level: 7, shot: [4], wall: { batter: 0.1, rail: true, pave: true } },
  // 六和塔's paved terrace on the 月轮山 slope above the river (ink09: walled, a 勾闌 round it, the flight down to the harbour)
  { id: 'liuhe-base', center: [geo(30.1998, 120.1290)[0], geo(30.1998, 120.1290)[1] - 6], size: [50, 64], rot: 90, level: 30, shot: [9], wall: { batter: 0.12, rail: true, pave: true } },
];

/**
 * STAIRS: stone flights (踏道) on the ground or against a wall (馬道): { id, from: [x, z], to: [x, z], y: [y0, y1]
 * (tread level at each end), width, rail (勾闌 on the open side(s): 'left' | 'right' | 'both'), shot }. The heightfield
 * ramps the ground between the ends (walkable); src/yingzao/chengtai.js builds the steps, side walls and rails.
 */
export const STAIRS = [
  // the 馬道 up the big wall from the front court to the top terrace, one narrow flight at the wall's far (west) end
  // (the double flight meeting on the hall's axis read in the ink still as a huge triangular roof over the
  // middle of the wall; ink06's big wall is a plain face with its gate and panel, the stairs inconspicuous)
  { id: 'palace-s2', from: palaceAt(-64, 36.4), to: palaceAt(-43, 36.4), y: [50, 63], width: 4.0, rail: 'left', shot: [6] },
  // from the lowest court up to the front court, along its wall
  { id: 'palace-s1', from: palaceAt(46, 60.4), to: palaceAt(32, 60.4), y: [42, 50], width: 4.2, rail: 'right', shot: [6] },
  // from the front court up to the side court
  { id: 'palace-s3', from: palaceAt(48, 36.4), to: palaceAt(58.5, 36.4), y: [50, 56], width: 4.0, rail: 'left', shot: [6] },
  // from the side court up to the top terrace, along its left wall
  { id: 'palace-s4', from: palaceAt(48.4, -6), to: palaceAt(48.4, -18.5), y: [56, 63], width: 4.0, rail: 'left', shot: [6] },
  // ink04: the temple's broad flight from its court down to the shore quay (in front of the gate hall), the 畫舫 moored below
  { id: 'leifeng-stair', from: [489.9, 1272.4], to: [487.7, 1285.0], y: [1.6, 7], width: 7, rail: 'both', shot: [4] },
  // ink09: from the harbour road up the slope to 六和塔's terrace (its south edge)
  { id: 'liuhe-s1', from: [-1540, 4982], to: [-1540, 4927.2], y: [4.2, 30], width: 5, rail: 'both', shot: [9] },
];

/** flat platforms at fixed levels: { id, center, size:[w, d], rot (deg, of the long side), level (m), skirt (m) } */
export const TERRACES = [
  // rock spur on the 宝石山 crest under the shot-1 樓閣 (宝石流霞: red volcanic rock)
  { id: 'baoshi-spur', center: [250, -2146], size: [34, 32], rot: 84, level: 79, skirt: 2.5 }, // the turned, broader 樓閣; its north-east edge the top of the tuff cliff (CLEFTS baoshi-cleft)
  // 灵隐寺 court (north bank of 冷泉溪)
  { id: 'lingyin-court', center: [-3882, 375], size: [60, 50], rot: 80, level: 31, skirt: 12 },
  { id: 'lingyin-front', center: [-3903, 413], size: [44, 30], rot: 90, level: 30, skirt: 5 }, // 10 m east with the hall // the 大雄宝殿 terrace on the stream bank (ref08)
];

// ------------------------------------------------------------------ 灵隐 / 飞来峰
export const LINGYIN = {
  temple: geo(30.2418, 120.1012),           // 大雄宝殿
  // 飞来峰 north face along the stream: the karst module builds the limestone cliff and the 布袋弥勒 niche
  cliff: {
    face: [[-4060, 452], [-4000, 449], [-3962, 446], [-3910, 441], [-3850, 437], [-3790, 435]], // cliff foot line (west → east), fit to ref08
    normal: 355,          // compass bearing the face looks toward (N, across 冷泉溪 to the temple)
    height: 28,           // m above the stream bank
    budai: { at: [-3962, 446], facing: 300, seatH: 3.6, width: 9, niche: { width: 11, height: 9, depth: 3.5 } }, // 布袋弥勒 (南宋, 飞来峰第68龛), turned toward the shot-8 camera
    small: [{ at: [-3972, 447], facing: 330, height: 2.2 }], // the small standing figure in its own niche, left of the 布袋 (ref08)
    // karst (additive): cliff height above the stream bank along x (m). Low (10–13 m) where the face is seen in front of
    // the temple and the 飞来 pavilion from the shot-8 camera, rising to the pavilion's peak (-3858) and falling away
    // east. src/karst/feilai.js builds the rock to this profile; heightfield.cliffAt can follow it (it still uses height).
    profile: [[-4100, 26], [-3990, 26], [-3978, 22], [-3968, 16], [-3958, 12.5], [-3950, 10], [-3935, 10], [-3920, 13], [-3905, 19],
      [-3885, 32], [-3868, 44], [-3850, 44], [-3830, 34], [-3805, 22], [-3785, 12], [-3760, 4]],
  },
};

// ------------------------------------------------------------------ 六和塔 / 钱塘江 bank
export const LIUHE = {
  pagoda: geo(30.1998, 120.1290),
  bank: [geo(30.1975, 120.1200), geo(30.1990, 120.1270), geo(30.2005, 120.1330), geo(30.2035, 120.1420)], // stone embankment
};

// ------------------------------------------------------------------ timber buildings
/**
 * HALLS: every timber building. Built by src/modules/yingzao.js.
 *   id, kind: a builder or preset of src/yingzao/buildings.js: hall · chongyan (重檐) · louge (樓閣) · ting (亭)
 *         · shuixie (水榭 on piles) · qiao · lang (廊) · menwu (門屋) · menlou (門樓) · que (闕) · gulou (鼓樓), or a preset name
 *         (palace-main, duodian, jingci, lingyin-tianwang, lingyin-daxiong, louge-hero, ting-hex, ting-oct, ting-xieshan …)
 *   center [x, z]; facing (compass deg the front looks toward); shot: the shots that need it (lists, the hero first)
 *   level: ground level under the building (m); null = the terrain at the centre (heightfield pads / terraces make it flat)
 *   y: absolute floor height, only for buildings that do not stand on the ground (on piles / platforms in the water)
 *   padRadius: radius of the flattened pad (null / 0 = no pad: on a terrace, on piles or on rock)
 *   onWater: true = stands on piles / a stone platform in the water (no pad; level is the deck)
 *   params: 營造法式 parameters for src/yingzao (always valid for buildHall as a fallback massing)
 *   storeys / eaves / roof / span describe what the reference shows (for the kinds buildHall cannot do yet)
 * Positions marked "fit" are solved against the camera (docs/COMPOSITION.md); keep them unless the camera changes.
 */
export const HALLS = [
  // ---- shot 1: the two-storey 樓閣 on a rock spur of 宝石山, foreground right of the panorama (ref01)
  // ink01: bigger than the 材 of its grade, as the ink still drew it (the ink stage's scale is gone); on the
  // tuff cliff of the ravine (CLEFTS baoshi-cleft). 1.25× (1.45× stood ~20 % taller in the ink camera's frame than
  // ink01's tower and nearly twice as wide: ours is a broad 歇山 樓閣, ink01's a slender tower)
  { id: 'baoshi-louge', kind: 'louge-hero', shot: [1, 10], center: [251, -2146], facing: 95 /* 山花 to the camera as ref01 */, level: 79, padRadius: 0, terrace: 'baoshi-spur', scale: 1.25, // fit
    storeys: 2, eaves: 2, roof: 'xieshan',
    params: { type: 'diange', bays: 5, rafters: 6, grade: 4, puzuo: 5, roof: 'xieshan', jiaShen: 130, columnRatio: 0.9 } },
  // ---- shot 2: the 亭 straddling the 苏堤 path (六桥九亭), the arched bridge 60 m behind it (ref02)
  { id: 'su-ting', kind: 'ting', shot: [2], center: null /* set below from the causeway */, facing: 170, level: null, padRadius: 9,
    // ref02's square 歇山 亭 — tall columns, a high roof with its 山花 turned to the
    // path (the ridge runs along the causeway: the building is turned 90° and its steps sit on face 1), strong curl
    roof: 'xieshan', span: [8.4, 8.4], turn: 70, // 山花 to the camera, turned 15° as ref02
    params: { roof: 'xieshan', side: 8.4, depth: 8.4, bays: 3, depthBays: 3, H: 4.8, puzuo: 5, ju: 0.37, eaveScale: 0.75, zhuanChuan: 2, ridgeEnd: 'chiwei', curl: { lift: 85, hipTip: 14, thrust: 1.4, ridge: 30, ridgeZone: 0.5, chiwei: 0.3 } } },
  // ---- shot 3: 曲院风荷 — open 水榭 on piles (left), gallery, the 廳堂 with white walls (right), facing the lotus pond
  { id: 'quyuan-xie', kind: 'shuixie', shot: [3], center: [-869, -1034], facing: 295, level: 1.0, y: 1.1, onWater: true, padRadius: 0, // fit; 山花 to the camera as ref03
    roof: 'xieshan', span: [13, 10],
    params: { type: 'tingtang', bays: 3, rafters: 6, grade: 5, puzuo: 4, roof: 'xieshan', jiaShen: 120, columnRatio: 0.82, zhuanChuan: 1, ridgeEnd: 'chiwei', curl: { lift: 45, chiwei: 0.4 } } },
  { id: 'quyuan-lang', kind: 'lang', shot: [3], center: [-859, -1023], facing: 215, level: 1.0, y: 1.1, onWater: true, padRadius: 0, // fit
    path: [[-866, -1031], [-853, -1015]], span: [3.2, 3.2],
    params: { type: 'tingtang', bays: 3, rafters: 4, grade: 7, puzuo: 4, roof: 'xieshan', jiaShen: 100, columnRatio: 1.0 } },
  { id: 'quyuan-tang', kind: 'hall', shot: [3], center: [-846, -1013], facing: 300, level: 1.2, y: 1.3, onWater: true, padRadius: 0, // fit; 山花 to the camera as ref03
    eaves: 1, roof: 'xieshan', // single eaves, the walls on the front column line (a 副階 hid them in shade)
    // white plaster bays either side of the lattice doors, as ref03's hall
    params: { type: 'tingtang', bays: 5, rafters: 6, grade: 4, puzuo: 4, roof: 'xieshan', jiaShen: 130, columnRatio: 0.8, zhuanChuan: 1, ridgeEnd: 'chiwei', curl: { lift: 50, chiwei: 0.45 }, walls: { front: ['wall', 'window', 'door', 'window', 'wall'], default: ['wall', 'door', 'wall'], back: 'wall' } } },
  // ---- shot 4: temple hall at the foot of 夕照山 (雷峰塔院 / 显严院), facing the lake; 雷峰塔 behind (PAGODAS)
  // ink04: the 重檐 hall big under the pagoda (1.15×; the ink stage used to shrink it to 0.75×)
  { id: 'leifeng-dian', kind: 'jingci', shot: [4], center: [447, 1305], facing: 45, level: 7, padRadius: 0, terrace: 'leifeng-court', scale: 1.15, // fit
    eaves: 2, roof: 'xieshan',
    params: { type: 'diange', bays: 5, rafters: 8, grade: 2, puzuo: 6, roof: 'xieshan', jiaShen: 145, ju: 0.38, curl: { lift: 90 } } },
  { id: 'leifeng-men', kind: 'menwu', shot: [4], center: [487, 1289], facing: 45, level: 7, padRadius: 0, terrace: 'leifeng-court', scale: 0.75, // fit; 0.75× (was the ink stage's 0.6×)
    params: { type: 'tingtang', bays: 3, rafters: 4, grade: 5, puzuo: 5, roof: 'xieshan', jiaShen: 120 } },
  // ---- shot 5 (ink05): no lake hall south of 小瀛洲 (it never existed; ref05 had one, ink05 does not); the
  //      islet pavilion under the moon
  { id: 'santan-ting', kind: 'ting-xieshan', shot: [5], center: [196, 767], facing: 300, level: 0.8, padRadius: 0, islet: 'santan-islet', // fit
    roof: 'xieshan', span: [6, 6],
    params: { type: 'tingtang', bays: 3, rafters: 4, grade: 6, puzuo: 4, roof: 'xieshan', jiaShen: 110 } },
  // ---- shot 6: the palace (ink06) on its walled terraces (CHENGTAI, palace frame a / b, see PALACE): the main hall
  //      (重檐廡殿, 九間) on the top terrace facing NNE, the 朵殿 at its right end, a 闕 at each back corner, the 重檐
  //      octagonal pavilion on a tall base at the front-left corner, a 廊 between them; a hall on the side court facing
  //      out over the cliff toward the river, a small hall on the lowest court, a pavilion and a 廊 on the front court
  { id: 'palace-main', kind: 'palace-main', shot: [6], center: palaceAt(0, 0), facing: 20, level: 63, padRadius: 0, terrace: 'palace-t3',
    eaves: 2, roof: 'wudian', podium: { height: 6.5, tiers: 2, stairs: 'front' },
    params: { type: 'diange', bays: 9, rafters: 10, grade: 2, puzuo: 7, roof: 'wudian', jiaShen: 150 } },
  { id: 'palace-duo', kind: 'duodian', shot: [6], center: palaceAt(-58, -8), facing: 20, level: 63, padRadius: 0, terrace: 'palace-t3',
    roof: 'xieshan', params: { type: 'diange', bays: 5, rafters: 6, grade: 4, puzuo: 5, roof: 'xieshan', jiaShen: 130, platform: { h: 2.4, tiers: 2 } } },
  { id: 'palace-que', kind: 'que', shot: [6], center: palaceAt(34, -29), facing: 20, level: 63, padRadius: 0, terrace: 'palace-t3',
    params: { type: 'tingtang', bays: 3, rafters: 4, grade: 5, puzuo: 5, roof: 'wudian', jiaShen: 110 } },
  { id: 'palace-que-2', kind: 'que', shot: [6], center: palaceAt(-68, -31), facing: 20, level: 63, padRadius: 0, terrace: 'palace-t3',
    params: { type: 'tingtang', bays: 3, rafters: 4, grade: 5, puzuo: 5, roof: 'wudian', jiaShen: 110 } },
  { id: 'palace-ting-1', kind: 'ting-oct', shot: [6], center: palaceAt(37, 24), facing: 20, level: 63, padRadius: 0, terrace: 'palace-t3', eaves: 2, roof: 'zanjian', podium: { height: 6, tiers: 2, stairs: 'none' },
    params: { type: 'tingtang', bays: 3, rafters: 4, grade: 5, puzuo: 5, roof: 'xieshan', jiaShen: 110 } },
  { id: 'palace-lang-1', kind: 'lang', shot: [6], center: palaceAt(40, 1), facing: 290, level: 63, padRadius: 0, terrace: 'palace-t3', path: [palaceAt(40, -12), palaceAt(40, 15)], span: [3.4, 3.6],
    params: { type: 'tingtang', bays: 8, rafters: 4, grade: 6, puzuo: 4, roof: 'xuanshan', jiaShen: 100 } },
  { id: 'palace-front', kind: 'hall', shot: [6], center: palaceAt(61, -2), facing: 110, level: 56, padRadius: 0, terrace: 'palace-t4',
    roof: 'xieshan', params: { type: 'tingtang', bays: 5, rafters: 6, grade: 4, puzuo: 5, roof: 'xieshan', jiaShen: 130, zhuanChuan: 1, ju: 0.36, walls: { default: 'door', back: 'wall' } } },
  { id: 'palace-ting-2', kind: 'hall', shot: [6], center: palaceAt(52, 69), facing: 20, level: 42, padRadius: 0, terrace: 'palace-t1',
    params: { type: 'tingtang', bays: 3, rafters: 4, grade: 6, puzuo: 4, roof: 'xieshan', jiaShen: 110 } },
  { id: 'palace-ting-3', kind: 'ting-hex', shot: [6], center: palaceAt(-62, 47), facing: 20, level: 50, padRadius: 0, terrace: 'palace-t2',
    roof: 'zanjian', params: { type: 'tingtang', bays: 3, rafters: 4, grade: 6, puzuo: 4, roof: 'xieshan', jiaShen: 110 } },
  { id: 'palace-lang-2', kind: 'lang', shot: [6], center: palaceAt(-38, 55), facing: 200, level: 50, padRadius: 0, terrace: 'palace-t2', path: [palaceAt(-54, 55), palaceAt(-26, 55)], span: [3.4, 3.4],
    params: { type: 'tingtang', bays: 8, rafters: 4, grade: 6, puzuo: 4, roof: 'xuanshan', jiaShen: 100 } },
  // ---- shot 7: 朝天门 drum tower over 御街 (a 樓 on a masonry gate base)
  { id: 'chaotian-men', kind: 'gulou', shot: [7], center: geo(30.2408, 120.1707), facing: 0, level: null, padRadius: 26, base: { height: 9, depth: 18 },
    storeys: 2, roof: 'xieshan', params: { type: 'diange', bays: 5, rafters: 6, grade: 4, puzuo: 5, roof: 'xieshan', jiaShen: 130 } },
  // ---- shot 8: 灵隐寺 天王殿 and 大雄宝殿 (重檐歇山) on the north bank of 冷泉溪, facing south over the stream
  // ref08's big double-eaved hall stands just across the stream (ridge y 0.16, x 0.07-0.47), so the
  // 大雄宝殿 comes forward onto its own terrace on the bank (ART: ~45 m from the camera) and the 天王殿 goes behind it
  { id: 'lingyin-tianwang', kind: 'lingyin-tianwang', shot: [8], center: [-3880, 368], facing: 170, level: 31, padRadius: 0, terrace: 'lingyin-court',
    roof: 'xieshan', params: { type: 'diange', bays: 5, rafters: 6, grade: 4, puzuo: 5, roof: 'xieshan', jiaShen: 130 } },
  // (the 飛來 pavilion on the cliff top is gone from the world: ink08 shows the cliff and the hill pagoda only)
  // 0.75× its grade (ink08: one modest hall beyond the bridge; was the ink stage's scale)
  { id: 'lingyin-daxiong', kind: 'lingyin-daxiong', shot: [8], center: [-3901, 416], facing: 170, level: 30, padRadius: 0, terrace: 'lingyin-front', scale: 0.75, // fit (ref08 left, beyond the bridge); moved right in frame, higher roof
    eaves: 2, roof: 'xieshan', params: { type: 'diange', bays: 7, rafters: 8, grade: 3, puzuo: 6, roof: 'xieshan', jiaShen: 140, ju: 0.4, curl: { lift: 85 } } },
  // ---- shot 9: 開化寺's hall behind 六和塔 on its terrace (ink09: the temple roofs left of the tower)
  { id: 'kaihua-dian', kind: 'hall', shot: [9], center: [-1560, 4874], facing: 180, level: 30, padRadius: 0, terrace: 'liuhe-base',
    roof: 'xieshan', params: { type: 'tingtang', bays: 5, rafters: 6, grade: 5, puzuo: 5, roof: 'xieshan', jiaShen: 130, ju: 0.34, curl: { lift: 60 } } },
  // ---- shot 9: small temple pavilion at the river shore below 六和塔 (开化寺)
  { id: 'kaihua-ting', kind: 'ting-oct', shot: [9], center: [-1484, 4884], facing: 160, level: null, padRadius: 8, // fit (ref09 centre)
    roof: 'zanjian', params: { type: 'tingtang', bays: 3, rafters: 4, grade: 6, puzuo: 4, roof: 'xieshan', jiaShen: 110 } },
  // ---- shot 10: the snow-covered pavilion at the east foot of 断桥 (right of frame)
  // ref10's open 重檐歇山 pavilion with its red 山花 turned to the camera (the ridge runs away to the right)
  // ink10: 7 m further east, so willows stand in a gap between the bridge's foot and the pavilion
  { id: 'duanqiao-ting', kind: 'chongyan', shot: [10], center: [673.5, -1679.2], facing: 235, level: 1.6, padRadius: 10, // fit (ref10 right, at the bridge's north foot)
    eaves: 2, roof: 'xieshan', span: [14, 10],
    params: { type: 'tingtang', bays: 3, bayWidths: [230, 300, 230], depthWidths: [300, 300], rafters: 4, grade: 5, puzuo: 4, roof: 'xieshan', jiaShen: 120, walls: 'open', columnRatio: 0.5, zhuanChuan: 1, ju: 0.34, ridgeEnd: 'chiwei', curl: { chiwei: 0.5, lift: 55 }, fujie: { depth: 80, H0: 165, puzuo: 4, clear: 0.1 } } },
];

// the 苏堤 pavilion sits on the causeway axis 70 m south of 望山桥 (shot 2 looks north through it to the bridge)
{
  const C = SU_CAUSEWAY;
  const p = polyPoint(C.points, C.bridges[3] + 70 / polyLength(C.points));
  const h = HALLS.find((x) => x.id === 'su-ting');
  h.center = [Math.round(p.x), Math.round(p.z)];
  h.facing = Math.round((bearingOf(p.tx, p.tz) + 360 + (h.turn || 0)) % 360); // along the causeway, front toward the south (the camera); turn: the plan turned so its gable end faces the camera
}

// ------------------------------------------------------------------ pagodas
/**
 * PAGODAS: built by src/modules/pagodas.js.
 *   kind: a pagoda builder of src/modules/pagodas.js: 'leifeng' (八角五層 樓閣式, brick body + timber 腰檐 / 平座, bronze 塔剎)
 *         | 'liuhe' (八角七層, brick core + timber eaves) | 'baochu' (slender brick) | 'santan' (三潭 stone lantern: sphere with
 *         5 round holes, gourd finial, lit at night) | 'stupa' (stone pagoda) | 'jingchuang' (經幢)
 *   type: what the reference shows ('louge' = a generic timber-eaved 樓閣式 pagoda: built with the liuhe / leifeng kinds)
 *   center, level (ground level, null = terrain), y (absolute base height, only for the 三潭 in the water), height (to the
 *   finial tip, m above the base), storeys, sides, shot
 */
export const PAGODAS = [
  { id: 'leifeng', kind: 'leifeng', type: 'leifeng', shot: [4, 1], center: geo(30.2310, 120.1488), level: null, height: 52, storeys: 6, sides: 8 }, // 6 storeys + 副階 = ref04's seven eaves
  // ink09 (which wins over ref09): tall and slender, nine storeys over a 副階 (ten eaves), 66 m to the
  // finial (ART: the real tower is ~60 m, 13 eaves outside); was the ink stage's alternate tower
  { id: 'liuhe', kind: 'liuhe', type: 'liuhe', shot: [9], center: LIUHE.pagoda, level: 30, height: 66, storeys: 9, sides: 8, facing: 180,
    params: { side: 6.6, H: 3.5, eaveScale: 1.15, crownEave: 1.35, fujie: true, sideTaper: 0.035 } },
  { id: 'baochu', kind: 'baochu', type: 'baochu', shot: [3, 10], center: geo(30.2640, 120.1466), level: null, height: 45, storeys: 7, sides: 6 },
  ...THREE_POOLS.map((c, i) => ({ id: 'santan-' + (i + 1), kind: 'santan', type: 'santan', shot: [5, 1], center: c, level: 0, y: 0, height: 3.0, sides: 1, lit: true, facing: 300 })),
  // city pagodas seen down 御街 (ref07): left, centre and right of the street
  { id: 'city-pagoda-e', kind: 'liuhe', type: 'louge', shot: [7], center: [2802, -216], level: null, height: 60, storeys: 9, sides: 8 }, // fit (ref07 left)
  { id: 'city-pagoda-c', kind: 'leifeng', type: 'louge', shot: [7], center: [2699, 455], level: null, height: 45, storeys: 7, sides: 8 },  // fit (ref07 centre, far)
  { id: 'city-pagoda-w', kind: 'liuhe', type: 'louge', shot: [7], center: [2300, -327], level: null, height: 55, storeys: 7, sides: 8 }, // fit (ref07 right of the canal)
  // the pagoda on the wooded hill behind 灵隐 (ref08, top centre)
  { id: 'lingyin-hill', kind: 'stupa', type: 'louge', shot: [8], center: [-3705, 350], level: null, height: 32, storeys: 7, sides: 6 }, // on the knoll behind the temple (ref08 top centre)
  // 北高峰塔 (Song, gone today): on the summit
  { id: 'beigaofeng', kind: 'liuhe', type: 'louge', shot: [], center: geo(30.2482, 120.0962), level: null, height: 36, storeys: 7, sides: 8 },
];

// ------------------------------------------------------------------ bridges
/**
 * BRIDGES: { id, name, type: 'arch1' (single semicircular arch) | 'arch3' | 'flat' | 'zigzag', center, axis (compass deg
 * of the deck direction), span (clear span m), rise (crown of the deck above the water m), width, length (m, with
 * ramps), shot }. Causeway bridges are derived from the causeway lines.
 */
function causewayBridges(C, prefix, opts) {
  return C.bridges.map((t, i) => {
    const p = polyPoint(C.points, t);
    // causewayAxis: the bridge's natural axis along the causeway (the explorable world walks over it; ART axes are for shots)
    const ax = Math.round(bearingOf(p.tx, p.tz));
    return { id: `${prefix}-${i}`, name: C.bridgeNames[i], type: 'arch1', center: [Math.round(p.x), Math.round(p.z)], axis: ax, causewayAxis: ax, ...opts(i) };
  });
}
export const BRIDGES = [
  // 望山桥 (su-3): ART (ink02) a tall round 月洞 arch standing across the causeway (axis 78, square to the
  // path and to the shot-2 ink camera), the slab path running through it; the same in the stills and the walking world
  ...causewayBridges(SU_CAUSEWAY, 'su', (i) => ({ span: 9, rise: 6.5, width: 7, length: 42, shot: [2, 1], ...(i === 3 ? { axis: 78, causewayAxis: undefined, moon: true } : {}) })),
  // 断桥: ART: a steeper hump than the real bridge (ref10), crown 8.5 m above the water. ink10: on its
  // causeway's axis (the walker crosses it as the still shows it; the ink stage's turn and the photographic stills'
  // ART axis 167 are gone)
  ...causewayBridges(BAI_CAUSEWAY, 'bai', (i) => (i === 0 ? { span: 11, rise: 8.5, width: 8, length: 48, shot: [10] } : { span: 8, rise: 5.5, width: 7, length: 36, shot: [1] })),
  { id: 'xiling', name: '西泠桥', type: 'arch1', center: geo(30.2581, 120.1398), axis: 30, span: 8, rise: 5, width: 7, length: 34, shot: [] },
  { id: 'changqiao', name: '长桥', type: 'arch1', center: geo(30.2349, 120.1573), axis: 120, span: 7, rise: 4.5, width: 6, length: 30, shot: [5] },
  { id: 'lingyin-bridge', name: '春淙桥', type: 'arch1', center: [-3950, 429], axis: 160, span: 4, rise: 2.0, width: 3.2, length: 11, shot: [8] }, // fit (ref08 lower left, low and side-on)
  // city canal bridges are generated along CITY.canals by the city module
];

// ------------------------------------------------------------------ boats
/** BOATS: { id, type: 'huafang' 畫舫 | 'wupeng' 烏篷船 | 'cargo' 貨船 | 'junk' 帆船 (sails) | 'skiff', at, heading, shot } */
export const BOATS = [
  { id: 'leifeng-huafang', type: 'huafang', at: [507, 1271], heading: 100, length: 11, shot: [4] }, // fit (moored at the 雷峰 shore steps)
  { id: 'su-skiff', type: 'skiff', at: geo(30.2445, 120.1380), heading: 10, length: 6, shot: [2] },
  // 钱塘江 (ink09): 沙船 off the harbour below 六和塔 (HAMLETS liuhe-harbour) — three under sail 230–320 m from
  // the shot-9 ink camera (low right in the still, as ink09), two more moored at the quay with furled sails, 24–32 m
  { id: 'qiantang-junk-0', type: 'junk', at: [-1490, 5062], heading: 66, length: 32, params: { furled: false }, shot: [9] },
  { id: 'qiantang-junk-1', type: 'junk', at: [-1438, 5012], heading: 58, length: 26, params: { furled: false }, shot: [9] },
  { id: 'qiantang-junk-2', type: 'junk', at: [-1392, 5072], heading: 74, length: 24, params: { furled: false }, shot: [9] },
  { id: 'qiantang-junk-3', type: 'junk', at: [-1300, 4930], heading: 236, length: 28, params: { furled: true }, shot: [9] },
  { id: 'qiantang-junk-4', type: 'junk', at: [-1228, 4882], heading: 240, length: 26, params: { furled: true }, shot: [9] },
  { id: 'qiantang-junk-6', type: 'junk', at: [-1180, 4990], heading: 250, length: 24, params: { furled: false }, shot: [9] },
  // city canal boats are generated along CITY.canals
];

/**
 * HAMLETS: villages of the city's house kit outside the walls (src/city/plan.js hamlets()): rows of houses parallel to a
 * shore `bank` (a polyline with the water on its right), from `from` to `to` m inland every `rowGap` m, fronts toward
 * the water; skipped where the ground is wet, steep or higher than `maxH`. { id, bank, from, to, rowGap, maxH, shot }
 */
export const HAMLETS = [
  // shot 9 (ink09): the 浙江渡 harbour village on the Qiantang bank below 六和塔, behind the quay (city shores.js)
  { id: 'liuhe-harbour', bank: [[-1500, 4986], [-1380, 4900], [-1150, 4760], [-1000, 4700]], from: 10, to: 38, rowGap: 15, maxH: 10, shot: [9] },
];

// ------------------------------------------------------------------ plants
/**
 * PLANTS: zones for the vegetation module. { id, species, polygon | line (+ width) | center + radius, density (per
 * 100 m²), shot, note }. Species: willow 垂柳, peach 桃, lotus 荷, pine 松, camphor 樟, maple 红枫, ginkgo 银杏,
 * bamboo 竹, tea 茶, osmanthus 桂. Seasons come from engine.registry.season (src/world/looks.js).
 */
export const PLANTS = [
  // 曲院风荷 lotus pond in front of the 水榭 (shot 3): the whole near water toward the camera
  { id: 'quyuan-lotus', species: 'lotus', polygon: [[-990, -900], [-850, -905], [-835, -995], [-890, -1045], [-1000, -1010]], density: 60, shot: [3] },
  // causeway rows (willow alternating with peach on both edges): derived from SU_CAUSEWAY / BAI_CAUSEWAY
  { id: 'su-rows', species: 'willow+peach', line: SU_CAUSEWAY.points, width: SU_CAUSEWAY.width, shot: [2, 1] },
  { id: 'bai-rows', species: 'willow+peach', line: BAI_CAUSEWAY.points, width: BAI_CAUSEWAY.width, shot: [1, 10] },
  // 宝石山 pines around the vantage 樓閣 (shot 1 foreground)
  { id: 'baoshi-pines', species: 'pine', center: geo(30.2620, 120.1490), radius: 160, density: 1.2, shot: [1] },
  // 灵隐: red maples and ginkgo along 冷泉溪 (shot 8)
  { id: 'lingyin-maple', species: 'maple', polygon: [[-3975, 425], [-3900, 424], [-3880, 398], [-3960, 400]], density: 2, shot: [8], note: 'red maples on the north bank, in front of the temple (ref08 left)' },
  { id: 'lingyin-ginkgo', species: 'ginkgo', center: [-3930, 455], radius: 25, density: 0.8, shot: [8], note: 'golden ginkgo on the cliff top (ref08 top right)' },
  // camphor around the palace terraces and pines on the slopes (shot 6)
  { id: 'palace-camphor', species: 'camphor', center: PALACE.center, radius: 300, density: 0.8, shot: [6] },
  { id: 'palace-pine', species: 'pine', center: palaceAt(70, 112), radius: 130, density: 1.4, shot: [6], note: 'pines on the cliffs and slopes under the walled terraces (ink06 lower half)' },
];

/**
 * CLEARINGS: view lines the vegetation must keep open (trees inside stay below maxHeight m above the ground, or none
 * when maxHeight is 0). { id, shot, polygon, maxHeight, note }
 */
export const CLEARINGS = [
  { id: 'leifeng-front', shot: [4], polygon: [[560, 1250], [430, 1280], [420, 1300], [470, 1318], [520, 1300], [575, 1265]], maxHeight: 6, note: 'between the 雷峰 shore and the temple hall: the hall roofs must show above the trees (ref04)' },
  { id: 'su-axis', shot: [2], polygon: [[-418, 312], [-410, 312], [-428, 215], [-440, 215]], maxHeight: 0, note: 'the causeway path from the camera through the pavilion to 望山桥 (ref02): trees only beside it' },
  { id: 'quyuan-water', shot: [3], polygon: [[-935, -945], [-840, -1000], [-860, -1040], [-930, -960]], maxHeight: 0, note: 'lotus only between the camera and the 水榭 (no trees on the water)' },
];

/** HERO_TREES: single framing trees for one camera: { species, at, height, lean (deg), facing, shot }. Filled after
 *  the camera fits (docs/COMPOSITION.md); vegetation places them exactly here (facing = the compass bearing the trunk
 *  leans toward). */
export const HERO_TREES = [
  // shot 2 (ink02): willows and peaches lining the slab path from the ink camera to 望山桥 (rows ±5–7 m off the path, a
  // big willow near on the left, peaches between them); placed along the causeway axis below
  // shot 1 (ink01): 黄山松 on the tuff cliff under the 樓閣, leaning out over the ravine toward the vantage; the five on
  //   the rim in front of and below the 樓閣 are ink01's pines (the layout's trees for a
  //   shot replace the ink framing trees; the three down in the ravine are below
  //   the ink camera's frame)
  // shot 10 (ink10): two snowy willows in the gap between 断桥's foot and the pavilion
  { species: 'willow', at: [659, -1680], height: 10, lean: 8, facing: 300, shot: [10] },
  { species: 'willow', at: [662, -1688], height: 9, lean: 10, facing: 250, shot: [10] },
  { species: 'pineH', at: [279, -2170], height: 11, lean: 24, facing: 35, shot: [1] },
  { species: 'pineH', at: [294, -2163], height: 13, lean: 32, facing: 25, shot: [1] },
  { species: 'pineH', at: [303, -2149], height: 8, lean: 36, facing: 15, shot: [1] },
  { species: 'pineH', at: [276, -2153], height: 12.8, facing: 130, shot: [1] },
  { species: 'pineH', at: [264, -2165], height: 10.5, facing: 160, shot: [1] },
  { species: 'pineM', at: [288, -2142], height: 13.5, facing: 120, shot: [1] },
  { species: 'pineH', at: [297, -2131], height: 9.4, facing: 140, shot: [1] },
  { species: 'pineH', at: [312.9, -2206.8], height: 8.9, facing: 140, shot: [1] },
];
{
  const C = SU_CAUSEWAY, b = polyPoint(C.points, C.bridges[3]);
  const fx = b.tx, fz = b.tz, rx = -fz, rz = fx;               // fwd = south along the path; r = to the walker's right (west)
  // [metres north of the bridge (toward the camera), metres to the right of the path, species, height]
  const ROWS = [
    // willows well off the path (their curtains frame the arch from the sides, ink02 x ≈ 0.25 and 0.66)
    [38, -9.5, 'willow', 11], [28, 9, 'willow', 9.5], [17, -8.5, 'willow', 8.5], [12, 9.5, 'willow', 8],
    // peaches close along the path, the near ones bigger
    [58, -5.2, 'peach', 2.8], [52, 5.0, 'peach', 2.6], [45, -4.4, 'peach', 2.4], [40, 4.5, 'peach', 2.4], [33, -4.3, 'peach', 2.3],
    [29, 4.3, 'peach', 2.2], [23, -4.2, 'peach', 2.2], [19, 4.2, 'peach', 2.1], [8, -4.1, 'peach', 2.0], [6, 4.1, 'peach', 2.0],
  ];
  for (const [back, right, species, height] of ROWS) {
    const x = b.x - fx * back + rx * right, z = b.z - fz * back + rz * right;
    HERO_TREES.push({ species, at: [Math.round(x * 10) / 10, Math.round(z * 10) / 10], height, shot: [2] });
  }
}
// shot 6 (ink06): 黄山松 on the palace cliffs, rooted a few metres down the face below the walls, leaning out over the drop
{
  const M = PALACE.mound, O = M.outline;
  const h = (k, q) => { const x = Math.sin(k * 91.17 + q * 37.71) * 43758.5453; return x - Math.floor(x); };
  let k = 0;
  for (let i = 0; i < O.length - 1; i++) {
    if ((M.cliff[i] ?? 0) < 0.8) continue;
    const [a0, b0] = O[i], [a1, b1] = O[i + 1], len = Math.hypot(a1 - a0, b1 - b0);
    const na = (b1 - b0) / len, nb = -(a1 - a0) / len;                  // outward
    const n = Math.max(1, Math.round(len / 24));
    for (let j = 0; j < n; j++, k++) {
      const t = (j + 0.25 + 0.5 * h(k, 1)) / n, out = 1.5 + 3.5 * h(k, 2);
      const a = a0 + (a1 - a0) * t + na * out, b = b0 + (b1 - b0) * t + nb * out;
      const [x0, z0] = palaceAt(a, b), [x1, z1] = palaceAt(a + na, b + nb);
      const facing = Math.round((bearingOf(x1 - x0, z1 - z0) + (h(k, 3) - 0.5) * 50 + 360) % 360);
      HERO_TREES.push({ species: 'pineH', at: [x0, z0], height: 8 + 7 * h(k, 4), lean: 14 + 22 * h(k, 5), facing, shot: [6] });
    }
  }
}

// ------------------------------------------------------------------ legacy / helpers
/** Vantage on the north shore (宝石山 shoulder): kept for older code; shot 1 now uses HALLS 'baoshi-louge'. */
export const VANTAGE = { center: HALLS[0].center, top: 72 };

// Default sun: spring morning, low in the east-south-east (from the left when looking across the lake to the south)
export const SUN = { azimuth: 105, elevation: 14 };

/** unit vector toward the sun from compass azimuth + elevation (deg) */
export function dirFromAzEl(azDeg, elDeg) {
  const az = (azDeg * Math.PI) / 180, el = (elDeg * Math.PI) / 180;
  return [Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el)];
}
/** rotation about Y for an object whose local front is +Z so that it faces compass bearing deg */
export function headingToRotY(deg) { return Math.PI - (deg * Math.PI) / 180; }

/** buildings / pagodas / bridges a shot needs (for module tests and the framing proxies) */
export function forShot(id) {
  const has = (o) => (o.shot || []).includes(Number(id));
  return { halls: HALLS.filter(has), pagodas: PAGODAS.filter(has), bridges: BRIDGES.filter(has), boats: BOATS.filter(has) };
}
