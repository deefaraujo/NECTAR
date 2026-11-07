// Debugging through the API: list who is running and who is waiting, stop one agent (queued ones too), stop everything and resume autopilot.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'work-ia-chamadas-'));
Object.assign(process.env, { STUDIO_DATA: path.join(tmp, 'data'), STUDIO_PROJETOS: path.join(tmp, 'projetos'), STUDIO_FAKE: '1' });
const store = await import('../lib/store.mjs');
store.gravarConfig({ ...store.lerConfig(), piloto: { ativo: false, maxChamadasHora: 0 } });
const { iniciarServidor } = await import('../server.mjs');
const srv = await iniciarServidor({ porta: 0 });
const base = `http://127.0.0.1:${srv.porta}`;
const J = async (m, u, b) => (await fetch(base + u, { method: m, headers: b ? { 'Content-Type': 'application/json' } : {}, body: b ? JSON.stringify(b) : undefined })).json();
fs.mkdirSync(path.join(tmp, 'alvo'));
const pid = (await J('POST', '/api/projetos', { nome: 'Chamadas', caminho: path.join(tmp, 'alvo'), template: 'software' })).projeto.id;
await J('POST', `/api/p/${pid}/mensagem`, { canal: 'dm:backend', texto: '[teste:longo] me conta o andamento', engine: 'claude', modo: 'conversar' });
let ch;
for (let i = 0; i < 40; i++) { ch = await J('GET', `/api/p/${pid}/chamadas`); if (ch.rodando.length || ch.naFila.length) break; await new Promise((r) => setTimeout(r, 50)); }
assert(ch.rodando.some((x) => x.agente === 'backend'), 'the API shows who is running');
assert('vagas' in ch && 'pilotoSuspenso' in ch && Array.isArray(ch.naFila), 'and shows free slots, queue and whether autopilot is suspended');
const parou = await J('POST', `/api/p/${pid}/chamadas/parar`, { agente: 'backend' });
assert(parou.cancelados >= 1, 'stop one agent through the API');
for (let i = 0; i < 40; i++) { ch = await J('GET', `/api/p/${pid}/chamadas`); if (!ch.rodando.length) break; await new Promise((r) => setTimeout(r, 100)); }
assert.equal(ch.rodando.length, 0, 'after stopping, nobody is left running');
const tudo = await J('POST', `/api/p/${pid}/chamadas/parar`, {});
assert.equal(tudo.pilotoSuspenso, true, 'stopping everything suspends autopilot');
const volta = await J('POST', `/api/p/${pid}/chamadas/retomar`, {});
assert.equal(volta.pilotoSuspenso, false, 'and autopilot can be resumed through the API');
srv.encerrar(); await store.descarregar();
console.log('PASS: calls through the API (list who runs and who waits, stop one agent or all, queued ones too, and resume autopilot).');
process.exit(0);
