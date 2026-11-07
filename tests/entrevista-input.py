"""Executa as rotinas reais de PowerShell com SendInput substituído por um coletor.
Não envia nenhuma tecla à área de trabalho do usuário.
"""
import json, pathlib, subprocess, tempfile

root = pathlib.Path(__file__).resolve().parents[1]
source = (root / 'electron' / 'entrevista-input.ps1').read_text(encoding='utf-8')
declaration = '[DllImport("user32.dll",SetLastError=true)] public static extern uint SendInput(uint count,INPUT[] inputs,int size);'
assert source.count(declaration) == 1
collector = '''public static uint SendInput(uint count,INPUT[] inputs,int size) {
 Console.WriteLine("AT|"+DateTime.UtcNow.Ticks);
 foreach(INPUT input in inputs)Console.WriteLine("KEY|"+input.u.ki.vk+"|"+input.u.ki.scan+"|"+input.u.ki.flags);
 return count;
}'''
guard = 'if($a.tipo -in @(\'clicar\',\'digitar\',\'codigo\',\'tecla\',\'rolar\')) { [NectarInput]::AssertBrowser($a.tipo,$a.px,$a.py) }'
assert source.count(guard) == 1
# A proteção de foco é compilada, mas não consulta a janela real neste teste.
isolated = source.replace(declaration, collector).replace(guard, '# Teste isolado sem consulta ao foco da área de trabalho')
with tempfile.TemporaryDirectory(prefix='nectar-input-') as temp:
    script = pathlib.Path(temp) / 'input.ps1'
    script.write_text(isolated, encoding='utf-8-sig')
    def executar(acao):
        assert acao['tipo'] in ('digitar', 'codigo', 'tecla')
        p = subprocess.run(['powershell.exe', '-NoProfile', '-NonInteractive', '-File', str(script)], input=json.dumps(acao), capture_output=True, text=True, timeout=20, creationflags=subprocess.CREATE_NO_WINDOW)
        assert p.returncode == 0, p.stderr
        if acao['tipo'] == 'digitar':
            tempos = [int(line.split('|')[1]) for line in p.stdout.splitlines() if line.startswith('AT|')]
            assert tempos[-1] - tempos[0] >= 2_000_000, 'Os caracteres devem aparecer ao longo do tempo, não em um bloco instantâneo'
        return [tuple(map(int, line.split('|')[1:])) for line in p.stdout.splitlines() if line.startswith('KEY|')]
    texto = 'Olá 😀'
    eventos = executar({'tipo': 'digitar', 'texto': texto})
    units = texto.encode('utf-16-le')
    expected = [int.from_bytes(units[i:i+2], 'little') for i in range(0, len(units), 2)]
    assert [scan for vk, scan, flags in eventos if flags == 4] == expected
    codigo = executar({'tipo': 'codigo', 'texto': 'if (x) {\r\n\treturn 42;\r\n}'})
    assert sum(1 for vk, scan, flags in codigo if vk == 13 and flags == 0) == 2
    digitado = ''.join(chr(scan) for vk, scan, flags in codigo if flags == 4)
    assert digitado == 'if (x) {    return 42;}'
    assert not any(vk == 8 for vk, scan, flags in codigo)
    assert executar({'tipo': 'tecla', 'tecla': 'CTRL+A'}) == [(17, 0, 0), (65, 0, 0), (65, 0, 2), (17, 0, 2)]
    # A proteção real consulta apenas janelas; um ponto fora da tela nunca envia entradas.
    guard_test = isolated + '''
try {
 [NectarInput]::AssertBrowser('clicar',[Int32]::MinValue,[Int32]::MinValue)
 throw 'Clique fora da tela não foi bloqueado'
} catch {
 if($_.Exception.ToString() -notmatch 'NECTAR_BROWSER_(FOCUS|TARGET)'){throw}
 Write-Output 'BROWSER_GUARD_OK'
}
'''
    script.write_text(guard_test, encoding='utf-8-sig')
    p = subprocess.run(['powershell.exe', '-NoProfile', '-NonInteractive', '-File', str(script)], input='{"tipo":"aguardar"}', capture_output=True, text=True, timeout=20, creationflags=subprocess.CREATE_NO_WINDOW)
    assert p.returncode == 0 and 'BROWSER_GUARD_OK' in p.stdout, p.stderr
print('PASS: Windows PowerShell executou digitar, codigo multilinha Unicode e atalho; eventos coletados sem injetar teclas reais.')
