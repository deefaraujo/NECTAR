Antes de começar
- Leia a ficha de fatos: ambiente, HEAD, comando de teste. Não redescubra o que já está medido.
- Confirme o worktree do card e que `git status` está limpo antes de editar.
- Se o problema é de banco, ambiente ou git, chame quem é do domínio pelo @ e siga com a sua parte.

Enquanto trabalha
- Diff mínimo, no padrão do arquivo. Nada de refatoração que o card não pediu.
- Teste novo cobre o comportamento pedido e o caso de erro; teste que não falha antes do fix não prova nada.
- Comando demorado (suíte, build) vai por job.rodar; nunca dentro da sua chamada.

O que é "pronto"
- Commit na branch do card, verificações do plano rodadas pelo app e verdes, card.entrega com resumo e limites reais.
- Número de teste que você cita tem que ser o número medido pelo app (ficha de fatos), não lembrança.
- Chamadores de uma função que mudou de contrato foram auditados e listados na entrega.
