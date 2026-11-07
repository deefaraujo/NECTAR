# Renderiza um PPTX em PNG por slide e em PDF usando o PowerPoint instalado (COM).
# Uso: powershell -NoProfile -ExecutionPolicy Bypass -File render-slides.ps1 -Pptx "C:\...\apresentacao.pptx" -Saida "C:\...\render"
# Imprime SLIDES=<n> e um caminho por linha, ou ERRO=<motivo>. Caminhos relativos são resolvidos a partir do diretório atual.
param(
  [Parameter(Mandatory = $true)][string]$Pptx,
  [string]$Saida = '',
  [int]$Largura = 1920
)
$ErrorActionPreference = 'Stop'
try {
  $Pptx = [System.IO.Path]::GetFullPath((Join-Path (Get-Location) $Pptx))
  if (-not (Test-Path $Pptx)) { Write-Output "ERRO=arquivo não existe: $Pptx"; exit 2 }
  if (-not $Saida) { $Saida = Join-Path (Split-Path $Pptx) 'render' }
  $Saida = [System.IO.Path]::GetFullPath((Join-Path (Get-Location) $Saida))
  New-Item -ItemType Directory -Force -Path $Saida | Out-Null
  try { $app = New-Object -ComObject PowerPoint.Application } catch { Write-Output 'ERRO=PowerPoint indisponível'; exit 3 }
  # abre sem janela (ReadOnly, sem título, sem janela)
  $pres = $app.Presentations.Open($Pptx, [Microsoft.Office.Core.MsoTriState]::msoTrue, [Microsoft.Office.Core.MsoTriState]::msoFalse, [Microsoft.Office.Core.MsoTriState]::msoFalse)
  $n = $pres.Slides.Count
  $altura = [int]($Largura * $pres.PageSetup.SlideHeight / $pres.PageSetup.SlideWidth)
  Write-Output "SLIDES=$n"
  for ($i = 1; $i -le $n; $i++) {
    $png = Join-Path $Saida ('slide-{0:d2}.png' -f $i)
    $pres.Slides.Item($i).Export($png, 'PNG', $Largura, $altura)
    Write-Output $png
  }
  $pdf = Join-Path $Saida ([System.IO.Path]::GetFileNameWithoutExtension($Pptx) + '.pdf')
  try { $pres.SaveAs($pdf, 32); Write-Output $pdf } catch { Write-Output "AVISO=PDF não exportado: $($_.Exception.Message)" }
  $pres.Close()
  $app.Quit()
  [System.Runtime.InteropServices.Marshal]::ReleaseComObject($app) | Out-Null
  exit 0
} catch {
  Write-Output "ERRO=$($_.Exception.Message)"
  try { if ($pres) { $pres.Close() }; if ($app) { $app.Quit() } } catch {}
  exit 1
}
