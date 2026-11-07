// Direct connections to the Game Director's accounts, global to the app (they apply to every project and template):
//   Jira and Notion: official MCP server (Atlassian, Notion), with OAuth login on their site. The app registers itself (dynamic
//                  client registration) and uses PKCE: the user just clicks Connect and signs in with the account (company SSO, if any).
//   Teams: Microsoft Graph via device code login. Microsoft requires an app registered in Azure by whoever distributes the app
//          (or by the company's IT); without it, the button explains this instead of opening a form.
//   Trello: official Trello authorization; needs the app key that whoever distributes the app generates once.
// "Connected" only shows after a real query against the account (verificar). Tokens are encrypted by Windows when the app runs
// as a program (vault), never enter the text agents read, and never go to logs.
import crypto from 'node:crypto';
import { ler, gravar } from './store.mjs';

const ARQ = 'conexoes.json';
// Jira: v2 is Atlassian's current endpoint; v1 (legacy) goes away in March 2027 and is kept only as a fallback during verification.
export const APPS = {
  jira: { nome: 'Jira', tipo: 'mcp', base: 'https://mcp.atlassian.com', mcp: 'https://mcp.atlassian.com/v2/mcp', alternativas: ['https://mcp.atlassian.com/v1/mcp'], uso: 'demandas, histórico das issues, comentários e sprints' },
  notion: { nome: 'Notion', tipo: 'mcp', base: 'https://mcp.notion.com', mcp: 'https://mcp.notion.com/mcp', recurso: 'https://mcp.notion.com/mcp', uso: 'documentação, requisitos e registros de decisão' },
  // GitHub: device flow login with a free OAuth App registered by whoever distributes NECTAR; agents use GitHub's official
  // MCP with the account's token. Without the app, a personal token pasted in Manual mode also works.
  github: { nome: 'GitHub', tipo: 'github', api: 'https://api.github.com', mcp: 'https://api.githubcopilot.com/mcp/', escopos: 'repo read:org project workflow user', uso: 'repositórios, código, issues, pull requests, projetos e o seu perfil' },
  teams: { nome: 'Teams', tipo: 'graph', api: 'https://graph.microsoft.com/v1.0', escopos: 'offline_access User.Read Calendars.Read OnlineMeetings.Read Chat.Read Files.Read.All Sites.Read.All', uso: 'reuniões, agenda, conversas e documentos' },
  trello: { nome: 'Trello', tipo: 'trello', api: 'https://api.trello.com', uso: 'quadros e cartões' },
};
export const ORDEM = ['jira', 'notion', 'github', 'teams', 'trello'];
// Public identifier of the "NECTAR" OAuth App on GitHub (not a secret: device flow does not use client_secret). Empty until registered.
const GITHUB_CLIENT_ID_PADRAO = process.env.STUDIO_GITHUB_CLIENT_ID || '';
const clientIdGithub = (st) => st.github?.clientId || GITHUB_CLIENT_ID_PADRAO;
const CAB_GITHUB = (token) => ({ Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'NECTAR' });
// States the UI shows. "Connected" requires a real successful read.
const OK = new Set(['connected', 'healthy', 'limited_access']);

const estado = () => ler(ARQ, {});
const salvar = (st) => gravar(ARQ, st);
const pendentes = new Map();   // state -> { app, verifier, redirect, tokenUrl }
const ouvintes = new Set();
export const aoMudar = (fn) => { ouvintes.add(fn); return () => ouvintes.delete(fn); };
const avisar = (app) => { for (const f of ouvintes) { try { f(app); } catch { /* listener threw */ } } };
const b64url = (buf) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const form = (o) => new URLSearchParams(Object.entries(o).filter(([, v]) => v != null)).toString();
async function jsonOk(r) { const t = await r.text(); let j = {}; try { j = JSON.parse(t); } catch { /* not JSON */ } if (!r.ok) { const e = new Error(j.error_description || j.error?.message || j.error || j.message || t.slice(0, 200) || `HTTP ${r.status}`); e.status = r.status; throw e; } return j; }

// ---- vault: the token encrypted by Windows when the app runs as a program; plain text only in development mode ----
const cofre = () => (globalThis.studioCofre?.disponivel?.() ? globalThis.studioCofre : null);
function tokenDe(c) {
  if (!c) return null;
  if (c.tokenCifrado && cofre()) { try { return JSON.parse(cofre().decifrar(c.tokenCifrado)); } catch { return null; } }
  return c.token || null;
}
function guardarTokenEm(c, tk) {
  if (cofre()) { c.tokenCifrado = cofre().cifrar(JSON.stringify(tk)); delete c.token; } else { c.token = tk; delete c.tokenCifrado; }
}

/** Status for the UI (without the token). */
export function status() {
  const st = estado();
  const um = (app) => {
    const c = st[app] || {};
    const tem = !!tokenDe(c)?.access_token;
    const s = c.saude || {};
    const est = !tem ? (pendentesDe(app) ? 'pending_authorization' : s.estado === 'policy_blocked' ? 'policy_blocked' : 'not_configured') : (s.estado || 'connected');
    const dev = (app === 'teams' || app === 'github') && pendentes.get(`dev:${app}`);
    return {
      nome: APPS[app].nome, uso: APPS[app].uso, estado: est, conectado: tem && OK.has(est), conta: c.conta || null, desde: c.desde || null,
      verificado: s.em || null, detalhe: s.detalhe || null, ferramentas: s.ferramentas ?? null, entrando: !!pendentesDe(app), erro: c.ultimoErro || null,
      precisaConfig: (app === 'teams' && !c.clientId) || (app === 'trello' && !c.key) || (app === 'github' && !clientIdGithub(st)),
      ...(app === 'teams' || app === 'github' ? { codigo: dev ? { usuario: dev.userCode, url: dev.url } : null } : {}),
    };
  };
  return { ...Object.fromEntries(ORDEM.map((a) => [a, um(a)])), app: { trelloKey: st.trello?.key || '', teamsClientId: st.teams?.clientId || '', teamsTenant: st.teams?.tenant || 'organizations', githubClientId: st.github?.clientId || '', githubPadrao: !!GITHUB_CLIENT_ID_PADRAO }, cofre: !!cofre() };
}
const pendentesDe = (app) => [...pendentes.values()].some((p) => p.app === app);

export function configurar(app, b = {}) {
  const st = estado(); st[app] ||= {};
  if (app === 'trello' && b.key !== undefined) st.trello.key = String(b.key || '').trim().slice(0, 100);
  if (app === 'teams') { if (b.clientId !== undefined) st.teams.clientId = String(b.clientId || '').trim().slice(0, 64); if (b.tenant !== undefined) st.teams.tenant = String(b.tenant || '').trim().slice(0, 64) || 'organizations'; }
  if (app === 'github') {
    if (b.clientId !== undefined) st.github.clientId = String(b.clientId || '').trim().slice(0, 64);
    salvar(st);
    // personal token (manual mode): only the format is checked here; "connected" still depends on the real query in verificar()
    if (b.token) { const tk = String(b.token).trim(); if (!/^(ghp_|github_pat_|gho_)[A-Za-z0-9_]{20,}$/.test(tk)) return { ok: false, erro: 'Isso não parece um token do GitHub (começa com ghp_ ou github_pat_).' }; return guardarToken('github', { access_token: tk }).then(() => ({ ok: true, status: status() })); }
    return { ok: true, status: status() };
  }
  salvar(st);
  return { ok: true, status: status() };
}

function erroDe(app, msg) { const st = estado(); st[app] ||= {}; st[app].ultimoErro = msg ? { texto: String(msg).slice(0, 300), em: new Date().toISOString() } : null; salvar(st); avisar(app); }

// Scopes the app requests from Jira (when the server publishes the list): read, search and write in Jira, Confluence, JSM and projects,
// plus offline_access (without it there is no refresh token and the login "expires" on its own within an hour).
const ESCOPOS_JIRA = ['offline_access', 'read:me', 'read:jira:agent-interface', 'search:jira:agent-interface', 'write:jira:agent-interface', 'read:confluence:agent-interface', 'search:confluence:agent-interface', 'write:confluence:agent-interface', 'search:rovo:agent-interface', 'read:jsm:agent-interface', 'read:projects:agent-interface', 'read:goals:agent-interface'];
const escoposPara = (app, suportados) => { if (!Array.isArray(suportados) || !suportados.length) return null; const quero = app === 'jira' ? ESCOPOS_JIRA : ['offline_access']; const l = quero.filter((s) => suportados.includes(s)); return l.length ? l : null; };

/**
 * MCP server login discovery, as the spec requires: the server answers 401 pointing to the protected resource
 * metadata, which states the authorization server and scopes; the endpoints come from THAT server's metadata.
 * (Atlassian v2 is authorized by auth.atlassian.com; the old server's token, at mcp.atlassian.com, is not valid there: that was
 * why Jira showed as connected and "expired" seconds later.) Without a 401 with metadata, the old way applies (metadata at the base).
 */
async function descobrirMcp(app) {
  const c = estado()[app] || {};
  if (c.descoberta?.authorization_endpoint && Date.now() - Date.parse(c.descoberta.em || 0) < 24 * 3600_000) return c.descoberta;
  const sinal = () => AbortSignal.timeout(10000);
  let recurso = APPS[app].recurso || null; let asBase = null; let suportados = null;
  try {
    const r = await fetch(APPS[app].mcp, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'NECTAR', version: '1' } } }), signal: sinal() });
    const m = /resource_metadata="([^"]+)"/.exec(r.headers.get('www-authenticate') || '');
    if (m) { const prm = await jsonOk(await fetch(m[1], { signal: sinal() })); recurso = prm.resource || recurso; asBase = prm.authorization_servers?.[0] || null; suportados = prm.scopes_supported || null; }
  } catch { /* no resource metadata: fall through to the base */ }
  const candidatos = [];
  if (asBase) { const u = new URL(asBase); const semBarra = asBase.replace(/\/$/, ''); candidatos.push(`${semBarra}/.well-known/oauth-authorization-server`, `${u.origin}/.well-known/oauth-authorization-server${u.pathname.replace(/\/$/, '')}`, `${semBarra}/.well-known/openid-configuration`); }
  candidatos.push(`${APPS[app].base}/.well-known/oauth-authorization-server`);
  let meta = null;
  for (const u of candidatos) { try { const j = await jsonOk(await fetch(u, { signal: sinal() })); if (j.authorization_endpoint && j.token_endpoint) { meta = j; break; } } catch { /* next candidate */ } }
  if (!meta) throw new Error(`não achei o servidor de login do ${APPS[app].nome}`);
  const d = { issuer: meta.issuer || asBase || APPS[app].base, authorization_endpoint: meta.authorization_endpoint, token_endpoint: meta.token_endpoint, registration_endpoint: meta.registration_endpoint || null, recurso, escopos: escoposPara(app, suportados), em: new Date().toISOString() };
  const st = estado(); st[app] ||= {}; st[app].descoberta = d; salvar(st);
  return d;
}

/** Starts the connection. Returns { url } to open in the browser (or the Teams code). */
export async function conectar(app, redirect) {
  if (!APPS[app]) return { ok: false, erro: 'Conexão desconhecida.' };
  const st = estado(); st[app] ||= {};
  erroDe(app, null);
  try {
    if (APPS[app].tipo === 'mcp') {
      const d = await descobrirMcp(app);
      // the app's port changes on every launch (and the login server may change): registers again when the address or issuer changed
      if (!st[app].client || st[app].client.redirect !== redirect || st[app].client.issuer !== d.issuer) {
        if (!d.registration_endpoint) throw new Error(`o ${APPS[app].nome} não aceita registro automático de aplicativo`);
        const cli = await jsonOk(await fetch(d.registration_endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ client_name: 'NECTAR', redirect_uris: [redirect], grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], token_endpoint_auth_method: 'none', ...(d.escopos ? { scope: d.escopos.join(' ') } : {}) }), signal: AbortSignal.timeout(10000) }));
        st[app].client = { id: cli.client_id, redirect, issuer: d.issuer }; salvar(st);
      }
      const verifier = b64url(crypto.randomBytes(32)), state = b64url(crypto.randomBytes(16));
      pendentes.set(state, { app, verifier, redirect, tokenUrl: d.token_endpoint, recurso: d.recurso, em: Date.now() });
      const url = `${d.authorization_endpoint}?${form({ response_type: 'code', client_id: st[app].client.id, redirect_uri: redirect, code_challenge: b64url(crypto.createHash('sha256').update(verifier).digest()), code_challenge_method: 'S256', state, resource: d.recurso, scope: d.escopos ? d.escopos.join(' ') : undefined })}`;
      avisar(app);
      return { ok: true, url };
    }
    if (app === 'trello') {
      if (!st.trello.key) return { ok: false, precisaConfig: true, erro: 'O Trello ainda não foi liberado neste app. Quem distribui o NECTAR (ou a TI) precisa gerar a chave do aplicativo uma vez, em Configuração da TI.' };
      const state = b64url(crypto.randomBytes(16));
      pendentes.set(state, { app, em: Date.now() });
      const url = `https://trello.com/1/authorize?${form({ expiration: 'never', name: 'NECTAR', scope: 'read', response_type: 'token', key: st.trello.key, callback_method: 'fragment', return_url: `${redirect}?state=${state}` })}`;
      avisar(app);
      return { ok: true, url };
    }
    if (app === 'teams') {
      if (!st.teams.clientId) return { ok: false, precisaConfig: true, erro: 'A Microsoft só deixa conectar o Teams por um aplicativo registrado no Azure da empresa. Peça à TI o ID desse aplicativo e cole em Configuração da TI; depois é só clicar em Conectar.' };
      const tenant = st.teams.tenant || 'organizations';
      const d = await jsonOk(await fetch(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/devicecode`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form({ client_id: st.teams.clientId, scope: APPS.teams.escopos }), signal: AbortSignal.timeout(10000) }));
      const p = { app, userCode: d.user_code, url: d.verification_uri, em: Date.now() };
      pendentes.set('dev:teams', p);
      avisar(app);
      (async () => {   // waits for the user to enter the code on Microsoft's site
        const fim = Date.now() + (d.expires_in || 900) * 1000;
        while (Date.now() < fim && pendentes.get('dev:teams') === p) {
          await new Promise((r) => setTimeout(r, (d.interval || 5) * 1000));
          const r = await fetch(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form({ grant_type: 'urn:ietf:params:oauth:grant-type:device_code', client_id: st.teams.clientId, device_code: d.device_code }) }).catch(() => null);
          if (!r) continue;
          const j = await r.json().catch(() => ({}));
          if (j.access_token) { await guardarToken('teams', j); break; }
          if (j.error && j.error !== 'authorization_pending' && j.error !== 'slow_down') { erroDe('teams', explicar('teams', j.error_description || j.error)); break; }
        }
        pendentes.delete('dev:teams'); avisar('teams');
      })();
      return { ok: true, url: d.verification_uri, codigo: d.user_code };
    }
    if (app === 'github') {
      const cid = clientIdGithub(st);
      if (!cid) return { ok: false, precisaConfig: true, erro: 'O GitHub ainda não foi liberado neste app. Quem distribui o NECTAR registra uma vez um OAuth App gratuito no GitHub e cola o Client ID em Configuração da TI. Enquanto isso, um token pessoal no Modo manual também conecta.' };
      const d = await jsonOk(await fetch('https://github.com/login/device/code', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' }, body: form({ client_id: cid, scope: APPS.github.escopos }), signal: AbortSignal.timeout(10000) }));
      const p = { app, userCode: d.user_code, url: d.verification_uri, em: Date.now() };
      pendentes.set('dev:github', p);
      avisar(app);
      (async () => {   // waits for the user to enter the code at github.com/login/device
        const fim = Date.now() + (d.expires_in || 900) * 1000; let intervalo = (d.interval || 5) * 1000;
        while (Date.now() < fim && pendentes.get('dev:github') === p) {
          await new Promise((r) => setTimeout(r, intervalo));
          const r = await fetch('https://github.com/login/oauth/access_token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' }, body: form({ grant_type: 'urn:ietf:params:oauth:grant-type:device_code', client_id: cid, device_code: d.device_code }) }).catch(() => null);
          if (!r) continue;
          const j = await r.json().catch(() => ({}));
          if (j.access_token) { await guardarToken('github', j); break; }
          if (j.error === 'slow_down') { intervalo += 5000; continue; }
          if (j.error && j.error !== 'authorization_pending') { erroDe('github', explicar('github', j.error_description || j.error)); break; }
        }
        pendentes.delete('dev:github'); avisar('github');
      })();
      return { ok: true, url: d.verification_uri, codigo: d.user_code };
    }
  } catch (e) {
    const msg = explicar(app, e.message);
    erroDe(app, msg);
    return { ok: false, erro: msg };
  }
  return { ok: false, erro: 'Conexão desconhecida.' };
}

/** Technical error in plain language for non-programmers. */
export function explicar(app, msg) {
  const m = String(msg || '');
  const nome = APPS[app]?.nome || app;
  if (/AADSTS65001|consent|admin/i.test(m)) return `A empresa exige que a TI aprove o acesso do NECTAR ao ${nome}. Peça a aprovação e tente de novo.`;
  if (/AADSTS700016|application.*not found|invalid_client/i.test(m)) return `O ID de aplicativo configurado para o ${nome} não existe nessa empresa. Confira com a TI em Configuração da TI.`;
  if (/expired_token|device code.*expired/i.test(m)) return `O código do ${nome} venceu antes de ser digitado. Clique em Conectar para gerar outro.`;
  if (/bad_verification_code|Bad credentials|incorrect_client_credentials/i.test(m)) return `O ${nome} não reconheceu o acesso (token inválido ou Client ID errado). Confira em Configuração da TI ou gere um token novo.`;
  if (/access_denied|denied|cancel/i.test(m)) return `O login no ${nome} foi recusado ou cancelado. Clique em Conectar e autorize de novo.`;
  if (/fetch failed|ENOTFOUND|ECONNREFUSED|timeout|aborted|network/i.test(m)) return `Não consegui falar com o ${nome}. Confira a internet (ou se a rede da empresa bloqueia o site) e tente de novo.`;
  if (/policy|blocked|forbidden|403/i.test(m)) return `A política da empresa bloqueou o acesso ao ${nome} por este app. Só a TI consegue liberar.`;
  return `O ${nome} respondeu com um erro: ${m.slice(0, 160)}`;
}

async function guardarToken(app, j) {
  const st = estado(); st[app] ||= {};
  const antigo = tokenDe(st[app]) || {};
  guardarTokenEm(st[app], { access_token: j.access_token, refresh_token: j.refresh_token || antigo.refresh_token || null, expira: j.expires_in ? Date.now() + j.expires_in * 1000 : null, tokenUrl: j.tokenUrl || antigo.tokenUrl, recurso: j.recurso || antigo.recurso || null });
  st[app].desde ||= new Date().toISOString();
  st[app].ultimoErro = null;
  salvar(st);
  await verificar(app).catch(() => {});
  avisar(app);
}

/** Browser callback (Jira and Notion: ?code; Trello: the token comes in the fragment and the page forwards it here). */
export async function retorno(app, q) {
  if (q.error) { const msg = explicar(app, `${q.error} ${q.error_description || ''}`); erroDe(app, msg); throw new Error(msg); }
  const p = pendentes.get(q.state);
  if (!p || p.app !== app) throw new Error('Esse retorno não bate com nenhuma conexão em andamento (o app pode ter sido reaberto no meio). Clique em Conectar de novo.');
  pendentes.delete(q.state);
  try {
    if (APPS[app].tipo === 'mcp') {
      const st = estado();
      const j = await jsonOk(await fetch(p.tokenUrl, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form({ grant_type: 'authorization_code', code: q.code, redirect_uri: p.redirect, client_id: st[app].client.id, code_verifier: p.verifier, resource: p.recurso || APPS[app].recurso }), signal: AbortSignal.timeout(15000) }));
      await guardarToken(app, { ...j, tokenUrl: p.tokenUrl, recurso: p.recurso || APPS[app].recurso || null });
    } else if (app === 'trello') {
      if (!/^[A-Za-z0-9]{32,128}$/.test(q.token || '')) throw new Error('O Trello não devolveu a autorização.');
      await guardarToken('trello', { access_token: q.token });
    }
  } catch (e) { const msg = explicar(app, e.message); erroDe(app, msg); throw new Error(msg); }
  avisar(app);
  return { ok: true, status: status()[app] };
}

export function cancelar(app) { for (const [k, p] of pendentes) if (p.app === app) pendentes.delete(k); avisar(app); return { ok: true }; }
/** Disconnecting deletes the token and what was verified; each project's evidence ledger stays (they are references, not the account). */
export function desconectar(app) { const st = estado(); if (st[app]) { delete st[app].token; delete st[app].tokenCifrado; delete st[app].conta; delete st[app].desde; delete st[app].saude; delete st[app].ultimoErro; } salvar(st); cancelar(app); return { ok: true }; }

/** Refreshes a token that expires soon. `forcar` refreshes even when far from expiry (after a 401). */
export async function renovar(app, { forcar = false } = {}) {
  const st = estado(); const c = st[app]; const tk = tokenDe(c);
  if (!tk?.refresh_token) return false;
  if (!forcar && (!tk.expira || tk.expira - Date.now() > 10 * 60_000)) return false;
  const url = app === 'teams' ? `https://login.microsoftonline.com/${c.tenant || 'organizations'}/oauth2/v2.0/token` : tk.tokenUrl;
  const corpo = app === 'teams' ? { grant_type: 'refresh_token', refresh_token: tk.refresh_token, client_id: c.clientId, scope: APPS.teams.escopos } : { grant_type: 'refresh_token', refresh_token: tk.refresh_token, client_id: c.client?.id, resource: tk.recurso || APPS[app].recurso };
  try {
    const j = await jsonOk(await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form(corpo), signal: AbortSignal.timeout(15000) }));
    const st2 = estado(); guardarTokenEm(st2[app], { access_token: j.access_token, refresh_token: j.refresh_token || tk.refresh_token, expira: j.expires_in ? Date.now() + j.expires_in * 1000 : null, tokenUrl: tk.tokenUrl, recurso: tk.recurso || null }); salvar(st2);
    return true;
  } catch { return false; }   // refresh failed: verificar() marks "reconnect"
}

// ---- real verification: "connected" only shows after a read the account allowed ----
async function rpcMcp(url, token, corpo, sessao) {
  const h = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Authorization: `Bearer ${token}` };
  if (sessao) h['Mcp-Session-Id'] = sessao;
  const r = await fetch(url, { method: 'POST', headers: h, body: JSON.stringify(corpo), signal: AbortSignal.timeout(20000) });
  const texto = await r.text();
  let j = null;
  try { j = JSON.parse(texto); } catch { const linha = texto.split('\n').find((l) => l.startsWith('data:')); try { j = linha ? JSON.parse(linha.slice(5)) : null; } catch { j = null; } }
  return { status: r.status, sessao: r.headers.get('mcp-session-id') || sessao, json: j };
}
async function verificarMcp(app, token) {
  let ultimo = null;
  for (const url of [APPS[app].mcp, ...(APPS[app].alternativas || [])]) {
    const ini = await rpcMcp(url, token, { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'NECTAR', version: '1' } } });
    ultimo = ini;
    if (ini.status === 401 || ini.status === 403) continue;   // this endpoint refused: the token may be valid for the other one (v1 and v2 have different issuers)
    if (ini.status >= 300 || !ini.json?.result) continue;
    await rpcMcp(url, token, { jsonrpc: '2.0', method: 'notifications/initialized' }, ini.sessao).catch(() => {});
    const tools = await rpcMcp(url, token, { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }, ini.sessao);
    const lista = tools.json?.result?.tools || [];
    return { status: 200, url, ferramentas: lista.length, nomes: lista.map((t) => t.name).slice(0, 80), servidor: ini.json.result.serverInfo?.name || null };
  }
  return { status: ultimo?.status || 0 };
}
export async function verificar(app) {
  const st = estado(); const c = st[app];
  let tk = tokenDe(c);
  if (!tk?.access_token) return status()[app];
  const marcar = (estadoNovo, detalhe, extra = {}) => { const s2 = estado(); s2[app] ||= {}; s2[app].saude = { estado: estadoNovo, detalhe, em: new Date().toISOString(), ...extra }; salvar(s2); avisar(app); return status()[app]; };
  try {
    await renovar(app);
    tk = tokenDe(estado()[app]);
    if (APPS[app].tipo === 'mcp') {
      let r = await verificarMcp(app, tk.access_token);
      if (r.status === 401 && await renovar(app, { forcar: true })) { tk = tokenDe(estado()[app]); r = await verificarMcp(app, tk.access_token); }
      if (r.status === 200) { const s2 = estado(); if (r.url && r.url !== APPS[app].mcp) s2[app].mcpUrl = r.url; salvar(s2); return marcar(r.ferramentas ? 'healthy' : 'limited_access', r.ferramentas ? `${r.ferramentas} ferramentas de leitura e escrita disponíveis pelo MCP${r.servidor ? ` (${r.servidor})` : ''}.` : 'Conectou, mas o servidor não listou ferramentas.', { ferramentas: r.ferramentas, nomes: r.nomes }); }
      if (r.status === 401) {
        // a freshly issued token being refused is not "expired": it is the server not accepting this access (wrong issuer, missing scope)
        const recente = c?.desde && Date.now() - Date.parse(c.desde) < 3 * 60_000;
        if (recente) { const s3 = estado(); if (s3[app]) delete s3[app].descoberta; salvar(s3); return marcar('sync_error', `O ${APPS[app].nome} não aceitou o acesso que acabou de conceder. Clique em Reconectar (o app refaz a descoberta do login); se repetir, a empresa pode ter restringido o MCP.`); }
        return marcar('authentication_expired', `O login no ${APPS[app].nome} venceu. Clique em Reconectar.`);
      }
      if (r.status === 403) return marcar('permission_denied', `A conta não tem permissão (ou a empresa ainda não liberou o MCP do ${APPS[app].nome}).`);
      return marcar('sync_error', `O ${APPS[app].nome} não respondeu como esperado (HTTP ${r.status}).`);
    }
    const resp = app === 'teams' ? await proxyCru('teams', '/me', '', tk) : app === 'github' ? await proxyCru('github', '/user', '', tk) : await proxyCru('trello', '/1/members/me', 'fields=fullName,username,email', tk);
    if (resp.status === 401) { if (await renovar(app, { forcar: true })) return verificar(app); return marcar('authentication_expired', `O login no ${APPS[app].nome} venceu. Clique em Reconectar.`); }
    if (resp.status === 403) return marcar('permission_denied', `A conta não tem permissão para ler no ${APPS[app].nome}.`);
    if (!resp.ok) return marcar('sync_error', `O ${APPS[app].nome} respondeu HTTP ${resp.status}.`);
    const j = await resp.json();
    const conta = app === 'teams' ? (j.displayName ? `${j.displayName}${j.mail ? ` (${j.mail})` : ''}` : null) : app === 'github' ? (j.login ? `${j.name || j.login} (@${j.login})` : null) : (j.fullName ? `${j.fullName}${j.email ? ` (${j.email})` : ''}` : null);
    const s2 = estado(); s2[app].conta = conta || s2[app].conta || null; salvar(s2);
    if (app === 'github') {   // the official MCP is what the agents use; if it does not accept the token, the API through the proxy remains (read only)
      const r = await verificarMcp('github', tk.access_token).catch(() => ({ status: 0 }));
      if (r.status === 200 && r.ferramentas) return marcar('healthy', `Conta lida e ${r.ferramentas} ferramentas disponíveis pelo MCP do GitHub.`, { ferramentas: r.ferramentas, nomes: r.nomes });
      return marcar('limited_access', `Conta lida. O MCP do GitHub não aceitou este token (HTTP ${r.status}); os agentes leem pela API, sem escrever.`);
    }
    return marcar('healthy', 'Leitura de teste feita com a sua conta.');
  } catch (e) { return marcar('sync_error', explicar(app, e.message)); }
}
setInterval(() => { for (const a of ORDEM) if (tokenDe(estado()[a])?.access_token) verificar(a).catch(() => {}); }, 15 * 60_000).unref?.();

async function proxyCru(app, caminho, query, tk) {
  const c = estado()[app];
  if (app === 'teams') return fetch(`${APPS.teams.api}${caminho}${query ? `?${query}` : ''}`, { headers: { Authorization: `Bearer ${tk.access_token}` }, signal: AbortSignal.timeout(20000) });
  if (app === 'github') return fetch(`${APPS.github.api}${caminho}${query ? `?${query}` : ''}`, { headers: CAB_GITHUB(tk.access_token), signal: AbortSignal.timeout(20000) });
  return fetch(`${APPS.trello.api}${caminho}?${[query, form({ key: c.key, token: tk.access_token })].filter(Boolean).join('&')}`, { signal: AbortSignal.timeout(20000) });
}
/** Read on the connected account (Trello and Teams), with the token injected by the app. GET only: writing is the Game Director's decision. */
export async function proxy(app, caminho, query = '') {
  if (!['teams', 'trello', 'github'].includes(app)) throw new Error('Esta conexão é usada pelo MCP, não pelo proxy.');
  const tk = tokenDe(estado()[app]);
  if (!tk?.access_token) throw new Error(`${APPS[app]?.nome || app} não está conectado.`);
  if (app === 'teams') await renovar('teams');
  return proxyCru(app, caminho, query, tokenDe(estado()[app]));
}

/** MCP server for a connection (Jira, Notion), with the current token, to include in the call of whoever may use it. */
export function mcpDe(app) {
  const c = estado()[app]; const tk = tokenDe(c);
  const temMcp = APPS[app]?.tipo === 'mcp' || (app === 'github' && c?.saude?.ferramentas);   // GitHub only gets in once the MCP has accepted the token
  if (!tk?.access_token || !temMcp || !OK.has(c.saude?.estado || 'connected')) return null;
  return { nome: app, tipo: 'http', url: c.mcpUrl || APPS[app].mcp, headers: { Authorization: `Bearer ${tk.access_token}` } };
}
export const mcpDoJira = () => mcpDe('jira');
/** All connection MCPs that are up (for the lead and for whoever collects evidence). */
export const mcpsDasConexoes = () => ORDEM.map(mcpDe).filter(Boolean);
export const conectadas = () => ORDEM.filter((k) => status()[k].conectado);
