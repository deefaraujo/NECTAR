// Jogos em Ren'Py para celular: equipe com Pesquisa, skills de Ren'Py nos cargos certos e sem engine de fora, aba Produção com
// os tipos do template, pedidos apontando agente real, e a ferramenta de sprites alinhando um lote (mesma escala, mesma base).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { skillDisponivelOuOpcional } from '../lib/skills-opcionais.mjs';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nectar-jogos-'));
process.env.STUDIO_DATA = path.join(tmp, 'data'); process.env.STUDIO_PROJETOS = path.join(tmp, 'projetos'); process.env.STUDIO_FAKE = '1'; process.env.STUDIO_FAKE_LOCAL = '0';
const store = await import('../lib/store.mjs');
store.gravarConfig({ piloto: { ativo: false, maxChamadasHora: 0 }, ciclo: { statusPO: false, fechamento: false, revisaoAuto: false, versionar: false, curadoriaAuto: false, planningReplica: false } });
const { criarElenco } = await import('../lib/agentes.mjs');
const projetos = await import('../lib/projetos.mjs');
const RAIZ = path.resolve(import.meta.dirname, '..', 'templates', 'jogos');

const el = criarElenco('jogos');
assert(el.POR_ID.pesquisa, 'agente de Pesquisa existe');
const sk = (id) => (el.POR_ID[id]?.skills||[]).filter(s=>skillDisponivelOuOpcional('jogos',s));
for (const [ag, s] of [['developer', 'renpy-codigo'], ['developer', 'renpy-mobile'], ['uiux', 'renpy-mobile'], ['sprites', 'renpy-sprites'], ['qa', 'renpy-mobile'], ['pesquisa', 'documentation']]) assert(sk(ag).includes(s), `${ag} tem ${s}`);
for (const [ag, s] of [['sprites', 'assets-abertos'], ['uiux', 'renpy-ui-acabada'], ['gamefeel', 'renpy-vfx'], ['visual_novel', 'renpy-vn'], ['developer', 'renpy-recursos'], ['gamefeel', 'maximizing-game-feel'], ['gamefeel', 'designing-mini-games'], ['qa', 'auditing-game-screen-readability']]) assert(sk(ag).includes(s), `${ag} tem ${s}`);
for (const [skill, ex] of [['renpy-vn', ['estrutura.rpy', 'telas.rpy', 'minijogos.rpy', 'sistemas.rpy', 'testes_exemplos.rpy']], ['renpy-recursos', ['recursos.rpy', 'testes_recursos.rpy']], ['renpy-vfx', ['vfx.rpy', 'testes_vfx.rpy']], ['renpy-ui-acabada', ['ui_acabada.rpy', 'testes_ui.rpy']]]) {
  if(!fs.existsSync(path.join(RAIZ,'skills',skill,'SKILL.md'))){assert(skillDisponivelOuOpcional('jogos',skill));console.log(`Pacote opcional não distribuído: ${skill}; exemplos externos não executados.`);continue;}
  for (const f of ex) assert(fs.existsSync(path.join(RAIZ, 'skills', skill, 'exemplos', f)), `${skill}/exemplos/${f} existe`);
}
for (const a of el.ROSTER || Object.values(el.POR_ID)) assert(!(a.skills || []).some((s) => /^(godot|unity|unreal)-/.test(s)), `${a.id} sem skill de outra engine`);
const regras = fs.readFileSync(path.join(RAIZ, 'regras.md'), 'utf8');
for (const t of ["Ren'Py 2D para celular", 'RENPY_VARIANT', 'docs/', '_padronizado/', 'Nível de produto', 'assets-abertos', 'MANIFESTO.md', 'Estúdio, não fábrica', 'direcao-de-experiencia', 'Revisão olha a tela']) assert(regras.includes(t), `regras citam ${t}`);
const tpl = JSON.parse(fs.readFileSync(path.join(RAIZ, 'template.json'), 'utf8'));
for (const id of ['po', 'narrative', 'architect', 'gamefeel', 'uiux', 'sprites', 'pesquisa']) assert(tpl.agentes.find((a) => a.id === id).skills.includes('direcao-de-experiencia'), `${id} tem a skill de direção de experiência`);
for (const [tipo, cfg] of Object.entries(tpl.registro.tipos)) for (const p of cfg.pedidos || []) assert(el.POR_ID[p.agente], `pedido "${p.rotulo}" de ${tipo} aponta agente que existe`);

const alvo = path.join(tmp, 'jogo'); fs.mkdirSync(alvo);
const r = projetos.criar({ nome: 'Jogo celular', caminho: alvo, template: 'jogos' }); assert(r.ok, r.erro);
const eq = projetos.ctx(r.projeto.id).equipe;
assert.equal(eq.registro.vista, 'Produção');
assert.deepEqual(Object.keys(eq.registro.tipos).sort(), ['cena', 'cenario', 'documento', 'estilo', 'jogo', 'personagem', 'sistema', 'tela']);
eq.registro.anotar({ tipo: 'jogo', nome: 'Jogo teste', resumo: 'Retrato 1080x1920, Android.', por: 'voce' });
eq.registro.anotar({ tipo: 'tela', nome: 'Menu principal', resumo: 'Jogar, Continuar, Opções.', por: 'voce' });
const p = eq.registro.paraPrompt(eq.registro.selecionar({ textos: ['implemente a tela Menu principal'] }));
assert(/Retrato 1080x1920/.test(p) && /Menu principal/.test(p), 'ficha Jogo sempre e a tela citada chegam ao prompt');

// ferramenta de sprites: dois "quadros" de alturas diferentes saem com a mesma escala e a mesma base
const py = process.platform === 'win32' ? 'python' : 'python3';
const temPil = spawnSync(py, ['-c', 'import PIL'], { encoding: 'utf8' }).status === 0;
if (temPil) {
  const ent = path.join(tmp, 'q'); const sai = path.join(tmp, 'p'); fs.mkdirSync(ent);
  const gera = `from PIL import Image, ImageDraw
import sys
for nome, alt in (('a', 300), ('b', 200)):
    im = Image.new('RGBA', (400, 400), (0, 0, 0, 0)); ImageDraw.Draw(im).rectangle((150, 350 - alt, 249, 349), fill=(200, 80, 40, 255)); im.save(sys.argv[1] + '/' + nome + '.png')
Image.new('RGB', (100, 100), (0, 0, 0)).save(sys.argv[1] + '/opaca.png')`;
  assert.equal(spawnSync(py, ['-c', gera, ent]).status, 0);
  const script = path.join(RAIZ, 'skills', 'renpy-sprites', 'scripts', 'sprites.py');
  const pad = spawnSync(py, ['-X', 'utf8', '-I', script, 'padronizar', ent, '--saida', sai, '--altura', '150', '--canvas', '300x200'], { encoding: 'utf8' });
  assert.notEqual(pad.status, 0, 'imagem opaca derruba o código de saída');
  assert(/SEM TRANSPAR/.test(pad.stderr), 'avisa imagem sem transparência');
  const info = JSON.parse(spawnSync(py, ['-X', 'utf8', '-I', script, 'info', sai], { encoding: 'utf8' }).stdout.split('\n]')[0] + '\n]');
  assert.deepEqual(info.map((x) => x.util), ['50x150', '50x100'], 'uma escala para o lote: a mais alta vira 150 e a outra mantém a proporção');
  assert(info.every((x) => x.margem.base === info[0].margem.base), 'mesma linha de base');
  assert(!fs.existsSync(path.join(sai, 'opaca.png')), 'opaca não é gravada');
} else console.log('aviso: Python com Pillow ausente, ferramenta de sprites não testada');
{
  const baixar = path.join(RAIZ, 'skills', 'assets-abertos', 'scripts', 'baixar.py');
  const r1 = spawnSync(py, ['-X', 'utf8', '-I', baixar, 'https://example.invalid/x.zip', '--para', path.join(tmp, 'a1'), '--licenca', 'Proprietaria', '--origem', 'x'], { encoding: 'utf8' });
  assert.notEqual(r1.status, 0, 'licença fora da lista é recusada'); assert(/não está na lista/.test(r1.stderr + r1.stdout), 'explica a recusa');
  const r2 = spawnSync(py, ['-X', 'utf8', '-I', baixar, 'https://example.invalid/x.zip', '--para', path.join(tmp, 'a2'), '--licenca', 'CC-BY-4.0', '--origem', 'x'], { encoding: 'utf8' });
  assert.notEqual(r2.status, 0, 'CC-BY sem atribuição é recusado antes de baixar'); assert(/atribuicao/.test(r2.stderr + r2.stdout));
}

await new Promise((x) => setTimeout(x, 300));
try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { /* pasta temporária */ }
console.log("PASS: jogos Ren'Py celular (regras de nível de produto, download de asset só com licença aceita, Pesquisa na equipe, skills de Ren'Py com exemplos conferidos, game feel e legibilidade nos cargos certos, sem outra engine, aba Produção com os tipos do jogo, pedidos com agente real, ferramenta de sprites alinha o lote e recusa imagem opaca).");

// verificador de arquivos do Ren'Py: acusa arquivo citado que não existe, provisório e teste dentro de game/
{
  const { execFileSync } = await import('node:child_process');
  const os = await import('node:os');
  const proj = fs.mkdtempSync(path.join(os.tmpdir(), 'checar-assets-'));
  fs.mkdirSync(path.join(proj, 'game', 'cenas'), { recursive: true });
  fs.mkdirSync(path.join(proj, 'game', 'gui'), { recursive: true });
  fs.writeFileSync(path.join(proj, 'game', 'gui', 'existe.png'), 'x');
  fs.writeFileSync(path.join(proj, 'game', 'options.rpy'), 'define config.name = "x"\n');
  fs.writeFileSync(path.join(proj, 'game', 'telas.rpy'), 'screen s():\n    add "gui/existe.png"\n    add "gui/falta.png"\n    add "gui/ui/PROV_icone.png"\n');
  fs.writeFileSync(path.join(proj, 'game', 'cenas', 'teste_x.rpy'), 'label t:\n    return\n');
  fs.writeFileSync(path.join(proj, 'game', 'cenas', 'p01.rpy'), 'label p01:' + String.fromCharCode(10) + '    # DIREÇÃO: tela preta.' + String.fromCharCode(10) + '    # SOM: passos.' + String.fromCharCode(10) + '    amalia "Onde estou?"' + String.fromCharCode(10) + '    return' + String.fromCharCode(10));
  const chk = path.join(RAIZ, 'skills', 'renpy-codigo', 'scripts', 'checar_assets.py');
  let saida = '', codigo = 0;
  try { saida = execFileSync('python', ['-X', 'utf8', '-I', chk, proj], { encoding: 'utf8' }); } catch (e) { codigo = e.status; saida = String(e.stdout); }
  assert.equal(codigo, 1, 'com problema, o verificador sai com 1');
  assert(/falta\.png/.test(saida) && /PROV_icone/.test(saida) && /teste_x\.rpy/.test(saida), 'acusa arquivo que falta, provisório e teste no build');
  assert(saida.includes('p01.rpy') && saida.includes('não encenada'), 'acusa cena com direção só em comentário');
  assert(!/existe\.png/.test(saida), 'não acusa arquivo que existe');
}
process.exit(0);
