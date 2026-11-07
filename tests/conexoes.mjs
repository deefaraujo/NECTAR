// Plug-and-play connections: Jira and Notion in one click (automatic registration + official login), "connected" only after a real query,
// encrypted token, an expired login shows as "reconnect" and errors read in non-programmer language. Simulated servers (fetch replaced).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'work-ia-cx-'));
process.env.STUDIO_DATA = path.join(tmp, 'data');
// test vault (the real app uses the Windows one): encryption = reversed base64
globalThis.studioCofre = { disponivel: () => true, cifrar: (t) => Buffer.from(t).toString('base64').split('').reverse().join(''), decifrar: (b) => Buffer.from(b.split('').reverse().join(''), 'base64').toString() };

let mcpResponde = 200, refreshOk = true; const chamadas = [];
const resp = (status, corpo, headers = {}) => new Response(typeof corpo === 'string' ? corpo : JSON.stringify(corpo), { status, headers: { 'content-type': 'application/json', ...headers } });
// Atlassian v2 publishes (on 401) the resource metadata, which points to a different authorization server (auth.atlassian.com);
// Notion publishes nothing and falls back to the old way (metadata at the base). Both paths are covered.
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
  // GitHub: device flow, API and official MCP
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

// ---- first: nothing connected, and Jira/Notion need no configuration at all
let st = cx.status();
for (const a of ['jira', 'notion', 'teams', 'trello']) { assert.equal(st[a].conectado, false); assert.equal(st[a].estado, 'not_configured'); }
assert.equal(st.jira.precisaConfig, false); assert.equal(st.notion.precisaConfig, false, 'Jira and Notion: just click');
assert.equal(st.teams.precisaConfig, true); assert.equal(st.trello.precisaConfig, true);

// ---- Teams without the company app: explains, opens no form and does not break
const te = await cx.conectar('teams', redirect);
assert.equal(te.ok, false); assert.equal(te.precisaConfig, true); assert.match(te.erro, /TI/);

// ---- Jira: one click builds the official link with automatic registration and PKCE
const cj = await cx.conectar('jira', redirect);
assert(cj.ok && cj.url.startsWith(`${AS_JIRA}/authorize?`), `login happens on the server the protected resource points to, not at the MCP base: ${cj.url}`);
const pj = new URL(cj.url).searchParams;
assert.equal(pj.get('client_id'), 'cli-jira'); assert.equal(pj.get('code_challenge_method'), 'S256'); assert.equal(pj.get('redirect_uri'), redirect);
assert.equal(pj.get('resource'), 'https://mcp.atlassian.com/v2/mcp', 'the token is requested for the v2 address');
assert(pj.get('scope').split(' ').includes('offline_access') && pj.get('scope').includes('read:jira:agent-interface'), 'requests offline_access (refresh) and the Jira scopes');
assert(chamadas.some((u) => u === `${AS_JIRA}/register`), 'registers the app on the right authorization server');
assert.equal(cx.status().jira.estado, 'pending_authorization');

// ---- login refused on the site: clear message, nothing becomes "connected"
await assert.rejects(cx.retorno('jira', { error: 'access_denied', state: pj.get('state') }), /recusado ou cancelado/);
assert.equal(cx.status().jira.conectado, false); assert.match(cx.status().jira.erro.texto, /recusado/);

// ---- login accepted: encrypted token, real verification and only then "connected"
const cj2 = await cx.conectar('jira', redirect);
await cx.retorno('jira', { code: 'abc', state: new URL(cj2.url).searchParams.get('state') });
st = cx.status().jira;
assert.equal(st.conectado, true); assert.equal(st.estado, 'healthy'); assert.equal(st.ferramentas, 2);
const disco = fs.readFileSync(path.join(tmp, 'data', 'conexoes.json'), 'utf8');
assert(!disco.includes('token-secreto-123') && !disco.includes('refresh-secreto'), 'the token is never stored as plain text on disk');
assert.equal(cx.mcpsDasConexoes()[0].nome, 'jira'); assert.match(cx.mcpsDasConexoes()[0].headers.Authorization, /^Bearer token-secreto-123$/);
assert(!JSON.stringify(cx.status()).includes('token-secreto'), 'the UI never receives the token');

// ---- Notion: same click, with the resource indicator Notion requires
const cn = await cx.conectar('notion', redirect.replace('jira', 'notion'));
assert.equal(new URL(cn.url).searchParams.get('resource'), 'https://mcp.notion.com/mcp');
await cx.retorno('notion', { code: 'xyz', state: new URL(cn.url).searchParams.get('state') });
assert.equal(cx.status().notion.conectado, true);
assert.deepEqual(cx.mcpsDasConexoes().map((m) => m.nome), ['jira', 'notion'], 'leadership receives both MCPs');

// ---- a freshly issued token being refused is NOT "login expired": the UI says the server did not accept it and the app redoes login discovery
mcpResponde = 401; refreshOk = true;
const r0 = await cx.verificar('jira');
assert.equal(r0.estado, 'sync_error'); assert.match(r0.detalhe, /não aceitou/);
assert(!JSON.parse(fs.readFileSync(path.join(tmp, 'data', 'conexoes.json'), 'utf8')).jira.descoberta, 'discovery is redone on the next attempt');
// ---- login expires (old connection): it renews on its own when possible; when not, the UI asks to reconnect and the MCP leaves the agents' calls
{ const arq = path.join(tmp, 'data', 'conexoes.json'); const j = JSON.parse(fs.readFileSync(arq, 'utf8')); const antes = new Date(Date.now() - 3600_000).toISOString(); j.jira.desde = antes; j.notion.desde = antes; fs.writeFileSync(arq, JSON.stringify(j)); }
const r1 = await cx.verificar('jira');
assert.equal(r1.estado, 'authentication_expired', 'server refusing even with a new token');
refreshOk = false;
const r2 = await cx.verificar('notion');
assert.equal(r2.conectado, false); assert.equal(r2.estado, 'authentication_expired'); assert.match(r2.detalhe, /Reconectar/);
assert.equal(cx.mcpsDasConexoes().length, 0, 'an expired connection does not go to agents (avoids calls that only fail)');
mcpResponde = 200; refreshOk = true;
assert.equal((await cx.verificar('jira')).conectado, true, 'responding again: back to connected');

// ---- a network error becomes a plain sentence
assert.match(cx.explicar('jira', 'fetch failed'), /internet|rede/);
assert.match(cx.explicar('teams', 'AADSTS65001: The user or administrator has not consented'), /TI aprove/);

// ---- GitHub without a registered OAuth App: explains and points to a personal token as the way out
assert.equal(cx.status().github.precisaConfig, true);
const g0 = await cx.conectar('github', redirect);
assert.equal(g0.ok, false); assert.match(g0.erro, /token pessoal/);
// a personal token with the wrong format is rejected; with the right format, it is connected only after a real read of /user
assert.equal((await cx.configurar('github', { token: 'abc' })).ok, false);
const gp = await cx.configurar('github', { token: 'ghp_' + 'x'.repeat(36) });
assert.equal(gp.ok, true); assert.equal(gp.status.github.conectado, true); assert.match(gp.status.github.conta, /@deborah/);
assert.equal(gp.status.github.estado, 'healthy'); assert.equal(gp.status.github.ferramentas, 3, 'the official MCP accepted the token');
assert.deepEqual(cx.mcpsDasConexoes().map((m) => m.nome), ['jira', 'github'], 'Notion is still expired from the previous step');
assert.equal(cx.mcpsDasConexoes()[1].url, 'https://api.githubcopilot.com/mcp/');
assert((await cx.proxy('github', '/user/repos')).ok, 'API read with the token injected by the app');
cx.desconectar('github');
// with the Client ID configured: login by code, like Teams, and the app waits for the user to type it
await cx.configurar('github', { clientId: 'Iv1.cliente' });
const g1 = await cx.conectar('github', redirect);
assert.equal(g1.ok, true); assert.equal(g1.codigo, 'ABCD-1234'); assert.equal(g1.url, 'https://github.com/login/device');
assert.equal(cx.status().github.estado, 'pending_authorization'); assert.equal(cx.status().github.codigo.usuario, 'ABCD-1234');
await new Promise((r) => setTimeout(r, 300));
assert.equal(cx.status().github.conectado, true, 'code entered: connected');
assert(!fs.readFileSync(path.join(tmp, 'data', 'conexoes.json'), 'utf8').includes('gho_tokenGithub'), 'GitHub token encrypted on disk');
assert.match(cx.explicar('github', 'expired_token'), /venceu/);

// ---- disconnecting deletes the token
cx.desconectar('jira');
assert.equal(cx.status().jira.conectado, false); assert(!fs.readFileSync(path.join(tmp, 'data', 'conexoes.json'), 'utf8').includes('"jira":{"tokenCifrado"'));
console.log('PASS: plug-and-play connections (Jira and Notion in one click, GitHub by code or personal token with official MCP, connected only after a real query, encrypted token, expired login asks to reconnect, errors in plain language, Teams/Trello explain IT approval).');
process.exit(0);
