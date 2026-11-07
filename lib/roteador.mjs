// Cris decide o modelo e o raciocínio de cada chamada, sem gastar uma chamada de modelo.
// Regra de ouro: o mais barato que dá conta. Uma escada de cinco degraus, do mais barato ao mais forte:
//   0 conversa  Haiku 4.5   (Codex: Luna)   mensagem de chat, tarefa trivial
//   1 baixo     Sonnet 4.6  (Codex: Luna)   o modelo de trabalho mais barato
//   2 medio     Sonnet 5.5  (Codex: Terra)  trabalho comum
//   3 forte     Opus 5      (Codex: Sol)    difícil, mas ainda não o topo
//   4 maximo    Opus 5.5    (Codex: Sol)    o que decide rumo, só quando precisa
// A escada do Claude é configurável em creditos.claude (settings.json); estes são os padrões. Haiku 5.5 e Sonnet 5 também existem
// e funcionam; é só trocar lá se a medição de consumo mostrar que compensa.
// O TETO (low, medium, high) é o degrau mais alto permitido: low até o 1, medium até o 2, high até o 4.
// Quem define o teto: o uso da conta (automático), você nos Ajustes e a P.O. por card; vale o menor.
// O agente pode descer ou subir o próprio nível (ação nivel.definir), sempre dentro do teto.

export const ESCADA_CLAUDE = { conversa: 'claude-haiku-4-5', baixo: 'claude-sonnet-4-6', medio: 'claude-sonnet-5-5', forte: 'claude-opus-5', maximo: 'claude-opus-5-5' };

export const DEGRAUS = ['conversa', 'baixo', 'medio', 'forte', 'maximo'];
const CODEX = ['leve', 'leve', 'medio', 'forte', 'forte']; // chaves de creditos.codex
export const TETOS = ['low', 'medium', 'high'];
const TETO_DEGRAU = { low: 1, medium: 2, high: 4 };
const PREF_DEGRAU = { minimo: 0, low: 1, medium: 2, high: 4 };
export const NIVEIS_AGENTE = Object.keys(PREF_DEGRAU);
// PISO: o degrau mínimo de um cargo. Arquitetura, revisão de código e segurança são julgamento sênior: um modelo fraco ali derruba
// a qualidade de tudo que vem depois. O piso vale SEMPRE, mesmo com o uso da conta alto, com o teto do card baixo ou se o próprio
// agente pedir um nível menor. É o único limite que o teto não rebaixa.
const PISO_DEGRAU = { baixo: 1, medio: 2, forte: 3, maximo: 4 };

const CONVERSA = new Set(['pedido', 'mencao']);
// planning: opinião e debate são baratos; a proposta da P.O. pensa um pouco mais. Versionar é mecânico e cuidadoso.
const PLANNING = { planning: [2, 'low'], planning_replica: [1, 'low'], planning_proposta: [2, 'medium'], planning_ajuste: [2, 'medium'], versionar: [2, 'low'], ressalvas: [2, 'low'], grupo: [1, 'low'], publicar: [2, 'low'] };
const ROTINA = new Set(['status', 'piloto', 'ronda', 'fechamento', 'relatorio', 'comentario', 'monitor', 'curadoria', 'consulta', 'creditos', 'repositorios']);
const ORDEM = ['low', 'medium', 'high', 'xhigh', 'max'];
const limitar = (esforco, teto) => (ORDEM.indexOf(esforco) > ORDEM.indexOf(teto) ? teto : esforco);
export const menorTeto = (...tetos) => tetos.filter((t) => TETOS.includes(t)).sort((a, b) => TETOS.indexOf(a) - TETOS.indexOf(b))[0] || 'high';

/**
 * Devolve { modelo, esforco, nivel, degrau, teto, motivo } para uma chamada.
 *  engine  claude | codex
 *  tipo    tipo da chamada (pedido, mencao, execucao, status, ...)
 *  modo    conversar | trabalhar
 *  card    o card da chamada, se houver (pontos, risco, retrabalho)
 *  teto    teto já combinado (uso da conta, Ajustes e card): low | medium | high
 *  pref    nível que o próprio agente pediu: minimo | low | medium | high
 *  codex   { leve, medio, forte } com os modelos do Codex
 */
const AMPLO = /\b(review|relat[óo]rio|apresenta[çc][ãa]o|pesquis|an[áa]lis|investig|levantamento|plano|diagn[óo]stico|benchmark|estudo|auditoria)\w*/i;
/** Um pedido sem card ainda pode ser trabalho de verdade: peça ampla, lista de frentes ou texto longo. Isso não é conversa. */
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

  if (tipo === 'grupo' && !card) { degrau = 0; esforco = 'low'; motivo = 'conversa em grupo sem card: modelo mínimo'; }   // colega respondendo colega custa o mínimo
  else if (PLANNING[tipo]) { [degrau, esforco] = PLANNING[tipo]; motivo = tipo.replace('_', ' '); }
  // pedido amplo sem card (Review, relatório, pesquisa, lista de frentes) exige planejamento: não cai no modelo mínimo
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

  // o próprio agente pediu outro nível para esta atividade
  if (pref && PREF_DEGRAU[pref] !== undefined) {
    // descer é sempre permitido; subir só com evidência (retrabalho medido ou risco alto declarado): pedido de agente não é evidência
    if (PREF_DEGRAU[pref] <= degrau || retrabalhos || alto) {
      degrau = PREF_DEGRAU[pref];
      esforco = degrau <= 1 ? 'low' : degrau === 2 ? 'medium' : 'low';
      motivo = `o agente pediu nível ${pref}`;
    } else motivo += `; pedido de ${pref} ignorado (subir só com retrabalho ou risco alto)`;
  }

  // o teto manda: nunca passa do degrau permitido, nem do raciocínio permitido
  const t = TETOS.includes(teto) ? teto : 'high';
  if (degrau > TETO_DEGRAU[t]) { degrau = TETO_DEGRAU[t]; motivo += `; limitado pelo teto ${t}`; }
  esforco = limitar(esforco, t === 'high' ? 'max' : t);
  const pd = PISO_DEGRAU[piso];
  if (pd !== undefined && degrau < pd) { degrau = pd; motivo += `; piso do cargo (${piso})`; }

  const modelo = engine === 'codex' ? (codex || {})[CODEX[degrau]] || (codex || {}).medio : ({ ...ESCADA_CLAUDE, ...(claude || {}) })[DEGRAUS[degrau]];
  return { modelo, esforco, nivel: DEGRAUS[degrau], degrau, teto: t, motivo };
}
