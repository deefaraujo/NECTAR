"""Abre o Electron empacotado com dados isolados e sem usar modelos."""
import json, os, pathlib, socket, subprocess, tempfile, time, urllib.request
from playwright.sync_api import sync_playwright, expect

root = pathlib.Path(__file__).resolve().parents[1]
with tempfile.TemporaryDirectory(prefix='work-ia-package-') as temp:
    tmp = pathlib.Path(temp)
    data = tmp / 'user' / 'data'; data.mkdir(parents=True)
    (data / 'settings.json').write_text(json.dumps({'piloto': {'ativo': False}, 'relatorio': {'ativo': False}}))
    target = tmp / 'alvo'; target.mkdir()
    with socket.socket() as s:
        s.bind(('127.0.0.1', 0)); port = s.getsockname()[1]
    env = {**os.environ, 'STUDIO_FAKE': '1', 'STUDIO_USERDATA': str(tmp / 'user'), 'STUDIO_PROJETOS': str(tmp / 'projetos')}
    env.pop('ELECTRON_RUN_AS_NODE', None)
    package_dir = pathlib.Path(os.environ.get('NECTAR_PACK_DIR', str(root / 'dist')))
    proc = subprocess.Popen([str(package_dir / 'win-unpacked' / 'NECTAR.exe'), '--remote-debugging-port=' + str(port)], cwd=root, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, creationflags=subprocess.CREATE_NO_WINDOW)
    try:
        for _ in range(80):
            try:
                urllib.request.urlopen(f'http://127.0.0.1:{port}/json/version', timeout=.5)
                break
            except Exception:
                time.sleep(.25)
        with sync_playwright() as pw:
            browser = pw.chromium.connect_over_cdp(f'http://127.0.0.1:{port}')
            context = browser.contexts[0]
            page = context.pages[0] if context.pages else context.wait_for_event('page', timeout=30000)
            page.wait_for_url('http://127.0.0.1:*', timeout=20000)
            response = page.request.post(page.url.rstrip('/') + '/api/projetos', data={'nome': 'Pacote validado', 'caminho': str(target), 'template': 'software'})
            assert response.ok, response.text()
            page.reload()
            expect(page.locator('[data-uso-motor="codex"]')).to_be_visible()
            page.locator('.eu').click()
            expect(page.locator('#pf-nome')).to_be_visible()
            page.goto(page.url.split('/')[0] + '//' + page.url.split('/')[2] + '/entrevista.html')
            page.locator('#arquivo').set_input_files(str(root / 'tests' / 'fixtures' / 'amostra.pdf'))
            expect(page.locator('#estado')).to_contain_text('Currículo carregado:', timeout=60000)
            assert 'NECTAR PDF test fixture' in page.locator('#cv').input_value()
            helper = tmp / 'window-test.ps1'
            helper.write_text('''param([int]$TargetPid,[int]$WindowState)
Add-Type -TypeDefinition 'using System;using System.Runtime.InteropServices;public class NectarTestWindow{[DllImport("user32.dll")]public static extern bool ShowWindow(IntPtr h,int n);[DllImport("user32.dll")]public static extern bool IsIconic(IntPtr h);}'
$p=[Diagnostics.Process]::GetProcessById($TargetPid)
$p.Refresh()
if($p.MainWindowHandle -eq [IntPtr]::Zero){throw 'Janela de teste ausente'}
[void][NectarTestWindow]::ShowWindow($p.MainWindowHandle,$WindowState)
if($WindowState -eq 6 -and -not [NectarTestWindow]::IsIconic($p.MainWindowHandle)){throw 'A janela de teste não foi minimizada'}
''', encoding='utf-8')
            def mostrar_janela(estado):
                subprocess.run(['powershell.exe', '-NoProfile', '-NonInteractive', '-File', str(helper), str(proc.pid), str(estado)], check=True, capture_output=True, creationflags=subprocess.CREATE_NO_WINDOW)
            page.evaluate('window.ticksTeste=0; window.timerTeste=setInterval(()=>window.ticksTeste++,100)')
            mostrar_janela(6)
            page.evaluate('window.ticksTeste=0')
            page.wait_for_function('() => window.ticksTeste >= 5', polling=100, timeout=3000)
            page.evaluate('clearInterval(window.timerTeste)')
            mostrar_janela(9)
            print('PASS: processamento da página continua com a janela minimizada.')
            print('PASS: currículo PDF extraído e exibido no laboratório do aplicativo empacotado.')
            fonte = page.evaluate("async () => (await studioApp.fontesTela()).find(f => f.tipo === 'tela')?.id")
            assert fonte, 'Nenhuma tela disponível para validar a contagem'
            preparo = page.evaluate('(id) => studioApp.entrevistaArmar(id)', fonte)
            assert preparo['inicioEm'] > 0
            page.evaluate("window.paradasRecebidas=[]; window.removerListenerTeste=studioApp.aoPararEntrevista(m=>window.paradasRecebidas.push(m))")
            preparo = page.evaluate('(id) => studioApp.entrevistaArmar(id)', fonte)
            assert page.evaluate('paradasRecebidas.length') == 0, 'Rearmar não deve cancelar a nova execução'
            assert len(context.pages) == 1, 'O agente não deve abrir indicadores ou janelas extras'
            erro = page.evaluate("async () => { try { await studioApp.entrevistaAcao({tipo:'aguardar'}); return ''; } catch(e) { return e.message; } }")
            assert 'cinco segundos' in erro
            page.wait_for_function('(inicio) => Date.now() >= inicio', arg=preparo['inicioEm'], polling=100, timeout=8000)
            assert page.evaluate("() => studioApp.entrevistaAcao({tipo:'aguardar'})")
            page.evaluate("() => studioApp.entrevistaParar('Motivo da parada de teste')")
            assert len(context.pages) == 1
            erro = page.evaluate("async () => { try { await studioApp.entrevistaAcao({tipo:'aguardar'}); return ''; } catch(e) { return e.message; } }")
            assert 'Controle parado' in erro
            page.evaluate('() => studioApp.entrevistaParar()')
            print('PASS: preparação de cinco segundos, controle e parada sem indicadores nem janelas extras (sem mover mouse/teclado).')
            base_url = page.url.split('/')[0] + '//' + page.url.split('/')[2]
            page.goto(base_url + '/avaliacoes.html')
            expect(page.locator('h1')).to_have_text('Tarefas de avaliação')
            page.locator('#nova').click()
            page.locator('#titulo').fill('Registro operacional do pacote')
            page.locator('#proximoPasso').fill('Retomar o trabalho manual')
            page.locator('button[type="submit"]').click()
            expect(page.locator('#estado')).to_contain_text('Checkpoint salvo')
            page.reload()
            page.locator('#lista-tarefas button').click()
            expect(page.locator('#proximoPasso')).to_have_value('Retomar o trabalho manual')
            print('PASS: organizador manual carregou e preservou o checkpoint no aplicativo empacotado.')
            print('PASS: Electron empacotado abriu, servidor respondeu, template software carregou e controles de uso/perfil apareceram.')
    finally:
        subprocess.run(['taskkill', '/PID', str(proc.pid), '/T', '/F'], capture_output=True)
        proc.wait(timeout=15)
