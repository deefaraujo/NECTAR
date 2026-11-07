// Produtora de novela vertical: o template carrega a equipe e a bíblia, e o storyboard animado sai como GIF anexado no
// chat (gif.montar), inclusive numa conversa direta sem card. Quadro único ou arquivo que não existe vira aviso, não GIF vazio.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { skillDisponivelOuOpcional } from '../lib/skills-opcionais.mjs';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nectar-novela-'));
process.env.STUDIO_DATA = path.join(tmp, 'data'); process.env.STUDIO_PROJETOS = path.join(tmp, 'projetos'); process.env.STUDIO_FAKE = '1'; process.env.STUDIO_FAKE_LOCAL = '0';
const store = await import('../lib/store.mjs');
store.gravarConfig({ piloto: { ativo: false, maxChamadasHora: 0 }, ciclo: { statusPO: false, fechamento: false, revisaoAuto: false, versionar: false, curadoriaAuto: false, planningReplica: false } });
const { listarTemplates, criarElenco } = await import('../lib/agentes.mjs');
const projetos = await import('../lib/projetos.mjs');
const dorme = (ms) => new Promise((x) => setTimeout(x, ms));
const espera = async (cond, ms = 25000) => { for (let i = 0; i < ms / 50 && !cond(); i++) await dorme(50); return cond(); };

// o template existe, tem a equipe certa e nenhum agente da novela vira agente geral (a bíblia é da série, não de todo o app)
assert(listarTemplates().some((t) => t.id === 'novela-vertical' && !t.rascunho), 'template novela-vertical listado');
const el = criarElenco('novela-vertical');
assert.deepEqual(['showrunner', 'roteiro', 'continuidade', 'diretor_arte', 'storyboard'].filter((id) => !el.POR_ID[id]), [], 'equipe completa');
assert(!el.POR_ID.continuidade.geral && !el.ROSTER.some((a) => a.geral === 'memorizador' || a.geral === 'assessor'), 'continuidade não vira o memorizador geral');
assert(el.POR_ID.mcp, 'agente de MCP presente (Higgsfield e outras conexões)');
assert(el.POR_ID.continuidade.skills.includes('series-continuity')&&skillDisponivelOuOpcional('novela-vertical','series-continuity'), 'skill de continuidade configurada, disponível ou opcional declarada');
const regras = fs.readFileSync(path.resolve(import.meta.dirname, '..', 'templates', 'novela-vertical', 'regras.md'), 'utf8');
assert(/biblia\/personagens\/<nome>\/referencias/.test(regras) && /referencias\[\]/.test(regras), 'regras da bíblia e da geração com referência');

const alvo = path.join(tmp, 'novela'); const qd = path.join(alvo, 'episodios', 'ep01', 'cena01', 'quadros'); fs.mkdirSync(qd, { recursive: true });
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
for (const q of ['q01.png', 'q02.png', 'q03.png']) fs.writeFileSync(path.join(qd, q), png);
const r = projetos.criar({ nome: 'Minha novela', caminho: alvo, template: 'novela-vertical' }); assert(r.ok, r.erro);
const eq = projetos.ctx(r.projeto.id).equipe;

// conversa direta com a Nina, sem card: o GIF volta anexado na resposta
const rel = (q) => `episodios/ep01/cena01/quadros/${q}`;
eq.enviar({ canal: 'dm:storyboard', texto: `[teste:gif:${rel('q01.png')},${rel('q02.png')},${rel('q03.png')}] monta a cena 1` });
const gifMsg = () => eq.historico('dm:storyboard').find((m) => m.de === 'storyboard' && m.anexos?.some((a) => /cena01\.gif$/.test(a.nome)));
assert(await espera(gifMsg), 'GIF da cena anexado na mensagem da Nina');
const anexo = gifMsg().anexos.find((a) => /\.gif$/.test(a.nome));
assert(anexo.imagem && anexo.tipo === 'image/gif', 'anexo aparece como imagem');
assert(fs.existsSync(path.join(projetos.ctx(r.projeto.id).pasta, 'anexos', ...anexo.rel.split('/'))), 'arquivo do GIF existe nos anexos');

// um quadro só: aviso claro, sem anexo
eq.enviar({ canal: 'dm:storyboard', texto: `[teste:gif:${rel('q01.png')}] só esse` });
assert(await espera(() => eq.historico('dm:storyboard').some((m) => m.resumo?.some((x) => x.tipo === 'aviso' && /pelo menos 2 quadros/.test(x.texto)))), 'quadro único avisa');
eq.enviar({ canal: 'dm:storyboard', texto: `[teste:gif:${rel('q01.png')},${rel('q09.png')}] com um que não existe` });
assert(await espera(() => eq.historico('dm:storyboard').some((m) => m.resumo?.some((x) => x.tipo === 'aviso' && /não encontrei .*q09\.png/.test(x.texto)))), 'quadro inexistente avisa qual');

await dorme(300);
try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { /* pasta temporária */ }
console.log('PASS: novela vertical (template e bíblia carregam, GIF da cena anexado na DM sem card, quadro único e quadro inexistente avisam).');
process.exit(0);
