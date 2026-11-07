// Modelo local (Ollama nesta máquina): a camada que faz o time parecer vivo e tira trabalho barato do modelo pago.
// Redação de fala de evento, triagem de pergunta rotineira, extração de fatos de uma saída de job, resumo do que aconteceu.
// Regras: slot único (GPU de 6 GB piora com paralelismo), `think: false` (senão o conteúdo volta vazio), saída JSON por schema
// (válida por construção), e tudo opcional: sem servidor, cada função devolve null e o app segue como antes. Nunca decide rumo.
import { lerConfig } from './store.mjs';

let fila = Promise.resolve();            // uma chamada por vez
let saude = { ok: null, em: 0 };          // cache da checagem do servidor (30 s)
const FAKE = () => !!process.env.STUDIO_FAKE;

// 90 s: a primeira chamada carrega o modelo na GPU (20 a 40 s nesta máquina); depois o keep_alive mantém e cada chamada leva 3 a 8 s
const cfg = () => ({ ativo: true, url: 'http://127.0.0.1:11434', modelo: '', timeoutMs: 90000, falas: true, triagem: true, extracao: true, ...(lerConfig().local || {}), ...(process.env.STUDIO_LOCAL_MODELO ? { modelo: process.env.STUDIO_LOCAL_MODELO } : {}) });   // env: bancada de modelos

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

/** Chamada crua: system + usuário, resposta JSON no schema. Devolve o objeto ou null. */
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

// ---- usos ---------------------------------------------------------------------------------------------------
/** Fala curta de um agente sobre um evento (job terminou, entrega, card andou), na voz dele. 1 frase, sem inventar fato. */
export async function fala({ agente, cargo, personalidade = '', evento, fatos = '' }) {
  if (!cfg().falas) return null;
  const r = await chamar({
    // medido: com personalidade inteira e duas frases o tom aparece (a metódica confere, o resmungão resmunga); com folga para "detalhar"
    // o modelo inventa causa ("deve ser o firewall"). Por isso: tom sim, hipótese não.
    sistema: `Você escreve o que ${agente}, ${cargo}, diria no chat da equipe sobre um evento. Formato: UMA frase com o fato, e opcionalmente um comentário curto (até 8 palavras) no jeito dele(a). Máx. 180 caracteres, português do Brasil. ${personalidade ? `Jeito de falar dele(a) (só o tom; você não decide, não promete, não avalia): ${personalidade.split(/\n\s*\n/).slice(0, 2).join(' ').slice(0, 450)}` : ''} Use SÓ os fatos dados: não invente número, nome, resultado, causa, verificação feita nem próximo passo. Se não sabe por que algo aconteceu, não sugira motivo. Sem emoji, sem hashtag, sem saudação.`,
    usuario: `Evento: ${evento}\n${fatos ? `Fatos: ${fatos}` : ''}`,
    schema: { type: 'object', properties: { frase: { type: 'string' } }, required: ['frase'] }, maxTokens: 160,
  });
  const f = String(r?.frase || '').trim();
  // Trava: nenhum número que não esteja no evento ou nos fatos (o modelo não inventa resultado em nome do agente)
  const dados = new Set(`${evento} ${fatos}`.match(/\d+/g) || []);
  if ((f.match(/\d+/g) || []).some((n) => !dados.has(n))) return null;
  // Trava: fala de evento não decide nem promete. Com a personalidade da liderança ("decido:"), o 4B inventou "decido: liberar para produção".
  { const entrada = `${evento} ${fatos}`.toLowerCase();
    const inventou = (f.match(/\b(decid\w*|liber\w*|aprov\w*|autoriz\w*|produ[cç][aã]o)\b/gi) || []).some((w) => !entrada.includes(w.toLowerCase()));
    if (inventou || /\bvou (corrigir|revisar|refazer|investigar)|pr[oó]ximo passo|checamos|verifiquei|testei/i.test(f)) return null; }   // decisão, promessa ou verificação que não veio dos fatos
  return f && f.length <= 220 ? f : null;
}

/** Triagem de pergunta no piloto: rotineira (escolhe a opção segura/recomendada) ou precisa de julgamento (vai para a liderança). */
export async function triar({ pergunta, opcoes = [], card = '' }) {
  if (!cfg().triagem || !opcoes.length) return null;
  const r = await chamar({
    sistema: 'Você tria perguntas de agentes de uma equipe no piloto automático. ROTINEIRA = dá para escolher sem a pessoa responsável: opção recomendada, ou a mais segura e reversível, que mantém o trabalho andando. PRECISA DE JULGAMENTO = muda escopo, produto, contrato, custo, prazo, apaga/sobrescreve dado, toca produção, pede credencial/dinheiro/acesso, ou as opções têm consequências que você não consegue comparar. Na dúvida, PRECISA DE JULGAMENTO. Nunca escolha opção destrutiva, paga ou irreversível.',
    usuario: `Pergunta${card ? ` (card ${card})` : ''}: ${pergunta.slice(0, 900)}\nOpções:\n${opcoes.map((o, i) => `${i}. ${o}`).join('\n')}`,
    schema: { type: 'object', properties: { rotineira: { type: 'boolean' }, opcao: { type: 'integer' }, motivo: { type: 'string' } }, required: ['rotineira', 'opcao', 'motivo'] }, maxTokens: 160,
  });
  if (!r || typeof r.rotineira !== 'boolean') return null;
  const i = Number.isInteger(r.opcao) && r.opcao >= 0 && r.opcao < opcoes.length ? r.opcao : -1;
  // Trava de código: medido na bancada, o 4B chamou de rotineira "marcar o teste flaky como skip" e "migration em produção hoje".
  // Então o modelo é só o filtro; a regra é quem libera: nenhuma palavra de risco na pergunta nem na opção escolhida, e a opção
  // escolhida precisa ser a recomendada ou ter cara de segura/reversível. Na dúvida, vai para a liderança.
  const texto = `${pergunta} ${i >= 0 ? opcoes[i] : ''}`;
  const risco = /produ[cç][aã]o|prod\b|apag|delet|remov|recri|drop|for[cç]ad|--force|skip|pular|ignorar o teste|credenc|senha|token|chave de api|custo|pre[cç]o|us\$|r\$|mensal|contrat|escopo|prazo|deploy|publicar|push|merge na (develop|main)|hoje ou amanh|irrevers/i.test(texto);
  const escolhida = i >= 0 ? opcoes[i] : '';
  const segura = /recomendad|por ora|por enquanto|s[oó] (o|os|a|as) |padr[aã]o do projeto|manter|n[aã]o,|investigar|antes|revers[ií]vel|local|rascunho|tempor[aá]ri/i.test(escolhida);
  const rotineira = r.rotineira && i >= 0 && !risco && segura;
  return { rotineira, opcao: i, motivo: rotineira ? String(r.motivo || '').slice(0, 200) : `${risco ? 'palavra de risco na pergunta ou na opção' : !segura ? 'a opção escolhida não é a recomendada nem tem cara de reversível' : 'o modelo pediu julgamento'}; vai para a liderança` };
}

/** Fatos objetivos numa saída de comando: números de teste, versões, portas, caminhos. Só o que está no texto. */
export async function extrair({ comando, saida }) {
  if (!cfg().extracao) return null;
  const r = await chamar({
    sistema: 'Extraia fatos objetivos da saída de um comando: contagem de testes (passou/falhou/erro), versão de ferramenta, porta, caminho, commit, tempo. Chave curta em minúsculas sem espaço (ex.: testes, versao-python, porta, commit); valor curto. Só o que está literalmente no texto; nada inferido. Até 6 fatos.',
    usuario: `Comando: ${comando.slice(0, 200)}\nSaída:\n${saida.slice(-3000)}`,
    schema: { type: 'object', properties: { fatos: { type: 'array', items: { type: 'object', properties: { chave: { type: 'string' }, valor: { type: 'string' } }, required: ['chave', 'valor'] } } }, required: ['fatos'] }, maxTokens: 300,
  });
  // Trava de código: fato só vale se está literalmente na saída (todo número do valor aparece no texto) e não é enchimento ("n/a", "0" sem fonte).
  const l = Array.isArray(r?.fatos) ? r.fatos.filter((f) => {
    if (!f || !/^[\p{L}\p{N}_.:-]{1,40}$/u.test(String(f.chave))) return false;
    const v = String(f.valor || '').trim();
    if (!v || /^(n\/?a|none|null|-+|nenhum|desconhecido|indispon[ií]vel)$/i.test(v)) return false;
    if (/test/i.test(String(f.chave)) && !/test|passed|failed|passou|falhou|errors?/i.test(saida)) return false;   // "testes: 0" numa saída de build é enchimento
    const nums = v.match(/\d+(?:\.\d+)?/g) || [];
    return nums.every((n) => saida.includes(n)) && (nums.length || saida.toLowerCase().includes(v.toLowerCase().split(/[ ,;(]/)[0]));
  }).slice(0, 6) : [];
  return l.length ? l.map((f) => ({ chave: String(f.chave), valor: String(f.valor).slice(0, 200) })) : null;
}

/** Resumo curto (3 a 5 linhas) do que aconteceu, para quem voltou. Só com os itens dados. */
export async function resumir({ itens, desde }) {
  const r = await chamar({
    sistema: 'Resuma em 3 a 5 linhas, português do Brasil, para a pessoa que lidera o projeto, o que a equipe fez enquanto ela esteve fora. Direto, sem adjetivo, sem inventar. Cada linha é um fato da lista. Termine com o que precisa dela, se houver.',
    usuario: `Desde ${desde}:\n${itens.slice(0, 40).map((x) => `- ${x}`).join('\n')}`,
    schema: { type: 'object', properties: { resumo: { type: 'string' } }, required: ['resumo'] }, maxTokens: 260,
  });
  const t = String(r?.resumo || '').trim();
  const dados = new Set(itens.join(' ').match(/\d+/g) || []);
  if ((t.match(/\d+/g) || []).some((n) => !dados.has(n))) return null;   // número que não veio dos itens: não resume
  return t ? t.slice(0, 1200) : null;
}

/** Compacta a saída de um comando para o modelo pago ler: só as linhas que importam (falhas, erros, totais), copiadas literalmente.
 *  Corta token de entrada sem perder informação: cada linha devolvida precisa existir na saída, senão é descartada. */
export async function compactarLog({ comando, saida, max = 12 }) {
  const txt = String(saida || '');
  if (txt.length < 1200) return null;   // curto já cabe inteiro
  const r = await chamar({
    sistema: 'Você seleciona, da saída de um comando, as linhas que um desenvolvedor precisa ler para agir: nomes de testes que falharam, mensagens de erro com arquivo e linha, totais (passed/failed/errors), avisos de ambiente. Copie as linhas EXATAMENTE como estão (sem reescrever, sem resumir, sem traduzir). Até 12 linhas. Ignore barras de progresso, warnings repetidos e linhas de sucesso individuais.',
    usuario: `Comando: ${String(comando || '').slice(0, 200)}\nSaída:\n${txt.slice(-6000)}`,
    schema: { type: 'object', properties: { linhas: { type: 'array', items: { type: 'string' } } }, required: ['linhas'] }, maxTokens: 500,
  });
  const linhas = (Array.isArray(r?.linhas) ? r.linhas : []).map((l) => String(l).trim()).filter((l) => l.length > 3 && txt.includes(l)).slice(0, max);
  return linhas.length ? linhas : null;
}

// ---- modo de teste: respostas determinísticas no formato de cada schema
function simulado({ sistema, usuario, schema }) {
  const props = Object.keys(schema?.properties || {});
  if (props.includes('frase')) { const ev = (usuario.match(/Evento: (.*)/) || [])[1] || 'evento'; return { frase: `(local) ${ev.slice(0, 120)}` }; }
  if (props.includes('rotineira')) {
    const ops = [...usuario.matchAll(/^(\d+)\. (.*)$/gm)].map((m) => m[2]);
    const rec = ops.findIndex((o) => /recomendad|segur|revers|manter|unit[aá]rio/i.test(o));
    const julgamento = /escopo|produto|contrato|apagar|recriar|produ[cç][aã]o|dinheiro|credencial|senha|deploy/i.test(usuario.split('\nOpções')[0]);   // só a pergunta; opção destrutiva entre as alternativas não impede escolher a segura
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
