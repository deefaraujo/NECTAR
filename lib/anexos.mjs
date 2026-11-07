// Chat attachments: when the file is a PDF, the app extracts the text at send time (no model) and stores it next to the
// original, in <arquivo>.txt. That way any agent can read the content, including Codex, which does not open PDFs.
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

/** Extracts the text from a PDF and writes it to <arquivo>.txt. Returns { ok, chars, motivo }. Other formats do not need it. */
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
