// Agenda do projeto: uma só para todas as equipes; você cria pela API, o agente cria pela ação agenda.criar (com a data de hoje no
// prompt para "próxima sexta" virar data), lembrete vira notificação, cancelar e excluir, e repetição não duplica.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'work-ia-agenda-'));
Object.assign(process.env, { STUDIO_DATA: path.join(tmp, 'data'), STUDIO_PROJETOS: path.join(tmp, 'projetos'), STUDIO_FAKE: '1' });
const store = await import('../lib/store.mjs');
store.gravarConfig({ ...store.lerConfig(), piloto: { ativo: false, maxChamadasHora: 0 } });
const { iniciarServidor } = await import('../server.mjs');
const projetos = await import('../lib/projetos.mjs');
const { referenciaDeHoje, quando } = await import('../lib/compromissos.mjs');
const srv = await iniciarServidor({ porta: 0 });
const base = `http://127.0.0.1:${srv.porta}`;
const J = async (m, u, b) => { const r = await fetch(base + u, { method: m, headers: { 'Content-Type': 'application/json' }, body: m === 'GET' ? undefined : JSON.stringify(b || {}) }); return { status: r.status, ...(await r.json().catch(() => ({}))) }; };
fs.mkdirSync(path.join(tmp, 'alvo'));
const pid = (await J('POST', '/api/projetos', { nome: 'Agenda', caminho: path.join(tmp, 'alvo'), template: 'software' })).projeto.id;
const cidAss = (await J('POST', `/api/p/${pid}/equipes`, { template: 'professional-operations' })).equipe.cid;

// ---- referência de hoje para o modelo
assert.match(referenciaDeHoje(new Date('2026-11-01T12:00:00-03:00')), /Agora: domingo, 01\/11\/2026/);
assert.match(referenciaDeHoje(new Date('2026-11-01T12:00:00-03:00')), /sex.? 06\/11/);
assert.equal(quando('2026-11-06T15:00:00-03:00'), 'sexta-feira, 06/11 15:00');

// ---- você cria pela API; aparece para todas as equipes (uma agenda por projeto)
const em2d = new Date(Date.now() + 2 * 86400_000); em2d.setHours(15, 0, 0, 0);
const cr = await J('POST', `/api/p/${pid}/agenda`, { titulo: 'Reunião com o cliente', inicio: em2d.toISOString(), duracaoMin: 45, local: 'Teams', participantes: 'Louise, Pedro', tipo: 'reuniao' });
assert.equal(cr.status, 201); const ev = cr.evento; assert.equal(ev.participantes.length, 2); assert.equal(new Date(ev.fim) - new Date(ev.inicio), 45 * 60_000);
assert.equal((await J('POST', `/api/p/${pid}/agenda`, { titulo: 'Sem data' })).status, 400);
assert.equal((await J('POST', `/api/p/${pid}/agenda`, { titulo: 'Fim antes', inicio: em2d.toISOString(), fim: new Date(em2d.getTime() - 60_000).toISOString() })).status, 400);
const naAss = await J('GET', `/api/p/${cidAss}/agenda`);
assert(naAss.eventos.some((e) => e.id === ev.id), 'a Assessoria vê o evento criado pela principal');
assert(fs.existsSync(path.join(projetos.ctx(pid).pasta, 'agenda.json')), 'a agenda fica na pasta da equipe principal');

// ---- o agente marca pela ação (como se ela tivesse contado o compromisso ao assessor)
const cAs = projetos.ctx(cidAss);
assert.equal(cAs.agenda, projetos.ctx(pid).agenda, 'mesma agenda nas duas equipes');
const sexta = new Date(em2d.getTime() + 3 * 86400_000);
const rAg = cAs.agenda.criar({ titulo: 'Apresentação do pipeline', inicio: sexta.toISOString(), duracaoMin: 60, tipo: 'reuniao', lembreteMin: 30 }, 'chief_of_staff', 'Assessoria Profissional');
assert(rAg.ok && rAg.evento.origem.quem === 'chief_of_staff' && rAg.evento.origem.equipe === 'Assessoria Profissional');
assert.equal(cAs.agenda.criar({ titulo: 'apresentação do pipeline', inicio: sexta.toISOString() }, 'chief_of_staff').repetido, true, 'repetir a ação não duplica');
assert.equal(cAs.agenda.total(), 2);
assert.match(cAs.agenda.paraPrompt(), /Reunião com o cliente @ Teams \(com Louise, Pedro\)/);

// ---- atualizar, cancelar, excluir (pela API) e evento 'agenda' no SSE
const up = await J('PUT', `/api/p/${pid}/agenda/${ev.id}`, { titulo: 'Reunião com o cliente (pipeline)', lembreteMin: 60 });
assert.equal(up.status, 200); assert.equal(up.evento.lembreteMin, 60);
assert.equal((await J('PUT', `/api/p/${pid}/agenda/${rAg.evento.id}`, { cancelado: true })).evento.cancelado, true);
assert.equal((await J('GET', `/api/p/${pid}/agenda`)).eventos.length, 1, 'cancelado some da listagem padrão');
assert.equal((await J('GET', `/api/p/${pid}/agenda?cancelados=1`)).eventos.length, 2);
assert.equal((await J('DELETE', `/api/p/${pid}/agenda/${rAg.evento.id}`)).status, 200);
assert.equal((await J('DELETE', `/api/p/${pid}/agenda/ev-999`)).status, 404);

// ---- lembrete: evento que começa daqui a 10 min com lembrete de 15 vira notificação na equipe principal
const logo = new Date(Date.now() + 10 * 60_000);
const lem = projetos.ctx(pid).agenda.criar({ titulo: 'Daily', inicio: logo.toISOString(), duracaoMin: 15, lembreteMin: 15 }, 'voce');
assert(lem.ok);
const antes = projetos.ctx(pid).notificacoes.listar?.().length ?? null;
assert.equal(projetos.tiquetaqueAgendas(), 1, 'um lembrete disparou');
assert.equal(projetos.tiquetaqueAgendas(), 0, 'e não dispara de novo');
if (antes !== null) assert(projetos.ctx(pid).notificacoes.listar().some((n) => n.tipo === 'agenda' && /Daily/.test(n.titulo)), 'a notificação chegou');

srv.encerrar(); await store.descarregar();
console.log('PASS: agenda (uma por projeto para todas as equipes, criação pela API e pelo agente com origem, data de hoje para o modelo, repetição não duplica, atualizar/cancelar/excluir, lembrete vira notificação uma vez).');
process.exit(0);
