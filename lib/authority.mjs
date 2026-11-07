import { randomUUID } from 'node:crypto';
import { hashAcao } from './task-contract.mjs';

export const DOMAIN_ROLES={product:['lead'],api:['architect','backend','frontend','integracoes'],security:['seguranca'],data:['dados'],quality:['qa','revisor'],integration:['versionamento'],evidence:['qa_evidencias'],brand:['marca']};
export function criarAuthority(db,{papeis={},ids=new Set()}={}) {
  const resolve=r=>papeis[r]||r;
  const atores=dominio=>(DOMAIN_ROLES[dominio]||[]).map(resolve).filter(id=>ids.has(id));
  function revisar({taskId,executionId,domain,actor,outcome,evidence,reason}) {
    return db.transacao((s,ev)=>{const t=s.tasks[taskId];if(!t||t.result?.executionId!==executionId)throw new Error('stale_execution');if(!atores(domain).includes(actor)||actor===t.assigneeAgentId)throw new Error('permission_denied: autoridade de domínio independente');if(!['passed','failed','inconclusive'].includes(outcome)||!evidence?.length)throw new Error('evidence_missing');
      if(['completed','cancelled'].includes(t.status))throw new Error('new_defect_task_required');
      t.authority ||= {};t.authority[domain]={actor,outcome,evidence,reason,executionId,at:db.iso()};if(outcome!=='passed'&&['accepted','integrated'].includes(t.status))t.status='blocked';t.version++;ev('authority.review',{domain,actor,outcome},{taskId,executionId});return t;});
  }
  function aprovar({actor,tool,target,parameters,expiresAt,taskId,executionId}) {
    if(actor!=='user'||!tool||!target||!taskId||!executionId||!expiresAt||Date.parse(expiresAt)<=db.agora())throw new Error('approval_required');
    return db.transacao((s,ev)=>{const t=s.tasks[taskId];if(!t||!s.attempts[executionId]||s.attempts[executionId].taskId!==taskId)throw new Error('stale_execution');const action={workspaceId:db.workspaceId,projectId:db.projectId,taskId,executionId,tool,target,parameters};const a={approvalId:randomUUID(),actionHash:hashAcao(action),expiresAt,consumedAt:null};s.approvals[a.approvalId]=a;ev('approval.evaluate',{approvalId:a.approvalId,outcome:'approved'},{taskId,executionId});return a;});
  }
  function consumir(id,action) {
    return db.transacao((s,ev)=>{const a=s.approvals[id];if(!a||a.consumedAt||Date.parse(a.expiresAt)<=db.agora()||a.actionHash!==hashAcao({...action,workspaceId:db.workspaceId,projectId:db.projectId}))throw new Error('approval_replay_or_mismatch');a.consumedAt=db.iso();ev('approval.consumed',{approvalId:id},{taskId:action.taskId,executionId:action.executionId});return a;});
  }
  function podeAceitar(t) {const required=t.requiredDomains||[];return required.every(d=>t.authority?.[d]?.outcome==='passed'&&t.authority[d].executionId===t.result?.executionId);}
  function licao({actor,scope,source,evidence,lesson,reviewer}) {
    if(!source||!evidence?.length||!scope||!lesson||!reviewer||reviewer===actor||!ids.has(reviewer))throw new Error('lesson_requires_independent_review');
    return db.transacao((s,ev)=>{const id=randomUUID(),l={id,workspaceId:db.workspaceId,projectId:db.projectId,source,evidence,scope,lesson,actor,reviewer,version:1,confidence:'reviewed',timestamp:db.iso(),accessPolicy:'project'};s.lessons[id]=l;ev('lesson.accepted',{lessonId:id});return l;});
  }
  return {atores,revisar,aprovar,consumir,podeAceitar,licao};
}
