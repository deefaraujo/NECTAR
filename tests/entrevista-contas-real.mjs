// Opt-in: makes real calls using a synthetic image, without capturing the screen.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { statusEntrevista, executarVisaoCli } from '../lib/entrevista-motores.mjs';
import { localizarClaude, localizarCodex } from '../lib/runner.mjs';
assert.equal(process.env.NECTAR_TESTE_VISAO_REAL,'1','Set NECTAR_TESTE_VISAO_REAL=1 to authorize real calls');
console.log(JSON.stringify(await statusEntrevista()));
const quadro='data:image/jpeg;base64,'+fs.readFileSync(new URL('./fixtures/entrevista-visao-sintetica.jpg',import.meta.url)).toString('base64');
let falhas=0;
for(const [engine,modelo,localizar] of [['claude','claude-opus-5-5',localizarClaude],['codex','gpt-6.1-sol',localizarCodex]]){
  try{
    const texto=await executarVisaoCli({engine,modelo,bin:await localizar(),quadro,prompt:'Leia a imagem e devolva apenas JSON com a palavra escrita dentro do quadro azul: {"palavra":"..."}. Não use ferramentas.'});
    assert.match(texto,/NECTAR/);
    console.log(JSON.stringify({modelo,texto}));
  }catch(e){falhas++;console.log(JSON.stringify({modelo,erro:e.message}));}
}
if(falhas)process.exitCode=1;
