// The tour video (media/tour.mp4, tools/render-video.mjs): one segment per viewpoint, each a slow camera move relative
// to the viewpoint's camera (in the ink look its ink camera, src/ink/styles.js INK_CAMS), in the look (season, time of
// day) of that viewpoint. Moves are in METRES / DEGREES relative to that camera (forward = toward the target):
//   dolly: + forward      truck: + to the right      crane: + up
//   pan / tilt: degrees (+ right / + up)            zoom: relative fov change (-0.05 = 5 % tighter)
//   orbit: degrees around the target (vertical axis)
//   focus: [from, to] metres for a depth-of-field pull (needs dof.aperture on the shot; not in the ink look)
// `at` is where along the segment the camera is exactly the viewpoint's (0 = the first frame, 0.5 = the middle, the
// default, 1 = the last frame): a move that starts on the composition (the opening), passes through it, or ends on it.
// `time` is the engine time at the segment's start (water, clouds and boats read it).
// Segments overlap by XFADE seconds (cross-dissolves are done by ffmpeg in tools/render-video.mjs); `dur` includes the
// dissolve into the next segment.
// (camera-move machinery from Athenaion)
export const FPS = 30;
export const XFADE = 1.2;      // seconds of cross-dissolve between consecutive segments
export const SHUTTER = 0.5;    // 180° shutter for the photographic look (frames)
export const INK_SHUTTER = 0.5; // the ink look's: its tone samples and its paintings spread over half a frame (player.js)

export const SEQUENCE = [
  // 西湖全景 (spring): opens on the painting itself, then drifts in over the lake past the 樓閣
  { shot: 1, dur: 7.4, time: 0, at: 0, move: { dolly: 18, crane: -3, pan: 0.8 }, ease: 'inout' },
  // 苏堤春晓 (spring dawn): down the slab path under the willows and the peach blossom toward the arch
  // (it starts on the viewpoint: behind it, the ground strokes' lattice, foreshortened from the viewpoint, would ring)
  { shot: 2, dur: 7.0, time: 10, at: 0, move: { dolly: 10 }, ease: 'inout' },
  // 曲院风荷 (summer): along the lotus, the 水榭 sliding into its place on the right third
  { shot: 3, dur: 7.0, time: 20, at: 0.85, move: { truck: 7, pan: -0.5 }, ease: 'out' },
  // 临安御街 (spring morning): over the roofs down the imperial way
  { shot: 7, dur: 6.6, time: 30, at: 0.8, move: { dolly: 22, crane: 3 }, ease: 'inout' },
  // 雷峰夕照 (summer sunset): across the water toward the pagoda against the low sun
  { shot: 4, dur: 7.0, time: 40, at: 0.85, move: { dolly: 14, truck: -2 }, ease: 'out' },
  // 三潭印月 (moonlit night): drifting past the near lantern, the other two and the islet beyond
  { shot: 5, dur: 7.0, time: 50, at: 0.85, move: { truck: 3.2, pan: -1.2 }, ease: 'out' },
  // 飞来峰 (autumn): along the 冷泉 stream toward the laughing 布袋 in his niche
  { shot: 8, dur: 7.0, time: 60, at: 0.85, move: { dolly: 7, truck: 1.5 }, ease: 'out' },
  // 六和塔 (the tide): down the slope, the pagoda turning against the river and the breaking bore
  { shot: 9, dur: 7.0, time: 70, at: 0.85, move: { truck: -10, crane: 4, pan: 1.2 }, ease: 'out' },
  // 断桥残雪 (winter): along the shore, the bridge and the pavilion settling into place; the end
  { shot: 10, dur: 8.0, time: 80, at: 0.7, move: { truck: 9, pan: -1 }, ease: 'out' },
];
export function totalDuration(seq = SEQUENCE) {
  return seq.reduce((s, g) => s + g.dur, 0) - XFADE * (seq.length - 1);
}

const easeFns = {
  linear: (u) => u,
  inout: (u) => u * u * (3 - 2 * u),
  out: (u) => 1 - (1 - u) * (1 - u),
  in: (u) => u * u,
};

/** camera {pos, target, fov, dof?} for a segment at normalised time u ∈ [0,1]; `shot` = the viewpoint's camera */
export function cameraAt(shot, seg, u) {
  const ease = easeFns[seg.ease] || easeFns.linear;
  const e = ease(Math.min(1, Math.max(0, u))) - ease(seg.at ?? 0.5); // 0 = the viewpoint's framing (at u = seg.at)
  const m = seg.move || {};
  const P = shot.pos.slice(), T = shot.target.slice();
  let fx = T[0] - P[0], fy = T[1] - P[1], fz = T[2] - P[2];
  const dist = Math.hypot(fx, fy, fz); fx /= dist; fy /= dist; fz /= dist;
  // right = forward × up(0,1,0)
  let rx = -fz, rz = fx; const rl = Math.hypot(rx, rz) || 1; rx /= rl; rz /= rl;
  const add = (v, k) => { P[0] += v[0] * k; P[1] += v[1] * k; P[2] += v[2] * k; T[0] += v[0] * k; T[1] += v[1] * k; T[2] += v[2] * k; };
  if (m.orbit) {
    const a = (m.orbit * e * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
    const dx = P[0] - T[0], dz = P[2] - T[2];
    P[0] = T[0] + dx * c - dz * s; P[2] = T[2] + dx * s + dz * c;
  }
  if (m.dolly) add([fx, fy, fz], m.dolly * e);
  if (m.truck) add([rx, 0, rz], m.truck * e);
  if (m.crane) add([0, 1, 0], m.crane * e);
  // pan / tilt: rotate the target around the camera position
  if (m.pan || m.tilt) {
    const dx = T[0] - P[0], dy = T[1] - P[1], dz = T[2] - P[2];
    const d = Math.hypot(dx, dy, dz);
    let yaw = Math.atan2(dx, -dz), pitch = Math.asin(dy / d);
    yaw += ((m.pan || 0) * e * Math.PI) / 180;
    pitch += ((m.tilt || 0) * e * Math.PI) / 180;
    T[0] = P[0] + Math.sin(yaw) * Math.cos(pitch) * d;
    T[1] = P[1] + Math.sin(pitch) * d;
    T[2] = P[2] - Math.cos(yaw) * Math.cos(pitch) * d;
  }
  const fov = (shot.fov ?? 40) * (1 + (m.zoom || 0) * e * 2);
  let dof = shot.dof ? { ...shot.dof } : null;
  if (dof && m.focus) dof.focus = m.focus[0] + (m.focus[1] - m.focus[0]) * (e + 0.5);
  return { pos: P, target: T, fov, dof };
}
