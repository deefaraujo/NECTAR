---
name: renpy-mobile
description: Ren'Py para celular (Android/iOS) — variantes de tela, toque, resolução e orientação, texto legível, desempenho, testar no PC como celular, build Android pela linha de comando.
---

# Ren'Py no celular

Conferido no SDK 8.5.3 desta máquina (`<RENPY_SDK>`). Ren'Py roda em Android 5.0+.

## Resolução e orientação
- `gui.init(largura, altura)` em `gui.rpy` define a tela do jogo. Retrato: `gui.init(1080, 1920)`; paisagem: `gui.init(1920, 1080)`. Decida no início: mudar depois refaz toda a UI.
- Orientação do Android vai no `android.json` do projeto (gerado pelo launcher em Android > Configure): `"orientation": "sensorLandscape"` ou `"sensorPortrait"`.
- Arte pensada para a resolução escolhida; o Ren'Py escala o resto.

## Variantes de tela (o celular escolhe sozinho)
- Variantes: `small` e `phone` (celular), `medium` e `tablet` (tablet), `touch`, `mobile`, `android`, `ios`, `pc`, `web`.
- Screen alternativa: `screen quick_menu():` com `variant "touch"`; a versão com variant ganha da sem.
- Estilo/tamanho: em `gui.rpy` existe `@gui.variant def small():` (texto 30, caixa de texto 240...) e `def touch():`. Ajuste ali, não espalhe `if`.
- Condição no código: `if renpy.variant("small"):`.
- Hover não existe no toque: nada importante pode depender de passar o mouse. Toque produz evento de mouse só enquanto o dedo está na tela.
- Botão de toque grande (na ordem de 1 cm na mão: em 1080 de largura, uns 100 px ou mais) e afastado do vizinho.
- Texto: `gui.text_size` na variant small; leia na tela do celular, não no monitor.
- `renpy.input()`: teclado do celular sem autocompletar; evite input de texto longo.

## Testar no PC como celular
- Variável de ambiente `RENPY_VARIANT` (lida em `renpy/main.py`): `RENPY_VARIANT="touch small mobile android"` faz o jogo escolher as variantes de celular no desktop. Por job:
  `set RENPY_VARIANT=touch small mobile android&& "<sdk>\renpy.exe" "<projeto>" run` (Windows cmd)
- O launcher também emula Phone/Tablet (Android > Emulation): mouse vira toque só com botão apertado, Esc = menu, Page Up = voltar.
- Emulador não mede dedo: teste final é no aparelho.

## Desempenho e tamanho
- Imagem no tamanho em que aparece; WEBP para fundos grandes; evite PNG de 4K no `game/`.
- Pasta de arte-fonte fora de `game/` ou excluída do build (`build.classify("game/arte-fonte/**", None)`).
- Áudio em OGG/OPUS.
- Jogo grande: ver "Very Large Games" no doc do Android (Play Asset Delivery).

## Build Android (linha de comando)
Pré-requisitos uma vez só (pelo launcher): JDK 21, Install SDK, Generate Keys (guarde `android.keystore` e `bundle.keystore` com backup: sem eles não publica atualização), Configure.
```
"<sdk>\renpy.exe" launcher android_build "<projeto>"            # APK
"<sdk>\renpy.exe" launcher android_build "<projeto>" --bundle   # AAB para a Play Store
... --install / --launch   # instala e abre no aparelho ligado por USB (modo desenvolvedor)
```
Rode por job.rodar com limite de 30+ minutos. Ícones: `android-icon_foreground.png` e `android-icon_background.png`, e `android-presplash.jpg` na raiz do projeto.
- Licença LGPL das bibliotecas do RAPT: o doc pede um texto na descrição do app (ver seção "Required Language" do doc Android).
- iOS: precisa de Mac com Xcode (doc ios.html); daqui só se prepara.

## Achados de campo no Android (fontes: guia de localização Android de Ly1NG114/renpy-localization-skill e lista de armadilhas MIT de mawen0317/renpy-vn-engineering)
- **Vídeo**: só VP8/VP9 em WebM (ou OGV). H.264 que toca no PC fica **preto** no Android, sem erro. `Movie` com caminho errado também fica preto em silêncio: confira na execução.
- **Nome de arquivo**: acento ou caractere fora do ASCII em arquivo de `game/` pode ficar de fora do pacote Android e só estourar numa rota profunda. Nomes de arquivo em minúsculas, sem acento, sem espaço.
- **Fonte**: a fonte do jogo tem que ter todos os glifos do pt-BR (confira com Pillow antes de adotar). A tela de erro do Ren'Py usa outra fonte: quadrados ali não provam que a fonte do jogo falha.
- **Assinatura**: atualização instalada com outro certificado falha com `INSTALL_FAILED_UPDATE_INCOMPATIBLE`. Nunca "resolva" desinstalando: primeiro faça backup dos saves do aparelho (slots, `persistent`), depois instale com a mesma chave. Perdeu a chave, perdeu a possibilidade de atualizar o app publicado.
- **Evidência honesta**: diga o que foi testado com estes rótulos: *estático* (lint, build), *fumaça* (abriu, menu, primeiras falas), *rota* (um caminho de jogo inteiro reproduzido), *regressão* (os caminhos que já falharam). Abertura limpa não prova capítulo 3, QTE nem galeria.
- **Matriz mínima** antes de entregar um build: abrir do zero sem traceback; configurações, salvar, carregar, autosave; fala longa e escolha; uma mídia (imagem trocada, vídeo, dois loops de música); o loop principal; uma rota de falha; um mini-jogo; os caminhos que já quebraram.
- **Tamanho de pacote**: arte-fonte fora do build (`build.classify`), imagem no tamanho de tela, WEBP para fundo, OGG/OPUS para som.

## Antes de dizer pronto
- `renpy.exe <projeto> lint` sem erro (lint não pega NameError de runtime: rode também).
- Print com `RENPY_VARIANT` de celular mostrando a tela pedida.
