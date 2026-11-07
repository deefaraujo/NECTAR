// Work the app does on its own, without a model: finding stalled cards, answering simple questions about the board,
// blocking what the project rules forbid, and linking commits to cards. Everything here is pure logic over data the app already has.
import fs from 'node:fs';
import path from 'node:path';
import { ler } from './store.mjs';

const semAcento = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// ---- stalled card, no owner, no estimate, queue overflow ------------------------------------------
export const LIMITES_HORAS = { andamento: 12, revisao: 6, qa: 6, impedimento: 24, pronto: 48, aguardando: 4 };
const NOME_COL = { andamento: 'Em andamento', revisao: 'Revisão', qa: 'Testes (QA)', impedimento: 'Impedimento', pronto: 'Pronto' };

/** Returns [{ chave, nivel, card, texto }]. The key changes when the problem changes, so the warning is not repeated. */
export function analisarQuadro({ cards, wip = {}, agora = Date.now(), limites = LIMITES_HORAS, nomeDe = (x) => x }) {
  const out = [];
  const horas = (iso) => (iso ? (agora - Date.parse(iso)) / 3_600_000 : 0);
  for (const c of cards) {
    if (c.arquivado || c.coluna === 'concluido') continue;
    const quem = c.dono ? `com ${nomeDe(c.dono)}` : 'sem dono';
    if (c.aguardando) {
      const h = horas(c.atualizado);
      if (h >= limites.aguardando) out.push({ chave: `aguardando:${c.id}:${Math.floor(h / limites.aguardando)}`, nivel: 'atencao', card: c.id, texto: `${c.id} espera uma resposta sua há ${Math.floor(h)} h: ${c.titulo}` });
      continue;
    }
    if (c.bloqueio && c.bloqueioPor === 'voce') continue; // deliberately parked by the Game Director: not a team problem
    const lim = limites[c.coluna];
    const h = horas(c.naColunaDesde || c.atualizado);
    if (lim && h >= lim && NOME_COL[c.coluna]) {
      const tipo = c.coluna === 'impedimento' ? `impedido há ${Math.floor(h)} h (${c.bloqueio || 'sem motivo registrado'})` : `parado em ${NOME_COL[c.coluna]} há ${Math.floor(h)} h`;
      out.push({ chave: `parado:${c.id}:${c.coluna}:${Math.floor(h / lim)}`, nivel: c.coluna === 'impedimento' ? 'atencao' : 'info', card: c.id, texto: `${c.id} ${tipo}, ${quem}: ${c.titulo}` });
    }
    if (['pronto', 'andamento'].includes(c.coluna)) {
      if (!c.dono) out.push({ chave: `semdono:${c.id}`, nivel: 'atencao', card: c.id, texto: `${c.id} está em ${NOME_COL[c.coluna]} sem dono: ${c.titulo}` });
      if (!c.pontos) out.push({ chave: `sempontos:${c.id}`, nivel: 'info', card: c.id, texto: `${c.id} está em ${NOME_COL[c.coluna]} sem estimativa de pontos: ${c.titulo}` });
      if (!c.aceite?.length) out.push({ chave: `semaceite:${c.id}`, nivel: 'info', card: c.id, texto: `${c.id} está em ${NOME_COL[c.coluna]} sem critério de aceite: ${c.titulo}` });
    }
  }
  for (const [col, lim] of Object.entries(wip)) {
    const n = cards.filter((c) => !c.arquivado && c.coluna === col && !c.bloqueio && !c.aguardando).length;
    if (lim && n > lim) out.push({ chave: `wip:${col}:${n}`, nivel: 'atencao', card: null, texto: `${NOME_COL[col] || col} passou do limite de trabalho: ${n} cards para limite ${lim}` });
  }
  return out;
}

// ---- simple questions answered straight from the board -------------------------------------------------
/** Returns the answer text or null if the question is not one of the simple ones. Only applies to short messages. */
export function responderSimples(texto, { cards, progresso, nomeDe = (x) => x, carga = '', vigia = '' }) {
  const t = semAcento(texto).replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!t || t.length > 70 || /\b(faca|crie|abra|mova|implemente|corrija|escreva|mude)\b/.test(t)) return null;
  // a request for a summary, detail, history or explanation is a real conversation: it goes to the agent, not to the board shortcut
  if (/\b(detalh|ultim|feit|tarefa|explic|conte|me fal|por que|porque|resumo)/.test(t)) return null;
  const abertos = cards.filter((c) => !c.arquivado && c.coluna !== 'concluido');
  const lin = (c) => `- ${c.id} ${c.titulo}${c.dono ? ` (${nomeDe(c.dono)})` : ''}`;
  if (/\b(como (esta|estamos|anda|andam)|status|andamento)\b/.test(t) && !/\bcard\b/.test(t)) {
    const em = abertos.filter((c) => ['andamento', 'revisao', 'qa'].includes(c.coluna));
    return `${progresso}\n${em.length ? `Em curso:\n${em.map((c) => `${lin(c)} [${c.coluna === 'qa' ? 'Testes' : c.coluna === 'revisao' ? 'Revisão' : 'Em andamento'}]`).join('\n')}` : 'Nada em curso agora.'}`;
  }
  if (/\b(bloquead|travad|impedid|impedimento|bloqueio)/.test(t)) {
    const b = abertos.filter((c) => c.bloqueio || c.aguardando);
    return b.length ? `Impedimentos:\n${b.map((c) => `${lin(c)}: ${c.bloqueio || 'aguardando você'}`).join('\n')}` : 'Nenhum card bloqueado ou esperando você.';
  }
  if (/\b(quem (esta|ta) fazendo|quem faz o que|carga|distribuicao)\b/.test(t)) return carga || 'Sem carga para mostrar.';
  if (/\b(o que falta|pendente|pendencias|proximos)\b/.test(t)) {
    const f = abertos.filter((c) => ['backlog', 'pronto'].includes(c.coluna)).slice(0, 8);
    return f.length ? `A fazer (${f.length} primeiros):\n${f.map(lin).join('\n')}` : 'Nada na fila de espera.';
  }
  if (/\b(repositorio|repositorios|repos|commits)\b/.test(t) && vigia) return vigia;
  return null;
}

// ---- project barriers (e.g. no Docker) ---------------------------------------------------------
export function lerBarreiras(pasta) {
  const lista = ler(path.join(pasta, 'barreiras.json'), []);
  return (Array.isArray(lista) ? lista : []).map((b) => {
    let re = null;
    try { re = new RegExp(b.padrao, 'i'); } catch { /* invalid pattern: ignore */ }
    return re ? { id: String(b.id || 'barreira'), re, motivo: String(b.motivo || ''), } : null;
  }).filter(Boolean);
}
export const bater = (barreiras, texto) => barreiras.find((b) => b.re.test(String(texto || ''))) || null;

/** A verification that failed because of a barrier (e.g. needs Docker) becomes "not run", without blocking the flow. */
export function rebaixarVerificacao(barreiras, v) {
  if (!v || !['falhou', 'nao_executado'].includes(v.status)) return v;
  const b = bater(barreiras, `${v.comando} ${v.evidencia}`);
  if (!b || (v.status === 'nao_executado' && !v.obrigatoria)) return v;
  return b ? { ...v, status: 'nao_executado', obrigatoria: false, evidencia: `${v.evidencia} [barreira do projeto ${b.id}: ${b.motivo} Registrada como não executada.]`.slice(0, 1900) } : v;
}

// ---- commit to card -------------------------------------------------------------------------------
/** Cards mentioned in a text (branch or commit subject) by card id or Jira key. */
export function cardsCitados(texto, cards) {
  const t = String(texto || '').toUpperCase();
  return cards.filter((c) => !c.arquivado && ((c.id && new RegExp(`(^|[^A-Z0-9])${c.id.toUpperCase()}([^0-9]|$)`).test(t)) || (c.jira && t.includes(String(c.jira).toUpperCase())))).map((c) => c.id);
}

// ---- memory: identical notes ----------------------------------------------------------------------
/** [keep, archive] pairs of notes with the same content (without the date header). Exact duplicates only. */
export function duplicatasExatas(dir, notas) {
  const vistas = new Map(); const pares = [];
  const corpo = (rel) => { try { return fs.readFileSync(path.join(dir, rel), 'utf8').replace(/^---[\s\S]*?---\s*/, '').trim(); } catch { return ''; } };
  for (const n of [...notas].sort((a, b) => String(a.data).localeCompare(String(b.data)))) {
    const c = corpo(n.caminho);
    if (c.length < 40) continue;
    const k = semAcento(c).replace(/\s+/g, ' ');
    if (vistas.has(k)) pares.push([vistas.get(k), n.caminho]); else vistas.set(k, n.caminho);
  }
  return pares;
}

// ---- similar titles (so we neither recreate what was canceled nor duplicate what already exists) ----------
const PARADAS = new Set(['para', 'com', 'sem', 'uma', 'umas', 'uns', 'dos', 'das', 'que', 'por', 'como', 'ser', 'nos', 'nas', 'pelo', 'pela', 'seu', 'sua', 'este', 'esta', 'esse', 'essa', 'ate', 'sobre', 'entre']);
const tokensDe = (t) => new Set(semAcento(t).replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter((x) => x.length > 2 && !PARADAS.has(x)));
/** Do two titles describe the same task? Equality, one contained in the other, or many words in common. */
export function parecido(a, b, limite = 0.6) {
  const x = semAcento(a).replace(/\s+/g, ' ').trim(), y = semAcento(b).replace(/\s+/g, ' ').trim();
  if (!x || !y) return false;
  if (x === y || (Math.min(x.length, y.length) >= 18 && (x.includes(y) || y.includes(x)))) return true;
  const A = tokensDe(a), B = tokensDe(b);
  if (A.size < 2 || B.size < 2) return false;
  let comum = 0; for (const t of A) if (B.has(t)) comum++;
  return comum / (A.size + B.size - comum) >= limite;
}

/** How similar two texts are (0 to 1), by words in common. Texts that are too short are not compared. */
export function similaridade(a, b) {
  const A = tokensDe(a), B = tokensDe(b);
  if (A.size < 3 || B.size < 3) return 0;
  let c = 0; for (const t of A) if (B.has(t)) c++;
  return c / (A.size + B.size - c);
}

// ---- agents looping or stuck: signals the app sees on its own (no model) ----------------------------
// despachos: [{ card, agente, tipo, status, tentativas, em, fim }]; msgs: recent messages from all channels;
// presenca: { agente: { estado, desde } }. Each signal goes to the lead, who asks, evaluates and decides.
export function analisarAgentes({ despachos = [], msgs = [], cards = [], presenca = {}, agora = Date.now(), nomeDe = (x) => x, ignorar = [] }) {
  const out = [];
  const card = (id) => cards.find((c) => c.id === id);
  const aberto = (id) => { const c = card(id); return c && !c.arquivado && c.coluna !== 'concluido' && c.bloqueioPor !== 'voce'; };
  const recente = (iso, h) => iso && agora - Date.parse(iso) < h * 3_600_000;
  // (1) the app gave up calling: 3 attempts on the same card and stage without getting anywhere
  for (const d of despachos) {
    if ((d.tentativas || 0) >= 3 && d.status !== 'rodando' && aberto(d.card) && !ignorar.includes(d.agente))
      out.push({ chave: `loop:${d.agente}:${d.card}:${d.tipo}`, tipo: 'loop', nivel: 'atencao', agente: d.agente, card: d.card, texto: `${nomeDe(d.agente)} tentou ${d.tentativas} vezes a etapa "${d.tipo}" do card ${d.card} e não saiu do lugar (última: ${d.status}). O app parou de chamar.` });
  }
  const porAgente = new Map();
  for (const m of msgs) if (m.de && m.de !== 'voce' && m.de !== 'sistema' && !ignorar.includes(m.de) && recente(m.em, 3)) (porAgente.get(m.de) || porAgente.set(m.de, []).get(m.de)).push(m);
  for (const [ag, l] of porAgente) {
    // (2) the same error again and again
    const erros = l.filter((m) => m.status === 'erro');
    if (erros.length >= 3) out.push({ chave: `erros:${ag}:${Math.floor(erros.length / 3)}`, tipo: 'erros', nivel: 'atencao', agente: ag, card: erros.at(-1).card || null, texto: `${nomeDe(ag)} falhou ${erros.length} vezes nas últimas 3 h. Último erro: ${String(erros.at(-1).texto || '').replace(/\s+/g, ' ').slice(0, 160)}` });
    // (3) saying the same thing about the same card (going in circles)
    const porCard = new Map();
    for (const m of l.filter((x) => x.status === 'ok' && (x.texto || '').length > 40)) (porCard.get(m.card || '-') || porCard.set(m.card || '-', []).get(m.card || '-')).push(m);
    for (const [cid, ms] of porCard) {
      const ult = ms.slice(-4); let pares = 0;
      for (let i = 1; i < ult.length; i++) if (similaridade(ult[i - 1].texto, ult[i].texto) >= 0.7) pares++;
      if (pares >= 2) out.push({ chave: `repete:${ag}:${cid}:${ult.at(-1).id}`, tipo: 'repetindo', nivel: 'atencao', agente: ag, card: cid === '-' ? null : cid, texto: `${nomeDe(ag)} está dizendo quase a mesma coisa de novo${cid === '-' ? '' : ` sobre o card ${cid}`}: sinal de que está andando em círculo.` });
    }
  }
  // (4) a card that keeps coming back from review or QA
  for (const c of cards) {
    const rev = c.workflow?.revisao || 0;
    if (rev >= 3 && aberto(c.id) && !ignorar.includes(c.dono)) out.push({ chave: `retrabalho:${c.id}:${rev}`, tipo: 'retrabalho', nivel: 'atencao', agente: c.dono || null, card: c.id, texto: `${c.id} já está na entrega ${rev}: voltou da revisão ou do QA várias vezes${c.dono ? ` com ${nomeDe(c.dono)}` : ''}.` });
  }
  // (5) working too long on a single call
  for (const [ag, p] of Object.entries(presenca)) {
    const min = p?.estado === 'trabalhando' && p.desde ? (agora - p.desde) / 60_000 : 0;
    if (min >= 45 && !ignorar.includes(ag)) out.push({ chave: `longo:${ag}:${p.desde}`, tipo: 'longo', nivel: 'info', agente: ag, card: p.card || null, texto: `${nomeDe(ag)} está numa mesma chamada há ${Math.round(min)} min.` });
  }
  return out;
}

// ---- autopilot: stalled call and wait between unblocking meetings ------------------------------------------
/** A round (turn) with no activity for `limiteMs` is stuck: the autopilot cannot wait for it forever. */
export const turnoParado = (turno, agora, limiteMs) => agora - Math.max(Number(String(turno.id || '').slice(1)) || 0, turno.vivo || 0) > limiteMs;
/** Minutes between one unblocking meeting and the next for the same card. The wait grows with each round without progress; with the rest of the
 *  board idle it is halved (never below 2 min), but it never becomes "one meeting per minute": each meeting is a model
 *  call, and 39 meetings in one hour for the same blocker is exactly what happened on Nov 1. After the 4th round the decision
 *  belongs to the Game Director (the card moves to waiting), and the meetings stop. */
const ESPERA_REUNIAO_MIN = [0, 5, 15, 30, 60, 120];
export const esperaReuniaoMs = (n, quadroParado = false) => { const base = ESPERA_REUNIAO_MIN[n] ?? 240; return (quadroParado ? Math.max(2, base / 2) : base) * 60_000; };
export const REUNIOES_ATE_PERGUNTAR = 4;
