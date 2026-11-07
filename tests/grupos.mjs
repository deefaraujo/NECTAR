// Work groups and direct DM with the Game Director: #equipe is kept for notifying the P.O. and announcing completions.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'work-ia-grupos-'));
process.env.STUDIO_DATA = path.join(tmp, 'data'); process.env.STUDIO_PROJETOS = path.join(tmp, 'projetos'); process.env.STUDIO_FAKE = '1';
const store = await import('../lib/store.mjs');
store.gravarConfig({ piloto: { ativo: false, maxChamadasHora: 0 }, ciclo: { statusPO: false, fechamento: false, orcamento: 10, revisaoAuto: false, versionar: false } });
const projetos = await import('../lib/projetos.mjs');
fs.mkdirSync(path.join(tmp, 'alvo'));
const r = projetos.criar({ nome: 'Grupos', caminho: path.join(tmp, 'alvo'), template: 'software' }); assert(r.ok);
const c = projetos.ctx(r.projeto.id);
const eq = c.equipe;
const espera = async (cond, ms = 15000) => { for (let t = 0; t < ms / 50 && !cond(); t++) await new Promise((x) => setTimeout(x, 50)); assert(cond(), 'timed out'); };
const falas = (canal, de) => eq.historico(canal).filter((m) => m.de === de && m.status === 'ok');
const enviar = (canal, texto) => eq.enviar({ canal, texto, engine: 'claude', modo: 'conversar' });

// ---- an agent opens a group with a colleague: the conversation happens there, not in #equipe
enviar('dm:frontend', '[teste:grupo] preciso alinhar o contrato com o back');
await espera(() => eq.grupos().length === 1 && falas('grp-1', 'backend').length >= 1);
const g = eq.grupos()[0];
assert.equal(g.canal, 'grp-1'); assert.deepEqual([...g.membros].sort(), ['backend', 'frontend']); assert.equal(g.status, 'ativo');
assert(falas('grp-1', 'frontend').some((m) => /formato de erro/.test(m.texto)), 'the opening question is in the group');
assert.equal(falas('equipe', 'backend').length, 0, 'the colleague answered in the group, not in #equipe');
assert.equal(falas('equipe', 'frontend').length, 0);

// ---- an agent calling another with @ in #equipe: the reply goes to the pair's group (reuses the existing one)
const antes = falas('grp-1', 'backend').length;
enviar('equipe', '@Front-end [teste:mencao] veja isso');
await espera(() => falas('grp-1', 'backend').length > antes);
assert.equal(eq.grupos().length, 1, 'reused the pair group instead of opening another');
assert.equal(falas('equipe', 'backend').length, 0, 'colleague chat does not clutter #equipe');
assert(falas('equipe', 'frontend').length >= 1, 'the user call stays in #equipe (the Game Director spoke there)');

// ---- a question to the Game Director goes to the agent DM
enviar('equipe', '@Front-end [teste:pergunta] qual azul?');
await espera(() => eq.perguntasAbertas().some((p) => p.de === 'frontend'));
const q = eq.perguntasAbertas().find((p) => p.de === 'frontend');
assert.equal(q.canal, 'dm:frontend', 'question in the DM with the Game Director');
assert(eq.historico('dm:frontend').some((m) => m.pergunta === q.id && /azul/.test(m.texto)), 'the question shows in the Front-end DM');
assert(eq.historico('equipe').some((m) => m.de === 'frontend' && /perguntei direto na minha DM/i.test(m.texto)), 'only the short notice stays in #equipe');
assert(!eq.historico('equipe').some((m) => m.pergunta === q.id), '#equipe does not get the question');
// answering lands in the agent DM
assert(eq.responder(q.id, 'Azul da marca').ok);
await espera(() => eq.historico('dm:frontend').some((m) => m.de === 'voce' && /Azul da marca/.test(m.texto)));

// ---- the same question, now through the P.O.: already decided (ledger), so it returns immediately without opening a new question
enviar('equipe', '@P.O. [teste:pergunta] qual azul?');   // with no chosen name, the agent answers to its role
await espera(() => eq.historico('equipe').some((m) => m.de === 'sistema' && /já foi decidido/i.test(m.texto)));
assert(!eq.perguntasAbertas().some((p) => p.de === 'po'), 'a repeated question does not reopen');

// ---- dm.enviar: the agent speaks directly, without a question
const dmAntes = falas('dm:backend', 'backend').length;
enviar('dm:backend', '[teste:dm] como está?');
await espera(() => falas('dm:backend', 'backend').some((m) => /terminei a parte A/.test(m.texto)));
assert.equal(eq.perguntasAbertas().filter((p) => p.de === 'backend').length, 0, 'a direct message does not open a question');

// ---- the Game Director chats inside the group and closes it there
enviar('grp-1', '@Front-end [teste:encerrar] pode fechar');
await espera(() => eq.grupos()[0].status === 'encerrado');
assert(eq.historico('equipe').some((m) => m.de === 'sistema' && /Grupo «.*» encerrado: Formato de erro definido/.test(m.texto)), 'the completion is announced in #equipe');
enviar('grp-1', '@Front-end mais uma coisa');
await new Promise((x) => setTimeout(x, 800));
assert(eq.historico('grp-1').some((m) => m.de === 'sistema' && /encerrado/.test(m.texto)));
assert.equal(falas('grp-1', 'frontend').filter((m) => /mais uma coisa/.test(m.texto)).length, 0);

eq.cancelar();
console.log('PASS: work groups (colleague chat outside #equipe), direct DM with the Game Director, question in the agent DM and completion announced in #equipe.');
try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* Windows still holds the folder */ }
process.exit(0);
