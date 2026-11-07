// MCPs connected to the app: servers that give the team access to other tools (Figma, Higgsfield, Unreal...).
// Two sources: the ones already configured in this machine's Claude Code (~/.claude.json, read on the fly, without copying
// any key) and the ones registered by hand here. Only the MCP agent receives these servers in its calls; the other
// agents ask it via mcp.pedir, choosing a server from the list. That way regular calls stay light.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ler, gravar } from './store.mjs';
import { mcpsDasConexoes, APPS as APPS_CONEXAO } from './conexoes.mjs';

const arq = () => 'mcp.json';   // in the app's data folder
const NOME = /^[a-z0-9][a-z0-9_-]{0,39}$/i;
const estado = () => ler(arq(), { manuais: [], ativos: {}, descricoes: {} });

function doClaudeCode() {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.claude.json'), 'utf8'));
    return Object.entries(j.mcpServers || {}).map(([nome, c]) => ({ nome, origem: 'claude', tipo: c.type === 'http' || c.type === 'sse' || c.url ? (c.type === 'sse' ? 'sse' : 'http') : 'stdio', config: c }));
  } catch { return []; }
}

/** List for the UI and for the agents' request (without secrets). */
export function listar() {
  const st = estado();
  const todos = [...mcpsDasConexoes().map((c) => ({ nome: c.nome, origem: 'conexao', tipo: 'http', config: c })), ...doClaudeCode(), ...st.manuais.map((m) => ({ nome: m.nome, origem: 'manual', tipo: m.tipo, config: m }))];
  const vistos = new Set();
  return todos.filter((s) => (vistos.has(s.nome) ? false : vistos.add(s.nome))).map((s) => ({
    nome: s.nome, origem: s.origem, tipo: s.tipo, ativo: s.origem === 'conexao' || (st.ativos[s.nome] !== false && (s.origem === 'manual' || st.ativos[s.nome] === true)),
    descricao: st.descricoes[s.nome] || (s.origem === 'conexao' ? `${APPS_CONEXAO[s.nome]?.nome || s.nome} da Game Director (conta conectada em Conexões): ${APPS_CONEXAO[s.nome]?.uso || ''}` : ''), alvo: s.tipo === 'stdio' ? [s.config.command, ...(s.config.args || [])].join(' ').slice(0, 120) : String(s.config.url || '').replace(/\?.*$/, ''),
  }));
}
export const ativos = () => listar().filter((s) => s.ativo);

/** Full configuration (with env and headers) only when building the MCP agent's call. */
export function configs(nomes = null) {
  const quero = new Set(nomes || ativos().map((s) => s.nome));
  const st = estado();
  const fonte = [...mcpsDasConexoes().map((c) => ({ nome: c.nome, tipo: 'http', config: c })), ...doClaudeCode(), ...st.manuais.map((m) => ({ nome: m.nome, tipo: m.tipo, config: m }))];
  const out = [];
  for (const s of fonte) {
    if (!quero.has(s.nome) || out.some((o) => o.nome === s.nome) || !ativos().some((a) => a.nome === s.nome)) continue;
    const c = s.config;
    const readTools=st.readTools?.[s.nome]||[];
    out.push(s.tipo === 'stdio' ? { nome: s.nome, tipo: 'stdio', command: c.command || c.comando, args: c.args || [], env: c.env || {},readTools } : { nome: s.nome, tipo: s.tipo, url: c.url, headers: c.headers || {},readTools });
  }
  return out;
}

export function definir(nome, { ativo, descricao, readTools } = {}) {
  const st = estado();
  if (!listar().some((s) => s.nome === nome)) return { ok: false, erro: 'MCP não encontrado.' };
  if (typeof ativo === 'boolean') st.ativos[nome] = ativo;
  if (descricao !== undefined) st.descricoes[nome] = String(descricao || '').trim().slice(0, 160);
  if(readTools!==undefined){if(!Array.isArray(readTools)||readTools.some(t=>typeof t!=='string'||!/^[a-zA-Z0-9_-]+$/.test(t)))return {ok:false,erro:'Ferramentas de leitura inválidas.'};(st.readTools ||= {})[nome]=[...new Set(readTools)];}
  gravar(arq(), st);
  return { ok: true, lista: listar() };
}

export function adicionar(b = {}) {
  const st = estado();
  const nome = String(b.nome || '').trim();
  if (!NOME.test(nome)) return { ok: false, erro: 'Nome: letras, números, hífen ou sublinhado (até 40).' };
  if (listar().some((s) => s.nome === nome)) return { ok: false, erro: 'Já existe um MCP com esse nome.' };
  const tipo = ['stdio', 'http', 'sse'].includes(b.tipo) ? b.tipo : 'http';
  let env = {}, headers = {};
  try { env = b.env ? JSON.parse(b.env) : {}; headers = b.headers ? JSON.parse(b.headers) : {}; } catch { return { ok: false, erro: 'Variáveis e cabeçalhos em JSON, como {"CHAVE":"valor"}.' }; }
  if (tipo === 'stdio') {
    const comando = String(b.comando || '').trim();
    if (!comando) return { ok: false, erro: 'Informe o comando que sobe o servidor.' };
    st.manuais.push({ nome, tipo, command: comando, args: String(b.args || '').trim() ? String(b.args).trim().split(/\s+/) : [], env });
  } else {
    if (!/^https?:\/\//.test(String(b.url || ''))) return { ok: false, erro: 'Informe a URL do servidor (https://...).' };
    st.manuais.push({ nome, tipo, url: String(b.url).trim(), headers });
  }
  if (b.descricao) st.descricoes[nome] = String(b.descricao).trim().slice(0, 160);
  gravar(arq(), st);
  return { ok: true, lista: listar() };
}

export function remover(nome) {
  const st = estado();
  const antes = st.manuais.length;
  st.manuais = st.manuais.filter((m) => m.nome !== nome);
  if (st.manuais.length === antes) return { ok: false, erro: 'Só dá para remover MCP cadastrado aqui; os do Claude Code se desligam.' };
  delete st.ativos[nome]; delete st.descricoes[nome];
  gravar(arq(), st);
  return { ok: true, lista: listar() };
}
