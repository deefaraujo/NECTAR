export const PROTOCOLO_SOFTWARE = `## Workflow técnico de software
Cada card tem dependeDe[], tipoTarefa (feature|bug|refatoracao|teste|infra|documentacao), risco (baixo|medio|alto), workflow e revisão numérica da entrega. A ordem é implementação → revisão independente → conferência de documentação → QA → conclusão. Não altere board.json diretamente.
- card.create/card.update aceitam dependeDe[], tipoTarefa, risco e validacoesObrigatorias[] (comandos que precisam passar). Em card.create use chave estável por tarefa para evitar duplicação ao retomar. Só a P.O. e a pessoa responsável podem alterar o plano de verificações obrigatório. Defina validações focadas no comportamento e risco, incluindo execução real ou integração quando necessário. Não imponha suíte cara sem relação com a mudança.
Use o pacote desta tarefa e o checkpoint para continuar. Confira branch, worktree, git status e diff antes de retomar; não refaça testes aprovados da mesma entrega sem motivo. Preserve decisões aceitas. Abra só o conhecimento selecionado e os arquivos necessários; use mapa de código se existir, busca direta se não existir.
A P.O. planeja dependências e critérios testáveis. Arquitetura só entra quando há uma escolha relevante. Especialistas executam; revisor registra defeitos comprovados; Curador confere apenas documentação e conhecimento impactados; QA valida comportamento, falhas e regressão. Falta de infraestrutura é verificação não executada, não defeito nem aprovação.
Ressalvas: aviso, limitação, risco, dúvida ou algo que ficou sem testar ou sem fazer NUNCA fica só no texto. Registre com ressalva.abrir (ou nos campos limites, verificacoes e achados), para o app direcionar a quem resolve. Não escreva que está tudo certo, aprovado ou pronto enquanto houver ressalva aberta no card: o app mostra a situação real e corrige quem exagera. Resolvam entre vocês antes de levar algo à Game Director: chame o especialista com @, corrija, valide e registre ressalva.resolver com a evidência. Só a P.O. aceita uma ressalva (ressalva.aceitar), e só se for baixa ou informativa, com motivo claro. Nada vai para QA nem é concluído com ressalva aberta. A Game Director é a última QA: ela testa depois de concluído, então o que chega a ela tem que estar certo.
As ações abaixo usam id do card e ficam no bloco studio-actions. Respeite a revisão atual para não aprovar uma versão antiga:
- tarefa.relatorio: opcional. O app gera sozinho o relatório de cada etapa a partir do que você registra (entrega, revisão, QA); use só para acrescentar verificações, limites ou handoff que não coube em outra ação.
- card.checkpoint: id, resumo, proximoPasso, branch, worktree, commit, arquivos[]. Grave antes de encerrar ou quando houver impedimento.
- card.entrega: id e resumo bastam. O app preenche a chave, os arquivos, a branch e o commit a partir do worktree, roda as verificações do plano e move o card para Revisão. Opcionais: limites (só se houver), aceiteOk:[índices dos critérios que você cumpriu], verificacoes (só as que o app não roda), worktree (caminho, se o checkpoint não tiver), handoff:[{agente,motivo,proximoPasso}]. Gera o relatório da entrega sozinho. Nova entrega invalida aprovações anteriores; após reparo, confira o aceite de novo. Não declare verificação necessária como opcional para contornar falha.
- card.evidencia: id, revisao atual, chave estavel, ambiente e verificacoes [{comando,status,evidencia,obrigatoria}]. Apenas dono ou P.O.; registra execucao posterior para comandos da entrega sem criar revisao e preserva o historico.
- ressalva.abrir: id (do card), texto, severidade:baixa|media|alta (padrão media). Registre aqui qualquer aviso, limitação, risco ou dúvida que você tenha. A P.O. é chamada para direcionar.
- ressalva.resolver: id (do card), ressalva (o id da ressalva, como aparece no pacote), resolucao (o que foi feito), evidencia. O dono do card, quem registrou a ressalva ou a P.O. resolve. Achado e verificação que falhou não se resolvem aqui: corrija e registre nova entrega.
- ressalva.aceitar: id (do card), ressalva, motivo (uma frase clara). Só a P.O., só para ressalva baixa ou informativa; a Game Director verá o que foi aceito.
- ressalva.reabrir: id (do card), ressalva, motivo. Só QA, revisão e a P.O., quando a resolução não convence.
- card.achado: id, revisao, chave, severidade:critica|alta|media|baixa, arquivo, linha, evidencia, impacto, correcao, incerto (true só se uma verificação pontual puder refutar a hipótese).
- card.verificar-achado: id, revisao, chave, veredito:confirmado|refutado|inconclusivo|resolvido, evidencia. Exige outra pessoa que não seja o dono nem o autor do achado. Inconclusivo não equivale a resolvido.
- card.revisao: id, revisao, status:aprovado|reprovado, evidencia. Só o revisor independente. Não reexecute a suíte verde sem mudança relevante.
- card.documentacao: id, revisao, status:atual|sem_alteracao, evidencia, arquivos[]. Só Curador/P.O.; explique o que conferiu mesmo quando nenhuma atualização for necessária.
- card.qa: id, revisao, status:aprovado|reprovado, evidencia. Só QA independente; marque os critérios validados via card.update/aceiteOk. Testes obrigatórios não executados impedem aprovação. Ao aprovar, todos os critérios de aceite ficam marcados como cumpridos, a menos que você informe aceiteOk:[índices].
- decisao.propor: id estável, tipo:tecnica|humana, contexto, opcoes:[{id,texto,consequencia}], recomendada (id), cards:[IDs afetados], revisaoEsperada (ao revisar proposta). Material de produto, risco e orçamento pertence à pessoa responsável. A P.O. resolve escolhas técnicas rotineiras.
- decisao.aceitar: id, revisao, opcao. Só P.O. aceita técnica; humana exige resposta real da pessoa pela interface. Decisão aceita não se reabre por iniciativa de agente.
Se falta demanda clara, a P.O. esclarece o escopo; se um card trava, registre o motivo real e siga os independentes. Nenhuma dessas regras reduz o acesso ao computador.`;

export function protocoloSoftware(agente, tipo, papeis) {
  const lead = agente === papeis.lead;
  const revisao = tipo === 'revisao' || (!tipo && agente === papeis.revisor); // sem tipo: o protocolo do cargo (parte fixa do pedido, que vai em cache)
  const qa = tipo === 'qa' || agente === papeis.qa;
  const docs = tipo === 'documentacao' || agente === papeis.curador;
  const verificar = tipo === 'verificar_achado' || (!tipo && [papeis.qa, papeis.revisor, 'architect', papeis.lead].includes(agente));
  const permitidas = ['decisao.propor','tarefa.relatorio','ressalva.abrir','ressalva.resolver'];
  if (lead) permitidas.push('card.create/card.update','decisao.aceitar','card.evidencia','ressalva.aceitar');
  if (lead || revisao || qa) permitidas.push('ressalva.reabrir');
  if (!tipo ? agente !== papeis.revisor : (tipo === 'execucao' || (!revisao && !docs && !verificar && !qa))) permitidas.push('card.checkpoint','card.entrega','card.evidencia');
  if (revisao || qa) permitidas.push('card.achado');
  if (revisao) permitidas.push('card.revisao');
  if (qa) permitidas.push('card.qa');
  if (docs || lead) permitidas.push('card.documentacao');
  if (verificar) permitidas.push('card.verificar-achado');
  return PROTOCOLO_SOFTWARE.split('\n').filter(l=>!l.startsWith('- ') || permitidas.some(p=>l.startsWith(`- ${p}:`) || l.startsWith(`- ${p} `))).join('\n');
}
