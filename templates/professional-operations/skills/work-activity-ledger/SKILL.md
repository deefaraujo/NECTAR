---
name: work-activity-ledger
description: Consolida atividades de várias fontes no Work Evidence Ledger do projeto, com identificador estável, deduplicação e atualização incremental. Use em qualquer coleta ou reconstrução de histórico.
---

## Para que serve
Transformar o que aconteceu (commits, cards, issues, páginas, reuniões, e-mails) em registros verificáveis, sem inventar atividade.

## Como usar no app
- Consultar o que já existe: ação `evidencia.consultar` com `de`, `ate` (AAAA-MM-DD), e opcionalmente `fonte`, `tipo`, `texto`. O app devolve os registros no seu pedido seguinte.
- Coletar Git: `evidencia.coletar_git` com `de`, `ate` e, se souber, `autores` (e-mails ou nomes dela no Git). Lê a pasta alvo e as pastas extras do projeto. Só leitura.
- Coletar as equipes do projeto: `evidencia.coletar_quadros` com `de`, `ate`. Registra cards criados, movidos e concluídos das outras equipes.
- Registrar o que você leu numa fonte conectada (Jira, Notion, agenda, e-mail): `evidencia.registrar` com `itens`: [{ fonte, tipo, id_origem, url, ocorreu_em, resumo, autores, relacionados, verificacao }].

## Cada registro precisa ter
Identificador estável (o app gera a partir de fonte + id de origem + tipo), projeto, fonte, data em que ocorreu, data da coleta, tipo de evento, descrição factual curta, referência (id ou link), estado conhecido e verificação: `confirmado` (lido na fonte), `inferido` (deduzido, diga de quê) ou `nao_verificado`.

## Regras
- Registrar de novo o mesmo item não duplica: atualiza (idempotente).
- Item editado na fonte: registre de novo com a versão nova. Item apagado: `tipo: "removido"` (o app guarda a marca, não o conteúdo).
- Não registre segredo, senha, token nem conteúdo inteiro de e-mail ou mensagem; o resumo factual basta.
- Não infira atividade que a fonte não mostra.
