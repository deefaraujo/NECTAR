// Minimal bridge between the page and the main process. The page gets only what is exposed here.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('studioApp', {
  entrevistaArmar: (id, opcoes) => ipcRenderer.invoke('entrevista:armar', id, opcoes),
  entrevistaAcao: (a) => ipcRenderer.invoke('entrevista:acao', a),
  entrevistaParar: (motivo) => ipcRenderer.invoke('entrevista:parar', motivo),
  aoPararEntrevista: (callback) => {
    const ouvir = (_e, motivo) => callback(motivo);
    ipcRenderer.on('entrevista:parada', ouvir);
    return () => ipcRenderer.removeListener('entrevista:parada', ouvir);
  },
  escolherPasta: () => ipcRenderer.invoke('studio:escolher-pasta'),
  abrirPasta: (dir) => ipcRenderer.invoke('studio:abrir-pasta', dir),
  reiniciar: () => ipcRenderer.invoke('studio:reiniciar'),
  manterAcordado:(ligar) => ipcRenderer.invoke('studio:manter-acordado', !!ligar),
  fontesTela: () => ipcRenderer.invoke('studio:fontes-tela'),
  escolherTela: (id) => ipcRenderer.invoke('studio:escolher-tela', id),
});
