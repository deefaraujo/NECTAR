---
name: renpy-sprites
description: Ajustar sprites para Ren'Py mobile — medir, recortar, padronizar escala e base, fatiar folha de animação, reduzir para celular, folha de conferência, layeredimage.
---

# Sprites para Ren'Py (2D, celular)

Ferramenta: `scripts/sprites.py`, ao lado deste arquivo (Pillow). Roda por **job.rodar**, nunca dentro da sua chamada:

```
python -X utf8 -I "<pasta desta skill>/scripts/sprites.py" info game/images/personagens/ana
```

Ela **nunca sobrescreve a entrada**: tudo vai para `--saida`. Você confere e só então troca, com o aval de quem é dona da arte.

| comando | para quê |
|---|---|
| `info <arquivos/pastas>` | tamanho, área útil, margens, peso. Avisa **SEM TRANSPARÊNCIA** (fundo faz parte da imagem: não serve como sprite até tirar o fundo). |
| `recortar <entrada> --saida P [--margem 4]` | tira a transparência sobrando |
| `fatiar <folha.png> --saida P --grade 4x2` | corta folha de animação em quadros `nome_01.png...` (pula célula vazia) |
| `padronizar <entrada> --saida P --altura 1600 --canvas 1200x1800` | mesmo canvas, pés na mesma linha de base, centralizado. Padrão: **uma escala para o lote** (a figura mais alta fica com `--altura`): certo para quadros de animação e expressões, que não podem mudar de tamanho entre si. `--por-figura`: cada uma com a mesma altura (personagens diferentes na mesma régua). |
| `reduzir <entrada> --saida P --fator 0.5` | versão menor para celular, mesmo nome |
| `folha <entrada> --saida f.png [--colunas 6]` | folha de contato com a linha de base marcada: **sempre abra e olhe** antes de dizer que ficou certo |

Medidas da `info` são a evidência (área útil e margem de base iguais = alinhado; diferença de 1 px é arredondamento).

## Regras
- Alfa até 16 conta como poeira de recorte (halo), não como figura.
- Arte enorme (arte-fonte de 4K ou mais) não vai para o jogo: reduza para o tamanho em que aparece na tela. No celular, sprite de personagem raramente precisa passar da altura da tela do jogo.
- Personagem: mesmo canvas, mesma base, mesma escala em todas as expressões e poses. Compare na folha com o modelo aprovado.
- Nunca mexa no original da designer; a saída fica ao lado (ex.: `game/images/personagens/ana/_padronizado/`) até ela aprovar.
- Provisório tem nome estável (`PROV_ana_neutra`); a arte final entra com o mesmo nome de imagem no Ren'Py.

## Ren'Py
- Nome de imagem: `image ana feliz = "personagens/ana/feliz.png"` ou arquivo em `game/images/` com nome em minúsculas e espaço (`ana feliz.png` vira a imagem `ana feliz`).
- Muitas expressões/roupas: `layeredimage` (corpo + `group` de roupa + `group` de rosto com `attribute`); as camadas precisam do mesmo canvas, por isso padronize antes.
- Animação de quadros em ATL: `image ana anda:` com `"ana_anda_01.png"`, `pause .08` ... `repeat`.
- Posição: canvas padronizado + `xalign .5 yalign 1.0` (ou `left/right`) dispensa ajuste por imagem.
- Pixel art: `config.nearest_neighbor = True` e escala inteira.
