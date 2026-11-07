// End to end: the team runs six cards on its own, on autopilot. Independent cards move in parallel (the autopilot used to start new
// work only when the whole team was idle, and one card starved), no card gets the same step twice, and the flow uses the minimum
// number of calls: execution, review, documentation, QA and versioning.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'work-ia-paralelo-'));
const dump = path.join(tmp, 'dump');
Object.assign(process.env, { STUDIO_DATA: path.join(tmp, 'data'), STUDIO_PROJETOS: path.join(tmp, 'projetos'), STUDIO_FAKE: '1', STUDIO_FAKE_WORKFLOW: '1', STUDIO_PROMPT_DUMP: dump });
const store = await import('../lib/store.mjs');
const cfg = store.lerConfig();
store.gravarConfig({ ...cfg, piloto: { ...cfg.piloto, ativo: true, maxChamadasHora: 0 }, ciclo: { ...cfg.ciclo, paralelo: 3 } });
const p = await import('../lib/projetos.mjs');
fs.mkdirSync(path.join(tmp, 'alvo'));
const c = p.ctx(p.criar({ nome: 'Paralelo', caminho: path.join(tmp, 'alvo'), template: 'software' }).projeto.id);
const novo = (titulo, dono, extra = {}) => c.quadro.criar({ titulo, descricao: `${titulo}: comportamento verificável.`, dono, coluna: 'pronto', aceite: ['Caminho positivo responde como esperado', 'Falha de entrada é tratada com erro claro'], validacoesObrigatorias: ['teste focado'], ...extra }, 'voce').card;
const a = novo('Modelo de dados', 'dados');
const b = novo('Rotas', 'backend', { dependeDe: [a.id] });
const d = novo('Tela', 'frontend', { dependeDe: [b.id] });
const e = novo('Auditoria', 'backend');
const f = novo('Documentar a API', 'backend', { tipoTarefa: 'documentacao' });
const g = novo('Pipeline de integração', 'pipeline', { tipoTarefa: 'infra' });
const cards = [a, b, d, e, f, g].map((x) => x.id);

let maxSimultaneos = 0; const inicio = {};
const t0 = Date.now();
const fim = () => cards.every((id) => c.quadro.obter(id)?.coluna === 'concluido');
while (!fim() && Date.now() - t0 < 90_000) {
  c.equipe.pilotoTick();
  const trabalhando = c.equipe.presencaAtual ? Object.values(c.equipe.presencaAtual()).filter((x) => x && x.estado === 'trabalhando').length : 0;
  maxSimultaneos = Math.max(maxSimultaneos, trabalhando);
  for (const id of cards) if (!inicio[id] && c.quadro.obter(id).coluna !== 'pronto') inicio[id] = Date.now() - t0;
  await new Promise((r) => setTimeout(r, 250));
}
await new Promise((r) => setTimeout(r, 4000));   // versioning starts 2.5 s after completion
for (let i = 0; i < 80 && c.equipe.ocupada(); i++) await new Promise((r) => setTimeout(r, 250));

assert(fim(), `all cards done (${cards.map((id) => `${id}:${c.quadro.obter(id).coluna}`).join(' ')})`);
assert(maxSimultaneos >= 2, `independent cards work at the same time (max concurrent: ${maxSimultaneos})`);
assert(inicio[g.id] < inicio[d.id], 'the independent card (Pipeline) does not wait for the dependency chain to finish');
const porEtapa = {};
for (const n of fs.readdirSync(dump)) {
  const txt = fs.readFileSync(path.join(dump, n), 'utf8'); const tipo = n.replace('.txt', '').split('-')[2];
  const id = (txt.match(/"id":"(T-\d+)"/) || txt.match(/card (T-\d+)/) || [])[1] || 'sem-card';
  porEtapa[`${id}/${tipo}`] = (porEtapa[`${id}/${tipo}`] || 0) + 1;
}
const duplicadas = Object.entries(porEtapa).filter(([, n]) => n > 1);
assert.deepEqual(duplicadas, [], 'no step ran twice on the same card');
for (const id of cards) for (const tipo of ['execucao', 'revisao', 'documentacao', 'qa', 'versionar']) assert.equal(porEtapa[`${id}/${tipo}`], 1, `${id} went through ${tipo} once`);
assert.equal(c.equipe.perguntasAbertas().length, 0, 'nothing stopped waiting on the Game Director');
c.equipe.cancelar(); await store.descarregar();
console.log(`PASS: parallel end to end (6 cards done unattended, up to ${maxSimultaneos} agents at once, independent card not starved, 5 calls per card and no duplicated step).`);
process.exit(0);
