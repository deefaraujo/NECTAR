---
name: pacote-apresentacao
description: O padrão mínimo de uma apresentação entregue pela Assessoria (Review, projeto, briefing): cada entrega com imagem ou vídeo e link, roteiro de fala, orientações para apresentar, perguntas prováveis, render conferido. Diz como conseguir mídia e links com a equipe que construiu a coisa.
---

## Por que esta skill existe
Uma Review sem imagem das entregas, sem link para a documentação e sem roteiro de fala é um esqueleto: a Game Director sobe no palco
sem material. O pacote abaixo é obrigatório em /work-review e /project-presentation. Falta algo? Não é "pronto": é "pronto com pendência X",
e a pendência vem listada no MANIFEST e na mensagem de entrega.

## O pacote (o que sai na pasta entregas/<data>-<assunto>/)
1. `apresentacao.pptx` editável, renderizado e conferido (skill render-slides).
2. `midia/` com uma imagem (PNG) ou vídeo (MP4, até 60 s) por entrega apresentada. Nome: `<card ou issue>-<o que mostra>.png`.
3. `ROTEIRO.md`: fala slide a slide, na voz dela, com duas versões (completa e curta) e o tempo de cada uma. As mesmas notas vão em `slide.notes_slide` do PPTX.
4. `ORIENTACOES.md`: como apresentar: ordem, quanto tempo em cada bloco, onde parar para perguntas, o que NÃO afirmar (resultado não medido, trabalho de outra pessoa), números-chave com fonte, pessoas na sala e o que cada uma costuma perguntar (quando a agenda ou o Teams disserem).
5. `PERGUNTAS.md`: perguntas prováveis (como hipótese) com a resposta curta e a evidência.
6. `LINKS.md`: para cada entrega, os links: issue (Jira), merge request ou commit, documentação (repositório, Notion), página publicada ou build, quando existirem.
7. `MANIFEST.md`: cada arquivo, o que é, de quais evidências saiu, e as pendências.

## O slide de entrega (padrão)
- Título = o resultado em uma frase ("Revisão e publicação têm tela própria"), não o nome da tarefa.
- Imagem ou vídeo da coisa funcionando. Sem mídia: o slide recebe um marcador visível "imagem pendente: <quem vai mandar>" e a pendência entra no MANIFEST.
- Uma linha de valor para quem assiste (o que muda para o usuário, o time ou o negócio), marcada como medido ou esperado.
- Rodapé pequeno: link(s) e id da evidência.
- Nota do apresentador com a fala daquele slide.

## Como conseguir mídia e links (quem construiu é quem mostra)
1. Liste o que precisa: por entrega, "tela X no estado Y, com dado Z", "vídeo do fluxo A até B", "link do MR e da documentação".
2. Peça à liderança da equipe que construiu, pelo @ (sala espelhada entre as equipes) ou na sala dos líderes, numa mensagem só, com a lista e a pasta de destino (`entregas/<data>-<assunto>/midia/`, caminho completo). A equipe de software tem a skill midia-de-entrega e sabe capturar com Playwright e listar os links.
3. Enquanto espera, monte o resto. Não trave o pacote por uma imagem: entregue com o marcador e a pendência.
4. Links que você mesma consegue: issue do Jira (conexão do app: a chave vira URL na base do site), commits e branches (`evidencia.coletar_git`), páginas do Notion (`notion-project-knowledge`). Confira que o link abre antes de colocar.

## Antes de dizer que está pronto
- Rode o render (skill render-slides) e olhe cada PNG: texto cortado, imagem esticada, marcador "pendente" esquecido, slide vazio.
- QA de evidências (presentation-evidence-qa) passou ou reprovou com a lista do que corrigir.
- A mensagem de entrega para a Game Director tem: o que está no pacote, o que ficou pendente e de quem depende, e as 3 coisas que ela precisa saber antes de apresentar.
