// Phase 6 (excellence): metrics computed by the app (lead time, cost and calls per point, rework, false evidence, reverted
// decisions), card closing with real vs. estimated cost, per-role playbooks, and the replay of the "merge night":
// a card with a three-step plan across three domains finishes with few calls, no leadership dispatching, no empty messages.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'work-ia-fase6-'));
process.env.STUDIO_DATA = path.join(tmp, 'data'); process.env.STUDIO_PROJETOS = path.join(tmp, 'projetos'); process.env.STUDIO_FAKE = '1'; process.env.STUDIO_FAKE_LOCAL = '0';
const store = await import('../lib/store.mjs');
store.gravarConfig({ piloto: { ativo: true, maxChamadasHora: 0, poDecide: true }, ciclo: { statusPO: false, fechamento: false, orcamento: 10, revisaoAuto: false, versionar: false, curadoriaAuto: false } });
const creditos = await import('../lib/creditos.mjs');
const projetos = await import('../lib/projetos.mjs');
const dorme = (ms) => new Promise((x) => setTimeout(x, ms));
const RAIZ = path.resolve(import.meta.dirname, '..');

// ---- per-role playbooks in the templates
for (const [t, ag] of [['software', 'po'], ['software', 'backend'], ['software', 'versionamento'], ['software', 'pipeline'], ['software', 'dados'], ['software', 'qa'], ['software', 'revisor'], ['software', 'frontend'], ['visual-graphic-design', 'lider_criativo'], ['visual-graphic-design', 'designer_grafico'], ['jogos', 'developer'], ['product-design', 'orquestrador'], ['professional-operations', 'chief_of_staff']]) {
  const p = path.join(RAIZ, 'templates', t, 'playbooks', `${ag}.md`);
  assert(fs.existsSync(p) && /pronto/i.test(fs.readFileSync(p, 'utf8')), `playbook ${t}/${ag} exists and says what "done" means`);
}

// ---- merge night replay: card with a plan across three domains, autopilot on, nobody dispatches
fs.mkdirSync(path.join(tmp, 'alvo'));
const r = projetos.criar({ nome: 'Replay', caminho: path.join(tmp, 'alvo'), template: 'software' }); assert(r.ok);
const c = projetos.ctx(r.projeto.id); const eq = c.equipe;
const pid = r.projeto.id;
const card = c.quadro.criar({ titulo: 'Mergear branches T-* na branch do ticket', descricao: 'Merge das branches do ticket numa só, sem tocar na develop.', dono: 'backend', coluna: 'pronto', aceite: ['A branch do ticket contém os commits das T-* e git grep de marcadores de conflito volta vazio'] }, 'voce').card;
assert(c.quadro.atualizar(card.id, { plano: [
  { titulo: 'Merge de teste e merge real das T-* na branch do ticket', dono: 'versionamento', saida: 'HEAD final registrado na ficha, sem marcador de conflito' },
  { titulo: 'Rodar a suíte por job no HEAD final', dono: 'pipeline', saida: 'números medidos na ficha' },
  { titulo: 'Corrigir o que a suíte apontar e registrar a entrega', dono: 'backend', saida: 'card.entrega com verde medido' },
] }, 'voce').ok);
const antes = creditos.amostrasDe(pid).length;
assert(eq.pilotoTick({ forcar: true }));
for (let i = 0; i < 300 && !(c.quadro.obter(card.id).plano || []).every((p) => p.status === 'feito'); i++) { await dorme(200); if (!eq.ocupada()) eq.pilotoTick({ forcar: true }); }
assert((c.quadro.obter(card.id).plano || []).every((p) => p.status === 'feito'), 'all three steps were done');
eq.cancelar();
const chamadas = creditos.amostrasDe(pid).length - antes;
const hist = eq.historico('equipe');
const poFalas = hist.filter((m) => m.de === 'po' && m.status === 'ok' && !m.oculta).length;
const vazias = hist.filter((m) => m.de !== 'voce' && m.de !== 'sistema' && m.status === 'ok' && !m.oculta && !(m.texto || '').trim()).length;
const ordem = ['versionamento', 'pipeline', 'backend'].map((a) => hist.findIndex((m) => m.de === a && /Fiz o passo/.test(m.texto)));
assert(ordem[0] < ordem[1] && ordem[1] < ordem[2], `the steps ran in plan order: ${ordem}`);
assert(chamadas <= 8, `merge night cost ${chamadas} calls (target: up to 8; the real one cost 243)`);
assert(poFalas <= 2, `leadership spoke ${poFalas} times (target: up to 2; the real one was 84)`);
assert.equal(vazias, 0, 'no empty message');
assert.equal((c.quadro.obter(card.id).workflow.ressalvas || []).filter((x) => x.id.startsWith('txt-')).length, 0, 'no caveat fabricated from a phrase');

// ---- metrics computed by the app
// cost and quality of finished cards (synthetic), false evidence and reverted decision
const c2 = c.quadro.criar({ titulo: 'Concluído de teste', descricao: 'x', dono: 'backend', coluna: 'pronto', aceite: ['GET /y responde 200 com ok'], pontos: 2 }, 'voce').card;
creditos.registrarTarefa({ engine: 'claude', modelo: 'claude-sonnet-5-5', esforco: 'low', tipo: 'feature/execucao', pontos: 2, projeto: pid, card: c2.id, agente: 'backend', resultado: { tokens: { entrada: 200_000, saida: 10_000, cache: 0, criacaoCache: 0 }, duracaoMs: 1000 } });
// light: the card reaches done through the human path (the Game Director), and closing records real vs. estimated cost
const alvo2 = path.join(tmp, 'alvo2'); fs.mkdirSync(alvo2);
const rj = projetos.criar({ nome: 'Jogo', caminho: alvo2, template: 'jogos' }); assert(rj.ok);
const cj = projetos.ctx(rj.projeto.id);
const cardJ = cj.quadro.criar({ titulo: 'Cena 1', descricao: 'x', dono: 'developer', coluna: 'andamento', aceite: ['A cena 1 abre e mostra o menu inicial'], pontos: 3 }, 'voce').card;
creditos.registrarTarefa({ engine: 'claude', modelo: 'claude-sonnet-5-5', esforco: 'low', tipo: 'produzir/developer', pontos: 3, projeto: rj.projeto.id, card: cardJ.id, agente: 'developer', resultado: { tokens: { entrada: 300_000, saida: 10_000, cache: 0, criacaoCache: 0 }, duracaoMs: 1000 } });
cj.quadro.atualizar(cardJ.id, { aceiteOk: [0], evidencias: ['Cena 1 abre e mostra o menu (conferido no build)'] }, 'voce');
for (const col of ['revisao', 'qa', 'concluido']) { const mv = cj.quadro.mover(cardJ.id, col, 'voce', { motivo: 'Validado.' }); assert(mv.ok, `move to ${col}: ${mv.erro}`); }
await dorme(300);
const fx = cj.equipe.fatos.listar().cards[cardJ.id] || {};
assert(fx['custo-final'] && /^1\.05 \(estimado/.test(fx['custo-final'].valor), JSON.stringify(fx));
assert(cj.quadro.obter(cardJ.id).comentarios.some((k) => k.quem === 'creditos' && /Fechamento: custou 1\.05/.test(k.texto)), 'the closing is on the card');
// false evidence: the app measured, the agent reported something else
const eqj = cj.equipe;
eqj.fatos.registrar({ escopo: cardJ.id, chave: 'testes', valor: '10 passed' });
// (recording through the equipe API is a report; for a measurement, the module is used directly)
const { criarFatos } = await import('../lib/fatos.mjs');
const fz = criarFatos({ pasta: cj.pasta });
assert(fz.registrar({ escopo: cardJ.id, chave: 'suite', valor: '10 passed', por: 'sistema', origem: 'app' }).ok);
assert.equal(fz.registrar({ escopo: cardJ.id, chave: 'suite', valor: '12 passed', por: 'developer', origem: 'agente' }).ok, false, 'a report that contradicts a measurement is rejected');
assert.equal(fz.estatisticas().recusados, 1);
// reverted decision: the rule decided A, you answered B later
eqj.ledger.registrarResposta({ pergunta: 'Qual cor do menu?', resposta: 'Azul', por: 'regra do piloto (local)', card: cardJ.id, de: 'developer' });
eqj.ledger.registrarResposta({ pergunta: 'Qual cor do menu?', resposta: 'Verde', por: 'Você', card: cardJ.id, de: 'developer' });
const m = eqj.metricas(30);
assert.equal(m.cardsConcluidos, 1); assert.equal(m.decisoes.porOutros, 1); assert.equal(m.decisoes.revertidas, 1); assert.equal(m.decisoes.taxa, 100);
assert(m.chamadas >= 1 && m.custoTotal >= 1.05, JSON.stringify({ chamadas: m.chamadas, custo: m.custoTotal }));
assert(m.custoPorPonto !== null && Math.abs(m.custoPorPonto - 0.35) < 0.01, `cost per point ${m.custoPorPonto}`);
assert(/## Métricas dos últimos 30 dias/.test(m.texto) && /Lead time/.test(m.texto) && /Evidência falsa/.test(m.texto) && /Decisões tomadas/.test(m.texto));
assert(m.porAgente.some((a) => a.agente === 'developer'));

eqj.cancelar();
console.log(`PASS: phase 6 (per-role playbooks, merge night replay with ${chamadas} calls and ${poFalas} leadership messages, card closing with real vs. estimated cost, metrics: lead time, cost/calls per point, rework, false evidence, reverted decisions).`);
try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* Windows still holds the folder */ }
process.exit(0);
