/* Vista do registro do projeto ("Produção" na equipe de novela): as fichas que a equipe anotou uma vez e que chegam prontas
   a cada agente. Aqui a Game Director lê, corrige, aprova referências de imagem, vê o que a equipe gerou e dispara o próximo
   pedido já com a ficha certa. Carrega depois de app.js e usa os mesmos ajudantes ($, esc, md, api, P, av…). */
/* global $, $$, esc, md, api, P, U, J, ic, av, ha, agente, rosterAtual, liderAtual, primeiroNome, nomeAgente, projetoAtual, abrirModal, fecharModal, perguntar, aviso, irPara, abrirIssue, modalCriar, depois, VFX */

const REG = { dados: null, galeria: null, editando: false, pendente: false };
const regVista = () => J().registro?.vista || 'Registro';
const urlArquivo = (caminho) => P(`/arquivo?caminho=${encodeURIComponent(caminho)}`);
const ehImagem = (f) => /\.(png|jpe?g|gif|webp)$/i.test(String(f || ''));
const regTipo = (t) => (REG.dados?.tipos || {})[t] || { titulo: t, plural: t };
const regTitulo = (t) => regTipo(t).titulo || t;
const regPlural = (t) => regTipo(t).plural || regTipo(t).titulo || t;
const regEntradas = () => REG.dados?.entradas || [];
const regSel = () => regEntradas().find((e) => e.chave === U.regSel) || null;

/** Tipos na ordem do template, depois os que a equipe inventou (em ordem alfabética). */
function regTipos() {
  const doTemplate = Object.keys(REG.dados?.tipos || {});
  const usados = [...new Set(regEntradas().map((e) => e.tipo))];
  return [...doTemplate, ...usados.filter((t) => !doTemplate.includes(t)).sort()];
}

async function renderRegistro(carregando = true) {
  // quem está no meio de uma edição não perde o que digitou por causa de um evento
  if (REG.editando || ($('#centro .producao') && $('#centro').contains(document.activeElement) && /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName))) { REG.pendente = true; return; }
  if (carregando && !REG.dados) $('#centro').innerHTML = `<div class="planner"><div class="mem-barra"><div class="info">Carregando o registro…</div></div></div>`;
  const [d, g] = await Promise.all([
    fetch(P('/registro')).then((r) => r.json()).catch(() => null),
    U.regModo === 'gerados' ? fetch(P('/registro/galeria')).then((r) => r.json()).catch(() => ({ itens: [] })) : Promise.resolve(REG.galeria),
  ]);
  if (!d) return;
  REG.dados = d; REG.galeria = g; REG.pendente = false;
  if (U.regSel && !regSel()) U.regSel = null;
  desenharRegistro();
}

function desenharRegistro() {
  const d = REG.dados; const p = projetoAtual();
  const q = (U.regBusca || '').trim().toLowerCase();
  const casa = (e) => !q || `${e.nome} ${e.apelidos.join(' ')} ${e.resumo} ${e.chave}`.toLowerCase().includes(q);
  const todas = regEntradas();
  const gerados = U.regModo === 'gerados';
  const grupos = regTipos().map((t) => {
    const itens = todas.filter((e) => e.tipo === t).filter(casa);
    if (!itens.length && (q || !d.tipos[t])) return '';
    return `<div class="mem-grupo reg-grupo">${esc(regPlural(t))}<span class="n">${itens.length}</span><button class="btn-ic" data-reg="nova" data-tipo="${esc(t)}" title="Nova ficha: ${esc(regTitulo(t))}">${ic('mais')}</button></div>
      ${itens.map((e) => { const img = e.refs.find(ehImagem); return `<button class="nota reg-item ${U.regSel === e.chave && !gerados ? 'ativa' : ''} ${d.tipos[e.tipo]?.sempre ? 'fixa' : ''}" data-reg="abrir" data-chave="${esc(e.chave)}">
        <span class="reg-thumb" style="--c:${corDe(e.chave)}">${img ? `<img src="${urlArquivo(img)}" alt="" loading="lazy">` : esc(e.nome.trim()[0] || '?')}</span>
        <span class="reg-txt"><span class="t">${esc(e.nome)}</span><span class="m">v${e.versao}, ${esc(nomeAgente(e.por))}, ${ha(e.em)}${e.refs.length ? `, ${e.refs.length} ref.` : ''}</span></span></button>`; }).join('')}`;
  }).join('');
  const naoLidos = 0;
  $('#centro').innerHTML = `<div class="planner producao" style="min-height:0">
    <div class="planner-topo" style="padding-bottom:0">
      <div class="migalha"><b>Projetos</b>${ic('setaD')}<b>${esc(p?.nome || '')}</b>${ic('setaD')}${esc(regVista())}</div>
      <div class="planner-linha"><h1>${esc(regVista())}</h1>
        ${d.imagens === false ? '' : `<div class="reg-abas"><button class="${gerados ? '' : 'on'}" data-reg="modo" data-modo="fichas">Fichas <small>${todas.length}</small></button><button class="${gerados ? 'on' : ''}" data-reg="modo" data-modo="gerados">Gerados${REG.galeria ? ` <small>${REG.galeria.itens.length}</small>` : ''}</button></div>`}
        <span class="espaco"></span>
        ${window.studioApp ? `<button class="btn-sec" data-acao="abrir-pasta-projeto" title="${esc(d.raiz || '')}">Abrir pasta</button>` : ''}
        <button class="btn-primario" data-reg="nova">${ic('mais')}Nova ficha</button></div>
    </div>
    <div class="memoria-v reg-v ${gerados ? 'gerados' : ''}">
      <div class="mem-arvore"><div class="busca">${ic('busca')}<input id="reg-busca" class="in" placeholder="Buscar nas fichas" value="${esc(U.regBusca || '')}" autocomplete="off"></div>
        <div class="mem-lista" id="reg-lista">${grupos || `<div class="vazio-p">Nenhuma ficha ainda. Conte o briefing à equipe no chat, ou crie a primeira aqui.</div>`}</div></div>
      ${gerados ? geradosHtml() : `<div class="reg-main"><div class="mem-leitor reg-ficha" id="reg-ficha">${regSel() ? fichaHtml(regSel()) : regVazioHtml()}</div><aside class="reg-lado" id="reg-lado">${regSel() ? ladoHtml(regSel()) : ''}</aside></div>`}
    </div></div>`;
  const b = $('#reg-busca');
  if (b) { b.oninput = () => { U.regBusca = b.value; const y = $('#reg-lista').scrollTop; $('#reg-lista').outerHTML = `<div class="mem-lista" id="reg-lista">${desenharListaSo()}</div>`; $('#reg-lista').scrollTop = y; }; }
  ligarArrastar();
  void naoLidos;
}
// só a lista (a busca redesenha sem mexer no resto)
function desenharListaSo() {
  const d = REG.dados; const q = (U.regBusca || '').trim().toLowerCase();
  const casa = (e) => !q || `${e.nome} ${e.apelidos.join(' ')} ${e.resumo} ${e.chave}`.toLowerCase().includes(q);
  return regTipos().map((t) => {
    const itens = regEntradas().filter((e) => e.tipo === t).filter(casa);
    if (!itens.length && (q || !d.tipos[t])) return '';
    return `<div class="mem-grupo reg-grupo">${esc(regPlural(t))}<span class="n">${itens.length}</span><button class="btn-ic" data-reg="nova" data-tipo="${esc(t)}" title="Nova ficha: ${esc(regTitulo(t))}">${ic('mais')}</button></div>
      ${itens.map((e) => { const img = e.refs.find(ehImagem); return `<button class="nota reg-item ${U.regSel === e.chave && U.regModo !== 'gerados' ? 'ativa' : ''}" data-reg="abrir" data-chave="${esc(e.chave)}"><span class="reg-thumb" style="--c:${corDe(e.chave)}">${img ? `<img src="${urlArquivo(img)}" alt="" loading="lazy">` : esc(e.nome.trim()[0] || '?')}</span><span class="reg-txt"><span class="t">${esc(e.nome)}</span><span class="m">v${e.versao}, ${esc(nomeAgente(e.por))}, ${ha(e.em)}</span></span></button>`; }).join('')}`;
  }).join('') || '<div class="vazio-p">Nada com esse nome.</div>';
}
const corDe = (s) => { let h = 0; for (const ch of String(s)) h = (h * 31 + ch.charCodeAt(0)) % 360; return `hsl(${h} 45% 42%)`; };

function regVazioHtml() {
  const d = REG.dados; const fixos = Object.entries(d.tipos).filter(([, t]) => t.sempre);
  return `<div class="reg-vazio">
    <h2>${esc(regVista())}</h2>
    <p>Cada ficha aqui chega inteira ao agente sempre que a tarefa cita o nome dela ou o card aponta para ela. ${fixos.length ? `${fixos.map(([, t]) => esc(t.titulo)).join(' e ').replace(/ e (?=.* e )/g, ', ')} ${fixos.length > 1 ? 'entram' : 'entra'} em toda chamada.` : ''}</p>
    <div class="reg-tipos">${Object.entries(d.tipos).map(([k, t]) => `<button class="reg-tipo" data-reg="nova" data-tipo="${esc(k)}"><b>${esc(t.titulo)}</b><small>${esc(t.descricao || '')}</small></button>`).join('')}</div>
  </div>`;
}

function fichaHtml(e) {
  const d = REG.dados; const t = d.tipos[e.tipo] || {};
  const usos = d.usos?.[e.chave] || [];
  const refs = e.refs.map((r) => `<figure class="reg-ref" title="${esc(r)}">${ehImagem(r) ? `<a href="${urlArquivo(r)}" target="_blank" rel="noopener"><img src="${urlArquivo(r)}" alt="" loading="lazy"></a>` : `<a class="reg-ref-arq" href="${urlArquivo(r)}" target="_blank" rel="noopener">${ic('pasta')}<span>${esc(r.split(/[\\/]/).pop())}</span></a>`}<button class="btn-ic" data-reg="tirar-ref" data-ref="${esc(r)}" title="Tirar das referências">${ic('fechar')}</button></figure>`).join('');
  return `<div class="reg-cab">
      <span class="loz reg-loz">${esc(regTitulo(e.tipo))}</span>${t.sempre ? `<span class="loz andamento" title="Entra em toda chamada da equipe">Sempre</span>` : ''}
      <span class="espaco"></span>
      <button class="btn-sec" data-reg="editar">Editar</button>
    </div>
    <h1 class="reg-nome">${esc(e.nome)}</h1>
    <div class="reg-meta">v${e.versao} ${esc(nomeAgente(e.por))} ${ha(e.em)}<span class="reg-chave" title="Como os agentes apontam esta ficha num card">${esc(e.chave)}</span></div>
    ${e.apelidos.length ? `<div class="reg-apelidos">${e.apelidos.map((a) => `<span class="chip-cam">${esc(a)}</span>`).join('')}</div>` : ''}
    <div class="texto corpo reg-resumo">${md(e.resumo)}</div>
    <div class="reg-acrescentar"><textarea class="in" id="reg-acresc" rows="1" placeholder="Acrescentar algo à ficha (Enter envia, Shift+Enter quebra linha)"></textarea></div>
    ${REG.dados?.imagens === false && !e.refs.length ? '' : `<div class="sec reg-sec-refs"><h4>Referências aprovadas ${e.refs.length ? `<span class="mudo">${e.refs.length} de 8</span>` : ''}<span class="espaco"></span><button class="btn-sec" data-reg="add-ref">Adicionar imagem</button></h4>
      <div class="reg-refs" id="reg-refs">${refs || '<div class="reg-solta">Solte imagens aqui, ou aprove na aba Gerados. Os agentes usam estas imagens em toda geração com este nome.</div>'}</div></div>`}
    ${e.arquivo ? `<div class="sec"><h4>Documento completo</h4><button class="reg-doc" data-reg="ler-doc" data-arq="${esc(e.arquivo)}">${ic('pasta')}<span>${esc(e.arquivo)}</span></button></div>` : ''}
    ${usos.length ? `<div class="sec"><h4>Cards que apontam esta ficha</h4><div class="reg-usos">${usos.map((u) => `<button class="reg-uso" data-issue="${esc(u.id)}"><span class="loz ${esc(u.coluna)}">${esc(u.coluna)}</span>${u.dono ? av(u.dono, 'p', { dot: false }) : ''}<span>${esc(u.titulo)}</span></button>`).join('')}</div></div>` : ''}
    ${(e.historico || []).length ? `<details class="reg-hist"><summary>Versões anteriores (${e.historico.length})</summary>${[...e.historico].reverse().map((h) => `<div class="reg-hist-i"><div class="m">v${h.versao}, ${esc(nomeAgente(h.por))}, ${ha(h.em)}</div><div class="texto corpo">${md(h.resumo)}</div></div>`).join('')}</details>` : ''}`;
}

function ladoHtml(e) {
  const d = REG.dados; const t = d.tipos[e.tipo] || {};
  const lider = liderAtual();
  const pedidos = (t.pedidos && t.pedidos.length ? t.pedidos : [{ rotulo: `Pedir a ${primeiroNome(nomeAgente(lider))}`, agente: lider, texto: 'sobre {nome}: ' }]).filter((p) => agente(p.agente));
  return `<div class="rot">Pedir à equipe</div>
    <div class="reg-pedidos">${pedidos.map((p, i) => `<button class="reg-pedido" data-reg="pedir" data-i="${i}" title="${esc(p.texto.replace('{nome}', e.nome))}">${av(p.agente, 'p', { dot: false })}<span><b>${esc(p.rotulo)}</b><small>${esc(primeiroNome(nomeAgente(p.agente)))}</small></span></button>`).join('')}</div>
    <div class="rot" style="margin-top:14px">Planejar</div>
    <button class="btn-sec reg-largo" data-reg="card">Criar tarefa com esta ficha</button>
    <div class="rot" style="margin-top:14px">Ficha</div>
    <div class="reg-info"><span>Tipo</span><b>${esc(regTitulo(e.tipo))}</b></div>
    ${t.descricao ? `<div class="reg-dica">${esc(t.descricao)}</div>` : ''}
    <div class="reg-info"><span>Versões</span><b>${e.versao}</b></div>
    <div class="reg-info"><span>Anotada por</span><b>${esc(nomeAgente(e.por))}</b></div>
    <div class="side-acoes" style="margin-top:14px"><button class="btn-sec btn-perigo" data-reg="remover">Remover ficha</button></div>`;
}

function geradosHtml() {
  const g = REG.galeria || { itens: [] };
  const nomeFicha = (k) => regEntradas().find((e) => e.chave === k)?.nome || k;
  if (!g.itens.length) return `<div class="mem-leitor reg-gerados"><div class="reg-vazio"><h2>Nada gerado ainda</h2><p>Quando a equipe gerar imagens no chat ou montar um storyboard, aparece aqui para você aprovar como referência de uma ficha.</p></div></div>`;
  const grupos = [['storyboard', 'Storyboards animados'], ['chat', 'Imagens geradas no chat'], ['projeto', 'Arquivos do projeto']];
  return `<div class="mem-leitor reg-gerados">${grupos.map(([o, titulo]) => {
    const itens = g.itens.filter((i) => i.origem === o);
    return itens.length ? `<h4 class="reg-ger-t">${esc(titulo)} <span class="mudo">${itens.length}</span></h4><div class="reg-grade">${itens.map((i, k) => `<figure class="reg-ger ${i.gif ? 'gif' : ''} ${i.ficha ? 'aprovada' : ''}" data-reg="ver" data-caminho="${esc(i.caminho)}" title="${esc(i.nome)}">
      <img src="${urlArquivo(i.caminho)}" alt="${esc(i.nome)}" loading="${k < 12 ? 'eager' : 'lazy'}">
      <figcaption><span class="n">${esc(i.nome.replace(/^\d{6}-/, ''))}</span><span class="m">${i.ficha ? `${ic('check')} ${esc(nomeFicha(i.ficha))}` : ha(i.em)}</span></figcaption></figure>`).join('')}</div>` : '';
  }).join('')}</div>`;
}

/* ------------------------------------------------------------ ações */
async function regAnotar(corpo) {
  const r = await api('POST', P('/registro'), corpo);
  if (!r._ok) { aviso(r.erro || 'Não consegui anotar.'); return null; }
  if (r.cortado) aviso('O resumo passou de 1800 caracteres e foi cortado. Ponha o detalhe no documento completo.');
  return r;
}
function modalFicha(e = null, tipoInicial = '') {
  const d = REG.dados; const tipos = regTipos();
  const tipo = e?.tipo || tipoInicial || tipos[0] || 'entidade';
  REG.editando = true;
  abrirModal(`<h2>${e ? `Editar ${esc(e.nome)}` : 'Nova ficha'}</h2>
    <div class="dois campo">
      <div><label class="rot">Tipo</label>${e ? `<div class="caminho">${esc(regTitulo(e.tipo))}</div>` : `<select class="in" id="rf-tipo">${tipos.map((t) => `<option value="${esc(t)}" ${t === tipo ? 'selected' : ''}>${esc(regTitulo(t))}</option>`).join('')}<option value="__outro">Outro tipo…</option></select><input class="in" id="rf-tipo-outro" placeholder="nome do tipo" hidden style="margin-top:6px">`}</div>
      <div><label class="rot">Nome</label><input class="in" id="rf-nome" value="${esc(e?.nome || '')}" placeholder="Ana, Cena 2 do ep 1, Padaria da esquina" autocomplete="off"></div></div>
    <div class="campo"><label class="rot">Resumo <small class="mudo" id="rf-cont"></small></label><textarea class="in" id="rf-resumo" rows="9" placeholder="${esc(d.tipos[tipo]?.descricao ? `O que a equipe precisa saber sem abrir arquivo: ${d.tipos[tipo].descricao}.` : 'O que a equipe precisa saber, sem abrir arquivo.')}">${esc(e?.resumo || '')}</textarea></div>
    <div class="dois campo">
      <div><label class="rot">Outros nomes</label><input class="in" id="rf-apelidos" value="${esc((e?.apelidos || []).join(', '))}" placeholder="separados por vírgula"></div>
      <div><label class="rot">Documento completo</label><input class="in" id="rf-arquivo" value="${esc(e?.arquivo || '')}" placeholder="biblia/personagens/ana/ficha.md"></div></div>
    <div class="acoes"><button class="btn-sec" id="m-nao">Cancelar</button><button class="btn-primario" id="m-sim">${e ? 'Salvar' : 'Criar ficha'}</button></div>`, 'modal-pq reg-modal');
  const cont = () => { const n = $('#rf-resumo').value.length; $('#rf-cont').textContent = `${n} de 1800`; $('#rf-cont').style.color = n > 1800 ? 'var(--verm)' : ''; };
  $('#rf-resumo').oninput = cont; cont();
  const selT = $('#rf-tipo'); if (selT) selT.onchange = () => { $('#rf-tipo-outro').hidden = selT.value !== '__outro'; if (selT.value === '__outro') $('#rf-tipo-outro').focus(); const dt = d.tipos[selT.value]; $('#rf-resumo').placeholder = dt?.descricao ? `O que a equipe precisa saber sem abrir arquivo: ${dt.descricao}.` : 'O que a equipe precisa saber, sem abrir arquivo.'; };
  const fechar = () => { REG.editando = false; fecharModal(); if (REG.pendente) renderRegistro(false); };
  $('#m-nao').onclick = fechar;
  $('#m-sim').onclick = async () => {
    const nome = $('#rf-nome').value.trim(); if (!nome) { $('#rf-nome').focus(); return; }
    const tp = e ? e.tipo : (selT.value === '__outro' ? $('#rf-tipo-outro').value.trim() : selT.value);
    if (!tp) { $('#rf-tipo-outro').focus(); return; }
    const apelidos = $('#rf-apelidos').value.split(',').map((x) => x.trim()).filter(Boolean);
    const r = await regAnotar({ tipo: tp, id: e?.id, nome, resumo: $('#rf-resumo').value, apelidos, tirarApelidos: (e?.apelidos || []).filter((a) => !apelidos.includes(a)), arquivo: $('#rf-arquivo').value.trim(), modo: 'substituir' });
    if (!r) return;
    REG.editando = false; fecharModal(); U.regSel = r.entrada.chave; U.regModo = 'fichas'; renderRegistro(false);
  };
  ($('#rf-nome').value ? $('#rf-resumo') : $('#rf-nome')).focus();
}
async function regPedir(e, i) {
  const t = REG.dados.tipos[e.tipo] || {}; const lider = liderAtual();
  const pedidos = (t.pedidos && t.pedidos.length ? t.pedidos : [{ agente: lider, texto: 'sobre {nome}: ' }]).filter((p) => agente(p.agente));
  const p = pedidos[i]; if (!p) return;
  const ag = agente(p.agente);   // o @ pelo token do agente: o servidor reescreve para o nome atual
  const texto = `@${ag?.token || primeiroNome(ag?.nome || p.agente)} ${p.texto.replace(/\{nome\}/g, e.nome)}`;
  U.rascunhos[`${U.proj}/equipe`] = texto;
  irPara('chat', 'equipe');
  setTimeout(() => { const ta = $('#texto'); if (ta) { ta.focus(); ta.selectionStart = ta.selectionEnd = ta.value.length; } }, 150);
}
async function regEnviarImagens(e, arquivos) {
  const imgs = [...arquivos].filter((f) => /^image\//.test(f.type) || ehImagem(f.name)).slice(0, 8 - e.refs.length);
  if (!imgs.length) { aviso(e.refs.length >= 8 ? 'A ficha já tem 8 referências. Tire uma antes.' : 'Só imagens entram como referência.'); return; }
  const rels = [];
  for (const f of imgs) {
    const r = await fetch(P(`/anexo?nome=${encodeURIComponent(f.name)}`), { method: 'PUT', body: f }).then((x) => x.json()).catch(() => null);
    if (r?.ok) rels.push(r.anexo.rel); else aviso(r?.erro || `Não consegui enviar ${f.name}.`);
  }
  if (rels.length) await regAnotar({ tipo: e.tipo, id: e.id, nome: e.nome, refsAnexo: rels, modo: 'substituir' });
}
function ligarArrastar() {
  const alvo = $('#reg-refs'); if (!alvo) return;
  alvo.ondragover = (ev) => { ev.preventDefault(); alvo.classList.add('sobre'); };
  alvo.ondragleave = () => alvo.classList.remove('sobre');
  alvo.ondrop = (ev) => { ev.preventDefault(); alvo.classList.remove('sobre'); const e = regSel(); if (e && ev.dataTransfer?.files?.length) regEnviarImagens(e, ev.dataTransfer.files); };
}
function modalVerGerado(caminho) {
  const i = (REG.galeria?.itens || []).find((x) => x.caminho === caminho); if (!i) return;
  const fichas = regEntradas();
  const opcoes = regTipos().map((t) => { const its = fichas.filter((e) => e.tipo === t); return its.length ? `<optgroup label="${esc(regPlural(t))}">${its.map((e) => `<option value="${esc(e.chave)}" ${i.ficha === e.chave ? 'selected' : ''}>${esc(e.nome)}</option>`).join('')}</optgroup>` : ''; }).join('');
  abrirModal(`<div class="reg-ver"><a href="${urlArquivo(i.caminho)}" target="_blank" rel="noopener"><img src="${urlArquivo(i.caminho)}" alt="${esc(i.nome)}"></a>
    <div class="reg-ver-lado">
      <div class="rot">${i.gif ? 'Storyboard animado' : 'Imagem'}</div>
      <div class="reg-ver-nome">${esc(i.nome.replace(/^\d{6}-/, ''))}</div>
      <div class="reg-meta">${ha(i.em)}, ${(i.tamanho / 1024).toFixed(0)} KB</div>
      <div class="reg-ver-cam">${esc(i.caminho)}</div>
      ${i.ficha ? `<div class="reg-aprovada">${ic('check')} Referência de <b>${esc(fichas.find((e) => e.chave === i.ficha)?.nome || i.ficha)}</b></div>` : ''}
      <div class="rot" style="margin-top:16px">Aprovar como referência de</div>
      ${fichas.length ? `<select class="in" id="rv-ficha"><option value="">Escolha a ficha</option>${opcoes}</select>
      <button class="btn-primario reg-largo" id="rv-aprovar" style="margin-top:8px">${ic('check')}Aprovar</button>` : '<div class="vazio-p">Crie uma ficha primeiro.</div>'}
      <div class="acoes" style="margin-top:auto"><button class="btn-sec" id="m-nao">Fechar</button></div>
    </div></div>`, 'reg-modal-ver');
  $('#m-nao').onclick = fecharModal;
  const btn = $('#rv-aprovar');
  if (btn) btn.onclick = async () => {
    const k = $('#rv-ficha').value; if (!k) { $('#rv-ficha').focus(); return; }
    const e = fichas.find((x) => x.chave === k); if (!e) return;
    if (e.refs.length >= 8) { aviso(`${e.nome} já tem 8 referências. Tire uma antes.`); return; }
    const r = await regAnotar({ tipo: e.tipo, id: e.id, nome: e.nome, refs: [i.caminho], modo: 'substituir' });
    if (r) { fecharModal(); aviso(`${i.gif ? 'GIF' : 'Imagem'} aprovado como referência de ${e.nome}.`); renderRegistro(false); }
  };
}
async function modalLerDoc(arq) {
  const r = await fetch(P(`/arquivo?caminho=${encodeURIComponent(arq)}&texto=1`)).then((x) => x.json()).catch(() => ({}));
  abrirModal(`<div class="reg-doc-modal"><div class="issue-topo"><span class="chave">${esc(arq)}</span><span class="espaco"></span><button class="btn-ic" data-acao="fechar" title="Fechar (Esc)">${ic('fechar')}</button></div>
    <div class="mem-leitor"><div class="texto corpo">${r.texto != null ? md(String(r.texto).replace(/^---[\s\S]*?---\s*/, '')) : `<p class="mudo">${esc(r.erro || 'Não encontrei esse arquivo. O caminho é relativo à pasta do projeto.')}</p>`}</div></div></div>`, 'issue reg-doc');
}

/* ------------------------------------------------------------ eventos */
document.addEventListener('click', async (ev) => {
  const t = ev.target.closest('[data-reg]'); if (!t || !$('#centro .producao') && !t.closest('.modal')) return;
  const d = t.dataset; const e = regSel();
  switch (d.reg) {
    case 'abrir': U.regSel = d.chave; U.regModo = 'fichas'; location.hash = `${U.proj}/registro/${encodeURIComponent(d.chave)}`; desenharRegistro(); return;
    case 'modo': U.regModo = d.modo; location.hash = `${U.proj}/registro${d.modo === 'gerados' ? '/gerados' : U.regSel ? `/${encodeURIComponent(U.regSel)}` : ''}`; renderRegistro(false); return;
    case 'nova': return modalFicha(null, d.tipo || '');
    case 'editar': return e && modalFicha(e);
    case 'pedir': return e && regPedir(e, Number(d.i));
    case 'card': return e && modalCriar('backlog', { contexto: [e.chave], titulo: '' });
    case 'ver': return modalVerGerado(d.caminho);
    case 'ler-doc': return modalLerDoc(d.arq);
    case 'add-ref': { if (!e) return; const inp = Object.assign(document.createElement('input'), { type: 'file', accept: 'image/*', multiple: true }); inp.onchange = () => regEnviarImagens(e, inp.files); inp.click(); return; }
    case 'tirar-ref': if (e && await perguntar(`Tirar esta imagem das referências de ${e.nome}? O arquivo continua na pasta.`, 'Tirar')) await regAnotar({ tipo: e.tipo, id: e.id, nome: e.nome, tirarRefs: [d.ref], modo: 'substituir' }); return;
    case 'remover': if (e && await perguntar(`Remover a ficha ${e.nome}? Os agentes deixam de recebê-la.`, 'Remover')) { const r = await api('DELETE', P(`/registro/${encodeURIComponent(e.chave)}`)); if (!r._ok) aviso(r.erro || 'Não removi.'); else { U.regSel = null; location.hash = `${U.proj}/registro`; } } return;
    default:
  }
});
document.addEventListener('keydown', async (ev) => {
  const ta = ev.target; if (!(ta instanceof HTMLTextAreaElement) || ta.id !== 'reg-acresc' || ev.key !== 'Enter' || ev.shiftKey) return;
  ev.preventDefault(); const e = regSel(); const txt = ta.value.trim(); if (!e || !txt) return;
  ta.disabled = true;
  const r = await regAnotar({ tipo: e.tipo, id: e.id, nome: e.nome, resumo: txt, modo: 'acrescentar' });
  if (r) { ta.value = ''; } ta.disabled = false; renderRegistro(false);
});
