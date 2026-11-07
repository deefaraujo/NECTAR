// Hook local determinístico; não recebe segredos nem executa comandos do modelo.
const fs=require('node:fs'),path=require('node:path');
const inside=(base,target)=>{const rel=path.relative(base,target);return !rel||rel!=='..'&&!rel.startsWith('..'+path.sep)&&!path.isAbsolute(rel);};
function real(p){let current=path.resolve(p),parts=[];while(!fs.existsSync(current)){parts.unshift(path.basename(current));const parent=path.dirname(current);if(parent===current)break;current=parent;}return path.join(fs.realpathSync(current),...parts);}
function avaliar(event,policy){
  const tool=event.tool_name,input=event.tool_input||{};
  if(policy.expiresAt&&Date.parse(policy.expiresAt)<=Date.now())return 'grant expirado';
  if(!['Read','Grep','Glob','Edit','Write'].includes(tool))return 'ferramenta não concedida nesta execução';
  const write=['Edit','Write'].includes(tool),raw=input.file_path||input.path||(tool==='Glob'?policy.cwd:null);
  if(!raw||typeof raw!=='string')return 'caminho obrigatório';
  let target;try{target=real(path.resolve(policy.cwd,raw));}catch{return 'caminho inacessível';}
  const roots=write?policy.writePaths:policy.readPaths;
  if(!roots?.some(p=>inside(real(p),target)))return 'caminho fora do grant';
  if((policy.denyPaths||[]).some(p=>inside(real(p),target))||/(?:^|[\\/])(?:\.env(?:\.[^\\/]*)?|\.ssh|\.aws|\.codex|\.claude)(?:[\\/]|$)|\.(?:pem|key)$/i.test(target))return 'caminho protegido';
  if(tool==='Glob'&&(path.isAbsolute(input.pattern||'')||/(?:^|[\\/])\.\.(?:[\\/]|$)|:/.test(input.pattern||'')))return 'glob fora do escopo';
  if(tool==='Grep'&&fs.existsSync(target)&&fs.statSync(target).isDirectory())return 'busca recursiva de conteúdo exige arquivos explícitos: use Glob e leia os arquivos autorizados';
  return null;
}
module.exports={avaliar};
if(require.main===module){let data='';process.stdin.on('data',chunk=>{data+=chunk;if(data.length>1_000_000)process.exit(2);});process.stdin.on('end',()=>{try{const policy=JSON.parse(fs.readFileSync(process.argv[2],'utf8')),event=JSON.parse(data),reason=avaliar(event,policy);if(policy.auditFile)fs.appendFileSync(policy.auditFile,JSON.stringify({tool:event.tool_name,decision:reason?'deny':'allow',reason:reason||null,at:new Date().toISOString()})+'\n');if(reason){process.stdout.write(JSON.stringify({hookSpecificOutput:{hookEventName:'PreToolUse',permissionDecision:'deny',permissionDecisionReason:'permission_denied: '+reason}}));}else process.stdout.write(JSON.stringify({hookSpecificOutput:{hookEventName:'PreToolUse',permissionDecision:'allow'}}));}catch{process.stderr.write('permission_denied: política inválida');process.exitCode=2;}});}
