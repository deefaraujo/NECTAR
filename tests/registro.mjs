// Project registry: what the P.O. (or whoever received it) noted once reaches the prompt of whoever works later, ready, without
// scanning chats or files. Included in full: what is fixed (series, style), what the task names, and what the card points to
// in contexto[]; the rest goes only as an index. Applies to any template (Software uses the default types).
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
assert.deepEqual(Object.keys(eq.registro.tipos).filter((k) => ['serie', 'estilo', 'personagem', 'cena'].includes(k)).sort(), ['cena', 'estilo', 'personagem', 'serie'], 'drama types come from the template');

// the Game Director tells; the showrunner notes it once through the action
eq.enviar({ canal: 'dm:showrunner', texto: '[teste:anotar:serie:Amor Vertical:Drama romântico vertical em aquarela, episódios de 2 minutos] esse é o briefing' });
eq.enviar({ canal: 'dm:showrunner', texto: '[teste:anotar:personagem:Ana:Ruiva de cachos, 27 anos, sardas, jaqueta verde] a protagonista' });
assert(await espera(() => eq.registro.obter('personagem:ana') && eq.registro.obter('serie:amor-vertical')), 'entries noted through the action');
assert(await espera(() => eq.historico('dm:showrunner').some((m) => m.resumo?.some((x) => /anotou no registro/.test(x.acao || '')))), 'the note shows up in chat');
eq.registro.anotar({ tipo: 'personagem', nome: 'Bruno', resumo: 'Irmão mais velho da Ana, barba, sempre de terno.', por: 'continuidade' });
eq.registro.anotar({ tipo: 'cena', id: 'ep01-c02', nome: 'Cena 2 do ep 1', apelidos: ['cena 2'], resumo: 'Ana encontra a carta escondida no livro.', por: 'roteiro' });

const montar = (t) => eq.teste.montar({ canalSaida: 'equipe', origem: 'showrunner', tipo: 'mencao', ...t });
const prompt = (x) => { const p = montar(x); return [p.sistema, p.pedido].filter(Boolean).join('\n'); };

// Teo is called for Ana's frame in scene 2: gets Ana, the scene and the series in full; Bruno only in the index
const p1 = prompt({ agente: 'diretor_arte', instrucao: '@teo faz o quadro da Ana na cena 2' });
assert(/O que já foi levantado/.test(p1), 'registry section in the prompt');
assert(p1.includes('Ruiva de cachos, 27 anos') && p1.includes('carta escondida') && p1.includes('Drama romântico vertical'), 'Ana, scene 2 and the series arrive in full');
assert(!p1.includes('sempre de terno') && /\[personagem:bruno\] Bruno/.test(p1), 'Bruno, not mentioned, goes only as an index');

// a card pointing to Bruno in contexto[]: arrives in full without the name in the text
const card = c.quadro.criar({ titulo: 'Folha de personagem do irmão', dono: 'diretor_arte', aceite: ['folha com frente, perfil e rosto'] }, 'showrunner'); assert(card.ok, card.erro);
assert(c.quadro.atualizar(card.card.id, { contexto: ['personagem:bruno'] }, 'showrunner').ok, 'card accepts contexto[]');
const p2 = prompt({ agente: 'diretor_arte', tipo: 'execucao', card: card.card.id, instrucao: 'faça a folha' });
assert(p2.includes('sempre de terno'), 'entry referenced by the card arrives in full');
assert(!c.quadro.atualizar(card.card.id, { contexto: 'personagem:bruno' }, 'showrunner').ok, 'a non-list contexto is rejected');

// updates are versioned, and the recipient sees the new version
eq.registro.anotar({ tipo: 'personagem', nome: 'Ana', resumo: 'Agora usa óculos redondos.', modo: 'acrescentar', por: 'continuidade' });
const p3 = prompt({ agente: 'storyboard', instrucao: 'planos da cena com a Ana' });
assert(p3.includes('Agora usa óculos redondos') && p3.includes('Ruiva de cachos') && /\[personagem:ana\] \(v2/.test(p3), 'an addition appends to what was there, with a version');

// the action also exists in a chat without a card (light prompt)
assert(/- registro\.anotar:/.test(prompt({ agente: 'continuidade', canalSaida: 'dm:continuidade', instrucao: 'oi' })), 'registro.anotar documented in the light prompt');

// Software (no types in the template) uses the default types: briefing fixed on every call
const alvo2 = path.join(tmp, 'app'); fs.mkdirSync(alvo2, { recursive: true });
const r2 = projetos.criar({ nome: 'App', caminho: alvo2, template: 'software' }); assert(r2.ok, r2.erro);
const eq2 = projetos.ctx(r2.projeto.id).equipe;
eq2.registro.anotar({ tipo: 'briefing', nome: 'Briefing do app', resumo: 'App de agendamento para clínicas, web e mobile.', por: 'po' });
const ps = eq2.teste.montar({ agente: 'backend', tipo: 'mencao', canalSaida: 'equipe', origem: 'po', instrucao: 'qual banco usar?' });
assert([ps.sistema, ps.pedido].join('\n').includes('agendamento para clínicas'), 'briefing is fixed in any template');

await dorme(300);
try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { /* temp folder */ }
console.log('PASS: project registry (noted once through the action, named entries arrive in full, unnamed only in the index, card contexto[], versions, light prompt, briefing fixed in any template).');
process.exit(0);
