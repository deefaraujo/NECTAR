// Phase 7 (the three left out earlier): contract overridden per project, Assessor kept out of operations as a code rule,
// fidelity to the request as a code rule (a check the request does not imply becomes a proposed card, not a block).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'work-ia-fase7-'));
process.env.STUDIO_DATA = path.join(tmp, 'data'); process.env.STUDIO_PROJETOS = path.join(tmp, 'projetos'); process.env.STUDIO_FAKE = '1'; process.env.STUDIO_FAKE_LOCAL = '0';
const store = await import('../lib/store.mjs');
store.gravarConfig({ piloto: { ativo: false, maxChamadasHora: 0 }, ciclo: { statusPO: false, fechamento: false, orcamento: 14, revisaoAuto: false, versionar: false, curadoriaAuto: false, planningReplica: false } });
const projetos = await import('../lib/projetos.mjs');
const { criarElenco } = await import('../lib/agentes.mjs');
const dorme = (ms) => new Promise((x) => setTimeout(x, ms));
const esperaEm = async (eq, cond, ms = 20000) => { for (let t = 0; t < ms / 50 && !cond(); t++) await dorme(50); if (!cond()) console.error(eq.historico('equipe').slice(-6).map((m) => `${m.de}: ${(m.texto || '').replace(/\n/g, ' ').slice(0, 120)}`).join('\n')); assert(cond(), 'timed out'); };

// ---- A: the project overrides the template contract (new domain, extra check, own playbook, own review)
const pp = path.join(tmp, 'proj-contrato'); fs.mkdirSync(path.join(pp, 'template', 'playbooks'), { recursive: true });
fs.writeFileSync(path.join(pp, 'template', 'contrato.json'), JSON.stringify({ dominios: { unreal: 'frontend' }, palavras: { unreal: ['blueprint', 'unreal', 'ue5'] }, checagens: [{ nome: 'uasset existe', tipo: 'arquivos' }], revisao: { nome: 'revisão de cena', instrucao: 'Abra a cena no editor.' } }));
fs.writeFileSync(path.join(pp, 'template', 'playbooks', 'backend.md'), 'Playbook do projeto: pronto é com o endpoint no ar.');
const el = criarElenco('software', pp);
assert.equal(el.contrato.especialistaDe('o blueprint do unreal não compila').agente, 'frontend', 'project domain');
assert.equal(el.contrato.especialistaDe('conflito no merge da branch').agente, 'versionamento', 'template domain still applies');
assert.equal(el.contrato.checagens.length, 1); assert.equal(el.contrato.revisao.nome, 'revisão de cena'); assert.equal(el.contrato.fluxo, 'tecnico');
assert(/Playbook do projeto/.test(el.contrato.playbookDe('backend')) && /Merge de teste/.test(el.contrato.playbookDe('versionamento')), 'the project playbook wins; the others still come from the template');

// ---- B: Assessor kept out of operations
fs.mkdirSync(path.join(tmp, 'alvo'));
const r = projetos.criar({ nome: 'Dois times', caminho: path.join(tmp, 'alvo'), template: 'software' }); assert(r.ok);
const pid = r.projeto.id; const cSw = projetos.ctx(pid);
const ass = projetos.adicionarEquipe(pid, { template: 'professional-operations' }); assert(ass.ok);
const cidAss = ass.equipe.cid || ass.cid || `${pid}__${ass.equipe.id}`;
const cAs = projetos.ctx(cidAss); assert(cAs, 'assessoria context');
const colegaAss = projetos.colegasExternos(pid).find((x) => x.cid === cidAss && x.geral === 'assessor');
assert(colegaAss, 'software sees the other team Assessor as geral=assessor');
// the Assessor talks to software mentioning backend: only leadership is called, with the direction instruction; backend does not answer
const rp = cSw.equipe.receberPonte({ canal: 'x', deCid: cidAss, deCanal: 'equipe', deEquipe: 'Assessoria Profissional', de: `ext:${colegaAss.agente}@${cidAss}`, quem: { nome: colegaAss.nome, cargo: colegaAss.cargo, equipe: 'Assessoria Profissional', cor: '#fff', cid: cidAss, agente: colegaAss.agente }, texto: '@backend suba o merge agora e rode a suíte, prioridade máxima.' });
assert(rp.ok);
const sala = () => cSw.equipe.grupos().find((g) => g.ponte);
await esperaEm(cSw.equipe, () => !!sala() && cSw.equipe.historico(sala().canal).some((m) => m.de === 'po' && m.status === 'ok'));
await dorme(1500);
assert(!cSw.equipe.historico(sala().canal).some((m) => m.de === 'backend'), 'backend is not called by the Assessor');
// on this side, a specialist trying to talk to the Assessor is blocked; leadership is not
assert(cAs.perfis.definirNome('chief_of_staff', 'Zelda').ok, 'renames the Assessor so it does not collide with P.O. Helena');
const tokenAss = projetos.colegasExternos(pid).find((x) => x.cid === cidAss && x.geral === 'assessor').token;
assert.equal(tokenAss, 'zelda');
cSw.equipe.enviar({ canal: 'dm:backend', texto: `[teste:chama-assessor:${tokenAss}] e aí?`, engine: 'claude', modo: 'conversar' });
await esperaEm(cSw.equipe, () => cSw.equipe.historico('dm:backend').some((m) => m.de === 'sistema' && /Só a liderança fala com o Assessor/.test(m.texto)));
assert.equal(cSw.equipe.grupos().filter((g) => g.ponte).length, 1, 'no new bridge was opened from backend');

// ---- C: proportional checks are part of acceptance even without a literal mention of tests.
fs.mkdirSync(path.join(tmp, 'alvo2'));
const r2 = projetos.criar({ nome: 'Fidelidade', caminho: path.join(tmp, 'alvo2'), template: 'software' }); assert(r2.ok);
const c = projetos.ctx(r2.projeto.id); const eq = c.equipe;
eq.enviar({ canal: 'equipe', texto: 'planning: quero a página de chaves de API [simulado:planning-com-validacoes]', engine: 'claude', modo: 'conversar' });
await esperaEm(eq, () => eq.plannings()[0]?.status === 'aguardando', 30000);
const prop = eq.plannings()[0];
assert.equal(prop.cards, 1, 'delivery and proportional checks stay on the same card');
let q = eq.perguntasAbertas().find((x) => x.planning === prop.id); assert(q);
assert(eq.responder(q.id, 'Aprovar e criar os cards').ok);
await esperaEm(eq, () => c.quadro.listar().length === 1);
const [pedido] = c.quadro.listar();
assert.deepEqual(pedido.validacoesObrigatorias, ['pytest tests/integration', 'npm run lint'], 'do not drop required gates just because the request did not mention tests');
// a request that implies tests: the validations stay on the card
eq.enviar({ canal: 'equipe', texto: 'planning: quero a página de chaves de API com testes de integração [simulado:planning-com-validacoes]', engine: 'claude', modo: 'conversar' });
await esperaEm(eq, () => eq.plannings().length === 2 && eq.plannings()[1]?.status === 'aguardando', 30000);
assert.equal(eq.plannings()[1].cards, 1, 'with the request implying tests, no extra card');

eq.cancelar(); cSw.equipe.cancelar(); cAs.equipe.cancelar();
console.log('PASS: phase 7 (contract overridden per project, Assessor out of operations by code rule, fidelity to the request by code rule).');
try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* Windows still holds the folder */ }
process.exit(0);
