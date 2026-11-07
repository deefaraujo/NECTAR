// Phase 2 (template contract): the core does not ask "is this software?"; it asks the template. Domain → role, playbook and
// "what counts as delivery" in the prompt, review named after the domain (design critique) and a deterministic file check before review.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'work-ia-fase2-'));
process.env.STUDIO_DATA = path.join(tmp, 'data'); process.env.STUDIO_PROJETOS = path.join(tmp, 'projetos'); process.env.STUDIO_FAKE = '1';
const store = await import('../lib/store.mjs');
store.gravarConfig({ piloto: { ativo: true, maxChamadasHora: 0 }, ciclo: { statusPO: false, fechamento: false, orcamento: 10, revisaoAuto: true, versionar: false, curadoriaAuto: false } });
const projetos = await import('../lib/projetos.mjs');
const { criarElenco } = await import('../lib/agentes.mjs');
const espera = async (cond, ms = 15000) => { for (let t = 0; t < ms / 50 && !cond(); t++) await new Promise((x) => setTimeout(x, 50)); assert(cond(), 'timed out'); };

// ---- software: the technical flow and domain routing come from the contract
const sw = criarElenco('software');
assert.equal(sw.contrato.fluxo, 'tecnico');
assert.equal(sw.contrato.especialistaDe('o postgres na porta 5432 recusa conexão e a migration alembic não roda').agente, 'dados');
assert.equal(sw.contrato.especialistaDe('conflito no merge da branch com a develop').agente, 'versionamento');
assert.equal(sw.contrato.especialistaDe('o venv não tem as dependências do poetry').agente, 'infra');
assert.equal(sw.contrato.especialistaDe('bom dia'), null);
assert(sw.contrato.playbookDe('backend').includes('Diff mínimo'));
for (const t of ['jogos', 'visual-graphic-design', 'product-design', 'professional-operations']) assert.equal(criarElenco(t).contrato.fluxo, 'leve', t);

// ---- prompt: who covers what, playbook and what counts as delivery (card work), and none of it in light chat
fs.mkdirSync(path.join(tmp, 'alvo-sw'));
const ps = projetos.criar({ nome: 'Contrato software', caminho: path.join(tmp, 'alvo-sw'), template: 'software' }); assert(ps.ok);
const cs = projetos.ctx(ps.projeto.id);
const cardS = cs.quadro.criar({ titulo: 'Endpoint', descricao: 'x', dono: 'backend', coluna: 'andamento', aceite: ['GET /x responde 200'] }, 'voce').card;
const cheio = cs.equipe.teste.montar({ agente: 'backend', tipo: 'execucao', card: cardS.id, canalSaida: 'equipe', instrucao: 'implemente', origem: 'po' });
assert(/## Quem cobre o quê/.test(cheio.sistema) && /banco: /.test(cheio.sistema), 'domains in the prompt');
assert(/## Playbook do seu cargo/.test(cheio.sistema) && /Diff mínimo/.test(cheio.sistema), 'role playbook in the prompt');
assert(/## O que conta como entrega/.test(cheio.sistema), 'what counts as delivery is in the prompt');
const leve = cs.equipe.teste.montar({ agente: 'backend', tipo: 'mencao', card: null, canalSaida: 'grp-9', instrucao: 'oi', origem: 'frontend' });
assert(!/## Playbook do seu cargo/.test(leve.sistema), 'light chat does not load the playbook');
cs.equipe.cancelar();

// ---- visual design: light flow, review is a design critique, and the app checks the files before review
const alvo = path.join(tmp, 'alvo-vd'); fs.mkdirSync(alvo);
const pv = projetos.criar({ nome: 'Marca', caminho: alvo, template: 'visual-graphic-design' }); assert(pv.ok);
const cv = projetos.ctx(pv.projeto.id); const eq = cv.equipe;
const sistema = (re) => eq.historico('equipe').some((m) => m.de === 'sistema' && re.test(m.texto));
const card = cv.quadro.criar({ titulo: 'Logo principal', descricao: 'Logo em PNG.', dono: 'designer_grafico', coluna: 'andamento', aceite: ['O arquivo pecas/logo.png existe na pasta do projeto e abre como imagem'], arquivos: ['pecas/logo.png'] }, 'voce').card;
const rev = eq.teste.montar({ agente: 'lider_criativo', tipo: 'revisao', card: card.id, canalSaida: 'equipe', instrucao: '', origem: 'workflow' });
assert(/CRÍTICA DE DESIGN: Revise como crítica de design/.test(rev.pedido), 'the review carries the domain name and instruction');
// acceptance met with a file that does not exist: the app sends it back without spending the review
cv.quadro.atualizar(card.id, { aceiteOk: [0] }, 'designer_grafico');
assert(eq.pilotoTick({ forcar: true }));
await espera(() => sistema(/conferiu a entrega de .* e devolveu/), 15000);
await espera(() => cv.quadro.obter(card.id).coluna === 'andamento');
const fx = eq.fatos.listar().cards[card.id] || {};
assert(Object.values(fx).some((f) => f.origem === 'app' && /FALHOU/.test(f.valor)), 'the check landed in the fact sheet as measured');
// now the file exists (a real 1x1 PNG): it passes and review proceeds
fs.mkdirSync(path.join(alvo, 'pecas'), { recursive: true });
fs.writeFileSync(path.join(alvo, 'pecas', 'logo.png'), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64'));
fs.writeFileSync(path.join(alvo, 'pecas', 'logo.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
cv.quadro.atualizar(card.id, { arquivos: ['pecas/logo.png', 'pecas/logo.svg'], aceiteOk: [0] }, 'designer_grafico');
for (let n = 0; n < 60 && eq.ocupada(); n++) await new Promise((x) => setTimeout(x, 100));
assert(eq.pilotoTick({ forcar: true }));
await espera(() => sistema(/conferiu a entrega de .*: arquivos da entrega existem ok, imagens abrem/), 15000);
assert.equal(cv.quadro.obter(card.id).coluna, 'revisao');
assert(Object.values(eq.fatos.listar().cards[card.id]).some((f) => /1x1/.test(f.valor)), 'the measured dimensions are in the fact sheet');

eq.cancelar();
console.log('PASS: phase 2 (template contract: template flow and domains, domain → role, playbook and delivery in the prompt, review named after the domain, file and image check by the app before review).');
try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* Windows still holds the folder */ }
process.exit(0);
