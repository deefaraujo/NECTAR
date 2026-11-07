// State derived from the executed actions, without touching the DOM or platform APIs.
export function estadoTestesProgramacao(historico=[]) {
  let s={executado:false,avaliado:false,aprovado:false,evidencia:'',comparacao:'',linguagem:''};
  const limpar=()=>{s={...s,executado:false,avaliado:false,aprovado:false,evidencia:'',comparacao:''};};
  for(const e of historico){
    if(e.executada===false)continue;
    const a=e.acao||e,o=a.observacao||{};
    if(o.etapa==='avancar'){limpar();s.linguagem='';continue;}
    if(a.linguagem){
      const atual=a.linguagem.selecionada||'';
      if(a.linguagem.confirmada===false||(s.linguagem&&atual&&atual!==s.linguagem))limpar();
      if(atual)s.linguagem=atual;
    }
    const edicao=['codigo','digitar'].includes(a.tipo)||(['editar','corrigir'].includes(o.etapa)&&['clicar','tecla'].includes(a.tipo))||(a.tipo==='tecla'&&['CTRL+Z','BACKSPACE','DELETE'].includes(a.tecla));
    if(edicao){limpar();continue;}
    if(o.etapa==='submeter'&&['clicar','tecla'].includes(a.tipo)){limpar();continue;}
    if(o.etapa==='executar'&&['clicar','tecla'].includes(a.tipo)){
      limpar();s.executado=true;continue;
    }
    if(!s.executado||o.etapa!=='verificar')continue;
    const avaliacao=a.avaliacaoTeste;
    if(avaliacao?.resultado==='aprovado'&&o.veredito==='exemplos_ok'&&avaliacao.comparacao?.trim()&&avaliacao.evidencia?.trim()){
      s.avaliado=true;s.aprovado=true;s.evidencia=avaliacao.evidencia;s.comparacao=avaliacao.comparacao;
    }else if(avaliacao?.resultado==='reprovado'||['resposta_incorreta','erro_compilacao','erro_execucao','tempo_excedido','memoria_excedida'].includes(o.veredito)){
      s.avaliado=true;s.aprovado=false;s.evidencia=o.evidencia||'';s.comparacao=avaliacao?.comparacao||'';
    }
  }
  return s;
}
export function validarSubmissaoProgramacao(a,historico=[]){
  if(a.avaliacaoTeste!==undefined){
    const t=a.avaliacaoTeste;
    if(!t||!['aprovado','reprovado','em_execucao'].includes(t.resultado)||typeof t.comparacao!=='string'||t.comparacao.length>1200||typeof t.evidencia!=='string'||t.evidencia.length>1000)throw new Error('Avaliação dos testes inválida');
  }
  if(a.observacao?.etapa==='submeter'&&['clicar','tecla'].includes(a.tipo)){
    const s=estadoTestesProgramacao(historico);
    const mudouLinguagem=a.linguagem&&(a.linguagem.confirmada===false||(s.linguagem&&a.linguagem.selecionada&&s.linguagem!==a.linguagem.selecionada));
    const resultadoAtualInvalido=['resposta_incorreta','erro_compilacao','erro_execucao','tempo_excedido','memoria_excedida'].includes(a.observacao.veredito)||(a.avaliacaoTeste&&a.avaliacaoTeste.resultado!=='aprovado');
    if(!s.executado||!s.avaliado||!s.aprovado||mudouLinguagem||resultadoAtualInvalido)throw new Error('Submissão bloqueada: execute Run/Test e avalie o resultado aprovado do código atual antes de Submit. Alterações no código, linguagem ou questão exigem novos testes.');
  }
  return a;
}
