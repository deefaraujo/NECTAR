// Chave estável e ambiente nunca são motivo de recusa. Em 31/10, 85 recusas "Informe chave estavel e ambiente" e 32 de "Relatório precisa de
// chave estável" fizeram o time repetir o mesmo registro por horas (T-016: backend 52 chamadas, P.O. 43). Causa: o próprio app gerava a
// chave com o id do card em maiúsculas (evid-T-016-...) e a validação só aceitava minúsculas.
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

// ---- a função em si
for (const v of ['T-016 r12 Evidência!', 'evid_T-016__r12', 'EVID-T-016', '  ', undefined, null, 42, 'a'.repeat(300), 'çãõ']) assert.match(chaveEstavel(v, 'T-016', 12), /^[a-z0-9-]{1,100}$/, `chave válida para ${JSON.stringify(v)}`);
assert.equal(chaveEstavel('T-016 r12 Evidência!'), 't-016-r12-evidencia');
assert.equal(chaveEstavel('', 'x', 1), chaveEstavel(undefined, 'x', 1), 'sem chave, a gerada depende só do conteúdo (o mesmo registro repetido é o mesmo)');
assert.notEqual(chaveEstavel('', 'x', 1), chaveEstavel('', 'x', 2));

// ---- evidência antes de existir entrega: recusa clara, que não fala de chave
const sem = fluxo('evidencia', { verificacoes: OK });
assert.equal(sem.ok, false); assert.doesNotMatch(sem.erro, /chave/i); assert.match(sem.erro, /entrega/i);

// ---- entrega com chave maiúscula, repetida: a segunda é a mesma
ok(fluxo('entrega', { chave: 'ENT-T-016-R1', resumo: 'Rotas criadas.', arquivos: ['api.py'], verificacoes: OK }));
assert.equal(ok(fluxo('entrega', { chave: 'ENT-T-016-R1', resumo: 'Rotas criadas.', arquivos: ['api.py'], verificacoes: OK })).repetido, true, 'mesma entrega, mesma chave: não duplica');
ok(fluxo('entrega', { resumo: 'Segunda entrega sem chave nenhuma.', arquivos: ['api.py'], verificacoes: OK }));   // sem chave: o app cria
assert.equal(q.obter(card.id).workflow.revisao, 2);
assert.equal(ok(fluxo('entrega', { resumo: 'Segunda entrega sem chave nenhuma.', arquivos: ['api.py'], verificacoes: OK })).repetido, true, 'sem chave, o mesmo conteúdo repetido continua sendo a mesma entrega');

// ---- evidência posterior: todas as formas de errar chave e ambiente passam
const casos = [
  { nome: 'sem chave e sem ambiente', dados: { verificacoes: OK } },
  { nome: 'chave com maiúsculas e espaços', dados: { chave: 'T-016 r12 Evidência', ambiente: 'worktree T-016', verificacoes: [{ comando: 'pytest -q', status: 'aprovado', evidencia: 'rodou de novo, 28 passed' }] } },
  { nome: 'ambiente em forma de objeto', dados: { chave: 'evid-obj', ambiente: { so: 'windows', banco: 'postgres' }, verificacoes: [{ comando: 'pytest -q', status: 'aprovado', evidencia: 'ok no banco local' }] } },
  { nome: 'ambiente vazio e chave numérica', dados: { chave: 123, ambiente: '', verificacoes: [{ comando: 'pytest -q', status: 'aprovado', evidencia: 'ok' }] } },
];
for (const c of casos) { const r = fluxo('evidencia', c.dados); assert(r.ok, `${c.nome}: ${r.erro}`); }
const hist = q.obter(card.id).workflow.historicoVerificacoes.filter((v) => v.origem === 'posterior');
assert(hist.length >= 4 && hist.every((v) => /^[a-z0-9-]+$/.test(v.chave) && v.ambiente), 'toda evidência ficou com chave normalizada e ambiente preenchido');
assert(hist.some((v) => /postgres/.test(v.ambiente)), 'ambiente em objeto foi guardado como texto, não perdido');
assert.equal(fluxo('evidencia', { chave: 'T-016 r12 Evidência', verificacoes: [{ comando: 'pytest -q', status: 'aprovado', evidencia: 'rodou de novo, 28 passed' }] }).repetido, true, 'a mesma evidência não duplica');

// ---- comando fora do plano entra como verificação extra, sem recusa e sem virar obrigatória
const extra = fluxo('evidencia', { verificacoes: [{ comando: 'ruff check src', status: 'aprovado', evidencia: 'só B008, a linha de base do repo' }] });
assert(extra.ok, extra.erro);
const vs = q.obter(card.id).workflow.verificacoes;
assert(vs.some((v) => v.comando === 'ruff check src' && !v.obrigatoria), 'comando fora do plano ficou como verificação extra, não obrigatória');
assert(vs.find((v) => v.comando === 'pytest -q').obrigatoria, 'e a obrigatória continua obrigatória');

// ---- relato sem chave
assert(ok(q.relatar(card.id, { resumo: 'Rodei tudo de novo.' }, 'backend')).ok);
assert.equal(ok(q.relatar(card.id, { resumo: 'Rodei tudo de novo.' }, 'backend')).repetido, true);
assert.equal(q.relatar(card.id, { chave: 'x' }, 'backend').ok, false, 'relato sem resumo continua recusado (aí falta conteúdo de verdade)');

// ---- achado sem chave e verificação pela chave normalizada
const ach = fluxo('achado', { severidade: 'baixa', arquivo: 'api.py', linha: 10, evidencia: 'Falta tratar 404.', impacto: 'Erro genérico.', correcao: 'Retornar 404.' }, 'revisor');
assert(ach.ok, ach.erro);
const chaveAchado = q.obter(card.id).workflow.achados.at(-1).chave;
assert.match(chaveAchado, /^[a-z0-9-]+$/);
const ver = fluxo('verificar-achado', { chave: chaveAchado, veredito: 'confirmado', evidencia: 'Reproduzi com id inexistente.' }, 'qa');
assert(ver.ok, ver.erro);
console.log('PASS: chaves estáveis e ambiente (nenhuma forma de chave ou ambiente é recusada; o app normaliza, completa e deduplica).');
