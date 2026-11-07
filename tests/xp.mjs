// XP disciplines enforced by mechanism: verifiable acceptance before starting (a card without acceptance does not leave the backlog, whether created by an agent or
// moved), review in a separate, discarded worktree, the reviewer is never the owner (workflow). Simulated, no model; real Git in a temp repo.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'work-ia-xp-'));
Object.assign(process.env, { STUDIO_DATA: path.join(tmp, 'data'), STUDIO_PROJETOS: path.join(tmp, 'projetos'), STUDIO_FAKE: '1' });
const { aceiteVerificavel, worktreeRevisao } = await import('../lib/xp.mjs');

// ---- what counts as a verifiable criterion
assert.equal(aceiteVerificavel([]).ok, false);
assert.equal(aceiteVerificavel(['funcionar']).ok, false);
assert.equal(aceiteVerificavel(['ficar bom']).ok, false);
assert.equal(aceiteVerificavel(['GET /saude responde 200 com {ok:true}']).ok, true);
assert.equal(aceiteVerificavel([{ t: 'o botão Salvar fica desabilitado sem login', ok: false }]).ok, true);
assert.match(aceiteVerificavel(['ok', 'GET /saude responde 200']).motivo, /vago/);

// ---- on the board: an agent cannot pull a card without acceptance; the Game Director can; with acceptance written, it proceeds
const store = await import('../lib/store.mjs');
store.gravarConfig({ ...store.lerConfig(), piloto: { ativo: false, maxChamadasHora: 0 }, ciclo: { ...store.lerConfig().ciclo, fechamento: false, statusPO: false } });
const { iniciarServidor } = await import('../server.mjs');
const projetos = await import('../lib/projetos.mjs');
const srv = await iniciarServidor({ porta: 0 });
const base = `http://127.0.0.1:${srv.porta}`;
const J = async (m, u, b) => { const r = await fetch(base + u, { method: m, headers: { 'Content-Type': 'application/json' }, body: m === 'GET' ? undefined : JSON.stringify(b || {}) }); return { status: r.status, ...(await r.json().catch(() => ({}))) }; };
const raiz = path.join(tmp, 'repo'); fs.mkdirSync(raiz);
const g = (...a) => execFileSync('git', ['-C', raiz, ...a], { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
g('init', '-q', '-b', 'main'); g('config', 'user.email', 't@t'); g('config', 'user.name', 't');
fs.writeFileSync(path.join(raiz, 'a.txt'), 'base\n'); g('add', '.'); g('commit', '-q', '-m', 'base');
g('checkout', '-q', '-b', 'T-001-entrega'); fs.writeFileSync(path.join(raiz, 'a.txt'), 'entrega\n'); g('commit', '-q', '-am', 'entrega'); g('checkout', '-q', 'main');
const pid = (await J('POST', '/api/projetos', { nome: 'XP', caminho: raiz, template: 'software' })).projeto.id;
const c = projetos.ctx(pid);
const semAceite = c.quadro.criar({ titulo: 'Criar rota de saúde', descricao: 'Endpoint de saúde', dono: 'backend', coluna: 'backlog', pontos: 1 }, 'po');
assert(semAceite.ok);
const mv = c.quadro.mover(semAceite.card.id, 'andamento', 'backend');
assert.equal(mv.ok, false); assert.match(mv.erro, /aceite/, 'an agent does not start without acceptance');
assert.equal(c.quadro.mover(semAceite.card.id, 'pronto', 'po').ok, false, 'not even the P.O. pulls without acceptance');
assert.equal(c.quadro.atualizar(semAceite.card.id, { aceite: ['GET /saude responde 200 com {ok:true}'] }, 'po').ok, true);
assert.equal(c.quadro.mover(semAceite.card.id, 'andamento', 'backend').ok, true, 'with verifiable acceptance, it proceeds');
const vaga = c.quadro.criar({ titulo: 'Melhorar performance', descricao: 'x', dono: 'backend', coluna: 'backlog', pontos: 2, aceite: ['ficar rápido'] }, 'po');
assert.equal(c.quadro.mover(vaga.card.id, 'andamento', 'backend').ok, false, 'vague acceptance does not count');
assert.equal(c.quadro.mover(vaga.card.id, 'andamento', 'voce', { forcar: true, motivo: 'decisão humana' }).ok, true, 'the Game Director can force it, with a reason');
// the next cycle task for a card without acceptance is the P.O. writing it, not the owner executing
const semAceite2 = c.quadro.criar({ titulo: 'Outra rota', descricao: 'y', dono: 'backend', coluna: 'pronto', pontos: 1 }, 'voce');
const prox = c.equipe.proximaTarefa(c.quadro.obter(semAceite2.card.id));
assert.equal(prox?.tipo, 'planejar_card'); assert.equal(prox?.agente, 'po'); assert.match(prox.instrucao, /aceite/);

// ---- separate worktree to review the delivery branch, discarded afterwards
const dir = path.join(tmp, 'revisao-T-001');
const w = worktreeRevisao(raiz, 'T-001-entrega', dir);
assert(w && fs.existsSync(path.join(dir, 'a.txt')), 'the worktree exists');
assert.equal(fs.readFileSync(path.join(dir, 'a.txt'), 'utf8').replace(/\r\n/g, '\n'), 'entrega\n', 'it is the delivery branch');
fs.writeFileSync(path.join(dir, 'a.txt'), 'rabisco do revisor\n');
w.limpar();
assert(!fs.existsSync(dir), 'the folder is gone when done');
assert.equal(fs.readFileSync(path.join(raiz, 'a.txt'), 'utf8').replace(/\r\n/g, '\n'), 'base\n', 'nothing from the review reaches the repository');
assert.equal(g('status', '--porcelain'), '', 'the repository stays clean');
assert.equal(worktreeRevisao(raiz, 'branch-inexistente', dir), null);
assert.equal(worktreeRevisao(path.join(tmp, 'sem-git'), 'main', dir), null);

srv.encerrar(); await store.descarregar();
console.log('PASS: XP disciplines (verifiable acceptance required before starting, agents do not pull without it and the next task is the P.O. writing it, override only by a human with a reason; review in a separate, discarded worktree, without touching the delivery).');
process.exit(0);
