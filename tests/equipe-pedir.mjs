// Pedido de trabalho a outra equipe (equipe.pedir): sai da liderança daqui com o arquivo, chega na liderança de lá com
// a cópia do arquivo, e a entrega de lá volta anexada na mesma conversa. Antes, a ponte só levava texto.
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

// a P.O. usa o id interno da equipe, como no print: tem que funcionar
sw.enviar({ canal: 'dm:po', texto: '[teste:equipe-pedir:professional_operations:entregas/relatorio.pdf] pede pra assessoria' });
const salaLa = () => la.grupos().find((g) => g.ponte);
assert(await espera(() => salaLa() && la.historico(salaLa().canal).some((m) => m.externa && m.anexos?.some((a) => /relatorio\.pdf$/.test(a.nome)))), 'o pedido chega lá com o arquivo anexado');
const pastaLa = path.join(projetos.ctx(cidAss).pasta, 'anexos');
const copias = fs.readdirSync(pastaLa, { recursive: true }).filter((f) => /relatorio\.pdf$/.test(String(f)));
assert(copias.length && fs.readFileSync(path.join(pastaLa, String(copias[0])), 'utf8') === '%PDF original', 'a outra equipe tem a sua cópia do arquivo para os agentes lerem');

// a liderança de lá responde na conversa com o arquivo pronto: volta anexado para cá
const salaAqui = () => sw.grupos().find((g) => g.ponte);
assert(await espera(() => salaAqui() && sw.historico(salaAqui().canal).some((m) => m.externa && m.anexos?.some((a) => a.pid && /bonito\.pdf$/.test(a.nome)))), 'a entrega da outra equipe volta anexada');
assert(!sw.historico('dm:po').some((m) => m.resumo?.some((x) => x.tipo === 'aviso' && /não achei|não achou|precisa/.test(x.texto))), 'sem aviso de equipe não encontrada');

// só a liderança pede a outra equipe; equipe inexistente diz quais existem
sw.enviar({ canal: 'dm:backend', texto: '[teste:equipe-pedir:assessoria:entregas/relatorio.pdf] eu mesmo peço' });
assert(await espera(() => sw.historico('dm:backend').some((m) => m.resumo?.some((x) => x.tipo === 'aviso' && /é da liderança/.test(x.texto)))), 'especialista não pede direto a outra equipe');
sw.enviar({ canal: 'dm:po', texto: '[teste:equipe-pedir:marketing:entregas/relatorio.pdf] e essa?' });
assert(await espera(() => sw.historico('dm:po').some((m) => m.resumo?.some((x) => x.tipo === 'aviso' && /não achei a equipe "marketing".*Assessoria/.test(x.texto)))), 'equipe que não existe: o aviso lista as que existem');

await dorme(300);
try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { /* pasta temporária */ }
console.log('PASS: equipe.pedir (pelo id interno da equipe, arquivo vai e entrega volta anexada, só a liderança pede, equipe inexistente lista as que existem).');
process.exit(0);
