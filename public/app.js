'use strict';
/* Game Studio AI: uma equipe de agentes que conversa no chat (formato Discord), mantém o planner
   (formato Jira) e guarda o que aprende em memória. Cada projeto é uma pasta, com tudo próprio.
   Sem framework: E guarda o que é do app, PJ o que é de cada projeto e U o que é da tela. */

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// O elenco é do projeto aberto (cada projeto tem o seu template de agentes); sem projeto, vale o padrão.
const E = {
  _roster: [], templates: [], marca: { nome: 'WORK.', sufixo: 'IA' }, colunas: [], config: {}, projetos: [], ativo: null, perguntas: [], uso: null, pausas: {},
  get roster() { return (typeof PJ !== 'undefined' && typeof U !== 'undefined' && PJ[U.proj]?.roster) || this._roster; },
  set roster(v) { this._roster = v; },
};
const PJ = {};
const VAZIO = { cartoes: [], wip: {}, presenca: {}, perguntas: [], canais: {}, naoLidas: {}, bastidores: [], memoria: {} };
const U = {
  vista: 'chat', canal: 'equipe', proj: null, membros: true, rascunhos: {},
  filtro: new Set(), busca: '', soBloq: false, visao: 'quadro', todosConcluidos: false,
  issue: null, abaAtiv: 'comentarios', ajuste: 'motores', troca: null, inbox: false,
  memSel: null, memBusca: '', memDados: null, usoMotor: 'claude',
};

const J = () => PJ[U.proj] || VAZIO;
const P = (rota, id = U.proj) => `/api/p/${id}${rota}`;
// Equipes dentro do projeto: U.proj é o id da EQUIPE aberta ("projeto" ou "projeto__equipe"); o projeto é a parte antes de "__".
const baseDe = (cid) => String(cid || '').split('__')[0];
const equipesDoProjeto = (p) => (p?.equipes?.length ? p.equipes : [{ id: 'principal', cid: p?.id, nome: p?.templateNome || 'Equipe', template: p?.template }]);
const todasEquipes = () => E.projetos.flatMap((p) => equipesDoProjeto(p).map((e) => ({ ...e, projeto: p })));
// A equipe de avaliação de agentes de código tem entrada própria no trilho: abre direto a aba Avaliações (temas, repositórios, tarefas).
const equipeAvaliacao = () => todasEquipes().find((e) => e.template === 'avaliacao-agentes') || null;
const equipeDe = (cid) => todasEquipes().find((e) => e.cid === cid) || null;
const projetoAtual = () => E.projetos.find((p) => p.id === baseDe(U.proj)) || null;
const equipeAtual = () => equipeDe(U.proj);
const ultimaEquipe = (pid) => { try { const c = localStorage.getItem('eq:' + pid); if (c && equipeDe(c)) return c; } catch { /* sem armazenamento */ } return pid; };
const lembrarEquipe = (cid) => { try { localStorage.setItem('eq:' + baseDe(cid), cid); } catch { /* sem armazenamento */ } };
const rosterAtual = () => (U.proj && PJ[U.proj]?.roster) || E.roster;   // o elenco da equipe aberta (cada equipe tem o seu)
const liderAtual = () => J().lider || 'po';
// "ext:<agente>@<equipe>" é alguém de outra equipe do projeto: o perfil (foto, estilo, nome) é o mesmo da equipe dele
const externoDe = (id) => { const m = /^ext:([^@]+)@(.+)$/.exec(String(id || '')); if (!m) return null; const x = (J().externos || []).find((e) => e.agente === m[1] && e.cid === m[2]); return x ? { id, nome: x.nome, cargo: `${x.cargo} (${x.equipe})`, papel: x.papel, cor: x.cor, foto: x.foto, capa: x.capa, estilo: x.estilo || {}, equipe: x.equipe, externo: true } : null; };
const agente = (id) => rosterAtual().find((a) => a.id === id) || externoDe(id);
const rosterDaEquipe = () => rosterAtual();
// Agentes GERAIS (assessor, memorizador, MCP, Créditos): os mesmos em toda equipe e projeto, numa categoria própria da lista.
// Quem a equipe não tem (o assessor fora da Assessoria) aparece pelo perfil da equipe dele e abre a conversa lá.
const ORDEM_GERAIS = ['assessor', 'memorizador', 'mcp', 'creditos'];
const gerais = () => ORDEM_GERAIS.map((k) => rosterAtual().find((a) => a.geral === k) || (J().externos || []).find((x) => x.geral === k)).filter(Boolean);
const cartao = (id) => J().cartoes.find((c) => c.id === id);
const nomeColuna = (id) => (E.colunas.find((c) => c.id === id) || {}).nome || id;
const usuarioDe = () => J().usuario || { id: 'voce', nome: 'Você', foto: null, cargo: '', papel: 'Quem lidera o trabalho', cor: '#E2A226' };
const templateId = () => (J().template && typeof J().template === 'object' ? J().template.id : J().template);   // /estado manda o template como objeto
const nomeAgente = (id) => (id === 'voce' ? usuarioDe().nome : id === 'sistema' ? 'Sistema' : (agente(id) || { nome: id }).nome);
const nomeCanal = (canal) => (canal === 'equipe' || canal === 'bastidores' ? I18N.t(canal) : canal.startsWith('plan-') ? ((J().planning || []).find((p) => p.canal === canal) || {}).titulo || canal : canal.startsWith('grp-') ? ((J().grupos || []).find((g) => g.canal === canal) || {}).titulo || canal : (agente(canal.slice(3)) || {}).nome || canal);

/* ------------------------------------------------------------ utilidades */
async function api(metodo, url, corpo) {
  if (corpo === undefined && metodo !== 'GET') corpo = {};   // o servidor só aceita POST/PUT/DELETE com JSON; sem isto, "use application/json"
  const r = await fetch(url, {
    method: metodo,
    headers: corpo !== undefined ? { 'Content-Type': 'application/json' } : {},
    body: corpo !== undefined ? JSON.stringify(corpo) : undefined,
  });
  const j = await r.json().catch(() => ({}));
  return Array.isArray(j) ? Object.assign(j, { _status: r.status, _ok: r.ok }) : { ...j, _status: r.status, _ok: r.ok };
}
const hhmm = (iso) => new Date(iso).toLocaleTimeString(I18N.locale, { hour: '2-digit', minute: '2-digit' });
function diaTxt(iso) {
  const d = new Date(iso); const h = new Date();
  const ontem = new Date(h); ontem.setDate(h.getDate() - 1);
  if (d.toDateString() === h.toDateString()) return 'Hoje';
  if (d.toDateString() === ontem.toDateString()) return 'Ontem';
  return d.toLocaleDateString(I18N.locale, { weekday: 'long', day: 'numeric', month: 'long' });
}
function idade(iso) {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return 'agora';
  if (s < 3600) return `${Math.floor(s / 60)} min`;
  if (s < 86400) return `${Math.floor(s / 3600)} h`;
  return `${Math.floor(s / 86400)} d`;
}
const ha = (iso) => (idade(iso) === 'agora' ? 'agora' : I18N.t('há {tempo}', { tempo: idade(iso) }));
const mmss = (ms) => { const s = Math.max(0, Math.floor(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
function aviso(texto, ms = 4500) {
  const el = document.createElement('div');
  el.className = 'aviso'; el.textContent = texto;
  $('#avisos').append(el);
  setTimeout(() => el.remove(), ms);
}
const copiarTexto = (t) => navigator.clipboard?.writeText(t).then(() => aviso(I18N.t('Copiado.'), 1500)).catch(() => {});
const matiz = (id) => { let h = 0; for (const c of String(id)) h = (h * 31 + c.charCodeAt(0)) % 360; return h; };
const iniciais = (n) => String(n).split(/[\s\-_.]+/).filter(Boolean).slice(0, 2).map((s) => s[0]).join('').toUpperCase() || '?';

// Quem a mensagem marca como a Game Director (o mesmo que o servidor entende).
// As marcações que chamam a Game Director: os apelidos de sempre e o primeiro nome que ela escolheu.
const reUsuario = () => {
  const n = semAcento(primeiroNome(usuarioDe().nome)).replace(/[^a-z0-9]/g, '');
  return new RegExp(`@\\s*(?:game\\s*director|gamedirector|gd|diretor|diretora|director|voc[eê]|vc${n ? `|${n}` : ''})\\b`, 'gi');
};
const mencionaVoce = (t) => reUsuario().test(String(t || ''));

/* Markdown mínimo e seguro: escapa tudo antes de formatar. */
function md(txt) {
  let t = esc(txt);
  const blocos = [];
  t = t.replace(/```(?:\w+)?\n?([\s\S]*?)```/g, (_, c) => { blocos.push(c.replace(/\n$/, '')); return `§BLOCO${blocos.length - 1}§`; });
  t = t.replace(/`([^`\n]+)`/g, '<code>$1</code>');
  // [texto](url): link da web vira link; caminho do computador vira só o texto (o arquivo vai como anexo da mensagem)
  t = t.replace(/\[([^\]\n]{1,200})\]\((?:&lt;)?([^)\s]+?|[^)\n]+?)(?:&gt;)?\)/g, (_, rot, url) => (/^https?:\/\//i.test(url) ? `<a href="${url}" target="_blank" rel="noopener">${rot}</a>` : rot));
  t = t.replace(/\[gif:\s*([^\]\n]{1,80})\]/gi, (_, q) => `<img class="gif-com" loading="lazy" src="/api/gif?q=${encodeURIComponent(q.trim())}" alt="GIF: ${q.trim()}">`);
  t = t.replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>');
  t = t.replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s).,;:!?]|$)/g, '$1<i>$2</i>');
  t = t.replace(/\b([A-Z]{1,8}-\d{1,3})\b/g, (m) => (cartao(m) ? `<a class="ref" data-issue="${m}">${m}</a>` : m));
  t = t.replace(reUsuario(), (m) => `<span class="mencao voce">${m.replace(/\s+/g, ' ')}</span>`);
  t = t.replace(/@(?:P\.O\.|UI\/UX|Game Feel|Visual Novel)/g, (m) => `<span class="mencao">${m}</span>`);
  t = t.replace(/(^|\s)@([\p{L}_]+)/gu, '$1<span class="mencao">@$2</span>');
  const saida = []; let modo = null;
  const fecha = () => { if (modo) { saida.push(`</${modo}>`, '<!--p-->'); modo = null; } };
  const linhas = t.split('\n');
  const ehLinhaTabela = (l) => /^\s*\|.*\|\s*$/.test(l || '');
  const ehSepTabela = (l) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(l || '') && /-/.test(l || '') && /\|/.test(l || '');
  for (let i = 0; i < linhas.length; i++) {
    const ln = linhas[i];
    if (ehLinhaTabela(ln) && ehSepTabela(linhas[i + 1])) {
      fecha();
      const cel = (l) => l.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
      const cab = cel(ln); const corpoT = []; i += 2;
      while (i < linhas.length && ehLinhaTabela(linhas[i])) { corpoT.push(cel(linhas[i])); i++; }
      i--;
      saida.push('<!--p-->', `<table class="md-t"><thead><tr>${cab.map((c) => `<th>${c}</th>`).join('')}</tr></thead><tbody>${corpoT.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table>`, '<!--p-->');
      continue;
    }
    const cit = /^\s*(?:&gt;|>)\s?(.*)$/.exec(ln);
    if (cit) {
      fecha();
      const q = [cit[1]];
      while (i + 1 < linhas.length && /^\s*(?:&gt;|>)\s?(.*)$/.test(linhas[i + 1])) { i++; q.push(/^\s*(?:&gt;|>)\s?(.*)$/.exec(linhas[i])[1]); }
      saida.push('<!--p-->', `<blockquote class="md-call">${q.join('<br>')}</blockquote>`, '<!--p-->');
      continue;
    }
    const li = /^\s*[-*]\s+(.*)$/.exec(ln);
    const ol = /^\s*\d+[.)]\s+(.*)$/.exec(ln);
    const h = /^(#{1,3})\s+(.*)$/.exec(ln);
    if (/^\s*(-{3,}|\*{3,})\s*$/.test(ln)) { fecha(); saida.push('<!--p-->', '<hr>', '<!--p-->'); continue; }
    if (li || ol) {
      const quer = li ? 'ul' : 'ol';
      if (modo !== quer) { fecha(); saida.push('<!--p-->', `<${quer}>`); modo = quer; }
      const txt = (li || ol)[1];
      const tk = /^\[( |x|X)\]\s+(.*)$/.exec(txt);
      saida.push(tk ? `<li class="tarefa ${tk[1] === ' ' ? '' : 'feito'}"><span class="cx">${tk[1] === ' ' ? '☐' : '☑'}</span> ${tk[2]}</li>` : `<li>${txt}</li>`);
      continue;
    }
    fecha();
    if (h) saida.push('<!--p-->', `<h${h[1].length}>${h[2]}</h${h[1].length}>`, '<!--p-->');
    else saida.push(ln.trim() === '' ? '<!--p-->' : ln);
  }
  fecha();
  const html = saida.join('\n').split('<!--p-->').map((p) => p.trim()).filter(Boolean)
    .map((p) => (/^<(ul|ol|h\d|table|blockquote|hr)/.test(p) ? p : `<p>${p.replace(/\n/g, '<br>')}</p>`)).join('');
  return html.replace(/§BLOCO(\d+)§/g, (_, i) => `</p><pre><code>${blocos[i]}</code></pre><p>`).replace(/<p><\/p>/g, '');
}
// Esconde o bloco de ações, inclusive enquanto ele ainda está chegando (a cerca vem aos pedaços).
function limparBloco(t) {
  t = t.replace(/```studio-actions[\s\S]*?```/g, '');
  const i = t.indexOf('```studio-actions');
  if (i >= 0) t = t.slice(0, i);
  const m = /`{1,3}([a-z-]{0,14})$/.exec(t);
  if (m && 'studio-actions'.startsWith(m[1])) t = t.slice(0, m.index);
  return t.trim();
}

/* ------------------------------------------------------------ ícones (linha, 24x24) */
const IC = {
  hash: '<path d="M4 9h16M4 15h16M10 3 8 21M16 3l-2 18"/>',
  chat: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
  quadro: '<rect x="3" y="3" width="5" height="18" rx="1.5"/><rect x="10" y="3" width="5" height="11" rx="1.5"/><rect x="17" y="3" width="4" height="14" rx="1.5"/>',
  engrenagem: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  enviar: '<path d="m22 2-7 20-4-9-9-4z"/><path d="M22 2 11 13"/>',
  parar: '<rect x="6" y="6" width="12" height="12" rx="2"/>',
  fone: '<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.6a2 2 0 0 1-.5 2.1L8 9.7a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.8.3 1.7.5 2.6.7a2 2 0 0 1 1.7 2z"/>',
  arquivo: '<path d="M3 7h18v3H3zM5 10v9h14v-9M10 14h4"/>',
  mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>',
  micOff: '<path d="M15 9.3V6a3 3 0 0 0-5.9-.8M9 9v2a3 3 0 0 0 5.1 2.1M5 11a7 7 0 0 0 11.6 5.3M19 11a7 7 0 0 1-.5 2.6M12 18v3M3 3l18 18"/>',
  tela: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>',
  minimizar: '<path d="m6 9 6 6 6-6"/>',
  maximizar: '<path d="m6 15 6-6 6 6"/>',
  texto: '<path d="M21 12a8 8 0 0 1-11.6 7.2L4 21l1.8-5.4A8 8 0 1 1 21 12z"/>',
  lista: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
  calendario: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/>',
  colmeia: '<path d="M8.5 3h7l3.5 6-3.5 6h-7L5 9z"/><path d="M12 15v6M5 9H2M22 9h-3"/>',
  setaE: '<path d="m15 18-6-6 6-6"/>',
  setaD: '<path d="m9 18 6-6-6-6"/>',
  vassoura: '<path d="M14 4l6 6M12 6l6 6-5 5H9l-3 3-2-2 3-3V11z"/>',
  rosto: '<circle cx="12" cy="12" r="9"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><path d="M9 9h.01M15 9h.01"/>',
  menos: '<path d="M5 12h14"/>',
  mais: '<path d="M12 5v14M5 12h14"/>',
  fechar: '<path d="M18 6 6 18M6 6l12 12"/>',
  busca: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>',
  setaB: '<path d="m6 9 6 6 6-6"/>',
  setaD: '<path d="m9 18 6-6-6-6"/>',
  usuarios: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8"/>',
  copiar: '<rect x="8" y="8" width="13" height="13" rx="2"/><path d="M4 16V5a2 2 0 0 1 2-2h11"/>',
  bandeira: '<path d="M4 22V4M4 4h13l-2 4 2 4H4"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  checkq: '<path d="m9 11 3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>',
  prioAlta: '<path d="m17 11-5-5-5 5M17 18l-5-5-5 5"/>',
  prioMedia: '<path d="M5 9h14M5 15h14"/>',
  prioBaixa: '<path d="m7 7 5 5 5-5M7 13l5 5 5-5"/>',
  lixo: '<path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14M10 11v5M14 11v5"/>',
  usuario: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  alerta: '<path d="M12 3 2 20h20z"/><path d="M12 10v4M12 17.5v.5"/>',
  sino: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
  cadeado: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  pasta: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  memoria: '<rect x="2" y="3" width="20" height="5" rx="1"/><path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8M10 12h4"/>',
  relogio: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  /* um glifo por agente */
  bussola: '<circle cx="12" cy="12" r="9.5"/><path d="m15.8 8.2-2 5.6-5.6 2 2-5.6z"/>',
  pena: '<path d="M20 4c-8 0-13 4-13 11l-3 5 5-3c7 0 11-5 11-13z"/><path d="M8 16 16 8"/>',
  dialogos: '<path d="M14 9a2 2 0 0 1-2 2H6l-4 4V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2z"/><path d="M18 9h2a2 2 0 0 1 2 2v11l-4-4h-6a2 2 0 0 1-2-2v-1"/>',
  livro: '<path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>',
  ficha: '<path d="M3 10h18v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z"/><path d="M3 10l2-6h14l2 6M8 4l2 6M13 4l2 6"/>',
  blocos: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/>',
  codigo: '<path d="m16 18 6-6-6-6M8 6l-6 6 6 6"/>',
  layout: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/>',
  imagem: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21"/>',
  raio: '<path d="M13 2 3 14h9l-1 8 10-12h-9z"/>',
  clipe: '<path d="m21.4 11-9.2 9.2a5.5 5.5 0 0 1-7.8-7.8l9.2-9.2a3.7 3.7 0 0 1 5.2 5.2l-9.2 9.2a1.8 1.8 0 0 1-2.6-2.6l8.5-8.5"/>',
  banco: '<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/>',
  globo: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
  servidor: '<rect x="3" y="4" width="18" height="6" rx="2"/><rect x="3" y="14" width="18" height="6" rx="2"/><path d="M7 7h.01M7 17h.01"/>',
  fluxo: '<circle cx="6" cy="6" r="3"/><circle cx="18" cy="18" r="3"/><path d="M9 6h4a4 4 0 0 1 4 4v5"/>',
  plug: '<path d="M9 2v6M15 2v6M6 8h12v4a6 6 0 0 1-12 0zM12 18v4"/>',
  escudo: '<path d="M20 13c0 5-3.5 7.5-7.7 9a1 1 0 0 1-.6 0C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.2-2.7a1.2 1.2 0 0 1 1.6 0C14.5 3.8 17 5 19 5a1 1 0 0 1 1 1z"/><path d="m9 12 2 2 4-4"/>',
};
const GLIFO = new Proxy({}, { get: (_, id) => (typeof id === 'string' ? agente(id)?.glifo : undefined) });
// Avatares da própria ferramenta (ilustrações da marca em public/marca/avatares). Agente sem foto recebe um deles,
// sempre o mesmo para o mesmo id (variado entre os agentes); no editor de perfil dá para escolher qualquer um ou subir do PC.
const AVATARES = 11;
const avatarUrl = (n) => `/marca/avatares/${String(n).padStart(2, '0')}.png`;
const avatarPadrao = (id) => { let h = 0; for (const ch of String(id)) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return avatarUrl(1 + (h % AVATARES)); };
const ic = (n, cls = '') => `<svg class="ic ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round">${IC[n] || ''}</svg>`;
// o símbolo da marca (favo de mel): imagem do guia da identidade, em public/marca
const logo = (t = 24) => `<img class="logo" src="/marca/nectar-mark.png" alt="" width="${t}" height="${t}" style="width:${t}px;height:${t}px" draggable="false">`;
const COR_COL = { backlog: '#8C98AF', pronto: '#6C9BFF', andamento: '#F3AA3C', impedimento: '#EF5B5B', revisao: '#A58BF5', qa: '#2DC4A8', concluido: '#34D399' };
// Modelos e níveis de esforço que o Claude Code desta conta aceita (testados na máquina).
const MODELOS_CLAUDE = [['', 'Padrão do Claude Code'], ['claude-haiku-4-5', 'Haiku 4.5'], ['claude-haiku-5-5', 'Haiku 5.5'], ['claude-sonnet-4-6', 'Sonnet 4.6'], ['claude-sonnet-5', 'Sonnet 5'], ['claude-sonnet-5-5', 'Sonnet 5.5'], ['claude-opus-5', 'Opus 5'], ['claude-opus-5-5', 'Opus 5.5']];
const ESFORCOS = [['', 'Padrão do modelo'], ['low', 'Low'], ['medium', 'Medium'], ['high', 'High'], ['xhigh', 'Extra alto (xhigh)'], ['max', 'Max']];
const ESFORCOS_CODEX = [['', 'Padrão do modelo'], ['low', 'Low'], ['medium', 'Medium'], ['high', 'High'], ['xhigh', 'Extra alto (xhigh)'], ['max', 'Max'], ['ultra', 'Ultra (só em alguns modelos)']];
const NOME_MODELO = { 'claude-haiku-4-5': 'Haiku 4.5', 'claude-haiku-5-5': 'Haiku 5.5', 'claude-sonnet-4-6': 'Sonnet 4.6', 'claude-sonnet-5': 'Sonnet 5', 'claude-sonnet-5-5': 'Sonnet 5.5', 'claude-opus-5': 'Opus 5', 'claude-opus-5-5': 'Opus 5.5' };
const PONTOS = [1, 2, 3, 5, 8, 13];
const MENCOES = new Proxy({}, { get: (_, id) => (typeof id === 'string' ? (agente(id)?.tokenNome || agente(id)?.token || id) : undefined) });
const semAcento = (x) => String(x).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const primeiroNome = (n) => String(n).trim().split(/\s+/)[0];

/* ------------------------------------------------------------ avatares */
/* ---- campo de mensagem: botões Modelo e Modo (listas) e painel de emoji ---- */
const SELETORES = {
  motor: { rot: 'Modelo', atual: () => E.config.engine, opcoes: [['claude', 'Claude', 'Claude Code, da Anthropic'], ['codex', 'Codex', 'Codex, da OpenAI (ChatGPT)']] },
  modo: { rot: 'Modo', atual: () => E.config.modo, opcoes: [['conversar', 'Planejar', 'O time analisa e conversa; só executa o que você já autorizou'], ['trabalhar', 'Executar', 'O time edita arquivos do projeto e executa o trabalho']] },
};
const nomeModo = (v) => (v === 'trabalhar' ? 'Executar' : 'Planejar');
function seletorHtml(k) {
  const d = SELETORES[k], atual = d.opcoes.find(([v]) => v === d.atual()) || d.opcoes[0];
  return `<button class="sel-btn ${k === 'modo' && atual[0] === 'trabalhar' ? 'exec' : ''}" data-acao="sel-abrir" data-sel="${k}" title="${I18N.t(d.rot)}: ${esc(I18N.t(atual[2]))}"><span class="sel-rot">${d.rot}</span><b>${atual[1]}</b>${ic('setaB')}</button>`;
}
function fecharPops() { $('#sel-menu')?.remove(); $('#emoji-pop')?.remove(); }
function posicionarAcima(el, ancora) {
  const r = ancora.getBoundingClientRect(), w = el.offsetWidth;
  el.style.left = `${Math.max(8, Math.min(innerWidth - w - 8, r.left))}px`;
  el.style.bottom = `${innerHeight - r.top + 8}px`;
}
function abrirSeletor(k, ancora) {
  const aberto = $('#sel-menu')?.dataset.sel === k; fecharPops(); if (aberto) return;
  const d = SELETORES[k], atual = d.atual();
  const m = document.createElement('div'); m.id = 'sel-menu'; m.className = 'sel-menu'; m.dataset.sel = k;
  m.innerHTML = `<div class="ctx-tit">${d.rot}</div>${d.opcoes.map(([v, nome, desc]) => `<button data-${k}="${v}" class="${v === atual ? 'on' : ''}"><span><b>${nome}</b><small>${esc(desc)}</small></span>${v === atual ? ic('check') : ''}</button>`).join('')}`;
  document.body.appendChild(m); posicionarAcima(m, ancora);
}
function atualizarSeletores() { for (const k of ['motor', 'modo']) { const b = $(`.sel-btn[data-sel="${k}"]`); if (b) b.outerHTML = seletorHtml(k); } }

const EMOJIS = {
  'Rostos': '😀 😃 😄 😁 😆 😅 😂 🤣 🥲 😊 😇 🙂 🙃 😉 😌 😍 🥰 😘 😋 😛 😜 🤪 🤨 🧐 🤓 😎 🥳 🤩 😏 😒 😞 😔 😟 😕 🙁 😣 😖 😫 😩 🥺 😢 😭 😤 😠 😡 🤬 🤯 😳 🥵 🥶 😱 😨 😰 😥 😓 🤗 🤔 🫡 🤭 🤫 🫠 😶 😐 😑 😬 🙄 😯 😮 😲 🥱 😴 🤤 😵 🥴 🤢 🤧 😷 🤒 🤑 😈 🤡 💩 👻 💀 👽 🤖',
  'Gestos': '👍 👎 👌 🤌 ✌️ 🤞 🤟 🤘 🤙 👈 👉 👆 👇 ☝️ 👋 ✋ 🖖 👏 🙌 🫶 👐 🤝 🙏 💪 ✍️',
  'Reações': '❤️ 🧡 💛 💚 💙 💜 🖤 🤍 💔 💕 💖 ✨ ⭐ 🌟 💫 🔥 💥 💯 ✅ ❌ ⚠️ ❓ ❗ 💤 🎉 🎊 🏆 🥇 🎯 🚀 💡',
  'Trabalho': '💻 🖥️ ⌨️ 📱 📎 📌 📝 📋 📊 📈 📉 🗂️ 📁 🔧 🔨 🛠️ ⚙️ 🔒 🔑 🐛 🧪 ⏰ ⏳ 📅 🔍 🧠 📣 🎨 ✂️ 🧩',
  'Diversos': '☕ 🍕 🍔 🍟 🍿 🍩 🍪 🎂 🍻 🍀 🌈 ☀️ 🌙 ⚡ ❄️ 🌊 🌸 🌻 🐱 🐶 🦊 🐼 🐧 🦄 🐢 🐙',
};
const recentesEmoji = () => { try { return JSON.parse(localStorage.getItem('emojis-recentes') || '[]'); } catch { return []; } };
const guardarEmoji = (e) => { try { localStorage.setItem('emojis-recentes', JSON.stringify([e, ...recentesEmoji().filter((x) => x !== e)].slice(0, 16))); } catch { /* sem armazenamento */ } };
function abrirEmoji(ancora, aba = null) {
  const antes = $('#emoji-pop'); const mesmaAncora = !!antes && !aba; fecharPops(); if (mesmaAncora) return;
  const rec = recentesEmoji(); const abas = [...(rec.length ? [['Recentes', rec]] : []), ...Object.entries(EMOJIS).map(([n, l]) => [n, l.split(' ')])];
  const ativa = abas.find(([n]) => n === aba) || abas[0];
  const m = document.createElement('div'); m.id = 'emoji-pop'; m.className = 'emoji-pop';
  m.innerHTML = `<div class="emoji-abas">${abas.map(([n]) => `<button class="${n === ativa[0] ? 'on' : ''}" data-emoji-aba="${n}">${n}</button>`).join('')}</div><div class="emoji-grade">${ativa[1].map((e) => `<button data-emoji="${e}">${e}</button>`).join('')}</div>`;
  document.body.appendChild(m); posicionarAcima(m, ancora || $('[data-acao=emoji]'));
}
function inserirEmoji(e) {
  const ta = $('#texto'); if (!ta) return;
  const i = ta.selectionStart ?? ta.value.length, f = ta.selectionEnd ?? i;
  ta.value = ta.value.slice(0, i) + e + ta.value.slice(f); ta.focus(); ta.setSelectionRange(i + e.length, i + e.length);
  autoAltura(ta); U.rascunhos[`${U.proj}/${U.canal}`] = ta.value; guardarEmoji(e);
}

/* ---- perfil estilo Discord: estilo de cada pessoa (foto recortada, decoração, fonte e efeito do nome, placa, capa, tema, VFX) ---- */
const OPC = {
  decoracao: [['nenhuma', 'Nenhuma'], ['aurora', 'Aurora'], ['neon', 'Neon'], ['chamas', 'Chamas'], ['orbita', 'Órbita'], ['sakura', 'Sakura'], ['pixel', 'Pixel'], ['gelo', 'Gelo'], ['raio', 'Raio'], ['coroa', 'Coroa']],
  efeito: [['nenhum', 'Nenhum'], ['estrelas', 'Estrelas'], ['neve', 'Neve'], ['brasas', 'Brasas'], ['petalas', 'Pétalas'], ['bolhas', 'Bolhas'], ['confete', 'Confete'], ['codigo', 'Código'], ['vagalumes', 'Vaga-lumes']],
  placa: [['nenhuma', 'Nenhuma'], ['aurora', 'Aurora'], ['galaxia', 'Galáxia'], ['oceano', 'Oceano'], ['por-do-sol', 'Pôr do sol'], ['floresta', 'Floresta'], ['circuito', 'Circuito'], ['sakura', 'Sakura'], ['lava', 'Lava']],
  fonte: [['padrao', 'Padrão'], ['tempo', 'Tempo'], ['sakura', 'Sakura'], ['jujuba', 'Jujuba'], ['moderna', 'Moderna'], ['medieval', 'Medieval'], ['8bit', '8 bits'], ['vampiro', 'Vampiro']],
  efeitoNome: [['solido', 'Sólido'], ['degrade', 'Degradê'], ['neon', 'Neon'], ['toon', 'Toon'], ['pop', 'Pop']],
};
const TEMAS = [['#5865f2', '#eb459e'], ['#00b4d8', '#7209b7'], ['#ff7a18', '#af002d'], ['#43e97b', '#38f9d7'], ['#f7971e', '#ffd200'], ['#232526', '#414345'], ['#fc5c7d', '#6a82fb'], ['#0f2027', '#2c5364']];
const pessoaDe = (id) => (id === 'voce' ? usuarioDe() : agente(id));
const estiloDe = (id) => pessoaDe(id)?.estilo || {};
const recorteCss = (r) => (r ? `transform:translate(${r.x}%,${r.y}%) scale(${r.zoom})` : '');
const placaCls = (id) => { const p = estiloDe(id).placa; return p && p !== 'nenhuma' ? `placa placa-${p}` : ''; };
/** Nome com a fonte escolhida; o efeito (cor, neon, degradê...) só onde `efx` (cartão de perfil, editor e DMs). */
function nomeHtml(id, efx = false, estilo = null, nome = null) {
  const n = (estilo || estiloDe(id)).nome || {};
  const txt = esc(nome ?? nomeAgente(id));
  if ((!n.fonte || n.fonte === 'padrao') && !(efx && n.efeito && (n.efeito !== 'solido' || n.c1))) return txt;
  return `<span class="nm-st ${efx ? 'efx' : ''}" data-fonte="${n.fonte || 'padrao'}" data-efeito="${n.efeito || 'solido'}" style="--n1:${n.c1 || 'currentColor'};--n2:${n.c2 || n.c1 || 'currentColor'}">${txt}</span>`;
}
function av(id, t = 'm', { dot = true, estilo = null, foto } = {}) {
  const e = estilo || estiloDe(id);
  const deco = e.decoracao && e.decoracao !== 'nenhuma' ? `<i class="deco deco-${e.decoracao}"></i>` : '';
  const img = (src, recorte = true) => `<span class="av-img"><img src="${esc(src)}" alt="" draggable="false" style="${recorte ? recorteCss(e.recorteFoto) : ''}"></span>`;
  if (id === 'voce') { const u = usuarioDe(); const f = foto === undefined ? u.foto : foto; return `<span class="av ${t} voce ${f ? 'foto' : ''}" data-perfil="voce">${f ? img(f) : ic('usuario')}${deco}</span>`; }
  const a = agente(id);
  if (!a) return `<span class="av ${t} foto">${img(avatarPadrao(id), false)}</span>`;
  const p = J().presenca[id];
  const st = dot ? (p ? (p.estado === 'trabalhando' ? 'trab' : 'fila') : '') : null;
  const f = foto === undefined ? a.foto : foto;
  // sem foto própria, o agente usa um dos avatares da marca (fixo por agente)
  return `<span class="av ${t} foto ${f ? '' : 'padrao'}" style="--c:${a.cor}" data-perfil="${id}">${f ? img(f) : img(avatarPadrao(id), false)}${deco}${st !== null ? `<i class="dot ${st}"></i>` : ''}</span>`;
}
/** Cartão de perfil (popout e prévia do editor): capa, avatar com decoração, nome estilizado, tema em duas cores e VFX. */
function cartaoHtml(id, { estilo = null, nome = null, acoes = '' } = {}) {
  const pz = pessoaDe(id); if (!pz) return '';
  const e = estilo || estiloDe(id);
  const cor = pz.cor || '#5865f2';
  const p1 = e.tema?.c1 || `color-mix(in srgb, ${cor} 45%, #1b1e26)`, p2 = e.tema?.c2 || '#14161c';
  const capa = pz.capa ? `<img src="${esc(pz.capa)}" alt="" draggable="false" style="${recorteCss(e.recorteCapa)}">` : '';
  const fundoCapa = e.corCapa || `linear-gradient(120deg, ${e.tema?.c1 || cor}, ${e.tema?.c2 || `color-mix(in srgb, ${cor} 40%, #000)`})`;
  const sobre = e.bio || (id === 'voce' ? '' : pz.papel || '');
  const vfx = e.efeito && e.efeito !== 'nenhum' ? `<canvas class="pcard-vfx" data-vfx="${e.efeito}"></canvas>` : '';
  return `<div class="pcard ${e.tema ? 'tema' : ''}" style="--p1:${p1};--p2:${p2}"><div class="pcard-in">
    <div class="pcard-capa" style="--capa:${fundoCapa}">${capa}</div>
    <div class="pcard-av">${av(id, 'x', { dot: false, estilo: e })}</div>
    <div class="pcard-corpo"><h3 class="pcard-nome">${nomeHtml(id, true, e, nome)}</h3><div class="pcard-cargo">${esc(pz.cargo || '')}</div>
      ${sobre ? `<div class="pcard-sec"><h4>Sobre mim</h4>${esc(sobre)}</div>` : ''}
      ${acoes ? `<div class="pcard-acoes">${acoes}</div>` : ''}${acoes && id !== 'voce' ? `<label class="pcard-falar"><input data-pcard-falar="${id}" placeholder="${I18N.t('Conversar com @{nome}', { nome: esc(nome ?? pz.nome) })}" autocomplete="off"></label>` : ''}</div>${vfx}</div></div>`;
}
function fecharCartao() { $('#pcard-pop')?.remove(); }
function abrirCartao(id, ancora) {
  fecharCartao();
  const acoes = `<button class="btn-sec" data-acao="perfil" data-ag="${id}">Editar perfil</button>`;
  const el = document.createElement('div'); el.id = 'pcard-pop'; el.className = 'pcard-pop';
  el.innerHTML = cartaoHtml(id, { acoes });
  document.body.appendChild(el);
  const r = ancora.getBoundingClientRect(), w = el.offsetWidth, h = el.offsetHeight;
  let x = r.right + 12; if (x + w > innerWidth - 8) x = r.left - w - 12; if (x < 8) x = Math.max(8, Math.min(innerWidth - w - 8, r.left));
  el.style.left = `${x}px`; el.style.top = `${Math.max(8, Math.min(innerHeight - h - 8, r.top - 40))}px`;
  VFX.ligar(el);
}
const loz = (col) => `<span class="loz ${col}">${esc(nomeColuna(col))}</span>`;
const iconePrio = { alta: 'prioAlta', normal: 'prioMedia', baixa: 'prioBaixa' };
const nomePrio = { alta: 'Alta', normal: 'Normal', baixa: 'Baixa' };
const aguardandoVoce = (agenteId) => J().perguntas.some((q) => q.estado === 'aberta' && q.de === agenteId);

/* ------------------------------------------------------------ trilho: projetos e vistas */
function renderRail() {
  const projs = E.projetos.map((p) => {
    // o projeto inteiro (todas as equipes) é um botão só no trilho
    const eqs = equipesDoProjeto(p).map((e) => PJ[e.cid]).filter(Boolean);
    const trab = eqs.some((j) => Object.values(j.presenca || {}).some((x) => x.estado === 'trabalhando'));
    const ab = E.perguntas.filter((q) => baseDe(q.projeto) === p.id).length;
    return `<button class="rail-btn rail-proj ${p.id === baseDe(U.proj) ? 'ativo' : ''} ${trab ? 'trabalhando' : ''} ${p.existe === false ? 'faltando' : ''}" style="--h:${matiz(p.id)}" data-projeto="${p.id}" data-tip="${esc(p.nome)}${p.existe === false ? ` ${I18N.t('(pasta não encontrada)')}` : ''}">${esc(iniciais(p.nome))}${ab ? `<span class="pip">${ab}</span>` : ''}</button>`;
  }).join('');
  const nao = U.proj ? Object.values(J().naoLidas).reduce((a, b) => a + b, 0) : 0;
  const vistas = U.proj ? `<div class="sep"></div>
    <button class="rail-btn ${U.vista === 'chat' ? 'ativo' : ''}" data-vista="chat" data-tip="Chat">${ic('chat')}${nao ? `<span class="pip">${nao}</span>` : ''}</button>
    <button class="rail-btn ${U.vista === 'planner' ? 'ativo' : ''}" data-vista="planner" data-tip="Planner">${ic('quadro')}</button>
    <button class="rail-btn ${U.vista === 'registro' ? 'ativo' : ''}" data-vista="registro" data-tip="${esc(J().registro?.vista || 'Registro')}">${ic('ficha')}</button>
    <button class="rail-btn ${U.vista === 'memoria' ? 'ativo' : ''}" data-vista="memoria" data-tip="Memória">${ic('memoria')}</button>
    <button class="rail-btn ${U.vista === 'agenda' ? 'ativo' : ''}" data-vista="agenda" data-tip="Agenda">${ic('calendario')}</button>
    <button class="rail-btn ${U.vista === 'colmeia' ? 'ativo' : ''}" data-vista="colmeia" data-tip="Colmeia">${ic('colmeia')}</button>` : '';
  const total = E.perguntas.length + naoLidasTotal();
  $('#rail').innerHTML = `${projs}
    <a class="rail-btn" href="/entrevista.html" data-tip="Agente de entrevista (experimental)" aria-label="Agente de entrevista experimental">🧪</a>
    <button class="rail-btn ${equipeAvaliacao()?.cid === U.proj ? 'ativo' : ''}" data-acao="abrir-avaliacao" data-tip="Avaliação de agentes de código" aria-label="Avaliação de agentes de código">${ic('escudo')}</button>
    <button class="rail-btn novo" data-acao="novo-projeto" data-tip="Adicionar projeto">${ic('mais')}</button>${vistas}
    <div class="espaco"></div>
    <button class="rail-btn sino ${total ? 'tem' : ''}" data-acao="inbox" data-tip="Precisa de você">${ic('sino')}${total ? `<span class="pip">${total}</span>` : ''}</button>
    <button class="rail-btn" data-acao="ajustes" data-tip="Ajustes">${ic('engrenagem')}</button>`;
}

/* ------------------------------------------------------------ lista de canais */
/** Seletor de equipes do projeto: cada equipe (template) tem conversas, contatos e planner próprios. Aguenta N equipes (a lista rola). */
function equipesHtml(p) {
  if (!p) return '';
  const eqs = equipesDoProjeto(p);
  const linha = (e) => {
    const j = PJ[e.cid];
    const n = j ? Object.values(j.naoLidas || {}).reduce((a, b) => a + b, 0) : 0;
    const trab = j && Object.values(j.presenca || {}).some((x) => x.estado === 'trabalhando');
    const ab = E.perguntas.filter((q) => q.projeto === e.cid).length;
    const pip = ab ? `<span class="eq-pip alerta">${ab}</span>` : n ? `<span class="eq-pip">${n}</span>` : '';
    return `<button class="eq-item ${e.cid === U.proj ? 'ativo' : ''} ${trab ? 'trabalhando' : ''}" data-eqsel="${esc(e.cid)}" title="${esc(e.nome)}" style="--h:${matiz(e.cid)}"><span class="eq-ic">${esc(String(e.nome).trim()[0] || 'E')}</span><span class="eq-nome">${esc(e.nome)}</span>${pip}</button>`;
  };
  return `<div class="equipes-bar ${eqs.length > 5 ? 'muitas' : ''}"><div class="eq-cab"><span>Equipes</span><button class="btn-ic" data-acao="nova-equipe" title="Adicionar equipe">${ic('mais')}</button></div><div class="eq-lista">${eqs.map(linha).join('')}</div></div>`;
}
function renderLista() {
  const p = projetoAtual();
  const j = J();
  const item = (canal, icone, nome, extra = '', cls = '', cargo = '') => {
    const n = j.naoLidas[canal] || 0;
    return `<button class="canal ${cls} ${U.canal === canal ? 'ativo' : ''} ${n ? 'novo' : ''}" data-canal="${canal}">${icone}<span class="nome">${esc(nome)}${cargo ? `<small class="cargo-mini">${esc(cargo)}</small>` : ''}</span>${extra}${n ? `<span class="badge">${n}</span>` : ''}</button>`;
  };
  const eqz = (id) => { const x = j.presenca[id]; return x && x.estado === 'trabalhando' ? `<span class="eq" style="--c:${agente(id).cor}"><i></i><i></i><i></i></span>` : ''; };
  const sino = (id) => (aguardandoVoce(id) ? `<span style="color:var(--ouro-1);display:inline-flex" title="Aguardando você">${ic('sino')}</span>` : '');
  const eng = E.config.engine === 'codex' ? 'Codex' : 'Claude';
  const modo = E.config.modo === 'trabalhar' ? I18N.t('executando') : I18N.t('planejando');
  const arqSet = new Set(j.arquivadas || []);
  const naoArq = (x) => !arqSet.has(x.canal);
  const arq = [...arqSet].filter((c) => c.startsWith('dm:') ? agente(c.slice(3)) : (j.grupos || []).some((g) => g.canal === c) || (j.planning || []).some((p) => p.canal === c));
  $('#lista').innerHTML = `
    <div class="lista-topo">${logo(22)}<span class="proj-nome" data-acao="proj-config" title="Ajustes do projeto">${esc(p ? p.nome : '')}</span>${p ? '<button class="btn-salvar" data-acao="salvar-projeto" title="Salvar projeto (Ctrl+S)" aria-label="Salvar projeto"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 3h11l4 4v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z"/><path d="M8 3v5h7V3"/><rect x="7" y="13" width="10" height="8" rx="1"/></svg></button>' : ''}</div>
    ${equipesHtml(p)}
    <div class="lista-corpo">
      <div class="cat">${ic('setaB')}Canais</div>
      ${item('equipe', ic('hash'), 'equipe')}
      ${item('posts', ic('livro'), 'posts')}
      ${item('bastidores', ic('cadeado'), 'bastidores', '', 'mudo')}
      ${(j.grupos || []).filter(naoArq).length ? `<div class="cat">${ic('setaB')}Grupos de trabalho</div>${[...j.grupos].filter(naoArq).reverse().slice(0, 8).map((g) => item(g.canal, ic('usuarios'), g.titulo, g.status === 'ativo' ? '' : `<span class="tag">${g.status === 'limite' ? 'pausado' : 'encerrado'}</span>`, g.status === 'ativo' ? '' : 'mudo')).join('')}` : ''}
      ${(j.planning || []).filter(naoArq).length ? `<div class="cat">${ic('setaB')}Planning</div>${[...j.planning].filter(naoArq).reverse().slice(0, 6).map((pl) => item(pl.canal, ic('blocos'), pl.titulo, `<span class="tag">${esc(pl.rotulo)}</span>`, ['aprovado', 'cancelado'].includes(pl.status) ? 'mudo' : '')).join('')}` : ''}
      ${gerais().length ? `<div class="cat">${ic('setaB')}Geral</div>${gerais().map((a) => (a.cid ? `<button class="canal" data-ir-canal="${esc(a.cid)}|dm:${a.agente}" title="${esc(a.nome)} atende todas as equipes">${av(`ext:${a.agente}@${a.cid}`, 'p')}<span class="nome">${esc(a.nome)}<small class="cargo-mini">${esc(a.cargo)}</small></span></button>` : item(`dm:${a.id}`, av(a.id, 'p'), a.nome, (a.id === liderAtual() ? '<span class="tag">LEAD</span>' : '') + sino(a.id) + eqz(a.id), '', a.cargo))).join('')}` : ''}
      <div class="cat">${ic('setaB')}${I18N.t('Agentes — {n}', { n: rosterDaEquipe().filter((a) => !a.geral).length })}</div>
      ${rosterDaEquipe().filter((a) => !a.geral && naoArq({ canal: `dm:${a.id}` })).map((a) => item(`dm:${a.id}`, av(a.id, 'p'), a.nome, (a.id === liderAtual() ? '<span class="tag">LEAD</span>' : '') + sino(a.id) + eqz(a.id), '', a.cargo)).join('')}
      ${arq.length ? `<button class="cat cat-arq ${U.verArq ? '' : 'fechada'}" data-acao="ver-arquivadas">${ic('setaB')}${I18N.t('Arquivadas — {n}', { n: arq.length })}</button>${U.verArq ? arq.map((c) => item(c, c.startsWith('dm:') ? av(c.slice(3), 'p', { dot: false }) : ic(c.startsWith('grp-') ? 'usuarios' : 'blocos'), nomeCanal(c), '', 'mudo')).join('') : ''}` : ''}
    </div>
    ${CH.aberta ? chamadaPainelHtml() : ''}
    <div class="usuario"><button class="eu" data-acao="perfil" data-ag="voce" title="Seu nome e sua foto">${av('voce', 'm')}<span class="info"><b>${esc(usuarioDe().nome)}</b><small>${eng}, ${modo}</small></span></button>
      <button class="btn-ic" data-acao="ajustes">${ic('engrenagem')}</button></div>`;
}

/* ------------------------------------------------------------ chat */
async function abrirCanal(canal) {
  U.canal = canal;
  const j = J();
  j.naoLidas[canal] = 0;
  if (canal === 'bastidores') j.bastidores = await (await fetch(P('/bastidores'))).json().catch(() => []);
  else if (canal === 'posts') { /* o feed vem do estado do projeto */ }
  else if (!j.canais[canal]) {
    const h = await (await fetch(P(`/canal/${canal}`))).json().catch(() => []);
    j.canais[canal] = Array.isArray(h) ? h : [];
  }
  renderTudo();
  const m = $('#mensagens');
  if (m) m.scrollTop = m.scrollHeight;
}

/* ------------------------------------------------------------ canal Posts */
function modalNovoPost() {
  const imgs = [];
  abrirModal(`<h2>Nova publicação</h2>
    <div class="campo"><label class="rot">Título</label><input class="in" id="np-tit" placeholder="Ex.: Nova configuração do projeto" autocomplete="off"></div>
    <div class="campo"><label class="rot">Texto</label><textarea class="in" id="np-txt" rows="9" placeholder="Aceita markdown: ## seções, listas, tabelas e checklists. Use @ para marcar um agente e @todos para avisar o time inteiro."></textarea></div>
    <div class="campo"><label class="btn-sec arquivo">Anexar prints<input type="file" id="np-img" accept="image/png,image/jpeg,image/gif,image/webp" multiple hidden></label><div id="np-lista" class="mudo" style="margin-top:6px"></div></div>
    <div class="acoes"><button class="btn-sec" id="m-nao">Cancelar</button><button class="btn-primario" id="m-sim">Publicar</button></div>`, 'ajustes');
  $('#np-img').onchange = async (ev) => {
    for (const f of [...ev.target.files].slice(0, 8 - imgs.length)) {
      const r = await fetch(P(`/anexo?nome=${encodeURIComponent(f.name)}`), { method: 'PUT', body: f, headers: { 'x-studio-anexo': '1', 'content-type': f.type || 'application/octet-stream' } });
      const j = await r.json().catch(() => ({}));
      if (r.ok && j.anexo) imgs.push(j.anexo); else aviso(j.erro || I18N.t('Não consegui enviar {arquivo}.', { arquivo: f.name }));
    }
    $('#np-lista').textContent = imgs.map((a) => a.nome).join(', ');
  };
  $('#m-nao').onclick = fecharModal;
  $('#m-sim').onclick = async () => {
    const r = await api('POST', P('/posts'), { titulo: $('#np-tit').value, corpo: $('#np-txt').value, imagens: imgs.map((a) => a.rel) });
    if (!r._ok) return aviso(r.erro || I18N.t('Não consegui publicar.'));
    fecharModal(); aviso(I18N.t('Publicado.'));
  };
}
function postsHtml() {
  const lista = [...(J().posts || [])].reverse();
  if (!lista.length) return '<div class="vazio-p">Ainda não há publicações. Quando o time terminar algo, o relatório e os prints aparecem aqui.</div>';
  const nomeA = (id) => (id === 'voce' ? usuarioDe().nome : nomeAgente(id));
  const dataP = (iso) => `${new Date(iso).toLocaleDateString(I18N.locale, { day: '2-digit', month: '2-digit' })} ${horaCurta(Date.parse(iso))}`;
  return lista.map((p) => {
    const longo = String(p.corpo).length > 520 || String(p.corpo).split('\n').length > 9;
    const exp = U.postsExp?.has(p.id);
    const reac = ['👍', '❤️', '😆', '😮'].map((e) => { const l = (p.reacoes || {})[e] || []; return `<button class="reac ${l.includes('voce') ? 'minha' : ''}" data-acao="post-reagir" data-post="${p.id}" data-emoji="${e}" title="${esc(l.map(nomeA).join(', ') || 'Reagir')}">${e}${l.length ? ` <b>${l.length}</b>` : ''}</button>`; }).join('');
    const aberto = U.postsAbertos?.has(p.id);
    const msgs = (J().canais[p.canal] || []).filter((m) => (m.texto || '').trim() && m.status !== 'trabalhando');
    const fio = aberto ? `<div class="post-fio">${msgs.map((m) => `<div class="post-resp-i">${av(m.de, 'p', { dot: false })}<div><b>${esc(nomeA(m.de))}</b> <span class="mudo">${esc(dataP(m.em))}</span><div class="texto corpo">${md(m.texto)}</div></div></div>`).join('') || '<p class="mudo">Ninguém respondeu ainda.</p>'}</div>` : '';
    return `<article class="post" id="post-${p.id}">
      <header class="post-topo">${av(p.autor, 'm')}<div><b>${esc(nomeA(p.autor))}</b> <span class="mudo">${esc(dataP(p.criado))}${p.editado ? `, ${I18N.t('editada')}` : ''}</span></div>${p.relatorioFinal ? '<span class="etq">Relatório final</span>' : ''}</header>
      <h3 class="post-titulo">${esc(p.titulo)}</h3>
      ${(p.mencoes || []).length || p.card || p.todos ? `<div class="post-men-l">${p.todos ? '<span class="post-men">@todos</span> ' : ''}${(p.mencoes || []).map((m) => `<span class="post-men">${esc(nomeA(m))}</span>`).join(' ')}${p.card ? ` <a class="post-card" data-issue="${esc(p.card)}">${esc(p.card)}</a>` : ''}</div>` : ''}
      <div class="post-corpo ${longo && !exp ? 'curto' : ''}"><div class="texto corpo">${md(p.corpo)}</div></div>
      ${longo ? `<button class="post-mais" data-acao="post-mais" data-post="${p.id}">${exp ? 'ver menos' : 'veja mais'}</button>` : ''}
      ${(p.anexos || []).length ? `<div class="post-imgs">${p.anexos.map((a) => `<a class="anexo-img" href="${urlAnexo(a.rel, a.pid || U.proj)}" target="_blank" rel="noopener" title="${esc(a.nome)}"><img src="${urlAnexo(a.rel, a.pid || U.proj)}" alt="${esc(a.nome)}" loading="lazy"></a>`).join('')}</div>` : ''}
      ${p.paraTodos ? `<div class="post-visto">${I18N.t('Aviso para todos. Visto por {vistos} de {total}', { vistos: (p.visto || []).length, total: p.totalAgentes })}${(p.visto || []).length ? `: ${esc(p.visto.map(nomeA).join(', '))}` : ''}</div>` : ''}
      <div class="post-reacoes">${reac}</div>
      ${p.respostas ? `<button class="post-abrir" data-acao="post-thread" data-post="${p.id}">${I18N.t(aberto ? (p.respostas === 1 ? 'Ocultar {n} resposta de {quem}' : 'Ocultar {n} respostas de {quem}') : (p.respostas === 1 ? 'Abrir {n} resposta de {quem}' : 'Abrir {n} respostas de {quem}'), { n: p.respostas, quem: esc((p.quem || []).map(nomeA).join(', ')) })}</button>` : ''}
      ${fio}
      <div class="post-resp"><input class="in" data-post-resp="${p.id}" placeholder="Responder na conversa" autocomplete="off"></div>
    </article>`;
  }).join('');
}
// Redesenha o feed sem perder a rolagem nem o que está sendo digitado.
function renderPostsSuave() {
  const el = $('#mensagens'); if (!el || U.canal !== 'posts') return;
  const rascunhos = {}; $$('[data-post-resp]').forEach((i) => { if (i.value) rascunhos[i.dataset.postResp] = i.value; });
  const foco = document.activeElement?.dataset?.postResp;
  const topo = el.scrollTop;
  el.innerHTML = postsHtml();
  el.scrollTop = topo;
  $$('[data-post-resp]').forEach((i) => { if (rascunhos[i.dataset.postResp]) i.value = rascunhos[i.dataset.postResp]; });
  if (foco) $(`[data-post-resp="${foco}"]`)?.focus();
}

function cabecaChat() {
  const id = U.canal;
  const j = J();
  const btns = `<span class="espaco"></span>
    ${id === 'equipe' || id === `dm:${liderAtual()}` ? `<button class="btn-ic ${CH.aberta ? 'on' : ''}" data-acao="chamar" title="${I18N.t('Chamar {nome} por voz', { nome: esc(agente(liderAtual())?.nome || I18N.t('a liderança')) })}">${ic('fone')}</button>` : ''}
    <button class="btn-ic ${U.membros ? 'on' : ''}" data-acao="membros" title="Andamento e membros">${ic('usuarios')}</button>
    ${id === 'bastidores' ? '' : `<button class="btn-ic" data-acao="limpar" title="Limpar conversa">${ic('lixo')}</button>`}`;
  if (id === 'posts') return `<div class="cabeca"><svg class="ic hash" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round">${IC.hash}</svg><h2>posts</h2><span class="div"></span><span class="topico">Publicações do time: o que foi feito, com prints e relatórios finais</span><span class="espaco"></span><button class="btn-primario" data-acao="novo-post">Nova publicação</button></div>`;
  if (id.startsWith('grp-')) {
    const g = (j.grupos || []).find((x) => x.canal === id);
    return `<div class="cabeca"><svg class="ic hash" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round">${IC.hash}</svg><h2>${esc(g ? g.titulo : id)}</h2><span class="div"></span><span class="topico">${g ? `<span class="pilha">${g.membros.map((a) => av(a, 'p', { dot: false })).join('')}</span>${g.membros.map(nomeAgente).join(', ')}${g.status === 'ativo' ? '' : `, ${I18N.t(g.status === 'limite' ? 'pausado' : 'encerrado')}`}` : ''}</span><span class="espaco"></span>${g && g.status === 'ativo' ? `<button class="btn-sec" data-acao="grupo-encerrar" data-grupo="${id}">Encerrar grupo</button>` : ''}</div>`;
  }
  if (id.startsWith('plan-')) {
    const pl = (j.planning || []).find((x) => x.canal === id);
    const ativo = pl && !['aprovado', 'cancelado'].includes(pl.status);
    return `<div class="cabeca"><svg class="ic hash" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round">${IC.hash}</svg><h2>${esc(pl ? pl.titulo : id)}</h2><span class="div"></span><span class="topico">${pl ? esc(`planning, ${pl.rotulo}`) : ''}</span><span class="espaco"></span>${ativo ? `<button class="btn-sec" data-acao="planning-cancelar" data-plan="${id}">Encerrar planning</button>` : ''}</div>`;
  }
  if (id === 'equipe' || id === 'bastidores') {
    const vivos = Object.entries(j.presenca).filter(([, p]) => p.estado === 'trabalhando').map(([a]) => a);
    const topico = id === 'bastidores'
      ? 'O que os agentes resolvem entre si, fora do chat'
      : (vivos.length ? `<span class="pilha">${vivos.map((a) => av(a, 'p', { dot: false })).join('')}</span>${I18N.t('{nomes} trabalhando', { nomes: vivos.map(nomeAgente).join(` ${I18N.t('e')} `) })}` : 'Grupo com todos os agentes');
    return `<div class="cabeca"><svg class="ic hash" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round">${id === 'bastidores' ? IC.cadeado : IC.hash}</svg><h2>${id}</h2><span class="div"></span><span class="topico">${topico}</span>${btns}</div>`;
  }
  const a = agente(id.slice(3)); const p = j.presenca[a.id];
  const tag = a.id === liderAtual() ? ' <span class="tag-lead">LEAD</span>' : '';
  const sub = aguardandoVoce(a.id) ? '<span class="viva" style="--c:var(--ouro-1)">aguardando você</span>'
    : p ? `<span class="viva" style="--c:${a.cor}">${p.estado === 'fila' ? 'na fila' : esc(p.atividade)}</span> <span data-desde="${p.desde}"></span>${p.canal && p.canal !== id ? ` <a class="ref" data-canal="${esc(p.canal)}">${I18N.t('ver em #{canal}', { canal: esc(p.canal) })}</a>` : ''}` : esc(a.papel);
  const parar = p ? `<button class="btn-ic" data-acao="parar-agente" data-ag="${a.id}" title="${I18N.t('Parar {nome}', { nome: esc(a.nome) })}">${ic('parar')}</button>` : '';
  const perfil = `<button class="btn-ic" data-acao="perfil" data-ag="${a.id}" title="${I18N.t('Regras e contexto de {nome}', { nome: esc(a.nome) })}">${ic('engrenagem')}</button>`;
  return `<div class="cabeca">${av(a.id, 'm')}<h2>${nomeHtml(a.id, true)}${tag}<span class="cargo-h">${esc(a.cargo)}</span></h2><span class="div"></span><span class="topico">${sub}</span>${btns.replace('<span class="espaco"></span>', `<span class="espaco"></span>${parar}${perfil}`)}</div>`;
}

const rodandoAqui = () => Object.keys(J().presenca).length > 0;
const botaoEnviar = () => (rodandoAqui()
  ? `<button class="enviar parar" data-acao="parar">${ic('parar')}Parar</button>`
  : `<button class="enviar" data-acao="enviar">${ic('enviar')}Enviar</button>`);

function renderChat() {
  if (U.canal === 'posts') { $('#centro').innerHTML = `${cabecaChat()}<div class="posts" id="mensagens">${postsHtml()}</div>`; return; }
  if (U.canal === 'bastidores') {
    $('#centro').innerHTML = `${cabecaChat()}<div class="bastidores" id="mensagens">${bastidoresHtml()}</div><div class="digitando" id="digitando"></div>`;
    renderDigitando();
    return;
  }
  // Redesenhar a conversa não pode jogar a leitura para o começo: se era o mesmo canal, volta para onde você estava
  // (ou fica colado no fim, se estava no fim). Trocar de canal continua abrindo no fim.
  const m0 = $('#mensagens'); const mesmoCanal = !!m0 && U.canalDesenhado === `${U.proj}/${U.canal}`;
  const colado = !mesmoCanal || m0.scrollHeight - m0.scrollTop - m0.clientHeight < 160; const topoAntes = mesmoCanal ? m0.scrollTop : 0;
  $('#centro').innerHTML = `
    ${cabecaChat()}
    ${CH.aberta && U.canal === CH.canal ? `<div id="chamada" class="dock ${CH.layout}">${chamadaHtml()}</div>` : ''}
    <div class="mensagens" id="mensagens">${mensagensHtml(J().canais[U.canal] || [])}</div>
    <div class="digitando" id="digitando"></div>
    <div class="compositor">
      <div class="sugestoes" id="sugestoes" hidden></div>
      <div class="caixa">
        ${respostaHtml()}
        <div class="anexos-pend" id="anexos-pend" hidden></div>
        <textarea id="texto" rows="1" placeholder="${I18N.t('Enviar mensagem para {canal}', { canal: esc((U.canal === 'equipe' ? '#' : '') + nomeCanal(U.canal)) })}">${esc(U.rascunhos[`${U.proj}/${U.canal}`] || '')}</textarea>
        <div class="barra">
          ${seletorHtml('motor')}${seletorHtml('modo')}
          <button class="btn-ic" data-acao="anexar" title="Anexar arquivos (ou arraste e cole aqui)">${ic('clipe')}</button>
          <button class="btn-ic" data-acao="emoji" title="Emoji">${ic('rosto')}</button>
          <span class="espaco"></span>
          <span id="slot-enviar">${botaoEnviar()}</span>
        </div>
      </div>
    </div>`;
  U.canalDesenhado = `${U.proj}/${U.canal}`;
  { const m1 = $('#mensagens'); if (m1) m1.scrollTop = colado ? m1.scrollHeight : topoAntes; }
  montarChamada();
  renderDigitando();
  autoAltura($('#texto'));
  renderAnexosPend();
}

function bastidoresHtml() {
  const lista = J().bastidores;
  const topo = '<div class="bast-topo">Quando uma dúvida é técnica, os agentes resolvem entre si por aqui e só o resultado vai para o chat. Fica tudo registrado, caso você queira conferir.</div>';
  if (!lista.length) return `${topo}<div class="vazio-p">Nenhuma consulta interna ainda.</div>`;
  return topo + lista.map((b) => `<div class="bast">
    <div class="cab-b">${av(b.de, 'p', { dot: false })}<b>${esc(nomeAgente(b.de))}</b> consultou ${av(b.para, 'p', { dot: false })}<b>${esc(nomeAgente(b.para))}</b>
      ${b.card ? `<a class="ref" data-issue="${esc(b.card)}">${esc(b.card)}</a>` : ''}<span style="margin-left:auto">${hhmm(b.em)}</span></div>
    <div class="pg">${esc(b.pergunta)}</div><div class="rs">${esc(b.resposta)}</div></div>`).join('');
}

function renderDigitando() {
  const el = $('#digitando');
  if (!el) return;
  const ps = Object.entries(J().presenca).filter(([, p]) => p.canal === U.canal || (U.canal !== 'bastidores' && p.canal === 'bastidores'));
  if (!ps.length) { el.innerHTML = ''; return; }
  const nomes = ps.map(([id]) => `<b>${esc(nomeAgente(id))}</b>`).join(` ${I18N.t('e')} `);
  const [id, p] = ps[0];
  const cor = (agente(id) || {}).cor || '#aaa';
  const generica = ['escrevendo', 'começando', 'trabalhando', 'na fila', ''];
  const extra = ps.length === 1 && p.estado === 'trabalhando' && !generica.includes(p.atividade || '') ? p.atividade : '';
  el.innerHTML = `<span class="pontos" style="--c:${cor}"><i></i><i></i><i></i></span>
    <span>${I18N.t(ps.length > 1 ? '{nomes} estão trabalhando' : (p.estado === 'fila' ? '{nomes} está na fila' : '{nomes} está escrevendo'), { nomes })}</span>
    ${extra ? `<span class="t">${esc(extra)}</span>` : ''}${ps.length === 1 && p.estado === 'trabalhando' ? `<span class="t" data-desde="${p.desde}"></span>` : ''}`;
}

function mensagensHtml(lista) {
  let ant = null; let dia = '';
  return lista.map((m) => {
    let sep = '';
    const d = new Date(m.em).toDateString();
    if (d !== dia) { dia = d; sep = `<div class="sep-dia">${esc(diaTxt(m.em))}</div>`; ant = null; }
    const h = sep + msgHtml(m, ant);
    ant = m;
    return h;
  }).join('');
}

function perguntaHtml(m) {
  const q = J().perguntas.find((x) => x.id === m.pergunta);
  if (!q) return '';
  const comLider = q.estado === 'aberta' && q.paraPO;   // você passou para a liderança decidir
  const aberta = q.estado === 'aberta' && !comLider;
  const c = q.card ? cartao(q.card) : null;
  const podeDelegar = !q.planning && !q.decisao && q.de !== liderAtual();
  return `<div class="embed pergunta ${aberta ? '' : 'fechada'}" data-q="${q.id}">
    <div class="linha1">${ic(aberta ? 'sino' : 'check')}${aberta ? 'Precisa de você' : comLider ? I18N.t('Com {nome} para decidir', { nome: esc(nomeAgente(liderAtual())) }) : 'Respondida'}</div>
    ${c ? `<div class="tit">${esc(c.id)}  ${esc(c.titulo)}</div>` : ''}
    ${aberta ? `<div class="opcoes">${q.opcoes.map((o) => `<button data-responder="${q.id}" data-resp="${esc(o)}">${esc(o)}</button>`).join('')}<button class="sec" data-acao="responder-livre" data-q="${q.id}" data-de="${esc(q.de)}">Responder…</button>${podeDelegar ? `<button class="sec" data-acao="delegar-pergunta" data-q="${q.id}" title="Passa a pergunta para a liderança decidir por você">${I18N.t('{nome} decide', { nome: esc(nomeAgente(liderAtual())) })}</button>` : ''}</div>` : ''}</div>`;
}

function relatorioHtml(d) {
  const lista = (itens, vazio, extra = () => '') => (itens.length
    ? `<ul class="rel-lista">${itens.map((c) => `<li><a class="ref" data-issue="${esc(c.id)}">${esc(c.id)}</a> ${esc(c.titulo)}${c.dono ? `<small>${esc(c.dono)}</small>` : ''}${extra(c)}</li>`).join('')}</ul>`
    : `<div class="rel-vazio">${vazio}</div>`);
  const bloco = (titulo, corpo) => `<div class="rel-sec"><h5>${titulo}</h5>${corpo}</div>`;
  const pg = d.progresso || { pct: 0, pontosFeitos: 0, pontosTotal: 0 };
  return `<div class="embed relatorio">
    <div class="linha1">${ic('relogio')}${esc(d.titulo || (d.manual ? 'Relatório de hoje' : 'Relatório do dia'))}<span class="rel-hora">${esc(d.hora || '')}</span></div>
    ${pg.pontosTotal ? `<div class="rel-prog"><i class="uso-b"><b class="ok" style="width:${pg.pct}%"></b></i><span>${I18N.t('{feitos} de {total} pontos, {pct}%', { feitos: pg.pontosFeitos, total: pg.pontosTotal, pct: pg.pct })}</span></div>` : ''}
    ${bloco(`${I18N.t(d.titulo ? 'Concluído' : 'Concluído hoje')}${d.pontosHoje ? `, ${I18N.t('{n} pontos', { n: d.pontosHoje })}` : ''}`, lista(d.concluidos || [], 'Nada concluído ainda.'))}
    ${(d.andamento || []).length ? bloco('Em andamento', lista(d.andamento)) : ''}
    ${(d.emRevisao || []).length ? bloco('Esperando revisão ou QA', lista(d.emRevisao)) : ''}
    ${(d.bloqueados || []).length ? bloco('Bloqueado', lista(d.bloqueados, '', (c) => `<small class="rel-motivo">${esc(c.motivo)}</small>`)) : ''}
    ${d.perguntas ? bloco('Precisa de você', `<div class="rel-vazio">${I18N.t(d.perguntas === 1 ? '{n} pergunta em aberto.' : '{n} perguntas em aberto.', { n: d.perguntas })}</div>`) : ''}
    ${(d.proximos || []).length ? bloco('Próximos', lista(d.proximos)) : ''}
    ${d.uso ? `<div class="rel-rodape">${I18N.t('Créditos: sessão {sessao}%, semana {semana}%', { sessao: d.uso.cinco ?? '?', semana: d.uso.sete ?? '?' })}</div>` : ''}
  </div>`;
}

function embedsHtml(resumo) {
  if (!resumo || !resumo.length) return '';
  const corAcao = { criou: '#34D399', atualizou: '#6C9BFF', comentou: '#A58BF5', bloqueou: '#F2606C', desbloqueou: '#34D399' };
  const verbo = { criou: 'Card criado', moveu: 'Card movido', atualizou: 'Card atualizado', comentou: 'Comentário no card', bloqueou: 'Card bloqueado', desbloqueou: 'Card liberado' };
  const verboM = { salvou: 'Memória salva', atualizou: 'Memória atualizada', moveu: 'Memória reorganizada', arquivou: 'Memória arquivada' };
  return `<div class="embeds">${resumo.map((r) => {
    if (r.tipo === 'relatorio') return relatorioHtml(r);
    if (r.tipo === 'aviso') return `<div class="embed aviso"><div class="linha1">${ic('alerta')}Aviso</div><div class="tit">${esc(r.texto)}</div></div>`;
    if (r.tipo === 'memoria') return `<button class="embed memoria" data-nota="${esc(r.caminho)}"><div class="linha1">${ic('memoria')}${esc(verboM[r.acao] || 'Memória')}</div><div class="tit">${esc(r.titulo)}</div><div class="caminho-m">${esc(r.caminho)}</div></button>`;
    const c = cartao(r.id);
    const cor = r.acao === 'moveu' ? (COR_COL[r.para] || '#6C9BFF') : (corAcao[r.acao] || '#6C9BFF');
    // usa a foto gravada na hora da ação; só cai no estado atual em mensagens antigas, sem foto
    const coluna = r.coluna ?? (c && c.coluna);
    const donoId = r.dono !== undefined ? r.dono : (c && c.dono);
    return `<button class="embed" style="--c:${cor}" data-issue="${esc(r.id)}">
      <div class="linha1">${ic('checkq')}${esc(verbo[r.acao] || r.acao)}</div>
      <div class="tit">${esc(r.id)}  ${esc(r.titulo || (c && c.titulo) || '')}</div>
      <div class="campos"><span><b>Etapa</b>${coluna ? loz(coluna) : ''}</span><span><b>Responsável</b>${esc(donoId ? nomeAgente(donoId) : 'Sem dono')}</span></div></button>`;
  }).join('')}</div>`;
}

/* ---- anexos: o arquivo sobe para a pasta do projeto e os agentes o leem de lá ---- */
const urlAnexo = (rel, pid = U.proj) => P(`/anexo/${String(rel).split('/').map(encodeURIComponent).join('/')}`, pid);
const tamanhoTxt = (b) => (b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

function anexosHtml(lista) {
  if (!lista || !lista.length) return '';
  return `<div class="anexos-msg">${lista.map((a) => (a.imagem
    ? `<a class="anexo-img" href="${urlAnexo(a.rel, a.pid || U.proj)}" target="_blank" rel="noopener" title="${esc(a.nome)}"><img src="${urlAnexo(a.rel, a.pid || U.proj)}" alt="${esc(a.nome)}" loading="lazy"></a>`
    : `<a class="anexo-arq" href="${urlAnexo(a.rel, a.pid || U.proj)}" download="${esc(a.nome.replace(/^\d{6}-/, ''))}" target="_blank" rel="noopener">${ic('copiar')}<span>${esc(a.nome)}</span><small>${tamanhoTxt(a.tamanho)}</small></a>`)).join('')}</div>`;
}

// O campo de arquivo fica fora do chat: o chat é redesenhado a cada evento e, se o campo fosse junto enquanto a janela de
// escolher arquivo está aberta, o arquivo escolhido se perdia (o evento caía num elemento que já não estava na página).
const campoAnexo = () => $('#anexo-input') || document.body.appendChild(Object.assign(document.createElement('input'), { type: 'file', id: 'anexo-input', multiple: true, hidden: true }));
const chaveAnexos = () => `${U.proj}/${U.canal}`;
const anexosAtuais = () => (U.anexos ||= {})[chaveAnexos()] ||= [];

function renderAnexosPend() {
  const el = $('#anexos-pend');
  if (!el) return;
  const l = anexosAtuais();
  el.hidden = !l.length;
  el.innerHTML = l.map((a, i) => `<div class="pend ${a.estado}" title="${esc(a.nome)}">${a.imagem && a.previa ? `<img src="${a.previa}" alt="">` : ic('copiar')}<span class="pn">${esc(a.nome)}</span><small>${a.estado === 'enviando' ? 'enviando' : a.estado === 'erro' ? esc(a.erro || 'falhou') : tamanhoTxt(a.tamanho)}</small><button data-anexo-rem="${i}" title="Tirar">${ic('fechar')}</button></div>`).join('');
}

async function anexarArquivos(arquivos) {
  const l = anexosAtuais();
  for (const f of [...arquivos]) {
    if (l.length >= 8) { aviso(I18N.t('No máximo 8 arquivos por mensagem.')); break; }
    const item = { nome: f.name || 'colado.png', tamanho: f.size, estado: 'enviando', imagem: /^image\/(png|jpe?g|gif|webp)$/.test(f.type), previa: /^image\//.test(f.type) ? URL.createObjectURL(f) : null };
    if (f.size > 25 * 1048576) { item.estado = 'erro'; item.erro = 'passa de 25 MB'; l.push(item); continue; }
    l.push(item);
    renderAnexosPend();
    try {
      const resp = await fetch(P(`/anexo?nome=${encodeURIComponent(item.nome)}`), { method: 'PUT', body: f, headers: { 'x-studio-anexo': '1', 'content-type': f.type || 'application/octet-stream' } });
      const j = await resp.json().catch(() => ({}));
      if (!resp.ok) { item.estado = 'erro'; item.erro = j.erro || 'falhou'; } else { Object.assign(item, j.anexo, { estado: 'ok' }); }
    } catch { item.estado = 'erro'; item.erro = 'sem conexão'; }
    renderAnexosPend();
  }
  renderAnexosPend();
}

function msgHtml(m, ant) {
  if (m.oculta) return ''; // fala repetida ou "Sem novidade": o app não mostra
  // ligação: o que foi dito por voz fica na transcrição da chamada, não no chat; só o bloco ```nota``` (o que ela pediu por escrito) entra
  if (m.voz) { const nota = /```nota\s*\n([\s\S]*?)```/.exec(m.texto || '')?.[1]?.trim(); if (!nota) return ''; m = { ...m, texto: nota }; }
  if (m.de === 'sistema') return `<div class="aviso-sis" id="msg-${m.id}">${esc(m.texto)}</div>`;
  const minha = m.de === 'voce';
  // participante de outra equipe: o perfil dele (foto, estilo) vem da equipe dele; se ela ainda não carregou, vale o que veio na mensagem
  const a = minha ? null : agente(m.de);
  const ext = !minha && !a && m.ext && String(m.de).startsWith('ext:') ? m.ext : null;
  const novo = !ant || ant.de !== m.de || new Date(m.em) - new Date(ant.em) > 5 * 60000;
  const cor = minha ? '#F6C75B' : ext ? (ext.cor || '#8fa3bf') : (a ? a.cor : '#fff');
  const p = J().presenca[m.de];
  const camChips = (m.caminhos || []).length
    ? `<div class="chips-cam">${m.caminhos.map((c) => `<span class="chip-cam ${c.dentro ? '' : 'fora'}" title="${esc(c.caminho)}${c.dentro ? '' : ` ${I18N.t('(fora do projeto: só leitura)')}`}">${ic(c.tipo === 'pasta' ? 'pasta' : 'copiar')}${esc(c.caminho.split(/[\\/]/).filter(Boolean).pop())}</span>`).join('')}</div>` : '';
  let corpo = '';
  if (minha) corpo = `<div class="texto corpo">${md(m.texto)}</div>${camChips}${anexosHtml(m.anexos)}`;
  else if (m.status === 'trabalhando') {
    corpo = `<div class="pensando" style="--c:${cor}"><span class="pontos"><i></i><i></i><i></i></span><span class="ativ">${esc(p?.atividade || 'começando')}</span><span class="t" data-desde="${p?.desde || Date.parse(m.em)}"></span><button class="btn-ic parar-msg" data-acao="parar-agente" data-ag="${esc(m.de)}" title="Parar esta chamada (inclusive se estiver na fila)">${ic('parar')}</button></div>
      <div class="texto corpo vivo" hidden></div>`;
  } else if (m.status === 'erro') corpo = `<div class="erro-msg">${ic('alerta')}<span>${esc(m.erro || 'Falhou.')}</span></div>`;
  else if (m.status === 'cancelado') corpo = '<div class="cancelado">Interrompido por você.</div>';
  else if (m.status === 'pausado') corpo = `<div class="cancelado">${esc(m.erro || 'Pausado para atender algo mais urgente; retoma em seguida.')}</div>`;
  else corpo = (m.texto ? `<div class="texto corpo">${md(m.texto)}</div>` : '') + (m.pergunta ? perguntaHtml(m) : '') + embedsHtml(m.resumo);
  if (m.relatorioTarefa) {
    const r=m.relatorioTarefa;
    corpo += `<div class="anexos-msg"><a class="anexo-arq relatorio-download" href="${P(`/cartao/${encodeURIComponent(r.card)}/relatorio?tipo=${encodeURIComponent(r.tipo)}&revisao=${r.revisao}&arquivo=${encodeURIComponent(r.nome)}`)}" download="${esc(r.nome)}">${ic('copiar')}<span>${I18N.t('Baixar {arquivo}', { arquivo: esc(r.nome) })}</span></a></div>`;
  }
  if (!minha && m.anexos?.length) corpo += anexosHtml(m.anexos);
  const dur = m.duracaoMs > 5000 ? `<span class="dur">${Math.round(m.duracaoMs / 1000)} s</span>` : '';
  const paraVoce = !minha && m.status === 'ok' && mencionaVoce(m.texto);
  return `<div class="msg ${novo ? 'topo' : ''} ${paraVoce ? 'para-voce' : ''}" id="msg-${m.id}" data-de="${esc(m.de)}" data-status="${esc(m.status || '')}" style="--c:${cor}">
    <div class="lado ${novo ? '' : 'hora'}">${novo ? (ext ? `<span class="av g" style="--c:${cor}" title="${esc(ext.nome)}, ${esc(ext.equipe)}">${ic('usuarios')}</span>` : av(m.de, 'g', { dot: false })) : hhmm(m.em)}</div>
    <div>
      ${novo ? `<div class="cab"><b>${ext ? esc(ext.nome) : nomeHtml(m.de, U.canal.startsWith('dm:') || !!a?.externo)}</b>${ext ? `<span class="cargo-m">${esc(ext.cargo || '')}${ext.cargo ? ', ' : ''}${I18N.t('equipe {equipe}', { equipe: esc(ext.equipe) })}</span>` : a?.cargo ? `<span class="cargo-m">${esc(a.cargo)}</span>` : ''}${m.de === liderAtual() ? '<span class="tag">LEAD</span>' : ''}<time>${hhmm(m.em)}</time>${dur}</div>` : ''}
      ${corpo}
    </div>
    ${m.status !== 'trabalhando' && (m.texto || m.anexos?.length) ? `<div class="copiar"><button class="btn-ic" data-acao="responder-msg" data-msg="${m.id}" title="Responder">${ic('setaE')}</button><button class="btn-ic" data-acao="encaminhar-msg" data-msg="${m.id}" title="Encaminhar para outro chat">${ic('setaD')}</button>${m.texto ? `<button class="btn-ic" data-copiar="${m.id}" title="Copiar">${ic('copiar')}</button>` : ''}</div>` : ''}
  </div>`;
}

function rolarSeColado(fn) {
  const m = $('#mensagens');
  if (!m) return fn();
  const colado = m.scrollHeight - m.scrollTop - m.clientHeight < 160;
  fn();
  if (colado) m.scrollTop = m.scrollHeight;
}
const naTela = (pid, canal) => pid === U.proj && U.vista === 'chat' && U.canal === canal;

function addMsg(pid, msg) {
  const j = PJ[pid];
  if (!j) return;
  if (msg.canal.startsWith('pst-')) { const l = j.canais[msg.canal]; if (l && !l.some((x) => x.id === msg.id)) l.push(msg); return; } // a conversa do post aparece no feed
  const lista = j.canais[msg.canal];
  if (lista) {
    if (lista.some((x) => x.id === msg.id)) return;
    lista.push(msg);
  }
  if (naTela(pid, msg.canal) && lista) {
    rolarSeColado(() => {
      const ant = lista[lista.length - 2] || null;
      const mm = $('#mensagens');
      const mesmoDia = ant && new Date(ant.em).toDateString() === new Date(msg.em).toDateString();
      if (!mesmoDia) mm.insertAdjacentHTML('beforeend', `<div class="sep-dia">${esc(diaTxt(msg.em))}</div>`);
      mm.insertAdjacentHTML('beforeend', msgHtml(msg, mesmoDia ? ant : null));
    });
  } else if (msg.de !== 'voce' && msg.status !== 'trabalhando' && !msg.oculta) {
    j.naoLidas[msg.canal] = (j.naoLidas[msg.canal] || 0) + 1;
    renderRail(); if (pid === U.proj && U.vista === 'chat') renderLista();
  }
}
function updMsg(pid, msg) {
  const j = PJ[pid];
  if (!j) return;
  if (msg.status !== 'trabalhando') ultimoDelta.delete(msg.id);   // desenho de streaming atrasado nunca sobrescreve a mensagem final
  if (msg.canal.startsWith('pst-')) { const l = j.canais[msg.canal]; const i = l ? l.findIndex((x) => x.id === msg.id) : -1; if (i >= 0) l[i] = msg; if (U.proj === pid && U.vista === 'chat' && U.canal === 'posts') renderPostsSuave(); return; }
  const lista = j.canais[msg.canal];
  const i = lista ? lista.findIndex((x) => x.id === msg.id) : -1;
  if (i >= 0) lista[i] = msg;
  if (naTela(pid, msg.canal)) {
    const el = $(`#msg-${msg.id}`);
    if (el) rolarSeColado(() => { el.outerHTML = msgHtml(msg, i > 0 && new Date(lista[i - 1].em).toDateString() === new Date(msg.em).toDateString() ? lista[i - 1] : null); });
  } else if ((msg.status === 'ok' || msg.status === 'erro') && !msg.oculta) {
    j.naoLidas[msg.canal] = (j.naoLidas[msg.canal] || 0) + 1;
    renderRail(); if (pid === U.proj && U.vista === 'chat') renderLista();
  }
}
const ultimoDelta = new Map();
function deltaMsg(e) {
  if (!naTela(e.projeto, e.canal)) return;
  ultimoDelta.set(e.id, e);
  depois(`delta-${e.id}`, () => {
    const d = ultimoDelta.get(e.id); ultimoDelta.delete(e.id);
    if (!d || !naTela(d.projeto, d.canal)) return;
    const el = $(`#msg-${d.id} .corpo`);
    if (!el) return;
    const t = limparBloco(d.texto);
    rolarSeColado(() => { el.hidden = !t; el.innerHTML = md(t); });
  });
}

/* ---- compositor e menções ---- */
function autoAltura(ta) { if (!ta) return; ta.style.height = 'auto'; ta.style.height = `${Math.min(200, ta.scrollHeight)}px`; }
/* ---- responder uma mensagem e encaminhar para outro chat ---- */
// A resposta vai como citação no começo do texto ("> @Autor: trecho"): você vê a citação no chat e o agente citado é chamado,
// sem formato novo no servidor. O @ de dentro do trecho é desarmado para não chamar mais ninguém.
const trechoDe = (m, max = 160) => { const t = limparBloco(m.texto || '').replace(/\s+/g, ' ').replace(/@/g, '').trim(); return (t.length > max ? `${t.slice(0, max)}…` : t) || `${m.anexos?.length || 0} anexo(s)`; };
const autorMarca = (de) => (de === 'voce' ? usuarioDe().nome : String(de).startsWith('ext:') ? nomeAgente(de) : `@${nomeAgente(de)}`);
const msgDe = (id) => (J().canais[U.canal] || []).find((x) => x.id === id);
function respostaHtml() {
  const r = U.resposta?.[`${U.proj}/${U.canal}`];
  return r ? `<div class="respondendo">${ic('setaE')}<span>${I18N.t('Respondendo a <b>{nome}</b>: {trecho}', { nome: esc(nomeAgente(r.de)), trecho: esc(r.trecho) })}</span><button class="btn-ic" data-acao="cancelar-resposta" title="Cancelar">${ic('fechar')}</button></div>` : '';
}
function responderMsg(id) {
  const m = msgDe(id); if (!m) return;
  (U.resposta ||= {})[`${U.proj}/${U.canal}`] = { id, de: m.de, trecho: trechoDe(m) };
  renderChat(); $('#texto')?.focus();
}
/** Todos os chats do projeto, de todas as equipes: canais, grupos e DMs (a equipe aberta primeiro). */
function chatsDoProjeto() {
  const eqs = equipesDoProjeto(projetoAtual()).slice().sort((a, b) => (b.cid === U.proj) - (a.cid === U.proj));
  return eqs.map((e) => { const j = PJ[e.cid]; if (!j) return null;
    const l = [{ canal: 'equipe', nome: '#equipe' }, ...(j.grupos || []).filter((g) => g.status === 'ativo').map((g) => ({ canal: g.canal, nome: g.titulo })), ...(j.roster || []).map((a) => ({ canal: `dm:${a.id}`, nome: a.nome, cargo: a.cargo }))];
    return { cid: e.cid, nome: e.nome, chats: l };
  }).filter(Boolean);
}
function encaminharMsg(id) {
  const m = msgDe(id); if (!m) return;
  U.encaminhar = { m, de: U.proj, canal: U.canal };
  abrirModal(`<div class="inbox-topo"><h2>Encaminhar mensagem</h2><span class="espaco"></span><button class="btn-ic" data-acao="fechar">${ic('fechar')}</button></div>
    <div class="enc-previa"><b>${esc(nomeAgente(m.de))}</b>: ${esc(trechoDe(m, 220))}</div>
    <input class="in" id="enc-busca" placeholder="Buscar chat" autocomplete="off">
    <div class="enc-lista">${chatsDoProjeto().map((e) => `<div class="cat">${esc(e.nome)}</div>${e.chats.map((c) => `<button class="canal" data-acao="encaminhar-para" data-cid="${esc(e.cid)}" data-para="${esc(c.canal)}" data-busca="${esc(semAcento(`${c.nome} ${c.cargo || ''} ${e.nome}`))}">${c.canal.startsWith('dm:') ? av(c.canal.slice(3), 'p', { dot: false }) : ic(c.canal === 'equipe' ? 'hash' : 'usuarios')}<span class="nome">${esc(c.nome)}${c.cargo ? `<small class="cargo-mini">${esc(c.cargo)}</small>` : ''}</span></button>`).join('')}`).join('')}</div>`, 'enc-modal');
  $('#enc-busca').oninput = (ev) => { const q = semAcento(ev.target.value); for (const b of document.querySelectorAll('.enc-lista .canal')) b.hidden = !!q && !b.dataset.busca.includes(q); };
  $('#enc-busca').focus();
}
async function encaminharPara(cid, canal) {
  const x = U.encaminhar; if (!x) return;
  const origem = x.canal === 'equipe' ? '#equipe' : nomeCanal(x.canal);
  const corpo = limparBloco(x.m.texto || '').replace(/@/g, '').split('\n').map((l) => `> ${l}`).join('\n');
  const texto = `Encaminhada de ${x.m.de === 'voce' ? usuarioDe().nome : nomeAgente(x.m.de)} (${origem}${cid !== x.de ? `, ${equipeDe(x.de)?.nome || 'outra equipe'}` : ''}):\n${corpo}`;
  // os anexos só acompanham dentro da mesma equipe (cada equipe guarda os seus na própria pasta)
  const anexos = cid === x.de ? (x.m.anexos || []).map((a) => ({ rel: a.rel })) : [];
  const r = await api('POST', P('/mensagem', cid), { canal, texto, engine: E.config.engine, modo: E.config.modo, anexos });
  if (!r._ok) return aviso(r.erro || I18N.t('Não consegui encaminhar.'));
  fecharModal(); U.encaminhar = null;
  if (cid === U.proj) addMsg(cid, r);
  aviso(I18N.t('Encaminhada para {destino}{equipe}.', { destino: canal === 'equipe' ? '#equipe' : (PJ[cid]?.roster || []).find((a) => `dm:${a.id}` === canal)?.nome || nomeCanal(canal), equipe: cid !== x.de ? ` (${equipeDe(cid)?.nome})` : '' }));
}

async function enviar() {
  const ta = $('#texto');
  const texto = ta.value.trim();
  const pend = anexosAtuais();
  if (pend.some((a) => a.estado === 'enviando')) return aviso(I18N.t('Espere o envio dos anexos terminar.'));
  const prontos = pend.filter((a) => a.estado === 'ok');
  if (!texto && !prontos.length) return;
  const chaveR = `${U.proj}/${U.canal}`; const resp = U.resposta?.[chaveR];
  // texto livre depois de "Responder…": vai como resposta da pergunta (fecha ela), não como mensagem solta
  const qLivre = U.respPergunta?.[chaveR];
  if (qLivre && texto && !prontos.length && J().perguntas.some((x) => x.id === qLivre && x.estado === 'aberta' && !x.paraPO)) {
    delete U.respPergunta[chaveR];
    const limpo = texto.replace(/^@\S+\s*/, '');
    ta.value = ''; U.rascunhos[chaveR] = ''; autoAltura(ta);
    if (!(await responderPergunta(U.proj, qLivre, limpo || texto))) ta.value = texto;
    return;
  }
  const textoFinal = resp ? `> ${autorMarca(resp.de)}: ${resp.trecho}\n\n${texto}` : texto;
  ta.value = ''; U.rascunhos[`${U.proj}/${U.canal}`] = ''; autoAltura(ta);
  if (resp) { delete U.resposta[chaveR]; $('.respondendo')?.remove(); }
  const r = await api('POST', P('/mensagem'), { canal: U.canal, texto: textoFinal, engine: E.config.engine, modo: E.config.modo, anexos: prontos.map((a) => ({ rel: a.rel })) });
  if (!r._ok) { aviso(r.erro || I18N.t('Não consegui enviar.')); ta.value = texto; if (resp) U.resposta[chaveR] = resp; return; }
  pend.splice(0).forEach((a) => a.previa && URL.revokeObjectURL(a.previa));
  renderAnexosPend();
  addMsg(U.proj, r);
}
let sugSel = 0;
function sugestoes() {
  const ta = $('#texto'); const box = $('#sugestoes');
  if (!ta || !box) return;
  const m = /(^|\s)@([\p{L}_]*)$/u.exec(ta.value.slice(0, ta.selectionStart));
  if (!m) { box.hidden = true; return; }
  const q = m[2].toLowerCase();
  const bate = (a) => !q || [a.nome, a.cargo, a.token || MENCOES[a.id]].some((x) => x && semAcento(x).startsWith(semAcento(q)));
  // os nomes são os que você deu a cada um (perfil); gente das outras equipes entra em seções separadas, por equipe
  const locais = [...(!q || 'todos'.startsWith(semAcento(q)) ? [{ id: '__todos', nome: 'todos', cargo: 'avisa o time inteiro' }] : []), ...(!q || 'image'.startsWith(semAcento(q)) || 'imagem'.startsWith(semAcento(q)) ? [{ id: '__image', nome: 'Image', cargo: 'gera uma imagem com o Codex' }] : []), ...rosterAtual().filter(bate)];
  const externos = (J().externos || []).filter((x) => !rosterAtual().some((a) => semAcento(primeiroNome(a.nome)) === semAcento(x.token))).filter(bate).map((x) => ({ id: `ext:${x.agente}@${x.cid}`, nome: x.nome, cargo: x.cargo, token: x.token, equipe: x.equipe, cor: x.cor, lider: x.lider }));
  const secoes = [[J().equipeNome ? I18N.t('Esta equipe ({equipe})', { equipe: J().equipeNome }) : I18N.t('Esta equipe'), locais], ...Object.entries(externos.reduce((acc, x) => { (acc[x.equipe] ||= []).push(x); return acc; }, {}))].filter(([, l]) => l.length);
  const lista = secoes.flatMap(([, l]) => l);
  if (!lista.length) { box.hidden = true; return; }
  sugSel = Math.min(sugSel, lista.length - 1);
  box.hidden = false;
  box._lista = lista;
  let i = 0;
  box.innerHTML = secoes.map(([tit, l]) => `<div class="cab-sug">${esc(tit)}</div>${l.map((a) => { const k = i++; return `<button data-mencao="${esc(a.id)}" class="${k === sugSel ? 'sel' : ''}">${a.id === '__image' ? `<span class="av p todos">${ic('imagem')}</span>` : a.id === '__todos' ? '<span class="av p todos">@</span>' : av(a.id, 'p', { dot: false })}<b>${esc(a.nome)}</b>${a.lider ? '<span class="tag">LEAD</span>' : ''}<small>${esc(a.cargo)}</small></button>`; }).join('')}`).join('');
}
function inserirMencao(id) {
  const ta = $('#texto'); const pos = ta.selectionStart;
  const ext = String(id).startsWith('ext:') ? ($('#sugestoes')._lista || []).find((x) => x.id === id) : null;
  const antes = ta.value.slice(0, pos).replace(/@([\p{L}_]*)$/u, `@${id === '__todos' ? 'todos' : id === '__image' ? 'Image' : ext ? (ext.token || primeiroNome(ext.nome)) : primeiroNome(agente(id).nome)} `);
  ta.value = antes + ta.value.slice(pos);
  ta.selectionStart = ta.selectionEnd = antes.length;
  $('#sugestoes').hidden = true; autoAltura(ta); ta.focus();
}
async function responderPergunta(pid, qid, texto) {
  const r = await api('POST', P(`/perguntas/${qid}/responder`, pid), { texto });
  if (!r._ok) aviso(r.erro || I18N.t('Não consegui responder.'));
  return r._ok;
}

/* ------------------------------------------------------------ painel da direita */
function usoHtml() {
  const u = E.uso?.motores?.[U.usoMotor] || (U.usoMotor === 'claude' ? E.uso : null);
  const pz = Object.entries(E.pausas || {}).filter(([, p]) => p.ate * 1000 > Date.now()).map(([eng, p]) => `<div class="uso-pausa">${ic('relogio')}<span>${I18N.t('{motor} parado, volta {quando}', { motor: eng === 'codex' ? 'Codex' : 'Claude', quando: `${diaCurto(p.ate * 1000) === 'hoje' ? '' : `${I18N.t(diaCurto(p.ate * 1000))} `}${horaCurta(p.ate * 1000)}` })}</span></div>`).join('');   // com a data quando a volta não é hoje (limite semanal)
  const cs = J().cartoes;
  const tot = cs.reduce((s, c) => s + (c.pontos || 0), 0);
  const feito = cs.filter((c) => c.coluna === 'concluido').reduce((s, c) => s + (c.pontos || 0), 0);
  const prog = tot ? `<div class="uso-l" title="${I18N.t('Pontos concluídos: {feitos} de {total}', { feitos: feito, total: tot })}"><span>Feito</span><i class="uso-b"><b class="ok" style="width:${Math.round(100 * feito / tot)}%"></b></i><em>${Math.round(100 * feito / tot)}%</em></div>` : '';
  // o painel sempre mostra o piloto, mesmo sem leitura de uso ainda
  const faixa = (p) => (p >= 90 ? 'crit' : p >= 75 ? 'alto' : p >= 50 ? 'med' : '');
  const lin = (rot, dica, w) => (w ? `<div class="uso-l" title="${dica}: ${w.pct}%"><span>${rot}</span><i class="uso-b"><b class="${faixa(w.pct)}" style="width:${Math.min(100, w.pct)}%"></b></i><em>${w.pct}%</em></div>` : '');
  const pil = E.config.piloto || {};
  const assessorAuto = E.config.ciclo?.assessorAuto !== false;
  const piloto = `<button class="piloto ${pil.ativo ? 'on' : ''}" data-acao="piloto" title="${pil.ativo ? 'O time segue sozinho enquanto o app estiver aberto' : 'Liga para o time seguir sozinho enquanto você estiver fora'}"><i class="chave-p"></i><span>Piloto automático</span><em>${pil.ativo ? 'ligado' : 'desligado'}</em></button>`
    + (templateId() === 'professional-operations' ? `<button class="piloto assessor ${assessorAuto ? 'on' : ''}" data-acao="assessor-auto" title="${assessorAuto ? 'O assessor procura o que adiantar para você quando aparece sinal novo (agenda, Jira, outras equipes). Sem sinal novo, fica quieto.' : 'Ligue para o assessor tomar a iniciativa; desligado, ele só faz o que você pedir.'}"><i class="chave-p"></i><span>Assessor por conta própria</span><em>${assessorAuto ? 'ligado' : 'desligado'}</em></button><div class="linha-in assessor-botoes"><button class="btn-sec ronda" data-acao="ronda-assessor" title="Uma ronda agora: ele olha agenda, Jira, equipes e quadro e te diz o que adiantou ou propõe">Olhar agora</button><button class="btn-sec ronda" data-acao="iniciativas" title="O que o assessor decidiu fazer, em que pé está e o que depende de você">Iniciativas${(J().iniciativasResumo?.aguardandoVoce || 0) ? ` <b class="pip-ini">${J().iniciativasResumo.aguardandoVoce}</b>` : ''}</button><button class="btn-sec ronda" data-acao="desde" title="O que aconteceu desde a última vez que você esteve aqui, calculado pelo app">O que aconteceu</button></div>` : '');
  const tabs = `<div class="seg uso-tabs" role="tablist" aria-label="Uso da assinatura">${['claude', 'codex'].map(e => `<button role="tab" aria-selected="${U.usoMotor === e}" class="${U.usoMotor === e ? 'on' : ''}" data-uso-motor="${e}">${e === 'codex' ? 'Codex' : 'Claude'}</button>`).join('')}</div>`;
  const janela = (key, fallback) => { const w = u?.[key]; return w ? lin(w.minutos ? (w.minutos >= 1440 ? `${Math.round(w.minutos / 1440)} d` : `${Math.round(w.minutos / 60)} h`) : fallback, `${U.usoMotor}: ${I18N.t('uso da janela')}${w.resetsAt ? ', ' + I18N.t('renova {data}', { data: new Date(w.resetsAt * 1000).toLocaleString(I18N.locale) }) : ''}`, w) : ''; };
  const mot = J().motores?.[U.usoMotor];
  const nomeM = U.usoMotor === 'codex' ? 'Codex' : 'Claude';
  const MODELOS_TETO = U.usoMotor === 'codex' ? { low: 'Luna', medium: 'Terra', high: 'Sol' } : { low: 'Haiku 4.5 e Sonnet 4.6', medium: 'até Sonnet 5.5', high: 'libera Opus 5 e Opus 5.5' };
  const controle = mot ? `<div class="motor-ctl">
      <button class="motor-liga ${mot.ativo ? 'on' : ''}" data-acao="motor-ativo" data-eng="${U.usoMotor}" title="${mot.ativo ? I18N.t('Desligar o {motor} neste projeto', { motor: nomeM }) : I18N.t('Ligar o {motor} neste projeto', { motor: nomeM })}"><i class="chave-p"></i><span>${I18N.t('Usar o {motor} neste projeto', { motor: nomeM })}</span><em>${mot.ativo ? 'ligado' : 'desligado'}</em></button>
      ${mot.ativo ? `<div class="motor-esforco"><span class="rot">Limite de esforço</span>
        <div class="seg motor-teto" role="radiogroup" aria-label="${I18N.t('Limite de esforço do {motor}', { motor: nomeM })}">${[['auto', 'Auto'], ['low', 'Low'], ['medium', 'Medium'], ['high', 'High']].map(([v, n]) => `<button role="radio" aria-checked="${mot.teto === v}" class="${mot.teto === v ? 'on' : ''}" data-acao="motor-teto" data-eng="${U.usoMotor}" data-teto="${v}" title="${v === 'auto' ? 'A Cris decide pelo uso da conta' : I18N.t('Teto {nivel}: {modelos}', { nivel: v, modelos: I18N.t(MODELOS_TETO[v]) })}">${n}</button>`).join('')}</div>
        <small class="uso-data" title="Low usa só os modelos mais baratos. Medium chega ao Sonnet 5.5. High libera o Opus.">Agora: <b>${mot.efetivo.teto}</b> (${I18N.t(MODELOS_TETO[mot.efetivo.teto])})${mot.efetivo.auto ? (mot.efetivo.motivo ? `, ${esc(mot.efetivo.motivo)}` : '') : `, ${I18N.t('fixado por você')}`}</small></div>` : ''}
      <small class="uso-data">${I18N.t('{feitas} de {total} chamadas nas últimas 24 h', { feitas: mot.chamadas24h, total: mot.total24h })}</small>
      ${(() => { const pisos = { ...(E.config.creditos?.pisos || {}) }; const ld = liderAtual(); if (ld && !pisos[ld]) pisos[ld] = 'medio'; const pi = Object.entries(pisos).filter(([id, v]) => v && rosterAtual().some((a) => a.id === id)); return pi.length ? `<small class="uso-data" title="O menor modelo de cada cargo. Vale mesmo com o uso alto. Quem lidera a equipe tem Sonnet 5.5 no mínimo.">${I18N.t('Piso de modelo: {lista}', { lista: esc(pi.map(([id, v]) => `${nomeAgente(id)} ${v === 'forte' ? 'Opus' : 'Sonnet 5.5'}`).join(', ')) })}</small>` : ''; })()}
    </div>` : '';
  return `<div class="uso">${piloto}${tabs}${controle}${pz}${u?.cinco || u?.sete || u?.extra ? janela('cinco', '5 h') + janela('sete', '7 d') + (u.extra ? lin('Extra', `${I18N.t('Créditos extras')} ${u.extra.emUso ? I18N.t('(em uso)') : I18N.t('(ainda não usados; o plano cobre)')}${u.extra.resetsAt ? `, ${I18N.t('renovam {data}', { data: new Date(u.extra.resetsAt * 1000).toLocaleDateString(I18N.locale) })}` : ''}`, u.extra) : '') + (() => { const velho = [u.cinco, u.sete].filter((w) => w && !w.estimado).some((w) => w.lido ? Date.now() - Date.parse(w.lido) > 45 * 60_000 : true); return `<small class="uso-data">${u.extra && (velho || !u.cinco || u.cinco.estimado) ? I18N.t('Créditos extras lidos às {hora}. O Claude Code agora informa só o limite dos extras: 5 h e semana podem estar defasados.', { hora: esc(hhmm(u.extra.lido || u.em)) }) : I18N.t('Atualizado {hora}', { hora: esc(hhmm(u.em)) })}</small>`; })() : '<small class="uso-data">Aguardando leitura desta conta</small>'}<button class="btn-sec uso-relatorio" data-acao="relatorio-creditos">Relatório de consumo</button>${prog}</div>`;
}

const horaCurta = (ts) => new Date(ts).toLocaleTimeString(I18N.locale, { hour: '2-digit', minute: '2-digit' });
const diaCurto = (ts) => (new Date(ts).toDateString() === new Date().toDateString() ? 'hoje' : new Date(ts).toLocaleDateString(I18N.locale, { weekday: 'short', day: '2-digit', month: '2-digit' }));

function agendaMini() {
  const ig = J().integ;
  if (!ig?.agenda?.ativo || !ig.cache?.agenda?.em) return '';
  const agora = Date.now();
  const ev = (ig.cache.agenda.eventos || []).filter((e) => e.fimTs >= agora && !e.dia);
  const prox = ['review', 'daily'].map((t) => ev.find((e) => e.tipo === t)).filter(Boolean);
  const outros = ev.filter((e) => !prox.includes(e)).slice(0, Math.max(0, 3 - prox.length));
  const lista = [...prox, ...outros].sort((a, b) => a.ts - b.ts);
  if (!lista.length) return '';
  return `<div class="cat">Agenda</div>${lista.map((e) => `<button class="ag-i ${e.tipo}" data-acao="demandas" title="${esc(e.titulo)}"><span class="ag-h">${I18N.t(diaCurto(e.ts))}<b>${horaCurta(e.ts)}</b></span><span class="ag-t">${esc(e.titulo)}</span></button>`).join('')}`;
}

function renderMembros() {
  const el = $('#membros');
  const j = J();
  const em = j.cartoes.filter((c) => c.coluna === 'andamento');
  const rev = j.cartoes.filter((c) => ['revisao', 'qa'].includes(c.coluna));
  const vivos = new Set(Object.values(j.presenca).filter((p) => p.estado === 'trabalhando' && p.card).map((p) => p.card));
  em.sort((a, b) => (vivos.has(b.id) - vivos.has(a.id)) || (new Date(b.atualizado) - new Date(a.atualizado)));
  const bloq = j.cartoes.filter((c) => (c.bloqueio || c.aguardando) && !em.includes(c) && !rev.includes(c));
  const w = j.wip.andamento || { n: 0, limite: 3 };
  const barras = w.limite ? Array.from({ length: w.limite }, (_, i) => `<i class="${i < w.n ? 'on' : ''}"></i>`).join('') : '';
  const mini = (c) => {
    const trab = vivos.has(c.id);
    const cor = c.dono ? agente(c.dono).cor : '#F3AA3C';
    return `<button class="mini ${trab ? 'vivo' : ''}" data-issue="${c.id}" style="--c:${cor}">
      ${c.dono ? av(c.dono, 'p', { dot: false }) : ''}
      <span class="txt"><span class="k">${esc(c.id)}</span><span class="t">${esc(c.titulo)}</span>
        <span class="r">${loz(c.coluna)}${c.bloqueio ? '<span class="loz bloq">Bloqueado</span>' : ''}${c.aguardando ? '<span class="loz andamento">Aguardando você</span>' : ''}</span></span></button>`;
  };
  const membro = (a) => {
    const p = j.presenca[a.id];
    const sub = aguardandoVoce(a.id) ? 'Aguardando você' : p ? `${p.estado === 'fila' ? I18N.t('Na fila') : esc(p.atividade || I18N.t('Trabalhando'))}${p.card ? ` ${I18N.t('em {card}', { card: esc(p.card) })}` : ''}` : esc(a.cargo);
    return `<button class="membro ${placaCls(a.id)}" data-canal="dm:${a.id}" style="--c:${a.cor}">${av(a.id, 'm')}<span class="info"><span class="nm">${nomeHtml(a.id)}${a.id === liderAtual() ? '<span class="tag">LEAD</span>' : ''}</span><small class="${p || aguardandoVoce(a.id) ? 'viva' : ''}">${sub}${p && p.estado === 'trabalhando' ? ` <span data-desde="${p.desde}"></span>` : ''}</small></span></button>`;
  };
  el.innerHTML = `
    <div class="lista-topo"><span>Andamento</span><span class="meter ${w.limite && w.n >= w.limite ? 'cheio' : ''}" style="margin-left:auto">${barras}</span></div>
    <div class="rolagem">
      ${usoHtml()}
      ${agendaMini()}
      <div class="cat">${I18N.t('Em andamento — {n}', { n: em.length })}</div>
      ${em.length ? em.map(mini).join('') : '<div class="vazio-p">Nada em andamento.</div>'}
      ${rev.length ? `<div class="cat">${I18N.t('Revisão e QA — {n}', { n: rev.length })}</div>${rev.map(mini).join('')}` : ''}
      ${bloq.length ? `<div class="cat">${I18N.t('Parados — {n}', { n: bloq.length })}</div>${bloq.map(mini).join('')}` : ''}
      <div class="cat">Lead — 1</div>
      ${agente(liderAtual()) ? membro(agente(liderAtual())) : ''}
      <div class="cat">${I18N.t('Especialistas — {n}', { n: rosterDaEquipe().filter((a) => a.id !== liderAtual() && !a.sistema).length })}</div>
      ${rosterDaEquipe().filter((a) => a.id !== liderAtual() && !a.sistema).map(membro).join('')}
    </div>`;
}

/* ------------------------------------------------------------ planner */
function filtrados() {
  const q = U.busca.trim().toLowerCase();
  return J().cartoes.filter((c) => (!U.filtro.size || U.filtro.has(c.dono)) && (!U.soBloq || c.bloqueio || c.aguardando)
    && (!q || `${c.id} ${c.titulo} ${c.descricao}`.toLowerCase().includes(q)));
}
// Trilha do card: entrega, verificações, revisão, documentação, testes e aceite. Cheio = feito, vermelho = falhou,
// o primeiro vazio é o que o time está tentando agora. Dá para ver o card andar sem abrir nada.
function trilhaHtml(c) {
  const p = c.prontidao;
  if (!p || ['backlog', 'pronto', 'concluido'].includes(c.coluna)) return '';
  const prox = p.etapas.findIndex((e) => !e.ok);
  const segs = p.etapas.map((e, i) => `<i class="${e.ok ? 'ok' : e.falhou ? 'falhou' : i === prox ? 'agora' : ''}" title="${esc(e.nome)}${e.ok ? `: ${I18N.t('pronto')}` : e.falhou ? `: ${I18N.t('não passou')}` : i === prox ? `: ${I18N.t('em andamento')}` : ''}"></i>`).join('');
  const falta = c.coluna !== 'impedimento' && p.falta?.length ? `<div class="trilha-falta" title="${esc(p.falta.join('\n'))}">${esc(p.falta[0])}</div>` : '';
  return `<div class="trilha">${segs}</div>${falta}`;
}
function cardHtml(c, vivos) {
  const dono = c.dono ? agente(c.dono) : null;
  const trab = vivos[c.id];
  const ok = c.aceite.filter((a) => a.ok).length;
  const tipo = /^STUDIO/.test(c.id) ? 'infra' : '';
  return `<article class="card ${c.coluna === 'concluido' ? 'feito' : ''}" draggable="true" data-id="${c.id}" ${trab ? `style="--c:${agente(trab).cor}"` : ''}>
    ${trab ? '<i class="vivo-bar"></i>' : ''}
    <div class="titulo">${esc(c.titulo)}</div>
    ${dono || c.bloqueio || c.aguardando || c.modelo || c.motor || c.jira ? `<div class="etiquetas">${c.jira ? `<span class="etq jira" title="Demanda no Jira">${esc(c.jira)}</span>` : ''}${c.modelo || c.motor ? `<span class="etq modelo ${c.motor === 'codex' ? 'codex' : ''}">${c.motor === 'codex' ? 'Codex' : esc(NOME_MODELO[c.modelo] || c.modelo)}${c.esforco ? ` ${esc(c.esforco)}` : ''}</span>` : ''}${dono ? `<span class="etq" style="--c:${dono.cor}">${esc(dono.nome)}</span>` : ''}${c.aguardando ? `<span class="etq aguarda">${ic('sino')}Aguardando você</span>` : ''}${c.bloqueio ? `<span class="etq bloq" title="${c.bloqueioPor === 'voce' ? 'Parado por você: só você libera' : 'A P.O. analisa e tenta desimpedir'}">${ic('bandeira')}${c.bloqueioPor === 'voce' ? 'Parado por você' : `${I18N.t('Bloqueado')}${c.bloqueioPor && c.bloqueioPor !== 'sistema' ? ` ${I18N.t('por {nome}', { nome: esc(nomeAgente(c.bloqueioPor)) })}` : ''}`}</span>` : ''}</div>` : ''}
    ${(() => { const n = (c.ressalvas || []).filter((r) => r.status === 'aberta').length; return n ? `<div class="etiquetas"><span class="etq bloq" title="Aviso aberto: a P.O. direciona quem resolve. Nada avança com ressalva aberta.">${ic('alerta')}${I18N.t(n === 1 ? '{n} ressalva' : '{n} ressalvas', { n })}</span></div>` : ''; })()}${c.coluna === 'concluido' && c.validacao?.status === 'pendente' ? `<div class="etiquetas"><span class="etq aguarda">${ic('sino')}Aguardando sua validação</span></div>` : ''}
    ${trilhaHtml(c)}
    ${trab ? `<div class="quem-vivo"><span class="pontos"><i></i><i></i><i></i></span>${esc(nomeAgente(trab))} ${esc(J().presenca[trab].atividade || I18N.t('trabalhando'))}</div>` : ''}
    <div class="rodape"><span class="tipo ${tipo}">${ic('check')}</span><span class="chave">${esc(c.id)}</span><span class="esp"></span>
      ${c.aceite.length ? `<span class="sub">${ic('checkq')}${ok}/${c.aceite.length}</span>` : ''}
      ${c.pontos ? `<span class="pts" title="Esforço em pontos">${c.pontos}</span>` : ''}
      <span class="prio ${c.prioridade}" title="${I18N.t('Prioridade {nivel}', { nivel: I18N.t(nomePrio[c.prioridade]) })}">${ic(iconePrio[c.prioridade])}</span>
      ${(c.participantes || []).slice(0, 3).map((p) => `<span class="part ${p.papel}" title="${esc(nomeAgente(p.agente))}, ${I18N.t(p.papel === 'monitora' ? 'monitora' : 'colabora')}">${av(p.agente, 'p', { dot: false })}</span>`).join('')}
      ${dono ? av(dono.id, 'p', { dot: false }) : `<span class="av p"><svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round">${IC.usuario}</svg></span>`}</div>
    <div class="card-acoes"><button data-card-comentar="${c.id}" title="Comentar">${ic('chat')}</button><button data-card-remover="${c.id}" title="Cancelar tarefa (exclui o card)">${ic('lixo')}</button></div>
  </article>`;
}
function quadroHtml() {
  const j = J();
  const vivos = {};
  for (const [ag, p] of Object.entries(j.presenca)) if (p.estado === 'trabalhando' && p.card) vivos[p.card] = ag;
  const ord = { alta: 0, normal: 1, baixa: 2 };
  const todos = filtrados();
  return `<div class="quadro" id="quadro">${E.colunas.map((col) => {
    let cs = todos.filter((c) => c.coluna === col.id);
    if (col.id === 'concluido') cs.sort((a, b) => new Date(b.atualizado) - new Date(a.atualizado));
    else cs.sort((a, b) => (ord[a.prioridade] - ord[b.prioridade]) || (new Date(a.criado) - new Date(b.criado)));
    const total = cs.length;
    const w = j.wip[col.id] || {};
    const corte = col.id === 'concluido' && !U.todosConcluidos && cs.length > 8;
    if (corte) cs = cs.slice(0, 8);
    const real = j.cartoes.filter((c) => c.coluna === col.id).length;
    const estouro = w.limite && real > w.limite;
    return `<section class="coluna" data-col="${col.id}">
      <div class="col-topo"><h3>${esc(col.nome)}</h3><span class="n">${total}</span>${cs.some((c) => c.pontos) ? `<span class="max">${cs.reduce((s, c) => s + (c.pontos || 0), 0)} pt</span>` : ''}${w.limite ? `<span class="max ${estouro ? 'estouro' : ''}">${I18N.t('MÁX {n}', { n: w.limite })}</span>` : ''}</div>
      <div class="pilha-cards">${cs.map((c) => cardHtml(c, vivos)).join('')}</div>
      ${corte ? `<button class="mostrar-mais" data-acao="todos-concluidos">${I18N.t('Mostrar todos ({n})', { n: total })}</button>` : ''}
      ${['backlog', 'pronto'].includes(col.id) ? `<button class="add-card" data-acao="criar" data-col="${col.id}">${ic('mais')}Criar tarefa</button>` : ''}
    </section>`;
  }).join('')}</div>`;
}
function listaHtml() {
  const ord = { alta: 0, normal: 1, baixa: 2 };
  const ordemCol = Object.fromEntries(E.colunas.map((c, i) => [c.id, i]));
  const cs = filtrados().sort((a, b) => (ordemCol[a.coluna] - ordemCol[b.coluna]) || (ord[a.prioridade] - ord[b.prioridade]));
  return `<div class="tabela-wrap"><table class="lista-t"><thead><tr><th></th><th>Chave</th><th>Resumo</th><th>Responsável</th><th>Prioridade</th><th>Pontos</th><th>Etapa</th><th>Há</th></tr></thead><tbody>
    ${cs.map((c) => `<tr class="linha" data-issue="${c.id}">
      <td><span class="tipo ${/^STUDIO/.test(c.id) ? 'infra' : ''}">${ic('check')}</span></td>
      <td class="chave">${esc(c.id)}</td><td class="res">${esc(c.titulo)} ${c.bloqueio ? '<span class="loz bloq">Bloqueado</span>' : ''}${c.aguardando ? ' <span class="loz andamento">Aguardando você</span>' : ''}</td>
      <td>${c.dono ? `<span class="quem">${av(c.dono, 'p', { dot: false })}${esc(nomeAgente(c.dono))}</span>` : '<span style="color:var(--mudo)">Sem dono</span>'}</td>
      <td><span class="prio ${c.prioridade}" style="display:inline-grid;vertical-align:middle">${ic(iconePrio[c.prioridade])}</span> ${nomePrio[c.prioridade]}</td>
      <td>${c.pontos ? `<span class="pts">${c.pontos}</span>` : ''}</td><td>${loz(c.coluna)}</td><td style="color:var(--mudo)">${idade(c.naColunaDesde)}</td></tr>`).join('')}
    </tbody></table>${cs.length ? '' : '<div class="vazio-p" style="padding:24px">Nenhuma tarefa com esses filtros.</div>'}</div>`;
}
// Atualiza o quadro sem piscar a tela inteira: o card que mudou de lugar desliza até o novo (FLIP), e o que
// foi atualizado ou chegou ganha um brilho curto. Cada movimento que o time faz fica visível.
function renderConteudoPlanner() {
  const el = $('#planner-conteudo');
  if (!el) return;
  const antes = new Map($$('.card[data-id]', el).map((c) => [c.dataset.id, c.getBoundingClientRect()]));
  const vistos = U.snapCards || new Map();
  el.innerHTML = U.visao === 'quadro' ? quadroHtml() : listaHtml();
  const agora = new Map(J().cartoes.map((c) => [c.id, c.atualizado]));
  const mudou = (id) => vistos.size && vistos.get(id) !== agora.get(id);
  U.snapCards = agora;
  if (U.visao !== 'quadro') return;
  const reduz = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  for (const c of $$('.card[data-id]', el)) {
    const r0 = antes.get(c.dataset.id);
    const r1 = c.getBoundingClientRect();
    if (r0 && (Math.abs(r0.left - r1.left) > 2 || Math.abs(r0.top - r1.top) > 2) && !reduz) {
      c.animate([{ transform: `translate(${r0.left - r1.left}px, ${r0.top - r1.top}px)`, zIndex: 5 }, { transform: 'none', zIndex: 5 }], { duration: 480, easing: 'cubic-bezier(.22, 1, .36, 1)' });
    }
    if (!r0 && vistos.size) c.classList.add('chegou');
    else if (mudou(c.dataset.id)) c.classList.add('piscou');
  }
}

/* ------------------------------------------------------------ colmeia: vive em colmeia.js (canvas infinito); app.js só repassa eventos em colmeiaEvento() */

/* ------------------------------------------------------------ agenda: semana da Game Director, do projeto inteiro */
// Eventos vêm da API do projeto (uma agenda por projeto). Você cria clicando num horário ou em "Novo evento"; os agentes criam
// pelas ações agenda.* quando você conta um compromisso. Visão de semana, 7h às 21h, com os de dia inteiro em cima.
const AG = { semana: null, eventos: [], carregando: false };
const DIA_MS = 86400_000;
const inicioSemana = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; };   // segunda
const agKey = (d) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
const agLocal = (d) => { const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; };
const CORES_AG = { reuniao: '#7C9CFF', prazo: '#FF7A6B', lembrete: '#F3AA3C', pessoal: '#B36BFF', marco: '#4FD1A5' };
const NOME_TIPO_AG = { reuniao: 'Reunião', prazo: 'Prazo', lembrete: 'Lembrete', pessoal: 'Pessoal', marco: 'Marco' };
async function carregarAgenda() {
  if (!U.proj) return;
  AG.semana ||= inicioSemana(new Date());
  const de = new Date(AG.semana.getTime() - DIA_MS), ate = new Date(AG.semana.getTime() + 8 * DIA_MS);
  AG.carregando = true;
  const r = await fetch(P(`/agenda?de=${de.toISOString()}&ate=${ate.toISOString()}`)).then((x) => x.json()).catch(() => ({ eventos: [] }));
  AG.eventos = r.eventos || []; AG.carregando = false;
  if (U.vista === 'agenda') renderAgenda(false);
}
function renderAgenda(buscar = true) {
  AG.semana ||= inicioSemana(new Date());
  if (buscar) carregarAgenda();
  const dias = Array.from({ length: 7 }, (_, i) => new Date(AG.semana.getTime() + i * DIA_MS));
  const hoje = agKey(new Date());
  const H0 = 7, H1 = 21, ALT = 52;   // px por hora
  const fmtDia = (d) => d.toLocaleDateString(I18N.locale, { weekday: 'short' }).replace('.', '');
  const rotulo = I18N.t('{inicio} a {fim}', { inicio: dias[0].toLocaleDateString(I18N.locale, { day: '2-digit', month: 'short' }).replace('.', ''), fim: dias[6].toLocaleDateString(I18N.locale, { day: '2-digit', month: 'short', year: 'numeric' }).replace('.', '') });
  const doDia = (d) => AG.eventos.filter((e) => { const a = new Date(e.inicio), b = new Date(e.fim); return a < new Date(d.getTime() + DIA_MS) && b > d; });
  const bloco = (e, d) => {
    const a = new Date(e.inicio), b = new Date(e.fim);
    const ini = Math.max(a, d), fim = Math.min(b, new Date(d.getTime() + DIA_MS));
    const top = Math.max(0, ((ini - d) / 3600_000 - H0) * ALT), alt = Math.max(22, ((fim - ini) / 3600_000) * ALT - 2);
    const cor = CORES_AG[e.tipo] || CORES_AG.reuniao;
    return `<button class="ag-ev ${e.cancelado ? 'cancelado' : ''}" data-acao="ag-ver" data-ev="${e.id}" style="top:${top}px;height:${alt}px;--c:${cor}" title="${esc(e.titulo)}"><b>${esc(e.titulo)}</b><small>${a.toLocaleTimeString(I18N.locale, { hour: '2-digit', minute: '2-digit' })}${e.local ? ` ${esc(e.local)}` : ''}</small></button>`;
  };
  const horas = Array.from({ length: H1 - H0 }, (_, i) => `<div class="ag-hora" style="top:${i * ALT}px">${String(H0 + i).padStart(2, '0')}:00</div>`).join('');
  const agora = new Date(); const linhaAgora = agora >= dias[0] && agora < new Date(dias[6].getTime() + DIA_MS) ? `<div class="ag-agora" style="top:${(agora.getHours() + agora.getMinutes() / 60 - H0) * ALT}px"></div>` : '';
  const proximos = AG.eventos.filter((e) => !e.cancelado && new Date(e.fim) >= new Date()).sort((x, y) => x.inicio.localeCompare(y.inicio)).slice(0, 6);
  $('#centro').innerHTML = `<div class="agenda">
    <div class="ag-topo"><h2>${ic('calendario')}Agenda</h2>
      <button class="btn-sec" data-acao="ag-hoje">Hoje</button><button class="btn-ic" data-acao="ag-ant" title="Semana anterior">${ic('setaE')}</button><button class="btn-ic" data-acao="ag-prox" title="Próxima semana">${ic('setaD')}</button>
      <span class="ag-rotulo">${esc(rotulo)}</span><span class="espaco"></span>
      <span class="ag-legenda">${Object.entries(NOME_TIPO_AG).map(([k, n]) => `<i style="--c:${CORES_AG[k]}"></i>${n}`).join('')}</span>
      <button class="btn-primario" data-acao="ag-novo">${ic('mais')}Novo evento</button></div>
    <div class="ag-corpo">
      <div class="ag-semana">
        <div class="ag-cab"><div class="ag-canto"></div>${dias.map((d) => `<div class="ag-dia ${agKey(d) === hoje ? 'hoje' : ''}"><small>${esc(fmtDia(d))}</small><b>${d.getDate()}</b></div>`).join('')}</div>
        <div class="ag-inteiro"><div class="ag-canto">dia inteiro</div>${dias.map((d) => `<div class="ag-cel">${doDia(d).filter((e) => e.diaInteiro).map((e) => `<button class="ag-ev todo ${e.cancelado ? 'cancelado' : ''}" data-acao="ag-ver" data-ev="${e.id}" style="--c:${CORES_AG[e.tipo] || CORES_AG.reuniao}">${esc(e.titulo)}</button>`).join('')}</div>`).join('')}</div>
        <div class="ag-grade" style="--alt:${ALT}px;--linhas:${H1 - H0}">
          <div class="ag-horas">${horas}</div>
          ${dias.map((d) => `<div class="ag-col ${agKey(d) === hoje ? 'hoje' : ''}" data-ag-dia="${d.toISOString()}">${Array.from({ length: H1 - H0 }, (_, i) => `<div class="ag-slot" data-ag-slot="${new Date(d.getTime() + (H0 + i) * 3600_000).toISOString()}" style="top:${i * ALT}px;height:${ALT}px"></div>`).join('')}${doDia(d).filter((e) => !e.diaInteiro).map((e) => bloco(e, d)).join('')}${agKey(d) === hoje ? linhaAgora : ''}</div>`).join('')}
        </div>
      </div>
      <aside class="ag-lado"><h3>Próximos</h3>${proximos.length ? proximos.map((e) => `<button class="ag-prox-i" data-acao="ag-ver" data-ev="${e.id}" style="--c:${CORES_AG[e.tipo] || CORES_AG.reuniao}"><span class="ag-q">${esc(new Date(e.inicio).toLocaleDateString(I18N.locale, { weekday: 'short', day: '2-digit', month: '2-digit' }).replace('.', ''))}${e.diaInteiro ? '' : ` ${new Date(e.inicio).toLocaleTimeString(I18N.locale, { hour: '2-digit', minute: '2-digit' })}`}</span><b>${esc(e.titulo)}</b>${e.origem?.quem && e.origem.quem !== 'voce' ? `<small>${I18N.t('marcado por {nome}', { nome: esc(nomeAgente(e.origem.quem)) })}${e.origem.equipe ? ` (${esc(e.origem.equipe)})` : ''}</small>` : ''}</button>`).join('') : '<div class="dica-v" style="color:var(--mudo)">Nada marcado. Clique num horário, ou conte um compromisso ao seu assessor que ele marca.</div>'}</aside>
    </div></div>`;
  const g = $('.ag-grade'); if (g) g.scrollTop = Math.max(0, (Math.min(Math.max(agora.getHours(), H0), H1) - H0 - 1) * ALT);
}
function modalEvento(ev = null, inicioSugerido = null) {
  const e = ev || { titulo: '', tipo: 'reuniao', inicio: inicioSugerido || new Date(Date.now() + 3600_000).toISOString(), fim: null, diaInteiro: false, local: '', participantes: [], lembreteMin: 15, descricao: '' };
  const ini = new Date(e.inicio), fim = e.fim ? new Date(e.fim) : new Date(ini.getTime() + 3600_000);
  abrirModal(`<h2>${ev ? 'Evento' : 'Novo evento'}</h2>
    <div class="campo"><label class="rot">Título</label><input class="in" id="ev-titulo" value="${esc(e.titulo)}" maxlength="120" autocomplete="off" placeholder="Reunião com o cliente sobre o pipeline"></div>
    <div class="dois campo"><div><label class="rot">Tipo</label><select class="in" id="ev-tipo">${Object.entries(NOME_TIPO_AG).map(([k, n]) => `<option value="${k}" ${e.tipo === k ? 'selected' : ''}>${n}</option>`).join('')}</select></div>
      <div><label class="rot">Lembrete</label><select class="in" id="ev-lembrete">${[[0, 'Na hora'], [5, '5 min antes'], [15, '15 min antes'], [30, '30 min antes'], [60, '1 h antes'], [1440, '1 dia antes']].map(([v, n]) => `<option value="${v}" ${Number(e.lembreteMin) === v ? 'selected' : ''}>${n}</option>`).join('')}</select></div></div>
    <div class="dois campo"><div><label class="rot">Início</label><input class="in" id="ev-inicio" type="datetime-local" value="${agLocal(ini)}"></div><div><label class="rot">Fim</label><input class="in" id="ev-fim" type="datetime-local" value="${agLocal(fim)}"></div></div>
    <label class="campo" style="display:flex;align-items:center;gap:8px"><input type="checkbox" id="ev-inteiro" ${e.diaInteiro ? 'checked' : ''}> Dia inteiro</label>
    <div class="dois campo"><div><label class="rot">Local ou link</label><input class="in" id="ev-local" value="${esc(e.local || '')}" maxlength="200" autocomplete="off"></div><div><label class="rot">Participantes</label><input class="in" id="ev-part" value="${esc((e.participantes || []).join(', '))}" placeholder="nomes separados por vírgula" autocomplete="off"></div></div>
    <div class="campo"><label class="rot">Descrição</label><textarea class="in" id="ev-desc" rows="3" maxlength="1500">${esc(e.descricao || '')}</textarea></div>
    ${ev ? `<div class="dica-v" style="color:var(--mudo);margin:-6px 0 10px">${ev.origem?.quem && ev.origem.quem !== 'voce' ? `${I18N.t('Marcado por {nome}', { nome: esc(nomeAgente(ev.origem.quem)) })}${ev.origem.equipe ? ` (${esc(ev.origem.equipe)})` : ''}. ` : ''}${ev.cancelado ? `${I18N.t('Este evento está cancelado.')} ` : ''}${ev.card ? I18N.t('Card {card}.', { card: esc(ev.card) }) : ''}</div>` : ''}
    <div class="acoes">${ev ? `<button class="btn-sec btn-perigo" data-acao="ag-excluir" data-ev="${ev.id}">Excluir</button>${ev.cancelado ? '' : `<button class="btn-sec" data-acao="ag-cancelar-ev" data-ev="${ev.id}">Cancelar evento</button>`}` : ''}<span class="espaco"></span><button class="btn-sec" data-acao="fechar">Fechar</button><button class="btn-primario" data-acao="ag-salvar" data-ev="${ev ? ev.id : ''}">Salvar</button></div>`, 'evento');
}
async function salvarEvento(id) {
  const corpo = { titulo: $('#ev-titulo').value, tipo: $('#ev-tipo').value, lembreteMin: Number($('#ev-lembrete').value), inicio: new Date($('#ev-inicio').value).toISOString(), fim: new Date($('#ev-fim').value).toISOString(), diaInteiro: $('#ev-inteiro').checked, local: $('#ev-local').value, participantes: $('#ev-part').value, descricao: $('#ev-desc').value };
  if (!$('#ev-inicio').value || !$('#ev-fim').value) return aviso(I18N.t('Informe início e fim.'));
  const r = id ? await api('PUT', P(`/agenda/${id}`), corpo) : await api('POST', P('/agenda'), corpo);
  if (!r._ok) return aviso(r.erro || I18N.t('Não consegui salvar o evento.'));
  fecharModal(); aviso(id ? I18N.t('Evento atualizado.') : I18N.t('Evento marcado.')); carregarAgenda();
}

function renderPlanner() {
  U.snapCards = new Map(J().cartoes.map((c) => [c.id, c.atualizado]));
  const filtroAtivo = U.filtro.size || U.soBloq || U.busca;
  const p = projetoAtual();
  $('#centro').innerHTML = `<div class="planner">
    <div class="planner-topo">
      <div class="migalha"><b>Projetos</b>${ic('setaD')}<b>${esc(p ? p.nome : '')}</b>${ic('setaD')}${U.visao === 'quadro' ? 'Quadro' : 'Lista'}</div>
      <div class="planner-linha"><h1>Quadro do projeto</h1><span class="espaco"></span>
        ${J().integ?.jira?.ativo || J().integ?.agenda?.ativo ? '<button class="btn-sec" data-acao="demandas" title="Demandas do Jira e agenda">Demandas</button>' : ''}
        <button class="btn-sec" data-acao="relatorio" title="Relatório de hoje até agora">Relatório</button>
        <button class="btn-sec" data-acao="teamwork">Execuções e entregas</button>
        <button class="btn-sec" data-acao="metricas" title="Lead time, custo por ponto, retrabalho, evidência falsa, decisões revertidas">Métricas</button>
        <button class="btn-sec" data-acao="ronda" title="O P.O. confere o que está parado">Ronda do P.O.</button>${templateId() === 'professional-operations' ? '<button class="btn-sec" data-acao="briefing" title="A assessoria lê Jira, agenda, quadros e conversas e propõe o que fazer hoje">Leitura do dia</button>' : ''}
        <button class="btn-primario" data-acao="criar" data-col="backlog">${ic('mais')}Criar</button></div>
      <div class="abas"><button class="aba ${U.visao === 'quadro' ? 'ativa' : ''}" data-visao="quadro">Quadro</button><button class="aba ${U.visao === 'lista' ? 'ativa' : ''}" data-visao="lista">Lista</button></div>
    </div>
    <div class="filtros">
      <div class="busca">${ic('busca')}<input id="busca" class="in" placeholder="Buscar tarefas" value="${esc(U.busca)}" autocomplete="off"></div>
      <div class="avs-filtro">${rosterAtual().map((a) => `<span class="av m foto ${U.filtro.has(a.id) ? 'on' : ''}" data-filtro="${a.id}" style="--c:${a.cor}" title="${esc(a.nome)}"><span class="av-img"><img src="${esc(a.foto || avatarPadrao(a.id))}" alt="" draggable="false"></span></span>`).join('')}</div>
      <button class="chip-filtro ${U.soBloq ? 'on' : ''}" data-acao="so-bloq">Parados</button>
      <button class="link-limpar" data-acao="limpar-filtros" ${filtroAtivo ? '' : 'hidden'}>Limpar filtros</button>
    </div>
    <div id="planner-conteudo" style="display:contents">${U.visao === 'quadro' ? quadroHtml() : listaHtml()}</div>
  </div>`;
}
async function moverCard(id, col, forcar = false) {
  const r = await api('POST', P(`/cartao/${id}/mover`), { coluna: col, forcar });
  if (r._status === 409 && !forcar) {
    if (await perguntar(I18N.t('{coluna} está no limite de trabalho em andamento. Mover mesmo assim?', { coluna: nomeColuna(col) }), I18N.t('Mover mesmo assim'))) return moverCard(id, col, true);
    return;
  }
  if (!r._ok && !forcar && /evid|bloqueado/i.test(r.erro || '')) {
    if (await perguntar(I18N.t('{erro}. Concluir mesmo assim?', { erro: r.erro }), I18N.t('Concluir mesmo assim'))) return moverCard(id, col, true);
    return;
  }
  if (!r._ok) aviso(r.erro || I18N.t('Não consegui mover.'));
}

/* ------------------------------------------------------------ memória */
async function renderMemoria() {
  $('#centro').innerHTML = `<div class="planner"><div class="mem-barra"><div class="info">Carregando a memória…</div></div></div>`;
  const d = await (await fetch(P('/memoria'))).json().catch(() => ({ notas: [], estado: {} }));
  U.memDados = d;
  desenharMemoria();
}
function desenharMemoria() {
  const d = U.memDados || { notas: [], estado: {} };
  const q = U.memBusca.trim().toLowerCase();
  const notas = d.notas.filter((n) => !q || `${n.titulo} ${n.caminho} ${n.autor}`.toLowerCase().includes(q));
  const grupo = (titulo, itens, fixo = false) => (itens.length || fixo ? `<div class="mem-grupo">${titulo}<span class="n">${itens.length}</span></div>${itens.map((n) =>
    `<button class="nota ${U.memSel === n.caminho ? 'ativa' : ''} ${n.nome === 'contexto.md' || n.nome === 'projeto.md' ? 'fixa' : ''}" data-nota="${esc(n.caminho)}"><span class="t">${esc(n.titulo)}</span><span class="m">${esc(n.data || '')}${n.autor ? ` ${esc(nomeAgente(n.autor))}` : ''}</span></button>`).join('')}` : '');
  const proj = notas.filter((n) => n.escopo === 'projeto' && !n.arquivo);
  const grupos = [
    grupo('Projeto', proj.filter((n) => ['projeto.md', 'indice.md'].includes(n.nome))),
    grupo('Decisões do projeto', proj.filter((n) => n.caminho.startsWith('decisoes/'))),
    grupo('Aprendizados do projeto', proj.filter((n) => n.caminho.startsWith('aprendizados/'))),
    ...rosterAtual().map((a) => {
      const meus = notas.filter((n) => n.escopo === `agente:${a.id}`);
      const ordenados = [...meus.filter((n) => n.nome === 'contexto.md'), ...meus.filter((n) => n.nome !== 'contexto.md')];
      return grupo(esc(a.nome), ordenados);
    }),
    grupo('Arquivo', notas.filter((n) => n.arquivo)),
  ].join('');
  const e = d.estado || {};
  $('#centro').innerHTML = `<div class="planner" style="min-height:0">
    <div class="planner-topo" style="padding-bottom:0">
      <div class="migalha"><b>Projetos</b>${ic('setaD')}<b>${esc(projetoAtual()?.nome || '')}</b>${ic('setaD')}Memória</div>
      <div class="planner-linha"><h1>Memória do time</h1><span class="espaco"></span>
        ${window.studioApp ? `<button class="btn-sec" data-acao="abrir-memoria">Abrir pasta</button>` : ''}
        <button class="btn-primario" data-acao="curar">Curar agora</button></div>
    </div>
    <div class="mem-barra"><div class="info"><b>${I18N.t('{n} notas', { n: e.total ?? notas.length })}</b>${e.novasDesde ? `, ${I18N.t(e.novasDesde > 1 ? '{n} novas desde a última curadoria' : '{n} nova desde a última curadoria', { n: e.novasDesde })}` : ''}${e.ultimaCuradoria ? `. ${I18N.t('Curada {quando}.', { quando: ha(e.ultimaCuradoria) })}` : `. ${I18N.t('Ainda não foi curada.')}`}</div></div>
    <div class="memoria-v">
      <div class="mem-arvore"><div class="busca">${ic('busca')}<input id="mem-busca" class="in" placeholder="Buscar nas notas" value="${esc(U.memBusca)}" autocomplete="off"></div><div class="mem-lista" id="mem-lista">${grupos}</div></div>
      <div class="mem-leitor" id="mem-leitor"><div class="mem-vazio">Escolha uma nota para ler.</div></div>
    </div></div>`;
  if (!U.memSel) U.memSel = (notas.find((n) => n.nome === 'projeto.md') || notas.find((n) => !n.arquivo) || {}).caminho || null;
  if (U.memSel) abrirNota(U.memSel, false);
}
async function abrirNota(caminho, rolar = true) {
  U.memSel = caminho;
  $$('.nota').forEach((b) => b.classList.toggle('ativa', b.dataset.nota === caminho));
  const r = await (await fetch(P(`/memoria/ler?caminho=${encodeURIComponent(caminho)}`))).json().catch(() => ({}));
  const el = $('#mem-leitor');
  if (!el) return;
  const corpo = String(r.texto || r.erro || '').replace(/^---[\s\S]*?---\s*/, '');
  el.innerHTML = `<div class="cam">${ic('pasta')}<span>${esc(caminho)}</span></div><div class="texto corpo">${md(corpo)}</div>`;
  if (rolar) el.scrollTop = 0;
}
function irParaNota(caminho) {
  U.memSel = caminho;
  U.vista = 'memoria';
  location.hash = `${U.proj}/memoria`;
  if (location.hash.endsWith('/memoria')) rotear();
}

/* ------------------------------------------------------------ modais */
function abrirModal(html, classe = '') {
  const m = $('#modal');
  m.innerHTML = `<div class="modal ${classe}" role="dialog">${html}</div>`;
  m.hidden = false;
  m.onmousedown = (e) => { if (e.target === m) fecharModal(); };
}
function fecharModal() {
  const m = $('#modal');
  m.hidden = true; m.innerHTML = '';
  U.issue = null; U.troca = null; U.inbox = false; U.demandas = false;
}
function perguntar(texto, botao = 'Confirmar') {
  return new Promise((res) => {
    abrirModal(`<h2>${esc(texto)}</h2><div class="acoes"><button class="btn-sec" id="m-nao">Cancelar</button><button class="btn-primario" id="m-sim">${esc(botao)}</button></div>`, 'modal-pq');
    $('#m-sim').onclick = () => { fecharModal(); res(true); };
    $('#m-nao').onclick = () => { fecharModal(); res(false); };
    $('#m-sim').focus();
  });
}
function perguntarTexto(titulo, placeholder, botao) {
  return new Promise((res) => {
    abrirModal(`<h2>${esc(titulo)}</h2><textarea class="in" id="m-txt" rows="3" placeholder="${esc(placeholder)}"></textarea><div class="acoes"><button class="btn-sec" id="m-nao">Cancelar</button><button class="btn-primario" id="m-sim">${esc(botao)}</button></div>`, 'modal-pq');
    $('#m-txt').focus();
    $('#m-sim').onclick = () => { const v = $('#m-txt').value.trim(); fecharModal(); res(v || null); };
    $('#m-nao').onclick = () => { fecharModal(); res(null); };
  });
}

/* ---- caixa "Precisa de você" ---- */
/* ---- demandas do Jira e agenda: o que a P.O. enxerga, e o que dá para fazer com isso ---- */
function modalDemandas() {
  U.demandas = true;
  const ig = J().integ || {};
  const jira = ig.cache?.jira || { itens: [] };
  const ag = ig.cache?.agenda || { eventos: [] };
  const agora = Date.now();
  const eventos = (ag.eventos || []).filter((e) => e.fimTs >= agora).slice(0, 8);
  const noQuadro = new Set(J().cartoes.map((c) => c.jira).filter(Boolean));
  const lead = agente(liderAtual());
  const linhaEv = (e) => `<div class="ev-i ${e.tipo}"><span class="ev-q">${diaCurto(e.ts)}${e.dia ? '' : `<b>${horaCurta(e.ts)}</b>`}</span><span class="ev-t">${esc(e.titulo)}</span>${e.teams ? `<a class="ref" href="${esc(e.teams)}" target="_blank" rel="noopener">Teams</a>` : ''}</div>`;
  const dem = (i) => `<div class="dem-i"><div class="dem-topo"><a class="ref" href="${esc(i.url)}" target="_blank" rel="noopener">${esc(i.key)}</a><span class="dem-st">${esc(i.status)}</span>${i.prioridade ? `<span class="dem-pr">${esc(i.prioridade)}</span>` : ''}${i.vencimento ? `<span class="dem-venc">${I18N.t('vence {data}', { data: esc(i.vencimento) })}</span>` : ''}</div>
      <div class="dem-res">${esc(i.resumo)}</div>${i.descricao ? `<div class="dem-desc">${esc(i.descricao.replace(/\s+/g, ' ').slice(0, 200))}</div>` : ''}
      <div class="dem-acoes"><button class="btn-sec" data-acao="discutir-demanda" data-key="${esc(i.key)}">${I18N.t('Discutir com {nome}', { nome: esc(primeiroNome(lead?.nome || I18N.t('a P.O.'))) })}</button>${noQuadro.has(i.key) ? '<span class="dem-ok">no quadro</span>' : `<button class="btn-sec" data-acao="trazer-demanda" data-key="${esc(i.key)}">Trazer ao quadro</button>`}</div></div>`;
  abrirModal(`<div class="inbox-topo">${ic('quadro')}<h2>Demandas e agenda</h2><span class="espaco"></span><button class="btn-sec" data-acao="sincronizar-integ">Atualizar agora</button><button class="btn-ic" data-acao="fechar">${ic('fechar')}</button></div>
    <div class="inbox-lista">
      ${ig.agenda?.ativo ? `<div class="dem-bloco"><h4>Agenda</h4>${ag.erro && !ag.em ? `<div class="vazio-p">${esc(ag.erro)}</div>` : (eventos.length ? eventos.map(linhaEv).join('') : '<div class="vazio-p">Sem compromissos nos próximos dias.</div>')}${ag.em ? `<div class="dem-lido">${I18N.t('Lida {quando}', { quando: ha(ag.em) })}</div>` : ''}</div>` : ''}
      ${ig.jira?.ativo ? `<div class="dem-bloco"><h4>${jira.total ? I18N.t('Demandas no Jira, {n}', { n: jira.total }) : 'Demandas no Jira'}</h4>${jira.erro && !jira.em ? `<div class="vazio-p">${esc(jira.erro)}</div>` : (jira.itens.length ? jira.itens.map(dem).join('') : '<div class="vazio-p">Nenhuma demanda aberta.</div>')}${jira.em ? `<div class="dem-lido">${I18N.t('Lido {quando}', { quando: ha(jira.em) })}${jira.erro ? `. ${I18N.t('Última tentativa falhou: {erro}', { erro: esc(jira.erro) })}` : ''}</div>` : ''}</div>` : ''}
      ${!ig.agenda?.ativo && !ig.jira?.ativo ? '<div class="vazio-inbox">Ligue o Jira e a agenda em Ajustes, na aba Integrações.</div>' : ''}
    </div>`, 'inbox demandas');
}

/* ---- central: o que precisa de você, o que aconteceu e os relatórios ---- */
const naoLidasTotal = () => Object.values(PJ).reduce((s, j) => s + (j.naoLidasN || 0), 0);
const ICONE_NOTIF = { card: 'checkq', pergunta: 'sino', creditos: 'relogio', relatorio: 'memoria', aviso: 'alerta' };

async function carregarNotifs(pid = U.proj) {
  const j = PJ[pid];
  if (!j) return;
  const r = await (await fetch(P('/notificacoes', pid))).json().catch(() => ({ lista: [], naoLidas: 0 }));
  j.notifs = r.lista || [];
  j.naoLidasN = r.naoLidas || 0;
}

async function modalInbox(aba) { return modalCentral(aba); }
async function modalCentral(aba) {
  U.inbox = true;
  U.centroAba = aba || U.centroAba || (E.perguntas.length ? 'voce' : 'atividade');
  const j = J();
  if (U.proj && !j.notifs) await carregarNotifs();
  const notifs = j.notifs || [];
  const rel = notifs.filter((n) => n.tipo === 'relatorio' && n.dados);
  const naoLidas = notifs.filter((n) => !n.lida).length;
  const tab = (id, nome, n) => `<button data-cen="${id}" class="${U.centroAba === id ? 'on' : ''}">${nome}${n ? `<span class="n">${n}</span>` : ''}</button>`;
  const corpo = U.centroAba === 'voce' ? blocoPerguntas()
    : U.centroAba === 'relatorios' ? (rel.length ? rel.map((n) => `<div class="notif-rel"><div class="notif-quando">${ha(n.em)}</div>${relatorioHtml(n.dados)}</div>`).join('') : '<div class="vazio-inbox">Nenhum relatório ainda. O primeiro sai no fim do dia, ou agora pelo botão.</div>')
    : (notifs.length ? notifs.map((n) => `<button class="notif-i ${n.nivel} ${n.lida ? '' : 'nova'}" data-notif="${n.id}"><span class="ic-n">${ic(ICONE_NOTIF[n.tipo] || 'sino')}</span><span class="txt-n"><b>${esc(n.titulo)}</b>${n.texto ? `<span>${esc(n.texto)}</span>` : ''}</span><time>${ha(n.em)}</time></button>`).join('') : '<div class="vazio-inbox">Nada aconteceu ainda.</div>');
  abrirModal(`<div class="inbox-topo">${ic('sino')}<h2>Central</h2><span class="espaco"></span>
      ${U.proj ? `<button class="btn-sec" data-acao="relatorio">Relatório de hoje</button>${naoLidas ? '<button class="btn-sec" data-acao="ler-tudo">Marcar tudo como lido</button>' : ''}` : ''}
      <button class="btn-ic" data-acao="fechar">${ic('fechar')}</button></div>
    <div class="central-abas">${tab('voce', 'Precisa de você', E.perguntas.length)}${tab('atividade', 'Atividade', naoLidas)}${tab('relatorios', 'Relatórios', 0)}</div>
    <div class="inbox-lista">${corpo}</div>`, 'inbox');
}

function blocoPerguntas() {
  const lista = E.perguntas;
  return lista.length ? lista.map((q) => `<div class="pedido-i" data-qid="${q.id}">
      <div class="cab-i">${avDe(q.de)}<b>${esc(nomeAgenteEm(q.projeto, q.de))}</b>${ha(q.em)}<span class="proj-tag">${esc(q.projetoNome || '')}</span></div>
      <div class="texto">${md(q.texto)}</div>
      ${q.opcoes.length ? `<div class="opcoes">${q.opcoes.map((o) => `<button data-responder="${q.id}" data-proj="${q.projeto}" data-resp="${esc(o)}">${esc(o)}</button>`).join('')}</div>` : ''}
      <div class="resp"><input class="in" data-resp-livre="${q.id}" data-proj="${q.projeto}" placeholder="Responder" autocomplete="off">${!q.planning && !q.decisao && q.de !== (PJ[q.projeto]?.lider || 'po') ? `<button class="btn-sec" data-acao="delegar-pergunta" data-q="${q.id}" data-proj="${q.projeto}">Liderança decide</button>` : ''}<button class="btn-sec" data-ir-canal="${q.projeto}|${q.canal}">Abrir conversa</button></div></div>`).join('')
    : '<div class="vazio-inbox">Ninguém está esperando por você.</div>';
}
const nomeAgenteEm = (pid, id) => (PJ[pid]?.roster || rosterAtual()).find((a) => a.id === id)?.nome || id;

async function marcarLidas(ids) {
  const j = J();
  const r = await api('POST', P('/notificacoes/lidas'), { ids });
  for (const n of j.notifs || []) if (ids === 'todas' || ids.includes(n.id)) n.lida = true;
  if (r._ok) j.naoLidasN = r.naoLidas;
  renderRail();
  atualizarTitulo();
}

// Abre o que a notificação aponta: o card, a conversa ou o relatório.
function abrirNotif(pid, n) {
  if (pid !== U.proj) location.hash = `${pid}/chat/equipe`;
  fecharModal();
  if (n.card && PJ[pid]?.cartoes.some((c) => c.id === n.card)) { setTimeout(() => abrirIssue(n.card), 60); return; }
  if (n.tipo === 'relatorio') { setTimeout(() => modalCentral('relatorios'), 60); return; }
  if (n.tipo === 'pergunta') { setTimeout(() => modalCentral('voce'), 60); return; }
  irPara('chat', n.canal || 'equipe');
}

// Com o piloto ligado, o Electron impede o Windows de suspender o app; fora do Electron não há o que fazer.
function aplicarPiloto() { try { window.studioApp?.manterAcordado?.(!!E.config.piloto?.ativo); } catch { /* sem a ponte do Electron */ } }

// Avisa o servidor que a pessoa está por aqui (no máximo a cada 20 s): ele monta o resumo de quando ela esteve fora.
let ultimoPing = 0;
function pingAtividade() {
  if (Date.now() - ultimoPing < 20_000) return;
  ultimoPing = Date.now();
  fetch('/api/atividade', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }).catch(() => {});
}
['pointerdown', 'keydown'].forEach((ev) => document.addEventListener(ev, pingAtividade, { passive: true }));
document.addEventListener('visibilitychange', () => { if (!document.hidden) pingAtividade(); });

function atualizarTitulo() {
  const n = E.perguntas.length + naoLidasTotal();
  document.title = `${n ? `(${n}) ` : ''}${E.marca.nome}${E.marca.sufixo ? `${E.marca.nome.endsWith('.') ? '' : ' '}${E.marca.sufixo}` : ''}`;
}

/* ---- toasts: cada coisa importante que acontece aparece, com a ação à mão ---- */
function toast(n, pid) {
  const el = document.createElement('button');
  el.className = `toast ${n.nivel}`;
  el.innerHTML = `<span class="ic-n">${ic(ICONE_NOTIF[n.tipo] || 'sino')}</span><span class="txt-n"><b>${esc(n.titulo)}</b>${n.texto ? `<span>${esc(n.texto)}</span>` : ''}</span><span class="fechar-t" data-fechar-toast>${ic('fechar')}</span>${n.nivel === 'urgente' ? '' : '<i class="barra-t"></i>'}`;
  el.onclick = (ev) => { el.remove(); if (!ev.target.closest('[data-fechar-toast]')) { abrirNotif(pid, n); marcarLidas([n.id]).catch(() => {}); } };
  const caixa = $('#avisos');
  caixa.append(el);
  while (caixa.querySelectorAll('.toast').length > 4) caixa.querySelector('.toast').remove();
  if (n.nivel !== 'urgente') setTimeout(() => el.classList.add('saindo'), 6800), setTimeout(() => el.remove(), 7200);
}

function notifChegou(e) {
  const j = PJ[e.projeto];
  if (!j) return;
  const n = e.notif;
  j.notifs = [n, ...(j.notifs || [])].slice(0, 150);
  j.naoLidasN = e.naoLidas;
  renderRail();
  atualizarTitulo();
  // movimento comum de card não vira aviso na tela (o card já se mexe no planner); o que pede atenção, sim
  const comAviso = n.nivel !== 'info' || n.tipo === 'relatorio';
  const vendo = e.projeto === U.proj && ((U.vista === 'chat' && n.canal === U.canal) && n.tipo !== 'creditos');
  if (comAviso && !vendo) toast(n, e.projeto);
  if (['urgente'].includes(n.nivel) || n.tipo === 'relatorio') notificar(n.titulo, `${e.projetoNome || ''}: ${n.texto || ''}`.slice(0, 140));
  if (U.inbox) modalCentral();
}

const avDe = (id) => av(id, 'm', { dot: false });

/* ---- editor de perfil: aparência estilo Discord (com prévia ao vivo) e, para agentes, o trabalho (skills, regras, contexto) ---- */
async function modalPerfil(id, { manter = false, aba = null } = {}) {
  const ehEu = id === 'voce';
  const a = pessoaDe(id);
  if (!a) return;
  fecharCartao();
  const anterior = U.ped?.id === id ? U.ped : null;
  U.ped = { id, aba: aba || anterior?.aba || 'perfil', estilo: JSON.parse(JSON.stringify(estiloDe(id))), nome: a.nome };
  if (manter && anterior) { const { recorteFoto, recorteCapa } = U.ped.estilo; U.ped.estilo = { ...anterior.estilo, recorteFoto, recorteCapa }; U.ped.nome = anterior.nome; }
  const r = ehEu ? {} : await (await fetch(P(`/agente/${id}/regras`))).json().catch(() => ({}));
  if (!ehEu) U.vozes = await fetch('/api/voz').then((x) => x.json()).then((x) => ({ lista: x.vozes || [], padrao: x.voz })).catch(() => ({ lista: [], padrao: null }));
  const trabalho = ehEu ? '' : `<div id="ped-trabalho" ${U.ped.aba === 'trabalho' ? '' : 'hidden'}>
      ${(a.skills || []).length ? `<div class="campo"><label class="rot">Skills do cargo</label><div class="skills-lista">${a.skills.map((x) => `<span class="skill-chip">${esc(x)}</span>`).join('')}</div></div>` : ''}
      ${blocoRegras(id, r, I18N.t('Regras de {nome} neste projeto', { nome: esc(a.nome) }))}
      ${blocoReferencias(id, r)}
      <div class="campo"><label class="rot">Adicionar contexto</label>
        <textarea class="in" id="cx-texto" rows="3" placeholder="${I18N.t('Algo que {nome} precisa saber e o time ainda não registrou.', { nome: esc(a.nome) })}"></textarea>
        <div style="margin-top:8px;display:flex;gap:8px"><button class="btn-sec" data-acao="add-contexto" data-escopo="${id}">Anotar na memória dele</button><button class="btn-sec" data-acao="nota-agente" data-ag="${id}">Ver a memória dele</button></div></div>
    </div>`;
  abrirModal(`<div class="perfil-topo"><div><h2>${ehEu ? 'Meu perfil' : esc(a.nome)}</h2><div class="perfil-papel">${esc(a.cargo)}${a.papel ? `, ${esc(a.papel)}` : ''}</div></div><span class="espaco"></span><button class="btn-ic" data-acao="fechar">${ic('fechar')}</button></div>
    ${ehEu ? '' : `<div class="ped-abas"><button class="${U.ped.aba === 'perfil' ? 'on' : ''}" data-acao="ped-aba" data-pa="perfil">Perfil</button><button class="${U.ped.aba === 'conversa' ? 'on' : ''}" data-acao="ped-aba" data-pa="conversa">Conversa</button><button class="${U.ped.aba === 'trabalho' ? 'on' : ''}" data-acao="ped-aba" data-pa="trabalho">Trabalho</button></div>`}
    <div id="ped-perfil" ${U.ped.aba === 'perfil' ? '' : 'hidden'}>${pedPerfilHtml(id)}</div>
    ${ehEu ? '' : await pedConversaHtml(id)}
    ${trabalho}`, 'perfil ped-modal');
  pedPrev();
  VFX.ligar($('#modal'));
}
const pedTile = (campo, valor, rotulo, miolo, extra = '') => `<button class="ped-t ${extra}" data-acao="ped-opc" data-campo="${campo}" data-valor="${valor}" title="${esc(rotulo)}">${miolo}<span>${esc(rotulo)}</span></button>`;
function pedNomeTiles() {
  const id = U.ped.id, e = U.ped.estilo, n = e.nome || {};
  const fontes = OPC.fonte.map(([k, rot]) => pedTile('fonte', k, rot, nomeHtml(id, true, { nome: { ...n, fonte: k } }, U.ped.nome.split(' ')[0]), (n.fonte || 'padrao') === k ? 'on' : '')).join('');
  const efeitos = OPC.efeitoNome.map(([k, rot]) => pedTile('efeitoNome', k, rot, nomeHtml(id, true, { nome: { ...n, efeito: k, fonte: n.fonte || 'padrao', c1: n.c1 || '#7c9cff', c2: n.c2 || '#ff6bd5' } }, 'Aa'), (n.efeito || 'solido') === k ? 'on' : '')).join('');
  return { fontes, efeitos };
}
function pedPerfilHtml(id) {
  const a = pessoaDe(id), e = U.ped.estilo, n = e.nome || {};
  const sel = (campo, k, pad) => ((e[campo] || pad) === k ? 'on' : '');
  const decos = OPC.decoracao.map(([k, rot]) => pedTile('decoracao', k, rot, av(id, 'm', { dot: false, estilo: { ...e, decoracao: k } }), sel('decoracao', k, 'nenhuma'))).join('');
  const efeitos = OPC.efeito.map(([k, rot]) => pedTile('efeito', k, rot, k === 'nenhum' ? '' : `<canvas data-vfx="${k}"></canvas>`, sel('efeito', k, 'nenhum'))).join('');
  const placas = OPC.placa.map(([k, rot]) => pedTile('placa', k, rot, '', `${sel('placa', k, 'nenhuma')} ${k === 'nenhuma' ? '' : `placa-t placa-${k}`}`)).join('');
  const { fontes, efeitos: efNome } = pedNomeTiles();
  const t1 = e.tema?.c1 || '#5865f2', t2 = e.tema?.c2 || '#eb459e';
  const tipos = 'image/png,image/jpeg,image/webp,image/gif';
  return `<div class="ped"><div>
    <div class="ped-sec"><label class="rot">Nome (o @ no chat segue o nome)</label><input class="in" id="pf-nome" value="${esc(U.ped.nome)}" maxlength="30" autocomplete="off"><div class="dica-v" id="pf-dica"></div></div>
    <div class="ped-sec"><label class="rot">Foto de perfil</label>
      <div class="ped-galeria">${Array.from({ length: AVATARES }, (_, i) => i + 1).map((n) => `<button type="button" class="ped-av ${!a.foto && id !== 'voce' && avatarPadrao(id) === avatarUrl(n) ? 'on' : ''}" data-avatar="${n}" title="Usar este avatar"><img src="${avatarUrl(n)}" alt="" draggable="false"></button>`).join('')}</div>
      <div class="linha-in"><label class="btn-sec arquivo">${a.foto ? 'Trocar por uma foto do PC' : 'Subir foto do PC'}<input type="file" accept="${tipos}" hidden data-recorte="foto"></label>${a.foto ? `<button class="btn-sec" data-acao="ajustar-img" data-ag="${id}" data-tipo="foto">Ajustar</button><button class="btn-sec" data-acao="tirar-foto" data-ag="${id}">Remover</button>` : ''}</div></div>
    <div class="ped-sec"><label class="rot">Capa</label><div class="linha-in"><label class="btn-sec arquivo">${a.capa ? 'Trocar capa' : 'Escolher capa'}<input type="file" accept="${tipos}" hidden data-recorte="capa"></label>${a.capa ? `<button class="btn-sec" data-acao="ajustar-img" data-ag="${id}" data-tipo="capa">Ajustar</button><button class="btn-sec" data-acao="tirar-capa" data-ag="${id}">Remover</button>` : ''}<span class="ped-cores">Cor <input type="color" id="ped-corcapa" value="${e.corCapa || a.cor || '#5865f2'}"></span></div></div>
    <div class="ped-sec"><label class="rot">Tema do perfil</label><div class="ped-cores"><input type="color" id="ped-t1" value="${t1}"><input type="color" id="ped-t2" value="${t2}">${TEMAS.map(([c1, c2]) => `<button class="ped-cor" style="background:linear-gradient(135deg,${c1},${c2})" data-acao="ped-tema" data-c1="${c1}" data-c2="${c2}" title="${I18N.t('{c1} e {c2}', { c1, c2 })}"></button>`).join('')}<button class="btn-sec" data-acao="ped-tema">Sem tema</button></div></div>
    <div class="ped-sec"><label class="rot">Decoração do avatar</label><div class="ped-tiles" data-grupo="decoracao">${decos}</div></div>
    <div class="ped-sec"><label class="rot">Efeito do perfil</label><div class="ped-tiles" data-grupo="efeito">${efeitos}</div></div>
    <div class="ped-sec"><label class="rot">Estilo do nome</label><div class="ped-tiles" data-grupo="fonte">${fontes}</div></div>
    <div class="ped-sec"><label class="rot">Efeito do nome</label><div class="ped-tiles" data-grupo="efeitoNome">${efNome}</div>
      <div class="ped-cores" style="margin-top:8px"><input type="color" id="ped-n1" value="${n.c1 || '#7c9cff'}"><input type="color" id="ped-n2" value="${n.c2 || '#ff6bd5'}"><button class="btn-sec" data-acao="ped-surpresa">Surpresa</button></div></div>
    <div class="ped-sec"><label class="rot">Placa do nome</label><div class="ped-tiles" data-grupo="placa">${placas}</div></div>
    <div class="ped-sec"><label class="rot">Sobre mim</label><textarea class="in" id="ped-bio" rows="3" maxlength="190" placeholder="${id === 'voce' ? '' : esc(a.papel || '')}">${esc(e.bio || '')}</textarea></div>
    ${id === 'voce' ? '' : (() => { const vz = U.vozes || { lista: [], padrao: null }; const v = e.voz || null; const pad = vz.padrao || { nome: 'leni', ritmo: 0.4, expressividade: 0.45 }; const ritmo = v?.ritmo ?? pad.ritmo, exp = v?.expressividade ?? pad.expressividade; const padNome = vz.lista.find((x) => x.id === pad.nome)?.nome || pad.nome;
      return `<div class="ped-sec"><label class="rot">Voz na chamada</label>
      <select class="in" id="ped-voz-nome"><option value="">${I18N.t('Padrão dos Ajustes ({voz})', { voz: esc(padNome) })}</option>${vz.lista.map((x) => `<option value="${esc(x.id)}" ${v?.nome === x.id ? 'selected' : ''}>${esc(x.nome)}${x.genero ? ` (${esc(x.genero)})` : ''}</option>`).join('')}</select>
      <div class="dois" style="margin-top:10px"><div><label class="rot">Ritmo <em id="ped-voz-ritmo-v">${Math.round(ritmo * 100)}</em></label><input type="range" class="faixa" id="ped-voz-ritmo" min="15" max="80" step="5" value="${Math.round(ritmo * 100)}" ${v ? '' : 'disabled'}></div><div><label class="rot">Expressividade <em id="ped-voz-exp-v">${Math.round(exp * 100)}</em></label><input type="range" class="faixa" id="ped-voz-exp" min="20" max="90" step="5" value="${Math.round(exp * 100)}" ${v ? '' : 'disabled'}></div></div>
      <div class="linha-in" style="margin-top:6px"><button class="btn-sec" data-acao="ped-voz-ouvir" data-ag="${id}">${I18N.t('Ouvir {nome}', { nome: esc(a.nome.split(' ')[0]) })}</button><small class="dica-v" id="ped-voz-st" style="color:var(--mudo)">Ritmo para a esquerda é mais pausado.</small></div></div>`; })()}
    <div class="ped-rodape"><button class="btn-sec" data-acao="fechar">Cancelar</button><button class="btn-primario" data-acao="ped-salvar">Salvar perfil</button></div>
  </div><div class="ped-prev" id="ped-prev"></div></div>`;
}
function pedPrev() { const el = $('#ped-prev'); if (!el) return; el.innerHTML = cartaoHtml(U.ped.id, { estilo: U.ped.estilo, nome: U.ped.nome }); VFX.ligar(el); pedLigarVoz(); }
/** Controles de voz do perfil: a escolha fica em U.ped.estilo.voz e só vai para o servidor em "Salvar perfil". */
function pedLigarVoz() {
  const sel = $('#ped-voz-nome'); if (!sel) return;
  const e = U.ped.estilo; const pad = U.vozes?.padrao || { ritmo: 0.4, expressividade: 0.45 };
  const ler = () => (sel.value ? { nome: sel.value, ritmo: Number($('#ped-voz-ritmo').value) / 100, expressividade: Number($('#ped-voz-exp').value) / 100 } : null);
  sel.onchange = () => { e.voz = sel.value ? { nome: sel.value, ritmo: e.voz?.ritmo ?? pad.ritmo, expressividade: e.voz?.expressividade ?? pad.expressividade } : null; for (const id of ['#ped-voz-ritmo', '#ped-voz-exp']) $(id).disabled = !sel.value; };
  for (const [id, rot] of [['#ped-voz-ritmo', '#ped-voz-ritmo-v'], ['#ped-voz-exp', '#ped-voz-exp-v']]) { const el = $(id); el.oninput = () => { $(rot).textContent = el.value; e.voz = ler(); }; }
}
async function pedOuvirVoz(id) {
  const st = $('#ped-voz-st'); const v = U.ped.estilo.voz || U.vozes?.padrao || {};
  if (st) st.textContent = I18N.t('Gerando a prévia…');
  const nome = pessoaDe(id)?.nome?.split(' ')[0] || 'eu';
  const r = await api('POST', '/api/voz/previa', { ...v, texto: `Oi, Déborah! Aqui é ${nome}. Dei uma olhada no quadro agora há pouco e tem duas coisas esperando a sua decisão. Quer que eu conte o resumo?` });
  if (!r._ok) { if (st) st.textContent = r.erro || I18N.t('Não consegui gerar a prévia.'); return; }
  if (st) st.textContent = I18N.t('Pronto em {s} s.', { s: ((r.ms || 0) / 1000).toFixed(1) });
  const d = lerDisp(); const a = new Audio(`/api/voz/previa/audio?t=${Date.now()}`); a.volume = d.volume; if (d.saida && a.setSinkId) await a.setSinkId(d.saida).catch(() => {});
  a.play().catch(() => { if (st) st.textContent = I18N.t('O navegador bloqueou o áudio; clique de novo.'); });
}
function pedRedesenharNomes() { const { fontes, efeitos } = pedNomeTiles(); const f = $('[data-grupo=fonte]'), e = $('[data-grupo=efeitoNome]'); if (f) f.innerHTML = fontes; if (e) e.innerHTML = efeitos; }
function pedRedesenhar() { const el = $('#ped-perfil'); const y = el.closest('.modal')?.scrollTop; el.innerHTML = pedPerfilHtml(U.ped.id); pedPrev(); VFX.ligar(el); if (y != null) el.closest('.modal').scrollTop = y; }
function pedEscolher(campo, valor) {
  const e = U.ped.estilo;
  if (campo === 'fonte' || campo === 'efeitoNome') { e.nome = { ...(e.nome || {}), [campo === 'fonte' ? 'fonte' : 'efeito']: valor }; if (campo === 'efeitoNome' && valor !== 'solido') { e.nome.c1 ||= $('#ped-n1').value; e.nome.c2 ||= $('#ped-n2').value; } }
  else e[campo] = valor;
  $$(`[data-grupo="${campo}"] .ped-t`).forEach((b) => b.classList.toggle('on', b.dataset.valor === valor));
  if (campo === 'fonte' || campo === 'efeitoNome') pedRedesenharNomes();
  pedPrev();
}
async function pedSalvar() {
  const { id, estilo: e, nome } = U.ped;
  const r = await api('PUT', P(`/agente/${id}/estilo`), { decoracao: e.decoracao || null, efeito: e.efeito || null, placa: e.placa || null, tema: e.tema || null, nome: e.nome || null, bio: e.bio || '', corCapa: e.corCapa || null, ...(id === 'voce' ? {} : { voz: e.voz || null }) });
  if (!r._ok) return aviso(r.erro || I18N.t('Não salvou o perfil.'));
  if (nome.trim() !== pessoaDe(id).nome) {
    const rn = await api('PUT', P(`/agente/${id}/perfil`), { nome });
    if (!rn._ok) { $('#pf-dica').className = 'dica-v erro'; $('#pf-dica').textContent = rn.erro || I18N.t('Não salvou o nome.'); return; }
  }
  aviso(I18N.t('Perfil salvo.'));
}

async function pedConversaHtml(id) {
  const a = agente(id), cv = a.conversa || {};
  const g = await (await fetch('/api/gifs')).json().catch(() => ({}));
  const padrao = (await (await fetch(P(`/agente/${id}/personalidade-padrao`))).json().catch(() => ({}))).texto || '';
  const tri = (nome, valor, rotulos) => `<div class="cv-tri">${[['', rotulos[0]], ['sim', rotulos[1]], ['nao', rotulos[2]]].filter(([, r]) => r).map(([v, r]) => `<label><input type="radio" name="${nome}" value="${v}" ${(valor === true ? 'sim' : valor === false ? 'nao' : '') === v ? 'checked' : ''}><span>${r}</span></label>`).join('')}</div>`;
  return `<div id="ped-conversa" ${U.ped.aba === 'conversa' ? '' : 'hidden'}>
    <div class="campo"><label class="rot">Personalidade</label>
      <textarea class="in" id="cv-pers" rows="5" maxlength="1500" data-padrao="${esc(padrao)}" placeholder="${esc(padrao)}">${esc(cv.personalidade || '')}</textarea>
      <div style="margin-top:6px"><button class="btn-sec" data-acao="conv-padrao">Começar da personalidade do template</button><button class="btn-sec" data-acao="conv-sortear">Sortear um temperamento</button></div>
      ${(cv.historico || []).length ? `<div style="margin-top:10px"><label class="rot">Versões anteriores (voltar a uma que você já escreveu)</label><div class="persona-lista">${cv.historico.map((h, i) => `<button class="persona-chip" data-acao="conv-versao" data-i="${i}" title="${esc(h.texto)}">${esc(h.texto.replace(/\s+/g, ' ').slice(0, 38))}…</button>`).join('')}</div></div>` : ''}</div>
    <div class="campo"><label class="rot">Temperamentos prontos (clique para usar, depois edite se quiser)</label>
      <div class="persona-lista">${(window.PERSONAS || []).map((p) => `<button class="persona-chip" data-acao="conv-persona" data-persona="${p.id}" title="${esc(p.texto)}">${esc(p.nome)}</button>`).join('')}</div></div>
    <div class="campo"><label class="rot">Brincar com os colegas</label>${tri('cv-zoeira', cv.zoeira, ['Padrão', 'Brincar', 'Só profissional'])}
      <div class="dica-v" style="color:var(--mudo);margin-top:6px">Brincar: provoca, apelida e rebate os colegas dentro das mensagens que já mandaria, sem gastar chamada extra e sem zoar em relatório ou card.</div></div>
    <div class="campo"><label class="rot">Emojis nas conversas</label>${tri('cv-emojis', cv.emojis, ['Padrão', 'Usar', 'Não usar'])}</div>
    <div class="campo"><label class="rot">GIFs da comunidade</label>${tri('cv-gifs', cv.gifs, ['Não usar', 'Usar'])}
      ${g.configurado ? '' : '<div class="dica-v" style="color:var(--mudo);margin-top:6px">Os GIFs ficam disponíveis quando a busca de GIFs estiver ligada em Ajustes, Conexões.</div>'}</div>
    <div class="ped-rodape"><button class="btn-primario" data-acao="conv-salvar" data-ag="${id}">Salvar</button></div>
  </div>`;
}

/* ---- recorte da foto e da capa: zoom e posição sobre a imagem carregada (o GIF fica animado) ---- */
const LIMITE_IMG = { foto: 8 * 1024 * 1024, capa: 10 * 1024 * 1024 };
function lerDataUrl(arquivo) { return new Promise((ok, falha) => { const fr = new FileReader(); fr.onload = () => ok(fr.result); fr.onerror = () => falha(new Error(I18N.t('Não consegui ler o arquivo.'))); fr.readAsDataURL(arquivo); }); }
function carregarImg(src) { return new Promise((ok, falha) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => falha(new Error(I18N.t('Não consegui abrir essa imagem.'))); i.src = src; }); }
async function prepararImagem(arquivo, tipo) {
  if (!/^image\/(png|jpeg|webp|gif)$/.test(arquivo.type)) throw new Error(I18N.t('Use PNG, JPG, WEBP ou GIF.'));
  if (arquivo.type === 'image/gif') {   // GIF vai como veio, para continuar animado
    if (arquivo.size > LIMITE_IMG[tipo]) throw new Error(I18N.t('O GIF passou de {mb} MB.', { mb: LIMITE_IMG[tipo] / 1024 / 1024 }));
    return lerDataUrl(arquivo);
  }
  const img = await carregarImg(URL.createObjectURL(arquivo));
  const max = tipo === 'capa' ? 2000 : 1024, k = Math.min(1, max / Math.max(img.width, img.height));
  const cv = document.createElement('canvas'); cv.width = Math.round(img.width * k); cv.height = Math.round(img.height * k);
  cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
  return arquivo.type === 'image/png' ? cv.toDataURL('image/png') : cv.toDataURL('image/jpeg', 0.9);
}
async function abrirRecorte(id, tipo, arquivo) {
  let dataUrl = null, src;
  try {
    if (arquivo) { dataUrl = await prepararImagem(arquivo, tipo); src = dataUrl; }
    else src = pessoaDe(id)?.[tipo];
    if (!src) return;
    const img = await carregarImg(src);
    const r = (arquivo ? null : estiloDe(id)[tipo === 'capa' ? 'recorteCapa' : 'recorteFoto']) || { zoom: 1, x: 0, y: 0 };
    U.rec = { id, tipo, dataUrl, nw: img.naturalWidth, nh: img.naturalHeight, ...r };
  } catch (e) { return aviso(e.message); }
  $('#recorte')?.remove();
  const el = document.createElement('div'); el.id = 'recorte'; el.className = 'recorte';
  el.innerHTML = `<div class="recorte-box"><h3>${tipo === 'capa' ? 'Ajustar capa' : 'Ajustar foto'}</h3>
    <div class="recorte-area ${tipo}"><img src="${esc(src)}" alt="" draggable="false"></div>
    <div class="recorte-zoom">${ic('menos') || '−'}<input type="range" id="rec-zoom" min="1" max="5" step="0.01" value="${U.rec.zoom}">${ic('mais') || '+'}</div>
    <div class="acoes"><button class="btn-sec" data-acao="recorte-cancelar">Cancelar</button><button class="btn-primario" data-acao="recorte-aplicar">Aplicar</button></div></div>`;
  document.body.appendChild(el);
  const area = el.querySelector('.recorte-area'), im = area.querySelector('img'), zoom = el.querySelector('#rec-zoom');
  const limitar = () => {
    const W = area.clientWidth, H = area.clientHeight, s = Math.max(W / U.rec.nw, H / U.rec.nh);
    const mx = Math.max(0, (U.rec.nw * s * U.rec.zoom - W) / 2 / W * 100), my = Math.max(0, (U.rec.nh * s * U.rec.zoom - H) / 2 / H * 100);
    U.rec.x = Math.max(-mx, Math.min(mx, U.rec.x)); U.rec.y = Math.max(-my, Math.min(my, U.rec.y));
    im.style.cssText = recorteCss(U.rec);
  };
  limitar();
  zoom.oninput = () => { U.rec.zoom = Number(zoom.value); limitar(); };
  area.onwheel = (ev) => { ev.preventDefault(); U.rec.zoom = Math.max(1, Math.min(5, U.rec.zoom - ev.deltaY * 0.0015)); zoom.value = U.rec.zoom; limitar(); };
  area.onpointerdown = (ev) => {
    area.setPointerCapture(ev.pointerId);
    const ini = { x: ev.clientX, y: ev.clientY, rx: U.rec.x, ry: U.rec.y };
    area.onpointermove = (m) => { U.rec.x = ini.rx + (m.clientX - ini.x) / area.clientWidth * 100; U.rec.y = ini.ry + (m.clientY - ini.y) / area.clientHeight * 100; limitar(); };
    area.onpointerup = () => { area.onpointermove = null; };
  };
}
async function aplicarRecorte() {
  const { id, tipo, dataUrl, zoom, x, y } = U.rec;
  const recorte = { zoom: +zoom.toFixed(3), x: +x.toFixed(2), y: +y.toFixed(2) };
  const r = dataUrl ? await api('POST', P(`/agente/${id}/${tipo}`), { dataUrl, recorte }) : await api('PUT', P(`/agente/${id}/estilo`), { [tipo === 'capa' ? 'recorteCapa' : 'recorteFoto']: recorte });
  if (!r._ok) return aviso(r.erro || I18N.t('Não salvou a imagem.'));
  $('#recorte')?.remove();
  setTimeout(() => { if (U.ped?.id === id && !$('#modal').hidden) modalPerfil(id, { manter: true }); }, 200);
}

/* ---- caixa de iniciativas do assessor e "o que aconteceu enquanto estive fora" ---- */
const ESTADO_INI = { detected: ['detectada', 'off'], evaluating: ['avaliando', 'fila'], proposed: ['aguarda você', 'voce'], approved: ['aprovada', 'on'], planning: ['planejando', 'on'], queued: ['na fila', 'fila'], running: ['em andamento', 'on'], waiting_dependency: ['esperando dependência', 'fila'], waiting_approval: ['aguarda você', 'voce'], reviewing: ['em revisão', 'on'], completed: ['concluída', 'ok'], blocked: ['bloqueada', 'erro'], failed: ['falhou', 'erro'], cancelled: ['cancelada', 'off'], expired: ['expirou', 'off'] };
async function modalIniciativas() {
  const r = await fetch(P('/iniciativas')).then((x) => x.json()).catch(() => null); if (!r) return aviso(I18N.t('Não consegui ler as iniciativas.'));
  U.iniAberto = true;
  const lista = r.iniciativas.slice(0, 60);
  const item = (i) => { const [rot, cls] = ESTADO_INI[i.estado] || [i.estado, 'off']; const decide = ['proposed', 'waiting_approval'].includes(i.estado); const ativa = !['completed', 'cancelled', 'expired', 'failed'].includes(i.estado);
    return `<div class="ini ${cls}"><div class="ini-cab"><span class="loz ${cls}">${esc(rot)}</span><b>${esc(i.titulo)}</b><small>${esc(i.id)}</small></div>
      ${i.motivo && i.motivo !== i.titulo ? `<div class="ini-motivo">${esc(i.motivo)}</div>` : ''}
      <div class="ini-meta">${i.categoria ? `<span>${esc(i.categoria)}</span>` : ''}${i.agentes.length ? `<span>${I18N.t('com {nomes}', { nomes: i.agentes.map(nomeAgente).join(', ') })}</span>` : ''}${i.cards.length ? `<span>${i.cards.map((c) => `<a class="ref" data-issue="${esc(c)}">${esc(c)}</a>`).join(' ')}</span>` : ''}${i.entregaveis.length ? `<span>${I18N.t(i.entregaveis.length === 1 ? '{n} entregável' : '{n} entregáveis', { n: i.entregaveis.length })}</span>` : ''}<span>${I18N.t(i.chamadas === 1 ? '{n} chamada' : '{n} chamadas', { n: i.chamadas })}</span><span>${diaTxt(i.atualizado)} ${hhmm(i.atualizado)}</span></div>
      ${i.proximaAcao ? `<div class="ini-prox">${I18N.t('Próximo: {acao}', { acao: esc(i.proximaAcao) })}</div>` : ''}
      <div class="ini-acoes">${decide ? `<button class="btn-primario" data-acao="ini-decidir" data-ini="${i.id}" data-dec="aprovar">Aprovar</button>` : ''}${ativa ? `<button class="btn-sec" data-acao="ini-decidir" data-ini="${i.id}" data-dec="cancelar">Cancelar</button>` : ''}${['failed', 'cancelled', 'expired', 'blocked'].includes(i.estado) ? `<button class="btn-sec" data-acao="ini-decidir" data-ini="${i.id}" data-dec="reabrir">Reabrir</button>` : ''}</div></div>`; };
  abrirModal(`<div class="inbox-topo"><h2>Iniciativas do assessor</h2><span class="espaco"></span><span class="mudo">${I18N.t(r.resumo.ativas === 1 ? '{n} ativa' : '{n} ativas', { n: r.resumo.ativas })}${r.resumo.aguardandoVoce ? `, ${I18N.t('{n} aguardando você', { n: r.resumo.aguardandoVoce })}` : ''}</span><button class="btn-ic" data-acao="fechar" title="Fechar">${ic('fechar')}</button></div>
    <div class="inbox-lista">${lista.length ? lista.map(item).join('') : '<div class="vazio-inbox">Nenhuma iniciativa ainda. Com o modo automático ligado, cada sinal novo (reunião, Jira, outra equipe, quadro) vira uma iniciativa aqui.</div>'}</div>`, 'inbox');
}
async function modalDesde() {
  const chave = `ultimaAtividade:${U.proj}`; let desde = null; try { desde = localStorage.getItem(chave); } catch { /* sem armazenamento */ }
  const r = await fetch(P(`/desde${desde ? `?desde=${encodeURIComponent(desde)}` : ''}`)).then((x) => x.json()).catch(() => null); if (!r) return aviso(I18N.t('Não consegui montar o resumo.'));
  const sec = (tit, itens, f) => (itens.length ? `<div class="sec"><h4>${tit} <span class="mudo">${itens.length}</span></h4>${itens.map(f).join('')}</div>` : '');
  abrirModal(`<div class="inbox-topo"><h2>O que aconteceu</h2><span class="espaco"></span><span class="mudo">${I18N.t('desde {dia} {hora}', { dia: diaTxt(r.desde), hora: hhmm(r.desde) })}</span><button class="btn-ic" data-acao="fechar" title="Fechar">${ic('fechar')}</button></div>
    <div class="inbox-lista">
      ${sec('Precisa de você', [...r.aguardandoVoce.map((c) => ({ t: I18N.t('{id} {titulo} aguarda sua decisão', { id: c.id, titulo: c.titulo }), c: c.id })), ...r.perguntasAbertas.map((p) => ({ t: `${p.de}: ${p.texto}` })), ...r.iniciativas.filter((i) => ['proposed', 'waiting_approval'].includes(i.estado)).map((i) => ({ t: I18N.t('Proposta do assessor: {titulo}', { titulo: i.titulo }) }))], (x) => `<div class="desde-l voce">${x.c ? `<a class="ref" data-issue="${esc(x.c)}">${esc(x.c)}</a> ` : ''}${esc(x.t)}</div>`)}
      ${sec('Concluído', r.concluidos, (c) => `<div class="desde-l ok"><a class="ref" data-issue="${esc(c.id)}">${esc(c.id)}</a> ${esc(c.titulo)}${c.dono ? ` <small>${esc(c.dono)}</small>` : ''}</div>`)}
      ${sec('Bloqueado', r.bloqueados, (c) => `<div class="desde-l erro"><a class="ref" data-issue="${esc(c.id)}">${esc(c.id)}</a> ${esc(c.motivo)}</div>`)}
      ${sec('Falaram com você', r.paraVoce, (m) => `<div class="desde-l"><b>${esc(m.de)}</b> ${esc(m.texto)} <small>${hhmm(m.em)}</small></div>`)}
      ${sec('Cards que andaram', r.cards.filter((c) => c.mudancas.length), (c) => `<div class="desde-l"><a class="ref" data-issue="${esc(c.id)}">${esc(c.id)}</a> ${esc(c.titulo)} <span class="loz ${esc(c.coluna)}">${esc(c.coluna)}</span><div class="mudo" style="font-size:12px;margin-top:2px">${c.mudancas.map(esc).join('<br>')}</div></div>`)}
      ${sec('Entregas na pasta', r.entregas, (e) => `<div class="desde-l">${esc(e.pasta)} <small>${e.arquivos.map(esc).join(', ')}</small></div>`)}
      ${sec('Quem trabalhou', r.quemTrabalhou, (q) => `<div class="desde-l">${esc(q.agente)} <small>${I18N.t(q.falas === 1 ? '{n} mensagem' : '{n} mensagens', { n: q.falas })}</small></div>`)}
      ${sec('Iniciativas do assessor', r.iniciativas, (i) => `<div class="desde-l">${esc(i.titulo)} <span class="loz">${esc((ESTADO_INI[i.estado] || [i.estado])[0])}</span></div>`)}
      ${!(r.aguardandoVoce.length || r.concluidos.length || r.bloqueados.length || r.paraVoce.length || r.cards.length || r.entregas.length) ? '<div class="vazio-inbox">Nada aconteceu nesse período.</div>' : ''}
    </div>`, 'inbox');
}
// marca quando você esteve aqui pela última vez (para "o que aconteceu" saber de onde contar)
setInterval(() => { try { if (U.proj && document.visibilityState === 'visible') localStorage.setItem(`ultimaAtividadeViva:${U.proj}`, new Date().toISOString()); } catch { /* sem armazenamento */ } }, 30_000);
document.addEventListener('visibilitychange', () => { try { if (U.proj && document.visibilityState === 'hidden') localStorage.setItem(`ultimaAtividade:${U.proj}`, new Date().toISOString()); } catch { /* sem armazenamento */ } });

/** Painel "Arquivos desta equipe" nos Ajustes: tamanho por categoria, a política de cada uma e a faxina sob demanda. */
async function carregarArquivos() {
  const el = $('#aj-arquivos'); if (!el) return;
  const r = await fetch(P('/arquivos')).then((x) => x.json()).catch(() => null);
  if (!r || !$('#aj-arquivos')) return;
  $('#aj-arquivos').innerHTML = `<div class="arq-total"><b>${esc(r.totalTexto)}</b> na pasta desta equipe${r.ultima ? ` <span class="mudo">${I18N.t('faxina {dia} às {hora}', { dia: diaTxt(new Date(r.ultima).toISOString()), hora: hhmm(new Date(r.ultima).toISOString()) })}</span>` : ''}</div>
    <div class="arq-lista">${r.itens.filter((i) => i.bytes > 0 || ['estado', 'relatorios', 'entregas'].includes(i.id)).map((i) => `<div class="arq-linha"><span class="arq-tam">${esc(i.tamanho)}</span><span class="arq-txt">${esc(i.texto)}</span></div>`).join('')}</div>
    <div class="linha-in" style="margin-top:8px;align-items:center"><button class="btn-sec" data-acao="faxina">Faxina agora</button><span class="mudo">${r.previa.n ? I18N.t(r.previa.n === 1 ? '{n} item sairia ({tamanho})' : '{n} itens sairiam ({tamanho})', { n: r.previa.n, tamanho: esc(r.previa.liberadoTexto) }) : I18N.t('nada para tirar no momento')}; ${I18N.t('o app faz isso sozinho a cada 12 h')}</span></div>`;
}

/** Um avatar da galeria da ferramenta vira a foto do perfil (passa pelo mesmo caminho do upload, sem recorte). */
async function escolherAvatar(id, n) {
  if (!id) return;
  try {
    const blob = await (await fetch(avatarUrl(n))).blob();
    const dataUrl = await new Promise((ok, erro) => { const fr = new FileReader(); fr.onload = () => ok(fr.result); fr.onerror = () => erro(new Error(I18N.t('Não li a imagem.'))); fr.readAsDataURL(blob); });
    const r = await api('POST', P(`/agente/${id}/foto`), { dataUrl, recorte: { zoom: 1, x: 0, y: 0 } });
    if (!r._ok) return aviso(r.erro || I18N.t('Não salvou a foto.'));
    setTimeout(() => { if (U.ped?.id === id && !$('#modal').hidden) modalPerfil(id, { manter: true }); }, 200);
  } catch (e) { aviso(e.message); }
}

/* ---- regras em lista e documentos .md de contexto (janela do agente e Ajustes do projeto) ---- */
const rotaEscopo = (escopo) => (escopo === 'projeto' ? '' : `/agente/${escopo}`);
function blocoRegras(escopo, r, rotulo) {
  const itens = r.itens || [];
  return `<div class="campo" id="rg-bloco-${escopo}"><label class="rot">${rotulo}</label>
    <ol class="regras-lista">${itens.map((t, i) => `<li><span>${esc(t)}</span><button class="btn-ic" data-acao="regra-del" data-escopo="${escopo}" data-i="${i}" title="Remover regra">${ic('fechar')}</button></li>`).join('')}</ol>
    <div class="linha-in"><input class="in" id="rg-novo-${escopo}" data-regra-nova="${escopo}" placeholder="${itens.length ? 'Nova regra' : 'Ex.: nunca mexer em migração sem me avisar'}" autocomplete="off"><button class="btn-sec" data-acao="regra-add" data-escopo="${escopo}">Adicionar</button><label class="btn-sec arquivo">Importar .md<input type="file" accept=".md,.markdown,text/markdown,text/plain" hidden multiple data-importar-regras="${escopo}"></label></div></div>`;
}
function blocoReferencias(escopo, r) {
  const refs = r.referencias || [];
  return `<div class="campo" id="rf-bloco-${escopo}"><label class="rot">Documentos de contexto</label>
    ${refs.length ? `<ul class="regras-lista refs">${refs.map((x) => `<li><span>${esc(x.titulo)}<small>${esc(x.arquivo)}</small></span><button class="btn-ic" data-acao="ref-del" data-escopo="${escopo}" data-arquivo="${esc(x.arquivo)}" title="Tirar documento">${ic('fechar')}</button></li>`).join('')}</ul>` : ''}
    <div class="linha-in"><label class="btn-sec arquivo">Importar .md<input type="file" accept=".md,.markdown,text/markdown,text/plain" hidden multiple data-importar-ref="${escopo}"></label></div></div>`;
}
async function redesenharRegras(escopo) {
  const r = await (await fetch(P(`${rotaEscopo(escopo)}/regras`))).json().catch(() => ({}));
  const rg = document.getElementById(`rg-bloco-${escopo}`); if (rg) rg.outerHTML = blocoRegras(escopo, r, rg.querySelector('.rot').innerHTML);
  const rf = document.getElementById(`rf-bloco-${escopo}`); if (rf) rf.outerHTML = blocoReferencias(escopo, r);
  return r;
}
async function adicionarRegra(escopo) {
  const campo = document.getElementById(`rg-novo-${escopo}`); const t = campo?.value.trim(); if (!t) return;
  const atual = (await (await fetch(P(`${rotaEscopo(escopo)}/regras`))).json().catch(() => ({}))).itens || [];
  const r = await api('PUT', P(`${rotaEscopo(escopo)}/regras`), { itens: [...atual, t] });
  if (!r._ok) return aviso(r.erro || I18N.t('Não salvou.'));
  await redesenharRegras(escopo); document.getElementById(`rg-novo-${escopo}`)?.focus();
}

// Recorta a foto no centro, em quadrado de 256 px, antes de enviar: o arquivo fica pequeno e o rosto não estica.
function prepararFoto(arquivo) {
  return new Promise((ok, falha) => {
    const img = new Image();
    const url = URL.createObjectURL(arquivo);
    img.onload = () => {
      const lado = Math.min(img.width, img.height);
      const cv = document.createElement('canvas');
      cv.width = 256; cv.height = 256;
      cv.getContext('2d').drawImage(img, (img.width - lado) / 2, (img.height - lado) / 2, lado, lado, 0, 0, 256, 256);
      URL.revokeObjectURL(url);
      ok(cv.toDataURL('image/jpeg', 0.88));
    };
    img.onerror = () => { URL.revokeObjectURL(url); falha(new Error(I18N.t('Não consegui abrir essa imagem.'))); };
    img.src = url;
  });
}

/* ---- adicionar projeto ---- */
/** Adicionar equipe ao projeto aberto: escolhe o tipo (template) e, se quiser, um nome. */
function modalNovaEquipe() {
  const p = projetoAtual();
  if (!p) return;
  abrirModal(`<h2>${I18N.t('Adicionar equipe a {nome}', { nome: esc(p.nome) })}</h2>
    <div class="dica-v" style="color:var(--mudo);margin:-6px 0 12px">Cada equipe tem as próprias conversas, contatos e planner. As lideranças, e principalmente o seu assessor, enxergam as outras equipes do projeto para trazer resumos e montar apresentações.</div>
    <div class="eq-escolha" id="ne-tipos">${E.templates.filter((t) => !t.rascunho).map((t, k) => `<label class="eq-opcao"><input type="radio" name="ne-tipo" value="${esc(t.id)}" ${k === 0 ? 'checked' : ''}><span><b>${esc(t.nome)}</b><small>${esc(t.descricao || '')}</small></span></label>`).join('')}</div>
    <div class="campo" style="margin-top:12px"><label class="rot">Nome da equipe (opcional)</label><input class="in" id="ne-nome" placeholder="Se deixar em branco, usa o nome do tipo" autocomplete="off"></div>
    <div class="acoes"><button class="btn-sec" id="m-nao">Cancelar</button><button class="btn-primario" id="m-sim">Adicionar equipe</button></div>`, 'modal-pq');
  $('#m-nao').onclick = fecharModal;
  $('#m-sim').onclick = async () => {
    const tipo = $('input[name="ne-tipo"]:checked')?.value;
    const r = await api('POST', P('/equipes'), { template: tipo, nome: $('#ne-nome').value.trim() || undefined });
    if (!r._ok) return aviso(r.erro || I18N.t('Não consegui adicionar a equipe.'));
    fecharModal();
    await recarregarApp();
    await carregarProjeto(r.equipe.cid);
    location.hash = `${r.equipe.cid}/chat/equipe`;
  };
}
function modalNovoProjeto({ template = '', nome = '' } = {}) {
  abrirModal(`<h2>Adicionar projeto</h2>
    <div class="campo"><label class="rot">Pasta do projeto</label>
      <div class="linha-in"><input class="in" id="np-caminho" placeholder="Cole o caminho, por exemplo C:\\Projetos\\MeuJogo" autocomplete="off">${window.studioApp ? '<button class="btn-sec" id="np-escolher">Escolher pasta</button>' : ''}</div>
      <div class="dica-v" id="np-dica"></div></div>
    <div class="campo"><label class="rot">Equipes do projeto (dá para adicionar ou tirar depois)</label><div class="eq-escolha" id="np-equipes">${E.templates.filter((t) => !t.rascunho).map((t, k) => `<label class="eq-opcao"><input type="checkbox" value="${esc(t.id)}" ${(template ? t.id === template : k === 0) ? 'checked' : ''}><span><b>${esc(t.nome)}</b><small>${esc(t.descricao || '')}</small></span></label>`).join('')}</div></div>
    <div class="campo"><label class="rot">Nome</label><input class="in" id="np-nome" placeholder="Como o time vai chamar este projeto" autocomplete="off" value="${esc(nome)}"></div>
    <label class="interruptor"><input type="checkbox" id="np-conhecer" checked><span><b>Pedir ao P.O. para conhecer o projeto agora</b><small>Ele lê a pasta, escreve um resumo na memória e te pergunta o que faltar. Não edita nada.</small></span></label>
    <div class="acoes"><button class="btn-sec" id="m-nao">Cancelar</button><button class="btn-primario" id="m-sim">Adicionar</button></div>`, 'modal-pq');
  const caminho = $('#np-caminho');
  caminho.focus();
  let t = null; let valido = false;
  const validar = async () => {
    const v = caminho.value.trim();
    const dica = $('#np-dica');
    if (!v) { dica.textContent = ''; valido = false; return; }
    const r = await api('POST', '/api/pasta/validar', { caminho: v });
    valido = !!r.ok;
    dica.className = `dica-v ${r.ok ? 'ok' : 'erro'}`;
    dica.textContent = r.ok ? I18N.t('Pasta encontrada: {nome}', { nome: r.nome }) : r.erro;
    if (r.ok && !$('#np-nome').value) $('#np-nome').value = r.nome;
  };
  caminho.oninput = () => { clearTimeout(t); t = setTimeout(validar, 250); };
  if (window.studioApp) $('#np-escolher').onclick = async () => { const c = await window.studioApp.escolherPasta(); if (c) { caminho.value = c; validar(); } };
  $('#m-nao').onclick = fecharModal;
  $('#m-sim').onclick = async () => {
    await validar();
    if (!valido) { caminho.focus(); return; }
    const escolhidas = $('#np-equipes input:checked').map((x) => x.value);
    if (!escolhidas.length) { aviso(I18N.t('Escolha ao menos uma equipe.')); return; }
    const r = await api('POST', '/api/projetos', { nome: $('#np-nome').value.trim(), caminho: caminho.value.trim(), template: escolhidas[0], conhecer: $('#np-conhecer').checked, engine: E.config.engine, modo: E.config.modo });
    if (!r._ok) { aviso(r.erro || I18N.t('Não consegui adicionar.')); return; }
    for (const tpl of escolhidas.slice(1)) await api('POST', `/api/p/${r.projeto.id}/equipes`, { template: tpl });   // a primeira é a principal
    fecharModal();
    await recarregarApp();
    for (const e of equipesDoProjeto(E.projetos.find((x) => x.id === r.projeto.id))) await carregarProjeto(e.cid);
    location.hash = `${r.projeto.id}/chat/equipe`;
  };
}

/* ---- card ---- */
function modalCriar(col = 'backlog', { contexto = [], titulo = '' } = {}) {
  const fichas = (typeof REG !== 'undefined' && REG.dados?.entradas) || [];
  const nomeFicha = (k) => fichas.find((f) => f.chave === k)?.nome || k;
  abrirModal(`<h2>Criar tarefa</h2>
    <div class="campo"><label class="rot">Resumo</label><input class="in" id="n-tit" placeholder="O que precisa ser feito" autocomplete="off" value="${esc(titulo)}"></div>
    ${contexto.length ? `<div class="campo"><label class="rot">Fichas que o responsável recebe inteiras</label><div class="reg-ctx">${contexto.map((k) => `<span class="chip-cam">${ic('ficha')}${esc(nomeFicha(k))}</span>`).join('')}</div></div>` : ''}
    <div class="campo"><label class="rot">Descrição</label><textarea class="in" id="n-desc" rows="3"></textarea></div>
    <div class="dois campo">
      <div><label class="rot">Responsável</label><select class="in" id="n-dono"><option value="">Sem dono</option>${rosterAtual().map((a) => `<option value="${a.id}">${esc(a.nome)}</option>`).join('')}</select></div>
      <div><label class="rot">Prioridade</label><select class="in" id="n-prio"><option value="normal">Normal</option><option value="alta">Alta</option><option value="baixa">Baixa</option></select></div></div>
    <div class="campo"><label class="rot">Etapa</label><select class="in" id="n-col">${E.colunas.map((c) => `<option value="${c.id}" ${c.id === col ? 'selected' : ''}>${esc(c.nome)}</option>`).join('')}</select></div>
    <div class="acoes"><button class="btn-sec" id="m-nao">Cancelar</button><button class="btn-primario" id="m-sim">Criar</button></div>`, 'modal-pq');
  $('#n-tit').focus();
  const criar = async () => {
    const titulo = $('#n-tit').value.trim();
    if (!titulo) { $('#n-tit').focus(); return; }
    const r = await api('POST', P('/cartao'), { titulo, descricao: $('#n-desc').value, dono: $('#n-dono').value || null, prioridade: $('#n-prio').value, coluna: $('#n-col').value });
    if (!r._ok) { aviso(r.erro || I18N.t('Não criei.')); return; }
    if (contexto.length && r.card?.id) await api('PATCH', P(`/cartao/${r.card.id}`), { campos: { contexto } });
    fecharModal();
  };
  $('#m-sim').onclick = criar;
  $('#n-tit').onkeydown = (e) => { if (e.key === 'Enter') criar(); };
  $('#m-nao').onclick = fecharModal;
}

function ressalvasHtml(c) {
  const l = c.ressalvas || [];
  if (!l.length) return '';
  const rot = { aberta: 'aberta', resolvida: 'resolvida', aceita: 'aceita pela P.O.' };
  return `<h4>Ressalvas</h4>${l.map((r) => `<div class="ressalva ${r.status}"><b>${esc(rot[r.status] || r.status)}</b>, ${esc(r.tipo)}, ${esc(r.severidade)}${r.origem ? `, ${I18N.t('de {nome}', { nome: esc(nomeAgente(r.origem)) })}` : ''}<p>${esc(r.texto)}</p>${r.resolucao?.texto ? `<p class="mudo">${I18N.t(r.status === 'aceita' ? 'Motivo da aceitação: {texto}' : 'Resolução: {texto}', { texto: esc(r.resolucao.texto) })}${r.resolucao.evidencia ? ` ${I18N.t('Evidência: {evidencia}', { evidencia: esc(r.resolucao.evidencia) })}` : ''}</p>` : ''}</div>`).join('')}`;
}
// A Game Director é a última QA: depois de concluído, ela testa e aprova ou reprova.
function validacaoHtml(c) {
  if (c.coluna !== 'concluido' || !c.validacao) return '';
  const v = c.validacao;
  const aceitas = (c.ressalvas || []).filter((r) => r.status === 'aceita');
  if (v.status === 'pendente') return `<section class="sec valida"><h4>Sua validação final</h4><p>O time entregou e deu por concluído. Você é a última QA: teste e diga se está tudo certo.</p>${aceitas.length ? `<p class="erro">${I18N.t(aceitas.length === 1 ? 'A P.O. aceitou {n} ressalva para conferir (veja abaixo).' : 'A P.O. aceitou {n} ressalvas para conferir (veja abaixo).', { n: aceitas.length })}</p>` : ''}<div class="side-acoes"><button class="btn-primario" data-acao="validar-ok">Está tudo certo</button><button class="btn-sec" data-acao="validar-nok">Tem problema</button></div></section>`;
  if (v.status === 'aprovada') return `<section class="sec valida ok"><h4>Validado por você</h4><p class="mudo">${ha(v.em)}${v.motivo ? `, ${esc(v.motivo)}` : ''}</p></section>`;
  return `<section class="sec valida"><h4>Reprovado por você</h4><p class="mudo">${ha(v.em)}: ${esc(v.motivo || '')}</p></section>`;
}
function workflowHtml(c) {
  const deps = `<div class="campo"><label class="rot">Depende de (IDs separados por vírgula)</label><input class="in" data-dependencias value="${esc((c.dependeDe || []).join(', '))}" placeholder="T-001, T-002"></div>`;
  const f = c.workflow;
  if (!f) return `<div class="sec"><h4>Dependências</h4>${deps}</div>`;
  const pendentes = (c.dependeDe || []).filter(id => cartao(id)?.coluna !== 'concluido');
  return `<section class="sec workflow-card"><h4>${I18N.t('Fluxo técnico, entrega r{n}', { n: f.revisao })}</h4>${deps}
    <div class="workflow-estados"><span>Revisão: <b>${esc(f.revisaoCodigo.status)}</b></span><span>Documentação: <b>${esc(f.documentacao.status)}</b></span><span>QA: <b>${esc(f.qa.status)}</b></span><span>Retrabalhos: <b>${f.retrabalhos}</b></span></div>
    ${c.prontidao ? `<div class="trilha-det">${c.prontidao.etapas.map((e) => `<div class="${e.ok ? 'ok' : e.falhou ? 'falhou' : ''}"><i></i>${esc(e.nome)}</div>`).join('')}</div>${c.prontidao.falta?.length ? `<p class="erro">${I18N.t('Para avançar falta: {itens}', { itens: c.prontidao.falta.map(esc).join('; ') })}</p>` : ''}` : ''}
    ${ressalvasHtml(c)}
    ${pendentes.length ? `<p class="erro">${I18N.t('Aguardando {cards}', { cards: pendentes.map(esc).join(', ') })}</p>` : ''}
    <div class="dois"><div><label class="rot">Tipo de tarefa</label><select class="in" data-campo="tipoTarefa">${['feature','bug','refatoracao','teste','infra','documentacao'].map(t=>`<option ${c.tipoTarefa===t?'selected':''}>${t}</option>`).join('')}</select></div><div><label class="rot">Risco</label><select class="in" data-campo="risco">${['baixo','medio','alto'].map(t=>`<option ${c.risco===t?'selected':''}>${t}</option>`).join('')}</select></div></div>
    <h4>Retomada</h4><p>${esc(f.checkpoint.resumo || 'Sem checkpoint registrado.')}</p><p>${I18N.t('Próximo passo: {passo}', { passo: esc(f.checkpoint.proximoPasso || I18N.t('Planejar e executar a tarefa.')) })}</p>
    ${f.checkpoint.branch || f.checkpoint.worktree ? `<p class="caminho">${esc(f.checkpoint.branch)}, ${esc(f.checkpoint.worktree)}</p>` : ''}
    <h4>Verificações da entrega atual</h4>${f.verificacoes.length ? f.verificacoes.map(v=>`<div class="workflow-check"><b>${esc(v.status)}</b>, ${esc(v.comando)}${v.obrigatoria?`, ${I18N.t('obrigatória')}`:''}<p>${esc(v.evidencia)}</p></div>`).join('') : '<p class="mudo">Nenhuma verificação registrada.</p>'}
    <div class="campo"><label class="rot">Verificações planejadas (um comando por linha)</label><textarea class="in" data-validacoes rows="2">${esc((c.validacoesObrigatorias || []).join('\n'))}</textarea></div>
    ${f.achados.length ? `<h4>Achados</h4>${f.achados.map(a=>`<div class="workflow-check"><b>${esc(a.severidade)} · ${esc(a.status)} · r${a.revisao}</b><p>${esc(a.arquivo)}:${a.linha} · ${esc(a.evidencia)}</p><p>${I18N.t('Impacto: {impacto}. Correção: {correcao}', { impacto: esc(a.impacto), correcao: esc(a.correcao) })}</p>${a.verificacao ? `<p>${I18N.t('Verificação: {evidencia}', { evidencia: esc(a.verificacao.evidencia) })}</p>` : ''}</div>`).join('')}` : ''}
    ${(c.relatorios || []).length?`<h4>Relatórios e handoffs</h4>${c.relatorios.map(r=>`<a class="anexo-arq" href="${P(`/cartao/${encodeURIComponent(c.id)}/relatorio?tipo=${r.tipo}&revisao=${r.revisao}&arquivo=${encodeURIComponent(r.nome)}`)}" download="${esc(r.nome)}">${I18N.t('Baixar {arquivo}', { arquivo: esc(r.nome) })}${r.autoral ? ` ${I18N.t('(escrito por {autor})', { autor: esc(r.autor) })}` : ''}</a>`).join('')}`:''}
    <button class="btn-sec" data-acao="decisoes">Decisões do projeto</button></section>`;
}
async function modalDecisoes() {
  const r = await api('GET', P('/decisoes'));
  abrirModal(`<h2>Decisões do projeto</h2><p>Decisões aceitas orientam todos os agentes envolvidos. Mudanças preservam o histórico.</p>${(r.decisoes || []).map(d=>`<section class="campo decisao"><b>${esc(d.id)} · r${d.revisao} · ${esc(d.status)} · ${esc(d.proposta.tipo)}</b><p>${esc(d.proposta.contexto)}</p>${d.proposta.opcoes.map(o=>`<div class="workflow-check"><b>${esc(o.texto)}${d.escolha===o.id?` · ${I18N.t('escolhida')}`:''}</b><p>${esc(o.consequencia)}</p>${d.status==='proposta'?`<button class="btn-sec" data-acao="aceitar-decisao" data-decisao="${esc(d.id)}" data-revisao="${d.revisao}" data-opcao="${esc(o.id)}">Escolher esta opção</button>`:''}</div>`).join('')}<button class="btn-sec" data-acao="editar-decisao" data-decisao="${esc(d.id)}">${I18N.t(d.status==='aceita'?'Revisar decisão':'Revisar proposta')}</button></section>`).join('') || '<p>Nenhuma decisão registrada.</p>'}<div class="acoes"><button class="btn-sec" data-acao="fechar">Fechar</button><button class="btn-primario" data-acao="editar-decisao">Nova decisão</button></div>`, 'perfil');
}
async function editarDecisao(id) {
  const r = await api('GET', P('/decisoes'));
  const d = r.decisoes?.find(d=>d.id===id);
  U.decisaoEdit = d || null;
  const opcoes = d?.proposta.opcoes || [{id:'opcao-1',texto:'',consequencia:''},{id:'opcao-2',texto:'',consequencia:''}];
  abrirModal(`<h2>${d?'Revisar decisão':'Nova decisão'}</h2>${d?.status==='aceita'?'<p>A versão aceita fica no histórico. A nova proposta precisará ser escolhida novamente.</p>':''}<div class="campo"><label class="rot">Quem decide</label><select class="in" id="dc-tipo"><option value="humana" ${d?.proposta.tipo==='humana'?'selected':''}>Pessoa responsável</option><option value="tecnica" ${d?.proposta.tipo==='tecnica'?'selected':''}>P.O. · decisão técnica</option></select></div><div class="campo"><label class="rot">Contexto e decisão necessária</label><textarea class="in" id="dc-contexto">${esc(d?.proposta.contexto || '')}</textarea></div><div class="campo"><label class="rot">Cards afetados (vazio = todo o projeto)</label><input class="in" id="dc-cards" value="${esc((d?.proposta.cards || []).join(', '))}"></div>${opcoes.map((o,i)=>`<div class="campo" data-decisao-opcao="${esc(o.id)}"><label class="rot">${I18N.t('Opção {n}', { n: i+1 })}</label><input class="in" data-dc-texto value="${esc(o.texto)}" placeholder="Escolha possível"><textarea class="in" data-dc-consequencia placeholder="Consequências e desvantagens">${esc(o.consequencia)}</textarea></div>`).join('')}<div class="acoes"><button class="btn-sec" data-acao="decisoes">Voltar</button><button class="btn-primario" data-acao="salvar-decisao">Registrar proposta</button></div>`, 'perfil');
}
function abrirIssue(id) { if (!cartao(id)) return; U.issue = id; renderIssue(true); }
function renderIssue(forcar = false) {
  const c = U.issue ? cartao(U.issue) : null;
  if (!c) return;
  const m = $('#modal');
  const bloqueioAberto=$('#i-bloqueio',m);
  if (bloqueioAberto) {
    bloqueioAberto.style.display=c.bloqueio?'':'none';
    $('.txt-bloqueio',bloqueioAberto).textContent=c.bloqueio || '';
    const chip=$('.issue-topo .loz.bloq',m);
    if (!c.bloqueio) chip?.remove();
    else if (!chip) $('.issue-topo .chave',m)?.insertAdjacentHTML('afterend','<span class="loz bloq">Bloqueado</span>');
    const botao=$('[data-acao="bloquear"],[data-acao="desbloquear"]',m);
    if (botao) { botao.dataset.acao=c.bloqueio?'desbloquear':'bloquear'; botao.textContent=c.bloqueio?I18N.t('Liberar bloqueio'):I18N.t('Bloquear'); }
  }
  // não reabre o card por cima de outra janela (ex.: "Arquivar?"), nem enquanto se digita nele
  if (!forcar && (m.hidden || !m.querySelector('.issue'))) return;
  if (!forcar && m.contains(document.activeElement) && /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName)) return;
  const dono = c.dono ? agente(c.dono) : null;
  const ok = c.aceite.filter((a) => a.ok).length;
  const comentarios = c.comentarios.map((k) => `<div class="coment">${av(k.quem, 'm', { dot: false })}<div class="corpo-c"><div class="quem"><b>${esc(nomeAgente(k.quem))}</b>${hhmm(k.em)}</div><div class="balao">${esc(k.texto)}</div></div></div>`).join('');
  const hist = [...c.historico].reverse().map((h) => `<div class="hist-i">${av(h.quem === 'sistema' ? 'voce' : h.quem, 'p', { dot: false })}<div class="txt"><b>${esc(h.quem === 'sistema' ? 'Sistema' : nomeAgente(h.quem))}</b> ${esc(h.txt)}<time>${hhmm(h.em)}</time></div></div>`).join('');
  abrirModal(`
    <div class="issue-topo"><span class="tipo ${/^STUDIO/.test(c.id) ? 'infra' : ''}">${ic('check')}</span><span class="chave">${esc(c.id)}</span>${c.bloqueio ? '<span class="loz bloq">Bloqueado</span>' : ''}${c.aguardando ? '<span class="loz andamento">Aguardando você</span>' : ''}
      <span class="espaco"></span><button class="btn-ic" data-acao="fechar" title="Fechar (Esc)">${ic('fechar')}</button></div>
    <div class="issue-corpo">
      <div class="issue-main">
        <textarea class="issue-titulo" id="i-titulo" data-campo="titulo" rows="1">${esc(c.titulo)}</textarea>
        <div id="i-bloqueio" class="bloq-aviso" style="${c.bloqueio?'':'display:none'}">${ic('bandeira')}<div><b>Bloqueado.</b> <span class="txt-bloqueio">${esc(c.bloqueio || '')}</span></div></div>
        <div class="sec"><h4>Descrição</h4><textarea class="in" data-campo="descricao" rows="4" placeholder="Adicionar descrição">${esc(c.descricao)}</textarea></div>
        <div class="sec"><h4>Critérios de aceite ${c.aceite.length ? `<span class="mudo">${I18N.t('{feito} de {total}', { feito: ok, total: c.aceite.length })}</span>` : ''}</h4>
          ${c.aceite.length ? `<div class="barra-prog"><i style="width:${Math.round(100 * ok / c.aceite.length)}%"></i></div>` : ''}
          ${c.aceite.map((a, i) => `<label class="check ${a.ok ? 'ok' : ''}"><input type="checkbox" data-aceite="${i}" ${a.ok ? 'checked' : ''}><span>${esc(a.t)}</span></label>`).join('')}
          <input class="in" data-novo-aceite placeholder="Adicionar critério" style="margin-top:8px"></div>
        ${(c.plano || []).length ? `<div class="sec"><h4>Plano de execução <span class="mudo">${I18N.t('{feito} de {total}', { feito: c.plano.filter((p) => p.status === 'feito').length, total: c.plano.length })}</span></h4>${c.plano.map((p) => `<div class="passo ${p.status}" title="${esc(p.evidencia || '')}"><span class="n">${p.n}</span><span class="t">${esc(p.titulo)}${p.saida ? `<small>${esc(p.saida)}</small>` : ''}</span>${p.dono ? av(p.dono, 'p', { dot: false }) : ''}<span class="st">${{ feito: 'feito', pulado: 'pulado', pendente: 'pendente' }[p.status] || p.status}</span></div>`).join('')}</div>` : ''}
        ${c.evidencias.length ? `<div class="sec"><h4>Evidências</h4>${c.evidencias.map((e) => `<div class="evid">${esc(e)}</div>`).join('')}</div>` : ''}
        ${fatosHtml(c.id)}
        ${c.arquivos.length ? `<div class="sec"><h4>Arquivos</h4>${c.arquivos.map((e) => `<span class="arq">${esc(e)}</span>`).join('')}</div>` : ''}
        ${validacaoHtml(c)}${workflowHtml(c)}
        <div class="sec"><h4>Atividade</h4>
          <div class="ativ-abas"><button data-aba="comentarios" class="${U.abaAtiv === 'comentarios' ? 'on' : ''}">Comentários</button><button data-aba="historico" class="${U.abaAtiv === 'historico' ? 'on' : ''}">Histórico</button></div>
          ${U.abaAtiv === 'comentarios'
            ? `<div class="coment">${av('voce', 'm', { dot: false })}<div class="corpo-c"><textarea class="in" data-comentario rows="2" placeholder="Adicionar comentário. Enter envia."></textarea></div></div>${comentarios}`
            : hist}</div>
      </div>
      <div class="issue-side">
        <div class="campo"><select class="in sel-status" data-mover style="color:${COR_COL[c.coluna]};font-weight:700">${E.colunas.map((x) => `<option value="${x.id}" ${x.id === c.coluna ? 'selected' : ''}>${esc(x.nome)}</option>`).join('')}</select></div>
        <div class="rot" style="margin-top:6px">Detalhes</div>
        <div class="side-linha"><span>Responsável</span><span class="val">${dono ? av(dono.id, 'p', { dot: false }) : ''}<select class="in" data-campo="dono"><option value="">Sem dono</option>${rosterAtual().filter((a) => !a.sistema).map((a) => `<option value="${a.id}" ${a.id === c.dono ? 'selected' : ''}>${esc(a.nome)}</option>`).join('')}</select></span></div>
        <div class="side-linha"><span>Prioridade</span><span class="val"><span class="prio ${c.prioridade}">${ic(iconePrio[c.prioridade])}</span><select class="in" data-campo="prioridade">${['alta', 'normal', 'baixa'].map((p) => `<option value="${p}" ${p === c.prioridade ? 'selected' : ''}>${nomePrio[p]}</option>`).join('')}</select></span></div>
        <div class="side-linha"><span>Jira</span><span class="val"><input class="in" data-campo="jira" value="${esc(c.jira || '')}" placeholder="ABC-123" maxlength="30">${c.jira && J().integ?.jira?.url ? `<a class="ref" href="${esc(J().integ.jira.url)}/browse/${esc(c.jira)}" target="_blank" rel="noopener">abrir</a>` : ''}</span></div>
        <div class="side-linha"><span>Esforço</span><span class="val"><select class="in" data-campo="pontos"><option value="">Sem estimativa</option>${PONTOS.map((p) => `<option value="${p}" ${p === c.pontos ? 'selected' : ''}>${I18N.t(p === 1 ? '{n} ponto' : '{n} pontos', { n: p })}</option>`).join('')}</select></span></div>
        ${(() => { const g = (J().custos?.cards || {})[c.id]; return g ? `<div class="side-linha"><span>Custo</span><span class="val" title="Valor de tabela dos tokens gastos neste card; a assinatura não cobra por chamada, é a régua do orçamento">${g.toFixed(2)}</span></div>` : ''; })()}
        <div class="side-linha"><span>Motor</span><span class="val"><select class="in" data-campo="motor"><option value="" ${!c.motor ? 'selected' : ''}>Padrão dos Ajustes</option><option value="claude" ${c.motor === 'claude' ? 'selected' : ''}>Claude</option><option value="codex" ${c.motor === 'codex' ? 'selected' : ''}>Codex</option></select></span></div>
        ${E.config.creditos?.automatico ? `<div class="side-linha"><span>Teto de esforço</span><span class="val"><select class="in" data-campo="teto" title="A P.O. define o nível máximo de modelo e raciocínio deste card. Os agentes escolhem o nível dentro dele.">${[['', 'Só o teto da conta'], ['low', 'Low (modelos baixos)'], ['medium', 'Medium (até Sonnet 5.5)'], ['high', 'High (libera Opus)']].map(([v, n]) => `<option value="${v}" ${v === (c.teto || '') ? 'selected' : ''}>${n}</option>`).join('')}</select></span></div>` : `<div class="side-linha"><span>Modelo</span><span class="val"><select class="in" data-campo="modelo">${MODELOS_CLAUDE.map(([v, n]) => `<option value="${v}" ${v === (c.modelo || '') ? 'selected' : ''}>${v ? n : 'Padrão dos Ajustes'}</option>`).join('')}</select></span></div>
        <div class="side-linha"><span>Raciocínio</span><span class="val"><select class="in" data-campo="esforco">${ESFORCOS.map(([v, n]) => `<option value="${v}" ${v === (c.esforco || '') ? 'selected' : ''}>${v ? n : 'Padrão dos Ajustes'}</option>`).join('')}</select></span></div>`}
        ${contextoCardHtml(c)}
        <div class="rot" style="margin-top:10px">Participantes</div>
        <div class="part-lista">${(c.participantes || []).map((p) => `<div class="part-i">${av(p.agente, 'p', { dot: false })}<span class="nm">${esc(nomeAgente(p.agente))}</span><select class="in" data-part-papel="${p.agente}"><option value="colabora" ${p.papel === 'colabora' ? 'selected' : ''}>Colabora</option><option value="monitora" ${p.papel === 'monitora' ? 'selected' : ''}>Monitora</option></select><button class="btn-ic" data-part-rem="${p.agente}" title="Tirar do card">${ic('fechar')}</button></div>`).join('') || '<div class="vazio-p" style="padding:2px 0 6px">Só o responsável.</div>'}</div>
        <select class="in" data-part-add><option value="">Adicionar ao card</option>${rosterAtual().filter((a) => !a.sistema && a.id !== c.dono && !(c.participantes || []).some((p) => p.agente === a.id)).map((a) => `<option value="${a.id}">${esc(a.nome)}, ${esc(a.cargo)}</option>`).join('')}</select>
        <div class="side-linha"><span>Nesta etapa</span><span class="val">${ha(c.naColunaDesde)}</span></div>
        <div class="side-linha"><span>Criado</span><span class="val">${ha(c.criado)}</span></div>
        <div class="side-linha"><span>Atualizado</span><span class="val">${ha(c.atualizado)}</span></div>
        <div class="side-acoes">
          ${c.bloqueio ? '<button class="btn-sec" data-acao="desbloquear">Liberar bloqueio</button>' : '<button class="btn-sec" data-acao="bloquear">Bloquear</button>'}
          ${c.dono ? `<button class="btn-sec" data-acao="pedir-status">${I18N.t('Pedir andamento a {nome}', { nome: esc(primeiroNome(nomeAgente(c.dono))) })}</button>` : ''}
          <button class="btn-sec btn-perigo" data-acao="arquivar">Remover tarefa</button></div>
      </div>
    </div>`, 'issue');
  const t = $('#i-titulo');
  if (t) { t.style.height = 'auto'; t.style.height = `${t.scrollHeight}px`; }
}
// Fichas do registro que o card aponta: quem pega o card recebe cada uma inteira no prompt, sem procurar.
function contextoCardHtml(c) {
  const fichas = (typeof REG !== 'undefined' && REG.dados?.entradas) || [];
  const atual = c.contexto || [];
  if (!fichas.length && !atual.length && !(J().registro?.total)) return '';
  const nomeFicha = (k) => fichas.find((f) => f.chave === k)?.nome || k;
  return `<div class="rot" style="margin-top:10px" title="${I18N.t('Fichas do {registro} que chegam inteiras a quem pega o card', { registro: esc(J().registro?.vista || I18N.t('registro')) })}">${I18N.t('Fichas do {registro}', { registro: esc(J().registro?.vista || I18N.t('registro')) })}</div>
    <div class="reg-ctx">${atual.map((k) => `<span class="chip-cam" title="${esc(k)}">${ic('ficha')}${esc(nomeFicha(k))}<button class="btn-ic" data-ctx-rem="${esc(k)}" title="Tirar do card">${ic('fechar')}</button></span>`).join('') || '<div class="vazio-p" style="padding:2px 0 6px">Nenhuma. O agente recebe o que a tarefa citar pelo nome.</div>'}</div>
    ${fichas.length ? `<select class="in" data-ctx-add><option value="">Apontar ficha</option>${fichas.filter((f) => !atual.includes(f.chave)).map((f) => `<option value="${esc(f.chave)}">${esc(f.nome)} (${esc((REG.dados.tipos[f.tipo] || {}).titulo || f.tipo)})</option>`).join('')}</select>` : ''}`;
}
// Ficha de fatos do card: o que o app mediu (job, validação, git) e o que os agentes registraram. É a fonte de verdade, não o chat.
function fatosHtml(cardId) {
  const f = J().fatos || {}; const doCard = Object.entries(f.cards?.[cardId] || {}); const doProj = Object.entries(f.projeto || {});
  if (!doCard.length && !doProj.length) return '';
  const linha = ([k, x]) => `<div class="fato ${x.origem === 'app' ? 'medido' : ''}" title="${esc(x.evidencia || '')}"><b>${esc(k)}</b><span class="val">${esc(x.valor)}</span><small>${x.origem === 'app' ? I18N.t('medido pelo app') : I18N.t('por {nome}', { nome: esc(x.por) })} ${hhmm(x.em)}</small></div>`;
  return `<div class="sec"><h4>Fatos ${doCard.length ? `<span class="mudo">${I18N.t('{n} do card', { n: doCard.length })}</span>` : ''}</h4>${doCard.map(linha).join('')}${doProj.length ? `<details class="fatos-proj"><summary>${I18N.t('Do projeto ({n})', { n: doProj.length })}</summary>${doProj.map(linha).join('')}</details>` : ''}</div>`;
}
async function patchCard(campos) {
  const r = await api('PATCH', P(`/cartao/${U.issue}`), { campos });
  if (!r._ok) aviso(r.erro || I18N.t('Não salvou.'));
}

/* ---- ajustes ---- */
/* ---- página Conexões: um clique para entrar na conta (Jira, Notion, Teams, Trello). Valem para o app inteiro. ---- */
const CX_ORDEM = ['jira', 'notion', 'github', 'teams', 'trello'];
const CX_NOME = { jira: 'Jira', notion: 'Notion', github: 'GitHub', teams: 'Teams', trello: 'Trello' };
const CX_LETRA = { jira: 'J', notion: 'N', github: 'G', teams: 'T', trello: 'T' };
const CX_ESTADO = {
  healthy: 'Conectado', connected: 'Conectado', limited_access: 'Conectado com acesso limitado', authentication_expired: 'O login venceu',
  permission_denied: 'Sem permissão', policy_blocked: 'Bloqueado pela empresa', sync_error: 'Com erro', pending_authorization: 'Esperando você entrar', not_configured: 'Não conectado',
};
function conexaoCard(app, c = {}) {
  const nome = CX_NOME[app];
  const ok = c.conectado; const venceu = ['authentication_expired', 'permission_denied', 'sync_error'].includes(c.estado);
  let linha, botao;
  if (c.entrando) {
    linha = (app === 'teams' || app === 'github') && c.codigo ? `${I18N.t(app === 'github' ? 'Na página do GitHub que abriu, digite o código <b>{codigo}</b> e entre com a sua conta.' : 'Na página da Microsoft que abriu, digite o código <b>{codigo}</b> e entre com a conta da empresa.', { codigo: esc(c.codigo.usuario) })} <a href="${esc(c.codigo.url)}" target="_blank" rel="noopener">Abrir de novo</a>` : `Termine o login no navegador que abriu. Esta tela atualiza sozinha.`;
    botao = `<button class="btn-sec" data-acao="cx-cancelar" data-app="${app}">Cancelar</button>`;
  } else if (ok) {
    linha = `${I18N.t(CX_ESTADO[c.estado] || 'Conectado')}${c.conta ? ` ${I18N.t('como {conta}', { conta: esc(c.conta) })}` : ''}. ${c.detalhe ? esc(c.detalhe) : ''}`;
    botao = `<button class="btn-sec" data-acao="cx-verificar" data-app="${app}">Testar</button><button class="btn-sec btn-perigo" data-acao="cx-desconectar" data-app="${app}">Desconectar</button>`;
  } else if (venceu) {
    linha = `${I18N.t(CX_ESTADO[c.estado])}. ${esc(c.detalhe || '')}`;
    botao = `<button class="btn-primario" data-acao="cx-conectar" data-app="${app}">Reconectar</button><button class="btn-sec btn-perigo" data-acao="cx-desconectar" data-app="${app}">Desconectar</button>`;
  } else {
    linha = c.precisaConfig ? (app === 'github' ? `Falta o Client ID do aplicativo (Configuração da TI, abaixo). Enquanto isso, um token pessoal no Modo manual também conecta.` : `Precisa de uma liberação única da TI (veja Configuração da TI, abaixo). Depois é só clicar em Conectar.`) : I18N.t(app === 'teams' ? 'Entre com a sua conta Microsoft da empresa. Serve para {uso}.' : 'Entre com a sua conta. Serve para {uso}.', { uso: esc(c.uso || '') });
    botao = `<button class="btn-primario" data-acao="cx-conectar" data-app="${app}">Conectar</button>`;
  }
  const erro = c.erro && !ok && !c.entrando ? `<div class="cx-erro">${esc(c.erro.texto)}</div>` : '';
  return `<div class="conta ${ok ? 'on' : ''} ${venceu ? 'alerta' : ''}" data-conexao="${app}" data-estado="${esc(c.estado || '')}"><span class="conta-ic cx-${app}">${CX_LETRA[app]}</span><div class="conta-info"><b>${nome}</b><small>${linha}</small>${erro}</div><div class="cx-botoes">${botao}</div></div>`;
}
/** Identificadores do aplicativo (não são de conta nenhuma): quem distribui o NECTAR, ou a TI, configura uma vez; quem usa só clica. */
function configAppHtml(cxs) {
  const g = cxs.gifs || {};
  return `<details class="cx-app"><summary>Configuração da TI (uma vez só, por quem distribui o app)</summary>
    <div class="dica-v" style="color:var(--mudo);margin:6px 0 10px">Jira e Notion não precisam de nada aqui. A Microsoft e o Trello exigem um aplicativo registrado pela empresa; depois de preencher, quem usa só clica em Conectar.</div>
    <div class="campo"><label class="rot">Teams: ID do aplicativo no Azure (e o domínio da empresa, se a TI pedir)</label><div class="linha-in"><input class="in" id="app-teams" value="${esc(cxs.app?.teamsClientId || '')}" placeholder="ID do aplicativo (cliente público)" autocomplete="off"><input class="in" id="app-tenant" value="${esc(cxs.app?.teamsTenant && cxs.app.teamsTenant !== 'organizations' ? cxs.app.teamsTenant : '')}" placeholder="empresa.com (opcional)" autocomplete="off" style="max-width:200px"></div></div>
    <div class="campo"><label class="rot">Trello: chave do aplicativo</label><input class="in" id="app-trello" value="${esc(cxs.app?.trelloKey || '')}" placeholder="Gerada em trello.com/power-ups/admin" autocomplete="off"></div>
    <div class="campo"><label class="rot">GitHub: Client ID do OAuth App (com Device Flow ligado)</label><input class="in" id="app-github" value="${esc(cxs.app?.githubClientId || '')}" placeholder="${cxs.app?.githubPadrao ? 'O app já vem com um. Preencha só para trocar.' : 'Registrado em github.com/settings/developers'}" autocomplete="off"></div>
    <div class="campo"><label class="rot">GIFs da comunidade</label><div class="linha-in"><select class="in" id="app-gif-prov" style="max-width:120px"><option value="giphy" ${g.provedor !== 'tenor' ? 'selected' : ''}>GIPHY</option><option value="tenor" ${g.provedor === 'tenor' ? 'selected' : ''}>Tenor</option></select><input class="in" id="app-gif" type="password" placeholder="${g.temChave ? 'Chave guardada. Deixe em branco para manter.' : 'Chave do provedor de GIFs (opcional)'}" autocomplete="new-password"></div></div>
    <button class="btn-sec" data-acao="cx-app-salvar">Salvar configuração da TI</button></details>`;
}
let timerCx = null;
function acompanharConexoes() {
  clearTimeout(timerCx);
  timerCx = setTimeout(async () => {
    if ($('#modal').hidden || U.ajuste !== 'integracoes' || !$('[data-conexao]')) return;
    const r = await fetch('/api/conexoes').then((x) => x.json()).catch(() => null);
    if (!r) return;
    for (const k of CX_ORDEM) { const el = $(`[data-conexao=${k}]`); if (el && r[k]) el.outerHTML = conexaoCard(k, r[k]); }
    if (CX_ORDEM.some((k) => r[k]?.entrando)) acompanharConexoes();
  }, 2500);
}

/* ---- página Modelos: conta do Claude e do Codex (conectar pelo site oficial, desconectar) ---- */
function contaCard(eng, contasM) {
  const c = contasM[eng] || {}, nome = eng === 'claude' ? 'Claude' : 'Codex', site = eng === 'claude' ? 'claude.ai' : 'chatgpt.com';
  const inst = contasM.instalar?.[eng] || {};
  const win = contasM.plataforma === 'win32';
  let estado, botao;
  if (!c.instalado) {
    estado = `<b>${I18N.t('{motor} não está instalado neste computador.', { motor: nome })}</b><small>Instale e clique em Verificar de novo.</small><code class="conta-cmd">${esc((win ? inst.win : inst.unix) || inst.npm || '')}</code>${inst.npm && (win ? inst.win : inst.unix) ? `<code class="conta-cmd">${esc(inst.npm)}</code>` : ''}`;
    botao = `<button class="btn-sec" data-acao="conta-verificar">Verificar de novo</button>`;
  } else if (c.entrando) {
    estado = `<b>${I18N.t('Esperando você entrar no {site}…', { site })}</b><small>${c.url ? I18N.t('Se o navegador não abriu, <a href="{url}" target="_blank" rel="noopener">abra o login aqui</a>.', { url: esc(c.url) }) : 'O navegador vai abrir a página de login.'}</small>`;
    botao = `<button class="btn-sec" data-acao="conta-cancelar" data-eng="${eng}">Cancelar</button>`;
  } else if (c.conectado) {
    estado = `<b>${c.email ? I18N.t('Conectado como {email}', { email: esc(c.email) }) : I18N.t('Conectado')}</b><small>${[c.plano && I18N.t('Plano {plano}', { plano: esc(c.plano) }), c.metodo && esc(c.metodo), c.versao && I18N.t('versão {versao}', { versao: esc(c.versao) })].filter(Boolean).join(', ')}</small>`;
    botao = `<button class="btn-sec btn-perigo" data-acao="conta-desconectar" data-eng="${eng}">Desconectar</button>`;
  } else {
    estado = `<b>Não conectado</b><small>${I18N.t(eng === 'claude' ? 'Entre com a sua conta do Claude para usar o {motor}.' : 'Entre com a sua conta do ChatGPT para usar o {motor}.', { motor: nome })}</small>`;
    botao = `<button class="btn-primario" data-acao="conta-conectar" data-eng="${eng}">Conectar</button>`;
  }
  return `<div class="conta ${c.conectado ? 'on' : ''}" data-conta="${eng}"><span class="conta-ic ${eng}">${eng === 'claude' ? 'C' : 'O'}</span><div class="conta-info">${estado}</div>${botao}</div>`;
}
let timerConta = null;
function acompanharContas() {
  clearTimeout(timerConta);
  timerConta = setTimeout(async () => {
    if ($('#modal').hidden || U.ajuste !== 'motores' || !$('.conta')) return;
    const r = await fetch('/api/contas?forcar=1').then((x) => x.json()).catch(() => null);
    if (!r) return;
    const mudou = ['claude', 'codex'].some((e) => $(`[data-conta=${e}]`)?.classList.contains('on') !== !!r[e]?.conectado);
    if (mudou) return modalAjustes();
    if (r.claude?.entrando || r.codex?.entrando) { for (const e of ['claude', 'codex']) { const el = $(`[data-conta=${e}]`); if (el) el.outerHTML = contaCard(e, r); } acompanharContas(); }
  }, 2500);
}

async function modalAjustes() {
  const c = E.config;
  const p = projetoAtual();
  const [modelos, versoes, versoesClaude, contasM] = await Promise.all([
    fetch('/api/modelos-codex').then((r) => r.json()).catch(() => []),
    fetch('/api/codex-versoes').then((r) => r.json()).catch(() => ({ opcoes: [] })),
    fetch('/api/claude-versoes').then((r) => r.json()).catch(() => ({ opcoes: [] })),
    fetch('/api/contas').then((r) => r.json()).catch(() => ({})),
    fetch('/api/voz').then((r) => r.json()).catch(() => ({})),
  ]).then(([a, b, c2, contas, vozCfg]) => [a, b, c2, { ...contas, voz: vozCfg }]);
  const cxs = U.ajuste === 'integracoes' ? await Promise.all([fetch('/api/conexoes').then((r) => r.json()), fetch('/api/gifs').then((r) => r.json())]).then(([a, gifs]) => ({ ...a, gifs })).catch(() => ({})) : {};
  const mcps = U.ajuste === 'mcp' ? await fetch('/api/mcp').then((r) => r.json()).catch(() => []) : [];
  const aba = U.ajuste;
  const vigia = aba === 'projeto' && U.proj ? (await (await fetch(P('/vigia'))).json().catch(() => ({}))) : {};
  const regrasProj = aba === 'projeto' && U.proj ? await (await fetch(P('/regras'))).json().catch(() => ({})) : {};
  const opcoesModelo = [['', 'Padrão do Codex (config.toml)'], ...modelos.map((m) => [m.slug, m.nome])];
  if (c.modeloCodex && !modelos.some((m) => m.slug === c.modeloCodex)) opcoesModelo.push([c.modeloCodex, c.modeloCodex]);
  const sw = (id, titulo, sub, on) => `<label class="interruptor"><input type="checkbox" id="${id}" ${on ? 'checked' : ''}><span><b>${titulo}</b><small>${sub}</small></span></label>`;
  const corpo = {
    dispositivos: dispositivosHtml(),
    motores: `<h2>Modelos</h2>
      ${contaCard('claude', contasM)}
      ${(() => { const vz = contasM.voz || {}; const sv = vz.servico || {}; return `<div class="campo" style="margin:14px 0 18px"><label class="rot">Voz da chamada (tudo roda neste computador)</label>
        <div class="dica-v" style="color:var(--mudo)">Voz natural em português (Chatterbox) e reconhecimento de fala (Whisper), os dois rodando neste computador: nada da conversa sai daqui. Precisa de placa de vídeo com 4 GB livres; na primeira chamada os modelos são carregados e pode levar um minuto.</div>
        <div class="dica-v" style="color:var(--mudo);margin-top:6px">${sv.disponivel ? I18N.t('Serviço carregado: reconhecimento {stt}, voz {tts}.', { stt: esc(sv.stt || ''), tts: esc(sv.tts || '') }) : 'O serviço de voz carrega quando você abre uma chamada.'}</div>
        <div class="dica-v" style="color:var(--mudo);margin-top:6px">${I18N.t('Microfone, alto-falante, volume e sensibilidade ficam na aba <b>Dispositivos</b>.')}</div>
        ${(() => { const v = vz.voz || { nome: 'leni', ritmo: 0.4, expressividade: 0.45 }; const vozes = vz.vozes || []; const atual = vozes.find((x) => x.id === v.nome);
          return `<div style="margin-top:14px"><label class="rot">Voz</label><select class="in" id="voz-nome">${vozes.map((x) => `<option value="${esc(x.id)}" ${x.id === v.nome ? 'selected' : ''}>${esc(x.nome)}${x.genero ? ` (${esc(x.genero)})` : ''}</option>`).join('')}</select>
            <div class="dica-v" id="voz-origem" style="color:var(--mudo);margin-top:6px">${atual ? I18N.t('Timbre e sotaque: {origem}.', { origem: esc(atual.origem) }) : ''} ${I18N.t('A voz é gerada pelo modelo a partir de uma amostra curta; as amostras do app são leituras brasileiras de domínio público.')}</div>
            <div class="dois campo" style="margin-top:10px"><div><label class="rot">Ritmo <em id="voz-ritmo-v">${Math.round(v.ritmo * 100)}</em></label><input type="range" class="faixa" id="voz-ritmo" min="15" max="80" step="5" value="${Math.round(v.ritmo * 100)}"><div class="dica-v" style="color:var(--mudo)">Para a esquerda fala mais pausado; para a direita, mais corrido.</div></div>
              <div><label class="rot">Expressividade <em id="voz-exp-v">${Math.round(v.expressividade * 100)}</em></label><input type="range" class="faixa" id="voz-exp" min="20" max="90" step="5" value="${Math.round(v.expressividade * 100)}"><div class="dica-v" style="color:var(--mudo)">Mais alto é mais entonação (e um pouco mais rápido).</div></div></div>
            <div class="linha-in"><button class="btn-sec" data-acao="voz-previa">Ouvir prévia</button><label class="btn-sec arquivo">Usar minha amostra (WAV de 10 a 20 s)<input type="file" accept=".wav,audio/wav" hidden id="voz-amostra"></label><small class="dica-v" id="voz-previa-st" style="color:var(--mudo)"></small></div></div>`; })()}
        ${(() => { const nv = vz.niveis || { fala: 'chat', tela: 'chat', analise: 'medium' }; const NV = [['chat', 'Igual ao chat'], ['minimo', 'Mínimo (Haiku)'], ['low', 'Low (Sonnet 4.6)'], ['medium', 'Medium (Sonnet 5.5)'], ['high', 'High (Opus)']]; const sel = (k) => `<select class="in" data-voz-nivel="${k}">${NV.map(([v, n]) => `<option value="${v}" ${nv[k] === v ? 'selected' : ''}>${n}</option>`).join('')}</select>`;
          return `<div style="margin-top:14px"><label class="rot">Quanto gastar na reunião</label>
          <div class="dica-v" style="color:var(--mudo);margin-bottom:8px">Por padrão a ligação é a mesma conversa do chat, com o mesmo modelo e raciocínio. Se quiser economizar, dá para baixar o nível de cada momento; o agente só sobe sozinho quando pede para analisar a tela em detalhe, sempre dentro do teto do projeto.</div>
          <div class="voz-niveis"><div><span>Falar</span>${sel('fala')}<small>resposta curta por voz</small></div><div><span>Ver a tela</span>${sel('tela')}<small>quando a tela compartilhada mudou</small></div><div><span>Analisar a tela</span>${sel('analise')}<small>só quando o agente pede detalhe</small></div></div></div>`; })()}</div>`; })()}
      <fieldset class="aj-motor" ${contasM.claude?.conectado ? '' : 'disabled'}>
      <div class="campo"><label class="rot">Claude, modelo</label>
        <select class="in" id="a-claude">${MODELOS_CLAUDE.map(([v, n]) => `<option value="${v}" ${c.modeloClaude === v ? 'selected' : ''}>${n}</option>`).join('')}${c.modeloClaude && !MODELOS_CLAUDE.some(([v]) => v === c.modeloClaude) ? `<option value="${esc(c.modeloClaude)}" selected>${esc(c.modeloClaude)}</option>` : ''}</select></div>
      <div class="campo"><label class="rot">Claude, nível de esforço</label>
        <select class="in" id="a-esforco">${ESFORCOS.map(([v, n]) => `<option value="${v}" ${c.esforcoClaude === v ? 'selected' : ''}>${n}</option>`).join('')}</select>
        <div class="dica-v" style="color:var(--mudo)">Mais esforço pensa melhor e demora mais. Vale para todos os agentes.</div></div>
      <div class="campo"><label class="rot">Claude Code, versão em uso</label>
        <select class="in" id="a-claude-exe">${[['', `${I18N.t('Automático')}${versoesClaude.maisNovo ? ` (${(versoesClaude.opcoes.find((o) => o.id === versoesClaude.maisNovo) || {}).versao || ''})` : ''}`], ...versoesClaude.opcoes.map((o) => [o.id, `${o.rotulo}: ${o.versao}`])].map(([v, n]) => `<option value="${esc(v)}" ${c.claudeExe === v ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select>
        <div style="margin-top:8px"><button class="btn-sec" data-testar="claude">Testar Claude</button></div><div id="t-claude"></div></div>
      </fieldset>
      ${contaCard('codex', contasM)}
      <fieldset class="aj-motor" ${contasM.codex?.conectado ? '' : 'disabled'}>
      <div class="campo"><label class="rot">Codex, versão em uso</label>
        <select class="in" id="a-exe">${[['', `${I18N.t('Automático')}${versoes.maisNovo ? ` (${(versoes.opcoes.find((o) => o.id === versoes.maisNovo) || {}).versao || ''})` : ''}`], ...versoes.opcoes.map((o) => [o.id, `${o.rotulo}: ${o.versao}`])].map(([v, n]) => `<option value="${esc(v)}" ${c.codexExe === v ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select></div>
      <div class="campo"><label class="rot">Codex, nível de raciocínio</label>
        <select class="in" id="a-esforco-codex">${ESFORCOS_CODEX.map(([v, n]) => `<option value="${v}" ${c.esforcoCodex === v ? 'selected' : ''}>${n}</option>`).join('')}</select>
        <div class="dica-v" style="color:var(--mudo)">Vale para quando o card não define o raciocínio. Cada modelo do Codex aceita um conjunto de níveis.</div></div>
      <div class="campo"><label class="rot">Codex, modelo</label>
        ${modelos.length ? `<select class="in" id="a-codex">${opcoesModelo.map(([v, n]) => `<option value="${esc(v)}" ${c.modeloCodex === v ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select>` : `<input class="in" id="a-codex" value="${esc(c.modeloCodex)}" placeholder="Modelo que a sua conta aceita">`}
        <div style="margin-top:8px"><button class="btn-sec" data-testar="codex">Testar Codex</button></div><div id="t-codex"></div></div>
      </fieldset>`,
    mcp: `<h2>MCP</h2>
      <p class="mudo" style="margin-top:-4px">Ferramentas externas que o agente de MCP usa para o time. Os do Claude Code desta máquina aparecem sozinhos; ligue os que o time pode usar.</p>
      <div class="mcp-lista">${mcps.map((x) => `<div class="mcp-i ${x.ativo ? 'on' : ''}"><label class="interruptor"><input type="checkbox" data-mcp-ativo="${esc(x.nome)}" ${x.ativo ? 'checked' : ''}><span><b>${esc(x.nome)}</b><small title="${esc(x.alvo)}">${I18N.t(x.tipo === 'stdio' ? 'local' : 'remoto')}, ${I18N.t(x.origem === 'claude' ? 'do Claude Code' : 'cadastrado aqui')}${x.alvo ? `: ${esc(x.alvo)}` : ''}</small></span></label><input class="in" data-mcp-desc="${esc(x.nome)}" value="${esc(x.descricao)}" placeholder="Para que serve (os agentes leem isto)">${x.origem === 'manual' ? `<button class="btn-ic" data-acao="mcp-remover" data-mcp="${esc(x.nome)}" title="Remover">${ic('fechar')}</button>` : ''}</div>`).join('') || '<div class="vazio-p">Nenhum MCP encontrado.</div>'}</div>
      <div class="campo" style="margin-top:16px"><label class="rot">Adicionar MCP</label>
        <div class="linha-in"><input class="in" id="mcp-nome" placeholder="nome, ex.: notion" style="max-width:170px"><select class="in" id="mcp-tipo" style="max-width:120px"><option value="http">Remoto (URL)</option><option value="stdio">Local (comando)</option></select><input class="in" id="mcp-alvo" placeholder="https://... ou o comando, ex.: npx -y @notionhq/mcp"></div>
        <div class="linha-in" style="margin-top:6px"><input class="in" id="mcp-extra" placeholder='Variáveis ou cabeçalhos em JSON (opcional), ex.: {"API_KEY":"..."}'><button class="btn-sec" data-acao="mcp-adicionar">Adicionar</button></div></div>`,
    creditos: `<h2>Créditos</h2>
      <div class="campo"><label class="rot">Fim do expediente</label>
        <select class="in" id="cr-parar">${[[80, '80% de uso'], [90, '90% de uso'], [95, '95% de uso, deixa folga para o que está rodando'], [100, '100% de uso, no limite']].map(([v, n]) => `<option value="${v}" ${c.creditos.pararEm === v ? 'selected' : ''}>${n}</option>`).join('')}</select>
        <div class="dica-v" style="color:var(--mudo)">O app lê o uso da conta a cada resposta (sem gastar uma chamada de modelo). Ao chegar aqui, os agentes do Claude param sozinhos e voltam quando a janela renova.</div></div>
      ${sw('cr-auto', 'Cris escolhe modelo e raciocínio', 'Conversa e rotina usam modelo leve; Sonnet 5.5 / Terra 6.1 no médio é o padrão; Opus 5.5 / Sol 6.1 em low só no difícil; high só depois de retrabalho. Desligada, valem os modelos dos Motores e o que o card pedir.', c.creditos.automatico)}
      ${sw('cr-troca', 'Passar o trabalho para o outro motor', 'Se o Claude parou no limite, o Codex continua (e o contrário), enquanto o outro estiver livre. Sem isto, tudo espera a renovação.', c.creditos.trocarMotor)}
      <div class="campo" style="margin-top:12px"><label class="rot">Piso de modelo por cargo</label>
        <div class="dica-v" style="color:var(--mudo);margin-bottom:8px">O menor modelo que o cargo pode usar. Vale sempre, mesmo com o uso da conta alto e mesmo se o card pedir economia. Arquitetura, revisão de código e segurança são julgamento sênior: um modelo fraco ali não faz sentido.</div>
        ${rosterAtual().filter((a) => !a.sistema).map((a) => `<div class="side-linha"><span>${esc(a.nome)}, ${esc(a.cargo)}</span><span class="val"><select class="in" data-piso="${a.id}">${[['', 'Sem piso'], ['medio', 'Sonnet 5.5 ou melhor'], ['forte', 'Opus 5 ou melhor']].map(([v, n]) => `<option value="${v}" ${((c.creditos.pisos || {})[a.id] || '') === v ? 'selected' : ''}>${n}</option>`).join('')}</select></span></div>`).join('')}</div>
      <div class="campo" style="margin-top:12px"><label class="rot">Modelo do Codex por peso do card</label>
        <div class="quatro" style="grid-template-columns:repeat(3,1fr)">${[['leve', 'Leve (1 a 2 pontos)'], ['medio', 'Médio (3 a 5)'], ['forte', 'Forte (8 ou mais)']].map(([k, n]) => `<div><label class="rot" style="font-size:10.5px">${n}</label>${modelos.length ? `<select class="in" id="cr-${k}">${modelos.map((m) => `<option value="${esc(m.slug)}" ${c.creditos.codex[k] === m.slug ? 'selected' : ''}>${esc(m.nome)}</option>`).join('')}${modelos.some((m) => m.slug === c.creditos.codex[k]) ? '' : `<option value="${esc(c.creditos.codex[k])}" selected>${esc(c.creditos.codex[k])}</option>`}</select>` : `<input class="in" id="cr-${k}" value="${esc(c.creditos.codex[k])}">`}</div>`).join('')}</div>
        <div class="dica-v" style="color:var(--mudo)">O nível de raciocínio do card vale igual no Codex.</div></div>`,
    integracoes: (() => {
      const ig = J().integ || { jira: {}, agenda: {} };
      const j = ig.jira || {}; const a = ig.agenda || {};
      return `<h2>Conexões</h2>
      <div class="dica-v" style="color:var(--mudo);margin:-6px 0 14px">Clique em Conectar e entre com a sua conta no site oficial. Vale para todos os projetos. Os agentes só leem; criar, editar ou enviar algo é sempre com o seu ok.</div>
      ${CX_ORDEM.map((k) => conexaoCard(k, cxs[k] || {})).join('')}${configAppHtml(cxs)}
      <details class="cx-app"><summary>Modo manual (sem login): token do GitHub, do Jira Data Center e link de calendário</summary>
      <div class="dica-v" style="color:var(--mudo);margin:6px 0 14px">Só para quem não consegue usar o Conectar acima (por exemplo Jira instalado no servidor da empresa). O app só lê.</div>
      <div class="campo"><label class="rot">GitHub: token pessoal</label><div class="linha-in"><input class="in" id="ig-github-token" type="password" placeholder="${cxs.github?.conectado ? 'Conectado. Cole outro só para trocar.' : 'ghp_… ou github_pat_… (gerado em github.com/settings/tokens)'}" autocomplete="new-password"><button class="btn-sec" data-acao="cx-github-token">Usar token</button></div></div>
      ${sw('ig-jira-ativo', 'Jira', 'A P.O. enxerga as suas demandas em aberto.', j.ativo)}
      <div class="campo"><label class="rot">Endereço do Jira</label><input class="in" id="ig-jira-url" value="${esc(j.url || '')}" placeholder="https://jira.suaempresa.com" autocomplete="off"></div>
      <div class="dois campo"><div><label class="rot">Acesso (Data Center ou Cloud)</label><select class="in" id="ig-jira-tipo"><option value="pat" ${j.tipo !== 'cloud' ? 'selected' : ''}>Token pessoal</option><option value="cloud" ${j.tipo === 'cloud' ? 'selected' : ''}>Jira Cloud</option></select></div>
        <div><label class="rot">E-mail (só no Jira Cloud)</label><input class="in" id="ig-jira-usuario" value="${esc(j.usuario || '')}" autocomplete="off"></div></div>
      <div class="campo"><label class="rot">Token</label><input class="in" type="password" id="ig-jira-token" placeholder="${j.temToken ? 'Guardado. Deixe em branco para manter.' : 'Cole o token'}" autocomplete="new-password">
        <div class="dica-v" style="color:var(--mudo)">${ig.cofre ? 'Fica cifrado pelo Windows, ligado à sua conta.' : 'Fora do app, o token fica em texto no disco desta máquina.'}</div></div>
      <div class="campo"><label class="rot">Consulta (JQL), opcional</label><textarea class="in" id="ig-jira-jql" rows="2" placeholder="assignee = currentUser() AND resolution = Unresolved ORDER BY priority DESC">${esc(j.jql || '')}</textarea></div>
      <div style="margin:-6px 0 14px"><button class="btn-sec" data-acao="testar-integ" data-alvo="jira">Testar Jira</button><div id="ig-jira-teste"></div></div>
      ${sw('ig-agenda-ativo', 'Agenda (Teams e Outlook)', 'A P.O. sabe da próxima review, da daily e do seu dia, e você é avisado antes das reuniões.', a.ativo)}
      <div class="campo"><label class="rot">Link do calendário (ICS) ou arquivo .ics</label><input class="in" id="ig-agenda-fonte" value="${esc(a.fonte || '')}" placeholder="https://outlook.office365.com/owa/calendar/…/calendar.ics" autocomplete="off">
        <div class="dica-v" style="color:var(--mudo)">No Outlook na web: Configurações, Calendário, Calendários compartilhados, Publicar um calendário, e copie o link ICS. As reuniões do Teams estão nele. Se a sua empresa bloquear a publicação, exporte um .ics e aponte o arquivo.</div></div>
      <div style="margin:-6px 0 14px"><button class="btn-sec" data-acao="testar-integ" data-alvo="agenda">Testar agenda</button><div id="ig-agenda-teste"></div></div>
      <div class="campo"><label class="rot">Reler a cada</label><select class="in" id="ig-int" style="max-width:140px">${[5, 10, 15, 30, 60].map((m) => `<option value="${m}" ${ig.intervaloMin === m ? 'selected' : ''}>${I18N.t('{n} min', { n: m })}</option>`).join('')}</select></div></details>`;
    })(),
    ciclo: `<h2>Ciclo da equipe</h2>
      ${sw('c-rev', 'Revisão e QA automáticos', 'Card que entra em Revisão chama o P.O.; em QA, chama o QA.', c.ciclo.revisaoAuto)}
      ${sw('c-cur', 'Curadoria ao concluir', 'Ao concluir um card com notas novas, o Curador organiza a memória.', c.ciclo.curadoriaAuto)}
      ${sw('c-fec', 'Fechamento do P.O.', 'No fim de um pedido que mexeu com vários agentes, o P.O. resume o que ficou pronto e pendente.', c.ciclo.fechamento)}
      ${sw('c-pil', 'Piloto automático', 'Executa a demanda clara, continua as rodadas e encaminha revisão e QA enquanto o app estiver aberto. Sem demanda executável, aguarda. Se um motor atingir o limite, usa o outro quando disponível. Mantém o computador acordado.', c.piloto.ativo)}
      ${sw('c-pil-po', 'No piloto, a P.O. fala por mim', 'Com o piloto ligado, as dúvidas dos agentes vão para a P.O., que decide na hora no meu lugar e nada vira "precisa de você". Eu só recebo, na DM com a P.O., o relato objetivo de cada decisão e o motivo. Aprovação de planning e decisões registradas no painel de Decisões continuam comigo.', c.piloto.poDecide !== false)}
      <div class="campo"><label class="rot">Limite opcional de chamadas por hora (0 = sem limite)</label><input type="number" class="in" id="c-pil-max" min="0" max="120" value="${c.piloto.maxChamadasHora}" style="max-width:110px"></div>
      ${sw('c-loc', 'Modelo local (Ollama nesta máquina)', 'Redação de fala de evento, triagem de pergunta rotineira no piloto, extração de fatos de jobs e resumo do que aconteceu rodam num modelo local, de graça. Sem o Ollama no ar, o app segue sem essa camada; nada de rumo é decidido por ele.', (c.local || {}).ativo !== false)}
      <div class="campo"><label class="rot">Endereço do Ollama</label><input class="in" id="c-loc-url" value="${esc((c.local || {}).url || 'http://127.0.0.1:11434')}" style="max-width:320px"></div>
      <div class="campo"><label class="rot">Modelo local</label><input class="in" id="c-loc-modelo" value="${esc((c.local || {}).modelo || '')}" placeholder="hf.co/bartowski/Qwen_Qwen3-4B-Instruct-2507-GGUF:Q4_K_M" style="max-width:520px"></div>
      <div class="campo"><label class="rot">Quem escreve a fala de evento dos agentes (entrega, conclusão, job)</label><select class="in" id="c-loc-falas" style="max-width:420px">${[['haiku', 'Haiku (personalidade inteira; o local é reserva quando a cota aperta)'], ['local', 'Só o modelo local (tom curto, de graça)'], ['off', 'Ninguém (só as mensagens do app)']].map(([v, n]) => `<option value="${v}" ${v === ((c.local || {}).falasMotor || 'haiku') ? 'selected' : ''}>${n}</option>`).join('')}</select></div>
      ${sw('c-ass', 'Assessor por conta própria (Assessoria)', 'O app junta sinais sem gastar chamada (reunião chegando, demanda nova no Jira, entrega ou impedimento nas outras equipes, card aguardando você) e só chama o assessor quando há sinal novo. Ele adianta o que cabe na autonomia dele e propõe o resto. Sem sinal novo, silêncio.', c.ciclo.assessorAuto === true)}
      ${sw('c-background', 'Continuar com a janela fechada', 'No aplicativo instalado, mantém as execuções na bandeja do Windows enquanto o piloto ou o Assessor estiver ligado. Use Encerrar na bandeja para parar.', c.ciclo.segundoPlano === true)}
      <div class="campo"><label class="rot">Intervalo mínimo entre rondas do assessor</label><select class="in" id="c-ass-min" style="max-width:160px">${[15, 30, 60, 120, 240].map((n) => `<option value="${n}" ${Number(c.ciclo.assessorIntervaloMin || 60) === n ? 'selected' : ''}>${n < 60 ? I18N.t('{n} min', { n }) : I18N.t('{n} h', { n: n / 60 })}</option>`).join('')}</select></div>
      <div class="campo"><label class="rot">O que pode acordar o assessor</label><div class="ass-cats">${[['agenda', 'Reunião chegando (agenda)'], ['jira', 'Demanda nova ou mudada no Jira'], ['equipes', 'Entrega ou impedimento nas outras equipes'], ['quadro', 'Card aguardando você ou bloqueado'], ['perguntas', 'Pergunta aberta dos agentes'], ['custos', 'Uso dos modelos perto do limite']].map(([k, rot]) => `<label class="ass-cat"><input type="checkbox" data-ass-cat="${k}" ${(c.ciclo.assessorCategorias || {})[k] !== false && !(k === 'custos' && (c.ciclo.assessorCategorias || {})[k] === undefined) ? 'checked' : ''}> ${rot}</label>`).join('')}</div></div>
      <div class="campo" style="display:flex;gap:14px;align-items:flex-end"><div><label class="rot">Horário em que ele toma iniciativa</label><div class="linha-in"><input type="time" class="in" id="c-ass-ini" value="${esc(c.ciclo.assessorHorario?.inicio || '07:00')}" style="max-width:120px"><input type="time" class="in" id="c-ass-fim" value="${esc(c.ciclo.assessorHorario?.fim || '21:00')}" style="max-width:120px"></div></div></div>
      ${sw('c-rel', 'Relatório do dia', 'Na hora marcada, com o app aberto, o app monta o relatório do dia (o que concluiu, o que está parado, o que depende de você) sem gastar nenhuma chamada de modelo.', c.relatorio.ativo)}
      <div class="campo" style="margin:4px 0 10px;display:flex;gap:14px;align-items:flex-end"><div><label class="rot">Hora do relatório</label><input type="time" class="in" id="c-rel-hora" value="${esc(c.relatorio.hora)}" style="max-width:130px"></div></div>
      ${sw('c-rel-po', 'O P.O. comenta o relatório', 'Gasta uma chamada por relatório: ele diz em poucas linhas o que mais importa e o que recomenda para amanhã.', c.relatorio.comentarioPO)}
      ${sw('c-ver', 'Versionamento ao concluir', 'Quando um card conclui, a Vera (Versionamento) avalia conflito, faz o commit só do que é da tarefa e dá push da branch do ticket. Nunca força nem mexe em develop ou main.', c.ciclo.versionar)}
      ${sw('c-prep', 'Debate no planning', 'No planning, os especialistas comentam as opiniões uns dos outros antes da proposta. Desligado, vai direto da opinião para a proposta e gasta menos.', c.ciclo.planningReplica)}
      ${sw('c-posts', 'Relatório final no canal Posts', 'Quando um card conclui, o responsável escreve o relatório final como documento estruturado (com prints) e publica no canal Posts. Gasta uma chamada por card.', c.ciclo.posts)}
      ${sw('c-sta', 'P.O. acompanha cada mudança de status', 'Quando um card muda de etapa ou é bloqueado, o P.O. intervém se precisar e conta a você como está o andamento. Agrupa as mudanças e espera 1 minuto entre uma conversa e outra.', c.ciclo.statusPO)}
      <div class="campo" style="margin-top:12px"><label class="rot">Limpar o contexto dos agentes a cada</label><select class="in" id="c-limp" style="max-width:160px">${[[0, 'Nunca'], [2, '2 horas'], [3, '3 horas'], [5, '5 horas'], [8, '8 horas'], [12, '12 horas'], [24, '24 horas']].map(([v, n]) => `<option value="${v}" ${(c.ciclo.limpezaHoras ?? 5) === v ? 'selected' : ''}>${n}</option>`).join('')}</select><div class="dica-v" style="color:var(--mudo)">Reinicia o que os agentes leem da conversa, para não gastar tokens com assunto velho. A conversa continua visível para você; cards, regras e memória não mudam.</div></div>
      <div class="campo" style="margin-top:12px"><label class="rot">Agentes trabalhando ao mesmo tempo</label><select class="in" id="c-par" style="max-width:120px">${[1, 2, 3, 4, 5, 6].map((n) => `<option value="${n}" ${c.ciclo.paralelo === n ? 'selected' : ''}>${n}</option>`).join('')}</select><div class="dica-v" style="color:var(--mudo)">Agentes diferentes rodam em paralelo; o mesmo agente nunca roda duas vezes junto. Mais paralelo gasta o limite mais rápido.</div></div>
      <div class="campo" style="margin-top:12px"><label class="rot">Máximo de chamadas por pedido</label><input type="number" class="in" id="c-orc" min="2" max="40" value="${c.ciclo.orcamento}" style="max-width:120px"><div class="dica-v" style="color:var(--mudo)">Trava contra uma conversa de agentes que não termina. Cada chamada usa a sua assinatura.</div></div>`,
    quadro: `<h2>Quadro</h2><label class="rot">Limite de trabalho em andamento</label>
      <div class="quatro">${[['pronto', 'Pronto'], ['andamento', 'Andamento'], ['revisao', 'Revisão'], ['qa', 'QA']].map(([k, n]) => `<div><label class="rot" style="font-size:10.5px">${n}</label><input type="number" class="in" min="1" max="20" id="w-${k}" value="${c.wip[k]}"></div>`).join('')}</div>`,
    projeto: p ? `<h2>${esc(p.nome)}</h2>
      <div class="campo"><label class="rot">Equipes do projeto</label>
        ${equipesDoProjeto(p).map((e) => `<div class="eq-linha"><span class="eq-ic" style="--h:${matiz(e.cid)}">${esc(String(e.nome).trim()[0] || 'E')}</span><span class="eq-nome">${esc(e.nome)}${e.id === 'principal' ? ' <small>(principal)</small>' : ''}</span><button class="btn-sec" data-acao="eq-renomear" data-eq="${esc(e.id)}" data-nome="${esc(e.nome)}">Renomear</button>${e.id === 'principal' ? '' : `<button class="btn-sec btn-perigo" data-acao="eq-tirar" data-eq="${esc(e.id)}" data-nome="${esc(e.nome)}">Tirar</button>`}</div>`).join('')}
        <button class="btn-sec" data-acao="nova-equipe" style="margin-top:8px">Adicionar equipe</button></div>
      <div class="campo"><label class="rot">Nome</label><div class="linha-in"><input class="in" id="p-nome" value="${esc(p.nome)}"><button class="btn-sec" data-acao="renomear-proj">Renomear</button></div></div>
      <div class="campo"><label class="rot">Seu perfil neste projeto</label><button class="btn-sec" data-acao="perfil" data-ag="voce">${av('voce', 'p')} Editar meu nome e minha foto</button></div>
      <div class="campo"><label class="rot">Regras da equipe</label><button class="btn-sec" data-acao="regras-equipe">Ver decisões e regras da P.O.</button></div>
      <div class="campo"><label class="rot">Decisões do projeto</label><button class="btn-sec" data-acao="decisoes">Ver propostas e escolhas aceitas</button></div>
      <div class="campo"><label class="rot">Tipo de projeto</label><div class="caminho">${esc(p.templateNome || '')}</div></div>
      <div class="campo"><label class="rot">Pasta alvo, de onde o P.O. começa a análise</label><div class="caminho">${esc(p.raiz)}</div>${window.studioApp ? `<div style="margin-top:6px"><button class="btn-sec" data-acao="abrir-pasta" data-caminho="${esc(p.raiz)}">Abrir pasta</button></div>` : ''}</div>
      <div class="campo"><label class="rot">Pasta do projeto, onde ficam memória, quadro e conversas</label><div class="caminho">${esc(p.pastaProjeto || '')}</div>${window.studioApp ? `<div style="margin-top:6px"><button class="btn-sec" data-acao="abrir-pasta" data-caminho="${esc(p.pastaProjeto || '')}">Abrir pasta</button></div>` : ''}</div>
      <div class="campo"><label class="rot">Arquivos desta equipe</label><div id="aj-arquivos" class="arquivos-painel"><span class="mudo">Medindo…</span></div></div>
      <div class="campo"><label class="rot">Pastas extras que o time pode olhar</label><textarea class="in" id="ex-texto" rows="3" placeholder="Uma pasta por linha. A pasta alvo não limita o time: citar um caminho numa mensagem também libera a leitura.">${esc((p.extras || []).join('\n'))}</textarea><div style="margin-top:8px"><button class="btn-sec" data-acao="salvar-extras">Salvar pastas extras</button></div></div>
      <div class="campo"><label class="rot">Vigia dos repositórios</label>
        ${sw('vg-ativo', 'Acompanhar os repositórios', 'Enquanto houver trabalho no projeto, o app olha os repositórios abaixo (só leitura) e, se houver commit, branch ou mudança no remoto, a P.O. analisa o impacto no andamento.', vigia.ativo)}
        <textarea class="in" id="vg-repos" rows="3" placeholder="Um repositório por linha (caminho da pasta).">${esc((vigia.repos || []).join('\n'))}</textarea>
        <div class="dois" style="margin-top:8px"><div><label class="rot">Olhar a cada</label><select class="in" id="vg-int">${[5, 10, 15, 30, 60].map((n) => `<option value="${n}" ${vigia.intervaloMin === n ? 'selected' : ''}>${I18N.t('{n} min', { n })}</option>`).join('')}</select></div>
          <div style="padding-top:18px">${sw('vg-remoto', 'Buscar o remoto', 'Faz git fetch (não mexe em branch nem arquivo).', vigia.buscarRemoto)}</div></div>
        <div style="margin-top:8px;display:flex;gap:8px"><button class="btn-sec" data-acao="salvar-vigia">Salvar vigia</button><button class="btn-sec" data-acao="vigia-agora">Olhar agora</button></div></div>
      ${blocoRegras('projeto', regrasProj, 'Regras do projeto, para todos os agentes')}
      ${blocoReferencias('projeto', regrasProj)}
      <div class="campo"><label class="rot">Personalidades do time</label><button class="btn-sec" data-acao="sortear-time">Sortear temperamentos para o time</button>
        <div class="dica-v" style="color:var(--mudo);margin-top:6px">Quem ainda não tem personalidade própria ganha uma e passa a brincar com os colegas. Dá para trocar a de cada um no perfil, aba Conversa.</div></div>
      <div class="campo"><label class="rot">Salvar e restaurar</label>
        <div class="dica-v" style="color:var(--mudo);margin-bottom:8px">O app guarda uma cópia do projeto sozinho a cada 10 minutos (só se algo mudou). Salvar na mão cria um ponto que nunca é apagado sozinho.</div>
        <button class="btn-sec" data-acao="salvar-projeto">Salvar projeto agora</button>
        <div id="pontos-lista" class="pontos-lista"><div class="dica-v" style="color:var(--mudo)">Carregando...</div></div></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn-sec" data-acao="conhecer">Pedir ao P.O. para conhecer o projeto</button>
        <button class="btn-sec btn-perigo" data-acao="remover-proj">Remover do app</button></div>` : '<h2>Projeto</h2><div class="vazio-p">Adicione um projeto primeiro.</div>',
  }[aba];
  abrirModal(`<div class="aj-nav"><div class="titulo">Ajustes</div>${[['motores', 'Modelos'], ['dispositivos', 'Dispositivos'], ['mcp', 'MCP'], ['creditos', 'Créditos'], ['ciclo', 'Ciclo da equipe'], ['integracoes', 'Conexões'], ['quadro', 'Quadro'], ['projeto', 'Projeto']].map(([k, n]) => `<button data-aj="${k}" class="${aba === k ? 'on' : ''}">${n}</button>`).join('')}</div>
    <div class="aj-corpo">${corpo}<div class="acoes"><button class="btn-sec" id="m-nao">Fechar</button><button class="btn-primario" id="m-sim">Salvar</button></div></div>`, 'ajustes');
  if (aba === 'projeto' && p) carregarPontos();
  if (aba === 'dispositivos') montarDispositivos();
  if (aba === 'motores') montarVozAjustes(contasM.voz || {});
  const salvar = async () => {
    const req = {};
    { const vozSel = $('input[name="voz-tts"]:checked'); if (vozSel) await api('PUT', '/api/voz', { tts: vozSel.value }); }
    { const nvs = $$('[data-voz-nivel]'); if (nvs.length) await api('PUT', '/api/voz', { niveis: Object.fromEntries(nvs.map((s) => [s.dataset.vozNivel, s.value])) }); }
    if ($('#voz-nome')) await api('PUT', '/api/voz', { voz: vozEscolhida() });
    if ($('#a-claude')) req.modeloClaude = $('#a-claude').value;
    if ($('#a-esforco')) req.esforcoClaude = $('#a-esforco').value;
    if ($('#a-claude-exe')) req.claudeExe = $('#a-claude-exe').value;
    if ($('#a-codex')) req.modeloCodex = $('#a-codex').value;
    if ($('#a-esforco-codex')) req.esforcoCodex = $('#a-esforco-codex').value;
    if ($('#a-exe')) req.codexExe = $('#a-exe').value;
    if ($('#w-pronto')) req.wip = Object.fromEntries(['pronto', 'andamento', 'revisao', 'qa'].map((k) => [k, Number($(`#w-${k}`).value)]));
    if ($('#c-rev')) req.ciclo = { revisaoAuto: $('#c-rev').checked, curadoriaAuto: $('#c-cur').checked, fechamento: $('#c-fec').checked, statusPO: $('#c-sta').checked, versionar: $('#c-ver').checked, planningReplica: $('#c-prep').checked, assessorAuto: $('#c-ass')?.checked ?? false, segundoPlano: $('#c-background')?.checked ?? false, assessorIntervaloMin: Number($('#c-ass-min')?.value || 60), assessorCategorias: Object.fromEntries($$('[data-ass-cat]').map((x) => [x.dataset.assCat, x.checked])), assessorHorario: { inicio: $('#c-ass-ini')?.value || '07:00', fim: $('#c-ass-fim')?.value || '21:00' }, posts: $('#c-posts').checked, orcamento: Number($('#c-orc').value), paralelo: Number($('#c-par').value), limpezaHoras: Number($('#c-limp').value) };
    if ($('#c-pil')) req.piloto = { ativo: $('#c-pil').checked, maxChamadasHora: Number($('#c-pil-max').value), poDecide: $('#c-pil-po').checked };
    if ($('#c-loc')) req.local = { ativo: $('#c-loc').checked, url: $('#c-loc-url').value.trim() || 'http://127.0.0.1:11434', modelo: $('#c-loc-modelo').value.trim(), falasMotor: $('#c-loc-falas')?.value || 'haiku' };
    if ($('#c-rel')) req.relatorio = { ativo: $('#c-rel').checked, hora: $('#c-rel-hora').value || '18:00', comentarioPO: $('#c-rel-po').checked };
    if ($('#cr-parar')) req.creditos = { pararEm: Number($('#cr-parar').value), trocarMotor: $('#cr-troca').checked, automatico: $('#cr-auto').checked, pisos: Object.fromEntries($$('[data-piso]').map((s) => [s.dataset.piso, s.value])), codex: { leve: $('#cr-leve').value, medio: $('#cr-medio').value, forte: $('#cr-forte').value } };
    const r = await api('POST', '/api/config', req);
    if (r._ok) { E.config = { ...E.config, ...r }; aplicarPiloto(); renderTudo(); }
    if ($('#ig-jira-url') && U.proj) {
      const ri = await api('PUT', P('/integracoes'), { jira: { ativo: $('#ig-jira-ativo').checked, url: $('#ig-jira-url').value, tipo: $('#ig-jira-tipo').value, usuario: $('#ig-jira-usuario').value, jql: $('#ig-jira-jql').value, token: $('#ig-jira-token').value }, agenda: { ativo: $('#ig-agenda-ativo').checked, fonte: $('#ig-agenda-fonte').value }, intervaloMin: Number($('#ig-int').value) });
      if (ri._ok) { J().integ = ri; renderTudo(); }
    }
    return r._ok;
  };
  $('#m-sim').onclick = async () => { if (await salvar()) fecharModal(); };
  $('#m-nao').onclick = fecharModal;
  $$('[data-testar]').forEach((b) => {
    b.onclick = async () => {
      const eng = b.dataset.testar; const alvo = $(`#t-${eng}`);
      await salvar();
      alvo.innerHTML = '<div class="teste espera">Testando…</div>';
      const r = await api('POST', '/api/testar', { engine: eng });
      alvo.innerHTML = r.ok ? `<div class="teste ok">${I18N.t('Funcionou. Respondeu "{texto}" em {s} s.', { texto: esc(r.texto), s: (r.ms / 1000).toFixed(1) })}</div>` : `<div class="teste falha">${esc(r.erro || 'Falhou.')}</div>`;
    };
  });
  if (U.ajuste === 'projeto') carregarArquivos();   // tamanho por categoria e faxina, medido depois de a tela abrir
}

/* ---- trocador rápido (Ctrl+K) ---- */
function abrirTroca() {
  U.troca = { q: '', sel: 0 };
  abrirModal(`<input id="troca-q" placeholder="Ir para um projeto, canal, agente ou tarefa" autocomplete="off"><div class="res" id="troca-res"></div><div class="troca-rodape"><kbd>↑</kbd> <kbd>↓</kbd> navegar &nbsp; <kbd>Enter</kbd> abrir &nbsp; <kbd>Esc</kbd> fechar</div>`, 'troca');
  $('#troca-q').focus();
  renderTroca();
}
function itensTroca() {
  const q = U.troca.q.trim().toLowerCase();
  const projs = [...E.projetos.map((p) => ({ id: p.id, rotulo: p.nome, sub: 'Projeto', icone: `<span class="av p" style="--c:hsl(${matiz(p.id)} 60% 50%)">${esc(iniciais(p.nome))}</span>`, ir: `${ultimaEquipe(p.id)}/chat/equipe` })),
    ...todasEquipes().filter((e) => equipesDoProjeto(e.projeto).length > 1).map((e) => ({ id: e.cid, rotulo: e.nome, sub: I18N.t('Equipe de {projeto}', { projeto: e.projeto.nome }), icone: `<span class="av p" style="--c:hsl(${matiz(e.cid)} 50% 45%)">${esc(iniciais(e.nome))}</span>`, ir: `${e.cid}/chat/equipe` }))];
  const canais = [{ id: 'equipe', rotulo: 'equipe', sub: 'Canal', icone: ic('hash'), ir: `${U.proj}/chat/equipe` },
    ...rosterDaEquipe().filter((a) => !a.sistema).map((a) => ({ id: a.id, rotulo: a.nome, sub: a.papel, icone: av(a.id, 'p', { dot: false }), ir: `${U.proj}/chat/dm:${a.id}` }))];
  const cards = J().cartoes.map((c) => ({ id: c.id, rotulo: c.titulo, sub: c.id, icone: `<span class="tipo">${ic('check')}</span>`, card: c.id }));
  const f = (x) => !q || `${x.rotulo} ${x.sub} ${x.id}`.toLowerCase().includes(q);
  return [...projs.filter(f).slice(0, 4), ...(U.proj ? canais.filter(f).slice(0, 7) : []), ...cards.filter(f).slice(0, 7)];
}
function renderTroca() {
  const itens = itensTroca();
  U.troca.sel = Math.min(U.troca.sel, Math.max(0, itens.length - 1));
  $('#troca-res').innerHTML = itens.length
    ? itens.map((x, i) => `<button class="${i === U.troca.sel ? 'sel' : ''}" data-troca="${i}">${x.icone}<span>${esc(x.rotulo)}</span><small>${esc(x.sub)}</small></button>`).join('')
    : '<div class="vazio-p">Nada encontrado.</div>';
  U.troca.itens = itens;
}
function irTroca(i) {
  const x = U.troca.itens[i];
  if (!x) return;
  fecharModal();
  if (x.card) abrirIssue(x.card); else location.hash = x.ir;
}

/* ------------------------------------------------------------ render geral e estado */
function renderSemProjeto() {
  $('#app').className = 'app vista-planner';
  renderRail();
  $('#centro').innerHTML = `<div class="sem-projeto"><div class="caixa-b">${logo(72)}<h1>nectar</h1>
    <p>Uma equipe de agentes que conversa, divide o trabalho e guarda o que aprende. Comece apontando uma pasta de projeto.</p>
    <button class="btn-primario" data-acao="novo-projeto" style="margin:0 auto;height:38px;padding:0 20px">${ic('mais')}Adicionar projeto</button></div></div>`;
  $('#projeto-app').textContent = '';
}
function renderTudo() {
  if (!U.proj) return renderSemProjeto();
  const chat = U.vista === 'chat';
  $('#app').className = `app vista-${chat ? 'chat' : 'planner'} ${U.membros ? '' : 'sem-membros'}`;
  renderRail();
  if (chat) { renderLista(); renderChat(); renderMembros(); }
  else if (U.vista === 'planner') renderPlanner();
  else if (U.vista === 'agenda') renderAgenda();
  else if (U.vista === 'colmeia') renderColmeia();
  else if (U.vista === 'registro') renderRegistro();
  else renderMemoria();
  $('#projeto-app').textContent = projetoAtual()?.raiz || '';
}
async function recarregarApp() {
  const e = await (await fetch('/api/app')).json();
  Object.assign(E, { roster: e.roster, templates: e.templates || [], marca: e.marca || E.marca, colunas: e.colunas, config: e.config, projetos: e.projetos, ativo: e.ativo, perguntas: e.perguntas, uso: e.uso || null, pausas: e.pausas || {} });
}
async function carregarProjeto(id) {
  const p = E.projetos.find((x) => x.id === baseDe(id));
  if (!p || p.existe === false || !equipeDe(id)) return;
  const e = await (await fetch(P('/estado', id))).json();
  const ant = PJ[id] || { canais: {}, naoLidas: {}, bastidores: [] };
  PJ[id] = Object.assign(ant, { usuario: e.usuario, integ: await (await fetch(P('/integracoes', id))).json().catch(() => null), naoLidasN: e.naoLidas || 0, roster: e.roster, template: e.template, lider: e.lider || 'po', equipeNome: e.equipeNome || null, cartoes: e.cartoes, wip: e.wip, motores: e.motores || null, planning: e.planning || [], grupos: e.grupos || [], posts: e.posts || [], presenca: e.presenca || {}, perguntas: e.perguntas || [], memoria: e.memoria || {}, externos: e.externos || [], fatos: e.fatos || { projeto: {}, cards: {} }, jobs: e.jobs || [], custos: e.custos || { cards: {}, envelope: null }, registro: e.registro || { vista: 'Registro', total: 0 } });
  PJ[id].teamwork=e.teamwork||null;
}

// Com vários agentes trabalhando, chegam dezenas de eventos por segundo. Cada tipo de redesenho acontece no máximo uma vez por
// quadro de animação, com o estado mais recente (o dado é atualizado na hora; só o desenho espera).
const desenhos = new Map();
function depois(chave, fn) {
  if (desenhos.has(chave)) return;
  const roda = () => { desenhos.delete(chave); try { fn(); } catch (err) { console.error(err); } };
  // janela em segundo plano não recebe quadro de animação: um temporizador garante que o desenho acontece mesmo assim
  const t = setTimeout(() => { if (desenhos.has(chave)) { cancelAnimationFrame(desenhos.get(chave).raf); roda(); } }, 250);
  desenhos.set(chave, { raf: requestAnimationFrame(() => { clearTimeout(t); roda(); }) });
}
const timersQuadro = {};
function quadroMudou(pid) {
  clearTimeout(timersQuadro[pid]);
  timersQuadro[pid] = setTimeout(async () => {
    const e = await (await fetch(P('/quadro', pid))).json().catch(() => null);
    if (!e || !PJ[pid]) return;
    Object.assign(PJ[pid], { cartoes: e.cartoes, wip: e.wip });
    if (pid !== U.proj) return;
    if (U.vista === 'planner') renderConteudoPlanner(); else if (U.vista === 'chat') renderMembros(); else if (U.vista === 'registro') renderRegistro(false);
    if (U.issue) renderIssue();
  }, 300);
}
function presencaMudou(e) {
  const j = PJ[e.projeto];
  if (!j) return;
  if (e.estado === 'livre') delete j.presenca[e.agente]; else j.presenca[e.agente] = e;
  depois('rail', renderRail);
  if (e.projeto !== U.proj) return;
  depois('presenca', () => {
    if (U.vista === 'chat') {
      renderLista(); renderMembros(); renderDigitando();
      const cab = $('#centro .cabeca'); if (cab) cab.outerHTML = cabecaChat();
      const slot = $('#slot-enviar'); if (slot) slot.innerHTML = botaoEnviar();
      $$('.msg[data-status="trabalhando"]').forEach((m) => { const p = j.presenca[m.dataset.de]; const a = $('.ativ', m); if (p && a) a.textContent = p.atividade || I18N.t('trabalhando'); });
    } else if (U.vista === 'planner') renderConteudoPlanner();
  });
}
function notificar(titulo, corpo) {
  try {
    if (!('Notification' in window)) return;
    if (Notification.permission === 'default') Notification.requestPermission();
    if (Notification.permission === 'granted' && (document.hidden || !document.hasFocus())) new Notification(titulo, { body: corpo });
  } catch { /* o sistema não deixou: o sino do app já avisa */ }
}
function perguntaNova(e) {
  const q = { ...e.pergunta, projeto: e.projeto, projetoNome: e.projetoNome };
  if (!E.perguntas.some((x) => x.id === q.id && x.projeto === q.projeto)) E.perguntas.unshift(q);
  const j = PJ[e.projeto];
  if (j && !j.perguntas.some((x) => x.id === q.id)) j.perguntas.push(e.pergunta);
  notificar(I18N.t('{nome} precisa de você', { nome: nomeAgente(q.de) }), `${q.projetoNome}: ${q.texto.slice(0, 120)}`);
  renderRail();
  if (e.projeto === U.proj && U.vista === 'chat') { renderLista(); renderMembros(); }
  if (U.inbox) modalInbox();
}
function perguntaAtualizada(e) {
  const q = e.pergunta;
  const j = PJ[e.projeto];
  if (j) { const i = j.perguntas.findIndex((x) => x.id === q.id); if (i >= 0) j.perguntas[i] = q; else j.perguntas.push(q); }
  if (q.estado !== 'aberta' || q.paraPO) E.perguntas = E.perguntas.filter((x) => !(x.id === q.id && x.projeto === e.projeto));
  renderRail();
  if (e.projeto === U.proj && U.vista === 'chat') {
    renderLista(); renderMembros();
    $$(`.msg [data-q="${q.id}"]`).forEach((el) => { const m = el.closest('.msg'); const msg = (j.canais[U.canal] || []).find((x) => `msg-${x.id}` === m.id); if (msg) m.outerHTML = msgHtml(msg, null); });
  }
  if (U.inbox) modalInbox();
}

/* ------------------------------------------------------------ rotas e eventos */
async function rotear() {
  const segs = (location.hash || '#').slice(1).split('/').filter(Boolean);
  if (segs.length && equipeDe(segs[0])) U.proj = segs.shift();
  else if (segs.length && E.projetos.some((p) => p.id === segs[0])) U.proj = ultimaEquipe(segs.shift());
  else if (!U.proj || !equipeDe(U.proj)) U.proj = E.ativo && E.projetos.some((p) => p.id === E.ativo) ? ultimaEquipe(E.ativo) : (E.projetos[0] ? ultimaEquipe(E.projetos[0].id) : null);
  if (U.proj) lembrarEquipe(U.proj);
  if (!U.proj) return renderTudo();
  if (!PJ[U.proj]) await carregarProjeto(U.proj);
  if (E.ativo !== baseDe(U.proj)) { E.ativo = baseDe(U.proj); api('POST', P('/ativar'), {}); }
  const vista = ['chat', 'planner', 'memoria', 'agenda', 'colmeia', 'registro'].includes(segs[0]) ? segs.shift() : 'chat';
  if (vista === 'registro') { const resto = decodeURIComponent(segs.join('/')); if (resto === 'gerados') U.regModo = 'gerados'; else { U.regModo = 'fichas'; if (resto) U.regSel = resto; } }
  U.vista = vista;
  if (vista === 'chat') {
    const canal = decodeURIComponent(segs.join('/')) || U.canal || 'equipe';
    return abrirCanal(/^(equipe|bastidores|posts|dm:[a-z_]+|plan-\d+|grp-\d+)$/.test(canal) ? canal : 'equipe');
  }
  renderTudo();
  if (vista === 'planner' && segs[0] && cartao(segs[0])) abrirIssue(segs[0]);
}
const irPara = (vista, resto = '') => { location.hash = `${U.proj}/${vista}${resto ? `/${resto}` : ''}`; };

document.addEventListener('mouseover', (ev) => {
  const t = ev.target.closest?.('.rail-btn[data-tip]');
  if (t) t.style.setProperty('--tip-y', `${Math.round(t.getBoundingClientRect().top + t.offsetHeight / 2)}px`);
});

document.addEventListener('click', async (ev) => {
  if (!ev.target.closest('#pcard-pop')) {
    const alvo = ev.target.closest('.msg .lado .av[data-perfil], .msg .cab b, #membros .membro .av[data-perfil], .cabeca > .av[data-perfil], .pcard-av .av');
    if (alvo && !ev.target.closest('#pcard-pop, .ped-prev')) { const id = alvo.dataset.perfil || alvo.closest('[data-de]')?.dataset.de; if (id && pessoaDe(id)) { ev.preventDefault(); ev.stopPropagation(); return abrirCartao(id, alvo); } }
    fecharCartao();
  }
  const ac = ev.target.closest('[data-card-comentar],[data-card-remover]');
  if (ac) {
    ev.stopPropagation();
    const id = ac.dataset.cardComentar || ac.dataset.cardRemover;
    if (ac.dataset.cardComentar) { abrirIssue(id); U.abaAtiv = 'comentarios'; renderIssue(true); setTimeout(() => $('[data-comentario]')?.focus(), 80); return; }
    if (await perguntar(I18N.t('Cancelar {id}? O card é excluído do quadro e a equipe não vai recriá-lo.', { id }), I18N.t('Cancelar tarefa'))) {
      const r = await api('POST', P(`/cartao/${id}/arquivar`), {});
      if (r._ok) aviso(I18N.t('{id} cancelada e excluída.', { id }));
    }
    return;
  }
  const card = ev.target.closest('.card[data-id]');
  if (card) return abrirIssue(card.dataset.id);
  if (ev.target.closest('[data-emoji]')) { inserirEmoji(ev.target.closest('[data-emoji]').dataset.emoji); return; }
  if (ev.target.closest('[data-emoji-aba]')) { return abrirEmoji($('[data-acao=emoji]'), ev.target.closest('[data-emoji-aba]').dataset.emojiAba); }
  const t = ev.target.closest('[data-uso-motor],[data-projeto],[data-eqsel],[data-vista],[data-canal],[data-issue],[data-acao],[data-motor],[data-modo],[data-mencao],[data-filtro],[data-visao],[data-aba],[data-aj],[data-copiar],[data-troca],[data-responder],[data-ir-canal],[data-nota],[data-cen],[data-notif],[data-part-rem],[data-anexo-rem],[data-ag-slot],[data-co],[data-avatar]');
  if (!t) return;
  const d = t.dataset;
  if (d.avatar) return escolherAvatar(U.ped?.id, Number(d.avatar));   // avatar da galeria da ferramenta
  if (d.anexoRem !== undefined) { const l = anexosAtuais(); const [x] = l.splice(Number(d.anexoRem), 1); if (x?.previa) URL.revokeObjectURL(x.previa); return renderAnexosPend(); }
  if (d.agSlot) return modalEvento(null, d.agSlot);   // clicou num horário vazio da agenda
  if (d.co) { if (d.co === 'rainha') return modalPerfil('voce'); const [cid, ag] = d.co.split('|'); location.hash = `${cid}/chat/dm:${ag}`; return; }   // célula da colmeia: abre a DM de quem está nela
  if (d.cen) { U.centroAba = d.cen; return modalCentral(d.cen); }
  if (d.notif) { const n = (J().notifs || []).find((x) => x.id === d.notif); if (n) { marcarLidas([n.id]); abrirNotif(U.proj, n); } return; }
  if (d.partRem) { const c = cartao(U.issue); return patchCard({ participantes: c.participantes.filter((p) => p.agente !== d.partRem) }); }
  if (d.projeto) { location.hash = `${ultimaEquipe(d.projeto)}/${U.vista}`; return; }
  if (d.eqsel) { location.hash = `${d.eqsel}/${U.vista}`; return; }
  if (d.vista) return irPara(d.vista, d.vista === 'chat' ? U.canal : '');
  if (d.canal) { U.rascunhos[`${U.proj}/${U.canal}`] = $('#texto')?.value || ''; return irPara('chat', d.canal); }
  if (d.irCanal) { const [pr, ca] = d.irCanal.split('|'); fecharModal(); location.hash = `${pr}/chat/${ca}`; return; }
  if (d.issue) { ev.preventDefault(); if (U.inbox) fecharModal(); return abrirIssue(d.issue); }
  if (ev.target.closest('[data-ctx-rem]') && U.issue) { const k = ev.target.closest('[data-ctx-rem]').dataset.ctxRem; return patchCard({ contexto: (cartao(U.issue)?.contexto || []).filter((x) => x !== k) }); }
  if (d.nota) { if (U.vista === 'memoria') return abrirNota(d.nota); U.memSel = d.nota; return irPara('memoria'); }
  if (d.responder) {
    const pid = d.proj || U.proj;
    if (await responderPergunta(pid, d.responder, d.resp)) { if (U.inbox) modalInbox(); }
    return;
  }
  if (d.motor) { const r = await api('POST', '/api/config', { engine: d.motor }); E.config = { ...E.config, ...r }; fecharPops(); atualizarSeletores(); return renderLista(); }
  if (d.modo) { const r = await api('POST', '/api/config', { modo: d.modo }); E.config = { ...E.config, ...r }; fecharPops(); atualizarSeletores(); return renderLista(); }
  if (d.mencao) return inserirMencao(d.mencao);
  if (d.filtro) { U.filtro.has(d.filtro) ? U.filtro.delete(d.filtro) : U.filtro.add(d.filtro); return renderPlanner(); }
  if (d.visao) { U.visao = d.visao; return renderPlanner(); }
  if (d.aba) { U.abaAtiv = d.aba; return renderIssue(true); }
  if (d.aj) { U.ajuste = d.aj; return modalAjustes(); }
  if (d.usoMotor) { U.usoMotor = d.usoMotor; return renderMembros(); }
  if (d.copiar) { const m = (J().canais[U.canal] || []).find((x) => x.id === d.copiar); if (m) copiarTexto(limparBloco(m.texto)); return; }
  if (d.troca !== undefined) return irTroca(Number(d.troca));
  switch (d.acao) {
    case 'decisoes': return modalDecisoes();
    case 'editar-decisao': return editarDecisao(d.decisao);
    case 'aceitar-decisao': {
      const r = await api('POST', P(`/decisoes/${d.decisao}/aceitar`), { revisao: Number(d.revisao), opcao: d.opcao });
      if (r._ok) return modalDecisoes();
      return aviso(r.erro || I18N.t('Não foi possível registrar a escolha.'));
    }
    case 'salvar-decisao': {
      const anterior = U.decisaoEdit;
      const body = { id: anterior?.id || `decisao-${Date.now()}`, tipo: $('#dc-tipo').value, contexto: $('#dc-contexto').value, cards: $('#dc-cards').value.split(',').map(x=>x.trim()).filter(Boolean), opcoes: $$('[data-decisao-opcao]').map(el=>({ id: el.dataset.decisaoOpcao, texto: $('[data-dc-texto]',el).value, consequencia: $('[data-dc-consequencia]',el).value })), revisaoEsperada: anterior?.revisao, substituir: anterior?.status==='aceita' };
      const r = await api('POST', P('/decisoes'), body);
      if (r._ok) return modalDecisoes();
      return aviso(r.erro || I18N.t('Não foi possível salvar a proposta.'));
    }
    case 'regras-equipe': {
      const r = await api('GET', P('/regras-equipe'));
      return abrirModal(`<h2>Regras da equipe</h2><p>Aplicadas nas próximas chamadas. Suas instruções têm prioridade.</p>${(r.regras || []).map(x => `<div class="campo"><b>${esc(x.id)} · ${esc(x.escopo)} · ${x.ativa ? I18N.t('Ativa') : I18N.t('Revogada')}</b><p>${esc(x.texto)}</p><small>${I18N.t('{motivo} · Origem: {origem}', { motivo: esc(x.motivo), origem: esc(x.origem) })}</small>${x.ativa ? `<button class="btn-sec" data-acao="revogar-regra" data-regra="${esc(x.id)}">Revogar regra</button>` : ''}</div>`).join('') || '<p>A P.O. ainda não registrou regras.</p>'}<button class="btn-sec" data-acao="fechar">Fechar</button>`, 'perfil');
    }
    case 'revogar-regra': {
      const r = await api('GET', P('/regras-equipe'));
      const regra = r.regras?.find(x => x.id === d.regra);
      if (!regra) return;
      const result = await api('PUT', P('/regras-equipe'), { ...regra, ativa: false, motivo: 'Revogada pela pessoa responsável pelo projeto.', origem: 'Painel de regras' });
      if (result._ok) { fecharModal(); aviso(I18N.t('Regra revogada.')); } else aviso(result.erro);
      return;
    }
    case 'relatorio-creditos': {
      const r = await api('GET', '/api/uso');
      return abrirModal(`<h2>Consumo e otimização</h2><pre class="creditos-relatorio">${esc(r.relatorio || I18N.t('Sem dados disponíveis.'))}</pre><div class="acoes"><button class="btn-sec" data-acao="fechar">Fechar</button></div>`, 'perfil');
    }
    case 'enviar': return enviar();
    case 'motor-ativo': {
      const atual = J().motores?.[d.eng]?.ativo !== false;
      const r = await api('PUT', P('/motores'), { [d.eng]: { ativo: !atual } });
      if (r._ok) { J().motores = r; renderMembros(); } else aviso(r.erro || I18N.t('Não consegui mudar.'));
      return;
    }
    case 'motor-teto': {
      const r = await api('PUT', P('/motores'), { [d.eng]: { teto: d.teto } });
      if (r._ok) { J().motores = r; renderMembros(); } else aviso(r.erro || I18N.t('Não consegui mudar.'));
      return;
    }
    case 'novo-post': return modalNovoPost();
    case 'post-reagir': await api('POST', P(`/posts/${d.post}/reagir`), { emoji: d.emoji }); return;
    case 'post-mais': { (U.postsExp ||= new Set()); if (U.postsExp.has(d.post)) U.postsExp.delete(d.post); else U.postsExp.add(d.post); renderPostsSuave(); return; }
    case 'post-thread': {
      (U.postsAbertos ||= new Set());
      const pt = (J().posts || []).find((x) => x.id === d.post);
      if (U.postsAbertos.has(d.post)) U.postsAbertos.delete(d.post);
      else { U.postsAbertos.add(d.post); if (pt && !J().canais[pt.canal]) { const h = await (await fetch(P(`/canal/${pt.canal}`))).json().catch(() => []); J().canais[pt.canal] = Array.isArray(h) ? h : []; } }
      renderPostsSuave(); return;
    }
    case 'grupo-encerrar': { if (await perguntar(I18N.t('Encerrar este grupo? A conversa fica guardada, mas ninguém mais responde nele.'), I18N.t('Encerrar'))) await api('POST', P(`/grupos/${d.grupo}/encerrar`), {}); return; }
    case 'planning-cancelar': { if (await perguntar(I18N.t('Encerrar este planning? Nenhum card será criado.'), I18N.t('Encerrar'))) await api('POST', P(`/planning/${d.plan}/cancelar`), {}); return; }
    case 'validar-ok': { const r = await api('POST', P(`/cartao/${U.issue}/validar`), { ok: true }); aviso(r._ok ? I18N.t('Validação registrada.') : (r.erro || I18N.t('Não consegui registrar.'))); return; }
    case 'validar-nok': {
      const motivo = await perguntarTexto(I18N.t('O que não está certo?'), I18N.t('Conte o que você encontrou e o que esperava'), I18N.t('Reprovar'));
      if (!motivo) return;
      const r = await api('POST', P(`/cartao/${U.issue}/validar`), { ok: false, motivo });
      aviso(r._ok ? I18N.t('Voltou para o time com o seu relato.') : (r.erro || I18N.t('Não consegui registrar.')));
      return;
    }
    case 'parar-agente': await api('POST', P(`/agente/${d.ag}/parar`), {}); return aviso(I18N.t('Parando…'), 1500);
    case 'parar': await api('POST', P('/cancelar'), {}); return aviso(I18N.t('Parando…'), 1500);
    case 'ajustes': return modalAjustes();
    case 'proj-config': U.ajuste = 'projeto'; return modalAjustes();
    case 'inbox': return modalInbox();
    case 'assessor-auto': {
      const ligar = E.config.ciclo?.assessorAuto === false;
      const r = await api('POST', '/api/config', { ciclo: { assessorAuto: ligar } });
      if (r._ok) { E.config = { ...E.config, ...r }; renderMembros(); aviso(ligar ? I18N.t('Assessor por conta própria: ele age quando aparecer sinal novo.') : I18N.t('Assessor só faz o que você pedir.')); }
      return;
    }
    case 'iniciativas': return modalIniciativas();
    case 'desde': return modalDesde();
    case 'ini-decidir': { const r = await api('POST', P(`/iniciativas/${d.ini}/${d.dec}`), {}); if (!r._ok) aviso(r.erro || I18N.t('Não consegui.')); else modalIniciativas(); return; }
    case 'ronda-assessor': { t.disabled = true; const r = await api('POST', P('/ronda'), {}); aviso(r._ok ? (r.sinais === 1 ? I18N.t('Ronda iniciada: {n} sinal nas fontes.', { n: r.sinais }) : I18N.t('Ronda iniciada: {n} sinais nas fontes.', { n: r.sinais })) : (r.erro || r.motivo || I18N.t('Não consegui.'))); setTimeout(() => { t.disabled = false; }, 3000); return; }
    case 'piloto': {
      const ligar = !E.config.piloto.ativo;
      if (ligar && E.config.modo === 'trabalhar' && !(await perguntar(I18N.t('O piloto automático vai deixar o time EDITAR arquivos do projeto enquanto você estiver fora (modo Executar). Ligar mesmo assim?'), I18N.t('Ligar o piloto')))) return;
      const r = await api('POST', '/api/config', { piloto: { ativo: ligar } });
      if (r._ok) { E.config = { ...E.config, ...r }; aplicarPiloto(); renderMembros(); aviso(ligar ? I18N.t('Piloto automático ligado. Pode deixar o app aberto.') : I18N.t('Piloto automático desligado.')); }
      return;
    }
    case 'demandas': return modalDemandas();
    case 'sincronizar-integ': { const r = await api('POST', P('/integracoes/sincronizar'), {}); if (r._ok) { J().integ = r; modalDemandas(); } return; }
    case 'trazer-demanda': { const r = await api('POST', P('/jira/trazer'), { key: d.key }); aviso(r._ok ? I18N.t('{key} entrou no Backlog como {id}. Peça à P.O. para estimar e distribuir.', { key: d.key, id: r.card.id }) : (r.erro || I18N.t('Não consegui trazer.'))); if (r._ok) modalDemandas(); return; }
    case 'discutir-demanda': {
      const it = (J().integ?.cache?.jira?.itens || []).find((x) => x.key === d.key);
      const lead = agente(liderAtual());
      fecharModal();
      await api('POST', P('/mensagem'), { canal: 'dm:po', texto: `@${primeiroNome(lead.nome)} vamos conversar sobre a demanda ${d.key}${it ? `: ${it.resumo}` : ''}. Quero alinhar o escopo com você antes de passar para o time.`, engine: E.config.engine, modo: E.config.modo });
      irPara('chat', 'dm:po');
      return;
    }
    case 'testar-integ': {
      const alvo = d.alvo; const saida = $(`#ig-${alvo}-teste`);
      saida.innerHTML = '<div class="teste espera">Testando…</div>';
      const corpo = alvo === 'jira'
        ? { alvo, jira: { url: $('#ig-jira-url').value, tipo: $('#ig-jira-tipo').value, usuario: $('#ig-jira-usuario').value, jql: $('#ig-jira-jql').value, token: $('#ig-jira-token').value } }
        : { alvo, agenda: { fonte: $('#ig-agenda-fonte').value } };
      const r = await api('POST', P('/integracoes/testar'), corpo);
      saida.innerHTML = r.ok ? `<div class="teste ok">${alvo === 'jira' ? I18N.t('Funcionou. {n} demandas na consulta.', { n: r.total }) : I18N.t('Funcionou. {n} eventos no calendário.', { n: r.total })}${(r.amostra || []).length ? `<br>${r.amostra.map(esc).join('<br>')}` : ''}</div>` : `<div class="teste falha">${esc(r.erro || I18N.t('Falhou.'))}</div>`;
      return;
    }
    case 'anexar': return campoAnexo().click();
    case 'responder-msg': return responderMsg(d.msg);
    case 'cancelar-resposta': delete U.resposta?.[`${U.proj}/${U.canal}`]; return $('.respondendo')?.remove();
    case 'encaminhar-msg': return encaminharMsg(d.msg);
    case 'encaminhar-para': return encaminharPara(d.cid, d.para);
    case 'perfil': return modalPerfil(d.ag);
    case 'salvar-nome': {
      const r = await api('PUT', P(`/agente/${d.ag}/perfil`), { nome: $('#pf-nome').value });
      if (!r._ok) { $('#pf-dica').className = 'dica-v erro'; $('#pf-dica').textContent = r.erro || I18N.t('Não salvou.'); return; }
      $('#pf-dica').className = 'dica-v ok'; $('#pf-dica').textContent = I18N.t('Pronto. Agora é @{nome}.', { nome: primeiroNome($('#pf-nome').value) });
      return;
    }
    case 'tirar-foto': { const r = await api('DELETE', P(`/agente/${d.ag}/foto`)); if (r._ok) setTimeout(() => modalPerfil(d.ag, { manter: true }), 150); return; }
    case 'tirar-capa': { const r = await api('DELETE', P(`/agente/${d.ag}/capa`)); if (r._ok) setTimeout(() => modalPerfil(d.ag, { manter: true }), 150); return; }
    case 'ajustar-img': return abrirRecorte(d.ag, d.tipo, null);
    case 'pcard-dm': fecharCartao(); return irPara('chat', `dm:${d.ag}`);
    case 'ped-aba': { U.ped.pa = d.pa; $$('.ped-abas button').forEach((b) => b.classList.toggle('on', b.dataset.pa === d.pa)); for (const a of ['perfil', 'conversa', 'trabalho']) { const el = $(`#ped-${a}`); if (el) el.hidden = d.pa !== a; } return; }
    case 'conv-salvar': {
      const v = (n) => { const x = $(`[name=${n}]:checked`)?.value; return x === 'sim' ? true : x === 'nao' ? false : null; };
      const r = await api('PUT', P(`/agente/${d.ag}/conversa`), { personalidade: $('#cv-pers').value, emojis: v('cv-emojis'), gifs: v('cv-gifs'), zoeira: v('cv-zoeira') });
      if (!r._ok) return aviso(r.erro || I18N.t('Não salvou.'));
      return aviso(I18N.t('Jeito de conversar salvo. Vale a partir da próxima mensagem.'));
    }
    case 'conv-persona': case 'conv-sortear': {
      const l = window.PERSONAS || []; const p = d.persona ? l.find((x) => x.id === d.persona) : l[Math.floor(Math.random() * l.length)];
      if (!p) return;
      const atual = $('#cv-pers').value.trim();
      if (atual && !l.some((x) => x.texto === atual) && !(await perguntar(I18N.t('O campo tem uma personalidade que você escreveu. Trocar pelo temperamento? A que está lá fica guardada em "Versões anteriores" assim que você salvar.'), I18N.t('Trocar')))) return;
      $('#cv-pers').value = p.texto;
      const z = $('[name=cv-zoeira][value=sim]'); if (z) z.checked = true;
      $$('.persona-chip').forEach((b) => b.classList.toggle('on', b.dataset.persona === p.id));
      return aviso(I18N.t('{nome}: clique em Salvar para valer. Os colegas já podem ser zoados.', { nome: p.nome }));
    }
    case 'conv-versao': { const h = (agente(U.ped.id)?.conversa?.historico || [])[Number(d.i)]; if (h) { $('#cv-pers').value = h.texto; aviso(I18N.t('Versão anterior no campo. Clique em Salvar para voltar a ela.')); } return; }
    case 'sortear-time': {
      if (!(await perguntar(I18N.t('Sortear um temperamento para cada agente que ainda não escreveu a própria personalidade? Quem já tem personalidade fica como está.'), I18N.t('Sortear')))) return;
      const l = [...(window.PERSONAS || [])].sort(() => Math.random() - 0.5); let n = 0;
      for (const a of rosterAtual().filter((x) => !x.sistema && x.id !== 'creditos' && x.id !== 'mcp' && !x.conversa?.personalidade)) {
        const p = l[n % l.length]; n++;
        await api('PUT', P(`/agente/${a.id}/conversa`), { personalidade: `${a.nome}: ${p.texto}`, zoeira: true });
      }
      return aviso(n ? I18N.t('{n} agentes com personalidade nova. Eles já podem se zoar.', { n }) : I18N.t('Todos já têm personalidade própria.'));
    }
    case 'conv-padrao': { const el = $('#cv-pers'); if (el) el.value = el.dataset.padrao || ''; return; }
    case 'ped-opc': return pedEscolher(d.campo, d.valor);
    case 'ped-tema': { U.ped.estilo.tema = d.c1 ? { c1: d.c1, c2: d.c2 } : undefined; if (d.c1) { $('#ped-t1').value = d.c1; $('#ped-t2').value = d.c2; } return pedPrev(); }
    case 'ped-surpresa': {
      const sorteia = (l) => l[Math.floor(Math.random() * l.length)][0]; const cor = () => `#${Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, '0')}`;
      U.ped.estilo.nome = { fonte: sorteia(OPC.fonte.slice(1)), efeito: sorteia(OPC.efeitoNome.slice(1)), c1: cor(), c2: cor() };
      return pedRedesenhar();
    }
    case 'ped-salvar': return pedSalvar();
    case 'ped-voz-ouvir': return pedOuvirVoz(d.ag);
    case 'mcp-adicionar': {
      const tipo = $('#mcp-tipo').value, alvo = $('#mcp-alvo').value.trim(), extra = $('#mcp-extra').value.trim();
      const [comando, ...args] = alvo.split(/\s+/);
      const r = await api('POST', '/api/mcp', tipo === 'stdio' ? { nome: $('#mcp-nome').value, tipo, comando, args: args.join(' '), env: extra } : { nome: $('#mcp-nome').value, tipo, url: alvo, headers: extra });
      if (!r._ok) return aviso(r.erro || I18N.t('Não adicionou.')); return modalAjustes();
    }
    case 'mcp-remover': { const r = await api('DELETE', `/api/mcp/${encodeURIComponent(d.mcp)}`); if (!r._ok) return aviso(r.erro || I18N.t('Não removeu.')); return modalAjustes(); }
    case 'cx-conectar': {
      const r = await api('POST', `/api/conexoes/${d.app}/conectar`);
      if (!r._ok) { await modalAjustes(); if (r.precisaConfig) { const det = $('.cx-app'); if (det) det.open = true; } return aviso(r.erro || I18N.t('Não abriu a conexão.'), 9000); }
      if (r.url) window.open(r.url, '_blank');
      await modalAjustes(); return acompanharConexoes();
    }
    case 'cx-app-salvar': {
      await api('POST', '/api/conexoes/trello/configurar', { key: $('#app-trello').value });
      await api('POST', '/api/conexoes/teams/configurar', { clientId: $('#app-teams').value, tenant: $('#app-tenant').value });
      await api('POST', '/api/conexoes/github/configurar', { clientId: $('#app-github').value });
      if ($('#app-gif').value.trim() || $('#app-gif-prov').value) await api('PUT', '/api/gifs', { provedor: $('#app-gif-prov').value, chave: $('#app-gif').value.trim() || undefined });
      aviso(I18N.t('Configuração da TI salva.')); return modalAjustes();
    }
    case 'cx-verificar': { aviso(I18N.t('Testando a conexão…'), 1500); const r = await api('POST', `/api/conexoes/${d.app}/verificar`, {}); const st = r.status || {}; aviso(st.conectado ? I18N.t('{app} respondendo: {detalhe}', { app: CX_NOME[d.app], detalhe: st.detalhe || 'ok' }) : `${CX_NOME[d.app]}: ${st.detalhe || I18N.t('não respondeu')}`, 7000); return modalAjustes(); }
    case 'cx-cancelar': await api('POST', `/api/conexoes/${d.app}/cancelar`); return modalAjustes();
    case 'cx-github-token': {
      const token = $('#ig-github-token').value.trim(); if (!token) return aviso(I18N.t('Cole o token primeiro.'));
      aviso(I18N.t('Conferindo o token com o GitHub…'), 2000);
      const r = await api('POST', '/api/conexoes/github/configurar', { token });
      if (!r._ok) return aviso(r.erro || I18N.t('O GitHub não aceitou o token.'), 8000);
      const st = r.status?.github || {}; aviso(st.conectado ? I18N.t('GitHub conectado como {conta}.', { conta: st.conta || I18N.t('você') }) : `GitHub: ${st.detalhe || I18N.t('não respondeu')}`, 7000); return modalAjustes();
    }
    case 'cx-desconectar': { if (!(await perguntar(I18N.t('Desconectar o {app} deste computador? A liderança deixa de usar essa conta como contexto.', { app: CX_NOME[d.app] }), I18N.t('Desconectar')))) return; await api('POST', `/api/conexoes/${d.app}/desconectar`); return modalAjustes(); }
    case 'conta-conectar': { const r = await api('POST', `/api/contas/${d.eng}/conectar`); if (!r._ok) return aviso(r.erro || I18N.t('Não abriu o login.')); await modalAjustes(); return acompanharContas(); }
    case 'conta-cancelar': await api('POST', `/api/contas/${d.eng}/cancelar`); return modalAjustes();
    case 'conta-desconectar': { if (!(await perguntar(I18N.t('Desconectar a conta do {motor} deste computador? Os agentes param de usar esse modelo até você conectar de novo.', { motor: d.eng === 'claude' ? 'Claude' : 'Codex' }), I18N.t('Desconectar')))) return; const r = await api('POST', `/api/contas/${d.eng}/desconectar`); if (!r._ok) aviso(r.erro || I18N.t('Não desconectou.')); return modalAjustes(); }
    case 'conta-verificar': await fetch('/api/contas?forcar=1'); return modalAjustes();
    case 'sel-abrir': return abrirSeletor(d.sel, ev.target.closest('[data-sel]'));
    case 'emoji': return abrirEmoji(ev.target.closest('[data-acao=emoji]'));
    case 'ver-arquivadas': U.verArq = !U.verArq; return renderLista();
    case 'ctx-arquivar': { fecharCtx(); const r = await api('POST', P('/conversa/arquivar'), { canal: d.cv, arquivar: d.arq !== '0' }); if (!r._ok) aviso(r.erro || I18N.t('Não arquivou.')); else if (d.arq !== '0' && U.canal === d.cv) irPara('chat', 'equipe'); return; }
    case 'ctx-limpar': fecharCtx(); if (await perguntar(I18N.t('Limpar o histórico de {canal}? As mensagens somem para todos.', { canal: nomeCanal(d.cv) }), I18N.t('Limpar'))) await api('POST', P('/limpar'), { canal: d.cv }); return;
    case 'ctx-excluir': { fecharCtx(); if (!(await perguntar(I18N.t('Excluir {canal}? A conversa e o histórico somem de vez.', { canal: nomeCanal(d.cv) }), I18N.t('Excluir')))) return; const r = await api('POST', P('/conversa/excluir'), { canal: d.cv }); if (!r._ok) aviso(r.erro || I18N.t('Não excluiu.')); return; }
    case 'ctx-membros': fecharCtx(); return modalMembros(d.cv);
    case 'membros-ok': { const ids = $$('#modal [data-mb]:checked').map((x) => x.dataset.mb); const r = await api('POST', P('/conversa/membros'), { canal: d.cv, membros: ids }); if (!r._ok) return aviso(r.erro || I18N.t('Não adicionou.')); fecharModal(); return irPara('chat', r.canal); }
    case 'recorte-cancelar': return $('#recorte')?.remove();
    case 'recorte-aplicar': return aplicarRecorte();
    case 'salvar-vigia': { const r = await api('PUT', P('/vigia'), { ativo: $('#vg-ativo').checked, buscarRemoto: $('#vg-remoto').checked, intervaloMin: Number($('#vg-int').value), repos: $('#vg-repos').value.split('\n').map((x) => x.trim()).filter(Boolean) }); aviso(r._ok ? I18N.t('Vigia salvo.') : (r.erro || I18N.t('Não salvou.'))); return; }
    case 'vigia-agora': { aviso(I18N.t('Olhando os repositórios…'), 2000); const r = await api('POST', P('/vigia/agora'), {}); aviso(!r._ok ? I18N.t('Não consegui olhar.') : r.primeira ? I18N.t('Base registrada. Aviso quando mudar.') : r.mudou ? I18N.t('Houve mudanças, veja no #equipe.') : (r.motivo || I18N.t('Nada mudou.'))); return; }
    case 'faxina': { t.disabled = true; const r = await api('POST', P('/faxina'), {}); aviso(r._ok ? (r.removidos.length ? (r.removidos.length === 1 ? I18N.t('Faxina feita: {n} item, {tam} liberados.', { n: r.removidos.length, tam: r.liberadoTexto }) : I18N.t('Faxina feita: {n} itens, {tam} liberados.', { n: r.removidos.length, tam: r.liberadoTexto })) : I18N.t('Nada para tirar agora.')) : (r.erro || I18N.t('Não consegui fazer a faxina.'))); carregarArquivos(); return; }
    case 'salvar-extras': { const r = await api('PUT', P('/extras'), { lista: $('#ex-texto').value.split('\n').map((x) => x.trim()).filter(Boolean) }); if (r._ok) { await recarregarApp(); aviso(I18N.t('Pastas extras salvas.')); } else aviso(r.erro || I18N.t('Não salvou.')); return; }
    case 'relatorio': { fecharModal(); const r = await api('POST', P('/relatorio'), {}); if (!r._ok) aviso(I18N.t('Não consegui montar o relatório.')); else irPara('chat', 'equipe'); return; }
    case 'teamwork': {
      const r=await fetch(P('/teamwork')).then(x=>x.json()).catch(()=>null);
      if(!r)return aviso(I18N.t('Não consegui consultar as execuções.'));
      J().teamwork=r;
      const labels={draft:'Em preparação',ready:'Pronta',queued:'Na fila',running:'Executando',submitted:'Entregue, aguardando validação',verifying:'Em validação',accepted:'Aceita',integrated:'Integrada',completed:'Concluída',failed:'Falhou',blocked:'Bloqueada',cancelled:'Cancelada',waiting_dependency:'Aguardando dependência',waiting_approval:'Aguardando aprovação',waiting_clarification:'Aguardando informação'};
      abrirModal(`<h2>Execuções e entregas</h2><p class="mudo">${I18N.t('{v} entregas validadas de {n} tarefas. Uma resposta entregue ainda precisa passar pelas verificações aplicáveis.', { v: r.metrics.validatedDeliveries, n: r.metrics.tasks })}</p><div class="teamwork-list">${r.tasks.slice().reverse().map(t=>`<article class="teamwork-task"><strong>${esc(t.objective.slice(0,180))}</strong><p>${esc(nomeAgente(t.assigneeAgentId))} · ${esc(I18N.t(t.gates.review?.outcome==='failed'?'Entrega reprovada':labels[t.status]||t.status))}</p>${t.failure?`<p>${esc(t.failure.class)}: ${esc(t.failure.repair||'')}</p>`:''}${(t.result?.artifacts||[]).map(id=>`<a href="${P('/teamwork/artifacts/'+encodeURIComponent(id))}" download>Baixar entrega</a>`).join(' ')}${['submitted','verifying'].includes(t.status)?`<p><button class="btn-sec" data-acao="teamwork-review" data-task="${esc(t.taskId)}">Registrar parecer</button></p>`:''}</article>`).join('')||'<p>Ainda não há tarefas registradas.</p>'}</div><div class="acoes"><button class="btn-sec" data-acao="fechar">Fechar</button></div>`,'perfil');
      return;
    }
    case 'teamwork-review': {
      const task=J().teamwork?.tasks.find(x=>x.taskId===d.task);if(!task)return aviso(I18N.t('Atualize a lista de execuções.'));
      abrirModal(`<h2>Revisar entrega</h2><p>${esc(task.objective)}</p><p>Confira os arquivos e os critérios antes de registrar o parecer. Gates técnicos e de integração continuam obrigatórios.</p>${(task.result?.artifacts||[]).map(id=>`<a href="${P('/teamwork/artifacts/'+encodeURIComponent(id))}" download>Baixar entrega</a>`).join(' ')}<label class="rot" for="tw-review-reason">Evidências e motivo do parecer</label><textarea id="tw-review-reason" class="in" rows="4"></textarea><div class="acoes"><button class="btn-sec" data-acao="fechar">Cancelar</button><button class="btn-sec" data-acao="teamwork-verdict" data-task="${esc(task.taskId)}" data-version="${task.version}" data-approved="false">Reprovar entrega</button><button class="btn-primario" data-acao="teamwork-verdict" data-task="${esc(task.taskId)}" data-version="${task.version}" data-approved="true">Aprovar entrega</button></div>`,'perfil');return;
    }
    case 'teamwork-verdict': {
      const reason=$('#tw-review-reason').value.trim();if(!reason)return aviso(I18N.t('Registre as evidências e o motivo.'));
      const r=await api('POST',P(`/teamwork/tasks/${encodeURIComponent(d.task)}/review`),{expectedVersion:Number(d.version),approved:d.approved==='true',reason});
      if(!r._ok)return aviso(r.erro||I18N.t('O parecer não foi registrado.'));
      fecharModal();$('[data-acao="teamwork"]')?.click();return;
    }
    case 'metricas': {
      const m = await (await fetch(P('/metricas?dias=30'))).json().catch(() => null);
      if (!m) { aviso(I18N.t('Não consegui calcular as métricas.')); return; }
      const linha = (k, v, sub = '') => `<div class="met"><span class="k">${k}</span><b>${v}</b>${sub ? `<small>${sub}</small>` : ''}</div>`;
      abrirModal(`<h2>${I18N.t('Métricas dos últimos {n} dias', { n: m.dias })}</h2><p class="mudo">Calculadas pelo app a partir do quadro, das chamadas e da ficha de fatos. Nenhum modelo envolvido.</p>
        <div class="met-grade">
          ${linha('Cards concluídos', m.cardsConcluidos)}
          ${linha('Chamadas de modelo', m.chamadas, I18N.t('custo normalizado {v}', { v: m.custoTotal }))}
          ${linha('Lead time', `${m.leadTimeHoras.mediana} h`, I18N.t('p90 {p90} h; parado {parado} h', { p90: m.leadTimeHoras.p90, parado: m.tempoParadoHoras.mediana }))}
          ${linha('Por ponto entregue', m.custoPorPonto ?? '-', I18N.t('{n} chamadas por ponto', { n: m.chamadasPorPonto ?? '-' }))}
          ${linha('Retrabalho', `${m.retrabalho.taxa}%`, I18N.t('média {n} por card', { n: m.retrabalho.media }))}
          ${linha('Evidência falsa', `${m.evidenciaFalsa.taxa}%`, I18N.t('{recusados} relatos recusados, {medidos} fatos medidos', { recusados: m.evidenciaFalsa.recusados, medidos: m.evidenciaFalsa.medidos }))}
          ${linha('Decisões revertidas', `${m.decisoes.taxa}%`, I18N.t('{revertidas} de {total} tomadas no seu lugar', { revertidas: m.decisoes.revertidas, total: m.decisoes.porOutros }))}
        </div>
        ${m.porAgente.length ? `<h4 style="margin-top:14px">Chamadas por agente</h4>${m.porAgente.map((a) => `<div class="met-ag">${av(a.agente, 'p', { dot: false })}<span>${esc(nomeAgente(a.agente))}</span><i style="width:${a.pct}%"></i><b>${a.chamadas} (${a.pct}%)</b></div>`).join('')}` : ''}
        <div class="acoes"><button class="btn-sec" data-acao="fechar">Fechar</button></div>`, 'perfil');
      return;
    }
    case 'ler-tudo': await marcarLidas('todas'); return modalCentral();
    case 'pedir-status': { const r = await api('POST', P(`/cartao/${U.issue}/pedir-status`), {}); aviso(r._ok ? I18N.t('{quem} vai responder no card.', { quem: (r.chamados || []).map(nomeAgente).join(' e ') || I18N.t('O time') }) : (r.erro || I18N.t('Não consegui perguntar.'))); return; }
    case 'regra-add': return adicionarRegra(d.escopo);
    case 'regra-del': {
      const atual = (await (await fetch(P(`${rotaEscopo(d.escopo)}/regras`))).json().catch(() => ({}))).itens || [];
      const r = await api('PUT', P(`${rotaEscopo(d.escopo)}/regras`), { itens: atual.filter((_, i) => i !== Number(d.i)) });
      if (!r._ok) return aviso(r.erro || I18N.t('Não removeu.')); return redesenharRegras(d.escopo);
    }
    case 'ref-del': { const r = await api('DELETE', P(`${rotaEscopo(d.escopo)}/referencias/${encodeURIComponent(d.arquivo)}`)); if (!r._ok) return aviso(r.erro || I18N.t('Não tirou o documento.')); return redesenharRegras(d.escopo); }
    case 'add-contexto': { const t = $('#cx-texto').value.trim(); if (!t) return; const r = await api('POST', P(`/agente/${d.escopo}/contexto`), { texto: t }); if (r._ok) { $('#cx-texto').value = ''; aviso(I18N.t('Contexto anotado na memória do agente.')); } else aviso(r.erro || I18N.t('Não salvou.')); return; }
    case 'nota-agente': fecharModal(); U.memSel = `agentes/${d.ag}/contexto.md`; return irPara('memoria');
    case 'novo-projeto': return modalNovoProjeto();
    case 'abrir-avaliacao': { const e = equipeAvaliacao(); if (e) { location.hash = `${e.cid}/registro`; return; } return modalNovoProjeto({ template: 'avaliacao-agentes', nome: 'Avaliação de agentes' }); }
    case 'nova-equipe': return modalNovaEquipe();
    case 'eq-renomear': { const n = await perguntarTexto(I18N.t('Novo nome da equipe'), d.nome || '', I18N.t('Renomear')); if (!n) return; const r = await api('PUT', P(`/equipes/${d.eq}`), { nome: n }); if (!r._ok) return aviso(r.erro || I18N.t('Não renomeou.')); await recarregarApp(); return modalAjustes(); }
    case 'eq-tirar': { if (!(await perguntar(I18N.t('Tirar a equipe {nome} do projeto? As conversas, o planner e a memória dela continuam guardados na pasta do projeto; adicionar de novo com o mesmo nome traz tudo de volta.', { nome: d.nome }), I18N.t('Tirar equipe')))) return; const r = await api('DELETE', P(`/equipes/${d.eq}`)); if (!r._ok) return aviso(r.erro || I18N.t('Não tirou.')); if (U.proj.endsWith(`__${d.eq}`)) U.proj = baseDe(U.proj); await recarregarApp(); fecharModal(); location.hash = `${U.proj}/chat/equipe`; return rotear(); }
    case 'criar': return modalCriar(d.col || 'backlog');
    case 'fechar': return fecharModal();
    case 'membros': U.membros = !U.membros; $('#app').classList.toggle('sem-membros', !U.membros); return $('#centro .cabeca [data-acao=membros]')?.classList.toggle('on', U.membros);
    case 'todos-concluidos': U.todosConcluidos = true; return renderConteudoPlanner();
    case 'so-bloq': U.soBloq = !U.soBloq; return renderPlanner();
    case 'limpar-filtros': U.filtro.clear(); U.soBloq = false; U.busca = ''; return renderPlanner();
    case 'limpar': if (await perguntar(I18N.t('Limpar a conversa de {canal}?', { canal: nomeCanal(U.canal) }), I18N.t('Limpar'))) await api('POST', P('/limpar'), { canal: U.canal }); return;
    case 'delegar-pergunta': { const pid = d.proj || U.proj; const r = await api('POST', P(`/perguntas/${d.q}/delegar`, pid), {}); if (!r._ok) return aviso(r.erro || I18N.t('Não consegui repassar.')); E.perguntas = E.perguntas.filter((x) => !(x.id === d.q && x.projeto === pid)); renderRail(); if (U.inbox) modalInbox(); return; }
    case 'responder-livre': { if (d.q) (U.respPergunta ||= {})[`${U.proj}/${U.canal}`] = d.q; const ta = $('#texto'); if (ta) { ta.value = `@${MENCOES[d.de] || MENCOES[liderAtual()] || 'po'} `; ta.focus(); autoAltura(ta); } return; }
    case 'ronda': await api('POST', P('/ronda'), { engine: E.config.engine, modo: E.config.modo }); return aviso(I18N.t('O P.O. vai dar uma olhada no quadro.'));
    case 'briefing': { const r = await api('POST', P('/briefing'), { engine: E.config.engine, modo: E.config.modo }); return aviso(r._ok ? I18N.t('A assessoria está fazendo a leitura do dia; a proposta chega na DM dela.') : (r.erro || I18N.t('Não consegui pedir a leitura do dia.'))); }
    case 'curar': await api('POST', P('/curar'), { engine: E.config.engine, modo: E.config.modo }); return aviso(I18N.t('O Curador vai organizar a memória. Acompanhe no #equipe.'));
    case 'conhecer': fecharModal(); await api('POST', P('/conhecer'), { engine: E.config.engine, modo: E.config.modo }); irPara('chat', 'equipe'); return aviso(I18N.t('O P.O. vai conhecer o projeto.'));
    case 'renomear-proj': { const n = $('#p-nome').value.trim(); if (n && (await api('POST', P('/renomear'), { nome: n }))._ok) { await recarregarApp(); renderTudo(); aviso(I18N.t('Renomeado.')); } return; }
    case 'remover-proj': {
      const p = projetoAtual();
      if (p && await perguntar(I18N.t('Remover "{nome}" do app? A pasta alvo e a pasta de registros (memória, quadro e conversas) continuam no disco. Se você adicionar a mesma pasta alvo de novo, o histórico volta.', { nome: p.nome }), I18N.t('Remover'))) {
        await api('POST', P('/remover'), {}); delete PJ[p.id]; U.proj = null; fecharModal(); await recarregarApp(); location.hash = '';
        return rotear();
      }
      return;
    }
    case 'salvar-projeto': return salvarProjeto();
    case 'chamar': return CH.aberta ? fecharChamada() : abrirChamada();
    case 'chamada-mudo': {
      CH.mudo = !CH.mudo; if (CH.mudo && CH.falando) { CH.buf = []; CH.amostras = 0; CH.falando = false; CH.voz = 0; }
      chBotoes(); chTileFala('voce', false); return;
    }
    case 'chamada-tela': return compartilharTela();
    case 'chamada-layout':   // compacto (faixa fina, o chat inteiro embaixo) e volta
    case 'chamada-chat': {   // mostra ou esconde o chat embaixo da chamada
      if (d.acao === 'chamada-chat') CH.layout = CH.layout === 'cheio' ? 'dividido' : 'cheio';
      else CH.layout = CH.layout === 'compacto' ? 'dividido' : 'compacto';
      chLayout();
      return;
    }
    case 'chamada-texto': { CH.lado = !CH.lado; const l = $('#ch-lado'); if (l) l.hidden = !CH.lado; $('[data-acao="chamada-texto"]')?.classList.toggle('on', CH.lado); if (CH.lado) { const tr = $('#ch-transcricao'); if (tr) tr.scrollTop = tr.scrollHeight; } return; }
    case 'ch-fonte': { CH.escolhaFonte?.(d.fonte); return; }
    case 'ch-fonte-cancelar': { CH.escolhaFonte?.(null); return; }
    case 'disp-testar-som': return testarSom();
    case 'ag-hoje': AG.semana = inicioSemana(new Date()); return renderAgenda();
    case 'ag-ant': AG.semana = new Date(AG.semana.getTime() - 7 * DIA_MS); return renderAgenda();
    case 'ag-prox': AG.semana = new Date(AG.semana.getTime() + 7 * DIA_MS); return renderAgenda();
    case 'ag-novo': return modalEvento(null);
    case 'ag-ver': { const ev = AG.eventos.find((x) => x.id === d.ev); return ev ? modalEvento(ev) : null; }
    case 'ag-salvar': return salvarEvento(d.ev || null);
    case 'ag-cancelar-ev': { const r = await api('PUT', P(`/agenda/${d.ev}`), { cancelado: true }); if (!r._ok) return aviso(r.erro || I18N.t('Não cancelou.')); fecharModal(); aviso(I18N.t('Evento cancelado.')); return carregarAgenda(); }
    case 'ag-excluir': { if (!(await perguntar(I18N.t('Excluir este evento da agenda?'), I18N.t('Excluir')))) return; const r = await api('DELETE', P(`/agenda/${d.ev}`)); if (!r._ok) return aviso(r.erro || I18N.t('Não excluiu.')); fecharModal(); return carregarAgenda(); }
    case 'voz-previa': return ouvirPrevia();
    case 'chamada-encerrar': return fecharChamada();
    case 'ponto-restaurar': return restaurarPonto(d.ponto);
    case 'ponto-excluir': {
      if (!(await perguntar(I18N.t('Excluir este ponto de salvamento?'), I18N.t('Excluir')))) return;
      const r = await api('DELETE', P(`/pontos/${d.ponto}`));
      if (!r._ok) return aviso(r.erro || I18N.t('Não consegui excluir.'));
      return carregarPontos();
    }
    case 'abrir-pasta': return window.studioApp?.abrirPasta(d.caminho || projetoAtual()?.raiz);
    case 'abrir-memoria': return window.studioApp?.abrirPasta(`${projetoAtual()?.pastaProjeto}\\memoria`);
    case 'abrir-pasta-projeto': return window.studioApp?.abrirPasta(projetoAtual()?.raiz);
    case 'bloquear': { const motivo = await perguntarTexto(I18N.t('Motivo do bloqueio'), I18N.t('O que está impedindo'), I18N.t('Bloquear')); const id = U.issue; if (motivo) await api('POST', P(`/cartao/${id}/bloquear`), { motivo }); return abrirIssue(id); }
    case 'desbloquear': await api('POST', P(`/cartao/${U.issue}/desbloquear`), {}); return;
    case 'arquivar': { const id = U.issue; if (await perguntar(I18N.t('Remover {id}? O histórico fica guardado na pasta do projeto.', { id }), I18N.t('Remover'))) { fecharModal(); await api('POST', P(`/cartao/${id}/arquivar`), {}); } else abrirIssue(id); return; }
    default:
  }
});

document.addEventListener('change', async (ev) => {
  const t = ev.target;
  if (t.matches('[data-validacoes]')) return patchCard({ validacoesObrigatorias: t.value.split('\n').map(x=>x.trim()).filter(Boolean) });
  if (t.matches('[data-dependencias]')) return patchCard({ dependeDe: t.value.split(',').map(x=>x.trim()).filter(Boolean) });
  if (t.id === 'anexo-input' && t.files.length) { const fs = [...t.files]; t.value = ''; return anexarArquivos(fs); }
  if (t.matches('[data-mcp-ativo]')) { const r = await api('PUT', `/api/mcp/${encodeURIComponent(t.dataset.mcpAtivo)}`, { ativo: t.checked }); if (!r._ok) aviso(r.erro || I18N.t('Não salvou.')); t.closest('.mcp-i')?.classList.toggle('on', t.checked); return; }
  if (t.matches('[data-mcp-desc]')) { await api('PUT', `/api/mcp/${encodeURIComponent(t.dataset.mcpDesc)}`, { descricao: t.value }); return; }
  if ((t.matches('[data-importar-regras]') || t.matches('[data-importar-ref]')) && t.files.length) {
    const regras = t.matches('[data-importar-regras]'); const escopo = t.dataset.importarRegras || t.dataset.importarRef;
    const arquivos = [...t.files]; t.value = '';
    let novas = 0, repetidas = 0; const falhas = [];
    for (const f of arquivos) {
      if (f.size > 1_000_000) { falhas.push(`${f.name}: ${I18N.t('grande demais')}`); continue; }
      const texto = await f.text();
      const r = regras ? await api('POST', P(`${rotaEscopo(escopo)}/regras/importar`), { texto }) : await api('POST', P(`${rotaEscopo(escopo)}/referencias`), { nome: f.name, texto });
      if (!r._ok) { falhas.push(`${f.name}: ${r.erro || I18N.t('não importou')}`); continue; }
      if (regras) { novas += r.adicionadas.length; repetidas += r.repetidas; }
    }
    await redesenharRegras(escopo);
    if (regras) aviso(`${novas === 1 ? I18N.t('{n} regra nova', { n: novas }) : I18N.t('{n} regras novas', { n: novas })}${repetidas ? `, ${I18N.t('{n} já existiam', { n: repetidas })}` : ''}.${falhas.length ? ' ' + falhas.join('; ') : ''}`);
    else aviso(falhas.length ? falhas.join('; ') : (arquivos.length === 1 ? I18N.t('Documento importado. Vale a partir da próxima chamada.') : I18N.t('{n} documentos importados. Vale a partir da próxima chamada.', { n: arquivos.length })));
    return;
  }
  if (t.matches('[data-recorte]') && t.files[0]) { const f = t.files[0]; t.value = ''; return abrirRecorte(U.ped.id, t.dataset.recorte, f); }
  if (t.matches('#pf-foto') && t.files[0]) {
    try {
      const dataUrl = await prepararFoto(t.files[0]);
      const r = await api('POST', P(`/agente/${t.dataset.ag}/foto`), { dataUrl });
      if (r._ok) modalPerfil(t.dataset.ag); else aviso(r.erro || I18N.t('Não salvou a foto.'));
    } catch (e) { aviso(e.message); }
    return;
  }
  if (t.matches('[data-part-papel]')) { const c = cartao(U.issue); return patchCard({ participantes: c.participantes.map((p) => (p.agente === t.dataset.partPapel ? { ...p, papel: t.value } : p)) }); }
  if (t.matches('[data-part-add]') && t.value) { const c = cartao(U.issue); return patchCard({ participantes: [...c.participantes, { agente: t.value, papel: 'monitora' }] }); }
  if (t.matches('[data-aceite]')) { const c = cartao(U.issue); return patchCard({ aceite: c.aceite.map((a, i) => ({ t: a.t, ok: i === Number(t.dataset.aceite) ? t.checked : a.ok })) }); }
  if (t.matches('[data-mover]')) return moverCard(U.issue, t.value);
  if (t.matches('[data-campo]')) return patchCard({ [t.dataset.campo]: t.dataset.campo === 'dono' ? (t.value || null) : t.value });
});

/* ---- menu da conversa (botão direito na lista lateral) ---- */
function fecharCtx() { $('#ctx-menu')?.remove(); }
document.addEventListener('contextmenu', (ev) => {
  const it = ev.target.closest('#lista .canal[data-canal]');
  if (!it) return fecharCtx();
  const c = it.dataset.canal;
  if (c === 'posts' || c === 'bastidores') return;
  ev.preventDefault(); fecharCtx();
  const arq = (J().arquivadas || []).includes(c);
  const op = (acao, rot, icone, perigo = false, extra = '') => `<button data-acao="${acao}" data-cv="${esc(c)}" ${extra} class="${perigo ? 'perigo' : ''}">${ic(icone)}<span>${rot}</span></button>`;
  const itens = [
    (c.startsWith('dm:') || c.startsWith('grp-')) && op('ctx-membros', 'Adicionar membros', 'usuarios'),
    c !== 'equipe' && op('ctx-arquivar', arq ? 'Desarquivar' : 'Arquivar', 'arquivo', false, `data-arq="${arq ? 0 : 1}"`),
    op('ctx-limpar', 'Limpar histórico', 'vassoura'),
    (c.startsWith('grp-') || c.startsWith('plan-')) && op('ctx-excluir', 'Excluir conversa', 'lixo', true),
  ].filter(Boolean);
  const m = document.createElement('div'); m.id = 'ctx-menu'; m.className = 'ctx-menu';
  m.innerHTML = `<div class="ctx-tit">${esc(nomeCanal(c))}</div>${itens.join('')}`;
  document.body.appendChild(m);
  m.style.left = `${Math.min(ev.clientX, innerWidth - m.offsetWidth - 8)}px`; m.style.top = `${Math.min(ev.clientY, innerHeight - m.offsetHeight - 8)}px`;
});
document.addEventListener('mousedown', (ev) => { if (!ev.target.closest('#ctx-menu')) fecharCtx(); if (!ev.target.closest('#sel-menu, #emoji-pop, [data-acao=sel-abrir], [data-acao=emoji]')) fecharPops(); });
function modalMembros(canal) {
  const ja = canal.startsWith('grp-') ? ((J().grupos || []).find((g) => g.canal === canal)?.membros || []) : [canal.slice(3)];
  const livres = rosterAtual().filter((a) => !ja.includes(a.id) && !a.sistema && a.id !== 'creditos');
  abrirModal(`<h2>Adicionar membros</h2><p>${canal.startsWith('dm:') ? I18N.t('Abre um grupo com {nome} e quem você escolher.', { nome: esc(nomeAgente(canal.slice(3))) }) : I18N.t('Entram no grupo {grupo}.', { grupo: esc(nomeCanal(canal)) })}</p>
    <div class="membros-pick">${livres.map((a) => `<label class="mb-op">${av(a.id, 'p', { dot: false })}<span>${esc(a.nome)}<small>${esc(a.cargo)}</small></span><input type="checkbox" data-mb="${a.id}"></label>`).join('')}</div>
    <div class="acoes"><button class="btn-sec" data-acao="fechar">Cancelar</button><button class="btn-primario" data-acao="membros-ok" data-cv="${esc(canal)}">Adicionar</button></div>`, 'perfil');
}

/* ------------------------------------------------------------ chamada de voz com a liderança */
// O navegador grava (16 kHz, mono), detecta quando você fala e quando para, manda cada fala como WAV ao servidor; a resposta do agente
// volta como áudio pelo SSE (evento "voz"). Falar por cima do agente pausa o áudio e interrompe a chamada dele. Microfone só com a
// janela aberta: encerrar desliga tudo.
const CH = { aberta: false, ctx: null, stream: null, proc: null, audio: null, fila: [], fimPendente: false, mudo: false, falando: false, buf: [], amostras: 0, silencio: 0, ruido: 0.01, voz: 0, enviando: 0, estado: '', lider: null, nome: '', canal: '', tela: null, lado: false, layout: 'dividido', transcricao: [], escolhaFonte: null, vigia: null, assinatura: null, ultimoQuadro: 0 };
const ESTADO_CH = { preparando: 'Preparando a voz (na primeira vez pode levar uns minutos)', ouvindo: 'Ouvindo', transcrevendo: 'Entendendo', pensando: 'Pensando', gerando: 'Preparando a resposta', falando: 'Falando', erro: 'Problema', encerrada: 'Encerrada' };
// A chamada vive dentro da DM da liderança, como um canal de voz: o palco fica em cima das mensagens, com um quadro por participante
// (foto e decoração do perfil, nome estilizado, tema de cor, anel verde em quem fala), a tela compartilhada em destaque quando existe
// e os controles embaixo. Em outro canal, a barra lateral mostra "Voz conectada" com os mesmos controles, e a chamada continua.
const chCurto = (estado) => (ESTADO_CH[estado] || estado || '').split(' (')[0];   // no quadro e no painel, sem o parêntese explicativo
function chTile(id) {
  const pz = pessoaDe(id); const e = estiloDe(id); const cor = pz?.cor || '#5865f2';
  const p1 = e.tema?.c1 || `color-mix(in srgb, ${cor} 45%, #1b1e26)`, p2 = e.tema?.c2 || '#14161c';
  const capa = pz?.capa ? `<img class="ch-capa" src="${esc(pz.capa)}" alt="" draggable="false">` : '';
  const falando = id !== 'voce' && CH.estado === 'falando';
  return `<div class="ch-tile ${placaCls(id)} ${id === 'voce' && CH.mudo ? 'mudo' : ''} ${falando ? 'falando' : ''}" data-tile="${esc(id)}" style="--p1:${p1};--p2:${p2};--c:${cor}">${capa}
    <div class="ch-av">${av(id, 'x', { dot: false })}</div>
    <div class="ch-rotulo"><span class="ch-mic-ind">${ic('micOff')}</span><b>${nomeHtml(id, true)}</b>${id !== 'voce' ? `<small class="ch-sub">${esc(chCurto(CH.estado))}</small>` : ''}</div></div>`;
}
function chamadaHtml() {
  const lider = CH.lider || 'po';
  return `<div class="ch-palco ${CH.tela ? 'com-tela' : ''}">
    <div class="ch-cabecalho"><span class="ch-tit">${ic('fone')}<span>${I18N.t('Chamada com {nome}', { nome: nomeHtml(lider) })}</span></span><span class="ch-mini">${av('voce', 'p', { dot: false })}${av(lider, 'p', { dot: false })}</span><span class="ch-estado" data-estado="${esc(CH.estado)}">${esc(ESTADO_CH[CH.estado] || '')}</span>
      <span class="ch-layout"><button class="ch-ico ${CH.layout === 'compacto' ? 'on' : ''}" data-acao="chamada-layout" data-layout="compacto" title="${CH.layout === 'compacto' ? 'Abrir a chamada' : 'Encolher a chamada'}">${ic(CH.layout === 'compacto' ? 'maximizar' : 'minimizar')}</button></span></div>
    <div class="ch-corpo">
      <div class="ch-grade" id="ch-grade">
        <div class="ch-tela" id="ch-tela" ${CH.tela ? '' : 'hidden'}><video autoplay muted playsinline></video><span class="ch-tag">Sua tela</span></div>
        ${chTile('voce')}${chTile(lider)}
      </div>
      <aside class="ch-lado" id="ch-lado" ${CH.lado ? '' : 'hidden'}><div class="ch-lado-tit">Transcrição</div><div class="ch-transcricao" id="ch-transcricao">${CH.transcricao.map((t) => `<div class="ch-fala ${t.de === 'voce' ? 'minha' : ''}" data-de="${esc(t.de)}"><b>${t.de === 'voce' ? 'Você' : esc(CH.nome)}</b>${esc(t.texto)}</div>`).join('')}</div><div class="ch-mic" id="ch-mic"></div></aside>
    </div>
    <div class="ch-erro" id="ch-erro" hidden></div>
    <div class="ch-controles">
      <button class="ch-btn ${CH.mudo ? 'off' : ''}" data-acao="chamada-mudo" title="${CH.mudo ? 'Ligar microfone' : 'Silenciar'}">${ic(CH.mudo ? 'micOff' : 'mic')}</button>
      <button class="ch-btn ${CH.tela ? 'on' : ''}" data-acao="chamada-tela" title="${CH.tela ? 'Parar de compartilhar' : 'Compartilhar tela'}">${ic('tela')}</button>
      <button class="ch-btn ${CH.layout !== 'cheio' ? 'on' : ''}" data-acao="chamada-chat" title="${CH.layout === 'cheio' ? 'Mostrar o chat' : 'Esconder o chat'}">${ic('texto')}</button>
      <button class="ch-btn ${CH.lado ? 'on' : ''}" data-acao="chamada-texto" title="Transcrição da conversa">${ic('lista')}</button>
      <button class="ch-btn sair" data-acao="chamada-encerrar" title="Sair da chamada">${ic('fone')}</button>
    </div>
    <div class="ch-picker" id="ch-picker" hidden></div>
  </div>`;
}
/** Barra lateral, em qualquer canal: "Voz conectada", com quem, e os controles (igual ao painel de voz do Discord). */
function chamadaPainelHtml() {
  return `<div class="voz-painel"><button class="vp-canal" data-canal="${esc(CH.canal)}" title="Ir para a chamada">${av(CH.lider, 'm', { dot: false })}<span class="vp-info"><b>${ic('fone')}Voz conectada</b><small class="vp-estado">${nomeHtml(CH.lider)} <span>${esc(chCurto(CH.estado))}</span></small></span></button>
    <span class="vp-btns"><button class="btn-ic ${CH.mudo ? 'off' : ''}" data-acao="chamada-mudo" title="${CH.mudo ? 'Ligar microfone' : 'Silenciar'}">${ic(CH.mudo ? 'micOff' : 'mic')}</button><button class="btn-ic ${CH.tela ? 'on' : ''}" data-acao="chamada-tela" title="Compartilhar tela">${ic('tela')}</button><button class="btn-ic sair" data-acao="chamada-encerrar" title="Sair da chamada">${ic('fone')}</button></span></div>`;
}
/** Depois de qualquer renderização do chat: religa o vídeo da tela, o seletor de microfone e o estado dos quadros. */
function montarChamada() {
  const el = $('#chamada'); if (!el || !CH.aberta) return;
  const v = $('#ch-tela video'); if (v && CH.tela) v.srcObject = CH.tela;
  montarSeletorMic();
  const tr = $('#ch-transcricao'); if (tr) tr.scrollTop = tr.scrollHeight;
  chTileFala('voce', CH.falando);
}
function chTileFala(id, ligado) { $(`#chamada [data-tile="${id}"]`)?.classList.toggle('falando', !!ligado); }
/** Nível de som (0 a 1) de quem está falando: vira a borda viva em volta da foto, no palco e no painel lateral. */
function chNivel(id, v) {
  const n = Math.max(0, Math.min(1, v)).toFixed(2);
  for (const el of $$(`#chamada [data-tile="${id}"] .ch-av .av${id === 'voce' ? '' : ', .voz-painel .vp-canal .av'}`)) el.style.setProperty('--nivel', n);
}
function chLayout() {
  const el = $('#chamada'); if (!el) return;
  el.className = `dock ${CH.layout}`;
  const bl = $('#chamada [data-acao="chamada-layout"]'); if (bl) { bl.classList.toggle('on', CH.layout === 'compacto'); bl.innerHTML = ic(CH.layout === 'compacto' ? 'maximizar' : 'minimizar'); bl.title = CH.layout === 'compacto' ? I18N.t('Abrir a chamada') : I18N.t('Encolher a chamada'); }
  const bc = $('#chamada [data-acao="chamada-chat"]'); if (bc) { bc.classList.toggle('on', CH.layout !== 'cheio'); bc.title = CH.layout === 'cheio' ? I18N.t('Mostrar o chat') : I18N.t('Esconder o chat'); }
  const m = $('#mensagens'); if (m) m.scrollTop = m.scrollHeight;
}
/** Medidor do áudio do agente: o som que toca passa por um analisador e vira o nível da borda dele. */
/* Saída de voz sem cortes: cada trecho que chega é decodificado na hora e AGENDADO no relógio do áudio emendado no anterior
   (Web Audio, amostra a amostra), em vez de um <audio> por frase, que deixava um vazio audível entre uma fala e outra.
   Contexto próprio para a saída: o do microfone roda a 16 kHz e estragaria a voz do agente. */
function saidaCtx() {
  if (!CH.ctxSaida) {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const sk = lerDisp().saida; if (sk && ctx.setSinkId) ctx.setSinkId(sk).catch(() => {});   // alto-falante escolhido
    CH.ganhoSaida = ctx.createGain(); CH.ganhoSaida.gain.value = lerDisp().volume;
    CH.anSaida = ctx.createAnalyser(); CH.anSaida.fftSize = 256;
    CH.ganhoSaida.connect(CH.anSaida); CH.anSaida.connect(ctx.destination);
    CH.ctxSaida = ctx; CH.cadeiaSaida = Promise.resolve(); CH.proxInicio = 0; CH.fontes = [];
  }
  if (CH.ctxSaida.state === 'suspended') CH.ctxSaida.resume().catch(() => {});
  return CH.ctxSaida;
}
function medidorSaida() {   // a borda do agente acompanha o som que está saindo
  if (CH.medindo) return; CH.medindo = true;
  const dados = new Uint8Array(CH.anSaida.fftSize); let suave = 0;
  const tick = () => {
    if (!CH.aberta || !CH.tocando) { CH.medindo = false; chNivel(CH.lider, 0); return; }
    CH.anSaida.getByteTimeDomainData(dados); let s = 0; for (let i = 0; i < dados.length; i++) { const x = (dados[i] - 128) / 128; s += x * x; }
    const v = Math.min(1, Math.sqrt(Math.sqrt(s / dados.length) / 0.35)); suave = Math.max(v, suave * 0.85); chNivel(CH.lider, suave);
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}
/** Baixa e decodifica já (em paralelo com o que toca) e agenda na ordem de chegada, colado no fim do trecho anterior. */
function agendarAudio(url, { ack = false } = {}) {
  const ctx = saidaCtx();
  const geracao = CH.geracaoSaida;
  const pronto = fetch(url).then((r) => r.arrayBuffer()).then((b) => ctx.decodeAudioData(b)).catch(() => null);
  CH.cadeiaSaida = CH.cadeiaSaida.then(async () => {
    const buf = await pronto;
    if (!buf || !CH.aberta || geracao !== CH.geracaoSaida) return;
    const src = ctx.createBufferSource(); src.buffer = buf; src.connect(CH.ganhoSaida);
    const agora = ctx.currentTime;
    const inicio = Math.max(agora + 0.03, CH.proxInicio || 0);
    src.start(inicio);
    CH.proxInicio = inicio + buf.duration - 0.02;   // encosta no anterior: 20 ms de sobreposição somem com o fade natural das bordas
    CH.fontes.push(src); CH.tocando = true;
    if (!ack) chEstado('falando');
    medidorSaida();
    src.onended = () => {
      CH.fontes = CH.fontes.filter((x) => x !== src);
      if (CH.fontes.length) return;
      CH.tocando = false; CH.fimAudioEm = Date.now();
      if (CH.fimPendente && !CH.fila.length) { CH.fimPendente = false; chEstado('ouvindo'); }
    };
  });
}
function chBotoes() {   // os mesmos botões existem no palco e no painel lateral
  for (const b of $$('[data-acao="chamada-mudo"]')) { b.innerHTML = ic(CH.mudo ? 'micOff' : 'mic'); b.classList.toggle('off', CH.mudo); b.title = CH.mudo ? I18N.t('Ligar microfone') : I18N.t('Silenciar'); }
  for (const b of $$('[data-acao="chamada-tela"]')) { b.classList.toggle('on', !!CH.tela); b.title = CH.tela ? I18N.t('Parar de compartilhar') : I18N.t('Compartilhar tela'); }
  $('#chamada [data-tile="voce"]')?.classList.toggle('mudo', CH.mudo);
}
/** Escolha de tela ou janela dentro da própria chamada (no app; no navegador o Chrome tem o seletor dele). */
function escolherFonteTela(fontes) {
  return new Promise((resolve) => {
    const box = $('#ch-picker'); if (!box) return resolve(null);
    const grupo = (tipo, tit) => { const l = fontes.filter((f) => f.tipo === tipo); return l.length ? `<div class="ch-pk-tit">${tit}</div><div class="ch-pk-grade">${l.map((f) => `<button class="ch-pk-item" data-acao="ch-fonte" data-fonte="${esc(f.id)}"><img src="${f.miniatura}" alt=""><span>${esc(f.nome)}</span></button>`).join('')}</div>` : ''; };
    box.innerHTML = `<div class="ch-pk-caixa"><div class="ch-pk-cab"><b>O que você quer mostrar?</b><button class="btn-sec" data-acao="ch-fonte-cancelar">Cancelar</button></div>${grupo('tela', 'Telas')}${grupo('janela', 'Janelas')}</div>`;
    box.hidden = false;
    CH.escolhaFonte = (id) => { CH.escolhaFonte = null; box.hidden = true; box.innerHTML = ''; resolve(id); };
  });
}
async function compartilharTela() {
  if (!CH.aberta) return;
  if (CH.tela) return pararTela();
  if (!navigator.mediaDevices?.getDisplayMedia) return aviso(I18N.t('Este navegador não compartilha tela.'));
  try {
    if (window.studioApp?.fontesTela) {
      const fontes = await window.studioApp.fontesTela();
      const id = await escolherFonteTela(fontes);
      if (!id) return;
      await window.studioApp.escolherTela(id);
    }
    const stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 5 }, audio: false });
    CH.tela = stream;
    const caixa = $('#ch-tela'); const v = caixa?.querySelector('video');
    if (v) { v.srcObject = stream; caixa.hidden = false; }
    $('#chamada .ch-palco')?.classList.add('com-tela');
    chBotoes();
    stream.getVideoTracks()[0].onended = () => pararTela();   // parou pelo Windows ou fechou a janela mostrada
    CH.assinatura = null; CH.ultimoQuadro = 0;
    clearInterval(CH.vigia); CH.vigia = setInterval(vigiarTela, 2500);
  } catch (e) {
    if (e.name !== 'NotAllowedError') aviso(I18N.t('Não consegui compartilhar a tela: {erro}', { erro: e.message }), 7000);
  }
}
function pararTela() {
  clearInterval(CH.vigia); CH.vigia = null;
  if (CH.tela) api('POST', P('/voz/tela'), {});   // avisa que não há mais tela
  try { CH.tela?.getTracks().forEach((t) => t.stop()); } catch { /* ok */ }
  CH.tela = null;
  const caixa = $('#ch-tela'); if (caixa) { caixa.hidden = true; const v = caixa.querySelector('video'); if (v) v.srcObject = null; }
  $('#chamada .ch-palco')?.classList.remove('com-tela');
  chBotoes();
}
/** Olha a tela a cada 2,5 s numa miniatura de 48x30: só quando a imagem muda de verdade (e no máximo a cada 4 s) um quadro sobe para o
 *  servidor, que o guarda para a próxima fala ou para o agente que pediu para acompanhar. Tela parada não gasta nada. */
async function vigiarTela() {
  const v = $('#ch-tela video'); if (!CH.aberta || !CH.tela || !v || !v.videoWidth) return;
  const c = document.createElement('canvas'); c.width = 48; c.height = 30;
  const ctx = c.getContext('2d', { willReadFrequently: true }); ctx.drawImage(v, 0, 0, 48, 30);
  const px = ctx.getImageData(0, 0, 48, 30).data; const ass = new Uint8Array(48 * 30);
  for (let i = 0; i < ass.length; i++) ass[i] = (px[i * 4] + px[i * 4 + 1] + px[i * 4 + 2]) / 3;
  let dif = 0; if (CH.assinatura) { for (let i = 0; i < ass.length; i++) dif += Math.abs(ass[i] - CH.assinatura[i]); dif /= ass.length * 255; }
  const primeira = !CH.assinatura; CH.assinatura = ass;
  if ((!primeira && dif < 0.035) || Date.now() - CH.ultimoQuadro < 4000) return;
  CH.ultimoQuadro = Date.now();
  const rel = await quadroDaTela(); if (!rel) return;
  api('POST', P('/voz/tela'), { rel });
}
/** Um quadro da tela compartilhada (JPEG, até 1280 px) sobe como anexo do projeto; o servidor decide quando o agente o vê. */
async function quadroDaTela() {
  const v = $('#ch-tela video'); if (!CH.tela || !v || !v.videoWidth) return null;
  const escala = Math.min(1, 1280 / v.videoWidth);
  const c = document.createElement('canvas'); c.width = Math.round(v.videoWidth * escala); c.height = Math.round(v.videoHeight * escala);
  c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
  const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.72));
  if (!blob) return null;
  try {
    const resp = await fetch(P(`/anexo?nome=${encodeURIComponent('tela.jpg')}`), { method: 'PUT', body: blob, headers: { 'x-studio-anexo': '1', 'content-type': 'image/jpeg' } });
    const j = await resp.json().catch(() => ({}));
    return resp.ok ? j.anexo?.rel || null : null;
  } catch { return null; }
}
function chLinha(de, texto) {
  const ult = CH.transcricao.at(-1);
  if (ult && ult.de === de) ult.texto += ` ${texto}`; else CH.transcricao.push({ de, texto });
  const box = $('#ch-transcricao'); if (!box) return;
  const ultima = box.lastElementChild;
  if (ultima && ultima.dataset.de === de) { ultima.append(` ${texto}`); box.scrollTop = box.scrollHeight; return; }
  box.insertAdjacentHTML('beforeend', `<div class="ch-fala ${de === 'voce' ? 'minha' : ''}" data-de="${esc(de)}"><b>${de === 'voce' ? 'Você' : esc(CH.nome)}</b>${esc(texto)}</div>`);
  box.scrollTop = box.scrollHeight;
}
function chEstado(estado, erro) {
  CH.estado = estado;
  const el = $('#chamada .ch-estado'); if (el) { el.textContent = ESTADO_CH[estado] || estado; el.dataset.estado = estado; }
  const sub = $('#chamada .ch-sub'); if (sub) sub.textContent = chCurto(estado);
  const vp = $('.voz-painel .vp-estado span'); if (vp) vp.textContent = chCurto(estado);
  chTileFala(CH.lider, estado === 'falando');
  const e = $('#ch-erro'); if (e) { e.hidden = !erro; e.textContent = erro || ''; }
}
function wavDe(floats, taxa = 16000) {
  const n = floats.length, b = new ArrayBuffer(44 + n * 2), v = new DataView(b);
  const w = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  w(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); w(8, 'WAVE'); w(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, taxa, true); v.setUint32(28, taxa * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) { const s = Math.max(-1, Math.min(1, floats[i])); v.setInt16(44 + i * 2, s < 0 ? s * 32768 : s * 32767, true); }
  return new Blob([b], { type: 'audio/wav' });
}
const FILTROS_MIC = { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true };
const micVirtual = (nome) => /virtual|steam streaming|oculus|cable|voicemeeter|loopback|stereo mix|mixagem/i.test(nome || '');
/** Abre o microfone escolhido; se o padrão falhar (microfone virtual sem o programa dele aberto, dispositivo ocupado), tenta os outros. */
async function abrirMicrofone(deviceId) {
  const quero = deviceId || lerDisp().mic;
  const tentar = async (id) => navigator.mediaDevices.getUserMedia({ audio: id ? { ...FILTROS_MIC, deviceId: { exact: id } } : FILTROS_MIC });
  const erros = [];
  if (quero) { try { return await tentar(quero); } catch (e) { erros.push(e.message); } }
  let padrao = null;
  try { padrao = await tentar(''); } catch (e) { erros.push(e.message); }
  // o padrão do Windows abriu, mas é um microfone virtual (Oculus, Steam, cabo): ele "funciona" e entrega silêncio. Prefere um físico.
  const devs = (await navigator.mediaDevices.enumerateDevices().catch(() => [])).filter((d) => d.kind === 'audioinput' && d.deviceId && !['default', 'communications'].includes(d.deviceId));
  devs.sort((x, y) => Number(micVirtual(x.label)) - Number(micVirtual(y.label)));
  if (padrao) {
    const rotulo = padrao.getAudioTracks()[0]?.label || '';
    const fisico = micVirtual(rotulo) ? devs.find((d) => !micVirtual(d.label)) : null;
    if (!fisico) return padrao;
    try { const s = await tentar(fisico.deviceId); padrao.getTracks().forEach((t) => t.stop()); aviso(I18N.t('O microfone padrão do Windows é virtual ({virtual}); usando {fisico}.', { virtual: rotulo.replace(/^Default - /, ''), fisico: fisico.label }), 7000); return s; } catch { return padrao; }
  }
  // o padrão não abriu: tenta cada microfone, físicos primeiro
  for (const d of devs) { try { const s = await tentar(d.deviceId); salvarDisp({ mic: d.deviceId }); return s; } catch (e) { erros.push(`${d.label || d.deviceId.slice(0, 6)}: ${e.message}`); } }
  throw new Error(I18N.t('nenhum microfone abriu. {erros}', { erros: [...new Set(erros)].slice(0, 3).join(' | ') }));
}
/* ---- Ajustes > Modelos: a voz do agente (timbre, ritmo, expressividade), prévia e amostra própria ---- */
const vozEscolhida = () => ({ nome: $('#voz-nome')?.value, ritmo: Number($('#voz-ritmo')?.value) / 100, expressividade: Number($('#voz-exp')?.value) / 100 });
function montarVozAjustes(vz) {
  const sel = $('#voz-nome'); if (!sel) return;
  sel.onchange = () => { const x = (vz.vozes || []).find((o) => o.id === sel.value); const or = $('#voz-origem'); if (or && x) or.firstChild.textContent = `${I18N.t('Timbre e sotaque: {origem}.', { origem: x.origem })} `; };
  for (const [id, rot] of [['#voz-ritmo', '#voz-ritmo-v'], ['#voz-exp', '#voz-exp-v']]) { const el = $(id); if (el) el.oninput = () => { $(rot).textContent = el.value; }; }
  const fi = $('#voz-amostra');
  if (fi) fi.onchange = async () => {
    const f = fi.files?.[0]; if (!f) return;
    const st = $('#voz-previa-st'); st.textContent = I18N.t('Enviando a amostra…');
    const r = await fetch('/api/voz/amostra', { method: 'PUT', body: f, headers: { 'x-studio-voz': '1', 'content-type': 'audio/wav' } }).then((x) => x.json()).catch(() => ({}));
    if (!r.ok) { st.textContent = r.erro || I18N.t('Não consegui usar essa amostra.'); return; }
    await api('PUT', '/api/voz', { voz: { ...vozEscolhida(), nome: 'propria' } });
    aviso(I18N.t('Amostra guardada. A voz passa a usar o seu timbre.')); return modalAjustes();
  };
}
async function ouvirPrevia() {
  const st = $('#voz-previa-st'); if (st) st.textContent = I18N.t('Gerando a prévia (na primeira vez carrega o modelo)…');
  const r = await api('POST', '/api/voz/previa', vozEscolhida());
  if (!r._ok) { if (st) st.textContent = r.erro || I18N.t('Não consegui gerar a prévia.'); return; }
  if (st) st.textContent = I18N.t('Pronto em {s} s.', { s: ((r.ms || 0) / 1000).toFixed(1) });
  const d = lerDisp(); const a = new Audio(`/api/voz/previa/audio?t=${Date.now()}`); a.volume = d.volume;
  if (d.saida && a.setSinkId) await a.setSinkId(d.saida).catch(() => {});
  a.play().catch(() => { if (st) st.textContent = I18N.t('O navegador bloqueou o áudio; clique de novo.'); });
}

/* ---- Ajustes > Dispositivos: microfone, alto-falante, volume e sensibilidade da chamada. Fica neste computador (localStorage). ---- */
const DISP_PADRAO = { mic: '', saida: '', ganho: 1, sensibilidade: 1, volume: 1 };
function lerDisp() {
  try {
    const d = JSON.parse(localStorage.getItem('voz:dispositivos') || '{}');
    const antigo = localStorage.getItem('voz:mic');   // escolha feita antes de existir esta aba
    return { ...DISP_PADRAO, ...d, ...(antigo && !d.mic ? { mic: antigo } : {}) };
  } catch { return { ...DISP_PADRAO }; }
}
function salvarDisp(parte) {
  try { localStorage.setItem('voz:dispositivos', JSON.stringify({ ...lerDisp(), ...parte })); if (parte.mic !== undefined) localStorage.removeItem('voz:mic'); } catch { /* sem armazenamento */ }
  aplicarDisp();
}
/** Vale na hora, inclusive com a chamada aberta. */
function aplicarDisp() {
  const d = lerDisp();
  if (CH.ganho) CH.ganho.gain.value = d.ganho;
  if (CH.ganhoSaida) CH.ganhoSaida.gain.value = d.volume;
  if (CH.ctxSaida?.setSinkId) CH.ctxSaida.setSinkId(d.saida || '').catch(() => {});
}
const pct = (v) => `${Math.round(v * 100)}%`;
function dispositivosHtml() {
  const d = lerDisp();
  return `<h2>Dispositivos</h2>
    <div class="dica-v" style="color:var(--mudo);margin:-6px 0 14px">Vale para a chamada de voz neste computador e muda na hora, mesmo com a chamada aberta. Fale para ver o medidor.</div>
    <div class="campo"><label class="rot">Microfone</label><select class="in" id="disp-mic"><option value="">Padrão do Windows</option></select>
      <div class="dica-v" style="color:var(--mudo);margin-top:6px">Se o padrão do Windows for um microfone virtual (Oculus, Steam, cabo), o app prefere um físico sozinho.</div></div>
    <div class="campo"><label class="rot">Entrada ao vivo</label><div class="disp-medidor"><b id="disp-nivel"></b><i id="disp-limiar" title="A partir daqui o app entende que você está falando"></i></div><small class="dica-v" id="disp-status" style="color:var(--mudo)">Abrindo o microfone…</small></div>
    <div class="dois campo">
      <div><label class="rot">Volume do microfone <em id="disp-ganho-v">${pct(d.ganho)}</em></label><input type="range" class="faixa" id="disp-ganho" min="0" max="200" step="5" value="${Math.round(d.ganho * 100)}"></div>
      <div><label class="rot">Sensibilidade <em id="disp-sens-v">${pct(d.sensibilidade)}</em></label><input type="range" class="faixa" id="disp-sens" min="50" max="250" step="5" value="${Math.round(d.sensibilidade * 100)}"><div class="dica-v" style="color:var(--mudo)">Mais sensível capta fala baixa (e mais ruído de fundo); menos sensível exige falar mais firme.</div></div>
    </div>
    <h3 style="margin:18px 0 10px">Saída</h3>
    <div class="campo"><label class="rot">Alto-falante ou fone</label><select class="in" id="disp-saida"><option value="">Padrão do Windows</option></select></div>
    <div class="campo"><label class="rot">Volume da voz do agente <em id="disp-vol-v">${pct(d.volume)}</em></label><div class="linha-in"><input type="range" class="faixa" id="disp-vol" min="0" max="100" step="5" value="${Math.round(d.volume * 100)}"><button class="btn-sec" data-acao="disp-testar-som">Testar som</button></div></div>`;
}
let dispTeste = null;   // { stream, ctx } do medidor ao vivo
function pararTesteMic() { if (!dispTeste) return; try { dispTeste.stream.getTracks().forEach((t) => t.stop()); } catch { /* ok */ } try { dispTeste.ctx.close(); } catch { /* ok */ } dispTeste = null; }
async function montarDispositivos() {
  const selMic = $('#disp-mic'), selSaida = $('#disp-saida'); if (!selMic) return;
  if (!navigator.mediaDevices?.enumerateDevices) { $('#disp-status').textContent = I18N.t('Este navegador não lista dispositivos de áudio.'); return; }
  let devs = await navigator.mediaDevices.enumerateDevices().catch(() => []);
  // sem permissão concedida ainda, o navegador esconde os nomes: pede uma vez, só para listar, e solta o microfone na hora
  if (devs.some((x) => x.kind === 'audioinput') && devs.filter((x) => x.kind === 'audioinput').every((x) => !x.label)) { try { const s = await navigator.mediaDevices.getUserMedia({ audio: true }); s.getTracks().forEach((t) => t.stop()); devs = await navigator.mediaDevices.enumerateDevices(); } catch { /* fica sem nomes */ } }
  const d = lerDisp();
  const op = (x, atual, virt) => `<option value="${esc(x.deviceId)}" ${x.deviceId === atual ? 'selected' : ''}>${esc(x.label || I18N.t('Dispositivo'))}${virt && micVirtual(x.label) ? ' (virtual)' : ''}</option>`;
  selMic.insertAdjacentHTML('beforeend', devs.filter((x) => x.kind === 'audioinput' && x.deviceId && !['default', 'communications'].includes(x.deviceId)).map((x) => op(x, d.mic, true)).join(''));
  selSaida.insertAdjacentHTML('beforeend', devs.filter((x) => x.kind === 'audiooutput' && x.deviceId && !['default', 'communications'].includes(x.deviceId)).map((x) => op(x, d.saida, false)).join(''));
  const liga = (id, chave, escala, rot) => { const el = $(id); if (!el) return; el.oninput = () => { const v = Number(el.value) / escala; salvarDisp({ [chave]: v }); $(rot).textContent = pct(v); }; };
  liga('#disp-ganho', 'ganho', 100, '#disp-ganho-v'); liga('#disp-sens', 'sensibilidade', 100, '#disp-sens-v'); liga('#disp-vol', 'volume', 100, '#disp-vol-v');
  selSaida.onchange = () => salvarDisp({ saida: selSaida.value });
  selMic.onchange = async () => { salvarDisp({ mic: selMic.value }); await testarMic(); if (CH.aberta) { try { const novo = await abrirMicrofone(selMic.value); CH.stream?.getTracks().forEach((t) => t.stop()); CH.stream = novo; CH.fonte?.disconnect(); CH.fonte = CH.ctx.createMediaStreamSource(novo); CH.fonte.connect(CH.ganho || CH.proc); CH.ruido = 0.01; } catch (e) { aviso(I18N.t('Esse microfone não abriu: {erro}', { erro: e.message }), 6000); } } };
  await testarMic();
}
/** Medidor ao vivo: o mesmo caminho da chamada (ganho e piso de ruído), para o que você vê aqui ser o que a chamada ouve. */
async function testarMic() {
  pararTesteMic();
  const status = $('#disp-status'); if (!status) return;
  let stream;
  try { stream = await abrirMicrofone($('#disp-mic')?.value || ''); } catch (e) { status.textContent = e.name === 'NotReadableError' ? I18N.t('O microfone existe, mas este app foi impedido de usá-lo (Windows ou antivírus).') : I18N.t('Não abriu: {erro}', { erro: e.message }); return; }
  const rotulo = stream.getAudioTracks()[0]?.label || '';
  const sel = $('#disp-mic'); if (sel && !sel.value) { const o = [...sel.options].find((x) => x.textContent.startsWith(rotulo.replace(/^Default - /, ''))); status.textContent = I18N.t('Usando {mic}.', { mic: (rotulo.replace(/^Default - /, '') || I18N.t('o microfone padrão')) + (o ? '' : '') }); } else status.textContent = I18N.t('Usando {mic}.', { mic: rotulo });
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  const fonte = ctx.createMediaStreamSource(stream); const ganho = ctx.createGain(); const an = ctx.createAnalyser(); an.fftSize = 1024;
  fonte.connect(ganho); ganho.connect(an);
  dispTeste = { stream, ctx, ganho };
  const dados = new Float32Array(an.fftSize); let ruido = 0.01, suave = 0, falouAlguma = false;
  const tick = () => {
    if (dispTeste?.ctx !== ctx) return;
    if (!$('#disp-nivel')) { pararTesteMic(); return; }   // saiu da aba ou fechou os Ajustes
    const d = lerDisp(); ganho.gain.value = d.ganho;
    an.getFloatTimeDomainData(dados); let s = 0; for (let i = 0; i < dados.length; i++) s += dados[i] * dados[i];
    const rms = Math.sqrt(s / dados.length);
    const limiar = Math.max(0.012, ruido * 3.5) / d.sensibilidade;
    if (rms <= limiar) ruido = ruido * 0.97 + rms * 0.03;
    const esc01 = (x) => Math.min(1, Math.sqrt(x / 0.25));
    suave = Math.max(esc01(rms), suave * 0.85);
    $('#disp-nivel').style.width = pct(suave); $('#disp-limiar').style.left = pct(esc01(limiar));
    $('#disp-nivel').classList.toggle('fala', rms > limiar);
    if (rms > limiar) falouAlguma = true;
    status.textContent = rms > limiar ? I18N.t('Captando a sua voz.') : falouAlguma ? I18N.t('Em silêncio. Usando {mic}.', { mic: rotulo.replace(/^Default - /, '') }) : I18N.t('Usando {mic}. Fale alguma coisa para testar.', { mic: rotulo.replace(/^Default - /, '') });
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}
/** Dois tons curtos pela saída escolhida, no volume escolhido. */
async function testarSom() {
  const d = lerDisp();
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  if (d.saida && ctx.setSinkId) await ctx.setSinkId(d.saida).catch(() => {});
  const g = ctx.createGain(); g.gain.value = 0.0001; g.connect(ctx.destination);
  const o = ctx.createOscillator(); o.type = 'sine'; o.connect(g);
  const t = ctx.currentTime; o.frequency.setValueAtTime(523, t); o.frequency.setValueAtTime(659, t + 0.22);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0001, 0.35 * d.volume), t + 0.03); g.gain.setValueAtTime(Math.max(0.0001, 0.35 * d.volume), t + 0.4); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.55);
  o.start(t); o.stop(t + 0.6); o.onended = () => ctx.close();
}
async function montarSeletorMic() {
  const box = $('#ch-mic'); if (!box) return;
  const devs = (await navigator.mediaDevices.enumerateDevices().catch(() => [])).filter((d) => d.kind === 'audioinput' && d.deviceId && !['default', 'communications'].includes(d.deviceId));
  const atual = CH.stream?.getAudioTracks()[0]?.getSettings().deviceId || '';
  box.innerHTML = `<select class="in" data-mic-sel title="Microfone">${devs.map((d) => `<option value="${esc(d.deviceId)}" ${d.deviceId === atual ? 'selected' : ''}>${esc(d.label || I18N.t('Microfone'))}</option>`).join('')}</select>`;
  box.querySelector('select').onchange = async (ev) => {
    const id = ev.target.value;
    try {
      const novo = await abrirMicrofone(id);
      try { CH.stream?.getTracks().forEach((t) => t.stop()); } catch { /* ok */ }
      CH.stream = novo; salvarDisp({ mic: id });
      if (CH.ctx && CH.proc) { CH.fonte?.disconnect(); CH.fonte = CH.ctx.createMediaStreamSource(novo); CH.fonte.connect(CH.ganho || CH.proc); }
      CH.ruido = 0.01;
    } catch (e) { aviso(I18N.t('Esse microfone não abriu: {erro}', { erro: e.message }), 6000); }
  };
}
async function abrirChamada() {
  if (CH.aberta) return;
  if (!navigator.mediaDevices?.getUserMedia) return aviso(I18N.t('Este navegador não dá acesso ao microfone.'));
  const lider = liderAtual(); const a = agente(lider);
  Object.assign(CH, { aberta: true, lider, nome: a?.nome || I18N.t('Liderança'), canal: `dm:${lider}`, mudo: false, estado: 'preparando', buf: [], amostras: 0, silencio: 0, voz: 0, falando: false, tela: null, lado: false, transcricao: [] });
  // a chamada acontece na DM da liderança: entra nela (o palco é desenhado junto com o chat) e o painel lateral aparece
  if (U.vista !== 'chat' || U.canal !== CH.canal) await irPara('chat', CH.canal); else { renderChat(); renderLista(); }
  try { CH.stream = await abrirMicrofone(); } catch (e) {
    fecharChamada();
    // NotReadableError com microfones listados: o Windows ou um antivírus (Kaspersky, por exemplo) está barrando este app, não é falta de aparelho
    if (e.name === 'NotReadableError') return aviso(I18N.t('O microfone existe, mas este app foi impedido de usá-lo. Confira em Configurações do Windows > Privacidade > Microfone se apps da área de trabalho têm acesso; se houver um antivírus corporativo (Kaspersky), peça à TI para permitir o NECTAR em "Acesso a dispositivos de gravação de som".'), 14000);
    return aviso(I18N.t('Sem microfone: {erro}', { erro: e.message }), 9000);
  }
  montarSeletorMic();
  const r = await api('POST', P('/voz/iniciar'), { engine: E.config.engine, modo: 'conversar' });
  if (!r._ok) { const msg = r.erro || I18N.t('Não consegui iniciar a chamada.'); fecharChamada(); return aviso(msg, 10000); }
  CH.ctx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
  CH.fonte = CH.ctx.createMediaStreamSource(CH.stream);
  CH.ganho = CH.ctx.createGain(); CH.ganho.gain.value = lerDisp().ganho;   // volume do microfone (Ajustes > Dispositivos)
  CH.proc = CH.ctx.createScriptProcessor(2048, 1, 1);
  CH.fonte.connect(CH.ganho); CH.ganho.connect(CH.proc); CH.proc.connect(CH.ctx.destination);
  const taxa = CH.ctx.sampleRate;
  CH.proc.onaudioprocess = (ev) => {
    if (!CH.aberta) return;
    if (CH.mudo) { if (CH.nivelVoce) { CH.nivelVoce = 0; chNivel('voce', 0); } return; }
    const d = ev.inputBuffer.getChannelData(0);
    let soma = 0; for (let i = 0; i < d.length; i++) soma += d[i] * d[i];
    const rms = Math.sqrt(soma / d.length);
    // a borda em volta da sua foto acompanha o microfone o tempo todo (mesmo sussurro): é o sinal de que ele está captando
    CH.nivelVoce = Math.max(Math.min(1, Math.sqrt(rms / 0.12)), (CH.nivelVoce || 0) * 0.7); chNivel('voce', CH.nivelVoce < 0.06 ? 0 : CH.nivelVoce);
    const dur = d.length / taxa;
    if (!CH.falando) CH.ruido = CH.ruido * 0.95 + rms * 0.05;   // piso de ruído se adapta enquanto você não fala
    const limiar = Math.max(0.012, CH.ruido * 3.5) / lerDisp().sensibilidade;   // sensibilidade (Ajustes > Dispositivos)
    // Enquanto o agente fala (e por meio segundo depois), o microfone ouve a caixa de som: o eco da voz dele voltava como fala sua,
    // interrompia a resposta e ainda virava mensagem. Então, com som tocando, só fala sustentada e bem acima do eco conta.
    const tocando = CH.tocando || Date.now() - (CH.fimAudioEm || 0) < 500;
    if (CH.tocando) CH.fimAudioEm = Date.now();
    if (rms > limiar * (tocando ? 3 : 1)) {
      CH.voz += dur; CH.silencio = 0;
      if (!CH.falando && CH.voz >= (tocando ? 1.2 : 0.25)) {   // começou a falar de verdade (com o agente falando, exige bem mais)
        CH.falando = true; chTileFala('voce', true);
        if (CH.tocando || CH.fila.length || ['pensando', 'gerando'].includes(CH.estado)) { pararAudio(); api('POST', P('/voz/interromper'), {}); }   // falou por cima: para o agente e derruba a fila
      }
    } else { CH.silencio += dur; if (!CH.falando) CH.voz = Math.max(0, CH.voz - dur); }
    if (CH.falando || (CH.voz > 0 && !tocando)) { CH.buf.push(new Float32Array(d)); CH.amostras += d.length; }
    if (CH.falando && CH.silencio >= 0.9) enviarFala();          // pausa de pensamento curta não encerra o turno; 0,9 s encerra
    else if (!CH.falando && CH.buf.length > 20) { CH.buf.splice(0, CH.buf.length - 8); CH.amostras = CH.buf.reduce((s, x) => s + x.length, 0); }   // guarda só um pouco antes da fala
    if (CH.falando && CH.amostras > taxa * 60) enviarFala();     // fala muito longa: manda o que tem
  };
}
async function enviarFala() {
  const partes = CH.buf; const n = CH.amostras;
  CH.buf = []; CH.amostras = 0; CH.falando = false; CH.voz = 0; CH.silencio = 0; chTileFala('voce', false);
  if (n < 16000 * 0.4) return;   // menos de 0,4 s: ruído
  const tudo = new Float32Array(n); let o = 0; for (const p of partes) { tudo.set(p, o); o += p.length; }
  CH.enviando++; chEstado('transcrevendo');
  try {
    if (CH.tela && Date.now() - CH.ultimoQuadro > 4000) { const rel = await quadroDaTela(); if (rel) { CH.ultimoQuadro = Date.now(); await api('POST', P('/voz/tela'), { rel }); } }   // o agente vê a tela como ela está na hora em que você fala
    const r = await fetch(P('/voz/falar'), { method: 'POST', headers: { 'Content-Type': 'audio/wav', 'x-studio-voz': '1' }, body: wavDe(tudo, CH.ctx.sampleRate) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) chEstado('ouvindo', j.erro || I18N.t('Não entendi.'));
    else if (j.texto) chLinha('voce', j.texto);
  } catch (e) { chEstado('ouvindo', e.message); }
  CH.enviando--;
}
function pararAudio() {
  clearTimeout(CH.ackTimer); CH.fila = []; CH.fimPendente = false;
  CH.geracaoSaida = (CH.geracaoSaida || 0) + 1;   // o que ainda estava baixando ou agendado é descartado
  for (const s of CH.fontes || []) { try { s.onended = null; s.stop(); } catch { /* já parou */ } }
  CH.fontes = []; CH.proxInicio = 0; CH.tocando = false; CH.fimAudioEm = Date.now();
  chNivel(CH.lider, 0);
}
function tocarProximo() {
  if (!CH.aberta) return;
  while (CH.fila.length) agendarAudio(CH.fila.shift());
  if (!CH.tocando && !(CH.fontes || []).length && CH.fimPendente) { CH.fimPendente = false; chEstado('ouvindo'); }
}
function vozEvento(e) {
  if (!CH.aberta || e.projeto !== U.proj) return;
  if (e.estado === 'falando') {   // uma frase pronta: entra na fila e toca em ordem, enquanto o resto ainda é gerado
    if (e.texto) chLinha(CH.lider, e.texto);
    if (e.audio) CH.fila.push(P(`/voz/audio/${e.audio}`));
    if (e.fim) CH.fimPendente = true;
    tocarProximo(); return;
  }
  if (e.estado === 'fim') { CH.fimPendente = true; if (!CH.tocando && !CH.fila.length) { CH.fimPendente = false; chEstado('ouvindo'); } return; }
  if (e.estado === 'pensando') {
    clearTimeout(CH.ackTimer);
    if (e.ack) CH.ackTimer = setTimeout(() => { if (CH.aberta && CH.estado === 'pensando' && !CH.tocando && !CH.fila.length) agendarAudio(P(`/voz/audio/${e.ack}`), { ack: true }); }, 1800);   // só se a resposta demorar
  } else clearTimeout(CH.ackTimer);
  if (e.estado === 'encerrada') return fecharChamada(true);
  if (e.interrompido) pararAudio();
  chEstado(e.estado, e.erro || null);
}
function fecharChamada(jaEncerrada = false) {
  if (!CH.aberta) return;
  CH.aberta = false;
  try { CH.proc?.disconnect(); } catch { /* ok */ }
  try { CH.stream?.getTracks().forEach((t) => t.stop()); } catch { /* ok */ }
  try { CH.ctx?.close(); } catch { /* ok */ }
  try { CH.ctxSaida?.close(); } catch { /* ok */ }
  pararAudio(); pararTela(); CH.escolhaFonte = null;
  CH.proc = CH.stream = CH.ctx = CH.ctxSaida = CH.ganho = CH.fonte = CH.ganhoSaida = CH.anSaida = null; CH.nivelVoce = 0; CH.fontes = []; CH.tocando = false;
  $('#chamada')?.remove(); $('.voz-painel')?.remove();
  if (!jaEncerrada) api('POST', P('/voz/encerrar'), {});
}

/* ------------------------------------------------------------ pontos de salvamento */
async function salvarProjeto() {
  if (!U.proj) return aviso(I18N.t('Abra um projeto para salvar.'));
  const r = await api('POST', P('/pontos'), {});
  if (!r._ok) return aviso(r.erro || I18N.t('Não consegui salvar o projeto.'));
  aviso(I18N.t('Projeto salvo: {cards} cards, {msgs} mensagens, {tam}.', { cards: r.ponto.cards, msgs: r.ponto.mensagens, tam: r.ponto.tamanho }));
  if ($('#pontos-lista')) carregarPontos();
}
const TIPO_PONTO = { auto: 'Automático', manual: 'Manual', 'antes-de-restaurar': 'Antes de restaurar' };
async function carregarPontos() {
  const caixa = $('#pontos-lista');
  if (!caixa) return;
  const r = await api('GET', P('/pontos'));
  const lista = r.lista || [];
  const ultimoAuto = lista.find((x) => x.tipo === 'auto');
  caixa.innerHTML = lista.length ? `${ultimoAuto ? `<div class="dica-v" style="color:var(--mudo);margin:8px 0">${I18N.t('Último salvamento automático às {hora}', { hora: hhmm(ultimoAuto.em) })}</div>` : ''}
    ${lista.map((x) => `<div class="ponto-item"><div class="ponto-info"><b>${I18N.t(TIPO_PONTO[x.tipo] || x.tipo)}${x.rotulo ? `: ${esc(x.rotulo)}` : ''}</b>
      <span>${I18N.t('{dia} às {hora}, {cards} cards, {msgs} mensagens, {tam}', { dia: diaTxt(x.em), hora: hhmm(x.em), cards: x.cards, msgs: x.mensagens, tam: esc(x.tamanho) })}${x.completo ? '' : ` (${I18N.t('leve')})`}</span></div>
      <div class="ponto-acoes"><button class="btn-sec" data-acao="ponto-restaurar" data-ponto="${esc(x.id)}">Restaurar</button>${x.tipo === 'antes-de-restaurar' ? '' : `<button class="btn-sec btn-perigo" data-acao="ponto-excluir" data-ponto="${esc(x.id)}">Excluir</button>`}</div></div>`).join('')}`
    : '<div class="dica-v" style="color:var(--mudo);margin-top:8px">Ainda não há pontos salvos. O primeiro automático sai em até 10 minutos.</div>';
}
async function restaurarPonto(id) {
  const r0 = await api('GET', P('/pontos'));
  const x = (r0.lista || []).find((y) => y.id === id);
  if (!x) return aviso(I18N.t('Esse ponto não existe mais.'));
  const quando = I18N.t('{dia} às {hora}', { dia: diaTxt(x.em), hora: hhmm(x.em) });
  if (!(await perguntar(I18N.t('Voltar o projeto para o ponto de {quando} ({cards} cards, {msgs} mensagens)? O estado de agora é guardado antes como um ponto "Antes de restaurar", e o app reabre para aplicar.', { quando, cards: x.cards, msgs: x.mensagens }), I18N.t('Restaurar')))) return;
  const r = await api('POST', P(`/pontos/${id}/restaurar`), {});
  if (!r._ok) return aviso(r.erro || I18N.t('Não consegui restaurar.'));
  if (window.studioApp?.reiniciar) { aviso(I18N.t('Reabrindo o app para voltar ao ponto salvo...'), 8000); return window.studioApp.reiniciar(); }
  aviso(I18N.t('Restauração marcada. Feche o programa e abra de novo para voltar ao ponto salvo.'), 12000);
}

document.addEventListener('keydown', async (ev) => {
  const t = ev.target;
  if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 's') { ev.preventDefault(); return salvarProjeto(); }
  if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'k') { ev.preventDefault(); return abrirTroca(); }
  if (ev.key === 'Enter' && t.matches('[data-pcard-falar]') && t.value.trim()) {
    ev.preventDefault(); const id = t.dataset.pcardFalar, texto = t.value.trim(); fecharCartao(); irPara('chat', `dm:${id}`);
    await api('POST', P('/mensagem'), { canal: `dm:${id}`, texto, engine: E.config.engine, modo: E.config.modo }); return;
  }
  if (ev.key === 'Escape' && ($('#sel-menu') || $('#emoji-pop'))) return fecharPops();
  if (ev.key === 'Escape' && $('#ctx-menu')) return fecharCtx();
  if (ev.key === 'Escape' && $('#recorte')) return $('#recorte').remove();
  if (ev.key === 'Escape' && $('#pcard-pop')) return fecharCartao();
  if (ev.key === 'Escape' && !$('#modal').hidden) return fecharModal();
  if (ev.key === 'Enter' && t.matches('[data-regra-nova]')) { ev.preventDefault(); return adicionarRegra(t.dataset.regraNova); }
  if (U.troca && t.id === 'troca-q') {
    const n = (U.troca.itens || []).length;
    if (ev.key === 'ArrowDown') { ev.preventDefault(); U.troca.sel = (U.troca.sel + 1) % Math.max(1, n); return renderTroca(); }
    if (ev.key === 'ArrowUp') { ev.preventDefault(); U.troca.sel = (U.troca.sel - 1 + n) % Math.max(1, n); return renderTroca(); }
    if (ev.key === 'Enter') { ev.preventDefault(); return irTroca(U.troca.sel); }
  }
  if (t.id === 'texto') {
    const box = $('#sugestoes');
    if (!box.hidden && box._lista) {
      if (ev.key === 'ArrowDown') { ev.preventDefault(); sugSel = (sugSel + 1) % box._lista.length; return sugestoes(); }
      if (ev.key === 'ArrowUp') { ev.preventDefault(); sugSel = (sugSel - 1 + box._lista.length) % box._lista.length; return sugestoes(); }
      if (ev.key === 'Enter' || ev.key === 'Tab') { ev.preventDefault(); return inserirMencao(box._lista[sugSel].id); }
    }
    if (ev.key === 'Enter' && !ev.shiftKey && !ev.isComposing) { ev.preventDefault(); return enviar(); }
  }
  if (t.matches('[data-post-resp]') && ev.key === 'Enter' && !ev.isComposing && t.value.trim()) {
    ev.preventDefault();
    const pt = (J().posts || []).find((x) => x.id === t.dataset.postResp); const texto = t.value.trim();
    if (!pt) return;
    t.value = ''; (U.postsAbertos ||= new Set()).add(pt.id);
    if (!J().canais[pt.canal]) J().canais[pt.canal] = await (await fetch(P(`/canal/${pt.canal}`))).json().catch(() => []);
    await api('POST', P('/mensagem'), { canal: pt.canal, texto, engine: E.config.engine, modo: E.config.modo });
    return;
  }
  if (t.matches('[data-resp-livre]') && ev.key === 'Enter' && t.value.trim()) {
    ev.preventDefault();
    const texto = t.value.trim(); t.value = '';
    if (await responderPergunta(t.dataset.proj, t.dataset.respLivre, texto)) modalInbox();
    return;
  }
  if (t.matches('[data-novo-aceite]') && ev.key === 'Enter' && t.value.trim()) {
    const c = cartao(U.issue); const v = t.value.trim(); t.value = '';
    return patchCard({ aceite: [...c.aceite, { t: v, ok: false }] });
  }
  if (t.matches('[data-comentario]') && ev.key === 'Enter' && !ev.shiftKey && t.value.trim()) {
    ev.preventDefault();
    const texto = t.value.trim(); t.value = '';
    const r = await api('POST', P(`/cartao/${U.issue}/comentar`), { texto });
    if (!r._ok) aviso(r.erro); else if ((r.chamados || []).length) aviso(I18N.t('{quem} vai responder aqui no card.', { quem: r.chamados.map(nomeAgente).join(' e ') }));
  }
  if (t.id === 'i-titulo' && ev.key === 'Enter') { ev.preventDefault(); t.blur(); }
});

// arrastar arquivos para o chat e colar imagem da área de transferência
const temArquivos = (ev) => [...(ev.dataTransfer?.types || [])].includes('Files');
document.addEventListener('dragover', (ev) => { if (temArquivos(ev) && $('#anexos-pend')) { ev.preventDefault(); $('.compositor')?.classList.add('soltar'); } });
document.addEventListener('dragleave', (ev) => { if (!ev.relatedTarget) $('.compositor')?.classList.remove('soltar'); });
document.addEventListener('drop', (ev) => {
  $('.compositor')?.classList.remove('soltar');
  if (temArquivos(ev) && $('#anexos-pend')) { ev.preventDefault(); anexarArquivos(ev.dataTransfer.files); }
});
document.addEventListener('paste', (ev) => {
  if (ev.target.id !== 'texto') return;
  const arqs = [...(ev.clipboardData?.files || [])];
  if (arqs.length) { ev.preventDefault(); anexarArquivos(arqs); }
});

document.addEventListener('input', (ev) => {
  if (U.ped && ev.target.closest('#ped-perfil')) {
    const t = ev.target, e = U.ped.estilo;
    if (t.id === 'pf-nome') U.ped.nome = t.value;
    else if (t.id === 'ped-t1' || t.id === 'ped-t2') e.tema = { c1: $('#ped-t1').value, c2: $('#ped-t2').value };
    else if (t.id === 'ped-n1' || t.id === 'ped-n2') e.nome = { ...(e.nome || {}), c1: $('#ped-n1').value, c2: $('#ped-n2').value };
    else if (t.id === 'ped-corcapa') e.corCapa = t.value;
    else if (t.id === 'ped-bio') e.bio = t.value;
    else return;
    if (t.id === 'ped-n1' || t.id === 'ped-n2' || t.id === 'pf-nome') pedRedesenharNomes();
    return pedPrev();
  }
  const t = ev.target;
  if (t.id === 'texto') { autoAltura(t); sugSel = 0; sugestoes(); U.rascunhos[`${U.proj}/${U.canal}`] = t.value; }
  if (t.id === 'busca') {
    U.busca = t.value; renderConteudoPlanner();
    const lk = $('.link-limpar'); if (lk) lk.hidden = !(U.filtro.size || U.soBloq || U.busca);
  }
  if (t.id === 'mem-busca') { U.memBusca = t.value; const pos = t.selectionStart; desenharMemoria(); const n = $('#mem-busca'); if (n) { n.focus(); n.setSelectionRange(pos, pos); } }
  if (t.id === 'troca-q') { U.troca.q = t.value; U.troca.sel = 0; renderTroca(); }
  if (t.id === 'i-titulo') { t.style.height = 'auto'; t.style.height = `${t.scrollHeight}px`; }
});

/* arrastar e soltar no quadro */
let arrastando = null;
document.addEventListener('dragstart', (ev) => {
  const c = ev.target.closest?.('.card');
  if (!c) return;
  arrastando = c.dataset.id; c.classList.add('arrastando');
  ev.dataTransfer.effectAllowed = 'move'; ev.dataTransfer.setData('text/plain', arrastando);
});
const limparAlvos = () => $$('.coluna.alvo').forEach((c) => c.classList.remove('alvo', 'cheia'));
document.addEventListener('dragend', () => { arrastando = null; $$('.card.arrastando').forEach((c) => c.classList.remove('arrastando')); limparAlvos(); });
document.addEventListener('dragover', (ev) => {
  const col = ev.target.closest?.('.coluna');
  if (!col || !arrastando) return;
  ev.preventDefault();
  $$('.coluna.alvo').forEach((c) => { if (c !== col) c.classList.remove('alvo', 'cheia'); });
  col.classList.add('alvo');
  const w = J().wip[col.dataset.col] || {}; const c = cartao(arrastando);
  col.classList.toggle('cheia', !!(w.limite && w.n >= w.limite && c && c.coluna !== col.dataset.col));
});
document.addEventListener('drop', (ev) => {
  const col = ev.target.closest?.('.coluna');
  if (!col || !arrastando) return;
  ev.preventDefault();
  const id = arrastando; limparAlvos();
  moverCard(id, col.dataset.col);
});

setInterval(() => { $$('[data-desde]').forEach((el) => { const d = Number(el.dataset.desde); if (d) el.textContent = mmss(Date.now() - d); }); }, 1000);

let conectou = false;
// O navegador pode conservar o stream SSE durante uma interrupção curta.
// A volta da rede precisa reconciliar mesmo sem um novo onopen.
window.addEventListener('online', async () => {
  try {
    await recarregarApp();
    await Promise.all(todasEquipes().map(e => carregarProjeto(e.cid)));
    rotear();
  } catch (err) { console.error('Reconciliação após reconexão:', err); }
});
function conectar() {
  const es = new EventSource('/api/eventos');
  es.onopen = async () => {
    if (conectou) {
      await recarregarApp();
      for (const e of todasEquipes()) { if (PJ[e.cid]) PJ[e.cid].canais = {}; await carregarProjeto(e.cid); }
      rotear();
    }else await Promise.all(todasEquipes().map(e=>carregarProjeto(e.cid)));
    conectou = true;
  };
  es.onmessage = (ev) => {
    const e = JSON.parse(ev.data);
    if (U.vista === 'colmeia') { try { colmeiaEvento(e); } catch { /* a colmeia é só visual */ } }
    switch (e.tipo) {
      case 'teamwork': {
        const j=PJ[e.projeto];if(!j)return;
        depois('teamwork-'+e.projeto,async()=>{const r=await fetch(`/api/p/${encodeURIComponent(e.projeto)}/teamwork`).then(x=>x.json()).catch(()=>null);if(r&&r.revision>=(j.teamwork?.revision||0))j.teamwork=r;});
        return;
      }
      case 'msg': return addMsg(e.projeto, e.msg);
      case 'msg.upd': return updMsg(e.projeto, e.msg);
      case 'delta': return deltaMsg(e);
      case 'presenca': return presencaMudou(e);
      case 'quadro': return quadroMudou(e.projeto);
      case 'fatos': { const j = PJ[e.projeto]; if (j) { j.fatos = e.fatos; if (e.projeto === U.proj && U.issue) depois('issue', () => renderIssue()); } return; }
      case 'custos': { const j = PJ[e.projeto]; if (j) { j.custos = e.custos; if (e.projeto === U.proj && U.issue) depois('issue', () => renderIssue()); } return; }
      case 'posts': { const j = PJ[e.projeto]; if (j) { const vistos = new Set((j.posts || []).map((p) => p.id)); const novos = e.posts.filter((p) => !vistos.has(p.id)).length; j.posts = e.posts; if (e.projeto === U.proj && U.vista === 'chat' && U.canal === 'posts') renderPostsSuave(); else if (novos) { j.naoLidas.posts = (j.naoLidas.posts || 0) + novos; if (e.projeto === U.proj) renderLista(); renderRail(); } } return; }
      case 'grupos': { const j = PJ[e.projeto]; if (j) { j.grupos = e.grupos; if (e.projeto === U.proj) { renderLista(); if (U.vista === 'chat' && String(U.canal).startsWith('grp-')) renderChat(); } } return; }
      case 'planning': { const j = PJ[e.projeto]; if (j) { j.planning = e.planning; if (e.projeto === U.proj) { renderLista(); if (U.vista === 'chat' && String(U.canal).startsWith('plan-')) renderChat(); } } return; }
      case 'motores': { const j = PJ[e.projeto]; if (j) { j.motores = e.motores; if (e.projeto === U.proj && U.vista === 'chat') renderMembros(); } return; }
      case 'uso': E.uso = e.uso; E.pausas = e.pausas || E.pausas; if (U.proj && U.vista === 'chat') renderMembros(); return;
      case 'pausa': E.pausas = e.pausas || {}; if (U.proj && U.vista === 'chat') renderMembros(); return;
      case 'integracoes': { const j = PJ[e.projeto]; if (j) { j.integ = e.integracoes; if (e.projeto === U.proj && U.vista === 'chat') renderMembros(); if (U.demandas) modalDemandas(); } return; }
      case 'notif': return notifChegou(e);
      case 'notif.lidas': { const j = PJ[e.projeto]; if (j) { j.naoLidasN = e.naoLidas; renderRail(); atualizarTitulo(); } return; }
      case 'elenco': {
        const j = PJ[e.projeto]; if (j) { j.roster = e.roster; if (e.usuario) j.usuario = e.usuario; }
        // as outras equipes mostram esta gente como colega externo: o perfil novo vale lá também, sem recarregar
        let aqui = e.projeto === U.proj;
        for (const [cid, o] of Object.entries(PJ)) for (const x of o.externos || []) { if (x.cid !== e.projeto) continue; const a = e.roster.find((r) => r.id === x.agente); if (a) { Object.assign(x, { nome: a.nome, foto: a.foto || null, capa: a.capa || null, estilo: a.estilo || {} }); if (cid === U.proj) aqui = true; } }
        if (aqui) renderTudo(); return;
      }
      case 'pergunta': return perguntaNova(e);
      case 'pergunta.upd': return perguntaAtualizada(e);
      case 'bastidor': { const j = PJ[e.projeto]; if (j) { j.bastidores.push(e.bastidor); if (j.bastidores.length > 300) j.bastidores.splice(0, j.bastidores.length - 300); if (e.projeto === U.proj && U.vista === 'chat' && U.canal === 'bastidores') depois('bastidores', () => { if (U.canal === 'bastidores' && $('#mensagens')) $('#mensagens').innerHTML = bastidoresHtml(); }); } return; }
      case 'memoria': if (e.projeto === U.proj && U.vista === 'memoria') { clearTimeout(timersQuadro.mem); timersQuadro.mem = setTimeout(renderMemoria, 200); } return;
      case 'registro': { const j = PJ[e.projeto]; if (j?.registro) j.registro.total = Math.max(0, (j.registro.total || 0) + (e.removida ? -1 : 0)); if (e.projeto === U.proj && U.vista === 'registro') { clearTimeout(timersQuadro.reg); timersQuadro.reg = setTimeout(() => renderRegistro(false), 150); } if (U.issue) depois('issue', () => renderIssue()); return; }
      case 'conexoes': if (!$('#modal').hidden && U.ajuste === 'integracoes' && $('[data-conexao]')) modalAjustes(); return;
      case 'contas': if (!$('#modal').hidden && U.ajuste === 'motores' && $('.conta')) modalAjustes(); return;
      case 'conversas': { const j = PJ[e.projeto]; if (j) { j.arquivadas = e.arquivadas; if (e.projeto === U.proj) renderLista(); } return; }
      case 'conversa.excluida': { const j = PJ[e.projeto]; if (j) { delete j.canais[e.canal]; j.arquivadas = e.arquivadas; if (e.projeto === U.proj) { if (U.canal === e.canal) irPara('chat', 'equipe'); else renderLista(); } } return; }
      case 'voz': return vozEvento(e);
      case 'canal.limpo': { const j = PJ[e.projeto]; if (j) j.canais[e.canal] = []; if (naTela(e.projeto, e.canal)) renderChat(); return; }
      case 'agenda': if (U.proj && baseDe(e.projeto) === baseDe(U.proj) && U.vista === 'agenda') carregarAgenda(); return;
      case 'iniciativas': { const j = PJ[e.projeto]; if (j) { j.iniciativasResumo = { aguardandoVoce: (e.iniciativas || []).filter((i) => ['proposed', 'waiting_approval'].includes(i.estado)).length }; if (e.projeto === U.proj) { if (U.vista === 'chat') renderMembros(); if (U.iniAberto && !$('#modal').hidden && $('.ini')) modalIniciativas(); } } return; }
      default:
    }
  };
}

(async function iniciar() {
  $('#marca-mini').innerHTML = logo(16);
  await recarregarApp();
  $('.nome-app').innerHTML = E.marca.sufixo ? `${esc(E.marca.nome)}${E.marca.nome.endsWith('.') ? '' : ' '}<b>${esc(E.marca.sufixo)}</b>` : `<img class="logo-nome" src="/marca/nectar-logo.png" alt="${esc(E.marca.nome)}" draggable="false">`;
  atualizarTitulo();
  aplicarPiloto();
  pingAtividade();
  await Promise.all(todasEquipes().map((e) => carregarProjeto(e.cid)));
  window.addEventListener('hashchange', rotear);
  await rotear();
  conectar();
}());

// Apontar ficha do registro no card aberto: quem pega o card recebe a ficha inteira.
document.addEventListener('change', (ev) => {
  const s = ev.target.closest?.('[data-ctx-add]'); if (!s || !U.issue || !s.value) return;
  patchCard({ contexto: [...(cartao(U.issue)?.contexto || []), s.value] });
});
