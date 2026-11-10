// OrganismSystem — хранилище всех организмов (животные, растения, останки),
// реестр видов, создание и удаление особей.
import { SpatialGrid } from '../core/SpatialGrid.js';
import { rnd, rndRange, TAU, makeSpeciesName, makeEpithet, packGenome, unpackGenome, clamp } from '../core/utils.js';
import { CG, PG, CLEN, PLEN, creaturePheno, plantPheno, geneticDistance, MATE_DIST } from './GeneticsSystem.js';

export const STAGE = { EGG: 0, JUV: 1, ADULT: 2 };
export const DEATH_CAUSES = {
  starve: 'Голод', eaten: 'Съедены', age: 'Старость', cold: 'Холод', heat: 'Жара', thirst: 'Жажда',
  drown: 'Утонули', stranded: 'Без воды (жабры)', disease: 'Болезнь', disaster: 'Катастрофа', fight: 'Драка',
  removed: 'Удалены игроком', shade: 'Нехватка света', drought: 'Засуха', flood: 'Затопление', fire: 'Пожар',
};

export class OrganismSystem {
  constructor(sim) {
    this.sim = sim;
    this.creatures = []; this.plants = []; this.carcasses = [];
    this.species = new Map();
    this.nextId = 1; this.nextSpId = 1;
    this.cgrid = new SpatialGrid(sim.world.size, 12);
    this.pgrid = new SpatialGrid(sim.world.size, 8);
    this.deadC = []; this.deadP = [];
    this.compatCache = new Map();
  }

  // ---------- виды
  createSpecies(kind, genome, o = {}) {
    const g = Float32Array.from(genome);
    const parent = o.parent ? this.species.get(o.parent) : null;
    let name = o.name;
    if (!name) name = parent ? parent.name.split(' ')[0] + ' ' + makeEpithet() : makeSpeciesName();
    const sp = {
      id: o.id || this.nextSpId++, kind, name, genome: g, ph: kind === 'c' ? creaturePheno(g) : plantPheno(g),
      parent: parent ? parent.id : null, children: [], depth: parent ? parent.depth + 1 : 0,
      bornAt: o.bornAt ?? this.sim.climate.time, extinctAt: -1, pop: 0, peak: 0, totalBorn: 0,
      deaths: {}, mutations: 0, ht: [], hp: [], eats: {}, custom: !!o.custom, note: o.note || '',
    };
    if (sp.id >= this.nextSpId) this.nextSpId = sp.id + 1;
    if (parent) parent.children.push(sp.id);
    this.species.set(sp.id, sp);
    this.sim.events.emit('speciesCreated', sp);
    return sp;
  }

  /** Изменение генома вида игроком (редактор). Существующие особи остаются прежними. */
  updateSpecies(sp, genome, name) {
    sp.genome = Float32Array.from(genome);
    sp.ph = sp.kind === 'c' ? creaturePheno(sp.genome) : plantPheno(sp.genome);
    if (name) sp.name = name;
    this.compatCache.clear();
    this.sim.events.emit('speciesChanged', sp);
  }

  /** Полное удаление вида из мира вместе со всеми особями. */
  deleteSpecies(sp) {
    if (sp.kind === 'c') { for (const c of this.creatures) if (c.sp === sp && c.alive) this.killCreature(c, 'removed', true); }
    else for (const p of this.plants) if (p.sp === sp && p.alive) this.killPlant(p, 'removed');
    this.flush();
    if (sp.extinctAt < 0) sp.extinctAt = this.sim.climate.time;
    sp.deleted = true;
    this.sim.events.emit('speciesDeleted', sp);
  }

  /** Могут ли особи двух видов скрещиваться (близкородственные линии). */
  compatible(a, b) {
    if (a === b) return true;
    if (a.parent !== b.id && b.parent !== a.id && (a.parent === null || a.parent !== b.parent)) return false;
    const key = a.id < b.id ? a.id * 100000 + b.id : b.id * 100000 + a.id;
    let v = this.compatCache.get(key);
    if (v === undefined) { v = geneticDistance(a.genome, b.genome, CG) < MATE_DIST; this.compatCache.set(key, v); }
    return v;
  }

  aliveSpecies(kind) { const r = []; for (const sp of this.species.values()) if (sp.pop > 0 && (!kind || sp.kind === kind)) r.push(sp); return r; }

  // ---------- животные
  updateBody(c) {
    const ph = c.ph;
    c.m = ph.mass * Math.pow(c.grow, 2.4);
    c.maxE = Math.pow(c.m, 0.9) * ph.energyK;
    c.maxH = 22 * Math.pow(c.m, 0.7) * (1 + ph.armor);
    c.basal = ph.basalK * Math.pow(c.m, 0.75);
  }

  spawnCreature(sp, genome, x, z, o = {}) {
    const g = genome || Float32Array.from(sp.genome);
    const ph = genome ? creaturePheno(g) : sp.ph;
    const stage = o.stage ?? STAGE.ADULT;
    const c = {
      id: this.nextId++, kind: 'c', sp, g, ph, x, z, y: 0, gy: 0, heading: rnd() * TAU, speed: 0,
      stage, grow: o.grow ?? (stage === STAGE.ADULT ? 1 : ph.birthGrow),
      age: o.age ?? (stage === STAGE.ADULT ? ph.matureTime * (1 + rnd() * 1.5) : 0),
      life: ph.lifespan * rndRange(0.8, 1.2), sex: o.sex ?? (rnd() < 0.5 ? 0 : 1),
      energy: 0, health: 0, hydration: o.hydration ?? 1, state: 0, target: null, tx: x, tz: z,
      thinkT: rnd() * 0.6, lastT: this.sim.climate.time, pregnant: o.pregnant ?? -1, fatherG: o.fatherG || null, fatherSp: null,
      mateCd: o.mateCd ?? rnd() * 25, mother: o.mother || null, flying: false, alt: 0, swim: false,
      sick: 0, immune: false, alive: true, gen: o.gen || 0, kids: 0, seed: null, seedT: 0,
      stam: 1, attackedT: 0, attacker: null, huntT: 0, noHuntT: 0, homeT: 0, hx: x, hz: z, blocked: false,
      vis: 1, anim: rnd() * 10, _gk: -1, _gi: 0, _i: 0, rig: null, m: 0, maxE: 0, maxH: 0, basal: 0,
    };
    this.updateBody(c);
    c.energy = c.maxE * (o.energyFrac ?? 0.7);
    c.health = c.maxH * (o.healthFrac ?? 1);
    const ter = this.sim.terrain;
    c.gy = ter.heightAt(x, z); c.y = Math.max(c.gy, ter.waterLevel - ph.H);
    c._i = this.creatures.length; this.creatures.push(c);
    this.cgrid.insert(c);
    sp.pop++; sp.totalBorn++; if (sp.pop > sp.peak) sp.peak = sp.pop;
    if (sp.extinctAt >= 0 && !sp.deleted) sp.extinctAt = -1;
    return c;
  }

  killCreature(c, cause, noCarcass) {
    if (!c.alive) return;
    c.alive = false;
    const sp = c.sp, st = this.sim.stats;
    sp.pop--; sp.deaths[cause] = (sp.deaths[cause] || 0) + 1;
    st.counters.deaths++; st.deathsBy[cause] = (st.deathsBy[cause] || 0) + 1;
    this.cgrid.remove(c);
    const ter = this.sim.terrain;
    if (c.stage === STAGE.EGG) { ter.detritus[ter.cellAt(c.x, c.z)] += 0.01; }
    else if (!noCarcass) this.addCarcass(c, cause);
    this.deadC.push(c);
    this.sim.events.emit('creatureDied', c, cause);
    if (sp.pop === 0) this.checkExtinct(sp);
  }

  addCarcass(c, cause) {
    const meat = c.m * 36 * (0.55 + 0.45 * clamp(c.energy / c.maxE, 0, 1));
    if (meat < 0.05) return;
    const k = { x: c.x, z: c.z, y: Math.max(c.gy, this.sim.terrain.waterLevel - 0.2), meat, max: meat, age: 0, sp: c.sp, size: c.ph.size * c.grow, alive: true, kind: 'k', killer: cause === 'eaten' && c.attacker ? c.attacker.sp : null };
    this.carcasses.push(k);
    return k;
  }

  checkExtinct(sp) {
    if (sp.pop > 0 || sp.extinctAt >= 0) return;
    if (sp.kind === 'c') for (const c of this.creatures) if (c.alive && c.pregnant >= 0 && c.fatherSp === sp) return;
    sp.extinctAt = this.sim.climate.time;
    const st = this.sim.stats;
    if (sp.peak >= 4 || sp.custom) {
      st.counters.extinctions++;
      this.sim.log(`💀 Вид ${sp.name} вымер`, 'bad');
    }
    this.sim.events.emit('speciesExtinct', sp);
  }

  // ---------- растения
  spawnPlant(sp, genome, x, z, o = {}) {
    const g = genome || sp.genome;
    const ph = o.ph || (genome ? plantPheno(g) : sp.ph);
    const ter = this.sim.terrain;
    const grow = o.grow ?? 0.08;
    const p = {
      id: this.nextId++, kind: 'p', sp, g, ph, x, z, y: ter.heightAt(x, z), cell: ter.cellAt(x, z),
      age: o.age ?? grow * ph.matureTime, grow, bio: o.bio ?? ph.maxBio * grow * 0.8, health: o.health ?? 1,
      life: ph.lifespan * rndRange(0.75, 1.25), alive: true, rot: rnd() * TAU, sc: rndRange(0.85, 1.15),
      seedE: rnd() * ph.seedInterval, stress: 0, gen: o.gen || 0, _gk: -1, _gi: 0, _i: 0,
    };
    p._i = this.plants.length; this.plants.push(p);
    this.pgrid.insert(p);
    sp.pop++; sp.totalBorn++; if (sp.pop > sp.peak) sp.peak = sp.pop;
    if (sp.extinctAt >= 0 && !sp.deleted) sp.extinctAt = -1;
    return p;
  }

  killPlant(p, cause) {
    if (!p.alive) return;
    p.alive = false;
    const sp = p.sp, ter = this.sim.terrain;
    sp.pop--; sp.deaths[cause] = (sp.deaths[cause] || 0) + 1;
    this.sim.stats.counters.plantsDied++;
    this.pgrid.remove(p);
    if (cause !== 'fire') ter.detritus[p.cell] = Math.min(2, ter.detritus[p.cell] + p.ph.areaFrac * p.grow * 0.12 + 0.005);
    this.deadP.push(p);
    if (sp.pop === 0) this.checkExtinct(sp);
  }

  /** Удаление погибших из массивов (после шага симуляции). */
  flush() {
    const dc = this.deadC, dp = this.deadP;
    for (let k = 0; k < dc.length; k++) {
      const c = dc[k], arr = this.creatures, last = arr.pop();
      if (last !== c) { arr[c._i] = last; last._i = c._i; }
    }
    dc.length = 0;
    for (let k = 0; k < dp.length; k++) {
      const p = dp[k], arr = this.plants, last = arr.pop();
      if (last !== p) { arr[p._i] = last; last._i = p._i; }
    }
    dp.length = 0;
    const ks = this.carcasses;
    for (let k = ks.length - 1; k >= 0; k--) if (!ks[k].alive) { ks[k] = ks[ks.length - 1]; ks.pop(); }
  }

  nearestCreature(x, z, r) {
    let best = null, bd = r * r;
    this.cgrid.query(x, z, r, (c, d2) => { if (c.alive && d2 < bd) { bd = d2; best = c; } });
    return best;
  }
  nearestPlant(x, z, r) {
    let best = null, bd = r * r;
    this.pgrid.query(x, z, r, (p, d2) => { if (p.alive && d2 < bd) { bd = d2; best = p; } });
    return best;
  }

  // ---------- сохранение
  serialize() {
    const r2 = (v) => Math.round(v * 100) / 100;
    const species = [];
    for (const sp of this.species.values()) {
      species.push({
        id: sp.id, k: sp.kind, n: sp.name, g: packGenome(sp.genome), p: sp.parent, b: r2(sp.bornAt), x: r2(sp.extinctAt),
        pk: sp.peak, tb: sp.totalBorn, d: sp.deaths, mu: sp.mutations, ht: sp.ht.map(Math.round), hp: sp.hp, e: sp.eats,
        c: sp.custom ? 1 : 0, del: sp.deleted ? 1 : 0, note: sp.note,
      });
    }
    const creatures = this.creatures.filter((c) => c.alive).map((c) => [
      c.sp.id, packGenome(c.g), r2(c.x), r2(c.z), r2(c.age), r2(c.grow), c.stage, c.sex, r2(c.energy / c.maxE),
      r2(c.health / c.maxH), r2(c.hydration), r2(c.pregnant), c.fatherG ? packGenome(c.fatherG) : 0, c.gen, c.id,
      c.mother && c.mother.alive ? c.mother.id : 0, c.fatherSp ? c.fatherSp.id : 0,
    ]);
    const plants = this.plants.filter((p) => p.alive).map((p) => [
      p.sp.id, p.g === p.sp.genome ? 0 : packGenome(p.g), r2(p.x), r2(p.z), Math.round(p.age), r2(p.grow), r2(p.bio), r2(p.health), p.gen,
    ]);
    return { species, creatures, plants, nextId: this.nextId, nextSpId: this.nextSpId };
  }

  deserialize(d) {
    for (const s of d.species) {
      const sp = this.createSpecies(s.k, unpackGenome(s.g, s.k === 'c' ? CLEN : PLEN), { id: s.id, name: s.n, bornAt: s.b, custom: !!s.c, note: s.note });
      sp.parent = s.p; sp.extinctAt = s.x; sp.peak = s.pk; sp.totalBorn = 0; sp._tb = s.tb; sp.deaths = s.d || {};
      sp.mutations = s.mu || 0; sp.ht = s.ht || []; sp.hp = s.hp || []; sp.eats = s.e || {}; sp.deleted = !!s.del;
    }
    for (const sp of this.species.values()) {
      const par = sp.parent ? this.species.get(sp.parent) : null;
      if (par) { par.children.push(sp.id); }
    }
    const setDepth = (sp) => { const par = sp.parent ? this.species.get(sp.parent) : null; sp.depth = par ? setDepth(par) + 1 : 0; return sp.depth; };
    for (const sp of this.species.values()) setDepth(sp);
    const byId = new Map();
    for (const a of d.creatures) {
      const sp = this.species.get(a[0]); if (!sp) continue;
      const ext = sp.extinctAt;
      const c = this.spawnCreature(sp, unpackGenome(a[1], CLEN), a[2], a[3], {
        age: a[4], grow: a[5], stage: a[6], sex: a[7], energyFrac: a[8], healthFrac: a[9], hydration: a[10],
        pregnant: a[11], fatherG: a[12] ? unpackGenome(a[12], CLEN) : null, gen: a[13],
      });
      c.fatherSp = a[16] ? this.species.get(a[16]) : (c.pregnant >= 0 ? sp : null);
      c._mid = a[15]; byId.set(a[14], c); sp.extinctAt = ext < 0 ? -1 : -1;
    }
    for (const c of this.creatures) { if (c._mid) c.mother = byId.get(c._mid) || null; }
    for (const a of d.plants) {
      const sp = this.species.get(a[0]); if (!sp) continue;
      this.spawnPlant(sp, a[1] ? unpackGenome(a[1], PLEN) : null, a[2], a[3], { age: a[4], grow: a[5], bio: a[6], health: a[7], gen: a[8] });
    }
    for (const sp of this.species.values()) { sp.totalBorn = sp._tb ?? sp.totalBorn; delete sp._tb; if (sp.pop > sp.peak) sp.peak = sp.pop; }
    this.nextId = Math.max(this.nextId, d.nextId || 1);
    this.nextSpId = Math.max(this.nextSpId, d.nextSpId || 1);
  }
}
