// Image generation via Codex (built-in image_gen tool, with the ChatGPT login: no API key; counts against the
// plan's limit). Claude Code does not generate images, so whoever asks (the user with @Image, or an agent with imagem.gerar)
// always goes through here. Codex saves to $CODEX_HOME/generated_images; the app copies the new one into the project's attachments.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { executar } from './runner.mjs';

const FAKE = process.env.STUDIO_FAKE === '1';
const pastaGeradas = () => path.join(process.env.CODEX_HOME || path.join(os.homedir(), '.codex'), 'generated_images');
const EXT = /\.(png|jpe?g|webp|gif)$/i;

function imagensDesde(desde) {
  const out = [];
  const andar = (d, n = 0) => { let it = []; try { it = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of it) { const p = path.join(d, e.name); if (e.isDirectory() && n < 3) andar(p, n + 1); else if (EXT.test(e.name)) { try { const st = fs.statSync(p); if (st.mtimeMs >= desde) out.push({ p, t: st.mtimeMs }); } catch { /* vanished */ } } } };
  andar(pastaGeradas());
  return out.sort((a, b) => a.t - b.t).map((x) => x.p);
}

const slug = (t) => String(t || 'imagem').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'imagem';
const PNG_TESTE = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

/**
 * Generates one or more images and copies them to `pastaAnexos/<dia>/`.
 * @returns {{ ok, anexos: [{nome, tipo, tamanho, rel, imagem, caminho}], texto, erro }}
 */
export async function gerar({ prompt, nome = '', referencias = [], pastaAnexos, cwd, codexExe, modelo = null }) {
  const pedido = String(prompt || '').trim();
  if (!pedido) return { ok: false, erro: 'Descreva a imagem que você quer.' };
  const inicio = Date.now() - 2000;
  const dia = new Date().toISOString().slice(0, 10);
  const destDir = path.join(pastaAnexos, dia);
  fs.mkdirSync(destDir, { recursive: true });
  let novas = [], texto = '';
  if (FAKE) {   // test mode: no calls; a 1 px image stands in for the generated one
    const f = path.join(destDir, `teste-${Date.now()}.png`); fs.writeFileSync(f, PNG_TESTE); novas = [f]; texto = 'SIMULADO: imagem gerada.';
  } else {
    const refs = referencias.filter((r) => fs.existsSync(r));
    const instr = [
      'Use a sua ferramenta de geração de imagem (image_gen) para criar a imagem pedida abaixo. Não escreva código, não use script nem API: só a ferramenta embutida.',
      refs.length ? `Use como referência visual estas imagens (abra com view_image antes): ${refs.join(' ; ')}` : '',
      `Pedido: ${pedido}`,
      'Gere uma imagem (ou as variações que o pedido pedir). Depois responda só com uma linha dizendo o que gerou.',
    ].filter(Boolean).join('\n\n');
    const r = await executar({ engine: 'codex', prompt: instr, cwd: cwd || pastaAnexos, codexExe, modelo, modo: 'trabalhar', addDirs: refs.map((x) => path.dirname(x)) });
    if (r.erro) return { ok: false, erro: `O Codex não gerou a imagem: ${r.erro}` };
    texto = String(r.texto || '').trim();
    novas = imagensDesde(inicio);
    if (!novas.length) return { ok: false, erro: 'O Codex respondeu, mas nenhuma imagem nova apareceu na pasta dele. Confira se o Codex está conectado com a conta do ChatGPT (Ajustes, Modelos) e se o plano permite gerar imagem.', texto };
  }
  const anexos = novas.slice(-4).map((orig, i) => {
    const ext = path.extname(orig).toLowerCase() || '.png';
    const arq = `${new Date().toTimeString().slice(0, 8).replace(/:/g, '')}-${slug(nome || pedido)}${novas.length > 1 ? `-${i + 1}` : ''}${ext}`;
    const destino = path.join(destDir, arq);
    if (path.resolve(orig) !== path.resolve(destino)) fs.copyFileSync(orig, destino);
    const tam = fs.statSync(destino).size;
    return { nome: arq, tipo: ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : `image/${ext.slice(1)}`, tamanho: tam, rel: `${dia}/${arq}`, imagem: true, caminho: destino };
  });
  return { ok: true, anexos, texto };
}

/** "@Image ..." or "@imagem ..." at the start or in the middle of the message: what remains is the request. */
export const IMAGE_RE = /(^|\s)@(image|imagem|img)\b/i;
export const pedidoDeImagem = (texto) => (IMAGE_RE.test(texto || '') ? String(texto).replace(/(^|\s)@(image|imagem|img)\b/gi, ' ').replace(/\s+/g, ' ').trim() : null);
