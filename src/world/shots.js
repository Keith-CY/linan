// Camera shots. fov = vertical field of view in degrees. Framing only: lighting, season and grading per
// shot live in src/world/looks.js. `ref` = the reference image the shot is matched against (tools/render.mjs writes
// a side-by-side out/shot<N>_cmp.png). dof = { focus: m, aperture: m } (accumulated thin-lens depth of field).
// Pure data: imported by node tools too (no three.js import here).
//
// Every camera was fitted to its reference (docs/COMPOSITION.md: landmarks, screen positions, what is off and why).
// Keys in the interactive viewer: 1-9 = shots 1-9, 0 = shot 10.
export const SHOTS = [
  {
    id: 1, name: '西湖全景 · 春晨 (panorama from 宝石山, spring dawn)',
    ref: 'refs/ref01.jpg',
    pos: [276.4, 93, -2246], target: [269.8, 90, -2146.3], fov: 20,
  },
  {
    id: 2, name: '苏堤春晓 (on the Su causeway, looking north through the pavilion)',
    ref: 'refs/ref02.jpg',
    // 9 m further back with a longer lens (46° → 31°): the ref's pavilion is drawn with little perspective
    // (eave corners at the height of the column heads); at 14 m the near corners towered over the roof
    pos: [-411.2, 2.5, 316.4], target: [-435.2, 23.3, 212.3], fov: 31,
    dof: { focus: 23.5, aperture: 0.03 }, // focus on the pavilion (raycast 14-16 m); the near willow / peach go soft
  },
  {
    id: 3, name: '曲院风荷 · 夏 (lotus pond, the 水榭 and 保俶塔 across the lake)',
    ref: 'refs/ref03.jpg',
    pos: [-926, 2.0, -953], target: [-859.6, 2.4, -1027.8], fov: 19,
    dof: { focus: 98, aperture: 0.035 }, // focus on the 水榭 (raycast 95-104 m); the front lotus a touch soft
  },
  {
    id: 4, name: '雷峰夕照 (雷峰塔 against the evening sun, from the lake)',
    ref: 'refs/ref04.jpg',
    pos: [584.7, 2.2, 1189.5], target: [509.2, 12.8, 1254.2], fov: 19.6,
  },
  {
    id: 5, name: '三潭印月 · 夜 (the stone lanterns under a full moon)',
    ref: 'refs/ref05.jpg',
    pos: [125, 1.6, 720], target: [203.8, 3.1, 781.6], fov: 30,
  },
  {
    id: 6, name: '南宋皇城 · 凤凰山 (the palace on the hill, the Qiantang beyond)',
    ref: 'refs/ref06.jpg',
    pos: [1690, 70, 2140], target: [1707.4, 68.3, 2238.5], fov: 38,
  },
  {
    id: 7, name: '临安城 · 御街鸟瞰 (above the imperial way, looking south)',
    ref: 'refs/ref07.jpg',
    pos: [2416, 75.4, -916.2], target: [2422.5, 51, -819.4], fov: 37.6,
  },
  {
    id: 8, name: '飞来峰 · 灵隐 · 秋 (the 布袋弥勒 cliff and the temple across 冷泉)',
    ref: 'refs/ref08.jpg',
    pos: [-3978, 28.2, 439], target: [-3880.2, 49.0, 441.4], fov: 45,
  },
  {
    id: 9, name: '六和塔 · 钱塘潮 (六和塔 on 月轮山, the tidal bore on the Qiantang)',
    ref: 'refs/ref09.jpg',
    pos: [-1648, 59, 4838], target: [-1551.7, 60.2, 4864.8], fov: 42.3, // 3.4 m higher, over the slope's low tree tops (ref09 looks over a canopy)
  },
  {
    id: 10, name: '断桥残雪 · 冬 (断桥 after snow, 宝石山 behind)',
    ref: 'refs/ref10.jpg',
    pos: [687.5, 5, -1635.4], target: [615.3, 7.5, -1704.5], fov: 37.3,
  },
];
