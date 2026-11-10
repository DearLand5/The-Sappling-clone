// Вспомогательный сборщик геометрии: объединяет простые формы в одну модель
// с цветами вершин (повторное использование моделей, один вызов отрисовки на модель).
import * as THREE from '../../vendor/three.module.min.js';

const _v = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();
const _e = new THREE.Euler();

const cache = new Map();
function cached(key, make) { let g = cache.get(key); if (!g) { g = make().toNonIndexed(); cache.set(key, g); } return g; }
export const SHAPES = {
  sphere: (w = 8, h = 6) => cached(`s${w}_${h}`, () => new THREE.SphereGeometry(1, w, h)),
  ico: (d = 1) => cached(`i${d}`, () => new THREE.IcosahedronGeometry(1, d)),
  // цилиндр/конус вдоль +Y от 0 до 1, радиусы rTop и rBottom
  cyl: (rTop = 1, rBot = 1, seg = 6, open = false) => cached(`c${rTop}_${rBot}_${seg}_${open}`, () => {
    const g = new THREE.CylinderGeometry(rTop, rBot, 1, seg, 1, open); g.translate(0, 0.5, 0); return g;
  }),
  box: () => cached('b', () => new THREE.BoxGeometry(1, 1, 1)),
};

export class GeoBuilder {
  constructor() { this.pos = []; this.col = []; }

  /**
   * Добавить геометрию. opts: {p:[x,y,z], r:[rx,ry,rz], s:[sx,sy,sz]|number, color:[r,g,b]|fn(x,y,z), deform:fn(v)}
   * Цвет-функция получает координаты вершины уже в пространстве модели.
   */
  add(geo, opts = {}) {
    const p = opts.p || [0, 0, 0], r = opts.r || [0, 0, 0];
    const s = typeof opts.s === 'number' ? [opts.s, opts.s, opts.s] : opts.s || [1, 1, 1];
    _p.set(p[0], p[1], p[2]); _e.set(r[0], r[1], r[2]); _q.setFromEuler(_e); _s.set(s[0], s[1], s[2]);
    _m.compose(_p, _q, _s);
    return this.addM(geo, _m, opts.color, opts.deform);
  }

  addM(geo, m, color, deform) {
    const a = geo.attributes.position, n = a.count;
    const fn = typeof color === 'function' ? color : null;
    const c = fn ? null : color || [1, 1, 1];
    const flip = m.determinant() < 0;
    const start = this.pos.length;
    for (let i = 0; i < n; i++) {
      _v.fromBufferAttribute(a, i);
      if (deform) deform(_v);
      _v.applyMatrix4(m);
      this.pos.push(_v.x, _v.y, _v.z);
      if (fn) { const cc = fn(_v.x, _v.y, _v.z); this.col.push(cc[0], cc[1], cc[2]); }
      else this.col.push(c[0], c[1], c[2]);
    }
    if (flip) { // зеркальное преобразование — меняем порядок обхода
      const P = this.pos, C = this.col;
      for (let i = start; i < P.length; i += 9) {
        for (let k = 0; k < 3; k++) {
          let t = P[i + 3 + k]; P[i + 3 + k] = P[i + 6 + k]; P[i + 6 + k] = t;
          t = C[i + 3 + k]; C[i + 3 + k] = C[i + 6 + k]; C[i + 6 + k] = t;
        }
      }
    }
    return this;
  }

  /** Треугольник; double — добавить и обратную сторону. */
  tri(a, b, c, colA, colB, colC, double = true) {
    colB = colB || colA; colC = colC || colA;
    this.pos.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
    this.col.push(colA[0], colA[1], colA[2], colB[0], colB[1], colB[2], colC[0], colC[1], colC[2]);
    if (double) {
      this.pos.push(a[0], a[1], a[2], c[0], c[1], c[2], b[0], b[1], b[2]);
      this.col.push(colA[0], colA[1], colA[2], colC[0], colC[1], colC[2], colB[0], colB[1], colB[2]);
    }
    return this;
  }

  /** Сегмент (усечённый конус) между двумя точками. */
  limb(a, b, r0, r1, color, seg = 6) {
    const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
    const len = Math.hypot(dx, dy, dz) || 0.0001;
    _v.set(dx / len, dy / len, dz / len);
    _q.setFromUnitVectors(_p.set(0, 1, 0), _v);
    _m.compose(_p.set(a[0], a[1], a[2]), _q, _s.set(1, len, 1));
    const key = Math.round((r1 / Math.max(r0, 0.0001)) * 20) / 20;
    const g = SHAPES.cyl(key, 1, seg);
    const mm = new THREE.Matrix4().makeScale(r0, 1, r0);
    return this.addM(g, _m.clone().multiply(mm), color);
  }

  /** Перенести всё содержимое другого сборщика с преобразованием. */
  merge(other, p = [0, 0, 0], r = [0, 0, 0], s = [1, 1, 1]) {
    _p.set(p[0], p[1], p[2]); _e.set(r[0], r[1], r[2]); _q.setFromEuler(_e); _s.set(s[0], s[1], s[2]);
    _m.compose(_p, _q, _s);
    const P = other.pos;
    for (let i = 0; i < P.length; i += 3) {
      _v.set(P[i], P[i + 1], P[i + 2]).applyMatrix4(_m);
      this.pos.push(_v.x, _v.y, _v.z);
    }
    for (let i = 0; i < other.col.length; i++) this.col.push(other.col[i]);
    return this;
  }

  get empty() { return this.pos.length === 0; }

  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.computeVertexNormals();
    g.computeBoundingSphere();
    return g;
  }
}

export { THREE };
