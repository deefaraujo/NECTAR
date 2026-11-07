// Política efetiva do executor, separada de persona e texto de agentes.
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { DIR } from './store.mjs';

export const caminhosProtegidos=()=>[...['.ssh','.aws','.azure','.npmrc','.git-credentials','.codex/auth.json','.claude/.credentials.json'].map(p=>path.join(os.homedir(),p)),...['mcp.json','cofre.json','settings.json','conexoes.json','contas.json'].map(p=>path.join(DIR,p))];

export const FERRAMENTAS_LEITURA = 'Read,Grep,Glob,WebFetch,WebSearch';
export function resolverPolitica({ engine, cwd, somenteLeitura = false, grant = null, agora = Date.now() }) {
  const raiz = path.resolve(cwd || '.');
  if (grant && (grant.expiresAt && Date.parse(grant.expiresAt) <= agora)) throw new Error('permission_denied: grant expirado');
  if (grant && (!grant.workspaceId || !grant.projectId || !grant.executionId)) throw new Error('permission_denied: grant sem identidade');
  const escrita = !somenteLeitura && (!grant || grant.permissions?.includes('code.write.scoped'));
  const writePaths = escrita ? (grant?.writePaths || [raiz]).map(p => path.resolve(p)) : [];
  if (escrita && !writePaths.some(p => dentro(p, raiz))) throw new Error('permission_denied: cwd fora do grant de escrita');
  // Claude CLI não oferece sandbox de filesystem no Windows. Não equiparar
  // allowedTools/acceptEdits a uma barreira de SO para shell arbitrário.
  return { engine, escrita, sandbox: escrita ? 'workspace-write' : 'read-only', writePaths,
    ferramentas: escrita ? 'Read,Grep,Glob,Edit,Write,WebFetch,WebSearch' : FERRAMENTAS_LEITURA,
    shell: engine === 'codex' && (grant ? grant.permissions?.includes('tests.execute') : escrita),
    denyPaths: [...(grant?.denyPaths || []),...caminhosProtegidos()].map(p => path.resolve(p)) };
}
const dentro = (base, alvo) => { const r = path.relative(base, alvo); return r === '' || (!r.startsWith('..' + path.sep) && r !== '..' && !path.isAbsolute(r)); };
export function validarCaminho(alvo, grant, operacao = 'read') {
  const real = p => { let x = path.resolve(p), partes = []; while (!fs.existsSync(x)) { partes.unshift(path.basename(x)); const pai = path.dirname(x); if (pai === x) break; x = pai; } return path.join(fs.realpathSync(x), ...partes); };
  const p = real(alvo);
  const negados = [...(grant?.denyPaths || []),...caminhosProtegidos()];
  const bases = operacao === 'write' ? grant?.writePaths : grant?.readPaths;
  if (!bases?.some(b => dentro(real(b), p)) || negados.some(b => dentro(real(b), p))) throw new Error('permission_denied: caminho fora do grant');
  return p;
}
