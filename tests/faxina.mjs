// Team folder cleanup: temp files go away, a finished card report goes after 30 days (only the 3 newest revisions stay),
// a delivery stays 30 days for download with a warning 3 days before, an attachment no message points to goes, and no state is touched.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'work-ia-faxina-'));
process.env.STUDIO_DATA = path.join(tmp, 'data'); process.env.STUDIO_PROJETOS = path.join(tmp, 'projetos');
const { criarFaxina, POLITICA } = await import('../lib/faxina.mjs');
const pasta = path.join(tmp, 'equipe'); fs.mkdirSync(pasta, { recursive: true });
const DIA = 86_400_000; const agora = Date.now();
const grava = (rel, txt = 'x', idadeDias = 0) => { const p = path.join(pasta, ...rel.split('/')); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, txt); const t = new Date(agora - idadeDias * DIA); fs.utimesSync(p, t, t); return p; };
const iso = (dias) => new Date(agora - dias * DIA).toISOString();
// state (never removed)
grava('board.json', JSON.stringify({ x: 1 }), 100); grava('memoria/projeto.md', '# p', 100); grava('fotos/po.png', 'png', 100);
// reports: open card with 5 revisions + final + extensionless copy; card finished 40 days ago; card that no longer exists
for (let i = 1; i <= 5; i++) grava(`relatorios/T-1/T-1-r${i}.md`, `r${i}`, 10 - i);
grava('relatorios/T-1/T-1-final-r5.md', 'final'); grava('relatorios/T-1/T-1-final-r5', 'final');
grava('relatorios/T-2/T-2-final-r1.md', 'f', 40); grava('relatorios/T-9/T-9-r1.md', 'f', 40);
// deliveries: old (removed), almost (warning), new (kept)
grava('entregas/2020-01-01-review/MANIFEST.md', 'm'); grava(`entregas/${iso(28).slice(0, 10)}-quase/MANIFEST.md`, 'm'); grava(`entregas/${iso(1).slice(0, 10)}-nova/MANIFEST.md`, 'm');
// attachments: one cited in chat, an old orphan, an orphan from today
grava('anexos/print-1.png', 'p', 5); grava('anexos/orfao.png', 'p', 5); grava('anexos/recente.png', 'p', 0);
grava('chats.json', JSON.stringify({ canais: { equipe: [{ texto: 'veja anexos/print-1.png' }] } }), 1);
// temp files and worktree
grava('board.json.antes-de-encolher-1', 'x', 10); grava('chats.json.tmp', 'x', 10); grava('perfis.json.ilegivel-3', 'x', 1); grava('revisoes/T-1-r1-qa/a.txt', 'x', 9);
const quadro = { listar: () => [{ id: 'T-1', coluna: 'andamento', atualizado: iso(0) }, { id: 'T-2', coluna: 'concluido', atualizado: iso(40) }] };
const avisos = [];
const fx = criarFaxina({ pasta, quadro, avisar: (t) => avisos.push(t) });
const inv = fx.inventario();
assert(inv.itens.some((i) => i.id === 'relatorios' && i.bytes > 0) && inv.total > 0, 'inventory measures the categories');
const r = fx.executar();
const saiu = (rel) => r.removidos.some((x) => x.rel === rel);
const existe = (rel) => fs.existsSync(path.join(pasta, ...rel.split('/')));
assert(saiu('relatorios/T-1/T-1-final-r5') && existe('relatorios/T-1/T-1-final-r5.md'), 'the extensionless copy goes, the .md stays');
assert(existe('relatorios/T-1/T-1-r5.md') && existe('relatorios/T-1/T-1-r3.md') && !existe('relatorios/T-1/T-1-r2.md') && !existe('relatorios/T-1/T-1-r1.md'), `only the ${POLITICA.relatorios.revisoes} newest revisions stay`);
assert(!existe('relatorios/T-2') && !existe('relatorios/T-9'), 'a card finished 40 days ago and a nonexistent card are removed entirely');
assert(!existe('entregas/2020-01-01-review') && existe(`entregas/${iso(1).slice(0, 10)}-nova`), 'old delivery goes, new one stays');
assert.equal(avisos.length, 1, 'a delivery near its deadline triggers one warning'); assert.match(avisos[0], /quase/);
assert(existe('anexos/print-1.png') && !existe('anexos/orfao.png') && existe('anexos/recente.png'), 'cited attachment stays, old orphan goes, today orphan waits');
assert(!existe('board.json.antes-de-encolher-1') && !existe('chats.json.tmp') && existe('perfis.json.ilegivel-3') && !existe('revisoes/T-1-r1-qa'), 'temp files older than 7 days go; yesterday one waits');
assert(existe('board.json') && existe('memoria/projeto.md') && existe('fotos/po.png') && existe('chats.json'), 'state, memory and photos are never removed');
assert(r.liberado > 0 && /KB|B/.test(r.liberadoTexto));
assert.equal(fx.executar().avisos.length, 0, 'the delivery warning does not repeat');
assert.equal(fx.tick(), null, 'automatic cleanup waits 12 h after the last one');
console.log('PASS: folder cleanup (temp files go, reports pruned by revision and completion, deliveries kept 30 days with warning, orphan attachment goes, state intact).');
