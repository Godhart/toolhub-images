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

## Проверки 0.2.0 — OKF

- npm ci и TypeScript build OKF прошли на Node 22.23.3.
- OKF workspace.test.ts: 28 passed. Проверка дочернего CLI с открытым stdin
  сначала не прошла в ограниченной среде; повторный запуск вне этих ограничений
  прошёл без изменения кода.
- OKF catalog.test.ts: 17 passed, 1 skipped (отдельный end-to-end hdl-order).
- Новый tests/test_okf_adapter.py: 3 passed — discovery/валидация, создание и
  обновление через prepare/apply с проверкой хеша и экспортом, открытый stdin.
- Адаптер проверен с реальными Node CLI, Python TWYLT, Git и временным state.
- Синтаксис обновлённого smoke-images.sh проверен.
- Полная сборка target okf и container smoke не выполнялись: Docker/Podman
  в среде отсутствуют. Результаты предыдущей версии выше не означают повторный
  запуск всех базовых проверок в 0.2.0.

## Проверки 0.3.0 — GitHub sources

- Реальная загрузка всех шести репозиториев новым fetch-sources.py; каждый checkout
  проверен по sources.lock.json. Исходники не включены в дистрибутив.
- configure-toolhub.py применён к чистому GitHub ToolHub без ошибки preconditions.
- TWYLT Python 1.0.0 собран и установлен из скачанного исходника.
- TWYLT TypeScript 0.2.3: npm ci, сборка, 7 тестов и package-import check прошли.
- docsanity 0.2.0: npm ci и сборка прошли.
- test_okf_adapter.py с GitHub docsanity: 3 теста прошли.
- Проверены Python/shell syntax и git diff --check.
- Docker/Podman build и smoke-images.sh не выполнялись: движки недоступны.
- Исторические проверки выше относятся к указанным версиям, не к новому прогону.
