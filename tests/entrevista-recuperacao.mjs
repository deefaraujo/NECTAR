import assert from 'node:assert/strict';
import { erroVisualRecuperavel } from '../lib/entrevista-erros.mjs';
for(const e of ['Unexpected token x in JSON','O modelo não informou a etapa e o resultado observável do desafio','Conclusão sem evidência de submissão aceita','Linguagem do editor não confirmada','Linguagem selecionada incompatível com as opções observadas','Linguagens disponíveis inválidas','O motor visual excedeu 90 segundos','fetch failed','HTTP 503','Quota exceeded'])assert.equal(erroVisualRecuperavel(e),true,e);
for(const e of ['Análise visual cancelada','Faça login','CAPTCHA necessário','Nenhum dos modelos selecionados está disponível','Quadro inválido','Informe um currículo','Windows recusou a entrada'])assert.equal(erroVisualRecuperavel(e),false,e);
console.log('Recuperação: falhas de inferência/formato são recuperáveis; parada, login, CAPTCHA e entradas nativas não são repetidos.');
