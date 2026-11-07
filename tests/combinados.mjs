// Full access with agreements: what the Game Director allows or forbids in a request is noted in the user's own words and goes
// to every agent; a question about a risky action goes to the user even on autopilot (leadership does not decide for the user);
// @acesso_restrito / @acesso_total in a request change access only for that request and the cited cards.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nectar-combinados-'));
process.env.STUDIO_DATA = path.join(tmp, 'data'); process.env.STUDIO_PROJETOS = path.join(tmp, 'projetos'); process.env.STUDIO_FAKE = '1'; process.env.STUDIO_FAKE_LOCAL = '0';
const store = await import('../lib/store.mjs');
store.gravarConfig({ piloto: { ativo: true, intervaloMin: 60, maxChamadasHora: 0, poDecide: true }, ciclo: { statusPO: false, fechamento: false, revisaoAuto: false, versionar: false, curadoriaAuto: false, planningReplica: false } });
const { criarCombinados, ARRISCADA } = await import('../lib/combinados.mjs');
const { argsClaude, argsCodex } = await import('../lib/runner.mjs');
const projetos = await import('../lib/projetos.mjs');
const dorme = (ms) => new Promise((x) => setTimeout(x, ms));
const espera = async (cond, ms = 20000) => { for (let i = 0; i < ms / 50 && !cond(); i++) await dorme(50); return cond(); };

// ---- capture in the user's own words
const cb = criarCombinados({ pasta: tmp });
const novos = cb.capturar('Refaz a tela de login. Vocês podem ficar livres para instalar pacotes e mexer no banco local. Só não façam push na develop.');
assert.deepEqual(novos.map((c) => c.tipo), ['autoriza', 'proibe']);
assert(/"Só não façam push na develop\."/.test(cb.paraPrompt()) && /proibido/.test(cb.paraPrompt()));
assert.equal(cb.capturar('Refaz a tela de login.').length, 0, 'an ordinary request does not become an agreement');
assert.equal(cb.capturar('Só não façam push na develop.').length, 0, 'no duplicate');
assert(ARRISCADA.test('apagar a tabela antiga em produção') && ARRISCADA.test('git push --force') && !ARRISCADA.test('posso usar o azul da marca ou o do tema?'));

// ---- access: full is the default; the request flag rules the call
assert(argsClaude({}).includes('--dangerously-skip-permissions'));
assert(!argsClaude({ total: false }).some((a) => a.includes('dangerously')));
assert(argsCodex({ cwd: tmp }).includes('--dangerously-bypass-approvals-and-sandbox'));

fs.mkdirSync(path.join(tmp, 'alvo'));
const r = projetos.criar({ nome: 'Combinados', caminho: path.join(tmp, 'alvo'), template: 'software' }); assert(r.ok);
const eq = projetos.ctx(r.projeto.id).equipe;

eq.enviar({ canal: 'dm:backend', texto: 'Lucas, ajusta o endpoint. Pode instalar o que precisar. Não mexam na develop.' });
assert(await espera(() => eq.historico('dm:backend').some((m) => m.de === 'sistema' && /Anotei como combinado/.test(m.texto))), 'the app reports what it noted');
assert.equal(eq.combinados().length, 2);
const leve = eq.teste.montar({ agente: 'frontend', tipo: 'mencao', card: null, canalSaida: 'grp-1', instrucao: 'oi', origem: 'backend' });
assert(/Combinados com a Game Director/.test(leve.pedido) && /Não mexam na develop/.test(leve.pedido), 'every agent receives the agreements, even in light chat');
assert(/Ação arriscada/.test(leve.sistema) && /pergunte a ela/.test(leve.sistema), 'the risky action rule goes in the prompt');

const quadro = projetos.ctx(r.projeto.id).quadro;
const card = quadro.criar({ titulo: 'Migrar tabela', dono: 'backend', aceite: ['tabela migrada'] }, 'po').card;
eq.enviar({ canal: 'dm:backend', texto: `${card.id} faz com cuidado @acesso_restrito` });
assert(await espera(() => quadro.obter(card.id).acesso === 'restrito'), 'the flag marks the cited card');
const restr = eq.teste.montar({ agente: 'backend', tipo: 'execucao', card: card.id, canalSaida: 'equipe', instrucao: 'faça', origem: 'po' });
assert(/## Permissões efetivas/.test(restr.sistema) && !/## Acesso e ação arriscada/.test(restr.sistema), 'a restricted card receives the restricted prompt');
eq.enviar({ canal: 'dm:backend', texto: `${card.id} pode seguir @acesso_total` });
assert(await espera(() => quadro.obter(card.id).acesso === 'total'));

// ---- autopilot: an ordinary question goes to leadership; a risky question goes to the user
await espera(() => !eq.estado?.().ocupados?.length, 3000);
eq.enviar({ canal: 'dm:frontend', texto: '[teste:pergunta] escolhe a cor' });
assert(await espera(() => eq.perguntas().some((p) => p.de === 'frontend' && p.paraPO)), 'ordinary question: leadership decides on autopilot');
eq.enviar({ canal: 'dm:backend', texto: '[teste:pergunta-escopo] e a tabela antiga?' });
assert(await espera(() => eq.perguntas().some((p) => p.de === 'backend' && /produção/.test(p.texto))), 'risky question opened');
const arriscada = eq.perguntas().find((p) => p.de === 'backend' && /produção/.test(p.texto));
assert(!arriscada.paraPO, 'a risky question goes to the Game Director, not to leadership');

await dorme(500);
try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { /* temp folder */ }
console.log('PASS: agreements (permission and prohibition in the user\'s words, every agent receives them), full access by default, @acesso_restrito/@acesso_total per request and card, risky question goes to the user even on autopilot.');
process.exit(0);
