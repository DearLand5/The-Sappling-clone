// MobileUI — сенсорный интерфейс: управление камерой жестами, верхняя панель,
// панели инструментов, инспектор организма, меню, модальные окна.
import { $, el, clear, slider, toggle, options, kv, bar, btn, sec, spColor } from './dom.js';
import { SEASONS, SEASON_ICONS, WEATHER, DISASTERS, YEAR, DAY } from '../world/ClimateSystem.js';
import { BIOMES, DEFAULT_WORLD_PARAMS } from '../world/WorldGenerator.js';
import { STATE_NAMES } from '../life/BehaviorSystem.js';
import { STAGE } from '../life/OrganismSystem.js';
import { CG, PG, makeGenome, PLANT_TYPES } from '../life/GeneticsSystem.js';
import { STARTER_ANIMALS, STARTER_PLANTS } from '../data/presets.js';
import { SCENARIOS } from '../systems/ScenarioSystem.js';
import { QUALITY } from '../render/RenderingSystem.js';
import { clamp, packGenome } from '../core/utils.js';
import { StatsPanel } from './StatsPanel.js';
import { Encyclopedia } from './Encyclopedia.js';

const PANEL_TITLES = { life: 'Обитатели мира', create: 'Создать организм', world: 'Мир и климат', stats: 'Статистика', book: 'Энциклопедия' };

export class MobileUI {
  constructor(game) {
    this.game = game;
    this.panel = null; this.tab = {}; this.refreshT = 0; this.hudT = 0;
    this.libThumbs = new Map();
    this.stats = new StatsPanel(this); this.book = new Encyclopedia(this);
    this.sheet = $('#sheet'); this.sheetBody = $('#sheet-body'); this.sheetTabs = $('#sheet-tabs');
    this.bindInput(); this.bindHud();
    window.addEventListener('resize', () => this.onResize());
    window.addEventListener('orientationchange', () => setTimeout(() => this.onResize(), 250));
  }

  onResize() {
    this.game.render.resize();
    if (this.game.editor) this.game.editor.layout();
    if (this.panel) this.renderPanel();
  }

  // ======================= жесты =======================
  bindInput() {
    const cv = this.game.canvas, P = new Map();
    let start = null, pinch = null;
    const R = () => this.game.render;
    cv.addEventListener('contextmenu', (e) => e.preventDefault());
    cv.addEventListener('pointerdown', (e) => {
      this.game.audio.unlock();
      cv.setPointerCapture(e.pointerId);
      P.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (P.size === 1) start = { x: e.clientX, y: e.clientY, t: e.timeStamp, moved: false, btn: e.button, ctrl: e.ctrlKey || e.shiftKey };
      else if (P.size === 2) {
        const [a, b] = [...P.values()], cam = R().cam, ed = R().ed;
        pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), a: Math.atan2(b.y - a.y, b.x - a.x), my: (a.y + b.y) / 2, dist: cam.dist, yaw: cam.yaw, pitch: cam.pitch, edDist: ed.dist };
        if (start) start.moved = true;
      }
    });
    cv.addEventListener('pointermove', (e) => {
      const p = P.get(e.pointerId); if (!p) return;
      const dx = e.clientX - p.x, dy = e.clientY - p.y;
      p.x = e.clientX; p.y = e.clientY;
      const r = R(), cam = r.cam, editor = r.mode === 'editor';
      if (P.size === 1 && start) {
        if (Math.hypot(e.clientX - start.x, e.clientY - start.y) > 9) start.moved = true;
        if (!start.moved) return;
        if (editor) { r.ed.yaw -= dx * 0.01; r.ed.pitch = clamp(r.ed.pitch + dy * 0.006, -0.15, 1.25); return; }
        if (start.btn === 2 || start.ctrl) { cam.yaw -= dx * 0.006; cam.pitch = clamp(cam.pitch + dy * 0.005, 0.18, 1.48); return; }
        // перемещение по миру одним пальцем
        const k = cam.dist * 0.0021, sy = Math.sin(cam.yaw), cy = Math.cos(cam.yaw), fk = 1 / Math.max(0.45, Math.sin(cam.pitch));
        cam.tx += (-cy * dx - sy * dy * fk) * k; cam.tz += (sy * dx - cy * dy * fk) * k;
        if (r.follow) { r.follow = false; this.updateInspector(true); }
      } else if (P.size === 2 && pinch) {
        const [a, b] = [...P.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y), ang = Math.atan2(b.y - a.y, b.x - a.x), my = (a.y + b.y) / 2;
        if (editor) { r.ed.dist = clamp(pinch.edDist * pinch.d / Math.max(20, d), 0.6, 80); r.ed.userZoom = true; return; }
        cam.dist = clamp(pinch.dist * pinch.d / Math.max(20, d), 5, this.maxDist());
        let da = ang - pinch.a; while (da > Math.PI) da -= Math.PI * 2; while (da < -Math.PI) da += Math.PI * 2;
        cam.yaw = pinch.yaw - da;
        cam.pitch = clamp(pinch.pitch + (my - pinch.my) * 0.005, 0.18, 1.48);
      }
    });
    const up = (e) => {
      if (!P.has(e.pointerId)) return;
      P.delete(e.pointerId);
      if (P.size === 0) {
        if (start && !start.moved && e.timeStamp - start.t < 600 && e.type === 'pointerup') this.game.onTap(e.clientX, e.clientY);
        start = null; pinch = null;
      } else if (P.size === 1) { pinch = null; if (start) start.moved = true; }
    };
    cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
    cv.addEventListener('wheel', (e) => {
      e.preventDefault();
      const r = R(), f = Math.exp(e.deltaY * 0.0012);
      if (r.mode === 'editor') { r.ed.dist = clamp(r.ed.dist * f, 0.6, 80); r.ed.userZoom = true; } else r.cam.dist = clamp(r.cam.dist * f, 5, this.maxDist());
    }, { passive: false });
    window.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT' || !this.game.sim) return;
      if (e.code === 'Space') { this.game.setSpeed(this.game.speedIdx ? 0 : 1); e.preventDefault(); }
      else if (e.key >= '1' && e.key <= '4') this.game.setSpeed(+e.key);
      else if (e.key === 'Escape') { if (this.game.tool) this.game.setTool(null); else this.closePanel(); }
    });
  }
  maxDist() { return this.game.sim ? this.game.sim.world.size * 1.15 : 400; }

  // ======================= верхняя панель =======================
  bindHud() {
    const g = this.game, a = () => g.audio.click();
    $('#btn-menu').onclick = () => { a(); this.showMenu('pause'); };
    for (const b of $('#timebar').querySelectorAll('[data-sp]')) b.onclick = () => { a(); g.setSpeed(+b.dataset.sp); };
    $('#btn-ff').onclick = () => { a(); this.showFastForward(); };
    for (const b of $('#nav').children) b.onclick = () => { a(); this.panel === b.dataset.p && !this.sheet.classList.contains('min') ? this.closePanel() : this.openPanel(b.dataset.p); };
    $('#sheet-close').onclick = () => { a(); this.closePanel(); };
    $('#sheet-min').onclick = () => { a(); this.sheet.classList.toggle('min'); $('#sheet-min').textContent = this.sheet.classList.contains('min') ? '▴' : '▾'; if (!this.sheet.classList.contains('min')) this.renderPanel(); };
    $('#goal').onclick = () => $('#goal').classList.toggle('min');
  }

  showHud(v) { $('#hud').classList.toggle('hidden', !v); }

  updateSpeedButtons() {
    for (const b of $('#timebar').querySelectorAll('[data-sp]')) b.classList.toggle('on', +b.dataset.sp === this.game.speedIdx);
  }

  update(dt) {
    const g = this.game, sim = g.sim; if (!sim) return;
    this.hudT -= dt;
    if (this.hudT <= 0) {
      this.hudT = 0.3;
      const cl = sim.climate, org = sim.organisms, cam = g.render.cam;
      $('#d-date').textContent = `Год ${cl.year + 1}`;
      $('#d-sub').textContent = `${SEASON_ICONS[cl.season]} ${SEASONS[cl.season]} · ${cl.isNight ? '🌙' : '🌤️'}`;
      const T = cl.tempAt(cam.sx, cam.sz), w = WEATHER[cl.weather];
      const snow = cl.precip > 0 && T < 0.5;
      $('#ch-weather').textContent = `${snow ? '🌨️' : w.icon} ${Math.round(T)}°`;
      $('#ch-sp').textContent = `🧬 ${org.aliveSpecies().length}`;
      $('#ch-an').textContent = `🐾 ${org.creatures.length}`;
      $('#ch-pl').textContent = `🌿 ${org.plants.length}`;
      this.updateInspector();
      this.updateGoal();
    }
    if (this.panel && !this.sheet.classList.contains('min')) {
      this.refreshT -= dt;
      if (this.refreshT <= 0) { this.refreshT = 1.5; this.softRefresh(); }
    }
  }

  toast(text, type = 'info') {
    const box = $('#toasts');
    while (box.children.length > 3) box.firstChild.remove();
    const t = el('div', { class: 'toast ' + type, text });
    box.append(t); setTimeout(() => t.remove(), 4800);
  }

  // ======================= панели =======================
  openPanel(name, tab) {
    this.panel = name; if (tab) this.tab[name] = tab;
    this.sheet.classList.remove('hidden', 'min'); $('#sheet-min').textContent = '▾';
    for (const b of $('#nav').children) b.classList.toggle('on', b.dataset.p === name);
    this.book.detail = name === 'book' ? this.book.detail : null;
    this.renderPanel();
  }
  closePanel() {
    this.panel = null; this.sheet.classList.add('hidden');
    for (const b of $('#nav').children) b.classList.remove('on');
  }
  setTabs(name, tabs) {
    clear(this.sheetTabs);
    if (!this.tab[name] || !tabs.some((t) => t[0] === this.tab[name])) this.tab[name] = tabs[0][0];
    for (const [k, label] of tabs) {
      const b = el('button', { class: 'tab' + (this.tab[name] === k ? ' on' : ''), text: label });
      b.onclick = () => { this.game.audio.click(); this.tab[name] = k; if (name === 'book') this.book.detail = null; this.renderPanel(); };
      this.sheetTabs.append(b);
    }
    return this.tab[name];
  }
  renderPanel() {
    if (!this.panel || !this.game.sim) return;
    $('#sheet-title').textContent = PANEL_TITLES[this.panel];
    const body = clear(this.sheetBody); clear(this.sheetTabs);
    body.scrollTop = 0; this.live = [];
    ({ life: () => this.renderLife(body), create: () => this.renderCreate(body), world: () => this.renderWorld(body), stats: () => this.stats.render(body), book: () => this.book.render(body) })[this.panel]();
    this.refreshT = 1.5;
  }
  /** Обновление «живых» значений без перестройки панели. */
  softRefresh() {
    for (const f of this.live || []) f();
    if (this.panel === 'stats') this.stats.refresh();
  }

  thumbOf(sp) { return this.game.render.thumbnail(sp); }
  libThumb(item) {
    const key = item.kind + item.name + item.g.slice(0, 6).join(',');
    let u = this.libThumbs.get(key);
    if (!u) { u = this.game.render.renderThumb(item.kind, Float32Array.from(item.g)); this.libThumbs.set(key, u); }
    return u;
  }

  speciesCard(sp, actions) {
    const info = el('div', { class: 'mut' });
    const upd = () => { info.textContent = sp.kind === 'c' ? `${sp.ph.diet.icon} ${sp.pop} особ. · ${{ land: 'суша', water: 'вода', amphi: 'вода и суша', air: 'воздух' }[sp.ph.habitat]}` : `${PLANT_TYPES[sp.ph.type]} · ${sp.pop} шт.`; };
    upd(); this.live.push(upd);
    return el('div', { class: 'card spc' },
      el('img', { src: this.thumbOf(sp), alt: '', onclick: () => this.book.open(sp) }),
      el('div', { class: 'grow', onclick: () => this.book.open(sp) }, el('div', { class: 'nm' }, el('span', { class: 'dot', style: 'background:' + spColor(sp) }), sp.name), info),
      el('div', { class: 'act' }, actions));
  }

  // ---------- Жизнь
  renderLife(body) {
    const g = this.game, sim = g.sim, org = sim.organisms;
    const tab = this.setTabs('life', [['c', '🐾 Животные'], ['p', '🌿 Растения'], ['lib', '📚 Библиотека']]);
    if (tab === 'lib') return this.renderLibrary(body);
    body.append(el('div', { class: 'row', style: 'margin:4px 0 8px' },
      btn(tab === 'c' ? '＋ Новое животное' : '＋ Новое растение', 'primary grow small', () => g.openEditor(tab)),
      btn('🧹 Ластик', 'small' + (g.tool && g.tool.type === 'remove' ? ' on' : ''), () => { g.setTool(g.tool && g.tool.type === 'remove' ? null : { type: 'remove', radius: 6 }); this.renderPanel(); })));
    const list = org.aliveSpecies(tab).sort((a, b) => b.pop - a.pop);
    if (!list.length) {
      body.append(el('div', { class: 'card' }, el('p', { text: tab === 'c' ? 'В мире пока нет животных.' : 'В мире пока нет растений.' }), el('div', { class: 'sp8' }),
        btn(tab === 'c' ? '🐾 Заселить стартовыми животными' : '🌿 Посадить стартовые растения', 'wide', () => {
          if (tab === 'c') sim.seedAnimals(); else { sim.seedVegetation(sim.world.params.vegetation); sim.warmup(); }
          g.render.plantsDirty = true; g.audio.place(); this.renderPanel();
        }), el('p', { class: 'mut', style: 'margin-top:8px', text: 'Или возьмите отдельные виды во вкладке «Библиотека», либо создайте свои.' })));
    }
    for (const sp of list.slice(0, 60)) {
      body.append(this.speciesCard(sp, [
        el('button', { class: 'ib', text: '➕', title: 'Разместить', onclick: () => { g.audio.click(); g.setTool({ type: 'place', sp, count: sp.kind === 'c' ? 5 : 8 }); } }),
        el('button', { class: 'ib', text: '✎', title: 'Изменить', onclick: () => g.openEditor(sp.kind, { species: sp, genome: sp.genome }) }),
      ]));
    }
    if (list.length > 60) body.append(el('p', { class: 'mut', text: `…и ещё ${list.length - 60} видов (см. энциклопедию)` }));
  }

  renderLibrary(body) {
    const g = this.game, org = g.sim.organisms;
    const mine = g.save.library();
    const starters = [...STARTER_ANIMALS.map((d) => ({ kind: 'c', name: d.name, g: Array.from(makeGenome(CG, d.genes)), note: d.note, st: 1 })),
      ...STARTER_PLANTS.map((d) => ({ kind: 'p', name: d.name, g: Array.from(makeGenome(PG, d.genes)), note: d.note, st: 1 }))];
    const row = (it) => {
      const exists = [...org.species.values()].find((s) => s.name === it.name && s.kind === it.kind && !s.deleted);
      return el('div', { class: 'card spc' },
        el('img', { src: this.libThumb(it), alt: '' }),
        el('div', { class: 'grow' }, el('div', { class: 'nm', text: it.name }), el('div', { class: 'mut', text: it.note || (it.kind === 'c' ? 'Животное' : 'Растение') })),
        el('div', { class: 'act' },
          el('button', { class: 'ib', text: '➕', title: 'В мир', onclick: () => { g.audio.click(); const sp = exists || org.createSpecies(it.kind, Float32Array.from(it.g), { name: it.name, custom: !it.st, note: it.note }); g.setTool({ type: 'place', sp, count: it.kind === 'c' ? 5 : 8 }); } }),
          el('button', { class: 'ib', text: '✎', onclick: () => g.openEditor(it.kind, { genome: Float32Array.from(it.g), name: it.st ? it.name + ' II' : it.name }) }),
          it.st ? null : el('button', { class: 'ib', text: '🗑', onclick: () => { g.save.removeFromLibrary(it.name, it.kind); this.renderPanel(); } })));
    };
    body.append(sec('Мои виды'));
    if (!mine.length) body.append(el('p', { class: 'mut', text: 'Созданные вами виды сохраняются здесь и доступны в любом мире.' }));
    for (const it of mine) body.append(row(it));
    body.append(sec('Стартовые животные')); for (const it of starters.filter((s) => s.kind === 'c')) body.append(row(it));
    body.append(sec('Стартовые растения')); for (const it of starters.filter((s) => s.kind === 'p')) body.append(row(it));
  }

  // ---------- Создать
  renderCreate(body) {
    const g = this.game;
    body.append(el('p', { class: 'mut', style: 'margin:6px 2px 10px', text: 'Сконструируйте собственный вид. Анатомия определяет способности: ноги — скорость, рот — пищу, покров — климат, крылья — полёт.' }),
      el('div', { class: 'grid2' },
        el('button', { class: 'tile', style: 'min-height:110px', onclick: () => g.openEditor('c') }, el('i', { style: 'font-size:38px', text: '🦎' }), el('b', { style: 'font-size:15px', text: 'Животное' }), el('span', { class: 'mut', text: 'тело, чувства, инстинкты' })),
        el('button', { class: 'tile', style: 'min-height:110px', onclick: () => g.openEditor('p') }, el('i', { style: 'font-size:38px', text: '🌳' }), el('b', { style: 'font-size:15px', text: 'Растение' }), el('span', { class: 'mut', text: 'деревья, травы, грибы' }))),
      sec('Подсказки'),
      el('div', { class: 'card', html: '• Размещайте сразу несколько особей — нужны самцы и самки.<br>• Проверьте диапазон температур в сводке редактора и сравните с климатом места.<br>• Хищник должен быть быстрее добычи, иначе умрёт от голода.<br>• Включённые мутации постепенно меняют ваш вид без вашего участия.' }));
  }

  // ---------- Мир
  renderWorld(body) {
    const g = this.game, sim = g.sim, cl = sim.climate, evo = sim.evolution;
    const tab = this.setTabs('world', [['clim', '🌡️ Климат'], ['evo', '🧬 Эволюция'], ['dis', '☄️ Катастрофы'], ['info', 'ℹ️ О мире']]);
    if (tab === 'clim') {
      const now = el('div', { class: 'card' });
      const upd = () => { now.textContent = `${WEATHER[cl.weather].icon} ${WEATHER[cl.weather].name} · аномалия ${cl.tempAnom >= 0 ? '+' : ''}${cl.tempAnom.toFixed(1)}° · сезон ${cl.seasonT >= 0 ? '+' : ''}${cl.seasonT.toFixed(0)}° · уровень воды ${sim.terrain.waterLevel >= 0 ? '+' : ''}${sim.terrain.waterLevel.toFixed(1)} м${cl.trendLeft > 0 ? ' · климат меняется' : ''}`; };
      upd(); this.live.push(upd);
      body.append(now,
        slider({ label: 'Глобальная температура', value: cl.globalTemp, min: -18, max: 18, step: 0.5, fmt: (v) => (v > 0 ? '+' : '') + v.toFixed(1) + '°C', hint: 'Сдвигает климат всей планеты. Биомы постепенно перестраиваются.', onInput: (v) => { cl.globalTemp = v; cl.trendLeft = 0; } }),
        slider({ label: 'Влажность', value: cl.globalHum, min: -0.45, max: 0.45, step: 0.01, fmt: (v) => (v > 0 ? '+' : '') + Math.round(v * 100) + '%', hint: 'Больше осадков и влаги в почве — или засушливый мир.', onInput: (v) => { cl.globalHum = v; } }),
        slider({ label: 'Выраженность сезонов', value: cl.seasonality, min: 0, max: 2.2, step: 0.05, fmt: (v) => '×' + v.toFixed(2), hint: 'Разница между летом и зимой.', onInput: (v) => { cl.seasonality = v; } }),
        slider({ label: 'Уровень воды', value: cl.waterOffset, min: -3, max: 5, step: 0.1, fmt: (v) => (v > 0 ? '+' : '') + v.toFixed(1) + ' м', hint: 'Поднимите, чтобы затопить побережья, или опустите, чтобы осушить отмели.', onInput: (v) => { cl.waterOffset = v; } }),
        el('div', { class: 'row' },
          btn('🌧️ Вызвать дождь', 'grow small', () => { cl.weather = 'rain'; cl.precip = 0.9; cl.weatherT = 45; cl.droughtT = 0; g.audio.click(); }),
          btn('☀️ Разогнать тучи', 'grow small', () => { cl.weather = 'clear'; cl.precip = 0; cl.weatherT = 45; g.audio.click(); })));
    } else if (tab === 'evo') {
      body.append(
        toggle('Мутации', evo.enabled, (v) => { evo.enabled = v; }, 'Случайные наследуемые изменения у потомства'),
        toggle('Видообразование', evo.speciation, (v) => { evo.speciation = v; }, 'Сильно изменившиеся потомки образуют новые виды'),
        slider({ label: 'Частота мутаций', value: evo.rate, min: 0, max: 0.3, step: 0.005, fmt: (v) => (v * 100).toFixed(1) + '% генов', onInput: (v) => { evo.rate = v; } }),
        slider({ label: 'Сила мутаций', value: evo.strength, min: 0.01, max: 0.25, step: 0.005, fmt: (v) => '±' + Math.round(v * 100) + '%', hint: 'Высокие значения ускоряют эволюцию, но чаще дают нежизнеспособных потомков.', onInput: (v) => { evo.strength = v; } }),
        sec('Пределы численности (производительность)'),
        slider({ label: 'Животных не более', value: sim.settings.maxCreatures, min: 80, max: 900, step: 10, fmt: (v) => String(v), onInput: (v) => { sim.settings.maxCreatures = v; } }),
        slider({ label: 'Растений не более', value: sim.settings.maxPlants, min: 600, max: 7000, step: 100, fmt: (v) => String(v), onInput: (v) => { sim.settings.maxPlants = v; } }),
        el('p', { class: 'mut', text: 'Эволюция здесь не запрограммирована: признаки меняются случайно, а выживают те, кто лучше находит пищу, спасается от хищников и переносит климат.' }));
    } else if (tab === 'dis') {
      body.append(el('p', { class: 'mut', style: 'margin:4px 2px 8px', text: 'Точечные катастрофы требуют выбрать место на карте.' }));
      const grid = el('div', { class: 'grid3' });
      for (const k of Object.keys(DISASTERS)) {
        const D = DISASTERS[k];
        grid.append(el('button', { class: 'tile', title: D.desc, onclick: () => {
          g.audio.click();
          if (D.point) { g.setTool({ type: 'disaster', kind: k }); if (window.innerHeight > window.innerWidth) this.sheet.classList.add('min'); }
          else { cl.trigger(k); this.toast(D.desc, 'bad'); }
        } }, el('i', { text: D.icon }), el('span', { text: D.name })));
      }
      body.append(grid, el('div', { class: 'sp8' }),
        toggle('Случайные катастрофы', cl.randomDisasters, (v) => { cl.randomDisasters = v; }),
        slider({ label: 'Частота катастроф', value: cl.disasterRate, min: 0.1, max: 3, step: 0.1, fmt: (v) => '×' + v.toFixed(1), onInput: (v) => { cl.disasterRate = v; } }));
    } else {
      const p = sim.world.params, cnt = new Array(BIOMES.length).fill(0);
      for (const b of sim.world.biome) cnt[b]++;
      body.append(kv('Название', p.name), kv('Зерно мира', String(p.seed)), kv('Размер', `${sim.world.size}×${sim.world.size} м`), kv('Возраст', `${(cl.time / YEAR).toFixed(1)} лет`), sec('Биомы'));
      BIOMES.forEach((b, i) => { if (cnt[i]) body.append(kv(`${b.icon} ${b.name}`, (cnt[i] / sim.world.biome.length * 100).toFixed(1) + '%')); });
      body.append(el('div', { class: 'sp14' }), el('div', { class: 'row' }, btn('💾 Сохранить', 'grow', () => this.showMenu('saves')), btn('☰ Меню', 'grow', () => this.showMenu('pause'))));
    }
  }

  // ======================= инструменты =======================
  updateBanner() {
    const g = this.game, t = g.tool, b = $('#banner');
    if (!t) { b.classList.add('hidden'); g.render.setCursor(null); return; }
    clear(b); b.classList.remove('hidden');
    if (t.type === 'place') {
      const cnt = el('div', { class: 'cnt' });
      for (const n of [1, 5, 15]) cnt.append(el('button', { class: t.count === n ? 'on' : '', text: '×' + n, onclick: () => { t.count = n; g.audio.click(); this.updateBanner(); } }));
      b.append(el('span', { text: `➕ ${t.sp.name.length > 16 ? t.sp.name.slice(0, 15) + '…' : t.sp.name}` }), cnt);
    } else if (t.type === 'remove') b.append(el('span', { text: '🧹 Ластик: коснитесь организмов' }));
    else if (t.type === 'disaster') b.append(el('span', { text: `${DISASTERS[t.kind].icon} ${DISASTERS[t.kind].name}: выберите место` }));
    b.append(el('button', { text: '✕', onclick: () => { g.audio.click(); g.setTool(null); if (this.panel) this.renderPanel(); } }));
  }

  afterSpeciesCreated(sp) {
    this.toast(`Вид «${sp.name}» готов. Коснитесь карты, чтобы разместить особей.`, 'good');
    this.closePanel();
    this.game.setTool({ type: 'place', sp, count: sp.kind === 'c' ? 5 : 8 });
  }

  // ======================= инспектор =======================
  select(o) {
    const r = this.game.render;
    r.selected = o; r.follow = false;
    const box = $('#inspector');
    if (!o) { box.classList.add('hidden'); return; }
    box.classList.remove('hidden', 'min');
    this.updateInspector(true);
  }

  updateInspector(force) {
    const g = this.game, r = g.render, o = r.selected, box = $('#inspector');
    if (!o || !o.alive) { if (!box.classList.contains('hidden')) { box.classList.add('hidden'); r.selected = null; } return; }
    if (box.classList.contains('min') && !force) return;
    const sim = g.sim, cl = sim.climate;
    clear(box);
    const sp = o.sp;
    box.append(el('div', { class: 'hd' }, el('span', { class: 'dot', style: 'background:' + spColor(sp) }), el('b', { text: sp.name }),
      el('button', { text: box.classList.contains('min') ? '▾' : '▴', onclick: () => { box.classList.toggle('min'); this.updateInspector(true); } }),
      el('button', { text: '✕', onclick: () => this.select(null) })));
    const bd = el('div', { class: 'bd' });
    if (o.kind === 'c') {
      const egg = o.stage === STAGE.EGG;
      const st = egg ? 'Яйцо' : STATE_NAMES[o.state] + (o.flying ? ' (в полёте)' : o.swim && o.ph.resp !== 1 ? ' (плывёт)' : '');
      const cell = sim.terrain.cellAt(o.x, o.z), T = o.ph.resp === 1 || o.swim ? cl.waterTempAtCell(cell) : cl.tempAtCell(cell);
      const comfort = Math.abs(T - o.ph.tempOpt) <= o.ph.tempTol ? 'комфортно' : T < o.ph.tempOpt ? 'холодно' : 'жарко';
      bd.append(el('div', { class: 'mut', text: `${o.sex ? '♂' : '♀'} ${o.stage === STAGE.JUV ? 'детёныш' : egg ? '' : 'взрослый'} · ${(o.age / YEAR).toFixed(1)} г. · поколение ${o.gen}` }),
        el('div', { text: `${st}${o.pregnant >= 0 ? ' · 🤰' : ''}${o.sick > 0 ? ' · 🦠 болеет' : ''}` }),
        el('div', { class: 'bl' }, '⚡', bar('e', o.energy / o.maxE), '❤️', bar('h', o.health / o.maxH), o.ph.resp !== 1 ? '💧' : null, o.ph.resp !== 1 ? bar('w', o.hydration) : null),
        el('div', { class: 'mut', text: `🌡️ ${Math.round(T)}° — ${comfort} · потомков: ${o.kids}` }));
    } else {
      const ph = o.ph;
      bd.append(el('div', { class: 'mut', text: `${PLANT_TYPES[ph.type]} · ${(o.age / YEAR).toFixed(1)} г. · поколение ${o.gen}` }),
        el('div', { class: 'bl' }, '📏', bar('g', o.grow), '🥬', bar('e', o.bio / (ph.maxBio * o.grow * o.grow + 0.01)), '❤️', bar('h', o.health)),
        el('div', { class: 'mut', text: `Рост: ${Math.round((o.gf || 0) * 100)}% · 💧 ${Math.round(sim.terrain.soilWater[o.cell] * 100)}% · 🌡️ ${Math.round(cl.tempAtCell(o.cell))}°` }));
    }
    bd.append(el('div', { class: 'acts' },
      o.kind === 'c' ? btn(r.follow ? '👁 Следим' : '👁 Следить', r.follow ? 'on' : '', () => { r.follow = !r.follow; if (r.follow) r.cam.dist = Math.min(r.cam.dist, 28); this.updateInspector(true); }) : null,
      btn('📖 Вид', '', () => this.book.open(sp)),
      btn('🗑', 'warn', () => { if (o.kind === 'c') sim.organisms.killCreature(o, 'removed', true); else sim.organisms.killPlant(o, 'removed'); sim.organisms.flush(); g.render.plantsDirty = true; g.audio.remove(); this.select(null); })));
    box.append(bd);
  }

  // ======================= цели сценария =======================
  updateGoal() {
    const sc = this.game.sim.scenario, box = $('#goal');
    if (!sc) { box.classList.add('hidden'); return; }
    box.classList.remove('hidden');
    const min = box.classList.contains('min');
    clear(box);
    box.append(el('h4', {}, el('span', { text: `${sc.def.icon} ${sc.def.title}` }), el('span', { text: min ? '▾' : '▴' })));
    const ul = el('ul');
    sc.def.goals.forEach((gl, i) => { const p = sc.progress[i]; ul.append(el('li', { class: p >= 1 ? 'done' : '', text: `${p >= 1 ? '✅' : '⬜'} ${gl.text}${p > 0 && p < 1 ? ' — ' + Math.round(p * 100) + '%' : ''}` })); });
    box.append(ul);
  }

  // ======================= модальные окна =======================
  modal(title, nodes, buttons) {
    const m = $('#modal'), card = clear($('#modal-card'));
    card.append(el('h3', { text: title }), ...nodes);
    const row = el('div', { class: 'row wrap', style: 'margin-top:12px' });
    for (const [label, cls, fn] of buttons) row.append(btn(label, 'grow ' + cls, () => { m.classList.add('hidden'); this.game.audio.click(); if (fn) fn(); }));
    card.append(row); m.classList.remove('hidden');
  }
  confirm(title, text, yes, fn) { this.modal(title, [el('p', { text })], [[yes, 'warn', fn], ['Отмена', '', null]]); }

  showFastForward() {
    const g = this.game;
    const opts = [['1 сезон', YEAR / 4], ['1 год', YEAR], ['5 лет', YEAR * 5], ['20 лет', YEAR * 20], ['50 лет', YEAR * 50]];
    const grid = el('div', { class: 'grid2' });
    for (const [label, sec_] of opts) grid.append(el('button', { class: 'tile', onclick: () => { $('#modal').classList.add('hidden'); g.audio.click(); g.fastForward(sec_); } }, el('b', { text: label })));
    this.modal('⏭ Перемотка времени', [el('p', { text: 'Мир просчитывается без отрисовки, в упрощённом режиме. После перемотки вы увидите отчёт об изменениях.' }), grid,
      el('div', { class: 'sp8' }), btn('📋 Отчёт за последний год', 'wide small', () => { $('#modal').classList.add('hidden'); this.showReport(g.sim.stats.report(YEAR)); })], [['Отмена', '', null]]);
  }

  showReport(r) {
    const nodes = [];
    const c = r.counters, d = (a) => `${a[0]} → ${a[1]}`;
    nodes.push(kv('Период', `${r.years.toFixed(1)} лет`), kv('Животных', d(r.animals)), kv('Растений', d(r.plants)), kv('Рождений / смертей', `${c.births} / ${c.deaths}`),
      kv('Мутаций', String(c.mutations)), kv('Новых видов', String(c.speciations)), kv('Катастроф', String(c.disasters)));
    const big = (list, title, cls) => { const l = list.filter((s) => s.peak >= 4 || s.custom); if (l.length) nodes.push(sec(title), el('div', { class: 'logi ' + cls, text: l.slice(0, 14).map((s) => s.name).join(', ') + (l.length > 14 ? ` и ещё ${l.length - 14}` : '') })); };
    big(r.appeared, 'Появились', 'good'); big(r.extinct, 'Исчезли', 'bad');
    const ch = r.changes.filter((x) => x.before && x.after).slice(0, 8);
    if (ch.length) { nodes.push(sec('Изменения численности')); for (const x of ch) nodes.push(kv(x.sp.name, `${x.before} → ${x.after}`)); }
    const wrap = el('div', { style: 'max-height:55vh;overflow-y:auto;touch-action:pan-y' }, ...nodes);
    this.modal('📋 Что изменилось', [wrap], [['Понятно', 'primary', null]]);
  }

  // ======================= меню =======================
  showMenu(page) {
    const g = this.game, body = clear($('#menu-body'));
    $('#menu').classList.remove('hidden');
    g.menuOpen = true;
    $('#logo').classList.toggle('hidden', page !== 'main' && page !== 'pause');
    const back = (to) => btn('← Назад', 'wide', () => { g.audio.click(); this.showMenu(to || (g.sim && g.playing ? 'pause' : 'main')); });
    const B = (label, cls, fn) => btn(label, 'wide ' + cls, () => { g.audio.unlock(); g.audio.click(); fn(); });
    if (page === 'main' || page === 'pause') {
      const auto = g.save.meta('auto');
      if (page === 'pause') body.append(B('▶ Вернуться в мир', 'primary', () => this.hideMenu()));
      else if (auto) body.append(B(`▶ Продолжить: ${auto.name} (${auto.when})`, 'primary', () => g.loadSlot('auto')));
      body.append(B('🌍 Новый мир', page === 'main' && !auto ? 'primary' : '', () => this.showMenu('new')),
        B('🎓 Сценарии', '', () => this.showMenu('scenarios')),
        B('💾 Сохранения', '', () => this.showMenu('saves')),
        B('⚙️ Настройки', '', () => this.showMenu('settings')),
        B('❓ Как играть', '', () => this.showMenu('help')));
    } else if (page === 'new') {
      const p = Object.assign({}, DEFAULT_WORLD_PARAMS, { seed: Math.floor(Math.random() * 99999) + 1, name: 'Мой мир' });
      let animals = true, plants = true;
      const name = el('input', { type: 'text', maxlength: 24, value: p.name }), seed = el('input', { type: 'number', value: p.seed });
      body.append(el('h3', { style: 'margin-bottom:8px', text: '🌍 Новый мир' }),
        el('div', { class: 'ctl' }, el('label', {}, el('span', { text: 'Название' })), name),
        el('div', { class: 'ctl' }, el('label', {}, el('span', { text: 'Зерно генератора' })), el('div', { class: 'row' }, seed, el('button', { class: 'ib', text: '🎲', onclick: () => { seed.value = Math.floor(Math.random() * 99999) + 1; } }))),
        options('Размер карты', ['Малый', 'Средний', 'Большой'], 1, (i) => { p.size = [64, 96, 128][i]; }, 'Большие миры требовательнее к устройству'),
        slider({ label: 'Высота ландшафта', value: p.height, onInput: (v) => { p.height = v; } }),
        slider({ label: 'Изрезанность рельефа', value: p.relief, onInput: (v) => { p.relief = v; }, hint: 'От равнин до горных хребтов' }),
        slider({ label: 'Количество воды', value: p.water, onInput: (v) => { p.water = v; } }),
        slider({ label: 'Температура', value: p.temperature, fmt: (v) => Math.round(-6 + 36 * v) + '°C', onInput: (v) => { p.temperature = v; } }),
        slider({ label: 'Влажность', value: p.humidity, onInput: (v) => { p.humidity = v; } }),
        slider({ label: 'Разнообразие биомов', value: p.diversity, onInput: (v) => { p.diversity = v; } }),
        slider({ label: 'Количество растительности', value: p.vegetation, onInput: (v) => { p.vegetation = v; } }),
        toggle('Стартовые растения', true, (v) => { plants = v; }), toggle('Стартовые животные', true, (v) => { animals = v; }, 'Выключите, чтобы заселить мир только своими видами'),
        B('Создать мир', 'primary', () => { p.name = name.value.trim() || 'Мой мир'; p.seed = Math.abs(parseInt(seed.value, 10)) || 1; g.newWorld(p, { plants, animals }); }), back());
    } else if (page === 'scenarios') {
      const done = g.save.scenariosDone();
      body.append(el('h3', { style: 'margin-bottom:8px', text: '🎓 Сценарии' }), el('p', { class: 'mut', style: 'margin-bottom:10px', text: 'Задания шаг за шагом знакомят с механиками игры.' }));
      for (const s of SCENARIOS) body.append(el('button', { class: 'btn wide scn' + (done.includes(s.id) ? ' done' : ''), style: 'padding:10px 14px;margin-bottom:8px', onclick: () => { g.audio.click(); this.modal(`${s.icon} ${s.title}`, [el('p', { text: s.desc }), el('p', { class: 'mut', text: '💡 ' + s.hint })], [['Начать', 'primary', () => g.startScenario(s.id)], ['Отмена', '', null]]); } },
        el('b', { text: `${s.icon} ${s.title}` }), el('span', { class: 'mut', text: s.desc.slice(0, 74) + '…' })));
      body.append(back());
    } else if (page === 'saves') {
      body.append(el('h3', { style: 'margin-bottom:8px', text: '💾 Сохранения' }));
      for (const slot of g.save.slots) {
        const m = g.save.meta(slot);
        const title = slot === 'auto' ? 'Автосохранение' : 'Слот ' + slot;
        body.append(el('div', { class: 'card' },
          el('div', { style: 'font-weight:650', text: title + (m ? ` — ${m.name}` : '') }),
          el('div', { class: 'mut', text: m ? `${m.when} · 🧬 ${m.species} · 🐾 ${m.animals} · 🌿 ${m.plants} · ${new Date(m.date).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}` : 'Пусто' }),
          el('div', { class: 'row wrap', style: 'margin-top:8px' },
            m ? btn('Загрузить', 'small primary grow', () => { g.audio.click(); g.loadSlot(slot); }) : null,
            g.sim && g.playing && slot !== 'auto' ? btn('Сохранить сюда', 'small grow', () => { const ok = g.saveSlot(slot); this.toast(ok ? 'Мир сохранён' : 'Не удалось сохранить: ' + g.save.lastError, ok ? 'good' : 'bad'); g.audio[ok ? 'place' : 'error'](); this.showMenu('saves'); }) : null,
            m ? btn('Экспорт', 'small', () => g.save.exportWorld(slot)) : null,
            m ? btn('🗑', 'small warn', () => this.confirm('Удалить сохранение?', title, 'Удалить', () => { g.save.removeWorld(slot); this.showMenu('saves'); })) : null)));
      }
      const file = el('input', { type: 'file', accept: '.json,application/json', style: 'display:none' });
      file.onchange = () => { if (file.files[0]) g.save.importWorld(file.files[0]).then((d) => g.loadData(d)).catch(() => this.toast('Файл не является сохранением Эвосферы', 'bad')); };
      body.append(file, B('📂 Импорт из файла', '', () => file.click()), back());
    } else if (page === 'settings') {
      const s = g.settings, qs = ['auto', 'low', 'medium', 'high'];
      body.append(el('h3', { style: 'margin-bottom:8px', text: '⚙️ Настройки' }),
        options('Качество графики', ['Авто', ...Object.values(QUALITY).map((q) => q.name)], qs.indexOf(s.quality), (i) => { s.quality = qs[i]; g.applySettings(); }, 'Низкое — для слабых устройств: без теней, меньше деталей и дальность прорисовки'),
        toggle('Звуки', s.sound, (v) => { s.sound = v; g.applySettings(); }), toggle('Музыка', s.music, (v) => { s.music = v; g.applySettings(); }),
        toggle('Автосохранение', s.autosave, (v) => { s.autosave = v; g.applySettings(); }, 'Каждую минуту и при сворачивании браузера'), back());
    } else if (page === 'help') {
      body.append(el('h3', { style: 'margin-bottom:8px', text: '❓ Как играть' }), el('div', { class: 'card', style: 'font-size:14px', html:
        '<b>Камера</b><br>• Один палец — перемещение по миру<br>• Два пальца — масштаб, поворот и наклон<br>• Касание организма — информация о нём<br>На компьютере: левая кнопка — движение, правая — поворот, колесо — масштаб.<br><br>' +
        '<b>Жизнь</b><br>Создавайте животных и растения в редакторах и размещайте их в мире. Каждая особь сама ищет пищу, спасается от врагов, находит партнёра и растит потомство.<br><br>' +
        '<b>Эволюция</b><br>Потомки наследуют гены родителей с мутациями. Неудачные признаки отсеиваются голодом, хищниками и климатом, удачные распространяются. Со временем из одного вида возникают новые.<br><br>' +
        '<b>Время</b><br>Пауза, ускорение до 40× и перемотка на годы вперёд с отчётом об изменениях.<br><br>' +
        '<b>Мир</b><br>Меняйте климат, уровень воды, вызывайте катастрофы и наблюдайте, как жизнь приспосабливается — или вымирает.' }), back());
    }
  }
  hideMenu() { $('#menu').classList.add('hidden'); this.game.menuOpen = false; }
}
