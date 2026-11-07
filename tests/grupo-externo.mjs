// grupo.criar with someone from another team when names repeat across teams (Marina, Helena, Rafa...):
// the team name goes to that team's leadership, and name@team picks the person. Before, the group came out empty and the request hung.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nectar-grupo-externo-'));
process.env.STUDIO_DATA = path.join(tmp, 'data'); process.env.STUDIO_PROJETOS = path.join(tmp, 'projetos'); process.env.STUDIO_FAKE = '1'; process.env.STUDIO_FAKE_LOCAL = '0';
const store = await import('../lib/store.mjs');
store.gravarConfig({ piloto: { ativo: false, maxChamadasHora: 0 }, ciclo: { statusPO: false, fechamento: false, revisaoAuto: false, versionar: false, curadoriaAuto: false, planningReplica: false } });
const projetos = await import('../lib/projetos.mjs');
const dorme = (ms) => new Promise((x) => setTimeout(x, ms));
const espera = async (cond, ms = 20000) => { for (let i = 0; i < ms / 50 && !cond(); i++) await dorme(50); return cond(); };

fs.mkdirSync(path.join(tmp, 'alvo'));
const r = projetos.criar({ nome: 'Dois times', caminho: path.join(tmp, 'alvo'), template: 'software' }); assert(r.ok);
const pid = r.projeto.id; const eq = projetos.ctx(pid).equipe;
const ass = projetos.adicionarEquipe(pid, { template: 'professional-operations' }); assert(ass.ok);
const cols = projetos.colegasExternos(pid);
const equipeAss = cols.find((x) => x.lider).equipe;
const marinaDeLa = cols.find((x) => x.token === 'qa');
assert(marinaDeLa, 'Assessoria has a qa, like Software');

const salas = () => eq.grupos().filter((g) => g.ponte);
const avisos = () => eq.historico('dm:po').filter((m) => m.resumo?.some((x) => x.tipo === 'aviso')).flatMap((m) => m.resumo.filter((x) => x.tipo === 'aviso').map((x) => x.texto));

// by team name: goes to that team's leadership
eq.enviar({ canal: 'dm:po', texto: `[teste:grupo-externo:${equipeAss}] pede ajuda pra assessoria` });
assert(await espera(() => salas().some((g) => g.ponte.com === cols.find((x) => x.lider).nome)), 'opens the room with the Assessoria leadership');
assert(!avisos().some((t) => /precisa de pelo menos|não achou/.test(t)), 'no empty group is created');

// repeated name: name@team picks the Marina from the other team
eq.enviar({ canal: 'dm:po', texto: '[teste:grupo-externo:qa@assessoria] e o qa de lá?' });
assert(await espera(() => salas().some((g) => g.ponte.com === marinaDeLa.nome)), 'name@team reaches the right person on the other team');

// nobody found: the warning says how to call someone
eq.enviar({ canal: 'dm:po', texto: '[teste:grupo-externo:fulano] e agora?' });
assert(await espera(() => avisos().some((t) => /não achou ninguém/.test(t) && /@/.test(t))), 'the warning shows how to call someone from another team');

const leve = eq.teste.montar({ agente: 'po', tipo: 'pedido', card: null, canalSaida: 'dm:po', instrucao: 'oi', origem: 'voce' });
assert(/mesmo nome de alguém daqui: use qa@/.test(leve.pedido + leve.sistema), 'the external colleague list teaches name@team when the name repeats');

await dorme(300);
try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { /* temp folder */ }
console.log('PASS: group with another team (team name goes to leadership, name@team resolves a repeated name, warning teaches how to call).');
process.exit(0);
