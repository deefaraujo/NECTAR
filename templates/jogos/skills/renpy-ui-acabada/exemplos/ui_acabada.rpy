# UI com acabamento de produto em Ren'Py 8.5 usando um kit de UI de terceiros (Kenney UI Pack, CC0):
# botão com 9 fatias e estados, janela de diálogo com moldura, barra deslizante, caixa de marcar, título com fonte do kit,
# tudo escalado por gui e com alvo de toque grande. Passou no lint e no teste automático (testes_ui.rpy).
# Arquivos esperados em game/images/ui/ (copiados do kit): botao_idle.png, botao_hover.png, botao_apertado.png,
# painel.png, barra_fundo.png, barra_cheia.png, check_off.png, check_on.png, estrela.png; fonte em game/fonts/kenney_future.ttf.

# ── Moldura de 9 fatias: a imagem estica só o meio, cantos ficam intactos ─────
define ui_borda = Borders(16, 16, 16, 16)
image ui_painel = Frame("images/ui/painel.png", ui_borda)
image ui_botao_idle = Frame("images/ui/botao_idle.png", ui_borda)
image ui_botao_hover = Frame("images/ui/botao_hover.png", ui_borda)
image ui_botao_apertado = Frame("images/ui/botao_apertado.png", ui_borda)
define ui_fonte = "fonts/kenney_future.ttf"

# ── Estilos: um botão de produto tem idle, hover, pressionado e desabilitado ──
style botao_kit is button:
    background "ui_botao_idle"
    hover_background "ui_botao_hover"
    selected_background "ui_botao_apertado"
    insensitive_background At("ui_botao_idle", desbotado)
    padding (36, 18)
    xminimum 220
    yminimum 96

style botao_kit_text is button_text:
    font ui_fonte
    size 30
    color "#2d3a4a"
    hover_color "#0f1a26"
    insensitive_color "#2d3a4a66"
    xalign 0.5
    yalign 0.5

style painel_kit is frame:
    background "ui_painel"
    padding (32, 28)

transform desbotado:
    alpha 0.45

transform toque_apertado:
    # retorno tátil: encolhe um pouco ao tocar e volta
    on hover:
        linear 0.08 zoom 1.03
    on idle:
        linear 0.08 zoom 1.0
    on selected_hover, selected_idle:
        zoom 0.97

# ── Barra e caixa de marcar com imagens do kit ───────────────────────────────
style barra_kit is bar:
    left_bar Frame("images/ui/barra_cheia.png", 12, 12)
    right_bar Frame("images/ui/barra_fundo.png", 12, 12)
    thumb None
    ysize 36

default volume_demo = 0.7
default vibrar = True

# ── Tela de opções com o kit ──────────────────────────────────────────────────
screen opcoes_kit():
    tag menu
    modal True
    add "#0e1420cc"
    frame:
        style "painel_kit"
        xalign 0.5 yalign 0.5
        xsize 0.75
        vbox:
            spacing 24
            text "Opções" font ui_fonte size 44 color "#2d3a4a" xalign 0.5
            hbox:
                spacing 20
                yalign 0.5
                text "Música" font ui_fonte size 28 color "#2d3a4a" yalign 0.5 xminimum 160
                bar value FieldValue(store, "volume_demo", range=1.0, style="barra_kit") xsize 0.55 yalign 0.5
            hbox:
                spacing 20
                text "Vibrar ao tocar" font ui_fonte size 28 color "#2d3a4a" yalign 0.5 xminimum 320
                imagebutton:
                    idle "images/ui/check_off.png"
                    selected_idle "images/ui/check_on.png"
                    selected vibrar
                    action ToggleVariable("vibrar")
                    xysize (64, 64)
                    yalign 0.5
            hbox:
                spacing 24
                xalign 0.5
                textbutton "Aplicar" style "botao_kit" action Return(True) at toque_apertado
                textbutton "Cancelar" style "botao_kit" action Return(False) at toque_apertado
                textbutton "Premium" style "botao_kit" action NullAction() sensitive False

# ── Janela de diálogo com moldura do kit e nome em destaque ──────────────────
screen say_kit(who, what):
    style_prefix "say"
    window:
        id "window"
        background Frame("images/ui/painel.png", ui_borda)
        xalign 0.5 yalign 0.98
        xsize 0.92
        padding (40, 24)
        vbox:
            spacing 6
            if who is not None:
                hbox:
                    spacing 10
                    add "images/ui/estrela.png" xysize (28, 28) yalign 0.5
                    text who font ui_fonte size 30 color "#1c5a8a"
            text what id "what"   # o estilo vem do Character (what_style); say_dialogue do gui tem xpos/ypos fixos

style fala_kit is default:
    size 30
    color "#2d3a4a"
    xfill True

# what_style vence o style escrito na screen: o Character aplica o estilo do texto com id "what".
define kit = Character("Kit", screen="say_kit", what_style="fala_kit")

label demo_ui:
    scene expression Solid("#5b7fa6") as fundo
    kit "Janela de diálogo com moldura de 9 fatias e nome com ícone."
    call screen opcoes_kit
    if _return:
        $ musica_pct = int(volume_demo * 100)
        kit "Aplicou: música em [musica_pct]%%, vibrar [vibrar]."   # numa fala com [interpolação], % literal é %%
    else:
        kit "Cancelou."
    return
