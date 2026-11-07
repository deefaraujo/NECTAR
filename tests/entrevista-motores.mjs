import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { executarVisaoCli, decidirComConta, MODELOS_ENTREVISTA } from '../lib/entrevista-motores.mjs';
const quadro='data:image/jpeg;base64,YWJj';
for(const engine of ['claude','codex']){
  let morto=false,imagenRecebida=false;
  const spawnImpl=(_bin,args,opts)=>{
    assert.equal(opts.windowsHide,true);
    if(engine==='claude'){assert.ok(args.includes('--restricted'));assert.equal(args[args.indexOf('--tools')+1],'');assert.ok(args.includes('--no-session-persistence'));}
    else assert.ok(args.includes('features.shell_tool=false'));
    const p=new EventEmitter();p.stdout=new PassThrough();p.stderr=new PassThrough();p.stdin=new PassThrough();p.abort=()=>{morto=true;};
    const responder=m=>queueMicrotask(()=>p.stdout.write(JSON.stringify(m)+'\n'));
    p.stdin.on('data',d=>{
      const m=JSON.parse(d.toString());
      if(engine==='claude'){imagenRecebida=m.message.content[1].source.data==='YWJj';responder({type:'result',result:'{"tipo":"aguardar"}'});}
      else if(m.method==='initialize')responder({id:1,result:{}});
      else if(m.method==='thread/start'){assert.equal(m.params.ephemeral,true);responder({id:2,result:{thread:{id:'thread-teste'}}});}
      else if(m.method==='turn/start'){imagenRecebida=m.params.input[1].url===quadro;responder({method:'item/completed',params:{item:{type:'agentMessage',text:'{"tipo":"aguardar"}'}}});responder({method:'turn/completed',params:{turn:{status:'completed'}}});}
    });return p;
  };
  assert.equal(await executarVisaoCli({engine,modelo:'teste',bin:{cmd:'cli',shell:false},prompt:'Observe',quadro,spawnImpl}),' {"tipo":"aguardar"}'.trim());
  assert.ok(imagenRecebida);assert.ok(morto);
}
const statusImpl=async()=>({modelos:MODELOS_ENTREVISTA.map(m=>({...m,disponivel:true}))});
const localizarImpl=async()=>({cmd:'cli',shell:false});let tentativas=[];
const executarImpl=async({modelo})=>{tentativas.push(modelo);if(modelo==='claude-opus-5-5')throw new Error('Quota esgotada');return '{"tipo":"aguardar"}';};
const fallback=await decidirComConta({prompt:'Observe',quadro},{statusImpl,localizarImpl,executarImpl});
assert.equal(fallback.modelo,'gpt-6.1-sol');assert.equal(fallback.falhas[0].modelo,'claude-opus-5-5');assert.equal(tentativas.length,2);
tentativas=[];
await assert.rejects(()=>decidirComConta({modelo:'claude-opus-5-5',quadro},{statusImpl,localizarImpl,executarImpl}),/Quota/);
assert.equal(tentativas.length,1);
const controller=new AbortController();controller.abort();
await assert.rejects(()=>decidirComConta({quadro,signal:controller.signal},{statusImpl,localizarImpl,executarImpl}),/cancelada/);
let cancelou=false;
const c=new AbortController();
const pendente=executarVisaoCli({engine:'codex',bin:{cmd:'cli'},quadro,signal:c.signal,spawnImpl:()=>{const p=new EventEmitter();p.stdin=new PassThrough();p.stdout=new PassThrough();p.stderr=new PassThrough();p.abort=()=>{cancelou=true;};return p;}});
c.abort();await assert.rejects(()=>pendente,/cancelada/);assert.ok(cancelou);
console.log('Vision accounts: images over stdin/RPC, ephemeral sessions, tools disabled, fallback, explicit selection and cancellation validated (simulated).');
