// Agente de MCP em todos os templates, MCPs conectados (só ele recebe os servidores) e contas do Claude e do Codex.
// Nenhum modelo é chamado e nenhuma conta é desconectada.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'work-ia-mcp-'));
process.env.STUDIO_DATA = path.join(tmp, 'data'); process.env.STUDIO_PROJETOS = path.join(tmp, 'projetos'); process.env.STUDIO_FAKE = '1';
process.env.STUDIO_PROMPT_DUMP = path.join(tmp, 'dump');

// ---- todo template tem o agente de MCP
for (const t of ['software', 'jogos', 'product-design']) {
  const j = JSON.parse(fs.readFileSync(new URL(`../templates/${t}/template.json`, import.meta.url), 'utf8'));
  assert(j.agentes.some((a) => a.id === 'mcp'), `${t} tem agente de MCP`);
  assert(fs.existsSync(new URL(`../templates/${t}/agentes/mcp.md`, import.meta.url)));
}

// ---- registro: cadastrar, ligar, e a configuração só sai completa na hora da chamada
const mcp = await import('../lib/mcp.mjs');
assert(!mcp.adicionar({ nome: 'nome inválido!', tipo: 'http', url: 'https://x' }).ok);
assert(mcp.adicionar({ nome: 'teste-figma', tipo: 'http', url: 'https://mcp.exemplo.com/mcp', headers: '{"Authorization":"Bearer segredo"}', descricao: 'Ler frames do Figma' }).ok);
assert(mcp.adicionar({ nome: 'local', tipo: 'stdio', comando: 'npx', args: '-y servidor-teste', env: '{"CHAVE":"x"}' }).ok);
assert(!JSON.stringify(mcp.listar()).includes('segredo'), 'a lista para a tela não leva segredo');
assert(mcp.ativos().some((x) => x.nome === 'teste-figma'), 'cadastrado aqui já vem ligado');
mcp.definir('local', { ativo: false });
assert.deepEqual(mcp.configs().map((x) => x.nome), ['teste-figma'], 'só os ligados entram');
assert.equal(mcp.configs(['teste-figma'])[0].headers.Authorization, 'Bearer segredo');

// ---- os CLIs recebem os servidores (Claude por arquivo, Codex por -c) e o resto continua sem MCP
const { argsClaude, argsCodex } = await import('../lib/runner.mjs');
assert(argsClaude({ mcpArq: 'C:/m.json' }).join(' ').includes('--strict-mcp-config --mcp-config C:/m.json'));
assert(!argsClaude({}).includes('--mcp-config'), 'agente comum segue sem MCP');
const cx = argsCodex({ cwd: '.', mcp: [{ nome: 'f', tipo: 'http', url: 'https://u' }, { nome: 'l', tipo: 'stdio', command: 'npx', args: ['-y', 's'], env: { K: 'v' } }] }).join(' ');
assert(cx.includes('mcp_servers.f.url="https://u"') && cx.includes('mcp_servers.l.args=["-y","s"]') && cx.includes('mcp_servers.l.env={"K"="v"}'));

// ---- no time: o colega pede com mcp.pedir, o agente de MCP executa e devolve
const store = await import('../lib/store.mjs');
store.gravarConfig({ piloto: { ativo: false, maxChamadasHora: 0 }, ciclo: { statusPO: false, versionar: false, posts: false } });
const projetos = await import('../lib/projetos.mjs');
fs.mkdirSync(path.join(tmp, 'alvo'));
const p = projetos.criar({ nome: 'MCP', caminho: path.join(tmp, 'alvo'), template: 'software' }); assert(p.ok);
const eq = projetos.ctx(p.projeto.id).equipe;
const espera = async (cond, ms = 15000) => { for (let t = 0; t < ms / 50 && !cond(); t++) await new Promise((x) => setTimeout(x, 50)); assert(cond(), 'tempo esgotado'); };
eq.enviar({ canal: 'dm:po', texto: '[teste:mcp] preciso das medidas', engine: 'claude', modo: 'conversar' });
await espera(() => Object.values(eq.historico('dm:po')).some((m) => m.de === 'mcp' && /1440 por 900/.test(m.texto || '')) || ['equipe', 'dm:po'].some((c) => eq.historico(c).some((m) => m.de === 'mcp' && /1440/.test(m.texto || ''))));
const dumps = fs.readdirSync(process.env.STUDIO_PROMPT_DUMP).map((f) => [f, fs.readFileSync(path.join(process.env.STUDIO_PROMPT_DUMP, f), 'utf8')]);
const doMcp = dumps.filter(([f]) => f.includes('-mcp-')).map(([, t]) => t).join('\n');
assert(/pediu pelo MCP "teste-figma"/.test(doMcp) && /mcp__teste-figma__/.test(doMcp), 'o agente de MCP recebe o pedido e o servidor');
const doPo = dumps.filter(([f]) => f.includes('-po-')).map(([, t]) => t).join('\n');
assert(/teste-figma: Ler frames do Figma/.test(doPo) && /mcp\.pedir/.test(doPo), 'os colegas veem a lista de MCPs e a ação');
assert(!doPo.includes('Bearer segredo') && !doMcp.includes('Bearer segredo'), 'segredo nunca vai no texto do pedido');

// ---- imagem: @Image da Game Director gera direto; o agente usa imagem.gerar; a imagem vem como anexo no chat
eq.enviar({ canal: 'dm:po', texto: '@Image um logo de cafeteria minimalista', engine: 'claude', modo: 'conversar' });
await espera(() => eq.historico('dm:po').some((m) => m.tipo === 'imagem' && m.status === 'ok' && m.anexos?.[0]?.imagem));
const im = eq.historico('dm:po').find((m) => m.tipo === 'imagem');
assert.equal(im.de, 'sistema'); assert(/logo de cafeteria/.test(im.texto)); assert(!/@Image/.test(im.texto), 'o @Image sai do pedido');
assert(!eq.historico('dm:po').some((m) => m.de === 'po' && /logo de cafeteria/.test(m.texto || '')), '@Image não chama o agente');
eq.enviar({ canal: 'dm:frontend', texto: '[teste:imagem] crie o mascote', engine: 'claude', modo: 'conversar' });
await espera(() => eq.historico('dm:frontend').some((m) => m.tipo === 'imagem' && m.de === 'frontend' && m.status === 'ok'));
const ia = eq.historico('dm:frontend').find((m) => m.tipo === 'imagem');
assert(/mascote-raposa/.test(ia.anexos[0].nome) && /^\d{4}-\d{2}-\d{2}\//.test(ia.anexos[0].rel), 'o arquivo vai para os anexos do projeto com o nome pedido');
const dumpsImg = fs.readdirSync(process.env.STUDIO_PROMPT_DUMP).map((f) => fs.readFileSync(path.join(process.env.STUDIO_PROMPT_DUMP, f), 'utf8')).join('\n');
assert(/imagem\.gerar: prompt/.test(dumpsImg), 'os agentes conhecem a ação');

// ---- contas: o status lê os CLIs (sem conectar nem desconectar nada)
const contas = await import('../lib/contas.mjs');
for (const e of ['claude', 'codex']) { const s = await contas.status(e); assert('instalado' in s && 'conectado' in s, `status do ${e}`); }
await assert.rejects(contas.status('outro'));
const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
for (const x of ['conta-conectar', 'conta-desconectar', 'aj-motor', "['mcp', 'MCP']", 'mcp-adicionar']) assert(app.includes(x), x);

// ---- conexões: só Conectar na tela; sem identificador do app, a mensagem aponta a Configuração da TI
const cxn = await import('../lib/conexoes.mjs');
assert.match((await cxn.conectar('trello', 'http://127.0.0.1:1/r')).erro, /Configuração da TI/);
assert.match((await cxn.conectar('teams', 'http://127.0.0.1:1/r')).erro, /Configuração da TI/);
await assert.rejects(cxn.retorno('jira', { state: 'falso', code: 'x' }), /não bate/);
assert.deepEqual(cxn.conectadas(), []);
assert(!app.includes('cv-chave') && !app.includes('cx-trello-key'), 'a pessoa que usa nunca cola chave');
assert(app.includes("['integracoes', 'Conexões']") && app.includes('cx-conectar'));
eq.cancelar();
console.log('PASS: agente de MCP em todos os templates, MCPs só na chamada dele (Claude por arquivo, Codex por -c), mcp.pedir dos colegas, segredo fora do texto e status das contas do Claude e do Codex.');
try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* o Windows ainda segura a pasta */ }
process.exit(0);
