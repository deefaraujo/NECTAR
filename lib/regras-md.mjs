// Lê um documento .md escrito por fora do app e extrai as regras que ele contém, sem chamar modelo.
// Cada item de lista (com marcador ou numerado), cada parágrafo curto e cada linha de tabela vira uma regra.
// O título da seção entra na frente, entre colchetes, para a regra não perder o assunto: "[Git] Commit só com o que a tarefa mudou."

const LIMPA = (t) => t
  .replace(/!\[[^\]]*\]\([^)]*\)/g, '')                 // imagem
  .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')              // link vira só o texto
  .replace(/(\*\*|__)(.+?)\1/g, '$2').replace(/(^|\W)[*_](\S[^*_]*?)[*_](?=\W|$)/g, '$1$2')
  .replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();

const normalizar = (t) => t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/^\[[^\]]*\]\s*/, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

/** Títulos que não trazem regra (índice, sumário, exemplos, referências): o conteúdo deles é ignorado. */
const SECAO_IGNORADA = /^(sum[aá]rio|[ií]ndice|table of contents|toc|refer[eê]ncias|references|links|changelog|hist[oó]rico|exemplos?( de c[oó]digo)?|examples?)$/i;

/**
 * @param {string} md  texto do arquivo
 * @returns {string[]} regras na ordem do documento, sem repetição
 */
export function extrairRegras(md) {
  const linhas = String(md || '').replace(/\r\n?/g, '\n').replace(/^---\n[\s\S]*?\n---\n/, '').split('\n');
  const regras = [];
  const titulos = [];          // pilha de títulos por nível
  let ignorar = false, cerca = false, paragrafo = [], item = null, linhaTabela = -1;
  const temSecoes = linhas.some((l) => /^\s{0,3}#{2,6}\s/.test(l));

  const secao = () => titulos.filter(Boolean).slice(-1)[0] || '';
  const guardar = (texto) => {
    const t = LIMPA(texto).replace(/^[-–—:]\s*/, '');
    if (t.length < 4 || ignorar) return;
    if (!/[\p{L}]{3}/u.test(t)) return;                 // só símbolos ou números
    const s = secao();
    regras.push(s && !normalizar(t).startsWith(normalizar(s)) ? `[${s}] ${t}` : t);
  };
  const fecharItem = () => { if (item) { guardar(item.texto + (item.filhos.length ? `: ${item.filhos.join('; ')}` : '')); item = null; } };
  const fecharParagrafo = () => {
    if (!paragrafo.length) return;
    const t = paragrafo.join(' ');
    if (temSecoes && !secao()) { paragrafo = []; return; }   // texto de abertura do documento é apresentação, não regra
    // parágrafo longo demais é explicação, não regra; vira uma regra por frase só se for curto
    if (t.length <= 400) guardar(t);
    else for (const frase of t.split(/(?<=[.!?])\s+/)) if (frase.length <= 300) guardar(frase);
    paragrafo = [];
  };
  const fecharTudo = () => { fecharItem(); fecharParagrafo(); };

  for (const bruta of linhas) {
    if (/^\s*(```|~~~)/.test(bruta)) { fecharTudo(); cerca = !cerca; continue; }
    if (cerca) continue;
    const linha = bruta.replace(/\t/g, '    ');
    if (!linha.trim()) { fecharTudo(); linhaTabela = -1; continue; }

    const h = linha.match(/^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (h) {
      fecharTudo();
      const nivel = h[1].length, texto = LIMPA(h[2]);
      titulos.length = nivel; titulos[nivel - 1] = nivel === 1 ? '' : texto;   // o título do documento (#) não vira prefixo
      ignorar = SECAO_IGNORADA.test(texto);
      continue;
    }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(linha) || /^\s*>/.test(linha) && !linha.replace(/^\s*>\s?/, '').trim()) { fecharTudo(); continue; }

    const tab = linha.match(/^\s*\|(.+)\|\s*$/);
    if (tab) {
      fecharTudo();
      if (/^[\s|:-]+$/.test(tab[1])) { if (linhaTabela >= 0) regras.splice(linhaTabela, 1); linhaTabela = -1; continue; }   // separador: a linha de cima era o cabeçalho
      linhaTabela = regras.length;
      const cel = tab[1].split('|').map((c) => LIMPA(c)).filter(Boolean);
      if (cel.length) guardar(cel.join(': '));
      continue;
    }

    const li = linha.match(/^(\s*)(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?(.*)$/);
    if (li) {
      fecharParagrafo();
      const recuo = li[1].length;
      if (item && recuo >= 2 && recuo > item.recuo) { item.filhos.push(LIMPA(li[2])); continue; }   // subitem fica junto do item
      fecharItem();
      item = { recuo, texto: li[2], filhos: [] };
      continue;
    }
    const texto = linha.replace(/^\s*>\s?/, '').trim();
    if (item) { if (item.filhos.length) item.filhos[item.filhos.length - 1] += ` ${LIMPA(texto)}`; else item.texto += ` ${texto}`; continue; }   // continuação do item
    paragrafo.push(texto);
  }
  fecharTudo();

  const vistos = new Set();
  return regras.filter((r) => { const k = normalizar(r); if (!k || vistos.has(k)) return false; vistos.add(k); return true; });
}

/** Lista de regras guardada como itens "- ..." em regras.md (aceita também texto antigo, uma regra por linha). */
export function listaDeTexto(texto) {
  return String(texto || '').split('\n').map((l) => l.replace(/^\s*(?:[-*+]|\d+[.)])\s+/, '').trim()).filter(Boolean);
}
export const textoDeLista = (itens) => itens.map((i) => `- ${String(i).replace(/\s+/g, ' ').trim()}`).filter((l) => l.length > 2).join('\n');

/** Junta regras novas às existentes sem repetir (compara sem acento, caixa, pontuação e prefixo de seção). */
export function juntar(existentes, novas) {
  const chaves = new Set(existentes.map(normalizar));
  const adicionadas = [], repetidas = [];
  for (const r of novas) { const k = normalizar(r); if (!k) continue; if (chaves.has(k)) repetidas.push(r); else { chaves.add(k); adicionadas.push(r); } }
  return { itens: [...existentes, ...adicionadas], adicionadas, repetidas };
}
