testsuite ui:
    setup:
        skip until screen "main_menu"
    before testcase:
        if not screen "main_menu":
            run MainMenu(confirm=False)
        click "Start"
    teardown:
        exit

    testcase opcoes:
        run Jump("demo_ui")
        advance until "Janela de diálogo com moldura"
        pause 0.3
        screenshot "ui_dialogo.png"
        advance until screen "opcoes_kit"
        pause 0.3
        screenshot "ui_opcoes.png"
        click "Aplicar"
        advance until "Aplicou"
        pause 0.3
        screenshot "ui_aplicou.png"
