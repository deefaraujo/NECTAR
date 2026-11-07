// Save points of ONE project: a full copy of the state (board, conversations, memory, profiles, rules, reports...) in
// <pasta do projeto>/pontos/<id>/. Two kinds:
//   automatic: every 10 minutes, only if something changed. Keeps the 12 most recent and the first of each day for the last 14 days.
//   manual: the "Salvar projeto" button (or Ctrl+S). The app never deletes a manual point on its own.
// Restoring does not touch files while the app is running (the app would write the old state over it): it marks the point, the app restarts, and the
// restore is applied before any file is loaded. Before restoring, the current state also becomes a point.
import fs from 'node:fs';
import path from 'node:path';
import { descarregar } from './store.mjs';

const PONTOS = 'pontos';
const IGNORADOS = /(\.bak|\.tmp|\.ilegivel-\d+|\.antes-de-encolher-\d+|\.vazio-apos-a-perda-\d+|\.antes-da-restauracao)$/;
// Automatic points: the 6 most recent and one per day over the last 7 days (each point copies the whole project: 12 + 14 reached 90 MB).
const MAX_AUTO = 6, DIAS_AUTO = 7, MAX_MANUAIS = 50;
const p2 = (n) => String(n).padStart(2, '0');
const stamp = (d = new Date()) => `${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}-${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}`;
const fsp = fs.promises;
// Everything that copies or reads large files is async: a 12 MB, 600-file point must not freeze the UI or the agents.
const jsonValido = async (f) => { try { const b = await fsp.readFile(f); if (b.length && !b.some((x) => x !== 0)) return false; JSON.parse(b.toString('utf8')); return true; } catch { return false; } };

/** Copy that survives an abrupt shutdown: temp file, fsync and only then the rename (works for binaries, such as photos). */
function copiarDuravel(origem, destino) {
  const tmp = `${destino}.tmp`;
  fs.copyFileSync(origem, tmp);
  const fd = fs.openSync(tmp, 'r+'); try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.renameSync(tmp, destino);
}

/** Project items included in the point. `completo` includes reports, photos and profiles (heavy): manual points and the first of the day. */
async function itens(pasta, completo) {
  const out = [];
  const andar = async (dir, rel) => {
    for (const x of await fsp.readdir(dir)) {
      const a = path.join(dir, x); let s; try { s = await fsp.stat(a); } catch { continue; }
      if (s.isDirectory()) await andar(a, `${rel}/${x}`); else if (!IGNORADOS.test(x)) out.push({ rel: `${rel}/${x}`, abs: a, tamanho: s.size, mtime: s.mtimeMs });
    }
  };
  for (const n of await fsp.readdir(pasta)) {
    const f = path.join(pasta, n);
    let st; try { st = await fsp.stat(f); } catch { continue; }
    if (st.isFile() && n.endsWith('.json') && !IGNORADOS.test(n)) out.push({ rel: n, abs: f, tamanho: st.size, mtime: st.mtimeMs });
    else if (st.isDirectory() && (n === 'memoria' || (completo && ['relatorios', 'fotos'].includes(n)))) await andar(f, n);
  }
  return out;
}
const assinatura = (lista) => lista.filter((i) => !i.rel.startsWith('relatorios/') && !i.rel.startsWith('fotos/')).map((i) => `${i.rel}:${i.tamanho}:${Math.round(i.mtime)}`).sort().join('|');
const tamanhoHumano = (b) => (b > 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

/** If a restore is marked, applies it BEFORE the project loads any file. Called when the project opens. */
export function aplicarRestauracaoPendente(pasta) {
  const marca = path.join(pasta, PONTOS, '_restaurar.json');
  if (!fs.existsSync(marca)) return null;
  try {
    const { id } = JSON.parse(fs.readFileSync(marca, 'utf8'));
    const origem = path.join(pasta, PONTOS, String(id));
    if (!/^[\w-]+$/.test(id) || !fs.existsSync(path.join(origem, 'meta.json'))) throw new Error('ponto não encontrado');
    let n = 0;
    const andar = (dir, rel) => {
      for (const x of fs.readdirSync(dir)) {
        const a = path.join(dir, x); const r = rel ? `${rel}/${x}` : x;
        if (fs.statSync(a).isDirectory()) { andar(a, r); continue; }
        if (r === 'meta.json') continue;
        const destino = path.join(pasta, ...r.split('/'));
        fs.mkdirSync(path.dirname(destino), { recursive: true });
        copiarDuravel(a, destino);
        n++;
      }
    };
    andar(origem, '');
    fs.rmSync(marca, { force: true });
    console.error(`[pontos] ponto ${id} restaurado (${n} arquivos).`);
    return { id, arquivos: n };
  } catch (e) {
    console.error('[pontos] a restauração falhou e foi cancelada:', e.message);
    try { fs.renameSync(marca, `${marca}.falhou-${Date.now()}`); } catch { /* stays */ }
    return null;
  }
}

export function criarPontos({ pasta, emitir = () => {} }) {
  const raiz = path.join(pasta, PONTOS);
  const caminho = (id) => path.join(raiz, id);
  const meta = (id) => { try { return JSON.parse(fs.readFileSync(path.join(caminho(id), 'meta.json'), 'utf8')); } catch { return null; } };

  function listar() {
    let ids = []; try { ids = fs.readdirSync(raiz).filter((n) => /^[\w-]+$/.test(n) && fs.existsSync(path.join(raiz, n, 'meta.json'))); } catch { return []; }
    return ids.map(meta).filter(Boolean).sort((a, b) => b.em.localeCompare(a.em));
  }

  // One point at a time: a manual and an automatic save running together wait for each other.
  let fila = Promise.resolve();
  const emFila = (fn) => { const p = fila.then(fn, fn); fila = p.catch(() => {}); return p; };

  /** Creates a point. Resolves { ok, ponto } or { ok:false, erro }. Unreadable files never go in (no point keeping garbage). */
  function salvar(opcoes = {}) {
    return emFila(() => salvarAgora(opcoes));
  }
  async function salvarAgora({ tipo = 'manual', rotulo = '', completo = tipo !== 'auto' } = {}) {
    if (!fs.existsSync(path.join(pasta, 'board.json'))) return { ok: false, erro: 'Este projeto ainda não tem dados para salvar.' };
    if (tipo === 'manual' && listar().filter((p) => p.tipo === 'manual').length >= MAX_MANUAIS) return { ok: false, erro: `Já são ${MAX_MANUAIS} pontos manuais. Exclua algum antes de salvar outro.` };
    await descarregar();   // whatever was still waiting to go to disk (board, conversations) goes into the point
    const lista = await itens(pasta, completo);
    const ilegiveis = [];
    for (const i of lista) if (i.rel.endsWith('.json') && !(await jsonValido(i.abs))) ilegiveis.push(i.rel);
    if (ilegiveis.includes('board.json') || ilegiveis.includes('chats.json')) return { ok: false, erro: 'O quadro ou as conversas estão ilegíveis agora; não salvei por cima de um ponto bom.' };
    let id = `${stamp()}-${tipo}`;
    for (let n = 2; fs.existsSync(caminho(id)); n++) id = `${stamp()}-${tipo}${n}`;   // two points in the same second do not overwrite each other
    const dest = caminho(id);
    try {
      await fsp.mkdir(dest, { recursive: true });
      let bytes = 0;
      for (const i of lista) {
        if (ilegiveis.includes(i.rel)) continue;
        const alvo = path.join(dest, ...i.rel.split('/'));
        await fsp.mkdir(path.dirname(alvo), { recursive: true });
        await fsp.copyFile(i.abs, alvo); bytes += i.tamanho;
      }
      let cards = 0, mensagens = 0;
      try { cards = JSON.parse(await fsp.readFile(path.join(dest, 'board.json'), 'utf8')).cartoes.length; } catch { /* no board */ }
      try { mensagens = Object.values(JSON.parse(await fsp.readFile(path.join(dest, 'chats.json'), 'utf8')).canais || {}).reduce((s, l) => s + l.length, 0); } catch { /* no conversations */ }
      const m = { id, em: new Date().toISOString(), tipo, rotulo: String(rotulo || '').trim().slice(0, 80), completo, cards, mensagens, arquivos: lista.length - ilegiveis.length, bytes, tamanho: tamanhoHumano(bytes), sig: assinatura(lista), ignorados: ilegiveis };
      await fsp.writeFile(path.join(dest, 'meta.json'), JSON.stringify(m, null, 2));   // last: a point without meta.json is not valid
      await podar();
      emitir({ tipo: 'pontos', ponto: m });
      return { ok: true, ponto: m };
    } catch (e) {
      await fsp.rm(dest, { recursive: true, force: true }).catch(() => {});
      return { ok: false, erro: `Não consegui salvar: ${e.message}` };
    }
  }

  /** Automatic: the 12 most recent and the first of each day (14 days). Manual and "before restore" points are never removed automatically. */
  async function podar() {
    const autos = listar().filter((p) => p.tipo === 'auto');   // newest to oldest
    const manter = new Set(autos.slice(0, MAX_AUTO).map((p) => p.id)); const dias = new Set();
    for (const p of [...autos].reverse()) { const dia = p.id.slice(0, 8); if (!dias.has(dia) && dias.size < DIAS_AUTO) { dias.add(dia); manter.add(p.id); } }
    for (const p of autos) if (!manter.has(p.id)) await fsp.rm(caminho(p.id), { recursive: true, force: true }).catch(() => {});
  }

  let ultimoAuto = 0;
  /** Called every minute by the server: automatic point every 10 min, only if something changed since the last point. */
  async function tick({ forcar = false } = {}) {
    if (!forcar && Date.now() - ultimoAuto < 30 * 60_000) return null;   // half an hour between automatic points (the .bak and _backups cover the gap)
    ultimoAuto = Date.now();
    await descarregar();
    let sig; try { sig = assinatura(await itens(pasta, false)); } catch { return null; }
    const ultimo = listar()[0];
    if (!forcar && ultimo && ultimo.sig === sig) return null;
    const dia = stamp().slice(0, 8);
    const primeiroDoDia = !listar().some((p) => p.id.startsWith(dia));
    const r = await salvar({ tipo: 'auto', completo: primeiroDoDia });
    return r.ok ? r.ponto : null;
  }

  /** Marks the restore: the current state becomes a point and the chosen point is applied the next time the project opens. */
  async function restaurar(id) {
    if (!/^[\w-]+$/.test(String(id)) || !meta(id)) return { ok: false, erro: 'Ponto não encontrado.' };
    const antes = await salvar({ tipo: 'antes-de-restaurar', rotulo: `Antes de voltar para ${meta(id).em.slice(0, 16).replace('T', ' ')}` });
    if (!antes.ok && !/ilegíveis/.test(antes.erro || '')) return antes;
    fs.mkdirSync(raiz, { recursive: true });
    fs.writeFileSync(path.join(raiz, '_restaurar.json'), JSON.stringify({ id, marcado: new Date().toISOString() }));
    return { ok: true, reiniciar: true, estadoAtualGuardadoEm: antes.ponto?.id || null };
  }

  function excluir(id) {
    const m = meta(id);
    if (!m) return { ok: false, erro: 'Ponto não encontrado.' };
    if (m.tipo === 'antes-de-restaurar') return { ok: false, erro: 'Este ponto protege o estado de antes de uma restauração; ele fica.' };
    try { fs.rmSync(caminho(id), { recursive: true, force: true }); } catch (e) { return { ok: false, erro: e.message }; }
    return { ok: true };
  }

  return { listar, salvar, tick, restaurar, excluir };
}
