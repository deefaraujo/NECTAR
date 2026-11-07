---
name: renpy-codigo
description: Escrever e validar código Ren'Py 8.5 — estrutura do projeto, script, screens, ATL, armadilhas confirmadas, lint, rodar e tirar print para evidência.
---

# Código Ren'Py (8.5.3)

SDK desta máquina: `<RENPY_SDK>`. Documentação local em `doc/` do SDK (html): consulte antes de afirmar API.

## Estrutura
- `game/script.rpy` (história), `game/screens.rpy` (telas), `game/gui.rpy` (tamanhos e cores), `game/options.rpy` (nome, versão, build). Arte em `game/images/`, som em `game/audio/`.
- Separe por assunto: `game/cenas/cap01.rpy`, `game/sistemas/inventario.rpy`. Rótulo (`label`) com nome único no jogo inteiro.
- Estado do jogo em `default` (entra no save e no rollback); constante em `define`. Nunca `$ x = ...` solto para criar variável de estado.
- Dados que valem entre partidas: `persistent.`.

## Rodar, validar, provar
Sempre por job.rodar:
```
"<sdk>\renpy.exe" "<projeto>" lint
"<sdk>\renpy.exe" "<projeto>" run
```
- Não passe `renpy.py` como argumento do `renpy.exe` (dá NotADirectoryError).
- `lint` pega sintaxe de screen e imagem inexistente, **não** pega NameError de runtime: rode o trecho também.
- Erro de execução fica em `traceback.txt` e `errors.txt` na raiz do projeto: leia antes de tentar de novo.
- Evidência visual: `renpy.screenshot(caminho)` fotografa a TELA. Para print automático, um `timer` dentro da screen que você quer fotografar, ligado por variável de ambiente (sem ela o jogo roda normal):
  `if os.environ.get("JOGO_PRINT"): timer 1.0 action [Function(renpy.screenshot, "prints/menu.png"), Quit(confirm=False)]`
- Teste automático (`testcase` no rpytest): cada caso corta em 5 s; não existe `advance N`, use `advance until screen "x"` ou `pause`.

## Armadilhas confirmadas
- `Text("[OK]")` interpreta colchete como variável: use `substitute=False` ou `[[`.
- Em screen, `"[dic[chave]]"` não funciona: resolva antes em `$ nome = dic["chave"]`.
- `text "a" if x else "b":` é inválido: calcule antes com `$`.
- `key "x" action A if cond` não existe: `if/else` com um `key` em cada ramo.
- ATL não tem `if`; `rotate` aumenta a caixa e empurra os vizinhos (prenda num `fixed` com `xysize`).
- `text ... alpha .5` não existe: use cor com alfa `"#ffffff88"`.
- ATL com parâmetro recebe o filho por `child=`.
- `Transform(ysize=..., fit="contain")` com só um lado encolhe: calcule `zoom`.
- Displayable guardado em `default` de screen entra no save; guarde só números e monte o desenho num cache.
- Fonte sem acento (ex.: Press Start 2P não tem `í`): confira os glifos do pt-BR antes de adotar.
- Editar `.rpy` por heredoc de shell estraga `\n` em string: escreva o arquivo direto.

## Jogo que não é só VN
- Mini-jogo/ação: Creator-Defined Displayable (`renpy.Displayable`), lógica em passo fixo dentro de `render()`, `renpy.redraw(self, 0)`, `event()` devolve valor para encerrar o `call screen`. Desligue rollback durante (`config.rollback_enabled = False` no trecho) e use `modal True`.
- Toque: o celular manda eventos de mouse; arraste com `drag`/`draggroup`, gestos em `config.gestures` (doc "Gestures").

## Estilo de mudança
Menor diff que resolve; siga nomes e organização existentes; nada de reescrever `screens.rpy` inteiro para mudar um botão: crie a screen/estilo novo ao lado e troque o uso.

## Verificador de arquivos (rode antes de entregar; o app também roda na revisão)
`python -X utf8 -I "<pasta desta skill>/scripts/checar_assets.py" <raiz do projeto>`: lista todo arquivo de imagem, som ou fonte citado nos `.rpy` que não existe, todo provisório (`PROV_`, placeholder) ainda referenciado e todo arquivo de teste dentro de `game/` (vai para o build). O lint não pega nada disso: o erro só aparece na tela do jogador ("Couldn't find file..."). Código 1 = não entregue.
