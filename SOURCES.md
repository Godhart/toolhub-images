# Источники 0.3.0

Канонический список: https://github.com/Godhart/twylt/blob/main/RESOURCES.md
Проект сборки: https://github.com/Godhart/toolhub-images

| Проект | GitHub | Закреплённая ревизия |
|---|---|---|
| toolhub | [https://github.com/Talos-popcorn/toolhub](https://github.com/Talos-popcorn/toolhub) | `61c19ca0d3639545f5e7f8461b8998506a1592f7` |
| twylt | [https://github.com/Godhart/twylt](https://github.com/Godhart/twylt) | `6df2b0c9880adeb4296d74eb1e8d1e390744ccfd` |
| twylt-typescript | [https://github.com/Godhart/twylt-typescript](https://github.com/Godhart/twylt-typescript) | `cd004855486e3cb485690fb5fb55b1cb0f03de42` |
| twylt-pack-filesystem | [https://github.com/Godhart/twylt-pack-filesystem](https://github.com/Godhart/twylt-pack-filesystem) | `fa5daa98ed7dd066ea1e497b41132580a31b9c1e` |
| hdl-order | [https://github.com/Godhart/hdl-order](https://github.com/Godhart/hdl-order) | `70c46c0a58230148f0e3bd9d45eec8ba1acc18de` |
| docsanity | [https://github.com/Godhart/docsanity](https://github.com/Godhart/docsanity) | `0e53f00ee8006d0143f0357d01f491d406b51dbe` |

В архиве нет исходников этих проектов. Dockerfile получает их стадией sources
через scripts/fetch-sources.py. Загрузчик принимает только полные SHA, выполняет
fetch/checkout, сверяет HEAD и удаляет .git из подготовленного дерева.
GitHub и пакетные реестры нужны при сборке; собранный контейнер не загружает
проекты при старте. Источники filesystem нужны для его requirements.txt;
сам пак по-прежнему подключается через volume. Python TWYLT также ставится из
полученного GitHub-исходника, а остальные PyPI/npm зависимости — из реестров.

## Обновление

1. Найдите нужный commit/tag в соответствующем GitHub-проекте.
2. Разрешите его до полного 40-символьного commit SHA и измените commit в sources.lock.json.
3. При смене имени репозитория сверьтесь с каноническим RESOURCES.md, измените url.
4. Пересоберите образы и выполните tests/smoke-images.sh. Новый lock меняет слой
   загрузчика и инвалидирует его cache. До изменения lock ветка main не отслеживается.

Для локальных проверок: `python3 scripts/fetch-sources.py --dest .sources`.
Можно выбрать проекты: `python3 scripts/fetch-sources.py --dest .sources docsanity`.
Загрузчик требует Git и Python 3, отказывается перезаписывать существующий каталог
проекта. Для повторного скачивания выберите новый dest или удалите временную копию.
`.sources/` не коммитится и не включается в build context/дистрибутив.

## Небольшие интеграционные изменения

scripts/configure-toolhub.py на стадии сборки переводит SQLite URL в DATABASE_URL,
добавляет окружение паролей seed и убирает их печать. Проверяется точное соответствие
ожидаемым строкам; при несовместимом upstream сборка останавливается с сообщением.
Это сохраняет лишь контейнерную адаптацию, без копии исходников ToolHub.
Никаких исправлений TWYLT TypeScript поверх 0.2.3 больше не требуется.

Тесты внешних проектов живут в их репозиториях; здесь остаются тесты контейнерной
интеграции. Маленький tools/okf_workspace — собственный адаптер toolhub-images,
а не копия docsanity. Когда появится канонический отдельный пакет обёрток, его
также можно будет подключать внешним источником.

Сохранение SHA не закрепляет базовые image digest, apt и все транзитивные пакеты.
В частности исходный ToolHub bun.lock нормализуется Bun 1.4.2 при установке.
При распространении образов сохраняются лицензии включённых компонентов
(в том числе AGPL ToolHub); источники доступны по указанным точным ревизиям,
контейнерные изменения — в этом репозитории.

## Domain integration (0.4.0)

- [toolpack-builder](https://github.com/Godhart/toolpack-builder): discovery/build Python TWYLT, SHA в domains/requirements.txt и sources.lock.json.
- [toolhub-mcp-bridge](https://github.com/Godhart/toolhub-mcp-bridge): самостоятельный image target, SHA в sources.lock.json.
- `config-loader/` — интеграционный модуль из ранее подготовленного toolhub-config-loader 0.1.0; опубликованный upstream URL не был предоставлен. Он включён локально, вместе с тестами и минимальным REMOTE patch, без копии ToolHub. После публикации модуля его можно заменить закреплённой GitHub dependency.
- Toolsets берутся из URL/ref domain YAML и подключаются volume; сторонние репозитории не включены в этот проект.
