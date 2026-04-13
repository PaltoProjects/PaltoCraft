; PaltoCraft NSIS Installer
; Modern UI 2 — выбор папки, лицензия, ярлыки

Unicode True

;--------------------------------
; Includes
!include "MUI2.nsh"
!include "LogicLib.nsh"

;--------------------------------
; Настройки приложения
!define APP_NAME        "PaltoCraft"
!define APP_VERSION     "1.0.2"
!define APP_PUBLISHER   "PaltoCraft"
!define APP_URL         "https://github.com/PaltoCraft/PaltoCraft"
!define APP_EXE         "PaltoCraft.exe"
!define APP_DIR         "dist\PaltoCraft-win32-x64"
!define REG_KEY         "Software\Microsoft\Windows\CurrentVersion\Uninstall\PaltoCraft"

;--------------------------------
; Основные настройки
Name "${APP_NAME} ${APP_VERSION}"
OutFile "dist\installer\PaltoCraft-Setup-${APP_VERSION}.exe"
InstallDir "$APPDATA\${APP_NAME}"
InstallDirRegKey HKCU "${REG_KEY}" "InstallLocation"
RequestExecutionLevel user
ShowInstDetails show
ShowUninstDetails show

;--------------------------------
; Настройки внешнего вида
!define MUI_ABORTWARNING
!define MUI_ICON "assets\icon.ico"
!define MUI_UNICON "assets\icon.ico"
!define MUI_WELCOMEFINISHPAGE_BITMAP "assets\installer-banner.bmp"
!define MUI_UNWELCOMEFINISHPAGE_BITMAP "assets\installer-banner.bmp"
!define MUI_HEADERIMAGE
!define MUI_HEADERIMAGE_BITMAP "assets\installer-icon.bmp"
!define MUI_HEADERIMAGE_RIGHT

; Цвета (тёмная тема не поддерживается нативно, но шрифты настраиваем)
!define MUI_WELCOMEPAGE_TITLE "Добро пожаловать в установщик ${APP_NAME}"
!define MUI_WELCOMEPAGE_TEXT "Этот мастер установит ${APP_NAME} ${APP_VERSION} на ваш компьютер.$\r$\n$\r$\nPaltoCraft — лаунчер Minecraft с официальной авторизацией Microsoft.$\r$\n$\r$\nНажмите «Далее» для продолжения."

!define MUI_FINISHPAGE_TITLE "Установка завершена!"
!define MUI_FINISHPAGE_TEXT "${APP_NAME} успешно установлен.$\r$\n$\r$\nНажмите «Готово» для запуска лаунчера."
!define MUI_FINISHPAGE_RUN "$INSTDIR\${APP_EXE}"
!define MUI_FINISHPAGE_RUN_TEXT "Запустить ${APP_NAME}"
!define MUI_FINISHPAGE_LINK "Перейти на GitHub"
!define MUI_FINISHPAGE_LINK_LOCATION "${APP_URL}"

!define MUI_LICENSEPAGE_CHECKBOX
!define MUI_LICENSEPAGE_CHECKBOX_TEXT "Я принимаю условия лицензионного соглашения"

;--------------------------------
; Страницы установщика
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_LICENSE "assets\license.txt"
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH

; Страницы удаления
!insertmacro MUI_UNPAGE_WELCOME
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_UNPAGE_FINISH

;--------------------------------
; Языки
!insertmacro MUI_LANGUAGE "Russian"
!insertmacro MUI_LANGUAGE "English"

;--------------------------------
; Установка
Section "PaltoCraft" SecMain
  SectionIn RO  ; обязательная секция

  SetOutPath "$INSTDIR"
  SetOverwrite on

  ; Копируем все файлы приложения
  File /r "${APP_DIR}\*.*"

  ; Записываем в реестр для удаления
  WriteRegStr HKCU "${REG_KEY}" "DisplayName"     "${APP_NAME}"
  WriteRegStr HKCU "${REG_KEY}" "DisplayVersion"  "${APP_VERSION}"
  WriteRegStr HKCU "${REG_KEY}" "Publisher"       "${APP_PUBLISHER}"
  WriteRegStr HKCU "${REG_KEY}" "URLInfoAbout"    "${APP_URL}"
  WriteRegStr HKCU "${REG_KEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "${REG_KEY}" "UninstallString" '"$INSTDIR\Uninstall.exe"'
  WriteRegStr HKCU "${REG_KEY}" "DisplayIcon"     "$INSTDIR\${APP_EXE}"
  WriteRegDWORD HKCU "${REG_KEY}" "NoModify"      1
  WriteRegDWORD HKCU "${REG_KEY}" "NoRepair"      1

  ; Создаём деинсталлятор
  WriteUninstaller "$INSTDIR\Uninstall.exe"


  ; Ярлык в меню Пуск
  CreateDirectory "$SMPROGRAMS\${APP_NAME}"
  CreateShortcut "$SMPROGRAMS\${APP_NAME}\${APP_NAME}.lnk" "$INSTDIR\${APP_EXE}" "" "$INSTDIR\${APP_EXE}"
  CreateShortcut "$SMPROGRAMS\${APP_NAME}\Удалить ${APP_NAME}.lnk" "$INSTDIR\Uninstall.exe"

SectionEnd

;--------------------------------
; Необязательные компоненты
Section "Ярлык на рабочем столе" SecDesktop
  CreateShortcut "$DESKTOP\${APP_NAME}.lnk" "$INSTDIR\${APP_EXE}" "" "$INSTDIR\${APP_EXE}"
SectionEnd


;--------------------------------
; Удаление
Section "Uninstall"
  ; Удаляем файлы
  RMDir /r "$INSTDIR"

  ; Удаляем ярлыки
  Delete "$DESKTOP\${APP_NAME}.lnk"
  Delete "$SMPROGRAMS\${APP_NAME}\${APP_NAME}.lnk"
  Delete "$SMPROGRAMS\${APP_NAME}\Удалить ${APP_NAME}.lnk"
  RMDir  "$SMPROGRAMS\${APP_NAME}"

  ; Удаляем из реестра
  DeleteRegKey HKCU "${REG_KEY}"

SectionEnd
