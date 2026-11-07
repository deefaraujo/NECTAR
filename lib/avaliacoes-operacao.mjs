import crypto from 'node:crypto';
import { ler, gravar } from './store.mjs';
const ARQUIVO='avaliacoes-operacao.json';
export const ETAPAS=['acesso','repositorio','turno1','respostas','avaliacao_manual','proximo_turno','envio','retorno'];
export const STATUS=['preparar','em_andamento','aguardando_modelos','pendencia','concluida','rework'];
export const CHECKS=['extensao','login','proxy','instrucoes','licenca','privacidade'];
export function validarRegistroOperacional(b){
  const texto=(chave,max)=>{const v=b[chave]??'';if(typeof v!=='string'||v.length>max)throw new Error(`Campo inválido: ${chave}`);return v.trim();};
  const titulo=texto('titulo',160);if(!titulo)throw new Error('Informe um nome para identificar a tarefa');
  if(!ETAPAS.includes(b.etapa)||!STATUS.includes(b.status)||!Number.isInteger(b.turno)||b.turno<1||b.turno>99)throw new Error('Etapa, status ou turno inválido');
  const checks={};for(const c of CHECKS){if(b.checks?.[c]!==undefined&&typeof b.checks[c]!=='boolean')throw new Error('Checklist inválido');checks[c]=b.checks?.[c]===true;}
  return {titulo,referencia:texto('referencia',500),etapa:b.etapa,status:b.status,turno:b.turno,proximoPasso:texto('proximoPasso',1500),pendencia:texto('pendencia',1500),notas:texto('notas',4000),checks};
}
export function criarOrganizador({lerImpl=ler,gravarImpl=gravar,agora=()=>new Date().toISOString()}={}){
  const carregar=()=>lerImpl(ARQUIVO,{schema:'nectar.operacao-avaliacoes.v1',tarefas:[]});
  return {
    listar(){return carregar();},
    criar(b){
      const s=carregar();if(s.tarefas.length>=500)throw new Error('Limite de 500 registros atingido');
      const t={...validarRegistroOperacional(b),id:crypto.randomUUID(),versao:1,criadoEm:agora(),atualizadoEm:agora()};s.tarefas.push(t);gravarImpl(ARQUIVO,s);return t;
    },
    atualizar(id,b){
      const s=carregar(),i=s.tarefas.findIndex(t=>t.id===id);if(i<0)throw new Error('Registro não encontrado');
      if(b.versao!==s.tarefas[i].versao){const e=new Error('Este registro mudou em outra janela. Recarregue antes de salvar.');e.status=409;throw e;}
      const t={...s.tarefas[i],...validarRegistroOperacional(b),versao:s.tarefas[i].versao+1,atualizadoEm:agora()};s.tarefas[i]=t;gravarImpl(ARQUIVO,s);return t;
    }
  };
}
export const organizadorAvaliacoes=criarOrganizador();
