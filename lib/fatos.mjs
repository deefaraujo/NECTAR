// Fact sheet: the source of truth that is not the chat. Environment, HEAD, commands, last test result, with time, author and origin.
// Only changes through a recorded action (fato.registrar) or by the app itself (job, delivery, validation). What the app measured wins over what the
// agent reported: each fact carries `origem` ("app" or "agente") and the prompt says so. Applies to any template.
import path from 'node:path';
import { ler, gravar } from './store.mjs';

const agora = () => new Date().toISOString();
const chaveOk = (k) => /^[\p{L}\p{N}_./:@-]{1,80}$/u.test(String(k || ''));
const corta = (s, n) => { const t = String(s ?? '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };

export function criarFatos({ pasta }) {
  const arq = path.join(pasta, 'fatos.json');
  const estado = ler(arq, { projeto: {}, cards: {} });
  estado.projeto ||= {}; estado.cards ||= {};
  const salvar = () => gravar(arq, estado);

  /** Records (or updates) a fact. escopo: 'projeto' or the card id. origem: 'app' (measured) or 'agente' (reported). */
  function registrar({ escopo = 'projeto', chave, valor, por = 'sistema', origem = 'agente', evidencia = '' }) {
    if (!chaveOk(chave)) return { ok: false, erro: 'Chave do fato inválida (use letras, números, ponto, barra, hífen; até 80).' };
    const v = corta(valor, 600);
    if (!v) return { ok: false, erro: 'Fato sem valor.' };
    const alvo = escopo === 'projeto' ? estado.projeto : (estado.cards[escopo] ||= {});
    const anterior = alvo[chave];
    // an agent report does not overwrite an app measurement newer than 2 h: the app is the one that measures
    if (origem === 'app') estado.medidos = (estado.medidos || 0) + 1; else estado.relatados = (estado.relatados || 0) + 1;
    if (anterior?.origem === 'app' && origem !== 'app' && Date.now() - Date.parse(anterior.em) < 2 * 3_600_000 && anterior.valor !== v) {
      estado.recusados = (estado.recusados || 0) + 1; salvar();   // false evidence: a report that contradicts a measurement (becomes a metric)
      return { ok: false, erro: `O app mediu "${chave}" há pouco (${anterior.valor}). Relato não sobrescreve medição; rode um job para medir de novo.` };
    }
    alvo[chave] = { valor: v, em: agora(), por, origem, evidencia: corta(evidencia, 300), ...(anterior && anterior.valor !== v ? { anterior: anterior.valor } : {}) };
    salvar();
    return { ok: true, fato: { escopo, chave, ...alvo[chave] } };
  }
  const apagar = (escopo, chave) => { const alvo = escopo === 'projeto' ? estado.projeto : estado.cards[escopo]; if (alvo && alvo[chave]) { delete alvo[chave]; salvar(); return true; } return false; };
  const doProjeto = () => structuredClone(estado.projeto);
  const doCard = (id) => structuredClone(estado.cards[id] || {});
  const listar = () => structuredClone(estado);

  const linha = (k, f) => `- ${k} = ${f.valor} (${f.origem === 'app' ? 'medido pelo app' : `relatado por ${f.por}`}, ${f.em.slice(0, 16).replace('T', ' ')}${f.evidencia ? `; ${f.evidencia}` : ''})`;
  /** Prompt section: what is measured and recorded. Short by design: facts, not conversation. */
  function paraPrompt(card) {
    const L = [];
    const p = Object.entries(estado.projeto);
    if (p.length) L.push('Do projeto:', ...p.slice(-25).map(([k, f]) => linha(k, f)));
    const c = card ? Object.entries(estado.cards[card] || {}) : [];
    if (c.length) L.push(`Do card ${card}:`, ...c.slice(-25).map(([k, f]) => linha(k, f)));
    if (!L.length) return '';
    return ['## Ficha de fatos (fonte de verdade; "medido pelo app" vence relato; não repita no chat o que já está aqui)', ...L, 'Registre fato novo com fato.registrar; para medir de verdade (teste, build, banco), use job.rodar e o app registra sozinho.'].join('\n');
  }
  const estatisticas = () => ({ recusados: estado.recusados || 0, relatados: estado.relatados || 0, medidos: estado.medidos || 0 });
  return { registrar, apagar, doProjeto, doCard, listar, paraPrompt, estatisticas };
}
