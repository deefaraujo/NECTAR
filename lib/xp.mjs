// Disciplinas de eXtreme Programming que o app faz valer por mecanismo, não por lembrete:
//   1. entrega pequena (pontos no máximo 5; o roteador e a P.O. quebram o resto);
//   2. critério de aceite claro ANTES de começar: o agente faz exatamente o que o aceite pede, então card sem aceite verificável
//      não sai do backlog;
//   3. revisão por outra parte, em ambiente separado: quem revisa nunca é o dono (workflow.mjs) e, quando há Git e branch,
//      revisa num worktree próprio, descartado depois, para nada da revisão vazar para a entrega;
//   4. quem decide é gente: aprovação de planning, aceite de ressalva e validação final continuam com a Game Director.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const VAGOS = /^(funciona(r)?|ok|pronto|feito|est[aá] (bom|ok|pronto)|deve funcionar|sem erros?|bom|correto|tudo certo|qualidade|melhorar|otimizar)\.?$/i;
/** Critérios de aceite verificáveis: pelo menos um, cada um com conteúdo (3+ palavras, 15+ caracteres) e sem frase vaga. */
export function aceiteVerificavel(lista) {
  const itens = (Array.isArray(lista) ? lista : []).map((a) => String(typeof a === 'string' ? a : a?.t ?? a?.texto ?? '').trim()).filter(Boolean);
  if (!itens.length) return { ok: false, motivo: 'não há critérios de aceite' };
  const fracos = itens.filter((t) => t.length < 15 || t.split(/\s+/).length < 3 || VAGOS.test(t));
  if (fracos.length) return { ok: false, motivo: `critério vago demais para conferir: "${fracos[0].slice(0, 60)}" (diga o que se observa quando está pronto: comando, tela, arquivo, valor)` };
  return { ok: true, motivo: '' };
}

const git = (raiz, args, ms = 20000) => execFileSync('git', ['-C', raiz, ...args], { encoding: 'utf8', timeout: ms, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
/**
 * Worktree separado para revisar `branch` do repositório `raiz`, em `dir`. Devolve { cwd, limpar } ou null quando não dá (sem Git,
 * branch inexistente). `limpar()` remove o worktree; nada feito lá chega à entrega.
 */
export function worktreeRevisao(raiz, branch, dir) {
  try {
    if (!raiz || !branch || !fs.existsSync(path.join(raiz, '.git'))) return null;
    const ref = [branch, `origin/${branch}`].find((r) => { try { git(raiz, ['rev-parse', '--verify', '--quiet', r]); return true; } catch { return false; } });
    if (!ref) return null;
    if (fs.existsSync(dir)) { try { git(raiz, ['worktree', 'remove', '--force', dir]); } catch { fs.rmSync(dir, { recursive: true, force: true }); } }
    fs.mkdirSync(path.dirname(dir), { recursive: true });
    git(raiz, ['worktree', 'add', '--detach', dir, ref], 60000);
    return { cwd: dir, ref, limpar: () => { try { git(raiz, ['worktree', 'remove', '--force', dir]); } catch { try { fs.rmSync(dir, { recursive: true, force: true }); git(raiz, ['worktree', 'prune']); } catch { /* fica para o prune seguinte */ } } } };
  } catch { return null; }
}
