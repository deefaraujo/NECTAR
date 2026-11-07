'use strict';
/* Interface languages. The source text is Brazilian Portuguese: each dictionary in /i18n/<id>.js
   maps the Portuguese phrase to its translation. t('Criar tarefa') and t('{n} notas', { n }) translate in code;
   an observer also translates fixed text that reaches the DOM ready-made (column names, server errors).
   Conversation and card content (.corpo, inputs, [data-no-i18n]) is never translated. */
(function () {
  const IDIOMAS = [
    { id: 'pt-BR', nome: 'Português (Brasil)', curto: 'PT' },
    { id: 'en', nome: 'English', curto: 'EN' },
    { id: 'es', nome: 'Español', curto: 'ES' },
    { id: 'fr', nome: 'Français', curto: 'FR' },
    { id: 'zh-CN', nome: '中文（简体）', curto: '中文' },
    { id: 'ja', nome: '日本語', curto: '日本語' },
    { id: 'ko', nome: '한국어', curto: '한국어' },
    { id: 'ru', nome: 'Русский', curto: 'RU' },
  ];
  const CHAVE = 'nectar:idioma';
  const valido = (id) => IDIOMAS.some((i) => i.id === id);
  let atual = 'en';
  // Default is English: it only changes when the user picks one in the header (the choice is saved on this computer).
  try { const s = localStorage.getItem(CHAVE); if (valido(s)) atual = s; } catch { /* no storage */ }

  window.I18N_DICT = window.I18N_DICT || {};
  // Loads the dictionary before the rest of the scripts (index.html includes this file first).
  if (atual !== 'pt-BR') document.write(`<script src="/i18n/${atual}.js"><\/script>`);
  document.documentElement.lang = atual;

  const dict = () => window.I18N_DICT[atual] || {};
  // Keys with variables ("Critérios de aceite {feito}/{total}") also translate text assembled by the server:
  // indexed by their fixed prefix, so we do not test hundreds of patterns on every node.
  let padroes = null;
  function porPadrao(k) {
    if (!padroes) {
      padroes = new Map();
      for (const [chave, tr] of Object.entries(dict())) {
        const i = chave.indexOf('{'); if (i < 3 || !/\{\w+\}/.test(chave)) continue;
        const nomes = []; const rx = new RegExp('^' + chave.split(/(\{\w+\})/).map((p) => { const m = /^\{(\w+)\}$/.exec(p); if (m) { nomes.push(m[1]); return '(.+?)'; } return p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }).join('') + '$');
        const ini = chave.slice(0, 3); if (!padroes.has(ini)) padroes.set(ini, []); padroes.get(ini).push({ rx, nomes, tr });
      }
    }
    for (const p of padroes.get(k.slice(0, 3)) || []) { const m = p.rx.exec(k); if (m) { const v = {}; p.nomes.forEach((n, i) => { v[n] = m[i + 1]; }); return trocar(p.tr, v); } }
    return null;
  }
  const trocar = (s, vars) => (vars ? s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m)) : s);
  function t(s, vars) { const k = String(s ?? ''); return trocar(dict()[k] ?? k, vars); }

  // Translation of fixed text that reaches the DOM without going through t(): only a whole phrase identical to a dictionary key.
  const PULAR = '.corpo, [data-no-i18n], textarea, input, [contenteditable], code, pre, script, style';
  const ATRIBUTOS = ['placeholder', 'title', 'aria-label', 'data-tip', 'alt'];
  // What has already been translated is not translated again: without this, a translation that is also a key (A→B, B→A) traps the page in a loop.
  const feitoTexto = new WeakMap(); const feitoAttr = new WeakMap();
  function traduzirTexto(no) {
    const v = no.nodeValue;
    if (feitoTexto.get(no) === v) return;
    const k = v.trim();
    if (!k) return;
    const tr = dict()[k] ?? porPadrao(k);
    if (tr && tr !== k) { const novo = v.replace(k, tr); feitoTexto.set(no, novo); no.nodeValue = novo; }
  }
  function traduzirEl(el) {
    // attributes (placeholder, title) of text fields translate too; only conversation and card content is left out
    if (!el.getAttribute || el.closest?.('.corpo, [data-no-i18n]')) return;
    const d = dict(); let f = feitoAttr.get(el);
    for (const a of ATRIBUTOS) {
      const v = el.getAttribute(a);
      if (!v || (f && f[a] === v)) continue;
      const tr = d[v.trim()] ?? porPadrao(v.trim());
      if (tr && tr !== v.trim()) { if (!f) feitoAttr.set(el, (f = {})); f[a] = tr; el.setAttribute(a, tr); }
    }
  }
  function percorrer(raiz) {
    if (raiz.nodeType === 3) { if (!raiz.parentElement?.closest(PULAR)) traduzirTexto(raiz); return; }
    if (raiz.nodeType !== 1) return;
    if (raiz.closest(PULAR)) { traduzirEl(raiz); return; }
    traduzirEl(raiz);
    const w = document.createTreeWalker(raiz, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => { if (n.nodeType === 1 && n.matches(PULAR)) { traduzirEl(n); return NodeFilter.FILTER_REJECT; } return NodeFilter.FILTER_ACCEPT; },
    });
    for (let n = w.nextNode(); n; n = w.nextNode()) (n.nodeType === 3 ? traduzirTexto(n) : traduzirEl(n));
  }
  function observar() {
    if (atual === 'pt-BR') return;
    percorrer(document.body);
    new MutationObserver((ms) => {
      for (const m of ms) {
        if (m.type === 'characterData') { if (!m.target.parentElement?.closest(PULAR)) traduzirTexto(m.target); }
        else if (m.type === 'attributes') traduzirEl(m.target);
        else m.addedNodes.forEach(percorrer);
      }
    }).observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATRIBUTOS });
    document.title = t(document.title);
  }

  // Header selector: switches, saves and reloads (the dictionary loads before the screen scripts).
  function seletor(alvo) {
    if (!alvo || alvo.querySelector('.idioma')) return;
    const sel = document.createElement('select');
    sel.className = 'idioma'; sel.setAttribute('aria-label', t('Idioma da interface')); sel.setAttribute('data-no-i18n', '');
    for (const i of IDIOMAS) { const o = document.createElement('option'); o.value = i.id; o.textContent = i.nome; if (i.id === atual) o.selected = true; sel.append(o); }
    sel.addEventListener('change', () => { try { localStorage.setItem(CHAVE, sel.value); } catch { /* no storage */ } fetch('/api/config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ idioma: sel.value }) }).catch(() => {}).finally(() => location.reload()); });
    alvo.append(sel);
  }

  window.I18N = { idiomas: IDIOMAS, get atual() { return atual; }, locale: atual, t, seletor, percorrer };
  window.t = t;
  document.addEventListener('DOMContentLoaded', () => { seletor(document.querySelector('[data-idioma]')); observar(); });
})();
