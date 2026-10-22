// Assembly of a building from 《营造法式》 parts: storeys (柱網 + 鋪作 + walls), 副階周匝, 腰檐, 平坐 + 勾闌, roofs,
// bases (階基, 墩台, piles), all in one building-local frame (floor of the ground storey at y 0, front toward +Z).
// Static parts are merged per material family; bracket sets are InstancedMeshes (one per unit shape); AO is baked
// over everything (ao.js) so crevices, eaves and storeys shade each other.
//
//   const A = new Assembly({ lod: 0, seed: 'hall-1' });
//   const p1 = A.plan({ bays: 5, ... });
//   A.platform(p1); A.storey(p1, 0); A.roof(p1, 0);
//   const { group, info } = A.finish();
import * as THREE from 'three';
import { MeshBuilder, PAINT } from './geom.js';
import { makePlan } from './plan.js';
import { buildUnit, buildCornerUnit, buildBatouUnit } from './dougong.js';
import { buildPlatform, buildColumns, buildFacadeBeams, buildWalls, facadePoint, beam, wallSlab, polyCap, quadOut } from './body.js';
import { roofSpec, makeRoof, buildRoof, sweepLine } from './roof.js';
import { hallMaterials } from './materials.js';
import { bakeAO } from './ao.js';
import * as F from './fashi.js';
import * as O from './ornaments.js';
import { RNG } from '../core/rng.js';

const FAMILIES = ['wood', 'plaster', 'stone', 'tile', 'dark', 'glow', 'metal'];
const T4 = (x, y, z) => new THREE.Matrix4().makeTranslation(x, y, z);

export class Assembly {
  /** @param {object} o lod (0 full · 1 no brackets detail / tile rows / rafters · 2 massing), ao (bake), seed */
  constructor({ lod = 0, ao = true, seed = 'yingzao', name = 'building' } = {}) {
    this.lod = lod; this.ao = ao; this.name = name;
    this.rng = new RNG(String(seed));
    this.B = Object.fromEntries(FAMILIES.map((k) => [k, new MeshBuilder()]));
    this.units = new Map();   // key → { B (metres), mats: Matrix4[] }
    this.t0 = performance.now();
    this.anchors = { lanterns: [], top: 0, roofs: [] };
  }
  plan(params) { return makePlan(params); }

  /** append a builder set (object of family → MeshBuilder) translated by y0 */
  put(parts, y0 = 0, M = null) {
    const m = M || (y0 ? T4(0, y0, 0) : null);
    for (const [k, b] of Object.entries(parts)) if (b && b.count) this.B[k].append(b, m);
  }

  // ------------------------------------------------------------------------------------------- platform / bases
  /** 階基 under a plan (see body.buildPlatform for options) + optional 勾闌 along its edge */
  platform(plan, o = {}) {
    const S = new MeshBuilder();
    const r = buildPlatform(plan, S, o);
    this.put({ stone: S }, o.y0 || 0);
    if (o.rail) {
      const gaps = r.steps.map((k) => {
        const f = plan.facades[k];
        const bw = plan.m(f.bays[Math.floor(f.bays.length / 2)]) + 2 * F.STEP.fuziCun * F.CUN;
        return { face: k, half: bw / 2 };
      });
      const H = o.rail === true ? null : o.rail;
      for (let k = 0; k < r.verts.length; k++) {
        const a = r.verts[(k - 1 + r.verts.length) % r.verts.length], b = r.verts[k];
        const inset = 0.18;
        const f = plan.facades[k];
        const A = [a[0] - f.n[0] * inset, (o.y0 || 0), a[1] - f.n[1] * inset], Bp = [b[0] - f.n[0] * inset, (o.y0 || 0), b[1] - f.n[1] * inset];
        const g = gaps.find((q) => q.face === k);
        if (g) {
          const mid = [(A[0] + Bp[0]) / 2, A[1], (A[2] + Bp[2]) / 2], L = Math.hypot(Bp[0] - A[0], Bp[2] - A[2]);
          const u = [(Bp[0] - A[0]) / L, (Bp[2] - A[2]) / L];
          this.railing([A, [mid[0] - u[0] * g.half, A[1], mid[2] - u[1] * g.half]], { stone: o.kind === PAINT.MARBLE || o.railStone, height: H });
          this.railing([[mid[0] + u[0] * g.half, A[1], mid[2] + u[1] * g.half], Bp], { stone: o.kind === PAINT.MARBLE || o.railStone, height: H });
        } else this.railing([A, Bp], { stone: o.kind === PAINT.MARBLE || o.railStone, height: H });
      }
    }
    return r;
  }

  /** 墩台: a battered brick base (city gates, 阙, 鼓樓) with an optional 過梁式 gate passage and a parapet.
   *  o: w, d (top size, m), h, batter (run per m of height), gate { w, h } (passage along z), parapet */
  dun({ w, d, h, batter = 0.08, gate = null, parapet = true, y0 = 0 } = {}) {
    const S = new MeshBuilder(), Dk = new MeshBuilder(), Wd = new MeshBuilder();
    const bw = w / 2 + h * batter, bd = d / 2 + h * batter;     // footprint half sizes
    const top = [[w / 2, d / 2], [w / 2, -d / 2], [-w / 2, -d / 2], [-w / 2, d / 2]];
    const bot = [[bw, bd], [bw, -bd], [-bw, -bd], [-bw, bd]];
    const ctr = [0, y0 - h / 2, 0];
    const gw = gate ? gate.w / 2 : 0, gh = gate ? gate.h : 0;
    for (let k = 0; k < 4; k++) {
      const a = k, b = (k + 1) % 4;
      const A0 = [bot[a][0], y0 - h - 0.5, bot[a][1]], B0 = [bot[b][0], y0 - h - 0.5, bot[b][1]], B1 = [top[b][0], y0, top[b][1]], A1 = [top[a][0], y0, top[a][1]];
      const faceZ = Math.abs(A1[2] - B1[2]) < 1e-6; // a face parallel to x (front/back): the gate pierces these
      const nu = Math.max(2, Math.ceil(Math.hypot(B1[0] - A1[0], B1[2] - A1[2]) / 0.8)), nv = Math.max(2, Math.ceil(h / 0.8));
      const L = (p, q, t) => [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t, p[2] + (q[2] - p[2]) * t];
      for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
        const P = (u, v) => L(L(A0, B0, u), L(A1, B1, u), v);
        const p00 = P(i / nu, j / nv), p10 = P((i + 1) / nu, j / nv), p11 = P((i + 1) / nu, (j + 1) / nv), p01 = P(i / nu, (j + 1) / nv);
        const cx = (p00[0] + p11[0]) / 2, cy = (p00[1] + p11[1]) / 2;
        if (gate && faceZ && Math.abs(cx) < gw && cy < y0 - h + gh + 0.5) continue; // the opening
        const uv = [[i * 0.8, j * 0.8], [(i + 1) * 0.8, j * 0.8], [(i + 1) * 0.8, (j + 1) * 0.8], [i * 0.8, (j + 1) * 0.8]];
        quadOut(S, p00, p10, p11, p01, ctr, [PAINT.BRICK, 0, 1, 0], uv);
      }
    }
    polyCap(S, top, y0, PAINT.BRICK, true);
    if (gate) {
      // the passage: brick side walls, a timber 過梁 frame (排叉柱 lining the walls, a flat lintel) and darkness
      const yb = y0 - h - 0.5, yt = y0 - h + gh;
      for (const sx of [-1, 1]) {
        wallSlab(S, [sx * gw, 0, bd + 0.1], [sx * gw, 0, -bd - 0.1], gh + 0.5, 0.02, PAINT.BRICK, { y0: yb, sides: [sx > 0 ? -1 : 1], top: false, ends: false, cell: 0.8 });
        const n = Math.max(3, Math.round((2 * bd) / 0.9));
        for (let i = 0; i <= n; i++) { const z = -bd + (2 * bd * i) / n; Wd.box(sx * gw - (sx > 0 ? 0.14 : 0), yb + 0.5, z - 0.08, sx * gw + (sx > 0 ? 0 : 0.14), yt, z + 0.08, PAINT.PLANK, 'z'); }
      }
      Wd.box(-gw, yt - 0.3, -bd - 0.1, gw, yt, bd + 0.1, PAINT.PLANK, 'x');
      Dk.box(-gw, yt, -bd, gw, yt + 0.02, bd, PAINT.DARK, 'x');
    }
    if (parapet) {
      // 女牆: a low brick parapet along the top edge, open at the front and back middle (steps / gate tower)
      for (let k = 0; k < 4; k++) {
        const a = top[k], b = top[(k + 1) % 4];
        wallSlab(S, [a[0] * 0.995, 0, a[1] * 0.995], [b[0] * 0.995, 0, b[1] * 0.995], 0.9, 0.36, PAINT.BRICK, { y0, cell: 0.8 });
      }
    }
    this.put({ stone: S, dark: Dk, wood: Wd });
  }

  /** 永定柱 standing in water / ground under a deck (水榭, 栈桥): posts on a grid inside `verts` (plan polygon, m) */
  piles(verts, { yTop, yBottom = -3, spacing = 2.4, r = 0.13 } = {}) {
    const Wd = new MeshBuilder();
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const [x, z] of verts) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
    const inside = (x, z) => { let ins = false; for (let i = 0, j = verts.length - 1; i < verts.length; j = i++) { const [xi, zi] = verts[i], [xj, zj] = verts[j]; if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) ins = !ins; } return ins; };
    const nx = Math.max(1, Math.round((x1 - x0) / spacing)), nz = Math.max(1, Math.round((z1 - z0) / spacing));
    for (let i = 0; i <= nx; i++) for (let j = 0; j <= nz; j++) {
      const x = x0 + 0.25 + ((x1 - x0 - 0.5) * i) / nx, z = z0 + 0.25 + ((z1 - z0 - 0.5) * j) / nz;
      if (!inside(x, z)) continue;
      const g = new MeshBuilder();
      g.lathe([[r * 1.05, 0], [r, yTop - yBottom]], 10, { kind: PAINT.PLANK, capTop: true });
      Wd.append(g, T4(x, yBottom, z));
    }
    // 搭頭木: beams over the piles carrying the deck
    for (let j = 0; j <= nz; j++) { const z = z0 + 0.25 + ((z1 - z0 - 0.5) * j) / nz; Wd.box(x0 + 0.1, yTop - 0.24, z - 0.09, x1 - 0.1, yTop, z + 0.09, PAINT.PLANK, 'x'); }
    this.put({ wood: Wd });
  }

  /** a plank deck (polygon verts, m) at y with a 雁翅版 fascia */
  deck(verts, y, { th = 0.12, fascia = 0.28 } = {}) {
    const Wd = new MeshBuilder();
    polyCap(Wd, verts, y, PAINT.PLANK, true);
    polyCap(Wd, verts, y - th, PAINT.PLANK, false);
    for (let k = 0; k < verts.length; k++) {
      const a = verts[k], b = verts[(k + 1) % verts.length];
      quadOut(Wd, [a[0], y - fascia, a[1]], [b[0], y - fascia, b[1]], [b[0], y, b[1]], [a[0], y, a[1]], [0, y, 0], [PAINT.RAFTER, 0, fascia, 0]);
    }
    this.put({ wood: Wd });
  }

  // ------------------------------------------------------------------------------------------- storeys
  /**
   * One storey's columns, façade beams, bracket sets and walls at floor height y0 (m).
   * o: walls (bool), bases (柱礎), wallTop (m: openings stop here and a plaster band runs up to the 闌額 — for a
   * 殿身 behind a 副階)
   */
  storey(plan, y0 = 0, { walls = true, bases = true, wallTop = null, columns = true } = {}) {
    const lod = this.lod;
    const Wd = new MeshBuilder(), Pl = new MeshBuilder(), St = new MeshBuilder(), Dk = new MeshBuilder(), Gl = new MeshBuilder();
    if (columns) buildColumns(plan, Wd, St, { bases, segs: lod >= 1 ? 10 : 20 });
    buildFacadeBeams(plan, Wd, Pl, { lod });
    if (walls) {
      if (wallTop !== null) {
        // the walls stop under the 副階 roof; a plaster band fills up to the 闌額
        const p2 = { ...plan, facades: plan.facades.map((f) => ({ ...f, cols: f.cols.map((c) => ({ ...c, h: Math.min(c.h, wallTop / plan.fen + F.LANE.h) })) })) };
        buildWalls(p2, Wd, Pl, Dk, Gl, { lod });
        const D = plan.m(plan.colD);
        for (const f of plan.facades) for (let i = 0; i < f.cols.length - 1; i++) {
          const P0 = (s) => [plan.m(f.along[0] * s + f.n[0] * f.off), 0, plan.m(f.along[1] * s + f.n[1] * f.off)];
          const yTopBand = plan.m(Math.min(f.cols[i].h, f.cols[i + 1].h) - F.LANE.h);
          if (yTopBand - wallTop > 0.05) wallSlab(Pl, P0(f.cols[i].s), P0(f.cols[i + 1].s), yTopBand - wallTop, D * 0.8, PAINT.PLASTER, { y0: wallTop, cell: 0.6, ends: false });
        }
      } else buildWalls(plan, Wd, Pl, Dk, Gl, { lod });
    }
    this.put({ wood: Wd, plaster: Pl, stone: St, dark: Dk, glow: Gl }, y0);
    this.units4(plan, y0);
    return { yLiao: y0 + plan.m(plan.yLiao), yTop: y0 + plan.m(plan.H0 + plan.pupaiH + plan.bracketH) };
  }

  /** bracket sets of a storey (instanced) */
  units4(plan, y0) {
    if (!plan.bracketed && !plan.batou) return;
    const { m, fen } = plan;
    const lod = this.lod;
    if (lod >= 2) {
      // massing: one shadowed band per façade where the bracket sets stand (reads right from afar, no see-through)
      const Dk = new MeshBuilder();
      for (const f of plan.facades) {
        const ya = m(f.top(0) + plan.pupaiH), yb = ya + m(plan.bracketH);
        const ext = m(f.len / 2 + plan.T * Math.tan(f.turn / 2));
        const a = [m(f.n[0] * (f.off + plan.T * 0.5)) - f.along[0] * ext, yb, m(f.n[1] * (f.off + plan.T * 0.5)) - f.along[1] * ext];
        const b = [m(f.n[0] * (f.off + plan.T * 0.5)) + f.along[0] * ext, yb, m(f.n[1] * (f.off + plan.T * 0.5)) + f.along[1] * ext];
        beam(Dk, a, b, m(plan.T) + 0.1, yb - ya, PAINT.DOU);
      }
      this.put({ wood: Dk }, y0); // painted (lit, coloured) rather than a dark band, as the refs' bracket bands read
      return;
    }
    const key = (kind, theta = 0) => `${kind}|${plan.params.puzuo}|${plan.params.ang}|${fen.toFixed(6)}|${theta.toFixed(3)}|${lod}`;
    const add = (k, make, M) => { let u = this.units.get(k); if (!u) { u = { B: make().scale(fen), mats: [] }; this.units.set(k, u); } u.mats.push(M); };
    const M = (x, y, z, rotY) => new THREE.Matrix4().makeRotationY(rotY).setPosition(x, y, z);
    for (const f of plan.facades) {
      const rot = Math.atan2(f.n[0], f.n[1]);
      for (const u of f.inner) {
        if (plan.batou && u.kind === 'bujian') continue;
        const kind = plan.batou ? 'batou' : u.kind;
        const p = facadePoint(f, u.s, 0, f.top(u.s) + plan.pupaiH).map((v) => m(v));
        add(key(kind), () => unitBuilder(plan, kind, 0, lod), M(p[0], p[1] + y0, p[2], rot));
      }
    }
    for (const c of plan.corners) {
      const rot = Math.atan2(c.bis[0], c.bis[1]);
      const kind = plan.batou ? 'batou' : 'corner';
      add(key(kind, c.theta), () => unitBuilder(plan, kind, c.theta, lod), M(m(c.x), m(c.h + plan.pupaiH) + y0, m(c.z), rot));
    }
  }

  // ------------------------------------------------------------------------------------------- roofs
  /** the roof of a storey (歇山 / 廡殿 / 悬山 / 攢尖 per plan.params.roof), or a 腰檐 ring when yaoyan is set */
  roof(plan, y0 = 0, { yaoyan = null, apex = 'baoding', ornaments = true, gableFrames = true } = {}) {
    const S = roofSpec(plan, { y0, yaoyan });
    const R = makeRoof(S);
    const r = buildRoof(R, { lod: this.lod, ornaments, apex, gableFrames });
    this.put(r);
    const apexY = R.point(0, 0, R.top - 0.01, 0)[1];
    this.anchors.roofs.push({ R, apexY });
    this.anchors.top = Math.max(this.anchors.top, apexY);
    // lantern anchors under the four (or N) eave corners
    if (!yaoyan || plan.poly) for (let k = 0; k < R.nF && R.closed; k++) {
      const p = R.point(k, R.tAt(k, R.dTip + 0.4, R.dTip + 0.4, 1), R.dTip + 0.4, -R.thick - 0.1);
      this.anchors.lanterns.push(p);
    }
    return R;
  }

  /**
   * 腰檐 ring of `lower` meeting the wall line of `upperPlan` (whose ring may be set in). slope: the 檐椽 slope of the
   * lower storey's 舉折 (approx., the 法式 gives no separate rule for 腰檐 / 副階).
   * @returns {{ top: number, wallY: number, R }} top of its 博脊 and the soffit height where it meets the wall (m)
   */
  yaoyan(lower, y0, upperPlan, { slope = null } = {}) {
    const m = lower.m;
    const Lline = m(lower.facades[0].off + lower.T);
    const wall = upperPlan ? upperPlan.m(upperPlan.facades[0].off) : m(lower.facades[0].off);
    const dTop = Math.max(m(lower.T) + 0.25, Lline - wall + 0.12);
    const R = this.roof(lower, y0, { yaoyan: { dTop, slope: slope ?? Math.min(lower.sLast, 0.55) } });
    const pTop = R.point(0, 0, dTop - 0.02, 0);
    return { top: pTop[1] + R.S.ridge.h, wallY: pTop[1] - R.thick, R };
  }

  /**
   * 平坐 between storeys: short columns hidden behind the 腰檐, 普拍方, 平坐鋪作 (卷頭, one 跳 fewer than the storey
   * above: 卷四 · 平坐), the floor on its 地面方 with a 鴈翅版 fascia, and a 勾闌 at the edge.
   * @param upperParams  the plan params of the storey above (ring geometry, 材)
   * @param yBase        height of the 平坐 columns' foot (top of the storey below's brackets), m
   * @param yBrackets    height of the 平坐 櫨枓 bottom (above the 腰檐 ridge), m
   * @returns { floorY, plan }
   */
  pingzuo(upperParams, yBase, yBrackets, { rail = true, railH = null } = {}) {
    const pz = F.pingzuoPuzuo(upperParams.puzuo >= 4 ? upperParams.puzuo : 5);
    const fen = F.fenOf(upperParams.grade);
    const H0 = Math.max(10, (yBrackets - yBase) / fen - F.PUPAI.h);
    const plan = makePlan({ ...upperParams, puzuo: pz, ang: false, H0, walls: 'open', shengqi: false });
    const Wd = new MeshBuilder(), Pl = new MeshBuilder(), St = new MeshBuilder();
    buildColumns(plan, Wd, St, { bases: false, plain: true, segs: 10 });
    buildFacadeBeams(plan, Wd, Pl, { lod: this.lod });
    this.put({ wood: Wd }, yBase);
    this.units4(plan, yBase);
    const m = plan.m;
    const floorY = yBase + m(plan.H0 + plan.pupaiH + plan.bracketH);
    // floor polygon at the 橑檐方 (地面方) line + a little
    const off = (f) => m(f.off + plan.T) + 0.08;
    const verts = ringVerts(plan.facades, off);
    const D = new MeshBuilder();
    polyCap(D, verts, floorY, PAINT.PLANK, true);
    // 鴈翅版 fascia (廣加材一倍)
    const fh = m(F.YANCHIBAN.h);
    for (let k = 0; k < verts.length; k++) {
      const a = verts[(k - 1 + verts.length) % verts.length], b = verts[k];
      quadOut(D, [a[0], floorY - fh, a[1]], [b[0], floorY - fh, b[1]], [b[0], floorY, b[1]], [a[0], floorY, a[1]], [0, floorY, 0], [PAINT.ZHU, 0, fh, 0]);
    }
    polyCap(D, verts, floorY - fh, PAINT.RAFTER, false);
    this.put({ wood: D });
    if (rail) {
      const rv = ringVerts(plan.facades, (f) => off(f) - 0.12);
      this.railing([...rv.map(([x, z]) => [x, floorY, z]), [rv[0][0], floorY, rv[0][1]]], { height: railH });
    }
    return { floorY, plan };
  }

  // ------------------------------------------------------------------------------------------- 勾闌
  /**
   * 單勾闌 (卷八; wood, red) or stone 勾闌 (卷三; white) along a polyline [[x,y,z], ...] (y = foot level).
   * Parts: 地栿, 華版 between 蜀柱, 盆脣, 癭項 / 雲栱 carrying the 尋杖, 望柱 at the ends and corners (stone: every 段).
   */
  railing(pts, { stone = false, height = null, posts = 'corners' } = {}) {
    const B = stone ? new MeshBuilder() : new MeshBuilder();
    const H = height ?? (stone ? F.GOULAN.dan.hChi * F.CHI * 1.05 : F.GOULAN.dan.hChi * F.CHI);
    const kind = stone ? PAINT.MARBLE : PAINT.WOOD;
    const seg = (stone ? F.GOULAN.dan.panelChi : 3.2) * F.CHI;  // 段 length (stone 每段長六尺; wood bays approx.)
    const pw = H * (stone ? 0.16 : 0.09);                         // 望柱 / 蜀柱 section
    const lod = this.lod;
    const post = (p, big) => {
      const w = big ? pw : pw * 0.65, hh = big ? H * 1.18 : H * 0.92;
      B.box(p[0] - w / 2, p[1], p[2] - w / 2, p[0] + w / 2, p[1] + hh, p[2] + w / 2, kind, 'x');
      if (big && lod === 0) O.latheAt(B, [[w * 0.55, 0], [w * 0.62, w * 0.25], [w * 0.4, w * 0.55], [w * 0.45, w * 0.8], [0.0, w * 1.1]], 10, { o: [p[0], p[1] + hh, p[2]], kind });
    };
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      const L = Math.hypot(b[0] - a[0], b[2] - a[2]);
      if (L < 0.05) continue;
      const n = Math.max(1, Math.round(L / seg));
      const at = (t, dy = 0) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t + dy, a[2] + (b[2] - a[2]) * t];
      // rails: 地栿, 盆脣, 尋杖
      beam(B, at(0, 0.09), at(1, 0.09), pw * 0.9, 0.09, kind);
      beam(B, at(0, H * 0.56), at(1, H * 0.56), pw * 0.95, H * 0.06, kind);
      const rr = H * 0.028;
      const top = [at(0, H - rr), at(1, H - rr)];
      sweepLine(B, top, () => [0, 1, 0], [[rr, 0], [rr * 0.7, rr * 0.7], [0, rr], [-rr * 0.7, rr * 0.7], [-rr, 0], [-rr * 0.7, -rr * 0.7], [0, -rr], [rr * 0.7, -rr * 0.7]], kind);
      for (let j = 0; j <= n; j++) {
        const t = j / n;
        const end = j === 0 || j === n;
        if (end || stone || posts === 'all') post(at(t), end || stone);
        else post(at(t), false);
        if (j < n) {
          // 華版 between 地栿 and 盆脣 (stone: solid; wood: a 勾片 frame), 癭項 under the 尋杖 mid-段
          const t0 = t + 0.06 / n, t1 = (j + 1) / n - 0.06 / n;
          if (stone || lod >= 1) beam(B, at(t0, H * 0.5), at(t1, H * 0.5), pw * 0.35, H * 0.5 - 0.09, kind, { faces: 0b000011 });
          else {
            const tm = (t0 + t1) / 2;
            beam(B, at(t0, H * 0.33), at(t1, H * 0.33), pw * 0.3, 0.035, kind);
            for (const tt of [t0 + (t1 - t0) * 0.33, t0 + (t1 - t0) * 0.67]) { const p = at(tt, 0.09); B.box(p[0] - 0.016, p[1], p[2] - 0.016, p[0] + 0.016, p[1] + H * 0.47 - 0.09, p[2] + 0.016, kind, 'x'); }
            void tm;
          }
          const pm = at((t + (j + 1) / n) / 2, H * 0.62);
          B.box(pm[0] - pw * 0.25, pm[1], pm[2] - pw * 0.25, pm[0] + pw * 0.25, pm[1] + H * 0.33, pm[2] + pw * 0.25, kind, 'x');
        }
      }
    }
    this.put(stone ? { stone: B } : { wood: B });
  }

  /** paper lanterns hanging at points [[x,y,z], ...] (lit at night through the GLOW family) */
  lanterns(points, r = 0.2) {
    const Wd = new MeshBuilder(), Gl = new MeshBuilder();
    for (const p of points) O.lantern(Wd, Gl, p, r, 0.3);
    this.put({ wood: Wd, glow: Gl });
  }

  // ------------------------------------------------------------------------------------------- finish
  /** bake AO, build meshes. returns { group, info } */
  finish() {
    const mats = hallMaterials();
    const group = new THREE.Group();
    group.name = this.name;
    // AO
    let aoInfo = null;
    if (this.ao && this.lod <= 1) {
      const occl = FAMILIES.filter((k) => this.B[k].count && k !== 'glow').map((k) => ({ B: this.B[k] }));
      for (const u of this.units.values()) for (const M of u.mats) occl.push({ B: u.B, M });
      const targets = FAMILIES.filter((k) => this.B[k].count).map((k) => ({ B: this.B[k] }));
      for (const u of this.units.values()) targets.push({ B: u.B, M: u.mats[Math.floor(u.mats.length / 2)] });
      // ao: true (cells by lod) or a cell size in metres (the explorable world bakes coarser, ~6x faster)
      const cell = typeof this.ao === 'number' ? this.ao : this.lod ? 0.1 : 0.055;
      aoInfo = bakeAO({ targets, occluders: occl, cell, coarse: Math.max(0.25, cell * 2.5) });
    }
    let tris = 0, calls = 0;
    for (const k of FAMILIES) {
      const B = this.B[k];
      if (!B.count) continue;
      const mesh = new THREE.Mesh(B.toGeometry(), mats[k]);
      mesh.name = `${this.name}:${k}`;
      mesh.castShadow = k !== 'dark' && k !== 'glow'; mesh.receiveShadow = true;
      group.add(mesh);
      tris += B.count / 3; calls++;
    }
    for (const [key, u] of this.units) {
      const g = u.B.toGeometry();
      const im = new THREE.InstancedMesh(g, mats.wood, u.mats.length);
      u.mats.forEach((M, i) => im.setMatrixAt(i, M));
      im.instanceMatrix.needsUpdate = true;
      im.computeBoundingSphere();
      im.name = `${this.name}:puzuo:${key.split('|')[0]}`;
      im.castShadow = true; im.receiveShadow = true;
      group.add(im);
      tris += (u.B.count / 3) * u.mats.length; calls++;
    }
    const box = new THREE.Box3().setFromObject(group);
    const info = {
      ms: Math.round(performance.now() - this.t0), tris: Math.round(tris), calls,
      units: [...this.units.values()].reduce((s, u) => s + u.mats.length, 0),
      size: box.getSize(new THREE.Vector3()).toArray().map((v) => +v.toFixed(2)), top: +box.max.y.toFixed(2), bottom: +box.min.y.toFixed(2),
      ao: aoInfo, anchors: this.anchors,
    };
    group.userData.yingzao = info;
    return { group, info };
  }
}

/** polygon of façade lines pushed out by off(f) (m), intersected with their neighbours */
export function ringVerts(facades, off) {
  const verts = [];
  for (let k = 0; k < facades.length; k++) {
    const f = facades[k], g = facades[(k + 1) % facades.length];
    const pf = off(f), pg = off(g);
    const det = f.n[0] * g.n[1] - f.n[1] * g.n[0];
    verts.push([(pf * g.n[1] - pg * f.n[1]) / det, (f.n[0] * pg - g.n[0] * pf) / det]);
  }
  return verts;
}

/** bracket unit builder in 分 (full, or a blocky proxy at lod 1) */
function unitBuilder(plan, kind, theta, lod) {
  if (lod === 0) {
    if (kind === 'corner') return buildCornerUnit(plan, theta);
    if (kind === 'batou') return buildBatouUnit();
    return buildUnit(plan, kind);
  }
  // lod 1: stepped blocks following the 跳 (reads right from 50 m on)
  const B = new MeshBuilder();
  const N = Math.max(1, plan.N);
  B.box(-14, 0, -14, 14, 20, 14, PAINT.DOU, 'x');
  const dirs = kind === 'corner' ? [[-Math.sin(theta / 2), Math.cos(theta / 2)], [Math.sin(theta / 2), Math.cos(theta / 2)], [0, 1]] : [[0, 1]];
  for (let t = 0; t <= N; t++) {
    const y0 = plan.tierY(t), y1 = y0 + 21;
    const half = 31 + 10 * Math.min(t, 2);
    for (const d of dirs) {
      const reach = 30 * t + 12;
      const g = new MeshBuilder();
      g.box(-half, y0, -10, half, y1, reach, PAINT.MEMBER, 'x');
      const rot = Math.atan2(d[0], d[1]);
      B.append(g, new THREE.Matrix4().makeRotationY(rot));
    }
  }
  return B;
}
