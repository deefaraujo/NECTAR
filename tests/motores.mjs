// Equilíbrio entre Claude e Codex e controles de motor do painel. Nenhum modelo é chamado.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'work-ia-motores-'));
process.env.STUDIO_DATA = tmp;
const c = await import('../lib/creditos.mjs');
const agora = Math.floor(Date.now() / 1000);

// Cenário real: Claude quase sem uso (janela de 5 h renovada e estimada em 0), Codex alto. O Claude tem que receber o trabalho.
c.registrar({ unifiedWindows: { five_hour: { utilization: 0.95, resetsAt: agora - 600 }, seven_day: { utilization: 0.44, resetsAt: agora + 5 * 86400 } } });
c.registrarCodex({ rateLimits: { primary: { usedPercent: 51, resetsAt: agora + 3600, windowDurationMins: 300 }, secondary: { usedPercent: 78, resetsAt: agora + 4 * 86400, windowDurationMins: 10080 } } });
assert.equal(c.pctEfetivo('claude'), 44, 'janela que já renovou conta como zero');
assert.equal(c.pctEfetivo('codex'), 78);
assert.equal(c.escolherMotor('codex', true), 'claude', 'Codex a 78% e Claude a 44%: o trabalho vai para o Claude, mesmo com a leitura dele estimada');
assert.equal(c.escolherMotor('claude', true), 'claude');
assert.equal(c.escolherMotor('codex', false), 'codex', 'sem a troca automática, fica no motor pedido');

// diferença pequena não troca (evita ficar pulando de um para o outro)
c.registrarCodex({ rateLimits: { primary: { usedPercent: 40, resetsAt: agora + 3600, windowDurationMins: 300 }, secondary: { usedPercent: 50, resetsAt: agora + 4 * 86400, windowDurationMins: 10080 } } });
assert.equal(c.escolherMotor('codex', true), 'codex', '50% contra 44% não justifica trocar');

// equilíbrio também abaixo de 50%: quem está bem mais folgado recebe
c.registrarCodex({ rateLimits: { primary: { usedPercent: 10, resetsAt: agora + 3600, windowDurationMins: 300 }, secondary: { usedPercent: 12, resetsAt: agora + 4 * 86400, windowDurationMins: 10080 } } });
assert.equal(c.escolherMotor('claude', true), 'codex', 'Claude a 44% e Codex a 12%: vai para o Codex');

// motor desligado nunca roda, mesmo sem a troca automática
assert.equal(c.escolherMotor('claude', false, ['claude']), 'codex');
assert.equal(c.escolherMotor('codex', false, ['codex']), 'claude');
assert.equal(c.escolherMotor('claude', true, ['claude', 'codex']), null);

// os botões do painel não podem usar data-motor (é o seletor de motor do chat e engolia o clique)
const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
for (const acao of ['motor-ativo', 'motor-teto']) {
  const linha = app.split('\n').find((l) => l.includes(`data-acao="${acao}"`));
  assert(linha, `botão ${acao} existe`);
  assert(!/data-motor=/.test(linha), `${acao} não usa data-motor`);
  assert(/data-eng=/.test(linha), `${acao} usa data-eng`);
}
// ---- piso de modelo por cargo: arquitetura, revisão e segurança nunca descem, nem com uso alto, teto baixo ou pedido do próprio agente
const { escolher } = await import('../lib/roteador.mjs');
const cx = { leve: 'luna', medio: 'terra', forte: 'sol' };
assert.equal(escolher({ engine: 'claude', tipo: 'pedido', modo: 'conversar' }).modelo, 'claude-haiku-4-5', 'sem piso, conversa simples é barata');
assert.equal(escolher({ engine: 'claude', tipo: 'pedido', modo: 'conversar', piso: 'forte' }).modelo, 'claude-opus-5', 'com piso forte, até a conversa usa modelo forte');
assert.equal(escolher({ engine: 'claude', tipo: 'revisao', card: { pontos: 1 }, teto: 'low', piso: 'forte' }).modelo, 'claude-opus-5', 'o teto baixo da conta não rebaixa o revisor');
assert.equal(escolher({ engine: 'claude', tipo: 'revisao', card: { pontos: 3 }, pref: 'minimo', piso: 'forte' }).modelo, 'claude-opus-5', 'o próprio agente não desce abaixo do piso');
assert.equal(escolher({ engine: 'claude', tipo: 'qa', card: { pontos: 1 }, teto: 'low', piso: 'medio' }).modelo, 'claude-sonnet-5-5');
assert.equal(escolher({ engine: 'claude', tipo: 'execucao', card: { pontos: 1 }, teto: 'low' }).modelo, 'claude-haiku-4-5', 'cargo sem piso continua economizando');
assert.equal(escolher({ engine: 'codex', tipo: 'pedido', modo: 'conversar', teto: 'low', piso: 'forte', codex: cx }).modelo, 'sol', 'no Codex também');
assert.equal(escolher({ engine: 'claude', tipo: 'execucao', card: { pontos: 13 }, piso: 'medio' }).modelo, 'claude-opus-5-5', 'o piso não rebaixa o que já é maior');
const { CONFIG_PADRAO } = await import('../lib/store.mjs');
assert.equal(CONFIG_PADRAO.creditos.pisos.architect, 'forte'); assert.equal(CONFIG_PADRAO.creditos.pisos.revisor, 'forte'); assert.equal(CONFIG_PADRAO.creditos.pisos.seguranca, 'forte');
// ---- o Claude Code hoje informa só o limite dos créditos extras (rateLimitType "overage"): a leitura entra, avisa a tela e só pausa se os extras já estão em uso
let avisos = 0; const parar = c.aoMudar((u) => { assert(u && typeof u === 'object' && 'motores' in u, 'o ouvinte recebe o uso atual'); avisos++; });
const antes = c.atual().cinco?.pct;
c.registrar({ status: 'allowed_warning', resetsAt: agora + 86400, rateLimitType: 'overage', utilization: 0.96, overageStatus: 'allowed_warning', overageResetsAt: agora + 86400, isUsingOverage: false, surpassedThreshold: 0.95 });
assert.equal(avisos, 1, 'o painel é avisado a cada leitura do Claude');
assert.equal(c.atual().extra.pct, 96); assert.equal(c.atual().extra.emUso, false);
assert.equal(c.atual().cinco?.pct, antes, 'a leitura dos extras não mexe nas janelas de 5 h e semana');
assert.equal(c.pctEfetivo('claude'), 44, 'extras ainda não usados não contam no uso do Claude');
assert.equal(c.pausas().claude, undefined, 'plano ainda cobre: o Claude não pausa');
c.registrar({ status: 'allowed', rateLimitType: 'overage', overageStatus: 'allowed' });
assert.equal(avisos, 1, 'evento sem número não finge leitura nova');
c.registrar({ status: 'allowed_warning', resetsAt: agora + 86400, rateLimitType: 'overage', utilization: 0.96, overageResetsAt: agora + 86400, isUsingOverage: true });
assert.equal(c.atual().extra.emUso, true); assert.equal(c.pctEfetivo('claude'), 96, 'gastando os extras a 96%, o uso do Claude é alto');
parar();
console.log('PASS: equilíbrio entre motores com leitura estimada, motor desligado e botões do painel de motores.');
try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* o Windows ainda segura a pasta */ }
process.exit(0);
