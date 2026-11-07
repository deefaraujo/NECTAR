import { criarTeamworkStore } from './teamwork-store.mjs';
import { criarTaskBroker } from './task-contract.mjs';
import { criarArtifactRegistry } from './artifacts.mjs';
import { criarAuthority } from './authority.mjs';
import { criarPlanLedger } from './teamwork-dag.mjs';
import { criarLeadership } from './leadership.mjs';
import { criarProactivity } from './proactivity.mjs';
import { calcularTeamwork } from './teamwork-metrics.mjs';
import { validarSaidaEspecializada, capabilitiesDoTemplate } from './role-contracts.mjs';

export function criarTeamwork({pasta,workspaceId,projectId,readPaths=[],papeis,ids,emitir,relogio,templateId=null}) {
  const db=criarTeamworkStore({pasta,workspaceId,projectId,emitir,relogio});
  const tasks=criarTaskBroker(db),artifacts=criarArtifactRegistry(db,{pasta,readPaths});
  const authority=criarAuthority(db,{papeis,ids});
  const plans=criarPlanLedger(db,{ids,capabilities:templateId?capabilitiesDoTemplate(templateId,ids,papeis):null});
  function ativarPlano(planId,{quadro,scope,goalId,actor='user'}={}) {
    if(actor!=='user'&&actor!==papeis?.lead)throw new Error('permission_denied');
    const p=db.snapshot().plans[planId];if(!p)throw new Error('plan desconhecido');
    db.transacao(s=>{s.plans[planId].activation={status:'activating',at:db.iso()};});
    const linked=new Map(),pending=[...p.nodes];
    while(pending.length){const index=pending.findIndex(n=>(n.dependsOn||[]).every(id=>linked.has(id)));if(index<0)throw new Error('dependency_cycle');const[n]=pending.splice(index,1);
      const t=tasks.criar({idempotencyKey:`plan:${planId}:${n.id}`,goalId:goalId||p.goalId,planId,nodeId:n.id,planVersion:p.version,requesterAgentId:actor,assigneeAgentId:n.agent,requiredCapability:n.outputType,objective:n.objective||`${n.id}: produzir ${n.outputType} para o objetivo ${p.goalId}`,inputArtifactRefs:[],dependencyTaskIds:(n.dependsOn||[]).map(id=>linked.get(id).taskId),expectedOutput:{type:n.outputType},acceptanceCriteria:n.acceptanceCriteria||[`${n.outputType} existe e foi conferido com fontes e limitações explícitas`],scope,permissions:n.permissions||['project.read','code.read','artifact.create','code.write.scoped','tests.execute'],tools:['Read','Grep','Glob','Edit','Write'],budget:{maxModelCalls:n.maxCalls},requiredGates:['BackendImplementationArtifact','FrontendImplementationArtifact','PresentationArtifact'].includes(n.outputType)?['evidence','review','qa']:['evidence','review']});
      const created=quadro.criar({chave:`teamwork-${planId}-${n.id}`,taskContractId:t.taskId,teamworkPlanId:planId,titulo:n.objective||`${n.id}: ${n.outputType}`,descricao:`Objetivo: ${p.goalId}\nSaída tipada: ${n.outputType}\nContrato: ${t.taskId}`,dono:n.agent,aceite:t.acceptanceCriteria,dependeDe:(n.dependsOn||[]).map(id=>linked.get(id).cardId),coluna:(n.dependsOn||[]).length?'backlog':'pronto'},actor==='user'?'voce':actor);
      if(!created.ok)throw new Error(created.erro);linked.set(n.id,{taskId:t.taskId,cardId:created.card.id});
      db.transacao(s=>{const task=s.tasks[t.taskId];task.cardId=created.card.id;s.plans[planId].bindings ||= {};s.plans[planId].bindings[n.id]={taskId:t.taskId,cardId:created.card.id};});
    }
    return db.transacao((s,ev)=>{s.plans[planId].activation={status:'active',at:db.iso()};ev('plan.activated',{planId});return s.plans[planId];});
  }
  function gate(id,version,dados){
    const allowed=dados.name==='evidence'?['system','user']:dados.name==='qa'?['user',papeis?.qa].filter(Boolean):['user',papeis?.revisor||papeis?.qa].filter(Boolean);
    if(!allowed.includes(dados.actor))throw new Error('permission_denied: ator sem competência para esse gate');
    for(const ref of dados.evidence||[])artifacts.verificar(ref);
    return tasks.gate(id,version,dados);
  }
  function validarResultado(t){
    validarSaidaEspecializada(t.expectedOutput.type,t.result.payload);
    for(const ref of t.result.artifacts){const a=artifacts.verificar(ref);if(a.taskId!==t.taskId||a.executionId!==t.result.executionId)throw new Error('artifact_provenance_mismatch');}
    for(const ref of t.result.evidence){const a=artifacts.verificar(ref);if(a.taskId!==t.taskId&&!t.inputArtifactRefs.includes(ref)&&!t.dependencyTaskIds.includes(a.taskId))throw new Error('evidence_provenance_mismatch');}
  }
  function aceitar(id,version){const t=tasks.obter(id);if(!t?.result)throw new Error('evidence_missing');validarResultado(t);if(!authority.podeAceitar(t))throw new Error('domain_gate_failed');return tasks.aceitar(id,version);}
  function concluir(id,version){const t=tasks.obter(id);if(!t?.result)throw new Error('evidence_missing');validarResultado(t);if(!authority.podeAceitar(t))throw new Error('domain_gate_failed');return tasks.concluir(id,version);}
  const snapshot=()=>{const s=db.snapshot();return {schema:s.schema,workspaceId,projectId,revision:s.revision,tasks:Object.values(s.tasks),attempts:Object.values(s.attempts),artifacts:Object.values(s.artifacts),handoffs:Object.values(s.handoffs),plans:Object.values(s.plans),leadership:Object.values(s.leadership),events:s.events.slice(-200),proactive:s.proactive,pendingEvents:Object.values(s.inbox).filter(e=>e.status!=='accepted').map(({payload,...e})=>e)};};
  return {db,tasks:{...tasks,gate,aceitar,concluir},artifacts,authority,plans,ativarPlano,leadership:criarLeadership(db),proactivity:criarProactivity(db),snapshot,metrics:()=>calcularTeamwork(snapshot())};
}
