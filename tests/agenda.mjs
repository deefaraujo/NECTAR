// Project calendar: one shared by all teams; you create events through the API, the agent through the agenda.criar action (with today's date in the
// prompt so "next Friday" resolves to a date), a reminder becomes a notification, cancel and delete work, and repeating does not duplicate.
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

// ---- today's reference for the model
assert.match(referenciaDeHoje(new Date('2026-11-01T12:00:00-03:00')), /Agora: domingo, 01\/11\/2026/);
assert.match(referenciaDeHoje(new Date('2026-11-01T12:00:00-03:00')), /sex.? 06\/11/);
assert.equal(quando('2026-11-06T15:00:00-03:00'), 'sexta-feira, 06/11 15:00');

// ---- you create through the API; it shows for every team (one calendar per project)
const em2d = new Date(Date.now() + 2 * 86400_000); em2d.setHours(15, 0, 0, 0);
const cr = await J('POST', `/api/p/${pid}/agenda`, { titulo: 'Reunião com o cliente', inicio: em2d.toISOString(), duracaoMin: 45, local: 'Teams', participantes: 'Louise, Pedro', tipo: 'reuniao' });
assert.equal(cr.status, 201); const ev = cr.evento; assert.equal(ev.participantes.length, 2); assert.equal(new Date(ev.fim) - new Date(ev.inicio), 45 * 60_000);
assert.equal((await J('POST', `/api/p/${pid}/agenda`, { titulo: 'Sem data' })).status, 400);
assert.equal((await J('POST', `/api/p/${pid}/agenda`, { titulo: 'Fim antes', inicio: em2d.toISOString(), fim: new Date(em2d.getTime() - 60_000).toISOString() })).status, 400);
const naAss = await J('GET', `/api/p/${cidAss}/agenda`);
assert(naAss.eventos.some((e) => e.id === ev.id), 'the Assessoria team sees the event created by the main team');
assert(fs.existsSync(path.join(projetos.ctx(pid).pasta, 'agenda.json')), 'the calendar lives in the main team folder');

// ---- the agent books through the action (as if the user had told the assistant about the appointment)
const cAs = projetos.ctx(cidAss);
assert.equal(cAs.agenda, projetos.ctx(pid).agenda, 'same calendar for both teams');
const sexta = new Date(em2d.getTime() + 3 * 86400_000);
const rAg = cAs.agenda.criar({ titulo: 'Apresentação do pipeline', inicio: sexta.toISOString(), duracaoMin: 60, tipo: 'reuniao', lembreteMin: 30 }, 'chief_of_staff', 'Assessoria Profissional');
assert(rAg.ok && rAg.evento.origem.quem === 'chief_of_staff' && rAg.evento.origem.equipe === 'Assessoria Profissional');
assert.equal(cAs.agenda.criar({ titulo: 'apresentação do pipeline', inicio: sexta.toISOString() }, 'chief_of_staff').repetido, true, 'repeating the action does not duplicate');
assert.equal(cAs.agenda.total(), 2);
assert.match(cAs.agenda.paraPrompt(), /Reunião com o cliente @ Teams \(com Louise, Pedro\)/);

// ---- update, cancel, delete (through the API) and the 'agenda' SSE event
const up = await J('PUT', `/api/p/${pid}/agenda/${ev.id}`, { titulo: 'Reunião com o cliente (pipeline)', lembreteMin: 60 });
assert.equal(up.status, 200); assert.equal(up.evento.lembreteMin, 60);
assert.equal((await J('PUT', `/api/p/${pid}/agenda/${rAg.evento.id}`, { cancelado: true })).evento.cancelado, true);
assert.equal((await J('GET', `/api/p/${pid}/agenda`)).eventos.length, 1, 'cancelled events leave the default listing');
assert.equal((await J('GET', `/api/p/${pid}/agenda?cancelados=1`)).eventos.length, 2);
assert.equal((await J('DELETE', `/api/p/${pid}/agenda/${rAg.evento.id}`)).status, 200);
assert.equal((await J('DELETE', `/api/p/${pid}/agenda/ev-999`)).status, 404);

// ---- reminder: an event starting in 10 min with a 15 min reminder becomes a notification on the main team
const logo = new Date(Date.now() + 10 * 60_000);
const lem = projetos.ctx(pid).agenda.criar({ titulo: 'Daily', inicio: logo.toISOString(), duracaoMin: 15, lembreteMin: 15 }, 'voce');
assert(lem.ok);
const antes = projetos.ctx(pid).notificacoes.listar?.().length ?? null;
assert.equal(projetos.tiquetaqueAgendas(), 1, 'one reminder fired');
assert.equal(projetos.tiquetaqueAgendas(), 0, 'and it does not fire again');
if (antes !== null) assert(projetos.ctx(pid).notificacoes.listar().some((n) => n.tipo === 'agenda' && /Daily/.test(n.titulo)), 'the notification arrived');

srv.encerrar(); await store.descarregar();
console.log('PASS: agenda (one per project for all teams, creation through the API and by the agent with origin, current date for the model, repeats do not duplicate, update/cancel/delete, reminder becomes a notification once).');
process.exit(0);
