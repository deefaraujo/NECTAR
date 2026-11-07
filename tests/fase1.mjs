// Fase 1 (fundação): ficha de fatos alimentada por job (medido) e por agente (relato, sem sobrescrever medição), ficha no prompt;
// ledger de respostas (pergunta repetida volta sem abrir pergunta); validação do plano rodada pelo app após a entrega;
// chamada de conversa entre colegas com contexto leve.
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
const espera = async (cond, ms = 15000) => { for (let t = 0; t < ms / 50 && !cond(); t++) await new Promise((x) => setTimeout(x, 50)); if (!cond()) { console.error(eq.historico('equipe').slice(-8).map((m) => `${m.de} ${m.status || ''} ${m.oculta ? '(oculta)' : ''}: ${(m.texto || '').replace(/\n/g, ' ').slice(0, 120)}`).join('\n')); for (const g of eq.grupos()) console.error(eq.historico(g.canal).slice(-4).map((m) => `[${g.canal}] ${m.de}: ${(m.texto || '').slice(0, 100)}`).join('\n')); } assert(cond(), 'tempo esgotado'); };
const dorme = (ms) => new Promise((x) => setTimeout(x, ms));
const todas = (canal, de) => eq.historico(canal).filter((m) => m.de === de);
const enviar = (canal, texto) => eq.enviar({ canal, texto, engine: 'claude', modo: 'conversar' });
const sistema = (re) => eq.historico('equipe').some((m) => m.de === 'sistema' && re.test(m.texto));

const card = c.quadro.criar({ titulo: 'Rodar a suíte', descricao: 'Fase 1.', dono: 'backend', coluna: 'andamento', aceite: ['Suíte verde'] }, 'voce'); assert(card.ok);
const id = card.card.id;

// ---- 1.1/1.2: o job grava um fato medido no card
enviar('equipe', `@Back-end [teste:job] roda a suíte do ${id}`);
await espera(() => sistema(/Job job-\w+ terminou com código 3/), 20000);
await dorme(300);
let f = eq.fatos.listar();
const fj = Object.entries(f.cards[id] || {}).find(([k]) => k.startsWith('job:'));
assert(fj, 'o resultado do job virou fato do card');
assert.equal(fj[1].origem, 'app'); assert(/falhou \(código 3\)/.test(fj[1].valor), fj[1].valor);

// ---- 1.1: relato do agente não sobrescreve a medição recente
enviar('equipe', `@Back-end [teste:fato-relato] ${id}`);
await espera(() => todas('equipe', 'backend').filter((m) => m.status === 'ok').length >= 2 || eq.grupos().length > 0);
await dorme(800);
f = eq.fatos.listar();
assert(/falhou/.test(f.cards[id][fj[0]].valor), 'a medição do app continua; o relato foi recusado');

// ---- 1.1: fato de projeto registrado pelo agente e presente no prompt
enviar('equipe', `@Back-end [teste:fato] e o venv?`);
await espera(() => !!eq.fatos.listar().projeto.venv);
assert.equal(eq.fatos.listar().projeto.venv.origem, 'agente');
assert(/Ficha de fatos/.test(eq.teste.montar({ agente: 'backend', tipo: 'execucao', card: id, canalSaida: 'equipe', instrucao: 'x', origem: 'po' }).pedido), 'a ficha entra no prompt');
assert(/venv = C:/.test(eq.teste.montar({ agente: 'backend', tipo: 'execucao', card: id, canalSaida: 'equipe', instrucao: 'x', origem: 'po' }).pedido));

// ---- 1.5: ledger de respostas: pergunta respondida uma vez não abre de novo
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
assert.equal(eq.perguntas().length, nAntes, 'não abriu pergunta nova');
assert(eq.perguntasAbertas().every((p) => p.de !== 'frontend'));

// ---- 1.3: validação do plano rodada pelo app depois da entrega, sem o agente rodar nada
const card2 = c.quadro.criar({ titulo: 'Entrega com validação', descricao: 'Fase 1.', dono: 'backend', coluna: 'andamento', aceite: ['Entrega registrada'], validacoesObrigatorias: [process.platform === 'win32' ? 'echo validacao-ok' : 'echo validacao-ok'] }, 'voce'); assert(card2.ok);
const id2 = card2.card.id;
enviar('equipe', `@Back-end [teste:entrega-min] entregue o ${id2}`);
await espera(() => sistema(new RegExp(`O app rodou as verificações de ${id2}`)), 20000);
const v = c.quadro.obter(id2).workflow.verificacoes.find((x) => /validacao-ok/.test(x.comando));
assert(v && v.status === 'aprovado', JSON.stringify(c.quadro.obter(id2).workflow.verificacoes));

// ---- 1.6: conversa entre colegas (sem card) usa contexto leve; trabalho em card usa o contexto inteiro
const leve = eq.teste.montar({ agente: 'backend', tipo: 'mencao', card: null, canalSaida: 'grp-9', instrucao: 'me confirma o contrato?', origem: 'frontend' });
const cheio = eq.teste.montar({ agente: 'backend', tipo: 'execucao', card: id, canalSaida: 'equipe', instrucao: 'implemente', origem: 'po' });
const tam = (p) => p.sistema.length + p.pedido.length;
assert(!/## Skills do seu cargo/.test(leve.sistema), 'conversa leve não lista skills');
assert(tam(leve) < tam(cheio) * 0.6, `leve ${tam(leve)} vs cheio ${tam(cheio)}`);

eq.cancelar();
console.log(`PASS: fase 1 (job vira fato medido, relato não sobrescreve medição, fato no prompt, ledger evita pergunta repetida, validação do plano rodada pelo app, prompt leve ${tam(leve)} vs cheio ${tam(cheio)} caracteres).`);
try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* o Windows ainda segura a pasta */ }
process.exit(0);
