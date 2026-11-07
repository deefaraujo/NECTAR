// Keeps tokens and passwords out of plain text. In the app (Electron), Windows encrypts the secret with the user's
// account (safeStorage). Running in the browser only (without Electron) there is no vault: the token is stored as text on disk
// in the project folder, and the screen warns about it.
// Electron registers the vault in globalThis.studioCofre before importing the server.

export const temCofre = () => !!globalThis.studioCofre?.disponivel?.();

export function proteger(texto) {
  const t = String(texto || '');
  if (!t) return '';
  if (temCofre()) { try { return `cofre:${globalThis.studioCofre.cifrar(t)}`; } catch { /* fall back to plain text */ } }
  return `texto:${Buffer.from(t, 'utf8').toString('base64')}`;
}

export function revelar(guardado) {
  const g = String(guardado || '');
  if (!g) return '';
  try {
    if (g.startsWith('cofre:')) return globalThis.studioCofre.decifrar(g.slice(6));
    if (g.startsWith('texto:')) return Buffer.from(g.slice(6), 'base64').toString('utf8');
  } catch { /* unreadable secret: the user enters it again */ }
  return '';
}
