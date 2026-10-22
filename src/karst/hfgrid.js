// Cached terrain height (heightfield.heightAt) on a regular grid over a rectangle, bilinear lookups. The rock SDFs
// evaluate the ground millions of times while meshing; heightAt costs ~3 µs, a grid lookup ~30 ns.
import { heightAt } from '../world/heightfield.js';

export class HFGrid {
  /** rect = [x0, z0, x1, z1], step (m) */
  constructor(rect, step = 0.5) {
    const [x0, z0, x1, z1] = rect;
    this.x0 = x0; this.z0 = z0; this.step = step;
    this.nx = Math.ceil((x1 - x0) / step) + 1; this.nz = Math.ceil((z1 - z0) / step) + 1;
    this.h = new Float32Array(this.nx * this.nz);
    for (let j = 0; j < this.nz; j++) for (let i = 0; i < this.nx; i++) this.h[j * this.nx + i] = heightAt(x0 + i * step, z0 + j * step);
  }
  at(x, z) {
    let fx = (x - this.x0) / this.step, fz = (z - this.z0) / this.step;
    if (fx < 0) fx = 0; else if (fx > this.nx - 1.001) fx = this.nx - 1.001;
    if (fz < 0) fz = 0; else if (fz > this.nz - 1.001) fz = this.nz - 1.001;
    const i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j;
    const k = j * this.nx + i, h = this.h;
    return (h[k] * (1 - u) + h[k + 1] * u) * (1 - v) + (h[k + this.nx] * (1 - u) + h[k + this.nx + 1] * u) * v;
  }
  /** |∇h| (finite difference over one cell) */
  slope(x, z) {
    const e = this.step;
    const gx = (this.at(x + e, z) - this.at(x - e, z)) / (2 * e), gz = (this.at(x, z + e) - this.at(x, z - e)) / (2 * e);
    return Math.sqrt(gx * gx + gz * gz);
  }
}
