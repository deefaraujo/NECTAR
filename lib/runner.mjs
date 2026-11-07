// Executor: calls Claude Code or Codex from the command line, using the login that already exists on the
// machine (no API key). The request text goes through standard input, never assembled inside the
// command, so what you type never becomes a shell argument. The agent's persona goes inside the
// request: that way the app works in any folder, even without agent files in it.
import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { executarFalso } from './falso.mjs';
import { lerConfig } from './store.mjs';
import { registrar as registrarUso, registrarCodex } from './creditos.mjs';
import { resolverPolitica, FERRAMENTAS_LEITURA } from './politica.mjs';

const FAKE = process.env.STUDIO_FAKE === '1';
const NODE_EXECUTABLE = process.versions.electron ? 'node' : process.execPath;
// Ephemeral files belong to a PID. A crash does not leave MCP credentials
// lying around indefinitely; never remove files of a live process.
for(const name of fs.readdirSync(os.tmpdir())){
  const match=/^nectar-(?:system|mcp|grant|policy)-(\d+)-[a-f0-9-]+\.(?:json|txt)(?:\.audit)?$/.exec(name);if(!match)continue;
  let morto=false;try{process.kill(Number(match[1]),0);}catch(e){morto=e.code==='ESRCH';}
  if(morto)try{const file=path.join(os.tmpdir(),name);if(fs.lstatSync(file).isFile())fs.unlinkSync(file);}catch{}
}
const limiteMs = () => Math.max(5, lerConfig().ciclo?.limiteChamadaMin || 30) * 60 * 1000; // a big task must not die halfway

const ATIVIDADE = {
  Read: 'lendo arquivos', Glob: 'procurando arquivos', Grep: 'procurando no código',
  Edit: 'editando arquivos', Write: 'escrevendo arquivos', NotebookEdit: 'editando',
  Bash: 'rodando um comando', WebFetch: 'lendo uma página', WebSearch: 'pesquisando na web',
  Task: 'tentando abrir um subagente', Agent: 'tentando abrir um subagente',
  TodoWrite: 'organizando os passos', Skill: 'consultando uma skill',
};

const aspas = (a) => (/[\s"&|<>^]/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a);

export function matar(proc) {
  if(proc?.abort){proc.abort();return;}
  if (!proc || !proc.pid) return;
  if (process.platform === 'win32') spawn('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { windowsHide: true });
  else proc.kill('SIGTERM');
}
// Full access authorized by the Game Director: it is the default. Grant/sandbox isolation only applies with acesso: 'restrito' in the config.
export const acessoTotal = (cfg = lerConfig()) => cfg.acesso !== 'restrito';

// Deferred process for jobs: the call stays synchronous, but CLI discovery
// is async. Canceling before the spawn also prevents execution.
export function comandoIsolado(comando,{cwd,grant=null,env={}}={}) {
  if (acessoTotal()) return spawn(comando, { cwd, shell: true, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, ...env } });
  const proxy=new EventEmitter();proxy.stdout=new PassThrough();proxy.stderr=new PassThrough();let child=null,cancelled=false;
  proxy.abort=()=>{cancelled=true;if(child)matar(child);};
  (async()=>{try{const bin=await localizarCodex(lerConfig().codexExe);if(cancelled){proxy.emit('close',-1);return;}if(bin.shell)throw new Error('tool_unavailable: CLI nativo necessário para sandbox');
    const launch="const {spawn}=require('node:child_process');const c=spawn(Buffer.from(process.argv[1],'base64').toString('utf8'),{shell:true,stdio:'inherit'});c.on('error',e=>{console.error(e.message);process.exitCode=1});c.on('close',code=>{process.exitCode=code??1});";
    const shell=[NODE_EXECUTABLE,'--preserve-symlinks','--preserve-symlinks-main','-e',launch,Buffer.from(comando).toString('base64')];
    child=spawn(bin.cmd,['sandbox','--permission-profile','nectar','-C',cwd,...configPerfilCodex({cwd,grant}),'--',...shell],{cwd,windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...process.env,...env,NODE_OPTIONS:'--preserve-symlinks --preserve-symlinks-main'}});proxy.pid=child.pid;
    child.stdout.on('data',d=>proxy.stdout.write(d));child.stderr.on('data',d=>proxy.stderr.write(d));child.on('error',e=>proxy.emit('error',e));child.on('close',code=>proxy.emit('close',code));
  }catch(e){proxy.emit('error',e);proxy.emit('close',-1);}})();return proxy;
}

// Tools the team actually uses. The Claude Code default loads more than 20 (todo list, notebook, scheduler, notification...)
// and costs ~33k base tokens on EVERY call; these cost ~15k (measured), without losing any team function.
export const FERRAMENTAS_CLAUDE = 'Read,Grep,Glob,Bash,Edit,Write,WebFetch,WebSearch';
export function argsClaude({ modelo, esforco, addDirs = [], sistemaArq = null, ferramentas = FERRAMENTAS_CLAUDE, mcpArq = null, settingsArq = null, somenteLeitura = false, grant = null, cwd = '.', total = acessoTotal() }) {
  const a = [
    '-p', '--output-format', 'stream-json', '--verbose', '--include-partial-messages',
    '--no-session-persistence',
    '--strict-mcp-config', // no MCP: chat does not need to start Unreal, Figma etc.
  ];
  if (mcpArq) a.push('--mcp-config', mcpArq);   // only the MCP agent gets the chosen servers
  if(settingsArq) a.push('--settings',settingsArq);
  if (modelo) a.push('--model', modelo);
  if (esforco) a.push('--effort', esforco);
  if (addDirs.length) a.push('--add-dir', ...addDirs);
  // The fixed part of the request (persona, rules, protocol) goes as the system prompt, which the CLI caches between calls:
  // in one measurement, the same call cost 60% less than with the text in the request.
  if (sistemaArq) a.push('--append-system-prompt-file', sistemaArq);
  if (total) {
    if (ferramentas) a.push('--tools', ferramentas);
    a.push('--disallowedTools', 'Task,Agent'); // a Claude subagent is invisible to the team: colleagues are called with @
    a.push('--dangerously-skip-permissions');  // the mode governs the task, not the filesystem
    return a;
  }
  const politica = resolverPolitica({ engine: 'claude', cwd, somenteLeitura, grant });
  // Closed list: do not offer Bash in Claude without a verifiable OS sandbox.
  const permitidas = (somenteLeitura ? FERRAMENTAS_LEITURA : politica.ferramentas).split(',');
  const selecionadas = (ferramentas ? ferramentas.split(',').filter(t => permitidas.includes(t)) : permitidas).filter(t=>!grant||grant.network==='allow'||!['WebFetch','WebSearch'].includes(t));
  a.push('--tools', selecionadas.join(','), '--permission-mode', 'dontAsk');
  a.push('--max-budget-usd',String(Math.min(5,Math.max(.01,grant?.maxCost||1))));
  const absPattern=p=>'//'+path.resolve(p).replace(/\\/g,'/').replace(/^([A-Za-z]):/,(_,d)=>d.toLowerCase()).replace(/^\//,'')+'/**';
  const allowed=selecionadas.filter(t=>!['Edit','Write'].includes(t));
  if(selecionadas.includes('Edit')||selecionadas.includes('Write')) allowed.push(...politica.writePaths.map(p=>`Edit(${absPattern(p)})`));
  if (allowed.length) a.push('--allowedTools', allowed.join(','));
  a.push('--disallowedTools', somenteLeitura ? 'Bash,Edit,Write,NotebookEdit,Agent,Task' : 'Bash,NotebookEdit,Agent,Task');
  return a;
}

const toml = (v) => (Array.isArray(v) ? `[${v.map(toml).join(',')}]` : v && typeof v === 'object' ? `{${Object.entries(v).map(([k, x]) => `${JSON.stringify(k)}=${toml(x)}`).join(',')}}` : typeof v==='boolean'||typeof v==='number'?String(v):JSON.stringify(String(v)));
export function configPerfilCodex({cwd,grant=null,somenteLeitura=false}) {
  const politica=resolverPolitica({engine:'codex',cwd,grant,somenteLeitura});
  const fsRules={':root':'deny',':minimal':'read',':workspace_roots':{'.':politica.escrita?'write':'read','.git':'read','.codex':'read','.agents':'read','.aws':'deny','.env':'deny','.env.*':'deny','*.pem':'deny'}};
  for(const p of grant?.readPaths||[])fsRules[path.resolve(p)]='read';
  for(const p of politica.writePaths)fsRules[path.resolve(p)]='write';
  for(const p of politica.denyPaths)fsRules[path.resolve(p)]='deny';
  const toolEnv={PATH:process.env.PATH||process.env.Path||'',NODE_OPTIONS:'--preserve-symlinks --preserve-symlinks-main'};
  if(process.platform==='win32')Object.assign(toolEnv,{SYSTEMROOT:process.env.SYSTEMROOT||process.env.SystemRoot||'C:\\Windows',WINDIR:process.env.WINDIR||'C:\\Windows',COMSPEC:process.env.COMSPEC||process.env.ComSpec||'C:\\Windows\\System32\\cmd.exe',PATHEXT:process.env.PATHEXT||'.COM;.EXE;.BAT;.CMD',TEMP:process.env.TEMP||os.tmpdir(),TMP:process.env.TMP||os.tmpdir()});
  return [...(process.platform==='win32'?['-c','windows.sandbox="mxc"']:[]),'-c','default_permissions="nectar"','-c',`permissions.nectar.filesystem=${toml(fsRules)}`,'-c','permissions.nectar.network.enabled=false','-c','approval_policy="never"','-c','shell_environment_policy.inherit="none"','-c',`shell_environment_policy.set=${toml(toolEnv)}`];
}
export function argsCodex({ modelo, esforco, addDirs = [], cwd, mcp = null, somenteLeitura = false, grant = null, total = acessoTotal() }) {
  if (total) {
    const a = ['exec', '--json', '--skip-git-repo-check', '-C', cwd, '--dangerously-bypass-approvals-and-sandbox'];
    for (const s of mcp || []) {   // MCPs chosen for the MCP agent, on top of config.toml
      const k = `mcp_servers.${s.nome}`;
      if (s.tipo === 'stdio') { a.push('-c', `${k}.command=${toml(s.command)}`, '-c', `${k}.args=${toml(s.args || [])}`); if (Object.keys(s.env || {}).length) a.push('-c', `${k}.env=${toml(s.env)}`); }
      else { a.push('-c', `${k}.url=${toml(s.url)}`); if (Object.keys(s.headers || {}).length) a.push('-c', `${k}.http_headers=${toml(s.headers)}`); }
    }
    if (modelo) a.push('-m', modelo);
    if (esforco) a.push('-c', `model_reasoning_effort=${esforco}`);
    for (const d of addDirs) a.push('--add-dir', d);
    a.push('-');
    return a;
  }
  const politica = resolverPolitica({ engine: 'codex', cwd, somenteLeitura, grant });
  const a = ['exec', '--json', '--skip-git-repo-check', '--ignore-user-config', '--ignore-rules', '-C', cwd, '-c','project_doc_max_bytes=0', ...configPerfilCodex({cwd,grant,somenteLeitura})];
  for (const s of mcp || []) {   // MCPs chosen for the MCP agent, on top of config.toml
    const k = `mcp_servers.${s.nome}`;
    a.push('-c',`${k}.enabled_tools=${toml(grant?.permissions?.includes('connector.read') ? s.readTools || [] : [])}`);
    if (s.tipo === 'stdio') { a.push('-c', `${k}.command=${toml(s.command)}`, '-c', `${k}.args=${toml(s.args || [])}`); if (Object.keys(s.env || {}).length) a.push('-c', `${k}.env=${toml(s.env)}`); }
    else { a.push('-c', `${k}.url=${toml(s.url)}`); if (Object.keys(s.headers || {}).length) a.push('-c', `${k}.http_headers=${toml(s.headers)}`); }
  }
  if (modelo) a.push('-m', modelo);
  if (esforco) a.push('-c', `model_reasoning_effort=${esforco}`);
  for (const d of politica.escrita ? (grant ? politica.writePaths.filter(p => p !== path.resolve(cwd)) : []) : []) a.push('--add-dir', d);
  a.push('-');
  return a;
}

// Translates Codex/Claude failures into something actionable.
function amigavel(engine, bruto) {
  const t = String(bruto || '');
  if (/model_not_found|not supported when using Codex with a ChatGPT account/i.test(t)) {
    const m = t.match(/'([^']+)' model is not supported/);
    return `O Codex recusou o modelo ${m ? `"${m[1]}"` : 'configurado'}. Pode ser que o Codex em uso seja antigo e não conheça o modelo, ou que a conta não o tenha. Em Ajustes dá para ver a versão do Codex e trocar o modelo. O arquivo ~/.codex/config.toml não é alterado.`;
  }
  if (/ENOENT|not recognized|não é reconhecido/i.test(t)) return `Não encontrei o comando "${engine === 'codex' ? 'codex' : 'claude'}" instalado.`;
  if (/login|authenticat|unauthorized|401/i.test(t)) return `O ${engine === 'codex' ? 'Codex' : 'Claude Code'} pediu login. Abra o terminal e entre uma vez.`;
  return t.slice(0, 600) || 'Falhou sem mensagem.';
}

// ---- which Codex to use -------------------------------------------------------------
// The machine may have several: the one on PATH (npm) and the one the VS Code extension ships inside its folder.
// They have different versions and therefore different model catalogs. By default the newest is used.
const versaoNum = (txt) => { const m = /(\d+)\.(\d+)\.(\d+)/.exec(txt || ''); return m ? m.slice(1, 4).map(Number) : [0, 0, 0]; };
const maior = (a, b) => { for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] - b[i]; return 0; };

// Works on any machine: on Windows npm installs "x.cmd"; on Mac and Linux, just "x".
const WIN = process.platform === 'win32';
const doPath = (nome) => ({ id: 'path', rotulo: 'Do PATH', cmd: WIN ? `${nome}.cmd` : nome, shell: WIN });
const BIN_VSCODE_CODEX = WIN ? path.join('bin', 'windows-x86_64', 'codex.exe') : path.join('bin', process.platform === 'darwin' ? `macos-${process.arch === 'arm64' ? 'aarch64' : 'x86_64'}` : `linux-${process.arch === 'arm64' ? 'aarch64' : 'x86_64'}`, 'codex');
function candidatosCodex() {
  const lista = [doPath('codex')];
  for (const pasta of ['.vscode', '.vscode-insiders']) {
    const base = path.join(os.homedir(), pasta, 'extensions');
    let nomes = [];
    try { nomes = fs.readdirSync(base); } catch { continue; }
    for (const d of nomes.filter((n) => /^openai\.chatgpt-/.test(n))) {
      const exe = path.join(base, d, BIN_VSCODE_CODEX);
      if (fs.existsSync(exe)) lista.push({ id: `vscode:${d}`, rotulo: 'Extensão do VS Code', cmd: exe, shell: false });
    }
  }
  return lista;
}

function lerVersao(c) {
  return new Promise((resolve) => {
    let saida = '';
    let p;
    try { p = spawn(c.cmd, ['--version'], { shell: c.shell, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] }); }
    catch { return resolve(''); }
    const t = setTimeout(() => { matar(p); resolve(''); }, 15_000);
    p.stdout.on('data', (d) => { saida += d.toString('utf8'); });
    p.on('error', () => { clearTimeout(t); resolve(''); });
    p.on('close', () => { clearTimeout(t); resolve(saida.trim().replace(/^codex-cli\s+/, '').replace(/\s*\(Claude Code\)\s*$/, '')); });
  });
}

let cacheCodex = null;
export async function infoCodex(forcar = false) {
  if (!forcar && cacheCodex && Date.now() - cacheCodex.em < 5 * 60 * 1000) return cacheCodex.dados;
  const comVersao = await Promise.all(candidatosCodex().map(async (c) => ({ ...c, versao: await lerVersao(c) })));
  const vivos = comVersao.filter((c) => c.versao).sort((a, b) => maior(versaoNum(b.versao), versaoNum(a.versao)));
  const dados = { opcoes: vivos, maisNovo: vivos[0] || null };
  cacheCodex = { em: Date.now(), dados };
  return dados;
}

export async function localizarCodex(preferido) {
  const { opcoes, maisNovo } = await infoCodex();
  if (preferido) {
    const c = opcoes.find((o) => o.id === preferido || o.cmd === preferido);
    if (c) return c;
  }
  return maisNovo || doPath('codex');
}

// Queries only the subscription quota, without starting a thread or inference.
let consultaUso = null;
// Old CLI that does not know --system-prompt-file or --allowedTools: discovered on the first failure and remembered for the rest of the session
let semArquivoSistema = false;
export function atualizarUsoCodex() {
  if (FAKE) return Promise.resolve(false);
  if (consultaUso) return consultaUso;
  consultaUso = (async () => {
    const bin = await localizarCodex(lerConfig().codexExe);
    return new Promise((resolve) => {
      const proc = spawn(bin.cmd, ['app-server'], { shell: bin.shell, windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] });
      let buf = '', terminou = false;
      const fim = (ok) => { if (terminou) return; terminou = true; clearTimeout(timer); proc.stdin.end(); matar(proc); resolve(ok); };
      const timer = setTimeout(() => fim(false), 20_000);
      const enviar = (msg) => proc.stdin.write(JSON.stringify(msg) + '\n');
      proc.on('error', () => fim(false));
      proc.on('close', () => fim(false));
      proc.stdin.on('error', () => fim(false));
      proc.stdout.on('data', (d) => {
        buf += d.toString('utf8');
        let i;
        while ((i = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, i); buf = buf.slice(i + 1);
          let msg; try { msg = JSON.parse(line); } catch { continue; }
          if (msg.id === 0) {
            if (msg.error) { fim(false); return; }
            enviar({ method: 'initialized', params: {} });
            enviar({ method: 'account/rateLimits/read', id: 1 });
          } else if (msg.id === 1) { fim(!msg.error && registrarCodex(msg.result)); return; }
        }
      });
      enviar({ method: 'initialize', id: 0, params: { clientInfo: { name: 'nectar', title: 'NECTAR', version: '1.0.0' } } });
    });
  })().finally(() => { consultaUso = null; });
  return consultaUso;
}

// ---- Claude account usage without spending a call ---------------------------------------
// Claude Code only reports usage during a run; when idle, the panel goes stale. The same account exposes usage at
// /api/oauth/usage with the token Claude Code keeps in ~/.claude/.credentials.json (the app only reads it; never writes or logs the token).
let consultaUsoClaude = null;
export function atualizarUsoClaude() {
  if (FAKE) return Promise.resolve(false);
  if (consultaUsoClaude) return consultaUsoClaude;
  consultaUsoClaude = (async () => {
    let cred;
    try { cred = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.claude', '.credentials.json'), 'utf8')).claudeAiOauth; } catch { return false; }
    if (!cred?.accessToken || (cred.expiresAt && cred.expiresAt < Date.now())) return false;   // expired: the next Claude Code use renews it
    const r = await fetch('https://api.anthropic.com/api/oauth/usage', { headers: { Authorization: `Bearer ${cred.accessToken}`, 'anthropic-beta': 'oauth-2025-04-20', 'User-Agent': 'NECTAR' }, signal: AbortSignal.timeout(15000) }).catch(() => null);
    if (!r?.ok) return false;
    const j = await r.json().catch(() => null);
    if (!j?.five_hour && !j?.seven_day) return false;
    const janela = (w) => (w && typeof w.utilization === 'number' ? { utilization: w.utilization / 100, resetsAt: w.resets_at ? Math.floor(Date.parse(w.resets_at) / 1000) : null } : undefined);
    const unifiedWindows = {}; if (janela(j.five_hour)) unifiedWindows.five_hour = janela(j.five_hour); if (janela(j.seven_day)) unifiedWindows.seven_day = janela(j.seven_day);
    registrarUso({ unifiedWindows });
    const ex = j.extra_usage;
    if (ex && typeof ex.utilization === 'number' && ex.is_enabled) registrarUso({ rateLimitType: 'overage', utilization: ex.utilization / 100, isUsingOverage: ex.utilization > 0, status: ex.spend_limit_reached ? 'rejected' : 'allowed' });
    return true;
  })().catch(() => false).finally(() => { consultaUsoClaude = null; });
  return consultaUsoClaude;
}

// ---- which Claude Code to use -------------------------------------------------------
// Same as Codex: the one on PATH (npm) may be too old for the new models (2.1.89 does not know
// Opus 5.5), and the VS Code extension ships a newer one inside its folder. By default the newest is used.
function candidatosClaude() {
  const lista = [doPath('claude')];
  // native Claude Code installer (claude.ai/install): ~/.local/bin
  const nativo = path.join(os.homedir(), '.local', 'bin', WIN ? 'claude.exe' : 'claude');
  if (fs.existsSync(nativo)) lista.push({ id: 'nativo', rotulo: 'Instalador oficial', cmd: nativo, shell: false });
  for (const pasta of ['.vscode', '.vscode-insiders']) {
    const base = path.join(os.homedir(), pasta, 'extensions');
    let nomes = [];
    try { nomes = fs.readdirSync(base); } catch { continue; }
    for (const d of nomes.filter((n) => /^anthropic\.claude-code-/.test(n))) {
      const exe = path.join(base, d, 'resources', 'native-binary', WIN ? 'claude.exe' : 'claude');
      if (fs.existsSync(exe)) lista.push({ id: `vscode:${d}`, rotulo: 'Extensão do VS Code', cmd: exe, shell: false });
    }
  }
  return lista;
}

let cacheClaude = null;
export async function infoClaude(forcar = false) {
  if (!forcar && cacheClaude && Date.now() - cacheClaude.em < 5 * 60 * 1000) return cacheClaude.dados;
  const comVersao = await Promise.all(candidatosClaude().map(async (c) => ({ ...c, versao: await lerVersao(c) })));
  const vivos = comVersao.filter((c) => c.versao).sort((a, b) => maior(versaoNum(b.versao), versaoNum(a.versao)));
  const dados = { opcoes: vivos, maisNovo: vivos[0] || null };
  cacheClaude = { em: Date.now(), dados };
  return dados;
}

export async function localizarClaude(preferido) {
  // real-path test without a model: a script plays the CLI (same stream-json protocol)
  if (process.env.STUDIO_CLAUDE_STUB) return { id: 'stub', rotulo: 'Simulador', cmd: process.execPath, prefixo: [process.env.STUDIO_CLAUDE_STUB], shell: false, versao: '0' };
  const { opcoes, maisNovo } = await infoClaude();
  if (preferido) {
    const c = opcoes.find((o) => o.id === preferido || o.cmd === preferido);
    if (c) return c;
  }
  return maisNovo || doPath('claude');
}

/**
 * Runs an agent once.
 *  cwd           project folder (where the agent works)
 *  addDirs       other folders the Game Director mentioned (additional context)
 *  modo/somenteLeitura  task intent; they do not restrict the authorized access to the computer
 */
// Global cap on concurrent calls (all rounds and projects), so parallelism does not become a flood.
// Leadership and what the Game Director asks for get one extra slot and go first: with the autopilot filling every slot with cards, the
// P.O. and the user's messages sat in the queue for minutes looking like "começando".
const vagas = { usadas: 0, espera: [] };
const maxVagas = (prioridade) => Math.max(1, lerConfig().ciclo?.paralelo || 1) + (prioridade ? 1 : 0);
function admitir() {
  vagas.espera.sort((a, b) => Number(b.prioridade) - Number(a.prioridade));   // stable: priority first, arrival order within it
  for (let i = 0; i < vagas.espera.length;) {
    const w = vagas.espera[i];
    if (vagas.usadas < maxVagas(w.prioridade)) { vagas.espera.splice(i, 1); vagas.usadas++; w.ok(true); } else i++;
  }
}
/** Resolves with the function that releases the slot, or null if the wait was canceled (soltarFila). `quem` identifies the call in the queue. */
async function pegarVaga(prioridade = false, onFila, quem = {}) {
  if (vagas.usadas < maxVagas(prioridade)) vagas.usadas++;
  else {
    onFila?.(vagas.espera.filter((w) => w.prioridade || !prioridade).length + 1);
    const entrou = await new Promise((ok) => { vagas.espera.push({ prioridade, ok, ...quem }); });
    if (!entrou) return null;
  }
  let solta = false;
  return () => { if (solta) return; solta = true; vagas.usadas--; admitir(); };
}
/** Removes from the queue the calls matching the filter (e.g. { projeto, agente }); they end as canceled, without running. */
export function soltarFila(filtro = () => true) {
  const fora = vagas.espera.filter(filtro);
  vagas.espera = vagas.espera.filter((w) => !fora.includes(w));
  for (const w of fora) w.ok(false);
  return fora.length;
}
export const vagasAgora = () => ({ usadas: vagas.usadas, naFila: vagas.espera.length, fila: vagas.espera.map(({ projeto, agente, prioridade }) => ({ projeto, agente, prioridade })) });
export const _testeVagas = { pegarVaga };
const writers = new Map();
// Writing in the same folder: by default calls run in parallel (each card touches its own files; a shared file has one
// owner at a time, agreed by the P.O.). With ciclo.escritaSerial=true it goes back to one per folder, and whoever waits shows as waiting.
async function reservarWriter(opcoes) {
  if(opcoes.somenteLeitura || !lerConfig().ciclo?.escritaSerial) return () => {};
  const key=path.resolve(opcoes.cwd || '.').toLowerCase();
  const anterior=writers.get(key)||Promise.resolve();let liberar;
  if(writers.has(key)) opcoes.onAtividade?.('esperando outra chamada terminar de escrever na pasta');
  const atual=new Promise(r=>{liberar=r;});const fila=anterior.then(()=>atual);writers.set(key,fila);
  await anterior;
  return ()=>{liberar();if(writers.get(key)===fila)writers.delete(key);};
}
export async function executar(opcoes) {
  if (FAKE) return executarSolto(opcoes);
  const liberarWriter=await reservarWriter(opcoes);
  const liberar = await pegarVaga(!!opcoes.prioridade, opcoes.onFila, opcoes.quem);
  if (!liberar) {liberarWriter();return { erro: 'Cancelada enquanto esperava na fila.', cancelada: true, duracaoMs: 0 };}
  opcoes.onVaga?.();
  try {
    // a programming error in here must not leave the agent "abrindo a sessão" forever: it becomes a visible error in the conversation
    const r = await executarSolto(opcoes).catch((e) => ({ erro: `Falha interna ao chamar o ${opcoes.engine === 'codex' ? 'Codex' : 'Claude'}: ${e.message}`, duracaoMs: 0 }));
    // CLI that does not know the system prompt file: retries once with everything in the request and does not try again.
    if (r.erro && opcoes.engine === 'claude' && !opcoes.refeita && /(?:unknown option|unrecognized option|unexpected argument).*append-system-prompt-file/i.test(r.erro)) {
      semArquivoSistema = true;
      return await executarSolto({ ...opcoes, refeita: true, prompt: opcoes.sistema ? `${opcoes.sistema}\n\n${opcoes.prompt}` : opcoes.prompt, sistema: null });
    }
    return r;
  } finally { liberar(); liberarWriter(); }
}

async function executarSolto({ engine, prompt, sistema = null, ferramentas = undefined, modo, somenteLeitura, grant = null, modelo, esforco, codexExe, claudeExe, cwd, addDirs = [], onTexto, onAtividade, onSinal, registrar, mcp = null, acesso = null }) {
  if (FAKE) {
    // STUDIO_FAKE_USO="0.6,0.3" simulates the usage reading (5 h, week) to test the warnings
    // STUDIO_FAKE_RESET_S=4 makes the window renew in 4 seconds (to see the pause and the resume)
    const f = (process.env.STUDIO_FAKE_USO || '').split(',').map(Number);
    const fim = process.env.STUDIO_FAKE_RESET_S ? Math.floor(Date.now() / 1000) + Number(process.env.STUDIO_FAKE_RESET_S) : 1893456000;
    if (f[0] >= 0 && !global.__usoFalsoFeito) { global.__usoFalsoFeito = true; registrarUso({ unifiedWindows: { five_hour: { utilization: f[0], resetsAt: fim }, seven_day: { utilization: f[1] ?? 0.1, resetsAt: 1893456000 } } }); }
    return executarFalso({ prompt: sistema ? `${sistema}\n\n${prompt}` : prompt, onTexto, onAtividade });
  }
  // @acesso_total / @acesso_restrito in the request (or on the card) applies to this call; without a flag, the config applies
  const total = acesso ? acesso !== 'restrito' : acessoTotal();
  if (!total) mcp=(mcp||[]).filter(s=>grant?.permissions?.includes('connector.read')&&s.readTools?.length);
  if (process.env.STUDIO_DEBUG) console.error(`[executar] engine=${engine} modo=${modo} acesso=grant modelo=${modelo || "-"} esforco=${esforco || "-"} agente=${(/^Agente: (\w+)/m.exec(prompt) || [])[1]}`);
  onAtividade?.('localizando o CLI');
  const bin = engine === 'codex' ? await localizarCodex(codexExe) : await localizarClaude(claudeExe);
  onAtividade?.('pedindo vaga');

  return new Promise((resolve) => {
    const inicio = Date.now();
    const usaArquivo = !!sistema && engine === 'claude' && !semArquivoSistema;
    let sistemaArq = null;
    if (usaArquivo) {
      try {
        sistemaArq = path.join(os.tmpdir(), `nectar-system-${process.pid}-${crypto.randomUUID()}.txt`);
        fs.writeFileSync(sistemaArq, sistema,{mode:0o600});
      } catch { sistemaArq = null; }
    }
    const projectInstructions=path.join(cwd,'AGENTS.md');
    let instrucoesProjeto='';if(fs.existsSync(projectInstructions)){try{const text=fs.readFileSync(projectInstructions,'utf8');if(text.length>100000)throw new Error('context_missing: AGENTS.md excede o orçamento de instruções');instrucoesProjeto=`\n\n## Instruções do projeto (AGENTS.md autorizado)\n${text}`;}catch(e){return resolve({erro:e.message,duracaoMs:0});}}
    const entrada = (sistema && !sistemaArq ? `${sistema}\n\n${prompt}` : prompt)+instrucoesProjeto;
    let mcpArq = null;
    if (mcp?.length && engine === 'claude') {
      try {
        const servers = Object.fromEntries(mcp.map((s) => [s.nome, s.tipo === 'stdio' ? { type: 'stdio', command: s.command, args: s.args || [], env: s.env || {} } : { type: s.tipo, url: s.url, headers: s.headers || {} }]));
        mcpArq = path.join(os.tmpdir(), `nectar-mcp-${process.pid}-${crypto.randomUUID()}.json`);
        fs.writeFileSync(mcpArq, JSON.stringify({ mcpServers: servers }),{mode:0o600});
      } catch { mcpArq = null; }
    }
    let settingsArq=null;
    let hookPolicyArq=null;
    let auditArq=null;
    if(engine==='claude' && !total) {
      const politica=resolverPolitica({engine,cwd,somenteLeitura,grant});
      hookPolicyArq=path.join(os.tmpdir(),`nectar-grant-${process.pid}-${crypto.randomUUID()}.json`);
      auditArq=hookPolicyArq+'.audit';
      fs.writeFileSync(hookPolicyArq,JSON.stringify({cwd,auditFile:auditArq,readPaths:grant?.readPaths||[cwd,...addDirs],writePaths:politica.writePaths,denyPaths:politica.denyPaths,expiresAt:grant?.expiresAt||new Date(Date.now()+limiteMs()).toISOString()}));
      const quote=s=>'"'+s.replace(/"/g,'\\"')+'"';
      const hook=path.join(import.meta.dirname,'claude-policy-hook.cjs').replace(/app\.asar([\\/])/,'app.asar.unpacked$1');
      const command=[NODE_EXECUTABLE,hook,hookPolicyArq].map(quote).join(' ');
      const settings={hooks:{PreToolUse:[{matcher:'.*',hooks:[{type:'command',command,timeout:5}]}]},permissions:{blockReadsOutsideWorkingDirectories:true,blockWritesOutsideWorkingDirectories:true,disableBypassPermissionsMode:'disable',deny:['Read(//**/.env)','Read(//**/.env.*)','Read(//**/*.pem)','Read(//**/.ssh/**)','Read(//**/.aws/**)','Read(//**/.codex/auth.json)','Read(//**/.claude/.credentials.json)'],allow:[]}};
      settingsArq=path.join(os.tmpdir(),`nectar-policy-${process.pid}-${crypto.randomUUID()}.json`);fs.writeFileSync(settingsArq,JSON.stringify(settings),{mode:0o600});
    }
    const bruto = engine === 'codex' ? argsCodex({ modelo, esforco, addDirs, cwd, mcp, somenteLeitura, grant, total }) : argsClaude({ modelo, esforco, addDirs, cwd, sistemaArq, mcpArq, settingsArq, ferramentas, somenteLeitura, grant, total });
    const args = [...(bin.prefixo || []), ...(bin.shell ? bruto.map(aspas) : bruto)];

    let proc;
    try {
      proc = spawn(bin.cmd, args, { cwd, shell: bin.shell, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],env:{...process.env,...(process.platform==='win32'?{SYSTEMROOT:process.env.SYSTEMROOT||process.env.SystemRoot,WINDIR:process.env.WINDIR||process.env.SystemRoot}: {})} });
    } catch (e) {
      if(settingsArq)try{fs.unlinkSync(settingsArq);}catch{}
      if(hookPolicyArq)try{fs.unlinkSync(hookPolicyArq);}catch{}
      if(sistemaArq)try{fs.unlinkSync(sistemaArq);}catch{}
      if(mcpArq)try{fs.unlinkSync(mcpArq);}catch{}
      return resolve({ erro: amigavel(engine, e.message), duracaoMs: 0 });
    }
    registrar?.(proc);

    let buf = ''; let err = ''; let atual = ''; let final = ''; let erroFinal = ''; let custo = null; let tokens = null;
    const timer = setTimeout(() => { erroFinal = `Passou de ${Math.round(limiteMs() / 60000)} minutos e foi encerrado.`; matar(proc); }, limiteMs());

    // Call trace (STUDIO_RASTRO=folder): every tool the agent used, with its main argument, and the final text.
    const rastroDir = process.env.STUDIO_RASTRO; let rastroArq = null; const blocos = {};
    if (rastroDir) { try { fs.mkdirSync(rastroDir, { recursive: true }); rastroArq = path.join(rastroDir, `${new Date().toISOString().replace(/[:.]/g, '-')}-${(/^Agente: (\w+)/m.exec(prompt) || [])[1] || 'x'}.log`); fs.writeFileSync(rastroArq, `# engine=${engine} modelo=${modelo || '-'} esforco=${esforco || '-'} prompt=${prompt.length} chars sistema=${(sistema || '').length} chars
## prompt (início)
${prompt.slice(0, 2500)}
## fim do início
`); } catch { rastroArq = null; } }
    const rastro = (t) => { if (rastroArq) try { fs.appendFileSync(rastroArq, `[${new Date().toTimeString().slice(0, 8)}] ${t}
`); } catch { /* no trace */ } };
    const linha = (ln) => {
      if (!ln.trim()) return;
      let ev;
      try { ev = JSON.parse(ln); } catch { return; }
      onSinal?.();   // any model event (including reasoning) is a sign of life
      if (rastroArq && engine === 'claude') {
        if (ev.type === 'stream_event') { const e = ev.event || {}; if (e.type === 'content_block_start' && e.content_block?.type === 'tool_use') blocos[e.index] = { nome: e.content_block.name, json: '' }; else if (e.type === 'content_block_delta' && e.delta?.type === 'input_json_delta' && blocos[e.index]) blocos[e.index].json += e.delta.partial_json; else if (e.type === 'content_block_stop' && blocos[e.index]) { const b = blocos[e.index]; let arg = b.json.slice(0, 300); try { const o = JSON.parse(b.json); arg = String(o.command ?? o.file_path ?? o.pattern ?? o.query ?? o.url ?? o.description ?? JSON.stringify(o)).slice(0, 300); } catch { /* partial */ } rastro(`${b.nome}: ${arg.replace(/\s+/g, ' ')}`); delete blocos[e.index]; } }
        else if (ev.type === 'user' && Array.isArray(ev.message?.content)) for (const c of ev.message.content) if (c.type === 'tool_result') rastro(`  ← ${String(typeof c.content === 'string' ? c.content : JSON.stringify(c.content)).replace(/\s+/g, ' ').slice(0, 200)}`);
        else if (ev.type === 'result') rastro(`RESULT ${ev.is_error ? 'ERRO ' : ''}${ev.duration_ms || ''}ms custo=${ev.total_cost_usd ?? '?'} turnos=${ev.num_turns ?? '?'}
${String(ev.result || '').slice(0, 3000)}`);
      } else if (rastroArq && ev.type === 'item.completed') { const it = ev.item || {}; rastro(`${it.type}: ${String(it.command || it.text || JSON.stringify(it)).replace(/\s+/g, ' ').slice(0, 300)}`); }
      if (engine === 'claude') {
        if (ev.type === 'rate_limit_event') registrarUso(ev.rate_limit_info);
        else if (ev.type === 'stream_event') {
          const e = ev.event || {};
          if (e.type === 'message_start') { atual = ''; onAtividade?.('pensando'); }
          else if (e.type === 'content_block_start' && e.content_block?.type === 'thinking') onAtividade?.('pensando');
          else if (e.type === 'content_block_start' && e.content_block?.type === 'text') onAtividade?.('escrevendo');
          else if (e.type === 'content_block_start' && e.content_block?.type === 'tool_use') onAtividade?.(ATIVIDADE[e.content_block.name] || 'trabalhando');
          else if (e.type === 'content_block_delta' && e.delta?.type === 'text_delta') { atual += e.delta.text; onTexto?.(atual); }
        } else if (ev.type === 'result') {
          const u = ev.usage;
          if (u) tokens = { entrada: u.input_tokens || 0, saida: u.output_tokens || 0, cache: u.cache_read_input_tokens || 0, criacaoCache: u.cache_creation_input_tokens || 0 };
          if (ev.is_error) erroFinal = ev.result || 'Erro sem detalhe.';
          else final = ev.result || atual;
          custo = ev.total_cost_usd ?? null;
        }
      } else {
        if (ev.type === 'turn.completed' && ev.usage) {
          const u = ev.usage;
          tokens = { entrada: Math.max(0, (u.input_tokens || 0) - (u.cached_input_tokens || 0)), saida: u.output_tokens || 0, cache: u.cached_input_tokens || 0, criacaoCache: 0 };
        }
        const it = ev.item || {};
        if (ev.type === 'item.completed' && it.type === 'agent_message') { final = it.text || final; onTexto?.(final); }
        else if (ev.type === 'item.started' || ev.type === 'item.completed') {
          if (it.type === 'command_execution') onAtividade?.('rodando um comando');
          else if (it.type === 'file_change') onAtividade?.('editando arquivos');
          else if (it.type === 'reasoning') onAtividade?.('pensando');
        } else if (ev.type === 'turn.failed') erroFinal = ev.error?.message || 'O Codex encerrou com erro.';
      }
    };

    proc.stdout.on('data', (d) => {
      buf += d.toString('utf8');
      let i;
      while ((i = buf.indexOf('\n')) >= 0) { linha(buf.slice(0, i)); buf = buf.slice(i + 1); }
    });
    proc.stderr.on('data', (d) => { err += d.toString('utf8'); rastro(`stderr: ${d.toString('utf8').trim().slice(0, 400)}`); });
    proc.on('error', (e) => { erroFinal = e.message; });
    proc.on('close', (codigo) => {
      clearTimeout(timer);
      let policyAudit=[];if(auditArq)try{policyAudit=fs.readFileSync(auditArq,'utf8').trim().split('\n').filter(Boolean).map(s=>JSON.parse(s));fs.unlinkSync(auditArq);}catch{}
      if(settingsArq)try{fs.unlinkSync(settingsArq);}catch{}
      if(hookPolicyArq)try{fs.unlinkSync(hookPolicyArq);}catch{}
      if(sistemaArq)try{fs.unlinkSync(sistemaArq);}catch{}
      if(mcpArq)try{fs.unlinkSync(mcpArq);}catch{}
      if (buf.trim()) linha(buf);
      const duracaoMs = Date.now() - inicio;
      if (erroFinal) return resolve({ erro: amigavel(engine, erroFinal), duracaoMs, tokens, policyAudit });
      if (!final && codigo !== 0) return resolve({ erro: amigavel(engine, err || `Saiu com código ${codigo}`), duracaoMs, tokens, policyAudit });
      resolve({ texto: final, duracaoMs, custo, tokens, policyAudit });
    });
    proc.stdin.on('error', () => {});
    proc.stdin.end(entrada);
  });
}

// Models the Codex account actually accepts, read from its catalog (`codex debug models`).
let cacheModelos = null;
export async function modelosCodex(codexExe) {
  if (FAKE) return [{ slug: 'modelo-de-teste', nome: 'Modelo de teste' }];
  const bin = await localizarCodex(codexExe);
  if (cacheModelos && cacheModelos.bin === bin.cmd && Date.now() - cacheModelos.em < 10 * 60 * 1000) return cacheModelos.lista;
  return new Promise((resolve) => {
    let saida = '';
    let proc;
    try { proc = spawn(bin.cmd, ['debug', 'models'], { shell: bin.shell, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] }); }
    catch { return resolve([]); }
    const timer = setTimeout(() => { matar(proc); resolve([]); }, 20_000);
    proc.stdout.on('data', (d) => { saida += d.toString('utf8'); });
    proc.on('error', () => { clearTimeout(timer); resolve([]); });
    proc.on('close', () => {
      clearTimeout(timer);
      try {
        const lista = JSON.parse(saida).models.filter((m) => m.visibility === 'list').map((m) => ({ slug: m.slug, nome: m.display_name || m.slug }));
        cacheModelos = { em: Date.now(), lista, bin: bin.cmd };
        resolve(lista);
      } catch { resolve([]); }
    });
  });
}
