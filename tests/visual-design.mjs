// Creative & Visual Design Studio template: registration, 25 roles with contracts, routing of visual requests, workflows,
// gates, collaboration, memory isolation between projects and tolerant delivery (the "Cada verificação precisa..." loop).
// SIMULATED tests: no model or external tool (Figma, Adobe, image generation) is called.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { skillDisponivelOuOpcional } from '../lib/skills-opcionais.mjs';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'work-ia-visual-'));
process.env.STUDIO_DATA = path.join(tmp, 'data'); process.env.STUDIO_PROJETOS = path.join(tmp, 'projetos'); process.env.STUDIO_FAKE = '1';
process.env.STUDIO_PROMPT_DUMP = path.join(tmp, 'dump');
const raiz = new URL('../templates/visual-graphic-design/', import.meta.url);
const tj = JSON.parse(fs.readFileSync(new URL('template.json', raiz), 'utf8'));
const { listarTemplates, criarElenco } = await import('../lib/agentes.mjs');

// ---- registration and the 25 roles
assert(listarTemplates().some((t) => t.id === 'visual-graphic-design'), 'template registered');
const SPEC = ['creative-design-lead', 'brand-strategist', 'visual-cultural-researcher', 'design-thinking-facilitator', 'creative-campaign-strategist', 'art-director', 'brand-identity-designer', 'graphic-designer', 'typography-lettering-specialist', 'editorial-designer', 'information-presentation-designer', 'packaging-graphic-designer', 'environmental-graphic-designer', 'illustrator-concept-artist', 'character-mascot-designer', 'surface-pattern-designer', 'photography-retouch-specialist', '3d-visualization-artist', 'motion-designer', 'storyboard-2d-animation-specialist', 'social-media-designer', 'content-strategist-copywriter', 'print-prepress-specialist', 'visual-qa-brand-auditor', 'asset-production-specialist'];
assert.deepEqual(tj.agentes.filter((a) => a.idEspecificacao).map((a) => a.idEspecificacao), SPEC, 'the 25 roles from the spec, in order');
assert(tj.agentes.some((a) => a.id === 'mcp') && tj.agentes.some((a) => a.id === 'creditos'));
for (const a of tj.agentes) {
  assert(/^[a-z_]+$/.test(a.id), `id ${a.id} accepted by the app`);
  for (const s of a.skills) assert(skillDisponivelOuOpcional('visual-graphic-design',s), `${a.id}: skill ${s} available or declared optional`);
  if (a.idEspecificacao) {
    const p = fs.readFileSync(new URL(`agentes/${a.id}.md`, raiz), 'utf8');
    for (const k of ['Objetivo:', 'Responsabilidades:', 'Entregáveis:', 'Regras do cargo:', 'Colabora com:', 'Entrada:', 'Handoff:', 'Aprovação:']) assert(p.includes(k), `${a.id}: contract has ${k}`);
  }
}
assert.equal(tj.papeis.lead, 'lider_criativo'); assert.equal(tj.papeis.qa, 'qa_visual');

// ---- routing: visual requests reach the right specialist (via @ of the role or nickname)
const e = criarElenco('visual-graphic-design');
const rota = (t) => e.mencoes(t).agentes;
assert.deepEqual(rota('@logo'), ['identidade_marca']); assert.deepEqual(rota('@grafica'), ['preimpressao']); assert.deepEqual(rota('@mascote'), ['personagens']);
assert.deepEqual(rota('@carrossel'), ['social_media']); assert.deepEqual(rota('@infografico'), ['informacao']); assert.deepEqual(rota('@mockup'), ['visualizacao']);
assert.deepEqual(rota('@Vivi @Rui'), ['lider_criativo', 'qa_visual']);

// ---- workflows, gates, creative rules and collaboration
const regras = fs.readFileSync(new URL('regras.md', raiz), 'utf8');
const WF = ['brand-discovery', 'brand-strategy', 'visual-research', 'design-thinking', 'brand-identity', 'rebranding', 'logo-design', 'brand-guidelines', 'graphic-design', 'poster-design', 'stationery-design', 'editorial-design', 'catalog-design', 'presentation-design', 'infographic-design', 'illustration', 'character-design', 'mascot-design', 'pattern-design', 'packaging-design', 'environmental-design', 'photo-edit', 'image-compositing', '3d-mockup', 'motion-design', 'storyboard', 'social-media-design', 'social-campaign', 'content-calendar', 'print-ready', 'visual-audit', 'asset-export'];
for (const w of WF) assert(regras.includes(`- **${w}**:`), `workflow ${w}`);
for (const g of ['Briefing', 'Pesquisa e estratégia', 'Direção criativa', 'Produção visual', 'Produção técnica', 'Entrega final']) assert(regras.includes(g), `gate ${g}`);
for (const x of ['Product Designer', 'Software', 'Jogos', 'Industrial Design', 'Originalidade', 'Direitos autorais', 'Nunca troque um entregável obrigatório por uma imagem ilustrativa']) assert(regras.includes(x), x);
assert(fs.readFileSync(new URL('CATALOGO.md', raiz), 'utf8').includes('## Limites conhecidos'));

// ---- tolerant delivery: the agent records checks its own way and delivery no longer loops
const { normalizarVerificacoes } = await import('../lib/workflow.mjs');
const v = normalizarVerificacoes(['pytest -q: 14 passed', { cmd: 'grep show_id', resultado: 'ok', saida: '2 ocorrências' }, { status: 'ok' }, { comando: 'npx vitest', resultado: '3 failed' }, { comando: 'pytest', status: 'não executado', motivo: 'sem banco' }]);
assert.deepEqual(v.map((x) => [x.comando, x.status]), [['pytest -q', 'aprovado'], ['grep show_id', 'aprovado'], ['npx vitest', 'falhou'], ['pytest', 'nao_executado']]);

// ---- two projects with the template: isolated memory, and the lead request carries rules, gates and MCP
const store = await import('../lib/store.mjs');
store.gravarConfig({ piloto: { ativo: false, maxChamadasHora: 0 }, ciclo: { statusPO: false, versionar: false, posts: false } });
const projetos = await import('../lib/projetos.mjs');
const novo = (n) => { fs.mkdirSync(path.join(tmp, n)); const r = projetos.criar({ nome: n, caminho: path.join(tmp, n), template: 'visual-graphic-design' }); assert(r.ok, r.erro); return projetos.ctx(r.projeto.id); };
const a = novo('ClienteA'), b = novo('ClienteB');
a.memoria.salvar({ escopo: 'projeto', tipo: 'decisao', titulo: 'Paleta aprovada', texto: 'Azul petróleo #0F4C5C é a cor primária do Cliente A.' }, 'diretor_arte');
assert(!JSON.stringify(b.memoria.listar()).includes('Paleta aprovada'), 'one client decision does not show up in the other');
assert.notEqual(a.memoria.dir, b.memoria.dir);
a.equipe.enviar({ canal: 'dm:lider_criativo', texto: 'preciso de uma identidade visual para uma cafeteria', engine: 'claude', modo: 'conversar' });
for (let i = 0; i < 300 && !(fs.existsSync(process.env.STUDIO_PROMPT_DUMP) && fs.readdirSync(process.env.STUDIO_PROMPT_DUMP).some((f) => f.includes('lider_criativo'))); i++) await new Promise((x) => setTimeout(x, 50));
const dump = fs.readdirSync(process.env.STUDIO_PROMPT_DUMP).filter((f) => f.includes('lider_criativo')).map((f) => fs.readFileSync(path.join(process.env.STUDIO_PROMPT_DUMP, f), 'utf8')).join('\n');
assert(/Quality gates/.test(dump) && /brand-identity/.test(dump) && /Liderança: coordene o fluxo dentro do mandato autorizado/.test(dump), 'the lead receives workflows, gates and the leadership block');
assert(dump.includes('(id: preimpressao)'), 'and the team list');

a.equipe.cancelar(); b.equipe.cancelar();
console.log('PASS: Creative & Visual Design Studio (25 roles with contracts, visual routing, 32 workflows, gates, collaboration, memory isolated between clients, tolerant delivery). Simulated, no external tools.');
try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* Windows may still hold the folder */ }
process.exit(0);
