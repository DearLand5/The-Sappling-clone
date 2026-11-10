// ClimateSystem — время суток, сезоны, погода, осадки, снег, засухи, уровень воды,
// глобальные изменения климата и природные катастрофы.
import { clamp, clamp01, rnd, rndRange, rndInt, TAU } from '../core/utils.js';
import { classifyBiomes, BIOMES } from './WorldGenerator.js';

export const DAY = 30, SEASON = 90, YEAR = 360;
export const SEASONS = ['Весна', 'Лето', 'Осень', 'Зима'];
export const SEASON_ICONS = ['🌱', '☀️', '🍂', '❄️'];
export const WEATHER = {
  clear: { name: 'Ясно', icon: '☀️' }, cloudy: { name: 'Облачно', icon: '⛅' },
  rain: { name: 'Дождь', icon: '🌧️' }, storm: { name: 'Гроза', icon: '⛈️' },
  drought: { name: 'Засуха', icon: '🥵' },
};
export const DISASTERS = {
  fire: { name: 'Пожар', icon: '🔥', point: true, desc: 'Огонь распространяется по сухой растительности.' },
  meteor: { name: 'Метеорит', icon: '☄️', point: true, desc: 'Удар уничтожает всё в радиусе, оставляет кратер и охлаждает климат.' },
  eruption: { name: 'Извержение', icon: '🌋', point: true, desc: 'Локальные разрушения и вулканическая зима.' },
  flood: { name: 'Наводнение', icon: '🌊', desc: 'Уровень воды временно резко поднимается.' },
  drought: { name: 'Засуха', icon: '🏜️', desc: 'Долгий период без осадков.' },
  heatwave: { name: 'Аномальная жара', icon: '🥵', desc: 'Резкое потепление и засуха.' },
  coldsnap: { name: 'Похолодание', icon: '🥶', desc: 'Резкое длительное похолодание.' },
  plague: { name: 'Эпидемия', icon: '🦠', desc: 'Болезнь поражает самый многочисленный вид животных.' },
};

const CELL_PERIOD = 4;

export class ClimateSystem {
  constructor(sim) {
    this.sim = sim;
    this.time = 0;
    this.globalTemp = 0; this.globalHum = 0; this.seasonality = 1; this.waterOffset = 0;
    this.randomDisasters = true; this.disasterRate = 0.5;
    this.tempAnom = 0; this.trendRate = 0; this.trendLeft = 0;
    this.weather = 'clear'; this.weatherT = 5; this.precip = 0;
    this.droughtT = 0; this.floodT = 0; this.floodAmt = 0; this.wetAccum = 0;
    this.cursor = 0; this.checkT = 0; this.disT = 0;
    this.fires = [];
    this.lastClass = { t: 0, h: 0, w: 0 };
    const w = sim.world; let s = 0, n = 0;
    for (let i = 0; i < w.baseMoist.length; i++) if (w.cellH[i] > 0) { s += w.baseMoist[i]; n++; }
    this.avgMoist = n ? s / n : 0.5;
    this.computeDerived();
  }

  computeDerived() {
    const t = this.time;
    this.yearFrac = (t % YEAR) / YEAR; this.dayFrac = (t % DAY) / DAY;
    this.season = Math.floor(this.yearFrac * 4) % 4;
    this.year = Math.floor(t / YEAR); this.dayOfYear = Math.floor((t % YEAR) / DAY);
    const sun = Math.sin(TAU * (this.dayFrac - 0.25));
    this.sunElev = sun;
    this.light = clamp01(0.5 + sun * 1.6);
    this.isNight = this.light < 0.25;
    this.seasonT = 10 * this.seasonality * Math.cos(TAU * (this.yearFrac - 0.375));
    const dayT = 3 * Math.cos(TAU * (this.dayFrac - 0.6));
    const wd = this.weather === 'rain' || this.weather === 'storm' ? -2 : this.weather === 'drought' ? 3 : 0;
    this.tempDelta = this.globalTemp + this.tempAnom + this.seasonT + dayT + wd;
    this.waterTempDelta = this.globalTemp + this.tempAnom * 0.5 + this.seasonT * 0.4;
    this.seasonLight = 0.75 + 0.25 * Math.cos(TAU * (this.yearFrac - 0.375));
  }

  tempAtCell(i) { return this.sim.world.baseTemp[i] + this.tempDelta; }
  waterTempAtCell(i) { return this.sim.world.baseTemp[i] + this.waterTempDelta; }
  tempAt(x, z) { return this.tempAtCell(this.sim.terrain.cellAt(x, z)); }
  dateString() { return `Год ${this.year + 1}, ${SEASONS[this.season]}`; }

  update(dt) {
    const sim = this.sim, ter = sim.terrain;
    this.time += dt;
    this.tempAnom *= Math.exp(-dt / 320);
    if (this.trendLeft > 0) { this.globalTemp += this.trendRate * dt; this.trendLeft -= dt; }
    if (this.droughtT > 0) this.droughtT -= dt;
    // Погода
    this.weatherT -= dt;
    if (this.weatherT <= 0) {
      const seasonWet = [0.08, -0.06, 0.1, 0][this.season];
      const hum = clamp01(this.avgMoist + this.globalHum + seasonWet);
      if (this.droughtT > 0) { this.weather = 'drought'; this.precip = 0; }
      else {
        const r = rnd();
        if (r < hum * 0.55) { this.weather = rnd() < 0.22 ? 'storm' : 'rain'; this.precip = rndRange(0.5, 1); }
        else if (r < hum * 0.55 + 0.25) { this.weather = 'cloudy'; this.precip = 0; }
        else { this.weather = 'clear'; this.precip = 0; }
      }
      this.weatherT = rndRange(12, 36);
    }
    this.computeDerived();
    // Уровень воды
    this.wetAccum += this.precip * dt * 0.004 - dt * 0.0012 * (this.droughtT > 0 ? 4 : 1) * (this.wetAccum > 0 ? 1 : 0.2);
    this.wetAccum = clamp(this.wetAccum, -1.2, 1.2);
    if (this.floodT > 0) { this.floodT -= dt; if (this.floodT <= 0) this.floodAmt = 0; }
    const target = clamp((this.globalTemp + this.tempAnom * 0.3) * 0.1 + this.wetAccum + this.floodAmt + this.waterOffset, -3, 5);
    const dl = clamp(target - ter.waterLevel, -0.08 * dt, 0.08 * dt);
    ter.waterLevel += dl;
    if (Math.abs(ter.waterLevel - ter.waterDistLevel) > 0.2) { ter.computeWaterDist(); ter.colorsDirty = true; sim.events.emit('waterChanged'); }
    this.updateCells(dt);
    this.updateFires(dt);
    // Периодические проверки: смена биомов, случайные катастрофы
    this.checkT -= dt;
    if (this.checkT <= 0) {
      this.checkT = 6;
      const te = this.globalTemp + this.tempAnom * 0.5, lc = this.lastClass;
      if (Math.abs(te - lc.t) > 1.5 || Math.abs(this.globalHum - lc.h) > 0.07 || Math.abs(ter.waterLevel - lc.w) > 0.3) {
        lc.t = te; lc.h = this.globalHum; lc.w = ter.waterLevel;
        if (classifyBiomes(sim.world, te, this.globalHum, ter.waterLevel)) ter.colorsDirty = true;
      }
      if (this.randomDisasters && rnd() < this.disasterRate * 6 / (YEAR * 1.6)) this.randomDisaster();
    }
  }

  updateCells(dt) {
    const ter = this.sim.terrain, w = this.sim.world, n2 = ter.N * ter.N;
    let count = Math.ceil(n2 * dt / CELL_PERIOD);
    const dtc = CELL_PERIOD, evapK = this.droughtT > 0 ? 2.6 : 1;
    const hum = this.globalHum;
    while (count-- > 0) {
      const i = this.cursor; this.cursor = (this.cursor + 1) % n2;
      if (ter.isWaterCell(i)) {
        ter.soilWater[i] = 1; ter.snow[i] = 0;
        // планктон и органика в воде — пища фильтраторов
        const cap = 0.05 + 0.08 * ter.nutrients[i];
        if (ter.detritus[i] < cap) ter.detritus[i] += 0.000022 * dtc * this.seasonLight;
        else ter.detritus[i] -= (ter.detritus[i] - cap) * 0.02;
        if (ter.nutrients[i] < 0.5) ter.nutrients[i] += 0.002 * dtc;
        continue;
      }
      const T = w.baseTemp[i] + this.tempDelta;
      let sw = ter.soilWater[i], sn = ter.snow[i];
      const p = this.precip * (0.4 + w.baseMoist[i] + hum) * dtc * 0.012;
      if (p > 0) { if (T < 0) sn += p * 1.5; else sw += p; }
      if (T > 0 && sn > 0) { const melt = Math.min(sn, 0.006 * T * dtc); sn -= melt; sw += melt * 0.7; }
      sw -= dtc * 0.0022 * (0.3 + Math.max(0, T) / 18) * evapK;
      const ground = clamp01(w.baseMoist[i] + hum) * (this.droughtT > 0 ? 0.3 : 0.62);
      sw += (ground - sw) * 0.006 * dtc;
      if (ter.waterDist[i] <= 2) sw = Math.max(sw, 0.62 - ter.waterDist[i] * 0.08);
      ter.soilWater[i] = clamp01(sw); ter.snow[i] = clamp(sn, 0, 1);
      // разложение: детрит -> питательные вещества; грибы и тепло ускоряют
      const tf = clamp01((T + 2) / 22), det = ter.detritus[i];
      const dec = det * (0.0035 + 0.03 * Math.min(1, ter.fungi[i])) * dtc * (0.2 + tf) * (0.3 + sw);
      ter.detritus[i] = det - dec;
      let nut = ter.nutrients[i] + dec * 0.9;
      nut += (BIOMES[w.biome[i]].fert * 0.7 - nut) * 0.0012 * dtc;
      ter.nutrients[i] = clamp(nut, 0, 1.5);
      if (ter.burnt[i] > 0) { ter.burnt[i] = Math.max(0, ter.burnt[i] - 0.006 * dtc); if (ter.burnt[i] === 0) ter.colorsDirty = true; }
    }
  }

  ignite(i, dur = 8) {
    const ter = this.sim.terrain;
    if (ter.fire[i] > 0 || ter.isWaterCell(i)) return;
    ter.fire[i] = dur; this.fires.push(i); ter.colorsDirty = true;
  }

  updateFires(dt) {
    const f = this.fires; if (!f.length) return;
    const ter = this.sim.terrain, N = ter.N;
    for (let k = f.length - 1; k >= 0; k--) {
      const i = f[k];
      ter.fire[i] -= dt * (1 + this.precip * 3);
      if (rnd() < dt * 0.4) {
        const j = i + [-1, 1, -N, N][rndInt(0, 3)];
        if (j >= 0 && j < N * N && ter.fire[j] <= 0 && ter.burnt[j] < 0.4 && ter.canopy[j] > 0.03 &&
          ter.soilWater[j] < 0.55 && ter.snow[j] < 0.05 && this.precip < 0.6) this.ignite(j, rndRange(6, 10));
      }
      if (ter.fire[i] <= 0) {
        ter.fire[i] = 0; ter.burnt[i] = 1; ter.nutrients[i] = Math.min(1.5, ter.nutrients[i] + 0.15);
        f[k] = f[f.length - 1]; f.pop(); ter.colorsDirty = true;
      }
    }
  }

  randomDisaster() {
    const types = ['fire', 'fire', 'flood', 'drought', 'heatwave', 'coldsnap', 'plague', 'meteor', 'eruption'];
    const type = types[rndInt(0, types.length - 1)], ter = this.sim.terrain;
    let x = 0, z = 0;
    for (let k = 0; k < 30; k++) { x = rndRange(0.15, 0.85) * ter.size; z = rndRange(0.15, 0.85) * ter.size; if (!ter.isWater(x, z)) break; }
    this.trigger(type, x, z);
  }

  /** Запуск катастрофы. Для точечных требуется место. */
  trigger(type, x, z) {
    const sim = this.sim, ter = sim.terrain, org = sim.organisms, D = DISASTERS[type];
    if (!D) return;
    if (D.point && (x === undefined)) { x = ter.size / 2; z = ter.size / 2; }
    const killRadius = (r, plantsToo) => {
      org.cgrid.query(x, z, r, (c) => { if (c.alive) org.killCreature(c, 'disaster', true); });
      if (plantsToo) org.pgrid.query(x, z, r, (p) => { if (p.alive) org.killPlant(p, 'disaster'); });
    };
    switch (type) {
      case 'fire': {
        const c = ter.cellAt(x, z), N = ter.N;
        for (const o of [0, 1, -1, N, -N]) { const j = c + o; if (j >= 0 && j < N * N) this.ignite(j, 10); }
        break;
      }
      case 'meteor': {
        killRadius(22, true); ter.deform(x, z, 16, 5); this.tempAnom -= 5;
        const N = ter.N;
        for (let k = 0; k < 14; k++) { const a = rnd() * TAU; this.ignite(ter.cellAt(x + Math.cos(a) * 26, z + Math.sin(a) * 26), 9); }
        sim.events.emit('terrainChanged');
        break;
      }
      case 'eruption': {
        killRadius(13, true); ter.deform(x, z, 12, -7); this.tempAnom -= 7;
        for (let k = 0; k < 10; k++) { const a = rnd() * TAU; this.ignite(ter.cellAt(x + Math.cos(a) * 16, z + Math.sin(a) * 16), 9); }
        sim.events.emit('terrainChanged');
        break;
      }
      case 'flood': this.floodAmt = 2.6; this.floodT = 70; break;
      case 'drought': this.droughtT = YEAR * 0.55; this.weatherT = 0; break;
      case 'heatwave': this.tempAnom += 8; this.droughtT = Math.max(this.droughtT, 100); this.weatherT = 0; break;
      case 'coldsnap': this.tempAnom -= 10; break;
      case 'plague': {
        let best = null;
        for (const sp of org.species.values()) if (sp.kind === 'c' && sp.pop > 0 && (!best || sp.pop > best.pop)) best = sp;
        if (best) {
          for (const c of org.creatures) if (c.sp === best && c.alive && rnd() < 0.35) c.sick = rndRange(50, 80);
          sim.log(`🦠 Эпидемия поразила вид ${best.name}`, 'bad');
        }
        break;
      }
    }
    if (type !== 'plague') sim.log(`${D.icon} ${D.name}!`, 'bad');
    sim.stats.counters.disasters++;
    sim.events.emit('disaster', type, x, z);
  }

  /** Плавное изменение климата на delta градусов за duration секунд. */
  startTrend(delta, duration) { this.trendRate = delta / duration; this.trendLeft = duration; }

  serialize() {
    return {
      time: this.time, globalTemp: this.globalTemp, globalHum: this.globalHum, seasonality: this.seasonality,
      waterOffset: this.waterOffset, randomDisasters: this.randomDisasters, disasterRate: this.disasterRate,
      tempAnom: this.tempAnom, trendRate: this.trendRate, trendLeft: this.trendLeft, weather: this.weather,
      weatherT: this.weatherT, precip: this.precip, droughtT: this.droughtT, floodT: this.floodT,
      floodAmt: this.floodAmt, wetAccum: this.wetAccum, waterLevel: this.sim.terrain.waterLevel,
    };
  }
  deserialize(d) {
    for (const k of Object.keys(d)) if (k !== 'waterLevel') this[k] = d[k];
    this.sim.terrain.waterLevel = d.waterLevel || 0;
    this.sim.terrain.computeWaterDist();
    this.lastClass = { t: this.globalTemp + this.tempAnom * 0.5, h: this.globalHum, w: this.sim.terrain.waterLevel };
    classifyBiomes(this.sim.world, this.lastClass.t, this.globalHum, this.sim.terrain.waterLevel);
    this.computeDerived();
  }
}
