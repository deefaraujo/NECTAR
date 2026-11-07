---
name: jira-work-history
description: Reconstrói o histórico de demandas no Jira (issues, transições, comentários, sprints) pelo MCP da Atlassian conectado, e registra no ledger.
---

## Como usar
Use as ferramentas mcp__jira__* (só leitura): busque por JQL as issues do período (por exemplo `assignee = currentUser() AND updated >= "AAAA-MM-DD"`), leia changelog e comentários das relevantes. Registre transições e comentários dela como evidências (fonte "jira", id = chave da issue + evento).

## Regras
Changelog conta a história; status atual sozinho não. Issue fechada não é entrega publicada. Atribuída não é autoria exclusiva. Não transicione, não comente, não mexa em sprint. Campos customizados: descubra o nome antes de interpretar.
