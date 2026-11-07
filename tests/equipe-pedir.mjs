// Work request to another team (equipe.pedir): it leaves this team's leadership with the file, reaches the other leadership with
// a copy of the file, and their delivery comes back attached in the same conversation. Before, the bridge only carried text.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nectar-equipe-pedir-'));
process.env.STUDIO_DATA = path.join(tmp, 'data'); process.env.STUDIO_PROJETOS = path.join(tmp, 'projetos'); process.env.STUDIO_FAKE = '1'; process.env.STUDIO_FAKE_LOCAL = '0';
const store = await import('../lib/store.mjs');
store.gravarConfig({ piloto: { ativo: false, maxChamadasHora: 0 }, ciclo: { statusPO: false, fechamento: false, revisaoAuto: false, versionar: false, curadoriaAuto: false, planningReplica: false } });
const projetos = await import('../lib/projetos.mjs');
const dorme = (ms) => new Promise((x) => setTimeout(x, ms));
const espera = async (cond, ms = 25000) => { for (let i = 0; i < ms / 50 && !cond(); i++) await dorme(50); return cond(); };

const alvo = path.join(tmp, 'alvo'); fs.mkdirSync(path.join(alvo, 'entregas'), { recursive: true });
fs.writeFileSync(path.join(alvo, 'entregas', 'relatorio.pdf'), '%PDF original');
fs.writeFileSync(path.join(alvo, 'entregas', 'bonito.pdf'), '%PDF com identidade visual');
const r = projetos.criar({ nome: 'Dois times', caminho: alvo, template: 'software' }); assert(r.ok);
const pid = r.projeto.id; const sw = projetos.ctx(pid).equipe;
const ass = projetos.adicionarEquipe(pid, { template: 'professional-operations' }); assert(ass.ok);
const cidAss = projetos.colegasExternos(pid).find((x) => x.lider).cid;
const la = projetos.ctx(cidAss).equipe;

// the P.O. uses the team's internal id, as in the screenshot: it must work
sw.enviar({ canal: 'dm:po', texto: '[teste:equipe-pedir:professional_operations:entregas/relatorio.pdf] pede pra assessoria' });
const salaLa = () => la.grupos().find((g) => g.ponte);
assert(await espera(() => salaLa() && la.historico(salaLa().canal).some((m) => m.externa && m.anexos?.some((a) => /relatorio\.pdf$/.test(a.nome)))), 'the request arrives there with the file attached');
const pastaLa = path.join(projetos.ctx(cidAss).pasta, 'anexos');
const copias = fs.readdirSync(pastaLa, { recursive: true }).filter((f) => /relatorio\.pdf$/.test(String(f)));
assert(copias.length && fs.readFileSync(path.join(pastaLa, String(copias[0])), 'utf8') === '%PDF original', 'the other team has its own copy of the file for its agents to read');

// the other leadership replies in the conversation with the finished file: it comes back attached here
const salaAqui = () => sw.grupos().find((g) => g.ponte);
assert(await espera(() => salaAqui() && sw.historico(salaAqui().canal).some((m) => m.externa && m.anexos?.some((a) => a.pid && /bonito\.pdf$/.test(a.nome)))), 'the other team delivery comes back attached');
assert(!sw.historico('dm:po').some((m) => m.resumo?.some((x) => x.tipo === 'aviso' && /não achei|não achou|precisa/.test(x.texto))), 'no team-not-found warning');

// only leadership asks another team; a nonexistent team reports which ones exist
sw.enviar({ canal: 'dm:backend', texto: '[teste:equipe-pedir:assessoria:entregas/relatorio.pdf] eu mesmo peço' });
assert(await espera(() => sw.historico('dm:backend').some((m) => m.resumo?.some((x) => x.tipo === 'aviso' && /é da liderança/.test(x.texto)))), 'a specialist does not ask another team directly');
sw.enviar({ canal: 'dm:po', texto: '[teste:equipe-pedir:marketing:entregas/relatorio.pdf] e essa?' });
assert(await espera(() => sw.historico('dm:po').some((m) => m.resumo?.some((x) => x.tipo === 'aviso' && /não achei a equipe "marketing".*Assessoria/.test(x.texto)))), 'nonexistent team: the warning lists the existing ones');

await dorme(300);
try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { /* temp folder */ }
console.log('PASS: equipe.pedir (by internal team id, the file goes and the delivery comes back attached, only leadership asks, a nonexistent team lists the existing ones).');
process.exit(0);
