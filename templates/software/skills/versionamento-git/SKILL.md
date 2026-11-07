---
name: versionamento-git
description: Controle de versão com Git: commits limpos, worktrees por ticket, avaliação de conflito, push e pull seguros, recuperação. Use ao versionar uma entrega concluída, avaliar conflito entre branches ou atualizar uma branch.
---
# Versionamento com Git

Princípio: versionar é o último passo da entrega e o mais fácil de estragar. Cada comando que escreve é conferido antes e explicável depois. Na dúvida, leia (`status`, `diff`, `log`) em vez de escrever.

## Antes de commitar
1. `git status --short` e `git diff --stat` no worktree do ticket. A lista bate com os arquivos da entrega e do card? Sobrou algo que é de outra pessoa, gerado, ou de documentação em commit de implementação? Isso fica de fora.
2. Fim de linha e BOM: o repositório define (`.gitattributes`, `.editorconfig`). Não troque CRLF por LF em arquivo inteiro sem necessidade; diff gigante é sinal de fim de linha trocado.
3. Segredo: procure `.env`, tokens, chaves, senhas no diff (`git diff --cached`). Achou, não suba e avise.
4. `git log -n 15 --oneline`: aprenda o padrão de mensagem (prefixo, idioma, tempo verbal, chave do ticket) e siga.

## Commit
- Adicione por caminho: `git add caminho/arquivo`. Nunca `git add -A` nem `git add .` em worktree que pode ter trabalho alheio. `git add -p` quando só parte do arquivo é da tarefa.
- Um commit por mudança lógica. Mensagem no imperativo, primeira linha curta, corpo explicando o porquê quando não é óbvio.
- Confira o que entrou: `git diff --cached --stat` antes do `git commit`.
- Não use `--no-verify`. Hook falhou? Entenda e corrija a causa.
- Autoria: a identidade já configurada. Não altere `user.name` nem `user.email`.

## Worktrees
- Um ticket, um worktree, uma branch: `git worktree add ../_worktrees/TICKET -b TICKET origin/develop`. Não troque a branch do checkout principal.
- `git worktree list` mostra o que está ativo; cada um é um lugar onde alguém pode estar mexendo.
- Remover só o que está limpo e já foi enviado: `git worktree remove`.

## Avaliar conflito (sem mexer em nada)
1. `git fetch --prune` atualiza só as referências do remoto.
2. Base e ponto de partida: `git merge-base HEAD origin/develop`.
3. O que mudou dos dois lados: `git diff --name-only $(git merge-base HEAD origin/develop) origin/develop` e o mesmo para a sua branch. Interseção das listas é onde pode colidir.
4. Teste de merge: `git merge-tree --write-tree HEAD origin/develop` (Git recente) mostra conflitos sem tocar na árvore. Alternativa: `git merge --no-commit --no-ff origin/develop` e sempre `git merge --abort` em seguida.
5. Outros trabalhos ativos: para cada worktree/branch em andamento, `git diff --name-only` e compare com os seus arquivos.
6. Relate em três grupos: colide, pode colidir (mesmo arquivo, regiões diferentes), livre.

## Resolver conflito
- Textual e restrito a arquivo da tarefa: resolva mantendo as duas intenções, rode o que o projeto tem de verificação rápida e mostre o diff da resolução.
- Semântico (mesma função com regras diferentes, contrato de API, migração concorrente), código de outra pessoa ou decisão de produto: pare. Descreva os dois lados e recomende; quem decide é o dono do card ou a Game Director.
- Nunca resolva "aceitando tudo de um lado" sem ler.

## Atualizar (pull) e enviar (push)
- Atualizar: árvore limpa, `git fetch --prune`, depois `git pull --ff-only`. Não deu fast-forward? A branch divergiu: avalie conflito, não force.
- Rebase só em branch sua, ainda não publicada, e nunca sobre a develop/main do projeto quando a regra do projeto proíbe. Se a branch já foi publicada, prefira merge.
- Enviar: só a branch do ticket, `git push origin TICKET` (com `-u` na primeira vez). Nunca `--force`; se for inevitável, pare e pergunte (`--force-with-lease` só com autorização expressa).
- Nunca push direto em develop, main, master ou release.
- Abrir MR: entregue o comando ou o link; a decisão de abrir é da Game Director.

## Recuperar
- Perdeu algo? `git reflog` guarda por semanas onde cada ponteiro esteve. `git branch recuperada <sha>` traz de volta.
- Commit no lugar errado e ainda não publicado: `git reset --soft HEAD~1` mantém o trabalho; mova para a branch certa. Não use `reset --hard` sem olhar o que será descartado.
- Mudança local que não é sua: `git stash push -m "motivo" -- caminho` guarda com nome; não apague.

## Windows
- Caminhos longos: `git config core.longpaths true` no repositório (só se o projeto já usa).
- Aspas duplas nos caminhos com espaço; barras normais funcionam.
- Cuidado com a ordem de maiúsculas em nomes de arquivo (Windows ignora caixa; Git não): renomear só a caixa exige `git mv`.

## Relatório de versionamento
Branch e commits (hash e assunto), arquivos, avaliação de conflito (colide, pode colidir, livre), o que subiu e para onde, o que ficou de fora e por quê, comando ou link do MR.
