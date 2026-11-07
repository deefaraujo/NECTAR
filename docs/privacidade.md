# Privacidade e separação dos projetos

O repositório deve guardar apenas código e recursos da ferramenta. Projetos de trabalho e comerciais, prompts, conversas, relatórios, currículos e credenciais ficam fora dele.

No desktop, os dados de uso ficam na pasta de dados do aplicativo. Para preservar instalações antigas, o nome ainda pode ser `Game Studio AI`, dentro de `%APPDATA%`. Os caminhos dos projetos são configurados separadamente. No modo web de desenvolvimento, a pasta `data/` da raiz pode ser utilizada.

O `.gitignore` exclui dados, builds, caches, complementos locais e scripts históricos. `scripts/verificar-publicacao.mjs` também confere a lista versionada e alguns padrões de segredo. Não substitui revisão humana.

Verifique a publicação antes de commit ou push. Não use `git add -f` para contornar exclusões. Publicar uma pasta e depois apagá-la não elimina seu conteúdo do histórico; incidentes exigem tratar o histórico e eventuais segredos expostos.

O GitHub não recebe automaticamente os projetos só porque a ferramenta foi versionada. Agentes, integrações e modelos podem processar os dados que você fornecer a eles; verifique suas permissões separadamente.

Git não substitui o backup dos dados privados excluídos do repositório.
