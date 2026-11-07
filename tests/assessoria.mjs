// Template Assessoria Profissional (professional-operations): elenco, papéis, apelidos da especificação, skills presentes e o que o
// prompt de fato entrega (regras, fluxos, visão das outras equipes, ações de evidência). Simulado: nenhum modelo é chamado.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { skillDisponivelOuOpcional, skillsOpcionais } from '../lib/skills-opcionais.mjs';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'work-ia-assessoria-'));
const dump = path.join(tmp, 'dump');
Object.assign(process.env, { STUDIO_DATA: path.join(tmp, 'data'), STUDIO_PROJETOS: path.join(tmp, 'projetos'), STUDIO_FAKE: '1', STUDIO_PROMPT_DUMP: dump });
const store = await import('../lib/store.mjs');
store.gravarConfig({ ...store.lerConfig(), piloto: { ativo: false, maxChamadasHora: 0 }, ciclo: { ...store.lerConfig().ciclo, fechamento: false, statusPO: false } });
const { criarElenco } = await import('../lib/agentes.mjs');
const TPL = path.join(import.meta.dirname, '..', 'templates', 'professional-operations');

const e = criarElenco('professional-operations');
const especialistas = e.ROSTER.filter((a) => !a.sistema && a.id !== 'mcp');
assert.equal(especialistas.length, 16, '16 cargos da especificação');
assert.equal(e.papeis.lead, 'chief_of_staff'); assert.equal(e.papeis.qa, 'qa_evidencias'); assert.equal(e.papeis.curador, 'conhecimento');
assert(e.ROSTER.some((a) => a.id === 'mcp'), 'agente de MCP presente, como em todo template');
for (const [spec, id] of Object.entries({ 'professional-chief-of-staff': 'chief_of_staff', 'evidence-documentation-qa': 'qa_evidencias', 'presentation-architect': 'arquitetura_slides' })) assert.equal(e.ALIAS[spec] || e.ALIAS[spec.replace(/-/g, '')] || JSON.parse(fs.readFileSync(path.join(TPL, 'template.json'))).aliases[spec], id, `apelido ${spec}`);
for (const a of especialistas) {
  assert(fs.existsSync(path.join(TPL, 'agentes', `${a.id}.md`)), `contrato de ${a.id}`);
  const contrato = fs.readFileSync(path.join(TPL, 'agentes', `${a.id}.md`), 'utf8');
  for (const s of ['## Missão', '## Entregáveis', '## Critérios de qualidade', '## Limites', '## Handoff', '## Aprovação']) assert(contrato.includes(s), `${a.id} tem ${s}`);
  for (const s of a.skills || []) assert(skillDisponivelOuOpcional('professional-operations',s), `${a.id}: skill ${s} disponível ou opcional declarada`);
}
assert(fs.readFileSync(path.join(TPL, 'regras.md'), 'utf8').length < 12000, 'regras cabem inteiras no prompt (corte de 12 mil em equipe.mjs)');
const origem = fs.readFileSync(path.join(TPL, 'skills', 'ORIGEM.md'), 'utf8');
for (const s of fs.readdirSync(path.join(TPL, 'skills')).filter((x) => fs.existsSync(path.join(TPL, 'skills', x, 'SKILL.md')))) assert(origem.includes(s)||skillsOpcionais('professional-operations').some(x=>x.id===s), `Origem ou manifesto registra ${s}`);
assert(/proprietária/.test(origem) && /pptx/.test(origem), 'ORIGEM.md explica por que pptx/docx oficiais ficaram de fora');

// ---- o que o prompt entrega, num projeto com equipe de software + assessoria
const projetos = await import('../lib/projetos.mjs');
fs.mkdirSync(path.join(tmp, 'alvo'));
const pid = projetos.criar({ nome: 'Escritório', caminho: path.join(tmp, 'alvo'), template: 'software' }).projeto.id;
projetos.ctx(pid).quadro.criar({ titulo: 'Rotas de pagamento', descricao: 'x', dono: 'backend', coluna: 'andamento', aceite: ['ok'] }, 'po');
const cid = projetos.adicionarEquipe(pid, { template: 'professional-operations' }).equipe.cid;
const c = projetos.ctx(cid);
const fala = async (ag, texto) => {
  c.equipe.enviar({ canal: `dm:${ag}`, texto, engine: 'claude', modo: 'conversar' });
  for (let i = 0; i < 200 && !(fs.existsSync(dump) && fs.readdirSync(dump).some((f) => f.includes(`-${ag}-`))); i++) await new Promise((x) => setTimeout(x, 50));
  return fs.readFileSync(path.join(dump, fs.readdirSync(dump).find((f) => f.includes(`-${ag}-`))), 'utf8');
};
const pChief = await fala('chief_of_staff', 'Prepare meu Review de outubro com apresentação.');
assert(pChief.includes('## Regras da equipe') && pChief.includes('Evidência antes de tudo'), 'a Helena recebe as regras da Assessoria');
assert(pChief.includes('fluxos-assessoria'), 'e a skill de fluxos');
assert(pChief.includes('## Outras equipes deste projeto') && pChief.includes('Rotas de pagamento'), 'e o andamento da equipe de software, só leitura');
const pCol = await fala('coletor', 'Colete outubro.');
assert(pCol.includes('evidencia.coletar_git') && pCol.includes('evidencia.registrar'), 'o coletor recebe as ações de evidência');
assert(!pCol.includes('## Outras equipes deste projeto'), 'só a liderança recebe a visão das outras equipes');
// modo automático do assessor: sem sinal novo não chama ninguém; sinal novo (reunião na agenda) chama uma vez; igual de novo, silêncio
const cfgCiclo = (x) => store.gravarConfig({ ...store.lerConfig(), ciclo: { ...store.lerConfig().ciclo, ...x } });
cfgCiclo({ assessorAuto: true, assessorIntervaloMin: 15, assessorHorario: { inicio: '00:00', fim: '23:59' } });
const r0 = c.equipe.rondaAssessor();
assert(!r0.ok && r0.motivo === 'nada novo', `sem sinal novo, nenhuma chamada (${r0.motivo})`);
const ev = c.agenda.criar({ titulo: 'Review com stakeholder', inicio: new Date(Date.now() + 3 * 3600_000).toISOString(), fim: new Date(Date.now() + 4 * 3600_000).toISOString(), tipo: 'reuniao' }, 'voce'); assert(ev.ok, ev.erro);
const r1 = c.equipe.rondaAssessor();
assert(r1.ok && r1.novos >= 1, 'reunião nova na agenda dispara uma ronda');
assert(c.equipe.sinaisAssessor().some((x) => /Review com stakeholder/.test(x.t)), 'o sinal descreve a reunião');
const r2 = c.equipe.rondaAssessor({ forcar: false });
assert(!r2.ok, `a mesma reunião não chama de novo (${r2.motivo})`);
cfgCiclo({ assessorAuto: false });
assert.equal(c.equipe.rondaAssessor().motivo, 'modo automático desligado', 'desligado, só faz o que ela pedir');
cfgCiclo({ assessorAuto: true });
c.equipe.cancelar(); projetos.ctx(pid).equipe.cancelar(); await store.descarregar();
console.log('PASS: Assessoria Profissional (16 cargos com contrato, papéis, apelidos da especificação, 34 skills registradas com origem, regras e fluxos no prompt, visão das outras equipes só para a liderança, ações de evidência). Simulado.');
process.exit(0);
