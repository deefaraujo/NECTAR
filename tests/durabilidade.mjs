// Durability: an abrupt Windows restart leaves the file zeroed. Nothing may be lost or overwritten by an empty start.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'work-ia-dur-'));
process.env.STUDIO_DATA = path.join(tmp, 'data'); process.env.STUDIO_PROJETOS = path.join(tmp, 'projetos'); process.env.STUDIO_BAK_MS = '0'; process.env.STUDIO_SNAP_MS = '1';   // without STUDIO_PROJETOS, the "Cota" project was created in the real folder (77 copies in two days)
const { ler, gravar, ocorrencias } = await import('../lib/store.mjs');
const zerar = (f) => fs.writeFileSync(f, Buffer.alloc(fs.statSync(f).size || 200));
const d = path.join(tmp, 'p'); fs.mkdirSync(d, { recursive: true });
const ilegiveis = (f) => fs.readdirSync(path.dirname(f)).filter((n) => n.startsWith(`${path.basename(f)}.ilegivel-`));

// a file that never existed: a genuine first time, creating nothing
assert.deepEqual(ler(path.join(d, 'novo.json'), { z: 1 }), { z: 1 });
assert(!fs.existsSync(path.join(d, 'novo.json')), 'reading does not create a file');

// 1) file zeroed by a restart: restored from the previous copy and the bad file is kept
const f1 = path.join(d, 'dados.json');
gravar(f1, { v: 1 }); gravar(f1, { v: 2 }); gravar(f1, { v: 3 });
zerar(f1);
assert.deepEqual(ler(f1, { v: 0 }), { v: 2 }, 'recovers the previous version instead of starting empty');
assert.deepEqual(JSON.parse(fs.readFileSync(f1, 'utf8')), { v: 2 }, 'and the main file is valid again');
assert.equal(ilegiveis(f1).length, 1, 'the zeroed file is quarantined, not overwritten');
assert(ocorrencias.some((o) => /recuperado/.test(o.msg)));

// 2) no copy at all: starts from the default, but the unreadable file is preserved
const f2 = path.join(d, 'sem-copia.json');
fs.writeFileSync(f2, Buffer.alloc(500));
assert.deepEqual(ler(f2, { x: 1 }), { x: 1 });
assert.equal(ilegiveis(f2).length, 1, 'quarantine even without a copy');
assert(!fs.existsSync(f2), 'nothing is written over it before the application decides');

// 3) JSON cut in the middle (disk full, kill) is handled too
const f3 = path.join(d, 'cortado.json');
gravar(f3, { lista: [1, 2, 3] }); gravar(f3, { lista: [1, 2, 3, 4] });
fs.writeFileSync(f3, '{"lista":[1,2,');
assert.deepEqual(ler(f3, {}), { lista: [1, 2, 3] }, 'truncated JSON is restored from the copy');

// 4) hourly snapshot: without a .bak there is still something to recover from
const f4 = path.join(d, 'grande.json');
const grande = (n) => ({ n, texto: 'x'.repeat(3000) });
gravar(f4, grande(1)); await new Promise((r) => setTimeout(r, 5)); gravar(f4, grande(2));
assert(fs.readdirSync(path.join(d, '_backups')).some((n) => n.startsWith('grande.')), 'snapshot created');
fs.rmSync(`${f4}.bak`, { force: true }); zerar(f4);
assert.equal(ler(f4, {}).n, 1, 'recovers from the snapshot when there is no .bak');

// 5) a sharp shrink keeps the large version
const f5 = path.join(d, 'quadro.json');
gravar(f5, { cartoes: Array.from({ length: 200 }, (_, i) => ({ id: i, t: 'card '.repeat(20) })) });
gravar(f5, { cartoes: [] });
assert(fs.readdirSync(d).some((n) => n.startsWith('quadro.json.antes-de-encolher-')), 'large version kept before being shrunk');

// 6) the real board: zeroing board.json does not delete the cards
const { criarQuadro } = await import('../lib/quadro.mjs');
const pasta = path.join(tmp, 'proj'); fs.mkdirSync(pasta, { recursive: true });
const abrir = () => criarQuadro({ dir: pasta, raiz: pasta, pasta, limiteDe: () => null, emitir: () => {}, elenco: undefined });
const q1 = abrir();
const { descarregar: gravarTudo } = await import('../lib/store.mjs');
for (const t of ['Primeiro', 'Segundo', 'Terceiro']) { assert(q1.criar({ titulo: t, descricao: 'x', coluna: 'backlog' }, 'po').ok); await gravarTudo(); }   // over time, each write leaves the previous one as a copy
const antes = q1.listar().length;
await (await import('../lib/store.mjs')).descarregar();   // the board writes in the background; here we want the file on disk
zerar(path.join(pasta, 'board.json'));
const q2 = abrir();
assert(q2.listar().length >= antes - 1 && q2.listar().length > 0, `the reopened board has the cards (${q2.listar().length} of ${antes})`);
assert(q2.listar().some((c) => c.titulo === 'Primeiro'), 'the old cards came back');

// 6b) deferred write: many changes become one write, nothing is lost on close, and a newer synchronous write wins
const { gravarDepois, adiar, descarregar, descarregarSync, escreverSeMudou } = await import('../lib/store.mjs');
const fa = path.join(d, 'adiada.json');
const estadoA = { n: 0 };
for (let i = 1; i <= 200; i++) { estadoA.n = i; gravarDepois(fa, () => estadoA); }
assert(!fs.existsSync(fa), 'nothing is written on each change: they coalesce');
await descarregar();
assert.equal(JSON.parse(fs.readFileSync(fa, 'utf8')).n, 200, 'the coalesced write carries the latest state');
estadoA.n = 201; gravarDepois(fa, () => estadoA);
descarregarSync();   // this is what happens when the app closes
assert.equal(JSON.parse(fs.readFileSync(fa, 'utf8')).n, 201, 'what was pending is written on close');
estadoA.n = 300; gravarDepois(fa, () => estadoA); await descarregar();
gravarDepois(fa, () => ({ n: 'velho' }));
gravar(fa, { n: 'novo-sincrono' });
await new Promise((r) => setTimeout(r, 700));
assert.equal(JSON.parse(fs.readFileSync(fa, 'utf8')).n, 'novo-sincrono', 'a newer synchronous write is not undone by an older deferred one');
let rodou = 0; for (let i = 0; i < 50; i++) adiar('derivado', () => { rodou++; });
await descarregar(); assert.equal(rodou, 1, 'deferred work also coalesces into one run');
const md = path.join(d, 'derivado.md'); assert(escreverSeMudou(md, 'a')); assert(!escreverSeMudou(md, 'a'), 'an identical derived file is not rewritten'); assert(escreverSeMudou(md, 'b'));


// 7) chat quota: past 500 messages, the oldest go to the on-disk archive and are not lost
process.env.STUDIO_FAKE = '1';
const projetos = await import('../lib/projetos.mjs');
fs.mkdirSync(path.join(tmp, 'alvo'), { recursive: true });
const pr = projetos.criar({ nome: 'Cota', caminho: path.join(tmp, 'alvo'), template: 'software' }); assert(pr.ok);
const cx = projetos.ctx(pr.projeto.id); const eqc = cx.equipe;
for (let i = 1; i <= 520; i++) eqc.teste.postar('equipe', { de: 'sistema', texto: `mensagem ${i}` });
const na_tela = eqc.historico('equipe');
assert(na_tela.length <= 500 && na_tela.at(-1).texto === 'mensagem 520', 'the visible chat keeps the most recent ones');
const arq = path.join(cx.pasta, 'chats-arquivo', 'equipe.jsonl');
const arquivadas = fs.readFileSync(arq, 'utf8').trim().split(String.fromCharCode(10)).map((l) => JSON.parse(l));
assert(arquivadas.length >= 100 && arquivadas[0].texto.startsWith('mensagem'), 'the oldest are kept on disk, not deleted');
assert.equal(new Set([...arquivadas.map((m) => m.id), ...na_tela.map((m) => m.id)]).size, arquivadas.length + na_tela.length, 'no message is repeated or lost');
eqc.cancelar();

console.log('PASS: durability (zeroed or truncated file restored from the copy, unreadable file quarantined, hourly snapshot, sharp shrink kept and board reopened with its cards).');
try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* Windows still holds the folder */ }
process.exit(0);
