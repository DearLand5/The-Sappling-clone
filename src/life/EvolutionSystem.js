// EvolutionSystem — размножение, наследование, мутации и видообразование.
// Эволюция не задана сценарием: она возникает из наследственности, изменчивости
// и отбора, который осуществляют голод, хищники, климат и конкуренция.
import { rnd, rndRange, TAU } from '../core/utils.js';
import { CG, PG, crossover, mutate, geneticDistance, SPECIES_DIST } from './GeneticsSystem.js';
import { STAGE } from './OrganismSystem.js';

export class EvolutionSystem {
  constructor(sim) {
    this.sim = sim;
    this.enabled = true;      // мутации включены
    this.speciation = true;   // разрешено появление новых видов
    this.rate = 0.06;         // вероятность мутации каждого гена
    this.strength = 0.06;     // величина изменения
  }

  /** Спаривание двух особей: самка становится беременной. */
  mate(a, b) {
    const f = a.sex === 0 ? a : b, m = a.sex === 0 ? b : a;
    if (f.sex === m.sex || f.pregnant >= 0) return;
    f.pregnant = f.ph.gestation; f.fatherG = m.g; f.fatherSp = m.sp;
    m.mateCd = 18 + rnd() * 10; f.mateCd = 5;
    m.energy -= m.maxE * 0.04;
    a.state = 0; b.state = 0; a.target = null; b.target = null;
    this.sim.events.emit('mate', f, m);
  }

  /** Рождение детёнышей или откладывание яиц. */
  giveBirth(mom) {
    const sim = this.sim, org = sim.organisms, ph = mom.ph;
    mom.pregnant = -1;
    const fg = mom.fatherG || mom.g, fsp = mom.fatherSp || mom.sp;
    mom.fatherG = null; mom.fatherSp = null;
    const childM = ph.mass * Math.pow(ph.birthGrow, 2.4);
    const cost = Math.pow(childM, 0.9) * ph.energyK * (ph.repro ? 0.9 : 1.15) + childM * 4;
    let n = Math.min(ph.litter, Math.floor((mom.energy - mom.maxE * 0.15) / cost));
    const total = org.creatures.length, max = sim.settings.maxCreatures;
    // ограничение численности ради производительности; массовые виды уступают место редким
    if (total >= max * 1.1 || (total >= max && mom.sp.pop > max * 0.08) || mom.sp.pop > max * 0.35) n = 0;
    else if (total > max * 0.8 && mom.sp.pop > max * 0.3) n = Math.min(n, 1);
    if (n < 1) { mom.mateCd = 12; if (fsp.pop === 0) org.checkExtinct(fsp); return; }
    for (let k = 0; k < n; k++) {
      const g = crossover(mom.g, fg, CG);
      let nm = 0;
      if (this.enabled) nm = mutate(g, CG, this.rate, this.strength);
      const sp = this.assignSpecies(g, mom.sp, fsp, 'c');
      if (nm) { sim.stats.counters.mutations += nm; sp.mutations += nm; }
      const a = rnd() * TAU, r = ph.size * 0.8 + 0.4;
      const x = mom.x + Math.cos(a) * r, z = mom.z + Math.sin(a) * r;
      const egg = ph.repro === 1;
      const c = org.spawnCreature(sp, g, x, z, {
        stage: egg ? STAGE.EGG : STAGE.JUV, age: 0, energyFrac: 0.75, mother: mom, gen: mom.gen + 1,
      });
      if (egg) { c.x = mom.x + Math.cos(a) * r * 0.5; c.z = mom.z + Math.sin(a) * r * 0.5; c.y = Math.max(c.gy, sim.terrain.waterLevel - mom.ph.H); org.cgrid.update(c); }
      sim.stats.counters.births++;
      sim.events.emit('birth', c, mom);
    }
    mom.energy -= cost * n; mom.kids += n;
    mom.mateCd = 16 + ph.care * 55 + rnd() * 10;
    if (ph.care > 0.3) { mom.homeT = (ph.repro ? ph.incubation : 0) + 30 + ph.care * 40; mom.hx = mom.x; mom.hz = mom.z; }
    if (fsp.pop === 0) org.checkExtinct(fsp);
  }

  hatch(c) {
    c.stage = STAGE.JUV; c.age = 0; c.lastT = this.sim.climate.time;
    c.gy = this.sim.terrain.heightAt(c.x, c.z);
    this.sim.events.emit('hatch', c);
  }

  /** Определение вида потомка; при достаточном расхождении возникает новый вид. */
  assignSpecies(g, spA, spB, kind) {
    const table = kind === 'c' ? CG : PG, T = SPECIES_DIST[kind], org = this.sim.organisms;
    let best = spA, bd = geneticDistance(g, spA.genome, table);
    if (spB && spB !== spA) { const d = geneticDistance(g, spB.genome, table); if (d < bd) { bd = d; best = spB; } }
    if (bd <= T || !this.speciation || !this.enabled) return best;
    // ищем подходящий вид среди ближайших родственников
    const base = best;
    const consider = (id) => {
      const s = org.species.get(id);
      if (!s || s.pop <= 0 || s.kind !== kind) return;
      const d = geneticDistance(g, s.genome, table);
      if (d < bd) { bd = d; best = s; }
    };
    for (const id of base.children) consider(id);
    if (base.parent) { consider(base.parent); const par = org.species.get(base.parent); if (par) for (const id of par.children) consider(id); }
    if (bd <= T * 0.85) return best;
    const sp = org.createSpecies(kind, g, { parent: spA.id });
    this.sim.stats.counters.speciations++;
    this.sim.stats.pendingSpecies.push(sp);
    return sp;
  }

  serialize() { return { enabled: this.enabled, speciation: this.speciation, rate: this.rate, strength: this.strength }; }
  deserialize(d) { Object.assign(this, d); }
}
