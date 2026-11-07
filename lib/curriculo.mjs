import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
export const LIMITE_PDF_CURRICULO = 10 * 1024 * 1024;

// Extração em memória: o currículo original não é persistido no servidor.
export async function lerCurriculoPdf(base64) {
  if (typeof base64 !== 'string' || !base64.length || base64.length % 4 !== 0 || base64.length > Math.ceil(LIMITE_PDF_CURRICULO / 3) * 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(base64)) throw new Error('PDF inválido ou maior que 10 MB.');
  const buffer = Buffer.from(base64, 'base64');
  if (buffer.length > LIMITE_PDF_CURRICULO || !buffer.subarray(0, 1024).includes(Buffer.from('%PDF-'))) throw new Error('O arquivo não é um PDF válido de até 10 MB.');
  let timer;
  try {
    const pdf = require('pdf-parse/lib/pdf-parse.js');
    const resultado = await Promise.race([
      pdf(buffer),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('A leitura do PDF demorou demais.')), 45000); })
    ]);
    const texto = String(resultado.text || '').replace(/\r/g, '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
    if (!texto) throw new Error('Este PDF não contém texto extraível. Se for digitalizado, envie uma versão com texto selecionável ou cole o currículo no campo.');
    if (texto.length > 40000) throw new Error('O PDF contém mais de 40 mil caracteres. Envie um currículo menor.');
    return { texto, paginas: resultado.numpages };
  } catch (e) {
    if (/texto extraível|40 mil|demorou/.test(e.message)) throw e;
    throw new Error('Não foi possível ler o PDF. Verifique se está íntegro e sem proteção por senha.');
  } finally { clearTimeout(timer); }
}
