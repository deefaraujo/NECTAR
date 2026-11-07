---
titulo: Regras da equipe de jogos
---
Estas regras são a base de qualquer projeto de jogo. Valem para todo o time, e a Game Director pode acrescentar regras do projeto e de cada agente por cima.

## Cânone e referência
- O cânone do jogo (personagens, mundo, tom, regras de mecânica) vem da Game Director e dos arquivos do projeto. Ninguém inventa cânone: o que não existe nos documentos vira pergunta, uma só, objetiva.
- Quando existe uma referência pronta (documento de design, protótipo anterior, projeto irmão), estude-a inteira antes de construir e diga o quanto se baseou nela.
- Humor, voz e estilo são do projeto, não do agente. Leia o que já foi escrito antes de escrever mais.

## Ren'Py 2D para celular
- Motor padrão: Ren'Py 8.5.3 (SDK em <RENPY_SDK>), alvo celular (Android; iOS só com Mac). Orientação e resolução saem da ficha Jogo e não mudam sem a Game Director.
- Validação por job.rodar, nunca dentro da chamada: lint limpo, o trecho rodando, e print com RENPY_VARIANT="touch small mobile android". Lint não pega erro de execução.
- Toque: nada depende de hover, botão grande e afastado, texto legível na variante small.
- Estado em default, constante em define, labels únicos, arquivos por assunto (game/cenas, game/sistemas). Arte-fonte grande fica fora do build.
- Sprite: mesmo canvas, mesma base e uma escala por lote (skill renpy-sprites); ajuste sai em _padronizado/ e só substitui o original com aval.

## Cards, pesquisa e documentação
- Todo pedido vira card pequeno com critério que a Game Director confere no celular. As fichas da aba Produção (Jogo, Estilo, Personagem, Cenário, Tela, Cena, Sistema, Documento) são o cânone vivo: anote nelas o que foi decidido.
- "Como se faz" e "como está o nosso" vão para a Pesquisa, com fonte. A documentação de consulta mora em docs/ (design.md, guia-visual.md, pesquisa/, analises/, decisoes/): atualize em vez de duplicar.

## Nível de produto, não protótipo
- O alvo é um jogo publicado na loja. Protótipo com provisório é fase, nunca entrega final: um card de feature só fecha quando a tela está com arte e UI definitivas, som, efeito, texto revisado e print na variante de celular.
- Falta asset? A equipe procura, confere a licença na página original, baixa com a ferramenta da skill assets-abertos e registra no MANIFESTO.md (vira a tela de créditos). Falta técnica? Pesquisa na doc do SDK, no fórum Lemma Soft e em tutoriais (skill da Pesquisa), aplica no projeto e prova com print. "Não tinha" e "ficou o provisório" não são respostas.
- UI é feita com kit e moldura de 9 fatias, botão com todos os estados e retorno ao toque (skill renpy-ui-acabada). Efeito visual e partícula nas cenas que pedem (skill renpy-vfx). Som de interface e trilha com licença registrada.
- Checklist de polimento por tela: legível no celular, nada sobrepondo texto, alvo de toque grande, transição de entrada e saída, estado vazio e de erro tratados, desabilitado visível, sem provisório, sem texto em inglês do modelo (Start, Back, Prefs) na UI final.
- Marcos com build Android instalado no aparelho e a matriz mínima de teste da skill renpy-mobile. O que nunca rodou é tratado como quebrado.

## Protótipo antes da arte
- O fluxo inteiro (telas, cenas, escolhas, saves, loop de jogo) é prototipado primeiro com provisórios nomeados (ex.: `PROV_heroi_idle`, `PROV_fundo_taverna`). Arte final só entra quando o fluxo está provado jogável.
- Todo provisório tem nome estável e entra numa lista; quem faz a arte substitui pelo nome, sem mexer no fluxo.

## Entrega e verdade
- Cada card entrega algo jogável, visível ou lido, com evidência: print, vídeo curto, trecho de script, resultado de teste ou caminho do arquivo. Sem evidência, não conclui.
- Registre no card (card.update, campos.evidencias) o que foi entregue e onde está, marque os critérios cumpridos e mova para revisão. Diga quando não conseguiu; não repita a mesma tentativa.
- Ajuste é diff mínimo: ninguém reescreve cena, script ou arquivo inteiro para um retoque. Refatoração grande só com card próprio e aprovação da Game Director.
- QA testa jogando: caminho feliz, escolhas, saves e carregamentos, voltas e erros. O relato diz o que foi testado e o que não foi.

## Autonomia
- Com o piloto ligado, execute a demanda clara até revisão e QA. Sem demanda executável, aguarde; não invente trabalho nem reabra decisão tomada.
- Decisões de rotina dentro do escopo são do especialista e do P.O. Direção criativa, escopo, cânone e dependência de terceiros são da Game Director: proponha e espere.
- Ferramentas externas (motor, Figma, geração de imagem, Unreal) entram pelo agente de MCP (mcp.pedir) ou pelas skills; nada de instalar ferramenta por conta própria.

## Economia
- Card pequeno (1 a 3 pontos). Chame um especialista por vez, na ordem das dependências. À Game Director, poucas linhas, só decisão, bloqueio ou conclusão.
- Não copie documento inteiro para o chat: cite o caminho e o trecho que importa.

## Conversa
Colegas de estúdio: direto, curto, com o nome das coisas. O P.O. é a voz do time para a Game Director.

## Revisão olha a tela, não só a lista
Print é evidência só depois de olhado como jogador. Antes de aprovar qualquer card com tela, quem revisa confere no print: personagem do tamanho da cena (rosto e mãos acima da caixa) e cada um no seu lugar, sem dois sobrepostos; nome e fala inteiros, sem corte nem texto encostado na moldura; texto legível no tamanho de celular; nada fora da paleta; o fundo e o personagem certos para a cena. Achou um desses, devolve com o print marcado, mesmo que todos os critérios do card estejam "ok". Print de tela montada à mão ou do arnês não vale: só da cena real, no jogo rodando como o jogador abre. Antes de entregar qualquer card que mexe em `game/`, rode o verificador `checar_assets.py` (skill renpy-codigo): arquivo citado que não existe, provisório ou teste no build não sai da sua mão.

## Estúdio, não fábrica de jogo genérico
A equipe é dona da experiência, não só da execução. Antes de quebrar o conteúdo em cards, a P.O. roda a sessão de direção de experiência (skill direcao-de-experiencia): por que alguém baixaria, primeiros 3 minutos, verbos próprios do jogo, atmosfera, tensão sem jump scare, momentos bonitos e o que cortar. Diálogo com "próximo" não é jogabilidade: todo jogo tem pelo menos um verbo que o jogador faz com as mãos e que só existe nele. A interface pertence ao mundo do jogo. Cada especialista, ao pegar um card, diz em 2 linhas o que faria para o jogo ficar memorável, e faz se couber.

## Cena pronta é cena encenada
Transcrever as falas é metade. A direção do roteiro (o que se vê, ouve, a luz, a pausa, quem entra, a expressão) vira código na mesma cena: `scene`, `show` com posição e expressão, `play` em camadas, `pause`, transições e efeitos. Direção deixada em comentário não é entrega, e o verificador do app barra cena assim. Quem transcreve marca o que falta encenar; a cena só fecha quando quem encena (VN, game feel, som) entregou o print da cena real com o clima pedido. A abertura recebe o maior cuidado: é nela que o jogador decide se continua.
