// Fase 6 (excelência): métricas calculadas pelo app (lead time, custo e chamadas por ponto, retrabalho, evidência falsa, decisões
// revertidas), fechamento do card com custo real contra estimado, playbooks por cargo, e o replay da "noite do merge":
// um card com plano de três passos em três domínios sai com poucas chamadas, sem a liderança despachar, sem fala vazia.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'work-ia-fase6-'));
process.env.STUDIO_DATA = path.join(tmp, 'data'); process.env.STUDIO_PROJETOS = path.join(tmp, 'projetos'); process.env.STUDIO_FAKE = '1'; process.env.STUDIO_FAKE_LOCAL = '0';
const store = await import('../lib/store.mjs');
store.gravarConfig({ piloto: { ativo: true, maxChamadasHora: 0, poDecide: true }, ciclo: { statusPO: false, fechamento: false, orcamento: 10, revisaoAuto: false, versionar: false, curadoriaAuto: false } });
const creditos = await import('../lib/creditos.mjs');
const projetos = await import('../lib/projetos.mjs');
const dorme = (ms) => new Promise((x) => setTimeout(x, ms));
const RAIZ = path.resolve(import.meta.dirname, '..');

// ---- playbooks por cargo nos templates
for (const [t, ag] of [['software', 'po'], ['software', 'backend'], ['software', 'versionamento'], ['software', 'pipeline'], ['software', 'dados'], ['software', 'qa'], ['software', 'revisor'], ['software', 'frontend'], ['visual-graphic-design', 'lider_criativo'], ['visual-graphic-design', 'designer_grafico'], ['jogos', 'developer'], ['product-design', 'orquestrador'], ['professional-operations', 'chief_of_staff']]) {
  const p = path.join(RAIZ, 'templates', t, 'playbooks', `${ag}.md`);
  assert(fs.existsSync(p) && /pronto/i.test(fs.readFileSync(p, 'utf8')), `playbook ${t}/${ag} existe e diz o que é "pronto"`);
}

// ---- replay da noite do merge: card com plano em três domínios, piloto ligado, ninguém despacha
fs.mkdirSync(path.join(tmp, 'alvo'));
const r = projetos.criar({ nome: 'Replay', caminho: path.join(tmp, 'alvo'), template: 'software' }); assert(r.ok);
const c = projetos.ctx(r.projeto.id); const eq = c.equipe;
const pid = r.projeto.id;
const card = c.quadro.criar({ titulo: 'Mergear branches T-* na branch do ticket', descricao: 'Merge das branches do ticket numa só, sem tocar na develop.', dono: 'backend', coluna: 'pronto', aceite: ['A branch do ticket contém os commits das T-* e git grep de marcadores de conflito volta vazio'] }, 'voce').card;
assert(c.quadro.atualizar(card.id, { plano: [
  { titulo: 'Merge de teste e merge real das T-* na branch do ticket', dono: 'versionamento', saida: 'HEAD final registrado na ficha, sem marcador de conflito' },
  { titulo: 'Rodar a suíte por job no HEAD final', dono: 'pipeline', saida: 'números medidos na ficha' },
  { titulo: 'Corrigir o que a suíte apontar e registrar a entrega', dono: 'backend', saida: 'card.entrega com verde medido' },
] }, 'voce').ok);
const antes = creditos.amostrasDe(pid).length;
assert(eq.pilotoTick({ forcar: true }));
for (let i = 0; i < 300 && !(c.quadro.obter(card.id).plano || []).every((p) => p.status === 'feito'); i++) { await dorme(200); if (!eq.ocupada()) eq.pilotoTick({ forcar: true }); }
assert((c.quadro.obter(card.id).plano || []).every((p) => p.status === 'feito'), 'os três passos foram feitos');
eq.cancelar();
const chamadas = creditos.amostrasDe(pid).length - antes;
const hist = eq.historico('equipe');
const poFalas = hist.filter((m) => m.de === 'po' && m.status === 'ok' && !m.oculta).length;
const vazias = hist.filter((m) => m.de !== 'voce' && m.de !== 'sistema' && m.status === 'ok' && !m.oculta && !(m.texto || '').trim()).length;
const ordem = ['versionamento', 'pipeline', 'backend'].map((a) => hist.findIndex((m) => m.de === a && /Fiz o passo/.test(m.texto)));
assert(ordem[0] < ordem[1] && ordem[1] < ordem[2], `os passos saíram na ordem do plano: ${ordem}`);
assert(chamadas <= 8, `a noite do merge custou ${chamadas} chamadas (meta: até 8; a de verdade custou 243)`);
assert(poFalas <= 2, `a liderança falou ${poFalas} vezes (meta: até 2; a de verdade foram 84)`);
assert.equal(vazias, 0, 'nenhuma mensagem vazia');
assert.equal((c.quadro.obter(card.id).workflow.ressalvas || []).filter((x) => x.id.startsWith('txt-')).length, 0, 'nenhuma ressalva fabricada de frase');

// ---- métricas calculadas pelo app
// custo e qualidade de cards concluídos (sintético), evidência falsa e decisão revertida
const c2 = c.quadro.criar({ titulo: 'Concluído de teste', descricao: 'x', dono: 'backend', coluna: 'pronto', aceite: ['GET /y responde 200 com ok'], pontos: 2 }, 'voce').card;
creditos.registrarTarefa({ engine: 'claude', modelo: 'claude-sonnet-5-5', esforco: 'low', tipo: 'feature/execucao', pontos: 2, projeto: pid, card: c2.id, agente: 'backend', resultado: { tokens: { entrada: 200_000, saida: 10_000, cache: 0, criacaoCache: 0 }, duracaoMs: 1000 } });
// leve: o card chega a concluído pelo caminho humano (a Game Director), e o fechamento registra custo real contra estimado
const alvo2 = path.join(tmp, 'alvo2'); fs.mkdirSync(alvo2);
const rj = projetos.criar({ nome: 'Jogo', caminho: alvo2, template: 'jogos' }); assert(rj.ok);
const cj = projetos.ctx(rj.projeto.id);
const cardJ = cj.quadro.criar({ titulo: 'Cena 1', descricao: 'x', dono: 'developer', coluna: 'andamento', aceite: ['A cena 1 abre e mostra o menu inicial'], pontos: 3 }, 'voce').card;
creditos.registrarTarefa({ engine: 'claude', modelo: 'claude-sonnet-5-5', esforco: 'low', tipo: 'produzir/developer', pontos: 3, projeto: rj.projeto.id, card: cardJ.id, agente: 'developer', resultado: { tokens: { entrada: 300_000, saida: 10_000, cache: 0, criacaoCache: 0 }, duracaoMs: 1000 } });
cj.quadro.atualizar(cardJ.id, { aceiteOk: [0], evidencias: ['Cena 1 abre e mostra o menu (conferido no build)'] }, 'voce');
for (const col of ['revisao', 'qa', 'concluido']) { const mv = cj.quadro.mover(cardJ.id, col, 'voce', { motivo: 'Validado.' }); assert(mv.ok, `mover para ${col}: ${mv.erro}`); }
await dorme(300);
const fx = cj.equipe.fatos.listar().cards[cardJ.id] || {};
assert(fx['custo-final'] && /^1\.05 \(estimado/.test(fx['custo-final'].valor), JSON.stringify(fx));
assert(cj.quadro.obter(cardJ.id).comentarios.some((k) => k.quem === 'creditos' && /Fechamento: custou 1\.05/.test(k.texto)), 'o fechamento está no card');
// evidência falsa: o app mediu, o agente relatou outra coisa
const eqj = cj.equipe;
eqj.fatos.registrar({ escopo: cardJ.id, chave: 'testes', valor: '10 passed' });
// (registrar via API do equipe é relato; para ter medição, usa-se o módulo direto)
const { criarFatos } = await import('../lib/fatos.mjs');
const fz = criarFatos({ pasta: cj.pasta });
assert(fz.registrar({ escopo: cardJ.id, chave: 'suite', valor: '10 passed', por: 'sistema', origem: 'app' }).ok);
assert.equal(fz.registrar({ escopo: cardJ.id, chave: 'suite', valor: '12 passed', por: 'developer', origem: 'agente' }).ok, false, 'relato que contradiz medição é recusado');
assert.equal(fz.estatisticas().recusados, 1);
// decisão revertida: a regra decidiu A, você respondeu B depois
eqj.ledger.registrarResposta({ pergunta: 'Qual cor do menu?', resposta: 'Azul', por: 'regra do piloto (local)', card: cardJ.id, de: 'developer' });
eqj.ledger.registrarResposta({ pergunta: 'Qual cor do menu?', resposta: 'Verde', por: 'Você', card: cardJ.id, de: 'developer' });
const m = eqj.metricas(30);
assert.equal(m.cardsConcluidos, 1); assert.equal(m.decisoes.porOutros, 1); assert.equal(m.decisoes.revertidas, 1); assert.equal(m.decisoes.taxa, 100);
assert(m.chamadas >= 1 && m.custoTotal >= 1.05, JSON.stringify({ chamadas: m.chamadas, custo: m.custoTotal }));
assert(m.custoPorPonto !== null && Math.abs(m.custoPorPonto - 0.35) < 0.01, `custo por ponto ${m.custoPorPonto}`);
assert(/## Métricas dos últimos 30 dias/.test(m.texto) && /Lead time/.test(m.texto) && /Evidência falsa/.test(m.texto) && /Decisões tomadas/.test(m.texto));
assert(m.porAgente.some((a) => a.agente === 'developer'));

eqj.cancelar();
console.log(`PASS: fase 6 (playbooks por cargo, replay da noite do merge com ${chamadas} chamadas e ${poFalas} falas da liderança, fechamento do card com custo real contra estimado, métricas: lead time, custo/chamadas por ponto, retrabalho, evidência falsa, decisões revertidas).`);
try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* o Windows ainda segura a pasta */ }
process.exit(0);
