# Versionamento da NECTAR

O repositório guarda o código-fonte, templates, testes e recursos necessários ao aplicativo. Os dados locais e distribuições geradas permanecem no computador, fora do Git.

## Desenvolvimento

```powershell
npm ci
npm start
```

Para executar sem Electron, use `npm run web`. Para gerar a distribuição do Windows, use `npm run pack` ou `npm run build`. O aplicativo usa as contas Claude/Codex conectadas no computador; logins e credenciais não fazem parte do repositório.

## Registrar alterações

```powershell
git status
git diff
git add caminho/do/arquivo
git diff --cached
git commit -m "Descreva a alteração"
git push
```

Crie branches para mudanças maiores com `git switch -c nome-da-alteracao`, a partir de uma árvore de trabalho limpa. Não use reset ou limpeza de arquivos para descartar mudanças que deseja preservar.

## Dados que ficam fora

`data/`, `projetos/` e `relatorios/` são dados de execução e não sobem ao GitHub. Também ficam fora `node_modules/`, `dist/`, `dist-*/`, executáveis, ZIPs, caches, logs, arquivos de ambiente e credenciais. O `.gitignore` não apaga esses arquivos: apenas os exclui do versionamento.

O Git não substitui o backup das conversas, projetos e configurações locais. Antes de publicar novos arquivos, confira `git diff --cached`; não use `git add -f` para incluir dados que foram excluídos intencionalmente.

O repositório remoto deve permanecer privado até uma decisão explícita de publicar o código e revisar as licenças dos recursos e dependências. Não foi adicionada uma licença de distribuição própria automaticamente.
