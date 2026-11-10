// Графики на Canvas 2D: численность во времени, пищевая сеть, карта распространения.
import { fitCanvas, spColor } from './dom.js';
import { BIOMES } from '../world/WorldGenerator.js';
import { YEAR } from '../world/ClimateSystem.js';

/** Линейный график. series: [{color, t:[], v:[], width}] */
export function lineChart(cv, series, o = {}) {
  const { ctx, w, h } = fitCanvas(cv, o.height || 190);
  ctx.clearRect(0, 0, w, h);
  let t0 = Infinity, t1 = -Infinity, vmax = 1;
  for (const s of series) for (let i = 0; i < s.t.length; i++) { if (s.t[i] < t0) t0 = s.t[i]; if (s.t[i] > t1) t1 = s.t[i]; if (s.v[i] > vmax) vmax = s.v[i]; }
  if (o.from !== undefined) t0 = Math.max(t0, o.from);
  if (!isFinite(t0) || t1 - t0 < 1) { ctx.fillStyle = '#a9bfb2'; ctx.font = '13px system-ui'; ctx.fillText('Данные появятся через несколько секунд…', 12, h / 2); return; }
  const L = 34, R = 8, T = 8, B = 20, pw = w - L - R, phh = h - T - B;
  vmax = niceMax(vmax);
  ctx.strokeStyle = 'rgba(255,255,255,0.1)'; ctx.fillStyle = '#a9bfb2'; ctx.font = '11px system-ui'; ctx.lineWidth = 1;
  for (let k = 0; k <= 4; k++) {
    const y = T + phh * (1 - k / 4);
    ctx.beginPath(); ctx.moveTo(L, y); ctx.lineTo(w - R, y); ctx.stroke();
    ctx.textAlign = 'right'; ctx.fillText(String(Math.round(vmax * k / 4)), L - 5, y + 4);
  }
  const yStep = Math.max(1, Math.ceil((t1 - t0) / YEAR / 6));
  ctx.textAlign = 'center';
  for (let y = Math.ceil(t0 / YEAR); y * YEAR <= t1; y += yStep) {
    const x = L + (y * YEAR - t0) / (t1 - t0) * pw;
    ctx.beginPath(); ctx.moveTo(x, T); ctx.lineTo(x, T + phh); ctx.stroke();
    ctx.fillText('г.' + (y + 1), x, h - 6);
  }
  for (const s of series) {
    ctx.strokeStyle = s.color; ctx.lineWidth = s.width || 2; ctx.lineJoin = 'round'; ctx.beginPath();
    let started = false;
    for (let i = 0; i < s.t.length; i++) {
      if (s.t[i] < t0) continue;
      const x = L + (s.t[i] - t0) / (t1 - t0) * pw, y = T + phh * (1 - s.v[i] / vmax);
      if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
}
function niceMax(v) { const p = Math.pow(10, Math.floor(Math.log10(v))); const m = v / p; return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 4 ? 4 : m <= 5 ? 5 : m <= 8 ? 8 : 10) * p; }

/** Пищевая сеть: растения внизу, выше — те, кто их ест, ещё выше — хищники. */
export function foodWeb(cv, sim) {
  const links = sim.stats.foodLinks().filter((l) => l.from.pop > 0 && (l.to === 'det' || l.to.pop > 0));
  const nodes = new Map();
  const node = (sp) => { const key = sp === 'det' ? 'det' : sp.id; if (!nodes.has(key)) nodes.set(key, { sp, key, lvl: sp === 'det' || sp.kind === 'p' ? 0 : 1, out: 0 }); return nodes.get(key); };
  for (const l of links) { node(l.from); node(l.to); }
  for (const sp of sim.organisms.aliveSpecies('c')) if (sp.pop >= 2) node(sp);
  // уровень = 1 + максимальный уровень пищи (несколько проходов)
  for (let pass = 0; pass < 4; pass++) for (const l of links) {
    const a = nodes.get(l.from.id), b = nodes.get(l.to === 'det' ? 'det' : l.to.id);
    if (b.sp !== 'det' && b.sp.kind === 'c' && !l.carrion && a.lvl <= b.lvl && a !== b) a.lvl = Math.min(4, b.lvl + 1);
  }
  const rows = [[], [], [], [], []];
  for (const n of nodes.values()) rows[n.lvl].push(n);
  const used = rows.filter((r) => r.length);
  const { ctx, w, h } = fitCanvas(cv, Math.max(220, used.length * 92));
  ctx.clearRect(0, 0, w, h);
  if (!links.length) { ctx.fillStyle = '#a9bfb2'; ctx.font = '13px system-ui'; ctx.fillText('Пока никто никого не съел.', 12, 30); return; }
  used.forEach((r, ri) => {
    r.sort((a, b) => (b.sp === 'det' ? 0 : b.sp.pop) - (a.sp === 'det' ? 0 : a.sp.pop));
    if (r.length > 9) r.length = 9;
    const y = h - 34 - ri * ((h - 68) / Math.max(1, used.length - 1 || 1));
    r.forEach((n, i) => { n.row = i; n.x = (w / (r.length + 1)) * (i + 1); n.y = used.length === 1 ? h / 2 : y; n.show = true; });
  });
  const maxAmt = Math.max(...links.map((l) => l.amt));
  for (const l of links) {
    const a = nodes.get(l.from.id), b = nodes.get(l.to === 'det' ? 'det' : l.to.id);
    if (!a.show || !b.show) continue;
    ctx.strokeStyle = l.carrion ? 'rgba(200,200,200,0.35)' : l.to !== 'det' && l.to.kind === 'c' ? 'rgba(255,123,107,0.7)' : 'rgba(155,227,107,0.5)';
    ctx.lineWidth = 0.8 + 3.2 * Math.sqrt(l.amt / maxAmt);
    if (l.carrion) ctx.setLineDash([4, 4]); else ctx.setLineDash([]);
    ctx.beginPath(); ctx.moveTo(b.x, b.y); ctx.quadraticCurveTo((a.x + b.x) / 2 + (a.y === b.y ? 0 : 12), (a.y + b.y) / 2 - (a.y === b.y ? 26 : 0), a.x, a.y); ctx.stroke();
  }
  ctx.setLineDash([]);
  ctx.font = '11px system-ui'; ctx.textAlign = 'center';
  for (const n of nodes.values()) {
    if (!n.show) continue;
    const det = n.sp === 'det';
    ctx.fillStyle = det ? '#8a6f4a' : spColor(n.sp);
    ctx.beginPath(); ctx.arc(n.x, n.y, det ? 9 : 6 + Math.min(8, Math.sqrt(n.sp.pop)), 0, 6.3); ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.4)'; ctx.lineWidth = 1; ctx.stroke();
    ctx.fillStyle = '#eef6ee';
    const first = det ? 'Детрит' : n.sp.name.split(' ')[0];
    ctx.fillText(first.length > 10 ? first.slice(0, 9) + '…' : first, Math.max(30, Math.min(w - 30, n.x)), n.y + (n.row % 2 ? 38 : 25));
  }
}

/** Карта мира с биомами и точками организмов. filter — вид или null (все животные). */
export function miniMap(cv, sim, filter, cam) {
  const w0 = cv.clientWidth || 300;
  const { ctx, w, h } = fitCanvas(cv, Math.min(w0, 340));
  const size = Math.min(w, h), ox = (w - size) / 2, N = sim.world.N;
  if (!cv._img || cv._imgN !== N || cv._stamp !== sim.climate.lastClass.t) {
    const off = document.createElement('canvas'); off.width = N; off.height = N;
    const c2 = off.getContext('2d'), img = c2.createImageData(N, N), ter = sim.terrain;
    for (let i = 0; i < N * N; i++) {
      const b = sim.world.biome[i]; let col = BIOMES[b].color;
      if (b === 0) { const d = Math.min(1, (ter.waterLevel - sim.world.cellH[i]) / 9); col = [0.2 - d * 0.1, 0.5 - d * 0.25, 0.75 - d * 0.3]; }
      const sn = Math.min(1, ter.snow[i] * 2);
      img.data[i * 4] = (col[0] + (1 - col[0]) * sn) * 255; img.data[i * 4 + 1] = (col[1] + (1 - col[1]) * sn) * 255; img.data[i * 4 + 2] = (col[2] + (1 - col[2]) * sn) * 255; img.data[i * 4 + 3] = 255;
    }
    c2.putImageData(img, 0, 0); cv._img = off; cv._imgN = N; cv._stamp = sim.climate.lastClass.t;
  }
  ctx.clearRect(0, 0, w, h);
  ctx.imageSmoothingEnabled = false; ctx.drawImage(cv._img, ox, 0, size, size);
  const k = size / sim.world.size;
  if (!filter || filter.kind === 'p') {
    if (filter) { ctx.fillStyle = 'rgba(255,255,255,0.9)'; for (const p of sim.organisms.plants) if (p.sp === filter) ctx.fillRect(ox + p.x * k - 1, p.z * k - 1, 2, 2); }
  }
  for (const c of sim.organisms.creatures) {
    if (filter && c.sp !== filter) continue;
    ctx.fillStyle = filter ? '#fff' : spColor(c.sp);
    ctx.fillRect(ox + c.x * k - 1.5, c.z * k - 1.5, 3, 3);
  }
  if (cam) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(ox + cam.sx * k, cam.sz * k, Math.max(4, cam.sdist * 0.5 * k), 0, 6.3); ctx.stroke(); }
  cv._map = { ox, k };
}
