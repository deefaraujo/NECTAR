// Ficha de fatos: a fonte de verdade que não é o chat. Ambiente, HEAD, comandos, último resultado de teste, com hora, autor e origem.
// Só muda por ação registrada (fato.registrar) ou pelo próprio app (job, entrega, validação). O que o app mediu vence o que o
// agente relatou: cada fato carrega `origem` ("app" ou "agente") e o prompt diz isso. Vale para qualquer template.
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

  /** Registra (ou atualiza) um fato. escopo: 'projeto' ou o id do card. origem: 'app' (medido) ou 'agente' (relatado). */
  function registrar({ escopo = 'projeto', chave, valor, por = 'sistema', origem = 'agente', evidencia = '' }) {
    if (!chaveOk(chave)) return { ok: false, erro: 'Chave do fato inválida (use letras, números, ponto, barra, hífen; até 80).' };
    const v = corta(valor, 600);
    if (!v) return { ok: false, erro: 'Fato sem valor.' };
    const alvo = escopo === 'projeto' ? estado.projeto : (estado.cards[escopo] ||= {});
    const anterior = alvo[chave];
    // relato de agente não sobrescreve medição do app mais recente que 2 h: o app é quem mede
    if (origem === 'app') estado.medidos = (estado.medidos || 0) + 1; else estado.relatados = (estado.relatados || 0) + 1;
    if (anterior?.origem === 'app' && origem !== 'app' && Date.now() - Date.parse(anterior.em) < 2 * 3_600_000 && anterior.valor !== v) {
      estado.recusados = (estado.recusados || 0) + 1; salvar();   // evidência falsa: relato que contradiz medição (vira métrica)
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
  /** Seção do prompt: o que está medido e registrado. Curta por desenho: fatos, não conversa. */
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
