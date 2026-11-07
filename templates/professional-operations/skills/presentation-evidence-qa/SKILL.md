---
name: presentation-evidence-qa
description: Valida slide a slide se cada afirmação e métrica tem fonte no ledger, aponta afirmações sem sustentação e decide o status de QA; inclui inspeção visual do arquivo renderizado.
---

## O que conferir
- Cada afirmação relevante: id de evidência ou marcação clara de interpretação.
- Cada métrica: origem verificável e período certo.
- Atribuição: bate com a matriz de contribuições.
- Datas e nomes: coerentes com as fontes.
- Arquivo: abre, quantidade de slides, notas presentes, nada cortado ou sobreposto, contraste legível (renderize: veja a skill documentos-editaveis).

## Saída
Tabela slide | afirmação | evidência | status (ok, sem fonte, divergente) | correção. Status final: aprovado, aprovado com ressalvas ou reprovado.

## Regras
Erro crítico de evidência reprova. Não altere dado para melhorar resultado. Não altere a evidência original.
