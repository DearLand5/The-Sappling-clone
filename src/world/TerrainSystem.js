// TerrainSystem — ландшафт: запросы высоты, динамические поля клеток (вода в почве,
// питательные вещества, детрит, снег, полог леса, огонь), расстояние до воды.
import { clamp, clamp01, hash2, lerp } from '../core/utils.js';
import { BIOMES, BIOME, computeCellGeometry } from './WorldGenerator.js';

export class TerrainSystem {
  constructor(world) {
    this.world = world;
    const N = world.N;
    this.N = N; this.V = world.V; this.cs = world.cell; this.size = world.size;
    this.waterLevel = 0;
    const n2 = N * N;
    this.soilWater = new Float32Array(n2);
    this.nutrients = new Float32Array(n2);
    this.detritus = new Float32Array(n2);
    this.snow = new Float32Array(n2);
    this.fire = new Float32Array(n2);
    this.burnt = new Float32Array(n2);
    this.canopy = new Float32Array(n2);   // суммарная площадь крон в клетке
    this.canopyH = new Float32Array(n2);  // высота самого высокого растения
    this.canopyNext = new Float32Array(n2);
    this.canopyHNext = new Float32Array(n2);
    this.fungi = new Float32Array(n2);    // активность разлагателей
    this.fungiNext = new Float32Array(n2);
    this.waterDist = new Int16Array(n2);
    for (let i = 0; i < n2; i++) {
      this.soilWater[i] = world.baseMoist[i] * 0.7;
      this.nutrients[i] = BIOMES[world.biome[i]].fert * 0.8;
      this.detritus[i] = 0.05;
    }
    this.computeWaterDist();
    this.colorsDirty = true;
    this.heightDirty = false;
  }

  inBounds(x, z, m = 1) { return x >= m && z >= m && x <= this.size - m && z <= this.size - m; }

  cellAt(x, z) {
    let cx = (x / this.cs) | 0, cz = (z / this.cs) | 0;
    if (cx < 0) cx = 0; else if (cx >= this.N) cx = this.N - 1;
    if (cz < 0) cz = 0; else if (cz >= this.N) cz = this.N - 1;
    return cz * this.N + cx;
  }

  heightAt(x, z) {
    const V = this.V, N = this.N, h = this.world.height;
    let fx = x / this.cs, fz = z / this.cs;
    if (fx < 0) fx = 0; else if (fx > N - 0.001) fx = N - 0.001;
    if (fz < 0) fz = 0; else if (fz > N - 0.001) fz = N - 0.001;
    const ix = fx | 0, iz = fz | 0, tx = fx - ix, tz = fz - iz;
    const i = iz * V + ix;
    return lerp(lerp(h[i], h[i + 1], tx), lerp(h[i + V], h[i + V + 1], tx), tz);
  }

  depthAt(x, z) { return this.waterLevel - this.heightAt(x, z); }
  isWater(x, z) { return this.heightAt(x, z) < this.waterLevel; }
  isWaterCell(i) { return this.world.cellH[i] < this.waterLevel; }
  biomeAt(x, z) { return this.world.biome[this.cellAt(x, z)]; }

  /** Поиск по ширине: расстояние (в клетках) от каждой клетки до ближайшей воды. */
  computeWaterDist() {
    const N = this.N, d = this.waterDist, n2 = N * N;
    const q = new Int32Array(n2); let qh = 0, qt = 0;
    for (let i = 0; i < n2; i++) {
      if (this.isWaterCell(i)) { d[i] = 0; q[qt++] = i; } else d[i] = 32000;
    }
    while (qh < qt) {
      const i = q[qh++], cx = i % N, cz = (i / N) | 0, nd = d[i] + 1;
      if (cx > 0 && d[i - 1] > nd) { d[i - 1] = nd; q[qt++] = i - 1; }
      if (cx < N - 1 && d[i + 1] > nd) { d[i + 1] = nd; q[qt++] = i + 1; }
      if (cz > 0 && d[i - N] > nd) { d[i - N] = nd; q[qt++] = i - N; }
      if (cz < N - 1 && d[i + N] > nd) { d[i + N] = nd; q[qt++] = i + N; }
    }
    this.waterDistLevel = this.waterLevel;
    this.hasWater = qt > 0 && d.some((v) => v === 0);
  }

  /** Направление к ближайшей воде (toWater=true) или к суше. Возвращает null, если уже на месте. */
  dirToWater(x, z, out, toWater = true) {
    const N = this.N, cs = this.cs, d = this.waterDist;
    const cx = clamp((x / cs) | 0, 0, N - 1), cz = clamp((z / cs) | 0, 0, N - 1);
    let best = -1, bv = toWater ? d[cz * N + cx] : -1, bx = 0, bz = 0;
    for (let oz = -1; oz <= 1; oz++) for (let ox = -1; ox <= 1; ox++) {
      if (!ox && !oz) continue;
      const nx = cx + ox, nz = cz + oz;
      if (nx < 0 || nz < 0 || nx >= N || nz >= N) continue;
      const v = d[nz * N + nx];
      if (toWater ? v < bv : v > bv) { bv = v; best = 1; bx = ox; bz = oz; }
    }
    if (best < 0) return null;
    const l = Math.hypot(bx, bz);
    out.x = bx / l; out.z = bz / l;
    return out;
  }

  /** Изменение рельефа (кратер метеорита и т. п.). */
  deform(x, z, radius, depth) {
    const V = this.V, cs = this.cs, h = this.world.height;
    const x0 = Math.max(0, Math.floor((x - radius) / cs)), x1 = Math.min(V - 1, Math.ceil((x + radius) / cs));
    const z0 = Math.max(0, Math.floor((z - radius) / cs)), z1 = Math.min(V - 1, Math.ceil((z + radius) / cs));
    for (let vz = z0; vz <= z1; vz++) for (let vx = x0; vx <= x1; vx++) {
      const d = Math.hypot(vx * cs - x, vz * cs - z) / radius;
      if (d > 1.25) continue;
      const bowl = d < 1 ? -(1 - d * d) * depth : 0;
      const rim = Math.exp(-((d - 1) * (d - 1)) / 0.02) * depth * 0.35;
      h[vz * V + vx] += bowl + rim;
    }
    computeCellGeometry(this.world, x0 - 1, z0 - 1, x1, z1);
    this.computeWaterDist();
    this.heightDirty = true; this.colorsDirty = true;
  }

  /** Заполняет массив цветов вершин ландшафта (r,g,b на вершину). */
  computeColors(out) {
    const { N, V } = this, w = this.world, wl = this.waterLevel;
    for (let vz = 0; vz < V; vz++) {
      for (let vx = 0; vx < V; vx++) {
        let r = 0, g = 0, b = 0, n = 0;
        for (let oz = -1; oz <= 0; oz++) for (let ox = -1; ox <= 0; ox++) {
          const cx = vx + ox, cz = vz + oz;
          if (cx < 0 || cz < 0 || cx >= N || cz >= N) continue;
          const i = cz * N + cx, bi = w.biome[i], col = BIOMES[bi].color;
          let cr = col[0], cg = col[1], cb = col[2];
          if (bi !== BIOME.OCEAN) {
            // сухость делает землю желтее, пожарище — темнее, снег — белее
            const dry = clamp01((0.3 - this.soilWater[i]) * 2.2);
            if (bi !== BIOME.DESERT && bi !== BIOME.COAST && bi !== BIOME.MOUNTAIN) {
              cr = lerp(cr, 0.72, dry * 0.5); cg = lerp(cg, 0.64, dry * 0.5); cb = lerp(cb, 0.38, dry * 0.5);
            }
            const bt = clamp01(this.burnt[i]);
            cr = lerp(cr, 0.16, bt * 0.75); cg = lerp(cg, 0.14, bt * 0.75); cb = lerp(cb, 0.13, bt * 0.75);
            if (this.fire[i] > 0) { cr = lerp(cr, 1.0, 0.6); cg = lerp(cg, 0.45, 0.6); cb = lerp(cb, 0.1, 0.6); }
            const sn = clamp01(this.snow[i] * 2.5);
            cr = lerp(cr, 0.95, sn); cg = lerp(cg, 0.97, sn); cb = lerp(cb, 1.0, sn);
          }
          r += cr; g += cg; b += cb; n++;
        }
        const k = vz * V + vx, h = w.height[k];
        const j = 0.94 + 0.12 * hash2(vx, vz, 77);
        r = (r / n) * j; g = (g / n) * j; b = (b / n) * j;
        if (h < wl) { // дно темнеет с глубиной
          const dp = clamp01((wl - h) / 9);
          r = lerp(r, 0.10, dp); g = lerp(g, 0.22, dp); b = lerp(b, 0.34, dp);
        }
        out[k * 3] = r; out[k * 3 + 1] = g; out[k * 3 + 2] = b;
      }
    }
    this.colorsDirty = false;
  }

  /** Цвет поверхности в точке (для маскировки животных). */
  groundColor(i) { return BIOMES[this.world.biome[i]].color; }
}
