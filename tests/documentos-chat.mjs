// Documento entregue no chat: o agente gera o arquivo e ele chega anexado na mensagem, pronto para baixar,
// pela ação arquivo.enviar ou só citando o caminho do arquivo que acabou de gerar.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nectar-docs-'));
process.env.STUDIO_DATA = path.join(tmp, 'data'); process.env.STUDIO_PROJETOS = path.join(tmp, 'projetos'); process.env.STUDIO_FAKE = '1'; process.env.STUDIO_FAKE_LOCAL = '0';
const store = await import('../lib/store.mjs');
store.gravarConfig({ piloto: { ativo: false, maxChamadasHora: 0 }, ciclo: { statusPO: false, fechamento: false, revisaoAuto: false, versionar: false, curadoriaAuto: false, planningReplica: false } });
const projetos = await import('../lib/projetos.mjs');
const { documentosCitados } = await import('../lib/entregas-chat.mjs');
const dorme = (ms) => new Promise((x) => setTimeout(x, ms));
const espera = async (cond, ms = 20000) => { for (let i = 0; i < ms / 50 && !cond(); i++) await dorme(50); return cond(); };

const alvo = path.join(tmp, 'alvo'); fs.mkdirSync(path.join(alvo, 'docs'), { recursive: true });
fs.writeFileSync(path.join(alvo, 'docs', 'relatorio-mudancas.pdf'), '%PDF-1.4 relatório');
fs.writeFileSync(path.join(alvo, 'docs', 'apresentacao.pptx'), 'PK pptx');
fs.writeFileSync(path.join(alvo, 'docs', 'antigo.pdf'), '%PDF velho'); const velho = Date.now() / 1000 - 3 * 86400; fs.utimesSync(path.join(alvo, 'docs', 'antigo.pdf'), velho, velho);
assert.deepEqual(documentosCitados('ficou em docs/apresentacao.pptx e o antigo em docs/antigo.pdf', { bases: [alvo] }).map((p) => path.basename(p)), ['apresentacao.pptx'], 'só documento recém-gerado citado vira anexo');

const r = projetos.criar({ nome: 'Docs', caminho: alvo, template: 'software' }); assert(r.ok);
const c = projetos.ctx(r.projeto.id); const eq = c.equipe;
const doAgente = (canal, re) => eq.historico(canal).find((m) => m.de === 'backend' && m.status === 'ok' && m.anexos?.some((a) => re.test(a.nome)));

// pela ação
eq.enviar({ canal: 'dm:backend', texto: '[teste:documento:docs/relatorio-mudancas.pdf] gera o pdf das mudanças' });
assert(await espera(() => doAgente('dm:backend', /relatorio-mudancas\.pdf$/)), 'o PDF chega anexado na mensagem do agente');
const anexo = doAgente('dm:backend', /relatorio-mudancas\.pdf$/).anexos[0];
assert.equal(anexo.tipo, 'application/pdf');
const copia = path.join(c.pasta, 'anexos', ...anexo.rel.split('/'));
assert(fs.existsSync(copia) && fs.readFileSync(copia, 'utf8').startsWith('%PDF'), 'o arquivo fica nos anexos do projeto, servido pela rota /anexo');

// só citando o caminho
eq.enviar({ canal: 'dm:backend', texto: '[teste:documento-citado:docs/apresentacao.pptx] faz o ppt' });
assert(await espera(() => doAgente('dm:backend', /apresentacao\.pptx$/)), 'documento citado no texto também vira anexo');

// arquivo que não existe vira aviso, não anexo quebrado
eq.enviar({ canal: 'dm:backend', texto: '[teste:documento:docs/nao-existe.pdf] e esse?' });
await espera(() => eq.historico('dm:backend').filter((m) => m.de === 'backend' && m.status === 'ok').length >= 3);
assert(!eq.historico('dm:backend').some((m) => m.anexos?.some((a) => /nao-existe/.test(a.nome))));

const leve = eq.teste.montar({ agente: 'backend', tipo: 'mencao', card: null, canalSaida: 'grp-1', instrucao: 'oi', origem: 'frontend' });
assert(/arquivo\.enviar/.test(leve.sistema), 'a ação está no prompt, até na conversa leve');

await dorme(300);
try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { /* pasta temporária */ }
console.log('PASS: documento no chat (arquivo.enviar anexa para baixar, caminho citado de arquivo recém-gerado também anexa, arquivo inexistente não vira anexo, ação no prompt).');
process.exit(0);
