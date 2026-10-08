# Проверки toolhub-images 0.5.0

Подготовка на Python 3.12, 2026-10-08; основа — GitHub HEAD
622895c714225cec07e55260502fe238a70555db (проверен повторно перед выпуском).

- 57 passed: исходные тесты domains/loader и 6 новых проверок policy/transport,
  включая реальный файловый запуск из вложенного cwd и discovery всех шести
  инструментов essential из GitHub checkout 488e1a78f0400161884cd8034409b9d733880394.
- TWYLT GitHub 4de2805d73df81b4eadb405e0bca7fe8e5c0dbc5: 116 passed.
- HDL GitHub 70c46c0a58230148f0e3bd9d45eec8ba1acc18de: 23 TWYLT tests passed
  с отдельно установленным TWYLT 1.1.0, без старого extra.
- Essential GitHub 488e1a78f0400161884cd8034409b9d733880394: 20 passed.
- configure-toolhub.py применён к свежему checkout закреплённого ToolHub:
  адаптации schema/seed и новый TOOLHUB_RUN_ROOT применяются без ошибок.
- Зависимости filesystem сверены с закреплённым GitHub source: удалён только
  старый managed TWYLT pin, все остальные требования идентичны.
- Полная pip dry-run resolution domains/requirements.txt из закреплённых GitHub
  ревизий проходит: TWYLT 1.1.0 и essential 0.2.0 сохраняются без конфликтов.
- Shell syntax всех скриптов и git diff --check: passed.
- Native router/worker/MCP integration: 1 skipped (нет подготовленного Bun/API).
- Docker/Podman отсутствуют: image build, сетевой runtime и реальный ICMP в
  контейнере не проверены. Обновлён smoke-essential-image.sh для nested cwd.

Воспроизведение (после установки domains/requirements.txt и config-loader):

```bash
ESSENTIAL_SOURCE_DIR=/absolute/pinned-essential python -m pytest -q \
  tests/test_domains.py tests/test_guardrails.py config-loader/tests/test_loader.py
# Без ESSENTIAL_SOURCE_DIR только реальный upstream discovery test будет skipped.
# После build.sh essential:
sh tests/smoke-essential-image.sh /absolute/pinned-essential docker
```

Результаты предыдущих версий ниже сохранены как история, а не как проверки 0.5.0.

# Essential image support

- Upstream twylt-pack-essential revision 8f58765e068cce069b4e1d41a52b489ea30ff1cf:
  17 unittest tests passed (local HTTP, mock ping, CLI and six contracts).
- Native domain generation from real upstream files selected all six tools and
  generated the essential worker using toolhub-twylt:essential.
- Shell syntax and git diff --check passed. Docker/Podman are absent, so the image
  build and real ICMP inside the container were not executed here.
- After build.sh essential, run tests/smoke-essential-image.sh PACK_DIR [docker|podman]
  to check mounted-tool discovery, echo/sleep and real loopback ping as UID/GID 1000
  with capabilities dropped, no-new-privileges and the ICMP group sysctl.

# Проверки 0.4.0 — domain

- 52 passed: генерация и валидация domain, loader/SQLite, повторная сборка,
  обновление once/always, rollback при ошибке discovery, очистка управляемых
  toolsets, symlink escape, Docker workspace/socket settings, пути/порты/секреты.
- Добавлены проверки network defaults/overrides, внутренней Compose сети,
  Docker child network policy и отклонения невалидных значений.
  Сетевая изоляция проверена по сгенерированной конфигурации; запуск контейнеров
  с network=false не проверен без Docker/Podman.
- Нативный сквозной тест: реальный ToolHub worker + router (Bun 1.4.2),
  применение сгенерированных toolpacks через loader, HTTP-вызов echo через REMOTE;
  запуск upstream toolhub-mcp-bridge и MCP initialize/list_tools/call_tool до echo.
- Установка domains/requirements.txt и локального config-loader прошла.
- Дополнительно сгенерированы toolpacks из настоящих filesystem, Docker и HDL
  исходников: 13, 2 и 8 инструментов в корневых категориях соответственно.
- Shell syntax и git diff --check.

Команды (из корня, в venv с domain dependencies и pytest):

```bash
python -m pytest -q tests/test_domains.py config-loader/tests/test_loader.py
# TOOLHUB_DIR: checkout закреплённого ToolHub с configure-toolhub.py,
# patches/0002-remote-instance-identity.patch, bun install и Prisma Client.
# В окружении должен быть установлен upstream toolhub-mcp-bridge.
TOOLHUB_DIR=/absolute/prepared/toolhub BUN_BIN=/absolute/bin/bun \
  python -m pytest -q tests/test_domain_runtime.py
```

Нативный тест заменяет контейнерные пути/DNS локальными эквивалентами.
Docker/Podman в среде отсутствуют: сборка образов, Compose networking, socket
permissions и read-only rootfs **не проверены запуском контейнеров**.
Для проверки образов: `tests/smoke-domain-images.sh docker`; затем
сгенерируйте domain и выполните `docker compose -f <path>/compose.yaml config --quiet`
и `up -d`. Исторические результаты ниже относятся к прежним версиям.

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
