// A message left "working" because the app closed mid-call must not stay "starting" forever after reopening.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'work-ia-orfas-'));
Object.assign(process.env, { STUDIO_DATA: path.join(tmp, 'data'), STUDIO_PROJETOS: path.join(tmp, 'projetos'), STUDIO_FAKE: '1' });
fs.mkdirSync(path.join(tmp, 'alvo'));
// existing project, with chats saved mid-call (as they are when the app is closed)
fs.mkdirSync(path.join(tmp, 'data'), { recursive: true });
const pasta = path.join(tmp, 'projetos', 'Orfas'); fs.mkdirSync(pasta, { recursive: true });
fs.writeFileSync(path.join(tmp, 'data', 'projetos.json'), JSON.stringify({ ativo: 'orfas-1', lista: [{ id: 'orfas-1', nome: 'Orfas', raiz: path.join(tmp, 'alvo'), pasta: 'Orfas', template: 'software', extras: [], criado: new Date().toISOString() }] }));
fs.writeFileSync(path.join(pasta, 'chats.json'), JSON.stringify({ seq: 3, canais: { equipe: [
  { id: 'm1', canal: 'equipe', de: 'po', status: 'ok', texto: 'Bom dia.', em: '2026-11-01T01:00:00.000Z' },
  { id: 'm2', canal: 'equipe', de: 'po', status: 'trabalhando', texto: '', em: '2026-11-01T01:39:53.736Z' },
], 'grp-1': [{ id: 'm3', canal: 'grp-1', de: 'backend', status: 'trabalhando', texto: '', em: '2026-11-01T01:39:41.336Z' }] } }));
const p = await import('../lib/projetos.mjs');
const c = p.ctx('orfas-1');
const todas = [...c.equipe.historico('equipe'), ...c.equipe.historico('grp-1')];
assert(!todas.some((m) => m.status === 'trabalhando'), 'no message stays "working" after reopening');
const m2 = todas.find((m) => m.id === 'm2');
assert.equal(m2.status, 'erro'); assert.match(m2.erro, /app foi fechado/, 'the message says what happened');
assert.equal(todas.find((m) => m.id === 'm1').status, 'ok', 'normal messages do not change');
assert(!JSON.parse(fs.readFileSync(path.join(pasta, 'chats.json'), 'utf8')).canais.equipe.some((m) => m.status === 'trabalhando'), 'and the fix is persisted');
c.equipe.cancelar();
console.log('PASS: orphan messages (a call interrupted by the app closing does not stay "starting" forever).');
process.exit(0);
