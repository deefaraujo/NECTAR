// Regressão dos dois loops que gastaram crédito na Assessoria em 01/11: (1) o fluxo leve chamava o dono de novo a cada poucos
// segundos para um card cujo aceite já estava cumprido (a chave do despacho mudava a cada anotação no histórico); (2) a rodada
// de liderança do piloto repetia a cada 30 s com o quadro igual, e a resposta "Nada a fazer agora." ainda aparecia no #equipe.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'work-ia-loops-'));
process.env.STUDIO_DATA = path.join(tmp, 'data');
process.env.STUDIO_PROJETOS = path.join(tmp, 'projetos');
process.env.STUDIO_FAKE = '1';
process.env.STUDIO_PILOTO_INTERVALO_MS = '1';
const store = await import('../lib/store.mjs');
store.gravarConfig({ piloto: { ativo: true, maxChamadasHora: 0 }, ciclo: { orcamento: 2, fechamento: false, statusPO: false, revisaoAuto: false, curadoriaAuto: false, briefing: false } });
const projetos = await import('../lib/projetos.mjs');
const espera = async (fn, ms = 6000) => { const t0 = Date.now(); while (!fn()) { if (Date.now() - t0 > ms) assert.fail('tempo esgotado'); await new Promise((r) => setTimeout(r, 60)); } };
fs.mkdirSync(path.join(tmp, 'alvo'));
const criado = projetos.criar({ nome: 'Escritório', caminho: path.join(tmp, 'alvo'), template: 'software' }); assert(criado.ok, criado.erro);
const pid = criado.projeto.id;
const cid = projetos.adicionarEquipe(pid, { template: 'professional-operations' }).equipe.cid;
const c = projetos.ctx(cid); const eq = c.equipe; const lead = 'chief_of_staff';
const falas = (de, tipo) => eq.historico('equipe').filter((m) => m.de === de && (!tipo || m.tipo === tipo));

// ---- (1) produção terminada vai para Revisão sozinha, sem chamar o dono de novo
const k = c.quadro.criar({ titulo: 'Achar datas da sprint', descricao: 'Listar as issues da sprint.', dono: 'coletor', coluna: 'andamento', aceite: ['Tabela com as issues da sprint, com chave e status'] }, lead); assert(k.ok);
for (const a of c.quadro.obter(k.card.id).aceite) a.ok = true;
assert.equal(c.quadro.obter(k.card.id).coluna, 'andamento');
eq.pilotoTick({ forcar: true });
await espera(() => c.quadro.obter(k.card.id).coluna === 'revisao');
await new Promise((r) => setTimeout(r, 1500)); eq.pilotoTick(); await new Promise((r) => setTimeout(r, 800));
assert.equal(falas('coletor', 'produzir').length, 0, 'o dono não é chamado para produzir o que já cumpriu o aceite');
assert(eq.historico('equipe').some((m) => m.de === 'sistema' && /cumpriu o aceite/.test(m.texto)), 'o app anuncia a passagem para Revisão');
eq.cancelar(); await new Promise((r) => setTimeout(r, 300));

// ---- (2) rodada da liderança: uma vez por mudança no quadro, e "Nada a fazer agora." não aparece
c.quadro.mover(k.card.id, 'concluido', 'voce', { forcar: true });
const b = c.quadro.criar({ titulo: 'Mapear páginas do Notion', descricao: 'Mapear as páginas ligadas às issues.', dono: 'conhecimento', coluna: 'backlog', aceite: ['Lista das páginas com link e dona de cada uma'] }, lead); assert(b.ok);
const antes = falas(lead, 'piloto').length;
eq.cancelar(); assert(eq.pilotoTick({ forcar: true }), 'com o quadro mudado, a liderança é chamada uma vez');
await espera(() => eq.historico('equipe').some((m) => m.de === lead && m.tipo === 'piloto' && m.status !== 'trabalhando'));
for (let i = 0; i < 8; i++) { await new Promise((r) => setTimeout(r, 120)); assert.equal(eq.pilotoTick(), false, `com o quadro igual, nenhuma nova rodada (tentativa ${i + 1})`); }
const depois = falas(lead, 'piloto');
assert.equal(depois.length - antes, 1, 'só uma rodada de liderança para o mesmo quadro');
assert(depois.every((m) => !/^nada a fazer/i.test(m.texto || '') || m.oculta), '"Nada a fazer agora." não aparece como mensagem no #equipe');
void b;
console.log('PASS: sem loops de crédito (aceite cumprido vai para Revisão sem nova chamada ao dono; rodada da liderança só quando o quadro muda; "nada a fazer" fica em silêncio).');
process.exit(0);
