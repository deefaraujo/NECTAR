// The scrumban board of ONE project: columns, work-in-progress (WIP) limit, cards and history.
// The source of truth is the project's board.json, in the app data folder. The file
// quadro.md, in the project folder (inside the program folder), is a readable copy, rewritten on every change.
import fs from 'node:fs';
import path from 'node:path';
import { ler, gravar, gravarDepois, adiar, escreverTexto, escreverSeMudou } from './store.mjs';
import { criarElenco } from './agentes.mjs';
import { aceiteVerificavel } from './xp.mjs';
import { chaveEstavel, novoFluxo, validarDependencias, dependenciasPendentes, aplicarFluxo, pendenciasQualidade, TIPOS_TAREFA, progressoMarkdown, relatorioTarefa, normalizarVerificacoes, inicializarHistoricoVerificacoes, listaRessalvas, detectarRessalvas, limiteRelevante, registrarRessalvaTexto, novaRessalvaUsuario } from './workflow.mjs';

export const COLUNAS = [
  { id: 'backlog', nome: 'Backlog' },
  { id: 'pronto', nome: 'Pronto' },
  { id: 'andamento', nome: 'Em andamento' },
  { id: 'impedimento', nome: 'Impedimento' }, // blocked or waiting on the Game Director; the card goes back to where it was
  { id: 'revisao', nome: 'Revisão' },
  { id: 'qa', nome: 'Testes (QA)' },
  { id: 'concluido', nome: 'Concluído' },
];
const NOME_COLUNA = Object.fromEntries(COLUNAS.map((c) => [c.id, c.nome]));
const COLUNA_VALIDA = new Set(COLUNAS.map((c) => c.id));

// docs/TASKS.md, when the project has one, uses these state names.
const ESTADO_PARA_COLUNA = {
  BACKLOG: 'backlog', READY: 'pronto', IN_PROGRESS: 'andamento',
  REVIEW: 'revisao', QA: 'qa', DONE: 'concluido', BLOCKED: 'impedimento',
};

export const PONTOS = [1, 2, 3, 5, 8, 13];
export const MODELOS = ['claude-haiku-4-5', 'claude-haiku-5-5', 'claude-sonnet-4-6', 'claude-sonnet-5', 'claude-sonnet-5-5', 'claude-opus-5', 'claude-opus-5-5'];
export const ESFORCOS = ['low', 'medium', 'high', 'xhigh', 'max'];
export const MOTORES = ['claude', 'codex'];
export const TETOS = ['low', 'medium', 'high']; // card effort ceiling, set by the P.O.; agents pick the level within it
export const PAPEIS_PARTICIPANTE = ['colabora', 'monitora'];
const agora = () => new Date().toISOString();
const falha = (erro) => ({ ok: false, erro });

function normalizarDono(txt, IDS) {
  const t = txt.trim().toLowerCase();
  if (t === 'studio-orchestrator') return 'po';
  return IDS.has(t) ? t : null;
}

function limparParticipantes(lista, IDS, dono) {
  const vistos = new Set();
  const out = [];
  for (const x of Array.isArray(lista) ? lista : []) {
    const agente = typeof x === 'string' ? x : x?.agente;
    const papel = PAPEIS_PARTICIPANTE.includes(x?.papel) ? x.papel : 'monitora';
    if (!agente || !IDS.has(agente) || agente === dono || vistos.has(agente)) continue;
    vistos.add(agente);
    out.push({ agente, papel });
  }
  return out.slice(0, 6);
}

function novoCartao(o) {
  const t = agora();
  const coluna = o.coluna || 'backlog';
  return {
    id: o.id,
    chaveCriacao: o.chave ? String(o.chave).slice(0,100) : null, criadoPor: o.quem || 'sistema',
    titulo: o.titulo,
    descricao: o.descricao || '',
    coluna,
    dono: o.dono || null,
    cadeia: o.cadeia || [],
    dependeDe: [], validacoesObrigatorias: Array.isArray(o.validacoesObrigatorias) ? [...new Set(o.validacoesObrigatorias.map(String).map(x=>x.trim()).filter(Boolean))].slice(0,30) : [], tipoTarefa: TIPOS_TAREFA.includes(o.tipoTarefa) ? o.tipoTarefa : 'feature', risco: ['baixo','medio','alto'].includes(o.risco) ? o.risco : 'medio',
    prioridade: o.prioridade || 'normal',
    pontos: PONTOS.includes(Number(o.pontos)) ? Number(o.pontos) : null, // estimated effort (1, 2, 3, 5, 8, 13)
    modelo: MODELOS.includes(o.modelo) ? o.modelo : null,   // Claude model for this card (empty = Settings default)
    teto: TETOS.includes(o.teto) ? o.teto : null,           // P.O. effort ceiling for this card (empty = global ceiling only)
    esforco: ESFORCOS.includes(o.esforco) ? o.esforco : null, // reasoning level (empty = Settings default)
    motor: MOTORES.includes(o.motor) ? o.motor : null,        // claude or codex (empty = the engine chosen in Settings)
    // who else is on the card besides the owner: collaborates (works together) or monitors (follows and weighs in at stage transitions)
    participantes: [],
    jira: /^[A-Za-z][A-Za-z0-9_]*-\d+$/.test(String(o.jira || '')) ? String(o.jira).toUpperCase() : null, // originating Jira issue (key only)
    aceite: (o.aceite || []).map((a) =>
      typeof a === 'string' ? { t: a, ok: false } : { t: String(a.t ?? a.texto ?? ''), ok: !!a.ok }),
    arquivos: o.arquivos || [],
    evidencias: o.evidencias || [],
    taskContractId: o.taskContractId || null,
    teamworkPlanId: o.teamworkPlanId || null,
    bloqueio: o.bloqueio || null,
    bloqueioPor: o.bloqueio ? (o.quem || 'sistema') : null, // who blocked it: 'voce' stays put until you release it; an agent or the system goes to the P.O. to unblock
    aguardando: null, // 'voce' when an agent asked a question and is waiting for the answer
    validacao: null,  // the Game Director's final validation after completion: pending, approved or rejected
    criado: t,
    atualizado: t,
    naColunaDesde: t,
    historico: [{ em: t, quem: o.quem || 'sistema', txt: `Entrou em ${NOME_COLUNA[coluna]}` }],
    comentarios: [],
    arquivado: false,
  };
}

export function criarQuadro({ dir, raiz, pasta: pastaProjeto, limiteDe, emitir, elenco }) {
  let gateTask=null;
  const IDS = (elenco || criarElenco()).IDS;
  const tecnico = elenco?.id === 'software';
  const papeis = { lead: elenco?.papeis.lead || 'po', qa: elenco?.papeis.qa || 'qa', curador: elenco?.papeis.curador || 'curador', revisor: elenco?.papeis.revisor || 'revisor', revisorSuplente: 'architect', ids: IDS };
  const arq = `${dir}/board.json`;
  let quadro = ler(arq, null);

  const ativos = () => quadro.cartoes.filter((c) => !c.arquivado);
  const obter = (id) => quadro.cartoes.find((c) => c.id === id) || null;
  const contar = (col) => ativos().filter((c) => c.coluna === col).length;
  const ocupacao = col => tecnico ? ativos().filter(c=>c.coluna===col && !c.bloqueio && !c.aguardando).length : contar(col);

  const relatoriosEscritos = new Set();
  function exportarMd() {
    const linhas = [
      '# Quadro (gerado pelo NECTAR)', '',
      'Não edite este arquivo: ele é regravado a cada mudança.', '',
    ];
    for (const col of COLUNAS) {
      const cards = ativos().filter((c) => c.coluna === col.id);
      const lim = limiteDe(col.id);
      linhas.push(`## ${col.nome} (${cards.length}${lim ? `/${lim}` : ''})`, '');
      if (!cards.length) { linhas.push('Vazio.', ''); continue; }
      linhas.push('| ID | Tarefa | Dono | Prioridade | Situação |', '|---|---|---|---|---|');
      for (const c of cards) {
        const ok = c.aceite.filter((a) => a.ok).length;
        const sit = c.bloqueio ? `BLOQUEADO: ${c.bloqueio}` : c.aguardando ? `AGUARDANDO ${elenco?.usuario?.nome || 'você'}` : (c.aceite.length ? `aceite ${ok}/${c.aceite.length}` : '');
        linhas.push(`| ${c.id} | ${c.titulo.replace(/\|/g, '/')} | ${c.dono || ''} | ${c.prioridade} | ${sit.replace(/\|/g, '/')} |`);
      }
      linhas.push('');
    }
    try {
      fs.mkdirSync(pastaProjeto, { recursive: true });
      escreverSeMudou(path.join(pastaProjeto, 'quadro.md'), linhas.join('\n'));
      if (tecnico) for (const c of ativos().filter(c=>c.workflow)) {
        const dirCard = path.join(pastaProjeto, 'workflow', c.id);
        fs.mkdirSync(dirCard, { recursive: true });
        escreverSeMudou(path.join(dirCard, 'progress.md'), progressoMarkdown(c, obter));
      }
      for (const c of quadro.cartoes) for (const r of c.relatorios || []) {
        const alvo = path.join(pastaProjeto,'relatorios',c.id,r.nome);
        if (relatoriosEscritos.has(alvo)) continue;
        fs.mkdirSync(path.dirname(alvo),{recursive:true});
        if (!fs.existsSync(alvo)) escreverTexto(alvo,r.texto);
        relatoriosEscritos.add(alvo);
      }
    } catch { /* folder without write permission: the board still holds */ }
  }

  // Several changes in a row become one write (see gravarDepois in store.mjs); the derived .md files wait a bit longer.
  function salvar() {
    gravarDepois(arq, () => quadro);
    adiar(`${arq}#md`, exportarMd);
    emitir({ tipo: 'quadro' });
  }

  // First time: if the project has docs/TASKS.md in table format, import the tasks from it.
  function semear() {
    let md = '';
    try { md = fs.readFileSync(path.join(raiz, 'docs', 'TASKS.md'), 'utf8'); } catch { return; }
    for (const ln of md.split(/\r?\n/)) {
      if (!ln.startsWith('|')) continue;
      const c = ln.split('|').slice(1, -1).map((s) => s.trim());
      if (c.length < 7) continue;
      const [id, solicitacao, dono, estado, arquivos, aceite, teste] = c;
      if (!/^[A-Z]+-\d+$/.test(id) || id === 'EXAMPLE-001') continue;
      const coluna = ESTADO_PARA_COLUNA[estado];
      if (!coluna) continue;
      const cadeia = dono.split(/\s*(?:→|->)\s*/).map((x) => normalizarDono(x, IDS)).filter(Boolean);
      quadro.cartoes.push(novoCartao({
        id, titulo: solicitacao, descricao: teste ? `Teste: ${teste}` : '',
        dono: cadeia[0] || null, cadeia, coluna,
        aceite: aceite ? [aceite] : [],
        arquivos: (arquivos.match(/`([^`]+)`/g) || []).map((s) => s.slice(1, -1)),
        evidencias: estado === 'DONE' && teste ? [teste] : [],
        bloqueio: estado === 'BLOCKED' ? 'Bloqueado. Motivo em docs/TASKS.md.' : null,
        quem: 'sistema',
      }));
    }
  }

  // Impediment: a card blocked or waiting on the Game Director leaves the queue and sits in its own column;
  // when the impediment ends, it goes back to the column it was in.
  const impedir = (c) => {
    if (['backlog', 'concluido', 'impedimento'].includes(c.coluna)) return;
    c.colunaAntes = c.coluna; c.coluna = 'impedimento'; c.naColunaDesde = agora();
  };
  const retornar = (c) => {
    if (c.coluna !== 'impedimento' || c.bloqueio || c.aguardando) return;
    c.coluna = c.colunaAntes && c.colunaAntes !== 'impedimento' ? c.colunaAntes : 'andamento';
    c.colunaAntes = null; c.naColunaDesde = agora();
  };

  if (!quadro) {
    quadro = { seq: 0, cartoes: [], cancelados: [] };
    semear();
    for (const c of quadro.cartoes) { if (tecnico && c.coluna !== 'concluido') c.workflow ||= novoFluxo(); }
    salvar();
  } else {
    // Cancel means delete: an archived card that was not completed was canceled by the Game Director before this rule.
    // It leaves the board and remains only as a minimal record (so nobody recreates it). A copy of the old board is kept.
    quadro.cancelados ||= [];
    const cancelados = quadro.cartoes.filter((c) => c.arquivado && c.coluna !== 'concluido');
    if (cancelados.length) {
      try { fs.copyFileSync(arq, `${arq}.bak-cancelados`); } catch { /* no copy, carry on */ }
      for (const c of cancelados) quadro.cancelados.push({ id: c.id, titulo: c.titulo, descricao: String(c.descricao || '').slice(0, 300), jira: c.jira || null, motivo: 'arquivado pela Game Director antes da exclusão automática', quem: 'voce', em: c.atualizado || agora(), coluna: c.coluna });
      quadro.cartoes = quadro.cartoes.filter((c) => !cancelados.includes(c));
      for (const c of quadro.cartoes) c.dependeDe = (c.dependeDe || []).filter((d) => !cancelados.some((x) => x.id === d));
    }
    for (const c of quadro.cartoes) { c.dependeDe ||= []; c.tipoTarefa ||= 'feature'; c.risco ||= 'medio'; if (tecnico && c.coluna !== 'concluido') c.workflow ||= novoFluxo(); if (c.bloqueio && !c.bloqueioPor) c.bloqueioPor = [...(c.historico || [])].reverse().find((h) => /^Bloqueado/.test(h.txt))?.quem || 'sistema'; if (c.bloqueio || c.aguardando) impedir(c); else retornar(c); }
    enxugarRelatorios();
    salvar();
    exportarMd();
  }

  /** Old cards carried dozens of reports (one per message, per delivery): 2.7 MB of the board's 3.3 MB, rewritten on every
   *  change. The card keeps only the completion report (short); the rest go to relatorios/<card>/ and leave the card only after
   *  the file exists, verified. Before the first cleanup, a full copy of the board is kept. */
  function enxugarRelatorios() {
    const pesado = (c) => (c.relatorios || []).length > 1 || (c.relatorios || []).some((r) => r.tipo !== 'final' || (r.texto || '').length > 4000);
    if (!quadro.cartoes.some(pesado)) return;
    const copia = `${arq}.antes-de-enxugar`;
    try { if (!fs.existsSync(copia)) fs.copyFileSync(arq, copia); } catch { return; }   // without a backup copy, touch nothing
    const guardar = (c, r) => {
      const dir = path.join(pastaProjeto, 'relatorios', c.id);
      try {
        fs.mkdirSync(dir, { recursive: true });
        const base = String(r.nome || `${c.id}-${r.tipo}-r${r.revisao}.md`).replace(/\.md$/, '');
        for (let i = 0; i < 20; i++) {
          const alvo = path.join(dir, `${base}${i ? `-${i}` : ''}.md`);
          const conteudo = r.texto || '';
          if (!fs.existsSync(alvo)) escreverTexto(alvo, conteudo);
          else if (fs.statSync(alvo).size !== Buffer.byteLength(conteudo) || fs.readFileSync(alvo, 'utf8') !== conteudo) continue;   // different size: don't even read it
          return fs.statSync(alvo).size > 0 || !conteudo.length;
        }
      } catch { /* could not save: the report stays on the card */ }
      return false;
    };
    for (const c of quadro.cartoes) {
      if (!pesado(c)) continue;
      const lista = c.relatorios || [];
      const finais = lista.filter((r) => r.tipo === 'final').sort((a, b) => (b.revisao - a.revisao) || String(b.em).localeCompare(String(a.em)));
      const manter = finais[0] || null;
      const resto = lista.filter((r) => r !== manter);
      const mantidos = resto.filter((r) => !guardar(c, r));
      if (manter && (manter.texto || '').length > 4000 && guardar(c, manter)) manter.texto = `${manter.texto.slice(0, 3900)}\n\n(Texto completo em relatorios/${c.id}/${manter.nome}.)\n`;
      c.relatorios = [...(manter ? [manter] : []), ...mantidos];
      const tirados = resto.length - mantidos.length;
      if (tirados) c.relatoriosArquivados = (c.relatoriosArquivados || 0) + tirados;
    }
  }

  const estadoWip =() => Object.fromEntries(COLUNAS.map((c) => [c.id, { n: contar(c.id), limite: limiteDe(c.id) }]));

  // Whoever wants to hear about every status change (the P.O.) subscribes here. No model: it is just an event.
  const ouvintesStatus = new Set();
  const aoStatus = (fn) => { ouvintesStatus.add(fn); return () => ouvintesStatus.delete(fn); };
  const avisarStatus = (ev) => { for (const f of ouvintesStatus) { try { f(ev); } catch { /* a faulty listener does not bring the board down */ } } };

  // Progress computed by the app: completed points over estimated points, and how many cards are in each stage.
  function progresso() {
    const cs = ativos();
    const pts = (l) => l.reduce((s, c) => s + (c.pontos || 0), 0);
    const feitos = cs.filter((c) => c.coluna === 'concluido');
    const total = pts(cs);
    const porColuna = Object.fromEntries(COLUNAS.map((c) => [c.id, cs.filter((x) => x.coluna === c.id).length]));
    return { pontosFeitos: pts(feitos), pontosTotal: total, pct: total ? Math.round((100 * pts(feitos)) / total) : 0, cards: cs.length, porColuna, semEstimativa: cs.filter((c) => !c.pontos && c.coluna !== 'concluido').length };
  }

  function criar(o, quem = 'voce') {
    if (o.chave) {
      const anterior = quadro.cartoes.find(c => c.chaveCriacao === String(o.chave).slice(0,100) && c.criadoPor === quem);
      if (anterior) return { ok: true, card: anterior, repetido: true };
    }
    const titulo = String(o.titulo || '').trim();
    if (!titulo) return falha('Card sem título');
    if (o.dono && !IDS.has(o.dono)) return falha(`Dono desconhecido: ${o.dono}`);
    let coluna = COLUNA_VALIDA.has(o.coluna) ? o.coluna : 'backlog';
    let aviso = null;
    const lim = limiteDe(coluna);
    // Agent asking for a full column: the card is not lost, it goes to the Backlog and the warning shows up in chat.
    if (lim && ocupacao(coluna) >= lim && quem !== 'voce') {
      aviso = `${NOME_COLUNA[coluna]} está cheio (${contar(coluna)}/${lim}): o card foi para o Backlog.`;
      coluna = 'backlog';
    }
    const id = `T-${String(quadro.seq + 1).padStart(3, '0')}`;
    let deps;
    try { deps = validarDependencias(id, o.dependeDe || [], quadro.cartoes); } catch(e) { return falha(e.message); }
    const card = novoCartao({ ...o, id, titulo, coluna, quem });
    card.dependeDe = deps;
    if (tecnico) card.workflow = novoFluxo();
    if (['andamento','revisao','qa','concluido'].includes(coluna) && dependenciasPendentes(card, obter).length) return falha('Há dependências não concluídas. Crie o card no Backlog ou Pronto.');
    if (tecnico && ['revisao','qa','concluido'].includes(coluna)) return falha('Crie o card antes da revisão e registre a entrega.');
    quadro.seq++;
    card.participantes = limparParticipantes(o.participantes, IDS, card.dono);
    quadro.cartoes.push(card);
    salvar();
    avisarStatus({ tipo: 'criado', id: card.id, titulo: card.titulo, de: null, para: coluna, quem, motivo: '', dono: card.dono });
    return { ok: true, card, aviso };
  }

  const CAMPOS = new Set(['titulo', 'descricao', 'dono', 'prioridade', 'arquivos', 'pontos', 'modelo', 'esforco', 'teto', 'motor', 'jira', 'acesso', 'contexto']);
  const ROTULO_PAPEL = { colabora: 'colabora', monitora: 'monitora' };

  function atualizar(id, campos, quem = 'voce') {
    const original = obter(id);
    if (!original) return falha(`Card ${id} não existe`);
    const c = structuredClone(original);
    if (campos?.validacoesObrigatorias !== undefined) {
      if (quem !== 'voce' && quem !== papeis.lead) return falha('Só a P.O. ou a pessoa responsável altera verificações obrigatórias.');
      if (!Array.isArray(campos.validacoesObrigatorias) || campos.validacoesObrigatorias.some(x=>typeof x!=='string' || !x.trim()) || campos.validacoesObrigatorias.length > 30) return falha('Informe até 30 comandos obrigatórios.');
      c.validacoesObrigatorias = [...new Set(campos.validacoesObrigatorias.map(x=>x.trim()))];
    }
    if (campos?.dependeDe !== undefined) {
      try { c.dependeDe = validarDependencias(id, campos.dependeDe, quadro.cartoes); } catch(e) { return falha(e.message); }
      if (['andamento','revisao','qa','concluido'].includes(c.coluna) && dependenciasPendentes(c, obter).length) return falha('Mova o card para Pronto antes de adicionar uma dependência pendente.');
    }
    if (campos?.tipoTarefa !== undefined) { if (!TIPOS_TAREFA.includes(campos.tipoTarefa)) return falha('Tipo de tarefa inválido.'); c.tipoTarefa = campos.tipoTarefa; }
    if (campos?.risco !== undefined) { if (!['baixo','medio','alto'].includes(campos.risco)) return falha('Risco inválido.'); c.risco = campos.risco; }
    // Execution plan: ordered steps with owner and status. The autopilot calls the owner of the next pending step; leadership does not dispatch.
    if (campos?.plano !== undefined) {
      if (!Array.isArray(campos.plano) || campos.plano.length > 12) return falha('Plano: informe de 1 a 12 passos.');
      const antigos = c.plano || [];
      const plano = campos.plano.map((p, i) => { const titulo = String(p?.titulo ?? p ?? '').trim().slice(0, 160); const ant = antigos.find((x) => x.titulo === titulo); return { n: i + 1, titulo, dono: p?.dono && IDS.has(p.dono) ? p.dono : (ant?.dono || c.dono || null), saida: String(p?.saida || '').slice(0, 200), status: ant?.status || 'pendente', evidencia: ant?.evidencia || '', em: ant?.em || null, por: ant?.por || null }; }).filter((p) => p.titulo);
      if (!plano.length) return falha('Plano sem passos.');
      c.plano = plano;
      c.historico.push({ em: agora(), quem, txt: `Plano: ${plano.length} passo${plano.length > 1 ? 's' : ''} (${plano.map((p) => `${p.n} ${p.dono || '?'}`).join(', ')})` });
    }
    if (campos?.passo !== undefined) {
      const { n, status, evidencia } = campos.passo || {};
      const p = (c.plano || []).find((x) => x.n === Number(n));
      if (!p) return falha(`Passo ${n} não existe no plano.`);
      if (!['feito', 'pulado', 'pendente'].includes(status)) return falha('Status do passo: feito, pulado ou pendente.');
      if (status !== 'pendente' && !String(evidencia || '').trim()) return falha('Diga em uma linha o que saiu do passo (evidencia).');
      Object.assign(p, { status, evidencia: String(evidencia || '').slice(0, 300), em: agora(), por: quem });
      c.historico.push({ em: agora(), quem, txt: `Passo ${p.n} ${status}: ${p.titulo}` });
    }
    const t = agora();
    for (const [k, v] of Object.entries(campos || {})) {
      if (CAMPOS.has(k)) {
        if (k === 'dono' && v && !IDS.has(v)) return falha(`Dono desconhecido: ${v}`);
        if (k === 'acesso' && v !== null && !['total', 'restrito'].includes(v)) return falha('Acesso deve ser total ou restrito');
        if (k === 'contexto' && !(Array.isArray(v) && v.length <= 12 && v.every((x) => typeof x === 'string' && x.trim() && x.length <= 80))) return falha('contexto é uma lista de até 12 fichas do registro (ex.: ["personagem:ana", "cena:ep01-c02"])');
        if (k === 'prioridade' && !['alta', 'normal', 'baixa'].includes(v)) return falha('Prioridade inválida');
        if (k === 'pontos' && v !== null && v !== '' && !PONTOS.includes(Number(v))) return falha('Pontos devem ser 1, 2, 3, 5, 8 ou 13');
        if (k === 'modelo' && v && !MODELOS.includes(v)) return falha(`Modelo desconhecido: ${v}`);
        if (k === 'teto' && v && !TETOS.includes(v)) return falha(`Teto desconhecido: ${v} (use low, medium ou high)`);
        if (k === 'esforco' && v && !ESFORCOS.includes(v)) return falha(`Esforço desconhecido: ${v}`);
        if (k === 'motor' && v && !MOTORES.includes(v)) return falha(`Motor desconhecido: ${v}`);
        if (k === 'jira' && v && !/^[A-Za-z][A-Za-z0-9_]*-\d+$/.test(String(v))) return falha('Chave do Jira inválida (ex.: ABC-123)');
        if (k === 'dono' && c.dono !== v) c.historico.push({ em: t, quem, txt: `Dono: ${v || 'ninguém'}` });
        c[k] = k === 'pontos' ? (v ? Number(v) : null) : (['modelo', 'esforco', 'teto', 'motor'].includes(k) ? (v || null) : (k === 'jira' ? (v ? String(v).toUpperCase() : null) : v));
        if (['pontos', 'modelo', 'esforco', 'teto', 'motor'].includes(k)) c.historico.push({ em: t, quem, txt: `${{ pontos: 'Pontos', modelo: 'Modelo', esforco: 'Esforço', teto: 'Teto de esforço', motor: 'Motor' }[k]}: ${c[k] ?? 'padrão'}` });
      } else if (k === 'participantes') {
        const novos = limparParticipantes(v, IDS, c.dono);
        c.participantes = novos;
        c.historico.push({ em: t, quem, txt: `Participantes: ${novos.map((p) => `${p.agente} (${ROTULO_PAPEL[p.papel]})`).join(', ') || 'nenhum'}` });
      } else if (k === 'aceite' && Array.isArray(v)) {
        c.aceite = v.map((a) => (typeof a === 'string' ? { t: a, ok: false } : { t: String(a.t ?? a.texto ?? ''), ok: !!a.ok }));
      } else if (k === 'aceiteOk' && Array.isArray(v)) {
        for (const i of v) if (c.aceite[i]) c.aceite[i].ok = true;
        c.historico.push({ em: t, quem, txt: `Aceite ${c.aceite.filter((a) => a.ok).length}/${c.aceite.length}` });
      } else if (k === 'evidencias' && Array.isArray(v)) {
        c.evidencias.push(...v.map(String).filter(Boolean));
        c.historico.push({ em: t, quem, txt: 'Evidência registrada' });
      }
    }
    c.atualizado = t;
    Object.assign(original, c);
    salvar();
    return { ok: true, card: c };
  }

  function mover(id, coluna, quem = 'voce', { motivo = '', forcar = false } = {}) {
    const c = obter(id);
    if (!c) return falha(`Card ${id} não existe`);
    if (!NOME_COLUNA[coluna]) return falha(`Coluna desconhecida: ${coluna}`);
    if (coluna === 'impedimento' && !c.bloqueio && !c.aguardando) return bloquear(id, motivo || 'Movido para Impedimento', quem);
    if (c.bloqueio && c.bloqueioPor === 'voce' && quem !== 'voce') return falha(`${id} foi bloqueado pela Game Director; só ela move.`);
    if (c.coluna === coluna) {
      if (c.bloqueio && ['andamento','revisao','qa','concluido'].includes(coluna)) return falha('O card ainda está bloqueado. Registre a resolução com desbloquear antes de retomar.');
      return { ok: true, card: c, de: coluna };
    }
    if (tecnico && !c.workflow && coluna !== 'concluido') c.workflow = novoFluxo();
    if (forcar && (quem !== 'voce' || !String(motivo).trim())) return falha('Override exige uma decisão humana com motivo registrado.');
    if (['andamento','revisao','qa','concluido'].includes(coluna)) {
      const deps = dependenciasPendentes(c, obter);
      if (deps.length) return falha(`Aguardando dependências: ${deps.join(', ')}`);
      if (c.bloqueio || c.aguardando) return falha('O card está bloqueado ou aguarda uma decisão.');
    }
    // XP: nobody starts without a verifiable acceptance criterion (the agent does exactly what the acceptance asks). The Game Director can force it.
    if (!forcar && quem !== 'voce' && ['pronto', 'andamento'].includes(coluna)) {
      const ac = aceiteVerificavel(c.aceite);
      if (!ac.ok) return falha(`${id} não pode ir para ${NOME_COLUNA[coluna]} sem critérios de aceite verificáveis (${ac.motivo}). A P.O. escreve o aceite primeiro; o dono faz exatamente o que ele pede.`);
    }
    if (!forcar && ['revisao','qa','concluido'].includes(coluna)) {
      const faltas = pendenciasQualidade(c, coluna);
      if (faltas.length) return falha(`Falta para ${NOME_COLUNA[coluna]}: ${faltas.join('; ')}`);
    }
    const lim = limiteDe(coluna);
    if (lim && !forcar && ocupacao(coluna) >= lim) {
      return { ok: false, erro: `${NOME_COLUNA[coluna]} está cheio (${contar(coluna)}/${lim})`, wip: true };
    }
    if(coluna==='concluido'&&c.taskContractId&&(!gateTask||!gateTask(c.taskContractId)))return falha('quality_gate_failed: contrato canônico ainda não concluído');
    if (coluna === 'concluido' && !forcar) {
      if (c.bloqueio) return falha(`${id} está bloqueado`);
      if (!c.evidencias.length) return falha(`${id} não tem evidência registrada. Registre com card.update, campos.evidencias: ["o que foi entregue e onde está"], e mova de novo.`);
    }
    const t = agora();
    const de = c.coluna;
    c.historico.push({ em: t, quem, txt: `${NOME_COLUNA[de]} para ${NOME_COLUNA[coluna]}${forcar ? ' (override humano)' : ''}${motivo ? `: ${motivo}` : ''}` });
    c.coluna = coluna;
    c.naColunaDesde = t;
    c.atualizado = t;
    if (coluna === 'concluido') { c.aguardando = null; c.validacao = { status: 'pendente', em: t }; }
    let relatorio = null;
    if (coluna === 'concluido') {
      // One report per card: the completion one, short. Went back and completed again in another version: the new one replaces the old.
      const existente = (c.relatorios || []).find(r=>r.tipo==='final' && r.revisao===(c.workflow?.revisao || 0));
      if (!existente) { relatorio=relatorioTarefa(c,'final',quem); c.relatorios = [relatorio]; }
    }
    salvar();
    avisarStatus({ tipo: 'move', id: c.id, titulo: c.titulo, de, para: coluna, quem, motivo, dono: c.dono, relatorio });
    return { ok: true, card: c, de };
  }

  function bloquear(id, motivo, quem = 'voce') {
    const c = obter(id);
    if (!c) return falha(`Card ${id} não existe`);
    if (c.bloqueio && c.bloqueioPor === 'voce' && quem !== 'voce') return falha('Este card foi bloqueado pela Game Director; só ela pode mexer nesse bloqueio.');
    c.bloqueio = String(motivo || 'Bloqueado');
    c.bloqueioPor = quem; // 'voce' = deliberate stop, nobody unblocks on the user's behalf
    c.historico.push({ em: agora(), quem, txt: `Bloqueado: ${c.bloqueio}` });
    impedir(c);
    c.atualizado = agora();
    salvar();
    avisarStatus({ tipo: 'bloqueio', id: c.id, titulo: c.titulo, de: c.coluna, para: c.coluna, quem, motivo: c.bloqueio, dono: c.dono });
    return { ok: true, card: c };
  }

  function desbloquear(id, quem = 'voce') {
    const c = obter(id);
    if (!c) return falha(`Card ${id} não existe`);
    if (!c.bloqueio) return { ok:true, card:c, repetido:true };
    if (c.bloqueioPor === 'voce' && quem !== 'voce') return falha(`${id} foi bloqueado pela Game Director de propósito (por exemplo, para repriorizar). Só ela libera; pergunte a ela se precisar.`);
    c.ultimoBloqueioResolvido={ motivo:c.bloqueio, em:agora(), quem };
    c.bloqueio = null; c.bloqueioPor = null;
    c.historico.push({ em: agora(), quem, txt: 'Desbloqueado' });
    retornar(c);
    c.atualizado = agora();
    salvar();
    avisarStatus({ tipo: 'liberado', id: c.id, titulo: c.titulo, de: c.coluna, para: c.coluna, quem, motivo: '', dono: c.dono });
    return { ok: true, card: c };
  }

  function comentar(id, texto, quem = 'voce') {
    const c = obter(id);
    if (!c) return falha(`Card ${id} não existe`);
    const t = String(texto || '').trim();
    if (!t) return falha('Comentário vazio');
    c.comentarios.push({ em: agora(), quem, texto: t });
    c.atualizado = agora();
    salvar();
    return { ok: true, card: c };
  }

  /** Marks (or clears, with null) that the card is waiting for an answer from the Game Director. */
  function aguardar(id, quem, por) {
    const c = obter(id);
    if (!c) return falha(`Card ${id} não existe`);
    c.aguardando = quem || null;
    c.historico.push({ em: agora(), quem: por || 'sistema', txt: quem ? `Aguardando ${elenco?.usuario?.nome || 'você'}` : `Resposta de ${elenco?.usuario?.nome || 'você'} recebida` });
    if (quem) impedir(c); else retornar(c);
    c.atualizado = agora();
    salvar();
    return { ok: true, card: c };
  }

  /** History line on the card without touching anything else (e.g. internal consultation between agents). */
  function anotar(id, quem, txt) {
    const c = obter(id);
    if (!c) return falha(`Card ${id} não existe`);
    c.historico.push({ em: agora(), quem, txt });
    salvar();
    return { ok: true };
  }

  /** Cancel means delete: the card leaves the board for good. Only a minimal record of what was canceled remains, so nobody recreates it. */
  function excluir(id, quem = 'voce', motivo = '') {
    const c = obter(id);
    if (!c) return falha(`Card ${id} não existe`);
    for (const x of quadro.cartoes) {
      if ((x.dependeDe || []).includes(id)) { x.dependeDe = x.dependeDe.filter((d) => d !== id); x.historico.push({ em: agora(), quem: 'sistema', txt: `Dependência ${id} cancelada e removida` }); }
    }
    (quadro.cancelados ||= []).push({ id: c.id, titulo: c.titulo, descricao: String(c.descricao || '').slice(0, 300), jira: c.jira || null, motivo: String(motivo || '').slice(0, 300), quem, em: agora(), coluna: c.coluna });
    if (quadro.cancelados.length > 100) quadro.cancelados.splice(0, quadro.cancelados.length - 100);
    quadro.cartoes = quadro.cartoes.filter((x) => x.id !== id);
    try { fs.rmSync(path.join(pastaProjeto, 'workflow', id), { recursive: true, force: true }); } catch { /* no workflow folder */ }
    salvar();
    avisarStatus({ tipo: 'removido', id: c.id, titulo: c.titulo, de: c.coluna, para: null, quem, motivo: '', dono: c.dono, participantes: c.participantes });
    return { ok: true, excluido: true };
  }

  function arquivar(id, quem = 'voce') {
    const c = obter(id);
    if (!c) return falha(`Card ${id} não existe`);
    if (c.coluna !== 'concluido') return excluir(id, quem, 'cancelado');
    if (c.coluna !== 'concluido' && ativos().some(x => x.id !== id && (x.dependeDe || []).includes(id))) return falha('Resolva as dependências deste card antes de arquivá-lo.');
    c.arquivado = true;
    c.historico.push({ em: agora(), quem, txt: 'Arquivado' });
    salvar();
    avisarStatus({ tipo: 'removido', id: c.id, titulo: c.titulo, de: c.coluna, para: null, quem, motivo: '', dono: c.dono, participantes: c.participantes });
    return { ok: true };
  }

  // Compact summary to go into the agents' prompt.
  function resumo({ apenasDono = null } = {}) {
    const linhas = [];
    for (const col of COLUNAS) {
      if (col.id === 'concluido') continue;
      const cards = ativos().filter((c) => c.coluna === col.id && (!apenasDono || c.dono === apenasDono || (c.participantes || []).some((p) => p.agente === apenasDono)));
      const lim = limiteDe(col.id);
      linhas.push(`${col.nome} (${contar(col.id)}${lim ? `/${lim}` : ''}):`);
      if (!cards.length) { linhas.push('  vazio'); continue; }
      for (const c of cards) {
        const m = c.aceite.filter((a) => a.ok).length;
        linhas.push(`  ${c.id}${c.jira ? ` (${c.jira})` : ''} [${c.prioridade}${c.pontos ? `, ${c.pontos}pt` : ', sem estimativa'}${c.modelo ? `, ${c.modelo}` : ''}${c.esforco ? `/${c.esforco}` : ''}${c.teto ? `, teto ${c.teto}` : ''}] ${c.titulo} | dono: ${c.dono || 'sem dono'}${c.dependeDe?.length ? ` | depende: ${c.dependeDe.join(', ')}` : ''}${c.workflow ? ` | r${c.workflow.revisao}, revisão ${c.workflow.revisaoCodigo.status}, QA ${c.workflow.qa.status}` : ''}${(c.participantes || []).length ? ` | com: ${c.participantes.map((p) => `${p.agente} (${p.papel})`).join(', ')}` : ''}${c.bloqueio ? ` | BLOQUEADO: ${c.bloqueio}` : ''}${c.aguardando ? ' | AGUARDANDO a Game Director' : ''}${c.aceite.length ? ` | aceite ${m}/${c.aceite.length}` : ''}`);
      }
    }
    const feitos = ativos().filter((c) => c.coluna === 'concluido');
    linhas.push(`Concluído: ${feitos.length} cards (${feitos.slice(-4).map((c) => c.id).join(', ')}${feitos.length > 4 ? ', ...' : ''})`);
    return linhas.join('\n');
  }

  // Load per agent: points of open cards. Lets the P.O. balance who gets what.
  function carga() {
    const por = {};
    for (const c of ativos()) {
      if (c.coluna === 'concluido') continue;
      const k = c.dono || 'sem dono';
      por[k] = por[k] || { cards: 0, pontos: 0, semEstimativa: 0 };
      por[k].cards++; por[k].pontos += c.pontos || 0; if (!c.pontos) por[k].semEstimativa++;
    }
    const linhas = Object.entries(por).map(([k, v]) => `  ${k}: ${v.cards} cards, ${v.pontos} pontos${v.semEstimativa ? `, ${v.semEstimativa} sem estimativa` : ''}`);
    return linhas.length ? linhas.join('\n') : '  ninguém tem card aberto';
  }

  function fluxo(id, acao, dados, quem = 'voce') {
    const original = obter(id);
    if (!original || !original.workflow) return falha('Card sem workflow técnico.');
    const c = structuredClone(original);
    try {
      const r = aplicarFluxo(c, acao, dados, quem, papeis);
      if (r.repetido) return { ok: true, card: original, repetido: true };
      // A delivery does not produce a report: the card keeps only the short history; the report is the completion one.
      c.atualizado = agora(); c.historico.push({ em: c.atualizado, quem, txt: `Workflow: ${acao} (r${c.workflow.revisao})` });
      Object.assign(original, c); salvar();
      avisarStatus({ tipo: 'workflow', id, titulo: c.titulo, de: c.coluna, para: c.coluna, quem, motivo: acao, dono: c.dono, relatorio: null });
      return { ok: true, card: original };
    } catch(e) { return falha(e.message); }
  }
  function registrarValidacaoApp(id, itens, revisao, ambiente) {
    const c = obter(id);
    if (!c?.workflow || !Array.isArray(itens) || !itens.length || !Number.isInteger(revisao) || !ambiente) return falha('Sem resultado, revisao ou ambiente.');
    const f = c.workflow;
    if (f.revisao !== revisao) return falha('A revisao mudou durante a execucao.');
    const checks = normalizarVerificacoes(itens.map(i => ({ ...i, evidencia: `(executado pelo app) ${i.evidencia}`, obrigatoria: f.verificacoes.find(v => v.comando === i.comando)?.obrigatoria ?? true })));
    inicializarHistoricoVerificacoes(f);
    for (const check of checks) {
      const v = f.verificacoes.find(x => x.comando === check.comando);
      if (v) Object.assign(v, check); else f.verificacoes.push(check);
      f.historicoVerificacoes.push({ ...check, autor: 'sistema', em: agora(), revisao, ambiente, origem: 'app' });
    }
    f.validacaoApp = { em: agora(), revisao, itens: checks.map(({ comando, status }) => ({ comando, status })) };
    c.historico.push({ em: agora(), quem: 'sistema', txt: `Validacao pelo app (r${revisao}): ${checks.map(i => `${i.status} ${i.comando}`).join('; ')}` });
    c.atualizado = agora(); salvar();
    return { ok: true, card: c };
  }
  /** Rewrites the card's checks with `fn` (e.g. applying the project's gates). Returns true if anything changed. */
  function ajustarVerificacoes(id, fn) {
    const f = obter(id)?.workflow;
    if (!f?.verificacoes?.length) return false;
    const novas = f.verificacoes.map(fn);
    if (JSON.stringify(novas) === JSON.stringify(f.verificacoes)) return false;
    f.verificacoes = novas; salvar();
    return true;
  }
  /** Free-text caveat (report, agent message). Returns true if a new one was created. */
  function registrarRessalva(id, txt, autor, tipo = 'texto') {
    const c = obter(id);
    if (!c?.workflow || !registrarRessalvaTexto(c, txt, autor, tipo)) return false;
    c.historico.push({ em: agora(), quem: autor, txt: `Ressalva registrada: ${String(txt).slice(0, 100)}` });
    c.atualizado = agora(); salvar();
    avisarStatus({ tipo: 'workflow', id, titulo: c.titulo, de: c.coluna, para: c.coluna, quem: autor, motivo: 'ressalva-abrir', dono: c.dono });
    return true;
  }

  /** The Game Director is the last QA: after completion, they approve or reject. Rejecting reopens the card with a severe caveat. */
  function validar(id, ok, motivo = '', quem = 'voce') {
    const c = obter(id);
    if (!c) return falha(`Card ${id} não existe`);
    if (quem !== 'voce') return falha(`Só ${elenco?.usuario?.nome || 'você'} valida a entrega final.`);
    if (c.coluna !== 'concluido') return falha('Só se valida um card concluído.');
    const t = agora(); const m = String(motivo || '').trim();
    if (ok) {
      c.validacao = { status: 'aprovada', em: t, quem, motivo: m.slice(0, 500) };
      c.historico.push({ em: t, quem, txt: 'Validação final: aprovada' });
      c.atualizado = t; salvar();
      avisarStatus({ tipo: 'validacao', id, titulo: c.titulo, quem, ok: true, motivo: m, dono: c.dono, de: c.coluna, para: c.coluna });
      return { ok: true, card: c };
    }
    if (m.length < 5) return falha('Conte o que não está certo para o time corrigir.');
    const f = c.workflow ||= novoFluxo();
    novaRessalvaUsuario(c, m);
    f.qa = { status: 'reprovado', evidencia: `Reprovado na validação final: ${m}`.slice(0, 600), autor: 'voce', em: t, revisao: f.revisao };
    const r = mover(id, 'andamento', 'voce', { forcar: true, motivo: `Reprovado na validação final: ${m}` });
    if (!r.ok) return r;
    c.validacao = { status: 'reprovada', em: t, quem, motivo: m.slice(0, 500) };
    c.historico.push({ em: t, quem, txt: `Validação final: reprovada (${m.slice(0, 120)})` });
    salvar();
    avisarStatus({ tipo: 'validacao', id, titulo: c.titulo, quem, ok: false, motivo: m, dono: c.dono, de: 'concluido', para: 'andamento' });
    return { ok: true, card: c };
  }

  /** The card's final report becomes the document written by the responsible agent (replaces the one generated by the app). */
  function registrarRelatorioFinal(id, rel) {
    const c = obter(id);
    if (!c) return false;
    // The full document goes to the Posts channel; the card keeps only the beginning, to stay focused.
    const enxuto = { ...rel, texto: rel.texto.length > 4000 ? `${rel.texto.slice(0, 3900)}\n\n(Documento completo no canal Posts.)\n` : rel.texto };
    const lista = (c.relatorios ||= []);
    const i = lista.findIndex((r) => r.tipo === 'final' && r.revisao === rel.revisao);
    if (i >= 0) lista[i] = { ...lista[i], ...enxuto, nome: lista[i].nome }; else c.relatorios = [...lista.filter((r) => r.tipo !== 'final'), enxuto];
    c.historico.push({ em: agora(), quem: 'sistema', txt: `Relatório final escrito por ${rel.autor}` });
    c.atualizado = agora(); salvar();
    return true;
  }

  const pendencias = id => dependenciasPendentes(obter(id) || {}, obter);
  /** An agent's account of what it did. It does not become a file on the card: the history gets a short line, the declared caveats
   *  are recorded, and the card's report is only the completion one. (Before, every message became a report of up to 50 KB.) */
  function relatar(id,dados,quem) {
    const c=obter(id);
    if (!c || (quem!=='voce' && !IDS.has(quem))) return falha('Tarefa ou autor desconhecido.');
    if (!String(dados.resumo || '').trim()) return falha('Relato precisa do que foi feito (resumo).');
    if (dados.automatico) return { ok: true, silencioso: true };
    const jaVistos = (c.relatos ||= []);   // only the keys of the latest accounts, so the same account does not go in twice
    const chaveRelato = `${quem}:${chaveEstavel(dados.chave, id, quem, dados.resumo)}`;   // the key is never a reason for rejection
    if (jaVistos.includes(chaveRelato)) return { ok: true, repetido: true };
    try {
      const handoff=Array.isArray(dados.handoff)?dados.handoff:[];
      if (handoff.length>8 || handoff.some(h=>!IDS.has(h.agente) || !h.motivo || !h.proximoPasso)) return falha('Handoff inválido.');
      const novos = []; if (limiteRelevante(dados.limites)) novos.push([String(dados.limites), 'agente']); for (const s of detectarRessalvas(dados.resumo)) novos.push([s, 'texto']);
      for (const [n, tp] of novos) registrarRessalvaTexto(c, n, quem, tp);
      const curto = String(dados.resumo).replace(/\s+/g, ' ').trim();
      jaVistos.push(chaveRelato); if (jaVistos.length > 30) jaVistos.splice(0, jaVistos.length - 30);
      c.historico.push({ em: agora(), quem, txt: `Relato: ${curto.length > 160 ? `${curto.slice(0, 159)}…` : curto}` });
      c.atualizado = agora();
      salvar();
      return { ok: true };
    } catch(e) { return falha(e.message); }
  }

  return {
    COLUNAS, carga, progresso, aoStatus, listar: ativos, obter, contar, estadoWip, criar, atualizar, mover,
    bloquear, desbloquear, comentar, aguardar, anotar, arquivar, resumo, fluxo, pendencias, relatar, registrarRessalva, registrarRelatorioFinal, validar, definirGateTask:fn=>{gateTask=fn;}, ressalvas: (id) => (obter(id) ? listaRessalvas(obter(id)) : []), registrarValidacaoApp, ajustarVerificacoes, excluir, cancelados: () => structuredClone(quadro.cancelados || []),
  };
}
