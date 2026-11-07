// Perfil estilo Discord (foto GIF com enquadramento, capa, estilo validado, personalidade/emojis/GIFs por agente) e o menu das
// conversas da lista lateral (arquivar, adicionar membros, limpar, excluir). Nenhum modelo é chamado.
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
const espera = async (cond, ms = 15000) => { for (let t = 0; t < ms / 50 && !cond(); t++) await new Promise((x) => setTimeout(x, 50)); assert(cond(), 'tempo esgotado'); };

// ---- foto GIF fica GIF (animada) e o enquadramento é guardado à parte
const gif = Buffer.from('R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==', 'base64');
assert(pf.definirFoto('frontend', `data:image/gif;base64,${gif.toString('base64')}`, { zoom: 1.6, x: -14, y: 3 }).ok);
assert.equal(pf.arquivo('frontend', 'foto').tipo, 'image/gif');
const bia = c.elenco.POR_ID.frontend;
assert.deepEqual(bia.estilo.recorteFoto, { zoom: 1.6, x: -14, y: 3 }); assert(/\/foto\/frontend\?v=/.test(bia.foto));
assert(!pf.definirFoto('frontend', `data:image/png;base64,${gif.toString('base64')}`).ok, 'GIF dizendo ser PNG é recusado');
assert(pf.definirCapa('frontend', `data:image/gif;base64,${gif.toString('base64')}`, { zoom: 9, x: 999, y: 0 }).ok);
assert.deepEqual(bia.estilo.recorteCapa, { zoom: 5, x: 300, y: 0 }, 'enquadramento fora da faixa é limitado');
assert(/\/capa\/frontend\?v=/.test(bia.capa));

// ---- estilo: só opções válidas entram
assert(pf.definirEstilo('frontend', { decoracao: 'aurora', efeito: 'estrelas', placa: 'galaxia', tema: { c1: '#5865f2', c2: '#eb459e' }, nome: { fonte: 'moderna', efeito: 'neon', c1: '#7c9cff' }, bio: 'Pixel no lugar.' }).ok);
assert.equal(bia.estilo.decoracao, 'aurora'); assert.equal(bia.estilo.nome.fonte, 'moderna');
assert(!pf.definirEstilo('frontend', { decoracao: 'nitro' }).ok, 'decoração inexistente');
assert(!pf.definirEstilo('frontend', { tema: { c1: 'red', c2: '#000000' } }).ok, 'cor fora do formato');
assert(pf.definirEstilo('voce', { efeito: 'neve' }).ok, 'a Game Director também tem perfil');
assert.equal(c.elenco.usuario.estilo.efeito, 'neve');

// ---- conversa: personalidade do perfil substitui a do template; emojis entram no pedido
assert(pf.definirConversa('frontend', { personalidade: 'Bia fala como pirata e chama todo mundo de marujo.', emojis: true, gifs: true }).ok);
assert(!pf.definirConversa('voce', { emojis: true }).ok);
eq.enviar({ canal: 'dm:frontend', texto: 'oi', engine: 'claude', modo: 'conversar' });
await espera(() => fs.existsSync(process.env.STUDIO_PROMPT_DUMP) && fs.readdirSync(process.env.STUDIO_PROMPT_DUMP).some((f) => f.includes('frontend')));
const dump = fs.readdirSync(process.env.STUDIO_PROMPT_DUMP).filter((f) => f.includes('frontend')).map((f) => fs.readFileSync(path.join(process.env.STUDIO_PROMPT_DUMP, f), 'utf8')).join('\n');
assert(dump.includes('chama todo mundo de marujo'), 'personalidade do perfil chega ao agente');
assert(!dump.includes(c.elenco.personalidadePadrao('frontend').slice(0, 40)), 'e a do template sai');
assert(/Emojis: use nas mensagens/.test(dump), 'emojis liberados');
assert(dump.lastIndexOf('chama todo mundo de marujo') > dump.lastIndexOf('## Regras'), 'a personalidade vem depois das regras');
assert(!/\[gif: termo/.test(dump), 'sem chave de GIFs, o agente não é instruído a usar GIF');

// ---- conversas da lista lateral
await espera(() => eq.historico('dm:frontend').some((m) => m.de === 'frontend'));
eq.arquivarConversa('dm:backend');
assert(eq.arquivadas().includes('dm:backend'));
eq.enviar({ canal: 'dm:backend', texto: 'volta?', engine: 'claude', modo: 'conversar' });
await espera(() => !eq.arquivadas().includes('dm:backend'));   // DM arquivada volta quando o agente responde
const r1 = eq.adicionarMembros('dm:frontend', ['uiux', 'qa']);
assert(r1.ok && /^grp-\d+$/.test(r1.canal), 'na DM, adicionar membros abre um grupo');
const g = eq.grupos().find((x) => x.canal === r1.canal);
assert.deepEqual([...g.membros].sort(), ['frontend', 'qa', 'uiux']);
assert(eq.adicionarMembros(r1.canal, ['backend']).ok);
assert(eq.grupos().find((x) => x.canal === r1.canal).membros.includes('backend'), 'no grupo, entra mais gente');
eq.arquivarConversa(r1.canal);
assert(!eq.excluirConversa('dm:frontend').ok, 'DM não se exclui (limpa ou arquiva)');
assert(eq.excluirConversa(r1.canal).ok);
assert(!eq.grupos().some((x) => x.canal === r1.canal) && !eq.arquivadas().includes(r1.canal) && eq.historico(r1.canal).length === 0, 'grupo excluído some com o histórico');
eq.limparCanal('dm:frontend'); assert.equal(eq.historico('dm:frontend').length, 0);

// ---- a tela tem o menu, o editor e o recorte
const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
for (const x of ["'contextmenu'", 'ctx-arquivar', 'ctx-excluir', 'ctx-membros', 'ctx-limpar', 'abrirRecorte', 'cartaoHtml', 'pedConversaHtml', 'gif-com']) assert(app.includes(x), x);
const idx = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
assert(idx.includes('/perfil.css') && idx.includes('/vfx.js'));

// ---- personalidades caricatas prontas e zoeira entre colegas
const persSrc = fs.readFileSync(new URL('../public/personalidades.js', import.meta.url), 'utf8');
const win = {}; new Function('window', persSrc)(win);
assert(win.PERSONAS.length >= 12, 'catálogo de temperamentos');
assert.equal(new Set(win.PERSONAS.map((x) => x.id)).size, win.PERSONAS.length, 'ids únicos');
for (const x of win.PERSONAS) assert(x.nome && x.texto.length > 60 && x.texto.length <= 600, `${x.id} tem texto de tamanho razoável`);
assert(!/·/.test(persSrc), 'sem ponto médio como separador');
// trava: nada de personagem baseado em região, sotaque, origem ou grupo de pessoas (já houve um catálogo assim e foi removido)
const ESTEREOTIPO = /mineir|carioca|paulist|nordest|ga[uú]ch|baian|caipira|mexican|portugu[eê]s|argentin|japon|chin[eê]s|[áa]rabe|indian|african|italian|franc[eê]s|alem[aã]|sotaque|gringo|sargento|pirata/i;
for (const x of win.PERSONAS) assert(!ESTEREOTIPO.test(`${x.nome} ${x.texto}`), `${x.id} não pode ser estereótipo de região ou origem`);
// trocar a personalidade guarda a anterior: nada que a Game Director escreveu se perde
assert(pf.definirConversa('backend', { personalidade: 'Lucas é piadista de verdade.' }).ok);
assert(pf.definirConversa('backend', { personalidade: win.PERSONAS[0].texto }).ok);
const hist = c.elenco.POR_ID.backend.conversa.historico;
assert(hist.some((h) => h.texto === 'Lucas é piadista de verdade.'), 'a versão escrita pela pessoa fica no histórico');
assert(pf.definirConversa('backend', { personalidade: 'Lucas é piadista de verdade.' }).ok);
assert(c.elenco.POR_ID.backend.conversa.historico.some((h) => h.texto === win.PERSONAS[0].texto), 'e voltar a ela guarda a que saiu');
assert(pf.definirConversa('backend', { personalidade: 'Lucas é piadista e sarcástico, implica com o front por pixel torto.', zoeira: true }).ok);
assert(pf.definirConversa('frontend', { personalidade: 'Bia fala como pirata.', zoeira: true }).ok);
fs.rmSync(process.env.STUDIO_PROMPT_DUMP, { recursive: true, force: true });
eq.enviar({ canal: 'dm:frontend', texto: 'oi de novo', engine: 'claude', modo: 'conversar' });
await espera(() => fs.existsSync(process.env.STUDIO_PROMPT_DUMP) && fs.readdirSync(process.env.STUDIO_PROMPT_DUMP).some((f) => f.includes('frontend')));
const dz = fs.readdirSync(process.env.STUDIO_PROMPT_DUMP).filter((f) => f.includes('frontend')).map((f) => fs.readFileSync(path.join(process.env.STUDIO_PROMPT_DUMP, f), 'utf8')).join(String.fromCharCode(10));
assert(/Como a equipe trabalha \(vale para todos\)/.test(dz) && /Autogestão/.test(dz) && /nunca com origem, sotaque, região/.test(dz), 'todo agente recebe a equipe autônoma e casual, sem zoar origem');
assert(/Convivência com o time \(zoeira\)/.test(dz) && /nunca chame colega nem escreva mensagem só para brincar/.test(dz), 'a zoeira entra com a regra de economia');
assert(/Back-end \(.*\): Lucas é piadista/.test(dz),'o agente sabe como o colega costuma ser, para provocar e rebater');
assert(pf.definirConversa('frontend', { zoeira: false }).ok);
fs.rmSync(process.env.STUDIO_PROMPT_DUMP, { recursive: true, force: true });
eq.enviar({ canal: 'dm:frontend', texto: 'e agora?', engine: 'claude', modo: 'conversar' });
await espera(() => fs.existsSync(process.env.STUDIO_PROMPT_DUMP) && fs.readdirSync(process.env.STUDIO_PROMPT_DUMP).some((f) => f.includes('frontend')));
const dp = fs.readdirSync(process.env.STUDIO_PROMPT_DUMP).filter((f) => f.includes('frontend')).map((f) => fs.readFileSync(path.join(process.env.STUDIO_PROMPT_DUMP, f), 'utf8')).join(String.fromCharCode(10));
assert(!/Convivência com o time/.test(dp) && /tom profissional: sem implicância/.test(dp), 'só profissional desliga a zoeira');
const appJs = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
for (const x of ['conv-persona', 'conv-sortear', 'sortear-time', 'cv-zoeira', 'conv-versao']) assert(appJs.includes(x), x);
assert(!/caricata/i.test(appJs), 'a tela não fala mais em caricatas');
for (const x of ['sel-abrir', 'seletorHtml', 'abrirEmoji', 'inserirEmoji', 'Planejar', 'Executar']) assert(appJs.includes(x), `chat: ${x}`);
assert(!/>Conversar<|>Trabalhar</.test(appJs), 'o chat não usa mais Conversar e Trabalhar como botões');

// ---- referências de projeto ficam no projeto: template/agentes/<id>.md e template/regras.md valem por cima do template (base genérica)
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
assert(doA.base.includes('REFERENCIA-DO-PROJETO-A') && doA.equipe.includes('REGRA-DO-PROJETO-A'), 'o projeto A usa as próprias referências');
assert(!doB.base.includes('REFERENCIA-DO-PROJETO-A') && !doB.equipe.includes('REGRA-DO-PROJETO-A'), 'o projeto B não herda nada do A');
assert(!/Demo/i.test(doB.base + doB.equipe), 'a base do template de software é genérica');
assert(criarElenco('software').persona('frontend', c.projeto.raiz).base.length > 200, 'sem pasta de projeto, vale o template');
cB.equipe.cancelar();

eq.cancelar();
console.log('PASS: perfil estilo Discord (GIF com enquadramento, capa, estilo validado, personalidade/emojis/GIFs) e menu das conversas (arquivar, membros, limpar, excluir).');
try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* o Windows ainda segura a pasta */ }
process.exit(0);
