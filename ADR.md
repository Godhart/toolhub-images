# Архитектурные решения — toolhub-images 0.6.0

1. Один multi-stage Dockerfile, четыре target. git наследует base; docs и hdl
   наследуют git. Общие зависимости обновляются в одном месте.
2. Debian Bookworm + Node 22 + системный Python 3.11 в отдельном venv.
   Bun нужен самому ToolHub, Node/tsx — пользовательским TypeScript-тулам.
3. Библиотеки ставятся при сборке. Новые раннеры не устанавливают зависимости
   во время вызовов; stdin закрыт, обмен идёт через input.json/output.json.
4. Тулы подключаются bind mounts; регистрация в ToolHub отдельна от файлов.
   HDL-обёртки тоже внешние, hdl-order устанавливается как библиотека/CLI.
5. ESM использует обычный поиск через /node_modules. Одного NODE_PATH недостаточно.
6. ToolHub хранит SQLite в /data. Prisma schema читает DATABASE_URL. Генерация
   Prisma Client происходит при сборке; схема синхронизируется на старте без
   разрешения потери данных. Seed выполняется только при отсутствии settings.
7. Непривилегированный UID, внешний read-only rootfs и ограничения запуска.
   Сеть задаётся средствами Docker/Podman, а не фиктивной переменной внутри образа.
8. [Заменено решением 16 в 0.3.0] В ранних версиях использовались локальные
   source snapshots. Исторические результаты тестов сохранены в TESTING.md.
9. docs включает Git и XeLaTeX (отключаемый build-arg), hdl не включает симуляторы.
10. Сетевой ToolHub и недоверенные тулы нельзя считать взаимно изолированными
    в одном контейнере. Одноразовый запуск поддерживается тем же entrypoint.

## Дополнение 0.2.0 — OKF

11. Отдельный target okf наследует docs; base/docs/hdl продолжают собираться отдельно.
12. OKF Workspace устанавливается из исходников 0.2.0, @copperbox/okf-mcp — 2.1.0
    из его lock-файла. CLI компилируется на build, production не требует tsx.
13. Состояние /okf-state отделено от базы ToolHub. Init/export — явные CLI-операции.
14. TWYLT-обёртка подключается через volume. Один диспетчер с enum операций,
    operation-specific arguments валидируются самим OKF; describe_tools выдаёт схемы.
15. Подготовка и применение остаются отдельными вызовами. Обёртка не пишет текст
    через модель, не делает push и не модифицирует исходные Git worktrees.

## Дополнение 0.3.0 — внешние проекты

16. Вместо vendor используются GitHub URL + полный commit SHA в sources.lock.json.
    Публичная сборочная стадия скачивает код и проверяет checkout.
17. Основной target документации называется docsanity по GitHub; okf — псевдоним.
    Имена upstream CLI и переменных не меняются до их переименования upstream.
18. TWYLT TypeScript берётся из GitHub 0.2.3 без прежних локальных исправлений.
19. Только контейнерные адаптации ToolHub остаются локальным fail-fast скриптом.
    Внешние тесты исполняются из полученных исходников, не копируются в проект.

## Domain network policy

- `domain.network: true` preserves existing external connectivity. Worker boolean overrides inherit on missing/null; router and bridge use the domain default.
- Every service joins a Compose internal network for router/worker traffic. Only enabled services join the egress network. `network_mode: none` would break REMOTE routing.
- Docker workers receive the matching twylt-pack-docker child-container policy through `TWYLT_DOCKER_DISABLE_NETWORK`. Daemon image pulls and arbitrary programs using the socket are outside that tool policy.

## Essential image

A separate `essential` target extends common, matching the domain draft's image
name. It installs pinned upstream requirements and iputils-ping. Python handles
curl/wget; SearXNG remains an external configured service. Tool files stay in
volumes. Ping can use ICMP datagram sockets through ping_group_range without
granting NET_RAW or removing no-new-privileges.

## Дополнение 0.5.0 — централизованные guardrails

- Generic policy belongs to locked GitHub TWYLT 1.1.0; shared HTTP logic belongs
  to essential 0.2.0. Image integration does not embed copies of either implementation.
- All Hub targets inherit enabled defaults; MCP facade carries the flag but does
  not execute local TWYLT tools. Its behavior is unchanged.
- ToolHub run directories use a configurable root; allowed cwd includes descendants
  without expanding the business workspace. Domain configuration carries these defaults.
- Requirements from older packs cannot downgrade managed TWYLT. Host dependencies
  retain all other locked filesystem requirements; updates must follow sources.lock.json.
- This is an images-only migration. Legacy pack-specific policy and TypeScript stay
  unchanged; OS enforcement and tool-author responsibility remain distinct.

0.5.0 installs hdl-order base distribution instead of the TWYLT extra, which pins
1.0.0. The managed 1.1.0 runtime supplies that dependency; upstream code is unchanged.

## Дополнение 0.6.0 — essential как исходный пак

- TWYLT 1.1.1 и essential 0.3.0 закреплены новыми GitHub SHA. Другие source pins сохранены.
- Образ essential устанавливает только requirements.txt. Python-дистрибутив essentials
  больше не нужен; удалены его установка, импорт-проверка и pin из constraints/host requirements.
- Общая HTTP-логика живёт в shared/ essential. Весь toolset копируется генератором
  и монтируется в раннер; каждый HTTP-тул вычисляет sys.path относительно __file__.
  Это решение заменяет установку общего модуля из дополнения 0.5.0.
- Не добавляем копию shared-кода в образ: единственный источник — подключённый пак.
  Поэтому исходные tools/ и shared/ должны сохранять взаимное расположение.
- Проверки выполняют настоящую HTTP-логику из сгенерированного launcher с nested cwd;
  smoke дополнительно проверяет отсутствие установленного essential-дистрибутива.
