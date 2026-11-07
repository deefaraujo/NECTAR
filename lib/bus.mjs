// Event bus: everything that changes (board, message, presence) goes through here
// and the server forwards it to the browser over SSE.
import { EventEmitter } from 'node:events';

export const eventos = new EventEmitter();
eventos.setMaxListeners(50);

export function emitir(evento) {
  eventos.emit('evento', evento);
}
