import { spawnSync } from 'node:child_process';
import path from 'node:path';
for (const arquivo of ['pedido.mjs','executor-real.mjs','regressoes.mjs','workflow.mjs','ciclo-software.mjs','infra.mjs','planning.mjs','colaboracao-p0.mjs','motores.mjs','ressalvas.mjs','grupos.mjs','posts.mjs','economia.mjs','regras-md.mjs','perfil-conversas.mjs','lideranca.mjs','mcp-contas.mjs','visual-design.mjs','piloto-autonomo.mjs','durabilidade.mjs','pontos.mjs','relatorios-enxutos.mjs','chaves.mjs','paralelo.mjs','paralelo-templates.mjs','vagas.mjs','orfas.mjs','chamadas-api.mjs','conexoes.mjs','equipes.mjs','evidencias.mjs','assessoria.mjs','skills-templates.mjs','voz.mjs','xp.mjs','agenda.mjs','loops.mjs','faxina.mjs','iniciativas.mjs','fase0.mjs','fase1.mjs','fase2.mjs','fase3.mjs','fase4.mjs','fase5.mjs','fase6.mjs','fase7.mjs','teamwork.mjs','worktree-teamwork.mjs','claude-policy.mjs','teamwork-metrics.mjs','benchmark-harness.mjs','combinados.mjs','documentos-chat.mjs','grupo-externo.mjs','equipe-pedir.mjs','novela-vertical.mjs','registro.mjs','jogos-renpy.mjs']) {
  const r = spawnSync(process.execPath, [path.join(import.meta.dirname,arquivo)], { stdio:'inherit', windowsHide:true });
  if (r.error) throw r.error;
  if (r.status !== 0) process.exit(r.status || 1);
}
