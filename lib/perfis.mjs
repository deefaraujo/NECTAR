// Perfis dos agentes e da Game Director em UM projeto: nome de pessoa, foto, capa e o estilo do perfil
// (tema em duas cores, decoração do avatar, efeito do perfil, placa do nome, fonte e efeito do nome, "Sobre mim").
// O cargo (a especialização) vem do template e não muda aqui. O @ no chat segue o nome (@Helena).
// A foto e a capa são guardadas como vieram (GIF continua animado); o enquadramento (zoom e posição) fica à parte
// e é aplicado na tela. Guardado na pasta do projeto: perfis.json e fotos/<id>.<ext>, fotos/<id>-capa.<ext>.
import fs from 'node:fs';
import path from 'node:path';
import { ler, gravar } from './store.mjs';

const TIPOS = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' };
const MIME = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' };
const LIMITE = { foto: 8 * 1024 * 1024, capa: 10 * 1024 * 1024 };

// Opções de estilo (o visual de cada uma vive no front, em perfil.css e vfx.js)
export const ESTILOS = {
  decoracao: ['nenhuma', 'aurora', 'neon', 'chamas', 'orbita', 'sakura', 'pixel', 'gelo', 'raio', 'coroa'],
  efeito: ['nenhum', 'estrelas', 'neve', 'brasas', 'petalas', 'bolhas', 'confete', 'codigo', 'vagalumes'],
  placa: ['nenhuma', 'aurora', 'galaxia', 'oceano', 'por-do-sol', 'floresta', 'circuito', 'sakura', 'lava'],
  fonte: ['padrao', 'tempo', 'sakura', 'jujuba', 'moderna', 'medieval', '8bit', 'vampiro'],
  efeitoNome: ['solido', 'degrade', 'neon', 'toon', 'pop'],
};
const COR = /^#[0-9a-f]{6}$/i;

// Confere pelos primeiros bytes que é mesmo a imagem que o data URL diz ser.
function formatoReal(buf) {
  if (buf.length > 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'png';
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf.length > 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  if (buf.length > 6 && /^GIF8[79]a$/.test(buf.toString('ascii', 0, 6))) return 'gif';
  return null;
}

// Enquadramento: zoom de 1 a 5 e deslocamento em % do tamanho do quadro, a partir do centro.
function recorteValido(r) {
  const n = (v, min, max, pad) => (Number.isFinite(Number(v)) ? Math.min(max, Math.max(min, Number(v))) : pad);
  return { zoom: n(r?.zoom, 1, 5, 1), x: n(r?.x, -300, 300, 0), y: n(r?.y, -300, 300, 0) };
}

/**
 * `principal` = { pasta, projetoId, aoMudar }: o perfil da Game Director ("voce") é UM por projeto, guardado na pasta da equipe
 * principal; as outras equipes leem e gravam lá (só a lista de agentes, o planner e os canais mudam de equipe para equipe).
 */
/**
 * `gerais` = { pasta, aoMudar }: os agentes GERAIS (assessor, memorizador, MCP, Créditos; ver GERAIS em agentes.mjs) são a mesma
 * pessoa em todas as equipes e projetos. O perfil deles fica num lugar só (<dados>/gerais/perfis.json, chave = papel geral, e
 * fotos/<papel>.<ext>); mudou numa equipe, todas releem.
 */
export function criarPerfis({ pasta, projetoId, elenco, emitir, principal = null, gerais = null }) {
  const arq = path.join(pasta, 'perfis.json');
  const dirFotos = path.join(pasta, 'fotos');
  const arqVoce = principal ? path.join(principal.pasta, 'perfis.json') : arq;
  const dirFotosVoce = principal ? path.join(principal.pasta, 'fotos') : dirFotos;
  const arqGerais = gerais ? path.join(gerais.pasta, 'perfis.json') : null;
  const dirFotosGerais = gerais ? path.join(gerais.pasta, 'fotos') : null;
  const geralDe = (id) => (gerais && id !== 'voce' ? elenco.POR_ID[id]?.geral || null : null);
  const dirDe = (id) => (id === 'voce' ? dirFotosVoce : geralDe(id) ? dirFotosGerais : dirFotos);
  const baseArq = (id) => geralDe(id) || id;   // o arquivo da foto de um agente geral leva o nome do papel, não o id do template
  const st = ler(arq, {});
  const lerVoce = () => (ler(arqVoce, {}).voce || {});
  if (principal) st.voce = lerVoce();
  const idsGerais = () => elenco.ROSTER.filter((a) => geralDe(a.id)).map((a) => a.id);
  // Primeira vez: o perfil que a equipe já tinha para o papel vira o perfil geral (a primeira equipe que tiver um, vence).
  if (gerais) {
    const g = ler(arqGerais, {}); let mudou = false;
    for (const id of idsGerais()) {
      const k = geralDe(id); const local = st[id];
      if (g[k] || !local || !Object.keys(local).length) continue;
      g[k] = local; mudou = true;
      fs.mkdirSync(dirFotosGerais, { recursive: true });
      for (const [suf, ext] of [['', local.ext], ['-capa', local.capaExt]]) if (ext) { try { fs.copyFileSync(path.join(dirFotos, `${id}${suf}.${ext}`), path.join(dirFotosGerais, `${k}${suf}.${ext}`)); } catch { /* sem o arquivo */ } }
    }
    if (mudou) gravar(arqGerais, g);
  }
  const lerGerais = () => { if (!gerais) return; const g = ler(arqGerais, {}); for (const id of idsGerais()) st[id] = g[geralDe(id)] || {}; };
  lerGerais();
  const fotoUrl = (id, v, tipo = 'foto') => `/api/p/${id === 'voce' && principal ? principal.projetoId : projetoId}/${tipo}/${id}?v=${v}`;
  const salvar = (mudouVoce = false, id = null) => {
    const proprios = { ...st };
    if (principal) delete proprios.voce;
    for (const g of idsGerais()) delete proprios[g];
    gravar(arq, proprios);
    if (principal && mudouVoce) { const tudo = ler(arqVoce, {}); tudo.voce = st.voce; gravar(arqVoce, tudo); }
    else if (!principal && mudouVoce) gravar(arq, { ...proprios, voce: st.voce });
    if (mudouVoce) principal?.aoMudar?.();
    if (id && geralDe(id)) { const g = ler(arqGerais, {}); g[geralDe(id)] = st[id]; gravar(arqGerais, g); gerais.aoMudar?.(); }
  };
  /** Outra equipe mudou o perfil de um agente geral: relê do arquivo compartilhado. */
  const recarregarGerais = () => { lerGerais(); aplicar(); };
  /** Outra equipe mudou o perfil da Game Director: relê do arquivo compartilhado e atualiza a tela. */
  const recarregarVoce = () => { st.voce = lerVoce(); aplicar(); };
  const aplicar = (avisar = true) => {
    elenco.aplicarPerfis(st, fotoUrl);
    if (avisar) emitir({ tipo: 'elenco', roster: elenco.ROSTER, usuario: elenco.usuario });
  };
  aplicar(false);

  const existe = (id) => id === 'voce' || elenco.IDS.has(id);

  function definirNome(id, nome) {
    if (!existe(id)) return { ok: false, erro: 'Agente desconhecido.' };
    const v = elenco.validarNome(id, nome);
    if (!v.ok) return v;
    const padrao = id === 'voce' ? elenco.usuario.nomePadrao : elenco.ROSTER.find((a) => a.id === id).nomePadrao;
    st[id] = { ...(st[id] || {}) };
    // o nome que sai continua valendo como apelido (memória e histórico ainda o citam); os 6 últimos
    const saindo = st[id].nome;
    if (id !== 'voce' && saindo && saindo !== v.nome) st[id].antigos = [saindo, ...(st[id].antigos || []).filter((n) => n !== saindo && n !== v.nome)].slice(0, 6);
    if (v.nome === padrao) delete st[id].nome; else st[id].nome = v.nome;
    salvar(id === 'voce', id); aplicar();
    return { ok: true, roster: elenco.ROSTER };
  }

  const sufixo = (tipo) => (tipo === 'capa' ? '-capa' : '');
  const chaves = (tipo) => (tipo === 'capa' ? ['capaV', 'capaExt'] : ['fotoV', 'ext']);
  function removerArquivos(id, tipo) {
    for (const ext of Object.values(TIPOS)) { try { fs.rmSync(path.join(dirDe(id), `${baseArq(id)}${sufixo(tipo)}.${ext}`), { force: true }); } catch { /* já não existe */ } }
  }

  /** Grava a foto ou a capa como veio (o GIF fica animado) e o enquadramento escolhido. */
  function definirImagem(id, tipo, dataUrl, recorte) {
    if (!existe(id)) return { ok: false, erro: 'Agente desconhecido.' };
    const nomeT = tipo === 'capa' ? 'A capa' : 'A foto';
    const m = /^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/=\r\n]+)$/.exec(String(dataUrl || ''));
    if (!m) return { ok: false, erro: 'Envie uma imagem PNG, JPG, WEBP ou GIF.' };
    const buf = Buffer.from(m[2], 'base64');
    if (buf.length > LIMITE[tipo]) return { ok: false, erro: `${nomeT} passou de ${LIMITE[tipo] / 1024 / 1024} MB. Use uma menor.` };
    const real = formatoReal(buf);
    if (!real || real !== TIPOS[m[1]]) return { ok: false, erro: 'O arquivo não é a imagem que diz ser.' };
    fs.mkdirSync(dirDe(id), { recursive: true });
    removerArquivos(id, tipo);
    fs.writeFileSync(path.join(dirDe(id), `${baseArq(id)}${sufixo(tipo)}.${real}`), buf);
    const [kv, ke] = chaves(tipo);
    st[id] = { ...(st[id] || {}), [kv]: Date.now(), [ke]: real };
    st[id].estilo = { ...(st[id].estilo || {}), [tipo === 'capa' ? 'recorteCapa' : 'recorteFoto']: recorteValido(recorte) };
    salvar(id === 'voce', id); aplicar();
    return { ok: true, roster: elenco.ROSTER };
  }
  const definirFoto = (id, dataUrl, recorte) => definirImagem(id, 'foto', dataUrl, recorte);
  const definirCapa = (id, dataUrl, recorte) => definirImagem(id, 'capa', dataUrl, recorte);

  function removerImagem(id, tipo) {
    if (!existe(id)) return { ok: false, erro: 'Agente desconhecido.' };
    removerArquivos(id, tipo);
    if (st[id]) for (const k of chaves(tipo)) delete st[id][k];
    salvar(id === 'voce', id); aplicar();
    return { ok: true, roster: elenco.ROSTER };
  }
  const removerFoto = (id) => removerImagem(id, 'foto');
  const removerCapa = (id) => removerImagem(id, 'capa');

  /** Estilo do perfil. Só entra o que é válido; o resto mantém o que já estava. `null` volta ao padrão. */
  function definirEstilo(id, novo) {
    if (!existe(id)) return { ok: false, erro: 'Agente desconhecido.' };
    if (!novo || typeof novo !== 'object') return { ok: false, erro: 'Estilo inválido.' };
    const e = { ...(st[id]?.estilo || {}) };
    const opcao = (campo, lista) => { if (campo in novo) { if (novo[campo] === null || lista.includes(novo[campo])) e[campo] = novo[campo] || undefined; else throw new Error(`Opção inválida em ${campo}.`); } };
    try {
      opcao('decoracao', ESTILOS.decoracao); opcao('efeito', ESTILOS.efeito); opcao('placa', ESTILOS.placa);
      if ('tema' in novo) {
        if (novo.tema === null) delete e.tema;
        else { const { c1, c2 } = novo.tema || {}; if (!COR.test(c1 || '') || !COR.test(c2 || '')) throw new Error('As cores do tema devem ser #RRGGBB.'); e.tema = { c1, c2 }; }
      }
      if ('nome' in novo) {
        if (novo.nome === null) delete e.nome;
        else {
          const n = { ...(e.nome || {}), ...novo.nome };
          if (!ESTILOS.fonte.includes(n.fonte || 'padrao')) throw new Error('Fonte inválida.');
          if (!ESTILOS.efeitoNome.includes(n.efeito || 'solido')) throw new Error('Efeito de nome inválido.');
          for (const k of ['c1', 'c2']) if (n[k] && !COR.test(n[k])) throw new Error('As cores do nome devem ser #RRGGBB.');
          e.nome = { fonte: n.fonte || 'padrao', efeito: n.efeito || 'solido', ...(n.c1 ? { c1: n.c1 } : {}), ...(n.c2 ? { c2: n.c2 } : {}) };
        }
      }
      if ('bio' in novo) e.bio = String(novo.bio || '').trim().slice(0, 190) || undefined;
      // voz do agente na chamada: nome de uma voz do app (ou "propria"), ritmo e expressividade; null volta à voz padrão dos Ajustes
      if ('voz' in novo) {
        if (!novo.voz || !novo.voz.nome) delete e.voz;
        else {
          const nome = String(novo.voz.nome); if (!/^[a-z0-9_-]{1,24}$/i.test(nome)) throw new Error('Voz inválida.');
          const num = (x, pad, min, max) => (Number.isFinite(Number(x)) ? Math.min(max, Math.max(min, Number(x))) : pad);
          e.voz = { nome, ritmo: num(novo.voz.ritmo, 0.4, 0.15, 0.8), expressividade: num(novo.voz.expressividade, 0.45, 0.2, 0.9) };
        }
      }
      if ('corCapa' in novo) { if (novo.corCapa && !COR.test(novo.corCapa)) throw new Error('A cor da capa deve ser #RRGGBB.'); e.corCapa = novo.corCapa || undefined; }
      if ('recorteFoto' in novo) e.recorteFoto = recorteValido(novo.recorteFoto);
      if ('recorteCapa' in novo) e.recorteCapa = recorteValido(novo.recorteCapa);
    } catch (err) { return { ok: false, erro: err.message }; }
    for (const k of Object.keys(e)) if (e[k] === undefined) delete e[k];
    st[id] = { ...(st[id] || {}), estilo: e };
    salvar(id === 'voce', id); aplicar();
    return { ok: true, estilo: e, roster: elenco.ROSTER };
  }

  /** Jeito de conversar do agente: personalidade escrita pela Game Director (substitui a do template), emojis e GIFs. */
  function definirConversa(id, novo) {
    if (id === 'voce' || !elenco.IDS.has(id)) return { ok: false, erro: 'Agente desconhecido.' };
    const c = { ...(st[id]?.conversa || {}) };
    if ('personalidade' in (novo || {})) {
      const t = String(novo.personalidade || '').trim().slice(0, 1500);
      // a versão que sai fica guardada (as 8 últimas): trocar de personalidade nunca apaga o que a Game Director escreveu
      if (c.personalidade && c.personalidade !== t) c.historico = [{ texto: c.personalidade, em: new Date().toISOString() }, ...(c.historico || []).filter((h) => h.texto !== c.personalidade)].slice(0, 8);
      if (t) c.personalidade = t; else delete c.personalidade;
    }
    for (const k of ['emojis', 'gifs', 'zoeira']) if (k in (novo || {})) { if (novo[k] === null) delete c[k]; else c[k] = !!novo[k]; }
    st[id] = { ...(st[id] || {}), conversa: c };
    salvar(false, id); aplicar();
    return { ok: true, conversa: c };
  }

  /** { caminho, tipo } da foto ou da capa, ou null. */
  function arquivo(id, tipo = 'foto') {
    const ext = st[id]?.[chaves(tipo)[1]];
    if (!existe(id) || !ext || !MIME[ext]) return null;
    const caminho = path.join(dirDe(id), `${baseArq(id)}${sufixo(tipo)}.${ext}`);
    return fs.existsSync(caminho) ? { caminho, tipo: MIME[ext] } : null;
  }
  const arquivoFoto = (id) => arquivo(id, 'foto');

  return { definirNome, definirFoto, removerFoto, definirCapa, removerCapa, definirEstilo, definirConversa, arquivoFoto, arquivo, recarregarVoce, recarregarGerais };
}
