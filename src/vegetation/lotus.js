// 荷 Lotus (Nelumbo nucifera): the hero foreground of 曲院风荷 (ref03).
//   leaves   — peltate, round (0.45-0.8 m), a shallow funnel around the petiole with big low-frequency waves,
//              upturned / drooping / taco-folded rims; some float flat, most stand 0.3-1.6 m above the water on
//              thin stalks, tilted so the pale veined undersides show. Waxy blue-green top with radial veins, a
//              glaucous sheen, water beads rolling toward the centre and small pools in the cup (lotus effect).
//   flowers  — 16-20 petals in three whorls, white at the base to pink at the tips, a yellow receptacle ringed
//              by stamens, on stems above the leaves; buds (pink-tipped teardrops) and green seed pods.
// Seasonal: summer (autumn browns and droops a little), hidden in spring / winter.
//   buildLotusLibrary(sys, engine) → { leaf: [variants], flower: [...], bud: [...], pod: [...] }
//   placeLotus(sys, lib, engine, zones) — fill the layout PLANTS lotus polygons at water level
import * as THREE from 'three';
import { GeoBuilder, v3, perp, rotAxis, clamp, smoothstep, addTube } from './util.js';
import { proceduralMaterial } from '../core/materials.js';
import { registerSeasonal, SHADER, WIND, SEASON_U } from './materials.js';
import { RNG, hash01 } from '../core/rng.js';
import { sdPolygon } from '../world/heightfield.js';
import * as L from '../world/layout.js';
import { INK_LOTUS } from '../ink/styles.js';

const TAU = Math.PI * 2;

// ======================================================================== geometry
/**
 * leaf shape o: { R, stalkH, cup, rimUp, droop, fold, foldA, waves: [[k, amp, phase]], outline: [[k, amp, ph]],
 *                 rings, segs, rnd, float }
 * uv = (θ / 2π, ρ); aFol = (ao, tip, rnd, sway); aAux = local planar (x, z) / R (for beads)
 */
function leafSurface(o) {
  return (rho, th) => {
    const ro = 1 + o.outline.reduce((a, [k, amp, ph]) => a + amp * Math.sin(k * th + ph), 0);
    const r = rho * o.R * ro;
    const x = r * Math.cos(th), z = r * Math.sin(th);
    let y = o.stalkH + o.cup * o.R * Math.pow(rho, 1.4);
    for (const [k, amp, ph] of o.waves) y += amp * o.R * Math.pow(rho, 2.2) * Math.sin(k * th + ph);
    if (o.fold) { const u = (x * Math.cos(o.foldA) + z * Math.sin(o.foldA)) / o.R; y += o.fold * o.R * u * u; }
    y += o.rimUp * o.R * Math.pow(smoothstep(0.62, 1, rho), 2);
    y -= o.droop * o.R * Math.pow(smoothstep(0.45, 1, rho), 1.5);
    return [x, y, z];
  };
}

function emitLeaf(gb, o) {
  const P = leafSurface(o);
  const rings = o.rings, segs = o.segs;
  const rhoAt = (i) => Math.pow(i / rings, 0.85);
  const ids = [];
  const sway = (rho) => clamp(0.35 + 0.65 * rho, 0, 1) * (o.float ? 0.15 : 1);
  // centre
  const c = P(0, 0);
  const ci = gb.v(c[0], c[1], c[2], 0, 1, 0, 0.5, 0, 1, 0, o.rnd, sway(0), 0, 0);
  for (let i = 1; i <= rings; i++) {
    const rho = rhoAt(i);
    const row = [];
    for (let j = 0; j <= segs; j++) {
      const th = (j / segs) * TAU;
      const p = P(rho, th);
      const e = 1e-3;
      const pr = P(Math.min(1, rho + e), th), pr0 = P(Math.max(0, rho - e), th);
      const pt = P(rho, th + e), pt0 = P(rho, th - e);
      const dr = v3.sub(pr, pr0), dt = v3.sub(pt, pt0);
      let n = v3.norm(v3.cross(dt, dr));
      if (n[1] < 0 && rho < 0.5) n = v3.mul(n, -1);
      row.push(gb.v(p[0], p[1], p[2], n[0], n[1], n[2], j / segs, rho, 1, rho, o.rnd, sway(rho), p[0] / o.R, p[2] / o.R));
    }
    ids.push(row);
  }
  for (let j = 0; j < segs; j++) gb.tri(ci, ids[0][j + 1], ids[0][j]);
  for (let i = 0; i < rings - 1; i++) for (let j = 0; j < segs; j++) {
    const a = ids[i][j], b = ids[i][j + 1], cc = ids[i + 1][j + 1], d = ids[i + 1][j];
    gb.tri(a, b, cc); gb.tri(a, cc, d);
  }
}

function emitStalk(gb, h, r, radial, bow, rnd, segs = 8, end = [0, 0]) {
  const pts = [], rad = [];
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    pts.push([end[0] * t + bow[0] * Math.sin(Math.PI * t), -0.5 + (h + 0.5) * t, end[1] * t + bow[1] * Math.sin(Math.PI * t)]);
    rad.push(r * (1.15 - 0.3 * t));
  }
  addTube(gb, pts, rad, { radial, fol: (t) => [0.8, 0, rnd, 0.2 + 0.6 * t] });
}

/** one petal: spoon-shaped, cupped toward the flower axis. base at b, axis dir d (unit), facing (outward) f */
function emitPetal(gb, b, d, f, len, wid, cup, flare, rnd, nu = 5, nv = 7) {
  const s = v3.norm(v3.cross(d, f)); // across the petal
  const ids = [];
  for (let j = 0; j <= nv; j++) {
    const v = j / nv;
    const w = wid * Math.sin(Math.PI * Math.min(1, Math.pow(v, 0.65) * 0.92 + 0.08)) * (1 - 0.15 * v);
    const row = [];
    for (let i = 0; i <= nu; i++) {
      const u = i / nu, x = (u - 0.5) * 2;
      // cupped cross-section (concave toward the axis = -f), the tip bending outward (flare)
      const off = -cup * wid * (1 - x * x) * (0.4 + 0.6 * Math.sin(Math.PI * v)) + flare * len * v * v * v;
      const p = v3.add(v3.add(v3.mad(b, d, len * v), v3.mul(s, x * w * 0.5)), v3.mul(f, off));
      const n = v3.norm(v3.add(v3.mul(f, 1), v3.mul(s, x * cup * 1.2)));
      row.push(gb.v(p[0], p[1], p[2], n[0], n[1], n[2], u, v, 0.9, v, rnd, 0.6 + 0.4 * v, 0, 0));
    }
    ids.push(row);
  }
  for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
    const a = ids[j][i], bb = ids[j][i + 1], c = ids[j + 1][i + 1], dd = ids[j + 1][i];
    gb.tri(a, bb, c); gb.tri(a, c, dd);
  }
}

/** receptacle (inverted cone, flat seed-bearing top), uv on the top disc = planar / r (+0.5) */
function emitHeart(gb, top, rTop, rBot, h, radial, rnd, aux = 0) {
  const ids = [];
  const ringT = [], ringB = [];
  for (let i = 0; i <= radial; i++) {
    const a = (i / radial) * TAU, ca = Math.cos(a), sa = Math.sin(a);
    const n = v3.norm([ca, -(rTop - rBot) / h, sa]);
    ringT.push(gb.v(top[0] + ca * rTop, top[1], top[2] + sa * rTop, n[0], n[1], n[2], 0.5 + 0.5 * ca, 0.5 + 0.5 * sa, 0.9, 0.2, rnd, 0.7, 1, aux));
    ringB.push(gb.v(top[0] + ca * rBot, top[1] - h, top[2] + sa * rBot, n[0], n[1], n[2], 0.5 + 0.5 * ca * rBot / rTop, 0.5 + 0.5 * sa * rBot / rTop, 0.7, 0.2, rnd, 0.6, 1, aux));
  }
  for (let i = 0; i < radial; i++) { gb.tri(ringB[i], ringT[i + 1], ringT[i]); gb.tri(ringB[i], ringB[i + 1], ringT[i + 1]); }
  // the flat top (seed face): a fan, normal up, aAux.x = 0 marks the top
  const c = gb.v(top[0], top[1] + rTop * 0.08, top[2], 0, 1, 0, 0.5, 0.5, 1, 0.3, rnd, 0.7, 0, aux);
  const rim = [];
  for (let i = 0; i <= radial; i++) { const a = (i / radial) * TAU; rim.push(gb.v(top[0] + Math.cos(a) * rTop, top[1], top[2] + Math.sin(a) * rTop, 0, 1, 0, 0.5 + 0.5 * Math.cos(a), 0.5 + 0.5 * Math.sin(a), 1, 0.3, rnd, 0.7, 0, aux)); }
  for (let i = 0; i < radial; i++) gb.tri(c, rim[i + 1], rim[i]);
  void ids;
}

function leafVariant(seed, kind, detail) {
  const rng = new RNG('hz-lotus-leaf:' + seed);
  const float = kind === 'float';
  const R = float ? rng.range(0.2, 0.3) : rng.range(0.3, 0.46);
  const stalkH = float ? 0.015 : kind === 'low' ? rng.range(0.2, 0.45) : kind === 'mid' ? rng.range(0.45, 0.85) : rng.range(0.85, 1.3);
  const style = rng.random();
  const o = {
    R, stalkH, float,
    cup: float ? 0.02 : rng.range(0.08, 0.22),
    rimUp: float ? 0.04 : style < 0.35 ? rng.range(0.1, 0.32) : 0,
    droop: !float && style > 0.75 ? rng.range(0.1, 0.25) : 0,
    fold: !float && style > 0.45 && style < 0.7 ? rng.range(0.15, 0.4) : 0, foldA: rng.random() * Math.PI,
    waves: float ? [[rng.int(5, 8), 0.012, rng.random() * TAU], [rng.int(14, 18), 0.006, rng.random() * TAU]] : [[rng.int(2, 3), rng.range(0.04, 0.1), rng.random() * TAU], [rng.int(4, 6), rng.range(0.025, 0.055), rng.random() * TAU], [rng.int(9, 13), rng.range(0.012, 0.022), rng.random() * TAU], [rng.int(19, 25), rng.range(0.006, 0.01), rng.random() * TAU]],
    outline: [[3, rng.range(0.015, 0.035), rng.random() * TAU], [7, rng.range(0.008, 0.018), rng.random() * TAU], [13, rng.range(0.004, 0.01), rng.random() * TAU]],
    rnd: rng.random(),
  };
  const lods = [];
  const lodRS = detail >= 1 ? [[16, 72], [6, 28], [2, 12]] : [[12, 56], [5, 22], [2, 12]];
  lodRS.forEach(([rings, segs], l) => {
    const leaf = new GeoBuilder(), stalk = new GeoBuilder();
    emitLeaf(leaf, { ...o, rings, segs });
    if (!float && l < 2) emitStalk(stalk, stalkH - 0.01, 0.0075, l === 0 ? 6 : 3, [rng.range(-0.06, 0.06), rng.range(-0.06, 0.06)], o.rnd, l === 0 ? 8 : 3);
    lods.push({ leaf: leaf.build(), stalk: stalk.count ? stalk.build() : null, tris: leaf.triangles + stalk.triangles });
  });
  return { H: 2 * R, R, stalkH, lods };
}

function flowerVariant(seed, kind, detail) {
  const rng = new RNG('hz-lotus-flower:' + seed);
  const H = kind === 'pod' ? rng.range(0.9, 1.4) : rng.range(1.0, 1.55);
  const top = [rng.range(-0.05, 0.05), H, rng.range(-0.05, 0.05)];
  const lods = [];
  for (let l = 0; l < 3; l++) {
    const petal = new GeoBuilder(), heart = new GeoBuilder(), stalk = new GeoBuilder();
    emitStalk(stalk, H - 0.01, 0.009, l === 0 ? 6 : 3, [rng.range(-0.04, 0.04), rng.range(-0.04, 0.04)], rng.random(), l === 0 ? 10 : 3, [top[0], top[2]]);
    const rnd = rng.random();
    if (kind === 'flower' || kind === 'half') {
      const open = kind === 'flower' ? rng.range(0.85, 1.15) : 0.45;
      const whorls = [[7, 0.15, 1.05, 0.95], [6, 0.135, 0.62, 0.9], [5, 0.115, 0.3, 0.8]]; // count, length (m), opening (rad), width k
      if (l < 2) {
        whorls.forEach(([n, len, ang, wk], w) => {
          const rot = rng.random() * TAU;
          for (let k = 0; k < n; k++) {
            const a = rot + (k / n) * TAU + rng.range(-0.15, 0.15);
            const out = [Math.cos(a), 0, Math.sin(a)];
            const op = ang * open * rng.range(0.85, 1.15);
            const d = v3.norm(v3.add([0, Math.cos(op), 0], v3.mul(out, Math.sin(op))));
            const f = v3.norm(v3.sub(v3.mul(out, Math.cos(op)), [0, Math.sin(op), 0]));
            const b = v3.add(top, v3.mul(out, 0.012 + w * 0.002));
            const L = len * rng.range(0.9, 1.1) * (kind === 'half' ? 0.95 : 1);
            emitPetal(petal, b, d, f, L, L * 0.6 * wk, 0.32, w === 0 ? 0.12 : 0.04, rnd, l === 0 ? 5 : 2, l === 0 ? 7 : 3);
          }
        });
        if (kind === 'flower') emitHeart(heart, v3.add(top, [0, 0.04, 0]), 0.022, 0.012, 0.028, l === 0 ? 14 : 6, rnd);
        // stamens: a ring of short yellow filaments around the receptacle
        if (l === 0 && kind === 'flower') {
          for (let k = 0; k < 70; k++) {
            const a = (k / 70) * TAU + rng.random() * 0.1;
            const out = [Math.cos(a), 0, Math.sin(a)];
            const b = v3.add(top, v3.add(v3.mul(out, 0.023), [0, 0.014, 0]));
            const d = v3.norm(v3.add([0, 1, 0], v3.mul(out, rng.range(0.4, 1.0))));
            const sd = v3.norm(v3.cross(d, out));
            const len = rng.range(0.024, 0.034);
            const ids = [];
            for (const [u, v] of [[0, 0], [1, 0], [1, 1], [0, 1]]) {
              const p = v3.add(v3.mad(b, d, len * v), v3.mul(sd, (u - 0.5) * 0.0025 * (v ? 1.4 : 1)));
              ids.push(heart.v(p[0], p[1], p[2], out[0], 0.5, out[2], u, v, 0.9, 1, rnd, 0.7, 2, 0));
            }
            heart.quad(ids[0], ids[1], ids[2], ids[3]);
          }
        }
      } else {
        // far: a few big petals
        for (let k = 0; k < 6; k++) {
          const a = (k / 6) * TAU, out = [Math.cos(a), 0, Math.sin(a)];
          const d = v3.norm(v3.add([0, 0.75, 0], v3.mul(out, 0.66))), f = v3.norm(v3.sub(v3.mul(out, 0.75), [0, 0.66, 0]));
          emitPetal(petal, top, d, f, 0.15, 0.11, 0.2, 0.05, rnd, 1, 1);
        }
      }
    } else if (kind === 'bud') {
      // closed bud: petals wrapped into a pointed teardrop
      const n = l === 0 ? 7 : 4;
      for (let k = 0; k < n; k++) {
        const a = (k / n) * TAU, out = [Math.cos(a), 0, Math.sin(a)];
        const op = 0.18;
        const d = v3.norm(v3.add([0, Math.cos(op), 0], v3.mul(out, Math.sin(op))));
        const f = v3.norm(v3.sub(v3.mul(out, Math.cos(op)), [0, Math.sin(op), 0]));
        emitPetal(petal, v3.sub(top, [0, 0.01, 0]), d, f, 0.13, 0.095, 0.55, -0.12, rnd, l === 0 ? 4 : 1, l === 0 ? 6 : 2);
      }
    } else { // seed pod: an inverted cone with a flat holed top, green
      emitHeart(heart, v3.add(top, [0, 0.07, 0]), 0.055, 0.014, 0.075, l === 0 ? 18 : 7, rnd, 1);
    }
    lods.push({ petal: petal.count ? petal.build() : null, heart: heart.count ? heart.build() : null, stalk: stalk.build(), tris: petal.triangles + heart.triangles + stalk.triangles });
  }
  return { H: 0.3, top, lods, stalkH: H };
}

// ======================================================================== materials
const LOTUS_SEASONS = [0, 1, 1, 0];
const leafHead = /* glsl */`
varying vec2 vUvL;
uniform vec3 uTopA; uniform vec3 uTopB; uniform vec3 uUnder; uniform float uBeads;
float lbHash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
`;
function leafMaterial() {
  const u = { ...SHADER.folUniforms({ transl: [0.36, 0.44, 0.1], tipAmt: 0, amb: 1, up: 0.0, gain: 1 }),
    uTopA: { value: new THREE.Vector3(0.03, 0.068, 0.045) }, uTopB: { value: new THREE.Vector3(0.07, 0.13, 0.06) },
    uUnder: { value: new THREE.Vector3(0.095, 0.125, 0.07) }, uBeads: { value: 1 } };
  const m = proceduralMaterial({
    type: 'physical',
    name: 'veg-lotus-leaf',
    params: { color: 0xffffff, roughness: 0.55, metalness: 0, side: THREE.DoubleSide, sheen: 0.3, sheenRoughness: 0.5, sheenColor: new THREE.Color(0.3, 0.4, 0.44) },
    uniforms: u,
    vertexHead: SHADER.VERT_HEAD + 'varying vec2 vUvL;\n',
    vertexPre: SHADER.VERT_WIND + 'vUvL = uv;\n',
    head: SHADER.FRAG_HEAD + leafHead,
    color: /* glsl */`
      float rho = vUvL.y, ang = vUvL.x;
      bool topF = gl_FrontFacing;
      // radial veins (~22) forking toward the rim; a fine net between them
      float nv = 21.0 + floor(vFol.z * 4.0);
      float a = ang * nv + 0.08 * sin(rho * 11.0 + vFol.z * 30.0);
      float fa = max(fwidth(a), 1e-4);
      float d1 = abs(fract(a + 0.5) - 0.5);
      float vein = (1.0 - smoothstep(0.03 + fa * 0.6, 0.08 + fa * 1.2, d1)) * smoothstep(0.02, 0.1, rho);
      float a2 = a * 2.0, d2 = abs(fract(a2 + 0.5) - 0.5);
      vein = max(vein, (1.0 - smoothstep(0.04 + fa, 0.1 + fa * 2.0, d2)) * smoothstep(0.45, 0.7, rho) * 0.7);
      vein *= clamp(1.2 - fa * 6.0, 0.0, 1.0); // fade where the veins would alias
      float net = cgVnoise2(vAux * 60.0) * 0.5 + cgVnoise2(vAux * 140.0) * 0.5;
      float mott = cgVnoise2(vAux * 4.0 + vFol.z * 9.0);
      vec3 c;
      if (topF) {
        c = mix(uTopA, uTopB, smoothstep(0.25, 0.85, mott * 0.7 + 0.3 * vFol.z));
        c *= 1.0 + 0.07 * vein + 0.05 * (net - 0.5);
        // pale centre spot (where the stalk joins) and a yellowing rim on old leaves
        c = mix(c, vec3(0.2, 0.24, 0.09), (1.0 - smoothstep(0.03, 0.09, rho)) * 0.7);
        float old = smoothstep(0.7, 1.0, vFol.z);
        c = mix(c, vec3(0.16, 0.15, 0.05), smoothstep(0.9, 1.0, rho) * old * 0.7);
      } else {
        c = uUnder * (0.85 + 0.3 * mott);
        c = mix(c, uUnder * 1.45, vein * 0.8);
      }
      c *= uTint * (0.9 + 0.2 * cgSeed);
      diffuseColor.rgb = c;
      cgLeafTrans = uTransl * mix(vec3(1.0), c / max(cgLuma(c), 0.004), 0.6) * (topF ? 1.0 : 0.7);
    `,
    normal: /* glsl */`
      // water beads on the upper face: spherical caps (lotus effect), more toward the cup centre; a small pool in some cups
      cgLeafSpec = 0.8;
      {
        float nv = 21.0 + floor(vFol.z * 4.0);
        float a = vUvL.x * nv + 0.08 * sin(vUvL.y * 11.0 + vFol.z * 30.0);
        float fa = max(fwidth(a), 1e-4);
        float hv = smoothstep(0.0, 0.12 + fa, abs(fract(a + 0.5) - 0.5)) * smoothstep(0.03, 0.15, vUvL.y) * clamp(1.2 - fa * 5.0, 0.0, 1.0);
        vec3 dpx = dFdx(cgP), dpy = dFdy(cgP);
        vec3 N = normalize(vCgWorldNormal);
        vec3 r1 = cross(dpy, N), r2 = cross(N, dpx);
        float det = dot(dpx, r1);
        vec3 grad = sign(det) * (dFdx(hv) * r1 + dFdy(hv) * r2);
        vec3 nb = normalize(abs(det) * N - grad * (gl_FrontFacing ? 0.0012 : -0.0025));
        cgBump = (nb - N) * step(1e-12, abs(det));
      }
      if (gl_FrontFacing && uBeads > 0.0) {
        vec2 lp = vAux;                                    // planar position / R
        float R = 0.32;                                    // typical leaf radius (m): bead sizes in metres
        vec2 q = lp * R / 0.045;                           // 4.5 cm cells
        vec2 ci = floor(q);
        float bead = 0.0; vec3 bn = vec3(0.0);
        for (int dx = -1; dx <= 1; dx++) for (int dy = -1; dy <= 1; dy++) {
          vec2 cc = ci + vec2(float(dx), float(dy));
          float h = lbHash(cc + vFol.z * 37.0);
          float rr = length((cc + 0.5) / (R / 0.045));
          if (h > 0.05 + 0.16 * (1.0 - smoothstep(0.1, 0.9, rr))) continue;
          vec2 bc = cc + 0.2 + 0.6 * vec2(lbHash(cc + 3.1), lbHash(cc + 7.7));
          float br = (0.06 + 0.16 * lbHash(cc + 11.3)) * (1.0 + 0.6 * (1.0 - rr));
          vec2 dv = (q - bc) / br;
          float d2 = dot(dv, dv);
          if (d2 < 1.0) { bead = 1.0; bn = vec3(dv, sqrt(1.0 - d2)); }
        }
        float pool = (1.0 - smoothstep(0.05, 0.075, length(lp))) * step(0.55, vFol.z);
        if (bead > 0.0 || pool > 0.0) {
          vec3 dp1 = dFdx(cgP), dp2 = dFdy(cgP); vec2 du1 = dFdx(lp), du2 = dFdy(lp);
          vec3 N = normalize(vCgWorldNormal);
          vec3 t1 = cross(dp2, N), t2 = cross(N, dp1);
          vec3 T = t1 * du1.x + t2 * du2.x, B = t1 * du1.y + t2 * du2.y;
          float im = inversesqrt(max(max(dot(T, T), dot(B, B)), 1e-12));
          vec3 nW = pool > 0.0 && bead == 0.0 ? N : normalize(T * im * bn.x + B * im * bn.y + N * bn.z);
          cgBump = nW - N;
          diffuseColor.rgb *= 0.8;
          cgLeafSpec = 1.6;
          cgLeafTrans *= 0.5;
          vBeadCg = 1.0;
        }
      }
    `,
    roughness: 'roughnessFactor = gl_FrontFacing ? 0.5 : 0.72; if (vBeadCg > 0.5) roughnessFactor = 0.06;',
    ao: SHADER.FOL_AO,
  });
  // bead flag shared between the normal and roughness hooks
  const prev = m.onBeforeCompile;
  m.onBeforeCompile = function (shader, r) {
    prev.call(this, shader, r);
    shader.fragmentShader = shader.fragmentShader.replace('void main() {', 'float vBeadCg = 0.0;\nvoid main() {');
    // the roughness hook runs before the normal hook in three's chunk order: re-apply after normals
    shader.fragmentShader = shader.fragmentShader.replace('#include <lights_physical_fragment>', 'if (vBeadCg > 0.5) roughnessFactor = 0.06;\n#include <lights_physical_fragment>');
  };
  SHADER.finishLeaf(m);
  m.userData.shaderKey += ':lotusleaf2';
  const k = m.userData.shaderKey; m.customProgramCacheKey = () => k;
  return registerSeasonal(m, { kind: 'lotus', seasons: LOTUS_SEASONS, tint: [[1, 1, 1], [1, 1, 1], [1.5, 1.05, 0.55], [1, 1, 1]] });
}

function stalkMaterial() {
  const u = { ...SHADER.folUniforms({ transl: [0.15, 0.2, 0.05], tipAmt: 0, amb: 1, up: 0, gain: 1 }) };
  const m = proceduralMaterial({
    name: 'veg-lotus-stalk',
    params: { color: 0xffffff, roughness: 0.5, metalness: 0 },
    uniforms: u, vertexHead: SHADER.VERT_HEAD, vertexPre: SHADER.VERT_WIND, head: SHADER.FRAG_HEAD,
    color: /* glsl */`
      vec3 c = vec3(0.07, 0.11, 0.035) * (0.85 + 0.3 * cgVnoise2(cgP.xz * 40.0 + cgP.y * 3.0));
      // tiny dark prickles
      c *= 1.0 - 0.5 * smoothstep(0.82, 0.92, cgVnoise3(cgP * 260.0));
      // darker, wet and algae-stained below the water line
      c = mix(c, vec3(0.03, 0.035, 0.02), 1.0 - smoothstep(-0.05, 0.08, cgP.y));
      diffuseColor.rgb = c * uTint;
    `,
  });
  return registerSeasonal(m, { kind: 'lotus', seasons: LOTUS_SEASONS, tint: [[1, 1, 1], [1, 1, 1], [1.4, 1.0, 0.6], [1, 1, 1]] });
}

function petalMaterial() {
  const u = { ...SHADER.folUniforms({ transl: [0.75, 0.5, 0.55], tipAmt: 0, amb: 1.1, up: 0, gain: 1 }) };
  const m = proceduralMaterial({
    name: 'veg-lotus-petal',
    params: { color: 0xffffff, roughness: 0.45, metalness: 0, side: THREE.DoubleSide },
    uniforms: u,
    vertexHead: SHADER.VERT_HEAD + 'varying vec2 vUvL;\n', vertexPre: SHADER.VERT_WIND + 'vUvL = uv;\n',
    head: SHADER.FRAG_HEAD + 'varying vec2 vUvL;\n',
    color: /* glsl */`
      float v = vUvL.y, x = abs(vUvL.x - 0.5) * 2.0;
      vec3 white = vec3(0.86, 0.8, 0.74), pink = vec3(0.86, 0.36, 0.5), deep = vec3(0.72, 0.16, 0.34);
      float k = smoothstep(0.25, 0.95, v + 0.25 * x * x) * (0.75 + 0.4 * vFol.z);
      vec3 c = mix(white, pink, clamp(k, 0.0, 1.0));
      c = mix(c, deep, smoothstep(0.8, 1.0, v) * smoothstep(0.3, 1.0, x + 0.4) * 0.6);
      c = mix(c, vec3(0.75, 0.78, 0.5), (1.0 - smoothstep(0.0, 0.18, v)) * 0.5); // greenish-cream base
      // fine longitudinal veins
      float vn = abs(fract(vUvL.x * 13.0) - 0.5);
      c *= 1.0 - 0.08 * (1.0 - smoothstep(0.0, 0.12, vn)) * smoothstep(0.2, 0.9, v);
      diffuseColor.rgb = c * uTint;
      cgLeafTrans = uTransl * c / max(cgLuma(c), 0.01) * 0.6;
    `,
    normal: SHADER.FOL_NORMAL,
    ao: SHADER.FOL_AO,
  });
  SHADER.finishLeaf(m);
  m.userData.shaderKey += ':lotuspetal';
  const k = m.userData.shaderKey; m.customProgramCacheKey = () => k;
  return registerSeasonal(m, { kind: 'lotus', seasons: [0, 1, 0, 0], tint: [[1, 1, 1], [1, 1, 1], [1, 1, 1], [1, 1, 1]] });
}

function heartMaterial() {
  const u = { ...SHADER.folUniforms({ transl: [0.3, 0.3, 0.05], tipAmt: 0, amb: 1, up: 0, gain: 1 }) };
  const m = proceduralMaterial({
    name: 'veg-lotus-heart',
    params: { color: 0xffffff, roughness: 0.55, metalness: 0, side: THREE.DoubleSide },
    uniforms: u,
    vertexHead: SHADER.VERT_HEAD + 'varying vec2 vUvL;\n', vertexPre: SHADER.VERT_WIND + 'vUvL = uv;\n',
    head: SHADER.FRAG_HEAD + 'varying vec2 vUvL;\n',
    color: /* glsl */`
      // aAux.x: 0 seed face, 1 cone side, 2 stamens; aAux.y: 1 = seed pod (green, bigger)
      vec3 c;
      if (vAux.x > 1.5) c = mix(vec3(0.75, 0.55, 0.12), vec3(0.85, 0.7, 0.2), vUvL.y);
      else if (vAux.x > 0.5) c = mix(vec3(0.3, 0.4, 0.1), vec3(0.12, 0.2, 0.06), vAux.y);
      else {
        vec2 q = (vUvL - 0.5) * 2.0;
        float r = length(q), a = atan(q.y, q.x);
        // seed holes on rings
        float ring = floor(r * 3.2 + 0.5);
        float n = max(1.0, ring * 6.0);
        float aa = fract(a / 6.2831 * n + ring * 0.37);
        float hole = (1.0 - smoothstep(0.08, 0.16, length(vec2((aa - 0.5) / n * 6.2831 * max(r, 0.1), fract(r * 3.2 + 0.5) - 0.5) / 0.32))) * step(r, 0.95);
        c = mix(vec3(0.62, 0.62, 0.22), vec3(0.18, 0.3, 0.08), vAux.y);
        c = mix(c, c * 0.35, hole);
      }
      diffuseColor.rgb = c * uTint;
    `,
    ao: SHADER.FOL_AO,
  });
  return registerSeasonal(m, { kind: 'lotus', seasons: LOTUS_SEASONS, tint: [[1, 1, 1], [1, 1, 1], [1.3, 0.9, 0.5], [1, 1, 1]] });
}

let MATS = null;
export function lotusMaterials() {
  if (!MATS) MATS = { leaf: leafMaterial(), stalk: stalkMaterial(), petal: petalMaterial(), heart: heartMaterial() };
  return MATS;
}

// ======================================================================== library + placement
export function buildLotusLibrary(sys, engine) {
  const t0 = performance.now();
  const det = engine.quality.detail ?? 1;
  const M = lotusMaterials();
  const lib = { float: [], low: [], mid: [], tall: [], flower: [], half: [], bud: [], pod: [] };
  const counts = { float: 3, low: 4, mid: 4, tall: 3, flower: 4, half: 2, bud: 3, pod: 2 };
  let tris0 = 0;
  for (const [kind, n] of Object.entries(counts)) {
    for (let i = 0; i < n; i++) {
      const isLeaf = ['float', 'low', 'mid', 'tall'].includes(kind);
      const t = isLeaf ? leafVariant(kind + i, kind, det) : flowerVariant(kind + i, kind, det);
      tris0 = Math.max(tris0, t.lods[0].tris);
      const v = sys.addVariant({
        name: `lotus-${kind}-${i}`, kind: 'lotus', lods: t.lods, H: isLeaf ? t.H : 0.35,
        px: isLeaf ? [70, 20, 5] : [40, 12, 4], cullPx: 1.5, shadowLod: 0,
        ctrK: isLeaf ? t.stalkH / t.H : t.stalkH / 0.35, radK: isLeaf ? 0.8 : 1.5,
        materials: { leaf: M.leaf, stalk: M.stalk, petal: M.petal, heart: M.heart },
      });
      v.topH = isLeaf ? t.stalkH : t.top[1];   // height of the leaf / flower head above the plant's base
      lib[kind].push(v);
    }
  }
  console.log(`[vegetation] lotus library ${Object.entries(counts).map(([k, n]) => k + '×' + n).join(' ')} (LOD0 ≤ ${tris0} tris) in ${Math.round(performance.now() - t0)} ms`);
  return lib;
}

/**
 * fill lotus zones: zones = [{ polygon }] (layout PLANTS with species 'lotus'), density per 100 m² (min 100 near
 * cameras that look at the pond). Leaves sit on the water (y = layout.WATER_LEVEL).
 */
export function placeLotus(engine, sys, lib, zones) {
  let n = 0;
  const W = L.WATER_LEVEL ?? 0;
  for (const [zi, Z] of zones.entries()) {
    const poly = Z.polygon;
    if (!poly) continue;
    const x0 = Math.min(...poly.map((p) => p[0])), x1 = Math.max(...poly.map((p) => p[0]));
    const z0 = Math.min(...poly.map((p) => p[1])), z1 = Math.max(...poly.map((p) => p[1]));
    const dens = Math.max(Z.density || 60, 165) / 100;
    const cell = 1 / Math.sqrt(dens);
    for (let i = Math.floor(x0 / cell); i <= Math.ceil(x1 / cell); i++) for (let j = Math.floor(z0 / cell); j <= Math.ceil(z1 / cell); j++) {
      const x = (i + 0.05 + 0.9 * hash01(i, j, zi, 1)) * cell, z = (j + 0.05 + 0.9 * hash01(i, j, zi, 2)) * cell;
      const sd = sdPolygon(x, z, poly);
      if (sd > 0) continue;
      // ragged pond edge: thinner near the polygon boundary
      if (sd > -6 && hash01(i, j, zi, 3) > (-sd / 6)) continue;
      if (!engine.footprints.isFree(x, z, 0.4)) continue;
      const h = hash01(i, j, zi, 4);
      const kind = h < 0.16 ? 'float' : h < 0.42 ? 'low' : h < 0.8 ? 'mid' : 'tall';
      const arr = lib[kind];
      const v = arr[Math.floor(hash01(i, j, zi, 5) * arr.length) % arr.length];
      // tilt: most leaves lean 5-25°, a few 30-55° (undersides showing)
      const tr = hash01(i, j, zi, 6);
      const tilt = kind === 'float' ? 0 : tr < 0.8 ? 0.08 + 0.35 * tr : 0.55 + 0.5 * (tr - 0.8) * 5 * 0.4;
      const ta = hash01(i, j, zi, 7) * TAU;
      const up = [Math.sin(tilt) * Math.cos(ta), Math.cos(tilt), Math.sin(tilt) * Math.sin(ta)];
      const sc = 0.85 + 0.35 * hash01(i, j, zi, 8);
      sys.add(v, x, W, z, hash01(i, j, zi, 9) * TAU, sc, { up, hs: 0.85 + 0.35 * hash01(i, j, zi, 10) });
      n++;
      // flowers, half-open flowers, buds and pods among the leaves
      const f = hash01(i, j, zi, 11);
      if (f < 0.1) {
        const fk = f < 0.045 ? 'flower' : f < 0.062 ? 'half' : f < 0.085 ? 'bud' : 'pod';
        const fa = lib[fk];
        const fv = fa[Math.floor(hash01(i, j, zi, 12) * fa.length) % fa.length];
        // in the gap between four leaves (the corner of the cell), so the stalk rises between them
        const fx = (i + 1 + (hash01(i, j, zi, 13) - 0.5) * 0.2) * cell, fz = (j + 1 + (hash01(i, j, zi, 14) - 0.5) * 0.2) * cell;
        const ft = 0.05 + 0.15 * hash01(i, j, zi, 15), fta = hash01(i, j, zi, 16) * TAU;
        sys.add(fv, fx, W, fz, hash01(i, j, zi, 17) * TAU, 0.9 + 0.2 * hash01(i, j, zi, 18), { up: [Math.sin(ft) * Math.cos(fta), Math.cos(ft), Math.sin(ft) * Math.sin(fta)] });
        n++;
      }
    }
  }
  // the ink look: the big blooms of ink03 in the foreground of an ink camera (src/ink/styles.js INK_LOTUS): a flower
  // scaled k times with its base sunk so its head stands `head` m over the water among the leaves (the painting enlarges
  // what the eye goes to; the leaves keep their size)
  if (engine.params?.get?.('look') === 'ink') {
    for (const list of Object.values(INK_LOTUS || {})) for (const [k, b] of list.entries()) {
      const arr = lib[b.kind || 'flower'];
      if (!arr?.length) continue;
      const v = arr[k % arr.length];
      const y = W + (b.head ?? 1.5) - (v.topH ?? 1.3) * b.k;
      const ft = b.tilt ?? 0.12, fta = hash01(k, 7, 31) * TAU;
      sys.add(v, b.at[0], y, b.at[1], hash01(k, 7, 32) * TAU, b.k, { up: [Math.sin(ft) * Math.cos(fta), Math.cos(ft), Math.sin(ft) * Math.sin(fta)] });
      n++;
    }
  }
  return n;
}
