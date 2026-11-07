// Fase 7 (os três que tinham ficado de fora): contrato sobrescrito por projeto, Assessor fora do operacional como regra de código,
// fidelidade ao pedido como regra de código (verificação que o pedido não implica vira card proposto, não bloqueio).
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
const esperaEm = async (eq, cond, ms = 20000) => { for (let t = 0; t < ms / 50 && !cond(); t++) await dorme(50); if (!cond()) console.error(eq.historico('equipe').slice(-6).map((m) => `${m.de}: ${(m.texto || '').replace(/\n/g, ' ').slice(0, 120)}`).join('\n')); assert(cond(), 'tempo esgotado'); };

// ---- A: o projeto sobrescreve o contrato do template (domínio novo, checagem a mais, playbook próprio, revisão própria)
const pp = path.join(tmp, 'proj-contrato'); fs.mkdirSync(path.join(pp, 'template', 'playbooks'), { recursive: true });
fs.writeFileSync(path.join(pp, 'template', 'contrato.json'), JSON.stringify({ dominios: { unreal: 'frontend' }, palavras: { unreal: ['blueprint', 'unreal', 'ue5'] }, checagens: [{ nome: 'uasset existe', tipo: 'arquivos' }], revisao: { nome: 'revisão de cena', instrucao: 'Abra a cena no editor.' } }));
fs.writeFileSync(path.join(pp, 'template', 'playbooks', 'backend.md'), 'Playbook do projeto: pronto é com o endpoint no ar.');
const el = criarElenco('software', pp);
assert.equal(el.contrato.especialistaDe('o blueprint do unreal não compila').agente, 'frontend', 'domínio do projeto');
assert.equal(el.contrato.especialistaDe('conflito no merge da branch').agente, 'versionamento', 'domínio do template continua');
assert.equal(el.contrato.checagens.length, 1); assert.equal(el.contrato.revisao.nome, 'revisão de cena'); assert.equal(el.contrato.fluxo, 'tecnico');
assert(/Playbook do projeto/.test(el.contrato.playbookDe('backend')) && /Merge de teste/.test(el.contrato.playbookDe('versionamento')), 'playbook do projeto vence; os outros seguem do template');

// ---- B: Assessor fora do operacional
fs.mkdirSync(path.join(tmp, 'alvo'));
const r = projetos.criar({ nome: 'Dois times', caminho: path.join(tmp, 'alvo'), template: 'software' }); assert(r.ok);
const pid = r.projeto.id; const cSw = projetos.ctx(pid);
const ass = projetos.adicionarEquipe(pid, { template: 'professional-operations' }); assert(ass.ok);
const cidAss = ass.equipe.cid || ass.cid || `${pid}__${ass.equipe.id}`;
const cAs = projetos.ctx(cidAss); assert(cAs, 'contexto da assessoria');
const colegaAss = projetos.colegasExternos(pid).find((x) => x.cid === cidAss && x.geral === 'assessor');
assert(colegaAss, 'o software enxerga o Assessor da outra equipe como geral=assessor');
// o Assessor fala com o software citando o backend: só a liderança é chamada, com a instrução de rumo; o backend não responde
const rp = cSw.equipe.receberPonte({ canal: 'x', deCid: cidAss, deCanal: 'equipe', deEquipe: 'Assessoria Profissional', de: `ext:${colegaAss.agente}@${cidAss}`, quem: { nome: colegaAss.nome, cargo: colegaAss.cargo, equipe: 'Assessoria Profissional', cor: '#fff', cid: cidAss, agente: colegaAss.agente }, texto: '@backend suba o merge agora e rode a suíte, prioridade máxima.' });
assert(rp.ok);
const sala = () => cSw.equipe.grupos().find((g) => g.ponte);
await esperaEm(cSw.equipe, () => !!sala() && cSw.equipe.historico(sala().canal).some((m) => m.de === 'po' && m.status === 'ok'));
await dorme(1500);
assert(!cSw.equipe.historico(sala().canal).some((m) => m.de === 'backend'), 'o backend não é chamado pelo Assessor');
// do lado de cá, um especialista tentando falar com o Assessor é barrado; a liderança não
assert(cAs.perfis.definirNome('chief_of_staff', 'Zelda').ok, 'renomeia o Assessor para não colidir com a P.O. Helena');
const tokenAss = projetos.colegasExternos(pid).find((x) => x.cid === cidAss && x.geral === 'assessor').token;
assert.equal(tokenAss, 'zelda');
cSw.equipe.enviar({ canal: 'dm:backend', texto: `[teste:chama-assessor:${tokenAss}] e aí?`, engine: 'claude', modo: 'conversar' });
await esperaEm(cSw.equipe, () => cSw.equipe.historico('dm:backend').some((m) => m.de === 'sistema' && /Só a liderança fala com o Assessor/.test(m.texto)));
assert.equal(cSw.equipe.grupos().filter((g) => g.ponte).length, 1, 'não abriu ponte nova a partir do backend');

// ---- C: verificações proporcionais integram o aceite mesmo sem menção literal a testes.
fs.mkdirSync(path.join(tmp, 'alvo2'));
const r2 = projetos.criar({ nome: 'Fidelidade', caminho: path.join(tmp, 'alvo2'), template: 'software' }); assert(r2.ok);
const c = projetos.ctx(r2.projeto.id); const eq = c.equipe;
eq.enviar({ canal: 'equipe', texto: 'planning: quero a página de chaves de API [simulado:planning-com-validacoes]', engine: 'claude', modo: 'conversar' });
await esperaEm(eq, () => eq.plannings()[0]?.status === 'aguardando', 30000);
const prop = eq.plannings()[0];
assert.equal(prop.cards, 1, 'entrega e verificações proporcionais permanecem no mesmo card');
let q = eq.perguntasAbertas().find((x) => x.planning === prop.id); assert(q);
assert(eq.responder(q.id, 'Aprovar e criar os cards').ok);
await esperaEm(eq, () => c.quadro.listar().length === 1);
const [pedido] = c.quadro.listar();
assert.deepEqual(pedido.validacoesObrigatorias, ['pytest tests/integration', 'npm run lint'], 'não retirar gates necessários só porque o pedido não citou testes');
// pedido que implica teste: as validações ficam no card
eq.enviar({ canal: 'equipe', texto: 'planning: quero a página de chaves de API com testes de integração [simulado:planning-com-validacoes]', engine: 'claude', modo: 'conversar' });
await esperaEm(eq, () => eq.plannings().length === 2 && eq.plannings()[1]?.status === 'aguardando', 30000);
assert.equal(eq.plannings()[1].cards, 1, 'com o pedido implicando teste, nenhum card extra');

eq.cancelar(); cSw.equipe.cancelar(); cAs.equipe.cancelar();
console.log('PASS: fase 7 (contrato sobrescrito por projeto, Assessor fora do operacional por regra de código, fidelidade ao pedido por regra de código).');
try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* o Windows ainda segura a pasta */ }
process.exit(0);
