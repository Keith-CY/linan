// Screen <-> world helper for placing things against a reference frame.
//   node tools/proj.mjs --shot 6 --world x,y,z            → frame pixel (1664 x 928)
//   node tools/proj.mjs --shot 6 --px u,v --y 60          → world x, z where that pixel's ray meets the plane y
//   node tools/proj.mjs --shot 6 --ground 'u,v;u,v'        → where those pixels' rays meet the terrain
import { SHOTS } from '../src/world/shots.js';
const a = {}; for (let i = 2; i < process.argv.length; i += 2) a[process.argv[i].slice(2)] = process.argv[i + 1];
const S = SHOTS.find((s) => String(s.id) === String(a.shot));
const W = 1664, H = 928, asp = W / H;
const sub = (p, q) => [p[0] - q[0], p[1] - q[1], p[2] - q[2]], dot = (p, q) => p[0] * q[0] + p[1] * q[1] + p[2] * q[2];
const cross = (p, q) => [p[1] * q[2] - p[2] * q[1], p[2] * q[0] - p[0] * q[2], p[0] * q[1] - p[1] * q[0]];
const norm = (p) => { const l = Math.hypot(...p); return p.map((v) => v / l); };
const f = norm(sub(S.target, S.pos)), r = norm(cross(f, [0, 1, 0])), u = cross(r, f);
const t = Math.tan((S.fov * Math.PI) / 360);
if (a.world) {
  for (const w of a.world.split(';')) {
    const p = w.split(',').map(Number), d = sub(p, S.pos), z = dot(d, f);
    console.log(w, '→', ((dot(d, r) / z / (t * asp) + 1) * W / 2).toFixed(0), ((1 - dot(d, u) / z / t) * H / 2).toFixed(0), 'dist', z.toFixed(1));
  }
}
if (a.ground) {
  const { heightAt } = await import('../src/world/heightfield.js');
  for (const q of a.ground.split(';')) {
    const [px, py] = q.split(',').map(Number);
    const sx = (px / W * 2 - 1) * t * asp, sy = (1 - py / H * 2) * t;
    const dir = norm([f[0] + r[0] * sx + u[0] * sy, f[1] + r[1] * sx + u[1] * sy, f[2] + r[2] * sx + u[2] * sy]);
    let k = 1; while (k < 3000) { const p = [S.pos[0] + dir[0] * k, S.pos[1] + dir[1] * k, S.pos[2] + dir[2] * k]; if (p[1] <= heightAt(p[0], p[2])) break; k += 0.5; }
    const p = [S.pos[0] + dir[0] * k, S.pos[1] + dir[1] * k, S.pos[2] + dir[2] * k];
    console.log(`px ${px},${py} hits ground at x ${p[0].toFixed(1)} z ${p[2].toFixed(1)} y ${p[1].toFixed(1)} (dist ${k})`);
  }
}
if (a.px) {
  const [px, py] = a.px.split(',').map(Number), y = Number(a.y);
  const sx = (px / W * 2 - 1) * t * asp, sy = (1 - py / H * 2) * t;
  const dir = [f[0] + r[0] * sx + u[0] * sy, f[1] + r[1] * sx + u[1] * sy, f[2] + r[2] * sx + u[2] * sy];
  const k = (y - S.pos[1]) / dir[1];
  console.log(`px ${px},${py} at y ${y} → x ${(S.pos[0] + dir[0] * k).toFixed(1)} z ${(S.pos[2] + dir[2] * k).toFixed(1)} (dist ${k.toFixed(1)})`);
}
