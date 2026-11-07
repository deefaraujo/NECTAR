// Ressalvas: aviso nunca fica só no texto, nada passa com ressalva aberta, e a Game Director é a última QA.
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
const espera = async (cond, ms = 15000) => { for (let t = 0; t < ms / 50 && !cond(); t++) await new Promise((x) => setTimeout(x, 50)); assert(cond(), 'tempo esgotado'); };
const criar = (titulo, extra = {}) => { const r = q.criar({ titulo, descricao: 'Demanda com comportamento verificável.', dono: 'backend', coluna: 'pronto', aceite: ['Comportamento correto'], ...extra }, 'po'); assert(r.ok, r.erro); return r.card; };
const fluxo = (c, acao, dados, autor) => q.fluxo(c.id, acao, { revisao: c.workflow.revisao, ...dados }, autor);
const ok = (r) => { assert(r.ok, r.erro); return r; };
const OK = [{ comando: 'node teste.mjs', status: 'aprovado', evidencia: 'Cenário principal e falha passaram.' }];
const entregar = (c, chave, extra = {}) => ok(fluxo(c, 'entrega', { chave, resumo: 'Implementação verificada.', arquivos: ['src/app.mjs'], verificacoes: OK, ...extra }, 'backend'));
const ate = (c) => { // revisão e documentação aprovadas
  ok(q.mover(c.id, 'revisao', 'backend'));
  ok(fluxo(c, 'revisao', { status: 'aprovado', evidencia: 'Diff pontual, sem achados.' }, 'revisor'));
  ok(fluxo(c, 'documentacao', { status: 'sem_alteracao', evidencia: 'Contrato e README seguem corretos.' }, 'curador'));
};
const abertas = (c) => q.ressalvas(c.id).filter((r) => r.status === 'aberta');

// ---- detecção de aviso em texto: negação não conta
assert.deepEqual(detectarRessalvas('Implementei tudo. Não testei o fluxo de logout. Sem ressalvas de segurança.'), ['Não testei o fluxo de logout.']);
assert.deepEqual(detectarRessalvas('Tudo conferido, nenhuma pendência e sem ressalvas.'), []);
assert(limiteRelevante('Só testei no Chrome.')); assert(!limiteRelevante('Nenhuma.')); assert(!limiteRelevante('Limitações não informadas pelo agente.'));

// ---- limitação declarada vira ressalva e trava QA e conclusão, mas não a revisão
const a = criar('Limitação declarada');
entregar(a, 'e1', { limites: 'Só testei no Chrome; Safari e Firefox ficaram sem teste.' });
assert.equal(abertas(a).length, 1); assert.equal(abertas(a)[0].tipo, 'limite');
assert.equal((a.relatorios || []).length, 0, 'entrega não gera relatório anexado ao card');
assert.match(relatorioTarefa(a, 'entrega', 'backend').texto, /COM 1 RESSALVA ABERTA/, 'o texto de entrega diz a verdade: não está tudo certo');
assert.match(relatorioTarefa(a, 'final', 'backend').texto, /COM 1 RESSALVA ABERTA/, 'e o de conclusão também');
ate(a);
const bloqueado = q.mover(a.id, 'qa', 'curador');
assert.equal(bloqueado.ok, false); assert.match(bloqueado.erro, /ressalvas abertas/);
assert.equal(fluxo(a, 'qa', { status: 'aprovado', evidencia: 'Passou.' }, 'qa').ok, false, 'QA não aprova com ressalva aberta');

// ---- a P.O. é chamada para direcionar (o card em revisão/QA com ressalva aberta vai para ela, não para o QA)
assert(eq.pilotoTick({ forcar: true }), 'o piloto age sobre o card com ressalva');
await espera(() => eq.historico('equipe').some((m) => m.de === 'po' && m.tipo === 'ressalvas' && m.card === a.id));

// ---- quem pode resolver, e com evidência
assert.equal(fluxo(a, 'ressalva-resolver', { ressalva: 'limite-r1', resolucao: 'Testei.', evidencia: 'ok' }, 'frontend').ok, false, 'quem não é dono nem P.O. não resolve');
assert.equal(fluxo(a, 'ressalva-resolver', { ressalva: 'limite-r1', resolucao: 'Testei.' }, 'backend').ok, false, 'sem evidência não resolve');
assert.equal(fluxo(a, 'ressalva-resolver', { ressalva: 'nao-existe', resolucao: 'x', evidencia: 'y' }, 'backend').ok, false);
ok(fluxo(a, 'ressalva-resolver', { ressalva: 'limite-r1', resolucao: 'Testado também no Safari e no Firefox.', evidencia: 'Capturas dos dois navegadores, fluxo completo passou.' }, 'backend'));
assert.equal(abertas(a).length, 0);
ok(q.mover(a.id, 'qa', 'curador'));
q.atualizar(a.id, { aceiteOk: [0] }, 'qa');
ok(fluxo(a, 'qa', { status: 'aprovado', evidencia: 'Caminho principal e falhas validados.' }, 'qa'));
ok(q.mover(a.id, 'concluido', 'qa'));
assert.equal(a.validacao.status, 'pendente', 'concluído fica aguardando a validação da Game Director');
assert.match(fluxo(a, 'ressalva-reabrir', { ressalva: 'limite-r1', motivo: 'Não convenceu.' }, 'backend').erro || '', /Só QA/, 'o dono não reabre a própria ressalva');
assert.match(a.relatorios.at(-1).texto, /Situação: sem ressalvas/, 'o relatório final mostra a situação real');
assert.match(a.relatorios.at(-1).texto, /Resolução: Testado também no Safari/);

// ---- aceitar: só a P.O., com motivo, e só o que é aceitável
const b = criar('Aceite com motivo');
entregar(b, 'e1', { limites: 'Mensagem de erro ainda em inglês no caso raro de timeout.' });
ate(b);
assert.equal(fluxo(b, 'ressalva-aceitar', { ressalva: 'limite-r1', motivo: 'Aceito por ora, volto depois.' }, 'backend').ok, false, 'agente comum não aceita');
assert.equal(fluxo(b, 'ressalva-aceitar', { ressalva: 'limite-r1', motivo: 'ok' }, 'po').ok, false, 'sem motivo claro não aceita');
ok(fluxo(b, 'ressalva-aceitar', { ressalva: 'limite-r1', motivo: 'Texto de erro raro e sem impacto; vira card de polimento depois.' }, 'po'));
assert.equal(abertas(b).length, 0);
assert.equal((b.relatorios || []).length, 0, 'sem relatório de entrega guardado no card');
assert.equal(q.ressalvas(b.id)[0].status, 'aceita');

// ---- achado de qualquer severidade também vira ressalva; só o baixo pode ser aceito
const d = criar('Achados');
entregar(d, 'e1');
ok(q.mover(d.id, 'revisao', 'backend'));
ok(fluxo(d, 'achado', { chave: 'nome-confuso', severidade: 'baixa', arquivo: 'src/a.mjs', linha: 3, evidencia: 'nome ambíguo', impacto: 'leitura', correcao: 'renomear' }, 'revisor'));
ok(fluxo(d, 'achado', { chave: 'sem-validacao', severidade: 'alta', arquivo: 'src/a.mjs', linha: 9, evidencia: 'sem validar entrada', impacto: 'quebra', correcao: 'validar' }, 'revisor'));
assert.equal(abertas(d).length, 2);
assert.equal(fluxo(d, 'ressalva-aceitar', { ressalva: 'achado-sem-validacao', motivo: 'Aceito mesmo assim, depois vejo isso.' }, 'po').ok, false, 'achado grave não se aceita');
ok(fluxo(d, 'ressalva-aceitar', { ressalva: 'achado-nome-confuso', motivo: 'Só o nome de uma variável local; o time renomeia no próximo card.' }, 'po'));
assert.equal(fluxo(d, 'ressalva-resolver', { ressalva: 'achado-sem-validacao', resolucao: 'x', evidencia: 'y' }, 'po').ok, false, 'achado se resolve corrigindo e verificando, não declarando');

// ---- aviso no texto da entrega vira ressalva; barreira do projeto (Docker) não
const e = criar('Texto com aviso');
ok(fluxo(e, 'entrega', { chave: 'e1', resumo: 'Entreguei o endpoint. Ainda não rodei o teste de carga.', arquivos: ['src/x.mjs'], verificacoes: [...OK, { comando: 'pytest -m integration', status: 'nao_executado', evidencia: 'Precisa de Docker, que não existe neste ambiente. [barreira do projeto sem-docker]', obrigatoria: false }] }, 'backend'));
const rs = abertas(e);
assert(rs.some((r) => r.tipo === 'texto' && /teste de carga/.test(r.texto)), 'frase de aviso virou ressalva');
assert(!rs.some((r) => r.tipo === 'verificacao'), 'sem Docker neste projeto é barreira, não ressalva');
ok(fluxo(e, 'ressalva-abrir', { texto: 'A migração não foi testada com dados reais.', severidade: 'media' }, 'backend'));
assert.equal(abertas(e).length, 2);
assert.equal(fluxo(e, 'ressalva-abrir', { texto: 'A migração não foi testada com dados reais.' }, 'backend').repetido, true, 'a mesma ressalva não duplica');

// ---- verificação que não rodou (sem barreira) é ressalva, e a obrigatória não pode ser aceita
const g = criar('Verificação sem rodar');
entregar(g, 'e1');
ok(fluxo(g, 'ressalva-abrir', { texto: 'Falta validar com o usuário de outro show.' }, 'backend'));
assert.equal(abertas(g).length, 1);

// ---- a Game Director é a última QA
assert.equal(q.validar(g.id, true, '', 'voce').ok, false, 'só se valida o que está concluído');
assert.equal(q.validar(a.id, true, '', 'backend').ok, false, 'agente não valida no lugar da Game Director');
ok(q.validar(a.id, true, 'Testei o fluxo e está certo.', 'voce'));
assert.equal(a.validacao.status, 'aprovada');
const h = criar('Vai reprovar');
entregar(h, 'e1'); ate(h);
q.atualizar(h.id, { aceiteOk: [0] }, 'qa');
ok(fluxo(h, 'qa', { status: 'aprovado', evidencia: 'Validado.' }, 'qa'));
ok(q.mover(h.id, 'concluido', 'qa'));
assert.equal(q.validar(h.id, false, '', 'voce').ok, false, 'reprovar exige dizer o que está errado');
ok(q.validar(h.id, false, 'O botão salvar não grava quando o nome tem acento.', 'voce'));
assert.equal(h.coluna, 'andamento', 'reprovado volta para o time');
assert.equal(h.validacao.status, 'reprovada');
const grave = abertas(h).find((r) => r.tipo === 'usuario');
assert(grave && grave.severidade === 'alta' && /botão salvar/.test(grave.texto), 'a reprovação vira ressalva grave com o relato dela');
assert.equal(fluxo(h, 'ressalva-aceitar', { ressalva: grave.id, motivo: 'A P.O. aceita sem corrigir isso.' }, 'po').ok, false, 'a P.O. não aceita a reprovação da Game Director');
eq.guarda.reconciliar();
assert.equal(h.coluna, 'andamento', 'o app não devolve o card para revisão sem uma nova entrega');

eq.cancelar();
console.log('PASS: ressalvas (limitação, achado, texto e verificação viram ressalva; trava QA e conclusão; só dono/P.O. resolvem e só a P.O. aceita o aceitável; relatório diz a verdade; P.O. direciona) e validação final da Game Director.');
try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* o Windows ainda segura a pasta */ }
process.exit(0);
