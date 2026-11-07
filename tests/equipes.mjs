// Equipes dentro do projeto: um projeto (uma pasta) com várias equipes (templates), cada uma com quadro, conversas e agentes próprios;
// a equipe que o projeto já tinha continua na mesma pasta; lideranças enxergam as outras equipes só para leitura; tirar uma equipe
// não apaga os arquivos dela.
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

// ---- projeto criado como sempre: a equipe principal é o template escolhido, na pasta de sempre
const cr = await J('POST', '/api/projetos', { nome: 'Produto X', caminho: path.join(tmp, 'alvo'), template: 'software' });
const pid = cr.projeto.id; const pasta = cr.pastaProjeto;
let lista = (await J('GET', '/api/app')).projetos.find((p) => p.id === pid);
assert.deepEqual(lista.equipes.map((e) => e.id), ['principal']); assert.equal(lista.equipes[0].cid, pid, 'a principal usa o id do projeto (nada muda para quem já tinha)');
assert.equal(lista.equipes[0].pasta, pasta);

// ---- adicionar equipes: assessoria e product design, cada uma com pasta e quadro próprios
const ass = await J('POST', `/api/p/${pid}/equipes`, { template: 'professional-operations' });
assert.equal(ass.status, 201); const cidAss = ass.equipe.cid;
assert.equal(cidAss, `${pid}__professional_operations`.slice(0, pid.length + 2 + 24).replace(/__$/, ''), 'id da equipe = projeto__equipe');
const pd = await J('POST', `/api/p/${pid}/equipes`, { template: 'product-design', nome: 'Design do app' });
assert.equal(pd.equipe.nome, 'Design do app');
assert.equal((await J('POST', `/api/p/${pid}/equipes`, { template: 'nao-existe' })).status, 400);
lista = (await J('GET', '/api/app')).projetos.find((p) => p.id === pid);
assert.equal(lista.equipes.length, 3);
assert(fs.existsSync(path.join(pasta, 'equipes', ass.equipe.id)), 'equipe nova ganha pasta própria dentro do projeto');

// ---- cada equipe é independente: quadro, elenco e liderança próprios, pelas mesmas rotas
const estSw = await J('GET', `/api/p/${pid}/estado`); const estAss = await J('GET', `/api/p/${cidAss}/estado`);
assert.equal(estAss.template.id, 'professional-operations'); assert.equal(estSw.template.id, 'software');
const cSw = projetos.ctx(pid); const cAss = projetos.ctx(cidAss);
cSw.quadro.criar({ titulo: 'API de chaves', descricao: 'x', dono: 'backend', coluna: 'andamento', aceite: ['ok'] }, 'po');
cSw.quadro.criar({ titulo: 'Tela de login', descricao: 'x', dono: 'frontend', coluna: 'pronto', aceite: ['ok'] }, 'po');
assert.equal(cAss.quadro.listar().length, 0, 'o quadro da assessoria não recebe os cards do software');
assert.equal(projetos.ctx(`${pid}__principal`), cSw, 'projeto__principal e projeto são o mesmo contexto');

// ---- o assessor enxerga as outras equipes (só leitura), com andamento e onde ficam os arquivos
const outras = projetos.outrasEquipes(cidAss);
assert.deepEqual(outras.map((o) => o.id).sort(), [pid, pd.equipe.cid].sort()); assert(outras.some((o) => o.nome === 'Design do app'));
const sw = outras.find((o) => o.id === pid);
assert.equal(sw.andamento.andamento, 1); assert.equal(sw.andamento.pronto, 1); assert.equal(sw.pasta, pasta);
assert(sw.recentes.some((r) => r.titulo === 'API de chaves'));
assert(!projetos.outrasEquipes(cidAss).some((o) => o.id === cidAss), 'uma equipe não aparece para ela mesma');

// ---- piloto, vigia e salvamento rodam em todas as equipes
assert(projetos.todosContextos().length >= 3);

// ---- renomear e tirar equipe: a principal não sai; a pasta da que saiu fica intacta
assert.equal((await J('PUT', `/api/p/${pid}/equipes/${pd.equipe.id}`, { nome: 'Design' })).status, 200);
assert.equal((await J('DELETE', `/api/p/${pid}/equipes/principal`)).status, 400);
assert.equal((await J('DELETE', `/api/p/${pid}/equipes/${pd.equipe.id}`)).status, 200);
lista = (await J('GET', '/api/app')).projetos.find((p) => p.id === pid);
assert.equal(lista.equipes.length, 2);
assert(fs.existsSync(path.join(pasta, 'equipes', pd.equipe.id)), 'os arquivos da equipe que saiu continuam na pasta');
assert.equal((await J('GET', `/api/p/${pid}__${pd.equipe.id}/estado`)).status, 404, 'equipe removida não responde');

// ---- financeiro é um só por projeto: o diagnóstico do projeto soma o consumo de todas as equipes
const creditos = await import('../lib/creditos.mjs');
creditos.registrarTarefa({ engine: 'claude', modelo: 'm', tipo: 'x/y', projeto: pid, agente: 'backend', caracteresPrompt: 10, resultado: { duracaoMs: 1000, tokens: { entrada: 100, saida: 10, cache: 0, criacaoCache: 0 } } });
creditos.registrarTarefa({ engine: 'claude', modelo: 'm', tipo: 'x/y', projeto: cidAss, agente: 'coletor', caracteresPrompt: 10, resultado: { duracaoMs: 1000, tokens: { entrada: 100, saida: 10, cache: 0, criacaoCache: 0 } } });
const diagProjeto = creditos.diagnostico(pid, 1), diagEquipe = creditos.diagnostico(cidAss, 1);
assert(/2 chamada/.test(diagProjeto) || /\b2\b/.test(diagProjeto), `o diagnóstico do projeto conta as 2 chamadas (software + assessoria): ${diagProjeto.slice(0, 120)}`);
assert(!/\b2 chamada/.test(diagEquipe), 'o de uma equipe secundária conta só a dela');

// ---- o perfil da Game Director é um só no projeto: mudou numa equipe, vale em todas (nome, estilo, foto)
assert.equal((await J('PUT', `/api/p/${pid}/agente/voce/perfil`, { nome: 'Debah' })).status, 200);
assert.equal(projetos.ctx(cidAss).elenco.usuario.nome, 'Debah', 'nome mudado na principal aparece na Assessoria');
assert.equal((await J('PUT', `/api/p/${cidAss}/agente/voce/estilo`, { decoracao: 'coroa', bio: 'Game Director' })).status, 200);
assert.equal(projetos.ctx(pid).elenco.usuario.estilo.decoracao, 'coroa', 'estilo mudado na Assessoria aparece na principal');
const png1x1 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
assert.equal((await J('POST', `/api/p/${cidAss}/agente/voce/foto`, { dataUrl: png1x1, recorte: { zoom: 1, x: 0, y: 0 } })).status, 200);
assert(projetos.ctx(pid).elenco.usuario.foto?.includes(`/api/p/${pid}/foto/voce`), 'a fota enviada pela Assessoria é servida pela principal e vale nas duas');
assert(fs.existsSync(path.join(pasta, 'fotos', 'voce.png')), 'a foto fica na pasta da equipe principal');
assert(!JSON.stringify(JSON.parse(fs.readFileSync(path.join(pasta, 'equipes', ass.equipe.id, 'perfis.json'), 'utf8'))).includes('"voce"'), 'a equipe secundária não guarda cópia própria do perfil dela');

// ---- conversa entre equipes: mencionar alguém de outra equipe abre uma sala espelhada; a resposta volta com nome e equipe
const ate = async (cond, ms = 15000) => { for (let i = 0; i < ms / 50 && !cond(); i++) await new Promise((r) => setTimeout(r, 50)); assert(cond(), 'tempo esgotado'); };
const cAs = cAss;
// alguém da assessoria cujo apelido não exista no software (nome igual ao de alguém daqui dá prioridade ao daqui)
const colega = projetos.colegasExternos(pid).find((x) => x.cid === cidAss && !cSw.elenco.mencoes(`@${x.token}`).agentes.length);
assert(colega, 'há colega da assessoria com apelido livre no software');
// a equipe de lá está com o teto de grupos de trabalho cheio: a sala entre equipes abre mesmo assim (teto próprio)
for (let i = 0; i < 5; i++) cAs.equipe.enviar({ canal: 'equipe', texto: `@coletor @progresso grupo de teste ${i}`, engine: 'claude', modo: 'conversar' });
await new Promise((r) => setTimeout(r, 300));
cSw.equipe.enviar({ canal: 'equipe', texto: `@${colega.token} você consegue me passar o status da semana da assessoria?`, engine: 'claude', modo: 'conversar' });
const salaSw = () => cSw.equipe.grupos().find((g) => g.ponte);
await ate(() => !!salaSw(), 5000);
const gSw = salaSw(); assert(gSw, 'abriu a sala entre equipes do lado do software'); assert(gSw.titulo.includes(colega.nome));
const salaAs = () => cAs.equipe.grupos().find((g) => g.ponte);
await ate(() => !!salaAs() && cAs.equipe.historico(salaAs().canal).some((m) => m.de === 'voce' && /status da semana/.test(m.texto)), 5000);
assert(salaAs().membros.includes(colega.agente), 'quem foi citado é membro da sala do lado da assessoria');
await ate(() => cAs.equipe.historico(salaAs().canal).some((m) => m.de === colega.agente && m.status === 'ok' && m.texto), 20000);
await ate(() => cSw.equipe.historico(gSw.canal).some((m) => String(m.de).startsWith(`ext:${colega.agente}@`) && m.ext?.nome === colega.nome && m.externa), 10000);
const espelho = cSw.equipe.historico(gSw.canal).find((m) => String(m.de).startsWith('ext:'));
assert.equal(espelho.ext.equipe, 'Assessoria Profissional'); assert(espelho.texto.length > 5, 'a resposta aparece do lado do software, com nome e equipe');
assert.equal(cSw.equipe.historico(gSw.canal).filter((m) => m.de === 'voce' && /status da semana/.test(m.texto)).length, 1, 'a conversa compartilhada mostra cada mensagem uma vez só');
assert(!cAs.equipe.historico(salaAs().canal).some((m) => String(m.de).startsWith(`ext:${colega.agente}`)), 'a mensagem espelhada não volta para a origem (sem eco infinito)');
// o @ de alguém de outra equipe não cai em quem daqui só tem aquele apelido por nome antigo de template
assert.equal(cSw.equipe.mencoesExternas(`@${colega.token} oi`).length, 1);
assert.equal(projetos.colegasExternos(pid).filter((x) => x.cid === cidAss).length, 15, 'o software enxerga os 15 da assessoria (sem os gerais que ele já tem: memorizador, Créditos e MCP)');

// ---- sala dos líderes: existe em cada equipe; o que você diz chega a todas as lideranças e as respostas voltam espelhadas
const salaSwL = cSw.equipe.salaLideres(), salaAsL = cAs.equipe.salaLideres();
assert(salaSwL.lideres && salaAsL.lideres && salaSwL.membros.includes('po') && salaAsL.membros.includes('chief_of_staff'));
cSw.equipe.enviar({ canal: salaSwL.canal, texto: 'Líderes, qual é a prioridade da semana em cada equipe?', engine: 'claude', modo: 'conversar' });
await ate(() => cAs.equipe.historico(salaAsL.canal).some((m) => m.de === 'voce' && /prioridade da semana/.test(m.texto)), 5000);
await ate(() => cAs.equipe.historico(salaAsL.canal).some((m) => m.de === 'chief_of_staff' && m.status === 'ok' && m.texto), 20000);
await ate(() => cSw.equipe.historico(salaSwL.canal).some((m) => String(m.de).startsWith('ext:chief_of_staff@') && m.externa), 10000);
await ate(() => cSw.equipe.historico(salaSwL.canal).some((m) => m.de === 'po' && m.status === 'ok'), 20000);   // a liderança daqui também responde
assert(cSw.equipe.grupos().some((g) => g.lideres), 'a sala aparece na lista de grupos');
// leitura do dia: só a Assessoria tem; roda na DM da liderança
assert.equal(cSw.equipe.briefing().ok, false);
assert.equal((await J('POST', `/api/p/${cidAss}/briefing`, {})).status, 202);
await ate(() => cAs.equipe.historico('dm:chief_of_staff').some((m) => m.de === 'chief_of_staff' && m.tipo === 'briefing'), 20000);

// ---- remover o projeto pela rota de uma equipe tira o projeto inteiro (todas as equipes)
assert.equal((await J('POST', `/api/p/${cidAss}/remover`)).status, 200);
assert(!(await J('GET', '/api/app')).projetos.some((p) => p.id === pid));
srv.encerrar(); await store.descarregar();
console.log('PASS: equipes no projeto (várias equipes por projeto, cada uma com quadro e agentes próprios, principal na pasta de sempre, assessor vê as outras só para leitura, tirar equipe preserva os arquivos).');
process.exit(0);
