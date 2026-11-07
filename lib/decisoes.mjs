import path from 'node:path';
import { ler, gravar } from './store.mjs';

export function criarDecisoes({ pasta, lead }) {
  const arq = path.join(pasta, 'decisoes.json');
  const estado = ler(arq, { lista: [], historico: [] });
  const salvar = () => gravar(arq, estado);
  const obter = id => estado.lista.find(d => d.id === id);
  function propor(a, autor) {
    if (!/^[a-z0-9-]{1,80}$/.test(a.id || '') || !['humana','tecnica'].includes(a.tipo) || !String(a.contexto || '').trim() || !Array.isArray(a.opcoes) || a.opcoes.length < 2 || a.opcoes.length > 4) throw new Error('Decisão precisa de id, tipo, contexto e 2 a 4 opções com consequências.');
    const opcoes = a.opcoes.map(o => ({ id: String(o.id || '').slice(0,60), texto: String(o.texto || '').trim().slice(0,400), consequencia: String(o.consequencia || '').trim().slice(0,700) }));
    if (opcoes.some(o => !o.id || !o.texto || !o.consequencia) || new Set(opcoes.map(o=>o.id)).size !== opcoes.length) throw new Error('Opções precisam de IDs únicos, texto e consequência.');
    const proposta = { tipo: a.tipo, contexto: String(a.contexto).trim().slice(0,2000), opcoes, recomendada: a.recomendada || null, cards: Array.isArray(a.cards) ? [...new Set(a.cards)].slice(0,30) : [] };
    if (proposta.recomendada && !opcoes.some(o=>o.id===proposta.recomendada)) throw new Error('Opção recomendada desconhecida.');
    const anterior = obter(a.id);
    if (anterior && JSON.stringify(anterior.proposta) === JSON.stringify(proposta)) return structuredClone(anterior);
    if (anterior && a.revisaoEsperada !== anterior.revisao) throw new Error('A decisão mudou; releia sua revisão atual.');
    if (anterior?.status === 'aceita' && !(autor === 'voce' && a.substituir === true)) throw new Error('Decisão aceita só pode ser substituída explicitamente pela pessoa responsável.');
    const d = { id: a.id, proposta, revisao: (anterior?.revisao || 0) + 1, status: 'proposta', autor, em: new Date().toISOString() };
    if (anterior) estado.lista[estado.lista.indexOf(anterior)] = d; else estado.lista.push(d);
    estado.historico.push(structuredClone(d)); salvar(); return structuredClone(d);
  }
  function aceitar(id, revisao, opcao, autor) {
    const d = obter(id);
    if (!d || d.revisao !== revisao) throw new Error('Proposta ausente ou revisão desatualizada.');
    if (autor !== 'voce' && (d.proposta.tipo === 'humana' || autor !== lead)) throw new Error('Apenas a pessoa responsável aceita decisões humanas; a P.O. aceita decisões técnicas.');
    if (!d.proposta.opcoes.some(o => o.id === opcao)) throw new Error('Opção desconhecida.');
    if (d.status === 'aceita') { if (d.escolha !== opcao) throw new Error('Decisão já aceita com outra escolha.'); return structuredClone(d); }
    Object.assign(d, { status: 'aceita', escolha: opcao, aceitaPor: autor, aceitaEm: new Date().toISOString() });
    estado.historico.push(structuredClone(d)); salvar(); return structuredClone(d);
  }
  // Answer ledger: every answered question (by the user, by the P.O. in autopilot, by delegation) is recorded with who decided and why.
  // Agents check it before asking; a question identical to one decided in the last 24 h comes back with the same answer, without a call.
  estado.respostas ||= [];
  function registrarResposta({ pergunta, resposta, por, motivo = '', card = null, de = null }) {
    const r = { pergunta: String(pergunta || '').replace(/\s+/g, ' ').slice(0, 500), resposta: String(resposta || '').slice(0, 400), por, motivo: String(motivo || '').slice(0, 300), card, de, em: new Date().toISOString() };
    estado.respostas.push(r);
    if (estado.respostas.length > 200) estado.respostas.splice(0, estado.respostas.length - 200);
    salvar(); return r;
  }
  const respostas = () => structuredClone(estado.respostas);
  /** Previous answer that fits this question (same card or no card, last 24 h, nearly identical text). */
  function respostaAnterior(texto, card, similaridade) {
    const lim = Date.now() - 24 * 3_600_000;
    return [...estado.respostas].reverse().find((r) => Date.parse(r.em) >= lim && (!card || !r.card || r.card === card) && similaridade(r.pergunta, String(texto || '')) >= 0.75) || null;
  }
  const respostasParaPrompt = (card) => [...estado.respostas].reverse().filter((r) => !card || !r.card || r.card === card).slice(0, 12)
    .map((r) => `- ${r.card ? `[${r.card}] ` : ''}"${r.pergunta.slice(0, 120)}" → ${r.resposta.slice(0, 160)} (${r.por}${r.motivo ? `: ${r.motivo.slice(0, 100)}` : ''})`);
  const listar = () => structuredClone(estado.lista);
  const pendentes = card => estado.lista.filter(d => d.status === 'proposta' && d.proposta.cards.includes(card));
  const paraPrompt = card => estado.lista.filter(d => (!d.proposta.cards.length || !card || d.proposta.cards.includes(card))).map(d => ({ id: d.id, revisao: d.revisao, status: d.status, ...d.proposta, escolha: d.escolha, aceitaPor: d.aceitaPor }));
  return { propor, aceitar, listar, pendentes, paraPrompt, obter: id => structuredClone(obter(id) || null), registrarResposta, respostas, respostaAnterior, respostasParaPrompt };
}
