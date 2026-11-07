// Regras em lista e .md importado: o app extrai os tópicos de regra sem modelo, acumula sem repetir e anexa contexto. Nenhum modelo é chamado.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'work-ia-regras-'));
process.env.STUDIO_DATA = path.join(tmp, 'data'); process.env.STUDIO_PROJETOS = path.join(tmp, 'projetos'); process.env.STUDIO_FAKE = '1';
process.env.STUDIO_PROMPT_DUMP = path.join(tmp, 'dump');
const { extrairRegras, juntar, listaDeTexto } = await import('../lib/regras-md.mjs');

// ---- o parser puxa os tópicos de um documento escrito por fora
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
assert(r.includes('[Git] Commit só com o que a tarefa mudou.'), 'item de lista com a seção na frente');
assert(r.includes('[Git] Nunca faça force-push.: nem em branch sua'), 'subitem fica junto do item, negrito sai');
assert(r.includes('[Git] Rode `git status` antes de `git add`.'), 'item numerado, código formatado preservado');
assert(!r.some((x) => /Este documento reúne|^\[Interface\] Regra: Motivo$/.test(x)), 'apresentação do documento e cabeçalho da tabela ficam de fora');
assert(r.includes('[Interface] Nada de "·" como separador.'), 'parágrafo curto sob um título');
assert(r.includes('[Interface] Data no eixo do gráfico: o leitor pensa em datas'), 'linha de tabela');
assert(!r.some((x) => /código, não regra|exemplo que não|^\[Sumário\]|^Git$/.test(x)), 'código, sumário e exemplos ficam de fora');
assert(!r.some((x) => /autor:/.test(x)), 'cabeçalho do arquivo fica de fora');
assert(!r.some((x) => x.startsWith('[Guia')), 'o título do documento não vira prefixo');
assert.deepEqual(juntar(['[Git] Commit só com o que a tarefa mudou.'], ['commit so com o que a tarefa mudou', 'Outra']).adicionadas, ['Outra'], 'repetida não entra, mesmo sem acento e sem prefixo');
assert.deepEqual(listaDeTexto('uma regra\n- outra\n\n2. terceira'), ['uma regra', 'outra', 'terceira'], 'regras antigas (texto livre) viram lista');

// ---- API de memória: lista, importação acumulando e documentos de contexto
const store = await import('../lib/store.mjs');
store.gravarConfig({ piloto: { ativo: false, maxChamadasHora: 0 }, ciclo: { statusPO: false, versionar: false, posts: false } });
const projetos = await import('../lib/projetos.mjs');
fs.mkdirSync(path.join(tmp, 'alvo'));
const p = projetos.criar({ nome: 'Regras', caminho: path.join(tmp, 'alvo'), template: 'software' }); assert(p.ok);
const c = projetos.ctx(p.projeto.id); const mem = c.memoria;
mem.gravarRegras('frontend', 'regra antiga escrita como texto');
assert.deepEqual(mem.listaRegras('frontend'), ['regra antiga escrita como texto'], 'o texto antigo continua valendo como item');
mem.gravarListaRegras('frontend', [...mem.listaRegras('frontend'), 'Diff mínimo.']);
const imp = mem.importarRegras('frontend', md);
assert.equal(imp.adicionadas.length, r.length, 'todas as regras do arquivo entram');
assert.equal(mem.listaRegras('frontend').length, 2 + r.length, 'e acumulam com as que já existiam');
assert.equal(mem.importarRegras('frontend', md).adicionadas.length, 0, 'importar o mesmo arquivo de novo não duplica');
assert.throws(() => mem.importarRegras('frontend', '# Só um título'), /Não encontrei regras/);
mem.importarRegras('projeto', '- Docker não existe neste projeto.');
assert(mem.listaRegras('projeto').includes('Docker não existe neste projeto.'), 'regras do projeto também');
mem.importarReferencia('frontend', 'Guia de Telas.md', '# Guia de telas do Demo\n\nMedidas, estados e padrões.');
mem.importarReferencia('projeto', 'glossario.md', '# Glossário\n\n- Chave: credencial de acesso.');
assert.deepEqual(mem.listarReferencias('frontend').map((x) => [x.arquivo, x.titulo]), [['Guia-de-Telas.md', 'Guia de telas do Demo']]);
assert.throws(() => mem.removerReferencia('frontend', '../projeto.md'), /inválido/, 'não sai da pasta do agente');

// ---- o pedido do agente leva as regras e só o caminho dos documentos (não o conteúdo inteiro)
c.equipe.enviar({ canal: 'dm:frontend', texto: 'e aí?', engine: 'claude', modo: 'conversar' });
for (let i = 0; i < 300 && !(fs.existsSync(process.env.STUDIO_PROMPT_DUMP) && fs.readdirSync(process.env.STUDIO_PROMPT_DUMP).some((f) => f.includes('frontend'))); i++) await new Promise((x) => setTimeout(x, 50));
const dump = fs.readdirSync(process.env.STUDIO_PROMPT_DUMP).filter((f) => f.includes('frontend')).map((f) => fs.readFileSync(path.join(process.env.STUDIO_PROMPT_DUMP, f), 'utf8')).join('\n');
assert(dump.includes('- [Git] Commit só com o que a tarefa mudou.'), 'regras importadas chegam ao agente');
assert(dump.includes('Docker não existe neste projeto.'), 'regras do projeto também');
assert(/Guia de telas do Demo: .*Guia-de-Telas\.md/.test(dump) && /Glossário \(do projeto\)/.test(dump), 'documentos aparecem com título e caminho');
assert(!dump.includes('Medidas, estados e padrões.'), 'o conteúdo do documento não vai em toda chamada');
mem.removerReferencia('frontend', 'Guia-de-Telas.md');
assert.equal(mem.listarReferencias('frontend').length, 0, 'documento tirado sai da lista (vai para o arquivo)');

// ---- a interface: lista, importar regras e importar contexto em todas as janelas de agente e nos Ajustes do projeto
const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
assert(/blocoRegras\(id, r,/.test(app) && /blocoReferencias\(id, r\)/.test(app), 'janela de cada agente');
assert(/blocoRegras\('projeto'/.test(app) && /blocoReferencias\('projeto'/.test(app), 'Ajustes do projeto');
assert(app.includes('data-importar-regras') && app.includes('data-importar-ref') && app.includes('data-regra-nova'));

c.equipe.cancelar();
console.log('PASS: regras em lista e .md importado (tópicos extraídos sem modelo, acumulam sem repetir, documentos de contexto por caminho, em todos os agentes e no projeto).');
try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* o Windows ainda segura a pasta */ }
process.exit(0);
