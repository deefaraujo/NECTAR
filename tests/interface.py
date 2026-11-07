"""Verifica a interface com dados isolados e sem chamadas de modelo."""
import base64, json, os, pathlib, subprocess, tempfile, urllib.request, time
from playwright.sync_api import sync_playwright, expect

ROOT = pathlib.Path(__file__).resolve().parents[1]
with tempfile.TemporaryDirectory(prefix='work-ia-ui-') as temp:
    tmp = pathlib.Path(temp)
    data = tmp / 'data'; data.mkdir()
    (data / 'settings.json').write_text(json.dumps({'piloto': {'ativo': False}, 'relatorio': {'ativo': False}, 'ciclo': {'revisaoAuto': False, 'curadoriaAuto': False, 'statusPO': False, 'versionar': False, 'posts': False}}))
    usage = {'em': '2026-10-30T09:00:00Z', 'cinco': {'pct': 30}, 'sete': {'pct': 34}}
    (data / 'uso.json').write_text(json.dumps({'atual': usage, 'codex': {**usage, 'cinco': {'pct': 15, 'minutos': 300}, 'sete': {'pct': 42, 'minutos': 10080}}, 'pausa': {}, 'avisos': {}, 'gasto': {}}))
    target = tmp / 'alvo'; target.mkdir()
    env = {**os.environ, 'STUDIO_DATA': str(data), 'STUDIO_PROJETOS': str(tmp / 'projetos'), 'STUDIO_FAKE': '1', 'STUDIO_FAKE_USO': '0.30,0.34', 'STUDIO_PORT': '0'}
    proc = subprocess.Popen(['node', 'server.mjs'], cwd=ROOT, env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, creationflags=subprocess.CREATE_NO_WINDOW)
    try:
        url = proc.stdout.readline().split('http://localhost:')[1].split()[0]
        base = 'http://127.0.0.1:' + url
        def request(route, body=None, method=None):
            req = urllib.request.Request(base + route, data=json.dumps(body).encode() if body is not None else None, headers={'Content-Type': 'application/json'}, method=method)
            return json.loads(urllib.request.urlopen(req).read())
        p = request('/api/projetos', {'nome': 'Projeto de teste', 'caminho': str(target), 'template': 'software'})['projeto']
        pid = p['id']
        card = request(f'/api/p/{pid}/cartao', {'titulo': 'Contrato da API', 'descricao': 'Validar contrato e falhas.', 'dono': 'backend', 'coluna': 'pronto', 'aceite': ['Contrato validado'], 'validacoesObrigatorias': ['teste simulado']})['card']
        dependent = request(f'/api/p/{pid}/cartao', {'titulo': 'Consumir contrato', 'dono': 'frontend', 'dependeDe': [card['id']], 'coluna': 'pronto'})['card']
        request(f'/api/p/{pid}/cartao/{card["id"]}/workflow', {'acao': 'checkpoint', 'dados': {'resumo': 'Contrato inspecionado', 'proximoPasso': 'Implementar tratamento de erro', 'branch': 'T-001-contrato'}}, 'POST')
        request(f'/api/p/{pid}/decisoes', {'id': 'escopo-teste', 'tipo': 'humana', 'contexto': 'Escolha de escopo', 'cards': [card['id']], 'opcoes': [{'id': 'a', 'texto': 'Escopo A', 'consequencia': 'Menos prazo'}, {'id': 'b', 'texto': 'Escopo B', 'consequencia': 'Mais prazo'}]})
        request(f'/api/p/{pid}/regras-equipe', {'id': 'conferir-testes', 'escopo': 'todos', 'texto': 'Conferir testes antes de revisar.', 'motivo': 'Evitar regressões', 'origem': 'T-001'}, 'PUT')
        with sync_playwright() as pw:
            browser = pw.chromium.launch(headless=True, channel='msedge')
            page = browser.new_page(viewport={'width': 1480, 'height': 920})
            page.add_init_script("localStorage.setItem('nectar:idioma', 'pt-BR')")  # os seletores destes testes estão em português
            errors = []
            page.on('pageerror', lambda e: errors.append(str(e)))
            page.goto(base)
            expect(page.locator('[data-uso-motor="claude"]')).to_be_visible()
            page.evaluate('(id) => abrirIssue(id)', card['id'])
            expect(page.locator('.workflow-card')).to_contain_text('Contrato inspecionado')
            expect(page.locator('.workflow-card')).to_contain_text('Implementar tratamento de erro')
            page.request.post(f'{base}/api/p/{pid}/cartao/{card["id"]}/bloquear', data={'motivo': 'Bloqueio de teste'})
            expect(page.locator('#i-bloqueio')).to_be_visible()
            page.locator('[data-campo="descricao"]').fill('Rascunho que deve ser preservado')
            page.request.post(f'{base}/api/p/{pid}/cartao/{card["id"]}/desbloquear', data={})
            expect(page.locator('#i-bloqueio')).to_be_hidden()
            expect(page.locator('.issue-topo .loz.bloq')).to_have_count(0)
            assert page.locator('[data-campo="descricao"]').input_value() == 'Rascunho que deve ser preservado'
            page.locator('.workflow-card [data-acao="decisoes"]').click()
            expect(page.locator('#modal')).to_contain_text('Escolha de escopo')
            page.locator('[data-acao="aceitar-decisao"][data-opcao="a"]').click()
            expect(page.locator('#modal')).to_contain_text('escolhida')
            assert request(f'/api/p/{pid}/decisoes')['decisoes'][0]['escolha'] == 'a'
            page.locator('[data-acao="editar-decisao"][data-decisao="escopo-teste"]').click()
            page.locator('#dc-contexto').fill('Escopo revisado pela pessoa responsável')
            page.locator('[data-acao="salvar-decisao"]').click()
            expect(page.locator('#modal')).to_contain_text('r2')
            assert page.request.post(f'{base}/api/p/{pid}/decisoes/escopo-teste/aceitar', data={'revisao': 1, 'opcao': 'a'}).status == 400
            page.locator('#modal [data-acao="fechar"]').click()
            page.evaluate('(id) => abrirIssue(id)', card['id'])
            report = page.request.post(f'{base}/api/p/{pid}/mensagem', data={'canal': 'dm:backend', 'texto': f'{card["id"]} [teste:entrega-min]', 'engine': 'claude', 'modo': 'trabalhar'})
            assert report.ok, report.text()
            for _ in range(200):
                current = next(c for c in request(f'/api/p/{pid}/estado')['cartoes'] if c['id'] == card['id'])
                if current.get('workflow', {}).get('entregas') and any(v['status'] == 'aprovado' for v in current['workflow']['verificacoes']):
                    break
                time.sleep(.05)
            assert current['workflow']['revisao'] == 1, current
            # Entregas ficam no histórico; o produto gera um relatório baixável ao concluir.
            assert not request(f'/api/p/{pid}/estado')['cartoes'][0].get('relatorios')
            for acao, dados in [('revisao', {'status': 'aprovado'}), ('documentacao', {'status': 'sem_alteracao'}), ('qa', {'status': 'aprovado'})]:
                result = page.request.post(f'{base}/api/p/{pid}/cartao/{card["id"]}/workflow', data={'acao': acao, 'dados': {'revisao': 1, 'evidencia': 'SIMULADO: teste da interface', **dados}})
                assert result.ok, {'acao': acao, 'error': result.text(), 'workflow': request(f'/api/p/{pid}/estado')['cartoes'][0].get('workflow')}
            page.request.patch(f'{base}/api/p/{pid}/cartao/{card["id"]}', data={'campos': {'aceiteOk': [0]}})
            result = page.request.post(f'{base}/api/p/{pid}/cartao/{card["id"]}/mover', data={'coluna': 'concluido'})
            assert result.ok, result.text()
            final_report = page.locator('.workflow-card a[download]').filter(has_text='final-r1.md')
            expect(final_report).to_have_count(1)
            with page.expect_download() as info:
                final_report.click()
            downloaded = pathlib.Path(info.value.path()).read_text(encoding='utf-8')
            assert card['id'] in downloaded and 'Entrega mínima' in downloaded
            page.evaluate('(id) => abrirIssue(id)', dependent['id'])
            expect(page.locator('[data-dependencias]')).to_have_value(card['id'])
            page.locator('#modal [data-acao="fechar"]').click()
            # Estado canônico, lista longa, download e reconciliação de SSE.
            teamwork = request(f'/api/p/{pid}/teamwork')
            task_count = len(teamwork['tasks'])
            pasta_projeto = request(f'/api/p/{pid}/estado')['pastaProjeto']
            subprocess.run(['node', str(ROOT / 'tests/fixtures/teamwork-seed.mjs'), pasta_projeto, teamwork['workspaceId'], pid], cwd=ROOT, env=env, check=True, capture_output=True)
            page.evaluate('irPara("planner")')
            page.locator('[data-acao="teamwork"]').click()
            expect(page.locator('.teamwork-task')).to_have_count(task_count + 20)
            for width, height in [(1480, 920), (1024, 720)]:
                page.set_viewport_size({'width': width, 'height': height})
                page.locator('.teamwork-task').last.scroll_into_view_if_needed()
                expect(page.locator('.teamwork-task').last).to_be_visible()
                assert page.locator('.teamwork-list').evaluate('(e) => e.scrollHeight > e.clientHeight')
                out = ROOT / 'tests/artifacts'; out.mkdir(exist_ok=True)
                page.screenshot(path=str(out / f'teamwork-{width}.png'))
            page.set_viewport_size({'width': 1480, 'height': 920})
            with page.expect_download() as info:
                page.locator('.teamwork-task a[download]').first.click()
            assert pathlib.Path(info.value.path()).read_text(encoding='utf-8')
            page.locator('#modal [data-acao="fechar"]').click()
            page.context.set_offline(True)
            subprocess.run(['node', str(ROOT / 'tests/fixtures/teamwork-seed.mjs'), pasta_projeto, teamwork['workspaceId'], pid, '1', 'reconnect'], cwd=ROOT, env=env, check=True, capture_output=True)
            page.wait_for_timeout(1000)
            page.context.set_offline(False)
            page.wait_for_function('(n) => J().teamwork?.tasks?.length === n', arg=task_count + 21, timeout=20000)
            page.evaluate('irPara("chat")')
            expect(page.locator('.uso')).to_contain_text('30%')
            page.locator('[data-uso-motor="codex"]').click()
            expect(page.locator('.uso')).to_contain_text('15%')
            expect(page.locator('.uso')).to_contain_text('42%')
            page.locator('[data-acao="relatorio-creditos"]').click()
            expect(page.locator('.creditos-relatorio')).to_contain_text('codex')
            expect(page.locator('.creditos-relatorio')).to_contain_text('Histórico de consumo')
            page.locator('#modal [data-acao="fechar"]').click()
            page.locator('.eu').click()
            page.locator('#pf-nome').fill('João Silva')
            page.locator('[data-acao="ped-salvar"]').click()
            expect(page.locator('.eu b')).to_have_text('João Silva')
            image = tmp / 'foto.png'
            image.write_bytes(base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aV1kAAAAASUVORK5CYII='))
            page.locator('input[data-recorte="foto"]').set_input_files(str(image))
            page.locator('[data-acao="recorte-aplicar"]').click()
            expect(page.locator('.eu img')).to_be_visible()
            page.reload()
            expect(page.locator('.eu b')).to_have_text('João Silva')
            expect(page.locator('.eu img')).to_be_visible()
            page.locator('[data-acao="ajustes"]').first.click()
            page.locator('[data-aj="projeto"]').click()
            page.locator('[data-acao="regras-equipe"]').click()
            expect(page.locator('#modal')).to_contain_text('Conferir testes antes de revisar.')
            page.locator('[data-acao="revogar-regra"]').click()
            expect(page.locator('#modal')).to_be_hidden()
            assert request(f'/api/p/{pid}/regras-equipe')['regras'][0]['ativa'] is False
            page.locator('[data-uso-motor="codex"]').click()
            out = ROOT / 'tests' / 'artifacts'; out.mkdir(exist_ok=True)
            page.screenshot(path=str(out / 'uso-codex-perfil.png'))
            assert not errors, errors
            browser.close()
        print('PASS: workflow e checkpoints, dependências bloqueadas, decisões escolhidas/revisionadas pela interface, abas Claude/Codex, relatório, nome/foto persistentes e regras revogáveis; sem erros JavaScript.')
    finally:
        proc.terminate()
        proc.wait(timeout=15)
