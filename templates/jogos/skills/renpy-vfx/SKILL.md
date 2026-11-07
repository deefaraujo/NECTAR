---
name: renpy-vfx
description: Efeitos visuais em Ren'Py 8.5 sem engine externa — partículas (neve, chuva, pétalas, poeira), aura e brilho aditivo, flash, tremor de tela, vinheta, parallax, título animado; receitas testadas, custo no celular e onde aprender mais.
---

# VFX em Ren'Py

Exemplo completo em `exemplos/vfx.rpy` com teste e prints em `exemplos/testes_vfx.rpy` (lint limpo, teste passando no SDK 8.5.3). Cada efeito é ATL ou `SnowBlossom`, sem Python de desenho: roda igual no celular.

## Receitas (todas no exemplo)
| efeito | como | custo no celular |
|---|---|---|
| Neve, pétalas, poeira, bolhas, chuva | `image neve = SnowBlossom(sprite, count, xspeed, yspeed, border, start, fast)`; o sprite pode ter ATL próprio (`At(img, girando)`) | baixo até ~150 sprites; acima disso cai quadro em aparelho fraco |
| Aura, brilho mágico | cópia do sprite atrás com `blur`, `zoom 1.08`, `additive 0.8`, `matrixcolor TintMatrix(cor)`, alpha pulsando em `block: repeat`; `show heroi as aura at center, aura("#7ad7ff") behind heroi` | `blur` é caro: um por cena, nunca em lista de sprites |
| Flash de dano ou mágica | `define flash = Fade(0.05, 0.0, 0.4, color="#fff")` e `with flash` | nenhum |
| Tremor da cena inteira | `show layer master at tremor_tela(forca, tempo)` e `show layer master` para parar | nenhum |
| Vinheta, escurecer | `Solid` por cima com `alpha` baixo, `zorder` alto, ou `blur` numa borda | baixo |
| Parallax de fundo | fundo com `zoom 1.1` e `linear 12.0 xalign 1.0` | nenhum |
| Título de capítulo | `text` com `zoom 2.5 alpha 0.0` e `easeout_back 0.35 zoom 1.0 alpha 1.0`, `outlines` | nenhum |
| Pulso de botão | `on hover/idle` com `linear 0.08 zoom 1.03` | nenhum |
| Sépia, noite, flashback | `matrixcolor SepiaMatrix()`, `TintMatrix("#446")`, `SaturationMatrix(0)`, interpolando com `linear 2.0 matrixcolor ...` | baixo |

## Quando precisa de mais
- Muitas partículas com comportamento próprio: `SpriteManager` com `update` em Python (doc `sprites.html`), ainda rápido porque cada displayable é renderizado uma vez.
- Shader próprio (distorção, dissolve em padrão, luz): `renpy.register_shader` com GLSL (doc `model.html` e `shader_parts.html`). Só com aprovação da dona e teste em aparelho real: driver de celular aceita coisa errada em silêncio.
- Texto com shader (ondulação, brilho): `{shader=...}` (doc `textshaders.html`).
- Dissolve em padrão de imagem: `ImageDissolve("mascara.png", 1.0)`.
- Live2D e 3D stage existem; fora do escopo de celular leve.

## Regras
- Efeito é sempre nomeado (`transform`, `image`, `define`) num arquivo `game/sistemas/vfx.rpy`: história não tem número solto.
- Nada de efeito que obscureça o texto ou o botão (skill auditing-game-screen-readability). Partícula fica em `zorder` abaixo do diálogo.
- Evidência: print no momento do efeito (pause antes do screenshot: transform que começa em `alpha 0.0` sai invisível no primeiro quadro) e, se mexer em desempenho, medição no aparelho.
- Aprender mais: doc do SDK (`atl.html`, `sprites.html`, `transitions.html`), feniksdev.com (máscaras, colorização) e os exemplos da skill renpy-recursos.
