---
name: assets-abertos
description: Achar, conferir a licença, baixar e registrar assets de terceiros (UI, fundos, sprites, fontes, som, música) para um jogo que vai ser publicado — fontes confiáveis, API de busca, ferramenta de download com manifesto de créditos.
---

# Assets abertos para jogo publicável

Jogo que vai para a loja não sai com provisório nem com arte de licença duvidosa. Quando o projeto não tem o asset, a equipe procura, confere a licença **na página original**, baixa com a ferramenta desta skill e registra o crédito. Arte final de personagem continua vindo da designer ou da geração aprovada; aqui é o resto: UI, fundos, ícones, fontes, efeitos sonoros, música, partículas.

## Ferramenta: `scripts/baixar.py` (só biblioteca padrão; roda por job.rodar)
```
python -X utf8 -I "<pasta desta skill>/scripts/baixar.py" URL --para assets-fonte/<slug> --licenca CC0-1.0 --origem "<página onde conferiu>" --autor "<quem>" [--atribuicao "<texto de crédito, obrigatório em CC-BY>"]
```
- Baixa, extrai zip na própria pasta (recusa zip que tenta escrever fora), grava `ORIGEM.json` (url, origem, licença, autor, data, sha256, lista de arquivos) e acrescenta a linha em `assets-fonte/MANIFESTO.md`, que vira a tela de créditos do jogo.
- Sem `--licenca` aceita (CC0-1.0, CC-BY-4.0/3.0, CC-BY-SA-4.0, OFL-1.1, MIT, Apache-2.0, BSD-3-Clause, Unlicense) ela não baixa. Licença fora da lista, "free", "royalty-free" de loja, imagem de busca do Google: pare e pergunte à dona.
- `assets-fonte/` fica fora de `game/` (não entra no build). O que o jogo usa é copiado para `game/images/ui/`, `game/audio/` etc. depois de passar pela skill renpy-sprites quando for sprite.
- Testada em 07/11/2026 com o UI Pack da Kenney pelo OpenGameArt: 1315 arquivos, CC0.

## Onde procurar (conferido em 07/11/2026)
| o quê | fonte | licença | como |
|---|---|---|---|
| UI (botões, painéis, ícones, barras), fontes de UI | Kenney, https://kenney.nl/assets (os pacotes também estão em https://opengameart.org/users/kenney com link direto `/sites/default/files/kenney_<pacote>.zip`) | CC0 | o site da Kenney baixa por botão com JavaScript; use o link direto do OpenGameArt |
| Fundos, sprites, tiles, efeitos | OpenGameArt, https://opengameart.org/art-search-advanced?keys=<termo>&field_art_type_tid[]=9 (9 = 2D art; licença no filtro `field_art_licenses_tid[]`: 4 = CC0, 17 = CC-BY 3.0) | varia: ler na página | o arquivo está em `/sites/default/files/<nome>` na página do asset |
| Qualquer imagem ou som por palavra | API Openverse, `https://api.openverse.org/v1/images/?q=<termo>&license=cc0&page_size=20` e `/v1/audio/?q=<termo>&license=cc0` (JSON com `url`, `license`, `creator`, `foreign_landing_url`) | filtre `license=cc0` ou `by` | WebFetch lê o JSON; baixe pela `url`; `foreign_landing_url` é a origem a registrar |
| Fontes | Google Fonts, arquivo direto em `https://github.com/google/fonts/raw/main/ofl/<familia>/<Arquivo>.ttf` (listar em https://github.com/google/fonts/tree/main/ofl) | OFL-1.1 | conferir se tem os glifos do pt-BR (renpy-codigo) |
| Efeitos sonoros e loops | Freesound via Openverse (`provider=freesound`) ou https://freesound.org (conta para baixar o original; a prévia mp3 vem pelo Openverse) | filtrar CC0 | para o jogo, converter para OGG/OPUS |
| Pacotes de VN (fundos, GUI, sprites) | itch.io, https://itch.io/game-assets/free/genre-visual-novel | cada página diz; muitos são "só com crédito" ou "não comercial": ler | download exige conta em alguns; se exigir, passe o link para a dona |
| Tutoriais de efeito e UI | feniksdev.com, fórum Lemma Soft (Creator Discussion e Cookbook), doc do SDK | — | só texto; vídeo não dá para assistir: diga que não viu |

## Regras
- Conferir a licença **na página original**, não no agregador. Registrar a URL da página em `--origem`.
- CC-BY: o crédito vai no jogo (tela de créditos com o `MANIFESTO.md`) e o texto exigido vai em `--atribuicao`. CC-BY-SA só para o que não vai virar derivado fechado: evitar. NC (não comercial) não serve para jogo publicado. Sem licença escrita, não serve.
- Nada de dado pessoal nem de conta nos arquivos salvos; tirar `.DS_Store`, `Thumbs.db`, pastas de preview enormes antes de copiar para `game/`.
- Asset baixado é matéria-prima: redimensionar, reconverter (WEBP para fundo, OGG para som), recortar e padronizar antes de usar. Fonte: embutir o `.ttf` em `game/fonts/` com o arquivo de licença ao lado.
- Cada card que traz asset novo termina com: pasta em `assets-fonte/`, linha no `MANIFESTO.md`, arquivo final em `game/` e o nome de imagem que o roteiro usa.
- Quando nada servir, a saída é imagem gerada (imagem.gerar, com estilo da ficha) ou pedido à designer, nunca "fica o provisório".
