// A stable key and environment are never grounds for rejection. On 31/10, 85 rejections "Informe chave estavel e ambiente" and 32 of "Relatório precisa de
// chave estável" made the team repeat the same record for hours (T-016: backend 52 calls, P.O. 43). Cause: the app itself generated the
// key with the card id in uppercase (evid-T-016-...) and validation only accepted lowercase.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'work-ia-chaves-'));
process.env.STUDIO_DATA = path.join(tmp, 'data'); process.env.STUDIO_PROJETOS = path.join(tmp, 'projetos'); process.env.STUDIO_FAKE = '1';
const store = await import('../lib/store.mjs');
store.gravarConfig({ piloto: { ativo: false, maxChamadasHora: 0 }, ciclo: { statusPO: false, fechamento: false, orcamento: 6, revisaoAuto: true, versionar: false, posts: false } });
const projetos = await import('../lib/projetos.mjs');
const { chaveEstavel } = await import('../lib/workflow.mjs');
fs.mkdirSync(path.join(tmp, 'alvo'));
const projeto = projetos.criar({ nome: 'Chaves', caminho: path.join(tmp, 'alvo'), template: 'software' }).projeto;
const { quadro: q } = projetos.ctx(projeto.id);
const ok = (r) => { assert(r.ok, r.erro); return r; };
const OK = [{ comando: 'pytest -q', status: 'aprovado', evidencia: '28 passed' }];
const card = ok(q.criar({ titulo: 'Rotas de chave de API', descricao: 'Criar rotas.', dono: 'backend', coluna: 'pronto', aceite: ['Funciona'], validacoesObrigatorias: ['pytest -q'] }, 'po')).card;
const fluxo = (acao, dados, autor = 'backend') => q.fluxo(card.id, acao, { revisao: q.obter(card.id).workflow.revisao, ...dados }, autor);

// ---- the function itself
for (const v of ['T-016 r12 Evidência!', 'evid_T-016__r12', 'EVID-T-016', '  ', undefined, null, 42, 'a'.repeat(300), 'çãõ']) assert.match(chaveEstavel(v, 'T-016', 12), /^[a-z0-9-]{1,100}$/, `valid key for ${JSON.stringify(v)}`);
assert.equal(chaveEstavel('T-016 r12 Evidência!'), 't-016-r12-evidencia');
assert.equal(chaveEstavel('', 'x', 1), chaveEstavel(undefined, 'x', 1), 'without a key, the generated one depends only on content (the same record repeated is the same)');
assert.notEqual(chaveEstavel('', 'x', 1), chaveEstavel('', 'x', 2));

// ---- evidence before any delivery exists: a clear rejection that does not mention the key
const sem = fluxo('evidencia', { verificacoes: OK });
assert.equal(sem.ok, false); assert.doesNotMatch(sem.erro, /chave/i); assert.match(sem.erro, /entrega/i);

// ---- delivery with an uppercase key, repeated: the second is the same
ok(fluxo('entrega', { chave: 'ENT-T-016-R1', resumo: 'Rotas criadas.', arquivos: ['api.py'], verificacoes: OK }));
assert.equal(ok(fluxo('entrega', { chave: 'ENT-T-016-R1', resumo: 'Rotas criadas.', arquivos: ['api.py'], verificacoes: OK })).repetido, true, 'same delivery, same key: no duplicate');
ok(fluxo('entrega', { resumo: 'Segunda entrega sem chave nenhuma.', arquivos: ['api.py'], verificacoes: OK }));   // no key: the app creates one
assert.equal(q.obter(card.id).workflow.revisao, 2);
assert.equal(ok(fluxo('entrega', { resumo: 'Segunda entrega sem chave nenhuma.', arquivos: ['api.py'], verificacoes: OK })).repetido, true, 'without a key, the same content repeated is still the same delivery');

// ---- later evidence: every way of getting key and environment wrong passes
const casos = [
  { nome: 'sem chave e sem ambiente', dados: { verificacoes: OK } },
  { nome: 'chave com maiúsculas e espaços', dados: { chave: 'T-016 r12 Evidência', ambiente: 'worktree T-016', verificacoes: [{ comando: 'pytest -q', status: 'aprovado', evidencia: 'rodou de novo, 28 passed' }] } },
  { nome: 'ambiente em forma de objeto', dados: { chave: 'evid-obj', ambiente: { so: 'windows', banco: 'postgres' }, verificacoes: [{ comando: 'pytest -q', status: 'aprovado', evidencia: 'ok no banco local' }] } },
  { nome: 'ambiente vazio e chave numérica', dados: { chave: 123, ambiente: '', verificacoes: [{ comando: 'pytest -q', status: 'aprovado', evidencia: 'ok' }] } },
];
for (const c of casos) { const r = fluxo('evidencia', c.dados); assert(r.ok, `${c.nome}: ${r.erro}`); }
const hist = q.obter(card.id).workflow.historicoVerificacoes.filter((v) => v.origem === 'posterior');
assert(hist.length >= 4 && hist.every((v) => /^[a-z0-9-]+$/.test(v.chave) && v.ambiente), 'every evidence got a normalized key and a filled environment');
assert(hist.some((v) => /postgres/.test(v.ambiente)), 'object environment was stored as text, not lost');
assert.equal(fluxo('evidencia', { chave: 'T-016 r12 Evidência', verificacoes: [{ comando: 'pytest -q', status: 'aprovado', evidencia: 'rodou de novo, 28 passed' }] }).repetido, true, 'the same evidence does not duplicate');

// ---- a command outside the plan becomes an extra check, not rejected and not made mandatory
const extra = fluxo('evidencia', { verificacoes: [{ comando: 'ruff check src', status: 'aprovado', evidencia: 'só B008, a linha de base do repo' }] });
assert(extra.ok, extra.erro);
const vs = q.obter(card.id).workflow.verificacoes;
assert(vs.some((v) => v.comando === 'ruff check src' && !v.obrigatoria), 'command outside the plan became an extra, non-mandatory check');
assert(vs.find((v) => v.comando === 'pytest -q').obrigatoria, 'and the mandatory one stays mandatory');

// ---- report without a key
assert(ok(q.relatar(card.id, { resumo: 'Rodei tudo de novo.' }, 'backend')).ok);
assert.equal(ok(q.relatar(card.id, { resumo: 'Rodei tudo de novo.' }, 'backend')).repetido, true);
assert.equal(q.relatar(card.id, { chave: 'x' }, 'backend').ok, false, 'a report without a summary is still rejected (real content is missing there)');

// ---- finding without a key and verification by the normalized key
const ach = fluxo('achado', { severidade: 'baixa', arquivo: 'api.py', linha: 10, evidencia: 'Falta tratar 404.', impacto: 'Erro genérico.', correcao: 'Retornar 404.' }, 'revisor');
assert(ach.ok, ach.erro);
const chaveAchado = q.obter(card.id).workflow.achados.at(-1).chave;
assert.match(chaveAchado, /^[a-z0-9-]+$/);
const ver = fluxo('verificar-achado', { chave: chaveAchado, veredito: 'confirmado', evidencia: 'Reproduzi com id inexistente.' }, 'qa');
assert(ver.ok, ver.erro);
console.log('PASS: stable keys and environment (no form of key or environment is rejected; the app normalizes, fills in and deduplicates).');
