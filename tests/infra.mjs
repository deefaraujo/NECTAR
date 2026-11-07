import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { criarElenco } from '../lib/agentes.mjs';

const e = criarElenco('software');
assert(e.IDS.has('infra'), 'especialista Infra existe no elenco');
assert(e.IDS.has('pipeline'), 'especialista Pipeline existente foi preservado');
assert.equal(e.contrato.especialistaDe('porta ocupada e rede local', e.IDS)?.agente, 'infra');
assert.equal(e.contrato.especialistaDe('pipeline de deploy', e.IDS)?.agente, 'pipeline');
const template = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, '../templates/software/template.json'), 'utf8'));
assert.equal(template.aliases.infra, 'infra');
assert.equal(template.aliases.devops, 'infra');
assert.equal(template.aliases.deploy, 'pipeline');
const persona = fs.readFileSync(path.join(import.meta.dirname, '../templates/software/agentes/infra.md'), 'utf8');
assert.match(persona, /nao encerre processo desconhecido/i);
assert.match(persona, /validacao funcional/i);
console.log('PASS: Infra e DevOps no template, roteamento e preservação de Pipeline.');
