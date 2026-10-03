# Контракт 0.1

Все запросы — JSON-объекты, неизвестные поля отклоняются. Точные схемы возвращает
`describe`, а MCP публикует их в tools/list. ID: до 96 символов, первый буквенно-цифровой,
далее буквы, цифры, точка, дефис, подчёркивание; без `..`, финальной точки и `.lock`.
Пути относительные, с `/`, без `.git`, `..`, обратных слешей и `:`.

## Чтение

Примеры arguments, передаваемых в соответствующий tool:

| Tool | Arguments |
|---|---|
| snapshot_get | `{}` |
| domains_list | `{}` |
| catalog_list | `{"domain":"tools","kind":"document","offset":0,"limit":20}` |
| catalog_list | `{"needs_review":true}` |
| files_list | `{"repository":"runtime","offset":0,"limit":50}` |
| docs_search | `{"query":"JSON","offset":0,"limit":10}` |
| nodes_get | `{"id":"input-guide","view":"brief"}` |
| nodes_get | `{"id":"input-guide","view":"summary"}` |
| nodes_get | `{"id":"input-guide","view":"outline"}` |
| nodes_get | `{"id":"input-guide","view":"sections","section_ids":["protocol"]}` |
| nodes_get | `{"id":"input-reader","view":"full"}` |
| nodes_related | `{"id":"client","limit":10}` |
| graph_query | `{"id":"input-reader","direction":"dependents","depth":3}` |
| catalog_validate | `{}` |
| sources_status | `{}` |

Снимок возвращается в поле snapshot. Его можно передавать в чтение явно. Для
исторической зависимости `nodes_get` также принимает `at_hash: "sha256:..."`:
поиск идёт назад по истории указанного (либо текущего) снимка. Ответ содержит ID
снимка, где найдена нужная редакция. Это точные хеши байтов, не SemVer-диапазоны.

Карточка содержит repository/path, домен, kind, version (если задана), связи,
content_hash, Git revision, based_on и массив review_required.

`summary` берётся из поля summary frontmatter, иначе — из description карточки.
Для глав возвращается точный фрагмент Markdown. Отдельная пометка сообщает, что
определения ссылок/сносок могут находиться вне фрагмента.

`files_list` перечисляет полное отслеживаемое дерево выбранного репозитория.
`registered_id: null` означает отсутствие карточки, а не отсутствие файла.
`git_oid` — Git object ID; он не равен content_hash, который использует SHA-256.

## Подготовка

```json
{
  "base_snapshot": "REPLACE_WITH_CURRENT_SNAPSHOT",
  "idempotency_key": "input-doc-edit-001",
  "message": "Clarify input protocol",
  "operations": [
    {
      "action": "replace_section",
      "id": "input-guide",
      "expected_hash": "REPLACE_WITH_CONTENT_HASH",
      "section_id": "protocol",
      "content": "Read a UTF-8 JSON object from input.json."
    }
  ]
}
```

Значения REPLACE_WITH... — поясняющие placeholders; подставь реальные значения
из snapshot_get и nodes_get. В примере **нет операции над артефактом**.

Ответ содержит id, status=prepared, candidate (снимок для предварительного чтения),
diffs и request. Каждый текстовый diff ограничен 30 000 символами, наличие усечения
отмечается truncated. Исходное и новое содержимое при необходимости читаются
через nodes_get с соответствующими снимками. Метаданные before/after карточки тоже
включены в diff. Журнал содержит полный запрос и хранится локально.

В одном наборе допускается одна операция содержимого/метаданных на объект.
Review может дополнительно присутствовать, но не подтверждает новые причины,
созданные тем же набором. Для смены текста и метаданных одного документа в 0.1
используй два последовательных набора. Совместное изменение разных объектов
всегда можно включить в один набор.

## Операции

### create

```json
{
  "action":"create",
  "node":{
    "id":"new-tool","kind":"artifact","domain":"tools","repository":"runtime",
    "path":"src/new_tool.py","title":"New tool","description":"A new local tool."
  },
  "content":"print('hello')\n"
}
```

ID и путь должны отсутствовать. Node допускает version и relations. Для создания
документа укажи kind=document, путь .md и frontmatter с type. Артефакт необязателен.

### replace

```json
{"action":"replace","id":"input-reader","expected_hash":"sha256:...","content":"print('updated')\n"}
```

Полная замена UTF-8 текста. Для документа проверяется OKF frontmatter и уникальность
явных ID глав. Исполняемый бит исходного файла сохраняется.

### patch

```json
{"action":"patch","id":"input-reader","expected_hash":"sha256:...","patch":"@@ -1,2 +1,2 @@\n def read_input():\n-    return {}\n+    return {\"ok\": True}\n"}
```

Unified diff для одного объекта с fuzzFactor=0. Адрес объекта задаёт id;
пути заголовков diff не являются разрешением изменять другие файлы.

### replace_section

```json
{"action":"replace_section","id":"input-guide","expected_hash":"sha256:...","section_id":"protocol","content":"New section body."}
```

Заголовок сохраняется. Передаётся тело раздела, не повтор его заголовка. Вложенные
подразделы входят в заменяемый диапазон. Для изменения самого заголовка используй
patch или replace, сохранив `{#protocol}`.

### move

```json
{"action":"move","id":"input-guide","expected_hash":"sha256:...","path":"reference/input.md"}
```

В пределах того же репозитория. Стабильные отношения по ID сохраняются;
относительные ссылки в тексте не переписываются. Путь назначения должен отсутствовать.

### delete

```json
{"action":"delete","id":"client","expected_hash":"sha256:..."}
```

Удаляет карточку и файл в новом снимке, история остаётся. При входящих связях
операция отклоняется. Ссылки можно удалить metadata-операциями над зависимыми
узлами в том же наборе, после чего проверяется итоговое состояние.

### metadata

```json
{
  "action":"metadata","id":"client","expected_hash":"sha256:...",
  "description":"Client using a pinned input implementation.",
  "version":"1.0",
  "relations":[{"type":"depends_on","target":"input-reader","target_hash":"sha256:..."}]
}
```

Опциональны title, description, version, relations. relations заменяет массив целиком.
Пустой массив удаляет все исходящие связи. Изменение связей само по себе требует
проверки объекта. Поля карточки сохраняются в управляющем Git-снимке.

Связь может включать section (ID главы цели), source_section (ID главы источника),
target_hash (точная редакция цели). source_section валидируется, но пометка ревизии
пока ставится всему объекту, а не его отдельной главе.

### review

```json
{
  "action":"review","id":"input-guide","expected_hash":"sha256:...",
  "reason_ids":["REASON_ID_FROM_CARD"],
  "evidence":"Checked the guide against the new reader behavior.",
  "actor":"process:documentation-checker"
}
```

Снимает только перечисленные текущие причины. Требует существующих reason IDs.
Не означает автоматическую проверку истинности текста сервером. Evidence и actor
сохраняются в истории. Когда причин больше не остаётся, based_on для documents-связей
обновляется на соответствующие редакции артефактов. Не называй машинную проверку human.

## Применение и контроль

Для changes_apply, changes_get и changes_discard:

```json
{"change_id":"input-doc-edit-001"}
```

`changes_apply` проверяет base_snapshot ещё раз и меняет один ref управляющего
репозитория. Ответ: change_id, snapshot, status=applied. Если другой набор уже
опубликован, возвращается конфликт без изменения текущего состояния.

Discard возможен только до публикации. Для отмены опубликованного изменения нужно
подготовить новое обратное изменение; автоматического разрушительного reset нет.
