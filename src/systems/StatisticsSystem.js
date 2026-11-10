// StatisticsSystem — история численности, счётчики событий, пищевые связи,
// отчёты за период и журнал событий.
import { SEASON, YEAR } from '../world/ClimateSystem.js';

const SAMPLE = 10;      // интервал записи численности, с
const MAX_POINTS = 220;

export class StatisticsSystem {
  constructor(sim) {
    this.sim = sim;
    this.counters = { births: 0, deaths: 0, mutations: 0, speciations: 0, extinctions: 0, disasters: 0, plantsBorn: 0, plantsDied: 0 };
    this.deathsBy = {};
    this.gt = []; this.gAnimals = []; this.gPlants = []; this.gSpecies = []; this.gTemp = [];
    this.sampleT = 0; this.snapT = 0;
    this.snapshots = [];
    this.logItems = [];
    this.pendingSpecies = [];
  }

  recordEat(eater, key, amt) { eater.eats[key] = (eater.eats[key] || 0) + amt; }

  update(dt) {
    this.sampleT -= dt;
    if (this.sampleT <= 0) { this.sampleT = SAMPLE; this.sample(); }
    this.snapT -= dt;
    if (this.snapT <= 0) { this.snapT = SEASON / 2; this.snapshot(); }
  }

  sample() {
    const sim = this.sim, org = sim.organisms, t = sim.climate.time;
    let nSp = 0;
    for (const sp of org.species.values()) {
      if (sp.pop <= 0) {
        if (sp.hp.length && sp.hp[sp.hp.length - 1] !== 0) { sp.ht.push(t); sp.hp.push(0); }
        continue;
      }
      nSp++;
      sp.ht.push(t); sp.hp.push(sp.pop);
      if (sp.hp.length > MAX_POINTS) { sp.ht = sp.ht.filter((_, i) => i % 2 === 0); sp.hp = sp.hp.filter((_, i) => i % 2 === 0); }
    }
    this.gt.push(t); this.gAnimals.push(org.creatures.length); this.gPlants.push(org.plants.length);
    this.gSpecies.push(nSp); this.gTemp.push(Math.round((sim.climate.globalTemp + sim.climate.tempAnom + sim.climate.seasonT) * 10) / 10);
    if (this.gt.length > MAX_POINTS) for (const k of ['gt', 'gAnimals', 'gPlants', 'gSpecies', 'gTemp']) this[k] = this[k].filter((_, i) => i % 2 === 0);
    // объявляем новые виды, когда они закрепились
    const ps = this.pendingSpecies;
    for (let i = ps.length - 1; i >= 0; i--) {
      const sp = ps[i];
      if (sp.pop >= 4) {
        const par = org.species.get(sp.parent);
        sim.log(`🧬 Новый вид: ${sp.name}${par ? ' (от ' + par.name + ')' : ''}`, 'good');
        sim.events.emit('speciesEstablished', sp);
        ps.splice(i, 1);
      } else if (sp.pop <= 0) ps.splice(i, 1);
    }
  }

  makeSnapshot() {
    const org = this.sim.organisms, pops = {};
    for (const sp of org.species.values()) if (sp.pop > 0) pops[sp.id] = sp.pop;
    return { t: this.sim.climate.time, pops, c: Object.assign({}, this.counters), animals: org.creatures.length, plants: org.plants.length };
  }
  snapshot() {
    this.snapshots.push(this.makeSnapshot());
    if (this.snapshots.length > 160) this.snapshots = this.snapshots.filter((_, i) => i % 2 === 1);
  }

  /** Отчёт об изменениях за период (секунды симуляции) или от заданного снимка. */
  report(period, from) {
    const sim = this.sim, org = sim.organisms, now = sim.climate.time;
    let snap = from;
    if (!snap) {
      const t0 = now - period;
      for (const s of this.snapshots) { if (s.t <= t0 + 1) snap = s; else break; }
      if (!snap) snap = this.snapshots[0] || { t: 0, pops: {}, c: {}, animals: 0, plants: 0 };
    }
    const r = { from: snap.t, to: now, years: (now - snap.t) / YEAR, appeared: [], extinct: [], changes: [], counters: {} };
    for (const k of Object.keys(this.counters)) r.counters[k] = this.counters[k] - (snap.c[k] || 0);
    r.animals = [snap.animals, org.creatures.length]; r.plants = [snap.plants, org.plants.length];
    for (const sp of org.species.values()) {
      const before = snap.pops[sp.id] || 0, after = sp.pop;
      if (!before && !after) continue;
      if (!before && after) r.appeared.push(sp);
      else if (before && !after) r.extinct.push(sp);
      r.changes.push({ sp, before, after });
    }
    r.changes.sort((a, b) => Math.abs(b.after - b.before) - Math.abs(a.after - a.before));
    return r;
  }

  log(text, type = 'info') {
    this.logItems.push({ t: this.sim.climate.time, text, type });
    if (this.logItems.length > 120) this.logItems.shift();
  }

  /** Пищевые связи: [{from: вид-едок, to: вид-пища | 'det', amt, carrion}] */
  foodLinks() {
    const org = this.sim.organisms, links = [];
    for (const sp of org.species.values()) {
      if (sp.kind !== 'c') continue;
      for (const key of Object.keys(sp.eats)) {
        const amt = sp.eats[key]; if (amt < 0.5) continue;
        if (key === 'det') { links.push({ from: sp, to: 'det', amt }); continue; }
        const carrion = key[0] === 'c';
        const to = org.species.get(+(carrion ? key.slice(1) : key));
        if (to) links.push({ from: sp, to, amt, carrion });
      }
    }
    return links;
  }

  serialize() {
    return { counters: this.counters, deathsBy: this.deathsBy, gt: this.gt.map(Math.round), gAnimals: this.gAnimals, gPlants: this.gPlants, gSpecies: this.gSpecies, gTemp: this.gTemp, log: this.logItems.slice(-40) };
  }
  deserialize(d) {
    Object.assign(this.counters, d.counters); this.deathsBy = d.deathsBy || {};
    this.gt = d.gt || []; this.gAnimals = d.gAnimals || []; this.gPlants = d.gPlants || []; this.gSpecies = d.gSpecies || []; this.gTemp = d.gTemp || [];
    this.logItems = d.log || [];
  }
}
