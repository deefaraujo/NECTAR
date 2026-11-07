"""Organizador operacional: dados isolados, navegador sem janela e nenhum modelo."""
import json, os, pathlib, subprocess, tempfile
from playwright.sync_api import sync_playwright, expect
root=pathlib.Path(__file__).resolve().parents[1]
with tempfile.TemporaryDirectory(prefix='nectar-operacao-') as temp:
    data=pathlib.Path(temp)/'data';data.mkdir()
    (data/'settings.json').write_text(json.dumps({'piloto':{'ativo':False}}))
    env={**os.environ,'STUDIO_DATA':str(data),'STUDIO_PROJETOS':str(pathlib.Path(temp)/'projetos'),'STUDIO_FAKE':'1','STUDIO_PORT':'0'}
    proc=subprocess.Popen(['node','server.mjs'],cwd=root,env=env,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,creationflags=subprocess.CREATE_NO_WINDOW)
    try:
        port=proc.stdout.readline().split('http://localhost:')[1].split()[0]
        base='http://127.0.0.1:'+port
        with sync_playwright() as pw:
            browser=pw.chromium.launch(headless=True,channel='msedge')
            page=browser.new_page(viewport={'width':1366,'height':900})
            erros=[];page.on('pageerror',lambda e:erros.append(str(e)))
            page.goto(base)
            expect(page.locator('a[href="/avaliacoes.html"]')).to_be_visible()
            page.locator('a[href="/avaliacoes.html"]').click()
            chamadas=[]
            page.on('request',lambda r:chamadas.append(r.url) if '/api/' in r.url else None)
            expect(page.locator('h1')).to_have_text('Tarefas de avaliação')
            page.locator('#nova').click()
            page.locator('#titulo').fill('Minha tarefa de teste')
            page.locator('#referencia').fill('registro-01')
            page.locator('#status').select_option('aguardando_modelos')
            page.locator('#etapa').select_option('respostas')
            page.locator('#proximoPasso').fill('Retomar após o processamento')
            page.locator('[data-check="login"]').check()
            page.locator('button[type="submit"]').click()
            expect(page.locator('#estado')).to_contain_text('Checkpoint salvo')
            page.reload()
            page.locator('#lista-tarefas button').click()
            expect(page.locator('#proximoPasso')).to_have_value('Retomar após o processamento')
            expect(page.locator('[data-check="login"]')).to_be_checked()
            # A troca de registro salva o ponto atual antes de abrir o próximo.
            page.locator('#status').select_option('pendencia')
            page.locator('#pendencia').fill('Acesso 403: verificar instruções atuais')
            page.locator('#nova').click()
            expect(page.locator('#titulo')).to_have_value('')
            page.locator('#descartar').click()
            page.locator('#filtro').select_option('pendencia')
            expect(page.locator('#lista-tarefas button')).to_have_count(1)
            page.locator('#lista-tarefas button').click()
            expect(page.locator('#pendencia')).to_have_value('Acesso 403: verificar instruções atuais')
            with page.expect_download() as download:
                page.locator('#exportar').click()
            exportado=json.loads(pathlib.Path(download.value.path()).read_text())
            assert exportado['tarefas'][0]['status']=='pendencia'
            t=exportado['tarefas'][0]
            r=page.request.put(base+'/api/avaliacoes/operacao/'+t['id'],data={**t,'versao':1})
            assert r.status==409
            page.set_viewport_size({'width':390,'height':844})
            assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
            assert not erros,erros
            assert all('/api/avaliacoes/operacao' in u for u in chamadas),chamadas
            browser.close()
        print('PASS: organizador manual cria, salva, retoma, filtra, exporta e preserva conflito; sem pedidos a modelos.')
    finally:
        proc.terminate();proc.wait(timeout=20)
