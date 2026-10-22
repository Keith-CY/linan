// The cameras the world is planned for. The ten shot cameras (src/world/shots.js) always; in the ink look also
// the ink cameras (src/ink/styles.js INK_CAMS: the same places recomposed as paintings after the 纯水墨
// targets), so the terrain's fine leaves, the city's house levels, the vegetation's cover, grass and view clearings
// are there for them too. Set by src/world/index.js before any module builds; pure data (node tools import it).
//
//   planCams()       → [...SHOTS, ...extra]   (extra entries: { id, pos, target, fov, ink: true, viewRule? })
//   extraCamsOf(id)  → the extra cameras of shot id (for its own terrain set)
import { SHOTS } from './shots.js';

let extra = [];
let version = 0;
export function setPlanCams(list) { extra = list || []; version++; }
export function planCams() { return extra.length ? [...SHOTS, ...extra] : SHOTS; }
export function extraCamsOf(id) { return extra.filter((c) => c.id === id); }
export function planVersion() { return version; }
