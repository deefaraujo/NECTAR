// Project registry: what has already been gathered, written down once and handed ready to whoever needs it.
//
// Each entry is a record of one thing in the project (a character, a scene, the briefing, a decision, a module), with a
// summary that fits in the prompt. On every call the code picks what goes in, without the agent searching:
//   1. what is fixed (types marked `sempre` in the template, such as the briefing and the series style);
//   2. what the delegator pointed to (the card's contexto[]);
//   3. what the task mentions by name or nickname ("faz o quadro da Ana na cena 2" brings Ana and scene 2).
// The rest shows up only as a one-line index, so the agent knows it exists and can ask. The difference from memory:
// memory lists title and path (the agent opens the file and spends to read it); the registry already delivers the content.
// Does not call a model.
import fs from 'node:fs';
import path from 'node:path';
import { ler, gravar } from './store.mjs';
import { normalizar } from './agentes.mjs';

const agora = () => new Date().toISOString();
const corta = (s, n) => { const t = String(s ?? '').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };
const slug = (s) => normalizar(String(s || '')).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50);
// normalized text with spaces at the ends, to match a name as a whole word ("ana" does not match "banana")
const plano = (s) => ` ${normalizar(String(s || '')).replace(/[^a-z0-9]+/g, ' ').trim()} `;

export const TIPOS_PADRAO = {
  briefing: { titulo: 'Briefing', sempre: true },
  decisao: { titulo: 'Decisão' },
  entidade: { titulo: 'Item do projeto' },
};
export const LIMITE_RESUMO = 1800;
export const ORCAMENTO = 7000;   // registry characters per call, summing the full records

/**
 * @param {{ pasta: string, tipos?: Record<string, {titulo?: string, sempre?: boolean, descricao?: string}> }} o
 */
export function criarRegistro({ pasta, tipos = null, vista = '', imagens = true }) {
  const arq = path.join(pasta, 'registro.json');
  // a template that declares its own types (series, character, scene…) does not get the default ones on top: its briefing is the series
  const TIPOS = tipos && Object.keys(tipos).length ? { ...tipos } : { ...TIPOS_PADRAO };
  const estado = ler(arq, { entradas: {} });
  estado.entradas ||= {};
  const salvar = () => gravar(arq, estado);

  const chaveDe = (tipo, id) => `${tipo}:${id}`;
  /** "personagem:ana", "Personagem: Ana" or "ana" (when only one exists) → existing key, or null. */
  function resolver(ref) {
    const r = String(ref || '').trim(); if (!r) return null;
    const m = r.match(/^([^:]+):\s*(.+)$/);
    if (m) { const k = chaveDe(slug(m[1]), slug(m[2])); return estado.entradas[k] ? k : null; }
    const s = slug(r); const achadas = Object.keys(estado.entradas).filter((k) => k.endsWith(`:${s}`));
    return achadas.length === 1 ? achadas[0] : null;
  }

  /** Writes (creates or updates) a record. modo: "substituir" (default) or "acrescentar" (appends to the summary, with the date). */
  function anotar({ tipo, id = '', nome, resumo, apelidos = [], arquivo = '', refs = [], tirarRefs = [], tirarApelidos = [], por = 'sistema', modo = 'substituir' }) {
    const tp = slug(tipo);
    if (!tp) return { ok: false, erro: `diga o tipo (${Object.keys(TIPOS).join(', ')} ou outro).` };
    const nm = corta(nome, 80);
    if (!nm) return { ok: false, erro: 'diga o nome do que está anotando (ex.: "Ana", "Cena 2 do ep 1", "Briefing").' };
    const ident = slug(id || nm);
    const k = chaveDe(tp, ident);
    const anterior = estado.entradas[k];
    const txt = String(resumo ?? '').trim();
    if (!txt && !anterior) return { ok: false, erro: 'a ficha precisa do resumo: o que os colegas precisam saber, sem eles abrirem arquivo.' };
    const novoResumo = modo === 'acrescentar' && anterior ? `${anterior.resumo}\n(${agora().slice(0, 10)}) ${txt}` : (txt || anterior.resumo);
    const e = {
      chave: k, tipo: tp, id: ident, nome: nm,
      apelidos: [...new Set([...(anterior?.apelidos || []), ...(Array.isArray(apelidos) ? apelidos : [apelidos])].map((x) => corta(x, 60)).filter(Boolean))].filter((x) => !(Array.isArray(tirarApelidos) ? tirarApelidos : [tirarApelidos]).includes(x)).slice(0, 12),
      resumo: corta(novoResumo, LIMITE_RESUMO),
      arquivo: corta(arquivo || anterior?.arquivo || '', 300),
      refs: [...new Set([...(Array.isArray(refs) ? refs : [refs]).map(String).filter(Boolean), ...(anterior?.refs || [])])].filter((x) => !(Array.isArray(tirarRefs) ? tirarRefs : [tirarRefs]).map(String).includes(x)).slice(0, 8),
      por, em: agora(), versao: (anterior?.versao || 0) + 1,
      historico: anterior ? [...(anterior.historico || []), { versao: anterior.versao, resumo: anterior.resumo, por: anterior.por, em: anterior.em }].slice(-5) : [],
    };
    estado.entradas[k] = e;
    salvar();
    return { ok: true, entrada: e, nova: !anterior, cortado: novoResumo.length > LIMITE_RESUMO };
  }

  function remover(ref) { const k = resolver(ref); if (!k) return { ok: false }; delete estado.entradas[k]; salvar(); return { ok: true, chave: k }; }
  const obter = (ref) => { const k = resolver(ref); return k ? { ...estado.entradas[k] } : null; };
  const listar = () => Object.values(estado.entradas).map((e) => ({ ...e })).sort((a, b) => a.chave.localeCompare(b.chave));

  /**
   * Picks what goes into the call. textos: what the task says (request, card). chaves: what the delegator pointed to.
   * @returns {{ inteiras: object[], indice: object[], motivos: Record<string,string>, caracteres: number }}
   */
  function selecionar({ textos = [], chaves = [], orcamento = ORCAMENTO } = {}) {
    const todas = listar();
    const t = plano(textos.filter(Boolean).join(' \n '));
    const motivos = {};
    for (const e of todas) if (TIPOS[e.tipo]?.sempre) motivos[e.chave] = 'fixo';
    for (const c of chaves) { const k = resolver(c); if (k && !motivos[k]) motivos[k] = 'apontado'; }
    for (const e of todas) {
      if (motivos[e.chave]) continue;
      const nomes = [e.nome, ...e.apelidos, e.chave.replace(':', ' ')].map(plano).filter((n) => n.trim().length >= 3);
      if (nomes.some((n) => t.includes(n))) motivos[e.chave] = 'citado';
    }
    const ordem = { fixo: 0, apontado: 1, citado: 2 };
    const escolhidas = todas.filter((e) => motivos[e.chave]).sort((a, b) => ordem[motivos[a.chave]] - ordem[motivos[b.chave]]);
    const inteiras = []; let caracteres = 0;
    for (const e of escolhidas) {
      const tam = e.resumo.length + e.nome.length + 80;
      if (inteiras.length && caracteres + tam > orcamento) { motivos[e.chave] = `${motivos[e.chave]}, não coube`; continue; }
      inteiras.push(e); caracteres += tam;
    }
    const dentro = new Set(inteiras.map((e) => e.chave));
    return { inteiras, indice: todas.filter((e) => !dentro.has(e.chave)), motivos, caracteres };
  }

  /** Prompt text for the selection made. Empty when the registry is empty. */
  function paraPrompt(sel, { nomeDe = (x) => x, raiz = '' } = {}) {
    if (!sel || (!sel.inteiras.length && !sel.indice.length)) return '';
    const ab = (f) => (f && raiz && !path.isAbsolute(f) ? path.join(raiz, f) : f);
    const l = ['## O que já foi levantado (registro do projeto)',
      'Isto já foi apurado e anotado: use direto, sem procurar de novo na conversa ou nos arquivos. Abra o arquivo citado só se precisar de detalhe que não está aqui. Se algo aqui estiver desatualizado, corrija com registro.anotar.'];
    for (const e of sel.inteiras) {
      l.push('', `### ${TIPOS[e.tipo]?.titulo || e.tipo}: ${e.nome} [${e.chave}] (v${e.versao}, ${e.em.slice(0, 10)}, ${nomeDe(e.por)})`, e.resumo);
      if (e.refs.length) l.push(`Referências aprovadas: ${e.refs.map(ab).join(' ; ')}`);
      if (e.arquivo) l.push(`Documento completo: ${ab(e.arquivo)}`);
    }
    if (sel.indice.length) {
      l.push('', `### Também anotado (só o nome; aponte no contexto[] do card ou cite pelo nome para receber inteiro)`);
      l.push(...sel.indice.slice(0, 40).map((e) => `- [${e.chave}] ${e.nome}${/não coube/.test(sel.motivos[e.chave] || '') ? ' (citado, não coube nesta chamada)' : ''}`));
      if (sel.indice.length > 40) l.push(`- e mais ${sel.indice.length - 40}.`);
    }
    return l.join('\n');
  }

  return { anotar, remover, obter, listar, resolver, selecionar, paraPrompt, tipos: TIPOS, vista: String(vista || ''), imagens: imagens !== false, arquivo: arq };
}

/** The registry configuration in the template (template.json, key "registro"): types (with title, sempre, description and ready-made
 * requests for the UI) and the view name. Empty when the template declares none (the default types and the "Registro" view apply). */
export function configDoTemplate(dirTemplate) {
  try { const r = JSON.parse(fs.readFileSync(path.join(dirTemplate, 'template.json'), 'utf8')).registro || {}; return { tipos: r.tipos || null, vista: r.vista || '', imagens: r.imagens !== false }; } catch { return { tipos: null, vista: '', imagens: true }; }
}
export const tiposDoTemplate = (dirTemplate) => configDoTemplate(dirTemplate).tipos;
