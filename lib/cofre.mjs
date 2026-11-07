// Guarda tokens e senhas fora do texto puro. No app (Electron), o Windows cifra o segredo com a conta do
// usuário (safeStorage). Rodando só no navegador (sem Electron) não há cofre: o token fica em texto no disco
// da pasta do projeto, e a tela avisa disso.
// O Electron registra o cofre em globalThis.studioCofre antes de importar o servidor.

export const temCofre = () => !!globalThis.studioCofre?.disponivel?.();

export function proteger(texto) {
  const t = String(texto || '');
  if (!t) return '';
  if (temCofre()) { try { return `cofre:${globalThis.studioCofre.cifrar(t)}`; } catch { /* cai para o texto */ } }
  return `texto:${Buffer.from(t, 'utf8').toString('base64')}`;
}

export function revelar(guardado) {
  const g = String(guardado || '');
  if (!g) return '';
  try {
    if (g.startsWith('cofre:')) return globalThis.studioCofre.decifrar(g.slice(6));
    if (g.startsWith('texto:')) return Buffer.from(g.slice(6), 'base64').toString('utf8');
  } catch { /* segredo ilegível: o usuário informa de novo */ }
  return '';
}
