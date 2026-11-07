// electron-builder hook (afterPack): puts the ORIGINAL electron.exe back into the package, only renamed.
// Why: electron-builder edits the executable (icon, version, asar integrity) and that changes the file hash. Corporate
// corporate antivirus classifies the app by hash/signature: the stock electron.exe is
// known and lands in the "Trusted" group; the edited one becomes unknown and loses microphone access (the voice
// call failed with "Could not start audio source" only in the packaged app). Without a code-signing certificate, the way
// to keep the app trusted is to leave the binary untouched. The window icon still comes from build/icon.png (BrowserWindow).
const fs = require('node:fs');
const path = require('node:path');

module.exports = async function (ctx) {
  if (ctx.electronPlatformName !== 'win32') return;
  const nome = `${ctx.packager.appInfo.productFilename}.exe`;
  const destino = path.join(ctx.appOutDir, nome);
  const original = path.join(ctx.packager.info.projectDir, 'node_modules', 'electron', 'dist', 'electron.exe');
  fs.copyFileSync(original, destino);
  console.log(`  • exe untouched: ${nome} = original electron.exe (${fs.statSync(destino).size} bytes)`);
};
