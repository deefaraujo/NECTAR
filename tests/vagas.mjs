// Vagas de chamada: o piloto pode ocupar todas com cards, mas a liderança e os pedidos da Game Director têm uma vaga a mais e passam na
// frente. Quem espera é avisado ("na fila"), em vez de parecer que está trabalhando.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'work-ia-vagas-'));
process.env.STUDIO_DATA = path.join(tmp, 'data');
const store = await import('../lib/store.mjs');
const cfg = store.lerConfig(); store.gravarConfig({ ...cfg, ciclo: { ...cfg.ciclo, paralelo: 2 } });
const { _testeVagas: { pegarVaga }, vagasAgora, soltarFila } = await import('../lib/runner.mjs');
const tique = () => new Promise((r) => setTimeout(r, 10));

const a = await pegarVaga(false); const b = await pegarVaga(false);            // o piloto ocupou as duas vagas com cards
let filaC = 0, cOk = false; const pc = pegarVaga(false, (n) => { filaC = n; }).then((l) => { cOk = true; return l; });
await tique(); assert(!cOk, 'terceiro card espera'); assert.equal(filaC, 1, 'e é avisado de que está na fila');
let pOk = false; const pp = pegarVaga(true).then((l) => { pOk = true; return l; });
await tique(); assert(pOk, 'a liderança entra na hora, na vaga reservada, mesmo com o piloto ocupando tudo');
let filaQ = 0, qOk = false; const pq = pegarVaga(true, (n) => { filaQ = n; }).then((l) => { qOk = true; return l; });
await tique(); assert(!qOk, 'uma segunda chamada prioritária espera'); assert.equal(filaQ, 1, 'e fica à frente do card que já esperava');
a(); await tique();
assert(qOk && !cOk, 'vaga liberada vai primeiro para a prioritária, não para o card que chegou antes');
b(); await tique(); assert(!cOk, 'com prioritárias usando a vaga extra, o card ainda respeita o limite do piloto');
(await pp)(); await tique(); assert(cOk, 'quando sobra vaga, o card entra');
(await pq)(); (await pc)(); await tique();
assert.deepEqual([vagasAgora().usadas, vagasAgora().naFila], [0, 0], 'nenhuma vaga fica presa');

// cancelar quem está na fila (botão parar / API): sai sem rodar e sem prender vaga
const x = await pegarVaga(false); const y = await pegarVaga(false);
const pz = pegarVaga(false, null, { projeto: 'p1', agente: 'po' }); const pw = pegarVaga(false, null, { projeto: 'p1', agente: 'backend' });
await tique(); assert.deepEqual(vagasAgora().fila.map((f) => f.agente), ['po', 'backend'], 'a API lista quem está na fila');
assert.equal(soltarFila((w) => w.agente === 'po'), 1); assert.equal(await pz, null, 'a chamada parada na fila termina sem rodar');
x(); assert.equal(typeof (await pw), 'function', 'e a fila segue para o próximo'); (await pw)(); y();
assert.deepEqual([vagasAgora().usadas, vagasAgora().naFila], [0, 0], 'e nada fica preso depois de parar');
console.log('PASS: vagas (liderança e pedidos da Game Director com vaga reservada e prioridade na fila; quem espera aparece na fila; nenhuma vaga presa).');
