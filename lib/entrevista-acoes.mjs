// Contrato puro compartilhado com Electron; não carrega configuração do servidor.
export function validarAcao(a) {
  if (!a || !['clicar','digitar','codigo','tecla','rolar','aguardar','concluir','interromper'].includes(a.tipo)) throw new Error('Ação visual inválida');
  if (a.tipo === 'clicar' && ![a.x,a.y].every(n=>Number.isFinite(n)&&n>=0&&n<=1)) throw new Error('Coordenadas inválidas');
  if (a.tipo === 'digitar' && (typeof a.texto !== 'string' || a.texto.length>4000)) throw new Error('Texto inválido');
  if (a.tipo === 'codigo' && (typeof a.texto !== 'string' || !a.texto.trim() || a.texto.length>24000)) throw new Error('Código inválido');
  if (a.tipo === 'tecla' && !['TAB','ENTER','BACKSPACE','SPACE','UP','DOWN','LEFT','RIGHT','ESC','HOME','END','DELETE','CTRL+A','CTRL+HOME','CTRL+END','CTRL+Z','SHIFT+HOME','SHIFT+END','SHIFT+UP','SHIFT+DOWN','SHIFT+LEFT','SHIFT+RIGHT'].includes(a.tecla)) throw new Error('Tecla inválida');
  if (a.tipo === 'rolar' && ![-3,-2,-1,1,2,3].includes(a.passos)) throw new Error('Rolagem inválida');
  return a;
}
