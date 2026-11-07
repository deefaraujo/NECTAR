// eXtreme Programming disciplines the app enforces by mechanism, not by reminder:
//   1. small delivery (at most 5 points; the router and the P.O. split the rest);
//   2. clear acceptance criterion BEFORE starting: the agent does exactly what the acceptance asks, so a card without verifiable acceptance
//      does not leave the backlog;
//   3. review by another party, in a separate environment: the reviewer is never the owner (workflow.mjs) and, when there is Git and a branch,
//      reviews in its own worktree, discarded afterwards, so nothing from the review leaks into the delivery;
//   4. people decide: planning approval, caveat acceptance and final validation stay with the Game Director.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const VAGOS = /^(funciona(r)?|ok|pronto|feito|est[aá] (bom|ok|pronto)|deve funcionar|sem erros?|bom|correto|tudo certo|qualidade|melhorar|otimizar)\.?$/i;
/** Verifiable acceptance criteria: at least one, each with content (3+ words, 15+ characters) and no vague phrasing. */
export function aceiteVerificavel(lista) {
  const itens = (Array.isArray(lista) ? lista : []).map((a) => String(typeof a === 'string' ? a : a?.t ?? a?.texto ?? '').trim()).filter(Boolean);
  if (!itens.length) return { ok: false, motivo: 'não há critérios de aceite' };
  const fracos = itens.filter((t) => t.length < 15 || t.split(/\s+/).length < 3 || VAGOS.test(t));
  if (fracos.length) return { ok: false, motivo: `critério vago demais para conferir: "${fracos[0].slice(0, 60)}" (diga o que se observa quando está pronto: comando, tela, arquivo, valor)` };
  return { ok: true, motivo: '' };
}

const git = (raiz, args, ms = 20000) => execFileSync('git', ['-C', raiz, ...args], { encoding: 'utf8', timeout: ms, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
/**
 * Separate worktree to review `branch` of repository `raiz`, in `dir`. Returns { cwd, limpar } or null when not possible (no Git,
 * nonexistent branch). `limpar()` removes the worktree; nothing done there reaches the delivery.
 */
export function worktreeRevisao(raiz, branch, dir) {
  try {
    if (!raiz || !branch || !fs.existsSync(path.join(raiz, '.git'))) return null;
    const ref = [branch, `origin/${branch}`].find((r) => { try { git(raiz, ['rev-parse', '--verify', '--quiet', r]); return true; } catch { return false; } });
    if (!ref) return null;
    if (fs.existsSync(dir)) { try { git(raiz, ['worktree', 'remove', '--force', dir]); } catch { fs.rmSync(dir, { recursive: true, force: true }); } }
    fs.mkdirSync(path.dirname(dir), { recursive: true });
    git(raiz, ['worktree', 'add', '--detach', dir, ref], 60000);
    return { cwd: dir, ref, limpar: () => { try { git(raiz, ['worktree', 'remove', '--force', dir]); } catch { try { fs.rmSync(dir, { recursive: true, force: true }); git(raiz, ['worktree', 'prune']); } catch { /* left for the next prune */ } } } };
  } catch { return null; }
}
