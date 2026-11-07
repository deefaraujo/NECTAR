# Vozes de referência da chamada

Trechos de 12 s de leituras em português do Brasil, domínio público (LibriVox, via archive.org), usados só como referência de timbre e sotaque para o Chatterbox. Nenhum trecho é reproduzido ao usuário; o modelo gera a fala nova.

| arquivo | leitura | item no archive.org |
|---|---|---|
| leni.wav | Variações sobre o flirt, João do Rio, leitura de Leni | variacoesflirt_1905_librivox |
| felipe.wav | Helena, Machado de Assis, leitura de Felipe Vale da Silva | helena_1501_librivox |
| bilac.wav | Contos para Velhos, Olavo Bilac, capítulo 1 | contos_para_velhos_0912_librivox |

Corte: `ffmpeg -ss 45 -t 12 -ac 1 -ar 24000 -af loudnorm=I=-18:TP=-2`. A amostra própria da pessoa fica fora do app, em `%APPDATA%/Game Studio AI/voz/vozes/propria.wav`.
