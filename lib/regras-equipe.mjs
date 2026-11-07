import path from 'node:path';
import { ler, gravar } from './store.mjs';

export function criarRegrasEquipe({ pasta, lead, ids }) {
  const arquivo = path.join(pasta, 'regras-equipe.json');
  const estado = ler(arquivo, { regras: [], historico: [] });
  function definir(a, autor) {
    if (autor !== lead && autor !== 'voce') throw new Error('Só a P.O. ou a pessoa responsável pode definir regras da equipe.');
    if (!/^[a-z0-9][a-z0-9-]{0,59}$/.test(a.id || '')) throw new Error('A regra precisa de id estável (letras, números e hífen).');
    const escopo = a.escopo || 'todos';
    if (escopo !== 'todos' && !ids.has(escopo)) throw new Error('Escopo de regra desconhecido.');
    const texto = String(a.texto || '').trim(), motivo = String(a.motivo || '').trim(), origem = String(a.origem || '').trim();
    if (!texto || !motivo || !origem || texto.length > 1500 || motivo.length > 700 || origem.length > 300) throw new Error('Informe texto, motivo e origem da decisão dentro dos limites.');
    const anterior = estado.regras.findIndex(r => r.id === a.id);
    if (anterior < 0 && estado.regras.length >= 50) throw new Error('Limite de 50 regras. Revise regras existentes antes de criar novas.');
    const regra = { id: a.id, escopo, texto, motivo, origem, ativa: a.ativa !== false, autor, em: new Date().toISOString() };
    if (anterior < 0) estado.regras.push(regra); else estado.regras[anterior] = regra;
    estado.historico.push(regra);
    estado.historico = estado.historico.slice(-300);
    gravar(arquivo, estado);
    return regra;
  }
  const listar = () => structuredClone(estado.regras);
  const paraPrompt = (agente) => estado.regras.filter(r => r.ativa && (r.escopo === 'todos' || r.escopo === agente)).map(r => `- [${r.id}] ${r.texto}\n  Motivo: ${r.motivo}; origem: ${r.origem}`).join('\n');
  return { definir, listar, paraPrompt };
}
