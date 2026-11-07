const quantile=(xs,p)=>{const a=xs.filter(Number.isFinite).sort((a,b)=>a-b);return a.length?a[Math.max(0,Math.ceil(p*a.length)-1)]:null;};
export function calcularTeamwork(snapshot) {
  const {tasks=[],attempts=[],handoffs=[],events=[]}=snapshot;
  const done=tasks.filter(t=>t.status==='completed'),submitted=tasks.filter(t=>t.submissionCount>0);
  const ttvd=done.map(t=>Date.parse(t.completedAt)-Date.parse(t.createdAt));
  const calls=tasks.reduce((n,t)=>n+t.usage.calls,0),tokens=tasks.reduce((n,t)=>n+t.usage.tokens,0),knownCost=tasks.reduce((n,t)=>n+t.usage.cost,0);
  const completeCosts=tasks.length>0&&tasks.every(t=>!t.usage.missingModelCosts&&Number.isFinite(t.usage.toolCost)&&Number.isFinite(t.usage.hostCost));
  const fullCost=completeCosts?tasks.reduce((n,t)=>n+t.usage.cost+t.usage.toolCost+t.usage.hostCost,0):null;
  const waits=attempts.map(a=>{const t=tasks.find(t=>t.taskId===a.taskId);return t?Date.parse(a.startedAt)-Date.parse(t.createdAt):null;}).filter(Number.isFinite);
  const domains=tasks.reduce((n,t)=>n+(t.requiredDomains?.length||0),0),covered=tasks.reduce((n,t)=>n+(t.requiredDomains||[]).filter(d=>t.authority?.[d]?.outcome==='passed').length,0);
  return {schema:'nectar.metrics.v1',tasks:tasks.length,validatedDeliveries:done.length,completionRate:tasks.length?done.length/tasks.length:null,
    ttvdMs:{p50:quantile(ttvd,.5),p95:quantile(ttvd,.95),samples:ttvd.length},queueWaitMs:{p95:quantile(waits,.95),samples:waits.length},
    modelCalls:calls,tokens,knownModelCost:knownCost,costCoverage:completeCosts?'complete':'partial: tool/host costs and unreported model costs are not assumed zero',totalCost:fullCost,costPerValidatedDelivery:fullCost!==null&&done.length?fullCost/done.length:null,
    firstPassAcceptance:submitted.length?submitted.filter(t=>t.status==='completed'&&t.submissionCount===1).length/submitted.length:null,
    retryAmplification:tasks.length?Math.max(0,attempts.length-tasks.length)/tasks.length:null,
    handoffFailureRate:handoffs.length?handoffs.filter(h=>h.status!=='accepted').length/handoffs.length:null,
    informationCoverage:domains?covered/domains:null,
    humanInterventions:events.filter(e=>e.type==='needs_human_attention'||e.type==='approval.evaluate').length,
    incompleteTasks:tasks.filter(t=>t.status!=='completed').length,failures:attempts.filter(a=>['failed','timed_out'].includes(a.status)).length,
    methodology:'All tasks, including failed and unfinished tasks, remain in the denominator. No speedup inferred.'};
}
export function compararBenchmark(runs) {
  const workloads=[...new Set(runs.map(r=>r.workload))];
  return workloads.map(workload=>{const sample=runs.filter(r=>r.workload===workload),groups={};
    for(const variant of ['solo','nectar_baseline','teamwork']){const a=sample.filter(r=>r.variant===variant),done=a.filter(r=>r.validated);groups[variant]={runs:a.length,validated:done.length,ttvdMs:{p50:quantile(done.map(r=>r.ttvdMs),.5),p95:quantile(done.map(r=>r.ttvdMs),.95)},totalCost:a.every(r=>Number.isFinite(r.totalCost))?a.reduce((n,r)=>n+r.totalCost,0):null};}
    const pairs=new Map();for(const r of sample){const key=JSON.stringify([r.taskId,r.repeat??0,r.seed]);if(!pairs.has(key))pairs.set(key,[]);pairs.get(key).push(r);}
    const comparable=sample.length>0&&sample.every(r=>r.taskId&&r.mode==='real'&&r.acceptanceHash&&r.baselineCommit&&r.toolsHash&&r.budgetHash&&!r.securityIncident)&&[...pairs.values()].every(a=>a.length===3&&new Set(a.map(r=>r.variant)).size===3&&['acceptanceHash','baselineCommit','toolsHash','budgetHash','modelProfileHash'].every(k=>new Set(a.map(r=>r[k])).size===1));
    const distinctTasks=new Set(sample.map(r=>r.taskId).filter(Boolean)).size;
    const sufficient=comparable&&distinctTasks>=5&&Object.values(groups).every(g=>g.runs>=5&&g.validated===g.runs);
    return {workload,groups,distinctTasks,comparable,sufficient,promotion:sufficient&&groups.teamwork.ttvdMs.p50<groups.solo.ttvdMs.p50&&groups.teamwork.totalCost!=null&&groups.solo.totalCost!=null&&groups.teamwork.totalCost<=groups.solo.totalCost?'candidate_for_review':'insufficient_evidence',speedup:sufficient?groups.solo.ttvdMs.p50/groups.teamwork.ttvdMs.p50:null};});
}
