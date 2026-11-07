---
name: renpy-ui-acabada
description: UI de produto em Ren'Py 8.5 com kit de UI de terceiros — moldura de 9 fatias, botão com estados (idle, hover, apertado, desabilitado), barra, caixa de marcar, janela de diálogo com moldura, fonte do kit, retorno tátil; exemplo testado com o UI Pack da Kenney.
---

# UI com acabamento de produto

Exemplo em `exemplos/ui_acabada.rpy` (lint limpo, teste `exemplos/testes_ui.rpy` com prints) usando o UI Pack da Kenney (CC0, baixado com a skill assets-abertos). Ele espera os arquivos em `game/images/ui/` com nomes do jogo (`botao_idle.png`, `painel.png`, `barra_cheia.png`...) e a fonte em `game/fonts/`.

## O que faz uma UI parecer produto
- **Moldura de 9 fatias**: `Frame("images/ui/painel.png", Borders(16, 16, 16, 16))` estica só o meio; cantos ficam nítidos em qualquer tamanho. Toda caixa, botão e janela usa isso, nunca `Solid`.
- **Estados do botão**: `background`, `hover_background`, `selected_background`, `insensitive_background` e cores de texto para cada um. Botão sem estado desabilitado visível é bug.
- **Retorno ao toque**: `on hover` (no celular é o toque) `zoom 1.03` em 0.08 s e volta. Som de clique em `config.default_button_sound` ou `activate_sound`.
- **Um estilo, muitos botões**: `style botao_kit is button:` e `style botao_kit_text is button_text:`; a tela só diz `style "botao_kit"`. Nada de propriedade visual repetida em cada `textbutton`.
- **Tamanho por `gui` e fração**: `xsize 0.75`, `yminimum 96`, `gui.scale`; na variante `small` o kit cresce junto.
- **Fonte com personalidade** do kit ou do Google Fonts, com os acentos conferidos, aplicada em `font` dos estilos (`gui.text_font`, `gui.button_text_font`).
- **Janela de diálogo**: `screen say_kit(who, what)` com moldura, nome com ícone e `Character(..., screen="say_kit")`; ou altere a `say` de `screens.rpy` de propósito.
- **Barra e caixa**: `bar` com `left_bar`/`right_bar` em `Frame` do kit e `thumb None`; `imagebutton` com `idle`/`selected_idle` e `selected expressao`.
- **Hierarquia**: título maior, um botão primário por tela, destrutivo pede confirmação, desabilitado explicado.

## Pipeline
1. Ficha Estilo visual define paleta e kit. Baixar o kit com assets-abertos (licença registrada no `MANIFESTO.md`).
2. Copiar só os arquivos usados para `game/images/ui/` com nome do jogo; fonte para `game/fonts/` com a licença ao lado.
3. Montar os estilos num arquivo `game/telas/estilos_kit.rpy`; as telas usam os estilos.
4. Testar na variante de celular (renpy-mobile) e tirar print; conferir legibilidade (auditing-game-screen-readability).

## Armadilhas que o exemplo já pegou
- `%` numa fala que tem `[interpolação]` vira código de formato e estoura na execução (lint avisa): escreva `%%`. `[valor:.0%]` também não existe: calcule em `$` e interpole o inteiro.
- `Frame` precisa de bordas menores que metade da imagem; um botão de 192x64 aceita até 16/32.
- `selected` em `imagebutton` quer expressão, não string.
- Na `say` própria, `style` escrito no `text what id "what"` é ignorado: o estilo do texto vem do `Character(..., what_style="fala_kit")`, e o `say_dialogue` do gui tem `xpos`/`ypos` fixos que empurram o texto.
- Kit com várias cores: escolha uma família (Grey para neutro, Blue para primário) e registre na ficha Estilo visual.
