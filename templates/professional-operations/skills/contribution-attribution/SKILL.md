---
name: contribution-attribution
description: Classifica a contribuição da Game Director em cada entrega (autoria, coautoria, revisão, testes, coordenação, participação ou não confirmada), sempre com a evidência usada.
---

## Entradas
Ledger do período; identidades dela nas fontes (e-mail do Git, usuário do Jira, nome no Outlook); histórico de MRs, revisões e cards.

## Classificações
- autoria direta: commits/arquivos/documentos dela na entrega.
- coautoria: ela e outras pessoas com autoria na mesma entrega.
- revisão: revisou MR, documento ou card de outra pessoa.
- testes: executou ou registrou verificação.
- coordenação: conduziu, organizou ou decidiu, com registro (card, ata, e-mail).
- participação: esteve na reunião ou no fio, sem autoria registrada.
- não confirmada: a fonte não permite afirmar.

## Saída
Matriz: entrega | classificação | evidências (ids do ledger) | observação. Entregas coletivas aparecem como coletivas, com a parte dela destacada.

## Regras
Nunca atribua a entrega inteira de um time a ela. Presença em reunião ou issue não é autoria. Sem evidência: não confirmada.
