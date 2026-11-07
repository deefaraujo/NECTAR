// Fase 3 (camada local): o modelo local redige a fala do agente ao fim de um job e quando um card anda, extrai fatos da saída,
// tria pergunta rotineira no piloto (decide pela regra, sem chamada paga) e deixa a que pede julgamento para a liderança;
// resume o que aconteceu para quem voltou. Sem modelo local, nada disso acontece e o fluxo segue igual. Tudo simulado.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'work-ia-fase3-'));
process.env.STUDIO_DATA = path.join(tmp, 'data'); process.env.STUDIO_PROJETOS = path.join(tmp, 'projetos'); process.env.STUDIO_FAKE = '1';
const store = await import('../lib/store.mjs');
store.gravarConfig({ piloto: { ativo: true, maxChamadasHora: 0, poDecide: true, decideAposMin: 0 }, ciclo: { statusPO: false, fechamento: false, orcamento: 10, revisaoAuto: false, versionar: false }, local: { falasJobs: true, falasMotor: 'local' } });
const projetos = await import('../lib/projetos.mjs');
const local = await import('../lib/local.mjs');
fs.mkdirSync(path.join(tmp, 'alvo'));
const r = projetos.criar({ nome: 'Fase tres', caminho: path.join(tmp, 'alvo'), template: 'software' }); assert(r.ok);
const c = projetos.ctx(r.projeto.id); const eq = c.equipe;
const espera = async (cond, ms = 15000) => { for (let t = 0; t < ms / 50 && !cond(); t++) await new Promise((x) => setTimeout(x, 50)); if (!cond()) console.error(eq.historico('equipe').slice(-8).map((m) => `${m.de} ${m.status || ''}${m.local ? ' (local)' : ''}: ${(m.texto || '').replace(/\n/g, ' ').slice(0, 120)}`).join('\n')); assert(cond(), 'tempo esgotado'); };
const dorme = (ms) => new Promise((x) => setTimeout(x, ms));
const enviar = (canal, texto) => eq.enviar({ canal, texto, engine: 'claude', modo: 'conversar' });
const locais = (de) => eq.historico('equipe').filter((m) => m.local && (!de || m.de === de));
const sistema = (re) => eq.historico('equipe').some((m) => m.de === 'sistema' && re.test(m.texto));

assert.equal(await local.disponivel(), true, 'no modo de teste o local está disponível');
const card = c.quadro.criar({ titulo: 'Suíte', descricao: 'x', dono: 'backend', coluna: 'andamento', aceite: ['A suíte passa no job'] }, 'voce').card;

// ---- job: fala do agente na voz dele e fatos extraídos da saída
enviar('equipe', `@Back-end [teste:job-verde] ${card.id}`);
await espera(() => locais('backend').some((m) => /\(local\) o job "suíte verde" passou/.test(m.texto)), 20000);
await espera(() => !!(eq.fatos.listar().cards[card.id] || {})["testes-passaram"]);
const fx = eq.fatos.listar().cards[card.id];
assert.equal(fx['testes-passaram'].valor, '3'); assert.equal(fx['versao-python'].valor, '3.13.6'); assert.equal(fx['testes-passaram'].origem, 'app');

// ---- card anda: o dono comenta (local) ao começar a trabalhar
const card2 = c.quadro.criar({ titulo: 'Endpoint de saúde', descricao: 'x', dono: 'backend', coluna: 'pronto', aceite: ['GET /saude responde 200 com ok'] }, 'voce').card;
assert(c.quadro.mover(card2.id, 'andamento', 'backend', { motivo: 'Começando.' }).ok);
await espera(() => locais('backend').some((m) => /começou a trabalhar no card/.test(m.texto)));

// ---- piloto: pergunta rotineira decidida pela regra (sem chamada da liderança); a de escopo vai para a liderança
const poAntes = eq.historico('equipe').filter((m) => m.de === 'po').length;
enviar('equipe', '@Back-end [teste:pergunta-rotineira] e agora?');
await espera(() => sistema(/Decidido pela regra do piloto \(pergunta rotineira\): Rodar só os unitários/), 20000);
await dorme(1500);
assert.equal(eq.historico('equipe').filter((m) => m.de === 'po' && /Decidi no piloto/.test(m.texto)).length, 0, 'a liderança não foi chamada para a rotineira');
assert(eq.historico('dm:po').some((m) => /Pergunta rotineira decidida pela regra do piloto/.test(m.texto)), 'relato na DM da liderança');
assert(eq.perguntas().every((p) => p.estado === 'respondida' || !/integração precisa de banco/.test(p.texto)), 'a pergunta rotineira está fechada');
enviar('equipe', '@Front-end [teste:pergunta-escopo] pode?');
await espera(() => eq.perguntas().some((p) => p.de === 'frontend' && /produção/.test(p.texto)), 20000);
assert(!eq.perguntas().find((p) => p.de === 'frontend' && /produção/.test(p.texto)).paraPO, 'ação arriscada vai para a Game Director, não para a liderança');
assert(!sistema(/regra do piloto \(pergunta rotineira\): Sim, apagar/), 'a de escopo nunca é decidida pela regra');

// ---- voltou: o resumo vira prosa redigida pelo local
eq.voltou(new Date(Date.now() - 3_600_000));
await espera(() => eq.historico('equipe').some((m) => m.de === 'po' && m.local && /desde que você saiu/.test(m.texto)), 10000);

// ---- sem modelo local: nenhuma fala, e o job continua funcionando
process.env.STUDIO_FAKE_LOCAL = '0';
assert.equal(await local.disponivel(), false);
const nLocais = locais().length;
enviar('equipe', `@Back-end [teste:job-verde] de novo no ${card.id}`);
await espera(() => eq.historico('equipe').filter((m) => m.de === 'sistema' && /terminou com código 0/.test(m.texto)).length >= 2, 20000);
await dorme(1500);
assert.equal(locais().length, nLocais, 'sem local, sem fala local; o job rodou mesmo assim');

// ---- falas pelo Haiku (padrão): chamada mínima com a personalidade inteira, registrada como custo; em reserva, cai para o local
store.gravarConfig({ ...store.lerConfig(), local: { ...store.lerConfig().local, falasMotor: 'haiku' } });
const creditos = await import('../lib/creditos.mjs');
const nH = eq.historico('equipe').filter((m) => m.fala === 'haiku').length;
enviar('equipe', `@Back-end [teste:job-verde] terceira no ${card.id}`);
await espera(() => eq.historico('equipe').some((m) => m.fala === 'haiku' && /\(haiku\) o job "suíte verde" passou/.test(m.texto)), 20000);
assert(creditos.amostrasDe(r.projeto.id).some((a) => a.tipo === 'fala/backend' && /haiku/.test(a.modelo)), 'a fala do Haiku entra no custo');
process.env.STUDIO_FAKE_LOCAL = '1';
const seg = () => Math.floor(Date.now() / 1000);
creditos.registrar({ unifiedWindows: { five_hour: { utilization: 0.93, resetsAt: seg() + 1800 }, seven_day: { utilization: 0.3, resetsAt: seg() + 5 * 86400 } } });
assert(creditos.envelope('claude').reserva, 'em reserva');
enviar('equipe', `@Back-end [teste:job-verde] quarta no ${card.id}`);
await espera(() => eq.historico('equipe').filter((m) => m.fala === 'local').length > 0 && eq.historico('equipe').filter((m) => m.fala === 'haiku').length === nH + 1, 20000);
creditos.registrar({ unifiedWindows: { five_hour: { utilization: 0.1, resetsAt: seg() + 5 * 3600 }, seven_day: { utilization: 0.3, resetsAt: seg() + 5 * 86400 } } });

eq.cancelar();
console.log('PASS: fase 3 (camada local simulada: fala de job e de card na voz do agente, fatos extraídos da saída, pergunta rotineira decidida pela regra sem chamada paga, pergunta de escopo vai para a liderança, resumo ao voltar; sem local o fluxo segue igual).');
try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* o Windows ainda segura a pasta */ }
process.exit(0);
