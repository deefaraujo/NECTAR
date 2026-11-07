// Caveats: a warning never stays only in the text, nothing passes with an open caveat, and the Game Director is the final QA.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'work-ia-ressalvas-'));
process.env.STUDIO_DATA = path.join(tmp, 'data'); process.env.STUDIO_PROJETOS = path.join(tmp, 'projetos'); process.env.STUDIO_FAKE = '1';
const store = await import('../lib/store.mjs');
store.gravarConfig({ piloto: { ativo: false, maxChamadasHora: 0 }, ciclo: { statusPO: false, fechamento: false, orcamento: 6, revisaoAuto: true, versionar: false } });
const projetos = await import('../lib/projetos.mjs');
const { detectarRessalvas, limiteRelevante, relatorioTarefa } = await import('../lib/workflow.mjs');
fs.mkdirSync(path.join(tmp, 'alvo'));
const projeto = projetos.criar({ nome: 'Ressalvas', caminho: path.join(tmp, 'alvo'), template: 'software' }).projeto;
const { quadro: q, equipe: eq } = projetos.ctx(projeto.id);
const espera = async (cond, ms = 15000) => { for (let t = 0; t < ms / 50 && !cond(); t++) await new Promise((x) => setTimeout(x, 50)); assert(cond(), 'timed out'); };
const criar = (titulo, extra = {}) => { const r = q.criar({ titulo, descricao: 'Demanda com comportamento verificável.', dono: 'backend', coluna: 'pronto', aceite: ['Comportamento correto'], ...extra }, 'po'); assert(r.ok, r.erro); return r.card; };
const fluxo = (c, acao, dados, autor) => q.fluxo(c.id, acao, { revisao: c.workflow.revisao, ...dados }, autor);
const ok = (r) => { assert(r.ok, r.erro); return r; };
const OK = [{ comando: 'node teste.mjs', status: 'aprovado', evidencia: 'Cenário principal e falha passaram.' }];
const entregar = (c, chave, extra = {}) => ok(fluxo(c, 'entrega', { chave, resumo: 'Implementação verificada.', arquivos: ['src/app.mjs'], verificacoes: OK, ...extra }, 'backend'));
const ate = (c) => { // review and documentation approved
  ok(q.mover(c.id, 'revisao', 'backend'));
  ok(fluxo(c, 'revisao', { status: 'aprovado', evidencia: 'Diff pontual, sem achados.' }, 'revisor'));
  ok(fluxo(c, 'documentacao', { status: 'sem_alteracao', evidencia: 'Contrato e README seguem corretos.' }, 'curador'));
};
const abertas = (c) => q.ressalvas(c.id).filter((r) => r.status === 'aberta');

// ---- warning detection in text: negations do not count
assert.deepEqual(detectarRessalvas('Implementei tudo. Não testei o fluxo de logout. Sem ressalvas de segurança.'), ['Não testei o fluxo de logout.']);
assert.deepEqual(detectarRessalvas('Tudo conferido, nenhuma pendência e sem ressalvas.'), []);
assert(limiteRelevante('Só testei no Chrome.')); assert(!limiteRelevante('Nenhuma.')); assert(!limiteRelevante('Limitações não informadas pelo agente.'));

// ---- a declared limitation becomes a caveat and blocks QA and completion, but not review
const a = criar('Limitação declarada');
entregar(a, 'e1', { limites: 'Só testei no Chrome; Safari e Firefox ficaram sem teste.' });
assert.equal(abertas(a).length, 1); assert.equal(abertas(a)[0].tipo, 'limite');
assert.equal((a.relatorios || []).length, 0, 'a delivery does not produce a report attached to the card');
assert.match(relatorioTarefa(a, 'entrega', 'backend').texto, /COM 1 RESSALVA ABERTA/, 'the delivery text tells the truth: not everything is fine');
assert.match(relatorioTarefa(a, 'final', 'backend').texto, /COM 1 RESSALVA ABERTA/, 'and the completion text too');
ate(a);
const bloqueado = q.mover(a.id, 'qa', 'curador');
assert.equal(bloqueado.ok, false); assert.match(bloqueado.erro, /ressalvas abertas/);
assert.equal(fluxo(a, 'qa', { status: 'aprovado', evidencia: 'Passou.' }, 'qa').ok, false, 'QA does not approve with an open caveat');

// ---- the P.O. is called to steer (a card in review/QA with an open caveat goes to the P.O., not to QA)
assert(eq.pilotoTick({ forcar: true }), 'the autopilot acts on the card with a caveat');
await espera(() => eq.historico('equipe').some((m) => m.de === 'po' && m.tipo === 'ressalvas' && m.card === a.id));

// ---- who can resolve, and with evidence
assert.equal(fluxo(a, 'ressalva-resolver', { ressalva: 'limite-r1', resolucao: 'Testei.', evidencia: 'ok' }, 'frontend').ok, false, 'someone who is neither owner nor P.O. cannot resolve');
assert.equal(fluxo(a, 'ressalva-resolver', { ressalva: 'limite-r1', resolucao: 'Testei.' }, 'backend').ok, false, 'no evidence, no resolution');
assert.equal(fluxo(a, 'ressalva-resolver', { ressalva: 'nao-existe', resolucao: 'x', evidencia: 'y' }, 'backend').ok, false);
ok(fluxo(a, 'ressalva-resolver', { ressalva: 'limite-r1', resolucao: 'Testado também no Safari e no Firefox.', evidencia: 'Capturas dos dois navegadores, fluxo completo passou.' }, 'backend'));
assert.equal(abertas(a).length, 0);
ok(q.mover(a.id, 'qa', 'curador'));
q.atualizar(a.id, { aceiteOk: [0] }, 'qa');
ok(fluxo(a, 'qa', { status: 'aprovado', evidencia: 'Caminho principal e falhas validados.' }, 'qa'));
ok(q.mover(a.id, 'concluido', 'qa'));
assert.equal(a.validacao.status, 'pendente', 'done stays pending the Game Director validation');
assert.match(fluxo(a, 'ressalva-reabrir', { ressalva: 'limite-r1', motivo: 'Não convenceu.' }, 'backend').erro || '', /Só QA/, 'the owner cannot reopen their own caveat');
assert.match(a.relatorios.at(-1).texto, /Situação: sem ressalvas/, 'the final report shows the real status');
assert.match(a.relatorios.at(-1).texto, /Resolução: Testado também no Safari/);

// ---- accepting: only the P.O., with a reason, and only what is acceptable
const b = criar('Aceite com motivo');
entregar(b, 'e1', { limites: 'Mensagem de erro ainda em inglês no caso raro de timeout.' });
ate(b);
assert.equal(fluxo(b, 'ressalva-aceitar', { ressalva: 'limite-r1', motivo: 'Aceito por ora, volto depois.' }, 'backend').ok, false, 'a regular agent cannot accept');
assert.equal(fluxo(b, 'ressalva-aceitar', { ressalva: 'limite-r1', motivo: 'ok' }, 'po').ok, false, 'no clear reason, no acceptance');
ok(fluxo(b, 'ressalva-aceitar', { ressalva: 'limite-r1', motivo: 'Texto de erro raro e sem impacto; vira card de polimento depois.' }, 'po'));
assert.equal(abertas(b).length, 0);
assert.equal((b.relatorios || []).length, 0, 'no delivery report stored on the card');
assert.equal(q.ressalvas(b.id)[0].status, 'aceita');

// ---- a finding of any severity also becomes a caveat; only low ones can be accepted
const d = criar('Achados');
entregar(d, 'e1');
ok(q.mover(d.id, 'revisao', 'backend'));
ok(fluxo(d, 'achado', { chave: 'nome-confuso', severidade: 'baixa', arquivo: 'src/a.mjs', linha: 3, evidencia: 'nome ambíguo', impacto: 'leitura', correcao: 'renomear' }, 'revisor'));
ok(fluxo(d, 'achado', { chave: 'sem-validacao', severidade: 'alta', arquivo: 'src/a.mjs', linha: 9, evidencia: 'sem validar entrada', impacto: 'quebra', correcao: 'validar' }, 'revisor'));
assert.equal(abertas(d).length, 2);
assert.equal(fluxo(d, 'ressalva-aceitar', { ressalva: 'achado-sem-validacao', motivo: 'Aceito mesmo assim, depois vejo isso.' }, 'po').ok, false, 'a severe finding cannot be accepted');
ok(fluxo(d, 'ressalva-aceitar', { ressalva: 'achado-nome-confuso', motivo: 'Só o nome de uma variável local; o time renomeia no próximo card.' }, 'po'));
assert.equal(fluxo(d, 'ressalva-resolver', { ressalva: 'achado-sem-validacao', resolucao: 'x', evidencia: 'y' }, 'po').ok, false, 'a finding is resolved by fixing and verifying, not by declaring');

// ---- a warning in the delivery text becomes a caveat; a project barrier (Docker) does not
const e = criar('Texto com aviso');
ok(fluxo(e, 'entrega', { chave: 'e1', resumo: 'Entreguei o endpoint. Ainda não rodei o teste de carga.', arquivos: ['src/x.mjs'], verificacoes: [...OK, { comando: 'pytest -m integration', status: 'nao_executado', evidencia: 'Precisa de Docker, que não existe neste ambiente. [barreira do projeto sem-docker]', obrigatoria: false }] }, 'backend'));
const rs = abertas(e);
assert(rs.some((r) => r.tipo === 'texto' && /teste de carga/.test(r.texto)), 'warning sentence became a caveat');
assert(!rs.some((r) => r.tipo === 'verificacao'), 'no Docker in this project is a barrier, not a caveat');
ok(fluxo(e, 'ressalva-abrir', { texto: 'A migração não foi testada com dados reais.', severidade: 'media' }, 'backend'));
assert.equal(abertas(e).length, 2);
assert.equal(fluxo(e, 'ressalva-abrir', { texto: 'A migração não foi testada com dados reais.' }, 'backend').repetido, true, 'the same caveat does not duplicate');

// ---- a check that did not run (without a barrier) is a caveat, and a mandatory one cannot be accepted
const g = criar('Verificação sem rodar');
entregar(g, 'e1');
ok(fluxo(g, 'ressalva-abrir', { texto: 'Falta validar com o usuário de outro show.' }, 'backend'));
assert.equal(abertas(g).length, 1);

// ---- the Game Director is the final QA
assert.equal(q.validar(g.id, true, '', 'voce').ok, false, 'only done cards can be validated');
assert.equal(q.validar(a.id, true, '', 'backend').ok, false, 'an agent cannot validate in place of the Game Director');
ok(q.validar(a.id, true, 'Testei o fluxo e está certo.', 'voce'));
assert.equal(a.validacao.status, 'aprovada');
const h = criar('Vai reprovar');
entregar(h, 'e1'); ate(h);
q.atualizar(h.id, { aceiteOk: [0] }, 'qa');
ok(fluxo(h, 'qa', { status: 'aprovado', evidencia: 'Validado.' }, 'qa'));
ok(q.mover(h.id, 'concluido', 'qa'));
assert.equal(q.validar(h.id, false, '', 'voce').ok, false, 'rejecting requires saying what is wrong');
ok(q.validar(h.id, false, 'O botão salvar não grava quando o nome tem acento.', 'voce'));
assert.equal(h.coluna, 'andamento', 'a rejected card goes back to the team');
assert.equal(h.validacao.status, 'reprovada');
const grave = abertas(h).find((r) => r.tipo === 'usuario');
assert(grave && grave.severidade === 'alta' && /botão salvar/.test(grave.texto), 'the rejection becomes a severe caveat with the user report');
assert.equal(fluxo(h, 'ressalva-aceitar', { ressalva: grave.id, motivo: 'A P.O. aceita sem corrigir isso.' }, 'po').ok, false, 'the P.O. cannot accept the Game Director rejection');
eq.guarda.reconciliar();
assert.equal(h.coluna, 'andamento', 'the app does not send the card back to review without a new delivery');

eq.cancelar();
console.log('PASS: caveats (limitation, finding, text and check become caveats; blocks QA and completion; only owner/P.O. resolve and only the P.O. accepts what is acceptable; report tells the truth; P.O. steers) and final Game Director validation.');
try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* Windows may still hold the folder */ }
process.exit(0);
