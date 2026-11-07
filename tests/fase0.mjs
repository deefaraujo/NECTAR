// Phase 0 of the efficiency plan: an acknowledgement does not become a message or a call; a chat phrase does not become a caveat;
// the same mention with an unchanged card does not call again; a slow command runs as an app job and the result comes back measured.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'work-ia-fase0-'));
process.env.STUDIO_DATA = path.join(tmp, 'data'); process.env.STUDIO_PROJETOS = path.join(tmp, 'projetos'); process.env.STUDIO_FAKE = '1';
const store = await import('../lib/store.mjs');
store.gravarConfig({ piloto: { ativo: false, maxChamadasHora: 0 }, ciclo: { statusPO: false, fechamento: false, orcamento: 10, revisaoAuto: false, versionar: false } });
const projetos = await import('../lib/projetos.mjs');
fs.mkdirSync(path.join(tmp, 'alvo'));
const r = projetos.criar({ nome: 'Fase zero', caminho: path.join(tmp, 'alvo'), template: 'software' }); assert(r.ok);
const c = projetos.ctx(r.projeto.id);
const eq = c.equipe;
const espera = async (cond, ms = 15000) => { for (let t = 0; t < ms / 50 && !cond(); t++) await new Promise((x) => setTimeout(x, 50)); assert(cond(), 'timed out'); };
const dorme = (ms) => new Promise((x) => setTimeout(x, ms));
const todas = (canal, de) => eq.historico(canal).filter((m) => m.de === de);
const falas = (canal, de) => todas(canal, de).filter((m) => m.status === 'ok' && !m.oculta);
const enviar = (canal, texto) => eq.enviar({ canal, texto, engine: 'claude', modo: 'conversar' });

// ---- card with a workflow, so the caveats and the job have a place to live
const card = c.quadro.criar({ titulo: 'Rodar a suíte', descricao: 'Teste da fase 0.', dono: 'backend', coluna: 'andamento', aceite: ['Suíte verde'] }, 'voce'); assert(card.ok);
const id = card.card.id;

// ---- 0.1: "Agora preciso registrar a ressalva" and "não consegui rodar" do NOT become caveats
enviar('equipe', `@Back-end [teste:ressalva-texto] como está o ${id}?`);
await espera(() => falas('equipe', 'backend').length >= 1 || falas(`grp-1`, 'backend').length >= 1);
await dorme(500);
const abertas = c.quadro.obter(id).workflow?.ressalvas || [];
assert.equal(abertas.filter((x) => x.id.startsWith('txt-')).length, 0, 'a chat phrase does not become a txt- caveat');

// ---- 0.2: "Entendido, fico parado até o @pipeline avisar" stays hidden and calls neither the pipeline nor the P.O.
const pipAntes = todas('equipe', 'pipeline').length + eq.grupos().reduce((n, g) => n + todas(g.canal, 'pipeline').length, 0);
const poAntes = todas('equipe', 'po').length;
enviar('dm:frontend', `[teste:mencao-ack] avisa o back sobre o ${id}`);   // colleague calls colleague: the "entendido, fico parado" reply is not for the Game Director
await espera(() => todas('equipe', 'backend').some((m) => m.oculta) || eq.grupos().some((g) => todas(g.canal, 'backend').some((m) => m.oculta)));
await dorme(1500);
const pipDepois = todas('equipe', 'pipeline').length + eq.grupos().reduce((n, g) => n + todas(g.canal, 'pipeline').length, 0);
assert.equal(pipDepois, pipAntes, 'an @pipeline inside an acknowledgement does not call the pipeline');
assert.equal(todas('equipe', 'po').length, poAntes, 'nor the P.O.');

// ---- 0.3: the same mention, with the card in the same state, does not call again
const contaBack = () => todas('equipe', 'backend').length + eq.grupos().reduce((n, g) => n + todas(g.canal, 'backend').length, 0);
enviar('dm:frontend', `[teste:mencao] ${id}`);
await espera(() => falas('dm:frontend', 'frontend').length >= 1);
await dorme(1200);
const b1 = contaBack();
assert(b1 >= 1, 'the first mention calls Back-end');
enviar('dm:frontend', `[teste:mencao] ${id} de novo`);
await espera(() => falas('dm:frontend', 'frontend').length >= 2);
await dorme(1200);
assert.equal(contaBack(), b1, 'the second identical mention, with the card unchanged, does not call');

// ---- 0.8: job.rodar runs outside the call and the result comes back measured by the app, with the agent called back
const backAntes = contaBack();
enviar('equipe', `@Back-end [teste:job] roda a suíte do ${id}`);
await espera(() => eq.historico('equipe').some((m) => m.de === 'sistema' && /Job job-\w+ terminou com código 3/.test(m.texto)), 20000);
const fim = eq.historico('equipe').find((m) => m.de === 'sistema' && /terminou com código 3/.test(m.texto));
assert(/saida-do-job/.test(fim.texto), 'the real command output is in the message');
assert(fs.existsSync(path.join(c.pasta, 'jobs')) && fs.readdirSync(path.join(c.pasta, 'jobs')).some((f) => f.endsWith('.log')), 'the job log was written');
await espera(() => contaBack() > backAntes + 1, 10000);   // the "vou rodar" message and then the return with the result

eq.cancelar();
console.log('PASS: phase 0 (silent acknowledgement with no call, phrase does not become a caveat, repeated mention with unchanged card does not call, background job with measured result).');
try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* Windows still holds the folder */ }
process.exit(0);
