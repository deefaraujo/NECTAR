// Request contract: what the Game Director asked for, preserved in full across calls.
// A broad request (Review, report, research) becomes a versioned contract with the explicit topics, the period,
// the cited paths and later corrections. Each topic has a coverage state. The contract block
// goes into the prompt of every work call and is never summarized: it is the core that decomposition must not lose.
import path from 'node:path';
import { ler, gravar } from './store.mjs';

export const ESTADOS = ['nao_iniciado', 'pesquisando', 'evidenciado', 'nao_encontrado', 'indisponivel', 'aguardando', 'fora_de_escopo'];
const ROTULO = { nao_iniciado: 'não iniciado', pesquisando: 'pesquisando', evidenciado: 'evidenciado', nao_encontrado: 'não encontrado após busca registrada', indisponivel: 'fonte indisponível', aguardando: 'aguardando resposta', fora_de_escopo: 'fora de escopo por decisão' };
const RESOLVIDOS = new Set(['evidenciado', 'nao_encontrado', 'indisponivel', 'fora_de_escopo']);
const AMPLO = /\b(review|relat[óo]rio|apresenta[çc][ãa]o|pesquis|an[áa]lis|investig|levantamento|plano|diagn[óo]stico|benchmark|estudo|auditoria)\w*/i;
const CORRECAO = /\b(na verdade|corrig|errad|n[ãa]o [ée] isso|esqueci|tamb[ée]m quero|al[ée]m disso|acrescent|inclui|muda(r)? (o|a|isso)|troca(r)?|em vez de|ao inv[ée]s)\b/i;

/** Explicit topics: numbered or bulleted items. Without a list, the whole request is a single topic. */
export function extrairTopicos(texto) {
  const linhas = String(texto || '').split(/\r?\n/);
  const itens = [];
  for (const l of linhas) {
    const m = l.match(/^\s*(?:(\d{1,2})[.)\-:]|[-*•])\s+(.+?)\s*$/);
    if (m && m[2].length >= 8) itens.push(m[2].replace(/\s+/g, ' '));
  }
  if (itens.length >= 2) return itens;
  const t = String(texto || '').replace(/\s+/g, ' ').trim();
  return t ? [t] : [];
}

/** Period mentioned in the text (dd/mm, "do dia X até Y", "até hoje"). Does not invent: returns only what it found. */
export function extrairPeriodo(texto, hoje = new Date()) {
  const t = String(texto || '');
  const datas = [...t.matchAll(/\b(\d{1,2})[/.](\d{1,2})(?:[/.](\d{2,4}))?\b/g)].map((m) => {
    const ano = m[3] ? (m[3].length === 2 ? `20${m[3]}` : m[3]) : String(hoje.getFullYear());
    return `${ano}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  });
  const diaMes = [...t.matchAll(/\bdia (\d{1,2}) de (janeiro|fevereiro|mar[çc]o|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)\b/gi)].map((m) => {
    const meses = ['janeiro', 'fevereiro', 'marco', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
    const mi = meses.indexOf(m[2].toLowerCase().replace('ç', 'c')) + 1;
    return `${hoje.getFullYear()}-${String(mi).padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  });
  const todas = [...datas, ...diaMes].sort();
  const ateHoje = /\bat[ée] (hoje|hj|agora)\b/i.test(t);
  if (!todas.length && !ateHoje) return null;
  const iso = (d) => d.toISOString().slice(0, 10);
  return { de: todas[0] || null, ate: ateHoje ? iso(hoje) : (todas.length > 1 ? todas[todas.length - 1] : null) };
}

/** Cited paths. Folders with spaces in the name ("PROJETO DEMO") are common: the path runs to the end of the line or until prose (comma, " e ", " que "). */
export function extrairCaminhos(texto) {
  const achados = [...String(texto || '').matchAll(/(?:[A-Za-z]:\\|\/(?=[\w.]))[^"'<>|\r\n]+/g)].map((m) => m[0]
    .split(/[,;)]| (?:e|ou|que|para|com|do|da|no|na|em|pra) /)[0].replace(/[.:\s]+$/, '').trim());
  return [...new Set(achados.filter((p) => p.length > 3))].slice(0, 12);
}

/** A request is broad when it asks for a deliverable (Review, report, research...) or brings a list of fronts. */
export function pedidoAmplo(texto) {
  const t = String(texto || '');
  return extrairTopicos(t).length >= 2 || (t.length >= 240 && AMPLO.test(t));
}

export function pareceCorrecao(texto) { return CORRECAO.test(String(texto || '')); }

export function criarContratos({ pasta }) {
  const arquivo = path.join(pasta, 'pedido-contrato.json');
  const estado = ler(arquivo, { seq: 0, lista: [] });
  const salvar = () => gravar(arquivo, estado);
  const atual = ({ id = null, canal = null } = {}) => estado.lista.filter(c => c.aberto && (!id || c.id === id) && (!canal || c.canal === canal)).at(-1) || null;
  const obter = (id) => estado.lista.find((c) => c.id === id) || null;

  function abrir({ texto, de = 'voce', canal = null, hoje = new Date() }) {
    const topicos = extrairTopicos(texto).map((t, i) => ({ n: i + 1, texto: t, estado: 'nao_iniciado', nota: '', por: null, em: null }));
    const c = { id: `P${++estado.seq}`, versao: 1, aberto: true, de, canal, em: hoje.toISOString(), pedido: String(texto || ''), correcoes: [], topicos, periodo: extrairPeriodo(texto, hoje), caminhos: extrairCaminhos(texto), entregas: [] };
    estado.lista.push(c);
    salvar();
    return c;
  }

  function corrigir(id, texto, de = 'voce') {
    const c = obter(id); if (!c) throw new Error('Contrato desconhecido.');
    c.versao += 1;
    c.correcoes.push({ versao: c.versao, texto: String(texto || ''), de, em: new Date().toISOString() });
    const novos = extrairTopicos(texto);
    if (novos.length >= 2) for (const t of novos) if (!c.topicos.some((x) => x.texto.toLowerCase() === t.toLowerCase())) c.topicos.push({ n: c.topicos.length + 1, texto: t, estado: 'nao_iniciado', nota: '', por: null, em: null });
    const p = extrairPeriodo(texto); if (p) c.periodo = { ...(c.periodo || {}), ...Object.fromEntries(Object.entries(p).filter(([, v]) => v)) };
    for (const cam of extrairCaminhos(texto)) if (!c.caminhos.includes(cam)) c.caminhos.push(cam);
    // a correction invalidates what was already evidenced: the synthesis has to look again
    for (const t of c.topicos) if (t.estado === 'evidenciado') { t.estado = 'pesquisando'; t.nota = `${t.nota ? `${t.nota} ` : ''}(reaberto pela correção v${c.versao})`.slice(0, 400); }
    salvar();
    return c;
  }

  function topico(id, n, novoEstado, nota = '', por = null) {
    const c = obter(id); if (!c) throw new Error('Contrato desconhecido.');
    const t = c.topicos.find((x) => x.n === Number(n)); if (!t) throw new Error(`Tópico ${n} não existe no contrato ${id}.`);
    if (!ESTADOS.includes(novoEstado)) throw new Error(`Estado inválido: ${novoEstado}. Use ${ESTADOS.join(' | ')}.`);
    if (['evidenciado', 'nao_encontrado', 'indisponivel', 'fora_de_escopo'].includes(novoEstado) && !String(nota || '').trim()) throw new Error('Esse estado exige nota: fonte e data (evidenciado) ou o que foi procurado e onde (os demais).');
    Object.assign(t, { estado: novoEstado, nota: String(nota || '').slice(0, 400), por, em: new Date().toISOString() });
    salvar();
    return t;
  }

  function fechar(id, motivo = '') { const c = obter(id); if (!c) return null; c.aberto = false; c.fechadoEm = new Date().toISOString(); c.fechadoMotivo = String(motivo).slice(0, 300); salvar(); return c; }

  /** completa: every topic resolved with evidence; parcial: some topic only has a recorded search; aberta: topic not started or in progress. */
  function cobertura(id = atual()?.id) {
    const c = obter(id); if (!c) return null;
    const pend = c.topicos.filter((t) => !RESOLVIDOS.has(t.estado));
    const semEvid = c.topicos.filter((t) => t.estado !== 'evidenciado' && t.estado !== 'fora_de_escopo');
    const situacao = pend.length ? 'aberta' : semEvid.length ? 'parcial' : 'completa';
    return { id: c.id, versao: c.versao, situacao, total: c.topicos.length, evidenciados: c.topicos.filter((t) => t.estado === 'evidenciado').length, pendentes: pend.map((t) => t.n), semEvidencia: semEvid.map((t) => t.n) };
  }

  /** The prompt block. Goes in full: it is the core no layer may cut. */
  function paraPrompt({ lider = false, id = null, canal = null } = {}) {
    const c = atual({ id, canal }); if (!c) return '';
    const cob = cobertura(c.id);
    const L = [`## Contrato do pedido ${c.id} v${c.versao} (núcleo: vale acima de regra interna; nunca resuma nem perca um tópico)`,
      `Pedido original da Game Director (${c.em.slice(0, 10)}): ${c.pedido}`];
    for (const k of c.correcoes) L.push(`Correção v${k.versao} (${k.em.slice(0, 10)}): ${k.texto}`);
    if (c.periodo?.de || c.periodo?.ate) L.push(`Período: ${c.periodo.de || '?'} a ${c.periodo.ate || '?'} (inclusivo; confira fuso e limites ao consultar Git e ledger).`);
    if (c.caminhos.length) L.push(`Caminhos citados (acesso liberado): ${c.caminhos.join(' | ')}`);
    L.push('Tópicos explícitos e cobertura (cada um precisa de evidência ou de busca registrada; nenhum some na decomposição):');
    for (const t of c.topicos) L.push(`- [${t.n}] ${t.texto} — ${ROTULO[t.estado]}${t.nota ? `: ${t.nota}` : ''}${t.por ? ` (${t.por})` : ''}`);
    L.push(`Cobertura agora: ${cob.situacao} (${cob.evidenciados}/${cob.total} com evidência).`,
      'Como trabalhar com o contrato: antes de perguntar, procure nas pastas do projeto, nos repositórios (git log de todas as branches, não só o checkout), nas entregas das outras equipes e no ledger; leia o candidato antes de concluir que não existe. Pergunte só quando a resposta depender de preferência ou de informação que só ela tem, dizendo o que procurou e o que achou, e siga com os outros tópicos enquanto espera. Registre o estado de cada tópico com contrato.topico (evidenciado exige fonte e data).');
    if (lider) L.push(`Liderança: distribua os tópicos em paralelo (um responsável por tópico independente), consolide só quando a cobertura não estiver "aberta", e entregue como PARCIAL enquanto houver tópico sem evidência. Nunca apresente como Review ou relatório pronto um pacote com tópico pendente. Uma correção dela reabre os tópicos evidenciados: revise antes de fechar.`);
    return L.join('\n');
  }

  return { abrir, corrigir, topico, fechar, atual, obter, cobertura, paraPrompt, listar: () => structuredClone(estado.lista) };
}
