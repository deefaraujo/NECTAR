import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const git=(root,args)=>execFileSync('git',['-C',root,...args],{encoding:'utf8',windowsHide:true,timeout:60000,stdio:['ignore','pipe','pipe']}).trim();
const safe=id=>createHash('sha256').update(String(id)).digest('hex').slice(0,20);
export function prepararEscrita({root,taskId,pasta,base='HEAD'}) {
  const top=git(root,['rev-parse','--show-toplevel']);const commit=git(top,['rev-parse','--verify',`${base}^{commit}`]);
  const cwd=path.resolve(pasta,'worktrees',safe(taskId)),branch=`NECTAR-${safe(taskId)}`;
  const metadata=path.resolve(pasta,'worktrees',safe(taskId)+'.json');
  // Uma tarefa retoma o mesmo ambiente. Nunca remover worktree com trabalho.
  if(fs.existsSync(cwd)){if(path.resolve(git(cwd,['rev-parse','--show-toplevel'])).toLowerCase()!==cwd.toLowerCase()||git(cwd,['branch','--show-current'])!==branch)throw new Error('worktree_identity_mismatch');const m=JSON.parse(fs.readFileSync(metadata,'utf8'));if(m.cwd!==cwd||m.branch!==branch||m.taskId!==taskId)throw new Error('worktree_identity_mismatch');return {...m,resumed:true};}
  fs.mkdirSync(path.dirname(cwd),{recursive:true});git(top,['worktree','add','-b',branch,cwd,commit]);const result={cwd,branch,baseCommit:commit,taskId,sourceDirty:!!git(top,['status','--porcelain']),createdAt:new Date().toISOString(),resumed:false};fs.writeFileSync(metadata,JSON.stringify(result,null,2),{flag:'wx'});return result;
}
export function verificarIntegracao({root,branch,baseCommit,allowedPaths=[],requiredTests=[]}) {
  const head=git(root,['rev-parse','--verify',`${branch}^{commit}`]);
  git(root,['merge-base','--is-ancestor',baseCommit,head]);
  const files=git(root,['diff','--name-only',baseCommit,head]).split('\n').filter(Boolean);
  if(!files.length)throw new Error('integration_empty_diff');
  if(!allowedPaths.length||files.some(f=>!allowedPaths.some(p=>f===p||f.startsWith(p.replace(/\/$/,'')+'/'))))throw new Error('integration_scope_violation');
  if(!requiredTests.length||requiredTests.some(t=>t.status!=='passed'||t.commit!==head||!t.evidence||t.exitCode!==0))throw new Error('integration_tests_missing');
  return {head,files,baseCommit};
}
export function integrarIsolado({root,taskId,pasta,branch,target,expectedTarget,allowedPaths,requiredTests,protectedTarget=false,approved=false}) {
  if(protectedTarget&&!approved)throw new Error('approval_required');
  const current=git(root,['rev-parse','--verify',`${target}^{commit}`]);if(current!==expectedTarget)throw new Error('version_conflict: destino avançou');
  const checked=verificarIntegracao({root,branch,baseCommit:git(root,['merge-base',target,branch]),allowedPaths,requiredTests});
  const integration=prepararEscrita({root,taskId:`integration:${taskId}:${current}`,pasta,base:current});
  if(git(integration.cwd,['status','--porcelain']))throw new Error('integration_worktree_dirty: conflito anterior preservado');
  try{git(integration.cwd,['merge','--no-ff','--no-edit',branch]);}
  catch{const conflicts=git(integration.cwd,['diff','--name-only','--diff-filter=U']).split('\n').filter(Boolean);return {...integration,ok:false,failure:'integration_conflict',conflicts,recoverable:true};}
  return {...integration,ok:true,commit:git(integration.cwd,['rev-parse','HEAD']),target,expectedTarget:current,files:checked.files,published:false,requiresPostMergeTests:true};
}
