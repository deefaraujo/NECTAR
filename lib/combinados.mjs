// Combinados com a Game Director: o que ela autorizou ou proibiu expressamente nos pedidos ("podem ficar livres
// para X, só não façam Y"). O app guarda a frase dela, sem paráfrase, e mostra a todos os agentes. Acesso técnico é
// total; o combinado é o que decide se uma ação arriscada segue direto ou vira pergunta para ela. Não chama modelo.
import path from 'node:path';
import { ler, gravar } from './store.mjs';

// Ação arriscada: destrutiva, irreversível, em produção, paga, com credencial ou que sai do computador.
export const ARRISCADA = /produ[cç][aã]o|\bprod\b|deploy|publicar|apag|delet|exclu[ií]r|remov|drop\b|truncat|reset --hard|recri|for[cç]ad|--force|push|merge na (develop|main|master)|\b(develop|main|master)\b|rebase|credenc|senha|token|chave de api|\.env\b|pagar|pago|cobran|assinatura|compra|us\$|r\$|enviar (e-?mail|mensagem)|irrevers|migra[cç][aã]o/i;
const AUTORIZA = /\b(podem?|pode ficar|fiquem? livres?|est[aã]o livres?|liberad[oa]s?|autorizo|autorizad[oa]s?|t[eê]m permiss[aã]o|sem precisar (me )?perguntar)\b/i;
const PROIBE = /\b(n[aã]o (fa[cç]am|fa[cç]a|mexam|mexa|toquem|toque|apaguem|apague|subam|suba|usem|use|rodem|rode|mandem|mande|pode|podem)|nunca|proibid[oa]|sem (mexer|tocar|apagar))\b/i;

export function criarCombinados({ pasta }) {
  const arquivo = path.join(pasta, 'combinados.json');
  const estado = ler(arquivo, { lista: [] });
  const salvar = () => gravar(arquivo, estado);

  /** Guarda as frases de autorização ou proibição de uma mensagem dela. Devolve as que entraram. */
  function capturar(texto, { canal = null, card = null } = {}) {
    const frases = String(texto || '').split(/(?<=[.!?;\n])\s+/).map((f) => f.trim()).filter((f) => f.length >= 8 && f.length <= 400);
    const novos = [];
    for (const f of frases) {
      const proibe = PROIBE.test(f); const autoriza = AUTORIZA.test(f);
      if (!proibe && !autoriza) continue;
      if (estado.lista.some((c) => c.texto === f)) continue;
      const c = { tipo: proibe && !autoriza ? 'proibe' : autoriza && !proibe ? 'autoriza' : 'misto', texto: f, em: new Date().toISOString(), canal, card };
      estado.lista.push(c); novos.push(c);
    }
    if (novos.length) { if (estado.lista.length > 60) estado.lista.splice(0, estado.lista.length - 60); salvar(); }
    return novos;
  }
  function remover(i) { const r = estado.lista.splice(Number(i), 1); salvar(); return r[0] || null; }
  const listar = () => estado.lista.slice();
  function paraPrompt() {
    if (!estado.lista.length) return '';
    return estado.lista.slice(-15).map((c) => `- (${c.tipo === 'proibe' ? 'proibido' : c.tipo === 'autoriza' ? 'autorizado' : 'autorizado com limite'}${c.card ? `, ${c.card}` : ''}) "${c.texto}"`).join('\n');
  }
  return { capturar, remover, listar, paraPrompt };
}
