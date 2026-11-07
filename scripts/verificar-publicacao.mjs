// Checks the index/HEAD blobs, not just the files visible on disk.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const root=path.resolve(import.meta.dirname,'..');
const head=process.argv.includes('--head');
const git=(args,extra={})=>execFileSync('git',args,{cwd:root,maxBuffer:128*1024*1024,...extra});
const entries=git(head?['ls-tree','-r','-z','HEAD']:['ls-files','--stage','-z']).toString('utf8').split('\0').filter(Boolean).map(line=>{
  const [meta,name]=line.split('\t');const parts=meta.split(' ');return {name,mode:parts[0],oid:parts[head?2:1]};
});
const roots=new Set(['.gitignore','.editorconfig','CHANGELOG.md','.gitattributes','.github','.githooks','README.md','LICENSE','CONTRIBUTING.md','SECURITY.md','THIRD_PARTY_NOTICES.md','package.json','package-lock.json','marca.json','server.mjs','docs','electron','lib','public','scripts','tests','templates','build','vozes']);
const ownSkills=new Set(['jogos/assets-abertos','jogos/renpy-codigo','jogos/renpy-mobile','jogos/renpy-sprites','jogos/renpy-ui-acabada','jogos/renpy-vfx','professional-operations/pacote-apresentacao','professional-operations/render-slides','software/midia-de-entrega','jogos/direcao-de-experiencia','software/versionamento-git','professional-operations/brand-presentation-registry','professional-operations/contribution-attribution','professional-operations/cross-source-correlation','professional-operations/documentos-editaveis','professional-operations/enterprise-data-governance','professional-operations/enterprise-source-discovery','professional-operations/enterprise-sync-health','professional-operations/fluxos-assessoria','professional-operations/jira-work-history','professional-operations/notion-project-knowledge','professional-operations/presentation-evidence-qa','professional-operations/presentation-rehearsal','professional-operations/review-intelligence','professional-operations/teams-project-context','professional-operations/work-activity-ledger']);
const issues=[];
for(const e of entries){
  if(!roots.has(e.name.split('/')[0]))issues.push(`${e.name}: root not allowed in the publication`);
  if(e.mode!=='100644'&&e.mode!=='100755')issues.push(`${e.name}: symlink or embedded repository not allowed`);
  if(/^(?:data|projetos|relatorios|_local|node_modules|dist[^/]*)\//.test(e.name)||/^scripts\/_.*\.py$/.test(e.name)||/^templates\/avaliacao-agentes\//.test(e.name)||/^tests\/avaliacao-agentes\.mjs$/.test(e.name))issues.push(`${e.name}: local or private content`);
  const skill=/^templates\/([^/]+)\/skills\/([^/]+)\//.exec(e.name);
  if(skill&&!ownSkills.has(`${skill[1]}/${skill[2]}`))issues.push(`${e.name}: copy of an add-on not included in the distribution`);
  if(/(?:^|\/)(?:\.env(?:\..*)?|auth\.json|credentials\.json|\.credentials\.json)$/.test(e.name)&&!/(?:example|sample)$/.test(e.name))issues.push(`${e.name}: sensitive configuration`);
  if(/\.(?:exe|msi|zip|asar|pem|key|p12|pfx|pyc)$/i.test(e.name)||/^vozes\/propria\.wav$/.test(e.name))issues.push(`${e.name}: artifact or external resource not distributed`);
}
const blobs=entries.filter(e=>['100644','100755'].includes(e.mode));
const data=git(['cat-file','--batch'],{input:blobs.map(e=>e.oid).join('\n')+'\n'});
const patterns=[
 ['token GitHub',/\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{45,})\b/g],
 ['chave de API',/\bsk-(?:proj-|ant-)?[A-Za-z0-9_-]{32,}\b/g],
 ['chave AWS',/\bAKIA[A-Z0-9]{16}\b/g],
 ['URL com credencial',/https?:\/\/[^\s"<>/:]+:[^\s"<>/@]+@/g],
 ['chave privada',/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----\s+[A-Za-z0-9+/=\r\n]{80,}/g]
];
let pos=0,total=0;
for(const e of blobs){
  const end=data.indexOf(10,pos),header=data.subarray(pos,end).toString().split(' '),size=Number(header[2]);
  if(!Number.isFinite(size))throw new Error('Invalid Git blob');
  const bytes=data.subarray(end+1,end+1+size);pos=end+size+2;total+=size;
  if(size>25*1024*1024)issues.push(`${e.name}: file over 25 MiB requires review`);
  if(bytes.subarray(0,1024).includes(0))continue;
  const text=bytes.toString('utf8');
  for(const [label,rx] of patterns){rx.lastIndex=0;for(const m of text.matchAll(rx))issues.push(`${e.name}:${text.slice(0,m.index).split('\n').length}: possible ${label}; value omitted`);}
  const local=/[A-Za-z]:[\\/]{1,2}Users[\\/]{1,2}([^\\/\s"'`]+)/g;
  for(const m of text.matchAll(local))if(!/^(?:x|user|usuario|test|example|Public|<[^>]+>)$/i.test(m[1]))issues.push(`${e.name}: literal personal path; value omitted`);
}
for(const name of ['LICENSE','README.md','THIRD_PARTY_NOTICES.md'])if(!entries.some(e=>e.name===name))issues.push(`${name}: required`);
if(issues.length){console.error(issues.join('\n'));process.exitCode=1;}
else console.log(`Publication verified: ${entries.length} files, ${(total/1024/1024).toFixed(1)} MiB; no private directories, embedded projects or known secret patterns. This check does not replace human review.`);
