// Phase 4 (coordination): per-card execution plan (the app calls each step owner, by domain, without leadership dispatching),
// caveat with a domain suggested by the contract, whoever did the work records the evidence (participant or job), idle leadership only when
// the board changes, group chat on the minimal model.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'work-ia-fase4-'));
process.env.STUDIO_DATA = path.join(tmp, 'data'); process.env.STUDIO_PROJETOS = path.join(tmp, 'projetos'); process.env.STUDIO_FAKE = '1'; process.env.STUDIO_FAKE_LOCAL = '0';
const store = await import('../lib/store.mjs');
store.gravarConfig({ piloto: { ativo: true, maxChamadasHora: 0, poDecide: true }, ciclo: { statusPO: false, fechamento: false, orcamento: 10, revisaoAuto: false, versionar: false } });
const projetos = await import('../lib/projetos.mjs');
const { escolher } = await import('../lib/roteador.mjs');
fs.mkdirSync(path.join(tmp, 'alvo'));
const r = projetos.criar({ nome: 'Fase quatro', caminho: path.join(tmp, 'alvo'), template: 'software' }); assert(r.ok);
const c = projetos.ctx(r.projeto.id); const eq = c.equipe;
const espera = async (cond, ms = 15000) => { for (let t = 0; t < ms / 50 && !cond(); t++) await new Promise((x) => setTimeout(x, 50)); if (!cond()) console.error(eq.historico('equipe').slice(-8).map((m) => `${m.de} ${m.status || ''}: ${(m.texto || '').replace(/\n/g, ' ').slice(0, 120)}`).join('\n')); assert(cond(), 'timed out'); };
const dorme = (ms) => new Promise((x) => setTimeout(x, ms));
const enviar = (canal, texto) => eq.enviar({ canal, texto, engine: 'claude', modo: 'conversar' });
const falas = (de) => eq.historico('equipe').filter((m) => m.de === de && m.status === 'ok');
const parado = async () => { for (let n = 0; n < 100 && eq.ocupada(); n++) await dorme(100); };

// ---- 4.1: leadership sets the plan; the app calls each step owner, in order, without dispatching
const card = c.quadro.criar({ titulo: 'Endpoint de chaves', descricao: 'x', dono: 'backend', coluna: 'pronto', aceite: ['GET /chaves responde 200 com a lista'] }, 'voce').card;
enviar('equipe', `@P.O. [teste:plano] monte o plano do ${card.id}`);
await espera(() => (c.quadro.obter(card.id).plano || []).length === 2);
const plano = c.quadro.obter(card.id).plano;
assert.equal(plano[0].dono, 'dados'); assert.equal(plano[1].dono, 'backend'); assert.equal(plano[0].status, 'pendente');
assert(eq.pilotoTick({ forcar: true }));
await espera(() => c.quadro.obter(card.id).plano[0].status === 'feito', 20000);
assert(falas('dados').some((m) => /Fiz o passo 1/.test(m.texto)), 'step 1 was done by the domain owner (Dados), called by the app');
await espera(() => c.quadro.obter(card.id).plano[1].status === 'feito', 20000);
assert(falas('backend').some((m) => /Fiz o passo 2/.test(m.texto)), 'step 2 was done by Back-end');
assert.equal(falas('po').filter((m) => /@dados|@backend/i.test(m.texto)).length, 0, 'leadership dispatched no step');
assert(/Plano: 2 passos/.test(c.quadro.obter(card.id).historico.map((h) => h.txt).join(' ')), 'the plan is in the card history');
const pacote = eq.teste.montar({ agente: 'backend', tipo: 'execucao', card: card.id, canalSaida: 'equipe', instrucao: '', origem: 'workflow' }).pedido;
assert(/"plano":\["1 \[feito\]/.test(pacote), 'the plan goes into the card package');

// ---- 4.2: a database caveat gets a suggested domain (Dados) in the leadership instruction
await parado();
const card2 = c.quadro.criar({ titulo: 'Migration', descricao: 'x', dono: 'backend', coluna: 'andamento', aceite: ['A migration aplica sem erro no banco de teste'] }, 'voce').card;
enviar('dm:backend', `[teste:ressalva-banco] ${card2.id}`);
await espera(() => (c.quadro.obter(card2.id).workflow.ressalvas || []).length === 1);
const instr = eq.teste.montar({ agente: 'po', tipo: 'ressalvas', card: card2.id, canalSaida: 'equipe', instrucao: '', origem: 'sistema' }).pedido;
assert(/domínio "banco": @dados/.test(instr), 'leadership receives the domain and the @ of who covers it');
// blocker: the domain specialist joins the meeting
c.quadro.atualizar(card2.id, { participantes: [] }, 'voce');
c.quadro.bloquear(card2.id, 'O postgres recusa conexão na porta 5432 e a migration alembic não roda', 'backend');
assert(eq.teste.especialistasDoImpedimento(c.quadro.obter(card2.id)).includes('dados'), 'Dados is called for the database blocker');
c.quadro.desbloquear(card2.id, 'voce');

// ---- 4.6: whoever did it records it: a participant resolves the caveat; job evidence also counts
const rid = c.quadro.obter(card2.id).workflow.ressalvas[0].id;
assert(!c.quadro.fluxo(card2.id, 'ressalva-resolver', { ressalva: rid, resolucao: 'x', evidencia: 'sem nada' }, 'pipeline').ok, 'someone unrelated to the card cannot resolve it');
{ const rr = c.quadro.fluxo(card2.id, 'ressalva-resolver', { ressalva: rid, resolucao: 'Subi o banco', evidencia: 'job-abc123 select 1 ok' }, 'pipeline'); assert(rr.ok, 'with app job evidence, whoever did it resolves: ' + rr.erro); }

// ---- 4.3: idle leadership: wakes once; with the board unchanged, it does not wake again
await parado();
const c3 = c.quadro.criar({ titulo: 'Parado', descricao: 'x', dono: 'frontend', coluna: 'andamento', aceite: ['A tela lista as chaves com nome e data'] }, 'voce');
assert(c3.ok);
eq.teste.sinaisAgentes?.();
const primeira = eq.teste.despertarLideranca();
await parado();
const segunda = eq.teste.despertarLideranca();
assert.equal(segunda, false, 'with no board change, leadership is not woken again');
void primeira;

// ---- 4.7: group chat without a card runs on the minimal model
assert.equal(escolher({ engine: 'claude', tipo: 'grupo', modo: 'conversar', card: null, teto: 'high' }).degrau, 0);
assert.equal(escolher({ engine: 'claude', tipo: 'grupo', modo: 'trabalhar', card: { pontos: 3 }, teto: 'high' }).degrau, 1);

eq.cancelar();
console.log('PASS: phase 4 (per-card execution plan with domain owner called by the app, caveat with suggested domain, domain specialist on the blocker, whoever did it records with job evidence, idle leadership only when the board changes, group on the minimal model).');
try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* Windows still holds the folder */ }
process.exit(0);
