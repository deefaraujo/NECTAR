export function erroVisualRecuperavel(mensagem='') {
  const t=String(mensagem);
  if(/cancelad|captcha|login|autentica|credential|nenhum dos modelos|configuração do desafio|informe um currículo|quadro inválido|modelo de entrevista inválido/i.test(t))return false;
  return /submissão bloqueada|avaliação dos testes inválida|json|unexpected|unterminated|ação visual inválida|coordenadas inválidas|texto inválido|código inválido|tecla inválida|rolagem inválida|etapa e o resultado|memória do desafio inválida|linguage[mn].*(confirmada|inválid|incompat)|conclusão sem evidência|sem resposta visual|excedeu|demorou|429|50[0234]|overload|rate.?limit|quota|cota|network|fetch failed|ECONN|ETIMEDOUT|incomplete/i.test(t);
}
