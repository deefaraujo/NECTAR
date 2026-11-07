import fs from 'node:fs';
import path from 'node:path';

const raiz=path.resolve(import.meta.dirname,'..','templates');
export function skillsOpcionais(template){
  if(!/^[a-z0-9-]+$/.test(template))throw new Error('Identificador de template inválido');
  const arquivo=path.join(raiz,template,'skills-opcionais.json');
  if(!fs.existsSync(arquivo))return [];
  const dados=JSON.parse(fs.readFileSync(arquivo,'utf8'));
  if(dados.schema!=='nectar.skills-opcionais.v1'||!Array.isArray(dados.skills))throw new Error('Manifesto de skills opcionais inválido');
  return dados.skills;
}
export function skillDisponivelOuOpcional(template,skill){
  if(!/^[a-z0-9-]+$/.test(template)||!/^[a-z0-9-]+$/.test(skill))return false;
  return fs.existsSync(path.join(raiz,template,'skills',skill,'SKILL.md'))||skillsOpcionais(template).some(s=>s.id===skill);
}
