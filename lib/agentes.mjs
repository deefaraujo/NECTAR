// A project's team: who exists, how each one is addressed in chat, and each agent's persona.
//
// The cast comes from a TEMPLATE (templates/<id>/template.json + templates/<id>/agentes/<id>.md). The app knows
// nothing about games or software: what changes from one project type to another is only the template, with
// specialized agents and each one's rules. To create a new type, create a folder in templates/.
//
// Each agent has a ROLE (the specialization, from the template: "Roteirista", "Back-end") and a person's NAME,
// which can be changed per project, with a photo (with no chosen name, the role is used). The chat @ follows the name, as
// in Teams and Discord; the role and the id keep working as aliases (@roteirista, @po).
//
// Contract for every template: four fixed roles used by the app's cycle (the lead who prioritizes and reviews,
// QA, the memory curator, and the credits agent, which does not call a model). Their ids live in
// `papeis`; today they are po, qa, curador and creditos. The other agents are free-form.
//
// The persona comes from templates/<template>/agentes/<id>.md. If the project has its own
// .claude/agents/<id>.md, its body is layered on top as "this project's instructions".
import fs from 'node:fs';
import path from 'node:path';
import { carregarContrato } from './contrato.mjs';

const PASTA = path.resolve(import.meta.dirname, '..', 'templates');
const DIR_DADOS = process.env.STUDIO_DATA ? path.resolve(process.env.STUDIO_DATA) : path.resolve(import.meta.dirname, '..', 'data');   // same rule as the store
const sincronizadas = new Set();   // templates whose skills have already been copied to the shared folder in this process

// persona() is called on every prompt build and used to read 4 text files per call. It only rereads when the file changes (mtime and size);
// it still throws when the file does not exist, like the readFileSync it replaces.
const cacheTexto = new Map();
function lerTexto(abs) {
  const st = fs.statSync(abs);
  const c = cacheTexto.get(abs);
  if (c && c.m === st.mtimeMs && c.s === st.size) return c.t;
  const t = fs.readFileSync(abs, 'utf8');
  cacheTexto.set(abs, { m: st.mtimeMs, s: st.size, t });
  return t;
}
export const normalizar = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const semCabecalho = (md) => md.replace(/^---[\s\S]*?---\s*/, '').trim();
const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
const soLetras = (s) => normalizar(s).replace(/[^a-z0-9]/g, '');

// How an agent addresses the person in charge.
const ALIAS_USUARIO_BASE = ['gamedirector', 'gd', 'diretor', 'diretora', 'director', 'voce', 'vc'];

export function listarTemplates() {
  let nomes = [];
  try { nomes = fs.readdirSync(PASTA).filter((n) => fs.existsSync(path.join(PASTA, n, 'template.json'))); } catch { /* no templates */ }
  return nomes.map((n) => {
    try {
      const t = JSON.parse(fs.readFileSync(path.join(PASTA, n, 'template.json'), 'utf8'));
      return { id: t.id || n, nome: t.nome || n, descricao: t.descricao || '', rascunho: !!t.rascunho, agentes: (t.agentes || []).length };
    } catch { return null; }
  }).filter(Boolean);
}

export const TEMPLATE_PADRAO = 'jogos';

// GLOBAL agents: they exist independently of the project and team, are called by every team, and see all of them.
// They are the same person everywhere (a single profile: name, photo, style, personality). Each template says who plays the role:
// the advisor is the Advisory lead (token "assessor"); the memorizer is the memory curator; Credits and MCP by id.
export const GERAIS = [
  { id: 'assessor', cargo: 'Assessor', papel: 'Chief of Staff: fala em seu nome com todas as equipes' },
  { id: 'memorizador', cargo: 'Memorizador', papel: 'Conhecimento: organiza a memória e o que cada equipe aprendeu' },
  { id: 'mcp', cargo: 'MCP', papel: 'Usa os MCPs conectados a pedido de qualquer equipe' },
  { id: 'creditos', cargo: 'Créditos', papel: 'Acompanha o gasto de modelo de todas as equipes' },
];
/** Which global role the agent plays in this template (or null). */
export function geralDe(t, a) {
  if (a.token === 'assessor') return 'assessor';
  if (t.papeis?.curador === a.id) return 'memorizador';
  if (a.id === 'mcp' || t.papeis?.creditos === a.id) return a.id === 'mcp' ? 'mcp' : 'creditos';
  return null;
}

/**
 * One cast per project (not shared): one project's customizations do not leak into another.
 * The POR_ID and TOKEN objects and the ROSTER array are updated in place when profiles change, so anyone
 * holding a reference to them keeps seeing the current cast.
 */
// A project's references live in the project: <project folder>/template/regras.md and template/agentes|personalidades/<id>.md
// override the template (the template is the base; what belongs to the project does not leak into other projects).
export function criarElenco(templateId, pastaProjeto = null) {
  const id = templateId && fs.existsSync(path.join(PASTA, templateId, 'template.json')) ? templateId : TEMPLATE_PADRAO;
  const t = JSON.parse(fs.readFileSync(path.join(PASTA, id, 'template.json'), 'utf8'));

  // `padrao` holds what came from the template; ROSTER is what the project sees (with custom name and photo).
  // With no chosen name, the agent goes by its role ("Product Owner"); a person's name only exists if the user gives one.
  const padrao = t.agentes.map((a) => ({ ...a, cargo: a.cargo || a.nome, nomePadrao: a.cargo || a.nome, nomeTemplate: a.cargo ? a.nome : null, geral: geralDe(t, a) }));
  const ROSTER = padrao.map((a) => ({ ...a }));
  const POR_ID = {};
  const IDS = new Set(padrao.map((a) => a.id));
  const SOMENTE_LEITURA = new Set(padrao.filter((a) => a.somenteLeitura).map((a) => a.id));
  const ROTAS = t.rotas || {};
  const TOKEN = {};
  const ALIAS = {};
  // The person who leads also has a name and photo (per project): agents address them by the name they choose.
  const usuario = { id: 'voce', nome: 'Você', nomePadrao: 'Você', foto: null, cargo: '', papel: 'Quem lidera o trabalho' };
  let ALIAS_USUARIO = new Set(ALIAS_USUARIO_BASE);
  let juntas = [];

  const primeiroNome = (nome) => String(nome).trim().split(/\s+/)[0] || nome;
  const tokenDoNome = (nome) => soLetras(primeiroNome(nome));

  /** All of an agent's aliases that are not the personal name: id, role and the template token. */
  const apelidosFixos = (a) => [
    normalizar(a.id), soLetras(a.cargo), normalizar(a.token || ''),
  ].filter(Boolean);

  function reconstruir() {
    for (const k of Object.keys(POR_ID)) delete POR_ID[k];
    for (const k of Object.keys(TOKEN)) delete TOKEN[k];
    for (const k of Object.keys(ALIAS)) delete ALIAS[k];
    // The @ token is the first name; when two agents start the same way ("UX Architect" and "UX Writer"), each uses the full name together.
    const primeiros = new Map(); for (const a of ROSTER) { const k = tokenDoNome(a.nome); primeiros.set(k, (primeiros.get(k) || 0) + 1); }
    for (const a of ROSTER) { POR_ID[a.id] = a; TOKEN[a.id] = primeiros.get(tokenDoNome(a.nome)) > 1 ? soLetras(a.nome) : tokenDoNome(a.nome); a.tokenNome = TOKEN[a.id]; }
    // Names the agent HAS had (the template's factory name and the ones that were changed): memory and history still mention them.
    // They count as aliases only when they belong to nobody else, and go first so any current name overrides them.
    for (const a of ROSTER) for (const n of [a.nomeTemplate, ...(a.nomesAntigos || [])].filter(Boolean)) for (const k of [tokenDoNome(n), soLetras(n)]) if (k && !ALIAS_USUARIO_BASE.includes(k)) ALIAS[k] = a.id;
    // fixed aliases next, and finally the personal name (validation prevents the name from colliding with another agent)
    for (const a of ROSTER) for (const ap of apelidosFixos(a)) ALIAS[ap] = a.id;
    for (const [k, v] of Object.entries(t.aliases || {})) if (IDS.has(v)) ALIAS[normalizar(k)] = v;
    for (const a of ROSTER) { if (primeiros.get(tokenDoNome(a.nome)) === 1) ALIAS[tokenDoNome(a.nome)] = a.id; ALIAS[soLetras(a.nome)] = a.id; }
    // Names with a space, dot or slash ("Game Feel", "P.O.", "UI/UX", "Helena Souza") become a single word before searching for mentions.
    juntas = [];
    for (const a of ROSTER) {
      for (const txt of new Set([a.nome, a.cargo, a.nomeTemplate, ...(a.nomesAntigos || [])].filter(Boolean))) {
        if (!/[\s./-]/.test(txt)) continue;   // "Front-end" and "Back-end" too: the @ only captures up to the hyphen
        juntas.push([new RegExp(`@\\s*${txt.split(/\s*[\s./-]\s*/).filter(Boolean).map(escRe).join('\\s*[\\s./-]*\\s*')}\\.?`, 'gi'), `@${TOKEN[a.id]}`]);
      }
    }
    ALIAS_USUARIO = new Set([...ALIAS_USUARIO_BASE, tokenDoNome(usuario.nome), soLetras(usuario.nome)]);
    juntas.sort((x, y) => y[0].source.length - x[0].source.length); // the longer name wins ("Helena Souza" before "Helena")
  }
  /** Fixed texts (prompts, templates, old memory) still say "Game Director": everyone addresses the person by name. */
  const comNome = (txt) => {
    if (txt == null) return txt;
    const proprio = usuario.nome && usuario.nome !== usuario.nomePadrao;   // with no chosen name, "the person who leads"
    return String(txt).replace(/@\s*Game\s*Director\b/gi, proprio ? `@${tokenDoNome(usuario.nome)}` : '@voce').replace(/\bGame Director\b/g, proprio ? usuario.nome : 'pessoa que lidera');
  };
  const junta = (txt) => {
    let r = txt.replace(/@\s*Game\s*Director/gi, '@gamedirector');
    for (const [re, tok] of juntas) r = r.replace(re, tok);
    return r;
  };

  /** Rewrites each @ that points to someone (by old name, role or id) with the @ of the CURRENT name; the rest stays as is. */
  function mencoesAtuais(texto) {
    if (!texto) return texto;
    return junta(String(texto)).replace(/@([\p{L}_0-9]+)/gu, (m, nome) => {
      const k = normalizar(nome);
      if (ALIAS_USUARIO.has(k)) return usuario.nome !== usuario.nomePadrao ? `@${usuario.nome}` : m;
      return ALIAS[k] && k !== 'todos' ? `@${POR_ID[ALIAS[k]].nome}` : m;   // the name as written ("@PRODUCT OWNER"); the @ understands compound names
    });
  }

  /** Who was tagged with @ in a text: { agentes: [ids], usuario: boolean }. */
  function mencoes(texto) {
    const ids = [];
    let usuario = false;
    for (const [, nome] of junta(String(texto || '')).matchAll(/@([\p{L}_0-9]+)/gu)) {
      const k = normalizar(nome);
      if (ALIAS_USUARIO.has(k)) usuario = true;
      else if (ALIAS[k] && !ids.includes(ALIAS[k])) ids.push(ALIAS[k]);
    }
    return { agentes: ids, usuario };
  }

  /** Checks whether the name is usable: short, no odd symbols, and not another teammate's alias. */
  function validarNome(agenteId, nome) {
    const n = String(nome || '').trim().replace(/\s+/g, ' ');
    if (!n) return { ok: false, erro: 'O nome não pode ficar vazio.' };
    if (n.length > 30) return { ok: false, erro: 'Use no máximo 30 caracteres.' };
    if (!/^[\p{L}0-9][\p{L}0-9 .'-]*$/u.test(n)) return { ok: false, erro: 'Use só letras, números, espaço, ponto, hífen ou apóstrofo.' };
    const tk = tokenDoNome(n);
    if (!tk) return { ok: false, erro: 'O nome precisa ter alguma letra.' };
    // an agent's name cannot be the user's alias; and the user's cannot be an agent's
    if (agenteId !== 'voce' && ALIAS_USUARIO.has(tk)) return { ok: false, erro: `Esse nome é o seu (${usuario.nome}).` };
    for (const a of ROSTER) {
      if (a.id === agenteId) continue;
      const usados = new Set([...apelidosFixos(a), tokenDoNome(a.nome), soLetras(a.nome)]);
      if (usados.has(tk) || usados.has(soLetras(n))) return { ok: false, erro: `"${n}" já chama ${a.nome} (${a.cargo}) no @. Escolha outro.` };
    }
    for (const [k, v] of Object.entries(t.aliases || {})) if (v !== agenteId && normalizar(k) === tk) return { ok: false, erro: `"${n}" é apelido de outro cargo. Escolha outro.` };
    return { ok: true, nome: n };
  }

  /** perfis: { agenteId: { nome, fotoV } }; fotoUrl(id, v) returns the photo's URL. */
  function aplicarPerfis(perfis = {}, fotoUrl = () => null) {
    for (const a of ROSTER) {
      const base = padrao.find((p) => p.id === a.id);
      const p = perfis[a.id] || {};
      a.nome = p.nome || base.nomePadrao;
      a.nomesAntigos = (p.antigos || []).filter((n) => n !== a.nome);
      a.foto = p.fotoV ? fotoUrl(a.id, p.fotoV) : null;
      a.capa = p.capaV ? fotoUrl(a.id, p.capaV, 'capa') : null;
      a.estilo = p.estilo || {};
      a.conversa = p.conversa || {};
    }
    usuario.nome = perfis.voce?.nome || usuario.nomePadrao;
    usuario.foto = perfis.voce?.fotoV ? fotoUrl('voce', perfis.voce.fotoV) : null;
    usuario.capa = perfis.voce?.capaV ? fotoUrl('voce', perfis.voce.capaV, 'capa') : null;
    usuario.estilo = perfis.voce?.estilo || {};
    reconstruir();
  }

  /** { base, equipe, projeto }: the agent's persona, the rules the template gives to ALL agents
   *  (templates/<id>/regras.md) and, if present, the body of the agent defined in the project. */
  function persona(agenteId, raiz) {
    let base = '';
    let equipe = '';
    let projeto = '';
    const doProj = (rel) => { if (!pastaProjeto) return null; try { return semCabecalho(lerTexto(path.join(pastaProjeto, 'template', rel))); } catch { return null; } };
    equipe = doProj('regras.md') ?? (() => { try { return semCabecalho(lerTexto(path.join(PASTA, id, 'regras.md'))); } catch { return ''; } })();
    base = doProj(path.join('agentes', `${agenteId}.md`)) ?? (() => { try { return semCabecalho(lerTexto(path.join(PASTA, id, 'agentes', `${agenteId}.md`))); } catch { return ''; } })();
    // Personality: the way of speaking in chat. It goes separately so it lands at the END of the fixed instructions (what comes last weighs
    // more); at the start, the conciseness rules and the protocol that came after it wiped out the tone.
    const propria = POR_ID[agenteId]?.conversa?.personalidade || '';
    const personalidade = propria || personalidadePadrao(agenteId);
    try { projeto = semCabecalho(lerTexto(path.join(raiz, '.claude', 'agents', `${agenteId}.md`))); } catch { /* the project does not define it */ }
    return { base, equipe, projeto, personalidade, personalidadePropria: !!propria };
  }

  /** Personality the template gives the agent (starting point in the profile). */
  const personalidadePadrao = (agenteId) => { for (const base of [pastaProjeto && path.join(pastaProjeto, 'template'), path.join(PASTA, id)].filter(Boolean)) { try { return semCabecalho(fs.readFileSync(path.join(base, 'personalidades', `${agenteId}.md`), 'utf8')); } catch { /* try the next one */ } } return ''; };

  // ---- template skills: each role gets its own (templates/<id>/skills/<skill>/SKILL.md) -----------------
  const pastaSkills = path.join(PASTA, id, 'skills');
  const descricaoDe = (skill) => {
    try {
      const txt = fs.readFileSync(path.join(pastaSkills, skill, 'SKILL.md'), 'utf8');
      const m = /^description:\s*(.*)$/m.exec(txt.split('---')[1] || '');
      return (m ? m[1] : '').trim().replace(/^["']|["']$/g, '').slice(0, 130);
    } catch { return ''; }
  };
  /** [{ id, descricao }] of an agent's skills. */
  const skillsDe = (agenteId) => (POR_ID[agenteId]?.skills || []).filter((s) => fs.existsSync(path.join(pastaSkills, s, 'SKILL.md'))).map((s) => ({ id: s, descricao: descricaoDe(s) }));

  // Copies the skills to the project folder, which is a real place on disk: the packaged app keeps its files
  // inside an .asar, which Claude and Codex cannot read. Only copies what changed.
  function copiar(origem, destino) {
    let itens = [];
    try { itens = fs.readdirSync(origem, { withFileTypes: true }); } catch { return; }
    fs.mkdirSync(destino, { recursive: true });
    for (const it of itens) {
      const de = path.join(origem, it.name); const para = path.join(destino, it.name);
      if (it.isDirectory()) { copiar(de, para); continue; }
      try {
        const dados = fs.readFileSync(de);
        if (!fs.existsSync(para) || fs.statSync(para).size !== dados.length) fs.writeFileSync(para, dados);
      } catch { /* unreadable file: move on */ }
    }
  }
  // One copy per template, in the app's data folder (not one per project and team: that was 2.7 MB duplicated in every folder).
  const pastaSkillsReal = path.join(DIR_DADOS, 'skills', id);
  const sincronizarSkills = () => { if (!fs.existsSync(pastaSkills)) return null; if (!sincronizadas.has(id)) { copiar(pastaSkills, pastaSkillsReal); sincronizadas.add(id); } return pastaSkillsReal; };

  reconstruir();
  return {
    id, template: { id, nome: t.nome, descricao: t.descricao, rascunho: !!t.rascunho }, papeis: t.papeis || {},
    contrato: carregarContrato(id, t, path.join(PASTA, id), pastaProjeto),
    ROSTER, usuario, POR_ID, comNome, mencoesAtuais, IDS, SOMENTE_LEITURA, ROTAS, TOKEN, ALIAS, normalizar, mencoes, persona, personalidadePadrao, validarNome, aplicarPerfis, tokenDoNome, skillsDe, sincronizarSkills, pastaSkillsReal,
  };
}
