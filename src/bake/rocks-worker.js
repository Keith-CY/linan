// Worker for src/bake/rocks.js: meshes one outcrop site or one 太湖石 and posts the arrays back.
import { parentPort, workerData } from 'node:worker_threads';
import { buildOutcropMesh, buildTaihuMesh } from '../modules/rocks.js';
import { packMesh } from '../karst/build.js';

const J = workerData;
const m = packMesh(J.kind === 'outcrop' ? buildOutcropMesh(J.site, J.detail) : buildTaihuMesh(J.seed, J.h, J.detail));
parentPort.postMessage(m, [m.world.buffer, m.normals.buffer, m.index.buffer, m.rock.buffer]);
