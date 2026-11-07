// Advisor initiatives (Professional Advisory): what it decided to do on its own or on request, with persisted state,
// trigger, reason, specialists involved, deliverables, evidence and cost. It is the record that separates "the model said it did it" from
// "the app knows where it stands". Closed state machine: only the transitions below are valid, and none comes from the model's free text
// without going through here. Completing requires a deliverable, evidence or a completed card linked to the initiative.
import path from 'node:path';
import { ler, gravarDepois } from './store.mjs';

export const ESTADOS = ['detected', 'evaluating', 'proposed', 'approved', 'planning', 'queued', 'running', 'waiting_dependency', 'waiting_approval', 'reviewing', 'completed', 'blocked', 'failed', 'cancelled', 'expired'];
export const TRANSICOES = {
  detected: ['evaluating', 'cancelled', 'expired'],
  evaluating: ['proposed', 'planning', 'cancelled', 'expired'],
  proposed: ['approved', 'cancelled', 'expired'],
  approved: ['planning', 'queued', 'cancelled'],
  planning: ['queued', 'running', 'waiting_approval', 'blocked', 'cancelled'],
  queued: ['running', 'cancelled', 'blocked'],
  running: ['waiting_dependency', 'waiting_approval', 'reviewing', 'completed', 'blocked', 'failed', 'cancelled'],
  waiting_dependency: ['running', 'blocked', 'cancelled', 'expired'],
  waiting_approval: ['running', 'queued', 'cancelled', 'expired'],
  reviewing: ['running', 'completed', 'failed', 'cancelled'],
  blocked: ['running', 'queued', 'cancelled', 'failed'],
  completed: [], failed: ['queued'], cancelled: [], expired: [],
};
const ATIVOS = new Set(['detected', 'evaluating', 'proposed', 'approved', 'planning', 'queued', 'running', 'waiting_dependency', 'waiting_approval', 'reviewing', 'blocked']);
export const CATEGORIAS = ['agenda', 'jira', 'equipes', 'quadro', 'perguntas', 'custos', 'pedido'];
const agora = () => new Date().toISOString();

/**
 * @param {{ pasta: string, emitir?: (e: any) => void, projetoId?: string, validarCard?: (id: string) => boolean }} o
 */
export function criarIniciativas({ pasta, emitir = () => {}, projetoId = null, validarCard = null, validarEntregavel = null, validarEvidencia = null }) {
  const arq = path.join(pasta, 'iniciativas.json');
  const st = ler(arq, { seq: 0, lista: [] });
  const salvar = () => { gravarDepois(arq, () => st); emitir({ tipo: 'iniciativas', iniciativas: listar() }); };
  const obter = (id) => st.lista.find((i) => i.id === id) || null;
  const ativas = () => st.lista.filter((i) => ATIVOS.has(i.estado));
  const publica = (i) => ({ ...i });
  function listar({ soAtivas = false } = {}) { return (soAtivas ? ativas() : st.lista).slice().sort((a, b) => String(b.atualizado).localeCompare(String(a.atualizado))).map(publica); }

  /** Creates one (or returns the active one with the same key: a repeated trigger never becomes two initiatives). */
  function criar({ titulo, motivo = '', origem = 'proactive_event', gatilho = null, chave = null, categoria = 'pedido', prioridade = 'medium', requerAprovacao = false, dono = 'chief_of_staff', objetivo = null, limiteChamadas = 12 }) {
    const t = String(titulo || '').trim().slice(0, 140); if (!t) return { ok: false, erro: 'A iniciativa precisa de um título.' };
    if (chave) { const ja = ativas().find((i) => i.chave === chave); if (ja) return { ok: true, iniciativa: publica(ja), repetida: true }; }
    const i = { id: `INIT-${++st.seq}`, titulo: t, motivo: String(motivo || '').slice(0, 400), origem, gatilho: gatilho ? String(gatilho).slice(0, 200) : null, chave: chave || null, categoria: CATEGORIAS.includes(categoria) ? categoria : 'pedido',
      prioridade: ['low', 'medium', 'high'].includes(prioridade) ? prioridade : 'medium', requerAprovacao: !!requerAprovacao, dono, objetivo: objetivo ? String(objetivo).slice(0, 200) : null, projeto: projetoId,
      estado: 'detected', historico: [{ em: agora(), estado: 'detected', quem: 'app', nota: motivo ? String(motivo).slice(0, 200) : '' }], criado: agora(), atualizado: agora(),
      agentes: [], cards: [], entregaveis: [], evidencias: [], chamadas: 0, limiteChamadas: Math.max(1, Number(limiteChamadas) || 12), proximaAcao: null, pergunta: null };
    st.lista.push(i); if (st.lista.length > 300) st.lista.splice(0, st.lista.length - 300);
    salvar(); return { ok: true, iniciativa: publica(i) };
  }

  /** Changes state only through a valid transition. Completing requires something verifiable linked to the initiative. */
  function transicionar(id, novo, { quem = 'app', nota = '', forcar = false } = {}) {
    const i = obter(id); if (!i) return { ok: false, erro: `Iniciativa ${id} não existe.` };
    if (!ESTADOS.includes(novo)) return { ok: false, erro: `Estado desconhecido: ${novo}.` };
    if (i.estado === novo) return { ok: true, iniciativa: publica(i), repetida: true };
    if (!forcar && !(TRANSICOES[i.estado] || []).includes(novo)) return { ok: false, erro: `De ${i.estado} não dá para ir a ${novo}.` };
    if (novo === 'completed') {
      // Referencing a card does not prove completion. If the record has only
      // cards, at least one must actually be completed on the board.
      const cardsOk = !i.cards.length || typeof validarCard === 'function' && i.cards.every(id => validarCard(id));
      const entregasOk = !i.entregaveis.length || typeof validarEntregavel === 'function' && i.entregaveis.every(id => validarEntregavel(id));
      const evidenciasOk = !i.evidencias.length || typeof validarEvidencia === 'function' && i.evidencias.every(id => validarEvidencia(id));
      if (!(i.cards.length || i.entregaveis.length || i.evidencias.length) || !cardsOk || !entregasOk || !evidenciasOk) {
        return { ok: false, erro: 'Para concluir, todos os cards precisam estar concluídos e cada entregável/evidência precisa ser verificado.' };
      }
    }
    i.estado = novo; i.atualizado = agora(); i.historico.push({ em: agora(), estado: novo, quem, nota: String(nota || '').slice(0, 300) });
    if (novo === 'proposed') i.requerAprovacao = true;
    salvar(); return { ok: true, iniciativa: publica(i) };
  }

  /** Links agents, cards, deliverables (paths) and evidence (ledger ids) to the initiative. */
  function vincular(id, { agentes = [], cards = [], entregaveis = [], evidencias = [], proximaAcao, pergunta } = {}) {
    const i = obter(id); if (!i) return { ok: false, erro: `Iniciativa ${id} não existe.` };
    const junta = (lista, novos, max) => { for (const x of novos) { const v = String(x).slice(0, 240); if (v && !lista.includes(v)) lista.push(v); } if (lista.length > max) lista.splice(0, lista.length - max); };
    junta(i.agentes, agentes, 20); junta(i.cards, cards, 40); junta(i.entregaveis, entregaveis, 40); junta(i.evidencias, evidencias, 80);
    if (proximaAcao !== undefined) i.proximaAcao = proximaAcao ? String(proximaAcao).slice(0, 200) : null;
    if (pergunta !== undefined) i.pergunta = pergunta;
    i.atualizado = agora(); salvar(); return { ok: true, iniciativa: publica(i) };
  }

  /** Every model call made by this initiative counts here; past the limit, the app blocks and warns. */
  function registrarChamada(id, n = 1) {
    const i = obter(id); if (!i) return null;
    i.chamadas += n; i.atualizado = agora();
    if (i.chamadas > i.limiteChamadas && ATIVOS.has(i.estado) && i.estado !== 'blocked') { i.estado = 'blocked'; i.historico.push({ em: agora(), estado: 'blocked', quem: 'app', nota: `Passou de ${i.limiteChamadas} chamadas sem concluir.` }); }
    salvar(); return publica(i);
  }

  /** Detected or under evaluation for more than `horas` without progress: expires (nothing hangs around forever). */
  function expirar(horas = 24, agoraMs = Date.now()) {
    let n = 0;
    for (const i of st.lista) if (['detected', 'evaluating', 'proposed', 'waiting_approval', 'waiting_dependency'].includes(i.estado) && agoraMs - Date.parse(i.atualizado) > horas * 3_600_000) { i.estado = 'expired'; i.atualizado = agora(); i.historico.push({ em: agora(), estado: 'expired', quem: 'app', nota: `${horas} h sem andar.` }); n++; }
    if (n) salvar();
    return n;
  }

  const porPergunta = (qid) => st.lista.find((i) => i.pergunta === qid) || null;
  const resumo = () => { const a = ativas(); return { ativas: a.length, aguardandoVoce: a.filter((i) => ['proposed', 'waiting_approval'].includes(i.estado)).length, rodando: a.filter((i) => ['running', 'planning', 'queued', 'reviewing'].includes(i.estado)).length, bloqueadas: a.filter((i) => i.estado === 'blocked').length }; };
  return { criar, transicionar, vincular, registrarChamada, expirar, listar, obter: (id) => { const i = obter(id); return i ? publica(i) : null; }, porPergunta, resumo, ESTADOS, TRANSICOES };
}
