// Regressões do núcleo de colaboração P0. Todos os testes são locais, sem chamar LLMs.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nectar-teamwork-p0-'));
Object.assign(process.env, { STUDIO_DATA: path.join(tmp, 'data'), STUDIO_PROJETOS: path.join(tmp, 'projetos'), STUDIO_FAKE: '1' });
const { autorizaExecucaoPlanning } = await import('../lib/equipe.mjs');
const { chaveDelegacao, mesmaDelegacao } = await import('../lib/colaboracao.mjs');
const { criarIniciativas } = await import('../lib/iniciativas.mjs');

assert.equal(autorizaExecucaoPlanning('Implemente o contrato de API agora.'), true, 'ordem direta autoriza execução');
assert.equal(autorizaExecucaoPlanning('Faça as alterações no endpoint.'), true, 'acentos são normalizados');
assert.equal(autorizaExecucaoPlanning('Não implemente antes de eu aprovar.'), false, 'negação e dependência de aprovação não autorizam');
assert.equal(autorizaExecucaoPlanning('Estude como implementar a funcionalidade.'), false, 'planejar não é autorização para executar');
assert.equal(autorizaExecucaoPlanning('O comentário diz "implemente tudo" mas apenas analise os riscos.'), false, 'instrução citada não autoriza');

const base = { agente: 'backend', tipo: 'mencao', origem: 'architect', card: 'T-1', canalSaida: 'equipe', instrucao: 'Implemente a API.' };
assert(mesmaDelegacao(base, { ...base }), 'repetição real tem mesma identidade');
assert(!mesmaDelegacao(base, { ...base, card: 'T-2' }), 'cards diferentes não são duplicatas');
assert(!mesmaDelegacao(base, { ...base, instrucao: 'Implemente o controle de acesso.' }), 'instruções distintas no mesmo card não são duplicatas');
assert(!mesmaDelegacao(base, { ...base, origem: 'frontend' }), 'solicitações de origens diferentes são preservadas');
assert(!mesmaDelegacao(base, { ...base, taskId: 'TASK-2' }), 'task id faz parte da identidade');
assert.equal(chaveDelegacao({ ...base, idempotencyKey: 'r1' }), chaveDelegacao({ ...base, idempotencyKey: 'r1' }), 'chave declarada é estável');

const dir = path.join(tmp, 'iniciativas'); fs.mkdirSync(dir, { recursive: true });
const concluido = new Set();
const iniciativas = criarIniciativas({ pasta: dir, projetoId: 'p', validarCard: (id) => concluido.has(id), validarEntregavel: id => fs.existsSync(path.join(dir,id)) });
const a = iniciativas.criar({ titulo: 'Review com card pendente', requerAprovacao: true });
assert(a.ok);
assert(iniciativas.transicionar(a.iniciativa.id, 'evaluating').ok);
assert(iniciativas.transicionar(a.iniciativa.id, 'proposed').ok, 'antes de pedir aprovação deve virar proposed');
assert(iniciativas.transicionar(a.iniciativa.id, 'approved').ok);
assert(iniciativas.transicionar(a.iniciativa.id, 'queued').ok);
assert(iniciativas.transicionar(a.iniciativa.id, 'running').ok);
iniciativas.vincular(a.iniciativa.id, { cards: ['T-99'] });
assert.equal(iniciativas.transicionar(a.iniciativa.id, 'completed').ok, false, 'card somente associado não conclui iniciativa');
concluido.add('T-99');
assert(iniciativas.transicionar(a.iniciativa.id, 'completed').ok, 'card concluído libera conclusão');

const b = iniciativas.criar({ titulo: 'Entregável documental' });
assert(iniciativas.transicionar(b.iniciativa.id, 'evaluating').ok);
assert(iniciativas.transicionar(b.iniciativa.id, 'planning').ok);
assert(iniciativas.transicionar(b.iniciativa.id, 'running').ok);
assert(iniciativas.vincular(b.iniciativa.id, { entregaveis: ['entregas/review.md'] }).ok);
assert.equal(iniciativas.transicionar(b.iniciativa.id, 'completed').ok, false, 'referência a arquivo inexistente não comprova entrega');
fs.mkdirSync(path.join(dir,'entregas'));fs.writeFileSync(path.join(dir,'entregas/review.md'),'Review com fontes.');
assert(iniciativas.transicionar(b.iniciativa.id, 'completed').ok, 'compatibilidade: entregáveis mantêm fluxo documental');

// Integração leve: o chat sem menções escolhe o líder configurado no template,
// e uma iniciativa criada pelo líder entra em PROPOSED antes da aprovação.
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
await waitUntil(() => eq.historico('equipe').some((m) => m.de === 'chief_of_staff' && m.status === 'ok'), 'mensagem sem destinatário deve ir para chief_of_staff');
assert(!eq.historico('equipe').some((m) => m.de === 'po'), 'não encaminhar ao ID po de outro template');
eq.enviar({ canal: 'dm:chief_of_staff', texto: '[teste:iniciativa-proposta]', engine: 'claude', modo: 'conversar' });
await waitUntil(() => eq.iniciativas.listar().some((x) => x.titulo === 'Preparar material de review' && x.estado === 'proposed'), 'solicitação de aprovação deve ficar no estado proposed');
const proposta = eq.iniciativas.listar().find((x) => x.titulo === 'Preparar material de review');
assert(eq.perguntasAbertas().some((q) => q.iniciativa === proposta.id), 'pergunta de aprovação deve existir');
assert(eq.decidirIniciativa(proposta.id, 'aprovar').ok, 'aprovação da pessoa usuária deve funcionar');
assert.equal(eq.iniciativas.obter(proposta.id).estado, 'queued');
eq.cancelar(); projetos.ctx(pid).equipe.cancelar();
await store.descarregar();
fs.rmSync(tmp, { recursive: true, force: true });
console.log('PASS: colaboração P0 (autorização planning, deduplicação por identidade, aprovação e card concluído).');
process.exit(0);
