// Per-shot LOOK: light, season, sky, haze and grade, kept separate from camera framing (shots.js).
// Keys per shot id:
//   season 'spring' | 'summer' | 'autumn' | 'winter'   → engine.registry.season (vegetation, snow, water ice react)
//   night  true | false                                → engine.registry.night (lanterns, windows, moon instead of sun)
//   sun {azimuth, elevation, color?, intensity?}, grade {...GRADE uniforms (core/pipeline.js)},
//   atmo {...ATMO uniforms (core/atmosphere.js)}, sky {...SKY uniforms (core/sky.js)}, envIntensity,
//   mist {...MIST uniforms (modules/mist.js)}, water {...water surface uniforms (modules/water.js)}
// Merge order in engine.applyShot: defaults → LOOKS[id] → explicit overrides on the shot object. season / night /
// mist / water are applied by src/world/index.js and the water / mist modules (engine.js merges sun/grade/atmo/sky).
//
// The sun is art-directed RELATIVE TO THE CAMERA HEADING (so it survives camera changes in shots.js):
//   sunRel(id, dAz, el): dAz < 0 = light from the left of frame (-90 pure side light, ±180 from behind).
//   diskRel(id, dAz, el): where the visible sun / moon disk sits when it differs from the light direction.
// (helpers from Athenaion's looks.js). docs/ART_BIBLE.md explains every number; docs/COMPOSITION.md the directions.
import { SHOTS } from './shots.js';
import { dirFromAzEl } from './layout.js';

function heading(id) {
  const s = SHOTS.find((x) => x.id === id);
  if (!s) return 0;
  const dx = s.target[0] - s.pos[0], dz = s.target[2] - s.pos[2];
  return ((Math.atan2(dx, -dz) * 180) / Math.PI + 360) % 360;
}
export const sunRel = (id, dAz, el, extra = {}) => ({ azimuth: (heading(id) + dAz + 720) % 360, elevation: el, ...extra });
export const diskRel = (id, dAz, el) => ({ uSunDiskMode: 1, uSunDiskDir: dirFromAzEl((heading(id) + dAz + 720) % 360, el) });
// auto-levels targets = the reference's own sRGB luminance percentiles (p02, p10, p50, p90, p98)
export const LV = (p02, p10, p50, p90, p98) => ({ uAutoLevels: 1.0, uLevelTarget: [p02, p10, p50, p90, p98] });

// ---------------------------------------------------------------- presets
// Spring dawn on West Lake: low sun, milky haze, layered blue-grey hills, a pale sky almost white at the horizon,
// the lake a silver mirror with mist lying on it (refs 1, 2).
const DAWN_SKY = { uZenith: [0.62, 0.68, 0.8], uSkyFalloff: 1.5, uCloudCover: 0.0, uCirrus: [0.0, 7500, 0.4], uSkyAureole: [2.2, 1.6, 4.0] };
const DAWN_ATMO = {
  uHaze: [0.00009, 900, 0], uHazeFar: [1.1, 14000], uHazeLow: [0.00016, 160],
  uHazeColor: [1.9, 1.88, 1.9], uMist: [0.0009, 9, 0], uMistColor: [1.8, 1.78, 1.76], uMie: [0.72, 1.3, 1.2],
};
// Summer afternoon: clear blue sky with fair-weather cumulus, crisp air, saturated greens (ref 3)
const NOON_SKY = { uZenith: [0.16, 0.3, 0.62], uSkyFalloff: 4.0, uCloudCover: 0.22, uCloudBase: 1800, uCloudThick: 500, uCirrus: [0.2, 7500, 0.5] };
const NOON_ATMO = { uHaze: [0.00004, 1200, 0], uHazeFar: [0.45, 15000], uHazeLow: [0.00004, 300], uHazeColor: [1.3, 1.5, 1.85], uMist: [0.0, 10, 0], uMie: [0.76, 0.5, 0.6] };
// Evening: warm low sun in frame, dust and haze glowing, silhouettes (ref 4)
const SUNSET_SKY = { uZenith: [0.42, 0.42, 0.5], uSkyFalloff: 1.3, uCloudCover: 0.08, uCirrus: [0.35, 7500, 0.3], uSkyAureole: [3.0, 2.2, 6.0] };
const SUNSET_ATMO = { uHaze: [0.00012, 800, 0], uHazeFar: [1.2, 12000], uHazeLow: [0.0001, 200], uHazeColor: [1.5, 1.2, 0.95], uMist: [0.0003, 10, 0], uMistColor: [1.6, 1.3, 1.0], uMie: [0.8, 2.2, 1.6] };
// Moonlit night: deep blue sky, a low full moon, lantern light (ref 5). The engine "sun" is the moon.
const NIGHT_SKY = { uZenith: [0.006, 0.012, 0.035], uSkyFalloff: 2.0, uCloudCover: 0.0, uCirrus: [0.0, 7500, 0.4], uSkyAureole: [0.4, 0.5, 3.0], uSunDisk: 900, uSunSize: 0.0047 };
const NIGHT_ATMO = { uHaze: [0.00006, 900, 0], uHazeFar: [0.6, 12000], uHazeLow: [0.00008, 150], uHazeColor: [0.02, 0.035, 0.08], uMist: [0.0002, 8, 0], uMistColor: [0.03, 0.045, 0.09], uMie: [0.75, 0.6, 0.6] };
// Autumn morning in the 灵隐 valley: sun through leaves, light shafts, warm haze (ref 8)
const AUTUMN_SKY = { uZenith: [0.4, 0.5, 0.66], uSkyFalloff: 2.0, uCloudCover: 0.05, uCirrus: [0.1, 7500, 0.4] };
const AUTUMN_ATMO = { uHaze: [0.0002, 400, 0], uHazeFar: [0.8, 9000], uHazeLow: [0.0004, 60], uHazeColor: [1.7, 1.55, 1.35], uMist: [0.0006, 12, 20], uMistColor: [1.6, 1.45, 1.25], uMie: [0.82, 1.8, 1.6] };
// Clear winter day after snow: pale blue sky, clean air, cold shadows (ref 10)
const WINTER_SKY = { uZenith: [0.36, 0.48, 0.72], uSkyFalloff: 2.6, uCloudCover: 0.04, uCirrus: [0.15, 7500, 0.5] };
const WINTER_ATMO = { uHaze: [0.00004, 1200, 0], uHazeFar: [0.5, 16000], uHazeLow: [0.00005, 250], uHazeColor: [1.5, 1.65, 1.9], uMist: [0.0, 10, 0], uMie: [0.74, 0.6, 0.6] };

// The grade now tone-maps with Khronos neutral (core/pipeline.js), which keeps the hue of lit
// surfaces and skies that AgX bleached to grey; saturation is therefore set lower per shot (refs' colourfulness 21-36).
// Each shot below records ref vs render (preview) numbers from a stats script: colourfulness (Hasler-Süsstrunk)
// and mean warmth (yb = (R+G)/2 - B).
export const LOOKS = {
  // 1 西湖全景 · 春晨: low dawn sun from the left (east), milky haze, layered hills fading into the morning mist.
  // blue-grey hill layers (haze colour cooler), the dawn warmth only in the sky toward the sun (uSkyHorizon + glow)
  1: {
    season: 'spring', night: false,
    sun: sunRel(1, -88, 9, { color: [1.0, 0.84, 0.66] }),
    sky: { ...DAWN_SKY, uZenith: [0.6, 0.66, 0.76], uSkyHorizon: [1.12, 1.06, 0.98], uSkyGlow: [1.2, 0.9, 0.55, 3], uSkyGlowAz: 0.9 },
    atmo: { ...DAWN_ATMO, uHazeColor: [1.7, 1.8, 1.98] },
    mist: { uLmAmount: 1.0 },
    grade: { ...LV(9, 26, 141, 228, 242), uSaturation: 0.9, uVibrance: 0.0, uWhiteBalance: [1.0, 1.0, 0.98], uContrast: 1.2, uVignette: [0.1, 0.85] },
  },
  // 2 苏堤春晓: soft dawn light from the right-front through mist; a thin, translucent high overcast (soft grey
  // mottling, not cut-out cumulus) instead of a flat grey sky; willow / peach chroma pulled down to the ref's muted spring
  2: {
    season: 'spring', night: false,
    // a weaker sun through the dawn overcast and more sky light: soft willow shade on the ground
    // beside the path instead of dark dappling (ref02)
    sun: sunRel(2, 95, 7, { color: [1.0, 0.86, 0.72], intensity: 1.2 }),
    envIntensity: 1.4,
    shadowRange: 900,   // casters beyond 900 m add no visible shadow here (cost)
    sky: {
      ...DAWN_SKY, uZenith: [0.45, 0.5, 0.6], uSkyFalloff: 1.1,
      uCloudCover: 0.75, uCloudBase: 2600, uCloudThick: 500, uCloudSigma: 0.0028, uCloudScale: 4.0, uCloudBright: 2.2, uCloudErode: 0.6, uCloudAmbient: 2.4,
    },
    atmo: { ...DAWN_ATMO, uHaze: [0.00016, 700, 0], uHazeLow: [0.0004, 120] },
    mist: { uLmAmount: 0.7 },
    grade: {
      ...LV(2, 22, 127, 223, 233), uSaturation: 0.72, uVibrance: 0.0, uWhiteBalance: [1.02, 1.0, 0.97], uContrast: 1.15, uVignette: [0.15, 0.8],
      uHueSat: [0.72, 0.95, 0.8, 0.62, 0.75, 1.1, 0.9, 0.6], uHueLum: [0, 0, -0.03, -0.1, -0.1, 0, 0, 0],
    },
  },
  // 3 曲院风荷: summer early afternoon, sun high behind-right of the camera, blue sky, white cumulus.
  // bigger, softer cumulus at the top left (as in the ref), a paler horizon, cooler white balance (ref yb 1)
  3: {
    season: 'summer', night: false,
    sun: sunRel(3, 170, 58),
    sky: { ...NOON_SKY, uZenith: [0.2, 0.33, 0.62], uSkyFalloff: 2.6, uCloudCover: 0.36, uCloudScale: 1.6, uCloudBase: 1600, uCloudThick: 700, uCirrus: [0.35, 7500, 0.5] },
    atmo: { ...NOON_ATMO },
    grade: { ...LV(3, 16, 82, 208, 221), uSaturation: 0.8, uVibrance: 0.0, uWhiteBalance: [0.94, 1.0, 1.08], uContrast: 1.3, uVignette: [0.12, 0.85] },
  },
  // 4 雷峰夕照: the evening sun just right of the pagoda, low; everything below the skyline in warm silhouette.
  // the forward-scattering haze (Mie 2.2 toward a sun in frame) veiled the whole frame grey (p02 50 vs the ref's 4):
  // thin haze, weak Mie glow, the warmth carried by a strong aureole around the sun (gradient from a gold-cream core to
  // greyer corners, as in the ref), a lower exposure so the sky sits below the shoulder; a softer sun (intensity 4: the
  // front-lit trees on the right no longer glow); hue-preserving tone map so the glitter path stays gold
  4: {
    season: 'summer', night: false,
    // a weaker direct sun and 2.6x sky fill so the faces toward the camera keep their detail in the
    // glow (ref04 is not a black silhouette); no lens rays (the ref has none), a warmer balance and the foliage's
    // yellow-green held down (it glowed when the sun lit it from behind)
    sun: sunRel(4, -2.5, 9, { color: [1.0, 0.78, 0.52], intensity: 3 }),
    envIntensity: 2.6,
    sky: { ...SUNSET_SKY, uZenith: [0.3, 0.31, 0.36], uSkyFalloff: 2.2, uSkyAureole: [2.2, 3.0, 8.0], uSkyHalo: [30, 3000], uCirrus: [0.7, 7500, 0.3] },
    atmo: { ...SUNSET_ATMO, uMie: [0.75, 0.35, 0.6], uHaze: [0.00005, 800, 0], uHazeFar: [0.6, 12000], uHazeColor: [0.78, 0.76, 0.74] },
    water: { uSunSpec: [0.35, 0], uSkyRefl: [1.0, 0.85, 0.66], uGlitter: [0.7, 0.3, 2.5, 0.01] },
    grade: {
      ...LV(4, 8, 57, 226, 241), uExposure: 0.55, uSaturation: 1.0, uVibrance: 0.1, uWhiteBalance: [1.08, 1.0, 0.84], uContrast: 1.35, uVignette: [0.2, 0.8],
      uLensGlare: 0.35, uLensRays: 0.0, uTmHue: 0.7, uBloom: 0.08,
      uHueSat: [1, 1, 0.6, 0.6, 1, 1, 1, 1], uHueLum: [0, 0, -0.12, -0.12, 0, 0, 0, 0],
    },
  },
  // 5 三潭印月 · 夜: a full moon low over the 吴山–凤凰山 ridge, centre of frame; lanterns inside the stone pagodas.
  // a few stars, a faint moon corona, lower exposure; wider bloom for the lanterns (2200 K glow)
  5: {
    season: 'summer', night: true,
    sun: sunRel(5, -3, 6.5, { color: [0.62, 0.72, 1.0], intensity: 0.06 }),
    sky: { ...NIGHT_SKY, uZenith: [0.002, 0.007, 0.034], uSunSize: 0.009, uStars: [3, 0.012], uSkyHalo: [0.02, 800] }, // ART: the moon twice its real size (ref05)
    atmo: { ...NIGHT_ATMO, uHazeColor: [0.008, 0.02, 0.07], uMistColor: [0.012, 0.025, 0.07] },
    shadowRange: 500,    // moon shadows only near the lanterns and the hall (cost)
    envIntensity: 1.0,   // a little more moonlit sky on the stone (was 0.6)
    grade: {
      ...LV(1, 6, 25, 45, 65), uSaturation: 2.0, uVibrance: 0.4, uWhiteBalance: [0.62, 0.85, 1.5], uContrast: 1.1, uVignette: [0.25, 0.75], uAutoExpo: 0.0,
      uExposure: 0.1, uLensGlare: 0.3, uBloom: 0.14, uBloomClamp: 400, uTmHue: 0.6,
    },
  },
  // 6 南宋皇城: summer morning, sun low from the left (east), soft haze over the river, cloud shadows on the ground.
  // warm morning sun and a warm glow low in the sky toward it; fewer cirrus streaks; paler zenith
  6: {
    season: 'summer', night: false,
    // the sun low from behind-left (ART az ~40°) lights the main hall's front under its deep eaves
    // as in ref06 (from the east it raked past the front and left it black); more sky fill
    sun: sunRel(6, -130, 16, { color: [1.0, 0.85, 0.68] }),
    envIntensity: 1.5,
    sky: { ...NOON_SKY, uZenith: [0.32, 0.44, 0.68], uSkyFalloff: 2.0, uCloudCover: 0.1, uCirrus: [0.12, 7500, 0.5], uSkyGlow: [0.9, 0.7, 0.45, 4], uSkyGlowAz: 0.85, uSkyAureole: [1.5, 1.2, 4.0] },
    atmo: { ...NOON_ATMO, uHaze: [0.00008, 900, 0], uHazeFar: [1.0, 12000], uHazeColor: [1.8, 1.78, 1.8] },
    grade: { ...LV(4, 11, 68, 223, 231), uSaturation: 0.8, uVibrance: 0.0, uWhiteBalance: [1.0, 1.0, 0.99], uContrast: 1.3, uVignette: [0.12, 0.85] },
  },
  // 7 临安城 · 御街: early spring morning, sun low from the left-front, haze and cooking smoke over the roofs.
  // the near haze (uHazeLow 0.00025) greyed the whole roof field (p02 24 vs 6): thin near haze, a steep far term
  // (OD 0.3 at 2 km, 1.2 at 4 km) so the city melts into bright cream haze in the top third; sun raised 14° → 24°
  7: {
    season: 'spring', night: false,
    // the sun swung toward the street's axis and raised (36°) so 御街 lies in the sun and the street
    // fronts of the left row are lit, as in ref07
    sun: sunRel(7, -40, 36, { color: [1.0, 0.88, 0.74] }),
    sky: { ...DAWN_SKY, uEnvBlue: 0.3, uEnvSat: 0.85 },
    atmo: { ...DAWN_ATMO, uHaze: [0.00003, 900, 0], uHazeLow: [0.00004, 120], uHazeFar: [1.7, 4200], uMie: [0.72, 0.9, 0.8], uHazeColor: [1.9, 1.84, 1.76] },
    grade: {
      ...LV(6, 16, 76, 225, 243), uSaturation: 1.3, uVibrance: 0.1, uWhiteBalance: [1.04, 1.0, 0.93], uShadowTint: [-0.006, 0.0, 0.012], uContrast: 1.25, uVignette: [0.12, 0.85],
    },
  },
  // 8 飞来峰 · 灵隐 · 秋: autumn late morning, sun high in front-right over the cliff, shafts through the canopy.
  // the frame shows far more sky than ref08 (where canopy hides it), so the ref's percentiles put the sky in the
  // mid-tones: own targets (bright sky p90-p98), lower exposure so the sky has a gradient, a broad warm aureole
  8: {
    season: 'autumn', night: false,
    // ART: the light comes from the upper left as in ref08 (the 布袋's face and the temple roofs lit,
    // the cliff face raking); a northern sun is impossible at Hangzhou, the picture wins
    sun: sunRel(8, -100, 38, { color: [1.0, 0.88, 0.72] }),
    shadowRange: 600,   // casters beyond 600 m add no visible shadow here (cost)
    sky: { ...AUTUMN_SKY, uZenith: [0.4, 0.45, 0.55], uSkyFalloff: 1.6, uSkyAureole: [9.0, 3.0, 4.0] },
    atmo: { ...AUTUMN_ATMO, uHazeColor: [1.5, 1.4, 1.25], uHaze: [0.00025, 400, 0], uMie: [0.8, 1.2, 1.4] },
    grade: {
      ...LV(3, 13, 50, 165, 240), uExposure: 0.45, uSaturation: 0.62, uVibrance: 0.1, uWhiteBalance: [0.98, 1.0, 1.0], uContrast: 1.3, uVignette: [0.2, 0.8],
    },
  },
  // 9 六和塔 · 钱塘潮: late morning in the tide season, sun high from the left-front, big cumulus over the estuary.
  // a cumulus mass behind the pagoda (larger, taller clouds), fewer cirrus streaks, bluer zenith
  9: {
    season: 'summer', night: false,
    // ART: the sun behind-left so the pagoda's faces toward the camera are lit as in ref09 (from the
    // front-left it rendered black against the sky)
    sun: sunRel(9, -105, 34),
    sky: { ...NOON_SKY, uCloudCover: 0.42, uCloudScale: 2.0, uCloudBase: 1400, uCloudThick: 1800, uCirrus: [0.1, 7500, 0.5], uZenith: [0.14, 0.3, 0.68], uSkyFalloff: 3.0 },
    atmo: { ...NOON_ATMO, uHazeFar: [0.9, 12000], uHazeColor: [1.55, 1.65, 1.85] },
    grade: { ...LV(8, 19, 146, 193, 219), uSaturation: 1.08, uVibrance: 0.0, uContrast: 1.2, uVignette: [0.12, 0.85] },
  },
  // 10 断桥残雪 · 冬: clear winter midday after snow, sun from the left-behind, pale blue sky, thin ice at the edge.
  // a paler, clear sky (no cumulus, few streaks), cooler balance and blue shadows, bluer frosted ice
  10: {
    season: 'winter', night: false,
    sun: sunRel(10, -150, 30),
    sky: { ...WINTER_SKY, uZenith: [0.55, 0.65, 0.84], uSkyFalloff: 1.8, uCirrus: [0.06, 7500, 0.5], uCloudCover: 0.0, uEnvBlue: 0.35 },
    atmo: { ...WINTER_ATMO, uHazeColor: [1.65, 1.78, 1.98], uHazeFar: [0.9, 16000] },   // the far snowy range sits in blue air
    water: { uIceCol: [0.52, 0.65, 0.9] },
    grade: {
      ...LV(17, 54, 156, 225, 231), uSaturation: 1.0, uVibrance: 0.0, uWhiteBalance: [0.96, 1.0, 1.05], uShadowTint: [-0.01, 0.0, 0.02], uHighTint: [0.006, 0.004, 0.0],
      uContrast: 1.15, uVignette: [0.1, 0.85],
    },
  },
};

/** season / night of a shot (for modules that build per-season content) */
export function lookOf(id) { return LOOKS[id] || {}; }
