// Local transactional unit: domain + events + outbox in the same file.
// Cross-process lock, per-aggregate CAS and durable rename from the existing storage.
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { gravar } from './store.mjs';

export function criarTeamworkStore({ pasta, workspaceId, projectId, emitir = () => {}, relogio = () => Date.now() }) {
  if (!workspaceId || !projectId) throw new Error('workspace e projeto obrigatórios');
  const arquivo = path.resolve(pasta, 'teamwork-v1.json'), lock = `${arquivo}.lock`;
  const vazio = () => ({ schema: 'nectar.store.v1', workspaceId, projectId, revision: 0, tasks: {}, attempts: {}, artifacts: {}, handoffs: {}, plans: {}, approvals: {}, leadership: {}, lessons: {}, events: [], outbox: {}, proactive: { enabled: false, sources: [], maxActive: 3, maxCalls: 20, categories: [] }, inbox: {} });
  function ler() {
    if (!fs.existsSync(arquivo)) return vazio();
    // Corruption is not the same as a new project. Restoring is explicit.
    const s = JSON.parse(fs.readFileSync(arquivo, 'utf8'));
    if (s.schema !== 'nectar.store.v1' || s.workspaceId !== workspaceId || s.projectId !== projectId) throw new Error('data_isolation: store de outro workspace/projeto ou schema inválido');
    return s;
  }
  function transacao(fn) {
    fs.mkdirSync(path.dirname(arquivo), { recursive: true });
    let fd;
    try { fd = fs.openSync(lock, 'wx'); }
    catch (e) {
      if (e.code !== 'EEXIST') throw e;
      let pid;
      try { pid = JSON.parse(fs.readFileSync(lock, 'utf8')).pid; } catch { throw new Error('store_busy: lock incompleto; recuperação manual necessária'); }
      try { process.kill(pid, 0); throw new Error('store_busy: outro writer ativo'); }
      catch (x) { if (x.code !== 'ESRCH') throw x; }
      fs.unlinkSync(lock); fd = fs.openSync(lock, 'wx');
    }
    try {
      fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, em: relogio() })); fs.fsyncSync(fd);
      const s = ler(), pendentes = [];
      const evento = (type, payload = {}, ids = {}) => {
        const event = { schema: 'nectar.event.v1', schemaVersion: 1, eventId: randomUUID(), traceId: ids.traceId || ids.taskId || randomUUID(), correlationId: ids.correlationId || ids.taskId || projectId, workspaceId, projectId, occurredAt: new Date(relogio()).toISOString(), senderAgentId: 'system', type, payload, ...ids };
        event.idempotencyKey ||= event.eventId;
        s.events.push(event); s.outbox[event.eventId] = { event, delivered: false, attempts: 0 }; pendentes.push(event);
        return event;
      };
      const result = fn(s, evento);
      s.revision++; gravar(arquivo, s);
      // Publish after commit. On failure the outbox is kept for replay.
      for (const e of pendentes) { try { emitir({ tipo: 'teamwork', revision: s.revision, evento: e }); } catch { /* outbox stays pending */ } }
      return structuredClone(result ?? null);
    } finally { fs.closeSync(fd); fs.unlinkSync(lock); }
  }
  const snapshot = () => structuredClone(ler());
  function publicar(enviar = emitir) {
    const itens = Object.values(ler().outbox).filter(o => !o.delivered);
    for (const item of itens) {
      // The consumer dedupes eventId. A crash between send and ack may repeat it.
      enviar({ tipo: 'teamwork', evento: item.event });
      transacao(s => { const o = s.outbox[item.event.eventId]; o.delivered = true; o.attempts++; });
    }
    return itens.length;
  }
  return { transacao, snapshot, publicar, arquivo, workspaceId, projectId, agora: () => relogio(), iso: () => new Date(relogio()).toISOString() };
}
