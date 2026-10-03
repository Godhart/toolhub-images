# OKF Workspace 0.2.0

Git-каталог файлов и документации с MCP/JSON CLI. Новая версия добавляет импорт
**dependency-manifest 1.0**, обязательные карточки файлов и план документации.
Артефакты и Markdown могут храниться в разных репозиториях. Зависимости называются
однозначно: `dependent` зависит от `dependency`.

## Установка и проверка

Требуются Node.js 22+ и Git. Проверено на Linux, Node.js 24.19.0.

```bash
npm ci
npm run build
npm run schemas
npm test
npm run demo -- ./demo-workspace
```

Демо создаёт исходные репозитории, мигрирует состояние, импортирует зависимости и
выводит план документации. Повторный запуск требует нового каталога. Собранный
JavaScript уже включён в архив. Пакет пока не опубликован в npm.

Полный сквозной тест hdl-order доступен при соседнем каталоге `hdl-order-0.6.0`:

```bash
HDL_ORDER_PYTHON=/path/to/venv/bin/python npm test
```

Без переменной этот единственный интеграционный тест пропускается. Остальные тесты
выполняются без Python. В окружении выпуска выполнен и сквозной тест.

## Основные правила

- Каждый файл области учёта требует основную карточку. Карточки самих документов
  повторно не создаются: зарегистрированный документ описывает себя метаданными.
- `full` — подробное описание; `minimal` — краткое описание с обязательной причиной;
  `delegated` — причина и ссылка на основной документ/главу.
- Обоснованная minimal-карточка без ссылки допустима. Отсутствие ссылки не создаёт
  требование написать ненужный полноценный документ.
- Один файл имеет одну основную карточку; дополнительные документы допустимы.
  Неоднозначное назначение попадает в resolve_mapping.
- Импортированные связи и ручные утверждения хранятся отдельно. Полнота покрытия
  файла документацией не означает полноты анализа его зависимостей.
- Изменение файлов, связей и основного делегированного документа создаёт причины
  пересмотра. Причина снимается явным review, не фактом одновременного изменения текста.

## Инициализация

```bash
node dist/cli.js --state /srv/catalog-state init workspace.json
```

Состояние должно быть новым/пустым. Импортируются committed Git-ревизии, не рабочие
незакоммиченные изменения. Пример workspace.json:

```json
{
  "schema_version": 1,
  "repositories": {
    "rtl": {"path":"./rtl-repo","ref":"HEAD"},
    "docs": {"path":"./docs-repo","ref":"HEAD"}
  },
  "domains": [{"id":"fpga","title":"FPGA","description":"RTL and its documentation"}],
  "coverage": [
    {"repository":"rtl","prefix":"","domain":"fpga","exclusions":[
      {"prefix":"build","reason":"Generated build output is outside the authored project"}
    ]},
    {"repository":"docs","prefix":"","domain":"fpga"}
  ],
  "nodes": []
}
```

Пути источников разрешаются относительно workspace.json. Домены/репозитории пока
задаются при init. Область учёта изменяется через coverage_set_prepare. Самая глубокая
подходящая область имеет приоритет. Одинаково специфичные области разных доменов
требуют resolve_mapping. Exclusions задаются относительными префиксами, не glob,
и всегда имеют причину. Файлы вне объявленных корней показываются в исключениях.

Если coverage не указан, для репозитория с одним известным доменом назначается корень.
Для остальных файлов используется известный домен зарегистрированного объекта;
неоднозначные незарегистрированные файлы требуют явного сопоставления.

## Импорт из hdl-order 0.6.0

Сначала получи согласованную копию исходников:

```bash
node dist/cli.js --state /srv/catalog-state export ./snapshot-export
hdl-order ./snapshot-export/rtl --export-dependencies dependencies.json --project-id fpga-main --analysis-profile simulation
```

Для импорта подготовь JSON-запрос, в котором manifest содержит **объект из файла**,
а не имя файла:

```json
{
  "base_snapshot":"<snapshot from snapshot_get>",
  "idempotency_key":"import-hdl-001",
  "mapping":{"rtl":{"repository":"rtl","prefix":""}},
  "manifest": {"format":"dependency-manifest","version":"1.0","...":"full manifest object"}
}
```

Значения в угловых скобках и сокращённый manifest — поясняющие placeholders.
Используй готовый скрипт, чтобы собрать корректный запрос без ручной вставки:

```bash
node examples/import-manifest.mjs /srv/catalog-state dependencies.json mapping.json import-hdl-001 > import-request.json
node dist/cli.js --state /srv/catalog-state call dependencies_import_prepare import-request.json
```

mapping.json: `{"rtl":{"repository":"rtl","prefix":""}}`.
Прочитай summary и candidate подготовленного изменения. Применение:

```bash
printf '%s' '{"change_id":"import-hdl-001"}' > apply.json
node dist/cli.js --state /srv/catalog-state call changes_apply apply.json
```

При несовпадении хешей импорт отклоняется. Недоступные корни нельзя автоматически
сопоставить абсолютным путям с другой машины. Для каждого логического source root
нужно явное mapping; внешние объекты остаются задачами resolve_mapping.

Scoped текстовые файлы до 1 МиБ из отчёта автоматически регистрируются как артефакты,
если ещё не зарегистрированы и домен однозначен. Существующие постоянные ID сохраняются.
Остальные файлы видны в инвентаризации и покрытии. Отдельный nodes_register_prepare
регистрирует существующий текстовый файл/OKF-документ без перезаписи его содержимого.

## План документации

```bash
node dist/cli.js --state /srv/catalog-state call documentation_plan examples/empty.json
node dist/cli.js --state /srv/catalog-state call documentation_coverage examples/empty.json
```

Действия: create_card, complete_card, review, update, repair_reference, retire,
refresh_analysis, resolve_mapping. Каждая задача имеет стабильный key, объект,
документ при наличии, причины, blockers, priority и snapshot. Повторные причины
объединяются. update появляется после явного подтверждения конкретной проблемы через
`documentation_issue_prepare`; изменение зависимости само по себе создаёт review.

Фильтры: domain, action, offset, limit (до 100), snapshot. `since_snapshot` возвращает
изменившиеся/новые задачи относительно другого снимка. Это сравнение задач, не список
всех изменённых файлов. Снятые задачи в этой выдаче не перечисляются.

План консервативно учитывает все импортированные профили; dependencies_graph умеет
ограничивать наблюдения через analysis_ids. Старый/неполный граф явно отмечается.
При новом/изменённом файле предлагается refresh_analysis существующего анализатора.
План не запускает анализатор автоматически и не утверждает, что интерфейс HDL-модуля
изменился только на основании изменения байтов содержащего его файла.

## Создание карточки

Карточка — обычный зарегистрированный Markdown-документ. В `changes_prepare`
используй create с такими полями node:

```json
{
  "id":"fifo-card","kind":"document","domain":"fpga","repository":"docs",
  "path":"files/fifo.md","title":"FIFO","description":"FIFO implementation file.",
  "card":{
    "subject":{"repository":"rtl","path":"lib/fifo.sv"},
    "mode":"delegated",
    "reason":"The interface is described in the subsystem guide.",
    "references":[{"document":"fifo-guide","section":"interface"}]
  }
}
```

Content начинается с YAML frontmatter `type: Documentation`, затем идёт Markdown.
Минимальная карточка использует mode=minimal, непустой reason и может иметь references=[].
Полноценная карточка использует mode=full и содержательное тело. Планировщик умеет
обнаружить пустое тело, но не оценивает полноту инженерного описания вместо человека.

Для связи с уже зарегистрированным артефактом добавь subject.artifact_id — тогда
карточка следует за его перемещением. Для бинарного файла достаточно repository/path:
его байты через текстовый API изменять не требуется. Для изменения назначения карточки
используй metadata с card; `card:null` снимает назначение. При отсутствии карточки
снова появится create_card. Несуществующая делегированная ссылка видна как repair_reference.

`documentation_links_set_prepare` отдельно задаёт document и subjects для дополнительных
описаний. Этот инструмент не назначает их основной карточкой автоматически.

## Роли и совместимость

Новые интерфейсы зависимостей используют dependent/dependency. Документирование
использует document/subject. Legacy relations с target сохраняются **внутри старой
модели хранения** для чтения истории и исполнения прежних операций библиотеки.
Новые MCP/CLI-схемы changes_prepare не предлагают legacy relations. Используй
`dependencies_set_prepare` и `documentation_links_set_prepare`.

Полная замена ручных зависимостей одного узла:

```json
{
  "base_snapshot":"<snapshot>","idempotency_key":"manual-001",
  "dependent":"controller",
  "dependencies":[{"dependency":"fifo","relation":"depends_on"}]
}
```

Импортированные отношения этим не удаляются. HDL-виды отношений сохраняются в
наблюдениях manifest и выводятся в dependencies_graph. Граф на уровне файлов —
проекция исходного графа сущностей, сами сущности не теряются.

## MCP и toolhub

```json
{"mcpServers":{"okf-workspace":{"command":"node","args":["/absolute/okf-workspace-0.2.0/dist/cli.js","--state","/absolute/state","mcp"]}}}
```

Toolhub: `node /absolute/dist/cli.js --state /absolute/state call TOOL input.json`.
JSON-ответ приходит в stdout; файл output.json не создаётся. Незакрытый stdin runner
не мешает файловому вводу. Для stdin явно укажи `-`. INPUT_DESCRIBE/TWYLT пока не реализованы.

Схемы: `describe TOOL`, `describe` и каталог schemas/. Основные новые tools:

| Tool | Назначение |
|---|---|
| migration_prepare | Миграция состояния 0.1 |
| dependencies_import_prepare | Импорт с проверкой ревизий |
| dependencies_sources | Профили, полнота и актуальность |
| dependencies_graph | Исходные и файловые зависимости с происхождением |
| dependencies_set_prepare | Ручные зависимости |
| documentation_links_set_prepare | Дополнительные отношения document/subject |
| nodes_register_prepare | Регистрация существующего файла |
| coverage_set_prepare | Области учёта и исключения |
| documentation_plan / documentation_coverage | Задачи и покрытие |
| documentation_issue_prepare | Подтверждённая необходимость обновления |

Все `*_prepare` применяются штатным changes_apply. Чтение, карточки, поиск OKF,
Git-снимки, export и операции содержимого сохранены. Старые операции описаны в
[docs/API.md](docs/API.md); examples legacy relations относятся только к внутренней
совместимости, новые роли описаны выше.

## Ограничения и эксплуатация

- hdl-order 0.6.0 отдаёт частичный синтаксический граф, не полный граф VUnit.
- Частичный импорт не удаляет старые наблюдения. Полный заменяет только свои связи
  заявленных relation_types для dependent-файлов из coverage.files. Остальное сохраняется.
- Проверки JSON Schema дополняются семантическими: ID, ссылки, mapping и реальные хеши.
- Импорт и запись работают по managed Git-снимкам. Source worktrees и remote refs
  не меняются; обратный импорт внешних правок и merge пока не автоматизированы.
- Бинарные файлы имеют карточки и сохраняются при экспорте, но текстовый редактор
  не загружает/не редактирует их. Незарегистрированные файлы включаются в покрытие.
- Диапазоны SemVer, семантический diff HDL, генерация документации моделью и сборка
  статических сайтов не входят в выпуск. Markdown готов к внешнему рендереру.
- Сопоставление по ID/пути детерминировано; автоматического угадывания переименований нет.
- Требования пересмотра на уровне сущности консервативно сводятся к содержащему файлу.
- План — вычисляемый отчёт, а не трекер исполнителей/сроков. Исключения оформляются
  coverage с причиной. Приоритеты сначала выводят проблемы анализа и сопоставления;
  автоматическое расписание и топологический порядок выполнения задач не реализованы.
- Весь STATE необходимо резервировать. После миграции не записывай его старой версией.

Миграция: [docs/MIGRATION-0.2.md](docs/MIGRATION-0.2.md).
Восстановление: [docs/RECOVERY.md](docs/RECOVERY.md). Решения: [ADR.md](ADR.md).
