// Material set of the generated buildings. The shaders live in src/materials/ (wood, plaster, stone, tile, misc)
// and share one uniform set (src/materials/common.js YZ): every building in the world uses the same few programs.
import { woodMaterial } from '../materials/wood.js';
import { plasterMaterial } from '../materials/plaster.js';
import { stoneMaterial } from '../materials/stone.js';
import { tileMaterial } from '../materials/tile.js';
import { darkMaterial, glowMaterial, metalMaterial } from '../materials/misc.js';
export { YZ, setBuildingLook, LAMP_2200K } from '../materials/common.js';

let cache = null;
/** shared material set: { wood, plaster, stone, tile, dark, glow, metal } */
export function hallMaterials() {
  if (!cache) cache = { wood: woodMaterial(), plaster: plasterMaterial(), stone: stoneMaterial(), tile: tileMaterial(), dark: darkMaterial(), glow: glowMaterial(), metal: metalMaterial() };
  return cache;
}
