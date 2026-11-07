// Conexões plug and play: Jira e Notion com um clique (registro automático + login oficial), "conectado" só depois de uma consulta real,
// token cifrado, login vencido aparece como "reconecte" e erro em linguagem de quem não programa. Servidores simulados (fetch trocado).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'work-ia-cx-'));
process.env.STUDIO_DATA = path.join(tmp, 'data');
// cofre de teste (o app real usa o do Windows): cifra = inverte o base64
globalThis.studioCofre = { disponivel: () => true, cifrar: (t) => Buffer.from(t).toString('base64').split('').reverse().join(''), decifrar: (b) => Buffer.from(b.split('').reverse().join(''), 'base64').toString() };

let mcpResponde = 200, refreshOk = true; const chamadas = [];
const resp = (status, corpo, headers = {}) => new Response(typeof corpo === 'string' ? corpo : JSON.stringify(corpo), { status, headers: { 'content-type': 'application/json', ...headers } });
// O Atlassian v2 publica (no 401) os metadados do recurso, que apontam para outro servidor de autorização (auth.atlassian.com);
// o Notion não publica nada e cai no jeito antigo (metadados na base). Os dois caminhos ficam cobertos.
const AS_JIRA = 'https://auth.atlassian.com/ABC';
globalThis.fetch = async (url, op = {}) => {
  const u = String(url); chamadas.push(u);
  const base = u.startsWith('https://mcp.notion.com') ? 'https://mcp.notion.com' : u.startsWith(AS_JIRA) ? AS_JIRA : 'https://mcp.atlassian.com';
  if (u === 'https://mcp.atlassian.com/.well-known/oauth-protected-resource/v2/mcp') return resp(200, { resource: 'https://mcp.atlassian.com/v2/mcp', authorization_servers: [AS_JIRA], scopes_supported: ['offline_access', 'read:me', 'read:jira:agent-interface', 'search:jira:agent-interface', 'write:jira:agent-interface'] });
  if (u.endsWith('/.well-known/oauth-authorization-server')) return resp(200, { issuer: base, authorization_endpoint: `${base}/authorize`, token_endpoint: `${base}/token`, registration_endpoint: `${base}/register` });
  if (u === `${base}/register`) return resp(201, { client_id: `cli-${base.includes('notion') ? 'notion' : 'jira'}` });
  if (u === `${base}/token`) {
    const corpo = new URLSearchParams(op.body);
    if (corpo.get('grant_type') === 'refresh_token') return refreshOk ? resp(200, { access_token: 'novo-token-secreto', expires_in: 3600 }) : resp(400, { error: 'invalid_grant' });
    return resp(200, { access_token: 'token-secreto-123', refresh_token: 'refresh-secreto', expires_in: 3600 });
  }
  if (/\/(v1\/|v2\/)?mcp$/.test(u)) {
    if (!(op.headers?.Authorization)) return u.includes('atlassian') ? resp(401, { error: 'invalid_token' }, { 'www-authenticate': 'Bearer resource_metadata="https://mcp.atlassian.com/.well-known/oauth-protected-resource/v2/mcp"' }) : resp(401, { error: 'invalid_token' });
    if (mcpResponde !== 200) return resp(mcpResponde, { error: 'unauthorized' });
    const corpo = JSON.parse(op.body);
    if (corpo.method === 'initialize') return resp(200, { jsonrpc: '2.0', id: 1, result: { serverInfo: { name: 'teste' } } }, { 'mcp-session-id': 's1' });
    if (corpo.method === 'tools/list') return resp(200, `event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', id: 2, result: { tools: [{ name: 'search' }, { name: 'getIssue' }] } })}\n\n`, { 'content-type': 'text/event-stream' });
    return resp(202, '');
  }
  // GitHub: device flow, API e MCP oficial
  if (u === 'https://github.com/login/device/code') return resp(200, { device_code: 'dev-1', user_code: 'ABCD-1234', verification_uri: 'https://github.com/login/device', interval: 0.01, expires_in: 5 });
  if (u === 'https://github.com/login/oauth/access_token') { githubPolls++; return githubPolls < 2 ? resp(200, { error: 'authorization_pending' }) : resp(200, { access_token: 'gho_tokenGithubSecreto1234567890', token_type: 'bearer' }); }
  if (u === 'https://api.github.com/user') return (op.headers?.Authorization || '').includes('gho_') || (op.headers?.Authorization || '').includes('ghp_') ? resp(200, { login: 'deborah', name: 'Déborah' }) : resp(401, { message: 'Bad credentials' });
  if (u === 'https://api.github.com/user/repos') return resp(200, [{ full_name: 'deborah/jogo' }]);
  if (u === 'https://api.githubcopilot.com/mcp/') { const corpo = JSON.parse(op.body); if (corpo.method === 'initialize') return resp(200, { jsonrpc: '2.0', id: 1, result: { serverInfo: { name: 'github-mcp' } } }, { 'mcp-session-id': 'g1' }); if (corpo.method === 'tools/list') return resp(200, { jsonrpc: '2.0', id: 2, result: { tools: [{ name: 'list_issues' }, { name: 'create_issue' }, { name: 'get_me' }] } }); return resp(202, ''); }
  return resp(404, 'não simulado: ' + u);
};
let githubPolls = 0;
const cx = await import('../lib/conexoes.mjs');
const redirect = 'http://127.0.0.1:5555/api/conexoes/jira/retorno';

// ---- antes de tudo: nada conectado, e Jira/Notion não pedem configuração nenhuma
let st = cx.status();
for (const a of ['jira', 'notion', 'teams', 'trello']) { assert.equal(st[a].conectado, false); assert.equal(st[a].estado, 'not_configured'); }
assert.equal(st.jira.precisaConfig, false); assert.equal(st.notion.precisaConfig, false, 'Jira e Notion: só clicar');
assert.equal(st.teams.precisaConfig, true); assert.equal(st.trello.precisaConfig, true);

// ---- Teams sem o aplicativo da empresa: explica, não abre formulário nem quebra
const te = await cx.conectar('teams', redirect);
assert.equal(te.ok, false); assert.equal(te.precisaConfig, true); assert.match(te.erro, /TI/);

// ---- Jira: um clique gera o link oficial com registro automático e PKCE
const cj = await cx.conectar('jira', redirect);
assert(cj.ok && cj.url.startsWith(`${AS_JIRA}/authorize?`), `o login é no servidor que o recurso protegido indica, não na base do MCP: ${cj.url}`);
const pj = new URL(cj.url).searchParams;
assert.equal(pj.get('client_id'), 'cli-jira'); assert.equal(pj.get('code_challenge_method'), 'S256'); assert.equal(pj.get('redirect_uri'), redirect);
assert.equal(pj.get('resource'), 'https://mcp.atlassian.com/v2/mcp', 'o token é pedido para o endereço v2');
assert(pj.get('scope').split(' ').includes('offline_access') && pj.get('scope').includes('read:jira:agent-interface'), 'pede offline_access (refresh) e os escopos do Jira');
assert(chamadas.some((u) => u === `${AS_JIRA}/register`), 'registra o aplicativo no servidor de autorização certo');
assert.equal(cx.status().jira.estado, 'pending_authorization');

// ---- login recusado no site: mensagem clara, nada fica "conectado"
await assert.rejects(cx.retorno('jira', { error: 'access_denied', state: pj.get('state') }), /recusado ou cancelado/);
assert.equal(cx.status().jira.conectado, false); assert.match(cx.status().jira.erro.texto, /recusado/);

// ---- login aceito: token cifrado, verificação real e só então "conectado"
const cj2 = await cx.conectar('jira', redirect);
await cx.retorno('jira', { code: 'abc', state: new URL(cj2.url).searchParams.get('state') });
st = cx.status().jira;
assert.equal(st.conectado, true); assert.equal(st.estado, 'healthy'); assert.equal(st.ferramentas, 2);
const disco = fs.readFileSync(path.join(tmp, 'data', 'conexoes.json'), 'utf8');
assert(!disco.includes('token-secreto-123') && !disco.includes('refresh-secreto'), 'o token nunca fica em texto no disco');
assert.equal(cx.mcpsDasConexoes()[0].nome, 'jira'); assert.match(cx.mcpsDasConexoes()[0].headers.Authorization, /^Bearer token-secreto-123$/);
assert(!JSON.stringify(cx.status()).includes('token-secreto'), 'a tela nunca recebe o token');

// ---- Notion: mesmo clique, com o indicador de recurso que o Notion pede
const cn = await cx.conectar('notion', redirect.replace('jira', 'notion'));
assert.equal(new URL(cn.url).searchParams.get('resource'), 'https://mcp.notion.com/mcp');
await cx.retorno('notion', { code: 'xyz', state: new URL(cn.url).searchParams.get('state') });
assert.equal(cx.status().notion.conectado, true);
assert.deepEqual(cx.mcpsDasConexoes().map((m) => m.nome), ['jira', 'notion'], 'a liderança recebe os dois MCPs');

// ---- token recém-emitido recusado NÃO é "login venceu": a tela diz que o servidor não aceitou e o app refaz a descoberta do login
mcpResponde = 401; refreshOk = true;
const r0 = await cx.verificar('jira');
assert.equal(r0.estado, 'sync_error'); assert.match(r0.detalhe, /não aceitou/);
assert(!JSON.parse(fs.readFileSync(path.join(tmp, 'data', 'conexoes.json'), 'utf8')).jira.descoberta, 'a descoberta é refeita na próxima tentativa');
// ---- login vence (conexão antiga): renova sozinho quando dá; quando não dá, a tela pede para reconectar e o MCP sai da chamada dos agentes
{ const arq = path.join(tmp, 'data', 'conexoes.json'); const j = JSON.parse(fs.readFileSync(arq, 'utf8')); const antes = new Date(Date.now() - 3600_000).toISOString(); j.jira.desde = antes; j.notion.desde = antes; fs.writeFileSync(arq, JSON.stringify(j)); }
const r1 = await cx.verificar('jira');
assert.equal(r1.estado, 'authentication_expired', 'servidor recusando mesmo com token novo');
refreshOk = false;
const r2 = await cx.verificar('notion');
assert.equal(r2.conectado, false); assert.equal(r2.estado, 'authentication_expired'); assert.match(r2.detalhe, /Reconectar/);
assert.equal(cx.mcpsDasConexoes().length, 0, 'conexão vencida não vai para os agentes (evita chamadas que só falham)');
mcpResponde = 200; refreshOk = true;
assert.equal((await cx.verificar('jira')).conectado, true, 'voltou a responder: volta a conectado');

// ---- erro de rede vira frase simples
assert.match(cx.explicar('jira', 'fetch failed'), /internet|rede/);
assert.match(cx.explicar('teams', 'AADSTS65001: The user or administrator has not consented'), /TI aprove/);

// ---- GitHub sem o OAuth App registrado: explica e aponta o token pessoal como saída
assert.equal(cx.status().github.precisaConfig, true);
const g0 = await cx.conectar('github', redirect);
assert.equal(g0.ok, false); assert.match(g0.erro, /token pessoal/);
// token pessoal com formato errado não entra; com formato certo, só fica conectado depois da leitura real de /user
assert.equal((await cx.configurar('github', { token: 'abc' })).ok, false);
const gp = await cx.configurar('github', { token: 'ghp_' + 'x'.repeat(36) });
assert.equal(gp.ok, true); assert.equal(gp.status.github.conectado, true); assert.match(gp.status.github.conta, /@deborah/);
assert.equal(gp.status.github.estado, 'healthy'); assert.equal(gp.status.github.ferramentas, 3, 'o MCP oficial aceitou o token');
assert.deepEqual(cx.mcpsDasConexoes().map((m) => m.nome), ['jira', 'github'], 'o Notion continua vencido do passo anterior');
assert.equal(cx.mcpsDasConexoes()[1].url, 'https://api.githubcopilot.com/mcp/');
assert((await cx.proxy('github', '/user/repos')).ok, 'leitura pela API com o token posto pelo app');
cx.desconectar('github');
// com o Client ID configurado: login por código, igual ao Teams, e o app espera a pessoa digitar
await cx.configurar('github', { clientId: 'Iv1.cliente' });
const g1 = await cx.conectar('github', redirect);
assert.equal(g1.ok, true); assert.equal(g1.codigo, 'ABCD-1234'); assert.equal(g1.url, 'https://github.com/login/device');
assert.equal(cx.status().github.estado, 'pending_authorization'); assert.equal(cx.status().github.codigo.usuario, 'ABCD-1234');
await new Promise((r) => setTimeout(r, 300));
assert.equal(cx.status().github.conectado, true, 'digitou o código: conectado');
assert(!fs.readFileSync(path.join(tmp, 'data', 'conexoes.json'), 'utf8').includes('gho_tokenGithub'), 'token do GitHub cifrado no disco');
assert.match(cx.explicar('github', 'expired_token'), /venceu/);

// ---- desconectar apaga o token
cx.desconectar('jira');
assert.equal(cx.status().jira.conectado, false); assert(!fs.readFileSync(path.join(tmp, 'data', 'conexoes.json'), 'utf8').includes('"jira":{"tokenCifrado"'));
console.log('PASS: conexões plug and play (Jira e Notion com um clique, GitHub por código ou token pessoal com MCP oficial, conectado só após consulta real, token cifrado, login vencido pede reconectar, erros em linguagem simples, Teams/Trello explicam a liberação da TI).');
process.exit(0);
