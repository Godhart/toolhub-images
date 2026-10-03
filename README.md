# ToolHub TWYLT Container Images 0.1.0

Образы Docker/Podman для ToolHub и запуска TWYLT-тулов с хоста.
Один Dockerfile содержит четыре именованных target; отдельные Dockerfile не нужны.

## Варианты

| Target | Состав |
|---|---|
| `base` (по умолчанию) | ToolHub + Bun 1.4.2, Node.js 22, Python 3.11, TWYLT Python 1.0.0, локальный `@twylt/core` 0.1.0, TypeBox, Ajv, tsx, TypeScript и все зависимости filesystem-twylt-pack 0.1.0 |
| `git` | base + Git, SSH-клиент, HTTPS-сертификаты |
| `docs` | git + MkDocs/Material, Sphinx/MyST, Pandoc, Graphviz, Doxygen, TypeDoc, markdownlint-cli2, python-docx, openpyxl, python-pptx, pypdf, ReportLab, Pillow; XeLaTeX и кириллица |
| `hdl` | git + hdl-order 0.7.0 с extra `twylt`, VUnit HDL 4.7.1, Graphviz |

`docs` предназначен для Markdown/RST/API-документации, сайтов и PDF через XeLaTeX,
а также программной генерации DOCX/XLSX/PPTX. LibreOffice, Chromium и Mermaid CLI
не установлены. `hdl` анализирует зависимости HDL; симуляторов GHDL/Verilator/ModelSim
в образе нет, для самого hdl-order они не требуются.

Зависимости файлового пака: twylt, pydantic, PyYAML, tomli-w, markdown-it-py,
charset-normalizer. TOML читается встроенным tomllib из Python 3.11.

## Сборка

Распакуйте архив и перейдите в каталог, содержащий Dockerfile:

```bash
docker build --target base -t toolhub-twylt:base .
docker build --target git  -t toolhub-twylt:git .
docker build --target docs -t toolhub-twylt:docs .
docker build --target hdl  -t toolhub-twylt:hdl .
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
зависимостей допускают обновления. ToolHub закреплён исходным снимком и bun.lock;
TWYLT TypeScript имеет package-lock.json.

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

## Запуск ToolHub через Compose

```bash
mkdir -p data tools workspace
cp .env.example .env
# Задайте собственные пароли в .env перед первым запуском.
# На Linux каталоги data/workspace должны быть доступны UID/GID контейнера.
# Если ваш UID/GID = 1000:1000, обычно ничего менять не нужно.
docker compose up -d --build
```

Откройте http://localhost:3000/admin/ . Порт опубликован только на loopback хоста.
Для расширенного варианта измените одновременно `build.target` и `image` в compose.yaml.
Для Podman можно использовать установленный Compose provider (`podman compose`),
либо явный запуск ниже.

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
предотвращает известное ожидание EOF. Сами раннеры ToolHub создают временный cwd,
поэтому используйте абсолютные пути `/workspace/...` в параметрах файловых тулов.
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
TWYLT-обёртки hdl-order берутся из архива 0.7.0/volume; библиотека уже установлена.

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

Скрипт проверяет уже собранные четыре тега, Python/TS imports, Git, документационные
CLI, hdl-order и старт сервера с read-only rootfs, без сети, с временной базой.
Результаты проверок, выполненных при подготовке, и ограничения — в TESTING.md.
Решения — ADR.md; происхождение исходников и изменения — SOURCES.md.
