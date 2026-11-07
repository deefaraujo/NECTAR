// grupo.criar com alguém de outra equipe quando os nomes se repetem entre equipes (Marina, Helena, Rafa...):
// o nome da equipe vai para a liderança de lá, e nome@equipe escolhe a pessoa. Antes, o grupo saía vazio e o pedido travava.
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
assert(marinaDeLa, 'a Assessoria tem um qa, como o Software');

const salas = () => eq.grupos().filter((g) => g.ponte);
const avisos = () => eq.historico('dm:po').filter((m) => m.resumo?.some((x) => x.tipo === 'aviso')).flatMap((m) => m.resumo.filter((x) => x.tipo === 'aviso').map((x) => x.texto));

// pelo nome da equipe: vai para a liderança de lá
eq.enviar({ canal: 'dm:po', texto: `[teste:grupo-externo:${equipeAss}] pede ajuda pra assessoria` });
assert(await espera(() => salas().some((g) => g.ponte.com === cols.find((x) => x.lider).nome)), 'abre a sala com a liderança da Assessoria');
assert(!avisos().some((t) => /precisa de pelo menos|não achou/.test(t)), 'não sai grupo vazio');

// nome repetido: nome@equipe escolhe a Marina de lá
eq.enviar({ canal: 'dm:po', texto: '[teste:grupo-externo:qa@assessoria] e o qa de lá?' });
assert(await espera(() => salas().some((g) => g.ponte.com === marinaDeLa.nome)), 'nome@equipe chega na pessoa certa da outra equipe');

// ninguém encontrado: o aviso diz como chamar
eq.enviar({ canal: 'dm:po', texto: '[teste:grupo-externo:fulano] e agora?' });
assert(await espera(() => avisos().some((t) => /não achou ninguém/.test(t) && /@/.test(t))), 'o aviso mostra como chamar alguém de outra equipe');

const leve = eq.teste.montar({ agente: 'po', tipo: 'pedido', card: null, canalSaida: 'dm:po', instrucao: 'oi', origem: 'voce' });
assert(/mesmo nome de alguém daqui: use qa@/.test(leve.pedido + leve.sistema), 'a lista de colegas externos ensina nome@equipe quando o nome se repete');

await dorme(300);
try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { /* pasta temporária */ }
console.log('PASS: grupo com outra equipe (nome da equipe vai para a liderança, nome@equipe resolve nome repetido, aviso ensina como chamar).');
process.exit(0);
