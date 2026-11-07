// Pontos de salvamento: manual, automático só quando algo mudou, poda, restauração (marca + aplicação) e proteção contra arquivo zerado.
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

// 1) projeto sem quadro não gera ponto vazio
assert.equal((await criarPontos({ pasta: fs.mkdtempSync(path.join(tmp, 'vazio-')) }).salvar()).ok, false);

// 2) ponto manual: copia o que importa, ignora .bak, conta cards e mensagens
const m = await pt.salvar({ tipo: 'manual', rotulo: 'antes do planning' });
assert(m.ok, m.erro);
assert.equal(m.ponto.cards, 3); assert.equal(m.ponto.mensagens, 2); assert.equal(m.ponto.completo, true);
const dir = path.join(pasta, 'pontos', m.ponto.id);
assert(fs.existsSync(path.join(dir, 'board.json')) && fs.existsSync(path.join(dir, 'memoria', 'projeto.md')));
assert(!fs.existsSync(path.join(dir, 'board.json.bak')), 'não copia .bak');
assert(Buffer.compare(fs.readFileSync(path.join(dir, 'fotos', 'a.png')), foto) === 0, 'foto copiada byte a byte');
assert.equal(pt.listar()[0].rotulo, 'antes do planning');

// 3) arquivo zerado (reinício do Windows) nunca vira ponto
const bom = fs.readFileSync(path.join(pasta, 'board.json'));
fs.writeFileSync(path.join(pasta, 'board.json'), Buffer.alloc(bom.length));
const ruim = await pt.salvar({ tipo: 'manual' });
assert.equal(ruim.ok, false, 'não salva por cima de um ponto bom com quadro ilegível');
fs.writeFileSync(path.join(pasta, 'board.json'), bom);

// 4) automático: só quando algo mudou
assert(await pt.tick({ forcar: true }), 'primeiro automático sai');
assert(await pt.tick({ forcar: true }), 'forçado cria de novo, com outro id, sem sobrescrever o anterior');
const antes = pt.listar().length;
const pt2 = criarPontos({ pasta });
const r1 = await pt2.tick(); assert.equal(r1, null, 'sem mudança desde o último ponto, não cria');
assert.equal(pt.listar().length, antes);
fs.writeFileSync(path.join(pasta, 'memoria', 'projeto.md'), 'memória viva, mais um aprendizado');
const pt3 = criarPontos({ pasta });
assert(await pt3.tick(), 'com mudança, cria');

// 5) poda: automáticos ficam limitados, manuais nunca saem
for (let i = 0; i < 20; i++) {
  const id = `20260101-0000${String(i).padStart(2, '0')}-auto`; const d = path.join(pasta, 'pontos', id); fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, 'meta.json'), JSON.stringify({ id, em: `2026-01-01T00:00:${String(i).padStart(2, '0')}.000Z`, tipo: 'auto', cards: 0, mensagens: 0, tamanho: '1 KB', sig: 'x' }));
}
await pt.salvar({ tipo: 'auto', completo: false });
const autos = pt.listar().filter((p) => p.tipo === 'auto');
assert(autos.length <= 14, `poda os automáticos antigos (sobraram ${autos.length})`);
assert(pt.listar().some((p) => p.id === m.ponto.id), 'ponto manual permanece');

// 6) restaurar: marca, guarda o estado de agora, e só aplica na abertura
J('board.json', quadro(1)); fs.writeFileSync(path.join(pasta, 'fotos', 'a.png'), Buffer.from([9, 9, 9]));
const rs = await pt.restaurar(m.ponto.id);
assert(rs.ok && rs.reiniciar);
assert.equal(L('board.json').cartoes.length, 1, 'com o app aberto, nada é sobrescrito');
assert(pt.listar().some((p) => p.tipo === 'antes-de-restaurar'), 'o estado de agora virou ponto');
const ap = aplicarRestauracaoPendente(pasta);
assert.equal(ap.id, m.ponto.id);
assert.equal(L('board.json').cartoes.length, 3, 'quadro voltou ao ponto');
assert(Buffer.compare(fs.readFileSync(path.join(pasta, 'fotos', 'a.png')), foto) === 0, 'foto binária volta intacta');
assert(!fs.existsSync(path.join(pasta, 'pontos', '_restaurar.json')), 'marca consumida');
assert.equal(aplicarRestauracaoPendente(pasta), null, 'não aplica duas vezes');

// 7) excluir: manual sai, "antes de restaurar" fica; id inválido é recusado
const protegido = pt.listar().find((p) => p.tipo === 'antes-de-restaurar');
assert.equal(pt.excluir(protegido.id).ok, false);
assert.equal(pt.excluir(m.ponto.id).ok, true);
assert.equal((await pt.restaurar('../fora')).ok, false);

// 8) restauração marcada para um ponto que sumiu falha sem destruir nada
fs.writeFileSync(path.join(pasta, 'pontos', '_restaurar.json'), JSON.stringify({ id: 'nao-existe' }));
assert.equal(aplicarRestauracaoPendente(pasta), null);
assert.equal(L('board.json').cartoes.length, 3, 'dados intactos');
console.log('pontos: ok');
