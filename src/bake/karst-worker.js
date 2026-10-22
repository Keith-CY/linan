// Worker for src/bake/karst.js: meshes one region of the 飞来峰 field and posts the arrays back.
import { parentPort, workerData } from 'node:worker_threads';
import { makeFeilai } from '../karst/feilai.js';
import { meshRegion, packMesh } from '../karst/build.js';

const { region, detail } = workerData;
const F = makeFeilai();
const regions = F.regions(detail);
const origin = F.budai.origin.map((v) => Math.round(v));
const m = packMesh(meshRegion(F.sdf, regions, region, { origin, carved: F.carved }));
parentPort.postMessage(m, [m.world.buffer, m.normals.buffer, m.index.buffer, m.rock.buffer]);
