// Faxina da pasta da equipe: temporário some, relatório de card concluído sai depois de 30 dias (só as 3 revisões mais novas ficam),
// entrega fica 30 dias para baixar com aviso 3 dias antes, anexo sem mensagem apontando sai, e nada do estado é tocado.
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
// estado (nunca sai)
grava('board.json', JSON.stringify({ x: 1 }), 100); grava('memoria/projeto.md', '# p', 100); grava('fotos/po.png', 'png', 100);
// relatórios: card aberto com 5 revisões + final + cópia sem extensão; card concluído há 40 dias; card que não existe mais
for (let i = 1; i <= 5; i++) grava(`relatorios/T-1/T-1-r${i}.md`, `r${i}`, 10 - i);
grava('relatorios/T-1/T-1-final-r5.md', 'final'); grava('relatorios/T-1/T-1-final-r5', 'final');
grava('relatorios/T-2/T-2-final-r1.md', 'f', 40); grava('relatorios/T-9/T-9-r1.md', 'f', 40);
// entregas: velha (sai), quase (aviso), nova (fica)
grava('entregas/2020-01-01-review/MANIFEST.md', 'm'); grava(`entregas/${iso(28).slice(0, 10)}-quase/MANIFEST.md`, 'm'); grava(`entregas/${iso(1).slice(0, 10)}-nova/MANIFEST.md`, 'm');
// anexos: um citado no chat, um órfão velho, um órfão de hoje
grava('anexos/print-1.png', 'p', 5); grava('anexos/orfao.png', 'p', 5); grava('anexos/recente.png', 'p', 0);
grava('chats.json', JSON.stringify({ canais: { equipe: [{ texto: 'veja anexos/print-1.png' }] } }), 1);
// temporários e worktree
grava('board.json.antes-de-encolher-1', 'x', 10); grava('chats.json.tmp', 'x', 10); grava('perfis.json.ilegivel-3', 'x', 1); grava('revisoes/T-1-r1-qa/a.txt', 'x', 9);
const quadro = { listar: () => [{ id: 'T-1', coluna: 'andamento', atualizado: iso(0) }, { id: 'T-2', coluna: 'concluido', atualizado: iso(40) }] };
const avisos = [];
const fx = criarFaxina({ pasta, quadro, avisar: (t) => avisos.push(t) });
const inv = fx.inventario();
assert(inv.itens.some((i) => i.id === 'relatorios' && i.bytes > 0) && inv.total > 0, 'inventário mede as categorias');
const r = fx.executar();
const saiu = (rel) => r.removidos.some((x) => x.rel === rel);
const existe = (rel) => fs.existsSync(path.join(pasta, ...rel.split('/')));
assert(saiu('relatorios/T-1/T-1-final-r5') && existe('relatorios/T-1/T-1-final-r5.md'), 'cópia sem extensão sai, o .md fica');
assert(existe('relatorios/T-1/T-1-r5.md') && existe('relatorios/T-1/T-1-r3.md') && !existe('relatorios/T-1/T-1-r2.md') && !existe('relatorios/T-1/T-1-r1.md'), `só as ${POLITICA.relatorios.revisoes} revisões mais novas ficam`);
assert(!existe('relatorios/T-2') && !existe('relatorios/T-9'), 'card concluído há 40 dias e card inexistente saem inteiros');
assert(!existe('entregas/2020-01-01-review') && existe(`entregas/${iso(1).slice(0, 10)}-nova`), 'entrega velha sai, nova fica');
assert.equal(avisos.length, 1, 'uma entrega perto do prazo gera um aviso'); assert.match(avisos[0], /quase/);
assert(existe('anexos/print-1.png') && !existe('anexos/orfao.png') && existe('anexos/recente.png'), 'anexo citado fica, órfão velho sai, órfão de hoje espera');
assert(!existe('board.json.antes-de-encolher-1') && !existe('chats.json.tmp') && existe('perfis.json.ilegivel-3') && !existe('revisoes/T-1-r1-qa'), 'temporários com mais de 7 dias saem; o de ontem espera');
assert(existe('board.json') && existe('memoria/projeto.md') && existe('fotos/po.png') && existe('chats.json'), 'estado, memória e fotos nunca saem');
assert(r.liberado > 0 && /KB|B/.test(r.liberadoTexto));
assert.equal(fx.executar().avisos.length, 0, 'o aviso da entrega não repete');
assert.equal(fx.tick(), null, 'a faxina automática espera 12 h depois da última');
console.log('PASS: faxina da pasta (temporário some, relatórios podados por revisão e por conclusão, entregas ficam 30 dias com aviso, anexo órfão sai, estado intacto).');
