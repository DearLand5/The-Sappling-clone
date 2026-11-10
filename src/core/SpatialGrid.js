// Пространственное разделение: равномерная сетка для быстрого поиска соседей.

export class SpatialGrid {
  constructor(worldSize, cellSize) {
    this.cs = cellSize;
    this.n = Math.max(1, Math.ceil(worldSize / cellSize));
    this.cells = new Array(this.n * this.n);
    for (let i = 0; i < this.cells.length; i++) this.cells[i] = [];
  }
  key(x, z) {
    let cx = (x / this.cs) | 0, cz = (z / this.cs) | 0;
    if (cx < 0) cx = 0; else if (cx >= this.n) cx = this.n - 1;
    if (cz < 0) cz = 0; else if (cz >= this.n) cz = this.n - 1;
    return cz * this.n + cx;
  }
  insert(o) {
    const k = this.key(o.x, o.z);
    const arr = this.cells[k];
    o._gk = k; o._gi = arr.length; arr.push(o);
  }
  remove(o) {
    if (o._gk < 0 || o._gk === undefined) return;
    const arr = this.cells[o._gk];
    const last = arr.pop();
    if (last !== o) { arr[o._gi] = last; last._gi = o._gi; }
    o._gk = -1;
  }
  update(o) {
    const k = this.key(o.x, o.z);
    if (k !== o._gk) { this.remove(o); const arr = this.cells[k]; o._gk = k; o._gi = arr.length; arr.push(o); }
  }
  /** Вызывает cb(o, d2) для всех объектов в радиусе r. */
  query(x, z, r, cb) {
    const cs = this.cs, n = this.n;
    let x0 = ((x - r) / cs) | 0, x1 = ((x + r) / cs) | 0, z0 = ((z - r) / cs) | 0, z1 = ((z + r) / cs) | 0;
    if (x0 < 0) x0 = 0; if (z0 < 0) z0 = 0; if (x1 >= n) x1 = n - 1; if (z1 >= n) z1 = n - 1;
    const r2 = r * r;
    for (let cz = z0; cz <= z1; cz++) {
      for (let cx = x0; cx <= x1; cx++) {
        const arr = this.cells[cz * n + cx];
        for (let i = 0; i < arr.length; i++) {
          const o = arr[i];
          const dx = o.x - x, dz = o.z - z;
          const d2 = dx * dx + dz * dz;
          if (d2 <= r2) cb(o, d2);
        }
      }
    }
  }
  /** Число объектов в ячейке, содержащей точку. */
  countAt(x, z) { return this.cells[this.key(x, z)].length; }
  clear() { for (let i = 0; i < this.cells.length; i++) this.cells[i].length = 0; }
}
