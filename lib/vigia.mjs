// Repository watcher: from time to time looks at the project's repositories (git, read-only) and reports what changed
// since last time: new commits, branches created or removed, remote progress and changed files.
// Nothing here calls a model. Only when there is a real change (commit, branch or remote) does the team wake the P.O.
// to analyze. `fetch` only updates the remote refs; it does not touch branches, files or the checkout.
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { ler, gravar } from './store.mjs';

const PADRAO = { ativo: false, intervaloMin: 15, buscarRemoto: true, repos: [] };
const git = (repo, args, { timeout = 20_000, env = {} } = {}) => new Promise((resolve) => {
  execFile('git', ['-C', repo, ...args], { timeout, windowsHide: true, maxBuffer: 8 * 1024 * 1024, env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_SSH_COMMAND: 'ssh -o BatchMode=yes -o ConnectTimeout=15', ...env } },
    (erro, saida, err) => resolve({ ok: !erro, saida: String(saida || '').trim(), erro: String(err || erro?.message || '').trim() }));
});

export function criarVigia({ pasta }) {
  const arqConfig = path.join(pasta, 'vigia.json');
  const arqEstado = path.join(pasta, 'vigia-estado.json');
  const config = () => {
    const c = ler(arqConfig, PADRAO);
    return { ...PADRAO, ...c, repos: (Array.isArray(c.repos) ? c.repos : []).map(String).filter(Boolean) };
  };

  function salvarConfig(b) {
    const atual = config();
    const novo = { ...atual };
    if (typeof b.ativo === 'boolean') novo.ativo = b.ativo;
    if (typeof b.buscarRemoto === 'boolean') novo.buscarRemoto = b.buscarRemoto;
    const im = Number(b.intervaloMin);
    if ([5, 10, 15, 30, 60].includes(im)) novo.intervaloMin = im;
    if (Array.isArray(b.repos)) novo.repos = [...new Set(b.repos.map((x) => String(x).trim().replace(/^"|"$/g, '')).filter(Boolean))].slice(0, 12);
    gravar(arqConfig, novo);
    return novo;
  }

  async function fotografar(repo, { buscar }) {
    if (!fs.existsSync(path.join(repo, '.git'))) return { repo, erro: 'não é um repositório git' };
    let avisoRemoto = null;
    if (buscar) {
      const f = await git(repo, ['fetch', '--prune', '--quiet'], { timeout: 60_000 });
      if (!f.ok) avisoRemoto = f.erro.split('\n')[0].slice(0, 160) || 'não consegui buscar o remoto';
    }
    const [atual, refs, status] = await Promise.all([
      git(repo, ['branch', '--show-current']),
      git(repo, ['for-each-ref', '--format=%(refname:short) %(objectname)', 'refs/heads', 'refs/remotes']),
      git(repo, ['status', '--porcelain']),
    ]);
    const ramos = {};
    for (const l of refs.saida.split('\n').filter(Boolean)) { const [n, sha] = l.split(' '); if (n && sha && !n.endsWith('/HEAD')) ramos[n] = sha; }
    const sujos = status.saida.split('\n').filter(Boolean).map((l) => l.slice(3).trim());
    return { repo, nome: path.basename(repo), atual: atual.saida || '(desanexado)', ramos, sujos: sujos.slice(0, 200), nSujos: sujos.length, avisoRemoto };
  }

  async function descrever(antes, depois) {
    const linhas = []; const commits = []; const ramos = []; let significativo = false;
    const nome = depois.nome;
    if (antes.atual !== depois.atual) { linhas.push(`branch atual mudou de ${antes.atual} para ${depois.atual}`); significativo = true; }
    for (const [ramo, sha] of Object.entries(depois.ramos)) {
      const antiga = antes.ramos[ramo];
      if (!antiga) { linhas.push(`branch nova: ${ramo}`); ramos.push(ramo); significativo = true; continue; }
      if (antiga === sha) continue;
      significativo = true;
      ramos.push(ramo);
      const log = await git(depois.repo, ['log', '--format=%h %s (%an)', '-n', '8', `${antiga}..${sha}`]);
      for (const l of log.saida.split(/\r?\n/).filter(Boolean)) commits.push({ repo: nome, ramo, sha: l.split(' ')[0], assunto: l.slice(l.indexOf(' ') + 1) });
      const n = (await git(depois.repo, ['rev-list', '--count', `${antiga}..${sha}`])).saida || '?';
      linhas.push(log.ok && n !== '0'
        ? `${n} commit(s) novo(s) em ${ramo}:\n${log.saida.split('\n').map((x) => `    ${x}`).join('\n')}`
        : `${ramo} foi reescrita ou recuou (histórico mudou)`);
    }
    for (const ramo of Object.keys(antes.ramos)) if (!depois.ramos[ramo]) { linhas.push(`branch removida: ${ramo}`); significativo = true; }
    const novos = depois.sujos.filter((x) => !antes.sujos.includes(x));
    if (depois.nSujos !== antes.nSujos || novos.length) {
      linhas.push(`arquivos alterados no checkout: ${depois.nSujos} (antes ${antes.nSujos})${novos.length ? `; novos: ${novos.slice(0, 8).join(', ')}${novos.length > 8 ? '…' : ''}` : ''}`);
    }
    return linhas.length ? { nome, linhas, significativo, commits, ramos } : null;
  }

  /**
   * Compares with the last snapshot. Returns null on the first time (only records the baseline) or if nothing changed;
   * otherwise { texto, significativo, repos }. `significativo` is a commit, branch or remote, not just a changed file.
   */
  async function verificar() {
    const c = config();
    const repos = c.repos.filter((r) => fs.existsSync(r));
    const estado = ler(arqEstado, { repos: {}, em: null });
    const novas = await Promise.all(repos.map((r) => fotografar(r, { buscar: c.buscarRemoto })));
    const mudancas = []; const avisos = [];
    for (const depois of novas) {
      if (depois.erro) { avisos.push(`${path.basename(depois.repo)}: ${depois.erro}`); continue; }
      if (depois.avisoRemoto && !estado.repos[depois.repo]?.avisoRemoto) avisos.push(`${depois.nome}: sem acesso ao remoto (${depois.avisoRemoto}). Sigo olhando só o que há na máquina.`);
      const antes = estado.repos[depois.repo];
      if (antes) { const d = await descrever(antes, depois); if (d) mudancas.push(d); }
    }
    const primeira = !estado.em;
    const proximo = { repos: Object.fromEntries(novas.filter((n) => !n.erro).map((n) => [n.repo, n])), em: new Date().toISOString() };
    gravar(arqEstado, proximo);
    if (primeira) return { primeira: true, repos: novas.filter((n) => !n.erro).map((n) => n.nome), avisos };
    if (!mudancas.length && !avisos.length) return null;
    const texto = [...mudancas.map((m) => `${m.nome}:\n${m.linhas.map((l) => `  - ${l}`).join('\n')}`), ...avisos.map((a) => `Aviso: ${a}`)].join('\n');
    return { texto, significativo: mudancas.some((m) => m.significativo), repos: mudancas.map((m) => m.nome), avisos, commits: mudancas.flatMap((m) => m.commits), ramos: mudancas.flatMap((m) => m.ramos.map((r) => ({ repo: m.nome, ramo: r }))) };
  }

  return { config, salvarConfig, verificar };
}
