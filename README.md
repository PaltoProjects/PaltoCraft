<div align="center">

<img src="assets/creeper.svg" width="80" height="80" alt="PaltoCraft">

# PaltoCraft

[![Release](https://img.shields.io/github/v/release/PaltoProjects/PaltoCraft?style=flat-square&color=5b6af5&label=Version)](https://github.com/PaltoProjects/PaltoCraft/releases/latest)
[![Downloads](https://img.shields.io/github/downloads/PaltoProjects/PaltoCraft/total?style=flat-square&color=22c55e&label=Downloads)](https://github.com/PaltoProjects/PaltoCraft/releases)
[![License](https://img.shields.io/github/license/PaltoProjects/PaltoCraft?style=flat-square&color=7c3aed&label=License)](LICENSE)
[![Platform](https://img.shields.io/badge/Platform-Windows-0078d4?style=flat-square)](https://github.com/PaltoProjects/PaltoCraft/releases/latest)
[![Telegram](https://img.shields.io/badge/Telegram-@paltocraft-2CA5E0?style=flat-square&logo=telegram)](https://t.me/paltocraft)

**[🇷🇺 Русский](#-русский) | [🇬🇧 English](#-english)**

</div>

---

## 🇷🇺 Русский

**Minecraft лаунчер с официальной авторизацией Microsoft**

[**Скачать**](https://github.com/PaltoProjects/PaltoCraft/releases/latest) · [Сообщить об ошибке](https://github.com/PaltoProjects/PaltoCraft/issues) · [Предложить идею](https://github.com/PaltoProjects/PaltoCraft/issues) · [Сайт](https://paltoprojects.github.io/PaltoCraft/) · [Telegram](https://t.me/paltocraft)

### О проекте

PaltoCraft — красивый и быстрый лаунчер Minecraft с официальным входом через Microsoft/Mojang. Не требует сторонних сервисов — авторизация полностью официальная, пароль нигде не хранится.

### Возможности

- **Вход через Microsoft** — официальная OAuth авторизация, лицензионный аккаунт
- **Безопасное хранение токенов** — авторизационные данные шифруются через Windows DPAPI
- **Все версии Minecraft** — релизы, снапшоты, бета и альфа версии
- **Автозагрузка Java** — нужная версия JRE скачивается автоматически для каждой версии MC
- **3D скин персонажа** — отображение скина с вращением мышью
- **Discord RPC** — статус игры отображается в профиле Discord
- **Система автообновлений** — лаунчер сам уведомляет о новых версиях и устанавливает их
- **Консоль** — полный лог запуска и работы игры
- **Гибкие настройки** — RAM, путь к Java, размер окна, поведение при запуске
- **Зеркало ассетов (BMCLAPI)** — ускорение загрузки для пользователей с ограниченным доступом к серверам Mojang

#### Мод-профили

- **Forge / Fabric / NeoForge** — создание профилей с загрузчиком модов в один клик
- **Браузер Modrinth** — поиск и установка модов прямо из лаунчера; установленные моды помечаются
- **Изолированные директории** — у каждого профиля своя папка для модов, конфигов и сохранений

### Установка

1. Скачай последний релиз: [**PaltoCraft-Setup.exe**](https://github.com/PaltoProjects/PaltoCraft/releases/latest)
2. Запусти установщик
3. Выбери папку установки, создай ярлык на рабочем столе
4. Запусти PaltoCraft и войди через Microsoft аккаунт

> Для игры необходима лицензионная копия **Minecraft: Java Edition**

### Системные требования

| | Минимум | Рекомендуется |
|---|---|---|
| **ОС** | Windows 10 x64 | Windows 10/11 x64 |
| **RAM** | 4 GB | 8 GB и больше |
| **Место** | 500 MB | 2 GB+ (зависит от версии MC) |
| **Интернет** | Требуется для авторизации | — |

### Сборка из исходников

```bash
npm install
npm start        # режим разработки
npm run build    # сборка установщика (требует NSIS)
```

### Технологии

- [Electron](https://electronjs.org/) · [minecraft-launcher-core](https://github.com/Pierce01/MinecraftLauncher-core) · [msmc](https://github.com/Hanro50/MSMC) · [discord-rpc](https://github.com/discordjs/RPC) · [skinview3d](https://github.com/bs-community/skinview3d) · [Adoptium](https://adoptium.net/)

### Лицензия

Распространяется по собственной лицензии. Подробнее — в файле [LICENSE](LICENSE).  
Бесплатно для личного некоммерческого использования. Запрещено продавать, декомпилировать и распространять изменённые копии.

---

## 🇬🇧 English

**Minecraft launcher with official Microsoft authentication**

[**Download**](https://github.com/PaltoProjects/PaltoCraft/releases/latest) · [Report a bug](https://github.com/PaltoProjects/PaltoCraft/issues) · [Request a feature](https://github.com/PaltoProjects/PaltoCraft/issues) · [Website](https://paltoprojects.github.io/PaltoCraft/) · [Telegram](https://t.me/paltocraft)

### About

PaltoCraft is a fast and beautiful Minecraft launcher with official Microsoft/Mojang login. No third-party services involved — authentication is fully official, your password is never stored.

### Features

- **Microsoft login** — official OAuth authentication, licensed account only
- **Secure token storage** — credentials are encrypted via Windows DPAPI
- **All Minecraft versions** — releases, snapshots, beta and alpha
- **Auto Java download** — the correct JRE version is downloaded automatically for each MC version
- **3D skin viewer** — rotatable 3D character skin display
- **Discord RPC** — game status shown in your Discord profile
- **Auto-updater** — the launcher notifies you of new versions and installs them
- **Console** — full launch and game log
- **Flexible settings** — RAM, Java path, window size, launch behavior
- **BMCLAPI asset mirror** — faster asset downloads for users with restricted access to Mojang servers

#### Mod profiles

- **Forge / Fabric / NeoForge** — create mod-loader profiles in one click; loader installs automatically
- **Modrinth browser** — search and install mods right from the launcher; installed mods are marked
- **Isolated directories** — each profile has its own folder for mods, configs and saves

### Installation

1. Download the latest release: [**PaltoCraft-Setup.exe**](https://github.com/PaltoProjects/PaltoCraft/releases/latest)
2. Run the installer
3. Choose install folder, create a desktop shortcut
4. Launch PaltoCraft and sign in with your Microsoft account

> A valid, purchased copy of **Minecraft: Java Edition** is required to play.

### System requirements

| | Minimum | Recommended |
|---|---|---|
| **OS** | Windows 10 x64 | Windows 10/11 x64 |
| **RAM** | 4 GB | 8 GB or more |
| **Storage** | 500 MB | 2 GB+ (depends on MC version) |
| **Internet** | Required for authentication | — |

### Building from source

```bash
npm install
npm start        # development mode
npm run build    # build installer (requires NSIS)
```

### Tech stack

- [Electron](https://electronjs.org/) · [minecraft-launcher-core](https://github.com/Pierce01/MinecraftLauncher-core) · [msmc](https://github.com/Hanro50/MSMC) · [discord-rpc](https://github.com/discordjs/RPC) · [skinview3d](https://github.com/bs-community/skinview3d) · [Adoptium](https://adoptium.net/)

### License

Distributed under a custom license. See [LICENSE](LICENSE) for details.  
Free for personal non-commercial use. Selling, decompiling, or redistributing modified copies is prohibited.

---

<div align="center">

PaltoCraft is not affiliated with Mojang or Microsoft.  
Minecraft is a trademark of Mojang AB.

</div>
