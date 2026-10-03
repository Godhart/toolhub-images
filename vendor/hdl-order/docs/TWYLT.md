# TWYLT-обёртки hdl-order 0.7.0

Восемь самостоятельных инструментов, каждый с собственным именем, входной и
выходной схемой, описанием и few_shots. Обёртки используют TWYLT 1.0.0 и вызывают
Python API hdl-order. Бизнес-логика анализа не дублируется, stdout CLI не парсится.

## Установка

Из корня распакованного выпуска:

```bash
python -m venv .venv
. .venv/bin/activate
python -m pip install '.[twylt,test]'
python -m pytest -q
```

Обычный CLI не требует extra twylt. Для runtime без тестов достаточно `.[twylt]`.
В wheelhouse/ включён wheel hdl-order этого выпуска. Для отдельного окружения runner:

```bash
/path/to/runner/python -m pip install --find-links /absolute/hdl-order-0.7.0/wheelhouse 'hdl-order[twylt]==0.7.0'
```

Этот выпуск не опубликован в PyPI. При автоматической установке requirements из
метаданных toolpack-builder/toolhub настрой `PIP_FIND_LINKS` на абсолютный путь к
wheelhouse, доступному runner. Иначе pip будет искать неопубликованную версию в индексе.
TWYLT и остальные зависимости устанавливаются обычным pip. Это не полностью
автономный offline-архив. Для удалённого runner скопируй туда wheelhouse и tools/.

Структура каждого инструмента: `tools/hdl-ИМЯ/run.py`, `tool.py`, `input.example.json`.
`run.py` использует стандартный `twylt.bootstrap.run_tool_file`. Метаданные в tool.py
записаны литералами, поэтому requirements и json_spec доступны через bootstrap даже
при отсутствии hdl_order. В таком json_spec схемы будут пустыми до установки пакета.
Сам TWYLT должен быть установлен для запуска bootstrap.

## Инструменты

| Имя | Результат | Дополнительные параметры |
|---|---|---|
| hdl-order | compile_order, defines, headers | render: plain, csv, modelsim |
| hdl-check | ok, счётчики, duplicates, unresolved_includes | — |
| hdl-symbols | symbols: библиотека, вид, имя, owner, файл, строка | — |
| hdl-map | units: ID символа → библиотека/файл/строка | — |
| hdl-graph | nodes и edges с dependent/dependency | render: text, dot |
| hdl-dependencies | includes, explicit | file: файл для адресного объяснения |
| hdl-headers | headers с used_by и unresolved | — |
| hdl-manifest | manifest: dependency-manifest 1.0 | project_id обязателен; analysis_profile |

У всех инструментов обязательный `root`. Общие необязательные параметры:
`config` — путь к TOML, `include_dirs` — упорядоченный список каталогов,
`defines` — объект со строковыми значениями, `allow_missing_includes` — bool.
Пути root/config/include_dirs разрешаются относительно cwd процесса. Параметр file
у hdl-dependencies разрешается внутри root. В автоматизации предпочитай абсолютные
пути к проекту и конфигурации. Пути в результатах по возможности относительны root;
внешние include-файлы в обычных отчётах могут иметь абсолютные пути.

## Запуск и описание

JSON первым аргументом → результат в stdout:

```bash
python tools/hdl-order/run.py '{"root":"/projects/fpga/rtl","render":"modelsim"}'
python tools/hdl-check/run.py '{"root":"/projects/fpga/rtl"}'
python tools/hdl-symbols/run.py '{"root":"/projects/fpga/rtl"}'
python tools/hdl-map/run.py '{"root":"/projects/fpga/rtl"}'
python tools/hdl-graph/run.py '{"root":"/projects/fpga/rtl","render":"dot"}'
python tools/hdl-dependencies/run.py '{"root":"/projects/fpga/rtl","file":"lib/top.sv"}'
python tools/hdl-headers/run.py '{"root":"/projects/fpga/rtl"}'
python tools/hdl-manifest/run.py '{"root":"/projects/fpga/rtl","project_id":"fpga","analysis_profile":"simulation","defines":{"SIM":"1"}}'
```

Также доступен stdin → stdout:

```bash
python tools/hdl-order/run.py < request.json
```

Файловый режим: input.json → output.json в cwd. При открытом stdin TWYLT ожидает EOF;
в Linux для явного файлового запуска используй:

```bash
python /absolute/hdl-order-0.7.0/tools/hdl-order/run.py < /dev/null
```

Поведение TWYLT не изменено. Для настроенного runner toolhub используй его штатный
режим input.json/output.json с закрытым stdin либо JSON-транспорт. Диагностика VUnit
направляется в stderr. Наличие сообщений stderr само по себе не означает ошибку:
проверяй exit code и JSON. VUnit может создавать служебный vunit_out в cwd.

Описание без анализа проекта:

```bash
INPUT_DESCRIBE=json_spec python tools/hdl-order/run.py < /dev/null
INPUT_DESCRIBE=requirements python tools/hdl-order/run.py < /dev/null
python tools/hdl-order/run.py '{"describe":"schema"}'
python tools/hdl-order/run.py '{"describe":"few_shots"}'
python tools/hdl-order/run.py --help
python tools/hdl-order/run.py --version
```

Доступны все режимы INPUT_DESCRIBE: brief, schema, few_shots, requirements, json_spec.
Сохранённые json_spec лежат в schemas/twylt/. Few-shots используют небольшой пустой
проект examples/twylt-empty и запускаются из корня выпуска. Полезные HDL-сценарии
проверяются тестами на проектах с исходниками и заголовками.

## Подключение toolhub / toolpack-builder

Сканируй каталог tools/. Каждая пара run.py/tool.py — отдельный инструмент со
статическими метаданными. Если builder сканирует отдельные файлы по glob, выбирай
`tools/**/run.py`, чтобы не включить tool.py повторно. При ручной настройке команда:

```text
/absolute/runner/python /absolute/hdl-order-0.7.0/tools/hdl-order/run.py
```

Для остальных инструментов меняется последний каталог. Схемы, requirements и
few_shots получай через json_spec. Требования содержат `hdl-order[twylt]==0.7.0`;
локальный wheel и PIP_FIND_LINKS нужны в том окружении, которое устанавливает пакеты.
Фактический импорт в пользовательскую инсталляцию toolhub не выполнялся; проверены
TWYLT-транспорт, bootstrap и метаданные, которыми пользуется сборщик.

## Передача manifest в OKF Workspace

hdl-manifest возвращает `{"manifest": {...}}`. Значение поля manifest передаётся
в `dependencies_import_prepare.manifest`; mapping, base_snapshot и idempotency_key
задаёт вызывающая сторона. Обёртка не записывает артефакты и не применяет изменения OKF.

```bash
python tools/hdl-manifest/run.py '{"root":"/projects/fpga/rtl","project_id":"fpga"}' > response.json
python -c 'import json; print(json.dumps(json.load(open("response.json"))["manifest"]))' > dependencies.json
```

Manifest сохраняется без добавления null в необязательные поля и совместим с общей
строгой JSON Schema 1.0. Полная схема manifest включена в выходную схему инструмента.

## Ошибки и границы

- Неизвестные поля и недопустимые значения дают ошибку TWYLT input validation.
- Отсутствующий root, цикл и ошибки анализа дают TWYLT execution_error, source=tool.
- hdl-check возвращает ok=false при найденных дубликатах/неразрешённых include,
  если анализ дошёл до результата. Такой ответ — успешное исполнение инструмента
  с отрицательным результатом проверки, exit code 0. Фатальная ошибка VUnit — ошибка biz.
- hdl-graph и manifest явно частичные. hdl-dependencies содержит только includes
  и явные файловые зависимости; это не полный семантический граф VUnit.
- render=modelsim возвращает текст команд и не запускает симулятор.
- Карточки документации и статусы ревизии управляются OKF, не этими обёртками.
