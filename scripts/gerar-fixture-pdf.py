"""Gera o documento sintético usado nos testes. Requer reportlab instalado."""
from pathlib import Path
from reportlab.pdfgen.canvas import Canvas

destino=Path(__file__).resolve().parents[1]/'tests'/'fixtures'/'amostra.pdf'
canvas=Canvas(str(destino),pagesize=(595,842),invariant=True)
canvas.setTitle('NECTAR PDF test fixture')
canvas.setAuthor('NECTAR test suite')
for pagina in range(1,3):
    canvas.setFont('Helvetica',18)
    canvas.drawString(50,780,'NECTAR PDF test fixture')
    canvas.setFont('Helvetica',12)
    canvas.drawString(50,740,f'Synthetic page {pagina}. No personal or third-party project data.')
    canvas.drawString(50,710,'This document exists only to validate text extraction and uploads.')
    canvas.showPage()
canvas.save()
print(destino.name)
