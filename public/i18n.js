'use strict';
/* Idiomas da interface. O texto-fonte é o português do Brasil: cada dicionário em /i18n/<id>.js
   mapeia a frase em português para a tradução. t('Criar tarefa') e t('{n} notas', { n }) traduzem no código;
   um observador traduz também o texto fixo que chega pronto ao DOM (nomes de coluna, erros do servidor).
   Conteúdo de conversa e de cards (.corpo, inputs, [data-no-i18n]) nunca é traduzido. */
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
  // Padrão é o inglês: só muda quando a pessoa escolhe no cabeçalho (a escolha fica salva neste computador).
  try { const s = localStorage.getItem(CHAVE); if (valido(s)) atual = s; } catch { /* sem armazenamento */ }

  window.I18N_DICT = window.I18N_DICT || {};
  // Carrega o dicionário antes do resto dos scripts (o index.html inclui este arquivo primeiro).
  if (atual !== 'pt-BR') document.write(`<script src="/i18n/${atual}.js"><\/script>`);
  document.documentElement.lang = atual;

  const dict = () => window.I18N_DICT[atual] || {};
  // Chaves com variáveis ("Critérios de aceite {feito}/{total}") também traduzem texto montado pelo servidor:
  // indexadas pelo começo fixo, para não testar centenas de padrões em cada nó.
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

  // Tradução do texto fixo que chega ao DOM sem passar por t(): só frase inteira idêntica a uma chave do dicionário.
  const PULAR = '.corpo, [data-no-i18n], textarea, input, [contenteditable], code, pre, script, style';
  const ATRIBUTOS = ['placeholder', 'title', 'aria-label', 'data-tip', 'alt'];
  // O que já foi traduzido não é traduzido de novo: sem isto, uma tradução que também é chave (A→B, B→A) prende a página num laço.
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
    // atributos (placeholder, title) de campos de texto também traduzem; só o conteúdo de conversa e card fica de fora
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

  // Seletor no cabeçalho: troca, guarda e recarrega (o dicionário entra antes dos scripts da tela).
  function seletor(alvo) {
    if (!alvo || alvo.querySelector('.idioma')) return;
    const sel = document.createElement('select');
    sel.className = 'idioma'; sel.setAttribute('aria-label', t('Idioma da interface')); sel.setAttribute('data-no-i18n', '');
    for (const i of IDIOMAS) { const o = document.createElement('option'); o.value = i.id; o.textContent = i.nome; if (i.id === atual) o.selected = true; sel.append(o); }
    sel.addEventListener('change', () => { try { localStorage.setItem(CHAVE, sel.value); } catch { /* sem armazenamento */ } fetch('/api/config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ idioma: sel.value }) }).catch(() => {}).finally(() => location.reload()); });
    alvo.append(sel);
  }

  window.I18N = { idiomas: IDIOMAS, get atual() { return atual; }, locale: atual, t, seletor, percorrer };
  window.t = t;
  document.addEventListener('DOMContentLoaded', () => { seletor(document.querySelector('[data-idioma]')); observar(); });
})();
