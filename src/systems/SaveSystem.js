// SaveSystem — сохранение миров, настроек, прогресса сценариев и библиотеки видов
// в localStorage. Игру можно продолжить после закрытия браузера.
const P = 'evosphere.';

export class SaveSystem {
  constructor() { this.slots = ['auto', '1', '2', '3']; this.lastError = ''; }

  get(key, def) {
    try { const v = localStorage.getItem(P + key); return v === null ? def : JSON.parse(v); } catch (e) { return def; }
  }
  set(key, val) {
    try { localStorage.setItem(P + key, JSON.stringify(val)); return true; }
    catch (e) { this.lastError = String(e && e.name || e); return false; }
  }
  del(key) { try { localStorage.removeItem(P + key); } catch (e) { /* нет доступа к хранилищу */ } }

  /** Сохранить мир в слот. Возвращает true при успехе. */
  saveWorld(slot, sim, extra = {}) {
    const cl = sim.climate, org = sim.organisms;
    const meta = {
      name: sim.world.params.name || 'Мир', date: Date.now(), when: cl.dateString(),
      animals: org.creatures.length, plants: org.plants.length, species: org.aliveSpecies().length,
      scenario: sim.scenario ? sim.scenario.def.id : null,
    };
    const data = sim.serialize(); data.extra = extra;
    let str;
    try { str = JSON.stringify(data); } catch (e) { return false; }
    try { localStorage.setItem(P + 'save.' + slot, str); }
    catch (e) {
      // хранилище переполнено: освобождаем автосохранение и пробуем ещё раз
      this.lastError = 'Недостаточно места в хранилище браузера';
      if (slot !== 'auto') { this.del('save.auto'); this.del('meta.auto'); try { localStorage.setItem(P + 'save.' + slot, str); } catch (e2) { return false; } }
      else return false;
    }
    this.set('meta.' + slot, meta);
    return true;
  }
  loadWorld(slot) {
    try { const s = localStorage.getItem(P + 'save.' + slot); return s ? JSON.parse(s) : null; } catch (e) { return null; }
  }
  meta(slot) { return this.get('meta.' + slot, null); }
  removeWorld(slot) { this.del('save.' + slot); this.del('meta.' + slot); }

  settings() { return Object.assign({ quality: 'auto', sound: true, music: true, autosave: true }, this.get('settings', {})); }
  saveSettings(s) { this.set('settings', s); }

  scenariosDone() { return this.get('scenarios', []); }
  markScenario(id) { const d = this.scenariosDone(); if (!d.includes(id)) { d.push(id); this.set('scenarios', d); } }

  /** Библиотека созданных игроком видов — доступна во всех мирах. */
  library() { return this.get('library', []); }
  addToLibrary(item) {
    const lib = this.library().filter((x) => !(x.name === item.name && x.kind === item.kind));
    lib.unshift(item); if (lib.length > 60) lib.length = 60;
    this.set('library', lib);
  }
  removeFromLibrary(name, kind) { this.set('library', this.library().filter((x) => !(x.name === name && x.kind === kind))); }

  /** Экспорт мира в файл и импорт из файла. */
  exportWorld(slot) {
    const s = this.loadWorld(slot); if (!s) return false;
    const json = JSON.stringify({ evosphere: 1, meta: this.meta(slot), data: s });
    const fname = `evosphere-${(this.meta(slot) || {}).name || 'world'}.json`;
    // в Android-приложении файл сохраняется через системный диалог
    if (window.AndroidBridge && window.AndroidBridge.saveFile) { window.AndroidBridge.saveFile(fname, json); return true; }
    const blob = new Blob([json], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = fname;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    return true;
  }
  importWorld(file) {
    return file.text().then((t) => { const o = JSON.parse(t); if (!o || !o.evosphere || !o.data || !o.data.params) throw new Error('bad'); return o.data; });
  }
}
