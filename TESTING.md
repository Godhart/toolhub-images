# Проверки 0.1.0

Выполнено при подготовке:

- filesystem-twylt-pack 0.1.0: 67 passed, Python 3.12.
- hdl-order 0.7.0: 72 passed, 1 xfailed (известное ограничение SV macro parser), Python 3.12.
- TWYLT TypeScript: компиляция и 7 исходных тестов прошли на Node 22.23.3.
- pip check: зависимые Python-пакеты совместимы.
- ToolHub: Bun 1.4.2 frozen install, генерация Prisma Client, production UI build.
- Создание SQLite, первый seed и повторный init без дублирования данных/раннеров.
- Реальный запуск ToolHub и HTTP 200 на /admin/.
- Shell syntax проверен у entrypoint и smoke-images.sh.

Docker/Podman в среде подготовки не установлены: полная сборка Dockerfile,
запуск с read-only rootfs и фактические apt/TeX зависимости образов здесь
не проверены. Python-проверки выполнялись на 3.12, образ использует 3.11.
Documentation target и полный container smoke test требуют проверки у пользователя.
Для этого приложен tests/smoke-images.sh (требует четыре заранее собранных тега).
На SELinux адаптируйте bind mounts скрипта, добавив :Z.
