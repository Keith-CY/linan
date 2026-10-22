# 临安 · Art Bible

The look of the whole world, read off the ten photographic reference images (`refs/ref01.jpg` … `ref10.jpg`,
1664 × 928, AI-generated with Qwen-Image 2.1; the prompts are in `refs/shots.json`). Every module builds against this
page; the camera-by-camera plan is `docs/COMPOSITION.md`, the engineering rules `docs/CONTRACT.md`. The ink look
painted over the same world is §9.

**The bar for the photographic look: every frame passes as a real photograph** — not a game, not low-poly CG. Real scale, real materials, real
light, real air. When in doubt, ask "could a camera have taken this on West Lake in 1200?"

**Rule of thumb for the references:** match the reference's look and composition (where things sit, how big they
are, the colour and light). **For buildings the refs win on silhouette and ornament**: the outline, the curl of the
eaves and ridges, the number of eave tiers, the roof weight, the ridge-end ornaments and the colour under the eaves follow the reference; 《营造法式》 still
sets proportions and member sizes (材分, 鋪作, 舉折 as the base the curl is added to). Check every hero building with
`node tools/arch-overlay.mjs --shot N --ids <layout ids>` (our mask's outline on the ref, plus a crop triple). Where a
reference shows a Ming, Qing or modern *object* (a stone 牌樓, a Qing tower), build the Song kind of object in the
same place and at the same size (table at the end).

Tools: `node tools/colorstats.mjs <shot>` (ref vs render, per region + percentiles), `node tools/sample.mjs img x,y,label`,
and `node tools/crop.mjs --cmp <shot> x y w h`.

---

## 1. The look in one paragraph

Soft, humid South-China air. Light is low or filtered (dawn, late afternoon, evening, moon) in seven of ten shots;
noon only in ref03. The colour is restrained: grey-black tile, deep oxide-red timber, warm lime-white walls, grey stone,
green-black evergreens, and water that takes the colour of the sky. Saturation comes from a few accents only —
peach blossom, lotus pink, red maple, gold ginkgo, the evening sun — set against greys. Distance turns everything to
layered blue-grey (远山) with milky haze; the lake is a quiet mirror. Contrast is photographic: the darks are deep
(p02 ≈ 2–9 of 255) but the large areas sit in the mid-tones.

## 2. Exposure and contrast targets (measured on the references)

Tone mapping: **Khronos PBR neutral** (`uToneMap: 2` in `core/pipeline.js`), with `uTmHue` mixing in a
hue-preserving variant per shot (sunset and lantern light keep their gold). AgX was dropped: it bleached warm light and
bright skies toward grey. Saturation per shot is set lower to match (`looks.js`).

sRGB luminance percentiles of each reference (0–255) and mean saturation (HSV S). `looks.js` sets each shot's
auto-levels to exactly these (`LV(...)`); check renders with `node tools/colorstats.mjs <shot>`.

| shot | p02 | p10 | p50 | p90 | p98 | mean sat | character |
|---|---|---|---|---|---|---|---|
| 01 panorama · spring dawn | 9 | 26 | 141 | 228 | 242 | 0.21 | high-key, milky, low contrast in the distance, dark pines in front |
| 02 苏堤 · spring dawn | 2 | 22 | 127 | 223 | 233 | 0.24 | soft overcast-dawn, white-grey sky, dark red pavilion |
| 03 lotus · summer afternoon | 3 | 16 | 82 | 208 | 221 | 0.35 | the most saturated: blue sky, green lotus, red columns |
| 04 雷峰 · sunset | 5 | 9 | 58 | 226 | 241 | 0.26 | low-key silhouettes, one hot zone (sun + glitter path) |
| 05 三潭 · moonlit night | 1 | 6 | 25 | 45 | 65 | 0.68 | very dark, saturated navy blue, warm lantern points |
| 06 palace · summer morning | 4 | 11 | 68 | 223 | 231 | 0.23 | bright hazy sky, dark pine mass below, lit stone terraces |
| 07 city · spring morning | 6 | 16 | 76 | 225 | 243 | 0.28 | dark roof field, bright haze at the top third |
| 08 飞来峰 · autumn | 4 | 13 | 50 | 152 | 244 | 0.30 | low-key, shafts of light, red + gold accents |
| 09 六和塔 · afternoon | 8 | 19 | 146 | 193 | 219 | 0.21 | bright sky and water, compressed highlights (no clipping) |
| 10 断桥 · winter | 17 | 54 | 156 | 225 | 231 | 0.17 | the brightest and least saturated: snow, pale sky, blue ice |

## 3. Light and time of day per shot

World azimuths are compass bearings (0 = north, 90 = east). In `looks.js` the sun is set relative to the camera
heading (`sunRel(id, dAz, el)`), so the numbers survive camera changes; the absolute values for the fitted cameras are
listed here. Season and night go to `engine.registry.season` / `engine.registry.night` (other modules react).

| shot | season | time | sun / moon (world az / el) | from the camera | sky | air |
|---|---|---|---|---|---|---|
| 01 | spring | dawn, ~6:15 | 096° / 9° | from the left, slightly behind | white-cream at the horizon, pale grey-blue above, no clouds | thick milky haze; mist sheets on the lake; hills stepped in 4–5 value layers |
| 02 | spring | dawn | 082° / 7° | right-front, hidden by willows | flat white-grey | mist on the water; distance dissolves within 1–2 km |
| 03 | summer | early afternoon | 212° / 58° | high, behind-right | clean blue (zenith ≈ #acc3d5 in the ref after grade), white cumulus | clear; far shore still sharp |
| 04 | summer (late) | ~45 min before sunset | 227° / 9° (ART, see §8) | in frame, just right of the pagoda | warm cream-gold, cirrus | golden haze; sun glare and a glitter path on the water |
| 05 | summer | night, moonrise | moon 125° / 6.5° (disk 2× real) | in frame, centre-left, low over the ridge | deep navy (#17273f), a few stars | dark, very clear; the far shore only as silhouettes and lamp points |
| 06 | summer | morning ~8:00 | ~040° / 16° (ART: behind-left, lights the hall front) | from behind-left, low | pale white-blue, thin cirrus | haze over the river to a white horizon |
| 07 | spring | morning ~7:30 | ~136° / 36° (along 御街, street in sun) | left-front, high | white at the horizon | bright haze in the far third; cooking smoke |
| 08 | autumn | late morning | ~351° / 38° (ART: upper left as ref08; impossible in Hangzhou) | upper left, behind | barely seen through leaves | shafts through the canopy (volumetric), warm haze |
| 09 | summer (tide season) | morning | ~001° / 34° (ART: behind-left lights the pagoda) | behind-left | blue with big cumulus towers | clear but hazy at the water horizon |
| 10 | winter | late morning after snow | 164° / 30° | from the left, behind | pale clear blue (#d4dee8), almost no cloud | crisp, clean; snow on the far hills reads white-blue |

Light rules that apply everywhere:

* Sun intensity and colour follow the elevation (`core/lighting.js` `sunColorForElevation`); only shots 1, 2, 4, 7, 8
  tint it explicitly (warm dawn / evening). The moon (shot 5) is the engine sun at ~0.06 intensity, blue-white.
* Shadows are never black: open shade is lit by the sky (cool) and by warm bounce from tile and plaster.
* Lantern light (shot 5, and windows if `registry.night`): 2200–2600 K, small sources, bloom only on the source;
  reflected in the water as broken vertical streaks.

## 4. Air: haze, mist and aerial perspective

* **Layers.** The hills behind West Lake read as 3–5 flat value steps ("远山如黛"): nearest hills dark green-grey,
  each layer behind lighter and bluer until the last is barely darker than the sky. Measured in ref01: far hills
  ≈ #b8bec2 against a sky ≈ #ebe6de. Keep the steps — do not smear them into one gradient (that reads as fog).
* **Haze colour** follows the light: cream-white at dawn (01, 02, 07), white-blue in daytime (03, 06, 09), golden at
  sunset (04), blue-black at night (05), cold blue-white in winter (10).
* **Mist on the water** (01, 02, faint in 05): sheets 1–15 m thick lying on the lake, thinning near the camera and
  where land rises through them (`modules/mist.js`; a look turns it on with `mist: { uLmAmount }`).
* **Saturation falls with distance.** Near foliage is saturated green; at 2 km it is grey-green; past 5 km it is
  blue-grey with no hue of its own.
* **Smoke** rises over the city in ref07 (thin, from several roofs) — the city module adds it.

## 5. Palette per material

Display colours are measured on the graded references (sRGB, lit / shade, which ref). Albedos are **linear** base
colours for the materials (the renderer is linear HDR; tone mapping and grade happen in post): use these ranges,
then check the render against the display colours with the sample tools. Roughness is for PBR (0 mirror, 1 matte).

| material | display in the refs | linear albedo (R, G, B) | roughness | notes |
|---|---|---|---|---|
| **red lacquer** (丹 / 朱 columns, beams, window frames) | lit #834632 (02), #6b3c2d (02), shade #4e2d24 (06), deep shade #371e18 (06) | 0.22–0.34, 0.05–0.08, 0.03–0.05 | 0.5–0.7 | deep oxide red leaning orange, never pink or bright "Chinese red"; worn paler at hand height, darker at the base; dust on horizontals |
| **grey tile** (青灰 筒瓦 / 板瓦, ridges) | shade #434346 (06), warm lit #52473f (06), sun-lit #3a3434 (03), sky-lit sheen to #8f979e (03 at grazing) | 0.06–0.10, neutral to slightly blue (B ≥ R) | 0.55–0.7 | unglazed reduced clay; rows of round 筒瓦 must read at every distance (rhythm + AO); moss and lichen on north slopes; ridges stacked tile, darker |
| **lime plaster** (白粉墙, 栱眼壁, gables) | warm lit #dcc6b6 (06), blue shade #63676b (03), dawn gable #7b746a (02) | 0.68–0.78, 0.64–0.72, 0.58–0.66 | 0.85–0.95 | warm white; grime and rain streaks below sills and at the base; never pure white |
| **七朱八白** band / white 額 band | #534740 in shade (06), #a97a5c sun-lit (09) | white parts as plaster, red as lacquer | 0.8 | the Song 丹粉刷饰 rhythm of red and white under the eaves |
| **white stone** (台基, 勾闌, stairs, 三潭) | lit #b8a697 (06), shaded wall #2e2b26 (06), lit wall #726659 (06) | 0.50–0.62, 0.46–0.56, 0.40–0.50 | 0.6–0.8 | warm limestone / marble; joints and stains; edges chipped; lichen at the base |
| **grey stone** (青石 paving, bridge, 三潭 lanterns) | bridge shade #343c47 (10), path #65564c (02) | 0.20–0.30, 0.20–0.29, 0.19–0.28 | 0.7–0.9 | slightly green-grey; worn smooth on treads; wet dark near water |
| **飞来峰 limestone** | #3b362e mass (08), carving #645c50–#6f665a (08) | 0.28–0.38, 0.26–0.35, 0.22–0.30 | 0.85 | grey karst with dark vertical streaks, moss in cracks, vines hanging; the carving smoother, its top surfaces lighter |
| **宝石山 rock** (宝石流霞: red-brown tuff) | #45362d (01) | 0.14–0.22, 0.08–0.12, 0.05–0.08 | 0.85 | reddish brown volcanic rock under the 樓閣 |
| **bronze / gilt** (塔剎, finials) | gold highlight in 04 | metal: 0.75, 0.55, 0.30 | 0.35–0.5 | gilt bronze, slightly tarnished; only finials and small fittings |
| **earth / path** | #65564c (02) | 0.14–0.20, 0.11–0.16, 0.08–0.12 | 0.9 | packed earth with fallen petals (02), leaves (08) |
| **snow** | lit roof #936d61 (graded, 10), deck #818286 | 0.80–0.90 | 0.6–0.8 | fresh snow on roofs, rails, branches; melting patches on the bridge deck show stone (10) |

**Water** (the water module): West Lake is shallow (2–3 m), slightly turbid jade-grey; the bed vanishes within ~1 m.
It mostly shows the sky.

| shot | water reads as |
|---|---|
| 01 | silver-grey mirror (#c6c3bb mid, #a6a7a3 near), perfect reflections of the causeway, soft mist above |
| 02 | white-grey, glassy, a few faint ripples |
| 03 | blue-grey (#626f78) with crisp reflections of the halls under the lotus |
| 04 | dark warm brown (#5c4f41) with a broken gold glitter path under the sun (#ba976c) |
| 05 | navy (#152135), moon path and lantern streaks |
| 06 | the Qiantang far away: pale grey (#939694), a sandbar |
| 07 | canal: dark green-grey (#515b64) with reflected walls and boats |
| 09 | silty grey-brown (#868381) river, the white bore with spray (#e2d6c7) |
| 10 | blue-grey ice (#778396) at the edge, open water beyond reflecting the snow |

**Foliage per season** (vegetation module). Display colours are from the refs; linear albedos for leaves.

| season | species and colour | linear leaf albedo |
|---|---|---|
| spring (01, 02, 07) | willow: fresh yellow-green, translucent (#b2ac9a in mist, much greener near); peach: pale pink (#c99aa0 near, #ab978a in haze); camphor: dark green with bronze-red new leaves; pine: dark (#1c1d16) | willow 0.12–0.20 G-dominant (0.10, 0.17, 0.04); peach 0.55, 0.38, 0.42; camphor 0.04–0.08 |
| summer (03, 04, 05, 06, 09) | lotus leaves: blue-green with a waxy bloom (#38483a lit), flowers pink-white (#c3a0b0); camphor and pine: deep green (#211e11 in shade); willow mid-green | lotus leaf 0.06, 0.10, 0.07 (roughness 0.35, sheen); lotus petal 0.6, 0.35, 0.45; camphor 0.03–0.07 |
| autumn (08) | maple: scarlet to blood red (#563527 shaded, much brighter lit with sun through it); ginkgo: gold (#c6b087 lit); camphor stays green | maple 0.30, 0.05, 0.03; ginkgo 0.50, 0.36, 0.06; translucency matters (back-lit leaves glow) |
| winter (10) | willow bare: grey-brown twigs with snow; camphor and pine dark green under snow | twigs 0.12, 0.10, 0.08 |

Trees are never round green balls: the silhouette (willow curtains, pine layers, camphor domes, maple lace) carries
the realism. Foreground framing trees (01 pines, 02 willow and peach, 04 trees on the right, 08 maple, 09 trees below)
need leaf-level detail.

## 6. Song architecture: what to keep

Build the Song (南宋, 1127–1279) look from 《营造法式》 (1103). The architecture module already follows its rules;
these are the traits a viewer must see:

* **Roofs as the refs draw them.** 舉折 gives the base profile (a smooth concave curve); on top of it the southern
  curl of the refs: the eave sags along its length and sweeps up into strongly lifted, thrust-out corners (翼角起翹 +
  出衝), the 正脊 rises toward its ends, the hip ends turn up. Per-building presets live in the layout (`curl: { lift,
  thrust, zone, pow, ridge, hipTip, thick, fei, ridgeScale, chiwei, beast }`, see `src/yingzao/roof.js` CURL_SOUTH);
  the default is the refs' southern style. Pavilions and towers may need a steeper 舉 (`ju`) and shorter or longer
  eaves (`eaveScale`) to match their ref.
* **Heavy roofs.** Thick edges, prominent ridges, big ridge-end ornaments, visible tile rows.
* **Big, lit, coloured brackets.** 鋪作 tall relative to the columns, a band under the eaves that reads lit: 土朱
  members with white 緣道, 解綠 green / blue edges, 石青 / 石綠 枓, 黃丹 undersides — not a dark band.
* **Ridge ends.** 鴟尾 on halls and towers; small ones on pavilions where the ref shows a curled ridge end.
* **Colour.** Red lacquer that reads red in daylight (albedo 0.21, 0.047, 0.029), warm white walls, grey tile; the
  existing weathering stays.
* **Openings.** 格子門 (lattice doors), 直櫺窗 / 破子櫺窗 (vertical-bar windows), plain board doors.
* **Platforms and rails.** 台基 with 須彌座 mouldings on major halls; 勾闌 (Song balustrades) light and open: 尋杖,
  蜀柱, 華版 — not the heavy solid Qing 欄板.
* **Pagodas.** 樓閣式: brick core with timber 腰檐 and 平坐 balconies (雷峰 5 storeys, 六和 7), bronze 塔剎.

**Avoid:** glazed colour tiles, glass, electric light, concrete, asphalt, modern bridges (the
錢江大橋 next to 六和塔 does not exist), power lines, signage in modern script, people (not built in this world).

## 7. Camera and lens

* 16:9, 1664 × 928 previews, 3840 × 2160 finals. Vertical FOV per shot is in `shots.js` (19°–46°: mostly a gentle
  telephoto, which is why the hills stack so strongly).
* Eye heights are human or a little above: 1.6–5 m for the ground shots (02, 03, 05, 08, 10), 55–92 m for the
  vantage shots (01, 06, 07, 09).
* Depth of field only where the reference shows it: ref02's foreground willow / peach (shallow), ref03's front lotus.
* No lens tricks: no fisheye, no heavy vignette (≤ 0.2), lens glare only with the sun in frame (04).

## 8. Where the references drift (and what we build)

| ref | the reference shows | we build |
|---|---|---|
| 01 | mountains three to four times taller than the real hills behind West Lake; 三潭 far too big; 雷峰塔 with 7 tiers | real geography for everything inside 6 km; art-directed far ranges taller than real (still lower than the ref) so the layered skyline reads; 三潭 at a compromise size; 雷峰 with 5 storeys (Song) |
| 01, 05 | 小瀛洲 as a ring island | kept (the prompt asks for it), although the island was made in 1607 (Ming) |
| 02 | a pavilion with flying corners; the prompt asked for none, the image has one | the pavilion as the ref shows it: 山花 to the camera, high curled 歇山, open on all sides |
| 03 | — (close to Song) | as shown |
| 04 | the evening sun behind 雷峰 from the north-east: a winter sun with summer trees | the sun is art-directed into that place (az ~227°, el 9°); trees stay summer green (camphor is evergreen); a temple hall at the foot of 夕照山 stands in for 淨慈寺 |
| 05 | lanterns in Ming shape; a hall and an islet pavilion that do not exist south of 小瀛洲; a moon azimuth only possible at a major lunar standstill | Song "三塔" as the familiar lantern shape (lit), the hall on a stone platform in the lake joined to the island, an islet with a 亭; moon at az 125°, el 4° |
| 06 | the palace on top of a hill with a Ming-looking stone 牌樓 "闕"; heavy Qing balustrades | the palace on the 凤凰山 east spur (its real place), main hall turned NNE toward the 和寧門 approach; a Song 闕 (masonry base, timber roof); Song 勾闌 |
| 07 | people on the street | no people; shop banners, carts and boats only |
| 08 | the 布袋 cliff, the temple and a hill pagoda pressed into 40 m; Qing colours on the hall | the real arrangement along 冷泉溪 squeezed as little as possible; Song colour; the pagoda lower in frame than the ref |
| 09 | a sea horizon; 六和塔 with broad curled eaves; the light from the left | the view looks down the Qiantang estuary so the water reaches the horizon; the tower as the ref draws it (four storeys, broad eaves, heavy crown); the morning sun from the left |
| 10 | a 重檐歇山 pavilion with a red 山花, a Qing tower on the hill, a very steep bridge | the pavilion as the ref shows it, Song colours; the hill building is the shot-1 樓閣 on 宝石山 (it really is in that direction); the bridge steeper than the real 断桥 (crown 8.5 m) |

## 9. The ink look (纯水墨)

The explorable world and the ink stills are painted, not photographed. With `?look=ink` (`src/ink/`) every material
also writes a G-buffer (depth, normals, material class); the frame is accumulated and graded as usual, and a painter
pass turns the G-buffer and the graded tone into a painting: brush outlines (勾) from depth breaks and creases, texture
strokes (皴) and leaf marks by species, graded washes (染) from the blurred tone, and bare paper (留白) for mist, water
and sky. Three styles share the painter: `inkStyle=mo` 纯水墨 (the default in the explorable world), `qj` 浅绛 (the
default for `?look=ink` stills) and `ql` 青绿.

Its targets are ten AI-generated ink paintings of the same views (`refs/ink01.jpg` … `ink10.jpg`, prompts in
`refs/ink-probe.json` and `refs/ink-refs-mo.json`). They are compared against, never sampled. The ink cameras, per-shot
ink settings and framing trees are in `src/ink/styles.js`; the few changes only an ink still makes to the world (the
三潭 lanterns brought into the 宝石山 view, the far 雷峰 enlarged) are in `src/ink/stage.js`. Every mark is placed from
world positions (world-space lattices, per-tree frames), so the strokes stay on the world while the walker moves; only
the paper's fibres are fixed to the sheet.
