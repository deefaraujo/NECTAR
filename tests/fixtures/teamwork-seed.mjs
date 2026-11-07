// Disposable fixtures for the UI suite only.
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {criarTeamwork} from '../../lib/teamwork.mjs';
const [pasta,workspaceId,projectId,count='20',prefix='ui']=process.argv.slice(2);
const rel=path.relative(os.tmpdir(),path.resolve(pasta));if(rel.startsWith('..')||!rel.split(path.sep)[0].startsWith('work-ia-ui-'))throw new Error('Fixture fora do diretório temporário de teste');
const t=criarTeamwork({pasta,workspaceId,projectId,ids:new Set(['backend','qa']),papeis:{qa:'qa'}});
for(let n=0;n<Number(count);n++){
  let task=t.tasks.criar({idempotencyKey:`${prefix}-${n}`,goalId:'ui-fixture',assigneeAgentId:'backend',requiredCapability:'report',objective:`${prefix}: tarefa ${n+1} com evidências e limitações verificáveis`,acceptanceCriteria:['A lista deve preservar a última tarefa visível'],scope:{readPaths:[pasta],writePaths:[],denyPaths:[]},budget:{maxModelCalls:1}});
  if(task.status!=='draft')continue;task=t.tasks.transicionar(task.taskId,'ready',task.version);const {attempt}=t.tasks.claim(task.taskId,task.version,'backend');
  const artifact=t.artifacts.publicar({taskId:task.taskId,executionId:attempt.executionId,producer:'backend',conteudo:'SIMULADO: fixture de interface; não é entrega de produto.'});
  t.tasks.resultado(attempt.executionId,'backend',{artifacts:[artifact.artifactId],evidence:[artifact.artifactId]});
}
console.log('UI fixtures registered.');
