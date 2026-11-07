// Persistência em JSON na pasta de dados do app (studio/data no código-fonte, %APPDATA% no .exe).
// Gravação atômica e durável (arquivo temporário + fsync + rename), com cópia da versão anterior e instantâneos por hora.
import fs from 'node:fs';
import path from 'node:path';

export const DIR = process.env.STUDIO_DATA
  ? path.resolve(process.env.STUDIO_DATA)
  : path.resolve(import.meta.dirname, '..', 'data');
fs.mkdirSync(DIR, { recursive: true });

// Caminho relativo vale dentro da pasta de dados do app; caminho absoluto (a pasta de cada projeto) vale como está.
const abs = (rel) => (path.isAbsolute(rel) ? rel : path.join(DIR, rel));

// ---- Durabilidade ------------------------------------------------------------------------------------------------
// Queda de energia ou reinício abrupto do Windows logo depois de uma gravação deixa o arquivo com o tamanho certo e o conteúdo
// ZERADO (bytes 0). Em 31/10/2026 isso aconteceu com o quadro e com as conversas: o app não conseguiu ler, tratou como "arquivo
// novo", começou vazio e gravou por cima. Por isso:
//  1) gravar força o conteúdo para o disco (fsync) antes do rename;
//  2) cada gravação guarda a versão anterior boa (.bak) e, uma vez por hora, um instantâneo em _backups/;
//  3) gravação que encolhe o arquivo de repente guarda a versão grande antes de sobrescrever;
//  4) ler nunca trata arquivo ilegível como "não existe": tenta o .bak e os instantâneos, e o que estiver ilegível é preservado
//     em quarentena (nunca sobrescrito nem apagado).
export const ocorrencias = [];   // o que foi recuperado ou posto em quarentena nesta execução (para o app avisar)
const aviso = (msg) => { ocorrencias.push({ em: new Date().toISOString(), msg }); console.error(`[dados] ${msg}`); };
const espera = (ms) => { try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); } catch { /* sem espera */ } };

const zerado = (buf) => buf.length > 0 && !buf.some((x) => x !== 0);
function lerJson(f) {
  for (let i = 0; i < 3; i++) {   // arquivo momentaneamente travado (antivírus, indexador): tenta de novo antes de desistir
    try {
      const buf = fs.readFileSync(f);
      if (!buf.length) return { vazio: true };
      if (zerado(buf)) return { zerado: true };
      return { dados: JSON.parse(buf.toString('utf8')) };
    } catch (e) {
      if (e.code === 'ENOENT') return { ausente: true };
      if (!['EBUSY', 'EPERM', 'EACCES', 'EMFILE'].includes(e.code)) return { erro: e };
      espera(120);
    }
  }
  return { erro: new Error('arquivo travado') };
}
const instantaneos = (alvo) => {
  const dir = path.join(path.dirname(alvo), '_backups'), base = path.basename(alvo, '.json');
  try { return fs.readdirSync(dir).filter((n) => n.startsWith(`${base}.`) && n.endsWith('.json')).sort().reverse().map((n) => path.join(dir, n)); } catch { return []; }
};
function quarentena(alvo, motivo) {
  const destino = `${alvo}.ilegivel-${Date.now()}`;
  try {
    fs.renameSync(alvo, destino);
    aviso(`${path.basename(alvo)} estava ilegível (${motivo}); guardado em ${path.basename(destino)}.`);
    const velhos = fs.readdirSync(path.dirname(alvo)).filter((n) => n.startsWith(`${path.basename(alvo)}.ilegivel-`)).sort();
    for (const v of velhos.slice(0, Math.max(0, velhos.length - 5))) { try { fs.rmSync(path.join(path.dirname(alvo), v)); } catch { /* fica */ } }
  } catch { /* sem como mover: o arquivo continua onde está */ }
}

export function ler(rel, padrao) {
  const alvo = abs(rel);
  const r = lerJson(alvo);
  if (r.dados !== undefined) return r.dados;
  const padraoOu = () => (padrao === null ? null : structuredClone(padrao));
  const existia = !r.ausente;
  const candidatos = [`${alvo}.bak`, `${alvo}.tmp`, ...instantaneos(alvo)];
  if (!existia && !candidatos.some((c) => fs.existsSync(c))) return padraoOu();   // nunca existiu: é uma primeira vez de verdade
  for (const c of candidatos) {
    const x = lerJson(c);
    if (x.dados === undefined) continue;
    if (existia) quarentena(alvo, r.zerado ? 'conteúdo zerado por reinício abrupto' : r.vazio ? 'vazio' : 'não foi possível ler');
    try { fs.copyFileSync(c, alvo); } catch { /* segue com o que foi lido */ }
    aviso(`${path.basename(alvo)} recuperado de ${path.basename(c)}.`);
    return x.dados;
  }
  if (existia) quarentena(alvo, r.zerado ? 'conteúdo zerado por reinício abrupto' : 'não foi possível ler');
  return padraoOu();
}

const ultimoBak = new Map(); const ultimoSnap = new Map();
const INTERVALO_BAK = Number(process.env.STUDIO_BAK_MS ?? 20_000);   // (os testes põem 0)
function validoNoDisco(f) { try { const b = Buffer.alloc(64); const fd = fs.openSync(f, 'r'); const n = fs.readSync(fd, b, 0, 64, 0); fs.closeSync(fd); return n > 0 && b.subarray(0, n).some((x) => x !== 0); } catch { return false; } }
function protegerAnterior(alvo, tamanhoNovo) {
  let st; try { st = fs.statSync(alvo); } catch { return; }
  if (!st.size || !validoNoDisco(alvo)) return;
  const agora = Date.now();
  // encolheu de repente (por exemplo quadro de 500 KB virando 50 bytes): a versão grande fica guardada à parte
  if (st.size > 20_000 && tamanhoNovo < st.size * 0.25) {
    try {
      fs.copyFileSync(alvo, `${alvo}.antes-de-encolher-${agora}`);
      const velhos = fs.readdirSync(path.dirname(alvo)).filter((n) => n.startsWith(`${path.basename(alvo)}.antes-de-encolher-`)).sort();
      for (const v of velhos.slice(0, Math.max(0, velhos.length - 5))) { try { fs.rmSync(path.join(path.dirname(alvo), v)); } catch { /* fica */ } }
      aviso(`${path.basename(alvo)} encolheu de ${st.size} para ${tamanhoNovo} bytes; a versão anterior foi guardada.`);
    } catch { /* sem espaço: segue */ }
  }
  if (agora - (ultimoBak.get(alvo) || 0) > INTERVALO_BAK) { try { fs.copyFileSync(alvo, `${alvo}.bak`); ultimoBak.set(alvo, agora); } catch { /* sem cópia desta vez */ } }
  // um instantâneo por hora, em _backups/ (36 horas e um por dia nos últimos 14 dias)
  if (st.size > 2048 && agora - (ultimoSnap.get(alvo) || 0) > (process.env.STUDIO_SNAP_MS ? Number(process.env.STUDIO_SNAP_MS) : 3_600_000)) {
    try {
      const dir = path.join(path.dirname(alvo), '_backups'); fs.mkdirSync(dir, { recursive: true });
      const d = new Date(agora), p2 = (n) => String(n).padStart(2, '0');
      fs.copyFileSync(alvo, path.join(dir, `${path.basename(alvo, '.json')}.${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}-${p2(d.getHours())}.json`));
      ultimoSnap.set(alvo, agora);
      const todos = instantaneos(alvo); const manter = new Set(todos.slice(0, 12)); const dias = new Set();   // 12 horas e um por dia em 7 dias
      for (const f of todos.slice(12)) { const dia = path.basename(f).split('.')[1].slice(0, 8); if (!dias.has(dia) && dias.size < 7) { dias.add(dia); manter.add(f); } }
      for (const f of todos) if (!manter.has(f)) { try { fs.rmSync(f); } catch { /* fica */ } }
    } catch { /* sem instantâneo desta vez */ }
  }
}
function escreverDuravel(destino, texto) {
  const fd = fs.openSync(destino, 'w');
  try { fs.writeSync(fd, texto); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}
function renomear(de, para) {
  for (let i = 0; i < 6; i++) {
    try { fs.renameSync(de, para); return; } catch (e) { if (i === 5 || !['EPERM', 'EBUSY', 'EACCES'].includes(e.code)) throw e; espera(60 * (i + 1)); }
  }
}

// Gravação síncrona: para dados raros (configuração, registro de projetos), onde esperar o disco não pesa.
function gravarSincrono(alvo, texto) {
  fs.mkdirSync(path.dirname(alvo), { recursive: true });
  const tmp = `${alvo}.tmp`;
  escreverDuravel(tmp, texto);
  protegerAnterior(alvo, Buffer.byteLength(texto));
  renomear(tmp, alvo);
}
export function gravar(rel, dados) {
  const alvo = abs(rel);
  geracao.set(alvo, (geracao.get(alvo) || 0) + 1);   // uma gravação no ar, mais velha que esta, é descartada
  cancelarAdiada(alvo);
  gravarSincrono(alvo, JSON.stringify(dados, null, 2));
}

// ---- Gravação adiada ---------------------------------------------------------------------------------------------------
// Com vários agentes trabalhando, o quadro e as conversas mudam dezenas de vezes por minuto. Gravar a cada mudança, de forma
// síncrona e com fsync (e ainda regravar quadro.md e um progress.md por card), travava a thread que também atende a tela e lê a
// saída dos agentes. Agora:
//  - várias mudanças seguidas viram UMA gravação (espera curta, com teto), serializada na hora de gravar, então o arquivo sempre
//    mostra um instante consistente;
//  - o fsync e a escrita acontecem fora da thread principal (fs.promises);
//  - ao fechar o app, tudo que está pendente ou no ar é gravado de forma síncrona (descarregarSync), então fechar nunca perde nada;
//  - um arquivo usa só um modo: ou gravar() ou gravarDepois().
const fsp = fs.promises;
const fontes = new Map();    // alvo -> () => dados (todo arquivo que usa gravação adiada)
const timers = new Map();    // alvo -> { t, desde }
const noAr = new Map();      // alvo -> Promise da gravação em andamento (uma por vez em cada arquivo)
const geracao = new Map();   // alvo -> n; gravação mais nova invalida a que ainda estava no ar
const sujos = new Set();     // alvos com mudança ainda não confirmada em disco
const tarefas = new Map();   // chave -> { t, desde, fn } (trabalho adiado que não é JSON, como os .md derivados)
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

function cancelarAdiada(alvo) { const x = timers.get(alvo); if (x) { clearTimeout(x.t); timers.delete(alvo); } sujos.delete(alvo); }
async function renomearAsync(de, para) {
  for (let i = 0; i < 6; i++) {
    try { await fsp.rename(de, para); return; } catch (e) { if (i === 5 || !['EPERM', 'EBUSY', 'EACCES'].includes(e.code)) throw e; await esperar(60 * (i + 1)); }
  }
}
async function gravarAssincrono(alvo, texto, ger) {
  await fsp.mkdir(path.dirname(alvo), { recursive: true });
  const tmp = `${alvo}.a${ger}.tmp`;
  const fh = await fsp.open(tmp, 'w');
  try { await fh.writeFile(texto); await fh.sync(); } finally { await fh.close(); }
  if (geracao.get(alvo) !== ger) { fsp.rm(tmp, { force: true }).catch(() => {}); return; }   // gravaram depois: esta já é velha
  protegerAnterior(alvo, Buffer.byteLength(texto));
  await renomearAsync(tmp, alvo);
}
function disparar(alvo) {
  cancelarAdiada(alvo);
  const fonte = fontes.get(alvo);
  if (!fonte) return Promise.resolve();
  let texto;
  try { texto = JSON.stringify(fonte(), null, 2); } catch (e) { aviso(`${path.basename(alvo)} não pôde ser serializado: ${e.message}`); return Promise.resolve(); }
  const ger = (geracao.get(alvo) || 0) + 1; geracao.set(alvo, ger);
  const p = (noAr.get(alvo) || Promise.resolve())
    .then(() => gravarAssincrono(alvo, texto, ger))
    .catch((e) => { aviso(`${path.basename(alvo)} não foi gravado (${e.message}); tentando de novo.`); sujos.add(alvo); reagendar(alvo, 2000); })
    .finally(() => { if (noAr.get(alvo) === p) noAr.delete(alvo); });
  noAr.set(alvo, p);
  return p;
}
function reagendar(alvo, espera, maximo = 2000) {
  const atual = timers.get(alvo);
  const agora = Date.now();
  const desde = atual?.desde ?? agora;
  if (atual) clearTimeout(atual.t);
  const t = setTimeout(() => disparar(alvo), Math.min(espera, Math.max(0, desde + maximo - agora)));
  t.unref?.();
  timers.set(alvo, { t, desde });
}
/** Pede para gravar `dados` (objeto, ou função que devolve o objeto atual). Várias chamadas seguidas viram uma gravação. */
export function gravarDepois(rel, dados, { espera = 300, maximo = 2000 } = {}) {
  const alvo = abs(rel);
  fontes.set(alvo, typeof dados === 'function' ? dados : () => dados);
  sujos.add(alvo);
  reagendar(alvo, espera, maximo);
}
/** Trabalho que pode esperar e juntar (por exemplo regravar os .md derivados do quadro). */
export function adiar(chave, fn, espera = 1500, maximo = 5000) {
  const a = tarefas.get(chave);
  const agora = Date.now();
  const desde = a?.desde ?? agora;
  if (a) clearTimeout(a.t);
  const t = setTimeout(() => { tarefas.delete(chave); try { fn(); } catch (e) { aviso(`tarefa adiada "${chave}" falhou: ${e.message}`); } }, Math.min(espera, Math.max(0, desde + maximo - agora)));
  t.unref?.();
  tarefas.set(chave, { t, desde, fn });
}
/** Grava tudo que está pendente e espera o que está no ar. Usar antes de ler o disco (ponto de salvamento, testes). */
export async function descarregar() {
  for (const [chave, a] of [...tarefas]) { clearTimeout(a.t); tarefas.delete(chave); try { a.fn(); } catch { /* segue */ } }
  for (const alvo of [...sujos]) disparar(alvo);
  await Promise.all([...noAr.values()]);
}
/** Ao fechar: tudo que está pendente ou no ar é gravado agora, de forma síncrona. */
export function descarregarSync() {
  for (const [chave, a] of [...tarefas]) { clearTimeout(a.t); tarefas.delete(chave); try { a.fn(); } catch { /* segue */ } }
  for (const alvo of new Set([...sujos, ...noAr.keys()])) {
    const fonte = fontes.get(alvo);
    cancelarAdiada(alvo);
    if (!fonte) continue;
    try { geracao.set(alvo, (geracao.get(alvo) || 0) + 1); gravarSincrono(alvo, JSON.stringify(fonte(), null, 2)); } catch (e) { aviso(`${path.basename(alvo)} não foi gravado ao fechar: ${e.message}`); }
  }
}
process.on('exit', descarregarSync);

/** Arquivo derivado (regenerável, como quadro.md): só regrava se o conteúdo mudou, sem fsync. */
const ultimoDerivado = new Map();
export function escreverSeMudou(alvo, texto) {
  const t = String(texto);
  if (ultimoDerivado.get(alvo) === t) return false;
  fs.mkdirSync(path.dirname(alvo), { recursive: true });
  const tmp = `${alvo}.tmp`;
  fs.writeFileSync(tmp, t);
  renomear(tmp, alvo);
  ultimoDerivado.set(alvo, t);
  return true;
}

/** Texto comum (notas, relatórios) com a mesma garantia: o conteúdo chega ao disco antes de o arquivo valer. */
export function escreverTexto(alvo, texto) {
  fs.mkdirSync(path.dirname(alvo), { recursive: true });
  const tmp = `${alvo}.tmp`;
  escreverDuravel(tmp, String(texto));
  renomear(tmp, alvo);
}

export const existe = (rel) => fs.existsSync(abs(rel));
export const removerPasta = (rel) => fs.rmSync(abs(rel), { recursive: true, force: true });

export const CONFIG_PADRAO = {
  engine: 'claude',
  modo: 'conversar',
  // Padrões econômicos: Sonnet 5.5 e Terra 6.1 no nível médio. Com a Cris automática ligada (creditos.automatico),
  // estes só valem como padrão manual; ela escolhe por chamada.
  modeloClaude: 'claude-sonnet-5-5',
  esforcoCodex: 'medium', // low, medium, high, xhigh, max ou ultra ("high" ou mais só quando o médio não der conta)
  esforcoClaude: 'medium', // low, medium, high, xhigh ou max
  claudeExe: '', // vazio = o Claude Code mais novo que existir na máquina
  modeloCodex: 'gpt-6.1-terra',
  codexExe: '', // vazio = o Codex mais novo que existir na máquina
  wip: { pronto: 5, andamento: 3, revisao: 3, qa: 3 },
  // O ciclo da equipe: o que acontece sozinho quando alguém termina uma etapa.
  ciclo: {
    orcamento: 14,        // máximo de chamadas de agente por pedido seu (trava contra cascata)
    posts: false,         // card concluído: o dono escreve também um documento no canal Posts (desligado: a conclusão já chega curta por DM, sem gastar outra chamada)
    versionar: true,      // card concluído chama o agente de Versionamento (conflito, commit, push)
    planningReplica: true, // no planning, os agentes debatem as opiniões uns dos outros antes da proposta
    limiteChamadaMin: 30, // tempo máximo de uma chamada de agente antes de encerrar
    paralelo: 3,          // quantos agentes trabalham ao mesmo tempo (1 = um de cada vez)
    revisaoAuto: true,    // card que entra em Revisão chama o P.O.; em QA chama o QA
    curadoriaAuto: true,  // card concluído com notas novas chama o Curador
    fechamento: false,    // (desligado: o relatório final de cada card já fecha o assunto; a P.O. fecha só se você pedir)
    pontosMax: 5,         // card maior que isso é recusado: tarefa pequena gasta menos e volta menos de revisão
    limpezaHoras: 5,      // a cada quantas horas o contexto dos agentes é reiniciado (0 = nunca)
    briefing: true,       // Assessoria: a liderança faz a leitura do dia (Jira, agenda, quadros, conversas) e propõe o que fazer, sem esperar ordem
    briefingHora: '08:30',
    assessorAuto: false,       // Opt-in: projetos existentes preservam sua escolha explícita.
    segundoPlano: false,      // Opt-in visível: fechar a janela mantém o processo na bandeja.
    assessorIntervaloMin: 60,  // no mínimo este intervalo entre rondas, e no máximo 8 por dia; sinal igual ao da última ronda não gera chamada
    assessorCategorias: { agenda: true, jira: true, equipes: true, quadro: true, perguntas: true, custos: false },   // que sinais podem acordar o assessor
    assessorHorario: { inicio: '07:00', fim: '21:00' },   // fora disso o assessor não toma iniciativa (pedido direto continua valendo)
    statusPO: true,       // toda mudança de status de card aciona o P.O., que intervém e atualiza a Game Director
  },
  // Piloto automático: com o app aberto, o app olha o quadro (sem modelo) e acorda o P.O. quando há trabalho
  // para andar, para a equipe seguir sozinha enquanto a Game Director dorme ou está fora.
  piloto: { ativo: true, intervaloMin: 1, maxChamadasHora: 0, decideAposMin: 8, poDecide: true }, // 0 = sem limite artificial por hora
  // Relatório do dia: o app monta sozinho, sem modelo, na hora marcada (enquanto estiver aberto).
  relatorio: { ativo: true, hora: '18:00', comentarioPO: false },
  // Modelo local (Ollama nesta máquina): redação, classificação e extração de graça. Sem ele, o app segue sem essa camada.
  // falasMotor: 'haiku' (modelo mais barato do Claude escreve a fala de evento com a personalidade inteira; o local entra só como reserva),
  // 'local' (só o modelo local, tom curto) ou 'off'. O local sempre faz o que faz bem: extrair fatos, compactar log, filtrar pergunta.
  local: { ativo: true, url: 'http://127.0.0.1:11434', modelo: 'hf.co/bartowski/Qwen_Qwen3-4B-Instruct-2507-GGUF:Q4_K_M', timeoutMs: 90000, falas: true, falasMotor: 'haiku', triagem: true, extracao: true },
  // O limite de uso é o "fim do expediente": o app lê o consumo (sem modelo) e pausa os agentes.
  creditos: {
    pararEm: 95,          // % de uso (5 h ou semana) em que os agentes do Claude param até renovar
    trocarMotor: true,    // se um motor parou, passa o trabalho para o outro enquanto ele estiver livre
    automatico: true,     // a Cris escolhe modelo e raciocínio de cada chamada (conversa barata, difícil só quando precisa)
    codex: { leve: 'gpt-6-luna', medio: 'gpt-6.1-terra', forte: 'gpt-6.1-sol' }, // modelo do Codex por peso do card
    // Piso de modelo por cargo (vale sempre, mesmo com uso alto): forte = Opus 5 ou melhor (Sol no Codex); medio = Sonnet 5.5 (Terra); vazio = sem piso
    // A liderança de qualquer equipe (po, chief_of_staff, orquestrador...) tem piso medio por regra em equipe.mjs, mesmo fora desta lista.
    pisos: { architect: 'forte', revisor: 'forte', seguranca: 'forte', qa: 'medio', po: 'medio', versionamento: 'medio' },
    claude: { conversa: 'claude-haiku-4-5', baixo: 'claude-sonnet-4-6', medio: 'claude-sonnet-5-5', forte: 'claude-opus-5', maximo: 'claude-opus-5-5' }, // escada do Claude, do mais barato ao mais forte
  },
};

// A configuração é lida dezenas de vezes por segundo (cada pedido, cada tick, cada montagem de prompt). Reler e reparsear o arquivo
// a cada chamada pesava no laço de eventos; agora só relê quando o arquivo muda (data e tamanho) e devolve sempre uma cópia.
let cacheCfg = null;
function lerSettings() {
  const alvo = abs('settings.json');
  let st = null; try { st = fs.statSync(alvo); } catch { /* ainda não existe */ }
  if (st && cacheCfg && !cacheCfg.ausente && cacheCfg.m === st.mtimeMs && cacheCfg.s === st.size) return structuredClone(cacheCfg.dados);
  if (!st && cacheCfg?.ausente && Date.now() - cacheCfg.em < 2000) return structuredClone(cacheCfg.dados);
  const dados = ler('settings.json', CONFIG_PADRAO);
  cacheCfg = st ? { m: st.mtimeMs, s: st.size, dados } : { ausente: true, em: Date.now(), dados };
  return structuredClone(dados);
}

export function lerConfig() {
  const c = lerSettings();
  return {
    ...CONFIG_PADRAO,
    ...c,
    wip: { ...CONFIG_PADRAO.wip, ...(c.wip || {}) },
    ciclo: { ...CONFIG_PADRAO.ciclo, ...(c.ciclo || {}) },
    relatorio: { ...CONFIG_PADRAO.relatorio, ...(c.relatorio || {}) },
    piloto: { ...CONFIG_PADRAO.piloto, ...(c.piloto || {}) },
    local: { ...CONFIG_PADRAO.local, ...(c.local || {}) },
    creditos: { ...CONFIG_PADRAO.creditos, ...(c.creditos || {}), codex: { ...CONFIG_PADRAO.creditos.codex, ...((c.creditos || {}).codex || {}) }, claude: { ...CONFIG_PADRAO.creditos.claude, ...((c.creditos || {}).claude || {}) }, pisos: { ...CONFIG_PADRAO.creditos.pisos, ...((c.creditos || {}).pisos || {}) } },
  };
}

export function gravarConfig(c) {
  cacheCfg = null;
  gravar('settings.json', c);
}
