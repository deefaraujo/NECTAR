// Projects: each one has TWO folders, with different roles.
//
//   target folder     where the work lives (the code, the game, the repository). It is the P.O.'s starting point,
//                    who analyzes it according to what is asked. It receives no files from the app.
//   project folder  <programa>/projetos/<nome do projeto>: the team's memory (contexts, decisions,
//                    learnings per agent), the board, the conversations, the notifications, the profiles and the
//                    agents' photos. This is where the records live.
//
// The target folder does not limit the team: agents also look at other directories on the computer when the
// path is mentioned in a message or is in the project's "pastas extras".
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ler, gravar, lerConfig, DIR } from './store.mjs';
import { emitir as emitirGlobal } from './bus.mjs';
import { normalizar, criarElenco, listarTemplates, TEMPLATE_PADRAO } from './agentes.mjs';
import { criarQuadro } from './quadro.mjs';
import { criarMemoria } from './memoria.mjs';
import { criarEquipe } from './equipe.mjs';
import { criarPerfis } from './perfis.mjs';
import { criarNotificacoes } from './notificacoes.mjs';
import { criarIntegracoes } from './integracoes.mjs';
import { criarFaxina } from './faxina.mjs';
import { criarPontos, aplicarRestauracaoPendente } from './pontos.mjs';
import { ledgerDe } from './evidencias.mjs';
import { agendaDe } from './compromissos.mjs';
import { RAIZ_PROJETOS, caminhoDe, reservarPasta, gravarInfo, migrarLegado } from './pastas.mjs';

let reg = ler('projetos.json', { ativo: null, lista: [] });
const salvarReg = () => gravar('projetos.json', reg);
const contextos = new Map();

const slug = (s) => normalizar(String(s)).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30) || 'projeto';
const igual = (a, b) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();

// Projects created before this layout: they get their own folder, with what they already had copied there.
// Nothing is deleted from the old locations (app data and .gamestudio in the target folder).
(function migrar() {
  let mudou = false;
  const usadas = new Set(reg.lista.filter((p) => p.pasta).map((p) => p.pasta.toLowerCase()));
  for (const p of reg.lista) {
    if (p.pasta) continue;
    try {
      const r = reservarPasta(p.nome, p.raiz, usadas);
      p.pasta = r.pasta; usadas.add(r.pasta.toLowerCase());
      migrarLegado({ pasta: p.pasta, alvo: p.raiz, dadosAntigos: path.join(DIR, 'projetos', p.id) });
      p.template = p.template || TEMPLATE_PADRAO;
      p.extras = p.extras || [];
      gravarInfo(p.pasta, p);
      mudou = true;
    } catch (e) { console.error(`Não consegui organizar a pasta de "${p.nome}":`, e.message); }
  }
  if (mudou) salvarReg();
}());

// ---- Teams inside the project -------------------------------------------------------------------------------------------
// A project (one work folder) brings together several teams: each team is a template (Software, Assessoria, Product Design...)
// with its own board, conversations, memory and agents. Each team is a full context, identified by "<projeto>__<equipe>";
// that id goes through every /api/p/<id>/... route without changing anything in them. The team the project already had is the "principal" and
// stays in the usual folder (nothing migrates); new ones go in <pasta do projeto>/equipes/<id>.
export const SEP = '__';
const separar = (cid) => { const i = String(cid).indexOf(SEP); return i < 0 ? [String(cid), 'principal'] : [cid.slice(0, i), cid.slice(i + SEP.length)]; };
export const idDaEquipe = (pid, eq) => (eq === 'principal' ? pid : `${pid}${SEP}${eq}`);
const equipesDe = (p) => {
  if (!Array.isArray(p.equipes) || !p.equipes.length) p.equipes = [{ id: 'principal', template: p.template || TEMPLATE_PADRAO }];
  return p.equipes;
};
const nomeEquipe = (e) => e.nome || criarElenco(e.template).template.nome;
const pastaDaEquipe = (p, e) => (e.id === 'principal' ? caminhoDe(p.pasta) : path.join(caminhoDe(p.pasta), 'equipes', e.id));

export const obter = (id) => reg.lista.find((p) => p.id === separar(id)[0]) || null;
export const ativo = () => reg.ativo;
export const listar = () => reg.lista.map((p) => ({
  ...p, template: p.template || TEMPLATE_PADRAO, templateNome: criarElenco(p.template).template.nome,
  extras: p.extras || [], pastaProjeto: p.pasta ? caminhoDe(p.pasta) : null, existe: fs.existsSync(p.raiz),
  equipes: equipesDe(p).map((e) => ({ id: e.id, cid: idDaEquipe(p.id, e.id), template: e.template, nome: nomeEquipe(e), pasta: p.pasta ? pastaDaEquipe(p, e) : null })),
}));
export const raizDosProjetos = () => RAIZ_PROJETOS;

/** Checks whether the path works as a target folder. Returns { ok, raiz, nome, erro }. */
export function validarPasta(caminho) {
  const c = String(caminho || '').trim().replace(/^"|"$/g, '');
  if (!c) return { ok: false, erro: 'Informe o caminho da pasta.' };
  const raiz = path.resolve(c);
  let st;
  try { st = fs.statSync(raiz); } catch { return { ok: false, erro: 'Essa pasta não existe.' }; }
  if (!st.isDirectory()) return { ok: false, erro: 'Isso é um arquivo, não uma pasta.' };
  if (path.parse(raiz).root === raiz) return { ok: false, erro: 'Escolha uma pasta de projeto, não a raiz do disco.' };
  if (igual(raiz, os.homedir())) return { ok: false, erro: 'Escolha uma pasta de projeto, não a sua pasta pessoal inteira.' };
  if (raiz.toLowerCase().startsWith(RAIZ_PROJETOS.toLowerCase() + path.sep)) return { ok: false, erro: 'Essa pasta é de registros do próprio app. Escolha a pasta do trabalho.' };
  return { ok: true, raiz, nome: path.basename(raiz) };
}

export function ctx(idBruto) {
  const [pid, eqId] = separar(idBruto);
  const id = idDaEquipe(pid, eqId);   // "<projeto>__principal" and "<projeto>" are the same context
  if (!contextos.has(id)) {
    const p = obter(pid);
    if (!p || !p.pasta || !fs.existsSync(p.raiz)) return null;
    const eq = equipesDe(p).find((e) => e.id === eqId);
    if (!eq) return null;
    const emit = (e) => emitirGlobal({ projeto: id, projetoNome: p.nome, equipeNome: nomeEquipe(eq), ...e });
    const pasta = pastaDaEquipe(p, eq);
    fs.mkdirSync(pasta, { recursive: true });
    aplicarRestauracaoPendente(pasta);   // before any file is read: if the user asked to go back to a point, this is when
    // the "project" the team sees: same target folder and extras, with the team's id and template
    const pe = Object.assign(Object.create(p), { id, projetoId: pid, equipeId: eq.id, equipeNome: nomeEquipe(eq), template: eq.template });
    const elenco = criarElenco(eq.template, pasta);
    elenco.sincronizarSkills(pasta);
    // the Game Director's profile is one per project (in the main team's folder); when it changes in one team, the others reload
    const eqPrincipal = equipesDe(p).find((e) => idDaEquipe(pid, e.id) === pid) || eq;
    const aoMudarVoce = () => { for (const [cid, c] of contextos) if (cid !== id && separar(cid)[0] === pid) c.perfis.recarregarVoce(); };
    const perfis = criarPerfis({ pasta, projetoId: id, elenco, emitir: emit, principal: eqPrincipal.id === eq.id ? { pasta, projetoId: pid, aoMudar: aoMudarVoce } : { pasta: pastaDaEquipe(p, eqPrincipal), projetoId: pid, aoMudar: aoMudarVoce },
      // assessor, memorizer, MCP and Credits: a single profile across all teams and projects
      gerais: { pasta: path.join(DIR, 'gerais'), aoMudar: () => { for (const [cid, c] of contextos) if (cid !== id) c.perfis.recarregarGerais(); } } });
    const memoria = criarMemoria({ pasta, emitir: emit, elenco });
    memoria.iniciar(p.nome);
    const quadro = criarQuadro({ dir: pasta, raiz: p.raiz, pasta, limiteDe: (col) => lerConfig().wip[col] ?? null, emitir: emit, elenco });
    const notificacoes = criarNotificacoes({ dir: pasta, emitir: emit });
    const integracoes = criarIntegracoes({ pasta, emitir: emit, notificacoes });
    // the calendar is one per project (main team's folder): every team books and reads the same one; the reminder fires through the main team
    const agenda = agendaDe(pastaDaEquipe(p, eqPrincipal), { emitir: (e) => emitirGlobal({ projeto: pid, projetoNome: p.nome, ...e }), notificar: (n) => contextos.get(pid)?.notificacoes.add(n) });
    const equipe = criarEquipe({ projeto: pe, pasta, dir: pasta, quadro, memoria, notificacoes, integracoes, emitir: emit, elenco, outrasEquipes: () => outrasEquipes(id), agenda,
      colegasExternos: () => colegasExternos(id), equipeDe: (cid) => (cid === id ? null : ctx(cid)?.equipe || null),   // conversation between teams (bridges)
      ledger: ledgerDe(caminhoDe(p.pasta), { empresa: p.empresa || null }),   // one evidence ledger per project, shared by the teams
      quadrosDoProjeto: () => equipesDe(p).map((x) => ({ nome: nomeEquipe(x), quadro: ctx(idDaEquipe(pid, x.id))?.quadro })).filter((x) => x.quadro) });
    const pontos = criarPontos({ pasta, emitir: emit });
    // cleanup: temp files go away on their own; deliveries and reports stay for a while to download and then go (policy in faxina.mjs)
    const faxina = criarFaxina({ pasta, quadro, compartilhadaSkills: elenco.pastaSkillsReal, avisar: (texto) => notificacoes.add({ tipo: 'aviso', nivel: 'info', titulo: 'Entrega sai da pasta em breve', texto, canal: 'equipe' }) });
    contextos.set(id, { projeto: pe, pasta, quadro, memoria, equipe, elenco, perfis, notificacoes, integracoes, pontos, agenda, faxina });
    if (equipesDe(p).length > 1) { try { equipe.salaLideres(); } catch { /* no room for now */ } }   // with more than one team, the leaders' room exists in each of them
  }
  return contextos.get(id);
}

/** View of the OTHER teams in the same project, so leaders (and the assessor) can follow along without touching: read-only. */
export function outrasEquipes(cid) {
  const [pid] = separar(cid); const p = obter(pid);
  if (!p) return [];
  return equipesDe(p).map((e) => ({ e, id: idDaEquipe(pid, e.id) })).filter(({ id }) => id !== idDaEquipe(...separar(cid))).map(({ e, id }) => {
    const c = ctx(id);
    const cards = c ? c.quadro.listar() : [];
    const por = (col) => cards.filter((x) => x.coluna === col).length;
    return { id, nome: nomeEquipe(e), template: e.template, lider: c?.elenco.papeis.lead || null, pasta: pastaDaEquipe(p, e),
      andamento: { pronto: por('pronto'), andamento: por('andamento'), revisao: por('revisao'), qa: por('qa'), impedimento: por('impedimento'), concluido: por('concluido') },
      recentes: cards.filter((x) => x.coluna !== 'backlog').sort((a, b) => String(b.atualizado).localeCompare(String(a.atualizado))).slice(0, 6).map((x) => ({ id: x.id, titulo: x.titulo, coluna: x.coluna, dono: x.dono })) };
  });
}

/** Who the people in the project's OTHER teams are (to mention, talk and meet across teams). Without Cris and Max, who belong to the project. */
export function colegasExternos(cid) {
  const [pid] = separar(cid); const p = obter(pid);
  if (!p) return [];
  const meu = idDaEquipe(...separar(cid)); const out = [];
  for (const e of equipesDe(p)) {
    const id = idDaEquipe(pid, e.id); if (id === meu) continue;
    const c = ctx(id); if (!c) continue;
    for (const a of c.elenco.ROSTER) {
      // general memorizer, MCP and Credits are already in every team (same profile); the assessor only exists in Assessoria and is called from outside
      if (a.sistema || (a.geral && a.geral !== 'assessor')) continue;
      // the same profile as in their own team (photo, cover, style): it is the same person, not a copy
      out.push({ cid: id, equipe: nomeEquipe(e), agente: a.id, nome: a.nome, cargo: a.cargo, cor: a.cor, token: c.elenco.TOKEN?.[a.id] || a.tokenNome || a.nome, lider: c.elenco.papeis.lead === a.id, geral: a.geral || null, foto: a.foto || null, capa: a.capa || null, estilo: a.estilo || {}, papel: a.papel || '' });
    }
  }
  return out;
}

/** Adds a team (a template) to the project. There may be two of the same template with different names. */
export function adicionarEquipe(pid, { template, nome } = {}) {
  const p = obter(pid);
  if (!p) return { ok: false, erro: 'Projeto não encontrado.' };
  if (!listarTemplates().some((t) => t.id === template)) return { ok: false, erro: 'Tipo de equipe desconhecido.' };
  const eqs = equipesDe(p);
  const base = slug(nome || template).replace(/-/g, '_').slice(0, 24) || 'equipe';
  let id = base; for (let i = 2; eqs.some((e) => e.id === id) || id === 'principal'; i++) id = `${base}_${i}`;
  const e = { id, template, ...(nome ? { nome: String(nome).trim().slice(0, 40) } : {}), criada: new Date().toISOString() };
  eqs.push(e); salvarReg(); gravarInfo(p.pasta, p);
  ctx(idDaEquipe(pid, id));
  return { ok: true, equipe: { id, cid: idDaEquipe(pid, id), template, nome: nomeEquipe(e) } };
}
/** Removes the team from the project. Its files (board, conversations, memory) stay in the folder; adding again with the same name brings everything back. */
export function removerEquipe(pid, eqId) {
  const p = obter(pid);
  if (!p) return { ok: false, erro: 'Projeto não encontrado.' };
  if (eqId === 'principal') return { ok: false, erro: 'A equipe principal não sai do projeto; dá para renomear.' };
  const id = idDaEquipe(pid, eqId);
  contextos.get(id)?.equipe.cancelar(); contextos.delete(id);
  p.equipes = equipesDe(p).filter((e) => e.id !== eqId); salvarReg(); gravarInfo(p.pasta, p);
  return { ok: true };
}
export function renomearEquipe(pid, eqId, nome) {
  const p = obter(pid); const e = p && equipesDe(p).find((x) => x.id === eqId);
  const n = String(nome || '').trim().slice(0, 40);
  if (!e || !n) return { ok: false, erro: 'Equipe ou nome inválido.' };
  e.nome = n; salvarReg(); gravarInfo(p.pasta, p);
  const c = contextos.get(idDaEquipe(pid, eqId)); if (c) c.projeto.equipeNome = n;
  return { ok: true };
}

export function criar({ nome, caminho, template }) {
  if (template && !listarTemplates().some((t) => t.id === template)) return { ok: false, erro: 'Template desconhecido.' };
  const v = validarPasta(caminho);
  if (!v.ok) return v;
  if (reg.lista.some((p) => igual(p.raiz, v.raiz))) return { ok: false, erro: 'Essa pasta já é um projeto.' };
  const nomeFinal = String(nome || v.nome).trim().slice(0, 60);
  const usadas = new Set(reg.lista.map((p) => (p.pasta || '').toLowerCase()));
  const r = reservarPasta(nomeFinal, v.raiz, usadas);
  const p = {
    id: `${slug(nomeFinal)}-${Math.random().toString(36).slice(2, 6)}`,
    nome: nomeFinal, raiz: v.raiz, pasta: r.pasta, template: template || TEMPLATE_PADRAO, extras: [], criado: new Date().toISOString(),
  };
  reg.lista.push(p);
  if (!reg.ativo) reg.ativo = p.id;
  salvarReg();
  gravarInfo(p.pasta, p);
  ctx(p.id);
  return { ok: true, projeto: p, pastaProjeto: caminhoDe(p.pasta), reaproveitada: r.reaproveitada };
}

export function renomear(id, nome) {
  const p = obter(id);
  const n = String(nome || '').trim().slice(0, 60);
  if (!p || !n) return false;
  p.nome = n; // the records folder keeps the name it was born with, so nothing loses its path
  salvarReg();
  gravarInfo(p.pasta, p);
  return true;
}

/** Extra folders the team may look at beyond the target folder. Only existing ones are included. */
export function definirExtras(id, lista) {
  const p = obter(id);
  if (!p) return { ok: false, erro: 'Projeto não encontrado.' };
  const limpas = [];
  for (const c of Array.isArray(lista) ? lista : []) {
    const t = String(c || '').trim().replace(/^"|"$/g, '');
    if (!t) continue;
    try { if (fs.statSync(t).isDirectory()) limpas.push(path.resolve(t)); } catch { return { ok: false, erro: `Não encontrei a pasta: ${t}` }; }
  }
  p.extras = [...new Set(limpas)].slice(0, 12);
  salvarReg();
  gravarInfo(p.pasta, p);
  return { ok: true, extras: p.extras };
}

export function definirAtivo(id) {
  if (!obter(id)) return false;
  reg.ativo = id;
  salvarReg();
  return true;
}

/**
 * Removes the project from the app. The project folder (memory, board, conversations) and the target folder stay intact:
 * adding the same target folder again reuses the history.
 */
export function remover(id) {
  for (const [k, c] of contextos) if (separar(k)[0] === id) { c.equipe.cancelar(); contextos.delete(k); }
  reg.lista = reg.lista.filter((p) => p.id !== id);
  if (reg.ativo === id) reg.ativo = reg.lista[0]?.id || null;
  salvarReg();
}

export function iniciarTodos() {
  for (const p of reg.lista) for (const e of equipesDe(p)) ctx(idDaEquipe(p.id, e.id));
}

/** All teams of all projects (each one is a context: autopilot, watcher and saving run in each). */
/** Calendar reminders of all open projects (the server calls this every minute). */
export function tiquetaqueAgendas() { let n = 0; for (const a of new Set(todosContextos().map((c) => c.agenda).filter(Boolean))) n += a.tiquetaque(); return n; }
export const todosContextos = () => reg.lista.flatMap((p) => equipesDe(p).map((e) => ctx(idDaEquipe(p.id, e.id)))).filter(Boolean);

/** Open questions of all projects (the "Precisa de você" box). */
export function perguntasAbertas() {
  const out = [];
  for (const p of reg.lista) for (const e of equipesDe(p)) {
    const id = idDaEquipe(p.id, e.id); const c = contextos.get(id);
    if (c) for (const q of c.equipe.perguntasAbertas()) out.push({ ...q, projeto: id, projetoNome: p.nome, equipeNome: nomeEquipe(e) });
  }
  return out.sort((a, b) => b.em.localeCompare(a.em));
}

/**
 * First launch: if there is no project yet, creates the default one. If there was data from the old app version
 * (board and conversations loose in the data folder), it now belongs to this project.
 */
export function garantirPadrao({ nome, caminho, legados = [] }) {
  if (reg.lista.length || !caminho) return null;
  const r = criar({ nome, caminho });
  if (!r.ok) return null;
  const pasta = caminhoDe(r.projeto.pasta);
  for (const base of [DIR, ...legados]) {
    for (const arq of ['board.json', 'chats.json']) {
      const de = path.join(base, arq);
      if (fs.existsSync(de)) { try { fs.mkdirSync(pasta, { recursive: true }); fs.copyFileSync(de, path.join(pasta, arq)); } catch { /* carry on without importing */ } }
    }
    if (!fs.existsSync(path.join(DIR, 'settings.json')) && fs.existsSync(path.join(base, 'settings.json'))) {
      try { fs.copyFileSync(path.join(base, 'settings.json'), path.join(DIR, 'settings.json')); } catch { /* ignore */ }
    }
    if (fs.existsSync(path.join(pasta, 'board.json'))) break;
  }
  // the copied data only counts if the context is created after it
  contextos.delete(r.projeto.id);
  ctx(r.projeto.id);
  return r.projeto;
}
