import { createHash } from 'node:crypto';
const h8 = (s) => createHash('sha1').update(String(s)).digest('hex').slice(0, 8);
const agora = () => new Date().toISOString();
const texto = (s, max = 2000) => String(s || '').trim().slice(0, max);
function exigir(ok, erro) { if (!ok) throw new Error(erro); }
/** Stable key: the agent sends whatever it wants ("T-016 r12 evidência", "evid_t016"...); the app normalizes to lowercase and hyphens.
 *  Without anything usable, it builds one from the content, so the same repeated record stays the same. Never a reason for rejection:
 *  rejecting by key is what made the team repeat the same record for hours (85 rejections in a single afternoon). */
export function chaveEstavel(valor, ...semente) {
  const limpa = String(valor ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80).replace(/-+$/g, '');
  return limpa || `auto-${createHash('sha1').update(JSON.stringify(semente)).digest('hex').slice(0, 10)}`;
}
const lista = (v) => Array.isArray(v) ? [...new Set(v.map(x => texto(x, 500)).filter(Boolean))].slice(0, 50) : [];
export const TIPOS_TAREFA = ['feature', 'bug', 'refatoracao', 'teste', 'infra', 'documentacao'];

export function novoFluxo() {
  return { revisao: 0, entregas: [], checkpoint: {}, verificacoes: [], achados: [], documentacao: { status: 'pendente' }, revisaoCodigo: { status: 'pendente' }, qa: { status: 'pendente' }, retrabalhos: 0, eventos: [] };
}

export function validarDependencias(id, dependencias, cards) {
  exigir(Array.isArray(dependencias) && dependencias.length <= 50 && dependencias.every(x => typeof x === 'string'), 'Dependências devem ser uma lista de até 50 IDs.');
  const deps = [...new Set(dependencias)];
  for (const dep of deps) exigir(dep !== id && cards.some(c => c.id === dep && !c.arquivado), `Dependência inválida: ${dep}`);
  const grafo = new Map(cards.map(c => [c.id, c.dependeDe || []])); grafo.set(id, deps);
  const visitados = new Set(), pilha = new Set();
  const visitar = k => {
    exigir(!pilha.has(k), 'As dependências formam um ciclo.');
    if (visitados.has(k)) return;
    pilha.add(k); for (const d of grafo.get(k) || []) visitar(d); pilha.delete(k); visitados.add(k);
  };
  visitar(id);
  return deps;
}

const norm = (x) => String(x || '').toLowerCase().replace(/\s+/g, ' ').trim();
/** The P.O.'s plan command is covered by a recorded check (similar text, not identical). */
export const cobre = (plano, v) => { const a = norm(plano), b = norm(v.comando); return !!a && !!b && (a === b || a.includes(b) || b.includes(a)); };
/** Items of the P.O.'s plan without an APPROVED check covering them. Not executed never counts as approved. */
export const planoSemRegistro = (c) => (c.validacoesObrigatorias || []).filter((cmd) => !(c.workflow?.verificacoes || []).some((v) => v.status === 'aprovado' && cobre(cmd, v)));
/** Mandatory checks not yet approved (failed or not executed). */
const verifsPendentes = (f) => (f.verificacoes || []).filter((v) => v.obrigatoria && v.status !== 'aprovado');
/** Short reason, in plain language, why the delivery's verification is not cleared. Empty if all is well. */
export function faltaVerificacao(c) {
  const f = c.workflow;
  if (!f?.verificacoes?.some((v) => v.obrigatoria)) return ['ao menos uma verificação obrigatória aprovada'];
  const out = [];
  const pend = verifsPendentes(f);
  if (pend.length) out.push(`verificação obrigatória sem aprovação: ${pend.map((v) => `${v.comando} (${v.status === 'falhou' ? 'falhou' : 'não executada'})`).join(', ')}`);
  const plano = planoSemRegistro(c);
  if (plano.length) out.push(`plano da P.O. sem verificação aprovada: ${plano.join('; ')}`);
  return out;
}

export const dependenciasPendentes = (c, obter) => (c.dependeDe || []).filter(id => obter(id)?.coluna !== 'concluido');

// ---- caveats: every warning becomes a trackable item, and nothing goes to QA or done with an open caveat -----------
// They come from four places: (1) a check that failed or did not run, (2) a limitation declared in the delivery, (3) a finding of
// any severity, (4) those agents record (ressalva.abrir), those detected in text and the Game Director's rejection.
// The first three are computed from the card state, so none can be forgotten; only those in (4) are stored.
const NEGA = /\b(sem|nenhum[a]?|n[aã]o (h[aá]|existe|tem|restam?|ficou|ficaram)|zero)\b[^.!?\n]{0,30}\b(ressalva|pend[eê]ncia|limita[cç][aã]o|aviso|problema)/i;
const ALERTA = /ressalva|pend[eê]nci|pendente|\bn[aã]o (consegui|foi poss[ií]vel|executei|testei|rodei|validei|verifiquei)\b|\bainda n[aã]o\b|\bfaltou\b|\bfalta (rodar|testar|validar|confirmar|executar)\b|workaround|gambiarra|provis[oó]rio|\bTODO\b/i;
/** Sentences of a text that sound like a warning, limitation or something not done (at most 3). Negations like "sem ressalvas" do not count. */
export function detectarRessalvas(txt) {
  const out = [];
  for (const s of String(txt || '').split(/(?<=[.!?])\s+|\n+/)) {
    const t = s.trim().replace(/^[-*•\d.)\s]+/, '');
    if (t.length < 12 || NEGA.test(t) || !ALERTA.test(t)) continue;
    out.push(t.slice(0, 300));
    if (out.length >= 3) break;
  }
  return out;
}
/** Does the declared limitation actually say something? ("Nenhuma" and the default text do not count.) */
export const limiteRelevante = (lim) => { const t = String(lim || '').trim(); return !!t && !/^limita[cç][oõ]es n[aã]o informadas/i.test(t) && !/^(nenhum[a]?\b|sem\b|n[aã]o h[aá]\b|n\/a\b|nada\b|-+$)/i.test(t); };

export function listaRessalvas(c) {
  const f = c.workflow;
  if (!f) return [];
  const rev = f.revisao, est = f.ressalvasRes || {}, out = [];
  const derivada = (r) => { const e = est[r.id]; out.push({ ...r, status: e?.status || 'aberta', resolucao: e || null }); };
  for (const v of f.verificacoes || []) {
    if (v.status === 'aprovado' || (v.status === 'nao_executado' && /barreira do projeto|Docker, que n[aã]o existe/i.test(v.evidencia))) continue;
    derivada({ id: `verif-r${rev}-${h8(v.comando)}`, tipo: 'verificacao', texto: `${v.status === 'falhou' ? 'Falhou' : 'Não executada'}: ${v.comando}. ${v.evidencia}`.slice(0, 500), severidade: v.status === 'falhou' || v.obrigatoria ? 'alta' : 'media', origem: f.entregas.at(-1)?.autor || null, revisao: rev, aceitavel: !v.obrigatoria && v.status === 'nao_executado' });
  }
  const e = f.entregas.at(-1);
  if (e && limiteRelevante(e.limites)) derivada({ id: `limite-r${rev}`, tipo: 'limite', texto: String(e.limites).slice(0, 500), severidade: 'baixa', origem: e.autor, revisao: rev, aceitavel: true });
  for (const a of f.achados || []) {
    if (a.revisao !== rev || ['refutado', 'resolvido'].includes(a.status)) continue;
    derivada({ id: `achado-${a.chave}`, tipo: 'achado', texto: `[${a.severidade}] ${a.arquivo}:${a.linha}: ${a.impacto}`.slice(0, 500), severidade: a.severidade, origem: a.autor, revisao: rev, aceitavel: a.severidade === 'baixa' });
  }
  for (const r of f.ressalvas || []) out.push({ ...r });
  return out;
}
export const ressalvasAbertas = (c) => listaRessalvas(c).filter((r) => r.status === 'aberta');

/** Records a free-text caveat (report, agent message). Returns true if a new one was created. */
export function registrarRessalvaTexto(c, txt, autor, tipo = 'texto') {
  const f = c.workflow;
  const t = texto(txt, 300);
  if (!f || t.length < 8) return false;
  const id = `${tipo === 'texto' ? 'txt' : 'ag'}-${h8(norm(t))}`;
  if ((f.ressalvas ||= []).some((r) => r.id === id)) return false;
  f.ressalvas.push({ id, tipo, texto: t, severidade: 'media', origem: autor, revisao: f.revisao, status: 'aberta', aceitavel: true, em: agora(), ...(tipo === 'texto' ? { detectada: true } : {}) });
  return true;
}
/** The Game Director tested the completed card and rejected it: it becomes a severe caveat, which only closes with a fix and new QA. */
export function novaRessalvaUsuario(c, motivo) {
  const f = c.workflow;
  const item = { id: `usr-${Date.now().toString(36)}`, tipo: 'usuario', texto: `Reprovado na validação final: ${texto(motivo, 400)}`, severidade: 'alta', origem: 'voce', revisao: f.revisao, status: 'aberta', aceitavel: false, em: agora() };
  (f.ressalvas ||= []).push(item);
  return item;
}
export function textoSituacao(c) {
  const l = listaRessalvas(c), ab = l.filter((r) => r.status === 'aberta'), ac = l.filter((r) => r.status === 'aceita');
  if (ab.length) return `Situação: COM ${ab.length} ${ab.length === 1 ? 'RESSALVA ABERTA' : 'RESSALVAS ABERTAS'}. Não está tudo certo: veja a seção Ressalvas.`;
  if (ac.length) return `Situação: sem ressalvas abertas. ${ac.length} ${ac.length === 1 ? 'foi aceita' : 'foram aceitas'} pela P.O. com motivo (veja a seção Ressalvas).`;
  return 'Situação: sem ressalvas.';
}
export function linhasRessalvas(c) {
  const l = listaRessalvas(c);
  if (!l.length) return ['Nenhuma ressalva registrada.'];
  const rot = { aberta: 'ABERTA', resolvida: 'resolvida', aceita: 'aceita pela P.O.' };
  return l.flatMap((r) => [`- [${rot[r.status] || r.status}] ${r.id} (${r.tipo}, ${r.severidade}): ${r.texto}`, ...(r.resolucao?.texto ? [`  ${r.status === 'aceita' ? 'Motivo da aceitação' : 'Resolução'}: ${r.resolucao.texto}${r.resolucao.evidencia ? ` Evidência: ${r.resolucao.evidencia}` : ''}`] : [])]);
}

/** Section the app writes on its own, from the card's real state. The agent cannot change or dress it up. */
export function fatosMarkdown(c) {
  const f = c.workflow, e = f?.entregas?.at(-1);
  const L = ['## Fatos conferidos pelo app', '_Esta seção é gerada pelo app a partir do estado real do card. Não foi escrita pelo agente._', '', textoSituacao(c), ''];
  if (f) {
    L.push('### Verificações da entrega atual', ...((f.verificacoes || []).length ? f.verificacoes.map((v) => `- ${v.status}: ${v.comando}${v.obrigatoria ? ' (obrigatória)' : ''}. ${v.evidencia}`) : ['- Nenhuma registrada.']), '');
    L.push('### Ressalvas', ...linhasRessalvas(c), '');
    L.push('### Revisão, documentação e QA', `- Revisão de código: ${f.revisaoCodigo.status}${f.revisaoCodigo.autor ? ` (${f.revisaoCodigo.autor})` : ''}`, `- Documentação: ${f.documentacao.status}`, `- QA: ${f.qa.status}${f.qa.autor ? ` (${f.qa.autor})` : ''}`, `- Retrabalhos: ${f.retrabalhos}`, '');
    if (e) L.push('### Arquivos da entrega', ...(e.arquivos || []).map((a) => `- ${a}`), '', `Branch: ${f.checkpoint.branch || 'não informada'}; commit: ${f.checkpoint.commit || 'não informado'}.`, '');
  }
  L.push('### Critérios de aceite', ...(c.aceite.length ? c.aceite.map((a) => `- [${a.ok ? 'x' : ' '}] ${a.t}`) : ['- Nenhum registrado.']));
  return L.join('\n');
}
/** Page properties, as in Notion: who, which card, type, status, branch. Generated from the card's real state. */
export function propsMarkdown(c, autorNome) {
  const f = c.workflow;
  const col = { backlog: 'Backlog', pronto: 'Pronto', andamento: 'Em andamento', impedimento: 'Impedimento', revisao: 'Revisão', qa: 'Testes (QA)', concluido: 'Concluído' }[c.coluna] || c.coluna;
  const linhas = [['Responsável', autorNome], ['Card', `${c.id}: ${c.titulo}`], ['Tipo', `${c.tipoTarefa}, risco ${c.risco}${c.pontos ? `, ${c.pontos} pts` : ''}`], ['Status do card', col], ['Entrega', f?.revisao ? `r${f.revisao}` : 'sem entrega'], ['Branch', f?.checkpoint?.branch || 'não informada']];
  return ['| Propriedade | Valor |', '|---|---|', ...linhas.map(([k, v]) => `| ${k} | ${String(v).replace(/\|/g, '/')} |`)].join('\n');
}
/** The card's final report as the responsible agent's document, with the app's facts at the end. */
export function relatorioFinalAutoral(c, autor, titulo, corpo) {
  const revisao = c.workflow?.revisao || 0;
  return { tipo: 'final', revisao, nome: `${c.id}-final-r${revisao}.md`, autor, autoral: true, texto: `# ${c.id}: ${titulo}\n\n${propsMarkdown(c, autor)}\n\n${corpo}\n\n---\n\n${fatosMarkdown(c)}\n`, em: agora() };
}

// Agents record checks in many ways ("pytest: 14 passed", resultado instead of status, saida instead of
// evidencia). Rejecting the whole delivery for that made the agent repeat the same delivery in a loop. Accept the obvious, discard
// only the item without a command and leave the rest to the checks the app itself runs.
const semAcento = (x) => norm(x).normalize('NFD').replace(/[̀-ͯ]/g, '');
const statusDe = (bruto, textoTodo) => {
  const st = semAcento(bruto || '');
  if (/^(aprovad|ok|passou|passando|pass|passed|success|sucesso|verde|green)/.test(st)) return 'aprovado';
  if (/^(falh|fail|erro|error|reprovad|vermelho|red)/.test(st)) return 'falhou';
  if (/^(nao.?execut|nao.?rodou|skip|pulad|not.?run|pendente|bloquead)/.test(st)) return 'nao_executado';
  const t = norm(textoTodo || '');
  if (/\b(\d+ )?(failed|falhou|falharam|erro)\b/.test(t) && !/\b0 failed\b/.test(t)) return 'falhou';
  if (/\b(passed|passando|passou|ok|sucesso)\b/.test(t)) return 'aprovado';
  return '';
};
export function normalizarVerificacoes(v) {
  exigir(Array.isArray(v) && v.length <= 30, 'Informe até 30 verificações estruturadas.');
  const out = [];
  for (const x0 of v) {
    const x = typeof x0 === 'string' ? { comando: x0.split(/[:\u2014-]\s/)[0], evidencia: x0 } : (x0 || {});
    const comando = texto(x.comando ?? x.cmd ?? x.command ?? x.verificacao ?? x.teste ?? x.nome, 500);
    if (!comando) continue;
    const evidencia = texto(x.evidencia ?? x.evidence ?? x.resultado ?? x.saida ?? x.output ?? x.resumo ?? x.detalhes ?? x.motivo);
    const status = ['aprovado', 'falhou', 'nao_executado'].includes(x.status) ? x.status : statusDe(x.status ?? x.resultado ?? x.estado, `${evidencia} ${typeof x0 === 'string' ? x0 : ''}`) || (evidencia ? 'aprovado' : 'nao_executado');
    out.push({ comando, status, evidencia: evidencia || (status === 'nao_executado' ? 'Não executado (o agente não informou o motivo).' : 'Informado pelo agente sem a saída do comando; o app confere ao rodar as verificações do plano.'), obrigatoria: x.obrigatoria !== false });
  }
  return out;
}

export function inicializarHistoricoVerificacoes(f) {
  if (f.historicoVerificacoes) return;
  const entregas = f.entregas || [];
  f.historicoVerificacoes = entregas.flatMap(e => (e.verificacoes || []).map(v => ({ ...v, revisao: e.revisao, autor: e.autor || 'nao informado', em: e.em || 'nao informado', ambiente: e.checkpoint?.worktree || 'nao informado', origem: 'entrega' })));
  const ultima = entregas.at(-1);
  for (const v of f.verificacoes || []) {
    if ((ultima?.verificacoes || []).some(x => x.comando === v.comando && x.status === v.status && x.evidencia === v.evidencia && x.obrigatoria === v.obrigatoria)) continue;
    const app = v.evidencia?.startsWith('(executado pelo app)');
    f.historicoVerificacoes.push({ ...v, revisao: f.revisao, autor: app ? 'sistema' : 'nao informado', em: app && f.validacaoApp?.revisao === f.revisao ? f.validacaoApp.em || 'nao informado' : 'nao informado', ambiente: 'nao informado', origem: app ? 'app' : 'legado' });
  }
}

// All mutations are made on a copy by the board: an invalid action never writes partial state.
// Agents sometimes get the field name wrong (resultado instead of status, resumo instead of evidencia). Accept the obvious.
function normalizarCampos(a, f) {
  const o = { ...a };
  if (o.revisao === undefined || o.revisao === null) o.revisao = f.revisao;
  const st = norm(o.status ?? o.resultado ?? o.veredito ?? (o.aprovado === true ? 'aprovado' : o.aprovado === false ? 'reprovado' : ''));
  if (/^(aprovad|ok|passou|pass|approved)/.test(st)) o.status = 'aprovado';
  else if (/^(reprovad|falh|rejeit|failed)/.test(st)) o.status = 'reprovado';
  else if (st && o.status === undefined) o.status = st;
  if (!texto(o.evidencia)) {
    const alt = o.evidencias ?? o.resumo ?? o.justificativa ?? o.motivo ?? o.comentario;
    o.evidencia = Array.isArray(alt) ? alt.join('; ') : alt;
  }
  return o;
}

export function aplicarFluxo(c, acao, a, autor, papeis) {
  const f = c.workflow ||= novoFluxo();
  const humano = autor === 'voce';
  const lead = autor === papeis.lead;
  const revisor = (autor === papeis.revisor || (c.dono === papeis.revisor && autor === papeis.revisorSuplente)) && autor !== c.dono;
  const qa = (autor === papeis.qa || (c.dono === papeis.qa && autor === papeis.lead)) && autor !== c.dono;
  const curador = autor === papeis.curador;
  const registro = { autor, em: agora(), revisao: f.revisao };
  if (['revisao', 'qa', 'documentacao', 'achado', 'verificar-achado'].includes(acao)) a = normalizarCampos(a, f);
  if (!['checkpoint','entrega'].includes(acao) && !acao.startsWith('ressalva-')) exigir(a.revisao === f.revisao, 'A revisão mudou. Releia o card antes de validar ou registrar achados.');
  if (acao === 'checkpoint') {
    exigir(humano || autor === c.dono || lead, 'Só o dono ou a P.O. registra o checkpoint.');
    exigir(texto(a.resumo) && texto(a.proximoPasso), 'Checkpoint precisa de resumo e próximo passo.');
    f.checkpoint = { resumo: texto(a.resumo), proximoPasso: texto(a.proximoPasso), branch: texto(a.branch, 200), worktree: texto(a.worktree, 500), commit: texto(a.commit, 100), arquivos: lista(a.arquivos), ...registro };
  } else if (acao === 'entrega') {
    exigir(humano || autor === c.dono, 'Só o dono registra uma entrega.');
    exigir(texto(a.resumo), 'Entrega precisa de um resumo do que foi feito.');
    const chaveRecebida = texto(a.chave, 100);   // old deliveries keep the key as it came (it could have uppercase)
    a = { ...a, chave: chaveEstavel(a.chave, c.id, f.revisao, a.resumo) };
    if (f.entregas.some(e => e.chave === a.chave || (chaveRecebida && e.chave === chaveRecebida))) return { repetido: true };
    // Without an agent key, the same summary from the same author right after the last delivery is a repeat, not a new delivery.
    const ultima = f.entregas.at(-1);
    if (!chaveRecebida && ultima && ultima.autor === autor && ultima.resumo === texto(a.resumo) && Date.now() - Date.parse(ultima.em || 0) < 15 * 60_000) return { repetido: true };
    const checks = normalizarVerificacoes(a.verificacoes);
    exigir(checks.length && lista(a.arquivos).length, 'Entrega precisa de arquivos e pelo menos uma verificação.');
    inicializarHistoricoVerificacoes(f);
    const pendentes = achadosAbertos(c);
    if (f.revisao > 0) { f.retrabalhos++; c.aceite.forEach(x => { x.ok = false; }); }
    f.revisao++;
    for (const achado of pendentes) { achado.origemRevisao ||= achado.revisao; achado.revisao = f.revisao; }
    const handoff = Array.isArray(a.handoff) ? a.handoff.map(h=>({agente:texto(h.agente,80),motivo:texto(h.motivo),proximoPasso:texto(h.proximoPasso)})) : [];
    exigir(handoff.length <= 8 && handoff.every(h=>papeis.ids.has(h.agente) && h.agente!==autor && h.motivo && h.proximoPasso), 'Handoff precisa de destinatário válido, motivo e próximo passo (até 8 pessoas).');
    f.entregas.push({ chave: texto(a.chave, 100), objetivo: c.titulo, resumo: texto(a.resumo), arquivos: lista(a.arquivos), verificacoes: checks, limites: texto(a.limites) || 'Limitações não informadas pelo agente.', handoff, checkpoint: structuredClone(f.checkpoint), ...registro, revisao: f.revisao });
    f.verificacoes = structuredClone(checks);
    f.historicoVerificacoes ||= [];
    f.historicoVerificacoes.push(...checks.map(v => ({ ...v, autor, em: agora(), revisao: f.revisao, ambiente: texto(a.ambiente, 500) || texto(f.checkpoint.worktree, 500) || 'nao informado', origem: 'entrega' })));
    f.documentacao = { status: 'pendente' }; f.revisaoCodigo = { status: 'pendente' }; f.qa = { status: 'pendente' };
    f.checkpoint = { ...f.checkpoint, resumo: texto(a.resumo), arquivos: lista(a.arquivos), proximoPasso: 'Revisar a entrega e conferir documentação e QA.', ...registro, revisao: f.revisao };
    c.evidencias.push(`Entrega r${f.revisao}: ${texto(a.resumo)}`);
    for (const s of detectarRessalvas(a.resumo)) registrarRessalvaTexto(c, s, autor, 'texto');
  } else if (acao === 'evidencia') {
    exigir(humano || autor === c.dono || lead, 'Apenas dono ou P.O. registra evidencia posterior.');
    exigir(f.revisao > 0, 'Este card ainda não tem entrega. Registre card.entrega primeiro; a evidência posterior complementa uma entrega que já existe.');
    const checks = normalizarVerificacoes(a.verificacoes);
    exigir(checks.length > 0, 'Informe ao menos uma verificacao.');
    // key and environment are never a reason for rejection: the app normalizes the key and fills in the environment
    const chave = chaveEstavel(a.chave, c.id, f.revisao, checks);
    const ambiente = (typeof a.ambiente === 'string' ? texto(a.ambiente, 500) : texto(a.ambiente && JSON.stringify(a.ambiente), 500)) || texto(f.checkpoint?.worktree, 500) || 'ambiente do agente (não informado)';
    inicializarHistoricoVerificacoes(f);
    if (f.historicoVerificacoes.some(v => v.chave === chave && v.revisao === f.revisao)) return { repetido: true };
    for (const check of checks) {
      let anterior = f.verificacoes.find(v => v.comando === check.comando);
      // command outside the delivery plan: goes in as an extra (non-mandatory) check, instead of rejecting the record
      if (!anterior) { anterior = { ...check, obrigatoria: false }; f.verificacoes.push(anterior); }
      exigir(check.obrigatoria === anterior.obrigatoria || !anterior.obrigatoria, 'A evidencia nao pode alterar a obrigatoriedade.');
      Object.assign(anterior, check, { obrigatoria: anterior.obrigatoria });
      f.historicoVerificacoes.push({ ...check, chave, ambiente, origem: 'posterior', ...registro });
    }
  } else if (acao === 'achado') {
    exigir(humano || revisor || qa, 'Achados formais são registrados por revisão ou QA.');
    exigir(['critica','alta','media','baixa'].includes(a.severidade) && texto(a.arquivo) && Number.isInteger(a.linha) && a.linha > 0 && texto(a.evidencia) && texto(a.impacto) && texto(a.correcao), 'Achado precisa de severidade, arquivo, linha, evidência, impacto e correção mínima.');
    a = { ...a, chave: chaveEstavel(a.chave, c.id, f.revisao, a.arquivo, a.linha, a.evidencia) };
    if (f.achados.some(x => x.chave === a.chave && x.revisao === f.revisao)) return { repetido: true };
    f.achados.push({ chave: a.chave, severidade: a.severidade, arquivo: texto(a.arquivo,500), linha: a.linha, evidencia: texto(a.evidencia), impacto: texto(a.impacto), correcao: texto(a.correcao), incerto: a.incerto === true, status: 'aberto', ...registro });
    f.revisaoCodigo = { status: 'pendente' }; f.qa = { status: 'pendente' };
  } else if (acao === 'verificar-achado') {
    const achado = f.achados.find(x => (x.chave === a.chave || x.chave === chaveEstavel(a.chave)) && x.revisao === f.revisao);
    exigir(achado, 'Achado não encontrado nesta revisão.');
    exigir(humano || (autor !== c.dono && autor !== achado.autor), 'A verificação precisa de alguém independente do dono e do autor do achado.');
    exigir(['confirmado','refutado','inconclusivo','resolvido'].includes(a.veredito) && texto(a.evidencia), 'Informe veredito e evidência da verificação.');
    achado.status = a.veredito; achado.verificacao = { evidencia: texto(a.evidencia), ...registro };
  } else if (acao === 'documentacao') {
    exigir(humano || curador || lead, 'Documentação é conferida pelo Curador ou pela P.O.');
    exigir(['atual','sem_alteracao'].includes(a.status) && texto(a.evidencia), 'Informe documentação atual ou sem_alteracao com evidência.');
    f.documentacao = { status: a.status, evidencia: texto(a.evidencia), arquivos: lista(a.arquivos), ...registro };
  } else if (acao === 'revisao' || acao === 'qa') {
    exigir(humano || (acao === 'revisao' ? revisor : qa), 'Esta validação exige o revisor/QA independente do dono.');
    exigir(f.revisao > 0 && ['aprovado','reprovado'].includes(a.status) && texto(a.evidencia), 'Informe status e evidência para uma entrega existente.');
    if (a.status === 'aprovado') {
      if (acao === 'qa') exigir(!pendenciasQualidade(c, 'qa').length, 'QA depende de revisão independente e documentação da entrega atual.');
      if (acao === 'qa') exigir(!ressalvasAbertas(c).length, `Há ressalvas abertas (${ressalvasAbertas(c).map((r) => r.id).join(', ')}). Resolva, ou a P.O. aceite as que podem ser aceitas, antes de o QA aprovar: só se aprova quando TUDO está certo.`);
      exigir(!achadosAbertos(c).length, 'Há achados materiais não resolvidos.');
      exigir(!faltaVerificacao(c).length, `Verificações: ${faltaVerificacao(c).join('; ')}.`);
    }
    f[acao === 'revisao' ? 'revisaoCodigo' : 'qa'] = { status: a.status, evidencia: texto(a.evidencia), ...registro };
  } else if (acao === 'ressalva-abrir') {
    const txt = texto(a.texto, 500);
    exigir(txt.length >= 8, 'Descreva a ressalva em pelo menos uma frase.');
    const id = `ag-${h8(norm(txt))}`;
    const ja = (f.ressalvas || []).find((r) => r.id === id);
    if (ja && ja.status === 'aberta') return { repetido: true };
    const sev = ['baixa', 'media', 'alta'].includes(a.severidade) ? a.severidade : 'media';
    const item = { id, tipo: 'agente', texto: txt, severidade: sev, origem: autor, revisao: f.revisao, status: 'aberta', aceitavel: sev !== 'alta', em: agora() };
    if (ja) Object.assign(ja, item, { resolucao: null }); else (f.ressalvas ||= []).push(item);
  } else if (acao.startsWith('ressalva-')) {
    const r = listaRessalvas(c).find((x) => x.id === a.ressalva);
    exigir(r, 'Ressalva não encontrada neste card. Use o id que aparece no pacote da tarefa (campo ressalva).');
    const marcar = (status, dados) => {
      const res = { status, por: autor, em: agora(), texto: texto(dados.texto), evidencia: texto(dados.evidencia) };
      const e = (f.ressalvas || []).find((x) => x.id === r.id);
      if (e) { e.status = status; e.resolucao = res; } else (f.ressalvasRes ||= {})[r.id] = res;
    };
    if (acao === 'ressalva-resolver') {
      exigir(r.status === 'aberta', 'Esta ressalva já foi resolvida ou aceita.');
      exigir(r.tipo !== 'achado', 'Achado se resolve corrigindo, registrando nova entrega e pedindo card.verificar-achado a alguém independente.');
      exigir(r.tipo !== 'verificacao', 'Verificação que falhou ou não rodou se resolve rodando de novo e registrando uma nova entrega com o resultado.');
      // whoever did the work records it: owner, opener, card participant, or whoever brings evidence measured by the app (job); the P.O. validates later
      exigir(humano || lead || autor === c.dono || autor === r.origem || (c.participantes || []).some((p) => p.agente === autor) || /\bjob-[a-z0-9]+\b/i.test(texto(a.evidencia)), 'Só o dono do card, quem registrou a ressalva, um participante do card, quem traz evidência de job do app, ou a P.O. resolve.');
      exigir(texto(a.resolucao) && texto(a.evidencia), 'Informe o que foi feito (resolucao) e a evidência.');
      marcar('resolvida', { texto: a.resolucao, evidencia: a.evidencia });
    } else if (acao === 'ressalva-aceitar') {
      exigir(humano || lead, 'Só a P.O. ou a Game Director aceita uma ressalva.');
      exigir(r.status === 'aberta', 'Esta ressalva já foi resolvida ou aceita.');
      exigir(r.aceitavel || humano, 'Esta ressalva não pode ser aceita: precisa ser resolvida (achado material, verificação obrigatória ou ressalva grave).');
      exigir(texto(a.motivo).length >= 15, 'Informe o motivo da aceitação em uma frase clara: a Game Director vai ler.');
      marcar('aceita', { texto: a.motivo, evidencia: '' });
    } else if (acao === 'ressalva-reabrir') {
      exigir(humano || lead || qa || revisor, 'Só QA, revisão, a P.O. ou a Game Director reabre uma ressalva.');
      exigir(r.status !== 'aberta', 'Esta ressalva já está aberta.');
      exigir(texto(a.motivo), 'Informe por que a ressalva continua valendo.');
      const e = (f.ressalvas || []).find((x) => x.id === r.id);
      if (e) { e.status = 'aberta'; e.resolucao = null; e.reaberta = texto(a.motivo); } else if (f.ressalvasRes) delete f.ressalvasRes[r.id];
    } else throw new Error('Ação de ressalva desconhecida.');
  } else throw new Error('Ação de workflow desconhecida.');
  f.eventos.push({ acao, ...registro, revisao: f.revisao });
  f.eventos = f.eventos.slice(-200);
  return { repetido: false };
}

export const achadosAbertos = c => (c.workflow?.achados || []).filter(a => a.revisao === c.workflow.revisao && a.severidade !== 'baixa' && !['refutado','resolvido'].includes(a.status));

export function pendenciasQualidade(c, coluna) {
  const f = c.workflow;
  if (!f) return [];
  const faltas = [];
  if (!f.revisao) faltas.push('entrega estruturada');
  else faltas.push(...faltaVerificacao(c));
  if (['qa', 'concluido'].includes(coluna)) {
    if (f.revisaoCodigo.status !== 'aprovado' || f.revisaoCodigo.revisao !== f.revisao) faltas.push('revisão independente da entrega atual');
    if (!['atual','sem_alteracao'].includes(f.documentacao.status) || f.documentacao.revisao !== f.revisao) faltas.push('conferência da documentação atual');
    if (achadosAbertos(c).length) faltas.push('resolução dos achados materiais');
    const ab = ressalvasAbertas(c);
    if (ab.length) faltas.push(`ressalvas abertas (${ab.length}): ${ab.slice(0, 3).map((r) => r.id).join(', ')}${ab.length > 3 ? '…' : ''}`);
  }
  if (coluna === 'concluido') {
    if (!c.aceite.length || c.aceite.some(a => !a.ok)) faltas.push('todos os critérios de aceite');
    if (f.qa.status !== 'aprovado' || f.qa.revisao !== f.revisao) faltas.push('QA independente da entrega atual');
  }
  return faltas;
}

/** Where the card is on the path delivery, review, documentation, QA, acceptance and what is missing for the next step. */
export function prontidao(c) {
  const f = c.workflow;
  if (!f) return null;
  const rev = f.revisao;
  const atual = (x) => x?.revisao === rev;
  const entrega = rev > 0;
  const verif = entrega && !faltaVerificacao(c).length;
  const revisao = f.revisaoCodigo.status === 'aprovado' && atual(f.revisaoCodigo);
  const docs = ['atual', 'sem_alteracao'].includes(f.documentacao.status) && atual(f.documentacao);
  const qa = f.qa.status === 'aprovado' && atual(f.qa);
  const ok = c.aceite.filter((x) => x.ok).length;
  const abertas = ressalvasAbertas(c);
  const etapas = [
    { id: 'entrega', nome: 'Entrega', ok: entrega },
    { id: 'verificacoes', nome: 'Verificações', ok: verif, falhou: (f.verificacoes || []).some((v) => v.obrigatoria && v.status === 'falhou') },
    { id: 'ressalvas', nome: abertas.length ? `Ressalvas (${abertas.length} abertas)` : 'Ressalvas', ok: entrega && !abertas.length, falhou: entrega && abertas.length > 0 },
    { id: 'revisao', nome: 'Revisão de código', ok: revisao, falhou: f.revisaoCodigo.status === 'reprovado' && atual(f.revisaoCodigo) },
    { id: 'docs', nome: 'Documentação', ok: docs },
    { id: 'qa', nome: 'Testes (QA)', ok: qa, falhou: f.qa.status === 'reprovado' && atual(f.qa) },
    { id: 'aceite', nome: `Critérios de aceite ${ok}/${c.aceite.length}`, ok: c.aceite.length > 0 && ok === c.aceite.length },
  ];
  const proxima = { backlog: 'andamento', pronto: 'andamento', andamento: 'revisao', impedimento: null, revisao: 'qa', qa: 'concluido', concluido: null }[c.coluna];
  return { etapas, falta: proxima && proxima !== 'andamento' ? pendenciasQualidade(c, proxima) : [], proxima };
}

const resumoEntrega = (e) => (e ? { chave: e.chave, autor: e.autor, revisao: e.revisao, resumo: e.resumo, arquivos: e.arquivos, limites: e.limites, handoff: e.handoff } : null);
const historicoCurto = (f) => (f?.historicoVerificacoes || []).slice(-6).map((v) => ({ comando: v.comando, status: v.status, revisao: v.revisao, evidencia: String(v.evidencia || '').slice(0, 140) }));
export function pacoteTarefa(c, obter) {
  if (!c) return '';
  const f = c.workflow;
  return JSON.stringify({ id: c.id, objetivo: c.titulo, descricao: c.descricao, tipo: c.tipoTarefa, risco: c.risco, aceite: c.aceite, arquivos: c.arquivos, validacoesObrigatorias: c.validacoesObrigatorias || [], plano: (c.plano || []).map((p) => `${p.n} [${p.status}] ${p.titulo} (${p.dono || '?'})`), dependeDe: (c.dependeDe || []).map(id => ({ id, estado: obter(id)?.coluna || 'ausente' })), checkpoint: f?.checkpoint, revisao: f?.revisao, ultimaEntrega: resumoEntrega(f?.entregas?.at(-1)), verificacoes: f?.verificacoes, historicoVerificacoes: historicoCurto(f), documentacao: f?.documentacao, revisaoCodigo: f?.revisaoCodigo, qa: f?.qa, achados: f?.achados.filter(a => a.revisao === f.revisao), ressalvas: listaRessalvas(c), faltas: pendenciasQualidade(c, 'concluido') });
}

export function progressoMarkdown(c, obter) {
  const f = c.workflow;
  return [`# ${c.id}: ${c.titulo}`, '', 'Gerado pelo NECTAR; o quadro é a fonte de verdade.', `Estado: ${c.coluna}; entrega r${f.revisao}; tipo: ${c.tipoTarefa}; risco: ${c.risco}.`, `Dono: ${c.dono || 'a definir'}. Dependências: ${(c.dependeDe || []).map(id=>`${id} (${obter(id)?.coluna || 'ausente'})`).join(', ') || 'nenhuma'}.`, '', '## Retomada', f.checkpoint.resumo || 'Sem checkpoint.', `Próximo passo: ${f.checkpoint.proximoPasso || 'Planejar e executar a tarefa.'}`, `Branch: ${f.checkpoint.branch || '?'}; worktree: ${f.checkpoint.worktree || '?'}; commit: ${f.checkpoint.commit || '?'}.`, '', '## Critérios', ...c.aceite.map(a=>`- [${a.ok?'x':' '}] ${a.t}`), '', '## Verificações da entrega atual', ...f.verificacoes.map(v=>`- ${v.status}: ${v.comando} — ${v.evidencia}`), '', `Revisão: ${f.revisaoCodigo.status}; documentação: ${f.documentacao.status}; QA: ${f.qa.status}.`, `Pendências: ${pendenciasQualidade(c,'concluido').join('; ') || 'nenhuma'}.`, `Ressalvas abertas: ${ressalvasAbertas(c).length}.`, `Bloqueio: ${c.bloqueio || c.aguardando || 'nenhum'}.`].join('\n');
}

function relatorioDetalhado(c, tipo, autor) {
  const f = c.workflow, e = f?.entregas.at(-1);
  const revisao = f?.revisao || 0;
  const nome = `${c.id}-${tipo}-r${revisao}.md`;
  const linhas = [`# ${c.id} — ${tipo === 'final' ? 'Relatório final da tarefa' : tipo==='atividade' ? 'Relatório da atividade' : 'Relatório de entrega'}`, '', `Tarefa: ${e?.objetivo || c.titulo}`, `Autor da execução: ${e?.autor || c.dono || autor}`, `Registrado em: ${agora()}`, `Versão da entrega: ${revisao}`, textoSituacao(c), '', '## Resultado', e?.resumo || c.descricao || c.titulo, '', '## Arquivos', ...(e?.arquivos || c.arquivos).map(a=>`- ${a}`), '', '## Validações', ...((tipo === 'atividade' ? e?.verificacoes : f?.verificacoes) || []).map(v=>`- ${v.status}: ${v.comando}\n  Evidência: ${v.evidencia}`), ...(!e ? c.evidencias.map(x=>`- ${x}`) : []), '', '## Ressalvas', ...linhasRessalvas(c), '', '## Limitações e pendências', e?.limites || 'Verificações estruturadas não foram registradas nesta tarefa.', ...((tipo === 'atividade' ? e?.verificacoes : f?.verificacoes) || []).filter(v=>v.status!=='aprovado').map(v=>`- ${v.comando}: ${v.evidencia}`), '', '## Retomada e handoff', `Branch: ${e?.checkpoint?.branch || f?.checkpoint?.branch || 'não informada'}`, `Worktree: ${e?.checkpoint?.worktree || f?.checkpoint?.worktree || 'não informado'}`, `Commit: ${e?.checkpoint?.commit || f?.checkpoint?.commit || 'não informado'}`, ...(e?.handoff || []).map(h=>`- Para ${h.agente}: ${h.motivo}\n  Próximo passo: ${h.proximoPasso}`)];
  if (tipo !== 'atividade' && f?.historicoVerificacoes?.length) linhas.push('', '## Historico de verificacoes', ...f.historicoVerificacoes.filter(v => v.revisao === revisao).map(v => `- r${v.revisao} ${v.status}: ${v.comando} - ${v.evidencia} (autor: ${v.autor}; ambiente: ${v.ambiente}; ${v.em})`));
  if (!e?.handoff?.length) linhas.push(tipo==='final'?'Sem handoff adicional solicitado.':'Próxima etapa: revisão independente da entrega registrada neste card.');
  if (tipo==='final' && f) linhas.push('', '## Revisão, documentação e QA', `Revisão: ${f.revisaoCodigo.status}, por ${f.revisaoCodigo.autor || 'não informado'} — ${f.revisaoCodigo.evidencia || ''}`, `Documentação: ${f.documentacao.status} — ${f.documentacao.evidencia || ''}`, `QA: ${f.qa.status}, por ${f.qa.autor || 'não informado'} — ${f.qa.evidencia || ''}`, '', '## Critérios de aceite', ...c.aceite.map(a=>`- [${a.ok?'x':' '}] ${a.t}`));
  return { tipo, revisao, nome, autor: e?.autor || c.dono || autor, texto: linhas.join('\n')+'\n', em: agora() };
}

const corta = (s, n) => { const t = String(s ?? '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };

/** Card COMPLETION report: short and objective, one per card. It is what goes by DM to the Game Director and stays on the card. */
function relatorioConciso(c, autor) {
  const f = c.workflow, e = f?.entregas.at(-1);
  const revisao = f?.revisao || 0;
  const arquivos = e?.arquivos || c.arquivos || [];
  const checks = f?.verificacoes || [];
  const linhas = [`# ${c.id}: ${corta(c.titulo, 120)}`, '', `Concluída por ${e?.autor || c.dono || autor}, versão ${revisao}, em ${agora()}.`, textoSituacao(c), '',
    '## Resultado', corta(e?.resumo || c.descricao || c.titulo, 700), '',
    `## Arquivos (${arquivos.length})`, ...arquivos.slice(0, 8).map(a => `- ${a}`), ...(arquivos.length > 8 ? [`- e mais ${arquivos.length - 8}`] : []), '',
    `## Validações (${checks.filter(v => v.status === 'aprovado').length} de ${checks.length} aprovadas)`,
    ...checks.filter(v => v.status !== 'aprovado').slice(0, 5).map(v => `- ${v.status}: ${corta(v.comando, 90)} (${corta(v.evidencia, 120)})`)];
  const hist = (f?.historicoVerificacoes || []).filter(v => v.revisao === revisao).slice(-8);
  if (hist.length) linhas.push('', '## Histórico de verificações', ...hist.map(v => `- r${v.revisao} ${v.status}: ${corta(v.comando, 90)} - ${corta(v.evidencia, 120)} (${corta(v.ambiente, 40)})`));
  linhas.push('', '## Ressalvas', ...linhasRessalvas(c));
  const limites = corta(e?.limites, 300);
  if (limites && !/não informad/i.test(limites)) linhas.push('', '## Limitações', limites);
  if (f) linhas.push('', '## Revisão, documentação e QA', `Revisão: ${f.revisaoCodigo.status}, por ${f.revisaoCodigo.autor || 'não informado'}`, `Documentação: ${f.documentacao.status}`, `QA: ${f.qa.status}, por ${f.qa.autor || 'não informado'}`);
  if (c.aceite?.length) linhas.push('', '## Critérios de aceite', ...c.aceite.slice(0, 12).map(a => `- [${a.ok ? 'x' : ' '}] ${corta(a.t, 110)}`));
  const branch = e?.checkpoint?.branch || f?.checkpoint?.branch, commit = e?.checkpoint?.commit || f?.checkpoint?.commit;
  if (branch || commit) linhas.push('', `Branch: ${branch || 'não informada'}. Commit: ${commit || 'não informado'}.`);
  const texto = linhas.join('\n');
  return { tipo: 'final', revisao, nome: `${c.id}-final-r${revisao}.md`, autor: e?.autor || c.dono || autor, texto: `${texto.length > 4500 ? `${texto.slice(0, 4400)}\n…` : texto}\n`, em: agora() };
}

/** 'final' is the completion report (concise, one per card). 'entrega' and 'atividade' are the long format and are no longer stored on the card. */
export function relatorioTarefa(c, tipo, autor) {
  return tipo === 'final' ? relatorioConciso(c, autor) : relatorioDetalhado(c, tipo, autor);
}
