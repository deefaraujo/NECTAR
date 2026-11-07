// Storyboard animado: junta os quadros de uma cena (imagens geradas ou enviadas) num GIF vertical 9:16 com o ffmpeg.
// Cada quadro fica `duracao` segundos na tela; imagem de outro tamanho é encaixada sem distorcer (tarja na cor do fundo).
// A paleta é gerada a partir dos próprios quadros, para o GIF não perder cor. Não chama modelo.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const FAKE = process.env.STUDIO_FAKE === '1';
const IMAGEM = /\.(png|jpe?g|webp|gif|bmp)$/i;
// GIF mínimo válido (1x1), o papel do montado no modo de teste
const GIF_TESTE = Buffer.from('R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==', 'base64');

export const FORMATOS = { vertical: [540, 960], quadrado: [720, 720], horizontal: [960, 540] };

/**
 * @param {{ quadros: string[], destino: string, duracao?: number, formato?: string, fundo?: string, ffmpeg?: string }} o
 * @returns {{ ok: boolean, arquivo?: string, quadros?: number, erro?: string }}
 */
export function montarGif({ quadros, destino, duracao = 0.8, formato = 'vertical', fundo = 'black', ffmpeg = 'ffmpeg' }) {
  const lista = (quadros || []).map(String).filter((q) => IMAGEM.test(q));
  const faltam = lista.filter((q) => !fs.existsSync(q));
  if (faltam.length) return { ok: false, erro: `não encontrei ${faltam.join(', ')}` };
  if (lista.length < 2) return { ok: false, erro: 'o GIF precisa de pelo menos 2 quadros (imagens).' };
  if (lista.length > 24) return { ok: false, erro: 'até 24 quadros por GIF; divida a cena.' };
  const d = Math.min(5, Math.max(0.15, Number(duracao) || 0.8));
  const [w, h] = FORMATOS[formato] || FORMATOS.vertical;
  const cor = /^(#?[0-9a-f]{6}|[a-z]+)$/i.test(String(fundo)) ? String(fundo).replace(/^#/, '0x') : 'black';
  fs.mkdirSync(path.dirname(destino), { recursive: true });
  if (FAKE) { fs.writeFileSync(destino, GIF_TESTE); return { ok: true, arquivo: destino, quadros: lista.length }; }
  const entradas = lista.flatMap((q) => ['-loop', '1', '-t', String(d), '-i', q]);
  const enc = lista.map((_, i) => `[${i}:v]scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2:color=${cor},setsar=1,fps=12[q${i}]`).join(';');
  const filtro = `${enc};${lista.map((_, i) => `[q${i}]`).join('')}concat=n=${lista.length}:v=1:a=0,split[a][b];[a]palettegen=stats_mode=full[p];[b][p]paletteuse=dither=sierra2_4a`;
  try {
    execFileSync(ffmpeg, ['-y', '-v', 'error', ...entradas, '-filter_complex', filtro, '-loop', '0', destino], { stdio: ['ignore', 'ignore', 'pipe'], timeout: 120000, windowsHide: true });
  } catch (e) {
    const msg = String(e.stderr || e.message || '').trim().split('\n').slice(-2).join(' ');
    return { ok: false, erro: e.code === 'ENOENT' ? 'o ffmpeg não está instalado nesta máquina (winget install ffmpeg).' : `ffmpeg: ${msg.slice(0, 300)}` };
  }
  return fs.existsSync(destino) ? { ok: true, arquivo: destino, quadros: lista.length } : { ok: false, erro: 'o ffmpeg terminou sem gerar o GIF.' };
}
