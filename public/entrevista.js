'use strict';
const $=id=>document.getElementById(id), bridge=window.studioApp;
let stream,fonte,ativo=false,geracao=0,abortador,configurado=false,lendoCurriculo=false;
let relatorio={tipo:'entrevista-experimental',eventos:[]};
function registrar(estado,acao){const evento={em:new Date().toISOString(),estado,acao};relatorio.eventos.push(evento);$('estado').textContent=estado;$('log').textContent=JSON.stringify(relatorio.eventos,null,2);return evento;}
function parar(motivo='Interrompido pelo usuário'){
  ativo=false;geracao++;abortador?.abort();bridge?.entrevistaParar(motivo);
  stream?.getTracks().forEach(t=>t.stop());stream=null;fonte=null;
  $('iniciar').disabled=true;$('parar').disabled=true;$('compartilhar').disabled=false;
  relatorio.fim=new Date().toISOString();relatorio.resultado=motivo;registrar(motivo);
  if(relatorio.metricas)relatorio.metricas.duracaoMs=Date.now()-Date.parse(relatorio.inicio);
  fetch('/api/entrevista/diagnostico',{method:'POST',headers:{'Content-Type':'application/json'},keepalive:true,body:JSON.stringify({inicio:relatorio.inicio,motivo,modelo:relatorio.modeloSolicitado,eventos:relatorio.eventos.slice(-12).map(e=>({em:e.em,estado:e.estado.slice(0,800),tipo:e.acao?.tipo,modelo:e.acao?.modeloUsado}))})}).catch(()=>{});
}
$('parar').onclick=()=>parar();
bridge?.aoPararEntrevista?.(motivo=>{if(ativo)parar(motivo);});
window.addEventListener('beforeunload',()=>{bridge?.entrevistaParar();stream?.getTracks().forEach(t=>t.stop());});
$('arquivo').onchange=async()=>{
  const f=$('arquivo').files[0];if(!f||ativo)return;
  lendoCurriculo=true;$('iniciar').disabled=true;$('arquivo').disabled=true;$('cv').disabled=true;$('cv').value='';
  try{
    const pdf=/\.pdf$/i.test(f.name);
    if(!pdf&&!/\.(txt|md)$/i.test(f.name))throw new Error('Escolha um currículo PDF, TXT ou Markdown.');
    if(f.size>(pdf?10*1024*1024:160000))throw new Error(pdf?'O PDF deve ter até 10 MB.':'O arquivo de texto deve ter até 160 KB.');
    registrar(pdf?'Lendo o currículo PDF…':'Lendo o currículo…');
    let texto;
    if(pdf){
      const data=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(new Error('Não foi possível abrir o arquivo.'));reader.readAsDataURL(f);});
      const r=await fetch('/api/entrevista/curriculo',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({pdf:data.split(',')[1]})});
      const j=await r.json();if(!r.ok)throw new Error(j.erro||'Não foi possível ler o PDF.');texto=j.texto;
    }else texto=await f.text();
    if(!texto.trim())throw new Error('O currículo está vazio.');
    if(texto.length>40000)throw new Error('O currículo deve ter até 40 mil caracteres.');
    $('cv').value=texto;registrar(`Currículo carregado: ${f.name}. Confira o texto antes de iniciar.`);
  }catch(e){registrar(e.message);}
  finally{lendoCurriculo=false;$('arquivo').disabled=false;$('cv').disabled=false;$('iniciar').disabled=!stream||!configurado||!bridge;}
};
async function compartilhar(id){
  try{
    if(stream)stream.getTracks().forEach(t=>t.stop());
    if(bridge)await bridge.escolherTela(id);
    stream=await navigator.mediaDevices.getDisplayMedia({video:{frameRate:2},audio:false});
    fonte=id;$('preview').srcObject=stream;await $('preview').play();
    stream.getVideoTracks()[0].addEventListener('ended',()=>{if(stream)parar('Compartilhamento encerrado');},{once:true});
    $('fontes').replaceChildren();$('iniciar').disabled=!configurado||!bridge||lendoCurriculo;
    registrar('Tela pronta. Coloque a entrevista nessa tela antes de iniciar.');
  }catch(e){registrar(e.message);}
}
$('compartilhar').onclick=async()=>{
  try{
    if(!bridge){await compartilhar();return;}
    $('fontes').replaceChildren();
    for(const f of (await bridge.fontesTela()).filter(f=>f.tipo==='tela')){
      const b=document.createElement('button');b.textContent=f.nome;b.onclick=()=>compartilhar(f.id);$('fontes').append(b);
    }
  }catch(e){registrar(e.message);}
};
const esperar=ms=>new Promise(r=>setTimeout(r,ms));
$('iniciar').onclick=async()=>{
  if(ativo||lendoCurriculo||!stream||!bridge)return;
  const curriculo=$('cv').value.trim();if(!curriculo){registrar('Informe o currículo.');return;}
  const modelo=$('modelo').value;
  const caracteresPorSegundo=Number($('velocidade').value);
  if(!Number.isInteger(caracteresPorSegundo)||caracteresPorSegundo<5||caracteresPorSegundo>25){registrar('Use uma velocidade de 5 a 25 caracteres por segundo.');return;}
  const desafio={modo:$('modo').value,plataforma:$('plataforma').value,dificuldade:$('dificuldade').value,linguagem:$('linguagem').value};
  let memoria='';
  let linguagemObservada=null;
  let falhasConsecutivas=0,feedback='';
  const maximo=Number($('limite').value);if(!Number.isInteger(maximo)||maximo<1||maximo>300){registrar('Use de 1 a 300 ações.');return;}
  ativo=true;const g=++geracao;relatorio={tipo:'entrevista-experimental',inicio:new Date().toISOString(),desafio,digitacao:{caracteresPorSegundo},modeloSolicitado:modelo,motor:$('motor').textContent,metricas:{acoes:0,execucoes:0,submissoes:0,veredito:'nao_verificado'},eventos:[]};
  $('resultado-desafio').textContent='Resultado da plataforma: ainda não verificado.';
  $('linguagem-detectada').textContent='Linguagem do editor: aguardando análise do teste.';
  $('iniciar').disabled=true;$('parar').disabled=false;$('compartilhar').disabled=true;abortador=new AbortController();
  try{
    const preparo=await bridge.entrevistaArmar(fonte,{caracteresPorSegundo});
    if(!preparo)throw new Error('Preparação interrompida');
    while(Date.now()<preparo.inicioEm){
      if(!ativo||g!==geracao)return;
      registrar(`Iniciando em ${Math.ceil((preparo.inicioEm-Date.now())/1000)}…`);
      await esperar(Math.min(1000,Math.max(1,preparo.inicioEm-Date.now())));
    }
    if(!ativo||g!==geracao)return;
    registrar('Agente no controle. Você pode observar a entrevista.');
    const canvas=document.createElement('canvas'),video=$('preview');
    for(let i=0;i<maximo&&ativo&&g===geracao;){
      if(!video.videoWidth)throw new Error('A transmissão não tem quadros disponíveis');
      canvas.width=Math.min(1600,video.videoWidth);canvas.height=Math.round(video.videoHeight*canvas.width/video.videoWidth);
      canvas.getContext('2d').drawImage(video,0,0,canvas.width,canvas.height);
      registrar(`Analisando ação ${i+1}/${maximo}…`);
      const acoes=relatorio.eventos.filter(e=>e.acao&&e.executada!==false),ultimaSubmissao=acoes.findLast(e=>e.acao.observacao?.etapa==='submeter'&&['clicar','tecla'].includes(e.acao.tipo));
      const historico=acoes.slice(-30);if(ultimaSubmissao&&!historico.includes(ultimaSubmissao))historico.unshift(ultimaSubmissao);
      const historicoValidacao=acoes.map(e=>({executada:e.executada,acao:{tipo:e.acao.tipo,tecla:e.acao.tecla,observacao:e.acao.observacao,avaliacaoTeste:e.acao.avaliacaoTeste,linguagem:e.acao.linguagem?{selecionada:e.acao.linguagem.selecionada,confirmada:e.acao.linguagem.confirmada}:undefined}}));
      let j;
      try{
        const r=await fetch('/api/entrevista/passo',{method:'POST',headers:{'Content-Type':'application/json'},signal:abortador.signal,body:JSON.stringify({modelo,curriculo,...desafio,linguagemObservada,memoria,feedback,quadro:canvas.toDataURL('image/jpeg',.8),historico,historicoValidacao})});
        j=await r.json();
        if(!r.ok){const e=new Error(j.erro||`Falha visual HTTP ${r.status}`);e.recuperavel=j.recuperavel===true||[408,429,500,502,503,504].includes(r.status);throw e;}
        if(!j.acao||typeof j.acao.tipo!=='string'){const e=new Error('Resposta visual sem ação válida');e.recuperavel=true;throw e;}
        falhasConsecutivas=0;feedback='';
      }catch(e){
        if(!ativo||g!==geracao)return;
        falhasConsecutivas++;
        if((e.recuperavel===true||e.name==='TypeError'||e.name==='SyntaxError')&&falhasConsecutivas<3){
          feedback=String(e.message).slice(0,1200);
          registrar(`Falha de análise ${falhasConsecutivas}/3: ${e.message}. Vou analisar a tela novamente.`);
          await esperar(2000);continue;
        }
        throw new Error(`${e.message}${falhasConsecutivas>=3?' (3 análises consecutivas falharam)':''}`);
      }
      if(!ativo||g!==geracao)return;
      const evento=registrar(`Ação ${i+1}: ${j.acao.tipo}${j.acao.modeloUsado?' · '+j.acao.modeloUsado:''}`,j.acao);
      evento.executada=false;
      if(j.acao.memoria!==undefined)memoria=j.acao.memoria;
      if(j.acao.linguagem){
        linguagemObservada=j.acao.linguagem;relatorio.linguagemObservada=linguagemObservada;
        $('linguagem-detectada').textContent=`Linguagem ${linguagemObservada.confirmada?'confirmada':'em análise'}: ${linguagemObservada.selecionada||'a verificar'}${linguagemObservada.motivo?' · '+linguagemObservada.motivo:''}`;
      }
      relatorio.metricas.acoes++;
      if(j.acao.observacao){
        const o=j.acao.observacao;
        relatorio.metricas.veredito=o.veredito;
        $('resultado-desafio').textContent=`Etapa: ${o.etapa} · Resultado observado: ${o.veredito}${o.evidencia?' · '+o.evidencia:''}`;
      }
      if(j.acao.avaliacaoTeste)relatorio.ultimaAvaliacaoTeste=j.acao.avaliacaoTeste;
      if(['concluir','interromper'].includes(j.acao.tipo)){evento.executada=true;parar(j.acao.tipo==='concluir'?'Conclusão indicada pelo agente':`Interrompido pelo agente: ${j.acao.descricao||j.acao.observacao?.evidencia||'o modelo não informou o motivo'}`);return;}
      await bridge.entrevistaAcao(j.acao);
      evento.executada=true;
      if(['clicar','tecla'].includes(j.acao.tipo)){
        if(j.acao.observacao?.etapa==='executar')relatorio.metricas.execucoes++;
        if(j.acao.observacao?.etapa==='submeter')relatorio.metricas.submissoes++;
        if(j.acao.observacao?.etapa==='avancar'){
          linguagemObservada=null;
          $('linguagem-detectada').textContent='Nova questão: reavaliando a linguagem do editor.';
        }
      }
      i++;
      await esperar(1000);
    }
    if(ativo&&g===geracao)parar('Limite de ações atingido');
  }catch(e){if(g===geracao)parar(`Interrompido: ${e.message}`);}
};
$('exportar').onclick=()=>{const u=URL.createObjectURL(new Blob([JSON.stringify(relatorio,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=u;a.download='nectar-entrevista.json';a.click();setTimeout(()=>URL.revokeObjectURL(u),1000);};
fetch('/api/entrevista/status').then(r=>r.json()).then(j=>{
  configurado=j.configurado;
  for(const m of j.modelos||[]){const o=document.createElement('option');o.value=m.id;o.textContent=m.nome+(m.disponivel?'':' — conta indisponível');o.disabled=!m.disponivel;$('modelo').append(o);}
  $('motor').textContent=j.configurado?'Motor visual: contas Claude / Codex da NECTAR.':'Conecte Claude ou Codex nos Ajustes da NECTAR para habilitar o agente.';
  if(!bridge)$('motor').textContent+=' O controle de mouse e teclado exige o aplicativo NECTAR para Windows.';
  $('iniciar').disabled=!stream||!configurado||!bridge||lendoCurriculo;
}).catch(e=>registrar(e.message));
