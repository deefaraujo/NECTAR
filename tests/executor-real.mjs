// O caminho REAL do executor (sem STUDIO_FAKE): montagem dos argumentos, arquivo de system prompt, leitura do stream-json e do uso
// da conta, com um script no lugar do CLI. Pega erro de programação que o modo simulado nunca vê (como variável sem declaração), que
// em 01/11/2026 deixou todos os agentes presos em "abrindo a sessão".
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
assert.equal(r.erro, undefined, `o executor não pode falhar por dentro: ${r.erro}`);
assert.equal(r.texto, 'pronto', 'o resultado do stream-json chega inteiro');
assert.equal(textoParcial, 'pronto', 'o texto parcial chega pelos deltas');
assert.deepEqual([...new Set(atividades)].filter((a) => !/^(localizando o CLI|pedindo vaga|esperando )/.test(a)), ['pensando', 'escrevendo'], 'as atividades da tela acompanham os eventos');
assert(sinais >= 4, 'cada evento é sinal de vida');
assert.equal(r.tokens.entrada, 10);
assert.equal(creditos.atual().cinco?.pct, 12, 'o uso da conta informado no fluxo é registrado');

// erro de programação dentro do executor vira erro visível, nunca uma chamada pendurada
const sem = await runner.executar({ engine: 'claude', prompt: 'x', modo: 'conversar', cwd: path.join(tmp, 'nao-existe'), onAtividade: () => {} });
assert(sem.erro || sem.texto !== undefined, 'a chamada sempre termina com texto ou erro');

console.log('PASS: executor no caminho real (argumentos, system prompt, MCP, stream-json, atividades, uso da conta; erro interno vira erro visível).');
process.exit(0);
