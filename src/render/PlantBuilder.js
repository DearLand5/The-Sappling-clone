// PlantBuilder — процедурное построение 3D-модели растения из генома.
// Вся модель — одна геометрия с цветами вершин, чтобы рисовать вид одним InstancedMesh.
import { GeoBuilder, SHAPES } from './geo.js';
import { PI as GI, plantPheno } from '../life/GeneticsSystem.js';
import { RNG, hsl, mixRgb, lerp, TAU } from '../core/utils.js';

const PIH = Math.PI / 2;

export function buildPlantGeometry(g, lod = 0) {
  const ph = plantPheno(g), I = GI;
  let seed = 7; for (let i = 0; i < g.length; i++) seed = (seed * 31 + Math.floor(g[i] * 997)) | 0;
  const rng = new RNG(seed);
  const b = new GeoBuilder();
  const leaf = ph.leafColor, leafD = mixRgb(leaf, [0, 0.05, 0], 0.3), leafL = mixRgb(leaf, [1, 1, 0.6], 0.22);
  const tone = g[I.trunkTone];
  const bark = hsl(0.07 + tone * 0.03, 0.4 - tone * 0.25, 0.16 + tone * 0.42);
  const barkD = mixRgb(bark, [0, 0, 0], 0.3);
  const flowerC = hsl(g[I.flowerHue], 0.8, 0.62);
  const fruitC = hsl(0.02 + g[I.flowerHue] * 0.12, 0.85, 0.5);
  const H = ph.maxH, R = ph.crownR, type = ph.type;
  const shape = Math.min(5, Math.floor(g[I.crownShape] * 6));
  const leafCol = () => { const t = rng.next(); return t < 0.33 ? leafD : t < 0.66 ? leaf : leafL; };
  const det = lod ? 0 : 1;
  const blob = (p, r, sy = 1, col) => b.add(SHAPES.ico(det), { p, s: [r, r * sy, r], r: [rng.next() * 3, rng.next() * 3, 0], color: col || leafCol() });
  const dots = (center, r, sy, n, col, size) => {
    for (let k = 0; k < n; k++) {
      const a = rng.next() * TAU, e = rng.range(-0.2, 1.2);
      b.add(SHAPES.ico(0), { p: [center[0] + Math.cos(a) * Math.cos(e) * r, center[1] + Math.sin(e) * r * sy, center[2] + Math.sin(a) * Math.cos(e) * r], s: size, color: col });
    }
  };
  const nFlowers = ph.flowers > 0 && !lod ? Math.round(3 + ph.flowers * 7) : 0;
  const nFruit = ph.fruit > 0 && !lod ? Math.round(2 + ph.fruit * 5) : 0;

  if (type === 0) {
    // ================= дерево =================
    const tr = H * (0.022 + 0.035 * g[I.trunk]);
    const base = ph.foliageBase;
    const lean = [rng.range(-0.04, 0.04) * H, 0, rng.range(-0.04, 0.04) * H];
    if (shape === 4) {
      // пальма: изогнутый ствол и веер листьев
      const mid = [H * 0.07, H * 0.5, 0], top = [H * 0.03, H * 0.93, 0];
      b.limb([0, 0, 0], mid, tr * 1.1, tr * 0.8, bark, 6); b.limb(mid, top, tr * 0.8, tr * 0.6, barkD, 6);
      const n = 7 + Math.round(g[I.leafDensity] * 3), fl = R * 1.5;
      for (let k = 0; k < n; k++) {
        const a = (k / n) * TAU + rng.range(-0.2, 0.2), ca = Math.cos(a), sa = Math.sin(a), w = fl * 0.2;
        const m = [top[0] + ca * fl * 0.55, top[1] + fl * 0.22, top[2] + sa * fl * 0.55];
        const e = [top[0] + ca * fl, top[1] - fl * 0.3, top[2] + sa * fl];
        const c = leafCol();
        b.tri(top, [m[0] - sa * w, m[1], m[2] + ca * w], [m[0] + sa * w, m[1], m[2] - ca * w], leafD, c, c);
        b.tri([m[0] - sa * w, m[1], m[2] + ca * w], e, [m[0] + sa * w, m[1], m[2] - ca * w], c, leafL, c);
      }
      for (let k = 0; k < nFruit; k++) { const a = rng.next() * TAU; b.add(SHAPES.ico(0), { p: [top[0] + Math.cos(a) * tr * 1.6, top[1] - tr * 1.2, top[2] + Math.sin(a) * tr * 1.6], s: tr * 1.1, color: [0.35, 0.22, 0.1] }); }
    } else {
      const trunkTop = shape === 1 ? H * 0.95 : Math.max(base, H - R * 1.1);
      const top = [lean[0], trunkTop, lean[2]];
      b.limb([0, 0, 0], top, tr * 1.25, tr * (shape === 1 ? 0.25 : 0.7), bark, lod ? 5 : 7);
      // корни
      const nr = lod ? 0 : 3 + Math.round(g[I.rootSpread] * 3);
      for (let k = 0; k < nr; k++) { const a = (k / nr) * TAU + rng.next(), rl = tr * (2 + g[I.rootSpread] * 3.5); b.limb([Math.cos(a) * tr * 0.5, tr * 1.6, Math.sin(a) * tr * 0.5], [Math.cos(a) * rl, -0.1, Math.sin(a) * rl], tr * 0.55, tr * 0.2, barkD, 4); }
      if (shape === 1) {
        // хвойное: ярусы конусов
        const n = 3 + Math.round(g[I.branching] * 2), h0 = base * 0.75, span = H - h0;
        for (let k = 0; k < n; k++) {
          const t = k / n, y = h0 + span * t * 0.82, r = R * (1 - t * 0.72), hh = span * (0.5 - t * 0.12);
          b.add(SHAPES.cyl(0, 1, lod ? 6 : 8), { p: [lean[0] * t, y, lean[2] * t], s: [r, hh, r], r: [0, rng.next() * 3, 0], color: k % 2 ? leaf : leafD });
        }
        dots([0, H * 0.6, 0], R * 0.55, 1.3, nFruit, [0.4, 0.26, 0.12], R * 0.09);
      } else if (shape === 2) {
        // ярусная крона
        const n = lod ? 3 : 4, sp = g[I.branchAngle];
        for (let k = 0; k < n; k++) {
          const t = k / (n - 1), y = lerp(Math.max(base + R * 0.2, H - R * 2.1), H - R * 0.35, t), r = R * (1 - t * 0.45);
          const ox = rng.range(-0.3, 0.3) * R * sp, oz = rng.range(-0.3, 0.3) * R * sp;
          blob([lean[0] + ox, y, lean[2] + oz], r, 0.5);
          if (!lod) b.limb([lean[0] * t, y - R * 0.5, lean[2] * t], [lean[0] + ox, y, lean[2] + oz], tr * 0.4, tr * 0.2, barkD, 4);
        }
        dots([lean[0], H - R * 0.4, lean[2]], R * 0.6, 0.4, nFlowers, flowerC, R * 0.08);
        dots([lean[0], base + R * 0.2, lean[2]], R * 0.8, 0.3, nFruit, fruitC, R * 0.07);
      } else if (shape === 3) {
        // зонтичная крона на раскидистых ветвях
        const n = lod ? 3 : 4 + Math.round(g[I.branching] * 2), cyy = H - R * 0.25;
        for (let k = 0; k < n; k++) {
          const a = (k / n) * TAU + rng.next() * 0.5, rr = R * (0.35 + 0.3 * g[I.branchAngle]);
          const e = [top[0] + Math.cos(a) * rr, cyy - R * 0.05, top[2] + Math.sin(a) * rr];
          b.limb([top[0], trunkTop * 0.7, top[2]], e, tr * 0.5, tr * 0.2, bark, 4);
          blob(e, R * 0.55, 0.28);
        }
        blob([top[0], cyy, top[2]], R * 0.85, 0.25);
        dots([top[0], cyy, top[2]], R * 0.8, 0.25, nFlowers, flowerC, R * 0.07);
      } else {
        // шаровидная или плакучая крона из нескольких «облаков» листвы
        const n = lod ? 2 : 2 + Math.round(g[I.branching] * 3), cc = [top[0], H - R * 0.85, top[2]];
        blob(cc, R * 0.82, 0.95);
        for (let k = 0; k < n; k++) {
          const a = (k / n) * TAU + rng.next(), rr = R * (0.4 + 0.35 * g[I.branchAngle]);
          const e = [cc[0] + Math.cos(a) * rr, cc[1] + rng.range(-0.35, 0.3) * R, cc[2] + Math.sin(a) * rr];
          if (!lod) b.limb([top[0], trunkTop * 0.8, top[2]], e, tr * 0.45, tr * 0.2, bark, 4);
          blob(e, R * rng.range(0.45, 0.62), 0.9);
        }
        if (shape === 5) {
          const m = lod ? 5 : 10;
          for (let k = 0; k < m; k++) {
            const a = (k / m) * TAU + rng.next() * 0.4, rr = R * rng.range(0.7, 1.0);
            b.add(SHAPES.cyl(0, 1, 4), { p: [cc[0] + Math.cos(a) * rr, cc[1] + R * 0.1, cc[2] + Math.sin(a) * rr], r: [Math.PI, 0, 0], s: [R * 0.14, R * rng.range(0.9, 1.5), R * 0.14], color: leafCol() });
          }
        }
        dots(cc, R * 0.95, 0.9, nFlowers, flowerC, R * 0.08);
        dots(cc, R * 0.9, 0.8, nFruit, fruitC, R * 0.075);
      }
    }
  } else if (type === 1) {
    // ================= кустарник =================
    const succulent = g[I.trunk] > 0.75 && g[I.leafDensity] < 0.45;
    if (succulent) {
      const col = leaf, tr = R * 0.38;
      b.limb([0, 0, 0], [0, H, 0], tr, tr * 0.85, col, 7);
      b.add(SHAPES.ico(det), { p: [0, H, 0], s: tr * 0.86, color: leafL });
      const arms = Math.round(g[I.branching] * 4);
      for (let k = 0; k < arms; k++) {
        const a = (k / Math.max(1, arms)) * TAU + rng.next(), y = H * rng.range(0.3, 0.6), ax = Math.cos(a), az = Math.sin(a);
        const e1 = [ax * tr * 2.2, y + H * 0.05, az * tr * 2.2], e2 = [ax * tr * 2.4, y + H * rng.range(0.25, 0.4), az * tr * 2.4];
        b.limb([0, y, 0], e1, tr * 0.55, tr * 0.5, col, 5); b.limb(e1, e2, tr * 0.5, tr * 0.42, leafD, 5);
        b.add(SHAPES.ico(0), { p: e2, s: tr * 0.44, color: leafL });
      }
      if (nFlowers) b.add(SHAPES.ico(0), { p: [0, H + tr * 0.8, 0], s: tr * 0.5, color: flowerC });
      if (!lod && ph.defense > 0.4) for (let k = 0; k < 10; k++) { const a = rng.next() * TAU, y = H * rng.range(0.15, 0.95); b.add(SHAPES.cyl(0, 1, 3), { p: [Math.cos(a) * tr * 0.9, y, Math.sin(a) * tr * 0.9], r: [0, -a, -PIH], s: [tr * 0.07, tr * 0.7, tr * 0.07], color: [0.95, 0.93, 0.8] }); }
    } else {
      const n = lod ? 3 : 3 + Math.round(g[I.branching] * 3), tr = H * 0.05 * (0.6 + g[I.trunk]);
      for (let k = 0; k < n; k++) {
        const a = (k / n) * TAU + rng.next() * 0.6, sp = R * (0.25 + 0.55 * g[I.branchAngle]);
        const e = [Math.cos(a) * sp, H * rng.range(0.55, 0.85), Math.sin(a) * sp];
        b.limb([0, 0, 0], e, tr, tr * 0.4, bark, 4);
        if (shape === 1) b.add(SHAPES.cyl(0, 1, 6), { p: [e[0], e[1] - R * 0.5, e[2]], s: [R * 0.5, R * 1.1, R * 0.5], color: leafCol() });
        else blob(e, R * rng.range(0.5, 0.68), shape === 3 ? 0.45 : 0.8);
      }
      blob([0, H * 0.72, 0], R * 0.62, 0.8);
      dots([0, H * 0.7, 0], R * 0.95, 0.75, nFlowers, flowerC, R * 0.1);
      dots([0, H * 0.6, 0], R * 0.95, 0.7, nFruit, fruitC, R * 0.1);
      if (!lod && ph.defense > 0.55) for (let k = 0; k < 6; k++) { const a = rng.next() * TAU; b.add(SHAPES.cyl(0, 1, 3), { p: [Math.cos(a) * R * 0.5, H * rng.range(0.2, 0.5), Math.sin(a) * R * 0.5], r: [0, -a, -PIH], s: [R * 0.04, R * 0.5, R * 0.04], color: [0.9, 0.88, 0.75] }); }
    }
  } else if (type === 2) {
    // ================= трава / мох =================
    if (g[I.height] < 0.15) {
      const n = lod ? 2 : 4;
      for (let k = 0; k < n; k++) { const a = rng.next() * TAU, d = k ? R * rng.range(0.3, 0.7) : 0; blob([Math.cos(a) * d, H * 0.25, Math.sin(a) * d], R * rng.range(0.4, 0.6), 0.45); }
    } else {
      // куртина: несколько пучков травинок вокруг центра
      const tufts = lod ? 3 : 5, per = lod ? 3 : 4 + Math.round(g[I.leafDensity] * 2);
      for (let t = 0; t < tufts; t++) {
        const ta = rng.next() * TAU, td = t ? R * rng.range(1.2, 2.8) : 0, ox = Math.cos(ta) * td, oz = Math.sin(ta) * td, ts = t ? rng.range(0.6, 0.95) : 1;
        for (let k = 0; k < per; k++) {
          const a = (k / per) * TAU + rng.next() * 0.9, d = R * rng.range(0.2, 0.75) * ts, hh = H * rng.range(0.6, 1) * ts, w = R * 0.2;
          const bx = ox + Math.cos(a) * d * 0.35, bz = oz + Math.sin(a) * d * 0.35, tx = ox + Math.cos(a) * d * 1.3, tz = oz + Math.sin(a) * d * 1.3;
          const c = leafCol();
          b.tri([bx - Math.sin(a) * w, 0, bz + Math.cos(a) * w], [bx + Math.sin(a) * w, 0, bz - Math.cos(a) * w], [tx, hh, tz], leafD, leafD, c === leafD ? leaf : leafL);
        }
      }
      for (let k = 0; k < Math.min(3, nFlowers); k++) {
        const a = rng.next() * TAU, d = R * rng.range(0.1, 0.5), top = [Math.cos(a) * d, H * rng.range(0.9, 1.15), Math.sin(a) * d];
        b.limb([Math.cos(a) * d * 0.4, 0, Math.sin(a) * d * 0.4], top, R * 0.03, R * 0.02, leafD, 3);
        b.add(SHAPES.ico(0), { p: top, s: R * 0.14, color: flowerC });
      }
    }
  } else if (type === 3) {
    // ================= водное растение (y=0 — поверхность воды) =================
    if (g[I.height] > 0.4) {
      const n = lod ? 3 : 4 + Math.round(g[I.leafDensity] * 4);
      for (let k = 0; k < n; k++) {
        const a = rng.next() * TAU, d = R * rng.range(0, 0.8), x = Math.cos(a) * d, z = Math.sin(a) * d, hh = H * rng.range(0.6, 1);
        const lx = rng.range(-0.12, 0.12) * hh, lz = rng.range(-0.12, 0.12) * hh;
        b.limb([x, -2.2, z], [x + lx, hh, z + lz], R * 0.05, R * 0.03, k % 2 ? leaf : leafD, 4);
        if (k % 2 === 0) b.limb([x + lx * 0.8, hh * 0.78, z + lz * 0.8], [x + lx, hh * 1.02, z + lz], R * 0.09, R * 0.08, [0.36, 0.22, 0.1], 5);
        else { const w = R * 0.12; b.tri([x - w, 0, z], [x + w, 0, z], [x + lx * 2.5, hh * 0.8, z + lz * 2.5], leafD, leafD, leafL); }
      }
    } else {
      const n = lod ? 2 : 3 + Math.round(g[I.leafDensity] * 3);
      for (let k = 0; k < n; k++) {
        const a = rng.next() * TAU, d = k ? R * rng.range(0.4, 0.9) : 0, x = Math.cos(a) * d, z = Math.sin(a) * d, pr = R * rng.range(0.32, 0.5);
        b.add(SHAPES.cyl(1, 1, 7), { p: [x, 0.02, z], s: [pr, 0.03, pr], r: [0, rng.next() * 3, 0], color: leafCol() });
        if (!lod) b.limb([x * 0.3, -2.2, z * 0.3], [x, 0, z], 0.025, 0.02, leafD, 3);
      }
      for (let k = 0; k < Math.min(2, nFlowers); k++) {
        const a = rng.next() * TAU, d = R * rng.range(0.1, 0.6), p = [Math.cos(a) * d, 0.08, Math.sin(a) * d];
        b.add(SHAPES.cyl(1.6, 0.4, 6), { p, s: [R * 0.14, R * 0.16, R * 0.14], color: flowerC });
        b.add(SHAPES.ico(0), { p: [p[0], p[1] + R * 0.12, p[2]], s: R * 0.07, color: [1, 0.9, 0.3] });
      }
    }
  } else {
    // ================= гриб =================
    const cap = hsl(g[I.leafHue], 0.3 + 0.6 * g[I.leafSat], 0.3 + 0.4 * g[I.leafLight]);
    const stemC = [0.93, 0.9, 0.82], n = lod ? 1 : 1 + Math.round(g[I.branching] * 2);
    for (let k = 0; k < n; k++) {
      const sc = k ? rng.range(0.4, 0.7) : 1, a = rng.next() * TAU, d = k ? R * rng.range(0.6, 1.1) : 0;
      const x = Math.cos(a) * d, z = Math.sin(a) * d, hh = H * sc, cr = R * sc, sr = cr * (0.18 + 0.2 * g[I.trunk]);
      b.limb([x, 0, z], [x, hh * 0.8, z], sr * 1.2, sr * 0.8, stemC, 6);
      if (shape === 1) b.add(SHAPES.cyl(0, 1, 7), { p: [x, hh * 0.62, z], s: [cr * 0.7, hh * 0.55, cr * 0.7], color: cap });
      else if (shape === 3) b.add(SHAPES.cyl(0.15, 1, 8), { p: [x, hh * 0.72, z], s: [cr, hh * 0.22, cr], color: cap });
      else b.add(SHAPES.sphere(8, 5), { p: [x, hh * 0.72, z], s: [cr, hh * 0.38, cr], color: cap, deform: (v) => { if (v.y < 0) v.y *= 0.15; } });
      if (!lod && g[I.leafSat] > 0.45) for (let j = 0; j < 5; j++) { const sa = rng.next() * TAU, sd = cr * rng.range(0.2, 0.7); b.add(SHAPES.ico(0), { p: [x + Math.cos(sa) * sd, hh * (0.74 + (shape === 3 ? 0.15 : 0.3) * (1 - sd / cr)), z + Math.sin(sa) * sd], s: cr * 0.09, color: [1, 1, 0.95] }); }
    }
  }
  return b.build();
}
