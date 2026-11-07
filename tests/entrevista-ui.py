"""Browser smoke test of the lab, with isolated data and no desktop control."""
import json, os, pathlib, subprocess, tempfile
from playwright.sync_api import sync_playwright, expect

root = pathlib.Path(__file__).resolve().parents[1]
with tempfile.TemporaryDirectory(prefix='nectar-entrevista-') as temp:
    data = pathlib.Path(temp) / 'data'
    data.mkdir()
    (data / 'settings.json').write_text(json.dumps({'piloto': {'ativo': False}}))
    env = {**os.environ, 'STUDIO_DATA': str(data), 'STUDIO_PROJETOS': str(pathlib.Path(temp) / 'projetos'), 'STUDIO_FAKE': '1', 'STUDIO_PORT': '0'}
    env.pop('NECTAR_VISAO_MODELO', None)
    proc = subprocess.Popen(['node', 'server.mjs'], cwd=root, env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, creationflags=subprocess.CREATE_NO_WINDOW)
    try:
        port = proc.stdout.readline().split('http://localhost:')[1].split()[0]
        base = 'http://127.0.0.1:' + port
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True, channel='msedge')
            page = browser.new_page(viewport={'width': 1366, 'height': 900})
            page.add_init_script("localStorage.setItem('nectar:idioma', 'pt-BR')")  # these tests' selectors are in Portuguese
            errors = []
            page.on('pageerror', lambda e: errors.append(str(e)))
            page.goto(base)
            expect(page.locator('a[href="/entrevista.html"]')).to_be_visible()
            page.locator('a[href="/entrevista.html"]').click()
            expect(page.locator('h1')).to_have_text('Agente de entrevista')
            expect(page.locator('#motor')).to_contain_text('Conecte Claude ou Codex')
            expect(page.locator('#modelo option[value="claude-opus-5-5"]')).to_have_count(1)
            expect(page.locator('#modelo option[value="gpt-6.1-sol"]')).to_have_count(1)
            expect(page.locator('#modelo option[value="auto"]')).to_have_text('Automático: Opus 5.5 / GPT-6.1')
            expect(page.locator('#modo')).to_have_value('programacao')
            expect(page.locator('#velocidade')).to_have_value('12')
            page.locator('#plataforma').select_option('leetcode')
            page.locator('#dificuldade').select_option('hard')
            page.locator('#linguagem').select_option('Python 3')
            expect(page.locator('#resultado-desafio')).to_contain_text('ainda não verificado')
            expect(page.locator('#iniciar')).to_be_disabled()
            assert '.pdf' in page.locator('#arquivo').get_attribute('accept')
            page.locator('#arquivo').set_input_files(str(root / 'tests' / 'fixtures' / 'amostra.pdf'))
            expect(page.locator('#estado')).to_contain_text('Currículo carregado:', timeout=60000)
            expect(page.locator('#cv')).to_have_value(__import__('re').compile('NECTAR PDF test fixture'))
            page.locator('#arquivo').set_input_files({'name': 'invalido.pdf', 'mimeType': 'application/pdf', 'buffer': b'arquivo invalido'})
            expect(page.locator('#estado')).to_contain_text('não é um PDF válido')
            expect(page.locator('#cv')).to_have_value('')
            page.locator('#cv').fill('Analista com experiência em sistemas.')
            with page.expect_download() as download:
                page.locator('#exportar').click()
            report = json.loads(pathlib.Path(download.value.path()).read_text())
            assert report['tipo'] == 'entrevista-experimental'
            response = page.request.post(base + '/api/entrevista/passo', data={'curriculo': 'Perfil', 'quadro': 'invalido'})
            assert response.status == 400
            assert 'Quadro inválido' in response.json()['erro']
            page.set_viewport_size({'width': 390, 'height': 844})
            assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
            # Simulated visual loop, with no model and no real keyboard input.
            page.add_init_script("""
              window.acoesDeTeste=[];
              window.studioApp={
                fontesTela:async()=>[{id:'tela-teste',tipo:'tela',nome:'Tela simulada'}],
                escolherTela:async()=>true,
                entrevistaArmar:async(id,opcoes)=>{window.opcoesDigitacao=opcoes;return {inicioEm:Date.now()+100};},
                entrevistaAcao:async a=>{window.acoesDeTeste.push(a);return true;},
                entrevistaParar:async()=>true,
                aoPararEntrevista:()=>()=>{}
              };
              Object.defineProperty(navigator.mediaDevices,'getDisplayMedia',{value:async()=>{
                const c=document.createElement('canvas');c.width=640;c.height=480;
                c.getContext('2d').fillRect(0,0,640,480);window.telaDeTeste=c;
                return c.captureStream(2);
              }});
            """)
            page.route('**/api/entrevista/status', lambda route: route.fulfill(json={'configurado': True, 'modelos': []}))
            def obs(etapa, veredito='nao_verificado'):
                return {'etapa': etapa, 'veredito': veredito, 'evidencia': 'Resultado simulado visível'}
            fila = [
                {'tipo': 'codigo', 'texto': 'def solve():\n    return 1\n', 'memoria': 'Assinatura solve; retornar 1', 'linguagem': {'selecionada': 'Python 3', 'confirmada': True, 'disponiveis': ['Python 3', 'C++17'], 'evidencia': 'Python 3 no seletor', 'motivo': 'Compatível com o perfil e o teste'}, 'observacao': obs('editar')},
                {'tipo': 'clicar', 'x': .5, 'y': .5, 'observacao': obs('executar')},
                {'tipo': 'aguardar', 'observacao': obs('verificar', 'exemplos_ok'), 'avaliacaoTeste': {'resultado': 'aprovado', 'comparacao': 'Retorno 1 igual ao esperado nos casos executados', 'evidencia': 'Todos os casos de Run passaram'}},
                {'tipo': 'clicar', 'x': .6, 'y': .5, 'observacao': obs('submeter')},
                {'tipo': 'aguardar', 'observacao': obs('verificar', 'aceito')},
                {'tipo': 'concluir', 'observacao': obs('finalizado', 'aceito')}
            ]
            passos = []
            tentativas = []
            def responder(route):
                b = route.request.post_data_json
                assert b['modo'] == 'programacao' and b['dificuldade'] == 'hard'
                tentativas.append(b)
                if len(tentativas) == 1:
                    route.fulfill(status=400, json={'erro': 'O modelo não informou a etapa e o resultado observável do desafio', 'recuperavel': True})
                    return
                if len(tentativas) == 2:
                    assert 'etapa' in b['feedback']
                if passos:
                    assert b['memoria'] == 'Assinatura solve; retornar 1'
                    assert b['linguagemObservada']['selecionada'] == 'Python 3'
                    assert all(e.get('executada') is True for e in b['historicoValidacao'])
                if len(passos) == 3:
                    assert b['historicoValidacao'][-1]['acao']['avaliacaoTeste']['resultado'] == 'aprovado'
                passos.append(b)
                route.fulfill(json={'acao': fila[len(passos)-1]})
            page.route('**/api/entrevista/passo', responder)
            page.reload()
            page.locator('#cv').fill('Analista Python')
            page.locator('#dificuldade').select_option('hard')
            page.locator('#compartilhar').click()
            page.locator('#fontes button').click()
            expect(page.locator('#iniciar')).to_be_enabled()
            page.locator('#iniciar').click()
            expect(page.locator('#estado')).to_contain_text('Conclusão indicada pelo agente', timeout=20000)
            assert len(passos) == 6
            assert len(tentativas) == 7
            assert page.evaluate('acoesDeTeste[0].tipo') == 'codigo'
            assert page.evaluate('opcoesDigitacao.caracteresPorSegundo') == 12
            with page.expect_download() as download:
                page.locator('#exportar').click()
            report = json.loads(pathlib.Path(download.value.path()).read_text())
            assert report['desafio']['dificuldade'] == 'hard'
            assert report['digitacao']['caracteresPorSegundo'] == 12
            assert report['linguagemObservada']['selecionada'] == 'Python 3'
            assert report['metricas']['execucoes'] == 1 and report['metricas']['submissoes'] == 1
            assert report['metricas']['veredito'] == 'aceito' and report['metricas']['duracaoMs'] > 0
            diagnostico = page.request.get(base + '/api/entrevista/diagnostico').json()
            assert diagnostico['motivo'] == 'Conclusão indicada pelo agente'
            assert 'curriculo' not in diagnostico and 'quadro' not in diagnostico
            rejeicoes = []
            def recusar(route):
                rejeicoes.append(route.request.post_data_json)
                route.fulfill(status=400, json={'erro': 'JSON inválido', 'recuperavel': True})
            page.route('**/api/entrevista/passo', recusar)
            page.reload()
            page.locator('#cv').fill('Analista Python')
            page.locator('#compartilhar').click()
            page.locator('#fontes button').click()
            expect(page.locator('#iniciar')).to_be_enabled()
            page.locator('#iniciar').click()
            expect(page.locator('#estado')).to_contain_text('3 análises consecutivas falharam', timeout=20000)
            assert len(rejeicoes) == 3
            assert page.evaluate('acoesDeTeste.length') == 0
            assert not errors, errors
            browser.close()
        print('Interview UI: configuration, PDF, API error and simulated programming loop with memory, run, submission, acceptance and metrics validated.')
    finally:
        proc.terminate()
        proc.wait(timeout=20)
