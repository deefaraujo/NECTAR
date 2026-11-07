"""Baixa um asset da internet para a pasta de fontes do projeto e registra a origem e a licença.

  python baixar.py URL --para assets-fonte/kenney-ui --licenca CC0-1.0 --origem "https://kenney.nl/assets/ui-pack" [--autor Kenney] [--nome ui-pack.zip]

- Grava em <para>/ e, se for .zip, extrai ali mesmo (sem sair da pasta: zip malicioso é recusado).
- Escreve <para>/ORIGEM.json com url, origem, licença, autor, data, sha256, tamanho e lista de arquivos.
- Acrescenta uma linha em assets-fonte/MANIFESTO.md (na pasta pai de <para>) para o crédito do jogo.
- Sem --licenca não baixa: licença é o que permite usar.
Só biblioteca padrão. Não sobrescreve pasta que já tem ORIGEM.json (use --forcar).
"""
import argparse
import datetime
import hashlib
import json
import os
import sys
import urllib.request
import zipfile

LICENCAS_OK = {'CC0-1.0', 'CC-BY-4.0', 'CC-BY-3.0', 'CC-BY-SA-4.0', 'OFL-1.1', 'MIT', 'Apache-2.0', 'BSD-3-Clause', 'Unlicense', 'Kenney-CC0'}


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument('url')
    p.add_argument('--para', required=True, help='pasta de destino (ex.: assets-fonte/kenney-ui)')
    p.add_argument('--licenca', required=True, help='identificador SPDX: CC0-1.0, CC-BY-4.0, OFL-1.1, MIT...')
    p.add_argument('--origem', required=True, help='página onde a licença foi conferida')
    p.add_argument('--autor', default='')
    p.add_argument('--nome', default='', help='nome do arquivo salvo (padrão: o da URL)')
    p.add_argument('--atribuicao', default='', help='texto de crédito exigido (CC-BY)')
    p.add_argument('--forcar', action='store_true')
    a = p.parse_args()

    if a.licenca not in LICENCAS_OK:
        sys.exit(f'licença "{a.licenca}" não está na lista aceita {sorted(LICENCAS_OK)}; se a licença for outra, pare e pergunte à dona')
    if a.licenca.startswith('CC-BY') and not a.atribuicao:
        sys.exit('CC-BY exige --atribuicao com o texto de crédito (autor, obra, link)')
    os.makedirs(a.para, exist_ok=True)
    origem_json = os.path.join(a.para, 'ORIGEM.json')
    if os.path.exists(origem_json) and not a.forcar:
        sys.exit(f'{a.para} já tem ORIGEM.json; use --forcar para baixar de novo')

    nome = a.nome or os.path.basename(a.url.split('?')[0]) or 'download.bin'
    destino = os.path.join(a.para, nome)
    req = urllib.request.Request(a.url, headers={'User-Agent': 'Mozilla/5.0 (NECTAR assets)'})
    with urllib.request.urlopen(req, timeout=120) as r, open(destino, 'wb') as f:
        tipo = r.headers.get('Content-Type', '')
        total = 0
        while True:
            b = r.read(1 << 20)
            if not b:
                break
            f.write(b); total += len(b)
    if 'text/html' in tipo:
        os.remove(destino)
        sys.exit('a URL devolveu uma página HTML, não um arquivo: procure o link direto do download')
    sha = hashlib.sha256(open(destino, 'rb').read()).hexdigest()

    arquivos = [nome]
    if nome.lower().endswith('.zip'):
        with zipfile.ZipFile(destino) as z:
            raiz = os.path.realpath(a.para)
            for m in z.infolist():
                alvo = os.path.realpath(os.path.join(a.para, m.filename))
                if not alvo.startswith(raiz + os.sep) and alvo != raiz:
                    sys.exit(f'zip tenta escrever fora da pasta ({m.filename}): recusado')
            z.extractall(a.para)
            arquivos = [m.filename for m in z.infolist() if not m.is_dir()]
        os.remove(destino)

    registro = {
        'url': a.url, 'origem': a.origem, 'licenca': a.licenca, 'autor': a.autor, 'atribuicao': a.atribuicao,
        'baixado_em': datetime.date.today().isoformat(), 'sha256': sha, 'bytes': total, 'arquivos': arquivos[:500], 'total_arquivos': len(arquivos),
    }
    json.dump(registro, open(origem_json, 'w', encoding='utf8'), ensure_ascii=False, indent=1)

    manifesto = os.path.join(os.path.dirname(os.path.abspath(a.para)), 'MANIFESTO.md')
    novo = not os.path.exists(manifesto)
    with open(manifesto, 'a', encoding='utf8') as f:
        if novo:
            f.write('# Assets de terceiros\n\n| pasta | licença | autor | origem | crédito exigido | data |\n|---|---|---|---|---|---|\n')
        f.write(f'| {os.path.basename(a.para)} | {a.licenca} | {a.autor} | {a.origem} | {a.atribuicao or "-"} | {registro["baixado_em"]} |\n')
    print(f'ok: {len(arquivos)} arquivo(s) em {a.para} ({total // 1024} KB), licença {a.licenca}, registrado em {manifesto}')


if __name__ == '__main__':
    main()
