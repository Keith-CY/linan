// Ink stage: the few changes to the world that only a shot's ink still makes. The world itself
// matches the 纯水墨 targets (refs/inkNN.jpg) wherever real geography allows, so what a walker sees agrees with
// the stills; an entry is kept here only where the geography makes the painting impossible. Applied when an ink still
// of the shot is painted (src/ink/index.js applyShot, offline) or when the explorable world settles into the still at
// that viewpoint (src/explore/still.js); restored when any other shot is applied or the walker moves on.
//
// STAGE per shot: { scale: [{ ids, k, about? }], place: [{ id, at: [x, z], k? }], turn: [{ id, deg }], hide: [ids],
//   show: [ids] }
//   ids    scene object names ('pagoda:santan-1', 'yingzao:leifeng-men', …: the module prefix and the layout id)
//   k      uniform scale about each object's own origin (its base), or about `about` [x, z] (the group spreads too)
//   at     a new base position (x, z; the base height kept) for one object, scaled by k
//   deg    a turn about the object's own vertical axis
//
// Kept:
//   1  the 三潭 (three stone lantern-pagodas) brought into the 宝石山 view and enlarged, two in the near water and one far
//      out, as ink01 lays them out (exactly three). The real ones stand 3 km away south of 小瀛洲,
//      hidden behind 孤山 from 宝石山 and a few pixels at best; moving them in the world would break shot 5.
//      雷峰 across the lake 2.2× its size, so it reads through the haze as ink01's pagoda on its hill: 3.4 km
//      from 宝石山 the real one is a few pixels; enlarging it in the world would break shot 4.
// Moved into the world: shot 1 樓閣 ×1.45 (layout HALLS scale); shot 4 the 雷峰 temple halls (layout scale:
//   the 重檐 hall now bigger, as ink04 asks); shot 8 the cliff-top pavilion (gone from the world) and the 大雄宝殿 (0.75×);
//   shot 5 the lake hall (gone from the world) and the left lantern (placed in THREE_POOLS); shot 9 the slender
//   nine-storey 六和塔 (the world's tower now, layout PAGODAS liuhe); shot 10 断桥 (on its causeway's axis, the causeway's
//   first leg turned 5° to the still's bearing).
export const STAGE = {
  1: {
    place: [{ id: 'pagoda:santan-1', at: [258, -1634], k: 6 }, { id: 'pagoda:santan-2', at: [98, -1592], k: 6 }, { id: 'pagoda:santan-3', at: [-415, -1088], k: 7 }],
    scale: [{ ids: ['pagoda:leifeng'], k: 2.2 }],
  },
};

let saved = null;   // [{ o, scale, pos, rotY, visible }]
let current = null;

function find(engine, name) {
  const c = (engine.__stageIdx ||= new Map());
  if (c.has(name)) return c.get(name);
  let hit = null;
  engine.scene.traverse((o) => { if (!hit && (o.name === name || o.name === name + ':near')) hit = o; });
  c.set(name, hit);
  return hit;
}

export function restoreStage() {
  if (!saved) return;
  for (const s of saved) {
    s.o.scale.copy(s.scale); s.o.position.copy(s.pos); s.o.rotation.y = s.rotY; s.o.visible = s.visible;
    s.o.updateMatrixWorld(true);
  }
  saved = null; current = null;
}

/** apply shot `id`'s stage (restoring any other first). The table is this file's STAGE; the second argument (the old
 *  src/ink/styles.js INK_STAGE, still passed by the callers; now the same table) is ignored */
export function applyStage(engine, id, _legacy) {
  if (current === id && saved) return;
  restoreStage();
  const st = STAGE[id];
  if (!st) return;
  saved = []; current = id;
  const keep = (o) => { if (!saved.some((s) => s.o === o)) saved.push({ o, scale: o.scale.clone(), pos: o.position.clone(), rotY: o.rotation.y, visible: o.visible }); };
  for (const g of st.scale || []) {
    for (const name of g.ids) {
      const o = find(engine, name);
      if (!o) { console.warn('[ink stage] no object', name); continue; }
      keep(o);
      o.scale.multiplyScalar(g.k);
      if (g.about) {
        // the parent of a building / pagoda group is the scene (world = local)
        o.position.x = g.about[0] + (o.position.x - g.about[0]) * g.k;
        o.position.z = g.about[1] + (o.position.z - g.about[1]) * g.k;
      }
      o.updateMatrixWorld(true);
    }
  }
  for (const g of st.place || []) {
    const o = find(engine, g.id);
    if (!o) { console.warn('[ink stage] no object', g.id); continue; }
    keep(o);
    o.position.x = g.at[0]; o.position.z = g.at[1];
    if (g.k) o.scale.multiplyScalar(g.k);
    o.updateMatrixWorld(true);
  }
  for (const g of st.turn || []) {
    const o = find(engine, g.id);
    if (!o) { console.warn('[ink stage] no object', g.id); continue; }
    keep(o);
    o.rotation.y += (g.deg * Math.PI) / 180;
    o.updateMatrixWorld(true);
  }
  for (const name of st.show || []) {
    const o = find(engine, name);
    if (!o) { console.warn('[ink stage] no object', name); continue; }
    keep(o);
    o.visible = true;
  }
  for (const name of st.hide || []) {
    const o = find(engine, name);
    if (!o) { console.warn('[ink stage] no object', name); continue; }
    keep(o);
    o.visible = false;
  }
}
