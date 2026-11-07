// Registro do projeto: o que a P.O. (ou quem recebeu) anotou uma vez chega pronto no prompt de quem trabalha depois, sem
// varrer conversa nem arquivo. Entra inteiro o que é fixo (série, estilo), o que a tarefa cita pelo nome e o que o card aponta
// em contexto[]; o resto vai só como índice. Vale para qualquer template (a Software usa os tipos padrão).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nectar-registro-'));
process.env.STUDIO_DATA = path.join(tmp, 'data'); process.env.STUDIO_PROJETOS = path.join(tmp, 'projetos'); process.env.STUDIO_FAKE = '1'; process.env.STUDIO_FAKE_LOCAL = '0';
const store = await import('../lib/store.mjs');
store.gravarConfig({ piloto: { ativo: false, maxChamadasHora: 0 }, ciclo: { statusPO: false, fechamento: false, revisaoAuto: false, versionar: false, curadoriaAuto: false, planningReplica: false } });
const projetos = await import('../lib/projetos.mjs');
const dorme = (ms) => new Promise((x) => setTimeout(x, ms));
const espera = async (cond, ms = 25000) => { for (let i = 0; i < ms / 50 && !cond(); i++) await dorme(50); return cond(); };

const alvo = path.join(tmp, 'novela'); fs.mkdirSync(alvo, { recursive: true });
const r = projetos.criar({ nome: 'Amor em 9:16', caminho: alvo, template: 'novela-vertical' }); assert(r.ok, r.erro);
const c = projetos.ctx(r.projeto.id); const eq = c.equipe;
assert.deepEqual(Object.keys(eq.registro.tipos).filter((k) => ['serie', 'estilo', 'personagem', 'cena'].includes(k)).sort(), ['cena', 'estilo', 'personagem', 'serie'], 'tipos da novela vêm do template');

// a Game Director conta; a showrunner anota uma vez pela ação
eq.enviar({ canal: 'dm:showrunner', texto: '[teste:anotar:serie:Amor Vertical:Drama romântico vertical em aquarela, episódios de 2 minutos] esse é o briefing' });
eq.enviar({ canal: 'dm:showrunner', texto: '[teste:anotar:personagem:Ana:Ruiva de cachos, 27 anos, sardas, jaqueta verde] a protagonista' });
assert(await espera(() => eq.registro.obter('personagem:ana') && eq.registro.obter('serie:amor-vertical')), 'fichas anotadas pela ação');
assert(await espera(() => eq.historico('dm:showrunner').some((m) => m.resumo?.some((x) => /anotou no registro/.test(x.acao || '')))), 'a anotação aparece no chat');
eq.registro.anotar({ tipo: 'personagem', nome: 'Bruno', resumo: 'Irmão mais velho da Ana, barba, sempre de terno.', por: 'continuidade' });
eq.registro.anotar({ tipo: 'cena', id: 'ep01-c02', nome: 'Cena 2 do ep 1', apelidos: ['cena 2'], resumo: 'Ana encontra a carta escondida no livro.', por: 'roteiro' });

const montar = (t) => eq.teste.montar({ canalSaida: 'equipe', origem: 'showrunner', tipo: 'mencao', ...t });
const prompt = (x) => { const p = montar(x); return [p.sistema, p.pedido].filter(Boolean).join('\n'); };

// o Teo é chamado para o quadro da Ana na cena 2: recebe Ana, a cena e a série inteiras; o Bruno só no índice
const p1 = prompt({ agente: 'diretor_arte', instrucao: '@teo faz o quadro da Ana na cena 2' });
assert(/O que já foi levantado/.test(p1), 'seção do registro no prompt');
assert(p1.includes('Ruiva de cachos, 27 anos') && p1.includes('carta escondida') && p1.includes('Drama romântico vertical'), 'Ana, cena 2 e série chegam inteiras');
assert(!p1.includes('sempre de terno') && /\[personagem:bruno\] Bruno/.test(p1), 'Bruno, não citado, vai só como índice');

// card apontando o Bruno no contexto[]: chega inteiro sem o nome aparecer no texto
const card = c.quadro.criar({ titulo: 'Folha de personagem do irmão', dono: 'diretor_arte', aceite: ['folha com frente, perfil e rosto'] }, 'showrunner'); assert(card.ok, card.erro);
assert(c.quadro.atualizar(card.card.id, { contexto: ['personagem:bruno'] }, 'showrunner').ok, 'card aceita contexto[]');
const p2 = prompt({ agente: 'diretor_arte', tipo: 'execucao', card: card.card.id, instrucao: 'faça a folha' });
assert(p2.includes('sempre de terno'), 'ficha apontada no card chega inteira');
assert(!c.quadro.atualizar(card.card.id, { contexto: 'personagem:bruno' }, 'showrunner').ok, 'contexto que não é lista é recusado');

// atualizar é por versão, e quem recebe vê a versão nova
eq.registro.anotar({ tipo: 'personagem', nome: 'Ana', resumo: 'Agora usa óculos redondos.', modo: 'acrescentar', por: 'continuidade' });
const p3 = prompt({ agente: 'storyboard', instrucao: 'planos da cena com a Ana' });
assert(p3.includes('Agora usa óculos redondos') && p3.includes('Ruiva de cachos') && /\[personagem:ana\] \(v2/.test(p3), 'acréscimo soma ao que havia, com versão');

// a ação existe também na conversa sem card (prompt leve)
assert(/- registro\.anotar:/.test(prompt({ agente: 'continuidade', canalSaida: 'dm:continuidade', instrucao: 'oi' })), 'registro.anotar documentado no prompt leve');

// Software (sem tipos no template) usa os tipos padrão: briefing fixo em toda chamada
const alvo2 = path.join(tmp, 'app'); fs.mkdirSync(alvo2, { recursive: true });
const r2 = projetos.criar({ nome: 'App', caminho: alvo2, template: 'software' }); assert(r2.ok, r2.erro);
const eq2 = projetos.ctx(r2.projeto.id).equipe;
eq2.registro.anotar({ tipo: 'briefing', nome: 'Briefing do app', resumo: 'App de agendamento para clínicas, web e mobile.', por: 'po' });
const ps = eq2.teste.montar({ agente: 'backend', tipo: 'mencao', canalSaida: 'equipe', origem: 'po', instrucao: 'qual banco usar?' });
assert([ps.sistema, ps.pedido].join('\n').includes('agendamento para clínicas'), 'briefing é fixo em qualquer template');

await dorme(300);
try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { /* pasta temporária */ }
console.log('PASS: registro do projeto (anotado uma vez pela ação, citado pelo nome chega inteiro, não citado só no índice, contexto[] do card, versões, prompt leve, briefing fixo em qualquer template).');
process.exit(0);
