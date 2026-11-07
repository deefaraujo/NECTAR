// Canal Posts: publicações do time (como no Teams), @todos, post da Game Director e relatório final escrito pelo responsável.
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
store.gravarConfig({ piloto: { ativo: false, maxChamadasHora: 0 }, ciclo: { statusPO: false, fechamento: false, orcamento: 10, revisaoAuto: false, versionar: false, posts: true } });   // este teste cobre o documento no canal Posts, que vem desligado por padrão
const projetos = await import('../lib/projetos.mjs');
fs.mkdirSync(path.join(tmp, 'alvo'));
const r = projetos.criar({ nome: 'Posts', caminho: path.join(tmp, 'alvo'), template: 'software' }); assert(r.ok);
const c = projetos.ctx(r.projeto.id); const eq = c.equipe; const q = c.quadro;
const espera = async (cond, ms = 15000) => { for (let t = 0; t < ms / 50 && !cond(); t++) await new Promise((x) => setTimeout(x, 50)); assert(cond(), 'tempo esgotado'); };
const falas = (canal, de) => eq.historico(canal).filter((m) => m.de === de && m.status === 'ok');
const enviar = (canal, texto) => eq.enviar({ canal, texto, engine: 'claude', modo: 'conversar' });

// ---- um agente publica: título, texto estruturado, print copiado para o projeto, marcações
enviar('dm:backend', '[teste:post] publique a tela nova');
await espera(() => eq.posts().length === 1);
const p = eq.posts()[0];
assert.equal(p.autor, 'backend'); assert.equal(p.titulo, 'Nova tela de chaves'); assert.match(p.corpo, /## O que mudou/);
assert.equal(p.anexos.length, 1); assert(fs.existsSync(path.join(c.pasta, 'anexos', p.anexos[0].rel)), 'o print foi copiado para dentro do projeto');
assert.deepEqual(p.mencoes, ['frontend']);
assert.equal(falas('equipe', 'backend').length, 0, 'a publicação não polui o #equipe');

// ---- quem foi marcado vê o aviso na próxima vez que trabalha (sem ser chamado à força)
enviar('dm:frontend', 'oi, tudo bem?');
await espera(() => falas('dm:frontend', 'frontend').length >= 1);
assert.match(falas('dm:frontend', 'frontend')[0].texto, /avisos/, 'o agente marcado recebeu o aviso no contexto');

// ---- a Game Director reage e conversa no post; o autor responde na conversa do post
assert(eq.reagirPost('p1', '👍', 'voce').ok); assert.deepEqual(eq.posts()[0].reacoes['👍'], ['voce']);
assert(eq.reagirPost('p1', '👍', 'voce').ok); assert.equal(eq.posts()[0].reacoes['👍'], undefined, 'reagir de novo desfaz');
assert.equal(eq.reagirPost('p1', '💣', 'voce').ok, false, 'só as reações do canal');
enviar('pst-1', 'Ficou ótimo, só falta o estado vazio.');
await espera(() => falas('pst-1', 'backend').length >= 1);
assert.equal(falas('equipe', 'backend').length, 0);
assert(eq.posts()[0].respostas >= 1 && eq.posts()[0].quem.includes('backend'));

// ---- a Game Director publica e marca: quem ela marca é chamado; @todos chama só a P.O. e avisa o time inteiro
const pu = eq.publicarPostUsuario({ titulo: 'Mudança de prioridade', corpo: '## O que muda\nA partir de hoje o Demo vem antes de tudo.\n\n- @todos tenham isso em mente\n- @Back-end confirme o impacto no back', imagens: [] });
assert.equal(pu.autor, 'voce'); assert.equal(pu.todos, true); assert(pu.mencoes.includes('backend'));
await espera(() => falas('pst-2', 'backend').length >= 1 && falas('pst-2', 'po').length >= 1);
assert.equal(falas('pst-2', 'frontend').length, 0, 'o @todos não chama um agente por um (custo), só a P.O. coordena');
enviar('dm:frontend', 'e agora?');
await espera(() => falas('dm:frontend', 'frontend').length >= 2);
assert.match(falas('dm:frontend', 'frontend')[1].texto, /avisos/, 'o aviso para todos chegou ao agente');
assert(eq.posts().find((x) => x.id === 'p2').visto.includes('frontend'), 'o post mostra quem já viu');
assert(eq.posts().find((x) => x.id === 'p2').paraTodos);

// ---- @todos numa mensagem de chat também vira aviso para o time
enviar('equipe', '@todos lembrete: freeze às 18h');
await espera(() => falas('equipe', 'po').length >= 1);
enviar('dm:backend', 'e aí?');
await espera(() => falas('dm:backend', 'backend').length >= 2);
assert.match(falas('dm:backend', 'backend').at(-1).texto, /avisos/);

// ---- relatório final: card concluído, o responsável escreve o documento e publica
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
assert.equal(fin.autor, 'backend'); assert(fin.mencoes.includes('voce') && fin.mencoes.includes('frontend'), 'o agente marcou a Game Director e um colega');
assert.match(fin.corpo, /\| Propriedade \| Valor \|/, 'propriedades da página, como no Notion');
assert.match(fin.corpo, /## O que mudou/); assert.match(fin.corpo, /## Fatos conferidos pelo app/);
assert.equal(fin.anexos.length, 1);
const rel = q.obter(card.id).relatorios.find((x) => x.tipo === 'final');
assert(rel.autoral, 'o relatório final do card é o documento do responsável');
assert.match(rel.texto, /## O que mudou/); assert.match(rel.texto, /## Fatos conferidos pelo app/); assert.match(rel.texto, /Situação: sem ressalvas/);
assert.match(rel.texto, /\| Propriedade \| Valor \|/);
assert.equal(q.obter(card.id).relatorios.filter((x) => x.tipo === 'final').length, 1, 'um relatório final só, não dois');

// ---- pelo servidor, como a tela faz
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
assert.equal((await fetch(`${base}/anexo/${np.anexos[0].rel}`)).status, 200, 'o print do post abre pela tela');
assert.equal((await fetch(`${base}/canal/pst-1`)).status, 200, 'a conversa do post tem histórico');
assert.equal((await fetch(`${base}/canal/pst-2`)).status, 200);
assert.equal((await fetch(`${base}/posts/${np.id}/reagir`, { method: 'POST', headers: J, body: JSON.stringify({ emoji: '❤️' }) })).status, 200);

eq.cancelar();
console.log('PASS: canal Posts (publicação do agente com print, @todos e marcações, post da Game Director, reações, conversa no post, relatório final do responsável com propriedades estilo Notion e fatos do app).');
try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* o Windows ainda segura a pasta */ }
process.exit(0);
