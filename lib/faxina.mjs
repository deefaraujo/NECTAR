// Faxina da pasta de uma equipe: o que é temporário some sozinho, o que é para baixar fica um tempo e depois sai.
//
// Política (por pasta da equipe):
//   relatorios/<card>/   relatórios das etapas. Fica o final e as 3 revisões mais novas; cópia sem extensão (duplicata) sai na hora;
//                        card concluído há 30 dias (ou que não existe mais) leva a pasta inteira junto.
//   entregas/<data>-*/   pacotes da Assessoria (apresentação, relatório). Ficam 30 dias para baixar; 3 dias antes de sair, aviso no #equipe.
//   anexos/              o que você anexou no chat ou nos posts. Fica enquanto alguma mensagem apontar para ele; sem referência, sai.
//   revisoes/            worktrees de revisão (descartáveis). Saem depois de 7 dias.
//   *.tmp, *.ilegivel-*, *.vazio-apos-a-perda-*, *.antes-da-restauracao, *.bak-cancelados   restos de gravação. Saem depois de 7 dias.
//   skills/              cópia antiga das skills do template (hoje ficam numa pasta compartilhada). Sai.
// O que NUNCA sai daqui: os .json do estado, memoria/, fotos/, chats-arquivo/, pontos/ e _backups/ (têm a poda própria em pontos.mjs e store.mjs).
import fs from 'node:fs';
import path from 'node:path';
import { ler, gravar } from './store.mjs';

const DIA = 86_400_000;
export const POLITICA = {
  relatorios: { dias: 30, revisoes: 3, texto: 'relatórios de card: o final e as 3 revisões mais novas; 30 dias depois de concluir, a pasta sai' },
  entregas: { dias: 30, aviso: 3, texto: 'pacotes entregues: 30 dias para baixar, com aviso 3 dias antes de sair' },
  anexos: { texto: 'anexos do chat: ficam enquanto uma mensagem apontar para eles' },
  revisoes: { dias: 7, texto: 'worktrees de revisão: 7 dias' },
  temporarios: { dias: 7, texto: 'restos de gravação (.tmp, quarentena): 7 dias' },
};
const TEMPORARIO = /(\.tmp|\.ilegivel-\d+|\.vazio-apos-a-perda-\d+|\.antes-da-restauracao|\.bak-cancelados|\.antes-de-enxugar|\.antes-de-encolher-\d+)$/;

const tamanhoDe = (p) => { let t = 0; try { const st = fs.statSync(p); if (st.isFile()) return st.size; for (const x of fs.readdirSync(p)) t += tamanhoDe(path.join(p, x)); } catch { /* sumiu no meio */ } return t; };
const mtimeMax = (p) => { let m = 0; try { const st = fs.statSync(p); if (st.isFile()) return st.mtimeMs; for (const x of fs.readdirSync(p)) m = Math.max(m, mtimeMax(path.join(p, x))); } catch { /* segue */ } return m; };
export const tamanhoHumano = (b) => (b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : b >= 1024 ? `${Math.round(b / 1024)} KB` : `${b} B`);
const dataDaPasta = (nome) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(nome); return m ? Date.parse(`${m[1]}-${m[2]}-${m[3]}T12:00:00`) : null; };

/**
 * @param {{ pasta: string, quadro: { listar: () => any[] }, avisar?: (texto: string) => void, compartilhadaSkills?: string }} o
 */
export function criarFaxina({ pasta, quadro, avisar = () => {}, compartilhadaSkills = null }) {
  const arq = path.join(pasta, 'faxina.json');
  const st = ler(arq, { ultima: 0, avisadas: [] });
  const sub = (n) => path.join(pasta, n);

  /** Textos de referência que apontam para anexos: chats, posts e o arquivo de conversas antigas. */
  function referencias() {
    let txt = '';
    for (const f of ['chats.json', 'posts.json', 'board.json', 'notificacoes.json']) { try { txt += fs.readFileSync(sub(f), 'utf8'); } catch { /* sem arquivo */ } }
    try { for (const f of fs.readdirSync(sub('chats-arquivo'))) txt += fs.readFileSync(path.join(sub('chats-arquivo'), f), 'utf8'); } catch { /* sem arquivo */ }
    return txt;
  }

  /** O que seria removido agora (ou é removido, com `aplicar`). */
  function executar({ aplicar = true, agora = Date.now() } = {}) {
    const removidos = []; const avisos = [];
    const tira = (p, motivo, categoria) => { const bytes = tamanhoDe(p); removidos.push({ rel: path.relative(pasta, p).replace(/\\/g, '/'), bytes, motivo, categoria }); if (aplicar) { try { fs.rmSync(p, { recursive: true, force: true }); } catch { /* em uso: fica para a próxima */ } } };
    const cards = new Map((quadro?.listar?.() || []).map((c) => [c.id, c]));
    // relatórios
    try {
      for (const cardId of fs.readdirSync(sub('relatorios'))) {
        const dir = path.join(sub('relatorios'), cardId); let st0; try { st0 = fs.statSync(dir); } catch { continue; }
        if (!st0.isDirectory()) { if (TEMPORARIO.test(cardId) && agora - st0.mtimeMs > POLITICA.temporarios.dias * DIA) tira(dir, 'resto de gravação', 'temporarios'); continue; }
        const c = cards.get(cardId);
        const fechado = c ? (c.coluna === 'concluido' || c.arquivado) && agora - Date.parse(c.atualizado || 0) > POLITICA.relatorios.dias * DIA : agora - mtimeMax(dir) > POLITICA.relatorios.dias * DIA;
        if (fechado) { tira(dir, c ? `card concluído há mais de ${POLITICA.relatorios.dias} dias` : 'card não existe mais', 'relatorios'); continue; }
        const arquivos = fs.readdirSync(dir).map((n) => { const p = path.join(dir, n); let s; try { s = fs.statSync(p); } catch { return null; } return s.isFile() ? { n, p, mtime: s.mtimeMs } : null; }).filter(Boolean);
        const nomes = new Set(arquivos.map((a) => a.n));
        for (const a of arquivos) { if (!path.extname(a.n) && (nomes.has(`${a.n}.md`) || nomes.has(`${a.n}.json`))) tira(a.p, 'cópia sem extensão', 'relatorios'); }
        const revisoes = arquivos.filter((a) => path.extname(a.n) && !/final/i.test(a.n) && /-r\d+/.test(a.n)).sort((x, y) => y.mtime - x.mtime);
        for (const a of revisoes.slice(POLITICA.relatorios.revisoes)) tira(a.p, `só as ${POLITICA.relatorios.revisoes} revisões mais novas ficam`, 'relatorios');
      }
    } catch { /* sem relatórios */ }
    // entregas
    try {
      for (const n of fs.readdirSync(sub('entregas'))) {
        const dir = path.join(sub('entregas'), n); const quando = dataDaPasta(n) ?? mtimeMax(dir);
        const idade = agora - quando;
        if (idade > POLITICA.entregas.dias * DIA) { tira(dir, `entrega com mais de ${POLITICA.entregas.dias} dias`, 'entregas'); continue; }
        if (idade > (POLITICA.entregas.dias - POLITICA.entregas.aviso) * DIA && !st.avisadas.includes(n)) { avisos.push(n); if (aplicar) st.avisadas.push(n); }
      }
    } catch { /* sem entregas */ }
    // anexos sem referência
    try {
      const refs = referencias();
      for (const n of fs.readdirSync(sub('anexos'))) {
        const p = path.join(sub('anexos'), n); let s; try { s = fs.statSync(p); } catch { continue; }
        if (agora - s.mtimeMs < DIA) continue;   // recém-anexado: a mensagem pode ainda estar sendo escrita
        if (!refs.includes(n)) tira(p, 'nenhuma mensagem aponta para ele', 'anexos');
      }
    } catch { /* sem anexos */ }
    // revisões (worktrees) e restos temporários na raiz da pasta
    try { for (const n of fs.readdirSync(sub('revisoes'))) { const p = path.join(sub('revisoes'), n); if (agora - mtimeMax(p) > POLITICA.revisoes.dias * DIA) tira(p, `worktree de revisão com mais de ${POLITICA.revisoes.dias} dias`, 'revisoes'); } } catch { /* sem revisões */ }
    try { for (const n of fs.readdirSync(pasta)) { if (!TEMPORARIO.test(n)) continue; const p = sub(n); let s; try { s = fs.statSync(p); } catch { continue; } if (agora - s.mtimeMs > POLITICA.temporarios.dias * DIA) tira(p, 'resto de gravação', 'temporarios'); } } catch { /* segue */ }
    // cópia antiga das skills (hoje ficam numa pasta compartilhada entre os projetos)
    if (compartilhadaSkills && fs.existsSync(sub('skills')) && fs.existsSync(compartilhadaSkills)) tira(sub('skills'), 'skills agora ficam numa pasta compartilhada', 'skills');
    if (aplicar) { st.ultima = agora; gravar(arq, st); }
    if (aplicar) for (const n of avisos) avisar(`A entrega «${n}» sai da pasta em ${POLITICA.entregas.aviso} dias (entregas ficam ${POLITICA.entregas.dias} dias para baixar). Se quiser guardar, copie de entregas/${n}.`);
    const liberado = removidos.reduce((s, r) => s + r.bytes, 0);
    return { removidos, liberado, liberadoTexto: tamanhoHumano(liberado), avisos };
  }

  /** Quanto cada categoria ocupa, com a política de cada uma, e o que a próxima faxina removeria. */
  function inventario() {
    const cats = [['estado', ['board.json', 'chats.json', 'posts.json', 'notificacoes.json', 'perguntas.json', 'perfis.json', 'grupos.json', 'memoria', 'chats-arquivo'], 'estado do projeto: fica sempre'],
      ['relatorios', ['relatorios'], POLITICA.relatorios.texto], ['entregas', ['entregas'], POLITICA.entregas.texto], ['anexos', ['anexos'], POLITICA.anexos.texto], ['fotos', ['fotos'], 'fotos e capas dos perfis: ficam sempre'],
      ['pontos', ['pontos'], 'pontos de salvamento: 6 automáticos recentes + 1 por dia em 7 dias; os manuais ficam'], ['backups', ['_backups'], 'cópias de segurança por hora: 12 horas + 1 por dia em 7 dias'], ['revisoes', ['revisoes'], POLITICA.revisoes.texto]];
    const itens = cats.map(([id, lista, texto]) => ({ id, texto, bytes: lista.reduce((s, n) => s + (fs.existsSync(sub(n)) ? tamanhoDe(sub(n)) : 0), 0) })).map((x) => ({ ...x, tamanho: tamanhoHumano(x.bytes) }));
    const total = tamanhoDe(pasta);
    const previa = executar({ aplicar: false });
    return { total, totalTexto: tamanhoHumano(total), itens, ultima: st.ultima || null, previa: { n: previa.removidos.length, liberadoTexto: previa.liberadoTexto } };
  }

  /** Uma vez a cada 12 h (e na abertura, se passou do prazo). */
  function tick() {
    if (Date.now() - (st.ultima || 0) < 12 * 3_600_000) return null;
    return executar();
  }
  return { executar, inventario, tick };
}
