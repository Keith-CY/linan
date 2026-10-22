# 临安 · Composition plan

How each of the ten cameras frames the world, and where everything it needs stands. The cameras are in
`src/world/shots.js`, the positions in `src/world/layout.js` (entries marked `// fit` were solved against these
cameras: move them only together with the camera), the light in `src/world/looks.js`, the look in `docs/ART_BIBLE.md`.

This plan was written against the photographic references (`refs/refNN.jpg`). The world was later adjusted toward
the ink targets (`refs/inkNN.jpg`), whose cameras are `INK_CAMS` in `src/ink/styles.js`; where this page and
`src/world/layout.js` disagree, the layout is current.

Conventions: world metres, +X east, −Z north, y = 0 the lake surface; bearings are compass degrees (0 north, 90 east).
Screen positions are fractions of the 1664 × 928 frame ("x 0.62" = 62 % from the left, "y 0.30" = 30 % from the top),
measured on the reference. "Eye" = camera height above the ground or water under it.

How the cameras were found: the terrain skyline, the shorelines and every layout landmark were ray-marched and drawn
over the reference; position, yaw, pitch and fov were then solved from landmark ↔ pixel pairs plus the horizon (those
fitting scripts are not part of this repository; `tools/proj.mjs` does the screen ↔ world part). GPU renders
(`tools/render.mjs --shot all`, `tools/session.mjs`) checked each fit.

## 0. The world in one picture

```
                      N (−Z)      北山 far                     天目 far NW (ART)
       栖霞岭  葛岭   宝石山 ●保俶塔 ■樓閣(1)  ◆cam 1, 10 look from here / at here
  岳庙  曲院◆3 ─────── 孤山 ═══ 白堤 ══ 断桥◆10    钱塘门 ┐
   ║苏堤                       北里湖                     │ city wall          御街 ◆7 (above it, looking S)
   ║  西里湖          湖心亭                              │  丰豫门      市河 │ 御街 │ 盐桥运河
   ║◆2 ■亭 ═望山桥                                        │                         朝天门 ■
 灵隐 ◆8   飞来峰       小瀛洲 ◯                          │ 清波门   吴山
 (−4 km W)              三潭 ◆5 ●●●                   长桥 ┘
   北高峰                ◆4 (on the lake)   万松岭
            南高峰     夕照山 ●雷峰塔  净慈        ■ palace ◆6 (凤凰山 east spur)
     五云山    九曜山      南屏山     玉皇山  凤凰山 将台山
   之江 ridge  月轮山 ●六和塔 ◆9 ─── 钱塘江 (flowing ENE to the estuary) ───────────────
                                   萧山 hills, 远岭 south 1–3 (ART, 12–40 km)
```

| place | world [x, z] | lat, lon | notes |
|---|---|---|---|
| origin | 0, 0 | 30.2440, 120.1452 | middle of the lake |
| 断桥 | 643, −1670 | 30.2591, 120.1519 | east end of 白堤 |
| 保俶塔 / 宝石山 top | 135, −2217 | 30.2640, 120.1466 | summit ≈ 65–76 m above the lake |
| 孤山 summit | −260, −1352 | 30.2562, 120.1425 | 38 m |
| 苏堤 (N end → S end) | −798, −1397 → −213, 1397 | | 6 bridges, 9 pavilions (亭 'su-ting' south of 望山桥) |
| 小瀛洲 | 96, 521 | 30.2393, 120.1462 | ring island (Ming, kept) |
| 三潭 | 136…163, 725…744 | | three lanterns ~20 m apart (ART, real ~62 m) |
| 雷峰塔 | 346, 1441 | 30.2310, 120.1488 | on 夕照山 (44 m) |
| palace main hall | 1687, 2245 | 30.2237, 120.1627 | top terrace on the 凤凰山 east spur, 63 m |
| 朝天门 (鼓楼) | 2452, 355 | 30.2408, 120.1707 | on 御街 |
| 布袋弥勒 | −3962, 446 | 30.2400, 120.1040 | 飞来峰 north face over 冷泉溪 |
| 六和塔 | −1558, 4900 | 30.1998, 120.1290 | on 月轮山, base 28 m |

---

## Shot 1 — 西湖全景 · 春晨 (panorama from 宝石山, spring dawn)

**Where.** From the crest of 宝石山 (the 保俶塔 hill on the north shore) looking south over the whole lake: the city of
Lin'an along the east shore on the left, 白堤 with 锦带桥 across the foreground water, 三潭 and 雷峰塔 in the middle
distance, the southern hills and the far ranges behind. The 樓閣 stands on the rock spur of the crest right in front of
the camera (宝石流霞: red volcanic rock).

| camera | value |
|---|---|
| pos → target | (276.4, 93, −2246) → (269.8, 90, −2146.3) |
| yaw / pitch / fov | 183.8° / −1.7° / 20° vertical (35° horizontal: a gentle telephoto) |
| eye | 35 m above the north slope (the camera floats above the 樓閣's level, ~14 m above its floor) |
| sun | az 96°, el 9°, from the left (east), dawn; spring; mist sheets on the lake |

| element | ref (x, y) | world | module |
|---|---|---|---|
| 樓閣 (two storeys, 歇山, 平坐) on the rock spur | x 0.57–1.0, ridge y 0.17, base y 0.84 | 'baoshi-louge' (250, −2146), level 79, facing 354, 104 m; terrace 'baoshi-spur' | yingzao (preset louge-hero) |
| pines framing the bottom left / centre, rock under the hall | y 0.7–1.0 | on the slope 20–60 m below the camera; rock = karst (later) | vegetation / karst |
| 白堤 with 锦带桥 (arched) across the foreground water, willows + peach | bridge (0.48, 0.73), the causeway from the left edge (y 0.58) to behind the hall | 'bai-1' (232, −1431), 700–900 m; BAI_CAUSEWAY | heightfield, bridges, vegetation |
| 北里湖 below the causeway | bottom left | lake | water |
| 三潭 | (0.49, 0.53) | THREE_POOLS, ~2.9 km | pagodas |
| 雷峰塔 on 夕照山 | (0.355, 0.21–0.29) | 'leifeng' (346, 1441), 3.7 km | pagodas |
| city along the far shore, wall | x 0–0.45, y 0.33–0.46 | CITY (east shore, 清波门 / 长桥 at the left edge) | city |
| southern hills, 4–5 layered ranges | y 0.12–0.33 | HILLS south, MASSIF, RANGES '萧山', '远岭 south 1–3' | terrain |

Layers: FG pines, rock, the 樓閣 · MG 北里湖, 白堤, 孤山 east end · BG the main lake, 三潭, the far shore with the city
and 雷峰 · far: hills and ranges in haze.

**Off.** (1) The reference's vertical layering is about four times steeper than real distances allow: 雷峰塔 sits at
y 0.21–0.29 there, at y ≈ 0.43–0.47 here; the mountains reach y 0.12 there, y ≈ 0.28 here even with the art-directed
2–3 km ranges at 30–40 km. (2) 白堤 slopes the other way (its left end is nearer than the bridge here, farther in the
ref). (3) The city is mostly outside the left edge (it lies east of the line of sight); the far shore at the left is
the south-east corner (长桥) and the suburbs outside 清波门 (city module: build them densely).

## Shot 2 — 苏堤春晓 (on the Su causeway, looking north)

**Where.** On the 苏堤 path about 70 m south of 望山桥, looking north along the straight causeway through a 亭 that
straddles the path (the causeway had 六桥九亭); the arched bridge is framed between the pavilion's columns; 西里湖 on
the left, the main lake on the right, the 北山 hills faint in the mist.

| camera | value |
|---|---|
| pos → target | (−411.2, 2.5, 316.4) → (−435.2, 23.3, 212.3) (9 m back from the first fit) |
| yaw / pitch / fov | 347° (along the causeway) / +12° / 31° (was 46°: the ref's pavilion has little perspective) |
| eye | 1.1 m above the path (low) |
| sun | az 82°, el 7° (right-front, hidden by willows); spring; mist |

| element | ref | world | module |
|---|---|---|---|
| 亭 (3 bays, 歇山, open), centre of frame | columns x 0.335–0.70, roof top y 0.05, floor y 0.80 | 'su-ting' (−417, 291), facing 167, 17 m | yingzao (ting) |
| 望山桥 (single semicircular arch) seen through the pavilion | arch (0.50, 0.64–0.76), deck top y 0.64 | 'su-3' (−433, 223), 86 m, crown 6.5 m | bridges |
| willows left, peach in blossom right, framing the top | x 0–0.3, 0.65–1.0 | causeway rows + hero trees within 6–15 m | vegetation |
| path, grass, fallen petals | bottom | causeway top 1.4 m | terrain / vegetation |
| water both sides, a skiff left, a lake pavilion far right | horizon y 0.755 | 'su-skiff'; the far pavilion is optional | water, boats |

**Off.** The pavilion follows the ref: square 3 × 3 bays, its 山花 turned to the camera 15° off
axis (layout `turn: 70`), a high curled 歇山 with small 鴟尾; checked with `tools/arch-overlay.mjs --shot 2 --ids su-ting`
(`out/arch/shot2_overlay.png`). `CLEARINGS` 'su-axis' keeps the path open.

## Shot 3 — 曲院风荷 · 夏 (lotus pond, the 水榭 and 保俶塔 across the lake)

**Where.** In the lotus pond of 西里湖 west of the 苏堤's north end (曲院风荷), looking north-east at a waterside 水榭,
a gallery and a hall standing on piles, with 苏堤's trees, 孤山 and 宝石山 with 保俶塔 across the water.

| camera | value |
|---|---|
| pos → target | (−926, 2, −953) → (−859.6, 2.4, −1027.8) |
| yaw / pitch / fov | 41.6° / +0.2° / 19° |
| eye | 2 m above the water (in the lotus) |
| sun | az 212°, el 58°, high behind the camera; summer afternoon |

| element | ref | world | module |
|---|---|---|---|
| lotus field (leaves 0.5–1 m, flowers) | y 0.58–1.0 | PLANTS 'quyuan-lotus' around the camera | vegetation |
| 水榭 (3 bays, 歇山, open, rails) | x 0.14–0.50, roof top y 0.27, deck y 0.55 | 'quyuan-xie' (−869, −1034), 99 m, deck y 1.1 | yingzao (shuixie) |
| gallery between them | x 0.45–0.62 | 'quyuan-lang' (−859, −1023) | yingzao (lang) |
| hall with white walls and lattice doors | x 0.51–1.0, ridge y 0.14 | 'quyuan-tang' (−846, −1013), 100 m | yingzao (hall) |
| 保俶塔 on 宝石山 | (0.45, 0.29–0.37) | 'baochu' (135, −2217), 1.65 km → x 0.45 | pagodas |
| far shore: 苏堤 trees, 孤山, 葛岭 | y 0.37–0.51 | 290 m (苏堤) to 1.3 km | vegetation, terrain |

**Off.** 葛岭 (118 m, 1.26 km) stands as a hill left of the pavilion where the ref has only a low tree line (real
geography kept). The halls are on piles in the lake (onWater, `y`).

## Shot 4 — 雷峰夕照 (雷峰塔 against the evening sun)

**Where.** On the lake ~130 m off the south shore, north-east of 夕照山, looking south-west at 雷峰塔 against the low
sun, a temple at the foot of the hill (雷峰塔院 / 淨慈 type), a stone shore with a balustrade and a moored 畫舫.

| camera | value |
|---|---|
| pos → target | (584.7, 2.2, 1189.5) → (509.2, 12.8, 1254.2) |
| yaw / pitch / fov | 229.4° / +6.1° / 19.6° |
| eye | 2.2 m above the water |
| sun | az 227°, el 9° (in frame just right of the pagoda); ART: a winter-like azimuth kept with summer trees |

| element | ref | world | module |
|---|---|---|---|
| 雷峰塔 (八角五層, brick + timber eaves, bronze 塔剎) | x 0.27–0.40, top y 0.03, base y 0.45 | 'leifeng' (346, 1441), 349 m (fit rms 2 px) | pagodas |
| sun disk / glare right of the pagoda | (0.42, 0.31) | look 4 | looks / sky |
| main hall (重檐歇山), lower front roofs | x 0.23–0.72, ridge y 0.35 | 'leifeng-dian' (447, 1305) 180 m, 'leifeng-men' (487, 1289); court terrace level 7 | yingzao (jingci, menwu) |
| trees left and right in silhouette | x 0–0.25, 0.65–1.0 | the 夕照山 slopes; keep the trees in front of the hall below its eaves | vegetation |
| stone shore + balustrade, steps | y 0.76–0.85 | shore 100–250 m (ART: the shore moved ~50 m south) | city / bridges (shore works) |
| 畫舫 | x 0.26–0.41, y 0.79–0.86 | 'leifeng-huafang' (507, 1271), 113 m | boats |
| glitter path on the water | x 0.36–0.42, y 0.85–1.0 | water under the sun | water |

**Off.** The vegetation currently hides the hall; the trees in front of 'leifeng-dian' must stay below y 0.5.

## Shot 5 — 三潭印月 · 夜 (the stone lanterns under a full moon)

**Where.** On the water just south of 小瀛洲, among the three lanterns, looking south-east past a lake pavilion on an
islet toward the 吴山–万松岭–凤凰山 ridge, a full moon rising above it; the palace and city lamps at the ridge's foot.

| camera | value |
|---|---|
| pos → target | (125, 1.6, 720) → (203.8, 3.1, 781.6) |
| yaw / pitch / fov | 128° / +0.9° / 30° |
| eye | 1.6 m above the water |
| moon | az 125°, el 6.5° (major-standstill summer full moon); disk 2× real size (ART); night, lanterns lit |

| element | ref | world | module |
|---|---|---|---|
| near lantern A (sphere with round holes, lit) | x 0.19–0.34, top y 0.30, base y 0.78 | THREE_POOLS[0] (136, 725), 12 m, 3 m tall (ART) | pagodas (santan) |
| lantern B (left, farther) | (0.155, 0.45–0.64) | (163, 733), 40 m | pagodas |
| lantern C (right, in front of the hall) | (0.70, 0.44–0.67) | (146, 744), 32 m | pagodas |
| 水榭 with white walls on a stone platform in the lake | x 0.6–1.0, ridge y 0.17–0.19, deck y 0.55–0.6 | 'xiaoying-xie' (152, 757), 46 m, deck y 1.0 | yingzao (shuixie) |
| islet pavilion + willow | x 0.36–0.53, roof y 0.42 | 'santan-ting' (196, 767) on ISLETS 'santan-islet', 85 m | yingzao, vegetation |
| arched bridge left | (0.17–0.24, 0.49–0.55) | 长桥 (1.2 km, smaller than the ref) | bridges |
| moon above the ridge | (0.45, 0.35) | look 5 | sky |
| city lamps at the ridge's foot | x 0.55–0.68, y 0.5 | the 清波门 / palace area 1.5–2.5 km | city (night) |

**Off.** The ridge is lower than in the ref (real 吴山–凤凰山 heights); the left third is the flat city (lights),
not hills. The ref's hall and islet do not exist south of 小瀛洲; they are placed as lake pavilions.

## Shot 6 — 南宋皇城 · 凤凰山 (the palace on the hill, the Qiantang beyond)

**Where.** Above the north slope of the 凤凰山 east spur (the real palace site), looking south-south-east at the main
hall on its top terrace; the palace steps down to the left (east) toward the river; the Qiantang crosses the left
third and runs off to the estuary on the left horizon.

| camera | value |
|---|---|
| pos → target | (1690, 70, 2140) → (1707.4, 68.3, 2238.5) |
| yaw / pitch / fov | 170° / −1° / 38° |
| eye | 18 m above the slope (about level with the hall's platform; a raised view) |
| sun | az 75°, el 24° (from the left); summer morning |

| element | ref | world | module |
|---|---|---|---|
| main hall (重檐廡殿, 九間, 鴟尾) on a white terrace | x 0.45–0.92, ridge y 0.10, base y 0.49 | 'palace-main' (1687, 2245), level 63, facing 20 (ART: NNE, toward 和寧門), ~100 m | yingzao (preset palace-main) |
| side hall right | x 0.80–1.0 | 'palace-duo' (1640, 2262) | yingzao (duodian) |
| white stairs, terrace walls, 勾闌 | x 0.4–0.6, y 0.45–0.7 | terraces 'palace-t3' (63), 'palace-t2' (52) | heightfield + yingzao (platforms) |
| lower hall left of the stairs | x 0.27–0.43, y 0.47–0.62 | 'palace-front' (1722, 2206) | yingzao |
| 闕 (gate tower) | (0.36, 0.34–0.47) | 'palace-que' (1779, 2347), terrace 'palace-t1' | yingzao (que) |
| pavilions down the slope | x 0.1–0.33, y 0.4–0.73 | 'palace-ting-1', 'palace-ting-2' | yingzao |
| pine canopy below | y 0.6–1.0 | PLANTS 'palace-pine', 'palace-camphor' | vegetation |
| the Qiantang, sandbar, flat far bank | x 0–0.25, y 0.42–0.62 | QIANTANG at 1.6–3.3 km | terrain, water |

**Off.** The river band is thinner than in the ref (it is 1.6 km away; the spur's shoulder hides the near bank).
The ref's stone 牌樓 "闕" becomes a Song 闕.

## Shot 7 — 临安城 · 御街鸟瞰 (above the imperial way, looking south)

**Where.** 70 m above 御街 north of 朝天门, looking south down the street to the drum tower, the palace hills and the
far ranges; the 市河 runs parallel on the right (west) with stone bridges and boats; city pagodas left, centre and
right; the lake as a sliver at the top right.

| camera | value |
|---|---|
| pos → target | (2416, 75.4, −916.2) → (2422.5, 51, −819.4) |
| yaw / pitch / fov | 176.2° / −14.1° / 37.6° (fit rms 15 px) |
| eye | 71 m above the street (drone view) |
| sun | az 111°, el 14° (left-front); spring morning, haze, cooking smoke |

| element | ref | world | module |
|---|---|---|---|
| 御街 (stone paved, ~22 m) from the bottom centre to the vanishing point | (0.47, 1.0) → (0.53, 0.20) | CITY.yujie | city |
| 市河 with arched bridges and boats, right | (0.80, 1.0) → (0.62, 0.30) | CITY.canals '市河', 45 m west of 御街 (ART) | city, bridges, boats |
| two-storey shops, grey tile, banners, both sides | everywhere below y 0.2 | CITY.grid | city |
| 朝天门 drum tower at the street end | (0.53, 0.16–0.21) | 'chaotian-men' (2452, 355), 1.27 km | yingzao (gulou) |
| pagodas | (0.13, 0.11–0.23), (0.39, 0.12–0.16), (0.71, 0.17–0.27) | 'city-pagoda-e/c/w' | pagodas |
| hills + ranges | y 0.07–0.14 | 凤凰山, 玉皇山, RANGES south | terrain |
| lake sliver | x 0.75–1.0, y 0.15 | the lake's south-east corner at 2–3 km | water |

**Off.** The ref has people on the street; this world builds none.

## Shot 8 — 飞来峰 · 灵隐 · 秋 (the 布袋弥勒 cliff and the temple across 冷泉)

**Where.** On the south bank of 冷泉溪 at the foot of 飞来峰, looking east along the stream: the cliff with the
Southern-Song 布袋弥勒 niche on the right, a stone bridge across the stream 30 m ahead, 灵隐寺's 天王殿 beyond it on the
north bank, red maples and gold ginkgo, a pavilion and a pagoda higher up.

| camera | value |
|---|---|
| pos → target | (−3978, 28.2, 439) → (−3880.2, 49, 441.4) |
| yaw / pitch / fov | 91.4° / +12° / 45° |
| eye | 2 m above the bank |
| sun | az 146°, el 32° (front-right, over the cliff; the cliff face in open shade); autumn late morning |

| element | ref | world | module |
|---|---|---|---|
| limestone cliff, vines, moss | x 0.36–1.0 | LINGYIN.cliff face [(−4060, 452) … (−3790, 435)], normal 355, 28 m; heightfield placeholder | karst |
| 布袋弥勒 (seated, laughing) in a niche | x 0.57–0.80, y 0.40–0.68 | budai (−3962, 446), facing 300, 16 m | karst / sculpture |
| small standing figure in a niche | (0.50, 0.60–0.74) | LINGYIN.cliff.small | karst |
| stream (dark water) | x 0–0.25, y 0.92–1.0 | VALLEYS '冷泉溪', 8 m north of the camera | terrain, water |
| stone bridge | x 0.08–0.34, y 0.74–0.81 | 'lingyin-bridge' (−3948, 431), axis 172 | bridges |
| 天王殿 roofs left | x 0.2–0.46, ridge y 0.16 | 'lingyin-tianwang' (−3885, 410) on 'lingyin-court' (29) | yingzao |
| red pavilion above the cliff | x 0.41–0.6, y 0.16–0.36 | 'feilai-ge' (−3858, 448), level 72 | yingzao |
| red maple left, ginkgo top right | x 0–0.33; x 0.5–0.75, y 0–0.2 | PLANTS 'lingyin-maple', 'lingyin-ginkgo' | vegetation |
| pagoda top centre | (0.47, 0.03–0.15) | 'lingyin-hill' (−3720, 395): lower in frame than the ref | pagodas |

**Off.** The ref presses cliff, bridge, temple and a hill pagoda into ~40 m; the real 冷泉 is wider. The pagoda cannot
reach the top of the frame without a cliff-like hill behind the temple.

## Shot 9 — 六和塔 · 钱塘潮 (六和塔 on 月轮山, the tidal bore)

**Where.** On the 月轮山 slope north-west of 六和塔, looking east-south-east down the Qiantang toward the estuary: the
pagoda on the right, the river widening to the horizon on the left, the white bore crossing it, junks sheltering in
a bay of the north bank, a small temple pavilion below.

| camera | value |
|---|---|
| pos → target | (−1648, 55.6, 4838) → (−1551.7, 55.9, 4864.8) |
| yaw / pitch / fov | 105.6° / +0.2° / 42.3° (fit rms 9 px) |
| eye | 4 m above the slope; ~28 m above the pagoda's base |
| sun | az 76°, el 32° (from the left; ART, the prompt said afternoon); summer (tide season) |

| element | ref | world | module |
|---|---|---|---|
| 六和塔 (八角七層, brick core, timber eaves and balconies) | x 0.62–0.87, top y 0.09, base y 0.82 | 'liuhe' (−1558, 4900), base 28 m, 113 m | pagodas |
| water to the horizon | x 0–0.6, horizon y 0.51 | the Qiantang down to the estuary (3–25 km) | terrain, water |
| tidal bore (white wall, spray) | (0.03, 0.53) → (0.55, 0.62) | 0.6–2.8 km downstream | water (tide module, planned) |
| junks with sails | x 0–0.36, y 0.68–0.80 | BOATS 'qiantang-junk-*' in the bay, 400–600 m | boats |
| shore embankment | y 0.80–0.83 | the north bank 250–350 m (ART: a bay ~130 m north) | city / bridges (shore works) |
| small pavilion | (0.50, 0.69–0.76) | 'kaihua-ting' (−1484, 4884) | yingzao |
| trees below and right | y 0.8–1.0, x 0.85–1.0 | 月轮山 slope | vegetation |
| cumulus towers | top right | look 9 sky | sky |

## Shot 10 — 断桥残雪 · 冬 (断桥 after snow)

**Where.** On the water south-east of 断桥, looking north-west at the bridge where 白堤 meets the north shore, a
snow-covered pavilion at its foot, bare willows, and 宝石山 behind with the shot-1 樓閣 and 保俶塔 on its crest;
葛岭, 栖霞岭 and the far western hills in snow on the left.

| camera | value |
|---|---|
| pos → target | (687.5, 5, −1635.4) → (615.3, 7.5, −1704.5) |
| yaw / pitch / fov | 313.7° / +1.4° / 37.3° (fit rms 33 px) |
| eye | 5 m above the water (on a boat / the causeway head) |
| sun | az 164°, el 30° (left-behind); winter, snow, thin ice at the edge |

| element | ref | world | module |
|---|---|---|---|
| 断桥: single steep arch, stone 勾闌, snow on the deck, melted patches | x 0.02–0.68, crown y 0.46, arch (0.38–0.56, 0.53–0.75) | 'bai-0' (643, −1670), axis 197 (ART: the 白堤 end bends), crown 8.5 m (ART), 56 m | bridges |
| pavilion (重檐歇山, red columns) at the north foot | x 0.64–1.0, ridge y 0.21, floor y 0.66 | 'duanqiao-ting' (670, −1680), 45 m | yingzao (chongyan) |
| 宝石山 with the 樓閣 and 保俶塔 | (0.57–0.62, 0.29–0.40) | 'baoshi-louge' at 670 m (x 0.59 ✓), 'baochu' | yingzao, pagodas |
| snowy far hills left | x 0–0.45, y 0.33–0.5 | 葛岭, 栖霞岭, 西山, 天目 far NW | terrain (snow from the terrain shader in winter) |
| bare snowy willows | (0.05–0.2), (0.45–0.65) | 白堤 rows, winter | vegetation |
| ice at the edge, open water | y 0.7–1.0 | lake, winter | water |

**Off.** The ref's Qing 彩畫 and Qing tower become Song. The ref's bridge rises more steeply than the real 断桥.

---

## What other modules need (layout data to read)

* Buildings: `HALLS` (21 entries; `kind`, `center`, `facing`, `level`, `y`, `terrace`, `params`, `shot`). Terraces and
  pads already flatten the ground at `level`.
* Pagodas: `PAGODAS` (`kind` leifeng / liuhe / baochu / santan / stupa; `level`, `y` for the 三潭).
* Bridges: `BRIDGES` (6 on 苏堤, 断桥 + 锦带桥 on 白堤, 西泠, 长桥, 春淙桥; `center`, `axis`, `span`, `rise`, `width`,
  `length`); the causeways are cut at every bridge by `gap` m of water. City canal bridges: along `CITY.canals`.
* Boats: `BOATS` (畫舫 at 雷峰, skiff on 苏堤, five junks below 六和塔); canal boats along `CITY.canals`.
* City: `CITY` (`westWall`, `gates`, `yujie`, `canals`, `grid`, `landmarks`, `bounds`, `ground` 4.5 m).
* Karst: `LINGYIN.cliff` (face polyline, normal, height, budai, small figure); `HILLS` entry '飞来峰' has `cliff: true`;
  the rock under the shot-1 樓閣 at terrace 'baoshi-spur'.
* Vegetation: `PLANTS` (lotus, causeway rows, pines, maples, ginkgo, palace camphor / pine), `CLEARINGS` (view lines
  to keep open: 雷峰 temple front, 苏堤 axis, the 曲院 water, the palace stairs) and `HERO_TREES` (exact trees for a
  shot); the other framing trees per shot are placed by `src/vegetation/placement.js` inside the frames above. Season from `registry.season`.
* Water / tide: the bore for shot 9 runs across the river 0.6–2.8 km east-north-east of the camera.

---

## Art-directed changes

Made while matching the references; every one is ART unless noted.

| shot | change | why |
|---|---|---|
| 2 | 望山桥 (su-3) axis 100: turned across the causeway | ref02 shows the arch side-on through the pavilion; end-on it could never show |
| 4 | three tall camphors on the 夕照山 shore, right third (vegetation SHOT_HEROES); leifeng-court skirt 8 m | the ref's right third is dark trees up to the frame top |
| 6 | sun ~040° / 16° (behind-left) | lights the main hall's front under its eaves |
| 7 | sun ~136° / 36°; courtyard trees from `registry.city.treeSpots`; 吴山 keeps its forest inside the city | street in sun, green crowns among the roofs |
| 8 | 大雄宝殿 moved forward to (−3910, 406) on its own bank terrace 'lingyin-front' (level 30); 天王殿 behind at (−3880, 368); 'lingyin-court' level 31; '灵隐 knoll' a wooded 110 m hill applied after the valley floor (`afterValley`) with the pagoda on it; 春淙桥 low and flat at (−3950, 429), axis 160; 'feilai-ge' a two-storey 歇山 閣; maples to the left; sun from the upper left (~351° / 38°) | the ref's big double-eaved hall stands just across the stream and wooded slopes with the pagoda fill the sky behind it |
| 9 | camera y 59 (+3.4 m), target y 60.2; 六和塔 body side 10.2 m, storey 4.4 m (~68 m); tree rule low 0.66 with no near exemption; bore crest 7.5 m; sun behind-left (~001° / 34°) | the pagoda's base, the river and the boats stay clear over a low canopy; a broad, lit pagoda |
| 10 | 断桥 (bai-0) axis 167 (30° off the causeway); a snowy range '雪岭 W (shot 10)' 13–16 km west, 2.4 km high | the ref's snowy deck rises from the near left; snowy far range on the left |
