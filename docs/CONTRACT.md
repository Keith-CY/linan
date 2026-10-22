# Engineering contract

How the code is organised and the rules every module follows. Zero-build ES modules + three.js r186 (import map in
`index.html`), headless GPU rendering through `tools/render.mjs` (Chrome with a throwaway profile, ANGLE / Metal; it
was developed on an Apple M1 Max). Adapted from Athenaion's contract (MIT; see `NOTICE`). The look is in
`docs/ART_BIBLE.md`, the cameras and the world plan in `docs/COMPOSITION.md`, the known gaps in `docs/ROADMAP.md`.

Zero external assets: no downloaded models, scans, textures, HDRIs or fonts. Everything is generated in code. The
reference images in `refs/` are only compared against, never loaded by the world.

## Running things

- Install once: `npm install` (three, puppeteer-core, pngjs). ffmpeg must be on the PATH for the compare images,
  contact sheets and video.
- The explorable world (the default page): `node tools/serve.mjs [port]` → http://localhost:8080/ (= `?mode=explore`):
  walk / fly in real time, ink 纯水墨 by default (`?look=photo` for the photographic render). Code in `src/explore/`
  (streamed terrain in workers, walker, interface, tree cover, countryside and hamlets for ground no shot looked at).
  Modules see `engine.explore === true` and must not assume the shot cameras there: LOD from the moving camera
  (`engine.registry.lodSwitch`, `registry.city.houseLod`, VegSystem far pages), no per-shot terrain or occlusion.
  Headless checks: `node tools/explore-session.mjs --port 9480 [--mobile]`, then `/eval`, `/shot` (see the file);
  `tools/explore-fps.mjs`, `tools/explore-walk.mjs` and `tools/explore-match.mjs` talk to that session.
- Interactive shot viewer: http://localhost:8080/?shot=3 (keys 1–9 = shots 1–9, 0 = shot 10, P prints the camera).
- Render a shot of the full world: `node tools/render.mjs --shot 3 --quality preview` → `out/shot3.png` and
  `out/shot3_cmp.png` (reference | render, both 540 px high). Shots are 1–10; `--shot all` builds the world once and
  renders all ten. `--quality high --spp 12` (or `ultra`) for the final look; `--w 3840 --h 2160` for 4K.
  Ink stills: `--params "look=ink&inkStyle=mo"` (`qj` 浅绛 and `ql` 青绿 are the other styles).
- Render a module alone: `node tools/render.mjs --test <module> --view <n> [--params "..."]`
  → `out/test_<module>_v<n>.png`. A module's `test(engine)` sets up the content and returns the views.
- Build only some modules: `--params "only=terrain,water,yingzao"` or `--params "skip=vegetation"`.
- Framing check with grey massing for every building, pagoda, bridge and boat in `layout.js`: `--params "proxies=1"`.
- Force a season / night for a test: `--params "season=winter&night=1"` (otherwise they come from the shot's look).
- Pass a distinct `--out out/<name>/<what>.png` when several renders run at once.
- Zoom: `node tools/crop.mjs --cmp <shot> x y w h` (ref vs render, same region). Colour: `node tools/colorstats.mjs
  <shot>` and `node tools/sample.mjs img x,y,label ...`. Building silhouettes against a reference:
  `node tools/arch-overlay.mjs --shot N --ids <layout ids>`.
- render.mjs prints the page logs: read them and fix every error or warning a change causes.
- Renders take a slot of a 4-slot GPU lock (`out/.gpu.lock.N`, `GPU_SLOTS` to change); a render may wait.
- Persistent session (build the world once, then render camera / look variants in a few seconds):
  `node tools/session.mjs --port <port> &` then
  `node tools/snap.mjs --port <p> --shot 3 [--set '{"fov":38,"pos":[..],"target":[..]}'] --out out/<name>/x.png`
  (`--reload` picks up code changes, `--quit` when done; it holds a GPU slot and exits after 15 min idle). The session
  builds the world for shot 1's season; season-specific content must switch in `onShot`.

## Module contract

Each world module lives in `src/modules/<name>.js` and exports:
```js
export async function build(engine) { ... }   // populate the FULL world from src/world/layout.js
export async function test(engine) { ...; return { views: [{ pos, target, fov, sun? }] } } // isolated scene
```
`src/world/index.js` runs the modules in `MODULE_ORDER` (terrain → water → yingzao → pagodas → karst → rocks →
bridges → city → boats → tide → vegetation → mist). A throw is caught and logged (the rest still builds); a module
whose file does not exist is skipped. A new module gets a line in `MODULE_ORDER`. Reusable generators live in their
own folder (`src/yingzao/`, `src/vegetation/`, `src/karst/`, `src/city/` …).

Engine API (`src/core/engine.js`): `engine.scene`, `engine.camera`, `engine.renderer`, `engine.quality`
(preview / high / ultra / explore: scale work with `.density`, `.detail`, `.terrainRes`), `engine.add(obj,
{castShadow, receiveShadow})`, `engine.onUpdate((t, dt) => …)` (deterministic time), `engine.rng(label)` (seeded RNG),
`engine.footprints` (occupancy: `addCircle` / `addRect` / `isFree`; architecture registers first, vegetation queries),
`engine.slots` (anchor points), `engine.onShot(fn(shot))` (called on every `applyShot`, after sun / sky / grade),
`engine.registry` (shared data):

| registry key | set by | meaning |
|---|---|---|
| `season` | world/index.js | `'spring' \| 'summer' \| 'autumn' \| 'winter'` of the current shot (set before any module builds, updated before module `onShot` hooks) |
| `night` | world/index.js | `true` for shot 5: lanterns lit, windows warm, moon instead of sun |
| `terrain` | terrain | `{ root, material, leaves }` |
| `water` | water | `{ level, maps, regions, ground, depthAt(x,z), uniforms, reflection, … }` (`reflection.hidden` = meshes kept out of the mirror) |
| `buildings`, `pagodas` | yingzao, pagodas | lists of `{ id, kind, group, info }` |
| `vegetation` | vegetation | counts and groups |
| `mist` | mist | `{ group, uniforms }` |
| `tide` | tide | `{ group, frontAt(t), BORE }` (the 钱塘潮 bore, shot 9) |
| `karst`, `city` | karst / rocks, city | `{ feilai, rocks, materials }`; `{ treeSpots, plan, houses, … }` |

Terrain: `import { heightAt, groundAt, normalAt, slopeAt, waterSDF, isWater, lakeSDF } from '../world/heightfield.js'`.
Layout: `import * as L from '../world/layout.js'` — every position in the world (lake, causeways, islands, hills,
river, city, palace, 灵隐, 六和塔, `HALLS`, `PAGODAS`, `BRIDGES`, `BOATS`, `PLANTS`, `CLEARINGS`, `HERO_TREES`,
`TERRACES`, `ISLETS`), helpers `geo(lat, lon)`, `toGeo`, `polyPoint`, `polyLength`, `bearingOf`, `dirFromAzEl`,
`headingToRotY(compassDeg)` (for objects whose local front is +Z) and `forShot(id)`. Compass: −Z north, +X east, +Y up,
y = 0 is the lake surface, units metres. Looks: `import { LOOKS, lookOf } from '../world/looks.js'` (season, night, sun,
sky, haze, grade per shot).

Layout entries are data. A building is `{ id, kind, center, facing, level, y?, params, shot, … }`: `kind` is a builder
or preset of the architecture module, `level` the ground under it (terraces and pads in the heightfield make it flat),
`y` only for buildings in the water. Entries marked `// fit` were solved against a camera: move them only together
with that camera. Where a reference needs something the real place cannot give, the change is marked `ART:`.

## Materials and shading

- Use `proceduralMaterial()` from `src/core/materials.js` (MeshStandard / MeshPhysical + world-space GLSL hooks:
  color / roughness / normal (`cgBump`) / emissive / ao; noise from `NOISE_GLSL`: `cgSnoise`, `cgFbm3`, `cgVoronoi2/3`,
  `cgHash*` …). Program cache keys are automatic.
- Every lit material gets atmosphere and cascaded shadows injected by `engine.prepareScene()` — do NOT call CSM yourself,
  do NOT set `scene.fog`.
- Custom `ShaderMaterial`: unlit by default. For atmosphere include `ATMO_GLSL` and `...atmoUniforms()` from
  `core/atmosphere.js` and call `atmoApply(col, worldPos)`; set `mesh.userData.noPatch = true` on meshes whose
  material you fully control. Transparent / non-terrain meshes that must not enter the water's height capture set
  `userData.noHeightCapture = true`.
- Shared material families live in `src/materials/<family>.js` (wood, tile, plaster, stone, common, misc); other
  modules import them rather than copying them.
- Lighting is linear HDR; tone mapping and grade happen in post (`src/core/pipeline.js`). The tone map is Khronos PBR
  neutral (`uToneMap: 2`; AgX bleached warm light toward grey) with a per-shot hue-preserving mix (`uTmHue`). Do not
  pre-tone-map colours. Albedos are realistic and linear: the ranges in `ART_BIBLE.md` §5 (plaster 0.65–0.78, tile
  0.06–0.10, red lacquer R 0.22–0.34, stone 0.2–0.6, foliage 0.03–0.20, snow 0.8–0.9).
- The ink look (`?look=ink`) adds G-buffer outputs to every scene material (`src/ink/gbuffer.js`); a material class
  (`CLS` there) decides how the painter draws a surface, so a new kind of surface may need a class.
- Season and night: read `engine.registry.season` / `.night`; switch in `engine.onShot` (a world built for one shot
  can render another). Snow, autumn colour, bare willows, lotus, lanterns all follow the registry.
- Canvas textures (banners, inscriptions, leaf atlases) are fine — drawn in code, ≤ 2048².

## Performance budget (offline stills, Apple M1 Max, 32-core GPU, unified memory)

| | preview | high | ultra |
|---|---|---|---|
| whole-world build | ≤ 45 s | ≤ 90 s | ≤ 120 s |
| one module's build | ≤ 10 s | ≤ 20 s | ≤ 25 s |
| triangles drawn in one frame | ≤ 15 M | ≤ 30 M | ≤ 40 M |
| draw calls in one frame | ≤ 2000 | ≤ 3000 | ≤ 3500 |
| one sample at 1664 × 928 | ≤ 1.5 s | ≤ 3 s | ≤ 4 s |
| GPU memory (textures + buffers) | ≤ 3 GB | ≤ 6 GB | ≤ 8 GB |

- Instancing (`InstancedMesh` / `BatchedMesh`) or merged geometry for anything repeated.
- The cameras are known (`src/world/shots.js`): spend detail where they look, near them, and nowhere else (LOD by
  distance from the shot cameras is expected; the terrain does it with a camera-driven quadtree).
- Scale counts and resolution with `engine.quality.density / detail`. Log build time and triangle count.
- Heavy procedural geometry may be baked: `loadOrBuild(name, fn)` (`src/core/cache.js`) + `src/bake/<name>.js` +
  `node tools/bake.mjs <name>` → `generated/*.bin` (git-ignored). Bump the name when the generator changes; the runtime
  falls back to building when the file is missing.
- Per-shot cost controls: the terrain is one quadtree **per shot** (only the current shot's set is shown; shared leaves
  meshed once); `engine.applyShot` drops shadow casters beyond the shadow range (`shadowMaxFar` × 1.1, or a look's
  `shadowRange`) and small far ones; `world/index.js` hides, per shot, every building, pagoda, bridge, boat, rock site
  and city block that the heightfield occludes from the camera (moved to layer 7; `?occlusion=0` turns it off). A
  module that toggles `visible` per shot keeps working; do not rely on `layers` of those objects.
- Measured at high (16 spp, 1664 × 928): world build ~54 s; 14–34 M triangles and 470–900 draw calls per sample
  (shots 2 and 8 slightly over 30 M); 0.8–1.7 s for all 16 samples. The 飞来峰 karst loads baked
  (`node tools/bake.mjs karst`) in 0.5 s; without the bake it meshes at load (~1 min).
- The explorable world's costs and known problems are in `docs/ROADMAP.md`.

## Determinism

- Same code → same image. Seeded RNG only (`engine.rng(label)`, `hash01(...)`, `mulberry32`); never `Math.random`,
  `Date`, `performance.now()` in anything that shapes the world (timing logs are fine).
- Animation reads the engine time (`onUpdate(t)`), never the wall clock.
- No network, no external files at runtime (the baked `generated/*.bin` are a cache of what the code builds).

## Working on a module

- Keep a module's reusable API at the top of its file and keep exported signatures backward-compatible.
- Never break the world build: run a full-world preview render of the shots a change touches (and the explorable
  world when it touches anything the walker sees) before committing.
- Note build ms and triangles for new geometry, and mark any new departure from the real geography with `ART:`.
