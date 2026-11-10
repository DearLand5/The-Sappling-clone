// StatsPanel — панель статистики: обзор, графики численности, пищевая сеть,
// карта распространения и журнал событий.
import { el, clear, kv, bar, btn, sec, options, spColor } from './dom.js';
import { lineChart, foodWeb, miniMap } from './charts.js';
import { YEAR } from '../world/ClimateSystem.js';
import { DEATH_CAUSES } from '../life/OrganismSystem.js';

export class StatsPanel {
  constructor(ui) { this.ui = ui; this.mode = 0; this.range = 0; this.mapSp = null; this.cv = null; }
  get sim() { return this.ui.game.sim; }

  render(body) {
    const ui = this.ui, sim = this.sim, st = sim.stats, org = sim.organisms;
    const tab = ui.setTabs('stats', [['over', '📋 Обзор'], ['chart', '📈 Графики'], ['web', '🕸️ Пищевая сеть'], ['map', '🗺️ Карта'], ['log', '📜 Журнал']]);
    this.cv = null; this.tabName = tab;
    if (tab === 'over') {
      const grid = el('div', { class: 'grid3' });
      const tile = (icon, label, fn) => { const b = el('b'); const upd = () => { b.textContent = fn(); }; upd(); ui.live.push(upd); grid.append(el('div', { class: 'tile' }, b, el('span', { class: 'mut', text: `${icon} ${label}` }))); };
      tile('🐾', 'видов животных', () => org.aliveSpecies('c').length); tile('🌿', 'видов растений', () => org.aliveSpecies('p').length);
      tile('💀', 'вымерло', () => st.counters.extinctions); tile('🐣', 'рождений', () => st.counters.births);
      tile('⚰️', 'смертей', () => st.counters.deaths); tile('🧬', 'мутаций', () => st.counters.mutations);
      tile('🌟', 'новых видов', () => st.counters.speciations); tile('☄️', 'катастроф', () => st.counters.disasters);
      tile('🌱', 'проросло семян', () => st.counters.plantsBorn);
      body.append(grid, sec('Причины гибели животных'));
      const causes = Object.entries(st.deathsBy).sort((a, b) => b[1] - a[1]), total = causes.reduce((s, c) => s + c[1], 0) || 1;
      if (!causes.length) body.append(el('p', { class: 'mut', text: 'Пока никто не погиб.' }));
      for (const [k, n] of causes.slice(0, 8)) body.append(el('div', { style: 'margin:5px 0' }, el('div', { class: 'row', style: 'justify-content:space-between;font-size:13.5px' }, el('span', { text: DEATH_CAUSES[k] || k }), el('span', { class: 'mut', text: `${n} (${Math.round(n / total * 100)}%)` })), bar('h', n / total)));
      body.append(sec('Отчёт об изменениях за период'), el('div', { class: 'row' },
        ...[['Сезон', YEAR / 4], ['Год', YEAR], ['5 лет', YEAR * 5], ['Всё время', 1e9]].map(([l, p]) => btn(l, 'small grow', () => ui.showReport(st.report(p))))));
    } else if (tab === 'chart') {
      body.append(options('', ['Животные', 'Растения', 'Итого'], this.mode, (i) => { this.mode = i; this.refresh(); }),
        options('', ['Всё время', '5 лет', '1 год'], this.range, (i) => { this.range = i; this.refresh(); }));
      this.cv = el('canvas', { class: 'chart' }); this.legend = el('div', { class: 'legend' });
      body.append(this.cv, this.legend);
      this.refresh();
    } else if (tab === 'web') {
      this.cv = el('canvas', { class: 'chart' });
      body.append(el('p', { class: 'mut', style: 'margin:4px 2px 8px', text: 'Кто кого ест: зелёные линии — растительная пища, красные — охота, пунктир — падаль. Толщина — количество съеденного.' }), this.cv);
      this.refresh();
    } else if (tab === 'map') {
      this.cv = el('canvas', { class: 'chart' });
      this.cv.addEventListener('click', (e) => {
        const m = this.cv._map; if (!m) return;
        const r = this.cv.getBoundingClientRect(), cam = ui.game.render.cam;
        cam.tx = (e.clientX - r.left - m.ox) / m.k; cam.tz = (e.clientY - r.top) / m.k; ui.game.render.follow = false; this.refresh();
      });
      const chips = el('div', { class: 'opts', style: 'margin:8px 0' });
      const top = [...org.aliveSpecies('c').sort((a, b) => b.pop - a.pop).slice(0, 8), ...org.aliveSpecies('p').sort((a, b) => b.pop - a.pop).slice(0, 5)];
      if (this.mapSp && this.mapSp.pop <= 0) this.mapSp = null;
      const add = (sp, label) => chips.append(el('button', { class: 'opt' + (this.mapSp === sp ? ' on' : ''), onclick: () => { this.mapSp = sp; ui.renderPanel(); } }, sp ? el('span', { class: 'dot', style: 'background:' + spColor(sp) }) : null, label));
      add(null, 'Все животные'); for (const sp of top) add(sp, sp.name);
      body.append(this.cv, el('p', { class: 'mut', style: 'margin-top:6px', text: 'Коснитесь карты, чтобы переместить камеру.' }), chips);
      this.refresh();
    } else {
      const items = st.logItems.slice().reverse();
      if (!items.length) body.append(el('p', { class: 'mut', text: 'Событий пока не было.' }));
      for (const it of items) body.append(el('div', { class: 'logi ' + it.type }, el('small', { text: `г.${Math.floor(it.t / YEAR) + 1}` }), it.text));
    }
  }

  refresh() {
    if (!this.cv || !this.cv.isConnected) return;
    const sim = this.sim, st = sim.stats, org = sim.organisms, now = sim.climate.time;
    if (this.tabName === 'chart') {
      const from = this.range === 1 ? now - YEAR * 5 : this.range === 2 ? now - YEAR : undefined;
      let series;
      clear(this.legend);
      if (this.mode === 2) {
        series = [{ color: '#ffd166', t: st.gt, v: st.gAnimals }, { color: '#9be36b', t: st.gt, v: st.gPlants.map((v) => v / 10) }, { color: '#6bc5ff', t: st.gt, v: st.gSpecies }];
        for (const [c, n] of [['#ffd166', 'Животные'], ['#9be36b', 'Растения ÷10'], ['#6bc5ff', 'Число видов']]) this.legend.append(el('span', {}, el('span', { class: 'dot', style: 'background:' + c }), n));
      } else {
        const kind = this.mode ? 'p' : 'c';
        const list = [...org.species.values()].filter((s) => s.kind === kind && s.hp.length > 1 && (s.pop > 0 || (s.peak >= 6 && (from === undefined || s.extinctAt > from))))
          .sort((a, b) => (b.pop || b.peak * 0.2) - (a.pop || a.peak * 0.2)).slice(0, 10);
        series = list.map((s) => ({ color: spColor(s), t: s.ht, v: s.hp, width: s.pop > 0 ? 2 : 1 }));
        for (const s of list) this.legend.append(el('span', { style: s.pop > 0 ? '' : 'opacity:.55' }, el('span', { class: 'dot', style: 'background:' + spColor(s) }), `${s.name}${s.pop > 0 ? ' · ' + s.pop : ' †'}`));
      }
      lineChart(this.cv, series, { from });
    } else if (this.tabName === 'web') foodWeb(this.cv, sim);
    else if (this.tabName === 'map') miniMap(this.cv, sim, this.mapSp, this.ui.game.render.cam);
  }
}
