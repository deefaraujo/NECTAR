// Executor: chama o Claude Code ou o Codex pela linha de comando, usando o login que já existe na
// máquina (sem chave de API). O texto do pedido vai pela entrada padrão, nunca montado dentro do
// comando, então o que você digita não vira argumento de shell. A persona do agente vai dentro do
// pedido: assim o app funciona em qualquer pasta, mesmo sem arquivos de agente nela.
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
// Arquivos efêmeros pertencem a um PID. Um crash não deixa credenciais de MCP
// esquecidas indefinidamente; nunca remover arquivos de um processo vivo.
for(const name of fs.readdirSync(os.tmpdir())){
  const match=/^nectar-(?:system|mcp|grant|policy)-(\d+)-[a-f0-9-]+\.(?:json|txt)(?:\.audit)?$/.exec(name);if(!match)continue;
  let morto=false;try{process.kill(Number(match[1]),0);}catch(e){morto=e.code==='ESRCH';}
  if(morto)try{const file=path.join(os.tmpdir(),name);if(fs.lstatSync(file).isFile())fs.unlinkSync(file);}catch{}
}
const limiteMs = () => Math.max(5, lerConfig().ciclo?.limiteChamadaMin || 30) * 60 * 1000; // tarefa grande não pode morrer no meio

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
// Acesso total autorizado pela Game Director: é o padrão. O isolamento por grant/sandbox só vale com acesso: 'restrito' na config.
export const acessoTotal = (cfg = lerConfig()) => cfg.acesso !== 'restrito';

// Processo adiado para os jobs: a chamada continua síncrona, mas a descoberta
// do CLI é assíncrona. Cancelar antes do spawn também impede a execução.
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

// Ferramentas que o time usa de verdade. O padrão do Claude Code carrega mais de 20 (todo-list, notebook, agendador, notificação...)
// e custa ~33 mil tokens de base em CADA chamada; estas custam ~15 mil (medido), sem perder nenhuma função do time.
export const FERRAMENTAS_CLAUDE = 'Read,Grep,Glob,Bash,Edit,Write,WebFetch,WebSearch';
export function argsClaude({ modelo, esforco, addDirs = [], sistemaArq = null, ferramentas = FERRAMENTAS_CLAUDE, mcpArq = null, settingsArq = null, somenteLeitura = false, grant = null, cwd = '.', total = acessoTotal() }) {
  const a = [
    '-p', '--output-format', 'stream-json', '--verbose', '--include-partial-messages',
    '--no-session-persistence',
    '--strict-mcp-config', // sem MCP: o chat não precisa subir Unreal, Figma etc.
  ];
  if (mcpArq) a.push('--mcp-config', mcpArq);   // só o agente de MCP recebe os servidores escolhidos
  if(settingsArq) a.push('--settings',settingsArq);
  if (modelo) a.push('--model', modelo);
  if (esforco) a.push('--effort', esforco);
  if (addDirs.length) a.push('--add-dir', ...addDirs);
  // A parte fixa do pedido (persona, regras, protocolo) vai como system prompt, que o CLI guarda em cache entre chamadas:
  // numa medição, a mesma chamada custou 60% menos do que com o texto no pedido.
  if (sistemaArq) a.push('--append-system-prompt-file', sistemaArq);
  if (total) {
    if (ferramentas) a.push('--tools', ferramentas);
    a.push('--disallowedTools', 'Task,Agent'); // subagente do Claude é invisível para a equipe: colega se chama com @
    a.push('--dangerously-skip-permissions');  // o modo regula a tarefa, não o filesystem
    return a;
  }
  const politica = resolverPolitica({ engine: 'claude', cwd, somenteLeitura, grant });
  // Lista fechada: não oferecer Bash em Claude sem sandbox de SO verificável.
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
    for (const s of mcp || []) {   // MCPs escolhidos para o agente de MCP, por cima do config.toml
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
  for (const s of mcp || []) {   // MCPs escolhidos para o agente de MCP, por cima do config.toml
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

// Traduz as falhas do Codex/Claude em algo que dá para agir em cima.
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

// ---- qual Codex usar -------------------------------------------------------------
// A máquina pode ter vários: o do PATH (npm) e o que a extensão do VS Code traz dentro da pasta dela.
// Eles têm versões diferentes e, por isso, catálogos de modelos diferentes. Por padrão usa o mais novo.
const versaoNum = (txt) => { const m = /(\d+)\.(\d+)\.(\d+)/.exec(txt || ''); return m ? m.slice(1, 4).map(Number) : [0, 0, 0]; };
const maior = (a, b) => { for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] - b[i]; return 0; };

// Funciona em qualquer máquina: no Windows o npm instala "x.cmd"; no Mac e no Linux, só "x".
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

// Consulta apenas a cota da assinatura, sem iniciar thread ou inferência.
let consultaUso = null;
// CLI antigo que não conhece --system-prompt-file ou --allowedTools: descoberto na primeira falha e lembrado pelo resto da sessão
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

// ---- uso da conta do Claude sem gastar chamada ---------------------------------------
// O Claude Code só informa o uso durante uma execução; parado, o painel envelhece. A mesma conta expõe o uso em
// /api/oauth/usage com o token que o Claude Code guarda em ~/.claude/.credentials.json (o app só lê; nunca grava nem registra o token).
let consultaUsoClaude = null;
export function atualizarUsoClaude() {
  if (FAKE) return Promise.resolve(false);
  if (consultaUsoClaude) return consultaUsoClaude;
  consultaUsoClaude = (async () => {
    let cred;
    try { cred = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.claude', '.credentials.json'), 'utf8')).claudeAiOauth; } catch { return false; }
    if (!cred?.accessToken || (cred.expiresAt && cred.expiresAt < Date.now())) return false;   // vencido: o próximo uso do Claude Code renova
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

// ---- qual Claude Code usar -------------------------------------------------------
// Igual ao Codex: o do PATH (npm) pode ser velho demais para os modelos novos (o 2.1.89 não conhece o
// Opus 5.5), e a extensão do VS Code traz um mais novo dentro da pasta dela. Por padrão usa o mais novo.
function candidatosClaude() {
  const lista = [doPath('claude')];
  // instalador nativo do Claude Code (claude.ai/install): ~/.local/bin
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
  // teste do caminho real sem modelo: um script faz o papel do CLI (mesmo protocolo stream-json)
  if (process.env.STUDIO_CLAUDE_STUB) return { id: 'stub', rotulo: 'Simulador', cmd: process.execPath, prefixo: [process.env.STUDIO_CLAUDE_STUB], shell: false, versao: '0' };
  const { opcoes, maisNovo } = await infoClaude();
  if (preferido) {
    const c = opcoes.find((o) => o.id === preferido || o.cmd === preferido);
    if (c) return c;
  }
  return maisNovo || doPath('claude');
}

/**
 * Roda um agente uma vez.
 *  cwd           pasta do projeto (onde o agente trabalha)
 *  addDirs       outras pastas que a Game Director citou (contexto adicional)
 *  modo/somenteLeitura  intenção da tarefa; não restringem o acesso autorizado ao computador
 */
// Teto global de chamadas ao mesmo tempo (todas as rodadas e projetos), para paralelo não virar enxurrada.
// A liderança e o que a Game Director pede têm uma vaga a mais e passam na frente: com o piloto ocupando todas as vagas com cards, a
// P.O. e as mensagens dela ficavam minutos na fila parecendo "começando".
const vagas = { usadas: 0, espera: [] };
const maxVagas = (prioridade) => Math.max(1, lerConfig().ciclo?.paralelo || 1) + (prioridade ? 1 : 0);
function admitir() {
  vagas.espera.sort((a, b) => Number(b.prioridade) - Number(a.prioridade));   // estável: prioridade primeiro, ordem de chegada dentro
  for (let i = 0; i < vagas.espera.length;) {
    const w = vagas.espera[i];
    if (vagas.usadas < maxVagas(w.prioridade)) { vagas.espera.splice(i, 1); vagas.usadas++; w.ok(true); } else i++;
  }
}
/** Resolve com a função que solta a vaga, ou null se a espera foi cancelada (soltarFila). `quem` identifica a chamada na fila. */
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
/** Tira da fila as chamadas que batem com o filtro (por exemplo { projeto, agente }); elas terminam como canceladas, sem rodar. */
export function soltarFila(filtro = () => true) {
  const fora = vagas.espera.filter(filtro);
  vagas.espera = vagas.espera.filter((w) => !fora.includes(w));
  for (const w of fora) w.ok(false);
  return fora.length;
}
export const vagasAgora = () => ({ usadas: vagas.usadas, naFila: vagas.espera.length, fila: vagas.espera.map(({ projeto, agente, prioridade }) => ({ projeto, agente, prioridade })) });
export const _testeVagas = { pegarVaga };
const writers = new Map();
// Escrita na mesma pasta: por padrão as chamadas rodam em paralelo (cada card mexe nos seus arquivos; arquivo compartilhado é um
// dono por vez, combinado pela P.O.). Com ciclo.escritaSerial=true volta a ser uma por pasta, e quem espera aparece esperando.
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
    // um erro de programação aqui dentro não pode deixar o agente "abrindo a sessão" para sempre: vira erro visível na conversa
    const r = await executarSolto(opcoes).catch((e) => ({ erro: `Falha interna ao chamar o ${opcoes.engine === 'codex' ? 'Codex' : 'Claude'}: ${e.message}`, duracaoMs: 0 }));
    // CLI que não conhece o arquivo de system prompt: refaz uma vez com tudo no pedido e não tenta de novo.
    if (r.erro && opcoes.engine === 'claude' && !opcoes.refeita && /(?:unknown option|unrecognized option|unexpected argument).*append-system-prompt-file/i.test(r.erro)) {
      semArquivoSistema = true;
      return await executarSolto({ ...opcoes, refeita: true, prompt: opcoes.sistema ? `${opcoes.sistema}\n\n${opcoes.prompt}` : opcoes.prompt, sistema: null });
    }
    return r;
  } finally { liberar(); liberarWriter(); }
}

async function executarSolto({ engine, prompt, sistema = null, ferramentas = undefined, modo, somenteLeitura, grant = null, modelo, esforco, codexExe, claudeExe, cwd, addDirs = [], onTexto, onAtividade, onSinal, registrar, mcp = null, acesso = null }) {
  if (FAKE) {
    // STUDIO_FAKE_USO="0.6,0.3" simula a leitura de uso (5 h, semana) para testar os avisos
    // STUDIO_FAKE_RESET_S=4 faz a janela renovar em 4 segundos (para ver a pausa e a volta)
    const f = (process.env.STUDIO_FAKE_USO || '').split(',').map(Number);
    const fim = process.env.STUDIO_FAKE_RESET_S ? Math.floor(Date.now() / 1000) + Number(process.env.STUDIO_FAKE_RESET_S) : 1893456000;
    if (f[0] >= 0 && !global.__usoFalsoFeito) { global.__usoFalsoFeito = true; registrarUso({ unifiedWindows: { five_hour: { utilization: f[0], resetsAt: fim }, seven_day: { utilization: f[1] ?? 0.1, resetsAt: 1893456000 } } }); }
    return executarFalso({ prompt: sistema ? `${sistema}\n\n${prompt}` : prompt, onTexto, onAtividade });
  }
  // @acesso_total / @acesso_restrito no pedido (ou no card) vale para esta chamada; sem flag, vale a config
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

    // Rastro da chamada (STUDIO_RASTRO=pasta): cada ferramenta que o agente usou, com o argumento principal, e o texto final.
    const rastroDir = process.env.STUDIO_RASTRO; let rastroArq = null; const blocos = {};
    if (rastroDir) { try { fs.mkdirSync(rastroDir, { recursive: true }); rastroArq = path.join(rastroDir, `${new Date().toISOString().replace(/[:.]/g, '-')}-${(/^Agente: (\w+)/m.exec(prompt) || [])[1] || 'x'}.log`); fs.writeFileSync(rastroArq, `# engine=${engine} modelo=${modelo || '-'} esforco=${esforco || '-'} prompt=${prompt.length} chars sistema=${(sistema || '').length} chars
## prompt (início)
${prompt.slice(0, 2500)}
## fim do início
`); } catch { rastroArq = null; } }
    const rastro = (t) => { if (rastroArq) try { fs.appendFileSync(rastroArq, `[${new Date().toTimeString().slice(0, 8)}] ${t}
`); } catch { /* sem rastro */ } };
    const linha = (ln) => {
      if (!ln.trim()) return;
      let ev;
      try { ev = JSON.parse(ln); } catch { return; }
      onSinal?.();   // qualquer evento do modelo (inclusive o raciocínio) é sinal de vida
      if (rastroArq && engine === 'claude') {
        if (ev.type === 'stream_event') { const e = ev.event || {}; if (e.type === 'content_block_start' && e.content_block?.type === 'tool_use') blocos[e.index] = { nome: e.content_block.name, json: '' }; else if (e.type === 'content_block_delta' && e.delta?.type === 'input_json_delta' && blocos[e.index]) blocos[e.index].json += e.delta.partial_json; else if (e.type === 'content_block_stop' && blocos[e.index]) { const b = blocos[e.index]; let arg = b.json.slice(0, 300); try { const o = JSON.parse(b.json); arg = String(o.command ?? o.file_path ?? o.pattern ?? o.query ?? o.url ?? o.description ?? JSON.stringify(o)).slice(0, 300); } catch { /* parcial */ } rastro(`${b.nome}: ${arg.replace(/\s+/g, ' ')}`); delete blocos[e.index]; } }
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

// Modelos que a conta do Codex realmente aceita, lidos do catálogo dele (`codex debug models`).
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
