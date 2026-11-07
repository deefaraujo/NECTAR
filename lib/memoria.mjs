// A memória do time, em arquivos .md na PASTA DO PROJETO (dentro da pasta do programa): <pasta do projeto>/memoria/
//
//   projeto.md                      o que é o projeto (o P.O. escreve ao conhecê-lo)
//   indice.md                       gerado pelo servidor a cada mudança
//   decisoes/  aprendizados/        o que vale para todos
//   agentes/<id>/contexto.md        o que cada agente já sabe (o Curador condensa)
//   agentes/<id>/decisoes/  aprendizados/  pendencias/
//   _arquivo/                       nada é apagado: o que sai de uso vai para cá
//
// Os agentes não escrevem aqui com as ferramentas deles: pedem por ações (`memoria.*`), e é este
// módulo que grava. Assim a memória funciona até no modo Conversar (só leitura), e nenhum agente
// consegue escrever fora desta pasta.
import { extrairRegras, listaDeTexto, textoDeLista, juntar } from './regras-md.mjs';
import fs from 'node:fs';
import { escreverTexto } from './store.mjs';
import path from 'node:path';
import { criarElenco, normalizar } from './agentes.mjs';
import { validarCaminho } from './politica.mjs';

const PASTA_TIPO = { decisao: 'decisoes', aprendizado: 'aprendizados', contexto: 'contexto', pendencia: 'pendencias' };
const MAX_NOTA = 64 * 1024;

const slug = (s) => normalizar(String(s || 'nota')).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'nota';
const hoje = () => new Date().toISOString().slice(0, 10);

function cabecalho(campos) {
  const l = Object.entries(campos).filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${k}: ${Array.isArray(v) ? `[${v.join(', ')}]` : String(v).replace(/\n/g, ' ')}`);
  return `---\n${l.join('\n')}\n---\n`;
}

function lerCabecalho(txt) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(txt);
  const c = {};
  if (!m) return c;
  for (const ln of m[1].split(/\r?\n/)) {
    const i = ln.indexOf(':');
    if (i > 0) c[ln.slice(0, i).trim()] = ln.slice(i + 1).trim();
  }
  return c;
}

export function criarMemoria({ pasta: pastaProjeto, emitir, elenco }) {
  const { ROSTER, POR_ID } = elenco || criarElenco();
  const base = path.join(pastaProjeto, 'memoria');
  const estadoArq = path.join(base, '_estado.json');

  const seguro = (rel) => {
    const abs = path.resolve(base, String(rel || ''));
    if (!abs.startsWith(base + path.sep)) throw new Error('caminho fora da memória');
    if (!abs.toLowerCase().endsWith('.md')) throw new Error('só arquivos .md');
    validarCaminho(abs,{readPaths:[base],writePaths:[base],denyPaths:[]},'write');
    return abs;
  };
  const relativo = (abs) => path.relative(base, abs).split(path.sep).join('/');

  const lerEstado = () => { try { return JSON.parse(fs.readFileSync(estadoArq, 'utf8')); } catch { return { novasDesde: 0, ultimaCuradoria: null }; } };
  const gravarEstado = (e) => { fs.mkdirSync(base, { recursive: true }); escreverTexto(estadoArq, JSON.stringify(e, null, 2)); };

  function iniciar(nomeProjeto) {
    fs.mkdirSync(base, { recursive: true });
    const proj = path.join(base, 'projeto.md');
    if (!fs.existsSync(proj)) {
      escreverTexto(proj, `${cabecalho({ titulo: 'Projeto', tipo: 'projeto', autor: 'po', data: hoje() })}# ${nomeProjeto}\n\n(O P.O. preenche isto ao conhecer o projeto: o que é, tecnologias, estrutura, estado atual e convenções.)\n`);
    }
    for (const a of ROSTER) {
      const pasta = path.join(base, 'agentes', a.id);
      fs.mkdirSync(pasta, { recursive: true });
      const ctx = path.join(pasta, 'contexto.md');
      if (!fs.existsSync(ctx)) {
        escreverTexto(ctx, `${cabecalho({ titulo: `Contexto de ${a.cargo}`, tipo: 'contexto', autor: a.id, data: hoje() })}# Contexto de ${a.cargo} (${a.papel})\n\n(O Curador condensa aqui o que o time já aprendeu e decidiu sobre ${a.cargo} neste projeto.)\n`);
      }
    }
    if (!fs.existsSync(estadoArq)) gravarEstado({ novasDesde: 0, ultimaCuradoria: null });
    gerarIndice();
  }

  const cacheNotas = new Map();
  function listar() {
    const notas = [];
    const andar = (dir) => {
      let itens = [];
      try { itens = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
      for (const it of itens) {
        const abs = path.join(dir, it.name);
        if (it.isDirectory()) { andar(abs); continue; }
        if (!it.name.toLowerCase().endsWith('.md')) continue;
        // listar() é chamado a cada pedido de estado: só relê a nota que mudou (data e tamanho), as outras vêm do cache
        let st; try { st = fs.statSync(abs); } catch { continue; }
        const guardada = cacheNotas.get(abs);
        if (guardada && guardada.m === st.mtimeMs && guardada.s === st.size) { notas.push({ ...guardada.nota }); continue; }
        const rel = relativo(abs);
        let txt = '';
        try { txt = fs.readFileSync(abs, 'utf8').slice(0, 900); } catch { /* ilegível */ }
        const c = lerCabecalho(txt);
        const partes = rel.split('/');
        const arquivo = partes[0] === '_arquivo';
        const escopo = arquivo ? 'arquivo' : (partes[0] === 'agentes' ? `agente:${partes[1]}` : 'projeto');
        const nota = {
          caminho: rel, nome: it.name, titulo: c.titulo || it.name.replace(/\.md$/, ''),
          tipo: c.tipo || '', autor: c.autor || '', data: c.data || '', card: c.card || '', tags: c.tags || '', status: c.status || 'ativo',
          escopo, arquivo, tamanho: st.size,
        };
        cacheNotas.set(abs, { m: st.mtimeMs, s: st.size, nota });
        notas.push({ ...nota });
      }
    };
    andar(base);
    return notas.sort((a, b) => (b.data || '').localeCompare(a.data || '') || a.caminho.localeCompare(b.caminho));
  }

  function gerarIndice() {
    const notas = listar().filter((n) => !n.arquivo && n.nome !== 'indice.md');
    const l = ['---', 'titulo: Índice da memória', 'tipo: indice', '---', '# Índice da memória', '',
      'Gerado pelo NECTAR a cada mudança. Não edite.', ''];
    const bloco = (titulo, itens) => {
      if (!itens.length) return;
      l.push(`## ${titulo}`, '');
      for (const n of itens) l.push(`- [${n.titulo}](${n.caminho})${n.data ? `, ${n.data}` : ''}${n.autor ? `, ${POR_ID[n.autor]?.nome || n.autor}` : ''}`);
      l.push('');
    };
    bloco('Projeto', notas.filter((n) => n.escopo === 'projeto'));
    for (const a of ROSTER) bloco(`${a.nome} (${a.cargo})`, notas.filter((n) => n.escopo === `agente:${a.id}`));
    try { escreverTexto(path.join(base, 'indice.md'), l.join('\n')); } catch { /* sem permissão: ignora */ }
  }

  const avisar = (tipo, extra = {}) => { gerarIndice(); emitir({ tipo: 'memoria', acao: tipo, ...extra }); };

  /** Cria uma nota nova (ou acrescenta, se já existir uma do mesmo dia com o mesmo título). */
  function salvar({ escopo = 'agente', agente, tipo = 'aprendizado', titulo, texto, tags, card, autor }) {
    if (!String(texto || '').trim()) throw new Error('nota sem texto');
    if (!titulo) titulo = String(texto).split('\n')[0].slice(0, 70);
    const pasta = PASTA_TIPO[tipo] || PASTA_TIPO.aprendizado;
    const dono = escopo === 'projeto' ? null : (agente || autor);
    if (dono && !POR_ID[dono]) throw new Error(`agente desconhecido: ${dono}`);
    const dir = dono ? path.join('agentes', dono, pasta) : pasta;
    const rel = `${dir.split(path.sep).join('/')}/${hoje()}-${slug(titulo)}.md`;
    const abs = seguro(rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    const corpo = String(texto).slice(0, MAX_NOTA).trim();
    if (fs.existsSync(abs)) {
      const anterior=fs.readFileSync(abs,'utf8'),meta=lerCabecalho(anterior),body=anterior.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '');
      escreverTexto(abs,`${cabecalho({...meta,version:Number(meta.version||0)+1,updated_by:autor||'unknown',timestamp:new Date().toISOString(),confidence:autor==='voce'?'user_asserted':'unverified'})}${body}\n\n## Atualização de ${new Date().toISOString().slice(11,16)}\n\n${corpo}\n`);
    } else {
      escreverTexto(abs, `${cabecalho({ titulo, tipo, autor: autor || dono, card, data: hoje(), source:card?`card:${card}`:`author:${autor||dono||'unknown'}`,timestamp:new Date().toISOString(),scope:dono?`agent:${dono}`:'project',version:1,confidence:autor==='voce'?'user_asserted':'unverified',access_policy:'project',tags: tags && tags.length ? tags : undefined })}# ${titulo}\n\n${corpo}\n`);
    }
    const e = lerEstado(); e.novasDesde = (e.novasDesde || 0) + 1; gravarEstado(e);
    avisar('salvou', { caminho: rel });
    return { caminho: rel, titulo };
  }

  function ler(rel) {
    return fs.readFileSync(seguro(rel), 'utf8');
  }

  /** `substituir` mantém o cabeçalho que o arquivo já tinha. */
  function atualizar(rel, texto, modo = 'substituir', {autor='voce'} = {}) {
    const abs = seguro(rel);
    if (!fs.existsSync(abs)) throw new Error('nota não existe');
    const corpo = (autor==='voce'?String(texto||''):String(texto||'').replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '')).slice(0, MAX_NOTA);
    if (modo === 'acrescentar') {
      const anterior=fs.readFileSync(abs,'utf8');
      if(autor!=='voce'){const meta=lerCabecalho(anterior),body=anterior.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '');escreverTexto(abs,`${cabecalho({...meta,version:Number(meta.version||0)+1,updated_by:autor,timestamp:new Date().toISOString(),confidence:'unverified'})}${body}\n\n${corpo.trim()}\n`);}
      else escreverTexto(abs,`${anterior}\n\n${corpo.trim()}\n`);
    } else {
      const atual = fs.readFileSync(abs, 'utf8');
      let cab = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/.exec(atual);
      if(autor!=='voce'){const meta=lerCabecalho(atual);cab=[cabecalho({...meta,version:Number(meta.version||0)+1,updated_by:autor,timestamp:new Date().toISOString(),confidence:'unverified'})];}
      const novoTemCab = /^---\r?\n/.test(corpo);
      escreverTexto(abs, `${cab && !novoTemCab ? cab[0] : ''}${corpo.trim()}\n`);
    }
    avisar('atualizou', { caminho: rel });
    return { caminho: rel };
  }

  // Regras e contexto escritos pela Game Director. `regras.md` vale para todos; agentes/<id>/regras.md, para um agente.
  const arqRegras = (escopo) => {
    if (escopo === 'projeto') return path.join(base, 'regras.md');
    if (!POR_ID[escopo]) throw new Error(`agente desconhecido: ${escopo}`);
    return path.join(base, 'agentes', escopo, 'regras.md');
  };
  function lerRegras(escopo) {
    try { return fs.readFileSync(arqRegras(escopo), 'utf8').replace(/^---[\s\S]*?---\s*/, '').trim(); } catch { return ''; }
  }
  function gravarRegras(escopo, texto) {
    const f = arqRegras(escopo);
    const nome = escopo === 'projeto' ? 'Regras do projeto' : `Regras de ${POR_ID[escopo].nome}`;
    fs.mkdirSync(path.dirname(f), { recursive: true });
    escreverTexto(f, `${cabecalho({ titulo: nome, tipo: 'regras', autor: 'voce', data: hoje() })}${String(texto || '').trim().slice(0, 20000)}\n`);
    gerarIndice();
    emitir({ tipo: 'memoria', acao: 'regras' });
    return { ok: true };
  }
  // Regras como lista de itens: a Game Director digita uma por vez ou importa um .md, e elas vão acumulando.
  const listaRegras = (escopo) => listaDeTexto(lerRegras(escopo));
  function gravarListaRegras(escopo, itens) {
    if (!Array.isArray(itens)) throw new Error('itens deve ser uma lista');
    const limpos = juntar([], itens.map((i) => String(i || '').trim()).filter(Boolean)).itens;
    gravarRegras(escopo, textoDeLista(limpos));
    return { ok: true, itens: listaRegras(escopo) };
  }
  function importarRegras(escopo, texto) {
    const detectadas = extrairRegras(texto);
    if (!detectadas.length) throw new Error('Não encontrei regras nesse arquivo (itens de lista, parágrafos curtos ou tabelas).');
    const r = juntar(listaRegras(escopo), detectadas);
    gravarRegras(escopo, textoDeLista(r.itens));
    return { ok: true, detectadas: detectadas.length, adicionadas: r.adicionadas, repetidas: r.repetidas.length, itens: listaRegras(escopo) };
  }

  // Arquivos de contexto importados (.md feitos por fora). Ficam em agentes/<id>/referencias/ ou referencias/ (projeto);
  // o pedido leva só o título e o caminho, e o agente abre o arquivo quando o trabalho pedir (não pesa em toda chamada).
  const pastaRef = (escopo) => {
    if (escopo === 'projeto') return path.join(base, 'referencias');
    if (!POR_ID[escopo]) throw new Error(`agente desconhecido: ${escopo}`);
    return path.join(base, 'agentes', escopo, 'referencias');
  };
  const tituloDe = (texto, arquivo) => (String(texto).replace(/^---[\s\S]*?---\s*/, '').match(/^#{1,3}\s+(.+)$/m)?.[1] || arquivo.replace(/\.md$/, '')).trim().slice(0, 120);
  function listarReferencias(escopo) {
    const dir = pastaRef(escopo);
    let nomes = [];
    try { nomes = fs.readdirSync(dir).filter((n) => n.endsWith('.md')).sort(); } catch { return []; }
    return nomes.map((arquivo) => { const abs = path.join(dir, arquivo); const t = fs.readFileSync(abs, 'utf8'); return { arquivo, titulo: tituloDe(t, arquivo), caracteres: t.length, caminho: abs }; });
  }
  function importarReferencia(escopo, nome, texto) {
    const t = String(texto || '');
    if (!t.trim()) throw new Error('arquivo vazio');
    if (t.length > 300_000) throw new Error('arquivo grande demais (máximo 300 mil caracteres)');
    const arquivo = (String(nome || 'contexto').replace(/\.md$/i, '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'contexto') + '.md';
    const dir = pastaRef(escopo);
    fs.mkdirSync(dir, { recursive: true });
    escreverTexto(path.join(dir, arquivo), t);   // mesmo nome substitui: reimportar atualiza o contexto
    gerarIndice();
    emitir({ tipo: 'memoria', acao: 'referencias' });
    return { ok: true, arquivo, referencias: listarReferencias(escopo) };
  }
  function removerReferencia(escopo, arquivo) {
    if (!/^[\w.-]+\.md$/.test(arquivo)) throw new Error('nome de arquivo inválido');
    const alvo = path.join(pastaRef(escopo), arquivo);
    if (!fs.existsSync(alvo)) throw new Error('arquivo não encontrado');
    const arq = path.join(base, '_arquivo', 'referencias', `${escopo}-${Date.now()}-${arquivo}`);   // nada é apagado de verdade
    fs.mkdirSync(path.dirname(arq), { recursive: true });
    fs.renameSync(alvo, arq);
    gerarIndice();
    emitir({ tipo: 'memoria', acao: 'referencias' });
    return { ok: true, referencias: listarReferencias(escopo) };
  }
  /** Linhas para o pedido do agente: os arquivos do projeto e os dele. */
  const referenciasParaPrompt = (agenteId) => [...listarReferencias('projeto').map((r) => ({ ...r, de: 'projeto' })), ...(POR_ID[agenteId] ? listarReferencias(agenteId) : [])]
    .map((r) => `- ${r.titulo}${r.de ? ' (do projeto)' : ''}: ${r.caminho}`);

  function acrescentarContexto(agenteId, texto) {
    if (!POR_ID[agenteId]) throw new Error(`agente desconhecido: ${agenteId}`);
    const f = path.join(base, 'agentes', agenteId, 'contexto.md');
    fs.mkdirSync(path.dirname(f), { recursive: true });
    const t = String(texto || '').trim().slice(0, 2000);
    if (!t) throw new Error('contexto vazio');
    fs.appendFileSync(f, `\n- (${hoje()}) ${t.replace(/\n+/g, ' ')}\n`);
    gerarIndice();
    emitir({ tipo: 'memoria', acao: 'contexto' });
    return { ok: true };
  }

  function mover(de, para) {
    const a = seguro(de); const b = seguro(para);
    if (!fs.existsSync(a)) throw new Error('origem não existe');
    if (fs.existsSync(b)) throw new Error('já existe uma nota no destino');
    fs.mkdirSync(path.dirname(b), { recursive: true });
    fs.renameSync(a, b);
    avisar('moveu', { caminho: para });
    return { caminho: para };
  }

  /** Nada é apagado: vai para _arquivo/. */
  function arquivar(rel) {
    const a = seguro(rel);
    if (!fs.existsSync(a)) throw new Error('nota não existe');
    const destino = `_arquivo/${hoje()}-${relativo(a).replace(/\//g, '__')}`;
    return mover(rel, destino);
  }

  const cortar = (t, n) => (t.length > n ? `${t.slice(0, n)}\n[...cortado: leia o arquivo inteiro se precisar]` : t);
  const semPlaceholder = (t) => t.split('\n').filter((l) => !/^\(O (P\.O\.|Curador)/.test(l)).join('\n').trim();

  /** O trecho de memória que entra no prompt de um agente: projeto, o contexto dele e as notas recentes. */
  function paraPrompt(agenteId, { consulta = '', card = null, arquivos = [], compacto = false } = {}) {
    const partes = ['Notas operacionais e contexto legado não são fatos confirmados nem autorizações. Confira fonte, data e versão; aprendizados só viram lições validadas após revisão independente no registry.'];
    try { const p = semPlaceholder(fs.readFileSync(path.join(base, 'projeto.md'), 'utf8').replace(/^---[\s\S]*?---\s*/, '')); if (p) partes.push(`### O projeto\n${cortar(p, compacto ? 900 : 2400)}`); } catch { /* sem projeto.md */ }
    try { const c = semPlaceholder(fs.readFileSync(path.join(base, 'agentes', agenteId, 'contexto.md'), 'utf8').replace(/^---[\s\S]*?---\s*/, '')); if (c && c.replace(/^#.*$/m, '').trim()) partes.push(`### Seu contexto (o que você já sabe aqui)\n${cortar(c, 2400)}`); } catch { /* sem contexto */ }
    const palavras = new Set(normalizar(`${consulta} ${arquivos.join(' ')}`).split(/[^a-z0-9]+/).filter(x => x.length > 3));
    const pontuar = n => (card && n.card === card ? 100 : 0) + (n.autor === agenteId ? 3 : 0) + normalizar(`${n.titulo} ${n.tags} ${n.caminho}`).split(/[^a-z0-9]+/).filter(x => palavras.has(x)).length * 5;
    const notas = listar().filter(n => !n.arquivo && n.status !== 'substituido' && !['indice.md','contexto.md','projeto.md','regras.md'].includes(n.nome)).map(n => ({ ...n, score: pontuar(n) })).sort((a,b) => b.score - a.score || b.data.localeCompare(a.data));
    const suas = notas.filter(n => n.autor === agenteId && (!compacto || n.score > 3)).slice(0, compacto ? 3 : 6);
    const gerais = notas.filter(n => n.escopo === 'projeto' && (!compacto || n.score > 0)).slice(0, compacto ? 3 : 6);
    if (suas.length) partes.push(`### Suas notas recentes\n${suas.map((n) => `- ${n.titulo} (${n.caminho})`).join('\n')}`);
    if (gerais.length) partes.push(`### Notas do projeto\n${gerais.map((n) => `- ${n.titulo} (${n.caminho})`).join('\n')}`);
    return partes.join('\n\n') || '(a memória deste projeto ainda está vazia)';
  }

  const estado = () => ({ ...lerEstado(), total: listar().filter((n) => !n.arquivo).length, dir: base });
  function marcarCuradoria() { gravarEstado({ novasDesde: 0, ultimaCuradoria: new Date().toISOString() }); emitir({ tipo: 'memoria', acao: 'curou' }); }

  return { dir: base, lerRegras, gravarRegras, listaRegras, gravarListaRegras, importarRegras, listarReferencias, importarReferencia, removerReferencia, referenciasParaPrompt, acrescentarContexto, iniciar, listar, ler, salvar, atualizar, mover, arquivar, paraPrompt, estado, marcarCuradoria, gerarIndice };
}
