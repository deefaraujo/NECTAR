/* =====================================================================
   NECTAR, Colmeia: o projeto inteiro visto como uma colmeia viva, num canvas infinito.

   Só desenho. Lê o estado que o app já tem (PJ, E, U, CH) e os eventos que app.js repassa em colmeiaEvento().
   Nenhuma linha daqui fala com modelo ou com o servidor: a colmeia não custa crédito.

   O que cada coisa representa:
   - Você é a rainha, no centro. O favo dela enche de mel conforme o projeto é concluído (cards concluídos / total).
   - Cada equipe é um favo em volta; a liderança fica na célula mais perto da rainha.
   - Cada agente tem uma célula e uma abelha. Abelha parada na célula = em repouso. Pairando sobre a célula, com
     o card de tarefa ao lado = trabalhando. Rodeando a célula = na fila. Ao lado da célula de outro = foi ajudar
     (presença "consultando fulano"). Vermelho = bloqueio no card. Âmbar com "?" = aguardando a Game Director.
   - Quando alguém fala com alguém (menção, DM, sala), a abelha voa até lá levando pólen e volta; fica um fio
     entre as duas células que esmaece com o tempo. Card concluído: a abelha leva mel à rainha.
   - Ligação de voz: fio dourado entre a rainha e quem está na chamada.

   Canvas infinito: arrasta para percorrer, roda para dar zoom (ou pinça), duplo clique aproxima, "0" enquadra tudo.
   Longe, nomes e cards somem e as abelhas crescem para continuarem visíveis; perto, aparece o detalhe.
   ===================================================================== */
const CO = {
  cv: null, ctx: null, raiz: null, raf: 0, ultimo: 0, t: 0, dpr: 1, W: 0, H: 0,
  cam: { x: 0, y: 0, z: 1 }, alvoCam: null, vel: { x: 0, y: 0 },
  equipes: [], favos: [], celulas: new Map(), abelhas: new Map(), rainha: { x: 0, y: 0, r: 51, raio: 51, pulso: 0 },
  fios: [], particulas: [], ondas: [], registro: [], cards: new Map(), entregas: 0, progresso: 0,
  cartas: new Map(), zonas: null,   // canteiro: os cards do quadro vivem em três áreas (a fazer, em andamento, concluído)
  hover: null, hits: [], ponteiros: new Map(), arrasto: null, pinca: null,
  cores: {}, fonte: 'sans-serif', fonteTit: 'sans-serif', imgs: new Map(), proximoSync: 0, montadoPara: '', tot: {},
};
const HEX_R = 34, PASSO = HEX_R + 4;
const TAU = Math.PI * 2;
const ZONA = { cols: 3, sw: 120, sh: 48, pad: 16, cab: 36, maxLinhas: 6, cw: 108, ch: 36 };   // medidas do canteiro e dos cards
const CONCLUIDO_FICA_S = 30 * 60;   // um card concluído fica meia hora no canteiro e depois some

/* ------------------------------------------------------------ utilidades */
const coVar = (n, fb) => (getComputedStyle(document.documentElement).getPropertyValue(n) || '').trim() || fb;
function coCores() {
  CO.cores = {
    ambar: coVar('--ambar', '#F5A623'), ouro: coVar('--ouro-1', '#FFD34D'), laranja: coVar('--laranja', '#FF8A00'), violeta: coVar('--violeta', '#A66BFF'),
    verm: coVar('--verm', '#FF6B6B'), verde: '#5BD8A0', texto: coVar('--texto', '#F3EAD9'), suave: coVar('--suave', '#C9BCA6'), mudo: coVar('--mudo', '#8A7F70'),
    bg1: coVar('--bg-1', '#110F13'), bg2: coVar('--bg-2', '#15131A'), bg3: coVar('--bg-3', '#1C1921'), bg4: coVar('--bg-4', '#25212B'), bg5: coVar('--bg-5', '#312C39'),
    cera: 'rgba(245, 166, 35, .07)', linha: 'rgba(246, 233, 210, .10)',
  };
  CO.fonte = coVar('--fonte', 'system-ui, sans-serif'); CO.fonteTit = coVar('--fonte-tit', CO.fonte);
}
const coHex = (ctx, x, y, r) => { ctx.beginPath(); for (let i = 0; i < 6; i++) { const a = Math.PI / 180 * (60 * i - 30); const px = x + r * Math.cos(a), py = y + r * Math.sin(a); i ? ctx.lineTo(px, py) : ctx.moveTo(px, py); } ctx.closePath(); };
const coRect = (ctx, x, y, w, h, r) => { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); };
function coRgba(hex, a) { const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i.exec(String(hex).trim()); if (!m) return hex; return `rgba(${parseInt(m[1], 16)}, ${parseInt(m[2], 16)}, ${parseInt(m[3], 16)}, ${a})`; }
function coImg(url) {
  if (!url) return null;
  let i = CO.imgs.get(url); if (i) return i.ok ? i.img : null;
  i = { img: new Image(), ok: false }; i.img.onload = () => { i.ok = true; }; i.img.src = url; CO.imgs.set(url, i); return null;
}
function coCortar(ctx, s, max) { s = String(s || ''); if (ctx.measureText(s).width <= max) return s; while (s.length > 1 && ctx.measureText(`${s}…`).width > max) s = s.slice(0, -1); return `${s}…`; }
const coChave = (cid, id) => `${cid}:${id}`;
const coAgora = () => performance.now() / 1000;
const coEase = (t) => (t < .5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
const coAleat = (a, b) => a + Math.random() * (b - a);
// espiral de anéis em coordenadas axiais: 0 é o centro do favo; 1..6 o primeiro anel; e assim por diante
function espiralHex(n) {
  const out = [[0, 0]]; const dirs = [[1, 0], [0, 1], [-1, 1], [-1, 0], [0, -1], [1, -1]];
  // cada anel começa no topo (0, -anel) e anda os seis lados na ordem das direções; assim o passeio fecha sem repetir casa
  for (let anel = 1; out.length < n; anel++) { let q = 0, r = -anel; for (let lado = 0; lado < 6 && out.length < n; lado++) for (let k = 0; k < anel && out.length < n; k++) { out.push([q, r]); q += dirs[lado][0]; r += dirs[lado][1]; } }
  return out.slice(0, n);
}
const axialParaXY = (q, r, R) => [R * Math.sqrt(3) * (q + r / 2), R * 1.5 * r];
const aneisPara = (k) => { let r = 0; while (1 + 3 * r * (r + 1) < k) r++; return r; };

/* ------------------------------------------------------------ montagem: equipes viram favos, agentes viram células e abelhas */
function coMontar() {
  const p = projetoAtual(); if (!p) return;
  CO.equipes = equipesDoProjeto(p);
  const n = CO.equipes.length;
  const grupos = CO.equipes.map((eq) => {
    const j = PJ[eq.cid] || {};
    const membros = (j.roster || []).filter((a) => !(a.sistema || a.id === 'mcp') || eq.cid === p.id);   // Cris e Max só no favo principal
    const lider = j.lider || 'po';
    const ordem = [...membros].sort((a, b) => (a.id === lider ? -1 : b.id === lider ? 1 : 0));
    return { eq, ordem, lider, raio: (aneisPara(ordem.length + (n === 1 ? 1 : 0)) + 1) * PASSO * 1.75 + 8 };
  });
  const antigas = CO.celulas; CO.celulas = new Map(); CO.favos = [];
  CO.rainha.r = HEX_R * 1.6; CO.rainha.x = 0; CO.rainha.y = 0;
  // Formação: a rainha no centro; um anel de lideranças (uma por equipe) ligadas a ela; e cada equipe dentro de um hexágono grande,
  // com contorno e preenchimento leve, atrás da sua liderança. Com mais equipes, os hexágonos ocupam anéis mais externos.
  const R_LIDER = HEX_R * 1.2;
  const anelLider = CO.rainha.r + R_LIDER + 54;
  const CAB = 30;   // faixa do nome dentro do hexágono da equipe
  const tam = grupos.map((g) => { const k = Math.max(1, g.ordem.length - 1); const a = aneisPara(k); return a * PASSO * Math.sqrt(3) + HEX_R + 26 + CAB / 2; });
  const maior = Math.max(...tam, HEX_R * 2.5);
  // anéis de equipes: cada anel recebe quantas couberem sem se tocar; os raios crescem com o maior hexágono
  const aneisEq = []; let resto = grupos.map((g, i) => i); let R = anelLider + R_LIDER + 40 + maior;
  while (resto.length) {
    const cabem = Math.max(1, Math.floor(Math.PI / Math.asin(Math.min(1, (maior + 28) / R))));
    aneisEq.push({ R, idx: resto.slice(0, cabem) }); resto = resto.slice(cabem); R += 2 * maior + 90;
  }
  aneisEq.forEach((anel, ai) => {
    const m = anel.idx.length;
    anel.idx.forEach((gi, k) => {
      const g = grupos[gi];
      const ang = m === 1 ? (n === 1 ? -Math.PI / 2 : Math.PI) : m === 2 && ai === 0 ? (k === 0 ? Math.PI : 0) : -Math.PI / 2 + (k * TAU) / m + (ai % 2 ? Math.PI / m : 0);
      const fx = Math.cos(ang) * anel.R, fy = Math.sin(ang) * anel.R;
      const liderCel = { key: coChave(g.eq.cid, g.ordem[0].id), cid: g.eq.cid, agente: g.ordem[0], equipe: g.eq, x: Math.cos(ang) * anelLider, y: Math.sin(ang) * anelLider, lider: g.ordem[0].id === g.lider, r: R_LIDER, favo: null, pulso: 0, ang };
      const demais = g.ordem.slice(1); const esp = espiralHex(Math.max(demais.length, 1));
      const celulas = [liderCel, ...demais.map((a, q) => { const [dx, dy] = axialParaXY(esp[q][0], esp[q][1], PASSO); return { key: coChave(g.eq.cid, a.id), cid: g.eq.cid, agente: a, equipe: g.eq, x: fx + dx, y: fy + dy + CAB / 2, lider: a.id === g.lider, r: HEX_R, favo: null, pulso: 0 }; })];
      // cera: completa o último anel do favo
      const anelN = aneisPara(Math.max(demais.length, 1)); const usados = new Set(esp.map((o) => o.join(',')));
      const vazias = espiralHex(1 + 3 * anelN * (anelN + 1)).filter((o) => !usados.has(o.join(','))).map((o) => { const [dx, dy] = axialParaXY(o[0], o[1], PASSO); return [fx + dx, fy + dy + CAB / 2]; });
      const favo = { eq: g.eq, cid: g.eq.cid, nome: g.eq.nome, x: fx, y: fy, R: tam[gi], raio: tam[gi], celulas, vazias, lider: g.lider, ang, tom: gi % 2 ? 'violeta' : 'ambar' };
      for (const c of celulas) { c.favo = favo; CO.celulas.set(c.key, c); }
      CO.favos.push(favo);
    });
  });

  // Canteiro: três áreas abaixo da colmeia. Os cards do quadro ficam aqui (não em cima dos agentes); a abelha vai até o card para
  // trabalhar e carrega o card de uma área para a outra. Concluído fica 30 minutos e some, para liberar espaço.
  {
    const baixo = Math.max(CO.rainha.r, ...CO.favos.map((f) => f.y + f.R)) + 150;
    const w = ZONA.cols * ZONA.sw + ZONA.pad * 2, h0 = ZONA.cab + ZONA.pad * 2 + 3 * ZONA.sh;
    const total = 3 * w + 2 * 44;
    const defs = [['fazer', 'A fazer', 'suave'], ['andamento', 'Em andamento', 'ambar'], ['concluido', 'Concluído', 'verde']];
    CO.zonas = {};
    defs.forEach(([id, titulo, tom], i) => { CO.zonas[id] = { id, titulo, tom, x: -total / 2 + i * (w + 44), y: baixo, w, h: h0, n: 0, extra: 0 }; });
  }
  // abelhas: uma por célula; quem já existia continua de onde estava
  const novas = new Map();
  for (const [k, c] of CO.celulas) {
    const b = CO.abelhas.get(k) || { key: k, x: c.x + 21, y: c.y - 7, ang: -Math.PI / 2, asa: 0, modo: 'repouso', base: 'repouso', fase: Math.random() * TAU, rota: null, fila: [], carga: null, balao: 0, estadoAnt: null, alvo: null };
    if (!antigas.has(k)) { b.x = c.x + 21; b.y = c.y - 7; }
    novas.set(k, b);
  }
  CO.abelhas = novas;
  CO.montadoPara = `${p.id}|${[...CO.celulas.keys()].join(',')}`;
}

/* ------------------------------------------------------------ leitura do estado: o que cada célula está fazendo agora */
function coCelulaPorNome(nome, cid) {
  const alvo = semAcento(String(nome || '').trim()); if (!alvo) return null;
  const bate = (c) => semAcento(c.agente.nome) === alvo || semAcento(primeiroNome(c.agente.nome)) === alvo || semAcento(c.agente.tokenNome || '') === alvo || c.agente.id === alvo;
  return [...CO.celulas.values()].find((c) => c.cid === cid && bate(c)) || [...CO.celulas.values()].find(bate) || null;
}
function coCardDe(c, pr) {
  const cs = PJ[c.cid]?.cartoes || [];
  return (pr?.card && cs.find((k) => k.id === pr.card)) || cs.find((k) => k.coluna === 'andamento' && k.dono === c.agente.id) || cs.find((k) => k.coluna === 'impedimento' && k.dono === c.agente.id) || null;
}
/** Situação de uma célula: estado da presença, card em mãos, bloqueio, a quem está ajudando. */
function coSituacao(c) {
  const pr = (PJ[c.cid]?.presenca || {})[c.agente.id] || null;
  const card = coCardDe(c, pr);
  const ajuda = pr?.estado === 'trabalhando' ? /^(?:consultando|respondendo|revisando|ajudando)\s+(.+)$/i.exec(pr.atividade || '') : null;
  const alvo = ajuda ? coCelulaPorNome(ajuda[1], c.cid) : null;
  const estado = card?.bloqueio ? 'bloqueado' : pr ? (pr.estado === 'trabalhando' ? 'trabalhando' : 'fila') : 'parado';
  return { pr, card, estado, ajudando: /^consultando/i.test(pr?.atividade || '') ? alvo : null, respondendo: /^respondendo/i.test(pr?.atividade || '') ? alvo : null, aguardando: !!card?.aguardando };
}
function coProgresso() {
  let tot = 0, ok = 0;
  for (const eq of CO.equipes) for (const k of PJ[eq.cid]?.cartoes || []) { tot++; if (k.coluna === 'concluido') ok++; }
  return tot ? ok / tot : 0;
}

/* ------------------------------------------------------------ registro de acontecimentos (canto da tela) */
function coRegistrar(texto, cor) {
  CO.registro.push({ t: coAgora(), texto, cor: cor || CO.cores.suave });
  if (CO.registro.length > 40) CO.registro.splice(0, CO.registro.length - 40);
  const el = CO.raiz?.querySelector('.co-registro'); if (!el) return;
  el.innerHTML = CO.registro.slice(-7).map((r) => `<div class="co-reg" style="--c:${esc(r.cor)}"><i></i>${esc(r.texto)}</div>`).join('');
}

/* ------------------------------------------------------------ movimento: voos, fios, ondas, partículas */
function coFio(de, para, cor, dur = 14, forca = 1) {
  if (!de || !para || de === para) return;
  const f = CO.fios.find((x) => x.de === de && x.para === para);
  const ate = coAgora() + dur;
  if (f) { f.ate = Math.max(f.ate, ate); f.forca = Math.min(2, f.forca + forca * .5); f.cor = cor || f.cor; return f; }
  const novo = { de, para, cor: cor || CO.cores.ambar, nasc: coAgora(), ate, forca, curva: coAleat(-.22, .22) };
  CO.fios.push(novo); return novo;
}
function coOnda(x, y, cor, r0 = HEX_R, r1 = HEX_R * 2.2, dur = .9) { CO.ondas.push({ x, y, cor, r0, r1, dur, t0: coAgora() }); }
function coParticulas(x, y, cor, n = 8, forca = 60, vida = .9) { for (let i = 0; i < n; i++) { const a = Math.random() * TAU, v = coAleat(.3, 1) * forca; CO.particulas.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, cor, t0: coAgora(), vida: vida * coAleat(.6, 1.2), r: coAleat(1.4, 3) }); } }
const coPonto = (key) => (key && typeof key === 'object' ? key : key === 'rainha' ? CO.rainha : String(key).startsWith('carta:') ? (CO.cartas.get(key.slice(6)) || null) : CO.celulas.get(key) || null);
/** A abelha de `deKey` voa até `paraKey` (célula ou 'rainha'), fica um instante e volta. carga: 'polen' | 'mel'. */
function coVoar(deKey, paraKey, cor, carga = 'polen') {
  const b = CO.abelhas.get(deKey), para = coPonto(paraKey); if (!b || !para) return;
  if (b.fila.length > 3) return;   // uma abelha não acumula viagens sem fim
  b.fila.push({ para: paraKey, cor: cor || CO.cores.ambar, carga });
  coFio(deKey, paraKey, cor, carga === 'mel' ? 10 : 16);
}
function polen(deKey, paraKey, cor) { coVoar(deKey, paraKey, cor); }   // nome antigo, mantido para quem chama de fora
function coIniciarRota(b, para, cor, carga, volta = false, missao = null) {
  const alvo = coPonto(para); if (!alvo) return false;
  const ponto = para && typeof para === 'object';
  const ax = alvo.x + (ponto || para === 'rainha' ? 0 : coAleat(-8, 8)), ay = alvo.y - (ponto ? 20 : para === 'rainha' ? CO.rainha.r + 10 : HEX_R + 6) + (ponto ? 0 : coAleat(-4, 4));
  const d = Math.hypot(ax - b.x, ay - b.y);
  const lado = Math.random() < .5 ? -1 : 1;
  b.rota = { x0: b.x, y0: b.y, x1: ax, y1: ay, cx: (b.x + ax) / 2 + (ay - b.y) * .28 * lado, cy: (b.y + ay) / 2 - (ax - b.x) * .28 * lado, t0: coAgora(), dur: Math.min(2.6, Math.max(.7, d / 260)), para, cor, carga, volta, missao };
  b.modo = 'voo'; return true;
}
/** A abelha do dono leva o card de onde está até a vaga nova no canteiro: vai até o card, pega, voa até a vaga, solta, volta. */
function coMissao(b, carta) {
  if (!b || !carta) return false;
  if (b.missao) return false;
  b.missao = { carta: carta.id, fase: 'ir' };
  return coIniciarRota(b, { x: carta.x, y: carta.y }, carta.cor, null, false, 'ir');
}

/* ------------------------------------------------------------ sincronização periódica com o estado do app */
function coSincronizar() {
  const agora = coAgora();
  const tot = { trabalhando: 0, fila: 0, bloqueado: 0, parado: 0 };
  for (const [k, c] of CO.celulas) {
    const s = coSituacao(c); c.sit = s; tot[s.estado]++;
    const b = CO.abelhas.get(k); if (!b) continue;
    // transições viram acontecimentos
    const ant = b.estadoAnt; b.estadoAnt = s.estado;
    if (ant && ant !== s.estado) {
      if (s.estado === 'trabalhando' && ant !== 'bloqueado') { coParticulas(c.x, c.y - HEX_R, c.agente.cor, 10, 50); coOnda(c.x, c.y, c.agente.cor); if (s.pr?.atividade && !/^(na fila|abrindo)/.test(s.pr.atividade)) coRegistrar(`${primeiroNome(c.agente.nome)}: ${s.pr.atividade}`, c.agente.cor); }
      if (s.estado === 'bloqueado') { coOnda(c.x, c.y, CO.cores.verm, HEX_R, HEX_R * 2.6, 1.2); coRegistrar(`${primeiroNome(c.agente.nome)} travou em ${s.card?.id || 'um card'}: ${String(s.card?.bloqueio || '').slice(0, 60)}`, CO.cores.verm); }
      if (ant === 'bloqueado' && s.estado !== 'bloqueado') { coOnda(c.x, c.y, CO.cores.verde); coRegistrar(`${primeiroNome(c.agente.nome)} destravou`, CO.cores.verde); }
    }
    // modo base da abelha
    let base = s.estado === 'trabalhando' ? 'trabalho' : s.estado === 'fila' ? 'fila' : s.estado === 'bloqueado' ? 'bloqueado' : 'repouso';
    if (s.ajudando && s.ajudando.key !== k) { base = 'ajuda'; b.alvo = s.ajudando.key; coFio(k, s.ajudando.key, c.agente.cor, 1.5, .4); if (b.base !== 'ajuda') coRegistrar(`${primeiroNome(c.agente.nome)} foi falar com ${primeiroNome(s.ajudando.agente.nome)}`, c.agente.cor); }
    else if (s.respondendo && s.respondendo.key !== k) coFio(s.respondendo.key, k, s.respondendo.agente.cor, 1.5, .4);
    if (s.aguardando) coFio(k, 'rainha', CO.cores.ambar, 1.5, .3);
    // trabalhando num card que está no canteiro: a abelha vai até ele e fica lá, com um fio até a célula dela
    b.carta = s.card && CO.cartas.has(`${c.cid}:${s.card.id}`) && (base === 'trabalho' || base === 'bloqueado') ? `${c.cid}:${s.card.id}` : null;
    if (b.carta && base === 'trabalho') coFio(k, `carta:${b.carta}`, c.agente.cor, 1.5, .5);
    b.base = base; if (b.modo !== 'voo' && b.modo !== 'pouso') b.modo = base;
  }
  CO.tot = tot; CO.progresso = coProgresso();
  // diferenças no quadro: quem pegou, quem concluiu, o que bloqueou
  for (const eq of CO.equipes) for (const k of PJ[eq.cid]?.cartoes || []) {
    const id = `${eq.cid}:${k.id}`; const ant = CO.cards.get(id);
    const atual = { coluna: k.coluna, bloqueio: !!k.bloqueio, aguardando: !!k.aguardando, dono: k.dono };
    CO.cards.set(id, atual);
    if (!ant || !CO.cardsProntos) continue;
    const dono = k.dono ? coChave(eq.cid, k.dono) : null; const cel = dono && CO.celulas.get(dono);
    if (ant.coluna !== k.coluna) {
      if (k.coluna === 'concluido' && cel) coRegistrar(`${primeiroNome(cel.agente.nome)} entregou ${k.id}: ${k.titulo}`, CO.cores.ouro);
      else if (k.coluna === 'andamento' && cel) { coOnda(cel.x, cel.y, cel.agente.cor); coRegistrar(`${primeiroNome(cel.agente.nome)} pegou ${k.id}: ${k.titulo}`, cel.agente.cor); }
      else if (['revisao', 'qa'].includes(k.coluna) && cel) coRegistrar(`${k.id} foi para ${k.coluna === 'qa' ? 'QA' : 'revisão'}`, CO.cores.violeta);
    }
    if (!ant.aguardando && k.aguardando && cel) { coOnda(cel.x, cel.y, CO.cores.ambar); coRegistrar(`${k.id} aguarda você`, CO.cores.ambar); }
  }
  coSincronizarCanteiro();
  CO.cardsProntos = true;
  // ligação de voz: fio dourado entre a rainha e quem está na chamada
  if (typeof CH !== 'undefined' && CH.aberta && CH.lider && CO.celulas.has(coChave(U.proj, CH.lider))) coFio('rainha', coChave(U.proj, CH.lider), CO.cores.ouro, 1.5, .6);
  // HUD
  const h = CO.raiz; if (h) {
    const set = (sel, v) => { const el = h.querySelector(sel); if (el) el.lastChild.textContent = v; };
    set('.co-stat.on', `${tot.trabalhando} trabalhando`); set('.co-stat.fila', `${tot.fila} na fila`); set('.co-stat.bloq', `${tot.bloqueado} ${tot.bloqueado === 1 ? 'bloqueada' : 'bloqueadas'}`); set('.co-stat.off', `${tot.parado} em repouso`);
    const col = h.querySelector('.co-colheita'); if (col) { col.querySelector('b').textContent = `${Math.round(CO.progresso * 100)}%`; col.querySelector('i').style.width = `${Math.round(CO.progresso * 100)}%`; }
    h.querySelector('.co-stat.bloq')?.classList.toggle('tem', tot.bloqueado > 0);
  }
  void agora;
}

/* ------------------------------------------------------------ canteiro: cards nas áreas, vagas e mudanças de área */
function coSincronizarCanteiro() {
  if (!CO.zonas) return;
  const agora = coAgora(); const vistos = new Set();
  for (const eq of CO.equipes) for (const k of PJ[eq.cid]?.cartoes || []) {
    if (k.arquivado) continue;
    const id = `${eq.cid}:${k.id}`; let carta = CO.cartas.get(id);
    // concluído: lembra quando concluiu (ao abrir, usa a data do card) para somer depois de meia hora
    if (k.coluna === 'concluido' && !carta?.concluidoEm) { const ha = (Date.now() - Date.parse(k.atualizado || Date.now())) / 1000; if (ha > CONCLUIDO_FICA_S) continue; if (carta) carta.concluidoEm = agora - ha; }
    const zona = ['backlog', 'pronto'].includes(k.coluna) ? (k.coluna === 'pronto' || k.dono ? 'fazer' : null) : ['andamento', 'revisao', 'qa', 'impedimento'].includes(k.coluna) ? 'andamento' : k.coluna === 'concluido' ? 'concluido' : null;
    if (!zona) continue;
    if (carta && carta.zona === 'concluido' && agora - carta.concluidoEm > CONCLUIDO_FICA_S) continue;
    vistos.add(id);
    const cel = k.dono ? CO.celulas.get(coChave(eq.cid, k.dono)) : null;
    const cor = cel?.agente.cor || CO.cores.ambar;
    if (!carta) {
      const z = CO.zonas[zona];
      carta = { id, cid: eq.cid, card: k, zona, cor, x: z.x + z.w / 2, y: z.y + z.h / 2, tx: 0, ty: 0, portador: null, nasc: agora, alfa: 0, concluidoEm: k.coluna === 'concluido' ? agora - (Date.now() - Date.parse(k.atualizado || Date.now())) / 1000 : null };
      if (CO.cardsProntos && cel) { const b = CO.abelhas.get(cel.key); if (b && zona !== 'concluido') { carta.x = cel.x; carta.y = cel.y; } }   // card novo "sai" da célula do dono
      CO.cartas.set(id, carta);
    }
    carta.card = k; carta.cor = cor; carta.dono = cel?.key || null;
    if (carta.zona !== zona) {
      const de = carta.zona; carta.zona = zona; carta.mudouEm = agora;
      if (zona === 'concluido') carta.concluidoEm = agora;
      // quem leva o card: a abelha do dono (se não houver, o card vai sozinho)
      const b = cel && CO.abelhas.get(cel.key);
      if (b && CO.cardsProntos) { carta.pendente = { de, para: zona }; coMissao(b, carta); }
    }
  }
  // cards que saíram do quadro (ou passaram da meia hora): somem suavemente
  for (const [id, carta] of CO.cartas) { if (!vistos.has(id) && !carta.sumindo) { carta.sumindo = agora; } if (carta.sumindo && agora - carta.sumindo > .8) { if (carta.portador) { const b = CO.abelhas.get(carta.portador); if (b) { b.missao = null; b.modo = b.base; } } CO.cartas.delete(id); } }
  // vagas por área: ordem estável (em andamento primeiro os bloqueados, depois por atualização; concluído, o mais novo primeiro)
  for (const z of Object.values(CO.zonas)) {
    const lista = [...CO.cartas.values()].filter((c) => c.zona === z.id && !c.sumindo);
    if (z.id === 'concluido') lista.sort((a, b) => (b.concluidoEm || 0) - (a.concluidoEm || 0));
    else if (z.id === 'andamento') lista.sort((a, b) => Number(!!b.card.bloqueio) - Number(!!a.card.bloqueio) || String(a.card.atualizado).localeCompare(String(b.card.atualizado)));
    else lista.sort((a, b) => Number(b.card.coluna === 'pronto') - Number(a.card.coluna === 'pronto') || Number(b.card.prioridade === 'alta') - Number(a.card.prioridade === 'alta') || String(a.card.atualizado).localeCompare(String(b.card.atualizado)));
    const max = ZONA.cols * ZONA.maxLinhas; z.n = lista.length; z.extra = Math.max(0, lista.length - max);
    const linhas = Math.max(3, Math.min(ZONA.maxLinhas, Math.ceil(lista.length / ZONA.cols)));
    z.h = ZONA.cab + ZONA.pad * 2 + linhas * ZONA.sh;
    lista.forEach((c, i) => { if (i >= max) { c.oculta = true; return; } c.oculta = false; const col = i % ZONA.cols, lin = Math.floor(i / ZONA.cols); c.tx = z.x + ZONA.pad + col * ZONA.sw + ZONA.sw / 2; c.ty = z.y + ZONA.cab + ZONA.pad + lin * ZONA.sh + ZONA.sh / 2; });
  }
}

/* ------------------------------------------------------------ física das abelhas */
function coMoverAbelha(b, dt) {
  const c = CO.celulas.get(b.key); if (!c) return;
  const t = CO.t + b.fase;
  if (CO.puxando?.key === b.key) {   // a Game Director está puxando esta abelha pelo fio
    const f = 1 - Math.exp(-dt * 14); const ox = b.x, oy = b.y;
    b.x += (CO.puxando.x - b.x) * f; b.y += (CO.puxando.y - 10 - b.y) * f; b.asa += dt * 60;
    const vx = b.x - ox, vy = b.y - oy; if (Math.hypot(vx, vy) > .2) b.ang += ((Math.atan2(vy, vx) - b.ang + Math.PI * 3) % TAU - Math.PI) * Math.min(1, dt * 10);
    return;
  }
  if (b.modo === 'voo' && b.rota) {
    const r = b.rota; const u = Math.min(1, (coAgora() - r.t0) / r.dur), e = coEase(u);
    const mt = 1 - e; const nx = mt * mt * r.x0 + 2 * mt * e * r.cx + e * e * r.x1, ny = mt * mt * r.y0 + 2 * mt * e * r.cy + e * e * r.y1;
    b.ang = Math.atan2(ny - b.y, nx - b.x) || b.ang; b.x = nx; b.y = ny; b.asa += dt * 60;
    if (Math.random() < dt * 18) CO.particulas.push({ x: b.x - Math.cos(b.ang) * 6, y: b.y - Math.sin(b.ang) * 6, vx: coAleat(-6, 6), vy: coAleat(-6, 6), cor: r.cor, t0: coAgora(), vida: .7, r: coAleat(.8, 1.8) });
    if (u >= 1 && r.missao) {   // missão de carregar card: ir até ele, pegar, levar até a vaga, soltar, voltar
      const carta = CO.cartas.get(b.missao?.carta);
      if (!carta) { b.missao = null; b.rota = null; b.modo = b.base; return; }
      if (r.missao === 'ir') { carta.portador = b.key; b.missao.fase = 'levar'; coIniciarRota(b, { x: carta.tx, y: carta.ty }, carta.cor, null, false, 'levar'); return; }
      if (r.missao === 'levar') {
        carta.portador = null; carta.x = carta.tx; carta.y = carta.ty; carta.pendente = null; b.missao = null; b.rota = null;
        const z = CO.zonas[carta.zona]; const tom = z?.tom === 'verde' ? CO.cores.verde : z?.tom === 'ambar' ? CO.cores.ambar : CO.cores.suave;
        coParticulas(carta.x, carta.y, carta.zona === 'concluido' ? CO.cores.ouro : tom, carta.zona === 'concluido' ? 22 : 8, carta.zona === 'concluido' ? 90 : 40, 1);
        if (carta.zona === 'concluido') { CO.entregas++; CO.rainha.pulso = 1; carta.brilho = coAgora(); }
        b.modo = 'pouso'; b.pousoAte = coAgora() + .5; b.balao = 0; b.rotaVolta = { cor: carta.cor };
        return;
      }
    }
    if (u >= 1) {
      const alvo = coPonto(r.para);
      if (!r.volta) {   // chegou: pólen entregue, onda no destino, um instante de conversa, depois volta
        if (alvo) { coOnda(alvo.x, alvo.y, r.cor, r.para === 'rainha' ? CO.rainha.r : HEX_R, (r.para === 'rainha' ? CO.rainha.r : HEX_R) * 1.9); coParticulas(b.x, b.y, r.cor, r.carga === 'mel' ? 16 : 6, r.carga === 'mel' ? 70 : 35); }
        if (r.carga === 'mel') { CO.entregas++; CO.rainha.pulso = 1; }
        b.modo = 'pouso'; b.balao = coAgora() + (r.carga === 'mel' ? .6 : 1.1); b.pousoAte = b.balao; b.rotaVolta = { cor: r.cor }; b.rota = null;
      } else { b.rota = null; b.modo = b.base; }
    }
    return;
  }
  if (b.modo === 'pouso') { b.asa += dt * 30; b.y += Math.sin(t * 9) * dt * 6; if (coAgora() >= b.pousoAte) { if (b.fila.length) { const p = b.fila.shift(); coIniciarRota(b, p.para, p.cor, p.carga); } else coIniciarRota(b, b.key, b.rotaVolta?.cor || CO.cores.ambar, null, true); } return; }
  if (b.fila.length && b.modo !== 'voo') { const p = b.fila.shift(); if (coIniciarRota(b, p.para, p.cor, p.carga)) return; }
  // alvo do modo
  let tx = c.x, ty = c.y + 8, k = 6, bate = 0;
  const carta = b.carta ? CO.cartas.get(b.carta) : null;
  if (b.modo === 'trabalho' && carta && !carta.oculta) { tx = carta.x + Math.sin(t * 1.3) * 10; ty = carta.y - 24 + Math.cos(t * 2.1) * 4; bate = 55; k = 3; }   // trabalha em cima do card, no canteiro
  else if (b.modo === 'bloqueado' && carta && !carta.oculta) { tx = carta.x + 48 + Math.sin(t * 14) * 1.2; ty = carta.y - 6; bate = 6; k = 3; }
  else if (b.modo === 'trabalho') { tx = c.x + Math.sin(t * 1.3) * 9; ty = c.y - HEX_R * .95 + Math.cos(t * 2.1) * 4; bate = 55; }
  else if (b.modo === 'fila') { const a = t * .9; tx = c.x + Math.cos(a) * (HEX_R + 9); ty = c.y + Math.sin(a) * (HEX_R + 9) * .8; bate = 40; k = 8; }
  else if (b.modo === 'ajuda') { const al = coPonto(b.alvo); if (al) { const dx = c.x - al.x, dy = c.y - al.y, d = Math.hypot(dx, dy) || 1; tx = al.x + (dx / d) * (HEX_R + 12) + Math.sin(t * 1.7) * 4; ty = al.y + (dy / d) * (HEX_R + 12) - 10 + Math.cos(t * 2.3) * 3; bate = 50; } }
  else if (b.modo === 'bloqueado') { tx = c.x + 21 + Math.sin(t * 14) * 1.2; ty = c.y - 7; bate = 6; }
  else { tx = c.x + 21; ty = c.y - 7; bate = 0; }   // repouso: encostada ao lado da foto, sem cobrir o nome
  const f = 1 - Math.exp(-dt * k); const ox = b.x, oy = b.y;
  b.x += (tx - b.x) * f; b.y += (ty - b.y) * f;
  const vx = b.x - ox, vy = b.y - oy; if (Math.hypot(vx, vy) > .15) b.ang += ((Math.atan2(vy, vx) - b.ang + Math.PI * 3) % TAU - Math.PI) * Math.min(1, dt * 8);
  b.asa += dt * bate;
}

/* ------------------------------------------------------------ desenho */
function coDesenhar() {
  const { ctx, cam, W, H, cores } = CO; const z = cam.z;
  ctx.setTransform(CO.dpr, 0, 0, CO.dpr, 0, 0); ctx.clearRect(0, 0, W, H);
  ctx.setTransform(CO.dpr * z, 0, 0, CO.dpr * z, CO.dpr * (W / 2 - cam.x * z), CO.dpr * (H / 2 - cam.y * z));
  const vis = { x0: cam.x - W / 2 / z, y0: cam.y - H / 2 / z, x1: cam.x + W / 2 / z, y1: cam.y + H / 2 / z };
  const dentro = (x, y, m = 80) => x > vis.x0 - m && x < vis.x1 + m && y > vis.y0 - m && y < vis.y1 + m;
  CO.hits = [];
  const t = CO.t;
  // fundo: grade de favo infinita, bem sutil
  if (z > .28) {
    const G = HEX_R * 2.3; const gw = G * Math.sqrt(3), gh = G * 1.5;
    ctx.strokeStyle = cores.linha; ctx.globalAlpha = Math.min(.5, (z - .28) * 1.4); ctx.lineWidth = 1 / z;
    const r0 = Math.floor(vis.y0 / gh) - 1, r1 = Math.ceil(vis.y1 / gh) + 1; let n = 0;
    ctx.beginPath();
    for (let r = r0; r <= r1 && n < 2500; r++) { const off = (r % 2) * gw / 2; const q0 = Math.floor((vis.x0 - off) / gw) - 1, q1 = Math.ceil((vis.x1 - off) / gw) + 1; for (let q = q0; q <= q1 && n < 2500; q++, n++) { const x = q * gw + off, y = r * gh; for (let i = 0; i < 6; i++) { const a = Math.PI / 180 * (60 * i - 30); const px = x + (G - 3) * Math.cos(a), py = y + (G - 3) * Math.sin(a); i ? ctx.lineTo(px, py) : ctx.moveTo(px, py); } ctx.closePath(); } }
    ctx.stroke(); ctx.globalAlpha = 1;
  }
  // equipes: cada uma dentro de um hexágono grande, com contorno e preenchimento leve, o nome no alto e a cera completando o favo
  for (const f of CO.favos) {
    if (!dentro(f.x, f.y, f.R + 80)) continue;
    const tom = f.tom === 'violeta' ? cores.violeta : cores.ambar;
    const ativos = f.celulas.filter((c) => c.sit?.estado === 'trabalhando').length;
    ctx.fillStyle = coRgba(tom, ativos ? .07 : .045); coHex(ctx, f.x, f.y, f.R); ctx.fill();
    ctx.strokeStyle = coRgba(tom, ativos ? .75 : .42); ctx.lineWidth = 1.6 / Math.sqrt(z); coHex(ctx, f.x, f.y, f.R); ctx.stroke();
    ctx.strokeStyle = coRgba(tom, .12); ctx.lineWidth = 6 / Math.sqrt(z); coHex(ctx, f.x, f.y, f.R + 4); ctx.stroke();
    CO.hits.push({ tipo: 'equipe', favo: f, x: f.x - f.R * .62, y: f.y - f.R + 2, w: f.R * 1.24, h: 46 });   // a faixa do nome: arrastar por ela move a equipe (o resto do fundo move a câmera)
    ctx.fillStyle = cores.cera;
    for (const [x, y] of f.vazias) { coHex(ctx, x, y, HEX_R - 1); ctx.fill(); }
    if (z > .22) {
      const ly = f.y - f.R + 24;
      ctx.fillStyle = cores.texto; ctx.font = `700 ${Math.max(11, Math.min(16, 12 / z))}px ${CO.fonte}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.letterSpacing = '.1em';
      const nome = coCortar(ctx, String(f.nome).toUpperCase(), f.R * 1.5); ctx.fillText(nome, f.x, ly); ctx.letterSpacing = '0px';
      ctx.fillStyle = coRgba(tom, .9); ctx.font = `600 ${Math.max(9, Math.min(12, 9.5 / z))}px ${CO.fonte}`;
      ctx.fillText(`${f.celulas.length} ${f.celulas.length === 1 ? 'agente' : 'agentes'}${ativos ? `, ${ativos} em ação` : ''}`, f.x, ly + 15);
      const w = ctx.measureText(nome).width; CO.hits.push({ tipo: 'favo', favo: f, x: f.x - w / 2 - 8, y: ly - 12, w: w + 16, h: 30 });
    }
  }
  // estrutura: rainha ligada a cada liderança, e cada liderança ligada ao hexágono da sua equipe (com um nó em cada ponta)
  for (const f of CO.favos) {
    const l = f.celulas[0]; if (!l) continue;
    const tom = f.tom === 'violeta' ? cores.violeta : cores.ambar;
    ctx.strokeStyle = coRgba(cores.ouro, .35); ctx.lineWidth = 1.2 / Math.sqrt(z);
    ctx.beginPath(); ctx.moveTo(CO.rainha.x, CO.rainha.y); ctx.lineTo(l.x, l.y); ctx.stroke();
    const d = Math.hypot(f.x - l.x, f.y - l.y) || 1, ux = (f.x - l.x) / d, uy = (f.y - l.y) / d;
    const bx = f.x - ux * f.R, by = f.y - uy * f.R;   // borda do hexágono da equipe, do lado da liderança
    ctx.strokeStyle = coRgba(tom, .5); ctx.beginPath(); ctx.moveTo(l.x + ux * l.r, l.y + uy * l.r); ctx.lineTo(bx, by); ctx.stroke();
    ctx.fillStyle = cores.ouro; ctx.beginPath(); ctx.arc(bx, by, 3 / Math.sqrt(z), 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.arc(CO.rainha.x + (l.x - CO.rainha.x) / Math.hypot(l.x, l.y) * CO.rainha.r, CO.rainha.y + (l.y - CO.rainha.y) / Math.hypot(l.x, l.y) * CO.rainha.r, 3 / Math.sqrt(z), 0, TAU); ctx.fill();
  }
  // fios de comunicação
  const agora = coAgora();
  CO.fios = CO.fios.filter((f) => f.ate > agora);
  for (const f of CO.fios) {
    const a = coPonto(f.de), b = coPonto(f.para); if (!a || !b) continue;
    const resta = Math.min(1, (f.ate - agora) / 3), vivo = Math.min(1, (agora - f.nasc) / .4);
    const mx = (a.x + b.x) / 2 + (b.y - a.y) * f.curva, my = (a.y + b.y) / 2 - (b.x - a.x) * f.curva;
    ctx.globalAlpha = .12 + .5 * Math.min(1, f.forca) * resta * vivo;
    ctx.strokeStyle = f.cor; ctx.lineWidth = (1.1 + .6 * Math.min(1, f.forca)) / Math.sqrt(z);
    ctx.setLineDash([5, 9]); ctx.lineDashOffset = -t * 40;
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.quadraticCurveTo(mx, my, b.x, b.y); ctx.stroke();
    ctx.setLineDash([]); ctx.globalAlpha = 1;
  }
  // ondas
  CO.ondas = CO.ondas.filter((o) => agora - o.t0 < o.dur);
  for (const o of CO.ondas) { const u = (agora - o.t0) / o.dur; ctx.globalAlpha = (1 - u) * .7; ctx.strokeStyle = o.cor; ctx.lineWidth = 2 / z; coHex(ctx, o.x, o.y, o.r0 + (o.r1 - o.r0) * coEase(u)); ctx.stroke(); }
  ctx.globalAlpha = 1;
  // células
  const detalhe = z > .55, rotulos = z > .38; const cards = [];
  for (const c of CO.celulas.values()) {
    if (!dentro(c.x, c.y)) continue;
    const s = c.sit || { estado: 'parado' }; const cor = c.agente.cor || cores.ambar; const R = c.r || HEX_R;
    const pulso = .5 + .5 * Math.sin(t * 3.2 + c.x * .01);
    // brilho de quem trabalha
    if (s.estado === 'trabalhando' || s.estado === 'bloqueado') { const g = s.estado === 'bloqueado' ? cores.verm : cor; ctx.globalAlpha = .10 + .14 * pulso; ctx.fillStyle = g; coHex(ctx, c.x, c.y, R + 9 + pulso * 3); ctx.fill(); ctx.globalAlpha = 1; }
    // corpo da célula
    ctx.fillStyle = s.estado === 'trabalhando' ? coRgba(cor, .20) : s.estado === 'bloqueado' ? coRgba(cores.verm, .16) : s.estado === 'fila' ? cores.bg3 : cores.bg2;
    coHex(ctx, c.x, c.y, R); ctx.fill();
    ctx.fillStyle = s.estado === 'parado' ? cores.bg3 : 'transparent'; if (s.estado === 'parado') { ctx.globalAlpha = .55; ctx.fill(); ctx.globalAlpha = 1; }
    ctx.lineWidth = (s.estado === 'parado' ? 1 : 1.6) / Math.sqrt(z);
    ctx.strokeStyle = s.estado === 'trabalhando' ? cor : s.estado === 'bloqueado' ? cores.verm : s.estado === 'fila' ? coRgba(cores.violeta, .7) : cores.linha;
    if (s.estado === 'fila') { ctx.setLineDash([4, 6]); ctx.lineDashOffset = -t * 18; }
    coHex(ctx, c.x, c.y, R); ctx.stroke(); ctx.setLineDash([]);
    // liderança: coroa de favo dourada em volta da célula, sempre visível
    if (c.lider) { ctx.strokeStyle = cores.ouro; ctx.lineWidth = 2 / Math.sqrt(z); ctx.globalAlpha = .9; coHex(ctx, c.x, c.y, R + 4); ctx.stroke(); ctx.globalAlpha = .35; ctx.lineWidth = 1 / Math.sqrt(z); coHex(ctx, c.x, c.y, R + 8); ctx.stroke(); ctx.globalAlpha = 1; }
    if (c === CO.hover?.cel) { ctx.strokeStyle = cores.texto; ctx.lineWidth = 1.5 / Math.sqrt(z); coHex(ctx, c.x, c.y, R + 3); ctx.stroke(); }
    // foto ou iniciais
    const alfa = s.estado === 'parado' ? .5 : 1; ctx.globalAlpha = alfa;
    const img = detalhe ? coImg(c.agente.foto || (typeof avatarPadrao === 'function' ? avatarPadrao(c.agente.id) : null)) : null; const fy = c.y - (rotulos ? 6 : 0), fr = (rotulos ? 14 : 17) * (c.lider ? 1.3 : 1);
    if (img) { ctx.save(); ctx.beginPath(); ctx.arc(c.x, fy, fr, 0, TAU); ctx.clip(); ctx.drawImage(img, c.x - fr, fy - fr, fr * 2, fr * 2); ctx.restore(); }
    else { ctx.fillStyle = cor; ctx.beginPath(); ctx.arc(c.x, fy, fr - 1, 0, TAU); ctx.fill(); if (rotulos) { ctx.fillStyle = '#1B1200'; ctx.font = `700 11px ${CO.fonte}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(iniciais(c.agente.nome), c.x, fy + .5); } }
    if (c.lider) { ctx.fillStyle = cores.ouro; const cy2 = fy - fr - 2; ctx.beginPath(); ctx.moveTo(c.x - 6, cy2 + 3); ctx.lineTo(c.x - 6, cy2 - 3); ctx.lineTo(c.x - 3, cy2); ctx.lineTo(c.x, cy2 - 4.5); ctx.lineTo(c.x + 3, cy2); ctx.lineTo(c.x + 6, cy2 - 3); ctx.lineTo(c.x + 6, cy2 + 3); ctx.closePath(); ctx.fill(); }
    // nome e atividade
    if (rotulos) {
      ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
      ctx.fillStyle = s.estado === 'trabalhando' ? cores.texto : cores.suave; ctx.font = `600 10.5px ${CO.fonte}`; ctx.fillText(coCortar(ctx, primeiroNome(c.agente.nome), R * 1.7), c.x, c.y + (c.lider ? 24 : 18));
      ctx.font = c.lider ? `700 7px ${CO.fonte}` : `italic 8px ${CO.fonte}`; ctx.fillStyle = c.lider ? cores.ambar : cor;
      const sub = c.lider ? 'LEAD' : s.estado === 'trabalhando' ? coCortar(ctx, s.pr?.atividade || '', R * 1.65) : s.estado === 'fila' ? 'na fila' : '';
      if (sub) ctx.fillText(sub, c.x, c.y + (c.lider ? 34 : 28));
    }
    ctx.globalAlpha = 1;
    // sinais: bloqueio e aguardando
    if (s.estado === 'bloqueado' || s.aguardando) {
      const bx = c.x - R * .78, by = c.y - R * .55; const corS = s.estado === 'bloqueado' ? cores.verm : cores.ambar;
      ctx.fillStyle = corS; ctx.globalAlpha = .75 + .25 * pulso; ctx.beginPath(); ctx.arc(bx, by, 7, 0, TAU); ctx.fill(); ctx.globalAlpha = 1;
      ctx.fillStyle = '#1B1200'; ctx.font = `700 10px ${CO.fonte}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(s.estado === 'bloqueado' ? '!' : '?', bx, by + .5);
    }
    CO.hits.push({ tipo: 'cel', cel: c, x: c.x - R, y: c.y - R, w: R * 2, h: R * 2 });
  }
  void cards;
  // canteiro: as três áreas e os cards nelas (os carregados seguem a abelha)
  coDesenharCanteiro(t, z, dentro);
  // rainha
  coDesenharRainha(t);
  // seleção (clique simples): anel claro em volta do agente ou do card
  if (CO.selecionado) {
    const s = CO.selecionado; ctx.strokeStyle = cores.texto; ctx.lineWidth = 1.6 / Math.sqrt(z); ctx.globalAlpha = .9;
    if (s.tipo === 'cel' && CO.celulas.has(s.cel.key)) coHex(ctx, s.cel.x, s.cel.y, (s.cel.r || HEX_R) + 6);
    else if (s.tipo === 'card') { const ct = CO.cartas.get(`${s.cid}:${s.card.id}`); if (ct) coRect(ctx, ct.x - ZONA.cw / 2 - 4, ct.y - ZONA.ch / 2 - 4, ZONA.cw + 8, ZONA.ch + 8, 8); else CO.selecionado = null; }
    else if (s.tipo === 'rainha') coHex(ctx, CO.rainha.x, CO.rainha.y, CO.rainha.r + 10);
    if (CO.selecionado) ctx.stroke(); ctx.globalAlpha = 1;
  }
  // fio de quem está sendo puxado pela Game Director, e o alvo onde ela pode soltar
  if (CO.puxando) {
    const c = CO.celulas.get(CO.puxando.key), b = CO.abelhas.get(CO.puxando.key);
    if (c && b) { ctx.strokeStyle = cores.ouro; ctx.lineWidth = 1.4 / Math.sqrt(z); ctx.setLineDash([4, 6]); ctx.lineDashOffset = -t * 30; ctx.beginPath(); ctx.moveTo(c.x, c.y); ctx.lineTo(b.x, b.y); ctx.stroke(); ctx.setLineDash([]); }
    const a = CO.alvoSolta;
    if (a) { ctx.strokeStyle = cores.ouro; ctx.lineWidth = 2.5 / Math.sqrt(z); ctx.globalAlpha = .6 + .4 * Math.sin(t * 6); if (a.tipo === 'cel') coHex(ctx, a.cel.x, a.cel.y, (a.cel.r || HEX_R) + 7); else coRect(ctx, a.x - 5, a.y - 5, a.w + 10, a.h + 10, 9); ctx.stroke(); ctx.globalAlpha = 1; }
  }
  // partículas
  CO.particulas = CO.particulas.filter((p) => agora - p.t0 < p.vida);
  for (const p of CO.particulas) { const u = (agora - p.t0) / p.vida; ctx.globalAlpha = (1 - u) * .9; ctx.fillStyle = p.cor; ctx.beginPath(); ctx.arc(p.x, p.y, p.r * (1 - u * .5) / Math.sqrt(z), 0, TAU); ctx.fill(); }
  ctx.globalAlpha = 1;
  // abelhas por cima de tudo
  for (const b of CO.abelhas.values()) { if (dentro(b.x, b.y)) coDesenharAbelha(b, z); }
}
function coDesenharCanteiro(t, z, dentro) {
  const { ctx, cores } = CO; if (!CO.zonas) return;
  const agora = coAgora();
  for (const zn of Object.values(CO.zonas)) {
    if (!dentro(zn.x + zn.w / 2, zn.y + zn.h / 2, Math.max(zn.w, zn.h))) continue;
    const tom = zn.tom === 'verde' ? cores.verde : zn.tom === 'ambar' ? cores.ambar : cores.suave;
    const vivo = zn.id === 'andamento' && zn.n > 0;
    ctx.fillStyle = coRgba(zn.tom === 'suave' ? '#F3EAD9' : tom, vivo ? .06 : .035); coRect(ctx, zn.x, zn.y, zn.w, zn.h, 18); ctx.fill();
    ctx.strokeStyle = coRgba(zn.tom === 'suave' ? '#F3EAD9' : tom, vivo ? .55 : .25); ctx.lineWidth = 1.4 / Math.sqrt(z); coRect(ctx, zn.x, zn.y, zn.w, zn.h, 18); ctx.stroke();
    // filete de LED no topo e o nome da área
    ctx.fillStyle = coRgba(tom, vivo ? .9 : .5); coRect(ctx, zn.x + 24, zn.y, zn.w - 48, 2, 1); ctx.fill();
    CO.hits.push({ tipo: 'zona', zona: zn, x: zn.x, y: zn.y, w: zn.w, h: ZONA.cab + 4 });   // arrastar pela faixa do título move o quadro (os cards vão junto)
    if (z > .25) {
      ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.letterSpacing = '.14em';
      ctx.fillStyle = cores.texto; ctx.font = `700 ${Math.max(10, Math.min(14, 11 / z))}px ${CO.fonte}`; ctx.fillText(zn.titulo.toUpperCase(), zn.x + ZONA.pad, zn.y + ZONA.cab / 2 + 1); ctx.letterSpacing = '0px';
      ctx.textAlign = 'right'; ctx.fillStyle = coRgba(tom, .95); ctx.font = `700 ${Math.max(10, Math.min(13, 11 / z))}px ${CO.fonte}`;
      ctx.fillText(zn.extra ? `${zn.n} (${zn.extra} fora da vista)` : String(zn.n), zn.x + zn.w - ZONA.pad, zn.y + ZONA.cab / 2 + 1); ctx.textAlign = 'center';
    }
    // vagas vazias: marcação sutil de favo, para a área parecer construída
    if (z > .45) { ctx.strokeStyle = 'rgba(243, 234, 217, .05)'; ctx.lineWidth = 1 / z; const linhas = Math.round((zn.h - ZONA.cab - ZONA.pad * 2) / ZONA.sh); for (let li = 0; li < linhas; li++) for (let co = 0; co < ZONA.cols; co++) { const cx = zn.x + ZONA.pad + co * ZONA.sw + ZONA.sw / 2, cy = zn.y + ZONA.cab + ZONA.pad + li * ZONA.sh + ZONA.sh / 2; coRect(ctx, cx - ZONA.cw / 2, cy - ZONA.ch / 2, ZONA.cw, ZONA.ch, 6); ctx.stroke(); } }
  }
  if (z <= .3) return;
  for (const carta of CO.cartas.values()) {
    if (carta.oculta) continue;
    // posição: carregada pela abelha, ou deslizando para a vaga
    if (carta.portador) { const b = CO.abelhas.get(carta.portador); if (b) { carta.x = b.x; carta.y = b.y + 20; } }
    else { const f = 1 - Math.exp(-(1 / 60) * 5); carta.x += (carta.tx - carta.x) * f; carta.y += (carta.ty - carta.y) * f; }
    carta.alfa = Math.min(1, (carta.alfa || 0) + .05);
    let alfa = carta.alfa; if (carta.sumindo) alfa *= Math.max(0, 1 - (agora - carta.sumindo) / .8);
    if (carta.zona === 'concluido' && carta.concluidoEm) { const resta = CONCLUIDO_FICA_S - (agora - carta.concluidoEm); if (resta < 180) alfa *= Math.max(.15, resta / 180); }
    if (!dentro(carta.x, carta.y)) continue;
    ctx.globalAlpha = alfa;
    if (carta.brilho && agora - carta.brilho < 1.2) { const u = (agora - carta.brilho) / 1.2; ctx.strokeStyle = cores.ouro; ctx.globalAlpha = alfa * (1 - u); ctx.lineWidth = 2 / z; coRect(ctx, carta.x - ZONA.cw / 2 - 8 * u * 3, carta.y - ZONA.ch / 2 - 8 * u * 3, ZONA.cw + 16 * u * 3, ZONA.ch + 16 * u * 3, 8); ctx.stroke(); ctx.globalAlpha = alfa; }
    coDesenharCard(carta.card, carta.x - ZONA.cw / 2, carta.y - ZONA.ch / 2, carta.cor, carta.cid, carta.portador ? .6 : 1);
    ctx.globalAlpha = 1;
  }
}
function coDesenharCard(k, x, y, cor, cid, escala = 1) {
  const { ctx, cores } = CO;
  const w = ZONA.cw, h = ZONA.ch; void escala;
  const borda = k.bloqueio ? cores.verm : k.aguardando ? cores.ambar : k.coluna === 'concluido' ? cores.verde : cor;
  ctx.fillStyle = cores.bg4; ctx.strokeStyle = borda; ctx.lineWidth = 1.2;
  coRect(ctx, x, y, w, h, 6); ctx.fill(); ctx.stroke();
  ctx.fillStyle = borda; coRect(ctx, x, y, 3, h, [6, 0, 0, 6]); ctx.fill();
  ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = cores.mudo; ctx.font = `700 7.5px ${CO.fonte}`; ctx.fillText(String(k.id).toUpperCase(), x + 9, y + 11);
  const okN = (k.aceite || []).filter((a) => a.ok).length, totN = (k.aceite || []).length;
  if (totN) { ctx.fillStyle = cores.mudo; ctx.font = `7px ${CO.fonte}`; ctx.textAlign = 'right'; ctx.fillText(`${okN}/${totN}`, x + w - 6, y + 11); ctx.textAlign = 'left'; }
  ctx.fillStyle = cores.texto; ctx.font = `600 9px ${CO.fonte}`; ctx.fillText(coCortar(ctx, k.titulo, w - 16), x + 9, y + 23);
  // barra: aceite cumprido, ou só o fluxo da coluna
  const prog = totN ? okN / totN : k.coluna === 'revisao' || k.coluna === 'qa' ? .8 : k.coluna === 'andamento' ? .35 : .1;
  ctx.fillStyle = cores.bg5; coRect(ctx, x + 9, y + h - 8, w - 18, 2.5, 2); ctx.fill();
  ctx.fillStyle = borda; coRect(ctx, x + 9, y + h - 8, (w - 18) * prog, 2.5, 2); ctx.fill();
  if (k.bloqueio) { ctx.save(); coRect(ctx, x, y, w, h, 6); ctx.clip(); ctx.strokeStyle = coRgba(cores.verm, .18); ctx.lineWidth = 3; for (let i = -h; i < w + h; i += 10) { ctx.beginPath(); ctx.moveTo(x + i, y); ctx.lineTo(x + i - h, y + h); ctx.stroke(); } ctx.restore(); }
  if (k.coluna === 'concluido') { ctx.fillStyle = cores.verde; ctx.beginPath(); ctx.arc(x + w - 9, y + 9, 4, 0, TAU); ctx.fill(); ctx.strokeStyle = '#1B1200'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(x + w - 11, y + 9); ctx.lineTo(x + w - 9.5, y + 10.5); ctx.lineTo(x + w - 7, y + 7.5); ctx.stroke(); }
  // de qual equipe é: chip hexagonal com a inicial e a cor da equipe, colado na borda esquerda do card
  const favo = CO.favos.find((f) => f.cid === cid);
  if (favo && CO.favos.length > 1) {
    const tom = favo.tom === 'violeta' ? cores.violeta : cores.ambar;
    ctx.fillStyle = tom; coHex(ctx, x + 1, y + h / 2, 8); ctx.fill();
    ctx.fillStyle = '#1B1200'; ctx.font = `700 8px ${CO.fonte}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(String(favo.nome).trim()[0].toUpperCase(), x + 1, y + h / 2 + .5);
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  }
  CO.hits.push({ tipo: 'card', card: k, cid, x, y, w, h });
}
function coDesenharRainha(t) {
  const { ctx, cores, rainha: R } = CO; const r = R.r;
  R.pulso = Math.max(0, R.pulso - .016);
  const pulso = .5 + .5 * Math.sin(t * 1.6);
  ctx.globalAlpha = .10 + .10 * pulso + R.pulso * .5; ctx.fillStyle = cores.ambar; coHex(ctx, R.x, R.y, r + 16 + pulso * 4 + R.pulso * 20); ctx.fill(); ctx.globalAlpha = 1;
  ctx.fillStyle = cores.bg3; coHex(ctx, R.x, R.y, r); ctx.fill();
  // mel: o favo da rainha enche com o progresso do projeto
  ctx.save(); coHex(ctx, R.x, R.y, r); ctx.clip();
  const nivel = CO.progresso; const topo = R.y + r - nivel * r * 2; const onda = Math.sin(t * 1.3) * 1.5;
  const g = ctx.createLinearGradient(0, topo, 0, R.y + r); g.addColorStop(0, coRgba(cores.ouro, .55)); g.addColorStop(1, coRgba(cores.laranja, .55));
  ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(R.x - r - 2, topo + onda); for (let x = -r - 2; x <= r + 2; x += 6) ctx.lineTo(R.x + x, topo + Math.sin(t * 1.3 + x * .12) * 1.5); ctx.lineTo(R.x + r + 2, R.y + r + 2); ctx.lineTo(R.x - r - 2, R.y + r + 2); ctx.closePath(); ctx.fill();
  ctx.restore();
  ctx.strokeStyle = cores.ambar; ctx.lineWidth = 2; coHex(ctx, R.x, R.y, r); ctx.stroke();
  ctx.strokeStyle = coRgba(cores.ouro, .35 + .25 * pulso); ctx.lineWidth = 1; coHex(ctx, R.x, R.y, r + 7 + pulso * 2); ctx.stroke();
  const u = usuarioDe(); const img = coImg(u.foto); const fr = 22, fy = R.y - 8;
  if (img) { ctx.save(); ctx.beginPath(); ctx.arc(R.x, fy, fr, 0, TAU); ctx.clip(); ctx.drawImage(img, R.x - fr, fy - fr, fr * 2, fr * 2); ctx.restore(); }
  else { const gg = ctx.createRadialGradient(R.x, fy - 6, 2, R.x, fy, fr); gg.addColorStop(0, cores.ouro); gg.addColorStop(1, cores.laranja); ctx.fillStyle = gg; ctx.beginPath(); ctx.arc(R.x, fy, fr - 2, 0, TAU); ctx.fill(); ctx.fillStyle = '#1B1200'; ctx.font = `700 15px ${CO.fonte}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(iniciais(u.nome), R.x, fy + 1); }
  // coroa: três pontinhas douradas
  ctx.fillStyle = cores.ouro; ctx.beginPath(); const cy = fy - fr - 3; ctx.moveTo(R.x - 9, cy + 4); ctx.lineTo(R.x - 9, cy - 4); ctx.lineTo(R.x - 4.5, cy); ctx.lineTo(R.x, cy - 6); ctx.lineTo(R.x + 4.5, cy); ctx.lineTo(R.x + 9, cy - 4); ctx.lineTo(R.x + 9, cy + 4); ctx.closePath(); ctx.fill();
  if (CO.cam.z > .3) { ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic'; ctx.fillStyle = cores.texto; ctx.font = `700 11px ${CO.fonte}`; ctx.fillText(coCortar(ctx, primeiroNome(u.nome), r * 1.7), R.x, R.y + 30); ctx.fillStyle = cores.ambar; ctx.font = `700 7px ${CO.fonte}`; ctx.letterSpacing = '.14em'; ctx.fillText('RAINHA', R.x, R.y + 41); ctx.letterSpacing = '0px'; }
  CO.hits.push({ tipo: 'rainha', x: R.x - r, y: R.y - r, w: r * 2, h: r * 2 });
}
function coDesenharAbelha(b, z) {
  const { ctx, cores } = CO; const c = CO.celulas.get(b.key); if (!c) return;
  const cor = c.agente.cor || cores.ambar;
  const repouso = b.modo === 'repouso';
  const esc = Math.min(2.4, Math.max(1, .62 / z)) * (repouso || b.modo === 'bloqueado' ? .8 : 1);   // longe, a abelha cresce para continuar visível; em repouso ela encolhe
  ctx.save(); ctx.translate(b.x, b.y); ctx.scale(esc, esc);
  if (repouso) ctx.globalAlpha = .55;
  // sombra de cor do agente
  ctx.fillStyle = coRgba(cor, repouso ? .18 : .35); ctx.beginPath(); ctx.arc(0, 0, 8.5, 0, TAU); ctx.fill();
  ctx.rotate(b.ang);
  // asas
  const bat = repouso ? 0 : Math.sin(b.asa) * .55;
  ctx.fillStyle = 'rgba(243, 234, 217, .55)';
  for (const lado of [-1, 1]) { ctx.save(); ctx.translate(-1, lado * 2.2); ctx.rotate(lado * (.55 + bat) ); ctx.beginPath(); ctx.ellipse(-2, 0, 5.2, 2.4, 0, 0, TAU); ctx.fill(); ctx.restore(); }
  // corpo listrado
  ctx.fillStyle = cores.ambar; ctx.beginPath(); ctx.ellipse(0, 0, 6.2, 3.6, 0, 0, TAU); ctx.fill();
  ctx.save(); ctx.beginPath(); ctx.ellipse(0, 0, 6.2, 3.6, 0, 0, TAU); ctx.clip(); ctx.fillStyle = '#1B1200'; for (const sx of [-3.2, -.6, 2]) ctx.fillRect(sx, -4, 1.4, 8); ctx.restore();
  ctx.fillStyle = '#1B1200'; ctx.beginPath(); ctx.arc(5.8, 0, 2.3, 0, TAU); ctx.fill();   // cabeça
  ctx.strokeStyle = '#1B1200'; ctx.lineWidth = .7; ctx.beginPath(); ctx.moveTo(6.5, -1.5); ctx.lineTo(9, -3.5); ctx.moveTo(6.5, 1.5); ctx.lineTo(9, 3.5); ctx.stroke();   // antenas
  // carga: pólen da cor de quem fala, ou mel para a rainha
  if (b.modo === 'voo' && b.rota && !b.rota.volta) { if (b.rota.carga === 'mel') { ctx.fillStyle = cores.ouro; ctx.beginPath(); ctx.moveTo(-7, 0); ctx.quadraticCurveTo(-9, -4, -10.5, 0); ctx.quadraticCurveTo(-9, 4, -7, 0); ctx.fill(); } else { ctx.fillStyle = b.rota.cor; ctx.beginPath(); ctx.arc(-7.5, 0, 2.6, 0, TAU); ctx.fill(); } }
  ctx.restore();
  // balão de conversa ao pousar
  if (b.modo === 'pouso' && coAgora() < b.balao && z > .35) { ctx.save(); ctx.translate(b.x, b.y - 13 * esc); ctx.scale(esc, esc); ctx.fillStyle = cores.texto; coRect(ctx, -9, -6, 18, 10, 5); ctx.fill(); ctx.fillStyle = cores.bg2; for (const dx of [-4.5, 0, 4.5]) { ctx.beginPath(); ctx.arc(dx, -1, 1.3 + (Math.sin(CO.t * 8 + dx) > .3 ? .5 : 0), 0, TAU); ctx.fill(); } ctx.restore(); }
}

/* ------------------------------------------------------------ câmera */
function coEnquadrar(pontos, folga = 60, anim = true) {
  if (!pontos.length) return;
  const xs = pontos.map((p) => p.x), ys = pontos.map((p) => p.y);
  const x0 = Math.min(...xs) - folga, x1 = Math.max(...xs) + folga, y0 = Math.min(...ys) - folga, y1 = Math.max(...ys) + folga;
  const z = Math.max(.12, Math.min(2.2, Math.min(CO.W / Math.max(1, x1 - x0), CO.H / Math.max(1, y1 - y0))));
  const alvo = { x: (x0 + x1) / 2, y: (y0 + y1) / 2 + 10 / z, z };
  if (anim) CO.alvoCam = alvo; else { Object.assign(CO.cam, alvo); CO.alvoCam = null; }
}
function coEnquadrarTudo(anim = true) {
  const pts = [];
  for (const c of CO.celulas.values()) { pts.push({ x: c.x - HEX_R - 70, y: c.y - HEX_R - 40 }, { x: c.x + HEX_R + 70, y: c.y + HEX_R + 20 }); }
  for (const f of CO.favos) pts.push({ x: f.x, y: f.y - f.raio - 20 });
  pts.push({ x: -CO.rainha.r - 30, y: -CO.rainha.r - 30 }, { x: CO.rainha.r + 30, y: CO.rainha.r + 40 });
  for (const zn of Object.values(CO.zonas || {})) pts.push({ x: zn.x, y: zn.y }, { x: zn.x + zn.w, y: zn.y + zn.h });
  coEnquadrar(pts, 20, anim);
}
const coZoomEm = (fator, sx, sy) => {
  const { cam } = CO; const z0 = cam.z, z1 = Math.max(.12, Math.min(3.5, z0 * fator));
  const wx = cam.x + (sx - CO.W / 2) / z0, wy = cam.y + (sy - CO.H / 2) / z0;   // ponto do mundo sob o cursor fica parado
  cam.z = z1; cam.x = wx - (sx - CO.W / 2) / z1; cam.y = wy - (sy - CO.H / 2) / z1; CO.alvoCam = null;
};
const coMundo = (sx, sy) => ({ x: CO.cam.x + (sx - CO.W / 2) / CO.cam.z, y: CO.cam.y + (sy - CO.H / 2) / CO.cam.z });
function coAcerto(sx, sy) {
  const p = coMundo(sx, sy);
  for (let i = CO.hits.length - 1; i >= 0; i--) { const h = CO.hits[i]; if (h.tipo === 'cel' || h.tipo === 'rainha') { const r = h.tipo === 'cel' ? (h.cel.r || HEX_R) : CO.rainha.r; if (Math.hypot(p.x - (h.x + h.w / 2), p.y - (h.y + h.h / 2)) <= r) return h; continue; } if (p.x >= h.x && p.x <= h.x + h.w && p.y >= h.y && p.y <= h.y + h.h) return h; }
  return null;
}

/* ------------------------------------------------------------ entrada: arrastar, zoom, pinça, clique, dica */
function coEntrada() {
  const cv = CO.cv; const tip = CO.raiz.querySelector('.co-tip');
  const pos = (ev) => { const r = cv.getBoundingClientRect(); return { x: ev.clientX - r.left, y: ev.clientY - r.top }; };
  // Três gestos: arrastar o fundo move a câmera; arrastar uma equipe, a rainha ou um quadro do canteiro reorganiza o painel (fica
  // guardado); arrastar um agente puxa a abelha dele por um fio e, ao soltar em outro agente ou num card, abre o menu de ação.
  cv.addEventListener('pointerdown', (ev) => {
    if (ev.button === 2) return;   // botão direito é menu, não arrasto
    cv.setPointerCapture(ev.pointerId); const p = pos(ev); CO.ponteiros.set(ev.pointerId, p); coFecharMenu();
    if (CO.ponteiros.size === 1) {
      const h = coAcerto(p.x, p.y);
      const modo = h?.tipo === 'cel' ? 'puxar' : ['equipe', 'zona', 'rainha', 'favo'].includes(h?.tipo) ? 'mover' : 'cam';
      CO.arrasto = { modo, alvo: h, x0: p.x, y0: p.y, cx: CO.cam.x, cy: CO.cam.y, moveu: false, ux: p.x, uy: p.y, ut: performance.now(), vx: 0, vy: 0 };
      CO.alvoCam = null; CO.vel = { x: 0, y: 0 };
    } else if (CO.ponteiros.size === 2) { const [a, b] = [...CO.ponteiros.values()]; CO.pinca = { d0: Math.hypot(a.x - b.x, a.y - b.y), z0: CO.cam.z }; CO.arrasto = null; CO.puxando = null; }
    tip.hidden = true;
  });
  cv.addEventListener('pointermove', (ev) => {
    const p = pos(ev);
    if (CO.ponteiros.has(ev.pointerId)) CO.ponteiros.set(ev.pointerId, p);
    if (CO.pinca && CO.ponteiros.size === 2) { const [a, b] = [...CO.ponteiros.values()]; const d = Math.hypot(a.x - b.x, a.y - b.y); const f = (CO.pinca.z0 * d / Math.max(1, CO.pinca.d0)) / CO.cam.z; coZoomEm(f, (a.x + b.x) / 2, (a.y + b.y) / 2); return; }
    if (CO.arrasto) {
      const a = CO.arrasto; const dx = p.x - a.x0, dy = p.y - a.y0;
      if (!a.moveu && Math.hypot(dx, dy) > 4) { a.moveu = true; cv.classList.add(a.modo === 'cam' ? 'arrastando' : a.modo === 'puxar' ? 'puxando' : 'movendo'); }
      if (!a.moveu) return;
      const agora = performance.now(), dt = Math.max(1, agora - a.ut); const ddx = (p.x - a.ux) / CO.cam.z, ddy = (p.y - a.uy) / CO.cam.z;
      if (a.modo === 'cam') { CO.cam.x = a.cx - dx / CO.cam.z; CO.cam.y = a.cy - dy / CO.cam.z; a.vx = (p.x - a.ux) / dt; a.vy = (p.y - a.uy) / dt; }
      else if (a.modo === 'mover') coMoverAlvo(a.alvo, ddx, ddy);
      else if (a.modo === 'puxar') { const w = coMundo(p.x, p.y); CO.puxando = { key: a.alvo.cel.key, x: w.x, y: w.y }; const h = coAcerto(p.x, p.y); CO.alvoSolta = h && ((h.tipo === 'cel' && h.cel.key !== a.alvo.cel.key) || h.tipo === 'card') ? h : null; }
      a.ux = p.x; a.uy = p.y; a.ut = agora;
      return;
    }
    // só passeando: dica e cursor (a dica some ao sair de cima, com menu aberto, ou depois de 3 s parada)
    const h = coAcerto(p.x, p.y); CO.hover = h;
    cv.style.cursor = !h ? 'grab' : h.tipo === 'cel' ? 'grab' : ['equipe', 'zona', 'rainha'].includes(h.tipo) ? 'move' : 'pointer';
    clearTimeout(CO.tipTimer);
    if (!h || h.tipo === 'equipe' || h.tipo === 'zona' || CO.menuAberto) { tip.hidden = true; return; }
    tip.innerHTML = coDica(h); tip.hidden = false;
    const r = cv.getBoundingClientRect(); const tw = tip.offsetWidth, th = tip.offsetHeight;
    tip.style.left = `${Math.min(r.width - tw - 8, p.x + 14)}px`; tip.style.top = `${p.y + 18 + th > r.height ? p.y - th - 10 : p.y + 18}px`;
    CO.tipTimer = setTimeout(() => { tip.hidden = true; }, 3000);
  });
  const solta = (ev) => {
    const p = pos(ev); CO.ponteiros.delete(ev.pointerId);
    if (CO.ponteiros.size < 2) CO.pinca = null;
    const a = CO.arrasto; if (!a) return; CO.arrasto = null; cv.classList.remove('arrastando', 'movendo', 'puxando');
    if (a.moveu) {
      if (a.modo === 'cam' && performance.now() - a.ut < 60) CO.vel = { x: a.vx, y: a.vy };
      if (a.modo === 'mover') coLayoutSalvar();
      if (a.modo === 'puxar') { const alvo = CO.alvoSolta; CO.alvoSolta = null; if (alvo) coMenuAcao(a.alvo.cel, alvo, p); else coSoltarAbelha(); }
      return;
    }
    // clique simples: seleciona (destaque e dica fixa); duplo clique abre; botão direito dá o menu
    const h = coAcerto(p.x, p.y);
    if (!h || h.tipo === 'equipe' || h.tipo === 'zona') { CO.selecionado = null; return; }
    if (h.tipo === 'favo') return coEnquadrar(h.favo.celulas.flatMap((c) => [{ x: c.x - HEX_R - 60, y: c.y - HEX_R - 50 }, { x: c.x + HEX_R + 60, y: c.y + HEX_R + 10 }]), 30);
    CO.selecionado = h;
  };
  cv.addEventListener('pointerup', solta); cv.addEventListener('pointercancel', (ev) => { CO.ponteiros.delete(ev.pointerId); CO.arrasto = null; CO.pinca = null; cv.classList.remove('arrastando'); });
  cv.addEventListener('pointerleave', () => { tip.hidden = true; CO.hover = null; });
  cv.addEventListener('contextmenu', (ev) => { ev.preventDefault(); const p = pos(ev); const h = coAcerto(p.x, p.y); tip.hidden = true; if (h && (h.tipo === 'cel' || h.tipo === 'card')) coMenuContexto(h, p); else coFecharMenu(); });
  cv.addEventListener('wheel', (ev) => { ev.preventDefault(); tip.hidden = true; coFecharMenu(); const p = pos(ev); const f = Math.exp(-ev.deltaY * (ev.ctrlKey ? .01 : .0016)); coZoomEm(f, p.x, p.y); }, { passive: false });
  cv.addEventListener('dblclick', (ev) => {
    const p = pos(ev); const h = coAcerto(p.x, p.y); tip.hidden = true;
    if (h?.tipo === 'cel') { location.hash = `${h.cel.cid}/chat/dm:${h.cel.agente.id}`; return; }
    if (h?.tipo === 'card') { if (h.cid === U.proj) return abrirIssue(h.card.id); location.hash = `${h.cid}/planner`; setTimeout(() => abrirIssue(h.card.id), 450); return; }
    if (h?.tipo === 'rainha') return modalPerfil('voce');
    const w = coMundo(p.x, p.y); CO.alvoCam = { x: w.x, y: w.y, z: Math.min(3.5, CO.cam.z * 1.8) };
  });
  CO.raiz.addEventListener('click', (ev) => { const b = ev.target.closest('[data-co-zoom]'); if (!b) return; const k = b.dataset.coZoom; if (k === 'mais') coZoomEm(1.35, CO.W / 2, CO.H / 2); else if (k === 'menos') coZoomEm(1 / 1.35, CO.W / 2, CO.H / 2); else coEnquadrarTudo(); });
  CO.tecla = (ev) => { if (U.vista !== 'colmeia' || ev.target.closest('input,textarea,[contenteditable]')) return; if (ev.key === 'Escape') { coFecharMenu(true); CO.selecionado = null; coSoltarAbelha(); tip.hidden = true; } else if (ev.key === '0') coEnquadrarTudo(); else if (ev.key === '+' || ev.key === '=') coZoomEm(1.3, CO.W / 2, CO.H / 2); else if (ev.key === '-') coZoomEm(1 / 1.3, CO.W / 2, CO.H / 2); };
  document.addEventListener('keydown', CO.tecla);
}
/* ------------------------------------------------------------ organização do painel: mover equipes, rainha e quadros; fica guardado por projeto */
const coLayoutChave = () => `colmeia:layout:${projetoAtual()?.id || ''}`;
function coLayoutCarregar() { try { return JSON.parse(localStorage.getItem(coLayoutChave()) || 'null') || { favos: {}, zonas: {}, rainha: { dx: 0, dy: 0 } }; } catch { return { favos: {}, zonas: {}, rainha: { dx: 0, dy: 0 } }; } }
function coLayoutSalvar() { try { localStorage.setItem(coLayoutChave(), JSON.stringify(CO.layout)); } catch { /* sem armazenamento: a organização vale só nesta sessão */ } }
/** Desloca um conjunto do painel (as abelhas vão junto). `alvo` é um acerto: equipe, favo, zona ou rainha. */
function coMoverAlvo(alvo, dx, dy) {
  if (!alvo) return;
  const leva = (c) => { c.x += dx; c.y += dy; const b = CO.abelhas.get(c.key); if (b && b.modo !== 'voo') { b.x += dx; b.y += dy; } };
  if (alvo.tipo === 'equipe' || alvo.tipo === 'favo') {
    const f = alvo.favo; f.x += dx; f.y += dy; for (const c of f.celulas) if (!c.lider) leva(c); f.vazias = f.vazias.map(([x, y]) => [x + dx, y + dy]);
    const o = (CO.layout.favos[f.cid] ||= { dx: 0, dy: 0 }); o.dx += dx; o.dy += dy;
  } else if (alvo.tipo === 'zona') {
    const z = alvo.zona; z.x += dx; z.y += dy; for (const c of CO.cartas.values()) if (c.zona === z.id) { c.x += dx; c.y += dy; c.tx += dx; c.ty += dy; }
    const o = (CO.layout.zonas[z.id] ||= { dx: 0, dy: 0 }); o.dx += dx; o.dy += dy;
  } else if (alvo.tipo === 'rainha') {
    CO.rainha.x += dx; CO.rainha.y += dy; for (const f of CO.favos) { const l = f.celulas[0]; if (l?.lider) leva(l); }
    CO.layout.rainha.dx += dx; CO.layout.rainha.dy += dy;
  }
}
/** Depois de montar, reaplica a organização guardada. */
function coLayoutAplicar() {
  CO.layout = coLayoutCarregar();
  const L = CO.layout;
  for (const f of CO.favos) { const o = L.favos[f.cid]; if (o && (o.dx || o.dy)) { const d = { ...o }; L.favos[f.cid] = { dx: 0, dy: 0 }; coMoverAlvo({ tipo: 'equipe', favo: f }, d.dx, d.dy); } }
  for (const z of Object.values(CO.zonas || {})) { const o = L.zonas[z.id]; if (o && (o.dx || o.dy)) { const d = { ...o }; L.zonas[z.id] = { dx: 0, dy: 0 }; coMoverAlvo({ tipo: 'zona', zona: z }, d.dx, d.dy); } }
  if (L.rainha && (L.rainha.dx || L.rainha.dy)) { const d = { ...L.rainha }; L.rainha = { dx: 0, dy: 0 }; coMoverAlvo({ tipo: 'rainha' }, d.dx, d.dy); }
}

/* ------------------------------------------------------------ menus: soltou um agente em outro (ou num card), ou clicou com o botão direito */
function coFecharMenu(forcar = false) {
  // logo depois de abrir (soltar a abelha gera clique e pointerup em cima do menu recém-criado), nada fecha o menu por 400 ms
  if (!forcar && CO.menuAberto && performance.now() - (CO.menuAbertoEm || 0) < 400) return;
  CO.raiz?.querySelector('.co-menu')?.remove(); if (CO.menuAberto) { CO.menuAberto = false; coSoltarAbelha(); }
}
/** Solta a abelha que estava sendo puxada: ela volta voando para a célula dela. */
function coSoltarAbelha() {
  const k = CO.puxando?.key; CO.puxando = null; CO.alvoSolta = null; if (!k) return;
  const b = CO.abelhas.get(k); const c = CO.celulas.get(k); if (!b || !c) return;
  if (b.modo !== 'voo') coIniciarRota(b, k, c.agente.cor, null, true);
}
/** Menu genérico no ponto p (coordenadas da tela do canvas). itens: [{ id, rotulo, sub, classe }]. */
function coMenu(titulo, itens, p, aoEscolher) {
  coFecharMenu(); CO.menuAberto = true;
  const m = document.createElement('div'); m.className = 'co-menu';
  // data-co-acao, não data-acao: o clique global do app trata data-acao (parar, bloquear, perfil...) e faria outra coisa por cima
  m.innerHTML = `<div class="co-menu-t">${titulo}</div>${itens.map((i) => `<button type="button" data-co-acao="${esc(i.id)}" class="${i.classe || ''}">${esc(i.rotulo)}${i.sub ? `<small>${esc(i.sub)}</small>` : ''}</button>`).join('')}<button type="button" data-co-acao="nada" class="mudo">Cancelar</button>`;
  const r = CO.cv.getBoundingClientRect(); const alt = 50 + itens.length * 44;
  m.style.left = `${Math.min(r.width - 250, Math.max(8, p.x - 20))}px`; m.style.top = `${Math.min(r.height - alt, Math.max(8, p.y - 10))}px`;
  CO.raiz.querySelector('.co-area').appendChild(m);
  for (const tipo of ['pointerdown', 'mousedown', 'pointerup', 'contextmenu']) m.addEventListener(tipo, (ev) => ev.stopPropagation());
  m.addEventListener('click', async (ev) => {
    ev.stopPropagation(); ev.preventDefault();
    const b = ev.target.closest('button'); if (!b) return;
    const acao = b.dataset.coAcao; if (acao === 'nada') return coFecharMenu(true);
    for (const x of m.querySelectorAll('button')) x.disabled = true;
    try { await aoEscolher(acao); } finally { coFecharMenu(true); }
  });
  CO.menuAbertoEm = performance.now();
  return m;
}
/** Botão direito num agente ou num card: ações básicas direto no painel. */
function coMenuContexto(h, p) {
  if (h.tipo === 'cel') {
    const c = h.cel; const nome = primeiroNome(c.agente.nome); const ocupado = c.sit?.estado && c.sit.estado !== 'parado';
    coMenu(`${esc(nome)} <span>${esc(c.agente.cargo || '')}</span>`, [
      { id: 'dm', rotulo: 'Abrir conversa', sub: 'DM com este agente' },
      { id: 'perfil', rotulo: 'Ver perfil' },
      ...(ocupado ? [{ id: 'parar', rotulo: `Parar ${nome}`, sub: 'cancela as chamadas em andamento dele', classe: 'perigo' }] : []),
    ], p, async (acao) => {
      if (acao === 'dm') { location.hash = `${c.cid}/chat/dm:${c.agente.id}`; return; }
      if (acao === 'perfil') { modalPerfil(c.agente.id); return; }
      if (acao === 'parar') { const r = await api('POST', P(`/agente/${c.agente.id}/parar`, c.cid), {}); aviso(r._ok ? `${nome}: ${r.cancelados || 0} ${r.cancelados === 1 ? 'chamada cancelada' : 'chamadas canceladas'}.` : (r.erro || 'Não consegui parar.')); coRegistrar(`Você parou ${nome}`, CO.cores.verm); }
    });
    return;
  }
  if (h.tipo === 'card') {
    const k = h.card; const cid = h.cid; const lider = PJ[cid]?.lider || 'po';
    const emTrabalho = [...CO.celulas.values()].some((c) => c.cid === cid && c.sit?.card?.id === k.id && c.sit.estado !== 'parado');
    coMenu(`${esc(k.id)} <span>${esc(String(k.titulo).slice(0, 34))}</span>`, [
      { id: 'abrir', rotulo: 'Abrir tarefa' },
      k.bloqueio ? { id: 'desbloquear', rotulo: 'Desbloquear', sub: String(k.bloqueio).slice(0, 60) } : { id: 'bloquear', rotulo: 'Bloquear', sub: 'o time para de mexer nela até você liberar' },
      ...(emTrabalho ? [{ id: 'parar', rotulo: 'Parar o trabalho nela', sub: 'cancela as chamadas em andamento neste card', classe: 'perigo' }] : []),
    ], p, async (acao) => {
      if (acao === 'abrir') { if (cid === U.proj) abrirIssue(k.id); else { location.hash = `${cid}/planner`; setTimeout(() => abrirIssue(k.id), 450); } return; }
      if (acao === 'bloquear') { const motivo = await perguntarTexto('Motivo do bloqueio', 'O que está impedindo', 'Bloquear'); if (!motivo) return; const r = await api('POST', P(`/cartao/${k.id}/bloquear`, cid), { motivo }); if (!r._ok) aviso(r.erro || 'Não bloqueou.'); else coRegistrar(`Você bloqueou ${k.id}`, CO.cores.verm); return; }
      if (acao === 'desbloquear') { const r = await api('POST', P(`/cartao/${k.id}/desbloquear`, cid), {}); if (!r._ok) aviso(r.erro || 'Não desbloqueou.'); else coRegistrar(`Você desbloqueou ${k.id}`, CO.cores.verde); return; }
      if (acao === 'parar') { const r = await api('POST', P('/colmeia', cid), { acao: 'parar', agente: lider, card: k.id }); aviso(r._ok ? `${r.parados?.length || 0} ${r.parados?.length === 1 ? 'agente parado' : 'agentes parados'} em ${k.id}.` : (r.erro || 'Não consegui parar.')); if (r._ok) coRegistrar(`Você parou o trabalho em ${k.id}`, CO.cores.verm); }
    });
  }
}
function coMenuAcao(cel, alvo, p) {
  const alvoCel = alvo.tipo === 'cel' ? alvo.cel : null; const card = alvo.tipo === 'card' ? alvo.card : null; const cidAlvo = alvoCel ? alvoCel.cid : alvo.cid;
  const lider = !!cel.lider;
  const quem = alvoCel ? primeiroNome(alvoCel.agente.nome) : card.id;
  coMenu(`${esc(primeiroNome(cel.agente.nome))} <span>em</span> ${esc(quem)}`, [
    { id: 'ajudar', rotulo: 'Ajudar', sub: 'entra no trabalho e combina com quem está nele' },
    { id: 'monitorar', rotulo: 'Monitorar', sub: 'olha o que está acontecendo e te dá um retorno' },
    ...(lider ? [{ id: 'parar', rotulo: 'Parar', sub: card ? 'para todo o trabalho neste card' : `para as chamadas de ${quem}`, classe: 'perigo' }] : []),
  ], p, async (acao) => {
    if (cidAlvo !== cel.cid) { aviso('Por enquanto, ajuda e monitoramento valem dentro da mesma equipe. Para outra equipe, peça pela sala dos líderes.'); return; }
    const r2 = await api('POST', P('/colmeia', cel.cid), { acao, agente: cel.agente.id, alvoAgente: alvoCel ? alvoCel.agente.id : null, card: card ? card.id : null });
    if (!r2._ok) return aviso(r2.erro || 'Não consegui.');
    const corA = acao === 'parar' ? CO.cores.verm : acao === 'monitorar' ? CO.cores.violeta : cel.agente.cor;
    if (alvoCel) { coVoar(cel.key, alvoCel.key, corA); coRegistrar(`${primeiroNome(cel.agente.nome)} vai ${acao} ${primeiroNome(alvoCel.agente.nome)}`, corA); }
    else { const k = `${alvo.cid}:${card.id}`; coFio(cel.key, `carta:${k}`, corA, 20); const ct = CO.cartas.get(k); if (ct) coOnda(ct.x, ct.y, corA, 20, 70); coRegistrar(`${primeiroNome(cel.agente.nome)} vai ${acao} ${card.id}`, corA); }
    if (acao === 'parar') aviso(`${r2.parados?.length ? r2.parados.length : 0} ${r2.parados?.length === 1 ? 'agente parado' : 'agentes parados'}.`);
  });
}

function coDica(h) {
  if (h.tipo === 'rainha') { const u = usuarioDe(); return `<b>${esc(u.nome)}</b><small>${u.cargo ? `${esc(u.cargo)}. ` : ''}${Math.round(CO.progresso * 100)}% do projeto colhido, ${CO.entregas} ${CO.entregas === 1 ? 'entrega' : 'entregas'} nesta sessão</small>`; }
  if (h.tipo === 'favo') { const f = h.favo; const n = f.celulas.filter((c) => c.sit?.estado === 'trabalhando').length; return `<b>${esc(f.nome)}</b><small>${f.celulas.length} na equipe, ${n} trabalhando agora. Clique para aproximar.</small>`; }
  if (h.tipo === 'card') { const k = h.card; const f = CO.favos.find((x) => x.cid === h.cid); const dono = h.cid && k.dono ? CO.celulas.get(`${h.cid}:${k.dono}`) : null; return `<b>${esc(k.id)} ${esc(k.titulo)}</b><small>${f ? `${esc(f.nome)}${dono ? `, com ${esc(primeiroNome(dono.agente.nome))}` : ''}. ` : ''}${esc(k.coluna)}${k.bloqueio ? `. Bloqueado: ${esc(k.bloqueio)}` : ''}${k.aguardando ? '. Aguarda a Game Director' : ''}</small>`; }
  const c = h.cel; const s = c.sit || {}; const pr = s.pr;
  const desde = pr?.desde ? ` há ${Math.max(1, Math.round((Date.now() - pr.desde) / 60000))} min` : '';
  const linha = s.estado === 'bloqueado' ? `Bloqueado em ${s.card?.id}: ${s.card?.bloqueio}` : pr ? `${pr.atividade || pr.estado}${desde}` : 'em repouso';
  return `<b>${esc(c.agente.nome)}</b><small>${esc(c.agente.cargo || '')}, ${esc(c.equipe.nome)}</small><small>${esc(linha)}</small>${s.card ? `<small class="co-tip-card">${esc(s.card.id)} ${esc(s.card.titulo)}</small>` : ''}`;
}

/* ------------------------------------------------------------ ciclo de vida */
function coLaco(ts) {
  if (U.vista !== 'colmeia' || !CO.raiz?.isConnected) { CO.raf = 0; return; }
  const dt = Math.min(.05, (ts - (CO.ultimo || ts)) / 1000); CO.ultimo = ts; CO.t += dt;
  const agora = coAgora();
  if (agora >= CO.proximoSync) { CO.proximoSync = agora + .25; try { coSincronizar(); } catch (e) { console.error(e); } }
  // câmera: animação de enquadramento e inércia do arrasto
  if (CO.alvoCam) { const a = CO.alvoCam, c = CO.cam, f = 1 - Math.exp(-dt * 6); c.x += (a.x - c.x) * f; c.y += (a.y - c.y) * f; c.z += (a.z - c.z) * f; if (Math.abs(a.x - c.x) < .5 && Math.abs(a.y - c.y) < .5 && Math.abs(a.z - c.z) < .002) { Object.assign(c, a); CO.alvoCam = null; } }
  else if (!CO.arrasto && (Math.abs(CO.vel.x) > .01 || Math.abs(CO.vel.y) > .01)) { CO.cam.x -= CO.vel.x * dt * 1000 / CO.cam.z; CO.cam.y -= CO.vel.y * dt * 1000 / CO.cam.z; const k = Math.exp(-dt * 4); CO.vel.x *= k; CO.vel.y *= k; }
  for (const b of CO.abelhas.values()) coMoverAbelha(b, dt);
  for (const p of CO.particulas) { p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= .96; p.vy = p.vy * .96 - 12 * dt; }
  coDesenhar();
  CO.raf = requestAnimationFrame(coLaco);
}
function coMedir() {
  const cv = CO.cv; if (!cv) return;
  const r = cv.parentElement.getBoundingClientRect(); CO.dpr = Math.min(2, window.devicePixelRatio || 1);
  CO.W = Math.max(1, r.width); CO.H = Math.max(1, r.height);
  cv.width = Math.round(CO.W * CO.dpr); cv.height = Math.round(CO.H * CO.dpr); cv.style.width = `${CO.W}px`; cv.style.height = `${CO.H}px`;
}
async function renderColmeia() {
  const p = projetoAtual(); if (!p) return;
  const equipes = equipesDoProjeto(p);
  for (const e of equipes) if (!PJ[e.cid]) await carregarProjeto(e.cid).catch(() => {});
  coCores();
  const assinatura = `${p.id}|${equipes.map((e) => `${e.cid}:${(PJ[e.cid]?.roster || []).map((a) => a.id).join('+')}`).join(',')}`;
  const primeira = CO.montadoPara.split('|')[0] !== p.id;
  if (CO.montadoPara !== assinatura) { coMontar(); CO.montadoPara = assinatura; coLayoutAplicar(); }
  $('#centro').innerHTML = `<div class="colmeia">
    <div class="co-topo"><h2>${ic('colmeia')}Colmeia</h2>
      <span class="co-stat on"><i></i>0 trabalhando</span><span class="co-stat fila"><i></i>0 na fila</span><span class="co-stat bloq"><i></i>0 bloqueadas</span><span class="co-stat off"><i></i>0 em repouso</span>
      <span class="espaco"></span>
      <span class="co-colheita" title="Cards concluídos sobre o total, em todas as equipes"><span>colheita</span><em><i style="width:0"></i></em><b>0%</b></span></div>
    <div class="co-area"><canvas id="co-cv"></canvas>
      <div class="co-registro"></div>
      <div class="co-zoom"><button class="btn-ic" data-co-zoom="mais" title="Aproximar">${ic('mais')}</button><button class="btn-ic" data-co-zoom="menos" title="Afastar">${ic('menos')}</button><button class="btn-ic" data-co-zoom="tudo" title="Enquadrar tudo (0)">${ic('colmeia')}</button></div>
      <div class="co-tip" hidden></div>
    </div></div>`;
  CO.raiz = $('#centro .colmeia'); CO.cv = $('#co-cv'); CO.ctx = CO.cv.getContext('2d');
  coMedir();
  if (CO.obs) CO.obs.disconnect(); CO.obs = new ResizeObserver(() => coMedir()); CO.obs.observe(CO.cv.parentElement);
  if (CO.tecla) document.removeEventListener('keydown', CO.tecla);
  coEntrada();
  CO.cardsProntos = false; CO.cards = new Map();
  CO.proximoSync = 0; coSincronizar();
  for (const b of CO.abelhas.values()) b.estadoAnt = CO.celulas.get(b.key)?.sit?.estado || null;
  if (primeira || CO.cam.z === 1 && CO.cam.x === 0 && CO.cam.y === 0) coEnquadrarTudo(false);
  coRegistrar('Colmeia ao vivo', CO.cores.ambar);
  CO.registro.forEach(() => {}); const reg = CO.raiz.querySelector('.co-registro'); reg.innerHTML = CO.registro.slice(-7).map((r) => `<div class="co-reg" style="--c:${esc(r.cor)}"><i></i>${esc(r.texto)}</div>`).join('');
  if (!CO.raf) { CO.ultimo = 0; CO.raf = requestAnimationFrame(coLaco); }
}
/** Eventos do app viram movimento na colmeia: fala vira voo de pólen entre quem falou e quem foi citado (ou a rainha, na DM). */
function colmeiaEvento(e) {
  if (U.vista !== 'colmeia' || !CO.raiz) return;
  if (e.tipo === 'presenca') { CO.proximoSync = 0; return; }
  if (e.tipo === 'elenco') { CO.montadoPara = ''; renderColmeia(); return; }
  if (e.tipo === 'quadro') { CO.proximoSync = coAgora() + .8; return; }   // quadroMudou busca o quadro novo em ~300 ms; a diferença é lida depois
  if (e.tipo !== 'msg' && e.tipo !== 'msg.upd') return;
  const m = e.msg; if (!m || m.status === 'trabalhando' || !m.texto) return;
  if (e.tipo === 'msg.upd' && CO.vistas?.has(m.id)) return;   // a mesma mensagem crescendo em pedaços conta uma vez
  (CO.vistas ||= new Set()).add(m.id); if (CO.vistas.size > 400) CO.vistas = new Set([...CO.vistas].slice(-200));
  const cid = e.projeto; const j = PJ[cid]; if (!j) return;
  const chave = (id) => (id === 'voce' ? 'rainha' : String(id).startsWith('ext:') ? (() => { const x = /^ext:([^@]+)@(.+)$/.exec(id); return x ? `${x[2]}:${x[1]}` : null; })() : coChave(cid, id));
  const de = chave(m.de); if (!de || (de !== 'rainha' && !CO.celulas.has(de))) return;
  const cor = m.de === 'voce' ? CO.cores.ouro : ((j.roster || []).find((a) => a.id === m.de)?.cor || agente(m.de)?.cor || CO.cores.ambar);
  const alvos = new Set();
  if (m.canal?.startsWith('dm:')) alvos.add(m.de === 'voce' ? coChave(cid, m.canal.slice(3)) : 'rainha');
  for (const [, nome] of String(m.texto).matchAll(/@([\p{L}_0-9]+)/gu)) {
    const k = semAcento(nome);
    if (['gamedirector', 'todos'].includes(k) || semAcento(primeiroNome(usuarioDe().nome)) === k) { alvos.add('rainha'); continue; }
    for (const [key, c] of CO.celulas) if (semAcento(primeiroNome(c.agente.nome)) === k || semAcento(c.agente.tokenNome || '') === k) alvos.add(key);
  }
  if (!alvos.size && m.de !== 'voce') alvos.add(coChave(cid, j.lider || 'po'));   // falou no #equipe: vai em direção à liderança
  for (const a of alvos) {
    if (a === de || (a !== 'rainha' && !CO.celulas.has(a))) continue;
    if (de === 'rainha') { coFio('rainha', a, cor, 12); const al = coPonto(a); if (al) { coOnda(al.x, al.y, cor); coParticulas(al.x, al.y - HEX_R, cor, 6, 40); } }
    else coVoar(de, a, cor);
  }
  const nomeDe = (k) => (k === 'rainha' ? primeiroNome(usuarioDe().nome) : primeiroNome(CO.celulas.get(k)?.agente.nome || k));
  const outros = [...alvos].filter((a) => a !== de && (a === 'rainha' || CO.celulas.has(a)));
  if (outros.length) coRegistrar(`${nomeDe(de)} falou com ${outros.map(nomeDe).join(', ')}`, cor);
}
