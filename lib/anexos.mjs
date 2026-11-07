// Anexos do chat: quando o arquivo é um PDF, o app extrai o texto na hora do envio (sem modelo) e guarda ao lado do
// original, em <arquivo>.txt. Assim qualquer agente lê o conteúdo, inclusive o Codex, que não abre PDF.
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const LIMITE_TEXTO = 400_000;

const comPrazo = async (promessa, ms, msg) => {
  let timer;
  try { return await Promise.race([promessa, new Promise((_, rej) => { timer=setTimeout(() => rej(new Error(msg)), ms); })]); }
  finally { clearTimeout(timer); }
};
const limpar = (t) => String(t || '').replace(/\r/g, '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();

function pdftotext(arquivo) {
  return new Promise((resolve) => {
    execFile('pdftotext', ['-layout', arquivo, '-'], { windowsHide: true, timeout: 40_000, maxBuffer: 32 * 1024 * 1024 }, (e, saida) => resolve(e ? '' : String(saida || '')));
  });
}

/** Extrai o texto de um PDF e grava em <arquivo>.txt. Devolve { ok, chars, motivo }. Outros formatos não precisam. */
export async function extrairTexto(arquivo) {
  if (path.extname(arquivo).toLowerCase() !== '.pdf') return { ok: false, motivo: 'não é PDF' };
  let texto = ''; let erro = '';
  try {
    const pdf = require('pdf-parse/lib/pdf-parse.js');
    const r = await comPrazo(pdf(fs.readFileSync(arquivo)), 45_000, 'a leitura do PDF demorou demais');
    texto = limpar(r.text);
  } catch (e) { erro = e.message; }
  if (texto.length < 20) texto = limpar(await pdftotext(arquivo));
  if (texto.length < 20) return { ok: false, motivo: erro || 'o PDF não tem texto selecionável (talvez seja imagem escaneada)' };
  try { fs.writeFileSync(`${arquivo}.txt`, texto.slice(0, LIMITE_TEXTO)); } catch (e) { return { ok: false, motivo: e.message }; }
  return { ok: true, chars: Math.min(texto.length, LIMITE_TEXTO) };
}
