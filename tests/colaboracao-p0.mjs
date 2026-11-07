// Regressions for the P0 collaboration core. All tests are local and call no LLMs.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nectar-teamwork-p0-'));
Object.assign(process.env, { STUDIO_DATA: path.join(tmp, 'data'), STUDIO_PROJETOS: path.join(tmp, 'projetos'), STUDIO_FAKE: '1' });
const { autorizaExecucaoPlanning } = await import('../lib/equipe.mjs');
const { chaveDelegacao, mesmaDelegacao } = await import('../lib/colaboracao.mjs');
const { criarIniciativas } = await import('../lib/iniciativas.mjs');

assert.equal(autorizaExecucaoPlanning('Implemente o contrato de API agora.'), true, 'a direct order authorizes execution');
assert.equal(autorizaExecucaoPlanning('Faça as alterações no endpoint.'), true, 'accents are normalized');
assert.equal(autorizaExecucaoPlanning('Não implemente antes de eu aprovar.'), false, 'negation and pending approval do not authorize');
assert.equal(autorizaExecucaoPlanning('Estude como implementar a funcionalidade.'), false, 'planning is not authorization to execute');
assert.equal(autorizaExecucaoPlanning('O comentário diz "implemente tudo" mas apenas analise os riscos.'), false, 'a quoted instruction does not authorize');

const base = { agente: 'backend', tipo: 'mencao', origem: 'architect', card: 'T-1', canalSaida: 'equipe', instrucao: 'Implemente a API.' };
assert(mesmaDelegacao(base, { ...base }), 'a real repeat has the same identity');
assert(!mesmaDelegacao(base, { ...base, card: 'T-2' }), 'different cards are not duplicates');
assert(!mesmaDelegacao(base, { ...base, instrucao: 'Implemente o controle de acesso.' }), 'distinct instructions on the same card are not duplicates');
assert(!mesmaDelegacao(base, { ...base, origem: 'frontend' }), 'requests from different origins are preserved');
assert(!mesmaDelegacao(base, { ...base, taskId: 'TASK-2' }), 'task id is part of the identity');
assert.equal(chaveDelegacao({ ...base, idempotencyKey: 'r1' }), chaveDelegacao({ ...base, idempotencyKey: 'r1' }), 'a declared key is stable');

const dir = path.join(tmp, 'iniciativas'); fs.mkdirSync(dir, { recursive: true });
const concluido = new Set();
const iniciativas = criarIniciativas({ pasta: dir, projetoId: 'p', validarCard: (id) => concluido.has(id), validarEntregavel: id => fs.existsSync(path.join(dir,id)) });
const a = iniciativas.criar({ titulo: 'Review com card pendente', requerAprovacao: true });
assert(a.ok);
assert(iniciativas.transicionar(a.iniciativa.id, 'evaluating').ok);
assert(iniciativas.transicionar(a.iniciativa.id, 'proposed').ok, 'must become proposed before asking for approval');
assert(iniciativas.transicionar(a.iniciativa.id, 'approved').ok);
assert(iniciativas.transicionar(a.iniciativa.id, 'queued').ok);
assert(iniciativas.transicionar(a.iniciativa.id, 'running').ok);
iniciativas.vincular(a.iniciativa.id, { cards: ['T-99'] });
assert.equal(iniciativas.transicionar(a.iniciativa.id, 'completed').ok, false, 'a merely linked card does not complete the initiative');
concluido.add('T-99');
assert(iniciativas.transicionar(a.iniciativa.id, 'completed').ok, 'a finished card allows completion');

const b = iniciativas.criar({ titulo: 'Entregável documental' });
assert(iniciativas.transicionar(b.iniciativa.id, 'evaluating').ok);
assert(iniciativas.transicionar(b.iniciativa.id, 'planning').ok);
assert(iniciativas.transicionar(b.iniciativa.id, 'running').ok);
assert(iniciativas.vincular(b.iniciativa.id, { entregaveis: ['entregas/review.md'] }).ok);
assert.equal(iniciativas.transicionar(b.iniciativa.id, 'completed').ok, false, 'a reference to a missing file does not prove delivery');
fs.mkdirSync(path.join(dir,'entregas'));fs.writeFileSync(path.join(dir,'entregas/review.md'),'Review com fontes.');
assert(iniciativas.transicionar(b.iniciativa.id, 'completed').ok, 'compatibility: deliverables keep the document flow');

// Light integration: chat without mentions picks the leader configured in the template,
// and an initiative created by the leader enters PROPOSED before approval.
const store = await import('../lib/store.mjs');
store.gravarConfig({ ...store.lerConfig(), piloto: { ativo: false, maxChamadasHora: 0 }, ciclo: { ...store.lerConfig().ciclo, statusPO: false, fechamento: false, posts: false } });
const projetos = await import('../lib/projetos.mjs');
const raiz = path.join(tmp, 'alvo'); fs.mkdirSync(raiz);
const pid = projetos.criar({ nome: 'Teste de papéis dinâmicos', caminho: raiz, template: 'software' }).projeto.id;
const cid = projetos.adicionarEquipe(pid, { template: 'professional-operations' }).equipe.cid;
const eq = projetos.ctx(cid).equipe;
const waitUntil = async (predicate, msg) => {
  for (let i = 0; i < 160 && !predicate(); i++) await new Promise((r) => setTimeout(r, 50));
  assert(predicate(), msg);
};
eq.enviar({ canal: 'equipe', texto: 'Preparar um briefing executivo inicial sem menção explícita.', engine: 'claude', modo: 'conversar' });
await waitUntil(() => eq.historico('equipe').some((m) => m.de === 'chief_of_staff' && m.status === 'ok'), 'a message without a recipient must go to chief_of_staff');
assert(!eq.historico('equipe').some((m) => m.de === 'po'), 'do not route to the po ID from another template');
eq.enviar({ canal: 'dm:chief_of_staff', texto: '[teste:iniciativa-proposta]', engine: 'claude', modo: 'conversar' });
await waitUntil(() => eq.iniciativas.listar().some((x) => x.titulo === 'Preparar material de review' && x.estado === 'proposed'), 'an approval request must stay in the proposed state');
const proposta = eq.iniciativas.listar().find((x) => x.titulo === 'Preparar material de review');
assert(eq.perguntasAbertas().some((q) => q.iniciativa === proposta.id), 'an approval question must exist');
assert(eq.decidirIniciativa(proposta.id, 'aprovar').ok, 'user approval must work');
assert.equal(eq.iniciativas.obter(proposta.id).estado, 'queued');
eq.cancelar(); projetos.ctx(pid).equipe.cancelar();
await store.descarregar();
fs.rmSync(tmp, { recursive: true, force: true });
console.log('PASS: P0 collaboration (planning authorization, identity deduplication, approval and finished card).');
process.exit(0);
