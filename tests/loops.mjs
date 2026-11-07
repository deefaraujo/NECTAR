// Regression for the two loops that burned credit on Assessoria on 01/11: (1) the light flow called the owner again every few
// seconds for a card whose acceptance was already met (the dispatch key changed with every history note); (2) the autopilot
// leadership round repeated every 30 s with an unchanged board, and the "Nada a fazer agora." reply still showed in #equipe.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'work-ia-loops-'));
process.env.STUDIO_DATA = path.join(tmp, 'data');
process.env.STUDIO_PROJETOS = path.join(tmp, 'projetos');
process.env.STUDIO_FAKE = '1';
process.env.STUDIO_PILOTO_INTERVALO_MS = '1';
const store = await import('../lib/store.mjs');
store.gravarConfig({ piloto: { ativo: true, maxChamadasHora: 0 }, ciclo: { orcamento: 2, fechamento: false, statusPO: false, revisaoAuto: false, curadoriaAuto: false, briefing: false } });
const projetos = await import('../lib/projetos.mjs');
const espera = async (fn, ms = 6000) => { const t0 = Date.now(); while (!fn()) { if (Date.now() - t0 > ms) assert.fail('timed out'); await new Promise((r) => setTimeout(r, 60)); } };
fs.mkdirSync(path.join(tmp, 'alvo'));
const criado = projetos.criar({ nome: 'Escritório', caminho: path.join(tmp, 'alvo'), template: 'software' }); assert(criado.ok, criado.erro);
const pid = criado.projeto.id;
const cid = projetos.adicionarEquipe(pid, { template: 'professional-operations' }).equipe.cid;
const c = projetos.ctx(cid); const eq = c.equipe; const lead = 'chief_of_staff';
const falas = (de, tipo) => eq.historico('equipe').filter((m) => m.de === de && (!tipo || m.tipo === tipo));

// ---- (1) finished production moves to Revisão on its own, without calling the owner again
const k = c.quadro.criar({ titulo: 'Achar datas da sprint', descricao: 'Listar as issues da sprint.', dono: 'coletor', coluna: 'andamento', aceite: ['Tabela com as issues da sprint, com chave e status'] }, lead); assert(k.ok);
for (const a of c.quadro.obter(k.card.id).aceite) a.ok = true;
assert.equal(c.quadro.obter(k.card.id).coluna, 'andamento');
eq.pilotoTick({ forcar: true });
await espera(() => c.quadro.obter(k.card.id).coluna === 'revisao');
await new Promise((r) => setTimeout(r, 1500)); eq.pilotoTick(); await new Promise((r) => setTimeout(r, 800));
assert.equal(falas('coletor', 'produzir').length, 0, 'the owner is not called to produce what already met acceptance');
assert(eq.historico('equipe').some((m) => m.de === 'sistema' && /cumpriu o aceite/.test(m.texto)), 'the app announces the move to Revisão');
eq.cancelar(); await new Promise((r) => setTimeout(r, 300));

// ---- (2) leadership round: once per board change, and "Nada a fazer agora." does not show
c.quadro.mover(k.card.id, 'concluido', 'voce', { forcar: true });
const b = c.quadro.criar({ titulo: 'Mapear páginas do Notion', descricao: 'Mapear as páginas ligadas às issues.', dono: 'conhecimento', coluna: 'backlog', aceite: ['Lista das páginas com link e dona de cada uma'] }, lead); assert(b.ok);
const antes = falas(lead, 'piloto').length;
eq.cancelar(); assert(eq.pilotoTick({ forcar: true }), 'with a changed board, leadership is called once');
await espera(() => eq.historico('equipe').some((m) => m.de === lead && m.tipo === 'piloto' && m.status !== 'trabalhando'));
for (let i = 0; i < 8; i++) { await new Promise((r) => setTimeout(r, 120)); assert.equal(eq.pilotoTick(), false, `with an unchanged board, no new round (attempt ${i + 1})`); }
const depois = falas(lead, 'piloto');
assert.equal(depois.length - antes, 1, 'only one leadership round for the same board');
assert(depois.every((m) => !/^nada a fazer/i.test(m.texto || '') || m.oculta), '"Nada a fazer agora." does not show as a message in #equipe');
void b;
console.log('PASS: no credit loops (met acceptance moves to Revisão without a new call to the owner; leadership round only when the board changes; "nada a fazer" stays silent).');
process.exit(0);
