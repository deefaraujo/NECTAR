// Ponta a ponta: o time toca seis cards sozinho, em piloto automático. Cards independentes andam em paralelo (antes o piloto só começava
// trabalho novo com o time inteiro parado, e um card passava fome), nenhum card recebe a mesma etapa duas vezes e o fluxo usa o mínimo
// de chamadas: execução, revisão, documentação, QA e versionamento.
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
await new Promise((r) => setTimeout(r, 4000));   // o versionamento começa 2,5 s depois da conclusão
for (let i = 0; i < 80 && c.equipe.ocupada(); i++) await new Promise((r) => setTimeout(r, 250));

assert(fim(), `todos os cards concluídos (${cards.map((id) => `${id}:${c.quadro.obter(id).coluna}`).join(' ')})`);
assert(maxSimultaneos >= 2, `cards independentes trabalham ao mesmo tempo (máximo simultâneo: ${maxSimultaneos})`);
assert(inicio[g.id] < inicio[d.id], 'o card independente (Pipeline) não espera a cadeia de dependências terminar');
const porEtapa = {};
for (const n of fs.readdirSync(dump)) {
  const txt = fs.readFileSync(path.join(dump, n), 'utf8'); const tipo = n.replace('.txt', '').split('-')[2];
  const id = (txt.match(/"id":"(T-\d+)"/) || txt.match(/card (T-\d+)/) || [])[1] || 'sem-card';
  porEtapa[`${id}/${tipo}`] = (porEtapa[`${id}/${tipo}`] || 0) + 1;
}
const duplicadas = Object.entries(porEtapa).filter(([, n]) => n > 1);
assert.deepEqual(duplicadas, [], 'nenhuma etapa rodou duas vezes no mesmo card');
for (const id of cards) for (const tipo of ['execucao', 'revisao', 'documentacao', 'qa', 'versionar']) assert.equal(porEtapa[`${id}/${tipo}`], 1, `${id} passou uma vez por ${tipo}`);
assert.equal(c.equipe.perguntasAbertas().length, 0, 'nada parou esperando a Game Director');
c.equipe.cancelar(); await store.descarregar();
console.log(`PASS: paralelo ponta a ponta (6 cards concluídos sozinhos, até ${maxSimultaneos} agentes ao mesmo tempo, card independente sem fome, 5 chamadas por card e nenhuma etapa duplicada).`);
process.exit(0);
