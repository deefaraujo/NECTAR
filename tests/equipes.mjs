// Teams inside a project: one project (one folder) with several teams (templates), each with its own board, chats and agents;
// the team the project already had stays in the same folder; leaders see the other teams read-only; removing a team
// does not delete its files.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'work-ia-equipes-'));
Object.assign(process.env, { STUDIO_DATA: path.join(tmp, 'data'), STUDIO_PROJETOS: path.join(tmp, 'projetos'), STUDIO_FAKE: '1' });
const store = await import('../lib/store.mjs');
store.gravarConfig({ ...store.lerConfig(), piloto: { ativo: false, maxChamadasHora: 0 } });
const { iniciarServidor } = await import('../server.mjs');
const projetos = await import('../lib/projetos.mjs');
const srv = await iniciarServidor({ porta: 0 });
const base = `http://127.0.0.1:${srv.porta}`;
const J = async (m, u, b) => { const r = await fetch(base + u, { method: m, headers: { 'Content-Type': 'application/json' }, body: m === 'GET' ? undefined : JSON.stringify(b || {}) }); return { status: r.status, ...(await r.json().catch(() => ({}))) }; };
fs.mkdirSync(path.join(tmp, 'alvo'));

// ---- project created as usual: the main team is the chosen template, in the usual folder
const cr = await J('POST', '/api/projetos', { nome: 'Produto X', caminho: path.join(tmp, 'alvo'), template: 'software' });
const pid = cr.projeto.id; const pasta = cr.pastaProjeto;
let lista = (await J('GET', '/api/app')).projetos.find((p) => p.id === pid);
assert.deepEqual(lista.equipes.map((e) => e.id), ['principal']); assert.equal(lista.equipes[0].cid, pid, 'the main team uses the project id (nothing changes for existing projects)');
assert.equal(lista.equipes[0].pasta, pasta);

// ---- add teams: assessoria and product design, each with its own folder and board
const ass = await J('POST', `/api/p/${pid}/equipes`, { template: 'professional-operations' });
assert.equal(ass.status, 201); const cidAss = ass.equipe.cid;
assert.equal(cidAss, `${pid}__professional_operations`.slice(0, pid.length + 2 + 24).replace(/__$/, ''), 'team id = project__team');
const pd = await J('POST', `/api/p/${pid}/equipes`, { template: 'product-design', nome: 'Design do app' });
assert.equal(pd.equipe.nome, 'Design do app');
assert.equal((await J('POST', `/api/p/${pid}/equipes`, { template: 'nao-existe' })).status, 400);
lista = (await J('GET', '/api/app')).projetos.find((p) => p.id === pid);
assert.equal(lista.equipes.length, 3);
assert(fs.existsSync(path.join(pasta, 'equipes', ass.equipe.id)), 'a new team gets its own folder inside the project');

// ---- each team is independent: its own board, roster and leadership, through the same routes
const estSw = await J('GET', `/api/p/${pid}/estado`); const estAss = await J('GET', `/api/p/${cidAss}/estado`);
assert.equal(estAss.template.id, 'professional-operations'); assert.equal(estSw.template.id, 'software');
const cSw = projetos.ctx(pid); const cAss = projetos.ctx(cidAss);
cSw.quadro.criar({ titulo: 'API de chaves', descricao: 'x', dono: 'backend', coluna: 'andamento', aceite: ['ok'] }, 'po');
cSw.quadro.criar({ titulo: 'Tela de login', descricao: 'x', dono: 'frontend', coluna: 'pronto', aceite: ['ok'] }, 'po');
assert.equal(cAss.quadro.listar().length, 0, 'the assessoria board does not receive the software cards');
assert.equal(projetos.ctx(`${pid}__principal`), cSw, 'project__principal and project are the same context');

// ---- the assistant sees the other teams (read-only), with progress and where the files live
const outras = projetos.outrasEquipes(cidAss);
assert.deepEqual(outras.map((o) => o.id).sort(), [pid, pd.equipe.cid].sort()); assert(outras.some((o) => o.nome === 'Design do app'));
const sw = outras.find((o) => o.id === pid);
assert.equal(sw.andamento.andamento, 1); assert.equal(sw.andamento.pronto, 1); assert.equal(sw.pasta, pasta);
assert(sw.recentes.some((r) => r.titulo === 'API de chaves'));
assert(!projetos.outrasEquipes(cidAss).some((o) => o.id === cidAss), 'a team does not show up to itself');

// ---- autopilot, watcher and saving run on every team
assert(projetos.todosContextos().length >= 3);

// ---- rename and remove a team: the main one cannot be removed; the removed team's folder stays intact
assert.equal((await J('PUT', `/api/p/${pid}/equipes/${pd.equipe.id}`, { nome: 'Design' })).status, 200);
assert.equal((await J('DELETE', `/api/p/${pid}/equipes/principal`)).status, 400);
assert.equal((await J('DELETE', `/api/p/${pid}/equipes/${pd.equipe.id}`)).status, 200);
lista = (await J('GET', '/api/app')).projetos.find((p) => p.id === pid);
assert.equal(lista.equipes.length, 2);
assert(fs.existsSync(path.join(pasta, 'equipes', pd.equipe.id)), 'the removed team files stay in the folder');
assert.equal((await J('GET', `/api/p/${pid}__${pd.equipe.id}/estado`)).status, 404, 'a removed team does not respond');

// ---- billing is one per project: the project diagnostic sums usage across all teams
const creditos = await import('../lib/creditos.mjs');
creditos.registrarTarefa({ engine: 'claude', modelo: 'm', tipo: 'x/y', projeto: pid, agente: 'backend', caracteresPrompt: 10, resultado: { duracaoMs: 1000, tokens: { entrada: 100, saida: 10, cache: 0, criacaoCache: 0 } } });
creditos.registrarTarefa({ engine: 'claude', modelo: 'm', tipo: 'x/y', projeto: cidAss, agente: 'coletor', caracteresPrompt: 10, resultado: { duracaoMs: 1000, tokens: { entrada: 100, saida: 10, cache: 0, criacaoCache: 0 } } });
const diagProjeto = creditos.diagnostico(pid, 1), diagEquipe = creditos.diagnostico(cidAss, 1);
assert(/2 chamada/.test(diagProjeto) || /\b2\b/.test(diagProjeto), `the project diagnostic counts both calls (software + assessoria): ${diagProjeto.slice(0, 120)}`);
assert(!/\b2 chamada/.test(diagEquipe), 'a secondary team diagnostic counts only its own');

// ---- the Game Director profile is one per project: changed in one team, it applies to all (name, style, photo)
assert.equal((await J('PUT', `/api/p/${pid}/agente/voce/perfil`, { nome: 'Debah' })).status, 200);
assert.equal(projetos.ctx(cidAss).elenco.usuario.nome, 'Debah', 'name changed on the main team shows on Assessoria');
assert.equal((await J('PUT', `/api/p/${cidAss}/agente/voce/estilo`, { decoracao: 'coroa', bio: 'Game Director' })).status, 200);
assert.equal(projetos.ctx(pid).elenco.usuario.estilo.decoracao, 'coroa', 'style changed on Assessoria shows on the main team');
const png1x1 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
assert.equal((await J('POST', `/api/p/${cidAss}/agente/voce/foto`, { dataUrl: png1x1, recorte: { zoom: 1, x: 0, y: 0 } })).status, 200);
assert(projetos.ctx(pid).elenco.usuario.foto?.includes(`/api/p/${pid}/foto/voce`), 'the photo uploaded through Assessoria is served by the main team and applies to both');
assert(fs.existsSync(path.join(pasta, 'fotos', 'voce.png')), 'the photo lives in the main team folder');
assert(!JSON.stringify(JSON.parse(fs.readFileSync(path.join(pasta, 'equipes', ass.equipe.id, 'perfis.json'), 'utf8'))).includes('"voce"'), 'the secondary team keeps no copy of the user profile');

// ---- cross-team chat: mentioning someone from another team opens a mirrored room; the reply comes back with name and team
const ate = async (cond, ms = 15000) => { for (let i = 0; i < ms / 50 && !cond(); i++) await new Promise((r) => setTimeout(r, 50)); assert(cond(), 'timed out'); };
const cAs = cAss;
// someone from assessoria whose handle does not exist in software (a name matching someone here gives priority to the local one)
const colega = projetos.colegasExternos(pid).find((x) => x.cid === cidAss && !cSw.elenco.mencoes(`@${x.token}`).agentes.length);
assert(colega, 'there is an assessoria colleague with a handle free in software');
// the other team has hit its work group cap: the cross-team room opens anyway (separate cap)
for (let i = 0; i < 5; i++) cAs.equipe.enviar({ canal: 'equipe', texto: `@coletor @progresso grupo de teste ${i}`, engine: 'claude', modo: 'conversar' });
await new Promise((r) => setTimeout(r, 300));
cSw.equipe.enviar({ canal: 'equipe', texto: `@${colega.token} você consegue me passar o status da semana da assessoria?`, engine: 'claude', modo: 'conversar' });
const salaSw = () => cSw.equipe.grupos().find((g) => g.ponte);
await ate(() => !!salaSw(), 5000);
const gSw = salaSw(); assert(gSw, 'the cross-team room opened on the software side'); assert(gSw.titulo.includes(colega.nome));
const salaAs = () => cAs.equipe.grupos().find((g) => g.ponte);
await ate(() => !!salaAs() && cAs.equipe.historico(salaAs().canal).some((m) => m.de === 'voce' && /status da semana/.test(m.texto)), 5000);
assert(salaAs().membros.includes(colega.agente), 'the mentioned agent is a member of the room on the assessoria side');
await ate(() => cAs.equipe.historico(salaAs().canal).some((m) => m.de === colega.agente && m.status === 'ok' && m.texto), 20000);
await ate(() => cSw.equipe.historico(gSw.canal).some((m) => String(m.de).startsWith(`ext:${colega.agente}@`) && m.ext?.nome === colega.nome && m.externa), 10000);
const espelho = cSw.equipe.historico(gSw.canal).find((m) => String(m.de).startsWith('ext:'));
assert.equal(espelho.ext.equipe, 'Assessoria Profissional'); assert(espelho.texto.length > 5, 'the reply shows on the software side, with name and team');
assert.equal(cSw.equipe.historico(gSw.canal).filter((m) => m.de === 'voce' && /status da semana/.test(m.texto)).length, 1, 'the shared conversation shows each message only once');
assert(!cAs.equipe.historico(salaAs().canal).some((m) => String(m.de).startsWith(`ext:${colega.agente}`)), 'the mirrored message does not return to its origin (no infinite echo)');
// an @ for someone from another team does not land on a local agent that only has that handle from an old template name
assert.equal(cSw.equipe.mencoesExternas(`@${colega.token} oi`).length, 1);
assert.equal(projetos.colegasExternos(pid).filter((x) => x.cid === cidAss).length, 15, 'software sees the 15 from assessoria (without the shared ones it already has: memorizer, Credits and MCP)');

// ---- leaders room: exists in every team; what you say reaches all leaders and the replies come back mirrored
const salaSwL = cSw.equipe.salaLideres(), salaAsL = cAs.equipe.salaLideres();
assert(salaSwL.lideres && salaAsL.lideres && salaSwL.membros.includes('po') && salaAsL.membros.includes('chief_of_staff'));
cSw.equipe.enviar({ canal: salaSwL.canal, texto: 'Líderes, qual é a prioridade da semana em cada equipe?', engine: 'claude', modo: 'conversar' });
await ate(() => cAs.equipe.historico(salaAsL.canal).some((m) => m.de === 'voce' && /prioridade da semana/.test(m.texto)), 5000);
await ate(() => cAs.equipe.historico(salaAsL.canal).some((m) => m.de === 'chief_of_staff' && m.status === 'ok' && m.texto), 20000);
await ate(() => cSw.equipe.historico(salaSwL.canal).some((m) => String(m.de).startsWith('ext:chief_of_staff@') && m.externa), 10000);
await ate(() => cSw.equipe.historico(salaSwL.canal).some((m) => m.de === 'po' && m.status === 'ok'), 20000);   // the local leadership replies too
assert(cSw.equipe.grupos().some((g) => g.lideres), 'the room shows in the group list');
// daily briefing: only Assessoria has it; it runs in the leadership DM
assert.equal(cSw.equipe.briefing().ok, false);
assert.equal((await J('POST', `/api/p/${cidAss}/briefing`, {})).status, 202);
await ate(() => cAs.equipe.historico('dm:chief_of_staff').some((m) => m.de === 'chief_of_staff' && m.tipo === 'briefing'), 20000);

// ---- removing the project through a team route removes the whole project (all teams)
assert.equal((await J('POST', `/api/p/${cidAss}/remover`)).status, 200);
assert(!(await J('GET', '/api/app')).projetos.some((p) => p.id === pid));
srv.encerrar(); await store.descarregar();
console.log('PASS: teams in a project (several teams per project, each with its own board and agents, main team in the usual folder, assistant sees the others read-only, removing a team keeps its files).');
process.exit(0);
