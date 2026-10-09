# ToolHub TWYLT Container Images 0.7.0

Образы Docker/Podman для ToolHub и запуска TWYLT-тулов с хоста.
Один Dockerfile содержит варианты ToolHub и отдельный target MCP bridge.

Отдельный образ OKF, его инициализация и работа с тулом описаны в [README-OKF.md](README-OKF.md).

## Исходники из GitHub

`vendor/` удалён. При сборке отдельная стадия скачивает проекты из GitHub по
`sources.lock.json`, проверяет SHA и передаёт нужные исходники в стадии сборки.
В архиве остаются только файлы toolhub-images: Dockerfile, настройки, небольшие
интеграционные скрипты, TWYLT-адаптер и собственные тесты. Git загрузчика не
попадает в базовый runtime. Тулы по-прежнему подключаются через volume.

Канонические имена взяты из [TWYLT RESOURCES](https://github.com/Godhart/twylt/blob/main/RESOURCES.md).
Полный перечень ссылок и правила обновления — [SOURCES.md](SOURCES.md).
При переходе с 0.2.0 удалите старый каталог vendor: распаковка поверх старой версии
сама не удалит его. Он также исключён из build context через .dockerignore.

## Варианты

| Target | Состав |
|---|---|
| `base` (по умолчанию) | ToolHub + Bun 1.4.2, Node.js 22, Python 3.11, TWYLT Python 1.1.1, `@twylt/core` 0.2.3 из GitHub, TypeBox, Ajv, tsx, TypeScript и все зависимости twylt-pack-filesystem 0.6.0 |
| `essential` | base + зависимости twylt-pack-essential 0.3.0 и iputils-ping; tools/ и shared/ монтируются целиком; echo, sleep, wget, curl, ping, web_search |
| `docker` | base с Python Docker SDK, отдельный тег для Docker worker |
| `mcp-bridge` | отдельный Python образ toolhub-mcp-bridge:base, HTTP MCP → router |
| `git` | base + Git, SSH-клиент, HTTPS-сертификаты |
| `docs` | git + MkDocs/Material, Sphinx/MyST, Pandoc, Graphviz, Doxygen, TypeDoc, markdownlint-cli2, python-docx, openpyxl, python-pptx, pypdf, ReportLab, Pillow; XeLaTeX и кириллица |
| `docsanity` (`okf` — псевдоним) | docs + docsanity / OKF Workspace 0.2.0 и @copperbox/okf-mcp 2.1.0; TWYLT-адаптер в tools/ для подключения через volume |
| `hdl` | git + hdl-order 0.8.0 с отдельно установленным TWYLT 1.1.1, VUnit HDL 4.7.1, Graphviz |

`docs` предназначен для Markdown/RST/API-документации, сайтов и PDF через XeLaTeX,
а также программной генерации DOCX/XLSX/PPTX. LibreOffice, Chromium и Mermaid CLI
не установлены. `hdl` анализирует зависимости HDL; симуляторов GHDL/Verilator/ModelSim
в образе нет, для самого hdl-order они не требуются.

Зависимости файлового пака: twylt, pydantic, PyYAML, tomli-w, markdown-it-py,
charset-normalizer. TOML читается встроенным tomllib из Python 3.11.

## Сборка

Из корня репозитория:

```bash
./build.sh                          # все образы
./build.sh base essential git docker hdl mcp-bridge
CONTAINER_ENGINE=podman ./build.sh base mcp-bridge
```

Для Podman замените `docker` на `podman`. BuildKit-специфичных инструкций нет.
Без `--target` собирается base. Интернет нужен на этапе сборки.
Более компактная документационная сборка без TeX/PDF-движка:

```bash
podman build --target docs --build-arg WITH_LATEX=0 -t toolhub-twylt:docs .
```

Для закрепления базовых образов доступны `NODE_IMAGE` и `BUN_IMAGE`, включая
значения с `@sha256:...`. По умолчанию Node использует обновляемый тег 22-bookworm-slim,
Bun — тег 1.4.2. Это не полностью воспроизводимая сборка: apt и часть Python/Node
зависимостей допускают обновления. GitHub-проекты закреплены полными commit SHA в sources.lock.json. npm-проекты
собираются через npm ci. ToolHub требует нормализации исходного bun.lock при
bun install; его транзитивные зависимости не объявляются полностью закреплёнными.

## Дополнительные зависимости

В Dockerfile явно выделены секции `EXTRA PYTHON PACKAGES` и `EXTRA NODE PACKAGES`.
Перед сборкой измените:

- `config/python-extra.txt`: по одному Python requirement на строку.
- `config/node-extra.json`: дополнительные npm-пакеты в `dependencies`.

Пример Node-конфигурации:

```json
{"name":"toolhub-extra-packages","private":true,"dependencies":{"yaml":"2.8.1"}}
```

Node-пакеты устанавливаются в `/opt/tool-runtime/node_modules`, CLI доступны через
PATH. Симлинк `/node_modules` позволяет Node ESM искать пакеты из `/tools`,
`/workspace` и временных каталогов ToolHub. NODE_PATH добавлен для CommonJS,
но не используется как решение для ESM. Локальный node_modules у подключаемого
тула имеет приоритет: не монтируйте в контейнер Windows/macOS node_modules.

Python использует `/opt/venv`, команда `python` уже указывает на него.
Для пакетов с нативными расширениями могут понадобиться дополнительные apt-пакеты
и компилятор: добавьте их в Dockerfile перед соответствующей установкой.
Пересоберите образ после изменения dependencies. Во время исполнения новые
раннеры TWYLT не вызывают pip/npm и не требуют доступа к реестрам пакетов.

## Запуск domain через Compose

Сначала настройте YAML и запустите `domains/build_domain.py`.
Пошаговый запуск, параметры и примеры — в [domains/README.md](domains/README.md).
Один router обслуживает коллекцию workers; в Lab настраивается только router.
Образы предварительно собирает `build.sh`; Compose содержит только `image`.

В base доступны `toolhub-config validate`, `toolhub-config apply` и
`toolhub-config serve` ([описание](config-loader/README.md)). `TOOLHUB_CONFIG`
включает запуск по YAML. Следующие сведения об инициализации без YAML относятся
к прежнему standalone-режиму.

| Путь внутри | Назначение | Режим |
|---|---|---|
| `/tools` | Исходники тулов и папки тулпаков | read-only |
| `/workspace` | Файлы, с которыми работают тулы | read-write |
| `/data` | База ToolHub: настройки, категории, раннеры, журналы | read-write |
| `/tmp` | Временные каталоги запусков, HOME, кэши | tmpfs |

Все три volume в примере — bind mounts обычных каталогов хоста.
Dockerfile не содержит VOLUME: анонимные Docker volumes не создаются.
SQLite-база создаётся при первом запуске. Обязательны `TOOLHUB_ADMIN_PASSWORD` и
`TOOLHUB_AGENT_PASSWORD`; `TOOLHUB_SEED_LANG` — ru/en/zh, по умолчанию ru.
При последующих запусках существующие настройки и пароли сохраняются:
переменные не служат способом смены пароля. После инициализации их можно убрать
из .env. Пароли не выводятся seed-скриптом в журнал и удаляются из окружения
основного процесса перед запуском API.

`db push --skip-generate` выполняется на старте, использует сгенерированный при
сборке Prisma Client и не пишет в read-only код. Потеря данных автоматически
не разрешается. При замене схемы сделайте резервную копию /data и отдельно
разберите миграцию; одновременно запускайте только один экземпляр с этой базой.

## Явный запуск Podman / Docker

Rootless Podman на Linux (сохранение вашего UID/GID для bind mounts):

```bash
podman run --rm --name toolhub \
  --userns=keep-id --user "$(id -u):$(id -g)" \
  --env-file .env -p 127.0.0.1:3000:3000 \
  --read-only --tmpfs /tmp:rw,nosuid,nodev,size=512m,mode=1777 \
  --cap-drop ALL --security-opt no-new-privileges \
  --pids-limit 256 --memory 2g --cpus 2 \
  -v "$PWD/data:/data" -v "$PWD/tools:/tools:ro" \
  -v "$PWD/workspace:/workspace" toolhub-twylt:base
```

Для Docker уберите `--userns=keep-id`; на обычном Linux Docker можно оставить
`--user "$(id -u):$(id -g)"`. На системах с SELinux добавьте `:Z` к bind mounts
(например, `/tools:ro,Z`); `:z` — когда каталог намеренно разделяется контейнерами.
Не используйте rootless Podman `:U` без понимания, что он меняет владельцев файлов
на хосте. Compose использует 1000:1000; при другом UID измените `user`.

## Подключение тулов

Монтирование `/tools` само по себе не регистрирует инструменты в ToolHub.
Распакуйте файловой пак так, чтобы путь имел вид
`tools/filesystem/tools/fs_list/tool.py`. Далее:

1. Импортируйте toolpack, созданный ToolPack Builder, либо создайте запись тула.
2. Выберите добавляемый образом раннер `TWYLT Python (preinstalled)` или
   `TWYLT TypeScript (preinstalled)`. Импортированный pack может выбрать другой
   раннер — проверьте выбор после импорта.
3. Для чтения Python-реализации непосредственно из volume используйте в поле
   кода ToolHub короткий адаптер:

```python
import runpy
runpy.run_path('/tools/filesystem/tools/fs_list/tool.py', run_name='__main__')
```

Схемы/few-shots заполните из `json_spec` исходного тула. Для TypeScript адаптер:

```typescript
await import('/tools/my-typescript-tool/tool.ts');
```

Сам TS-тул должен запускать свой `tool.run()` и импортировать `@twylt/core`;
tsx в образе умеет исполнять его без предварительной компиляции. Пример из старого
архива, импортирующий `../../src/index.js`, нужно либо подключать вместе со всей
структурой проекта, либо перевести на импорт из `@twylt/core`.

Раннеры используют `python tool.py < /dev/null` и `tsx tool.mts < /dev/null`.
Они читают вход через input.json, результат — output.json. Закрытый stdin
предотвращает известное ожидание EOF. Раннеры ToolHub создают временный cwd внутри TOOLHUB_RUN_ROOT. Бизнес-пути
определяются соответствующим паком и не должны вычисляться из cwd. В essential
0.3.0 `/file` и `file` обозначают файл относительно TWYLT_WORKSPACE_ROOT.
Предустановка библиотек не означает автоматическую регистрацию или импорт пака.

## Одноразовый запуск без сети

Команда после имени образа заменяет запуск ToolHub; база и пароли тогда не нужны:

```bash
docker run --rm --network none \
  --user "$(id -u):$(id -g)" \
  --read-only --tmpfs /tmp:rw,nosuid,nodev,size=256m,mode=1777 \
  --cap-drop ALL --security-opt no-new-privileges \
  --pids-limit 128 --memory 512m --cpus 1 \
  -v "$PWD/tools:/tools:ro" -v "$PWD/workspace:/workspace" \
  toolhub-twylt:base python /tools/filesystem/tools/fs_list/run.py \
  '{"path":"/workspace","max_depth":2,"limit":20}'
```

Для JSON через stdin добавьте `-i` (без `-t`) и передайте JSON в stdin.
Для файлового режима положите input.json в workspace и закройте stdin.
Пример hdl-order: аналогичный запуск образа `:hdl` с командой
`hdl-order --help`, либо `python /tools/hdl-order/tools/hdl-order/run.py ...`.
TWYLT-обёртки hdl-order берутся из GitHub toolset 0.8.0/volume; библиотека уже установлена.

Dockerfile не может запретить сеть: это параметр запуска. `--network none`
отключает внешнюю сеть, но не loopback. С ним опубликованный HTTP-порт ToolHub
недоступен. Compose-пример сервера по умолчанию допускает исходящую сеть.
Для доступного по HTTP сервера с запретом egress потребуется отдельная политика
сети/межсетевого экрана хоста; одной переменной окружения это не обеспечить.

## Git

HTTPS работает сразу. Для приватных репозиториев передавайте только необходимые
учётные данные/SSH-agent и known_hosts отдельными mounts или secrets.
HOME находится в /tmp/home, поэтому Git-конфигурация исчезнет при пересоздании.
SSH host-key checking не отключается; `safe.directory=*` не устанавливается.
Если Git сообщает dubious ownership, выровняйте UID/GID или разрешите только
конкретный проверенный репозиторий через `git -c safe.directory=/workspace/repo ...`.
Глобальную конфигурацию можно подключить отдельным файлом через GIT_CONFIG_GLOBAL.

## Границы изоляции

Образ запускается как UID/GID 1000:1000. Compose дополнительно задаёт read-only
rootfs, сброс capabilities, no-new-privileges и лимиты. Не подключайте Docker/Podman
socket: для этого образа он не нужен. Приложения видят только контейнер и mounts,
но внутри контейнера ToolHub и тулы работают с одним UID. Тул может читать базу
ToolHub, содержащую секреты, и менять доступные ему файлы; это не изоляция тулов
друг от друга или от самого ToolHub. Для недоверенных тулов используйте отдельный
одноразовый контейнер без /data и без серверных секретов, как показано выше.

## Проверка

```bash
sh tests/smoke-images.sh docker
# либо sh tests/smoke-images.sh podman
```

Скрипт проверяет уже собранные пять тегов, Python/TS imports, Git, документационные
CLI, hdl-order и старт сервера с read-only rootfs, без сети, с временной базой.
Результаты проверок, выполненных при подготовке, и ограничения — в TESTING.md.
Решения — ADR.md; происхождение исходников и изменения — SOURCES.md.

## Guardrails и миграция 0.7.0

Основа — свежий GitHub toolhub-images 0.6.0, commit `f00fd8678dfd5da029d0524dd62bb55d8bbd615d`.
Обновлены filesystem 0.6.0, Git 0.4.0, Docker/Podman 0.4.0 и HDL 0.8.0.
TWYLT 1.1.1 и essential 0.3.0 сохраняют прежние ревизии, повторно проверенные в GitHub.
Все toolset примера закреплены SHA, согласованными с sources.lock.json; update: always
обновляет исходники при каждом запуске генератора. Другие source pins сохранены.

В каждом ToolHub target по умолчанию:

```dotenv
TWYLT_GUARDRAILS=1
TWYLT_WORKSPACE_ROOT=/workspace
TWYLT_ALLOWED_CWD=/tmp/toolhub-runs
TOOLHUB_RUN_ROOT=/tmp/toolhub-runs
TWYLT_DISABLE_NETWORK=0
```

TOOLHUB_RUN_ROOT определяет корень создаваемых ToolHub каталогов выполнения.
TWYLT_ALLOWED_CWD разрешает этот корень и подкаталоги любой глубины для файлового
транспорта. Это не второй корень бизнес-доступа: бизнес-пути остаются в workspace.
Проверка транспорта принадлежит TWYLT и выполняется до удаления старого результата,
чтения input.json и записи output.json. Guardrails — типовой контроль от ошибок и
неосторожного применения; автор тула обязан применять API, произвольные операции
контролируются ОС. Подробности — docs/GUARDRAILS.md в TWYLT 1.1.1.

Генератор domain добавляет эти параметры worker/router. TWYLT_DISABLE_NETWORK
вычисляется из domain.network и override конкретного worker; прямое переопределение
через env запрещено. Сетевая политика контейнера и отдельный параметр Docker child
сохраняются. Опциональный TWYLT_GUARDRAILS можно явно выключить через env.
Для собственного cwd задайте TOOLHUB_RUN_ROOT или TWYLT_ALLOWED_CWD: если указан
только один, генератор использует его для обоих. Если указаны оба, run root должен
лежать внутри allowed cwd. Для standalone задайте согласованную пару самостоятельно.

Essential 0.3.0 не собирается и не устанавливается как Python-пакет.
Образ устанавливает только его requirements.txt; весь исходный пак, включая
`tools/` и `shared/essential_common/`, подключается через volume.
HTTP-тулы сами добавляют shared/ в sys.path относительно __file__, поэтому
загрузка общего кода не зависит от cwd. Генератор уже копирует и монтирует весь
toolset; отдельная настройка PYTHONPATH не требуется. Нельзя подключать только tools/.

На хосте также устанавливаются лишь внешние зависимости. Старый установленный
`twylt-pack-essential` можно удалить: новый пак его не импортирует. Уберите его
старый pin из собственных constraints и requirements. Пересоберите образ essential
и заново сгенерируйте domain из обновлённого YAML, чтобы получить tools/ вместе с shared/.
Пример закреплён на essential 0.3.0. Для своего YAML обновите Git ref на SHA из
sources.lock.json и используйте update: always на время обновления.

Filesystem, Git, Docker и HDL теперь используют общий транспорт TWYLT и shared/,
так же как essential. В каждом подключаемом паке сохраняйте tools/ и shared/ вместе.
Сборка и установка Python-пакета для этих тулпаков не требуется. Исключение — сам
HDL-анализатор: backend hdl-order 0.8.0 устанавливается в target hdl и на хосте
для discovery. Wrapper-код при этом остаётся в volume всего пака.

TWYLT устанавливается из закреплённого исходника до requirements файлового пака,
который теперь требует TWYLT >=1.1.1. Constraint защищает версию 1.1.1. Docker SDK
закреплён на 7.1.0 в common, target docker, host requirements и constraints, чтобы
соответствовать требованиям Docker/Podman пака. Target docker устанавливает только
requirements.txt своего пака; source pack через pip не устанавливается.
Несовместимые дополнительные зависимости вызовут ошибку установки.

Для этих новых паков больше не нужен legacy override TOOLHUB_RUN_ROOT внутри
workspace: оставьте /tmp/toolhub-runs и TWYLT_ALLOWED_CWD по умолчанию либо свою
согласованную пару. Для старых сторонних паков требования к cwd могут отличаться.
Docker worker сохраняет readonly host workspace и собственную политику bind mounts.
Git сохраняет запрет опасных настроек и hooks; локальные операции работают при
выключенной сети, а сетевые clone/fetch/pull/push запрещаются общей политикой.
TWYLT_DOCKER_DISABLE_NETWORK остаётся дополнительным запретом сети дочернего
контейнера; общий TWYLT_DISABLE_NETWORK также запрещает pull образов.

При guardrails=1 параметры HDL root/config/include_dirs — виртуальные workspace
пути: например root=/project означает /workspace/project для обычного worker.
Для Docker бизнес-корень определяется режимом docker_workspace, а не cwd.
TypeScript runtime и docsanity-adapter этим релизом не меняются.

Обновление: замените файлы images этим комплектом; используйте свежий каталог, без
vendor/ и .sources из старых сборок. Установите domains/requirements.txt и config-loader,
повторно запустите генератор domain, затем build.sh и docker compose up -d --force-recreate
с полученным compose.yaml. Сохраните свой YAML, пароли, data и workspace. Docker сборка
и контейнерный smoke в среде подготовки не запускались; результаты — TESTING.md.

HDL target и host dependencies устанавливают backend hdl-order без дополнительной
wrapper-упаковки; TWYLT уже установлен отдельно и согласован constraints.

Для проверки новых паков после сборки:

```bash
./build.sh base essential git docker hdl
sh tests/smoke-refactored-packs.sh /path/filesystem /path/git /path/docker /path/hdl-order docker
sh tests/smoke-essential-image.sh /path/essential docker
```

Smoke запускает локальные FS/Git/HDL операции, file transport из nested cwd и
mock Docker images API; реальный daemon этим скриптом не проверяется.
