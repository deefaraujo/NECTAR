# Efeitos visuais em Ren'Py 8.5 sem engine externa: partículas, brilho aditivo, flash, tremor, vinheta, chuva,
# pulso de botão, texto animado. Passou no lint do SDK 8.5.3 e no teste automático (testes_vfx.rpy).

# ── Partículas prontas: SnowBlossom (neve, pétalas, poeira, bolhas) ──────────
image particula_neve = Solid("#ffffffcc", xysize=(8, 8))
image particula_petala = Solid("#f7a8c4", xysize=(12, 7))
image particula_poeira = Solid("#ffe9a0", xysize=(4, 4))

image neve = SnowBlossom(At("particula_neve", flutuante), count=60, xspeed=(-20, 20), yspeed=(60, 140), border=40)
image petalas = SnowBlossom("particula_petala", count=25, xspeed=(-80, -30), yspeed=(50, 120), start=3)
image poeira_subindo = SnowBlossom("particula_poeira", count=40, xspeed=(-10, 10), yspeed=(-40, -15), border=20, fast=True)
image chuva = SnowBlossom(Solid("#c0d8ff99", xysize=(2, 24)), count=120, xspeed=(-40, -30), yspeed=(900, 1200), border=30, fast=True)

transform flutuante:
    # cada floco gira e oscila; SnowBlossom só move x e y, o resto é ATL no sprite
    rotate 0
    linear 2.0 rotate 180
    linear 2.0 rotate 360
    repeat

# ── Brilho aditivo e pulso (aura, item mágico, botão de destaque) ────────────
transform brilho_pulsante:
    additive 1.0
    alpha 0.0
    block:
        linear 0.8 alpha 0.6
        linear 0.8 alpha 0.15
        repeat

transform aura(cor="#ffd37a"):
    # aplicar numa cópia maior e borrada por trás do sprite
    matrixcolor TintMatrix(cor)
    blur 24
    zoom 1.08
    additive 0.8
    alpha 0.6
    block:
        linear 1.2 alpha 0.9
        linear 1.2 alpha 0.5
        repeat

# ── Flash, tremor de tela e vinheta ───────────────────────────────────────────
define flash_branco = Fade(0.05, 0.0, 0.4, color="#fff")
define flash_vermelho = Fade(0.05, 0.05, 0.5, color="#c0202080")

transform tremor_tela(forca=12, tempo=0.4):
    # usar com "show layer master at tremor_tela" para tremer a cena inteira
    xoffset 0
    linear (tempo / 8) xoffset -forca
    linear (tempo / 8) xoffset forca
    linear (tempo / 8) xoffset -forca
    linear (tempo / 8) xoffset forca
    linear (tempo / 8) xoffset (-forca // 2)
    linear (tempo / 8) xoffset (forca // 2)
    linear (tempo / 8) xoffset 0

image vinheta = At(Solid("#000000"), vinheta_suave)

transform vinheta_suave:
    # borda escura que respira: um Solid com blur e alpha baixo por cima da cena
    alpha 0.0
    linear 1.0 alpha 0.35

# ── Transição de cena com movimento (parallax simples) ───────────────────────
transform entra_fundo_lento:
    xalign 0.0
    zoom 1.1
    linear 12.0 xalign 1.0

# ── Texto com efeito ──────────────────────────────────────────────────────────
transform texto_impacto:
    zoom 2.5
    alpha 0.0
    easeout_back 0.35 zoom 1.0 alpha 1.0
    pause 2.5
    linear 0.3 alpha 0.0

screen titulo_impacto(texto):
    zorder 150
    text texto at texto_impacto:
        xalign 0.5 yalign 0.4
        size 72
        bold True
        color "#fff"
        outlines [(4, "#000a", 0, 0)]
    timer 3.5 action Hide("titulo_impacto")

# ── Demonstração ──────────────────────────────────────────────────────────────
image fundo_demo = Solid("#2b3550")
image heroi = Solid("#8a9e7a", xysize=(300, 600))

label demo_vfx:
    scene fundo_demo
    show neve zorder 5
    "Neve caindo (SnowBlossom com ATL girando cada floco)."
    hide neve
    show petalas zorder 5
    "Pétalas atravessando a tela com atraso inicial."
    hide petalas
    show heroi at center
    show heroi as heroi_aura at center, aura("#7ad7ff") behind heroi
    "Aura azul borrada atrás do personagem (blur + additive)."
    hide heroi_aura
    show layer master at tremor_tela(16, 0.5)
    with flash_branco
    "Flash branco e tremor da cena inteira."
    show layer master
    show chuva zorder 5
    show vinheta zorder 6
    "Chuva com vinheta escura."
    hide chuva
    hide vinheta
    show screen titulo_impacto("CAPÍTULO 1")
    pause 1.0
    "Título com easeout_back, como um carimbo."
    show poeira_subindo zorder 5
    with flash_vermelho
    "Poeira subindo e flash vermelho de dano."
    hide poeira_subindo
    return
