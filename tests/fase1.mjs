// Phase 1 (foundation): fact sheet fed by jobs (measured) and by agents (reported, never overwriting a measurement), sheet in the prompt;
// answer ledger (a repeated question is answered without opening a question); plan validation run by the app after delivery;
// colleague-to-colleague chat calls with light context.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'work-ia-fase1-'));
process.env.STUDIO_DATA = path.join(tmp, 'data'); process.env.STUDIO_PROJETOS = path.join(tmp, 'projetos'); process.env.STUDIO_FAKE = '1';
const store = await import('../lib/store.mjs');
store.gravarConfig({ piloto: { ativo: false, maxChamadasHora: 0 }, ciclo: { statusPO: false, fechamento: false, orcamento: 10, revisaoAuto: false, versionar: false } });
const projetos = await import('../lib/projetos.mjs');
fs.mkdirSync(path.join(tmp, 'alvo'));
const r = projetos.criar({ nome: 'Fase um', caminho: path.join(tmp, 'alvo'), template: 'software' }); assert(r.ok);
const c = projetos.ctx(r.projeto.id);
const eq = c.equipe;
const espera = async (cond, ms = 15000) => { for (let t = 0; t < ms / 50 && !cond(); t++) await new Promise((x) => setTimeout(x, 50)); if (!cond()) { console.error(eq.historico('equipe').slice(-8).map((m) => `${m.de} ${m.status || ''} ${m.oculta ? '(oculta)' : ''}: ${(m.texto || '').replace(/\n/g, ' ').slice(0, 120)}`).join('\n')); for (const g of eq.grupos()) console.error(eq.historico(g.canal).slice(-4).map((m) => `[${g.canal}] ${m.de}: ${(m.texto || '').slice(0, 100)}`).join('\n')); } assert(cond(), 'timed out'); };
const dorme = (ms) => new Promise((x) => setTimeout(x, ms));
const todas = (canal, de) => eq.historico(canal).filter((m) => m.de === de);
const enviar = (canal, texto) => eq.enviar({ canal, texto, engine: 'claude', modo: 'conversar' });
const sistema = (re) => eq.historico('equipe').some((m) => m.de === 'sistema' && re.test(m.texto));

const card = c.quadro.criar({ titulo: 'Rodar a suíte', descricao: 'Fase 1.', dono: 'backend', coluna: 'andamento', aceite: ['Suíte verde'] }, 'voce'); assert(card.ok);
const id = card.card.id;

// ---- 1.1/1.2: the job writes a measured fact to the card
enviar('equipe', `@Back-end [teste:job] roda a suíte do ${id}`);
await espera(() => sistema(/Job job-\w+ terminou com código 3/), 20000);
await dorme(300);
let f = eq.fatos.listar();
const fj = Object.entries(f.cards[id] || {}).find(([k]) => k.startsWith('job:'));
assert(fj, 'the job result became a card fact');
assert.equal(fj[1].origem, 'app'); assert(/falhou \(código 3\)/.test(fj[1].valor), fj[1].valor);

// ---- 1.1: an agent report does not overwrite the recent measurement
enviar('equipe', `@Back-end [teste:fato-relato] ${id}`);
await espera(() => todas('equipe', 'backend').filter((m) => m.status === 'ok').length >= 2 || eq.grupos().length > 0);
await dorme(800);
f = eq.fatos.listar();
assert(/falhou/.test(f.cards[id][fj[0]].valor), 'the app measurement stands; the report was rejected');

// ---- 1.1: project fact recorded by the agent and present in the prompt
enviar('equipe', `@Back-end [teste:fato] e o venv?`);
await espera(() => !!eq.fatos.listar().projeto.venv);
assert.equal(eq.fatos.listar().projeto.venv.origem, 'agente');
assert(/Ficha de fatos/.test(eq.teste.montar({ agente: 'backend', tipo: 'execucao', card: id, canalSaida: 'equipe', instrucao: 'x', origem: 'po' }).pedido), 'the fact sheet goes into the prompt');
assert(/venv = C:/.test(eq.teste.montar({ agente: 'backend', tipo: 'execucao', card: id, canalSaida: 'equipe', instrucao: 'x', origem: 'po' }).pedido));

// ---- 1.5: answer ledger: a question answered once does not open again
enviar('equipe', '@Front-end [teste:pergunta] qual azul?');
await espera(() => eq.perguntasAbertas().some((p) => p.de === 'frontend'));
const q = eq.perguntasAbertas().find((p) => p.de === 'frontend');
assert(eq.responder(q.id, 'Azul da marca').ok);
await espera(() => eq.perguntasAbertas().every((p) => p.id !== q.id));
await dorme(1500);
const nAntes = eq.perguntas().length;
enviar('equipe', '@Front-end [teste:pergunta] qual azul?');
await espera(() => sistema(/já foi decidido/i), 15000);
await dorme(800);
assert.equal(eq.perguntas().length, nAntes, 'no new question was opened');
assert(eq.perguntasAbertas().every((p) => p.de !== 'frontend'));

// ---- 1.3: plan validation run by the app after delivery, without the agent running anything
const card2 = c.quadro.criar({ titulo: 'Entrega com validação', descricao: 'Fase 1.', dono: 'backend', coluna: 'andamento', aceite: ['Entrega registrada'], validacoesObrigatorias: [process.platform === 'win32' ? 'echo validacao-ok' : 'echo validacao-ok'] }, 'voce'); assert(card2.ok);
const id2 = card2.card.id;
enviar('equipe', `@Back-end [teste:entrega-min] entregue o ${id2}`);
await espera(() => sistema(new RegExp(`O app rodou as verificações de ${id2}`)), 20000);
const v = c.quadro.obter(id2).workflow.verificacoes.find((x) => /validacao-ok/.test(x.comando));
assert(v && v.status === 'aprovado', JSON.stringify(c.quadro.obter(id2).workflow.verificacoes));

// ---- 1.6: colleague chat (no card) uses light context; card work uses the full context
const leve = eq.teste.montar({ agente: 'backend', tipo: 'mencao', card: null, canalSaida: 'grp-9', instrucao: 'me confirma o contrato?', origem: 'frontend' });
const cheio = eq.teste.montar({ agente: 'backend', tipo: 'execucao', card: id, canalSaida: 'equipe', instrucao: 'implemente', origem: 'po' });
const tam = (p) => p.sistema.length + p.pedido.length;
assert(!/## Skills do seu cargo/.test(leve.sistema), 'light chat does not list skills');
assert(tam(leve) < tam(cheio) * 0.6, `light ${tam(leve)} vs full ${tam(cheio)}`);

eq.cancelar();
console.log(`PASS: phase 1 (job becomes a measured fact, report does not overwrite measurement, fact in the prompt, ledger avoids repeated question, plan validation run by the app, light prompt ${tam(leve)} vs full ${tam(cheio)} characters).`);
try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* Windows still holds the folder */ }
process.exit(0);
