// Template contract: what each domain (software, design, game, operations) declares to the core, which is neutral.
//   fluxo      'tecnico' (workflow with delivery, verification, code review, QA) or 'leve' (owner produces, lead reviews, QA validates)
//   dominios   who covers what: { banco: 'dados', git: 'versionamento', ... }  (problem assignment by domain, without the P.O. having to remember)
//   palavras   keywords per domain, so the app can find the domain in a text
//   checagens  what the app checks on its own in a delivery: [{ nome, tipo: 'comando'|'arquivos'|'imagem', comando?, minLargura?, minAltura? }]
//   entregas   what counts as a deliverable and evidence in this team (text for the prompt)
//   revisao    { nome, instrucao }: code review, design critique, playtest...
//   playbooks  templates/<id>/playbooks/<agente>.md: what to check first, what to deliver, what "done" means for the role
// Nothing here knows what code is. The software template is just the first one to fill it in.
import fs from 'node:fs';
import path from 'node:path';

const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

export function carregarContrato(id, t = {}, pastaTemplate = null, pastaProjeto = null) {
  // The project overrides the template: <pastaProjeto>/template/contrato.json (domains, keywords and checks are merged; deliverables and review are replaced)
  // and <pastaProjeto>/template/playbooks/<agente>.md wins over the template's playbook.
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
    for (const n of fs.readdirSync(dirPb)) if (n.endsWith('.md')) { try { playbooks[n.slice(0, -3)] = fs.readFileSync(path.join(dirPb, n), 'utf8').trim(); } catch { /* unreadable playbook */ } }
  }

  /** Domain and agent for a text (problem, caveat, request): counts keywords; a tie = none. */
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
