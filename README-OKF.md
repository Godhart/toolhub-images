# Образ docsanity (OKF)

`docs` не содержал OKF. Новый target `docsanity` наследует `docs`: все инструменты
документации и Git остаются доступны, добавляются OKF Workspace 0.2.0 и его
зависимость @copperbox/okf-mcp 2.1.0. Исходники скачиваются из https://github.com/Godhart/docsanity по sources.lock.json.
Проект на GitHub называется docsanity; upstream package/CLI пока называются
okf-workspace, поэтому команда, переменная OKF_WORKSPACE_STATE и /okf-state
сохранены. Старый target okf остаётся псевдонимом docsanity.

## Сборка

```bash
docker build --target docsanity -t toolhub-twylt:docsanity .
# Podman:
podman build --target docsanity -t toolhub-twylt:docsanity .
```

Можно добавить `--build-arg WITH_LATEX=0` для сборки без TeX. Общие секции
дополнительных Python/Node-пакетов сохранены. Базовый Dockerfile по умолчанию
по-прежнему собирает base, а не OKF.

## Что умеет тул

TWYLT-тул `tools/okf_workspace/tool.py` вызывает предустановленный JSON CLI:

- `documentation_plan`, `documentation_coverage`: задачи, покрытие, пересмотры;
- `docs_search`, `nodes_get`, `catalog_list`: поиск и чтение документации;
- `changes_prepare`: создание, замена, patch и редактирование разделов;
- `changes_apply`: отдельное применение подготовленного изменения;
- операции карточек, зависимостей, manifest, областей учёта и проверок;
- `describe_tools`: полный список схем операций; `list_tools`: краткий список.

Обёртка не применяет prepare автоматически. OKF хранит управляемые Git-снимки:
apply публикует снимок внутри OKF, не изменяет исходные worktrees и не делает push.
Текст документа задаёт пользователь/агент. Сам OKF не генерирует текст через LLM;
рендеринг Markdown/PDF выполняют установленные инструменты docs.

## Каталоги

| Mount | Назначение |
|---|---|
| `/tools` (ro) | TWYLT-обёртка и остальные тулы |
| `/okf-state` (rw) | Полное постоянное состояние OKF, включая управляемые репозитории |
| `/workspace` (rw) | Исходные Git-репозитории, конфигурация, экспорт, сборка документов |
| `/data` (rw) | База ToolHub; нужна только серверному режиму |

Новая переменная `OKF_WORKSPACE_STATE=/okf-state` задаётся образом.
Не путайте OKF state с /data/hub.db: это независимые хранилища.
Оба нужно резервировать. Инициализация OKF намеренно явная: сервер не выбирает
репозитории и не создаёт/сбрасывает каталог автоматически.

## Минимальный старт

Пример для Linux, Bash и Docker. Запускайте из корня распакованного комплекта.
Все новые тестовые данные создаются только внутри workspace/docs.

```bash
mkdir -p data okf-state workspace/docs
cp .env.example .env
# Задайте свои пароли ToolHub в .env.
cp examples/okf-workspace.json workspace/okf-workspace.json

git -C workspace/docs init
git -C workspace/docs config user.name 'Documentation'
git -C workspace/docs config user.email 'documentation@localhost'
printf 'Documentation repository\n' > workspace/docs/README.txt
git -C workspace/docs add README.txt
git -C workspace/docs commit -m 'Initialize documentation repository'

docker run --rm --network none --user "$(id -u):$(id -g)" \
  -v "$PWD/okf-state:/okf-state" -v "$PWD/workspace:/workspace" \
  toolhub-twylt:docsanity okf-workspace init /workspace/okf-workspace.json
```

Для собственного проекта измените repositories/domains/coverage в конфигурации.
Пути repositories относительны каталогу конфигурации. Импортируются committed
Git-ревизии; незакоммиченные файлы не попадают в снимок. Init требует нового
состояния и выполняется один раз. Не вызывайте его для рабочего существующего state.

Для rootless Podman замените docker на podman и добавьте `--userns=keep-id`.
Для SELinux используйте соответствующие `:Z`/`:ro,Z` у mounts. UID/GID должен
совпадать с владельцем Git-репозиториев и доступом к /okf-state. Compose по умолчанию
использует 1000:1000 — измените `user`, если ваши идентификаторы другие.

## Сервер ToolHub

```bash
docker compose -f compose.yaml -f compose.docsanity.yaml up -d --build
```

Откройте http://localhost:3000/admin/ . Подключённый /tools уже содержит обёртку,
но ToolHub не регистрирует её автоматически. Создайте запись инструмента (или
соберите/import toolpack через ToolPack Builder из `tools/**/tool.py`).
Выберите `TWYLT Python (preinstalled)`, задайте timeoutMs, например 180000, и код:

```python
import runpy
runpy.run_path('/tools/okf_workspace/tool.py', run_name='__main__')
```

Метаданные получите через `python /tools/okf_workspace/run.py
'{"describe":"json_spec"}'` внутри контейнера. При импорте пака проверьте выбор
раннера: он не должен пытаться устанавливать npm/OKF через Python requirements.
Python requirements описывают только обёртку; OKF CLI ставится Dockerfile.

Пример входа:

```json
{"operation":"documentation_plan","arguments":{},"timeout_seconds":120}
```

Результат обёрнут в `{"result": ...}`. Поле operation имеет enum, неизвестные
верхнеуровневые поля запрещены. arguments проверяются строгой схемой выбранной
операции внутри OKF. Получить эти схемы можно запросом:

```json
{"operation":"describe_tools"}
```

## Одноразовый вызов без сервера и сети

```bash
docker run --rm --network none --user "$(id -u):$(id -g)" \
  --read-only --tmpfs /tmp:rw,nosuid,nodev,mode=1777 \
  --cap-drop ALL --security-opt no-new-privileges \
  -v "$PWD/tools:/tools:ro" -v "$PWD/okf-state:/okf-state" \
  -v "$PWD/workspace:/workspace" \
  toolhub-twylt:docsanity python /tools/okf_workspace/run.py \
  '{"operation":"documentation_plan","arguments":{}}'
```

Для stdin добавьте `-i`, без `-t`. При файловом режиме адаптер читает input.json,
а CLI получает JSON через отдельный pipe с EOF. CLI вызывается без shell.
После таймаута проверьте `changes_get`: операция могла успеть сохранить состояние.

## Создание и поддержка документа

1. Вызовите `snapshot_get` и сохраните snapshot.
2. Передайте `changes_prepare` с этим base_snapshot, уникальным idempotency_key,
   message и operations. Для нового документа операция create содержит node
   (id, kind=document, domain, repository, path, title, description) и content.
3. Content должен начинаться YAML frontmatter с `type: Documentation`.
4. Просмотрите возвращённый diff. Отдельно вызовите `changes_apply` с change_id.
5. При обновлении читайте nodes_get: используйте актуальные snapshot и content_hash
   в операции replace/patch/replace_section. Для review задаются причины и evidence.

Полные контракты и примеры находятся в [репозитории docsanity](https://github.com/Godhart/docsanity): README.md,
docs/API.md и schemas/tools.json. Обёртка сохраняет штатные проверки конфликтов,
идемпотентность и двухэтапный протокол. Init и export доступны через CLI отдельно.

## Экспорт и сборка документации

```bash
docker run --rm --network none --user "$(id -u):$(id -g)" \
  -v "$PWD/okf-state:/okf-state" -v "$PWD/workspace:/workspace" \
  toolhub-twylt:docsanity okf-workspace export /workspace/export-001
```

Выберите новый каталог для каждого экспорта. Результат содержит обычные Git-копии
репозиториев (например export-001/docs), после чего можно запускать MkDocs, Sphinx,
Pandoc и прочие средства docs над экспортом. Их конфигурации принадлежат вашему
проекту; образ не подменяет их автоматически.

MCP также доступен: команда `okf-workspace mcp`, транспорт stdio. Для одноразового
MCP-контейнера используйте `docker run --rm -i ... toolhub-twylt:docsanity okf-workspace mcp`
с теми же mounts и без `-t`. Вместо этого ToolHub может запускать CLI локально
внутри уже работающего контейнера; Docker socket ему не нужен.

## Проверки и ограничения

Сборка TypeScript и интеграционные тесты адаптера выполняются без контейнера:

```bash
python3 scripts/fetch-sources.py --dest .sources docsanity
cd .sources/docsanity
npm ci
npm run build
cd ../..
python tests/test_okf_adapter.py
```

Нужны Node 22, Git и Python-зависимости base. Тест создаёт временный Git-репозиторий,
проверяет prepare/apply, обновление по хешу, export, схемы и открытый stdin.
Проверки собранных образов — tests/smoke-images.sh. История результатов — TESTING.md.

Образ `docsanity` не содержит hdl-order: при необходимости вызывайте отдельный `hdl`
и передавайте dependency-manifest JSON в dependencies_import_prepare. Сохраняются
ограничения OKF 0.2.0: нет автоматического merge внешних правок, автогенерации
текста моделью или автоматической оценки инженерной полноты документа.

## Совместимость с images 0.5.0

Targets docsanity и alias okf сохранены. Python TWYLT обновлён до 1.1.0;
общие defaults guardrails/cwd наследуются от common. Сам docsanity upstream
и его Node-зависимости не менялись. Смотрите README.md и TESTING.md версии 0.5.0.
