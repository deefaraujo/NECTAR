# Arquitetura

A NECTAR usa Node.js para o servidor local e Electron para a janela desktop. A interface é HTML, CSS e JavaScript em `public/`. O ponto de entrada desktop é `electron/main.mjs`; o servidor é `server.mjs`.

`lib/` reúne armazenamento e coordenação dos agentes. `templates/` descreve equipes genéricas: um template não é um projeto de cliente e não deve conter seus arquivos.

Modelos são executados por integrações com os CLIs locais. Autenticação, permissões, custos e capacidades dependem das contas instaladas. Integrações com serviços externos são independentes do versionamento da ferramenta.

O servidor escuta em loopback. Electron expõe métodos específicos por `preload.cjs`, com isolamento de contexto e sem acesso direto do frontend ao Node.

O agente visual interpreta quadros transitórios e solicita ações validadas. Seu contrato de ações é separado dos módulos de servidor para que importá-lo no Electron não inicialize o armazenamento antes da definição da pasta de dados.

A preparação deste repositório não reescreve o orquestrador. Ela separa código, documentação, complementos opcionais e arquivos locais, preservando a arquitetura existente.
