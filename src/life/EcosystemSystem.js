// EcosystemSystem — жизнь растений (рост, конкуренция за свет, воду, питательные
// вещества и пространство, распространение семян), разложение останков, круговорот веществ.
import { clamp01, rnd, rndRange, TAU } from '../core/utils.js';
import { PG, crossover, mutate } from './GeneticsSystem.js';

const PLANT_PERIOD = 3; // каждое растение обновляется раз в столько секунд симуляции

export class EcosystemSystem {
  constructor(sim) {
    this.sim = sim;
    this.cursor = 0;
    this.acc = 0;
  }

  update(dt) {
    const org = this.sim.organisms, ter = this.sim.terrain, plants = org.plants;
    // --- растения: обновляются порциями по кругу
    this.acc += plants.length * dt / PLANT_PERIOD;
    let n = Math.floor(this.acc); this.acc -= n;
    if (n > plants.length) n = plants.length;
    while (n-- > 0) {
      if (this.cursor >= plants.length) {
        // полный проход завершён — обновляем карту полога
        this.cursor = 0;
        let t = ter.canopy; ter.canopy = ter.canopyNext; ter.canopyNext = t; t.fill(0);
        t = ter.canopyH; ter.canopyH = ter.canopyHNext; ter.canopyHNext = t; t.fill(0);
        t = ter.fungi; ter.fungi = ter.fungiNext; ter.fungiNext = t; t.fill(0);
        if (!plants.length) break;
      }
      const p = plants[this.cursor++];
      if (p.alive) this.updatePlant(p, PLANT_PERIOD);
    }
    // --- останки разлагаются
    const ks = org.carcasses;
    for (let i = 0; i < ks.length; i++) {
      const k = ks[i]; if (!k.alive) continue;
      k.age += dt;
      const rot = k.max * dt / 210;
      k.meat -= rot;
      const cell = ter.cellAt(k.x, k.z);
      ter.detritus[cell] = Math.min(2, ter.detritus[cell] + rot / 60);
      if (k.meat <= 0.03) k.alive = false;
    }
  }

  updatePlant(p, dt) {
    const sim = this.sim, ter = sim.terrain, cl = sim.climate, org = sim.organisms;
    const ph = p.ph, i = p.cell, type = ph.type;
    const water = ter.isWaterCell(i);
    const T = water ? cl.waterTempAtCell(i) : cl.tempAtCell(i);
    const myH = ph.maxH * p.grow, myA = ph.areaFrac * p.grow * p.grow;
    // вклад в полог для следующего прохода
    ter.canopyNext[i] += myA;
    if (myH > ter.canopyHNext[i]) ter.canopyHNext[i] = myH;
    if (type === 4) ter.fungiNext[i] += p.grow * 0.6;

    let cause = null;
    // --- среда обитания
    if (type === 3) {
      const depth = ter.waterLevel - p.y;
      if (depth < 0.05) { p.health -= 0.2 * dt / 3; cause = 'drought'; }
      else if (depth > 1.5 + ph.maxH * 1.5) { p.health -= 0.1 * dt / 3; cause = 'flood'; }
    } else if (water && ter.waterLevel - p.y > 0.25 + myH * 0.25) { p.health -= 0.25 * dt / 3; cause = 'flood'; }
    if (ter.fire[i] > 0 && type !== 3) { p.health -= (type === 0 ? 0.35 : 0.7) * dt / 3; p.bio *= 0.5; cause = 'fire'; }

    // --- факторы роста
    const dTemp = Math.abs(T - ph.tempOpt);
    const tf = clamp01(1.15 - dTemp / ph.tempTol);
    let wf = 1;
    if (type !== 3) {
      const wEff = ter.soilWater[i] + ph.rootDepth * 0.3;
      wf = clamp01(wEff / ph.waterNeed);
      if (ter.soilWater[i] > 0.92 && ph.waterNeed < 0.45) wf *= 0.6; // сухолюбы не любят болото
    }
    // свет: тень от более высоких соседей
    let lf = 1;
    if (type !== 4) {
      const other = ter.canopy[i] - myA;
      if (other > 0) {
        const hi = ter.canopyH[i];
        const rel = hi > myH * 1.15 ? 1 : hi > myH * 0.85 ? 0.45 : 0.12;
        lf = 1 - clamp01(other * rel) * (1 - ph.shadeTol * 0.85);
      }
      lf *= type === 3 ? 1 : cl.seasonLight;
      if (ter.snow[i] > 0.3 && myH < 1) lf *= 0.4;
    }
    // питание: грибы живут за счёт детрита, остальные — за счёт минералов почвы
    let nf;
    if (type === 4) {
      const det = ter.detritus[i];
      nf = clamp01(det / 0.12);
      const eat = Math.min(det, 0.004 * p.grow * dt * nf);
      ter.detritus[i] -= eat; ter.nutrients[i] = Math.min(1.5, ter.nutrients[i] + eat * 0.8);
    } else nf = clamp01(ter.nutrients[i] / (0.3 - 0.14 * ph.rootSpread));
    let g = Math.min(tf, wf) * lf * (0.35 + 0.65 * nf) * ph.vigor;
    const dormant = ph.deciduous && T < 5;
    if (dormant) g = 0;
    p.gf = g;

    // --- рост и возобновление листвы
    if (g > 0) {
      if (p.grow < 1) p.grow = Math.min(1, p.grow + g * dt / ph.matureTime);
      const cap = ph.maxBio * p.grow * p.grow;
      if (p.bio < cap) p.bio = Math.min(cap, p.bio + g * cap * dt / ph.regrowTime + 0.02);
      if (type !== 3 && type !== 4) {
        ter.soilWater[i] = Math.max(0, ter.soilWater[i] - ph.waterUse * p.grow * g * dt);
        ter.nutrients[i] = Math.max(0, ter.nutrients[i] - ph.nutUse * p.grow * g * dt);
      }
    }
    // --- стресс и здоровье
    if (!dormant && g < 0.12) {
      p.health -= (0.12 - g) * dt / (type === 0 ? 55 : type === 1 ? 30 : 16);
      if (!cause) cause = tf < 0.12 ? (T < ph.tempOpt ? 'cold' : 'heat') : wf < lf ? 'drought' : lf < 0.3 ? 'shade' : 'starve';
    } else if (p.health < 1) p.health = Math.min(1, p.health + dt / 60);
    if (dTemp > ph.tempTol + (dormant ? 14 : 6)) { p.health -= dt / 25; cause = T < ph.tempOpt ? 'cold' : 'heat'; }
    p.age += dt;
    if (p.age > p.life) { org.killPlant(p, 'age'); return; }
    if (p.health <= 0) { org.killPlant(p, cause || 'starve'); return; }

    // --- размножение семенами (или спорами)
    if (p.grow > 0.75 && g > 0.3) {
      p.seedE += g * dt;
      if (p.seedE >= ph.seedInterval) {
        p.seedE = 0;
        for (let k = 0; k < ph.seeds; k++) {
          const a = rnd() * TAU, r = 1 + -Math.log(1 - rnd() * 0.95) * ph.seedRange * 0.4;
          this.trySeed(p, p.x + Math.cos(a) * r, p.z + Math.sin(a) * r);
        }
      }
    }
  }

  /** Попытка прорастания семени в точке. Возвращает новое растение или null. */
  trySeed(parent, x, z, force) {
    const sim = this.sim, ter = sim.terrain, org = sim.organisms, ph = parent.ph;
    if (!ter.inBounds(x, z, 2)) return null;
    const n = org.plants.length, max = sim.settings.maxPlants;
    if (!force && (n >= max || rnd() < (n / max - 0.75) * 4)) return null;
    const j = ter.cellAt(x, z), depth = ter.waterLevel - ter.heightAt(x, z);
    if (ph.type === 3) { if (depth < 0.15 || depth > 0.5 + ph.maxH) return null; }
    else if (depth > 0) return null;
    if (!force) {
      // конкуренция за пространство и свет
      const free = 1 - ter.canopy[j] * (1 - ph.shadeTol * 0.7);
      if (rnd() > free) return null;
      if (org.pgrid.countAt(x, z) >= (ph.type === 3 ? 5 : 14)) return null;
      if (ter.burnt[j] > 0.8 || ter.fire[j] > 0) return null;
      const T = (ph.type === 3 ? sim.climate.waterTempAtCell(j) : sim.climate.tempAtCell(j));
      if (Math.abs(T - ph.tempOpt) > ph.tempTol * 1.1) return null;
      if (ph.type !== 3 && ter.soilWater[j] + ph.rootDepth * 0.3 < ph.waterNeed * 0.45) return null;
    }
    // наследование: при наличии цветов возможно перекрёстное опыление
    const evo = sim.evolution;
    let g = parent.g, sp = parent.sp;
    let mate = null;
    if (ph.flowers > 0 && rnd() < ph.flowers) {
      const cellArr = org.pgrid.cells[parent._gk >= 0 ? parent._gk : org.pgrid.key(parent.x, parent.z)];
      const cand = cellArr[(rnd() * cellArr.length) | 0];
      if (cand && cand !== parent && cand.alive && cand.sp === sp && cand.grow > 0.6) mate = cand;
    }
    if (mate || evo.enabled) {
      g = mate ? crossover(parent.g, mate.g, PG) : Float32Array.from(parent.g);
      if (evo.enabled) {
        const nm = mutate(g, PG, evo.rate, evo.strength);
        if (nm) { sim.stats.counters.mutations += nm; sp.mutations += nm; }
        else if (!mate) g = parent.g;
      }
      if (g !== parent.g) sp = evo.assignSpecies(g, parent.sp, null, 'p');
    }
    const child = org.spawnPlant(sp, g === sp.genome ? null : g, x, z, { grow: 0.06, gen: parent.gen + 1, ph: g === parent.g ? parent.ph : undefined });
    sim.stats.counters.plantsBorn++;
    return child;
  }

  /** Животное роняет съеденное семя. */
  dropSeed(c) {
    const p = c.seed;
    if (!p || c.flying && rnd() < 0.3) return;
    this.trySeed(p, c.x + rndRange(-1, 1), c.z + rndRange(-1, 1));
  }
}
