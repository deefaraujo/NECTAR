import { randomUUID } from 'node:crypto';

export function criarLeadership(db) {
  function solicitar({from,to,scope,dueAt,requiredEvidence=[],maxFollowups=2,idempotencyKey}) {
    if(!from||!to||from===to||!scope||!Number.isFinite(Date.parse(dueAt))||!idempotencyKey||!Number.isInteger(maxFollowups)||maxFollowups<0||maxFollowups>5)throw new Error('leadership_request_invalid');
    return db.transacao((s,ev)=>{const old=Object.values(s.leadership).find(r=>r.idempotencyKey===idempotencyKey);if(old)return old;const r={requestId:randomUUID(),workspaceId:db.workspaceId,projectId:db.projectId,from,to,scope,dueAt,requiredEvidence,maxFollowups,followups:0,responseRequired:true,status:'waiting_clarification',requestedAt:db.iso(),requestedDeadline:null,estimatedDeadline:null,agreedDeadline:null,verifiedCompletedAt:null,idempotencyKey};s.leadership[r.requestId]=r;ev('leadership.request',{requestId:r.requestId,to,dueAt});return r;});
  }
  function responder(id,actor,{progress,estimate=null,confidence='unknown',blockers=[],evidence=[],commitmentAccepted=false,agreedDeadline=null,requestedDeadline=null}) {
    return db.transacao((s,ev)=>{const r=s.leadership[id];if(!r||r.to!==actor)throw new Error('permission_denied');if(!progress||!evidence.length)throw new Error('evidence_missing');if(commitmentAccepted&&(!agreedDeadline||!Number.isFinite(Date.parse(agreedDeadline))))throw new Error('commitment_invalid');r.response={progress,confidence,blockers,evidence,actor,at:db.iso()};r.requestedDeadline=requestedDeadline;r.estimatedDeadline=estimate;r.agreedDeadline=commitmentAccepted?agreedDeadline:null;r.status='answered';ev('leadership.response',{requestId:id,commitmentAccepted});return r;});
  }
  function followup(id,actor) {
    return db.transacao((s,ev)=>{const r=s.leadership[id];if(!r||r.from!==actor)throw new Error('permission_denied');if(r.status==='answered'||db.agora()<Date.parse(r.dueAt))return {sent:false,status:r.status};if(r.followups>=r.maxFollowups){r.status='unconfirmed';return {sent:false,status:'unconfirmed'};}r.followups++;r.status='unconfirmed';r.dueAt=new Date(db.agora()+3600000).toISOString();ev('leadership.followup',{requestId:id,followups:r.followups});return {sent:true,status:r.status};});
  }
  return {solicitar,responder,followup,listar:()=>Object.values(db.snapshot().leadership)};
}
