// Leadership with full control: the app finds an agent in a loop (no model) and calls the P.O./lead, who asks the agent,
// requests a review or help, hands the card over or stops the agent. No model is called.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'work-ia-lider-'));
process.env.STUDIO_DATA = path.join(tmp, 'data'); process.env.STUDIO_PROJETOS = path.join(tmp, 'projetos'); process.env.STUDIO_FAKE = '1';
process.env.STUDIO_PROMPT_DUMP = path.join(tmp, 'dump');
const { analisarAgentes } = await import('../lib/guarda.mjs');
const agora = Date.now(); const iso = (min) => new Date(agora - min * 60_000).toISOString();

// ---- loop signals, found by the app
const cards = [{ id: 'C-1', titulo: 'Contrato', coluna: 'andamento', dono: 'backend', workflow: { revisao: 1 } }, { id: 'C-2', titulo: 'Tela', coluna: 'andamento', dono: 'frontend', workflow: { revisao: 4 } }, { id: 'C-3', titulo: 'Pausado', coluna: 'impedimento', dono: 'qa', bloqueioPor: 'voce', workflow: { revisao: 5 } }];
const fala = 'Tentei rodar o teste do contrato de novo e ele falhou no mesmo ponto da conexão com o banco de dados local.';
const s = analisarAgentes({
  despachos: [{ card: 'C-1', agente: 'backend', tipo: 'execucao', status: 'erro', tentativas: 3 }, { card: 'C-3', agente: 'qa', tipo: 'qa', status: 'erro', tentativas: 3 }],
  msgs: [
    ...[1, 2, 3].map((i) => ({ id: `e${i}`, de: 'dados', status: 'erro', texto: 'timeout ao conectar', em: iso(10 * i) })),
    ...[1, 2, 3].map((i) => ({ id: `r${i}`, de: 'uiux', status: 'ok', card: 'C-2', texto: fala + (i === 2 ? ' De novo.' : ''), em: iso(5 * i) })),
    { id: 'velha', de: 'dados', status: 'erro', texto: 'antiga', em: iso(60 * 5) },
  ],
  cards, presenca: { pipeline: { estado: 'trabalhando', desde: agora - 50 * 60_000 } }, ignorar: ['po'],
});
const tipos = (t) => s.filter((x) => x.tipo === t);
assert.equal(tipos('loop').length, 1, 'three attempts without progress become a signal');
assert.equal(tipos('loop')[0].agente, 'backend');
assert(!s.some((x) => x.card === 'C-3'), 'a card the Game Director blocked is excluded');
assert.equal(tipos('erros')[0]?.agente, 'dados', 'repeated error in the last 3 h');
assert.equal(tipos('repetindo')[0]?.agente, 'uiux', 'near-identical message about the same card');
assert.equal(tipos('retrabalho')[0]?.card, 'C-2', 'card coming back several times');
assert.equal(tipos('longo')[0]?.agente, 'pipeline', 'call too long');

// ---- in the project: the app round calls the P.O. to supervise, and the P.O. acts with the leadership tools
const store = await import('../lib/store.mjs');
store.gravarConfig({ piloto: { ativo: true, maxChamadasHora: 0 }, ciclo: { statusPO: false, versionar: false, posts: false } });
const projetos = await import('../lib/projetos.mjs');
fs.mkdirSync(path.join(tmp, 'alvo'));
const p = projetos.criar({ nome: 'Lider', caminho: path.join(tmp, 'alvo'), template: 'software' }); assert(p.ok);
const c = projetos.ctx(p.projeto.id); const eq = c.equipe; const q = c.quadro;
const espera = async (cond, ms = 15000) => { for (let t = 0; t < ms / 50 && !cond(); t++) await new Promise((x) => setTimeout(x, 50)); assert(cond(), 'timed out'); };
const ocioso = () => espera(() => Object.keys(eq.presencaAtual()).length === 0, 30000);
const card = q.criar({ titulo: 'Contrato da API', descricao: 'Definir.', dono: 'backend', coluna: 'andamento', aceite: ['Contrato publicado'] }, 'po').card;

// the P.O. asks the agent: opens a follow-up for just the two, the agent explains and tags the P.O.
eq.enviar({ canal: 'dm:po', texto: `[teste:lider-perguntar] [card:${card.id}] veja o Lucas`, engine: 'claude', modo: 'conversar' });
await espera(() => eq.grupos().some((g) => /Acompanhamento: Back-end/.test(g.titulo)));
const gA = eq.grupos().find((g) => /Acompanhamento/.test(g.titulo));
await espera(() => eq.historico(gA.canal).some((m) => m.de === 'backend' && /variável de ambiente/.test(m.texto || '')));
assert(eq.historico(gA.canal).some((m) => m.de === 'po' && /o que está travando/.test(m.texto || '')), 'the P.O. question stays in the follow-up');

await ocioso();
// review: another specialist gives a second opinion without taking over
eq.enviar({ canal: 'dm:po', texto: `[teste:lider-avaliar] [card:${card.id}]`, engine: 'claude', modo: 'conversar' });
await espera(() => eq.grupos().some((g) => g.card === card.id && g.membros.includes('architect')));
const gV = eq.grupos().find((g) => g.card === card.id && g.membros.includes('architect'));   // there is a single conversation per card
assert(gV.membros.includes('architect') && gV.membros.includes('backend'), 'reviewer and owner in the same group');
await espera(() => eq.historico(gV.canal).some((m) => m.de === 'architect' && /Avaliei/.test(m.texto || '')));
assert.equal(q.obter(card.id).dono, 'backend', 'reviewing does not change the owner');

await ocioso();
// help: joins the card as a collaborator
eq.enviar({ canal: 'dm:po', texto: `[teste:lider-ajudar] [card:${card.id}]`, engine: 'claude', modo: 'conversar' });
await espera(() => (q.obter(card.id).participantes || []).some((x) => x.agente === 'dados' && x.papel === 'colabora'));

await ocioso();
// take over: changes the owner and resets the attempts, so the app calls again
eq.enviar({ canal: 'dm:po', texto: `[teste:lider-assumir] [card:${card.id}]`, engine: 'claude', modo: 'conversar' });
await espera(() => q.obter(card.id).dono === 'integracoes');
assert(eq.historico('equipe').some((m) => /passou .* de Back-end para/.test(m.texto || '')));

await ocioso();
// stop: only leadership can; and stopping an agent does not suspend the team
eq.enviar({ canal: 'dm:frontend', texto: '[teste:lider-intruso] parar', engine: 'claude', modo: 'conversar' });
await espera(() => eq.historico('dm:frontend').some((m) => m.de === 'frontend' && m.status === 'ok'));
assert(!eq.historico('equipe').some((m) => /parou Back-end|parou Front-end/.test(m.texto || '')), 'a non-leader cannot stop anyone');
await ocioso();
eq.enviar({ canal: 'dm:po', texto: '[teste:lider-parar]', engine: 'claude', modo: 'conversar' });
await espera(() => eq.historico('equipe').some((m) => /parou Back-end: em loop/.test(m.texto || '')));

await ocioso();
// the P.O. request carries the leadership block and the tools
const dump = fs.readdirSync(process.env.STUDIO_PROMPT_DUMP).filter((f) => f.includes('po')).map((f) => fs.readFileSync(path.join(process.env.STUDIO_PROMPT_DUMP, f), 'utf8')).join('\n');
assert(/Liderança: coordene o fluxo dentro do mandato autorizado/.test(dump) && /lider\.designar/.test(dump), 'the P.O. coordinates within its mandate and has the tools');
eq.cancelar();
console.log('PASS: leadership (loop signals, repeated error, circular messages, rework and long call with no model; the P.O. asks, requests review or help, hands over the card and stops the agent; only leadership can).');
try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* Windows still holds the folder */ }
process.exit(0);
