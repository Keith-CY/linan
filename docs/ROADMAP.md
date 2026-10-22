# Roadmap: known gaps and next steps

What is still rough, roughly in order of how much it matters. Measurements are from an Apple M1 Max (32-core GPU,
64 GB unified memory) in Chrome; on other hardware expect different numbers.

## Performance of the explorable world

Measured on the development machine in October 2026 while other work kept it heavily loaded (load averages 30–200);
the figures in brackets are from the code before that month's performance work, run alternately with it under the
same conditions.

- **Memory.** After the load the JS heap is ~0.54 GB (~80 MB of objects, ~0.46 GB of typed arrays) and it levels off at
  ~0.7 GB within six minutes of walking, running and flying through every viewpoint (`tools/explore-mem.mjs`; it was
  3.5 GB after the load and 4.0 GB after ten minutes). The buildings' meshes are welded into indexed geometry (38 M
  vertices → 16 M), identical buildings share one, and the static geometry lives on the GPU only: it is all uploaded at
  the start and its CPU copies dropped (terrain patches and lazily loaded bakes the same once drawn). The GPU holds
  ~1.5 GB of buffers after the load and ~2.1 GB after ten minutes (1.5 → 3.1 GB before), ~0.3 GB of textures while
  walking and ~0.7–1.0 GB while a still view is up (its targets are given back after 5 s of walking). The largest
  remaining CPU arrays are the vegetation's instance pages (~140 MB, both far sets included).
- **Hitches.** The far impostors are refilled in ~3 ms slices into a second set of pages (a 50–160 ms frame every
  90 m before); the near re-bucket is ≤ 13–21 ms (≤ 37 ms at the heaviest load), with the terrain-occlusion tests
  spread over frames. Leaving the still view costs 13–37 ms (60–120 ms), its plant re-bucket (250–520 ms) runs in
  slices while the view is prepared. The auto levels of the live painting are solved on the GPU: the read-back they
  replaced blocked the page 30–100 ms every 24 frames with vsync (300–700 ms without).
- **Frame rate.** With the default settings at 1440 × 900 walking runs at 33–35 fps at the palace (17–24 before) and
  27–28 on 御街 (19–34), on a GPU shared with other work; one live frame costs the GPU 21–33 ms at the ten places
  (`tools/explore-fps.mjs --cost`). Not yet measured on an idle machine against the 40 fps goal. The painter pass,
  the 2048² shadow cascades and the vegetation near the palace are the next costs to look at.
- **Load time.** 23–29 s to the first walking frame at moderate load (34–38 s before; 29–44 s against 41–68 s at load
  averages above 100). The water's height maps, the tree cover's candidates and the shots' hill cover's ground are
  computed in the height workers while the buildings build; identical buildings are built once; the rocks and the
  飞来峰 cliff load as compact bakes when the walker comes within 2.5–3 km (a still view waits for the full-detail
  bakes it reaches). The buildings themselves (~7 s) and the vegetation library and placement (~4 s) are the rest.
- **Download.** `node tools/build-site.mjs` writes a 45 MiB static site: the page and its modules 3.9 MiB, the compact
  bakes 41.5 MiB (the largest file 5.8 MiB); ~6 MB is fetched before the first frame.
- **The painter.** The ink painter is one long full-screen pass (~5–13 ms at 1440 × 900). Splitting the washes to half
  resolution would help weaker GPUs.

## The explorable world

- Ground-level views away from the ten viewpoints are sparse: 御街 is an empty street, the paddies a blank plain.
- Water ripple strokes still use the walking eye's grazing angle rather than a world-anchored pattern.
- 望山桥 and 断桥 lie along their causeways in the explorable world; their art-directed axes apply to the shot
  cameras only.
- The photographic look (`?look=photo`) runs in the explorable world but is not tuned for it.
- Phones: the interface has touch controls, but the GPU memory above (~2 GB of geometry) is beyond what phone browsers
  allow.

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
