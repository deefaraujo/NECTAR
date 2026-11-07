// Gancho do electron-builder (afterPack): devolve ao pacote o electron.exe ORIGINAL, só renomeado.
// Por quê: o electron-builder edita o executável (ícone, versão, selo do asar) e isso muda o hash do arquivo. Antivírus
// corporativos classificam o app pelo hash/assinatura: o electron.exe de fábrica é
// conhecido e cai no grupo "Confiável"; o editado vira desconhecido e perde o direito de ouvir o microfone (a chamada de
// voz falhava com "Could not start audio source" só no app empacotado). Sem certificado de assinatura de código, o jeito
// de manter o app confiável é não mexer no binário. O ícone da janela continua vindo de build/icon.png (BrowserWindow).
const fs = require('node:fs');
const path = require('node:path');

module.exports = async function (ctx) {
  if (ctx.electronPlatformName !== 'win32') return;
  const nome = `${ctx.packager.appInfo.productFilename}.exe`;
  const destino = path.join(ctx.appOutDir, nome);
  const original = path.join(ctx.packager.info.projectDir, 'node_modules', 'electron', 'dist', 'electron.exe');
  fs.copyFileSync(original, destino);
  console.log(`  • exe intacto: ${nome} = electron.exe original (${fs.statSync(destino).size} bytes)`);
};
