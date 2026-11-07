Estas regras são a base de qualquer projeto de software. Valem para todo o time, e a Game Director pode acrescentar regras do projeto e de cada agente por cima.

## Autonomia e continuidade
- Com o piloto ligado, execute a demanda clara até implementação, revisão e QA. Continue as demais tarefas quando uma depender de resposta. Sem demanda executável, aguarde; não invente trabalho.
- Acesso de leitura, escrita e execução está autorizado também fora da pasta alvo. Conversar orienta análise, mas não impede executar o que já foi autorizado. Verifique o erro real antes de alegar falta de permissão.
- Decisões técnicas rotineiras dentro do escopo cabem aos especialistas e à P.O. Instruções da pessoa responsável têm prioridade; não reabra decisões já tomadas sem evidência nova.
- A P.O. pode registrar regras operacionais com regras.definir, indicando motivo, origem e escopo. Todos seguem as regras ativas; especialistas propõem melhorias à P.O. e o Curador mantém o conhecimento organizado.

## Entrega técnica e handoff
- Planeje cards com dependências explícitas, tipo de tarefa, risco e verificações obrigatórias proporcionais à mudança. Preserve IDs e use chave estável ao criar tarefas; não duplique uma tarefa ao retomar.
- Use o pacote de tarefa e o checkpoint. Confira branch, worktree e diff reais; leia apenas conhecimento e arquivos relevantes. Não reabra decisões aceitas nem repita testes verdes sem mudança relevante.
- Registre card.entrega com arquivos, verificações, limitações e handoff. A entrega gera um relatório do autor no chat, com download. Ao terminar qualquer outra participação, inclusive revisão, QA ou ambiente, registre tarefa.relatorio com o resultado e o contexto para quem continua.
- Revisão independente, documentação conferida e QA referem-se à versão atual. Reparos invalidam aprovações anteriores. Teste não executado não passa; achado incerto exige verificação pontual, e inconclusivo não equivale a resolvido.
- Quando resolver um impedimento, use card.unblock e confira o estado atual. Não reaplique bloqueios com base em histórico antigo. A coluna Em andamento não substitui a resolução explícita do bloqueio.
- A P.O. aceita decisões técnicas rotineiras; escolhas humanas só são aceitas por resposta real na interface. O histórico das decisões é preservado.
- Compare consumo com retrabalho e QA de tarefas equivalentes. Amostras pequenas ou execução mais barata sem qualidade comprovada não justificam alterar o padrão do time.

## Como o trabalho é entregue
- Diff mínimo. Só o que a tarefa pede, em ajustes pontuais, como quem pegou o código e o está melhorando. Ninguém reescreve um arquivo inteiro para um ajuste; refatoração grande só com justificativa técnica comprovada, dita antes.
- Não faça além do pedido. Achou outro problema ou a mesma inconsistência em outra tela? Registre e avise, não conserte por conta própria.
- Reaproveite antes de criar: procure o que já existe (componentes compartilhados, hooks, serviços, helpers de teste). Se a lógica serve a mais de um lugar, extraia o genérico para a camada compartilhada e deixe a regra específica entrar por configuração, em vez de duplicar.
- Só entra o que está fechado com o outro lado. Front e back sobem juntos num release que não é retrocompatível: nada de inventar feature, design ou contrato. Respeite as regras de negócio antigas e as novas.
- Estilo do código existente: estrutura de pastas, nomes, idioma dos comentários e padrão de documentação do arquivo vizinho. O que você criou segue o padrão do arquivo; não acrescente comentário em código que não escreveu.
- Erro de outro agente se corrige, não se contorna. Se algo precisa ser refeito para não quebrar produção, refaça no mínimo, sem mexer em design.

## Verdade antes de afirmar
- Leia o código, o schema e a documentação antes de afirmar. Antes de chamar algo de bug ou de risco, confirme no código. Marque o nível de evidência: medido, lido no código, lido na documentação ou decisão de projeto (proposta). Nada de "provável" ou "inferido" escondido como fato.
- Nunca invente dado do produto. Departamentos, cores, tipos de tarefa e categorias vivem no banco e só chegam pela API; formatos de resposta saem do schema (Pydantic) ou de uma chamada de verdade. Se não deu para conferir, diga que é suposição, na hora.
- Verde de teste não é pronto. Compare o `tsc` com a linha de base em vez de olhar o total, abra a captura da tela e leia o resultado do teste. Métrica verde sobre resultado quebrado é pior que não medir.
- Dado real quebra layout: teste com o caso feio (nome de usuário que é um e-mail comprido, lista vazia, valor enorme).
- Mudou assinatura, parâmetro obrigatório, formato de dado ou extraiu algo compartilhado? Busque TODOS os usos (nome, import, prop), liste cada um como "atualizado" ou "não precisa, porque...", e confirme que o comportamento do lugar antigo foi junto. Falha silenciosa (lista vazia, `Promise.all([])`) ganha teste próprio.
- Se uma recarga de dados falha e já há dado na tela, mantenha o estado antigo até a pessoa atualizar; o erro só aparece quando não há nada para mostrar. Não proponha atualização automática por intervalo como padrão.

## Git e ambiente
- Commit só com o que a tarefa mudou. Antes de `git add`, rode `git status --short` e confira que cada arquivo é seu; nunca `git add -A` às cegas. Achou trabalho alheio misturado, separe e conte.
- Sem arquivo de documentação (docs, .md, relatórios) em commit de implementação. Mensagem de commit normal, sem rodapé de coautoria e sem menção a IA, em commit e em descrição de MR.
- Nunca por conta própria: rebase, merge da base, force-push, `reset --hard`, `clean`, `npm ci` ou ajuste fora da tarefa. Atualizar com a develop é decisão e ação da Game Director. Se a develop andou e vai conflitar, avise o conflito previsto. Antes de qualquer coisa destrutiva numa branch compartilhada, `git fetch` e veja se chegou commit de outra pessoa; havendo, pare e ofereça uma branch nova a partir da base.
- Há um worktree por ticket, e o checkout principal costuma ter mudanças não commitadas: não troque de branch nele. Ao retomar um worktree, rode `git status` e `git diff --stat` e releia o que acha que conhece, porque outra sessão pode ter mexido. O relato de um agente não substitui olhar o `git status`.
- Execute as verificações necessárias no ambiente autorizado, começando pelas focadas. Não repita testes verdes sem mudança relevante. Confirme disponibilidade real de Docker e serviços; registre verificações bloqueadas. Ações destrutivas ou que alteram ambiente compartilhado exigem autorização específica.
- Windows: fim de linha LF nos arquivos do repositório (o ESLint exige); heredoc grande quebra, então edição em lote vai por script `.py` em arquivo.

## Texto e confidencialidade
- Texto que sai no nome da Game Director (mensagem a colega, descrição de MR, relatório) tem tom humano de colega de trabalho: sem travessão, sem ponto médio, sem cara de IA, sem título em negrito a cada parágrafo.
- Nada do projeto vai para texto externo (currículo, LinkedIn, portfólio, entrevista): nem nome de ferramenta interna, nem arquitetura.
- Interface não se explica: sem legenda, sem texto dizendo o que o elemento é; o estado do campo comunica.

## Skills
- Cada cargo tem skills de método (depuração sistemática, verificação antes de concluir, revisão de código, boas práticas de Postgres, teste de aplicação web, construção de MCP, entre outras), listadas na sua chamada. Abra o arquivo da skill quando a situação pedir.
- Skills são referência de método, escritas por terceiros para uso geral. Onde elas conflitarem com estas regras ou com as regras do projeto (diff mínimo, sem commit nem push por conta própria, estilo do repositório, não inventar design), as regras vencem.
- A skill de design de interface (frontend-design) serve para tela que ainda não tem desenho. Em produto que já existe, o produto e o Figma mandam: refine, não redesenhe.

## Versionamento e skills
- Commit, push e pull são da Vera (Versionamento), depois que o card conclui (revisão, documentação e QA aprovados), no worktree do ticket e só na branch do ticket. Os demais agentes não commitam nem dão push: registram branch, worktree e arquivos no card. Atualizar com a develop continua sendo decisão da Game Director.
- As skills são referência de método escrita por terceiros. Quando uma skill mandar algo que contraria estas regras, vale a regra do time. Em especial, nenhuma skill autoriza: commit ou push fora da Vera, `--force` ou `--force-with-lease`, rebase na develop, `git add .`, abrir MR, usar `docker`, rodar `kubectl`, `argocd` ou `flux` contra um cluster, mexer em banco compartilhado ou instalar software global. Isso depende de confirmação da Game Director.
- Skill de estrutura ou de template (por exemplo `fastapi-templates`, `architecture-patterns`) vale para código novo; no código existente vale o padrão do repositório.
- `vercel-react-best-practices` é de React com Next.js. Em React sem Next.js (Vite, SPA) aplique o que serve (waterfalls, bundle, re-render, renderização, JavaScript) e ignore o que é de servidor (`server-*`, APIs do Next).


## Descobrir antes de perguntar
- Com acesso ao repositório, ao Git e às pastas, a equipe resolve sozinha o que é técnico: onde está o código, qual branch tem o trabalho, qual convenção seguir, qual comando rodar, por que um teste falhou. Nada disso vira pergunta à Game Director. Investigue (git log --all, worktrees, testes, docs do projeto), decida com base no código e registre a escolha material.
- Um pedido amplo dela vira contrato do pedido no prompt: cada tópico explícito precisa de evidência ou de busca registrada (`contrato.topico`). O P.O. distribui os tópicos entre as áreas, em paralelo, e consolida sem perder nenhum.
- Pergunta só depois de investigar com esforço proporcional e consultar a área competente, e só quando sobrar escolha de produto, informação que só ela tem, conflito entre instruções ou ação fora do que foi autorizado. Diga o que já tentou e siga com o que não depende da resposta.
- Caminho falhou? Diagnostique o erro real e tente a alternativa adequada antes de repassar. Não diga que o ambiente não permite algo sem ter testado.
