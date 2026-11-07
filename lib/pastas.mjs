// Where each project keeps the team's records.
//
// Every project gets a folder named after it INSIDE the program folder (default: <programa>/projetos/<nome>).
// That holds the memory (contexts, decisions, learnings of each agent), the board, the conversations, the
// notifications, the profiles and the agents' photos. This is NOT the folder the team analyzes: the project's target
// folder (the code, the game, the repository) stays where it is, and is only the P.O.'s starting point. Agents
// may look at other directories on the computer when the path is mentioned or is in the project's extra folders.
//
// In the .exe, Electron sets STUDIO_PROJETOS (Documents/Game Studio AI/projetos), because the packaged code
// folder is not writable.
import fs from 'node:fs';
import path from 'node:path';
import { normalizar } from './agentes.mjs';

export const RAIZ_PROJETOS = path.resolve(process.env.STUDIO_PROJETOS || path.resolve(import.meta.dirname, '..', 'projetos'));

const RESERVADOS = new Set(['con', 'prn', 'aux', 'nul', 'com1', 'com2', 'com3', 'lpt1', 'lpt2', 'lpt3']);

/** Folder name that is safe on Windows, keeping accents and spaces (the project name stays readable). */
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
 * Picks and creates the project folder. If a folder with the same name already exists and belongs to the SAME target folder
 * (the project was removed from the app and added again), it is reused: history and memory come back.
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

/** projeto.json: who this project is (so the folder explains itself and can be recognized later). */
export function gravarInfo(pasta, p) {
  const f = path.join(caminhoDe(pasta), 'projeto.json');
  try {
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, JSON.stringify({ nome: p.nome, alvo: p.raiz, template: p.template, criado: p.criado, extras: p.extras || [] }, null, 2));
  } catch { /* no permission: the app's registry still holds */ }
}

/** Copies what the project had in the previous version (app data and .gamestudio inside the target) without deleting anything. */
export function migrarLegado({ pasta, alvo, dadosAntigos }) {
  const dest = caminhoDe(pasta);
  const copiar = (de, para) => { try { if (fs.existsSync(de) && !fs.existsSync(para)) fs.cpSync(de, para, { recursive: true }); } catch { /* carry on */ } };
  if (dadosAntigos && fs.existsSync(dadosAntigos)) {
    for (const f of fs.readdirSync(dadosAntigos)) copiar(path.join(dadosAntigos, f), path.join(dest, f));
  }
  const antiga = path.join(alvo, '.gamestudio');
  copiar(path.join(antiga, 'memoria'), path.join(dest, 'memoria'));
  copiar(path.join(antiga, 'quadro.md'), path.join(dest, 'quadro.md'));
}
