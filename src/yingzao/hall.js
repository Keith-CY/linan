// buildHall(params, opts): a single-storey Song 殿 / 廳堂 built from the rules of 《营造法式》 (fashi.js quotes the
// text, plan.js turns parameters into dimensions). Returns { group, plan, info }.
//
//   const { group, info } = buildHall({ bays: 5, rafters: 8, grade: 3, puzuo: 6, roof: 'xieshan' }, { lod: 0 });
//
// group: building-local frame (floor = platform top at y 0, front toward +Z); the platform reaches down to
// y = -info.platformH - 0.6. Static parts merged per material; 鋪作 are InstancedMeshes; AO baked.
import { Assembly } from './building.js';

export function buildHall(params = {}, { lod = 0, ao = true, name = 'hall', platform = {} } = {}) {
  const A = new Assembly({ lod, ao, name, seed: name });
  const plan = A.plan(params);
  A.platform(plan, { ...platform, ...(params.platform || {}) });
  A.storey(plan, 0);
  A.roof(plan, 0);
  const { group, info } = A.finish();
  info.platformH = params.platform?.h ?? platform.h ?? plan.platformH;
  info.fen = plan.fen;
  return { group, plan, info };
}
