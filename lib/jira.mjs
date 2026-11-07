// Leitura do Jira pela API REST. SÓ LEITURA: o app nunca cria, edita nem move nada no Jira.
// Duas formas de autenticar: token pessoal (Bearer, Jira Data Center e Server) ou e-mail com API token
// (Basic, Jira Cloud). O resultado vira uma lista curta de demandas que a P.O. enxerga.

export const JQL_PADRAO = 'assignee = currentUser() AND resolution = Unresolved ORDER BY priority DESC, updated DESC';

const limpar = (url) => String(url || '').trim().replace(/\/+$/, '');

function cabecalhos({ tipo, usuario, token }) {
  const h = { Accept: 'application/json' };
  if (tipo === 'cloud') h.Authorization = `Basic ${Buffer.from(`${usuario}:${token}`).toString('base64')}`;
  else h.Authorization = `Bearer ${token}`;
  return h;
}

// Descrições do Jira Cloud (API v3) vêm em ADF, uma árvore; aqui sai só o texto.
function textoDe(no) {
  if (!no) return '';
  if (typeof no === 'string') return no;
  if (Array.isArray(no)) return no.map(textoDe).join('');
  const filhos = textoDe(no.content);
  if (no.type === 'text') return no.text || '';
  if (['paragraph', 'heading', 'listItem', 'codeBlock'].includes(no.type)) return `${filhos}\n`;
  return filhos;
}

async function pedir(url, opts, ms = 15_000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try { return await fetch(url, { ...opts, signal: ctl.signal }); } finally { clearTimeout(t); }
}

function erroAmigavel(status, corpo) {
  if (status === 401) return 'O Jira recusou o acesso (401). Confira o token e, no Jira Cloud, o e-mail.';
  if (status === 403) return 'O Jira negou a permissão (403) para esta consulta.';
  if (status === 404) return 'Não encontrei a API do Jira neste endereço (404). Confira a URL base.';
  if (status === 400) return `O Jira não entendeu a consulta (400): ${String(corpo).slice(0, 160)}`;
  return `O Jira respondeu ${status}.`;
}

/** Busca as demandas. cfg: { url, tipo, usuario, token, jql, max }. Devolve { ok, itens, erro }. */
export async function buscar(cfg) {
  const base = limpar(cfg.url);
  if (!/^https?:\/\//i.test(base)) return { ok: false, erro: 'Informe a URL do Jira, começando com https://.' };
  if (!cfg.token) return { ok: false, erro: 'Falta o token do Jira.' };
  if (cfg.tipo === 'cloud' && !cfg.usuario) return { ok: false, erro: 'No Jira Cloud, informe também o e-mail.' };
  const jql = cfg.jql || JQL_PADRAO;
  const campos = 'summary,status,priority,issuetype,updated,duedate,description,labels';
  const max = Math.min(Math.max(Number(cfg.max) || 40, 1), 100);
  const h = cabecalhos(cfg);
  try {
    // O Jira Cloud novo usa /rest/api/3/search/jql; o Data Center e o Server usam /rest/api/2/search (ou 3).
    const tentativas = [
      `${base}/rest/api/3/search/jql?jql=${encodeURIComponent(jql)}&fields=${campos}&maxResults=${max}`,
      `${base}/rest/api/2/search?jql=${encodeURIComponent(jql)}&fields=${campos}&maxResults=${max}`,
      `${base}/rest/api/3/search?jql=${encodeURIComponent(jql)}&fields=${campos}&maxResults=${max}`,
    ];
    let ultimo = null;
    for (const u of tentativas) {
      const r = await pedir(u, { headers: h });
      if (r.ok) {
        const j = await r.json();
        const itens = (j.issues || []).map((i) => ({
          key: i.key,
          resumo: i.fields?.summary || '',
          status: i.fields?.status?.name || '',
          prioridade: i.fields?.priority?.name || '',
          tipo: i.fields?.issuetype?.name || '',
          atualizado: i.fields?.updated || null,
          vencimento: i.fields?.duedate || null,
          etiquetas: i.fields?.labels || [],
          descricao: textoDe(i.fields?.description).trim().slice(0, 900),
          url: `${base}/browse/${i.key}`,
        }));
        return { ok: true, itens, total: j.total ?? itens.length };
      }
      const atual = { status: r.status, corpo: await r.text().catch(() => '') };
      if (!ultimo || r.status !== 404) ultimo = atual; // um 404 de rota não esconde o erro real da consulta (400, 401...)
      if (r.status === 401 || r.status === 403) break; // credencial: trocar de rota não ajuda
    }
    return { ok: false, erro: erroAmigavel(ultimo.status, ultimo.corpo) };
  } catch (e) {
    return { ok: false, erro: e.name === 'AbortError' ? 'O Jira demorou demais para responder (15 s).' : `Não consegui falar com o Jira: ${e.cause?.code || e.message}. Confira a URL e se a rede da empresa está acessível.` };
  }
}
