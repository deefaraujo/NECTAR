// Contas do Claude e do Codex: conectar, ver o status e desconectar, para o app funcionar em qualquer computador.
// Quem guarda o login é o próprio CLI (Claude Code e Codex); o app só chama os comandos oficiais:
//   claude auth status | claude auth login --claudeai | claude auth logout
//   codex login status | codex login | codex logout
// O login abre o site da Anthropic ou do ChatGPT no navegador. Se o navegador não abrir, o endereço que o CLI
// imprimir aparece na tela para a pessoa clicar.
import { spawn } from 'node:child_process';
import { localizarClaude, localizarCodex, matar } from './runner.mjs';

const MOTORES = ['claude', 'codex'];
const cache = new Map();          // engine -> { em, dados }
const logins = new Map();         // engine -> { proc, url, saida, inicio }
const ouvintes = new Set();
export const aoMudar = (fn) => { ouvintes.add(fn); return () => ouvintes.delete(fn); };
const avisar = (engine) => { cache.delete(engine); for (const f of ouvintes) { try { f(engine); } catch { /* ouvinte com erro não derruba */ } } };

const bin = (engine, cfg = {}) => (engine === 'codex' ? localizarCodex(cfg.codexExe) : localizarClaude(cfg.claudeExe));
const ARGS = {
  claude: { status: ['auth', 'status'], login: ['auth', 'login', '--claudeai'], logout: ['auth', 'logout'] },
  codex: { status: ['login', 'status'], login: ['login'], logout: ['logout'] },
};

function rodar(b, args, ms = 20000) {
  return new Promise((resolve) => {
    let saida = '', p;
    try { p = spawn(b.cmd, args, { shell: b.shell, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }); }
    catch (e) { return resolve({ codigo: -1, saida: String(e.message) }); }
    const t = setTimeout(() => { matar(p); resolve({ codigo: -2, saida }); }, ms);
    p.stdout.on('data', (d) => { saida += d; }); p.stderr.on('data', (d) => { saida += d; });
    p.on('error', (e) => { clearTimeout(t); resolve({ codigo: -1, saida: String(e.message) }); });
    p.on('close', (codigo) => { clearTimeout(t); resolve({ codigo, saida }); });
  });
}

/** { instalado, conectado, email, plano, metodo, versao, entrando, url } */
export async function status(engine, cfg = {}, forcar = false) {
  if (!MOTORES.includes(engine)) throw new Error('motor desconhecido');
  const c = cache.get(engine);
  const lg = logins.get(engine);
  const extra = lg ? { entrando: true, url: lg.url || null } : { entrando: false };
  if (!forcar && c && Date.now() - c.em < 30_000) return { ...c.dados, ...extra };
  const b = await bin(engine, cfg);
  const r = await rodar(b, ARGS[engine].status);
  let dados;
  if (r.codigo === -1 || /ENOENT|not recognized|não é reconhecido|command not found/i.test(r.saida)) dados = { instalado: false, conectado: false };
  else if (engine === 'claude') {
    let j = null; try { j = JSON.parse(r.saida.slice(r.saida.indexOf('{'))); } catch { /* saída não é JSON */ }
    dados = j ? { instalado: true, conectado: !!j.loggedIn, email: j.email || null, plano: j.subscriptionType || null, metodo: j.authMethod || null } : { instalado: true, conectado: false };
  } else {
    const conectado = /logged in/i.test(r.saida) && !/not logged in/i.test(r.saida);
    dados = { instalado: true, conectado, metodo: conectado ? (/chatgpt/i.test(r.saida) ? 'ChatGPT' : /api key/i.test(r.saida) ? 'Chave de API' : 'Conta') : null };
  }
  dados.versao = b.versao || null;
  cache.set(engine, { em: Date.now(), dados });
  return { ...dados, ...extra };
}

/** Abre o login oficial (navegador). Termina sozinho quando a pessoa autentica; quem chama acompanha pelo status. */
export async function conectar(engine, cfg = {}) {
  if (!MOTORES.includes(engine)) throw new Error('motor desconhecido');
  if (logins.has(engine)) return { ok: true, entrando: true, url: logins.get(engine).url || null };
  const b = await bin(engine, cfg);
  let p;
  try { p = spawn(b.cmd, ARGS[engine].login, { shell: b.shell, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] }); }
  catch (e) { return { ok: false, erro: `Não consegui abrir o login: ${e.message}` }; }
  const lg = { proc: p, url: null, saida: '', inicio: Date.now() };
  logins.set(engine, lg);
  const ler = (d) => {
    lg.saida = (lg.saida + d).slice(-4000);
    const u = lg.saida.match(/https:\/\/[^\s"'<>]+/g);
    if (u && !lg.url) { lg.url = u.find((x) => /claude|anthropic|openai|chatgpt|auth/i.test(x)) || u[0]; avisar(engine); }
    if (/press enter|pressione enter/i.test(d)) { try { p.stdin.write('\n'); } catch { /* sem entrada */ } }
  };
  p.stdout.on('data', ler); p.stderr.on('data', ler);
  const fim = () => { logins.delete(engine); avisar(engine); };
  p.on('close', fim); p.on('error', fim);
  setTimeout(() => { if (logins.get(engine) === lg) { matar(p); fim(); } }, 10 * 60_000);   // login abandonado
  return { ok: true, entrando: true };
}

export function cancelarLogin(engine) { const lg = logins.get(engine); if (lg) { matar(lg.proc); logins.delete(engine); avisar(engine); } return { ok: true }; }

export async function desconectar(engine, cfg = {}) {
  if (!MOTORES.includes(engine)) throw new Error('motor desconhecido');
  cancelarLogin(engine);
  const r = await rodar(await bin(engine, cfg), ARGS[engine].logout);
  avisar(engine);
  return r.codigo === 0 ? { ok: true } : { ok: false, erro: r.saida.trim().slice(0, 300) || 'O CLI não confirmou a saída.' };
}

/** Como instalar, quando o CLI não está no computador. */
export const COMO_INSTALAR = {
  claude: { win: 'irm https://claude.ai/install.ps1 | iex', unix: 'curl -fsSL https://claude.ai/install.sh | bash', npm: 'npm install -g @anthropic-ai/claude-code', site: 'https://docs.claude.com/en/docs/claude-code/setup' },
  codex: { npm: 'npm install -g @openai/codex', site: 'https://github.com/openai/codex' },
};
