// BehaviorSystem — органы чувств, инстинкты, принятие решений и передвижение животных.
// «Мышление» выполняется редко и со сдвигом по времени, движение — каждый шаг симуляции.
import { clamp, clamp01, rnd, rndRange, TAU, lerp } from '../core/utils.js';
import { STAGE } from './OrganismSystem.js';

export const ST = {
  IDLE: 0, WANDER: 1, SEEK_FOOD: 2, EAT: 3, FLEE: 4, HUNT: 5, SEEK_MATE: 6, SLEEP: 7, DRINK: 8,
  FOLLOW: 9, FREEZE: 10, FIGHT: 11, MIGRATE: 12, INVESTIGATE: 13, RETREAT: 14,
};
export const STATE_NAMES = ['Отдыхает', 'Бродит', 'Ищет пищу', 'Ест', 'Убегает', 'Охотится', 'Ищет партнёра', 'Спит',
  'Идёт на водопой', 'Следует за матерью', 'Затаился', 'Дерётся', 'Мигрирует', 'Исследует', 'Отступает'];
const SPEED_F = [0, 0.5, 0.55, 0, 1, 1.3, 0.6, 0, 0.75, 0.65, 0, 0.7, 0.6, 0.4, 0.6];
const DETRITUS_E = 60; // энергия в единице детрита клетки

export class BehaviorSystem {
  constructor(sim) {
    this.sim = sim;
    this._tmp = { x: 0, z: 0 };
    this.resetPercept();
    this._cb = (o, d2) => this.perceive(o, d2);
    this._plantCb = (p, d2) => this.considerPlant(p, d2);
  }

  resetPercept() {
    this.threat = null; this.threatD = 1e9; this.prey = null; this.preyScore = 0;
    this.mate = null; this.mateD = 1e9; this.stranger = null; this.strangerD = 1e9;
    this.kinN = 0; this.kinX = 0; this.kinZ = 0; this.kinNear = null; this.kinD = 1e9;
    this.foodPlant = null; this.foodScore = 0;
  }

  update(dt, fx, fz, coarse) {
    const org = this.sim.organisms, cs = org.creatures, time = this.sim.climate.time;
    const evo = this.sim.evolution;
    for (let i = 0; i < cs.length; i++) {
      const c = cs[i];
      if (!c.alive) continue;
      if (c.stage === STAGE.EGG) {
        c.age += dt;
        if (c.age >= c.ph.incubation) evo.hatch(c);
        continue;
      }
      c.thinkT -= dt;
      if (c.thinkT <= 0) {
        // упрощённая симуляция удалённых организмов: они «думают» реже
        let interval = 0.5;
        if (coarse) interval = 1.3;
        else { const dx = c.x - fx, dz = c.z - fz; if (dx * dx + dz * dz > 110 * 110) interval = 1.1; }
        const tdt = Math.min(4, time - c.lastT); c.lastT = time;
        this.think(c, tdt);
        c.thinkT = interval * (0.8 + 0.4 * rnd());
        if (!c.alive) continue;
      }
      this.move(c, dt);
    }
  }

  // ================= физиология + решение =================
  think(c, tdt) {
    const sim = this.sim, ter = sim.terrain, cl = sim.climate, org = sim.organisms, ph = c.ph;
    const cell = ter.cellAt(c.x, c.z);
    const depth = ter.waterLevel - c.gy;
    const aquatic = ph.resp === 1;
    const inWater = depth > 0.05;
    let cause = null;

    // --- температура
    const T = (aquatic || c.swim) ? cl.waterTempAtCell(cell) : cl.tempAtCell(cell);
    const dT = Math.abs(T - ph.tempOpt) - ph.tempTol;
    let cost = c.basal * (c.state === ST.SLEEP ? 0.55 : 1);
    if (dT > 0) {
      cost *= 1 + dT * 0.07;
      if (dT > 5) { c.health -= c.maxH * (dT - 5) * 0.004 * tdt; cause = T < ph.tempOpt ? 'cold' : 'heat'; }
    }
    c.tempStress = dT;
    // --- энергия
    const sp = c.speed / 4;
    cost += 0.03 * c.m * sp * sp * (c.flying ? 1.5 + ph.wingLoad * 0.5 : (c.swim && !aquatic) ? 1.5 : 1);
    c.energy -= cost * tdt;
    if (c.energy <= 0) { c.energy = 0; c.health -= c.maxH * tdt / 22; cause = 'starve'; }
    else if (c.energy > 0.45 * c.maxE && c.health < c.maxH) c.health = Math.min(c.maxH, c.health + c.maxH * tdt / 70);
    // --- вода
    if (!aquatic) {
      const near = depth > -0.35 || (cl.precip > 0.4 && T > 0) || ter.snow[cell] > 0.2;
      if (near && c.state !== ST.FLEE) c.hydration = Math.min(1, c.hydration + 0.2 * tdt);
      else {
        c.hydration -= (0.0035 + Math.max(0, T - 18) * 0.00035) * (ph.resp === 2 ? 2.2 : 1) * tdt;
        if (c.hydration <= 0) { c.hydration = 0; c.health -= c.maxH * tdt / 18; cause = 'thirst'; }
      }
      if (c.swim && ph.swim < 0.9 && ph.resp === 0) { c.health -= c.maxH * tdt / 14; cause = 'drown'; }
    } else if (depth < 0.12) { c.health -= c.maxH * tdt / 10; cause = 'stranded'; }
    // --- огонь и болезни
    const burning = ter.fire[cell] > 0 && !c.flying && !inWater;
    if (burning) { c.health -= c.maxH * tdt / 5; cause = 'disaster'; }
    if (c.sick > 0) {
      c.sick -= tdt; c.health -= c.maxH * tdt / 100; cause = cause || 'disease';
      if (c.sick <= 0) { c.sick = 0; c.immune = true; }
    }
    // --- возраст и рост
    c.age += tdt;
    if (c.stage === STAGE.JUV && c.energy > 0.2 * c.maxE) {
      const dg = (1 - ph.birthGrow) * tdt / ph.matureTime;
      const m0 = c.m; c.grow += dg; if (c.grow >= 1) { c.grow = 1; c.stage = STAGE.ADULT; }
      org.updateBody(c);
      c.energy = Math.max(0, c.energy - (c.m - m0) * 5);
      c.health = Math.min(c.maxH, c.health + (c.maxH * dg));
    }
    if (c.age > c.life) { org.killCreature(c, 'age'); return; }
    if (c.health <= 0) { org.killCreature(c, cause || (c.attackedT > 0 ? 'eaten' : 'starve')); return; }
    if (c.pregnant >= 0) { c.pregnant -= tdt; if (c.pregnant <= 0) sim.evolution.giveBirth(c); }
    if (c.seed) { c.seedT -= tdt; if (c.seedT <= 0) { sim.ecosystem.dropSeed(c); c.seed = null; } }
    if (c.mateCd > 0) c.mateCd -= tdt;
    if (c.noHuntT > 0) c.noHuntT -= tdt;
    if (c.attackedT > 0) c.attackedT -= tdt;
    if (c.homeT > 0) c.homeT -= tdt;
    const sprinting = c.state === ST.FLEE || c.state === ST.HUNT;
    c.stam = clamp01(c.stam + (sprinting ? -tdt / ((c.state === ST.HUNT ? 5 : 7) + 9 * ph.metab) : tdt / 14));

    // маскировка: насколько цвет отличается от фона
    const gc = ter.groundColor(cell), col = ph.color;
    const cd = Math.abs(col[0] - gc[0]) + Math.abs(col[1] - gc[1]) + Math.abs(col[2] - gc[2]);
    c.vis = (0.6 + 0.55 * Math.min(1, cd)) * (c.state === ST.FREEZE || c.state === ST.SLEEP ? 0.5 : 1) *
      (c.flying ? 1.3 : ter.canopy[cell] > 0.7 ? 0.75 : 1);

    // --- восприятие
    const asleep = c.state === ST.SLEEP;
    const light = cl.light;
    this.cur = c; this.curAquatic = aquatic;
    this.visR = asleep ? 0 : ph.vision * (light > 0.3 ? 1 : lerp(ph.nightVis, 1, light / 0.3)) * (cl.precip > 0.4 ? 0.8 : 1);
    this.hearR = ph.hearing * (asleep ? 0.6 : 1); this.smellR = asleep ? 0 : ph.smell;
    this.hx = Math.sin(c.heading); this.hz = Math.cos(c.heading);
    this.resetPercept();
    const R = Math.min(60, Math.max(this.visR, this.hearR * 1.6, this.smellR * 0.5, ph.sixth + 1.5));
    org.cgrid.query(c.x, c.z, R, this._cb);

    if (burning) { this.fleeFrom(c, c.x + rndRange(-1, 1), c.z + rndRange(-1, 1), 30); return; }
    const hunger = 1 - c.energy / c.maxE;
    const threat = this.threat;

    // --- 1. опасность
    if (threat || c.attackedT > 0) {
      const src = c.attackedT > 0 && c.attacker && c.attacker.alive ? c.attacker : threat;
      if (src) {
        const d = Math.hypot(src.x - c.x, src.z - c.z);
        const fd = (5 + 26 * ph.fear) * (src.m > c.m ? 1 : 0.6) + (src.target === c ? 10 : 0);
        const attacked = c.attackedT > 0;
        if (d < fd || attacked) {
          let react = ph.onDanger;
          // мать защищает потомство
          if (c.homeT > 0 && ph.care > 0.5 && src.m < c.m * 2.5) react = 2;
          if (react === 0 || (react === 1 && (d < 4 || attacked)) || (react === 3 && attacked && c.health < c.maxH * 0.5) ||
            (react === 2 && c.health < c.maxH * 0.3)) {
            this.fleeFrom(c, src.x, src.z, 26); return;
          }
          if (react === 1) { c.state = ST.FREEZE; c.target = null; return; }
          if (react === 2 && (d < 7 || attacked)) { c.state = ST.FIGHT; c.target = src; this.attack(c, src, tdt, d); return; }
        }
      }
    }
    if (c.state === ST.FIGHT) {
      const t = c.target;
      if (t && t.alive) {
        const d = Math.hypot(t.x - c.x, t.z - c.z);
        if (d < 12 && c.health > c.maxH * 0.3) { this.attack(c, t, tdt, d); return; }
      }
      c.state = ST.IDLE; c.target = null;
    }

    // --- 1б. не умеющие плавать выбираются из воды на сушу
    if (c.swim && ph.resp === 0 && ph.swim < 1.6 && !c.flying) {
      const dir = ter.dirToWater(c.x, c.z, this._tmp, false);
      if (dir) { c.state = ST.RETREAT; c.target = null; c.tx = c.x + dir.x * 8; c.tz = c.z + dir.z * 8; return; }
    }
    // --- 2. жажда
    if (!aquatic && c.hydration < 0.45 && ter.hasWater && hunger < 0.9 && depth < -0.35) {
      c.state = ST.DRINK; c.target = null;
      const dir = ter.dirToWater(c.x, c.z, this._tmp, true);
      if (dir) { c.tx = c.x + dir.x * 10; c.tz = c.z + dir.z * 10; } else { c.tx = c.x; c.tz = c.z; }
      return;
    }

    // --- 3. детёныш держится матери и кормится у неё
    const mom = c.mother;
    if (c.stage === STAGE.JUV && mom && mom.alive && ph.care > 0.25) {
      const d = Math.hypot(mom.x - c.x, mom.z - c.z);
      if (d < 7 && hunger > 0.25 && mom.energy > 0.35 * mom.maxE) {
        const give = Math.min(mom.energy * 0.08, c.maxE - c.energy, c.maxE * 0.25 * tdt * ph.care);
        mom.energy -= give; c.energy += give * 0.9; mom.homeT = Math.max(mom.homeT, 20);
      }
      if (d > 5 + ph.size * 2 && (hunger < 0.6 || ph.care > 0.6)) { c.state = ST.FOLLOW; c.target = mom; return; }
    } else if (mom && c.stage === STAGE.ADULT) c.mother = null;

    // --- 4. пища
    const fthr = ph.onFood === 2 ? 0.5 : 0.28;
    const eating = c.state === ST.EAT || c.state === ST.HUNT || c.state === ST.SEEK_FOOD;
    if (hunger > fthr || (eating && hunger > 0.06)) {
      if (!(ph.onFood === 1 && threat && this.threatD < this.visR)) {
        if (this.feed(c, tdt, hunger, cell, depth)) return;
      }
    } else if (eating) { c.state = ST.IDLE; c.target = null; }

    // --- 5. размножение
    if (c.stage === STAGE.ADULT && c.pregnant < 0 && c.mateCd <= 0 && ph.onMate !== 2 && this.mate &&
      c.energy > (ph.onMate === 1 ? 0.7 : 0.5) * c.maxE) {
      const m = this.mate;
      c.state = ST.SEEK_MATE; c.target = m;
      if (this.mateD < (ph.size + m.ph.size) * 0.8 + 1.2) sim.evolution.mate(c, m);
      return;
    }

    // --- 6. миграция от жары и холода
    if (dT > -ph.tempTol * 0.15 && rnd() < 0.5) {
      if (this.migrate(c, T)) return;
    }

    // --- 7. сон
    const wantSleep = ph.activity === 0 ? light < 0.22 : ph.activity === 1 ? light > 0.62 : false;
    if (wantSleep && hunger < 0.75 && !c.flying) { c.state = ST.SLEEP; c.target = null; return; }
    if (c.state === ST.SLEEP) c.state = ST.IDLE;

    // --- 8. чужаки
    const s = this.stranger;
    if (s && this.strangerD < 16) {
      if (ph.onStranger === 1 && this.strangerD > 5 && rnd() < 0.3 + ph.curiosity * 0.5) { c.state = ST.INVESTIGATE; c.target = s; return; }
      if (ph.onStranger === 2 && this.strangerD < 10) { this.fleeFrom(c, s.x, s.z, 12); c.state = ST.RETREAT; return; }
      if (ph.onStranger === 3 && this.strangerD < 12 && s.m < c.m * 1.3 && rnd() < 0.3 + ph.aggression * 0.6) {
        c.state = ST.FIGHT; c.target = s; return;
      }
    }

    // --- 9. сородичи
    if (this.kinN > 0) {
      if (ph.onKin === 0) {
        const kx = this.kinX / this.kinN, kz = this.kinZ / this.kinN;
        const d = Math.hypot(kx - c.x, kz - c.z);
        if (d > 5 + 16 * (1 - ph.sociality)) {
          c.state = ST.WANDER; c.target = null; c.tx = kx + rndRange(-4, 4); c.tz = kz + rndRange(-4, 4); return;
        }
      } else if (ph.onKin === 2 && this.kinD < 7) { this.fleeFrom(c, this.kinNear.x, this.kinNear.z, 10); c.state = ST.RETREAT; return; }
    }

    // --- 10. исследование территории
    if (c.state !== ST.WANDER || c.blocked || rnd() < 0.06 || Math.hypot(c.tx - c.x, c.tz - c.z) < 2) {
      this.pickWander(c);
    }
  }

  // ---------- восприятие: вызывается для каждого существа поблизости
  perceive(o, d2) {
    const c = this.cur;
    if (o === c || !o.alive) return;
    const d = Math.sqrt(d2), ph = c.ph;
    let seen = d < ph.sixth + 1.5 || d < this.hearR * (0.4 + Math.min(1.2, o.speed * 0.25)) || d < this.smellR * 0.5;
    if (!seen && d < this.visR * o.vis) {
      seen = ((o.x - c.x) * this.hx + (o.z - c.z) * this.hz) / (d + 0.001) > ph.fovCos;
    }
    if (!seen) return;
    const org = this.sim.organisms;
    if (o.sp === c.sp || org.compatible(o.sp, c.sp)) {
      if (o.stage === STAGE.EGG) return;
      this.kinN++; this.kinX += o.x; this.kinZ += o.z;
      if (d < this.kinD) { this.kinD = d; this.kinNear = o; }
      if (c.sick > 0 && o.sick <= 0 && !o.immune && d < 5 && rnd() < 0.12) o.sick = rndRange(45, 75);
      if (c.stage === STAGE.ADULT && o.stage === STAGE.ADULT && o.sex !== c.sex && o.pregnant < 0 && o.mateCd <= 0 &&
        o.energy > 0.4 * o.maxE && d < this.mateD) { this.mate = o; this.mateD = d; }
      return;
    }
    const meat = ph.diet.meat;
    if (o.stage === STAGE.EGG) {
      if (meat >= 0.35 && !this.curAquatic) { const sc = o.ph.mass * 0.6 / (d + 3); if (sc > this.preyScore) { this.preyScore = sc; this.prey = o; } }
      return;
    }
    const om = o.ph.diet.meat;
    if (om >= 0.35 && o.m >= c.m * 0.3 && !(meat >= 0.6 && c.m > o.m * 1.2) && !(c.flying && !o.flying && !o.ph.canFly)) {
      if (d < this.threatD) { this.threatD = d; this.threat = o; }
      return;
    }
    if (meat >= 0.35 && c.noHuntT <= 0 && o.m <= c.m * (0.6 + 1.6 * ph.aggression) && o.m >= c.m * 0.012) {
      // доступность добычи: вода, суша, воздух
      const oWater = o.swim || o.ph.resp === 1;
      const ok = o.flying ? (ph.canFly && ph.fly > o.ph.fly) : oWater ? (this.curAquatic || ph.swim > 1.4) : !this.curAquatic;
      if (ok) {
        const os = (o.flying ? o.ph.fly : oWater ? o.ph.swim : o.ph.land) * (0.55 + 0.45 * o.grow);
        const cs = (o.flying ? ph.fly : oWater ? ph.swim : ph.land) * 1.3;
        const sc = o.m * (o.sick > 0 ? 1.4 : 1) * (os < cs * 0.8 ? 1.6 : os < cs ? 1 : 0.2) * (o === c.avoid ? 0.05 : 1) *
          (o.state === ST.SLEEP ? 2 : 1) / (d + 3);
        if (sc > this.preyScore) { this.preyScore = sc; this.prey = o; }
      }
      return;
    }
    if (d < this.strangerD) { this.strangerD = d; this.stranger = o; }
  }

  // ---------- питание
  considerPlant(p, d2) {
    if (!p.alive) return;
    const c = this.cur, ph = c.ph, pp = p.ph;
    const water = pp.type === 3;
    if (water ? !(this.curAquatic || ph.swim > 1 || ph.resp === 2) : this.curAquatic) return;
    let avail = p.bio;
    if (ph.reach * c.grow < pp.foliageBase * p.grow) avail *= pp.fruit * 0.45;
    if (avail < 0.15) return;
    const sc = Math.min(avail, c.maxE) * pp.energyDensity / (Math.sqrt(d2) + 2);
    if (sc > this.foodScore) { this.foodScore = sc; this.foodPlant = p; }
  }

  feed(c, tdt, hunger, cell, depth) {
    const sim = this.sim, org = sim.organisms, ter = sim.terrain, ph = c.ph, diet = ph.diet;
    let t = c.target;
    // продолжаем начатое
    if (t && t.alive && (c.state === ST.EAT || c.state === ST.SEEK_FOOD || c.state === ST.HUNT)) {
      const d = Math.hypot(t.x - c.x, t.z - c.z);
      const reach = (ph.size * c.grow) * 0.8 + 1.0 + (t.kind === 'p' ? t.ph.crownR * t.grow * 0.5 : t.kind === 'c' ? t.ph.size * t.grow * 0.5 : 0.5);
      if (t.kind === 'c') {
        if (t.stage === STAGE.EGG) {
          if (d < reach) { c.energy = Math.min(c.maxE, c.energy + t.ph.mass * 3 * diet.meat); sim.stats.recordEat(c.sp, t.sp.id, 1); org.killCreature(t, 'eaten', true); c.target = null; c.state = ST.IDLE; return true; }
          c.state = ST.SEEK_FOOD; return true;
        }
        c.huntT += tdt;
        if (c.huntT > 12 || d > 45 || (c.stam <= 0.02 && d > 6)) { c.noHuntT = 6; c.huntT = 0; c.avoid = t; c.target = null; c.state = ST.IDLE; }
        else { c.state = ST.HUNT; if (d < reach + 0.3) this.attack(c, t, tdt, d); return true; }
      } else if (d < reach) {
        c.state = ST.EAT;
        if (t.kind === 'p') this.eatPlant(c, t, tdt); else this.eatCarcass(c, t, tdt);
        return true;
      } else if (d < 50) { c.state = ST.SEEK_FOOD; return true; }
    }
    c.target = null; c.huntT = 0;
    // поиск новой пищи
    let best = null, bs = 0, kind = 0;
    if (diet.plant > 0.2) {
      this.foodPlant = null; this.foodScore = 0;
      org.pgrid.query(c.x, c.z, clamp(Math.max(this.visR * 0.6, this.smellR, ph.sixth, 6), 6, 30), this._plantCb);
      if (this.foodPlant) { best = this.foodPlant; bs = this.foodScore * diet.plant; kind = 1; }
    }
    if (diet.carrion > 0.2) {
      const ks = org.carcasses, r = Math.max(this.smellR * 1.6, this.visR * 0.7, 6);
      for (let i = 0; i < ks.length; i++) {
        const k = ks[i]; if (!k.alive) continue;
        const d = Math.hypot(k.x - c.x, k.z - c.z); if (d > r) continue;
        const kw = ter.isWater(k.x, k.z);
        if (kw ? !(this.curAquatic || ph.swim > 1) : this.curAquatic) continue;
        const sc = Math.min(k.meat, c.maxE) * Math.max(diet.carrion, k.age < 25 ? diet.meat : 0) / (d + 2);
        if (sc > bs) { bs = sc; best = k; kind = 2; }
      }
    }
    if (this.prey && diet.meat >= 0.35 && hunger > 0.3) {
      const sc = this.preyScore * 9 * diet.meat * (0.5 + ph.aggression);
      if (sc > bs) { bs = sc; best = this.prey; kind = 3; }
    }
    if (diet.detritus >= 0.3) {
      const det = ter.detritus[cell], wet = depth > 0;
      const okHere = this.curAquatic ? wet : true;
      const sc = okHere ? det * DETRITUS_E * diet.detritus * 0.5 : 0;
      if (sc > bs && det > 0.02) {
        const amt = Math.min(ph.eatRate * c.grow * tdt * 0.7, det * DETRITUS_E, (c.maxE - c.energy) / diet.detritus);
        ter.detritus[cell] -= amt / DETRITUS_E; c.energy += amt * diet.detritus;
        sim.stats.recordEat(c.sp, 'det', amt);
        c.state = ST.EAT; c.target = null; c.tx = c.x; c.tz = c.z;
        if (det < 0.06) this.seekDetritus(c);
        return true;
      }
      if (!best && diet.detritus >= 0.5) { this.seekDetritus(c); c.state = ST.SEEK_FOOD; return true; }
    }
    if (!best) return false;
    c.target = best;
    c.state = kind === 3 ? ST.HUNT : ST.SEEK_FOOD;
    return true;
  }

  seekDetritus(c) {
    const ter = this.sim.terrain, N = ter.N, cs = ter.cs;
    const cx = clamp((c.x / cs) | 0, 0, N - 1), cz = clamp((c.z / cs) | 0, 0, N - 1);
    let bv = 0.02, bx = -1, bz = -1;
    for (let k = 0; k < 10; k++) {
      const nx = cx + ((rnd() * 7) | 0) - 3, nz = cz + ((rnd() * 7) | 0) - 3;
      if (nx < 0 || nz < 0 || nx >= N || nz >= N) continue;
      const j = nz * N + nx;
      if (this.curAquatic !== ter.isWaterCell(j) && (this.curAquatic || c.ph.swim < 1)) continue;
      if (ter.detritus[j] > bv) { bv = ter.detritus[j]; bx = nx; bz = nz; }
    }
    if (bx >= 0) { c.tx = (bx + 0.5) * cs; c.tz = (bz + 0.5) * cs; } else this.pickWander(c);
  }

  eatPlant(c, p, tdt) {
    const sim = this.sim, ph = c.ph, pp = p.ph, ter = sim.terrain;
    let avail = p.bio;
    const high = ph.reach * c.grow < pp.foliageBase * p.grow;
    if (high) avail *= pp.fruit * 0.45;
    const eff = ph.diet.plant * pp.energyDensity * 0.7;
    const amt = Math.min(ph.eatRate * Math.pow(c.grow, 1.8) * tdt, avail, (c.maxE - c.energy) / eff + 0.01);
    if (amt <= 0.001 || avail < 0.1) { c.target = null; c.state = ST.IDLE; return; }
    p.bio -= amt; c.energy = Math.min(c.maxE, c.energy + amt * eff);
    // шипы и яды ранят едока
    if (pp.defense > 0.5) c.health -= amt * (pp.defense - 0.5) * 0.5;
    if (p.bio < pp.maxBio * p.grow * 0.12 && !high) {
      p.health -= 0.22 * tdt * (pp.type === 0 ? 0.15 : 1);
      if (p.health <= 0) { sim.organisms.killPlant(p, 'eaten'); c.target = null; }
    }
    ter.detritus[p.cell] += amt * 0.25 / DETRITUS_E;
    if (pp.fruit > 0 && !c.seed && rnd() < 0.15 * pp.fruit) { c.seed = p; c.seedT = rndRange(15, 55); }
    sim.stats.recordEat(c.sp, p.sp.id, amt);
    if (c.energy >= c.maxE * 0.97) { c.state = ST.IDLE; c.target = null; }
  }

  eatCarcass(c, k, tdt) {
    const sim = this.sim, ph = c.ph;
    const eff = Math.max(ph.diet.carrion, k.age < 25 ? ph.diet.meat : 0);
    const amt = Math.min(ph.eatRate * Math.pow(c.grow, 1.8) * tdt * 1.5, k.meat, (c.maxE - c.energy) / eff + 0.01);
    k.meat -= amt; c.energy = Math.min(c.maxE, c.energy + amt * eff);
    sim.stats.recordEat(c.sp, (k.killer === c.sp ? '' : 'c') + k.sp.id, amt);
    if (k.meat <= 0.05) { k.alive = false; c.target = null; c.state = ST.IDLE; }
    if (c.energy >= c.maxE * 0.97) { c.state = ST.IDLE; c.target = null; }
  }

  attack(c, o, tdt, d) {
    const reach = (c.ph.size * c.grow + o.ph.size * o.grow) * 0.7 + 1.3;
    if (d > reach) return;
    const dmg = c.ph.attack * Math.pow(c.grow, 1.5) * (0.6 + 0.8 * rnd()) * tdt * (1 - o.ph.armor);
    o.health -= dmg; o.attackedT = 4; o.attacker = c;
    c.health -= o.ph.counter * Math.pow(o.grow, 1.5) * tdt * 0.5 * (1 - c.ph.armor);
    c.striking = 0.3;
    if (o.health <= 0) {
      const hunting = c.state === ST.HUNT;
      this.sim.organisms.killCreature(o, hunting ? 'eaten' : 'fight');
      const ks = this.sim.organisms.carcasses, k = ks[ks.length - 1];
      if (k && c.ph.diet.meat + c.ph.diet.carrion > 0.3 && k.x === o.x) { k.killer = c.sp; c.target = k; c.state = ST.EAT; }
      else { c.target = null; c.state = ST.IDLE; }
      c.huntT = 0;
      this.sim.events.emit('kill', c, o);
    }
  }

  // ---------- вспомогательные действия
  fleeFrom(c, x, z, dist) {
    let dx = c.x - x, dz = c.z - z;
    const l = Math.hypot(dx, dz) || 1;
    dx /= l; dz /= l;
    const a = rndRange(-0.5, 0.5), ca = Math.cos(a), sa = Math.sin(a);
    const fx = dx * ca - dz * sa, fz = dx * sa + dz * ca;
    const ter = this.sim.terrain;
    c.tx = clamp(c.x + fx * dist, 3, ter.size - 3); c.tz = clamp(c.z + fz * dist, 3, ter.size - 3);
    c.state = ST.FLEE; c.target = null;
  }

  habitable(c, x, z) {
    const ter = this.sim.terrain, ph = c.ph;
    if (!ter.inBounds(x, z, 3)) return false;
    const depth = ter.waterLevel - ter.heightAt(x, z);
    if (ph.resp === 1) return depth > ph.H * c.grow * 0.5 + 0.3;
    if (ph.canFly) return depth < 0.2 || ph.swim > 1;
    if (depth > 0.2) return ph.resp === 2 || (ph.swim > 1.6 && depth < 4);
    if (ph.resp === 2) return ter.waterDist[ter.cellAt(x, z)] < 7;
    return true;
  }

  pickWander(c) {
    const ph = c.ph, ter = this.sim.terrain;
    const R = 10 + 42 * ph.curiosity;
    const home = c.homeT > 0;
    c.blocked = false; c.target = null; c.state = ST.WANDER;
    for (let k = 0; k < 7; k++) {
      const a = k < 3 ? c.heading + rndRange(-1.2, 1.2) : rnd() * TAU, r = rndRange(0.35, 1) * (home ? 7 : R);
      const x = (home ? c.hx : c.x) + Math.sin(a) * r, z = (home ? c.hz : c.z) + Math.cos(a) * r;
      if (this.habitable(c, x, z)) { c.tx = x; c.tz = z; return; }
    }
    // подходящего места нет — к воде (водные) или к суше
    const dir = ter.dirToWater(c.x, c.z, this._tmp, ph.resp !== 0);
    if (dir) { c.tx = c.x + dir.x * 8; c.tz = c.z + dir.z * 8; } else { c.tx = c.x; c.tz = c.z; c.state = ST.IDLE; }
  }

  migrate(c, T) {
    const ter = this.sim.terrain, cl = this.sim.climate, ph = c.ph;
    let best = Math.abs(T - ph.tempOpt) - 1.5, bx = 0, bz = 0, found = false;
    const a0 = rnd() * TAU;
    for (let k = 0; k < 8; k++) {
      const a = a0 + k * TAU / 8, x = c.x + Math.sin(a) * 22, z = c.z + Math.cos(a) * 22;
      if (!this.habitable(c, x, z)) continue;
      const i = ter.cellAt(x, z);
      const t = ph.resp === 1 ? cl.waterTempAtCell(i) : cl.tempAtCell(i);
      const d = Math.abs(t - ph.tempOpt);
      if (d < best) { best = d; bx = x; bz = z; found = true; }
    }
    if (!found) return false;
    c.state = ST.MIGRATE; c.target = null; c.tx = bx; c.tz = bz;
    return true;
  }

  // ================= движение =================
  move(c, dt) {
    const ter = this.sim.terrain, ph = c.ph, st = c.state;
    let f = SPEED_F[st];
    const t = c.target;
    let tx = c.tx, tz = c.tz;
    if (t) { if (t.alive) { tx = t.x; tz = t.z; } else c.target = null; }
    let dx = tx - c.x, dz = tz - c.z;
    const dist = Math.hypot(dx, dz);
    const arrive = t ? (ph.size * c.grow * 0.6 + 0.7 + (t.kind === 'p' ? t.ph.crownR * t.grow * 0.35 : 0)) : 1.2;
    if (dist < arrive) {
      // хищник не останавливается возле добычи, а сразу атакует
      if (st === ST.HUNT || st === ST.FIGHT) { if (c.thinkT > 0.15) c.thinkT = 0.15; if (dist < arrive * 0.5) f = 0; } else f = 0;
    }
    if ((st === ST.FLEE || st === ST.HUNT) && c.stam <= 0.02) f = 0.6;
    // взлёт и посадка
    if (ph.canFly) {
      const depthHere = ter.waterLevel - c.gy;
      if (!c.flying) {
        if (f > 0 && (st === ST.FLEE || st === ST.HUNT || dist > 14 || depthHere > 0.3) && c.energy > c.maxE * 0.08) c.flying = true;
      } else c.landing = (f === 0 || dist < 5 || c.energy < c.maxE * 0.05) && (depthHere < 0.2 || ph.swim > 1);
    }
    let base = c.flying ? ph.fly : c.swim ? ph.swim : ph.land;
    if (!c.flying && !c.swim) {
      const sl = ter.world.slope[ter.cellAt(c.x, c.z)];
      base *= clamp(1 - sl * (0.55 - 0.35 * Math.min(1, ph.slopeGrip)), 0.25, 1);
    }
    let v = base * f * (0.55 + 0.45 * c.grow) * (c.sick > 0 ? 0.7 : 1);
    if (v > 0.01) {
      const want = Math.atan2(dx, dz);
      let da = want - c.heading;
      while (da > Math.PI) da -= TAU; while (da < -Math.PI) da += TAU;
      const tr = (5.5 / (0.7 + ph.size * 0.5)) * dt;
      c.heading += clamp(da, -tr, tr);
      if (Math.abs(da) > 1.6) v *= 0.4;
      const step = Math.min(v * dt, dist);
      let nx = c.x + Math.sin(c.heading) * step, nz = c.z + Math.cos(c.heading) * step;
      const m = 2.5, S = ter.size - 2.5;
      if (nx < m || nx > S || nz < m || nz > S) { nx = clamp(nx, m, S); nz = clamp(nz, m, S); c.blocked = true; }
      const gy = ter.heightAt(nx, nz), depth = ter.waterLevel - gy;
      let ok = true;
      if (ph.resp === 1) { if (depth < ph.H * c.grow * 0.4 + 0.15 && depth < ter.waterLevel - c.gy) ok = false; }
      else if (!c.flying && ph.resp === 0 && ph.swim < 0.9 &&
        depth > ph.standH * c.grow * 0.5 && depth > ter.waterLevel - c.gy) ok = false;
      if (ok) { c.x = nx; c.z = nz; c.gy = gy; this.sim.organisms.cgrid.update(c); }
      else { c.blocked = true; c.heading += rndRange(1.2, 2.6) * (rnd() < 0.5 ? -1 : 1); v = 0; c.thinkT = Math.min(c.thinkT, 0.1); }
    }
    c.speed = v;
    // высота: земля, вода или воздух
    const depth = ter.waterLevel - c.gy, hh = ph.standH * c.grow;
    if (c.flying) {
      const targetAlt = c.landing ? 0 : 4.5 + ph.size * 2;
      c.alt += clamp(targetAlt - c.alt, -5 * dt, 4 * dt);
      if (c.alt <= 0.05 && c.landing) { c.flying = false; c.landing = false; c.alt = 0; }
      c.swim = false;
      c.y = Math.max(c.gy, ter.waterLevel) + c.alt;
    } else {
      c.alt = 0; c.landing = false;
      if (ph.resp === 1) { c.swim = true; c.y = Math.max(c.gy + ph.H * c.grow * 0.5, ter.waterLevel - Math.min(depth * 0.55, ph.H * c.grow + 0.8)); if (depth <= 0) c.y = c.gy; }
      else if (depth > hh * 0.6) { c.swim = true; c.y = ter.waterLevel - hh * 0.75; }
      else { c.swim = false; c.y = c.gy; }
    }
  }
}
