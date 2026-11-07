# Agente de entrevista experimental

Acesso pelo botão 🧪 na barra lateral da NECTAR ou `/entrevista.html`.
O Chrome permanece normal: o agente vê a tela compartilhada e controla entradas do Windows.
A página HTML de entrevista será criada em uma etapa posterior.

## Desafios no estilo HackerRank e LeetCode

O modo padrão do laboratório é Desafio de programação. Selecione o estilo HackerRank, LeetCode ou detecção visual, a dificuldade Easy/Medium/Hard e uma linguagem preferida. A dificuldade é uma classificação informada pelo pesquisador para comparar execuções, não uma garantia de resolução. Para perguntas de entrevista sem código, selecione o outro modo.

Deixe a linguagem em “Analisar o teste e escolher” para seleção automática. O agente deve verificar exigências do enunciado, stub, linguagem/versão atual e opções disponíveis no seletor. Uma exigência do teste prevalece sobre preferências. Sem linguagem obrigatória, avalia as opções segundo currículo, problema, bibliotecas e limites; não assume a linguagem inicial nem fica limitado às opções de preferência da NECTAR. Uma linguagem oferecida pela plataforma que não esteja no formulário da NECTAR também pode ser escolhida no modo automático.

A seleção deve ser confirmada visualmente em um quadro posterior ao clique. O acompanhamento e o relatório guardam as opções observadas, a linguagem selecionada, a evidência e uma justificativa curta. Código sem seleção confirmada é rejeitado e solicitado novamente ao modelo antes de qualquer digitação. A confirmação anterior é descartada ao avançar para outra questão. Essa confirmação vem da leitura visual do modelo; não é uma consulta ao DOM.

A digitação usa eventos de teclado por caractere, com ritmo configurável de 5 a 25 caracteres por segundo (padrão 12), pequenas variações no intervalo e pausas adicionais nas quebras de linha. Não usa clipboard nem insere o bloco pelo DOM. A velocidade é aproximada: latência do Windows/editor e pausas influenciam o tempo total. O relatório registra a velocidade escolhida. Durante a digitação, a rotina verifica o foco antes de cada evento de tecla; se o navegador perder o foco, interrompe o envio das teclas restantes. Essa interrupção pode deixar uma solução parcial no editor, que deve ser conferida antes da retomada.

O protocolo instrui o agente a ler todo o enunciado, exemplos, restrições e assinatura, escolher uma abordagem compatível com tempo/memória, preservar função/classe e driver da plataforma, editar, executar casos, interpretar erros, corrigir e submeter. Run/Run Code e Submit são etapas distintas; exemplos aprovados não comprovam aceitação final. Não consulta editoriais ou assistentes das plataformas.

Antes de cada ação identificada como Submit, o validador exige uma ação anterior de Run/Test executada, seguida de uma avaliação posterior aprovada com evidência visual e comparação do resultado. Clicar Run não vale como avaliar seu resultado. Casos pendentes, erros, ausência de avaliação ou resultado reprovado bloqueiam a submissão e geram feedback para nova análise, sem enviar o clique. Edição, correção, mudança de linguagem ou nova questão invalidam a avaliação. Uma submissão consome a aprovação: outra submissão exige nova execução e avaliação. O histórico compacto de validação preserva o ciclo mesmo após mais de 30 ações. Ações nativas que falharam não são consideradas executadas.

Essa checagem utiliza a intenção e as observações visuais informadas pelo modelo; não consulta o DOM nem identifica o botão por uma API da plataforma. Um clique erroneamente classificado pelo modelo como outra ação não é independentemente reconhecido como Submit. A avaliação fica registrada em avaliacaoTeste nos eventos e em ultimaAvaliacaoTeste no relatório.

O modelo pode conservar uma memória textual de até 24 mil caracteres do enunciado e da solução entre quadros. A ação codigo digita código multilinha no editor focado, com eventos Unicode e teclas Enter, sem clipboard. Atalhos de seleção, início/fim e desfazer permitem correções. Autocomplete, pares automáticos e indentação variam por editor; o agente recebe instruções para conferir e corrigir visualmente. Nenhuma API do editor é usada. A inserção completa em Monaco/HackerRank/LeetCode ainda requer validação prática.

O relatório inclui plataforma, dificuldade, linguagem preferida, modelo por ação, duração, contagens das ações identificadas como execução/submissão e vereditos observados. As contagens são classificações do modelo, não telemetria interna da plataforma. Os vereditos distinguem exemplos_ok, aceito, resposta_incorreta, erro_compilacao, erro_execucao, tempo_excedido e memoria_excedida. A conclusão em programação exige observação de aceite com evidência e uma ação anterior registrada como submissão. Essa checagem evita concluir só com os exemplos, mas não verifica o servidor do site de maneira independente.

Este recurso usa um protocolo visual para essas interfaces; não é uma integração certificada com as plataformas. Ainda não foi validado resolvendo problemas Easy, Medium e Hard nelas. Próxima validação: página de entrevista técnica com editor e resultados controlados.

O ambiente de resolução fica restrito ao conteúdo da plataforma: editor, arquivos/stubs e documentação fornecidos na página, exemplos, casos personalizados, console de resultados, Run/Test e Submit. Um terminal integrado à página pode ser usado quando fornecido pelo próprio teste. Não abre terminal do computador, IDE local, explorador de arquivos ou fontes externas para resolver o problema. A rotina de entrada do Windows confere o aplicativo em primeiro plano e bloqueia teclado em aplicativos que não sejam navegadores; cliques e rolagem também devem atingir a janela ativa do navegador. Isso delimita a janela, não verifica independentemente o domínio ou cada botão da página. A restrição ao conteúdo do teste também faz parte das instruções do agente.

Referências de navegação: https://candidatesupport.hackerrank.com/articles/9623161883-answer-coding-questions e https://support.leetcode.com/hc/en-us/articles/32442719377939-How-to-create-test-cases-on-LeetCode.

## Configuração

Conecte sua conta Claude ou Codex nos Ajustes da NECTAR. Não exige Ollama nem chave de API adicional.

No laboratório, selecione Claude Opus 5.5, GPT-6.1 Sol, GPT-6.1 Terra ou Automático. O modo automático tenta nessa ordem, passando ao seguinte em caso de indisponibilidade/erro. A seleção explícita não troca de modelo. O login confirma a conta; disponibilidade e cotas do modelo são confirmadas na chamada real. O relatório registra o modelo usado em cada ação e as falhas de tentativas anteriores.

A ponte visual reaproveita a descoberta de executáveis e o login da NECTAR, com entrada multimodal do Claude Code e Codex App Server. Currículo e quadros são enviados ao provedor selecionado. Não há arquivos locais de screenshot; as sessões de inferência usam modo sem persistência/efêmero. Ferramentas do Claude são desabilitadas; no Codex são desabilitados shell, apps, navegador, computer use, pesquisa web e visualizador de arquivos, com sandbox de leitura. A interação na tela passa apenas pelas ações validadas da NECTAR.

## Execução

1. Abra o laboratório no aplicativo NECTAR para Windows.
2. Informe o currículo em texto ou carregue PDF (até 10 MB), TXT ou Markdown. Confira o texto extraído no campo antes de iniciar. PDFs digitalizados sem texto selecionável precisam de uma versão com texto ou transcrição. O limite do texto é de 40 mil caracteres, sem corte silencioso.
3. Compartilhe a tela inteira onde está o Chrome e informe o limite de ações.
4. Clique em iniciar e coloque a entrevista de teste em primeiro plano durante os cinco segundos de preparação. A contagem aparece apenas dentro da NECTAR; nenhuma janela extra é aberta. O controle fica bloqueado até o fim da contagem.
5. Observe e faça suas anotações mantendo mouse e teclado livres (para anotações no próprio computador, use outra sessão/dispositivo). Use Parar ou Ctrl+Shift+F12 para interromper. O atalho cancela também uma análise pendente.
6. Baixe o relatório JSON. Ele contém horários e ações, incluindo textos digitados; guarde-o como dado do participante.

A execução não mostra indicadores flutuantes, avisos sobre o navegador ou janelas extras. Acompanhamento, contagem e motivos de parada ficam apenas na página da NECTAR. A NECTAR pode ficar minimizada; o navegador do teste precisa continuar visível na tela compartilhada. O processamento da janela não é reduzido quando ela fica em segundo plano. Fechar a NECTAR ainda encerra o agente.

Falhas de rede, timeout e respostas inválidas do modelo permitem até três análises consecutivas, sempre com um novo quadro e feedback do erro. Nenhuma ação inválida é executada. Falhas em cliques/digitação não são repetidas automaticamente. Parada manual, atalho, fim do compartilhamento, login/CAPTCHA e pedido explícito de interrupção continuam encerrando o controle. O motivo informado pelo modelo é apresentado.

O último encerramento e um resumo de eventos ficam em `data/entrevista-diagnostico.json` na pasta de dados do aplicativo e podem ser consultados em `/api/entrevista/diagnostico`. Esse diagnóstico não inclui o currículo, os quadros ou o texto das ações digitadas. O relatório completo continua disponível para download na página.

O agente recebe um quadro atual por decisão. Não usa DOM, clipboard, OCR separado ou arquivos de screenshot. Os quadros são imagens JPEG transitórias da transmissão, mantidas em memória e enviadas ao motor. A frequência de decisão depende da inferência: não é percepção de vídeo contínua. Digitação usa eventos Unicode de teclado, sem colar texto.

## Limites do experimento

Selecione uma tela inteira; controle por janela não é implementado. A entrevista precisa permanecer visível: este modo não opera um Chrome minimizado, não confina ações a uma janela e não permite usar simultaneamente a mesma área de trabalho. O laboratório fica processando enquanto o Chrome está em primeiro plano. Fechar a página encerra a execução. O atalho global desarma o controle, interrompe a entrada em andamento e cancela a análise pendente. Há limite de 300 ações e timeout de 90 segundos por tentativa de modelo (até 280 segundos no modo automático).

Conclusão é uma indicação do modelo baseada na imagem, não uma confirmação independente do sistema da entrevista. Currículo, estado e relatório ficam na memória da página; baixe o relatório antes de sair. Não há retomada após fechar o aplicativo. A qualidade visual, precisão dos cliques, DPI e compreensão dependem do modelo e precisam de validação na futura entrevista HTML.

## Verificação

`node tests/entrevista.mjs` valida o contrato de ações e a integração com resposta simulada. O teste não prova a capacidade do modelo visual nem a operação real de mouse e teclado.

Validação real nesta implementação: Opus 5.5 e GPT-6.1 Sol identificaram a palavra de uma imagem sintética enviada em memória pelas contas conectadas. Isso verifica o canal multimodal, não uma entrevista completa. GPT-6.1 Terra foi encontrado no catálogo, mas não recebeu uma chamada visual nesta validação.

Referências: https://learn.chatgpt.com/docs/app-server e https://code.claude.com/docs/en/cli-reference.
