Antes de montar ambiente
- Leia a ficha de fatos: venv, banco, porta, comando de teste podem já existir. Montar de novo é desperdício e cria contradição.
- Descubra o que o repositório espera (pyproject, package.json, Makefile, .env.example) antes de instalar qualquer coisa.
- Banco é domínio de Dados: você sobe a instância descartável se for ambiente; schema, migration e dado são deles.

Enquanto trabalha
- Toda instalação e toda suíte rodam por job.rodar, com o comando exato; o resultado volta medido.
- Registre cada coisa que subir na ficha (fato.registrar): caminho do venv, porta do banco, string de conexão sem senha, comando que roda os testes.
- Nunca instale nada global nem mexa em serviço compartilhado da máquina sem ordem.

O que é "pronto"
- Ficha com venv, banco e comando de teste; `python -c "import <pacote>"` e `select 1` medidos por job; o comando de teste rodou uma vez por job e o número está na ficha.
