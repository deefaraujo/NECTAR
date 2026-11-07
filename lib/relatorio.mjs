// Daily report: the app computes, from the board and the cards' history, what moved since the
// start of the day. No model call. If the Game Director wants, the P.O. comments on the report
// afterwards (option in Settings); the number itself never depends on a model.
const inicioDoDia = (d = new Date()) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };

export function montarRelatorio({ quadro, perguntasAbertas = [], uso = null, pausas = {}, nomeDe = (x) => x, manual = false, desdeData = null }) {
  const desde = desdeData || inicioDoDia();
  const cards = quadro.listar();
  const foiHoje = (iso) => iso && Date.parse(iso) >= desde.getTime();
  const lin = (c) => ({ id: c.id, titulo: c.titulo, dono: c.dono ? nomeDe(c.dono) : null, pontos: c.pontos || 0, prioridade: c.prioridade });

  const concluidos = cards.filter((c) => c.coluna === 'concluido' && foiHoje(c.naColunaDesde)).map(lin);
  const movimentos = cards.reduce((s, c) => s + c.historico.filter((h) => foiHoje(h.em) && /^[^:]+ para [^:]+/.test(h.txt)).length, 0);
  const criados = cards.filter((c) => foiHoje(c.criado)).length;
  const prio = { alta: 0, normal: 1, baixa: 2 };
  const prog = quadro.progresso();

  const dados = {
    tipo: 'relatorio',
    data: new Date().toISOString().slice(0, 10),
    hora: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
    manual,
    desde: desde.toISOString(),
    concluidos,
    pontosHoje: concluidos.reduce((s, c) => s + c.pontos, 0),
    movimentos,
    criados,
    andamento: cards.filter((c) => c.coluna === 'andamento').map(lin),
    emRevisao: cards.filter((c) => ['revisao', 'qa'].includes(c.coluna)).map(lin),
    bloqueados: cards.filter((c) => c.bloqueio).map((c) => ({ ...lin(c), motivo: c.bloqueio })),
    aguardandoVoce: cards.filter((c) => c.aguardando).map(lin),
    proximos: cards.filter((c) => ['pronto', 'backlog'].includes(c.coluna) && !c.bloqueio)
      .sort((a, b) => (prio[a.prioridade] - prio[b.prioridade]) || (a.coluna === 'pronto' ? -1 : 1)).slice(0, 4).map(lin),
    perguntas: perguntasAbertas.length,
    progresso: { pontosFeitos: prog.pontosFeitos, pontosTotal: prog.pontosTotal, pct: prog.pct, semEstimativa: prog.semEstimativa },
    uso: uso ? { cinco: uso.cinco?.pct ?? null, sete: uso.sete?.pct ?? null } : null,
    pausas: Object.keys(pausas),
  };
  dados.teveMovimento = !!(concluidos.length || movimentos || criados || dados.bloqueados.length || perguntasAbertas.length);
  return dados;
}

/** The same report as running text, for the notification and for the P.O. to comment on. */
export function textoRelatorio(d, nomeProjeto = '') {
  const l = [];
  l.push(`Relatório do dia${nomeProjeto ? ` de ${nomeProjeto}` : ''}, ${d.hora}.`);
  l.push(d.concluidos.length
    ? `Concluído hoje: ${d.concluidos.map((c) => `${c.id} ${c.titulo}`).join('; ')} (${d.pontosHoje} pontos).`
    : 'Nada foi concluído hoje.');
  if (d.andamento.length) l.push(`Em andamento: ${d.andamento.map((c) => `${c.id}${c.dono ? ` (${c.dono})` : ''}`).join(', ')}.`);
  if (d.emRevisao.length) l.push(`Esperando revisão ou QA: ${d.emRevisao.map((c) => c.id).join(', ')}.`);
  if (d.bloqueados.length) l.push(`Bloqueado: ${d.bloqueados.map((c) => `${c.id} (${c.motivo})`).join('; ')}.`);
  if (d.aguardandoVoce.length || d.perguntas) l.push(`Precisa de você: ${d.perguntas || d.aguardandoVoce.length} ${(d.perguntas || d.aguardandoVoce.length) === 1 ? 'pergunta' : 'perguntas'} em aberto.`);
  if (d.proximos.length) l.push(`Próximos: ${d.proximos.map((c) => `${c.id} ${c.titulo}`).join('; ')}.`);
  if (d.progresso.pontosTotal) l.push(`Projeto: ${d.progresso.pontosFeitos} de ${d.progresso.pontosTotal} pontos concluídos (${d.progresso.pct}%).`);
  if (d.uso) l.push(`Créditos: sessão ${d.uso.cinco ?? '?'}%, semana ${d.uso.sete ?? '?'}%.`);
  return l.join('\n');
}
