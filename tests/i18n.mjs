// UI languages: every dictionary covers the whole catalog with the same variables, and every key used in code is in the catalog.
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
  assert(d, `${id}: dictionary loads`);
  const faltam = catalogo.filter((k) => !(k in d));
  assert.equal(faltam.length, 0, `${id}: missing ${faltam.slice(0, 5).join(' | ')}`);
  const varErrada = catalogo.filter((k) => vars(k) !== vars(d[k]));
  assert.equal(varErrada.length, 0, `${id}: different variables in ${varErrada.slice(0, 5).join(' | ')}`);
  const tagErrada = catalogo.filter((k) => /</.test(k) && tags(k) !== tags(d[k]));
  assert.equal(tagErrada.length, 0, `${id}: different HTML in ${tagErrada.slice(0, 5).join(' | ')}`);
}

// Literal keys used in code (I18N.t('...')) must be in the catalog.
const usadas = new Set();
for (const f of fs.readdirSync(PUB).filter((x) => x.endsWith('.js') && x !== 'i18n.js')) {
  const src = fs.readFileSync(path.join(PUB, f), 'utf8');
  for (const m of src.matchAll(/I18N\.t\(\s*'((?:\\.|[^'\\])*)'/g)) usadas.add(m[1].replace(/\\'/g, "'"));
}
const fora = [...usadas].filter((k) => !catalogo.includes(k));
assert.equal(fora.length, 0, `keys used outside the catalog: ${fora.slice(0, 5).join(' | ')}`);

console.log(`PASS: languages (${IDIOMAS.length + 1} languages, ${catalogo.length} strings each, variables and HTML checked, ${usadas.size} code keys in the catalog).`);
