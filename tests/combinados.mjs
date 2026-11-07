// Acesso total com combinados: o que a Game Director autoriza ou proíbe no pedido fica anotado com as palavras dela e vai
// para todos os agentes; pergunta sobre ação arriscada vai para ela mesmo no piloto (a liderança não decide por ela);
// @acesso_restrito / @acesso_total no pedido mudam o acesso só daquele pedido e dos cards citados.
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

// ---- captura com as palavras dela
const cb = criarCombinados({ pasta: tmp });
const novos = cb.capturar('Refaz a tela de login. Vocês podem ficar livres para instalar pacotes e mexer no banco local. Só não façam push na develop.');
assert.deepEqual(novos.map((c) => c.tipo), ['autoriza', 'proibe']);
assert(/"Só não façam push na develop\."/.test(cb.paraPrompt()) && /proibido/.test(cb.paraPrompt()));
assert.equal(cb.capturar('Refaz a tela de login.').length, 0, 'pedido comum não vira combinado');
assert.equal(cb.capturar('Só não façam push na develop.').length, 0, 'não duplica');
assert(ARRISCADA.test('apagar a tabela antiga em produção') && ARRISCADA.test('git push --force') && !ARRISCADA.test('posso usar o azul da marca ou o do tema?'));

// ---- acesso: total é o padrão; a flag do pedido manda na chamada
assert(argsClaude({}).includes('--dangerously-skip-permissions'));
assert(!argsClaude({ total: false }).some((a) => a.includes('dangerously')));
assert(argsCodex({ cwd: tmp }).includes('--dangerously-bypass-approvals-and-sandbox'));

fs.mkdirSync(path.join(tmp, 'alvo'));
const r = projetos.criar({ nome: 'Combinados', caminho: path.join(tmp, 'alvo'), template: 'software' }); assert(r.ok);
const eq = projetos.ctx(r.projeto.id).equipe;

eq.enviar({ canal: 'dm:backend', texto: 'Lucas, ajusta o endpoint. Pode instalar o que precisar. Não mexam na develop.' });
assert(await espera(() => eq.historico('dm:backend').some((m) => m.de === 'sistema' && /Anotei como combinado/.test(m.texto))), 'o app avisa o que anotou');
assert.equal(eq.combinados().length, 2);
const leve = eq.teste.montar({ agente: 'frontend', tipo: 'mencao', card: null, canalSaida: 'grp-1', instrucao: 'oi', origem: 'backend' });
assert(/Combinados com a Game Director/.test(leve.pedido) && /Não mexam na develop/.test(leve.pedido), 'todo agente recebe os combinados, até na conversa leve');
assert(/Ação arriscada/.test(leve.sistema) && /pergunte a ela/.test(leve.sistema), 'a regra de ação arriscada vai no prompt');

const quadro = projetos.ctx(r.projeto.id).quadro;
const card = quadro.criar({ titulo: 'Migrar tabela', dono: 'backend', aceite: ['tabela migrada'] }, 'po').card;
eq.enviar({ canal: 'dm:backend', texto: `${card.id} faz com cuidado @acesso_restrito` });
assert(await espera(() => quadro.obter(card.id).acesso === 'restrito'), 'a flag marca o card citado');
const restr = eq.teste.montar({ agente: 'backend', tipo: 'execucao', card: card.id, canalSaida: 'equipe', instrucao: 'faça', origem: 'po' });
assert(/## Permissões efetivas/.test(restr.sistema) && !/## Acesso e ação arriscada/.test(restr.sistema), 'card restrito recebe o prompt restrito');
eq.enviar({ canal: 'dm:backend', texto: `${card.id} pode seguir @acesso_total` });
assert(await espera(() => quadro.obter(card.id).acesso === 'total'));

// ---- piloto: pergunta comum vai para a liderança; pergunta arriscada vai para ela
await espera(() => !eq.estado?.().ocupados?.length, 3000);
eq.enviar({ canal: 'dm:frontend', texto: '[teste:pergunta] escolhe a cor' });
assert(await espera(() => eq.perguntas().some((p) => p.de === 'frontend' && p.paraPO)), 'pergunta comum: a liderança decide no piloto');
eq.enviar({ canal: 'dm:backend', texto: '[teste:pergunta-escopo] e a tabela antiga?' });
assert(await espera(() => eq.perguntas().some((p) => p.de === 'backend' && /produção/.test(p.texto))), 'pergunta arriscada abriu');
const arriscada = eq.perguntas().find((p) => p.de === 'backend' && /produção/.test(p.texto));
assert(!arriscada.paraPO, 'pergunta arriscada vai para a Game Director, não para a liderança');

await dorme(500);
try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { /* pasta temporária */ }
console.log('PASS: combinados (autorização e proibição com as palavras dela, todo agente recebe), acesso total padrão, @acesso_restrito/@acesso_total por pedido e card, pergunta arriscada vai para ela mesmo no piloto.');
process.exit(0);
