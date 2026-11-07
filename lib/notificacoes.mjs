// Central de notificações de um projeto: tudo que aconteceu e merece ser visto (card que andou, bloqueio,
// dúvida do time, aviso de créditos, relatório). É um registro feito pelo app, sem modelo nenhum:
// cada evento do quadro e da equipe vira uma linha aqui, guardada em disco, com lida ou não lida.
import { ler, gravarDepois } from './store.mjs';

const NIVEIS = new Set(['info', 'ok', 'atencao', 'urgente']);

export function criarNotificacoes({ dir, emitir }) {
  const st = ler(`${dir}/notificacoes.json`, { seq: 0, lista: [] });
  const salvar = () => gravarDepois(`${dir}/notificacoes.json`, () => st);

  /** tipo: card | pergunta | creditos | relatorio | aviso. nivel: info | ok | atencao | urgente. */
  function add({ tipo, nivel = 'info', titulo, texto = '', agente = null, card = null, canal = null, dados = null }) {
    const ultima = st.lista[st.lista.length - 1];
    if (ultima && ultima.tipo === tipo && ultima.titulo === titulo && ultima.texto === texto && Date.now() - Date.parse(ultima.em) < 3000) return ultima;
    const n = {
      id: `n${++st.seq}`, em: new Date().toISOString(), tipo, nivel: NIVEIS.has(nivel) ? nivel : 'info',
      titulo: String(titulo || '').slice(0, 160), texto: String(texto || '').slice(0, 600), agente, card, canal, dados, lida: false,
    };
    st.lista.push(n);
    if (st.lista.length > 300) st.lista.splice(0, st.lista.length - 300);
    salvar();
    emitir({ tipo: 'notif', notif: n, naoLidas: naoLidas() });
    return n;
  }

  const listar = (limite = 120) => st.lista.slice(-limite).reverse();
  const naoLidas = () => st.lista.filter((n) => !n.lida).length;

  function marcarLidas(ids) {
    const todas = ids === 'todas';
    const alvo = new Set(Array.isArray(ids) ? ids : []);
    let mudou = false;
    for (const n of st.lista) if (!n.lida && (todas || alvo.has(n.id))) { n.lida = true; mudou = true; }
    if (mudou) { salvar(); emitir({ tipo: 'notif.lidas', naoLidas: naoLidas() }); }
    return { ok: true, naoLidas: naoLidas() };
  }

  return { add, listar, naoLidas, marcarLidas };
}
