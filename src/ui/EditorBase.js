// Общая основа редакторов организмов: вкладки групп генов, ползунки и переключатели,
// которые сразу перестраивают 3D-модель и пересчитывают биологические характеристики.
import { $, el, clear, slider, options, btn, sec } from './dom.js';
import { geneInt, setGeneInt, randomGenome, mutate } from '../life/GeneticsSystem.js';

export class GenomeEditor {
  /** cfg: {kind, table, groups, anims, templates(), summary(g), geneFmt, defaultName} */
  constructor(game, cfg) {
    this.game = game; this.cfg = cfg;
    this.root = $('#editor'); this.body = $('#ed-body'); this.tabs = $('#ed-tabs');
    this.sum = $('#ed-summary'); this.nameInp = $('#ed-name'); this.animBox = $('#ed-anim');
    this.g = null; this.tab = 'base'; this.dirty = false; this.active = false;
  }

  open(o = {}) {
    const cfg = this.cfg;
    this.species = o.species || null;
    this.g = Float32Array.from(o.genome || cfg.templates()[0].genome);
    this.onDone = o.onDone;
    this.nameInp.value = o.name || (this.species ? this.species.name : cfg.defaultName);
    this.active = true; this.tab = 'base';
    this.game.enterEditor(this);
    this.root.classList.remove('hidden');
    $('#ed-cancel').onclick = () => { this.game.audio.click(); this.close(); };
    $('#ed-save').onclick = () => this.finish();
    clear(this.animBox);
    (cfg.anims || []).forEach(([key, label], i) => {
      const b = el('button', { text: label, class: i === 0 ? 'on' : '' });
      b.onclick = () => { for (const c of this.animBox.children) c.classList.remove('on'); b.classList.add('on'); this.game.render.ed.anim = key; };
      this.animBox.append(b);
    });
    const rot = el('button', { text: '🔄', class: 'on' });
    rot.onclick = () => { const ed = this.game.render.ed; ed.auto = !ed.auto; rot.classList.toggle('on', ed.auto); };
    this.animBox.append(rot);
    const ed = this.game.render.ed; ed.anim = 'idle'; ed.auto = true; ed.userZoom = false; ed.pitch = 0.25;
    this.buildTabs(); this.renderTab(); this.rebuild(true);
    this.layout();
  }

  layout() {
    if (!this.active) return;
    const r = $('#ed-panel').getBoundingClientRect(), W = window.innerWidth, H = window.innerHeight;
    const side = r.width < W * 0.8;
    this.game.render.inset = side ? { bottom: 0, right: W - r.left } : { bottom: H - r.top, right: 0 };
    this.game.render.fitEditor();
  }

  close() {
    this.active = false;
    this.root.classList.add('hidden');
    this.game.render.inset = { bottom: 0, right: 0 };
    this.game.exitEditor();
  }

  buildTabs() {
    clear(this.tabs);
    const add = (k, label) => {
      const b = el('button', { class: 'tab' + (k === this.tab ? ' on' : ''), text: label });
      b.onclick = () => { this.tab = k; this.game.audio.click(); this.buildTabs(); this.renderTab(); };
      this.tabs.append(b);
    };
    add('base', '🧪 Основа');
    for (const gr of this.cfg.groups) add(gr.k, gr.icon + ' ' + gr.n);
  }

  renderTab() {
    const cfg = this.cfg, body = clear(this.body);
    body.scrollTop = 0;
    if (this.tab === 'base') {
      body.append(el('p', { class: 'mut', style: 'margin:6px 0 8px', text: 'Выберите заготовку и меняйте её на вкладках. Каждое изменение влияет на то, как организм живёт.' }));
      const grid = el('div', { class: 'grid2' });
      for (const t of cfg.templates()) {
        grid.append(el('button', { class: 'tile', onclick: () => { this.g = Float32Array.from(t.genome); if (!this.species) this.nameInp.value = t.name; this.game.audio.click(); this.game.render.ed.userZoom = false; this.rebuild(true); } },
          el('i', { text: t.icon || '🧬' }), el('span', { text: t.name })));
      }
      body.append(grid, el('div', { class: 'sp8' }), el('div', { class: 'row' },
        btn('🎲 Случайный', 'grow', () => { this.g = randomGenome(cfg.table); cfg.fixRandom && cfg.fixRandom(this.g); this.game.render.ed.userZoom = false; this.game.audio.click(); this.rebuild(true); }),
        btn('🧬 Мутация', 'grow', () => { mutate(this.g, cfg.table, 0.25, 0.12); this.game.audio.click(); this.rebuild(true); })));
      return;
    }
    for (const d of cfg.table) {
      if (d.grp !== this.tab) continue;
      if (cfg.visible && !cfg.visible(d, this.g)) continue;
      if (d.t === 'f') {
        const fmt = (cfg.geneFmt && cfg.geneFmt[d.k]) || ((v) => Math.round(v * 100) + '%');
        body.append(slider({ label: d.n, value: this.g[d.i], hint: d.hint, fmt, hue: /hue/i.test(d.k) && !(cfg.noHue || []).includes(d.k), onInput: (v) => { this.g[d.i] = v; this.rebuild(); } }));
      } else {
        const list = d.t === 'c' ? d.o : Array.from({ length: d.max - d.min + 1 }, (_, i) => String(d.min + i));
        const val = geneInt(this.g, d) - (d.t === 'i' ? d.min : 0);
        body.append(options(d.n, list, val, (i) => { setGeneInt(this.g, d, d.t === 'i' ? i + d.min : i); this.game.audio.click(); this.rebuild(false, d.rerender); }, d.hint));
      }
    }
  }

  /** Перестроить модель (не чаще раза за кадр) и сводку характеристик. */
  rebuild(now, rerender) {
    if (rerender) this.renderTab();
    if (now) { this.apply(); return; }
    if (this.dirty) return;
    this.dirty = true;
    requestAnimationFrame(() => { this.dirty = false; if (this.active) this.apply(); });
  }
  apply() {
    this.game.render.setEditorModel(this.cfg.kind, this.g);
    clear(this.sum);
    for (const s of this.cfg.summary(this.g)) this.sum.append(el('span', { class: s.cls || '', text: s.t }));
  }

  finish() {
    const game = this.game, name = (this.nameInp.value || '').trim() || this.cfg.defaultName;
    const g = Float32Array.from(this.g), sp = this.species;
    game.audio.click();
    if (sp && sp.pop > 0 && !sp.deleted) {
      game.ui.modal('Сохранить изменения', [el('p', { text: `Вид «${sp.name}» уже живёт в мире. Обновить его описание (новые особи будут создаваться по новому образцу) или создать отдельный вид?` })], [
        ['Обновить вид', 'primary', () => { game.sim.organisms.updateSpecies(sp, g, name); sp.thumbV = (sp.thumbV || 0) + 1; sp.custom = true; this.done(sp); }],
        ['Создать новый вид', '', () => this.done(this.create(g, name === sp.name ? name + ' II' : name))],
        ['Отмена', '', null],
      ]);
    } else this.done(this.create(g, name));
  }
  create(g, name) {
    const game = this.game;
    const sp = game.sim.organisms.createSpecies(this.cfg.kind, g, { name, custom: true });
    game.save.addToLibrary({ kind: this.cfg.kind, name, g: Array.from(g, (v) => Math.round(v * 1000) / 1000) });
    return sp;
  }
  done(sp) {
    this.close();
    if (this.onDone) this.onDone(sp); else this.game.ui.afterSpeciesCreated(sp);
  }
}
