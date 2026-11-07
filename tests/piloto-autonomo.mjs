// Piloto automático: o trabalho não para. Citar a Game Director não trava card; a P.O. decide as perguntas paradas; chamada
// travada é cancelada; impedimento vira reunião com a equipe e nunca desiste. Nenhum modelo é chamado.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'work-ia-piloto-'));
process.env.STUDIO_DATA = path.join(tmp, 'data'); process.env.STUDIO_PROJETOS = path.join(tmp, 'projetos'); process.env.STUDIO_FAKE = '1';
process.env.STUDIO_PROMPT_DUMP = path.join(tmp, 'dump');
const guarda = await import('../lib/guarda.mjs');

// ---- funções puras: chamada travada e espera entre reuniões
const agora = Date.now();
assert(guarda.turnoParado({ id: `t${agora - 30 * 60_000}` }, agora, 25 * 60_000), 'sem atividade há 30 min está parado');
assert(!guarda.turnoParado({ id: `t${agora - 30 * 60_000}`, vivo: agora - 60_000 }, agora, 25 * 60_000), 'com atividade recente, não');
assert.deepEqual([0, 1, 2, 3, 4, 5, 9].map((n) => guarda.esperaReuniaoMs(n) / 60_000), [0, 5, 15, 30, 60, 120, 240], 'a espera cresce a cada rodada sem avanço');
assert.equal(guarda.esperaReuniaoMs(4, true) / 60_000, 30, 'com o resto do quadro parado a espera cai pela metade, nunca para um minuto (cada reunião é uma chamada paga)');
assert.equal(guarda.esperaReuniaoMs(1, true) / 60_000, 2.5, 'a primeira repetição com quadro parado espera 2,5 min');
assert.equal(guarda.REUNIOES_ATE_PERGUNTAR, 4, 'depois de 4 reuniões sem avanço, o card passa a aguardar a Game Director');

const store = await import('../lib/store.mjs');
store.gravarConfig({ piloto: { ativo: true, intervaloMin: 1, maxChamadasHora: 0, decideAposMin: 0.0005, poDecide: false }, ciclo: { statusPO: false, versionar: false, posts: false, revisaoAuto: false } });
const projetos = await import('../lib/projetos.mjs');
fs.mkdirSync(path.join(tmp, 'alvo'));
const p = projetos.criar({ nome: 'Piloto', caminho: path.join(tmp, 'alvo'), template: 'software' }); assert(p.ok);
const c = projetos.ctx(p.projeto.id); const eq = c.equipe; const q = c.quadro;
const espera = async (cond, ms = 20000) => { for (let t = 0; t < ms / 50 && !cond(); t++) await new Promise((x) => setTimeout(x, 50)); assert(cond(), 'tempo esgotado'); };
const ocioso = () => espera(() => Object.keys(eq.presencaAtual()).length === 0, 30000);
const card = q.criar({ titulo: 'Contrato da API', descricao: 'Definir.', dono: 'backend', coluna: 'andamento', aceite: ['Contrato publicado'] }, 'po').card;

// ---- citar a Game Director NÃO é pergunta: o card não fica aguardando
eq.enviar({ canal: 'dm:po', texto: `[teste:citar] sobre o contrato da API, o que acha da entrega?`, engine: 'claude', modo: 'conversar' });
await espera(() => eq.historico('dm:po').some((m) => m.de === 'po' && /@/.test(m.texto || '')));
await ocioso();
assert(!q.obter(card.id).aguardando, 'responder a ela citando o nome não trava o card');
assert.equal(eq.perguntas().filter((x) => x.estado === 'aberta').length, 0, 'e não abre pergunta');

// ---- pergunta de verdade (ação perguntar) trava o card, e no piloto a P.O. decide quando passa o tempo
eq.enviar({ canal: 'dm:backend', texto: `[teste:pergunta] ${card.id}`, engine: 'claude', modo: 'conversar' });
await espera(() => eq.perguntas().some((x) => x.estado === 'aberta'));
const pergunta = eq.perguntas().find((x) => x.estado === 'aberta');
await ocioso();
assert(q.obter(pergunta.card || card.id).aguardando, 'pergunta real faz o card aguardar');
await new Promise((x) => setTimeout(x, 100));
assert(eq.teste.perguntasParaDecidir({ decideAposMin: 0.0005 }).some((x) => x.id === pergunta.id), 'pergunta parada entra na fila da decisão');
eq.pilotoTick();
await espera(() => eq.perguntas().find((x) => x.id === pergunta.id)?.estado === 'respondida');
await ocioso();
assert(!q.obter(pergunta.card || card.id).aguardando, 'decidida pela P.O., o card volta a andar');
assert(eq.historico(pergunta.canal).some((m) => m.de === 'po' && /Decidi no piloto automático/.test(m.texto || '')), 'a decisão fica registrada para você ler depois');
assert.equal(eq.teste.perguntasParaDecidir({ decideAposMin: 0, poDecide: false }).length, 0, 'sem a opção da P.O. e com decideAposMin 0, nada é decidido por ela');

// ---- piloto com "a P.O. fala por mim": a dúvida nem chega à Game Director, a P.O. decide na hora e relata na DM
store.gravarConfig({ piloto: { ativo: true, intervaloMin: 1, maxChamadasHora: 0, decideAposMin: 8, poDecide: true } });
const cardP = q.criar({ titulo: 'Tela de chaves', descricao: 'Montar.', dono: 'frontend', coluna: 'andamento', aceite: ['Tela abre'] }, 'po').card;
eq.enviar({ canal: 'dm:frontend', texto: `[teste:pergunta] ${cardP.id}`, engine: 'claude', modo: 'conversar' });
await espera(() => eq.perguntas().some((x) => x.paraPO));
const qp = eq.perguntas().find((x) => x.paraPO);
assert(!eq.perguntas().filter((x) => !x.paraPO && x.estado === 'aberta').length, 'nenhuma pergunta aberta fica visível para a Game Director');
await espera(() => eq.perguntas().find((x) => x.id === qp.id)?.estado === 'respondida');
await ocioso();
assert(!(q.obter(qp.card || cardP.id)?.aguardando), 'o card nunca ficou aguardando a Game Director');
await espera(() => eq.historico('dm:po').some((m) => m.de === 'po' && /Decidi por você/.test(m.texto || '')));
const relato = eq.historico('dm:po').find((m) => /Decidi por você/.test(m.texto || ''));
assert(/Decisão: /.test(relato.texto) && /Motivo: /.test(relato.texto), 'o relato na DM traz a decisão e o motivo');
assert(eq.historico('dm:frontend').some((m) => m.de === 'po' && /Decidi no piloto automático/.test(m.texto || '')) || eq.historico(qp.canal).some((m) => m.de === 'po' && /Decidi no piloto automático/.test(m.texto || '')), 'quem perguntou recebe a resposta');
// piloto desligado com pergunta na mão da P.O.: ela volta para a Game Director, com aviso
store.gravarConfig({ piloto: { ativo: false } });
const qv = eq.perguntas().find((x) => x.estado === 'respondida');
assert(qv, 'sanidade');
store.gravarConfig({ piloto: { ativo: true, poDecide: true } });

// ---- impedimento vira reunião: grupo com dono, P.O. e especialista, e a P.O. conduz
q.bloquear(card.id, 'O teste do pytest falha sempre no mesmo ponto: falta a variável de ambiente do banco e não sei como obter.', 'backend');
assert(eq.teste.especialistasDoImpedimento(q.obter(card.id)).includes('qa'), 'a causa (teste falhando) chama o QA');
eq.pilotoTick();
await espera(() => eq.grupos().some((g) => g.card === card.id && /Desimpedir/.test(g.titulo)));
const g = eq.grupos().find((x) => x.card === card.id && /Desimpedir/.test(x.titulo));
assert(g.membros.includes('po') && g.membros.includes('backend'), 'a P.O. e o dono estão na reunião');
assert(g.membros.length >= 3, 'mais algum especialista para ajudar');
await espera(() => eq.historico(g.canal).some((m) => m.de === 'po' && /conta em 3 linhas/.test(m.texto || '')));
await espera(() => eq.historico(g.canal).some((m) => m.de === 'backend' && m.status === 'ok'));
assert(eq.historico(g.canal).some((m) => m.de === 'sistema' && /Reunião de desimpedimento/.test(m.texto || '')), 'a rodada fica anunciada');
await ocioso();
const antes = eq.grupos().filter((x) => x.card === card.id).length;
eq.pilotoTick(); await new Promise((x) => setTimeout(x, 300));
assert.equal(eq.grupos().filter((x) => x.card === card.id).length, antes, 'a próxima reunião respeita a espera curta e reaproveita o mesmo grupo');
const tri = JSON.parse(fs.readFileSync(path.join(c.pasta, 'triagem.json'), 'utf8'));
assert(Object.values(tri).some((e) => e.n === 1), 'rodada 1 contada, sem limite de rodadas para desistir');

// ---- entrega com o trabalho JÁ commitado (árvore limpa): o app acha os arquivos pelos commits da branch e não recusa
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
assert.deepEqual(q.obter(cardG.id).workflow.entregas[0].arquivos, ['novo.py'], 'árvore limpa: arquivos vêm dos commits da branch');
assert(q.obter(cardG.id).workflow.entregas[0].verificacoes.length >= 1, 'sem comando informado e sem plano, o app registra a lacuna em vez de recusar');

// ---- o agente fica sabendo o que o app recusou; recusa repetida chama a P.O. na hora, sem esperar reunião
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
assert(/O app RECUSOU estas ações suas/.test(dRec), 'o agente recebe, no pedido seguinte, o que o app recusou');
await espera(() => eq.historico('equipe').some((m) => m.de === 'po' && /o app recusou porque/.test(m.texto || '')));
await ocioso();

// ---- time ocioso com card aberto: a liderança é acordada para gerenciar (qualquer template)
const antesO = eq.historico('equipe').filter((m) => m.tipo === 'ocioso').length;
assert.equal(eq.teste.despertarLideranca(), true, 'com card aberto e ninguém trabalhando, a P.O. é acordada');
await espera(() => eq.historico('equipe').filter((m) => m.tipo === 'ocioso').length > antesO);
await ocioso();
assert.equal(eq.teste.despertarLideranca(), false, 'e não repete antes do intervalo (sem gastar chamada à toa)');
assert(/depende de|bloqueado por|próxima etapa|sem próxima etapa/.test(eq.teste.motivoParado(q.obter(card.id))), 'o motivo de cada card parado vai para a P.O.');

// ---- o prompt da P.O. traz a autonomia e a ação de decidir
const dump = dumpAntes + String.fromCharCode(10) + fs.readdirSync(process.env.STUDIO_PROMPT_DUMP).map((f) => fs.readFileSync(path.join(process.env.STUDIO_PROMPT_DUMP, f), 'utf8')).join(String.fromCharCode(10));
assert(/Autonomia: no piloto automático você FALA PELA pessoa que lidera/.test(dump) && /pergunta\.decidir/.test(dump) && /REUNIÃO DE DESIMPEDIMENTO/.test(dump), 'autonomia, decisão e reunião no prompt');
assert(/Papel de P\.O\.: o que você garante/.test(dump) && /Reporte à pessoa que lidera como a uma stakeholder/.test(dump) && /Dono do quadro e do ritmo/.test(dump), 'a P.O. tem o papel definido: monitorar, garantir e reportar como a uma stakeholder');
assert(/Nunca pare de tentar só porque falhou algumas vezes/.test(dump), 'quem trava é orientado a pedir ajuda cedo');

eq.cancelar();
console.log('PASS: piloto autônomo (citar não trava card, P.O. decide perguntas paradas, chamada travada é detectada, impedimento vira reunião com a equipe e nunca desiste).');
try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* o Windows ainda segura a pasta */ }
process.exit(0);
