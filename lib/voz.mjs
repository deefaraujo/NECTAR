// Voice call with the team's leadership (the assessor, in Assessoria): the browser records and sends WAV, this module transcribes
// (faster-whisper) and synthesizes (Piper) in a persistent local Python worker, and the conversation goes through the same agent and the same DM
// as chat: no second assistant and no parallel memory. Events come back through the app's SSE (type "voz").
// To sound like a phone call, the reply is spoken sentence by sentence while the model is still writing, and talking over it drops the queue.
// Microphone only during an open session (the UI does the recording); audio files live in a temp folder and are removed on close.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { DIR } from './store.mjs';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
// In the packaged app this file lives inside app.asar, which Python cannot open: the worker stays outside (asarUnpack in package.json).
const WORKER = path.join(AQUI.replace(/app\.asar([\\/]|$)/, 'app.asar.unpacked$1'), 'voz_worker.py');
const RAIZ = path.join(DIR, 'voz');
const PIPER_DIR = path.join(RAIZ, 'piper');
const PIPER_VOZ = 'pt_BR-faber-medium';
const URL_VOZ = (n) => `https://huggingface.co/rhasspy/piper-voices/resolve/main/pt/pt_BR/faber/medium/${n}`;
const FAKE = () => process.env.STUDIO_FAKE === '1';

// ---- voice configuration (voz.json in the data folder): { "tts": "piper" | "chatterbox" } ----------------------------------
const ARQ_CFG = path.join(RAIZ, 'voz.json');
export function lerVozConfig() { try { return JSON.parse(fs.readFileSync(ARQ_CFG, 'utf8')); } catch { return {}; } }
export function definirVozConfig(cfg) { fs.mkdirSync(RAIZ, { recursive: true }); const antes = lerVozConfig(); fs.writeFileSync(ARQ_CFG, JSON.stringify({ ...antes, ...cfg }, null, 2)); if (cfg.tts && cfg.tts !== antes.tts) matarWorkers(); return lerVozConfig(); }
// How much to spend at each moment of the meeting (router level: minimo | low | medium | high). Speech needs a fast, cheap reply;
// looking at the shared screen needs a model that sees well, but without long reasoning; detailed analysis only when the agent asks.
// 'chat' = same as chat (same model and reasoning routing): the call is the same conversation, not a cheap version of it
export const NIVEIS_VOZ_PADRAO = { fala: 'chat', tela: 'chat', analise: 'medium' };
export const niveisVoz = () => ({ ...NIVEIS_VOZ_PADRAO, ...(lerVozConfig().niveis || {}) });
// ---- the voice itself: Chatterbox clones the timbre and accent from a short WAV. Without a reference the default voice sounds foreign and rushed,
// so the app ships public-domain Brazilian voices (LibriVox readings, vozes/ folder) and accepts a custom sample.
// pace = cfg_weight (lower is slower); expressiveness = exaggeration.
const VOZES_DIR = path.join(AQUI.replace(/app\.asar([\\/]|$)/, 'app.asar.unpacked$1'), '..', 'vozes');
const VOZES = [
  { id: 'leni', nome: 'Leni', genero: 'feminina', origem: 'LibriVox, Variações sobre o flirt (João do Rio)' },
  { id: 'felipe', nome: 'Felipe', genero: 'masculina', origem: 'LibriVox, Helena (Machado de Assis)' },
  { id: 'bilac', nome: 'Leitor de Bilac', genero: 'masculina', origem: 'LibriVox, Contos para Velhos (Olavo Bilac)' },
];
export const VOZ_PADRAO = { nome: 'leni', ritmo: 0.4, expressividade: 0.45 };
const AMOSTRA_PROPRIA = () => path.join(RAIZ, 'vozes', 'propria.wav');
export const vozAtual = () => { const v = { ...VOZ_PADRAO, ...(lerVozConfig().voz || {}) }; v.ritmo = Math.min(0.8, Math.max(0.15, Number(v.ritmo) || VOZ_PADRAO.ritmo)); v.expressividade = Math.min(0.9, Math.max(0.2, Number(v.expressividade) || VOZ_PADRAO.expressividade)); return v; };
export function listarVozes() {
  const lista = VOZES.filter((v) => fs.existsSync(path.join(VOZES_DIR, `${v.id}.wav`))).map((v) => ({ ...v, propria: false }));
  if (fs.existsSync(AMOSTRA_PROPRIA())) lista.push({ id: 'propria', nome: 'Minha amostra', genero: '', origem: 'WAV enviado por você', propria: true });
  lista.push({ id: 'padrao', nome: 'Padrão do Chatterbox (sem referência)', genero: '', origem: 'voz interna do modelo', propria: false });
  return lista;
}
export function caminhoReferencia(nome = vozAtual().nome) {
  if (nome === 'padrao') return null;
  const arq = nome === 'propria' ? AMOSTRA_PROPRIA() : path.join(VOZES_DIR, `${String(nome).replace(/[^a-z0-9_-]/gi, '')}.wav`);
  return fs.existsSync(arq) ? arq : (nome !== VOZ_PADRAO.nome ? caminhoReferencia(VOZ_PADRAO.nome) : null);
}
/** Stores the sample WAV uploaded by the person (10 to 20 s of clean speech). */
export function salvarAmostra(buffer) {
  if (!buffer || buffer.length < 20000 || buffer.subarray(0, 4).toString() !== 'RIFF') throw new Error('Envie um arquivo WAV com alguns segundos de fala.');
  if (buffer.length > 15 * 1024 * 1024) throw new Error('A amostra passou de 15 MB.');
  fs.mkdirSync(path.dirname(AMOSTRA_PROPRIA()), { recursive: true });
  fs.writeFileSync(AMOSTRA_PROPRIA(), buffer);
  return { ok: true };
}
let previaArquivo = null;
/** One sentence in the chosen voice (or with the given parameters, before saving), to preview in Settings. */
export async function previa({ nome, ritmo, expressividade, texto } = {}) {
  await aquecer();
  const r = await falar(texto || 'Oi! Eu sou a voz da sua equipe. Dei uma olhada no quadro agora há pouco e tem duas coisas esperando a sua decisão. Quer que eu conte o resumo?', { nome, ritmo, expressividade });
  if (previaArquivo) fs.rm(previaArquivo, { force: true }, () => {});
  previaArquivo = r.arquivo;
  return { ok: true, segundos: r.segundos, ms: r.ms };
}
export const arquivoPrevia = () => (previaArquivo && fs.existsSync(previaArquivo) ? previaArquivo : null);

// ---- workers -------------------------------------------------------------------------------------------------------------
// Recognition (faster-whisper, CTranslate2) and natural voice (Chatterbox, torch) load different cuDNN versions and cannot share the same
// process: with the natural voice on, there are two processes; with Piper, just one. Each worker is loaded once and stays up.
const workers = new Map();   // name -> { proc, pronto, pendentes, info }
let seq = 0; let preparando = null;
const venvs = () => [path.join(RAIZ, 'venv', 'Scripts', 'python.exe'), path.join(path.dirname(DIR), 'voz', 'venv', 'Scripts', 'python.exe')];
const pythonDoApp = () => process.env.STUDIO_PYTHON || venvs().find((v) => fs.existsSync(v)) || 'python';
const motorTts = () => 'chatterbox';   // a single voice in the product, the highest-quality one
/** Which worker handles each operation: a single one ("ambos") with Piper; separate "stt" and "tts" with Chatterbox. */
const nomeWorker = (op) => (motorTts() === 'chatterbox' ? (op === 'stt' ? 'stt' : 'tts') : 'ambos');
function matarWorker(nome) {
  const w = workers.get(nome); if (!w) return;
  workers.delete(nome);
  try { w.proc?.kill(); } catch { /* already dead */ }
  for (const p of w.pendentes.values()) { clearTimeout(p.t); p.reject(new Error('o serviço de voz reiniciou')); }
}
function matarWorkers() { for (const n of [...workers.keys()]) matarWorker(n); }
function garantirWorker(nome) {
  const existente = workers.get(nome);
  if (existente) return existente.pronto;
  const w = { proc: null, pronto: null, pendentes: new Map(), info: {} };
  workers.set(nome, w);
  w.pronto = new Promise((resolve, reject) => {
    // Piper and recognition run on the system Python; the natural voice, in the app's environment (where Chatterbox is installed)
    const py = nome === 'tts' ? pythonDoApp() : (process.env.STUDIO_PYTHON || 'python');
    const env = { ...process.env, STUDIO_VOZ_PIPER: caminhoVoz(), STUDIO_VOZ_TTS: motorTts(), STUDIO_VOZ_PAPEL: nome, PYTHONIOENCODING: 'utf-8' };
    let proc;
    try { proc = spawn(py, ['-u', WORKER], { env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] }); } catch (e) { workers.delete(nome); return reject(e); }
    w.proc = proc;
    let buf = ''; let erro = '';
    const t = setTimeout(() => { matarWorker(nome); reject(new Error('O serviço de voz demorou demais para carregar (na primeira vez ele baixa o modelo; tente de novo em alguns minutos).')); }, 10 * 60_000);
    proc.stdout.on('data', (d) => {
      buf += d.toString('utf8'); let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const linha = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
        if (!linha) continue;
        let j; try { j = JSON.parse(linha); } catch { continue; }
        if (j.pronto) {
          clearTimeout(t); w.info = { stt: j.stt, tts: j.tts, python: py };
          if (nome !== 'stt' && !j.tts) { matarWorker(nome); reject(new Error('A voz natural não está instalada neste computador. Ela precisa de placa de vídeo com 4 GB livres e do ambiente de voz do app (pasta voz/venv com o Chatterbox).')); break; }
          resolve(w); continue;
        }
        const p = w.pendentes.get(j.id); if (!p) continue; w.pendentes.delete(j.id); clearTimeout(p.t);
        if (j.erro) p.reject(new Error(j.erro)); else p.resolve(j);
      }
    });
    proc.stderr.on('data', (d) => { erro = (erro + d.toString('utf8')).slice(-2000); });
    proc.on('close', (c) => { clearTimeout(t); const detalhe = erro.split('\n').filter((l) => /Error|error|erro|can't open|No module/.test(l)).slice(-2).join(' ').slice(0, 300); reject(new Error(`O serviço de voz fechou (código ${c}). ${detalhe}`)); matarWorker(nome); });
  });
  w.pronto.catch(() => { if (workers.get(nome) === w) workers.delete(nome); });
  return w.pronto;
}
function pedir(op, extra, timeoutMs = 60_000) { return pedirEm(nomeWorker(op), op, extra, timeoutMs); }
function pedirEm(nome, op, extra, timeoutMs = 60_000) {
  return garantirWorker(nome).then((w) => new Promise((resolve, reject) => {
    const id = ++seq;
    const t = setTimeout(() => { w.pendentes.delete(id); reject(new Error(`${op === 'stt' ? 'A transcrição' : 'A voz'} demorou demais.`)); }, timeoutMs);
    w.pendentes.set(id, { resolve, reject, t });
    w.proc.stdin.write(`${JSON.stringify({ id, op, ...extra })}\n`);
  }));
}
const infoWorkers = () => { const o = {}; for (const [n, w] of workers) if (w.info) Object.assign(o, w.info.stt ? { stt: w.info.stt } : {}, w.info.tts ? { tts: w.info.tts, pythonTts: w.info.python } : {}); return o; };

// ---- a single voice: Chatterbox Multilingual, in the app's voice environment (voz/venv). Piper was removed from the product. ----------------
const caminhoVoz = () => path.join(PIPER_DIR, `${PIPER_VOZ}.onnx`);   // still passed to the worker; no longer downloaded
const ambienteDeVoz = () => !!venvs().find((v) => fs.existsSync(v));

// ---- transcription and synthesis ------------------------------------------------------------------------------------------------
const tmpDir = () => { const d = path.join(RAIZ, 'tmp'); fs.mkdirSync(d, { recursive: true }); return d; };
const wavSilencio = (arquivo, segundos = 0.3) => { const taxa = 16000, n = Math.round(taxa * segundos); const b = Buffer.alloc(44 + n * 2); b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVE', 8); b.write('fmt ', 12); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(taxa, 24); b.writeUInt32LE(taxa * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 2, 40); fs.writeFileSync(arquivo, b); return segundos; };
/** Chat text -> speakable text: no code blocks, no markup, no actions block. */
export const paraFala = (texto) => String(texto || '').split('```')[0].replace(/\[\{"type":[\s\S]*$/, '').replace(/^#+\s*/gm, '').replace(/[*_`>]/g, '').replace(/^\s*[-•]\s+/gm, '').replace(/\s+/g, ' ').trim();
/** Splits the already complete sentences from a text still being written: returns { prontas: [...], resto }. */
export function frasesProntas(texto) {
  const prontas = []; let resto = texto;
  const re = /[^.!?…\n]+[.!?…]+(?=\s|$)|[^\n]+\n/g; let m; let fim = 0;
  while ((m = re.exec(texto))) { const f = m[0].trim(); if (f.length >= 2) prontas.push(f); fim = m.index + m[0].length; }
  resto = texto.slice(fim);
  return { prontas, resto };
}

/** WAV (PCM) recorded by the UI -> text. */
export async function transcrever(wavBuffer) {
  const arquivo = path.join(tmpDir(), `in-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.wav`);
  fs.writeFileSync(arquivo, wavBuffer);
  try {
    if (FAKE()) return { texto: process.env.STUDIO_VOZ_FALSO_TEXTO || 'Qual é a minha agenda de hoje?', segundos: 1.2, ms: 5 };
    const r = await pedir('stt', { wav: arquivo, idioma: 'pt' }, 90_000);
    return { texto: r.texto, segundos: r.segundos, ms: r.ms };
  } finally { fs.rm(arquivo, { force: true }, () => {}); }
}
/** text -> WAV file (path). */
export async function falar(texto, ajuste = {}) {
  const arquivo = path.join(tmpDir(), `out-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.wav`);
  const limpo = paraFala(texto).slice(0, 1800);
  if (!limpo) throw new Error('Nada para falar.');
  if (FAKE()) return { arquivo, segundos: wavSilencio(arquivo), ms: 1 };
  const v = vozEfetiva(ajuste);   // ajuste may be null (agent without its own voice): the Settings voice applies
  const r = await pedir('tts', { texto: limpo, wav: arquivo, ref: caminhoReferencia(v.nome), cfg: Number(v.ritmo), exag: Number(v.expressividade) }, 120_000);
  return { arquivo, segundos: r.segundos, ms: r.ms, motor: motorTts() };
}
export async function estadoServico() {
  if (FAKE()) return { disponivel: true, stt: 'simulado', tts: 'simulado', vozInstalada: true };
  const i = infoWorkers();
  return { disponivel: workers.size > 0 && [...workers.values()].every((w) => w.info && Object.keys(w.info).length), motor: motorTts(), stt: i.stt || null, tts: i.tts || null, vozInstalada: ambienteDeVoz(), python: i.pythonTts || pythonDoApp() };
}
/** Loads everything up front (when the call opens), so the first sentence does not wait for the model. */
export async function aquecer() {
  if (FAKE()) return estadoServico();
  if (!ambienteDeVoz()) throw new Error('A voz natural não está instalada neste computador: falta o ambiente de voz do app (pasta voz/venv com o Chatterbox). Ela também precisa de placa de vídeo com 4 GB livres.');
  await Promise.all([...new Set(['stt', 'tts'].map(nomeWorker))].map((n) => garantirWorker(n)));
  return estadoServico();
}
export function encerrarServico() { matarWorkers(); try { fs.rmSync(path.join(RAIZ, 'tmp'), { recursive: true, force: true }); } catch { /* no folder */ } }

// ---- "deixa eu ver": short filler phrases, generated once and reused, so the call is not silent while the model thinks
const ACKS = ['Deixa eu ver.', 'Um segundo.', 'Hum, deixa eu olhar aqui.', 'Peraí, já te falo.'];
// phrases live in one folder per voice (name, pace, expressiveness): switching voice generates new phrases, without mixing timbres
const vozEfetiva = (ajuste) => ({ ...vozAtual(), ...Object.fromEntries(Object.entries(ajuste || {}).filter(([, x]) => x !== undefined && x !== null && x !== '')) });
const chaveVoz = (ajuste) => { const v = vozEfetiva(ajuste); return `${v.nome}-${Math.round(v.ritmo * 100)}-${Math.round(v.expressividade * 100)}`; };
const acksDir = (chave) => { const d = path.join(RAIZ, 'acks', chave); fs.mkdirSync(d, { recursive: true }); return d; };
const acksCache = new Map();   // voice key -> [files]
async function prepararAcks(ajuste) {
  if (FAKE()) return [];
  const chave = chaveVoz(ajuste);
  if (acksCache.has(chave)) return acksCache.get(chave);
  const lista = [];
  for (let i = 0; i < ACKS.length; i++) {
    const arquivo = path.join(acksDir(chave), `ack-${i}.wav`);
    if (!fs.existsSync(arquivo)) { try { const r = await falar(ACKS[i], ajuste); fs.copyFileSync(r.arquivo, arquivo); fs.rm(r.arquivo, { force: true }, () => {}); } catch { continue; } }
    lista.push(arquivo);
  }
  acksCache.set(chave, lista);
  return lista;
}
const acksDe = (ajuste) => acksCache.get(chaveVoz(ajuste)) || [];

/** Is the recognized text mostly a sentence the agent just spoke? (words in common over the words heard) */
export function ehEco(texto, ditas) {
  const norm = (t) => String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter((w) => w.length > 2);
  const ouvido = norm(texto); if (!ouvido.length) return false;
  for (const d of ditas) {
    const conj = new Set(norm(d)); if (conj.size < 2) continue;
    const comum = ouvido.filter((w) => conj.has(w)).length;
    if (comum / ouvido.length >= 0.6 && comum >= 2) return true;
  }
  return false;
}

// ---- sessions: one per team, with the leadership -----------------------------------------------------------------------------
// The conversation is the normal DM with the leadership: what you say becomes a message to them, and the agent's reply becomes audio, sentence by sentence.
const sessoes = new Map();   // cid -> session
export function criarSessoes({ eventos, emitir }) {
  // queues the synthesis of a chunk and tells the UI when the audio is ready; sentence order is preserved by the chain
  function enfileirar(s, texto, { fim = false } = {}) {
    const geracao = s.geracao;
    const limpo = /^\[?\s*sil[eê]ncio\s*\]?\.?$/i.test(paraFala(texto)) ? '' : paraFala(texto);   // "[silêncio]": the agent saw it and decided not to speak
    s.cadeia = s.cadeia.then(async () => {
      if (s.encerrada || geracao !== s.geracao) return;   // talked over or closed: discard what has not been generated yet
      if (!limpo) { if (fim) emitir({ projeto: s.cid, tipo: 'voz', estado: 'fim' }); return; }
      try {
        const r = await falar(limpo, s.voz);   // the agent's voice (their profile) or the Settings default
        if (s.encerrada || geracao !== s.geracao) { fs.rm(r.arquivo, { force: true }, () => {}); return; }
        const n = ++s.seqAudio; s.audios.set(n, r.arquivo);
        s.ditas = [...(s.ditas || []).slice(-7), limpo];   // what the agent just said, to recognize echo from the speaker
        s.estado = 'falando';
        emitir({ projeto: s.cid, tipo: 'voz', estado: 'falando', audio: n, segundos: r.segundos, texto: limpo, ms: r.ms, fim });
      } catch (err) {
        emitir({ projeto: s.cid, tipo: 'voz', estado: fim ? 'fim' : 'falando', audio: null, texto: limpo, erro: `Não consegui gerar a voz: ${err.message}`, fim });
      }
    });
  }
  eventos.on('evento', (e) => {
    const s = sessoes.get(e.projeto);
    if (!s || s.encerrada) return;
    if (e.tipo === 'delta' && e.id === s.msgAtual && typeof e.texto === 'string') {
      // The first sentence goes to the voice as soon as it closes (to start talking right away); the following ones go in chunks of two or three
      // sentences: each chunk is one synthesis, and sentence by sentence the prosody broke and a cut was left between them.
      const visivel = e.texto.split('```')[0];
      const { prontas } = frasesProntas(visivel.slice(s.faladoAte));
      for (const f of prontas) {
        s.faladoAte += visivel.slice(s.faladoAte).indexOf(f) + f.length;
        s.trecho = s.trecho ? `${s.trecho} ${f}` : f; s.trechoN = (s.trechoN || 0) + 1;
        if (!s.primeiraFalada || s.trechoN >= 3 || s.trecho.length >= 220) { enfileirar(s, s.trecho); s.trecho = ''; s.trechoN = 0; s.primeiraFalada = true; }
      }
      return;
    }
    if ((e.tipo !== 'msg' && e.tipo !== 'msg.upd') || !e.msg || e.msg.canal !== s.canal) return;
    const m = e.msg;
    // started replying: start following this message's deltas
    if (m.de === s.lider && m.status === 'trabalhando') { if (s.msgAtual !== m.id) { s.msgAtual = m.id; s.faladoAte = 0; } return; }
    // speaks the leadership's reply and also the app's direct reply ("sistema") to a question of yours, such as the progress one
    if (m.de !== s.lider && !(m.de === 'sistema' && ['pensando', 'transcrevendo'].includes(s.estado))) return;
    if (s.faladas.has(m.id)) return;
    s.faladas.add(m.id);
    if ((m.status && m.status !== 'ok') || !m.texto) { s.estado = 'ouvindo'; emitir({ projeto: s.cid, tipo: 'voz', estado: 'ouvindo', erro: m.erro || null }); return; }
    s.transcricao.push({ de: m.de === 'sistema' ? s.lider : m.de, texto: m.texto, em: new Date().toISOString() });
    const visivel = m.texto.split('```')[0];
    const resto = m.id === s.msgAtual ? visivel.slice(s.faladoAte) : visivel;   // what has not been spoken yet through the deltas
    const sobra = [s.trecho, resto].filter((x) => x && x.trim()).join(' ');   // sentences that were waiting to close a chunk
    s.msgAtual = null; s.faladoAte = 0; s.trecho = ''; s.trechoN = 0; s.primeiraFalada = false;
    enfileirar(s, sobra, { fim: true });
  });
  return {
    async iniciar(c, { engine, modo } = {}) {
      const lider = c.elenco.papeis.lead || 'po';
      const s = { cid: c.projeto.id, canal: `dm:${lider}`, lider, engine, modo: modo || 'conversar', estado: 'preparando', transcricao: [], audios: new Map(), seqAudio: 0, faladas: new Set(), msgAtual: null, faladoAte: 0, geracao: 0, cadeia: Promise.resolve(), encerrada: false, desde: new Date().toISOString(), tela: null, ultimoAuto: 0, voz: c.elenco.POR_ID[lider]?.estilo?.voz || null };
      sessoes.set(c.projeto.id, s);
      { const r = c.equipe.telaReuniao?.(); if (r) r.ligacao = true; }   // the team knows there is a call: a colleague's reply goes back to the leadership to speak
      emitir({ projeto: s.cid, tipo: 'voz', estado: 'preparando' });
      try { await aquecer(); } catch (e) { s.estado = 'erro'; emitir({ projeto: s.cid, tipo: 'voz', estado: 'erro', erro: e.message }); return { ok: false, erro: e.message, servico: await estadoServico() }; }
      prepararAcks(s.voz).catch(() => {});   // in the background: once per voice
      s.estado = 'ouvindo'; emitir({ projeto: s.cid, tipo: 'voz', estado: 'ouvindo' });
      return { ok: true, lider, nome: c.elenco.POR_ID[lider]?.nome, canal: s.canal, servico: await estadoServico() };
    },
    /** One utterance of yours (WAV): transcribes and sends it to the leadership in the DM, as a normal message (marked as voice). */
    async falou(c, wavBuffer, { anexos = [] } = {}) {
      const s = sessoes.get(c.projeto.id);
      if (!s || s.encerrada) return { ok: false, erro: 'Nenhuma chamada aberta.' };
      if (!wavBuffer?.length || wavBuffer.length < 1000) return { ok: false, erro: 'Áudio vazio.' };
      s.estado = 'transcrevendo'; emitir({ projeto: s.cid, tipo: 'voz', estado: 'transcrevendo' });
      let t;
      try { t = await transcrever(wavBuffer); } catch (e) { s.estado = 'ouvindo'; emitir({ projeto: s.cid, tipo: 'voz', estado: 'ouvindo', erro: e.message }); return { ok: false, erro: e.message }; }
      const texto = String(t.texto || '').trim();
      if (!texto || texto.length < 2) { s.estado = 'ouvindo'; emitir({ projeto: s.cid, tipo: 'voz', estado: 'ouvindo', nada: true }); return { ok: true, texto: '', ignorado: true }; }
      // echo: the microphone heard the agent's own voice (or the filler phrase) and recognition returned what it just said
      if (ehEco(texto, [...(s.ditas || []), ...ACKS])) { s.estado = 'ouvindo'; emitir({ projeto: s.cid, tipo: 'voz', estado: 'ouvindo', eco: true }); return { ok: true, texto: '', ignorado: true, eco: true }; }
      s.geracao++;   // whatever was still in the speech queue belonged to the previous exchange
      s.transcricao.push({ de: 'voce', texto, em: new Date().toISOString(), ms: t.ms, ...(anexos.length ? { tela: true } : {}) });
      // a ready filler phrase (the UI only plays it if the reply takes long)
      let ack = null;
      { const lista = acksDe(s.voz); if (lista.length) { const arq = lista[Math.floor(Math.random() * lista.length)]; ack = ++s.seqAudio; s.audios.set(ack, arq); } }
      s.estado = 'pensando'; emitir({ projeto: s.cid, tipo: 'voz', estado: 'pensando', texto, ms: t.ms, ack });   // before sending: the app's direct reply may arrive at the same moment
      // The shared screen only goes along when it changed since the agent last saw it (or when it asked to look again):
      // a repeated image is wasted spend. The call level follows: speech, screen or detailed analysis.
      const reuniao = c.equipe.telaReuniao?.() || {}; const pedido = reuniao.pedido; reuniao.pedido = null;
      let quadro = anexos; let tela = null;
      if (!quadro.length && s.tela && (!s.tela.enviada || pedido)) { quadro = [s.tela]; s.tela.enviada = true; }
      if (quadro.length) tela = pedido?.detalhe === 'alto' ? 'analise' : 'tela';
      c.equipe.enviar({ canal: s.canal, texto, engine: s.engine, modo: s.modo, voz: true, anexos: quadro, tela });
      return { ok: true, texto, ms: t.ms, tela: !!quadro.length };
    },
    /** A new frame of the shared screen (the UI only sends when the image changed). Kept for the next utterance; if the agent
     *  asked to follow the screen, it is called on its own, at the "tela" level, at most every 20 s and only when nobody is talking. */
    tela(c, anexo) {
      const s = sessoes.get(c.projeto.id);
      if (!s || s.encerrada) return { ok: false, erro: 'Nenhuma chamada aberta.' };
      if (!anexo) { s.tela = null; return { ok: true }; }
      s.tela = { ...anexo, enviada: false };
      const reuniao = c.equipe.telaReuniao?.() || {};
      if (reuniao.acompanhar && s.estado === 'ouvindo' && Date.now() - s.ultimoAuto > 20_000) {
        s.ultimoAuto = Date.now(); s.tela.enviada = true;
        s.estado = 'pensando'; emitir({ projeto: s.cid, tipo: 'voz', estado: 'pensando', auto: true });
        c.equipe.enviar({ canal: s.canal, texto: '(A tela compartilhada mudou. Você pediu para acompanhar: comente em uma frase só se houver algo que mereça atenção agora; se não, responda exatamente [silêncio].)', engine: s.engine, modo: s.modo, voz: true, anexos: [s.tela], tela: 'tela' });
        return { ok: true, auto: true };
      }
      return { ok: true };
    },
    /** You started talking over it: the UI already stopped the audio; here the queue drops and the agent's call is interrupted. */
    interromper(c) {
      const s = sessoes.get(c.projeto.id);
      if (!s || s.encerrada) return { ok: false };
      s.geracao++;
      if (['pensando', 'gerando', 'falando'].includes(s.estado) && s.msgAtual) c.equipe.cancelarAgente(s.lider);
      s.msgAtual = null; s.faladoAte = 0;
      s.estado = 'ouvindo'; emitir({ projeto: s.cid, tipo: 'voz', estado: 'ouvindo', interrompido: true });
      return { ok: true };
    },
    audio(c, n) { const s = sessoes.get(c.projeto.id); const a = s?.audios.get(Number(n)); return a && fs.existsSync(a) ? a : null; },
    estado(c) { const s = sessoes.get(c.projeto.id); return s ? { aberta: !s.encerrada, estado: s.estado, lider: s.lider, canal: s.canal, desde: s.desde, transcricao: s.transcricao.slice(-50), tela: !!s.tela, voz: vozEfetiva(s.voz), acompanhando: !!c.equipe.telaReuniao?.()?.acompanhar, niveis: niveisVoz() } : { aberta: false }; },
    encerrar(c) {
      const s = sessoes.get(c.projeto.id);
      if (!s) return { ok: true };
      s.encerrada = true; s.geracao++; sessoes.delete(c.projeto.id);
      { const r = c.equipe.telaReuniao?.(); if (r) { r.ligacao = false; r.acompanhar = false; r.pedido = null; } }
      for (const a of s.audios.values()) if (!a.includes(`${path.sep}acks${path.sep}`)) fs.rm(a, { force: true }, () => {});   // the filler phrases stay
      emitir({ projeto: s.cid, tipo: 'voz', estado: 'encerrada' });
      return { ok: true, falas: s.transcricao.length };
    },
  };
}
