---
name: cross-source-correlation
description: Relaciona evidências de fontes diferentes que pertencem ao mesmo trabalho, separando vínculo explícito (fato) de vínculo sugerido (hipótese).
---

## Vínculo explícito (fato)
Chave de issue citada (ABC-123), link direto, id de documento, card que referencia outro, commit que cita a issue.

## Vínculo sugerido (hipótese)
Título parecido, mesmo período, mesmo projeto, mesmas pessoas. Sempre com justificativa e marcado como hipótese.

## Saída
Registre o vínculo no campo `relacionados` da evidência; o app também detecta chaves de issue sozinho. Nunca apresente hipótese como fato.
