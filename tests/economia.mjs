// Economia de tokens: o que o app faz sozinho, o que não deixa repetir e o que não chama o agente à toa. Nenhum modelo é chamado.
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
assert.equal(store.CONFIG_PADRAO.ciclo.fechamento, false, 'a P.O. não fecha todo pedido por padrão');
assert.equal(store.CONFIG_PADRAO.ciclo.pontosMax, 5); assert.equal(store.CONFIG_PADRAO.ciclo.limpezaHoras, 5);
const projetos = await import('../lib/projetos.mjs');
fs.mkdirSync(path.join(tmp, 'alvo'));
const r = projetos.criar({ nome: 'Economia', caminho: path.join(tmp, 'alvo'), template: 'software' }); assert(r.ok);
const c = projetos.ctx(r.projeto.id); const eq = c.equipe; const q = c.quadro;
const espera = async (cond, ms = 15000) => { for (let t = 0; t < ms / 50 && !cond(); t++) await new Promise((x) => setTimeout(x, 50)); assert(cond(), 'tempo esgotado'); };
const falas = (canal, de) => eq.historico(canal).filter((m) => m.de === de && m.status === 'ok');
const enviar = (canal, texto) => eq.enviar({ canal, texto, engine: 'claude', modo: 'conversar' });

// ---- o pedido é dividido: parte fixa (system prompt, em cache) e parte variável
const { argsClaude } = await import('../lib/runner.mjs');
assert(argsClaude({ sistemaArq: 'C:/x/sis.txt' }).join(' ').includes('--append-system-prompt-file C:/x/sis.txt'), 'o CLI recebe a parte fixa por arquivo');
assert(!argsClaude({}).join(' ').includes('--append-system-prompt-file'));

// ---- "Sem novidade", fala repetida e rotina curta não aparecem nem custam conversa
enviar('dm:backend', '[teste:semnovidade] como está?');
await espera(() => eq.historico('dm:backend').some((m) => m.de === 'backend' && m.oculta));
assert.equal(falas('dm:backend', 'backend').filter((m) => m.texto).length, 0, '"Sem novidade." fica oculto');
enviar('dm:backend', '[teste:longo] resuma');
await espera(() => falas('dm:backend', 'backend').some((m) => /migração do banco/.test(m.texto)));
const longo = falas('dm:backend', 'backend').find((m) => /migração do banco/.test(m.texto)).texto;
const rotina = { agente: 'backend', tipo: 'mencao', origem: 'sistema' };
assert.equal(eq.teste.silencio('dm:backend', rotina, longo), true, 'a mesma fala de novo é suprimida');
assert.equal(eq.teste.silencio('dm:backend', rotina, 'Mudou: agora o contrato aceita paginação por cursor e o front precisa ajustar a listagem das chaves.'), false, 'fala nova passa');
assert.equal(eq.teste.silencio('dm:backend', { agente: 'backend', tipo: 'pedido', origem: 'voce' }, longo), false, 'quando a Game Director pergunta, sempre responde');
assert.equal(eq.teste.silencio('dm:backend', rotina, 'Sem novidade.'), true);
assert(eq.teste.cortar('Primeira frase curta. ' + 'Palavra longa '.repeat(80), 200).endsWith('(detalhes no card e no relatório)'));
assert.equal(eq.teste.precisaDaPO('Entrega registrada e verificada.', [], []), false, 'aviso de rotina não chama a P.O.');
assert.equal(eq.teste.precisaDaPO('Posso usar o azul da marca?', [], []), true, 'dúvida chama a P.O.');
assert.equal(eq.teste.precisaDaPO('Pronto.', [{ tipo: 'card', acao: 'bloqueou' }], []), true, 'bloqueio chama a P.O.');

// ---- tarefa pequena: o app recusa card grande e aceita o de 5 pontos
enviar('dm:po', '[teste:grande] crie as tarefas');
await espera(() => q.listar().some((x) => x.titulo === 'Tarefa média de teste'));
assert(!q.listar().some((x) => x.titulo === 'Tarefa enorme de teste'), 'card de 8 pontos foi recusado');
assert.equal(q.listar().find((x) => x.titulo === 'Tarefa média de teste').pontos, 5);

// ---- entrega só com o resumo: o app descobre arquivos, branch e commit pelo Git e prepara as verificações
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
assert.deepEqual([...f.entregas[0].arquivos].sort(), ['base.txt', 'tela.tsx'], 'os arquivos vieram do Git do worktree, não do agente');
assert.equal(f.checkpoint.branch, 'ticket-teste'); assert(/^[0-9a-f]{7,}$/.test(f.checkpoint.commit), 'branch e commit vieram do Git');
assert(/^ent-/.test(f.entregas[0].chave), 'a chave foi criada pelo app');
assert(f.verificacoes.some((v) => v.comando === 'npx vitest' && v.obrigatoria && (v.status === 'nao_executado' || /executado pelo app/.test(v.evidencia))), 'as verificações do plano são do app, não do agente');

// ---- falas e entregas não geram relatório no card; só a conclusão gera (curto), e sem aviso no chat
enviar('dm:backend', `[teste:longo] ${card.id} atualize`); enviar('dm:backend', `[teste:semnovidade] ${card.id}`);
await new Promise((x) => setTimeout(x, 1500));
assert.equal((q.obter(card.id).relatorios || []).length, 0, 'fala e entrega de agente não viram relatório anexado ao card');
assert(!eq.historico('equipe').some((m) => m.tipo === 'relatorio_tarefa' && /atividade/i.test(m.texto || '')), 'o app não avisa mais cada relatório automático no chat');

// ---- QA aprovou: os critérios de aceite ficam cumpridos sem outra ação, e o card segue
const q2 = q.criar({ titulo: 'QA sem aceite manual', descricao: 'Demanda verificável.', dono: 'backend', coluna: 'pronto', aceite: ['Funciona', 'Falha tratada'] }, 'po').card;
const ok = (x) => { assert(x.ok, x.erro); return x; };
ok(q.fluxo(q2.id, 'entrega', { revisao: 0, chave: 'e1', resumo: 'Pronto.', arquivos: ['a.mjs'], verificacoes: [{ comando: 'node t.mjs', status: 'aprovado', evidencia: 'passou' }], limites: 'Nenhuma.' }, 'backend'));
ok(q.mover(q2.id, 'revisao', 'backend'));
ok(q.fluxo(q2.id, 'revisao', { revisao: 1, status: 'aprovado', evidencia: 'ok' }, 'revisor')); ok(q.fluxo(q2.id, 'documentacao', { revisao: 1, status: 'sem_alteracao', evidencia: 'ok' }, 'curador'));
ok(q.mover(q2.id, 'qa', 'curador'));
assert(q.obter(q2.id).aceite.every((a) => !a.ok), 'ninguém marcou o aceite ainda');
enviar('dm:qa', `[teste:qa] valide ${q2.id}`);
await espera(() => q.obter(q2.id).coluna === 'concluido');
assert(q.obter(q2.id).aceite.every((a) => a.ok), 'o QA aprovou e o aceite foi marcado pelo app');

// ---- limpeza de contexto: depois do marco, o pedido dos agentes não leva a conversa velha (a Game Director continua vendo tudo)
for (let i = 0; i < 4; i++) { enviar('dm:frontend', `mensagem antiga número ${i} sobre o carrossel da tela`); await espera(() => falas('dm:frontend', 'frontend').length >= i + 1); }
fs.writeFileSync(path.join(c.pasta, 'limpeza.json'), JSON.stringify({ ultima: Date.now() - 6 * 3_600_000 }));
eq.guarda.tick();
await espera(() => eq.historico('dm:frontend').some((m) => m.marco));
assert(eq.historico('dm:frontend').some((m) => /mensagem antiga número 0/.test(m.texto || '')), 'a conversa antiga continua visível para a Game Director');
fs.rmSync(process.env.STUDIO_PROMPT_DUMP, { recursive: true, force: true });
enviar('dm:frontend', 'e agora, como fica?');
await espera(() => fs.existsSync(process.env.STUDIO_PROMPT_DUMP) && fs.readdirSync(process.env.STUDIO_PROMPT_DUMP).some((f) => f.includes('frontend')));
const dump = fs.readdirSync(process.env.STUDIO_PROMPT_DUMP).filter((f) => f.includes('frontend')).map((f) => fs.readFileSync(path.join(process.env.STUDIO_PROMPT_DUMP, f), 'utf8')).join('\n');
assert(!/mensagem antiga número 0/.test(dump), 'o pedido não leva a conversa de antes do marco');
assert(/e agora, como fica\?/.test(dump), 'mas leva a pergunta nova');

eq.cancelar();
console.log('PASS: economia (pedido em duas partes, fala repetida e "Sem novidade" ocultas, P.O. só chamada para decisão, card máximo de 5 pontos, entrega só com o resumo preenchida pelo Git, relatório automático único, aceite pelo QA e limpeza de contexto).');
try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* o Windows ainda segura a pasta */ }
process.exit(0);
