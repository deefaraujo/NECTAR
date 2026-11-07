'use strict';
const $=id=>document.getElementById(id);
let tarefas=[],atual=null,sujo=false,edicoes=0,gravando=null;
const labels={preparar:'Preparar',em_andamento:'Em andamento',aguardando_modelos:'Aguardando os modelos',pendencia:'Com pendência',concluida:'Concluída',rework:'Rework'};
function avisar(t){$('estado').textContent=t;}
async function api(url,opcoes={}){const r=await fetch(url,opcoes);const j=await r.json();if(!r.ok)throw new Error(j.erro||`Falha HTTP ${r.status}`);return j;}
function listar(){
  $('lista-tarefas').replaceChildren();
  const filtro=$('filtro').value;
  const visiveis=tarefas.filter(t=>filtro==='todas'||(filtro==='ativas'?t.status!=='concluida':t.status===filtro));
  for(const t of [...visiveis].sort((a,b)=>b.atualizadoEm.localeCompare(a.atualizadoEm))){
    const b=document.createElement('button');b.type='button';b.dataset.id=t.id;b.classList.toggle('ativa',atual?.id===t.id);
    const titulo=document.createElement('span');titulo.textContent=t.titulo;b.append(titulo);
    const detalhe=document.createElement('small');detalhe.textContent=I18N.t('{situacao} · Turno {turno}',{situacao:I18N.t(labels[t.status]),turno:t.turno});b.append(detalhe);
    b.onclick=()=>selecionar(t.id);$('lista-tarefas').append(b);
  }
  if(!visiveis.length){const p=document.createElement('p');p.textContent=I18N.t('Nenhuma tarefa neste filtro.');$('lista-tarefas').append(p);}
  $('resumo').textContent=I18N.t('{abertas} em aberto · {aguardando} aguardando · {pendentes} com pendência',{abertas:tarefas.filter(t=>t.status!=='concluida').length,aguardando:tarefas.filter(t=>t.status==='aguardando_modelos').length,pendentes:tarefas.filter(t=>t.status==='pendencia').length});
}
function lerFormulario(){
  const b={};for(const k of ['titulo','referencia','status','etapa','proximoPasso','pendencia','notas'])b[k]=$(k).value;
  b.turno=Number($('turno').value);b.checks={};document.querySelectorAll('[data-check]').forEach(c=>{b.checks[c.dataset.check]=c.checked;});return b;
}
function mostrar(t){
  atual=t;sujo=false;edicoes=0;$('vazio').hidden=true;$('registro').hidden=false;
  for(const k of ['titulo','referencia','status','etapa','proximoPasso','pendencia','notas'])$(k).value=t[k]||'';
  $('turno').value=t.turno;document.querySelectorAll('[data-check]').forEach(c=>{c.checked=t.checks?.[c.dataset.check]===true;});
  $('salvo').textContent=t.atualizadoEm?I18N.t('Último checkpoint: {data}',{data:new Date(t.atualizadoEm).toLocaleString(I18N.locale,{timeZone:'America/Sao_Paulo'})}):I18N.t('Novo registro: salve para criar seu ponto de retomada.');
  $('descartar').hidden=!!t.id;listar();
}
async function salvar(){
  if(gravando){const ok=await gravando;if(!ok)return false;return sujo?salvar():true;}
  if(!atual||!sujo)return true;
  const b=lerFormulario(),rev=edicoes;
  if(!b.titulo.trim()){avisar(I18N.t('Informe um nome para identificar a tarefa antes de salvar.'));return false;}
  const anterior=atual;
  gravando=(async()=>{
    try{
      const rota='/api/avaliacoes/operacao'+(anterior.id?'/'+anterior.id:'');
      const j=await api(rota,{method:anterior.id?'PUT':'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...b,versao:anterior.versao})});
      const i=tarefas.findIndex(t=>t.id===j.tarefa.id);if(i<0)tarefas.push(j.tarefa);else tarefas[i]=j.tarefa;
      atual=j.tarefa;sujo=edicoes!==rev;$('descartar').hidden=true;
      $('salvo').textContent=I18N.t('Checkpoint salvo: {data}',{data:new Date(atual.atualizadoEm).toLocaleString(I18N.locale,{timeZone:'America/Sao_Paulo'})});
      avisar(I18N.t(sujo?'Checkpoint salvo; há alterações novas a salvar.':'Checkpoint salvo. Você pode retomar por esta etapa.'));listar();return true;
    }catch(e){avisar(e.message);return false;}
    finally{gravando=null;}
  })();return gravando;
}
async function selecionar(id){if(!await salvar())return;const t=tarefas.find(t=>t.id===id);if(t){mostrar(t);avisar(I18N.t('Registro carregado. Continue a partir do seu próximo passo.'));}}
$('nova').onclick=async()=>{if(!await salvar())return;mostrar({titulo:'',referencia:'',status:'preparar',etapa:'acesso',turno:1,checks:{}});avisar(I18N.t('Novo registro manual. Nenhum modelo será chamado.'));$('titulo').focus();};
$('descartar').onclick=()=>{if(atual?.id)return;atual=null;sujo=false;$('registro').hidden=true;$('vazio').hidden=false;listar();avisar(I18N.t('Rascunho descartado.'));};
$('registro').addEventListener('input',()=>{sujo=true;edicoes++;$('salvo').textContent=I18N.t('Alterações ainda não salvas. Use Salvar ponto de retomada.');});
$('registro').addEventListener('change',()=>{sujo=true;edicoes++;});
$('registro').onsubmit=async e=>{e.preventDefault();await salvar();};
$('filtro').onchange=listar;
$('exportar').onclick=async()=>{
  if(!await salvar())return;
  try{const j=await api('/api/avaliacoes/operacao');const url=URL.createObjectURL(new Blob([JSON.stringify(j,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='nectar-tarefas-operacionais.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  catch(e){avisar(e.message);}
};
api('/api/avaliacoes/operacao').then(j=>{tarefas=j.tarefas;listar();avisar(I18N.t('Organizador pronto. Os registros são locais e preenchidos por você.'));}).catch(e=>avisar(e.message));
