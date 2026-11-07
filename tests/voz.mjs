// Chamada de voz (simulada: sem microfone, sem modelo): iniciar com a liderança da equipe, mandar uma fala em WAV, a fala virar
// mensagem na DM, a resposta do agente virar áudio, interromper, encerrar e limpar. A proteção de origem (cabeçalho próprio) vale.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'work-ia-voz-'));
Object.assign(process.env, { STUDIO_DATA: path.join(tmp, 'data'), STUDIO_PROJETOS: path.join(tmp, 'projetos'), STUDIO_FAKE: '1', STUDIO_VOZ_FALSO_TEXTO: 'Helena, como está o projeto hoje?' });
const store = await import('../lib/store.mjs');
store.gravarConfig({ ...store.lerConfig(), piloto: { ativo: false, maxChamadasHora: 0 }, ciclo: { ...store.lerConfig().ciclo, fechamento: false, statusPO: false } });
const { iniciarServidor } = await import('../server.mjs');
const projetos = await import('../lib/projetos.mjs');
const srv = await iniciarServidor({ porta: 0 });
const base = `http://127.0.0.1:${srv.porta}`;
const J = async (m, u, b) => { const r = await fetch(base + u, { method: m, headers: { 'Content-Type': 'application/json' }, body: m === 'GET' ? undefined : JSON.stringify(b || {}) }); return { status: r.status, ...(await r.json().catch(() => ({}))) }; };
fs.mkdirSync(path.join(tmp, 'alvo'));
const pid = (await J('POST', '/api/projetos', { nome: 'Voz', caminho: path.join(tmp, 'alvo'), template: 'professional-operations' })).projeto.id;
const c = projetos.ctx(pid);
const wav = (seg) => { const n = Math.round(16000 * seg); const b = Buffer.alloc(44 + n * 2); b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(16000, 24); b.writeUInt32LE(32000, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 2, 40); return b; };

// eventos de voz pelo SSE, como a tela recebe
const eventos = [];
(async () => { const r = await fetch(`${base}/api/eventos`); const dec = new TextDecoder(); let resto = ''; for await (const ch of r.body) { resto += dec.decode(ch, { stream: true }); let i; while ((i = resto.indexOf('\n\n')) >= 0) { const bl = resto.slice(0, i); resto = resto.slice(i + 2); if (bl.startsWith('data: ')) { try { const e = JSON.parse(bl.slice(6)); if (e.tipo === 'voz') eventos.push(e); } catch { /* ignora */ } } } } })().catch(() => {});
const ate = async (cond, ms = 15000) => { for (let i = 0; i < ms / 50 && !cond(); i++) await new Promise((r) => setTimeout(r, 50)); assert(cond(), 'tempo esgotado'); };

assert.equal((await J('GET', `/api/p/${pid}/voz/estado`)).aberta, false);
const ini = await J('POST', `/api/p/${pid}/voz/iniciar`, { engine: 'claude', modo: 'conversar' });
assert.equal(ini.status, 200); assert.equal(ini.lider, 'chief_of_staff', 'a chamada é com a liderança da equipe (na Assessoria, a Helena)'); assert.equal(ini.canal, 'dm:chief_of_staff');
await ate(() => eventos.some((e) => e.estado === 'ouvindo'));

// fala sem o cabeçalho próprio: recusada (mesma proteção dos anexos)
const semCab = await fetch(`${base}/api/p/${pid}/voz/falar`, { method: 'POST', headers: { 'Content-Type': 'audio/wav' }, body: wav(1) });
assert.equal(semCab.status, 415);
// fala de verdade: vira mensagem na DM da liderança e a resposta vira áudio
const fala = await fetch(`${base}/api/p/${pid}/voz/falar`, { method: 'POST', headers: { 'Content-Type': 'audio/wav', 'x-studio-voz': '1' }, body: wav(1.5) });
const fj = await fala.json();
assert.equal(fala.status, 200); assert.equal(fj.texto, 'Helena, como está o projeto hoje?');
await ate(() => c.equipe.historico('dm:chief_of_staff').some((m) => m.de === 'voce' && m.texto === 'Helena, como está o projeto hoje?'));
await ate(() => eventos.some((e) => (e.estado === 'falando' && e.fim) || e.estado === 'fim'), 20000);
const fal = eventos.find((e) => e.estado === 'falando' && e.audio);
assert(fal, 'ao menos uma frase virou áudio'); assert(fal.texto && fal.texto.length > 3, 'o áudio corresponde ao texto da resposta');
assert(!/[*_`#]/.test(fal.texto), 'a fala vem sem marcação');
const au = await fetch(`${base}/api/p/${pid}/voz/audio/${fal.audio}`);
assert.equal(au.status, 200); assert.equal(au.headers.get('content-type'), 'audio/wav');
const bytes = Buffer.from(await au.arrayBuffer()); assert.equal(bytes.subarray(0, 4).toString(), 'RIFF');
const est = await J('GET', `/api/p/${pid}/voz/estado`);
assert.equal(est.aberta, true); assert.equal(est.transcricao.length, 2, 'a transcrição tem a sua fala e a resposta'); assert.equal(est.transcricao[0].de, 'voce');
// áudio vazio é ignorado, não vira mensagem
const vazio = await fetch(`${base}/api/p/${pid}/voz/falar`, { method: 'POST', headers: { 'Content-Type': 'audio/wav', 'x-studio-voz': '1' }, body: Buffer.alloc(100) });
assert.equal(vazio.status, 400);
// ---- reunião com tela compartilhada: o quadro sobe como anexo, vai junto só quando mudou, e o agente pode pedir para rever
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const up = await (await fetch(`${base}/api/p/${pid}/anexo?nome=tela.png`, { method: 'PUT', headers: { 'content-type': 'image/png', 'x-studio-anexo': '1' }, body: png })).json();
assert(up.anexo?.rel, 'o quadro da tela sobe como anexo normal');
assert.equal((await J('POST', `/api/p/${pid}/voz/tela`, { rel: up.anexo.rel })).ok, true);
assert.equal((await J('GET', `/api/p/${pid}/voz/estado`)).tela, true);
const antes = c.equipe.historico('dm:chief_of_staff').filter((m) => m.de === 'voce').length;
let f2 = await (await fetch(`${base}/api/p/${pid}/voz/falar`, { method: 'POST', headers: { 'Content-Type': 'audio/wav', 'x-studio-voz': '1' }, body: wav(1.5) })).json();
assert.equal(f2.tela, true, 'a tela mudou: o quadro vai junto com a fala');
await ate(() => c.equipe.historico('dm:chief_of_staff').filter((m) => m.de === 'voce').length > antes);
const comTela = c.equipe.historico('dm:chief_of_staff').filter((m) => m.de === 'voce').at(-1);
assert.equal(comTela.anexos?.length, 1, 'a mensagem na DM carrega o quadro'); assert.equal(comTela.anexos[0].imagem, true);
f2 = await (await fetch(`${base}/api/p/${pid}/voz/falar`, { method: 'POST', headers: { 'Content-Type': 'audio/wav', 'x-studio-voz': '1' }, body: wav(1.5) })).json();
assert.equal(f2.tela, false, 'tela igual à última vista: não manda a imagem de novo (gasto à toa)');
c.equipe.telaReuniao().pedido = { detalhe: 'alto' };   // o agente pediu tela.olhar
f2 = await (await fetch(`${base}/api/p/${pid}/voz/falar`, { method: 'POST', headers: { 'Content-Type': 'audio/wav', 'x-studio-voz': '1' }, body: wav(1.5) })).json();
assert.equal(f2.tela, true, 'o agente pediu para rever: o quadro vai de novo'); assert.equal(c.equipe.telaReuniao().pedido, null, 'o pedido vale uma rodada');
// níveis de gasto da reunião: padrão e ajuste
const nv = await J('GET', '/api/voz'); assert.deepEqual(nv.niveis, { fala: 'chat', tela: 'chat', analise: 'medium' }, 'por padrão a ligação usa o mesmo roteamento do chat');
assert.equal((await J('PUT', '/api/voz', { niveis: { fala: 'minimo', analise: 'high', tela: 'inválido' } })).niveis.fala, 'minimo');
assert.deepEqual((await J('GET', '/api/voz')).niveis, { fala: 'minimo', tela: 'chat', analise: 'high' }, 'valor inválido é ignorado, os outros valem');
// voz do agente: vozes brasileiras do app, escolha e prévia
const vz = await J('GET', '/api/voz');
assert(vz.vozes.length >= 4 && vz.vozes.some((v) => v.id === 'leni') && vz.vozes.at(-1).id === 'padrao', 'três vozes do app mais a padrão');
assert.equal(vz.voz.nome, 'leni', 'a voz padrão é brasileira, não a interna do modelo');
assert.equal((await J('PUT', '/api/voz', { voz: { nome: 'felipe', ritmo: 0.3, expressividade: 0.5 } })).voz.nome, 'felipe');
assert.equal((await J('PUT', '/api/voz', { voz: { nome: 'inexistente' } })).voz.nome, 'felipe', 'voz desconhecida não entra');
assert.equal((await J('POST', '/api/voz/previa', { nome: 'leni', ritmo: 0.4 })).ok, true);
assert.equal((await fetch(`${base}/api/voz/previa/audio`)).status, 200);
assert.equal((await fetch(`${base}/api/voz/amostra`, { method: 'PUT', headers: { 'x-studio-voz': '1', 'content-type': 'audio/wav' }, body: Buffer.alloc(100) })).status, 400, 'amostra curta demais é recusada');
// voz por agente: fica no perfil (estilo) e a chamada com ele usa essa voz
assert.equal((await J('PUT', `/api/p/${pid}/agente/chief_of_staff/estilo`, { voz: { nome: 'bilac', ritmo: 0.25, expressividade: 0.6 } })).ok, true);
assert.equal((await J('PUT', `/api/p/${pid}/agente/chief_of_staff/estilo`, { voz: { nome: '../x' } })).ok, false, 'nome de voz inválido é recusado');
assert.deepEqual(c.elenco.POR_ID.chief_of_staff.estilo.voz, { nome: 'bilac', ritmo: 0.25, expressividade: 0.6 });
await J('POST', `/api/p/${pid}/voz/encerrar`);
assert.equal((await J('POST', `/api/p/${pid}/voz/iniciar`, { engine: 'claude', modo: 'conversar' })).ok, true);
assert.equal((await J('GET', `/api/p/${pid}/voz/estado`)).voz.nome, 'bilac', 'a chamada com a Helena usa a voz do perfil dela');
// interromper e encerrar
assert.equal((await J('POST', `/api/p/${pid}/voz/interromper`)).ok, true);
assert.equal((await J('POST', `/api/p/${pid}/voz/encerrar`)).ok, true);
await ate(() => eventos.some((e) => e.estado === 'encerrada'));
assert.equal((await fetch(`${base}/api/p/${pid}/voz/audio/${fal.audio}`)).status, 404, 'encerrar apaga os áudios');
assert.equal((await J('GET', `/api/p/${pid}/voz/estado`)).aberta, false);
assert.equal((await fetch(`${base}/api/p/${pid}/voz/falar`, { method: 'POST', headers: { 'Content-Type': 'audio/wav', 'x-studio-voz': '1' }, body: wav(1) })).status, 400, 'sem chamada aberta, fala é recusada');
srv.encerrar(); await store.descarregar();
console.log('PASS: chamada de voz (simulada: iniciar com a liderança, fala vira mensagem na DM, resposta vira áudio, transcrição, tela compartilhada só quando muda ou o agente pede, níveis de gasto da reunião, interromper, encerrar limpa; cabeçalho de origem obrigatório).');
process.exit(0);
