// Vertical drama studio: the template loads the team and the bible, and the animated storyboard comes out as a GIF attached in
// chat (gif.montar), even in a direct chat with no card. A single frame or a missing file becomes a warning, not an empty GIF.
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

// the template exists, has the right team, and no drama agent becomes a global agent (the bible belongs to the series, not the whole app)
assert(listarTemplates().some((t) => t.id === 'novela-vertical' && !t.rascunho), 'novela-vertical template listed');
const el = criarElenco('novela-vertical');
assert.deepEqual(['showrunner', 'roteiro', 'continuidade', 'diretor_arte', 'storyboard'].filter((id) => !el.POR_ID[id]), [], 'full team');
assert(!el.POR_ID.continuidade.geral && !el.ROSTER.some((a) => a.geral === 'memorizador' || a.geral === 'assessor'), 'continuity does not become the global memory keeper');
assert(el.POR_ID.mcp, 'MCP agent present (Higgsfield and other connections)');
assert(el.POR_ID.continuidade.skills.includes('series-continuity')&&skillDisponivelOuOpcional('novela-vertical','series-continuity'), 'continuity skill configured, available or declared optional');
const regras = fs.readFileSync(path.resolve(import.meta.dirname, '..', 'templates', 'novela-vertical', 'regras.md'), 'utf8');
assert(/biblia\/personagens\/<nome>\/referencias/.test(regras) && /referencias\[\]/.test(regras), 'rules for the bible and reference-based generation');

const alvo = path.join(tmp, 'novela'); const qd = path.join(alvo, 'episodios', 'ep01', 'cena01', 'quadros'); fs.mkdirSync(qd, { recursive: true });
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
for (const q of ['q01.png', 'q02.png', 'q03.png']) fs.writeFileSync(path.join(qd, q), png);
const r = projetos.criar({ nome: 'Minha novela', caminho: alvo, template: 'novela-vertical' }); assert(r.ok, r.erro);
const eq = projetos.ctx(r.projeto.id).equipe;

// direct chat with Nina, no card: the GIF comes back attached to the reply
const rel = (q) => `episodios/ep01/cena01/quadros/${q}`;
eq.enviar({ canal: 'dm:storyboard', texto: `[teste:gif:${rel('q01.png')},${rel('q02.png')},${rel('q03.png')}] monta a cena 1` });
const gifMsg = () => eq.historico('dm:storyboard').find((m) => m.de === 'storyboard' && m.anexos?.some((a) => /cena01\.gif$/.test(a.nome)));
assert(await espera(gifMsg), "scene GIF attached to Nina's message");
const anexo = gifMsg().anexos.find((a) => /\.gif$/.test(a.nome));
assert(anexo.imagem && anexo.tipo === 'image/gif', 'attachment shows as an image');
assert(fs.existsSync(path.join(projetos.ctx(r.projeto.id).pasta, 'anexos', ...anexo.rel.split('/'))), 'GIF file exists in attachments');

// a single frame: clear warning, no attachment
eq.enviar({ canal: 'dm:storyboard', texto: `[teste:gif:${rel('q01.png')}] só esse` });
assert(await espera(() => eq.historico('dm:storyboard').some((m) => m.resumo?.some((x) => x.tipo === 'aviso' && /pelo menos 2 quadros/.test(x.texto)))), 'single frame warns');
eq.enviar({ canal: 'dm:storyboard', texto: `[teste:gif:${rel('q01.png')},${rel('q09.png')}] com um que não existe` });
assert(await espera(() => eq.historico('dm:storyboard').some((m) => m.resumo?.some((x) => x.tipo === 'aviso' && /não encontrei .*q09\.png/.test(x.texto)))), 'missing frame warns which one');

await dorme(300);
try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { /* temp folder */ }
console.log('PASS: vertical drama (template and bible load, scene GIF attached in a DM without a card, single and missing frames warn).');
process.exit(0);
