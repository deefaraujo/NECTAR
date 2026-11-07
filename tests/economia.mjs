// Token savings: what the app does on its own, what it prevents from repeating and what avoids calling the agent needlessly. No model is called.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'work-ia-eco-'));
process.env.STUDIO_DATA = path.join(tmp, 'data'); process.env.STUDIO_PROJETOS = path.join(tmp, 'projetos'); process.env.STUDIO_FAKE = '1';
process.env.STUDIO_PROMPT_DUMP = path.join(tmp, 'dump');
const store = await import('../lib/store.mjs');
store.gravarConfig({ piloto: { ativo: false, maxChamadasHora: 0 }, ciclo: { statusPO: false, orcamento: 10, revisaoAuto: false, versionar: false, posts: false } });
assert.equal(store.CONFIG_PADRAO.ciclo.fechamento, false, 'the P.O. does not close every request by default');
assert.equal(store.CONFIG_PADRAO.ciclo.pontosMax, 5); assert.equal(store.CONFIG_PADRAO.ciclo.limpezaHoras, 5);
const projetos = await import('../lib/projetos.mjs');
fs.mkdirSync(path.join(tmp, 'alvo'));
const r = projetos.criar({ nome: 'Economia', caminho: path.join(tmp, 'alvo'), template: 'software' }); assert(r.ok);
const c = projetos.ctx(r.projeto.id); const eq = c.equipe; const q = c.quadro;
const espera = async (cond, ms = 15000) => { for (let t = 0; t < ms / 50 && !cond(); t++) await new Promise((x) => setTimeout(x, 50)); assert(cond(), 'timed out'); };
const falas = (canal, de) => eq.historico(canal).filter((m) => m.de === de && m.status === 'ok');
const enviar = (canal, texto) => eq.enviar({ canal, texto, engine: 'claude', modo: 'conversar' });

// ---- the request is split: a fixed part (system prompt, cached) and a variable part
const { argsClaude } = await import('../lib/runner.mjs');
assert(argsClaude({ sistemaArq: 'C:/x/sis.txt' }).join(' ').includes('--append-system-prompt-file C:/x/sis.txt'), 'the CLI receives the fixed part through a file');
assert(!argsClaude({}).join(' ').includes('--append-system-prompt-file'));

// ---- "Sem novidade", repeated messages and short routine do not show up or cost conversation
enviar('dm:backend', '[teste:semnovidade] como está?');
await espera(() => eq.historico('dm:backend').some((m) => m.de === 'backend' && m.oculta));
assert.equal(falas('dm:backend', 'backend').filter((m) => m.texto).length, 0, '"Sem novidade." stays hidden');
enviar('dm:backend', '[teste:longo] resuma');
await espera(() => falas('dm:backend', 'backend').some((m) => /migração do banco/.test(m.texto)));
const longo = falas('dm:backend', 'backend').find((m) => /migração do banco/.test(m.texto)).texto;
const rotina = { agente: 'backend', tipo: 'mencao', origem: 'sistema' };
assert.equal(eq.teste.silencio('dm:backend', rotina, longo), true, 'the same message again is suppressed');
assert.equal(eq.teste.silencio('dm:backend', rotina, 'Mudou: agora o contrato aceita paginação por cursor e o front precisa ajustar a listagem das chaves.'), false, 'a new message goes through');
assert.equal(eq.teste.silencio('dm:backend', { agente: 'backend', tipo: 'pedido', origem: 'voce' }, longo), false, 'when the Game Director asks, it always answers');
assert.equal(eq.teste.silencio('dm:backend', rotina, 'Sem novidade.'), true);
assert(eq.teste.cortar('Primeira frase curta. ' + 'Palavra longa '.repeat(80), 200).endsWith('(detalhes no card e no relatório)'));
assert.equal(eq.teste.precisaDaPO('Entrega registrada e verificada.', [], []), false, 'a routine notice does not call the P.O.');
assert.equal(eq.teste.precisaDaPO('Posso usar o azul da marca?', [], []), true, 'a question calls the P.O.');
assert.equal(eq.teste.precisaDaPO('Pronto.', [{ tipo: 'card', acao: 'bloqueou' }], []), true, 'a block calls the P.O.');

// ---- small task: the app rejects a big card and accepts the 5-point one
enviar('dm:po', '[teste:grande] crie as tarefas');
await espera(() => q.listar().some((x) => x.titulo === 'Tarefa média de teste'));
assert(!q.listar().some((x) => x.titulo === 'Tarefa enorme de teste'), '8-point card was rejected');
assert.equal(q.listar().find((x) => x.titulo === 'Tarefa média de teste').pontos, 5);

// ---- delivery with only a summary: the app finds files, branch and commit through Git and prepares the checks
const wt = path.join(tmp, 'worktree'); fs.mkdirSync(wt);
const git = (...a) => execFileSync('git', ['-C', wt, ...a], { stdio: 'ignore' });
git('init', '-q', '-b', 'ticket-teste'); git('config', 'user.email', 't@t'); git('config', 'user.name', 't');
fs.writeFileSync(path.join(wt, 'base.txt'), 'base'); git('add', '.'); git('commit', '-q', '-m', 'base');
fs.writeFileSync(path.join(wt, 'tela.tsx'), 'nova'); fs.writeFileSync(path.join(wt, 'base.txt'), 'mudou');
const card = q.criar({ titulo: 'Entrega mínima', descricao: 'Demanda verificável.', dono: 'backend', coluna: 'andamento', aceite: ['Funciona'], validacoesObrigatorias: ['npx vitest'] }, 'po').card;
assert(q.fluxo(card.id, 'checkpoint', { revisao: 0, resumo: 'Começando.', proximoPasso: 'Implementar.', worktree: wt }, 'backend').ok);
enviar('dm:backend', `[teste:entrega-min] ${card.id}`);
await espera(() => (q.obter(card.id).workflow.revisao || 0) === 1);
const f = q.obter(card.id).workflow;
assert.deepEqual([...f.entregas[0].arquivos].sort(), ['base.txt', 'tela.tsx'], 'the files came from the worktree Git, not from the agent');
assert.equal(f.checkpoint.branch, 'ticket-teste'); assert(/^[0-9a-f]{7,}$/.test(f.checkpoint.commit), 'branch and commit came from Git');
assert(/^ent-/.test(f.entregas[0].chave), 'the key was created by the app');
assert(f.verificacoes.some((v) => v.comando === 'npx vitest' && v.obrigatoria && (v.status === 'nao_executado' || /executado pelo app/.test(v.evidencia))), 'the plan checks belong to the app, not the agent');

// ---- messages and deliveries do not create a card report; only completion does (short), with no chat notice
enviar('dm:backend', `[teste:longo] ${card.id} atualize`); enviar('dm:backend', `[teste:semnovidade] ${card.id}`);
await new Promise((x) => setTimeout(x, 1500));
assert.equal((q.obter(card.id).relatorios || []).length, 0, 'agent messages and deliveries do not become a report attached to the card');
assert(!eq.historico('equipe').some((m) => m.tipo === 'relatorio_tarefa' && /atividade/i.test(m.texto || '')), 'the app no longer announces each automatic report in chat');

// ---- QA approved: acceptance criteria are met with no other action, and the card moves on
const q2 = q.criar({ titulo: 'QA sem aceite manual', descricao: 'Demanda verificável.', dono: 'backend', coluna: 'pronto', aceite: ['Funciona', 'Falha tratada'] }, 'po').card;
const ok = (x) => { assert(x.ok, x.erro); return x; };
ok(q.fluxo(q2.id, 'entrega', { revisao: 0, chave: 'e1', resumo: 'Pronto.', arquivos: ['a.mjs'], verificacoes: [{ comando: 'node t.mjs', status: 'aprovado', evidencia: 'passou' }], limites: 'Nenhuma.' }, 'backend'));
ok(q.mover(q2.id, 'revisao', 'backend'));
ok(q.fluxo(q2.id, 'revisao', { revisao: 1, status: 'aprovado', evidencia: 'ok' }, 'revisor')); ok(q.fluxo(q2.id, 'documentacao', { revisao: 1, status: 'sem_alteracao', evidencia: 'ok' }, 'curador'));
ok(q.mover(q2.id, 'qa', 'curador'));
assert(q.obter(q2.id).aceite.every((a) => !a.ok), 'nobody has checked acceptance yet');
enviar('dm:qa', `[teste:qa] valide ${q2.id}`);
await espera(() => q.obter(q2.id).coluna === 'concluido');
assert(q.obter(q2.id).aceite.every((a) => a.ok), 'QA approved and acceptance was checked by the app');

// ---- context cleanup: after the milestone, agent requests do not carry the old chat (the Game Director still sees everything)
for (let i = 0; i < 4; i++) { enviar('dm:frontend', `mensagem antiga número ${i} sobre o carrossel da tela`); await espera(() => falas('dm:frontend', 'frontend').length >= i + 1); }
fs.writeFileSync(path.join(c.pasta, 'limpeza.json'), JSON.stringify({ ultima: Date.now() - 6 * 3_600_000 }));
eq.guarda.tick();
await espera(() => eq.historico('dm:frontend').some((m) => m.marco));
assert(eq.historico('dm:frontend').some((m) => /mensagem antiga número 0/.test(m.texto || '')), 'the old chat stays visible to the Game Director');
fs.rmSync(process.env.STUDIO_PROMPT_DUMP, { recursive: true, force: true });
enviar('dm:frontend', 'e agora, como fica?');
await espera(() => fs.existsSync(process.env.STUDIO_PROMPT_DUMP) && fs.readdirSync(process.env.STUDIO_PROMPT_DUMP).some((f) => f.includes('frontend')));
const dump = fs.readdirSync(process.env.STUDIO_PROMPT_DUMP).filter((f) => f.includes('frontend')).map((f) => fs.readFileSync(path.join(process.env.STUDIO_PROMPT_DUMP, f), 'utf8')).join('\n');
assert(!/mensagem antiga número 0/.test(dump), 'the request does not carry the chat from before the milestone');
assert(/e agora, como fica\?/.test(dump), 'but carries the new question');

eq.cancelar();
console.log('PASS: savings (two-part request, repeated messages and "Sem novidade" hidden, P.O. called only for decisions, 5-point card max, summary-only delivery filled from Git, single automatic report, acceptance by QA and context cleanup).');
try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* Windows still holds the folder */ }
process.exit(0);
