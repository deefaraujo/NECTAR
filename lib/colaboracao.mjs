// Delegation identity: two messages of the same type to the same specialist
// may represent different pieces of work. This key is local to the turn;
// durable idempotency by task_id/execution will be added in the TaskContract.
import { createHash } from 'node:crypto';

export function chaveDelegacao(tarefa = {}) {
  const declarada = tarefa.idempotencyKey || tarefa.chaveIdempotencia;
  if (declarada !== undefined && declarada !== null && String(declarada).trim()) {
    return `explicit:${String(declarada).trim()}`;
  }
  // Use the task's declared identity when available, without mixing requests
  // for different cards. The instruction distinguishes tasks of the same type/card.
  const partes = [tarefa.taskId || tarefa.task_id || '', tarefa.tipo || '', tarefa.agente || '',
    tarefa.origem || '', tarefa.card || '', tarefa.canalSaida || '', String(tarefa.instrucao || '').trim()];
  return `delegation:${createHash('sha256').update(JSON.stringify(partes)).digest('hex')}`;
}

export function mesmaDelegacao(a, b) {
  return chaveDelegacao(a) === chaveDelegacao(b);
}
