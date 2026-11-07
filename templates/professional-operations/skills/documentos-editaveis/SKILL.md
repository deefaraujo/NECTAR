---
name: documentos-editaveis
description: Gera PPTX e DOCX editáveis com python-pptx e python-docx, aplica o tema/slide mestre, adiciona notas do apresentador, exporta PDF pelo PowerPoint ou Word do Windows e confere o arquivo depois de gerado.
---

## Gerar
- PPTX: escreva um script Python em `entregas/<pasta>/gerar.py` usando python-pptx. Com template oficial, abra-o (`Presentation("modelo.pptx")`) para herdar o slide mestre; sem, use 16:9 (13,333 x 7,5 polegadas) e o tema provisório. Uma ideia por slide, título curto, no máximo 5 tópicos, notas do apresentador em `slide.notes_slide.notes_text_frame.text`.
- DOCX: python-docx, estilos de título nativos (Heading 1/2) para ter sumário.
- Gráficos: matplotlib salvo em PNG com fonte legível, ou gráfico nativo do python-pptx quando os dados forem simples.

- Armadilha conhecida (vista no teste): sem template oficial, o modelo padrão do python-pptx tem as caixas desenhadas para 4:3. Ao trocar para 16:9, reposicione título e corpo para a largura útil (por exemplo título em left=0,6", top=0,4", width=12,1"; corpo em left=0,6", top=1,6", width=12,1", height=5,2"), senão o título fica deslocado para a direita.

## Exportar PDF (Windows)
PowerShell: `$p = New-Object -ComObject PowerPoint.Application; $d = $p.Presentations.Open($pptx, $true, $false, $false); $d.SaveAs($pdf, 32); $d.Close(); $p.Quit()` (Word: SaveAs com formato 17). Se o Office não existir, diga que o PDF ficou pendente.

## Conferir (obrigatório)
Reabra o arquivo com python-pptx: conte slides, confira títulos e notas, e procure texto maior que a caixa. Renderize slides em PNG pelo PowerPoint (`$d.Slides.Item(i).Export($png, "PNG")`) e olhe os prints para achar texto cortado ou sobreposto. Só então registre o arquivo no MANIFEST.md.

## Regras
Nunca entregue imagem estática quando o pedido é editável. Nunca diga que gerou sem conferir. Falhou a exportação: entregue o PPTX e registre a falha.
