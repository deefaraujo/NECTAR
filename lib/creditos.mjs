// Account credit usage (Claude Code's "Account & Usage" panel).
// Claude Code itself reports usage on every call, in the `rate_limit_event` of the output stream:
// the 5-hour window and the weekly one, as a fraction from 0 to 1. So monitoring costs no model
// call: the app only reads what already comes for free and warns when it crosses 50%, 75% and 90%.
// Codex: account/rateLimits/read, queried without a model call.
import { ler, gravar, lerConfig } from './store.mjs';

export const FAIXAS = [50, 75, 90];
const NOME_JANELA = { cinco: 'a sessão de 5 horas', sete: 'a semana' };
const DE_EVENTO = { five_hour: 'cinco', seven_day: 'sete' };

let estado = ler('uso.json', { atual: null, avisos: {}, gasto: {}, pausa: {} });
if (!estado.pausa) estado.pausa = {};
const ouvintes = new Set();
const salvar = () => gravar('uso.json', estado);

export const aoMudar = (fn) => { ouvintes.add(fn); return () => ouvintes.delete(fn); };

export function registrarCodex(info) {
  const bucket = info?.rateLimitsByLimitId?.codex || info?.rateLimits;
  if (!bucket) return false;
  const a = { em: new Date().toISOString() };
  for (const [key, w] of Object.entries({ cinco: bucket.primary, sete: bucket.secondary })) {
    if (Number.isFinite(w?.usedPercent)) a[key] = { pct: Math.max(0, Math.min(100, w.usedPercent)), resetsAt: w.resetsAt || null, minutos: w.windowDurationMins || null };
  }
  if (!a.cinco && !a.sete) return false;
  estado.codex = a;
  amostrar('codex', a);
  salvar();
  for (const f of ouvintes) { try { f(atual()); } catch {} }
  avaliar('codex');
  return true;
}

/** Receives the `rate_limit_info` from a Claude Code event. */
export function registrar(info) {
  if (!info || typeof info !== 'object') return;
  // (the local variable cannot be named `atual`: it shadowed the atual() function and notifying listeners failed every time, silently)
  const agora = new Date().toISOString();
  const leitura = { ...(estado.atual || {}) };
  let mudou = false;
  const janelas = info.unifiedWindows || {};
  for (const [k, j] of Object.entries(janelas)) {
    const nome = DE_EVENTO[k];
    if (nome && typeof j?.utilization === 'number') { leitura[nome] = { pct: Math.round(j.utilization * 100), resetsAt: j.resetsAt || null, lido: agora }; mudou = true; }
  }
  const nome = DE_EVENTO[info.rateLimitType === 'five_hour' ? 'five_hour' : info.rateLimitType === 'seven_day' ? 'seven_day' : ''];
  if (nome && typeof info.utilization === 'number' && !janelas[info.rateLimitType]) { leitura[nome] = { pct: Math.round(info.utilization * 100), resetsAt: info.resetsAt || null, lido: agora }; mudou = true; }
  // Claude Code only reports the account's most "representative" limit. With extra credits, today that limit is of type "overage":
  // the extra credits (usage beyond the plan), with the percentage already spent and when they renew.
  if (info.rateLimitType === 'overage' && typeof info.utilization === 'number') {
    leitura.extra = { pct: Math.round(info.utilization * 100), resetsAt: info.overageResetsAt || info.resetsAt || null, emUso: !!info.isUsingOverage || info.status === 'rejected', status: info.status || null, lido: agora };
    mudou = true;
  }
  if (!mudou) return; // an event without a number does not pretend to be a new reading
  leitura.em = agora;
  estado.atual = leitura;
  amostrar('claude', estado.atual);
  if (info.status === 'rejected') {
    const j = DE_EVENTO[info.rateLimitType]; if (j && estado.atual[j]) estado.atual[j].pct = Math.max(estado.atual[j].pct, 100);
    if (info.rateLimitType === 'overage' && estado.atual.extra) estado.atual.extra.pct = 100;
  }
  salvar();
  for (const f of ouvintes) { try { f(atual()); } catch { /* a faulty listener does not bring the app down */ } }
  avaliar();
}

// ---- end of the workday: the usage limit pauses the agents; when it renews, they come back -------------------
// Everything here is reading numbers and the clock. No model calls.
const eventos = new Set();
export const aoEvento = (fn) => { eventos.add(fn); return () => eventos.delete(fn); };
const avisar = (e) => { for (const f of eventos) { try { f(e); } catch { /* a faulty listener does not bring the app down */ } } };
const timers = {};
const agoraS = () => Math.floor(Date.now() / 1000);

export function pausado(engine) {
  const p = estado.pausa?.[engine];
  if (!p) return false;
  if (p.ate > agoraS()) return true;
  expirou(engine);
  return false;
}
export const pausas = () => Object.fromEntries(Object.entries(estado.pausa || {}).filter(([e]) => pausado(e)));

function armar(engine) {
  clearTimeout(timers[engine]);
  const p = estado.pausa?.[engine];
  if (!p) return;
  const ms = Math.min(2 ** 31 - 1, Math.max(1000, (p.ate - agoraS()) * 1000 + 3000));
  timers[engine] = setTimeout(() => expirou(engine), ms);
  timers[engine].unref?.();
}

function expirou(engine) {
  const p = estado.pausa?.[engine];
  if (!p) return;
  if (p.ate > agoraS()) { armar(engine); return; }
  // expired windows went back to zero; the next response brings the real reading
  const a = porMotor(engine);
  if (a) {
    for (const j of ['cinco', 'sete']) { const w = a[j]; if (w?.resetsAt && w.resetsAt <= agoraS()) a[j] = { ...w, pct: 0, estimado: true }; }
  }
  retomar(engine);
}

export function pausar(engine, ate, motivo) {
  const ja = !!estado.pausa?.[engine] && estado.pausa[engine].ate > agoraS();
  estado.pausa[engine] = { ate, motivo, desde: new Date().toISOString() };
  salvar();
  armar(engine);
  avisar({ tipo: ja ? 'mudou' : 'pausou', engine, ate, motivo });
}

export function retomar(engine) {
  if (!estado.pausa?.[engine]) return;
  delete estado.pausa[engine];
  salvar();
  clearTimeout(timers[engine]);
  avisar({ tipo: 'retomou', engine });
}

function avaliar(engine = 'claude') {
  const a = porMotor(engine);
  if (!a) return;
  const limite = lerConfig().creditos.pararEm;
  const acima = ['cinco', 'sete', ...(a.extra?.emUso ? ['extra'] : [])].filter((j) => a[j] && a[j].pct >= limite);
  if (acima.length) {
    const ate = Math.max(...acima.map((j) => a[j].resetsAt || agoraS() + 1800));
    if (ate <= agoraS()) { if (estado.pausa[engine]) retomar(engine); return; }   // stale reading of a window that has already renewed: do not pause with a time in the past
    const nomes = acima.map((j) => (j === 'cinco' ? 'a sessão de 5 horas' : j === 'extra' ? 'os créditos extras' : 'a semana')).join(' e ');
    pausar(engine, ate, `${nomes} chegou a ${Math.max(...acima.map((j) => a[j].pct))}% do uso`);
  } else if (estado.pausa[engine]) retomar(engine);
}

/** Reads an agent's error message: if it is "limit reached", pauses that engine. Returns true if it paused. */
export function limiteNoErro(engine, texto) {
  const t = String(texto || '');
  if (!/usage limit|out of usage|usage credits|limit reached|rate.?limit|quota|you['’]ve hit|exceeded your/i.test(t)) return false;
  let ate = Number((/\|(\d{10})\b/.exec(t) || [])[1]) || 0;
  if (!ate) { const seg = /(\d+)\s*seconds?/i.exec(t); if (seg) ate = agoraS() + Number(seg[1]); }
  if (!ate) { const w = porMotor(engine)?.cinco; ate = w?.resetsAt && w.resetsAt > agoraS() ? w.resetsAt : agoraS() + 1800; }
  pausar(engine, ate, 'o limite de uso foi atingido');
  return true;
}

export const textoPausa = ({ engine, ate, motivo }) =>
  `Fim do expediente do ${engine === 'codex' ? 'Codex' : 'Claude'}: ${motivo}. Os agentes que usam esse motor pararam e voltam sozinhos ${quando(ate)}. O que estava na fila fica guardado.`;
export const textoRetomada = ({ engine }, n = 0) =>
  `O limite do ${engine === 'codex' ? 'Codex' : 'Claude'} renovou. Os agentes voltaram ao trabalho${n ? `, retomando ${n} ${n === 1 ? 'chamada guardada' : 'chamadas guardadas'}` : ''}.`;

for (const e of Object.keys(estado.pausa || {})) { if (estado.pausa[e].ate <= agoraS()) expirou(e); else armar(e); }

// ---- forecast: at the pace of the last few minutes, when usage reaches the end of the workday ----------------
function amostrar(engine, a) {
  const serie = ((estado.serie ||= {})[engine] ||= { cinco: [], sete: [] });
  for (const j of ['cinco', 'sete']) {
    const w = a[j]; if (!w || w.estimado) continue;
    const l = serie[j]; const ult = l.at(-1);
    if (ult && (w.pct < ult.pct || (w.resetsAt && ult.reset && w.resetsAt !== ult.reset))) l.length = 0; // the window renewed
    const u2 = l.at(-1);
    if (!u2 || u2.pct !== w.pct || Date.now() - u2.t > 600_000) l.push({ t: Date.now(), pct: w.pct, reset: w.resetsAt || null });
    if (l.length > 80) l.splice(0, l.length - 80);
  }
}

/** [{ engine, janela, pctPorHora, horasAteLimite, antesDeRenovar }] of the windows that are rising. */
export function previsoes() {
  const out = []; const alvo = lerConfig().creditos.pararEm;
  for (const engine of ['claude', 'codex']) for (const j of ['cinco', 'sete']) {
    const l = (estado.serie?.[engine]?.[j] || []).filter((x) => Date.now() - x.t < 3 * 3_600_000);
    if (l.length < 2) continue;
    const a = l[0], b = l.at(-1);
    const horas = (b.t - a.t) / 3_600_000;
    if (horas < 10 / 60 || b.pct <= a.pct) continue;
    const taxa = (b.pct - a.pct) / horas;
    const ate = Math.max(0, (alvo - b.pct) / taxa);
    const renova = b.reset ? (b.reset - agoraS()) / 3600 : Infinity;
    out.push({ engine, janela: j, pct: b.pct, reset: b.reset, pctPorHora: Math.round(taxa * 10) / 10, horasAteLimite: Math.round(ate * 10) / 10, antesDeRenovar: ate < renova });
  }
  return out;
}

export function textoPrevisao(p) {
  const nome = p.janela === 'cinco' ? 'a sessão de 5 horas' : 'a semana';
  return `${p.engine === 'codex' ? 'Codex' : 'Claude'}: ${nome} está em ${p.pct}%, subindo ${p.pctPorHora}% por hora; nesse ritmo chega ao fim do expediente em ${p.horasAteLimite < 1 ? `${Math.round(p.horasAteLimite * 60)} min` : `${p.horasAteLimite} h`}${p.antesDeRenovar ? ', antes de renovar' : ', mas a janela renova antes'}.`;
}

/** Forecasts worth a warning (will run out before renewing, within 3 h) that have not been warned about yet. */
export function previsoesPendentes(projeto = 'global') {
  return previsoes().filter((p) => p.antesDeRenovar && p.horasAteLimite <= 3 && !estado.avisos[`prev:${projeto}:${p.engine}:${p.janela}:${p.reset}`])
    .map((p) => ({ ...p, chave: `prev:${projeto}:${p.engine}:${p.janela}:${Math.round((p.reset || 0) / 3600)}` }));
}

/**
 * Effort ceiling imposed by account usage: low (low-tier models only), medium (without the strongest) or high (unrestricted).
 * Low: 90% in any window, or the week at 80% with 3 or more days until renewal. Medium: 75% or more.
 */
export function tetoAuto(engine = 'claude') {
  const a = porMotor(engine);
  if (!a) return { teto: 'high', motivo: 'sem leitura de uso ainda' };
  const c = a.cinco?.pct ?? 0, s = a.sete?.pct ?? 0, maior = Math.max(c, s, a.extra?.emUso ? a.extra.pct : 0);
  const dias = a.sete?.resetsAt ? (a.sete.resetsAt - agoraS()) / 86400 : 0;
  if (maior >= 90) return { teto: 'low', motivo: `uso em ${maior}%` };
  if (s >= 80 && dias >= 3) return { teto: 'low', motivo: `semana em ${s}% e faltam ${Math.floor(dias)} dias para renovar` };
  if (maior >= 75) return { teto: 'medium', motivo: `uso em ${maior}%` };
  return { teto: 'high', motivo: maior ? `uso em ${maior}%` : '' };
}

/** Calls from the last few hours per model, in short lines (so Cris and the P.O. can see where consumption went). */
export function consumoPorModelo(horas = 24) {
  const desde = Date.now() - horas * 3_600_000;
  const g = new Map();
  for (const a of estado.amostras || []) {
    if (Date.parse(a.em) < desde) continue;
    const k = `${a.engine} ${a.modelo} (${a.esforco})`;
    const x = g.get(k) || { n: 0, tok: 0 };
    x.n++; if (a.tokens) x.tok += a.tokens.entrada + a.tokens.saida + a.tokens.criacaoCache;
    g.set(k, x);
  }
  const tot = [...g.values()].reduce((s, x) => s + x.n, 0);
  if (!tot) return `Últimas ${horas} h: nenhuma chamada registrada.`;
  return `Últimas ${horas} h, ${tot} chamadas:\n${[...g].sort((a, b) => b[1].n - a[1].n).map(([k, x]) => `- ${k}: ${x.n} (${Math.round(100 * x.n / tot)}%)${x.tok ? `, ${Math.round(x.tok / 1000)} mil tokens fora do cache` : ''}`).join('\n')}`;
}

export function porMotor(engine = 'claude') { return engine === 'codex' ? estado.codex : estado.atual; }
export function atual() { return { ...(estado.atual || {}), motores: { claude: estado.atual, codex: estado.codex || null } }; }
export const maiorPct = (engine = 'claude') => Math.max(porMotor(engine)?.cinco?.pct ?? 0, porMotor(engine)?.sete?.pct ?? 0, porMotor(engine)?.extra?.emUso ? porMotor(engine).extra.pct : 0);
/** 0 normal, 1 from 50%, 2 from 75%, 3 from 90%. */
export const faixa = () => FAIXAS.filter((f) => maiorPct() >= f).length;

export function somarGasto(agente, modelo, usd) {
  if (!usd || typeof usd !== 'number') return;
  const chave = `${agente}|${modelo || 'padrão'}`;
  estado.gasto[chave] = Math.round(((estado.gasto[chave] || 0) + usd) * 10000) / 10000;
  salvar();
}

export function registrarTarefa({ engine, modelo, esforco, tipo, pontos, projeto, card, caracteresPrompt, agente, resultado }) {
  const amostras = estado.amostras ||= [];
  const t = resultado.tokens;
  amostras.push({ em: new Date().toISOString(), engine, modelo: modelo || 'padrão', esforco: esforco || 'padrão', tipo, pontos: pontos || null, projeto, card: card || null, caracteresPrompt: caracteresPrompt || null, agente, duracaoMs: resultado.duracaoMs || 0, erro: !!resultado.erro, tokens: t || null });
  if (amostras.length > 2000) amostras.splice(0, amostras.length - 2000);
  salvar();
}

export function registrarQualidade(projeto, c) {
  if (!c.workflow) return;
  (estado.qualidade ||= {})[`${projeto}|${c.id}`] = { qa: c.workflow.qa.status, revisao: c.workflow.revisao, retrabalhos: c.workflow.retrabalhos, concluido: c.coluna === 'concluido', em: new Date().toISOString() };
  salvar();
}

/** Short summary of consumption over the last few hours, with what usually gets wasted. For the P.O.'s request; the full report is analiseConsumo. */
// A project has several teams ("<projeto>__<equipe>"); the finances are shared: the project id covers all of its teams.
const mesmoProjeto = (a, projeto) => !projeto || a.projeto === projeto || String(a.projeto || '').startsWith(`${projeto}__`);
export function diagnostico(projeto = null, horas = 24) {
  const desde = Date.now() - horas * 3_600_000;
  const am = (estado.amostras || []).filter((a) => Date.parse(a.em) >= desde && mesmoProjeto(a, projeto));
  if (!am.length) return `Sem chamadas nas últimas ${horas} h.`;
  const TIPOS = ['feature', 'bug', 'refatoracao', 'teste', 'infra', 'documentacao'];
  const simples = (a) => { const p = String(a.tipo || '').split('/'); return TIPOS.includes(p[0]) ? p[1] : p[0]; };
  const tok = (a) => (a.tokens ? a.tokens.entrada + a.tokens.saida : 0);
  const med = am.filter((a) => a.tokens);
  const cache = med.reduce((s, a) => s + a.tokens.cache + a.tokens.criacaoCache, 0), total = med.reduce((s, a) => s + a.tokens.entrada + a.tokens.saida + a.tokens.cache + a.tokens.criacaoCache, 0);
  const porAg = new Map(), rep = new Map();
  for (const a of am) {
    const k = `${a.agente} ${simples(a)}`; const x = porAg.get(k) || { n: 0, tok: 0, saida: 0 }; x.n++; x.tok += tok(a); x.saida += a.tokens?.saida || 0; porAg.set(k, x);
    if (a.card) { const r = `${a.agente} ${simples(a)} ${a.card}`; rep.set(r, (rep.get(r) || 0) + 1); }
  }
  const po = am.filter((a) => a.agente === 'po').length;
  const linhas = [`Últimas ${horas} h: ${am.length} chamadas${med.length ? `, cache ${total ? Math.round(100 * cache / total) : 0}% do volume lido, saída média ${Math.round(med.reduce((s, a) => s + a.tokens.saida, 0) / med.length)} tokens` : ''}. P.O.: ${Math.round(100 * po / am.length)}% das chamadas.`];
  linhas.push('Quem mais gastou: ' + [...porAg].sort((a, b) => b[1].tok - a[1].tok).slice(0, 4).map(([k, x]) => `${k} (${x.n}x, ~${Math.round(x.tok / 1000)} mil tokens)`).join('; ') + '.');
  const repetidos = [...rep].filter(([, n]) => n >= 3).sort((a, b) => b[1] - a[1]).slice(0, 4);
  if (repetidos.length) linhas.push('Chamadas repetidas (mesmo agente, tipo e card): ' + repetidos.map(([k, n]) => `${k} ${n}x`).join('; ') + '. Se o estado do card não mudou, não chame de novo: resolva a causa em vez de repetir.');
  if (po / am.length > 0.35) linhas.push('A P.O. concentra a maior parte das chamadas: chame só quando houver decisão, dúvida ou impedimento; o resto o app faz.');
  return linhas.join('\n');
}

export function analiseConsumo(projeto = null) {
  const amostras = (estado.amostras || []).filter(a => mesmoProjeto(a, projeto));
  const grupos = new Map();
  for (const a of amostras) {
    const k = `${a.engine} | ${a.tipo || 'pedido'} | ${a.pontos || '?'} pontos | ${a.modelo} | esforço ${a.esforco}`;
    const g = grupos.get(k) || { n: 0, medidos: 0, tokens: 0, cache: 0, ms: 0, erros: 0, cards: new Set(), contexto: 0 };
    g.n++; g.ms += a.duracaoMs; g.erros += Number(a.erro);
    if (a.card) g.cards.add(`${a.projeto}|${a.card}`);
    g.contexto += a.caracteresPrompt || 0;
    if (a.tokens) { g.medidos++; const t = a.tokens; g.tokens += t.entrada + t.saida + t.cache + t.criacaoCache; g.cache += t.cache; }
    grupos.set(k, g);
  }
  const linhas = [`Histórico de consumo: ${amostras.length} chamadas registradas (últimas 2.000).`, 'Agrupado por motor, tipo, pontos, modelo e esforço. Erro indica falha de execução; não mede qualidade nem aprovação da entrega.'];
  if (!amostras.length) linhas.push('Aguardando tarefas reais para formar uma base de comparação.');
  for (const [k, g] of [...grupos].sort((a,b) => b[1].tokens - a[1].tokens).slice(0, 20)) {
    const qualidades = [...g.cards].map(id => estado.qualidade?.[id]).filter(Boolean);
    const qa = qualidades.filter(q=>q.qa==='aprovado').length, retrabalhos = qualidades.reduce((s,q)=>s+q.retrabalhos,0);
    linhas.push(`${k}: ${g.n} chamadas; ${g.medidos ? `${Math.round(g.tokens/g.medidos).toLocaleString('pt-BR')} tokens/chamada (${g.medidos} medidas), ${g.tokens ? Math.round(g.cache/g.tokens*100) : 0}% cache` : 'tokens não informados pelo motor'}; média ${Math.round(g.ms/g.n/1000)}s; ${g.erros} falhas; ${qa}/${qualidades.length} cards com QA atual aprovado; ${retrabalhos} retrabalhos.${g.contexto ? ` Contexto médio: ${Math.round(g.contexto/g.n)} caracteres.` : ''}${g.n < 5 || qualidades.length < 5 ? ' Amostra pequena; não alterar padrão automaticamente.' : ''}`);
  }
  linhas.push('Decisão: compare tarefas do mesmo tipo e complexidade, com pelo menos 5 cards com qualidade medida. Um card pode ter usado vários modelos: o resultado não prova causalidade de um modelo. Teste modelo/esforço menor em tarefas repetitivas e valide qualidade antes de adotar o padrão. Cache está incluído no total; caracteres de contexto não são tokens; tokens não equivalem ao percentual da assinatura.');
  return linhas.join('\n');
}

const quando = (epoch) => {
  if (!epoch) return '';
  const d = new Date(epoch * 1000);
  const hoje = new Date();
  const hora = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  return d.toDateString() === hoje.toDateString() ? `às ${hora}` : `${d.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit' })} às ${hora}`;
};

/** Band crossings not yet warned about (once per window and per band). Returns only the highest. */
export function pendentes(projeto = 'global') {
  const out = [];
  for (const engine of ['claude', 'codex']) for (const j of ['cinco', 'sete']) {
    const w = porMotor(engine)?.[j];
    if (!w) continue;
    for (const f of FAIXAS) {
      const chave = `${projeto}:${engine}:${j}:${Math.round((w.resetsAt || 0) / 3600)}:${f}`;   // renewal rounded to the hour: the Codex reading varies by a few seconds and produced a repeated warning on every call
      if (w.pct >= f && !estado.avisos[chave]) out.push({ engine, chave, janela: j, faixa: f, pct: w.pct, resetsAt: w.resetsAt });
    }
  }
  return out;
}

export function marcarAvisado(chaves) {
  for (const c of chaves) estado.avisos[c] = true;
  const ks = Object.keys(estado.avisos);
  if (ks.length > 400) for (const k of ks.slice(0, ks.length - 400)) delete estado.avisos[k];   // 60 dropped still-valid warnings with 4 projects open
  salvar();
}

export function politica(pct = maiorPct()) {
  if (pct >= 90) return 'CRÍTICO (90% ou mais): não abrir trabalho novo. Só concluir o que já está em andamento. A Cris força o teto low (Haiku 4.5, Sonnet 4.6 e Luna) e o que for de 1 a 3 pontos vai para o motor codex. Perto do limite os agentes do Claude param sozinhos até renovar.';
  if (pct >= 75) return 'APERTADO (75% a 89%): só o essencial e de prioridade alta. A Cris baixa o teto para medium ou low: tira o Opus/Sol e deixa tudo em esforço low. Sem consultas privadas. Cards de 1 a 3 pontos vão para o motor codex. Adiar o que é baixa prioridade e dizer à Game Director o que foi adiado.';
  if (pct >= 50) return 'ECONÔMICO (50% a 74%): a Cris usa a escada Haiku 4.5, Sonnet 4.6, Sonnet 5.5, Opus 5, Opus 5.5 e só sobe no que é difícil de verdade, em low. Respostas curtas, menos consultas, sem reler o que já foi lido. Cards de 1 a 3 pontos podem ir para o motor codex (campo motor).';
  return 'NORMAL (abaixo de 50%): a Cris escolhe o degrau mais barato que dá conta: Haiku 4.5 na conversa, Sonnet 4.6 no simples, Sonnet 5.5 / Terra no comum, Opus 5 e Opus 5.5 / Sol só no difícil. Raciocínio high só depois de vários retrabalhos.';
}

export function equilibrio() {
  const c = porMotor('claude'), x = porMotor('codex');
  if (!c || !x) return 'Uma das contas ainda não tem leitura. Não presuma saldo disponível; confirme o uso antes de transferir carga.';
  const pc = maiorPct('claude'), px = maiorPct('codex');
  if (pc >= 90 && px >= 90) return 'Ambos perto do limite: concluir só o essencial, adiar trabalho novo e reduzir modelo e esforço. Não transferir a sobrecarga entre os motores.';
  const destino = pc <= px ? 'Claude' : 'Codex';
  return `Claude ${pc}% e Codex ${px}% (maior janela). Priorize ${destino} para carga transferível, se não estiver pausado. A P.O. ajusta motor, modelo, esforço e prioridade por card com o agente Créditos. Nunca transfira para um motor com uso maior ou sem leitura recente.`;
}

const recente = engine => {
  const a = porMotor(engine);
  return a && Date.now() - Date.parse(a.em) < 10 * 60_000 && ![a.cinco, a.sete].some(w => w?.estimado);
};

/** Effective usage of an engine: a window that has already renewed counts as 0, even without a new reading. null if there was never a reading. */
export function pctEfetivo(engine) {
  const a = porMotor(engine);
  if (!a) return null;
  const v = ['cinco', 'sete', ...(a.extra?.emUso ? ['extra'] : [])].map((j) => a[j]).filter(Boolean).map((w) => (w.resetsAt && w.resetsAt <= agoraS() ? 0 : w.pct));
  return v.length ? Math.max(...v) : null;
}

/** How many calls each engine received in the last few hours. */
export function chamadasPorMotor(horas = 24) {
  const desde = Date.now() - horas * 3_600_000; const n = { claude: 0, codex: 0 };
  for (const a of estado.amostras || []) if (Date.parse(a.em) >= desde && a.engine in n) n[a.engine]++;
  return n;
}

export function escolherMotor(pref, trocar = true, desligados = []) {
  const outro = pref === 'claude' ? 'codex' : 'claude';
  // an engine the Game Director turned off in the project never runs, and the work goes to the other one without relying on automatic switching
  if (desligados.includes(pref)) return desligados.includes(outro) || pausado(outro) ? null : outro;
  if (desligados.includes(outro)) return pausado(pref) ? null : pref;
  if (pausado(pref)) return trocar && !pausado(outro) ? outro : null;
  // Balancing: if the other engine has much more headroom (15 points or more), the work goes to it. The existing reading counts,
  // with a renewed window counting as zero: an engine that is barely used barely sends new readings, and requiring a fresh reading
  // left the idle engine stuck forever.
  const pp = pctEfetivo(pref), po = pctEfetivo(outro);
  if (trocar && !pausado(outro) && pp !== null && po !== null && pp - po >= 15) return outro;
  return pref;
}

export function paraPrompt() {
  const linhas = ['## Créditos das duas contas'];
  for (const engine of ['claude', 'codex']) {
    const a = porMotor(engine);
    linhas.push(`${engine}: ${a ? `leitura ${a.em}; ` + ['cinco', 'sete'].filter(j => a[j]).map(j => `${a[j].minutos || (j === 'cinco' ? 300 : 10080)} min: ${a[j].pct}% usado${a[j].resetsAt ? ` (renova ${quando(a[j].resetsAt)})` : ''}`).join('; ') : 'sem leitura disponível'}`);
  }
  { const e = porMotor('claude')?.extra; if (e) linhas.push(`claude, créditos extras: ${e.pct}%${e.emUso ? ' (em uso: o plano acabou e está gastando os extras)' : ' (ainda não estão em uso: o plano cobre)'}${e.resetsAt ? `, renovam ${quando(e.resetsAt)}` : ''}.`); }
  for (const p of previsoes()) linhas.push(`Previsão: ${textoPrevisao(p)}`);
  linhas.push(equilibrio(), 'Aplique economia ao motor que está com uso alto; só transfira carga se o outro tiver folga confirmada.');
  return linhas.join('\n');
}

export function textoAlerta({ engine = 'claude', janela, pct, resetsAt }) {
  const outra = janela === 'cinco' ? porMotor(engine)?.sete : porMotor(engine)?.cinco;
  const o = outra ? ` ${janela === 'cinco' ? 'A semana' : 'A sessão de 5 horas'} está em ${outra.pct}%.` : '';
  return `@P.O. ${engine === 'codex' ? 'Codex' : 'Claude'}: ${NOME_JANELA[janela]} chegou a ${pct}% do uso${resetsAt ? ` (renova ${quando(resetsAt)})` : ''}.${o} ${equilibrio()} Reavalie o quadro, ajuste motor, modelo e esforço dos cards e avise o time.`;
}

// ---- budget: the quota is an envelope, not a brake ------------------------------------------------------------
// Week → day → 5 h window. The app reads the percentages it already reads and computes how much fits today; planning allocates; the card shows what it
// spent; near the end of the window only work already in progress gets finished. Normalized cost = list price per token (US$ per million),
// the common unit for comparing calls, cards and estimates. The subscription does not charge per call: it is a yardstick, not an invoice.
const PRECO = { 'claude-haiku-4-5': [1, 5], 'claude-haiku-5-5': [1, 5], 'claude-sonnet-4-6': [3, 15], 'claude-sonnet-5-5': [3, 15], 'claude-sonnet-5': [3, 15], 'claude-opus-5': [15, 75], 'claude-opus-5-5': [15, 75] };
export function custoDe(a) {
  const t = a?.tokens; if (!t) return 0;
  const [pi, po] = PRECO[a.modelo] || [3, 15];
  return Math.round(((t.entrada || 0) * pi + (t.cache || 0) * pi * 0.1 + (t.criacaoCache || 0) * pi * 1.25 + (t.saida || 0) * po) / 1e6 * 1000) / 1000;
}
export function custoDoCard(projeto, card) {
  return Math.round((estado.amostras || []).filter((a) => a.card === card && mesmoProjeto(a, projeto)).reduce((s, a) => s + custoDe(a), 0) * 1000) / 1000;
}
export const amostrasDe = (projeto) => (estado.amostras || []).filter((a) => mesmoProjeto(a, projeto));
export function custosDoProjeto(projeto) {
  const m = {};
  for (const a of estado.amostras || []) if (a.card && mesmoProjeto(a, projeto)) m[a.card] = Math.round(((m[a.card] || 0) + custoDe(a)) * 1000) / 1000;
  return m;
}
const TABELA_PONTOS = { 1: 0.4, 2: 0.8, 3: 1.4, 5: 2.6, 8: 4.5, 13: 8 };
/** Cost estimate for a card from completed cards of the same size (median); without history, a table by points. */
export function estimativaCard({ projeto = null, pontos = 3 } = {}) {
  const conclu = Object.entries(estado.qualidade || {}).filter(([k, q]) => q.concluido && (!projeto || k.startsWith(`${projeto}|`) || k.startsWith(`${projeto}__`))).map(([k]) => k.split('|').pop());
  const por = new Map();
  for (const a of estado.amostras || []) if (a.card && conclu.includes(a.card)) por.set(`${a.projeto}|${a.card}`, { custo: (por.get(`${a.projeto}|${a.card}`)?.custo || 0) + custoDe(a), pontos: a.pontos || por.get(`${a.projeto}|${a.card}`)?.pontos || null });
  const mesmos = [...por.values()].filter((x) => x.custo > 0 && x.pontos === pontos).map((x) => x.custo).sort((a, b) => a - b);
  if (mesmos.length >= 3) return { custo: Math.round(mesmos[Math.floor(mesmos.length / 2)] * 100) / 100, base: mesmos.length, origem: 'histórico' };
  const todos = [...por.values()].filter((x) => x.custo > 0 && x.pontos).map((x) => x.custo / (TABELA_PONTOS[x.pontos] || 1)).sort((a, b) => a - b);
  if (todos.length >= 3) return { custo: Math.round(todos[Math.floor(todos.length / 2)] * (TABELA_PONTOS[pontos] || 1.4) * 100) / 100, base: todos.length, origem: 'histórico (proporcional)' };
  return { custo: TABELA_PONTOS[pontos] || 1.4, base: 0, origem: 'tabela' };
}
/** Calibration: how many % of the week 1 unit of cost takes (from the day's observation). null without data. */
export function pctPorCusto(engine = 'claude') {
  const d = estado.diario?.[`${new Date().toISOString().slice(0, 10)}|${engine}`];
  const a = porMotor(engine)?.sete;
  if (!d || !a || a.resetsAt !== d.reset) return null;
  const gastoPct = Math.max(0, a.pct - d.pctInicio);
  const desde = Date.parse(d.em);
  const custo = (estado.amostras || []).filter((x) => x.engine === engine && Date.parse(x.em) >= desde).reduce((s, x) => s + custoDe(x), 0);
  return gastoPct >= 2 && custo > 0 ? Math.round(gastoPct / custo * 100) / 100 : null;
}
/** Today's envelope: what remains of the week divided by the days left, minus what was already spent today; and the 5 h window. */
export function envelope(engine = 'claude') {
  const a = porMotor(engine);
  if (!a || (!a.sete && !a.cinco)) return null;
  const sem = a.sete, cinco = a.cinco;
  const hoje = new Date().toISOString().slice(0, 10); const chave = `${hoje}|${engine}`;
  const diario = (estado.diario ||= {});
  const diasRestantes = sem?.resetsAt ? Math.max(1, Math.ceil((sem.resetsAt - agoraS()) / 86400)) : 7;
  // the day's envelope is fixed at the day's first reading (what remained of the week divided by the days): today's spending does not shrink it
  if (sem && (!diario[chave] || diario[chave].reset !== sem.resetsAt)) { diario[chave] = { pctInicio: sem.pct, reset: sem.resetsAt, em: new Date().toISOString(), envelopeDia: Math.round(Math.max(0, 100 - sem.pct) / diasRestantes * 10) / 10 }; for (const k of Object.keys(diario)) if (k < `${new Date(Date.now() - 14 * 86400e3).toISOString().slice(0, 10)}|`) delete diario[k]; salvar(); }
  const restanteSemana = sem ? Math.max(0, 100 - sem.pct) : null;
  // Envelope factor (creditos.envelopeFator or STUDIO_ENVELOPE_FATOR): 1 = rest of the week divided by the days; 2 = double, for a
  // sprint authorized by the user. The 5 h window brake always still applies.
  const fator = Math.max(0.5, Math.min(5, Number(process.env.STUDIO_ENVELOPE_FATOR) || Number(lerConfig().creditos?.envelopeFator) || 1));
  const envelopeDia = sem ? Math.round(diario[chave].envelopeDia * fator * 10) / 10 : null;
  const gastoHoje = sem ? Math.max(0, sem.pct - diario[chave].pctInicio) : 0;
  const saldoDia = envelopeDia !== null ? Math.round((envelopeDia - gastoHoje) * 10) / 10 : null;
  const restanteJanela = cinco ? Math.max(0, 100 - cinco.pct) : null;
  const minParaRenovar = cinco?.resetsAt ? Math.max(0, Math.round((cinco.resetsAt - agoraS()) / 60)) : null;
  let reserva = false; let motivo = '';
  if (restanteJanela !== null && restanteJanela <= 10) { reserva = true; motivo = `a janela de 5 h está em ${cinco.pct}%`; }
  else if (saldoDia !== null && saldoDia <= 0 && diasRestantes > 1) { reserva = true; motivo = `o envelope de hoje (${envelopeDia}% da semana) já foi gasto`; }
  return { engine, restanteSemana, diasRestantes, envelopeDia, gastoHoje, saldoDia, janela: { pct: cinco?.pct ?? null, restante: restanteJanela, minParaRenovar }, reserva, motivo, pctPorCusto: pctPorCusto(engine) };
}
export function textoEnvelope(engine = 'claude') {
  const e = envelope(engine);
  if (!e) return '';
  const L = [`## Orçamento (${engine === 'codex' ? 'Codex' : 'Claude'}): envelope, não freio`];
  if (e.restanteSemana !== null) L.push(`Semana: restam ${e.restanteSemana}% para ${e.diasRestantes} dia${e.diasRestantes > 1 ? 's' : ''}; envelope de hoje ${e.envelopeDia}%, já gasto ${e.gastoHoje}%, saldo ${e.saldoDia}%.`);
  if (e.janela.pct !== null) L.push(`Janela de 5 h: ${e.janela.pct}% usado${e.janela.minParaRenovar !== null ? `, renova em ${e.janela.minParaRenovar} min` : ''}.`);
  if (e.pctPorCusto) L.push(`Calibração de hoje: 1 unidade de custo ≈ ${e.pctPorCusto}% da semana.`);
  L.push(e.reserva ? `MODO RESERVA: ${e.motivo}. Só termina o que está em andamento; trabalho novo espera a próxima janela ou o dia seguinte.` : 'Dentro do envelope: trabalho novo pode começar. Quem estoura a estimativa do card justifica (nível menor, quebrar, adiar) antes de seguir.');
  return L.join('\n');
}

/** The Credits agent's answer when someone asks about usage. Does not call a model. */
export function relatorio(cartoes = [], projeto = null) {
  const linhas = [paraPrompt(), textoEnvelope('claude'), analiseConsumo(projeto)].filter(Boolean);
  const abertos = cartoes.filter((c) => !['concluido'].includes(c.coluna));
  const pontos = abertos.reduce((s, c) => s + (c.pontos || 0), 0);
  const semEst = abertos.filter((c) => !c.pontos).length;
  if (abertos.length) linhas.push(`Cards abertos: ${abertos.length}, ${pontos} pontos estimados${semEst ? `, ${semEst} ainda sem estimativa` : ''}.`);
  const gasto = Object.entries(estado.gasto).sort((x, y) => y[1] - x[1]).slice(0, 6);
  if (gasto.length) linhas.push(`Quem mais gastou (valor de tabela, a assinatura não cobra por chamada): ${gasto.map(([k, v]) => `${k.replace('|', ' com ')} US$ ${v.toFixed(2)}`).join('; ')}.`);
  return linhas.join('\n');
}
