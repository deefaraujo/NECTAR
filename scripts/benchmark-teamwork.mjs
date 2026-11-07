// Comparação reproduzível. Adapters são programas auditados do operador;
// aceitação roda fora do adapter e nunca depende de "o modelo disse que passou".
import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import {spawnSync,execFileSync} from 'node:child_process';import {createHash} from 'node:crypto';
import {compararBenchmark} from '../lib/teamwork-metrics.mjs';
const args=process.argv.slice(2),manifestPath=args[args.indexOf('--manifest')+1];
if(!args.includes('--manifest')||!manifestPath)throw new Error('Informe --manifest arquivo.json; acrescente --run para executar.');
const manifest=JSON.parse(fs.readFileSync(path.resolve(manifestPath),'utf8'));
const variants=['solo','nectar_baseline','teamwork'],workloads=['bug','backend','fullstack','refactor','external_integration','professional_review'];
const hash=x=>createHash('sha256').update(typeof x==='string'?x:JSON.stringify(x)).digest('hex');
if(manifest.schema!=='nectar.benchmark.v1'||!['stub','real'].includes(manifest.mode)||!Number.isInteger(manifest.seed)||!Number.isInteger(manifest.repeats)||manifest.repeats<1||!manifest.tasks?.length)throw new Error('Manifest inválido');
const seen=new Set();
for(const t of manifest.tasks){if(!t.id||seen.has(t.id)||!workloads.includes(t.workload)||!t.repository||!t.baselineCommit||!t.acceptance?.argv?.length||!path.isAbsolute(t.acceptance.argv[0])||!t.budget||!t.tools||!variants.every(v=>t.adapters?.[v]?.argv?.length))throw new Error('Caso incompleto ou ID duplicado');seen.add(t.id);}
const fullCoverage=workloads.every(w=>manifest.tasks.some(t=>t.workload===w));
const jobs=[];for(const task of manifest.tasks)for(let repeat=0;repeat<manifest.repeats;repeat++)for(const variant of variants)jobs.push({task,variant,repeat});
let rng=manifest.seed>>>0;for(let i=jobs.length-1;i>0;i--){rng=(1664525*rng+1013904223)>>>0;const j=rng%(i+1);[jobs[i],jobs[j]]=[jobs[j],jobs[i]];}
if(!args.includes('--run')){console.log(JSON.stringify({validated:true,mode:manifest.mode,fullCoverage,jobs:jobs.map(j=>({taskId:j.task.id,variant:j.variant,repeat:j.repeat})),note:'Validação do plano; nenhuma inferência executada.'},null,2));process.exit(0);}
const out=path.resolve(args.includes('--output')?args[args.indexOf('--output')+1]:'benchmark-results.json');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'nectar-benchmark-')),runs=[];
const git=(repo,argv)=>execFileSync('git',['-C',repo,...argv],{encoding:'utf8',windowsHide:true,stdio:['ignore','pipe','pipe']}).trim();
try{for(const [index,{task,variant,repeat}]of jobs.entries()){
  const cwd=path.join(temp,`run-${index}`),actualCommit=git(task.repository,['rev-parse','--verify',`${task.baselineCommit}^{commit}`]);
  git(task.repository,['worktree','add','--detach',cwd,actualCommit]);
  const adapter=task.adapters[variant],env={...process.env,NECTAR_BENCHMARK_CWD:cwd,NECTAR_BENCHMARK_TASK:task.id,NECTAR_BENCHMARK_VARIANT:variant,NECTAR_BENCHMARK_SEED:String(manifest.seed+repeat),NECTAR_BENCHMARK_BUDGET:JSON.stringify(task.budget)};
  const started=Date.now();console.log(`benchmark ${index+1}/${jobs.length}: ${task.id} ${variant}`);
  const exec=spawnSync(adapter.argv[0],adapter.argv.slice(1),{cwd,env,encoding:'utf8',windowsHide:true,timeout:task.timeoutMs||120000,maxBuffer:8*1024*1024});
  const verdict=spawnSync(task.acceptance.argv[0],task.acceptance.argv.slice(1),{cwd,env,encoding:'utf8',windowsHide:true,timeout:task.timeoutMs||120000,maxBuffer:8*1024*1024});
  let telemetry={};try{telemetry=JSON.parse((exec.stdout||'').trim().split('\n').at(-1));}catch{}
  const validated=exec.status===0&&verdict.status===0&&!exec.error&&!verdict.error;
  runs.push({taskId:task.id,workload:task.workload,variant,repeat,mode:manifest.mode,seed:manifest.seed+repeat,baselineCommit:actualCommit,acceptanceHash:hash(task.acceptance),toolsHash:hash(task.tools),budgetHash:hash(task.budget),modelProfileHash:hash(task.modelProfile||'unknown'),validated,ttvdMs:validated?Date.now()-started:null,elapsedMs:Date.now()-started,totalCost:Number.isFinite(telemetry.totalCost)?telemetry.totalCost:null,modelCalls:telemetry.modelCalls??null,adapterExit:exec.status,acceptanceExit:verdict.status,error:exec.error?.message||verdict.error?.message||(!validated?'adapter ou aceite falhou':null),adapterHash:hash(adapter)});
  fs.writeFileSync(out,JSON.stringify({schema:'nectar.benchmark-results.v1',seed:manifest.seed,mode:manifest.mode,fullCoverage,runs,comparison:compararBenchmark(runs),limitations:['Custo reportado por adapter precisa conciliação com traces confiáveis.','Snapshot do código e aceitação independentes não certificam permissões de adapters não auditados.','Nenhuma configuração é promovida automaticamente.']},null,2));
  // Só o worktree temporário criado neste laço é removido; o checkout de origem permanece intacto.
  git(task.repository,['worktree','remove','--force',cwd]);
}}finally{if(path.dirname(temp)!==os.tmpdir()||!path.basename(temp).startsWith('nectar-benchmark-'))throw new Error('diretório temporário inválido');fs.rmSync(temp,{recursive:true,force:true,maxRetries:5,retryDelay:100});}
console.log(`Relatório: ${out}`);
