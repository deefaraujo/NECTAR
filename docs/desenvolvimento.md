# Desenvolvimento e validação

Use Node.js 22 e `npm ci`. Inicie com `npm start` ou `npm run web`.

- `npm run check:publicacao`: verifica o conteúdo preparado no Git.
- `npm test`: cenários de comportamento do núcleo.
- `npm run test:teamwork`: contratos e fluxos Teamwork.
- `python tests/entrevista-ui.py`: laboratório visual com ações simuladas.
- `python tests/avaliacoes-ui.py`: organizador manual e persistência.
- `python tests/entrevista-input.py`: PowerShell com eventos coletados em vez de enviados ao teclado real.
- `python tests/empacotado.py`: smoke do pacote Electron com dados isolados.

Testes Python de interface exigem Playwright e navegador compatível. Algumas ferramentas de imagem exigem Pillow. Para regenerar o PDF sintético, instale reportlab separadamente e execute `python scripts/gerar-fixture-pdf.py`.

Skills externas são opcionais e não têm seu conteúdo publicado. Os testes conferem que cada referência é um arquivo original disponível ou um complemento explicitamente declarado. Conteúdo ausente não é executado nem considerado validado. Uma instalação que já tenha complementos pode executar verificações adicionais sobre seus arquivos locais.

Scripts antigos de geração e alteração em lote não fazem parte do código mantido. Recursos de SDK, conta, modelo, voz ou dispositivo externo precisam de validação específica; testes roteirizados não substituem isso.
