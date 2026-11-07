// Reads a .md document written outside the app and extracts the rules it contains, without calling a model.
// Each list item (bulleted or numbered), each short paragraph and each table row becomes a rule.
// The section title goes in front, in brackets, so the rule keeps its subject: "[Git] Commit só com o que a tarefa mudou."

const LIMPA = (t) => t
  .replace(/!\[[^\]]*\]\([^)]*\)/g, '')                 // image
  .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')              // link becomes just the text
  .replace(/(\*\*|__)(.+?)\1/g, '$2').replace(/(^|\W)[*_](\S[^*_]*?)[*_](?=\W|$)/g, '$1$2')
  .replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();

const normalizar = (t) => t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/^\[[^\]]*\]\s*/, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

/** Titles that carry no rules (index, table of contents, examples, references): their content is ignored. */
const SECAO_IGNORADA = /^(sum[aá]rio|[ií]ndice|table of contents|toc|refer[eê]ncias|references|links|changelog|hist[oó]rico|exemplos?( de c[oó]digo)?|examples?)$/i;

/**
 * @param {string} md  file text
 * @returns {string[]} rules in document order, without repetition
 */
export function extrairRegras(md) {
  const linhas = String(md || '').replace(/\r\n?/g, '\n').replace(/^---\n[\s\S]*?\n---\n/, '').split('\n');
  const regras = [];
  const titulos = [];          // stack of titles per level
  let ignorar = false, cerca = false, paragrafo = [], item = null, linhaTabela = -1;
  const temSecoes = linhas.some((l) => /^\s{0,3}#{2,6}\s/.test(l));

  const secao = () => titulos.filter(Boolean).slice(-1)[0] || '';
  const guardar = (texto) => {
    const t = LIMPA(texto).replace(/^[-–—:]\s*/, '');
    if (t.length < 4 || ignorar) return;
    if (!/[\p{L}]{3}/u.test(t)) return;                 // only symbols or numbers
    const s = secao();
    regras.push(s && !normalizar(t).startsWith(normalizar(s)) ? `[${s}] ${t}` : t);
  };
  const fecharItem = () => { if (item) { guardar(item.texto + (item.filhos.length ? `: ${item.filhos.join('; ')}` : '')); item = null; } };
  const fecharParagrafo = () => {
    if (!paragrafo.length) return;
    const t = paragrafo.join(' ');
    if (temSecoes && !secao()) { paragrafo = []; return; }   // the document's opening text is an introduction, not a rule
    // a paragraph that is too long is explanation, not a rule; it becomes one rule per sentence only if short
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
      titulos.length = nivel; titulos[nivel - 1] = nivel === 1 ? '' : texto;   // the document title (#) does not become a prefix
      ignorar = SECAO_IGNORADA.test(texto);
      continue;
    }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(linha) || /^\s*>/.test(linha) && !linha.replace(/^\s*>\s?/, '').trim()) { fecharTudo(); continue; }

    const tab = linha.match(/^\s*\|(.+)\|\s*$/);
    if (tab) {
      fecharTudo();
      if (/^[\s|:-]+$/.test(tab[1])) { if (linhaTabela >= 0) regras.splice(linhaTabela, 1); linhaTabela = -1; continue; }   // separator: the line above was the header
      linhaTabela = regras.length;
      const cel = tab[1].split('|').map((c) => LIMPA(c)).filter(Boolean);
      if (cel.length) guardar(cel.join(': '));
      continue;
    }

    const li = linha.match(/^(\s*)(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?(.*)$/);
    if (li) {
      fecharParagrafo();
      const recuo = li[1].length;
      if (item && recuo >= 2 && recuo > item.recuo) { item.filhos.push(LIMPA(li[2])); continue; }   // a sub-item stays with its item
      fecharItem();
      item = { recuo, texto: li[2], filhos: [] };
      continue;
    }
    const texto = linha.replace(/^\s*>\s?/, '').trim();
    if (item) { if (item.filhos.length) item.filhos[item.filhos.length - 1] += ` ${LIMPA(texto)}`; else item.texto += ` ${texto}`; continue; }   // item continuation
    paragrafo.push(texto);
  }
  fecharTudo();

  const vistos = new Set();
  return regras.filter((r) => { const k = normalizar(r); if (!k || vistos.has(k)) return false; vistos.add(k); return true; });
}

/** Rule list stored as "- ..." items in regras.md (also accepts old text, one rule per line). */
export function listaDeTexto(texto) {
  return String(texto || '').split('\n').map((l) => l.replace(/^\s*(?:[-*+]|\d+[.)])\s+/, '').trim()).filter(Boolean);
}
export const textoDeLista = (itens) => itens.map((i) => `- ${String(i).replace(/\s+/g, ' ').trim()}`).filter((l) => l.length > 2).join('\n');

/** Merges new rules into the existing ones without repeating (compares ignoring accents, case, punctuation and section prefix). */
export function juntar(existentes, novas) {
  const chaves = new Set(existentes.map(normalizar));
  const adicionadas = [], repetidas = [];
  for (const r of novas) { const k = normalizar(r); if (!k) continue; if (chaves.has(k)) repetidas.push(r); else { chaves.add(k); adicionadas.push(r); } }
  return { itens: [...existentes, ...adicionadas], adicionadas, repetidas };
}
