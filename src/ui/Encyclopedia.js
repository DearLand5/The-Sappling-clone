// Encyclopedia — энциклопедия организмов: внешность, биология, гены, поведение,
// эволюционная история и родословное древо видов.
import { el, clear, kv, bar, btn, sec, spColor } from './dom.js';
import { lineChart } from './charts.js';
import { CG, PG, CREATURE_GROUPS, PLANT_GROUPS, PLANT_TYPES, geneInt, describeCreature } from '../life/GeneticsSystem.js';
import { DEATH_CAUSES } from '../life/OrganismSystem.js';
import { BIOMES } from '../world/WorldGenerator.js';
import { YEAR } from '../world/ClimateSystem.js';
import { creatureSummary } from './CreatureEditor.js';
import { plantSummary } from './PlantEditor.js';

const yr = (t) => 'год ' + (Math.floor(t / YEAR) + 1);
const significant = (sp) => sp.pop > 0 || sp.peak >= 4 || sp.custom;

export class Encyclopedia {
  constructor(ui) { this.ui = ui; this.detail = null; }
  get sim() { return this.ui.game.sim; }

  open(sp) { this.detail = sp; this.ui.game.audio.click(); this.ui.openPanel('book'); }

  render(body) {
    const ui = this.ui, sim = this.sim, org = sim.organisms;
    const tab = ui.setTabs('book', [['c', '🐾 Животные'], ['p', '🌿 Растения'], ['ext', '💀 Вымершие'], ['tree', '🌳 Древо'], ['bio', '🗺️ Биомы']]);
    if (this.detail) return this.renderDetail(body, this.detail);
    const all = [...org.species.values()];
    if (tab === 'bio') {
      const cnt = new Array(BIOMES.length).fill(0), tsum = new Array(BIOMES.length).fill(0);
      sim.world.biome.forEach((b, i) => { cnt[b]++; tsum[b] += sim.world.baseTemp[i] + sim.climate.globalTemp; });
      BIOMES.forEach((b, i) => body.append(el('div', { class: 'card', style: cnt[i] ? '' : 'opacity:.5' },
        el('div', { style: 'font-weight:650', text: `${b.icon} ${b.name}` }), el('div', { class: 'mut', text: b.desc }),
        el('div', { class: 'mut', style: 'color:var(--acc2);margin-top:3px', text: cnt[i] ? `Площадь ${(cnt[i] / sim.world.biome.length * 100).toFixed(1)}% · средняя ${Math.round(tsum[i] / cnt[i])}°C · плодородие ${Math.round(b.fert * 100)}%` : 'В этом мире отсутствует' }))));
      return;
    }
    if (tab === 'tree') return this.renderTree(body, all);
    const list = tab === 'ext' ? all.filter((s) => s.pop <= 0 && s.extinctAt >= 0 && significant(s)).sort((a, b) => b.extinctAt - a.extinctAt)
      : all.filter((s) => s.kind === tab && s.pop > 0).sort((a, b) => b.pop - a.pop);
    if (!list.length) body.append(el('p', { class: 'mut', style: 'margin-top:10px', text: tab === 'ext' ? 'Пока ни один вид не вымер.' : 'Здесь пока пусто.' }));
    for (const sp of list.slice(0, 80)) {
      body.append(el('button', { class: 'card spc', style: 'width:100%;text-align:left', onclick: () => { this.detail = sp; ui.game.audio.click(); ui.renderPanel(); } },
        el('img', { src: ui.thumbOf(sp), alt: '' }),
        el('div', { class: 'grow' }, el('div', { class: 'nm' }, el('span', { class: 'dot', style: 'background:' + spColor(sp) }), sp.name),
          el('div', { class: 'mut', text: sp.pop > 0 ? `${sp.kind === 'c' ? sp.ph.diet.name : PLANT_TYPES[sp.ph.type]} · ${sp.pop} особ. · с ${yr(sp.bornAt)}` : `† ${yr(sp.extinctAt)} · существовал ${((sp.extinctAt - sp.bornAt) / YEAR).toFixed(1)} лет · пик ${sp.peak}` }))));
    }
  }

  renderTree(body, all) {
    const org = this.sim.organisms;
    const keep = new Map();
    const mark = (sp) => { if (keep.has(sp.id)) return keep.get(sp.id); let k = significant(sp); for (const id of sp.children) { const ch = org.species.get(id); if (ch && mark(ch)) k = true; } keep.set(sp.id, k); return k; };
    all.forEach(mark);
    body.append(el('p', { class: 'mut', style: 'margin:4px 2px 8px', text: 'Родословная видов. † — вымершие. Потомки расположены под предками.' }));
    let n = 0;
    const draw = (sp, depth) => {
      if (!keep.get(sp.id) || n > 220) return; n++;
      body.append(el('button', { style: `display:flex;align-items:center;gap:6px;width:100%;text-align:left;padding:7px 4px 7px ${6 + Math.min(depth, 9) * 16}px;border-bottom:1px solid var(--line);font-size:13.5px;${sp.pop > 0 ? '' : 'opacity:.6'}`,
        onclick: () => { this.detail = sp; this.ui.renderPanel(); } },
        el('span', { text: depth ? '└' : '' }), el('span', { class: 'dot', style: 'background:' + spColor(sp) }),
        el('span', { class: 'grow', text: `${sp.kind === 'c' ? '🐾' : '🌿'} ${sp.name}${sp.pop > 0 ? '' : ' †'}` }), el('span', { class: 'mut', text: sp.pop > 0 ? String(sp.pop) : yr(sp.extinctAt < 0 ? sp.bornAt : sp.extinctAt) })));
      for (const id of sp.children) { const ch = org.species.get(id); if (ch) draw(ch, depth + 1); }
    };
    for (const kind of ['c', 'p']) for (const sp of all) if (sp.kind === kind && !sp.parent) draw(sp, 0);
  }

  renderDetail(body, sp) {
    const ui = this.ui, g = ui.game, sim = this.sim, org = sim.organisms, isC = sp.kind === 'c';
    const link = (s) => el('button', { class: 'opt', style: 'margin:2px 4px 2px 0', onclick: () => { this.detail = s; ui.renderPanel(); } }, el('span', { class: 'dot', style: 'background:' + spColor(s) }), s.name + (s.pop > 0 ? '' : ' †'));
    body.append(el('div', { class: 'row', style: 'margin:2px 0 8px' }, btn('← К списку', 'small', () => { this.detail = null; ui.renderPanel(); }),
      el('div', { class: 'grow mut', style: 'text-align:right', text: sp.pop > 0 ? `Живёт: ${sp.pop} особ.` : sp.extinctAt >= 0 ? `Вымер: ${yr(sp.extinctAt)}` : 'Ещё не заселён' })));
    body.append(el('div', { class: 'row', style: 'align-items:flex-start' },
      el('img', { class: 'thumb', style: 'width:104px;height:104px', src: ui.thumbOf(sp), alt: '' }),
      el('div', { class: 'grow' }, el('div', { style: 'font-size:17px;font-weight:700', text: sp.name }),
        el('div', { class: 'mut', style: 'margin:3px 0', text: isC ? describeCreature(sp.ph) : `${PLANT_TYPES[sp.ph.type]} высотой до ${sp.ph.maxH.toFixed(1)} м.` }),
        sp.note ? el('div', { style: 'font-size:13px', text: sp.note }) : null, sp.custom ? el('div', { class: 'mut', text: '✏️ Создан игроком' }) : null)));
    const acts = el('div', { class: 'row wrap', style: 'margin:8px 0' });
    if (sp.pop > 0) acts.append(btn('👁 Показать', 'small grow', () => {
      const list = isC ? org.creatures : org.plants, mine = list.filter((o) => o.sp === sp && o.alive);
      if (!mine.length) return;
      const o = mine[(Math.random() * mine.length) | 0], r = g.render;
      ui.select(o); r.cam.tx = o.x; r.cam.tz = o.z; r.cam.dist = Math.min(r.cam.dist, 30); r.follow = isC; ui.updateInspector(true);
      if (window.innerHeight > window.innerWidth) ui.closePanel();
    }));
    if (!sp.deleted) acts.append(btn('➕ Разместить', 'small grow', () => { g.setTool({ type: 'place', sp, count: isC ? 5 : 8 }); if (window.innerHeight > window.innerWidth) ui.closePanel(); }));
    acts.append(btn('✎ В редактор', 'small grow', () => g.openEditor(sp.kind, { species: sp.pop > 0 ? sp : null, genome: sp.genome, name: sp.pop > 0 ? sp.name : sp.name + ' II' })));
    if (sp.pop > 0) acts.append(btn('🗑 Истребить', 'small warn', () => ui.confirm('Удалить вид?', `Все особи вида «${sp.name}» исчезнут из мира.`, 'Удалить', () => { org.deleteSpecies(sp); g.render.plantsDirty = true; g.audio.remove(); ui.renderPanel(); })));
    body.append(acts);

    body.append(sec('Характеристики'));
    const chips = el('div', { class: 'legend' });
    for (const s of (isC ? creatureSummary : plantSummary)(sp.genome)) chips.append(el('span', { class: 'chip', style: s.cls === 'bad' ? 'background:rgba(255,123,107,.25)' : '', text: s.t }));
    body.append(chips);

    // --- история
    body.append(sec('Эволюционная история'));
    const par = sp.parent ? org.species.get(sp.parent) : null;
    body.append(kv('Появился', yr(sp.bornAt)), kv('Существует', `${(((sp.extinctAt >= 0 && sp.pop <= 0 ? sp.extinctAt : sim.climate.time) - sp.bornAt) / YEAR).toFixed(1)} лет`),
      kv('Пик численности', String(sp.peak)), kv('Всего родилось', String(sp.totalBorn)), kv('Накоплено мутаций', String(sp.mutations)));
    if (par) body.append(el('div', { style: 'margin-top:6px' }, el('span', { class: 'mut', text: 'Предок: ' }), link(par)));
    const kids = sp.children.map((id) => org.species.get(id)).filter((s) => s && significant(s));
    if (kids.length) { const d = el('div', { style: 'margin-top:6px' }, el('span', { class: 'mut', text: 'Потомки: ' })); kids.slice(0, 12).forEach((k) => d.append(link(k))); body.append(d); }
    if (sp.hp.length > 2) { const cv = el('canvas', { class: 'chart', style: 'margin-top:8px' }); body.append(cv); requestAnimationFrame(() => lineChart(cv, [{ color: spColor(sp), t: sp.ht, v: sp.hp }], { height: 130 })); }
    const deaths = Object.entries(sp.deaths).sort((a, b) => b[1] - a[1]);
    if (deaths.length) { body.append(sec('Причины гибели')); for (const [k, n] of deaths.slice(0, 6)) body.append(kv(DEATH_CAUSES[k] || k, String(n))); }

    // --- пищевые связи
    if (isC) {
      const eats = Object.entries(sp.eats).sort((a, b) => b[1] - a[1]).slice(0, 8);
      if (eats.length) {
        const d = el('div', {}); body.append(sec('Чем питается'), d);
        for (const [key] of eats) { if (key === 'det') { d.append(el('span', { class: 'opt', style: 'display:inline-block;margin:2px 4px 2px 0', text: '🍂 Детрит' })); continue; } const s = org.species.get(+(key[0] === 'c' ? key.slice(1) : key)); if (s) d.append(link(s)); }
      }
    }
    const eaters = [...org.species.values()].filter((s) => s.kind === 'c' && (s.eats[sp.id] > 0.5 || s.eats['c' + sp.id] > 0.5)).slice(0, 10);
    if (eaters.length) { const d = el('div', {}); body.append(sec('Кто его ест'), d); eaters.forEach((s) => d.append(link(s))); }

    // --- гены
    const table = isC ? CG : PG, groups = isC ? CREATURE_GROUPS : PLANT_GROUPS;
    for (const gr of groups) {
      body.append(sec(`${gr.icon} Гены: ${gr.n}`));
      for (const d of table) {
        if (d.grp !== gr.k) continue;
        if (d.t === 'f') body.append(el('div', { style: 'display:grid;grid-template-columns:1fr 90px;gap:8px;align-items:center;padding:3px 2px;font-size:13.5px' }, el('span', { text: d.n }), bar('g', sp.genome[d.i])));
        else body.append(kv(d.n, d.t === 'c' ? d.o[geneInt(sp.genome, d)] : String(geneInt(sp.genome, d))));
      }
    }
  }
}
