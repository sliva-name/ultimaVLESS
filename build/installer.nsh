; Custom NSIS hooks — see https://www.electron.build/nsis#custom-nsis-script

!macro customWelcomePage
  !define MUI_WELCOMEPAGE_TITLE "Welcome to UltimaVLESS Setup"
  !define MUI_WELCOMEPAGE_TEXT "This wizard will install UltimaVLESS on your computer.$\r$\n$\r$\nUltimaVLESS is a desktop client for VLESS / VPN configuration.$\r$\n$\r$\nClick Next to continue."
  !insertmacro MUI_PAGE_WELCOME
!macroend
