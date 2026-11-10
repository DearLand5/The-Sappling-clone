// Небольшие помощники для построения интерфейса.
export const $ = (s, r = document) => r.querySelector(s);

export function el(tag, props = {}, ...kids) {
  const e = document.createElement(tag);
  for (const k in props) {
    const v = props[k];
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k === 'html') e.innerHTML = v;
    else if (k === 'text') e.textContent = v;
    else if (k === 'style') e.style.cssText = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat()) { if (c === null || c === undefined || c === false) continue; e.append(c.nodeType ? c : document.createTextNode(String(c))); }
  return e;
}
export function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); return node; }
export const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export function slider(o) {
  const fmt = o.fmt || ((v) => Math.round(v * 100) + '%');
  const em = el('em', { text: fmt(o.value) });
  const inp = el('input', { type: 'range', min: o.min ?? 0, max: o.max ?? 1, step: o.step ?? 0.01, class: o.hue ? 'hue' : '' });
  inp.value = o.value;
  inp.addEventListener('input', () => { const v = +inp.value; em.textContent = fmt(v); o.onInput(v); });
  if (o.onChange) inp.addEventListener('change', () => o.onChange(+inp.value));
  const d = el('div', { class: 'ctl' }, el('label', {}, el('span', { text: o.label }), em), inp, o.hint ? el('small', { text: o.hint }) : null);
  d.set = (v) => { inp.value = v; em.textContent = fmt(v); };
  return d;
}

export function toggle(label, value, onChange, hint) {
  const b = el('button', { class: value ? 'on' : '', 'aria-label': label });
  b.addEventListener('click', () => { const v = !b.classList.contains('on'); b.classList.toggle('on', v); onChange(v); });
  return el('div', { class: 'sw' }, el('div', {}, el('div', { text: label }), hint ? el('div', { class: 'mut', text: hint }) : null), b);
}

export function options(label, list, value, onChange, hint) {
  const wrap = el('div', { class: 'opts' });
  list.forEach((name, i) => {
    const b = el('button', { class: 'opt' + (i === value ? ' on' : ''), text: name });
    b.addEventListener('click', () => { for (const c of wrap.children) c.classList.remove('on'); b.classList.add('on'); onChange(i); });
    wrap.append(b);
  });
  return el('div', { class: 'ctl' }, label ? el('label', {}, el('span', { text: label })) : null, wrap, hint ? el('small', { text: hint }) : null);
}

export const kv = (k, v) => el('div', { class: 'kv' }, el('span', { text: k }), el('span', { text: v }));
export function bar(cls, frac) { const i = el('i'); i.style.width = Math.round(Math.max(0, Math.min(1, frac)) * 100) + '%'; return el('div', { class: 'bar ' + cls }, i); }
export const btn = (text, cls, onclick) => el('button', { class: 'btn ' + (cls || ''), text, onclick });
export const sec = (text) => el('div', { class: 'sec', text });

/** Цвет вида для графиков и карты. */
export function spColor(sp, a = 1) {
  const h = (sp.id * 0.61803398875) % 1, k = sp.kind === 'c' ? 62 : 45;
  return `hsla(${Math.round(h * 360)},${sp.kind === 'c' ? 78 : 55}%,${k}%,${a})`;
}

export function fitCanvas(cv, hCss) {
  const dpr = Math.min(2, window.devicePixelRatio || 1), w = cv.clientWidth || 300;
  cv.style.height = hCss + 'px'; cv.width = Math.round(w * dpr); cv.height = Math.round(hCss * dpr);
  const ctx = cv.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, w, h: hCss };
}
