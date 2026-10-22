// Ink styles (?look=ink&inkStyle=mo|qj|ql) and per-shot ink settings.
//
//   mo  纯水墨: ink only on 宣纸, after 马远 / 夏圭: 斧劈皴 on rock, strong 留白, sparse heavy accents
//   qj  浅绛:   ink 勾皴 first, faint 赭石 on lit rock / ground / timber and 花青 on shade, far hills and foliage
//   ql  青绿:   ink lines on aged 絹 under mineral 石青 / 石绿 (opaque), 赭石 underlayer, 朱砂 columns
//
// Pigments are the classical set only: 赭石 ochre, 花青 indigo, 石青 azurite, 石绿 malachite, 朱砂 cinnabar,
// 藤黄 gamboge. Transparent ones are absorbances (Beer–Lambert over the paper); the mineral ones are body colours
// laid on top (ql) with partial opacity.

// display-referred (sRGB 0..1) colours / absorbances
export const PIGMENT = {
  ink: [0.92, 0.98, 1.06],          // carbon ink absorbance: a slightly warm black
  zheshi: [0.18, 0.42, 0.85],       // 赭石 absorbance (absorbs blue, some green)
  huaqing: [0.95, 0.55, 0.28],      // 花青 absorbance (indigo: absorbs red)
  tenghuang: [0.03, 0.12, 0.95],    // 藤黄 absorbance (gamboge: absorbs blue)
  zhusha: [0.06, 0.85, 0.80],       // 朱砂 absorbance (cinnabar)
  shiqing: [0.16, 0.36, 0.58],      // 石青 body colour (azurite)
  shilv: [0.26, 0.50, 0.42],        // 石绿 body colour (malachite)
  zhushaBody: [0.72, 0.22, 0.13],   // 朱砂 body colour
};

const BASE = {
  paper: 0,                          // 0 宣纸, 1 絹
  paperCol: [0.925, 0.895, 0.825],
  age: 0.35,                         // yellowing toward the edges and in patches
  inkGain: 1.0,                      // overall wash ink
  washGamma: 1.35,                   // tone → ink curve
  washLo: 0.3,                       // tone darkness below this leaves paper
  layers: 4.0,                       // wash layers (soft posterisation)
  pool: 0.35,                        // dark rims where a wash layer ends (水渍)
  gran: 0.25,                        // granulation into the paper
  line: 1.0,                         // line ink
  lineW: 0.8,                        // line width
  wobble: 1.2,                       // line wobble (px)
  dry: 0.25,                         // 飞白 baseline
  cun: 1.0, cunKind: 0,              // 皴 amount; 0 披麻 on hills (斧劈 on rock always), 1 斧劈 everywhere
  dots: 1.0,                         // leaf dots / needles
  moss: 1.0,                         // 苔点 along ridges
  waves: 1.0,                        // ripple lines on water
  color: 0.0,                        // transparent colour washes (qj)
  mineral: 0.0,                      // mineral body colours (ql)
};

export const STYLES = {
  // a neutral carbon ink (the targets' darks are neutral to a little cool on a warm sheet: an ink that
  // absorbs blue most turned every grey brown) and the targets' warmer sheet
  mo: { ...BASE, paperCol: [0.95, 0.925, 0.872], inkAbs: [1.0, 1.0, 0.94], age: 0.25, inkGain: 1.05, washGamma: 1.5, washLo: 0.32, cunKind: 1, dry: 0.35, layers: 3.5, pool: 0.45 },
  qj: { ...BASE, paperCol: [0.945, 0.915, 0.85], age: 0.4, color: 1.0 },
  ql: {
    ...BASE, paper: 1, paperCol: [0.80, 0.70, 0.52], age: 0.55, inkGain: 0.85, washGamma: 1.4, washLo: 0.3,
    line: 1.1, lineW: 0.9, wobble: 0.6, dry: 0.12, cun: 0.55, color: 0.7, mineral: 1.0, waves: 1.0,
  },
};

/**
 * Per-shot ink settings.
 *   near / far     line weight: full at `near` m, gone at `far` m (log scale)
 *   cunFar         皴 and leaf marks fade out by this distance (m)
 *   mi             米点 (soft far dots) for foliage beyond this distance
 *   ridge          px (at 1664 wide) over which a far range's wash fades below its ridge (mist at the foot); 0 = off
 *   ridgeFrom      ranges beyond this distance get the ridge fade
 *   tone           [gain, gamma] on the photographic tone before the wash curve
 *   sky            ink on the sky (night: dark wash)
 *   water          wash kept on water (0 = blank paper), waves = density of ripple lines, waveMode 1 = 水纹 rows
 *   warm           warm colour in the sky (sunset / dawn)
 *   mist           [y0, y1, from, amount]: 留白 band of mist below height y1 (m) beyond `from` m
 *   paperLift      a paler ground for snow scenes
 *   focus          [[x, y, z, radius, floor], …] world points where the ink gathers (radius as a fraction of the frame
 *                  height; floor = density far from every focus); the base of each mass is dark too
 *   bands          [[distance, half width, amount, ceiling], …] mist lying low (below `ceiling` m above groundY) at a
 *                  distance from the shot's camera: 留白 between the layers of a view
 */
const SHOT = { near: 40, far: 2600, cunFar: 3500, mi: 900, ridge: 70, ridgeFrom: 900, tone: [1, 1], sky: 0, water: 0.08, waves: 0.25, waveMode: 0, warm: 0, night: 0 };
// ink-match look, after the ink targets refs/inkNN.jpg:
//   detail   dark detail from the photograph's fine tone (tile rows, lattices, bark, leaf clusters), 0 = off
//   trees    crown ink gain (the targets' trees are dark masses, not pale crowns)
//   roofs    roof ink gain (the targets' roofs are a mid-dark wash with the tile rows drawn in)
//   accent   colour on blossom / lotus flowers, maples, ginkgo and a warm sky (uWarm) in 纯水墨
//   tint     multiplies the ink's absorbance (a night painting bluer, an evening one warmer)
//   skyTint  [absorbance rgb, amount]: a blue (or warm) sky, deeper at the zenith, clouds left paper
//   moonCol  night: [amount, half width at the horizon (rad), widening per rad below it, lantern glints]: the moon's
//            ONE reflection, a column broken into dashes (a photograph shows one stretched moon, not a row of moons)
//   match    the ink-match look (also in the walking painting, which draws no G-buffer detail)
//   foot     [width (sheet px), amount]: mist eating the feet of every mass where the water or a much nearer form cuts it
//   fg       [ink floor, height]: the foreground (the bottom `height` of the sheet) keeps this much of the full ink
const MATCH = { match: 1, detail: 1.0, trees: 1.35, roofs: 1.6, foot: [55, 0.9], fg: [0.85, 0.4] };
export const INK_SHOTS = {
  1: {
    ...SHOT, ...MATCH, trees: 1.05, near: 60, far: 4200, cunFar: 6000, mi: 700, ridge: 45, ridgeFrom: 1500, warm: 0.25, mist: [8, 45, 1800, 0.9],
    focus: [[253, 92, -2153, 0.45, 0.25], [270, 60, -2190, 0.3]],
    ranges: [0.8, 1.5, 4.0, 3, 0, 0, 0.42, 1.0],
    bands: [[330, 210, 0.85, 48], [3700, 900, 0.95, 70], [9000, 4500, 0.9, 300]],
  },
  2: {
    // a pale ground as ink02 (light grass, fallen petals): the ground, grass and slabs take the painter's
    //   light, not the trees' dappled cast shadows, no detail rings round the petals, the ground gain 2.6 → 1.3
    ...SHOT, ...MATCH, accent: 0.9, trees: 0.75, ground: 1.3, groundLift: 1.0, near: 8, far: 900, cunFar: 1500, mi: 250, ridge: 50, ridgeFrom: 600, warm: 0.15,
    focus: [[-436, 6, 222, 0.3, 0.25], [-446, 2, 150, 0.35]],
    ranges: [2.5, 1.2, 2.5, 3, 0, 0, 0.32, 0.7],
    bands: [[170, 60, 0.8, 6], [900, 500, 0.9, 80]],
  },
  3: {
    ...SHOT, ...MATCH, accent: 1.0, skyTint: [0.95, 0.55, 0.28, 0.32], clouds: 0.35, near: 30, far: 1500, mi: 500, ridgeFrom: 1100, ridge: 50,
    focus: [[-869, 6, -1034, 0.35, 0.2], [-930, 1, -985, 0.35]],
    ranges: [3.2, 1.0, 1.8, 2, 0, 0, 0.3, 0.7],
    bands: [[1050, 450, 0.7, 45]],
  },
  4: {
    // light and airy as ink04 (an earlier warm tint, crown gain 2.2 and dark warm water had turned the frame sepia
    //   and black): a neutral ink, crowns at 1.1, fewer leaf marks, the woods dark at the shore and paling upward into the
    //   haze (veil), the far hill lost in it; the low sun just right of the pagoda (INK_CAMS sun) with a pale gold halo,
    //   soft cloud bands right of it; the lake a calm pale wash, the woods' reflection under the shore, the sun's path
    //   broken into dashes of paper
    ...SHOT, ...MATCH, accent: 0.5, tint: [0.97, 1.0, 1.03], clouds: 0.5, haze: 450, trees: 1.1, leaf: 0.3, waterBase: 0.08, moonCol: [1.0, 0.028, 0.16, 0], foot: [30, 0.6], fg: [0.5, 0.3], near: 60, far: 1600, mi: 300, ridge: 110, ridgeFrom: 1300, warm: 0.3, tone: [1.5, 0.8], water: 0.5, waves: 0.1,
    glow: 1.0, veil: [15, 58, 0.6], cloudBands: 0.8,
    focus: [[346, 60, 1441, 0.35, 0.5], [520, 8, 1265, 0.3]],
    ranges: [3.0, 1.2, 2.5, 3, 0, 0, 0.35, 0.7],
    bands: [[900, 300, 0.8, 30]],
  },
  5: {
    ...SHOT, ...MATCH, near: 10, far: 1500, mi: 300, ridge: 0, sky: 0.9, water: 0.6, waves: 0.0, night: 1, tone: [2.4, 0.8],
    tint: [1.12, 1.0, 0.82], skyTint: [0.95, 0.55, 0.28, 0.45], moonCol: [1.0, 0.012, 0.07, 1.0],
    focus: [[136, 2, 725, 0.35, 0.3], [196, 4, 767, 0.3]],
  },
  6: {
    // the river and its banks read below the palace (ink06): a pale wash with ripples on the water, mist
    //   only on the far low ground, the land away from the palace keeps some ink (focus floor), the band of mist
    //   beyond the far bank (the old low mist up to 62 m blanked the river, the plain and the lower terraces), less
    //   mist at the feet of forms the river cuts (the cliff pines turned to pale ghosts against the water)
    // the walls as pale washes with a few course lines (walls), the 凤凰山 woods behind the palace veiled
    //   above the hall's roof (veil) so the roof stands against a pale hill, a low mist over the plain by the river
    ...SHOT, ...MATCH, detail: 1.0, trees: 0.9, near: 40, far: 2500, mi: 400, ridge: 50, ridgeFrom: 1200, mist: [5, 34, 140, 0.6],
    water: 0.25, waves: 0.6, foot: [40, 0.35], walls: 1.0, veil: [68, 100, 0.9],
    focus: [[1688, 75, 2236, 0.4, 0.4], [1730, 40, 2180, 0.3]],
    ranges: [0.8, 1.0, 3.2, 3, 0, 0, 0.38, 0.6],
    bands: [[5200, 1600, 0.8, 120]],
    groundY: 40,
  },
  7: {
    ...SHOT, ...MATCH, detail: 1.0, roofs: 1.0, haze: 320, near: 60, far: 1400, mi: 400, ridge: 50, ridgeFrom: 1200, warm: 0.15, tone: [1.4, 0.85], mist: [5, 40, 1300, 0.85],
    focus: [[2420, 13, -700, 0.35, 0.3], [2440, 31, -300, 0.25]],
    ranges: [1.2, 0.9, 2.2, 3, 0, 0, 0.35, 0.6],
    patch: [60, 0.7],
    bands: [[1500, 500, 0.9, 80]],
    groundY: 5,
  },
  8: {
    // the 冷泉溪 pool in the lower left holds water now (src/water/stream.js): a pale day wash with the
    //   banks, rocks and trees mirrored in it under the shore and ripple lines along the banks (ink08)
    ...SHOT, ...MATCH, accent: 1.0, rock: 1.0, near: 15, far: 800, cunFar: 900, mi: 250, ridge: 0, tone: [1.25, 0.85], mist: [40, 75, 160, 0.7],
    waterBase: 0.12, waves: 0.55, waterRefl: [0.55, 90],
    focus: [[-3962, 31, 450, 0.4, 0.25], [-3955, 30, 440, 0.25]],
    ranges: [12, 2.5, 3.5, 2, 92, 16, 0.5, 1.2],
    bands: [[130, 45, 0.75, 22]],
    groundY: 25,
  },
  9: {
    ...SHOT, ...MATCH, clouds: 0.2, near: 40, far: 3000, tone: [1.25, 0.9], mi: 400, ridge: 50, ridgeFrom: 2000, water: 0.05, waves: 0.4, waveMode: 1,
    focus: [[-1558, 60, 4900, 0.3, 0.25], [-1300, 3, 5050, 0.3]],
    ranges: [0.4, 1.0, 3.4, 3, 0, 0, 0.38, 0.6],
    bands: [[2200, 700, 1.0, 60], [4800, 2400, 1.0, 200]],
  },
  10: {
    ...SHOT, ...MATCH, detail: 0.8, near: 15, far: 1500, mi: 400, ridge: 50, ridgeFrom: 900, water: 0.1, waves: 0.05, paperLift: 1, tone: [0.9, 1.15],
    focus: [[650, 3.2, -1657, 0.3, 0.2], [671, 8.6, -1674, 0.25]],
    // ink10's snowy range rising behind the pavilion on the right (an ink far range, left largely as paper)
    ranges: [11.5, -7.0, 10.0, 2, -180, 24, 0.6, 2.6],
    bands: [[260, 120, 0.85, 25], [1500, 900, 0.9, 120]],
  },
};
export const inkShot = (id) => INK_SHOTS[id] || SHOT;

/**
 * Ink cameras: the same places recomposed as paintings (wider or taller framing, the subject off centre with room
 * around it). The photoreal cameras in src/world/shots.js stay as they are.
 */
export const INK_CAMS = {
  // every ink camera refitted to the 纯水墨 target (refs/inkNN.jpg)
  // 西湖全景 (ink01): level with the 樓閣's upper storey, the hall on the right edge over its cliff and pines, the lake
  //   with 白堤 and the 三潭 across the middle, ranges in mist above
  1: { pos: [332, 104, -2236], target: [297.8, 97, -2142], fov: 36 },
  // 苏堤 (ink02): on the causeway north of 望山桥, looking south along the slab path to the arch (no pavilion in the target)
  2: { pos: [-445, 3.3, 160], target: [-433, 5.0, 223], fov: 42 },
  // 曲院风荷 (ink03): the 水榭 and the gallery on the right third, 保俶塔 on its hill in the middle, lotus below
  3: { pos: [-944, 3, -966], target: [-877.37, 2.22, -1040.56], fov: 16 },
  // 雷峰夕照 (ink04): far out on the lake with a long lens, the pagoda on the left third above the temple and the trees
  //   the sun low just right of the pagoda, above the hall's ridge (ink04: the pagoda against the glow)
  4: { pos: [703, 2.5, 1067], target: [628.13, 7.97, 1133.06], fov: 16, sun: { azimuth: 225.68, elevation: 6.83 } },
  // 三潭印月 (ink05): close to one lantern, the other two left and right behind it, the islet and the moon beyond
  //   the moon set 11° right of centre and higher, twice the size (ink05), its one column straight below it
  5: { pos: [124, 2, 722], target: [212.29, 0.25, 768.95], fov: 30, sun: { azimuth: 127.5, elevation: 9.6 }, sky: { uSunSize: 0.017 } },
  // 皇城 (ink06): from the north-east, 25 m above the top terrace and 22° off the main hall's axis, looking
  //   along the terraces: the palace on its walled terraces at the right, the hall's front receding to the right, the
  //   cliff below, the 钱塘江 (narrowed here, layout QIANTANG widen) a ribbon on the left winding away upstream
  6: { pos: [1824.2, 88, 2092.7], target: [1770.98, 68.98, 2175.19], fov: 36 },
  // 御街 (ink07): higher, straight down the imperial way to the gate tower, the canal right, the horizon high
  7: { pos: [2416, 105, -935], target: [2418.18, 72.67, -840.4], fov: 40 },
  // 飞来峰 (ink08): the 布袋 in its niche right of centre, the temple and the bridge on the left beyond the stream
  8: { pos: [-3980, 28.4, 437.5], target: [-3881.53, 37.59, 452.29], fov: 46 },
  // 六和塔 (ink09): from the slope west of the pagoda, the pagoda on the left third, the river and the bore to the right
  9: { pos: [-1720, 85, 4990], target: [-1622.4, 67.23, 4977.38], fov: 40 },
  // 断桥残雪 (ink10): the bridge left of centre seen from the side, the pavilion right, open water in front
  10: { pos: [684, 5, -1612], target: [644.59, 7.95, -1703.86], fov: 40 },
};

/** view rules for the ink cameras (src/vegetation/placement.js VIEW_RULES, used in the ink look) */
export const INK_VIEW_RULES = {
  1: { mode: 'vista', low: 0.5, side: 0.6, range: 300, near: 0 },   // the hall and the lake open; pines low at the right
  2: { mode: 'corridor', range: 70, side: 0.07 },                     // the slab path to the bridge stays open (its rows of trees line it)
  6: { mode: 'vista', low: 0.5, side: 0.85, range: 300, near: 0 },     // the palace and its terraces over the trees
  9: { mode: 'vista', low: 0.45, side: 0.55, range: 320, near: 0 },   // the pagoda's body and the river stay open
};

/** rows of trees lining the path the ink camera stands on (src/vegetation/placement.js inkRows): along the causeway
 *  centre line from `from` to `to` m ahead of the camera, `step` m apart, willows `willow` m and peach `peach` m from the
 *  centre, alternating sides, none within `gap` m of a bridge */
export const INK_ROWS = {
  2: { causeway: 'su', from: 5, to: 125, step: 8.5, willow: 5.0, peach: 3.0, gap: 15, scale: 0.8 },
};

/** hero lotus blooms of the ink cameras (src/vegetation/lotus.js placeLotus): flowers scaled k times, heads `head` m
 *  over the water, placed against ink03's blooms (pixel → pond, ink camera 3) */
export const INK_LOTUS = {
  3: [
    { at: [-929.5, -989.3], k: 3.9, kind: 'half', head: 1.75 }, { at: [-933.0, -981.1], k: 2.9, kind: 'half', head: 1.35 }, { at: [-932.6, -975.7], k: 2.6, head: 1.05 },
    { at: [-925.8, -979.8], k: 2.4, kind: 'half', head: 1.5 }, { at: [-922.9, -997.0], k: 2.9, kind: 'half', head: 1.8 }, { at: [-918.2, -999.9], k: 2.5, head: 1.9 },
    { at: [-918.8, -991.8], k: 1.9, head: 1.6 }, { at: [-918.3, -994.6], k: 2.0, kind: 'bud', head: 1.7 }, { at: [-917.6, -997.4], k: 2.0, kind: 'half', head: 1.8 },
  ],
};

/** pines on the cliffs of an ink camera's view (src/vegetation/placement.js inkCliffPines): candidate cells of `cell` m
 *  between range[0] and range[1] m from the camera inside `side` × the frame's half width, on ground steeper than
 *  `slope` (1 − normal.y) or on the rim above such ground, kept with probability `face` / `rim`, at `scale`,
 *  `huangshan` the share of 黄山松 (flat-topped, leaning); `box` [x0, z0, x1, z1] limits them to one place */
export const INK_CLIFF_PINES = {
  // ink01: pines on the tuff cliff under the 樓閣 and on the rocky slope below the camera
  1: { range: [10, 170], side: 1.2, cell: 4.5, slope: 0.36, face: 0.75, rim: 0.95, scale: 0.8, huangshan: 0.7, minY: 20 },
  // ink06: pines clinging to the palace mesa's cliffs below the walled terraces
  6: { range: [20, 420], side: 1.1, cell: 8, slope: 0.5, face: 0.45, rim: 0.65, scale: 0.85, huangshan: 0.6, minY: 8 },
};

/** framing trees of the ink cameras (src/vegetation/placement.js SHOT_HEROES: fwd / right in metres from the camera,
 *  facing = lean relative to the view), planted in the ink look */
export const INK_HEROES = {
  // ink04: tall dark trees on the 夕照山 shore fill the right third (in place of the pale far range behind)
  4: [
    { kind: 'camphor', at: [355, 1306], scale: 2.1 }, { kind: 'broad', at: [338, 1322], scale: 2.3 }, { kind: 'camphor', at: [320, 1310], scale: 2.4 },
    { kind: 'camphor', at: [303, 1326], scale: 2.2 }, { kind: 'broad', at: [287, 1310], scale: 2.4 }, { kind: 'camphor', at: [270, 1324], scale: 2.5 },
    { kind: 'camphor', at: [252, 1314], scale: 2.3 }, { kind: 'broad', at: [236, 1330], scale: 2.6 }, { kind: 'camphor', at: [220, 1318], scale: 2.4 },
    { kind: 'camphor', at: [205, 1334], scale: 2.6 }, { kind: 'camphor', at: [330, 1345], scale: 2.6 }, { kind: 'broad', at: [290, 1350], scale: 2.7 },
    { kind: 'camphor', at: [250, 1348], scale: 2.8 }, { kind: 'camphor', at: [215, 1352], scale: 2.8 },
  ],
  // ink01's pines on the rim of the tuff cliff are the layout's HERO_TREES for shot 1:
  //  the layout's trees for a shot replace these framing trees (src/vegetation/placement.js shotHeroes)
};

/** the ink stage (what only an ink still enlarges, moves, turns, hides or shows) lives in src/ink/stage.js (STAGE);
 *  INK_STAGE is kept as that table for the callers that still pass it */
export { STAGE as INK_STAGE } from './stage.js';
