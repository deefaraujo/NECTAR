// Pontos de salvamento de UM projeto: uma cópia completa do estado (quadro, conversas, memória, perfis, regras, relatórios...) em
// <pasta do projeto>/pontos/<id>/. Dois tipos:
//   automático: a cada 10 minutos, só se algo mudou. Ficam os 12 mais recentes e o primeiro de cada dia dos últimos 14 dias.
//   manual: o botão "Salvar projeto" (ou Ctrl+S). O app nunca apaga um ponto manual sozinho.
// Restaurar não mexe nos arquivos com o app rodando (o app guardaria o estado antigo por cima): marca o ponto, o app reinicia, e a
// restauração é aplicada antes de qualquer arquivo ser carregado. Antes de restaurar, o estado de agora vira um ponto também.
import fs from 'node:fs';
import path from 'node:path';
import { descarregar } from './store.mjs';

const PONTOS = 'pontos';
const IGNORADOS = /(\.bak|\.tmp|\.ilegivel-\d+|\.antes-de-encolher-\d+|\.vazio-apos-a-perda-\d+|\.antes-da-restauracao)$/;
// Pontos automáticos: os 6 mais recentes e um por dia nos últimos 7 dias (cada ponto copia o projeto inteiro: 12 + 14 chegavam a 90 MB).
const MAX_AUTO = 6, DIAS_AUTO = 7, MAX_MANUAIS = 50;
const p2 = (n) => String(n).padStart(2, '0');
const stamp = (d = new Date()) => `${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}-${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}`;
const fsp = fs.promises;
// Tudo que copia ou lê arquivo grande é assíncrono: um ponto de 12 MB e 600 arquivos não pode travar a tela nem os agentes.
const jsonValido = async (f) => { try { const b = await fsp.readFile(f); if (b.length && !b.some((x) => x !== 0)) return false; JSON.parse(b.toString('utf8')); return true; } catch { return false; } };

/** Cópia que sobrevive a um desligamento abrupto: arquivo temporário, fsync e só então o rename (serve para binários, como fotos). */
function copiarDuravel(origem, destino) {
  const tmp = `${destino}.tmp`;
  fs.copyFileSync(origem, tmp);
  const fd = fs.openSync(tmp, 'r+'); try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.renameSync(tmp, destino);
}

/** Itens do projeto que entram no ponto. `completo` inclui relatórios, fotos e perfis (pesados): manuais e o primeiro do dia. */
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

/** Se há uma restauração marcada, aplica ANTES de o projeto carregar qualquer arquivo. Chamado na abertura do projeto. */
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
    try { fs.renameSync(marca, `${marca}.falhou-${Date.now()}`); } catch { /* fica */ }
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

  // Um ponto por vez: salvar manual e automático ao mesmo tempo esperam um pelo outro.
  let fila = Promise.resolve();
  const emFila = (fn) => { const p = fila.then(fn, fn); fila = p.catch(() => {}); return p; };

  /** Cria um ponto. Resolve { ok, ponto } ou { ok:false, erro }. Arquivo ilegível nunca entra (não vale a pena guardar lixo). */
  function salvar(opcoes = {}) {
    return emFila(() => salvarAgora(opcoes));
  }
  async function salvarAgora({ tipo = 'manual', rotulo = '', completo = tipo !== 'auto' } = {}) {
    if (!fs.existsSync(path.join(pasta, 'board.json'))) return { ok: false, erro: 'Este projeto ainda não tem dados para salvar.' };
    if (tipo === 'manual' && listar().filter((p) => p.tipo === 'manual').length >= MAX_MANUAIS) return { ok: false, erro: `Já são ${MAX_MANUAIS} pontos manuais. Exclua algum antes de salvar outro.` };
    await descarregar();   // o que ainda esperava para ir ao disco (quadro, conversas) entra no ponto
    const lista = await itens(pasta, completo);
    const ilegiveis = [];
    for (const i of lista) if (i.rel.endsWith('.json') && !(await jsonValido(i.abs))) ilegiveis.push(i.rel);
    if (ilegiveis.includes('board.json') || ilegiveis.includes('chats.json')) return { ok: false, erro: 'O quadro ou as conversas estão ilegíveis agora; não salvei por cima de um ponto bom.' };
    let id = `${stamp()}-${tipo}`;
    for (let n = 2; fs.existsSync(caminho(id)); n++) id = `${stamp()}-${tipo}${n}`;   // dois pontos no mesmo segundo não se sobrescrevem
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
      try { cards = JSON.parse(await fsp.readFile(path.join(dest, 'board.json'), 'utf8')).cartoes.length; } catch { /* sem quadro */ }
      try { mensagens = Object.values(JSON.parse(await fsp.readFile(path.join(dest, 'chats.json'), 'utf8')).canais || {}).reduce((s, l) => s + l.length, 0); } catch { /* sem conversas */ }
      const m = { id, em: new Date().toISOString(), tipo, rotulo: String(rotulo || '').trim().slice(0, 80), completo, cards, mensagens, arquivos: lista.length - ilegiveis.length, bytes, tamanho: tamanhoHumano(bytes), sig: assinatura(lista), ignorados: ilegiveis };
      await fsp.writeFile(path.join(dest, 'meta.json'), JSON.stringify(m, null, 2));   // por último: ponto sem meta.json não vale
      await podar();
      emitir({ tipo: 'pontos', ponto: m });
      return { ok: true, ponto: m };
    } catch (e) {
      await fsp.rm(dest, { recursive: true, force: true }).catch(() => {});
      return { ok: false, erro: `Não consegui salvar: ${e.message}` };
    }
  }

  /** Automáticos: os 12 mais recentes e o primeiro de cada dia (14 dias). Manuais e "antes de restaurar" nunca saem sozinhos. */
  async function podar() {
    const autos = listar().filter((p) => p.tipo === 'auto');   // do mais novo para o mais velho
    const manter = new Set(autos.slice(0, MAX_AUTO).map((p) => p.id)); const dias = new Set();
    for (const p of [...autos].reverse()) { const dia = p.id.slice(0, 8); if (!dias.has(dia) && dias.size < DIAS_AUTO) { dias.add(dia); manter.add(p.id); } }
    for (const p of autos) if (!manter.has(p.id)) await fsp.rm(caminho(p.id), { recursive: true, force: true }).catch(() => {});
  }

  let ultimoAuto = 0;
  /** Chamado a cada minuto pelo servidor: ponto automático a cada 10 min, só se algo mudou desde o último ponto. */
  async function tick({ forcar = false } = {}) {
    if (!forcar && Date.now() - ultimoAuto < 30 * 60_000) return null;   // meia hora entre pontos automáticos (o .bak e o _backups cobrem o intervalo)
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

  /** Marca a restauração: o estado de agora vira um ponto e o ponto escolhido é aplicado na próxima abertura do projeto. */
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
