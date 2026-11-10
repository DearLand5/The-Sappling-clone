// Simulation — объединяет все системы мира. Не зависит от графики и DOM,
// поэтому может работать «вхолостую» (перемотка времени, тесты).
import { Emitter, rnd, rndRange } from './core/utils.js';
import { generateWorld } from './world/WorldGenerator.js';
import { TerrainSystem } from './world/TerrainSystem.js';
import { ClimateSystem } from './world/ClimateSystem.js';
import { OrganismSystem, STAGE } from './life/OrganismSystem.js';
import { BehaviorSystem } from './life/BehaviorSystem.js';
import { EcosystemSystem } from './life/EcosystemSystem.js';
import { EvolutionSystem } from './life/EvolutionSystem.js';
import { StatisticsSystem } from './systems/StatisticsSystem.js';
import { CG, PG, makeGenome } from './life/GeneticsSystem.js';
import { STARTER_PLANTS, STARTER_ANIMALS } from './data/presets.js';

export class Simulation {
  constructor(params, settings = {}) {
    this.events = new Emitter();
    this.settings = Object.assign({ maxCreatures: 420, maxPlants: 3200 }, settings);
    this.world = generateWorld(params);
    this.terrain = new TerrainSystem(this.world);
    this.stats = new StatisticsSystem(this);
    this.climate = new ClimateSystem(this);
    this.organisms = new OrganismSystem(this);
    this.behavior = new BehaviorSystem(this);
    this.ecosystem = new EcosystemSystem(this);
    this.evolution = new EvolutionSystem(this);
    this.scenario = null;
    // журнал изменений рельефа — чтобы кратеры сохранялись вместе с миром
    this.deformLog = [];
    const deform = this.terrain.deform.bind(this.terrain);
    this.terrain.deform = (x, z, r, d) => { this.deformLog.push([Math.round(x), Math.round(z), r, d]); deform(x, z, r, d); };
  }

  log(text, type) { this.stats.log(text, type); this.events.emit('log', text, type); }

  /** Один шаг симуляции. fx,fz — точка внимания (камера), coarse — упрощённый режим. */
  step(dt, fx = 0, fz = 0, coarse = false) {
    this.climate.update(dt);
    this.ecosystem.update(dt);
    this.behavior.update(dt, fx, fz, coarse);
    this.organisms.flush();
    this.stats.update(dt);
  }

  // ---------- заселение
  /** Размещает n особей вида вокруг точки. Возвращает число размещённых. */
  place(sp, x, z, n = 1, spread = 6) {
    const ter = this.terrain, org = this.organisms;
    let placed = 0;
    for (let k = 0; k < n * 6 && placed < n; k++) {
      const px = x + (n > 1 ? rndRange(-spread, spread) : 0), pz = z + (n > 1 ? rndRange(-spread, spread) : 0);
      if (!ter.inBounds(px, pz, 2)) continue;
      const depth = ter.waterLevel - ter.heightAt(px, pz);
      if (sp.kind === 'c') {
        if (org.creatures.length >= this.settings.maxCreatures + 40) break;
        const ph = sp.ph;
        if (ph.resp === 1 ? depth < ph.H * 0.5 + 0.3 : (depth > 0.3 && ph.resp === 0 && !ph.canFly && ph.swim < 1.6)) continue;
        org.spawnCreature(sp, null, px, pz, { energyFrac: 0.8 });
      } else {
        if (sp.ph.type === 3 ? (depth < 0.15 || depth > 0.5 + sp.ph.maxH) : depth > 0) continue;
        org.spawnPlant(sp, null, px, pz, { grow: rndRange(0.5, 1) });
      }
      placed++;
    }
    return placed;
  }

  findSpot(test, tries = 400) {
    const ter = this.terrain;
    for (let k = 0; k < tries; k++) {
      const x = rndRange(0.06, 0.94) * ter.size, z = rndRange(0.06, 0.94) * ter.size;
      if (test(x, z, ter.cellAt(x, z))) return { x, z };
    }
    return null;
  }

  /** Насколько клетка подходит растению (0..1). */
  plantSuit(ph, i, x, z) {
    const ter = this.terrain, w = this.world;
    const depth = ter.waterLevel - ter.heightAt(x, z);
    if (ph.type === 3) return depth > 0.2 && depth < 0.4 + ph.maxH ? 1 : 0;
    if (depth > 0) return 0;
    const T = w.baseTemp[i] + this.climate.globalTemp;
    const tf = Math.max(0, 1 - Math.abs(T - ph.tempOpt) / (ph.tempTol * 0.8));
    const wf = Math.min(1, (ter.soilWater[i] + ph.rootDepth * 0.3) / ph.waterNeed);
    const dry = ter.soilWater[i] > 0.85 && ph.waterNeed < 0.45 ? 0.3 : 1;
    return tf * (wf > 0.7 ? 1 : wf * 0.5) * dry;
  }

  /** Стартовая растительность по биомам. */
  seedVegetation(amount, list = STARTER_PLANTS) {
    const org = this.organisms, ter = this.terrain;
    const species = list.map((d) => org.createSpecies('p', makeGenome(PG, d.genes), { name: d.name, note: d.note }));
    const target = Math.floor(this.settings.maxPlants * 0.2 + this.settings.maxPlants * 0.5 * amount);
    for (let k = 0; k < target * 5 && org.plants.length < target; k++) {
      const x = rndRange(0.03, 0.97) * ter.size, z = rndRange(0.03, 0.97) * ter.size, i = ter.cellAt(x, z);
      // выбираем подходящий вид с учётом пригодности
      let best = null, bs = 0.25;
      for (let t = 0; t < 4; t++) {
        const sp = species[(rnd() * species.length) | 0];
        const s = this.plantSuit(sp.ph, i, x, z) * (0.6 + 0.4 * rnd()) * (sp.ph.type === 2 ? 1.25 : sp.ph.type === 0 ? 0.8 : 1);
        if (s > bs) { bs = s; best = sp; }
      }
      if (!best || org.pgrid.countAt(x, z) >= 9) continue;
      org.spawnPlant(best, null, x, z, { grow: rndRange(0.3, 1), age: rndRange(0, best.ph.lifespan * 0.5) });
    }
    return species;
  }

  /** Стартовые животные. */
  seedAnimals(list = STARTER_ANIMALS, scale = 1) {
    const org = this.organisms, ter = this.terrain, res = [];
    for (const d of list) {
      const sp = org.createSpecies('c', makeGenome(CG, d.genes), { name: d.name, note: d.note });
      res.push(sp);
      const ph = sp.ph, groups = Math.max(1, Math.round((d.groups || 3) * scale));
      for (let gi = 0; gi < groups; gi++) {
        const spot = this.findSpot((x, z, i) => {
          const depth = ter.waterLevel - ter.heightAt(x, z);
          if (ph.resp === 1) return depth > 1.2;
          if (depth > -0.4) return false;
          const T = this.world.baseTemp[i] + this.climate.globalTemp;
          if (Math.abs(T - ph.tempOpt) > ph.tempTol * 0.8) return false;
          if (ph.resp === 2 && ter.waterDist[i] > 3) return false;
          return ph.diet.plant > 0.5 ? ter.canopy[i] + org.pgrid.countAt(x, z) > 0 : true;
        });
        if (spot) this.place(sp, spot.x, spot.z, d.count || 5, 9);
      }
    }
    return res;
  }

  /** Быстрый предварительный прогон растений, чтобы карта полога была готова. */
  warmup() {
    for (let k = 0; k < 2; k++) {
      this.ecosystem.cursor = 0; this.ecosystem.acc = this.organisms.plants.length + 1;
      this.ecosystem.update(0.0001);
    }
    this.organisms.flush();
  }

  // ---------- сохранение
  serialize() {
    const q = (arr, k = 100) => Array.from(arr, (v) => Math.round(v * k));
    return {
      v: 1, params: this.world.params, settings: this.settings,
      climate: this.climate.serialize(), evolution: this.evolution.serialize(),
      organisms: this.organisms.serialize(), stats: this.stats.serialize(),
      cells: { sw: q(this.terrain.soilWater), nu: q(this.terrain.nutrients), de: q(this.terrain.detritus), sn: q(this.terrain.snow), bu: q(this.terrain.burnt, 10) },
      deform: this.deformLog,
      scenario: this.scenario ? this.scenario.serialize() : null,
    };
  }

  static deserialize(d, settings) {
    const sim = new Simulation(d.params, Object.assign({}, d.settings, settings));
    for (const f of d.deform || []) sim.terrain.deform(f[0], f[1], f[2], f[3]);
    sim.terrain.heightDirty = false;
    sim.climate.deserialize(d.climate);
    sim.evolution.deserialize(d.evolution);
    const t = sim.terrain, c = d.cells;
    if (c) for (let i = 0; i < t.soilWater.length; i++) {
      t.soilWater[i] = c.sw[i] / 100; t.nutrients[i] = c.nu[i] / 100; t.detritus[i] = c.de[i] / 100; t.snow[i] = c.sn[i] / 100; t.burnt[i] = (c.bu[i] || 0) / 10;
    }
    sim.organisms.deserialize(d.organisms);
    sim.stats.deserialize(d.stats);
    sim.warmup();
    return sim;
  }
}
