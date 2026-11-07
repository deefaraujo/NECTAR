// Fase 5 (orçamento): envelope semana → dia → janela de 5 h calculado da leitura de uso, custo normalizado por chamada e por card,
// estimativa por pontos com histórico, modo reserva que não começa trabalho novo, subir de nível só com evidência, alocação no planning.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'work-ia-fase5-'));
process.env.STUDIO_DATA = path.join(tmp, 'data'); process.env.STUDIO_PROJETOS = path.join(tmp, 'projetos'); process.env.STUDIO_FAKE = '1'; process.env.STUDIO_FAKE_LOCAL = '0';
const store = await import('../lib/store.mjs');
store.gravarConfig({ piloto: { ativo: true, maxChamadasHora: 0, poDecide: true }, ciclo: { statusPO: false, fechamento: false, orcamento: 10, revisaoAuto: false, versionar: false } });
const creditos = await import('../lib/creditos.mjs');
const { escolher } = await import('../lib/roteador.mjs');
const projetos = await import('../lib/projetos.mjs');
const dorme = (ms) => new Promise((x) => setTimeout(x, ms));
const seg = () => Math.floor(Date.now() / 1000);

// ---- custo normalizado por chamada
assert.equal(creditos.custoDe({ modelo: 'claude-sonnet-5-5', tokens: { entrada: 1_000_000, saida: 0, cache: 0, criacaoCache: 0 } }), 3);
assert.equal(creditos.custoDe({ modelo: 'claude-opus-5-5', tokens: { entrada: 0, saida: 1_000_000, cache: 0, criacaoCache: 0 } }), 75);
assert.equal(creditos.custoDe({ modelo: 'claude-haiku-4-5', tokens: { entrada: 0, saida: 0, cache: 10_000_000, criacaoCache: 0 } }), 1);

// ---- envelope a partir da leitura de uso: semana em 60% com 2 dias para renovar → envelope de hoje 20%
creditos.registrar({ unifiedWindows: { five_hour: { utilization: 0.5, resetsAt: seg() + 3 * 3600 }, seven_day: { utilization: 0.6, resetsAt: seg() + 2 * 86400 - 60 } } });
let e = creditos.envelope('claude');
assert.equal(e.restanteSemana, 40); assert.equal(e.diasRestantes, 2); assert.equal(e.envelopeDia, 20); assert.equal(e.gastoHoje, 0); assert.equal(e.saldoDia, 20); assert.equal(e.reserva, false);
assert(/envelope de hoje 20%/.test(creditos.textoEnvelope('claude')));
// o dia avança: a semana vai a 85% (gastou 25% hoje, acima do envelope) → modo reserva
creditos.registrar({ unifiedWindows: { five_hour: { utilization: 0.5, resetsAt: seg() + 3 * 3600 }, seven_day: { utilization: 0.85, resetsAt: seg() + 2 * 86400 - 60 } } });
e = creditos.envelope('claude');
assert.equal(e.gastoHoje, 25); assert.equal(e.saldoDia, -5); assert.equal(e.reserva, true); assert(/envelope de hoje/.test(e.motivo));
// janela de 5 h a 92% também é reserva
creditos.registrar({ unifiedWindows: { five_hour: { utilization: 0.92, resetsAt: seg() + 3600 }, seven_day: { utilization: 0.3, resetsAt: seg() + 5 * 86400 } } });
e = creditos.envelope('claude');
assert.equal(e.reserva, true); assert(/janela de 5 h/.test(e.motivo));

// ---- estimativa por pontos: sem histórico vem da tabela; com 3 cards concluídos do mesmo tamanho, vem da mediana
assert.equal(creditos.estimativaCard({ projeto: 'px', pontos: 3 }).origem, 'tabela');
for (const [card, custoEntrada] of [['T-101', 200_000], ['T-102', 400_000], ['T-103', 300_000]]) {
  creditos.registrarTarefa({ engine: 'claude', modelo: 'claude-sonnet-5-5', esforco: 'low', tipo: 'feature/execucao', pontos: 3, projeto: 'px', card, agente: 'backend', resultado: { tokens: { entrada: custoEntrada, saida: 10_000, cache: 0, criacaoCache: 0 }, duracaoMs: 1000 } });
  creditos.registrarQualidade('px', { id: card, coluna: 'concluido', workflow: { qa: { status: 'aprovado' }, revisao: 1, retrabalhos: 0 } });
}
const est = creditos.estimativaCard({ projeto: 'px', pontos: 3 });
assert.equal(est.origem, 'histórico'); assert.equal(est.base, 3); assert.equal(est.custo, 1.05, JSON.stringify(est));   // mediana: 300k*3 + 10k*15 = 1.05
assert.equal(creditos.custoDoCard('px', 'T-102'), 1.35);

// ---- subir de nível só com evidência: pedido de "high" sem retrabalho é ignorado; com retrabalho, vale
const semEvid = escolher({ engine: 'claude', tipo: 'execucao', modo: 'trabalhar', card: { pontos: 2 }, teto: 'high', pref: 'high' });
assert.equal(semEvid.degrau, 1); assert(/ignorado/.test(semEvid.motivo));
const comEvid = escolher({ engine: 'claude', tipo: 'execucao', modo: 'trabalhar', card: { pontos: 2, workflow: { retrabalhos: 2 } }, teto: 'high', pref: 'high' });
assert.equal(comEvid.degrau, 4);
assert.equal(escolher({ engine: 'claude', tipo: 'execucao', modo: 'trabalhar', card: { pontos: 5 }, teto: 'high', pref: 'minimo' }).degrau, 0, 'descer é sempre permitido');

// ---- modo reserva no piloto: card em Pronto não começa; card em andamento continua
fs.mkdirSync(path.join(tmp, 'alvo'));
const r = projetos.criar({ nome: 'Fase cinco', caminho: path.join(tmp, 'alvo'), template: 'software' }); assert(r.ok);
const c = projetos.ctx(r.projeto.id); const eq = c.equipe;
const pronto = c.quadro.criar({ titulo: 'Novo', descricao: 'x', dono: 'backend', coluna: 'pronto', aceite: ['GET /novo responde 200 com ok'] }, 'voce').card;
creditos.registrar({ unifiedWindows: { five_hour: { utilization: 0.95, resetsAt: seg() + 1800 }, seven_day: { utilization: 0.3, resetsAt: seg() + 5 * 86400 } } });
assert.equal(eq.pilotoTick({ forcar: true }), false, 'em reserva, trabalho novo não começa');
assert.equal(c.quadro.obter(pronto.id).coluna, 'pronto');
assert(eq.historico('equipe').some((m) => m.de === 'creditos' && /Modo reserva/.test(m.texto)), 'o Créditos avisa uma vez');
// a janela renovou: o trabalho novo começa
creditos.registrar({ unifiedWindows: { five_hour: { utilization: 0.1, resetsAt: seg() + 5 * 3600 }, seven_day: { utilization: 0.3, resetsAt: seg() + 5 * 86400 } } });
assert.equal(creditos.envelope('claude').reserva, false);
for (let i = 0; i < 150 && eq.ocupada(); i++) await dorme(200);   // o aviso de 95% acordou a liderança; espera a rodada terminar
{ let ok = false; for (let i = 0; i < 20 && !ok; i++) { ok = eq.pilotoTick({ forcar: true }); await dorme(250); } assert(ok, 'fora da reserva, começa'); }
for (let i = 0; i < 60 && c.quadro.obter(pronto.id).coluna !== 'andamento'; i++) await dorme(200);
assert.equal(c.quadro.obter(pronto.id).coluna, 'andamento');

// ---- custo do card e orçamento no prompt
creditos.registrarTarefa({ engine: 'claude', modelo: 'claude-sonnet-5-5', esforco: 'low', tipo: 'feature/execucao', pontos: 3, projeto: r.projeto.id, card: pronto.id, agente: 'backend', resultado: { tokens: { entrada: 400_000, saida: 20_000, cache: 0, criacaoCache: 0 }, duracaoMs: 1000 } });
const pr = eq.teste.montar({ agente: 'backend', tipo: 'execucao', card: pronto.id, canalSaida: 'equipe', instrucao: '', origem: 'workflow' }).pedido;
assert(/## Custo deste card: 1\.50 de/.test(pr), 'o agente vê o custo do card contra a estimativa');
assert(/ATENÇÃO: perto ou acima da estimativa/.test(pr), 'acima de 70% da estimativa o agente precisa justificar');
const pl = eq.teste.montar({ agente: 'po', tipo: 'piloto', card: null, canalSaida: 'equipe', instrucao: '', origem: 'sistema' }).pedido;
assert(/## Orçamento \(Claude\)/.test(pl) && /envelope de hoje/.test(pl), 'a liderança vê o envelope');
assert(/## Orçamento/.test(creditos.relatorio([], r.projeto.id)), 'o relatório do Créditos traz o envelope');

eq.cancelar();
console.log('PASS: fase 5 (custo normalizado, envelope semana/dia/janela da leitura de uso, estimativa por histórico, modo reserva no piloto com aviso único, subir de nível só com evidência, custo do card e orçamento no prompt).');
try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* o Windows ainda segura a pasta */ }
process.exit(0);
