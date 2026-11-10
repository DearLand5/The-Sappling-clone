// Общие математические и вспомогательные функции. Не зависят от DOM и Three.js.

export const TAU = Math.PI * 2;
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smooth = (t) => t * t * (3 - 2 * t);
export const smoothstep = (a, b, x) => smooth(clamp01((x - a) / (b - a)));

export function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Детерминированный генератор случайных чисел. */
export class RNG {
  constructor(seed = 1) { this.f = mulberry32(seed >>> 0); }
  next() { return this.f(); }
  range(a, b) { return a + (b - a) * this.f(); }
  int(a, b) { return a + Math.floor(this.f() * (b - a + 1)); }
  pick(arr) { return arr[Math.floor(this.f() * arr.length)]; }
  chance(p) { return this.f() < p; }
  gauss() {
    let u = 0, v = 0;
    while (u === 0) u = this.f();
    v = this.f();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(TAU * v);
  }
}

// Быстрые недетерминированные случайные числа для симуляции.
export const rnd = Math.random;
export const rndRange = (a, b) => a + (b - a) * Math.random();
export const rndInt = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
export const rndPick = (arr) => arr[Math.floor(Math.random() * arr.length)];
export function gauss() {
  let u = 0;
  while (u === 0) u = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(TAU * Math.random());
}

export function hash2(ix, iy, seed) {
  let h = (Math.imul(ix, 374761393) + Math.imul(iy, 668265263) + Math.imul(seed, 1442695041)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Плавный шум по значениям, 0..1. */
export function vnoise(x, y, seed) {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = smooth(x - ix), fy = smooth(y - iy);
  const a = hash2(ix, iy, seed), b = hash2(ix + 1, iy, seed);
  const c = hash2(ix, iy + 1, seed), d = hash2(ix + 1, iy + 1, seed);
  return lerp(lerp(a, b, fx), lerp(c, d, fx), fy);
}

/** Фрактальный шум, 0..1. */
export function fbm(x, y, seed, oct = 5, lac = 2, gain = 0.5) {
  let amp = 0.5, sum = 0, norm = 0;
  for (let i = 0; i < oct; i++) {
    sum += amp * vnoise(x, y, seed + i * 131);
    norm += amp; amp *= gain; x *= lac; y *= lac;
  }
  return sum / norm;
}

/** HSL (0..1) -> [r,g,b] (0..1). */
export function hsl(h, s, l) {
  h = ((h % 1) + 1) % 1;
  const k = (n) => (n + h * 12) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [f(0), f(8), f(4)];
}
export function rgbCss(c, a = 1) {
  return `rgba(${Math.round(c[0] * 255)},${Math.round(c[1] * 255)},${Math.round(c[2] * 255)},${a})`;
}
export function hslCss(h, s, l) { return rgbCss(hsl(h, s, l)); }
export function mixRgb(a, b, t) { return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)]; }

/** Простой издатель событий. */
export class Emitter {
  constructor() { this.h = new Map(); }
  on(ev, fn) { if (!this.h.has(ev)) this.h.set(ev, []); this.h.get(ev).push(fn); return this; }
  emit(ev, a, b, c) { const l = this.h.get(ev); if (l) for (let i = 0; i < l.length; i++) l[i](a, b, c); }
}

const GEN_A = ['Vel', 'Tor', 'Mir', 'Kal', 'Ser', 'Lun', 'Ar', 'Bre', 'Cyr', 'Dor', 'El', 'Fen', 'Gal', 'Hel', 'Ix', 'Jor', 'Nym', 'Or', 'Pyr', 'Quer', 'Rha', 'Syl', 'Tha', 'Ul', 'Xan', 'Zeph', 'Mor', 'Nar', 'Os', 'Pel'];
const GEN_B = ['ora', 'ium', 'odon', 'aptor', 'ella', 'ops', 'ura', 'ix', 'antha', 'ius', 'ema', 'osa', 'yra', 'iceps', 'opus', 'ina', 'ax', 'ene', 'ula', 'orix'];
const EPI_A = ['min', 'maj', 'alb', 'nig', 'rub', 'vir', 'long', 'brev', 'lat', 'grac', 'rob', 'vel', 'tard', 'aqu', 'silv', 'mont', 'arid', 'bor', 'aust', 'pall', 'aur', 'fusc', 'cris', 'plac', 'fer', 'noct', 'sol', 'niv', 'pal', 'camp'];
const EPI_B = ['or', 'us', 'is', 'ata', 'ens', 'atus', 'ilis', 'osa', 'ea', 'icus', 'ifer', 'oides', 'ina', 'ella'];

export function makeGenus() { return rndPick(GEN_A) + rndPick(GEN_B); }
export function makeEpithet() { return rndPick(EPI_A) + rndPick(EPI_B); }
export function makeSpeciesName(genus) { return (genus || makeGenus()) + ' ' + makeEpithet(); }

export function fmt(n, d = 0) { return Number(n).toFixed(d); }

/** Кодирование Float32 генома (0..1) в компактную строку и обратно. */
export function packGenome(g) {
  let s = '';
  for (let i = 0; i < g.length; i++) {
    const v = Math.round(clamp01(g[i]) * 4095);
    s += String.fromCharCode(48 + (v >> 6), 48 + (v & 63));
  }
  return s;
}
export function unpackGenome(s, len) {
  const g = new Float32Array(len);
  const n = Math.min(len, s.length >> 1);
  for (let i = 0; i < n; i++) {
    g[i] = (((s.charCodeAt(i * 2) - 48) << 6) | (s.charCodeAt(i * 2 + 1) - 48)) / 4095;
  }
  return g;
}
