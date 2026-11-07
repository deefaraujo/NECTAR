// Onde cada projeto guarda os registros do time.
//
// Todo projeto ganha uma pasta com o nome dele DENTRO da pasta do programa (padrão: <programa>/projetos/<nome>).
// Ali ficam a memória (contextos, decisões, aprendizados de cada agente), o quadro, as conversas, as
// notificações, os perfis e as fotos dos agentes. Essa NÃO é a pasta que o time analisa: a pasta alvo do
// projeto (o código, o jogo, o repositório) fica onde estiver, e é só o ponto de partida do P.O. Os agentes
// podem olhar outros diretórios do computador quando o caminho é citado ou está nas pastas extras do projeto.
//
// No .exe, o Electron define STUDIO_PROJETOS (Documents/Game Studio AI/projetos), porque a pasta do código
// empacotado não é gravável.
import fs from 'node:fs';
import path from 'node:path';
import { normalizar } from './agentes.mjs';

export const RAIZ_PROJETOS = path.resolve(process.env.STUDIO_PROJETOS || path.resolve(import.meta.dirname, '..', 'projetos'));

const RESERVADOS = new Set(['con', 'prn', 'aux', 'nul', 'com1', 'com2', 'com3', 'lpt1', 'lpt2', 'lpt3']);

/** Nome de pasta seguro no Windows, mantendo acento e espaço (o nome do projeto continua legível). */
export function nomeSeguro(nome) {
  let n = String(nome || '').normalize('NFC').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '').replace(/\s+/g, ' ').replace(/[. ]+$/g, '').trim().slice(0, 60);
  if (!n) n = 'Projeto';
  if (RESERVADOS.has(normalizar(n))) n = `${n} projeto`;
  return n;
}

export const caminhoDe = (pasta) => path.join(RAIZ_PROJETOS, pasta);

const lerInfo = (pasta) => { try { return JSON.parse(fs.readFileSync(path.join(caminhoDe(pasta), 'projeto.json'), 'utf8')); } catch { return null; } };
const mesmoCaminho = (a, b) => !!a && !!b && path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();

/**
 * Escolhe e cria a pasta do projeto. Se já existe uma pasta de mesmo nome que pertence à MESMA pasta alvo
 * (o projeto foi removido do app e adicionado de novo), reaproveita: o histórico e a memória voltam.
 */
export function reservarPasta(nome, alvo, jaUsadas = new Set()) {
  fs.mkdirSync(RAIZ_PROJETOS, { recursive: true });
  const base = nomeSeguro(nome);
  for (let i = 1; i < 500; i++) {
    const cand = i === 1 ? base : `${base} ${i}`;
    const dir = caminhoDe(cand);
    if (jaUsadas.has(cand.toLowerCase())) continue;
    if (!fs.existsSync(dir)) { fs.mkdirSync(dir, { recursive: true }); return { pasta: cand, reaproveitada: false }; }
    const info = lerInfo(cand);
    if (info && mesmoCaminho(info.alvo, alvo)) return { pasta: cand, reaproveitada: true };
  }
  throw new Error('Não consegui um nome de pasta livre para o projeto.');
}

/** projeto.json: quem é este projeto (para a pasta se explicar sozinha e poder ser reconhecida depois). */
export function gravarInfo(pasta, p) {
  const f = path.join(caminhoDe(pasta), 'projeto.json');
  try {
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, JSON.stringify({ nome: p.nome, alvo: p.raiz, template: p.template, criado: p.criado, extras: p.extras || [] }, null, 2));
  } catch { /* sem permissão: o registro do app continua valendo */ }
}

/** Copia o que o projeto tinha na versão anterior (dados do app e .gamestudio dentro do alvo) sem apagar nada. */
export function migrarLegado({ pasta, alvo, dadosAntigos }) {
  const dest = caminhoDe(pasta);
  const copiar = (de, para) => { try { if (fs.existsSync(de) && !fs.existsSync(para)) fs.cpSync(de, para, { recursive: true }); } catch { /* segue */ } };
  if (dadosAntigos && fs.existsSync(dadosAntigos)) {
    for (const f of fs.readdirSync(dadosAntigos)) copiar(path.join(dadosAntigos, f), path.join(dest, f));
  }
  const antiga = path.join(alvo, '.gamestudio');
  copiar(path.join(antiga, 'memoria'), path.join(dest, 'memoria'));
  copiar(path.join(antiga, 'quadro.md'), path.join(dest, 'quadro.md'));
}
