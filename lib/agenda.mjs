// Agenda: lê um calendário em formato ICS (o link de "calendário publicado" do Outlook, onde ficam as
// reuniões do Teams, ou um arquivo .ics) e devolve os próximos compromissos. SÓ LEITURA, sem modelo.
// Entende horário em UTC, com fuso (inclusive os nomes do Windows) e sem fuso; repetições diárias, semanais,
// mensais e anuais (INTERVAL, BYDAY, COUNT, UNTIL, EXDATE); e ocorrências remarcadas (RECURRENCE-ID).
import fs from 'node:fs';

const MAPA_WINDOWS = {
  'e. south america standard time': 'America/Sao_Paulo', 'brasilia standard time': 'America/Sao_Paulo', 'utc': 'UTC',
  'pacific standard time': 'America/Los_Angeles', 'eastern standard time': 'America/New_York', 'central standard time': 'America/Chicago',
  'mountain standard time': 'America/Denver', 'gmt standard time': 'Europe/London', 'w. europe standard time': 'Europe/Berlin',
  'romance standard time': 'Europe/Paris', 'argentina standard time': 'America/Argentina/Buenos_Aires', 'sa pacific standard time': 'America/Bogota',
};
const DIAS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

function zonaValida(tz) {
  if (!tz) return null;
  const nome = MAPA_WINDOWS[String(tz).toLowerCase().replace(/^\(.*?\)\s*/, '')] || tz;
  try { new Intl.DateTimeFormat('en-US', { timeZone: nome }); return nome; } catch { return null; }
}

// Diferença, em ms, entre o relógio de parede de uma zona e o UTC, naquele instante.
function deslocamento(tz, ts) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' }).formatToParts(new Date(ts)).map((x) => [x.type, x.value]));
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(ts / 1000) * 1000;
}

// Relógio de parede (y, m, d, h, mi, s) numa zona -> instante UTC em ms. Sem zona, vale a do computador.
function paredeParaUTC(y, mo, d, h, mi, s, tz) {
  const chute = Date.UTC(y, mo - 1, d, h, mi, s);
  if (!tz) return new Date(y, mo - 1, d, h, mi, s).getTime();
  let t = chute - deslocamento(tz, chute);
  t = chute - deslocamento(tz, t); // segunda passada: acerta a virada de horário de verão
  return t;
}

function desdobrar(texto) {
  return texto.replace(/\r\n/g, '\n').replace(/\n[ \t]/g, '').split('\n');
}

function propriedade(linha) {
  const i = linha.indexOf(':');
  if (i < 0) return null;
  const [nome, ...params] = linha.slice(0, i).split(';');
  const p = {};
  for (const x of params) { const [k, v] = x.split('='); if (k) p[k.toUpperCase()] = (v || '').replace(/^"|"$/g, ''); }
  return { nome: nome.toUpperCase(), params: p, valor: linha.slice(i + 1) };
}

// "20261030T130000Z", "20261030T100000" ou "20261030" -> { ts, dia, parede:[y,mo,d,h,mi,s], tz }
function lerData(valor, params) {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/.exec(String(valor).trim());
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dia = !m[4];
  const [h, mi, s] = dia ? [0, 0, 0] : [Number(m[4]), Number(m[5]), Number(m[6])];
  if (m[7]) return { ts: Date.UTC(y, mo - 1, d, h, mi, s), dia, parede: [y, mo, d, h, mi, s], tz: 'UTC', utc: true };
  const tz = zonaValida(params?.TZID);
  return { ts: paredeParaUTC(y, mo, d, h, mi, s, tz), dia, parede: [y, mo, d, h, mi, s], tz, utc: false };
}

const desescapar = (t) => String(t || '').replace(/\\n/gi, '\n').replace(/\\,/g, ',').replace(/\\;/g, ';').replace(/\\\\/g, '\\');

export function lerIcs(texto) {
  const linhas = desdobrar(String(texto || ''));
  const eventos = [];
  let atual = null;
  for (const l of linhas) {
    if (l === 'BEGIN:VEVENT') { atual = { exdates: [], extras: {} }; continue; }
    if (l === 'END:VEVENT') { if (atual) eventos.push(atual); atual = null; continue; }
    if (!atual) continue;
    const p = propriedade(l);
    if (!p) continue;
    if (p.nome === 'SUMMARY') atual.titulo = desescapar(p.valor);
    else if (p.nome === 'DTSTART') atual.inicio = lerData(p.valor, p.params);
    else if (p.nome === 'DTEND') atual.fim = lerData(p.valor, p.params);
    else if (p.nome === 'DURATION') atual.duracaoTxt = p.valor;
    else if (p.nome === 'RRULE') atual.rrule = Object.fromEntries(p.valor.split(';').map((x) => x.split('=')));
    else if (p.nome === 'EXDATE') for (const v of p.valor.split(',')) { const d = lerData(v, p.params); if (d) atual.exdates.push(d.ts); }
    else if (p.nome === 'RECURRENCE-ID') atual.recorrenciaId = lerData(p.valor, p.params);
    else if (p.nome === 'UID') atual.uid = p.valor;
    else if (p.nome === 'LOCATION') atual.local = desescapar(p.valor);
    else if (p.nome === 'DESCRIPTION') atual.descricao = desescapar(p.valor);
    else if (p.nome === 'STATUS') atual.status = p.valor.toUpperCase();
    else if (p.nome === 'URL') atual.url = p.valor;
    else if (p.nome === 'X-MICROSOFT-SKYPETEAMSMEETINGURL') atual.teams = p.valor;
  }
  return eventos.filter((e) => e.inicio && e.status !== 'CANCELLED');
}

function duracaoMs(e) {
  if (e.fim) return Math.max(0, e.fim.ts - e.inicio.ts);
  const m = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?)?$/.exec(e.duracaoTxt || '');
  if (m) return ((Number(m[1] || 0) * 24 + Number(m[2] || 0)) * 60 + Number(m[3] || 0)) * 60_000;
  return e.inicio.dia ? 86_400_000 : 0;
}

function linkTeams(e) {
  if (e.teams) return e.teams;
  const alvo = `${e.descricao || ''} ${e.local || ''} ${e.url || ''}`;
  return (/https:\/\/teams\.microsoft\.com\/l\/meetup-join\/[^\s<>")]+/.exec(alvo) || [])[0] || null;
}

// Ocorrências de um evento dentro de [de, ate] (ms). Itera dia a dia a partir do início, em relógio de parede.
function ocorrencias(e, de, ate) {
  const dur = duracaoMs(e);
  const mk = (ts) => ({ ts, fimTs: ts + dur });
  if (!e.rrule) return e.inicio.ts + dur >= de && e.inicio.ts <= ate ? [mk(e.inicio.ts)] : [];
  const r = e.rrule;
  const freq = r.FREQ;
  const intervalo = Math.max(1, Number(r.INTERVAL) || 1);
  const limiteCount = r.COUNT ? Number(r.COUNT) : Infinity;
  const until = r.UNTIL ? (lerData(r.UNTIL, {})?.ts ?? Infinity) + (r.UNTIL.length === 8 ? 86_399_000 : 0) : Infinity;
  const [y0, mo0, d0, h, mi, s] = e.inicio.parede;
  const tz = e.inicio.utc ? 'UTC' : e.inicio.tz;
  const byday = r.BYDAY ? r.BYDAY.split(',').map((x) => x.replace(/^[+-]?\d+/, '')) : null;
  const diaDoInicio = DIAS[new Date(Date.UTC(y0, mo0 - 1, d0)).getUTCDay()];
  const out = [];
  let contados = 0;
  const inicioDia = Date.UTC(y0, mo0 - 1, d0);
  const semanaBase = inicioDia - new Date(inicioDia).getUTCDay() * 86_400_000; // domingo da semana do início
  for (let i = 0; i < 6000; i++) {
    const dia = new Date(inicioDia + i * 86_400_000);
    const y = dia.getUTCFullYear(); const mo = dia.getUTCMonth() + 1; const d = dia.getUTCDate();
    const dow = DIAS[dia.getUTCDay()];
    let vale = false;
    if (freq === 'DAILY') vale = i % intervalo === 0 && (!byday || byday.includes(dow));
    else if (freq === 'WEEKLY') {
      const sem = Math.floor((inicioDia + i * 86_400_000 - semanaBase) / (7 * 86_400_000));
      vale = sem % intervalo === 0 && (byday ? byday.includes(dow) : dow === diaDoInicio);
    } else if (freq === 'MONTHLY') {
      const meses = (y - y0) * 12 + (mo - mo0);
      vale = meses >= 0 && meses % intervalo === 0 && d === (Number(r.BYMONTHDAY) || d0);
    } else if (freq === 'YEARLY') vale = mo === mo0 && d === d0 && (y - y0) % intervalo === 0;
    if (!vale) continue;
    const ts = paredeParaUTC(y, mo, d, h, mi, s, tz);
    if (ts < e.inicio.ts) continue;
    if (ts > until) break;
    contados++;
    if (contados > limiteCount) break;
    if (ts > ate) break;
    if (ts + dur >= de && !e.exdates.includes(ts)) out.push(mk(ts));
  }
  return out;
}

/** Eventos entre `de` e `ate` (Date), já com repetições expandidas e remarcações aplicadas. */
export function eventosEntre(eventos, de, ate) {
  const a = de.getTime(); const b = ate.getTime();
  const remarcados = new Map();
  for (const e of eventos.filter((x) => x.recorrenciaId)) remarcados.set(`${e.uid}|${e.recorrenciaId.ts}`, e);
  const saida = [];
  for (const e of eventos) {
    if (e.recorrenciaId) continue;
    for (const o of ocorrencias(e, a, b)) {
      const sub = remarcados.get(`${e.uid}|${o.ts}`);
      const base = sub || e;
      const ts = sub ? sub.inicio.ts : o.ts;
      const fimTs = sub ? ts + duracaoMs(sub) : o.fimTs;
      if (fimTs < a || ts > b) continue;
      saida.push({ ts, fimTs, dia: !!base.inicio.dia, titulo: base.titulo || '(sem título)', local: base.local || '', teams: linkTeams(base), tipo: classificar(base.titulo) });
    }
  }
  for (const e of eventos.filter((x) => x.recorrenciaId)) {
    // remarcada para fora do padrão e sem evento-mãe expandido na janela: entra se cair na janela
    if (e.inicio.ts >= a && e.inicio.ts <= b && !saida.some((s) => s.ts === e.inicio.ts && s.titulo === (e.titulo || '(sem título)'))) {
      saida.push({ ts: e.inicio.ts, fimTs: e.inicio.ts + duracaoMs(e), dia: !!e.inicio.dia, titulo: e.titulo || '(sem título)', local: e.local || '', teams: linkTeams(e), tipo: classificar(e.titulo) });
    }
  }
  return saida.sort((x, y) => x.ts - y.ts);
}

/** daily, review, planning, retro, 1a1 ou reuniao, pelo título. */
export function classificar(titulo) {
  const t = String(titulo || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  if (/\b(daily|stand-?up|alinhamento diario)\b/.test(t)) return 'daily';
  if (/\b(review|revisao de sprint|demo|demonstracao|apresentacao de entregas)\b/.test(t)) return 'review';
  if (/\b(planning|planejamento)\b/.test(t)) return 'planning';
  if (/\b(retro|retrospectiva)\b/.test(t)) return 'retro';
  if (/\b(1:1|1x1|one.?on.?one)\b/.test(t)) return '1a1';
  return 'reuniao';
}

/** Lê a fonte: URL (http/https/webcal) ou caminho de arquivo. Devolve o texto do ICS. */
export async function carregarFonte(fonte) {
  const f = String(fonte || '').trim().replace(/^"|"$/g, '');
  if (!f) throw new Error('Informe o link do calendário (ICS) ou o caminho de um arquivo .ics.');
  if (/^(https?|webcal):\/\//i.test(f)) {
    const url = f.replace(/^webcal:/i, 'https:');
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 20_000);
    try {
      const r = await fetch(url, { signal: ctl.signal, headers: { Accept: 'text/calendar, */*' } });
      if (!r.ok) throw new Error(`O servidor do calendário respondeu ${r.status}.`);
      const txt = await r.text();
      if (!/BEGIN:VCALENDAR/i.test(txt)) throw new Error('Esse endereço não devolveu um calendário ICS.');
      return txt;
    } catch (e) {
      if (e.name === 'AbortError') throw new Error('O calendário demorou demais para responder (20 s).');
      throw e;
    } finally { clearTimeout(t); }
  }
  let txt;
  try { txt = fs.readFileSync(f, 'utf8'); } catch { throw new Error('Não encontrei esse arquivo .ics.'); }
  if (!/BEGIN:VCALENDAR/i.test(txt)) throw new Error('Esse arquivo não é um calendário ICS.');
  return txt;
}
