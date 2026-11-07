// Balancing between Claude and Codex, and the panel's engine controls. No model is called.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'work-ia-motores-'));
process.env.STUDIO_DATA = tmp;
const c = await import('../lib/creditos.mjs');
const agora = Math.floor(Date.now() / 1000);

// Real scenario: Claude barely used (5 h window reset and estimated at 0), Codex high. Claude must get the work.
c.registrar({ unifiedWindows: { five_hour: { utilization: 0.95, resetsAt: agora - 600 }, seven_day: { utilization: 0.44, resetsAt: agora + 5 * 86400 } } });
c.registrarCodex({ rateLimits: { primary: { usedPercent: 51, resetsAt: agora + 3600, windowDurationMins: 300 }, secondary: { usedPercent: 78, resetsAt: agora + 4 * 86400, windowDurationMins: 10080 } } });
assert.equal(c.pctEfetivo('claude'), 44, 'a window that already reset counts as zero');
assert.equal(c.pctEfetivo('codex'), 78);
assert.equal(c.escolherMotor('codex', true), 'claude', 'Codex at 78% and Claude at 44%: work goes to Claude, even with its reading estimated');
assert.equal(c.escolherMotor('claude', true), 'claude');
assert.equal(c.escolherMotor('codex', false), 'codex', 'without auto-switch, stays on the requested engine');

// a small difference does not switch (avoids flip-flopping between them)
c.registrarCodex({ rateLimits: { primary: { usedPercent: 40, resetsAt: agora + 3600, windowDurationMins: 300 }, secondary: { usedPercent: 50, resetsAt: agora + 4 * 86400, windowDurationMins: 10080 } } });
assert.equal(c.escolherMotor('codex', true), 'codex', '50% vs 44% does not justify switching');

// balancing also below 50%: the one with much more headroom gets the work
c.registrarCodex({ rateLimits: { primary: { usedPercent: 10, resetsAt: agora + 3600, windowDurationMins: 300 }, secondary: { usedPercent: 12, resetsAt: agora + 4 * 86400, windowDurationMins: 10080 } } });
assert.equal(c.escolherMotor('claude', true), 'codex', 'Claude at 44% and Codex at 12%: goes to Codex');

// a disabled engine never runs, even without auto-switch
assert.equal(c.escolherMotor('claude', false, ['claude']), 'codex');
assert.equal(c.escolherMotor('codex', false, ['codex']), 'claude');
assert.equal(c.escolherMotor('claude', true, ['claude', 'codex']), null);

// panel buttons must not use data-motor (that is the chat's engine selector and it swallowed the click)
const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
for (const acao of ['motor-ativo', 'motor-teto']) {
  const linha = app.split('\n').find((l) => l.includes(`data-acao="${acao}"`));
  assert(linha, `button ${acao} exists`);
  assert(!/data-motor=/.test(linha), `${acao} does not use data-motor`);
  assert(/data-eng=/.test(linha), `${acao} uses data-eng`);
}
// ---- model floor per role: architecture, review and security never go lower, not with high usage, a low cap, or the agent's own request
const { escolher } = await import('../lib/roteador.mjs');
const cx = { leve: 'luna', medio: 'terra', forte: 'sol' };
assert.equal(escolher({ engine: 'claude', tipo: 'pedido', modo: 'conversar' }).modelo, 'claude-haiku-4-5', 'without a floor, a simple chat is cheap');
assert.equal(escolher({ engine: 'claude', tipo: 'pedido', modo: 'conversar', piso: 'forte' }).modelo, 'claude-opus-5', 'with a strong floor, even chat uses a strong model');
assert.equal(escolher({ engine: 'claude', tipo: 'revisao', card: { pontos: 1 }, teto: 'low', piso: 'forte' }).modelo, 'claude-opus-5', 'the account low cap does not downgrade the reviewer');
assert.equal(escolher({ engine: 'claude', tipo: 'revisao', card: { pontos: 3 }, pref: 'minimo', piso: 'forte' }).modelo, 'claude-opus-5', 'the agent itself cannot go below the floor');
assert.equal(escolher({ engine: 'claude', tipo: 'qa', card: { pontos: 1 }, teto: 'low', piso: 'medio' }).modelo, 'claude-sonnet-5-5');
assert.equal(escolher({ engine: 'claude', tipo: 'execucao', card: { pontos: 1 }, teto: 'low' }).modelo, 'claude-haiku-4-5', 'a role without a floor keeps saving');
assert.equal(escolher({ engine: 'codex', tipo: 'pedido', modo: 'conversar', teto: 'low', piso: 'forte', codex: cx }).modelo, 'sol', 'on Codex too');
assert.equal(escolher({ engine: 'claude', tipo: 'execucao', card: { pontos: 13 }, piso: 'medio' }).modelo, 'claude-opus-5-5', 'the floor does not downgrade what is already higher');
const { CONFIG_PADRAO } = await import('../lib/store.mjs');
assert.equal(CONFIG_PADRAO.creditos.pisos.architect, 'forte'); assert.equal(CONFIG_PADRAO.creditos.pisos.revisor, 'forte'); assert.equal(CONFIG_PADRAO.creditos.pisos.seguranca, 'forte');
// ---- Claude Code currently reports only the extra-credit limit (rateLimitType "overage"): the reading is recorded, notifies the UI, and only pauses if extras are already in use
let avisos = 0; const parar = c.aoMudar((u) => { assert(u && typeof u === 'object' && 'motores' in u, 'the listener receives current usage'); avisos++; });
const antes = c.atual().cinco?.pct;
c.registrar({ status: 'allowed_warning', resetsAt: agora + 86400, rateLimitType: 'overage', utilization: 0.96, overageStatus: 'allowed_warning', overageResetsAt: agora + 86400, isUsingOverage: false, surpassedThreshold: 0.95 });
assert.equal(avisos, 1, 'the panel is notified on every Claude reading');
assert.equal(c.atual().extra.pct, 96); assert.equal(c.atual().extra.emUso, false);
assert.equal(c.atual().cinco?.pct, antes, 'the extras reading does not touch the 5 h and weekly windows');
assert.equal(c.pctEfetivo('claude'), 44, 'unused extras do not count toward Claude usage');
assert.equal(c.pausas().claude, undefined, 'plan still covers it: Claude does not pause');
c.registrar({ status: 'allowed', rateLimitType: 'overage', overageStatus: 'allowed' });
assert.equal(avisos, 1, 'an event without a number does not fake a new reading');
c.registrar({ status: 'allowed_warning', resetsAt: agora + 86400, rateLimitType: 'overage', utilization: 0.96, overageResetsAt: agora + 86400, isUsingOverage: true });
assert.equal(c.atual().extra.emUso, true); assert.equal(c.pctEfetivo('claude'), 96, 'spending extras at 96%, Claude usage is high');
parar();
console.log('PASS: engine balancing with estimated reading, disabled engine, and engine panel buttons.');
try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* Windows may still hold the folder */ }
process.exit(0);
