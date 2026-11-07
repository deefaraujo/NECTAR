# Componentes e direitos independentes

A licença `LICENSE` rege o material original da NECTAR. Ela não altera licenças independentes de terceiros nem transfere direitos sobre projetos processados com a ferramenta.

- As dependências Node são declaradas em `package.json` e fixadas em `package-lock.json`. Não estão copiadas neste repositório; são obtidas com `npm ci` e mantêm suas próprias licenças, incluindo os avisos do Electron/Chromium, electron-builder e pdf-parse.
- As fontes de interface em `public/fonts/` acompanham seus textos `OFL-*.txt`. Elas mantêm a SIL Open Font License e não estão submetidas à proibição comercial da licença do código original.
- Skills ou bibliotecas de referência externas não são redistribuídas aqui. `templates/*/skills-opcionais.json` registra os identificadores de complementos conhecidos; uma instalação local pode fornecê-los separadamente, sob a licença de seus titulares. Os diretórios locais desses complementos são ignorados pelo Git.
- Amostras externas de voz não são publicadas. `vozes/ORIGEM.md` documenta as referências de uma instalação de desenvolvimento; qualquer recurso de voz precisa ser configurado separadamente por quem tiver os direitos necessários.
- Os testes distribuídos usam dados sintéticos. A amostra PDF do repositório é gerada para testar extração de texto, sem documentos de clientes ou publicações externas.

Não há projeto de cliente, empregador ou outro repositório de trabalho incluído nesta distribuição. Recursos e projetos locais não devem ser adicionados com `git add -f`.
