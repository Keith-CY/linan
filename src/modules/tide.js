// TIDE: the 钱塘潮 bore on the Qiantang below 六和塔 (ref09).
//
// A white breaking front sweeping across the river: a long wall of water (a ribbon mesh with a steep face, a curling
// lip, a tumbling roller and the raised water behind it) with foam streaming down the face, spray boiling off the
// crest, droplet jets thrown from the lip, white water heaving on the roller and a mist plume drifting away behind
// (src/water/spray.js). The water surface (src/water/surface.js, uBore*) does the rest: calm silty brown water ahead
// of the front, a solid white apron, then turbulent, choppy, foam-streaked water behind it.
// Placed against ref09: the front runs from the north bank 3.3 km downstream to mid-river 620 m from the shot-9
// camera (the picture's (0.03, 0.53) → (0.55, 0.62)), i.e. obliquely across the river — a cross wave sweeping away from
// the north embankment (交叉潮 / 回头潮), with the churned water on the camera's side as in the reference.
// Animatable for video: the front travels at BORE.speed (m/s) from its ref position at engine time 0; everything
// (mesh, spray, water) reads the engine time only.
//
//   build(engine): the bore (hidden except in shot 9 / shot.tide), engine.registry.tide = { group, frontAt(t), BORE }
//   test(engine): --test tide --view 0 (the shot-9 framing, river + terrain + water only), 1 (close, low), 2 (aerial)
import * as THREE from 'three';
import { proceduralMaterial } from '../core/materials.js';
import { heightAt } from '../world/heightfield.js';
import { SpraySystem } from '../water/spray.js';

/** the front at time 0 (world x, z): a, b = the ends seen in ref09 (far / near), extended past them */
export const BORE = {
  a: [1483, 3847], b: [-1063, 5045],
  extendA: 120, extendB: 320,      // m beyond each end (the near end runs on behind the pagoda / trees)
  camera: [-1648, 4838],           // the churned water behind the front lies on the shot-9 camera's side
  speed: 4.2,                      // m/s, away from the north bank
  height: 7.5,                     // crest height (m; ART: ref09 shows a wall far taller than a real bore, ~2.5x a typical one)
};

// the front's plan shape: offset along the normal (m) at a distance al along the front from its middle (keep in sync
// with wBoreSD in src/water/surface.js)
const bow = (al) => 1.1e-5 * al * al + 5.0 * Math.sin(al / 170 + 1.3) + 1.8 * Math.sin(al / 37 + 0.4);

// cross-section of the bore (s = metres behind the front, + toward the churned side; y = height / crest height)
// ahead: calm water; the face rising, steepening, overhanging at the lip; the roller; the raised water behind
const PROFILE = [
  [-14, -0.3], [-8, -0.1], [-4.5, 0.08], [-2.6, 0.3], [-1.6, 0.52], [-1.15, 0.72], [-1.25, 0.86], [-0.9, 0.97],
  [-0.2, 1.0], [0.8, 0.96], [2.2, 0.84], [4.0, 0.72], [6.5, 0.62], [10, 0.52], [15, 0.43], [22, 0.34], [32, 0.25],
  [46, 0.16], [65, 0.08], [90, 0.0], [120, -0.25],
];

const FOAM_HEAD = /* glsl */`
uniform float uTime;
uniform vec3 uMudC;
float bFoam; float bRough; vec3 bGlow;
`;
// object space of the ribbon: x = along the front, y = height; uv = (relative height, s = metres behind the front)
const FOAM_COLOR = /* glsl */`
  float al = cgO.x, yy = cgO.y, s = vUv.y;
  float rel = clamp(vUv.x, 0.0, 1.2);                 // height / local crest height
  // foam: the lip and the roller are white; on the face it pours down in streaks; the base of the face is brown water
  float stream = cgVnoise2(vec2(al * 0.55, (yy + uTime * 2.2) * 0.45)) * 0.6 + cgVnoise2(vec2(al * 1.7 + 3.0, (yy + uTime * 3.1) * 1.3)) * 0.4;
  float faceFoam = smoothstep(0.25, 0.75, rel + (stream - 0.5) * 0.7) * step(s, 0.0);
  float roller = smoothstep(-0.6, 0.6, s) * (1.0 - smoothstep(30.0, 70.0 + 25.0 * stream, s));
  float behindStreaks = smoothstep(0.35, 0.65, cgVnoise2(vec2(al * 0.09, s * 0.04 - uTime * 0.15)) * 0.6 + stream * 0.4) * (1.0 - smoothstep(70.0, 118.0, s));
  float lumps = cgVfbm3(vec3(al * 0.35, yy * 0.6 - uTime * 0.4, s * 0.35), 3);
  bFoam = clamp(max(max(faceFoam, roller * (0.7 + 0.5 * lumps)), behindStreaks * 0.8), 0.0, 1.0);
  vec3 water = uMudC * (0.8 + 0.4 * stream);
  vec3 foam = mix(vec3(0.62, 0.6, 0.55), vec3(0.86, 0.84, 0.8), smoothstep(0.3, 0.7, lumps)) ;
  // silt shows through the thinner foam (cream-brown streaks on the wall, ref09)
  foam = mix(foam, vec3(0.5, 0.44, 0.36), smoothstep(0.55, 0.85, stream) * 0.35 * (1.0 - roller));
  diffuseColor.rgb = mix(water, foam, bFoam);
  bRough = mix(0.22, 0.85, bFoam);
  // foam is a dense scattering medium: sky light and sunlight carried through it keep the shaded face white
  bGlow = foam * bFoam * (uHazeColor * 0.32 + uSunColor * 0.6 * (0.4 + 0.6 * rel));
`;

function buildRibbon(frame, { step = 3 } = {}) {
  const { t, n, len0, len1 } = frame;
  const cols = PROFILE.length;
  const along = [];
  for (let a = -len0; a <= len1 + 1e-6; a += step) along.push(a);
  const rows = along.length;
  const pos = new Float32Array(rows * cols * 3), uv = new Float32Array(rows * cols * 2);
  const idx = [];
  for (let j = 0; j < rows; j++) {
    const al = along[j];
    // crest height along the front: bigger toward the north-bank end (the wave piles up against the embankment)
    const endK = Math.max(0, 1 - (al + len0) / 500);
    const amp = BORE.height * (0.78 + 0.32 * Math.sin(al / 61 + 0.7) * Math.sin(al / 23 + 2.1) + 0.12 * Math.sin(al / 9.7)) * (1 + 0.6 * endK);
    const b = bow(al);
    for (let i = 0; i < cols; i++) {
      const [s, y] = PROFILE[i];
      // the lip ruffles along the front
      const lip = Math.abs(s + 1) < 1.2 ? 0.25 * Math.sin(al / 7.3 + 0.6 * i) * Math.sin(al / 2.9) : 0;
      const k = (j * cols + i);
      // object frame: x along, y up, z = s (behind); the plan bow shifts the whole section along the normal
      pos[k * 3] = al; pos[k * 3 + 1] = y * amp; pos[k * 3 + 2] = s + lip - b;
      uv[k * 2] = y; uv[k * 2 + 1] = s;
    }
  }
  for (let j = 0; j < rows - 1; j++) for (let i = 0; i < cols - 1; i++) {
    const a = j * cols + i, b2 = a + 1, c = a + cols, d = c + 1;
    idx.push(a, c, b2, b2, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  // make the faces point up / toward the calm side (ahead = -z): flip if the winding came out the other way
  const nr = g.attributes.normal;
  let up = 0; for (let k = 0; k < nr.count; k++) up += nr.getY(k);
  if (up < 0) { for (let k = 0; k < idx.length; k += 3) { const tmp = idx[k + 1]; idx[k + 1] = idx[k + 2]; idx[k + 2] = tmp; } g.setIndex(idx); g.computeVertexNormals(); }
  g.computeBoundingSphere();
  return g;
}

/** the front frame: unit tangent t, unit normal n (toward the churned side behind the front), origin, extents */
function frontFrame() {
  const [ax, az] = BORE.a, [bx, bz] = BORE.b;
  let tx = bx - ax, tz = bz - az; const l = Math.hypot(tx, tz); tx /= l; tz /= l;
  // normal toward the churned water behind the front: the camera side (ref09: the white water spreads below the front,
  // the far water above it is calm; the bore runs away from the north bank)
  let nx = -tz, nz = tx;
  const mx = (ax + bx) / 2, mz = (az + bz) / 2;
  if ((BORE.camera[0] - mx) * nx + (BORE.camera[1] - mz) * nz < 0) { nx = -nx; nz = -nz; }
  // a right-handed object frame for a rotation about Y: local x → t, local z → n requires n = (-t.z, t.x)
  if (Math.abs(nx - -tz) > 1e-6 || Math.abs(nz - tx) > 1e-6) { tx = -tx; tz = -tz; }
  const len0 = l / 2 + (tx * (ax - mx) + tz * (az - mz) < 0 ? BORE.extendA : BORE.extendB);
  const len1 = l / 2 + (tx * (ax - mx) + tz * (az - mz) < 0 ? BORE.extendB : BORE.extendA);
  return { t: [tx, tz], n: [nx, nz], o: [mx, mz], len0, len1 };
}

// ---------------------------------------------------------------- the ink bore (?look=ink)
// ink09 paints the 钱塘潮 as a long breaking wall running across the river from just right of 六和塔 out past the
// frame's right edge (after 李嵩《钱塘观潮图》 and 马远《水图》): a row of curling crests (卷浪), each lip turning over
// toward the viewer, the foam left as paper, spray thrown up and back off the crest, white water at its foot and the
// churned water behind it. Built as solid shapes so the painter draws it from the G-buffer (class WAVE) and its own
// world frame along the front (src/ink/painter.js: uBoreInk, uBoreInk2 — keep inkHeight / curl in sync with it).
// A frozen moment (a painting): it does not travel. Placed for the ink camera of shot 9 (src/ink/styles.js INK_CAMS[9]):
// a straight front (a straight line on the sheet: ink09's diagonal from the pagoda's right down to the right edge),
// from the north bank 970 m from the camera (its end runs into the bank behind the shore trees) to 320 m off the right
// edge; the churned water lies behind it (the river side), the face and the white water toward the bank and the camera.
// ART: a wall up to 42 m high, its spray as high again (a real bore is 1–3 m, its 回头潮 splash up to ~10 m): ink09's wall at the camera's
// distance; tallest toward the pagoda (far) end, lower toward the near end, so it reads at an even size on the sheet.
export const INK_BORE = {
  a: [-834, 4602], b: [-1468, 5174],   // the front's ends: the north bank (left of the frame), beyond the right edge
  camera: [-1720, 4990],               // the face (ahead) turns toward this side
  hA: 42, hB: 20,                      // crest height (m) over the far part of the front (to 30 % of its length) / at b
  period: 34,                          // mean length (m) of one curling crest along the front
};
/** crest height along the front (al = m from a), as the painter computes it (src/ink/painter.js boreH) */
function inkHeight(al, len) {
  const f = al / len;
  const base = INK_BORE.hA + (INK_BORE.hB - INK_BORE.hA) * smooth(0.3, 1.0, f);
  const c = inkCurl(al);
  return base * (0.78 + 0.22 * c.k) * (0.94 + 0.06 * Math.sin(al / 53 + 0.7));
}
/** the curling crests along the front: { u: 0..1 across this crest, k: its curl (0 spilling .. 1 a full curl), id } */
function inkCurl(al) {
  // crests of uneven length: a world lattice of `period` m, each cell's breaker shifted and sized by its own hash
  const P = INK_BORE.period, i = Math.floor(al / P);
  const h = hash1(i * 7 + 3);
  const u = al / P - i;
  // a full curl in the middle of the crest, spilling foam toward its ends (ragged, not a sine)
  const peak = 0.35 + 0.3 * h;
  const k = Math.pow(Math.max(0, 1 - Math.abs(u - peak) / (u < peak ? peak : 1 - peak)), 1.4) * (0.55 + 0.45 * hash1(i * 13 + 5));
  return { u, k, id: i };
}
function smooth(e0, e1, x) { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); }
function hash1(n) { let x = Math.imul(n | 0, 2654435761) ^ 0x5bd1e995; x = Math.imul(x ^ (x >>> 15), 2246822519); x = Math.imul(x ^ (x >>> 13), 3266489917); return ((x ^ (x >>> 16)) >>> 0) / 4294967296; }
// face ribbon: (s ahead of the crest line (m, scaled by the local height / 16), y / local height): the white water
// ahead, the foot of the face, the face steepening, the lip thrown forward and curling back under itself
const INK_FACE = [
  [46, -0.05], [30, -0.01], [20, 0.02], [13, 0.06], [8.5, 0.15], [5.6, 0.32], [3.8, 0.52], [3.0, 0.7], [3.1, 0.84],
  [3.8, 0.95], [5.0, 1.0], [6.6, 0.99], [8.1, 0.93], [9.1, 0.82], [9.3, 0.7], [8.7, 0.6], [7.6, 0.56], [6.6, 0.6],
];
const FACE_LIP = 9;   // the first row of the lip (thrown forward by the curl)
// back ribbon: from the crest down the raised, churned water behind (s scaled by the local height / 16)
const INK_BACK = [[3.9, 0.985], [1.5, 0.975], [-2.5, 0.92], [-8, 0.8], [-16, 0.63], [-28, 0.45], [-45, 0.28], [-70, 0.14], [-110, 0.04], [-160, -0.08]];

/** small deterministic 3D value noise for the billows */
function vnoise3(x, y, z) {
  const h = (i, j, k) => { let n = (i * 374761393 + j * 668265263 + k * 1274126177) | 0; n = Math.imul(n ^ (n >>> 13), 1274126177); return ((n ^ (n >>> 16)) >>> 0) / 4294967296; };
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const s = (t) => t * t * (3 - 2 * t);
  const fx = s(x - xi), fy = s(y - yi), fz = s(z - zi);
  const L = (a, b, t) => a + (b - a) * t;
  return L(L(L(h(xi, yi, zi), h(xi + 1, yi, zi), fx), L(h(xi, yi + 1, zi), h(xi + 1, yi + 1, zi), fx), fy),
    L(L(h(xi, yi, zi + 1), h(xi + 1, yi, zi + 1), fx), L(h(xi, yi + 1, zi + 1), h(xi + 1, yi + 1, zi + 1), fx), fy), fz);
}

function buildInkBore(engine) {
  const B = INK_BORE;
  let tx = B.b[0] - B.a[0], tz = B.b[1] - B.a[1];
  const len = Math.hypot(tx, tz); tx /= len; tz /= len;
  // ahead = the side facing the camera
  let nx = -tz, nz = tx;
  const mx = (B.a[0] + B.b[0]) / 2, mz = (B.a[1] + B.b[1]) / 2;
  if ((B.camera[0] - mx) * nx + (B.camera[1] - mz) * nz < 0) { nx = -nx; nz = -nz; }
  const world = (al, s, y) => [B.a[0] + tx * al + nx * s, y, B.a[1] + tz * al + nz * s];
  const Hof = (al) => inkHeight(al, len);
  const pos = [], idx = [];
  const ribbon = (prof, lip) => {
    const step = 1.5, rows = Math.ceil(len / step) + 1, cols = prof.length, base = pos.length / 3;
    for (let j = 0; j < rows; j++) {
      const al = Math.min(len, j * step), H = Hof(al), c = inkCurl(al).k, k = H / 16;
      for (let i = 0; i < cols; i++) {
        let [s, y] = prof[i];
        // the lip is thrown forward and curls under by the crest's curl; where it spills (between two crests) it
        // falls short, lower and rounder
        if (lip && i >= FACE_LIP) { s = 3.8 + (s - 3.8) * (0.25 + 0.75 * c); y = 0.84 + (y - 0.84) * (0.55 + 0.45 * c); }
        // the lip ruffles along the front
        const ruff = y > 0.85 ? 0.35 * Math.sin(al / 3.1 + i) * Math.sin(al / 7.7) : 0;
        const p = world(al, s * k + ruff, y * H);
        pos.push(p[0], p[1], p[2]);
      }
    }
    for (let j = 0; j < rows - 1; j++) for (let i = 0; i < cols - 1; i++) {
      const a = base + j * cols + i, b2 = a + 1, cc = a + cols, d = cc + 1;
      idx.push(a, cc, b2, b2, cc, d);
    }
  };
  ribbon(INK_FACE, true);
  ribbon(INK_BACK, false);
  // spray: two thin sheets standing on the crest and leaning back over the churned water, their tops torn into jets
  // (ragged, uneven plumes: tallest where a crest curls hardest and toward the pagoda end), painted as dry streaks
  const sheet = (sOff, hK, seed) => {
    const step = 1.2, rows = Math.ceil(len / step) + 1, cols = 6, base = pos.length / 3;
    for (let j = 0; j < rows; j++) {
      const al = Math.min(len, j * step), H = Hof(al), c = inkCurl(al).k, k = H / 16;
      const far = 1 - smooth(0.25, 0.75, al / len);
      // the plume's height: the crest's curl, a slower swell and torn jets (soft billows a few metres across with a
      // few torn tips: a smooth noise along the front, not a hash per column, which drew a sawtooth of flames)
      const jet = vnoise3(al / 3.2, seed * 0.7, 2.5) * 0.55 + vnoise3(al / 9.5, seed * 0.3, 7.5) * 0.3 + hash1(j * 31 + seed) * 0.15;
      const hs = H * hK * (0.15 + 0.85 * Math.pow(c, 0.8)) * (0.55 + 0.45 * far) * (0.35 + 0.9 * jet) * (0.8 + 0.4 * vnoise3(al / 23, seed, 0.5));
      const s0 = (3.8 + 3.5 * (0.25 + 0.75 * c)) * k + sOff * k;
      for (let i = 0; i < cols; i++) {
        const t = i / (cols - 1);
        const y = H * 0.9 + (H * 0.1 + hs) * t;
        // leaning back as it rises, the top thrown further back
        const s = s0 - (y - H * 0.9) * (0.5 + 0.6 * t) + 0.4 * Math.sin(al / 2.3 + i);
        const p = world(al + 0.8 * t * Math.sin(al / 5.1 + seed), s, y);
        pos.push(p[0], p[1], p[2]);
      }
    }
    for (let j = 0; j < rows - 1; j++) for (let i = 0; i < cols - 1; i++) {
      const a = base + j * cols + i, b2 = a + 1, cc = a + cols, d = cc + 1;
      idx.push(a, cc, b2, b2, cc, d);
    }
  };
  sheet(0, 0.9, 11);
  sheet(-4, 0.65, 29);
  // foam: noise-displaced lumps along the lip and down the face where a crest spills, a low veil of spray thrown up and
  // back off each curling crest (not tall billows: a wall, not a cloud), white water spread at the foot and on the back
  const rng = engine.rng('ink-bore');
  const balls = [new THREE.IcosahedronGeometry(1, 2), new THREE.IcosahedronGeometry(1, 1)];
  const camD = (p) => Math.hypot(p[0] - B.camera[0], p[2] - B.camera[1]);
  // a lump: radius r, squashed to sq of its height, stretched along the front by st
  const addBall = (c, r, sq = 1, seed = 0, st = 1) => {
    const ball = balls[camD(c) > 470 ? 1 : 0];
    const bp = ball.attributes.position, bi = ball.index ? ball.index.array : null;
    const base = pos.length / 3;
    for (let v = 0; v < bp.count; v++) {
      const x = bp.getX(v), y = bp.getY(v), z = bp.getZ(v);
      const n = vnoise3(x * 1.7 + seed, y * 1.7 + seed * 0.37, z * 1.7 - seed) * 0.65 + vnoise3(x * 3.9 - seed, y * 3.9, z * 3.9 + seed) * 0.35;
      const k = r * (0.6 + 0.8 * n);
      // local: x along the front (stretched), z across it
      const ax = x * k * st, az = z * k;
      pos.push(c[0] + tx * ax + nx * az, c[1] + Math.max(y * k * sq, -r * 0.3), c[2] + tz * ax + nz * az);
    }
    if (bi) for (let i = 0; i < bi.length; i++) idx.push(base + bi[i]);
    else for (let i = 0; i < bp.count; i++) idx.push(base + i);
  };
  for (let al = 1; al < len; al += 1.7) {
    const H = Hof(al), cu = inkCurl(al), c = cu.k, k = H / 16;
    const p0 = world(al, 0, 0);
    if (heightAt(p0[0], p0[2]) > -0.3) continue;      // only over the river
    const tip = (3.8 + 5.5 * (0.25 + 0.75 * c)) * k;    // the lip's reach ahead of the crest line
    // the foam roll along the crest: lumps tumbling over the lip, bigger where the crest curls
    for (let q = 0; q < 3; q++) addBall(world(al + rng.range(-1, 1), tip * rng.range(0.45, 0.95) + rng.range(-1, 1), H * rng.range(0.82, 0.98)), H * rng.range(0.11, 0.17) * (0.7 + 0.45 * c), 0.85, rng.range(0, 100), 1.7);
    // where the crest spills: foam pouring down the face in a white cascade
    if (rng.random() < 0.9 - 0.8 * c) addBall(world(al + rng.range(-1.5, 1.5), rng.range(4.5, 7.5) * k, H * rng.range(0.3, 0.8)), H * rng.range(0.07, 0.11), 0.95, rng.range(0, 100), 1.3);
    // the churned white water on the back of the wall
    if (rng.random() < 0.35) { const sb = -rng.range(4, 40) * k; addBall(world(al + rng.range(-2, 2), sb, Math.max(0.4, H * (0.97 + sb / (75 * k)))), H * rng.range(0.07, 0.12), 0.35, rng.range(0, 100), 1.6); }
    // white water rushing ahead at the foot
    if (rng.random() < 0.45) addBall(world(al + rng.range(-2, 2), rng.range(9, 22) * k, rng.range(0.1, 0.6)), H * rng.range(0.08, 0.15), 0.22, rng.range(0, 100), 1.8);
  }
  for (const b of balls) b.dispose();
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  g.computeBoundingSphere();
  const mat = new THREE.MeshStandardMaterial({ name: 'boreWall', color: 0xe8e4dc, roughness: 0.85, metalness: 0, side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(g, mat);
  mesh.name = 'tide:inkBore';
  mesh.userData.noHeightCapture = true;
  return mesh;
}

export async function build(engine) {
  const t0 = performance.now();
  const W = engine.registry.water;
  const q = engine.quality;
  const F = frontFrame();
  const group = new THREE.Group();
  group.name = 'tide';
  // the ink look: the painted bore of ink09 (still, solid, placed for the ink camera) instead of the photographic one
  if (engine.params?.get?.('look') === 'ink') {
    const mesh = buildInkBore(engine);
    group.add(mesh);
    group.visible = false;
    // (no self-shadowing: the billows' shadows on each other drew dark facets; the painter shades the foam itself)
    engine.add(group, { castShadow: false, receiveShadow: false });
    const on = (shot) => shot.tide ?? shot.id === 9;
    engine.onShot((shot) => {
      group.visible = !!on(shot);
      if (W?.uniforms?.uBoreB) W.uniforms.uBoreB.value.set(0, 0, 0, 0);
    });
    // the painter's frame of the front (src/ink/painter.js uBoreInk, uBoreInk2): its ends, its heights and the crests'
    // length, shown with the bore
    engine.registry.tide = { group, wall: mesh, BORE, ink: INK_BORE, frame: F, frontAt: () => INK_BORE.a, inkFront: () => (group.visible ? [...INK_BORE.a, ...INK_BORE.b, INK_BORE.hA, INK_BORE.hB, INK_BORE.period, 0] : null) };
    console.log(`[tide] ink bore ${geoTris(mesh.geometry)} tris in ${Math.round(performance.now() - t0)} ms`);
    return;
  }
  // ---- the wall
  const geo = buildRibbon(F, { step: q.detail >= 1 ? 1.5 : 3 });
  const U = { uTime: { value: 0 }, uMudC: { value: new THREE.Color(0.11, 0.092, 0.07) } };
  const mat = proceduralMaterial({
    name: 'boreWall',
    params: { color: 0xffffff, roughness: 0.6, metalness: 0, side: THREE.DoubleSide },
    uniforms: U,
    head: FOAM_HEAD + 'varying vec2 vUv;',
    color: FOAM_COLOR,
    roughness: 'roughnessFactor = bRough;',
    emissive: 'totalEmissiveRadiance += bGlow;',
  });
  // (the standard material only declares vUv with a map: pass our own)
  const base = mat.onBeforeCompile;
  mat.onBeforeCompile = (sh, r) => {
    base(sh, r);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec2 vUv;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvUv = uv;');
  };
  mat.userData.shaderKey += ':bore3';
  const wall = new THREE.Mesh(geo, mat);
  wall.name = 'boreWall';
  wall.rotation.y = Math.atan2(-F.t[1], F.t[0]);
  wall.userData.noHeightCapture = true;
  wall.frustumCulled = false;
  group.add(wall);

  // ---- spray, jets, boil and the mist plume (deterministic from a seeded RNG)
  const rng = engine.rng('bore-spray');
  const sys = new SpraySystem(engine, { level: 0 });
  const world = (al, s, y) => {
    const b = bow(al), ss = s - b;
    return [F.o[0] + F.t[0] * al + F.n[0] * ss, y, F.o[1] + F.t[1] * al + F.n[1] * ss];
  };
  const fwd = (k) => [-F.n[0] * k, 0, -F.n[1] * k];   // toward the calm side (the direction the bore travels)
  const dens = q.name === 'preview' ? 0.7 : 1.0;   // explore: the stills' density (a still view matches them)
  for (let al = -F.len0; al <= F.len1; al += 3.0 / dens) {
    const p = world(al, 0, 0);
    if (heightAt(p[0], p[2]) > -0.5) continue;          // only over the river
    const endK = Math.max(0, 1 - (al + F.len0) / 500);
    const H = BORE.height * (1 + 0.6 * endK);
    const burst = rng.random() < 0.28 + 0.5 * endK;
    // dense spray boiling off the crest
    sys.add({ kind: 2, pos: world(al + rng.range(-2, 2), rng.range(-1, 2), H * rng.range(0.6, 1.0)), size: rng.range(10, 16) * (burst ? 1.6 : 1), life: rng.range(2.6, 4.2),
      vel: [fwd(rng.range(0.5, 2))[0], rng.range(1.5, 3.5) * (burst ? 2.2 : 1), fwd(1)[2]], growth: 1.0, density: 0.8, gravity: 0.9 });
    sys.add({ kind: 2, pos: world(al + rng.range(-2, 2), rng.range(0, 6), H * 0.5), size: rng.range(9, 14), life: rng.range(2.0, 3.0),
      vel: [fwd(1.5)[0], rng.range(0.8, 2), fwd(1.5)[2]], growth: 0.8, density: 0.85, gravity: 0.5 });
    if (burst) sys.add({ kind: 2, pos: world(al, rng.range(0, 3), H * 1.1), size: rng.range(16, 28) * (1 + endK), life: rng.range(4, 6),
      vel: [0, rng.range(4, 8) * (1 + endK), 0], growth: 1.1, density: 0.45, gravity: 0.6 });
    // white water heaving on the roller
    sys.add({ kind: 4, pos: world(al + rng.range(-2, 2), rng.range(1, 9), 0.6 * H), size: rng.range(4, 7), life: rng.range(2.5, 3.5), stretch: 0.6, vel: [0, 0.4, 0], growth: 0.4, density: 0.7 });
    // droplet jets flung up and forward from the lip
    if (rng.random() < 0.6) sys.add({ kind: 3, pos: world(al, -1, H * 0.95), size: rng.range(2.5, 5), life: rng.range(1.4, 2.0),
      vel: [fwd(rng.range(2, 4))[0], rng.range(5, 9), fwd(rng.range(2, 4))[2]], density: 0.5, gravity: 9.8, stretch: 1.0 });
    // the mist plume drifting away behind the front
    if (rng.random() < 0.6) sys.add({ kind: 1, pos: world(al + rng.range(-6, 6), rng.range(4, 30), rng.range(4, 12)), size: rng.range(20, 40), life: rng.range(12, 18),
      vel: [0, rng.range(0.3, 0.9), 0], growth: 0.6, density: rng.range(0.08, 0.14) });
  }
  const spray = sys.build(rng);
  if (spray) { group.add(spray); sys.uniforms.uMistK.value.set(1.15, 1.2, 1.05, 0.0); sys.uniforms.uTint.value.setRGB(1.0, 0.96, 0.9); }
  group.visible = false;
  engine.add(group, { castShadow: false, receiveShadow: true });
  wall.castShadow = true; wall.receiveShadow = true;

  // ---- per frame: everything travels with the front; the water surface gets the same front
  const WU = W?.uniforms;
  const move = (t) => {
    const k = -BORE.speed * t;                                          // along n (negative = toward the calm side)
    wall.position.set(F.o[0] + F.n[0] * k, 0, F.o[1] + F.n[1] * k);
    U.uTime.value = t;
    if (sys.uniforms) { sys.uniforms.uTime.value = t; sys.uniforms.uOffset.value.set(F.n[0] * k, 0, F.n[1] * k); }
    if (WU?.uBoreT) WU.uBoreT.value = t;
  };
  engine.onUpdate((t) => move(t));
  move(engine.time || 0);
  const on = (shot) => shot.tide ?? shot.id === 9;
  engine.onShot((shot) => {
    const vis = !!on(shot);
    group.visible = vis;
    if (WU?.uBore) {
      WU.uBore.value.set(F.o[0], F.o[1], F.n[0], F.n[1]);
      WU.uBoreB.value.set(BORE.speed, 0, 0, vis ? 1 : 0);
    }
  });
  engine.registry.tide = { group, wall, spray: sys, BORE, frame: F, frontAt: (t) => [F.o[0] - F.n[0] * BORE.speed * t, F.o[1] - F.n[1] * BORE.speed * t] };
  console.log(`[tide] bore front ${Math.round(F.len0 + F.len1)} m, ${geo.index.count / 3} tris, ${sys.count || 0} spray puffs in ${Math.round(performance.now() - t0)} ms`);
}

export async function test(engine) {
  const terrain = await import('./terrain.js');
  const water = await import('./water.js');
  for (const o of engine.scene.children) if (o.name === 'testGround') o.visible = false;
  const views = [
    { id: 9, tide: true, pos: [-1648, 55.6, 4838], target: [-1551.7, 55.9, 4864.8], fov: 42.3 },
    { id: 9, tide: true, pos: [-980, 6, 4920], target: [-1063, 3, 5045], fov: 40 },
    { id: 9, tide: true, pos: [-1300, 260, 4500], target: [-200, 0, 4700], fov: 40 },
  ];
  engine.registry.season = 'summer';
  await terrain.buildTerrain(engine, { cams: views });
  await water.build(engine);
  await build(engine);
  return { views: views.map((x) => ({ ...x, near: 0.5, far: 60000 })) };
}

function geoTris(g) { return g.index ? g.index.count / 3 : g.attributes.position.count / 3; }
