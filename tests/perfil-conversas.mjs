// Discord-style profile (GIF photo with framing, cover, validated style, per-agent personality/emojis/GIFs) and the menu for
// sidebar conversations (archive, add members, clear, delete). No model is called.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'work-ia-perfil-'));
process.env.STUDIO_DATA = path.join(tmp, 'data'); process.env.STUDIO_PROJETOS = path.join(tmp, 'projetos'); process.env.STUDIO_FAKE = '1';
process.env.STUDIO_PROMPT_DUMP = path.join(tmp, 'dump');
const store = await import('../lib/store.mjs');
store.gravarConfig({ piloto: { ativo: false, maxChamadasHora: 0 }, ciclo: { statusPO: false, versionar: false, posts: false } });
const projetos = await import('../lib/projetos.mjs');
fs.mkdirSync(path.join(tmp, 'alvo'));
const p = projetos.criar({ nome: 'Perfil', caminho: path.join(tmp, 'alvo'), template: 'software' }); assert(p.ok);
const c = projetos.ctx(p.projeto.id); const pf = c.perfis; const eq = c.equipe;
const espera = async (cond, ms = 15000) => { for (let t = 0; t < ms / 50 && !cond(); t++) await new Promise((x) => setTimeout(x, 50)); assert(cond(), 'timed out'); };

// ---- a GIF photo stays a GIF (animated) and the framing is stored separately
const gif = Buffer.from('R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==', 'base64');
assert(pf.definirFoto('frontend', `data:image/gif;base64,${gif.toString('base64')}`, { zoom: 1.6, x: -14, y: 3 }).ok);
assert.equal(pf.arquivo('frontend', 'foto').tipo, 'image/gif');
const bia = c.elenco.POR_ID.frontend;
assert.deepEqual(bia.estilo.recorteFoto, { zoom: 1.6, x: -14, y: 3 }); assert(/\/foto\/frontend\?v=/.test(bia.foto));
assert(!pf.definirFoto('frontend', `data:image/png;base64,${gif.toString('base64')}`).ok, 'a GIF claiming to be PNG is rejected');
assert(pf.definirCapa('frontend', `data:image/gif;base64,${gif.toString('base64')}`, { zoom: 9, x: 999, y: 0 }).ok);
assert.deepEqual(bia.estilo.recorteCapa, { zoom: 5, x: 300, y: 0 }, 'out-of-range framing is clamped');
assert(/\/capa\/frontend\?v=/.test(bia.capa));

// ---- style: only valid options are accepted
assert(pf.definirEstilo('frontend', { decoracao: 'aurora', efeito: 'estrelas', placa: 'galaxia', tema: { c1: '#5865f2', c2: '#eb459e' }, nome: { fonte: 'moderna', efeito: 'neon', c1: '#7c9cff' }, bio: 'Pixel no lugar.' }).ok);
assert.equal(bia.estilo.decoracao, 'aurora'); assert.equal(bia.estilo.nome.fonte, 'moderna');
assert(!pf.definirEstilo('frontend', { decoracao: 'nitro' }).ok, 'nonexistent decoration');
assert(!pf.definirEstilo('frontend', { tema: { c1: 'red', c2: '#000000' } }).ok, 'color in the wrong format');
assert(pf.definirEstilo('voce', { efeito: 'neve' }).ok, 'the Game Director has a profile too');
assert.equal(c.elenco.usuario.estilo.efeito, 'neve');

// ---- chat: the profile personality replaces the template one; emojis go into the request
assert(pf.definirConversa('frontend', { personalidade: 'Bia fala como pirata e chama todo mundo de marujo.', emojis: true, gifs: true }).ok);
assert(!pf.definirConversa('voce', { emojis: true }).ok);
eq.enviar({ canal: 'dm:frontend', texto: 'oi', engine: 'claude', modo: 'conversar' });
await espera(() => fs.existsSync(process.env.STUDIO_PROMPT_DUMP) && fs.readdirSync(process.env.STUDIO_PROMPT_DUMP).some((f) => f.includes('frontend')));
const dump = fs.readdirSync(process.env.STUDIO_PROMPT_DUMP).filter((f) => f.includes('frontend')).map((f) => fs.readFileSync(path.join(process.env.STUDIO_PROMPT_DUMP, f), 'utf8')).join('\n');
assert(dump.includes('chama todo mundo de marujo'), 'profile personality reaches the agent');
assert(!dump.includes(c.elenco.personalidadePadrao('frontend').slice(0, 40)), 'and the template one is dropped');
assert(/Emojis: use nas mensagens/.test(dump), 'emojis allowed');
assert(dump.lastIndexOf('chama todo mundo de marujo') > dump.lastIndexOf('## Regras'), 'personality comes after the rules');
assert(!/\[gif: termo/.test(dump), 'without a GIF key, the agent is not told to use GIFs');

// ---- sidebar conversations
await espera(() => eq.historico('dm:frontend').some((m) => m.de === 'frontend'));
eq.arquivarConversa('dm:backend');
assert(eq.arquivadas().includes('dm:backend'));
eq.enviar({ canal: 'dm:backend', texto: 'volta?', engine: 'claude', modo: 'conversar' });
await espera(() => !eq.arquivadas().includes('dm:backend'));   // an archived DM comes back when the agent replies
const r1 = eq.adicionarMembros('dm:frontend', ['uiux', 'qa']);
assert(r1.ok && /^grp-\d+$/.test(r1.canal), 'in a DM, adding members opens a group');
const g = eq.grupos().find((x) => x.canal === r1.canal);
assert.deepEqual([...g.membros].sort(), ['frontend', 'qa', 'uiux']);
assert(eq.adicionarMembros(r1.canal, ['backend']).ok);
assert(eq.grupos().find((x) => x.canal === r1.canal).membros.includes('backend'), 'in a group, more people join');
eq.arquivarConversa(r1.canal);
assert(!eq.excluirConversa('dm:frontend').ok, 'a DM cannot be deleted (clear or archive it)');
assert(eq.excluirConversa(r1.canal).ok);
assert(!eq.grupos().some((x) => x.canal === r1.canal) && !eq.arquivadas().includes(r1.canal) && eq.historico(r1.canal).length === 0, 'a deleted group disappears with its history');
eq.limparCanal('dm:frontend'); assert.equal(eq.historico('dm:frontend').length, 0);

// ---- the UI has the menu, the editor and the cropper
const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
for (const x of ["'contextmenu'", 'ctx-arquivar', 'ctx-excluir', 'ctx-membros', 'ctx-limpar', 'abrirRecorte', 'cartaoHtml', 'pedConversaHtml', 'gif-com']) assert(app.includes(x), x);
const idx = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
assert(idx.includes('/perfil.css') && idx.includes('/vfx.js'));

// ---- ready-made caricature personalities and banter between teammates
const persSrc = fs.readFileSync(new URL('../public/personalidades.js', import.meta.url), 'utf8');
const win = {}; new Function('window', persSrc)(win);
assert(win.PERSONAS.length >= 12, 'temperament catalog');
assert.equal(new Set(win.PERSONAS.map((x) => x.id)).size, win.PERSONAS.length, 'unique ids');
for (const x of win.PERSONAS) assert(x.nome && x.texto.length > 60 && x.texto.length <= 600, `${x.id} has text of reasonable length`);
assert(!/·/.test(persSrc), 'no middle dot as separator');
// guard: no character based on region, accent, origin or group of people (there was such a catalog once and it was removed)
const ESTEREOTIPO = /mineir|carioca|paulist|nordest|ga[uú]ch|baian|caipira|mexican|portugu[eê]s|argentin|japon|chin[eê]s|[áa]rabe|indian|african|italian|franc[eê]s|alem[aã]|sotaque|gringo|sargento|pirata/i;
for (const x of win.PERSONAS) assert(!ESTEREOTIPO.test(`${x.nome} ${x.texto}`), `${x.id} must not be a regional or origin stereotype`);
// changing the personality keeps the previous one: nothing the user wrote is lost
assert(pf.definirConversa('backend', { personalidade: 'Lucas é piadista de verdade.' }).ok);
assert(pf.definirConversa('backend', { personalidade: win.PERSONAS[0].texto }).ok);
const hist = c.elenco.POR_ID.backend.conversa.historico;
assert(hist.some((h) => h.texto === 'Lucas é piadista de verdade.'), 'the version the user wrote stays in history');
assert(pf.definirConversa('backend', { personalidade: 'Lucas é piadista de verdade.' }).ok);
assert(c.elenco.POR_ID.backend.conversa.historico.some((h) => h.texto === win.PERSONAS[0].texto), 'and switching back keeps the one that was replaced');
assert(pf.definirConversa('backend', { personalidade: 'Lucas é piadista e sarcástico, implica com o front por pixel torto.', zoeira: true }).ok);
assert(pf.definirConversa('frontend', { personalidade: 'Bia fala como pirata.', zoeira: true }).ok);
fs.rmSync(process.env.STUDIO_PROMPT_DUMP, { recursive: true, force: true });
eq.enviar({ canal: 'dm:frontend', texto: 'oi de novo', engine: 'claude', modo: 'conversar' });
await espera(() => fs.existsSync(process.env.STUDIO_PROMPT_DUMP) && fs.readdirSync(process.env.STUDIO_PROMPT_DUMP).some((f) => f.includes('frontend')));
const dz = fs.readdirSync(process.env.STUDIO_PROMPT_DUMP).filter((f) => f.includes('frontend')).map((f) => fs.readFileSync(path.join(process.env.STUDIO_PROMPT_DUMP, f), 'utf8')).join(String.fromCharCode(10));
assert(/Como a equipe trabalha \(vale para todos\)/.test(dz) && /Autogestão/.test(dz) && /nunca com origem, sotaque, região/.test(dz), 'every agent gets the autonomous, casual team guidance, with no jokes about origin');
assert(/Convivência com o time \(zoeira\)/.test(dz) && /nunca chame colega nem escreva mensagem só para brincar/.test(dz), 'banter comes with the cost-saving rule');
assert(/Back-end \(.*\): Lucas é piadista/.test(dz),'the agent knows what the teammate is like, to tease and reply');
assert(pf.definirConversa('frontend', { zoeira: false }).ok);
fs.rmSync(process.env.STUDIO_PROMPT_DUMP, { recursive: true, force: true });
eq.enviar({ canal: 'dm:frontend', texto: 'e agora?', engine: 'claude', modo: 'conversar' });
await espera(() => fs.existsSync(process.env.STUDIO_PROMPT_DUMP) && fs.readdirSync(process.env.STUDIO_PROMPT_DUMP).some((f) => f.includes('frontend')));
const dp = fs.readdirSync(process.env.STUDIO_PROMPT_DUMP).filter((f) => f.includes('frontend')).map((f) => fs.readFileSync(path.join(process.env.STUDIO_PROMPT_DUMP, f), 'utf8')).join(String.fromCharCode(10));
assert(!/Convivência com o time/.test(dp) && /tom profissional: sem implicância/.test(dp), 'professional-only turns banter off');
const appJs = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
for (const x of ['conv-persona', 'conv-sortear', 'sortear-time', 'cv-zoeira', 'conv-versao']) assert(appJs.includes(x), x);
assert(!/caricata/i.test(appJs), 'the UI no longer mentions caricatures');
for (const x of ['sel-abrir', 'seletorHtml', 'abrirEmoji', 'inserirEmoji', 'Planejar', 'Executar']) assert(appJs.includes(x), `chat: ${x}`);
assert(!/>Conversar<|>Trabalhar</.test(appJs), 'chat no longer uses Conversar and Trabalhar as buttons');

// ---- project references stay in the project: template/agentes/<id>.md and template/regras.md override the template (generic base)
fs.mkdirSync(path.join(c.pasta, 'template', 'agentes'), { recursive: true });
fs.writeFileSync(path.join(c.pasta, 'template', 'agentes', 'backend.md'), `---
name: backend
---
REFERENCIA-DO-PROJETO-A: o backend deste projeto usa Rails.`);
fs.writeFileSync(path.join(c.pasta, 'template', 'regras.md'), 'REGRA-DO-PROJETO-A: toda migração tem rollback.');
fs.mkdirSync(path.join(tmp, 'alvoB')); const pB = projetos.criar({ nome: 'Outro', caminho: path.join(tmp, 'alvoB'), template: 'software' }); assert(pB.ok);
const cB = projetos.ctx(pB.projeto.id);
const { criarElenco } = await import('../lib/agentes.mjs');
const doA = criarElenco('software', c.pasta).persona('backend', c.projeto.raiz), doB = criarElenco('software', cB.pasta).persona('backend', cB.projeto.raiz);
assert(doA.base.includes('REFERENCIA-DO-PROJETO-A') && doA.equipe.includes('REGRA-DO-PROJETO-A'), 'project A uses its own references');
assert(!doB.base.includes('REFERENCIA-DO-PROJETO-A') && !doB.equipe.includes('REGRA-DO-PROJETO-A'), 'project B inherits nothing from A');
assert(!/Demo/i.test(doB.base + doB.equipe), 'the software template base is generic');
assert(criarElenco('software').persona('frontend', c.projeto.raiz).base.length > 200, 'without a project folder, the template applies');
cB.equipe.cancelar();

eq.cancelar();
console.log('PASS: Discord-style profile (GIF with framing, cover, validated style, personality/emojis/GIFs) and conversation menu (archive, members, clear, delete).');
try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* Windows may still hold the folder */ }
process.exit(0);
