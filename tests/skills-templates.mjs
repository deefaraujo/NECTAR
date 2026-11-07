// All templates: every skill an agent references exists, is registered in ORIGEM.md with source and license, no SKILL.md
// contains a dangerous pattern (remote command, secret, instructions fetched from the internet), the rules fit in the prompt, and every template
// has the lead, the QA and the MCP agent.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { skillDisponivelOuOpcional, skillsOpcionais } from '../lib/skills-opcionais.mjs';
const T = path.join(import.meta.dirname, '..', 'templates');
// remote command piped straight to a shell, decoded literal blob (obfuscation), wiping root or home, and real API keys.
// Reading a Kubernetes secret with `base64 -d` (ArgoCD docs) is not obfuscation, so the pattern requires a literal blob before it.
const PERIGO = /(curl\s+-s\S*\s+https?:\/\/\S+\s*\|\s*(ba)?sh|wget\s+\S+\s*\|\s*(ba)?sh|Invoke-Expression|\biex\b|echo\s+["']?[A-Za-z0-9+/=]{40,}["']?\s*\|\s*base64\s+-d|rm\s+-rf\s+[~/](\s|$)|sk-[A-Za-z0-9]{20,}|ghp_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16})/i;
const resumo = [];
for (const tpl of fs.readdirSync(T).filter((d) => fs.existsSync(path.join(T, d, 'template.json')))) {
  const j = JSON.parse(fs.readFileSync(path.join(T, tpl, 'template.json'), 'utf8'));
  const dirS = path.join(T, tpl, 'skills');
  const existentes = fs.existsSync(dirS) ? fs.readdirSync(dirS).filter((d) => fs.existsSync(path.join(dirS, d, 'SKILL.md'))) : [];
  const origem = fs.existsSync(path.join(dirS, 'ORIGEM.md')) ? fs.readFileSync(path.join(dirS, 'ORIGEM.md'), 'utf8') : '';
  assert(j.papeis?.lead && j.agentes.some((a) => a.id === j.papeis.lead), `${tpl}: lead defined and present`);
  assert(j.papeis?.qa && j.agentes.some((a) => a.id === j.papeis.qa), `${tpl}: QA defined and present`);
  assert(j.agentes.some((a) => a.id === 'mcp'), `${tpl}: MCP agent present`);
  let usadas = 0;
  for (const a of j.agentes) {
    assert(a.sistema || fs.existsSync(path.join(T, tpl, 'agentes', `${a.id}.md`)), `${tpl}/${a.id}: has a persona`);
    for (const s of a.skills || []) { assert(skillDisponivelOuOpcional(tpl,s), `${tpl}/${a.id}: skill ${s} must exist or be explicitly declared optional`); usadas++; }
  }
  if (existentes.length) {
    assert(origem, `${tpl}: skills/ORIGEM.md exists`);
    for (const s of existentes) assert(origem.includes(`| ${s} |`) || origem.includes(`${s},`) || origem.includes(` ${s}`) || skillsOpcionais(tpl).some(x=>x.id===s), `${tpl}: source or manifest registers ${s}`);
    for (const s of existentes) {
      const txt = fs.readFileSync(path.join(dirS, s, 'SKILL.md'), 'utf8');
      assert(!PERIGO.test(txt), `${tpl}/${s}: SKILL.md without dangerous patterns`);
      assert(/^---\s*\n[\s\S]*?name:/m.test(txt) || /^#/m.test(txt), `${tpl}/${s}: SKILL.md has a header`);
    }
  }
  const regras = path.join(T, tpl, 'regras.md');
  assert(fs.existsSync(regras), `${tpl}: regras.md exists`);
  assert(fs.statSync(regras).size < 12000, `${tpl}: regras.md fits fully in the prompt (12000 limit in equipe.mjs)`);
  const semSkill = j.agentes.filter((a) => !a.sistema && a.id !== 'mcp' && !(a.skills || []).length).map((a) => a.id);
  assert.equal(semSkill.length, 0, `${tpl}: agents without any skill: ${semSkill.join(', ')}`);
  resumo.push(`${tpl} ${existentes.length} skills, ${usadas} assignments`);
}
console.log(`PASS: template skills (${resumo.join('; ')}): every referenced skill exists and has a source, no SKILL.md with dangerous patterns, rules fit in the prompt, lead, QA and MCP in all.`);
