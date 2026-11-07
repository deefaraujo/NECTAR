// Local model (Ollama on this machine): the layer that makes the team feel alive and takes cheap work off the paid model.
// Writing event lines, triaging routine questions, extracting facts from a job's output, summarizing what happened.
// Rules: single slot (a 6 GB GPU gets worse with parallelism), `think: false` (otherwise the content comes back empty), JSON output by schema
// (valid by construction), and everything optional: without a server, each function returns null and the app carries on as before. Never sets direction.
import { lerConfig } from './store.mjs';

let fila = Promise.resolve();            // one call at a time
let saude = { ok: null, em: 0 };          // cache of the server check (30 s)
const FAKE = () => !!process.env.STUDIO_FAKE;

// 90 s: the first call loads the model onto the GPU (20 to 40 s on this machine); after that keep_alive holds it and each call takes 3 to 8 s
const cfg = () => ({ ativo: true, url: 'http://127.0.0.1:11434', modelo: '', timeoutMs: 90000, falas: true, triagem: true, extracao: true, ...(lerConfig().local || {}), ...(process.env.STUDIO_LOCAL_MODELO ? { modelo: process.env.STUDIO_LOCAL_MODELO } : {}) });   // env: model benchmark

export async function disponivel() {
  const c = cfg();
  if (!c.ativo) return false;
  if (FAKE()) return process.env.STUDIO_FAKE_LOCAL !== '0';
  if (Date.now() - saude.em < 30_000 && saude.ok !== null) return saude.ok;
  try {
    const r = await fetch(`${c.url}/api/tags`, { signal: AbortSignal.timeout(2500) });
    const j = r.ok ? await r.json() : null;
    saude = { ok: !!j && (j.models || []).some((m) => m.name === c.modelo || m.model === c.modelo) || (!!j && !c.modelo), em: Date.now() };
  } catch { saude = { ok: false, em: Date.now() }; }
  return saude.ok;
}

/** Raw call: system + user, JSON response in the schema. Returns the object or null. */
export function chamar({ sistema, usuario, schema, maxTokens = 300 }) {
  const c = cfg();
  const exec = async () => {
    if (!(await disponivel())) return null;
    if (FAKE()) return simulado({ sistema, usuario, schema });
    try {
      const r = await fetch(`${c.url}/api/chat`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(c.timeoutMs),
        body: JSON.stringify({ model: c.modelo, stream: false, think: false, format: schema, keep_alive: '30m', options: { num_predict: maxTokens, temperature: 0.4 }, messages: [{ role: 'system', content: sistema }, { role: 'user', content: usuario }] }),
      });
      if (!r.ok) return null;
      const j = await r.json();
      const txt = j?.message?.content || '';
      return txt ? JSON.parse(txt) : null;
    } catch { return null; }
  };
  const p = fila.then(exec, exec);
  fila = p.catch(() => {});
  return p;
}

// ---- uses ---------------------------------------------------------------------------------------------------
/** An agent's short line about an event (job finished, delivery, card moved), in its own voice. 1 sentence, no invented facts. */
export async function fala({ agente, cargo, personalidade = '', evento, fatos = '' }) {
  if (!cfg().falas) return null;
  const r = await chamar({
    // measured: with the full personality and two sentences the tone shows (the methodical one checks, the grumpy one grumbles); with room to "elaborate"
    // the model invents causes ("must be the firewall"). Hence: tone yes, hypotheses no.
    sistema: `Você escreve o que ${agente}, ${cargo}, diria no chat da equipe sobre um evento. Formato: UMA frase com o fato, e opcionalmente um comentário curto (até 8 palavras) no jeito dele(a). Máx. 180 caracteres, português do Brasil. ${personalidade ? `Jeito de falar dele(a) (só o tom; você não decide, não promete, não avalia): ${personalidade.split(/\n\s*\n/).slice(0, 2).join(' ').slice(0, 450)}` : ''} Use SÓ os fatos dados: não invente número, nome, resultado, causa, verificação feita nem próximo passo. Se não sabe por que algo aconteceu, não sugira motivo. Sem emoji, sem hashtag, sem saudação.`,
    usuario: `Evento: ${evento}\n${fatos ? `Fatos: ${fatos}` : ''}`,
    schema: { type: 'object', properties: { frase: { type: 'string' } }, required: ['frase'] }, maxTokens: 160,
  });
  const f = String(r?.frase || '').trim();
  // Guard: no number that is not in the event or the facts (the model does not invent results on the agent's behalf)
  const dados = new Set(`${evento} ${fatos}`.match(/\d+/g) || []);
  if ((f.match(/\d+/g) || []).some((n) => !dados.has(n))) return null;
  // Guard: an event line neither decides nor promises. With the lead's personality ("decido:"), the 4B invented "decido: liberar para produção".
  { const entrada = `${evento} ${fatos}`.toLowerCase();
    const inventou = (f.match(/\b(decid\w*|liber\w*|aprov\w*|autoriz\w*|produ[cç][aã]o)\b/gi) || []).some((w) => !entrada.includes(w.toLowerCase()));
    if (inventou || /\bvou (corrigir|revisar|refazer|investigar)|pr[oó]ximo passo|checamos|verifiquei|testei/i.test(f)) return null; }   // a decision, promise or verification that did not come from the facts
  return f && f.length <= 220 ? f : null;
}

/** Question triage in autopilot: routine (picks the safe/recommended option) or needs judgment (goes to the lead). */
export async function triar({ pergunta, opcoes = [], card = '' }) {
  if (!cfg().triagem || !opcoes.length) return null;
  const r = await chamar({
    sistema: 'Você tria perguntas de agentes de uma equipe no piloto automático. ROTINEIRA = dá para escolher sem a pessoa responsável: opção recomendada, ou a mais segura e reversível, que mantém o trabalho andando. PRECISA DE JULGAMENTO = muda escopo, produto, contrato, custo, prazo, apaga/sobrescreve dado, toca produção, pede credencial/dinheiro/acesso, ou as opções têm consequências que você não consegue comparar. Na dúvida, PRECISA DE JULGAMENTO. Nunca escolha opção destrutiva, paga ou irreversível.',
    usuario: `Pergunta${card ? ` (card ${card})` : ''}: ${pergunta.slice(0, 900)}\nOpções:\n${opcoes.map((o, i) => `${i}. ${o}`).join('\n')}`,
    schema: { type: 'object', properties: { rotineira: { type: 'boolean' }, opcao: { type: 'integer' }, motivo: { type: 'string' } }, required: ['rotineira', 'opcao', 'motivo'] }, maxTokens: 160,
  });
  if (!r || typeof r.rotineira !== 'boolean') return null;
  const i = Number.isInteger(r.opcao) && r.opcao >= 0 && r.opcao < opcoes.length ? r.opcao : -1;
  // Code guard: measured on the bench, the 4B called "mark the flaky test as skip" and "migration in production today" routine.
  // So the model is only the filter; the rule is what approves: no risk word in the question or in the chosen option, and the chosen
  // option must be the recommended one or look safe/reversible. When in doubt, it goes to the lead.
  const texto = `${pergunta} ${i >= 0 ? opcoes[i] : ''}`;
  const risco = /produ[cç][aã]o|prod\b|apag|delet|remov|recri|drop|for[cç]ad|--force|skip|pular|ignorar o teste|credenc|senha|token|chave de api|custo|pre[cç]o|us\$|r\$|mensal|contrat|escopo|prazo|deploy|publicar|push|merge na (develop|main)|hoje ou amanh|irrevers/i.test(texto);
  const escolhida = i >= 0 ? opcoes[i] : '';
  const segura = /recomendad|por ora|por enquanto|s[oó] (o|os|a|as) |padr[aã]o do projeto|manter|n[aã]o,|investigar|antes|revers[ií]vel|local|rascunho|tempor[aá]ri/i.test(escolhida);
  const rotineira = r.rotineira && i >= 0 && !risco && segura;
  return { rotineira, opcao: i, motivo: rotineira ? String(r.motivo || '').slice(0, 200) : `${risco ? 'palavra de risco na pergunta ou na opção' : !segura ? 'a opção escolhida não é a recomendada nem tem cara de reversível' : 'o modelo pediu julgamento'}; vai para a liderança` };
}

/** Objective facts in a command's output: test counts, versions, ports, paths. Only what is in the text. */
export async function extrair({ comando, saida }) {
  if (!cfg().extracao) return null;
  const r = await chamar({
    sistema: 'Extraia fatos objetivos da saída de um comando: contagem de testes (passou/falhou/erro), versão de ferramenta, porta, caminho, commit, tempo. Chave curta em minúsculas sem espaço (ex.: testes, versao-python, porta, commit); valor curto. Só o que está literalmente no texto; nada inferido. Até 6 fatos.',
    usuario: `Comando: ${comando.slice(0, 200)}\nSaída:\n${saida.slice(-3000)}`,
    schema: { type: 'object', properties: { fatos: { type: 'array', items: { type: 'object', properties: { chave: { type: 'string' }, valor: { type: 'string' } }, required: ['chave', 'valor'] } } }, required: ['fatos'] }, maxTokens: 300,
  });
  // Code guard: a fact only counts if it is literally in the output (every number in the value appears in the text) and is not filler ("n/a", "0" without a source).
  const l = Array.isArray(r?.fatos) ? r.fatos.filter((f) => {
    if (!f || !/^[\p{L}\p{N}_.:-]{1,40}$/u.test(String(f.chave))) return false;
    const v = String(f.valor || '').trim();
    if (!v || /^(n\/?a|none|null|-+|nenhum|desconhecido|indispon[ií]vel)$/i.test(v)) return false;
    if (/test/i.test(String(f.chave)) && !/test|passed|failed|passou|falhou|errors?/i.test(saida)) return false;   // "testes: 0" in a build output is filler
    const nums = v.match(/\d+(?:\.\d+)?/g) || [];
    return nums.every((n) => saida.includes(n)) && (nums.length || saida.toLowerCase().includes(v.toLowerCase().split(/[ ,;(]/)[0]));
  }).slice(0, 6) : [];
  return l.length ? l.map((f) => ({ chave: String(f.chave), valor: String(f.valor).slice(0, 200) })) : null;
}

/** Short summary (3 to 5 lines) of what happened, for whoever comes back. Only with the given items. */
export async function resumir({ itens, desde }) {
  const r = await chamar({
    sistema: 'Resuma em 3 a 5 linhas, português do Brasil, para a pessoa que lidera o projeto, o que a equipe fez enquanto ela esteve fora. Direto, sem adjetivo, sem inventar. Cada linha é um fato da lista. Termine com o que precisa dela, se houver.',
    usuario: `Desde ${desde}:\n${itens.slice(0, 40).map((x) => `- ${x}`).join('\n')}`,
    schema: { type: 'object', properties: { resumo: { type: 'string' } }, required: ['resumo'] }, maxTokens: 260,
  });
  const t = String(r?.resumo || '').trim();
  const dados = new Set(itens.join(' ').match(/\d+/g) || []);
  if ((t.match(/\d+/g) || []).some((n) => !dados.has(n))) return null;   // a number that did not come from the items: do not summarize
  return t ? t.slice(0, 1200) : null;
}

/** Compacts a command's output for the paid model to read: only the lines that matter (failures, errors, totals), copied verbatim.
 *  Cuts input tokens without losing information: every returned line must exist in the output, otherwise it is discarded. */
export async function compactarLog({ comando, saida, max = 12 }) {
  const txt = String(saida || '');
  if (txt.length < 1200) return null;   // short output already fits whole
  const r = await chamar({
    sistema: 'Você seleciona, da saída de um comando, as linhas que um desenvolvedor precisa ler para agir: nomes de testes que falharam, mensagens de erro com arquivo e linha, totais (passed/failed/errors), avisos de ambiente. Copie as linhas EXATAMENTE como estão (sem reescrever, sem resumir, sem traduzir). Até 12 linhas. Ignore barras de progresso, warnings repetidos e linhas de sucesso individuais.',
    usuario: `Comando: ${String(comando || '').slice(0, 200)}\nSaída:\n${txt.slice(-6000)}`,
    schema: { type: 'object', properties: { linhas: { type: 'array', items: { type: 'string' } } }, required: ['linhas'] }, maxTokens: 500,
  });
  const linhas = (Array.isArray(r?.linhas) ? r.linhas : []).map((l) => String(l).trim()).filter((l) => l.length > 3 && txt.includes(l)).slice(0, max);
  return linhas.length ? linhas : null;
}

// ---- test mode: deterministic responses in each schema's format
function simulado({ sistema, usuario, schema }) {
  const props = Object.keys(schema?.properties || {});
  if (props.includes('frase')) { const ev = (usuario.match(/Evento: (.*)/) || [])[1] || 'evento'; return { frase: `(local) ${ev.slice(0, 120)}` }; }
  if (props.includes('rotineira')) {
    const ops = [...usuario.matchAll(/^(\d+)\. (.*)$/gm)].map((m) => m[2]);
    const rec = ops.findIndex((o) => /recomendad|segur|revers|manter|unit[aá]rio/i.test(o));
    const julgamento = /escopo|produto|contrato|apagar|recriar|produ[cç][aã]o|dinheiro|credencial|senha|deploy/i.test(usuario.split('\nOpções')[0]);   // only the question; a destructive option among the alternatives does not prevent choosing the safe one
    return { rotineira: !julgamento && rec >= 0, opcao: rec >= 0 ? rec : 0, motivo: julgamento ? 'muda escopo ou é irreversível' : 'opção recomendada e reversível' };
  }
  if (props.includes('fatos')) {
    const m = usuario.match(/(\d+) passed/); const v = usuario.match(/Python (\d+\.\d+\.\d+)/);
    return { fatos: [...(m ? [{ chave: 'testes-passaram', valor: m[1] }] : []), ...(v ? [{ chave: 'versao-python', valor: v[1] }] : [])] };
  }
  if (props.includes('linhas')) { const sa = usuario.split('\nSaída:\n')[1] || ''; return { linhas: sa.split('\n').filter((l) => /fail|error|passed|FALHOU|Error/i.test(l)).slice(0, 12) }; }
  if (props.includes('resumo')) return { resumo: '(local) resumo do que aconteceu desde que você saiu.' };
  return null;
}
