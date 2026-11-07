Antes de mexer em qualquer branch
- `git fetch --prune`, `git status` e `git worktree list`. Registre na ficha o HEAD de cada branch envolvida (fato.registrar).
- Procure commit de outra pessoa e arquivo solto que não é seu: se houver, pare e avise quem é do card; nunca descarte.
- Merge de teste primeiro (`--no-commit --no-ff` em worktree descartável): conflito aparece ali, não na branch de verdade.

Regras que não se negociam
- develop e main não recebem commit, stage nem merge sem ordem explícita da pessoa que lidera.
- Push só depois do verde medido pelo app e com ordem; push forçado nunca.
- Commit só com os arquivos do card, por caminho; `git add -A` não existe aqui.

O que é "pronto"
- HEAD final registrado na ficha, `git grep '<<<<<<<'` vazio (medido por job), branch de origem intocada, log do que entrou em cada merge.
