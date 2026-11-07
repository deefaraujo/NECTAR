// Rules as a list and imported .md: the app extracts rule items without a model, accumulates without repeats and attaches context. No model is called.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'work-ia-regras-'));
process.env.STUDIO_DATA = path.join(tmp, 'data'); process.env.STUDIO_PROJETOS = path.join(tmp, 'projetos'); process.env.STUDIO_FAKE = '1';
process.env.STUDIO_PROMPT_DUMP = path.join(tmp, 'dump');
const { extrairRegras, juntar, listaDeTexto } = await import('../lib/regras-md.mjs');

// ---- the parser pulls the items out of an externally written document
const md = `---
autor: Déborah
---
# Guia do time

Este documento reúne como trabalhamos no projeto, com as decisões que já tomamos e o que esperamos de cada entrega, para ninguém precisar perguntar de novo o que já foi combinado em reunião, e também traz contexto histórico longo sobre o porquê de cada escolha, que não é uma regra em si, mas ajuda a entender.

## Sumário
- Git
- Interface

## Git
- Commit só com o que a tarefa mudou.
- **Nunca** faça force-push.
  - nem em branch sua
1. Rode \`git status\` antes de \`git add\`.

## Interface
Nada de "·" como separador.

| Regra | Motivo |
|---|---|
| Data no eixo do gráfico | o leitor pensa em datas |

\`\`\`bash
- isto é código, não regra
\`\`\`

## Exemplos
- exemplo que não é regra
`;
const r = extrairRegras(md);
assert(r.includes('[Git] Commit só com o que a tarefa mudou.'), 'list item prefixed with its section');
assert(r.includes('[Git] Nunca faça force-push.: nem em branch sua'), 'sub-item stays with its item, bold is stripped');
assert(r.includes('[Git] Rode `git status` antes de `git add`.'), 'numbered item, inline code preserved');
assert(!r.some((x) => /Este documento reúne|^\[Interface\] Regra: Motivo$/.test(x)), 'document intro and table header are left out');
assert(r.includes('[Interface] Nada de "·" como separador.'), 'short paragraph under a heading');
assert(r.includes('[Interface] Data no eixo do gráfico: o leitor pensa em datas'), 'table row');
assert(!r.some((x) => /código, não regra|exemplo que não|^\[Sumário\]|^Git$/.test(x)), 'code, table of contents and examples are left out');
assert(!r.some((x) => /autor:/.test(x)), 'file front matter is left out');
assert(!r.some((x) => x.startsWith('[Guia')), 'the document title does not become a prefix');
assert.deepEqual(juntar(['[Git] Commit só com o que a tarefa mudou.'], ['commit so com o que a tarefa mudou', 'Outra']).adicionadas, ['Outra'], 'a duplicate is not added, even without accents or prefix');
assert.deepEqual(listaDeTexto('uma regra\n- outra\n\n2. terceira'), ['uma regra', 'outra', 'terceira'], 'old rules (free text) become a list');

// ---- memory API: list, accumulating import and context documents
const store = await import('../lib/store.mjs');
store.gravarConfig({ piloto: { ativo: false, maxChamadasHora: 0 }, ciclo: { statusPO: false, versionar: false, posts: false } });
const projetos = await import('../lib/projetos.mjs');
fs.mkdirSync(path.join(tmp, 'alvo'));
const p = projetos.criar({ nome: 'Regras', caminho: path.join(tmp, 'alvo'), template: 'software' }); assert(p.ok);
const c = projetos.ctx(p.projeto.id); const mem = c.memoria;
mem.gravarRegras('frontend', 'regra antiga escrita como texto');
assert.deepEqual(mem.listaRegras('frontend'), ['regra antiga escrita como texto'], 'the old text still counts as an item');
mem.gravarListaRegras('frontend', [...mem.listaRegras('frontend'), 'Diff mínimo.']);
const imp = mem.importarRegras('frontend', md);
assert.equal(imp.adicionadas.length, r.length, 'all rules from the file are added');
assert.equal(mem.listaRegras('frontend').length, 2 + r.length, 'and accumulate with the existing ones');
assert.equal(mem.importarRegras('frontend', md).adicionadas.length, 0, 'importing the same file again does not duplicate');
assert.throws(() => mem.importarRegras('frontend', '# Só um título'), /Não encontrei regras/);
mem.importarRegras('projeto', '- Docker não existe neste projeto.');
assert(mem.listaRegras('projeto').includes('Docker não existe neste projeto.'), 'project rules too');
mem.importarReferencia('frontend', 'Guia de Telas.md', '# Guia de telas do Demo\n\nMedidas, estados e padrões.');
mem.importarReferencia('projeto', 'glossario.md', '# Glossário\n\n- Chave: credencial de acesso.');
assert.deepEqual(mem.listarReferencias('frontend').map((x) => [x.arquivo, x.titulo]), [['Guia-de-Telas.md', 'Guia de telas do Demo']]);
assert.throws(() => mem.removerReferencia('frontend', '../projeto.md'), /inválido/, 'does not escape the agent folder');

// ---- the agent request carries the rules and only the document paths (not the full content)
c.equipe.enviar({ canal: 'dm:frontend', texto: 'e aí?', engine: 'claude', modo: 'conversar' });
for (let i = 0; i < 300 && !(fs.existsSync(process.env.STUDIO_PROMPT_DUMP) && fs.readdirSync(process.env.STUDIO_PROMPT_DUMP).some((f) => f.includes('frontend'))); i++) await new Promise((x) => setTimeout(x, 50));
const dump = fs.readdirSync(process.env.STUDIO_PROMPT_DUMP).filter((f) => f.includes('frontend')).map((f) => fs.readFileSync(path.join(process.env.STUDIO_PROMPT_DUMP, f), 'utf8')).join('\n');
assert(dump.includes('- [Git] Commit só com o que a tarefa mudou.'), 'imported rules reach the agent');
assert(dump.includes('Docker não existe neste projeto.'), 'project rules too');
assert(/Guia de telas do Demo: .*Guia-de-Telas\.md/.test(dump) && /Glossário \(do projeto\)/.test(dump), 'documents appear with title and path');
assert(!dump.includes('Medidas, estados e padrões.'), 'document content is not sent on every call');
mem.removerReferencia('frontend', 'Guia-de-Telas.md');
assert.equal(mem.listarReferencias('frontend').length, 0, 'a removed document leaves the list (goes to the archive)');

// ---- the UI: list, import rules and import context in every agent window and in project Settings
const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
assert(/blocoRegras\(id, r,/.test(app) && /blocoReferencias\(id, r\)/.test(app), 'each agent window');
assert(/blocoRegras\('projeto'/.test(app) && /blocoReferencias\('projeto'/.test(app), 'project Settings');
assert(app.includes('data-importar-regras') && app.includes('data-importar-ref') && app.includes('data-regra-nova'));

c.equipe.cancelar();
console.log('PASS: rules as a list and imported .md (items extracted without a model, accumulate without repeats, context documents by path, for every agent and the project).');
try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* Windows may still hold the folder */ }
process.exit(0);
