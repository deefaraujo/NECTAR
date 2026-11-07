import { hashAcao } from './task-contract.mjs';

export function criarProactivity(db) {
  function configurar(config,actor='user') {
    if(actor!=='user')throw new Error('permission_denied: só a pessoa altera política');
    const {enabled,sources,categories,maxActive,maxCalls,quietHours,timeZone,days}=config;
    if(typeof enabled!=='boolean'||!Array.isArray(sources)||!Array.isArray(categories)||!Number.isInteger(maxActive)||maxActive<1||!Number.isInteger(maxCalls)||maxCalls<1)throw new Error('proactive_policy_invalid');
    new Intl.DateTimeFormat('en',{timeZone:timeZone||'America/Sao_Paulo'}).format();
    return db.transacao((s,ev)=>{s.proactive={enabled,sources,categories,maxActive,maxCalls,quietHours:quietHours||null,timeZone:timeZone||'America/Sao_Paulo',days:days||[0,1,2,3,4,5,6]};ev('proactivity.policy',{enabled});return s.proactive;});
  }
  function receber({eventId,source,category,payload,workspaceId,projectId,occurredAt}) {
    if(workspaceId!==db.workspaceId||projectId!==db.projectId)throw new Error('data_isolation');
    if(!eventId||!source||!category||!Number.isFinite(Date.parse(occurredAt)))throw new Error('event_invalid');
    return db.transacao((s,ev)=>{const key=hashAcao({workspaceId,projectId,eventId,source});if(s.inbox[key])return s.inbox[key];const e={key,eventId,source,category,payload,occurredAt,trust:'untrusted_external_content',status:'pending',attempts:0,createdAt:db.iso(),taskId:null};s.inbox[key]=e;ev('event.received',{key,source,category});return e;});
  }
  function admitir(key,{manual=false}={}) {
    return db.transacao((s,ev)=>{const e=s.inbox[key],p=s.proactive;if(!e)throw new Error('event_unknown');if(e.status==='accepted')return e;
      if(!manual&&!p.enabled)throw new Error('proactivity_off');if(!p.sources.includes(e.source)||!p.categories.includes(e.category))throw new Error('source_not_authorized');
      if(!manual){const d=new Date(db.agora());const local=new Intl.DateTimeFormat('en-US',{timeZone:p.timeZone,hourCycle:'h23',hour:'2-digit',minute:'2-digit',weekday:'short'}).formatToParts(d);const v=k=>local.find(x=>x.type===k)?.value;const minute=Number(v('hour'))*60+Number(v('minute'));const day=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].indexOf(v('weekday'));if(!p.days.includes(day))throw new Error('quiet_hours');if(p.quietHours){const [start,end]=p.quietHours.map(x=>{const[h,m]=x.split(':').map(Number);return h*60+m;});if(start<=end?minute>=start&&minute<end:minute>=start||minute<end)throw new Error('quiet_hours');}}
      const active=Object.values(s.inbox).filter(i=>i.status==='processing').length;if(active>=p.maxActive)throw new Error('wip_limit');e.status='processing';e.attempts++;e.leaseUntil=new Date(db.agora()+120000).toISOString();ev('event.admitted',{key});return e;});
  }
  function confirmar(key,taskId) {return db.transacao((s,ev)=>{const e=s.inbox[key];if(!e||!s.tasks[taskId])throw new Error('broker_acceptance_required');if(e.taskId&&e.taskId!==taskId)throw new Error('idempotency_conflict');e.status='accepted';e.taskId=taskId;ev('event.accepted',{key},{taskId});return e;});}
  function falhar(key,error) {return db.transacao((s,ev)=>{const e=s.inbox[key];if(!e)throw new Error('event_unknown');if(e.status==='accepted')return e;e.status=e.attempts>=3?'blocked':'pending';e.error=String(error).slice(0,300);e.nextAttemptAt=new Date(db.agora()+Math.min(3600000,1000*2**e.attempts)).toISOString();ev('event.retry',{key,status:e.status});return e;});}
  function recuperar(){return db.transacao(s=>{let n=0;for(const e of Object.values(s.inbox))if(e.status==='processing'&&Date.parse(e.leaseUntil)<=db.agora()){e.status='pending';n++;}return n;});}
  return {configurar,receber,admitir,confirmar,falhar,recuperar};
}
