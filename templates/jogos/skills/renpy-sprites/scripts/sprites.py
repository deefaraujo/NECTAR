"""Ajustes de sprite para Ren'Py (Pillow). Nunca sobrescreve a entrada: grava em --saida.

Comandos:
  info      <arquivos ou pastas>                      tamanho, área útil (sem transparência), margem, peso
  padronizar <entrada> --saida PASTA --altura 1600 [--canvas 1200x1800] [--base 0.98] [--por-figura]
            pousa os pés na mesma linha de base, centralizado, num canvas igual para todos (âncora
            xalign .5, yalign 1.0). Padrão: UMA escala para o lote (a figura mais alta fica com --altura),
            certo para quadros de animação e expressões. --por-figura: cada uma com a mesma altura.
  reduzir   <entrada> --saida PASTA --fator 0.5      versão menor para celular (LANCZOS), mantém o nome
  folha     <entrada> --saida ARQ.png [--colunas 6]  folha de contato para conferir lado a lado
  recortar  <entrada> --saida PASTA [--margem 4]     só tira a transparência sobrando
  fatiar    <folha.png> --saida PASTA --grade 3x2     corta uma folha de animação em quadros
            (nome_01.png, nome_02.png... da esquerda para a direita, de cima para baixo); depois
            padronize os quadros juntos para todos pousarem na mesma base
<entrada> pode ser arquivo ou pasta (pega .png, .webp, .jpg).
"""
import argparse
import json
import os
import sys

from PIL import Image, ImageDraw

Image.MAX_IMAGE_PIXELS = 400_000_000  # arte-fonte de jogo passa fácil do limite padrão (179 MP)

EXT = ('.png', '.webp', '.jpg', '.jpeg')


def arquivos(entradas):
    for e in entradas:
        if os.path.isdir(e):
            for n in sorted(os.listdir(e)):
                if n.lower().endswith(EXT):
                    yield os.path.join(e, n)
        elif os.path.isfile(e):
            yield e
        else:
            print(f'não achei: {e}', file=sys.stderr)


def caixa(img):
    if img.mode != 'RGBA':
        img = img.convert('RGBA')
    # alfa <= 16 é poeira de recorte (halo, sombra quase invisível): não conta como figura
    return img, img.getchannel('A').point(lambda v: 255 if v > 16 else 0).getbbox()


def opaca(img):
    """Sem nenhum pixel transparente: o fundo faz parte da imagem e recorte/âncora não funcionam."""
    return img.getchannel('A').getextrema()[0] == 255


def destino(pasta, origem):
    os.makedirs(pasta, exist_ok=True)
    d = os.path.join(pasta, os.path.basename(origem))
    if os.path.abspath(d) == os.path.abspath(origem):
        sys.exit('a saída não pode ser a mesma pasta da entrada')
    return os.path.splitext(d)[0] + '.png' if d.lower().endswith(('.jpg', '.jpeg')) else d


def cmd_info(a):
    linhas = []
    for f in arquivos(a.entrada):
        img, bb = caixa(Image.open(f))
        w, h = img.size
        r = {'arquivo': f, 'tamanho': f'{w}x{h}', 'kb': round(os.path.getsize(f) / 1024)}
        if opaca(img):
            r['aviso'] = 'SEM TRANSPARÊNCIA: o fundo é parte da imagem; tire o fundo antes de usar como sprite'
        if bb:
            r['util'] = f'{bb[2]-bb[0]}x{bb[3]-bb[1]}'
            r['margem'] = {'esq': bb[0], 'topo': bb[1], 'dir': w - bb[2], 'base': h - bb[3]}
        else:
            r['util'] = 'vazia'
        linhas.append(r)
    print(json.dumps(linhas, ensure_ascii=False, indent=1))
    alturas = {x['util'] for x in linhas if x['util'] != 'vazia'}
    bases = {x['margem']['base'] for x in linhas if 'margem' in x}
    if len(linhas) > 1:
        print(f'{len(linhas)} arquivos; áreas úteis diferentes: {len(alturas)}; margens de base diferentes: {len(bases)}')


def cmd_recortar(a):
    for f in arquivos(a.entrada):
        img, bb = caixa(Image.open(f))
        if not bb:
            print(f'pulei (vazia): {f}'); continue
        m = a.margem
        bb = (max(0, bb[0]-m), max(0, bb[1]-m), min(img.width, bb[2]+m), min(img.height, bb[3]+m))
        d = destino(a.saida, f); img.crop(bb).save(d)
        print(f'{f} -> {d} {bb[2]-bb[0]}x{bb[3]-bb[1]}')


def cmd_padronizar(a):
    """Lote (padrão): uma escala só para todos, pela figura mais alta, e o desenho inteiro desloca junto,
    então quadros de animação e expressões não mudam de tamanho nem escorregam entre si.
    --por-figura: cada imagem vira a mesma altura (personagens diferentes numa mesma régua)."""
    cw, ch = (int(x) for x in a.canvas.lower().split('x'))
    base_y = round(ch * a.base)
    falhas = 0
    itens = []
    for f in arquivos(a.entrada):
        img, bb = caixa(Image.open(f))
        if not bb:
            print(f'pulei (vazia): {f}'); continue
        if opaca(img):
            print(f'SEM TRANSPARÊNCIA {f}: tire o fundo antes; padronizar mediria a imagem inteira', file=sys.stderr)
            falhas += 1; continue
        itens.append((f, img, bb))
    if not itens:
        sys.exit('nenhuma imagem utilizável')
    z_lote = a.altura / max(bb[3] - bb[1] for _, _, bb in itens)
    for f, img, bb in itens:
        z = a.altura / (bb[3] - bb[1]) if a.por_figura else z_lote
        if a.por_figura:
            img = img.crop(bb); bb = (0, 0, img.width, img.height)
        nova = img.resize((max(1, round(img.width * z)), max(1, round(img.height * z))), Image.LANCZOS)
        cx = (bb[0] + bb[2]) / 2 * z if a.por_figura else nova.width / 2
        x, y = round(cw / 2 - cx), round(base_y - bb[3] * z)
        fx0, fy0, fx1 = x + bb[0] * z, y + bb[1] * z, x + bb[2] * z
        if fx0 < 0 or fx1 > cw or fy0 < 0:
            print(f'NÃO CABE {f}: figura sai do canvas {cw}x{ch} (zoom {z:.3f}); aumente --canvas ou baixe --altura', file=sys.stderr)
            falhas += 1; continue
        tela = Image.new('RGBA', (cw, ch), (0, 0, 0, 0))
        tela.alpha_composite(nova, (max(x, 0), max(y, 0)), (max(-x, 0), max(-y, 0)))
        d = destino(a.saida, f); tela.save(d)
        print(f'{f} -> {d} zoom {z:.3f}, figura {round((bb[2]-bb[0])*z)}x{round((bb[3]-bb[1])*z)} em {cw}x{ch}')
    if falhas:
        sys.exit(f'{falhas} arquivo(s) ficaram de fora (ver avisos acima): nada foi gravado para eles')


def cmd_fatiar(a):
    col, lin = (int(x) for x in a.grade.lower().split('x'))
    for f in arquivos(a.entrada):
        img = Image.open(f).convert('RGBA')
        w, h = img.width // col, img.height // lin
        if img.width % col or img.height % lin:
            print(f'aviso {f}: {img.width}x{img.height} não divide exato em {col}x{lin}; sobra cortada', file=sys.stderr)
        os.makedirs(a.saida, exist_ok=True)
        base = os.path.splitext(os.path.basename(f))[0]
        n = 0
        for j in range(lin):
            for i in range(col):
                q = img.crop((i * w, j * h, (i + 1) * w, (j + 1) * h))
                if not caixa(q)[1]:
                    continue  # célula vazia no fim da folha
                n += 1
                q.save(os.path.join(a.saida, f'{base}_{n:02d}.png'))
        print(f'{f} -> {n} quadros de {w}x{h} em {a.saida}')


def cmd_reduzir(a):
    for f in arquivos(a.entrada):
        img = Image.open(f)
        n = (max(1, round(img.width * a.fator)), max(1, round(img.height * a.fator)))
        d = destino(a.saida, f)
        img.resize(n, Image.LANCZOS).save(d, optimize=True)
        print(f'{f} -> {d} {n[0]}x{n[1]} {round(os.path.getsize(d)/1024)} KB')


def cmd_folha(a):
    fs = list(arquivos(a.entrada))
    if not fs:
        sys.exit('nenhuma imagem')
    alvo = 360
    miniaturas = []
    for f in fs:
        img = Image.open(f).convert('RGBA'); img.thumbnail((alvo, alvo))
        miniaturas.append((os.path.basename(f), img))
    col = min(a.colunas, len(miniaturas)); lin = -(-len(miniaturas) // col)
    folha = Image.new('RGB', (col * (alvo + 16), lin * (alvo + 40)), (40, 40, 46))
    dr = ImageDraw.Draw(folha)
    for i, (nome, img) in enumerate(miniaturas):
        x, y = (i % col) * (alvo + 16) + 8, (i // col) * (alvo + 40) + 8
        xadrez = Image.new('RGB', (alvo, alvo), (70, 70, 78))
        folha.paste(xadrez, (x, y))
        folha.paste(img, (x + (alvo - img.width) // 2, y + alvo - img.height), img)
        dr.line([(x, y + alvo - 1), (x + alvo, y + alvo - 1)], fill=(240, 160, 110))
        dr.text((x, y + alvo + 6), nome[:44], fill=(230, 230, 230))
    os.makedirs(os.path.dirname(os.path.abspath(a.saida)), exist_ok=True)
    folha.save(a.saida)
    print(f'folha com {len(miniaturas)} imagens: {a.saida}')


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    s = p.add_subparsers(dest='cmd', required=True)
    x = s.add_parser('info'); x.add_argument('entrada', nargs='+'); x.set_defaults(f=cmd_info)
    x = s.add_parser('recortar'); x.add_argument('entrada', nargs='+'); x.add_argument('--saida', required=True); x.add_argument('--margem', type=int, default=4); x.set_defaults(f=cmd_recortar)
    x = s.add_parser('padronizar'); x.add_argument('entrada', nargs='+'); x.add_argument('--saida', required=True); x.add_argument('--altura', type=int, required=True); x.add_argument('--canvas', default='1200x1800'); x.add_argument('--base', type=float, default=0.98); x.add_argument('--por-figura', action='store_true'); x.set_defaults(f=cmd_padronizar)
    x = s.add_parser('fatiar'); x.add_argument('entrada', nargs='+'); x.add_argument('--saida', required=True); x.add_argument('--grade', required=True); x.set_defaults(f=cmd_fatiar)
    x = s.add_parser('reduzir'); x.add_argument('entrada', nargs='+'); x.add_argument('--saida', required=True); x.add_argument('--fator', type=float, default=0.5); x.set_defaults(f=cmd_reduzir)
    x = s.add_parser('folha'); x.add_argument('entrada', nargs='+'); x.add_argument('--saida', required=True); x.add_argument('--colunas', type=int, default=6); x.set_defaults(f=cmd_folha)
    a = p.parse_args(); a.f(a)


if __name__ == '__main__':
    main()
