// PlantEditor — редактор растений: деревья, кустарники, травы, водные растения и грибы.
import { GenomeEditor } from './EditorBase.js';
import { PG, PLANT_GROUPS, PLANT_TYPES, plantPheno, makeGenome } from '../life/GeneticsSystem.js';
import { STARTER_PLANTS } from '../data/presets.js';
import { YEAR } from '../world/ClimateSystem.js';

const ICONS = ['🌳', '🌲', '🌴', '🌳', '🌳', '🫐', '🌵', '🌱', '🌾', '🍀', '🎋', '🪷', '🍄'];

export function plantSummary(g) {
  const ph = plantPheno(g), out = [];
  out.push({ t: ['🌳', '🌿', '🌱', '🪷', '🍄'][ph.type] + ' ' + PLANT_TYPES[ph.type] });
  out.push({ t: `📏 ${ph.maxH.toFixed(1)} м` });
  out.push({ t: `🌡️ ${Math.round(ph.tempOpt - ph.tempTol)}…${Math.round(ph.tempOpt + ph.tempTol)}°C` });
  if (ph.type !== 3 && ph.type !== 4) out.push({ t: `💧 Влага от ${Math.round(Math.max(0, ph.waterNeed - ph.rootDepth * 0.3) * 100)}%`, cls: ph.waterNeed - ph.rootDepth * 0.3 < 0.15 ? 'good' : ph.waterNeed > 0.65 ? 'bad' : '' });
  if (ph.type === 3) out.push({ t: `🌊 Глубина до ${(0.5 + ph.maxH).toFixed(1)} м` });
  if (ph.type === 4) out.push({ t: '♻️ Разлагатель: питается детритом', cls: 'good' });
  out.push({ t: `⚡ Сила роста ${Math.round(ph.vigor * 100)}%`, cls: ph.vigor < 0.5 ? 'bad' : ph.vigor > 0.9 ? 'good' : '' });
  out.push({ t: `⏱️ Зрелость ${(ph.matureTime / YEAR).toFixed(2)} г.` });
  out.push({ t: `⏳ Живёт ${(ph.lifespan / YEAR).toFixed(1)} г.` });
  out.push({ t: `🌰 ${ph.seeds} сем. каждые ${(ph.seedInterval / YEAR).toFixed(2)} г., до ${Math.round(ph.seedRange)} м` });
  out.push({ t: `🥬 Корм ${ph.maxBio.toFixed(1)}${ph.foliageBase > 0.5 ? ', крона с ' + ph.foliageBase.toFixed(1) + ' м' : ''}` });
  if (ph.fruit) out.push({ t: '🍎 Плоды: семена разносят животные', cls: 'good' });
  if (ph.flowers) out.push({ t: '🌼 Перекрёстное опыление' });
  if (ph.defense > 0.5) out.push({ t: '🌵 Колючее или ядовитое' });
  if (ph.deciduous) out.push({ t: '🍂 Листопадное' });
  return out;
}

export class PlantEditor extends GenomeEditor {
  constructor(game) {
    super(game, {
      kind: 'p', table: PG, groups: PLANT_GROUPS, defaultName: 'Новое растение',
      anims: [],
      templates: () => STARTER_PLANTS.map((d, i) => ({ name: d.name, icon: ICONS[i], genome: makeGenome(PG, d.genes) })),
      summary: plantSummary,
      geneFmt: { tempOpt: (v) => Math.round(-8 + 42 * v) + '°C' },
      noHue: ['leafHue'],
    });
    // смена типа растения меняет набор доступных настроек
    PG[0].rerender = true;
  }
}
