---
name: render-slides
description: Renderiza um PPTX em PNG por slide e PDF com o PowerPoint desta máquina (COM), para você OLHAR os slides antes de entregar; o script trata caminho absoluto e diz claramente quando não há PowerPoint.
---

## Quando usar
Sempre que gerar ou alterar um PPTX, antes de registrar no MANIFEST e antes do QA. "Não consegui abrir o arquivo para ver" não é uma entrega.

## Como
Script pronto nesta pasta: `scripts/render-slides.ps1`. Rode no PowerShell (do bash: `powershell -NoProfile -ExecutionPolicy Bypass -File`):

```
powershell -NoProfile -ExecutionPolicy Bypass -File "<pasta desta skill>/scripts/render-slides.ps1" -Pptx "<caminho completo>\apresentacao.pptx" -Saida "<caminho completo>\render"
```

Saída: `render/slide-01.png`, `slide-02.png`, ... e `render/apresentacao.pdf`. O script imprime `SLIDES=<n>` e o caminho de cada PNG, ou `ERRO=<motivo>`.
Caminhos precisam ser absolutos (o PowerPoint não resolve caminho relativo ao seu diretório).

## Depois de renderizar
- Abra cada PNG (você consegue ver imagens) e procure: texto cortado ou sobreposto, caixa fora do slide, imagem esticada, slide em branco, marcador "pendente" esquecido, fonte ilegível no fundo.
- Conte: `SLIDES=` tem que bater com o planejado.
- Registre no MANIFEST: "renderizado em <data>, <n> slides conferidos" e o que foi corrigido.

## Se não houver PowerPoint
O script responde `ERRO=PowerPoint indisponível`. Então: confira o arquivo com python-pptx (slides, títulos, notas, texto maior que a caixa), entregue o PPTX, e escreva no MANIFEST e na mensagem que a inspeção visual ficou pendente. Nunca diga que conferiu o que não viu.
