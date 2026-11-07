// Contrato do pedido: tópicos explícitos sobrevivem à decomposição; correção versiona e reabre; cobertura só fecha com busca registrada.
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

// ---- extração
const topicos = extrairTopicos(PEDIDO);
assert.equal(topicos.length, 4, 'quatro frentes explícitas');
assert.match(topicos[1], /invideo/i);
const periodo = extrairPeriodo(PEDIDO, new Date('2026-11-02T12:00:00Z'));
assert.equal(periodo.de, '2026-10-19');
assert.equal(periodo.ate, '2026-11-02', '"até hoje" vira a data de hoje');
assert.ok(extrairCaminhos(PEDIDO)[0].includes('PROJETO DEMO'));
assert.ok(pedidoAmplo(PEDIDO));
assert.ok(!pedidoAmplo('ok, pode seguir'));
assert.equal(extrairTopicos('me manda um resumo do quadro').length, 1, 'sem lista: um tópico só');
assert.ok(pareceCorrecao('na verdade a pesquisa do invideo é a da pasta pesquisa-invideo'));
assert.ok(!pareceCorrecao('obrigada, ficou bom'));

// ---- ciclo de vida
const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'nectar-pedido-'));
const ct = criarContratos({ pasta });
assert.equal(ct.atual(), null);
const c = ct.abrir({ texto: PEDIDO, canal: 'dm:chief_of_staff', hoje: new Date('2026-11-02T12:00:00Z') });
assert.equal(c.versao, 1);
assert.equal(ct.cobertura(c.id).situacao, 'aberta');
const bloco = ct.paraPrompt({ lider: true });
for (const t of topicos) assert.ok(bloco.includes(t.slice(0, 40)), `prompt carrega o tópico: ${t.slice(0, 30)}`);
assert.match(bloco, /PARCIAL/, 'a liderança sabe que entrega com lacuna é parcial');
assert.match(bloco, /2026-10-19 a 2026-11-02/);

assert.throws(() => ct.topico(c.id, 1, 'evidenciado', ''), /exige nota/, 'evidência sem fonte não vale');
assert.throws(() => ct.topico(c.id, 9, 'pesquisando'), /não existe/);
ct.topico(c.id, 1, 'evidenciado', 'git log frontend, commits a1b2c3d e d4e5f6a de 29/10', 'coletor');
ct.topico(c.id, 2, 'evidenciado', 'pesquisa-invideo/auditoria-2026-10-22/analise.md', 'coletor');
ct.topico(c.id, 3, 'pesquisando', '', 'conhecimento');
ct.topico(c.id, 4, 'nao_encontrado', 'procurei em entregas/ e no ledger; a síntese de dev é de 01/11', 'coletor');
assert.equal(ct.cobertura(c.id).situacao, 'aberta', 'tópico em pesquisa ainda segura o fechamento');
ct.topico(c.id, 3, 'evidenciado', 'pesquisa-sdk-externo/relatorio-integracao/relatorio.md', 'conhecimento');
assert.equal(ct.cobertura(c.id).situacao, 'parcial', 'tudo buscado, mas o 4 ficou sem evidência: parcial');
assert.deepEqual(ct.cobertura(c.id).semEvidencia, [4]);

// correção: versiona, acrescenta caminho e reabre o que estava evidenciado
const c2 = ct.corrigir(c.id, 'na verdade a implementação está nas branches T-* do backend em C:\\Users\\x\\backend-exemplo');
assert.equal(c2.versao, 2);
assert.equal(c2.correcoes.length, 1);
assert.ok(c2.caminhos.some((x) => x.includes('backend-exemplo')));
assert.ok(c2.topicos.every((t) => t.estado !== 'evidenciado'), 'correção reabre os tópicos evidenciados');
assert.equal(ct.cobertura(c.id).situacao, 'aberta');
assert.match(ct.paraPrompt(), /Correção v2/);

// persistência: reabrir da pasta recupera o mesmo contrato
const ct2 = criarContratos({ pasta });
assert.equal(ct2.atual().id, c.id);
assert.equal(ct2.atual().versao, 2);

// Pedidos simultâneos preservam o contrato e o contexto de cada iniciativa.
const c3 = ct2.abrir({ texto: PEDIDO.replace('Review', 'relatório') });
assert.equal(ct2.atual().id, c3.id);
assert.equal(ct2.obter(c.id).aberto, true);
assert.equal(ct2.atual({ id: c.id }).id, c.id);
assert.match(ct2.paraPrompt({ id: c.id }), /Correção v2/);
assert.doesNotMatch(ct2.paraPrompt({ id: c3.id }), /Correção v2/);

// ---- roteador: pedido amplo sem card não cai no modelo mínimo
assert.ok(pedidoComplexo(PEDIDO));
assert.ok(!pedidoComplexo('ok, segue'));
const codex = { leve: 'luna', medio: 'terra', forte: 'sol' };
const conversa = escolher({ engine: 'claude', tipo: 'pedido', modo: 'conversar', card: null, texto: 'ok, segue', codex });
assert.equal(conversa.degrau, 0, 'conversa curta continua barata');
const amplo = escolher({ engine: 'claude', tipo: 'pedido', modo: 'conversar', card: null, texto: PEDIDO, codex });
assert.ok(amplo.degrau >= 2, `pedido amplo em modo conversar sobe de degrau (${amplo.nivel})`);
assert.equal(amplo.esforco, 'medium');
const comContrato = escolher({ engine: 'claude', tipo: 'pedido', modo: 'conversar', card: null, texto: 'e o invideo, achou?', contrato: true, codex });
assert.ok(comContrato.degrau >= 2, 'com contrato aberto, falar com a liderança é trabalho');
const teto = escolher({ engine: 'claude', tipo: 'pedido', modo: 'conversar', card: null, texto: PEDIDO, teto: 'low', codex });
assert.equal(teto.degrau, 1, 'o teto da conta continua mandando');

fs.rmSync(pasta, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
console.log('PASS: contrato do pedido (tópicos preservados no prompt, correção versiona e reabre, cobertura parcial/completa, roteador não rebaixa pedido amplo).');
