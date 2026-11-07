// Fase 2 (contrato de template): o núcleo não pergunta "é software?"; pergunta ao template. Domínio → cargo, playbook e
// "o que é entrega" no prompt, revisão com o nome do domínio (crítica de design) e checagem determinística de arquivo antes da revisão.
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
const espera = async (cond, ms = 15000) => { for (let t = 0; t < ms / 50 && !cond(); t++) await new Promise((x) => setTimeout(x, 50)); assert(cond(), 'tempo esgotado'); };

// ---- software: fluxo técnico e roteamento por domínio vêm do contrato
const sw = criarElenco('software');
assert.equal(sw.contrato.fluxo, 'tecnico');
assert.equal(sw.contrato.especialistaDe('o postgres na porta 5432 recusa conexão e a migration alembic não roda').agente, 'dados');
assert.equal(sw.contrato.especialistaDe('conflito no merge da branch com a develop').agente, 'versionamento');
assert.equal(sw.contrato.especialistaDe('o venv não tem as dependências do poetry').agente, 'infra');
assert.equal(sw.contrato.especialistaDe('bom dia'), null);
assert(sw.contrato.playbookDe('backend').includes('Diff mínimo'));
for (const t of ['jogos', 'visual-graphic-design', 'product-design', 'professional-operations']) assert.equal(criarElenco(t).contrato.fluxo, 'leve', t);

// ---- prompt: quem cobre o quê, playbook e o que é entrega (trabalho em card), e nada disso na conversa leve
fs.mkdirSync(path.join(tmp, 'alvo-sw'));
const ps = projetos.criar({ nome: 'Contrato software', caminho: path.join(tmp, 'alvo-sw'), template: 'software' }); assert(ps.ok);
const cs = projetos.ctx(ps.projeto.id);
const cardS = cs.quadro.criar({ titulo: 'Endpoint', descricao: 'x', dono: 'backend', coluna: 'andamento', aceite: ['GET /x responde 200'] }, 'voce').card;
const cheio = cs.equipe.teste.montar({ agente: 'backend', tipo: 'execucao', card: cardS.id, canalSaida: 'equipe', instrucao: 'implemente', origem: 'po' });
assert(/## Quem cobre o quê/.test(cheio.sistema) && /banco: /.test(cheio.sistema), 'domínios no prompt');
assert(/## Playbook do seu cargo/.test(cheio.sistema) && /Diff mínimo/.test(cheio.sistema), 'playbook do cargo no prompt');
assert(/## O que conta como entrega/.test(cheio.sistema), 'o que é entrega no prompt');
const leve = cs.equipe.teste.montar({ agente: 'backend', tipo: 'mencao', card: null, canalSaida: 'grp-9', instrucao: 'oi', origem: 'frontend' });
assert(!/## Playbook do seu cargo/.test(leve.sistema), 'conversa leve não carrega playbook');
cs.equipe.cancelar();

// ---- visual design: fluxo leve, revisão é crítica de design, e o app confere os arquivos antes da revisão
const alvo = path.join(tmp, 'alvo-vd'); fs.mkdirSync(alvo);
const pv = projetos.criar({ nome: 'Marca', caminho: alvo, template: 'visual-graphic-design' }); assert(pv.ok);
const cv = projetos.ctx(pv.projeto.id); const eq = cv.equipe;
const sistema = (re) => eq.historico('equipe').some((m) => m.de === 'sistema' && re.test(m.texto));
const card = cv.quadro.criar({ titulo: 'Logo principal', descricao: 'Logo em PNG.', dono: 'designer_grafico', coluna: 'andamento', aceite: ['O arquivo pecas/logo.png existe na pasta do projeto e abre como imagem'], arquivos: ['pecas/logo.png'] }, 'voce').card;
const rev = eq.teste.montar({ agente: 'lider_criativo', tipo: 'revisao', card: card.id, canalSaida: 'equipe', instrucao: '', origem: 'workflow' });
assert(/CRÍTICA DE DESIGN: Revise como crítica de design/.test(rev.pedido), 'a revisão leva o nome e a instrução do domínio');
// aceite cumprido com arquivo que não existe: o app devolve sem gastar a revisão
cv.quadro.atualizar(card.id, { aceiteOk: [0] }, 'designer_grafico');
assert(eq.pilotoTick({ forcar: true }));
await espera(() => sistema(/conferiu a entrega de .* e devolveu/), 15000);
await espera(() => cv.quadro.obter(card.id).coluna === 'andamento');
const fx = eq.fatos.listar().cards[card.id] || {};
assert(Object.values(fx).some((f) => f.origem === 'app' && /FALHOU/.test(f.valor)), 'a checagem ficou na ficha como medida');
// agora o arquivo existe (PNG real de 1x1): passa, a revisão segue
fs.mkdirSync(path.join(alvo, 'pecas'), { recursive: true });
fs.writeFileSync(path.join(alvo, 'pecas', 'logo.png'), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64'));
fs.writeFileSync(path.join(alvo, 'pecas', 'logo.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
cv.quadro.atualizar(card.id, { arquivos: ['pecas/logo.png', 'pecas/logo.svg'], aceiteOk: [0] }, 'designer_grafico');
for (let n = 0; n < 60 && eq.ocupada(); n++) await new Promise((x) => setTimeout(x, 100));
assert(eq.pilotoTick({ forcar: true }));
await espera(() => sistema(/conferiu a entrega de .*: arquivos da entrega existem ok, imagens abrem/), 15000);
assert.equal(cv.quadro.obter(card.id).coluna, 'revisao');
assert(Object.values(eq.fatos.listar().cards[card.id]).some((f) => /1x1/.test(f.valor)), 'as dimensões medidas estão na ficha');

eq.cancelar();
console.log('PASS: fase 2 (contrato de template: fluxo e domínios do template, domínio → cargo, playbook e entrega no prompt, revisão com nome do domínio, checagem de arquivo e imagem pelo app antes da revisão).');
try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* o Windows ainda segura a pasta */ }
process.exit(0);
