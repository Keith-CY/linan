// 鋪作 (bracket sets), modelled in 分 after 卷四 (材, 栱, 飛昂, 爵頭, 枓, 總鋪作次序) — see fashi.js for the quotes.
//
// One unit = everything that belongs to one bracket set: 櫨枓, the projecting 華栱 / 下昂 per tier, the
// transverse 泥道栱 / 慢栱 on the wall line, 瓜子栱 + 慢栱 on every inner 跳頭 (重栱計心造), the 令栱 on the
// outermost 跳頭, 耍頭, and every 交互枓 / 散枓 / 齊心枓. The continuous members (柱頭方, 羅漢方, 橑檐方) run
// along the façade and are built by hall.js, so the unit can be instanced.
//
// Local frame (分): origin at the bottom centre of the 櫨枓, +Z outward (away from the building), +X along the
// wall, +Y up. Corner units: +X and +Z are the two outward façade normals; the 角栱 run along the diagonal.
// Vertical grid: tier t bottom = 12 + 21 t (the 櫨枓 is 20 high with an 8 分 耳; every tier = 材 15 + 栔 6).
import { MeshBuilder, PAINT } from './geom.js';
import * as F from './fashi.js';

// ------------------------------------------------------------------ members
/** 卷殺 outline of one 栱頭 (rising part), 'string-art' envelope of the 法式 construction: the 9 分 under the
 *  6 分 kept at the top are divided into `ban` parts, the bottom into `ban` 瓣 of banLen; chord k joins the k-th
 *  bottom mark (from inside) with the k-th height mark (from below). Returns points from the bottom (inner) to the
 *  end face (s measured from the 栱 end, negative inward). */
function juanSha(ban, banLen, cut = F.GONG_CUT) {
  const chords = [];
  for (let k = 1; k <= ban; k++) chords.push([[-banLen * (ban - k + 1), 0], [0, (cut * k) / ban]]);
  const pts = [[-banLen * ban, 0]];
  for (let k = 0; k < chords.length - 1; k++) {
    const [[x1, y1], [x2, y2]] = chords[k], [[x3, y3], [x4, y4]] = chords[k + 1];
    const den = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
    const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / den;
    pts.push([x1 + t * (x2 - x1), y1 + t * (y2 - y1)]);
  }
  pts.push([0, cut]);
  return pts;
}

/**
 * 栱 profile [s, y] (counter-clockwise), s ∈ [s0, s1] along the member.
 * @param {number} s0 left end, s1 right end
 * @param {object} o h (15 單材 / 21 足材), ban/banLen per end, seats: list of [sa, sb] where the top drops to 15 (足材)
 */
function gongProfile(s0, s1, { h = 15, ban = 4, banLen = 4, seats = [], leftHead = true, rightHead = true } = {}) {
  const js = juanSha(ban, banLen);
  const topAt = (x) => (h > 15 && seats.some(([sa, sb]) => x >= sa - 1e-6 && x <= sb + 1e-6) ? 15 : h);
  const P = [];
  // counter-clockwise: left end face (top of the cut) → down the left 卷殺 → bottom → up the right 卷殺 → right end face
  if (leftHead) for (let i = js.length - 1; i >= 0; i--) P.push([s0 - js[i][0], js[i][1]]);
  else P.push([s0, 0]);
  if (rightHead) for (let i = 0; i < js.length; i++) P.push([s1 + js[i][0], js[i][1]]);
  else P.push([s1, 0]);
  // top, right to left, stepping down to 單材 height under the 枓 seats of a 足材 member
  const bps = new Set();
  for (const [sa, sb] of seats) { if (sa > s0 && sa < s1) bps.add(sa); if (sb > s0 && sb < s1) bps.add(sb); }
  const xs = [s1, ...[...bps].sort((x, y) => y - x), s0];
  for (let i = 0; i < xs.length; i++) {
    const x = xs[i];
    if (i === 0) { P.push([x, topAt(x - 1e-3)]); continue; }
    const right = topAt(x + 1e-3), left = topAt(x - 1e-3);
    if (i === xs.length - 1) { P.push([x, right]); break; }
    P.push([x, right]); if (left !== right) P.push([x, left]);
  }
  return dedupe(P);
}
function dedupe(P) {
  const out = [];
  for (const p of P) { const q = out[out.length - 1]; if (!q || Math.abs(q[0] - p[0]) > 1e-6 || Math.abs(q[1] - p[1]) > 1e-6) out.push(p); }
  const f = out[0], l = out[out.length - 1];
  if (Math.abs(f[0] - l[0]) < 1e-6 && Math.abs(f[1] - l[1]) < 1e-6) out.pop();
  return out;
}

/** add a 栱 running along `axis` ('x' | 'z' | diagonal [dx,dz]) */
function gong(B, { s0, s1, y, h = 15, ban = 4, banLen = 4, seats = [], ox = 0, oz = 0, dir = [1, 0], leftHead = true, rightHead = true }) {
  const prof = gongProfile(s0, s1, { h, ban, banLen, seats, leftHead, rightHead });
  B.extrudeProfile(prof, F.CAI_HOU, { ox, oy: y, oz, dir, kind: PAINT.MEMBER, h, y0: 0 });
}

/** 枓: 欹 (tapered, slightly hollow) + 平 + 耳 (blocks around the slot). l along dir, w across. */
function dou(B, { x, y, z, spec, slot = 'cross', dir = [1, 0], noEar = false }) {
  const { l, w, er, ping, qi, sha } = spec;
  const dx = dir[0], dz = dir[1], nx = -dz, nz = dx;
  const P = (s, t, yy) => [x + dx * s + nx * t, y + yy, z + dz * s + nz * t];
  const pa = (yy) => [PAINT.DOU, yy, er + ping + qi, 0];
  // 欹: bottom (l-2sha × w-2sha) → top full, with a hollow (䫜) at mid height
  const rings = [[l / 2 - sha, w / 2 - sha, 0], [l / 2 - sha * 0.62, w / 2 - sha * 0.62, qi * 0.45], [l / 2, w / 2, qi]];
  for (let r = 0; r < rings.length - 1; r++) {
    const [a0, b0, y0] = rings[r], [a1, b1, y1] = rings[r + 1];
    const c0 = [[-a0, -b0], [a0, -b0], [a0, b0], [-a0, b0]], c1 = [[-a1, -b1], [a1, -b1], [a1, b1], [-a1, b1]];
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4;
      B.quad(P(c0[i][0], c0[i][1], y0), P(c1[i][0], c1[i][1], y1), P(c1[j][0], c1[j][1], y1), P(c0[j][0], c0[j][1], y0), pa(y0), pa(y1), pa(y1), pa(y0));
    }
  }
  // bottom face
  { const a0 = l / 2 - sha, b0 = w / 2 - sha; B.quad(P(-a0, -b0, 0), P(a0, -b0, 0), P(a0, b0, 0), P(-a0, b0, 0), pa(0)); }
  // 平 + 耳 as boxes in the local frame
  const box = (s0, s1, t0, t1, y0, y1) => {
    const c = [P(s0, t0, y0), P(s1, t0, y0), P(s1, t1, y0), P(s0, t1, y0), P(s0, t0, y1), P(s1, t0, y1), P(s1, t1, y1), P(s0, t1, y1)];
    const q = (i0, i1, i2, i3, yy0, yy1) => B.quad(c[i0], c[i1], c[i2], c[i3], pa(yy0), pa(yy0), pa(yy1), pa(yy1));
    // sides (counter-clockwise seen from outside), top
    const qs = (i0, i1, i2, i3) => B.quad(c[i0], c[i1], c[i2], c[i3], pa(y0), pa(y1), pa(y1), pa(y0));
    qs(0, 4, 5, 1); qs(1, 5, 6, 2); qs(2, 6, 7, 3); qs(3, 7, 4, 0);
    B.quad(c[4], c[7], c[6], c[5], pa(y1), pa(y1), pa(y1), pa(y1));
    void q;
  };
  // (local frame (dir, up, n) with dir × up = n, n = (-dz, dx): a proper rotation of (x, y, z), so one winding fits all)
  box(-l / 2, l / 2, -w / 2, w / 2, qi, qi + ping);
  if (noEar) return;
  const g = F.CAI_HOU / 2; // slot half width (開口廣十分)
  if (slot === 'cross') {
    for (const [sa, sb] of [[-l / 2, -g], [g, l / 2]]) for (const [ta, tb] of [[-w / 2, -g], [g, w / 2]]) box(sa, sb, ta, tb, qi + ping, qi + ping + er);
  } else if (slot === 'along') { // member runs along dir through the slot
    box(-l / 2, l / 2, -w / 2, -g, qi + ping, qi + ping + er); box(-l / 2, l / 2, g, w / 2, qi + ping, qi + ping + er);
  } else if (slot === 'across') {
    box(-l / 2, -g, -w / 2, w / 2, qi + ping, qi + ping + er); box(g, l / 2, -w / 2, w / 2, qi + ping, qi + ping + er);
  }
}

/** 下昂 in the vertical plane of `dir`: top line through the seat (sd along dir, sy), sloping down outward */
function ang(B, { sd, sy, dir = [0, 1], ox = 0, oz = 0, inner = -70, scale = 1 }) {
  const th = (F.ANG.slopeDeg * Math.PI) / 180, c = Math.cos(th), s = Math.sin(th);
  const u = [c, -s], n = [-s, -c];
  const S = [sd, sy];
  const at = (t, k = 0) => [S[0] + u[0] * t + n[0] * k, S[1] + u[1] * t + n[1] * k];
  const tF = (9 * scale) / c, tTip = tF + F.ANG.tip * scale;
  const tIn = (inner - sd) / c;
  const A = at(tIn, F.CAI), Bt = at(tTip, F.CAI), Ct = at(tTip, F.CAI - 2), D = at(tF, 0), E = at(tIn, 0);
  const mid = at((tF + tTip) / 2, 0);
  const M = [mid[0] + n[0] * 3.2, mid[1] + n[1] * 3.2]; // 昂面 falls away from the 枓 face to the 2 分 tip, slightly hollow (琴面)
  const prof = [A, Bt, Ct, M, D, E];
  B.extrudeProfile(prof, F.CAI_HOU, { ox, oy: 0, oz, dir, kind: PAINT.MEMBER, h: F.CAI, y0: Math.min(...prof.map((p) => p[1])) });
}

/** 耍頭 (爵頭) on top tier: 足材, beak-shaped end */
function shuatou(B, { s0, s1, y, dir = [0, 1], ox = 0, oz = 0 }) {
  const h = F.ZUCAI;
  const prof = [[s0, 0], [s1 - 11, 0], [s1, h - 3], [s1 - 3, h - 3], [s1 - 3, h], [s0, h]];
  B.extrudeProfile(prof.map(([a, b]) => [a, b + y]), F.CAI_HOU, { ox, oy: 0, oz, dir, kind: PAINT.MEMBER, h, y0: y });
}

// ------------------------------------------------------------------ units
const G = F.GONG;

/**
 * @param {object} plan  from plan.js (uses N, tiers, tierY, seatY)
 * @param {'column'|'bujian'} kind
 */
export function buildUnit(plan, kind = 'column') {
  const B = new MeshBuilder();
  const { N, tiers } = plan;
  const tierY = plan.tierY, seatY = plan.seatY;
  const crossBottom = (j) => seatY(j) + 6; // transverse 栱 sitting in the 交互枓 at 跳 j
  // 櫨枓
  dou(B, { x: 0, y: 0, z: 0, spec: F.DOU.lu, slot: 'cross', dir: [1, 0] });
  // projecting members, tier k reaches 跳 k+1
  for (let k = 0; k < N; k++) {
    const reach = F.TIAO * (k + 1);
    const zu = kind === 'column'; // 華栱 足材 (補間用單材, 卷四 · 栱)
    if (tiers[k] === 'hua') {
      gong(B, { s0: -(reach + 6), s1: reach + 6, y: tierY(k), h: zu ? F.ZUCAI : F.CAI, ban: G.hua.ban, banLen: G.hua.banLen,
        seats: [[reach - 9, reach + 6], [-(reach + 6), -(reach - 9)]], dir: [0, 1] });
      dou(B, { x: 0, y: seatY(k + 1), z: -reach, spec: F.DOU.jiaohu, slot: 'cross', dir: [0, 1] }); // inner 跳頭
    } else {
      ang(B, { sd: reach, sy: seatY(k + 1), dir: [0, 1] });
      if (k > 0 && tiers[k - 1] === 'hua') {
        // 華頭子: the short 栱頭 that carries the first 昂 out of the 交互枓 below
        gong(B, { s0: F.TIAO * k - 4, s1: F.TIAO * k + 10, y: tierY(k), h: 9, ban: 2, banLen: 3, leftHead: false, dir: [0, 1] });
      }
    }
    dou(B, { x: 0, y: seatY(k + 1), z: reach, spec: F.DOU.jiaohu, slot: k + 1 < N ? 'cross' : 'cross', dir: [0, 1] });
  }
  // wall line: 泥道栱 (tier 0), 慢栱 (tier 1), with 散枓 at their ends
  gong(B, { s0: -G.nidao.len / 2, s1: G.nidao.len / 2, y: tierY(0), ban: G.nidao.ban, banLen: G.nidao.banLen });
  sanDou(B, G.nidao.len, tierY(0) + F.CAI, 0);
  if (N >= 2) {
    gong(B, { s0: -G.man.len / 2, s1: G.man.len / 2, y: tierY(1), ban: G.man.ban, banLen: G.man.banLen });
    sanDou(B, G.man.len, tierY(1) + F.CAI, 0);
  }
  // 跳頭: 瓜子栱 + 慢栱 on the inner 跳頭 (重栱計心), 令栱 on the outermost
  for (let j = 1; j <= N; j++) {
    const z = F.TIAO * j, yb = crossBottom(j);
    if (j < N) {
      gong(B, { s0: -G.guazi.len / 2, s1: G.guazi.len / 2, y: yb, ban: G.guazi.ban, banLen: G.guazi.banLen, oz: z });
      sanDou(B, G.guazi.len, yb + F.CAI, z);
      gong(B, { s0: -G.man.len / 2, s1: G.man.len / 2, y: yb + F.ZUCAI, ban: G.man.ban, banLen: G.man.banLen, oz: z });
      sanDou(B, G.man.len, yb + F.ZUCAI + F.CAI, z);
    } else {
      gong(B, { s0: -G.ling.len / 2, s1: G.ling.len / 2, y: yb, ban: G.ling.ban, banLen: G.ling.banLen, oz: z });
      sanDou(B, G.ling.len, yb + F.CAI, z);
      dou(B, { x: 0, y: yb + F.CAI, z, spec: F.DOU.qixin, slot: 'along', dir: [1, 0] });
      // 耍頭 crossing the 令栱
      shuatou(B, { s0: -F.TIAO, s1: z + 25, y: yb, dir: [0, 1] });
    }
  }
  return B;
}

function sanDou(B, len, y, z, x0 = 0) {
  for (const sx of [-1, 1]) dou(B, { x: x0 + sx * (len / 2 - 8), y, z, spec: F.DOU.san, slot: 'along', dir: [1, 0] });
}

/**
 * 轉角鋪作 for a corner of any angle. Local frame: the outward corner bisector is +Z; the two façade normals are
 * nA = (-sin h, cos h) and nB = (sin h, cos h) with h = half the turn between them (45° for a rectangle, 22.5° for an
 * octagon). Each façade carries its projecting 華栱 / 昂 and its transverse 栱 out to the bisector; the 角栱 / 角昂 run
 * along the bisector (one 跳 = 30 / cos h), with 平盤枓 where the façade lines cross it, and the 由昂 above the
 * top 角昂 carrying a 寶瓶 under the 角梁 (卷四 · 飛昂: "若角內用六鋪作以上，即於角昂之上別施由昂").
 * @param {object} plan
 * @param {number} [theta] angle between the two façade normals (rad), default 90°
 */
export function buildCornerUnit(plan, theta = Math.PI / 2) {
  const B = new MeshBuilder();
  const { N, tiers } = plan;
  const tierY = plan.tierY, seatY = plan.seatY;
  const crossBottom = (j) => seatY(j) + 6;
  const h = theta / 2, ch = Math.cos(h), sh = Math.sin(h), th = Math.tan(h);
  const bis = [0, 1];
  const nA = [-sh, ch], nB = [sh, ch];
  const oA = [ch, sh], oB = [-ch, sh];            // along each wall, pointing out past the corner
  const rect = Math.abs(theta - Math.PI / 2) < 1e-3;
  // 櫨枓 (角櫨枓 方三十六分): façade-aligned on a right-angled corner, bisector-aligned on a polygon corner
  dou(B, { x: 0, y: 0, z: 0, spec: F.DOU.luCorner, slot: 'cross', dir: rect ? oA : [1, 0] });
  for (let k = 0; k < N; k++) {
    const reach = F.TIAO * (k + 1);
    for (const dir of [nA, nB]) {
      if (tiers[k] === 'hua') gong(B, { s0: -(reach + 6), s1: reach + 6, y: tierY(k), h: F.ZUCAI, ban: G.hua.ban, banLen: G.hua.banLen, seats: [[reach - 9, reach + 6]], dir });
      else ang(B, { sd: reach, sy: seatY(k + 1), dir });
      dou(B, { x: dir[0] * reach, y: seatY(k + 1), z: dir[1] * reach, spec: F.DOU.jiaohu, slot: 'cross', dir });
    }
    // diagonal 角華栱 / 角昂
    const rd = reach / ch;
    if (tiers[k] === 'hua') gong(B, { s0: -(rd * 0.6), s1: rd + 8, y: tierY(k), h: F.ZUCAI, ban: G.hua.ban, banLen: G.hua.banLen, seats: [[rd - 9, rd + 8]], dir: bis, leftHead: false });
    else ang(B, { sd: rd, sy: seatY(k + 1), dir: bis, scale: 1 / ch * 0.9 });
    dou(B, { x: 0, y: seatY(k + 1), z: rd, spec: F.DOU.qixin, slot: 'cross', dir: [1, 0], noEar: true }); // 平盤枓
  }
  // wall lines of both façades (列栱: the 泥道栱 / 慢栱 run on past the corner), transverse 栱 at every 跳頭
  for (const [n, o] of [[nA, oA], [nB, oB]]) {
    gong(B, { s0: -6, s1: G.nidao.len / 2, y: tierY(0), ban: G.nidao.ban, banLen: G.nidao.banLen, dir: o, leftHead: false, rightHead: true });
    gong(B, { s0: -G.nidao.len / 2, s1: 6, y: tierY(0), ban: G.nidao.ban, banLen: G.nidao.banLen, dir: o, leftHead: true, rightHead: false });
    if (N >= 2) gong(B, { s0: -G.man.len / 2, s1: 6, y: tierY(1), ban: G.man.ban, banLen: G.man.banLen, dir: o, rightHead: false });
    for (let j = 1; j <= N; j++) {
      const off = F.TIAO * j, yb = crossBottom(j);
      const at = { ox: n[0] * off, oz: n[1] * off };
      const spec = j < N ? G.guazi : G.ling;
      const sEnd = off * th + 6;                      // where this 跳 line meets the bisector
      gong(B, { s0: -spec.len / 2, s1: sEnd, y: yb, ban: spec.ban, banLen: spec.banLen, dir: o, ...at, rightHead: rect });
      dou(B, { x: at.ox + o[0] * (-spec.len / 2 + 8), y: yb + F.CAI, z: at.oz + o[1] * (-spec.len / 2 + 8), spec: F.DOU.san, slot: 'along', dir: o });
      if (j < N) {
        gong(B, { s0: -G.man.len / 2, s1: sEnd, y: yb + F.ZUCAI, ban: G.man.ban, banLen: G.man.banLen, dir: o, ...at, rightHead: rect });
        dou(B, { x: at.ox + o[0] * (-G.man.len / 2 + 8), y: yb + F.ZUCAI + F.CAI, z: at.oz + o[1] * (-G.man.len / 2 + 8), spec: F.DOU.san, slot: 'along', dir: o });
      }
    }
  }
  if (N <= 0) return B;
  // 由昂 on the diagonal above the top 角昂 / 角栱 (六鋪作 and up), else a plain 角耍頭
  const zN = (F.TIAO * N) / ch;
  if (N >= 3 && plan.params.ang !== false) {
    const sy = crossBottom(N) + F.CAI + 2;
    ang(B, { sd: zN + 18, sy, dir: bis, scale: 1.25, inner: -40 });
    // 平盤枓 + 寶瓶 at its tip, under the 角梁
    const th0 = (F.ANG.slopeDeg * Math.PI) / 180;
    const tipY = sy - Math.tan(th0) * 2;
    dou(B, { x: 0, y: tipY, z: zN + 18, spec: F.DOU.qixin, slot: 'cross', dir: [1, 0], noEar: true });
    B.lathe([[5, 0], [7.5, 4], [6, 10], [3.5, 14], [4.5, 18], [6.5, 20], [6.5, 22]], 10, { oy: tipY + 6, oz: zN + 18, kind: 2, capTop: true });
  } else shuatou(B, { s0: 0, s1: zN + 30, y: crossBottom(N), dir: bis });
  return B;
}

/** 把頭絞項作 (small buildings, no 跳): 櫨枓, 泥道栱 with its 散枓, and the 耍頭 crossing it outward */
export function buildBatouUnit() {
  const B = new MeshBuilder();
  dou(B, { x: 0, y: 0, z: 0, spec: F.DOU.lu, slot: 'cross', dir: [1, 0] });
  gong(B, { s0: -G.nidao.len / 2, s1: G.nidao.len / 2, y: 12, ban: G.nidao.ban, banLen: G.nidao.banLen });
  sanDou(B, G.nidao.len, 12 + F.CAI, 0);
  shuatou(B, { s0: -20, s1: 26, y: 12, dir: [0, 1] });
  return B;
}
