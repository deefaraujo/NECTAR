// JSON persistence in the app data folder (studio/data in the source tree, %APPDATA% in the .exe).
// Atomic and durable writes (temp file + fsync + rename), with a copy of the previous version and hourly snapshots.
import fs from 'node:fs';
import path from 'node:path';

export const DIR = process.env.STUDIO_DATA
  ? path.resolve(process.env.STUDIO_DATA)
  : path.resolve(import.meta.dirname, '..', 'data');
fs.mkdirSync(DIR, { recursive: true });

// A relative path is resolved inside the app data folder; an absolute path (each project's folder) is used as is.
const abs = (rel) => (path.isAbsolute(rel) ? rel : path.join(DIR, rel));

// ---- Durability ------------------------------------------------------------------------------------------------
// A power loss or abrupt Windows restart right after a write leaves the file with the right size and the content
// ZEROED (0 bytes). On 31/10/2026 this happened to the board and the conversations: the app could not read them, treated them as a "new
// file", started empty and wrote over them. Hence:
//  1) writing forces the content to disk (fsync) before the rename;
//  2) every write keeps the previous good version (.bak) and, once an hour, a snapshot in _backups/;
//  3) a write that suddenly shrinks the file keeps the large version before overwriting;
//  4) reading never treats an unreadable file as "does not exist": it tries the .bak and the snapshots, and whatever is unreadable is kept
//     in quarantine (never overwritten or deleted).
export const ocorrencias = [];   // what was recovered or quarantined in this run (so the app can warn)
const aviso = (msg) => { ocorrencias.push({ em: new Date().toISOString(), msg }); console.error(`[dados] ${msg}`); };
const espera = (ms) => { try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); } catch { /* no wait */ } };

const zerado = (buf) => buf.length > 0 && !buf.some((x) => x !== 0);
function lerJson(f) {
  for (let i = 0; i < 3; i++) {   // file momentarily locked (antivirus, indexer): retry before giving up
    try {
      const buf = fs.readFileSync(f);
      if (!buf.length) return { vazio: true };
      if (zerado(buf)) return { zerado: true };
      return { dados: JSON.parse(buf.toString('utf8')) };
    } catch (e) {
      if (e.code === 'ENOENT') return { ausente: true };
      if (!['EBUSY', 'EPERM', 'EACCES', 'EMFILE'].includes(e.code)) return { erro: e };
      espera(120);
    }
  }
  return { erro: new Error('arquivo travado') };
}
const instantaneos = (alvo) => {
  const dir = path.join(path.dirname(alvo), '_backups'), base = path.basename(alvo, '.json');
  try { return fs.readdirSync(dir).filter((n) => n.startsWith(`${base}.`) && n.endsWith('.json')).sort().reverse().map((n) => path.join(dir, n)); } catch { return []; }
};
function quarentena(alvo, motivo) {
  const destino = `${alvo}.ilegivel-${Date.now()}`;
  try {
    fs.renameSync(alvo, destino);
    aviso(`${path.basename(alvo)} estava ilegível (${motivo}); guardado em ${path.basename(destino)}.`);
    const velhos = fs.readdirSync(path.dirname(alvo)).filter((n) => n.startsWith(`${path.basename(alvo)}.ilegivel-`)).sort();
    for (const v of velhos.slice(0, Math.max(0, velhos.length - 5))) { try { fs.rmSync(path.join(path.dirname(alvo), v)); } catch { /* stays */ } }
  } catch { /* no way to move it: the file stays where it is */ }
}

export function ler(rel, padrao) {
  const alvo = abs(rel);
  const r = lerJson(alvo);
  if (r.dados !== undefined) return r.dados;
  const padraoOu = () => (padrao === null ? null : structuredClone(padrao));
  const existia = !r.ausente;
  const candidatos = [`${alvo}.bak`, `${alvo}.tmp`, ...instantaneos(alvo)];
  if (!existia && !candidatos.some((c) => fs.existsSync(c))) return padraoOu();   // never existed: it really is a first time
  for (const c of candidatos) {
    const x = lerJson(c);
    if (x.dados === undefined) continue;
    if (existia) quarentena(alvo, r.zerado ? 'conteúdo zerado por reinício abrupto' : r.vazio ? 'vazio' : 'não foi possível ler');
    try { fs.copyFileSync(c, alvo); } catch { /* carry on with what was read */ }
    aviso(`${path.basename(alvo)} recuperado de ${path.basename(c)}.`);
    return x.dados;
  }
  if (existia) quarentena(alvo, r.zerado ? 'conteúdo zerado por reinício abrupto' : 'não foi possível ler');
  return padraoOu();
}

const ultimoBak = new Map(); const ultimoSnap = new Map();
const INTERVALO_BAK = Number(process.env.STUDIO_BAK_MS ?? 20_000);   // (tests set 0)
function validoNoDisco(f) { try { const b = Buffer.alloc(64); const fd = fs.openSync(f, 'r'); const n = fs.readSync(fd, b, 0, 64, 0); fs.closeSync(fd); return n > 0 && b.subarray(0, n).some((x) => x !== 0); } catch { return false; } }
function protegerAnterior(alvo, tamanhoNovo) {
  let st; try { st = fs.statSync(alvo); } catch { return; }
  if (!st.size || !validoNoDisco(alvo)) return;
  const agora = Date.now();
  // suddenly shrank (e.g. a 500 KB board turning into 50 bytes): the large version is kept aside
  if (st.size > 20_000 && tamanhoNovo < st.size * 0.25) {
    try {
      fs.copyFileSync(alvo, `${alvo}.antes-de-encolher-${agora}`);
      const velhos = fs.readdirSync(path.dirname(alvo)).filter((n) => n.startsWith(`${path.basename(alvo)}.antes-de-encolher-`)).sort();
      for (const v of velhos.slice(0, Math.max(0, velhos.length - 5))) { try { fs.rmSync(path.join(path.dirname(alvo), v)); } catch { /* stays */ } }
      aviso(`${path.basename(alvo)} encolheu de ${st.size} para ${tamanhoNovo} bytes; a versão anterior foi guardada.`);
    } catch { /* no space: carry on */ }
  }
  if (agora - (ultimoBak.get(alvo) || 0) > INTERVALO_BAK) { try { fs.copyFileSync(alvo, `${alvo}.bak`); ultimoBak.set(alvo, agora); } catch { /* no copy this time */ } }
  // one snapshot per hour, in _backups/ (36 hours and one per day over the last 14 days)
  if (st.size > 2048 && agora - (ultimoSnap.get(alvo) || 0) > (process.env.STUDIO_SNAP_MS ? Number(process.env.STUDIO_SNAP_MS) : 3_600_000)) {
    try {
      const dir = path.join(path.dirname(alvo), '_backups'); fs.mkdirSync(dir, { recursive: true });
      const d = new Date(agora), p2 = (n) => String(n).padStart(2, '0');
      fs.copyFileSync(alvo, path.join(dir, `${path.basename(alvo, '.json')}.${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}-${p2(d.getHours())}.json`));
      ultimoSnap.set(alvo, agora);
      const todos = instantaneos(alvo); const manter = new Set(todos.slice(0, 12)); const dias = new Set();   // 12 hours and one per day over 7 days
      for (const f of todos.slice(12)) { const dia = path.basename(f).split('.')[1].slice(0, 8); if (!dias.has(dia) && dias.size < 7) { dias.add(dia); manter.add(f); } }
      for (const f of todos) if (!manter.has(f)) { try { fs.rmSync(f); } catch { /* stays */ } }
    } catch { /* no snapshot this time */ }
  }
}
function escreverDuravel(destino, texto) {
  const fd = fs.openSync(destino, 'w');
  try { fs.writeSync(fd, texto); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}
function renomear(de, para) {
  for (let i = 0; i < 6; i++) {
    try { fs.renameSync(de, para); return; } catch (e) { if (i === 5 || !['EPERM', 'EBUSY', 'EACCES'].includes(e.code)) throw e; espera(60 * (i + 1)); }
  }
}

// Synchronous write: for rarely changing data (configuration, project registry), where waiting on the disk does not matter.
function gravarSincrono(alvo, texto) {
  fs.mkdirSync(path.dirname(alvo), { recursive: true });
  const tmp = `${alvo}.tmp`;
  escreverDuravel(tmp, texto);
  protegerAnterior(alvo, Buffer.byteLength(texto));
  renomear(tmp, alvo);
}
export function gravar(rel, dados) {
  const alvo = abs(rel);
  geracao.set(alvo, (geracao.get(alvo) || 0) + 1);   // an in-flight write older than this one is discarded
  cancelarAdiada(alvo);
  gravarSincrono(alvo, JSON.stringify(dados, null, 2));
}

// ---- Deferred writes ---------------------------------------------------------------------------------------------------
// With several agents working, the board and the conversations change dozens of times a minute. Writing on every change,
// synchronously and with fsync (and also rewriting quadro.md and one progress.md per card), blocked the thread that also serves the UI and reads
// agent output. Now:
//  - several changes in a row become ONE write (short wait, with a cap), serialized at write time, so the file always
//    shows a consistent instant;
//  - fsync and the write happen off the main thread (fs.promises);
//  - on app close, everything pending or in flight is written synchronously (descarregarSync), so closing never loses anything;
//  - a file uses only one mode: either gravar() or gravarDepois().
const fsp = fs.promises;
const fontes = new Map();    // target -> () => data (every file that uses deferred writes)
const timers = new Map();    // target -> { t, desde }
const noAr = new Map();      // target -> Promise of the in-progress write (one at a time per file)
const geracao = new Map();   // target -> n; a newer write invalidates the one still in flight
const sujos = new Set();     // targets with changes not yet confirmed on disk
const tarefas = new Map();   // key -> { t, desde, fn } (deferred work that is not JSON, such as the derived .md files)
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

function cancelarAdiada(alvo) { const x = timers.get(alvo); if (x) { clearTimeout(x.t); timers.delete(alvo); } sujos.delete(alvo); }
async function renomearAsync(de, para) {
  for (let i = 0; i < 6; i++) {
    try { await fsp.rename(de, para); return; } catch (e) { if (i === 5 || !['EPERM', 'EBUSY', 'EACCES'].includes(e.code)) throw e; await esperar(60 * (i + 1)); }
  }
}
async function gravarAssincrono(alvo, texto, ger) {
  await fsp.mkdir(path.dirname(alvo), { recursive: true });
  const tmp = `${alvo}.a${ger}.tmp`;
  const fh = await fsp.open(tmp, 'w');
  try { await fh.writeFile(texto); await fh.sync(); } finally { await fh.close(); }
  if (geracao.get(alvo) !== ger) { fsp.rm(tmp, { force: true }).catch(() => {}); return; }   // written again later: this one is already stale
  protegerAnterior(alvo, Buffer.byteLength(texto));
  await renomearAsync(tmp, alvo);
}
function disparar(alvo) {
  cancelarAdiada(alvo);
  const fonte = fontes.get(alvo);
  if (!fonte) return Promise.resolve();
  let texto;
  try { texto = JSON.stringify(fonte(), null, 2); } catch (e) { aviso(`${path.basename(alvo)} não pôde ser serializado: ${e.message}`); return Promise.resolve(); }
  const ger = (geracao.get(alvo) || 0) + 1; geracao.set(alvo, ger);
  const p = (noAr.get(alvo) || Promise.resolve())
    .then(() => gravarAssincrono(alvo, texto, ger))
    .catch((e) => { aviso(`${path.basename(alvo)} não foi gravado (${e.message}); tentando de novo.`); sujos.add(alvo); reagendar(alvo, 2000); })
    .finally(() => { if (noAr.get(alvo) === p) noAr.delete(alvo); });
  noAr.set(alvo, p);
  return p;
}
function reagendar(alvo, espera, maximo = 2000) {
  const atual = timers.get(alvo);
  const agora = Date.now();
  const desde = atual?.desde ?? agora;
  if (atual) clearTimeout(atual.t);
  const t = setTimeout(() => disparar(alvo), Math.min(espera, Math.max(0, desde + maximo - agora)));
  t.unref?.();
  timers.set(alvo, { t, desde });
}
/** Requests writing `dados` (an object, or a function returning the current object). Several calls in a row become one write. */
export function gravarDepois(rel, dados, { espera = 300, maximo = 2000 } = {}) {
  const alvo = abs(rel);
  fontes.set(alvo, typeof dados === 'function' ? dados : () => dados);
  sujos.add(alvo);
  reagendar(alvo, espera, maximo);
}
/** Work that can wait and be batched (e.g. rewriting the board's derived .md files). */
export function adiar(chave, fn, espera = 1500, maximo = 5000) {
  const a = tarefas.get(chave);
  const agora = Date.now();
  const desde = a?.desde ?? agora;
  if (a) clearTimeout(a.t);
  const t = setTimeout(() => { tarefas.delete(chave); try { fn(); } catch (e) { aviso(`tarefa adiada "${chave}" falhou: ${e.message}`); } }, Math.min(espera, Math.max(0, desde + maximo - agora)));
  t.unref?.();
  tarefas.set(chave, { t, desde, fn });
}
/** Writes everything pending and waits for what is in flight. Use before reading from disk (save point, tests). */
export async function descarregar() {
  for (const [chave, a] of [...tarefas]) { clearTimeout(a.t); tarefas.delete(chave); try { a.fn(); } catch { /* carry on */ } }
  for (const alvo of [...sujos]) disparar(alvo);
  await Promise.all([...noAr.values()]);
}
/** On close: everything pending or in flight is written now, synchronously. */
export function descarregarSync() {
  for (const [chave, a] of [...tarefas]) { clearTimeout(a.t); tarefas.delete(chave); try { a.fn(); } catch { /* carry on */ } }
  for (const alvo of new Set([...sujos, ...noAr.keys()])) {
    const fonte = fontes.get(alvo);
    cancelarAdiada(alvo);
    if (!fonte) continue;
    try { geracao.set(alvo, (geracao.get(alvo) || 0) + 1); gravarSincrono(alvo, JSON.stringify(fonte(), null, 2)); } catch (e) { aviso(`${path.basename(alvo)} não foi gravado ao fechar: ${e.message}`); }
  }
}
process.on('exit', descarregarSync);

/** Derived file (regenerable, like quadro.md): only rewrites if the content changed, without fsync. */
const ultimoDerivado = new Map();
export function escreverSeMudou(alvo, texto) {
  const t = String(texto);
  if (ultimoDerivado.get(alvo) === t) return false;
  fs.mkdirSync(path.dirname(alvo), { recursive: true });
  const tmp = `${alvo}.tmp`;
  fs.writeFileSync(tmp, t);
  renomear(tmp, alvo);
  ultimoDerivado.set(alvo, t);
  return true;
}

/** Plain text (notes, reports) with the same guarantee: the content reaches the disk before the file counts. */
export function escreverTexto(alvo, texto) {
  fs.mkdirSync(path.dirname(alvo), { recursive: true });
  const tmp = `${alvo}.tmp`;
  escreverDuravel(tmp, String(texto));
  renomear(tmp, alvo);
}

export const existe = (rel) => fs.existsSync(abs(rel));
export const removerPasta = (rel) => fs.rmSync(abs(rel), { recursive: true, force: true });

export const CONFIG_PADRAO = {
  engine: 'claude',
  modo: 'conversar',
  // Economical defaults: Sonnet 5.5 and Terra 6.1 at medium level. With automatic Cris enabled (creditos.automatico),
  // these only act as the manual default; she picks per call.
  modeloClaude: 'claude-sonnet-5-5',
  esforcoCodex: 'medium', // low, medium, high, xhigh, max or ultra ("high" or above only when medium is not enough)
  esforcoClaude: 'medium', // low, medium, high, xhigh or max
  claudeExe: '', // empty = the newest Claude Code on the machine
  modeloCodex: 'gpt-6.1-terra',
  codexExe: '', // empty = the newest Codex on the machine
  wip: { pronto: 5, andamento: 3, revisao: 3, qa: 3 },
  // The team cycle: what happens on its own when someone finishes a stage.
  ciclo: {
    orcamento: 14,        // maximum agent calls per request of yours (guard against cascades)
    posts: false,         // completed card: the owner also writes a document in the Posts channel (off: the completion already arrives short by DM, without spending another call)
    versionar: true,      // completed card calls the Versioning agent (conflict, commit, push)
    planningReplica: true, // in planning, agents debate each other's opinions before the proposal
    limiteChamadaMin: 30, // maximum time of an agent call before it is terminated
    paralelo: 3,          // how many agents work at the same time (1 = one at a time)
    revisaoAuto: true,    // a card entering Review calls the P.O.; in QA it calls QA
    curadoriaAuto: true,  // a completed card with new notes calls the Curator
    fechamento: false,    // (off: each card's final report already closes the matter; the P.O. closes only if you ask)
    pontosMax: 5,         // a card bigger than this is rejected: a small task costs less and comes back from review less often
    limpezaHoras: 5,      // every how many hours the agents' context is reset (0 = never)
    briefing: true,       // Assessoria: leadership does the daily read (Jira, calendar, boards, conversations) and proposes what to do, without waiting for orders
    briefingHora: '08:30',
    assessorAuto: false,       // Opt-in: existing projects keep their explicit choice.
    segundoPlano: false,      // Visible opt-in: closing the window keeps the process in the tray.
    assessorIntervaloMin: 60,  // at least this interval between rounds, and at most 8 per day; a signal equal to the last round's does not trigger a call
    assessorCategorias: { agenda: true, jira: true, equipes: true, quadro: true, perguntas: true, custos: false },   // which signals can wake the assessor
    assessorHorario: { inicio: '07:00', fim: '21:00' },   // outside this window the assessor takes no initiative (direct requests still apply)
    statusPO: true,       // every card status change triggers the P.O., who steps in and updates the Game Director
  },
  // Autopilot: with the app open, the app watches the board (no model) and wakes the P.O. when there is work
  // to move forward, so the team keeps going on its own while the Game Director sleeps or is away.
  piloto: { ativo: true, intervaloMin: 1, maxChamadasHora: 0, decideAposMin: 8, poDecide: true }, // 0 = no artificial hourly limit
  // Daily report: the app builds it on its own, without a model, at the scheduled time (while it is open).
  relatorio: { ativo: true, hora: '18:00', comentarioPO: false },
  // Local model (Ollama on this machine): writing, classification and extraction for free. Without it, the app runs without this layer.
  // falasMotor: 'haiku' (Claude's cheapest model writes the event message with the full personality; local is only a fallback),
  // 'local' (local model only, short tone) or 'off'. Local always does what it does well: extract facts, compact logs, filter questions.
  local: { ativo: true, url: 'http://127.0.0.1:11434', modelo: 'hf.co/bartowski/Qwen_Qwen3-4B-Instruct-2507-GGUF:Q4_K_M', timeoutMs: 90000, falas: true, falasMotor: 'haiku', triagem: true, extracao: true },
  // The usage limit is "end of the workday": the app reads consumption (no model) and pauses the agents.
  creditos: {
    pararEm: 95,          // % of usage (5 h or week) at which Claude agents stop until it renews
    trocarMotor: true,    // if one engine stopped, hand the work to the other while it is free
    automatico: true,     // Cris picks the model and reasoning for each call (cheap conversation, hard only when needed)
    codex: { leve: 'gpt-6-luna', medio: 'gpt-6.1-terra', forte: 'gpt-6.1-sol' }, // Codex model by card weight
    // Model floor per role (always applies, even with high usage): forte = Opus 5 or better (Sol on Codex); medio = Sonnet 5.5 (Terra); empty = no floor
    // Leadership of any team (po, chief_of_staff, orquestrador...) has a medio floor by rule in equipe.mjs, even if not in this list.
    pisos: { architect: 'forte', revisor: 'forte', seguranca: 'forte', qa: 'medio', po: 'medio', versionamento: 'medio' },
    claude: { conversa: 'claude-haiku-4-5', baixo: 'claude-sonnet-4-6', medio: 'claude-sonnet-5-5', forte: 'claude-opus-5', maximo: 'claude-opus-5-5' }, // Claude ladder, from cheapest to strongest
  },
};

// The configuration is read dozens of times per second (every request, every tick, every prompt build). Re-reading and re-parsing the file
// on every call weighed on the event loop; now it only re-reads when the file changes (date and size) and always returns a copy.
let cacheCfg = null;
function lerSettings() {
  const alvo = abs('settings.json');
  let st = null; try { st = fs.statSync(alvo); } catch { /* does not exist yet */ }
  if (st && cacheCfg && !cacheCfg.ausente && cacheCfg.m === st.mtimeMs && cacheCfg.s === st.size) return structuredClone(cacheCfg.dados);
  if (!st && cacheCfg?.ausente && Date.now() - cacheCfg.em < 2000) return structuredClone(cacheCfg.dados);
  const dados = ler('settings.json', CONFIG_PADRAO);
  cacheCfg = st ? { m: st.mtimeMs, s: st.size, dados } : { ausente: true, em: Date.now(), dados };
  return structuredClone(dados);
}

export function lerConfig() {
  const c = lerSettings();
  return {
    ...CONFIG_PADRAO,
    ...c,
    wip: { ...CONFIG_PADRAO.wip, ...(c.wip || {}) },
    ciclo: { ...CONFIG_PADRAO.ciclo, ...(c.ciclo || {}) },
    relatorio: { ...CONFIG_PADRAO.relatorio, ...(c.relatorio || {}) },
    piloto: { ...CONFIG_PADRAO.piloto, ...(c.piloto || {}) },
    local: { ...CONFIG_PADRAO.local, ...(c.local || {}) },
    creditos: { ...CONFIG_PADRAO.creditos, ...(c.creditos || {}), codex: { ...CONFIG_PADRAO.creditos.codex, ...((c.creditos || {}).codex || {}) }, claude: { ...CONFIG_PADRAO.creditos.claude, ...((c.creditos || {}).claude || {}) }, pisos: { ...CONFIG_PADRAO.creditos.pisos, ...((c.creditos || {}).pisos || {}) } },
  };
}

export function gravarConfig(c) {
  cacheCfg = null;
  gravar('settings.json', c);
}
