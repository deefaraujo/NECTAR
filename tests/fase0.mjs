// Fase 0 do plano de eficiência: confirmação de recebimento não vira mensagem nem chamada; frase de chat não vira ressalva;
// a mesma menção com o card parado não chama de novo; comando demorado roda como job do app e o resultado volta medido.
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
const espera = async (cond, ms = 15000) => { for (let t = 0; t < ms / 50 && !cond(); t++) await new Promise((x) => setTimeout(x, 50)); assert(cond(), 'tempo esgotado'); };
const dorme = (ms) => new Promise((x) => setTimeout(x, ms));
const todas = (canal, de) => eq.historico(canal).filter((m) => m.de === de);
const falas = (canal, de) => todas(canal, de).filter((m) => m.status === 'ok' && !m.oculta);
const enviar = (canal, texto) => eq.enviar({ canal, texto, engine: 'claude', modo: 'conversar' });

// ---- card com workflow, para as ressalvas e o job terem onde morar
const card = c.quadro.criar({ titulo: 'Rodar a suíte', descricao: 'Teste da fase 0.', dono: 'backend', coluna: 'andamento', aceite: ['Suíte verde'] }, 'voce'); assert(card.ok);
const id = card.card.id;

// ---- 0.1: "Agora preciso registrar a ressalva" e "não consegui rodar" NÃO viram ressalva
enviar('equipe', `@Back-end [teste:ressalva-texto] como está o ${id}?`);
await espera(() => falas('equipe', 'backend').length >= 1 || falas(`grp-1`, 'backend').length >= 1);
await dorme(500);
const abertas = c.quadro.obter(id).workflow?.ressalvas || [];
assert.equal(abertas.filter((x) => x.id.startsWith('txt-')).length, 0, 'frase de chat não vira ressalva txt-');

// ---- 0.2: "Entendido, fico parado até o @pipeline avisar" fica oculto e não chama o pipeline nem a P.O.
const pipAntes = todas('equipe', 'pipeline').length + eq.grupos().reduce((n, g) => n + todas(g.canal, 'pipeline').length, 0);
const poAntes = todas('equipe', 'po').length;
enviar('dm:frontend', `[teste:mencao-ack] avisa o back sobre o ${id}`);   // colega chama colega: a resposta "entendido, fico parado" não é para a Game Director
await espera(() => todas('equipe', 'backend').some((m) => m.oculta) || eq.grupos().some((g) => todas(g.canal, 'backend').some((m) => m.oculta)));
await dorme(1500);
const pipDepois = todas('equipe', 'pipeline').length + eq.grupos().reduce((n, g) => n + todas(g.canal, 'pipeline').length, 0);
assert.equal(pipDepois, pipAntes, 'o @pipeline dentro de uma confirmação de recebimento não chama o pipeline');
assert.equal(todas('equipe', 'po').length, poAntes, 'nem a P.O.');

// ---- 0.3: a mesma menção, com o card no mesmo estado, não chama de novo
const contaBack = () => todas('equipe', 'backend').length + eq.grupos().reduce((n, g) => n + todas(g.canal, 'backend').length, 0);
enviar('dm:frontend', `[teste:mencao] ${id}`);
await espera(() => falas('dm:frontend', 'frontend').length >= 1);
await dorme(1200);
const b1 = contaBack();
assert(b1 >= 1, 'a primeira menção chama o Back-end');
enviar('dm:frontend', `[teste:mencao] ${id} de novo`);
await espera(() => falas('dm:frontend', 'frontend').length >= 2);
await dorme(1200);
assert.equal(contaBack(), b1, 'a segunda menção igual, com o card parado, não chama');

// ---- 0.8: job.rodar roda fora da chamada e o resultado volta medido pelo app, com o agente chamado de volta
const backAntes = contaBack();
enviar('equipe', `@Back-end [teste:job] roda a suíte do ${id}`);
await espera(() => eq.historico('equipe').some((m) => m.de === 'sistema' && /Job job-\w+ terminou com código 3/.test(m.texto)), 20000);
const fim = eq.historico('equipe').find((m) => m.de === 'sistema' && /terminou com código 3/.test(m.texto));
assert(/saida-do-job/.test(fim.texto), 'a saída real do comando está na mensagem');
assert(fs.existsSync(path.join(c.pasta, 'jobs')) && fs.readdirSync(path.join(c.pasta, 'jobs')).some((f) => f.endsWith('.log')), 'o log do job foi gravado');
await espera(() => contaBack() > backAntes + 1, 10000);   // a fala "vou rodar" e depois a volta com o resultado

eq.cancelar();
console.log('PASS: fase 0 (confirmação de recebimento silenciosa e sem chamada, frase não vira ressalva, menção repetida com card parado não chama, job em segundo plano com resultado medido).');
try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* o Windows ainda segura a pasta */ }
process.exit(0);
