// Documento entregue no chat: o agente gera o arquivo (PDF, Word, PowerPoint, planilha, relatório) e ele aparece anexado
// na mensagem, pronto para baixar, em vez de "está na pasta X". O app copia para <pasta do projeto>/anexos/<dia>/,
// a mesma pasta dos anexos que a Game Director envia. Não chama modelo.
import fs from 'node:fs';
import path from 'node:path';

export const LIMITE = 25 * 1024 * 1024;
const EXT = /\.(pdf|docx?|pptx?|xlsx?|csv|md|html?|txt|json|zip|png|jpe?g|gif|webp|svg|mp4|mp3|wav)$/i;
const IMAGEM = /\.(png|jpe?g|gif|webp)$/i;
const TIPOS = { '.pdf': 'application/pdf', '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation', '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.zip': 'application/zip', '.csv': 'text/csv', '.md': 'text/markdown', '.html': 'text/html', '.txt': 'text/plain', '.json': 'application/json' };

/** Copia um arquivo para os anexos do projeto e devolve o anexo no formato das mensagens ({nome, tipo, tamanho, rel, imagem}). */
export function anexarArquivo({ pasta, arquivo, nome = null }) {
  const st = fs.statSync(arquivo);
  if (!st.isFile()) throw new Error(`${arquivo} não é arquivo`);
  if (st.size > LIMITE) throw new Error(`${path.basename(arquivo)} passa de 25 MB`);
  const limpo = String(nome || path.basename(arquivo)).replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').trim().slice(-90) || 'arquivo';
  const agora = new Date();
  const dia = agora.toISOString().slice(0, 10);
  const hora = agora.toTimeString().slice(0, 8).replace(/:/g, '');
  const rel = `${dia}/${hora}-${limpo}`;
  const destino = path.join(pasta, 'anexos', dia, `${hora}-${limpo}`);
  fs.mkdirSync(path.dirname(destino), { recursive: true });
  if (path.resolve(arquivo) !== path.resolve(destino)) fs.copyFileSync(arquivo, destino);
  const ext = path.extname(limpo).toLowerCase();
  return { nome: limpo, tipo: TIPOS[ext] || 'application/octet-stream', tamanho: st.size, rel, ...(IMAGEM.test(limpo) ? { imagem: true } : {}) };
}

/** Caminhos de documento citados no texto que existem e foram mexidos há pouco (o agente acabou de gerar). */
export function documentosCitados(texto, { bases = [], recenteMs = 6 * 3600_000 } = {}) {
  const achados = new Set();
  const re = /`([^`\n]+)`|"([^"\n]+)"|((?:[A-Za-z]:)?[\\/]?[^\s"'`<>|*()]+)/g;
  for (const m of String(texto || '').matchAll(re)) {
    const c = (m[1] || m[2] || m[3] || '').replace(/[.,;:!?)\]]+$/, '').trim();
    if (!c || !EXT.test(c) || /^https?:/i.test(c)) continue;
    const candidatos = path.isAbsolute(c) ? [c] : bases.map((b) => path.resolve(b, c));
    for (const abs of candidatos) {
      try { const st = fs.statSync(abs); if (st.isFile() && st.size <= LIMITE && Date.now() - st.mtimeMs < recenteMs) { achados.add(path.resolve(abs)); break; } } catch { /* não existe */ }
    }
  }
  return [...achados].slice(0, 8);
}
