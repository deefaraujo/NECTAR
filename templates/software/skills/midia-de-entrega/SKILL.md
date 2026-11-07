---
name: midia-de-entrega
description: Quando a Assessoria (ou a Game Director) pede imagem, vídeo ou links de uma entrega para uma apresentação: como capturar a tela certa com Playwright, gravar um fluxo curto, nomear os arquivos e listar issue, MR, commit e documentação, na pasta que pediram.
---

## O pedido
Vem pelo @ (sala espelhada com a Assessoria) ou na sala dos líderes, com: a lista do que mostrar (tela, estado, dado), a pasta de destino
(caminho completo, dentro da pasta da equipe de Assessoria) e o prazo. Falta algo no pedido? Pergunte uma vez, objetivamente, e faça o que já está claro.

## Capturar imagem (PNG)
1. Suba o app como o projeto manda (README ou `package.json`); use o ambiente de desenvolvimento ou de teste, nunca produção com dado real de cliente.
2. Com Playwright (o do projeto, se existir em `node_modules`; senão o da ferramenta): `page.setViewportSize({ width: 1440, height: 900 })`, navegue até a tela, prepare o estado (dado de exemplo realista, nada de "teste 123"), espere o carregamento terminar e `page.screenshot({ path, fullPage: false })`.
3. Esconda o que não deve aparecer (e-mail real, token, nome de cliente): use dado de exemplo ou borre antes de entregar.
4. Confira o PNG aberto: é a tela pedida, no estado pedido, sem spinner, sem erro no canto.

## Gravar vídeo (MP4, até 60 s)
Playwright grava com `recordVideo: { dir, size: { width: 1440, height: 900 } }` no `browser.newContext`; faça o fluxo devagar (pausas de 600 ms entre passos para quem assiste acompanhar) e feche o contexto para salvar. O arquivo sai `.webm`; converta com `ffmpeg -i entrada.webm -c:v libx264 -pix_fmt yuv420p saida.mp4` quando houver ffmpeg; sem ffmpeg, entregue o `.webm` e diga.

## Nomear e entregar
- `midia/<card ou issue>-<o-que-mostra>.png|mp4` (ex.: `T-016-tela-revisao-publicacao.png`).
- `LINKS.md` na pasta pedida: por entrega, issue (chave e URL), MR ou commit (URL do remoto quando houver; senão o hash e a branch), documentação (caminho no repositório ou página), build ou ambiente onde dá para ver.
- Responda a quem pediu com a lista do que foi entregue, o que não deu (e por quê) e onde está. Só diga "entregue" depois de ver os arquivos na pasta.

## Limites
Só leitura nos repositórios para links e histórico (git log, git show, git remote). Nada de commit, push ou mexer na branch de alguém para tirar o print. Não invente link: se não existe MR, diga que a mudança está só na branch.
