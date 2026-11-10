// Точка входа: объединяет симуляцию, графику, звук, сохранения и интерфейс,
// управляет игровым циклом, скоростью времени и инструментами игрока.
import { Simulation } from './Simulation.js';
import { RenderingSystem } from './render/RenderingSystem.js';
import { MobileUI } from './ui/MobileUI.js';
import { CreatureEditor } from './ui/CreatureEditor.js';
import { PlantEditor } from './ui/PlantEditor.js';
import { SaveSystem } from './systems/SaveSystem.js';
import { AudioSystem } from './systems/AudioSystem.js';
import { Scenario, findScenario } from './systems/ScenarioSystem.js';
import { STARTER_ANIMALS } from './data/presets.js';
import { YEAR } from './world/ClimateSystem.js';
import { $, el } from './ui/dom.js';

const SPEEDS = [0, 1, 3, 10, 40];
const SIM_LIMITS = { low: { maxCreatures: 200, maxPlants: 1500 }, medium: { maxCreatures: 340, maxPlants: 2700 }, high: { maxCreatures: 520, maxPlants: 4200 } };

class Game {
  constructor() {
    this.canvas = $('#c');
    this.save = new SaveSystem();
    this.settings = this.save.settings();
    this.quality = this.resolveQuality();
    this.render = new RenderingSystem(this.canvas, this.quality);
    this.audio = new AudioSystem();
    this.sim = null; this.playing = false; this.speedIdx = 1; this.tool = null; this.editor = null;
    this.menuOpen = true; this.ff = null; this.autoT = 60; this.fpsAcc = 0; this.fpsN = 0; this.slowT = 0;
    this.ui = new MobileUI(this);
    this.creatureEditor = new CreatureEditor(this);
    this.plantEditor = new PlantEditor(this);
    this.applySettings(true);
    this.startDemo();
    this.ui.showMenu('main');
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) { this.autosave(); this.audio.suspend(true); } else { this.audio.suspend(false); this.last = performance.now(); }
    });
    window.addEventListener('pagehide', () => this.autosave());
    this.last = performance.now();
    requestAnimationFrame((t) => this.loop(t));
  }

  resolveQuality() {
    const q = this.settings.quality;
    if (q !== 'auto') return q;
    const mobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && Math.min(screen.width, screen.height) < 820);
    const cores = navigator.hardwareConcurrency || 4, mem = navigator.deviceMemory || 4;
    if (mobile) return mem <= 3 || cores <= 4 ? 'low' : 'medium';
    return cores >= 8 && mem >= 8 ? 'high' : 'medium';
  }

  applySettings(init) {
    const s = this.settings;
    if (!init) this.save.saveSettings(s);
    const q = this.resolveQuality();
    if (q !== this.quality) { this.quality = q; this.render.setQuality(q); if (this.sim) { const sim = this.sim; this.render.setSim(null); this.attach(sim, true); } }
    this.audio.setSound(s.sound); this.audio.setMusic(s.music);
  }

  // ======================= миры =======================
  attach(sim, keepCam) {
    const cam = keepCam ? Object.assign({}, this.render.cam) : null;
    this.sim = sim;
    this.render.setSim(sim);
    if (cam) Object.assign(this.render.cam, cam);
    this.tool = null; this.ui.updateBanner(); this.ui.select(null);
    const a = this.audio, loud = () => this.playing && !this.ff && SPEEDS[this.speedIdx] <= 10;
    if (sim._wired) return;
    sim._wired = true;
    sim.events.on('log', (text, type) => { if (this.playing && !this.ff) this.ui.toast(text, type); });
    sim.events.on('speciesEstablished', () => { if (loud()) a.newSpecies(); });
    sim.events.on('speciesExtinct', (sp) => { if (loud() && (sp.peak >= 4 || sp.custom)) a.extinct(); });
    sim.events.on('disaster', () => { if (loud()) a.disaster(); });
    sim.events.on('birth', (c) => { if (loud() && SPEEDS[this.speedIdx] <= 3 && this.near(c, 45)) a.birth(); });
    sim.events.on('kill', (c) => { if (loud() && SPEEDS[this.speedIdx] <= 3 && this.near(c, 45)) a.growl(); });
  }
  near(o, r) { const c = this.render.cam; return (o.x - c.sx) ** 2 + (o.z - c.sz) ** 2 < r * r; }

  startDemo() {
    const sim = new Simulation({ seed: 20240, size: 64, water: 0.42, vegetation: 0.7, name: 'Демо' }, { maxCreatures: 120, maxPlants: 1000 });
    sim.climate.randomDisasters = false; sim.climate.time = 40;
    sim.seedVegetation(0.7); sim.warmup(); sim.seedAnimals(STARTER_ANIMALS, 0.5); sim.warmup();
    this.playing = false; this.attach(sim);
    Object.assign(this.render.cam, { dist: 95, pitch: 0.55 });
  }

  begin(sim, message) {
    this.playing = true;
    this.attach(sim);
    this.ui.hideMenu(); this.ui.showHud(true); this.ui.closePanel();
    this.setSpeed(1);
    this.autoT = 60;
    if (message) this.ui.toast(message, 'good');
  }

  newWorld(params, opts = {}) {
    const sim = new Simulation(params, SIM_LIMITS[this.quality]);
    if (opts.plants !== false) { sim.seedVegetation(params.vegetation ?? 0.6); sim.warmup(); }
    if (opts.animals !== false) { sim.seedAnimals(); sim.warmup(); }
    this.begin(sim, 'Мир создан. Двигайте камеру пальцем, касайтесь животных и растений.');
  }

  startScenario(id) {
    const def = findScenario(id); if (!def) return;
    const sim = new Simulation(Object.assign({ name: def.title }, def.world), SIM_LIMITS[this.quality]);
    sim.seedVegetation(def.world.vegetation); sim.warmup();
    if (def.starters === 'all') sim.seedAnimals();
    else if (def.starters.length) sim.seedAnimals(STARTER_ANIMALS.filter((d) => def.starters.includes(d.name)), 1.3);
    sim.warmup();
    sim.climate.randomDisasters = !!def.disasters;
    sim.scenario = new Scenario(def, sim);
    this.begin(sim);
    this.ui.modal(`${def.icon} ${def.title}`, [el('p', { text: def.desc }), el('p', { class: 'mut', text: '💡 ' + def.hint })], [['Начать', 'primary', null]]);
  }

  loadSlot(slot) {
    const d = this.save.loadWorld(slot);
    if (!d) { this.ui.toast('Сохранение не найдено', 'bad'); return; }
    this.loadData(d);
  }
  loadData(d) {
    let sim;
    try { sim = Simulation.deserialize(d); } catch (e) { console.error(e); this.ui.toast('Не удалось загрузить сохранение', 'bad'); return; }
    if (d.scenario) { const def = findScenario(d.scenario.id); if (def) sim.scenario = new Scenario(def, sim, d.scenario); }
    this.begin(sim, 'Мир загружен');
    if (d.extra && d.extra.cam) { const c = d.extra.cam, cam = this.render.cam; Object.assign(cam, c); cam.sx = c.tx; cam.sz = c.tz; cam.sdist = c.dist; cam.syaw = c.yaw; cam.spitch = c.pitch; }
  }
  saveSlot(slot) {
    if (!this.sim || !this.playing) return false;
    const c = this.render.cam;
    return this.save.saveWorld(slot, this.sim, { cam: { tx: c.tx, tz: c.tz, dist: c.dist, yaw: c.yaw, pitch: c.pitch } });
  }
  autosave() { if (this.playing && this.settings.autosave && !this.ff) this.saveSlot('auto'); }

  // ======================= управление =======================
  setSpeed(i) { this.speedIdx = i; this.ui.updateSpeedButtons(); }

  setTool(t) { this.tool = t; this.ui.updateBanner(); if (t) this.ui.select(null); }

  onTap(x, y) {
    if (!this.sim || !this.playing || this.editor || this.menuOpen) return;
    const sim = this.sim, r = this.render, t = this.tool;
    if (!t) { const o = r.pickOrganism(x, y); this.ui.select(o); if (o) this.audio.click(); return; }
    const g = r.pickGround(x, y);
    if (!g) return;
    if (t.type === 'place') {
      if (t.sp.deleted) { this.setTool(null); return; }
      const n = sim.place(t.sp, g.x, g.z, t.count, t.sp.kind === 'c' ? 3 + t.count * 0.5 : 2 + t.count * 0.6);
      if (n) { this.audio.place(); r.plantsDirty = true; r.emitFx(g.x, g.y + 0.5, g.z, [0.6, 1, 0.5], 10); }
      else { this.audio.error(); this.ui.toast(t.sp.kind === 'c' ? (t.sp.ph.resp === 1 ? 'Этому виду нужна вода' : 'Этот вид не может жить в воде') : (t.sp.ph.type === 3 ? 'Водному растению нужно мелководье' : 'Это растение не растёт в воде'), 'bad'); }
    } else if (t.type === 'remove') {
      const org = sim.organisms; let n = 0;
      org.cgrid.query(g.x, g.z, t.radius, (c) => { if (c.alive) { org.killCreature(c, 'removed', true); n++; } });
      org.pgrid.query(g.x, g.z, t.radius, (p) => { if (p.alive) { org.killPlant(p, 'removed'); n++; } });
      org.flush(); r.plantsDirty = true;
      if (n) { this.audio.remove(); r.emitFx(g.x, g.y + 0.5, g.z, [1, 0.5, 0.4], 10); }
    } else if (t.type === 'disaster') {
      sim.climate.trigger(t.kind, g.x, g.z); r.plantsDirty = true; this.setTool(null);
    }
  }

  openEditor(kind, opts = {}) { this.audio.click(); (kind === 'c' ? this.creatureEditor : this.plantEditor).open(opts); }
  enterEditor(ed) { this.editor = ed; this.render.mode = 'editor'; this.ui.showHud(false); }
  exitEditor() { this.editor = null; this.render.mode = 'world'; this.ui.showHud(true); if (this.ui.panel) this.ui.renderPanel(); }

  /** Перемотка: симуляция без отрисовки, порциями, чтобы интерфейс не зависал. */
  fastForward(seconds) {
    if (!this.sim || this.ff) return;
    const sim = this.sim, t0 = sim.climate.time, end = t0 + seconds, snap = sim.stats.makeSnapshot();
    const box = $('#progress'), barEl = $('#pg-bar'), txt = $('#pg-text');
    box.classList.remove('hidden');
    this.ff = { stop: false };
    $('#pg-stop').onclick = () => { this.ff.stop = true; };
    const cam = this.render.cam;
    const chunk = () => {
      const start = performance.now();
      while (performance.now() - start < 40 && sim.climate.time < end) {
        sim.step(0.35, cam.sx, cam.sz, true);
        if (sim.scenario && sim.scenario.update(0.35)) this.scenarioDone();
      }
      const p = (sim.climate.time - t0) / seconds;
      barEl.style.width = Math.round(Math.min(1, p) * 100) + '%';
      txt.textContent = `${sim.climate.dateString()} · 🐾 ${sim.organisms.creatures.length} · 🌿 ${sim.organisms.plants.length} · 🧬 ${sim.organisms.aliveSpecies().length}`;
      if (sim.climate.time < end && !this.ff.stop && sim === this.sim) setTimeout(chunk, 0);
      else {
        box.classList.add('hidden'); this.ff = null; this.render.plantsDirty = true; this.last = performance.now();
        this.ui.showReport(sim.stats.report(0, snap));
        if (this.ui.panel) this.ui.renderPanel();
      }
    };
    setTimeout(chunk, 30);
  }

  scenarioDone() {
    const sc = this.sim.scenario;
    this.save.markScenario(sc.def.id); this.audio.success();
    this.ui.modal('🏆 Сценарий пройден!', [el('p', { text: `«${sc.def.title}» — все цели выполнены. Можно продолжить наблюдать за этим миром или выбрать следующее задание.` })],
      [['Остаться в мире', 'primary', null], ['К сценариям', '', () => this.ui.showMenu('scenarios')]]);
  }

  // ======================= игровой цикл =======================
  loop(now) {
    requestAnimationFrame((t) => this.loop(t));
    const dt = Math.min(0.1, Math.max(0.001, (now - this.last) / 1000));
    this.last = now;
    const sim = this.sim, r = this.render;
    if (!sim) return;
    let speed = this.playing ? SPEEDS[this.speedIdx] : 1;
    if (this.editor || this.ff || (this.playing && this.menuOpen)) speed = 0;
    if (speed > 0) {
      // логика отделена от графики: шаг симуляции не короче кадра и не длиннее 0.25 с
      const simDt = dt * speed, steps = Math.ceil(simDt / 0.25), h = simDt / steps;
      const t0 = performance.now(), coarse = speed >= 10;
      for (let i = 0; i < steps; i++) {
        sim.step(h, r.cam.sx, r.cam.sz, coarse);
        if (performance.now() - t0 > 18) break; // слабое устройство: время просто идёт медленнее
      }
      if (sim.scenario && sim.scenario.update(simDt)) this.scenarioDone();
    }
    if (!this.playing) r.cam.yaw += dt * 0.04;
    if (!this.ff) {
      r.update(dt, speed);
      r.render();
    }
    if (this.playing) {
      this.ui.update(dt);
      this.autoT -= dt;
      if (this.autoT <= 0) { this.autoT = 60; this.autosave(); }
    }
    const cl = sim.climate;
    this.audio.update(dt, {
      night: cl.light < 0.25 && speed < 8 ? 1 : 0, rain: speed ? cl.precip : 0, storm: cl.weather === 'storm' && speed > 0 && speed < 8,
      life: Math.min(1, sim.organisms.creatures.length / 150), paused: speed === 0 || speed > 10, cold: cl.tempAt(r.cam.sx, r.cam.sz) < 2, high: Math.min(1, r.cam.sdist / 200),
    });
    // авто-качество: при стабильно низкой частоте кадров снижаем детализацию
    this.fpsAcc += dt; this.fpsN++;
    if (this.fpsAcc >= 4) {
      const fps = this.fpsN / this.fpsAcc; this.fpsAcc = 0; this.fpsN = 0;
      this.fps = fps;
      if (this.settings.quality === 'auto' && fps < 22 && this.playing && !this.editor && !this.ff && !document.hidden) {
        if (++this.slowT >= 2 && this.quality !== 'low') {
          this.slowT = 0; this.quality = this.quality === 'high' ? 'medium' : 'low';
          r.setQuality(this.quality); const s = this.sim; r.setSim(null); this.attach(s, true);
          this.ui.toast('Качество графики снижено для плавности', 'info');
        }
      } else this.slowT = 0;
    }
  }
}

function boot() {
  try {
    const test = document.createElement('canvas');
    if (!(test.getContext('webgl2') || test.getContext('webgl'))) throw new Error('WebGL не поддерживается');
    window.game = new Game();
  } catch (e) {
    console.error(e);
    const f = $('#fatal'); f.classList.remove('hidden');
    f.textContent = 'Не удалось запустить игру: ' + (e && e.message ? e.message : e) + '. Попробуйте обновить браузер или включить аппаратное ускорение.';
    $('#menu').classList.add('hidden');
  }
}
boot();
