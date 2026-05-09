!macro customWelcomePage
  !insertmacro MUI_PAGE_WELCOME
  !insertmacro MUI_PAGE_LICENSE "${BUILD_RESOURCES_DIR}\CONTRATO_LICENCA.txt"
  !insertmacro MUI_PAGE_LICENSE "${BUILD_RESOURCES_DIR}\TERMOS_DE_USO.txt"
  !insertmacro MUI_PAGE_LICENSE "${BUILD_RESOURCES_DIR}\POLITICA_PRIVACIDADE.txt"
!macroend

!macro customInit
  DetailPrint "Preparando atualizacao limpa do Kwanza Folha..."

  ; Remove apenas artefactos empacotados. Dados do cliente ficam em LocalAppData\KwanzaFolha.
  RMDir /r "$PROGRAMFILES64\Kwanza Folha\resources\app.asar.unpacked"
  RMDir /r "$PROGRAMFILES\Kwanza Folha\resources\app.asar.unpacked"
  RMDir /r "$LOCALAPPDATA\Programs\Kwanza Folha\resources\app.asar.unpacked"

  Delete "$PROGRAMFILES64\Kwanza Folha\resources\app.asar"
  Delete "$PROGRAMFILES\Kwanza Folha\resources\app.asar"
  Delete "$LOCALAPPDATA\Programs\Kwanza Folha\resources\app.asar"
!macroend

!macro customInstall
  DetailPrint "Kwanza Folha instalado com runtime Electron atualizado."
!macroend
