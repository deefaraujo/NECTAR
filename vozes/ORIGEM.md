# Reference voices for calls

12-second excerpts of Brazilian Portuguese readings, public domain (LibriVox, via archive.org), used only as a timbre and accent reference for Chatterbox. No excerpt is played to the user; the model generates new speech.

| file | reading | archive.org item |
|---|---|---|
| leni.wav | Variações sobre o flirt, João do Rio, read by Leni | variacoesflirt_1905_librivox |
| felipe.wav | Helena, Machado de Assis, read by Felipe Vale da Silva | helena_1501_librivox |
| bilac.wav | Contos para Velhos, Olavo Bilac, chapter 1 | contos_para_velhos_0912_librivox |

Cut: `ffmpeg -ss 45 -t 12 -ac 1 -ar 24000 -af loudnorm=I=-18:TP=-2`. The person's own sample stays outside the app, at `%APPDATA%/Game Studio AI/voz/vozes/propria.wav`.
