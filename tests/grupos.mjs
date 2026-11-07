// Grupos de trabalho e DM direta com a Game Director: o #equipe fica para avisar a P.O. e anunciar finalizações.
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
const espera = async (cond, ms = 15000) => { for (let t = 0; t < ms / 50 && !cond(); t++) await new Promise((x) => setTimeout(x, 50)); assert(cond(), 'tempo esgotado'); };
const falas = (canal, de) => eq.historico(canal).filter((m) => m.de === de && m.status === 'ok');
const enviar = (canal, texto) => eq.enviar({ canal, texto, engine: 'claude', modo: 'conversar' });

// ---- um agente abre um grupo com um colega: a conversa acontece lá, não no #equipe
enviar('dm:frontend', '[teste:grupo] preciso alinhar o contrato com o back');
await espera(() => eq.grupos().length === 1 && falas('grp-1', 'backend').length >= 1);
const g = eq.grupos()[0];
assert.equal(g.canal, 'grp-1'); assert.deepEqual([...g.membros].sort(), ['backend', 'frontend']); assert.equal(g.status, 'ativo');
assert(falas('grp-1', 'frontend').some((m) => /formato de erro/.test(m.texto)), 'a pergunta inicial está no grupo');
assert.equal(falas('equipe', 'backend').length, 0, 'o colega respondeu no grupo, não no #equipe');
assert.equal(falas('equipe', 'frontend').length, 0);

// ---- agente que chama outro com @ no #equipe: a resposta vai para o grupo da dupla (reaproveita o que existe)
const antes = falas('grp-1', 'backend').length;
enviar('equipe', '@Front-end [teste:mencao] veja isso');
await espera(() => falas('grp-1', 'backend').length > antes);
assert.equal(eq.grupos().length, 1, 'reaproveitou o grupo da dupla em vez de abrir outro');
assert.equal(falas('equipe', 'backend').length, 0, 'conversa entre colegas não polui o #equipe');
assert(falas('equipe', 'frontend').length >= 1, 'o chamado dela fica no #equipe (a Game Director falou ali)');

// ---- a pergunta à Game Director vai para a DM do agente
enviar('equipe', '@Front-end [teste:pergunta] qual azul?');
await espera(() => eq.perguntasAbertas().some((p) => p.de === 'frontend'));
const q = eq.perguntasAbertas().find((p) => p.de === 'frontend');
assert.equal(q.canal, 'dm:frontend', 'pergunta na DM com a Game Director');
assert(eq.historico('dm:frontend').some((m) => m.pergunta === q.id && /azul/.test(m.texto)), 'a pergunta aparece na DM do Front-end');
assert(eq.historico('equipe').some((m) => m.de === 'frontend' && /perguntei direto na minha DM/i.test(m.texto)), 'no #equipe fica só o aviso curto');
assert(!eq.historico('equipe').some((m) => m.pergunta === q.id), 'o #equipe não ganha a pergunta');
// responder cai na DM do agente
assert(eq.responder(q.id, 'Azul da marca').ok);
await espera(() => eq.historico('dm:frontend').some((m) => m.de === 'voce' && /Azul da marca/.test(m.texto)));

// ---- a mesma pergunta, agora pela P.O.: já foi decidida (ledger), então volta na hora sem abrir pergunta nova
enviar('equipe', '@P.O. [teste:pergunta] qual azul?');   // sem nome escolhido, o agente atende pelo cargo
await espera(() => eq.historico('equipe').some((m) => m.de === 'sistema' && /já foi decidido/i.test(m.texto)));
assert(!eq.perguntasAbertas().some((p) => p.de === 'po'), 'pergunta repetida não abre de novo');

// ---- dm.enviar: o agente fala direto, sem pergunta
const dmAntes = falas('dm:backend', 'backend').length;
enviar('dm:backend', '[teste:dm] como está?');
await espera(() => falas('dm:backend', 'backend').some((m) => /terminei a parte A/.test(m.texto)));
assert.equal(eq.perguntasAbertas().filter((p) => p.de === 'backend').length, 0, 'mensagem direta não abre pergunta');

// ---- a Game Director conversa dentro do grupo e encerra por lá
enviar('grp-1', '@Front-end [teste:encerrar] pode fechar');
await espera(() => eq.grupos()[0].status === 'encerrado');
assert(eq.historico('equipe').some((m) => m.de === 'sistema' && /Grupo «.*» encerrado: Formato de erro definido/.test(m.texto)), 'a finalização é anunciada no #equipe');
enviar('grp-1', '@Front-end mais uma coisa');
await new Promise((x) => setTimeout(x, 800));
assert(eq.historico('grp-1').some((m) => m.de === 'sistema' && /encerrado/.test(m.texto)));
assert.equal(falas('grp-1', 'frontend').filter((m) => /mais uma coisa/.test(m.texto)).length, 0);

eq.cancelar();
console.log('PASS: grupos de trabalho (conversa entre colegas fora do #equipe), DM direta com a Game Director, pergunta na DM do agente e finalização anunciada no #equipe.');
try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* o Windows ainda segura a pasta */ }
process.exit(0);
