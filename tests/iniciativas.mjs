// Iniciativas do assessor (Fase 1 do ASSESSOR 2.0): máquina de estados fechada, chave idempotente, concluir só com evidência,
// expiração, limite de chamadas; ronda abre iniciativas por sinal e respeita modo, categorias e horário; aprovação pela Game Director.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'work-ia-ini-'));
process.env.STUDIO_DATA = path.join(tmp, 'data'); process.env.STUDIO_PROJETOS = path.join(tmp, 'projetos'); process.env.STUDIO_FAKE = '1';
const { criarIniciativas, TRANSICOES, ESTADOS } = await import('../lib/iniciativas.mjs');

// ---- unidade
const pasta = path.join(tmp, 'eq'); fs.mkdirSync(pasta, { recursive: true });
const eventos = [];
const I = criarIniciativas({ pasta, emitir: (e) => eventos.push(e.tipo), projetoId: 'p', validarEntregavel: id => fs.existsSync(path.join(pasta,id)) });
for (const [de, paras] of Object.entries(TRANSICOES)) for (const p of paras) assert(ESTADOS.includes(p) && ESTADOS.includes(de), `transição ${de}→${p} usa estados válidos`);
const a = I.criar({ titulo: 'Preparar review de sexta', motivo: 'reunião na agenda', chave: 'agenda:ev-1:2026-11-07', categoria: 'agenda' }); assert(a.ok && a.iniciativa.estado === 'detected');
const a2 = I.criar({ titulo: 'Preparar review de sexta (de novo)', chave: 'agenda:ev-1:2026-11-07' }); assert(a2.ok && a2.repetida && a2.iniciativa.id === a.iniciativa.id, 'mesma chave não vira segunda iniciativa');
assert(!I.transicionar(a.iniciativa.id, 'completed').ok, 'não pula de detectada para concluída');
assert(I.transicionar(a.iniciativa.id, 'evaluating', { quem: 'chief_of_staff' }).ok);
assert(I.transicionar(a.iniciativa.id, 'planning').ok && I.transicionar(a.iniciativa.id, 'running').ok);
const semEvid = I.transicionar(a.iniciativa.id, 'completed'); assert(!semEvid.ok && /entregável|evidência|card/.test(semEvid.erro), 'concluir exige algo verificável');
assert(I.vincular(a.iniciativa.id, { entregaveis: ['entregas/2026-11-07-review/apresentacao.pptx'], agentes: ['design_slides'] }).ok);
assert(!I.transicionar(a.iniciativa.id,'completed').ok,'caminho sozinho não comprova a existência da entrega');
fs.mkdirSync(path.join(pasta,'entregas/2026-11-07-review'),{recursive:true});fs.writeFileSync(path.join(pasta,'entregas/2026-11-07-review/apresentacao.pptx'),'fixture de existência; não comprova conteúdo PPTX');
assert(I.transicionar(a.iniciativa.id, 'completed', { quem: 'chief_of_staff' }).ok, 'com entregável, conclui');
assert(!I.transicionar(a.iniciativa.id, 'running').ok, 'concluída não volta');
const b = I.criar({ titulo: 'Teste de limite', chave: 'x:1', limiteChamadas: 2 }); I.transicionar(b.iniciativa.id, 'evaluating'); I.transicionar(b.iniciativa.id, 'planning'); I.transicionar(b.iniciativa.id, 'running');
I.registrarChamada(b.iniciativa.id, 3); assert.equal(I.obter(b.iniciativa.id).estado, 'blocked', 'passou do limite de chamadas: bloqueia');
const c = I.criar({ titulo: 'Velha', chave: 'x:2' }); assert.equal(I.expirar(24, Date.now() + 25 * 3_600_000), 1, 'detectada há mais de 24 h expira'); assert.equal(I.obter(c.iniciativa.id).estado, 'expired');
assert(eventos.includes('iniciativas'), 'cada mudança emite evento para a tela');
const I2 = criarIniciativas({ pasta, projetoId: 'p' }); await new Promise((r) => setTimeout(r, 400)); const { descarregar } = await import('../lib/store.mjs'); await descarregar();
const I3 = criarIniciativas({ pasta, projetoId: 'p' }); assert(I3.listar().length >= 3, 'persistido em disco'); void I2;

// ---- integração: ronda do assessor abre iniciativas por sinal; aprovação pela Game Director; catch-up
const store = await import('../lib/store.mjs');
const cfgCiclo = (x) => store.gravarConfig({ ...store.lerConfig(), piloto: { ...store.lerConfig().piloto, ativo: false }, ciclo: { ...store.lerConfig().ciclo, ...x } });
cfgCiclo({ assessorAuto: true, assessorIntervaloMin: 15, assessorHorario: { inicio: '00:00', fim: '23:59' }, assessorCategorias: { agenda: true, jira: true, equipes: true, quadro: true, perguntas: true, custos: false }, briefing: false, fechamento: false, statusPO: false });
const projetos = await import('../lib/projetos.mjs');
fs.mkdirSync(path.join(tmp, 'alvo'));
const pid = projetos.criar({ nome: 'Escritório', caminho: path.join(tmp, 'alvo'), template: 'software' }).projeto.id;
const cid = projetos.adicionarEquipe(pid, { template: 'professional-operations' }).equipe.cid;
const cx = projetos.ctx(cid); const eq = cx.equipe;
assert.equal(eq.rondaAssessor().motivo, 'nada novo', 'sem sinal, nenhuma chamada');
cfgCiclo({ assessorCategorias: { agenda: false, jira: true, equipes: true, quadro: true, perguntas: true, custos: false } });
cx.agenda.criar({ titulo: 'Review com stakeholder', inicio: new Date(Date.now() + 3 * 3600_000).toISOString(), fim: new Date(Date.now() + 4 * 3600_000).toISOString(), tipo: 'reuniao' }, 'voce');
assert.equal(eq.rondaAssessor().motivo, 'nada novo', 'categoria agenda desligada: a reunião não acorda o assessor');
cfgCiclo({ assessorCategorias: { agenda: true, jira: true, equipes: true, quadro: true, perguntas: true, custos: false }, assessorHorario: { inicio: '03:00', fim: '03:01' } });
assert.equal(eq.rondaAssessor().motivo, 'fora do horário', 'fora do horário não toma iniciativa');
cfgCiclo({ assessorHorario: { inicio: '00:00', fim: '23:59' } });
const r1 = eq.rondaAssessor(); assert(r1.ok && r1.iniciativas.length === 1, 'com a agenda ligada, abre uma iniciativa para a reunião');
const ini = eq.iniciativas.obter(r1.iniciativas[0]); assert.equal(ini.estado, 'detected'); assert.equal(ini.categoria, 'agenda');
assert(!eq.rondaAssessor().ok, 'o mesmo sinal não abre outra');
// aprovação: proposta vira pergunta; "aprovar" pela caixa muda o estado e resolve a pergunta
eq.iniciativas.transicionar(ini.id, 'evaluating', { quem: 'chief_of_staff' }); eq.iniciativas.transicionar(ini.id, 'proposed', { quem: 'chief_of_staff' });
const dec = eq.decidirIniciativa(ini.id, 'aprovar'); assert(dec.ok && dec.iniciativa.estado === 'queued', 'aprovada entra na fila para a liderança executar');
const neg = eq.iniciativas.criar({ titulo: 'Outra', chave: 'x:9' }); eq.iniciativas.transicionar(neg.iniciativa.id, 'evaluating'); eq.iniciativas.transicionar(neg.iniciativa.id, 'proposed');
assert.equal(eq.decidirIniciativa(neg.iniciativa.id, 'cancelar').iniciativa.estado, 'cancelled', 'recusada cancela');
assert.equal(eq.iniciativas.resumo().aguardandoVoce, 0);
// catch-up calculado, sem modelo
const rd = eq.resumoDesde(new Date(Date.now() - 3600_000).toISOString());
assert(Array.isArray(rd.cards) && Array.isArray(rd.iniciativas) && rd.iniciativas.some((i) => i.id === ini.id), 'o resumo traz as iniciativas ativas');
eq.cancelar(); projetos.ctx(pid).equipe.cancelar(); await store.descarregar();
console.log('PASS: iniciativas do assessor (máquina de estados, chave idempotente, concluir só com evidência, limite e expiração; ronda por categoria e horário; aprovação pela Game Director; catch-up calculado).');
process.exit(0);
