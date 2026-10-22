# Roadmap: known gaps and next steps

What is still rough, roughly in order of how much it matters. Measurements are from an Apple M1 Max (32-core GPU,
64 GB unified memory) in Chrome; on other hardware expect different numbers.

## Performance of the explorable world

- **Memory.** The JS heap is ~3.6 GB right after the world loads and grows to ~4.8 GB in a long session. Chrome's
  per-tab limit there is ~4.4 GB, so a long walk can crash the tab. This has to come down before the world can be
  hosted for the public; the resident vegetation pages, terrain leaves and the still view's resources are the first
  places to look.
- **Vegetation hitches.** The instanced vegetation is re-bucketed around the walker every ~90 m (a 90–125 ms hitch)
  and once more on leaving a viewpoint's still view (~200 ms). Spreading the re-bucket over several frames or moving
  it to a worker would hide it.
- **Frame rate.** Walking is slowest at the palace (皇城, ~24 fps measured under load) and on 御街 (~31 fps), where
  many buildings sit inside the full-detail band. The adaptive render scale drops to 0.55–0.9 of the window when
  frames run slow. Cheaper middle building levels and fewer shadow casters there are the obvious next steps.
- **Load time.** About 24 s on the development machine before the first frame. Without the baked rock and karst
  meshes (`node tools/bake.mjs karst`, `node tools/bake.mjs rocks`) the 飞来峰 cliff and the rock sites are meshed
  at load, which adds about a minute.
- **The painter.** The ink painter is one long full-screen pass (~10 ms at 1440 × 900). Splitting the washes to half
  resolution would help weaker GPUs.

## The explorable world

- Ground-level views away from the ten viewpoints are sparse: 御街 is an empty street, the paddies a blank plain.
- Water ripple strokes still use the walking eye's grazing angle rather than a world-anchored pattern.
- 望山桥 and 断桥 lie along their causeways in the explorable world; their art-directed axes apply to the shot
  cameras only.
- The photographic look (`?look=photo`) runs in the explorable world but is not tuned for it.
- Phones: the interface has touch controls, but the memory use above is far beyond what phone browsers allow.

## The ten views against the ink targets

At each viewpoint the explorable world's still view matches the offline ink stills closely. Against the ink targets
(`refs/inkNN.jpg`) these differences remain:

- **9 (六和塔 · 钱塘潮):** the painted bore is a breaking wall but thinner (~1/8 of the frame height against ~1/5)
  and paler than the target.
- **3 (曲院风荷):** the lotus blooms are smaller than the target's; 葛岭 dominates the background.
- **6 (皇城):** the terrace walls read as plain white blocks; a hill rises behind the palace where the target has open
  sky; walking off the viewpoint lands at the foot of the big wall.
- **7 (御街):** the roofs are still a fairly regular grid.
- **1 (西湖全景):** the 樓閣 is broader than the target's slender tower (a different building type).
- **4 (雷峰夕照):** the stairs and the boat are small at the bottom of the frame.
- **10 (断桥残雪):** the target has a 重檐攒尖 pavilion, the photographic reference a 重檐歇山 one; the world follows
  the reference.

## Offline stills and video

- Shadow cascades redraw the near geometry four times and the water reflection redraws the scene, so shots 2 and 8 run
  slightly over the 30 M triangle budget at high quality. A lower-detail shadow / reflection proxy for terrain and
  karst, or a reflection layer mask without grass, rocks and litter, would fix it.
- The terrain sets are built for the ten shot cameras; a video camera that travels far from its shot gets the nearest
  shot's set, which is coarse away from it.
- The showcase sequence (`src/video/sequence.js`) is short; a longer offline tour needs more segments.
- Close-up wear: the buildings are still a little clean and the 三潭 stone too uniform; peach blossom reads as pink
  card clumps very close to the camera; valley mist between hill layers is modest.
