// WorldGenerator — процедурная генерация мира: рельеф, климатические карты, биомы.
import { fbm, clamp, clamp01, smoothstep } from '../core/utils.js';

export const BIOME = { OCEAN: 0, COAST: 1, DESERT: 2, SAVANNA: 3, STEPPE: 4, FOREST: 5, JUNGLE: 6, SWAMP: 7, TUNDRA: 8, MOUNTAIN: 9 };

export const BIOMES = [
  { id: 0, key: 'ocean', name: 'Океан', icon: '🌊', color: [0.78, 0.74, 0.56], fert: 0.35, desc: 'Солёные и пресные воды. Дом для водных растений и плавающих животных.' },
  { id: 1, key: 'coast', name: 'Побережье', icon: '🏖️', color: [0.88, 0.82, 0.60], fert: 0.3, desc: 'Песчаная полоса у воды. Влажно, но почва бедная.' },
  { id: 2, key: 'desert', name: 'Пустыня', icon: '🏜️', color: [0.88, 0.72, 0.44], fert: 0.12, desc: 'Жарко и сухо. Выживают только засухоустойчивые виды.' },
  { id: 3, key: 'savanna', name: 'Саванна', icon: '🦒', color: [0.76, 0.70, 0.36], fert: 0.45, desc: 'Тёплые травянистые равнины с редкими деревьями.' },
  { id: 4, key: 'steppe', name: 'Степь', icon: '🌾', color: [0.56, 0.70, 0.34], fert: 0.55, desc: 'Умеренные луга. Много травы, мало укрытий.' },
  { id: 5, key: 'forest', name: 'Лес', icon: '🌲', color: [0.33, 0.58, 0.27], fert: 0.75, desc: 'Умеренный лес. Плодородная почва и густая тень.' },
  { id: 6, key: 'jungle', name: 'Джунгли', icon: '🌴', color: [0.18, 0.50, 0.22], fert: 0.9, desc: 'Жаркий влажный лес. Максимальная продуктивность и конкуренция за свет.' },
  { id: 7, key: 'swamp', name: 'Болото', icon: '🐸', color: [0.34, 0.44, 0.27], fert: 0.8, desc: 'Переувлажнённые низины. Рай для земноводных и грибов.' },
  { id: 8, key: 'tundra', name: 'Тундра', icon: '❄️', color: [0.64, 0.69, 0.60], fert: 0.25, desc: 'Холодные равнины. Короткое лето, долгие снега.' },
  { id: 9, key: 'mountain', name: 'Горы', icon: '⛰️', color: [0.52, 0.50, 0.47], fert: 0.15, desc: 'Крутые скалистые склоны. Холодно, мало пищи.' },
];

export const DEFAULT_WORLD_PARAMS = {
  seed: 12345, size: 96, height: 0.5, water: 0.4, temperature: 0.55, humidity: 0.5,
  diversity: 0.6, vegetation: 0.6, relief: 0.5, name: 'Новый мир',
};

export const CELL = 4; // размер клетки мира в игровых единицах

export function generateWorld(params) {
  const p = Object.assign({}, DEFAULT_WORLD_PARAMS, params);
  const N = p.size, V = N + 1, s = p.seed | 0;
  const raw = new Float32Array(V * V);
  for (let vz = 0; vz < V; vz++) {
    for (let vx = 0; vx < V; vx++) {
      const nx = vx / N, nz = vz / N;
      const wx = nx + (fbm(nx * 3, nz * 3, s + 11, 3) - 0.5) * 0.25;
      const wz = nz + (fbm(nx * 3 + 7, nz * 3 + 3, s + 23, 3) - 0.5) * 0.25;
      const e = fbm(wx * 2.6, wz * 2.6, s, 5);
      const ridge = 1 - Math.abs(2 * fbm(wx * 3.2, wz * 3.2, s + 50, 4) - 1);
      const mmask = smoothstep(0.42, 0.68, fbm(wx * 1.3, wz * 1.3, s + 90, 2));
      const m = ridge * ridge * mmask;
      const dx = Math.abs(nx - 0.5) * 2, dz = Math.abs(nz - 0.5) * 2;
      const d = Math.max(dx, dz) * 0.6 + Math.hypot(dx, dz) * 0.33;
      const fall = smoothstep(0.62, 1.0, d);
      raw[vz * V + vx] = (e - 0.5) * (0.7 + 0.6 * p.relief) + m * (0.2 + 0.8 * p.relief) * 0.9 - fall * 0.8;
    }
  }
  // Уровень моря подбирается по доле воды
  const sorted = Float32Array.from(raw).sort();
  const wf = 0.08 + 0.62 * p.water;
  const sl = sorted[Math.floor(wf * (sorted.length - 1))];
  const hmax = Math.max(0.0001, sorted[sorted.length - 1] - sl);
  const maxH = 10 + 42 * p.height;
  const height = new Float32Array(V * V);
  const pw = 1.3 - 0.4 * p.relief;
  for (let i = 0; i < raw.length; i++) {
    const h = raw[i] - sl;
    height[i] = h >= 0 ? Math.pow(h / hmax, pw) * maxH : Math.max(-14, h * 34);
  }
  const world = {
    params: p, N, V, cell: CELL, size: N * CELL, maxH, height,
    cellH: new Float32Array(N * N), slope: new Float32Array(N * N),
    baseTemp: new Float32Array(N * N), baseMoist: new Float32Array(N * N),
    biome: new Uint8Array(N * N),
  };
  computeCellGeometry(world);
  const div = p.diversity;
  const tBase = -6 + 36 * p.temperature;
  for (let cz = 0; cz < N; cz++) {
    for (let cx = 0; cx < N; cx++) {
      const i = cz * N + cx, nx = (cx + 0.5) / N, nz = (cz + 0.5) / N;
      const h = world.cellH[i];
      const lat = (nz - 0.5) * 2 * (3 + 11 * div);
      const tn = (fbm(nx * 2.2 + 31, nz * 2.2 + 17, s + 200, 3) - 0.5) * 2 * (2 + 7 * div);
      world.baseTemp[i] = tBase + lat + tn - Math.max(0, h) * 0.48;
      const mn = (fbm(nx * 2.8 + 5, nz * 2.8 + 9, s + 300, 4) - 0.5) * (0.5 + 1.2 * div);
      world.baseMoist[i] = clamp01(0.05 + p.humidity * 0.8 + mn + 0.22 * Math.exp(-Math.max(0, h) / 5));
    }
  }
  classifyBiomes(world, 0, 0, 0);
  return world;
}

export function computeCellGeometry(world, x0 = 0, z0 = 0, x1 = world.N - 1, z1 = world.N - 1) {
  const { N, V, height } = world;
  x0 = clamp(x0, 0, N - 1); x1 = clamp(x1, 0, N - 1); z0 = clamp(z0, 0, N - 1); z1 = clamp(z1, 0, N - 1);
  for (let cz = z0; cz <= z1; cz++) {
    for (let cx = x0; cx <= x1; cx++) {
      const a = height[cz * V + cx], b = height[cz * V + cx + 1];
      const c = height[(cz + 1) * V + cx], d = height[(cz + 1) * V + cx + 1];
      world.cellH[cz * N + cx] = (a + b + c + d) * 0.25;
      world.slope[cz * N + cx] = (Math.max(a, b, c, d) - Math.min(a, b, c, d)) / world.cell;
    }
  }
}

/** Классификация биомов с учётом текущих климатических сдвигов и уровня воды. */
export function classifyBiomes(world, tempOff, humOff, waterLevel) {
  const { N, cellH, slope, baseTemp, baseMoist, biome, maxH } = world;
  let changed = 0;
  for (let i = 0; i < N * N; i++) {
    const h = cellH[i] - waterLevel, T = baseTemp[i] + tempOff, m = clamp01(baseMoist[i] + humOff);
    let b;
    if (h < 0) b = BIOME.OCEAN;
    else if (cellH[i] > maxH * 0.6 || (cellH[i] > maxH * 0.36 && slope[i] > 1.1)) b = BIOME.MOUNTAIN;
    else if (h < 1.1) b = BIOME.COAST;
    else if (T < -1) b = BIOME.TUNDRA;
    else if (T < 6) b = m > 0.5 ? BIOME.FOREST : BIOME.TUNDRA;
    else if (m > 0.78 && cellH[i] < maxH * 0.14 && slope[i] < 0.5) b = BIOME.SWAMP;
    else if (T > 21) b = m > 0.62 ? BIOME.JUNGLE : m > 0.3 ? BIOME.SAVANNA : BIOME.DESERT;
    else b = m > 0.55 ? BIOME.FOREST : m > 0.25 ? BIOME.STEPPE : BIOME.DESERT;
    if (biome[i] !== b) { biome[i] = b; changed++; }
  }
  return changed;
}
