// GeneticsSystem — описание генов, наследование, скрещивание, мутации и
// вычисление фенотипа (биологических характеристик) из генома.
// Все гены хранятся в Float32Array в диапазоне 0..1.
//   t:'f' — непрерывный признак, t:'i' — целое (min..max), t:'c' — категория (o — варианты).
import { clamp01, clamp, rnd, gauss, hsl } from '../core/utils.js';

const F = (k, n, grp, w = 1, hint = '') => ({ k, n, grp, t: 'f', w, hint });
const C = (k, n, grp, o, w = 1, hint = '') => ({ k, n, grp, t: 'c', o, w, hint });
const N = (k, n, grp, min, max, w = 1, hint = '') => ({ k, n, grp, t: 'i', min, max, w, hint });

export const CREATURE_GROUPS = [
  { k: 'body', n: 'Тело', icon: '🫀' }, { k: 'limbs', n: 'Конечности', icon: '🦵' },
  { k: 'head', n: 'Голова', icon: '🗿' }, { k: 'senses', n: 'Чувства', icon: '👁️' },
  { k: 'cover', n: 'Покров', icon: '🧥' }, { k: 'color', n: 'Окрас', icon: '🎨' },
  { k: 'bio', n: 'Биология', icon: '🧬' }, { k: 'mind', n: 'Инстинкты', icon: '🧠' },
];

export const CG = [
  F('size', 'Размер тела', 'body', 1.2, 'Крупные сильнее и выносливее, но им нужно больше пищи'),
  F('bodyLength', 'Длина туловища', 'body'),
  F('bodyWidth', 'Ширина туловища', 'body'),
  F('bodyHeight', 'Высота туловища', 'body'),
  F('fat', 'Жировой запас', 'body', 1, 'Запас энергии и защита от холода, но медленнее бег'),
  F('tailLength', 'Длина хвоста', 'body'),
  C('tailType', 'Тип хвоста', 'body', ['Тонкий', 'Толстый', 'Плавник', 'Веер', 'Булава'], 0.8, 'Плавник ускоряет плавание, булава защищает'),
  F('finSize', 'Плавники', 'body', 1, 'Определяют скорость плавания'),
  N('legPairs', 'Пары ног', 'limbs', 0, 4, 1.5, 'Без ног животное ползает'),
  F('legLength', 'Длина ног', 'limbs', 1, 'Длинные ноги — быстрый бег и доступ к высоким листьям'),
  F('legThickness', 'Толщина ног', 'limbs', 1, 'Тяжёлому телу нужны толстые ноги'),
  C('footType', 'Стопа', 'limbs', ['Лапа', 'Копыто', 'Перепонка', 'Когти'], 0.8, 'Копыта — бег, перепонки — плавание, когти — атака'),
  F('wingSize', 'Крылья', 'limbs', 1.2, 'Большие крылья при лёгком теле позволяют летать'),
  F('neckLength', 'Длина шеи', 'head', 1, 'Позволяет дотянуться до крон деревьев'),
  F('headSize', 'Размер головы', 'head'),
  C('headShape', 'Форма головы', 'head', ['Круглая', 'Вытянутая', 'Плоская', 'Угловатая'], 0.6),
  C('mouthType', 'Ротовой аппарат', 'head', ['Зубы травоядного', 'Клыки хищника', 'Всеядные зубы', 'Клюв', 'Клюв падальщика', 'Фильтратор'], 2, 'Определяет доступную пищу'),
  F('jawSize', 'Размер челюстей', 'head', 1, 'Скорость поедания и сила укуса'),
  F('horns', 'Рога и шипы', 'head', 1, 'Защита и ответный урон'),
  F('eyeSize', 'Размер глаз', 'senses', 1, 'Дальность зрения, особенно ночью'),
  C('eyeCount', 'Глаза', 'senses', ['Нет', 'Два', 'Четыре'], 0.8, 'Четыре глаза дают круговой обзор, но меньшую дальность'),
  F('earSize', 'Слух', 'senses', 1, 'Обнаружение движущихся существ со всех сторон'),
  F('noseSize', 'Обоняние', 'senses', 1, 'Поиск пищи и падали на расстоянии, работает ночью'),
  F('antennae', 'Усики (осязание)', 'senses', 1, 'Чувство вибраций вблизи, не зависит от света'),
  C('covering', 'Тип покрова', 'cover', ['Кожа', 'Чешуя', 'Шерсть', 'Перья'], 1.2, 'Шерсть и перья греют, чешуя защищает'),
  F('coverThickness', 'Густота покрова', 'cover', 1, 'Чем гуще, тем лучше переносится холод и хуже жара'),
  C('respiration', 'Дыхание', 'cover', ['Лёгкие', 'Жабры', 'Лёгкие и жабры'], 2, 'Жабры — жизнь в воде, оба типа — земноводное'),
  F('hue1', 'Основной цвет', 'color', 0.5), F('sat', 'Насыщенность', 'color', 0.4), F('light', 'Яркость', 'color', 0.5),
  F('hue2', 'Второй цвет', 'color', 0.4),
  C('pattern', 'Узор', 'color', ['Нет', 'Полосы', 'Пятна', 'Светлое брюхо', 'Градиент'], 0.4),
  F('patternScale', 'Размер узора', 'color', 0.3),
  F('metabolism', 'Обмен веществ', 'bio', 1, 'Быстрый обмен — выше скорость, но больше голод'),
  F('litterSize', 'Размер выводка', 'bio', 1),
  C('reproMode', 'Размножение', 'bio', ['Живорождение', 'Яйца'], 1, 'Яйца дешевле, но беззащитны'),
  F('parentalCare', 'Забота о потомстве', 'bio', 1, 'Детёныши следуют за матерью и получают пищу'),
  F('maturity', 'Скорость взросления', 'bio'),
  F('lifespan', 'Продолжительность жизни', 'bio'),
  F('aggression', 'Агрессивность', 'mind', 0.5), F('fear', 'Осторожность', 'mind', 0.5, 'На каком расстоянии замечает угрозу и реагирует'),
  F('sociality', 'Стадность', 'mind', 0.5), F('curiosity', 'Любопытство', 'mind', 0.5, 'Как далеко уходит исследовать территорию'),
  C('activity', 'При смене освещения', 'mind', ['Днём активен, ночью спит', 'Ночью активен, днём спит', 'Активен всегда'], 0.6),
  C('onFood', 'Обнаружил пищу', 'mind', ['Приблизиться', 'Осторожно (если нет угроз)', 'Игнорировать пока не голоден'], 0.4),
  C('onDanger', 'Обнаружил опасность', 'mind', ['Убегать', 'Затаиться', 'Защищаться', 'Игнорировать'], 0.6),
  C('onStranger', 'Встретил чужака', 'mind', ['Игнорировать', 'Исследовать', 'Отступить', 'Прогнать'], 0.4),
  C('onMate', 'Обнаружил партнёра', 'mind', ['Ухаживать', 'Только когда сыт', 'Игнорировать'], 0.4),
  C('onKin', 'Встретил сородича', 'mind', ['Держаться вместе', 'Игнорировать', 'Избегать'], 0.4),
];

export const PLANT_GROUPS = [
  { k: 'form', n: 'Форма', icon: '🌳' }, { k: 'leaf', n: 'Листва', icon: '🍃' },
  { k: 'root', n: 'Корни', icon: '🥕' }, { k: 'repro', n: 'Размножение', icon: '🌼' },
  { k: 'eco', n: 'Экология', icon: '🌡️' },
];

export const PG = [
  C('type', 'Тип растения', 'form', ['Дерево', 'Кустарник', 'Трава', 'Водное', 'Гриб'], 3),
  F('height', 'Высота', 'form', 1.2, 'Высокие получают больше света, но растут дольше'),
  F('trunk', 'Толщина ствола', 'form', 0.6),
  F('branching', 'Ветвистость', 'form', 0.6),
  F('branchAngle', 'Раскидистость ветвей', 'form', 0.5),
  F('crownSize', 'Размер кроны / шляпки', 'form', 1.2, 'Большая крона — больше листвы и тени для соседей'),
  C('crownShape', 'Форма кроны', 'form', ['Шар', 'Конус', 'Ярусы', 'Зонт', 'Пальма', 'Плакучая'], 0.8),
  F('trunkTone', 'Цвет ствола', 'form', 0.3),
  F('leafDensity', 'Густота листвы', 'leaf', 1),
  F('leafHue', 'Цвет листвы', 'leaf', 0.4), F('leafSat', 'Насыщенность', 'leaf', 0.3), F('leafLight', 'Яркость', 'leaf', 0.3),
  F('deciduous', 'Сбрасывание листвы', 'leaf', 0.6, 'Листопадные пережидают зиму в покое'),
  F('rootDepth', 'Глубина корней', 'root', 1, 'Глубокие корни спасают от засухи'),
  F('rootSpread', 'Ширина корней', 'root', 1, 'Широкие корни лучше добывают питательные вещества'),
  F('flowers', 'Цветы', 'repro', 0.8, 'Цветы дают перекрёстное опыление — больше генетического разнообразия'),
  F('flowerHue', 'Цвет цветов', 'repro', 0.3),
  F('fruit', 'Плоды', 'repro', 0.8, 'Плоды кормят животных, а те разносят семена'),
  F('seedCount', 'Количество семян', 'repro', 1),
  F('seedRange', 'Дальность разноса семян', 'repro', 1),
  F('growthRate', 'Скорость роста', 'eco', 1, 'Быстрый рост сокращает жизнь'),
  F('tempOpt', 'Любимая температура', 'eco', 1.5, 'От −8°C до +34°C'),
  F('tempTol', 'Выносливость к температуре', 'eco', 1),
  F('waterNeed', 'Потребность в воде', 'eco', 1.5, 'Влаголюбивые растут быстрее, но гибнут в засуху'),
  F('shadeTol', 'Теневыносливость', 'eco', 1),
  F('defense', 'Шипы и яды', 'eco', 1, 'Защита от травоядных ценой роста'),
  F('lifespan', 'Продолжительность жизни', 'eco', 0.8),
];

function index(table) { const m = {}; table.forEach((d, i) => { m[d.k] = i; d.i = i; }); return m; }
export const CI = index(CG);
export const PI = index(PG);
export const CLEN = CG.length, PLEN = PG.length;

/** Значение гена в «человеческом» виде: индекс категории или целое. */
export function geneInt(g, d) {
  if (d.t === 'c') return Math.min(d.o.length - 1, Math.floor(g[d.i] * d.o.length));
  if (d.t === 'i') return d.min + Math.min(d.max - d.min, Math.floor(g[d.i] * (d.max - d.min + 1)));
  return g[d.i];
}
export function setGeneInt(g, d, v) {
  const n = d.t === 'c' ? d.o.length : d.max - d.min + 1;
  const idx = d.t === 'c' ? v : v - d.min;
  g[d.i] = (idx + 0.5) / n;
}
const cat = (g, i, n) => Math.min(n - 1, Math.floor(g[i] * n));

export function randomGenome(table) {
  const g = new Float32Array(table.length);
  for (let i = 0; i < g.length; i++) g[i] = rnd();
  return g;
}

/** Создать геном из объекта {ключ: значение}; категории и целые задаются индексом. */
export function makeGenome(table, values, base = 0.5) {
  const g = new Float32Array(table.length).fill(base);
  for (const d of table) {
    if (d.t !== 'f') setGeneInt(g, d, d.t === 'c' ? 0 : d.min);
    const v = values[d.k];
    if (v === undefined) continue;
    if (d.t === 'f') g[d.i] = v; else setGeneInt(g, d, v);
  }
  return g;
}

/** Скрещивание: каждый ген берётся от одного из родителей, иногда смешивается. */
export function crossover(a, b, table) {
  const g = new Float32Array(a.length);
  for (let i = 0; i < g.length; i++) {
    const r = rnd();
    if (table[i].t === 'f' && r < 0.25) g[i] = (a[i] + b[i]) * 0.5;
    else g[i] = r < 0.625 ? a[i] : b[i];
  }
  return g;
}

/** Мутации. Возвращает число изменившихся генов. */
export function mutate(g, table, rate, strength) {
  let n = 0;
  for (let i = 0; i < g.length; i++) {
    const d = table[i];
    if (d.t === 'f') {
      if (rnd() < rate) { g[i] = clamp01(g[i] + gauss() * strength); n++; }
    } else if (rnd() < rate * 0.12) {
      const cnt = d.t === 'c' ? d.o.length : d.max - d.min + 1;
      let idx = Math.min(cnt - 1, Math.floor(g[i] * cnt));
      if (d.t === 'i') idx = clamp(idx + (rnd() < 0.5 ? -1 : 1), 0, cnt - 1);
      else idx = Math.floor(rnd() * cnt);
      g[i] = (idx + 0.5) / cnt; n++;
    }
  }
  return n;
}

function weightSum(table) { let s = 0; for (const d of table) s += d.w; return s; }
const CW = weightSum(CG), PW = weightSum(PG);

/** Генетическая дистанция (0..1): взвешенное среднее различие генов. */
export function geneticDistance(a, b, table) {
  let s = 0;
  for (let i = 0; i < a.length; i++) {
    const d = table[i];
    if (d.t === 'f') s += Math.abs(a[i] - b[i]) * d.w;
    else {
      const n = d.t === 'c' ? d.o.length : d.max - d.min + 1;
      const ia = Math.min(n - 1, Math.floor(a[i] * n)), ib = Math.min(n - 1, Math.floor(b[i] * n));
      if (ia !== ib) s += d.w * (d.t === 'i' ? Math.min(1, Math.abs(ia - ib) * 0.5) : 1);
    }
  }
  return s / (table === CG ? CW : PW);
}

export const SPECIES_DIST = { c: 0.075, p: 0.085 };   // порог видообразования
export const MATE_DIST = 0.13;                         // порог совместимости при скрещивании

export const DIETS = [
  { plant: 1.0, meat: 0, carrion: 0, detritus: 0.05, name: 'Растительноядное', icon: '🌿' },
  { plant: 0, meat: 1.0, carrion: 0.7, detritus: 0, name: 'Хищник', icon: '🥩' },
  { plant: 0.6, meat: 0.6, carrion: 0.5, detritus: 0.1, name: 'Всеядное', icon: '🍽️' },
  { plant: 0.75, meat: 0.45, carrion: 0.3, detritus: 0.1, name: 'Всеядное (клюв)', icon: '🐦' },
  { plant: 0, meat: 0.35, carrion: 1.0, detritus: 0.3, name: 'Падальщик', icon: '🦴' },
  { plant: 0.35, meat: 0, carrion: 0.3, detritus: 1.0, name: 'Детритофаг / фильтратор', icon: '🪱' },
];
const BITE_F = [0.5, 1.6, 1.0, 0.85, 0.9, 0.15];
const FOOT_SPEED = [1.0, 1.18, 0.72, 0.92];

/** Фенотип животного: все функциональные характеристики выводятся из генов. */
export function creaturePheno(g) {
  const I = CI;
  const size = 0.35 + Math.pow(g[I.size], 1.4) * 2.4;
  const L = size * (0.7 + 1.3 * g[I.bodyLength]);
  const W = size * (0.38 + 0.5 * g[I.bodyWidth]);
  const H = size * (0.38 + 0.5 * g[I.bodyHeight]);
  const fat = g[I.fat];
  const mass = L * W * H * 1.6 * (1 + 0.3 * fat);
  const legPairs = geneInt(g, CG[I.legPairs]);
  const legLen = legPairs ? H * (0.35 + 1.6 * g[I.legLength]) : 0;
  const legThick = W * (0.085 + 0.17 * g[I.legThickness]);
  const foot = cat(g, I.footType, 4);
  const neckLen = size * (0.05 + 0.9 * g[I.neckLength]);
  const headSize = size * (0.26 + 0.3 * g[I.headSize]);
  const tailLen = size * g[I.tailLength] * 1.4;
  const tailType = cat(g, I.tailType, 5);
  const fin = g[I.finSize], wing = g[I.wingSize];
  const cover = cat(g, I.covering, 4), thick = g[I.coverThickness];
  const resp = cat(g, I.respiration, 3);
  const mouth = cat(g, I.mouthType, 6);
  const jaw = g[I.jawSize], horns = g[I.horns], metab = g[I.metabolism];
  const sizeK = Math.pow(size, 0.25), metK = 0.85 + 0.3 * metab;

  // --- передвижение
  let land;
  if (!legPairs) land = 0.9 + 1.5 * g[I.bodyLength] + (1 - g[I.bodyWidth]) * 0.6;
  else {
    land = 2.0 + 4.6 * Math.pow(g[I.legLength], 0.7) * FOOT_SPEED[foot];
    if (legPairs === 1) land *= 0.93;
    const need = clamp01(Math.log10(mass + 1) * 0.62);
    const lt = g[I.legThickness];
    if (lt < need) land *= 1 - (need - lt) * 0.8;
    else land *= 1 - 0.15 * Math.max(0, lt - need - 0.3);
  }
  land *= (1 / (1 + 0.1 * Math.pow(mass, 0.4))) * (1 - 0.3 * fat) * metK * sizeK * (1 - 0.2 * wing);
  let swim = 0.5 + 3.8 * fin + (tailType === 2 ? 2.6 * g[I.tailLength] : 0.3 * g[I.tailLength]) +
    (g[I.bodyLength] - g[I.bodyWidth]) * 0.9;
  if (legPairs) swim += foot === 2 ? 1.3 : -legPairs * g[I.legLength] * 0.25;
  if (resp !== 0) swim *= 1.15;
  swim = Math.max(0.3, swim * sizeK * metK * (1 - 0.3 * wing));
  const wingArea = wing * wing * size * size * 2.4 * (cover === 3 ? 1.25 : 1);
  const wingLoad = mass / Math.max(wingArea, 0.001);
  const canFly = wing > 0.22 && wingLoad < 1.3 && resp !== 1;
  const fly = canFly ? (5 + 5 * wing + size - wingLoad * 1.5) * metK : 0;
  const habitat = resp === 1 ? 'water' : resp === 2 ? 'amphi' : canFly ? 'air' : 'land';
  const slopeGrip = legPairs ? 0.5 + 0.12 * legPairs + (foot === 3 ? 0.25 : foot === 1 ? 0.15 : 0) : 0.35;

  // --- органы чувств
  const eyes = [0, 2, 4][cat(g, I.eyeCount, 3)];
  const activity = cat(g, I.activity, 3);
  const vision = eyes ? (9 + 42 * g[I.eyeSize]) * (eyes === 4 ? 0.8 : 1) * (0.85 + 0.15 * size) : 0;
  const fovCos = eyes === 4 ? -1.01 : -0.26;
  const nightVis = clamp01(0.22 + 0.6 * g[I.eyeSize] + (activity === 1 ? 0.3 : 0));
  const hearing = 3 + 28 * g[I.earSize], smell = 3 + 36 * g[I.noseSize], sixth = 14 * g[I.antennae];
  const senseCost = (eyes / 2) * g[I.eyeSize] * 0.25 + (g[I.earSize] + g[I.noseSize] + g[I.antennae]) * 0.12;

  // --- питание, бой, защита
  const diet = DIETS[mouth];
  const eatRate = 1.0 * Math.pow(mass, 0.75) * (0.6 + 0.8 * jaw);
  const claws = legPairs > 0 && foot === 3;
  const attack = BITE_F[mouth] * (0.5 + jaw) * Math.pow(mass, 0.6) * 3 + (claws ? 2 * Math.sqrt(mass) : 0) + horns * Math.sqrt(mass) * 1.2;
  const armor = Math.min(0.6, (cover === 1 ? 0.15 + 0.3 * thick : cover === 2 ? 0.08 * thick : 0) + horns * 0.12);
  const counter = horns * Math.sqrt(mass) * 2.5 + (tailType === 4 ? g[I.tailLength] * Math.sqrt(mass) * 2 : 0);
  const maxHealth = 22 * Math.pow(mass, 0.7) * (1 + armor);

  // --- терморегуляция и энергия
  const insul = [0.05, 0.12, 0.25 + 0.75 * thick, 0.2 + 0.65 * thick][cover] + fat * 0.45 + clamp(Math.log2(mass + 1) * 0.06, 0, 0.3);
  const tempOpt = resp === 1 ? 22 - insul * 20 : 31 - insul * 30;
  const tempTol = 9 + 2.5 * size + (cover >= 2 ? 2 : 0) + (resp === 1 ? 3 : 0);
  const basalK = 0.085 * (0.55 + 0.9 * metab) * (1 + senseCost + 0.15 * wing + 0.1 * horns + armor * 0.2);
  const energyK = 10 + 22 * fat;

  // --- жизненный цикл
  const repro = cat(g, I.reproMode, 2);
  const litter = 1 + Math.round(g[I.litterSize] * (repro ? 7 : 4));
  const care = g[I.parentalCare];
  const matureTime = (70 + 130 * (1 - g[I.maturity])) * Math.pow(mass, 0.2);
  const lifespan = (500 + 900 * g[I.lifespan]) * Math.pow(mass, 0.15) / (0.7 + 0.6 * metab);
  const gestation = repro ? 10 : 8 + 26 * Math.pow(mass, 0.2);
  const incubation = 26 * Math.pow(mass, 0.15);
  const birthGrow = repro ? 0.22 : 0.34;

  const light = 0.2 + 0.55 * g[I.light], sat = 0.15 + 0.75 * g[I.sat];
  return {
    size, L, W, H, mass, legPairs, legLen, legThick, foot, neckLen, headSize, tailLen, tailType, fin, wing,
    cover, thick, resp, mouth, jaw, horns, metab, land, swim, fly, canFly, wingLoad, habitat, slopeGrip,
    standH: legLen + H, reach: legLen + H * 0.8 + neckLen * 0.85 + headSize * 0.3,
    eyes, activity, vision, fovCos, nightVis, hearing, smell, sixth,
    senseMax: Math.max(vision, hearing, smell, sixth),
    diet, eatRate, attack, armor, counter, maxHealth, insul, tempOpt, tempTol, basalK, energyK,
    repro, litter, care, matureTime, lifespan, gestation, incubation, birthGrow,
    aggression: g[I.aggression], fear: g[I.fear], sociality: g[I.sociality], curiosity: g[I.curiosity],
    onFood: cat(g, I.onFood, 3), onDanger: cat(g, I.onDanger, 4), onStranger: cat(g, I.onStranger, 4),
    onMate: cat(g, I.onMate, 3), onKin: cat(g, I.onKin, 3),
    color: hsl(g[I.hue1], sat, light), color2: hsl(g[I.hue2], sat * 0.9, clamp01(light + 0.12)),
  };
}

export const PLANT_TYPES = ['Дерево', 'Кустарник', 'Трава', 'Водное растение', 'Гриб'];

/** Фенотип растения. */
export function plantPheno(g) {
  const I = PI, type = cat(g, I.type, 5);
  const h = g[I.height], c = g[I.crownSize], gr = g[I.growthRate];
  const maxH = [4 + 13 * h, 1 + 2.6 * h, 0.35 + 0.9 * h, 0.5 + 1.6 * h, 0.3 + 1.2 * h][type];
  const crownR = [1.0 + 3.4 * c, 0.6 + 1.3 * c, 0.3 + 0.45 * c, 0.4 + 0.9 * c, 0.25 + 0.7 * c][type];
  const leaf = 0.5 + g[I.leafDensity];
  const r2 = crownR * crownR;
  const maxBio = [r2 * leaf * 3, r2 * leaf * 2.8, r2 * leaf * 10, r2 * leaf * 4.5, r2 * 3][type];
  const areaFrac = Math.PI * r2 / 16 * [0.5, 1, 1, 0.8, 0.5][type] * (0.6 + 0.4 * leaf);
  const foliageBase = type === 0 ? maxH * (0.32 + 0.22 * (1 - c)) : type === 1 ? maxH * 0.1 : 0;
  const fruit = type <= 1 && g[I.fruit] > 0.25 ? g[I.fruit] : 0;
  const waterNeed = 0.12 + 0.7 * g[I.waterNeed];
  const shadeTol = type === 4 ? 1 : g[I.shadeTol], defense = g[I.defense];
  const tempTolG = g[I.tempTol];
  // компромиссы: любое преимущество чего-то стоит
  const vigor = (0.75 + 0.5 * g[I.waterNeed]) * (1.15 - 0.3 * tempTolG) * (1 - 0.2 * g[I.rootDepth]) *
    (1 - 0.22 * (type === 4 ? 0 : g[I.shadeTol])) * (1 - 0.3 * defense) * (1 - 0.12 * fruit);
  const seeds = 1 + Math.round(g[I.seedCount] * [2, 2, 3, 3, 4][type]);
  const flowers = type !== 4 && g[I.flowers] > 0.15 ? g[I.flowers] : 0;
  return {
    type, maxH, crownR, leaf, maxBio, areaFrac, foliageBase, fruit, flowers, waterNeed, shadeTol, defense, vigor,
    matureTime: [260, 120, 45, 70, 40][type] * (1.6 - 1.2 * gr) * (0.6 + 0.8 * h),
    regrowTime: [300, 210, 190, 160, 100][type] * (1.5 - gr),
    lifespan: [2600 + 4000 * g[I.lifespan], 900 + 1500 * g[I.lifespan], 260 + 460 * g[I.lifespan],
      350 + 600 * g[I.lifespan], 170 + 300 * g[I.lifespan]][type] * (1.3 - 0.6 * gr),
    seeds, seedInterval: [150, 95, 55, 65, 42][type] * (0.7 + g[I.seedCount] * 0.8) * (1 + 0.3 * flowers),
    seedRange: [6 + 34 * g[I.seedRange], 4 + 22 * g[I.seedRange], 2 + 14 * g[I.seedRange],
      3 + 18 * g[I.seedRange], 3 + 26 * g[I.seedRange]][type],
    tempOpt: -8 + 42 * g[I.tempOpt], tempTol: 7 + 14 * tempTolG,
    rootDepth: g[I.rootDepth], rootSpread: g[I.rootSpread],
    deciduous: type <= 1 && g[I.deciduous] > 0.5,
    waterUse: waterNeed * areaFrac * 0.010, nutUse: areaFrac * 0.004 * (0.6 + gr),
    energyDensity: [1, 1, 0.9, 0.9, 0.7][type] * (1 - 0.55 * defense),
    leafColor: hsl(0.12 + g[I.leafHue] * 0.42, 0.25 + 0.6 * g[I.leafSat], 0.2 + 0.35 * g[I.leafLight]),
  };
}

/** Краткое словесное описание животного для энциклопедии. */
export function describeCreature(ph) {
  const hab = { land: 'наземное', water: 'водное', amphi: 'земноводное', air: 'летающее' }[ph.habitat];
  const sz = ph.mass < 0.2 ? 'крошечное' : ph.mass < 0.8 ? 'мелкое' : ph.mass < 3 ? 'среднее' : ph.mass < 10 ? 'крупное' : 'гигантское';
  const cov = ['с голой кожей', 'покрытое чешуёй', 'покрытое шерстью', 'покрытое перьями'][ph.cover];
  const legs = ph.legPairs ? `${ph.legPairs * 2} ног` : 'без ног';
  return `${sz[0].toUpperCase() + sz.slice(1)} ${hab} животное ${cov}, ${legs}. ${ph.diet.name}.`;
}
