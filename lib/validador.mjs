// Validador: o app roda ele mesmo as verificações obrigatórias do card (tsc, vitest, pytest, lint) e registra o
// resultado como evidência. O agente só é chamado para interpretar o que falhou. Não chama modelo.
// Só roda comando que o projeto liberou em validacoes.json (lista `permitidos`, correspondência exata).
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { ler } from './store.mjs';
import { validarCaminho } from './politica.mjs';
import { matar, comandoIsolado, acessoTotal } from './runner.mjs';

// Com acesso total (padrão), a lista vazia libera os comandos. Com acesso restrito, a lista vazia não autoriza nada
// e o comando roda no mesmo isolamento de filesystem das execuções.
const PADRAO = { ativo: true, timeoutMin: 20, cwdPadrao: '', permitidos: [], baseline: {} };
const SEM_COMANDO = /not recognized|command not found|ENOENT|não é reconhecido|no such file or directory/i;
const DOCKER = /docker|testcontainers|cannot connect to the docker daemon|docker\.sock/i;

export function criarValidador({ pasta, raiz }) {
  const config = () => ({ ...PADRAO, ...ler(path.join(pasta, 'validacoes.json'), PADRAO) });
  let ocupado = false;

  // acesso total: lista vazia libera qualquer comando; com lista, vale o prefixo. Restrito: só correspondência exata.
  const liberado = (cfg, cmd) => process.env.STUDIO_FAKE === '1' || (acessoTotal()
    ? !(cfg.permitidos || []).length || (cfg.permitidos || []).some((p) => cmd.trim().startsWith(String(p.casa || p).trim()))
    : (cfg.permitidos || []).some(p => cmd.trim() === String(p.casa || p).trim()));
  const aplicaveis = (card) => {
    const cfg = config();
    if (!cfg.ativo) return [];
    return (card.validacoesObrigatorias || []).filter((c) => liberado(cfg, c));
  };

  function executar(cmd, cwd, timeoutMs) {
    // modo de teste: comando fictício ("teste focado") passa simulado; só `echo` roda de verdade, para os testes do próprio validador
    if (process.env.STUDIO_FAKE && !/^\s*echo\b/.test(cmd)) return Promise.resolve({ codigo: 0, saida: '(simulado no modo de teste)', ms: 0 });
    return new Promise((resolve) => {
      const inicio = Date.now(); let saida = ''; let fim = false;
      let proc;
      try { proc = process.env.STUDIO_FAKE==='1' ? spawn(cmd, { cwd, shell: true, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }) : comandoIsolado(cmd,{cwd}); }
      catch (e) { return resolve({ codigo: -1, saida: e.message, ms: 0 }); }
      const fecha = (r) => { if (fim) return; fim = true; clearTimeout(t); resolve({ ...r, saida, ms: Date.now() - inicio }); };
      const t = setTimeout(() => { matar(proc); fecha({ codigo: -2, tempo: true }); }, timeoutMs);
      const junta = (d) => { saida = (saida + d.toString('utf8')).slice(-60_000); };
      proc.stdout.on('data', junta); proc.stderr.on('data', junta);
      proc.on('error', (e) => { saida += e.message; fecha({ codigo: -1 }); });
      proc.on('close', (codigo) => fecha({ codigo }));
    });
  }

  /** Roda as verificações aplicáveis do card. Devolve null se não houver nenhuma liberada. */
  async function rodar(card) {
    const cfg = config();
    const cmds = aplicaveis(card);
    if (!cmds.length) return null;
    const wt = card.workflow?.checkpoint?.worktree;
    // sem worktree do card nem pasta padrão, não adivinha onde rodar: deixa para o agente
    const cwd = [wt, cfg.cwdPadrao, raiz].find((d) => d && fs.existsSync(d));   // sem worktree (projeto sem Git), roda na raiz do projeto
    if (!cwd) return null;
    if(process.env.STUDIO_FAKE!=='1'&&!acessoTotal())try{validarCaminho(cwd,{readPaths:[raiz,path.join(pasta,'worktrees'),cfg.cwdPadrao].filter(Boolean),denyPaths:[]});}catch{return {itens:cmds.map(comando=>({comando,status:'nao_executado',obrigatoria:true,evidencia:'permission_denied: ambiente fora dos diretórios autorizados'})),falhou:[],cwd};}
    while (ocupado) await new Promise((r) => setTimeout(r, 2000));
    ocupado = true;
    try {
      const itens = [];
      for (const comando of cmds) {
        const r = await executar(comando, cwd, cfg.timeoutMin * 60_000);
        const fimSaida = r.saida.trim().split('\n').slice(-12).join('\n').slice(-900);
        const seg = Math.round(r.ms / 1000);
        let status; let evidencia;
        const base = cfg.baseline?.[comando.trim()];
        if (r.tempo) { status = 'falhou'; evidencia = `O app rodou "${comando}" em ${cwd} e passou do tempo (${cfg.timeoutMin} min).`; }
        else if (r.codigo !== 0 && DOCKER.test(r.saida)) { status = 'nao_executado'; evidencia = `Precisa de Docker, que não existe neste ambiente. Não é defeito do código. Saída: ${fimSaida}`; }
        else if (r.codigo !== 0 && SEM_COMANDO.test(r.saida.slice(-1500))) { status = 'nao_executado'; evidencia = `O comando não existe ou não está instalado nesta máquina, então não deu para rodar. Saída: ${fimSaida}`; }
        else if (base !== undefined && /tsc/.test(comando)) {
          const erros = (r.saida.match(/error TS\d+/g) || []).length;
          status = erros <= base ? 'aprovado' : 'falhou';
          evidencia = `O app rodou "${comando}" em ${cwd} (${seg}s): ${erros} erros de TypeScript, linha de base ${base}.${status === 'falhou' ? ` Saída: ${fimSaida}` : ''}`;
        } else {
          status = r.codigo === 0 ? 'aprovado' : 'falhou';
          evidencia = `O app rodou "${comando}" em ${cwd} (${seg}s), código de saída ${r.codigo}.${status === 'falhou' ? ` Saída final:\n${fimSaida}` : ''}`;
        }
        itens.push({ comando, status, evidencia: evidencia.slice(0, 1900), ms: r.ms });
      }
      return { itens, falhou: itens.filter((i) => i.status === 'falhou'), cwd };
    } finally { ocupado = false; }
  }

  return { config, aplicaveis, rodar, permitido: cmd => liberado(config(),cmd) };
}

// ---- checagens do contrato de template, sem comando: arquivo existe, imagem abre e tem dimensões. Síncronas e sem modelo.
function dimensoesImagem(arquivo) {
  const b = fs.readFileSync(arquivo);
  if (b.length > 24 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4E && b[3] === 0x47) return { largura: b.readUInt32BE(16), altura: b.readUInt32BE(20), tipo: 'png' };
  if (b.length > 4 && b[0] === 0xFF && b[1] === 0xD8) {   // JPEG: procura o SOF
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xFF) { i++; continue; }
      const m = b[i + 1];
      if (m >= 0xC0 && m <= 0xCF && m !== 0xC4 && m !== 0xC8 && m !== 0xCC) return { altura: b.readUInt16BE(i + 5), largura: b.readUInt16BE(i + 7), tipo: 'jpeg' };
      i += 2 + b.readUInt16BE(i + 2);
    }
  }
  if (b.length > 10 && b.slice(0, 6).toString('ascii').startsWith('GIF8')) return { largura: b.readUInt16LE(6), altura: b.readUInt16LE(8), tipo: 'gif' };
  return null;
}
/** Roda as checagens de arquivo/imagem do contrato sobre os arquivos do card. Devolve itens no formato das verificações. */
export function checarArquivos({ card, raiz, checagens }) {
  const itens = [];
  const arquivos = (card.arquivos || []).filter((a) => a && !/^\(/.test(String(a)));
  const abs = (a) => (path.isAbsolute(a) ? a : path.join(raiz || '', a));
  for (const ch of checagens || []) {
    if (ch.tipo === 'arquivos') {
      // sem arquivo listado a checagem não se aplica (card de estratégia, pesquisa, decisão): fica registrado e a revisão decide
      if (!arquivos.length) { itens.push({ comando: ch.nome, status: 'nao_executado', evidencia: 'O card não lista arquivos; a revisão confere se a entrega exigia arquivo.' }); continue; }
      const faltam = arquivos.filter((a) => !fs.existsSync(abs(a)));
      itens.push({ comando: ch.nome, status: faltam.length ? 'falhou' : 'aprovado', evidencia: faltam.length ? `Não encontrados: ${faltam.join(', ')} (base ${raiz}).` : `${arquivos.length} arquivo(s) existem: ${arquivos.slice(0, 8).join(', ')}.` });
    } else if (ch.tipo === 'imagem') {
      const imgs = arquivos.filter((a) => /\.(png|jpe?g|gif)$/i.test(a) && fs.existsSync(abs(a)));
      if (!imgs.length) continue;   // sem imagem na entrega, a checagem não se aplica
      const ruins = []; const ok = [];
      for (const a of imgs) {
        let d = null; try { d = dimensoesImagem(abs(a)); } catch { /* ilegível */ }
        if (!d) { ruins.push(`${a}: não abre como imagem`); continue; }
        if ((ch.minLargura && d.largura < ch.minLargura) || (ch.minAltura && d.altura < ch.minAltura)) ruins.push(`${a}: ${d.largura}x${d.altura}, abaixo do mínimo ${ch.minLargura || 0}x${ch.minAltura || 0}`);
        else ok.push(`${a}: ${d.largura}x${d.altura}`);
      }
      itens.push({ comando: ch.nome, status: ruins.length ? 'falhou' : 'aprovado', evidencia: [...ruins, ...ok].join('; ').slice(0, 900) });
    }
  }
  return itens;
}
