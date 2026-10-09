# Domain: один router, несколько workers

YAML — источник конфигурации. Генератор получает исходники тулов, запускает их
TWYLT discovery через upstream toolpack-builder и формирует Compose, toolpacks,
конфигурации ToolHub и env-файлы. В Lab достаточно зарегистрировать router.
Для MCP-клиента доступен отдельный bridge с двумя инструментами: `toolhub_list`
и `toolhub_call`; вызовы идут через тот же router.

## Подготовка и запуск

Из корня репозитория (Python 3.11+, Git):

```bash
python3 -m venv .venv
. .venv/bin/activate
pip install ./config-loader -r domains/requirements.txt
cp domains/toolhub-domain-example.yaml domains/my.yaml
# Отредактируйте name, path, workspace, uid/gid, пароли и коллекцию инструментов.
chmod 600 domains/my.yaml
python domains/build_domain.py domains/my.yaml --check
python domains/build_domain.py domains/my.yaml
./build.sh base essential git docker hdl mcp-bridge
# Используйте path из своего YAML; ниже путь из примера:
docker compose -f domains/example/compose.yaml config --quiet
docker compose -f domains/example/compose.yaml up -d
```

Для Podman: `CONTAINER_ENGINE=podman ./build.sh ...`, затем `podman compose`
с установленным совместимым Compose provider. Образы собираются только build.sh:
в сгенерированном Compose нет `build`. Docker/Podman daemon должен видеть bind
paths; генератор рассчитан на Linux и локальный daemon. Для SELinux потребуется
настроить разрешения/метки bind-каталогов под политику хоста.

Пример публикует router на `http://127.0.0.1:3300`, UI на `/admin/`,
bridge на `http://127.0.0.1:3400/mcp`. Передайте Lab пароль `agent_pass`.
Пути через router: `/filesystem/filesystem/<tool>`, `/git/git/<tool>`,
`/docker/exec/<tool>`, `/hdl/hdl/<tool>`. Внутри Compose router использует DNS
имена workers и порт 3000. Уберите `hubs[].port`, чтобы worker не имел порта хоста.
Bridge можно отключить: `bridge.enabled: false`. Bridge этого upstream не имеет
отдельной клиентской авторизации: оставляйте host=127.0.0.1 либо используйте
защищённый reverse proxy для внешнего доступа.

## Внешний доступ в сеть

`domain.network` — boolean, по умолчанию `true`. `hubs[].network` переопределяет
его для конкретного worker; отсутствие поля или `null` наследует значение домена.
Router и MCP bridge всегда подключены к внешней сети для доступа через опубликованные порты. Ограничение домена применяется к workers.

```yaml
domain:
  # остальные обязательные поля — как в примере
  network: false
hubs:
  - name: filesystem
    image: toolhub-twylt:base
    # network не задан: внешний доступ запрещён
  - name: git
    image: toolhub-twylt:git
    network: true
```

Генератор создаёт `domain-internal` с `internal: true` и подключает к ней все
сервисы. Router продолжает обращаться к workers через DNS-имена Compose.
Сервисы с разрешённым внешним доступом дополнительно подключаются к
`domain-egress`. Router и MCP bridge подключены к ней всегда; workers — только при разрешённой сети.
Это использует стандартную [сетевую изоляцию Compose](https://docs.docker.com/reference/compose-file/networks/#internal).
Параметр управляет исходящим доступом за пределы домена, опубликованные порты
router/bridge/workers остаются заданными через host и port.

Для `kind: docker` дополнительно задаётся `TWYLT_DOCKER_DISABLE_NETWORK`:
при `network: false` twylt-pack-docker отвергает запросы на запуск дочернего
контейнера с включённой сетью. Эта env-переменная управляется генератором и
не может переопределяться через env. Скачивание образов самим daemon и доступ
сборщика/генератора к GitHub не регулируются этой настройкой.
Доступ к Docker socket позволяет другим программам управлять daemon;
политика дочерних контейнеров обеспечивается именно twylt-pack-docker.
После изменения network пересоздайте сервисы командой из раздела запуска.

## Пути и файлы

`domain.path` разрешается относительно YAML. `tools` и `workspace`:
абсолютный путь используется напрямую; путь с начальной точкой — относительно
YAML; обычный относительный путь — относительно domain.path. Несколько
domain могут явно использовать один workspace. Управляемые tools/config/data
не должны перекрываться с workspace. `abs_paths: false` даёт относительные пути
в Compose, разрешаемые от его каталога.

В domain.path создаются:

- `compose.yaml`, `.env-_router_`, `.env-<worker>`, `.env-_bridge_` (последний при включённом bridge);
- `config/_router_/toolhub.yaml`, `config/<worker>/toolhub.yaml`, `*.toolpack`;
- `data/_router_/`, `data/<worker>/` для SQLite и backup;
- `.domain-generated.json` с источниками и Git revisions; `.domain.lock` для блокировки генерации.

Исходники находятся в `domain.tools/<toolset>`, workspace — в указанном
каталоге. Env-файлы имеют права 0600; исходный YAML тоже содержит пароли.
Генератор не редактирует существующие SQLite. При запуске `toolhub-config serve`
инициализирует схему, применяет YAML и запускает API. По умолчанию
`reset_settings: true` восстанавливает управляемые настройки/раннеры/категории/
инструменты с backup базы; изменения этих сущностей через UI будут сброшены.
`false` включает merge: старые записи могут остаться после удаления из YAML.

После изменения YAML повторите генерацию и выполните:

```bash
docker compose -f domains/example/compose.yaml up -d --force-recreate --remove-orphans
```

Recreate необходим и при изменении только bind-mounted конфигураций. Не запускайте
генерацию одновременно с созданием контейнеров: публикация файлов использует
rename и rollback при ошибке, но не является атомарной транзакцией для Compose.
Данные удалённых workers остаются на диске; удаляйте их отдельно при необходимости.

## Источники и discovery

`source_kind`: `git`, `local`, `manual`. Для git задаются `data.path` (GitHub URL)
и `data.ref` (желательно SHA); local копирует `data.path` относительно YAML;
manual использует уже подготовленный `tools/<name>`. `update: once` сохраняет
существующий checkout, `always` получает новый при каждой генерации.
`remove_unused_tools` удаляет только ранее управляемые git/local toolsets,
никогда неизвестные каталоги и manual. При ошибке discovery старые конфигурации
и исходники остаются на месте.

Python зависимости тулов нужны и в окружении генератора для discovery, и в образе
worker для запуска. Общие зависимости устанавливаются requirements.txt; прочие
добавляются отдельно, а для runtime — в `config/python-extra.txt` и
`config/node-extra.json`. Discovery исполняет Python-код из выбранного репозитория:
используйте доверенные источники. В этой версии генерация toolpacks поддерживает
Python TWYLT; TypeScript runtime остаётся в базовом образе, автоматического
TypeScript discovery здесь нет.

`packs[].prefix` определяет путь категории внутри worker. `prefix: "/"` и
`prefix: ""` размещают тулы в корне (`/tool-name`); отсутствие prefix или null
оставляет категорию `/<toolset>`. Несколько паков можно разместить в одном корне;
совпадающие имена тулов и дочерних категорий отклоняются до записи настроек.
Например:

```yaml
packs:
  - toolset: essential
    prefix: ""
  - toolset: filesystem
    prefix: "/"
```

 `exclude` принимает
имена инструментов или glob относительного файла. `toolpak_builder_kwargs`
(совместимость с черновиком; также принимается `toolpack_builder_kwargs`) допускает
`glob`, `excludes`, `python`, `probe_timeout`, `category_mode`, `timeout_ms`.
Параметры root/runner задаёт генератор. Legacy `kind`, `data.url`, `ptoolseth`
нормализуются, неизвестные поля и дублирующиеся YAML-ключи отвергаются.

## Docker worker

Python Docker SDK есть уже в base; target `docker` даёт отдельный тег для worker.
`kind: docker` подключает указанный `docker_socket` и добавляет его GID в
supplementary groups. GID определяется на хосте либо задаётся `docker_socket_gid`.
Для rootless Podman укажите путь его совместимого socket и соответствующий GID;
права user namespace могут потребовать дополнительной настройки хоста.

Текущий twylt-pack-docker проверяет workspace локально перед bind в дочерний
контейнер. Поэтому `docker_workspace: host-readonly` подключает workspace RO
по тому же абсолютному пути, который виден daemon. Обычный `/workspace` этому
worker не подключается. `none` использует пустой `/tmp/docker-workspace` и подходит
для запусков без workspace. Socket даёт управление daemon: read-only workspace
не ограничивает полномочия владельца socket. `limits.containers` передаётся тулу
как его лимит, остальные limits применяются Compose к самому worker.

Вызовы внешних MCP-серверов из ToolHub пока не реализованы: непустой `mcps`
отвергается. Docsanity оставлен вне рабочего примера до отдельной итерации.

## Essential worker

`toolhub-twylt:essential` содержит iputils-ping и Python зависимости
[twylt-pack-essential](https://github.com/Godhart/twylt-pack-essential).
Исходники шести инструментов по-прежнему подключаются из toolset через volume.
Пути router: `/essential/essential/echo`, `/essential/essential/sleep`,
`/essential/essential/wget`, `/essential/essential/curl`,
`/essential/essential/ping`, `/essential/essential/web_search`.

Пример включает для этого worker `network: true`. Для web_search задайте
`hubs[].env.TWYLT_SEARXNG_URL` и включите JSON-формат в вашем SearXNG.
SearXNG не устанавливается в образ. Системные wget/curl не требуются.

Если ping возвращает permission denied, разрешите ICMP datagram sockets для
GID worker через Compose sysctl. Например, отдельный override-файл:

```yaml
services:
  toolhub-example-essential:
    sysctls:
      net.ipv4.ping_group_range: "1000 1000"
```

Подключайте его вторым `-f` после сгенерированного compose.yaml; диапазон должен
соответствовать domain.gid. Этот вариант сохраняет cap_drop=ALL и
no-new-privileges. Поведение зависит от ядра и контейнерного движка;
проверка образа с таким sysctl — `tests/smoke-essential-image.sh <pack-dir> [docker|podman]`.

## Guardrails — images 0.7.1

Генератор добавляет TWYLT_GUARDRAILS=1, TWYLT_ALLOWED_CWD и TOOLHUB_RUN_ROOT
по умолчанию /tmp/toolhub-runs. Подкаталоги разрешены; business workspace остаётся
отдельным. Network policy также формирует общий TWYLT_DISABLE_NETWORK; не задавайте
его вручную через env. Старый TWYLT_ESSENTIAL_DISABLE_NETWORK заменён общей переменной.

Для essential нужен target essential: он устанавливает внешние зависимости 0.3.0
и системный ping. Сам пак больше не собирается и не устанавливается через pip.
Host discovery использует TWYLT 1.1.1 и весь source toolset, включая tools/ и shared/.
Генератор копирует и монтирует оба каталога; PYTHONPATH настраивать не требуется.
Уберите старый essential pin из своих Python constraints. Текущий ref essential:
938da46801b931f1ee0a2c67fbeedcd82313a92c; такой же SHA закреплён в sources.lock.json.
Обновите ref своего YAML, заново установите domains/requirements.txt и сгенерируйте domain.
Сохранение update: once означает, что существующий checkout не обновится сам;
задайте update: always для обновления либо укажите новый toolset source.

Filesystem 0.6.0, Git 0.4.0, Docker 0.4.0 и HDL wrappers 0.8.0 также используют
общий транспорт TWYLT и shared/ в подключённом toolset. В примере их refs теперь
закреплены SHA из sources.lock.json с update: always. Обновите свой YAML по примеру,
повторно установите domains/requirements.txt, пересоберите образы и сгенерируйте domain.
HDL backend 0.8.0 нужен и в target hdl, и на хосте для discovery; shared wrapper-код
не устанавливается как Python-пакет. Docker SDK закреплён на 7.1.0.

Legacy override TOOLHUB_RUN_ROOT внутри workspace для этих версий больше не нужен.
Сохраните согласованные TWYLT_ALLOWED_CWD/TOOLHUB_RUN_ROOT, если меняете default.
Docker readonly host mount сохраняется; перенос run cwd в /tmp делает файловый
транспорт независимым от прав записи в business workspace. Общий сетевой запрет
контролирует Git remote-операции и Docker pull/child networking, сохраняя локальные
Git/Docker API операции. HDL root/config/include_dirs при guardrails=1 используют
виртуальные workspace пути, например /project. Сохраните data/workspace при обновлении.
