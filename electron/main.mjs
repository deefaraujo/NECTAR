// Processo principal do aplicativo NECTAR.
// Liga o servidor local numa porta livre, abre a janela nele e desliga tudo ao fechar.
import { app, BrowserWindow, desktopCapturer, dialog, ipcMain, Menu, Tray, powerSaveBlocker, safeStorage, session, shell } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import { globalShortcut, screen } from 'electron';
import { validarAcao } from '../lib/entrevista-acoes.mjs';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const RAIZ_APP = path.resolve(AQUI, '..');
const EMPACOTADO = app.isPackaged;
const MARCA = (() => { try { const m = JSON.parse(fs.readFileSync(path.join(RAIZ_APP, 'marca.json'), 'utf8')); return m.sufixo ? `${m.nome}${m.nome.endsWith('.') ? '' : ' '}${m.sufixo}` : m.nome; } catch { return 'nectar'; } })();

let janela = null;
let servidor = null;
let origem = '';
let bandeja=null,encerrando=false;
const manterEmSegundoPlano=()=>{try{const c=JSON.parse(fs.readFileSync(path.join(app.getPath('userData'),'data','settings.json'),'utf8'));return c.ciclo?.segundoPlano===true&&(c.ciclo?.assessorAuto===true||c.piloto?.ativo===true);}catch{return false;}};
function mostrarJanela(){janela?.show();if(janela?.isMinimized())janela.restore();janela?.focus();}
function criarBandeja(){if(bandeja)return;bandeja=new Tray(path.join(RAIZ_APP,'build','icon.ico'));bandeja.setToolTip('NECTAR em segundo plano');bandeja.setContextMenu(Menu.buildFromTemplate([{label:'Abrir NECTAR',click:mostrarJanela},{label:'Encerrar NECTAR e parar execuções',click:()=>{encerrando=true;app.quit();}}]));bandeja.on('double-click',mostrarJanela);}

// Os dados do app ficam na mesma pasta de antes da troca de nome (%APPDATA%/Game Studio AI), para nada se perder.
app.setPath('userData', process.env.STUDIO_USERDATA || path.join(app.getPath('appData'), 'Game Studio AI'));

// Uma instância só: abrir de novo traz a janela que já existe.
if (!app.requestSingleInstanceLock()) { app.quit(); }
app.on('second-instance', mostrarJanela);

/* ------------------------------------------------------------ dados e projetos */
// A versão anterior do app (Estúdio NÃO PERDI!) guardava tudo em %APPDATA%\estudio-nao-perdi.
// Na primeira abertura do NECTAR esses dados viram o primeiro projeto, para nada se perder.
function projetoLegado() {
  const base = path.join(app.getPath('appData'), 'estudio-nao-perdi');
  try {
    const raiz = JSON.parse(fs.readFileSync(path.join(base, 'estudio.json'), 'utf8')).raiz;
    if (raiz && fs.statSync(raiz).isDirectory()) return { nome: path.basename(raiz), caminho: raiz, legados: [path.join(base, 'data')] };
  } catch { /* sem dados antigos */ }
  return null;
}

ipcMain.handle('studio:escolher-pasta', async () => {
  const r = await dialog.showOpenDialog(janela, { title: 'Escolha a pasta do projeto', properties: ['openDirectory'] });
  return r.canceled || !r.filePaths[0] ? null : r.filePaths[0];
});
// Com o piloto automático ligado, o Windows não pode suspender o app (a tela pode apagar, o trabalho continua).
let bloqueioSono = null;
ipcMain.handle('studio:manter-acordado', (_e, ligar) => {
  if (ligar && bloqueioSono === null) bloqueioSono = powerSaveBlocker.start('prevent-app-suspension');
  if (!ligar && bloqueioSono !== null) { powerSaveBlocker.stop(bloqueioSono); bloqueioSono = null; }
  return bloqueioSono !== null;
});
// Voltar a um ponto de salvamento exige reabrir o app: a restauração é aplicada antes de o projeto carregar.
ipcMain.handle('studio:reiniciar', () => {
  app.relaunch({ execPath: process.env.PORTABLE_EXECUTABLE_FILE || process.execPath });
  setTimeout(() => app.quit(), 400);
  return true;
});
ipcMain.handle('studio:abrir-pasta', async (_e, dir) => {
  if (typeof dir !== 'string' || !fs.existsSync(dir)) return false;
  return (await shell.openPath(dir)) === '';
});
// Compartilhar tela na chamada: a página lista telas e janelas (com miniatura), a pessoa escolhe, e o pedido de getDisplayMedia
// que vem em seguida recebe essa fonte. No Windows o Chromium não tem seletor próprio, por isso o seletor é nosso.
let fonteTelaEscolhida = null;
let entrevistaTela=null, entrevistaProc=null, entrevistaInicio=0, entrevistaCps=12;
// O pacote de teste não disputa a parada de emergência da instância usada pela pessoa.
const ATALHO_ENTREVISTA=process.env.STUDIO_FAKE==='1'?'CommandOrControl+Alt+Shift+F12':'CommandOrControl+Shift+F12';
function pararEntrevista(motivo='Controle interrompido',notificar=true){
  const estavaAtivo=!!entrevistaTela;
  entrevistaTela=null;entrevistaInicio=0;
  entrevistaProc?.kill(); entrevistaProc=null;
  if(notificar&&estavaAtivo&&!janela?.isDestroyed())janela?.webContents.send('entrevista:parada',motivo);
}
ipcMain.handle('entrevista:armar', async(e,id,opcoes={})=>{
  if(!e.senderFrame.url.startsWith(origem+'/entrevista.html')) throw new Error('Página inválida');
  pararEntrevista('Preparando nova execução',false);
  const cps=opcoes.caracteresPorSegundo??12;
  if(!Number.isInteger(cps)||cps<5||cps>25)throw new Error('Velocidade de digitação inválida: use de 5 a 25 caracteres por segundo');
  entrevistaCps=cps;
  if(process.platform!=='win32') throw new Error('Controle experimental disponível no Windows');
  if(!globalShortcut.isRegistered(ATALHO_ENTREVISTA)) throw new Error('Atalho de parada indisponível. Libere Ctrl+Shift+F12 antes de iniciar.');
  const fontes=await desktopCapturer.getSources({types:['screen'],thumbnailSize:{width:0,height:0}});
  const fonte=fontes.find(f=>f.id===id);
  const display=screen.getAllDisplays().find(d=>String(d.id)===fonte?.display_id);
  if(!display) throw new Error('Selecione uma tela inteira');
  entrevistaTela=display;
  entrevistaInicio=Date.now()+5000;
  return {inicioEm:entrevistaInicio};
});
ipcMain.handle('entrevista:parar',(_e,motivo)=>{pararEntrevista(typeof motivo==='string'?motivo:'Controle interrompido');return true;});
ipcMain.handle('entrevista:acao',async(e,a)=>{
  if(!e.senderFrame.url.startsWith(origem+'/entrevista.html')||!entrevistaTela) throw new Error('Controle parado');
  if(!entrevistaInicio||Date.now()<entrevistaInicio)throw new Error('Aguarde a contagem de cinco segundos');
  validarAcao(a);
  if(!['clicar','digitar','codigo','tecla','rolar'].includes(a.tipo)) return true;
  if(entrevistaProc) throw new Error('Entrada em andamento');
  const d=entrevistaTela,b=screen.dipToScreenRect(null,d.bounds);
  const payload={...a,caracteresPorSegundo:entrevistaCps,px:b.x+Math.round((b.width-1)*(a.x||0)),py:b.y+Math.round((b.height-1)*(a.y||0))};
  await new Promise((resolve,reject)=>{
    const script=path.join(AQUI,'entrevista-input.ps1').replace(/app\.asar([\\/])/,'app.asar.unpacked$1');
    const p=spawn('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',script],{windowsHide:true,stdio:['pipe','ignore','pipe']});
    entrevistaProc=p;let err='';p.stderr.on('data',d=>err+=d);
    p.on('error',reject);p.on('close',code=>{if(entrevistaProc===p)entrevistaProc=null;code===0?resolve():reject(new Error(err||'Entrada interrompida'));});
    p.stdin.on('error',()=>{});p.stdin.end(JSON.stringify(payload));
  });return true;
});
ipcMain.handle('studio:fontes-tela', async () => {
  const fontes = await desktopCapturer.getSources({ types: ['screen', 'window'], thumbnailSize: { width: 320, height: 200 }, fetchWindowIcons: false });
  return fontes.filter((f) => f.name !== MARCA).map((f) => ({ id: f.id, nome: f.name, tipo: f.id.startsWith('screen') ? 'tela' : 'janela', miniatura: f.thumbnail.toDataURL() }));
});
ipcMain.handle('studio:escolher-tela', (_e, id) => { fonteTelaEscolhida = typeof id === 'string' ? id : null; return true; });
async function entregarTela(_pedido, responder) {
  const fontes = await desktopCapturer.getSources({ types: ['screen', 'window'] });
  const f = fontes.find((x) => x.id === fonteTelaEscolhida) || fontes.find((x) => x.id.startsWith('screen'));
  fonteTelaEscolhida = null;
  responder(f ? { video: f } : {});
}

/* ------------------------------------------------------------ janela */
async function criarJanela() {
  // O servidor lê esta variável ao carregar, então ela vem antes do import.
  process.env.STUDIO_DATA = path.join(app.getPath('userData'), 'data');
  // A pasta de cada projeto (memória, quadro, conversas) fica dentro da pasta do programa, em Documentos.
  process.env.STUDIO_PROJETOS ??= path.join(app.getPath('documents'), 'Game Studio AI', 'projetos');
  // O token do Jira é cifrado pelo Windows (conta do usuário); o servidor pede o cofre por aqui.
  globalThis.studioCofre = {
    disponivel: () => safeStorage.isEncryptionAvailable(),
    cifrar: (t) => safeStorage.encryptString(t).toString('base64'),
    decifrar: (b) => safeStorage.decryptString(Buffer.from(b, 'base64')),
  };
  const { iniciarServidor } = await import(pathToFileURL(path.join(RAIZ_APP, 'server.mjs')).href);
  servidor = await iniciarServidor({ porta: 0, projetoPadrao: projetoLegado() });
  origem = `http://127.0.0.1:${servidor.porta}`;

  janela = new BrowserWindow({
    width: 1480, height: 920, minWidth: 1020, minHeight: 640,
    show: false,
    backgroundColor: '#090B10',
    title: MARCA,
    icon: path.join(RAIZ_APP, 'build', 'icon.png'),
    // Barra de título própria: o app desenha a faixa; o Windows põe só os botões por cima.
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#06080C', symbolColor: '#A3ACBE', height: 36 },
    webPreferences: {
      preload: path.join(AQUI, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      backgroundThrottling: false,
    },
  });

  janela.once('ready-to-show', () => janela.show());
  janela.on('close',e=>{if(!encerrando&&manterEmSegundoPlano()){e.preventDefault();criarBandeja();janela.hide();}});
  janela.on('closed', () => { janela = null; });

  // A janela só navega dentro do próprio app. Link externo abre no navegador.
  janela.webContents.setWindowOpenHandler(({ url }) => {
    // arquivo do próprio app (anexo, relatório, entrega): baixa direto, sem abrir navegador
    if (url.startsWith(origem) && /\/(anexo|relatorio|teamwork\/artifacts)\b/.test(url)) { janela.webContents.downloadURL(url); return { action: 'deny' }; }
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  janela.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith(origem)) { e.preventDefault(); if (/^https?:\/\//.test(url)) shell.openExternal(url); }
  });

  // Atalhos de desenvolvedor só fora do pacote.
  if (!EMPACOTADO) {
    janela.webContents.on('before-input-event', (e, i) => {
      if (i.type !== 'keyDown') return;
      if (i.key === 'F12' || (i.control && i.shift && i.key.toLowerCase() === 'i')) janela.webContents.toggleDevTools();
      if (i.control && i.key.toLowerCase() === 'r') janela.webContents.reload();
    });
  }
  if (process.env.STUDIO_DEPURAR) janela.webContents.openDevTools({ mode: 'detach' });

  await janela.loadURL(origem);
}

app.whenReady().then(async () => {
  globalShortcut.register(ATALHO_ENTREVISTA,()=>pararEntrevista('Interrompido pelo atalho Ctrl+Shift+F12'));
  Menu.setApplicationMenu(null);
  // O app não precisa de câmera, microfone, localização etc. Só copiar texto e mostrar aviso quando um agente pede a Game Director.
  // microfone ("media"): só a chamada de voz pede, e só enquanto ela está aberta
  session.defaultSession.setPermissionRequestHandler((_wc, permissao, ok) => ok(['clipboard-sanitized-write', 'notifications', 'media', 'audioCapture', 'display-capture'].includes(permissao)));
  session.defaultSession.setDisplayMediaRequestHandler(entregarTela);
  // Download de anexo/relatório: vai direto para Downloads (sem diálogo, sem sobrescrever) e abre quando termina
  session.defaultSession.on('will-download', (_e, item) => {
    const pasta = app.getPath('downloads');
    const ext = path.extname(item.getFilename()); const base = path.basename(item.getFilename(), ext);
    let destino = path.join(pasta, item.getFilename());
    for (let n = 2; fs.existsSync(destino); n++) destino = path.join(pasta, `${base} (${n})${ext}`);
    item.setSavePath(destino);
    item.once('done', (_ev, estado) => { if (estado === 'completed') shell.openPath(destino); });
  });
  await criarJanela();
});

app.on('window-all-closed', () => app.quit());
// Fechar o app não pode deixar agente rodando solto: o servidor cancela tudo antes de desligar.
app.on('before-quit', () => {pararEntrevista();encerrando=true;bandeja?.destroy();bandeja=null;try { servidor?.encerrar(); } catch { /* já encerrado */ } });
