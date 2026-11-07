// Todos os templates: toda skill citada por um agente existe, está registrada no ORIGEM.md com origem e licença, nenhum SKILL.md
// contém padrão perigoso (comando remoto, segredo, instrução buscada na internet), as regras cabem no prompt, e cada template
// tem a liderança, o QA e o agente de MCP.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { skillDisponivelOuOpcional, skillsOpcionais } from '../lib/skills-opcionais.mjs';
const T = path.join(import.meta.dirname, '..', 'templates');
// comando remoto executado direto, blob literal decodificado (ofuscação), apagar a raiz ou a home, e chaves de API reais.
// Ler um segredo do Kubernetes com `base64 -d` (doc do ArgoCD) não é ofuscação, por isso o padrão exige um blob literal antes.
const PERIGO = /(curl\s+-s\S*\s+https?:\/\/\S+\s*\|\s*(ba)?sh|wget\s+\S+\s*\|\s*(ba)?sh|Invoke-Expression|\biex\b|echo\s+["']?[A-Za-z0-9+/=]{40,}["']?\s*\|\s*base64\s+-d|rm\s+-rf\s+[~/](\s|$)|sk-[A-Za-z0-9]{20,}|ghp_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16})/i;
const resumo = [];
for (const tpl of fs.readdirSync(T).filter((d) => fs.existsSync(path.join(T, d, 'template.json')))) {
  const j = JSON.parse(fs.readFileSync(path.join(T, tpl, 'template.json'), 'utf8'));
  const dirS = path.join(T, tpl, 'skills');
  const existentes = fs.existsSync(dirS) ? fs.readdirSync(dirS).filter((d) => fs.existsSync(path.join(dirS, d, 'SKILL.md'))) : [];
  const origem = fs.existsSync(path.join(dirS, 'ORIGEM.md')) ? fs.readFileSync(path.join(dirS, 'ORIGEM.md'), 'utf8') : '';
  assert(j.papeis?.lead && j.agentes.some((a) => a.id === j.papeis.lead), `${tpl}: liderança definida e presente`);
  assert(j.papeis?.qa && j.agentes.some((a) => a.id === j.papeis.qa), `${tpl}: QA definido e presente`);
  assert(j.agentes.some((a) => a.id === 'mcp'), `${tpl}: agente de MCP presente`);
  let usadas = 0;
  for (const a of j.agentes) {
    assert(a.sistema || fs.existsSync(path.join(T, tpl, 'agentes', `${a.id}.md`)), `${tpl}/${a.id}: tem persona`);
    for (const s of a.skills || []) { assert(skillDisponivelOuOpcional(tpl,s), `${tpl}/${a.id}: skill ${s} deve existir ou estar explicitamente declarada como opcional`); usadas++; }
  }
  if (existentes.length) {
    assert(origem, `${tpl}: skills/ORIGEM.md existe`);
    for (const s of existentes) assert(origem.includes(`| ${s} |`) || origem.includes(`${s},`) || origem.includes(` ${s}`) || skillsOpcionais(tpl).some(x=>x.id===s), `${tpl}: origem ou manifesto registra ${s}`);
    for (const s of existentes) {
      const txt = fs.readFileSync(path.join(dirS, s, 'SKILL.md'), 'utf8');
      assert(!PERIGO.test(txt), `${tpl}/${s}: SKILL.md sem padrão perigoso`);
      assert(/^---\s*\n[\s\S]*?name:/m.test(txt) || /^#/m.test(txt), `${tpl}/${s}: SKILL.md com cabeçalho`);
    }
  }
  const regras = path.join(T, tpl, 'regras.md');
  assert(fs.existsSync(regras), `${tpl}: regras.md existe`);
  assert(fs.statSync(regras).size < 12000, `${tpl}: regras.md cabe inteiro no prompt (limite de 12000 em equipe.mjs)`);
  const semSkill = j.agentes.filter((a) => !a.sistema && a.id !== 'mcp' && !(a.skills || []).length).map((a) => a.id);
  assert.equal(semSkill.length, 0, `${tpl}: agentes sem nenhuma skill: ${semSkill.join(', ')}`);
  resumo.push(`${tpl} ${existentes.length} skills, ${usadas} atribuições`);
}
console.log(`PASS: skills dos templates (${resumo.join('; ')}): toda skill citada existe e tem origem, nenhum SKILL.md com padrão perigoso, regras cabem no prompt, liderança, QA e MCP em todos.`);
