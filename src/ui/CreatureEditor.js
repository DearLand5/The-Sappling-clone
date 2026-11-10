// CreatureEditor — редактор животных: анатомия, органы чувств, покровы, окрас,
// биология и инстинкты. Внешность напрямую определяет способности.
import { GenomeEditor } from './EditorBase.js';
import { CG, CI, CREATURE_GROUPS, creaturePheno, makeGenome, setGeneInt } from '../life/GeneticsSystem.js';
import { STARTER_ANIMALS } from '../data/presets.js';
import { YEAR } from '../world/ClimateSystem.js';

const ICONS = { 'Прыгун луговой': '🐇', 'Рогач степной': '🦌', 'Длинношей саванный': '🦒', 'Охотник серый': '🐺', 'Кабанчик лесной': '🐗', 'Гриф-санитар': '🦅', 'Зерноклюй пёстрый': '🐦', 'Серебрянка': '🐟', 'Щука зубастая': '🦈', 'Квакун болотный': '🐸', 'Жук-могильщик': '🪲' };
const pct = (v) => Math.round(v * 100) + '%';

export function creatureSummary(g) {
  const ph = creaturePheno(g), out = [];
  const hab = { land: '🌍 Наземное', water: '🌊 Водное', amphi: '🐸 Земноводное', air: '🕊️ Летающее' }[ph.habitat];
  out.push({ t: hab }, { t: `${ph.diet.icon} ${ph.diet.name}` });
  out.push({ t: `⚖️ ${ph.mass < 1 ? ph.mass.toFixed(2) : ph.mass.toFixed(1)} у.е. массы` });
  if (ph.resp !== 1) out.push({ t: `🦵 Бег ${ph.land.toFixed(1)}`, cls: ph.land < 1.6 ? 'bad' : ph.land > 4.5 ? 'good' : '' });
  out.push({ t: `🏊 Плавание ${ph.swim.toFixed(1)}`, cls: ph.resp === 1 && ph.swim < 2 ? 'bad' : ph.swim > 3 ? 'good' : '' });
  if (ph.wing > 0.12) out.push(ph.canFly ? { t: `🪽 Полёт ${ph.fly.toFixed(1)}`, cls: 'good' } : { t: ph.resp === 1 ? '🪽 С жабрами не летают' : '🪽 Слишком тяжёл для полёта', cls: 'bad' });
  out.push({ t: `🌡️ ${Math.round(ph.tempOpt - ph.tempTol)}…${Math.round(ph.tempOpt + ph.tempTol)}°C` });
  out.push({ t: `🔥 Расход ${(ph.basalK * Math.pow(ph.mass, 0.75) * 100).toFixed(1)}/100с` });
  out.push({ t: `👁️ ${Math.round(ph.vision)} · 👂 ${Math.round(ph.hearing)} · 👃 ${Math.round(ph.smell)}`, cls: ph.senseMax < 12 ? 'bad' : '' });
  out.push({ t: `⚔️ Атака ${ph.attack.toFixed(1)} · 🛡️ ${pct(ph.armor)}` });
  out.push({ t: `❤️ ${Math.round(ph.maxHealth)}` });
  out.push({ t: `⏳ ${(ph.lifespan / YEAR).toFixed(1)} г. · зрелость ${(ph.matureTime / YEAR).toFixed(2)} г.` });
  out.push({ t: `${ph.repro ? '🥚' : '🍼'} ${ph.litter} за раз` });
  out.push({ t: `🌿 Достаёт до ${ph.reach.toFixed(1)} м` });
  if (!ph.eyes && ph.senseMax < 15) out.push({ t: 'Почти слеп и глух', cls: 'bad' });
  if (ph.onMate === 2) out.push({ t: 'Не размножается!', cls: 'bad' });
  return out;
}

export class CreatureEditor extends GenomeEditor {
  constructor(game) {
    super(game, {
      kind: 'c', table: CG, groups: CREATURE_GROUPS, defaultName: 'Новое животное',
      anims: [['idle', '🧍 Стоит'], ['walk', '🚶 Идёт'], ['run', '🏃 Бежит'], ['eat', '🍽️ Ест'], ['sleep', '💤 Спит'], ['fly', '🪽 Летит']],
      templates: () => STARTER_ANIMALS.map((d) => ({ name: d.name, icon: ICONS[d.name], genome: makeGenome(CG, d.genes) })),
      summary: creatureSummary,
      fixRandom: (g) => { // случайное существо должно быть хотя бы жизнеспособным
        setGeneInt(g, CG[CI.onMate], 0); setGeneInt(g, CG[CI.onFood], 0);
        if (g[CI.eyeCount] < 0.34) g[CI.eyeCount] = 0.5;
      },
    });
  }
}
