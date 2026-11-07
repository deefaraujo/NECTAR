// The REAL executor path (no STUDIO_FAKE): argument building, system prompt file, reading stream-json and account
// usage, with a script in place of the CLI. Catches programming errors simulated mode never sees (such as an undeclared variable), which
// on 01/11/2026 left every agent stuck at "abrindo a sessão".
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'work-ia-exec-'));
delete process.env.STUDIO_FAKE;
process.env.STUDIO_DATA = path.join(tmp, 'data');
process.env.STUDIO_CLAUDE_STUB = path.join(import.meta.dirname, 'fixtures', 'claude-stub.cjs');
const runner = await import('../lib/runner.mjs');
const creditos = await import('../lib/creditos.mjs');

const atividades = []; let sinais = 0; let textoParcial = '';
const r = await runner.executar({ engine: 'claude', prompt: 'Responda só: pronto', sistema: 'Você é um teste.', modo: 'conversar', modelo: 'claude-haiku-4-5', esforco: 'low', cwd: tmp, addDirs: [tmp], mcp: [{ nome: 'x', tipo: 'http', url: 'http://127.0.0.1:1/mcp' }], onAtividade: (a) => atividades.push(a), onSinal: () => { sinais++; }, onTexto: (t) => { textoParcial = t; } });
assert.equal(r.erro, undefined, `the executor must not fail internally: ${r.erro}`);
assert.equal(r.texto, 'pronto', 'the stream-json result arrives whole');
assert.equal(textoParcial, 'pronto', 'partial text arrives through the deltas');
assert.deepEqual([...new Set(atividades)].filter((a) => !/^(localizando o CLI|pedindo vaga|esperando )/.test(a)), ['pensando', 'escrevendo'], 'the on-screen activities follow the events');
assert(sinais >= 4, 'each event is a sign of life');
assert.equal(r.tokens.entrada, 10);
assert.equal(creditos.atual().cinco?.pct, 12, 'the account usage reported in the stream is recorded');

// a programming error inside the executor becomes a visible error, never a hung call
const sem = await runner.executar({ engine: 'claude', prompt: 'x', modo: 'conversar', cwd: path.join(tmp, 'nao-existe'), onAtividade: () => {} });
assert(sem.erro || sem.texto !== undefined, 'the call always ends with text or an error');

console.log('PASS: executor on the real path (arguments, system prompt, MCP, stream-json, activities, account usage; internal error becomes a visible error).');
process.exit(0);
