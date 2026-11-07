import { randomUUID, createHash } from 'node:crypto';

export const TASK_STATES = ['draft','ready','queued','running','submitted','verifying','accepted','integrated','completed','waiting_dependency','waiting_clarification','waiting_approval','blocked','failed','cancelled'];
const TRANSITIONS = {
  draft:['ready','cancelled'], ready:['queued','waiting_dependency','blocked','cancelled'], queued:['running','blocked','cancelled'],
  running:['submitted','failed','blocked','waiting_dependency','waiting_clarification','waiting_approval','cancelled'],
  submitted:['verifying','blocked','cancelled'], verifying:['accepted','ready','blocked','failed','cancelled'],
  accepted:['integrated','completed','ready','blocked'], integrated:['completed','ready','blocked'],
  waiting_dependency:['ready','cancelled'], waiting_clarification:['ready','cancelled'], waiting_approval:['ready','cancelled'],
  blocked:['ready','cancelled'], failed:['ready','cancelled'], cancelled:[], completed:[],
};
export function validarTask(t) {
  if (t.schema !== 'nectar.task.v1') throw new Error('task schema inválido');
  for (const k of ['taskId','goalId','workspaceId','projectId','requesterAgentId','assigneeAgentId','requiredCapability','objective']) if (typeof t[k] !== 'string' || !t[k].trim()) throw new Error(`task: ${k} obrigatório`);
  for (const k of ['inputArtifactRefs','dependencyTaskIds','acceptanceCriteria','tools','permissions','requiredEvidence']) if (!Array.isArray(t[k])) throw new Error(`task: ${k} deve ser lista`);
  if (!t.acceptanceCriteria.length || !t.acceptanceCriteria.every(x => typeof x === 'string' && x.trim())) throw new Error('task: aceite obrigatório');
  if (!t.scope || !['readPaths','writePaths','denyPaths'].every(k => Array.isArray(t.scope[k]))) throw new Error('task: escopo inválido');
  if (!t.expectedOutput?.type || !TASK_STATES.includes(t.status) || !Number.isInteger(t.version) || t.version < 1 || !Number.isInteger(t.planVersion) || t.planVersion < 1) throw new Error('task: saída, estado ou versão inválida');
  if (!['low','medium','high','critical'].includes(t.risk) || !Number.isInteger(t.budget?.maxModelCalls) || t.budget.maxModelCalls < 1) throw new Error('task: risco ou budget inválido');
  return t;
}
const get = (s,id) => { const t=s.tasks[id]; if(!t) throw new Error('task desconhecida'); return t; };
const cas = (t,v) => { if (!Number.isInteger(v) || t.version !== v) throw new Error('version_conflict: versão esperada divergente'); };
export function criarTaskBroker(db) {
  function criar(dados) {
    return db.transacao((s,ev) => {
      if (!dados.idempotencyKey) throw new Error('idempotencyKey obrigatório');
      const antiga=Object.values(s.tasks).find(t => t.idempotencyKey === dados.idempotencyKey);
      if(antiga) return antiga;
      const t=validarTask({ schema:'nectar.task.v1', taskId:randomUUID(), goalId:dados.goalId || randomUUID(), planVersion:1,
        requesterAgentId:'user', inputArtifactRefs:[], dependencyTaskIds:[], tools:[], permissions:['project.read'], requiredEvidence:[], risk:'low',
        scope:{readPaths:[],writePaths:[],denyPaths:[]}, expectedOutput:{type:'report'}, budget:{maxModelCalls:4}, status:'draft',version:1,
        ...dados,workspaceId:db.workspaceId,projectId:db.projectId, createdAt:db.iso(), updatedAt:db.iso(), usage:{calls:0,tokens:0,cost:0}, gates:{}, requiredGates:dados.requiredGates || ['evidence','review'], attemptIds:[], submissionCount:0 });
      if(s.tasks[t.taskId]) throw new Error('task id já existe');
      for(const id of t.dependencyTaskIds) get(s,id);
      s.tasks[t.taskId]=t; ev('task.propose',{status:t.status},{taskId:t.taskId,initiativeId:t.initiativeId,correlationId:t.goalId}); return t;
    });
  }
  function transicionar(id,status,version,{actor='system',executionId=null}={}) {
    return db.transacao((s,ev) => {
      const t=get(s,id); cas(t,version);
      if(!(TRANSITIONS[t.status] || []).includes(status)) throw new Error(`invalid_transition: ${t.status} -> ${status}`);
      if(['ready','queued','running'].includes(status) && t.dependencyTaskIds.some(id => get(s,id).status !== 'completed')) throw new Error('waiting_dependency');
      if(status==='running') throw new Error('task.claim é obrigatório para iniciar');
      if(['submitted','accepted','integrated','completed'].includes(status)) throw new Error('gate_required: use operação de domínio');
      t.status=status;t.version++;t.updatedAt=db.iso();ev('task.transition',{status,actor},{taskId:id,executionId});return t;
    });
  }
  function claim(id,version,actor,{leaseMs=120000}={}) {
    return db.transacao((s,ev) => {
      const t=get(s,id);cas(t,version);
      if(t.assigneeAgentId!==actor)throw new Error('permission_denied: dono diferente');
      if(!['ready','queued'].includes(t.status))throw new Error('task não executável');
      if(t.dependencyTaskIds.some(id=>get(s,id).status!=='completed'))throw new Error('waiting_dependency');
      t.inputArtifactRefs=[...new Set([...t.inputArtifactRefs,...t.dependencyTaskIds.flatMap(id=>get(s,id).result?.artifacts||[])])];
      if(t.usage.calls>=t.budget.maxModelCalls)throw new Error('out_of_budget');
      const active=Object.values(s.attempts).find(a=>a.agentId===actor && a.status==='executing' && Date.parse(a.leaseUntil)>db.agora());
      if(active)throw new Error('agent_busy');
      const a={executionId:randomUUID(),taskId:id,agentId:actor,status:'executing',startedAt:db.iso(),leaseUntil:new Date(db.agora()+leaseMs).toISOString(),calls:0};
      s.attempts[a.executionId]=a;t.attemptIds.push(a.executionId);t.status='running';t.version++;t.updatedAt=db.iso();ev('task.claim',{}, {taskId:id,executionId:a.executionId});return {task:t,attempt:a};
    });
  }
  function heartbeat(executionId,actor,leaseMs=120000) {
    return db.transacao(s=>{const a=s.attempts[executionId];if(!a||a.agentId!==actor||a.status!=='executing'||Date.parse(a.leaseUntil)<=db.agora())throw new Error('lease_expired');a.leaseUntil=new Date(db.agora()+leaseMs).toISOString();return a;});
  }
  function chamada(executionId,{tokens=0,cost=null,settle=false,toolCost=null,hostCost=null}={}) {
    return db.transacao((s,ev)=>{const a=s.attempts[executionId];if(!a||a.status!=='executing'||Date.parse(a.leaseUntil)<=db.agora())throw new Error('lease_expired');const t=get(s,a.taskId);
      const peers=Object.values(s.tasks).filter(x=>x.goalId===t.goalId);
      const goalCalls=peers.reduce((n,x)=>n+x.usage.calls,0);
      if(!settle){if(t.usage.calls>=t.budget.maxModelCalls || goalCalls>=(t.goalBudget?.maxModelCalls||120) || t.budget.maxTokens!=null && t.usage.tokens>=t.budget.maxTokens || t.budget.maxCost!=null && t.usage.cost>=t.budget.maxCost)throw new Error('out_of_budget');t.usage.calls++;a.calls++;}
      if(!Number.isFinite(tokens)||tokens<0||cost!==null&&(!Number.isFinite(cost)||cost<0))throw new Error('usage inválido');
      t.usage.tokens+=tokens;if(cost!==null)t.usage.cost+=cost;if(settle&&cost===null)t.usage.missingModelCosts=(t.usage.missingModelCosts||0)+1;
      if(toolCost!==null){if(!Number.isFinite(toolCost)||toolCost<0)throw new Error('usage inválido');t.usage.toolCost=(t.usage.toolCost||0)+toolCost;}
      if(hostCost!==null){if(!Number.isFinite(hostCost)||hostCost<0)throw new Error('usage inválido');t.usage.hostCost=(t.usage.hostCost||0)+hostCost;}
      ev('cost.record',{tokens,cost,toolCost,hostCost,calls:t.usage.calls},{taskId:t.taskId,executionId});return t.usage;});
  }
  function resultado(executionId,actor,{artifacts=[],evidence=[],payload=null,error=null}={}) {
    return db.transacao((s,ev)=>{const a=s.attempts[executionId];if(!a||a.agentId!==actor||a.status!=='executing'||Date.parse(a.leaseUntil)<=db.agora())throw new Error('stale_execution');const t=get(s,a.taskId);
      if(t.status!=='running')throw new Error('stale_execution');
      a.status=error?'failed':'succeeded';a.finishedAt=db.iso();a.error=error;t.status=error?'failed':'submitted';t.version++;t.updatedAt=db.iso();t.submissionCount++;
      t.result={executionId,artifacts,evidence,payload,error};t.gates={};if(error)t.failure={taskId:t.taskId,executionId,class:/permission_denied|out_of_budget|evidence_missing|timeout|context_missing|tool_unavailable/.exec(String(error))?.[0]||'unknown',retryable:!t.externalEffects,attempt:t.attemptIds.length,evidence:String(error),repair:'Verificar causa e checkpoint antes de retomar',decisionOwner:t.requesterAgentId};ev('task.submit_result',{status:t.status,error},{taskId:t.taskId,executionId});return t;});
  }
  function gate(id,version,{name,actor,outcome,evidence=[],executionId,reason=''}) {
    return db.transacao((s,ev)=>{const t=get(s,id);cas(t,version);
      if(!['submitted','verifying'].includes(t.status)||executionId!==t.result?.executionId)throw new Error('stale_execution');
      if(actor===t.assigneeAgentId||!actor||actor==='system'&&name!=='evidence')throw new Error('permission_denied: gate independente obrigatório');
      if(!t.requiredGates.includes(name)||!['passed','failed','inconclusive'].includes(outcome))throw new Error('gate inválido');
      if(outcome==='passed'&&!evidence.length)throw new Error('evidence_missing');
      t.gates[name]={actor,outcome,evidence,executionId,reason,at:db.iso()};t.status='verifying';t.version++;ev('gate.verify',{name,outcome},{taskId:id,executionId});return t;});
  }
  function aceitar(id,version) {
    return db.transacao((s,ev)=>{const t=get(s,id);cas(t,version);
      if(t.status!=='verifying'||t.requiredGates.some(k=>t.gates[k]?.outcome!=='passed'))throw new Error('quality_gate_failed');
      if(!t.result?.artifacts.length || !t.result?.evidence.length)throw new Error('evidence_missing');
      t.status='accepted';t.version++;t.acceptedAt=db.iso();ev('task.accept_result',{}, {taskId:id,executionId:t.result.executionId});return t;});
  }
  function integrar(id,version,{commit,target,evidence=[],actor}) {
    return db.transacao((s,ev)=>{const t=get(s,id);cas(t,version);if(t.status!=='accepted'||!commit||!target||!evidence.length||!actor)throw new Error('integration_gate_failed');t.integration={commit,target,evidence,actor};t.status='integrated';t.version++;ev('merge.integrate',{commit,target},{taskId:id,executionId:t.result.executionId});return t;});
  }
  function concluir(id,version) {
    return db.transacao((s,ev)=>{const t=get(s,id);cas(t,version);if(!['accepted','integrated'].includes(t.status)||t.integrationRequired&&!t.integration||t.requiredGates.some(k=>t.gates[k]?.outcome!=='passed')||t.dependencyTaskIds.some(id=>get(s,id).status!=='completed'))throw new Error('quality_gate_failed');t.status='completed';t.completedAt=db.iso();t.updatedAt=db.iso();t.version++;ev('task.complete',{}, {taskId:id,executionId:t.result.executionId});return t;});
  }
  // An "executando" attempt whose process no longer exists (app reopened, or a call that died without closing the attempt) becomes timed_out
  // and the task becomes executable again. Without this the agent stayed "busy" until the lease expired (31 min) and every new call of it
  // failed with agent_busy. `vivos` = executionIds this process is actually running; `forcar` = none (just opened).
  function liberar({actor=null,vivos=[],forcar=false}={}) {
    const vivo=new Set(vivos);
    return db.transacao((s,ev)=>{let n=0;for(const a of Object.values(s.attempts)){if(a.status!=='executing')continue;if(actor&&a.agentId!==actor)continue;if(!forcar&&(vivo.has(a.executionId)||Date.parse(a.leaseUntil)<=db.agora()))continue;
      a.status='timed_out';a.finishedAt=db.iso();a.error='processo encerrado sem fechar a tentativa';const t=get(s,a.taskId);
      if(t.status==='running'){t.status='ready';t.version++;t.updatedAt=db.iso();}ev('task.release',{actor:a.agentId},{taskId:t.taskId,executionId:a.executionId});n++;}return n;});
  }
  function recuperar() {
    return db.transacao((s,ev)=>{let n=0;for(const a of Object.values(s.attempts)){if(a.status!=='executing'||Date.parse(a.leaseUntil)>db.agora())continue;a.status='timed_out';a.finishedAt=db.iso();const t=get(s,a.taskId);if(t.status==='running'){t.status='blocked';t.version++;t.failure={class:'timeout',retryable:!t.externalEffects,executionId:a.executionId,repair:'verificar checkpoint e efeitos antes de retomar'};}ev('needs_human_attention',t.failure,{taskId:t.taskId,executionId:a.executionId});n++;}return n;});
  }
  function grant(executionId) {const s=db.snapshot(),a=s.attempts[executionId];if(!a||a.status!=='executing'||Date.parse(a.leaseUntil)<=db.agora())throw new Error('lease_expired');const t=get(s,a.taskId);return {schema:'nectar.capability-grant.v1',grantId:randomUUID(),workspaceId:db.workspaceId,projectId:db.projectId,taskId:t.taskId,executionId,subject:a.agentId,permissions:t.permissions,readPaths:t.scope.readPaths,writePaths:t.scope.writePaths,denyPaths:t.scope.denyPaths,expiresAt:a.leaseUntil,network:'deny',policyVersion:'v1'};}
  return {criar,transicionar,claim,heartbeat,chamada,resultado,gate,aceitar,integrar,concluir,recuperar,liberar,grant,obter:id=>db.snapshot().tasks[id]||null,listar:()=>Object.values(db.snapshot().tasks)};
}
// Canonicalization for approval signatures, independent of key order.
export const canonico = x => Array.isArray(x)?`[${x.map(canonico).join(',')}]`:x&&typeof x==='object'?`{${Object.keys(x).sort().map(k=>`${JSON.stringify(k)}:${canonico(x[k])}`).join(',')}}`:JSON.stringify(x);
export const hashAcao = x => createHash('sha256').update(canonico(x)).digest('hex');
