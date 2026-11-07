// Contrato de template: o que cada domínio (software, design, jogo, operações) declara para o núcleo, que é neutro.
//   fluxo      'tecnico' (workflow com entrega, verificação, revisão de código, QA) ou 'leve' (dono produz, liderança revisa, QA valida)
//   dominios   quem cobre o quê: { banco: 'dados', git: 'versionamento', ... }  (atribuição de problema por domínio, sem a P.O. lembrar)
//   palavras   palavras-chave por domínio, para o app achar o domínio num texto
//   checagens  o que o app confere sozinho numa entrega: [{ nome, tipo: 'comando'|'arquivos'|'imagem', comando?, minLargura?, minAltura? }]
//   entregas   o que conta como entrega e evidência nesta equipe (texto para o prompt)
//   revisao    { nome, instrucao }: revisão de código, crítica de design, playtest...
//   playbooks  templates/<id>/playbooks/<agente>.md: o que conferir antes, o que entregar, o que é "pronto" no cargo
// Nada aqui sabe o que é código. O template de software é só o primeiro a preencher.
import fs from 'node:fs';
import path from 'node:path';

const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

export function carregarContrato(id, t = {}, pastaTemplate = null, pastaProjeto = null) {
  // O projeto sobrescreve o template: <pastaProjeto>/template/contrato.json (domínios, palavras e checagens somam; entregas e revisão trocam)
  // e <pastaProjeto>/template/playbooks/<agente>.md vence o playbook do template.
  let proj = {};
  if (pastaProjeto) { try { proj = JSON.parse(fs.readFileSync(path.join(pastaProjeto, 'template', 'contrato.json'), 'utf8')) || {}; } catch { proj = {}; } }
  const base = t.contrato || {};
  const c = { ...base, ...proj, dominios: { ...(base.dominios || {}), ...(proj.dominios || {}) }, palavras: { ...(base.palavras || {}), ...(proj.palavras || {}) }, checagens: [...(base.checagens || []), ...(proj.checagens || [])] };
  const fluxo = c.fluxo === 'tecnico' || c.fluxo === 'leve' ? c.fluxo : (id === 'software' ? 'tecnico' : 'leve');
  const dominios = c.dominios && typeof c.dominios === 'object' ? { ...c.dominios } : {};
  const palavras = c.palavras && typeof c.palavras === 'object' ? { ...c.palavras } : {};
  const checagens = (Array.isArray(c.checagens) ? c.checagens : []).filter((x) => x && ['comando', 'arquivos', 'imagem'].includes(x.tipo)).map((x) => ({ nome: String(x.nome || x.tipo).slice(0, 80), ...x }));
  const entregas = String(c.entregas || '').slice(0, 1500);
  const revisao = { nome: String(c.revisao?.nome || 'revisão').slice(0, 60), instrucao: String(c.revisao?.instrucao || '').slice(0, 1500) };
  const playbooks = {};
  for (const dirPb of [pastaTemplate && path.join(pastaTemplate, 'playbooks'), pastaProjeto && path.join(pastaProjeto, 'template', 'playbooks')].filter(Boolean)) {
    if (!fs.existsSync(dirPb)) continue;
    for (const n of fs.readdirSync(dirPb)) if (n.endsWith('.md')) { try { playbooks[n.slice(0, -3)] = fs.readFileSync(path.join(dirPb, n), 'utf8').trim(); } catch { /* playbook ilegível */ } }
  }

  /** Domínio e agente de um texto (problema, ressalva, pedido): conta palavras-chave; empate = nenhum. */
  function especialistaDe(texto, ids = null) {
    const tx = ` ${norm(texto).replace(/[^\p{L}\p{N}]+/gu, ' ')} `;
    let melhor = null; let pontos = 0; let empate = false;
    for (const [dom, lista] of Object.entries(palavras)) {
      const ag = dominios[dom];
      if (!ag || (ids && !ids.has(ag))) continue;
      const n = (Array.isArray(lista) ? lista : []).reduce((s, p) => s + (tx.includes(` ${norm(p)} `) || (norm(p).includes(' ') && tx.includes(norm(p))) ? 1 : 0), 0);
      if (n > pontos) { pontos = n; melhor = { dominio: dom, agente: ag, pontos: n }; empate = false; } else if (n && n === pontos) empate = true;
    }
    return pontos && !empate ? melhor : null;
  }
  const playbookDe = (agente) => playbooks[agente] || '';
  const listaDominios = (nomeDe = (x) => x) => Object.entries(dominios).map(([dom, ag]) => `- ${dom}: ${nomeDe(ag)}${(palavras[dom] || []).length ? ` (${palavras[dom].slice(0, 6).join(', ')})` : ''}`);
  return { fluxo, dominios, palavras, checagens, entregas, revisao, playbooks, especialistaDe, playbookDe, listaDominios };
}
