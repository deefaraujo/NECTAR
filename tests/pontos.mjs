// Save points: manual, automatic only when something changed, pruning, restore (mark + apply) and protection against zeroed files.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'work-ia-pontos-'));
process.env.STUDIO_DATA = path.join(tmp, 'data');
const { criarPontos, aplicarRestauracaoPendente } = await import('../lib/pontos.mjs');
const pasta = path.join(tmp, 'proj'); fs.mkdirSync(path.join(pasta, 'memoria'), { recursive: true }); fs.mkdirSync(path.join(pasta, 'fotos'), { recursive: true });
const J = (n, o) => fs.writeFileSync(path.join(pasta, n), JSON.stringify(o));
const L = (n) => JSON.parse(fs.readFileSync(path.join(pasta, n), 'utf8'));
const foto = Buffer.from([0, 255, 1, 254, 2, 253, 137, 80, 78, 71]);
const quadro = (n) => ({ seq: n, cartoes: Array.from({ length: n }, (_, i) => ({ id: `T-${i + 1}` })), cancelados: [] });
J('board.json', quadro(3)); J('chats.json', { seq: 2, canais: { equipe: [{ id: 'm1' }, { id: 'm2' }] } });
fs.writeFileSync(path.join(pasta, 'memoria', 'projeto.md'), 'memória viva');
fs.writeFileSync(path.join(pasta, 'fotos', 'a.png'), foto);
fs.writeFileSync(path.join(pasta, 'board.json.bak'), 'lixo');

const pt = criarPontos({ pasta });

// 1) a project without a board does not produce an empty save point
assert.equal((await criarPontos({ pasta: fs.mkdtempSync(path.join(tmp, 'vazio-')) }).salvar()).ok, false);

// 2) manual save point: copies what matters, ignores .bak, counts cards and messages
const m = await pt.salvar({ tipo: 'manual', rotulo: 'antes do planning' });
assert(m.ok, m.erro);
assert.equal(m.ponto.cards, 3); assert.equal(m.ponto.mensagens, 2); assert.equal(m.ponto.completo, true);
const dir = path.join(pasta, 'pontos', m.ponto.id);
assert(fs.existsSync(path.join(dir, 'board.json')) && fs.existsSync(path.join(dir, 'memoria', 'projeto.md')));
assert(!fs.existsSync(path.join(dir, 'board.json.bak')), 'does not copy .bak');
assert(Buffer.compare(fs.readFileSync(path.join(dir, 'fotos', 'a.png')), foto) === 0, 'photo copied byte for byte');
assert.equal(pt.listar()[0].rotulo, 'antes do planning');

// 3) a zeroed file (Windows restart) never becomes a save point
const bom = fs.readFileSync(path.join(pasta, 'board.json'));
fs.writeFileSync(path.join(pasta, 'board.json'), Buffer.alloc(bom.length));
const ruim = await pt.salvar({ tipo: 'manual' });
assert.equal(ruim.ok, false, 'does not save over a good point with an unreadable board');
fs.writeFileSync(path.join(pasta, 'board.json'), bom);

// 4) automatic: only when something changed
assert(await pt.tick({ forcar: true }), 'first automatic point is created');
assert(await pt.tick({ forcar: true }), 'forced creates again, with a new id, without overwriting the previous one');
const antes = pt.listar().length;
const pt2 = criarPontos({ pasta });
const r1 = await pt2.tick(); assert.equal(r1, null, 'no change since the last point, nothing is created');
assert.equal(pt.listar().length, antes);
fs.writeFileSync(path.join(pasta, 'memoria', 'projeto.md'), 'memória viva, mais um aprendizado');
const pt3 = criarPontos({ pasta });
assert(await pt3.tick(), 'with a change, it is created');

// 5) pruning: automatic points are capped, manual ones are never removed
for (let i = 0; i < 20; i++) {
  const id = `20260101-0000${String(i).padStart(2, '0')}-auto`; const d = path.join(pasta, 'pontos', id); fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, 'meta.json'), JSON.stringify({ id, em: `2026-01-01T00:00:${String(i).padStart(2, '0')}.000Z`, tipo: 'auto', cards: 0, mensagens: 0, tamanho: '1 KB', sig: 'x' }));
}
await pt.salvar({ tipo: 'auto', completo: false });
const autos = pt.listar().filter((p) => p.tipo === 'auto');
assert(autos.length <= 14, `prunes old automatic points (${autos.length} left)`);
assert(pt.listar().some((p) => p.id === m.ponto.id), 'manual point remains');

// 6) restore: marks it, saves the current state, and only applies on open
J('board.json', quadro(1)); fs.writeFileSync(path.join(pasta, 'fotos', 'a.png'), Buffer.from([9, 9, 9]));
const rs = await pt.restaurar(m.ponto.id);
assert(rs.ok && rs.reiniciar);
assert.equal(L('board.json').cartoes.length, 1, 'with the app open, nothing is overwritten');
assert(pt.listar().some((p) => p.tipo === 'antes-de-restaurar'), 'the current state became a save point');
const ap = aplicarRestauracaoPendente(pasta);
assert.equal(ap.id, m.ponto.id);
assert.equal(L('board.json').cartoes.length, 3, 'board went back to the save point');
assert(Buffer.compare(fs.readFileSync(path.join(pasta, 'fotos', 'a.png')), foto) === 0, 'binary photo comes back intact');
assert(!fs.existsSync(path.join(pasta, 'pontos', '_restaurar.json')), 'mark consumed');
assert.equal(aplicarRestauracaoPendente(pasta), null, 'does not apply twice');

// 7) delete: manual goes, "before restore" stays; an invalid id is rejected
const protegido = pt.listar().find((p) => p.tipo === 'antes-de-restaurar');
assert.equal(pt.excluir(protegido.id).ok, false);
assert.equal(pt.excluir(m.ponto.id).ok, true);
assert.equal((await pt.restaurar('../fora')).ok, false);

// 8) a restore marked for a missing point fails without destroying anything
fs.writeFileSync(path.join(pasta, 'pontos', '_restaurar.json'), JSON.stringify({ id: 'nao-existe' }));
assert.equal(aplicarRestauracaoPendente(pasta), null);
assert.equal(L('board.json').cartoes.length, 3, 'data intact');
console.log('pontos: ok');
