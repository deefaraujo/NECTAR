"""Confere, sem abrir o jogo, se todo arquivo citado nos .rpy existe e se há provisório ou teste no build.

Uso: python -X utf8 -I checar_assets.py <raiz do projeto Ren'Py>
Saída: uma linha por problema; código 1 se houver problema de bloqueio.
Pega o que lint não pega: caminho de imagem/som/fonte escrito em string dentro de screen/transform/python,
arquivo PROV_ ou placeholder referenciado, arquivo de teste dentro de game/ que entra no build.
"""
import os, re, sys

raiz = os.path.abspath(sys.argv[1] if len(sys.argv) > 1 else '.')
game = os.path.join(raiz, 'game')
EXT = r'(?:png|jpe?g|webp|gif|ogg|opus|mp3|wav|ttf|otf|webm|mp4)'
RE_STR = re.compile(r'["\']([^"\'\n]+?\.' + EXT + r')["\']', re.I)
SDK_FONTES = {'dejavusans.ttf', 'dejavusans-bold.ttf', 'sourcehansanslite.ttf'}
problemas, avisos = [], []

for dp, _, fs in os.walk(game):
    if os.sep + 'cache' in dp or os.sep + 'saves' in dp:
        continue
    for f in fs:
        if not f.endswith('.rpy'):
            continue
        cam = os.path.join(dp, f); rel = os.path.relpath(cam, raiz)
        if re.match(r'(teste|test|qa)_', f, re.I):
            problemas.append(f'{rel}: arquivo de teste dentro de game/ (vai para o build e pode mexer em config); mova para fora de game/')
        if os.sep + 'testes' + os.sep in cam:
            continue   # arnês: grava prints; a exclusão do build é conferida abaixo
        for n, linha in enumerate(open(cam, encoding='utf-8', errors='replace'), 1):
            if linha.lstrip().startswith('#'):
                continue
            if re.search(r'screenshot|os\.path\.join|makedirs|open\(', linha):
                continue   # arquivo que o código GRAVA (print, log), não que o jogo carrega
            for m in RE_STR.finditer(linha):
                p = m.group(1).replace(chr(92), '/')
                if '[' in p or '{' in p or '%' in p:
                    continue   # caminho montado em tempo de execução: não dá para conferir estático
                if os.path.basename(p).lower() in SDK_FONTES:
                    continue
                alvo = os.path.join(game, p)
                if not os.path.exists(alvo):
                    problemas.append(f'{rel}:{n}: arquivo não existe: {p}')
                if re.search(r'(^|/)(PROV_|placeholder|temp_|tmp_)', p, re.I):
                    problemas.append(f'{rel}:{n}: provisório referenciado no jogo: {p}')

# cena só com transcrição: direção do roteiro em comentário e nenhum scene/show (o jogador vê fala solta, sem personagem nem clima)
cenas = os.path.join(game, 'cenas')
if os.path.isdir(cenas):
    for f in sorted(os.listdir(cenas)):
        if not f.endswith('.rpy') or re.match(r'(teste|test|qa)_', f, re.I):
            continue
        txt = open(os.path.join(cenas, f), encoding='utf-8', errors='replace').read()
        direcao = len(re.findall(r'^\s*#\s*(DIRE[CÇ][AÃ]O|SOM|ÁUDIO|AUDIO|CORTE|C[AÂ]MERA)', txt, re.M | re.I))
        encena = len(re.findall(r'^\s*(scene|show)\s', txt, re.M))
        falas = len(re.findall(r'^\s*\w+\s+"', txt, re.M))
        if direcao >= 2 and encena == 0 and falas:
            problemas.append(f'game/cenas/{f}: {direcao} direção(ões) do roteiro só em comentário e nenhum scene/show: cena transcrita, não encenada')

# arnês de teste dentro de game/ só é aceitável se o build o exclui
opts = os.path.join(game, 'options.rpy')
if os.path.isdir(os.path.join(game, 'testes')):
    txt = open(opts, encoding='utf-8', errors='replace').read() if os.path.exists(opts) else ''
    if not re.search(r"build\.classify\(\s*['\"]game/testes/\*\*['\"]\s*,\s*None", txt):
        problemas.append("game/testes/ entra no build: acrescente build.classify('game/testes/**', None) em options.rpy")

for p in problemas:
    print('BLOQUEIA', p)
for a in avisos:
    print('AVISO', a)
print(f'{len(problemas)} problema(s) em {game}')
sys.exit(1 if problemas else 0)
