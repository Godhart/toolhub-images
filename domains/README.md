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
./build.sh base git docker hdl mcp-bridge
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
Router и MCP bridge используют значение домена.

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
`domain-egress`; при отсутствии таких сервисов эта сеть не создаётся.
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

`packs[].prefix` определяет путь категории внутри worker. `exclude` принимает
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
