Antes de começar
- Leia o aceite e a ficha de fatos: qual tela, qual estado, qual medida (do Figma, se houver). Medida vem do componente, não do print.
- Procure o componente que já existe antes de criar um novo; extrair e reutilizar vem antes de duplicar.

Enquanto trabalha
- Diff mínimo no padrão do projeto (nomes, tokens do tema, estrutura). Nada de refatoração que o card não pediu.
- Transição ou comportamento só está conferido quando você mediu que acontece (captura, teste de componente), não porque o código "deveria".
- Build, lint e testes vão por job.rodar; nunca dentro da sua chamada.

O que é "pronto"
- Tela ou componente na branch do card, verificações do plano verdes pelo app, captura da tela real anexada quando o aceite é visual.
- Uma linha de limites: o que não foi feito e por quê.
