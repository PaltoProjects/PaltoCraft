<div align="center">

<img src="assets/creeper.svg" width="80" height="80" alt="PaltoCraft">

# PaltoCraft

**Minecraft лаунчер с официальной авторизацией Microsoft**

[![Release](https://img.shields.io/github/v/release/PaltoCraft/PaltoCraft?style=flat-square&color=5b6af5&label=Версия)](https://github.com/PaltoCraft/PaltoCraft/releases/latest)
[![Downloads](https://img.shields.io/github/downloads/PaltoCraft/PaltoCraft/total?style=flat-square&color=22c55e&label=Скачиваний)](https://github.com/PaltoCraft/PaltoCraft/releases)
[![License](https://img.shields.io/github/license/PaltoCraft/PaltoCraft?style=flat-square&color=7c3aed&label=Лицензия)](LICENSE)
[![Platform](https://img.shields.io/badge/Платформа-Windows-0078d4?style=flat-square)](https://github.com/PaltoCraft/PaltoCraft/releases/latest)

[**Скачать**](https://github.com/PaltoCraft/PaltoCraft/releases/latest) · [Сообщить об ошибке](https://github.com/PaltoCraft/PaltoCraft/issues) · [Предложить идею](https://github.com/PaltoCraft/PaltoCraft/issues)

</div>

---

## О проекте

PaltoCraft — красивый и быстрый лаунчер Minecraft с официальным входом через Microsoft/Mojang. Не требует сторонних сервисов — авторизация полностью официальная, пароль нигде не хранится.

## Возможности

- **Вход через Microsoft** — официальная OAuth авторизация, лицензионный аккаунт
- **Все версии Minecraft** — релизы, снапшоты, бета и альфа версии
- **Автозагрузка Java** — нужная версия JRE скачивается автоматически для каждой версии MC
- **3D скин персонажа** — отображение скина с вращением мышью
- **Система автообновлений** — лаунчер сам уведомляет о новых версиях и устанавливает их
- **Консоль** — полный лог запуска и работы игры
- **Гибкие настройки** — RAM, путь к Java, размер окна, поведение при запуске

## Установка

1. Скачай последний релиз: [**PaltoCraft-Setup.exe**](https://github.com/PaltoCraft/PaltoCraft/releases/latest)
2. Запусти установщик
3. Выбери папку установки, создай ярлык на рабочем столе
4. Запусти PaltoCraft и войди через Microsoft аккаунт

> Для игры необходима лицензионная копия **Minecraft: Java Edition**

## Системные требования

| | Минимум | Рекомендуется |
|---|---|---|
| **ОС** | Windows 10 x64 | Windows 10/11 x64 |
| **RAM** | 4 GB | 8 GB и больше |
| **Место** | 500 MB | 2 GB+ (зависит от версии MC) |
| **Интернет** | Требуется для авторизации | — |

## Сборка из исходников

```bash
# Установи зависимости
npm install

# Запуск в режиме разработки
npm start

# Сборка установщика
npm run build
```

> Для сборки установщика требуется [NSIS](https://nsis.sourceforge.io/)

## Технологии

- [Electron](https://electronjs.org/) — фреймворк для десктопных приложений
- [minecraft-launcher-core](https://github.com/Pierce01/MinecraftLauncher-core) — ядро запуска Minecraft
- [msmc](https://github.com/Hanro50/MSMC) — официальная авторизация Microsoft
- [Adoptium](https://adoptium.net/) — автоматическая загрузка JRE

## Лицензия

Распространяется по собственной лицензии. Подробнее — в файле [LICENSE](LICENSE).

Бесплатно для личного некоммерческого использования. Запрещено продавать, декомпилировать и распространять изменённые копии.

---

<div align="center">

PaltoCraft не является официальным продуктом Mojang или Microsoft.  
Minecraft — торговый знак Mojang AB.

</div>
