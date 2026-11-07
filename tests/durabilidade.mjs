// Durabilidade: reinício abrupto do Windows deixa o arquivo zerado. Nada pode se perder nem ser sobrescrito por um começo vazio.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'work-ia-dur-'));
process.env.STUDIO_DATA = path.join(tmp, 'data'); process.env.STUDIO_PROJETOS = path.join(tmp, 'projetos'); process.env.STUDIO_BAK_MS = '0'; process.env.STUDIO_SNAP_MS = '1';   // sem STUDIO_PROJETOS, o projeto "Cota" nascia na pasta real (77 cópias em dois dias)
const { ler, gravar, ocorrencias } = await import('../lib/store.mjs');
const zerar = (f) => fs.writeFileSync(f, Buffer.alloc(fs.statSync(f).size || 200));
const d = path.join(tmp, 'p'); fs.mkdirSync(d, { recursive: true });
const ilegiveis = (f) => fs.readdirSync(path.dirname(f)).filter((n) => n.startsWith(`${path.basename(f)}.ilegivel-`));

// arquivo que nunca existiu: primeira vez de verdade, sem criar nada
assert.deepEqual(ler(path.join(d, 'novo.json'), { z: 1 }), { z: 1 });
assert(!fs.existsSync(path.join(d, 'novo.json')), 'ler não cria arquivo');

// 1) arquivo zerado pelo reinício: volta da cópia anterior e o arquivo ruim fica guardado
const f1 = path.join(d, 'dados.json');
gravar(f1, { v: 1 }); gravar(f1, { v: 2 }); gravar(f1, { v: 3 });
zerar(f1);
assert.deepEqual(ler(f1, { v: 0 }), { v: 2 }, 'recupera a versão anterior em vez de começar vazio');
assert.deepEqual(JSON.parse(fs.readFileSync(f1, 'utf8')), { v: 2 }, 'e o arquivo principal volta a valer');
assert.equal(ilegiveis(f1).length, 1, 'o arquivo zerado fica em quarentena, não é sobrescrito');
assert(ocorrencias.some((o) => /recuperado/.test(o.msg)));

// 2) sem nenhuma cópia: começa do padrão, mas o ilegível é preservado
const f2 = path.join(d, 'sem-copia.json');
fs.writeFileSync(f2, Buffer.alloc(500));
assert.deepEqual(ler(f2, { x: 1 }), { x: 1 });
assert.equal(ilegiveis(f2).length, 1, 'quarentena mesmo sem cópia');
assert(!fs.existsSync(f2), 'nada é gravado por cima antes de a aplicação decidir');

// 3) JSON cortado no meio (disco cheio, kill) também é tratado
const f3 = path.join(d, 'cortado.json');
gravar(f3, { lista: [1, 2, 3] }); gravar(f3, { lista: [1, 2, 3, 4] });
fs.writeFileSync(f3, '{"lista":[1,2,');
assert.deepEqual(ler(f3, {}), { lista: [1, 2, 3] }, 'JSON truncado volta da cópia');

// 4) instantâneo por hora: sem .bak, ainda há de onde recuperar
const f4 = path.join(d, 'grande.json');
const grande = (n) => ({ n, texto: 'x'.repeat(3000) });
gravar(f4, grande(1)); await new Promise((r) => setTimeout(r, 5)); gravar(f4, grande(2));
assert(fs.readdirSync(path.join(d, '_backups')).some((n) => n.startsWith('grande.')), 'instantâneo criado');
fs.rmSync(`${f4}.bak`, { force: true }); zerar(f4);
assert.equal(ler(f4, {}).n, 1, 'recupera do instantâneo quando não há .bak');

// 5) encolhimento brusco guarda a versão grande
const f5 = path.join(d, 'quadro.json');
gravar(f5, { cartoes: Array.from({ length: 200 }, (_, i) => ({ id: i, t: 'card '.repeat(20) })) });
gravar(f5, { cartoes: [] });
assert(fs.readdirSync(d).some((n) => n.startsWith('quadro.json.antes-de-encolher-')), 'versão grande guardada antes de ser encolhida');

// 6) o quadro de verdade: zerar o board.json não apaga os cards
const { criarQuadro } = await import('../lib/quadro.mjs');
const pasta = path.join(tmp, 'proj'); fs.mkdirSync(pasta, { recursive: true });
const abrir = () => criarQuadro({ dir: pasta, raiz: pasta, pasta, limiteDe: () => null, emitir: () => {}, elenco: undefined });
const q1 = abrir();
const { descarregar: gravarTudo } = await import('../lib/store.mjs');
for (const t of ['Primeiro', 'Segundo', 'Terceiro']) { assert(q1.criar({ titulo: t, descricao: 'x', coluna: 'backlog' }, 'po').ok); await gravarTudo(); }   // com o tempo, cada gravação deixa a anterior como cópia
const antes = q1.listar().length;
await (await import('../lib/store.mjs')).descarregar();   // o quadro grava em segundo plano; aqui queremos o arquivo no disco
zerar(path.join(pasta, 'board.json'));
const q2 = abrir();
assert(q2.listar().length >= antes - 1 && q2.listar().length > 0, `o quadro reaberto tem os cards (${q2.listar().length} de ${antes})`);
assert(q2.listar().some((c) => c.titulo === 'Primeiro'), 'os cards antigos voltaram');

// 6b) gravação adiada: várias mudanças viram uma gravação, nada se perde ao fechar, e uma gravação síncrona mais nova vence
const { gravarDepois, adiar, descarregar, descarregarSync, escreverSeMudou } = await import('../lib/store.mjs');
const fa = path.join(d, 'adiada.json');
const estadoA = { n: 0 };
for (let i = 1; i <= 200; i++) { estadoA.n = i; gravarDepois(fa, () => estadoA); }
assert(!fs.existsSync(fa), 'nada é gravado a cada mudança: elas se juntam');
await descarregar();
assert.equal(JSON.parse(fs.readFileSync(fa, 'utf8')).n, 200, 'a gravação junta traz o estado mais recente');
estadoA.n = 201; gravarDepois(fa, () => estadoA);
descarregarSync();   // é o que acontece ao fechar o app
assert.equal(JSON.parse(fs.readFileSync(fa, 'utf8')).n, 201, 'o que estava pendente é gravado ao fechar');
estadoA.n = 300; gravarDepois(fa, () => estadoA); await descarregar();
gravarDepois(fa, () => ({ n: 'velho' }));
gravar(fa, { n: 'novo-sincrono' });
await new Promise((r) => setTimeout(r, 700));
assert.equal(JSON.parse(fs.readFileSync(fa, 'utf8')).n, 'novo-sincrono', 'gravação síncrona mais nova não é desfeita por uma adiada antiga');
let rodou = 0; for (let i = 0; i < 50; i++) adiar('derivado', () => { rodou++; });
await descarregar(); assert.equal(rodou, 1, 'trabalho adiado também se junta em uma execução');
const md = path.join(d, 'derivado.md'); assert(escreverSeMudou(md, 'a')); assert(!escreverSeMudou(md, 'a'), 'derivado igual não regrava'); assert(escreverSeMudou(md, 'b'));


// 7) cota de conversa: passou de 500 mensagens, as mais antigas vão para o arquivo em disco e não se perdem
process.env.STUDIO_FAKE = '1';
const projetos = await import('../lib/projetos.mjs');
fs.mkdirSync(path.join(tmp, 'alvo'), { recursive: true });
const pr = projetos.criar({ nome: 'Cota', caminho: path.join(tmp, 'alvo'), template: 'software' }); assert(pr.ok);
const cx = projetos.ctx(pr.projeto.id); const eqc = cx.equipe;
for (let i = 1; i <= 520; i++) eqc.teste.postar('equipe', { de: 'sistema', texto: `mensagem ${i}` });
const na_tela = eqc.historico('equipe');
assert(na_tela.length <= 500 && na_tela.at(-1).texto === 'mensagem 520', 'a conversa visível continua com as mais recentes');
const arq = path.join(cx.pasta, 'chats-arquivo', 'equipe.jsonl');
const arquivadas = fs.readFileSync(arq, 'utf8').trim().split(String.fromCharCode(10)).map((l) => JSON.parse(l));
assert(arquivadas.length >= 100 && arquivadas[0].texto.startsWith('mensagem'), 'as mais antigas ficam guardadas em disco, não são apagadas');
assert.equal(new Set([...arquivadas.map((m) => m.id), ...na_tela.map((m) => m.id)]).size, arquivadas.length + na_tela.length, 'nenhuma mensagem se repete nem some');
eqc.cancelar();

console.log('PASS: durabilidade (arquivo zerado ou cortado volta da cópia, ilegível vai para quarentena, instantâneo por hora, encolhimento brusco guardado e quadro reaberto com os cards).');
try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* o Windows ainda segura a pasta */ }
process.exit(0);
