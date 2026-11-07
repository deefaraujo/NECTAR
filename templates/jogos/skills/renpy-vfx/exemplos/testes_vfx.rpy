testsuite vfx:
    setup:
        skip until screen "main_menu"
    before testcase:
        if not screen "main_menu":
            run MainMenu(confirm=False)
        click "Start"
    teardown:
        exit

    testcase demo:
        run Jump("demo_vfx")
        advance until "Neve caindo"
        pause 1.5
        screenshot "vfx_neve.png"
        advance until "Pétalas atravessando"
        advance until "Aura azul"
        pause 0.8
        screenshot "vfx_aura.png"
        advance until "Flash branco"
        advance until "Chuva com vinheta"
        pause 1.2
        screenshot "vfx_chuva.png"
        advance until "Título com easeout_back"
        pause 0.7
        screenshot "vfx_titulo.png"
        advance until "Poeira subindo"
        pause 1.0
        screenshot "vfx_poeira.png"
