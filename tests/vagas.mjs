// Call slots: the autopilot can fill all of them with cards, but the lead and Game Director requests get one extra slot and jump
// the queue. Whoever waits is told ("in queue") instead of looking like they are working.
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

const a = await pegarVaga(false); const b = await pegarVaga(false);            // the autopilot filled both slots with cards
let filaC = 0, cOk = false; const pc = pegarVaga(false, (n) => { filaC = n; }).then((l) => { cOk = true; return l; });
await tique(); assert(!cOk, 'third card waits'); assert.equal(filaC, 1, 'and is told it is queued');
let pOk = false; const pp = pegarVaga(true).then((l) => { pOk = true; return l; });
await tique(); assert(pOk, 'the lead gets in right away, on the reserved slot, even with the autopilot using everything');
let filaQ = 0, qOk = false; const pq = pegarVaga(true, (n) => { filaQ = n; }).then((l) => { qOk = true; return l; });
await tique(); assert(!qOk, 'a second priority call waits'); assert.equal(filaQ, 1, 'and goes ahead of the card that was already waiting');
a(); await tique();
assert(qOk && !cOk, 'a freed slot goes first to the priority call, not to the card that arrived earlier');
b(); await tique(); assert(!cOk, 'with priority calls using the extra slot, the card still respects the autopilot limit');
(await pp)(); await tique(); assert(cOk, 'when a slot is free, the card gets in');
(await pq)(); (await pc)(); await tique();
assert.deepEqual([vagasAgora().usadas, vagasAgora().naFila], [0, 0], 'no slot stays stuck');

// cancelling a queued call (stop button / API): it leaves without running and without holding a slot
const x = await pegarVaga(false); const y = await pegarVaga(false);
const pz = pegarVaga(false, null, { projeto: 'p1', agente: 'po' }); const pw = pegarVaga(false, null, { projeto: 'p1', agente: 'backend' });
await tique(); assert.deepEqual(vagasAgora().fila.map((f) => f.agente), ['po', 'backend'], 'the API lists who is queued');
assert.equal(soltarFila((w) => w.agente === 'po'), 1); assert.equal(await pz, null, 'the call stopped in the queue ends without running');
x(); assert.equal(typeof (await pw), 'function', 'and the queue moves on to the next one'); (await pw)(); y();
assert.deepEqual([vagasAgora().usadas, vagasAgora().naFila], [0, 0], 'and nothing stays stuck after stopping');
console.log('PASS: slots (lead and Game Director requests with a reserved slot and queue priority; waiters show in the queue; no stuck slot).');
