// End to end on the templates without a technical workflow (Product Design, Visual Design, Games): the team runs the cards on its own, in parallel, with
// the light flow (owner produces, lead reviews, the template's QA validates), using each template's roles, with no duplicated step.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'work-ia-par-tpl-'));
const dump = path.join(tmp, 'dump');
Object.assign(process.env, { STUDIO_DATA: path.join(tmp, 'data'), STUDIO_PROJETOS: path.join(tmp, 'projetos'), STUDIO_FAKE: '1', STUDIO_FAKE_WORKFLOW: '1', STUDIO_PROMPT_DUMP: dump });
const store = await import('../lib/store.mjs');
const cfg = store.lerConfig();
store.gravarConfig({ ...cfg, piloto: { ...cfg.piloto, ativo: true, maxChamadasHora: 0 }, ciclo: { ...cfg.ciclo, paralelo: 3, statusPO: false, fechamento: false, curadoriaAuto: false } });
const p = await import('../lib/projetos.mjs');
const resumo = [];
for (const tpl of ['product-design', 'visual-graphic-design', 'jogos']) {
  fs.mkdirSync(path.join(tmp, `alvo-${tpl}`));
  const c = p.ctx(p.criar({ nome: `E2E ${tpl}`, caminho: path.join(tmp, `alvo-${tpl}`), template: tpl }).projeto.id);
  const { lead, qa } = c.elenco.papeis;
  const donos = c.elenco.ROSTER.filter((x) => !x.sistema && ![lead, qa, 'mcp', c.elenco.papeis.curador, c.elenco.papeis.creditos].includes(x.id)).slice(0, 4).map((x) => x.id);
  const cards = donos.map((dono, i) => c.quadro.criar({ titulo: `Entrega ${i + 1} de ${tpl}`, descricao: 'Entrega com critério verificável.', dono, coluna: 'pronto', aceite: ['Atende ao pedido', 'Segue o padrão do projeto'] }, 'voce').card.id);
  fs.rmSync(dump, { recursive: true, force: true });
  let maxSim = 0; const t0 = Date.now();
  const fim = () => cards.every((id) => c.quadro.obter(id).coluna === 'concluido');
  while (!fim() && Date.now() - t0 < 60_000) {
    c.equipe.pilotoTick();
    maxSim = Math.max(maxSim, Object.values(c.equipe.presencaAtual()).filter((x) => x?.estado === 'trabalhando').length);
    await new Promise((r) => setTimeout(r, 200));
  }
  for (let i = 0; i < 40 && c.equipe.ocupada(); i++) await new Promise((r) => setTimeout(r, 250));
  if (!fim()) { const av = {}; for (const m of c.equipe.historico('equipe')) for (const x of m.resumo || []) if (x.tipo === 'aviso') av[x.texto.slice(0, 120)] = (av[x.texto.slice(0, 120)] || 0) + 1; console.log('RECUSAS', JSON.stringify(av, null, 1)); console.log('HIST', c.quadro.obter(cards[0]).historico.map((h) => h.quem + ': ' + h.txt).join(' | ').slice(0, 900)); }
  assert(fim(), `${tpl}: all done (${cards.map((id) => `${id}:${c.quadro.obter(id).coluna}${c.quadro.obter(id).bloqueio ? ' BLOQ' : ''}`).join(' ')})`);
  assert(maxSim >= 2, `${tpl}: cards in parallel (max ${maxSim})`);
  const etapas = {}; const quem = {};
  for (const n of fs.readdirSync(dump)) {
    const [, ag, tipo] = n.replace('.txt', '').split('-'); const txt = fs.readFileSync(path.join(dump, n), 'utf8');
    const id = (txt.split('## Pedido agora')[1] || '').match(/card (T-\d+)/)?.[1] || 'sem-card';
    etapas[`${id}/${tipo}`] = (etapas[`${id}/${tipo}`] || 0) + 1; quem[tipo] = new Set([...(quem[tipo] || []), ag]);
    assert(c.elenco.IDS.has(ag), `${tpl}: only agents that exist in the template are called (${ag})`);
  }
  for (const id of cards) for (const tipo of ['produzir', 'revisao', 'qa']) assert.equal(etapas[`${id}/${tipo}`], 1, `${tpl}: ${id} went through ${tipo} once`);
  assert.deepEqual([...quem.revisao], [lead], `${tpl}: review belongs to the template lead (${lead})`);
  assert.deepEqual([...quem.qa], [qa], `${tpl}: QA is the template's own (${qa})`);
  resumo.push(`${tpl} ${cards.length} cards, up to ${maxSim} at once`);
  c.equipe.cancelar();
}
await store.descarregar();
console.log(`PASS: parallel on the other templates (${resumo.join('; ')}; light flow with each template's roles and no duplicated step).`);
process.exit(0);
