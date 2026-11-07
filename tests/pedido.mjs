// Request contract: explicit topics survive decomposition; a correction bumps the version and reopens; coverage only closes with a recorded search.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { criarContratos, extrairTopicos, extrairPeriodo, extrairCaminhos, pedidoAmplo, pareceCorrecao } from '../lib/pedido.mjs';
import { escolher, pedidoComplexo } from '../lib/roteador.mjs';

const PEDIDO = `faça uma apresentação de Review do projeto levando em consideração as minhas tarefas do dia 19 de outubro até hoje:
C:\\Users\\x\\Documents\\workspace\\PROJETO DEMO
1. tarefas de ajustes no frontend que eu fiz durante esse período (buscar em branches do repositório do frontend)
2. pesquisas de IA feitas durante esse período, tem uma tarefa de pesquisa do invideo
3. pesquisa da integração do SDK externo com o Demo, já mandei o relatório final
4. inicio da primeira etapa de implementação dessa integração com chave api`;

// ---- extraction
const topicos = extrairTopicos(PEDIDO);
assert.equal(topicos.length, 4, 'four explicit topics');
assert.match(topicos[1], /invideo/i);
const periodo = extrairPeriodo(PEDIDO, new Date('2026-11-02T12:00:00Z'));
assert.equal(periodo.de, '2026-10-19');
assert.equal(periodo.ate, '2026-11-02', "'até hoje' becomes today's date");
assert.ok(extrairCaminhos(PEDIDO)[0].includes('PROJETO DEMO'));
assert.ok(pedidoAmplo(PEDIDO));
assert.ok(!pedidoAmplo('ok, pode seguir'));
assert.equal(extrairTopicos('me manda um resumo do quadro').length, 1, 'no list: a single topic');
assert.ok(pareceCorrecao('na verdade a pesquisa do invideo é a da pasta pesquisa-invideo'));
assert.ok(!pareceCorrecao('obrigada, ficou bom'));

// ---- lifecycle
const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'nectar-pedido-'));
const ct = criarContratos({ pasta });
assert.equal(ct.atual(), null);
const c = ct.abrir({ texto: PEDIDO, canal: 'dm:chief_of_staff', hoje: new Date('2026-11-02T12:00:00Z') });
assert.equal(c.versao, 1);
assert.equal(ct.cobertura(c.id).situacao, 'aberta');
const bloco = ct.paraPrompt({ lider: true });
for (const t of topicos) assert.ok(bloco.includes(t.slice(0, 40)), `prompt carries the topic: ${t.slice(0, 30)}`);
assert.match(bloco, /PARCIAL/, 'the lead knows a delivery with a gap is partial');
assert.match(bloco, /2026-10-19 a 2026-11-02/);

assert.throws(() => ct.topico(c.id, 1, 'evidenciado', ''), /exige nota/, 'evidence without a source does not count');
assert.throws(() => ct.topico(c.id, 9, 'pesquisando'), /não existe/);
ct.topico(c.id, 1, 'evidenciado', 'git log frontend, commits a1b2c3d e d4e5f6a de 29/10', 'coletor');
ct.topico(c.id, 2, 'evidenciado', 'pesquisa-invideo/auditoria-2026-10-22/analise.md', 'coletor');
ct.topico(c.id, 3, 'pesquisando', '', 'conhecimento');
ct.topico(c.id, 4, 'nao_encontrado', 'procurei em entregas/ e no ledger; a síntese de dev é de 01/11', 'coletor');
assert.equal(ct.cobertura(c.id).situacao, 'aberta', 'a topic still being researched holds the closing');
ct.topico(c.id, 3, 'evidenciado', 'pesquisa-sdk-externo/relatorio-integracao/relatorio.md', 'conhecimento');
assert.equal(ct.cobertura(c.id).situacao, 'parcial', 'everything searched, but #4 has no evidence: partial');
assert.deepEqual(ct.cobertura(c.id).semEvidencia, [4]);

// correction: bumps the version, adds a path and reopens what had evidence
const c2 = ct.corrigir(c.id, 'na verdade a implementação está nas branches T-* do backend em C:\\Users\\x\\backend-exemplo');
assert.equal(c2.versao, 2);
assert.equal(c2.correcoes.length, 1);
assert.ok(c2.caminhos.some((x) => x.includes('backend-exemplo')));
assert.ok(c2.topicos.every((t) => t.estado !== 'evidenciado'), 'correction reopens topics that had evidence');
assert.equal(ct.cobertura(c.id).situacao, 'aberta');
assert.match(ct.paraPrompt(), /Correção v2/);

// persistence: reopening from the folder restores the same contract
const ct2 = criarContratos({ pasta });
assert.equal(ct2.atual().id, c.id);
assert.equal(ct2.atual().versao, 2);

// Concurrent requests keep each initiative's contract and context.
const c3 = ct2.abrir({ texto: PEDIDO.replace('Review', 'relatório') });
assert.equal(ct2.atual().id, c3.id);
assert.equal(ct2.obter(c.id).aberto, true);
assert.equal(ct2.atual({ id: c.id }).id, c.id);
assert.match(ct2.paraPrompt({ id: c.id }), /Correção v2/);
assert.doesNotMatch(ct2.paraPrompt({ id: c3.id }), /Correção v2/);

// ---- router: a broad request without a card does not fall to the minimum model
assert.ok(pedidoComplexo(PEDIDO));
assert.ok(!pedidoComplexo('ok, segue'));
const codex = { leve: 'luna', medio: 'terra', forte: 'sol' };
const conversa = escolher({ engine: 'claude', tipo: 'pedido', modo: 'conversar', card: null, texto: 'ok, segue', codex });
assert.equal(conversa.degrau, 0, 'a short chat stays cheap');
const amplo = escolher({ engine: 'claude', tipo: 'pedido', modo: 'conversar', card: null, texto: PEDIDO, codex });
assert.ok(amplo.degrau >= 2, `a broad request in chat mode moves up a tier (${amplo.nivel})`);
assert.equal(amplo.esforco, 'medium');
const comContrato = escolher({ engine: 'claude', tipo: 'pedido', modo: 'conversar', card: null, texto: 'e o invideo, achou?', contrato: true, codex });
assert.ok(comContrato.degrau >= 2, 'with an open contract, talking to the lead is work');
const teto = escolher({ engine: 'claude', tipo: 'pedido', modo: 'conversar', card: null, texto: PEDIDO, teto: 'low', codex });
assert.equal(teto.degrau, 1, 'the account cap still rules');

fs.rmSync(pasta, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
console.log('PASS: request contract (topics kept in the prompt, correction bumps version and reopens, partial/complete coverage, router does not downgrade a broad request).');
