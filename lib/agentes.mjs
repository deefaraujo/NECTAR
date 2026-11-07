// A equipe de um projeto: quem existe, como cada um é chamado no chat e a persona de cada agente.
//
// O elenco vem de um TEMPLATE (templates/<id>/template.json + templates/<id>/agentes/<id>.md). O app não
// sabe nada de jogos nem de software: o que muda de um tipo de projeto para outro é só o template, com
// agentes especializados e as regras de cada um. Para criar um tipo novo, crie uma pasta em templates/.
//
// Cada agente tem um CARGO (a especialização, vem do template: "Roteirista", "Back-end") e um NOME de
// pessoa, que você pode trocar por projeto, com foto (sem nome escolhido, vale o cargo). O @ no chat segue o nome, como
// no Teams e no Discord; o cargo e o id continuam funcionando como apelido (@roteirista, @po).
//
// Contrato de todo template: quatro papéis fixos, que o ciclo do app usa (o lead que prioriza e revisa,
// o QA, o curador da memória e o agente de créditos, que não chama modelo). Os ids deles ficam em
// `papeis`; hoje valem po, qa, curador e creditos. Os demais agentes são livres.
//
// A persona vem de templates/<template>/agentes/<id>.md. Se o projeto tiver o seu próprio
// .claude/agents/<id>.md, o corpo dele entra por cima como "instruções deste projeto".
import fs from 'node:fs';
import path from 'node:path';
import { carregarContrato } from './contrato.mjs';

const PASTA = path.resolve(import.meta.dirname, '..', 'templates');
const DIR_DADOS = process.env.STUDIO_DATA ? path.resolve(process.env.STUDIO_DATA) : path.resolve(import.meta.dirname, '..', 'data');   // mesmo critério do store
const sincronizadas = new Set();   // templates cujas skills já foram copiadas para a pasta compartilhada neste processo

// persona() é chamada a cada montagem de prompt e lia 4 arquivos de texto por chamada. Só relê quando o arquivo muda (data e tamanho);
// continua lançando erro quando o arquivo não existe, como o readFileSync que substitui.
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

// Como um agente chama a pessoa que manda.
const ALIAS_USUARIO_BASE = ['gamedirector', 'gd', 'diretor', 'diretora', 'director', 'voce', 'vc'];

export function listarTemplates() {
  let nomes = [];
  try { nomes = fs.readdirSync(PASTA).filter((n) => fs.existsSync(path.join(PASTA, n, 'template.json'))); } catch { /* sem templates */ }
  return nomes.map((n) => {
    try {
      const t = JSON.parse(fs.readFileSync(path.join(PASTA, n, 'template.json'), 'utf8'));
      return { id: t.id || n, nome: t.nome || n, descricao: t.descricao || '', rascunho: !!t.rascunho, agentes: (t.agentes || []).length };
    } catch { return null; }
  }).filter(Boolean);
}

export const TEMPLATE_PADRAO = 'jogos';

// Agentes GERAIS: existem independente do projeto e da equipe, são chamados por todas as equipes e enxergam todas.
// São a mesma pessoa em todo lugar (um perfil só: nome, foto, estilo, personalidade). Cada template diz quem faz o papel:
// o assessor é a liderança da Assessoria (token "assessor"); o memorizador é o curador da memória; Créditos e MCP pelo id.
export const GERAIS = [
  { id: 'assessor', cargo: 'Assessor', papel: 'Chief of Staff: fala em seu nome com todas as equipes' },
  { id: 'memorizador', cargo: 'Memorizador', papel: 'Conhecimento: organiza a memória e o que cada equipe aprendeu' },
  { id: 'mcp', cargo: 'MCP', papel: 'Usa os MCPs conectados a pedido de qualquer equipe' },
  { id: 'creditos', cargo: 'Créditos', papel: 'Acompanha o gasto de modelo de todas as equipes' },
];
/** Qual papel geral o agente faz neste template (ou null). */
export function geralDe(t, a) {
  if (a.token === 'assessor') return 'assessor';
  if (t.papeis?.curador === a.id) return 'memorizador';
  if (a.id === 'mcp' || t.papeis?.creditos === a.id) return a.id === 'mcp' ? 'mcp' : 'creditos';
  return null;
}

/**
 * Um elenco por projeto (não é compartilhado): as personalizações de um projeto não vazam para outro.
 * Os objetos POR_ID, TOKEN e o array ROSTER são atualizados no lugar quando os perfis mudam, então quem
 * guardou uma referência a eles continua vendo o elenco atual.
 */
// Referências de um projeto ficam no projeto: <pasta do projeto>/template/regras.md e template/agentes|personalidades/<id>.md
// valem por cima do template (o template é a base; o que é do projeto não vaza para outros projetos).
export function criarElenco(templateId, pastaProjeto = null) {
  const id = templateId && fs.existsSync(path.join(PASTA, templateId, 'template.json')) ? templateId : TEMPLATE_PADRAO;
  const t = JSON.parse(fs.readFileSync(path.join(PASTA, id, 'template.json'), 'utf8'));

  // `padrao` guarda o que veio do template; ROSTER é o que o projeto enxerga (com nome e foto personalizados).
  // Sem nome escolhido, o agente se chama pelo cargo ("Product Owner"); o nome de pessoa só existe se ela der um.
  const padrao = t.agentes.map((a) => ({ ...a, cargo: a.cargo || a.nome, nomePadrao: a.cargo || a.nome, nomeTemplate: a.cargo ? a.nome : null, geral: geralDe(t, a) }));
  const ROSTER = padrao.map((a) => ({ ...a }));
  const POR_ID = {};
  const IDS = new Set(padrao.map((a) => a.id));
  const SOMENTE_LEITURA = new Set(padrao.filter((a) => a.somenteLeitura).map((a) => a.id));
  const ROTAS = t.rotas || {};
  const TOKEN = {};
  const ALIAS = {};
  // A pessoa que lidera também tem nome e foto (por projeto): os agentes a chamam pelo nome que ela escolher.
  const usuario = { id: 'voce', nome: 'Você', nomePadrao: 'Você', foto: null, cargo: '', papel: 'Quem lidera o trabalho' };
  let ALIAS_USUARIO = new Set(ALIAS_USUARIO_BASE);
  let juntas = [];

  const primeiroNome = (nome) => String(nome).trim().split(/\s+/)[0] || nome;
  const tokenDoNome = (nome) => soLetras(primeiroNome(nome));

  /** Todos os apelidos de um agente que não são o nome pessoal: id, cargo e o token do template. */
  const apelidosFixos = (a) => [
    normalizar(a.id), soLetras(a.cargo), normalizar(a.token || ''),
  ].filter(Boolean);

  function reconstruir() {
    for (const k of Object.keys(POR_ID)) delete POR_ID[k];
    for (const k of Object.keys(TOKEN)) delete TOKEN[k];
    for (const k of Object.keys(ALIAS)) delete ALIAS[k];
    // O token do @ é o primeiro nome; quando dois agentes começam igual ("UX Architect" e "UX Writer"), cada um usa o nome inteiro junto.
    const primeiros = new Map(); for (const a of ROSTER) { const k = tokenDoNome(a.nome); primeiros.set(k, (primeiros.get(k) || 0) + 1); }
    for (const a of ROSTER) { POR_ID[a.id] = a; TOKEN[a.id] = primeiros.get(tokenDoNome(a.nome)) > 1 ? soLetras(a.nome) : tokenDoNome(a.nome); a.tokenNome = TOKEN[a.id]; }
    // Nomes que o agente JÁ teve (o de fábrica do template e os que você trocou): a memória e o histórico ainda os citam.
    // Valem como apelido só quando não são de mais ninguém, e entram primeiro para qualquer nome atual passar por cima.
    for (const a of ROSTER) for (const n of [a.nomeTemplate, ...(a.nomesAntigos || [])].filter(Boolean)) for (const k of [tokenDoNome(n), soLetras(n)]) if (k && !ALIAS_USUARIO_BASE.includes(k)) ALIAS[k] = a.id;
    // apelidos fixos depois, e por fim o nome pessoal (a validação impede o nome de colidir com outro agente)
    for (const a of ROSTER) for (const ap of apelidosFixos(a)) ALIAS[ap] = a.id;
    for (const [k, v] of Object.entries(t.aliases || {})) if (IDS.has(v)) ALIAS[normalizar(k)] = v;
    for (const a of ROSTER) { if (primeiros.get(tokenDoNome(a.nome)) === 1) ALIAS[tokenDoNome(a.nome)] = a.id; ALIAS[soLetras(a.nome)] = a.id; }
    // Nomes com espaço, ponto ou barra ("Game Feel", "P.O.", "UI/UX", "Helena Souza") viram uma palavra só antes de procurar menções.
    juntas = [];
    for (const a of ROSTER) {
      for (const txt of new Set([a.nome, a.cargo, a.nomeTemplate, ...(a.nomesAntigos || [])].filter(Boolean))) {
        if (!/[\s./-]/.test(txt)) continue;   // "Front-end" e "Back-end" também: o @ captura só até o hífen
        juntas.push([new RegExp(`@\\s*${txt.split(/\s*[\s./-]\s*/).filter(Boolean).map(escRe).join('\\s*[\\s./-]*\\s*')}\\.?`, 'gi'), `@${TOKEN[a.id]}`]);
      }
    }
    ALIAS_USUARIO = new Set([...ALIAS_USUARIO_BASE, tokenDoNome(usuario.nome), soLetras(usuario.nome)]);
    juntas.sort((x, y) => y[0].source.length - x[0].source.length); // o nome maior vence ("Helena Souza" antes de "Helena")
  }
  /** Os textos fixos (prompts, templates, memória antiga) ainda dizem "Game Director": todo mundo chama a pessoa pelo nome. */
  const comNome = (txt) => {
    if (txt == null) return txt;
    const proprio = usuario.nome && usuario.nome !== usuario.nomePadrao;   // sem nome escolhido, "a pessoa que lidera"
    return String(txt).replace(/@\s*Game\s*Director\b/gi, proprio ? `@${tokenDoNome(usuario.nome)}` : '@voce').replace(/\bGame Director\b/g, proprio ? usuario.nome : 'pessoa que lidera');
  };
  const junta = (txt) => {
    let r = txt.replace(/@\s*Game\s*Director/gi, '@gamedirector');
    for (const [re, tok] of juntas) r = r.replace(re, tok);
    return r;
  };

  /** Reescreve cada @ que aponta para alguém (por nome antigo, cargo ou id) com o @ do nome ATUAL; o resto fica como está. */
  function mencoesAtuais(texto) {
    if (!texto) return texto;
    return junta(String(texto)).replace(/@([\p{L}_0-9]+)/gu, (m, nome) => {
      const k = normalizar(nome);
      if (ALIAS_USUARIO.has(k)) return usuario.nome !== usuario.nomePadrao ? `@${usuario.nome}` : m;
      return ALIAS[k] && k !== 'todos' ? `@${POR_ID[ALIAS[k]].nome}` : m;   // o nome como você escreveu ("@PRODUCT OWNER"); o @ entende nome composto
    });
  }

  /** Quem foi marcado com @ num texto: { agentes: [ids], usuario: boolean }. */
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

  /** Confere se o nome serve: curto, sem símbolo estranho e que não seja o apelido de outro colega. */
  function validarNome(agenteId, nome) {
    const n = String(nome || '').trim().replace(/\s+/g, ' ');
    if (!n) return { ok: false, erro: 'O nome não pode ficar vazio.' };
    if (n.length > 30) return { ok: false, erro: 'Use no máximo 30 caracteres.' };
    if (!/^[\p{L}0-9][\p{L}0-9 .'-]*$/u.test(n)) return { ok: false, erro: 'Use só letras, números, espaço, ponto, hífen ou apóstrofo.' };
    const tk = tokenDoNome(n);
    if (!tk) return { ok: false, erro: 'O nome precisa ter alguma letra.' };
    // o nome de um agente não pode ser o seu apelido; e o seu não pode ser o de um agente
    if (agenteId !== 'voce' && ALIAS_USUARIO.has(tk)) return { ok: false, erro: `Esse nome é o seu (${usuario.nome}).` };
    for (const a of ROSTER) {
      if (a.id === agenteId) continue;
      const usados = new Set([...apelidosFixos(a), tokenDoNome(a.nome), soLetras(a.nome)]);
      if (usados.has(tk) || usados.has(soLetras(n))) return { ok: false, erro: `"${n}" já chama ${a.nome} (${a.cargo}) no @. Escolha outro.` };
    }
    for (const [k, v] of Object.entries(t.aliases || {})) if (v !== agenteId && normalizar(k) === tk) return { ok: false, erro: `"${n}" é apelido de outro cargo. Escolha outro.` };
    return { ok: true, nome: n };
  }

  /** perfis: { agenteId: { nome, fotoV } }; fotoUrl(id, v) devolve o endereço da foto. */
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

  /** { base, equipe, projeto }: a persona do agente, as regras que o template dá a TODOS os agentes
   *  (templates/<id>/regras.md) e, se existir, o corpo do agente definido no projeto. */
  function persona(agenteId, raiz) {
    let base = '';
    let equipe = '';
    let projeto = '';
    const doProj = (rel) => { if (!pastaProjeto) return null; try { return semCabecalho(lerTexto(path.join(pastaProjeto, 'template', rel))); } catch { return null; } };
    equipe = doProj('regras.md') ?? (() => { try { return semCabecalho(lerTexto(path.join(PASTA, id, 'regras.md'))); } catch { return ''; } })();
    base = doProj(path.join('agentes', `${agenteId}.md`)) ?? (() => { try { return semCabecalho(lerTexto(path.join(PASTA, id, 'agentes', `${agenteId}.md`))); } catch { return ''; } })();
    // Personalidade: o jeito de falar no chat. Vai separada para entrar no FIM das instruções fixas (o que vem por último pesa
    // mais); no começo, as regras de concisão e o protocolo que vinham depois apagavam o tom.
    const propria = POR_ID[agenteId]?.conversa?.personalidade || '';
    const personalidade = propria || personalidadePadrao(agenteId);
    try { projeto = semCabecalho(lerTexto(path.join(raiz, '.claude', 'agents', `${agenteId}.md`))); } catch { /* o projeto não define */ }
    return { base, equipe, projeto, personalidade, personalidadePropria: !!propria };
  }

  /** Personalidade que o template dá ao agente (ponto de partida no perfil). */
  const personalidadePadrao = (agenteId) => { for (const base of [pastaProjeto && path.join(pastaProjeto, 'template'), path.join(PASTA, id)].filter(Boolean)) { try { return semCabecalho(fs.readFileSync(path.join(base, 'personalidades', `${agenteId}.md`), 'utf8')); } catch { /* tenta o próximo */ } } return ''; };

  // ---- skills do template: cada cargo recebe as suas (templates/<id>/skills/<skill>/SKILL.md) -----------------
  const pastaSkills = path.join(PASTA, id, 'skills');
  const descricaoDe = (skill) => {
    try {
      const txt = fs.readFileSync(path.join(pastaSkills, skill, 'SKILL.md'), 'utf8');
      const m = /^description:\s*(.*)$/m.exec(txt.split('---')[1] || '');
      return (m ? m[1] : '').trim().replace(/^["']|["']$/g, '').slice(0, 130);
    } catch { return ''; }
  };
  /** [{ id, descricao }] das skills de um agente. */
  const skillsDe = (agenteId) => (POR_ID[agenteId]?.skills || []).filter((s) => fs.existsSync(path.join(pastaSkills, s, 'SKILL.md'))).map((s) => ({ id: s, descricao: descricaoDe(s) }));

  // Copia as skills para a pasta do projeto, que é um lugar real do disco: o app empacotado guarda os arquivos
  // dentro de um .asar, que o Claude e o Codex não conseguem ler. Só copia o que mudou.
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
      } catch { /* arquivo ilegível: segue */ }
    }
  }
  // Uma cópia por template, na pasta de dados do app (não uma por projeto e por equipe: eram 2,7 MB repetidos em cada pasta).
  const pastaSkillsReal = path.join(DIR_DADOS, 'skills', id);
  const sincronizarSkills = () => { if (!fs.existsSync(pastaSkills)) return null; if (!sincronizadas.has(id)) { copiar(pastaSkills, pastaSkillsReal); sincronizadas.add(id); } return pastaSkillsReal; };

  reconstruir();
  return {
    id, template: { id, nome: t.nome, descricao: t.descricao, rascunho: !!t.rascunho }, papeis: t.papeis || {},
    contrato: carregarContrato(id, t, path.join(PASTA, id), pastaProjeto),
    ROSTER, usuario, POR_ID, comNome, mencoesAtuais, IDS, SOMENTE_LEITURA, ROTAS, TOKEN, ALIAS, normalizar, mencoes, persona, personalidadePadrao, validarNome, aplicarPerfis, tokenDoNome, skillsDe, sincronizarSkills, pastaSkillsReal,
  };
}
