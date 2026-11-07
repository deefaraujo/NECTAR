// Posts channel: team posts (like in Teams), @todos, Game Director posts and the final report written by the owner.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'work-ia-posts-'));
process.env.STUDIO_DATA = path.join(tmp, 'data'); process.env.STUDIO_PROJETOS = path.join(tmp, 'projetos'); process.env.STUDIO_FAKE = '1';
const png = path.join(tmp, 'print.png');
fs.writeFileSync(png, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'));
process.env.STUDIO_FAKE_IMG = png;
const store = await import('../lib/store.mjs');
store.gravarConfig({ piloto: { ativo: false, maxChamadasHora: 0 }, ciclo: { statusPO: false, fechamento: false, orcamento: 10, revisaoAuto: false, versionar: false, posts: true } });   // this test covers the document in the Posts channel, which is off by default
const projetos = await import('../lib/projetos.mjs');
fs.mkdirSync(path.join(tmp, 'alvo'));
const r = projetos.criar({ nome: 'Posts', caminho: path.join(tmp, 'alvo'), template: 'software' }); assert(r.ok);
const c = projetos.ctx(r.projeto.id); const eq = c.equipe; const q = c.quadro;
const espera = async (cond, ms = 15000) => { for (let t = 0; t < ms / 50 && !cond(); t++) await new Promise((x) => setTimeout(x, 50)); assert(cond(), 'timed out'); };
const falas = (canal, de) => eq.historico(canal).filter((m) => m.de === de && m.status === 'ok');
const enviar = (canal, texto) => eq.enviar({ canal, texto, engine: 'claude', modo: 'conversar' });

// ---- an agent posts: title, structured text, screenshot copied into the project, mentions
enviar('dm:backend', '[teste:post] publique a tela nova');
await espera(() => eq.posts().length === 1);
const p = eq.posts()[0];
assert.equal(p.autor, 'backend'); assert.equal(p.titulo, 'Nova tela de chaves'); assert.match(p.corpo, /## O que mudou/);
assert.equal(p.anexos.length, 1); assert(fs.existsSync(path.join(c.pasta, 'anexos', p.anexos[0].rel)), 'the screenshot was copied into the project');
assert.deepEqual(p.mencoes, ['frontend']);
assert.equal(falas('equipe', 'backend').length, 0, 'the post does not clutter #equipe');

// ---- whoever was mentioned sees the notice the next time they work (without being forced into a call)
enviar('dm:frontend', 'oi, tudo bem?');
await espera(() => falas('dm:frontend', 'frontend').length >= 1);
assert.match(falas('dm:frontend', 'frontend')[0].texto, /avisos/, 'the mentioned agent got the notice in context');

// ---- the Game Director reacts and comments on the post; the author replies in the post thread
assert(eq.reagirPost('p1', '👍', 'voce').ok); assert.deepEqual(eq.posts()[0].reacoes['👍'], ['voce']);
assert(eq.reagirPost('p1', '👍', 'voce').ok); assert.equal(eq.posts()[0].reacoes['👍'], undefined, 'reacting again undoes it');
assert.equal(eq.reagirPost('p1', '💣', 'voce').ok, false, 'only the channel reactions');
enviar('pst-1', 'Ficou ótimo, só falta o estado vazio.');
await espera(() => falas('pst-1', 'backend').length >= 1);
assert.equal(falas('equipe', 'backend').length, 0);
assert(eq.posts()[0].respostas >= 1 && eq.posts()[0].quem.includes('backend'));

// ---- the Game Director posts and mentions: whoever is mentioned is called; @todos calls only the P.O. and notifies the whole team
const pu = eq.publicarPostUsuario({ titulo: 'Mudança de prioridade', corpo: '## O que muda\nA partir de hoje o Demo vem antes de tudo.\n\n- @todos tenham isso em mente\n- @Back-end confirme o impacto no back', imagens: [] });
assert.equal(pu.autor, 'voce'); assert.equal(pu.todos, true); assert(pu.mencoes.includes('backend'));
await espera(() => falas('pst-2', 'backend').length >= 1 && falas('pst-2', 'po').length >= 1);
assert.equal(falas('pst-2', 'frontend').length, 0, '@todos does not call agents one by one (cost), only the P.O. coordinates');
enviar('dm:frontend', 'e agora?');
await espera(() => falas('dm:frontend', 'frontend').length >= 2);
assert.match(falas('dm:frontend', 'frontend')[1].texto, /avisos/, 'the notice for everyone reached the agent');
assert(eq.posts().find((x) => x.id === 'p2').visto.includes('frontend'), 'the post shows who has seen it');
assert(eq.posts().find((x) => x.id === 'p2').paraTodos);

// ---- @todos in a chat message also becomes a notice for the team
enviar('equipe', '@todos lembrete: freeze às 18h');
await espera(() => falas('equipe', 'po').length >= 1);
enviar('dm:backend', 'e aí?');
await espera(() => falas('dm:backend', 'backend').length >= 2);
assert.match(falas('dm:backend', 'backend').at(-1).texto, /avisos/);

// ---- final report: card done, the owner writes the document and posts it
const fluxo = (cd, acao, d, a) => q.fluxo(cd.id, acao, { revisao: cd.workflow.revisao, ...d }, a);
const ok = (x) => { assert(x.ok, x.erro); return x; };
const card = q.criar({ titulo: 'Tela de teste', descricao: 'Demanda verificável.', dono: 'backend', coluna: 'pronto', aceite: ['Funciona'] }, 'po').card;
ok(fluxo(card, 'entrega', { chave: 'e1', resumo: 'Tela de teste entregue.', arquivos: ['src/tela.tsx'], verificacoes: [{ comando: 'npx vitest', status: 'aprovado', evidencia: 'passou' }], limites: 'Nenhuma.' }, 'backend'));
ok(q.mover(card.id, 'revisao', 'backend'));
ok(fluxo(card, 'revisao', { status: 'aprovado', evidencia: 'ok' }, 'revisor')); ok(fluxo(card, 'documentacao', { status: 'sem_alteracao', evidencia: 'ok' }, 'curador'));
ok(q.mover(card.id, 'qa', 'curador')); q.atualizar(card.id, { aceiteOk: [0] }, 'qa'); ok(fluxo(card, 'qa', { status: 'aprovado', evidencia: 'ok' }, 'qa'));
ok(q.mover(card.id, 'concluido', 'qa'));
await espera(() => eq.posts().some((x) => x.card === card.id && x.relatorioFinal));
const fin = eq.posts().find((x) => x.card === card.id);
assert.equal(fin.autor, 'backend'); assert(fin.mencoes.includes('voce') && fin.mencoes.includes('frontend'), 'the agent mentioned the Game Director and a teammate');
assert.match(fin.corpo, /\| Propriedade \| Valor \|/, 'page properties, like in Notion');
assert.match(fin.corpo, /## O que mudou/); assert.match(fin.corpo, /## Fatos conferidos pelo app/);
assert.equal(fin.anexos.length, 1);
const rel = q.obter(card.id).relatorios.find((x) => x.tipo === 'final');
assert(rel.autoral, 'the card final report is the owner document');
assert.match(rel.texto, /## O que mudou/); assert.match(rel.texto, /## Fatos conferidos pelo app/); assert.match(rel.texto, /Situação: sem ressalvas/);
assert.match(rel.texto, /\| Propriedade \| Valor \|/);
assert.equal(q.obter(card.id).relatorios.filter((x) => x.tipo === 'final').length, 1, 'a single final report, not two');

// ---- through the server, as the UI does
const { iniciarServidor } = await import('../server.mjs');
const srv = await iniciarServidor({ porta: 0 });
const base = `http://127.0.0.1:${srv.porta}/api/p/${r.projeto.id}`;
const J = { 'content-type': 'application/json' };
assert((await (await fetch(`${base}/posts`)).json()).length >= 3);
assert.equal((await fetch(`${base}/posts`, { method: 'POST', headers: J, body: JSON.stringify({ titulo: 'x', corpo: '' }) })).status, 400);
const up = await (await fetch(`${base}/anexo?nome=tela.png`, { method: 'PUT', body: fs.readFileSync(png), headers: { 'content-type': 'image/png', 'x-studio-anexo': '1' } })).json();
const res = await fetch(`${base}/posts`, { method: 'POST', headers: J, body: JSON.stringify({ titulo: 'Print da tela nova', corpo: 'Segue o print. @Front-end veja o espaçamento.', imagens: [up.anexo.rel] }) });
assert.equal(res.status, 201); const np = await res.json();
assert.equal(np.autor, 'voce'); assert.equal(np.anexos.length, 1);
assert.equal((await fetch(`${base}/anexo/${np.anexos[0].rel}`)).status, 200, 'the post screenshot opens from the UI');
assert.equal((await fetch(`${base}/canal/pst-1`)).status, 200, 'the post thread has history');
assert.equal((await fetch(`${base}/canal/pst-2`)).status, 200);
assert.equal((await fetch(`${base}/posts/${np.id}/reagir`, { method: 'POST', headers: J, body: JSON.stringify({ emoji: '❤️' }) })).status, 200);

eq.cancelar();
console.log('PASS: Posts channel (agent post with screenshot, @todos and mentions, Game Director post, reactions, post thread, owner final report with Notion-style properties and app facts).');
try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* Windows may still hold the folder */ }
process.exit(0);
