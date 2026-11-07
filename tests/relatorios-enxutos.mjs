// Cards objetivos: nenhuma fala ou entrega vira relatório anexado; só a conclusão gera um relatório curto, enviado por DM.
// Cards antigos, que acumularam dezenas de relatórios, são enxugados sem perder texto.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'work-ia-rel-'));
process.env.STUDIO_DATA = path.join(tmp, 'data'); process.env.STUDIO_PROJETOS = path.join(tmp, 'projetos'); process.env.STUDIO_FAKE = '1';
const store = await import('../lib/store.mjs');
store.gravarConfig({ piloto: { ativo: false, maxChamadasHora: 0 }, ciclo: { statusPO: false, fechamento: false, orcamento: 6, revisaoAuto: true, versionar: false, posts: false } });
const projetos = await import('../lib/projetos.mjs');
fs.mkdirSync(path.join(tmp, 'alvo'));
const projeto = projetos.criar({ nome: 'Relatorios', caminho: path.join(tmp, 'alvo'), template: 'software' }).projeto;
const c0 = projetos.ctx(projeto.id);
const { quadro: q, equipe: eq } = c0;
const ok = (r) => { assert(r.ok, r.erro); return r; };
const fluxo = (c, acao, dados, autor) => q.fluxo(c.id, acao, { revisao: c.workflow.revisao, ...dados }, autor);
const OK = [{ comando: 'node teste.mjs', status: 'aprovado', evidencia: 'Cenário principal e falha passaram.' }];

// ---- ciclo completo: várias entregas e relatos, nenhum anexo no card até a conclusão
const card = ok(q.criar({ titulo: 'Tela de perfil', descricao: 'Mostrar o perfil.', dono: 'backend', coluna: 'pronto', aceite: ['Mostra o nome'] }, 'po')).card;
for (const n of [1, 2, 3]) {
  ok(fluxo(card, 'entrega', { chave: `e${n}`, resumo: `Entrega ${n}: ${'detalhe '.repeat(200)}`, arquivos: ['src/perfil.mjs'], verificacoes: OK }, 'backend'));
  ok(q.relatar(card.id, { chave: `r${n}`, resumo: `Relato ${n} do que foi feito.` }, 'backend'));
  q.relatar(card.id, { chave: `auto${n}`, resumo: 'fala longa '.repeat(500), automatico: true }, 'backend');
  assert.equal((q.obter(card.id).relatorios || []).length, 0, `depois da entrega ${n} o card continua sem relatório anexado`);
}
assert(q.obter(card.id).historico.some((h) => /^Relato: Relato 1/.test(h.txt)), 'o relato vira uma linha curta no histórico');
assert.equal(ok(q.relatar(card.id, { chave: 'r1', resumo: 'Relato 1 do que foi feito.' }, 'backend')).repetido, true, 'o mesmo relato não se repete');
assert(!eq.historico('equipe').some((m) => m.tipo === 'relatorio_tarefa'), 'nada de aviso de relatório no #equipe');

ok(q.mover(card.id, 'revisao', 'backend'));
ok(fluxo(card, 'revisao', { status: 'aprovado', evidencia: 'Diff pontual, sem achados.' }, 'revisor'));
ok(fluxo(card, 'documentacao', { status: 'sem_alteracao', evidencia: 'Contrato e README seguem corretos.' }, 'curador'));
ok(q.mover(card.id, 'qa', 'curador'));
ok(fluxo(card, 'qa', { status: 'aprovado', evidencia: 'Caminho principal e falhas validados.' }, 'qa'));
q.atualizar(card.id, { aceiteOk: [0] }, 'qa');
ok(q.mover(card.id, 'concluido', 'qa'));
const rels = q.obter(card.id).relatorios;
assert.equal(rels.length, 1, 'um relatório só, o de conclusão'); assert.equal(rels[0].tipo, 'final');
assert(rels[0].texto.length < 4500, `relatório curto (${rels[0].texto.length} caracteres)`);
const dm = eq.historico('dm:backend').filter((m) => m.tipo === 'relatorio_tarefa');
assert.equal(dm.length, 1, 'a conclusão chega por DM do responsável');
assert.match(dm[0].texto, /^Concluí T-\d+: Tela de perfil/); assert(dm[0].texto.length < 700, 'a DM é um resumo, não o relatório inteiro');
assert.equal(dm[0].relatorioTarefa.tipo, 'final', 'e leva o link do relatório curto');
assert(!eq.historico('equipe').some((m) => m.tipo === 'relatorio_tarefa'), 'e continua sem aviso no #equipe');

// ---- cards antigos inchados: enxuga, guarda tudo em arquivo e mantém só a conclusão
await store.descarregar();
const pasta = c0.pasta; const arqBoard = path.join(pasta, 'board.json');
const b = JSON.parse(fs.readFileSync(arqBoard, 'utf8'));
const velho = b.cartoes.find((c) => c.id === card.id);
const longo = (n) => `# Relatório ${n}\n${'linha de relatório antigo com bastante texto\n'.repeat(400)}`;
velho.relatorios = [
  ...[1, 2, 3, 4, 5].map((n) => ({ tipo: 'atividade', revisao: n, nome: `${card.id}-atividade-backend-auto-r${n}.md`, autor: 'backend', texto: longo(`atividade ${n}`), em: '2026-10-30T10:00:00.000Z', automatico: true })),
  { tipo: 'entrega', revisao: 3, nome: `${card.id}-entrega-r3.md`, autor: 'backend', texto: longo('entrega 3'), em: '2026-10-30T11:00:00.000Z' },
  { ...rels[0], revisao: 1, texto: longo('final antigo') },
  { ...rels[0], revisao: 3, texto: longo('final novo') },
];
const pesoAntes = JSON.stringify(velho).length;
fs.writeFileSync(arqBoard, JSON.stringify(b, null, 2));
// outro projeto com o mesmo arquivo: reabre o quadro como o app faz ao iniciar
const { criarQuadro } = await import('../lib/quadro.mjs');
const q2 = criarQuadro({ dir: pasta, raiz: pasta, pasta, limiteDe: () => null, emitir: () => {}, elenco: c0.elenco });
const novo = q2.obter(card.id);
assert.equal(novo.relatorios.length, 1, 'ficou só o relatório de conclusão'); assert.equal(novo.relatorios[0].tipo, 'final'); assert.equal(novo.relatorios[0].revisao, 3, 'o mais novo');
assert(novo.relatorios[0].texto.length < 4200, 'e curto no card');
assert.equal(novo.relatoriosArquivados, 7, 'o card diz quantos relatórios foram para a pasta');
assert(JSON.stringify(novo).length < pesoAntes / 3, 'o card ficou bem menor');
assert(fs.existsSync(`${arqBoard}.antes-de-enxugar`), 'uma cópia do quadro antigo foi guardada');
const dirRel = path.join(pasta, 'relatorios', card.id);
for (let n = 1; n <= 5; n++) assert.equal(fs.readFileSync(path.join(dirRel, `${card.id}-atividade-backend-auto-r${n}.md`), 'utf8'), longo(`atividade ${n}`), `relatório ${n} guardado inteiro em arquivo`);
assert.equal(fs.readFileSync(path.join(dirRel, `${card.id}-entrega-r3.md`), 'utf8'), longo('entrega 3'));
assert(fs.readdirSync(dirRel).some((n) => fs.readFileSync(path.join(dirRel, n), 'utf8') === longo('final novo')), 'o texto completo do final mantido também fica em arquivo (sem sobrescrever o que já existia)');
assert(fs.readdirSync(dirRel).some((n) => fs.readFileSync(path.join(dirRel, n), 'utf8') === longo('final antigo')), 'e o final antigo também');
await store.descarregar();
console.log('PASS: relatórios enxutos (fala e entrega não anexam nada, conclusão gera um relatório curto por DM, sem aviso no #equipe, cards antigos enxugados sem perder texto).');
