// Métricas de excelência: para saber se o time está no nível que se quer, com número, não com achismo.
//   lead time       pedido → concluído, por card (mediana e p90)
//   custo/ponto     custo normalizado dividido por pontos, nos cards concluídos
//   chamadas/ponto  quantas chamadas de modelo por ponto entregue
//   retrabalho      cards que voltaram de revisão/QA pelo menos uma vez, e média de retrabalhos
//   evidência falsa relato de agente recusado por contradizer medição do app (ficha de fatos)
//   decisões revertidas  perguntas decididas pela liderança/regra e depois respondidas de outro jeito por você
//   tempo parado    quanto do lead time o card passou aguardando (pergunta aberta) ou bloqueado
// Tudo calculado do que o app já guarda. Nenhuma chamada de modelo.
import * as creditos from './creditos.mjs';

const mediana = (l) => { const s = [...l].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : 0; };
const p90 = (l) => { const s = [...l].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(s.length * 0.9))] : 0; };
const horas = (ms) => Math.round(ms / 36e4) / 10;

export function calcular({ projetoId, cards, fatos, decisoes, dias = 30 }) {
  const desde = Date.now() - dias * 86400e3;
  const concluidos = cards.filter((c) => c.coluna === 'concluido' && !c.arquivado && Date.parse(c.atualizado || c.criado) >= desde);
  const amostras = (creditos.amostrasDe?.(projetoId) || []).filter((a) => Date.parse(a.em) >= desde);
  const porCard = new Map();
  for (const a of amostras) if (a.card) { const x = porCard.get(a.card) || { n: 0, custo: 0 }; x.n++; x.custo += creditos.custoDe(a); porCard.set(a.card, x); }

  const leads = []; const parados = []; const custosPorPonto = []; const chamadasPorPonto = []; let comRetrabalho = 0; let retrabalhos = 0;
  for (const c of concluidos) {
    const fim = (c.historico || []).filter((h) => /Concluído|concluido/i.test(h.txt)).at(-1)?.em || c.atualizado;
    const lead = Date.parse(fim) - Date.parse(c.criado);
    if (lead > 0) leads.push(lead);
    // tempo parado: entre "aguardando"/"bloqueado" e o desbloqueio, pelo histórico
    let parado = 0; let ini = null;
    for (const h of c.historico || []) {
      if (/aguard|bloquead/i.test(h.txt) && !/desbloq|voltou|liberad/i.test(h.txt)) ini = ini || Date.parse(h.em);
      else if (ini && /desbloq|liberad|respond|voltou/i.test(h.txt)) { parado += Date.parse(h.em) - ini; ini = null; }
    }
    parados.push(parado);
    const r = c.workflow?.retrabalhos || 0; if (r) comRetrabalho++; retrabalhos += r;
    const x = porCard.get(c.id); const pts = c.pontos || 0;
    if (x && pts) { custosPorPonto.push(x.custo / pts); chamadasPorPonto.push(x.n / pts); }
  }
  const ev = fatos?.estatisticas?.() || { recusados: 0, medidos: 0, relatados: 0 };
  // decisões revertidas: resposta sua a uma pergunta já decidida pela liderança/regra, com texto diferente
  const resp = decisoes?.respostas?.() || [];
  let revertidas = 0; let decididasPorOutros = 0;
  for (const r of resp) {
    if (/piloto|regra|delegado/i.test(r.por)) { decididasPorOutros++; const dep = resp.find((s) => s !== r && Date.parse(s.em) > Date.parse(r.em) && !/piloto|regra|delegado/i.test(s.por) && s.pergunta === r.pergunta && s.resposta.trim().toLowerCase() !== r.resposta.trim().toLowerCase()); if (dep) revertidas++; }
  }
  const total = amostras.length;
  return {
    dias, cardsConcluidos: concluidos.length, chamadas: total, custoTotal: Math.round(amostras.reduce((s, a) => s + creditos.custoDe(a), 0) * 100) / 100,
    leadTimeHoras: { mediana: horas(mediana(leads)), p90: horas(p90(leads)) },
    tempoParadoHoras: { mediana: horas(mediana(parados)) },
    custoPorPonto: custosPorPonto.length ? Math.round(mediana(custosPorPonto) * 100) / 100 : null,
    chamadasPorPonto: chamadasPorPonto.length ? Math.round(mediana(chamadasPorPonto) * 10) / 10 : null,
    retrabalho: { cards: comRetrabalho, taxa: concluidos.length ? Math.round(100 * comRetrabalho / concluidos.length) : 0, media: concluidos.length ? Math.round(10 * retrabalhos / concluidos.length) / 10 : 0 },
    evidenciaFalsa: { recusados: ev.recusados, relatados: ev.relatados, medidos: ev.medidos, taxa: ev.relatados ? Math.round(100 * ev.recusados / ev.relatados) : 0 },
    decisoes: { porOutros: decididasPorOutros, revertidas, taxa: decididasPorOutros ? Math.round(100 * revertidas / decididasPorOutros) : 0 },
    porAgente: Object.entries(amostras.reduce((acc, a) => { const x = acc[a.agente] ||= { n: 0, custo: 0 }; x.n++; x.custo += creditos.custoDe(a); return acc; }, {})).map(([agente, x]) => ({ agente, chamadas: x.n, custo: Math.round(x.custo * 100) / 100, pct: total ? Math.round(100 * x.n / total) : 0 })).sort((a, b) => b.chamadas - a.chamadas).slice(0, 10),
  };
}

export function texto(m, nomeDe = (x) => x) {
  const L = [`## Métricas dos últimos ${m.dias} dias (calculadas pelo app)`];
  L.push(`Cards concluídos: ${m.cardsConcluidos}. Chamadas de modelo: ${m.chamadas}, custo normalizado ${m.custoTotal}.`);
  L.push(`Lead time (pedido → concluído): mediana ${m.leadTimeHoras.mediana} h, p90 ${m.leadTimeHoras.p90} h; tempo parado (aguardando/bloqueado) mediana ${m.tempoParadoHoras.mediana} h.`);
  L.push(`Por ponto entregue: ${m.custoPorPonto ?? '-'} de custo e ${m.chamadasPorPonto ?? '-'} chamadas (mediana).`);
  L.push(`Retrabalho: ${m.retrabalho.taxa}% dos cards voltaram (média ${m.retrabalho.media} por card).`);
  L.push(`Evidência falsa: ${m.evidenciaFalsa.recusados} relatos recusados por contradizer medição (${m.evidenciaFalsa.taxa}% dos ${m.evidenciaFalsa.relatados} relatos; ${m.evidenciaFalsa.medidos} fatos medidos).`);
  L.push(`Decisões tomadas por você por outros: ${m.decisoes.porOutros}, revertidas por você: ${m.decisoes.revertidas} (${m.decisoes.taxa}%).`);
  if (m.porAgente.length) L.push(`Chamadas por agente: ${m.porAgente.map((a) => `${nomeDe(a.agente)} ${a.chamadas} (${a.pct}%)`).join(', ')}.`);
  return L.join('\n');
}
