// Depuração pela API: listar quem roda e quem espera, parar um agente (inclusive na fila), parar tudo e religar o piloto.
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
assert(ch.rodando.some((x) => x.agente === 'backend'), 'a API mostra quem está rodando');
assert('vagas' in ch && 'pilotoSuspenso' in ch && Array.isArray(ch.naFila), 'e mostra vagas, fila e se o piloto está suspenso');
const parou = await J('POST', `/api/p/${pid}/chamadas/parar`, { agente: 'backend' });
assert(parou.cancelados >= 1, 'parar um agente pela API');
for (let i = 0; i < 40; i++) { ch = await J('GET', `/api/p/${pid}/chamadas`); if (!ch.rodando.length) break; await new Promise((r) => setTimeout(r, 100)); }
assert.equal(ch.rodando.length, 0, 'depois de parar, ninguém fica rodando');
const tudo = await J('POST', `/api/p/${pid}/chamadas/parar`, {});
assert.equal(tudo.pilotoSuspenso, true, 'parar tudo suspende o piloto');
const volta = await J('POST', `/api/p/${pid}/chamadas/retomar`, {});
assert.equal(volta.pilotoSuspenso, false, 'e dá para religar o piloto pela API');
srv.encerrar(); await store.descarregar();
console.log('PASS: chamadas pela API (listar quem roda e quem espera, parar um agente ou tudo, inclusive na fila, e religar o piloto).');
process.exit(0);
