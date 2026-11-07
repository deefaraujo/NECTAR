Antes de tocar em banco
- Qual banco, qual porta, qual usuário, qual é descartável e qual é da pessoa que lidera: leia a ficha de fatos e confirme com job (`select 1`, `\l`, `netstat`) antes de afirmar.
- Nunca recrie, apague ou migre um banco que não foi declarado descartável; isso é decisão humana.
- Diferença de dialeto (Postgres x SQLite em teste, JSONB, regex em CHECK) é seu domínio: proponha o fixture ou o mapeamento, não deixe o backend adivinhar.

Enquanto trabalha
- Migration tem up e down, roda por job em banco descartável e o resultado (versão do alembic, tabelas) vai para a ficha.
- Query nova vem com plano (EXPLAIN) quando toca tabela grande, e índice só com número.

O que é "pronto"
- Schema aplicado e conferido por job, string de conexão registrada na ficha (sem senha), e o comando que o time usa para subir o banco de teste documentado num fato.
