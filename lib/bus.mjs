// Barramento de eventos: tudo que muda (quadro, mensagem, presença) passa por aqui
// e o servidor repassa ao navegador por SSE.
import { EventEmitter } from 'node:events';

export const eventos = new EventEmitter();
eventos.setMaxListeners(50);

export function emitir(evento) {
  eventos.emit('evento', evento);
}
