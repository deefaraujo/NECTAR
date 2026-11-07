"""Vista Produção: fichas, referência aprovada, pedido pronto no chat, card com ficha. Sem modelo (STUDIO_FAKE)."""
import base64, json, os, pathlib, subprocess, sys, tempfile, urllib.request
from playwright.sync_api import sync_playwright, expect

ROOT = pathlib.Path(__file__).resolve().parents[1]
OUT = pathlib.Path(tempfile.mkdtemp(prefix='nectar-prod-shots-'))   # capturas para olhar quando algo falha
PNG = base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==')
with tempfile.TemporaryDirectory(prefix='nectar-prod-') as temp:
    tmp = pathlib.Path(temp); data = tmp / 'data'; data.mkdir()
    (data / 'settings.json').write_text(json.dumps({'piloto': {'ativo': False}, 'relatorio': {'ativo': False}, 'ciclo': {'revisaoAuto': False, 'curadoriaAuto': False, 'statusPO': False, 'versionar': False, 'posts': False}}))
    target = tmp / 'novela'; (target / 'biblia').mkdir(parents=True)
    (target / 'biblia' / 'ana.md').write_text('# Ana\n\nFicha completa da Ana.\n', encoding='utf8')
    (target / 'episodios' / 'ep01' / 'cena01' / 'quadros').mkdir(parents=True)
    (target / 'episodios' / 'ep01' / 'cena01' / 'quadros' / 'q01.png').write_bytes(PNG)
    env = {**os.environ, 'STUDIO_DATA': str(data), 'STUDIO_PROJETOS': str(tmp / 'projetos'), 'STUDIO_FAKE': '1', 'STUDIO_PORT': '0'}
    proc = subprocess.Popen(['node', 'server.mjs'], cwd=ROOT, env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, creationflags=subprocess.CREATE_NO_WINDOW)
    try:
        port = proc.stdout.readline().split('http://localhost:')[1].split()[0]
        base = 'http://127.0.0.1:' + port
        def req(route, body=None, method=None, raw=None):
            r = urllib.request.Request(base + route, data=raw if raw is not None else (json.dumps(body).encode() if body is not None else None), headers={'Content-Type': 'application/json'}, method=method)
            return json.loads(urllib.request.urlopen(r).read())
        p = req('/api/projetos', {'nome': 'Amor Vertical', 'caminho': str(target), 'template': 'novela-vertical'})['projeto']; pid = p['id']
        est = req(f'/api/p/{pid}/estado'); assert est['registro']['vista'] == 'Produção', est['registro']
        req(f'/api/p/{pid}/registro', {'tipo': 'serie', 'nome': 'Amor Vertical', 'resumo': 'Drama romântico vertical em aquarela, episódios de 2 minutos.'})
        req(f'/api/p/{pid}/registro', {'tipo': 'estilo', 'nome': 'Aquarela quente', 'resumo': 'Aquarela, luz dourada, traço solto.'})
        ana = req(f'/api/p/{pid}/registro', {'tipo': 'personagem', 'nome': 'Ana', 'resumo': 'Ruiva de cachos, 27 anos, sardas, **jaqueta verde**.', 'apelidos': ['a protagonista'], 'arquivo': 'biblia/ana.md'})
        assert ana['ok'] and ana['entrada']['chave'] == 'personagem:ana', ana
        req(f'/api/p/{pid}/registro', {'tipo': 'cena', 'id': 'ep01-c01', 'nome': 'Cena 1 do ep 1', 'apelidos': ['cena 1'], 'resumo': 'Ana chega na padaria.'})
        an = req(f'/api/p/{pid}/anexo?nome=ana-ref.png', method='PUT', raw=PNG); assert an['ok'], an
        r = req(f'/api/p/{pid}/registro', {'tipo': 'personagem', 'id': 'ana', 'nome': 'Ana', 'refsAnexo': [an['anexo']['rel']]}); assert len(r['entrada']['refs']) == 1 and r['entrada']['resumo'].startswith('Ruiva'), r
        gal = req(f'/api/p/{pid}/registro/galeria'); nomes = {i['nome'] for i in gal['itens']}
        assert 'q01.png' in nomes and any(i['ficha'] == 'personagem:ana' for i in gal['itens']), gal
        reg = req(f'/api/p/{pid}/registro'); assert reg['vista'] == 'Produção' and len(reg['entradas']) == 4 and 'pedidos' in reg['tipos']['cena'], reg['tipos']['cena']
        # arquivo: só de dentro do projeto
        assert urllib.request.urlopen(f'{base}/api/p/{pid}/arquivo?caminho=biblia/ana.md').status == 200
        try: urllib.request.urlopen(f'{base}/api/p/{pid}/arquivo?caminho=' + urllib.parse.quote(str(ROOT / 'package.json'))); raise SystemExit('arquivo fora do projeto foi servido')
        except urllib.error.HTTPError as e: assert e.code == 404
        with sync_playwright() as pw:
            browser = pw.chromium.launch(headless=True, channel='msedge')
            page = browser.new_page(viewport={'width': 1480, 'height': 920})
            page.add_init_script("localStorage.setItem('nectar:idioma', 'pt-BR')")  # os seletores destes testes estão em português
            errors = []; page.on('pageerror', lambda e: errors.append(str(e)))
            page.goto(f'{base}/#{pid}/registro')
            expect(page.locator('.producao h1')).to_have_text('Produção')
            expect(page.locator('.reg-item')).to_have_count(4)
            expect(page.locator('.rail-btn[data-vista="registro"]')).to_have_attribute('data-tip', 'Produção')
            page.screenshot(path=str(OUT / '1-vazio.png'))
            page.locator('.reg-item[data-chave="personagem:ana"]').click()
            expect(page.locator('.reg-nome')).to_have_text('Ana')
            expect(page.locator('.reg-resumo b')).to_have_text('jaqueta verde')
            expect(page.locator('.reg-ref img')).to_have_count(1)
            expect(page.locator('.reg-pedido')).to_have_count(3)
            page.screenshot(path=str(OUT / '2-ana.png'))
            # acrescentar pela ficha
            page.locator('#reg-acresc').fill('Agora usa óculos redondos.'); page.locator('#reg-acresc').press('Enter')
            expect(page.locator('.reg-resumo')).to_contain_text('óculos redondos'); expect(page.locator('.reg-meta')).to_contain_text('v3')
            # documento completo
            page.locator('[data-reg="ler-doc"]').click(); expect(page.locator('.reg-doc-modal .texto')).to_contain_text('Ficha completa da Ana'); page.keyboard.press('Escape')
            # criar tarefa com a ficha -> card com contexto
            page.locator('[data-reg="card"]').click(); expect(page.locator('.reg-ctx .chip-cam')).to_contain_text('Ana')
            page.locator('#n-tit').fill('Folha de personagem da Ana'); page.locator('#m-sim').click()
            page.wait_for_function("() => J().cartoes.some(c => (c.contexto||[]).includes('personagem:ana'))", timeout=8000)
            cid = page.evaluate("() => J().cartoes.find(c => (c.contexto||[]).includes('personagem:ana')).id")
            page.wait_for_function("() => document.querySelector('.reg-uso')", timeout=8000)
            expect(page.locator('.reg-uso')).to_contain_text('Folha de personagem da Ana')
            page.evaluate('(id) => abrirIssue(id)', cid)
            expect(page.locator('.issue-side .reg-ctx .chip-cam')).to_contain_text('Ana')
            page.locator('.issue-side [data-ctx-add]').select_option('cena:ep01-c01')
            page.wait_for_function("(id) => (J().cartoes.find(c => c.id === id).contexto||[]).length === 2", arg=cid, timeout=8000)
            page.screenshot(path=str(OUT / '3-card.png')); page.keyboard.press('Escape')
            # gerados: aprovar quadro como referência da cena
            page.locator('[data-reg="modo"][data-modo="gerados"]').click()
            expect(page.locator('.reg-ger')).to_have_count(2)
            page.screenshot(path=str(OUT / '4-gerados.png'))
            page.locator('.reg-ger:not(.aprovada)').first.click(); page.locator('#rv-ficha').select_option('cena:ep01-c01'); page.locator('#rv-aprovar').click()
            page.wait_for_function("() => document.querySelectorAll('.reg-ger.aprovada').length === 2", timeout=8000)
            # pedido pronto abre o chat com o texto montado
            page.locator('[data-reg="modo"][data-modo="fichas"]').click(); page.locator('.reg-item[data-chave="cena:ep01-c01"]').click()
            expect(page.locator('.reg-pedido')).to_have_count(4)
            page.locator('.reg-pedido').nth(1).click()
            expect(page.locator('#texto')).to_have_value('@arte gere os quadros de Cena 1 do ep 1 (3 a 6, 9:16) com as referências aprovadas de quem aparece.')
            page.screenshot(path=str(OUT / '5-chat.png'))
            # evento de agente redesenha: anota pela ação simulada
            page.goto(f'{base}/#{pid}/registro/personagem:ana'); expect(page.locator('.reg-nome')).to_have_text('Ana')
            req(f'/api/p/{pid}/mensagem', {'canal': 'dm:continuidade', 'texto': '[teste:anotar:personagem:Bruno:Irmão da Ana, barba.] anota aí'})
            expect(page.locator('.reg-item[data-chave="personagem:bruno"]')).to_be_visible(timeout=15000)
            # remover
            page.locator('.reg-item[data-chave="personagem:bruno"]').click(); page.locator('[data-reg="remover"]').click(); page.locator('#m-sim').click()
            expect(page.locator('.reg-item')).to_have_count(4)
            # telas menores: nada some; o painel vai para baixo e a árvore vira faixa
            for w, h in ((1000, 800), (760, 900), (600, 900)):
                page.set_viewport_size({'width': w, 'height': h}); page.locator('.reg-item[data-chave="personagem:ana"]').click()
                expect(page.locator('.reg-lado')).to_be_visible(); expect(page.locator('.reg-pedido').first).to_be_visible(); expect(page.locator('.reg-nome')).to_be_visible()
                assert page.evaluate('() => document.documentElement.scrollWidth <= document.documentElement.clientWidth'), f'rolagem horizontal em {w}px'
                page.screenshot(path=str(OUT / f'7-{w}.png'))
                page.locator('[data-reg="modo"][data-modo="gerados"]').click(); expect(page.locator('.reg-ger').first).to_be_visible()
                page.locator('.reg-ger').first.click(); expect(page.locator('#rv-ficha')).to_be_visible(); page.screenshot(path=str(OUT / f'8-{w}-ver.png')); page.keyboard.press('Escape')
                page.locator('[data-reg="modo"][data-modo="fichas"]').click()
            print('capturas em', OUT)
            assert not errors, errors
            browser.close()
        print('PASS: vista Produção (fichas, acrescentar, documento, card com contexto, gerados aprovados, pedido no chat, evento de agente, remover).')
    finally:
        proc.kill(); err = proc.stderr.read()
        if err.strip(): print('STDERR:', err[-3000:], file=sys.stderr)
