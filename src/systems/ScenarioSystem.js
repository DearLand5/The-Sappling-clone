// ScenarioSystem — обучающие сценарии: готовый мир, набор целей и проверка их выполнения.
import { YEAR } from '../world/ClimateSystem.js';

const animals = (sim) => sim.organisms.aliveSpecies('c');
const plantsAlive = (sim) => sim.organisms.aliveSpecies('p');
const sumPop = (list) => list.reduce((s, sp) => s + sp.pop, 0);
const herb = (sp) => sp.ph.diet.plant >= 0.6 && sp.ph.diet.meat < 0.3;
const carn = (sp) => sp.ph.diet.meat >= 0.6;
const recycler = (sp) => sp.ph.diet.carrion >= 0.9 || sp.ph.diet.detritus >= 0.9;
const frac = (v, n) => Math.min(1, v / n);

export const SCENARIOS = [
  {
    id: 'herbivore', title: '1. Первое травоядное', icon: '🌿',
    desc: 'Мир полон растений, но в нём нет животных. Откройте «Создать», сконструируйте растительноядное животное и разместите несколько особей на лугу.',
    hint: 'Выберите ротовой аппарат «Зубы травоядного». Разместите не меньше 6 особей — нужны и самцы, и самки. Следите, чтобы климат подходил: шерсть греет, голая кожа любит тепло.',
    world: { seed: 4101, size: 64, water: 0.3, temperature: 0.58, humidity: 0.55, vegetation: 0.85, relief: 0.3, height: 0.3, diversity: 0.3 },
    starters: [], disasters: false,
    goals: [
      { text: 'Создать и разместить травоядный вид', test: (s) => animals(s).some(herb) },
      { text: 'Популяция травоядных — 25 особей', test: (s) => frac(sumPop(animals(s).filter(herb)), 25) },
    ],
  },
  {
    id: 'predator', title: '2. Хищник', icon: '🥩',
    desc: 'Травоядные расплодились и объедают луга. Создайте хищника, который будет на них охотиться, — но так, чтобы добыча не исчезла полностью.',
    hint: 'Хищнику нужны «Клыки хищника», хорошие ноги и органы чувств. Он должен быть быстрее добычи. Начните с 4–6 особей: слишком много хищников съедят всех и погибнут сами.',
    world: { seed: 4202, size: 64, water: 0.3, temperature: 0.55, humidity: 0.55, vegetation: 0.8, relief: 0.35, height: 0.35, diversity: 0.35 },
    starters: ['Прыгун луговой', 'Рогач степной'], disasters: false,
    goals: [
      { text: 'Создать и разместить хищника', test: (s) => animals(s).some(carn) },
      { text: 'Хищников не меньше 8', test: (s) => frac(sumPop(animals(s).filter(carn)), 8) },
      { text: 'Хищники и добыча сосуществуют 1 год', hold: YEAR, test: (s) => animals(s).some(carn) && sumPop(animals(s).filter(herb)) >= 8 },
    ],
  },
  {
    id: 'chain', title: '3. Пищевая цепь', icon: '🔗',
    desc: 'Постройте полную пищевую цепь: растения, травоядные, хищники и те, кто перерабатывает останки, — падальщики или детритофаги.',
    hint: 'Останки погибших животных кормят падальщиков, а опад и детрит — детритофагов. Грибы тоже возвращают вещества в почву. Виды можно брать из списка стартовых во вкладке «Жизнь».',
    world: { seed: 4303, size: 64, water: 0.35, temperature: 0.55, humidity: 0.6, vegetation: 0.8, relief: 0.35, height: 0.35, diversity: 0.4 },
    starters: ['Прыгун луговой'], disasters: false,
    goals: [
      { text: 'В мире есть травоядные', test: (s) => animals(s).some(herb) },
      { text: 'В мире есть хищники', test: (s) => animals(s).some(carn) },
      { text: 'В мире есть падальщики или детритофаги', test: (s) => animals(s).some(recycler) },
      { text: 'Вся цепь держится 2 года', hold: YEAR * 2, test: (s) => { const a = animals(s); return a.some(herb) && a.some(carn) && a.some(recycler) && plantsAlive(s).length > 0; } },
    ],
  },
  {
    id: 'diversity', title: '4. Многообразие', icon: '🦋',
    desc: 'Добейтесь одновременного существования шести видов животных. Разным видам нужны разные ниши: пища, среда обитания, время активности.',
    hint: 'Заселите воду, сушу и воздух. Виды с одинаковой пищей вытесняют друг друга, поэтому делайте их разными.',
    world: { seed: 4404, size: 96, water: 0.42, temperature: 0.58, humidity: 0.55, vegetation: 0.7, relief: 0.5, height: 0.5, diversity: 0.7 },
    starters: ['Прыгун луговой', 'Серебрянка'], disasters: false,
    goals: [
      { text: '6 видов животных (не менее 4 особей каждый)', test: (s) => frac(animals(s).filter((sp) => sp.pop >= 4).length, 6) },
      { text: 'Удержать разнообразие 1 год', hold: YEAR, test: (s) => animals(s).filter((sp) => sp.pop >= 4).length >= 6 },
    ],
  },
  {
    id: 'stable', title: '5. Устойчивая экосистема', icon: '⚖️',
    desc: 'Создайте мир, который живёт сам: не менее трёх видов животных и четырёх видов растений должны продержаться пять лет, несмотря на катастрофы.',
    hint: 'Используйте перемотку времени. Устойчивость дают разнообразие, умеренная плодовитость и запас пищи. Мутации помогут видам приспособиться.',
    world: { seed: 4505, size: 96, water: 0.4, temperature: 0.55, humidity: 0.55, vegetation: 0.7, relief: 0.5, height: 0.5, diversity: 0.6 },
    starters: 'all', disasters: true,
    goals: [
      { text: 'Не менее 3 видов животных и 60 особей', test: (s) => Math.min(frac(animals(s).length, 3), frac(s.organisms.creatures.length, 60)) },
      { text: 'Экосистема стабильна 5 лет', hold: YEAR * 5, test: (s) => animals(s).length >= 3 && plantsAlive(s).length >= 4 && s.organisms.creatures.length >= 40 },
    ],
  },
  {
    id: 'iceage', title: '6. Ледниковый период', icon: '🧊',
    desc: 'Через год начнётся похолодание на 14 градусов. Помогите жизни пережить его: включите мутации, создайте холодостойкие виды или дайте эволюции сделать своё дело.',
    hint: 'Густая шерсть, жир и крупное тело спасают от холода. Растениям нужна низкая «любимая температура». Высокая частота мутаций ускоряет приспособление, но рискованна.',
    world: { seed: 4606, size: 96, water: 0.4, temperature: 0.62, humidity: 0.55, vegetation: 0.75, relief: 0.45, height: 0.45, diversity: 0.5 },
    starters: 'all', disasters: false,
    onStart: (sim) => { sim.scenarioTimer = YEAR; },
    onTick: (sim, sc) => { if (!sc.state.cooled && sim.climate.time >= YEAR) { sc.state.cooled = true; sim.climate.startTrend(-14, YEAR * 2.5); sim.log('🧊 Началось глобальное похолодание!', 'bad'); } },
    goals: [
      { text: 'Дождаться конца похолодания (год 5)', test: (s) => frac(s.climate.time, YEAR * 4) },
      { text: 'После похолодания живы 2 вида животных по 10 особей', test: (s) => s.climate.time >= YEAR * 4 ? frac(animals(s).filter((sp) => sp.pop >= 10).length, 2) : 0 },
    ],
  },
];

export class Scenario {
  constructor(def, sim, saved) {
    this.def = def; this.sim = sim;
    this.state = saved ? saved.state : { hold: {}, cooled: false };
    this.done = saved ? saved.done : false;
    this.progress = def.goals.map(() => 0);
    this.t = 0;
    if (!saved && def.onStart) def.onStart(sim);
  }
  update(dt) {
    this.t -= dt;
    if (this.t > 0) return false;
    const step = 1 - this.t; this.t = 1;
    const def = this.def, sim = this.sim;
    if (def.onTick) def.onTick(sim, this);
    let all = true;
    def.goals.forEach((g, i) => {
      let v = g.test(sim);
      v = v === true ? 1 : v === false ? 0 : v;
      if (g.hold) {
        const prevOk = def.goals.slice(0, i).every((_, j) => this.progress[j] >= 1 || def.goals[j].hold);
        let h = this.state.hold[i] || 0;
        h = v >= 1 && prevOk ? h + step : Math.max(0, h < g.hold ? 0 : h);
        this.state.hold[i] = h; v = Math.min(1, h / g.hold);
      }
      this.progress[i] = v;
      if (v < 1) all = false;
    });
    if (all && !this.done) { this.done = true; return true; }
    return false;
  }
  serialize() { return { id: this.def.id, state: this.state, done: this.done }; }
}

export function findScenario(id) { return SCENARIOS.find((s) => s.id === id); }
