---
name: fluxos-assessoria
description: Catálogo de fluxos da Assessoria (Review mensal, daily, apresentação, relatório, reunião, decisões, handover, case, autoavaliação, comparação de Reviews, briefing executivo, apresentação com marca): quem entra, em que ordem, com quais skills e gates.
---

# Fluxos

A Helena escolhe o fluxo pelo pedido e chama só quem precisa. Em todo fluxo: se uma fonte estiver indisponível, segue com as outras e registra a lacuna no relatório de cobertura; se faltar algo que só a Game Director sabe (público, prazo), pergunta uma vez, objetivamente.

## /work-review — Review de atividades por período (fluxo principal)
Gatilho: "prepare meu Review de outubro", "Review do mês".
1. Contexto (Helena): período, projetos, empresa, objetivo e público, identidade visual, fontes autorizadas. Usa o Project Registry e o Review anterior antes de perguntar. Gate 1.
2. Coleta (Rafa + Otávio): `evidencia.coletar_git` dos projetos, `evidencia.coletar_quadros` das equipes, Jira/Notion pelo MCP quando conectados, agenda e e-mail quando o Outlook estiver conectado; tudo registrado no ledger. Skills: work-activity-ledger, source-management, search-strategy, knowledge-synthesis. Gate 2.
3. Linha do tempo e contribuições (Lívia + Caio). Skills: digest, work-activity-ledger, contribution-attribution. Gate 3.
4. Análise (Bianca + Diego + Sofia): resultados, limitações, riscos e próximos passos. Skills: review-intelligence, metrics-review, validate-data, risk-assessment. Gate 4.
5. Narrativa (Téo + Marina). Skills: stakeholder-update, internal-comms. Gate 5.
6. Arquitetura dos slides (Luana): função, mensagem, evidência e nota de cada slide.
7. Produção (Nico + Clara): PPTX editável na identidade certa. Skills: documentos-editaveis, ppt-template-creator, brand-presentation-registry, theme-factory, data-visualization. Gate 6 e 7.
8. QA (Vera): fonte de cada afirmação, métricas, atribuições, arquivo e inspeção visual. Skill: presentation-evidence-qa. Reprovou: volta para quem produziu, com a correção.
9. Reunião (Paulo + Júlia): roteiro completo e curto, perguntas prováveis como hipótese. Skill: presentation-rehearsal.
10. Entrega (Helena): PPTX, PDF se pedido, resumo executivo, roteiro, perguntas, relatório de fontes, pendências e MANIFEST.md. Gate 8.
Saídas: entregas/<data>-review-<periodo>/. Aprovação: nenhuma para gerar; compartilhar é com ela.

## /enterprise-work-review — Review usando Jira, Notion, agenda e e-mail
Igual ao /work-review, com a etapa 2 explícita por fonte: saúde das conexões (enterprise-sync-health), Jira (jira-work-history: issues, changelog, comentários), Notion (notion-project-knowledge), agenda e e-mail (teams-project-context), correlação entre fontes (cross-source-correlation: vínculo explícito é fato, sugerido é hipótese). Entrega também o relatório de cobertura por fonte e as limitações da integração.

## /work-status — daily, weekly, status update
Rafa coleta o período curto (ontem/semana) → Lívia resume → Helena entrega texto curto (feito, fazendo, travado). Sem slides. Skill: standup, status-report. Gates 2 e 8.

## /project-presentation — apresentação de um projeto
Contexto do projeto (Otávio) → análise (Bianca, Diego) → narrativa (Téo) → slides (Luana) → PPTX (Nico, Clara) → QA (Vera) → roteiro (Júlia).

## /work-report — relatório técnico, executivo ou administrativo
Coleta e análise → Marina escreve (MD, DOCX ou PDF, skill documentos-editaveis) separando fato, análise, hipótese e recomendação → Vera valida.

## /work-analytics — métricas e evolução
Diego com validate-data e metrics-review; gráficos planejados com data-visualization; sem métrica sem origem.

## /meeting-prep — preparar reunião
Paulo lê a reunião na agenda (participantes, pauta, descrição) e o contexto dos projetos citados → briefing, pauta, pontos de fala, perguntas prováveis (hipótese) → Júlia faz o roteiro se houver apresentação.

## /decision-log — decisões, justificativas e pendências
Otávio recupera decisões (quadros, Notion, e-mails) com origem e data → Sofia lista pendências e quem decide (se a fonte disser).

## /project-handover — transferência de contexto
Otávio (contexto, decisões, documentos) + Lívia (histórico) + Sofia (pendências, riscos) → Marina escreve o documento.

## /portfolio-case-study — case profissional
Só com trabalho autorizado. Caio confirma a autoria; Téo e Marina escrevem; Vera remove ou generaliza dado confidencial do empregador ou cliente. Material público exige aprovação dela.

## /career-review — autoavaliação
Caio monta a matriz de contribuições com evidência; Diego o impacto medido; Marina escreve. Skill: performance-review.

## /review-diff — comparar com o Review anterior
Lívia compara o ledger do período com o Review anterior: novas entregas, mudanças, problemas resolvidos, pendências que continuam.

## /executive-briefing — resumo para a liderança
Téo e Marina: uma página, mensagens-chave com fonte, riscos e decisões pedidas. Skill: stakeholder-update.

## /brand-presentation — apresentação na identidade da empresa
Clara escolhe a identidade pela ordem das regras e registra no Brand & Presentation Registry; Nico produz; Vera confere conformidade.

