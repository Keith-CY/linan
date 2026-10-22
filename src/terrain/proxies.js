// Framing proxies: plain grey massing for every building, pagoda, bridge and boat in layout.js, so the
// cameras can be framed before the real modules exist. Only built with ?proxies=1 (all) or ?proxies=bridges,boats (only
// those groups: halls, pagodas, bridges, boats) — never in final renders.
//   halls   — box body + hipped cap at the size the 營造法式 params give (approx.)
//   pagodas — octagonal / hexagonal stack with a cap per storey; 三潭 lanterns as a sphere on a post
//   bridges — a hump (half-cylinder deck over the gap) ; boats — a low box
import * as THREE from 'three';
import * as L from '../world/layout.js';
import { heightAt } from '../world/heightfield.js';

const FEN = [0, 0.024, 0.022, 0.02, 0.0192, 0.0176, 0.016, 0.014, 0.012]; // 1 分 (m) per 材 grade (卷四)

function hallSize(h) {
  const p = h.params || {}, fen = FEN[p.grade || 5];
  const bays = p.bays || 3, raft = p.rafters || 4;
  const W = h.span ? h.span[0] : bays * 250 * fen * (h.kind === 'ting' ? 0.9 : 1);
  const D = h.span ? h.span[1] : raft * (p.jiaShen || 130) * fen;
  const colH = 0.92 * 250 * fen * (h.kind === 'ting' ? 1.1 : 1);
  const storeys = h.storeys || 1;
  return { W, D, H: colH * storeys + (storeys - 1) * 1.2, roof: Math.max(2.5, D * 0.42) };
}

export function buildProxies(engine, which = 'all') {
  const want = (k) => which === 'all' || which === '1' || which.split(',').includes(k);
  const mat = new THREE.MeshStandardMaterial({ color: 0x8a8580, roughness: 0.85 });
  const roofMat = new THREE.MeshStandardMaterial({ color: 0x2c2e33, roughness: 0.8 });
  const red = new THREE.MeshStandardMaterial({ color: 0x6a2418, roughness: 0.7 });
  const group = new THREE.Group();
  group.name = 'proxies';
  const lvl = (o, c) => (o.level ?? null) !== null ? o.level : heightAt(c[0], c[1]);
  for (const h of want('halls') ? L.HALLS : []) {
    if (!h.center) continue;
    const s = hallSize(h), y0 = lvl(h, h.center) + (h.podium?.height || 0.8) + (h.base?.height || 0);
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(s.W * 0.86, s.H, s.D * 0.8), h.kind === 'ting' || h.kind === 'xie' || h.kind === 'lang' ? red : mat);
    body.position.y = s.H / 2; g.add(body);
    const roof = new THREE.Mesh(new THREE.ConeGeometry(1, 1, 4, 1), roofMat);
    roof.rotation.y = Math.PI / 4; roof.scale.set(s.W * 0.78, s.roof, s.D * 0.78); roof.position.y = s.H + s.roof / 2; g.add(roof);
    if (h.podium) { const pd = new THREE.Mesh(new THREE.BoxGeometry(s.W * 1.2, h.podium.height, s.D * 1.3), mat); pd.position.y = -h.podium.height / 2; g.add(pd); }
    if (h.base) { const b = new THREE.Mesh(new THREE.BoxGeometry(s.W * 1.1, h.base.height, h.base.depth || s.D), mat); b.position.y = -h.base.height / 2; g.add(b); }
    g.position.set(h.center[0], y0, h.center[1]);
    g.rotation.y = L.headingToRotY(h.facing || 0);
    g.name = 'proxy:' + h.id;
    group.add(g);
  }
  for (const p of want('pagodas') ? L.PAGODAS : []) {
    const y0 = lvl(p, p.center), g = new THREE.Group();
    if (p.type === 'santan') {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.35, 1.0, 12), mat); post.position.y = 0.5; g.add(post);
      const ball = new THREE.Mesh(new THREE.SphereGeometry(0.55, 16, 12), mat); ball.position.y = 1.4; g.add(ball);
      const top = new THREE.Mesh(new THREE.ConeGeometry(0.25, 0.7, 12), mat); top.position.y = 2.1; g.add(top);
    } else {
      const n = p.storeys || 5, hh = p.height * 0.86 / n, sides = p.sides || 8;
      for (let k = 0; k < n; k++) {
        const r = (p.height * 0.13) * (1 - k * 0.06);
        const b = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.94, r, hh * 0.8, sides), mat); b.position.y = k * hh + hh * 0.4; g.add(b);
        const e = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.9, r * 1.6, hh * 0.22, sides), roofMat); e.position.y = k * hh + hh * 0.89; g.add(e);
      }
      const sp = new THREE.Mesh(new THREE.ConeGeometry(p.height * 0.03, p.height * 0.14, 8), roofMat); sp.position.y = p.height * 0.93; g.add(sp);
    }
    g.position.set(p.center[0], y0, p.center[1]);
    g.name = 'proxy:' + p.id;
    group.add(g);
  }
  for (const b of want('bridges') ? L.BRIDGES : []) {
    const len = b.length || 30, geo = new THREE.CylinderGeometry(1, 1, b.width, 24, 1, false, -Math.PI / 2, Math.PI);
    const m = new THREE.Mesh(geo, mat);
    // half cylinder (local z >= 0), cylinder axis = local y = the deck width; rotate so local z → world up
    m.rotation.set(-Math.PI / 2, 0, 0);
    m.scale.set(len / 2, 1, b.rise + 1.5);
    const g = new THREE.Group(); g.add(m);
    g.position.set(b.center[0], -1.5, b.center[1]);
    g.rotation.y = L.headingToRotY(b.axis) + Math.PI / 2;
    g.name = 'proxy:' + b.id;
    group.add(g);
  }
  for (const b of want('boats') ? L.BOATS : []) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(b.length * 0.28, 1.6, b.length), red);
    m.position.set(b.at[0], 0.6, b.at[1]); m.rotation.y = L.headingToRotY(b.heading);
    m.name = 'proxy:' + b.id;
    group.add(m);
  }
  group.traverse((o) => { if (o.isMesh) o.userData.noHeightCapture = true; });
  engine.add(group);
  return group;
}
