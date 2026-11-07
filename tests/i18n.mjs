// Idiomas da interface: todo dicionário cobre o catálogo inteiro, com as mesmas variáveis, e toda chave usada no código está no catálogo.
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const PUB = path.join(import.meta.dirname, '..', 'public');
const catalogo = JSON.parse(fs.readFileSync(path.join(PUB, 'i18n', 'catalogo.json'), 'utf8'));
const IDIOMAS = ['en', 'es', 'fr', 'zh-CN', 'ja', 'ko', 'ru'];
const vars = (s) => (String(s).match(/\{\w+\}/g) || []).sort().join();
const tags = (s) => (String(s).match(/<\/?[a-z][^>]*>/gi) || []).map((x) => x.replace(/\s.*$/, '').toLowerCase()).sort().join();

for (const id of IDIOMAS) {
  const ctx = { window: {} };
  vm.runInNewContext(fs.readFileSync(path.join(PUB, 'i18n', `${id}.js`), 'utf8'), ctx);
  const d = ctx.window.I18N_DICT[id];
  assert(d, `${id}: dicionário carrega`);
  const faltam = catalogo.filter((k) => !(k in d));
  assert.equal(faltam.length, 0, `${id}: faltam ${faltam.slice(0, 5).join(' | ')}`);
  const varErrada = catalogo.filter((k) => vars(k) !== vars(d[k]));
  assert.equal(varErrada.length, 0, `${id}: variáveis diferentes em ${varErrada.slice(0, 5).join(' | ')}`);
  const tagErrada = catalogo.filter((k) => /</.test(k) && tags(k) !== tags(d[k]));
  assert.equal(tagErrada.length, 0, `${id}: HTML diferente em ${tagErrada.slice(0, 5).join(' | ')}`);
}

// Chaves literais usadas no código (I18N.t('...')) precisam estar no catálogo.
const usadas = new Set();
for (const f of fs.readdirSync(PUB).filter((x) => x.endsWith('.js') && x !== 'i18n.js')) {
  const src = fs.readFileSync(path.join(PUB, f), 'utf8');
  for (const m of src.matchAll(/I18N\.t\(\s*'((?:\\.|[^'\\])*)'/g)) usadas.add(m[1].replace(/\\'/g, "'"));
}
const fora = [...usadas].filter((k) => !catalogo.includes(k));
assert.equal(fora.length, 0, `chaves usadas fora do catálogo: ${fora.slice(0, 5).join(' | ')}`);

console.log(`PASS: idiomas (${IDIOMAS.length + 1} idiomas, ${catalogo.length} textos cada, variáveis e HTML conferidos, ${usadas.size} chaves do código no catálogo).`);
