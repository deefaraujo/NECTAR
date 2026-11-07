import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { status } from './contas.mjs';
import { localizarClaude, localizarCodex, matar, modelosCodex } from './runner.mjs';
import { lerConfig } from './store.mjs';

export const MODELOS_ENTREVISTA = [
  { id:'claude-opus-5-5', engine:'claude', nome:'Claude Opus 5.5' },
  { id:'gpt-6.1-sol', engine:'codex', nome:'GPT-6.1 Sol' },
  { id:'gpt-6.1-terra', engine:'codex', nome:'GPT-6.1 Terra' }
];
export async function statusEntrevista(){
  if(process.env.STUDIO_FAKE==='1')return {configurado:false,modelos:MODELOS_ENTREVISTA.map(m=>({...m,disponivel:false})),modelo:null,modo:'contas-nectar'};
  const cfg=lerConfig();
  const [claude,codex,catalogo]=await Promise.all([status('claude',cfg),status('codex',cfg),modelosCodex(cfg.codexExe).catch(()=>[])]);
  const modelos=MODELOS_ENTREVISTA.map(m=>({...m,disponivel:m.engine==='claude'?claude.conectado:codex.conectado&&catalogo.some(c=>c.slug===m.id)}));
  return {configurado:modelos.some(m=>m.disponivel),modelos,modelo:'Automático: Opus 5.5 → GPT-6.1',modo:'contas-nectar'};
}

export function executarVisaoCli({engine,bin,modelo,prompt,quadro,signal,spawnImpl=spawn}){
  if(bin.shell)throw new Error('O agente visual precisa do executável nativo do Claude ou Codex.');
  const cwd=fs.mkdtempSync(path.join(os.tmpdir(),'nectar-entrevista-'));
  return new Promise((resolve,reject)=>{
    let terminou=false,buf='',texto='',proc,timer;
    const fim=(erro,valor)=>{
      if(terminou)return;terminou=true;clearTimeout(timer);signal?.removeEventListener('abort',cancelar);
      if(proc){proc.stdin.destroy();matar(proc);}try{fs.rmdirSync(cwd);}catch{}
      erro?reject(erro):resolve(valor);
    };
    const cancelar=()=>fim(new Error('Análise visual cancelada'));
    if(signal?.aborted){cancelar();return;}
    signal?.addEventListener('abort',cancelar,{once:true});
    const args=engine==='claude'
      ? ['-p','--model',modelo,'--input-format','stream-json','--output-format','stream-json','--verbose','--restricted','--tools','','--strict-mcp-config','--mcp-config','{"mcpServers":{}}','--setting-sources','','--no-session-persistence','--disable-slash-commands','--no-chrome']
      : ['app-server','-c','mcp_servers={}','-c','web_search="disabled"',...['shell_tool','apps','browser_use','computer_use','view_image','multi_agent','code_mode_host','skill_search'].flatMap(f=>['-c',`features.${f}=false`]),'-c','project_doc_max_bytes=0'];
    try{proc=spawnImpl(bin.cmd,[...(bin.prefixo||[]),...args],{cwd,windowsHide:true,stdio:['pipe','pipe','pipe']});}catch(e){fim(e);return;}
    const enviar=m=>{if(!terminou)proc.stdin.write(JSON.stringify(m)+'\n');};
    const linha=m=>{
      if(engine==='claude'){
        if(m.type==='assistant')texto=(m.message?.content||[]).filter(c=>c.type==='text').map(c=>c.text).join('');
        if(m.type==='result')fim(m.is_error?new Error(String(m.result||'Claude indisponível').slice(0,500)):null,m.result||texto);
        return;
      }
      if(m.error&&m.id!==undefined){fim(new Error(String(m.error.message).slice(0,500)));return;}
      if(m.id===1){enviar({method:'initialized',params:{}});enviar({id:2,method:'thread/start',params:{model:modelo,cwd,ephemeral:true,approvalPolicy:'never',sandbox:'read-only',baseInstructions:'Você decide ações visuais para operar a página do teste, sem ferramentas do CLI. Retorne apenas a ação JSON solicitada.',developerInstructions:'Não leia arquivos locais nem use ferramentas do CLI. Avalie a imagem e o texto recebidos. Editor, arquivos e recursos exibidos dentro da plataforma podem ser operados somente pelas ações JSON da NECTAR.'}});}
      if(m.id===2)enviar({id:3,method:'turn/start',params:{threadId:m.result.thread.id,input:[{type:'text',text:prompt},{type:'image',url:quadro}]}});
      if(m.method==='item/completed'&&m.params?.item?.type==='agentMessage')texto=m.params.item.text;
      if(m.method==='turn/completed')fim(m.params.turn.status==='completed'?null:new Error(m.params.turn.error?.message||'GPT indisponível'),texto);
      if(m.method==='error'&&!m.params?.willRetry)fim(new Error(m.params?.error?.message||'GPT indisponível'));
      // Este cliente não autoriza nenhuma ferramenta nem solicita interação humana.
      if(m.id!==undefined&&m.method)fim(new Error('O modelo solicitou uma ferramenta fora do modo visual'));
    };
    proc.stdout.on('data',d=>{buf+=d.toString('utf8');let i;while(!terminou&&(i=buf.indexOf('\n'))>=0){const ln=buf.slice(0,i);buf=buf.slice(i+1);let m;try{m=JSON.parse(ln);}catch{continue;}linha(m);}});
    let stderr='';proc.stderr.on('data',d=>{stderr=(stderr+d.toString()).slice(-1000);});
    proc.on('error',e=>fim(e));proc.on('close',()=>fim(new Error(stderr.slice(-500)||'O motor encerrou sem resposta visual')));proc.stdin.on('error',()=>{});
    timer=setTimeout(()=>fim(new Error('O motor visual excedeu 90 segundos')),90000);
    if(engine==='claude')proc.stdin.end(JSON.stringify({type:'user',session_id:'',parent_tool_use_id:null,message:{role:'user',content:[{type:'text',text:prompt},{type:'image',source:{type:'base64',media_type:'image/jpeg',data:quadro.split(',')[1]}}]}})+'\n');
    else enviar({id:1,method:'initialize',params:{clientInfo:{name:'nectar_entrevista',version:'1.0.0'},capabilities:{experimentalApi:true}}});
  });
}

export async function decidirComConta({modelo='auto',prompt,quadro,signal}, {statusImpl=statusEntrevista,executarImpl=executarVisaoCli,localizarImpl=null}={}){
  const s=await statusImpl();
  const candidatos=s.modelos.filter(m=>m.disponivel&&(modelo==='auto'||m.id===modelo));
  if(!candidatos.length)throw new Error('Nenhum dos modelos selecionados está disponível. Conecte Claude ou Codex nos Ajustes da NECTAR.');
  const falhas=[];const cfg=lerConfig();
  for(const m of candidatos){
    if(signal?.aborted)throw new Error('Análise visual cancelada');
    try{
      const bin=localizarImpl?await localizarImpl(m.engine):m.engine==='claude'?await localizarClaude(cfg.claudeExe):await localizarCodex(cfg.codexExe);
      const texto=await executarImpl({engine:m.engine,bin,modelo:m.id,prompt,quadro,signal});
      return {texto,modelo:m.id,falhas};
    }catch(e){falhas.push({modelo:m.id,erro:e.message});if(modelo!=='auto'||signal?.aborted)throw e;}
  }
  throw new Error(`Modelos indisponíveis: ${falhas.map(f=>`${f.modelo}: ${f.erro}`).join('; ').slice(0,1200)}`);
}
