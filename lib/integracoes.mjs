// Integrações de UM projeto: Jira (as demandas da Game Director) e a agenda (reuniões do Teams, que moram no
// calendário do Outlook). O app só LÊ. Com isso a P.O. enxerga o backlog e os compromissos, sugere o que
// fazer primeiro e conversa sobre o escopo de cada demanda antes de repassá-la ao time.
//
// Guardado na pasta do projeto: integracoes.json (a configuração, com o token protegido) e o último
// resultado lido (para a P.O. enxergar mesmo se a rede da empresa estiver fora naquele minuto).
import path from 'node:path';
import { ler, gravar } from './store.mjs';
import { proteger, revelar, temCofre } from './cofre.mjs';
import * as jira from './jira.mjs';
import { lerIcs, eventosEntre, carregarFonte } from './agenda.mjs';

const PADRAO = {
  jira: { ativo: false, url: '', tipo: 'pat', usuario: '', tokenProtegido: '', jql: '' },
  agenda: { ativo: false, fonte: '' },
  intervaloMin: 15,
  cache: { jira: { em: null, itens: [], total: 0, erro: null }, agenda: { em: null, eventos: [], erro: null } },
  avisados: [],
};

const hora = (ts) => new Date(ts).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
const dataCurta = (ts) => new Date(ts).toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit' });
const mesmoDia = (a, b) => new Date(a).toDateString() === new Date(b).toDateString();

export function criarIntegracoes({ pasta, emitir, notificacoes }) {
  const arq = path.join(pasta, 'integracoes.json');
  const st = ler(arq, PADRAO);
  for (const k of Object.keys(PADRAO)) if (st[k] === undefined) st[k] = structuredClone(PADRAO[k]);
  st.jira = { ...PADRAO.jira, ...st.jira };
  st.agenda = { ...PADRAO.agenda, ...st.agenda };
  st.cache = { ...PADRAO.cache, ...st.cache };
  const salvar = () => gravar(arq, st);

  /** A configuração sem o segredo: a interface só sabe SE existe token, nunca qual é. */
  function publico() {
    const { tokenProtegido, ...jiraPub } = st.jira;
    return {
      jira: { ...jiraPub, temToken: !!tokenProtegido }, agenda: st.agenda, intervaloMin: st.intervaloMin, cofre: temCofre(),
      cache: st.cache,
    };
  }

  function salvarConfig(c = {}) {
    const j = c.jira || {}; const a = c.agenda || {};
    if (typeof j.ativo === 'boolean') st.jira.ativo = j.ativo;
    if (typeof j.url === 'string') st.jira.url = j.url.trim().replace(/\/+$/, '').slice(0, 300);
    if (['pat', 'cloud'].includes(j.tipo)) st.jira.tipo = j.tipo;
    if (typeof j.usuario === 'string') st.jira.usuario = j.usuario.trim().slice(0, 200);
    if (typeof j.jql === 'string') st.jira.jql = j.jql.trim().slice(0, 1000);
    if (typeof j.token === 'string' && j.token.trim()) st.jira.tokenProtegido = proteger(j.token.trim());
    if (j.removerToken) st.jira.tokenProtegido = '';
    if (typeof a.ativo === 'boolean') st.agenda.ativo = a.ativo;
    if (typeof a.fonte === 'string') st.agenda.fonte = a.fonte.trim().slice(0, 600);
    if ([5, 10, 15, 30, 60].includes(Number(c.intervaloMin))) st.intervaloMin = Number(c.intervaloMin);
    salvar();
    return publico();
  }

  const cfgJira = (extra = {}) => ({ ...st.jira, ...extra, token: extra.token || revelar(st.jira.tokenProtegido) });

  async function lerJira(extra) {
    const r = await jira.buscar(cfgJira(extra));
    if (!extra) {
      st.cache.jira = r.ok ? { em: new Date().toISOString(), itens: r.itens, total: r.total, erro: null } : { ...st.cache.jira, erro: r.erro, tentouEm: new Date().toISOString() };
      salvar();
    }
    return r;
  }

  async function lerAgenda(extra) {
    const fonte = extra?.fonte ?? st.agenda.fonte;
    try {
      const txt = await carregarFonte(fonte);
      const ev = lerIcs(txt);
      const agora = new Date();
      const lista = eventosEntre(ev, new Date(agora.getTime() - 3_600_000), new Date(agora.getTime() + 14 * 86_400_000));
      if (!extra) { st.cache.agenda = { em: agora.toISOString(), eventos: lista, erro: null }; salvar(); }
      return { ok: true, eventos: lista, total: ev.length };
    } catch (e) {
      if (!extra) { st.cache.agenda = { ...st.cache.agenda, erro: e.message, tentouEm: new Date().toISOString() }; salvar(); }
      return { ok: false, erro: e.message };
    }
  }

  /** Lê o que estiver ligado. `forcar` ignora o intervalo. */
  async function sincronizar({ forcar = false } = {}) {
    const vencido = (em) => !em || Date.now() - Date.parse(em) >= st.intervaloMin * 60_000;
    const feitos = [];
    if (st.jira.ativo && (forcar || vencido(st.cache.jira.tentouEm && st.cache.jira.erro ? st.cache.jira.tentouEm : st.cache.jira.em))) { await lerJira(); feitos.push('jira'); }
    if (st.agenda.ativo && (forcar || vencido(st.cache.agenda.tentouEm && st.cache.agenda.erro ? st.cache.agenda.tentouEm : st.cache.agenda.em))) { await lerAgenda(); feitos.push('agenda'); }
    if (feitos.length) emitir({ tipo: 'integracoes', integracoes: publico() });
    return feitos;
  }

  // ---- o que a P.O. enxerga ----------------------------------------------------------------------
  const futuros = (ate = 3) => {
    const agora = Date.now();
    return (st.cache.agenda.eventos || []).filter((e) => e.fimTs >= agora && e.ts <= agora + ate * 86_400_000);
  };
  const proximo = (tipo) => futuros(14).find((e) => e.tipo === tipo) || null;

  function agendaTexto() {
    const ev = futuros(3);
    const linhas = [];
    const rev = proximo('review'); const dai = proximo('daily');
    if (rev) linhas.push(`Próxima review: ${dataCurta(rev.ts)} às ${hora(rev.ts)}, "${rev.titulo}".`);
    if (dai) linhas.push(`Próxima daily: ${mesmoDia(dai.ts, Date.now()) ? 'hoje' : dataCurta(dai.ts)} às ${hora(dai.ts)}.`);
    for (const e of ev.slice(0, 14)) linhas.push(`- ${dataCurta(e.ts)} ${e.dia ? 'dia todo' : `${hora(e.ts)} a ${hora(e.fimTs)}`}: ${e.titulo} [${e.tipo}]`);
    return linhas;
  }

  function paraPrompt() {
    const partes = [];
    if (st.jira.ativo && st.cache.jira.itens.length) {
      const ok = st.cache.jira;
      partes.push(`## Demandas da Game Director no Jira (leitura de ${new Date(ok.em).toLocaleString('pt-BR')}; o app só lê, nunca altera o Jira)`,
        ...ok.itens.slice(0, 20).map((i) => `- ${i.key} [${i.prioridade || '-'}, ${i.status}${i.vencimento ? `, vence ${i.vencimento}` : ''}] ${i.resumo}${i.descricao ? `\n    ${i.descricao.replace(/\s+/g, ' ').slice(0, 220)}` : ''}`),
        `Total aberto: ${ok.total}. Para trazer uma demanda ao quadro, abra um card com o campo jira preenchido (a chave). Converse com ela sobre o escopo ANTES de repassar ao time.`);
    } else if (st.jira.ativo && st.cache.jira.erro) partes.push(`## Jira\nNão consegui ler o Jira agora: ${st.cache.jira.erro}`);
    if (st.agenda.ativo && st.cache.agenda.em) {
      const l = agendaTexto();
      partes.push('## Agenda da Game Director (do calendário, próximos 3 dias)', ...(l.length ? l : ['Sem compromissos nos próximos 3 dias.']),
        'Use a agenda para sugerir o que priorizar e o que preparar (por exemplo, o que mostrar na review).');
    } else if (st.agenda.ativo && st.cache.agenda.erro) partes.push(`## Agenda\nNão consegui ler o calendário agora: ${st.cache.agenda.erro}`);
    return partes.join('\n');
  }

  // ---- aviso antes das reuniões (sem modelo) ------------------------------------------------------
  function avisarReunioes() {
    if (!st.agenda.ativo) return;
    const agora = Date.now();
    for (const e of futuros(1)) {
      const falta = e.ts - agora;
      if (e.dia || falta < 0 || falta > 15 * 60_000) continue;
      if (!['daily', 'review', 'planning', 'retro', '1a1'].includes(e.tipo) && falta > 10 * 60_000) continue;
      const chave = `${e.ts}|${e.titulo}`;
      if (st.avisados.includes(chave)) continue;
      st.avisados.push(chave);
      st.avisados = st.avisados.slice(-60);
      salvar();
      notificacoes?.add({ tipo: 'aviso', nivel: ['review', 'planning'].includes(e.tipo) ? 'atencao' : 'info', titulo: `${e.titulo} às ${hora(e.ts)}`, texto: `Começa em ${Math.max(1, Math.round(falta / 60_000))} min${e.teams ? '. Há link do Teams.' : '.'}`, canal: 'equipe' });
    }
  }

  async function tick() {
    await sincronizar();
    avisarReunioes();
  }

  return { publico, salvarConfig, lerJira, lerAgenda, sincronizar, tick, paraPrompt, demandas: () => st.cache.jira, agendaCache: () => ({ ...st.cache.agenda, proximaReview: proximo('review'), proximaDaily: proximo('daily') }), url: () => st.jira.url };
}
