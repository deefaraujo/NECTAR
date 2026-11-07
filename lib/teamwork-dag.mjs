import { randomUUID } from 'node:crypto';
import { hashAcao } from './task-contract.mjs';

export function validarDAG(nodes,{maxDepth=20,maxNodes=60,ids=null,maxCalls=120,capabilities=null}={}) {
  if(!Array.isArray(nodes)||!nodes.length||nodes.length>maxNodes)throw new Error('plan_incomplete');
  const map=new Map(nodes.map(n=>[n.id,n]));if(map.size!==nodes.length)throw new Error('duplicate_node');
  let calls=0;const visiting=new Set(),visited=new Map();
  function visit(id){if(visiting.has(id))throw new Error('dependency_cycle');if(visited.has(id))return visited.get(id);const n=map.get(id);if(!n||!n.id||!n.agent||!n.outputType||ids&&!ids.has(n.agent))throw new Error('wrong_assignee_or_missing_node');visiting.add(id);let depth=1;
    for(const dep of n.dependsOn||[]){const p=map.get(dep);if(!p)throw new Error('missing_dependency');if(n.inputTypes?.[dep]&&n.inputTypes[dep]!==p.outputType)throw new Error('input_type_mismatch');depth=Math.max(depth,1+visit(dep));}
    visiting.delete(id);if(depth>maxDepth)throw new Error('delegation_depth_exceeded');visited.set(id,depth);return depth;}
  for(const n of nodes){if(capabilities&&!capabilities[n.agent]?.includes(n.outputType))throw new Error('wrong_assignee: expertise incompatível com a saída');if(!Number.isInteger(n.maxCalls)||n.maxCalls<1)throw new Error('budget_required');calls+=n.maxCalls;visit(n.id);}
  if(calls>maxCalls)throw new Error('out_of_budget');return {depth:Math.max(...visited.values()),calls};
}
export function selecionarEstrategia(profile,{isolatedWritesEnabled=false,explicit=null}={}) {
  let strategy='solo',reason='escopo delimitado; bootstrap conservador';
  if(profile.securityRisk==='critical'){strategy='super_team';reason='risco crítico exige revisão de domínio';}
  else if(profile.sharedWriteRisk&&!isolatedWritesEnabled){strategy='pair';reason='escrita compartilhada sem isolamento; serializar';}
  else if(profile.independentSubtasks>=2&&profile.integrationCost<=profile.parallelBenefit){strategy='parallel';reason='subtarefas independentes; benefício estimado supera integração';}
  else if(profile.domainCount>=3&&profile.dependencies>1){strategy='super_team';reason='dependências entre múltiplos domínios';}
  else if(profile.domainCount>1||profile.reviewRequired){strategy='pair';reason='revisão independente necessária';}
  if(explicit){if(!['solo','pair','parallel','super_team'].includes(explicit))throw new Error('strategy inválida');if(explicit==='parallel'&&profile.sharedWriteRisk&&!isolatedWritesEnabled)throw new Error('isolated_writes_required');if(profile.securityRisk!=='critical')strategy=explicit;}
  return {strategy,reason,profile,policyVersion:'bootstrap-v1',calibrated:false};
}
export function criarPlanLedger(db,{ids,capabilities=null}) {
  const salvar=(nodes,goalId,version=1,previous=null)=>db.transacao((s,ev)=>{validarDAG(nodes,{ids,capabilities});const plan={planId:randomUUID(),goalId,version,previous,nodes,createdAt:db.iso(),workspaceId:db.workspaceId,projectId:db.projectId};s.plans[plan.planId]=plan;ev('plan.validate',{planId:plan.planId,version});return plan;});
  function replanejar(id,nodes,expectedVersion){const old=db.snapshot().plans[id];if(!old||old.version!==expectedVersion)throw new Error('version_conflict');return salvar(nodes,old.goalId,old.version+1,id);}
  function executaveis(id){const s=db.snapshot(),p=s.plans[id];if(!p)throw new Error('plan desconhecido');return p.nodes.filter(n=>{const own=Object.values(s.tasks).find(t=>t.planId===id&&t.nodeId===n.id);if(own&&!['draft','ready','queued'].includes(own.status))return false;return !(n.dependsOn||[]).some(dep=>{const task=Object.values(s.tasks).find(t=>t.planId===id&&t.nodeId===dep);return task?.status!=='completed';});});}
  function reaproveitaveis(oldId,newId){const s=db.snapshot(),old=s.plans[oldId],next=s.plans[newId];if(!old||!next)throw new Error('plan desconhecido');return next.nodes.filter(n=>old.nodes.some(o=>o.id===n.id&&hashAcao(o)===hashAcao(n))&&Object.values(s.tasks).some(t=>t.planId===oldId&&t.nodeId===n.id&&t.status==='completed')).map(n=>n.id);}
  return {criar:(nodes,goalId)=>salvar(nodes,goalId),replanejar,executaveis,reaproveitaveis};
}
const node=(id,agent,outputType,dependsOn=[],required=true)=>({id,agent,outputType,dependsOn,required,maxCalls:4});
export const REVIEW_DAG=[node('knowledge','conhecimento','KnowledgeContextPackage'),node('evidence','coletor','EvidenceCollection'),node('activity','progresso','ActivityProgressReport'),node('contribution','contribuicao','ContributionReport'),node('project_analysis','projetos','ProjectAnalysis',['knowledge','evidence','activity','contribution']),node('risk','riscos','RiskAndNextStepsReport',['project_analysis']),node('reporting','relatorios','ExecutiveReport',['evidence','project_analysis','risk']),node('evidence_gate','qa_evidencias','EvidenceQAResult',['reporting']),node('narrative','narrativa','ExecutiveNarrative',['reporting','evidence_gate']),node('slide_plan','arquitetura_slides','PresentationBlueprint',['narrative']),node('slides','design_slides','PresentationArtifact',['slide_plan']),node('brand_gate','marca','BrandComplianceReport',['slides']),node('meeting','reunioes','MeetingPreparationPackage',['brand_gate','evidence_gate']),node('speaking','comunicacao','SpeakingPreparation',['meeting'])];
export const SOFTWARE_DAG=[node('contract','architect','APIContract'),node('interaction','ui','InteractionSpec'),node('backend','backend','BackendImplementationArtifact',['contract']),node('frontend','frontend','FrontendImplementationArtifact',['contract','interaction']),node('qa','qa','IntegrationEvidence',['backend','frontend']),node('review','revisor','ReviewResult',['qa']),node('integration','versionamento','IntegratedCommit',['review']),node('acceptance','po','AcceptanceResult',['integration'])];
