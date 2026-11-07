// Autopilot: work never stops. Mentioning the Game Director does not block a card; the P.O. decides stalled questions; a stuck
// call is cancelled; a blocker becomes a team meeting and never gives up. No model is called.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'work-ia-piloto-'));
process.env.STUDIO_DATA = path.join(tmp, 'data'); process.env.STUDIO_PROJETOS = path.join(tmp, 'projetos'); process.env.STUDIO_FAKE = '1';
process.env.STUDIO_PROMPT_DUMP = path.join(tmp, 'dump');
const guarda = await import('../lib/guarda.mjs');

// ---- pure functions: stuck call and wait between meetings
const agora = Date.now();
assert(guarda.turnoParado({ id: `t${agora - 30 * 60_000}` }, agora, 25 * 60_000), 'no activity for 30 min means stuck');
assert(!guarda.turnoParado({ id: `t${agora - 30 * 60_000}`, vivo: agora - 60_000 }, agora, 25 * 60_000), 'with recent activity, not stuck');
assert.deepEqual([0, 1, 2, 3, 4, 5, 9].map((n) => guarda.esperaReuniaoMs(n) / 60_000), [0, 5, 15, 30, 60, 120, 240], 'the wait grows with each round without progress');
assert.equal(guarda.esperaReuniaoMs(4, true) / 60_000, 30, 'with the rest of the board idle the wait is halved, never down to one minute (each meeting is a paid call)');
assert.equal(guarda.esperaReuniaoMs(1, true) / 60_000, 2.5, 'the first repeat with an idle board waits 2.5 min');
assert.equal(guarda.REUNIOES_ATE_PERGUNTAR, 4, 'after 4 meetings without progress, the card waits for the Game Director');

const store = await import('../lib/store.mjs');
store.gravarConfig({ piloto: { ativo: true, intervaloMin: 1, maxChamadasHora: 0, decideAposMin: 0.0005, poDecide: false }, ciclo: { statusPO: false, versionar: false, posts: false, revisaoAuto: false } });
const projetos = await import('../lib/projetos.mjs');
fs.mkdirSync(path.join(tmp, 'alvo'));
const p = projetos.criar({ nome: 'Piloto', caminho: path.join(tmp, 'alvo'), template: 'software' }); assert(p.ok);
const c = projetos.ctx(p.projeto.id); const eq = c.equipe; const q = c.quadro;
const espera = async (cond, ms = 20000) => { for (let t = 0; t < ms / 50 && !cond(); t++) await new Promise((x) => setTimeout(x, 50)); assert(cond(), 'timed out'); };
const ocioso = () => espera(() => Object.keys(eq.presencaAtual()).length === 0, 30000);
const card = q.criar({ titulo: 'Contrato da API', descricao: 'Definir.', dono: 'backend', coluna: 'andamento', aceite: ['Contrato publicado'] }, 'po').card;

// ---- mentioning the Game Director is NOT a question: the card does not wait
eq.enviar({ canal: 'dm:po', texto: `[teste:citar] sobre o contrato da API, o que acha da entrega?`, engine: 'claude', modo: 'conversar' });
await espera(() => eq.historico('dm:po').some((m) => m.de === 'po' && /@/.test(m.texto || '')));
await ocioso();
assert(!q.obter(card.id).aguardando, 'replying to the user by name does not block the card');
assert.equal(eq.perguntas().filter((x) => x.estado === 'aberta').length, 0, 'and opens no question');

// ---- a real question (perguntar action) blocks the card, and on autopilot the P.O. decides once time passes
eq.enviar({ canal: 'dm:backend', texto: `[teste:pergunta] ${card.id}`, engine: 'claude', modo: 'conversar' });
await espera(() => eq.perguntas().some((x) => x.estado === 'aberta'));
const pergunta = eq.perguntas().find((x) => x.estado === 'aberta');
await ocioso();
assert(q.obter(pergunta.card || card.id).aguardando, 'a real question makes the card wait');
await new Promise((x) => setTimeout(x, 100));
assert(eq.teste.perguntasParaDecidir({ decideAposMin: 0.0005 }).some((x) => x.id === pergunta.id), 'a stalled question enters the decision queue');
eq.pilotoTick();
await espera(() => eq.perguntas().find((x) => x.id === pergunta.id)?.estado === 'respondida');
await ocioso();
assert(!q.obter(pergunta.card || card.id).aguardando, 'once the P.O. decides, the card moves again');
assert(eq.historico(pergunta.canal).some((m) => m.de === 'po' && /Decidi no piloto automático/.test(m.texto || '')), 'the decision is recorded for the user to read later');
assert.equal(eq.teste.perguntasParaDecidir({ decideAposMin: 0, poDecide: false }).length, 0, 'without the P.O. option and with decideAposMin 0, the P.O. decides nothing');

// ---- autopilot with "the P.O. speaks for me": the question never reaches the Game Director, the P.O. decides right away and reports in the DM
store.gravarConfig({ piloto: { ativo: true, intervaloMin: 1, maxChamadasHora: 0, decideAposMin: 8, poDecide: true } });
const cardP = q.criar({ titulo: 'Tela de chaves', descricao: 'Montar.', dono: 'frontend', coluna: 'andamento', aceite: ['Tela abre'] }, 'po').card;
eq.enviar({ canal: 'dm:frontend', texto: `[teste:pergunta] ${cardP.id}`, engine: 'claude', modo: 'conversar' });
await espera(() => eq.perguntas().some((x) => x.paraPO));
const qp = eq.perguntas().find((x) => x.paraPO);
assert(!eq.perguntas().filter((x) => !x.paraPO && x.estado === 'aberta').length, 'no open question is visible to the Game Director');
await espera(() => eq.perguntas().find((x) => x.id === qp.id)?.estado === 'respondida');
await ocioso();
assert(!(q.obter(qp.card || cardP.id)?.aguardando), 'the card never waited for the Game Director');
await espera(() => eq.historico('dm:po').some((m) => m.de === 'po' && /Decidi por você/.test(m.texto || '')));
const relato = eq.historico('dm:po').find((m) => /Decidi por você/.test(m.texto || ''));
assert(/Decisão: /.test(relato.texto) && /Motivo: /.test(relato.texto), 'the DM report includes the decision and the reason');
assert(eq.historico('dm:frontend').some((m) => m.de === 'po' && /Decidi no piloto automático/.test(m.texto || '')) || eq.historico(qp.canal).some((m) => m.de === 'po' && /Decidi no piloto automático/.test(m.texto || '')), 'the asker gets the answer');
// autopilot off with a question in the P.O.'s hands: it goes back to the Game Director, with a notice
store.gravarConfig({ piloto: { ativo: false } });
const qv = eq.perguntas().find((x) => x.estado === 'respondida');
assert(qv, 'sanity');
store.gravarConfig({ piloto: { ativo: true, poDecide: true } });

// ---- a blocker becomes a meeting: group with owner, P.O. and specialist, and the P.O. leads
q.bloquear(card.id, 'O teste do pytest falha sempre no mesmo ponto: falta a variável de ambiente do banco e não sei como obter.', 'backend');
assert(eq.teste.especialistasDoImpedimento(q.obter(card.id)).includes('qa'), 'the cause (failing test) brings in QA');
eq.pilotoTick();
await espera(() => eq.grupos().some((g) => g.card === card.id && /Desimpedir/.test(g.titulo)));
const g = eq.grupos().find((x) => x.card === card.id && /Desimpedir/.test(x.titulo));
assert(g.membros.includes('po') && g.membros.includes('backend'), 'the P.O. and the owner are in the meeting');
assert(g.membros.length >= 3, 'at least one more specialist to help');
await espera(() => eq.historico(g.canal).some((m) => m.de === 'po' && /conta em 3 linhas/.test(m.texto || '')));
await espera(() => eq.historico(g.canal).some((m) => m.de === 'backend' && m.status === 'ok'));
assert(eq.historico(g.canal).some((m) => m.de === 'sistema' && /Reunião de desimpedimento/.test(m.texto || '')), 'the round is announced');
await ocioso();
const antes = eq.grupos().filter((x) => x.card === card.id).length;
eq.pilotoTick(); await new Promise((x) => setTimeout(x, 300));
assert.equal(eq.grupos().filter((x) => x.card === card.id).length, antes, 'the next meeting respects the short wait and reuses the same group');
const tri = JSON.parse(fs.readFileSync(path.join(c.pasta, 'triagem.json'), 'utf8'));
assert(Object.values(tri).some((e) => e.n === 1), 'round 1 counted, no round limit to give up');

// ---- delivery with work ALREADY committed (clean tree): the app finds the files through the branch commits and does not reject
const wt = path.join(tmp, 'wt-limpo'); fs.mkdirSync(wt);
const git = (...x) => execFileSync('git', ['-C', wt, ...x], { stdio: 'ignore' });
git('init', '-q', '-b', 'main'); git('config', 'user.email', 't@t'); git('config', 'user.name', 't');
fs.writeFileSync(path.join(wt, 'base.txt'), 'base'); git('add', '.'); git('commit', '-q', '-m', 'base');
git('checkout', '-q', '-b', 'ticket-limpo'); fs.writeFileSync(path.join(wt, 'novo.py'), 'print(1)'); git('add', '.'); git('commit', '-q', '-m', 'feature');
const cardG = q.criar({ titulo: 'Entrega sem pendência no Git', descricao: 'Trabalho já commitado.', dono: 'backend', coluna: 'andamento', aceite: ['Funciona'] }, 'po').card;
assert(q.fluxo(cardG.id, 'checkpoint', { revisao: 0, resumo: 'Pronto.', proximoPasso: 'Registrar.', worktree: wt }, 'backend').ok);
await ocioso();
eq.enviar({ canal: 'dm:backend', texto: `[teste:entrega-min] ${cardG.id}`, engine: 'claude', modo: 'conversar' });
await espera(() => (q.obter(cardG.id).workflow.revisao || 0) === 1);
assert.deepEqual(q.obter(cardG.id).workflow.entregas[0].arquivos, ['novo.py'], 'clean tree: files come from the branch commits');
assert(q.obter(cardG.id).workflow.entregas[0].verificacoes.length >= 1, 'with no command given and no plan, the app records the gap instead of rejecting');

// ---- the agent learns what the app rejected; a repeated rejection calls the P.O. right away, without waiting for a meeting
const cardR = q.criar({ titulo: 'Registro recusado', descricao: 'Sem entrega ainda.', dono: 'backend', coluna: 'andamento', aceite: ['Funciona'] }, 'po').card;
await ocioso();
eq.enviar({ canal: 'dm:backend', texto: `[teste:recusa] ${cardR.id}`, engine: 'claude', modo: 'conversar' });
await espera(() => eq.historico('dm:backend').filter((m) => m.de === 'backend' && m.status === 'ok').length >= 2);
await ocioso();
const dumpAntes = fs.existsSync(process.env.STUDIO_PROMPT_DUMP) ? fs.readdirSync(process.env.STUDIO_PROMPT_DUMP).map((f) => fs.readFileSync(path.join(process.env.STUDIO_PROMPT_DUMP, f), 'utf8')).join(String.fromCharCode(10)) : '';
fs.rmSync(process.env.STUDIO_PROMPT_DUMP, { recursive: true, force: true });
eq.enviar({ canal: 'dm:backend', texto: `[teste:recusa] ${cardR.id}`, engine: 'claude', modo: 'conversar' });
await espera(() => fs.existsSync(process.env.STUDIO_PROMPT_DUMP) && fs.readdirSync(process.env.STUDIO_PROMPT_DUMP).some((f) => f.includes('backend')));
const dRec = fs.readdirSync(process.env.STUDIO_PROMPT_DUMP).filter((f) => f.includes('backend')).map((f) => fs.readFileSync(path.join(process.env.STUDIO_PROMPT_DUMP, f), 'utf8')).join(String.fromCharCode(10));
assert(/O app RECUSOU estas ações suas/.test(dRec), 'the agent receives, in the next request, what the app rejected');
await espera(() => eq.historico('equipe').some((m) => m.de === 'po' && /o app recusou porque/.test(m.texto || '')));
await ocioso();

// ---- idle team with an open card: the lead is woken up to manage (any template)
const antesO = eq.historico('equipe').filter((m) => m.tipo === 'ocioso').length;
assert.equal(eq.teste.despertarLideranca(), true, 'with an open card and nobody working, the P.O. is woken up');
await espera(() => eq.historico('equipe').filter((m) => m.tipo === 'ocioso').length > antesO);
await ocioso();
assert.equal(eq.teste.despertarLideranca(), false, 'and does not repeat before the interval (no wasted call)');
assert(/depende de|bloqueado por|próxima etapa|sem próxima etapa/.test(eq.teste.motivoParado(q.obter(card.id))), 'the reason for each stalled card goes to the P.O.');

// ---- the P.O. prompt includes autonomy and the decide action
const dump = dumpAntes + String.fromCharCode(10) + fs.readdirSync(process.env.STUDIO_PROMPT_DUMP).map((f) => fs.readFileSync(path.join(process.env.STUDIO_PROMPT_DUMP, f), 'utf8')).join(String.fromCharCode(10));
assert(/Autonomia: no piloto automático você FALA PELA pessoa que lidera/.test(dump) && /pergunta\.decidir/.test(dump) && /REUNIÃO DE DESIMPEDIMENTO/.test(dump), 'autonomy, decision and meeting in the prompt');
assert(/Papel de P\.O\.: o que você garante/.test(dump) && /Reporte à pessoa que lidera como a uma stakeholder/.test(dump) && /Dono do quadro e do ritmo/.test(dump), 'the P.O. role is defined: monitor, ensure and report as to a stakeholder');
assert(/Nunca pare de tentar só porque falhou algumas vezes/.test(dump), 'whoever gets stuck is told to ask for help early');

eq.cancelar();
console.log('PASS: autonomous autopilot (mentioning does not block a card, P.O. decides stalled questions, stuck call is detected, blocker becomes a team meeting and never gives up).');
try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* Windows may still hold the folder */ }
process.exit(0);
