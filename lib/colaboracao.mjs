// Identidade da delegação: duas mensagens do mesmo tipo ao mesmo especialista
// podem representar trabalhos diferentes. Esta chave é local ao turno;
// idempotência durável por task_id/execução será adicionada no TaskContract.
import { createHash } from 'node:crypto';

export function chaveDelegacao(tarefa = {}) {
  const declarada = tarefa.idempotencyKey || tarefa.chaveIdempotencia;
  if (declarada !== undefined && declarada !== null && String(declarada).trim()) {
    return `explicit:${String(declarada).trim()}`;
  }
  // Use a identidade declarada da tarefa quando disponível, sem misturar pedidos
  // para cards diferentes. A instrução distingue tarefas do mesmo tipo/card.
  const partes = [tarefa.taskId || tarefa.task_id || '', tarefa.tipo || '', tarefa.agente || '',
    tarefa.origem || '', tarefa.card || '', tarefa.canalSaida || '', String(tarefa.instrucao || '').trim()];
  return `delegation:${createHash('sha256').update(JSON.stringify(partes)).digest('hex')}`;
}

export function mesmaDelegacao(a, b) {
  return chaveDelegacao(a) === chaveDelegacao(b);
}
