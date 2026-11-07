// Appointments (the Game Director's calendar inside the app): meetings, deadlines and reminders set by the user and the agents. (agenda.mjs is the Outlook ICS reader.)
// One per project, shared by all teams (stored in the main team's folder: agenda.json). Who creates them: the user, via the UI
// or the API, and the agents, via the agenda.criar action ("I have a meeting Friday at 3pm about X" becomes an event). Reminders become notifications.
import { ler, gravar } from './store.mjs';

const porPasta = new Map();   // folder -> calendar (one instance per project)
const FUSO = 'America/Sao_Paulo';
export const DIAS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];

const limpa = (s, n) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const data = (v) => { if (!v) return null; const d = new Date(v); return Number.isNaN(d.getTime()) ? null : d; };
/** Readable local date: "sexta, 07/11 15:00". */
export function quando(iso, { comHora = true } = {}) {
  const d = data(iso); if (!d) return '';
  const p = new Intl.DateTimeFormat('pt-BR', { timeZone: FUSO, weekday: 'long', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(d);
  const g = (t) => p.find((x) => x.type === t)?.value || '';
  return `${g('weekday')}, ${g('day')}/${g('month')}${comHora ? ` ${g('hour')}:${g('minute')}` : ''}`;
}
/** "Hoje é sábado, 01/11/2026 12:05" plus the dates of the next 14 days: the model does not need to guess which day "next Friday" is. */
export function referenciaDeHoje(agora = new Date()) {
  const fmt = new Intl.DateTimeFormat('pt-BR', { timeZone: FUSO, weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  const prox = [];
  for (let i = 1; i <= 14; i++) { const d = new Date(agora.getTime() + i * 86400_000); const p = new Intl.DateTimeFormat('pt-BR', { timeZone: FUSO, weekday: 'short', day: '2-digit', month: '2-digit' }).format(d); prox.push(p.replace('.', '')); }
  return `Agora: ${fmt.format(agora)} (${FUSO}). Próximos dias: ${prox.join(', ')}. Datas e horas em ISO 8601 com fuso (ex.: 2026-11-07T15:00:00-03:00).`;
}

export function agendaDe(pasta, { emitir = () => {}, notificar = null } = {}) {
  if (porPasta.has(pasta)) { const a = porPasta.get(pasta); a._emitir = emitir; if (notificar) a._notificar = notificar; return a; }
  const arq = `${pasta}/agenda.json`;
  const st = ler(arq, { seq: 0, eventos: [] });
  const salvar = () => gravar(arq, st);
  const api = {
    _emitir: emitir, _notificar: notificar,
    /** Events between two dates (ISO). Without dates: next 30 days and last 7. */
    listar({ de, ate, incluirCancelados = false } = {}) {
      const d0 = data(de) || new Date(Date.now() - 7 * 86400_000), d1 = data(ate) || new Date(Date.now() + 30 * 86400_000);
      return st.eventos.filter((e) => (incluirCancelados || !e.cancelado) && new Date(e.fim) >= d0 && new Date(e.inicio) <= d1).sort((a, b) => a.inicio.localeCompare(b.inicio));
    },
    obter: (id) => st.eventos.find((e) => e.id === id) || null,
    /** Creates an event. `quem` is 'voce' or the agent id (with the team). */
    criar(o, quem = 'voce', equipe = null) {
      const inicio = data(o.inicio); if (!inicio) return { ok: false, erro: 'Informe o início do evento (data e hora, ISO 8601).' };
      let fim = data(o.fim);
      const diaInteiro = !!o.diaInteiro;
      if (!fim) { const min = Number(o.duracaoMin) > 0 ? Number(o.duracaoMin) : diaInteiro ? 24 * 60 : 60; fim = new Date(inicio.getTime() + min * 60_000); }
      if (fim <= inicio) return { ok: false, erro: 'O fim precisa ser depois do início.' };
      const titulo = limpa(o.titulo, 120); if (!titulo) return { ok: false, erro: 'O evento precisa de título.' };
      // same title at the same time: it is the same event (an agent repeating the action does not duplicate it)
      const dup = st.eventos.find((e) => !e.cancelado && e.titulo.toLowerCase() === titulo.toLowerCase() && Math.abs(new Date(e.inicio) - inicio) < 60_000);
      if (dup) return { ok: true, evento: dup, repetido: true };
      const e = {
        id: `ev-${++st.seq}`, titulo, descricao: limpa(o.descricao, 1500), local: limpa(o.local, 200), inicio: inicio.toISOString(), fim: fim.toISOString(), diaInteiro,
        participantes: (Array.isArray(o.participantes) ? o.participantes : String(o.participantes || '').split(/[,;]/)).map((p) => limpa(p, 60)).filter(Boolean).slice(0, 20),
        tipo: ['reuniao', 'prazo', 'lembrete', 'pessoal', 'marco'].includes(o.tipo) ? o.tipo : 'reuniao',
        lembreteMin: Number.isFinite(Number(o.lembreteMin)) ? Math.max(0, Math.min(7 * 24 * 60, Number(o.lembreteMin))) : 15,
        card: o.card ? limpa(o.card, 20) : null, origem: { quem, equipe: equipe || null, em: new Date().toISOString() }, atualizado: new Date().toISOString(), cancelado: false, avisado: false,
      };
      st.eventos.push(e);
      if (st.eventos.length > 2000) st.eventos.splice(0, st.eventos.length - 2000);
      salvar(); api._emitir({ tipo: 'agenda', evento: e, acao: 'criou' });
      return { ok: true, evento: e };
    },
    atualizar(id, o, quem = 'voce') {
      const e = api.obter(id); if (!e) return { ok: false, erro: `Evento ${id} não existe.` };
      const n = { ...e };
      if (o.titulo !== undefined) { n.titulo = limpa(o.titulo, 120); if (!n.titulo) return { ok: false, erro: 'O evento precisa de título.' }; }
      if (o.descricao !== undefined) n.descricao = limpa(o.descricao, 1500);
      if (o.local !== undefined) n.local = limpa(o.local, 200);
      if (o.inicio !== undefined) { const d = data(o.inicio); if (!d) return { ok: false, erro: 'Início inválido.' }; n.inicio = d.toISOString(); }
      if (o.fim !== undefined) { const d = data(o.fim); if (!d) return { ok: false, erro: 'Fim inválido.' }; n.fim = d.toISOString(); }
      if (o.duracaoMin !== undefined && Number(o.duracaoMin) > 0) n.fim = new Date(new Date(n.inicio).getTime() + Number(o.duracaoMin) * 60_000).toISOString();
      if (new Date(n.fim) <= new Date(n.inicio)) return { ok: false, erro: 'O fim precisa ser depois do início.' };
      if (o.diaInteiro !== undefined) n.diaInteiro = !!o.diaInteiro;
      if (o.participantes !== undefined) n.participantes = (Array.isArray(o.participantes) ? o.participantes : String(o.participantes || '').split(/[,;]/)).map((p) => limpa(p, 60)).filter(Boolean).slice(0, 20);
      if (o.tipo !== undefined && ['reuniao', 'prazo', 'lembrete', 'pessoal', 'marco'].includes(o.tipo)) n.tipo = o.tipo;
      if (o.lembreteMin !== undefined && Number.isFinite(Number(o.lembreteMin))) { n.lembreteMin = Math.max(0, Math.min(7 * 24 * 60, Number(o.lembreteMin))); n.avisado = false; }
      if (o.cancelado !== undefined) n.cancelado = !!o.cancelado;
      if (n.inicio !== e.inicio) n.avisado = false;
      n.atualizado = new Date().toISOString(); n.ultimaEdicao = { quem, em: n.atualizado };
      Object.assign(e, n);
      salvar(); api._emitir({ tipo: 'agenda', evento: e, acao: 'atualizou' });
      return { ok: true, evento: e };
    },
    cancelar(id, quem = 'voce', motivo = '') {
      const e = api.obter(id); if (!e) return { ok: false, erro: `Evento ${id} não existe.` };
      e.cancelado = true; e.motivoCancelamento = limpa(motivo, 300); e.atualizado = new Date().toISOString(); e.ultimaEdicao = { quem, em: e.atualizado };
      salvar(); api._emitir({ tipo: 'agenda', evento: e, acao: 'cancelou' });
      return { ok: true, evento: e };
    },
    remover(id) { const i = st.eventos.findIndex((e) => e.id === id); if (i < 0) return { ok: false, erro: 'Evento não existe.' }; const [e] = st.eventos.splice(i, 1); salvar(); api._emitir({ tipo: 'agenda', evento: { ...e, removido: true }, acao: 'removeu' }); return { ok: true }; },
    /** For the prompt: what is on today and in the next few days, briefly. */
    paraPrompt(dias = 10) {
      const lista = api.listar({ de: new Date(Date.now() - 2 * 3600_000).toISOString(), ate: new Date(Date.now() + dias * 86400_000).toISOString() }).slice(0, 25);
      if (!lista.length) return `Agenda dos próximos ${dias} dias: vazia.`;
      return `Agenda dos próximos ${dias} dias (${lista.length} ${lista.length === 1 ? 'evento' : 'eventos'}):\n${lista.map((e) => `- ${e.id} ${quando(e.inicio, { comHora: !e.diaInteiro })}${e.diaInteiro ? ' (dia inteiro)' : ` até ${quando(e.fim).split(' ').pop()}`}: ${e.titulo}${e.local ? ` @ ${e.local}` : ''}${e.participantes.length ? ` (com ${e.participantes.join(', ')})` : ''}${e.card ? ` [${e.card}]` : ''}`).join('\n')}`;
    },
    /** Overdue reminders become notifications (the server calls this every minute). */
    tiquetaque(agora = Date.now()) {
      let n = 0;
      for (const e of st.eventos) {
        if (e.cancelado || e.avisado) continue;
        const ini = new Date(e.inicio).getTime();
        if (agora >= ini - e.lembreteMin * 60_000 && agora < ini + 60 * 60_000) { e.avisado = true; n++; api._notificar?.({ tipo: 'agenda', nivel: 'atencao', titulo: `${e.tipo === 'prazo' ? 'Prazo' : e.tipo === 'lembrete' ? 'Lembrete' : 'Compromisso'}: ${e.titulo}`, texto: `${quando(e.inicio, { comHora: !e.diaInteiro })}${e.local ? `, ${e.local}` : ''}${e.descricao ? `. ${e.descricao.slice(0, 160)}` : ''}`, dados: { evento: e.id } }); }
      }
      if (n) salvar();
      return n;
    },
    total: () => st.eventos.filter((e) => !e.cancelado).length,
  };
  porPasta.set(pasta, api);
  return api;
}
