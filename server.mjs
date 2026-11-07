// Servidor local do NECTAR. Sem dependências: só Node 22.
//   node studio/server.mjs   ->  http://localhost:4317
//
// Segurança: escuta só em 127.0.0.1 e recusa pedido de outra origem. Este servidor pode mandar um
// agente editar arquivos de um projeto, então um site qualquer aberto no navegador não pode
// conseguir falar com ele.
import http from 'node:http';
import { decidirEntrevista } from './lib/entrevista.mjs';
import { lerCurriculoPdf } from './lib/curriculo.mjs';
import { statusEntrevista } from './lib/entrevista-motores.mjs';
import { erroVisualRecuperavel } from './lib/entrevista-erros.mjs';
import { organizadorAvaliacoes } from './lib/avaliacoes-operacao.mjs';
import { ler as lerDiagnostico, gravar as gravarDiagnostico } from './lib/store.mjs';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { eventos, emitir } from './lib/bus.mjs';
import * as creditos from './lib/creditos.mjs';
import { lerConfig, gravarConfig, descarregarSync } from './lib/store.mjs';
import * as contas from './lib/contas.mjs';
import * as mcpReg from './lib/mcp.mjs';
import * as conexoes from './lib/conexoes.mjs';
import * as voz from './lib/voz.mjs';
import { criarElenco, listarTemplates, TEMPLATE_PADRAO } from './lib/agentes.mjs';
import { COLUNAS } from './lib/quadro.mjs';
import { prontidao, listaRessalvas } from './lib/workflow.mjs';
import { extrairTexto } from './lib/anexos.mjs';
import * as projetos from './lib/projetos.mjs';
import { executar, modelosCodex, infoCodex, infoClaude, atualizarUsoCodex, atualizarUsoClaude } from './lib/runner.mjs';

const PORTA = Number(process.env.STUDIO_PORT ?? 4317);
const PUBLICO = path.resolve(import.meta.dirname, 'public');

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.ttf': 'font/ttf', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json',
};

const json = (res, codigo, corpo) => {
  res.writeHead(codigo, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(corpo));
};

function origemOk(req) {
  if (!/^(localhost|127\.0\.0\.1):\d+$/.test(req.headers.host || '')) return false;
  const o = req.headers.origin;
  return !o || /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(o);
}

// Busca de GIF com cache: o mesmo termo devolve sempre o mesmo GIF (a conversa não muda ao recarregar).
const cacheGif = new Map();
async function buscarGif(q) {
  const k = q.toLowerCase();
  if (cacheGif.has(k)) return cacheGif.get(k);
  const g = lerConfig().gifs || {};
  if (!g.chave) return null;
  try {
    const u = g.provedor === 'tenor'
      ? `https://tenor.googleapis.com/v2/search?q=${encodeURIComponent(q)}&key=${encodeURIComponent(g.chave)}&limit=1&media_filter=gif&contentfilter=medium`
      : `https://api.giphy.com/v1/gifs/search?api_key=${encodeURIComponent(g.chave)}&q=${encodeURIComponent(q)}&limit=1&rating=pg-13`;
    const r = await fetch(u, { signal: AbortSignal.timeout(6000) });
    if (!r.ok) return null;
    const j = await r.json();
    const link = g.provedor === 'tenor' ? j.results?.[0]?.media_formats?.gif?.url : (j.data?.[0]?.images?.fixed_height?.url || j.data?.[0]?.images?.original?.url);
    if (link && /^https:\/\//.test(link)) { cacheGif.set(k, link); return link; }
  } catch { /* sem rede ou chave inválida */ }
  return null;
}

function corpoJson(req, limite = 1_000_000) {
  return new Promise((resolve, reject) => {
    let n = 0;
    const partes = [];
    req.on('data', (d) => {
      n += d.length;
      if (n > limite) { reject(new Error('corpo grande demais')); req.destroy(); return; }
      partes.push(d);
    });
    req.on('end', () => {
      try { resolve(partes.length ? JSON.parse(Buffer.concat(partes).toString('utf8')) : {}); }
      catch { reject(new Error('JSON inválido')); }
    });
  });
}

const LIMITE_ANEXO = 25 * 1024 * 1024;
/** Anexos já enviados antes (PUT /anexo): aqui só se confere que cada um existe dentro da pasta de anexos do projeto. */
function anexosValidos(c, lista) {
  const base = path.resolve(c.pasta, 'anexos');
  return (Array.isArray(lista) ? lista : []).slice(0, 8).map((a) => {
    const rel = String(a?.rel || '');
    const caminho = path.resolve(base, rel);
    if (!caminho.startsWith(base + path.sep) || !fs.existsSync(caminho)) return null;
    const ext = path.extname(caminho).toLowerCase();
    return { nome: path.basename(caminho).replace(/^\d{6}-/, ''), tipo: TIPOS_ANEXO[ext] || 'application/octet-stream', tamanho: fs.statSync(caminho).size, rel, caminho, imagem: ['.png', '.jpg', '.jpeg', '.gif', '.webp'].includes(ext) };
  }).filter(Boolean);
}
const TIPOS_ANEXO = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.pdf': 'application/pdf', '.txt': 'text/plain; charset=utf-8', '.md': 'text/markdown; charset=utf-8', '.json': 'application/json', '.csv': 'text/csv', '.log': 'text/plain; charset=utf-8', '.zip': 'application/zip' };

const MARCA = (() => { try { return JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname, 'marca.json'), 'utf8')); } catch { return { nome: 'nectar', sufixo: '' }; } })();

let ultimaAtividade = Date.now();

const estadoApp = () => ({
  marca: MARCA,
  roster: criarElenco(TEMPLATE_PADRAO).ROSTER, templates: listarTemplates(), colunas: COLUNAS, projetos: projetos.listar(), ativo: projetos.ativo(),
  config: lerConfig(), perguntas: projetos.perguntasAbertas(), uso: creditos.atual(), pausas: creditos.pausas(),
});

// Só o quadro: é o que a tela busca a cada mudança de card (o estado inteiro traz conversas, memória, posts, etc.).
const quadroDe = (c) => ({ cartoes: c.quadro.listar().map(card => ({ ...card, prontidao: prontidao(card), ressalvas: listaRessalvas(card), relatorios: (card.relatorios || []).map(({ texto, ...r }) => r) })), wip: c.quadro.estadoWip() });

const estadoProjeto = (c) => ({
  projeto: c.projeto, pastaProjeto: c.pasta, usuario: c.elenco.usuario, roster: c.elenco.ROSTER, template: c.elenco.template, lider: c.elenco.papeis.lead || 'po', equipeNome: c.projeto.equipeNome || null, naoLidas: c.notificacoes.naoLidas(), ...quadroDe(c),
  motores: c.equipe.motores(), planning: c.equipe.plannings(), grupos: c.equipe.grupos(), arquivadas: c.equipe.arquivadas(), posts: c.equipe.posts(), presenca: c.equipe.presencaAtual(), perguntas: c.equipe.perguntas().filter((p) => !p.paraPO).slice(-60), memoria: c.memoria.estado(),
  externos: projetos.colegasExternos(c.projeto.id),   // gente das outras equipes do projeto (menção e conversa entre equipes), com os nomes atuais
  fatos: c.equipe.fatos.listar(), jobs: c.equipe.jobs(),
  registro: { vista: c.equipe.registro.vista || 'Registro', total: c.equipe.registro.listar().length },
  teamwork: c.equipe.teamwork.snapshot(),
  custos: { cards: creditos.custosDoProjeto(c.projeto.id), envelope: creditos.envelope(lerConfig().engine) },
});

// ------------------------------------------------------------------ SSE
const ouvintes = new Set();
const sessoesVoz = voz.criarSessoes({ eventos, emitir });
eventos.on('evento', (e) => {
  const dados = `data: ${JSON.stringify(e)}\n\n`;
  for (const res of ouvintes) res.write(dados);
});
conexoes.aoMudar((app) => emitir({ tipo: 'conexoes', app }));
contas.aoMudar((engine) => emitir({ tipo: 'contas', engine }));
creditos.aoMudar((uso) => emitir({ tipo: 'uso', uso, pausas: creditos.pausas() }));
creditos.aoEvento(() => emitir({ tipo: 'pausa', pausas: creditos.pausas() }));
setInterval(() => { for (const res of ouvintes) res.write(': batimento\n\n'); }, 25_000).unref();

// ------------------------------------------------------------------ API de um projeto
async function apiProjeto(req, res, c, rota, url) {
  const m = req.method;
  const eq = c.equipe;
  const canalValido = (x) => /^(equipe|dm:[a-z_]+|plan-\d+|grp-\d+|pst-\d+)$/.test(x || '');

  if (m === 'GET' && rota === 'estado') return json(res, 200, estadoProjeto(c));
  if(m==='GET' && rota==='teamwork') return json(res,200,{...eq.teamwork.snapshot(),metrics:eq.teamwork.metrics()});
  if(m==='POST'&&rota==='teamwork/plans') {
    try{const b=await corpoJson(req);return json(res,201,{plan:eq.proporWorkflow(b)});}catch(e){return json(res,400,{erro:e.message});}
  }
  const taskReview=rota.match(/^teamwork\/tasks\/([a-f0-9-]+)\/review$/);
  if(m==='POST'&&taskReview){try{const b=await corpoJson(req);let t=eq.teamwork.tasks.obter(taskReview[1]);if(!t||t.version!==b.expectedVersion)return json(res,409,{erro:'version_conflict'});
    if(!b.reason?.trim()||typeof b.approved!=='boolean')return json(res,400,{erro:'Parecer e motivo são obrigatórios.'});
    const refs=t.result?.evidence||[];for(const ref of refs)eq.teamwork.artifacts.verificar(ref);
    if(!refs.length)return json(res,409,{erro:'evidence_missing'});
    if(b.approved)t=eq.teamwork.tasks.gate(t.taskId,t.version,{name:'evidence',actor:'system',outcome:'passed',executionId:t.result.executionId,evidence:refs});
    t=eq.teamwork.tasks.gate(t.taskId,t.version,{name:'review',actor:'user',outcome:b.approved?'passed':'failed',executionId:t.result.executionId,evidence:refs,reason:b.reason});
    if(b.approved&&t.requiredGates.includes('qa'))t=eq.teamwork.tasks.gate(t.taskId,t.version,{name:'qa',actor:'user',outcome:'passed',executionId:t.result.executionId,evidence:refs,reason:b.reason});
    if(b.approved){t=eq.teamwork.tasks.aceitar(t.taskId,t.version);if(!t.integrationRequired)t=eq.teamwork.tasks.concluir(t.taskId,t.version);}
    return json(res,200,{task:t});
  }catch(e){return json(res,409,{erro:e.message});}}
  const artRota=rota.match(/^teamwork\/artifacts\/([a-f0-9-]+)$/);
  if(m==='GET'&&artRota) {
    try{const a=eq.teamwork.artifacts.verificar(artRota[1]);const bytes=eq.teamwork.artifacts.ler(a.artifactId);res.writeHead(200,{'Content-Type':'application/octet-stream','Content-Disposition':`attachment; filename="${a.artifactId}.txt"`,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});return res.end(bytes);}
    catch(e){return json(res,404,{erro:e.message});}
  }
  // Arquivos da pasta da equipe: quanto ocupa cada coisa, a política de cada uma e a faxina sob demanda
  if (m === 'GET' && rota === 'arquivos') return json(res, 200, c.faxina.inventario());
  if (m === 'POST' && rota === 'faxina') return json(res, 200, c.faxina.executar());
  // Colmeia: arrastou um agente até outro agente ou até um card e escolheu ajudar, monitorar ou parar
  if (m === 'POST' && rota === 'colmeia') { const b = await corpoJson(req); const r = c.equipe.acaoColmeia({ acao: b.acao, agente: b.agente, alvoAgente: b.alvoAgente || null, card: b.card || null }); return json(res, r.ok ? 202 : 400, r); }
  if (m === 'GET' && rota === 'quadro') return json(res, 200, quadroDe(c));
  const relatorioRota=rota.match(/^cartao\/([A-Z]+-\d+)\/relatorio$/);
  if (relatorioRota && m==='GET') {
    const tipo=url.searchParams.get('tipo') || 'final';
    const revisao=url.searchParams.has('revisao') ? Number(url.searchParams.get('revisao')) : null;
    if (!['final','entrega','atividade'].includes(tipo) || (revisao!==null && (!Number.isInteger(revisao) || revisao<0))) return json(res,400,{erro:'Relatório inválido.'});
    const relatorios=c.quadro.obter(relatorioRota[1])?.relatorios || [];
    const arquivo=url.searchParams.get('arquivo');
    const r=[...relatorios].reverse().find(r=>r.tipo===tipo && (!arquivo || r.nome===arquivo) && (revisao===null || r.revisao===revisao));
    if (!r) return json(res,404,{erro:'Relatório não encontrado.'});
    res.writeHead(200,{'Content-Type':'text/markdown; charset=utf-8','Content-Disposition':`attachment; filename="${r.nome}"`,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
    return res.end(r.texto);
  }
  if (rota === 'decisoes') {
    if (m === 'GET') return json(res, 200, { decisoes: eq.decisoes() });
    if (m === 'POST') { try { return json(res, 201, { decisao: eq.proporDecisao(await corpoJson(req)) }); } catch(e) { return json(res, 400, { erro: e.message }); } }
  }
  const decisaoRota = rota.match(/^decisoes\/([a-z0-9-]+)\/aceitar$/);
  if (decisaoRota && m === 'POST') {
    try { const b = await corpoJson(req); return json(res, 200, { decisao: eq.aceitarDecisao(decisaoRota[1], b.revisao, b.opcao) }); }
    catch(e) { return json(res, 400, { erro: e.message }); }
  }
  const fluxoRota = rota.match(/^cartao\/([A-Z]+-\d+)\/workflow$/);
  if (fluxoRota && m === 'POST') {
    const b = await corpoJson(req), r = c.quadro.fluxo(fluxoRota[1], b.acao, b.dados || {}, 'voce');
    return json(res, r.ok ? 200 : 400, r);
  }
  if (m === 'GET' && rota === 'bastidores') return json(res, 200, eq.bastidores());
  if (m === 'GET' && rota === 'fatos') return json(res, 200, eq.fatos.listar());
  if (m === 'POST' && rota === 'fatos') { const b = await corpoJson(req); const r = eq.fatos.registrar({ escopo: b.escopo || 'projeto', chave: b.chave, valor: b.valor, evidencia: b.evidencia }); return json(res, r.ok ? 200 : 400, r); }
  if (m === 'DELETE' && rota === 'fatos') { const b = await corpoJson(req); return json(res, 200, eq.fatos.apagar(b.escopo || 'projeto', b.chave)); }
  if (m === 'GET' && rota === 'jobs') return json(res, 200, eq.jobs());
  if (m === 'GET' && rota === 'metricas') return json(res, 200, eq.metricas(Number(url.searchParams.get('dias')) || 30));
  if (m === 'GET' && rota === 'custos') return json(res, 200, { cards: creditos.custosDoProjeto(c.projeto.id), envelope: creditos.envelope(lerConfig().engine), estimativas: Object.fromEntries([1, 2, 3, 5].map((p) => [p, creditos.estimativaCard({ projeto: c.projeto.id, pontos: p })])) });
  const mj = rota.match(/^jobs\/(job-\w+)\/cancelar$/);
  if (m === 'POST' && mj) { const r = eq.cancelarJob(mj[1]); return json(res, r.ok ? 200 : 409, r); }
  let mc = rota.replace(/%3A/gi, ':').match(/^canal\/(equipe|dm:[a-z_]+|plan-\d+|grp-\d+|pst-\d+)$/);
  if (m === 'GET' && mc) return json(res, 200, eq.historico(mc[1]));

  if (m === 'GET' && rota === 'memoria') return json(res, 200, { notas: c.memoria.listar(), estado: c.memoria.estado() });

  // Registro do projeto (a bíblia, na equipe de novela): fichas anotadas uma vez e entregues prontas aos agentes.
  // A tela lê, anota como "voce", aprova referências e remove. Cada mudança avisa o navegador.
  if (rota === 'registro' && m === 'GET') {
    const reg = eq.registro; const usos = {};
    for (const card of c.quadro.listar()) for (const k of (card.contexto || [])) { const ch = reg.resolver(k); if (ch) (usos[ch] ||= []).push({ id: card.id, titulo: card.titulo, coluna: card.coluna, dono: card.dono }); }
    return json(res, 200, { vista: reg.vista || 'Registro', imagens: reg.imagens !== false, tipos: reg.tipos, entradas: reg.listar(), usos, raiz: c.projeto.raiz });
  }
  if (rota === 'registro' && m === 'POST') {
    const b = await corpoJson(req);
    const refs = [...(Array.isArray(b.refs) ? b.refs : []).map(String), ...anexosValidos(c, (Array.isArray(b.refsAnexo) ? b.refsAnexo : []).map((rel) => ({ rel }))).map((a) => a.caminho)];
    const r = eq.registro.anotar({ tipo: b.tipo, id: b.id, nome: b.nome, resumo: b.resumo, apelidos: b.apelidos, arquivo: b.arquivo, refs, tirarRefs: b.tirarRefs, tirarApelidos: b.tirarApelidos, modo: b.modo, por: 'voce' });
    if (r.ok) emitir({ tipo: 'registro', projeto: c.projeto.id, chave: r.entrada.chave });
    return json(res, r.ok ? 200 : 400, r);
  }
  { const mr = rota.match(/^registro\/(.+)$/);
    if (mr && m === 'DELETE') { const r = eq.registro.remover(decodeURIComponent(mr[1])); if (r.ok) emitir({ tipo: 'registro', projeto: c.projeto.id, chave: r.chave, removida: true }); return json(res, r.ok ? 200 : 404, r.ok ? r : { erro: 'Essa ficha não existe.' }); } }
  // O que a equipe gerou (imagens pedidas no chat, GIFs de storyboard, quadros nas pastas de episódio), do mais novo ao mais
  // antigo, com a ficha que já aprovou cada um como referência.
  if (rota === 'registro/galeria' && m === 'GET') {
    const IMG = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp']);
    const itens = []; const vistos = new Set();
    const varrer = (dir, origem, prof = 0) => {
      let lista = []; try { lista = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
      for (const d of lista) {
        const f = path.join(dir, d.name);
        if (d.isDirectory()) { if (prof < 4 && !/^(node_modules|\.git|anexos)$/.test(d.name)) varrer(f, origem, prof + 1); continue; }
        if (!IMG.has(path.extname(d.name).toLowerCase()) || vistos.has(f.toLowerCase())) continue;
        vistos.add(f.toLowerCase());
        try { const st = fs.statSync(f); itens.push({ caminho: f, nome: d.name, origem, gif: /\.gif$/i.test(d.name), tamanho: st.size, em: st.mtime.toISOString() }); } catch { /* sumiu no meio */ }
      }
    };
    varrer(path.join(c.pasta, 'anexos'), 'chat'); varrer(path.join(c.pasta, 'gifs'), 'storyboard');
    for (const sub of ['episodios', 'personagens', 'cenarios', 'biblia', 'referencias', 'imagens']) varrer(path.join(c.projeto.raiz, sub), 'projeto');
    const refsDe = new Map();
    for (const e of eq.registro.listar()) for (const r of e.refs) refsDe.set(path.resolve(path.isAbsolute(r) ? r : path.join(c.projeto.raiz, r)).toLowerCase(), e.chave);
    itens.sort((a, b) => b.em.localeCompare(a.em));
    return json(res, 200, { itens: itens.slice(0, 120).map((i) => ({ ...i, ficha: refsDe.get(path.resolve(i.caminho).toLowerCase()) || null })) });
  }
  // Um arquivo do projeto (referência aprovada, GIF, documento da bíblia), só de dentro da pasta do trabalho ou da pasta de registros.
  if (rota === 'arquivo' && m === 'GET') {
    const pedido = String(url.searchParams.get('caminho') || '');
    const arq = path.resolve(path.isAbsolute(pedido) ? pedido : path.join(c.projeto.raiz, pedido));
    const dentro = [c.projeto.raiz, c.pasta].some((b) => { const base = path.resolve(b); return arq.toLowerCase().startsWith(base.toLowerCase() + path.sep); });
    if (!dentro || !fs.existsSync(arq) || !fs.statSync(arq).isFile()) { res.writeHead(404); return res.end(); }
    const ext = path.extname(arq).toLowerCase();
    const inline = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.pdf', '.txt', '.md'].includes(ext);
    if (url.searchParams.get('texto') === '1') { try { return json(res, 200, { caminho: arq, texto: fs.readFileSync(arq, 'utf8').slice(0, 200_000) }); } catch (e) { return json(res, 400, { erro: e.message }); } }
    res.writeHead(200, { 'Content-Type': TIPOS_ANEXO[ext] || 'application/octet-stream', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-cache', 'Content-Security-Policy': "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'", 'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(path.basename(arq))}` });
    return fs.createReadStream(arq).pipe(res);
  }
  if (m === 'GET' && rota === 'combinados') return json(res, 200, { combinados: eq.combinados() });
  { const mcb = rota.match(/^combinados\/(\d+)$/); if (m === 'DELETE' && mcb) return json(res, 200, { removido: eq.removerCombinado(mcb[1]) }); }
  if (rota === 'regras-equipe') {
    if (m === 'GET') return json(res, 200, { regras: eq.regrasEquipe() });
    if (m === 'PUT') {
      try { return json(res, 200, { regra: eq.definirRegra(await corpoJson(req)) }); }
      catch (e) { return json(res, 400, { erro: e.message }); }
    }
  }
  if (m === 'GET' && rota === 'memoria/ler') {
    try { return json(res, 200, { caminho: url.searchParams.get('caminho'), texto: c.memoria.ler(url.searchParams.get('caminho')) }); }
    catch (e) { return json(res, 400, { erro: e.message }); }
  }

  // Anexos nos chats: o arquivo vai para <pasta do projeto>/anexos/<dia>/ e os agentes o leem de lá.
  if (rota === 'anexo' && m === 'PUT') {
    const nome = String(url.searchParams.get('nome') || 'arquivo').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').replace(/\s+/g, ' ').trim().slice(-90) || 'arquivo';
    const agoraD = new Date();
    const dia = agoraD.toISOString().slice(0, 10);
    const hora = agoraD.toTimeString().slice(0, 8).replace(/:/g, '');
    const relDir = dia;
    const destino = path.join(c.pasta, 'anexos', relDir, `${hora}-${nome}`);
    fs.mkdirSync(path.dirname(destino), { recursive: true });
    let total = 0; let estourou = false;
    const saida = fs.createWriteStream(destino);
    req.on('data', (d) => { total += d.length; if (total > LIMITE_ANEXO && !estourou) { estourou = true; saida.destroy(); req.destroy(); } });
    await new Promise((ok) => { req.pipe(saida); saida.on('finish', ok); saida.on('close', ok); saida.on('error', ok); req.on('error', ok); });
    if (estourou || total === 0) { try { fs.rmSync(destino, { force: true }); } catch { /* já foi */ } return json(res, 413, { erro: estourou ? 'O arquivo passou de 25 MB.' : 'Arquivo vazio.' }); }
    const ext = path.extname(nome).toLowerCase();
    const extraido = ext === '.pdf' ? await extrairTexto(destino) : null; // texto ao lado do PDF, para qualquer agente ler
    return json(res, 201, { ok: true, textoExtraido: extraido ? (extraido.ok ? `${extraido.chars} caracteres` : extraido.motivo) : null, anexo: { nome, tipo: TIPOS_ANEXO[ext] || 'application/octet-stream', tamanho: total, rel: `${relDir}/${hora}-${nome}`, imagem: ['.png', '.jpg', '.jpeg', '.gif', '.webp'].includes(ext) } });
  }
  const manexo = rota.match(/^anexo\/(.+)$/);
  if (manexo && m === 'GET') {
    const rel = decodeURIComponent(manexo[1]);
    const base = path.resolve(c.pasta, 'anexos');
    const arq = path.resolve(base, rel);
    if (!arq.startsWith(base + path.sep) || !fs.existsSync(arq) || !fs.statSync(arq).isFile()) { res.writeHead(404); return res.end(); }
    const ext = path.extname(arq).toLowerCase();
    const inline = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.pdf', '.txt'].includes(ext);
    res.writeHead(200, { 'Content-Type': TIPOS_ANEXO[ext] || 'application/octet-stream', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'", 'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(path.basename(arq))}` });
    return fs.createReadStream(arq).pipe(res);
  }

  // Perfil dos agentes: nome de pessoa (o @ segue o nome) e foto.
  const mperf = rota.match(/^agente\/([\w-]+)\/perfil$/);
  if (mperf && m === 'PUT') {
    try { const b = await corpoJson(req); const r = c.perfis.definirNome(mperf[1], b.nome); return json(res, r.ok ? 200 : 400, r.ok ? { ok: true } : r); }
    catch (e) { return json(res, 400, { erro: e.message }); }
  }
  // Foto e capa: guardadas como vieram (GIF animado) com o enquadramento à parte.
  const mfoto = rota.match(/^(?:agente\/([\w-]+)\/(foto|capa)|(foto|capa)\/([\w-]+))$/);
  if (mfoto) {
    const id = mfoto[1] || mfoto[4]; const tipo = mfoto[2] || mfoto[3];
    if (m === 'GET') {
      const f = c.perfis.arquivo(id, tipo);
      if (!f) { res.writeHead(404); return res.end(); }
      res.writeHead(200, { 'Content-Type': f.tipo, 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' });
      return fs.createReadStream(f.caminho).pipe(res);
    }
    try {
      if (m === 'POST') { const b = await corpoJson(req, 15_000_000); const r = tipo === 'capa' ? c.perfis.definirCapa(id, b.dataUrl, b.recorte) : c.perfis.definirFoto(id, b.dataUrl, b.recorte); return json(res, r.ok ? 200 : 400, r.ok ? { ok: true } : r); }
      if (m === 'DELETE') { const r = tipo === 'capa' ? c.perfis.removerCapa(id) : c.perfis.removerFoto(id); return json(res, r.ok ? 200 : 400, r.ok ? { ok: true } : r); }
    } catch (e) { return json(res, 400, { erro: e.message }); }
  }
  const mpp = rota.match(/^agente\/([\w-]+)\/personalidade-padrao$/);
  if (mpp && m === 'GET') return json(res, 200, { texto: c.elenco.personalidadePadrao(mpp[1]) });
  const mconv = rota.match(/^agente\/([\w-]+)\/conversa$/);
  if (mconv && m === 'PUT') {
    try { const b = await corpoJson(req); const r = c.perfis.definirConversa(mconv[1], b); return json(res, r.ok ? 200 : 400, r); }
    catch (e) { return json(res, 400, { erro: e.message }); }
  }
  const mest = rota.match(/^agente\/([\w-]+)\/estilo$/);
  if (mest && m === 'PUT') {
    try { const b = await corpoJson(req); const r = c.perfis.definirEstilo(mest[1], b); return json(res, r.ok ? 200 : 400, r.ok ? { ok: true, estilo: r.estilo } : r); }
    catch (e) { return json(res, 400, { erro: e.message }); }
  }

  // Canal Posts: publicações do time. Reagir é com a Game Director; responder é na conversa do post (canal pst-N).
  if (rota === 'posts' && m === 'GET') return json(res, 200, c.equipe.posts());
  if (rota === 'posts' && m === 'POST') {
    const b = await corpoJson(req);
    const titulo = String(b.titulo || '').trim(), corpo = String(b.corpo || '').trim();
    if (titulo.length < 3) return json(res, 400, { erro: 'Dê um título à publicação.' });
    if (corpo.length < 3) return json(res, 400, { erro: 'Escreva o texto da publicação.' });
    const base = path.resolve(c.pasta, 'anexos');
    const imagens = (Array.isArray(b.imagens) ? b.imagens : []).slice(0, 8).map((rel) => path.resolve(base, String(rel || ''))).filter((p) => p.startsWith(base + path.sep) && fs.existsSync(p));
    return json(res, 201, eq.publicarPostUsuario({ titulo: titulo.slice(0, 120), corpo: corpo.slice(0, 12000), imagens }));
  }
  const mpr = rota.match(/^posts\/(p\d+)\/reagir$/);
  if (mpr && m === 'POST') { const b = await corpoJson(req); return json(res, 200, c.equipe.reagirPost(mpr[1], String(b.emoji || ''), 'voce')); }

  // Grupos de trabalho: colegas que trabalham juntos fora do #equipe.
  if (rota === 'grupos' && m === 'GET') return json(res, 200, c.equipe.grupos());
  // Menu da conversa na lista lateral (botão direito): arquivar, excluir, adicionar membros. Limpar usa POST /limpar.
  if (m === 'POST' && /^conversa\/(arquivar|excluir|membros)$/.test(rota)) {
    const b = await corpoJson(req);
    if (!canalValido(b.canal)) return json(res, 400, { erro: 'Conversa inválida.' });
    const r = rota.endsWith('arquivar') ? c.equipe.arquivarConversa(b.canal, b.arquivar !== false) : rota.endsWith('excluir') ? c.equipe.excluirConversa(b.canal) : c.equipe.adicionarMembros(b.canal, b.membros);
    return json(res, r.ok ? 200 : 400, r);
  }
  const mgr = rota.match(/^grupos\/(grp-\d+)\/encerrar$/);
  if (mgr && m === 'POST') return json(res, 200, c.equipe.encerrarGrupoUsuario(mgr[1]));

  // Planning: grupos temporários em que o time discute uma demanda antes de existir qualquer card.
  if (rota === 'planning' && m === 'GET') return json(res, 200, c.equipe.plannings());
  const mpl = rota.match(/^planning\/(plan-\d+)\/cancelar$/);
  if (mpl && m === 'POST') return json(res, 200, c.equipe.cancelarPlanning(mpl[1]));

  // Motores do projeto: ligar ou desligar o Claude e o Codex e fixar o teto de esforço de cada um.
  if (rota === 'motores' && m === 'GET') return json(res, 200, c.equipe.motores());
  if (rota === 'motores' && m === 'PUT') { const b = await corpoJson(req); const r = c.equipe.salvarMotores(b); return json(res, r.erro ? 400 : 200, r); }

  // Vigia dos repositórios: quais repositórios acompanhar, de quanto em quanto tempo.
  if (rota === 'vigia' && m === 'GET') return json(res, 200, c.equipe.vigia.config());
  if (rota === 'vigia' && m === 'PUT') { const b = await corpoJson(req); return json(res, 200, c.equipe.vigia.salvar(b)); }
  if (rota === 'vigia/agora' && m === 'POST') return json(res, 200, await c.equipe.vigia.agora());

  // Pastas extras: além da pasta alvo, o time pode olhar estas.
  if (rota === 'extras' && m === 'PUT') {
    const b = await corpoJson(req);
    const r = projetos.definirExtras(c.projeto.projetoId || c.projeto.id, b.lista);
    return json(res, r.ok ? 200 : 400, r);
  }

  // Integrações (Jira e agenda): só leitura. O token nunca volta para a tela.
  if (rota === 'integracoes' && m === 'GET') return json(res, 200, c.integracoes.publico());
  if (rota === 'integracoes' && m === 'PUT') {
    const b = await corpoJson(req);
    const r = c.integracoes.salvarConfig(b);
    c.integracoes.sincronizar({ forcar: true }).catch(() => {});
    return json(res, 200, r);
  }
  if (rota === 'integracoes/sincronizar' && m === 'POST') { await c.integracoes.sincronizar({ forcar: true }); return json(res, 200, c.integracoes.publico()); }
  if (rota === 'integracoes/testar' && m === 'POST') {
    const b = await corpoJson(req);
    if (b.alvo === 'jira') {
      const r = await c.integracoes.lerJira({ url: b.jira?.url, tipo: b.jira?.tipo, usuario: b.jira?.usuario, jql: b.jira?.jql, token: b.jira?.token, max: 5 });
      return json(res, 200, r.ok ? { ok: true, total: r.total, amostra: r.itens.slice(0, 3).map((i) => `${i.key} ${i.resumo}`) } : r);
    }
    if (b.alvo === 'agenda') {
      const r = await c.integracoes.lerAgenda({ fonte: b.agenda?.fonte });
      const futuros = (r.eventos || []).filter((e) => e.fimTs >= Date.now()).slice(0, 4).map((e) => `${new Date(e.ts).toLocaleString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })} ${e.titulo}`);
      return json(res, 200, r.ok ? { ok: true, total: r.total, amostra: futuros } : r);
    }
    return json(res, 400, { erro: 'alvo desconhecido' });
  }
  if (rota === 'jira/trazer' && m === 'POST') {
    const b = await corpoJson(req);
    const item = (c.integracoes.demandas().itens || []).find((i) => i.key === String(b.key || '').toUpperCase());
    if (!item) return json(res, 404, { erro: 'Essa demanda não está na última leitura do Jira.' });
    const ja = c.quadro.listar().find((x) => x.jira === item.key);
    if (ja) return json(res, 409, { erro: `${item.key} já está no quadro como ${ja.id}.` });
    const prio = /highest|high|critical|blocker|alt|urgent/i.test(item.prioridade) ? 'alta' : /low|baix|trivial/i.test(item.prioridade) ? 'baixa' : 'normal';
    const r = c.quadro.criar({ titulo: item.resumo, descricao: `${item.descricao ? `${item.descricao}\n\n` : ''}${item.url}`, prioridade: prio, jira: item.key, coluna: 'backlog' }, 'voce');
    return json(res, r.ok ? 201 : 400, r);
  }

  // Pontos de salvamento: automáticos a cada 10 min (se algo mudou) e manuais pelo botão "Salvar projeto".
  if (rota === 'pontos' && m === 'GET') return json(res, 200, { lista: c.pontos.listar(), projeto: c.projeto.nome });
  if (rota === 'pontos' && m === 'POST') { const b = await corpoJson(req); const r = await c.pontos.salvar({ tipo: 'manual', rotulo: b.rotulo }); return json(res, r.ok ? 201 : 400, r); }
  const mpt = rota.match(/^pontos\/([\w-]+)(\/restaurar)?$/);
  if (mpt && mpt[2] && m === 'POST') { const r = await c.pontos.restaurar(mpt[1]); return json(res, r.ok ? 200 : 400, r); }
  if (mpt && !mpt[2] && m === 'DELETE') { const r = c.pontos.excluir(mpt[1]); return json(res, r.ok ? 200 : 400, r); }

  // Central de notificações e relatório do dia.
  if (rota === 'notificacoes' && m === 'GET') return json(res, 200, { lista: c.notificacoes.listar(150), naoLidas: c.notificacoes.naoLidas() });
  if (rota === 'notificacoes/lidas' && m === 'POST') { const b = await corpoJson(req); return json(res, 200, c.notificacoes.marcarLidas(b.ids === 'todas' ? 'todas' : (Array.isArray(b.ids) ? b.ids : []))); }
  if (rota === 'relatorio' && m === 'POST') { const b = await corpoJson(req); return json(res, 200, c.equipe.relatorio({ manual: true, comentar: !!b.comentar })); }

  // Regras e contexto: a Game Director ensina cada agente (e o projeto inteiro) sem mexer nos arquivos.
  const mr = rota.match(/^(?:agente\/([\w-]+)\/)?regras$/);
  if (mr) {
    const escopo = mr[1] || 'projeto';
    try {
      if (m === 'GET') return json(res, 200, { escopo, texto: c.memoria.lerRegras(escopo), itens: c.memoria.listaRegras(escopo), referencias: c.memoria.listarReferencias(escopo) });
      if (m === 'PUT') { const b = await corpoJson(req); return json(res, 200, Array.isArray(b.itens) ? c.memoria.gravarListaRegras(escopo, b.itens) : c.memoria.gravarRegras(escopo, b.texto)); }
    } catch (e) { return json(res, 400, { erro: e.message }); }
  }
  // .md feito por fora: de regras (o app extrai os tópicos e acumula na lista) ou de contexto (vira documento de referência)
  const mri = rota.match(/^(?:agente\/([\w-]+)\/)?regras\/importar$/);
  if (mri && m === 'POST') {
    try { const b = await corpoJson(req); return json(res, 200, c.memoria.importarRegras(mri[1] || 'projeto', b.texto)); }
    catch (e) { return json(res, 400, { erro: e.message }); }
  }
  const mrf = rota.match(/^(?:agente\/([\w-]+)\/)?referencias(?:\/([\w.-]+\.md))?$/);
  if (mrf) {
    const escopo = mrf[1] || 'projeto';
    try {
      if (m === 'GET' && !mrf[2]) return json(res, 200, { referencias: c.memoria.listarReferencias(escopo) });
      if (m === 'POST' && !mrf[2]) { const b = await corpoJson(req); return json(res, 200, c.memoria.importarReferencia(escopo, b.nome, b.texto)); }
      if (m === 'DELETE' && mrf[2]) return json(res, 200, c.memoria.removerReferencia(escopo, mrf[2]));
    } catch (e) { return json(res, 400, { erro: e.message }); }
  }
  const mcx = rota.match(/^agente\/([\w-]+)\/contexto$/);
  if (mcx && m === 'POST') {
    try { const b = await corpoJson(req); return json(res, 200, c.memoria.acrescentarContexto(mcx[1], b.texto)); }
    catch (e) { return json(res, 400, { erro: e.message }); }
  }

  if (m === 'POST' && rota === 'mensagem') {
    const b = await corpoJson(req);
    const texto = String(b.texto || '').trim();
    if (!texto && !(Array.isArray(b.anexos) && b.anexos.length)) return json(res, 400, { erro: 'Mensagem vazia' });
    if (!canalValido(b.canal)) return json(res, 400, { erro: 'Canal inválido' });
    const anexos = anexosValidos(c, b.anexos);
    if (!texto && !anexos.length) return json(res, 400, { erro: 'Mensagem vazia' });
    return json(res, 202, eq.enviar({ canal: b.canal, texto: texto || `(anexou ${anexos.length} ${anexos.length === 1 ? 'arquivo' : 'arquivos'})`, engine: b.engine, modo: b.modo, anexos }));
  }
  const mp = rota.match(/^agente\/([\w-]+)\/parar$/);
  if (m === 'POST' && mp) return json(res, 200, { cancelados: eq.cancelarAgente(mp[1]) });
  if (m === 'POST' && rota === 'cancelar') return json(res, 200, { cancelados: eq.cancelar() });
  // Depuração: quem roda e quem espera vaga; parar (todos ou um agente, inclusive na fila) usa /cancelar e /agente/:id/parar
  // Chamada de voz com a liderança da equipe (local: faster-whisper + Piper). A fala vira mensagem na DM; a resposta vira áudio.
  // Agenda do projeto (uma para todas as equipes): você cria e edita pela tela ou por aqui; os agentes, pelas ações agenda.*
  if (rota === 'ronda' && m === 'POST') { const r = c.equipe.rondaAssessor({ forcar: true }); return json(res, r.ok ? 202 : 400, r); }
  // Iniciativas do assessor: listar, aprovar ou cancelar (quem decide é você); e o resumo do que aconteceu desde que você saiu
  if (rota === 'iniciativas' && m === 'GET') return json(res, 200, { iniciativas: c.equipe.iniciativas.listar(), resumo: c.equipe.iniciativas.resumo() });
  if (rota === 'contrato' && m === 'GET') { const atual = c.equipe.contratos.atual(); return json(res, 200, { atual, cobertura: atual ? c.equipe.contratos.cobertura(atual.id) : null, historico: c.equipe.contratos.listar().filter((x) => !x.aberto).slice(-10) }); }
  if (rota === 'contrato/corrigir' && m === 'POST') { const b = await corpoJson(req); const atual = c.equipe.contratos.atual(); if (!atual) return json(res, 404, { erro: 'Não há contrato do pedido aberto.' }); return json(res, 200, { contrato: c.equipe.contratos.corrigir(atual.id, String(b.texto || '')) }); }
  const mi = rota.match(/^iniciativas\/(INIT-\d+)\/(aprovar|cancelar|reabrir)$/);
  if (mi && m === 'POST') { const r = c.equipe.decidirIniciativa(mi[1], mi[2]); return json(res, r.ok ? 200 : 400, r); }
  if (rota === 'desde' && m === 'GET') return json(res, 200, c.equipe.resumoDesde(url.searchParams.get('desde') || null));
  if (rota === 'briefing' && m === 'POST') { const b = await corpoJson(req); const r = c.equipe.briefing({ engine: b.engine, modo: b.modo }); return json(res, r.ok ? 202 : 400, r); }
  if (rota === 'agenda' && m === 'GET') return json(res, 200, { eventos: c.agenda.listar({ de: url.searchParams.get('de'), ate: url.searchParams.get('ate'), incluirCancelados: url.searchParams.get('cancelados') === '1' }) });
  if (rota === 'agenda' && m === 'POST') { const b = await corpoJson(req); const r = c.agenda.criar(b, 'voce'); return json(res, r.ok ? 201 : 400, r); }
  const mag = rota.match(/^agenda\/(ev-\d+)$/);
  if (mag && m === 'PUT') { const b = await corpoJson(req); const r = c.agenda.atualizar(mag[1], b, 'voce'); return json(res, r.ok ? 200 : 400, r); }
  if (mag && m === 'DELETE') { const r = c.agenda.remover(mag[1]); return json(res, r.ok ? 200 : 404, r); }
  if (m === 'POST' && rota === 'voz/iniciar') { const b = await corpoJson(req); const r = await sessoesVoz.iniciar(c, { engine: b.engine, modo: b.modo }); return json(res, r.ok ? 200 : 503, r); }
  if (m === 'POST' && rota === 'voz/falar') {
    const partes = []; let total = 0; for await (const ch of req) { total += ch.length; if (total > 25 * 1024 * 1024) return json(res, 413, { erro: 'Áudio grande demais.' }); partes.push(ch); }
    const relTela = req.headers['x-studio-tela'];   // quadro da tela compartilhada, já enviado como anexo
    const r = await sessoesVoz.falou(c, Buffer.concat(partes), { anexos: relTela ? anexosValidos(c, [{ rel: String(relTela) }]) : [] });
    return json(res, r.ok ? 200 : 400, r);
  }
  if (m === 'POST' && rota === 'voz/tela') { const b = await corpoJson(req); const [anexo] = b.rel ? anexosValidos(c, [{ rel: String(b.rel) }]) : []; return json(res, 200, sessoesVoz.tela(c, anexo || null)); }
  if (m === 'POST' && rota === 'voz/interromper') return json(res, 200, sessoesVoz.interromper(c));
  if (m === 'POST' && rota === 'voz/encerrar') return json(res, 200, sessoesVoz.encerrar(c));
  if (m === 'GET' && rota === 'voz/estado') return json(res, 200, { ...sessoesVoz.estado(c), servico: await voz.estadoServico() });
  const mva = rota.match(/^voz\/audio\/(\d+)$/);
  if (m === 'GET' && mva) { const a = sessoesVoz.audio(c, mva[1]); if (!a) return json(res, 404, { erro: 'áudio não encontrado' }); res.writeHead(200, { 'Content-Type': 'audio/wav', 'Cache-Control': 'no-store' }); return fs.createReadStream(a).pipe(res); }
  if (m === 'GET' && rota === 'chamadas') return json(res, 200, eq.chamadas());
  if (m === 'POST' && rota === 'chamadas/parar') { const b = await corpoJson(req); return json(res, 200, { cancelados: b.agente ? eq.cancelarAgente(String(b.agente)) : eq.cancelar(), ...eq.chamadas() }); }
  if (m === 'POST' && rota === 'chamadas/retomar') return json(res, 200, { retomou: eq.retomarPiloto(), ...eq.chamadas() });
  if (m === 'POST' && rota === 'limpar') {
    const b = await corpoJson(req);
    if (!canalValido(b.canal)) return json(res, 400, { erro: 'Canal inválido' });
    eq.limparCanal(b.canal);
    return json(res, 200, { ok: true });
  }
  if (m === 'POST' && ['ronda', 'curar', 'conhecer'].includes(rota)) {
    const b = await corpoJson(req);
    eq[rota]({ engine: b.engine, modo: b.modo });
    return json(res, 202, { ok: true });
  }
  mc = rota.match(/^perguntas\/(q\d+)\/delegar$/);
  if (m === 'POST' && mc) { const r = eq.delegarPergunta(mc[1]); return json(res, r.ok ? 200 : 409, r); }
  mc = rota.match(/^perguntas\/(q\d+)\/responder$/);
  if (m === 'POST' && mc) {
    const b = await corpoJson(req);
    const texto = String(b.texto || '').trim();
    if (!texto) return json(res, 400, { erro: 'Resposta vazia' });
    const r = eq.responder(mc[1], texto);
    return json(res, r.ok ? 200 : 409, r);
  }

  if (m === 'POST' && rota === 'ativar') { projetos.definirAtivo(c.projeto.projetoId || c.projeto.id); return json(res, 200, { ok: true }); }
  if (m === 'POST' && rota === 'renomear') {
    const b = await corpoJson(req);
    return json(res, projetos.renomear(c.projeto.projetoId || c.projeto.id, b.nome) ? 200 : 400, { ok: true });
  }
  // Equipes do projeto: adicionar (um template), renomear e tirar (os arquivos ficam na pasta)
  const pid = c.projeto.projetoId || c.projeto.id;
  if (m === 'POST' && rota === 'equipes') { const b = await corpoJson(req); const r = projetos.adicionarEquipe(pid, b); return json(res, r.ok ? 201 : 400, r); }
  const meq = rota.match(/^equipes\/([a-z0-9_]+)$/);
  if (meq && m === 'PUT') { const b = await corpoJson(req); const r = projetos.renomearEquipe(pid, meq[1], b.nome); return json(res, r.ok ? 200 : 400, r); }
  if (meq && m === 'DELETE') { const r = projetos.removerEquipe(pid, meq[1]); return json(res, r.ok ? 200 : 400, r); }
  if (m === 'POST' && rota === 'remover') { projetos.remover(c.projeto.projetoId || c.projeto.id); return json(res, 200, { ok: true }); }

  // cards
  const q = c.quadro;
  if (m === 'POST' && rota === 'cartao') {
    const r = q.criar(await corpoJson(req), 'voce');
    return json(res, r.ok ? 201 : 400, r);
  }
  mc = rota.match(/^cartao\/([A-Z]+-\d+)(?:\/(mover|comentar|bloquear|desbloquear|arquivar|pedir-status|validar))?$/);
  if (mc) {
    const [, id, acao] = mc;
    const b = m === 'GET' ? {} : await corpoJson(req);
    let r;
    if (m === 'PATCH' && !acao) r = q.atualizar(id, b.campos || b, 'voce');
    else if (m === 'POST' && acao === 'mover') r = q.mover(id, b.coluna, 'voce', { forcar: !!b.forcar, motivo: b.motivo });
    else if (m === 'POST' && acao === 'comentar') { r = q.comentar(id, b.texto, 'voce'); if (r.ok) r.chamados = eq.comentarCard(id, String(b.texto)).chamados; }
    else if (m === 'POST' && acao === 'pedir-status') { const x = eq.comentarCard(id, b.para ? `@${b.para} Como está o andamento deste card?` : 'Como está o andamento deste card?'); r = x.ok ? { ok: true, chamados: x.chamados } : x; }
    else if (m === 'POST' && acao === 'bloquear') r = q.bloquear(id, b.motivo, 'voce');
    else if (m === 'POST' && acao === 'desbloquear') r = q.desbloquear(id, 'voce');
    else if (m === 'POST' && acao === 'arquivar') r = q.arquivar(id, 'voce');
    else if (m === 'POST' && acao === 'validar') r = q.validar(id, !!b.ok, b.motivo, 'voce');
    else return json(res, 405, { erro: 'método não permitido' });
    return json(res, r.ok ? 200 : (r.wip ? 409 : 400), r);
  }
  return json(res, 404, { erro: 'não existe' });
}

// ------------------------------------------------------------------ API geral
async function api(req, res, url) {
  const m = req.method;
  const p = url.pathname;

  // JSON obrigatório em tudo que escreve: obriga o navegador a fazer a checagem de origem (CORS).
  // Exceção: o upload de anexo manda o arquivo cru. O cabeçalho próprio faz o navegador pedir permissão (preflight) a qualquer
  // site de fora, e este servidor não concede, então só a tela do app consegue enviar. Sem a exceção, nenhum anexo chegava.
  const uploadAnexo = m === 'PUT' && /^\/api\/p\/[\w-]+\/anexo$/.test(p) && req.headers['x-studio-anexo'] === '1';
  const audioVoz = m === 'POST' && /^\/api\/p\/[\w-]+\/voz\/falar$/.test(p) && req.headers['x-studio-voz'] === '1';   // a fala vem como WAV cru, com cabeçalho próprio (mesma proteção do anexo)
  const amostraVoz = m === 'PUT' && p === '/api/voz/amostra' && req.headers['x-studio-voz'] === '1';   // WAV de amostra da voz própria
  if (m !== 'GET' && !uploadAnexo && !audioVoz && !amostraVoz && !(req.headers['content-type'] || '').includes('application/json')) {
    return json(res, 415, { erro: 'use application/json' });
  }

  if (m === 'GET' && p === '/api/app') return json(res, 200, estadoApp());
  if(m==='GET'&&p==='/api/avaliacoes/operacao')return json(res,200,organizadorAvaliacoes.listar());
  const operacaoRota=p.match(/^\/api\/avaliacoes\/operacao\/([a-f0-9-]+)$/);
  if((m==='POST'&&p==='/api/avaliacoes/operacao')||(m==='PUT'&&operacaoRota)){
    try{const b=await corpoJson(req,20000);const tarefa=m==='POST'?organizadorAvaliacoes.criar(b):organizadorAvaliacoes.atualizar(operacaoRota[1],b);return json(res,m==='POST'?201:200,{tarefa});}
    catch(e){return json(res,e.status||400,{erro:e.message});}
  }
  if (m === 'GET' && p === '/api/entrevista/status') return json(res,200,await statusEntrevista());
  if (m === 'GET' && p === '/api/entrevista/diagnostico') return json(res,200,lerDiagnostico('entrevista-diagnostico.json',null));
  if (m === 'POST' && p === '/api/entrevista/diagnostico') {
    const b=await corpoJson(req,20000),curto=v=>String(v||'').slice(0,1200);
    gravarDiagnostico('entrevista-diagnostico.json',{em:new Date().toISOString(),inicio:curto(b.inicio),motivo:curto(b.motivo),modelo:curto(b.modelo),eventos:(Array.isArray(b.eventos)?b.eventos:[]).slice(-15).map(e=>({em:curto(e.em),estado:curto(e.estado),tipo:curto(e.tipo),modelo:curto(e.modelo)}))});
    return json(res,200,{ok:true});
  }
  if (m === 'POST' && p === '/api/entrevista/curriculo') {
    try { const b=await corpoJson(req,14000000); return json(res,200,await lerCurriculoPdf(b.pdf)); }
    catch(e){return json(res,400,{erro:e.message});}
  }
  if (m === 'POST' && p === '/api/entrevista/passo') {
    const controller=new AbortController();res.on('close',()=>controller.abort());
    const timer=setTimeout(()=>controller.abort(),280000);
    try { return json(res,200,{acao:await decidirEntrevista(await corpoJson(req,3200000),{signal:controller.signal})}); }
    catch(e){return json(res,400,{erro:e.message,recuperavel:erroVisualRecuperavel(e.message)});} finally{clearTimeout(timer);}
  }
  // A interface avisa que a pessoa está por aqui. Se ela volta depois de uma ausência longa, o app monta o
  // resumo do que o time fez nesse tempo (sem modelo).
  if (m === 'POST' && p === '/api/atividade') {
    const antes = ultimaAtividade;
    ultimaAtividade = Date.now();
    if (ultimaAtividade - antes >= (Number(process.env.STUDIO_AUSENCIA_MS) || 45 * 60_000)) {
      for (const c of projetos.todosContextos()) { try { c.equipe.voltou(new Date(antes)); } catch (e) { console.error('voltou:', e.message); } }
    }
    return json(res, 200, { ok: true });
  }
  if (m === 'GET' && p === '/api/templates') return json(res, 200, listarTemplates());
  // Conexões diretas com as contas (Jira, Trello, Teams): conectar no navegador, voltar para cá, desconectar.
  if (m === 'GET' && p === '/api/conexoes') return json(res, 200, conexoes.status());
  const mcx2 = p.match(/^\/api\/conexoes\/(jira|notion|github|trello|teams)\/(conectar|desconectar|cancelar|configurar|retorno|verificar)$/);
  if (mcx2) {
    const [, app, acao] = mcx2;
    const redirect = `http://127.0.0.1:${req.socket.localPort}/api/conexoes/${app}/retorno`;
    if (acao === 'retorno' && m === 'GET') {
      const pagina = (titulo, texto, script = '') => { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(`<!doctype html><meta charset="utf-8"><title>${titulo}</title><body style="font-family:system-ui;background:#111318;color:#e8eaf0;display:grid;place-items:center;height:100vh;margin:0"><div style="text-align:center"><h2>${titulo}</h2><p id="t">${texto}</p></div>${script}</body>`); };
      if (app === 'trello') return pagina('Conectando o Trello', 'Só um instante…', `<script>const h=new URLSearchParams(location.hash.slice(1));fetch(location.pathname,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({state:new URLSearchParams(location.search).get('state'),token:h.get('token')})}).then(r=>r.json()).then(j=>{document.getElementById('t').textContent=j.ok?'Pronto. Pode fechar esta aba e voltar ao NECTAR.':(j.erro||'Não conectou.')})</script>`);
      try { await conexoes.retorno(app, Object.fromEntries(url.searchParams)); return pagina(`${conexoes.APPS[app].nome} conectado`, 'Pronto. Pode fechar esta aba e voltar ao NECTAR.'); }
      catch (e) { return pagina('Não conectou', String(e.message).replace(/[<>&]/g, '')); }
    }
    if (m !== 'POST') return json(res, 405, { erro: 'método' });
    try {
      const b = await corpoJson(req);
      const r = acao === 'conectar' ? await conexoes.conectar(app, redirect) : acao === 'desconectar' ? conexoes.desconectar(app) : acao === 'cancelar' ? conexoes.cancelar(app) : acao === 'configurar' ? conexoes.configurar(app, b) : acao === 'verificar' ? { ok: true, status: await conexoes.verificar(app) } : await conexoes.retorno(app, b);
      return json(res, r.ok ? 200 : 400, r);
    } catch (e) { return json(res, 400, { erro: e.message }); }
  }
  // Leitura na conta conectada (Trello e Teams) para os agentes, por curl local: o token é posto aqui e nunca chega a eles.
  const mprox = p.match(/^\/api\/conexao\/(trello|teams|github)(\/.+)$/);
  if (mprox) {
    if (m !== 'GET') return json(res, 405, { erro: 'Só leitura (GET). Escrever na conta é decisão da Game Director.' });
    try {
      const q = new URLSearchParams(url.search); q.delete('key'); q.delete('token');
      const r = await conexoes.proxy(mprox[1], mprox[2], q.toString());
      res.writeHead(r.status, { 'Content-Type': r.headers.get('content-type') || 'application/json' });
      return res.end(Buffer.from(await r.arrayBuffer()));
    } catch (e) { return json(res, 400, { erro: e.message }); }
  }
  // MCPs conectados (página MCP): os do Claude Code desta máquina e os cadastrados aqui.
  // voz: qual sintetizador usar (piper = rápida, chatterbox = natural) e o estado do serviço local
  if (p === '/api/voz' && m === 'GET') return json(res, 200, { ...voz.lerVozConfig(), tts: 'chatterbox', niveis: voz.niveisVoz(), voz: voz.vozAtual(), vozes: voz.listarVozes(), servico: await voz.estadoServico() });
  if (p === '/api/voz' && m === 'PUT') {
    const b = await corpoJson(req); const novo = {};
    if (b.tts !== undefined) { if (!['piper', 'chatterbox'].includes(b.tts)) return json(res, 400, { erro: 'voz desconhecida' }); novo.tts = b.tts; }
    if (b.niveis && typeof b.niveis === 'object') { const ok = ['chat', 'minimo', 'low', 'medium', 'high']; novo.niveis = { ...voz.niveisVoz() }; for (const k of ['fala', 'tela', 'analise']) if (ok.includes(b.niveis[k])) novo.niveis[k] = b.niveis[k]; }
    if (b.voz && typeof b.voz === 'object') {
      const v = { ...voz.vozAtual() };
      if (voz.listarVozes().some((x) => x.id === b.voz.nome)) v.nome = b.voz.nome;
      if (Number.isFinite(Number(b.voz.ritmo))) v.ritmo = Number(b.voz.ritmo);
      if (Number.isFinite(Number(b.voz.expressividade))) v.expressividade = Number(b.voz.expressividade);
      novo.voz = v;
    }
    return json(res, 200, { ...voz.definirVozConfig(novo), niveis: voz.niveisVoz(), voz: voz.vozAtual(), vozes: voz.listarVozes() });
  }
  // amostra da própria voz (WAV cru) e prévia da voz escolhida
  if (p === '/api/voz/amostra' && m === 'PUT') { const partes = []; let total = 0; for await (const ch of req) { total += ch.length; if (total > 16 * 1024 * 1024) return json(res, 413, { erro: 'A amostra passou de 15 MB.' }); partes.push(ch); } try { voz.salvarAmostra(Buffer.concat(partes)); return json(res, 200, { ok: true, vozes: voz.listarVozes() }); } catch (e) { return json(res, 400, { erro: e.message }); } }
  if (p === '/api/voz/previa' && m === 'POST') { const b = await corpoJson(req); try { return json(res, 200, await voz.previa({ nome: b.nome, ritmo: b.ritmo, expressividade: b.expressividade, texto: typeof b.texto === 'string' ? b.texto.slice(0, 300) : undefined })); } catch (e) { return json(res, 503, { erro: e.message }); } }
  if (p === '/api/voz/previa/audio' && m === 'GET') { const a = voz.arquivoPrevia(); if (!a) return json(res, 404, { erro: 'sem prévia' }); res.writeHead(200, { 'Content-Type': 'audio/wav', 'Cache-Control': 'no-store' }); return fs.createReadStream(a).pipe(res); }
  if (p === '/api/mcp' && m === 'GET') return json(res, 200, mcpReg.listar());
  if (p === '/api/mcp' && m === 'POST') { const b = await corpoJson(req); const r = mcpReg.adicionar(b); return json(res, r.ok ? 200 : 400, r); }
  const mmcp = p.match(/^\/api\/mcp\/([\w-]+)$/);
  if (mmcp && m === 'PUT') { const b = await corpoJson(req); const r = mcpReg.definir(mmcp[1], b); return json(res, r.ok ? 200 : 400, r); }
  if (mmcp && m === 'DELETE') { const r = mcpReg.remover(mmcp[1]); return json(res, r.ok ? 200 : 400, r); }
  // Contas do Claude e do Codex (página Modelos): status, conectar pelo site oficial e desconectar.
  if (m === 'GET' && p === '/api/contas') {
    const cfg = lerConfig(); const forcar = url.searchParams.get('forcar') === '1';
    const [claude, codex] = await Promise.all([contas.status('claude', cfg, forcar), contas.status('codex', cfg, forcar)]);
    return json(res, 200, { claude, codex, instalar: contas.COMO_INSTALAR, plataforma: process.platform });
  }
  const mct = p.match(/^\/api\/contas\/(claude|codex)\/(conectar|desconectar|cancelar)$/);
  if (m === 'POST' && mct) {
    const cfg = lerConfig();
    const r = mct[2] === 'conectar' ? await contas.conectar(mct[1], cfg) : mct[2] === 'desconectar' ? await contas.desconectar(mct[1], cfg) : contas.cancelarLogin(mct[1]);
    return json(res, r.ok ? 200 : 400, r);
  }
  // GIFs da comunidade (GIPHY ou Tenor): o agente escreve [gif: termo] e a tela pede /api/gif?q=termo, que redireciona ao GIF.
  if (p === '/api/gifs' && m === 'GET') { const g = lerConfig().gifs || {}; return json(res, 200, { provedor: g.provedor || 'giphy', configurado: !!g.chave }); }
  if (p === '/api/gifs' && m === 'PUT') {
    const b = await corpoJson(req); const cfg = lerConfig();
    const provedor = b.provedor === 'tenor' ? 'tenor' : 'giphy';
    gravarConfig({ ...cfg, gifs: { provedor, chave: b.chave === undefined ? cfg.gifs?.chave || '' : String(b.chave || '').trim().slice(0, 200) } });
    return json(res, 200, { ok: true, provedor, configurado: !!lerConfig().gifs?.chave });
  }
  if (p === '/api/gif' && m === 'GET') {
    const q = String(url.searchParams.get('q') || '').trim().slice(0, 80);
    const url2 = q ? await buscarGif(q) : null;
    if (!url2) { res.writeHead(404); return res.end(); }
    res.writeHead(302, { Location: url2, 'Cache-Control': 'max-age=86400' }); return res.end();
  }
  if (m === 'GET' && p === '/api/uso') return json(res, 200, { uso: creditos.atual(), pausas: creditos.pausas(), politica: creditos.equilibrio(), relatorio: creditos.relatorio() });
  if (m === 'GET' && p === '/api/perguntas') return json(res, 200, projetos.perguntasAbertas());

  if (m === 'GET' && p === '/api/eventos') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
    res.write('retry: 2000\n\n');
    ouvintes.add(res);
    req.on('close', () => ouvintes.delete(res));
    return;
  }

  if (m === 'GET' && p === '/api/modelos-codex') return json(res, 200, await modelosCodex(lerConfig().codexExe));
  if (m === 'GET' && p === '/api/claude-versoes') {
    const info = await infoClaude(true);
    return json(res, 200, { opcoes: info.opcoes.map((o) => ({ id: o.id, rotulo: o.rotulo, versao: o.versao })), maisNovo: info.maisNovo?.id || null });
  }
  if (m === 'GET' && p === '/api/codex-versoes') {
    const info = await infoCodex(true);
    return json(res, 200, { opcoes: info.opcoes.map((o) => ({ id: o.id, rotulo: o.rotulo, versao: o.versao })), maisNovo: info.maisNovo?.id || null });
  }

  if (m === 'POST' && p === '/api/config') {
    const b = await corpoJson(req);
    const atual = lerConfig();
    const novo = {
      ...atual,
      engine: ['claude', 'codex'].includes(b.engine) ? b.engine : atual.engine,
      modo: ['conversar', 'trabalhar'].includes(b.modo) ? b.modo : atual.modo,
      modeloClaude: typeof b.modeloClaude === 'string' ? b.modeloClaude.trim().slice(0, 80) : atual.modeloClaude,
      esforcoCodex: ['', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'].includes(b.esforcoCodex) ? b.esforcoCodex : atual.esforcoCodex,
      esforcoClaude: ['', 'low', 'medium', 'high', 'xhigh', 'max'].includes(b.esforcoClaude) ? b.esforcoClaude : atual.esforcoClaude,
      claudeExe: typeof b.claudeExe === 'string' ? b.claudeExe.trim().slice(0, 200) : atual.claudeExe,
      modeloCodex: typeof b.modeloCodex === 'string' ? b.modeloCodex.trim().slice(0, 80) : atual.modeloCodex,
      codexExe: typeof b.codexExe === 'string' ? b.codexExe.trim().slice(0, 200) : atual.codexExe,
      idioma: ['pt-BR', 'en', 'es', 'fr', 'zh-CN', 'ja', 'ko', 'ru'].includes(b.idioma) ? b.idioma : (atual.idioma || 'en'),
    };
    if (b.wip && typeof b.wip === 'object') {
      for (const k of Object.keys(atual.wip)) {
        const n = Number(b.wip[k]);
        if (Number.isInteger(n) && n >= 1 && n <= 20) novo.wip[k] = n;
      }
    }
    if (b.ciclo && typeof b.ciclo === 'object') {
      const n = Number(b.ciclo.orcamento);
      if (Number.isInteger(n) && n >= 2 && n <= 40) novo.ciclo.orcamento = n;
      const lh = Number(b.ciclo.limpezaHoras);
      if ([0, 2, 3, 5, 8, 12, 24].includes(lh)) novo.ciclo.limpezaHoras = lh;
      const pm = Number(b.ciclo.pontosMax);
      if ([3, 5, 8].includes(pm)) novo.ciclo.pontosMax = pm;
      const pa = Number(b.ciclo.paralelo);
      if (Number.isInteger(pa) && pa >= 1 && pa <= 6) novo.ciclo.paralelo = pa;
      for (const k of ['revisaoAuto', 'curadoriaAuto', 'fechamento', 'statusPO', 'versionar', 'planningReplica', 'posts', 'assessorAuto', 'briefing']) if (typeof b.ciclo[k] === 'boolean') novo.ciclo[k] = b.ciclo[k];
      const ai = Number(b.ciclo.assessorIntervaloMin);
      if ([15, 30, 60, 120, 240].includes(ai)) novo.ciclo.assessorIntervaloMin = ai;
      if (b.ciclo.assessorCategorias && typeof b.ciclo.assessorCategorias === 'object') { novo.ciclo.assessorCategorias = { ...novo.ciclo.assessorCategorias }; for (const k of ['agenda', 'jira', 'equipes', 'quadro', 'perguntas', 'custos']) if (typeof b.ciclo.assessorCategorias[k] === 'boolean') novo.ciclo.assessorCategorias[k] = b.ciclo.assessorCategorias[k]; }
      if (b.ciclo.assessorHorario && typeof b.ciclo.assessorHorario === 'object') { const h = (x) => (/^\d{2}:\d{2}$/.test(String(x || '')) ? x : null); novo.ciclo.assessorHorario = { inicio: h(b.ciclo.assessorHorario.inicio) || novo.ciclo.assessorHorario?.inicio || '07:00', fim: h(b.ciclo.assessorHorario.fim) || novo.ciclo.assessorHorario?.fim || '21:00' }; }
    }
    if (b.piloto && typeof b.piloto === 'object') {
      if (typeof b.piloto.ativo === 'boolean') novo.piloto.ativo = b.piloto.ativo;
      const im = Number(b.piloto.intervaloMin);
      if ([2, 5, 10, 20, 30, 60].includes(im)) novo.piloto.intervaloMin = im;
      const mh = Number(b.piloto.maxChamadasHora);
      if (Number.isInteger(mh) && (mh === 0 || (mh >= 4 && mh <= 120))) novo.piloto.maxChamadasHora = mh;
      if (typeof b.piloto.poDecide === 'boolean') novo.piloto.poDecide = b.piloto.poDecide;
      const dm = Number(b.piloto.decideAposMin);
      if ([0, 3, 8, 15, 30, 60].includes(dm)) novo.piloto.decideAposMin = dm;
    }
    if (b.local && typeof b.local === 'object') {
      novo.local = { ...novo.local };
      if (typeof b.local.ativo === 'boolean') novo.local.ativo = b.local.ativo;
      if (/^https?:\/\/[\w.:-]+$/.test(String(b.local.url || ''))) novo.local.url = String(b.local.url).replace(/\/$/, '');
      if (typeof b.local.modelo === 'string') novo.local.modelo = b.local.modelo.trim().slice(0, 160);
      for (const k of ['falas', 'triagem', 'extracao']) if (typeof b.local[k] === 'boolean') novo.local[k] = b.local[k];
      if (['haiku', 'local', 'off'].includes(b.local.falasMotor)) novo.local.falasMotor = b.local.falasMotor;
    }
    if (b.relatorio && typeof b.relatorio === 'object') {
      if (typeof b.relatorio.ativo === 'boolean') novo.relatorio.ativo = b.relatorio.ativo;
      if (typeof b.relatorio.comentarioPO === 'boolean') novo.relatorio.comentarioPO = b.relatorio.comentarioPO;
      if (/^([01]\d|2[0-3]):[0-5]\d$/.test(String(b.relatorio.hora || ''))) novo.relatorio.hora = b.relatorio.hora;
    }
    if (b.creditos && typeof b.creditos === 'object') {
      const pe = Number(b.creditos.pararEm);
      if (Number.isInteger(pe) && pe >= 50 && pe <= 100) novo.creditos.pararEm = pe;
      if (typeof b.creditos.trocarMotor === 'boolean') novo.creditos.trocarMotor = b.creditos.trocarMotor;
      if (typeof b.creditos.automatico === 'boolean') novo.creditos.automatico = b.creditos.automatico;
      for (const k of ['leve', 'medio', 'forte']) if (typeof b.creditos.codex?.[k] === 'string') novo.creditos.codex[k] = b.creditos.codex[k].trim().slice(0, 80);
      if (b.creditos.pisos && typeof b.creditos.pisos === 'object') for (const [id, v] of Object.entries(b.creditos.pisos)) if (/^[a-z_]{1,30}$/.test(id) && ['', 'baixo', 'medio', 'forte', 'maximo'].includes(v)) novo.creditos.pisos[id] = v;
    }
    gravarConfig(novo);
    return json(res, 200, novo);
  }

  if (m === 'POST' && p === '/api/testar') {
    const b = await corpoJson(req);
    if (!['claude', 'codex'].includes(b.engine)) return json(res, 400, { erro: 'engine inválida' });
    const cfg = lerConfig();
    const r = await executar({
      engine: b.engine, prompt: 'Agente: po\nTipo desta chamada: teste\nResponda apenas com a palavra OK.', modo: 'conversar',
      somenteLeitura: true, modelo: b.engine === 'codex' ? cfg.modeloCodex : cfg.modeloClaude, esforco: b.engine === 'codex' ? cfg.esforcoCodex : cfg.esforcoClaude, codexExe: cfg.codexExe, claudeExe: cfg.claudeExe, cwd: os.tmpdir(),
    });
    return json(res, 200, r.erro ? { ok: false, erro: r.erro, ms: r.duracaoMs } : { ok: true, texto: (r.texto || '').trim().slice(0, 80), ms: r.duracaoMs });
  }

  if (m === 'POST' && p === '/api/pasta/validar') {
    const b = await corpoJson(req);
    return json(res, 200, projetos.validarPasta(b.caminho));
  }

  if (m === 'POST' && p === '/api/projetos') {
    const b = await corpoJson(req);
    const r = projetos.criar({ nome: b.nome, caminho: b.caminho, template: b.template });
    if (!r.ok) return json(res, 400, r);
    if (b.conhecer) projetos.ctx(r.projeto.id).equipe.conhecer({ engine: b.engine, modo: b.modo });
    return json(res, 201, r);
  }

  const mp = p.match(/^\/api\/p\/([\w-]+)\/(.+)$/);
  if (mp) {
    const c = projetos.ctx(mp[1]);
    if (!c) return json(res, 404, { erro: 'Projeto não encontrado, ou a pasta dele não existe mais.' });
    return apiProjeto(req, res, c, mp[2], url);
  }
  return json(res, 404, { erro: 'não existe' });
}

// ------------------------------------------------------------------ estático
function estatico(res, url) {
  const nome = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname).slice(1);
  const arquivo = path.resolve(PUBLICO, nome);
  if (!arquivo.startsWith(PUBLICO + path.sep)) { res.writeHead(403); return res.end(); }
  fs.readFile(arquivo, (err, dados) => {
    if (err) { res.writeHead(404); return res.end('não encontrado'); }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(arquivo)] || 'application/octet-stream',
      'Cache-Control': 'no-store',
      // O app mostra texto escrito por agentes. Mesmo que algo escapasse do escape de HTML, a página
      // só carrega script e dados do próprio servidor, e não pode ser posta dentro de outra página.
      'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
      'X-Content-Type-Options': 'nosniff',
    });
    res.end(dados);
  });
}

const servidor = http.createServer(async (req, res) => {
  if (!origemOk(req)) { res.writeHead(403); return res.end('origem não permitida'); }
  const url = new URL(req.url, 'http://localhost');
  try {
    if (url.pathname.startsWith('/api/')) await api(req, res, url);
    else estatico(res, url);
  } catch (e) {
    if (!res.headersSent) json(res, 500, { erro: String(e.message || e) });
    else res.end();
  }
});

/**
 * Liga o servidor. porta 0 = o sistema escolhe uma livre (é o que o aplicativo faz).
 * projetoPadrao { nome, caminho, legados }: usado só na primeira abertura, quando ainda não há projeto.
 */
export function iniciarServidor({ porta = PORTA, abrirNavegador = false, projetoPadrao = null } = {}) {
  // uso das duas contas lido a cada minuto, sem gastar chamada de modelo: o painel não envelhece com os agentes parados
  const lerUsos = () => { atualizarUsoCodex().catch(() => {}); atualizarUsoClaude().catch(() => {}); try { projetos.tiquetaqueAgendas(); } catch { /* agenda sem projeto aberto */ } };
  lerUsos();
  const usoTimer = setInterval(lerUsos, 60_000);
  usoTimer.unref();
  if (projetoPadrao) projetos.garantirPadrao(projetoPadrao);
  projetos.iniciarTodos();
  // Relatório do dia: confere a hora a cada minuto (e uma vez logo ao abrir, para o que ficou para trás).
  const conferirRelatorios = () => { for (const c of projetos.todosContextos()) { try { c.equipe.verificarRelatorio(); c.equipe.verificarBriefing?.(); c.equipe.rondaAssessor?.(); } catch (e) { console.error('relatório:', e.message); } } };
  // Piloto automático: a cada minuto o app confere se há trabalho para andar (só leitura do quadro, sem modelo).
  const conferirPiloto = () => { for (const c of projetos.todosContextos()) { try { c.equipe.pilotoTick(); } catch (e) { console.error('piloto:', e.message); } } };
  setTimeout(conferirPiloto, 3000).unref();
  const pilotoTimer = setInterval(conferirPiloto, Number(process.env.STUDIO_PILOTO_TICK_MS) || 5000);
  pilotoTimer.unref();
  // Jira e agenda: relê no intervalo de cada projeto e avisa antes das reuniões.
  const conferirIntegracoes = () => { for (const c of projetos.todosContextos()) c.integracoes.tick().catch((e) => console.error('integrações:', e.message)); };
  setTimeout(conferirIntegracoes, 5_000).unref();
  setInterval(conferirIntegracoes, 60_000).unref();
  const conferirVigia = () => { for (const c of projetos.todosContextos()) { c.equipe.vigia.tick().catch((e) => console.error('vigia:', e.message)); try { c.equipe.guarda.tick(); } catch (e) { console.error('guarda:', e.message); } c.pontos.tick().catch((e) => console.error('pontos:', e.message)); try { c.faxina?.tick(); } catch (e) { console.error('faxina:', e.message); } } };
  setTimeout(conferirVigia, 20_000).unref();
  setInterval(conferirVigia, 60_000).unref();
  setTimeout(conferirRelatorios, 8_000).unref();
  setInterval(conferirRelatorios, 60_000).unref();
  return new Promise((resolve, reject) => {
    servidor.once('error', reject);
    servidor.listen(porta, '127.0.0.1', () => {
      const real = servidor.address().port;
      console.log(`${MARCA.nome}${MARCA.sufixo} no ar: http://localhost:${real}${process.env.STUDIO_FAKE === '1' ? '  (MODO DE TESTE: respostas falsas, nenhum modelo é chamado)' : ''}`);
      process.env.STUDIO_PORTA_REAL = String(real);
      if (abrirNavegador) { const u = `http://localhost:${real}`; const [c, a] = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', u]] : process.platform === 'darwin' ? ['open', [u]] : ['xdg-open', [u]]; spawn(c, a, { stdio: 'ignore', detached: true, windowsHide: true }).unref(); }
      resolve({
        porta: real,
        // Fechar o app não pode deixar agente rodando solto: cancela tudo antes de desligar.
        encerrar() {
          clearInterval(usoTimer);
          clearInterval(pilotoTimer);
          for (const p of projetos.listar()) projetos.ctx(p.id)?.equipe.cancelar();
          for (const r of ouvintes) r.end();
          servidor.closeAllConnections?.();
          servidor.close();
          voz.encerrarServico();
          descarregarSync();   // o que ainda esperava para ser gravado (quadro, conversas) vai para o disco antes de fechar
        },
      });
    });
  });
}

// Rodado direto (node server.mjs): liga sozinho. Importado pelo Electron: só exporta.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const padrao = process.env.STUDIO_PROJETO_PADRAO ? { nome: path.basename(process.env.STUDIO_PROJETO_PADRAO), caminho: process.env.STUDIO_PROJETO_PADRAO } : null;
  iniciarServidor({ abrirNavegador: process.env.STUDIO_ABRIR === '1', projetoPadrao: padrao }).catch((e) => {
    console.error(e.code === 'EADDRINUSE' ? `A porta ${PORTA} já está em uso. Feche a outra janela do estúdio.` : e);
    process.exit(1);
  });
}
