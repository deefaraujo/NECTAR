// Cris decides the model and reasoning for each call, without spending a model call.
// Golden rule: the cheapest that gets it done. A five-step ladder, from cheapest to strongest:
//   0 conversa  Haiku 4.5   (Codex: Luna)   chat message, trivial task
//   1 baixo     Sonnet 4.6  (Codex: Luna)   the cheapest work model
//   2 medio     Sonnet 5.5  (Codex: Terra)  regular work
//   3 forte     Opus 5      (Codex: Sol)    hard, but not yet the top
//   4 maximo    Opus 5.5    (Codex: Sol)    what sets direction, only when needed
// The Claude ladder is configurable in creditos.claude (settings.json); these are the defaults. Haiku 5.5 and Sonnet 5 also exist
// and work; just switch them there if consumption measurements show it pays off.
// The CEILING (low, medium, high) is the highest allowed step: low up to 1, medium up to 2, high up to 4.
// Who sets the ceiling: account usage (automatic), you in Settings and the P.O. per card; the lowest wins.
// The agent may lower or raise its own level (action nivel.definir), always within the ceiling.

export const ESCADA_CLAUDE = { conversa: 'claude-haiku-4-5', baixo: 'claude-sonnet-4-6', medio: 'claude-sonnet-5-5', forte: 'claude-opus-5', maximo: 'claude-opus-5-5' };

export const DEGRAUS = ['conversa', 'baixo', 'medio', 'forte', 'maximo'];
const CODEX = ['leve', 'leve', 'medio', 'forte', 'forte']; // keys of creditos.codex
export const TETOS = ['low', 'medium', 'high'];
const TETO_DEGRAU = { low: 1, medium: 2, high: 4 };
const PREF_DEGRAU = { minimo: 0, low: 1, medium: 2, high: 4 };
export const NIVEIS_AGENTE = Object.keys(PREF_DEGRAU);
// FLOOR: the minimum step for a role. Architecture, code review and security are senior judgment: a weak model there drags down
// the quality of everything after it. The floor ALWAYS applies, even with high account usage, a low card ceiling, or if the agent
// itself asks for a lower level. It is the only limit the ceiling does not lower.
const PISO_DEGRAU = { baixo: 1, medio: 2, forte: 3, maximo: 4 };

const CONVERSA = new Set(['pedido', 'mencao']);
// planning: opinions and debate are cheap; the P.O.'s proposal thinks a bit more. Versioning is mechanical and careful.
const PLANNING = { planning: [2, 'low'], planning_replica: [1, 'low'], planning_proposta: [2, 'medium'], planning_ajuste: [2, 'medium'], versionar: [2, 'low'], ressalvas: [2, 'low'], grupo: [1, 'low'], publicar: [2, 'low'] };
const ROTINA = new Set(['status', 'piloto', 'ronda', 'fechamento', 'relatorio', 'comentario', 'monitor', 'curadoria', 'consulta', 'creditos', 'repositorios']);
const ORDEM = ['low', 'medium', 'high', 'xhigh', 'max'];
const limitar = (esforco, teto) => (ORDEM.indexOf(esforco) > ORDEM.indexOf(teto) ? teto : esforco);
export const menorTeto = (...tetos) => tetos.filter((t) => TETOS.includes(t)).sort((a, b) => TETOS.indexOf(a) - TETOS.indexOf(b))[0] || 'high';

/**
 * Returns { modelo, esforco, nivel, degrau, teto, motivo } for a call.
 *  engine  claude | codex
 *  tipo    call type (pedido, mencao, execucao, status, ...)
 *  modo    conversar | trabalhar
 *  card    the call's card, if any (points, risk, rework)
 *  teto    ceiling already agreed (account usage, Settings and card): low | medium | high
 *  pref    level the agent itself asked for: minimo | low | medium | high
 *  codex   { leve, medio, forte } with the Codex models
 */
const AMPLO = /\b(review|relat[óo]rio|apresenta[çc][ãa]o|pesquis|an[áa]lis|investig|levantamento|plano|diagn[óo]stico|benchmark|estudo|auditoria)\w*/i;
/** A request without a card may still be real work: a broad deliverable, a list of fronts or a long text. That is not conversation. */
export function pedidoComplexo(texto) {
  const t = String(texto || '');
  const itens = (t.match(/^\s*(?:\d{1,2}[.)\-:]|[-*•])\s+\S/gm) || []).length;
  return itens >= 2 || (t.length >= 240 && AMPLO.test(t)) || t.length >= 700;
}

export function escolher({ engine, tipo, modo, card, teto = 'high', pref = null, piso = null, codex, claude, texto = '', contrato = false }) {
  const pontos = card?.pontos || 0;
  const retrabalhos = card?.workflow?.retrabalhos || 0;
  const alto = card?.risco === 'alto';
  let degrau; let esforco; let motivo;

  if (tipo === 'grupo' && !card) { degrau = 0; esforco = 'low'; motivo = 'conversa em grupo sem card: modelo mínimo'; }   // a colleague replying to a colleague costs the minimum
  else if (PLANNING[tipo]) { [degrau, esforco] = PLANNING[tipo]; motivo = tipo.replace('_', ' '); }
  // broad request without a card (Review, report, research, list of fronts) needs planning: it does not drop to the minimum model
  else if (!card && CONVERSA.has(tipo) && (pedidoComplexo(texto) || (contrato && tipo === 'pedido'))) { degrau = 2; esforco = 'medium'; motivo = contrato && !pedidoComplexo(texto) ? 'pedido com contrato aberto: trabalho, não conversa' : 'pedido complexo sem card: planejamento'; }
  else if (!card && CONVERSA.has(tipo) && modo !== 'trabalhar') { degrau = 0; esforco = 'low'; motivo = 'conversa sem card: modelo mínimo'; }
  else if (!card && ROTINA.has(tipo)) { degrau = 2; esforco = 'low'; motivo = `rotina (${tipo})`; }
  else {
    if (pontos >= 13) degrau = 4;
    else if (pontos >= 8) degrau = alto ? 4 : 3;
    else if (pontos >= 5) degrau = alto ? 3 : 2;
    else if (pontos >= 3) degrau = 2;
    else if (pontos >= 1) degrau = alto ? 2 : pontos === 1 ? 0 : 1;
    else degrau = 2;
    motivo = pontos ? `${pontos} ponto${pontos > 1 ? 's' : ''}${alto ? ', risco alto' : ''}` : 'card sem estimativa';
    if (retrabalhos) { degrau = Math.min(4, degrau + Math.min(2, retrabalhos)); motivo += `, ${retrabalhos} retrabalho${retrabalhos > 1 ? 's' : ''}`; }
    esforco = degrau <= 1 ? 'low' : degrau === 2 ? (pontos && pontos <= 2 ? 'low' : 'medium') : (retrabalhos >= 5 ? 'high' : retrabalhos >= 3 ? 'medium' : 'low');
  }

  // the agent itself asked for another level for this activity
  if (pref && PREF_DEGRAU[pref] !== undefined) {
    // going down is always allowed; going up only with evidence (measured rework or declared high risk): an agent's request is not evidence
    if (PREF_DEGRAU[pref] <= degrau || retrabalhos || alto) {
      degrau = PREF_DEGRAU[pref];
      esforco = degrau <= 1 ? 'low' : degrau === 2 ? 'medium' : 'low';
      motivo = `o agente pediu nível ${pref}`;
    } else motivo += `; pedido de ${pref} ignorado (subir só com retrabalho ou risco alto)`;
  }

  // the ceiling rules: never above the allowed step, nor above the allowed reasoning
  const t = TETOS.includes(teto) ? teto : 'high';
  if (degrau > TETO_DEGRAU[t]) { degrau = TETO_DEGRAU[t]; motivo += `; limitado pelo teto ${t}`; }
  esforco = limitar(esforco, t === 'high' ? 'max' : t);
  const pd = PISO_DEGRAU[piso];
  if (pd !== undefined && degrau < pd) { degrau = pd; motivo += `; piso do cargo (${piso})`; }

  const modelo = engine === 'codex' ? (codex || {})[CODEX[degrau]] || (codex || {}).medio : ({ ...ESCADA_CLAUDE, ...(claude || {}) })[DEGRAUS[degrau]];
  return { modelo, esforco, nivel: DEGRAUS[degrau], degrau, teto: t, motivo };
}
