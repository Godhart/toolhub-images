# Архитектурные решения — 0.1.0

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
