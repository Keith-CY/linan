// Quality presets. Modules must scale their density/resolution with these numbers so the
// interactive preview stays usable on an integrated GPU while offline renders go all out.
export const QUALITY = {
  preview: {
    name: 'preview', spp: 1, msaa: 4,
    shadowMapSize: 2048, cascades: 3, shadowMaxFar: 1400, softShadows: false,
    terrainRes: 0.5,      // multiplier on terrain mesh resolution
    density: 0.45,        // vegetation / city / props instance density multiplier
    detail: 0.5,          // geometric detail multiplier (segments, sculpt resolution)
    cloudSteps: 16, bloom: true, ao: false,
  },
  // the explorable world (?mode=explore): one sample per frame at 30+ fps; the stills' world (density and detail as
  // 'high': a still view at a viewpoint is the offline still), shadows sized for walking (a 2048 map over two
  // cascades out to 500 m; the ink stills do not change with the shadow settings), no bloom in the live frame. MSAA
  // only for the still view's photographic pass (the live frame's tone is the G-buffer's colour attachment).
  explore: {
    name: 'explore', spp: 1, msaa: 4,
    shadowMapSize: 2048, cascades: 2, shadowMaxFar: 500, softShadows: false,
    terrainRes: 0.5, density: 1.0, detail: 1.0,
    cloudSteps: 12, bloom: false, ao: false,
  },
  high: {
    name: 'high', spp: 12, msaa: 4,
    shadowMapSize: 4096, cascades: 4, shadowMaxFar: 2400, softShadows: true,
    terrainRes: 1.0, density: 1.0, detail: 1.0,
    cloudSteps: 32, bloom: true, ao: true,
  },
  ultra: {
    name: 'ultra', spp: 48, msaa: 4,
    shadowMapSize: 4096, cascades: 4, shadowMaxFar: 3200, softShadows: true,
    terrainRes: 1.0, density: 1.0, detail: 1.0,
    cloudSteps: 64, bloom: true, ao: true,
  },
};

export function getQuality(name) { return { ...(QUALITY[name] || QUALITY.preview) }; }
