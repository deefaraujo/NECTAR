// Mensagem que ficou "trabalhando" porque o app fechou no meio da chamada não pode ficar para sempre "começando" ao reabrir.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'work-ia-orfas-'));
Object.assign(process.env, { STUDIO_DATA: path.join(tmp, 'data'), STUDIO_PROJETOS: path.join(tmp, 'projetos'), STUDIO_FAKE: '1' });
fs.mkdirSync(path.join(tmp, 'alvo'));
// projeto já existente, com conversas gravadas no meio de uma chamada (como ficam quando o app é fechado)
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
assert(!todas.some((m) => m.status === 'trabalhando'), 'nenhuma mensagem fica "trabalhando" depois de reabrir');
const m2 = todas.find((m) => m.id === 'm2');
assert.equal(m2.status, 'erro'); assert.match(m2.erro, /app foi fechado/, 'a mensagem diz o que aconteceu');
assert.equal(todas.find((m) => m.id === 'm1').status, 'ok', 'as mensagens normais não mudam');
assert(!JSON.parse(fs.readFileSync(path.join(pasta, 'chats.json'), 'utf8')).canais.equipe.some((m) => m.status === 'trabalhando'), 'e a correção fica gravada');
c.equipe.cancelar();
console.log('PASS: mensagens órfãs (chamada interrompida pelo fechamento do app não fica "começando" para sempre).');
process.exit(0);
