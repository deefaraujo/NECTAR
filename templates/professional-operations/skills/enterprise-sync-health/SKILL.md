---
name: enterprise-sync-health
description: Diagnostica as conexões (autenticação, permissão, disponibilidade, última verificação) antes de uma coleta e explica o que falta em linguagem simples.
---

## O que olhar
O estado de cada conexão vem no pedido (conectado, login vencido, sem permissão, bloqueado pela empresa, com erro). Login vencido ou bloqueio: avise a Game Director com a ação simples ("reconecte o Jira em Ajustes > Conexões").

## Regras
Nunca diga que dados estão sincronizados se a coleta falhou ou foi parcial.
