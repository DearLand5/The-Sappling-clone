// CreatureBuilder — процедурное построение 3D-модели животного из генома.
// Модель состоит из частей (туловище, голова с шеей, ноги, хвост, крылья),
// чтобы AnimationSystem мог их анимировать; для дальних особей части склеиваются
// в одну упрощённую модель (уровень детализации).
import { GeoBuilder, SHAPES } from './geo.js';
import { CI, creaturePheno } from '../life/GeneticsSystem.js';
import { vnoise, hash2, clamp01, lerp, mixRgb } from '../core/utils.js';

const BONE = [0.92, 0.88, 0.76], DARK = [0.07, 0.06, 0.06], WHITE = [0.97, 0.97, 0.94];
const HOOF = [0.16, 0.13, 0.11], BEAK = [0.95, 0.68, 0.2], BEAK2 = [0.8, 0.76, 0.5];
const HEAD_SCALE = [[1, 1, 1.05], [0.8, 0.82, 1.45], [1.3, 0.62, 1.15], [1, 0.95, 1.25]];
const PI = Math.PI;

/** Строит части модели. lod: 0 — подробно, 1 — упрощённо. */
export function buildCreatureParts(g, lod = 0) {
  const ph = creaturePheno(g), I = CI, hd = lod === 0;
  const { L, W, H, legLen, size, legPairs, cover, thick } = ph;
  const base = ph.color, c2 = ph.color2;
  const bellyC = mixRgb(base, [1, 1, 0.94], 0.5), dark = mixRgb(base, [0, 0, 0], 0.45);
  const pattern = Math.min(4, Math.floor(g[I.pattern] * 5));
  const ps = (0.4 + g[I.patternScale] * 1.6) * size;
  const cy = legPairs ? legLen + H * 0.5 : H * 0.5;
  const jit = cover === 1 ? 0.16 : cover === 2 ? 0.07 : cover === 3 ? 0.1 : 0.03;
  const fishy = ph.resp === 1 || (!legPairs && ph.fin > 0.3);
  const seg = hd ? 6 : 4;

  const colorAt = (x, y, z) => {
    let t = 0;
    if (pattern === 1) t = Math.sin(z * 5 / ps + Math.abs(x) * 1.5 / ps) > 0.15 ? 1 : 0;
    else if (pattern === 2) t = vnoise(x * 2.6 / ps + 31.7 + y * 1.3 / ps, z * 2.6 / ps + 12.3 - y * 1.1 / ps, 5) > 0.58 ? 1 : 0;
    else if (pattern === 3) t = y < cy - H * 0.1 ? 1 : 0;
    else if (pattern === 4) t = clamp01(0.5 - z / (L * 1.2));
    const c = pattern === 3 ? mixRgb(base, bellyC, t) : mixRgb(base, c2, t);
    const j = 1 - jit + 2 * jit * hash2(Math.round(x * 9 / size), Math.round(z * 9 / size) + Math.round(y * 9 / size) * 57, 3);
    return [c[0] * j, c[1] * j, c[2] * j];
  };
  const off = (p) => (x, y, z) => colorAt(x + p[0], y + p[1], z + p[2]);

  // ---------- туловище
  const B = new GeoBuilder();
  B.add(SHAPES.sphere(hd ? 10 : 6, hd ? 7 : 4), {
    p: [0, cy, 0], s: [W / 2, H / 2, L / 2], color: colorAt,
    deform: (v) => {
      const z = v.z;
      const rr = fishy ? 1 - 0.32 * Math.pow(Math.max(0, -z), 1.5) + 0.05 * z : 1 + 0.1 * z;
      v.x *= rr; v.y *= rr * (v.y < 0 ? 0.92 : 1);
      if (cover === 2 && hd) v.multiplyScalar(1 + (hash2(Math.round(v.x * 40), Math.round(v.y * 40) * 13 + Math.round(v.z * 40), 9) - 0.5) * 0.1 * thick);
    },
  });
  const finC = mixRgb(c2, dark, 0.3);
  if (ph.fin > 0.15) {
    const fh = H * (0.3 + 0.9 * ph.fin), ty = cy + H * 0.42;
    B.tri([0, ty, L * 0.16], [0, ty + fh, -L * 0.12], [0, ty, -L * 0.22], finC, c2, finC);
    for (const s of [-1, 1]) {
      const fx = s * W * 0.42, fo = s * (W * 0.42 + size * ph.fin * 0.7);
      B.tri([fx, cy - H * 0.1, L * 0.22], [fo, cy - H * 0.36, -L * 0.04], [fx, cy - H * 0.16, L * 0.02], finC, c2, finC);
    }
  }
  const spikes = (cover === 1 && thick > 0.45) || ph.horns > 0.6;
  if (spikes && hd) {
    const sh = H * (0.12 + 0.3 * Math.max(ph.horns, thick * 0.6));
    for (let k = 0; k < 6; k++) {
      const t = -0.62 + k * 0.25, z = t * L / 2, y = cy + (H / 2) * Math.sqrt(1 - t * t) * 0.97;
      B.add(SHAPES.cyl(0, 1, 4), { p: [0, y - sh * 0.15, z], r: [-0.25, 0, 0], s: [W * 0.07, sh, L * 0.07], color: ph.horns > 0.6 ? BONE : c2 });
    }
  }
  if (cover === 2 && thick > 0.45 && hd) { // грива и воротник
    for (let k = 0; k < 6; k++) {
      const a = (k / 5 - 0.5) * 2.4;
      B.add(SHAPES.cyl(0, 1, 4), { p: [Math.sin(a) * W * 0.36, cy + Math.cos(a) * H * 0.34, L * 0.3], r: [-1.9, 0, -a * 0.6], s: [W * 0.12, H * (0.25 + 0.4 * thick), W * 0.12], color: mixRgb(base, c2, 0.4) });
    }
  }

  // ---------- шея и голова (локальные координаты относительно основания шеи)
  const pivot = [0, cy + H * (fishy ? 0.02 : 0.2), L * (fishy ? 0.44 : 0.4)];
  const Hd = new GeoBuilder(), colH = off(pivot);
  const nl = ph.neckLen, na = fishy ? 0.12 : lerp(0.35, 1.25, g[I.neckLength]);
  const Np = [0, Math.sin(na) * nl, Math.cos(na) * nl];
  const hs = ph.headSize * 0.5;
  const neckR0 = Math.min(W, H) * 0.3, neckR1 = Math.max(hs * 0.5, neckR0 * 0.6);
  if (nl > 0.08 * size) Hd.limb([0, -H * 0.06, -L * 0.06], Np, neckR0, neckR1, colH, hd ? 7 : 5);
  const shape = Math.min(3, Math.floor(g[I.headShape] * 4));
  const [hsx, hsy, hsz] = HEAD_SCALE[shape];
  const Hc = [0, Np[1] + hs * 0.25, Np[2] + hs * 0.45];
  if (shape === 3) {
    Hd.add(SHAPES.box(), { p: Hc, s: [hs * 1.55, hs * 1.5, hs * 2.1], color: colH, deform: (v) => { v.x *= 1 - 0.35 * (v.z + 0.5); v.y *= 1 - 0.25 * (v.z + 0.5); } });
  } else Hd.add(SHAPES.sphere(hd ? 8 : 6, hd ? 6 : 4), { p: Hc, s: [hs * hsx, hs * hsy, hs * hsz], color: colH });
  const jaw = ph.jaw, mouth = ph.mouth;
  const mz = Hc[2] + hs * hsz * 0.72, my = Hc[1] - hs * hsy * 0.28;
  let snout = 0;
  const cone = SHAPES.cyl(0, 1, 4);
  if (mouth === 0) {
    snout = hs * (0.45 + 0.3 * jaw);
    Hd.add(SHAPES.sphere(6, 4), { p: [0, my, mz], s: [hs * 0.6, hs * 0.46, snout], color: bellyC });
  } else if (mouth === 1) {
    snout = hs * (0.6 + 0.5 * jaw);
    Hd.add(SHAPES.sphere(6, 4), { p: [0, my + hs * 0.05, mz], s: [hs * 0.55, hs * 0.4, snout], color: colH });
    Hd.add(SHAPES.box(), { p: [0, my - hs * 0.3, mz + snout * 0.1], s: [hs * 0.7, hs * 0.13, snout * 1.5], color: dark });
    const fl = hs * (0.28 + 0.4 * jaw);
    for (const s of [-1, 1]) {
      Hd.add(cone, { p: [s * hs * 0.26, my - hs * 0.08, mz + snout * 0.6], r: [PI, 0, 0], s: [hs * 0.09, fl, hs * 0.09], color: WHITE });
      if (hd) Hd.add(cone, { p: [s * hs * 0.2, my - hs * 0.3, mz + snout * 0.35], s: [hs * 0.06, fl * 0.5, hs * 0.06], color: WHITE });
    }
  } else if (mouth === 2) {
    snout = hs * (0.5 + 0.3 * jaw);
    Hd.add(SHAPES.sphere(6, 4), { p: [0, my, mz], s: [hs * 0.52, hs * 0.42, snout], color: mixRgb(base, bellyC, 0.5) });
    if (jaw > 0.5 || ph.horns > 0.2) for (const s of [-1, 1]) Hd.add(cone, { p: [s * hs * 0.36, my - hs * 0.15, mz + snout * 0.4], r: [0.4, 0, -s * 0.5], s: [hs * 0.07, hs * (0.25 + 0.35 * jaw), hs * 0.07], color: BONE });
  } else if (mouth === 3) {
    Hd.add(SHAPES.cyl(0, 1, 5), { p: [0, Hc[1] - hs * 0.1, Hc[2] + hs * hsz * 0.8], r: [PI / 2, 0, 0], s: [hs * 0.42, hs * (0.7 + 0.9 * jaw), hs * 0.32], color: BEAK });
  } else if (mouth === 4) {
    const bl = hs * (0.6 + 0.6 * jaw), bz = Hc[2] + hs * hsz * 0.8;
    Hd.add(SHAPES.cyl(0.35, 1, 5), { p: [0, Hc[1] - hs * 0.08, bz], r: [PI / 2, 0, 0], s: [hs * 0.42, bl, hs * 0.36], color: BEAK2 });
    Hd.add(cone, { p: [0, Hc[1] - hs * 0.02, bz + bl * 0.92], r: [PI * 0.9, 0, 0], s: [hs * 0.16, hs * 0.5, hs * 0.16], color: DARK });
  } else {
    Hd.add(SHAPES.sphere(6, 4), { p: [0, my, mz], s: [hs * 0.85, hs * 0.3, hs * 0.5], color: dark });
    const wl = hs * (0.6 + jaw);
    for (const s of [-0.6, -0.25, 0.25, 0.6]) Hd.limb([s * hs, my, mz + hs * 0.3], [s * hs * 1.4, my - wl * 0.8, mz + hs * 0.3 + wl * 0.5], hs * 0.07, hs * 0.02, c2, 4);
  }
  if (mouth <= 2 && g[I.noseSize] > 0.1) Hd.add(SHAPES.ico(0), { p: [0, my + hs * 0.14, mz + snout * 0.92], s: hs * (0.07 + 0.16 * g[I.noseSize]), color: DARK });
  // глаза
  const er = hs * (0.13 + 0.26 * g[I.eyeSize]);
  const sideX = shape === 3 ? 0.68 : 0.8;
  if (ph.eyes >= 2) for (const s of [-1, 1]) {
    const ex = s * hs * hsx * sideX, ey = Hc[1] + hs * hsy * 0.28, ez = Hc[2] + hs * hsz * 0.36;
    Hd.add(SHAPES.ico(hd ? 1 : 0), { p: [ex, ey, ez], s: er, color: WHITE });
    Hd.add(SHAPES.ico(0), { p: [ex + s * er * 0.55, ey, ez + er * 0.45], s: er * 0.58, color: DARK });
    if (ph.eyes === 4) {
      const e2 = [s * hs * hsx * 0.55, Hc[1] + hs * hsy * 0.72, Hc[2] + hs * hsz * 0.02];
      Hd.add(SHAPES.ico(0), { p: e2, s: er * 0.7, color: WHITE });
      Hd.add(SHAPES.ico(0), { p: [e2[0] + s * er * 0.3, e2[1] + er * 0.3, e2[2] + er * 0.2], s: er * 0.4, color: DARK });
    }
  }
  const ear = g[I.earSize];
  if (ear > 0.12) for (const s of [-1, 1]) {
    Hd.add(cone, { p: [s * hs * hsx * 0.6, Hc[1] + hs * hsy * 0.55, Hc[2] - hs * hsz * 0.25], r: [-0.25, 0, -s * 0.5], s: [hs * (0.2 + 0.2 * ear), hs * (0.35 + 1.6 * ear), hs * 0.1], color: mixRgb(base, dark, 0.3) });
  }
  if (ph.horns > 0.15) {
    const hl = hs * (0.5 + 1.8 * ph.horns);
    for (const s of [-1, 1]) {
      const a = [s * hs * 0.4, Hc[1] + hs * hsy * 0.7, Hc[2] - hs * 0.1];
      const b = [a[0] + s * hl * 0.45, a[1] + hl * 0.7, a[2] - hl * 0.25];
      const c = [b[0] + s * hl * 0.15, b[1] + hl * 0.5, b[2] + hl * 0.3];
      Hd.limb(a, b, hs * 0.17, hs * 0.1, BONE, 5); Hd.limb(b, c, hs * 0.1, hs * 0.01, BONE, 5);
    }
  }
  const ant = g[I.antennae];
  if (ant > 0.15) {
    const al = hs * (0.5 + 2.2 * ant);
    for (const s of [-1, 1]) {
      const a = [s * hs * 0.3, Hc[1] + hs * hsy * 0.8, Hc[2] + hs * 0.3], b = [a[0] + s * al * 0.4, a[1] + al * 0.7, a[2] + al * 0.6];
      Hd.limb(a, b, hs * 0.045, hs * 0.03, dark, 4);
      Hd.add(SHAPES.ico(0), { p: b, s: hs * 0.1, color: c2 });
    }
  }
  if (cover === 3 && thick > 0.45 && hd) {
    for (let k = 0; k < 3; k++) {
      const z0 = Hc[2] + hs * (0.2 - k * 0.35), y0 = Hc[1] + hs * hsy * 0.85;
      Hd.tri([0, y0, z0], [0, y0 + hs * (0.5 + thick * 0.6), z0 - hs * 0.5], [0, y0, z0 - hs * 0.4], c2, mixRgb(c2, WHITE, 0.3), c2);
    }
  }

  // ---------- ноги
  const legs = [];
  if (legPairs) {
    const hipY = cy - H * 0.22, len = hipY, lt = ph.legThick;
    const legCol = mixRgb(base, dark, 0.3), footCol = mixRgb(c2, [1, 0.6, 0.2], 0.4);
    for (let k = 0; k < legPairs; k++) {
      const fz = legPairs === 1 ? -L * 0.08 : lerp(L * 0.34, -L * 0.34, k / (legPairs - 1));
      const kn = k < legPairs / 2 ? -1 : 1;
      for (const s of [-1, 1]) {
        const lb = new GeoBuilder();
        const knee = [0, -len * 0.5, len * 0.07 * kn], ankle = [0, -len + lt * 0.5, 0];
        lb.limb([0, lt * 0.5, 0], knee, lt * 1.2, lt * 0.85, legCol, seg);
        lb.limb(knee, ankle, lt * 0.85, lt * 0.6, legCol, seg);
        if (ph.foot === 1) lb.add(SHAPES.cyl(0.8, 1, 6), { p: [0, -len, 0], s: [lt * 0.9, lt * 0.9, lt * 0.95], color: HOOF });
        else if (ph.foot === 2) {
          const y = -len + 0.02 * size;
          lb.tri([0, y + lt * 0.4, -lt * 0.5], [-lt * 2.1, y, lt * 2.4], [0, y, lt * 2.9], footCol);
          lb.tri([0, y + lt * 0.4, -lt * 0.5], [0, y, lt * 2.9], [lt * 2.1, y, lt * 2.4], footCol);
        } else {
          lb.add(SHAPES.sphere(6, 4), { p: [0, -len + lt * 0.4, lt * 0.5], s: [lt * 1.1, lt * 0.5, lt * 1.5], color: legCol });
          if (ph.foot === 3 && hd) for (const dx of [-0.6, 0, 0.6]) lb.add(cone, { p: [dx * lt, -len + lt * 0.3, lt * 1.6], r: [PI / 2 + 0.3, 0, 0], s: [lt * 0.2, lt * 0.9, lt * 0.2], color: DARK });
        }
        legs.push({ geo: lb, p: [s * W * 0.36, hipY, fz], pair: k, side: s });
      }
    }
  }

  // ---------- хвост (локально, растёт в сторону -Z)
  let tail = null;
  const tl = ph.tailLen, tt = ph.tailType;
  if (tl > 0.06 * size) {
    const tb = new GeoBuilder();
    const tp = [0, cy + H * (fishy ? 0 : 0.08), -L * 0.45], colT = off(tp);
    const r0 = Math.min(W, H) * [0.1, 0.28, 0.24, 0.12, 0.1][tt] * (cover === 2 ? 1 + 0.5 * thick : 1);
    const dy = fishy ? 0 : -tl * 0.25;
    if (tt <= 1) {
      const mid = [0, dy * 0.3, -tl * 0.5], end = [0, dy, -tl * 0.95];
      tb.limb([0, 0, L * 0.05], mid, r0, r0 * (tt ? 0.9 : 0.6), colT, seg);
      tb.limb(mid, end, r0 * (tt ? 0.9 : 0.6), r0 * (tt ? 0.25 : 0.12), tt && cover === 2 ? mixRgb(base, bellyC, 0.5) : colT, seg);
    } else if (tt === 2) {
      tb.limb([0, 0, L * 0.05], [0, 0, -tl * 0.6], r0, r0 * 0.35, colT, seg);
      const a = [0, 0, -tl * 0.5], c = [0, 0, -tl * 0.8];
      tb.tri(a, [0, tl * 0.45, -tl * 1.05], c, finC, c2, finC);
      tb.tri(a, c, [0, -tl * 0.4, -tl * 1.05], finC, finC, c2);
    } else if (tt === 3) {
      tb.limb([0, 0, L * 0.05], [0, 0, -tl * 0.3], r0, r0 * 0.6, colT, seg);
      const n = 5, a0 = [0, 0, -tl * 0.2];
      for (let k = 0; k < n; k++) {
        const a1 = -0.65 + (k / n) * 1.3, a2 = -0.65 + ((k + 1) / n) * 1.3;
        const col = k % 2 ? c2 : mixRgb(base, dark, 0.2);
        tb.tri(a0, [Math.sin(a1) * tl, 0.02, -Math.cos(a1) * tl], [Math.sin(a2) * tl, 0.02, -Math.cos(a2) * tl], base, col, col);
      }
    } else {
      const end = [0, dy, -tl * 0.9];
      tb.limb([0, 0, L * 0.05], end, r0, r0 * 0.6, colT, seg);
      const br = Math.min(W, H) * 0.24;
      tb.add(SHAPES.ico(hd ? 1 : 0), { p: end, s: br, color: dark });
      if (hd) for (const d of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, 0, -1]]) {
        tb.add(cone, { p: [end[0] + d[0] * br * 0.7, end[1] + d[1] * br * 0.7, end[2] + d[2] * br * 0.7], r: [d[2] * PI / 2, 0, -d[0] * PI / 2], s: [br * 0.25, br * 0.8, br * 0.25], color: BONE });
      }
    }
    tail = { geo: tb, p: tp };
  }

  // ---------- крылья (правое; левое получается зеркалированием)
  let wing = null;
  if (ph.wing > 0.12) {
    const wb = new GeoBuilder();
    const span = size * ph.wing * 1.6 + W * 0.2, ch = L * (0.35 + 0.35 * ph.wing);
    const r0 = [0, 0, ch * 0.5], r1 = [0, 0, -ch * 0.5], m1 = [span * 0.5, 0, -ch * 0.65], tip = [span, 0, -ch * 0.15], m0 = [span * 0.55, 0, ch * 0.3];
    if (cover === 3) {
      const fc = mixRgb(c2, dark, 0.15);
      wb.tri(r0, m0, r1, base, base, fc); wb.tri(m0, m1, r1, base, fc, fc); wb.tri(m0, tip, m1, base, c2, fc);
      for (let k = 0; k < 4; k++) {
        const t0 = k / 4, t1 = (k + 0.8) / 4;
        const a = [lerp(m1[0], tip[0], t0), 0, lerp(m1[2], tip[2], t0)], b = [lerp(m1[0], tip[0], t1), 0, lerp(m1[2], tip[2], t1)];
        wb.tri(a, b, [(a[0] + b[0]) / 2 + span * 0.06, 0, (a[2] + b[2]) / 2 - ch * 0.4], fc, fc, c2);
      }
    } else {
      const mem = mixRgb(base, [0.32, 0.16, 0.16], 0.4);
      wb.tri(r0, m0, r1, mem, mem, mem); wb.tri(m0, m1, r1, mem); wb.tri(m0, tip, m1, mem);
      wb.limb(r0, m0, W * 0.07, W * 0.05, dark, 4); wb.limb(m0, tip, W * 0.05, W * 0.015, dark, 4);
      wb.limb(m0, m1, W * 0.03, W * 0.012, dark, 4);
    }
    wing = { geo: wb, p: [W * 0.38, cy + H * 0.3, L * 0.1] };
  }

  const top = Math.max(cy + H * 0.5, pivot[1] + Hc[1] + hs * (1.2 + (ph.horns > 0.15 ? 0.5 + 1.8 * ph.horns : 0)));
  return { ph, body: B, head: { geo: Hd, p: pivot }, legs, tail, wing, cy, height: top, length: L + tl + nl };
}

/** Подробная модель: готовые геометрии частей. */
export function buildCreatureModel(g) {
  const P = buildCreatureParts(g, 0);
  return {
    ph: P.ph, cy: P.cy, height: P.height, length: P.length,
    body: P.body.build(), head: { geo: P.head.geo.build(), p: P.head.p },
    legs: P.legs.map((l) => ({ geo: l.geo.build(), p: l.p, pair: l.pair, side: l.side })),
    tail: P.tail ? { geo: P.tail.geo.build(), p: P.tail.p } : null,
    wing: P.wing ? { geo: P.wing.geo.build(), p: P.wing.p } : null,
  };
}

/** Упрощённая цельная модель для отрисовки дальних особей инстансингом. */
export function buildCreatureLow(g) {
  const P = buildCreatureParts(g, 1), M = new GeoBuilder();
  M.merge(P.body); M.merge(P.head.geo, P.head.p);
  for (const l of P.legs) M.merge(l.geo, l.p);
  if (P.tail) M.merge(P.tail.geo, P.tail.p);
  if (P.wing) {
    const fold = P.ph.canFly ? -0.25 : -1.15;
    M.merge(P.wing.geo, P.wing.p, [0, P.ph.canFly ? 0 : -0.7, fold]);
    M.merge(P.wing.geo, [-P.wing.p[0], P.wing.p[1], P.wing.p[2]], [0, P.ph.canFly ? 0 : 0.7, -fold], [-1, 1, 1]);
  }
  return M.build();
}

let eggGeo = null;
export function getEggGeometry() {
  if (!eggGeo) { const b = new GeoBuilder(); b.add(SHAPES.sphere(7, 5), { p: [0, 0.5, 0], s: [0.38, 0.5, 0.38], color: [1, 1, 1] }); eggGeo = b.build(); }
  return eggGeo;
}

let carcassGeo = null;
export function getCarcassGeometry() {
  if (!carcassGeo) {
    const b = new GeoBuilder(), meat = [0.55, 0.16, 0.14];
    b.add(SHAPES.sphere(6, 4), { p: [0, 0.16, 0], s: [0.5, 0.2, 0.32], color: meat });
    for (let k = 0; k < 4; k++) b.limb([-0.3 + k * 0.2, 0.12, -0.05], [-0.34 + k * 0.22, 0.5 - Math.abs(k - 1.5) * 0.06, 0.12], 0.035, 0.02, BONE, 4);
    b.limb([-0.5, 0.1, 0.1], [0.55, 0.1, -0.05], 0.04, 0.03, BONE, 4);
    b.add(SHAPES.ico(0), { p: [0.62, 0.14, -0.06], s: 0.12, color: BONE });
    carcassGeo = b.build();
  }
  return carcassGeo;
}
